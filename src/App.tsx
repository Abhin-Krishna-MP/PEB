import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react'
import {
  ArrowDownUp, ArrowRight, BookOpen, Bookmark, Check, ChevronDown, Clock3, Database, Download, Ellipsis,
  FileUp, Folder, Heart, LayoutGrid, LibraryBig, List, Menu, Moon, Pencil, Plus, Search, Settings as SettingsIcon,
  ShieldCheck, Sun, Trash2, WifiOff, X,
} from 'lucide-react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { Cover, Logo, Modal } from './components/Common'
import Settings from './components/Settings'
import BookSpine from './components/BookSpine'
import { fileSize, progress, type Book } from './lib/model'
import { useLibrary } from './lib/store'
import type { PasswordRequest } from './lib/pdf'

const Reader = lazy(() => import('./components/Reader'))
const navigation = [
  { key: 'library', label: 'Library', icon: LibraryBig },
  { key: 'collections', label: 'Collections', icon: Folder },
  { key: 'favorites', label: 'Favorites', icon: Heart },
  { key: 'recent', label: 'Recently opened', icon: Clock3 },
]
const heading: Record<string, string> = {
  library: 'My Library', collections: 'Collections', favorites: 'Favorites', recent: 'Recently opened', settings: 'Settings',
}
type Dialog = { kind: 'upload' | 'install' | 'clear' | 'collection' } | { kind: 'delete' | 'rename' | 'move'; book: Book } | { kind: 'deleteCollection'; id: string }
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
const currentBook = () => window.location.hash.slice(1) || null

export default function App() {
  const { books, collections, preferences, ready, init, add, edit, closeBook, collect, deleteCollection, clear, configure } = useLibrary()
  const [systemLight, setSystemLight] = useState(() => matchMedia('(prefers-color-scheme: light)').matches)
  const lightAppearance = preferences.appearance === 'Light' || (preferences.appearance === 'System' && systemLight)
  useEffect(() => {
    const scheme = matchMedia('(prefers-color-scheme: light)')
    const change = () => setSystemLight(scheme.matches)
    scheme.addEventListener('change', change)
    return () => scheme.removeEventListener('change', change)
  }, [])
  const [view, setView] = useState('library')
  const [active, setActive] = useState(currentBook)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('added')
  const layout = preferences.libraryLayout
  const onShelves = layout === 'shelves'
  const [menu, setMenu] = useState<string>()
  const [menuAtStart, setMenuAtStart] = useState(false)
  const [mobile, setMobile] = useState(false)
  const [dialog, setDialog] = useState<Dialog>()
  const [message, setMessage] = useState('')
  const [upload, setUpload] = useState('')
  const [dragging, setDragging] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt>()
  const [usage, setUsage] = useState(0)
  const [quota, setQuota] = useState(0)
  const [password, setPassword] = useState<{ incorrect: boolean; resolve: (value: string | null) => void }>()
  const search = useRef<HTMLInputElement>(null)
  const files = useRef<HTMLInputElement>(null)
  const toastTimer = useRef<number>(0)
  const importing = useRef(false)
  const importUnlock = useRef<{ id: string; value: string } | null>(null)
  const { needRefresh: [updates], updateServiceWorker } = useRegisterSW()
  const activeBook = books.find(book => book.id === active)

  function toast(text: string) {
    setMessage(text)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setMessage(''), 4400)
  }
  useEffect(() => { void init().catch(() => toast('Local storage could not be opened. Check your browser settings.')) }, [init])
  useEffect(() => {
    const onHash = () => setActive(currentBook())
    const onConnection = () => setOnline(navigator.onLine)
    const onInstall = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPrompt) }
    const onForeground = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        void navigator.serviceWorker?.getRegistration().then(registration => registration?.update()).catch(() => undefined)
      }
    }
    const onKeys = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !currentBook()) {
        event.preventDefault()
        search.current?.focus()
      }
      if (event.key === 'Escape') setMenu(undefined)
    }
    window.addEventListener('hashchange', onHash)
    window.addEventListener('online', onConnection)
    window.addEventListener('offline', onConnection)
    window.addEventListener('beforeinstallprompt', onInstall)
    window.addEventListener('keydown', onKeys)
    document.addEventListener('visibilitychange', onForeground)
    return () => {
      window.removeEventListener('hashchange', onHash)
      window.removeEventListener('online', onConnection)
      window.removeEventListener('offline', onConnection)
      window.removeEventListener('beforeinstallprompt', onInstall)
      window.removeEventListener('keydown', onKeys)
      document.removeEventListener('visibilitychange', onForeground)
    }
  }, [])
  useEffect(() => {
    void navigator.storage?.estimate?.().then(value => {
      setUsage(value.usage ?? 0)
      setQuota(value.quota ?? 0)
    }).catch(() => undefined)
  }, [books.length])
  const askPassword: PasswordRequest = incorrect => new Promise(resolve => setPassword({ incorrect, resolve }))
  const unlockBook: PasswordRequest = incorrect => {
    const remembered = importUnlock.current
    importUnlock.current = null
    if (!incorrect && remembered?.id === active) return Promise.resolve(remembered.value)
    return askPassword(incorrect)
  }
  function resolvePassword(value: string | null) {
    password?.resolve(value)
    setPassword(undefined)
  }
  function openBook(book: Book) {
    setMenu(undefined)
    setActive(book.id)
    window.location.hash = book.id
    persist(edit(book.id, { openedAt: Date.now() }))
  }
  function exitReader() {
    importUnlock.current = null
    history.replaceState(null, '', location.pathname + location.search)
    setActive(null)
  }
  function navigate(key: string) {
    setView(key)
    setQuery('')
    setMenu(undefined)
    setMobile(false)
  }
  function persist(task: Promise<void>, success?: string) {
    void task.then(() => { if (success) toast(success) }).catch(() => toast('Could not save the change to this device.'))
  }
  async function importFiles(selected: FileList | File[]) {
    if (importing.current || !selected.length || !ready) return
    importing.current = true
    setDialog(undefined)
    const added: Book[] = []
    const errors: string[] = []
    try {
      const { inspectPdf } = await import('./lib/pdf')
      const list = Array.from(selected)
      for (const [index, file] of list.entries()) {
        const step = list.length > 1 ? ` (${index + 1}/${list.length})` : ''
        try {
          setUpload('Opening PDF…' + step)
          let unlocked: string | null = null
          const book = await inspectPdf(file, async incorrect => {
            unlocked = await askPassword(incorrect)
            return unlocked
          }, text => setUpload(text + step))
          setUpload('Saving to your device…' + step)
          await add(book, file)
          added.push(book)
          if (list.length === 1 && unlocked !== null) importUnlock.current = { id: book.id, value: unlocked }
        } catch (error) {
          const detail = error instanceof Error ? error.message : 'This PDF could not be imported.'
          const reason = error instanceof DOMException && error.name === 'QuotaExceededError' ? 'Your device is out of browser storage.' : detail
          errors.push(`${file.name}: ${reason}`)
        }
      }
      if (added.length) navigate('library')
      if (errors.length) toast(errors.join(' '))
      else if (added.length === 1) openBook(added[0])
      else toast(`${added.length} PDFs added to your library.`)
    } catch {
      toast('The PDF engine could not be loaded. Try reloading Folio.')
    } finally {
      importing.current = false
      setUpload('')
      if (files.current) files.current.value = ''
    }
  }
  async function install() {
    if (!installPrompt) { setDialog({ kind: 'install' }); return }
    try {
      await installPrompt.prompt()
      const { outcome } = await installPrompt.userChoice
      if (outcome === 'accepted') toast('Folio was installed.')
    } catch { setDialog({ kind: 'install' }) }
    setInstallPrompt(undefined)
  }

  const collection = collections.find(item => item.id === view)
  const recent = books.filter(book => book.openedAt).sort((a, b) => b.openedAt - a.openedAt)
  const feature = recent[0]
  const rows = books.filter(book => {
    if (query.trim()) return `${book.title} ${book.category}`.toLowerCase().includes(query.trim().toLowerCase())
    if (view === 'favorites') return book.favorite
    if (view === 'recent') return book.openedAt
    if (collection) return book.collectionId === view
    return true
  }).sort((a, b) => {
    if (sort === 'title') return a.title.localeCompare(b.title)
    if (sort === 'pages') return b.pages - a.pages || a.title.localeCompare(b.title)
    if (sort === 'recent' || view === 'recent') return b.openedAt - a.openedAt
    return b.createdAt - a.createdAt
  })
  const showFeature = view === 'library' && !query.trim() && feature
  const showCollections = view === 'collections' && !query.trim()

  function handleDialog(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!dialog) return
    const value = String(new FormData(event.currentTarget).get('name') ?? '').trim()
    if (dialog.kind === 'rename' && value) persist(edit(dialog.book.id, { title: value }), 'Book renamed.')
    if (dialog.kind === 'collection' && value) {
      const id = crypto.randomUUID()
      persist(collect({ id, name: value }).then(() => navigate(id)), 'Collection created.')
    }
    if (dialog.kind === 'move') persist(edit(dialog.book.id, { collectionId: value || undefined }), 'Collection updated.')
    if (dialog.kind === 'delete') persist(closeBook(dialog.book.id), 'Book removed.')
    if (dialog.kind === 'deleteCollection') persist(deleteCollection(dialog.id).then(() => navigate('collections')), 'Collection removed.')
    if (dialog.kind === 'clear') persist(clear().then(() => navigate('library')), 'Local library cleared.')
    setDialog(undefined)
  }

  return <div className={`app appearance-${lightAppearance ? 'light' : 'dark'} ${preferences.reducedMotion ? 'reduce-motion' : ''}`} onDragOver={event => {
    if (event.dataTransfer.types.includes('Files') && !activeBook) { event.preventDefault(); setDragging(true) }
  }}>
    <input type="file" accept="application/pdf,.pdf" multiple hidden ref={files} onChange={event => { if (event.target.files) void importFiles(event.target.files) }} />
    {activeBook ? <Suspense fallback={<div className="center-screen">Opening your book…</div>}><Reader key={activeBook.id} book={activeBook} close={exitReader} password={unlockBook} toast={toast} /></Suspense> :
      <div className="shell">
        {mobile && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobile(false)} />}
        <aside className={`sidebar ${mobile ? 'sidebar-open' : ''}`}>
          <button className="brand-button" onClick={() => navigate('library')} aria-label="Folio library"><Logo /></button>
          <div className="side-content">
            <div className="nav-label">WORKSPACE</div>
            <nav aria-label="Main navigation">
              {navigation.map(({ key, label, icon: Icon }) => <button key={key} className={`nav-item ${view === key ? 'selected' : ''}`} aria-current={view === key ? 'page' : undefined} onClick={() => navigate(key)}>
                <Icon size={18} strokeWidth={1.7} /><span>{label}</span>{key === 'library' && <small>{books.length}</small>}
              </button>)}
            </nav>
            <div className="sidebar-collections">
              <div className="nav-label collection-label">COLLECTIONS
                {collections.length > 0 && <button className="icon-button" aria-label="New collection" title="New collection" onClick={() => setDialog({ kind: 'collection' })}><Plus size={16} /></button>}
              </div>
              {collections.length ? <nav aria-label="Your collections">{collections.map(item => <button className={`nav-item ${view === item.id ? 'selected' : ''}`} aria-current={view === item.id ? 'page' : undefined} key={item.id} onClick={() => navigate(item.id)}><Folder size={17} /><span>{item.name}</span></button>)}</nav> :
                <button className="create-link" onClick={() => setDialog({ kind: 'collection' })}><Plus size={16} /> New collection</button>}
            </div>
          </div>
          <div className="sidebar-foot">
            <button className={`nav-item ${view === 'settings' ? 'selected' : ''}`} aria-current={view === 'settings' ? 'page' : undefined} onClick={() => navigate('settings')}><SettingsIcon size={18} strokeWidth={1.7} /><span>Settings</span></button>
            <div className="storage-card">
              <div className="storage-title"><Database size={15} /><strong>Local storage</strong><small>{fileSize(usage)} used</small></div>
              <div className="storage-meter"><i style={{ width: usage && quota ? Math.min(100, Math.max(2, usage / quota * 100)) + '%' : '0%' }} /></div>
            </div>
          </div>
        </aside>
        <div className="workspace">
          <header className="topbar">
            <div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobile(true)}><Menu size={21} /></button><span>Workspace</span><span className="breadcrumb-slash">/</span><strong>{collection?.name ?? (view === 'library' ? 'Library' : heading[view])}</strong></div>
            <div className="top-actions">
              <label className="search-box"><Search size={17} /><input ref={search} placeholder="Search your library…" aria-label="Search your library" value={query} onChange={event => { setQuery(event.target.value); if (view === 'settings') setView('library') }} />
                {query ? <button className="icon-button" aria-label="Clear search" onClick={() => setQuery('')}><X size={15} /></button> : <kbd>Ctrl K</kbd>}</label>
              <button className="icon-button" aria-label={lightAppearance ? 'Switch to dark appearance' : 'Switch to light appearance'} title={lightAppearance ? 'Switch to dark appearance' : 'Switch to light appearance'} onClick={() => persist(configure({ appearance: lightAppearance ? 'Dark' : 'Light' }))}>
                {lightAppearance ? <Moon size={18} /> : <Sun size={18} />}
              </button>
              <button className="primary-button upload-button" onClick={() => setDialog({ kind: 'upload' })} disabled={!ready || !!upload}><FileUp size={17} /><span>Upload PDF</span></button>
            </div>
          </header>
          <main className="main-content">
            {view === 'settings' ? <Settings install={() => void install()} clear={() => setDialog({ kind: 'clear' })} usage={usage} quota={quota} toast={toast} /> :
              <>
                <div className="page-heading"><div><h1>{query.trim() ? 'Search results' : collection?.name ?? heading[view]}</h1><p className="intro">{query.trim() ? `Books matching “${query.trim()}”` : view === 'library' ? 'A quiet place for everything you read.' : view === 'recent' ? 'Pick up a book you’ve opened before.' : view === 'favorites' ? 'Keep the books you love close at hand.' : 'Organize your books into reading collections.'}</p></div>
                  {view === 'library' && !query && <span className="private-pill">{online ? <ShieldCheck size={15} /> : <WifiOff size={15} />}{online ? 'Private & local' : 'Offline'}</span>}
                  {collection && <button className="icon-button danger" aria-label="Delete collection" onClick={() => setDialog({ kind: 'deleteCollection', id: collection.id })}><Trash2 size={18} /></button>}
                </div>
                {showFeature && <section className="feature" aria-label="Continue reading" style={{ '--feature-art': `url("${feature.cover}")` } as React.CSSProperties}>
                  <div className="feature-content">
                    <div className="eyebrow"><BookOpen size={16} /> CONTINUE READING</div>
                    <h2>{feature.title}</h2>
                    <div className="feature-status"><span>Page {feature.page} of {feature.pages}</span><span className="separator-dot" /><span>{progress(feature)}% complete</span></div>
                    <div className="feature-meter" role="progressbar" aria-label="Reading progress" aria-valuenow={progress(feature)}><i style={{ width: progress(feature) + '%' }} /></div>
                    <button className="primary-button resume" onClick={() => openBook(feature)}>Resume reading <ArrowRight size={17} /></button>
                  </div>
                  <div className="feature-visual"><Cover book={feature} /></div>
                </section>}
                {showCollections ? <section className="collection-grid" aria-label="Collections">
                  {collections.map(item => <button className="collection-card" key={item.id} onClick={() => navigate(item.id)}><Folder size={25} /><strong>{item.name}</strong><span>{books.filter(book => book.collectionId === item.id).length} books</span></button>)}
                  <button className="collection-card new" onClick={() => setDialog({ kind: 'collection' })}><Plus size={25} /><strong>New collection</strong></button>
                </section> : <section className="shelf" aria-label="Bookshelf">
                  <div className="shelf-header">
                    <div className="shelf-title"><h2>{view === 'library' && !query ? 'Bookshelf' : 'Books'}</h2><span>{rows.length} {rows.length === 1 ? 'book' : 'books'}</span></div>
                    <div className="shelf-controls">
                      <label className="sort"><ArrowDownUp size={15} /><select aria-label="Sort books" value={sort} onChange={event => setSort(event.target.value)}><option value="added">Recently added</option><option value="recent">Last opened</option><option value="title">Title A–Z</option><option value="pages">Page count</option></select><ChevronDown size={14}/></label>
                      <div className="view-toggle" role="group" aria-label="Library layout">
                        <button className={layout === 'grid' ? 'on' : ''} aria-label="Grid view" title="Grid view" aria-pressed={layout === 'grid'} onClick={() => persist(configure({ libraryLayout: 'grid' }))}><LayoutGrid size={16} /></button>
                        <button className={layout === 'list' ? 'on' : ''} aria-label="List view" title="List view" aria-pressed={layout === 'list'} onClick={() => persist(configure({ libraryLayout: 'list' }))}><List size={17} /></button>
                        <button className={onShelves ? 'on' : ''} aria-label="Wooden shelf view" title="Wooden shelf view" aria-pressed={onShelves} onClick={() => persist(configure({ libraryLayout: 'shelves' }))}><LibraryBig size={17} /></button>
                      </div>
                    </div>
                  </div>
                  {!ready && <div className="empty">Loading your library…</div>}
                  {ready && !rows.length && <div className="empty"><BookOpen size={30} /><h3>{query ? 'No matching books' : view === 'favorites' ? 'No favorites yet' : view === 'recent' ? 'No books opened yet' : 'No books here yet'}</h3>
                    <p>{query ? 'Try another title or category.' : view === 'favorites' ? 'Use the heart on any book to save it here.' : collection ? 'Use a book’s menu to move it into this collection.' : 'Upload a PDF to start reading.'}</p>
                    {!query && view === 'library' && <button className="primary-button" onClick={() => setDialog({ kind: 'upload' })}><FileUp size={16} /> Upload PDF</button>}
                  </div>}
                  <div className={`books ${layout}`} hidden={!rows.length}>{rows.map(book => <article className="book-card" key={book.id}>
                    <div className={`book-stage ${book.art === undefined ? 'stage-imported' : 'stage-' + book.art}`}>
                      <button className="cover-button" onClick={() => openBook(book)} aria-label={'Open ' + book.title} title={onShelves ? `${book.title} · ${book.pages} pages` : undefined}>
                        {onShelves ? <BookSpine book={book} /> : <Cover book={book} />}
                      </button>
                      <button className={`heart-button ${book.favorite ? 'hearted' : ''}`} aria-label={`${book.favorite ? 'Remove from favorites' : 'Add to favorites'}: ${book.title}`} aria-pressed={book.favorite} onClick={() => persist(edit(book.id, { favorite: !book.favorite }))}><Heart size={16} /></button>
                    </div>
                    <div className="card-meta">{!onShelves && <div className="card-description"><button className="book-title" onClick={() => openBook(book)}>{book.title}</button><div className="book-details"><span>{book.pages} pages</span><i /><span>{book.size ? fileSize(book.size) : 'Sample PDF'}</span>{book.annotations.some(entry => entry.kind === 'bookmark') && <Bookmark size={13} aria-label="Bookmarked" />}</div>
                      {layout === 'list' && book.openedAt > 1 && <div className="book-details">Opened {new Date(book.openedAt).toLocaleDateString()} · {progress(book)}% read</div>}
                      {book.openedAt > 0 && <div className="card-progress" title={progress(book) + '% read'}><i style={{ width: progress(book) + '%' }} /></div>}
                    </div>}<div className="card-menu"><button className="icon-button" aria-label={'Options for ' + book.title} aria-expanded={menu === book.id} onClick={event => {
                      const shelf = event.currentTarget.closest('.shelves')
                      const { left, right } = event.currentTarget.getBoundingClientRect()
                      setMenuAtStart(!!shelf && right - shelf.getBoundingClientRect().left < 180 && document.documentElement.clientWidth - left >= 180)
                      setMenu(menu === book.id ? undefined : book.id)
                    }}><Ellipsis size={19} /></button>
                      {menu === book.id && <><button className="menu-scrim" aria-label="Close book options" onClick={() => setMenu(undefined)} /><div className={`dropdown ${menuAtStart ? 'from-start' : ''}`}>
                        <button onClick={() => openBook(book)}><BookOpen size={16} /> Open book</button>
                        {onShelves && <button onClick={() => { setMenu(undefined); persist(edit(book.id, { favorite: !book.favorite })) }}><Heart size={16} /> {book.favorite ? 'Remove from favorites' : 'Add to favorites'}</button>}
                        <button onClick={() => { setMenu(undefined); setDialog({ kind: 'rename', book }) }}><Pencil size={16} /> Rename</button>
                        <button onClick={() => { setMenu(undefined); setDialog({ kind: 'move', book }) }}><Folder size={16} /> Move to collection</button>
                        <button className="danger" onClick={() => { setMenu(undefined); setDialog({ kind: 'delete', book }) }}><Trash2 size={16} /> Delete</button>
                      </div></>}
                    </div></div>
                  </article>)}</div>
                </section>}
              </>}
          </main>
          <footer className="mobile-navigation">{navigation.slice(0, 3).map(({ key, label, icon: Icon }) => <button key={key} className={view === key ? 'active' : ''} onClick={() => navigate(key)}><Icon size={19} />{label}</button>)}<button className={view === 'settings' ? 'active' : ''} onClick={() => navigate('settings')}><SettingsIcon size={19} />Settings</button></footer>
        </div>
      </div>}
    {dragging && <div className="drag-overlay" onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); void importFiles(event.dataTransfer.files) }}><FileUp size={40} /> Drop PDFs to add them to Folio</div>}
    {dialog && <Modal title={{ upload: 'Upload PDFs', install: 'Install Folio', clear: 'Clear your library?', collection: 'New collection', delete: 'Delete this book?', rename: 'Rename book', move: 'Move to collection', deleteCollection: 'Delete this collection?' }[dialog.kind]} close={() => setDialog(undefined)}>
      {dialog.kind === 'upload' ? <><button className="drop-zone" onClick={() => files.current?.click()} onDragOver={event => {
        event.preventDefault()
        event.stopPropagation()
      }} onDrop={event => {
        event.preventDefault()
        event.stopPropagation()
        setDragging(false)
        void importFiles(event.dataTransfer.files)
      }}><FileUp size={29} /><strong>Choose PDF files</strong><span>Or drag and drop them here</span></button><p className="muted">Documents are processed and stored on this device.</p></> : dialog.kind === 'install' ?
      <><p className="muted">Open your browser’s menu and look for <strong>Install app</strong> or <strong>Add to Home Screen</strong>. On iPhone or iPad, open Folio in Safari and use the Share menu.</p><button className="secondary-button" onClick={() => setDialog(undefined)}><Download size={16} /> Done</button></> :
        <form onSubmit={handleDialog}>
          {dialog.kind === 'rename' && <label>Book title<input name="name" autoFocus required maxLength={180} defaultValue={dialog.book.title} /></label>}
          {dialog.kind === 'collection' && <label>Collection name<input name="name" autoFocus required maxLength={60} placeholder="e.g. Research papers" /></label>}
          {dialog.kind === 'move' && <label>Collection<select name="name" defaultValue={dialog.book.collectionId ?? ''}><option value="">No collection</option>{collections.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{!collections.length && <span className="muted">Create a collection from the sidebar to organize books.</span>}</label>}
          {dialog.kind === 'delete' && <p className="muted">“{dialog.book.title}” and its reading history will be removed from this device.</p>}
          {dialog.kind === 'deleteCollection' && <p className="muted">Books in this collection will move back to the main library.</p>}
          {dialog.kind === 'clear' && <p className="muted">This permanently removes all local books, notes, bookmarks, and settings.</p>}
          <div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setDialog(undefined)}>Cancel</button><button className="primary-button" type="submit">{dialog.kind === 'clear' ? 'Clear library' : dialog.kind.startsWith('delete') ? 'Delete' : 'Save'}</button></div>
        </form>}
    </Modal>}
    {password && <Modal title="Unlock PDF" close={() => resolvePassword(null)}><form onSubmit={event => {
      event.preventDefault()
      resolvePassword(String(new FormData(event.currentTarget).get('password') ?? ''))
    }}><p className="muted">{password.incorrect ? 'That password was incorrect. Try again.' : 'This PDF is password-protected.'}</p><label>Password<input autoFocus key={String(password.incorrect)} name="password" type="password" required /></label><div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => resolvePassword(null)}>Cancel</button><button className="primary-button" type="submit">Unlock</button></div></form></Modal>}
    {(message || upload || updates) && <div className="toast" role="status">{upload ? <span className="spinner" /> : <Check size={17} />}<span>{upload || message || 'A new Folio version is available.'}</span>{updates && !message && !upload && <button className="secondary-button" onClick={() => void updateServiceWorker(true)}>Update now</button>}{message && !upload && <button className="icon-button" aria-label="Dismiss message" onClick={() => setMessage('')}><X size={16} /></button>}</div>}
  </div>
}
