import { memo, useEffect, useRef, type CSSProperties } from 'react'
import { TextLayer, type PDFDocumentProxy } from 'pdfjs-dist'
import './pdf-text.css'
import type { Annotation, Theme } from '../lib/model'

const noAnnotations: Annotation[] = []
const maxRasterPixels = 8_000_000
const pageRasters = new WeakMap<PDFDocumentProxy, Map<string, ImageBitmap>>()

export function clearPageRasters(pdf: PDFDocumentProxy) {
  const rasters = pageRasters.get(pdf)
  rasters?.forEach(bitmap => bitmap.close())
  rasters?.clear()
  pageRasters.delete(pdf)
}

function cachePageRaster(pdf: PDFDocumentProxy, key: string, canvas: HTMLCanvasElement, isCurrent: () => boolean) {
  if (!globalThis.createImageBitmap) return
  if (!pageRasters.has(pdf)) pageRasters.set(pdf, new Map())
  const rasters = pageRasters.get(pdf)!
  void createImageBitmap(canvas).then(bitmap => {
    if (!isCurrent() || pageRasters.get(pdf) !== rasters) { bitmap.close(); return }
    rasters.get(key)?.close()
    rasters.delete(key)
    rasters.set(key, bitmap)
    let pixels = 0
    for (const raster of rasters.values()) pixels += raster.width * raster.height
    for (const [oldest, raster] of rasters) {
      if (pixels <= maxRasterPixels) break
      pixels -= raster.width * raster.height
      raster.close()
      rasters.delete(oldest)
    }
  }).catch(() => undefined)
}

const thumbnailCache = new WeakMap<PDFDocumentProxy, Map<number, string>>()

interface Props {
  pdf: PDFDocumentProxy
  number: number
  width: number
  height: number
  theme?: Theme
  text?: boolean
  query?: string
  annotations?: Annotation[]
  thumbnail?: boolean
  cacheRaster?: boolean
}
function markSearch(layer: HTMLDivElement, query: string) {
  const phrase = query.toLocaleLowerCase().trim().replace(/\s+/g, ' ')
  if (!phrase) return
  const spans = [...layer.querySelectorAll('span')].filter(span => span.childNodes.length === 1 && span.firstChild?.nodeType === Node.TEXT_NODE)
  let joined = ''
  const ranges = spans.map(span => {
    if (joined) joined += ' '
    const start = joined.length
    joined += (span.textContent ?? '').toLocaleLowerCase()
    return { span, start, end: joined.length }
  })
  let match = joined.indexOf(phrase)
  for (const { span, start, end } of ranges) {
    while (match !== -1 && match + phrase.length <= start) match = joined.indexOf(phrase, match + phrase.length)
    if (match !== -1 && match < end) span.classList.add('search-match')
  }
}

export default memo(function PdfPage({ pdf, number, width, height, theme = 'Original', text = true, query = '', annotations = noAnnotations, thumbnail = false, cacheRaster = false }: Props) {
  const paper = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const layer = useRef<HTMLDivElement>(null)
  const latestQuery = useRef(query)
  latestQuery.current = query
  useEffect(() => {
    const holder = paper.current!
    const target = canvas.current!
    const textElement = layer.current
    let disposed = false
    let render: { cancel(): void } | undefined
    let textLayer: TextLayer | undefined
    let release = () => {}
    holder.removeAttribute('data-error')
    holder.removeAttribute('data-rendered')
    if (textElement) textElement.replaceChildren()
    async function renderPage() {
      if (thumbnail && !thumbnailCache.has(pdf)) thumbnailCache.set(pdf, new Map())
      const cached = thumbnail ? thumbnailCache.get(pdf) : undefined
      const preview = cached?.get(number)
      if (preview) {
        const image = new Image()
        image.src = preview
        await image.decode()
        if (disposed) return
        target.width = image.width
        target.height = image.height
        const scale = Math.min(width / image.width, height / image.height)
        holder.style.width = Math.round(image.width * scale) + 'px'
        holder.style.height = Math.round(image.height * scale) + 'px'
        target.getContext('2d')?.drawImage(image, 0, 0)
        holder.dataset.rendered = 'true'
        return
      }
      const page = await pdf.getPage(number)
      if (disposed) return
      release = () => { page.cleanup() }
      const natural = page.getViewport({ scale: 1 })
      const scale = Math.min(width / natural.width, height / natural.height)
      const viewport = page.getViewport({ scale })
      const dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(3_800_000 / (viewport.width * viewport.height)))
      holder.style.width = viewport.width + 'px'
      holder.style.height = viewport.height + 'px'
      holder.style.setProperty('--total-scale-factor', String(scale * page.userUnit))
      target.width = Math.max(1, Math.floor(viewport.width * dpr))
      target.height = Math.max(1, Math.floor(viewport.height * dpr))
      const rasterKey = `${number}:${target.width}:${target.height}`
      const rasters = !thumbnail ? pageRasters.get(pdf) : undefined
      const raster = rasters?.get(rasterKey)
      if (raster) {
        target.getContext('2d')?.drawImage(raster, 0, 0)
        if (!cacheRaster) {
          rasters!.delete(rasterKey)
          raster.close()
        }
      } else {
        const task = page.render({ canvas: target, viewport, transform: [dpr, 0, 0, dpr, 0, 0] })
        render = task
        await task.promise
        if (disposed) return
        if (cacheRaster) cachePageRaster(pdf, rasterKey, target, () => !disposed)
      }
      holder.dataset.rendered = 'true'
      if (cached) {
        if (cached.size >= 96) {
          const oldest = cached.keys().next()
          if (!oldest.done) cached.delete(oldest.value)
        }
        cached.set(number, target.toDataURL('image/webp', .72))
      }
      if (textElement) {
        textLayer = new TextLayer({ textContentSource: page.streamTextContent(), viewport, container: textElement })
        try {
          await textLayer.render()
          if (!disposed) markSearch(textElement, latestQuery.current)
        } catch {
          if (!disposed) textElement.replaceChildren()
        }
      }
      release()
    }
    void renderPage().catch(error => {
      if (!disposed) { holder.dataset.error = 'true'; console.error('PDF page rendering failed', error) }
    })
    return () => {
      disposed = true
      render?.cancel()
      textLayer?.cancel()
      release()
      target.width = target.height = 0
    }
  }, [pdf, number, width, height, text, thumbnail, cacheRaster])
  useEffect(() => {
    const element = layer.current
    if (!element) return
    element.querySelectorAll('.search-match').forEach(span => span.classList.remove('search-match'))
    markSearch(element, query)
  }, [query])
  return <div className={`pdf-paper paper-${theme.toLowerCase()}`} ref={paper} data-page={number} aria-label={`Page ${number}`} style={{ width, height }}>
    <canvas ref={canvas} aria-hidden="true" />
    {text && <div className="textLayer" ref={layer} />}
    {annotations.filter(item => item.page === number && item.kind === 'highlight').flatMap(item => (item.boxes ?? []).map((box, index) =>
      <i className="text-highlight" key={item.id + index} style={{ left: box.x * 100 + '%', top: box.y * 100 + '%', width: box.width * 100 + '%', height: box.height * 100 + '%' } as CSSProperties} />))}
    <span className="render-error">This page could not be rendered.</span>
  </div>
})
