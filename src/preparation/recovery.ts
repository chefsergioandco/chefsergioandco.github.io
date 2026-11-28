import { isPreparationId, isPreparationUuid, type PreparationOperation } from './types'

/** Private pseudonymous metadata only. Neither raw answers nor a guessable body digest belongs in browser storage. */
export type PreparationRecovery = { version: 1; bookingId: string; requestId: string; operation: PreparationOperation; expectedRevision: number }
export type PreparationRecoveryRead = { kind: 'empty' } | { kind: 'pending'; marker: PreparationRecovery } | { kind: 'unavailable' | 'invalid' }
const prefix = 'sergio-preparation-recovery-v1:'
const key = (actor: string, bookingId: string, operation: PreparationOperation) => prefix + encodeURIComponent(actor) + ':' + encodeURIComponent(bookingId) + ':' + operation
export function isPreparationRecovery(v: unknown): v is PreparationRecovery {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const marker = v as Record<string, unknown>
  return Object.keys(marker).length === 5 && Object.keys(marker).every(name => ['version','bookingId','requestId','operation','expectedRevision'].includes(name)) && marker.version === 1 && isPreparationId(marker.bookingId) && isPreparationUuid(marker.requestId) && ['save','review'].includes(String(marker.operation)) && Number.isSafeInteger(marker.expectedRevision) && Number(marker.expectedRevision) >= 0
}
export function readPreparationRecovery(actor: string, bookingId: string, operation: PreparationOperation): PreparationRecoveryRead {
  try { const raw = sessionStorage.getItem(key(actor, bookingId, operation)); if (raw === null) return { kind: 'empty' }; if (raw.length > 1000) return { kind: 'invalid' }; const marker: unknown = JSON.parse(raw); return isPreparationRecovery(marker) && marker.bookingId === bookingId && marker.operation === operation ? { kind: 'pending', marker } : { kind: 'invalid' } } catch { return { kind: 'unavailable' } }
}
export function storePreparationRecovery(actor: string, marker: PreparationRecovery): boolean {
  if (!isPreparationRecovery(marker)) return false
  try { const raw = JSON.stringify(marker); sessionStorage.setItem(key(actor, marker.bookingId, marker.operation), raw); return sessionStorage.getItem(key(actor, marker.bookingId, marker.operation)) === raw } catch { return false }
}
export function clearPreparationRecovery(actor: string, marker: PreparationRecovery): boolean {
  try { const saved = readPreparationRecovery(actor, marker.bookingId, marker.operation); if (saved.kind === 'pending' && saved.marker.requestId !== marker.requestId) return false; sessionStorage.removeItem(key(actor, marker.bookingId, marker.operation)); return sessionStorage.getItem(key(actor, marker.bookingId, marker.operation)) === null } catch { return false }
}
/** This digest exists only in memory while the exact request is available, and in the authorized server journal. */
export async function preparationRequestHash(input: object): Promise<string> {
  const canonical = JSON.stringify(Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b))))
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
}
