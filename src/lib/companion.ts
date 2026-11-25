export type KittenMood = 'curious' | 'suspicious' | 'startled' | 'afraid' | 'amused' | 'tender'
export type BeatKind = 'doubt' | 'deception' | 'surprise' | 'danger' | 'unease' | 'humor' | 'grief' | 'relief' | 'warmth'
export type Reaction = { kind: BeatKind; mood: KittenMood; strength: number; stamp: string; line: string }

type Beat = {
  kind: BeatKind
  mood: KittenMood
  score: number
  stamp: string
  name?: string
  object?: string
  hesitation: boolean
  concealed: boolean
}
type ReactionContext = {
  words?: number
  seen?: ReadonlySet<string>
  recent?: readonly string[]
  previous?: BeatKind
}

const sentences = new Intl.Segmenter('en', { granularity: 'sentence' })

const signals: { kind: BeatKind; mood: KittenMood; strong: RegExp; supporting: RegExp }[] = [
  {
    kind: 'unease', mood: 'afraid',
    strong: /\b(?:couldn['’]t shake the feeling|something wasn['’]t right|glanced over (?:his|her|their) shoulder|kept looking over (?:his|her|their) shoulder|(?:he|she|they) waited in silence)\b/i,
    supporting: /\b(?:uneasy|nervous|no answer|long silence|inched closer)\b/i,
  },
  {
    kind: 'danger', mood: 'afraid',
    strong: /\b(?:heart (?:pounded|hammered|raced)|blood ran cold|(?:he|she|they) froze|held (?:his|her|their) breath|(?:footsteps|breathing) (?:behind|outside|above|approached)|don['’]t move|something (?:moved|scratched|stirred) in the dark|hands? (?:shook|trembled)|(?:shrieked|screamed) in (?:fear|terror))\b/i,
    supporting: /\b(?:terror|terrified|frightened|screamed|trembled|shivered|terrifying|cowering|door creaked|in the dark|couldn['’]t breathe)\b/i,
  },
  {
    kind: 'deception', mood: 'suspicious',
    strong: /\b(?:hid (?:the|a|his|her|their)|concealed (?:the|a|his|her|their)|(?:wouldn['’]t|would not|refused to) meet (?:his|her|their) eyes|(?:answered|replied|spoke) too quickly|changed (?:the subject|his story|her story|their story)|(?:lied|lying) about|slipped .{3,40} into (?:his|her|their) pocket)\b/i,
    supporting: /\b(?:suspicious|whispered|secret|excuse|pretended|averted|unopened)\b/i,
  },
  {
    kind: 'surprise', mood: 'startled',
    strong: /\b(?:gasped|without warning|couldn['’]t believe (?:his|her|their|what)|(?:door|window) (?:flew|burst) open|out of nowhere|was supposed to be dead|there (?:he|she|they) stood)\b/i,
    supporting: /\b(?:suddenly|unexpectedly|startled|stared in disbelief|to (?:his|her|their) surprise)\b/i,
  },
  {
    kind: 'humor', mood: 'amused',
    strong: /\b(?:burst (?:out laughing|into laughter)|couldn['’]t stop laughing|laughed out loud|roared with laughter|stifled a laugh|snort(?:ed|ing) with laughter|giggled|deadpanned|chuckled|laughed)\b/i,
    supporting: /\b(?:joke|ridiculous|funny|absurd|grinned|with a wink|had to laugh)\b/i,
  },
  {
    kind: 'grief', mood: 'tender',
    strong: /\b(?:tears (?:fell|spilled|rolled|streamed)|choked back (?:tears|a sob)|whispered goodbye|never see (?:him|her|them) again|(?:he|she|they) sobbed|wept|empty chair at the table|couldn['’]t say goodbye)\b/i,
    supporting: /\b(?:grief|heartbroken|missed (?:him|her|them)|tears|sorrow|sadness|a lump in (?:his|her|their) throat)\b/i,
  },
  {
    kind: 'relief', mood: 'tender',
    strong: /\b(?:sighed with relief|let out (?:the|a) breath|(?:was|were) finally safe|shoulders (?:relaxed|dropped)|thank goodness|made it home safely|it was only (?:a|the) )/i,
    supporting: /\b(?:safe at last|relief|the danger had passed|the worst was over)\b/i,
  },
  {
    kind: 'warmth', mood: 'tender',
    strong: /\b(?:pulled (?:him|her|them) into a hug|wrapped (?:his|her|their) arms around|squeezed (?:his|her|their) hand|(?:he|she|they) forgave|finally smiled again)\b/i,
    supporting: /\b(?:tenderly|held hands|smiled softly|hugged|kindly|warm smile)\b/i,
  },
  {
    kind: 'doubt', mood: 'curious',
    strong: /\b(?:hesitated before|paused before|refused to|found (?:an unopened|a hidden|the missing)|found .{3,35} where it shouldn['’]t be|wondered why|didn['’]t make sense)\b/i,
    supporting: /\b(?:hesitated|wondered|puzzled|strange|unfamiliar|unanswered|peculiar|stared at)\b/i,
  },
]

const person = /\b(\p{Lu}[\p{L}’'-]+)\s+(?:(?:suddenly|finally|quietly)\s+)?(?:hesitated|paused|hid|concealed|slipped|laughed|giggled|screamed|froze|wept|gasped|wondered|refused|noticed|found|stared|whispered|answered|trembled|pulled|sighed)\b/u
const ordinarySubjects = /^(?:He|She|They|Them|There|Then|Someone|Everyone|Nobody|Something|Nothing|It|That|This|Suddenly)$/u
const object = /\b(?:the|a|an|his|her|their)\s+((?:[\p{L}’'-]+\s+){0,2}(?:door|key|letter|note|map|lantern|footsteps|shadow|window|box|portrait|knife|package))\b/iu

function substantive(text: string, pattern: RegExp) {
  const match = pattern.exec(text)
  if (!match) return false
  const leading = text.slice(Math.max(0, match.index - 25), match.index)
  return !/\b(?:not|never|didn['’]t|wasn['’]t|without)\s+(?:really\s+)?$/i.test(leading)
}

function findBeats(text: string, limit?: number) {
  const bounded = text.trim().slice(0, 12_000)
  const candidates: Beat[] = []
  let wordCount = 0
  for (const { segment } of sentences.segment(bounded)) {
    const passage = segment.trim()
    const wordCountInPassage = passage.match(/\p{L}+/gu)?.length ?? 0
    wordCount += wordCountInPassage
    if (limit !== undefined && wordCount > limit) break
    if (wordCountInPassage < 3) continue

    let name = person.exec(passage)?.[1]
    if (name && ordinarySubjects.test(name)) name = undefined
    const detail = (object.exec(passage)?.[1] ?? /\b(footsteps) (?:behind|outside|above|approached)\b/i.exec(passage)?.[1])?.toLowerCase()
    const strain = /\b(?:nervous|bitter|hollow|forced|sarcastic|fake|laughed nervously)\b/i.test(passage)
    for (const { kind, mood, strong, supporting } of signals) {
      if ((kind === 'humor' || kind === 'warmth') && strain) continue
      const direct = substantive(passage, strong)
      const supportingCue = substantive(passage, supporting)
      const score = (direct ? 5 : 0) + (supportingCue ? 2 : 0) + (name && (direct || supportingCue) ? 1 : 0)
      if (!score) continue
      candidates.push({
        kind, mood, score,
        stamp: passage.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').slice(0, 180),
        ...(name && { name }), ...(detail && { object: detail }),
        hesitation: /\bhesitat/i.test(passage),
        concealed: /\b(?:hid|concealed|slipped)\b/i.test(passage),
      })
    }
  }
  return candidates.sort((a, b) => b.score - a.score)
}

function linesFor(beat: Beat, previous?: BeatKind): string[] {
  const { name, object: detail } = beat
  switch (beat.kind) {
    case 'doubt':
      return [
        beat.hesitation && name ? `Oh. What made ${name} hesitate?` : detail ? `Hmm… what’s the story behind the ${detail}?` : 'Huh. That caught my attention.',
        detail ? `I keep coming back to the ${detail}.` : 'I think I’d stop and look again, too.',
      ]
    case 'deception':
      return [
        name && detail && beat.concealed ? `Wait… why would ${name} hide the ${detail}?` : name ? `Hmm. Something feels off about ${name}.` : 'Ooh. Something feels off.',
        detail ? `I’d keep an eye on the ${detail}.` : 'I’m saving my trust for later.',
        'That sounds a little too convenient.',
      ]
    case 'surprise':
      return [
        detail ? `Oh! The ${detail} got me, too.` : 'Oh my goodness. I didn’t see that coming.',
        'Wait, what? I nearly dropped my book.',
        'Oh! I had that completely wrong.',
      ]
    case 'danger':
      return [
        detail ? `The ${detail} ${detail.endsWith('footsteps') ? 'are' : 'is'} making me nervous…` : 'Oh no… I’m holding my breath.',
        'I just tucked my tail in.',
        'I’m bracing myself for the next bit.',
      ]
    case 'unease':
      return ['Oof… the waiting is getting to me.', 'I wish we knew what was going on.']
    case 'humor':
      return ['Heh. Okay, that got me.', 'Pfft. I’m trying to keep a straight face over here.', 'I’m blaming the book if I laugh out loud.']
    case 'grief':
      return ['Oh… that one hurt a little.', name ? `Poor ${name}. I need a second.` : 'I think I need a second.']
    case 'relief':
      return previous === 'danger' || previous === 'unease' || previous === 'surprise'
        ? ['Oh, thank goodness. I can breathe again.', 'Okay… my tail can come out now.']
        : ['Phew. That’s a relief.', 'Oh, good. I was getting worried.']
    case 'warmth':
      return ['Aww. I’m glad that happened.', name ? `Oh, ${name}. That was sweet.` : 'That made me smile.']
  }
}

export function reactionForPage(text: string, context: ReactionContext = {}): Reaction | undefined {
  const limit = context.words
  const automatic = limit !== undefined
  const beats = findBeats(text, limit)
    .filter(beat => beat.score >= (automatic ? 5 : 2) && (!automatic || !context.seen?.has(beat.stamp)))
  for (const beat of beats) {
    const line = linesFor(beat, context.previous).find(candidate => !context.recent?.includes(candidate))
    if (!line) continue
    return { kind: beat.kind, mood: beat.mood, strength: beat.score, stamp: beat.stamp, line }
  }
}
