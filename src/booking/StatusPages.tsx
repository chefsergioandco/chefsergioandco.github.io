import { useEffect, useState } from 'react'
import { Icon, type IconName } from '../components/Icons'
import { MenuCard } from '../components/MenuCard'
import { CtaButton, CtaLink } from '../components/CallToAction'
import { href } from '../components/ui'
import { site } from '../content/site'
import { BookingAccountAccess } from '../components/AccountAccess'
import { api } from './api'
import { clock, ics, longDate, money } from './format'
import { NightList } from './TableNights'
import type { BookingReceipt, Night, PlanningConfig } from './types'
import '../components/BookingForm.css'
import '../components/QuickBooking.css'
import { PrepareDetails } from './PrepareDetails'

const ref = () => new URLSearchParams(window.location.search).get('ref') ?? ''
export function cardFor(b: BookingReceipt) {
  return { format: b.kind === 'table' ? undefined : b.kind, table: b.kind === 'table', guests: b.guests ?? undefined, date: b.date ?? undefined, time: b.time ?? undefined, nightTitle: b.nightTitle }
}
const HEAD: Record<BookingReceipt['status'], { h1: string; stamp: string; icon: IconName }> = {
  requested: { h1: 'Your request is with Sergio', stamp: 'Requested', icon: 'mail' },
  held: { h1: 'Your date is held for review', stamp: 'Held for review', icon: 'calendar-days' },
  confirmed: { h1: 'Sergio has confirmed your booking', stamp: 'Confirmed', icon: 'circle-check' },
  cancelled: { h1: 'Your booking is cancelled', stamp: 'Cancelled', icon: 'clock' },
}
function nextSteps(b: BookingReceipt, config: PlanningConfig | null) {
  if (b.status === 'cancelled') return ['Your booking is no longer active. Any refund status is shown separately above.', 'Contact Sergio if you would like to discuss another gathering.']
  const p = b.planning, paid = p?.depositStatus === 'paid'
  if (p?.depositStatus === 'processing') return [b.kind === 'table' ? 'Your seat payment is processing. Your places stay held until it clears; no further payment is needed.' : 'Your deposit payment is processing. Your hold stays in place until it clears; no further payment is needed.', 'Some payment methods, such as bank payments, take a few business days. This page updates once your payment clears.']
  if (b.kind === 'table') return paid
    ? ['Your seat payment secures your places.', b.nightMinimumState === 'awaiting_minimum' ? `The evening is awaiting its minimum attendance.${b.decisionDate ? ` Sergio’s decision date is ${longDate(b.decisionDate.slice(0, 10))}.` : ''} If Sergio cancels, your seat payment is refunded in full.` : 'Sergio will share the details for your evening.']
    : ['Your seat request is with Sergio. An unpaid request does not hold seats.', config?.paymentReady ? 'Complete payment to secure available seats. Their availability is checked again at checkout.' : 'Online payments are not enabled yet. Sergio will discuss the arrangement with you.']
  return [
    paid ? 'Your deposit is received and will count in full toward your event bill.' : 'Your planning request is saved. No payment has been collected and no card is saved.',
    p?.dateReserved ? 'Your event date is reserved as shown above.' : 'Your event date is still to be agreed and reserved. Flexible-date planning does not block a calendar day.',
    'Your menu interview brings together the open questions about your date, people, kitchen, food and spending range.',
    'Agree a spending ceiling with Sergio during the call. He then finishes a menu within it and sends you your final details and invitation.',
  ]
}
function interviewLabel(status?: string) {
  return status === 'sent' ? 'Invitation sent' : status === 'scheduled' ? 'Time selected' : status === 'completed' ? 'Interview complete' : status === 'accepted' ? 'Invitation accepted' : 'To arrange'
}

/** The token-protected receipt reveals status and agreed public details, never guest contact or dietary notes. */
export function BookDone() {
  const [receipt, setReceipt] = useState<BookingReceipt | null | undefined>(), [config, setConfig] = useState<PlanningConfig | null>(null)
  const [error, setError] = useState(''), [loading, setLoading] = useState(false), [busy, setBusy] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false), [reason, setReason] = useState(''), [slotId, setSlotId] = useState(''), [notice, setNotice] = useState(''), [payError, setPayError] = useState('')
  async function load() {
    setLoading(true); setError('')
    const [bookingResult, settingsResult] = await Promise.allSettled([api.booking(ref()), api.config()])
    if (bookingResult.status === 'fulfilled') setReceipt(bookingResult.value)
    else setError(bookingResult.reason instanceof Error ? bookingResult.reason.message : 'Your current booking status could not be loaded.')
    if (settingsResult.status === 'fulfilled') setConfig(settingsResult.value)
    else {
      setConfig(null)
      if (bookingResult.status === 'fulfilled') setError('Your booking is saved, but payment availability could not be refreshed. Please try Refresh status again.')
    }
    setLoading(false)
  }
  useEffect(() => {
    void load()
    // A checkout that failed straight after the booking form is explained here.
    try { const key = 'booking-pay-error:' + ref(), message = sessionStorage.getItem(key); if (message) { setPayError(message); sessionStorage.removeItem(key) } } catch { /* Nothing to show. */ }
  }, [])
  async function cancel() {
    if (busy) return; setBusy(true); setError(''); setNotice('')
    try { await api.cancel(ref(), reason); setCancelOpen(false); await load(); setNotice('Your cancellation has been recorded. Payment and refund status are shown separately.') }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Your cancellation could not be confirmed. Please retry.') }
    finally { setBusy(false) }
  }
  async function schedule() {
    if (busy || !slotId) return; setBusy(true); setError(''); setNotice('')
    try { await api.scheduleInterview(ref(), slotId); await load(); setNotice('Your interview time has been saved. A menu-interview invitation is separate from your event invitation.') }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Your interview time could not be saved.') }
    finally { setBusy(false) }
  }
  async function pay() {
    if (busy) return; setBusy(true); setError(''); setPayError('')
    try {
      const result = await api.checkout(ref())
      if (result.paid) { await load(); setNotice('Your payment is recorded. Current booking and payment status are shown above.'); setBusy(false) }
      else location.assign(result.url)
    }
    catch (failure) { setPayError(failure instanceof Error ? failure.message : 'Checkout could not be opened. Your booking is still here.'); setBusy(false); void load() }
  }
  const p = receipt?.planning, paid = p?.depositStatus === 'paid'
  const file = receipt?.status === 'confirmed' ? ics(receipt) : null
  const head = receipt ? receipt.status === 'cancelled' ? HEAD.cancelled : paid ? { h1: receipt.kind === 'table' ? 'Your seats are secured' : p?.dateReserved ? 'Your date is reserved' : 'Your planning is underway', stamp: receipt.kind === 'table' ? 'Seats secured' : 'Deposit paid', icon: 'circle-check' as IconName } : HEAD[receipt.status] : null
  const interviewAt = p?.scheduledAt || p?.interviewAt
  let meetUrl: string | null = null
  try { const candidate = new URL(p?.meetUrl || ''); if (candidate.protocol === 'https:' && candidate.hostname === 'meet.google.com' && !candidate.username && !candidate.password) meetUrl = candidate.href } catch {}
  const depositLabel = p?.depositStatus === 'paid' ? `${p.depositAmount != null ? money(p.depositAmount) + ' ' : ''}received` : p?.depositStatus === 'processing' ? 'Payment processing' : p?.depositStatus === 'refund_pending' ? 'Refund processing' : p?.depositStatus === 'refunded' ? 'Refunded' : 'Unpaid · no card saved'
  return <section className="wrap py-10 md:py-16">
    {!receipt && <><h1 className="text-4xl sm:text-5xl">Your booking</h1>{loading ? <p className="mt-4 text-ink-muted" role="status">Loading your booking…</p> : error ? <div className="mt-4 max-w-prose"><p role="alert">{error}</p><CtaButton type="button" emphasis="secondary" className="mt-4" onClick={() => void load()}>Try again</CtaButton></div> : receipt === null ? <p className="mt-4 max-w-prose">This private booking link could not be opened. Use the complete link you saved after submitting, or <a className="link" href={site.phoneHref}>call Sergio at {site.phone}</a>.</p> : null}</>}
    {receipt && head && <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start"><div className="max-w-prose">
      <div role="status"><p className="booking-eyebrow">Your gathering with Sergio</p><h1 className="mt-3 flex items-start gap-3 text-4xl sm:text-5xl"><Icon name={head.icon} size={28} className="mt-1.5 shrink-0"/>{head.h1}</h1><p className="mt-3 text-sm text-ink-muted">Reference {receipt.ref}</p></div>
      <dl className="booking-receipt-facts">
        <div><dt>{receipt.kind === 'table' ? 'Seat payment' : 'Deposit'}</dt><dd>{depositLabel}</dd></div>
        <div><dt>Event date</dt><dd>{receipt.date ? `${longDate(receipt.date)}${receipt.time ? `, ${clock(receipt.time)}` : ''}` : 'To agree with Sergio'}{p && <span>{p.dateReserved ? 'Reserved' : 'Not reserved'}</span>}</dd></div>
        <div><dt>{receipt.kind === 'table' ? 'Seats' : 'Party size'}</dt><dd>{receipt.guests != null && receipt.guests > 0 ? `${receipt.guests} ${receipt.kind === 'table' && receipt.guests === 1 ? 'seat' : receipt.kind === 'table' ? 'seats' : 'guests'}` : p?.partyBandLabel || 'To agree'}</dd></div>
        {receipt.kind !== 'table' && <div><dt>Menu interview</dt><dd>{interviewLabel(p?.interviewStatus)}{interviewAt && <span>{new Date(interviewAt).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'long', timeStyle: 'short' })} Eastern time</span>}{meetUrl && <a className="link" href={meetUrl} target="_blank" rel="noopener noreferrer">Join your Google Meet interview</a>}</dd></div>}
        {receipt.location && <div><dt>Where</dt><dd>{receipt.location}</dd></div>}
        {receipt.kind === 'table' && <div><dt>{receipt.nightKind === 'class' ? 'The class' : 'The evening'}</dt><dd>{receipt.nightMinimumState === 'awaiting_minimum' ? 'Awaiting minimum attendance' : receipt.nightMinimumState === 'confirmed' ? 'Confirmed to run' : 'Sergio is reviewing your request'}{receipt.decisionDate && <span>Decision by {longDate(receipt.decisionDate.slice(0, 10))}</span>}</dd></div>}
        {p?.spendingCeiling != null && <div><dt>Agreed ceiling</dt><dd>{money(p.spendingCeiling)}</dd></div>}
      </dl>
      {notice && <p className="booking-notice" role="status">{notice}</p>}
      {receipt.status !== 'cancelled' && config?.paymentReady && p?.depositStatus === 'unpaid' && (receipt.kind === 'table' || p.depositAmount != null && p.depositAmount > 0) && <div className="mt-7"><CtaButton type="button" emphasis="primary" disabled={busy} onClick={() => void pay()}>{busy ? 'Opening secure checkout…' : receipt.kind === 'table' ? 'Pay for your seats' : 'Pay your deposit'}</CtaButton><p className="booking-small mt-3">The amount and availability are checked before checkout opens.</p></div>}
      {payError && <p role="alert" className="booking-notice booking-notice--error mt-4">{payError}</p>}
      {receipt.status !== 'cancelled' && receipt.kind !== 'table' && config?.interviewScheduling === 'self_schedule' && config.interviewSlots.length > 0 && paid && <section className="booking-receipt-section"><h2 className="text-2xl">Choose your menu interview</h2><p className="booking-small mt-2">Pick a time for your conversation with Sergio. Times below are Eastern time.</p><label className="sr-only" htmlFor="interview-slot">Interview time</label><select id="interview-slot" className="booking-input mt-4" value={slotId} onChange={event => setSlotId(event.target.value)}><option value="">Choose an interview time</option>{config.interviewSlots.map(slot => <option key={slot.id} value={slot.id}>{slot.label || new Date(slot.at).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'full', timeStyle: 'short' })}</option>)}</select><CtaButton type="button" emphasis="secondary" className="mt-4" disabled={busy || !slotId} onClick={() => void schedule()}>{busy ? 'Saving…' : 'Save interview time'}</CtaButton></section>}
      {receipt.kind !== 'table' && receipt.status !== 'cancelled' && p && !p.menu && <PrepareDetails bookingRef={receipt.ref}/>}
      <h2 className="mt-10 text-2xl">What happens next</h2><ol className="booking-next-steps">{nextSteps(receipt, config).map((step, index) => <li key={step}><span aria-hidden>{index + 1}</span><p>{step}</p></li>)}</ol>
      {p?.menu && <section className="booking-receipt-section"><p className="booking-eyebrow">Your finished menu</p><p className="booking-receipt-menu">{p.menu}</p></section>}
      {receipt.kind !== 'table' && receipt.status !== 'cancelled' && <p className="booking-small mt-6">You don’t need to accept a calendar invitation to keep your booking active. If an interview time doesn’t work, contact Sergio to rearrange it.</p>}
      {error && <p role="alert" className="booking-notice booking-notice--error">{error}</p>}
      <div className="cta-pair mt-8">{file && <CtaLink emphasis="secondary" download="chef-sergio.ics" href={`data:text/calendar;charset=utf-8,${encodeURIComponent(file)}`}><Icon name="calendar-days"/>Add event to calendar</CtaLink>}<CtaButton type="button" emphasis="secondary" disabled={loading || busy} onClick={() => void load()}>{loading ? 'Refreshing…' : 'Refresh status'}</CtaButton><CtaLink emphasis="secondary" href={site.phoneHref}><Icon name="phone"/>Call Sergio</CtaLink></div>
      {receipt.status !== 'cancelled' && !cancelOpen && <button type="button" className="link mt-7 text-sm" onClick={() => setCancelOpen(true)}>Cancel this {paid ? 'booking' : 'request'}</button>}
      {cancelOpen && <section className="booking-receipt-section" aria-label="Review cancellation"><h2 className="text-2xl">Cancel your {paid ? 'booking' : 'request'}?</h2><p className="mt-3">{paid ? receipt.kind === 'table' ? 'Sergio will review the applicable seat cancellation terms. Payment and any refund will be shown separately.' : `Before Sergio sends your menu-interview invitation, cancellation receives a full deposit refund. An explicit cancellation afterward may retain the planning fee disclosed when you paid${config?.planningFee != null ? ` (${money(config.planningFee)})` : ''}; Sergio may choose to refund fully.` : 'No payment has been collected. Cancelling closes this request.'}</p><label className="mt-4 block" htmlFor="cancel-reason">Anything you’d like Sergio to know? (optional)</label><textarea id="cancel-reason" className="booking-input mt-2" rows={3} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)}/><div className="cta-pair mt-4"><CtaButton type="button" emphasis="secondary" disabled={busy} onClick={() => setCancelOpen(false)}>Keep my booking</CtaButton><CtaButton type="button" emphasis="primary" disabled={busy} onClick={() => void cancel()}>{busy ? 'Cancelling…' : 'Confirm cancellation'}</CtaButton></div></section>}
      <p className="booking-small mt-7">Keep this private link to check your status. It is not emailed automatically. Your contact, kitchen and dietary details are not displayed here.</p>
      <BookingAccountAccess/>
    </div><MenuCard data={cardFor(receipt)} stamp={head.stamp}/></div>}
  </section>
}

/** Old prototype checkout URLs remain harmless while routes are migrated. */
export function MockCheckout() {
  return <section className="wrap py-10 md:py-16"><h1 className="text-4xl sm:text-5xl">Online checkout is unavailable</h1><p className="mt-4 max-w-prose">This website accepts requests only. No card is saved and no payment is collected here.</p><CtaLink emphasis="primary" className="mt-6" href={href('/book/')}>Send a request</CtaLink></section>
}

/** Published dates of one kind: Sergio's table (the default) or cooking classes. */
export function TableNightsLive({ kind = 'table' }: { kind?: 'table' | 'class' } = {}) {
  const [nights, setNights] = useState<Night[] | null>(null)
  const [paymentReady, setPaymentReady] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { api.config().then(value => setPaymentReady(value.paymentReady)).catch(() => {}) }, [])
  async function load() {
    setError(''); setNights(null)
    try { setNights(await api.nights()) }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Upcoming nights could not be loaded.') }
  }
  useEffect(() => { void load() }, [])
  if (error) return <div><p role="alert" className="text-ink-muted">{error}</p><CtaButton type="button" emphasis="secondary" className="mt-3" onClick={() => void load()}>Try again</CtaButton></div>
  if (!nights) return <p className="text-ink-muted" role="status">Loading upcoming nights. <noscript><a className="link" href={site.phoneHref}>Call {site.phone} to ask about a night.</a></noscript></p>
  return <NightList nights={nights.filter(night => (night.kind ?? 'table') === kind)} paymentReady={paymentReady} empty={kind === 'class' ? 'No class dates are open right now. New classes appear here when Sergio schedules them.' : undefined}/>
}
