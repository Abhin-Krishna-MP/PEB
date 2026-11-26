import { useEffect, useEffectEvent, useState } from 'react'
import { screenRoll, TiltTurnDetector } from '../lib/tiltTurn'

type MotionAPI = typeof DeviceMotionEvent & { requestPermission?: () => Promise<string> }

function screenAngle() {
  return screen.orientation?.angle ?? (window as Window & { orientation?: number }).orientation ?? 0
}

export function useTiltTurns(enabled: boolean, reading: boolean, turn: (direction: 1 | -1) => void) {
  const mobile = navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches
  const supported = mobile && window.isSecureContext && typeof DeviceMotionEvent !== 'undefined'
  const [noData, setNoData] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [requesting, setRequesting] = useState(false)
  const [permissionHint, setPermissionHint] = useState('')
  const navigate = useEffectEvent(turn)

  async function allow() {
    setRequesting(true)
    setPermissionHint('')
    try {
      const api = window.DeviceMotionEvent as MotionAPI
      if (api.requestPermission && await api.requestPermission() !== 'granted') {
        setPermissionHint('To use tilt, allow motion access in your browser’s site settings.')
        return false
      }
      setAttempt(value => value + 1)
      return true
    } catch {
      setPermissionHint('Motion access is unavailable. Check your browser’s motion permission and try again.')
      return false
    } finally { setRequesting(false) }
  }

  useEffect(() => {
    setNoData(false)
    if (!supported || !enabled) return
    let detector: TiltTurnDetector | undefined
    let angle = screenAngle()
    let received = false
    let timer: number
    function motion(event: DeviceMotionEvent) {
      const nextAngle = screenAngle()
      if (nextAngle !== angle) {
        angle = nextAngle
        detector = undefined
      }
      const roll = event.rotationRate && screenRoll(event.rotationRate, angle)
      if (!roll) return
      if (!received) {
        received = true
        window.clearTimeout(timer)
        setNoData(false)
      }
      if (!reading) return
      detector ??= new TiltTurnDetector()
      const direction = detector.sample(roll.rate, roll.cross, event.timeStamp)
      if (!direction || document.querySelector('dialog[open], .spirit-prompts') ||
          document.activeElement?.matches('textarea, input:not([type=checkbox]), [contenteditable=true]') ||
          window.getSelection()?.type === 'Range') return
      navigate(direction)
    }
    function stop() {
      window.clearTimeout(timer)
      window.removeEventListener('devicemotion', motion)
    }
    function sync() {
      stop()
      detector = undefined
      if (document.hidden) return
      received = false
      timer = window.setTimeout(() => setNoData(true), 3000)
      window.addEventListener('devicemotion', motion, { passive: true })
    }
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => { stop(); document.removeEventListener('visibilitychange', sync) }
  }, [enabled, supported, reading, attempt])

  return { mobile, supported, allow, requesting, permissionHint, noData }
}
