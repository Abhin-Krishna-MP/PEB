import { openDB, type DBSchema } from 'idb'
import { defaults, type Book, type Collection, type Preferences } from './model'
import { samples } from './samples'

interface LibraryDatabase extends DBSchema {
  books: { key: string; value: Book }
  files: { key: string; value: Blob }
  collections: { key: string; value: Collection }
  settings: { key: string; value: Preferences | boolean }
}
let connection: ReturnType<typeof openDB<LibraryDatabase>> | undefined
const database = () => connection ??= openDB<LibraryDatabase>('folio-library', 1, {
  upgrade(db) {
    db.createObjectStore('books', { keyPath: 'id' })
    db.createObjectStore('files')
    db.createObjectStore('collections', { keyPath: 'id' })
    db.createObjectStore('settings')
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
export async function saveBook(book: Book, file?: Blob) {
  const db = await database()
  const tx = db.transaction(['books', 'files'], 'readwrite')
  await tx.objectStore('books').put(book)
  if (file) await tx.objectStore('files').put(file, book.id)
  await tx.done
}
export async function updateBook(id: string, patch: Partial<Book>) {
  const db = await database()
  const tx = db.transaction('books', 'readwrite')
  const book = await tx.store.get(id)
  if (book) await tx.store.put({ ...book, ...patch })
  await tx.done
  return book ? { ...book, ...patch } : undefined
}
export async function readFile(book: Book, signal?: AbortSignal) {
  if (book.sample) {
    const response = await fetch(book.sample, { signal })
    if (!response.ok) throw new Error('This sample could not be loaded.')
    return response.blob()
  }
  const file = await (await database()).get('files', book.id)
  if (!file) throw new Error('The PDF is missing from local storage.')
  return file
}
export async function removeBook(id: string) {
  const tx = (await database()).transaction(['books', 'files'], 'readwrite')
  await tx.objectStore('books').delete(id)
  await tx.objectStore('files').delete(id)
  await tx.done
}
export async function saveCollection(collection: Collection) {
  await (await database()).put('collections', collection)
}
export async function removeCollection(id: string) {
  const tx = (await database()).transaction(['collections', 'books'], 'readwrite')
  await tx.objectStore('collections').delete(id)
  for await (const cursor of tx.objectStore('books')) {
    if (cursor.value.collectionId === id) await cursor.update({ ...cursor.value, collectionId: undefined })
  }
  await tx.done
}
export async function savePreferences(preferences: Preferences) {
  await (await database()).put('settings', preferences, 'preferences')
}
export async function clearLibrary() {
  const tx = (await database()).transaction(['books', 'files', 'collections', 'settings'], 'readwrite')
  for (const store of ['books', 'files', 'collections', 'settings'] as const) await tx.objectStore(store).clear()
  await tx.objectStore('settings').put(true, 'initialized')
  await tx.done
}
