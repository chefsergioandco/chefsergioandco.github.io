import { useEffect, useRef, useState, type FormEvent } from 'react'
import { adminFetch } from './api-client'
import PrivacyExportCollection from './PrivacyExportCollection'
import PrivacyProcessingControls from './PrivacyProcessingControls'
import './PrivacyRequests.css'

type Status = 'pending' | 'in_review' | 'needs_information' | 'completed' | 'declined'
type Review = { id: string; subject: string; email: string; name: string; kind: string; signInAction: string | null; status: Status; revision: number; message: string; responseNote: string; retainedRecordsNote: string; fulfillmentEvidence: string; createdAt: string; updatedAt: string; responseDueAt?: string; extensionReason?: string | null; exportAvailable: boolean; history: { id: string; at: string; actor: string; status: string; message: string; responseNote: string; retainedRecordsNote: string; fulfillmentEvidence: string }[] }
type Listing = { requests: Review[]; pagination: { offset: number; limit: number; hasMore: boolean } }
const names: Record<string, string> = { access_export: 'Personal-data access & export', account_closure: 'Account closure', erasure: 'Personal-data erasure', sign_in_change: 'Sign-in change', rectification:'Correction of personal information',restriction:'Restriction of processing',objection:'Objection to processing',portability:'Data portability',consent_withdrawal:'Withdraw sensitive-information consent' }
const statuses: Record<Status, string> = { pending: 'Received', in_review: 'In review', needs_information: 'Waiting for customer', completed: 'Outcome recorded', declined: 'Not fulfilled' }
const formatDate = (value: string) => new Date(value).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
async function api<T>(path: string, body?: object): Promise<T> {
  const response = await adminFetch(path, { cache: 'no-store', ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Request': '1' }, body: JSON.stringify(body) } : {}) })
  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload) throw new Error(payload?.error?.message || payload?.message || 'Account requests could not be read. Refresh and try again.')
  return payload
}

/** Recording an outcome is an operator attestation; this view never deletes identities or business records. */
export default function PrivacyRequests({ initialRequestId }: { initialRequestId?: string }) {
  const [listing, setListing] = useState<Listing | null>(null), [filter, setFilter] = useState('open'), [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState<string | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState(''), [loading, setLoading] = useState(false), [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Exclude<Status, 'pending'>>('in_review'), [responseNote, setResponseNote] = useState(''), [retained, setRetained] = useState(''), [evidence, setEvidence] = useState(''), [confirmed, setConfirmed] = useState(false)
  const [extensionMonths,setExtensionMonths]=useState(''),[extensionReason,setExtensionReason]=useState(''),[extensionNoticeConfirmed,setExtensionNoticeConfirmed]=useState(false)
  const attempt = useRef<{ payload: string; id: string } | null>(null), sequence = useRef(0), flight = useRef(false)
  const [focusedId, setFocusedId] = useState(initialRequestId || '')
  const openedTarget = useRef('')
  const review = listing?.requests.find(request => request.id === selected)
  async function load() {
    const run = ++sequence.current; setLoading(true); setError('')
    try { const result = await api<Listing>(focusedId ? `/api/customer-privacy?id=${encodeURIComponent(focusedId)}` : `/api/customer-privacy?status=${encodeURIComponent(filter)}&offset=${offset}`); if (run === sequence.current) { if (!Array.isArray(result.requests) || !result.pagination) throw new Error('The request list was incomplete.'); setListing(result); const target=result.requests.find(item=>item.id===focusedId);if(target&&openedTarget.current!==focusedId){openedTarget.current=focusedId;choose(target)} } }
    catch (error) { if (run === sequence.current) setError(error instanceof Error ? error.message : String(error)) }
    finally { if (run === sequence.current) setLoading(false) }
  }
  useEffect(() => { setFocusedId(initialRequestId || ''); openedTarget.current=''; setSelected(null) }, [initialRequestId])
  useEffect(() => { void load(); return () => { ++sequence.current } }, [filter, offset, focusedId])
  useEffect(() => { if(selected)document.getElementById('privacy-review-heading')?.focus({preventScroll:false}) }, [selected])
  function choose(request: Review) { setSelected(request.id); setStatus('in_review'); setResponseNote(''); setRetained(''); setEvidence(''); setConfirmed(false); setNotice(''); setExtensionMonths('');setExtensionReason('');setExtensionNoticeConfirmed(false);attempt.current = null }
  async function save(event: FormEvent) {
    event.preventDefault()
    if (!review || flight.current) return
    const payload = { id: review.id, expectedRevision: review.revision, status, responseNote: responseNote.trim(), retainedRecordsNote: retained.trim(), fulfillmentEvidence: evidence.trim(), fulfillmentConfirmed: confirmed,...(status==='in_review'&&extensionMonths?{extensionMonths:Number(extensionMonths),extensionReason:extensionReason.trim(),extensionNoticeConfirmed}: {}) }
    const fingerprint = JSON.stringify(payload)
    if (attempt.current?.payload !== fingerprint) attempt.current = { payload: fingerprint, id: crypto.randomUUID() }
    flight.current = true; setBusy(true); setError(''); setNotice('')
    try {
      const result = await api<{ request: Review }>('/api/customer-privacy/action', { ...payload, requestId: attempt.current.id })
      if (result.request?.id !== review.id || result.request.status !== status || result.request.revision !== review.revision + 1) throw new Error('The saved outcome could not be confirmed. Retry to recover the same action.')
      attempt.current = null; setNotice('The review update is saved and visible in the customer’s settings.'); setSelected(null); await load()
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { flight.current = false; setBusy(false) }
  }
  const terminal = review?.status === 'completed' || review?.status === 'declined'
  const completed = status === 'completed', final = completed || status === 'declined'
  return <section className="admin-privacy" aria-labelledby="admin-privacy-heading">
    <header><h2 id="admin-privacy-heading">Account &amp; privacy requests</h2><p>Review customer requests, arrange identity checks or fulfillment, and record the actual outcome. Customers follow these updates in Settings &amp; profile.</p></header>
    <p className="admin-privacy-notice">Use processing controls and reviewed retention pages for actual local changes. Source collection reads authoritative provider records. Provider deletion and Google changes need their own verified lifecycle. Recording an outcome is separate from performing the work; bookings are not cancelled here. Never enter passwords, tokens or private sign-in links.</p>
    {focusedId&&<p className="admin-privacy-notice">Opened the request linked from Service operations. <button type="button" className="button secondary" disabled={busy} onClick={()=>{setFocusedId('');setSelected(null);setOffset(0);setFilter('open')}}>Show all requests</button></p>}
    <div className="admin-privacy-toolbar"><label>Show<select value={filter} disabled={busy} onChange={event => { setFilter(event.target.value); setOffset(0); setSelected(null) }}><option value="open">Open requests</option><option value="all">All requests</option>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><button className="button secondary" type="button" disabled={loading || busy} onClick={() => void load()}>{loading ? 'Refreshing…' : 'Refresh requests'}</button></div>
    {error && <p className="admin-privacy-error" role="alert">{error} Your unsaved notes remain here. Refresh if another operator changed the request.</p>}
    {notice && <p role="status" className="admin-privacy-notice">{notice}</p>}
    {!listing ? <p role="status">{loading ? 'Opening requests…' : 'Use Refresh requests to try again.'}</p> : <>
      <ul className="admin-privacy-list">{listing.requests.map(request => <li key={request.id}><button type="button" aria-expanded={selected === request.id} disabled={busy} onClick={() => choose(request)}><span><strong>{request.signInAction === 'disconnect_google' ? 'Google sign-in change' : names[request.kind] || request.kind}</strong><span>{request.name || request.email} · {request.email}</span><small>{formatDate(request.createdAt)} · {request.id}</small>{request.responseDueAt && <small>Response due {formatDate(request.responseDueAt)}{Date.parse(request.responseDueAt) < Date.now() && !['completed','declined'].includes(request.status) ? ' · OVERDUE — act now' : ''}</small>}</span><span>{statuses[request.status]}</span></button></li>)}</ul>
      {!listing.requests.length && <p>No requests match this view.</p>}
      <div className="admin-privacy-pages"><button className="button secondary" disabled={loading || busy || offset === 0} onClick={() => { setOffset(Math.max(0, offset - listing.pagination.limit)); setSelected(null) }}>Previous page</button><button className="button secondary" disabled={loading || busy || !listing.pagination.hasMore} onClick={() => { setOffset(offset + listing.pagination.limit); setSelected(null) }}>Next page</button></div>
    </>}
    {review && <section className="admin-privacy-review" aria-labelledby="privacy-review-heading"><h3 id="privacy-review-heading" tabIndex={-1}>{review.name || review.email}: {names[review.kind]}</h3><p className="admin-privacy-message">{review.message || 'No additional message.'}</p>
      <PrivacyProcessingControls key={review.id} request={review}/>
      {review.signInAction === 'disconnect_google' && <p className="admin-privacy-notice">Before any Google change: establish a verified usable alternative, arrange appropriate reauthentication, preserve the owning account and booking links, check active-session behavior, then verify provider identities and sign-in independently. Matching email addresses alone do not authorize linking accounts.</p>}
      {review.kind === 'erasure' && <p className="admin-privacy-notice">Review all relevant stores and processors, including communications and payment snapshots, reviews, referrals, gifts, capability links and backups. Identify retention reasons and record the actual scope. Deleting a profile row alone does not erase this person’s information.</p>}
      {review.responseDueAt && <p className="admin-privacy-notice">Response due {formatDate(review.responseDueAt)}. Asking for information does not restart the clock. A lawful extension needs reasons and notice within the original month. Record any refusal with its reasons and the customer’s complaint and judicial-remedy rights.</p>}
      {['access_export','portability'].includes(review.kind) && !terminal && <PrivacyExportCollection key={review.id} request={review} onUpdated={() => void load()}/>}
      {['rectification','restriction','objection'].includes(review.kind) && <p className="admin-privacy-notice">Apply the requested right in every relevant system before recording completion. For restriction, prevent the restricted uses in operational tools and inform relevant recipients; keep only permitted processing. For a correction, notify recipients where required. For an objection, stop direct marketing or document the applicable assessment. Saving this response does not make those changes.</p>}
      <details><summary>Request history</summary><ol>{review.history.map(event => <li key={event.id}><p>{formatDate(event.at)} · {event.actor} · {statuses[event.status as Status] || event.status}</p>{event.message && <p className="admin-privacy-message">{event.message}</p>}{event.responseNote && <p className="admin-privacy-message">{event.responseNote}</p>}{event.retainedRecordsNote && <p className="admin-privacy-message">{event.retainedRecordsNote}</p>}{event.fulfillmentEvidence && <p className="admin-privacy-message">{event.fulfillmentEvidence}</p>}</li>)}</ol></details>
      {terminal ? <p className="admin-privacy-notice">This outcome is recorded. Further work needs a new request so this history remains intact.</p> : <form onSubmit={event => void save(event)}>
        <label>Review status<select value={status} disabled={busy} onChange={event => { setStatus(event.target.value as Exclude<Status, 'pending'>); setConfirmed(false) }}><option value="in_review">In review</option><option value="needs_information">Ask customer for information</option><option value="completed" disabled={review.status !== 'in_review'}>Record completed work</option><option value="declined">Explain why the request is not fulfilled</option></select></label>
        <label>Response to the customer<textarea rows={4} maxLength={3000} required={status !== 'in_review'} minLength={status !== 'in_review' ? 10 : undefined} value={responseNote} onChange={event => setResponseNote(event.target.value)} disabled={busy}/></label>
        <label>Records retained and why<textarea rows={3} maxLength={3000} required={final} minLength={final ? 10 : undefined} value={retained} onChange={event => setRetained(event.target.value)} disabled={busy}/></label>
        <label>Fulfillment evidence and actual scope <span>(customer-visible)</span><textarea rows={3} maxLength={3000} required={completed} minLength={completed ? 20 : undefined} value={evidence} onChange={event => setEvidence(event.target.value)} disabled={busy}/></label>
        {status==='in_review'&&!review.extensionReason&&<details><summary>Record a necessary lawful extension</summary><p>Use only for complexity or number of requests. Notify the customer with reasons within the original month before recording it here. Asking for information does not itself extend the deadline.</p><label>Additional time<select value={extensionMonths} disabled={busy} onChange={event=>{setExtensionMonths(event.target.value);setExtensionNoticeConfirmed(false)}}><option value="">Keep the original deadline</option><option value="1">One additional calendar month</option><option value="2">Two additional calendar months</option></select></label>{extensionMonths&&<><label>Complexity or number reasons, and notification evidence<textarea value={extensionReason} onChange={event=>setExtensionReason(event.target.value)} minLength={20} maxLength={3000} required disabled={busy}/></label><label className="admin-privacy-confirm"><input type="checkbox" checked={extensionNoticeConfirmed} onChange={event=>setExtensionNoticeConfirmed(event.target.checked)} required disabled={busy}/><span>I sent the customer the extension, its reasons and new deadline within the original month. This note is customer-visible.</span></label></>}</details>}
        <p>Describe the checks and work completed in plain language. Keep secrets, internal provider IDs and information about other people out of all three fields. Do not invent retention periods.</p>
        {completed && <label className="admin-privacy-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={busy} required/><span>I verified the work described above. I am recording its actual scope and retained records; saving this response does not itself perform deletion or change a sign-in method.</span></label>}
        <button className="button" disabled={busy || completed && !confirmed}>{busy ? 'Saving review…' : 'Save review update'}</button>
      </form>}
    </section>}
  </section>
}
