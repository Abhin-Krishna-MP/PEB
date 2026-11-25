import { expect, it } from 'vitest'
import { quietTapLine, reactionForPage } from '../src/lib/companion'
import { pageInsight, relatedPage } from '../src/lib/readingInsights'

it.each([
  ['happy', 'Mara burst out laughing when Eli put the saucepan on his head.'],
  ['surprised', 'Mara heard footsteps behind her in the dark and her heart pounded.'],
  ['surprised', 'Mara glanced over her shoulder again as the hallway fell silent.'],
  ['focused', 'Eli hid the brass key beneath the loose floorboard.'],
  ['surprised', 'Mara gasped as the door flew open.'],
  ['focused', 'Mara whispered goodbye one last time.'],
  ['curious', 'Mara hesitated before she brought the letter to the blue door.'],
] as const)('chooses a %s expression for a specific story beat', (mood, passage) => {
  expect(reactionForPage(passage, { words: 100 })?.mood).toBe(mood)
})

it('connects relief to earlier tension and varies the line on familiar beats', () => {
  const text = 'Mara sighed with relief when she saw the garden gate.'
  const first = reactionForPage(text, { previous: 'danger' })
  expect(first?.line).toBe('Oh, thank goodness. I can breathe again.')
  expect(reactionForPage(text, { previous: 'danger', recent: [first!.line] })?.line)
    .toBe('Okay… I can unfold my wings now.')
})

it('waits silently on quiet text and skips unread and already reacted-to beats', () => {
  const quiet = 'The blue room was warm and the bread rose beside the window. '
  const twist = 'Mara gasped as the door flew open.'
  expect(reactionForPage(quiet)).toBeUndefined()
  expect(reactionForPage('Mara forced a hollow laugh at his joke.', { words: 100 })).toBeUndefined()
  expect(reactionForPage(quiet + twist, { words: 12 })).toBeUndefined()
  const first = reactionForPage(quiet + twist, { words: 40 })!
  expect(first.mood).toBe('surprised')
  expect(reactionForPage(quiet + twist, { words: 40, seen: new Set([first.stamp]) })).toBeUndefined()
})

it('can ask a question in character about the current scene', () => {
  const page = 'Mara heard footsteps behind her in the dark and her heart pounded.'
  expect(reactionForPage(page, { preferQuestion: true })?.line)
    .toBe('The footsteps are making me nervous… would you go look?')
})

it('always has something to say on tap, including on calm and image-only pages', () => {
  const text = 'The blue room was warm.'
  const first = quietTapLine(text, [])
  expect(first).toBe('I wonder what we’ll learn about the blue room.')
  expect(quietTapLine(text, [first])).toBe('Do you think we’ll see the blue room again?')
  expect(quietTapLine('', [])).toBe('The words are a blur from here. I’ll keep you company.')
})

it('grounds a connection in an earlier page and keeps a recap to a single short passage', () => {
  const first = pageInsight('CHAPTER 2\nErosion means the transport of sediment. Rivers carry sediment downstream.')
  const second = pageInsight('CHAPTER 5\nErosion carries sediment across the plain. Erosion can reshape a river.')
  expect(first.topic).toBe('Erosion')
  expect(first.recap).toBe('Erosion means the transport of sediment.')
  const pages = new Map([[3, first], [10, second]])
  expect(relatedPage(second, 7, pages)).toMatchObject({ page: 3, chapter: '2' })
  expect(relatedPage(second, 2, pages)).toBeUndefined()
  expect(pageInsight('').recap).toBeUndefined()
})
