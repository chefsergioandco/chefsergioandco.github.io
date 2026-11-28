import { booking } from '../content/booking'
import { isGiftCode, normalizeGiftCode } from '../../prototypes/sergio-admin/shared/gift-cards/code'

/**
 * The gift-card service contract (the Worker implements it; see docs/GIFT-CARDS.md):
 *   GET  /api/gift/config    → { ready, amounts }           ready=false until Stripe and the ledger are live
 *   POST /api/gift/checkout  → { url }                      a Stripe Checkout URL; nothing is issued until it's paid
 *   POST /api/gift/card      { code } → GiftCardStatus      the code is the credential: sent in the body, never a URL
 * Like booking requests, a failed or missing service never pretends a card was bought.
 */
export type GiftConfig = { ready: boolean; amounts: number[] }
export type GiftPurchase = { amountCents: number; recipientName: string; recipientEmail: string; senderName: string; senderEmail: string; note: string; sendOn: string }
export type GiftCardStatus = { amountCents: number; balanceCents: number; status: 'active' | 'pending' | 'frozen' | 'void'; recipient: string; sender: string; note: string; last4: string }
export const GIFT_DELIVERY_STATUSES = ['not_issued', 'scheduled', 'disabled', 'preview', 'queued', 'sending', 'sent', 'delivered', 'retry', 'failed', 'bounced', 'complained', 'needs_review', 'suppressed', 'cancelled', 'needs_contact'] as const
export type GiftDeliveryStatus = typeof GIFT_DELIVERY_STATUSES[number]
export type GiftPurchaseProof = { purchaseId: string; accessToken: string }
export type GiftPurchaseStatus = {
  version: 1; purchaseId: string; payment: 'pending' | 'processing' | 'paid' | 'expired' | 'unverified';
  issuance: 'pending' | 'issued' | 'needs_review'; sendOn: string | null; timeZone: 'America/New_York';
  delivery: { recipient: GiftDeliveryStatus; sender: GiftDeliveryStatus }; checkedAt: string;
}
export class GiftError extends Error { constructor(public code: 'invalid' | 'not-found' | 'unavailable' | 'rate_limited' | 'network', message: string) { super(message) } }

const base = () => booking.apiBase?.replace(/\/$/, '') || null

async function call<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const root = base()
  if (!root) throw new GiftError('unavailable', 'Online gift cards are not open yet.')
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20000)
  const abort = () => controller.abort(), cleanup = () => { clearTimeout(timeout); signal?.removeEventListener('abort', abort) }
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) controller.abort()
  let response: Response
  try {
    response = await fetch(root + path, { signal: controller.signal, method: body === undefined ? 'GET' : 'POST', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', headers: body === undefined ? undefined : { 'Content-Type': 'application/json', 'X-Booking-Request': '1' }, body: body === undefined ? undefined : JSON.stringify(body) })
  } catch { cleanup(); throw new GiftError('network', 'The gift service could not be reached. We could not confirm the result; please try again.') }
  const data = await response.json().catch(() => null).finally(cleanup)
  if (!response.ok) {
    const error = data?.error ?? data
    const code = ['invalid', 'not-found', 'unavailable', 'rate_limited'].includes(error?.code) ? error.code : response.status === 429 ? 'rate_limited' : response.status === 404 ? 'unavailable' : 'network'
    throw new GiftError(code, typeof error?.message === 'string' ? error.message : 'The gift service did not answer. We could not confirm the result.')
  }
  return data as T
}

/** Not ready (or unreachable) is the safe default: the page then offers a call instead of a checkout. */
export async function giftConfig(fallbackAmounts: number[]): Promise<GiftConfig> {
  try {
    const result = await call<GiftConfig>('/api/gift/config')
    const amounts = Array.isArray(result?.amounts) && result.amounts.length > 0 && result.amounts.length <= 32 && result.amounts.every(amount => Number.isSafeInteger(amount) && amount >= 500 && amount <= 10_000_000) ? result.amounts : fallbackAmounts
    return { ready: result?.ready === true && amounts === result.amounts, amounts }
  } catch { return { ready: false, amounts: fallbackAmounts } }
}

const attemptKey = 'gift-checkout-attempt'
const attempts = new Map<string, string>()
const proofs = new Map<string, string>()
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
const token = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value)
const proofKey = (id: string) => 'gift-purchase-proof:' + base() + ':' + id
export function isGiftPurchaseProof(value: unknown): value is GiftPurchaseProof {
  return !!value && typeof value === 'object' && uuid((value as GiftPurchaseProof).purchaseId) && token((value as GiftPurchaseProof).accessToken)
}
function saveProof(proof: GiftPurchaseProof) {
  proofs.set(proofKey(proof.purchaseId), proof.accessToken)
  try { sessionStorage.setItem(proofKey(proof.purchaseId), proof.accessToken) } catch { /* The fragment remains usable without storage. */ }
}
/** A return link proves only this purchase. A missing link never guesses the last purchase in this browser. */
export function giftPurchaseProof(search: string, hash: string): GiftPurchaseProof | null {
  const query = new URLSearchParams(search), fragment = new URLSearchParams(hash.replace(/^#/, ''))
  if (query.getAll('purchase').length !== 1 || fragment.getAll('access').length > 1) return null
  const purchaseId = query.get('purchase')
  if (!uuid(purchaseId)) return null
  let accessToken = fragment.get('access') || proofs.get(proofKey(purchaseId)) || ''
  if (!accessToken) try { accessToken = sessionStorage.getItem(proofKey(purchaseId)) || '' } catch { /* No private proof was recovered. */ }
  const proof = { purchaseId, accessToken }
  if (!isGiftPurchaseProof(proof)) return null
  saveProof(proof)
  return proof
}
export async function startGiftCheckout(purchase: GiftPurchase, honeypot = ''): Promise<string> {
  // One id per purchase details, so a double click or a retry reuses the same Checkout session.
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(purchase)))
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  const intent = base() + ':' + hash
  let requestId = attempts.get(intent) || ''
  try { const saved = JSON.parse(sessionStorage.getItem(attemptKey) || 'null'); if (!requestId && saved?.hash === intent && uuid(saved.id)) requestId = saved.id } catch { /* Same-page retries still use the in-memory intent. */ }
  requestId ||= crypto.randomUUID()
  attempts.set(intent, requestId)
  try { sessionStorage.setItem(attemptKey, JSON.stringify({ hash: intent, id: requestId })) } catch { /* Optional. */ }
  const result = await call<{ url: string; purchaseId: string; accessToken: string }>('/api/gift/checkout', { purchase, requestId, honeypot })
  const url = new URL(result?.url ?? '', 'https://invalid.invalid')
  if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com' || url.username || url.password || url.port || !isGiftPurchaseProof(result) || result.purchaseId !== requestId) throw new GiftError('network', 'The payment page could not be confirmed. Retry this purchase or contact Sergio before starting another payment.')
  saveProof(result)
  return url.href
}

export function isGiftPurchaseStatus(value: unknown, purchaseId: string): value is GiftPurchaseStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Record<string, any>, allowed = ['version', 'purchaseId', 'payment', 'issuance', 'sendOn', 'timeZone', 'delivery', 'checkedAt']
  if (Object.keys(v).some(key => !allowed.includes(key)) || v.version !== 1 || v.purchaseId !== purchaseId || !uuid(v.purchaseId)) return false
  if (!['pending', 'processing', 'paid', 'expired', 'unverified'].includes(v.payment) || !['pending', 'issued', 'needs_review'].includes(v.issuance) || v.timeZone !== 'America/New_York') return false
  if (v.sendOn !== null && (typeof v.sendOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.sendOn) || !Number.isFinite(Date.parse(v.sendOn + 'T12:00:00Z')) || new Date(v.sendOn + 'T12:00:00Z').toISOString().slice(0, 10) !== v.sendOn)) return false
  if (!v.delivery || typeof v.delivery !== 'object' || Array.isArray(v.delivery) || Object.keys(v.delivery).length !== 2 || !GIFT_DELIVERY_STATUSES.includes(v.delivery.recipient) || !GIFT_DELIVERY_STATUSES.includes(v.delivery.sender)) return false
  return typeof v.checkedAt === 'string' && v.checkedAt.length <= 40 && /(?:Z|[+-]\d\d:\d\d)$/.test(v.checkedAt) && Number.isFinite(Date.parse(v.checkedAt))
}

export async function giftPurchaseStatus(proof: GiftPurchaseProof, signal?: AbortSignal): Promise<GiftPurchaseStatus> {
  if (!isGiftPurchaseProof(proof)) throw new GiftError('invalid', 'Use the complete private purchase link returned after checkout.')
  const result = await call<GiftPurchaseStatus>('/api/gift/status', proof, signal)
  if (!isGiftPurchaseStatus(result, proof.purchaseId)) throw new GiftError('network', 'The current purchase result could not be confirmed. Refresh the status or contact Sergio before making another payment.')
  return result
}

export async function giftCardStatus(code: string): Promise<GiftCardStatus> {
  if (!isGiftCode(code)) throw new GiftError('invalid', 'That code isn’t complete. Check each character; the letters I, L, O and U aren’t used.')
  const result = await call<GiftCardStatus>('/api/gift/card', { code: normalizeGiftCode(code) })
  if (!result || !['active', 'pending', 'frozen', 'void'].includes(result.status) || !Number.isSafeInteger(result.amountCents) || result.amountCents <= 0 || !Number.isSafeInteger(result.balanceCents) || result.balanceCents < 0 || result.status !== 'active' && result.balanceCents !== 0 || typeof result.recipient !== 'string' || result.recipient.length > 150 || typeof result.sender !== 'string' || result.sender.length > 150 || typeof result.note !== 'string' || result.note.length > 1000 || typeof result.last4 !== 'string' || !/^[0-9A-Z]{4}$/.test(result.last4)) throw new GiftError('network', 'The card’s available value could not be confirmed. Please refresh or call Sergio before using it.')
  return result
}
