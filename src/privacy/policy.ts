/** Business policy adopted by the authorizing owner on 27 November 2026. */
export const PRIVACY_POLICY_VERSION = 'v2026-11-27'
export const PRIVACY_CONTACT_EMAIL = 'admin.chefsergioandco@gmail.com'
export const PRIVACY_REQUEST_HREF = '/privacy/#privacy-requests'
export const SENSITIVE_DATA_CONSENT_VERSION = 'sensitive-event-data-v2026-11-27'
export const SENSITIVE_DATA_CONSENT_TEXT = 'I explicitly consent to Chef Sergio & Co. using the dietary, allergy or accessibility information I choose to provide about myself to plan and prepare this experience.'
export const PRIVACY_RETENTION = {
  inquiryDays: 90, sensitiveEventDays: 30, coreContractYears: 5, financialYears: 7,
  inactivityMonths: 24, inactivityNoticeDays: 30, rightsWorkingDays: 90, rightsAuditYears: 3,
  exportDays: 7, operationalLogDays: 90,
} as const

export type SensitiveDataConsent = { version: typeof SENSITIVE_DATA_CONSENT_VERSION; granted: boolean; scope: 'self' }
export function sensitiveDataConsent(granted: boolean): SensitiveDataConsent {
  return { version: SENSITIVE_DATA_CONSENT_VERSION, granted, scope: 'self' }
}
export function hasCurrentSensitiveConsent(value: unknown): value is SensitiveDataConsent {
  if (!value || typeof value !== 'object') return false
  const consent = value as Partial<SensitiveDataConsent>
  return consent.version === SENSITIVE_DATA_CONSENT_VERSION && consent.scope === 'self' && consent.granted === true
}
