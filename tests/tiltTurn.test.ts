import { expect, it } from 'vitest'
import { screenRoll, TiltTurnDetector } from '../src/lib/tiltTurn'

function feed() {
  const detector = new TiltTurnDetector()
  const turns: number[] = []
  let time = 0
  return {
    turns,
    move(rate: number, duration: number, cross = 0) {
      for (let elapsed = 0; elapsed < duration; elapsed += 20) {
        time += 20
        const direction = detector.sample(rate, cross, time)
        if (direction) turns.push(direction)
      }
    },
  }
}

it('turns once for a short left flick, ignores a delayed return, then accepts a right flick', () => {
  const wrist = feed()
  wrist.move(0, 200)
  wrist.move(-90, 180)
  wrist.move(0, 1800)
  wrist.move(90, 180)
  expect(wrist.turns).toEqual([1])
  wrist.move(0, 260)
  wrist.move(75, 200)
  expect(wrist.turns).toEqual([1, -1])
})

it('ignores pickup, slow posture changes, bumps and rotations about another axis', () => {
  const wrist = feed()
  wrist.move(-95, 200)
  wrist.move(0, 200)
  wrist.move(-22, 1000)
  wrist.move(0, 200)
  wrist.move(600, 20)
  wrist.move(0, 300)
  wrist.move(-80, 220, 130)
  expect(wrist.turns).toEqual([])
})

it('maps both landscape orientations and reversed portrait into screen-relative motion', () => {
  const rates = { alpha: 5, beta: -80, gamma: 7 }
  expect(screenRoll(rates, 90)).toEqual({ rate: -80, cross: 7 })
  expect(screenRoll(rates, -90)).toEqual({ rate: 80, cross: 7 })
  expect(screenRoll(rates, 180)).toEqual({ rate: -7, cross: 80 })
  expect(screenRoll({ ...rates, gamma: null }, 0)).toBeUndefined()
})
