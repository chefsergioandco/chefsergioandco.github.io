import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { booking } from '../content/booking'
import './InvitationResponse.css'

export type InvitationResponseProps = {
  invitationId: string
  accessToken: string
  /** Invitation revision, distinct from the guest's own response revision. */
  invitationVersion: number
}
type Answers = { name: string; email: string; attending: 'yes' | 'no'; dietary: string; allergies: string }
type OwnResponse = Answers & { revision: number }
type InvitationRead = { id: string; version: number; ownResponse?: OwnResponse }
type ResponseAccess = { token: string; version: number }
class InvitationResponseError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}
const emptyAnswers = (): Answers => ({ name: '', email: '', attending: 'yes', dietary: '', allergies: '' })
const validRevision = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0
const validToken = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
function validOwnResponse(value: unknown): value is OwnResponse {
  if (!value || typeof value !== 'object') return false
  const response = value as OwnResponse
  return ['name', 'email', 'dietary', 'allergies'].every(key => typeof response[key as keyof Answers] === 'string') && ['yes', 'no'].includes(response.attending) && validRevision(response.revision)
}
async function invitationCall<T>(path: '/api/invitation' | '/api/invitation/rsvp', body: object, signal: AbortSignal): Promise<T> {
  const base = booking.apiBase?.replace(/\/$/, '')
  if (!base) throw new InvitationResponseError('This invitation is temporarily unavailable. Please contact your host.', 503)
  const controller = new AbortController(), abort = () => controller.abort()
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) controller.abort()
  const timer = setTimeout(abort, 20_000)
  try {
    const response = await fetch(base + path, { method: 'POST', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal, headers: { 'Content-Type': 'application/json', 'X-Booking-Request': '1' }, body: JSON.stringify(body) })
    const value = await response.json().catch(() => null)
    if (!response.ok || !value) throw new InvitationResponseError(value?.error?.message || value?.message || 'Your response could not be confirmed. Please retry or contact your host.', response.status)
    return value as T
  } catch (error) {
    if (error instanceof InvitationResponseError) throw error
    throw new InvitationResponseError('Your response could not be confirmed. Please retry or contact your host.', 0)
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort) }
}

/** The guest capability grants this form access to one invitation and their own response. */
export function InvitationResponse(props: InvitationResponseProps) {
  return <PrivateResponse key={props.invitationId + ':' + props.accessToken} {...props}/>
}

function PrivateResponse({ invitationId, accessToken, invitationVersion }: InvitationResponseProps) {
  const id = useId(), nameInput = useRef<HTMLInputElement>(null), emailInput = useRef<HTMLInputElement>(null)
  const feedback = useRef<HTMLParagraphElement>(null), failure = useRef<HTMLParagraphElement>(null)
  const [answers, setAnswers] = useState<Answers>(emptyAnswers)
  const [loading, setLoading] = useState(true), [ready, setReady] = useState(false), [retry, setRetry] = useState(0)
  const [sending, setSending] = useState(false), [saved, setSaved] = useState(false), [hasResponse, setHasResponse] = useState(false)
  const [error, setError] = useState(''), [errorField, setErrorField] = useState<'name' | 'email' | null>(null), [conflict, setConflict] = useState(false)
  const access = useRef<ResponseAccess | null>(null), attempt = useRef<{ body: string; id: string } | null>(null)
  const active = useRef(false), submission = useRef<AbortController | null>(null), storageKey = 'invitation-response:' + invitationId
  useEffect(() => { active.current = true; return () => { active.current = false; submission.current?.abort() } }, [])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setReady(false); setSaved(false); setError(''); setErrorField(null); setConflict(false)
    if (!invitationId || !accessToken || !validRevision(invitationVersion)) {
      setError('Open the complete private invitation link shared by your host.'); setLoading(false)
      return () => controller.abort()
    }
    if (!access.current) {
      try {
        const stored = JSON.parse(sessionStorage.getItem(storageKey) || 'null')
        if (validToken(stored?.token) && validRevision(stored?.version)) access.current = { token: stored.token, version: stored.version }
      } catch { /* This page can still retain response access when storage is unavailable. */ }
    }
    const proof = { id: invitationId, accessToken, ...(access.current ? { responseToken: access.current.token } : {}) }
    // This existing read operation is POST. Invitation version is never an RSVP revision.
    void invitationCall<InvitationRead>('/api/invitation', proof, controller.signal).then(value => {
      if (controller.signal.aborted) return
      if (value.id !== invitationId || !validRevision(value.version)) throw new Error('The invitation response could not be verified. Please contact your host.')
      if (access.current && !validOwnResponse(value.ownResponse)) throw new Error('Your saved response could not be verified. Please contact your host before sending another response.')
      if (value.ownResponse) {
        if (!access.current || !validOwnResponse(value.ownResponse)) throw new Error('Your saved response could not be verified. Please contact your host.')
        const own = value.ownResponse
        setAnswers({ name: own.name, email: own.email, attending: own.attending, dietary: own.dietary, allergies: own.allergies })
        access.current = { token: access.current.token, version: own.revision }
        try { sessionStorage.setItem(storageKey, JSON.stringify(access.current)) } catch { /* Keep only the same-page capability in memory. */ }
        setHasResponse(true)
      } else { setAnswers(emptyAnswers()); setHasResponse(false) }
      attempt.current = null; setReady(true)
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Your invitation response could not be opened. Please retry.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [invitationId, accessToken, invitationVersion, retry, storageKey])
  function change<K extends keyof Answers>(key: K, value: Answers[K]) {
    setAnswers(current => ({ ...current, [key]: value })); setSaved(false); setError(''); setErrorField(null)
  }
  function validation(message: string, field: 'name' | 'email') {
    setError(message); setErrorField(field); (field === 'name' ? nameInput : emailInput).current?.focus()
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sending || !ready) return
    if (answers.name.trim().length < 2) { validation('Enter your name so Sergio knows who is responding.', 'name'); return }
    if (answers.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(answers.email.trim())) { validation('Enter a valid email address, or leave this optional field blank.', 'email'); return }
    const payload = { id: invitationId, accessToken, name: answers.name.trim(), email: answers.email.trim(), attending: answers.attending, dietary: answers.dietary.trim(), allergies: answers.allergies.trim(), ...(access.current ? { responseToken: access.current.token, version: access.current.version } : {}) }
    const body = JSON.stringify(payload)
    if (attempt.current?.body !== body) attempt.current = { body, id: crypto.randomUUID() }
    const controller = new AbortController(); submission.current = controller
    setSending(true); setSaved(false); setError(''); setErrorField(null); setConflict(false)
    try {
      const result = await invitationCall<{ ok: boolean; responseToken: string; version: number }>('/api/invitation/rsvp', { ...payload, requestId: attempt.current.id }, controller.signal)
      if (controller.signal.aborted || !active.current) return
      if (result.ok !== true || !validToken(result.responseToken) || !validRevision(result.version)) throw new Error('Your response could not be confirmed. Retry to recover the same response.')
      access.current = { token: result.responseToken, version: result.version }
      try { sessionStorage.setItem(storageKey, JSON.stringify(access.current)) } catch { /* Response access remains in memory for this page. */ }
      attempt.current = null; setHasResponse(true); setSaved(true)
      requestAnimationFrame(() => feedback.current?.focus())
    } catch (cause) {
      if (!controller.signal.aborted && active.current) {
        setError(cause instanceof Error ? cause.message : 'Your response could not be confirmed. Please retry.')
        setConflict(cause instanceof InvitationResponseError && cause.status === 409 && !!access.current)
        requestAnimationFrame(() => failure.current?.focus())
      }
    } finally { if (!controller.signal.aborted && active.current) setSending(false) }
  }
  return <section className="invitation-response" aria-labelledby={id + '-heading'}>
    <h3 id={id + '-heading'}>Will you join us?</h3>
    <p id={id + '-privacy'}>Your response goes privately to Sergio. Other guests cannot see your contact details, dietary needs or allergies.</p>
    {loading ? <p role="status">Opening your response…</p> : !ready ? <div className="invitation-response-unavailable"><p role="alert">{error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>Try again</button></div> : <form onSubmit={submit} noValidate aria-describedby={id + '-privacy'} aria-busy={sending}>
      <fieldset disabled={sending}><legend>Your RSVP</legend><label className="invitation-response-choice"><input type="radio" name={id + '-attendance'} value="yes" checked={answers.attending === 'yes'} onChange={() => change('attending', 'yes')}/>I’ll be there</label><label className="invitation-response-choice"><input type="radio" name={id + '-attendance'} value="no" checked={answers.attending === 'no'} onChange={() => change('attending', 'no')}/>I can’t make it</label></fieldset>
      <label className="invitation-response-field" htmlFor={id + '-name'}>Your name<input ref={nameInput} id={id + '-name'} value={answers.name} onChange={event => change('name', event.target.value)} autoComplete="name" maxLength={150} required minLength={2} disabled={sending} aria-invalid={errorField === 'name' || undefined} aria-describedby={errorField === 'name' ? id + '-error' : undefined}/></label>
      <label className="invitation-response-field" htmlFor={id + '-email'}>Email <span>(optional)</span><input ref={emailInput} id={id + '-email'} type="email" value={answers.email} onChange={event => change('email', event.target.value)} autoComplete="email" maxLength={254} disabled={sending} aria-invalid={errorField === 'email' || undefined} aria-describedby={errorField === 'email' ? id + '-error' : undefined}/></label>
      {answers.attending === 'yes' && <><label className="invitation-response-field" htmlFor={id + '-dietary'}>Dietary needs <span>(optional)</span><textarea id={id + '-dietary'} value={answers.dietary} onChange={event => change('dietary', event.target.value)} rows={3} maxLength={2000} disabled={sending}/></label><label className="invitation-response-field" htmlFor={id + '-allergies'}>Allergies <span>(optional)</span><textarea id={id + '-allergies'} value={answers.allergies} onChange={event => change('allergies', event.target.value)} rows={3} maxLength={2000} disabled={sending} aria-describedby={id + '-accommodation'}/></label><p className="invitation-response-note" id={id + '-accommodation'}>Sergio will review accommodation with you. Submitting a requirement does not confirm it can be accommodated.</p></>}
      {error && <p ref={failure} id={id + '-error'} tabIndex={-1} role="alert" className="invitation-response-error">{error}</p>}
      {conflict && <div className="invitation-response-conflict"><p>Reloading replaces your unsaved answers with your latest saved response. Review it before updating.</p><button type="button" disabled={sending} onClick={() => setRetry(value => value + 1)}>Reload my saved response</button></div>}
      {saved && <p ref={feedback} tabIndex={-1} role="status" className="invitation-response-saved">Your response is saved. You can update it from this page.</p>}
      <button type="submit" disabled={sending} className="invitation-response-submit">{sending ? 'Saving…' : hasResponse ? 'Update my response' : 'Send my response'}</button>
    </form>}
  </section>
}

export default InvitationResponse
