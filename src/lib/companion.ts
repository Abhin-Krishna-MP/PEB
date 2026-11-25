export type CompanionQuestion = { excerpt?: string; prompt: string }

const sentenceSegmenter = new Intl.Segmenter('en', { granularity: 'sentence' })
const subject = String.raw`\b(?<actor>[Hh]e|[Ss]he|[Tt]hey|[Ii]|[Ww]e|[Yy]ou|(?:[Tt]he|[Aa]n?) +[\p{Ll}'’-]+(?: +[\p{Ll}'’-]+){0,2}|\p{Lu}[\p{L}'’-]+(?: +\p{Lu}[\p{L}'’-]+)?)`
const action = String.raw`(?<detail>[^.!?;“”"]+)`
const hesitation = new RegExp(subject + String.raw` +(?<verb>hesitated|paused) +` + action, 'u')
const choice = new RegExp(subject + String.raw` +(?<verb>decided|chose|refused|promised|agreed) +to +` + action, 'u')
const discovery = new RegExp(subject + String.raw` +(?<verb>noticed|found|discovered|saw|heard|hid|concealed|tucked|buried) +` + action, 'u')

function shorten(text: string, max: number) {
  if (text.length <= max) return text
  return text.slice(0, max).replace(/\s+\S*$/, '').trimEnd() + '…'
}

function actorLabel(actor: string) {
  if (/^(I|we|you)$/i.test(actor)) return 'the person speaking'
  return actor.replace(/^(He|She|They|The|A|An)\b/, word => word.toLowerCase())
}

function phrase(text: string) {
  const clause = text.split(/,\s+(?:and|but|so|while)\b/i)[0]
  return shorten(clause.trim().replace(/[,–—:]+$/, ''), 86)
}

function storyPrompts(excerpt: string): string[] {
  const pause = hesitation.exec(excerpt)?.groups
  if (pause) {
    const actor = actorLabel(pause.actor)
    const detail = phrase(pause.detail)
    if (detail) {
      const question = `Why might ${actor} have ${pause.verb} ${detail}?`
      return /^(before|when|after)\b/i.test(detail) ? [question, `What else could ${actor} have done ${detail}?`] : [question]
    }
  }

  const decision = choice.exec(excerpt)?.groups
  if (decision) {
    const actor = actorLabel(decision.actor)
    const detail = phrase(decision.detail)
    if (detail) return decision.verb === 'refused' ? [
      `What might ${actor} have to lose by agreeing to “${detail}”?`,
      `What might change because ${actor} refused to “${detail}”?`,
    ] : [
      `What might ${actor} be hoping for by choosing to “${detail}”?`,
      `What other options might ${actor} have before trying to “${detail}”?`,
    ]
  }

  const observation = discovery.exec(excerpt)?.groups
  if (observation) {
    const actor = actorLabel(observation.actor)
    const detail = phrase(observation.detail)
    const concealed = ['hid', 'concealed', 'tucked', 'buried'].includes(observation.verb)
    if (detail) return concealed ? [
      `Why might ${actor} want to keep “${detail}” out of sight?`,
      `Who might ${actor} want to keep from finding “${detail}”?`,
    ] : [
      `What might ${actor} do after ${observation.verb === 'heard' ? 'hearing' : 'noticing'} “${detail}”?`,
      `What might ${actor} infer from “${detail}” about what happened earlier?`,
    ]
  }

  const spokenQuestion = /[“"]([^“”"?]{8,100}\?)[”"]/u.exec(excerpt)?.[1]
  if (spokenQuestion) return [
    `What might have prompted someone to ask “${spokenQuestion}” at that moment?`,
    `What does the wording of “${spokenQuestion}” suggest about what the speaker expected?`,
  ]

  const smell = /\b(?:smelled|smelt) of +(.+?)[.!?;]?$/i.exec(excerpt)?.[1]
  if (smell) return [`What does the smell of ${phrase(smell)} suggest about the setting?`]
  return []
}

const nounPhrase = /\b(?:the|a|an|her|his|their|its|this|these) +[\p{L}'’-]+(?: +[\p{L}'’-]+){0,2}/giu
const stopWord = /^(?:is|are|was|were|had|has|have|will|would|could|can|does|did|and|or|but|of|to|at|in|on|for|with|from|that|which|who|stood|lay|sat|hung|turned|moved|fell|rose|vanished)$/i

function detailPrompts(excerpt: string) {
  const phrases = Array.from(excerpt.matchAll(nounPhrase), match => {
    const words = match[0].split(/\s+/)
    const boundary = words.findIndex((word, index) => index > 0 && stopWord.test(word))
    return words.slice(0, boundary < 0 ? undefined : boundary).join(' ')
  }).filter(candidate => candidate.includes(' ')).sort((a, b) => b.length - a.length)
  const detail = phrases[0] ?? excerpt.split(/\s+/).slice(0, 6).join(' ').replace(/[.!?]+$/, '')
  return [
    `What does the passage tell you about “${detail}”?`,
    `Which nearby words shape your impression of “${detail}”?`,
  ]
}

export function questionForPage(text: string, page: number, variation = 0): CompanionQuestion | undefined {
  const passages = Array.from(sentenceSegmenter.segment(text.slice(0, 12_000)), item => item.segment.trim())
    .filter(passage => passage.length >= 28 && (passage.match(/\p{L}+/gu)?.length ?? 0) >= 5)
  if (!passages.length) return
  const specific = passages.flatMap(excerpt => storyPrompts(excerpt).map(prompt => ({ excerpt, prompt })))
  const pool = specific.length ? specific : passages.flatMap(excerpt => detailPrompts(excerpt).map(prompt => ({ excerpt, prompt })))
  const { excerpt, prompt } = pool[(page - 1 + variation) % pool.length]
  return { excerpt: shorten(excerpt, 185), prompt }
}

export const quietQuestion: CompanionQuestion = { prompt: 'I couldn’t find readable text on this page.' }
