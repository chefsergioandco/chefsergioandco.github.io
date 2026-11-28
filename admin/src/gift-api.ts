import { adminFetch, AdminApiError } from './api-client'
import { isGiftActionResult, isGiftPurchaseId, isGiftsResponse, isGiftSettingsAction, isGiftSettingsResponse, isGiftSettingsResult, type GiftAction, type GiftActionResult, type GiftsResponse, type GiftSettingsAction, type GiftSettingsResponse, type GiftSettingsResult } from './gift-types'

export class GiftApiError extends Error {
  constructor(message: string, public status = 0, public code = 'unverified') { super(message); this.name = 'GiftApiError' }
}
const messages: Record<string, string> = {
  gift_not_due: 'This gift is not due for delivery yet. Refresh its scheduled time.',
  gift_delivery_unavailable: 'Gift delivery is not ready. Refresh the connection details before trying again.',
  gift_delivery_state: 'This delivery cannot be safely retried in its current state. Refresh its recorded result.',
  idempotency_conflict: 'This saved action needs reconciliation. Refresh the purchase before doing anything else.',
}
async function request(path: string, body: GiftAction | GiftSettingsAction | undefined, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController(), abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) controller.abort()
  const timeout = window.setTimeout(abort, 20_000)
  try {
    const response = await adminFetch(path, { method: body ? 'POST' : 'GET', cache: 'no-store', credentials: 'same-origin', signal: controller.signal, headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json', 'X-Admin-Request': '1' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      const code = typeof data?.error?.code === 'string' ? data.error.code : 'unavailable'
      throw new GiftApiError(response.status === 401 || response.status === 403 ? 'Your administrator access needs attention. Sign in again, then refresh Gifts.' : response.status === 404 ? 'That gift purchase could not be found. Return to purchases and search again.' : messages[code] || 'The gift request could not be confirmed. Refresh, or retry the same action.', response.status, code)
    }
    return data
  } catch (cause) {
    if (cause instanceof GiftApiError) throw cause
    if (cause instanceof AdminApiError) throw new GiftApiError('Your administrator access needs attention. Sign in again, then refresh Gifts.', cause.status, 'access_denied')
    throw new GiftApiError('The gift request could not be confirmed. Retry the same action after checking your connection.')
  } finally { window.clearTimeout(timeout); signal?.removeEventListener('abort', abort) }
}
export async function readGifts(input: { query?: string; id?: string | null; cursor?: string | null; limit?: number } = {}, signal?: AbortSignal): Promise<GiftsResponse> {
  const params = new URLSearchParams(), limit = input.limit ?? 50
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (input.query?.length ?? 0) > 200 || input.id && !isGiftPurchaseId(input.id) || input.cursor && !/^[A-Za-z0-9_-]{1,2000}$/.test(input.cursor)) throw new GiftApiError('The gift search is invalid. Return to purchases and try again.', 400, 'invalid_request')
  if (input.query) params.set('query', input.query)
  if (input.id) params.set('id', input.id)
  if (input.cursor) params.set('cursor', input.cursor)
  params.set('limit', String(limit))
  const data = await request('/api/gifts?' + params.toString(), undefined, signal)
  if (!isGiftsResponse(data) || (input.id ? data.selected?.id !== input.id : data.selected !== null)) throw new GiftApiError('The gift records were incomplete or did not match this purchase. Refresh before relying on them.')
  return data
}
export async function queueGiftAction(input: GiftAction, signal?: AbortSignal): Promise<GiftActionResult> {
  if (!isGiftPurchaseId(input.requestId) || !isGiftPurchaseId(input.purchaseId) || !['queue_due', 'retry_delivery', 'reconcile_purchase'].includes(input.action) || input.action === 'retry_delivery' && !input.messageId || input.action !== 'retry_delivery' && input.messageId !== undefined) throw new GiftApiError('This gift action is invalid. Refresh the purchase before trying again.', 400, 'invalid_request')
  const data = await request('/api/gifts/action', input, signal)
  if (!isGiftActionResult(data, input)) throw new GiftApiError('The gift action could not be confirmed. Retry the same action; its saved request will be reused.')
  return data
}
export async function readGiftSettings(signal?: AbortSignal): Promise<GiftSettingsResponse> {
  const data = await request('/api/gifts/settings', undefined, signal)
  if (!isGiftSettingsResponse(data)) throw new GiftApiError('Gift amount settings were incomplete. Refresh before making changes.')
  return data
}
export async function saveGiftSettings(input: GiftSettingsAction, signal?: AbortSignal): Promise<GiftSettingsResult> {
  if (!isGiftSettingsAction(input)) throw new GiftApiError('Review the gift amounts before saving.', 400, 'invalid_request')
  const data = await request('/api/gifts/settings', input, signal)
  if (!isGiftSettingsResult(data, input)) throw new GiftApiError('The gift amount change could not be confirmed. Retry the same saved change.')
  return data
}
