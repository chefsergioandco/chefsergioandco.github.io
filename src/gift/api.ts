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
export class GiftError extends Error { constructor(public code: 'invalid' | 'not-found' | 'unavailable' | 'network', message: string) { super(message) } }

const base = () => booking.apiBase?.replace(/\/$/, '') || null

async function call<T>(path: string, body?: unknown): Promise<T> {
  const root = base()
  if (!root) throw new GiftError('unavailable', 'Online gift cards are not open yet.')
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20000)
  let response: Response
  try {
    response = await fetch(root + path, { signal: controller.signal, method: body === undefined ? 'GET' : 'POST', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', headers: body === undefined ? undefined : { 'Content-Type': 'application/json', 'X-Booking-Request': '1' }, body: body === undefined ? undefined : JSON.stringify(body) })
  } catch { clearTimeout(timeout); throw new GiftError('network', 'The gift service could not be reached. Nothing was charged; please try again.') }
  const data = await response.json().catch(() => null).finally(() => clearTimeout(timeout))
  if (!response.ok) {
    const error = data?.error ?? data
    const code = ['invalid', 'not-found', 'unavailable'].includes(error?.code) ? error.code : response.status === 404 ? 'unavailable' : 'network'
    throw new GiftError(code, typeof error?.message === 'string' ? error.message : 'The gift service did not answer. Nothing was charged.')
  }
  return data as T
}

/** Not ready (or unreachable) is the safe default: the page then offers a call instead of a checkout. */
export async function giftConfig(fallbackAmounts: number[]): Promise<GiftConfig> {
  try {
    const result = await call<GiftConfig>('/api/gift/config')
    const amounts = Array.isArray(result?.amounts) && result.amounts.every(amount => Number.isInteger(amount) && amount > 0) && result.amounts.length ? result.amounts : fallbackAmounts
    return { ready: result?.ready === true, amounts }
  } catch { return { ready: false, amounts: fallbackAmounts } }
}

const attemptKey = 'gift-checkout-attempt'
export async function startGiftCheckout(purchase: GiftPurchase, honeypot = ''): Promise<string> {
  // One id per purchase details, so a double click or a retry reuses the same Checkout session.
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(purchase)))
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  let requestId = ''
  try { const saved = JSON.parse(sessionStorage.getItem(attemptKey) || 'null'); if (saved?.hash === hash) requestId = saved.id } catch { /* A fresh id is fine. */ }
  requestId ||= crypto.randomUUID()
  try { sessionStorage.setItem(attemptKey, JSON.stringify({ hash, id: requestId })) } catch { /* Optional. */ }
  const result = await call<{ url: string }>('/api/gift/checkout', { purchase, requestId, honeypot })
  const url = new URL(result?.url ?? '', 'https://invalid.invalid')
  if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com') throw new GiftError('network', 'The payment page could not be opened. Nothing was charged.')
  return url.href
}

export async function giftCardStatus(code: string): Promise<GiftCardStatus> {
  if (!isGiftCode(code)) throw new GiftError('invalid', 'That code isn’t complete. Check each character; the letters I, L, O and U aren’t used.')
  return call<GiftCardStatus>('/api/gift/card', { code: normalizeGiftCode(code) })
}
