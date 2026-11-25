type Point = { x: number; y: number }

function clip(points: Point[], distance: (point: Point) => number, side: 1 | -1) {
  const result: Point[] = []
  for (const [index, start] of points.entries()) {
    const end = points[(index + 1) % points.length]
    const a = distance(start) * side
    const b = distance(end) * side
    if (a >= 0) result.push(start)
    if ((a < 0 && b > 0) || (a > 0 && b < 0)) {
      const fraction = a / (a - b)
      result.push({ x: start.x + (end.x - start.x) * fraction, y: start.y + (end.y - start.y) * fraction })
    }
  }
  if (result.length < 3) return 'polygon(0 0, 0 0, 0 0)'
  return `polygon(${result.map(({ x, y }) => `${x.toFixed(2)}px ${y.toFixed(2)}px`).join(', ')})`
}

export function pageCurl(width: number, height: number, amount: number, forward: boolean, bottom: boolean, diagonal: number) {
  const corner = { x: forward ? width : 0, y: bottom ? height : 0 }
  const travel = Math.max(.01, 2 * width * amount)
  const lift = Math.sin(Math.PI * amount) * Math.min(width * .64, height * diagonal)
  const dx = forward ? travel : -travel
  const dy = bottom ? lift : -lift
  const length = Math.hypot(dx, dy)
  const nx = dx / length
  const ny = dy / length
  // The crease is the perpendicular bisector between the edge and the pulled corner.
  const crease = (corner.x - dx / 2) * nx + (corner.y - dy / 2) * ny
  const points = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }]
  const distance = ({ x, y }: Point) => nx * x + ny * y - crease
  const creasePosition = crease - Math.min(0, nx * width) - Math.min(0, ny * height)
  const cross = -2 * nx * ny
  return {
    stationary: clip(points, distance, -1),
    folded: clip(points, distance, 1),
    reflection: `matrix(${1 - 2 * nx * nx}, ${cross}, ${cross}, ${1 - 2 * ny * ny}, ${2 * crease * nx}, ${2 * crease * ny})`,
    angle: `${Math.atan2(nx, -ny) * 180 / Math.PI}deg`,
    crease: `${creasePosition}px`,
  }
}
