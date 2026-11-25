import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { adjacentPage, shouldFinishTurn, spreadStart } from '../lib/flip'
import type { Annotation, Theme } from '../lib/model'
import PdfPage from './PdfPage'
import { pageCurl } from '../lib/pageCurl'

type Turn = { target: number; forward: boolean; amount: number; bottom: boolean; diagonal: number }
interface Props {
  pdf: PDFDocumentProxy; page: number; change: (number: number) => void; registerNavigation: (handler: (direction: -1 | 1) => void) => void
  width: number; height: number; spread: boolean; motion: boolean; theme: Theme
  query: string; annotations: Annotation[]; pinch: (ratio: number, end: boolean) => void
  pinchScale: number; pan?: (x: number, y: number) => void; pageSettled: () => void
}

export default function FlipBook({ pdf, page, change, registerNavigation, width, height, spread, motion, theme, query, annotations, pinch, pinchScale, pan, pageSettled }: Props) {
  const [turn, setTurn] = useState<Turn>()
  const liveTurn = useRef<Turn | undefined>(undefined)
  const surface = useRef<HTMLDivElement>(null)
  const frame = useRef(0)
  const track = useRef<{ x: number; bottom: boolean; direction: -1 | 1; start: number; pointer: number; touch: boolean; target: number } | null>(null)
  const panTrack = useRef<{ x: number; y: number; pointer: number } | null>(null)
  const touches = useRef(new Map<number, { x: number; y: number }>())
  const initialDistance = useRef(0)
  const lastRatio = useRef(1)
  const ignoreTouch = useRef(false)
  const current = spreadStart(page, spread)

  function paintTurn(next: Turn) {
    const node = surface.current
    if (!node) return
    const curl = pageCurl(width, height, next.amount, next.forward, next.bottom, next.diagonal)
    node.style.setProperty('--fold-angle', curl.angle)
    node.style.setProperty('--crease', curl.crease)
    node.style.setProperty('--stationary-clip', curl.stationary)
    node.style.setProperty('--folded-clip', curl.folded)
    node.style.setProperty('--fold-transform', curl.reflection)
  }

  function showTurn(next?: Turn) {
    const previous = liveTurn.current
    liveTurn.current = next
    if (previous?.target !== next?.target || previous?.forward !== next?.forward) setTurn(next)
    if (next) paintTurn(next)
  }

  useLayoutEffect(() => {
    if (liveTurn.current) paintTurn(liveTurn.current)
  }, [width, height, turn])

  function settle(target: number, direction: -1 | 1, complete: boolean, from?: Turn) {
    if (frame.current) return
    if (!motion) { if (complete) change(target); showTurn(); return }
    const start = from?.amount ?? 0
    const finish = complete ? 1 : 0
    const duration = Math.max(180, 740 * Math.abs(finish - start))
    const geometry = { target, forward: direction > 0, bottom: from?.bottom ?? true, diagonal: from?.diagonal ?? .38 }
    const since = performance.now()
    function animate(now: number) {
      const time = Math.min(1, (now - since) / duration)
      const ease = time < .5 ? 2 * time * time : 1 - (-2 * time + 2) ** 2 / 2
      if (time < 1) {
        showTurn({ ...geometry, amount: start + (finish - start) * ease })
        frame.current = requestAnimationFrame(animate)
      } else {
        frame.current = 0
        showTurn()
        if (complete) change(target)
      }
    }
    showTurn({ ...geometry, amount: start })
    frame.current = requestAnimationFrame(animate)
  }

  function navigate(direction: -1 | 1) {
    const target = adjacentPage(page, direction, spread, pdf.numPages)
    if (target !== page) settle(target, direction, true)
  }
  useEffect(() => { registerNavigation(navigate) })
  useEffect(() => () => cancelAnimationFrame(frame.current), [])
  useEffect(() => {
    cancelAnimationFrame(frame.current)
    frame.current = 0
    track.current = null
    showTurn()
  }, [page, spread, motion, width, height])
  useEffect(() => {
    const next = adjacentPage(page, 1, spread, pdf.numPages)
    const previous = adjacentPage(page, -1, spread, pdf.numPages)
    const nearby = [...new Set([previous, next, ...(spread ? [next + 1] : [])])]
    const timer = window.setTimeout(() => {
      for (const number of nearby) {
        if (number !== page && number <= pdf.numPages) void pdf.getPage(number).catch(() => undefined)
      }
    }, 150)
    return () => window.clearTimeout(timer)
  }, [pdf, page, spread])

  function touchDistance() {
    const [a, b] = [...touches.current.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  }
  function down(event: ReactPointerEvent<HTMLDivElement>) {
    const touch = event.pointerType === 'touch'
    const rect = event.currentTarget.getBoundingClientRect()
    const localX = event.clientX - rect.left
    const nearLeft = localX < 53
    const nearRight = localX > rect.width - 53
    const bottom = event.clientY > rect.top + rect.height / 2
    if (touch) {
      touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      event.currentTarget.setPointerCapture(event.pointerId)
      if (touches.current.size === 2) {
        initialDistance.current = touchDistance()
        lastRatio.current = 1
        ignoreTouch.current = true
        track.current = null
        panTrack.current = null
        if (!frame.current) showTurn()
        return
      }
      if (pan && !nearLeft && !nearRight) {
        panTrack.current = { x: event.clientX, y: event.clientY, pointer: event.pointerId }
        return
      }
    }
    if (frame.current || event.button !== 0 || (!touch && !nearLeft && !nearRight)) return
    if (!touch) event.currentTarget.setPointerCapture(event.pointerId)
    const direction = localX < rect.width / 2 ? -1 : 1
    track.current = { x: event.clientX, pointer: event.pointerId, bottom, direction, start: performance.now(), touch, target: adjacentPage(page, direction, spread, pdf.numPages) }
  }
  function move(event: ReactPointerEvent<HTMLDivElement>) {
    if (touches.current.has(event.pointerId)) {
      touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (initialDistance.current > 0 && touches.current.size === 2) {
        lastRatio.current = touchDistance() / initialDistance.current
        pinch(lastRatio.current, false)
        return
      }
    }
    const panning = panTrack.current
    if (panning?.pointer === event.pointerId && !ignoreTouch.current) {
      pan?.(panning.x - event.clientX, panning.y - event.clientY)
      panning.x = event.clientX
      panning.y = event.clientY
      return
    }
    const drag = track.current
    if (!drag || drag.pointer !== event.pointerId || ignoreTouch.current) return
    const dx = event.clientX - drag.x
    if (drag.touch && Math.abs(dx) > 10) drag.direction = dx < 0 ? 1 : -1
    drag.target = adjacentPage(page, drag.direction, spread, pdf.numPages)
    if (drag.target === page || !motion) { showTurn(); return }
    const amount = Math.max(0, Math.min(.92, -dx * drag.direction / width))
    const rect = event.currentTarget.getBoundingClientRect()
    const cornerDistance = drag.bottom ? rect.bottom - event.clientY : event.clientY - rect.top
    const diagonal = Math.max(.12, Math.min(.9, cornerDistance / rect.height * 1.9))
    if (amount > .013 || liveTurn.current) showTurn({ target: drag.target, forward: drag.direction > 0, amount, bottom: drag.bottom, diagonal })
  }
  function release(event: ReactPointerEvent<HTMLDivElement>, cancelled = false) {
    touches.current.delete(event.pointerId)
    if (panTrack.current?.pointer === event.pointerId) panTrack.current = null
    if (ignoreTouch.current) {
      if (initialDistance.current > 0) { pinch(lastRatio.current, true); initialDistance.current = 0 }
      if (!touches.current.size) ignoreTouch.current = false
      return
    }
    const drag = track.current
    if (!drag || drag.pointer !== event.pointerId) return
    track.current = null
    if (drag.target === page) { showTurn(); return }
    const rect = event.currentTarget.getBoundingClientRect()
    const corner = Math.min(event.clientX - rect.left, rect.right - event.clientX) < 54
    const distance = (drag.x - event.clientX) * drag.direction
    const complete = !cancelled && (shouldFinishTurn(distance, width, performance.now() - drag.start) || (corner && Math.abs(distance) < 7))
    const currentTurn = liveTurn.current
    if (currentTurn || complete) settle(drag.target, drag.direction, complete, currentTurn?.target === drag.target ? currentTurn : undefined)
  }
  const style = { '--leaf-width': width + 'px', '--leaf-height': height + 'px', scale: pinchScale === 1 ? undefined : pinchScale } as CSSProperties
  const renderPage = (number: number, withText: boolean) =>
    number <= pdf.numPages ? <PdfPage pdf={pdf} number={number} width={width} height={height} theme={theme} text={withText} query={withText ? query : ''} annotations={annotations} cacheRaster={!withText} onSettled={withText && number === page ? pageSettled : undefined} /> : <div className={`blank-paper paper-${theme.toLowerCase()}`} />
  const target = turn && spreadStart(turn.target, spread)
  const turningRightLeaf = spread && turn?.forward
  return <div ref={surface} className={`flipbook ${spread ? 'spread' : 'single'}`} data-theme={theme.toLowerCase()} style={style} onPointerDown={down} onPointerMove={move} onPointerUp={event => release(event)} onPointerCancel={event => release(event, true)}>
    {turn && target && <div className="turn-layer turn-underneath leaf" data-right={turningRightLeaf} aria-hidden="true" inert>
      {renderPage(target + (turningRightLeaf ? 1 : 0), false)}
    </div>}
    <div className="spread-pages">
      <div className={`leaf ${turn && !turningRightLeaf ? 'turn-stationary' : ''}`}>{renderPage(current, true)}</div>
      {spread && <div className={`leaf ${turn && turningRightLeaf ? 'turn-stationary' : ''}`}>{renderPage(current + 1, true)}</div>}
    </div>
    {turn && target && <div className="turn-layer turn-leaf" data-right={turningRightLeaf} aria-hidden="true" inert>
      <div className="turn-back">
        {spread && <div className="turn-back-print">{renderPage(target + (turn.forward ? 0 : 1), false)}</div>}
      </div>
    </div>}
  </div>
}
