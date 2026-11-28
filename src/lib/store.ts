import { create } from 'zustand'
import { defaults, type Book, type Collection, type Preferences } from './model'
import type { DriveBinding, DriveRecord } from './driveRecords'
import * as storage from './storage'

interface LibraryState {
  books: Book[]
  collections: Collection[]
  preferences: Preferences
  ready: boolean
  localRevision: number
  init: () => Promise<void>
  add: (book: Book, file: Blob) => Promise<void>
  edit: (id: string, patch: Partial<Book>) => Promise<void>
  closeBook: (id: string) => Promise<void>
  collect: (collection: Collection) => Promise<void>
  deleteCollection: (id: string) => Promise<void>
  configure: (patch: Partial<Preferences>) => Promise<void>
  clear: () => Promise<void>
  mergeDrive: (binding: DriveBinding, records: DriveRecord[], files: ReadonlyMap<string, string>, signal: AbortSignal) => Promise<DriveRecord[]>
}

let pending = Promise.resolve()
function write<T>(operation: () => Promise<T>) {
  const result = pending.then(operation)
  pending = result.then(() => undefined, () => undefined)
  return result
}

export const useLibrary = create<LibraryState>((set, get) => ({
  books: [], collections: [], preferences: defaults, ready: false, localRevision: 0,
  async init() { set({ ...(await storage.readLibrary()), ready: true }) },
  add: (book, file) => write(async () => {
    await storage.saveBook(book, file)
    set(state => ({ books: [...state.books, book], localRevision: state.localRevision + 1 }))
  }),
  edit: (id, patch) => write(async () => {
    const updated = await storage.updateBook(id, patch)
    if (updated) set(state => ({
      books: state.books.map(item => item.id === id ? { ...item, ...patch } : item),
      localRevision: state.localRevision + 1,
    }))
  }),
  closeBook: id => write(async () => {
    await storage.removeBook(id)
    set(state => ({ books: state.books.filter(book => book.id !== id), localRevision: state.localRevision + 1 }))
  }),
  collect: collection => write(async () => {
    await storage.saveCollection(collection)
    set(state => ({ collections: [...state.collections.filter(item => item.id !== collection.id), collection], localRevision: state.localRevision + 1 }))
  }),
  deleteCollection: id => write(async () => {
    await storage.removeCollection(id)
    set(state => ({
      books: state.books.map(book => book.collectionId === id ? { ...book, collectionId: undefined } : book),
      collections: state.collections.filter(item => item.id !== id),
      localRevision: state.localRevision + 1,
    }))
  }),
  configure: patch => write(async () => {
    const preferences = { ...get().preferences, ...patch }
    set({ preferences })
    await storage.savePreferences(preferences)
  }),
  clear: () => write(async () => {
    await storage.clearLibrary()
    set({ books: [], collections: [], preferences: defaults })
  }),
  mergeDrive: (binding, records, files, signal) => write(async () => {
    signal.throwIfAborted()
    const merged = await storage.applyDriveRecords(binding, records, files)
    if (merged.changed) {
      const { books, collections } = await storage.readLibrary()
      set({ books, collections })
    }
    return merged.records
  }),
}))
