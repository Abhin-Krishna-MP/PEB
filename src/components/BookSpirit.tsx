import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { BeatKind, SpiritMood } from '../lib/companion'
import './BookSpirit.css'

type Gesture = 'read' | 'notice' | 'stretch' | 'turn-next' | 'turn-back'

export default function BookSpirit({ page, mood, beat, speaking, reducedMotion, bubbleId, onTap }: {
  page: number
  mood: SpiritMood
  beat?: BeatKind
  speaking: boolean
  reducedMotion: boolean
  bubbleId: string
  onTap: () => void
}) {
  const figure = useRef<HTMLSpanElement>(null)
  const previousPage = useRef(page)
  const settle = useRef<number | undefined>(undefined)
  const [gesture, setGesture] = useState<Gesture>('read')

  const move = useCallback((next: Gesture, duration: number) => {
    if (reducedMotion) return
    window.clearTimeout(settle.current)
    setGesture(next)
    settle.current = window.setTimeout(() => {
      settle.current = undefined
      setGesture('read')
    }, duration)
  }, [reducedMotion])

  useLayoutEffect(() => {
    if (previousPage.current !== page) {
      move(page > previousPage.current ? 'turn-next' : 'turn-back', 1250)
      previousPage.current = page
    }
  }, [page, move])

  useEffect(() => {
    if (reducedMotion) setGesture('read')
    return () => {
      window.clearTimeout(settle.current)
      settle.current = undefined
    }
  }, [reducedMotion])

  useEffect(() => {
    if (reducedMotion || mood === 'sleepy') return
    const eyes = figure.current?.querySelectorAll<HTMLElement>('.spirit-blink')
    let next: number
    let count = 0
    let blinks: Animation[] = []
    function blink() {
      blinks = Array.from(eyes ?? [], eye => eye.animate([
        { transform: 'scaleY(1)' }, { transform: 'scaleY(.08)', offset: .44 }, { transform: 'scaleY(1)' },
      ], { duration: 195, easing: 'ease-in-out' }))
      if (++count % 3 === 0 && !speaking && !beat && settle.current === undefined) move('stretch', 1150)
      next = window.setTimeout(blink, 2600 + Math.random() * 3400)
    }
    next = window.setTimeout(blink, 1900 + Math.random() * 1900)
    return () => { window.clearTimeout(next); blinks.forEach(animation => animation.cancel()) }
  }, [mood, beat, speaking, reducedMotion, move])

  const lookUp = () => move('notice', 1500)
  return <button className="companion-pet" aria-label="Hear from the book spirit" aria-expanded={speaking} aria-controls={bubbleId}
    title="Hear from the book spirit"
    onPointerEnter={event => { if (event.pointerType === 'mouse') lookUp() }}
    onPointerMove={event => {
      if (reducedMotion || event.pointerType !== 'mouse') return
      const bounds = event.currentTarget.getBoundingClientRect()
      const x = (event.clientX - bounds.left) / bounds.width - .5
      const y = (event.clientY - bounds.top) / bounds.height - .5
      figure.current?.style.setProperty('--attention-x', (x * 38).toFixed(1) + '%')
      figure.current?.style.setProperty('--attention-y', (y * 24).toFixed(1) + '%')
    }}
    onFocus={event => { if (event.currentTarget.matches(':focus-visible')) lookUp() }}
    onClick={() => { lookUp(); onTap() }}>
    <span ref={figure} className="companion-sprite" data-mood={mood} data-beat={beat} data-gesture={gesture} data-speaking={speaking} aria-hidden="true">
      <span className="spirit-torso">
        <span className="spirit-wing left"><i /></span>
        <span className="spirit-wing right"><i /></span>
        <span className="spirit-head">
          <span className="spirit-face">
            {['left', 'right'].map(side => <span key={side} className={'spirit-eye-socket ' + side}>
              <span className="spirit-blink"><span className="spirit-eye"><span className="spirit-gaze"><i className="spirit-iris" /></span></span></span>
            </span>)}
            <i className="spirit-mouth" />
            <i className="spirit-specs" />
          </span>
        </span>
        <span className="spirit-volume">
          <i key={page} className="spirit-leaf" />
          <i className="spirit-cover" />
        </span>
      </span>
    </span>
  </button>
}
