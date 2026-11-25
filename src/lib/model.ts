export type Theme = 'Original' | 'Light' | 'Sepia' | 'Dark'
export type Mode = 'Auto' | 'Single page' | 'Double page' | 'Scroll'
export type Fit = 'Fit page' | 'Fit width'
export type Annotation = {
  id: string
  page: number
  kind: 'bookmark' | 'note' | 'highlight'
  text: string
  boxes?: { x: number; y: number; width: number; height: number }[]
}
export type Book = {
  id: string
  title: string
  category: string
  pages: number
  size: number
  cover: string
  sample?: string
  art?: number
  createdAt: number
  openedAt: number
  page: number
  favorite: boolean
  annotations: Annotation[]
  collectionId?: string
}
export type Collection = { id: string; name: string }
export type Preferences = {
  theme: Theme
  appearance: 'Dark' | 'Light' | 'System'
  mode: Mode
  animation: boolean
  reducedMotion: boolean
  zoom: number
  fit: Fit
}
export const defaults: Preferences = {
  theme: 'Original', appearance: 'Dark', mode: 'Auto', animation: true, reducedMotion: false, zoom: 100, fit: 'Fit page',
}
export const progress = (book: Book) => book.openedAt ? Math.round(book.page / Math.max(1, book.pages) * 100) : 0
export function fileSize(bytes: number) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}
