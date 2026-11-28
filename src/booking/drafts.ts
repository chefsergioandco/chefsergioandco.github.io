import { EMPTY, migrateLegacyDraft, privateDraftState, validDraft, type PlanningState } from './planning'
import { QUICK_EMPTY, type QuickState } from './quick'
import type { Kind } from './types'
export const BOOKING_DRAFT_KEY = 'booking-draft:v3'
export type BookingDraftMode = 'quick' | 'details' | 'seats'
/** An explicit ordinary-data allowlist; never spread a stored object into form state. */
export type BookingDraftData = Pick<PlanningState, 'kind' | 'dateMode' | 'date' | 'time' | 'dateFrom' | 'dateTo' | 'partyBandId' | 'headcountMode' | 'guests' | 'where' | 'budgetMode' | 'budgetMin' | 'budgetMax' | 'budgetUnit' | 'nightId' | 'seats' | 'name' | 'email' | 'phone' | 'contactBy' | 'physicalInvitations'>
export type BookingDraft = { version: 3; id: string; mode: BookingDraftMode; savedAt: string; step: number; data: BookingDraftData }
const allowed = ['kind','dateMode','date','time','dateFrom','dateTo','partyBandId','headcountMode','guests','where','budgetMode','budgetMin','budgetMax','budgetUnit','nightId','seats','name','email','phone','contactBy','physicalInvitations'] as const
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }
export function draftData(state: PlanningState): BookingDraftData {
  return { ...(state.kind ? { kind: state.kind } : {}), dateMode: state.dateMode, ...(state.date ? { date: state.date } : {}), ...(state.time ? { time: state.time } : {}), dateFrom: state.dateFrom, dateTo: state.dateTo, partyBandId: state.partyBandId, headcountMode: state.headcountMode, ...(state.guests !== undefined ? { guests: state.guests } : {}), where: state.where, budgetMode: state.budgetMode, budgetMin: state.budgetMin, budgetMax: state.budgetMax, budgetUnit: state.budgetUnit, ...(state.nightId ? { nightId: state.nightId } : {}), seats: state.seats, name: state.name, email: state.email, phone: state.phone, contactBy: state.contactBy, physicalInvitations: state.physicalInvitations }
}
export function draftPlanning(value: BookingDraftData): PlanningState {
  const s = { ...EMPTY }
  for (const key of allowed) if (Object.hasOwn(value, key)) (s as unknown as Record<string, unknown>)[key] = value[key]
  return s
}
export function quickPlanning(state: QuickState): PlanningState { return { ...EMPTY, kind: state.format, dateMode: state.dateMode, date: state.date, time: state.time, partyBandId: state.partyBandId, where: state.where, place: state.place, gift: state.gift, name: state.name, email: state.email, phone: state.phone, contactBy: state.contactBy } }
export function planningQuick(state: PlanningState): QuickState { return { ...QUICK_EMPTY, format: state.kind === 'table' ? undefined : state.kind, partyBandId: state.partyBandId, dateMode: state.dateMode === 'exact' ? 'exact' : 'undecided', date: state.dateMode === 'exact' ? state.date : undefined, time: state.dateMode === 'exact' ? state.time : undefined, where: state.where, place: state.place, gift: state.gift, name: state.name, email: state.email, phone: state.phone, contactBy: state.contactBy } }
export function makeBookingDraft(mode: BookingDraftMode, state: PlanningState, step: number): BookingDraft { return { version: 3, id: crypto.randomUUID(), mode, savedAt: new Date().toISOString(), step: mode === 'quick' ? 0 : Math.max(0, Math.min(3, step)), data: draftData(state) } }
export function isBookingDraft(value: unknown): value is BookingDraft {
  if (!object(value) || Object.keys(value).some(k => !['version','id','mode','savedAt','step','data'].includes(k)) || value.version !== 3 || typeof value.id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value.id) || !['quick','details','seats'].includes(String(value.mode)) || !object(value.data) || Object.keys(value.data).some(k => !(allowed as readonly string[]).includes(k))) return false
  const state = draftPlanning(value.data as BookingDraftData)
  if (!validDraft({ version: 2, savedAt: value.savedAt, step: value.step, s: state })) return false
  return value.mode === 'quick' ? value.step === 0 && (state.kind === undefined || ['dinner','class','event'].includes(String(state.kind))) && state.dateMode !== 'flexible' && state.headcountMode === 'approximate' : value.mode === 'seats' ? state.kind === 'table' : state.kind === undefined ? value.step === 0 : ['dinner','class','event'].includes(String(state.kind))
}
export type BookingDraftRead = { kind: 'empty' } | { kind: 'draft'; draft: BookingDraft } | { kind: 'unavailable' }
export function readBookingDraft(): BookingDraftRead {
  try {
    const parse = (key: string) => { const raw = localStorage.getItem(key); if (!raw) return null; try { return raw.length <= 20_000 ? JSON.parse(raw) : null } catch { localStorage.removeItem(key); return null } }
    const candidate = parse(BOOKING_DRAFT_KEY)
    if (isBookingDraft(candidate)) { localStorage.removeItem('booking-draft:v2'); localStorage.removeItem('booking-draft'); return { kind: 'draft', draft: candidate } }
    localStorage.removeItem(BOOKING_DRAFT_KEY)
    const v2 = parse('booking-draft:v2'), old = validDraft(v2) ? v2 : migrateLegacyDraft(parse('booking-draft'))
    if (old) {
      const clean = makeBookingDraft(old.s.kind === 'table' ? 'seats' : 'details', privateDraftState(old.s), old.step); clean.savedAt = old.savedAt
      const stored = isBookingDraft(clean) && writeBookingDraft(clean)
      localStorage.removeItem('booking-draft:v2'); localStorage.removeItem('booking-draft')
      return stored ? { kind: 'draft', draft: clean } : { kind: 'unavailable' }
    }
    localStorage.removeItem('booking-draft:v2'); localStorage.removeItem('booking-draft'); return { kind: 'empty' }
  } catch { return { kind: 'unavailable' } }
}
export function writeBookingDraft(draft: BookingDraft): boolean { if (!isBookingDraft(draft)) return false; try { const raw = JSON.stringify(draft); localStorage.setItem(BOOKING_DRAFT_KEY, raw); return localStorage.getItem(BOOKING_DRAFT_KEY) === raw } catch { return false } }
export function clearBookingDraft(): boolean { try { for (const key of [BOOKING_DRAFT_KEY,'booking-draft:v2','booking-draft']) localStorage.removeItem(key); return localStorage.getItem(BOOKING_DRAFT_KEY) === null } catch { return false } }
export function draftHasWork(state: PlanningState): boolean { return !!(state.partyBandId || state.date || state.dateFrom || state.dateTo || state.nightId || state.name || state.email || state.phone || state.headcountMode === 'exact' || state.budgetMode === 'range' || state.physicalInvitations) }
/** Cross-route handoff is memory only. The URL carries the form mode/service, never answers or capabilities. */
let handoff: { state: PlanningState; mode: BookingDraftMode; step: number } | null = null
export function putBookingHandoff(state: PlanningState, mode: BookingDraftMode, step: number) { handoff = { state: { ...privateDraftState(state), place: state.place, gift: state.gift }, mode, step } }
export function takeBookingHandoff() { const value = handoff; handoff = null; return value }
export const bookingKindLabel = (kind?: Kind) => kind ? ({ dinner: 'private dinner', class: 'private cooking class', event: 'small event', table: 'published evening' })[kind] : 'gathering'

if (typeof window !== 'undefined') window.addEventListener('pagehide', () => { handoff = null })

/** A confirmed old request must never erase another form's newer ordinary draft. */
export function clearMatchingBookingDraft(id: string): boolean { try { const raw = localStorage.getItem(BOOKING_DRAFT_KEY); if (!raw) return true; const current = JSON.parse(raw); if (!isBookingDraft(current) || current.id !== id) return true; localStorage.removeItem(BOOKING_DRAFT_KEY); return localStorage.getItem(BOOKING_DRAFT_KEY) === null } catch { return false } }
