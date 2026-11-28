import type { DetailsField, DetailsOutcome, DetailsResult, GuestDetails } from './types'

export const DETAILS_FIELDS: readonly DetailsField[] = ['occasion', 'kitchen', 'foodIdeas', 'dietary', 'allergies', 'notes', 'budget', 'physicalInvitations', 'sensitiveDataConsent']
const OUTCOMES: readonly DetailsOutcome[] = ['recorded', 'unchanged', 'requires_review', 'unverified']
export function detailFields(details: GuestDetails): DetailsField[] {
  return DETAILS_FIELDS.filter(field => field === 'budget'
    ? (['budgetMode', 'budgetMin', 'budgetMax', 'budgetUnit'] as const).some(key => Object.hasOwn(details, key) && details[key] !== undefined)
    : Object.hasOwn(details, field) && details[field] !== undefined)
}

/** A matching booking reference alone cannot acknowledge individual changes. */
export function isDetailsResult(value: unknown, requestId: string, details: GuestDetails): value is DetailsResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const result = value as Record<string, unknown>
  if (Object.keys(result).length !== 4 || result.version !== 1 || result.requestId !== requestId || typeof result.recordedAt !== 'string' || result.recordedAt.length > 40 || !/^\d{4}-\d{2}-\d{2}T/.test(result.recordedAt) || !Number.isFinite(Date.parse(result.recordedAt))) return false
  if (!result.outcomes || typeof result.outcomes !== 'object' || Array.isArray(result.outcomes)) return false
  const fields = detailFields(details), outcomes = result.outcomes as Record<string, unknown>
  return Object.keys(outcomes).length === fields.length && fields.every(field => Object.hasOwn(outcomes, field) && OUTCOMES.includes(outcomes[field] as DetailsOutcome))
}
