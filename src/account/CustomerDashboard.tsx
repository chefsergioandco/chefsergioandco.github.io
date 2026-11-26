import './AccountPages.css'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { accountApi, accountFetch, AccountApiError, downloadReceipt } from './api'
import { SignInRequired } from './auth-client'
import { useAuth } from './AuthProvider'
import { AuthRequired, VerificationPanel } from './AccountPages'
import { navigateAccount } from './navigation'
import { accountReturnHref, currentReturnTo, signInHref } from './config'
import { CustomerReviews } from './CustomerReviews'

type MenuEdition = { text: string; finalizedAt: string; version: string }
type SavedMenu = MenuEdition & { id: string; bookingId: string; service: string; date: string; occasion: string; savedAt: string }
type Receipt = { id: string; number: string; type: string; amountMinor: number; issuedAt: string }
type Evening = { id: string; service: string; date: string; time: string; status: string; guests: number; occasion?: string; location?: string; actionUrl?: string; receipts?: Receipt[]; invitation?: { url: string; status: string; version: number } | null; planning?: { menu?: MenuEdition | null; interviewStatus?: string; interviewAt?: string; dateReserved?: boolean }; nextAction?: { kind: string; title: string; detail: string } }
type Profile = { displayName: string; preferences: string; email: string; emailVerified: boolean }
type View = 'evenings' | 'menus' | 'details' | 'menu' | 'reviews'
const fail = (value: unknown) => value instanceof Error ? value.message : 'Your details could not be opened. Please try again.'
const denied = (value: unknown) => value instanceof SignInRequired || value instanceof AccountApiError && [401, 403].includes(value.status)
function validDate(value: string) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false; const parsed = new Date(value + 'T12:00:00Z'); return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === value }
function date(value: string, short = false) { return validDate(value) ? new Intl.DateTimeFormat(short ? 'en-GB' : 'en-US', { day: 'numeric', month: short ? 'short' : 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(value + 'T12:00:00Z')) : 'Date to be agreed' }
function time(value: string) { const match = /^(\d{2}):(\d{2})$/.exec(value || ''); if (!match || +match[1] > 23 || +match[2] > 59) return 'Time to be agreed'; return `${+match[1] % 12 || 12}:${match[2]} ${+match[1] < 12 ? 'am' : 'pm'} ET` }
const money = (value: number) => Number.isSafeInteger(value) && value >= 0 ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value / 100) + ' USD' : 'Amount unavailable'
function safeLink(value?: string) { try { const url = new URL(value || '', location.origin); return value && url.origin === location.origin && !url.username && !url.password && !/[\u0000-\u0020\u007f]/.test(value) ? url.pathname + url.search + url.hash : null } catch { return null } }
function useLocationQuery() { const [query, setQuery] = useState(''); useEffect(() => { const update = () => setQuery(location.search); update(); window.addEventListener('site:navigate', update); window.addEventListener('popstate', update); return () => { window.removeEventListener('site:navigate', update); window.removeEventListener('popstate', update) } }, []); return new URLSearchParams(query) }
function reviewLink(bookingId: string) { const url = new URL(location.href); url.searchParams.set('view', 'reviews'); url.searchParams.set('booking', bookingId); url.searchParams.delete('menu'); return url.pathname + url.search + url.hash }
function viewLink(view: View) { const url = new URL(location.href); if (view === 'evenings') url.searchParams.delete('view'); else url.searchParams.set('view', view); url.searchParams.delete('booking'); url.searchParams.delete('menu'); return url.pathname + url.search + url.hash }
const title = (booking: Evening) => booking.occasion || booking.service || 'An evening with Sergio'
const status = (booking: Evening) => ({ requested: 'Request received · date not reserved', held: 'Held for review · awaiting confirmation', confirmed: 'Confirmed', cancelled: 'Cancelled' })[booking.status] || 'Status under review'
async function readAccount<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await accountFetch(path, { signal })
  const value = await response.json().catch(() => null)
  if (!response.ok || !value) throw new AccountApiError(typeof value?.error?.message === 'string' ? value.error.message : typeof value?.message === 'string' ? value.message : 'Your details could not be opened. Please try again.', response.status)
  return value as T
}

function DashboardContents() {
  const { state } = useAuth()
  const subject = state.kind === 'authenticated' ? state.identity.sub : ''
  const verified = state.kind === 'authenticated' && state.identity.email_verified === true
  const query = useLocationQuery(), requestedView = query.get('view') || 'evenings'
  const view: View = ['menus', 'details', 'menu', 'reviews'].includes(requestedView) ? requestedView as View : 'evenings'
  const bookingId = query.get('booking') || '', savedId = query.get('menu') || ''
  const [bookings, setBookings] = useState<Evening[]>([]), [menus, setMenus] = useState<SavedMenu[]>([]), [profile, setProfile] = useState<Profile | null>(null)
  const [name, setName] = useState(''), [preferences, setPreferences] = useState(''), [recordOwner, setRecordOwner] = useState('')
  const [loading, setLoading] = useState(true), [fresh, setFresh] = useState(false), [error, setError] = useState(''), [feedback, setFeedback] = useState(''), [busy, setBusy] = useState('')
  const [privateLink, setPrivateLink] = useState(''), [captured, setCaptured] = useState(false), [claimError, setClaimError] = useState('')
  const dirty = useRef(false), loaded = useRef(false), sequence = useRef(0), operation = useRef<string | null>(null), controller = useRef<AbortController | null>(null)
  const currentSubject = useRef(subject), currentVerified = useRef(verified), container = useRef<HTMLDivElement>(null)
  currentSubject.current = subject; currentVerified.current = verified
  const clearPrivate = useCallback(() => { setBookings([]); setMenus([]); setProfile(null); setName(''); setPreferences(''); setRecordOwner(''); setFresh(false); dirty.current = false; loaded.current = false }, [])
  const load = useCallback(async () => {
    if (operation.current || !subject || !verified) return
    const owner = subject, run = ++sequence.current, abort = new AbortController()
    controller.current = abort; operation.current = 'load'; setLoading(true); setFresh(false); setError('')
    const current = () => run === sequence.current && currentSubject.current === owner && currentVerified.current && !abort.signal.aborted
    try {
      const result = await readAccount<{ user: { name: string; emailVerified: boolean }; bookings: Evening[] }>('/customer/bookings', abort.signal)
      if (!current()) return
      if (result.user?.emailVerified !== true) { clearPrivate(); setError('Verify your email before opening your linked evenings.'); return }
      if (!Array.isArray(result.bookings)) throw new Error('Your evenings could not be read. Please try again.')
      const [ownProfile, saved] = await Promise.all([readAccount<{ profile: Profile }>('/customer/profile', abort.signal), readAccount<{ menus: SavedMenu[] }>('/customer/menus', abort.signal)])
      if (!current()) return
      if (!ownProfile.profile || !Array.isArray(saved.menus)) throw new Error('Your saved details could not be read. Please refresh your account.')
      setBookings(result.bookings); setProfile(ownProfile.profile); setMenus(saved.menus); setRecordOwner(owner)
      if (!dirty.current) { setName(ownProfile.profile.displayName); setPreferences(ownProfile.profile.preferences) }
      loaded.current = true; setFresh(true)
    } catch (failure) {
      if (!current()) return
      if (denied(failure)) clearPrivate()
      setError(fail(failure) + (loaded.current ? ' Previously loaded details may be out of date.' : ''))
    } finally {
      if (run === sequence.current) { operation.current = null; controller.current = null; setLoading(false) }
    }
  }, [subject, verified, clearPrivate])
  useEffect(() => {
    ++sequence.current; controller.current?.abort(); controller.current = null; operation.current = null
    clearPrivate(); setBusy(''); setError(''); setFeedback(''); setLoading(false)
    if (subject && verified) void load()
    return () => { ++sequence.current; controller.current?.abort(); operation.current = null }
  }, [subject, verified, load, clearPrivate])
  useEffect(() => { const url = new URL(location.href); if (url.searchParams.get('ref') && /^[A-Za-z0-9_-]{43}$/.test(new URLSearchParams(url.hash.slice(1)).get('access') || '')) { setPrivateLink(url.href); setCaptured(true) } }, [])
  useEffect(() => { container.current?.querySelector<HTMLElement>('.ev-panel h1')?.focus({ preventScroll: false }) }, [view, bookingId, savedId])
  const privateAllowed = !!subject && verified && recordOwner === subject
  const visibleBookings = privateAllowed ? bookings : [], visibleMenus = privateAllowed ? menus : [], visibleProfile = privateAllowed ? profile : null
  const currentBooking = visibleBookings.find(item => item.id === bookingId), savedMenu = visibleMenus.find(item => item.id === savedId), edition = savedId ? savedMenu : currentBooking?.planning?.menu
  const editionSaved = !!savedMenu || !!edition && visibleMenus.some(item => item.bookingId === currentBooking?.id && item.version === edition.version)
  const disabled = !!busy || loading || !privateAllowed || !fresh || !verified
  function openMenu(booking: Evening) { const url = new URL(location.href); url.searchParams.set('view', 'menu'); url.searchParams.set('booking', booking.id); url.searchParams.delete('menu'); navigateAccount(url.pathname + url.search + url.hash) }
  async function perform<T>(key: string, task: () => Promise<T>, apply: (result: T) => void): Promise<boolean> {
    if (operation.current || disabled) return false
    const owner = subject, run = ++sequence.current
    operation.current = key; setBusy(key); setError(''); setFeedback('')
    const current = () => run === sequence.current && currentSubject.current === owner && currentVerified.current
    try { const result = await task(); if (!current()) return false; apply(result); return true }
    catch (failure) { if (current()) { if (denied(failure)) clearPrivate(); setFresh(false); setError(fail(failure)) }; return false }
    finally { if (run === sequence.current) { operation.current = null; setBusy('') } }
  }
  function saveProfile(event: FormEvent) {
    event.preventDefault()
    void perform('profile', () => accountApi<{ profile: Profile }>('/customer/profile', { displayName: name, preferences }), result => {
      if (!result.profile) throw new Error('The saved details could not be confirmed. Refresh your account before trying again.')
      setProfile(result.profile); setName(result.profile.displayName); setPreferences(result.profile.preferences); dirty.current = false; setFeedback('Your details are saved. Existing bookings are unchanged.')
    })
  }
  async function claim(event: FormEvent) {
    event.preventDefault(); setClaimError('')
    let ref: string, accessToken: string
    try { const url = new URL(privateLink); ref = url.searchParams.get('ref') || ''; accessToken = new URLSearchParams(url.hash.slice(1)).get('access') || ''; if (url.origin !== location.origin || !['/book/done/', '/dashboard/'].includes(url.pathname) || !ref || ref.length > 128 || !/^[A-Za-z0-9_-]{43}$/.test(accessToken)) throw new Error() }
    catch { setClaimError('Use the complete private booking link from this staging site, including its reference and the part after the #. Guest invitation links are separate.'); return }
    if (operation.current || loading || !verified || !fresh) return
    const linked = await perform('claim', () => accountApi<{ ok: boolean }>('/customer/claim', { ref, accessToken }), result => {
      if (result.ok !== true) throw new Error('The booking link could not be confirmed. Refresh your account before trying again.')
      setPrivateLink(''); setCaptured(false); const url = new URL(location.href); url.searchParams.delete('ref'); url.hash = ''; navigateAccount(url.pathname + url.search, true); setFeedback('Your booking is linked to this account.')
    })
    if (linked) await load()
  }
  function receipts(booking: Evening) {
    return !!booking.receipts?.length && <section className="ev-receipts"><h3>Payments &amp; receipts</h3><ul>{booking.receipts.map(receipt => <li className="ev-receipt" key={receipt.id}><div><strong>{receipt.type === 'refund' ? 'Refund receipt' : 'Payment receipt'}</strong><p className="ev-note">{money(receipt.amountMinor)} · {receipt.number}</p></div><button className="ev-text-button" disabled={disabled} onClick={() => void perform('pdf:' + receipt.id, () => downloadReceipt(receipt.id, receipt.number), () => {})}>{busy === 'pdf:' + receipt.id ? 'Opening…' : 'Download PDF'}</button></li>)}</ul><p className="ev-note">Each receipt records one payment or refund. Cancellation and refunds are handled separately.</p></section>
  }
  function historyRow(booking: Evening) {
    const href = safeLink(booking.actionUrl)
    return <article key={booking.id} className="ev-history-row"><time dateTime={validDate(booking.date) ? booking.date : undefined}>{date(booking.date, true)}</time><div><h3>{title(booking)}</h3><p>{booking.service} · {booking.guests} guests · {status(booking)}</p>{receipts(booking)}</div><div className="ev-actions">{booking.planning?.menu && <button className="ev-text-button" onClick={() => openMenu(booking)}>View menu</button>}{href && <a className="ev-text-button" href={href}>{booking.status === 'requested' ? 'View request' : 'View details'}</a>}{booking.status === 'confirmed' && validDate(booking.date) && booking.date < today && <a className="ev-text-button" href={reviewLink(booking.id)}>Review this evening</a>}</div></article>
  }
  function upcomingCard(booking: Evening) {
    const href = safeLink(booking.actionUrl), invitation = booking.invitation?.status === 'ready' ? safeLink(booking.invitation.url) : null
    const fallback = booking.status === 'requested' ? { title: 'Sergio is reviewing your request.', detail: 'Your ideas are kept with this request. No date is reserved yet.' } : booking.status === 'held' ? { title: 'The evening is taking shape.', detail: 'Open your request for the arrangements and next step with Sergio.' } : { title: 'The details of your evening.', detail: 'Your current arrangements are ready to review.' }
    return <article className="ev-upcoming"><div><p className="ev-eyebrow">Your next evening</p><h2>{title(booking)}</h2><p className="ev-summary"><span>{date(booking.date)} · {time(booking.time)}</span><span>{[booking.location, booking.guests + ' guests'].filter(Boolean).join(' · ')}</span></p><p className="ev-status">{status(booking)}</p><section className="ev-next"><h3>{booking.nextAction?.title || fallback.title}</h3><p>{booking.nextAction?.detail || fallback.detail}</p>{booking.nextAction?.kind === 'view_menu' && booking.planning?.menu ? <button className="ev-primary" onClick={() => openMenu(booking)}>View your menu</button> : href ? <a className="ev-primary" href={href}>{booking.status === 'requested' ? 'View your request' : booking.nextAction?.kind === 'schedule_interview' ? 'Arrange your conversation' : 'Review your evening'}</a> : <a className="ev-primary" href="mailto:hello@chefsergioandco.com">Contact Sergio</a>}</section>{receipts(booking)}</div><aside className="ev-aside"><p>Close at hand.</p>{invitation && <div className="ev-document"><div><h3>Invitation</h3><p>Yours to share with your guests</p></div><a className="ev-text-button" href={invitation}>View</a></div>}<div className="ev-document"><div><h3>Menu</h3><p>{booking.planning?.menu ? 'Approved with Sergio' : 'To discuss with Sergio'}</p></div>{booking.planning?.menu && <button className="ev-text-button" onClick={() => openMenu(booking)}>Read menu</button>}</div>{href && <div className="ev-document"><div><h3>Your details</h3><p>Current arrangements for this evening</p></div><a className="ev-text-button" href={href}>Review</a></div>}<a className="ev-text-button ev-contact" href="mailto:hello@chefsergioandco.com">Contact Sergio</a></aside></article>
  }
  const today = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/New_York' }).format(new Date())
  const upcoming = visibleBookings.filter(item => item.status !== 'cancelled' && (!validDate(item.date) || item.date >= today)).sort((a, b) => (validDate(a.date) ? a.date : '9999').localeCompare(validDate(b.date) ? b.date : '9999'))
  const next = upcoming[0], earlier = visibleBookings.filter(item => !upcoming.includes(item)).sort((a, b) => (validDate(b.date) ? b.date : '').localeCompare(validDate(a.date) ? a.date : ''))
  const returnTo = typeof location === 'undefined' ? '/dashboard/' : currentReturnTo()
  return <div className="evenings-account" ref={container}>
    <nav className="ev-nav" aria-label="Your account">{([['evenings', 'Your evenings'], ['menus', 'Saved menus'], ['reviews', 'Reviews'], ['details', 'Your details']] as const).map(([key, label]) => <a key={key} href={viewLink(key)} aria-current={(view === 'menu' ? savedId ? 'menus' : 'evenings' : view) === key ? 'page' : undefined}>{label}</a>)}</nav>
    {error && <div className="notice error" role="alert">{error} <button className="ev-text-button" disabled={loading || !!busy} onClick={() => void load()}>Refresh details</button> <a href={signInHref()}>Sign in again</a></div>}
    {feedback && <p className="ev-message" role="status">{feedback}</p>}
    <VerificationPanel/>
    {view === 'evenings' && <section className="ev-panel"><div className="ev-page-top"><div><h1 tabIndex={-1}>Your evenings.</h1><p className="ev-greeting">{visibleProfile?.displayName ? `Welcome, ${visibleProfile.displayName}.` : 'Welcome back.'}</p></div><div className="ev-actions"><a className="ev-text-button" href="/book/">Plan an evening</a><button className="ev-text-button" disabled={loading || !!busy || !verified} onClick={() => void load()}>{loading ? 'Refreshing…' : 'Refresh details'}</button></div></div><div aria-busy={loading}>{loading && !loaded.current ? <p className="ev-note" role="status">Opening your evenings…</p> : visibleBookings.length ? <>{next && upcomingCard(next)}{upcoming.length > 1 && <section className="ev-history"><h2>Also taking shape</h2>{upcoming.slice(1).map(historyRow)}</section>}{earlier.length > 0 && <section className="ev-history"><h2>Earlier evenings &amp; closed requests</h2>{earlier.map(historyRow)}</section>}</> : <div className="ev-empty"><h2>{verified ? 'Room for an evening.' : 'Confirm your email to continue.'}</h2><p>{verified ? 'Your linked bookings will appear here. Plan something new, or keep an existing request here using its private link below.' : 'Your linked evenings and saved menus stay private until your email is verified.'}</p>{verified && <a className="ev-primary" href="/book/">Plan an evening</a>}</div>}</div><p className="ev-note ev-context">All event times are Eastern time. A request does not reserve a date.</p></section>}
    {view === 'reviews' && (privateAllowed ? <CustomerReviews focusBooking={bookingId}/> : <section className="ev-panel"><h1 tabIndex={-1}>Your reviews.</h1><p className="ev-note" role="status">{loading ? 'Opening your evenings…' : 'Verify your email to review your evenings.'}</p></section>)}
    {view === 'menus' && <section className="ev-panel"><h1 tabIndex={-1}>Saved menus.</h1><p className="ev-intro">The menus you wanted to keep.</p>{loading && !loaded.current ? <p role="status">Opening your saved menus…</p> : visibleMenus.length ? visibleMenus.map(menu => <article className="ev-record" key={menu.id}><div><p className="ev-eyebrow">{date(menu.date)}</p><h2>{menu.occasion || menu.service}</h2><p className="ev-note">Saved approved edition</p><div className="ev-actions"><a className="ev-text-button" href={(() => { const url = new URL(location.href); url.searchParams.set('view', 'menu'); url.searchParams.set('menu', menu.id); url.searchParams.delete('booking'); return url.pathname + url.search + url.hash })()}>Read menu</a><button className="ev-text-button" disabled={disabled} onClick={() => { if (operation.current || disabled || !confirm('Remove this menu from your saved menus? Your evening and its current menu will stay in your account.')) return; void perform('remove:' + menu.id, () => accountApi('/customer/menus/remove', { id: menu.id }), () => { setMenus(value => value.filter(item => item.id !== menu.id)); setFeedback('Menu removed from your saved menus.') }) }}>Remove saved menu</button></div></div><div className="ev-menu-copy">{menu.text}</div></article>) : <div className="ev-empty"><h2>A menu worth returning to.</h2><p>Open an approved menu from one of your evenings and save the edition you’d like to keep.</p></div>}</section>}
    {view === 'details' && <section className="ev-panel"><h1 tabIndex={-1}>Your details.</h1><p className="ev-intro">The details you’d like to keep.</p><form className="ev-form" onSubmit={saveProfile}><label>What should we call you?<input value={privateAllowed ? name : ''} onChange={event => { dirty.current = true; setName(event.target.value) }} autoComplete="name" maxLength={100} disabled={busy === 'profile' || loading || !privateAllowed}/></label><label>Your usual preferences<textarea value={privateAllowed ? preferences : ''} onChange={event => { dirty.current = true; setPreferences(event.target.value) }} rows={4} maxLength={2000} aria-describedby="preference-help" placeholder="The pace, setting or kind of evening you enjoy" disabled={busy === 'profile' || loading || !privateAllowed}/></label><p id="preference-help" className="ev-note">Dietary requirements are confirmed separately for each evening. Saving a preference does not change an existing booking.</p><button className="ev-primary" type="submit" disabled={disabled || !visibleProfile}>{busy === 'profile' ? 'Saving…' : 'Save details'}</button></form><section className="ev-context"><h2>Your sign-in</h2><p className="ev-note">{state.kind === 'authenticated' ? state.identity.email : ''}</p><p className="ev-note">{verified ? 'Your email is verified. Sign-in details are managed through your secure sign-in provider.' : 'Verify your email to connect bookings and save menus.'}</p><div className="ev-actions"><a className="ev-text-button" href={accountReturnHref('/account/verify-email/', returnTo)}>Email verification</a><a className="ev-text-button" href={accountReturnHref('/account/password-reset/', returnTo)}>Sign-in help</a><a className="ev-text-button" href="/auth/logout/">Sign out</a></div></section></section>}
    {view === 'menu' && <section className="ev-panel"><a className="ev-text-button ev-back" href={viewLink(savedId ? 'menus' : 'evenings')}>Back to {savedId ? 'saved menus' : 'your evenings'}</a><h1 tabIndex={-1}>Your menu.</h1><p className="ev-intro">{savedMenu?.occasion || currentBooking?.occasion || currentBooking?.service}</p><p className="ev-note">{savedMenu ? 'Saved approved edition' : edition ? 'Current approved menu' : ''}</p><div className="ev-menu-copy">{edition?.text || (loading ? 'Opening this menu…' : 'This approved menu is not available. Return to your evenings to open the current details.')}</div>{edition && <><div className="ev-actions"><button className="ev-primary" disabled={disabled || editionSaved || !currentBooking || !!savedId} onClick={() => { if (!currentBooking || !edition || savedId || editionSaved) return; const original = { bookingId: currentBooking.id, version: edition.version }; void perform('save-menu', () => accountApi<{ menu: SavedMenu }>('/customer/menus/save', original), result => { if (!result.menu || result.menu.version !== original.version || result.menu.bookingId !== original.bookingId) throw new Error('The saved edition could not be confirmed. Refresh your account before trying again.'); setMenus(value => [result.menu, ...value.filter(item => item.id !== result.menu.id)]); setFeedback('This approved edition is saved to your menus.') }) }}>{editionSaved ? 'Saved to your menus' : busy === 'save-menu' ? 'Saving…' : 'Save this menu'}</button><a className="ev-text-button" href={'mailto:hello@chefsergioandco.com?' + new URLSearchParams({ subject: 'Another evening with Sergio', body: 'Hello Sergio,\n\nI’d like to plan another evening, starting from this menu:\n\n' + edition.text }).toString().replace(/\+/g, '%20')}>Discuss another evening</a></div><p className="ev-note">Saving keeps this approved edition, even if the menu is revised later.</p></>}</section>}
    <details className="ev-recovery" open={captured || undefined}><summary>Keep an existing request here</summary><p>Use the complete private booking link from your request. Your verified account email must match its contact email.</p><p className="ev-note">Guest invitation links are separate from the private booking details.</p><form className="ev-form" onSubmit={claim}>{captured ? <><p className="ev-note">Your private booking link is ready. Select “Link this booking” to keep the request here. Nothing is linked automatically.</p><button className="ev-text-button" type="button" disabled={!!busy} onClick={() => { setCaptured(false); setPrivateLink(''); const url = new URL(location.href); url.searchParams.delete('ref'); url.hash = ''; navigateAccount(url.pathname + url.search, true) }}>Use a different booking link</button></> : <label>Your private booking link<input value={privateLink} type="url" onChange={event => setPrivateLink(event.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} maxLength={4096} required disabled={!verified || !!busy}/><span className="ev-note">Include the full link, including the part after the #. It is used only to verify this request.</span></label>}{claimError && <p className="notice error" role="alert">{claimError}</p>}<button className="ev-primary" disabled={disabled || !privateLink}>{busy === 'claim' ? 'Linking…' : 'Link this booking'}</button></form></details>
  </div>
}
export function CustomerDashboard() { return <AuthRequired><DashboardContents/></AuthRequired> }
