import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { InvitationCard } from '../invitations/InvitationCard'
import { buildInvitationCover, type FaceArtwork, type InvitationFace } from '../../prototypes/sergio-admin/shared/invitations/artwork'
import { insetQuad, interpolateQuad, matrixForQuad, type LayoutRect, type Quad, type UnitRect } from './home-emergence-geometry'
import './HomeArrival.css'

const SESSION_KEY = 'sergio.home-arrival.v1'
const COPY_READY = .76
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect
const clamp = (value: number) => Math.max(0, Math.min(1, value))
const blank = (face: InvitationFace): FaceArtwork => ({ face, width: 700, height: 500, finish: 'letterpress', commands: [], copy: [] })
const artwork = { cover: buildInvitationCover(), note: blank('note'), details: blank('details'), back: blank('back') }
type Progress = { progress: number; settled: boolean }
const smooth = (value: number) => { const t = clamp(value); return t * t * (3 - 2 * t) }
type Layer = { id: string; selector: string; region: UnitRect; enter: number; release: number; end: number; lift: number; tilt: number }
const layers: Layer[] = [
  { id: 'copy', selector: '.home-hero-copy', region: { x: .08, y: .23, width: .44, height: .68 }, enter: .46, release: .59, end: .94, lift: 88, tilt: 16 },
  { id: 'photo', selector: '.home-photograph', region: { x: .59, y: .25, width: .32, height: .63 }, enter: .49, release: .62, end: .95, lift: 116, tilt: -18 },
  { id: 'header', selector: '[data-site-header]', region: { x: .08, y: .06, width: .84, height: .12 }, enter: .455, release: .53, end: .78, lift: 102, tilt: 10 },
  { id: 'ways', selector: '#ways', region: { x: .08, y: .89, width: .84, height: .065 }, enter: .62, release: .74, end: 1, lift: 38, tilt: -8 },
]
const layoutRect = (element: HTMLElement): LayoutRect => { let left = 0, top = 0; for (let node: HTMLElement | null = element; node; node = node.offsetParent as HTMLElement | null) { left += node.offsetLeft; top += node.offsetTop } return { left, top, width: element.offsetWidth, height: element.offsetHeight } }
const rectQuad = (rect: LayoutRect): Quad => [{ x: rect.left, y: rect.top }, { x: rect.left + rect.width, y: rect.top }, { x: rect.left + rect.width, y: rect.top + rect.height }, { x: rect.left, y: rect.top + rect.height }]

/** The actual homepage stays in the DOM; its paper surface is exposed by one input owner. */
export function HomeArrival({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null), skip = useRef<HTMLButtonElement>(null)
  const [active, setActive] = useState(false), [progress, setProgress] = useState(1)
  const [geometry, setGeometry] = useState({ width: 1024, height: 768, footer: 140 })
  const layout = useRef<Record<string, { node: HTMLElement; rect: LayoutRect }>>({}), repaint = useRef<() => void>(() => {})
  const initialized = useRef(false)
  useEffect(() => {
    const element = root.current!
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    let finished = false, frame = 0
    const markSeen = () => { try { sessionStorage.setItem(SESSION_KEY, 'settled') } catch { /* The current page still remains open. */ } }
    const expose = (value: number, settled = false) => {
      if (!initialized.current) return
      const next = clamp(value)
      setProgress(next)
      element.dataset.arrivalProgress = String(next)
      element.style.setProperty('--home-arrival-progress', String(next))
      if (settled && !finished) {
        finished = true; setActive(false); element.dataset.arrivalActive = 'false'; markSeen()
        const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null
        const explicitBypass = focused === skip.current || !!focused?.closest('.home-arrival-cue')
        requestAnimationFrame(() => {
          if (explicitBypass) element.querySelector<HTMLElement>('#main')?.focus({ preventScroll: true })
          else if (focused?.isConnected && focused === document.activeElement && focused.matches(':focus-visible')) {
            const rect = focused.getBoundingClientRect(), headerBottom = element.querySelector('[data-site-header]')?.getBoundingClientRect().bottom ?? 0
            if (rect.top < headerBottom + 12 || rect.bottom > innerHeight - 12) focused.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
          }
        })
      }
    }
    const update = (event: Event) => { const value = (event as CustomEvent<Progress>).detail; expose(value.progress, value.settled) }
    const settle = () => window.dispatchEvent(new Event('home:arrival-skip'))
    const measure = () => {
      frame = 0
      const footer = element.querySelector<HTMLElement>('.site-footer')
      for (const layer of layers) { const node = element.querySelector<HTMLElement>(layer.selector); if (node) layout.current[layer.id] = { node, rect: layoutRect(node) } }
      const next = { width: innerWidth, height: innerHeight, footer: element.dataset.arrivalActive === 'true' ? footer?.offsetHeight || 140 : 140 }
      setGeometry(previous => Object.keys(next).every(key => Math.abs(previous[key as keyof typeof next] - next[key as keyof typeof next]) < .5) ? previous : next)
      repaint.current()
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure) }
    const focus = (event: FocusEvent) => { if (element.dataset.arrivalActive === 'true' && event.target instanceof Element && event.target.matches(':focus-visible') && !event.target.closest('.home-arrival-opening,.site-footer')) settle() }
    const preference = () => { if (media.matches) settle() }
    const pageShow = (event: PageTransitionEvent) => { if (event.persisted) settle() }
    window.addEventListener('home:arrival-progress', update)
    window.addEventListener('resize', schedule)
    window.addEventListener('pageshow', pageShow)
    element.addEventListener('focusin', focus)
    media.addEventListener('change', preference)
    const observer = new ResizeObserver(schedule)
    const hero = element.querySelector<HTMLElement>('[data-home-hero]'), footer = element.querySelector<HTMLElement>('.site-footer')
    if (hero) observer.observe(hero); if (footer) observer.observe(footer)
    let seen = false, storageAvailable = true
    try { seen = sessionStorage.getItem(SESSION_KEY) === 'settled' } catch { storageAvailable = false }
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    // The server route stays on #root across pushState navigation; referrer
    // and PerformanceNavigationTiming do not change for an internal SPA link.
    const documentRoute = document.getElementById('root')?.dataset.route
    let internal = !!documentRoute && documentRoute !== '/'
    try { internal ||= !!document.referrer && new URL(document.referrer).origin === location.origin } catch { /* Treat an unparseable referrer as external. */ }
    const eligible = storageAvailable && !media.matches && !seen && !location.hash && !internal && navigation?.type !== 'back_forward' && navigation?.type !== 'reload' && innerHeight >= 440 && scrollY <= 1 && document.documentElement.dataset.homeArrivalBoot !== 'expired'
    initialized.current = true
    finished = !eligible
    element.dataset.arrivalReady = 'true'; element.dataset.arrivalActive = String(eligible)
    setActive(eligible); setProgress(eligible ? 0 : 1)
    element.dataset.arrivalProgress = eligible ? '0' : '1'
    element.style.setProperty('--home-arrival-progress', eligible ? '0' : '1')
    window.dispatchEvent(new Event('home:arrival-ready'))
    if (!eligible) { markSeen(); delete document.documentElement.dataset.homeArrivalBoot }
    measure()
    document.fonts.ready.then(schedule)
    // If enhancement cannot install its owner, reveal the readable server-rendered site.
    const watchdog = window.setTimeout(() => { if (element.dataset.arrivalActive === 'true' && !window.__depthStudy?.arrivalActive) { expose(1, true); settle() } }, 1800)
    return () => { clearTimeout(watchdog); cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('home:arrival-progress', update); window.removeEventListener('resize', schedule); window.removeEventListener('pageshow', pageShow); element.removeEventListener('focusin', focus); media.removeEventListener('change', preference); initialized.current = false }
  }, [])

  useBrowserLayoutEffect(() => { if (initialized.current) delete document.documentElement.dataset.homeArrivalBoot }, [active])

  useBrowserLayoutEffect(() => {
    const element = root.current!
    const header = element.querySelector<HTMLElement>('[data-site-header]'), main = element.querySelector<HTMLElement>('#main'), footer = element.querySelector<HTMLElement>('.site-footer'), ways = element.querySelector<HTMLElement>('#ways')
    if (header) { const concealed = active && progress < .78; header.inert = concealed; if (concealed) header.setAttribute('aria-hidden', 'true'); else header.removeAttribute('aria-hidden') }
    if (main) { const concealed = active && progress < COPY_READY; main.inert = concealed; main.tabIndex = -1; if (concealed) main.setAttribute('aria-hidden', 'true'); else main.removeAttribute('aria-hidden') }
    if (footer) { footer.inert = active && progress >= .33; if (active && progress >= .33) footer.setAttribute('aria-hidden', 'true'); else footer.removeAttribute('aria-hidden') }
    if (ways) { ways.inert = active; if (active) ways.setAttribute('aria-hidden', 'true'); else ways.removeAttribute('aria-hidden') }
  }, [active, progress >= .33, progress >= COPY_READY, progress >= .78])

  const fold = smooth((initialized.current ? progress : 0) / .45), surface = progress >= COPY_READY
  const sheet = Math.min(560, Math.max(220, geometry.width - 64), Math.max(220, (geometry.height - geometry.footer - 128) * 1.4))
  const openSheet = Math.min(sheet, Math.max(220, (geometry.height - 128) / 1.4))
  const currentSheet = sheet + (openSheet - sheet) * fold
  const firstTop = Math.max(24, (geometry.height - geometry.footer - (sheet * 5 / 7 + 80)) / 2)
  const top = firstTop + (24 - firstTop) * fold

  useBrowserLayoutEffect(() => {
    const element = root.current!
    const paint = () => {
      if (!active) {
        for (const { node } of Object.values(layout.current)) { node.style.removeProperty('--emergence-transform'); node.style.removeProperty('--emergence-shadow'); for (const key of ['emergenceLayer', 'emergenceVisible', 'emergenceSource', 'emergenceQuad', 'emergenceRelease']) delete node.dataset[key] }
        return
      }
      const probes = ['tl', 'tr', 'br', 'bl'].map(corner => element.querySelector<HTMLElement>(`[data-invitation-corner="${corner}"]`))
      if (probes.some(probe => !probe)) return
      const paper = probes.map(probe => { const r = probe!.getBoundingClientRect(); return { x: r.x, y: r.y } }) as Quad
      for (const layer of layers) {
        const item = layout.current[layer.id]
        if (!item || !item.rect.width || !item.rect.height) continue
        const { node, rect } = item
        const emission = smooth((progress - layer.enter) / (layer.release - layer.enter))
        const release = smooth((progress - layer.release) / (layer.end - layer.release))
        const scale = Math.min(layer.region.width * currentSheet / rect.width, layer.region.height * currentSheet * 5 / 7 / rect.height)
        const width = rect.width * scale / currentSheet, height = rect.height * scale / (currentSheet * 5 / 7)
        const region = { x: layer.region.x + (layer.region.width - width) / 2, y: layer.region.y, width, height }
        const source = insetQuad(paper, region)
        const slit: Quad = [source[0], source[1], source[1], source[0]]
        const target = rectQuad({ ...rect, top: rect.top - scrollY, left: rect.left - scrollX })
        const quad = release > 0 ? interpolateQuad(source, target, release, { liftPx: layer.lift, tilt: layer.tilt }) : interpolateQuad(slit, source, Math.max(.001, emission), { liftPx: 12, tilt: 8 })
        node.dataset.emergenceLayer = layer.id
        node.dataset.emergenceVisible = String(emission > .035)
        node.dataset.emergenceSource = JSON.stringify(source)
        node.dataset.emergenceQuad = JSON.stringify(quad)
        node.dataset.emergenceRelease = String(release)
        node.style.setProperty('--emergence-transform', matrixForQuad(quad, { ...rect, top: rect.top - scrollY, left: rect.left - scrollX }))
        const shadow = Math.sin(Math.PI * release) * (1 - release)
        node.style.setProperty('--emergence-shadow', `0 ${2 + 20 * shadow}px ${4 + 26 * shadow}px rgba(45,43,39,${.03 + .12 * shadow})`)
      }
    }
    repaint.current = paint
    paint()
  }, [active, progress, geometry])

  useEffect(() => {
    if (!active) return
    const stage = root.current?.querySelector('.invitation-card-stage')
    if (!stage) return
    const observer = new ResizeObserver(() => repaint.current())
    observer.observe(stage)
    return () => observer.disconnect()
  }, [active])

  const styles = { '--home-arrival-footer-exit': clamp(progress / .35), '--home-arrival-card-opacity': 1 - smooth((progress - .92) / .08) } as React.CSSProperties
  return <div ref={root} className="home-arrival" data-home-arrival data-arrival-active={active} data-arrival-progress={progress} data-arrival-surface={surface} data-arrival-choreography="emergence" style={active ? styles : undefined} onClickCapture={event => { if (active && event.target instanceof Element && event.target.closest('a,[data-site-header] button')) window.dispatchEvent(new Event('home:arrival-skip')) }}>
    {children}
    <div className="home-arrival-opening" data-opening-active={active} aria-hidden={!active} aria-label="Open Sergio’s invitation" role={surface ? 'region' : 'main'}>
      {!surface && <h1 className="sr-only">An invitation from Sergio.</h1>}
      <button ref={skip} className="home-arrival-skip" type="button" tabIndex={active ? 0 : -1} onClick={() => window.dispatchEvent(new Event('home:arrival-skip'))}>Skip opening and enter site</button>
      <div ref={node => { if (node) node.inert = true }} className="home-arrival-card" aria-hidden="true" style={{ width: currentSheet + 40, left: (geometry.width - currentSheet - 40) / 2, top }}><InvitationCard artwork={artwork} openProgress={fold} maxSheetWidth={currentSheet} showTranscript={false} surfaceMarkers /></div>
      <div className="home-arrival-cue" aria-hidden={progress >= .18 ? true : undefined} style={{ top: firstTop + sheet * 5 / 7 + 80 }}><span>Scroll to open</span><button type="button" tabIndex={!active || progress >= .18 ? -1 : 0} onClick={() => window.dispatchEvent(new Event('home:arrival-skip'))}>Enter site</button></div>
    </div>
  </div>
}
