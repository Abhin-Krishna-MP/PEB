export type CompanionQuestion = { excerpt?: string; prompt: string }

const sentenceSegmenter = new Intl.Segmenter('en', { granularity: 'sentence' })
const cues = [
  { pattern: /\b(hesitated|paused|wondered|unsure|uncertain|reluctant)\b/i, prompt: 'What might be behind that hesitation or uncertainty?' },
  { pattern: /\b(decided|chose|refused|agreed|promised)\b/i, prompt: 'What might be at stake in that choice?' },
  { pattern: /\b(secret|hid|hidden|whispered|unopened)\b/i, prompt: 'What might be worth keeping an eye on here?' },
  { pattern: /\?[”"’']?$/, prompt: 'How would you answer the question raised here?' },
  { pattern: /\b(suddenly|instead|but|although|yet)\b/i, prompt: 'What changes in this moment, and why might it matter?' },
]
const reflections = [
  'What detail here might matter later?',
  'What does this passage make you curious about?',
  'Which word or detail changes how you read this passage?',
]

export function questionForPage(text: string, page: number): CompanionQuestion | undefined {
  if (!text.trim()) return
  const passages = Array.from(sentenceSegmenter.segment(text.slice(0, 12_000)), item => item.segment.trim())
    .filter(passage => passage.length >= 28 && (passage.match(/\p{L}+/gu)?.length ?? 0) >= 5)
  if (!passages.length) return
  const withCue = passages.flatMap(excerpt => {
    const cue = cues.find(({ pattern }) => pattern.test(excerpt))
    return cue ? [{ excerpt, prompt: cue.prompt }] : []
  })
  const pool = withCue.length ? withCue : passages.map((excerpt, index) => ({
    excerpt, prompt: reflections[(index + page - 1) % reflections.length],
  }))
  const { excerpt, prompt } = pool[(page - 1) % pool.length]
  const quote = excerpt.length <= 185 ? excerpt : excerpt.slice(0, 185).replace(/\s+\S+$/, '') + '…'
  return { excerpt: quote, prompt }
}

export const quietQuestion: CompanionQuestion = { prompt: 'What stood out on this page, and what did it make you wonder?' }
