export type RetainedOperation = 'financial_fact' | 'release_restriction'
/** Recovery metadata only. Evidence, reasons, body hashes and credentials stay out of storage. */
export type RetainedRecovery = {
  version: 1
  caseId: string
  requestId: string
  operation: RetainedOperation
  expectedRevision: number
}
export type RetainedRecoveryRead = { kind: 'empty' } | { kind: 'pending'; marker: RetainedRecovery } | { kind: 'invalid' | 'unavailable' }
const prefix = 'sergio-retained-recovery:v1:'
const key = (actor: string, caseId: string) => prefix + encodeURIComponent(actor) + ':' + encodeURIComponent(caseId)
export const retainedUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
export const retainedId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,99}$/.test(value)
export function isRetainedRecovery(value: unknown): value is RetainedRecovery {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return Object.keys(item).length === 5 && Object.keys(item).every(name => ['version', 'caseId', 'requestId', 'operation', 'expectedRevision'].includes(name)) && item.version === 1 && retainedId(item.caseId) && retainedUuid(item.requestId) && ['financial_fact', 'release_restriction'].includes(String(item.operation)) && Number.isSafeInteger(item.expectedRevision) && Number(item.expectedRevision) >= 0
}
export function readRetainedRecovery(actor: string, caseId: string): RetainedRecoveryRead {
  if (!actor || !retainedId(caseId)) return { kind: 'unavailable' }
  try {
    const raw = sessionStorage.getItem(key(actor, caseId))
    if (raw === null) return { kind: 'empty' }
    if (raw.length > 1000) return { kind: 'invalid' }
    const marker: unknown = JSON.parse(raw)
    return isRetainedRecovery(marker) && marker.caseId === caseId ? { kind: 'pending', marker } : { kind: 'invalid' }
  } catch { return { kind: 'unavailable' } }
}
export function storeRetainedRecovery(actor: string, marker: RetainedRecovery): boolean {
  if (!actor || !isRetainedRecovery(marker)) return false
  const current = readRetainedRecovery(actor, marker.caseId)
  if (current.kind === 'invalid' || current.kind === 'unavailable' || current.kind === 'pending' && (current.marker.requestId !== marker.requestId || current.marker.operation !== marker.operation || current.marker.expectedRevision !== marker.expectedRevision)) return false
  try {
    const raw = JSON.stringify(marker)
    sessionStorage.setItem(key(actor, marker.caseId), raw)
    return sessionStorage.getItem(key(actor, marker.caseId)) === raw
  } catch { return false }
}
export function clearRetainedRecovery(actor: string, marker: RetainedRecovery): boolean {
  const current = readRetainedRecovery(actor, marker.caseId)
  if (current.kind === 'empty') return true
  if (current.kind !== 'pending' || current.marker.requestId !== marker.requestId || current.marker.operation !== marker.operation || current.marker.expectedRevision !== marker.expectedRevision) return false
  try {
    sessionStorage.removeItem(key(actor, marker.caseId))
    return sessionStorage.getItem(key(actor, marker.caseId)) === null
  } catch { return false }
}
