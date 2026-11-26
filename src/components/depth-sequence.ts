import { DEPTH_GATE, type DepthGateSnapshot } from './depth-gate'

export type DepthBoundary = { id: string; from: string; to: string; start: number; end: number }
export type DepthInput = 'wheel' | 'touch' | 'coast' | 'keyboard'
export type DepthSequenceSnapshot = DepthGateSnapshot & {
  activeIndex: number
  boundaryId: string | null
  boundaries: DepthBoundary[]
  totalCommits: number
  totalReversals: number
  charges: Array<{ boundaryId: string; threshold: number; remainingEnergy: number; time: number }>
  targetY: number
  lagPx: number
  velocityPx: number
  arrivalProgress: number
  arrivalActive: boolean
  arrivalPosition: number
  arrivalTarget: number
  arrivalPlaying: boolean
}
type DepthSequenceOptions = { boundaries: DepthBoundary[]; onUpdate: (state: DepthSequenceSnapshot) => void }

/** Continuous input, one bounded follower. Sections influence weight, never destinations. */
export function createDepthSequence(options: DepthSequenceOptions) {
  let boundaries = options.boundaries.map(boundary => ({ ...boundary }))
  let position = window.scrollY, target = position, nativeY = position, velocity = 0
  let maximum = Math.max(0, document.documentElement.scrollHeight - innerHeight)
  let frame = 0, previous = 0, destroyed = false, moving = false
  let direction: -1 | 0 | 1 = 0, totalCommits = 0, totalReversals = 0
  let input: DepthInput = 'wheel'
  // The opening is a short virtual prefix of this same scroll timeline. It
  // spends gesture distance without moving the document, then hands its
  // remaining momentum to ordinary page travel. It cannot close once settled.
  let arrivalRange = 0, arrivalSettled = false
  const openingRange = 440, openingSpeed = 400
  // The opening can also play by itself on its own clock, along a choreographed curve (normalized time to normalized
  // progress). Input during playback hurries what remains instead of fighting it; Escape or navigation finishes it.
  let play: { curve: (t: number) => number; duration: number; clock: number; speed: number; previous: number; frame: number } | null = null
  const HURRY_MS = 520
  const charges: DepthSequenceSnapshot['charges'] = []
  const pagePosition = (value = position) => Math.max(0, value - arrivalRange)
  const opening = () => arrivalRange > 0 && !arrivalSettled
  const clamp = (value: number) => Math.max(arrivalSettled ? arrivalRange : 0, Math.min(maximum, value))
  const active = () => opening() ? -1 : boundaries.findIndex(boundary => boundary.end - boundary.start >= 1 && pagePosition() >= boundary.start && pagePosition() < boundary.end)
  const snapshot = (): DepthSequenceSnapshot => {
    const activeIndex = active(), boundary = boundaries[activeIndex]
    const travel = boundary ? boundary.end - boundary.start : 1
    return {
      phase: moving ? 'transitioning' : 'settled', pressure: 0, threshold: 0,
      progress: boundary ? Math.max(0, Math.min(1, (pagePosition() - boundary.start) / travel)) : 0,
      target: direction < 0 ? 0 : 1, direction, commits: totalCommits, reversals: totalReversals,
      start: boundary?.start ?? pagePosition(), end: boundary?.end ?? pagePosition() + 1,
      nativeY, pendingEnergy: target - position, velocity: velocity / travel, isAnimating: moving,
      activeIndex, boundaryId: boundary?.id ?? null,
      boundaries: boundaries.map(boundary => ({ ...boundary })), totalCommits, totalReversals,
      charges: charges.map(charge => ({ ...charge })), targetY: pagePosition(target), lagPx: target - position, velocityPx: velocity,
      arrivalProgress: arrivalRange ? Math.max(0, Math.min(1, position / arrivalRange)) : 1,
      arrivalActive: opening(), arrivalPosition: Math.min(arrivalRange, position), arrivalTarget: Math.min(arrivalRange, target),
      arrivalPlaying: !!play,
    }
  }
  const emit = () => { if (!destroyed) options.onUpdate(snapshot()) }
  const stop = () => { cancelAnimationFrame(frame); frame = 0; previous = 0; moving = false; velocity = 0 }
  const write = (next: number) => {
    const before = pagePosition()
    position = clamp(next)
    if (arrivalRange && position >= arrivalRange - .001) arrivalSettled = true
    for (const boundary of boundaries) {
      if (boundary.end - boundary.start < 1) continue
      const seam = boundary.end
      if (before < seam && pagePosition() >= seam || before > seam && pagePosition() <= seam) {
        totalCommits++
        charges.push({ boundaryId: boundary.id, threshold: 0, remainingEnergy: 0, time: performance.now() })
        if (charges.length > 100) charges.shift()
      }
    }
    window.scrollTo({ top: pagePosition(), behavior: 'instant' })
    nativeY = window.scrollY
    if (Math.abs(nativeY - pagePosition()) > 1) { position = target = arrivalRange + nativeY; velocity = 0 }
  }
  const stopPlay = () => { if (play) { cancelAnimationFrame(play.frame); play = null } }
  const hurry = () => {
    if (!play) return
    const remaining = (play.duration - play.clock) / play.speed
    if (remaining > HURRY_MS) play.speed *= remaining / HURRY_MS
  }
  const playTick = (now: number) => {
    if (!play || destroyed) return
    // Same stall cap as the follower: a background tab resumes where it paused instead of jumping ahead.
    const elapsed = play.previous ? Math.min(1000 / 30, Math.max(0, now - play.previous)) : 1000 / 60
    play.previous = now
    play.clock = Math.min(play.duration, play.clock + elapsed * play.speed)
    const t = play.clock / play.duration
    const next = arrivalRange * Math.max(0, Math.min(1, play.curve(t)))
    if (t >= 1) { play = null; write(arrivalRange); position = target = arrivalRange + window.scrollY; emit(); return }
    position = target = Math.max(position, next); write(position); emit()
    play.frame = requestAnimationFrame(playTick)
  }
  const rebase = () => {
    if (play) return
    stop(); position = target = opening() ? position : clamp(arrivalRange + window.scrollY); nativeY = window.scrollY; direction = 0
    emit()
  }
  const finishArrival = () => {
    stopPlay()
    if (!arrivalRange || arrivalSettled) return
    stop(); arrivalSettled = true; position = target = arrivalRange + window.scrollY; nativeY = window.scrollY; direction = 0
    emit()
  }
  const weight = () => {
    let distance = Infinity
    for (const boundary of boundaries) {
      if (boundary.end - boundary.start >= 1) distance = Math.min(distance, Math.abs(pagePosition() - boundary.end))
    }
    return Math.exp(-Math.pow(distance / DEPTH_GATE.boundarySpan, 2))
  }
  const tick = (now: number) => {
    frame = 0
    if (destroyed || !moving) return
    // Preserve wall-clock damping at both30Hz and60Hz. Cap long stalls at
    // one30Hz frame rather than repaying a background tab's accumulated time.
    const elapsed = previous ? Math.min(1 / 30, Math.max(0, (now - previous) / 1000)) : 1 / 60
    previous = now
    const steps = Math.max(1, Math.ceil(elapsed / (1 / 120))), dt = elapsed / steps
    const resistance = opening() ? 0 : weight()
    const damping = DEPTH_GATE.damping * (1 + .16 * resistance)
    const limit = opening() ? openingSpeed : DEPTH_GATE.maxPixelVelocity * (1 - DEPTH_GATE.boundaryBrake * resistance)
    let next = position
    for (let index = 0; index < steps; index++) {
      const error = target - next
      velocity += (DEPTH_GATE.stiffness * error - damping * velocity) * dt
      velocity = Math.max(-limit, Math.min(limit, velocity))
      const advanced = next + velocity * dt
      if ((target - advanced) * error <= 0) { next = target; velocity = 0; break }
      next = advanced
    }
    if (Math.abs(target - next) < .08 && Math.abs(velocity) < .6) {
      write(target); stop(); emit(); return
    }
    write(next); emit()
    frame = requestAnimationFrame(tick)
  }

  emit()
  return {
    snapshot,
    beginGesture() { if (!destroyed) rebase() },
    handle(delta: number, kind: DepthInput = 'wheel'): boolean {
      if (destroyed || !Number.isFinite(delta) || delta === 0) return false
      if (play) { if (delta > 0) hurry(); return true }
      // A discrete station/anchor may have written native scroll while its
      // scroll event is still queued. Reconcile before spending this input so
      // that queued event cannot later erase a newly accepted wheel delta.
      // Own follower writes keep nativeY equal and retain all pending lag.
      if (Math.abs(window.scrollY - nativeY) > .5) { finishArrival(); rebase() }
      const nextDirection = Math.sign(delta) as -1 | 1
      if (direction && nextDirection !== direction) {
        // Even a2px reversal retires the old forward lag before spending the
        // new delta. It never has to repay a target left ahead of the visitor.
        rebase(); totalReversals++
        // Spend the first2px immediately so a tiny reversal is visible on
        // the next frame, even on browsers that round native scroll pixels.
        const nudge = nextDirection * Math.min(2, Math.abs(delta))
        target = clamp(position + nudge); write(target); delta -= nudge
      }
      direction = nextDirection; input = kind
      if (input === 'touch' && !opening()) {
        // Finger-down movement follows the finger1:1. Weight comes from the
        // section treatment and the braking of released motion, not lost drags.
        stop(); target = clamp(position + delta); write(target); emit(); return true
      }
      const lag = opening() ? openingRange + DEPTH_GATE.maxWheelLag : input === 'coast' ? DEPTH_GATE.maxCoastLag : DEPTH_GATE.maxWheelLag
      const requested = clamp(target + delta)
      target = clamp(position + Math.max(-lag, Math.min(lag, requested - position)))
      if (Math.abs(target - position) > .01 && !frame) {
        moving = true; previous = 0; frame = requestAnimationFrame(tick)
      }
      emit()
      return true
    },
    configure(nextBoundaries: DepthBoundary[], maxScroll = Math.max(0, document.documentElement.scrollHeight - innerHeight)) {
      if (destroyed) return
      boundaries = nextBoundaries.map(boundary => ({ ...boundary }))
      maximum = arrivalRange + Math.max(0, maxScroll)
      target = clamp(target); position = clamp(position)
      if (Math.abs(window.scrollY - nativeY) > .5) rebase()
      else emit()
    },
    configureArrival(active: boolean) {
      if (destroyed) return
      if (!active) { finishArrival(); return }
      if (arrivalRange || arrivalSettled) return
      stop(); arrivalRange = openingRange; maximum += arrivalRange
      position = target = 0; nativeY = window.scrollY; direction = 0
      // Restored scroll positions are navigation, not a new entrance.
      if (window.scrollY > 1) finishArrival()
      else emit()
    },
    finishArrival,
    /** Play the opening by itself. `curve` maps normalized time to normalized progress; it should rise from 0 to 1. */
    playArrival(duration: number, curve: (t: number) => number) {
      if (destroyed || !opening() || play) return false
      stop(); direction = 0
      play = { curve, duration: Math.max(1, duration), clock: 0, speed: 1, previous: 0, frame: requestAnimationFrame(playTick) }
      emit()
      return true
    },
    hurryArrival: hurry,
    reconcile(y: number) {
      if (destroyed) return
      finishArrival(); stop(); position = target = clamp(arrivalRange + y); nativeY = window.scrollY; direction = 0; emit()
    },
    cancel() { if (!destroyed) rebase() },
    destroy() { destroyed = true; stop(); stopPlay() },
  }
}
