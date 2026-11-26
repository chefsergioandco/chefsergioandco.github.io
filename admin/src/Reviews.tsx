import { useEffect, useState } from 'react'
import { adminFetch } from './api-client'
import './Reviews.css'

type AdminReview = { id: string; bookingId: string; guest: string | null; bookingStatus: string | null; quote: string; name: string; service: string; month: string; status: 'published' | 'hidden'; createdAt: string; updatedAt: string; hiddenAt: string | null; hiddenBy: string | null }

async function api<T>(path: string, body?: object): Promise<T> {
  const response = await adminFetch(path, { credentials: 'same-origin', cache: 'no-store', ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Request': '1' }, body: JSON.stringify(body) } : {}) })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(typeof payload?.error?.message === 'string' ? payload.error.message : typeof payload?.message === 'string' ? payload.message : 'Reviews could not be opened. Please try again.')
  if (!payload) throw new Error('The server returned an unreadable response. Please refresh and try again.')
  return payload as T
}
const monthYear = (month: string) => /^\d{4}-\d{2}$/.test(month) ? new Date(month + '-15T12:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : month
const shortDate = (value: string) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const service = (value: string) => value === 'Sergio’s Table' ? 'Sergio’s table' : value

/** Client reviews publish themselves; Sergio can hide one from the homepage, and restore it later. Nothing is deleted. */
export default function Reviews() {
  const [reviews, setReviews] = useState<AdminReview[] | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState('')
  const load = async () => { setError(''); try { setReviews((await api<{ reviews: AdminReview[] }>('/api/reviews/manage')).reviews) } catch (value) { setError(value instanceof Error ? value.message : String(value)) } }
  useEffect(() => { void load() }, [])
  async function toggle(review: AdminReview) {
    setBusy(review.id); setError('')
    try { await api('/api/reviews/manage/action', { id: review.id, action: review.status === 'published' ? 'hide' : 'restore' }); await load() }
    catch (value) { setError(value instanceof Error ? value.message : String(value)) } finally { setBusy('') }
  }
  const shown = reviews?.filter(review => review.status === 'published' && review.bookingStatus === 'confirmed').length ?? 0
  return <section className="admin-reviews" aria-label="Client reviews">
    <p className="admin-reviews-intro">Clients write these from their accounts after a confirmed evening. They appear on the homepage straight away. Hide any you don’t want shown; the client keeps their words and can still edit them, but an edit never brings a hidden review back.</p>
    {error && <p className="admin-reviews-error" role="alert">{error} <button className="button secondary" type="button" onClick={() => void load()}>Try again</button></p>}
    {!reviews ? !error && <p role="status">Opening reviews…</p> : !reviews.length ? <p className="admin-reviews-empty">No reviews yet. When a client reviews their evening, it will appear here and on the homepage.</p> : <>
      <p className="admin-reviews-count">{shown} of {reviews.length} shown on the homepage</p>
      <ol className="admin-reviews-list">{reviews.map(review => {
        const visible = review.status === 'published' && review.bookingStatus === 'confirmed'
        return <li key={review.id} className="admin-review" data-visible={visible}>
          <blockquote>“{review.quote}”</blockquote>
          <p className="admin-review-by">— {review.name} · {service(review.service)}, {monthYear(review.month)}</p>
          <p className="admin-review-meta">{review.guest ?? 'Booking removed'} · {review.bookingId} · written {shortDate(review.createdAt)}{review.updatedAt !== review.createdAt ? `, edited ${shortDate(review.updatedAt)}` : ''}</p>
          <div className="admin-review-actions">
            <span className="admin-review-status">{visible ? 'On the homepage' : review.status === 'hidden' ? `Hidden${review.hiddenAt ? ' ' + shortDate(review.hiddenAt) : ''}` : 'Not shown: the booking is no longer confirmed'}</span>
            <button className="button secondary" type="button" disabled={!!busy} onClick={() => void toggle(review)}>{busy === review.id ? 'Saving…' : review.status === 'published' ? 'Hide from homepage' : 'Show on homepage'}</button>
          </div>
        </li>
      })}</ol>
    </>}
  </section>
}
