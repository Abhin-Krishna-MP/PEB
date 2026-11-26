import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { BookOpen, Bookmark, Check, Link2, MessageCircle, Sparkles, X } from 'lucide-react'
import { quietTapLine, reactionForPage, type BeatKind, type SpiritMood } from '../lib/companion'
import { pageInsight, relatedPage, type PageInsight } from '../lib/readingInsights'
import type { CompanionMode } from '../lib/model'
import BookSpirit from './BookSpirit'
import { useReadingModel } from '../companion/useReadingModel'
import { expressions, type ReadingPrediction } from '../companion/inference'

type Action = 'recap' | 'question' | 'bookmark' | 'connect'
type Moment = { reactionId?: number; page: number; mood: SpiritMood; kind?: BeatKind; line?: string; action?: Action }
const speechCooldown = 72_000
const noticeTime = {
  doubt: 920, deception: 1120, surprise: 260, danger: 880, unease: 1380, humor: 450, grief: 1260, relief: 720, warmth: 800,
}

export default function ReadingCompanion({ page, otherPage, total, mode, available, reducedMotion, readPage, inset, bottom, bookmarked, saveBookmark }: {
  page: number
  otherPage?: number
  total: number
  mode: CompanionMode
  available: boolean
  reducedMotion: boolean
  readPage: (number: number) => Promise<string>
  inset: number
  bottom: number
  bookmarked: boolean
  saveBookmark: () => Promise<void>
}) {
  const bubbleId = useId()
  const promptsId = useId()
  const root = useRef<HTMLElement>(null)
  const sparkle = useRef<HTMLButtonElement>(null)
  const attempt = useRef(0)
  const animationTimers = useRef<number[]>([])
  const reactedPages = useRef(new Set<number>())
  const seenBeats = useRef(new Set<string>())
  const recentLines = useRef<string[]>([])
  const previousBeat = useRef<{ page: number; kind: BeatKind } | null>(null)
  const memories = useRef(new Map<number, PageInsight>())
  const lastVisit = useRef<{ page: number; start: number } | undefined>(undefined)
  const dwellTimes = useRef<number[]>([])
  const lastSpeech = useRef(-Infinity)
  const spokenTurns = useRef({ automatic: 0, tap: 0 })
  const [tabVisible, setTabVisible] = useState(() => !document.hidden)
  const [moment, setMoment] = useState<Moment>()
  const [idle, setIdle] = useState<SpiritMood>('happy')
  const [prompts, setPrompts] = useState(false)
  const [insight, setInsight] = useState<PageInsight>()
  const visible = available && mode !== 'Off' && tabVisible
  const { mood: storyMood, analyze } = useReadingModel({ available: visible, page, otherPage, readPage })
  const current = moment?.page === page ? moment : undefined
  const connection = insight && relatedPage(insight, page, memories.current)

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

  const remember = useCallback((text: string) => {
    const memory = memories.current
    const entry = memory.get(page) ?? pageInsight(text)
    if (entry.terms.length) {
      memory.set(page, entry)
      if (memory.size > 80) memory.delete(memory.keys().next().value!)
    }
    setInsight(entry)
    return entry
  }, [page])

  useEffect(() => {
    setMoment(undefined)
    setPrompts(false)
    setIdle('happy')
    setInsight(undefined)
    if (!visible) {
      lastVisit.current = undefined
      return cancel
    }
    const now = Date.now()
    const last = lastVisit.current
    if (last && page > last.page && page - last.page <= 2) {
      const duration = now - last.start
      if (duration >= 10_000 && duration <= 180_000) dwellTimes.current = [...dwellTimes.current.slice(-4), duration]
    }
    lastVisit.current = { page, start: now }
    let active = true
    const concentrate = window.setTimeout(async () => {
      setIdle('focused')
      try {
        const text = await readPage(page)
        if (active) remember(text)
      } catch { /* Text-free pages still support the reading companion. */ }
    }, 12_000)
    const rest = window.setTimeout(() => setIdle('sleepy'), 120_000)
    return () => {
      active = false
      window.clearTimeout(concentrate)
      window.clearTimeout(rest)
      cancel()
    }
  }, [page, visible, mode, readPage, remember, cancel])

  useEffect(() => {
    if (!prompts) return
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setPrompts(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [prompts])

  const perform = useCallback(async (words?: number, action?: Action) => {
    const automatic = words !== undefined
    const interrupted = () => document.hidden || !!document.querySelector('dialog[open]') || (automatic && window.getSelection()?.type === 'Range')
    if (!visible || interrupted() || (automatic && reactedPages.current.has(page))) return
    cancel()
    setPrompts(false)
    setMoment(automatic ? undefined : { page, mood: 'curious' })
    const token = attempt.current
    const previous = previousBeat.current
    const recent = previous && previous.page <= page && page - previous.page <= 2 ? previous.kind : undefined
    const turn = automatic ? 'automatic' : 'tap'
    const preferQuestion = action === 'question' || spokenTurns.current[turn] % 2 === (automatic ? 1 : 0)
    let text = ''
    try {
      text = await readPage(page)
    } catch { /* A scanned page can still have a bookmark or a quiet reply. */ }
    if (token !== attempt.current || interrupted()) return
    const full = remember(text)
    const entry = words === undefined ? full : pageInsight(text.split(/\s+/).slice(0, words).join(' '))
    const related = relatedPage(entry, page, memories.current)
    const relatedLine = related && (related.chapter && related.chapter !== entry.chapter
      ? `We saw “${related.topic}” in chapter ${related.chapter}, on page ${related.page}. Does it feel different here?`
      : `Remember “${related.topic}” on page ${related.page}? Here it is again.`)
    let reaction = reactionForPage(text, { words, seen: seenBeats.current, recent: action === 'question' ? [] : recentLines.current, previous: recent, preferQuestion })
    if (action === 'question' || (!action && !reaction)) {
      const excerpt = words === undefined ? text.slice(0, 9600) : text.split(/\s+/).slice(0, words).join(' ')
      const request = excerpt.trim() && analyze(excerpt, page, true)
      let prediction: ReadingPrediction | undefined
      if (request) {
        if (automatic) prediction = await request
        else {
          // Keep taps responsive while the worker warms up. Its timeout never
          // blocks the page or the existing on-demand reply.
          let wait: number | undefined
          prediction = await Promise.race([
            request, new Promise<undefined>(resolve => { wait = window.setTimeout(resolve, 470) }),
          ])
          window.clearTimeout(wait)
        }
      }
      if (token !== attempt.current || interrupted()) return
      const highlight = prediction?.moment
      if (highlight?.question && !recentLines.current.includes(highlight.question) &&
          (!automatic || !seenBeats.current.has(highlight.stamp))) {
        const [mood, kind] = expressions[highlight.mood]
        reaction = { mood, kind, line: highlight.question, strength: 6, stamp: highlight.stamp }
      }
    }
    let expression: Moment = { page, mood: reaction?.mood ?? 'curious', kind: reaction?.kind }
    let line = reaction?.line
    if (action === 'bookmark') {
      expression = { page, mood: 'encouraging' }
      try {
        await saveBookmark()
        line = `I’ve marked page ${page} for you.`
      } catch { line = 'I couldn’t save that bookmark. Shall we try again?' }
      if (token !== attempt.current || interrupted()) return
    } else if (action === 'recap') {
      expression = { page, mood: 'focused' }
      line = entry.recap ?? (entry.terms.length ? `A few threads on this page: ${entry.terms.slice(0, 3).join(', ')}.` : 'I can’t pick out a passage to recap on this page.')
    } else if (action === 'connect' && relatedLine) {
      expression = { page, mood: 'curious' }
      line = relatedLine
    } else if (action === 'question' && !reaction) {
      line = entry.topic ? `Where else might we come across “${entry.topic}”?` : 'Which detail do you think we’ll remember when we turn the page?'
    } else if (!automatic && !reaction && entry.topic) {
      const lines = [`What do you make of “${entry.topic}” so far?`, `I keep noticing “${entry.topic}” here.`]
      line = lines.find(candidate => !recentLines.current.includes(candidate)) ?? lines[0]
    } else if (!reaction && automatic) {
      const cameFromNearby = memories.current.has(page - 1) || memories.current.has(page - 2)
      if (total > 3 && cameFromNearby && (page === total || page === Math.ceil(total / 2))) {
        expression = { page, mood: 'encouraging', action: bookmarked ? undefined : 'bookmark' }
        line = page === total ? 'The last page. I’m glad we read this together.' : 'Halfway through. Look how far we’ve come!'
        if (!bookmarked) line += ' Shall I mark our place?'
      } else return
    }
    if (reaction && !action) previousBeat.current = { page, kind: reaction.kind }
    expression.reactionId = token
    setMoment(expression)
    if (automatic && Date.now() - lastSpeech.current < speechCooldown) {
      animationTimers.current.push(window.setTimeout(() => setMoment(undefined), 3600))
      return
    }
    const reply = line ?? quietTapLine(text, recentLines.current)
    const showLine = () => {
      if (interrupted()) { setMoment(undefined); return }
      reactedPages.current.add(page)
      if (reaction && (!action || action === 'question')) seenBeats.current.add(reaction.stamp)
      spokenTurns.current[turn]++
      recentLines.current = [reply, ...recentLines.current].slice(0, 6)
      lastSpeech.current = Date.now()
      setMoment({ ...expression, line: reply })
      animationTimers.current.push(window.setTimeout(() => setMoment(undefined), Math.max(expression.action ? 14_000 : 6500, reply.length * 100)))
    }
    if (automatic && reaction) {
      animationTimers.current.push(window.setTimeout(showLine, noticeTime[reaction.kind] + (reaction.strength < 6 ? 180 : 0)))
    } else showLine()
  }, [visible, page, total, readPage, cancel, remember, bookmarked, saveBookmark, analyze])

  useEffect(() => {
    if (!visible || mode !== 'Occasional' || prompts) return
    // Wait for three ordinary forward turns before adapting to this reading session.
    const times = [...dwellTimes.current].sort((a, b) => a - b)
    const firstProbe = times.length < 3 ? 34_000 : Math.min(52_000, Math.max(22_000, times[Math.floor(times.length / 2)] * .6))
    const early = window.setTimeout(() => void perform(115), firstProbe)
    const later = window.setTimeout(() => void perform(245), firstProbe + 40_000)
    return () => { window.clearTimeout(early); window.clearTimeout(later) }
  }, [visible, mode, page, perform, prompts])

  function dismiss() {
    cancel()
    setPrompts(false)
    setMoment(undefined)
  }

  function togglePrompts() {
    dismiss()
    if (prompts) return
    setPrompts(true)
    const token = attempt.current
    void readPage(page).then(text => { if (attempt.current === token) remember(text) }).catch(() => undefined)
  }

  if (!visible) return null
  return <aside ref={root} className={`reading-companion ${reducedMotion ? 'companion-still' : ''}`} aria-label="Reading companion" style={{ right: inset, bottom }}
    onKeyDown={event => {
      if (event.key === 'Escape' && (current || prompts)) { event.stopPropagation(); dismiss(); sparkle.current?.focus() }
    }}>
    <div id={bubbleId} className="companion-voice" role="status" aria-atomic="true">
      {current?.line && <div className="spirit-speech">
        <button className="companion-bubble" title="Dismiss reaction" onClick={dismiss}>{current.line}</button>
        {current.action && <button className="spirit-answer" onClick={() => void perform(undefined, current.action)}>{current.action === 'bookmark' ? 'Bookmark page' : 'Quick recap'}</button>}
      </div>}
    </div>
    <div className="spirit-perch">
      <BookSpirit page={page} reactionId={current?.reactionId} mood={current?.mood ?? (idle === 'sleepy' ? idle : storyMood ?? idle)} beat={current?.kind} speaking={!!current?.line}
        reducedMotion={reducedMotion} bubbleId={bubbleId} onTap={() => void perform()} />
      <button ref={sparkle} className="spirit-toggle" aria-label="Companion prompts" aria-controls={promptsId} aria-expanded={prompts}
        title="Companion prompts" onClick={togglePrompts}>{prompts ? <X size={15} /> : <Sparkles size={16} />}</button>
    </div>
    {prompts && <div id={promptsId} className="spirit-prompts" role="group" aria-label="Companion prompts">
      <button onClick={() => { sparkle.current?.focus(); void perform(undefined, 'recap') }}><BookOpen />Quick recap</button>
      <button onClick={() => { sparkle.current?.focus(); void perform(undefined, 'question') }}><MessageCircle />Ask me a question</button>
      {connection && <button onClick={() => { sparkle.current?.focus(); void perform(undefined, 'connect') }}><Link2 />Connect to page {connection.page}</button>}
      <button disabled={bookmarked} onClick={() => { sparkle.current?.focus(); void perform(undefined, 'bookmark') }}>{bookmarked ? <Check /> : <Bookmark />}{bookmarked ? 'Page bookmarked' : 'Bookmark this page'}</button>
    </div>}
  </aside>
}
