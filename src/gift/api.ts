import { booking } from '../content/booking'
import { isGiftCode, normalizeGiftCode } from '../../prototypes/sergio-admin/shared/gift-cards/code'
import type { GiftCardDocument } from '../../prototypes/sergio-admin/shared/gift-cards/artwork'

/**
 * The gift-card service contract (the Worker implements it; see docs/GIFT-CARDS.md):
 *   GET  /api/gift/config    → { ready, amounts, fulfillment }
 *   POST /api/gift/checkout  → { url }                      a Stripe Checkout URL; nothing is issued until it's paid
 *   POST /api/gift/card      { code } → GiftCardStatus      the code is the credential: sent in the body, never a URL
 *   POST /api/gift/download  { purchaseId, accessToken } → private paid-card document; assembled as a PDF here
 * Like booking requests, a failed or missing service never pretends a card was bought.
 */
export type GiftFulfillment = 'download' | 'email'
export type GiftConfig = { ready: boolean; amounts: number[]; fulfillment: GiftFulfillment | null }
export type GiftPurchase = { amountCents: number; recipientName: string; senderName: string; senderEmail: string; note: string } & ({ fulfillment: 'download'; recipientEmail?: never; sendOn?: never } | { fulfillment: 'email'; recipientEmail: string; sendOn: string })
export type GiftCardStatus = { amountCents: number; balanceCents: number; status: 'active' | 'pending' | 'frozen' | 'void'; recipient: string; sender: string; note: string; last4: string }
export const GIFT_DELIVERY_STATUSES = ['not_issued', 'scheduled', 'disabled', 'preview', 'queued', 'sending', 'sent', 'delivered', 'retry', 'failed', 'bounced', 'complained', 'needs_review', 'suppressed', 'cancelled', 'needs_contact', 'not_applicable'] as const
export type GiftDeliveryStatus = typeof GIFT_DELIVERY_STATUSES[number]
export type GiftPurchaseProof = { purchaseId: string; accessToken: string }
export type GiftPurchaseStatus = {
  version: 1; purchaseId: string; payment: 'pending' | 'processing' | 'paid' | 'expired' | 'unverified';
  issuance: 'pending' | 'issued' | 'needs_review'; sendOn: string | null; timeZone: 'America/New_York';
  delivery: { recipient: GiftDeliveryStatus; sender: GiftDeliveryStatus }; checkedAt: string; fulfillment: GiftFulfillment; canDownload: boolean;
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
    const valid = Array.isArray(result?.amounts) && result.amounts.length > 0 && result.amounts.length <= 32 && new Set(result.amounts).size === result.amounts.length && result.amounts.every(amount => Number.isSafeInteger(amount) && amount >= 500 && amount <= 10_000_000) && ['download', 'email'].includes(result.fulfillment ?? '')
    return valid ? { ready: result.ready === true, amounts: result.amounts, fulfillment: result.fulfillment } : { ready: false, amounts: fallbackAmounts, fulfillment: null }
  } catch { return { ready: false, amounts: fallbackAmounts, fulfillment: null } }
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
  if (!['download', 'email'].includes(purchase.fulfillment)) throw new GiftError('invalid', 'Refresh the gift page to confirm how your card will be delivered before payment.')
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
  const v = value as Record<string, any>, allowed = ['version', 'purchaseId', 'payment', 'issuance', 'sendOn', 'timeZone', 'delivery', 'checkedAt', 'fulfillment', 'canDownload']
  if (Object.keys(v).some(key => !allowed.includes(key)) || v.version !== 1 || v.purchaseId !== purchaseId || !uuid(v.purchaseId)) return false
  if (!['pending', 'processing', 'paid', 'expired', 'unverified'].includes(v.payment) || !['pending', 'issued', 'needs_review'].includes(v.issuance) || v.timeZone !== 'America/New_York') return false
  if (!['download', 'email'].includes(v.fulfillment) || typeof v.canDownload !== 'boolean') return false
  if (v.sendOn !== null && (typeof v.sendOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.sendOn) || !Number.isFinite(Date.parse(v.sendOn + 'T12:00:00Z')) || new Date(v.sendOn + 'T12:00:00Z').toISOString().slice(0, 10) !== v.sendOn)) return false
  if (!v.delivery || typeof v.delivery !== 'object' || Array.isArray(v.delivery) || Object.keys(v.delivery).length !== 2 || !GIFT_DELIVERY_STATUSES.includes(v.delivery.recipient) || !GIFT_DELIVERY_STATUSES.includes(v.delivery.sender)) return false
  if (v.fulfillment === 'download' ? v.delivery.recipient !== 'not_applicable' || v.delivery.sender !== 'not_applicable' : v.delivery.recipient === 'not_applicable' || v.delivery.sender === 'not_applicable' || v.canDownload) return false
  if (v.canDownload && (v.payment !== 'paid' || v.issuance !== 'issued')) return false
  return typeof v.checkedAt === 'string' && v.checkedAt.length <= 40 && /(?:Z|[+-]\d\d:\d\d)$/.test(v.checkedAt) && Number.isFinite(Date.parse(v.checkedAt))
}

export async function giftPurchaseStatus(proof: GiftPurchaseProof, signal?: AbortSignal): Promise<GiftPurchaseStatus> {
  if (!isGiftPurchaseProof(proof)) throw new GiftError('invalid', 'Use the complete private purchase link returned after checkout.')
  const result = await call<GiftPurchaseStatus>('/api/gift/status', { purchaseId: proof.purchaseId, accessToken: proof.accessToken }, signal)
  if (!isGiftPurchaseStatus(result, proof.purchaseId)) throw new GiftError('network', 'The current purchase result could not be confirmed. Refresh the status or contact Sergio before making another payment.')
  return result
}

type GiftDownload = { version: 1; purchaseId: string; issuedAt: string; document: GiftCardDocument }
function isGiftDownload(value: unknown, purchaseId: string): value is GiftDownload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Record<string, any>, d = v.document
  if (Object.keys(v).some(key => !['version', 'purchaseId', 'issuedAt', 'document'].includes(key)) || v.version !== 1 || v.purchaseId !== purchaseId || typeof v.issuedAt !== 'string' || !/(?:Z|[+-]\d\d:\d\d)$/.test(v.issuedAt) || !Number.isFinite(Date.parse(v.issuedAt)) || !d || typeof d !== 'object' || Array.isArray(d)) return false
  const text = (input: unknown, max: number) => typeof input === 'string' && input.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input)
  if (Object.keys(d).some(key => !['amountCents', 'recipient', 'sender', 'note', 'code', 'redeemUrl', 'phone'].includes(key)) || !Number.isSafeInteger(d.amountCents) || d.amountCents < 500 || d.amountCents > 10_000_000 || !text(d.recipient, 60) || !text(d.sender, 60) || !text(d.note, 220) || typeof d.code !== 'string' || !isGiftCode(d.code) || !text(d.redeemUrl, 500) || !text(d.phone, 40) || !/^[0-9+(). \-]+$/.test(d.phone)) return false
  try { const url = new URL(d.redeemUrl); return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash && /\/book\/$/.test(url.pathname) } catch { return false }
}

/** Only this explicit, proof-bound request returns the card credential. The PDF renderer loads on demand. */
export async function downloadGiftCard(proof: GiftPurchaseProof, signal?: AbortSignal): Promise<Blob> {
  if (!isGiftPurchaseProof(proof)) throw new GiftError('invalid', 'Use the complete private purchase link returned after checkout.')
  const root = base()
  if (!root) throw new GiftError('unavailable', 'The card download is temporarily unavailable. Keep your private purchase link and try again.')
  const controller = new AbortController(), abort = () => controller.abort(), maximum = 32 * 1024
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) controller.abort()
  const timeout = setTimeout(abort, 20000)
  try {
    const response = await fetch(root + '/api/gift/download', { method: 'POST', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal, headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Booking-Request': '1' }, body: JSON.stringify({ purchaseId: proof.purchaseId, accessToken: proof.accessToken }) })
    if (!response.ok) throw new GiftError('unavailable', 'The card download could not be confirmed. Refresh this purchase, or contact Sergio before making another payment.')
    const length = response.headers.get('Content-Length')
    if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('Content-Type') ?? '') || length !== null && (!/^\d+$/.test(length) || Number(length) > maximum)) throw new GiftError('network', 'The card file could not be verified. Keep this link and try the download again.')
    const reader = response.body?.getReader()
    if (!reader) throw new GiftError('network', 'The card file could not be verified. Keep this link and try the download again.')
    const chunks: Uint8Array[] = []; let size = 0
    try {
      for (;;) {
        const next = await reader.read()
        if (next.done) break
        size += next.value.byteLength
        if (size > maximum) { await reader.cancel(); throw new GiftError('network', 'The card file could not be verified. Keep this link and try the download again.') }
        chunks.push(next.value)
      }
    } finally { reader.releaseLock() }
    const bytes = new Uint8Array(size); let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    const document: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (!isGiftDownload(document, proof.purchaseId)) throw new GiftError('network', 'The card file could not be verified. Keep this link and try the download again.')
    if (controller.signal.aborted) throw new Error('Download cancelled')
    const { buildGiftPDF } = await import('../../prototypes/sergio-admin/shared/gift-cards/pdf')
    if (controller.signal.aborted) throw new Error('Download cancelled')
    const pdf = await buildGiftPDF(document.document, document.issuedAt)
    if (controller.signal.aborted) throw new Error('Download cancelled')
    return new Blob([pdf], { type: 'application/pdf' })
  } catch (error) {
    if (error instanceof GiftError) throw error
    throw new GiftError('network', 'The card download could not be completed. Keep this purchase link and try again; another payment is not needed.')
  } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort) }
}

export async function giftCardStatus(code: string): Promise<GiftCardStatus> {
  if (!isGiftCode(code)) throw new GiftError('invalid', 'That code isn’t complete. Check each character; the letters I, L, O and U aren’t used.')
  const result = await call<GiftCardStatus>('/api/gift/card', { code: normalizeGiftCode(code) })
  if (!result || !['active', 'pending', 'frozen', 'void'].includes(result.status) || !Number.isSafeInteger(result.amountCents) || result.amountCents <= 0 || !Number.isSafeInteger(result.balanceCents) || result.balanceCents < 0 || result.status !== 'active' && result.balanceCents !== 0 || typeof result.recipient !== 'string' || result.recipient.length > 150 || typeof result.sender !== 'string' || result.sender.length > 150 || typeof result.note !== 'string' || result.note.length > 1000 || typeof result.last4 !== 'string' || !/^[0-9A-Z]{4}$/.test(result.last4)) throw new GiftError('network', 'The card’s available value could not be confirmed. Please refresh or call Sergio before using it.')
  return result
}
