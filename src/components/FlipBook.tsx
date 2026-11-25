import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { adjacentPage, shouldFinishTurn, spreadStart } from '../lib/flip'
import type { Annotation, Theme } from '../lib/model'
import PdfPage from './PdfPage'

type Turn = { target: number; forward: boolean; amount: number; settling: boolean }
interface Props {
  pdf: PDFDocumentProxy; page: number; change: (number: number) => void; registerNavigation: (handler: (direction: -1 | 1) => void) => void
  width: number; height: number; spread: boolean; motion: boolean; theme: Theme
  query: string; annotations: Annotation[]; pinch: (ratio: number, end: boolean) => void
  pinchScale: number; pan?: (x: number, y: number) => void
}

export default function FlipBook({ pdf, page, change, registerNavigation, width, height, spread, motion, theme, query, annotations, pinch, pinchScale, pan }: Props) {
  const [turn, setTurn] = useState<Turn>()
  const timer = useRef(0)
  const frame = useRef(0)
  const track = useRef<{ x: number; direction: -1 | 1; start: number; pointer: number; touch: boolean; target: number } | null>(null)
  const panTrack = useRef<{ x: number; y: number; pointer: number } | null>(null)
  const touches = useRef(new Map<number, { x: number; y: number }>())
  const initialDistance = useRef(0)
  const lastRatio = useRef(1)
  const ignoreTouch = useRef(false)
  const current = spreadStart(page, spread)

  function settle(target: number, direction: -1 | 1, complete: boolean, from = 0) {
    if (timer.current) return
    if (!motion) { if (complete) change(target); setTurn(undefined); return }
    const data = { target, forward: direction > 0 }
    setTurn({ ...data, amount: from, settling: false })
    frame.current = requestAnimationFrame(() => {
      frame.current = requestAnimationFrame(() => setTurn({ ...data, amount: complete ? 1 : 0, settling: true }))
    })
    timer.current = window.setTimeout(() => {
      timer.current = 0
      setTurn(undefined)
      if (complete) change(target)
    }, 445)
  }

  function navigate(direction: -1 | 1) {
    const target = adjacentPage(page, direction, spread, pdf.numPages)
    if (target !== page) settle(target, direction, true)
  }
  useEffect(() => { registerNavigation(navigate) })
  useEffect(() => () => { window.clearTimeout(timer.current); cancelAnimationFrame(frame.current) }, [])
  useEffect(() => {
    window.clearTimeout(timer.current)
    cancelAnimationFrame(frame.current)
    timer.current = 0
    track.current = null
    setTurn(undefined)
  }, [page, spread])
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
    if (touch) {
      touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      event.currentTarget.setPointerCapture(event.pointerId)
      if (touches.current.size === 2) {
        initialDistance.current = touchDistance()
        lastRatio.current = 1
        ignoreTouch.current = true
        track.current = null
        panTrack.current = null
        if (!timer.current) setTurn(undefined)
        return
      }
      if (pan && !nearLeft && !nearRight) {
        panTrack.current = { x: event.clientX, y: event.clientY, pointer: event.pointerId }
        return
      }
    }
    if (timer.current || event.button !== 0 || (!touch && !nearLeft && !nearRight)) return
    if (!touch) event.currentTarget.setPointerCapture(event.pointerId)
    const direction = localX < rect.width / 2 ? -1 : 1
    track.current = { x: event.clientX, pointer: event.pointerId, direction, start: performance.now(), touch, target: adjacentPage(page, direction, spread, pdf.numPages) }
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
    if (drag.target === page || !motion) return
    const amount = Math.max(0, Math.min(.92, -dx * drag.direction / width))
    if (amount > .013 || turn) setTurn({ target: drag.target, forward: drag.direction > 0, amount, settling: false })
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
    if (drag.target === page) { setTurn(undefined); return }
    const rect = event.currentTarget.getBoundingClientRect()
    const corner = Math.min(event.clientX - rect.left, rect.right - event.clientX) < 54
    const distance = (drag.x - event.clientX) * drag.direction
    const complete = !cancelled && (shouldFinishTurn(distance, width, performance.now() - drag.start) || (corner && Math.abs(distance) < 7))
    if (turn || complete) settle(drag.target, drag.direction, complete, turn?.amount)
  }
  const style = { '--leaf-width': width + 'px', '--leaf-height': height + 'px', scale: pinchScale === 1 ? undefined : pinchScale } as CSSProperties
  const renderPage = (number: number, withText: boolean) =>
    number <= pdf.numPages ? <PdfPage pdf={pdf} number={number} width={width} height={height} theme={theme} text={withText} query={withText ? query : ''} annotations={annotations} /> : <div className={`blank-paper paper-${theme.toLowerCase()}`} />
  const target = turn && spreadStart(turn.target, spread)
  return <div className={`flipbook ${spread ? 'spread' : 'single'}`} style={style} onPointerDown={down} onPointerMove={move} onPointerUp={event => release(event)} onPointerCancel={event => release(event, true)}>
    <div className="spread-pages">
      <div className="leaf">{renderPage(current, true)}</div>
      {spread && <div className="leaf">{renderPage(current + 1, true)}</div>}
    </div>
    {turn && target && <div className="turn-layer" aria-hidden="true" inert>
      <div className="turn-underneath" data-forward={turn.forward}>{renderPage(target + (spread && turn.forward ? 1 : 0), false)}</div>
      <div className={`turn-leaf ${turn.settling ? 'settling' : ''}`} data-forward={turn.forward} style={{ '--turn': turn.amount } as CSSProperties}>
        <div className="turn-front">{renderPage(current + (spread && turn.forward ? 1 : 0), false)}</div>
        <div className="turn-back">{renderPage(target + (spread && !turn.forward ? 1 : 0), false)}</div>
      </div>
    </div>}
  </div>
}
