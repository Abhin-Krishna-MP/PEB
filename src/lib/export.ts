import type { PDFDocumentProxy } from 'pdfjs-dist'

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]!)

const documentEnd = `
</script>
<script>
  const pages = JSON.parse(document.getElementById('pages').textContent);
  const image = document.getElementById('page');
  const position = document.getElementById('position');
  const previous = document.getElementById('previous');
  const next = document.getElementById('next');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let current = 0;
  let busy = false;
  let touchStart = null;
  function show() {
    image.src = pages[current];
    image.alt = 'Page ' + (current + 1);
    position.textContent = (current + 1) + ' / ' + pages.length;
    previous.disabled = current === 0;
    next.disabled = current === pages.length - 1;
  }
  async function turn(direction) {
    const target = current + direction;
    if (busy || target < 0 || target >= pages.length) return;
    if (reduced.matches) { current = target; show(); return; }
    busy = true;
    try {
      const upcoming = new Image();
      upcoming.src = pages[target];
      await upcoming.decode().catch(() => {});
      const angle = 86 * direction;
      await image.animate([{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(' + -angle + 'deg)' }], { duration: 145, easing: 'ease-in' }).finished;
      current = target;
      show();
      await image.animate([{ transform: 'rotateY(' + angle + 'deg)' }, { transform: 'rotateY(0deg)' }], { duration: 165, easing: 'ease-out' }).finished;
    } finally { busy = false; }
  }
  previous.onclick = () => turn(-1);
  next.onclick = () => turn(1);
  window.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft') turn(-1);
    if (event.key === 'ArrowRight') turn(1);
  });
  image.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'touch') return;
    touchStart = event.clientX;
    image.setPointerCapture(event.pointerId);
  });
  image.addEventListener('pointerup', event => {
    if (touchStart !== null && Math.abs(event.clientX - touchStart) > 45) turn(event.clientX < touchStart ? 1 : -1);
    touchStart = null;
  });
  image.addEventListener('pointercancel', () => { touchStart = null; });
  show();
</script>
</body></html>
`

export async function exportFlipbook(pdf: PDFDocumentProxy, title: string, signal: AbortSignal, progress: (page: number) => void) {
  const name = escapeHtml(title)
  const parts: BlobPart[] = [`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name}</title>
<style>
* { box-sizing: border-box }
body { margin: 0; min-height: 100dvh; display: grid; grid-template-rows: auto 1fr auto; background: #101216; color: #f1efed; font: 15px system-ui, sans-serif }
header, footer { background: #191c21; padding: 12px; text-align: center }
h1 { margin: 0; font-size: 16px }
main { display: grid; place-items: center; perspective: 1400px; padding: 16px; min-height: 0 }
img { display: block; max-width: 100%; max-height: calc(100dvh - 150px); box-shadow: 0 13px 36px #000b; touch-action: pan-y }
footer { display: flex; justify-content: center; gap: 16px; align-items: center }
button { background: #e3b786; color: #22170e; border: 0; border-radius: 7px; padding: 9px 13px; font: inherit; cursor: pointer }
button:disabled { opacity: .45; cursor: default }
</style></head><body>
<header><h1>${name}</h1></header>
<main><img id="page" draggable="false" alt=""></main>
<footer><button id="previous">Previous</button><output id="position" aria-live="polite"></output><button id="next">Next</button></footer>
<script id="pages" type="application/json">[`]
  const canvas = document.createElement('canvas')
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      signal.throwIfAborted()
      const page = await pdf.getPage(pageNumber)
      signal.throwIfAborted()
      try {
        const natural = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: Math.min(2, 1500 / Math.max(natural.width, natural.height)) })
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        const task = page.render({ canvas, viewport })
        const cancel = () => task.cancel()
        signal.addEventListener('abort', cancel, { once: true })
        try { await task.promise } finally { signal.removeEventListener('abort', cancel) }
        parts.push((pageNumber !== 1 ? ',' : '') + JSON.stringify(canvas.toDataURL('image/webp', .86)))
      } finally {
        page.cleanup()
      }
      progress(pageNumber)
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    signal.throwIfAborted()
    parts.push(']', documentEnd)
    const download = URL.createObjectURL(new Blob(parts, { type: 'text/html;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = download
    anchor.download = (title.replace(/[^\p{L}\p{N}._ -]+/gu, '').trim().slice(0, 100) || 'Folio book') + '.html'
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(download), 30_000)
  } finally {
    canvas.width = canvas.height = 0
  }
}
