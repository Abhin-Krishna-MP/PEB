// Gyroscope rates are degrees per second about the device's native axes.
// Express them about the upright screen axes, including reversed landscape.
export function screenRoll(rates: Pick<DeviceMotionEventRotationRate, 'alpha' | 'beta' | 'gamma'>, angle: number) {
  const quarter = ((Math.round(angle / 90) % 4) + 4) % 4
  const landscape = quarter % 2 === 1
  const rate = landscape ? rates.beta : rates.gamma
  if (rate === null || !Number.isFinite(rate)) return
  const cross = Math.max(Math.abs((landscape ? rates.gamma : rates.beta) ?? 0), Math.abs(rates.alpha ?? 0))
  return { rate: quarter >= 2 ? -rate : rate, cross }
}

export class TiltTurnDetector {
  private previous = -Infinity
  private stillSince = -Infinity
  private ready = false
  private start = 0
  private travel = 0
  private peak = 0
  private latched: -1 | 0 | 1 = 0

  get holding() { return this.latched !== 0 }

  sample(rate: number, cross: number, time: number): 1 | -1 | undefined {
    const elapsed = time - this.previous
    this.previous = time
    if (elapsed <= 0 || elapsed > 200) {
      this.ready = false
      this.latched = 0
      this.travel = 0
      this.peak = 0
      this.stillSince = time
      return
    }

    const speed = Math.abs(rate)
    const step = rate * elapsed / 1000
    if (this.latched && speed > 2) this.travel += step
    if (speed < 10 && cross < 18) {
      if (!Number.isFinite(this.stillSince)) this.stillSince = time
      const nearCenter = this.latched * this.travel <= 5
      if (nearCenter && time - this.stillSince >= 140) {
        this.latched = 0
        this.ready = true
        this.travel = 0
        this.peak = 0
      }
      return
    }

    this.stillSince = -Infinity
    if (!this.ready || this.latched) return
    if (cross > Math.max(32, speed * 1.5)) {
      this.ready = false
      return
    }
    if (speed < 16) return
    if (!this.peak || time - this.start > 400 || rate * this.travel < 0) {
      this.start = time
      this.travel = 0
      this.peak = 0
    }
    this.travel += step
    this.peak = Math.max(this.peak, speed)
    if (time - this.start < 25 || Math.abs(this.travel) < 9 || this.peak < 35) return
    this.latched = rate < 0 ? -1 : 1
    this.ready = false
    return this.latched < 0 ? 1 : -1
  }
}

// The sideways component of the upward gravity vector works even with the
// screen almost vertical, where a wrist tilt may have very little gyro roll.
export function gravityLean(x: number, y: number, z: number, angle: number) {
  const magnitude = Math.hypot(x, y, z)
  if (!Number.isFinite(magnitude) || magnitude === 0) return
  const radians = angle * Math.PI / 180
  const sideways = (y * Math.sin(radians) - x * Math.cos(radians)) / magnitude
  return Math.asin(Math.max(-1, Math.min(1, sideways))) * 180 / Math.PI
}

export function orientationLean(beta: number, gamma: number, angle: number) {
  const pitch = beta * Math.PI / 180
  const roll = gamma * Math.PI / 180
  return gravityLean(-Math.cos(pitch) * Math.sin(roll), Math.sin(pitch), Math.cos(pitch) * Math.cos(roll), angle)
}

export class LeanDetector {
  private center?: number
  private filtered = 0
  private lastTime = 0
  holding = false

  constructor(private readonly smoothingMs = 0) {}

  sample(lean: number, time: number): 1 | -1 | undefined {
    if (this.center === undefined) {
      this.center = this.filtered = lean
      this.lastTime = time
      return
    }
    const dt = Math.max(0, time - this.lastTime)
    this.lastTime = time
    // Fused orientation events may only arrive on change. Raw acceleration
    // arrives as a stream and benefits from filtering hand vibration.
    this.filtered += (lean - this.filtered) * (this.smoothingMs ? 1 - Math.exp(-dt / this.smoothingMs) : 1)
    const offset = this.filtered - this.center
    if (Math.abs(offset) <= 4) {
      this.holding = false
      this.center += offset * (1 - Math.exp(-dt / 1500))
    } else if (!this.holding && Math.abs(offset) >= 9) {
      this.holding = true
      return offset < 0 ? 1 : -1
    }
  }
}
