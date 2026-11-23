import { FormEvent, useState } from 'react'
import { Night, dateLabel, money, timeLabel } from './model'
import { useAdmin } from './store'
import { Badge, Icon, Modal } from './ui'
import './Calendar.css'
import TableQuorum from './TableQuorum'
import BookingSettings from './BookingSettings'
import {quorumFor} from './operations'
import { calendarClosedReason, MINIMUM_NOTICE_DAYS, occupiesDate, scheduleConflictReason } from './calendar-policy'

const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const isoDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const longDate = (date: string) => dateLabel(date, { weekday: 'long', month: 'long', day: 'numeric' })
const newNight = (today:string): Night => ({ id: crypto.randomUUID(), title: '', date: today, time: '19:00', seats: 10, booked: 0, minimum: 6, price: 0, cutoff: 72, menu: '', status: 'draft' })

export default function Calendar({initialTab='calendar',embedded=false}:{initialTab?:'calendar'|'nights';embedded?:boolean}) {
  const { state, update, notify, businessDate: today, pending, capabilities } = useAdmin()
  const [tab, setTab] = useState<'calendar' | 'nights'>(initialTab)
  const [month, setMonth] = useState(new Date(today + 'T12:00:00'))
  const [selected, setSelected] = useState(today)
  const [blockModal, setBlockModal] = useState(false)
  const [blockDate, setBlockDate] = useState(today)
  const [blockReason, setBlockReason] = useState('')
  const [hoursModal, setHoursModal] = useState(false)
  const [bookingSetup, setBookingSetup] = useState(false)
  const [hours, setHours] = useState(state.availability)
  const [nightForm, setNightForm] = useState<Night | null>(null)
  const [publishTarget, setPublishTarget] = useState<Night | null>(null)
  const [unpublishTarget, setUnpublishTarget] = useState<Night | null>(null)
  const [error, setError] = useState('')

  const bookingsOn = (date: string) => state.bookings.filter(b => b.date === date && b.status !== 'cancelled')
  const nightsOn = (date: string) => state.nights.filter(n => n.date === date && n.status === 'published')
  const selectedBookings = bookingsOn(selected)
  const selectedNights = nightsOn(selected)
  const selectedBlock = state.blocks.find(b => b.date === selected)
  const selectedPast = selected < today
  const first = new Date(month.getFullYear(), month.getMonth(), 1, 12)
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0, 12)
  const offset = (first.getDay() + 6) % 7
  const cells = Math.ceil((offset + last.getDate()) / 7) * 7
  const selectedWeekday = new Date(selected + 'T12:00:00').getDay()
  const selectedClosure = calendarClosedReason(selected)
  const availableDay = !selectedClosure && state.availability.days.includes(selectedWeekday)
  const changeMonth = (delta: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + delta, 1, 12))

  function openBlock(date = selected) {
    setError(''); setBlockDate(date < today ? today : date); setBlockReason(''); setBlockModal(true)
  }
  async function saveBlock(e: FormEvent) {
    e.preventDefault()
    if (blockDate < today) { setError('Choose today or a future date.'); return }
    if (bookingsOn(blockDate).some(occupiesDate) || nightsOn(blockDate).length) { setError('This date has an active booking or scheduled table night. Resolve it before blocking the day.'); return }
    if (state.blocks.some(b => b.date === blockDate)) { setError('This date is already blocked.'); return }
    const saved = await update(`Blocked ${dateLabel(blockDate)}: ${blockReason.trim() || 'Unavailable'}`, draft => { draft.blocks.push({ id: crypto.randomUUID(), date: blockDate, reason: blockReason.trim() || 'Unavailable' }) })
    if (!saved) return
    setSelected(blockDate); setMonth(new Date(blockDate + 'T12:00:00')); setBlockModal(false); notify(capabilities.publicBooking?'Date blocked. The public booking calendar is updated.':'Date blocked in your calendar.')
  }
  async function unblock() {
    const saved = await update(`Reopened ${dateLabel(selected)}`, draft => { draft.blocks = draft.blocks.filter(b => b.date !== selected) })
    if (!saved) return
    notify(selectedClosure ? `The manual block is removed. This date remains closed for ${selectedClosure}.` : 'Date reopened. Your usual working hours still apply.')
  }
  async function saveHours(e: FormEvent) {
    e.preventDefault()
    if (hours.end < hours.start) { setError('The latest start time must be at or after the first start time.'); return }
    if (!Number.isInteger(hours.leadDays) || hours.leadDays < MINIMUM_NOTICE_DAYS || hours.leadDays > 90) { setError('Lead time must be a whole number from 7 to 90 days.'); return }
    const saved = await update('Updated working hours and booking lead time', draft => { draft.availability = { ...hours, days: [...hours.days].sort() } })
    if (!saved) return
    setHoursModal(false); notify('Working hours saved. Existing bookings stay as arranged.')
  }
  function nightError(night: Night, publish = false) {
    const original = state.nights.find(n => n.id === night.id)
    if (original?.status === 'cancelled') return 'This evening has been cancelled and cannot be edited or reopened.'
    if (!night.title.trim() || !night.menu.trim()) return 'Give the evening a name and add its menu.'
    if (!night.date || night.date < today) return 'Choose today or a future date.'
    if (!night.time) return 'Choose a start time.'
    if (!Number.isInteger(night.seats) || night.seats < 2 || night.seats > 24) return 'Seat capacity must be a whole number from 2 to 24.'
    const reserved = original?.booked ?? 0
    if (night.seats < reserved) return `There are already ${reserved} reserved seats. Capacity cannot be lower than that.`
    if (!Number.isInteger(night.minimum) || night.minimum < 1 || night.minimum > night.seats) return 'The minimum must be between 1 and your seat capacity.'
    if (!Number.isFinite(night.price) || night.price < 1 || night.price > 1000) return 'Enter a seat price between $1 and $1,000.'
    if (!Number.isInteger(night.cutoff) || night.cutoff < 1 || night.cutoff > 720) return 'The cutoff must be a whole number from 1 to 720 hours.'
    if (original?.booked && (original.date !== night.date || original.time !== night.time)) return 'This evening already has guests. Its date and time must stay as booked.'
    if (publish || night.status === 'published') {
      const unchangedSchedule = original?.status === 'published' && original.date === night.date && original.time === night.time
      const closure = calendarClosedReason(night.date)
      if (closure && !unchangedSchedule) return `This date is closed for ${closure}. Choose another date before scheduling the evening.`
      const conflict = scheduleConflictReason(state, night.date, { nightId: night.id })
      if (conflict) return conflict
    }
    return ''
  }
  async function saveNight(e: FormEvent) {
    e.preventDefault(); if (!nightForm) return
    const problem = nightError(nightForm)
    if (problem) { setError(problem); return }
    const existed = state.nights.some(n => n.id === nightForm.id)
    const saved = await update(`${existed ? 'Updated' : 'Created draft'} table night: ${nightForm.title.trim()}`, draft => {
      const clean = { ...nightForm, booked: draft.nights.find(n => n.id === nightForm.id)?.booked ?? 0, title: nightForm.title.trim(), menu: nightForm.menu.trim() }
      const index = draft.nights.findIndex(n => n.id === clean.id)
      if (index === -1) draft.nights.push(clean); else draft.nights[index] = clean
    })
    if (!saved) return
    setNightForm(null); notify(nightForm.status === 'published' ? 'Scheduled evening updated.' : 'Evening saved as a draft. Schedule it when you are ready.')
  }
  async function publishNight() {
    if (!publishTarget) return
    const latest = state.nights.find(n => n.id === publishTarget.id)
    if (!latest || latest.status === 'cancelled') { setError('This evening is no longer available to schedule.'); return }
    if (JSON.stringify(latest) !== JSON.stringify(publishTarget)) { setPublishTarget({...latest}); setError('This evening changed in another session. Review the updated details before scheduling.'); return }
    const problem = nightError(publishTarget, true)
    if (problem) { setError(problem); return }
    const saved = await update(`Scheduled table night: ${publishTarget.title}`, draft => { const night = draft.nights.find(n => n.id === publishTarget.id); if (night) night.status = 'published' })
    if (!saved) return
    setPublishTarget(null); notify('Evening published for public requests. No guest message or card charge was sent.')
  }

  async function returnToDraft() {
    if (!unpublishTarget) return
    const latest = state.nights.find(n => n.id === unpublishTarget.id)
    if (!latest || latest.status !== 'published' || latest.booked > 0) { setError('This evening has changed. Only a scheduled evening with no reservations can return to drafts.'); return }
    const saved = await update(`Returned table night to draft: ${latest.title}`, draft => { const night = draft.nights.find(n => n.id === latest.id); if (night) night.status = 'draft' })
    if (!saved) return
    setUnpublishTarget(null); notify('Evening returned to drafts.')
  }
  return <div className={"calendar-page"+(embedded?" embedded":"")}>
    <div className="page-heading cal-heading"><div><p className="eyebrow">MAKE ROOM FOR WHAT MATTERS</p><h1>Your calendar</h1><p className="muted">A little planning. More time around the table.</p></div><div className="cal-heading-actions"><button className="button secondary" onClick={() => setBookingSetup(true)}><Icon name="book" size={17}/>Booking setup</button>{(!embedded||tab==='calendar')&&<button className="button secondary" onClick={() => { setHours({ ...state.availability, leadDays: Math.max(MINIMUM_NOTICE_DAYS, state.availability.leadDays), days: state.availability.days.filter(day => day !== 0) }); setError(''); setHoursModal(true) }}><Icon name="clock" size={17}/>Working hours</button>}<button className="button" onClick={() => tab === 'calendar' ? openBlock() : (setError(''), setNightForm(newNight(today)))}><Icon name="plus" size={18}/>{tab === 'calendar' ? 'Block a date' : 'Create an evening'}</button></div></div>
    <div className="cal-tabs" role="tablist" aria-label="Calendar views" onKeyDown={e => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return; e.preventDefault(); const next = e.key === 'Home' ? 'calendar' : e.key === 'End' ? 'nights' : tab === 'calendar' ? 'nights' : 'calendar'; setTab(next); document.getElementById(next === 'calendar' ? 'calendar-tab' : 'nights-tab')?.focus() }}><button id="calendar-tab" role="tab" tabIndex={tab === 'calendar' ? 0 : -1} aria-selected={tab === 'calendar'} aria-controls="calendar-panel" className={tab === 'calendar' ? 'active' : ''} onClick={() => setTab('calendar')}>Availability</button><button id="nights-tab" role="tab" tabIndex={tab === 'nights' ? 0 : -1} aria-selected={tab === 'nights'} aria-controls="nights-panel" className={tab === 'nights' ? 'active' : ''} onClick={() => setTab('nights')}>Sergio’s Table <span>{state.nights.filter(n => n.status !== 'cancelled').length}</span></button></div>

    {bookingSetup && <Modal wide title="Online booking setup" subtitle="Deposits, interview arrangements and guest expectations" onClose={() => setBookingSetup(false)}><BookingSettings onClose={() => setBookingSetup(false)}/></Modal>}
    {tab === 'calendar' ? <div id="calendar-panel" role="tabpanel" aria-labelledby="calendar-tab" className="cal-layout"><section className="panel cal-month"><div className="cal-month-heading"><h2>{month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h2><div className="cal-month-controls"><button className="cal-today" onClick={() => { setMonth(new Date(today + 'T12:00:00')); setSelected(today) }}>Today</button><button className="icon-button cal-prev" aria-label="Previous month" onClick={() => changeMonth(-1)}><Icon name="chevron" size={18}/></button><button className="icon-button" aria-label="Next month" onClick={() => changeMonth(1)}><Icon name="chevron" size={18}/></button></div></div><div className="cal-weekdays">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => <span key={day}>{day}</span>)}</div><div className="cal-grid">{Array.from({ length: cells }, (_, index) => {
      const date = new Date(month.getFullYear(), month.getMonth(), index - offset + 1, 12)
      const iso = isoDate(date); const inMonth = date.getMonth() === month.getMonth(); const entries = bookingsOn(iso); const nights = nightsOn(iso); const blocked = state.blocks.some(b => b.date === iso); const closure = calendarClosedReason(iso); const working = !closure && state.availability.days.includes(date.getDay()); const past = iso < today
      return <button key={iso} className={['cal-day', !inMonth && 'outside', iso === selected && 'selected', iso === today && 'today', (blocked || closure) && 'blocked', !working && !entries.length && !nights.length && 'off-day', past && 'past'].filter(Boolean).join(' ')} aria-label={`${longDate(iso)}${entries.length ? `, ${entries.length} booking${entries.length > 1 ? 's' : ''}` : ''}${nights.length ? ', table night' : ''}${blocked ? ', blocked' : ''}${closure ? `, closed for ${closure}` : ''}${!working && !closure && !entries.length && !nights.length ? ', day off' : ''}`} aria-pressed={iso === selected} onClick={() => { setSelected(iso); if (!inMonth) setMonth(date) }}><span className="cal-day-number">{date.getDate()}</span><span className="cal-events">{entries.slice(0, 2).map(b => <span key={b.id} className={'cal-event ' + b.status}><span className="cal-event-dot"/>{b.guest === 'The Rivera family' ? 'Rivera family' : b.guest.split(' ')[0]}<span className="cal-event-time">{timeLabel(b.time)}</span></span>)}{nights.map(n => <span key={n.id} className="cal-event table"><Icon name="cutlery" size={12}/><span>Table night</span></span>)}{(blocked || closure) && <span className="cal-block-label"><Icon name="lock" size={12}/><span>{closure || 'Blocked'}</span></span>}</span></button>
    })}</div><div className="cal-legend"><span><i className="confirmed"/>Confirmed</span><span><i className="held"/>Date held</span><span><i className="requested"/>Request</span><span><i className="table"/>Table night</span><span className="cal-legend-block"><Icon name="lock" size={12}/>Blocked</span></div></section>
    <aside className="cal-day-panel"><div className="panel cal-day-details"><p className="eyebrow">{selected === today ? 'TODAY' : 'THE DAY AT A GLANCE'}</p><h2>{dateLabel(selected, { weekday: 'long' })}<span>{dateLabel(selected, { month: 'long', day: 'numeric' })}</span></h2>{selectedBlock ? <div className="cal-block-detail"><span className="cal-detail-symbol"><Icon name="lock" size={22}/></span><h3>Time for yourself</h3><p>{selectedBlock.reason}</p><button className="button secondary" disabled={pending} onClick={unblock}>{selectedClosure ? 'Remove this block' : 'Reopen this date'}</button></div> : selectedBookings.length || selectedNights.length ? <div className="cal-agenda">{selectedClosure && <p className="cal-small-note">Closed for {selectedClosure}. Existing records remain as arranged.</p>}{selectedBookings.map(b => <article key={b.id}><div className="cal-agenda-time"><Icon name="clock" size={14}/>{timeLabel(b.time)}</div><h3>{b.guest}</h3><p>{b.type} · {b.guests} guests</p><p className="cal-agenda-place"><Icon name="pin" size={13}/>{b.location}</p><Badge status={b.status}/></article>)}{selectedNights.map(n => <article key={n.id}><div className="cal-agenda-time"><Icon name="clock" size={14}/>{timeLabel(n.time)}</div><h3>{n.title}</h3><p>Sergio’s Table · {n.booked} of {n.seats} seats reserved</p><Badge status="published">Scheduled</Badge></article>)}<p className="cal-small-note">Dates with active bookings are protected from being blocked.</p></div> : <div className="cal-open-detail"><span className="cal-detail-symbol"><Icon name={availableDay ? 'sun' : 'cutlery'} size={25}/></span><h3>{selectedClosure ? `Closed for ${selectedClosure}` : selectedPast ? 'Nothing scheduled' : availableDay ? 'Room at the table' : 'A day off'}</h3><p>{selectedClosure ? 'No new events can be scheduled on this date. Sundays and the six agreed major holidays are closed.' : selectedPast ? 'There are no events on this date.' : availableDay ? `Guests can request a start from ${timeLabel(state.availability.start)} through ${timeLabel(state.availability.end)}, every half hour. One event keeps the entire day unavailable.` : state.availability.days.length ? 'This day is outside your usual working week.' : 'No working days are selected. Online availability stays closed until you save your working days.'}</p>{!selectedPast && !selectedClosure && <button className="button secondary" onClick={() => openBlock(selected)}><Icon name="lock" size={15}/>Block this date</button>}</div>}</div><div className="cal-hours-summary"><Icon name="clock" size={18}/><div><strong>{state.availability.days.filter(day => day !== 0).map(day => weekdays[day]).join(', ') || 'Online availability is closed'}</strong><p>{state.availability.days.length ? `${timeLabel(state.availability.start)}–${timeLabel(state.availability.end)} start times · ${Math.max(MINIMUM_NOTICE_DAYS, state.availability.leadDays)} days’ minimum notice` : 'Choose working days to open guest requests.'}<br/>Two weeks’ notice is preferred. Sundays and major holidays are closed.</p></div></div></aside></div> : <section id="nights-panel" role="tabpanel" aria-labelledby="nights-tab" className="cal-nights"><div className="cal-nights-intro"><div><p className="eyebrow">GOOD COMPANY, ONE TABLE</p><h2>Evenings worth gathering for.</h2><p>Plan the menu, open the seats, and welcome your guests.</p></div><div className="cal-nights-stats"><strong>{state.nights.filter(n => n.status === 'published').length}</strong><span>scheduled<br/>evening{state.nights.filter(n => n.status === 'published').length === 1 ? '' : 's'}</span></div></div><div className="cal-nights-grid">{state.nights.slice().sort((a, b) => a.date.localeCompare(b.date)).map(n => <article className="panel cal-night-card" key={n.id}><div className="cal-night-top"><span className="cal-night-date"><strong>{dateLabel(n.date, { day: 'numeric' })}</strong><span>{dateLabel(n.date, { month: 'short' })}</span></span><Badge status={n.status}>{n.status === 'published' ? 'Scheduled' : undefined}</Badge></div><p className="cal-night-day">{dateLabel(n.date, { weekday: 'long' })} · {timeLabel(n.time)}</p><h2>{n.title}</h2><ul className="cal-night-menu">{n.menu.split('\n').filter(Boolean).map((line, i) => <li key={i}>{line}</li>)}</ul><div className="cal-night-price"><strong>{money(n.price)}</strong><span>per guest</span></div><div className="cal-seat-row"><span><strong>{n.booked}</strong> of {n.seats} seats reserved</span><span>{quorumFor(n,state.operations.sessions[n.id]).state==='continuing_below'?'Continuing by decision':quorumFor(n,state.operations.sessions[n.id]).state==='at_risk'?'Quorum at risk':quorumFor(n,state.operations.sessions[n.id]).state==='below'?'Below quorum':n.status==='cancelled'?'Cancelled':n.booked >= n.minimum ? 'Minimum reached' : `${n.minimum-n.booked} more to reach minimum`}</span></div><div className="cal-seat-track" role="progressbar" aria-label={`Reserved seats for ${n.title}`} aria-valuenow={n.booked} aria-valuemin={0} aria-valuemax={n.seats}><span style={{ width: `${n.booked / n.seats * 100}%` }}/></div><TableQuorum nightId={n.id}/><div className="cal-night-footer"><button className="button secondary" disabled={n.status==='cancelled'} onClick={() => { setError(''); setNightForm({ ...n }) }}><Icon name="edit" size={15}/>Edit evening</button>{n.status === 'draft' ? <button className="button" onClick={() => { setError(''); setPublishTarget(n) }}>Schedule</button> : n.status==='cancelled'?<span className="cal-live-note">Records retained</span>: n.booked === 0 ? <button className="cal-text-button" onClick={() => {setError('');setUnpublishTarget(n)}}>Return to draft</button> : <span className="cal-live-note"><Icon name="check" size={14}/>Guests reserved</span>}</div></article>)}<button className="cal-create-card" onClick={() => { setError(''); setNightForm(newNight(today)) }}><span><Icon name="plus" size={27}/></span><h3>Set another place.</h3><p>Create your next evening<br/>around Sergio’s table.</p></button></div><p className="cal-prototype-note"><Icon name="info" size={16}/>Scheduled evenings appear on the public booking page. Guest requests arrive here for your approval. Card payments and automatic guest messages are not connected.</p></section>}

    {blockModal && <Modal title="A little room in your calendar." subtitle="Keep this date unavailable in your business calendar." onClose={() => setBlockModal(false)}><form onSubmit={saveBlock} className="cal-form"><label className="field">Date<input type="date" value={blockDate} min={today} onInput={e => { setBlockDate(e.currentTarget.value); setError('') }} required/></label><label className="field">A note for yourself<input value={blockReason} onChange={e => setBlockReason(e.target.value)} placeholder="Family time, travel, a well-earned rest…" maxLength={120}/></label>{error && <p className="cal-error" role="alert">{error}</p>}<div className="cal-form-footer"><button type="button" className="button secondary" onClick={() => setBlockModal(false)}>Keep available</button><button type="submit" className="button" disabled={pending}>Block date</button></div></form></Modal>}
    {hoursModal && <Modal title="Your rhythm of the week." subtitle="Your saved working days and start times control guest requests. One event uses the whole day. Leave all days off to close online availability." onClose={() => setHoursModal(false)}><form onSubmit={saveHours} className="cal-form"><fieldset className="cal-days-field"><legend>Working days</legend><div>{weekdays.map((name, day) => <button type="button" key={day} disabled={day === 0} title={day === 0 ? 'Sundays are closed' : undefined} aria-pressed={day !== 0 && hours.days.includes(day)} className={day !== 0 && hours.days.includes(day) ? 'chosen' : ''} onClick={() => { setError(''); setHours({ ...hours, days: hours.days.includes(day) ? hours.days.filter(d => d !== day) : [...hours.days, day] }) }}>{name}</button>)}</div></fieldset><div className="cal-form-two"><label className="field">First start time<input type="time" step={1800} value={hours.start} onInput={e => setHours({ ...hours, start: e.currentTarget.value })} required/></label><label className="field">Latest start time<input type="time" step={1800} value={hours.end} onInput={e => setHours({ ...hours, end: e.currentTarget.value })} required/></label></div><label className="field">Minimum notice (days)<input type="number" min={MINIMUM_NOTICE_DAYS} max="90" step="1" value={hours.leadDays} onChange={e => setHours({ ...hours, leadDays: Number(e.target.value) })} required/><small>At least seven days. Two weeks’ notice is preferred. Latest start time is included.</small></label><p className="cal-small-note">Closed on Sundays, New Year’s Day, Memorial Day, July 4, Labor Day, Thanksgiving Day and Christmas Day. Holiday closures use the actual dates, without substitute observed days.</p>{error && <p className="cal-error" role="alert">{error}</p>}<div className="cal-form-footer"><button type="button" className="button secondary" onClick={() => setHoursModal(false)}>Cancel</button><button type="submit" className="button" disabled={pending}>Save working hours</button></div></form></Modal>}
    {nightForm && <Modal title={state.nights.some(n => n.id === nightForm.id) ? 'Make the evening your own.' : 'An evening around your table.'} subtitle={nightForm.status === 'published' ? 'Changes update your scheduled evening.' : 'Save a draft first. Schedule it when the details feel right.'} onClose={() => setNightForm(null)} wide><form onSubmit={saveNight} className="cal-form"><label className="field">Name of the evening<input value={nightForm.title} onChange={e => setNightForm({ ...nightForm, title: e.target.value })} placeholder="An evening in Valencia" maxLength={90} required/></label><div className="cal-form-two"><label className="field">Date<input type="date" min={today} value={nightForm.date} disabled={nightForm.booked > 0} onInput={e => setNightForm({ ...nightForm, date: e.currentTarget.value })} required/></label><label className="field">Guests arrive at<input type="time" value={nightForm.time} disabled={nightForm.booked > 0} onInput={e => setNightForm({ ...nightForm, time: e.currentTarget.value })} required/></label></div>{nightForm.booked > 0 && <p className="cal-small-note">{nightForm.booked} guests have reserved. The date and time stay as booked; price edits apply to future reservations.</p>}<div className="cal-form-three"><label className="field">Seats<input type="number" min={Math.max(2, nightForm.booked)} max="24" step="1" value={nightForm.seats} onChange={e => setNightForm({ ...nightForm, seats: Number(e.target.value) })} required/></label><label className="field">Minimum guests<input type="number" min="1" max={nightForm.seats} step="1" value={nightForm.minimum} onChange={e => setNightForm({ ...nightForm, minimum: Number(e.target.value) })} required/></label><label className="field">Price per guest ($)<input type="number" min="1" max="1000" step="0.01" value={nightForm.price || ''} onChange={e => setNightForm({ ...nightForm, price: Number(e.target.value) })} required/></label></div><label className="field">The menu<textarea rows={4} value={nightForm.menu} onChange={e => setNightForm({ ...nightForm, menu: e.target.value })} placeholder={'A little something to begin\nThe main event, family style\nSomething sweet to finish'} maxLength={1200} required/></label><label className="field">Confirm or cancel before (hours)<input type="number" min="1" max="720" step="1" value={nightForm.cutoff} onChange={e => setNightForm({ ...nightForm, cutoff: Number(e.target.value) })} required/><span className="cal-field-hint">Review the minimum by this cutoff. You decide whether to recover seats, continue, or cancel.</span></label>{error && <p className="cal-error" role="alert">{error}</p>}<div className="cal-form-footer"><button type="button" className="button secondary" onClick={() => setNightForm(null)}>Cancel</button><button type="submit" className="button" disabled={pending}>{nightForm.status === 'published' ? 'Save changes' : 'Save draft'}</button></div></form></Modal>}
    {publishTarget && <Modal title="Schedule this evening?" subtitle={publishTarget.title} onClose={() => setPublishTarget(null)}><div className="cal-form"><p className="cal-confirm-copy">Schedule {money(publishTarget.price)} seats for {longDate(publishTarget.date)} at {timeLabel(publishTarget.time)}. There are {publishTarget.seats} places, with a minimum of {publishTarget.minimum} guests.</p><p className="cal-small-note">This opens the evening for public requests. Seats are reserved when you approve a guest request. No card is charged or guest message sent.</p>{error && <p className="cal-error" role="alert">{error}</p>}<div className="cal-form-footer"><button className="button secondary" onClick={() => setPublishTarget(null)}>Keep as draft</button><button className="button" disabled={pending} onClick={publishNight}>Schedule evening</button></div></div></Modal>}
    {unpublishTarget && <Modal title="Take this evening off the calendar?" subtitle={unpublishTarget.title} onClose={() => setUnpublishTarget(null)}><div className="cal-form"><p className="cal-confirm-copy">There are no reserved seats. The evening will return to drafts so you can revisit it later.</p>{error && <p className="cal-error" role="alert">{error}</p>}<div className="cal-form-footer"><button className="button secondary" onClick={() => setUnpublishTarget(null)}>Keep scheduled</button><button className="button" disabled={pending} onClick={returnToDraft}>Return to draft</button></div></div></Modal>}
  </div>
}
