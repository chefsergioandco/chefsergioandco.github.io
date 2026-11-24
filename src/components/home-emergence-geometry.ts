/** Viewport geometry for a real DOM layer resting on, then leaving, the invitation. */
export type Point = { x: number; y: number }
/** Clockwise: top left, top right, bottom right, bottom left. */
export type Quad = [Point, Point, Point, Point]
export type LayoutRect = { left: number; top: number; width: number; height: number }
/** A rectangle in the leaf's normalized 0–1 coordinate space. */
export type UnitRect = { x: number; y: number; width: number; height: number }
export type Homography = { a: number; b: number; c: number; d: number; e: number; f: number; g: number; h: number }
export type FlightOptions = {
  /** Upward viewport arc, in CSS pixels; zero at both endpoints. */
  liftPx?: number
  /** Mid-flight X-axis tilt in degrees; zero at both endpoints. */
  tilt?: number
}

const epsilon = 1e-10
const clamp = (value: number) => Math.max(0, Math.min(1, value))
const finiteQuad = (quad: Quad) => quad.every(point => Number.isFinite(point.x) && Number.isFinite(point.y))

/** Maps the unit square to the browser-projected paper quad, including perspective. */
export function homographyForQuad(quad: Quad): Homography {
  if (!finiteQuad(quad)) throw new RangeError('A projected plane must have finite corners.')
  const [p0, p1, p2, p3] = quad
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y
  let g = 0, h = 0
  if (Math.abs(dx3) > epsilon || Math.abs(dy3) > epsilon) {
    const denominator = dx1 * dy2 - dx2 * dy1
    if (Math.abs(denominator) < epsilon) throw new RangeError('The projected plane is degenerate.')
    g = (dx3 * dy2 - dx2 * dy3) / denominator
    h = (dx1 * dy3 - dx3 * dy1) / denominator
  }
  return {
    a: p1.x - p0.x + g * p1.x,
    b: p3.x - p0.x + h * p3.x,
    c: p0.x,
    d: p1.y - p0.y + g * p1.y,
    e: p3.y - p0.y + h * p3.y,
    f: p0.y,
    g, h,
  }
}

export function projectPoint(matrix: Homography, point: Point): Point {
  const w = matrix.g * point.x + matrix.h * point.y + 1
  if (!Number.isFinite(w) || Math.abs(w) < epsilon) throw new RangeError('The projected point crosses the camera plane.')
  return { x: (matrix.a * point.x + matrix.b * point.y + matrix.c) / w, y: (matrix.d * point.x + matrix.e * point.y + matrix.f) / w }
}

/** Places an inset miniature rectangle on the actual leaf, rather than its axis-aligned bounds. */
export function insetQuad(quad: Quad, rect: UnitRect): Quad {
  const matrix = homographyForQuad(quad)
  return [
    projectPoint(matrix, { x: rect.x, y: rect.y }),
    projectPoint(matrix, { x: rect.x + rect.width, y: rect.y }),
    projectPoint(matrix, { x: rect.x + rect.width, y: rect.y + rect.height }),
    projectPoint(matrix, { x: rect.x, y: rect.y + rect.height }),
  ]
}

/** A reversible path with exact source/end geometry; no elapsed-time state or second input owner. */
export function interpolateQuad(from: Quad, to: Quad, progress: number, options: FlightOptions = {}): Quad {
  const t = clamp(progress)
  if (t === 0) return from.map(point => ({ ...point })) as Quad
  if (t === 1) return to.map(point => ({ ...point })) as Quad
  const arc = Math.sin(Math.PI * t), lift = (options.liftPx ?? 0) * arc
  const compression = Math.cos((options.tilt ?? 0) * arc * Math.PI / 180)
  const points = from.map((point, index) => ({ x: point.x + (to[index].x - point.x) * t, y: point.y + (to[index].y - point.y) * t })) as Quad
  const centerY = points.reduce((total, point) => total + point.y, 0) / 4
  return points.map(point => ({ x: point.x, y: centerY + (point.y - centerY) * compression - lift })) as Quad
}

/**
 * CSS transform for the same existing DOM node, with transform-origin: 0 0.
 * Its untransformed viewport rectangle may be at any origin. Fixed layers at 0/0
 * simply pass left=top=0. Origin correction must affect the projective terms too.
 */
export function matrixForQuad(quad: Quad, rect: LayoutRect): string {
  if (![rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) throw new RangeError('A DOM layer must have a finite, nonzero layout rectangle.')
  const { a, b, c, d, e, f, g, h } = homographyForQuad(quad)
  const { left, top, width, height } = rect
  const values = [
    (a - left * g) / width, (d - top * g) / width, 0, g / width,
    (b - left * h) / height, (e - top * h) / height, 0, h / height,
    0, 0, 1, 0,
    c - left, f - top, 0, 1,
  ]
  return `matrix3d(${values.join(',')})`
}
