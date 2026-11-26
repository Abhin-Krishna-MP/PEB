import { useEffect, useEffectEvent, useState } from 'react'
import { gravityLean, LeanDetector, orientationLean, screenRoll, TiltTurnDetector } from '../lib/tiltTurn'

type SensorAPI = { prototype: Event; requestPermission?: () => Promise<string> }
type Source = 'orientation' | 'gravity' | 'gyro'

function screenAngle() {
  return screen.orientation?.angle ?? (window as Window & { orientation?: number }).orientation ?? 0
}

export function useTiltTurns(enabled: boolean, reading: boolean, turn: (direction: 1 | -1) => void, testing: boolean) {
  const mobile = navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches
  const supported = mobile && window.isSecureContext && !!(window.DeviceMotionEvent || window.DeviceOrientationEvent)
  const [status, setStatus] = useState<'waiting' | 'ready' | 'missing'>('waiting')
  const [detected, setDetected] = useState<1 | -1>()
  const [attempt, setAttempt] = useState(0)
  const [requesting, setRequesting] = useState(false)
  const [permissionHint, setPermissionHint] = useState('')
  const listening = reading || testing
  const recognize = useEffectEvent((direction: 1 | -1) => {
    if (testing) { setDetected(direction); return false }
    if (!reading || document.querySelector('dialog[open], .spirit-prompts') ||
        document.activeElement?.matches('textarea, input:not([type=checkbox]), [contenteditable=true]') ||
        window.getSelection()?.type === 'Range') return false
    turn(direction)
    return true
  })

  async function allow() {
    setRequesting(true)
    setPermissionHint('')
    try {
      // Start permission requests during the tap, while Safari has user activation.
      const apis: (SensorAPI | undefined)[] = [window.DeviceMotionEvent, window.DeviceOrientationEvent]
      const requests = apis.flatMap(api => api?.requestPermission ? [api.requestPermission()] : [])
      const results = await Promise.allSettled(requests)
      if (results.length && !results.some(result => result.status === 'fulfilled' && result.value === 'granted')) {
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

  useEffect(() => { setDetected(undefined) }, [testing])

  useEffect(() => {
    setStatus('waiting')
    if (!supported || !enabled || !listening) return
    let gyro: TiltTurnDetector
    let leans: Record<'orientation' | 'gravity', LeanDetector>
    let owner: Source | undefined
    let angle: number
    let lastDirection: 1 | -1 | undefined
    const matching = new Set<Source>()
    let lastTurn: number
    let received = false
    let timer: number

    function reset() {
      gyro = new TiltTurnDetector()
      leans = { orientation: new LeanDetector(), gravity: new LeanDetector(55) }
      angle = screenAngle()
      owner = undefined
      matching.clear()
      lastTurn = -Infinity
    }
    function receive() {
      if (angle !== screenAngle()) reset()
      if (!received) {
        received = true
        clearTimeout(timer)
        setStatus('ready')
      }
    }
    function gesture(source: Source, direction: 1 | -1 | undefined, holding: boolean, time: number) {
      // Let overlapping streams observe the full gesture, but commit it once.
      if (owner) {
        if (direction && direction === lastDirection) matching.add(source)
        if (!holding && (owner === source || matching.has(source))) {
          owner = undefined
          matching.clear()
          if (source !== 'gyro') gyro = new TiltTurnDetector()
        }
        return
      }
      if (!direction || time - lastTurn < 800) return
      owner = source
      lastDirection = direction
      if (recognize(direction)) lastTurn = time
    }
    function position(source: 'orientation' | 'gravity', value: number | undefined, time: number) {
      if (value === undefined) return
      receive()
      const detector = leans[source]
      const direction = detector.sample(value, time)
      gesture(source, direction, detector.holding, time)
    }
    function orientation(event: DeviceOrientationEvent) {
      if (event.beta === null || event.gamma === null) return
      position('orientation', orientationLean(event.beta, event.gamma, screenAngle()), event.timeStamp)
    }
    function motion(event: DeviceMotionEvent) {
      const time = event.timeStamp
      const g = event.accelerationIncludingGravity
      if (g && g.x !== null && g.y !== null && g.z !== null && Math.abs(Math.hypot(g.x, g.y, g.z) - 9.81) < 2.2) {
        position('gravity', gravityLean(g.x, g.y, g.z, screenAngle()), time)
      }
      const roll = event.rotationRate && screenRoll(event.rotationRate, screenAngle())
      if (!roll) return
      receive()
      const direction = gyro.sample(roll.rate, roll.cross, time)
      gesture('gyro', direction, gyro.holding, time)
    }
    function stop() {
      window.clearTimeout(timer)
      window.removeEventListener('devicemotion', motion)
      window.removeEventListener('deviceorientation', orientation)
    }
    function sync() {
      stop()
      reset()
      if (document.hidden) return
      received = false
      setStatus('waiting')
      setDetected(undefined)
      timer = window.setTimeout(() => setStatus('missing'), 3000)
      window.addEventListener('devicemotion', motion, { passive: true })
      window.addEventListener('deviceorientation', orientation, { passive: true })
    }
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => { stop(); document.removeEventListener('visibilitychange', sync) }
  }, [enabled, supported, listening, attempt])

  return { mobile, supported, allow, requesting, permissionHint, status, detected }
}
