import { retainedId, retainedUuid } from './retained-record-recovery'

export type RetainedDate = { precision: 'date' | 'instant'; value: string }
export type RetainedFlags = { restricted: boolean; marketingObjected: boolean; accountClosed: boolean; erasureRequested: boolean; sensitiveWithdrawn: boolean }
export type RetainedFact = { date: RetainedDate; canonicalAt: string; evidence: string; recordedAt: string }
export type RetainedTarget = { bookingId: string; service: string; eventDate: string | null; ownership: 'linked' | 'case_contact'; targetVersion: string; currentFact: RetainedFact | null }
export type RetainedBookingSummary = Pick<RetainedTarget, 'bookingId' | 'service' | 'eventDate' | 'ownership'>
export type RetainedAction = 'record_financial_fact' | 'release_restriction'
type Common = { version: 1; id: string; requestId: string; expectedCaseRevision: number; expectedControlRevision: number }
export type RetainedInput = Common & ({ action: 'record_financial_fact'; bookingId: string; expectedTargetVersion: string; date: RetainedDate; evidence: string } | { action: 'release_restriction'; basis: string })
export type RetainedAck = {
  version: 1; ok: true; id: string; requestId: string; requestHash: string; action: RetainedAction; result: 'recorded' | 'unchanged'; recordedAt: string; caseRevision: number; controlRevision: number
  financial: { bookingId: string; submitted: { date: RetainedDate; evidence: string }; effective: RetainedFact } | null
  controlsAfter: RetainedFlags; basis: string | null
}
export type RetainedResult = { requestId: string; state: 'not_found' | 'expired' } | { requestId: string; state: 'abandoned'; action: RetainedAction; recordedAt: string } | { requestId: string; state: 'recorded'; ack: RetainedAck }
export type RetainedRead = {
  version: 1; checkedAt: string; case: { id: string; revision: number; kind: string; status: string }
  controls: RetainedFlags & { revision: number; addressMarketingBlocked: boolean; addressSensitiveWithdrawn: boolean }
  permissions: { canRecordFinancial: boolean; canReleaseRestriction: boolean; reason: string }
  bookings: RetainedBookingSummary[]; selected: RetainedTarget | null
  page: { page: number; limit: 50; total: number; nextPage: number | null; previousPage: number | null }; actionResult: RetainedResult | null
}
const flags = ['restricted', 'marketingObjected', 'accountClosed', 'erasureRequested', 'sensitiveWithdrawn'] as const
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value)
const keys = (v: Record<string, any>, names: string[]) => Object.keys(v).length === names.length && Object.keys(v).every(k => names.includes(k))
const integer = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0
const text = (v: unknown, max = 2000): v is string => typeof v === 'string' && v.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v)
const instant = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(v) && retainedDay(v.slice(0, 10)) && Number.isFinite(Date.parse(v))
const digest = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
const bookingId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$/.test(v)
export function retainedDay(value: unknown): value is string { return typeof value === 'string' && /^\d{4}-\d\d-\d\d$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00.000Z')) && new Date(value + 'T00:00:00.000Z').toISOString().slice(0, 10) === value }
export function isRetainedDate(v: unknown): v is RetainedDate { return record(v) && keys(v, ['precision', 'value']) && (v.precision === 'date' ? retainedDay(v.value) : v.precision === 'instant' && instant(v.value)) }
export function isRetainedFlags(v: unknown): v is RetainedFlags { return record(v) && keys(v, [...flags]) && flags.every(k => typeof v[k] === 'boolean') }
export function isRetainedFact(v: unknown): v is RetainedFact {
  return record(v) && keys(v, ['date', 'canonicalAt', 'evidence', 'recordedAt']) && isRetainedDate(v.date) && instant(v.canonicalAt) && (v.date.precision === 'date' ? v.canonicalAt === v.date.value + 'T00:00:00.000Z' : Date.parse(v.canonicalAt) === Date.parse(v.date.value)) && text(v.evidence) && instant(v.recordedAt)
}
export function isRetainedTarget(v: unknown): v is RetainedTarget { return record(v) && keys(v, ['bookingId', 'service', 'eventDate', 'ownership', 'targetVersion', 'currentFact']) && bookingId(v.bookingId) && text(v.service, 200) && (v.eventDate === null || text(v.eventDate, 100)) && ['linked', 'case_contact'].includes(v.ownership) && digest(v.targetVersion) && (v.currentFact === null || isRetainedFact(v.currentFact)) }
export function isRetainedBookingSummary(v: unknown): v is RetainedBookingSummary { return record(v) && keys(v, ['bookingId', 'service', 'eventDate', 'ownership']) && bookingId(v.bookingId) && text(v.service, 200) && (v.eventDate === null || text(v.eventDate, 100)) && ['linked', 'case_contact'].includes(v.ownership) }
export function isRetainedAck(v: unknown, expected?: { id: string; requestId: string; input?: RetainedInput; hash?: string }): v is RetainedAck {
  if (!record(v) || !keys(v, ['version', 'ok', 'id', 'requestId', 'requestHash', 'action', 'result', 'recordedAt', 'caseRevision', 'controlRevision', 'financial', 'controlsAfter', 'basis']) || v.version !== 1 || v.ok !== true || !retainedId(v.id) || !retainedUuid(v.requestId) || !digest(v.requestHash) || !['record_financial_fact', 'release_restriction'].includes(v.action) || !['recorded', 'unchanged'].includes(v.result) || !instant(v.recordedAt) || !integer(v.caseRevision) || !integer(v.controlRevision) || !isRetainedFlags(v.controlsAfter)) return false
  if (v.action === 'record_financial_fact') {
    const f = v.financial
    if (v.basis !== null || !record(f) || !keys(f, ['bookingId', 'submitted', 'effective']) || !bookingId(f.bookingId) || !record(f.submitted) || !keys(f.submitted, ['date', 'evidence']) || !isRetainedDate(f.submitted.date) || !text(f.submitted.evidence) || !isRetainedFact(f.effective)) return false
    if (v.result === 'recorded' && (JSON.stringify(f.effective.date) !== JSON.stringify(f.submitted.date) || f.effective.evidence !== f.submitted.evidence)) return false
    const submittedAt = f.submitted.date.precision === 'date' ? f.submitted.date.value + 'T00:00:00.000Z' : f.submitted.date.value
    if (v.result === 'unchanged' && Date.parse(f.effective.canonicalAt) < Date.parse(submittedAt)) return false
  } else if (v.financial !== null || !text(v.basis, 1000) || v.basis.trim().length < 20 || v.controlsAfter.restricted !== false || v.result !== 'recorded') return false
  if (expected && (v.id !== expected.id || v.requestId !== expected.requestId || expected.hash && v.requestHash !== expected.hash)) return false
  const input = expected?.input
  if (input) {
    if (v.action !== input.action || v.caseRevision !== input.expectedCaseRevision || v.controlRevision !== input.expectedControlRevision + (input.action === 'release_restriction' ? 1 : 0)) return false
    if (input.action === 'record_financial_fact') {
      if (v.financial.bookingId !== input.bookingId || JSON.stringify(v.financial.submitted.date) !== JSON.stringify(input.date) || v.financial.submitted.evidence !== input.evidence.trim()) return false
    } else if (v.basis !== input.basis.trim()) return false
  }
  return true
}
export function isRetainedResult(v: unknown, id: string, requestId?: string): v is RetainedResult {
  return record(v) && retainedUuid(v.requestId) && (!requestId || v.requestId === requestId) && (v.state === 'recorded' ? keys(v, ['requestId', 'state', 'ack']) && isRetainedAck(v.ack, { id, requestId: v.requestId }) : v.state === 'abandoned' ? keys(v, ['requestId', 'state', 'action', 'recordedAt']) && ['record_financial_fact', 'release_restriction'].includes(v.action) && instant(v.recordedAt) : ['not_found', 'expired'].includes(v.state) && keys(v, ['requestId', 'state']))
}
export function isRetainedRead(v: unknown, id: string, requestId?: string): v is RetainedRead {
  if (!record(v) || !keys(v, ['version', 'checkedAt', 'case', 'controls', 'permissions', 'bookings', 'selected', 'page', 'actionResult']) || v.version !== 1 || !instant(v.checkedAt) || !record(v.case) || !keys(v.case, ['id', 'revision', 'kind', 'status']) || v.case.id !== id || !integer(v.case.revision) || !text(v.case.kind, 100) || !['pending', 'in_review', 'needs_information', 'completed', 'declined'].includes(v.case.status)) return false
  if (!record(v.controls) || !keys(v.controls, [...flags, 'revision', 'addressMarketingBlocked', 'addressSensitiveWithdrawn']) || !integer(v.controls.revision) || ![...flags, 'addressMarketingBlocked', 'addressSensitiveWithdrawn'].every(k => typeof v.controls[k] === 'boolean')) return false
  if (!record(v.permissions) || !keys(v.permissions, ['canRecordFinancial', 'canReleaseRestriction', 'reason']) || typeof v.permissions.canRecordFinancial !== 'boolean' || typeof v.permissions.canReleaseRestriction !== 'boolean' || !text(v.permissions.reason)) return false
  if (!['pending', 'in_review', 'needs_information'].includes(v.case.status) && (v.permissions.canRecordFinancial || v.permissions.canReleaseRestriction) || v.permissions.canReleaseRestriction && !v.controls.restricted) return false
  if (!Array.isArray(v.bookings) || v.bookings.length > 50 || !v.bookings.every(isRetainedBookingSummary) || new Set(v.bookings.map((b: RetainedBookingSummary) => b.bookingId)).size !== v.bookings.length || v.selected !== null && !isRetainedTarget(v.selected)) return false
  const p = v.page
  if (!record(p) || !keys(p, ['page', 'limit', 'total', 'nextPage', 'previousPage']) || !integer(p.page) || p.limit !== 50 || !integer(p.total) || p.total < v.bookings.length || p.nextPage !== null && p.nextPage !== p.page + 1 || p.previousPage !== (p.page > 0 ? p.page - 1 : null)) return false
  if (v.selected) { const same = v.bookings.find((b: RetainedBookingSummary) => b.bookingId === v.selected.bookingId); if (same && (['bookingId', 'service', 'eventDate', 'ownership'] as const).some(k => same[k] !== v.selected[k])) return false }
  if (requestId ? !isRetainedResult(v.actionResult, id, requestId) : v.actionResult !== null) return false
  return true
}
