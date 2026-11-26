import { booking } from '../content/booking'

/** Referral calls to the booking service. Kept apart from api.ts: a referral never blocks or changes a booking. */
export type FriendInvite = { code: string; name: string; welcome: number; services: string[]; source: 'link' | 'invitation' }
const FRIEND_KEY = 'booking-friend:v1'
const CODE = /^[2-9A-HJKMNP-Z]{8}$/

function base() { return booking.apiBase?.replace(/\/$/, '') || '' }
async function post<T>(path: string, body: unknown, timeout = 6000): Promise<T> {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout)
  try {
    const response = await fetch(base() + path, { method: 'POST', signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer', headers: { 'Content-Type': 'application/json', 'X-Booking-Request': '1', Accept: 'application/json' }, body: JSON.stringify(body) })
    const value = await response.json().catch(() => null)
    if (!response.ok) throw new Error(typeof value?.message === 'string' ? value.message : 'The invitation could not be checked.')
    return value as T
  } finally { clearTimeout(timer) }
}

/** The friend code from ?friend= (kept for this visit), or the one remembered from earlier in the visit. */
export function pendingFriendCode(): { code: string; source: 'link' | 'invitation' } | null {
  try {
    const query = new URLSearchParams(location.search), code = (query.get('friend') || '').toUpperCase()
    if (CODE.test(code)) {
      const value = { code, source: query.get('via') === 'invitation' ? 'invitation' as const : 'link' as const }
      sessionStorage.setItem(FRIEND_KEY, JSON.stringify(value)); return value
    }
    const saved = JSON.parse(sessionStorage.getItem(FRIEND_KEY) || 'null')
    return saved && CODE.test(saved.code) ? saved : null
  } catch { return null }
}
export function forgetFriendCode() { try { sessionStorage.removeItem(FRIEND_KEY) } catch { /* Nothing to forget. */ } }

export async function lookupFriend(code: string, source: 'link' | 'invitation'): Promise<FriendInvite | null> {
  if (!base() || !CODE.test(code)) return null
  const response = await fetch(`${base()}/api/referral?code=${encodeURIComponent(code)}`, { credentials: 'omit', referrerPolicy: 'no-referrer', headers: { Accept: 'application/json' } })
  const value = response.ok ? await response.json().catch(() => null) : null
  return value?.valid === true && typeof value.name === 'string' && typeof value.welcome === 'number' ? { code: value.code, name: value.name, welcome: value.welcome, services: Array.isArray(value.services) ? value.services : [], source } : null
}
/** Record the welcome gift on a booking just made. Best effort: the booking stands either way. */
export function attachFriend(ref: string, accessToken: string, friend: FriendInvite) {
  return post<{ ok: boolean; welcome: number }>('/api/referral/attach', { ref, accessToken, code: friend.code, source: friend.source }, 4000)
}
/** After the evening, a guest's private invitation offers the host's link. */
export function hostInvite(id: string, accessToken: string) {
  return post<{ available: boolean; code?: string; host?: string; welcome?: number }>('/api/invitation/referral', { id, accessToken })
}
