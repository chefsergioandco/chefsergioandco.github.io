import { booking } from '../content/booking'

/** Referral calls to the booking service. Kept apart from api.ts: a referral never blocks or changes a booking. */
export type FriendCode = { code: string; source: 'link' | 'invitation' }
export type FriendInvite = FriendCode & { name: string; welcome: number; services: string[] }
const FRIEND_KEY = 'booking-friend:v1'
const CODE = /^[2-9A-HJKMNP-Z]{8}$/

function base() { return booking.apiBase?.replace(/\/$/, '') || '' }
async function post<T>(path: string, body: unknown, timeout = 6000): Promise<T> {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout)
  try {
    const response = await fetch(base() + path, { method: 'POST', signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', headers: { 'Content-Type': 'application/json', 'X-Booking-Request': '1', Accept: 'application/json' }, body: JSON.stringify(body) })
    const value = await response.json().catch(() => null)
    const error = value?.error ?? value
    if (!response.ok) throw new Error(typeof error?.message === 'string' ? error.message : 'The invitation could not be checked.')
    return value as T
  } finally { clearTimeout(timer) }
}

/** The friend code from ?friend= (kept for this visit), or the one remembered from earlier in the visit. */
export function pendingFriendCode(): FriendCode | null {
  try {
    const query = new URLSearchParams(location.search), code = (query.get('friend') || '').toUpperCase()
    if (CODE.test(code)) {
      const value = { code, source: query.get('via') === 'invitation' ? 'invitation' as const : 'link' as const }
      try { sessionStorage.setItem(FRIEND_KEY, JSON.stringify(value)) } catch { /* The link still works without storage. */ }
      return value
    }
    const saved = JSON.parse(sessionStorage.getItem(FRIEND_KEY) || 'null')
    return saved && typeof saved.code === 'string' && CODE.test(saved.code) ? { code: saved.code, source: saved.source === 'invitation' ? 'invitation' : 'link' } : null
  } catch { return null }
}
export function forgetFriendCode(code?: string) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(FRIEND_KEY) || 'null')
    if (!code || saved?.code === code) sessionStorage.removeItem(FRIEND_KEY)
  } catch { /* Nothing to forget. */ }
}

export async function lookupFriend(code: string, source: 'link' | 'invitation'): Promise<FriendInvite | null> {
  if (!base() || !CODE.test(code)) return null
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 6000)
  try {
    const response = await fetch(`${base()}/api/referral?code=${encodeURIComponent(code)}`, { signal: controller.signal, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error('The invitation could not be checked. You can still send your booking request.')
    const value = await response.json().catch(() => null)
    if (value?.valid === false) return null
    if (value?.valid !== true || value.code !== code || typeof value.name !== 'string' || !value.name.trim() || typeof value.welcome !== 'number' || !Number.isFinite(value.welcome) || value.welcome < 0 || !Array.isArray(value.services) || value.services.some((service: unknown) => typeof service !== 'string')) throw new Error('The invitation details were incomplete. You can still send your booking request.')
    return { code, name: value.name, welcome: value.welcome, services: value.services, source }
  } finally { clearTimeout(timer) }
}
/** Record the welcome gift on a booking just made. Best effort: the booking stands either way. */
export async function attachFriend(ref: string, accessToken: string, friend: FriendCode) {
  const result = await post<{ ok: boolean; welcome: number }>('/api/referral/attach', { ref, accessToken, code: friend.code, source: friend.source }, 4000)
  if (result?.ok !== true || typeof result.welcome !== 'number' || !Number.isFinite(result.welcome) || result.welcome < 0) throw new Error('The invitation credit was not confirmed. Retry it or ask Sergio to check your saved booking.')
  return result
}
/** After the evening, a guest's private invitation offers the host's link. */
export function hostInvite(id: string, accessToken: string) {
  return post<{ available: boolean; code?: string; host?: string; welcome?: number }>('/api/invitation/referral', { id, accessToken })
}
