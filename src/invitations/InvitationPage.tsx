import { useEffect, useRef, useState } from 'react'
import { InvitationAssembly } from './InvitationAssembly'
import { SAMPLE_INVITATION } from './sample'
import { SAMPLE_DINNER_MENU } from './menu-sample'
import { InvitationLocation } from './InvitationLocation'
import { InvitationCalendar } from './InvitationCalendar'
import type { InvitationDocument, PublicInvitation } from '../../prototypes/sergio-admin/shared/invitations/types'
import { Logo } from '../components/Logo'
import { site } from '../content/site'
import { href } from '../components/ui'
import { booking } from '../content/booking'
import { eventPublicInvitation, invitationMenuVersion, type EventInvitationDto } from './event-transport'
import { observeInvitation, parseInvitationAttention, acknowledgeMenu, type InvitationAttention } from './invitation-attention'
import { useInvitationSequence } from './useInvitationSequence'
import { InvitationResponse } from './InvitationResponse'
import './InvitationPage.css'

const API_BASE = (import.meta.env.VITE_INVITATION_API_BASE as string | undefined)?.replace(/\/$/, '')
const clamp = (value: number) => Math.min(1, Math.max(0, value))
const dayLabel = (document: InvitationDocument) => new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(document.date + 'T12:00:00Z'))
const timeLabel = (document: InvitationDocument) => {
  const [hours, minutes] = document.startTime.split(':').map(Number)
  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${hours >= 12 ? 'pm' : 'am'} Eastern time`
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => { const query = matchMedia('(prefers-reduced-motion: reduce)'); const change = () => setReduced(query.matches); change(); query.addEventListener('change', change); return () => query.removeEventListener('change', change) }, [])
  return reduced
}

export function InvitationPage({ preview = false }: { preview?: boolean }) {
  const [invitation, setInvitation] = useState<InvitationDocument | null>(preview ? SAMPLE_INVITATION : null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'expired' | 'unavailable'>(preview ? 'ready' : 'loading')
  const [menuNew, setMenuNew] = useState(preview), [previewMenu, setPreviewMenu] = useState(true)
  const [tracking, setTracking] = useState<'none' | 'anonymous_totals'>('none')
  const [responseProof, setResponseProof] = useState<{ invitationId: string; accessToken: string } | null>(null)
  const attention = useRef<InvitationAttention | null>(null), attentionKey = useRef(''), currentMenuVersion = useRef<string | null>(null)
  const reduced = useReducedMotion(), details = useRef<HTMLElement>(null), serverRevision = useRef(-1)
  const body = useRef<HTMLDivElement>(null), dockSlot = useRef<HTMLDivElement>(null), ceremony = useRef<HTMLDivElement>(null), footer = useRef<HTMLElement>(null)
  const hasMenu = preview ? previewMenu : !!invitation?.menuConfirmed && invitation.menu.some(line => line.trim())
  const opening = useInvitationSequence(status === 'ready' && !!invitation, reduced, hasMenu)
  const [placement, setPlacement] = useState({ viewportWidth: 1024, viewportHeight: 768, footerHeight: 154, introTop: 0, dockLeft: 0, dockTop: 768, dockWidth: 500, dockProgress: 0 })
  const [calendarRevision, setCalendarRevision] = useState(1)
  const unfolding = clamp(opening.progress), fold = opening.completed ? 1 : unfolding * unfolding * (3 - 2 * unfolding)
  const dock = opening.bypassed ? 1 : placement.dockProgress
  const floatingFooter = status === 'ready' && opening.active && !opening.bypassed
  const footerExit = clamp(fold * 2.5)

  useEffect(() => { if (preview) setPreviewMenu(new URLSearchParams(location.search).get('menu') !== 'none') }, [preview])
  const revealMenu = () => {
    if (attention.current && currentMenuVersion.current) {
      attention.current = acknowledgeMenu(attention.current, currentMenuVersion.current)
      try { localStorage.setItem(attentionKey.current, JSON.stringify(attention.current)) } catch { /* Optional cross-visit memory. */ }
      setMenuNew(!!attention.current.newVersion)
    } else setMenuNew(false)
  }

  useEffect(() => {
    if (preview) return
    const fragment = new URLSearchParams(location.hash.slice(1)), token = fragment.get('token'), accessToken = fragment.get('invite'), id = new URLSearchParams(location.search).get('id')
    const eventTransport = !!id && !!accessToken, base = eventTransport ? booking.apiBase : API_BASE
    if (!token && !eventTransport) { setStatus('missing'); return }
    if (!base) { setStatus('unavailable'); return }
    let disposed = false, refreshing = false, current: PublicInvitation | null = null, expiryTimer: ReturnType<typeof setTimeout> | undefined, viewTimer: ReturnType<typeof setTimeout> | undefined, counted = false
    const controller = new AbortController()
    async function refresh() {
      if (refreshing) return
      refreshing = true
      try {
        const response = await fetch(`${base}/api/invitation`, { ...(eventTransport ? { method: 'POST', body: JSON.stringify({id,accessToken}) } : {}), headers: eventTransport ? { 'Content-Type': 'application/json', 'X-Booking-Request': '1' } : { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' })
        if (disposed) return
        if (response.status === 410 || response.status === 404 || response.status === 403) { setInvitation(null); setStatus(response.status === 410 ? 'expired' : 'missing'); return }
        if (!response.ok) throw new Error('unavailable')
        const payload = await response.json()
        const value = eventTransport ? eventPublicInvitation(payload as EventInvitationDto) : payload as PublicInvitation
        if (!value.document || !value.expiresAt || Date.parse(value.expiresAt) <= Date.now()) { setInvitation(null); setStatus('expired'); return }
        if (value.revision < serverRevision.current) return
        serverRevision.current = value.revision; setCalendarRevision(value.revision)
        current = value
        const marker = await invitationMenuVersion(value.document, eventTransport ? payload.menuVersion : undefined)
        if (disposed) return
        if (!attentionKey.current) {
          const identity = eventTransport ? id! : Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token!))), byte => byte.toString(16).padStart(2,'0')).join('')
          attentionKey.current = 'sergio-invitation-view:v1:' + identity
        }
        let previous = attention.current
        try { previous = parseInvitationAttention(localStorage.getItem(attentionKey.current)) ?? previous } catch { /* Same-page memory remains available. */ }
        attention.current = observeInvitation(previous, marker)
        try { localStorage.setItem(attentionKey.current, JSON.stringify(attention.current)) } catch { /* Storage is optional. */ }
        currentMenuVersion.current = marker; setMenuNew(!!attention.current.newVersion); setTracking(value.viewTracking)
        setResponseProof(eventTransport ? { invitationId: id!, accessToken: accessToken! } : null)
        setInvitation(value.document); setStatus('ready')
        clearTimeout(expiryTimer)
        expiryTimer = setTimeout(() => { if (Date.parse(value.expiresAt) <= Date.now()) { setInvitation(null); setStatus('expired') } else void refresh() }, Math.min(Date.parse(value.expiresAt) - Date.now(), 2_147_483_647))
        if (!counted && value.viewTracking === 'anonymous_totals') {
          clearTimeout(viewTimer)
          viewTimer = setTimeout(() => {
            if (disposed || document.visibilityState !== 'visible' || !current || Date.parse(current.expiresAt) <= Date.now()) return
            counted = true
            void fetch(`${API_BASE}/api/invitation/view`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit', referrerPolicy: 'no-referrer', body: JSON.stringify({ token, eventId: crypto.randomUUID() }), signal: controller.signal }).catch(() => {})
          }, 2000)
        }
      } catch (error) { if (!disposed && !(error instanceof DOMException && error.name === 'AbortError')) { setInvitation(null); setStatus('unavailable') } }
      finally { refreshing = false }
    }
    void refresh()
    const heartbeat = setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, 60_000)
    const visible = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('focus', visible)
    return () => { disposed = true; controller.abort(); clearInterval(heartbeat); clearTimeout(expiryTimer); clearTimeout(viewTimer); document.removeEventListener('visibilitychange', visible); window.removeEventListener('focus', visible) }
  }, [preview])

  useEffect(() => {
    if (!invitation) return
    let frame = 0
    const measure = () => {
      frame = 0
      if (!dockSlot.current) return
      const rectangle = dockSlot.current.getBoundingClientRect()
      const viewportHeight = innerHeight, viewportWidth = innerWidth
      const layout = body.current?.querySelector<HTMLElement>('.invitation-page-layout')
      const naturalTop = layout ? layout.getBoundingClientRect().top + scrollY + parseFloat(getComputedStyle(layout).paddingTop) : rectangle.top + scrollY
      const start = Math.max(0, naturalTop - viewportHeight * .93), end = Math.max(start + 1, naturalTop - (viewportWidth <= 760 ? 96 : 128))
      const dockProgress = opening.bypassed ? 1 : opening.completed ? clamp((scrollY - start) / (end - start)) : 0
      const measuredFooterHeight = footer.current?.dataset.floating === 'true' ? footer.current.offsetHeight : null
      const measurements = { viewportWidth, viewportHeight, introTop: ceremony.current?.getBoundingClientRect().top ?? 0, dockLeft: rectangle.left, dockTop: rectangle.top, dockWidth: rectangle.width, dockProgress }
      setPlacement(previous => {
        const next = { ...measurements, footerHeight: measuredFooterHeight ?? previous.footerHeight }
        return Object.keys(next).every(key => Math.abs(previous[key as keyof typeof next] - next[key as keyof typeof next]) < .2) ? previous : next
      })
    }
    const scroll = () => { if (!frame) frame = requestAnimationFrame(measure) }
    measure(); window.addEventListener('scroll', scroll, { passive: true }); window.addEventListener('resize', scroll)
    const observer = new ResizeObserver(scroll); if (body.current) observer.observe(body.current); if (ceremony.current) observer.observe(ceremony.current); if (footer.current) observer.observe(footer.current); observer.observe(dockSlot.current!)
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('scroll', scroll); window.removeEventListener('resize', scroll) }
  }, [opening.completed, opening.bypassed, invitation !== null])

  useEffect(() => { if (body.current) body.current.inert = !opening.completed }, [opening.completed, invitation !== null])
  useEffect(() => { if (footer.current) footer.current.inert = floatingFooter && footerExit > .95 }, [floatingFooter, footerExit > .95])
  const bodyReady = opening.completed && (opening.bypassed || dock > .3)
  useEffect(() => { if (details.current) details.current.inert = !bodyReady }, [bodyReady])
  useEffect(() => {
    if (!opening.bypassed || !invitation) return
    const frame = requestAnimationFrame(() => { window.scrollTo({ top: 0, behavior: 'auto' }); details.current?.focus({ preventScroll: true }) })
    return () => cancelAnimationFrame(frame)
  }, [opening.bypassed, invitation !== null])

  const introSheet = Math.min(560, Math.max(220, placement.viewportWidth - 64), Math.max(220, (placement.viewportHeight - placement.footerHeight - 128) * 7 / 5))
  const openSheet = Math.min(introSheet, Math.max(220, (placement.viewportHeight - 128) / 1.4))
  const openingSheet = introSheet + (openSheet - introSheet) * fold
  const masterWidth = openingSheet + 40 + (placement.dockWidth - openingSheet - 40) * dock
  const masterSheet = Math.min(openingSheet + (470 - openingSheet) * dock, Math.max(220, masterWidth - 40))
  const initialTop = Math.max(24, (placement.viewportHeight - placement.footerHeight - (introSheet * 5 / 7 + 80)) / 2)
  const openingTop = initialTop + (24 - initialTop) * fold
  const masterLeft = (placement.viewportWidth - openingSheet - 40) / 2 * (1 - dock) + placement.dockLeft * dock
  const masterTop = (placement.introTop + openingTop) * (1 - dock) + placement.dockTop * dock
  const dockSheet = Math.min(470, Math.max(220, placement.dockWidth - 40)), dockHeight = dockSheet * 5 / 7 * 1.96 + 180

  return <div className="invitation-page" data-opening={opening.active} data-revealed={opening.completed || status !== 'ready'} style={{ '--invitation-dock': dock } as React.CSSProperties}>
    <main id="invitation-main">
      {status === 'ready' && invitation ? <>
        <section className="invitation-experience" data-opening-progress={opening.progress.toFixed(3)} data-dock-progress={dock.toFixed(3)}>
          <h1 className="invitation-page-sr-only">An invitation from Sergio.</h1>
          <div className={`invitation-ceremony${opening.bypassed ? ' is-bypassed' : ''}`} ref={ceremony} role="group" aria-label="Open your invitation" style={{ height: opening.bypassed ? 0 : openingTop + openingSheet * 5 / 7 * (1 + fold * .96) + 112 }}>
            {!opening.completed && <button className="invitation-opening-skip" type="button" onClick={opening.skip}>Open invitation without animation</button>}
          </div>
          <div className="invitation-body" ref={body} aria-hidden={!opening.completed} data-ready={opening.completed}>
          <div className="invitation-page-layout">
            <div className="invitation-card-rail"><div className="invitation-card-position" ref={dockSlot} style={{ height: dockHeight }} aria-hidden="true" /></div>
            <section className="invitation-details" id="invitation-details" ref={details} tabIndex={-1} aria-hidden={!bodyReady} data-ready={bodyReady}>
              <p className="invitation-kicker">Your evening</p><h2>{invitation.title}</h2><p className="invitation-welcome">{invitation.recipientRole === 'customer' ? `A private ${invitation.experience === 'class' ? 'class' : 'dinner'} for you and your guests, with Sergio taking care of the food.` : `${invitation.hostName} has arranged an evening with Chef Sergio. We look forward to having you at the table.`}</p>
              <dl className="invitation-logistics"><div><dt>When</dt><dd>{dayLabel(invitation)}<span>{timeLabel(invitation)}</span></dd></div><div><dt>Where</dt><dd>{invitation.venueName}<span>{invitation.address.join('\n')}</span></dd></div></dl>
              {invitation.endAt && <InvitationCalendar document={invitation} preview={preview} revision={calendarRevision} />}
              <InvitationLocation document={invitation} preview={preview} />
              <section className="invitation-contact"><h3>A question before the evening?</h3><p>For anything you’d like Sergio to know before you arrive, get in touch directly.</p><a href={`mailto:${site.email}`}>Email Sergio</a><a href={site.phoneHref}>Call {site.phone}</a></section>
              {!preview && responseProof && <InvitationResponse {...responseProof} invitationVersion={calendarRevision}/>}
              <p className="invitation-signature">With pleasure,<br /><span>Sergio</span></p>
            </section>
          </div>
          </div>
          <div className="invitation-master" data-docked={dock > .96} style={{ width: masterWidth, left: masterLeft, top: masterTop }}>
            <InvitationAssembly document={invitation} specimenMenu={preview && previewMenu ? SAMPLE_DINNER_MENU : undefined} openProgress={fold} maxSheetWidth={masterSheet} onOpenRequest={opening.open} menuNew={menuNew} menuVersion={currentMenuVersion.current} menuProgress={opening.menuProgress} onMenuOpen={revealMenu} onMenuRevealRequest={opening.revealMenu} />
          </div>
        </section>
      </> : <section className="invitation-unavailable" aria-live="polite"><p className="invitation-kicker">A private invitation</p><h1>{status === 'loading' ? 'Opening your invitation…' : status === 'expired' ? 'Thank you for joining us.' : 'An invitation from Sergio.'}</h1><p>{status === 'loading' ? 'One moment while we check the latest details.' : status === 'expired' ? 'This invitation has ended. We hope to share another evening with you.' : status === 'unavailable' ? 'The invitation service is not available here yet. Please contact Sergio for your event details.' : 'Open the private invitation link Sergio sent you to see your evening’s details.'}</p><a href={`mailto:${site.email}`}>Contact Sergio</a></section>}
    </main>
    <footer ref={footer} className="invitation-page-footer" data-floating={floatingFooter} aria-hidden={floatingFooter && footerExit > .95 ? true : undefined} style={{ '--invitation-footer-exit': footerExit } as React.CSSProperties}><a href={href('/about/')}><Logo variant="compact" /></a>{(preview || tracking === 'anonymous_totals') && <p>{preview ? 'Sample invitation for design review.' : 'Invitation visits are counted anonymously. Repeat visits may be included.'}</p>}<a href={`mailto:${site.email}`}>A personal evening, with Chef Sergio & Co.</a></footer>
  </div>
}

export function InvitationPreview() { return <InvitationPage preview /> }
