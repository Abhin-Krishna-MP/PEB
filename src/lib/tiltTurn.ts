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
  private lastTurn = -Infinity

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
      if (nearCenter && time - this.stillSince >= 140 && time - this.lastTurn >= 820) {
        this.latched = 0
        this.ready = true
        this.travel = 0
        this.peak = 0
      }
      return
    }

    this.stillSince = -Infinity
    if (!this.ready || this.latched) return
    if (cross > Math.max(25, speed * 1.15)) {
      this.ready = false
      return
    }
    if (speed < 16) return
    if (!this.peak || time - this.start > 300 || rate * this.travel < 0) {
      this.start = time
      this.travel = 0
      this.peak = 0
    }
    this.travel += step
    this.peak = Math.max(this.peak, speed)
    if (time - this.start < 25 || Math.abs(this.travel) < 11 || this.peak < 48) return
    this.latched = rate < 0 ? -1 : 1
    this.lastTurn = time
    this.ready = false
    return this.latched < 0 ? 1 : -1
  }
}
