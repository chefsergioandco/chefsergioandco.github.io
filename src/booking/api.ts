import { booking } from '../content/booking'
import { BookingError, type BookingReceipt, type DetailsReceipt, type PublicBookingApi, type PublicHoldResult, type PlanningConfig } from './types'
import { isDetailsResult } from './details-result'

// A failed or missing live service never creates a browser-only booking.
export const IS_MOCK = false
const attempts = new Map<string, string>()
function serviceBase() {
  const base = booking.apiBase?.replace(/\/$/, '')
  if (!base) throw new BookingError('network', 'Online requests are unavailable. Please call Sergio to discuss your date.')
  return base
}
async function requestId(operation: string, payload: unknown) {
  const origin = new URL(serviceBase()).origin
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)))
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  // Persist retry metadata only; the guest's details already live in the form's draft.
  const key = `booking-pending:v1:${encodeURIComponent(origin)}:${operation}:${hash}`
  let value = attempts.get(key)
  if (!value) {
    try {
      const pending = localStorage.getItem(key)
      if (pending && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(pending)) value = pending
    } catch { /* With storage blocked, retries in this page still use the module cache. */ }
    value ??= crypto.randomUUID()
    attempts.set(key, value)
    try { localStorage.setItem(key, value) } catch { /* Saving retry metadata is optional. */ }
  }
  return { key, value }
}
function completeAttempt(attempt: { key: string; value: string }) {
  try {
    // A completion in one tab must not remove another tab's newer pending attempt.
    if (localStorage.getItem(attempt.key) === attempt.value) localStorage.removeItem(attempt.key)
  } catch { /* A valid server receipt remains valid when storage is unavailable. */ }
}
function rememberAccess(ref: string, accessToken: string) {
  try { sessionStorage.setItem('booking-access:' + ref, accessToken) } catch { /* The URL fragment still grants access for this page. */ }
}
function receiptAccess(ref: string) {
  if (typeof window === 'undefined') return ''
  const token = new URLSearchParams(window.location.hash.slice(1)).get('access')
  if (token) { rememberAccess(ref, token); return token }
  try { return sessionStorage.getItem('booking-access:' + ref) || '' } catch { return '' }
}
async function call<T>(path: string, body?: unknown, allowNull = false): Promise<T> {
  const base = serviceBase()
  let response: Response
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20000)
  try {
    response = await fetch(base + path, { signal: controller.signal, method: body === undefined ? 'GET' : 'POST', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', headers: body === undefined ? undefined : { 'Content-Type': 'application/json', 'X-Booking-Request': '1' }, body: body === undefined ? undefined : JSON.stringify(body) })
  } catch { clearTimeout(timeout); throw new BookingError('network', 'The request service could not be reached. Your request has not been confirmed; please retry or call Sergio.') }
  const data = await response.json().catch(() => null).finally(() => clearTimeout(timeout))
  if (!response.ok) {
    const error = data?.error ?? data
    const code = ['unavailable', 'seats-gone', 'invalid', 'network'].includes(error?.code) ? error.code : 'network'
    throw new BookingError(code, error?.message || 'Your request could not be confirmed. Please retry or call Sergio.')
  }
  if (data === null && !allowNull) throw new BookingError('network', 'The service returned an incomplete response. Please retry before assuming your request was received.')
  return data as T
}
export const api: PublicBookingApi = {
  async config() {
    const result = await call<PlanningConfig>('/api/planning-config')
    if (!result || !Array.isArray(result.partyBands) || !result.partyBands.length || typeof result.paymentReady !== 'boolean' || !Number.isInteger(result.maxGuests) || !Array.isArray(result.interviewSlots) || result.partyBands.some(band => !band || typeof band.id !== 'string' || typeof band.label !== 'string' || !Number.isInteger(band.min) || !Number.isInteger(band.max) || band.min < 1 || band.max < band.min || band.deposit !== null && (typeof band.deposit !== 'number' || !Number.isFinite(band.deposit) || band.deposit < 0))) throw new BookingError('network', 'The booking settings were incomplete. Please reload them or call Sergio.')
    return result
  },
  availability: (kind, month) => call(`/api/availability?type=${encodeURIComponent(kind)}&month=${encodeURIComponent(month)}`),
  nights: () => call('/api/nights'),
  async hold(request, honeypot = '', options = {}) {
    const attempt = await requestId('request', request)
    // The checkout ID is derived from the same saved request, so a retried hold reopens the same Stripe session.
    const checkoutAttempt = options.checkout && request.kind !== 'event' ? await requestId('request-checkout', request) : null
    const elapsed = Number.isSafeInteger(options.elapsedMs) && options.elapsedMs! >= 0 && options.elapsedMs! <= 3_600_000 ? options.elapsedMs : undefined
    const result = await call<PublicHoldResult>(request.kind === 'event' ? '/api/request' : '/api/hold', { request, requestId: attempt.value, honeypot, ...(checkoutAttempt ? { checkoutRequestId: checkoutAttempt.value } : {}), ...(elapsed !== undefined ? { elapsedMs: elapsed } : {}) })
    if (typeof result.ref !== 'string' || !result.ref || typeof result.accessToken !== 'string' || !result.accessToken || result.next !== 'done' || typeof result.url !== 'string' || !result.url) throw new BookingError('network', 'The request receipt was incomplete. Retry to recover the same request, or call Sergio.')
    rememberAccess(result.ref, result.accessToken)
    completeAttempt(attempt)
    if (checkoutAttempt) completeAttempt(checkoutAttempt)
    // Only a payment-provider page may follow; anything else is treated as a checkout that did not open.
    if (result.checkout) {
      let url: URL | null = null
      try { url = new URL(result.checkout.url) } catch { /* handled below */ }
      if (!url || url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com' || url.username || url.password) return { ...result, checkout: undefined, checkoutError: { code: 'invalid_checkout', message: 'The payment link could not be verified. Your request is saved; pay from your booking page.' } }
    }
    return result
  },
  async details(ref, details) {
    const accessToken = receiptAccess(ref)
    if (!ref || !accessToken) throw new BookingError('invalid', 'Open your complete private booking link first.')
    const payload = { ref, accessToken, details }, attempt = await requestId('details', payload)
    const result = await call<DetailsReceipt | null>('/api/booking/details', { ...payload, requestId: attempt.value })
    if (!result || result.ref !== ref || !isDetailsResult(result.detailsResult, attempt.value, details)) throw new BookingError('network', 'The result for these details could not be confirmed. Your answers are still here; retry the same submission or call Sergio.')
    if (!Object.values(result.detailsResult.outcomes).includes('unverified')) {
      completeAttempt(attempt)
      // A later intentional update (including adding details after Remove)
      // gets a fresh identity. Only uncertain submissions retain their retry ID.
      if (attempts.get(attempt.key) === attempt.value) attempts.delete(attempt.key)
    }
    return result
  },
  async booking(ref) {
    const accessToken = receiptAccess(ref)
    if (!ref || !accessToken) return null
    return call<BookingReceipt | null>('/api/booking/status', { ref, accessToken }, true)
  },
  async cancel(ref, reason) {
    const accessToken = receiptAccess(ref)
    if (!ref || !accessToken) throw new BookingError('invalid', 'Open your complete private booking link first.')
    const payload = { ref, accessToken, reason }, attempt = await requestId('cancel', payload)
    const result = await call<BookingReceipt | null>('/api/booking/cancel', { ...payload, requestId: attempt.value })
    if (!result || result.ref !== ref || result.status !== 'cancelled') throw new BookingError('network', 'Your cancellation receipt was incomplete. Retry to recover its status.')
    completeAttempt(attempt)
    return result
  },
  async scheduleInterview(ref, slotId) {
    const accessToken = receiptAccess(ref)
    if (!ref || !accessToken) throw new BookingError('invalid', 'Open your complete private booking link first.')
    const payload = { ref, accessToken, slotId }, attempt = await requestId('interview', payload)
    const result = await call<BookingReceipt | null>('/api/booking/interview', { ...payload, requestId: attempt.value })
    if (!result || result.ref !== ref || !result.planning) throw new BookingError('network', 'Your interview receipt was incomplete. Retry to recover its status.')
    completeAttempt(attempt)
    return result
  },
  async checkout(ref) {
    const accessToken = receiptAccess(ref)
    if (!ref || !accessToken) throw new BookingError('invalid', 'Open your complete private booking link first.')
    const payload = { ref, accessToken }, attempt = await requestId('checkout', payload)
    let result: {url: string; expiresAt?: string}
    try { result = await call<{url: string; expiresAt?: string}>('/api/booking/checkout', { ...payload, requestId: attempt.value }) } catch (error) {
      if (error instanceof BookingError && /previous checkout ended|could not be opened|is processing/.test(error.message)) { completeAttempt(attempt); attempts.delete(attempt.key) }
      throw error
    }
    let url: URL
    try { url = new URL(result.url) } catch { throw new BookingError('network', 'The payment link could not be verified. Please retry.') }
    if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com' || url.username || url.password) throw new BookingError('network', 'The payment link could not be verified. Please contact Sergio.')
    completeAttempt(attempt)
    attempts.delete(attempt.key)
    return result
  },
  async waitlist(nightId, email, honeypot = '') {
    const request = { nightId, email: email.trim() }, attempt = await requestId('waitlist', request)
    const result = await call<{ ok?: unknown }>('/api/waitlist', { ...request, requestId: attempt.value, honeypot })
    if (result?.ok !== true) throw new BookingError('network', 'The waitlist acknowledgment was incomplete. Retry to recover the same request, or call Sergio.')
    completeAttempt(attempt)
  },
}
