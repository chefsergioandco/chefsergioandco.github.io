import { useState, type FormEvent } from 'react'
import { money } from './model'
import { businessDate, quorumFor, receivedFor, type TableReservation, type TableSession } from './operations'
import { useAdmin } from './store'
import { Icon, Modal } from './ui'
import './TableQuorum.css'

const actionTime = () => new Date().toISOString()
function emptySession(nightId: string): TableSession {
  return { nightId, reachedAt: null, decision: 'standard', reason: '', decidedAt: null, recoveryDeadline: null, reservations: [], events: [] }
}
function easternInput(value: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value))
  const part = (name: string) => parts.find(item => item.type === name)?.value || ''
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`
}
// Interpret the form's wall clock in the business timezone, including daylight saving.
function easternInstant(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null
  const wall = Date.parse(value + 'Z')
  if (!Number.isFinite(wall)) return null
  let candidate = wall
  for (let index = 0; index < 3; index++) candidate += wall - Date.parse(easternInput(new Date(candidate).toISOString()) + 'Z')
  const iso = new Date(candidate).toISOString()
  return easternInput(iso) === value ? iso : null
}

export default function TableQuorum({ nightId }: { nightId: string }) {
  const { state, update, notify, pending:saving } = useAdmin()
  const night = state.nights.find(item => item.id === nightId)
  const session = state.operations.sessions[nightId]
  const [guestsOpen, setGuestsOpen] = useState(false)
  const [approveId, setApproveId] = useState<string | null>(null)
  const [decisionOpen, setDecisionOpen] = useState(false)
  const [decision, setDecision] = useState<'continue_below' | 'recovering' | 'cancelled'>('continue_below')
  const [reason, setReason] = useState('')
  const [deadline, setDeadline] = useState('')
  const [error, setError] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [newGuest, setNewGuest] = useState('')
  const [newSeats, setNewSeats] = useState(1)
  const [addError, setAddError] = useState('')
  if (!night) return null
  const current = session || emptySession(nightId)
  const quorum = quorumFor(night, session)
  const records = state.operations.billing.filter(record => record.nightId === nightId)
  const pending = current.reservations.filter(reservation => reservation.status === 'cancellation_requested')
  const activeParties = current.reservations.filter(reservation => reservation.status !== 'cancelled')
  const paidTotal = records.reduce((sum, record) => sum + receivedFor(record), 0)
  const approving = current.reservations.find(reservation => reservation.id === approveId)
  const approvalBill = approving ? records.find(record => record.id === approving.billingId) : undefined
  const uncertainShortfall = Math.max(0, night.minimum - quorum.secure)
  const recovering = current.decision === 'recovering'
  const deadlineExpired = recovering && !!current.recoveryDeadline && Date.parse(current.recoveryDeadline) <= Date.parse(actionTime())
  const draftNight = night.status === 'draft'
  const needsDecision = !draftNight && (current.decision === 'standard' && ['at_risk', 'below'].includes(quorum.state) || deadlineExpired)
  const cancelled = night.status === 'cancelled' || current.decision === 'cancelled'
  const manualOverride = current.decision === 'continue_below'
  const title = cancelled ? 'Evening cancelled' : draftNight ? 'Draft evening' : manualOverride ? 'Continuing by your decision' : recovering ? 'Recovering seats' : quorum.state === 'at_risk' ? 'Minimum at risk' : quorum.state === 'below' ? 'Below minimum — a decision is needed' : quorum.state === 'confirmed' ? 'Minimum reached' : 'Building toward the minimum'
  const tone = cancelled ? 'cancelled' : draftNight ? 'gathering' : needsDecision ? 'risk' : manualOverride ? 'override' : recovering ? 'recovering' : quorum.state === 'gathering' ? 'gathering' : 'settled'

  async function reservationAction(reservation: TableReservation, kind: 'request' | 'keep' | 'approve') {
    const at = actionTime()
    const label = kind === 'request' ? `Cancellation requested for ${reservation.guest}` : kind === 'keep' ? `Kept ${reservation.guest}’s table reservation` : `Approved cancellation for ${reservation.guest}`
    const persisted = await update(label, draft => {
      const target = draft.operations.sessions[nightId]
      const targetNight = draft.nights.find(item => item.id === nightId)
      const party = target?.reservations.find(item => item.id === reservation.id)
      if (!target || !party || !targetNight || targetNight.status === 'cancelled') return
      if (kind === 'request' && party.status === 'active') {
        party.status = 'cancellation_requested'; party.requestedAt = at
      } else if (kind === 'keep' && party.status === 'cancellation_requested') {
        party.status = 'active'; party.requestedAt = null
      } else if (kind === 'approve' && party.status === 'cancellation_requested') {
        party.status = 'cancelled'; party.cancelledAt = at
      }
    })
    if (!persisted) return
    setApproveId(null)
    notify(kind === 'approve' ? 'Reservation cancelled. Collection paused; received payments flagged for refund review. No refund or message sent.' : kind === 'keep' ? 'Reservation kept. Review any paused collection plan separately.' : 'Cancellation request recorded. The seats remain reserved while you review it.')
  }
  async function addReservation(event:FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!night || night.status !== 'published') { setAddError('Schedule the evening before adding a reservation.'); return }
    const fields = new FormData(event.currentTarget)
    const guest = String(fields.get('guest') || '').trim()
    const seats = Number(fields.get('seats'))
    setNewGuest(guest); setNewSeats(seats)
    if (guest.length < 2 || guest.length > 120) { setAddError('Enter the guest’s name, between 2 and 120 characters.'); return }
    const available = night.seats - quorum.reserved
    if (!Number.isInteger(seats) || seats < 1 || seats > available) { setAddError(`Choose a whole number of seats from 1 to ${Math.max(0, available)}.`); return }
    const id = crypto.randomUUID()
    const persisted = await update(`Added ${seats} table seat${seats === 1 ? '' : 's'} for ${guest}`, draft => {
      const target = draft.operations.sessions[nightId] || (draft.operations.sessions[nightId] = emptySession(nightId))
      target.reservations.push({id,guest,seats,status:'active',bookedAt:actionTime(),requestedAt:null,cancelledAt:null,billingId:'bill-'+id})
    })
    if (!persisted) return
    setAddOpen(false); setAddError(''); setNewGuest(''); setNewSeats(1)
    notify('Reservation saved. Its unpaid billing record is available in Billing & records.')
  }
  function openDecision() {
    setReason(current.reason)
    setDecision(current.decision === 'recovering' ? 'recovering' : 'continue_below')
    const eventAt = easternInstant(night!.date + 'T' + night!.time)
    setDeadline(current.recoveryDeadline ? easternInput(current.recoveryDeadline) : eventAt ? easternInput(new Date(Date.parse(eventAt) - night!.cutoff * 3600000).toISOString()) : '')
    setError(''); setDecisionOpen(true)
  }
  async function saveDecision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    const explanation = String(fields.get('reason') || '').trim()
    const enteredDeadline = String(fields.get('deadline') || deadline)
    if (explanation.length < 3) { setError('Add a reason so the decision can be understood later.'); return }
    const recovery = decision === 'recovering' ? easternInstant(enteredDeadline) : null
    const eventAt = easternInstant(night!.date + 'T' + night!.time)
    if (decision === 'recovering' && (!recovery || Date.parse(recovery) <= Date.parse(actionTime()) || !eventAt || Date.parse(recovery) >= Date.parse(eventAt))) {
      setError('Choose a recovery deadline after now and before guests arrive, using Eastern time.'); return
    }
    const at = actionTime()
    const persisted = await update(`Table decision: ${decision === 'continue_below' ? 'continue below minimum' : decision === 'recovering' ? 'recover seats' : 'cancel evening'} — ${night!.title}`, draft => {
      const targetNight = draft.nights.find(item => item.id === nightId)
      if (!targetNight) return
      const target = draft.operations.sessions[nightId] || (draft.operations.sessions[nightId] = emptySession(nightId))
      target.decision = decision; target.reason = explanation; target.decidedAt = at; target.recoveryDeadline = recovery
      const guests = target.reservations.filter(item => item.status !== 'cancelled')
      if (decision === 'cancelled') {
        targetNight.status = 'cancelled'
        for (const party of guests) {
          party.status = 'cancelled'; party.cancelledAt = at
        }
      } else {
        targetNight.status = 'published'
      }
    })
    if (!persisted) return
    setDecisionOpen(false)
    notify(decision === 'cancelled' ? 'Evening cancelled. Collections paused and refund reviews flagged. No refund or guest message sent.' : decision === 'continue_below' ? 'Manual decision saved. The evening stays open below minimum; no automatic cancellation.' : 'Recovery plan saved. The evening stays scheduled; the deadline requires your review.')
  }

  return <div className={'table-quorum ' + tone}>
    <div className="table-quorum-heading"><Icon name={cancelled ? 'close' : draftNight ? 'edit' : needsDecision ? 'info' : recovering ? 'clock' : quorum.state === 'gathering' ? 'people' : 'check'} size={18}/><strong>{title}</strong></div>
    <p className="table-quorum-counts"><strong>{quorum.reserved}</strong> reserved · <strong>{quorum.secure}</strong> secure · minimum <strong>{night.minimum}</strong></p>
    {current.reachedAt && <p className="table-quorum-origin">Originally confirmed {businessDate(current.reachedAt)}. That confirmation remains recorded.</p>}
    {!cancelled && !current.reachedAt && (draftNight || quorum.state === 'gathering') && <p className="table-quorum-explanation">{draftNight ? `Not yet open for reservations. The target is at least ${night.minimum} guests.` : `${quorum.shortfall} more seats are needed to reach the minimum.`}</p>}
    {!cancelled && pending.length > 0 && <p className="table-quorum-explanation">{quorum.uncertain} seats have a cancellation request. {!current.reachedAt ? 'These seats stay reserved until you review the request.' : uncertainShortfall > 0 ? `Approving all requests would leave the evening ${uncertainShortfall} seats short of its minimum.` : 'The remaining seats still meet the minimum.'}</p>}
    {!cancelled && !draftNight && !!current.reachedAt && quorum.shortfall > 0 && <p className="table-quorum-explanation">The evening is {quorum.shortfall} seats below its minimum. {manualOverride ? 'Your manual decision keeps it open.' : recovering ? 'Your recovery plan keeps it scheduled.' : 'It stays scheduled while you choose what happens next.'}</p>}
    {manualOverride && !cancelled && !draftNight && <p className="table-quorum-decision-note">Manual override active. Falling below the minimum will not cancel this evening automatically.</p>}
    {current.decision === 'recovering' && current.recoveryDeadline && !cancelled && !draftNight && <p className="table-quorum-decision-note">Recovery deadline: <strong>{businessDate(current.recoveryDeadline)}</strong>. {Date.parse(current.recoveryDeadline) <= Date.parse(actionTime()) ? 'Deadline passed — review your decision.' : 'The evening stays scheduled. A missed deadline requires your decision.'}</p>}
    {current.decidedAt && <p className="table-quorum-decision-meta"><strong>Decision recorded</strong> · {businessDate(current.decidedAt)}<span>{current.reason}</span></p>}
    <div className="table-quorum-actions"><button className="table-quorum-link" onClick={() => setGuestsOpen(true)}>Manage guests{pending.length > 0 ? ` (${pending.length} request${pending.length === 1 ? '' : 's'})` : ''}</button>{!cancelled && !draftNight && (current.reachedAt || needsDecision || manualOverride || recovering) && <button className="table-quorum-link emphasis" onClick={openDecision}>{current.decision !== 'standard' ? 'Review decision' : 'Choose next step'}</button>}<button className="table-quorum-link" onClick={() => setHistoryOpen(true)}>History</button></div>

    {guestsOpen && <Modal title="Guests around this table" subtitle={night.title} onClose={() => setGuestsOpen(false)} wide><div className="table-quorum-modal"><div className="table-quorum-guest-summary"><strong>{quorum.reserved} reserved seats</strong><span>{quorum.secure} secure · minimum {night.minimum}</span></div>{!cancelled && <div className="modal-actions"><button className="button" disabled={saving || draftNight || quorum.reserved >= night.seats} onClick={() => { setNewGuest(''); setNewSeats(1); setAddError(''); setAddOpen(true) }}><Icon name="plus" size={16}/>Add reservation</button></div>}{draftNight && <p className="cal-small-note">Schedule this evening before adding reservations.</p>}{!current.reservations.length ? <p className="table-quorum-empty">No guest reservations are recorded for this evening yet.</p> : <div className="table-quorum-guests">{current.reservations.map(reservation => {
      const bill = records.find(item => item.id === reservation.billingId)
      return <article key={reservation.id}><div className="table-quorum-guest-main"><h3>{reservation.guest}</h3><p>{reservation.seats} seats · {reservation.status === 'active' ? 'Reserved' : reservation.status === 'cancellation_requested' ? 'Cancellation requested' : 'Cancelled'}</p>{bill && <p className="table-quorum-payment">{money(receivedFor(bill))} received · {bill.collection.mode === 'paused' ? 'Collection paused' : 'Payment history retained'}{bill.refundReview ? ' · Refund review needed' : ''}</p>}{reservation.requestedAt && <p className="table-quorum-guest-date">Cancellation requested {businessDate(reservation.requestedAt)}</p>}</div>{!cancelled && reservation.status !== 'cancelled' && <div className="table-quorum-guest-actions">{reservation.status === 'active' ? <button className="button secondary" disabled={saving} onClick={() => reservationAction(reservation, 'request')}>Request cancellation</button> : <><button className="button secondary" disabled={saving} onClick={() => reservationAction(reservation, 'keep')}>Keep reservation</button><button className="button danger" onClick={() => setApproveId(reservation.id)}>Review cancellation</button></>}</div>}</article>
    })}</div>}<p className="table-quorum-demo"><Icon name="info" size={17}/>Payment and confirmation history stays recorded. Guest messages and card refunds are not connected.</p></div><div className="modal-actions"><button className="button secondary" onClick={() => setGuestsOpen(false)}>Done</button></div></Modal>}

    {addOpen && <Modal title="Add a table reservation" subtitle={night.title} onClose={() => setAddOpen(false)}><form className="table-quorum-modal" onSubmit={addReservation}><p>{Math.max(0, night.seats - quorum.reserved)} seats available · {money(night.price)} per guest.</p><label className="field">Guest name<input name="guest" value={newGuest} onChange={event => setNewGuest(event.target.value)} minLength={2} maxLength={120} autoComplete="name" required/></label><label className="field">Seats<input name="seats" type="number" min={1} max={Math.max(1,night.seats-quorum.reserved)} step={1} value={newSeats} onChange={event => setNewSeats(Number(event.target.value))} required/></label><p className="cal-small-note">The reservation and an unpaid billing record are saved together. No card is charged or guest message sent. Record an offline payment separately after saving.</p>{addError && <p className="table-quorum-error" role="alert">{addError}</p>}<div className="table-quorum-decision-actions"><button type="button" className="button secondary" onClick={() => setAddOpen(false)}>Cancel</button><button type="submit" className="button" disabled={saving}>{saving ? 'Saving…' : 'Save reservation'}</button></div></form></Modal>}

    {approving && <Modal title="Approve this cancellation?" subtitle={`${approving.guest} · ${approving.seats} seats · ${night.title}`} onClose={() => setApproveId(null)}><div className="table-quorum-modal"><p>Release {approving.seats} seats. This leaves <strong>{Math.max(0, quorum.reserved - approving.seats)} reserved seats</strong> against a minimum of <strong>{night.minimum}</strong>.</p>{current.reachedAt && <p>The original confirmation will remain in the history. The evening will need an explicit decision if it falls below minimum.</p>}<div className="table-quorum-refund-review"><strong>{money(approvalBill ? receivedFor(approvalBill) : 0)} remains received</strong><p>Further collection will be paused. Received funds are flagged for refund review; this action does not issue a refund.</p></div></div><div className="modal-actions"><button className="button secondary" onClick={() => setApproveId(null)}>Keep reviewing</button><button className="button danger" disabled={saving} onClick={() => reservationAction(approving, 'approve')}>Approve cancellation</button></div></Modal>}

    {decisionOpen && <Modal title="Choose what happens next" subtitle={night.title} onClose={() => setDecisionOpen(false)} wide><form onSubmit={saveDecision} className="table-quorum-modal"><p className="table-quorum-context">{current.reachedAt ? `This evening was confirmed ${businessDate(current.reachedAt)}.` : 'This evening is still gathering guests.'} There are {quorum.reserved} reserved seats, {quorum.secure} secure seats, and a minimum of {night.minimum}.</p><fieldset className="table-quorum-options"><legend>Your decision</legend>{([{ value: 'continue_below', title: 'Continue below minimum', text: 'Keep the evening open by manual override. It will not be cancelled automatically if seats fall short.' }, { value: 'recovering', title: 'Recover the missing seats', text: 'Keep the evening scheduled, set a deadline, and review the plan if the seats are not filled.' }, { value: 'cancelled', title: 'Cancel the evening', text: 'Cancel reservations, pause collections, and flag received payments for refund review.' }] as const).map(option => <label key={option.value} className={decision === option.value ? 'selected' : ''}><input type="radio" name="table-decision" value={option.value} checked={decision === option.value} onChange={() => { setDecision(option.value); setError('') }}/><span><strong>{option.title}</strong><small>{option.text}</small></span></label>)}</fieldset>{decision === 'recovering' && <label className="field"><span>Recovery deadline (Eastern time)</span><input name="deadline" type="datetime-local" value={deadline} onInput={event => setDeadline(event.currentTarget.value)} onChange={event => setDeadline(event.currentTarget.value)} required/><small>{uncertainShortfall} secure seats need recovering to meet the minimum. This deadline does not automatically cancel the evening.</small></label>}{decision === 'cancelled' && <section className="table-quorum-refund-review" aria-label="Cancellation review"><h3>Before you cancel</h3><dl><div><dt>Current reservations</dt><dd>{activeParties.length} parties · {quorum.reserved} seats</dd></div><div><dt>Received funds needing review</dt><dd>{money(paidTotal)}</dd></div></dl><p>All further collections will be paused. Existing payment history stays intact. Refunds require a separate review and action. Contact guests separately; messages are not sent from this workspace.</p></section>}<label className="field"><span>Reason for your decision</span><textarea name="reason" rows={3} value={reason} onChange={event => setReason(event.target.value)} placeholder="What changed, and why is this the right plan?" maxLength={1200} required/></label>{error && <p className="table-quorum-error" role="alert">{error}</p>}<div className="table-quorum-decision-actions"><button type="button" className="button secondary" onClick={() => setDecisionOpen(false)}>Keep reviewing</button><button type="submit" disabled={saving} className={'button ' + (decision === 'cancelled' ? 'danger' : '')}>{decision === 'cancelled' ? 'Confirm evening cancellation' : decision === 'recovering' ? 'Save recovery plan' : 'Save manual decision'}</button></div></form></Modal>}

    {historyOpen && <Modal title="This evening’s history" subtitle={night.title} onClose={() => setHistoryOpen(false)}><div className="table-quorum-modal"><p className="table-quorum-history-intro">Confirmation, guest changes, and decisions remain here.</p>{current.events.length ? <ol className="table-quorum-history">{current.events.map(event => <li key={event.id}><p>{event.description}</p><span>{event.actor} · {businessDate(event.at)}</span></li>)}</ol> : <p>No decisions or reservation changes have been recorded yet.</p>}</div><div className="modal-actions"><button className="button secondary" onClick={() => setHistoryOpen(false)}>Done</button></div></Modal>}
  </div>
}
