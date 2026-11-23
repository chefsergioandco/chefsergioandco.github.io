import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { Booking } from './model'
import { dateLabel, money, timeLabel } from './model'
import type { BookingPlanning, InterviewTopic } from './planning'
import { topicLabels } from './planning'
import { adminFetch, useAdmin } from './store'
import { Icon } from './ui'
import { localInterview, interviewInstant } from './interview-time'
import './InterviewBrief.css'

type GuestResponse = {id:string;name:string;email:string;attending:boolean|string;dietary:string;allergies:string;updatedAt:string}
const statuses = [{ value: 'unknown', label: 'Unknown' }, { value: 'tentative', label: 'Tentative' }, { value: 'agreed', label: 'Agreed' }] as const
const displayDate = (value: string | null | undefined) => value ? dateLabel(value, { month: 'long', day: 'numeric', year: 'numeric' }) : 'Date to be agreed'
const displayInstant = (value: string | null) => value ? new Date(value).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) : 'Not scheduled'
function initialTopics(booking: Booking): InterviewTopic[] {
  if (booking.planning) return structuredClone(booking.planning.topics)
  const values: Record<string, string> = {
    date: booking.date ? `${displayDate(booking.date)}${booking.time ? ` at ${timeLabel(booking.time)}` : ''}` : '',
    party: booking.guests ? `${booking.guests} guests` : '', location: booking.location, kitchen: '', budget: '', menu: '', dietary: booking.dietary,
  }
  return Object.entries(topicLabels).map(([id, label]) => ({ id, label, supplied: values[id] || '', status: values[id] ? 'tentative' : 'unknown', answer: '', notes: '', updatedAt: null, updatedBy: '' }))
}
function moneyInput(value: string) { return value.trim() ? Number(value) : null }

export default function InterviewBrief({ booking }: { booking: Booking }) {
  const { planningAction, pending, notify, capabilities } = useAdmin()
  const plan = booking.planning
  const [topics, setTopics] = useState<InterviewTopic[]>(() => initialTopics(booking))
  const [followUp, setFollowUp] = useState(plan?.followUp ?? '')
  const [agreed, setAgreed] = useState({ date: plan?.agreed.date ?? '', time: plan?.agreed.time ?? '', guests: plan?.agreed.guests?.toString() ?? '', ceiling: plan?.spendingCeiling?.toString() ?? '' })
  const [question, setQuestion] = useState('')
  const [scheduledAt, setScheduledAt] = useState(localInterview(plan?.interview.scheduledAt ?? null))
  const [meetUrl, setMeetUrl] = useState(plan?.interview.meetUrl ?? '')
  const [sentReference, setSentReference] = useState('')
  const [sentConfirmed, setSentConfirmed] = useState(false)
  const [menu, setMenu] = useState({ text: plan?.menu.text ?? '', price: plan?.menu.price?.toString() ?? '' })
  const [invitation, setInvitation] = useState({ url: plan?.eventInvitation.url ?? '', reference: '', physical: plan?.eventInvitation.physical ?? false })
  const [refund, setRefund] = useState({ retainedFee: plan?.cancellation.retainedFee?.toString() ?? '0', reason: '' })
  const [responses,setResponses]=useState<GuestResponse[]|null>(null)
  const [responsesLoading,setResponsesLoading]=useState(false)
  const [responsesError,setResponsesError]=useState('')
  const responseSequence=useRef(0)
  const [error, setError] = useState('')
  const [active, setActive] = useState('')
  useEffect(() => {
    setTopics(initialTopics(booking)); setFollowUp(booking.planning?.followUp ?? '')
    setAgreed({ date: booking.planning?.agreed.date ?? '', time: booking.planning?.agreed.time ?? '', guests: booking.planning?.agreed.guests?.toString() ?? '', ceiling: booking.planning?.spendingCeiling?.toString() ?? '' })
    setScheduledAt(localInterview(booking.planning?.interview.scheduledAt ?? null)); setMeetUrl(booking.planning?.interview.meetUrl ?? '')
    setMenu({ text: booking.planning?.menu.text ?? '', price: booking.planning?.menu.price?.toString() ?? '' }); setQuestion(''); setSentReference(''); setSentConfirmed(false); setInvitation({url:booking.planning?.eventInvitation.url ?? '',reference:'',physical:booking.planning?.eventInvitation.physical ?? false}); setRefund({retainedFee:booking.planning?.cancellation.retainedFee?.toString() ?? '0',reason:''}); setError(''); setResponses(null); setResponsesError(''); setResponsesLoading(false); responseSequence.current += 1
  }, [booking.id])
  useEffect(()=>{if(plan?.eventInvitation.url)setInvitation(current=>({...current,url:plan.eventInvitation.url}))},[plan?.eventInvitation.url])
  useEffect(()=>()=>{responseSequence.current += 1},[])
  const unresolved = topics.filter(topic => topic.status !== 'agreed').length
  // Keep cards in their saved order while the host is being discussed. Reordering a
  // card as its select changes would move focus and make mobile note-taking jump.
  const orderedTopics = useMemo(() => [...topics].sort((a, b) => Number(a.status === 'agreed') - Number(b.status === 'agreed')), [booking.id])
  const order = new Map(orderedTopics.map((topic, index) => [topic.id, index]))
  const visibleTopics = [...topics].sort((a, b) => (order.get(a.id) ?? 100) - (order.get(b.id) ?? 100))
  const locked = pending || booking.status === 'cancelled'
  const interviewDirty = scheduledAt !== localInterview(plan?.interview.scheduledAt ?? null) || meetUrl.trim() !== (plan?.interview.meetUrl ?? '')
  const menuDirty = menu.text !== (plan?.menu.text ?? '') || menu.price !== (plan?.menu.price?.toString() ?? '')
  const briefDirty = !plan || JSON.stringify(topics.map(({ id, status, answer, notes }) => ({ id, status, answer, notes }))) !== JSON.stringify(plan.topics.map(({ id, status, answer, notes }) => ({ id, status, answer, notes }))) || followUp !== plan.followUp || agreed.date !== (plan.agreed.date ?? '') || agreed.time !== (plan.agreed.time ?? '') || agreed.guests !== (plan.agreed.guests?.toString() ?? '') || agreed.ceiling !== (plan.spendingCeiling?.toString() ?? '')
  const changeTopic = (id: string, patch: Partial<InterviewTopic>) => { setTopics(current => current.map(topic => topic.id === id ? { ...topic, ...patch } : topic)); setError('') }
  const run = async (action: string, payload: Record<string, unknown>, success: string) => {
    if (pending) return false
    setActive(action); setError('')
    const saved = await planningAction({ action, bookingId: booking.id, ...payload })
    setActive('')
    if (saved) notify(success)
    else setError('This change was not saved. Review the workspace message and try again; your entries remain here.')
    return saved
  }
  const saveBrief = async (event: FormEvent) => {
    event.preventDefault()
    const ceiling = moneyInput(agreed.ceiling), guests = agreed.guests ? Number(agreed.guests) : null
    if (ceiling !== null && (!Number.isFinite(ceiling) || ceiling < 0 || Math.abs(Math.round(ceiling * 100) - ceiling * 100) > .000001)) { setError('Enter a spending ceiling of zero or more, with up to two decimal places.'); return }
    if (guests !== null && (!Number.isInteger(guests) || guests < 1 || guests > 24)) { setError('Enter an agreed guest count from 1 to 24, or leave it unsettled.'); return }
    if (!!agreed.date !== !!agreed.time) { setError('Supply both an agreed event date and time, or leave both unsettled.'); return }
    await run('save_brief', { topics: topics.map(({ id, label, status, answer, notes }) => ({ id, label, status, answer, notes })), followUp, spendingCeiling: ceiling, date: agreed.date || null, time: agreed.time || null, guests }, 'Interview brief saved.')
  }
  const saveInterview = async (event: FormEvent) => {
    event.preventDefault()
    const instant = interviewInstant(scheduledAt)
    if (!instant) { setError('Choose the interview date and time in Eastern time.'); return }
    await run('schedule_interview', { scheduledAt: instant, meetUrl: meetUrl.trim() }, 'Interview arrangements saved. No invitation was sent.')
  }
  const addQuestion = () => {
    if (!question.trim()) return
    setTopics(current => [...current, { id: 'custom-' + crypto.randomUUID(), label: question.trim(), supplied: '', status: 'unknown', answer: '', notes: '', updatedAt: null, updatedBy: '' }]); setQuestion('')
  }
  const loadResponses = async () => {
    const sequence = ++responseSequence.current
    setResponsesLoading(true);setResponsesError('')
    try {
      const response=await adminFetch('/api/invitations/rsvps?bookingId='+encodeURIComponent(booking.id),{cache:'no-store'})
      const data=await response.json().catch(()=>null)
      if(!response.ok||!Array.isArray(data?.responses))throw new Error(data?.error?.message||'Guest responses could not be loaded.')
      if(sequence===responseSequence.current)setResponses(data.responses)
    } catch(error) {if(sequence===responseSequence.current)setResponsesError(error instanceof Error?error.message:'Guest responses could not be loaded.')}
    finally {if(sequence===responseSequence.current)setResponsesLoading(false)}
  }
  const copyInvitation = async () => {
    try {await navigator.clipboard.writeText(plan?.eventInvitation.url||invitation.url);notify('Host invitation link copied.')}
    catch {setError('The link could not be copied automatically. Select the invitation link field and copy it.')}
  }
  const original = plan?.original
  const depositStatus = plan?.deposit.status === 'paid' ? 'Deposit paid' : plan?.deposit.status === 'refunded' ? 'Deposit refunded' : plan?.deposit.status === 'refund_pending' ? 'Refund pending' : booking.paid ? 'Receipt recorded' : 'Deposit unpaid'
  return <section className="interview-brief" aria-labelledby={`interview-title-${booking.id}`}>
    <div className="interview-brief-header"><div><p className="eyebrow">THE MENU CONVERSATION</p><h2 id={`interview-title-${booking.id}`}>Interview brief</h2><p>Keep what the host told you. Settle the remaining questions together, then prepare the menu within the agreed ceiling.</p></div><span className="interview-count"><Icon name={unresolved ? 'book' : 'check'} size={15} />{unresolved ? `${unresolved} to clarify` : 'Details agreed'}</span></div>
    <div className="interview-body">
      <dl className="interview-facts"><div><dt>Payment</dt><dd>{depositStatus}{plan?.deposit.amount !== null && plan?.deposit.amount !== undefined ? ` · ${money(plan.deposit.amount)}` : ''}</dd></div><div><dt>Event date</dt><dd>{plan?.dateReserved ? 'Date reserved' : booking.date ? 'Proposed date' : 'Date to be agreed'}</dd></div><div><dt>Spending ceiling</dt><dd>{plan?.spendingCeiling !== null && plan?.spendingCeiling !== undefined ? money(plan.spendingCeiling) : 'To agree during interview'}</dd></div></dl>
      <details className="interview-snapshot"><summary>Original host brief <span className="muted">Preserved as submitted</span></summary><dl>
        <div><dt>Date</dt><dd>{original ? original.dateMode === 'exact' ? plan?.topics.find(topic => topic.id === 'date')?.supplied || displayDate(booking.date) : original.dateMode === 'flexible' ? [original.dateFrom, original.dateTo].filter(Boolean).map(displayDate).join(' – ') || 'Flexible dates' : 'Help choosing a date' : displayDate(booking.date)}</dd></div>
        <div><dt>Party</dt><dd>{original ? original.headcount ? `${original.headcount} guests · ${original.partyBandLabel}` : `${original.partyBandLabel} · exact count undecided` : booking.guests ? `${booking.guests} guests` : 'Exact count undecided'}</dd></div>
        <div><dt>Location</dt><dd>{plan?.topics.find(topic => topic.id === 'location')?.supplied || booking.location || 'To be discussed'}</dd></div><div><dt>Kitchen</dt><dd>{original?.kitchen || 'To be clarified'}</dd></div>
        <div><dt>Spending range</dt><dd>{original?.budgetMode === 'range' ? `${original.budgetMin !== null ? money(original.budgetMin) : 'Open'} – ${original.budgetMax !== null ? money(original.budgetMax) : 'Open'} ${original.budgetUnit === 'per_person' ? 'per guest' : 'in total'}` : 'The host needs guidance'}</dd></div>
        <div><dt>Food ideas</dt><dd>{original?.foodIdeas || 'Open to Sergio’s suggestions'}</dd></div><div><dt>Reported dietary needs and allergies</dt><dd>{original?.allergies || booking.dietary || 'Not supplied; discuss with the host'}</dd></div><div><dt>Occasion</dt><dd>{booking.occasion || 'Not supplied'}</dd></div>
      </dl></details>
      {error && <p className="interview-error" role="alert">{error}</p>}
      <form onSubmit={saveBrief} className="interview-panel" style={{ borderTop: 0, paddingTop: 0 }} noValidate>
        <div className="interview-topics">{visibleTopics.map(topic => <details className="interview-topic" key={topic.id}>
          <summary><span className="interview-topic-title"><strong>{topic.label}</strong><small>{topic.answer || topic.supplied || 'A question for the interview'}</small></span><span className={`interview-status ${topic.status}`}>{statuses.find(status => status.value === topic.status)?.label}</span><Icon name="down" size={16} /></summary>
          <div className="interview-topic-fields">
            {topic.supplied && <p className="interview-info" style={{ gridColumn: '1 / -1' }}>Host supplied: {topic.supplied}</p>}
            <label className="field">Working answer<input value={topic.answer} maxLength={2000} onChange={event => changeTopic(topic.id, { answer: event.target.value })} disabled={locked} placeholder="What you establish together" /></label>
            <label className="field">Status<select value={topic.status} onChange={event => changeTopic(topic.id, { status: event.target.value as InterviewTopic['status'] })} disabled={locked}>{statuses.map(status => <option value={status.value} key={status.value}>{status.label}</option>)}</select></label>
            {topic.id === 'date' && <><label className="field">Agreed event date<input type="date" value={agreed.date} onChange={event => setAgreed({ ...agreed, date: event.target.value })} disabled={locked} /></label><label className="field">Agreed start time<input type="time" value={agreed.time} onChange={event => setAgreed({ ...agreed, time: event.target.value })} disabled={locked} /></label><small className="full">Saving an agreed date checks current availability. Payment and date reservation remain separate.</small></>}
            {topic.id === 'party' && <label className="field full">Agreed guest count<input type="number" min={1} max={24} step={1} value={agreed.guests} onChange={event => setAgreed({ ...agreed, guests: event.target.value })} placeholder="Leave blank while undecided" disabled={locked} /></label>}
            {topic.id === 'budget' && <label className="field full">Agreed spending ceiling ($)<input type="number" min={0} step="0.01" value={agreed.ceiling} onChange={event => setAgreed({ ...agreed, ceiling: event.target.value })} placeholder="Agreed on the call" disabled={locked} /><small>The finished menu and price must stay within this ceiling.</small></label>}
            <label className="field full">Internal notes<textarea rows={2} value={topic.notes} maxLength={4000} onChange={event => changeTopic(topic.id, { notes: event.target.value })} disabled={locked} /></label>
            {topic.updatedAt && <small className="full">Last saved {displayInstant(topic.updatedAt)}{topic.updatedBy ? ` · ${topic.updatedBy}` : ''}</small>}
          </div>
        </details>)}</div>
        <div className="interview-custom-form"><label className="field">Another question to clarify<input value={question} maxLength={150} onChange={event => setQuestion(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addQuestion() } }} disabled={locked} placeholder="For example, arrival or access arrangements" /></label><button type="button" className="button secondary" disabled={locked || !question.trim()} onClick={addQuestion}><Icon name="plus" size={15} />Add question</button></div>
        <label className="field">Follow-up after the call<textarea rows={3} value={followUp} maxLength={4000} onChange={event => setFollowUp(event.target.value)} disabled={locked} placeholder="What is still outstanding, and who will follow up?" /></label>
        <div className="interview-save-row"><p>Host answers remain preserved. Changes save to this private booking.</p><button className="button" type="submit" disabled={locked || !briefDirty}>{active === 'save_brief' ? 'Saving…' : plan ? 'Save interview brief' : 'Start interview brief'}</button></div>
      </form>
      <section className="interview-panel" aria-labelledby={`interview-arrangements-${booking.id}`}><h3 id={`interview-arrangements-${booking.id}`}>Menu-interview arrangements</h3><p>{plan?.interview.sentAt ? `Invitation recorded as sent ${displayInstant(plan.interview.sentAt)}. An unanswered calendar invitation keeps the booking active.` : 'Save the interview arrangements, send the invitation through your chosen service, then record that it was sent. A draft or saved link does not count as sent.'}</p>
        <form onSubmit={saveInterview} className="interview-form-grid"><label className="field">Interview date and time (Eastern)<input type="datetime-local" value={scheduledAt} onChange={event => setScheduledAt(event.target.value)} disabled={locked} required /></label><label className="field">Google Meet link<input type="url" value={meetUrl} onChange={event => setMeetUrl(event.target.value)} maxLength={1000} placeholder="https://meet.google.com/…" disabled={locked} /></label><div className="interview-panel-actions full"><button className="button secondary" type="submit" disabled={locked}>{active === 'schedule_interview' ? 'Saving…' : 'Save interview arrangements'}</button>{plan?.interview.scheduledAt && <span className="interview-invitation-history">Saved for {displayInstant(plan.interview.scheduledAt)}</span>}</div></form>
        {!plan?.interview.sentAt && <><label className="field">Sent invitation reference<input value={sentReference} maxLength={500} onChange={event => setSentReference(event.target.value)} placeholder="Email subject, message reference, or calendar invitation reference" disabled={locked} /></label><label className="interview-info" style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}><input type="checkbox" checked={sentConfirmed} onChange={event => setSentConfirmed(event.target.checked)} disabled={locked} style={{ width: 18, minHeight: 18, marginTop: 2, flexShrink: 0 }} /><span>I have sent the menu-interview invitation to this host. An explicit cancellation after this point may retain the planning fee disclosed at payment.</span></label><div className="interview-panel-actions"><button className="button secondary" type="button" disabled={locked || !plan?.interview.scheduledAt || !sentConfirmed || sentReference.trim().length < 3 || !plan.interview.meetUrl || interviewDirty} onClick={() => void run('record_invitation_sent', { reference: sentReference.trim() }, 'Menu-interview invitation recorded as sent.')}>{active === 'record_invitation_sent' ? 'Recording…' : 'Record invitation sent'}</button></div></>}
        {plan?.interview.status !== 'completed' && <div className="interview-panel-actions"><button className="button secondary" type="button" disabled={locked || !plan?.interview.sentAt} onClick={() => void run('complete_interview', {}, 'Interview recorded as complete.')}>Record interview complete</button></div>}
        {plan?.interview.completedAt && <p className="interview-invitation-history">Interview completed {displayInstant(plan.interview.completedAt)}.</p>}
      </section>
      <section className="interview-panel" aria-labelledby={`interview-menu-${booking.id}`}><h3 id={`interview-menu-${booking.id}`}>Finish the menu</h3><p>Agree the spending ceiling during the call. Prepare the finished menu within it; the full deposit counts toward the event bill.</p><label className="field">Finished menu<textarea rows={5} value={menu.text} maxLength={10000} onChange={event => setMenu({ ...menu, text: event.target.value })} disabled={locked || plan?.menu.status === 'finalized'} placeholder="The menu you will send to the host" /></label><div className="interview-form-grid"><label className="field">Event price before optional postage ($)<input type="number" min={0} step="0.01" value={menu.price} onChange={event => setMenu({ ...menu, price: event.target.value })} disabled={locked || plan?.menu.status === 'finalized'} /></label><div><small>Agreed ceiling</small><p style={{ margin: '8px 0' }}>{plan?.spendingCeiling !== null && plan?.spendingCeiling !== undefined ? money(plan.spendingCeiling) : 'Save the agreed ceiling first'}</p></div></div><div className="interview-panel-actions"><button type="button" className="button secondary" disabled={locked || plan?.menu.status === 'finalized' || !menu.text.trim()} onClick={() => { const price = moneyInput(menu.price); if (price !== null && (!Number.isFinite(price) || price <= 0 || Math.abs(price * 100 - Math.round(price * 100)) > .000001)) { setError('Enter a positive final price with up to two decimal places.'); return } if (price !== null && plan?.spendingCeiling !== null && plan?.spendingCeiling !== undefined && price > plan.spendingCeiling) { setError('The final price must stay within the agreed spending ceiling.'); return } void run('save_menu', { text: menu.text, price }, 'Menu draft saved.') }}>Save menu draft</button><button type="button" className="button" disabled={locked || plan?.menu.status === 'finalized' || menuDirty || !plan?.menu.text || plan.menu.price === null || plan.spendingCeiling === null} onClick={() => void run('finalize_menu', {}, 'Menu finalized within the agreed ceiling.')}>{plan?.menu.status === 'finalized' ? 'Menu finalized' : 'Finalize saved menu'}</button></div></section>
      <section className="interview-panel" aria-labelledby={`event-invitation-${booking.id}`}><h3 id={`event-invitation-${booking.id}`}>Event invitations</h3><p>These are the invitations for the gathering, separate from the menu-interview invitation. The host shares one link; guest dietary and allergy reports stay private.</p>
        <div className="interview-panel-actions"><button type="button" className="button secondary" disabled={locked || plan?.menu.status !== 'finalized' || booking.paid <= 0} onClick={()=>void run('release_invitation',{},'Host invitation link created. It has not been sent.')}><Icon name="mail" size={16}/>{plan?.eventInvitation.url ? 'Update host invitation link' : 'Create host invitation link'}</button>{plan?.eventInvitation.url && <button type="button" className="button secondary" onClick={()=>void copyInvitation()}><Icon name="external" size={16}/>Copy host link</button>}</div>
        {!plan?.eventInvitation.url && <p className="interview-info">The invitation link is available after the deposit is paid, the menu is finalized, and the event date, headcount and venue address are complete.</p>}
        <div className="interview-form-grid"><label className="field full">Host’s shareable invitation link<input type="url" value={invitation.url} maxLength={2000} onChange={event => setInvitation({ ...invitation, url: event.target.value })} placeholder="Create a host invitation link after finalizing the menu" disabled={locked || plan?.menu.status !== 'finalized'} /></label><label className="field full">Delivery reference<input value={invitation.reference} maxLength={500} onChange={event => setInvitation({ ...invitation, reference: event.target.value })} placeholder="Where or how you sent the finished details and invitation" disabled={locked || plan?.menu.status !== 'finalized'} /></label></div>
        <label className="interview-info" style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}><input type="checkbox" checked={invitation.physical} onChange={event => setInvitation({ ...invitation, physical: event.target.checked })} disabled={locked || plan?.menu.status !== 'finalized'} style={{ width: 18, minHeight: 18, marginTop: 2, flexShrink: 0 }} /><span>Include optional physical invitations sent to the host. Confirm the configured postage allowance within the agreed spending ceiling.</span></label>
        <div className="interview-panel-actions"><button type="button" className="button secondary" disabled={locked || plan?.menu.status !== 'finalized' || !invitation.url.trim() || invitation.reference.trim().length < 3} onClick={() => void run('record_event_invitation_sent', { url: invitation.url.trim(), reference: invitation.reference.trim(), physical: invitation.physical }, 'Event invitation delivery recorded.')}>Record invitation sent to host</button></div>
        {plan?.eventInvitation.sentAt && <p className="interview-invitation-history">Last recorded delivery {displayInstant(plan.eventInvitation.sentAt)} · {plan.eventInvitation.sentReference}</p>}
        {plan?.eventInvitation.url && <details className="interview-snapshot" onToggle={event=>{if(event.currentTarget.open&&responses===null&&!responsesLoading)void loadResponses()}}><summary>Guest RSVPs and requirements <span className="muted">Private to this workspace</span></summary>{responsesLoading && <p role="status">Loading guest responses…</p>}{responsesError && <p className="interview-error" role="alert">{responsesError}</p>}{responses && <><p className="interview-invitation-history">{responses.length} {responses.length===1?'response':'responses'} received</p><div className="interview-guest-responses">{responses.map(response=><article key={response.id}><div><strong>{response.name}</strong><span>{response.attending===true||response.attending==='yes'?'Attending':response.attending===false||response.attending==='no'?'Not attending':'Response recorded'}</span></div><p>{response.email}</p>{response.dietary&&<p><b>Dietary needs:</b> {response.dietary}</p>}{response.allergies&&<p><b>Allergies:</b> {response.allergies}</p>}<small>Updated {displayInstant(response.updatedAt)}</small></article>)}</div></>}<button type="button" className="button secondary" disabled={responsesLoading} onClick={()=>void loadResponses()}>Refresh guest responses</button></details>}
      </section>
      {plan?.cancellation.requestedAt && <RefundReview plan={plan} refund={refund} setRefund={setRefund} pending={pending} run={run} cardPayments={capabilities.cardPayments} />}
    </div>
  </section>
}
function RefundReview({ plan, refund, setRefund, pending, run, cardPayments }: { plan: BookingPlanning; refund: { retainedFee: string; reason: string }; setRefund: (value: { retainedFee: string; reason: string }) => void; pending: boolean; run: (action: string, payload: Record<string, unknown>, success: string) => Promise<boolean>; cardPayments: boolean }) {
  const maximum = plan.deposit.planningFeeMaximum ?? 0
  return <section className="interview-panel"><h3>Cancellation and refund</h3><p>{plan.cancellation.feeEligible ? `This cancellation followed the sent menu-interview invitation. You may refund fully or retain up to the disclosed ${money(maximum)} planning fee.` : 'This cancellation preceded the sent menu-interview invitation. The full paid deposit is refundable.'}</p><p className="interview-info">Refund status: {plan.cancellation.refundStatus}{plan.cancellation.refundAmount !== null ? ` · ${money(plan.cancellation.refundAmount)}` : ''}. {cardPayments ? 'Payment-provider confirmation determines when a refund is complete.' : 'Card payments are not connected. This records the refund decision; it does not claim money was returned.'}</p>{plan.cancellation.feeEligible && plan.cancellation.refundStatus !== 'completed' && <><div className="interview-form-grid"><label className="field">Planning fee to retain ($)<input type="number" min={0} max={Math.min(maximum, plan.deposit.paid)} step="0.01" value={refund.retainedFee} onChange={event => setRefund({ ...refund, retainedFee: event.target.value })} disabled={pending} /></label><label className="field">Reason<input value={refund.reason} maxLength={1000} onChange={event => setRefund({ ...refund, reason: event.target.value })} disabled={pending} /></label></div><button type="button" className="button secondary" disabled={pending || refund.reason.trim().length < 3} onClick={() => void run('review_refund', { retainedFee: Number(refund.retainedFee || 0), reason: refund.reason }, 'Refund decision saved.')}>Save refund decision</button></>}</section>
}
