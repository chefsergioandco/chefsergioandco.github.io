import { clearMatchingBookingDraft } from './drafts'
import type { BookingRequest, HoldOptions, PublicHoldResult } from './types'
export type IntakeMarker = { version: 1; operation: 'hold' | 'request'; requestId: string; checkoutRequestId?: string; createdAt: string; phase?: 'received' | 'rejected'; rejectionCode?: 'unavailable' | 'seats-gone'; ref?: string; draftId?: string }
export type IntakeKnown = { version: 1; requestId: string; ref: string; receivedAt: string; draftId?: string }
export type IntakeState = { kind: 'clear'; rejectedRequestId?: string } | { kind: 'pending'; marker: IntakeMarker; canRetry: boolean; busy: boolean; known: IntakeKnown | null; accessSaved?: boolean } | { kind: 'legacy'; references: string[] } | { kind: 'invalid' | 'unavailable' }
type Intent = { marker: IntakeMarker; request: BookingRequest; honeypot: string; options: HoldOptions; comparison: string; body: Record<string, unknown>; busy: boolean; dispatched: number; hadUnknown: boolean; result?: PublicHoldResult }
const memories = new Map<string, Intent>()
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v)
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const instant = (v: unknown) => typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v))
const scope = (base: string) => new URL(base).origin
const markerKey = (base: string) => 'booking-intake-pending:v1:' + encodeURIComponent(scope(base))
const knownKey = (base: string) => 'booking-intake-received:v1:' + encodeURIComponent(scope(base))
export const INTAKE_EVENT = 'booking:intake-changed'
function hasStoredAccess(ref: string) { try { return /^[A-Za-z0-9_-]{43}$/.test(sessionStorage.getItem('booking-access:' + ref) || '') } catch { return false } }
function emit() { if (typeof window !== 'undefined') window.dispatchEvent(new Event(INTAKE_EVENT)) }
export function isIntakeMarker(v: unknown): v is IntakeMarker { return object(v) && Object.keys(v).every(k => ['version','operation','requestId','checkoutRequestId','createdAt','phase','ref','draftId','rejectionCode'].includes(k)) && v.version === 1 && ['hold','request'].includes(String(v.operation)) && uuid(v.requestId) && (v.checkoutRequestId === undefined || uuid(v.checkoutRequestId) && v.checkoutRequestId !== v.requestId && v.operation === 'hold') && instant(v.createdAt) && (v.phase === undefined ? v.ref === undefined && v.draftId === undefined && v.rejectionCode === undefined : v.phase === 'rejected' ? v.ref === undefined && v.draftId === undefined && ['unavailable','seats-gone'].includes(String(v.rejectionCode)) : v.phase === 'received' && v.rejectionCode === undefined && typeof v.ref === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(v.ref) && (v.draftId === undefined || uuid(v.draftId))) }
export function readKnownIntake(base: string): IntakeKnown | null { try { const v = JSON.parse(sessionStorage.getItem(knownKey(base)) || 'null'); return object(v) && Object.keys(v).every(k => ['version','requestId','ref','receivedAt','draftId'].includes(k)) && v.version === 1 && uuid(v.requestId) && typeof v.ref === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(v.ref) && instant(v.receivedAt) && (v.draftId === undefined || uuid(v.draftId)) ? v as IntakeKnown : null } catch { return null } }
export function readIntake(base: string): IntakeState {
  try {
    let rejectedRequestId: string | undefined
    const raw = localStorage.getItem(markerKey(base))
    if (raw !== null) { if (raw.length > 1000) return { kind: 'invalid' }; const marker = JSON.parse(raw); if (!isIntakeMarker(marker)) return { kind: 'invalid' }; if (marker.phase === 'rejected') rejectedRequestId = marker.requestId; else { const memory = memories.get(scope(base)), storedKnown = readKnownIntake(base), known = storedKnown || (memory?.result ? { version: 1 as const, requestId: memory.marker.requestId, ref: memory.result.ref, receivedAt: memory.marker.createdAt, ...(memory.options.draftId ? { draftId: memory.options.draftId } : {}) } : null); return { kind: 'pending', marker, canRetry: memory?.marker.requestId === marker.requestId && !memory.busy && !memory.result, busy: memory?.marker.requestId === marker.requestId && memory.busy || false, known: known?.requestId === marker.requestId ? known : null, accessSaved: !!known && hasStoredAccess(known.ref) } } }
    const prefix = 'booking-pending:v1:' + encodeURIComponent(scope(base)) + ':'
    const references: string[] = []
    for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (!key || ![prefix + 'request:', prefix + 'request-checkout:'].some(p => key.startsWith(p))) continue; const value = localStorage.getItem(key); if (!uuid(value)) return { kind: 'invalid' }; if (!references.includes(value)) references.push(value) }
    return references.length ? { kind: 'legacy', references } : { kind: 'clear', ...(rejectedRequestId ? { rejectedRequestId } : {}) }
  } catch { return { kind: 'unavailable' } }
}
async function exclusive<T>(base: string, action: () => T | Promise<T>): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks?.request) throw new Error('This browser cannot safely save a request for recovery. Try another browser or call Sergio. No new request was sent.')
  return navigator.locks.request('booking-intake:' + scope(base), { ifAvailable: true }, async lock => { if (!lock) throw new Error('Another tab is checking a booking request. Wait for it, then check this page. No new request was sent.'); return action() })
}
/** Persist an opaque original identity atomically before any request transport. Raw intent stays in memory. */
export async function claimIntake(base: string, request: BookingRequest, honeypot: string, options: HoldOptions): Promise<Intent> {
  return exclusive(base, () => {
    const current = readIntake(base), comparison = JSON.stringify({ request, honeypot, checkout: options.checkout === true })
    if (current.kind === 'pending') { const old = memories.get(scope(base)); if (old?.marker.requestId === current.marker.requestId && old.comparison === comparison && old.options.ownerId === options.ownerId && !old.busy && !old.result) { old.busy = true; emit(); return old }; throw new Error('An earlier request needs checking. Use Retry original request if available, or contact Sergio before sending another. Starting a fresh draft does not resolve it.') }
    if (current.kind !== 'clear') throw new Error(current.kind === 'legacy' ? 'An earlier request from this browser needs checking. Contact Sergio with its submission reference before sending another.' : 'This browser cannot verify its booking recovery record. Allow local storage, then try again, or contact Sergio. No new request was sent.')
    const marker: IntakeMarker = { version: 1, operation: request.kind === 'event' ? 'request' : 'hold', requestId: crypto.randomUUID(), ...(options.checkout && request.kind !== 'event' ? { checkoutRequestId: crypto.randomUUID() } : {}), createdAt: new Date().toISOString() }
    const elapsed = Number.isSafeInteger(options.elapsedMs) && options.elapsedMs! >= 0 && options.elapsedMs! <= 3_600_000 ? options.elapsedMs : undefined
    const captured = structuredClone(request), intent: Intent = { marker, request: captured, honeypot, options: { ...options }, comparison, dispatched: 0, hadUnknown: false, body: { request: captured, requestId: marker.requestId, honeypot, ...(marker.checkoutRequestId ? { checkoutRequestId: marker.checkoutRequestId } : {}), ...(elapsed !== undefined ? { elapsedMs: elapsed } : {}) }, busy: true }
    const raw = JSON.stringify(marker)
    try { localStorage.setItem(markerKey(base), raw); if (localStorage.getItem(markerKey(base)) !== raw) throw new Error() } catch { throw new Error('This browser cannot keep a booking recovery record. Allow local storage, then try again, or call Sergio. No new request was sent.') }
    memories.set(scope(base), intent); emit(); return intent
  })
}
export function finishIntakeAttempt(base: string, intent: Intent) { if (memories.get(scope(base)) === intent) intent.busy = false; emit() }
export async function receivedIntake(base: string, intent: Intent, result: PublicHoldResult, proofStored: boolean): Promise<void> {
  intent.result = result
  const known: IntakeKnown = { version: 1, requestId: intent.marker.requestId, ref: result.ref, receivedAt: new Date().toISOString(), ...(intent.options.draftId && uuid(intent.options.draftId) ? { draftId: intent.options.draftId } : {}) }
  let knownStored = false
  try { const raw = JSON.stringify(known); sessionStorage.setItem(knownKey(base), raw); knownStored = sessionStorage.getItem(knownKey(base)) === raw } catch { /* A known receipt remains available in memory; unresolved durable marker is kept. */ }
  const draftCleared = !known.draftId || clearMatchingBookingDraft(known.draftId)
  if (proofStored && knownStored && draftCleared) await exclusive(base, () => { const current = readIntake(base); if (current.kind !== 'pending' || current.marker.requestId !== intent.marker.requestId) return; const marker: IntakeMarker = { ...intent.marker, phase: 'received', ref: result.ref, ...(known.draftId ? { draftId: known.draftId } : {}) }; const raw = JSON.stringify(marker); localStorage.setItem(markerKey(base), raw); if (localStorage.getItem(markerKey(base)) !== raw) throw new Error('Your request was received, but this browser could not record its completion. Contact Sergio before starting another request.') })
  emit()
}
export async function clearConfirmedIntake(base: string, requestId: string) { await exclusive(base, () => { const state = readIntake(base); if (state.kind !== 'pending' || state.marker.requestId !== requestId) return; localStorage.removeItem(markerKey(base)); if (localStorage.getItem(markerKey(base)) !== null) throw new Error('Your request was received, but this browser could not clear its recovery record. Open the saved booking or contact Sergio before starting another request.'); memories.delete(scope(base)) }); emit() }
export function exactIntakeRetry(base: string) { const state = readIntake(base), memory = memories.get(scope(base)); return state.kind === 'pending' && memory?.marker.requestId === state.marker.requestId && !memory.busy && !memory.result ? { request: memory.request, honeypot: memory.honeypot, options: memory.options } : null }
export function knownIntakeResult(base: string) { const state = readIntake(base), memory = memories.get(scope(base)); return state.kind === 'pending' && memory?.marker.requestId === state.marker.requestId ? memory.result || null : null }

/** Trusted precommit409 only on the first dispatched UUID. Prior uncertainty is never treated as absence. */
export async function rejectFirstIntake(base: string, intent: Intent, failure: unknown): Promise<boolean> { const error = failure as { status?: number; serverCode?: string }; if (intent.dispatched !== 1 || intent.hadUnknown || error?.status !== 409 || !['unavailable','seats-gone'].includes(error.serverCode || '')) { intent.hadUnknown = true; return false }; await exclusive(base, () => { const current = readIntake(base); if (current.kind !== 'pending' || current.marker.requestId !== intent.marker.requestId) return; const raw = JSON.stringify({ ...intent.marker, phase: 'rejected', rejectionCode: error.serverCode }); localStorage.setItem(markerKey(base), raw); if (localStorage.getItem(markerKey(base)) !== raw) throw new Error('The rejected request could not be recorded safely. Contact Sergio before trying again.'); memories.delete(scope(base)) }); emit(); return true }
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => { memories.clear(); emit() })

export async function startDifferentIntake(base: string, observed?: IntakeMarker) { await exclusive(base, () => { const current = readIntake(base); if (current.kind === 'clear' && observed?.phase === 'received') return; if (current.kind !== 'pending' || current.marker.phase !== 'received') throw new Error('The earlier request is unresolved. Contact Sergio before starting another plan.'); if (current.marker.draftId && !clearMatchingBookingDraft(current.marker.draftId)) throw new Error('The submitted draft could not be cleared. Allow storage and try again.'); localStorage.removeItem(markerKey(base)); if (localStorage.getItem(markerKey(base)) !== null) throw new Error('This browser could not record the new-plan choice. Allow storage and try again.'); const known = readKnownIntake(base); if (known?.requestId === current.marker.requestId) sessionStorage.removeItem(knownKey(base)); memories.delete(scope(base)) }); emit() }

export function intakeOwner(base: string) { return memories.get(scope(base))?.options.ownerId }
