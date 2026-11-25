import { getDocument, GlobalWorkerOptions, PasswordResponses, type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { Book } from './model'

GlobalWorkerOptions.workerSrc = workerUrl
export type PasswordRequest = (incorrect: boolean) => Promise<string | null>

export function loadPdf(data: ArrayBuffer, password?: PasswordRequest) {
  const task = getDocument({
    data, cMapUrl: '/pdf/cmaps/', cMapPacked: true, standardFontDataUrl: '/pdf/standard_fonts/',
    wasmUrl: '/pdf/wasm/', iccUrl: '/pdf/iccs/', enableXfa: false,
    maxImageSize: 40_000_000, canvasMaxAreaInBytes: 48_000_000,
  })
  task.onPassword = (supply: (password: string | Error) => void, reason: number) => {
    if (task.destroyed) return
    if (!password) return supply(new Error('This PDF requires a password.'))
    void password(reason === PasswordResponses.INCORRECT_PASSWORD).then(value => {
      if (task.destroyed) return
      if (value === null) supply(new Error('Password entry was cancelled.'))
      else supply(value)
    })
  }
  return task
}

export function cleanTitle(value: string) {
  return value.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ').trim().slice(0, 180)
}

export async function inspectPdf(file: File, password: PasswordRequest, update: (message: string) => void) {
  const signature = new TextDecoder().decode(await file.slice(0, 1024).arrayBuffer())
  if (!signature.includes('%PDF-')) throw new Error('Choose a valid PDF document.')
  const task = loadPdf(await file.arrayBuffer(), password)
  try {
    const pdf = await task.promise
    update('Creating your cover…')
    const [page, metadata] = await Promise.all([pdf.getPage(1), pdf.getMetadata().catch(() => undefined)])
    const title = (metadata?.info as { Title?: unknown } | undefined)?.Title
    const coverCanvas = document.createElement('canvas')
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: 380 / Math.max(base.width, base.height) })
    coverCanvas.width = Math.ceil(viewport.width)
    coverCanvas.height = Math.ceil(viewport.height)
    await page.render({ canvas: coverCanvas, viewport }).promise
    const book: Book = {
      id: crypto.randomUUID(),
      title: (typeof title === 'string' && cleanTitle(title)) || cleanTitle(file.name.replace(/\.pdf$/i, '')) || 'Untitled book',
      category: 'PDF DOCUMENT', pages: pdf.numPages, aspectRatio: base.width / base.height, cover: coverCanvas.toDataURL('image/webp', 0.86),
      favorite: false, size: file.size, page: 1, openedAt: 0, createdAt: Date.now(), annotations: [],
    }
    coverCanvas.width = coverCanvas.height = 0
    return book
  } finally {
    await task.destroy()
  }
}

export async function pageText(page: PDFPageProxy) {
  const content = await page.getTextContent()
  const blocks: string[] = []
  let words: string[] = []
  let lastY = 0
  let lastHeight = 0
  for (const item of content.items) {
    if (!('str' in item) || !item.str.trim()) continue
    const y = item.transform[5]
    const height = Math.abs(item.height)
    const gap = Math.abs(y - lastY)
    // Keep headings and distant text blocks separate, but rejoin wrapped lines.
    if (words.length && height && lastHeight && gap > Math.min(height, lastHeight) * .65 &&
      (gap > Math.max(height, lastHeight) * 1.85 || Math.abs(height - lastHeight) > Math.min(height, lastHeight) * .2)) {
      blocks.push(words.join(' '))
      words = []
    }
    words.push(item.str.trim().replace(/\s+/g, ' '))
    lastY = y
    lastHeight = height
  }
  if (words.length) blocks.push(words.join(' '))
  return blocks.join('\n')
}

export type OutlineEntry = { title: string; page: number; depth: number }
export async function outline(pdf: PDFDocumentProxy): Promise<OutlineEntry[]> {
  type Item = NonNullable<Awaited<ReturnType<PDFDocumentProxy['getOutline']>>>[number]
  const flatten = async (items: Item[], depth: number): Promise<OutlineEntry[]> => {
    const result: OutlineEntry[] = []
    for (const item of items) {
      const destination = typeof item.dest === 'string' ? await pdf.getDestination(item.dest) : item.dest
      const target = destination?.[0]
      if (target != null) {
        try {
          const index = typeof target === 'number' ? target : await pdf.getPageIndex(target)
          result.push({ title: item.title, page: index + 1, depth })
        } catch { /* A malformed destination can be skipped. */ }
      }
      result.push(...await flatten(item.items, depth + 1))
    }
    return result
  }
  return flatten(await pdf.getOutline() ?? [], 0)
}
