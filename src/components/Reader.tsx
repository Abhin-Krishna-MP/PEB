import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import {
  ArrowLeft, BookOpen, Bookmark, Check, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Download,
  Focus, Highlighter, ListTree, Maximize, Minimize, Minus, Palette, PanelLeft, Plus, Search, SlidersHorizontal, StickyNote, Trash2, X,
} from 'lucide-react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { clampPage, adjacentPage } from '../lib/flip'
import { loadPdf, outline, pageText, type OutlineEntry, type PasswordRequest } from '../lib/pdf'
import { readFile } from '../lib/storage'
import { useLibrary } from '../lib/store'
import { companionModes, type Annotation, type Book, type CompanionMode, type Fit, type Mode, type Theme } from '../lib/model'
import { BookLoading, Modal } from './Common'
import FlipBook from './FlipBook'
import PdfPage, { clearPageRasters } from './PdfPage'
import ReadingCompanion from './ReadingCompanion'

type Pane = 'pages' | 'outline' | 'search' | 'notes' | 'theme'
type SearchResult = { page: number; text: string }
const defaultRatio = 460 / 625
const paneLabels = { pages: 'Pages', outline: 'Table of contents', search: 'Search document', notes: 'Bookmarks & notes', theme: 'Reading theme' }
const readingThemes: Theme[] = ['Original', 'Light', 'Sepia', 'Dark']

export default function Reader({ book, file, close, password, toast }: { book: Book; file?: Promise<Blob>; close: () => void; password: PasswordRequest; toast: (message: string) => void }) {
  const preferences = useLibrary(state => state.preferences)
  const edit = useLibrary(state => state.edit)
  const configure = useLibrary(state => state.configure)
  const [pdf, setPdf] = useState<PDFDocumentProxy>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(0)
  const [firstPageSettled, setFirstPageSettled] = useState(false)
  const pageSettled = useCallback(() => setFirstPageSettled(true), [])
  const [page, setPage] = useState(book.page)
  const [jumpField, setJumpField] = useState(String(book.page))
  const [pane, setPane] = useState<Pane>()
  const [thumbOffset, setThumbOffset] = useState(0)
  const theme = preferences.theme
  const [mode, setMode] = useState<Mode>(preferences.mode)
  const [fit, setFit] = useState<Fit>(preferences.fit)
  const [zoom, setZoom] = useState(preferences.zoom)
  const [pinchScale, setPinchScale] = useState(1)
  const [ratio, setRatio] = useState(book.aspectRatio ?? defaultRatio)
  const [size, setSize] = useState({ width: 900, height: 620 })
  const [focus, setFocus] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [controls, setControls] = useState(false)
  const [note, setNote] = useState<Annotation>()
  const [showExport, setShowExport] = useState(false)
  const [exportedPages, setExportedPages] = useState<number>()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searched, setSearched] = useState(0)
  const [searchError, setSearchError] = useState('')
  const [textStatus, setTextStatus] = useState<'unknown' | 'sample-empty' | 'none' | 'available'>('unknown')
  const [contents, setContents] = useState<OutlineEntry[]>()
  const [systemReduce, setSystemReduce] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
  const root = useRef<HTMLDivElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const thumbViewport = useRef<HTMLDivElement>(null)
  const passwordRef = useRef(password)
  const navigation = useRef<(direction: -1 | 1) => void>(null)
  const texts = useRef(new Map<number, string>())
  const exporting = useRef<AbortController>(null)
  passwordRef.current = password

  const total = pdf?.numPages ?? book.pages
  const scrolling = mode === 'Scroll'
  const spread = !scrolling && total > 1 && (mode === 'Double page' || (mode === 'Auto' && size.width >= 730 && size.width > size.height * 1.16))
  const leafCount = spread ? 2 : 1
  const compact = size.width < 600
  const pad = compact ? 22 : 68
  const widthFit = Math.max(140, (size.width - pad) / leafCount)
  const heightFit = Math.max(180, size.height - (compact ? 32 : 58))
  const width = Math.floor((fit === 'Fit width' ? widthFit : Math.min(widthFit, heightFit * ratio)) * zoom / 100)
  const height = Math.round(width / ratio)
  const needsPanning = width * leafCount + (compact ? 16 : 30) > size.width || height + (compact ? 26 : 48) > size.height
  const reduced = preferences.reducedMotion || systemReduce
  const readPage = useCallback(async (number: number) => {
    if (!pdf) return ''
    const cached = texts.current.get(number)
    if (cached !== undefined) return cached
    const text = await pageText(await pdf.getPage(number))
    if (texts.current.size < 900) texts.current.set(number, text)
    return text
  }, [pdf])
  const scrollStep = height + 18
  const scrollWindow = Math.max(3, Math.ceil(size.height / scrollStep) + 1)
  const firstVisible = Math.max(1, page - scrollWindow)
  const lastVisible = Math.min(total, page + scrollWindow)
  const scrollHeight = (total - 1) * scrollStep + Math.max(height, size.height - 30)

  useEffect(() => {
    const controller = new AbortController()
    let task: ReturnType<typeof loadPdf> | undefined
    let document: PDFDocumentProxy | undefined
    async function open() {
      const blob = await (file ?? readFile(book, controller.signal))
      if (controller.signal.aborted) return
      const data = await blob.arrayBuffer()
      if (controller.signal.aborted) return
      task = loadPdf(data, incorrect => controller.signal.aborted ? Promise.resolve(null) : passwordRef.current(incorrect))
      task.onProgress = ({ loaded, total: bytes }: { loaded: number; total: number }) => {
        if (!controller.signal.aborted && bytes) setLoading(Math.min(99, Math.round(loaded / bytes * 100)))
      }
      document = await task.promise
      if (!book.aspectRatio && !book.sample) {
        const first = await document.getPage(1)
        const initial = first.getViewport({ scale: 1 })
        if (!controller.signal.aborted) setRatio(initial.width / initial.height)
      }
      if (!controller.signal.aborted) {
        const restored = clampPage(book.page, document.numPages)
        setPage(restored)
        setJumpField(String(restored))
        setPdf(document)
      }
    }
    void open().catch(value => {
      if (!controller.signal.aborted) setError(value instanceof Error ? value.message : 'This PDF could not be opened.')
    })
    return () => {
      controller.abort()
      if (document) clearPageRasters(document)
      void task?.destroy().catch(() => undefined)
    }
  }, [book.id])
  useEffect(() => () => exporting.current?.abort(), [])

  useLayoutEffect(() => {
    const element = viewport.current
    if (!element) return
    setSize({ width: element.clientWidth, height: element.clientHeight })
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize(previous => previous.width === width && previous.height === height ? previous : { width, height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)')
    const motion = () => setSystemReduce(query.matches)
    const full = () => setFullscreen(document.fullscreenElement === root.current)
    query.addEventListener('change', motion)
    document.addEventListener('fullscreenchange', full)
    return () => { query.removeEventListener('change', motion); document.removeEventListener('fullscreenchange', full) }
  }, [])
  useEffect(() => {
    if (pane !== 'outline' || !pdf) return
    let live = true
    void outline(pdf).then(value => { if (live) setContents(value) }, () => { if (live) setContents([]) })
    return () => { live = false }
  }, [pane, pdf])
  useEffect(() => {
    if (!pdf || pane !== 'search') return
    let live = true
    setResults([])
    setSearched(0)
    setSearchError('')
    const needle = query.toLocaleLowerCase().trim().replace(/\s+/g, ' ')
    if (!needle) {
      if (textStatus === 'unknown') {
        const numbers = [...new Set([1, clampPage(page, pdf.numPages)])]
        void Promise.all(numbers.map(readPage)).then(items => { if (live) setTextStatus(items.some(Boolean) ? 'available' : 'sample-empty') }).catch(() => undefined)
      }
      return () => { live = false }
    }
    const timer = window.setTimeout(async () => {
      const found: SearchResult[] = []
      let foundText = false
      let lastUpdate = performance.now()
      try {
        for (let index = 1; index <= pdf.numPages && live; index++) {
          const match = (await readPage(index)).replace(/\s+/g, ' ')
          if (!live) return
          foundText ||= !!match
          const pos = match.toLocaleLowerCase().indexOf(needle)
          if (pos >= 0) found.push({ page: index, text: (pos > 44 ? '…' : '') + match.slice(Math.max(0, pos - 44), pos + needle.length + 58) + (pos + needle.length + 58 < match.length ? '…' : '') })
          if (performance.now() - lastUpdate >= 110 || index === pdf.numPages) {
            lastUpdate = performance.now()
            setResults([...found])
            setSearched(index)
            await new Promise(resolve => window.setTimeout(resolve, 0))
          }
        }
        if (live) setTextStatus(foundText ? 'available' : 'none')
      } catch { if (live) setSearchError('PDF text could not be indexed.') }
    }, 200)
    return () => { live = false; window.clearTimeout(timer) }
  }, [pdf, pane, query, readPage])
  useEffect(() => {
    if (pane !== 'pages' || !thumbViewport.current) return
    thumbViewport.current.scrollTop = Math.max(0, (page - 2) * 141)
    setThumbOffset(thumbViewport.current.scrollTop)
  }, [pane, page])
  useLayoutEffect(() => {
    if (pdf && scrolling) alignScroll(page)
  }, [pdf, scrolling, scrollStep, scrollHeight])

  function updatePage(number: number) {
    const next = clampPage(number, total)
    setPage(next)
    setJumpField(String(next))
    if (next !== page) void edit(book.id, { page: next }).catch(() => toast('Could not save your reading position.'))
  }
  function alignScroll(number: number) {
    if (!viewport.current) return
    viewport.current.scrollTop = (number - 1) * scrollStep
  }
  function jump(number: number) {
    const next = clampPage(number, total)
    if (scrolling) alignScroll(next)
    updatePage(next)
  }
  function turn(direction: -1 | 1) {
    if (!pdf) return
    if (!scrolling && navigation.current) navigation.current(direction)
    else jump(adjacentPage(page, direction, false, total))
  }
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (document.querySelector('dialog[open]') || (event.target instanceof HTMLElement && /INPUT|SELECT|TEXTAREA/.test(event.target.tagName))) return
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); turn(event.key === 'ArrowLeft' ? -1 : 1) }
      if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); jump(event.key === 'Home' ? 1 : total) }
      if (event.key === 'Escape') { if (focus) setFocus(false); setControls(false); setPane(undefined) }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); setFocus(false); setPane('search') }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })
  function changeZoom(value: number) { setZoom(Math.max(50, Math.min(300, Math.round(value)))) }
  function pinch(multiplier: number, end: boolean) {
    if (end) {
      setPinchScale(1)
      changeZoom(zoom * multiplier)
    } else {
      setPinchScale(Math.max(50 / zoom, Math.min(300 / zoom, multiplier)))
    }
  }
  function pan(x: number, y: number) {
    if (viewport.current) {
      viewport.current.scrollLeft += x
      viewport.current.scrollTop += y
    }
  }
  function togglePane(next: Pane) {
    setPane(pane === next ? undefined : next)
    setControls(false)
  }
  async function fullScreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else if (root.current?.requestFullscreen) await root.current.requestFullscreen()
      else setFocus(value => !value)
    } catch { setFocus(value => !value) }
  }
  function writeAnnotations(annotations: Annotation[]) {
    void edit(book.id, { annotations }).catch(() => toast('Could not save your reading marks.'))
  }
  const marked = book.annotations.find(item => item.kind === 'bookmark' && item.page === page)
  const saveBookmark = useCallback(async () => {
    if (!marked) await edit(book.id, { annotations: [...book.annotations, { kind: 'bookmark', id: crypto.randomUUID(), text: '', page }] })
  }, [book.id, book.annotations, page, marked, edit])
  function toggleBookmark() {
    if (marked) writeAnnotations(book.annotations.filter(item => item.id !== marked.id))
    else void saveBookmark().catch(() => toast('Could not save your reading marks.'))
  }
  function highlight() {
    const selection = window.getSelection()
    if (!selection?.rangeCount || selection.isCollapsed) { toast('Select PDF text to highlight it.'); return }
    const range = selection.getRangeAt(0)
    const elementFor = (node: Node) => (node instanceof HTMLElement ? node : node.parentElement)?.closest<HTMLElement>('.pdf-paper')
    const paper = elementFor(range.startContainer)
    if (!paper || paper !== elementFor(range.endContainer) || !viewport.current?.contains(paper)) { toast('Select a passage within a single page.'); return }
    const rect = paper.getBoundingClientRect()
    const boxes = [...range.getClientRects()].filter(box => box.width > 0 && box.height > 0).map(box => ({
      x: (box.left - rect.left) / rect.width, y: (box.top - rect.top) / rect.height,
      width: box.width / rect.width, height: box.height / rect.height,
    }))
    if (boxes.length) writeAnnotations([...book.annotations, { id: crypto.randomUUID(), kind: 'highlight', page: Number(paper.dataset.page), text: selection.toString().trim(), boxes }])
    selection.removeAllRanges()
  }
  function saveNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!note) return
    const text = String(new FormData(event.currentTarget).get('note') ?? '').trim()
    if (!text) return
    writeAnnotations([...book.annotations.filter(item => item.id !== note.id), { ...note, text }])
    setNote(undefined)
  }
  async function exportBook() {
    if (!pdf || exporting.current) return
    const controller = new AbortController()
    exporting.current = controller
    setExportedPages(0)
    try {
      const { exportFlipbook } = await import('../lib/export')
      await exportFlipbook(pdf, book.title, controller.signal, setExportedPages)
      toast('Standalone flipbook downloaded.')
      setShowExport(false)
    } catch {
      if (!controller.signal.aborted) toast('Could not finish exporting this book.')
    } finally {
      exporting.current = null
      setExportedPages(undefined)
    }
  }
  function cancelExport() {
    exporting.current?.abort()
    setShowExport(false)
  }
  const percent = Math.round(page / Math.max(total, 1) * 100)
  const thumbStart = Math.max(0, Math.floor(thumbOffset / 141) - 2)
  const thumbCount = Math.min(total - thumbStart, Math.ceil(size.height / 141) + 6)
  const readerButton = (label: string, Icon: typeof Search, action: () => void, pressed?: boolean, preserveSelection = false) =>
    <button className={`icon-button ${pressed ? 'pressed' : ''}`} aria-label={label} title={label} onClick={action} aria-pressed={pressed} onMouseDown={preserveSelection ? event => event.preventDefault() : undefined}><Icon size={19} strokeWidth={1.7} /></button>
  const noText = textStatus === 'sample-empty' || textStatus === 'none'

  return <div className={`reader ${focus ? 'focus-mode' : ''}`} ref={root}>
    {!focus && <header className="reader-top">
      <button className="back-link" aria-label="Library" onClick={close}><ArrowLeft size={19} /><span>Library</span></button>
      <div className="reader-title">{book.title}</div>
      <div className="reader-actions">
        {readerButton('Page thumbnails', PanelLeft, () => togglePane('pages'), pane === 'pages')}
        {readerButton('Search document', Search, () => togglePane('search'), pane === 'search')}
        {readerButton('Bookmarks and notes', Bookmark, () => togglePane('notes'), pane === 'notes')}
        {readerButton('Reading theme', Palette, () => togglePane('theme'), pane === 'theme')}
        <div className="reader-options">{readerButton('Reader options', SlidersHorizontal, () => setControls(!controls), controls, true)}
          {controls && <><button className="menu-scrim" aria-label="Close reader options" onClick={() => setControls(false)} /><div className="dropdown options-popup">
            <label>Reading mode<select value={mode} onChange={event => setMode(event.target.value as Mode)}>{['Auto', 'Single page', 'Double page', 'Scroll'].map(value => <option key={value}>{value}</option>)}</select></label>
            <label>Page fit<select value={fit} onChange={event => setFit(event.target.value as Fit)}><option>Fit page</option><option>Fit width</option></select></label>
            <label>Reading companion<select value={preferences.companion} onChange={event => {
              void configure({ companion: event.target.value as CompanionMode }).catch(() => toast('Could not save the companion preference.'))
            }}>{companionModes.map(value => <option key={value}>{value}</option>)}</select></label>
            <button onClick={() => togglePane('outline')}><ListTree size={17} /> Table of contents</button>
            <button onMouseDown={event => event.preventDefault()} onClick={() => { highlight(); setControls(false) }}><Highlighter size={17} /> Highlight selection</button>
            <button onClick={() => { setFocus(true); setControls(false); setPane(undefined) }}><Focus size={17} /> Distraction-free mode</button>
            <button onClick={() => { setShowExport(true); setControls(false) }} disabled={!pdf}><Download size={17} /> Export HTML flipbook</button>
          </div></>}
        </div>
        {readerButton(fullscreen ? 'Exit fullscreen' : 'Fullscreen', fullscreen ? Minimize : Maximize, () => void fullScreen())}
      </div>
    </header>}
    {focus && <button className="secondary-button exit-focus" onClick={() => setFocus(false)}><Minimize size={17} /> <span>Exit distraction-free mode</span></button>}
    <div className="reader-body">
      {!focus && pane && <aside className="reader-pane" aria-label={paneLabels[pane]}>
        <div className="pane-heading"><h2>{paneLabels[pane]}</h2>{readerButton('Close panel', X, () => setPane(undefined))}</div>
        {pane === 'pages' && pdf && <div className="thumb-viewport" ref={thumbViewport} onScroll={event => setThumbOffset(event.currentTarget.scrollTop)}>
          <div style={{ height: total * 141, position: 'relative' }}>
            {Array.from({ length: Math.max(0, thumbCount) }, (_, index) => thumbStart + index + 1).map(number => <button key={number} className={`thumb ${number === page ? 'selected' : ''}`} style={{ top: (number - 1) * 141 }} aria-label={'Go to page ' + number} onClick={() => jump(number)}>
              <PdfPage pdf={pdf} number={number} width={76} height={105} text={false} thumbnail /><span>{number}</span>
            </button>)}
          </div>
        </div>}
        {pane === 'theme' && <div className="pane-content">
          <div className="theme-grid">{readingThemes.map(option => <button key={option} className="theme-choice" aria-pressed={theme === option} onClick={() => {
            void configure({ theme: option }).catch(() => toast('Could not save your reading theme.'))
          }}>
            <span className={`theme-swatch swatch-${option.toLowerCase()}`} aria-hidden="true">Aa{theme === option && <Check size={15} />}</span>
            {option}
          </button>)}</div>
        </div>}
        {pane === 'outline' && <div className="pane-content">
          {contents?.length ? contents.map((item, index) => <button className="pane-row" key={index} onClick={() => jump(item.page)} style={{ paddingInlineStart: 12 + item.depth * 12 }}><span>{item.title}</span><small>{item.page}</small></button>) : <p className="muted">{contents ? 'This PDF has no embedded table of contents.' : 'Loading table of contents…'}</p>}
        </div>}
        {pane === 'search' && <div className="pane-content">
          <label className="search-box"><Search size={16} /><input autoFocus aria-label="Search in PDF" placeholder="Find text…" value={query} onChange={event => setQuery(event.target.value)} /></label>
          <p className="muted" role="status">{searchError || (query.trim() && searched < total ? `Searching pages… ${searched} of ${total}` : query.trim() ? `${results.length} matching pages` : 'Search across all PDF pages.')}</p>
          {noText && <p className="muted">{textStatus === 'none' ? 'No searchable text was found. Scanned pages need an OCR text layer for search and highlighting.' : 'The sampled pages have no selectable text. You can still search the full document.'}</p>}
          {results.map(result => <button key={result.page} className="pane-row result" onClick={() => jump(result.page)}><small>PAGE {result.page}</small><span>{result.text}</span></button>)}
        </div>}
        {pane === 'notes' && <div className="pane-content">
          <div className="annotation-actions"><button className="secondary-button" onClick={toggleBookmark}><Bookmark size={15} fill={marked ? 'currentColor' : 'none'} />{marked ? 'Remove bookmark' : 'Bookmark page'}</button>
            <button className="secondary-button" onClick={() => setNote({ id: crypto.randomUUID(), page, kind: 'note', text: '' })}><StickyNote size={15} /> Add note</button></div>
          {!book.annotations.length && <p className="muted">Your bookmarks, notes, and highlights will appear here.</p>}
          {[...book.annotations].sort((a, b) => a.page - b.page).map(item => <div key={item.id} className="annotation">
            <button className="pane-row result" onClick={() => jump(item.page)}><small>PAGE {item.page} · {item.kind.toUpperCase()}</small><span>{item.text || 'Bookmarked page'}</span></button>
            {item.kind === 'note' && readerButton('Edit note', StickyNote, () => setNote(item))}
            {readerButton('Delete ' + item.kind, Trash2, () => writeAnnotations(book.annotations.filter(other => other.id !== item.id)))}
          </div>)}
        </div>}
      </aside>}
      <div className={`reader-viewport ${scrolling ? 'scroll-mode' : ''}`} ref={viewport} onScroll={event => {
        if (scrolling) {
          const position = event.currentTarget.scrollTop
          const next = clampPage(Math.floor((position + Math.min(height, size.height) * .34) / scrollStep) + 1, total)
          if (next !== page) updatePage(next)
        }
      }}>
        {error ? <div className="reader-state"><BookOpen size={28} /><h2>Couldn’t open this PDF</h2><p>{error}</p><button className="secondary-button" onClick={close}>Back to library</button></div> :
          !pdf ? null :
          scrolling ? <div className="scroll-pages" style={{ width, height: scrollHeight }}>
            {Array.from({ length: lastVisible - firstVisible + 1 }, (_, index) => {
              const number = firstVisible + index
              return <div className="scroll-leaf" style={{ height, top: (number - 1) * scrollStep }} key={number}>
                <PdfPage pdf={pdf} number={number} width={width} height={height} theme={theme} query={query} annotations={book.annotations} onSettled={number === page ? pageSettled : undefined} />
              </div>
            })}
          </div> : <div className={`book-centering ${compact ? 'compact' : ''}`}>
            <FlipBook pdf={pdf} page={page} change={updatePage} registerNavigation={handler => { navigation.current = handler }} width={width} height={height} spread={spread} motion={preferences.animation && !reduced} theme={theme} query={query} annotations={book.annotations} pinch={pinch} pinchScale={pinchScale} pan={needsPanning ? pan : undefined} pageSettled={pageSettled} />
          </div>}
      </div>
      {!firstPageSettled && !error && <div className="reader-loading-splash">
        <BookLoading message={loading > 0 && !pdf ? `Loading your book · ${loading}%` : 'Loading your book…'} reducedMotion={reduced} />
      </div>}
      <ReadingCompanion page={page} total={total} bookmarked={!!marked} saveBookmark={saveBookmark} mode={preferences.companion}
        available={firstPageSettled && !error && !focus && !pane && !controls && !note && !showExport}
        reducedMotion={reduced} readPage={readPage} inset={Math.max(7, (size.width - width * leafCount) / 2 + 23)}
        bottom={scrolling ? 8 : Math.max(8, (size.height - height) / 2 + 5)} />
    </div>
    {!focus && <footer className="reader-footer">
      {pdf && <>
      <div className="reader-progress"><span>{percent}% read</span><div role="progressbar" aria-label="Reading progress" aria-valuenow={percent}><i style={{ width: percent + '%' }} /></div></div>
      <div className="pagination">
        {readerButton('First page', ChevronsLeft, () => jump(1))}
        {readerButton('Previous page', ChevronLeft, () => turn(-1))}
        <form onSubmit={event => { event.preventDefault(); jump(jumpField.trim() ? Number(jumpField) : page) }}><input aria-label="Page number" inputMode="numeric" value={jumpField} onChange={event => setJumpField(event.target.value)} /><span> / {total}</span></form>
        {readerButton('Next page', ChevronRight, () => turn(1))}
        {readerButton('Last page', ChevronsRight, () => jump(total))}
      </div>
      <div className="zoom-tools">{readerButton(marked ? 'Remove page bookmark' : 'Bookmark this page', Bookmark, toggleBookmark, !!marked)}
        {readerButton('Zoom out', Minus, () => changeZoom(zoom - 25))}<button className="zoom-value" title="Reset zoom" onClick={() => changeZoom(100)}>{zoom}%</button>{readerButton('Zoom in', Plus, () => changeZoom(zoom + 25))}
      </div>
      </>}
    </footer>}
    {note && <Modal title={note.text ? 'Edit note' : 'Note on page ' + note.page} close={() => setNote(undefined)}><form onSubmit={saveNote}><label>Note<textarea autoFocus name="note" rows={5} defaultValue={note.text} required maxLength={6000} /></label><div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => setNote(undefined)}>Cancel</button><button className="primary-button" type="submit">Save note</button></div></form></Modal>}
    {showExport && <Modal title="Export HTML flipbook" close={cancelExport}>
      <p className="muted">Download a standalone offline book made from rendered page images. The images are unencrypted and the text is part of each image.</p>
      {exportedPages !== undefined && <p className="muted" role="status">Rendering pages · {exportedPages} of {total}</p>}
      <div className="dialog-actions"><button className="secondary-button" onClick={cancelExport}>Cancel</button><button className="primary-button" onClick={() => void exportBook()} disabled={exportedPages !== undefined}>Download HTML</button></div>
    </Modal>}
  </div>
}
