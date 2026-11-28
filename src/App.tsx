import { Activity, lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import {
  ArrowDownUp, ArrowRight, BookOpen, Check, ChevronDown, Clock3, Code2, Crown, Database, Download,
  FileText, FileUp, Folder, Heart, House, LayoutGrid, LibraryBig, List, Menu, Monitor, Moon, Plus, Search, Settings as SettingsIcon,
  ShieldCheck, Sigma, SlidersHorizontal, Sun, Trash2, UserRound, Wifi, WifiOff, X,
} from 'lucide-react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { BookLoading, Cover, Logo, Modal } from './components/Common'
import Settings from './components/Settings'
import BookCard, { type BookAction } from './components/BookCard'
import { fileSize, progress, type Book, type LibraryLayout } from './lib/model'
import { useLibrary } from './lib/store'
import { useDriveSync, watchDriveSync } from './lib/driveSync'
import { readFile } from './lib/storage'
import type { PasswordRequest } from './lib/pdf'
import { currentBook, useReaderRoute } from './lib/readerRoute'
import { ReaderBoundary } from './components/ReaderBoundary'

let readerModule: Promise<typeof import('./components/Reader')> | undefined
function loadReader() {
  return readerModule ??= import('./components/Reader').catch(error => {
    readerModule = undefined
    throw error
  })
}
const Reader = lazy(loadReader)
const warmReader = () => { void loadReader().catch(() => undefined) }
const navigation = [
  { key: 'library', label: 'Library', icon: LibraryBig },
  { key: 'collections', label: 'Collections', icon: Folder },
  { key: 'favorites', label: 'Favorites', icon: Heart },
  { key: 'recent', label: 'Recently opened', icon: Clock3 },
]
const subjectIcons: Record<string, typeof FileText> = {
  'COMPUTER SCIENCE': Monitor, DATABASES: Database, MATHEMATICS: Sigma, NETWORKING: Wifi, PROGRAMMING: Code2,
}
const shelfNavigation = [{ key: 'home', label: 'Home', icon: House }, ...navigation]
const shelfTabs = [
  { key: 'library', label: 'All', icon: LibraryBig },
  { key: 'recent', label: 'Recent', icon: Clock3 },
  { key: 'favorites', label: 'Favorites', icon: Heart },
  { key: 'collections', label: 'Collections', icon: Folder },
]
const heading: Record<string, string> = {
  home: 'Home', library: 'My Library', collections: 'Collections', favorites: 'Favorites', recent: 'Recently opened', settings: 'Settings',
}
type Dialog = { kind: 'upload' | 'install' | 'clear' | 'collection' | 'filter' } | { kind: 'delete' | 'rename' | 'move'; book: Book } | { kind: 'deleteCollection'; id: string }
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
type PasswordPrompt = { incorrect: boolean; bookId?: string; resolve: (value: string | null) => void }

export default function App() {
  const { books, collections, preferences, ready, init, add, edit, closeBook, collect, deleteCollection, clear, configure } = useLibrary()
  useEffect(watchDriveSync, [])
  const [systemLight, setSystemLight] = useState(() => matchMedia('(prefers-color-scheme: light)').matches)
  const lightAppearance = preferences.appearance === 'Light' || (preferences.appearance === 'System' && systemLight)
  useEffect(() => {
    const scheme = matchMedia('(prefers-color-scheme: light)')
    const change = () => setSystemLight(scheme.matches)
    scheme.addEventListener('change', change)
    return () => scheme.removeEventListener('change', change)
  }, [])
  const [view, setView] = useState('library')
  const { active, open: openReader, close: closeReader } = useReaderRoute()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('added')
  const [category, setCategory] = useState('')
  const layout = preferences.libraryLayout
  const onShelves = layout === 'shelves'
  const [menu, setMenu] = useState<string>()
  const [mobile, setMobile] = useState(false)
  const [dialog, setDialog] = useState<Dialog>()
  const [message, setMessage] = useState('')
  const [upload, setUpload] = useState('')
  const [dragging, setDragging] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt>()
  const [usage, setUsage] = useState(0)
  const [quota, setQuota] = useState(0)
  const [password, setPassword] = useState<PasswordPrompt>()
  const pendingPassword = useRef<PasswordPrompt | undefined>(undefined)
  const search = useRef<HTMLInputElement>(null)
  const files = useRef<HTMLInputElement>(null)
  const toastTimer = useRef<number>(0)
  const importing = useRef(false)
  const importUnlock = useRef<{ id: string; value: string } | null>(null)
  const openingFile = useRef<{ id: string; source: Promise<Blob>; controller: AbortController } | null>(null)
  const { needRefresh: [updates], updateServiceWorker } = useRegisterSW()
  const activeBook = books.find(book => book.id === active)

  const toast = useCallback((text: string) => {
    setMessage(text)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setMessage(''), 4400)
  }, [])
  useEffect(() => { void init().catch(() => toast('Local storage could not be opened. Check your browser settings.')) }, [init])
  useEffect(() => {
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
    window.addEventListener('online', onConnection)
    window.addEventListener('offline', onConnection)
    window.addEventListener('beforeinstallprompt', onInstall)
    window.addEventListener('keydown', onKeys)
    document.addEventListener('visibilitychange', onForeground)
    return () => {
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
  useEffect(() => {
    const pending = pendingPassword.current
    if (pending?.bookId && pending.bookId !== active) resolvePassword(null)
    if (importUnlock.current && importUnlock.current.id !== active) importUnlock.current = null
    if (openingFile.current && openingFile.current.id !== active) {
      openingFile.current.controller.abort()
      openingFile.current = null
    }
  }, [active])
  useEffect(() => {
    if (ready && active && !activeBook) closeReader()
  }, [ready, active, activeBook, closeReader])

  function askPassword(incorrect: boolean, bookId?: string): Promise<string | null> {
    if (bookId && bookId !== currentBook()) return Promise.resolve(null)
    return new Promise(resolve => {
      pendingPassword.current = { incorrect, bookId, resolve }
      setPassword(pendingPassword.current)
    })
  }
  const unlockBook: PasswordRequest = incorrect => {
    const remembered = importUnlock.current
    importUnlock.current = null
    if (!incorrect && remembered?.id === active) return Promise.resolve(remembered.value)
    return askPassword(incorrect, active ?? undefined)
  }
  function resolvePassword(value: string | null) {
    pendingPassword.current?.resolve(value)
    pendingPassword.current = undefined
    setPassword(undefined)
  }
  const persist = useCallback((task: Promise<void>, success?: string) => {
    void task.then(() => { if (success) toast(success) }).catch(() => toast('Could not save the change to this device.'))
  }, [toast])
  const closeMenu = useCallback(() => setMenu(undefined), [])
  const toggleMenu = useCallback((id: string) => setMenu(current => current === id ? undefined : id), [])
  const favoriteBook = useCallback((book: Book) => persist(edit(book.id, { favorite: !book.favorite })), [edit, persist])
  const actOnBook = useCallback((kind: BookAction, book: Book) => {
    setMenu(undefined)
    setDialog({ kind, book })
  }, [])
  const openBook = useCallback((book: Book) => {
    if (currentBook() === book.id) return
    setMenu(undefined)
    warmReader()
    openingFile.current?.controller.abort()
    const controller = new AbortController()
    const source = readFile(book, controller.signal)
    void source.catch(() => undefined)
    openingFile.current = { id: book.id, source, controller }
    openReader(book.id)
    persist(edit(book.id, { openedAt: Date.now() }))
  }, [edit, openReader, persist])
  function exitReader() {
    importUnlock.current = null
    if (pendingPassword.current?.bookId) resolvePassword(null)
    closeReader()
  }
  function navigate(key: string) {
    setView(key)
    setQuery('')
    setCategory('')
    setMenu(undefined)
    setMobile(false)
  }
  function changeLayout(value: LibraryLayout) {
    if (view === 'home' && value !== 'shelves') navigate('library')
    persist(configure({ libraryLayout: value }))
  }
  async function importFiles(selected: FileList | File[]) {
    if (importing.current || !selected.length || !ready) return
    importing.current = true
    setDialog(undefined)
    setUpload('Opening PDF…')
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

  function pickCategory(value: string) {
    setCategory(value)
    setView('library')
    setMenu(undefined)
    setMobile(false)
  }

  const categories = [...books.reduce((counts, book) => counts.set(book.category, (counts.get(book.category) ?? 0) + 1), new Map<string, number>())]
    .sort(([a], [b]) => a.localeCompare(b))
  const categoryOptions: [string, number][] = [['', books.length], ...categories]
  const categoryLabel = (value: string) => value ? value.toLowerCase().replace(/\b\w/g, letter => letter.toUpperCase()).replace(/^Pdf /, 'PDF ') : 'All books'
  const collection = collections.find(item => item.id === view)
  const recent = books.filter(book => book.openedAt).sort((a, b) => b.openedAt - a.openedAt)
  const feature = recent[0]
  const rows = books.filter(book => {
    if (onShelves && category && book.category !== category) return false
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
  const showFeature = (view === 'home' || (view === 'library' && !onShelves)) && !query.trim() && feature
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
    if (dialog.kind === 'clear') {
      useDriveSync.getState().disconnect()
      persist(clear().then(() => navigate('library')), 'Local library cleared.')
    }
    setDialog(undefined)
  }

  return <div className={`app appearance-${lightAppearance ? 'light' : 'dark'} ${preferences.reducedMotion ? 'reduce-motion' : ''}`} onDragOver={event => {
    if (event.dataTransfer.types.includes('Files') && !activeBook) { event.preventDefault(); setDragging(true) }
  }}>
    <input type="file" accept="application/pdf,.pdf" multiple hidden ref={files} onChange={event => { if (event.target.files) void importFiles(event.target.files) }} />
    {activeBook && <ReaderBoundary key={activeBook.id} close={exitReader}>
      <Suspense fallback={<div className="center-screen">
        <div className="reader-state"><BookLoading message="Opening your book…" reducedMotion={preferences.reducedMotion} /><button className="secondary-button" onClick={exitReader}>Back to library</button></div>
      </div>}>
        <Reader book={activeBook} file={openingFile.current?.id === active ? openingFile.current?.source : undefined} close={exitReader} password={unlockBook} toast={toast} />
      </Suspense>
    </ReaderBoundary>}
    <Activity mode={activeBook ? 'hidden' : 'visible'}>
      <div className={`shell ${onShelves ? 'bookshelf-shell' : ''}`}>
        {onShelves && <header className="shelf-masthead">
          <button className="masthead-brand" onClick={() => navigate('home')} aria-label="Folio home"><Logo /></button>
          <nav className="masthead-nav" aria-label="Bookshelf navigation">{shelfNavigation.map(({ key, label, icon: Icon }) =>
            <button key={key} className={view === key ? 'selected' : ''} aria-current={view === key ? 'page' : undefined} onClick={() => navigate(key)}><Icon size={15} />{key === 'recent' ? 'Recent' : label}</button>
          )}</nav>
          <div className="masthead-actions">
            <button className="shelf-install" aria-label="Install Folio" onClick={() => void install()}><Crown size={16} /><span>Install Folio</span></button>
            <button className="icon-button masthead-profile" aria-label="App settings" title="Settings" onClick={() => navigate('settings')}><UserRound size={17} /></button>
          </div>
        </header>}
        {mobile && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobile(false)} />}
        <aside className={`sidebar ${mobile ? 'sidebar-open' : ''}`}>
          <button className="brand-button" onClick={() => navigate('library')} aria-label="Folio library"><Logo /></button>
          <div className="side-content">
            {onShelves ? <>
              <div className="shelf-sidebar-title"><LibraryBig size={17} /> Library</div>
              <nav aria-label="Library categories">{categoryOptions.map(([value, count]) => {
                const Icon = value ? subjectIcons[value] ?? FileText : BookOpen
                const selected = view === 'library' && category === value
                return <button key={value} className={`nav-item ${selected ? 'selected' : ''}`} aria-pressed={selected} onClick={() => pickCategory(value)}>
                  <Icon size={16} /><span>{categoryLabel(value)}</span><small>{count}</small>
                </button>
              })}</nav>
            </> : <>
            <div className="nav-label">WORKSPACE</div>
            <nav aria-label="Main navigation">
              {navigation.map(({ key, label, icon: Icon }) => <button key={key} className={`nav-item ${view === key ? 'selected' : ''}`} aria-current={view === key ? 'page' : undefined} onClick={() => navigate(key)}>
                <Icon size={18} strokeWidth={1.7} /><span>{label}</span>{key === 'library' && <small>{books.length}</small>}
              </button>)}
            </nav>
            </>}
            <div className="sidebar-collections">
              <div className="nav-label collection-label">COLLECTIONS
                {collections.length > 0 && <button className="icon-button" aria-label="New collection" title="New collection" onClick={() => setDialog({ kind: 'collection' })}><Plus size={16} /></button>}
              </div>
              {collections.length ? <nav aria-label="Your collections">{collections.map(item => <button className={`nav-item ${view === item.id ? 'selected' : ''}`} aria-current={view === item.id ? 'page' : undefined} key={item.id} onClick={() => navigate(item.id)}><Folder size={17} /><span>{item.name}</span></button>)}</nav> :
                <button className="create-link" onClick={() => setDialog({ kind: 'collection' })}><Plus size={16} /> New collection</button>}
            </div>
          </div>
          <div className="sidebar-foot">
            {onShelves && <div className="shelf-install-card">
              <strong><Crown size={15} /> Folio on your device</strong>
              <p>Open your library from your home screen and read offline.</p>
              <button className="primary-button" onClick={() => void install()}><Download size={15} /> Install app</button>
            </div>}
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
                <div className="page-heading"><div><h1>{query.trim() ? 'Search results' : collection?.name ?? heading[view]}</h1><p className="intro">{query.trim() ? `Books matching “${query.trim()}”` : view === 'library' ? onShelves ? `${books.length} ${books.length === 1 ? 'book' : 'books'} · Your personal PDF library` : 'A quiet place for everything you read.' : view === 'home' ? 'Continue reading or open a book from your library.' : view === 'recent' ? 'Pick up a book you’ve opened before.' : view === 'favorites' ? 'Keep the books you love close at hand.' : 'Organize your books into reading collections.'}</p></div>
                  {view === 'library' && !query && (!onShelves || !online) && <span className="private-pill">{online ? <ShieldCheck size={15} /> : <WifiOff size={15} />}{online ? 'Private & local' : 'Offline'}</span>}
                  {collection && <button className="icon-button danger" aria-label="Delete collection" onClick={() => setDialog({ kind: 'deleteCollection', id: collection.id })}><Trash2 size={18} /></button>}
                </div>
                {onShelves && view !== 'home' && !collection && <nav className="shelf-tabs" aria-label="Browse books">
                  {shelfTabs.map(({ key, label, icon: Icon }) => <button key={key} className={view === key ? 'selected' : ''} aria-current={view === key ? 'page' : undefined} onClick={() => navigate(key)}><Icon size={15} />{label}</button>)}
                </nav>}
                {showFeature && <section className="feature" aria-label="Continue reading" style={{ '--feature-art': `url("${feature.cover}")` } as React.CSSProperties}>
                  <div className="feature-content">
                    <div className="eyebrow"><BookOpen size={16} /> CONTINUE READING</div>
                    <h2>{feature.title}</h2>
                    <div className="feature-status"><span>Page {feature.page} of {feature.pages}</span><span className="separator-dot" /><span>{progress(feature)}% complete</span></div>
                    <div className="feature-meter" role="progressbar" aria-label="Reading progress" aria-valuenow={progress(feature)}><i style={{ width: progress(feature) + '%' }} /></div>
                    <button className="primary-button resume" onPointerEnter={warmReader} onFocus={warmReader} onClick={() => openBook(feature)}>Resume reading <ArrowRight size={17} /></button>
                  </div>
                  <div className="feature-visual"><Cover book={feature} /></div>
                </section>}
                {showCollections ? <section className="collection-grid" aria-label="Collections">
                  {collections.map(item => <button className="collection-card" key={item.id} onClick={() => navigate(item.id)}><Folder size={25} /><strong>{item.name}</strong><span>{books.filter(book => book.collectionId === item.id).length} books</span></button>)}
                  <button className="collection-card new" onClick={() => setDialog({ kind: 'collection' })}><Plus size={25} /><strong>New collection</strong></button>
                </section> : <section className="shelf" aria-label="Bookshelf">
                  <div className="shelf-header">
                    <div className={onShelves ? 'sr-only' : 'shelf-title'}><h2>{view === 'library' && !query ? 'Bookshelf' : 'Books'}</h2><span>{rows.length} {rows.length === 1 ? 'book' : 'books'}</span></div>
                    <div className="shelf-controls">
                      <label className="sort"><ArrowDownUp size={15} /><select aria-label="Sort books" value={sort} onChange={event => setSort(event.target.value)}><option value="added">Recently added</option><option value="recent">Last opened</option><option value="title">Title A–Z</option><option value="pages">Page count</option></select><ChevronDown size={14}/></label>
                      {onShelves && <button className="shelf-filter" aria-label="Filter books" onClick={() => setDialog({ kind: 'filter' })}><SlidersHorizontal size={15} /><span>Filter</span></button>}
                      <div className="view-toggle" role="group" aria-label="Library layout">
                        <button className={layout === 'grid' ? 'on' : ''} aria-label="Grid view" title="Grid view" aria-pressed={layout === 'grid'} onClick={() => changeLayout('grid')}><LayoutGrid size={16} /></button>
                        <button className={layout === 'list' ? 'on' : ''} aria-label="List view" title="List view" aria-pressed={layout === 'list'} onClick={() => changeLayout('list')}><List size={17} /></button>
                        <button className={onShelves ? 'on' : ''} aria-label="Wooden shelf view" title="Wooden shelf view" aria-pressed={onShelves} onClick={() => changeLayout('shelves')}><LibraryBig size={17} /></button>
                      </div>
                    </div>
                  </div>
                  {onShelves && view === 'library' && categories.length > 0 && <div className="category-chips" role="group" aria-label="Filter by category">
                    {categoryOptions.map(([value, count]) => <button key={value} aria-pressed={category === value} onClick={() => pickCategory(value)}>{categoryLabel(value)} <small>({count})</small></button>)}
                  </div>}
                  {!ready && <div className="empty"><BookLoading message="Loading your library…" reducedMotion={preferences.reducedMotion} /></div>}
                  {ready && !rows.length && <div className="empty"><BookOpen size={30} /><h3>{query || (onShelves && category) ? 'No matching books' : view === 'favorites' ? 'No favorites yet' : view === 'recent' ? 'No books opened yet' : 'No books here yet'}</h3>
                    <p>{query ? 'Try another title or category.' : view === 'favorites' ? 'Use the heart on any book to save it here.' : collection ? 'Use a book’s menu to move it into this collection.' : 'Upload a PDF to start reading.'}</p>
                    {!query && view === 'library' && <button className="primary-button" onClick={() => setDialog({ kind: 'upload' })}><FileUp size={16} /> Upload PDF</button>}
                  </div>}
                  <div className={`books ${layout}`} hidden={!rows.length}>
                    {rows.map(book => <BookCard key={book.id} book={book} layout={layout} menuOpen={menu === book.id}
                      open={openBook} warmReader={warmReader} favorite={favoriteBook} toggleMenu={toggleMenu} closeMenu={closeMenu} act={actOnBook} />)}
                    {onShelves && rows.length > 0 && <>
                      <img src="/shelf/vine.webp" alt="" className="shelf-decor shelf-vine" />
                      <img src={lightAppearance ? '/shelf/globe.webp' : '/shelf/hourglass.webp'} alt="" className="shelf-decor shelf-ornament" />
                    </>}
                  </div>
                </section>}
              </>}
          </main>
          <footer className="mobile-navigation">
            {(onShelves ? shelfNavigation : navigation.slice(0, 3)).map(({ key, label, icon: Icon }) => <button key={key} className={view === key ? 'active' : ''} aria-current={view === key ? 'page' : undefined} onClick={() => navigate(key)}><Icon size={19} />{key === 'recent' ? 'Recent' : label}</button>)}
            {!onShelves && <button className={view === 'settings' ? 'active' : ''} onClick={() => navigate('settings')}><SettingsIcon size={19} />Settings</button>}
          </footer>
        </div>
      </div>
    </Activity>
    {dragging && <div className="drag-overlay" onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); void importFiles(event.dataTransfer.files) }}><FileUp size={40} /> Drop PDFs to add them to Folio</div>}
    {dialog && <Modal title={{ upload: 'Upload PDFs', install: 'Install Folio', filter: 'Filter books', clear: 'Clear your library?', collection: 'New collection', delete: 'Delete this book?', rename: 'Rename book', move: 'Move to collection', deleteCollection: 'Delete this collection?' }[dialog.kind]} close={() => setDialog(undefined)}>
      {dialog.kind === 'upload' ? <><button className="drop-zone" onClick={() => files.current?.click()} onDragOver={event => {
        event.preventDefault()
        event.stopPropagation()
      }} onDrop={event => {
        event.preventDefault()
        event.stopPropagation()
        setDragging(false)
        void importFiles(event.dataTransfer.files)
      }}><FileUp size={29} /><strong>Choose PDF files</strong><span>Or drag and drop them here</span></button><p className="muted">Documents are stored on this device and synced when Google Drive is connected.</p></> : dialog.kind === 'install' ?
      <><p className="muted">Open your browser’s menu and look for <strong>Install app</strong> or <strong>Add to Home Screen</strong>. On iPhone or iPad, open Folio in Safari and use the Share menu.</p><button className="secondary-button" onClick={() => setDialog(undefined)}><Download size={16} /> Done</button></> : dialog.kind === 'filter' ? <div className="shelf-filter-options">
        {categoryOptions.map(([value, count]) => <button key={value} className="secondary-button" aria-pressed={category === value} onClick={() => { pickCategory(value); setDialog(undefined) }}>{categoryLabel(value)} <span>{count}</span></button>)}
      </div> :
        <form onSubmit={handleDialog}>
          {dialog.kind === 'rename' && <label>Book title<input name="name" autoFocus required maxLength={180} defaultValue={dialog.book.title} /></label>}
          {dialog.kind === 'collection' && <label>Collection name<input name="name" autoFocus required maxLength={60} placeholder="e.g. Research papers" /></label>}
          {dialog.kind === 'move' && <label>Collection<select name="name" defaultValue={dialog.book.collectionId ?? ''}><option value="">No collection</option>{collections.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{!collections.length && <span className="muted">Create a collection from the sidebar to organize books.</span>}</label>}
          {dialog.kind === 'delete' && <p className="muted">“{dialog.book.title}” and its reading history will be removed. If you connect Google Drive, this removal will sync to your other devices.</p>}
          {dialog.kind === 'deleteCollection' && <p className="muted">Books in this collection will move back to the main library.</p>}
          {dialog.kind === 'clear' && <p className="muted">This permanently removes all local books, notes, bookmarks, and settings.</p>}
          <div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setDialog(undefined)}>Cancel</button><button className="primary-button" type="submit">{dialog.kind === 'clear' ? 'Clear library' : dialog.kind.startsWith('delete') ? 'Delete' : 'Save'}</button></div>
        </form>}
    </Modal>}
    {password && (!password.bookId || password.bookId === active) && <Modal title="Unlock PDF" close={() => resolvePassword(null)}><form onSubmit={event => {
      event.preventDefault()
      resolvePassword(String(new FormData(event.currentTarget).get('password') ?? ''))
    }}><p className="muted">{password.incorrect ? 'That password was incorrect. Try again.' : 'This PDF is password-protected.'}</p><label>Password<input autoFocus key={String(password.incorrect)} name="password" type="password" required /></label><div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => resolvePassword(null)}>Cancel</button><button className="primary-button" type="submit">Unlock</button></div></form></Modal>}
    {upload ? <div className="toast upload-progress">
      <BookLoading message={upload} reducedMotion={preferences.reducedMotion} />
    </div> : (message || updates) && <div className="toast" role="status"><Check size={17} /><span>{message || 'A new Folio version is available.'}</span>{updates && !message && <button className="secondary-button" onClick={() => void updateServiceWorker(true)}>Update now</button>}{message && <button className="icon-button" aria-label="Dismiss message" onClick={() => setMessage('')}><X size={16} /></button>}</div>}
  </div>
}
