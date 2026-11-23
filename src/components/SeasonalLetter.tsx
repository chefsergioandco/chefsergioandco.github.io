import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { accountConfig } from '../account/config'
import './SeasonalLetter.css'

const NEWSLETTER_ORIGIN = accountConfig.apiOrigin
type PublicStatus = { available: boolean; consentVersion: string; consentText: string; message: string; operatorOnly?: boolean }
type SignupState = 'idle' | 'sending' | 'accepted' | 'error'
const PAUSED_MESSAGE = 'The letter is taking shape. Signup is paused for now; please check back.'
const CONFIRMATION_MESSAGE = 'If this address can be subscribed, you’ll receive an email to confirm. You’re only added after you confirm.'

/** A separate, explicit invitation; making a booking never subscribes a guest. */
export function SeasonalLetter() {
  const id = useId()
  const section = useRef<HTMLElement>(null)
  const request = useRef<{ email: string; consentVersion: string; id: string } | null>(null)
  const [status, setStatus] = useState<PublicStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const [availabilityError, setAvailabilityError] = useState(false)
  const [checkAttempt, setCheckAttempt] = useState(0)
  const [email, setEmail] = useState('')
  const [consent, setConsent] = useState(false)
  const [honeypot, setHoneypot] = useState('')
  const [signup, setSignup] = useState<SignupState>('idle')
  const [feedback, setFeedback] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const check = async () => {
      setChecking(true)
      setAvailabilityError(false)
      timer = setTimeout(() => controller.abort(), 10000)
      try {
        const response = await fetch(`${NEWSLETTER_ORIGIN}/api/newsletter/status`, { credentials: 'omit', signal: controller.signal })
        const value: unknown = await response.json()
        if (!response.ok || !value || typeof value !== 'object') throw new Error('status_unavailable')
        const result = value as Partial<PublicStatus>
        if (typeof result.available !== 'boolean' || typeof result.message !== 'string' || typeof result.consentVersion !== 'string' || typeof result.consentText !== 'string' || (result.available && (!result.consentVersion || !result.consentText))) throw new Error('status_invalid')
        if (!disposed) setStatus(result as PublicStatus)
      } catch {
        if (!disposed) { setStatus(null); setAvailabilityError(true) }
      } finally {
        clearTimeout(timer)
        if (!disposed) setChecking(false)
      }
    }
    const observer = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer?.disconnect(); void check() }
    }, { rootMargin: '320px' }) : null
    if (observer && section.current) observer.observe(section.current)
    else void check()
    return () => { disposed = true; observer?.disconnect(); clearTimeout(timer); controller.abort() }
  }, [checkAttempt])

  async function subscribe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!status?.available || !consent || signup === 'sending' || signup === 'accepted') return
    const address = email.trim()
    if (!request.current || request.current.email !== address || request.current.consentVersion !== status.consentVersion) request.current = { email: address, consentVersion: status.consentVersion, id: crypto.randomUUID() }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    setSignup('sending')
    setFeedback('')
    try {
      const response = await fetch(`${NEWSLETTER_ORIGIN}/api/newsletter/subscribe`, {
        method: 'POST', credentials: 'omit', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: address, consent: true, consentVersion: status.consentVersion, requestId: request.current.id, honeypot }),
      })
      if (!response.ok) {
        if (response.status === 403 && status.operatorOnly === true) throw new Error('This staging signup accepts only the configured operator inbox.')
        if (response.status === 429) throw new Error('Please give it a little time before trying again.')
        if (response.status === 503) {
          setStatus({ ...status, available: false, message: PAUSED_MESSAGE })
          throw new Error(PAUSED_MESSAGE)
        }
        if (response.status === 409) {
          request.current = null
          setCheckAttempt(attempt => attempt + 1)
          setConsent(false)
          throw new Error('The signup details have changed. Please review the invitation and try again.')
        }
        throw new Error('We couldn’t confirm your request. Please try again in a moment.')
      }
      setSignup('accepted')
      setFeedback(CONFIRMATION_MESSAGE)
      setEmail('')
    } catch (error) {
      setSignup('error')
      setFeedback(error instanceof Error && error.name !== 'AbortError' && error.name !== 'TypeError' ? error.message : 'We couldn’t confirm your request. Please try again in a moment.')
    } finally { clearTimeout(timer) }
  }

  const available = status?.available === true
  const locked = !available || signup === 'sending' || signup === 'accepted'
  const availability = checking ? 'Checking signup availability…' : availabilityError ? 'We can’t check signup right now. Please try again.' : status?.message || PAUSED_MESSAGE

  return (
    <section ref={section} className="seasonal-letter" aria-labelledby={`${id}-title`} data-newsletter-state={signup === 'accepted' ? 'accepted' : available ? 'available' : 'paused'}>
      <div className="seasonal-letter-copy">
        <p className="seasonal-letter-eyebrow">From my kitchen to yours</p>
        <h2 id={`${id}-title`}>A seasonal letter<br /> from Sergio.</h2>
        <p>What I’m cooking, one useful idea for your own kitchen, and the occasional invitation to gather.</p>
        <p className="seasonal-letter-frequency">{status?.operatorOnly === true ? 'Staging preview. Operator inbox only.' : 'A few times a year. Always personal.'}</p>
      </div>
      <div className="seasonal-letter-signup">
        <form onSubmit={subscribe} aria-busy={signup === 'sending'} aria-describedby={`${id}-privacy ${id}-status`}>
          <label className="seasonal-letter-label" htmlFor={`${id}-email`}>Your email address</label>
          <div className="seasonal-letter-fields">
            <input id={`${id}-email`} name="email" type="email" autoComplete="email" inputMode="email" maxLength={254} required disabled={locked} value={email} onChange={event => { setEmail(event.target.value); if (signup === 'error') { setSignup('idle'); setFeedback('') } }} />
            <button className="seasonal-letter-submit" type="submit" disabled={locked || !consent}>{signup === 'sending' ? 'Requesting…' : signup === 'accepted' ? 'Request received' : checking ? 'Checking…' : available ? 'Join the letter' : 'Signup paused'}<span aria-hidden="true">↗</span></button>
          </div>
          <div className="seasonal-letter-honeypot" aria-hidden="true">
            <label htmlFor={`${id}-website`}>Leave this field empty</label>
            <input id={`${id}-website`} name="website" type="text" tabIndex={-1} autoComplete="off" value={honeypot} onChange={event => setHoneypot(event.target.value)} />
          </div>
          <label className="seasonal-letter-consent">
            <input name="consent" type="checkbox" required disabled={locked} checked={consent} onChange={event => setConsent(event.target.checked)} />
            <span>{status?.consentText || 'I’d like to receive Sergio’s seasonal letter. I can unsubscribe at any time.'}</span>
          </label>
          <p id={`${id}-privacy`} className="seasonal-letter-privacy">Your address is used for this letter. Booking with Sergio never signs you up. No account needed.</p>
          <p id={`${id}-status`} className="seasonal-letter-status" role="status" aria-live="polite" aria-atomic="true">{feedback || availability}</p>
          {availabilityError && <button className="seasonal-letter-retry" type="button" onClick={() => setCheckAttempt(attempt => attempt + 1)} disabled={checking}>Check again</button>}
          <noscript><p className="seasonal-letter-privacy">Please enable JavaScript to check whether signup is available.</p></noscript>
        </form>
      </div>
    </section>
  )
}
