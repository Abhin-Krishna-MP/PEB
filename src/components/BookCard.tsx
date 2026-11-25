import { memo, useState } from 'react'
import { BookOpen, Bookmark, Ellipsis, Folder, Heart, Pencil, Trash2 } from 'lucide-react'
import { fileSize, progress, type Book, type LibraryLayout } from '../lib/model'
import BookSpine from './BookSpine'
import { Cover } from './Common'

export type BookAction = 'rename' | 'move' | 'delete'

interface Props {
  book: Book
  layout: LibraryLayout
  menuOpen: boolean
  warmReader: () => void
  open: (book: Book) => void
  favorite: (book: Book) => void
  toggleMenu: (id: string) => void
  closeMenu: () => void
  act: (kind: BookAction, book: Book) => void
}

export default memo(function BookCard({ book, layout, menuOpen, warmReader, open, favorite, toggleMenu, closeMenu, act }: Props) {
  const [menuAtStart, setMenuAtStart] = useState(false)
  const shelves = layout === 'shelves'
  const readProgress = progress(book)

  return <article className="book-card">
    <div className={`book-stage ${book.art === undefined ? 'stage-imported' : 'stage-' + book.art}`}>
      <button className="cover-button" onPointerEnter={warmReader} onFocus={warmReader} onClick={() => open(book)} aria-label={'Open ' + book.title} title={shelves ? `${book.title} · ${book.pages} pages` : undefined}>
        {shelves ? <BookSpine book={book} /> : <Cover book={book} lazy />}
      </button>
      <button className={`heart-button ${book.favorite ? 'hearted' : ''}`} aria-label={`${book.favorite ? 'Remove from favorites' : 'Add to favorites'}: ${book.title}`} aria-pressed={book.favorite} onClick={() => favorite(book)}><Heart size={16} /></button>
    </div>
    <div className="card-meta">
      {!shelves && <div className="card-description">
        <button className="book-title" onPointerEnter={warmReader} onFocus={warmReader} onClick={() => open(book)}>{book.title}</button>
        <div className="book-details">
          <span>{book.pages} pages</span><i /><span>{book.size ? fileSize(book.size) : 'Sample PDF'}</span>
          {book.annotations.some(entry => entry.kind === 'bookmark') && <Bookmark size={13} aria-label="Bookmarked" />}
        </div>
        {layout === 'list' && book.openedAt > 1 && <div className="book-details">Opened {new Date(book.openedAt).toLocaleDateString()} · {readProgress}% read</div>}
        {book.openedAt > 0 && <div className="card-progress" title={readProgress + '% read'}><i style={{ width: readProgress + '%' }} /></div>}
      </div>}
      <div className="card-menu">
        <button className="icon-button" aria-label={'Options for ' + book.title} aria-expanded={menuOpen} onClick={event => {
          if (shelves && !menuOpen) {
            const shelf = event.currentTarget.closest('.shelves')
            const { left, right } = event.currentTarget.getBoundingClientRect()
            setMenuAtStart(!!shelf && right - shelf.getBoundingClientRect().left < 180 && document.documentElement.clientWidth - left >= 180)
          }
          toggleMenu(book.id)
        }}><Ellipsis size={19} /></button>
        {menuOpen && <>
          <button className="menu-scrim" aria-label="Close book options" onClick={closeMenu} />
          <div className={`dropdown ${shelves && menuAtStart ? 'from-start' : ''}`}>
            <button onClick={() => open(book)}><BookOpen size={16} /> Open book</button>
            {shelves && <button onClick={() => { closeMenu(); favorite(book) }}><Heart size={16} /> {book.favorite ? 'Remove from favorites' : 'Add to favorites'}</button>}
            <button onClick={() => act('rename', book)}><Pencil size={16} /> Rename</button>
            <button onClick={() => act('move', book)}><Folder size={16} /> Move to collection</button>
            <button className="danger" onClick={() => act('delete', book)}><Trash2 size={16} /> Delete</button>
          </div>
        </>}
      </div>
    </div>
  </article>
})
