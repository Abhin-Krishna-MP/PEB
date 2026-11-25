import { describe, expect, it } from 'vitest'
import { adjacentPage, clampPage, shouldFinishTurn, spreadStart } from '../src/lib/flip'
import { fileSize, progress } from '../src/lib/model'
import { samples } from '../src/lib/samples'

describe('page navigation', () => {
  it('keeps a selected right page within its spread', () => {
    expect(spreadStart(12, true)).toBe(11)
    expect(adjacentPage(12, 1, true, 48)).toBe(13)
    expect(adjacentPage(12, -1, true, 48)).toBe(9)
  })
  it('handles boundaries and invalid page numbers', () => {
    expect(adjacentPage(1, -1, true, 5)).toBe(1)
    expect(adjacentPage(5, 1, true, 5)).toBe(5)
    expect(adjacentPage(2, 1, false, 3)).toBe(3)
    expect(clampPage(NaN, 8)).toBe(1)
    expect(clampPage(19, 8)).toBe(8)
  })
  it('accepts a deliberate drag or short swipe', () => {
    expect(shouldFinishTurn(25, 300, 70)).toBe(false)
    expect(shouldFinishTurn(40, 300, 170)).toBe(true)
    expect(shouldFinishTurn(90, 300, 700)).toBe(true)
  })
})

describe('library metadata', () => {
  it('reports unread and in-progress books accurately', () => {
    expect(progress(samples[0])).toBe(25)
    expect(progress(samples[1])).toBe(0)
    expect(fileSize(1_500_000)).toBe('1.4 MB')
  })
})
