import { accountConfig } from './config'
import { getAccessToken, SignInRequired } from './auth-client'
import { isPreparationAck, isPreparationResponse, type PreparationAck, type PreparationResponse, type PreparationSave } from '../preparation/types'
import { preparationRequestHash } from '../preparation/recovery'

export class PreparationApiError extends Error { constructor(message: string, public status = 0, public code = '') { super(message) } }
async function request(path: string, signal: AbortSignal, body: object | undefined, expectedActor: string): Promise<unknown> {
  let response: Response
  try {
    const token = await getAccessToken(), headers = { Authorization: 'Bearer ' + token, Accept: 'application/json' }
    const session = await fetch(accountConfig.apiOrigin + '/api/spa/auth/session', { signal, headers, credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer' })
    const current = await session.json().catch(() => null)
    if (session.status === 401) { window.dispatchEvent(new Event('account:expired')); throw new PreparationApiError('Sign in again to check your saved details.', 401) }
    if (!session.ok) throw new PreparationApiError('Your current account could not be checked. Retry before sending preparation information.', session.status)
    if (!expectedActor || current?.authenticated !== true || current.identity?.sub !== expectedActor || current.identity?.email_verified !== true) throw new PreparationApiError('Your signed-in account changed. Refresh your account before opening or changing this private brief.', 403, 'identity_changed')
    // Bind the verified identity and this operation to one captured token. Never persist it.
    response = await fetch(accountConfig.apiOrigin + '/api/spa' + path, { signal, headers: { ...headers, ...(body ? { 'Content-Type': 'application/json', 'X-Customer-Request': '1' } : {}) }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}), credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer' })
    if (response.status === 401) window.dispatchEvent(new Event('account:expired'))
  } catch (failure) { if (failure instanceof SignInRequired) throw new PreparationApiError('Sign in again to check your saved details.', 401); throw failure }
  const value = await response.json().catch(() => null)
  if (!response.ok) throw new PreparationApiError(typeof value?.error?.message === 'string' ? value.error.message : 'The saved result could not be confirmed. Check the original request before submitting another change.', response.status, typeof value?.error?.code === 'string' ? value.error.code : '')
  if (!value) throw new PreparationApiError('The saved result could not be read. Your earlier request still needs to be checked.')
  return value
}
export async function readPreparation(bookingId: string, signal: AbortSignal, requestId?: string, historyPage = 0, actor = ''): Promise<PreparationResponse> {
  const query = new URLSearchParams({ id: bookingId, historyPage: String(historyPage) }); if (requestId) query.set('requestId', requestId)
  const value = await request('/customer/preparation?' + query, signal, undefined, actor)
  if (!isPreparationResponse(value, bookingId)) throw new PreparationApiError('Your saved preparation details could not be verified. Refresh before changing them.')
  return value
}
export async function savePreparation(input: PreparationSave, signal: AbortSignal, actor = ''): Promise<PreparationAck> {
  const requestHash = await preparationRequestHash(input), value = await request('/customer/preparation/save', signal, input, actor)
  if (!isPreparationAck(value, { ...input, operation: 'save', requestHash })) throw new PreparationApiError('The acknowledgment does not confirm this exact change. Check its recorded result before submitting anything else.')
  return value
}
export async function abandonPreparation(bookingId: string, requestId: string, signal: AbortSignal, actor = ''): Promise<PreparationAck> {
  const value = await request('/customer/preparation/abandon', signal, { bookingId, requestId }, actor)
  if (!isPreparationAck(value, { bookingId, requestId, operation: 'save' })) throw new PreparationApiError('The earlier request could not be resolved. Check it again before entering another change.')
  return value
}
