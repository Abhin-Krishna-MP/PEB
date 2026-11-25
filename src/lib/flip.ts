export function clampPage(page: number, total: number) {
  return Math.min(total, Math.max(1, Math.trunc(Number.isFinite(page) ? page : 1)))
}
export function spreadStart(page: number, spread: boolean) {
  return spread ? page - (page - 1) % 2 : page
}
export function adjacentPage(page: number, direction: -1 | 1, spread: boolean, total: number) {
  const start = spreadStart(page, spread)
  const next = start + direction * (spread ? 2 : 1)
  return next < 1 || next > total ? page : next
}
export function shouldFinishTurn(distance: number, width: number, elapsed: number) {
  return distance >= width * .24 || (distance >= 32 && elapsed < 260)
}
