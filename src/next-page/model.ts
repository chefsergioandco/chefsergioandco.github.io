/**
 * Where is the pointer going?
 *
 * Aimed hand movements have a smooth, roughly symmetric speed profile: the hand speeds up, peaks about halfway, then
 * brakes into the target (the minimum-jerk model, Flash & Hogan 1985). Once the pointer is braking, the distance it
 * still has to travel is close to v²/2a, so the landing point can be estimated before the pointer arrives (kinematic
 * endpoint prediction, Lank, Cheng & Ruiz 2007). While it is still speeding up only the heading is reliable, and the
 * remaining distance is at least what it has covered so far.
 *
 * The landing estimate is a Gaussian stretched along the heading; a link's chance is the share of it that falls on
 * the link's box. Pure math, no DOM: scripts/next-page-check.mjs replays synthetic and browser movements through it.
 */
export type Sample = { t: number; x: number; y: number }
export type Box = { left: number; top: number; right: number; bottom: number }
/** Position (px), velocity (px/ms) and acceleration (px/ms²) at the latest sample. */
export type Motion = { x: number; y: number; vx: number; vy: number; ax: number; ay: number; speed: number }
/** Landing estimate: mean `along` px ahead of (x, y) on heading (ux, uy); spread sa along it, sc across it. */
export type Landing = { x: number; y: number; ux: number; uy: number; along: number; sa: number; sc: number; braking: boolean }

/** Samples used for the fit. Long enough to average out sensor jitter, short enough to follow a turn. */
export const WINDOW_MS = 80
/** Below this the pointer is resting (50 px/s). */
export const STILL = 0.05
/** Deceleration that counts as braking. Smaller values are noise in the fitted curve. */
const BRAKE_MIN = 0.0015
/** No landing is predicted further than this: beyond it the estimate is no better than the heading. */
const MAX_REACH = 1400

/** Least-squares quadratic through the recent samples: velocity and acceleration at the latest one. */
export function fit(samples: readonly Sample[]): Motion | null {
  const last = samples[samples.length - 1]
  if (!last) return null
  let n = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, x0 = 0, x1 = 0, x2 = 0, y0 = 0, y1 = 0, y2 = 0, first = last
  for (let i = samples.length - 1; i >= 0; i--) {
    const p = samples[i], t = p.t - last.t
    if (t < -WINDOW_MS) break
    // Centered on the latest sample so the sums stay small and well conditioned.
    const dx = p.x - last.x, dy = p.y - last.y, t2 = t * t
    n++; s1 += t; s2 += t2; s3 += t2 * t; s4 += t2 * t2
    x0 += dx; x1 += dx * t; x2 += dx * t2; y0 += dy; y1 += dy * t; y2 += dy * t2
    first = p
  }
  const resting: Motion = { x: last.x, y: last.y, vx: 0, vy: 0, ax: 0, ay: 0, speed: 0 }
  const span = last.t - first.t
  if (n < 2 || span < 4) return resting
  if (n >= 4 && span >= 24) {
    const solved = solve3([n, s1, s2, s1, s2, s3, s2, s3, s4], [x0, x1, x2], [y0, y1, y2])
    if (solved) {
      const [, vx, hx] = solved.x, [, vy, hy] = solved.y
      return { x: last.x, y: last.y, vx, vy, ax: 2 * hx, ay: 2 * hy, speed: Math.hypot(vx, vy) }
    }
  }
  // Too few points for a curve: straight line, no acceleration.
  const det = n * s2 - s1 * s1
  if (Math.abs(det) < 1e-9) return resting
  const vx = (n * x1 - s1 * x0) / det, vy = (n * y1 - s1 * y0) / det
  return { x: last.x, y: last.y, vx, vy, ax: 0, ay: 0, speed: Math.hypot(vx, vy) }
}

function solve3(m: number[], bx: number[], by: number[]) {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g
  const det = a * A + b * B + c * C
  if (Math.abs(det) < 1e-6 * Math.max(1, Math.abs(a * e * i))) return null
  const inv = [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map(v => v / det)
  const mul = (v: number[]) => [0, 1, 2].map(r => inv[r * 3] * v[0] + inv[r * 3 + 1] * v[1] + inv[r * 3 + 2] * v[2])
  return { x: mul(bx), y: mul(by) }
}

/**
 * `travelled`: straight-line distance since the pointer last rested. While speeding up, a symmetric speed profile
 * means at least that much is still to come.
 */
export function landing(m: Motion, travelled: number): Landing {
  if (m.speed < STILL) return { x: m.x, y: m.y, ux: 1, uy: 0, along: 0, sa: 6, sc: 6, braking: true }
  const ux = m.vx / m.speed, uy = m.vy / m.speed
  const brake = -(m.ax * ux + m.ay * uy)
  if (brake > BRAKE_MIN) {
    const along = Math.min(MAX_REACH, (m.speed * m.speed) / (2 * brake))
    // Early in braking v²/2a overshoots (deceleration is still rising); the spread covers that and shrinks with it.
    return { x: m.x, y: m.y, ux, uy, along: along * 0.8, sa: 10 + 0.45 * along, sc: 8 + 0.16 * along, braking: true }
  }
  const along = Math.min(MAX_REACH, Math.max(travelled, 60) * 1.2)
  return { x: m.x, y: m.y, ux, uy, along, sa: 24 + 0.7 * along, sc: 10 + 0.2 * along, braking: false }
}

/** Share of the landing estimate that falls on the box: the chance the movement ends on it. */
export function chance(box: Box, l: Landing): number {
  // The box in heading coordinates: a along the heading, c across it. A rotated rectangle is a convex polygon.
  const corners = [[box.left, box.top], [box.right, box.top], [box.right, box.bottom], [box.left, box.bottom]].map(([X, Y]) => {
    const dx = X - l.x, dy = Y - l.y
    return { a: dx * l.ux + dy * l.uy, c: -dx * l.uy + dy * l.ux }
  })
  let lo = Infinity, hi = -Infinity
  for (const p of corners) { lo = Math.min(lo, p.a); hi = Math.max(hi, p.a) }
  // Integrate along the heading where the Gaussian has mass; across it the slice integral is exact.
  lo = Math.max(lo, l.along - 5 * l.sa)
  hi = Math.min(hi, l.along + 5 * l.sa)
  if (hi <= lo) return 0
  const steps = 24, h = (hi - lo) / steps
  let sum = 0
  for (let k = 0; k <= steps; k++) {
    const a = lo + k * h
    let cMin = Infinity, cMax = -Infinity
    for (let e = 0; e < 4; e++) {
      const p = corners[e], q = corners[(e + 1) % 4]
      if ((a - p.a) * (a - q.a) > 0) continue
      if (p.a === q.a) { cMin = Math.min(cMin, p.c, q.c); cMax = Math.max(cMax, p.c, q.c); continue }
      const c = p.c + ((a - p.a) / (q.a - p.a)) * (q.c - p.c)
      cMin = Math.min(cMin, c); cMax = Math.max(cMax, c)
    }
    if (!(cMax > cMin)) continue
    const z = (a - l.along) / l.sa
    const slice = (Math.exp(-0.5 * z * z) / (l.sa * Math.sqrt(2 * Math.PI))) * (cdf(cMax / l.sc) - cdf(cMin / l.sc))
    sum += slice * (k === 0 || k === steps ? 1 : k % 2 ? 4 : 2)
  }
  return Math.max(0, Math.min(1, (sum * h) / 3))
}

export type Spot = { url: string; box: Box }
/** 1: fetch the document. 2: also its code and lead photograph. 3: render it ahead. */
export type Wish = { url: string; level: 1 | 2 | 3; rested: boolean }
/** Chance that the movement ends on a link needed for each level. Tuned with scripts/next-page-check.mjs. */
export const THRESHOLDS = { document: 0.3, warm: 0.5, render: 0.75 }
/** Resting this long on a link counts as intent. Chromium's own hover trigger waits 200 ms. */
export const REST_MS = 80

/**
 * One decision step, run on each animation frame while the pointer moves and again after it stops (`restedFor`: ms
 * since the last movement). Chances on separate links add up to at most 1, so one step can warm at most one page
 * and fetch at most three documents.
 */
export function createAim(thresholds = THRESHOLDS) {
  let rest = { x: 0, y: 0 }, streak = ''
  return function aim(samples: readonly Sample[], spots: readonly Spot[], restedFor = 0): Wish[] {
    const last = samples[samples.length - 1]
    if (!last) return []
    const motion = restedFor ? { x: last.x, y: last.y, vx: 0, vy: 0, ax: 0, ay: 0, speed: 0 } : fit(samples)
    if (!motion) return []
    if (motion.speed < STILL) rest = { x: motion.x, y: motion.y }
    const estimate = landing(motion, Math.hypot(motion.x - rest.x, motion.y - rest.y))
    const byUrl = new Map<string, number>()
    let best = '', top = 0
    for (const spot of spots) {
      const p = chance(spot.box, estimate)
      if (p <= (byUrl.get(spot.url) ?? 0)) continue
      byUrl.set(spot.url, p)
      if (p > top) { top = p; best = spot.url }
    }
    const wishes: Wish[] = []
    for (const [url, p] of byUrl) {
      if (p >= thresholds.warm) wishes.push({ url, level: 2, rested: false })
      else if (p >= thresholds.document) wishes.push({ url, level: 1, rested: false })
    }
    // A full render needs a rest on the link, or the strongest prediction while braking on two consecutive steps.
    const confident = top >= thresholds.render && estimate.braking
    const rested = restedFor >= REST_MS
    if (confident && (rested || streak === best)) wishes.push({ url: best, level: 3, rested })
    streak = confident ? best : ''
    return wishes
  }
}

/** Standard normal CDF (Abramowitz & Stegun 7.1.26, error < 1.5e-7). */
export function cdf(z: number) {
  const x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + 0.3275911 * x)
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf)
}
