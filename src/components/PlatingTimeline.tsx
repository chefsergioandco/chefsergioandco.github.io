import { useEffect, useRef, useState } from 'react'
import { href, Policy } from './ui'
import type { createPlatingScene } from './plating/frames'
import { Icon, type IconName } from './Icons'

declare const __PLATING_SEQUENCE_AVAILABLE__: boolean

type PlatingScene = ReturnType<typeof createPlatingScene>
const clamp = (n: number) => Math.max(0, Math.min(1, n))
const smooth = (n: number) => { const p = clamp(n); return p * p * (3 - 2 * p) }

/** Ease into a short spatial pause at each station, with continuous travel. */
export function platingProgress(raw: number) {
  const scaled = clamp(raw) * 3
  const segment = Math.min(2, Math.floor(scaled))
  return (segment + smooth((scaled - segment - .1) / .8)) / 3
}

const steps = [
  { short: 'Date', title: 'Choose your date.', body: <>Pick an open date and time, your guest count, and where you’ll gather. It takes about two minutes.</> },
  { short: 'Request', title: 'Plan your evening.', body: <>Send your request. Sergio reviews your date and menu, then confirms the arrangements with you. No card is charged here.</> },
  { short: 'Menu', title: 'Shape the menu.', body: <>Sergio plans the food around your guests, then sends the balance invoice.</> },
  { short: 'Dinner', title: 'Stay at the table.', body: <>Sergio cooks, serves every course and clears up. Enjoy the evening with your guests.</> },
]

const stepIcons: IconName[] = ['calendar-days', 'heart-handshake', 'utensils-crossed', 'armchair']

/** The completed, physically simulated still remains readable without motion. */
function PlatingStill() {
  if (!__PLATING_SEQUENCE_AVAILABLE__) return null
  return (
    <picture className="plating-still" aria-hidden="true">
      <source media="(max-width: 680px)" srcSet={`${href('art/plating/poster-640.webp')} 640w, ${href('art/plating/poster-1280.webp')} 1280w`} sizes="calc(100vw - 40px)" />
      <img src={href('art/plating/poster-1280.webp')} srcSet={`${href('art/plating/poster-1280.webp')} 1280w, ${href('art/plating/poster-1920.webp')} 1920w`} sizes="(min-width: 1200px) 1136px, calc(100vw - 64px)" width="1280" height="600" loading="lazy" decoding="async" alt="" />
    </picture>
  )
}

declare global {
  interface Window {
    __platingTimeline?: { raw: number; progress: number; active: number; start: number; travel: number; pinned: boolean; ready: boolean; capturing: boolean }
  }
}

export function PlatingTimeline() {
  const root = useRef<HTMLElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const sceneHost = useRef<HTMLDivElement>(null)
  const selectStep = useRef<(index: number) => void>(() => {})
  const [active, setActive] = useState(0)
  const [ready, setReady] = useState(false)
  const [reduced, setReduced] = useState(false)
  const [pinned, setPinned] = useState(false)

  useEffect(() => {
    const element = root.current!, content = frame.current!, host = sceneHost.current!
    const header = document.querySelector<HTMLElement>('.home-header')
    const reduce = matchMedia('(prefers-reduced-motion: reduce)')
    const compact = matchMedia('(max-width: 680px)')
    let scene: PlatingScene | null = null
    let disposed = false, requested = false, graphicsReady = false, isPinned = false, near = false
    let start = 0, travel = 1, raw = 0, progress = 0, target = 0, currentStep = 0
    let animation = 0, layoutFrame = 0, previous = 0
    let scrollFrame = 0, requestedStop = 0
    let scrollMode: 'stop' | null = null
    const snapshot = { raw, progress, active: 0, start, travel, pinned: false, ready: false, capturing: false }
    window.__platingTimeline = snapshot

    const paint = () => {
      if (near) scene?.setProgress(reduce.matches ? 1 : progress)
      const next = Math.round(progress * 3)
      if (next !== currentStep) { currentStep = next; setActive(next) }
      Object.assign(snapshot, { raw, progress, active: next, start, travel, pinned: isPinned, ready: graphicsReady })
    }
    const animate = (now: number) => {
      const dt = Math.min(40, now - (previous || now - 16))
      previous = now
      progress += (target - progress) * (1 - Math.exp(-dt / 65))
      if (Math.abs(progress - target) < .00015) progress = target
      paint()
      animation = progress === target ? 0 : requestAnimationFrame(animate)
      if (!animation) previous = 0
    }
    const update = (immediate = false) => {
      if (!isPinned) { paint(); return }
      raw = clamp((scrollY - start) / travel)
      target = platingProgress(raw)
      if (immediate || !near) {
        cancelAnimationFrame(animation); animation = 0; previous = 0
        progress = target; paint()
      } else if (!animation && progress !== target) animation = requestAnimationFrame(animate)
    }
    const measure = () => {
      if (disposed) return
      const top = (header?.offsetHeight || 0) + 12
      const bottom = compact.matches ? 92 : innerHeight < 800 ? 16 : 28
      const available = innerHeight - top - bottom
      const condensed = graphicsReady && !reduce.matches && innerHeight < 800
      element.dataset.compactLayout = String(condensed)
      if (condensed) {
        const inner = content.querySelector<HTMLElement>('.plating-inner')!
        const art = content.querySelector<HTMLElement>('.plating-art')!
        const css = getComputedStyle(inner)
        const width = inner.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight)
        element.style.setProperty('--plating-art-width', `${width}px`)
        element.style.setProperty('--plating-art-height', `${width * .32 + 8}px`)
        const otherHeight = content.offsetHeight - art.offsetHeight
        const fittedWidth = Math.max(160, Math.min(width, (available - otherHeight - 10) / .32))
        element.style.setProperty('--plating-art-width', `${fittedWidth}px`)
        element.style.setProperty('--plating-art-height', `${fittedWidth * .32 + 8}px`)
      }
      isPinned = graphicsReady && !reduce.matches && content.offsetHeight <= available
      travel = Math.round(Math.max(640, Math.min(1100, innerHeight * .95)))
      // Section depth transitions transform this plane; offsets retain its
      // authored document position while its rendered rectangle moves.
      let naturalTop = 0
      for (let node: HTMLElement | null = element; node; node = node.offsetParent as HTMLElement | null) naturalTop += node.offsetTop
      start = naturalTop - top
      element.style.setProperty('--plating-top', `${top}px`)
      element.style.setProperty('--plating-frame-height', `${content.offsetHeight}px`)
      element.style.setProperty('--plating-travel', `${travel}px`)
      setPinned(isPinned)
      update(true)
    }
    const scheduleMeasure = () => {
      cancelAnimationFrame(layoutFrame)
      layoutFrame = requestAnimationFrame(measure)
    }
    const fail = () => {
      if (disposed) return
      graphicsReady = false
      setReady(false)
      setPinned(false)
      isPinned = false
      cancelAnimationFrame(animation)
      animation = 0
      cancelAnimationFrame(scrollFrame); scrollFrame = 0
      scrollMode = null
      snapshot.capturing = false
      element.dataset.graphics = 'fallback'
      scheduleMeasure()
    }
    const loadScene = async () => {
      if (requested || disposed || reduce.matches || !__PLATING_SEQUENCE_AVAILABLE__) return
      requested = true
      try {
        const { createPlatingScene } = await import('./plating/frames')
        if (disposed) return
        const instance = createPlatingScene(host, {
          onReady: () => {
            if (disposed) return
            graphicsReady = true
            element.dataset.graphics = 'ready'
            setReady(true)
            scheduleMeasure()
          },
          onError: fail,
        })
        if (disposed) { instance.dispose(); return }
        scene = instance
        scene.setProgress(progress)
      } catch { fail() }
    }
    const goToStop = (index: number) => {
      cancelAnimationFrame(scrollFrame)
      requestedStop = index
      scrollMode = 'stop'
      if (isPinned) {
        window.dispatchEvent(new Event('plating:scroll-capture'))
        const from = scrollY, destination = Math.max(0, start + travel * index / 3)
        const began = performance.now()
        const tick = (now: number) => {
          if (disposed || !isPinned || reduce.matches) { scrollFrame = 0; scrollMode = null; snapshot.capturing = false; return }
          const p = clamp((now - began) / 440)
          window.scrollTo({ top: from + (destination - from) * (1 - (1 - p) ** 3), behavior: 'instant' })
          update()
          scrollFrame = p < 1 ? requestAnimationFrame(tick) : 0
          if (!scrollFrame) { scrollMode = null; snapshot.capturing = false }
        }
        scrollFrame = requestAnimationFrame(tick)
      } else {
        cancelAnimationFrame(animation); animation = 0
        progress = target = index / 3
        raw = progress
        paint()
      }
    }
    selectStep.current = goToStop
    const bypass = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return false
      if (target.closest('input,textarea,select,[contenteditable=true],[role=dialog],[data-radix-popper-content-wrapper]')) return true
      for (let node: Element | null = target; node && node !== document.body; node = node.parentElement) {
        if (/(auto|scroll)/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 1) return true
      }
      return false
    }
    const inRange = () => isPinned && !reduce.matches && scrollY >= start - 3 && scrollY <= start + travel + 3
    const claim = (event: Event) => {
      event.preventDefault()
      event.stopImmediatePropagation()
      snapshot.capturing = true
      window.dispatchEvent(new Event('plating:scroll-capture'))
    }
    // HomeDepth owns continuous wheel/touch travel through the pinned scene.
    // This component follows native scroll and only owns explicit station
    // selections, which cancel the shared follower via the existing event.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Tab' || event.key === 'Escape') {
        cancelAnimationFrame(scrollFrame); scrollFrame = 0; scrollMode = null; snapshot.capturing = false
        return
      }
      if (!inRange() || event.ctrlKey || event.metaKey || event.altKey || bypass(event.target) || event.target instanceof Element && event.target.closest('button,a')) return
      const direction = ['ArrowDown', 'PageDown', ' '].includes(event.key) ? (event.shiftKey ? -1 : 1) : ['ArrowUp', 'PageUp'].includes(event.key) ? -1 : 0
      if (!direction) return
      const stop = scrollMode === 'stop' ? requestedStop : Math.round(progress * 3)
      if (stop === 0 && direction < 0 || stop === 3 && direction > 0) {
        if (scrollFrame) claim(event)
        else snapshot.capturing = false
        return
      }
      claim(event)
      if (!event.repeat) goToStop(Math.max(0, Math.min(3, stop + direction)))
    }
    const cancelScrollMotion = () => {
      cancelAnimationFrame(scrollFrame); scrollFrame = 0; scrollMode = null
      snapshot.capturing = false
    }
    const visibility = 'IntersectionObserver' in window ? new IntersectionObserver(([entry]) => {
      near = entry.isIntersecting
      if (near) { void loadScene(); update(true) }
      else { cancelAnimationFrame(animation); animation = 0; previous = 0 }
    }, { rootMargin: '160px 0px' }) : null
    visibility?.observe(element)
    if (!visibility) element.dataset.graphics = 'fallback'
    const size = new ResizeObserver(scheduleMeasure)
    size.observe(content)
    if (header) size.observe(header)
    const onScroll = () => {
      if (!inRange()) snapshot.capturing = false
      update()
    }
    const onReduce = () => {
      setReduced(reduce.matches)
      if (reduce.matches) {
        cancelAnimationFrame(animation); animation = 0
        cancelAnimationFrame(scrollFrame); scrollFrame = 0; scrollMode = null; snapshot.capturing = false
        scene?.setProgress(1)
      } else if (near) void loadScene()
      scheduleMeasure()
    }
    onReduce()
    measure()
    document.fonts.ready.then(() => { if (!disposed) scheduleMeasure() })
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('site:scroll-start', cancelScrollMotion)
    window.addEventListener('site:scroll-cancel', cancelScrollMotion)
    window.addEventListener('home:continuous-input', cancelScrollMotion)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', scheduleMeasure)
    window.addEventListener('pageshow', scheduleMeasure)
    reduce.addEventListener('change', onReduce)
    compact.addEventListener('change', scheduleMeasure)
    return () => {
      disposed = true
      visibility?.disconnect(); size.disconnect()
      cancelAnimationFrame(animation); cancelAnimationFrame(layoutFrame)
      cancelAnimationFrame(scrollFrame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('site:scroll-start', cancelScrollMotion)
      window.removeEventListener('site:scroll-cancel', cancelScrollMotion)
      window.removeEventListener('home:continuous-input', cancelScrollMotion)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', scheduleMeasure)
      window.removeEventListener('pageshow', scheduleMeasure)
      reduce.removeEventListener('change', onReduce)
      compact.removeEventListener('change', scheduleMeasure)
      scene?.dispose()
      selectStep.current = () => {}
      if (window.__platingTimeline === snapshot) delete window.__platingTimeline
    }
  }, [])

  const enhanced = ready && !reduced
  return (
    <section ref={root} aria-labelledby="how" className="home-plating" data-plating-timeline data-enhanced={enhanced} data-pinned={pinned}>
      <div ref={frame} className="plating-frame">
        <div className="wrap plating-inner">
          <div className="plating-heading">
            <h2 id="how">How booking works</h2>
            <p className="plating-scroll-hint" aria-hidden="true">Scroll to follow</p>
          </div>
          <div className="plating-art" aria-hidden="true">
            <PlatingStill />
            <div ref={sceneHost} className="plating-scene" />
          </div>
          <nav className="plating-mobile-stops" aria-label="Booking steps">
            {steps.map((step, index) => (
              <button key={step.short} type="button" aria-current={active === index ? 'step' : undefined} aria-controls={`plating-step-${index}`} onClick={() => selectStep.current(index)} onKeyDown={event => {
                if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
                event.preventDefault()
                const next = Math.max(0, Math.min(3, index + (event.key === 'ArrowRight' ? 1 : -1)))
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button')[next].focus()
                selectStep.current(next)
              }}><Icon name={stepIcons[index]} size={15} />{step.short}</button>
            ))}
          </nav>
          <ol className="plating-steps">
            {steps.map((step, index) => (
              <li key={step.short} id={`plating-step-${index}`} data-active={active === index}>
                <h3><button type="button" onClick={() => selectStep.current(index)} aria-current={enhanced && active === index ? 'step' : undefined}>{step.title}</button></h3>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  )
}
