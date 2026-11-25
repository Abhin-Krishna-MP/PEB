import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { MessageCircle } from 'lucide-react'
import { questionForPage, quietQuestion, type CompanionQuestion } from '../lib/companion'
import type { CompanionMode } from '../lib/model'
import kitten from '../assets/reading-companion.webp'

const readingPause = 65_000
const questionCooldown = 150_000

export default function ReadingCompanion({ page, mode, available, reducedMotion, readPage, inset }: {
  page: number
  mode: CompanionMode
  available: boolean
  reducedMotion: boolean
  readPage: (number: number) => Promise<string>
  inset: number
}) {
  const panelId = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const attempt = useRef(0)
  const asked = useRef(new Set<number>())
  const lastQuestion = useRef(0)
  const [tabVisible, setTabVisible] = useState(() => !document.hidden)
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<{ page: number; question: CompanionQuestion }>()
  const visible = available && mode !== 'Off' && tabVisible
  const question = result?.page === page ? result.question : undefined

  useEffect(() => {
    const sync = () => setTabVisible(!document.hidden)
    document.addEventListener('visibilitychange', sync)
    return () => document.removeEventListener('visibilitychange', sync)
  }, [])

  useEffect(() => {
    setResult(undefined)
    setPending(false)
    return () => { attempt.current++ }
  }, [page, visible, mode])

  const ask = useCallback(async (automatic: boolean) => {
    if (!visible || document.hidden || document.querySelector('dialog[open]')) return
    if (automatic && window.getSelection()?.type === 'Range') return
    const id = ++attempt.current
    if (automatic) asked.current.add(page)
    else setPending(true)
    let next: CompanionQuestion | undefined
    try {
      next = questionForPage(await readPage(page), page)
    } catch {
      // Some scanned or protected documents offer no usable text.
    }
    if (id !== attempt.current) return
    setPending(false)
    if (document.hidden || document.querySelector('dialog[open]')) return
    if (automatic && (!next || window.getSelection()?.type === 'Range')) return
    asked.current.add(page)
    lastQuestion.current = Date.now()
    setResult({ page, question: next ?? quietQuestion })
  }, [visible, page, readPage])

  useEffect(() => {
    if (!visible || mode !== 'Occasional' || question || pending || asked.current.has(page)) return
    const delay = Math.max(readingPause, lastQuestion.current + questionCooldown - Date.now())
    const timer = window.setTimeout(() => void ask(true), delay)
    return () => window.clearTimeout(timer)
  }, [visible, mode, page, ask, question, pending])

  function dismiss() {
    setResult(undefined)
    trigger.current?.focus({ preventScroll: true })
  }

  if (!visible) return null
  return <aside className={`reading-companion ${reducedMotion ? 'companion-still' : ''}`} aria-label="Reading companion" style={{ right: inset }}
    onKeyDown={event => {
      if (event.key === 'Escape' && question) { event.stopPropagation(); dismiss() }
    }}>
    <div className="companion-entry" aria-live="polite">
      {question && <div id={panelId} className="companion-question">
        <h2><MessageCircle size={15} /> A thought from your companion</h2>
        {question.excerpt && <blockquote>“{question.excerpt}”</blockquote>}
        <p>{question.prompt}</p>
        <button className="secondary-button" onClick={dismiss}>Keep reading</button>
      </div>}
      {pending && <span className="companion-thinking" role="status">Thinking…</span>}
    </div>
    <button ref={trigger} className="companion-pet" aria-label={question ? 'Dismiss reading companion question' : 'Ask reading companion'}
      aria-expanded={!!question} aria-controls={question ? panelId : undefined} aria-disabled={pending}
      title={question ? 'Dismiss question' : 'Ask a question about this page'}
      onClick={() => { if (question) dismiss(); else if (!pending) void ask(false) }}>
      <img src={kitten} alt="" width={96} height={96} draggable={false} />
    </button>
  </aside>
}
