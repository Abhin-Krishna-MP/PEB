import { openDB, type DBSchema, type IDBPObjectStore } from 'idb'
import { defaults, type Book, type Collection, type Preferences } from './model'
import { samples } from './samples'
import { fetchDriveBook } from './driveApi'
import { mergeDriveRecords, newer, recordKey, recordsForBook, type DriveBinding, type DriveRecord } from './driveRecords'

interface LibraryDatabase extends DBSchema {
  books: { key: string; value: Book }
  files: { key: string; value: Blob }
  collections: { key: string; value: Collection }
  settings: { key: string; value: Preferences | boolean }
  driveRecords: { key: string; value: DriveRecord }
  driveSettings: { key: string; value: DriveBinding | string }
}
let connection: ReturnType<typeof openDB<LibraryDatabase>> | undefined
const database = () => connection ??= openDB<LibraryDatabase>('folio-library', 2, {
  upgrade(db, oldVersion) {
    if (oldVersion < 1) {
      db.createObjectStore('books', { keyPath: 'id' })
      db.createObjectStore('files')
      db.createObjectStore('collections', { keyPath: 'id' })
      db.createObjectStore('settings')
    }
    db.createObjectStore('driveRecords', { keyPath: 'key' })
    db.createObjectStore('driveSettings')
  },
  blocking(_current, _next, event) {
    (event.target as IDBDatabase).close()
    connection = undefined
  },
  terminated() { connection = undefined },
}).catch(error => {
  connection = undefined
  throw error
})
export async function readLibrary() {
  const db = await database()
  const seed = db.transaction(['settings', 'books'], 'readwrite')
  if (!(await seed.objectStore('settings').get('initialized'))) {
    for (const book of samples) await seed.objectStore('books').put(book)
    await seed.objectStore('settings').put(true, 'initialized')
  }
  await seed.done
  const tx = db.transaction(['books', 'collections', 'settings'])
  const [books, collections, preferences] = await Promise.all([
    tx.objectStore('books').getAll(), tx.objectStore('collections').getAll(), tx.objectStore('settings').get('preferences'),
  ])
  return { books, collections, preferences: { ...defaults, ...(typeof preferences === 'object' ? preferences : {}) } }
}
type Change = Parameters<typeof recordKey>[0]
type Journal = Pick<IDBPObjectStore<LibraryDatabase, ['driveRecords'], 'driveRecords', 'readwrite'>, 'get' | 'put'>
async function recordChanges(journal: Journal, changes: Change[], device: string, seed = false) {
  for (const change of changes) {
    const key = recordKey(change)
    const old = await journal.get(key)
    if (old && seed) continue
    const initial =
      change.kind === 'book' ? change.value?.createdAt :
      change.kind === 'position' ? change.value.openedAt : undefined
    await journal.put({ ...change, key, device, clock: Math.max(seed ? initial ?? 1 : Date.now(), (old?.clock ?? 0) + 1) })
  }
}

type DriveSettings = Pick<IDBPObjectStore<LibraryDatabase, ['driveSettings'], 'driveSettings', 'readwrite'>, 'get' | 'put'>
async function deviceId(settings: DriveSettings) {
  const found = await settings.get('device')
  if (typeof found === 'string') return found
  const device = crypto.randomUUID()
  await settings.put(device, 'device')
  return device
}

export async function saveBook(book: Book, file?: Blob) {
  const db = await database()
  const tx = db.transaction(['books', 'files', 'driveRecords', 'driveSettings'], 'readwrite')
  const books = tx.objectStore('books')
  const previous = await books.get(book.id)
  await books.put(book)
  if (file) await tx.objectStore('files').put(file, book.id)
  await recordChanges(tx.objectStore('driveRecords'), recordsForBook(book, previous), await deviceId(tx.objectStore('driveSettings')))
  await tx.done
}
export async function updateBook(id: string, patch: Partial<Book>) {
  const db = await database()
  const tx = db.transaction(['books', 'driveRecords', 'driveSettings'], 'readwrite')
  const books = tx.objectStore('books')
  const book = await books.get(id)
  const updated = book && { ...book, ...patch }
  if (updated) {
    await books.put(updated)
    const changes = recordsForBook(updated, book)
    if (changes.length) await recordChanges(tx.objectStore('driveRecords'), changes, await deviceId(tx.objectStore('driveSettings')))
  }
  await tx.done
  return updated
}
export async function readFile(book: Book, signal?: AbortSignal) {
  if (book.sample) {
    const response = await fetch(book.sample, { signal })
    if (!response.ok) throw new Error('This sample could not be loaded.')
    return response.blob()
  }
  const db = await database()
  const file = await db.get('files', book.id)
  if (file) return file
  if (!book.driveFile) throw new Error('The PDF is missing from local storage.')
  const downloaded = await fetchDriveBook(book.driveFile, signal)
  if (signal?.aborted) throw signal.reason
  const tx = db.transaction(['books', 'files'], 'readwrite')
  try {
    const existing = await tx.objectStore('books').get(book.id)
    if (existing?.driveFile?.account === book.driveFile.account && existing.driveFile.id === book.driveFile.id) {
      await tx.objectStore('files').put(downloaded, book.id)
    }
    await tx.done
  } catch (error) {
    await tx.done.catch(() => undefined)
    if (!(error instanceof DOMException && error.name === 'QuotaExceededError')) throw error
  }
  return downloaded
}
export async function removeBook(id: string) {
  const tx = (await database()).transaction(['books', 'files', 'driveRecords', 'driveSettings'], 'readwrite')
  await tx.objectStore('books').delete(id)
  await tx.objectStore('files').delete(id)
  await recordChanges(tx.objectStore('driveRecords'), [{ kind: 'book', id, value: null }], await deviceId(tx.objectStore('driveSettings')))
  await tx.done
}
export async function saveCollection(collection: Collection) {
  const tx = (await database()).transaction(['collections', 'driveRecords', 'driveSettings'], 'readwrite')
  await tx.objectStore('collections').put(collection)
  await recordChanges(tx.objectStore('driveRecords'), [{ kind: 'collection', id: collection.id, value: collection }], await deviceId(tx.objectStore('driveSettings')))
  await tx.done
}
export async function removeCollection(id: string) {
  const tx = (await database()).transaction(['collections', 'books', 'driveRecords', 'driveSettings'], 'readwrite')
  await tx.objectStore('collections').delete(id)
  const changes: Change[] = [{ kind: 'collection', id, value: null }]
  for await (const cursor of tx.objectStore('books')) {
    if (cursor.value.collectionId === id) {
      const book = { ...cursor.value, collectionId: undefined }
      changes.push(...recordsForBook(book, cursor.value))
      await cursor.update(book)
    }
  }
  await recordChanges(tx.objectStore('driveRecords'), changes, await deviceId(tx.objectStore('driveSettings')))
  await tx.done
}

export async function bindDriveAccount(account: string) {
  const tx = (await database()).transaction(['driveSettings', 'driveRecords', 'books', 'collections'], 'readwrite')
  const settings = tx.objectStore('driveSettings')
  const found = await settings.get('binding')
  if (found && typeof found !== 'string' && found.account !== account) {
    await tx.done
    throw new Error('This library is linked to a different Google account. Connect that account to sync.')
  }
  const binding = { account, device: await deviceId(settings) }
  await settings.put(binding, 'binding')
  const [books, collections] = await Promise.all([tx.objectStore('books').getAll(), tx.objectStore('collections').getAll()])
  await recordChanges(tx.objectStore('driveRecords'), [
    ...books.flatMap(book => recordsForBook(book)),
    ...collections.map(collection => ({ kind: 'collection' as const, id: collection.id, value: collection })),
  ], binding.device, true)
  await tx.done
  return binding
}

export async function readDriveRecords() {
  return (await database()).getAll('driveRecords')
}

export async function readLocalPdf(id: string) {
  return (await database()).get('files', id)
}

export async function applyDriveRecords(binding: DriveBinding, incoming: DriveRecord[], files: ReadonlyMap<string, string>) {
  const tx = (await database()).transaction(['books', 'files', 'collections', 'driveRecords', 'driveSettings'], 'readwrite')
  const current = await tx.objectStore('driveSettings').get('binding')
  if (!current || typeof current === 'string' || current.account !== binding.account || current.device !== binding.device) {
    await tx.done
    throw new Error('The local library changed during sync. Connect Drive again.')
  }
  const journal = tx.objectStore('driveRecords')
  const local = await journal.getAll()
  const before = new Map(local.map(record => [record.key, record]))
  const merged = mergeDriveRecords(local, incoming)
  const changedBooks = new Set<string>()
  const changedCollections = new Set<string>()
  const positions = new Map(merged.flatMap(row => row.kind === 'position' ? [[row.id, row.value] as const] : []))
  const annotations = new Map<string, Book['annotations']>()
  const collections = new Set<string>()
  let changed = false
  for (const row of merged) {
    const isNew = newer(row, before.get(row.key))
    if (isNew) {
      await journal.put(row)
      if (row.kind === 'collection') changedCollections.add(row.id)
      else changedBooks.add(row.id)
    }
    if (row.kind === 'collection') {
      if (row.value) collections.add(row.id)
      if (isNew) {
        changed = true
        const store = tx.objectStore('collections')
        if (row.value) await store.put(row.value)
        else await store.delete(row.id)
      }
    }
    if (row.kind === 'annotation' && row.value) {
      const entries = annotations.get(row.id) ?? []
      entries.push(row.value)
      annotations.set(row.id, entries)
    }
  }
  const books = tx.objectStore('books')
  for (const row of merged) {
    if (row.kind !== 'book') continue
    const previous = await books.get(row.id)
    if (!row.value) {
      if (previous) {
        await books.delete(row.id)
        await tx.objectStore('files').delete(row.id)
        changed = true
      }
      continue
    }
    const fileId = files.get(row.id)
    if (!previous && !fileId && !row.value.sample) continue
    if (previous && !changedBooks.has(row.id) && (!row.value.collectionId || !changedCollections.has(row.value.collectionId)) &&
        (!fileId || previous.driveFile?.id === fileId)) continue
    const position = positions.get(row.id)
    await books.put({
      ...row.value,
      collectionId: row.value.collectionId && collections.has(row.value.collectionId) ? row.value.collectionId : undefined,
      page: Math.min(row.value.pages, position?.page ?? previous?.page ?? 1),
      openedAt: Math.max(position?.openedAt ?? 0, previous?.openedAt ?? 0),
      annotations: annotations.get(row.id) ?? [],
      driveFile: fileId && !row.value.sample ? { id: fileId, account: binding.account } : previous?.driveFile,
    })
    changed = true
  }
  await tx.done
  return { records: merged, changed }
}
export async function savePreferences(preferences: Preferences) {
  await (await database()).put('settings', preferences, 'preferences')
}
export async function clearLibrary() {
  const tx = (await database()).transaction(['books', 'files', 'collections', 'settings', 'driveRecords', 'driveSettings'], 'readwrite')
  for (const store of ['books', 'files', 'collections', 'settings', 'driveRecords', 'driveSettings'] as const) await tx.objectStore(store).clear()
  await tx.objectStore('settings').put(true, 'initialized')
  await tx.done
}
