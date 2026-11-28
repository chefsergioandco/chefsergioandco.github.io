export const OPERATION_SECTIONS = ['communications', 'newsletter', 'payments', 'gifts', 'privacy', 'calendar', 'bookings', 'website', 'operations'] as const
export type OperationsTarget = {
  section: typeof OPERATION_SECTIONS[number]
  recordId?: string
  bookingId?: string
  view?: string
  filter?: string
}
export const OPERATIONS_VIEWS = ['connections', 'background', 'attention'] as const
export type OperationsView = typeof OPERATIONS_VIEWS[number]
export const SERVICE_IDS = ['identity', 'payments', 'email', 'newsletter', 'gifts', 'booking', 'publishing', 'calendar'] as const
export type ServiceStatus = 'ready' | 'limited' | 'blocked' | 'not_connected' | 'unknown'
export type OperationsService = { id: typeof SERVICE_IDS[number]; label: string; status: ServiceStatus; summary: string; reasons: string[]; owner: string; target: OperationsTarget | null }
export const JOB_KEYS = ['email_dispatch', 'newsletter_sync', 'database_schema', 'workspace_integrity', 'email_queue', 'email_leases', 'newsletter_confirmations', 'newsletter_consent', 'payment_integrity', 'deployment_config', 'privacy_notifications', 'privacy_cleanup', 'privacy_retention'] as const
export type RunEvidence = { id: string; startedAt: string; finishedAt: string | null; outcome: 'succeeded' | 'failed' | 'running'; summary: string }
export type JobStatus = 'healthy' | 'failed' | 'running' | 'never_recorded' | 'overdue' | 'unknown'
export type OperationsJob = { key: typeof JOB_KEYS[number]; label: string; kind: 'job' | 'probe'; status: JobStatus; enabled: boolean; lastRun: RunEvidence | null; nextExpectedAt: string | null; target: OperationsTarget | null }
export const ATTENTION_AREAS = ['email', 'newsletter', 'payments', 'privacy', 'configuration', 'monitoring'] as const
export type OperationsAttention = { id: string; area: typeof ATTENTION_AREAS[number]; severity: 'error' | 'warning' | 'info'; title: string; summary: string; at: string | null; target: OperationsTarget | null }
export type OperationsResponse = { version: 1; checkedAt: string; services: OperationsService[]; jobs: OperationsJob[]; attention: OperationsAttention[]; limits: { maxAttention: number; maxRunsPerJob: 1; truncated: boolean; historyAvailable: boolean } }

const plain = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown, limit = 2000): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= limit && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
const opaque = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value)
const instant = (value: unknown): value is string => typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value))
const nullableInstant = (value: unknown) => value === null || instant(value)
const includes = (values: readonly string[], value: unknown) => typeof value === 'string' && values.includes(value)
export const isOperationsView = (value: unknown): value is OperationsView => includes(OPERATIONS_VIEWS, value)
export function isOperationsTarget(value: unknown): value is OperationsTarget {
  if (!plain(value) || !includes(OPERATION_SECTIONS, value.section)) return false
  if (Object.keys(value).some(key => !['section', 'recordId', 'bookingId', 'view', 'filter'].includes(key))) return false
  return ['recordId', 'bookingId', 'view', 'filter'].every(key => value[key] === undefined || opaque(value[key]))
}
const target = (value: unknown) => value === null || isOperationsTarget(value)
const unique = (items: unknown[], key: string) => new Set(items.map(item => plain(item) ? item[key] : undefined)).size === items.length

/** Reject incomplete or contradictory evidence instead of turning missing fields into green indicators. */
export function isOperationsResponse(value: unknown): value is OperationsResponse {
  if (!plain(value) || value.version !== 1 || !instant(value.checkedAt) || !Array.isArray(value.services) || !Array.isArray(value.jobs) || !Array.isArray(value.attention) || !plain(value.limits)) return false
  const { services, jobs, attention, limits } = value
  if (services.length !== SERVICE_IDS.length || jobs.length !== JOB_KEYS.length || !unique(services, 'id') || !unique(jobs, 'key') || attention.length > 100 || !unique(attention, 'id')) return false
  if (limits.maxRunsPerJob !== 1 || !Number.isInteger(limits.maxAttention) || limits.maxAttention < 1 || limits.maxAttention > 100 || attention.length > limits.maxAttention || typeof limits.truncated !== 'boolean' || typeof limits.historyAvailable !== 'boolean') return false
  if (!services.every(item => plain(item) && includes(SERVICE_IDS, item.id) && text(item.label, 150) && includes(['ready', 'limited', 'blocked', 'not_connected', 'unknown'], item.status) && text(item.summary) && text(item.owner, 200) && Array.isArray(item.reasons) && item.reasons.length <= 30 && item.reasons.every((reason: unknown) => text(reason)) && target(item.target))) return false
  if (!jobs.every(item => {
    if (!plain(item) || !includes(JOB_KEYS, item.key) || !text(item.label, 150) || !includes(['job', 'probe'], item.kind) || !includes(['healthy', 'failed', 'running', 'never_recorded', 'overdue', 'unknown'], item.status) || typeof item.enabled !== 'boolean' || !nullableInstant(item.nextExpectedAt) || !target(item.target)) return false
    if (item.lastRun === null) return item.status !== 'healthy' && item.status !== 'running' && item.status !== 'failed'
    const run = item.lastRun
    if (!plain(run) || !opaque(run.id) || !instant(run.startedAt) || !nullableInstant(run.finishedAt) || !includes(['succeeded', 'failed', 'running'], run.outcome) || !text(run.summary)) return false
    if (run.finishedAt !== null && Date.parse(run.finishedAt) < Date.parse(run.startedAt)) return false
    if (run.outcome === 'running' && run.finishedAt !== null || run.outcome !== 'running' && run.finishedAt === null) return false
    if (item.status === 'never_recorded' || item.status === 'healthy' && run.outcome !== 'succeeded' || item.status === 'running' && run.outcome !== 'running' || item.status === 'failed' && run.outcome !== 'failed') return false
    return true
  })) return false
  return attention.every(item => plain(item) && opaque(item.id) && includes(ATTENTION_AREAS, item.area) && includes(['error', 'warning', 'info'], item.severity) && text(item.title, 200) && text(item.summary) && nullableInstant(item.at) && target(item.target))
}
