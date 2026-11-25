import { expect, it } from 'vitest'
import { questionForPage } from '../src/lib/companion'

it('names the character and action and varies the next question', () => {
  const excerpt = 'Mara hesitated before she brought the letter to the blue door.'
  const text = 'The street was quiet and the lamps were burning low. ' + excerpt
  expect(questionForPage(text, 1)).toEqual({
    excerpt,
    prompt: 'Why might Mara have hesitated before she brought the letter to the blue door?',
  })
  expect(questionForPage(text, 1, 1)?.prompt).toBe('What else could Mara have done before she brought the letter to the blue door?')
})

it('asks about the actual objects and choices in the text', () => {
  expect(questionForPage('Eli hid the brass key beneath the loose floorboard.', 1)?.prompt)
    .toBe('Why might Eli want to keep “the brass key beneath the loose floorboard” out of sight?')
  expect(questionForPage('Nora refused to burn the map before the meeting.', 1)?.prompt)
    .toContain('Nora')
  expect(questionForPage('Nora refused to burn the map before the meeting.', 1)?.prompt)
    .toContain('burn the map')
  expect(questionForPage('She found the missing lantern in the garden.', 1, 1)?.prompt)
    .toBe('What might she infer from “the missing lantern in the garden” about what happened earlier?')
})

it('uses a concrete description or phrase when there is no character action', () => {
  expect(questionForPage('The rooms upstairs smelled of pine and rain.', 1)?.prompt)
    .toBe('What does the smell of pine and rain suggest about the setting?')
  expect(questionForPage('From the landing, the red lantern hung on its hook.', 1)?.prompt)
    .toBe('What does the passage tell you about “the red lantern”?')
  expect(questionForPage('      ', 1)).toBeUndefined()
  expect(questionForPage('8 12 34 56 78 90 12 34 56 78 90\n1', 2)).toBeUndefined()
})
