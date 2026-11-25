import type { Book } from './model'

export const samples: Book[] = [
  ['algorithms', 'Algorithms & Data Structures', 'COMPUTER SCIENCE', 48],
  ['database', 'Database Systems', 'DATABASES', 24],
  ['operating', 'Operating Systems', 'COMPUTER SCIENCE', 32],
  ['networks', 'Computer Networks', 'NETWORKING', 28],
  ['discrete', 'Discrete Mathematics', 'MATHEMATICS', 20],
  ['compiler', 'Compiler Design', 'PROGRAMMING', 24],
].map(([id, title, category, pages], art) => ({
  id: String(id), title: String(title), category: String(category), pages: Number(pages), art,
  cover: '/covers/' + id + '.webp', sample: '/samples/' + id + '.pdf',
  createdAt: Date.UTC(2025, 0, 10) - art * 1000,
  openedAt: art === 0 ? 1 : 0, page: art === 0 ? 12 : 1, favorite: false, size: 0, annotations: [],
}))
