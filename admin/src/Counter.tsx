import { useEffect, useRef, useState, type CSSProperties } from 'react'

type CounterProps = {
  value: number
  format?: (value: number) => string
  delay?: number
  duration?: number
  className?: string
}

const numberText = (value: number) => String(value)
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
const hiddenText: CSSProperties = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
  overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap', border: 0,
}

/** Animate the visual number while exposing the accurate final value immediately. */
export default function Counter({ value, format = numberText, delay = 0, duration = 900, className = '' }: CounterProps) {
  const [displayed, setDisplayed] = useState(() => reducedMotion() ? value : 0)
  const current = useRef(displayed)

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0
    let timer = 0
    let stopped = false
    const cancel = () => {
      window.clearTimeout(timer)
      window.cancelAnimationFrame(frame)
    }
    const show = (next: number) => {
      current.current = next
      setDisplayed(next)
    }
    const finish = () => {
      cancel()
      show(value)
    }
    const preferenceChanged = () => {
      if (preference.matches) {
        stopped = true
        finish()
      }
    }
    preference.addEventListener('change', preferenceChanged)

    if (preference.matches || duration <= 0 || current.current === value) {
      show(value)
    } else {
      const from = current.current
      timer = window.setTimeout(() => {
        let start: number | undefined
        const tick = (now: number) => {
          if (stopped) return
          start ??= now
          const progress = Math.min(1, (now - start) / duration)
          // A quick start and a soft, finite arrival, without an overshoot.
          const eased = 1 - Math.pow(1 - progress, 4)
          const rounded = Math.round(from + (value - from) * eased)
          show(progress === 1 ? value : Math.max(Math.min(from, value), Math.min(Math.max(from, value), rounded)))
          if (progress < 1) frame = window.requestAnimationFrame(tick)
        }
        frame = window.requestAnimationFrame(tick)
      }, Math.max(0, delay))
    }

    return () => {
      stopped = true
      cancel()
      preference.removeEventListener('change', preferenceChanged)
    }
    // Formatting is applied at render time and never restarts the animation.
  }, [value, delay, duration])

  return <span className={`counter ${className}`.trim()}>
    <span style={hiddenText}>{format(value)}</span>
    <span className="counter-value" aria-hidden="true">{format(reducedMotion() ? value : displayed)}</span>
  </span>
}
