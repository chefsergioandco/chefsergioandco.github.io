import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { accountApi, AccountApiError } from './api'

type Review = { id: string; quote: string; displayName: string; status: 'published' | 'hidden'; createdAt: string; updatedAt: string }
type ReviewEvening = { bookingId: string; service: string; date: string; eligible: boolean; reason: 'ready' | 'upcoming' | 'not_confirmed'; review: Review | null }
type ReviewsPayload = { evenings: ReviewEvening[]; suggestedName: string; consent: { version: string; text: string } }

const QUOTE_MIN = 20, QUOTE_MAX = 600
const serviceLabel = (service: string) => service === 'Sergio’s Table' ? 'Sergio’s table' : service
const longDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(value + 'T12:00:00Z')) : 'Date to be agreed'
const monthYear = (value: string) => /^\d{4}-\d{2}/.test(value) ? new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(value.slice(0, 7) + '-15T12:00:00Z')) : ''
const failure = (value: unknown) => value instanceof AccountApiError || value instanceof Error ? value.message : 'Your review could not be saved. Please try again.'

/** Reviews written here appear on the homepage straight away, with the name the guest chooses to show. */
export function CustomerReviews({ focusBooking }: { focusBooking?: string }) {
  const [data, setData] = useState<ReviewsPayload | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true)
  const load = async () => {
    setLoading(true); setError('')
    try { setData(await accountApi<ReviewsPayload>('/customer/reviews')) } catch (value) { setError(failure(value)) } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])
  const evenings = data?.evenings ?? []
  const ready = evenings.filter(evening => evening.eligible), upcoming = evenings.filter(evening => evening.reason === 'upcoming')
  return <section className="ev-panel ev-reviews">
    <h1 tabIndex={-1}>Your reviews.</h1>
    <p className="ev-intro">Tell others what your evening with Sergio was like. Reviews appear on the homepage as soon as you post them, with the name you choose.</p>
    {error && <div className="notice error" role="alert">{error} <button className="ev-text-button" disabled={loading} onClick={() => void load()}>Try again</button></div>}
    {loading && !data ? <p className="ev-note" role="status">Opening your evenings…</p> : data && <>
      {ready.map(evening => <ReviewCard key={evening.bookingId} evening={evening} suggestedName={data.suggestedName} consent={data.consent.text} autoFocus={evening.bookingId === focusBooking} onSaved={review => setData(current => current && { ...current, evenings: current.evenings.map(item => item.bookingId === evening.bookingId ? { ...item, review } : item) })}/>)}
      {upcoming.length > 0 && <section className="ev-history"><h2>After your evening</h2>{upcoming.map(evening => <article key={evening.bookingId} className="ev-review-upcoming"><h3>{serviceLabel(evening.service)}</h3><p className="ev-note">{longDate(evening.date)}. You can review it once it has taken place.</p></article>)}</section>}
      {!ready.length && !upcoming.length && <p className="ev-note">Once Sergio has cooked for you, your evening will appear here to review. If you booked before making your account, link the booking from <a href="?">Your evenings</a>.</p>}
    </>}
  </section>
}

function ReviewCard({ evening, suggestedName, consent, autoFocus, onSaved }: { evening: ReviewEvening; suggestedName: string; consent: string; autoFocus: boolean; onSaved: (review: Review | null) => void }) {
  const id = useId(), review = evening.review
  const [editing, setEditing] = useState(!review), [quote, setQuote] = useState(review?.quote ?? ''), [name, setName] = useState(review?.displayName ?? suggestedName)
  const [agreed, setAgreed] = useState(!!review), [busy, setBusy] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState('')
  const field = useRef<HTMLTextAreaElement>(null), card = useRef<HTMLElement>(null)
  useEffect(() => { if (autoFocus) { card.current?.scrollIntoView({ block: 'start' }); if (!review) field.current?.focus({ preventScroll: true }) } }, [autoFocus])
  const length = quote.replace(/\s+/g, ' ').trim().length
  async function save(event: FormEvent) {
    event.preventDefault(); setError(''); setMessage('')
    if (length < QUOTE_MIN) { setError(`Write at least ${QUOTE_MIN} characters about your evening.`); field.current?.focus(); return }
    if (!agreed) { setError('Agree to show your review on the website before posting it.'); document.getElementById(id + '-consent')?.focus(); return }
    setBusy('save')
    try {
      const result = await accountApi<{ review: Review }>('/customer/reviews/save', { bookingId: evening.bookingId, quote, displayName: name, consent: true })
      onSaved(result.review); setEditing(false)
      setMessage(result.review.status === 'published' ? (review ? 'Your review is updated on the homepage.' : 'Thank you. Your review is on the homepage now.') : 'Your review is saved.')
    } catch (value) { setError(failure(value)) } finally { setBusy('') }
  }
  async function withdraw() {
    if (!confirm('Remove your review from the website? You can write a new one later.')) return
    setBusy('withdraw'); setError(''); setMessage('')
    try { await accountApi('/customer/reviews/withdraw', { bookingId: evening.bookingId }); onSaved(null); setQuote(''); setAgreed(false); setEditing(true); setMessage('Your review is removed from the website.') }
    catch (value) { setError(failure(value)) } finally { setBusy('') }
  }
  return <article ref={card} className="ev-review" aria-labelledby={id + '-title'}>
    <p className="ev-eyebrow">{longDate(evening.date)}</p>
    <h2 id={id + '-title'}>{serviceLabel(evening.service)}</h2>
    {message && <p className="ev-message" role="status">{message}</p>}
    {review && !editing ? <>
      <blockquote className="ev-review-quote">“{review.quote}”</blockquote>
      <p className="ev-note">— {review.displayName} · {review.status === 'published' ? 'Shown on the homepage' : 'Sergio has hidden this review from the homepage. Your words are kept here.'}</p>
      <div className="ev-actions"><button className="ev-text-button" type="button" disabled={!!busy} onClick={() => { setEditing(true); setTimeout(() => field.current?.focus()) }}>Edit review</button><button className="ev-text-button" type="button" disabled={!!busy} onClick={() => void withdraw()}>{busy === 'withdraw' ? 'Removing…' : 'Remove review'}</button></div>
    </> : <form className="ev-form" onSubmit={save} noValidate>
      <label>Your review
        <textarea ref={field} value={quote} onChange={event => setQuote(event.target.value)} rows={4} maxLength={QUOTE_MAX} aria-describedby={id + '-count'} placeholder="What made the evening for you and your guests?" disabled={!!busy}/>
      </label>
      <p id={id + '-count'} className="ev-note">{length < QUOTE_MIN ? `At least ${QUOTE_MIN} characters` : `${QUOTE_MAX - quote.length} characters left`}. Plain words only: no links or email addresses.</p>
      <label>Show my name as
        <input value={name} onChange={event => setName(event.target.value)} maxLength={60} autoComplete="off" aria-describedby={id + '-name-help'} disabled={!!busy}/>
      </label>
      <p id={id + '-name-help'} className="ev-note">For example, your first name and last initial. Shown with “{serviceLabel(evening.service)}, {monthYear(evening.date)}” and a mark that it came from a client account.</p>
      <label className="ev-check"><input id={id + '-consent'} type="checkbox" checked={agreed} onChange={event => setAgreed(event.target.checked)} disabled={!!busy}/><span>{consent}</span></label>
      {error && <p className="ev-error" role="alert">{error}</p>}
      <div className="ev-actions"><button className="ev-primary" type="submit" disabled={!!busy}>{busy === 'save' ? 'Posting…' : review ? 'Update review' : 'Post review'}</button>{review && <button className="ev-text-button" type="button" disabled={!!busy} onClick={() => { setEditing(false); setQuote(review.quote); setName(review.displayName); setError('') }}>Cancel</button>}</div>
    </form>}
  </article>
}
