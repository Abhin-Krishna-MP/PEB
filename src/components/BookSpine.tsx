import { BookOpen, Code2, Database, GitFork, Settings2, Sigma, Wifi } from 'lucide-react'
import type { Book } from '../lib/model'

const editions = [
  { color: 'wine', icon: GitFork },
  { color: 'parchment', icon: Database },
  { color: 'forest', icon: Settings2 },
  { color: 'navy', icon: Wifi },
  { color: 'plum', icon: Sigma },
  { color: 'indigo', icon: Code2 },
]

export default function BookSpine({ book }: { book: Book }) {
  const index = book.art ?? Array.from(book.id).reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % editions.length
  const { color, icon } = editions[index % editions.length]
  const Icon = book.art === undefined ? BookOpen : icon
  return <span className={`book-spine spine-${color}`} aria-hidden="true">
    <strong>{book.title}</strong>
    <Icon size={24} strokeWidth={1.45} />
  </span>
}
