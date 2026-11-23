import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { dateLabel, timeLabel, type AdminState, type Booking, type BookingStatus } from './model'
import { useAdmin } from './store'
import { Badge, Icon, Modal } from './ui'
import './Bookings.css'
import InterviewBrief from './InterviewBrief'
import {BillingPanel} from './Billing'
import {VenueDetails,DietaryDetails} from './GuestDetails'
import { calendarClosedReason, occupiesDate, scheduleConflictReason } from './calendar-policy'
import { BookingCommunications } from './Communications'

type Props = { initialId?: string; initialStatus?: BookingStatus | 'all'; initialScope?: 'all' | 'upcoming'; embedded?: boolean; onOpenHandled?: () => void }
type Dialog = 'detail' | 'quote' | 'reschedule' | 'cancel' | 'create' | null
type Draft = Record<'guest' | 'email' | 'phone' | 'date' | 'time' | 'guests' | 'location' | 'occasion' | 'dietary' | 'notes' | 'total' | 'deposit', string> & { type: Booking['type']; status: Exclude<BookingStatus, 'cancelled'> }
const TYPES: Booking['type'][] = ['Private dinner', 'Cooking class', 'Small event', 'Sergio’s Table']
const STATUS: { id: BookingStatus | 'all'; label: string }[] = [
  { id: 'all', label: 'All bookings' }, { id: 'requested', label: 'New requests' }, { id: 'held', label: 'Date held' }, { id: 'confirmed', label: 'Confirmed' }, { id: 'cancelled', label: 'Cancelled' },
]
const currency = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value)
const longDate = (date: string) => date ? dateLabel(date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : 'Date to be agreed'
const guestCountLabel = (booking: Booking) => booking.guests > 0 ? `${booking.guests} guests` : booking.planning?.original.partyBandLabel ? `${booking.planning.original.partyBandLabel} · estimated` : 'Party size to clarify'
const blankDraft = (): Draft => ({ guest: '', email: '', phone: '', type: 'Private dinner', date: '', time: '18:00', guests: '2', status: 'requested', location: '', occasion: '', dietary: '', notes: '', total: '', deposit: '' })

function dateConflict(state: AdminState, date: string, today: string, ignore?: string, linkedNightId?: string, time?: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'Choose a valid event date.'
  const parsed = new Date(`${date}T12:00:00Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return 'Choose a valid event date.'
  if (date < today) return 'Choose today or a future date.'
  const block = state.blocks.find((item) => item.date === date)
  if (block) return `This date is blocked: ${block.reason || 'Unavailable'}. Choose another date.`
  if(linkedNightId){
    const evening=state.nights.find(n=>n.id===linkedNightId)
    const current=state.bookings.find(b=>b.id===ignore)
    if(!evening||evening.status!=='published')return 'This Table evening is no longer open for reservations.'
    if(current&&current.status==='requested'&&evening.booked+current.guests>evening.seats)return 'There are no longer enough seats for this party. Contact the guest before confirming.'
    return ''
  }
  const prior = state.bookings.find(item => item.id === ignore)
  const unchangedSchedule = !!prior && occupiesDate(prior) && prior.date === date && prior.time === time
  const closure = calendarClosedReason(date)
  if (closure && !unchangedSchedule) return `This date is closed for ${closure}. Choose another date for this booking.`
  return scheduleConflictReason(state, date, { bookingId: ignore }) ?? ''
}
const validTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
function paymentLabel(booking: Booking) {
  if (booking.planning?.deposit.status === 'paid' && !booking.total) return 'Deposit paid · menu pending'
  if (booking.planning?.deposit.status === 'refund_pending') return 'Refund pending'
  if (booking.planning?.deposit.status === 'refunded') return 'Deposit refunded'
  if (booking.total === 0 && booking.paid === 0) return 'Quote pending'
  if (booking.paid >= booking.total) return 'Paid in full'
  if (booking.deposit > booking.paid) return booking.paid > 0 ? 'Deposit partly paid' : 'Deposit outstanding'
  return booking.paid > 0 ? 'Part paid' : 'Payment outstanding'
}
function BookingBadge({ booking }: { booking: Booking }) {
  return <Badge status={booking.status}>{booking.status === 'held' ? 'Date held' : undefined}</Badge>
}
function ErrorText({ id, text }: { id?: string; text?: string }) {
  return text ? <small className="booking-field-error" id={id}>{text}</small> : null
}

export default function Bookings({ initialId, initialStatus = 'all', initialScope = 'all', embedded = false, onOpenHandled }: Props) {
  const { state, update, planningAction, notify, businessDate: today, pending } = useAdmin()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<BookingStatus | 'all'>(initialStatus)
  const [scope, setScope] = useState<'all' | 'upcoming'>(initialScope)
  const [service, setService] = useState('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [notes, setNotes] = useState('')
  const [schedule, setSchedule] = useState({ date: '', time: '' })
  const [quote, setQuote] = useState({total:'',deposit:''})
  const [draft, setDraft] = useState<Draft>(blankDraft)
  const [showPayments, setShowPayments] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [cancellationReason, setCancellationReason] = useState('')
  const booking = state.bookings.find((item) => item.id === selectedId)
  const billingRecord = booking ? state.operations.billing.find(item => item.bookingId === booking.id) : undefined
  const canEditQuote = !!booking && booking.status !== 'cancelled' && booking.paid === 0 && (!billingRecord || billingRecord.invoiceState === 'draft' && billingRecord.events.length === 0)

  useEffect(() => { setStatus(initialStatus); setScope(initialScope); setQuery(''); setService('all') }, [initialStatus, initialScope])

  const openBooking = (item: Booking) => {
    setSelectedId(item.id); setNotes(item.notes); setCancellationReason(''); setSchedule({ date: item.date, time: item.time }); setErrors({}); setDialog('detail')
  }
  useEffect(() => {
    if (!initialId) return
    const item = state.bookings.find((entry) => entry.id === initialId)
    if (item) openBooking(item)
    else notify('That booking is no longer available.')
    onOpenHandled?.()
    // The incoming ID is a one-time navigation request, independent of edits.
  }, [initialId])

  const scopedBookings = useMemo(() => state.bookings.filter((item) => scope === 'all' || (item.date >= today && item.status !== 'requested' && item.status !== 'cancelled')), [state.bookings, scope, today])
  const statusOptions = scope === 'upcoming' ? STATUS.filter((tab) => ['all', 'held', 'confirmed'].includes(tab.id)) : STATUS
  const visible = useMemo(() => {
    const search = query.trim().toLocaleLowerCase()
    return scopedBookings.filter((item) => (status === 'all' || item.status === status) && (service === 'all' || item.type === service) && (!search || [item.guest, item.id, item.email, item.phone, item.location, item.type, item.occasion].some((value) => value.toLocaleLowerCase().includes(search))))
      .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.guest.localeCompare(b.guest))
  }, [scopedBookings, query, status, service])
  const close = () => { setDialog(null); setSelectedId(null); setErrors({}) }
  const confirm = async () => {
    if (!booking || !['requested', 'held'].includes(booking.status)) return
    const conflict = dateConflict(state, booking.date, today, booking.id, booking.nightId, booking.time)
    if (conflict) { setErrors({ action: conflict }); return }
    const saved = await update(`Confirmed ${booking.id} for ${booking.guest}`, (next) => {
      const item = next.bookings.find((entry) => entry.id === booking.id)
      if (item && (item.status === 'requested' || item.status === 'held')) item.status = 'confirmed'
    })
    if (!saved) return
    setErrors({}); notify(`Booking confirmed for ${booking.guest}.`)
  }
  const saveNotes = async () => {
    if (!booking) return
    const saved = await update(`Updated internal notes for ${booking.id}`, (next) => {
      const item = next.bookings.find((entry) => entry.id === booking.id)
      if (item) item.notes = notes
    })
    if (!saved) return
    notify('Internal notes saved.')
  }
  const saveQuote = async (event:FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!booking || !canEditQuote) { setErrors({action:'This quote is locked because the booking or billing record has changed. Existing financial records are retained.'}); return }
    const fields = new FormData(event.currentTarget)
    const submitted={total:String(fields.get('total') || ''),deposit:String(fields.get('deposit') || '')}
    setQuote(submitted)
    const total=Number(submitted.total || 0),deposit=Number(submitted.deposit || 0)
    const nextErrors:Record<string,string>={}
    for (const [key,value] of [['total',total],['deposit',deposit]] as const) {
      if (!Number.isFinite(value) || value<0 || Math.abs(value*100-Math.round(value*100))>.000001) nextErrors[key]='Enter an amount of zero or more, with no more than two decimal places.'
    }
    if (deposit>total) nextErrors.deposit='The deposit cannot exceed the quoted total.'
    if (Object.keys(nextErrors).length) { setErrors(nextErrors); return }
    const saved=await update(`Updated draft quote for ${booking.id}`,next=>{
      const item=next.bookings.find(item=>item.id===booking.id)
      if(item){item.total=total;item.deposit=deposit}
    })
    if(!saved)return
    setErrors({});setDialog('detail');notify('Draft quote saved. No payment was recorded or requested.')
  }
  const reschedule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!booking) return
    if (booking.status === 'cancelled') { setErrors({date:'This booking has been cancelled and cannot be rescheduled.'}); return }
    const fields = new FormData(event.currentTarget)
    const submitted = { date: String(fields.get('date') ?? ''), time: String(fields.get('time') ?? '') }
    setSchedule(submitted)
    const nextErrors: Record<string, string> = {}
    const conflict = dateConflict(state, submitted.date, today, booking.id, undefined, submitted.time)
    if (conflict) nextErrors.date = conflict
    if (!validTime(submitted.time)) nextErrors.time = 'Choose a valid event time.'
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors)
      document.getElementById(nextErrors.date ? 'booking-reschedule-date' : 'booking-reschedule-time')?.focus()
      return
    }
    if (submitted.date === booking.date && submitted.time === booking.time) {
      setErrors({}); setDialog('detail'); notify('Date and time are unchanged.'); return
    }
    const saved = await update(`Rescheduled ${booking.id} to ${dateLabel(submitted.date)} at ${timeLabel(submitted.time)}`, (next) => {
      const item = next.bookings.find((entry) => entry.id === booking.id)
      if (item && item.status !== 'cancelled') { item.date = submitted.date; item.time = submitted.time }
    })
    if (!saved) return
    setErrors({}); setDialog('detail'); notify('Booking rescheduled. Contact the guest to agree the change.')
  }
  const cancel = async () => {
    if (!booking) return
    if (booking.planning) {
      if (!cancellationReason.trim()) { setErrors({action:'Record why this booking is being cancelled.'}); return }
      const saved = await planningAction({action:'cancel',bookingId:booking.id,reason:cancellationReason.trim()})
      if (saved) { setDialog('detail'); setErrors({}); notify('Cancellation recorded. Review its refund status in the interview brief.') }
      return
    }
    const saved = await update(`Cancelled ${booking.id} for ${booking.guest}`, (next) => {
      const item = next.bookings.find((entry) => entry.id === booking.id)
      if (item) item.status = 'cancelled'
    })
    if (!saved) return
    setDialog('detail'); setErrors({}); notify('Booking cancelled. No refund or guest notification was sent.')
  }
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const fields = Object.fromEntries([...new FormData(event.currentTarget)].filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    const submitted: Draft = { ...draft, ...fields }
    setDraft(submitted)
    const nextErrors: Record<string, string> = {}
    if (submitted.type === 'Sergio’s Table') nextErrors.type = 'Add table seats from Sergio’s Table, then Manage guests.'
    if (submitted.guest.trim().length < 2) nextErrors.guest = 'Enter the guest’s name.'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(submitted.email.trim())) nextErrors.email = 'Enter a valid email address.'
    if (submitted.phone.replace(/\D/g, '').length < 7) nextErrors.phone = 'Enter a contact phone number.'
    const conflict = dateConflict(state, submitted.date, today)
    if (conflict) nextErrors.date = conflict
    if (!validTime(submitted.time)) nextErrors.time = 'Choose a valid event time.'
    const guests = Number(submitted.guests), total = Number(submitted.total || 0), deposit = Number(submitted.deposit || 0)
    if (!Number.isSafeInteger(guests) || guests < 1) nextErrors.guests = 'Enter a whole number of guests, at least 1.'
    if (!submitted.location.trim()) nextErrors.location = 'Add the venue or area for this event.'
    for (const [key, value] of [['total', total], ['deposit', deposit]] as const) {
      if (!Number.isFinite(value) || value < 0) nextErrors[key] = 'Enter an amount of zero or more.'
      else if (Math.abs(value * 100 - Math.round(value * 100)) > .000001) nextErrors[key] = 'Use no more than two decimal places.'
    }
    if (deposit > total) nextErrors.deposit = 'The deposit cannot exceed the quoted total.'
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors)
      if (nextErrors.total || nextErrors.deposit) setShowPayments(true)
      requestAnimationFrame(() => document.getElementById(`booking-new-${Object.keys(nextErrors)[0]}`)?.focus())
      return
    }
    const guest = submitted.guest.trim()
    const newId='SC-'+crypto.randomUUID()
    const saved = await update(`Added a ${submitted.type.toLocaleLowerCase()} booking for ${guest}`, (next) => {
      if(next.bookings.some(item=>item.id===newId))return
      next.bookings.push({ id: newId, guest, email: submitted.email.trim(), phone: submitted.phone.trim(), type: submitted.type, date: submitted.date, time: submitted.time, guests, status: submitted.status,
        location: submitted.location.trim(), occasion: submitted.occasion.trim(), dietary: submitted.dietary.trim(), notes: submitted.notes, total, deposit, paid: 0, created: new Date().toISOString() })
    })
    if (!saved) return
    setScope('all');setStatus('all');setService('all');setQuery('');setSelectedId(newId);setNotes(submitted.notes);setSchedule({date:submitted.date,time:submitted.time});setDialog('detail');setErrors({});notify(`Booking added for ${guest}. Complete venue and dietary records next.`)
  }
  const changeDraft = <K extends keyof Draft>(key: K, value: Draft[K]) => { setDraft((current) => ({ ...current, [key]: value })); setErrors((current) => ({ ...current, [key]: '' })) }
  const changeSchedule = (key: 'date' | 'time', value: string) => { setSchedule((current) => ({ ...current, [key]: value })); setErrors((current) => ({ ...current, [key]: '' })) }
  const newField = (key: keyof Draft, label: string, type = 'text', extra: Record<string, string | number> = {}) => (
    <label className="field" htmlFor={`booking-new-${key}`}><span>{label}</span><input id={`booking-new-${key}`} name={key} type={type} value={draft[key]} onInput={(event) => changeDraft(key, event.currentTarget.value as Draft[typeof key])} onChange={(event) => changeDraft(key, event.currentTarget.value as Draft[typeof key])} aria-invalid={!!errors[key]} aria-describedby={errors[key] ? `booking-error-${key}` : undefined} {...extra} /><ErrorText id={`booking-error-${key}`} text={errors[key]} /></label>
  )

  return <section className={'bookings' + (embedded ? ' bookings-embedded' : '')} aria-labelledby={embedded ? undefined : 'bookings-title'} aria-label={embedded ? 'Bookings' : undefined}>
    <div className={embedded ? 'booking-embedded-toolbar' : 'booking-page-heading'}>{!embedded && <div><p className="eyebrow">Your guests, thoughtfully looked after</p><h1 id="bookings-title">Bookings</h1><p className="muted">Every request and every evening, in one place.</p></div>}
      <button className="button" onClick={() => { setDraft(blankDraft()); setShowPayments(false); setErrors({}); setSelectedId(null); setDialog('create') }}><Icon name="plus" size={18} />Add a booking</button></div>
    <div className="booking-status-tabs" aria-label="Filter by booking status">
      {statusOptions.map((tab) => <button key={tab.id} aria-pressed={status === tab.id} onClick={() => setStatus(tab.id)}>{scope === 'upcoming' && tab.id === 'all' ? 'All upcoming' : tab.label}<span>{tab.id === 'all' ? scopedBookings.length : scopedBookings.filter((item) => item.status === tab.id).length}</span></button>)}
    </div>
    <div className="panel booking-list-panel">
      <div className="booking-tools"><label className="booking-search"><Icon name="search" size={18} /><span className="booking-sr-only">Search bookings</span><input type="search" placeholder="Search guests, booking numbers or places" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <label className="booking-type-filter"><span className="booking-sr-only">Experience</span><select value={service} onChange={(event) => setService(event.target.value)}><option value="all">All experiences</option>{TYPES.map((type) => <option key={type}>{type}</option>)}</select></label></div>
      <div className={'booking-result-count' + (scope === 'upcoming' ? ' booking-upcoming-scope' : '')}><p aria-live="polite">{scope === 'upcoming' ? 'Upcoming bookings · ' : ''}{visible.length} {visible.length === 1 ? 'booking' : 'bookings'}{status !== 'all' || service !== 'all' || query ? ' match your filters' : ''}</p>{scope === 'upcoming' ? <button className="booking-show-all" onClick={() => { setScope('all'); setStatus('all'); setQuery(''); setService('all') }}>Show all bookings</button> : <span>Next dates first</span>}</div>
      {visible.length ? <><div className="booking-table-wrap"><table className="booking-table"><thead><tr><th scope="col">Guest</th><th scope="col">When</th><th scope="col">Experience</th><th scope="col">Guests</th><th scope="col">Status</th><th scope="col">Payment</th></tr></thead><tbody>
        {visible.map((item) => <tr key={item.id}><td><button className="booking-guest-link" onClick={() => openBooking(item)}><strong>{item.guest}</strong><span>{item.id}<Icon name="chevron" size={13} /></span></button></td><td><span className="booking-date">{item.date ? dateLabel(item.date, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Date to be agreed'}</span><span className="booking-cell-secondary">{item.time ? timeLabel(item.time) : item.planning?.original.dateMode === 'flexible' ? 'Flexible dates' : 'Discuss during interview'}</span></td><td>{item.type}</td><td>{item.guests > 0 ? item.guests : item.planning?.original.partyBandLabel || 'Undecided'}</td><td><BookingBadge booking={item} /></td><td><span className="booking-payment-label">{item.status === 'cancelled' ? `${currency(item.paid)} received` : paymentLabel(item)}</span><span className="booking-cell-secondary">{item.total ? `${currency(item.paid)} of ${currency(item.total)}` : 'No quote recorded'}</span></td></tr>)}
      </tbody></table></div><div className="booking-mobile-cards">{visible.map((item) => <button key={item.id} className="booking-mobile-card" onClick={() => openBooking(item)}><span className="booking-card-heading"><strong>{item.guest}</strong><Icon name="chevron" size={18} /></span><span className="booking-card-experience">{item.type} · {guestCountLabel(item)}</span><span className="booking-card-date"><Icon name="calendar" size={15} />{item.date ? dateLabel(item.date) : 'Date to be agreed'}{item.time ? ` · ${timeLabel(item.time)}` : ''}</span><span className="booking-card-foot"><BookingBadge booking={item} /><span>{item.status === 'cancelled' ? `${currency(item.paid)} received` : paymentLabel(item)}</span></span></button>)}</div></> : <div className="booking-empty"><Icon name="search" size={28} /><h2>{state.bookings.length ? 'No bookings found' : 'Your first booking starts here'}</h2><p className="muted">{state.bookings.length ? 'Try another guest name, experience or status.' : 'Add an arrangement made by phone, email or in person.'}</p><button className="button secondary" onClick={() => { setQuery(''); setStatus('all'); setService('all') }}>Clear filters</button></div>}
    </div>

    {booking && dialog && dialog !== 'create' && <Modal wide title={dialog === 'quote' ? 'Agreed quote' : dialog === 'reschedule' ? 'Find a new date' : dialog === 'cancel' ? 'Cancel this booking?' : booking.guest} subtitle={`${booking.id} · ${booking.type}`} onClose={close}>
      {dialog === 'detail' && <div className="booking-dialog-body">
        {booking.source==='public'&&<p className="booking-subtle-note">{booking.planning ? `Website booking brief · ${booking.planning.dateReserved ? 'Event date reserved.' : booking.date ? 'Proposed date; reservation and payment are tracked separately.' : 'Deposit and event date are tracked separately.'}` : `Website request${booking.nightId?' · Seats are reserved only when you confirm.':' · The date is not held until you confirm.'}`}</p>}
        <div className="booking-detail-top"><div><span className="booking-detail-date">{longDate(booking.date)}</span><span className="booking-cell-secondary">{booking.time ? `${timeLabel(booking.time)} · ` : ''}{guestCountLabel(booking)}</span></div><BookingBadge booking={booking} /></div>
        {errors.action && <p className="booking-action-error" role="alert">{errors.action}</p>}
        {booking.type !== 'Sergio’s Table' && <InterviewBrief booking={booking}/>}
        <div className="booking-detail-columns"><div className="booking-detail-main"><section className="booking-detail-section"><h3>Occasion</h3><p>{booking.occasion || 'Not specified'}</p></section><VenueDetails bookingId={booking.id}/>
          <DietaryDetails bookingId={booking.id}/>
          <section className="booking-detail-section"><div className="booking-notes-heading"><div><h3>Internal notes</h3><p className="muted">For you and your team.</p></div><button className="button secondary booking-save-note" disabled={pending || notes === booking.notes} onClick={saveNotes}>Save notes</button></div><label className="booking-sr-only" htmlFor="booking-internal-notes">Internal notes</label><textarea id="booking-internal-notes" rows={5} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Menu plans, arrival details, things to remember…" /></section>
        </div><aside className="booking-detail-aside"><section className="booking-detail-section"><h3>Guest contact</h3><a className="booking-contact-link" href={`mailto:${booking.email}`}>{booking.email}</a><span className="booking-contact-link">{booking.phone ? <a href={`tel:${booking.phone.replace(/[^+\d]/g, '')}`}>{booking.phone}</a> : 'No phone supplied'}</span></section>
          <BillingPanel bookingId={booking.id}/>
          <BookingCommunications bookingId={booking.id}/>
          {!booking.planning && <section className="booking-detail-section"><h3>Agreed quote</h3><p>{booking.total ? currency(booking.total) : 'Not agreed yet'} · Deposit requested {currency(booking.deposit)}</p><button className="button secondary" disabled={pending || !canEditQuote} onClick={()=>{setQuote({total:booking.total?String(booking.total):'',deposit:booking.deposit?String(booking.deposit):''});setErrors({});setDialog('quote')}}>{booking.total ? 'Edit quote' : 'Set quote'}</button>{!canEditQuote && <p className="booking-subtle-note">The quote is locked after cancellation or billing activity. Existing payment records stay intact.</p>}</section>}
        </aside></div>
        {booking.status !== 'cancelled' && <div className="booking-detail-actions"><div>{!booking.planning && (booking.status === 'requested' || booking.status === 'held') && <button className="button" disabled={pending} onClick={confirm}><Icon name="check" size={17} />Confirm booking</button>}<button className="button secondary" disabled={!!booking.nightId || !!booking.planning} title={booking.planning ? 'Use the interview brief to agree and reserve the event date.' : booking.nightId?'Table requests follow the published evening. Cancel and arrange another evening with the guest.':undefined} onClick={() => { setSchedule({ date: booking.date, time: booking.time }); setErrors({}); setDialog('reschedule') }}><Icon name="calendar" size={17} />Reschedule</button></div><button className="booking-cancel-link" onClick={() => setDialog('cancel')}>Cancel booking</button></div>}
      </div>}
      {dialog === 'quote' && <form className="booking-dialog-body" onSubmit={saveQuote} noValidate><p className="booking-dialog-intro">Record the total and deposit agreed with {booking.guest}. Leave the total blank or at zero while the quote is still being discussed.</p>{errors.action && <p className="booking-action-error" role="alert">{errors.action}</p>}<div className="booking-form-grid"><label className="field">Quoted total ($)<input name="total" type="number" min={0} step="0.01" value={quote.total} onChange={event=>{setQuote({...quote,total:event.target.value});setErrors({})}}/><ErrorText text={errors.total}/></label><label className="field">Deposit requested ($)<input name="deposit" type="number" min={0} step="0.01" value={quote.deposit} onChange={event=>{setQuote({...quote,deposit:event.target.value});setErrors({})}}/><ErrorText text={errors.deposit}/></label></div><p className="booking-subtle-note">This updates the draft billing record. It does not charge the guest, send a payment request, or record money received. The quote locks once a receipt or collection change is recorded.</p><div className="booking-form-actions"><button className="button secondary" type="button" onClick={()=>setDialog('detail')}>Back to booking</button><button className="button" type="submit" disabled={pending || !canEditQuote}>{pending?'Saving…':'Save quote'}</button></div></form>}
      {dialog === 'reschedule' && <form className="booking-dialog-body" onSubmit={reschedule} noValidate><p className="booking-dialog-intro">Choose a new date and time for {booking.guest}. Booked dates and blocked days are unavailable.</p><div className="booking-form-grid"><label className="field" htmlFor="booking-reschedule-date"><span>New date</span><input id="booking-reschedule-date" name="date" type="date" min={today} required value={schedule.date} onInput={(event) => changeSchedule('date', event.currentTarget.value)} onChange={(event) => changeSchedule('date', event.currentTarget.value)} aria-invalid={!!errors.date} /><ErrorText text={errors.date} /></label><label className="field" htmlFor="booking-reschedule-time"><span>Time</span><input id="booking-reschedule-time" name="time" type="time" required value={schedule.time} onInput={(event) => changeSchedule('time', event.currentTarget.value)} onChange={(event) => changeSchedule('time', event.currentTarget.value)} aria-invalid={!!errors.time} /><ErrorText text={errors.time} /></label></div><p className="booking-subtle-note">Payment history stays unchanged. Any scheduled auto-debit is paused for review. Contact the guest to agree the new arrangements.</p><div className="booking-form-actions"><button type="button" className="button secondary" onClick={() => { setErrors({}); setDialog('detail') }}>Back to booking</button><button className="button" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save new date'}</button></div></form>}
      {dialog === 'cancel' && <div className="booking-dialog-body"><p className="booking-dialog-intro">Cancel {booking.guest}’s {booking.type.toLocaleLowerCase()}{booking.date && <> on <strong>{dateLabel(booking.date)}</strong>{booking.time ? ` at ${timeLabel(booking.time)}` : ''}</>}?</p><div className="booking-cancel-summary"><Icon name="info" size={20} /><p>{booking.planning ? booking.planning.interview.sentAt ? 'The menu-interview invitation was sent. Sergio can refund the deposit fully or retain the planning fee disclosed at payment. Review the refund decision after cancellation.' : 'This cancellation precedes the sent menu-interview invitation. Any paid deposit is fully refundable; payment-provider confirmation determines when the refund is complete.' : `${currency(booking.paid)} remains recorded as received. Scheduled collection will be paused, and any received payment will be flagged for refund review. No guest email or refund is sent automatically.`}</p></div>{booking.planning && <label className="field">Cancellation reason<textarea rows={3} value={cancellationReason} maxLength={1000} onChange={event=>setCancellationReason(event.target.value)}/></label>}{errors.action && <p className="booking-action-error" role="alert">{errors.action}</p>}<div className="booking-form-actions"><button className="button secondary" onClick={() => setDialog('detail')}>Keep booking</button><button className="button danger" disabled={pending} onClick={cancel}>Confirm cancellation</button></div></div>}
    </Modal>}

    {dialog === 'create' && <Modal wide title="Add a booking" subtitle="For an arrangement made by phone, email or in person." onClose={close}><form className="booking-dialog-body" onSubmit={create} noValidate>
      {Object.values(errors).some(Boolean) && <p className="booking-action-error" role="alert">Check the highlighted fields before saving this booking.</p>}
      <div className="booking-form-grid">{newField('guest', 'Guest name', 'text', { autoComplete: 'name' })}{newField('email', 'Email address', 'email', { autoComplete: 'email' })}{newField('phone', 'Phone number', 'tel', { autoComplete: 'tel' })}<label className="field"><span>Experience</span><select name="type" value={draft.type} onChange={(event) => changeDraft('type', event.target.value as Booking['type'])}>{TYPES.filter(type => type !== 'Sergio’s Table').map((type) => <option key={type}>{type}</option>)}</select><small>Add table seats from Sergio’s Table, then Manage guests.</small><ErrorText text={errors.type}/></label>{newField('date', 'Event date', 'date', { min: today })}{newField('time', 'Time', 'time')}{newField('guests', 'Number of guests', 'number', { min: 1, step: 1 })}<label className="field"><span>Booking status</span><select name="status" value={draft.status} onChange={(event) => changeDraft('status', event.target.value as Draft['status'])}><option value="requested">New request</option><option value="held">Date held</option><option value="confirmed">Confirmed</option></select></label><div className="booking-form-full">{newField('location', 'City or area')}{newField('occasion', 'Occasion (optional)')}</div><label className="field booking-form-full"><span>Original guest message about food (optional)</span><textarea name="dietary" rows={2} value={draft.dietary} onChange={(event) => changeDraft('dietary', event.target.value)} /></label></div>
      <details className="booking-extra-fields" open={showPayments} onToggle={(event) => setShowPayments(event.currentTarget.open)}><summary>Quote and payments <span className="muted">Optional</span><Icon name="down" size={16} /></summary><p className="muted">Leave these blank if a quote is still to be agreed. Card payments are not connected. Record any money already received as a separate offline receipt after saving the booking.</p><div className="booking-money-grid">{newField('total', 'Quoted total ($)', 'number', { min: 0, step: '.01' })}{newField('deposit', 'Deposit requested ($)', 'number', { min: 0, step: '.01' })}</div></details>
      <label className="field booking-create-notes"><span>Internal notes (optional)</span><textarea name="notes" rows={3} value={draft.notes} onChange={(event) => changeDraft('notes', event.target.value)} /></label><div className="booking-form-actions"><button className="button secondary" type="button" onClick={close}>Discard</button><button className="button" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save booking'}</button></div>
    </form></Modal>}
  </section>
}
