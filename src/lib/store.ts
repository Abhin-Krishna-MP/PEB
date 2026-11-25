import { create } from 'zustand'
import { defaults, type Book, type Collection, type Preferences } from './model'
import * as storage from './storage'

interface LibraryState {
  books: Book[]
  collections: Collection[]
  preferences: Preferences
  ready: boolean
  init: () => Promise<void>
  add: (book: Book, file: Blob) => Promise<void>
  edit: (id: string, patch: Partial<Book>) => Promise<void>
  closeBook: (id: string) => Promise<void>
  collect: (collection: Collection) => Promise<void>
  deleteCollection: (id: string) => Promise<void>
  configure: (patch: Partial<Preferences>) => Promise<void>
  clear: () => Promise<void>
}
export const useLibrary = create<LibraryState>((set, get) => ({
  books: [], collections: [], preferences: defaults, ready: false,
  async init() { set({ ...(await storage.readLibrary()), ready: true }) },
  async add(book, file) {
    await storage.saveBook(book, file)
    set(state => ({ books: [...state.books, book] }))
  },
  async edit(id, patch) {
    if (await storage.updateBook(id, patch)) {
      set(state => ({ books: state.books.map(item => item.id === id ? { ...item, ...patch } : item) }))
    }
  },
  async closeBook(id) {
    await storage.removeBook(id)
    set(state => ({ books: state.books.filter(book => book.id !== id) }))
  },
  async collect(collection) {
    await storage.saveCollection(collection)
    set(state => ({ collections: [...state.collections.filter(item => item.id !== collection.id), collection] }))
  },
  async deleteCollection(id) {
    await storage.removeCollection(id)
    set(state => ({
      books: state.books.map(book => book.collectionId === id ? { ...book, collectionId: undefined } : book),
      collections: state.collections.filter(item => item.id !== id),
    }))
  },
  async configure(patch) {
    const preferences = { ...get().preferences, ...patch }
    set({ preferences })
    await storage.savePreferences(preferences)
  },
  async clear() {
    await storage.clearLibrary()
    set({ books: [], collections: [], preferences: defaults })
  },
}))
