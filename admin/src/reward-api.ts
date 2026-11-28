import { adminFetch, AdminApiError } from './api-client'
import { isRewardActionResult, isRewardsResponse, type RewardAction, type RewardActionResult, type RewardPagesQuery, type RewardsResponse } from './reward-types'
export class RewardApiError extends Error { constructor(message: string, public status = 0) { super(message) } }
async function request(path: string, signal: AbortSignal, body?: RewardAction): Promise<unknown> {
  let response: Response
  try { response = await adminFetch(path, { signal, credentials: 'same-origin', cache: 'no-store', ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Request': '1' }, body: JSON.stringify(body) } : {}) }) }
  catch (failure) { if (failure instanceof AdminApiError) throw new RewardApiError(failure.message, failure.status); throw failure }
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new RewardApiError(typeof data?.error?.message === 'string' ? data.error.message : [401,403].includes(response.status) ? 'Your access to these records has ended.' : 'The credit result could not be confirmed. Check the recorded result before starting another change.', response.status)
  if (!data) throw new RewardApiError('The credit result could not be read. Check the recorded result or retry this same request.')
  return data
}
export async function readRewards(signal: AbortSignal, requestId?: string, creditId?: string, pages?: RewardPagesQuery): Promise<RewardsResponse> {
  const query = new URLSearchParams(); if (creditId) query.set('id', creditId); if (requestId) query.set('requestId', requestId); if (pages) { query.set('creditPage', String(pages.creditPage)); query.set('referralPage', String(pages.referralPage)) }
  const result = await request('/api/rewards/manage' + (query.size ? '?' + query : ''), signal)
  if (!isRewardsResponse(result) || creditId && result.focusedCreditId !== creditId || pages && (result.pages.credits.page !== pages.creditPage || result.pages.referrals.page !== pages.referralPage)) throw new RewardApiError('The saved credit records could not be verified. Refresh before making a change.')
  return result
}
export async function rewardRequestHash(input: RewardAction): Promise<string> {
  const canonical = JSON.stringify(Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b))))
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
export async function changeReward(input: RewardAction, signal: AbortSignal): Promise<RewardActionResult> {
  const result = await request('/api/rewards/manage/action', signal, input)
  if (!isRewardActionResult(result, input, await rewardRequestHash(input))) throw new RewardApiError('The acknowledgment does not confirm this credit request. Check its recorded result or retry the same request.')
  return result
}
