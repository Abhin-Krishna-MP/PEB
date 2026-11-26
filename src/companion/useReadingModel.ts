import { useCallback, useEffect, useRef, useState } from 'react'
import { openReadingModel } from './client'
import { expressions, type Emotion, type ReadingPrediction } from './inference'
import { useSmartSpirit } from './smartSpirit'

function namesIn(text: string) {
  return Array.from(text.matchAll(/\b(?:named|called|name was|introduced (?:herself|himself) as)\s+([A-Z][a-z]{1,24})\b|(?:^|[.!?]\s+)([A-Z][a-z]{1,24})\s+(?:said|asked|replied|whispered|walked|smiled|thought)\b/g),
    match => match[1] ?? match[2]).filter(name => !/^(?:He|She|They|We|It|There|Someone|Everyone)$/.test(name))
}

export function useReadingModel(available: boolean, page: number) {
  const status = useSmartSpirit(state => state.status)
  const model = status.kind === 'ready' ? status.download.model : undefined
  const worker = useRef<ReturnType<typeof openReadingModel> | undefined>(undefined)
  const pending = useRef<{ page: number; controller: AbortController; result: Promise<ReadingPrediction | undefined> } | undefined>(undefined)
  const latestPage = useRef(page)
  latestPage.current = page
  const history = useRef<{ page: number; mood: Emotion } | undefined>(undefined)
  const known = useRef(new Map<string, number>())
  const [expression, setExpression] = useState<{ page: number; mood: Emotion }>()

  const cancel = useCallback(() => {
    pending.current?.controller.abort()
    pending.current = undefined
  }, [])

  useEffect(() => {
    void useSmartSpirit.getState().check()
  }, [])

  useEffect(() => {
    if (!available || !model) return
    try { worker.current = openReadingModel() }
    catch { useSmartSpirit.getState().unavailable() }
    return () => {
      cancel()
      worker.current?.close()
      worker.current = undefined
    }
  }, [available, model, cancel])

  useEffect(() => cancel, [page, cancel])

  const analyze = useCallback((text: string, number: number, recent: readonly string[]) => {
    const client = worker.current
    if (!model || !client || !text.trim() || latestPage.current !== number) return
    if (pending.current?.page === number) return pending.current.result
    cancel()
    const controller = new AbortController()
    const previous = [...known.current].filter(([, earlier]) => earlier < number).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([person]) => person)
    const last = history.current
    const previousMood = last && number > last.page && number - last.page <= 2 ? last.mood : undefined
    const result = client.predict(model, { text, recent, previous, previousMood }, controller.signal).then(outcome => {
      if (controller.signal.aborted || latestPage.current !== number) return
      if (outcome.timedOut) worker.current = undefined
      if (outcome.unavailable) useSmartSpirit.getState().unavailable()
      if (outcome.result) {
        history.current = { page: number, mood: outcome.result.mood }
        setExpression(history.current)
      }
      return outcome.result
    })
    pending.current = { page: number, controller, result }
    return result
  }, [model, cancel])

  const rememberNames = useCallback((text: string, number: number) => {
    for (const name of namesIn(text.slice(0, 8_000))) {
      if (!known.current.has(name) || known.current.get(name)! > number) known.current.set(name, number)
    }
    while (known.current.size > 120) known.current.delete(known.current.keys().next().value!)
  }, [])

  const mood = model && available && expression && expression.mood !== 'quiet' && Math.abs(page - expression.page) <= 2
    ? expressions[expression.mood][0] : undefined
  return { mood, analyze, cancel, enabled: Boolean(model && available), rememberNames }
}
