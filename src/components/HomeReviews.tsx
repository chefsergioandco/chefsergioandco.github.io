import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { booking } from '../content/booking'
import { reviews as sourcedReviews } from '../content/site'
import { href } from './ui'
import { Icon } from './Icons'
import './HomeReviews.css'

/** A review as the homepage shows it. Account reviews come from the booking service; sourced ones from site.ts. */
type ShownReview = { id: string; quote: string; name: string; detail: string; account: boolean; source?: { label: string; url?: string } }
type AccountReview = { id: string; quote: string; name: string; service: string; month: string; verified: boolean }

const SERVICES: Record<string, string> = { 'Private dinner': 'Private dinner', 'Cooking class': 'Cooking class', 'Small event': 'Small event catering', 'Sergio’s Table': 'Sergio’s table' }
const monthYear = (month: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(month + '-15T12:00:00Z')) : ''
const valid = (item: unknown): item is AccountReview => {
  const review = item as AccountReview
  return !!review && typeof review.id === 'string' && /^rv_[0-9a-f]{32}$/.test(review.id) && typeof review.quote === 'string' && review.quote.length >= 20 && review.quote.length <= 600
    && typeof review.name === 'string' && review.name.length >= 1 && review.name.length <= 60 && typeof review.service === 'string' && !!SERVICES[review.service] && typeof review.month === 'string' && review.verified === true
}
const fromSite: ShownReview[] = sourcedReviews.map((review, index) => ({ id: `site-${index}`, quote: review.quote, name: review.name, detail: review.context, account: false, source: { label: review.source, url: review.url } }))
/** Longer quotes stay longer: about a reading speed, between 6 and 14 seconds. */
const dwell = (review: ShownReview) => Math.min(14_000, Math.max(6_000, 2_500 + review.quote.length * 45))

/**
 * "What clients say", as a masthead: one quote at a time in display type between two rules, cycling without end.
 * Reviews arrive live from client accounts (written after a confirmed evening), so the page needs no rebuild.
 * Visitors can step through them, swipe, or pause. It pauses while hovered or focused, and never moves by itself
 * for reduced motion. The prerendered page shows the invitation to review until reviews load.
 */
export function HomeReviews() {
  const [items, setItems] = useState<ShownReview[]>(fromSite), [index, setIndex] = useState(0), [direction, setDirection] = useState<1 | -1>(1)
  const [paused, setPaused] = useState(false), [held, setHeld] = useState(false), [reduced, setReduced] = useState(true), [visible, setVisible] = useState(false), [near, setNear] = useState(false)
  const stage = useRef<HTMLDivElement>(null), swipe = useRef<{ x: number; y: number; id: number } | null>(null)

  // Ask for reviews only once the section is within about a screen of view.
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setNear(true); observer.disconnect() } }, { rootMargin: '900px 0px' })
    if (stage.current) observer.observe(stage.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const base = booking.apiBase?.replace(/\/$/, '')
    if (!base || !near) return
    const abort = new AbortController()
    fetch(base + '/api/reviews', { signal: abort.signal, credentials: 'omit', referrerPolicy: 'no-referrer', headers: { Accept: 'application/json' } })
      .then(response => response.ok ? response.json() : null)
      .then((body: { reviews?: unknown[] } | null) => {
        const live = (Array.isArray(body?.reviews) ? body!.reviews : []).filter(valid).map((review): ShownReview => ({
          id: review.id, quote: review.quote, name: review.name, detail: [SERVICES[review.service], monthYear(review.month)].filter(Boolean).join(', '), account: true,
        }))
        if (live.length) { setItems([...live, ...fromSite]); setIndex(0) }
      })
      .catch(() => { /* The section keeps its invitation; reviews are never required to read the page. */ })
    return () => abort.abort()
  }, [near])

  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)'), update = () => setReduced(media.matches)
    update(); media.addEventListener('change', update)
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: .35 })
    if (stage.current) observer.observe(stage.current)
    return () => { media.removeEventListener('change', update); observer.disconnect() }
  }, [])

  const count = items.length, current = items[count ? index % count : 0]
  const step = (by: 1 | -1) => { if (count < 2) return; setDirection(by); setIndex(value => (value + by + count) % count) }
  const moving = count > 1 && !paused && !held && !reduced && visible

  useEffect(() => {
    if (!moving || !current) return
    const timer = window.setTimeout(() => step(1), dwell(current))
    return () => clearTimeout(timer)
  }, [moving, index, count])

  const pointerDown = (event: PointerEvent<HTMLDivElement>) => { if (event.pointerType !== 'mouse') swipe.current = { x: event.clientX, y: event.clientY, id: event.pointerId } }
  const pointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = swipe.current; swipe.current = null
    if (!start || start.id !== event.pointerId) return
    const dx = event.clientX - start.x, dy = event.clientY - start.y
    if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy) * 1.4) step(dx < 0 ? 1 : -1)
  }

  return (
    <section aria-labelledby="reviews" className="home-reviews bg-paper py-16 md:py-24">
      <div className="wrap">
        <div className="home-reviews-head">
          <h2 id="reviews" className="text-3xl md:text-4xl">What clients say</h2>
          {current?.account && <p className="home-reviews-note"><Icon name="circle-check" size={16} />Written by clients from their own accounts, after a confirmed evening.</p>}
        </div>
        {current ? (
          <div ref={stage} className="home-reviews-stage" role="region" aria-roledescription="carousel" aria-label="Client reviews"
            onPointerEnter={event => { if (event.pointerType === 'mouse') setHeld(true) }} onPointerLeave={() => setHeld(false)}
            onFocus={() => setHeld(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setHeld(false) }}
            onPointerDown={pointerDown} onPointerUp={pointerUp} onPointerCancel={() => { swipe.current = null }}
            onKeyDown={event => { if (event.key === 'ArrowRight') { event.preventDefault(); step(1) } else if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1) } }}>
            <figure key={current.id + ':' + index} className="home-review" data-direction={direction} aria-roledescription="slide" aria-label={`${index + 1} of ${count}`}>
              <blockquote className="home-review-quote"><p>{current.quote}</p></blockquote>
              <figcaption className="home-review-by">
                <span className="home-review-name">{current.name}</span>
                {current.detail && <span className="home-review-detail">{current.detail}</span>}
                {current.account ? (
                  <span className="home-review-badge"><Icon name="circle-check" size={14} />Client account</span>
                ) : current.source && (
                  <span className="home-review-detail">{current.source.url ? <a className="link" href={current.source.url}>{current.source.label}</a> : current.source.label}</span>
                )}
              </figcaption>
            </figure>
            {count > 1 && (
              <div className="home-reviews-controls">
                <button type="button" onClick={() => step(-1)} aria-label="Previous review"><Icon name="chevron-left" size={18} /></button>
                <span className="home-reviews-count" aria-hidden="true">{index + 1} / {count}</span>
                <button type="button" onClick={() => step(1)} aria-label="Next review"><Icon name="chevron-right" size={18} /></button>
                {!reduced && <button type="button" className="home-reviews-pause" onClick={() => setPaused(value => !value)} aria-label={paused ? 'Play reviews' : 'Pause reviews'}><Icon name={paused ? 'play' : 'pause'} size={16} /></button>}
              </div>
            )}
          </div>
        ) : (
          <div ref={stage} className="home-reviews-stage home-reviews-empty">
            <p className="home-review-quote">Reviews here are written by Sergio’s clients from their own accounts, after their evening.</p>
          </div>
        )}
        <p className="home-reviews-cta">
          Dined with Sergio? <a className="link" href={href('/dashboard/?view=reviews')}>Review your evening from your account</a>.
          <span className="home-reviews-cta-quiet"> No account yet? You can make one with the email you booked with.</span>
        </p>
      </div>
    </section>
  )
}
