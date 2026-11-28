import type { SensitiveDataConsent } from '../privacy/policy'

export const PREPARATION_FIELDS = ['occasion', 'kitchen', 'foodIdeas', 'dietary', 'allergies', 'notes', 'budget', 'physicalInvitations'] as const
export type PreparationField = typeof PREPARATION_FIELDS[number]
export type PreparationBudget = { mode: 'guidance' } | { mode: 'range'; min: number; max: number; unit: 'total' | 'per_person' }
export type PreparationValue = string | string[] | PreparationBudget | boolean
export type PreparationChange = { op: 'set'; value: PreparationValue } | { op: 'clear' }
export type PreparationChanges = Partial<Record<PreparationField, PreparationChange>>
export type PreparationSource = 'initial_form' | 'initial_quick' | 'initial_unknown' | 'legacy_retained' | 'receipt' | 'account' | 'staff_review' | null
export type PreparationSnapshot = { state: 'recorded' | 'not_provided' | 'unavailable' | 'cleared' | 'removed'; value: PreparationValue | null; entryId: string | null; savedAt: string | null; source: PreparationSource; provenance: 'explicit' | 'defaulted' | 'retained' | 'unavailable' | 'removed' }
export type PreparationProposal = { id: string; field: PreparationField; operation: 'set' | 'clear'; value: PreparationValue | null; submittedAt: string; status: 'pending' | 'discussion'; canReview?: boolean }
export type PreparationFieldRecord = { label: string; original: PreparationSnapshot; accepted: PreparationSnapshot; pending: PreparationProposal | null; operatorRevision: number; editMode: 'direct' | 'review' | 'closed'; agreementReview: boolean; canConfirm: boolean; confirmMode: 'arrangements' | 'privacy' | null }
export type PreparationHistory = { id: string; field: PreparationField; operation: 'set' | 'clear' | 'confirm'; source: PreparationSource; status: 'accepted' | 'pending' | 'superseded' | 'declined' | 'discussion' | 'confirmed' | 'removed'; value: PreparationValue | null; at: string; outcomeMessage: string | null }
export type PreparationOutcome = 'accepted' | 'pending_review' | 'unchanged' | 'cleared' | 'withdrawn' | 'declined' | 'discussion' | 'confirmed'
export type PreparationOperation = 'save' | 'review'
export type PreparationAck = { version: 1; bookingId: string; requestId: string; requestHash: string | null; operation: PreparationOperation; state: 'recorded' | 'abandoned'; revision: number; workspaceRevision: number; recordedAt: string; outcomes: Partial<Record<PreparationField, PreparationOutcome>>; entryIds: Partial<Record<PreparationField, string>> }
export type PreparationResponse = {
  version: 1; bookingId: string; revision: number; workspaceRevision: number; checkedAt: string
  context: { service: string; status: string; date: string | null; time: string | null; guests: number | null; location: string; dateReserved: boolean }
  agreed: { date: string | null; time: string | null; guests: number | null; spendingCeiling: number | null; menu: { status: string; text: string; finalizedAt: string | null }; topics: { id: string; status: 'unknown' | 'tentative' | 'agreed' }[] }
  fields: Record<PreparationField, PreparationFieldRecord>
  history: { page: number; nextPage: number | null; previousPage: number | null; entries: PreparationHistory[] }
  actionResult: PreparationAck | null
  permissions: { canSave: boolean; canWithdraw: boolean; canReadHealth: boolean; healthState: 'consented' | 'not_provided' | 'withdrawn' | 'restricted'; reason: string }
  hasPending: boolean; agreementReview: boolean
}
export type PreparationSave = { bookingId: string; requestId: string; expectedRevision: number; expectedWorkspaceRevision: number; changes: PreparationChanges; sensitiveDataConsent?: SensitiveDataConsent }
export type PreparationReview = { bookingId: string; requestId: string; expectedRevision: number; expectedWorkspaceRevision: number; message: string } & ({ action: 'review'; proposalId: string; outcome: 'accept' | 'decline' | 'discussion' } | { action: 'confirm_arrangements'; field: PreparationField; acceptedEntryId: string | null; expectedOperatorRevision: number })
export type PreparationIntent = PreparationSave | PreparationReview

const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown, max = 5000) => typeof v === 'string' && v.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v)
const required = (v: unknown, max = 5000) => text(v, max) && (v as string).trim().length > 0
const keys = (v: Record<string, any>, allowed: readonly string[]) => Object.keys(v).every(key => allowed.includes(key))
const integer = (v: unknown) => Number.isSafeInteger(v) && Number(v) >= 0
const instant = (v: unknown) => typeof v === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v))
const nullableInstant = (v: unknown) => v === null || instant(v)
const nullableText = (v: unknown, max = 5000) => v === null || text(v, max)
const nullableCount = (v: unknown) => v === null || integer(v)
const choice = (v: unknown, allowed: readonly string[]) => typeof v === 'string' && allowed.includes(v)
export const isPreparationId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(v)
export const isPreparationUuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v)
const sources: (string | null)[] = ['initial_form', 'initial_quick', 'initial_unknown', 'legacy_retained', 'receipt', 'account', 'staff_review', null]
export function isPreparationValue(field: PreparationField, value: unknown): value is PreparationValue {
  if (field === 'dietary') return Array.isArray(value) && value.length <= 20 && value.every(v => required(v, 150))
  if (field === 'physicalInvitations') return typeof value === 'boolean'
  if (field === 'budget') return object(value) && (value.mode === 'guidance' ? keys(value, ['mode']) : value.mode === 'range' && keys(value, ['mode','min','max','unit']) && [value.min,value.max].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1_000_000 && Math.abs(n * 100 - Math.round(n * 100)) < .000001) && value.max > 0 && value.max >= value.min && choice(value.unit, ['total','per_person']))
  return text(value, field === 'occasion' ? 1000 : field === 'notes' ? 5000 : field === 'kitchen' ? 3000 : 4000)
}
function snapshot(v: unknown, field: PreparationField): v is PreparationSnapshot {
  return object(v) && keys(v, ['state','value','entryId','savedAt','source','provenance']) && choice(v.state, ['recorded','not_provided','unavailable','cleared','removed']) && (v.state === 'recorded' ? isPreparationValue(field, v.value) : v.value === null) && (v.entryId === null || isPreparationId(v.entryId)) && nullableInstant(v.savedAt) && sources.includes(v.source) && choice(v.provenance, ['explicit','defaulted','retained','unavailable','removed'])
}
export function isPreparationAck(v: unknown, expected?: { bookingId: string; requestId: string; operation: PreparationOperation; requestHash?: string; expectedRevision?: number; expectedWorkspaceRevision?: number }): v is PreparationAck {
  if (!object(v) || !keys(v, ['version','bookingId','requestId','requestHash','operation','state','revision','workspaceRevision','recordedAt','outcomes','entryIds']) || v.version !== 1 || !isPreparationId(v.bookingId) || !isPreparationUuid(v.requestId) || !choice(v.operation, ['save','review']) || !choice(v.state, ['recorded','abandoned']) || !(v.requestHash === null || typeof v.requestHash === 'string' && /^[a-f0-9]{64}$/.test(v.requestHash)) || v.state === 'recorded' && v.requestHash === null || !integer(v.revision) || !integer(v.workspaceRevision) || !instant(v.recordedAt) || !object(v.outcomes) || !keys(v.outcomes, PREPARATION_FIELDS) || !Object.values(v.outcomes).every(outcome => choice(outcome, ['accepted','pending_review','unchanged','cleared','withdrawn','declined','discussion','confirmed'])) || !object(v.entryIds) || !keys(v.entryIds, PREPARATION_FIELDS) || !Object.values(v.entryIds).every(isPreparationId)) return false
  if (v.state === 'abandoned' && (v.requestHash !== null || Object.keys(v.outcomes).length || Object.keys(v.entryIds).length)) return false
  return !expected || v.bookingId === expected.bookingId && v.requestId === expected.requestId && v.operation === expected.operation && (!expected.requestHash || v.state === 'recorded' && v.requestHash === expected.requestHash) && (v.state === 'abandoned' || (expected.expectedRevision === undefined || v.revision === expected.expectedRevision + 1) && (expected.expectedWorkspaceRevision === undefined || v.workspaceRevision === expected.expectedWorkspaceRevision + 1))
}
export function isPreparationResponse(v: unknown, bookingId: string, admin = false): v is PreparationResponse {
  if (!object(v) || !keys(v, ['version','bookingId','revision','workspaceRevision','checkedAt','context','agreed','fields','history','actionResult','permissions','hasPending','agreementReview']) || v.version !== 1 || v.bookingId !== bookingId || !integer(v.revision) || !integer(v.workspaceRevision) || !instant(v.checkedAt) || !object(v.context) || !object(v.agreed) || !object(v.fields) || !keys(v.fields, PREPARATION_FIELDS) || Object.keys(v.fields).length !== PREPARATION_FIELDS.length || !object(v.history) || !object(v.permissions) || typeof v.hasPending !== 'boolean' || typeof v.agreementReview !== 'boolean') return false
  const { context, agreed, history, permissions } = v
  if (!keys(context, ['service','status','date','time','guests','location','dateReserved']) || !required(context.service, 100) || !required(context.status, 100) || !nullableText(context.date, 40) || !nullableText(context.time, 40) || !nullableCount(context.guests) || !text(context.location, 1000) || typeof context.dateReserved !== 'boolean') return false
  if (!keys(agreed, ['date','time','guests','spendingCeiling','menu','topics']) || !nullableText(agreed.date, 40) || !nullableText(agreed.time, 40) || !nullableCount(agreed.guests) || !(agreed.spendingCeiling === null || typeof agreed.spendingCeiling === 'number' && Number.isFinite(agreed.spendingCeiling) && agreed.spendingCeiling >= 0) || !object(agreed.menu) || !keys(agreed.menu, ['status','text','finalizedAt']) || !required(agreed.menu.status, 100) || !text(agreed.menu.text, 10000) || !nullableInstant(agreed.menu.finalizedAt) || !Array.isArray(agreed.topics) || agreed.topics.length > 50 || !agreed.topics.every((topic: unknown) => object(topic) && keys(topic, ['id','status']) && isPreparationId(topic.id) && choice(topic.status, ['unknown','tentative','agreed']))) return false
  if (!keys(permissions, ['canSave','canWithdraw','canReadHealth','healthState','reason']) || !['canSave','canWithdraw','canReadHealth'].every(key => typeof permissions[key] === 'boolean') || !choice(permissions.healthState, ['consented','not_provided','withdrawn','restricted']) || !text(permissions.reason, 2000)) return false
  for (const field of PREPARATION_FIELDS) {
    const record = v.fields[field]
    if (!object(record) || !keys(record, ['label','original','accepted','pending','operatorRevision','editMode','agreementReview','canConfirm','confirmMode']) || !required(record.label, 200) || !snapshot(record.original, field) || !snapshot(record.accepted, field) || !integer(record.operatorRevision) || !choice(record.editMode, ['direct','review','closed']) || typeof record.agreementReview !== 'boolean' || typeof record.canConfirm !== 'boolean' || !(record.confirmMode === null || choice(record.confirmMode, ['arrangements','privacy'])) || !admin && (record.canConfirm || record.confirmMode !== null)) return false
    if (record.pending !== null) {
      const proposal = record.pending
      if (!object(proposal) || !keys(proposal, ['id','field','operation','value','submittedAt','status', ...(admin ? ['canReview'] : [])]) || !isPreparationId(proposal.id) || proposal.field !== field || !choice(proposal.operation, ['set','clear']) || !(proposal.operation === 'clear' ? proposal.value === null : isPreparationValue(field, proposal.value)) || !instant(proposal.submittedAt) || !choice(proposal.status, ['pending','discussion']) || admin && typeof proposal.canReview !== 'boolean') return false
    }
    if (!permissions.canReadHealth && ['dietary','allergies'].includes(field) && (record.original.value !== null || record.accepted.value !== null || record.pending !== null)) return false
  }
  if (!keys(history, ['page','nextPage','previousPage','entries']) || !integer(history.page) || !(history.nextPage === null || integer(history.nextPage) && history.nextPage === history.page + 1) || !(history.previousPage === null ? history.page === 0 : integer(history.previousPage) && history.previousPage === history.page - 1) || !Array.isArray(history.entries) || history.entries.length > 20) return false
  if (!history.entries.every((entry: unknown) => object(entry) && keys(entry, ['id','field','operation','source','status','value','at','outcomeMessage']) && isPreparationId(entry.id) && choice(entry.field, PREPARATION_FIELDS) && choice(entry.operation, ['set','clear','confirm']) && sources.includes(entry.source) && choice(entry.status, ['accepted','pending','superseded','declined','discussion','confirmed','removed']) && (entry.value === null || isPreparationValue(entry.field, entry.value)) && instant(entry.at) && nullableText(entry.outcomeMessage, 1000) && (permissions.canReadHealth || !['dietary','allergies'].includes(entry.field) || entry.value === null && (entry.status === 'removed' || entry.operation === 'confirm' && entry.status === 'confirmed' && entry.outcomeMessage === 'Sergio reviewed the privacy change. No personal health details were added or restored.')))) return false
  return v.actionResult === null || isPreparationAck(v.actionResult) && v.actionResult.bookingId === bookingId
}

export type PreparationAttention = { version: 1; checkedAt: string; total: number; items: { bookingId: string; pendingCount: number; agreementReviewCount: number; updatedAt: string }[]; page: { page: number; limit: 20; nextPage: number | null; previousPage: number | null } }
export function isPreparationAttention(v: unknown): v is PreparationAttention {
  return object(v) && keys(v, ['version','checkedAt','total','items','page']) && v.version === 1 && instant(v.checkedAt) && integer(v.total) && Array.isArray(v.items) && v.items.length <= 20 && v.items.every((item: unknown) => object(item) && keys(item, ['bookingId','pendingCount','agreementReviewCount','updatedAt']) && isPreparationId(item.bookingId) && integer(item.pendingCount) && integer(item.agreementReviewCount) && item.pendingCount + item.agreementReviewCount > 0 && instant(item.updatedAt)) && object(v.page) && keys(v.page, ['page','limit','nextPage','previousPage']) && integer(v.page.page) && v.page.limit === 20 && (v.page.nextPage === null || v.page.nextPage === v.page.page + 1) && (v.page.previousPage === null ? v.page.page === 0 : v.page.previousPage === v.page.page - 1)
}
