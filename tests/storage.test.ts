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
