import { adminFetch, AdminApiError } from './api-client'
import { isRetainedAck, isRetainedRead, isRetainedResult, type RetainedInput, type RetainedRead, type RetainedAck, type RetainedAction, type RetainedResult } from './retained-record-types'
export class RetainedApiError extends Error { constructor(message: string, public status = 0) { super(message) } }
export async function retainedRequestHash(input: RetainedInput): Promise<string> {
  const body = JSON.stringify(Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b))))
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)))].map(b => b.toString(16).padStart(2, '0')).join('')
}
async function request(path: string, signal: AbortSignal, actor: string, body?: object): Promise<unknown> {
  try {
    const response = await adminFetch(path, { signal, cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Request': '1' }, body: JSON.stringify(body) } : {}) }, actor)
    const data = await response.json().catch(() => null)
    if (!response.ok) throw new RetainedApiError(typeof data?.error?.message === 'string' ? data.error.message : 'The current result could not be checked. Keep the original action reference and refresh.', response.status)
    return data
  } catch (error) { if (error instanceof AdminApiError) throw new RetainedApiError(error.message, error.status); throw error }
}
export async function readRetained(id: string, actor: string, signal: AbortSignal, options: { page?: number; bookingId?: string; requestId?: string } = {}): Promise<RetainedRead> {
  const query = new URLSearchParams({ id, bookingPage: String(options.page || 0) }); if (options.bookingId) query.set('bookingId', options.bookingId); if (options.requestId) query.set('requestId', options.requestId)
  const value = await request('/api/privacy-retained?' + query, signal, actor)
  if (!isRetainedRead(value, id, options.requestId)) throw new RetainedApiError('The current retained-record information did not match this request. Refresh before taking action.')
  return value
}
export async function writeRetained(input: RetainedInput, actor: string, signal: AbortSignal): Promise<RetainedAck> {
  const hash = await retainedRequestHash(input), value = await request('/api/privacy-retained', signal, actor, input)
  if (!isRetainedAck(value, { id: input.id, requestId: input.requestId, input, hash })) throw new RetainedApiError('The response did not confirm this exact reviewed action. Check the original action before starting another.')
  return value
}
export async function abandonRetained(id: string, requestId: string, action: RetainedAction, actor: string, signal: AbortSignal): Promise<RetainedResult> {
  const value = await request('/api/privacy-retained/abandon', signal, actor, { version: 1, id, requestId, action })
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RetainedApiError('The earlier action is not yet resolved. Check it again before entering a new one.')
  const envelope = value as Record<string, unknown>, result = envelope.actionResult
  if (Object.keys(envelope).length !== 4 || Object.keys(envelope).some(k => !['version', 'id', 'requestId', 'actionResult'].includes(k)) || envelope.version !== 1 || envelope.id !== id || envelope.requestId !== requestId || !isRetainedResult(result, id, requestId) || result.state === 'not_found' || result.state === 'abandoned' && result.action !== action || result.state === 'recorded' && result.ack.action !== action) throw new RetainedApiError('The earlier action is not yet resolved. Check it again before entering a new one.')
  return result
}
