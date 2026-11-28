import { adminFetch, AdminApiError } from './api-client'
import { isPreparationAck, isPreparationResponse, type PreparationAck, type PreparationResponse, type PreparationReview } from '../../src/preparation/types'
import { preparationRequestHash } from '../../src/preparation/recovery'

export class PreparationAdminError extends Error { constructor(message: string, public status = 0, public code = '') { super(message) } }
async function request(path: string, signal: AbortSignal, body?: object, actor?: string): Promise<unknown> {
  let response: Response
  try { response = await adminFetch(path, { signal, cache: 'no-store', credentials: 'same-origin', ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Request': '1' }, body: JSON.stringify(body) } : {}) }, actor) }
  catch (failure) { if (failure instanceof AdminApiError) throw new PreparationAdminError(failure.message, failure.status); throw failure }
  const value = await response.json().catch(() => null)
  if (!response.ok) throw new PreparationAdminError(typeof value?.error?.message === 'string' ? value.error.message : 'The preparation review result could not be confirmed. Check the original request before starting another action.', response.status, typeof value?.error?.code === 'string' ? value.error.code : '')
  if (!value) throw new PreparationAdminError('The preparation review result could not be read. Its original request is retained for checking.')
  return value
}
export async function readPreparationReview(bookingId: string, signal: AbortSignal, requestId?: string, historyPage = 0, actor?: string): Promise<PreparationResponse> {
  const query = new URLSearchParams({ id: bookingId, historyPage: String(historyPage) }); if (requestId) query.set('requestId', requestId)
  const value = await request('/api/preparation?' + query, signal, undefined, actor)
  if (!isPreparationResponse(value, bookingId, true)) throw new PreparationAdminError('The saved host details could not be verified. Refresh before reviewing them.')
  return value
}
export async function reviewPreparation(input: PreparationReview, signal: AbortSignal, actor?: string): Promise<PreparationAck> {
  const requestHash = await preparationRequestHash(input), value = await request('/api/preparation/action', signal, input, actor)
  if (!isPreparationAck(value, { ...input, operation: 'review', requestHash })) throw new PreparationAdminError('The acknowledgment does not confirm this exact review. Check its recorded result before another action.')
  return value
}
export async function abandonPreparationReview(bookingId: string, requestId: string, signal: AbortSignal, actor?: string): Promise<PreparationAck> {
  const value = await request('/api/preparation/abandon', signal, { bookingId, requestId }, actor)
  if (!isPreparationAck(value, { bookingId, requestId, operation: 'review' })) throw new PreparationAdminError('The earlier review could not be resolved. Check it again before starting another.')
  return value
}

export async function readPreparationAttention(signal: AbortSignal, page = 0, actor?: string): Promise<import('../../src/preparation/types').PreparationAttention> {
  const value = await request('/api/preparation/attention?page=' + page, signal, undefined, actor)
  const { isPreparationAttention } = await import('../../src/preparation/types')
  if (!isPreparationAttention(value)) throw new PreparationAdminError('Preparation review counts could not be verified. Refresh this list before assuming there are no requests.')
  return value
}
