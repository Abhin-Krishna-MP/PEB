import { expect, it } from 'vitest'
import { questionForPage } from '../src/lib/companion'

it('anchors the question to an actual passage that contains a story cue', () => {
  const excerpt = 'Mara hesitated before she brought the letter to the blue door.'
  expect(questionForPage('The street was quiet and the lamps were burning low. ' + excerpt, 1)).toEqual({
    excerpt,
    prompt: 'What might be behind that hesitation or uncertainty?',
  })
})

it('uses an open-ended reflection when it finds prose without a cue', () => {
  expect(questionForPage('The rooms upstairs smelled of pine and rain.', 1)).toEqual({
    excerpt: 'The rooms upstairs smelled of pine and rain.',
    prompt: 'What detail here might matter later?',
  })
  expect(questionForPage('      ', 1)).toBeUndefined()
  expect(questionForPage('8 12 34 56 78 90 12 34 56 78 90\n1', 2)).toBeUndefined()
})
