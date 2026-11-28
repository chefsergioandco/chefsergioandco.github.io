export const GIFT_DELIVERY_STATUSES = ['not_issued', 'scheduled', 'disabled', 'preview', 'queued', 'sending', 'sent', 'delivered', 'retry', 'failed', 'bounced', 'complained', 'needs_review', 'suppressed', 'cancelled', 'needs_contact', 'not_applicable'] as const
export type GiftFulfillment = 'email' | 'download'
export type GiftDeliveryStatus = typeof GIFT_DELIVERY_STATUSES[number]
export type GiftDelivery = { messageId: string | null; status: GiftDeliveryStatus; scheduledFor: string | null; sentAt: string | null; deliveredAt: string | null; lastError: string; canRetry: boolean }
export type GiftCard = { id: string; last4: string; status: 'active' | 'frozen' | 'void'; issuedAt: string; balanceCents: number; heldCents: number; availableCents: number }
export type GiftPurchase = {
  id: string; status: 'creating' | 'open' | 'paid' | 'expired'; amountCents: number; createdAt: string; expiresAt: string | null
  recipientName: string; recipientEmail: string; senderName: string; senderEmail: string; sendOn: string; card: GiftCard | null
  fulfillment: GiftFulfillment; canDownload: boolean
  delivery: { recipient: GiftDelivery; sender: GiftDelivery }; canQueueDue: boolean; canReconcile: boolean
}
export type GiftLedgerRow = { id: string; kind: 'issue' | 'spend' | 'restore' | 'adjust'; amountCents: number; bookingId: string | null; createdAt: string; actor: string }
export type GiftHold = { id: string; bookingId: string; purpose: 'deposit' | 'remainder'; amountCents: number; status: 'held' | 'captured' | 'released'; expiresAt: string; settledAt: string | null }
export type GiftDetail = GiftPurchase & { note: string; ledger: GiftLedgerRow[]; holds: GiftHold[]; limits: { maxLedger: number; ledgerTruncated: boolean; maxHolds: number; holdsTruncated: boolean } }
export type GiftsResponse = {
  version: 1; checkedAt: string; readiness: { salesReady: boolean; deliveryReady: boolean; downloadReady: boolean; fulfillment: GiftFulfillment; missing: string[]; timeZone: 'America/New_York' }
  summary: { purchases: number; issued: number; outstandingCents: number; heldCents: number }; purchases: GiftPurchase[]; selected: GiftDetail | null
  page: { limit: number; nextCursor: string | null }
}
export type GiftAction = { requestId: string; purchaseId: string; action: 'queue_due' | 'retry_delivery' | 'reconcile_purchase'; messageId?: string }
export type GiftActionResult = { version: 1; ok: true; requestId: string; purchaseId: string; action: GiftAction['action']; result: 'queued' | 'already_queued' | 'checked' | 'replayed' }
export type GiftAmountSettings = { revision: number; amounts: number[]; updatedAt: string | null }
export type GiftSettingsHistory = { requestId: string; revision: number; previousAmounts: number[]; amounts: number[]; changedAt: string; actor: string }
export type GiftSettingsResponse = { version: 1; settings: GiftAmountSettings; history: GiftSettingsHistory[]; limits: { historyLimit: number; historyTruncated: boolean } }
export type GiftSettingsAction = { requestId: string; expectedRevision: number; amounts: number[] }
export type GiftSettingsResult = { version: 1; ok: true; requestId: string; result: 'saved' | 'replayed'; settings: GiftAmountSettings }

const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown, max = 2000) => typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
const required = (value: unknown, max = 2000) => text(value, max) && (value as string).trim().length > 0
export const isGiftPurchaseId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
const id = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value)
const instant = (value: unknown) => typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value))
const nullableInstant = (value: unknown) => value === null || instant(value)
const nonnegative = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0
const choice = (value: unknown, values: readonly string[]) => typeof value === 'string' && values.includes(value)
const email = (value: unknown) => required(value, 254) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value as string)
const displayContact = (value: unknown, status: unknown) => email(value) || status === 'needs_contact' && text(value, 254)
const date = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T12:00:00Z')) && new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value
const unique = (rows: Record<string, any>[]) => new Set(rows.map(row => row.id)).size === rows.length
const allowedKeys = (value: Record<string, any>, keys: string[]) => Object.keys(value).every(key => keys.includes(key))
function delivery(value: unknown): value is GiftDelivery {
  if (!object(value) || !allowedKeys(value, ['messageId', 'status', 'scheduledFor', 'sentAt', 'deliveredAt', 'lastError', 'canRetry']) || !(value.messageId === null || id(value.messageId)) || !choice(value.status, GIFT_DELIVERY_STATUSES) || !nullableInstant(value.scheduledFor) || !nullableInstant(value.sentAt) || !nullableInstant(value.deliveredAt) || !text(value.lastError) || typeof value.canRetry !== 'boolean') return false
  if (value.canRetry && (!value.messageId || !['retry', 'failed'].includes(value.status))) return false
  if (value.status === 'delivered' && value.deliveredAt === null || value.status === 'sent' && value.sentAt === null) return false
  return true
}
function card(value: unknown): value is GiftCard {
  return object(value) && allowedKeys(value, ['id', 'last4', 'status', 'issuedAt', 'balanceCents', 'heldCents', 'availableCents']) && id(value.id) && typeof value.last4 === 'string' && /^[0-9A-Z]{4}$/.test(value.last4) && choice(value.status, ['active', 'frozen', 'void']) && instant(value.issuedAt) && [value.balanceCents, value.heldCents, value.availableCents].every(nonnegative) && value.availableCents <= Math.max(0, value.balanceCents - value.heldCents) && (value.status === 'active' || value.availableCents === 0)
}
function purchase(value: unknown, deliveryReady: boolean, detail = false): value is GiftPurchase {
  if (!object(value) || !allowedKeys(value, ['id', 'status', 'amountCents', 'createdAt', 'expiresAt', 'recipientName', 'recipientEmail', 'senderName', 'senderEmail', 'sendOn', 'card', 'delivery', 'canQueueDue', 'canReconcile', 'fulfillment', 'canDownload', ...(detail ? ['note', 'ledger', 'holds', 'limits'] : [])]) || !isGiftPurchaseId(value.id) || !choice(value.status, ['creating', 'open', 'paid', 'expired']) || !choice(value.fulfillment, ['email', 'download']) || typeof value.canDownload !== 'boolean' || !nonnegative(value.amountCents) || !instant(value.createdAt) || !nullableInstant(value.expiresAt) || !required(value.recipientName, 150) || !(value.fulfillment === 'download' ? text(value.recipientEmail, 254) : displayContact(value.recipientEmail, value.delivery?.recipient?.status)) || !required(value.senderName, 150) || !(value.fulfillment === 'download' ? text(value.senderEmail, 254) : displayContact(value.senderEmail, value.delivery?.sender?.status)) || !date(value.sendOn) || !(value.card === null || card(value.card)) || !object(value.delivery) || !allowedKeys(value.delivery, ['recipient', 'sender']) || !delivery(value.delivery.recipient) || !delivery(value.delivery.sender) || typeof value.canQueueDue !== 'boolean' || typeof value.canReconcile !== 'boolean') return false
  if (value.fulfillment === 'download') {
    if (value.canQueueDue || Object.values(value.delivery).some(row => row.status !== 'not_applicable' || row.canRetry || row.messageId !== null || row.sentAt !== null || row.deliveredAt !== null || row.scheduledFor !== null)) return false
    if (value.canDownload && (value.status !== 'paid' || value.card?.status !== 'active')) return false
  } else if (value.canDownload || Object.values(value.delivery).some(row => row.status === 'not_applicable')) return false
  if (value.card !== null && value.status !== 'paid') return false
  if (value.canQueueDue && (!deliveryReady || value.status !== 'paid' || value.card?.status !== 'active' || value.delivery.recipient.status === 'needs_contact' || value.delivery.sender.status === 'needs_contact')) return false
  if (!deliveryReady && (value.delivery.recipient.canRetry || value.delivery.sender.canRetry)) return false
  return true
}
export function isGiftsResponse(value: unknown): value is GiftsResponse {
  if (!object(value) || value.version !== 1 || !instant(value.checkedAt) || !object(value.readiness) || !object(value.summary) || !Array.isArray(value.purchases) || !object(value.page)) return false
  const { readiness, summary, page } = value
  if (typeof readiness.salesReady !== 'boolean' || typeof readiness.deliveryReady !== 'boolean' || typeof readiness.downloadReady !== 'boolean' || !choice(readiness.fulfillment, ['email', 'download']) || readiness.salesReady && !(readiness.fulfillment === 'download' ? readiness.downloadReady : readiness.deliveryReady) || readiness.timeZone !== 'America/New_York' || !Array.isArray(readiness.missing) || readiness.missing.length > 50 || !readiness.missing.every((item: unknown) => required(item)) || ![summary.purchases, summary.issued, summary.outstandingCents, summary.heldCents].every(nonnegative)) return false
  if (!Number.isInteger(page.limit) || page.limit < 1 || page.limit > 100 || !(page.nextCursor === null || typeof page.nextCursor === 'string' && /^[A-Za-z0-9_-]{1,2000}$/.test(page.nextCursor)) || value.purchases.length > page.limit || !value.purchases.every((item: unknown) => purchase(item, readiness.deliveryReady)) || !unique(value.purchases)) return false
  if (value.selected === null) return true
  const selected = value.selected as GiftDetail
  if (!purchase(selected, readiness.deliveryReady, true) || !text(selected.note, 1000) || !Array.isArray(selected.ledger) || !Array.isArray(selected.holds) || !object(selected.limits)) return false
  const limits = selected.limits
  if (![limits.maxLedger, limits.maxHolds].every(count => Number.isInteger(count) && count >= 1 && count <= 2000) || typeof limits.ledgerTruncated !== 'boolean' || typeof limits.holdsTruncated !== 'boolean' || selected.ledger.length > limits.maxLedger || selected.holds.length > limits.maxHolds) return false
  if (!selected.ledger.every((row: unknown) => object(row) && allowedKeys(row, ['id', 'kind', 'amountCents', 'bookingId', 'createdAt', 'actor']) && id(row.id) && choice(row.kind, ['issue', 'spend', 'restore', 'adjust']) && Number.isSafeInteger(row.amountCents) && (row.bookingId === null || id(row.bookingId)) && instant(row.createdAt) && text(row.actor, 200)) || !unique(selected.ledger)) return false
  return selected.holds.every((row: unknown) => object(row) && allowedKeys(row, ['id', 'bookingId', 'purpose', 'amountCents', 'status', 'expiresAt', 'settledAt']) && id(row.id) && id(row.bookingId) && choice(row.purpose, ['deposit', 'remainder']) && nonnegative(row.amountCents) && choice(row.status, ['held', 'captured', 'released']) && instant(row.expiresAt) && nullableInstant(row.settledAt)) && unique(selected.holds)
}
export function isGiftActionResult(value: unknown, input: GiftAction): value is GiftActionResult {
  return object(value) && allowedKeys(value, ['version', 'ok', 'requestId', 'purchaseId', 'action', 'result']) && value.version === 1 && value.ok === true && value.requestId === input.requestId && isGiftPurchaseId(value.requestId) && value.purchaseId === input.purchaseId && value.action === input.action && choice(value.result, input.action === 'reconcile_purchase' ? ['checked', 'replayed'] : ['queued', 'already_queued', 'replayed'])
}
export function isGiftAmounts(value: unknown): value is number[] {
  return Array.isArray(value) && value.length >= 1 && value.length <= 32 && value.every((amount, index) => Number.isSafeInteger(amount) && amount >= 500 && amount <= 10_000_000 && (index === 0 || amount > value[index - 1]))
}
function amountSettings(value: unknown): value is GiftAmountSettings {
  return object(value) && allowedKeys(value, ['revision', 'amounts', 'updatedAt']) && nonnegative(value.revision) && isGiftAmounts(value.amounts) && nullableInstant(value.updatedAt)
}
export function isGiftSettingsResponse(value: unknown): value is GiftSettingsResponse {
  if (!object(value) || !allowedKeys(value, ['version', 'settings', 'history', 'limits']) || value.version !== 1 || !amountSettings(value.settings) || !Array.isArray(value.history) || !object(value.limits) || !allowedKeys(value.limits, ['historyLimit', 'historyTruncated']) || !Number.isInteger(value.limits.historyLimit) || value.limits.historyLimit < 1 || value.limits.historyLimit > 100 || typeof value.limits.historyTruncated !== 'boolean' || value.history.length > value.limits.historyLimit) return false
  return value.history.every(row => object(row) && allowedKeys(row, ['requestId', 'revision', 'previousAmounts', 'amounts', 'changedAt', 'actor']) && isGiftPurchaseId(row.requestId) && Number.isSafeInteger(row.revision) && row.revision >= 1 && row.revision <= value.settings.revision && isGiftAmounts(row.previousAmounts) && isGiftAmounts(row.amounts) && instant(row.changedAt) && required(row.actor, 200)) && new Set(value.history.map(row => row.requestId)).size === value.history.length && new Set(value.history.map(row => row.revision)).size === value.history.length
}
export function isGiftSettingsAction(value: unknown): value is GiftSettingsAction {
  return object(value) && allowedKeys(value, ['requestId', 'expectedRevision', 'amounts']) && isGiftPurchaseId(value.requestId) && nonnegative(value.expectedRevision) && isGiftAmounts(value.amounts)
}
export function isGiftSettingsResult(value: unknown, input: GiftSettingsAction): value is GiftSettingsResult {
  return object(value) && allowedKeys(value, ['version', 'ok', 'requestId', 'result', 'settings']) && value.version === 1 && value.ok === true && value.requestId === input.requestId && choice(value.result, ['saved', 'replayed']) && amountSettings(value.settings) && value.settings.revision === input.expectedRevision + 1 && JSON.stringify(value.settings.amounts) === JSON.stringify(input.amounts) && value.settings.updatedAt !== null
}
