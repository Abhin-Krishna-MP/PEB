import { useCallback, useEffect, useRef, useState } from 'react'
import { openReadingModel } from './client'
import { expressions, labels, type Emotion } from './inference'

type Context = {
  available: boolean
  page: number
  otherPage?: number
  readPage: (page: number) => Promise<string>
}

export function useReadingModel({ available, page, otherPage, readPage }: Context) {
  const worker = useRef<ReturnType<typeof openReadingModel>>(undefined)
  const history = useRef<{ page: number; scores: number[] }>(undefined)
  const known = useRef(new Map<string, number>())
  const [expression, setExpression] = useState<{ page: number; mood: Exclude<Emotion, 'quiet'> }>()
  const analyze = useCallback((text: string, page: number, questions = false) => {
    const previous = [...known.current].filter(([, number]) => number < page).map(([person]) => person)
    return worker.current?.predict({ text, questions, previous })
  }, [])

  useEffect(() => {
    if (!available) return
    const client = openReadingModel()
    worker.current = client
    return () => {
      worker.current = undefined
      client?.close()
    }
  }, [available])

  useEffect(() => {
    if (!available) return
    let active = true
    const timer = window.setTimeout(async () => {
      const visible = otherPage === undefined ? [page] : [page, otherPage]
      const predictions = await Promise.all(visible.map(async number => {
        try {
          const text = (await readPage(number)).split(/\s+/).slice(0, 115).join(' ')
          if (active && text.trim()) return await analyze(text, number)
        } catch { /* The companion can still sit with scanned or unreadable pages. */ }
      }))
      if (!active) return
      predictions.forEach((prediction, index) => {
        const person = prediction?.moment?.person
        if (!person) return
        const prior = known.current.get(person)
        if (prior === undefined || visible[index] < prior) known.current.set(person, visible[index])
        if (known.current.size > 120) known.current.delete(known.current.keys().next().value!)
      })
      const [primary, secondary] = predictions
      if (!primary && !secondary) { setExpression(undefined); history.current = undefined; return }
      const current = labels.map((_, i) => primary && secondary ? primary.scores[i] * .72 + secondary.scores[i] * .28 :
        (primary ?? secondary)!.scores[i])
      const previous = history.current
      const adjacent = previous && page > previous.page && page - previous.page <= 2
      const scores = adjacent ? current.map((score, i) => score * .78 + previous.scores[i] * .22) : current
      history.current = { page, scores }
      const confidence = Math.max(...scores)
      const mood = labels[scores.indexOf(confidence)]
      setExpression(mood === 'quiet' || confidence < .48 ? undefined : { page, mood })
    }, 280)
    return () => { active = false; window.clearTimeout(timer) }
  }, [available, page, otherPage, readPage, analyze])

  // The old pose can carry across a neighboring page while its text is read.
  const mood = available && expression && Math.abs(page - expression.page) <= 2 ? expressions[expression.mood][0] : undefined
  return { mood, analyze }
}
