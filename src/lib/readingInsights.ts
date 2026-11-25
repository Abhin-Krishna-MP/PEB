// Keep only a few distinctive terms in session memory. All analysis is local.
export type PageInsight = { terms: string[]; topic?: string; recap?: string; chapter?: string }
const common = new Set(('chapters edition editions exercise describe sample title contents about above after again against almost along already also always among another around away back became because become been before being below between book both came cannot chapter come could different does down each early even every example figure first folio found from gave going good great have having here herself himself idea into just knew know last later left like little long look looked made make many might more most much must need next night once only other over page pages part people place read reader reading really right room said same says second seen should since small some something still such take tell than that their them themselves then there therefore these they thing things think this those though thought through time together told took toward under until upon used uses very want well went were what when where whether which while whole whose will with within without words work would your').split(' '))
const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' })
const tokens = (value: string) => value.toLowerCase().match(/\b[a-z][a-z-]{3,}\b/g)?.filter(word => !common.has(word)) ?? []

export function pageInsight(text: string): PageInsight {
  const body = text.trim().slice(0, 10_000)
  const prose = body.split('\n').filter(line => !/^(?:figure|table)\s+\d|^\d+$/.test(line.toLowerCase()) && !/^[^a-z]+$/.test(line)).join('\n')
  const counts = new Map<string, number>()
  for (const word of tokens(prose)) counts.set(word, (counts.get(word) ?? 0) + 1)
  const terms = [...counts.keys()].sort((a, b) => counts.get(b)! - counts.get(a)!).slice(0, 8)
  const chapter = /\bchapter\s+(\d+|[ivxlcdm]+)\b/i.exec(body)?.[1]
  const possible = [...segmenter.segment(prose)].map(item => item.segment.trim()).filter(sentence => {
    const length = sentence.split(/\s+/).length
    return length >= 4 && length <= 32 && sentence.length <= 185 && /[.!?][”’"']?$/.test(sentence) && !/^(?:figure|table)\s+\d/i.test(sentence)
  })
  // Prefer a self-contained sentence that shares vocabulary with the rest of the page.
  const score = (value: string) => {
    const weight = [...new Set(tokens(value))].reduce((sum, term) => sum + Math.min(4, (counts.get(term) ?? 1) - 1), 0)
    return weight / Math.sqrt(value.length)
  }
  const definitionPattern = /^(?:An? |The )?([A-Za-z][\w-]*(?: [A-Za-z][\w-]*){0,2})\s+(?:means|refers to|describes|is defined as)\b/i
  const definition = possible.find(sentence => definitionPattern.test(sentence))
  const recap = definition ?? possible.map(sentence => ({ sentence, weight: score(sentence) }))
    .sort((a, b) => b.weight - a.weight)[0]?.sentence
  const topic = definitionPattern.exec(definition ?? '')?.[1] ?? (terms.length && counts.get(terms[0])! > 1 ? terms[0] : undefined)
  return { terms, topic, chapter, recap }
}

export function relatedPage(here: PageInsight, page: number, history: ReadonlyMap<number, PageInsight>) {
  let match: { page: number; topic: string; chapter?: string; score: number } | undefined
  for (const [earlier, past] of history) {
    if (earlier >= page) continue
    const overlap = here.terms.filter(term => past.terms.includes(term))
    const sameTopic = !!here.topic && here.topic.toLowerCase() === past.topic?.toLowerCase()
    if (overlap.length < 2 && !sameTopic) continue
    const score = overlap.length + (sameTopic ? 3 : 0)
    if (!match || score > match.score || (score === match.score && earlier > match.page)) {
      match = { page: earlier, topic: sameTopic ? here.topic! : overlap[0], chapter: past.chapter, score }
    }
  }
  return match
}
