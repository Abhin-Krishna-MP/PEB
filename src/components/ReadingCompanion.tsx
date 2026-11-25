import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { reactionForPage, type Reaction, type BeatKind, type KittenMood } from '../lib/companion'
import type { CompanionMode } from '../lib/model'

type Moment = { page: number; mood: KittenMood; kind?: BeatKind; line?: string }
const speechCooldown = 72_000
const noticeTime = {
  doubt: 920, deception: 1120, surprise: 260, danger: 880, unease: 1380, humor: 450, grief: 1260, relief: 720, warmth: 800,
}

export default function ReadingCompanion({ page, mode, available, reducedMotion, readPage, inset }: {
  page: number
  mode: CompanionMode
  available: boolean
  reducedMotion: boolean
  readPage: (number: number) => Promise<string>
  inset: number
}) {
  const bubbleId = useId()
  const attempt = useRef(0)
  const animationTimers = useRef<number[]>([])
  const reactedPages = useRef(new Set<number>())
  const seenBeats = useRef(new Set<string>())
  const recentLines = useRef<string[]>([])
  const previousBeat = useRef<{ page: number; kind: BeatKind } | null>(null)
  const lastSpeech = useRef(-Infinity)
  const [tabVisible, setTabVisible] = useState(() => !document.hidden)
  const [moment, setMoment] = useState<Moment>()
  const visible = available && mode !== 'Off' && tabVisible
  const current = moment?.page === page ? moment : undefined

  useEffect(() => {
    const sync = () => setTabVisible(!document.hidden)
    document.addEventListener('visibilitychange', sync)
    return () => document.removeEventListener('visibilitychange', sync)
  }, [])

  const cancel = useCallback(() => {
    attempt.current++
    for (const timer of animationTimers.current) window.clearTimeout(timer)
    animationTimers.current = []
  }, [])

  useEffect(() => {
    setMoment(undefined)
    return cancel
  }, [page, visible, mode, cancel])

  const perform = useCallback(async (words?: number) => {
    const automatic = words !== undefined
    const interrupted = () => document.hidden || !!document.querySelector('dialog[open]') || (automatic && window.getSelection()?.type === 'Range')
    if (!visible || interrupted() || (automatic && reactedPages.current.has(page))) return
    cancel()
    setMoment(undefined)
    const token = attempt.current
    const previous = previousBeat.current
    const recent = previous && previous.page <= page && page - previous.page <= 2 ? previous.kind : undefined
    let reaction: Reaction | undefined
    try {
      reaction = reactionForPage(await readPage(page), { words, seen: seenBeats.current, recent: recentLines.current, previous: recent })
    } catch {
      // A missing text layer leaves the companion reading quietly.
    }
    if (token !== attempt.current || interrupted()) return
    if (!reaction) {
      if (!automatic) {
        setMoment({ page, mood: 'curious' })
        animationTimers.current.push(window.setTimeout(() => setMoment(undefined), 2000))
      }
      return
    }

    reactedPages.current.add(page)
    seenBeats.current.add(reaction.stamp)
    previousBeat.current = { page, kind: reaction.kind }
    const expression = { page, mood: reaction.mood, kind: reaction.kind }
    setMoment(expression)
    if (automatic && Date.now() - lastSpeech.current < speechCooldown) {
      animationTimers.current.push(window.setTimeout(() => setMoment(undefined), 3600))
      return
    }

    const { kind, line } = reaction
    const showLine = () => {
      if (interrupted()) { setMoment(undefined); return }
      recentLines.current = [line, ...recentLines.current].slice(0, 6)
      lastSpeech.current = Date.now()
      setMoment({ ...expression, line })
      animationTimers.current.push(window.setTimeout(() => setMoment(undefined), Math.max(5400, line.length * 91)))
    }
    animationTimers.current.push(window.setTimeout(showLine, noticeTime[kind] + (reaction.strength < 6 ? 180 : 0)))
  }, [visible, page, readPage, cancel])

  useEffect(() => {
    if (!visible || mode !== 'Occasional') return
    const early = window.setTimeout(() => void perform(115), 34_000)
    const later = window.setTimeout(() => void perform(245), 74_000)
    return () => { window.clearTimeout(early); window.clearTimeout(later) }
  }, [visible, mode, page, perform])

  function dismiss() {
    cancel()
    setMoment(undefined)
  }

  if (!visible) return null
  return <aside className={`reading-companion ${reducedMotion ? 'companion-still' : ''}`} aria-label="Reading companion" style={{ right: inset }}
    onKeyDown={event => {
      if (event.key === 'Escape' && current) { event.stopPropagation(); dismiss() }
    }}>
    <div id={bubbleId} className="companion-voice" role="status" aria-atomic="true">
      {current?.line && <p className="companion-bubble">{current.line}</p>}
    </div>
    <button className="companion-pet" aria-label={current?.line ? 'Dismiss kitten reaction' : 'See kitten reaction'}
      aria-expanded={!!current?.line} aria-controls={bubbleId}
      title={current?.line ? 'Dismiss reaction' : 'See the kitten’s reaction'}
      onClick={() => { if (current?.line) dismiss(); else void perform() }}>
      <span className="companion-sprite" data-mood={current?.mood ?? 'reading'} data-beat={current?.kind} aria-hidden="true" />
    </button>
  </aside>
}
