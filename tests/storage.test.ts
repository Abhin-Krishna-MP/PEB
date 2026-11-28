import 'fake-indexeddb/auto'
import { expect, it } from 'vitest'
import { clearLibrary, readFile, readLibrary, removeBook, removeCollection, saveBook, saveCollection, savePreferences, updateBook } from '../src/lib/storage'
import { defaults } from '../src/lib/model'
import { samples } from '../src/lib/samples'

it('stores PDFs and reading state and removes all their records on deletion', async () => {
  expect((await readLibrary()).books).toHaveLength(samples.length)
  const book = { ...samples[0], id: 'my-pdf', title: 'My PDF', sample: undefined, collectionId: 'research' }
  await saveCollection({ id: 'research', name: 'Research' })
  const blob = new Blob(['%PDF-1.7 local contents'], { type: 'application/pdf' })
  await saveBook(book, blob)
  await Promise.all([
    updateBook(book.id, { page: 8 }),
    updateBook(book.id, { favorite: true }),
  ])
  const stored = (await readLibrary()).books.find(item => item.id === book.id)
  expect(stored).toMatchObject({ page: 8, favorite: true, collectionId: 'research' })
  expect(await (await readFile(book)).text()).toBe(await blob.text())
  await removeCollection('research')
  expect((await readLibrary()).books.find(item => item.id === book.id)?.collectionId).toBeUndefined()
  await savePreferences({ ...defaults, theme: 'Sepia' })
  expect((await readLibrary()).preferences.theme).toBe('Sepia')
  await removeBook(book.id)
  await expect(readFile(book)).rejects.toThrow('missing from local storage')
  await clearLibrary()
  expect(await readLibrary()).toEqual({ books: [], collections: [], preferences: defaults })
})

it('merges synced progress and independent notes without reauthoring received records', async () => {
  const { bindDriveAccount, applyDriveRecords, readDriveRecords } = await import('../src/lib/storage')
  await clearLibrary()
  const book = { ...samples[0], id: 'sync-book', title: 'Sync example', sample: undefined, page: 2 }
  await saveBook(book, new Blob(['%PDF-1.7']))
  const binding = await bindDriveAccount('reader')
  const device = 'second-device'
  await updateBook(book.id, { annotations: [{ id: 'local-note', page: 2, kind: 'note', text: 'Local note' }] })
  const clock = Date.now() + 1000
  await applyDriveRecords(binding, [
    { key: 'position/sync-book', kind: 'position', id: book.id, value: { page: 8, openedAt: clock }, clock, device },
    { key: 'annotation/sync-book/remote-note', kind: 'annotation', id: book.id, annotation: 'remote-note',
      value: { id: 'remote-note', page: 8, kind: 'note', text: 'Remote note' }, clock, device },
  ], new Map([[book.id, 'drive-pdf']]))
  const stored = (await readLibrary()).books.find(item => item.id === book.id)
  expect(stored).toMatchObject({ page: 8, driveFile: { id: 'drive-pdf', account: 'reader' } })
  expect(stored?.annotations.map(note => note.text)).toEqual(['Local note', 'Remote note'])
  expect((await readDriveRecords()).find(row => row.key === 'position/sync-book')?.device).toBe(device)
  await expect(bindDriveAccount('different-reader')).rejects.toThrow('different Google account')
  await clearLibrary()
  expect(await readDriveRecords()).toHaveLength(0)
  expect((await bindDriveAccount('different-reader')).account).toBe('different-reader')
  await clearLibrary()
})
