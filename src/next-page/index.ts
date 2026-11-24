import { createAim, REST_MS, type Box, type Sample } from './model'

/**
 * Get the next page ready before the visitor asks for it.
 *
 * Evidence, from weakest to strongest, and what each earns:
 *  1. The page's own primary call to action, once the page is idle: fetch its document (a few KB compressed).
 *  2. Touch screens, after a scroll settles: the most prominent links in view get their documents.
 *  3. The pointer heading for a link and braking toward it (model.ts), or keyboard focus on it: also its page code
 *     and lead photograph.
 *  4. The pointer resting on a link, sustained focus, or a press: the whole page is rendered ahead (Chromium) or
 *     everything it needs is fetched at full priority (Safari, Firefox).
 *
 * With `documents` (links load new documents): Chromium gets Speculation Rules (its prerendered pages open instantly);
 * other browsers get the document into the HTTP cache. Without it (links are followed in the page, as on this site):
 * every level loads only the page's code and styles, adding its lead photograph from level 2, at full priority on
 * level 4. Save-Data and 2G connections only act on a press.
 * Each step is recorded as a performance mark, `next-page:<level>:<url>`, visible in the DevTools Performance panel.
 * Automated browsers (navigator.webdriver) are left alone; scripts/next-page-check.mjs measures all of this.
 */
/** Per page, from scripts/prerender.mjs: m its code, c stylesheets that code loads, i its lead photograph. */
type Hint = { m?: string[]; c?: string[]; i?: [src: string, srcset: string, sizes: string]; p?: 0 }
type Target = { url: string; key: string }
type Level = 1 | 2 | 3
type Reason = 'idle' | 'view' | 'aim' | 'rest' | 'focus' | 'press'

const BASE = import.meta.env.BASE_URL
/** Per page view. Prerenders also run at most two at a time: the oldest is cancelled for a newer one. */
const BUDGET: Record<Level, number> = { 1: 12, 2: 6, 3: 8 }
const LIVE_PRERENDERS = 2

export function installNextPage({ documents = true }: { documents?: boolean } = {}) {
  const source = document.getElementById('next-page-hints')
  // Automated browsers (test runners, many crawlers) would fetch pages nobody reads. See scripts/prerender.mjs.
  if (!source || !('fetch' in window) || navigator.webdriver) return
  let hints: Record<string, Hint>
  try { hints = JSON.parse(source.textContent || '{}') } catch { return }

  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection
  const frugal = () => !!connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType ?? '')
  const speculation = typeof HTMLScriptElement.supports === 'function' && HTMLScriptElement.supports('speculationrules')
  const linkPrefetch = document.createElement('link').relList.supports?.('prefetch') ?? false

  const reached = new Map<string, Level>()
  const spent: Record<Level, number> = { 1: 0, 2: 0, 3: 0 }
  const live: { url: string; script: HTMLScriptElement }[] = []
  const injected: Element[] = []
  const kept = new Set<HTMLImageElement>()
  const warmed = new Set<string>()

  function targetOf(anchor: HTMLAnchorElement | null): Target | null {
    if (!anchor || anchor.hasAttribute('download') || anchor.closest('[data-no-prefetch]')) return null
    if (anchor.target && anchor.target !== '_self') return null
    let url: URL
    try { url = new URL(anchor.href, location.href) } catch { return null }
    if (url.origin !== location.origin || !url.pathname.startsWith(BASE)) return null
    if (url.pathname === location.pathname && url.search === location.search) return null
    const key = '/' + url.pathname.slice(BASE.length)
    // Chromium matches speculations to the navigation including its #fragment.
    return hints[key] ? { url: url.pathname + url.search + url.hash, key } : null
  }

  // ---- Acting on a prediction ----
  function speculate(action: 'prefetch' | 'prerender', url: string) {
    const script = document.createElement('script')
    script.type = 'speculationrules'
    script.textContent = JSON.stringify({ [action]: [{ source: 'list', urls: [url], eagerness: 'immediate' }] })
    document.head.append(script)
    injected.push(script)
    return script
  }
  function fetchDocument(url: string, urgent: boolean) {
    if (speculation) return void speculate('prefetch', url)
    if (linkPrefetch && !urgent) {
      const link = Object.assign(document.createElement('link'), { rel: 'prefetch', href: url, as: 'document' })
      document.head.append(link)
      injected.push(link)
      return
    }
    // Safari has neither: an ordinary request puts the document in the HTTP cache for the navigation to reuse.
    void fetch(url, { credentials: 'same-origin', priority: urgent ? 'high' : 'low' } as RequestInit).catch(() => {})
  }
  function warm(key: string, urgent: boolean, photo = true) {
    const hint = hints[key]
    for (const file of hint.m ?? []) {
      if (warmed.has(file)) continue
      warmed.add(file)
      const link = Object.assign(document.createElement('link'), { rel: 'modulepreload', href: BASE + file, crossOrigin: '' })
      if (!urgent) link.setAttribute('fetchpriority', 'low')
      document.head.append(link)
      injected.push(link)
    }
    for (const file of hint.c ?? []) {
      if (warmed.has(file)) continue
      warmed.add(file)
      // Preloaded, not applied: this page's styles stay as they are.
      const link = Object.assign(document.createElement('link'), { rel: 'preload', as: 'style', href: BASE + file, crossOrigin: '' })
      if (!urgent) link.setAttribute('fetchpriority', 'low')
      document.head.append(link)
      injected.push(link)
    }
    if (photo && hint.i && !warmed.has(hint.i[0])) {
      warmed.add(hint.i[0])
      // A detached image picks the same srcset candidate the next page will: same viewport, same density.
      const image = new Image()
      image.decoding = 'async'
      image.fetchPriority = urgent ? 'high' : 'low'
      if (hint.i[2]) image.sizes = hint.i[2]
      if (hint.i[1]) image.srcset = hint.i[1]
      image.src = hint.i[0]
      kept.add(image)
    }
  }
  function want(target: Target, level: Level, reason: Reason) {
    if (frugal()) {
      if (reason !== 'press') return
      level = 1
    }
    const had = reached.get(target.url) ?? 0
    if (level <= had || spent[level] >= BUDGET[level]) return
    reached.set(target.url, level)
    spent[level]++
    performance.mark(`next-page:${level}:${target.url}`, { detail: { reason } })
    if (!documents) return void warm(target.key, level === 3, level >= 2)
    const prerender = level === 3 && speculation && hints[target.key].p !== 0
    if (prerender) {
      live.push({ url: target.url, script: speculate('prerender', target.url) })
      while (live.length > LIVE_PRERENDERS) {
        const oldest = live.shift()!
        oldest.script.remove()
        reached.set(oldest.url, 2)
      }
      // A prerender finds the photo and code only after its document arrives. Asking for them now runs those
      // requests alongside it; the prerender joins them through the HTTP cache. It matters most on a late tap.
      if (had < 2) warm(target.key, true)
      return
    }
    if (had < 1) fetchDocument(target.url, level === 3)
    if (level >= 2) warm(target.key, level === 3)
  }

  // ---- Where the links are ----
  type Spot = Target & { box: Box; anchor: HTMLAnchorElement }
  let spots: Spot[] = [], measuredAt = -Infinity
  const stale = () => { measuredAt = -Infinity }
  function measure(now: number) {
    if (now - measuredAt < 250) return spots
    measuredAt = now
    spots = []
    for (const anchor of document.querySelectorAll<HTMLAnchorElement>('a[href]')) {
      const target = targetOf(anchor)
      if (!target) continue
      if (anchor.checkVisibility && !anchor.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue
      for (const r of anchor.getClientRects()) {
        if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue
        // A few pixels of slack: people aim at the label, and land just outside it.
        spots.push({ ...target, anchor, box: { left: r.left - 4, top: r.top - 4, right: r.right + 4, bottom: r.bottom + 4 } })
      }
    }
    return spots
  }
  addEventListener('scroll', stale, { passive: true })
  addEventListener('resize', stale)
  document.addEventListener('transitionend', stale, true)
  document.addEventListener('toggle', stale, true)

  // ---- Pointer: heading, braking, resting ----
  const samples: Sample[] = []
  const aim = createAim()
  let frame = 0, restTimer = 0
  /** `restedFor`: ms since the last movement event, when called because the pointer stopped. */
  function evaluate(restedFor = 0) {
    frame = 0
    const spots = measure(performance.now())
    for (const wish of aim(samples, spots, restedFor)) {
      const spot = spots.find(s => s.url === wish.url)
      if (spot) want(spot, wish.level, wish.level === 3 && wish.rested ? 'rest' : 'aim')
    }
  }
  addEventListener('pointermove', event => {
    if (event.pointerType === 'touch') return
    const events = event.getCoalescedEvents?.() ?? []
    for (const e of events.length ? events : [event]) samples.push({ t: e.timeStamp, x: e.clientX, y: e.clientY })
    const cutoff = event.timeStamp - 240
    while (samples.length > 2 && (samples[0].t < cutoff || samples.length > 96)) samples.shift()
    if (!frame) frame = requestAnimationFrame(() => evaluate())
    // Movement events stop when the pointer does; look again once it has rested.
    clearTimeout(restTimer)
    restTimer = window.setTimeout(() => {
      evaluate(40)
      restTimer = window.setTimeout(() => evaluate(REST_MS), REST_MS - 40)
    }, 40)
  }, { passive: true })
  // Wheel scrolling moves links under a still pointer; that is not aiming. Where it stops is worth a warm-up only:
  // the pointer may have been left there by chance.
  addEventListener('scroll', () => {
    cancelAnimationFrame(frame); frame = 0
    clearTimeout(restTimer)
    if (samples.length) restTimer = window.setTimeout(() => evaluate(40), 160)
  }, { passive: true })

  // ---- Presses and keyboard ----
  const anchorFrom = (node: EventTarget | null) => (node instanceof Element ? node.closest<HTMLAnchorElement>('a[href]') : null)
  let pressed = ''
  addEventListener('pointerdown', event => {
    const target = targetOf(anchorFrom(event.target))
    if (!target) return
    const fresh = (reached.get(target.url) ?? 0) < 3
    want(target, 3, 'press')
    pressed = event.pointerType === 'touch' && fresh ? target.url : ''
  }, { passive: true, capture: true })
  // A finger that starts a scroll on a link card was not tapping it: drop the render that press started. Browsers
  // signal this with pointercancel, but not always (Chromium's synthetic gestures don't), so a scroll counts too.
  const dropPress = () => {
    const entry = live.find(l => l.url === pressed)
    pressed = ''
    if (!entry) return
    entry.script.remove()
    live.splice(live.indexOf(entry), 1)
    reached.set(entry.url, 2)
    spent[3]--
  }
  addEventListener('pointercancel', dropPress, { passive: true, capture: true })
  addEventListener('scroll', () => { if (pressed) dropPress() }, { passive: true })
  addEventListener('pointerup', () => { pressed = '' }, { passive: true, capture: true })
  let focusTimer = 0
  addEventListener('focusin', event => {
    clearTimeout(focusTimer)
    const anchor = anchorFrom(event.target)
    const target = targetOf(anchor)
    if (!anchor || !target || !anchor.matches(':focus-visible')) return
    want(target, 2, 'focus')
    // Tabbing through a menu passes over links; staying on one is a decision.
    focusTimer = window.setTimeout(() => { if (document.activeElement === anchor) want(target, 3, 'focus') }, 350)
  })

  // ---- Touch screens: what is in view when a scroll settles ----
  const salience = (anchor: HTMLAnchorElement) =>
    anchor.classList.contains('cta-link--primary') ? 1
      : anchor.hasAttribute('data-cta-card') ? 0.85
        : anchor.classList.contains('cta-link--secondary') ? 0.6
          : anchor.closest('#main') ? 0.4 : 0.15
  function settle() {
    const scored = new Map<string, { spot: Spot; score: number }>()
    for (const spot of measure(performance.now())) {
      const middle = (spot.box.top + spot.box.bottom) / 2 / innerHeight
      const score = salience(spot.anchor) * (middle > 0.2 && middle < 0.9 ? 1 : 0.5)
      if (score > (scored.get(spot.url)?.score ?? 0)) scored.set(spot.url, { spot, score })
    }
    const ranked = [...scored.values()].filter(s => s.score >= 0.5).sort((a, b) => b.score - a.score).slice(0, 2)
    ranked.forEach(({ spot, score }, i) => want(spot, i === 0 && score >= 0.85 ? 2 : 1, 'view'))
  }
  if (matchMedia('(hover: none)').matches) {
    let settleTimer = 0
    addEventListener('scroll', () => { clearTimeout(settleTimer); settleTimer = window.setTimeout(settle, 220) }, { passive: true })
  }

  // ---- Before any input: the page's own next step ----
  const idle = (run: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(run, { timeout: 4000 }) : setTimeout(run, 1500))
  const primary = () => {
    const seen = new Set<string>()
    for (const anchor of document.querySelectorAll<HTMLAnchorElement>('#main a.cta-link--primary[href]')) {
      const target = targetOf(anchor)
      if (!target || seen.has(target.url)) continue
      seen.add(target.url)
      want(target, 1, 'idle')
      if (seen.size === 2) break
    }
  }
  if (document.readyState === 'complete') idle(primary)
  else addEventListener('load', () => idle(primary), { once: true })
  // In-page navigation (src/entry-client.tsx) swaps the page without a load event: start again from the new page.
  const navigated = () => { stale(); idle(primary) }
  addEventListener('site:navigate', navigated)
  addEventListener('popstate', navigated)

  // Back/forward cache: speculations did not survive the trip, so forget them.
  addEventListener('pageshow', event => {
    if (!event.persisted) return
    for (const node of injected.splice(0)) node.remove()
    live.length = 0
    reached.clear()
    spent[1] = spent[2] = spent[3] = 0
  })
}
