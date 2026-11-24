import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

/**
 * The Experiences overview opens like the iPhone 4S Siri drawer: the page is a
 * sheet that slides away to uncover a tray already lying beneath it. The panel
 * grows in place, so the page below is pushed down while the tray's contents stay
 * anchored and are uncovered; a lightly damped spring gives the drawer its stop.
 *
 * Open and closed states stay owned by React (`hidden`, `aria-expanded`). While
 * collapsing, an already-hidden panel remains painted but inert, so assistive
 * technology and focus treat it as closed from the first frame.
 */
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

const OPEN_MS = 560, CLOSE_MS = 230, STAGGER_MS = 40

/** Damped spring (ζ 0.8, ~1.5% overshoot) sampled into CSS linear(). */
const spring = (() => {
  const zeta = .8, omega = 2 * Math.PI / .42, steps = 40, seconds = OPEN_MS / 1000
  const damped = omega * Math.sqrt(1 - zeta * zeta)
  const points = Array.from({ length: steps + 1 }, (_, index) => {
    const t = index / steps * seconds
    return 1 - Math.exp(-zeta * omega * t) * (Math.cos(damped * t) + zeta * omega / damped * Math.sin(damped * t))
  })
  points[steps] = 1
  return `linear(${points.map(point => +point.toFixed(4)).join(', ')})`
})()
const openEasing = () => typeof CSS !== 'undefined' && CSS.supports('transition-timing-function', 'linear(0, 1)') ? spring : 'cubic-bezier(.2, .9, .25, 1.04)'
const closeEasing = 'cubic-bezier(.45, 0, .8, .4)'

/** Tray contents settle a beat apart, top to bottom. */
const settling = (panel: HTMLElement) => [
  ...panel.querySelectorAll<HTMLElement>('.sergio-header-overview-heading, .sergio-header-experiences > a, .sergio-header-overview-bottom'),
]

export function useDrawer(panel: RefObject<HTMLElement>, open: boolean, reduced: boolean) {
  const motion = useRef<Animation[]>([])
  const first = useRef(true)

  useIsomorphicLayoutEffect(() => {
    const element = panel.current
    if (!element) return
    if (first.current) { first.current = false; return }
    const moving = motion.current.length > 0
    // React has already hidden a closing panel; keep it painted so it can be
    // measured, and so an interrupted motion continues from where it is.
    if (!open && !reduced) element.dataset.closing = ''
    const from = moving || !open ? element.getBoundingClientRect().height : 0
    for (const animation of motion.current) animation.cancel()
    motion.current = []
    element.inert = false
    if (open || reduced || typeof element.animate !== 'function') delete element.dataset.closing
    if (reduced || typeof element.animate !== 'function') return

    if (open) {
      const to = element.getBoundingClientRect().height
      if (to < 1) return
      element.dataset.animating = ''
      const drawer = element.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: OPEN_MS, easing: openEasing() })
      const contents = settling(element).map((child, index) => child.animate(
        [{ opacity: .35, transform: 'translateY(-10px)' }, { opacity: 1, transform: 'none' }],
        { duration: OPEN_MS, delay: index * STAGGER_MS, easing: openEasing(), fill: 'backwards' },
      ))
      motion.current = [drawer, ...contents]
      drawer.onfinish = drawer.oncancel = () => { if (motion.current[0] === drawer) { delete element.dataset.animating; motion.current = [] } }
      return
    }

    if (from < 1) { delete element.dataset.closing; return }
    // Closed for focus and assistive technology from the first frame.
    element.dataset.animating = ''
    element.inert = true
    const drawer = element.animate([{ height: `${from}px` }, { height: '0px' }], { duration: CLOSE_MS, easing: closeEasing })
    motion.current = [drawer]
    drawer.onfinish = () => {
      if (motion.current[0] !== drawer) return
      delete element.dataset.closing
      delete element.dataset.animating
      element.inert = false
      motion.current = []
    }
  }, [open])

  useEffect(() => () => { for (const animation of motion.current) animation.cancel() }, [])
}
