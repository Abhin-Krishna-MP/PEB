import { expect, it } from 'vitest'
import { reactionForPage } from '../src/lib/companion'

it.each([
  ['amused', 'Mara burst out laughing when Eli put the saucepan on his head.'],
  ['afraid', 'Mara heard footsteps behind her in the dark and her heart pounded.'],
  ['afraid', 'Mara glanced over her shoulder again as the hallway fell silent.'],
  ['suspicious', 'Eli hid the brass key beneath the loose floorboard.'],
  ['startled', 'Mara gasped as the door flew open.'],
  ['tender', 'Mara whispered goodbye one last time.'],
  ['curious', 'Mara hesitated before she brought the letter to the blue door.'],
] as const)('chooses a %s expression for a specific story beat', (mood, passage) => {
  expect(reactionForPage(passage, { words: 100 })?.mood).toBe(mood)
})

it('connects relief to earlier tension and varies the line on familiar beats', () => {
  const text = 'Mara sighed with relief when she saw the garden gate.'
  const first = reactionForPage(text, { previous: 'danger' })
  expect(first?.line).toBe('Oh, thank goodness. I can breathe again.')
  expect(reactionForPage(text, { previous: 'danger', recent: [first!.line] })?.line)
    .toBe('Okay… my tail can come out now.')
})

it('waits silently on quiet text and skips unread and already reacted-to beats', () => {
  const quiet = 'The blue room was warm and the bread rose beside the window. '
  const twist = 'Mara gasped as the door flew open.'
  expect(reactionForPage(quiet)).toBeUndefined()
  expect(reactionForPage('Mara forced a hollow laugh at his joke.', { words: 100 })).toBeUndefined()
  expect(reactionForPage(quiet + twist, { words: 12 })).toBeUndefined()
  const first = reactionForPage(quiet + twist, { words: 40 })!
  expect(first.mood).toBe('startled')
  expect(reactionForPage(quiet + twist, { words: 40, seen: new Set([first.stamp]) })).toBeUndefined()
})
