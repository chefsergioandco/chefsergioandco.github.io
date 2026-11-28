export const giftReportAnomalies = ['missing_purchase', 'purchase_not_paid', 'purchase_value_mismatch', 'issue_count', 'issue_value_mismatch', 'negative_balance', 'holds_exceed_balance', 'void_residual'] as const
export type GiftReportAnomaly = typeof giftReportAnomalies[number]
export type GiftReportCard = {
  cardId: string; last4: string; status: 'active' | 'frozen' | 'void'; purchaseId: string | null; purchaseStatus: 'creating' | 'open' | 'paid' | 'expired' | null; purchaseValueCents: number | null; issuedAt: string
  faceValueCents: number; issuedCents: number; spentCents: number; restoredCents: number; adjustmentCents: number; balanceCents: number; liveHeldCents: number; availableCents: number; ledgerEntries: number; anomalies: GiftReportAnomaly[]
}
export type GiftReportHold = { id: string; cardId: string; bookingId: string; purpose: 'deposit' | 'remainder'; amountCents: number; expiresAt: string; cardStatus: GiftReportCard['status'] | null }
export type GiftReportException = { kind: 'paid_without_card' | 'card_without_purchase' | 'card_purchase_not_paid' | 'orphan_ledger' | 'orphan_hold'; recordId: string; cardId: string | null; purchaseId: string | null; bookingId: string | null; amountCents: number }
export type GiftBalanceReport = {
  version: 1; captureId: string; capturedAt: string; currency: 'USD'; complete: true
  sourceCounts: { cards: number; purchases: number; ledgerEntries: number; holds: number }
  summary: {
    reconciliation: { issuedCents: number; spentCents: number; restoredCents: number; adjustmentCents: number; balanceCents: number }
    balances: { activeCents: number; frozenCents: number; voidCents: number; outstandingCents: number; availableCents: number }
    holds: { activeCents: number; blockedCents: number; orphanCents: number; totalCents: number }
    paidWithoutCardCents: number; orphanLedgerCents: number; anomalousCards: number; exceptionCount: number
  }
  cards: GiftReportCard[]; liveHolds: GiftReportHold[]; exceptions: GiftReportException[]; bookingReferences: { cardId: string; bookingId: string }[]
  limits: { maxCards: number; maxPurchases: number; maxLedgerEntries: number; maxHolds: number; maxResponseBytes: number }
}
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const keys = (v: Record<string, unknown>, names: readonly string[]) => Object.keys(v).length === names.length && Object.keys(v).every(k => names.includes(k))
const int = (v: unknown): v is number => Number.isSafeInteger(v)
const positive = (v: unknown): v is number => int(v) && v > 0
const natural = (v: unknown): v is number => int(v) && v >= 0
const ref = (v: unknown): v is string => typeof v === 'string' && v.length >= 1 && v.length <= 200 && !/[\u0000-\u001f\u007f]/.test(v)
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
const nullable = (v: unknown, check: (v: unknown) => boolean) => v === null || check(v)
const instant = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v))
const safeSum = (values: number[]) => { let n = 0n; for (const v of values) { if (!Number.isSafeInteger(v)) return NaN; n += BigInt(v) } return n <= BigInt(Number.MAX_SAFE_INTEGER) && n >= -BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : NaN }
const unique = (values: string[]) => new Set(values).size === values.length
const status = (v: unknown) => ['active', 'frozen', 'void'].includes(String(v))
function card(v: unknown): v is GiftReportCard {
  if (!record(v) || !keys(v, ['cardId', 'last4', 'status', 'purchaseId', 'purchaseStatus', 'purchaseValueCents', 'issuedAt', 'faceValueCents', 'issuedCents', 'spentCents', 'restoredCents', 'adjustmentCents', 'balanceCents', 'liveHeldCents', 'availableCents', 'ledgerEntries', 'anomalies'])) return false
  if (!ref(v.cardId) || typeof v.last4 !== 'string' || !/^[A-Za-z0-9]{4}$/.test(v.last4) || !status(v.status) || !nullable(v.purchaseId, uuid) || !nullable(v.purchaseStatus, s => ['creating', 'open', 'paid', 'expired'].includes(String(s))) || !nullable(v.purchaseValueCents, positive) || (v.purchaseId === null) !== (v.purchaseStatus === null) || (v.purchaseId === null) !== (v.purchaseValueCents === null) || !instant(v.issuedAt)) return false
  if (!positive(v.faceValueCents) || !['issuedCents', 'spentCents', 'restoredCents', 'liveHeldCents', 'availableCents', 'ledgerEntries'].every(k => natural(v[k])) || !int(v.adjustmentCents) || !int(v.balanceCents) || !Array.isArray(v.anomalies) || !v.anomalies.every((s: unknown) => giftReportAnomalies.includes(s as GiftReportAnomaly)) || !unique(v.anomalies)) return false
  for (const [name, expected] of [['missing_purchase', v.purchaseId === null], ['purchase_not_paid', v.purchaseId !== null && v.purchaseStatus !== 'paid'], ['purchase_value_mismatch', v.purchaseValueCents !== null && v.purchaseValueCents !== v.faceValueCents], ['issue_value_mismatch', v.issuedCents !== v.faceValueCents], ['negative_balance', v.balanceCents < 0], ['holds_exceed_balance', v.liveHeldCents > Math.max(0, v.balanceCents)], ['void_residual', v.status === 'void' && v.balanceCents !== 0]] as const) if (v.anomalies.includes(name) !== expected) return false
  return safeSum([v.issuedCents, -v.spentCents, v.restoredCents, v.adjustmentCents]) === v.balanceCents && v.availableCents === (v.status === 'active' ? Math.max(0, v.balanceCents - v.liveHeldCents) : 0)
}
/** Reject partial, unexpected/private fields, invalid arithmetic and inconsistent full-capture totals. */
export function isGiftBalanceReport(v: unknown): v is GiftBalanceReport {
  if (!record(v) || !keys(v, ['version', 'captureId', 'capturedAt', 'currency', 'complete', 'sourceCounts', 'summary', 'cards', 'liveHolds', 'exceptions', 'bookingReferences', 'limits']) || v.version !== 1 || !uuid(v.captureId) || !instant(v.capturedAt) || v.currency !== 'USD' || v.complete !== true) return false
  const l = v.limits, c = v.sourceCounts, s = v.summary
  if (!record(l) || !keys(l, ['maxCards', 'maxPurchases', 'maxLedgerEntries', 'maxHolds', 'maxResponseBytes']) || !Object.values(l).every(positive) || l.maxCards > 1000 || l.maxPurchases > 2000 || l.maxLedgerEntries > 10000 || l.maxHolds > 10000 || l.maxResponseBytes > 1048576) return false
  if (!record(c) || !keys(c, ['cards', 'purchases', 'ledgerEntries', 'holds']) || !Object.values(c).every(natural) || c.cards > l.maxCards || c.purchases > l.maxPurchases || c.ledgerEntries > l.maxLedgerEntries || c.holds > l.maxHolds) return false
  if (!Array.isArray(v.cards) || v.cards.length !== c.cards || !v.cards.every(card) || !unique(v.cards.map((r: GiftReportCard) => r.cardId))) return false
  const cards = new Map<string, GiftReportCard>(v.cards.map((r: GiftReportCard) => [r.cardId, r]))
  if (!Array.isArray(v.liveHolds) || v.liveHolds.length > c.holds || !unique(v.liveHolds.map((h: any) => h?.id)) || !v.liveHolds.every((h: any) => record(h) && keys(h, ['id', 'cardId', 'bookingId', 'purpose', 'amountCents', 'expiresAt', 'cardStatus']) && ref(h.id) && ref(h.cardId) && ref(h.bookingId) && ['deposit', 'remainder'].includes(h.purpose) && positive(h.amountCents) && instant(h.expiresAt) && Date.parse(h.expiresAt) > Date.parse(v.capturedAt) && nullable(h.cardStatus, status) && h.cardStatus === (cards.get(h.cardId)?.status ?? null))) return false
  if (!Array.isArray(v.exceptions) || v.exceptions.length > c.cards + c.purchases + c.ledgerEntries + c.holds || !v.exceptions.every((e: any) => record(e) && keys(e, ['kind', 'recordId', 'cardId', 'purchaseId', 'bookingId', 'amountCents']) && ['paid_without_card', 'card_without_purchase', 'card_purchase_not_paid', 'orphan_ledger', 'orphan_hold'].includes(e.kind) && ref(e.recordId) && nullable(e.cardId, ref) && nullable(e.purchaseId, uuid) && nullable(e.bookingId, ref) && int(e.amountCents)) || !unique(v.exceptions.map((e: GiftReportException) => e.kind + ':' + e.recordId))) return false
  if (!Array.isArray(v.bookingReferences) || v.bookingReferences.length > c.ledgerEntries + c.holds || !v.bookingReferences.every((r: any) => record(r) && keys(r, ['cardId', 'bookingId']) && ref(r.cardId) && ref(r.bookingId)) || !unique(v.bookingReferences.map((r: { cardId: string; bookingId: string }) => r.cardId + '\n' + r.bookingId))) return false
  if (!record(s) || !keys(s, ['reconciliation', 'balances', 'holds', 'paidWithoutCardCents', 'orphanLedgerCents', 'anomalousCards', 'exceptionCount']) || !record(s.reconciliation) || !keys(s.reconciliation, ['issuedCents', 'spentCents', 'restoredCents', 'adjustmentCents', 'balanceCents']) || !Object.values(s.reconciliation).every(int) || !record(s.balances) || !keys(s.balances, ['activeCents', 'frozenCents', 'voidCents', 'outstandingCents', 'availableCents']) || !Object.values(s.balances).every(int) || !record(s.holds) || !keys(s.holds, ['activeCents', 'blockedCents', 'orphanCents', 'totalCents']) || !Object.values(s.holds).every(natural) || !natural(s.paidWithoutCardCents) || !int(s.orphanLedgerCents) || !natural(s.anomalousCards) || s.exceptionCount !== v.exceptions.length) return false
  const cs: GiftReportCard[] = v.cards, hs: GiftReportHold[] = v.liveHolds, es: GiftReportException[] = v.exceptions
  for (const key of ['issuedCents', 'spentCents', 'restoredCents', 'adjustmentCents', 'balanceCents'] as const) if (safeSum(cs.map(r => r[key])) !== s.reconciliation[key]) return false
  for (const value of ['active', 'frozen', 'void'] as const) if (safeSum(cs.filter(r => r.status === value).map(r => r.balanceCents)) !== s.balances[value + 'Cents']) return false
  if (safeSum([s.balances.activeCents, s.balances.frozenCents]) !== s.balances.outstandingCents || safeSum(cs.map(r => r.availableCents)) !== s.balances.availableCents || cs.filter(r => r.anomalies.length > 0).length !== s.anomalousCards) return false
  for (const r of cs) if (safeSum(hs.filter(h => h.cardId === r.cardId).map(h => h.amountCents)) !== r.liveHeldCents) return false
  if (safeSum(hs.filter(h => h.cardStatus === 'active').map(h => h.amountCents)) !== s.holds.activeCents || safeSum(hs.filter(h => h.cardStatus === 'frozen' || h.cardStatus === 'void').map(h => h.amountCents)) !== s.holds.blockedCents || safeSum(hs.filter(h => h.cardStatus === null).map(h => h.amountCents)) !== s.holds.orphanCents || safeSum(hs.map(h => h.amountCents)) !== s.holds.totalCents) return false
  if (safeSum(es.filter(e => e.kind === 'paid_without_card').map(e => e.amountCents)) !== s.paidWithoutCardCents || safeSum(es.filter(e => e.kind === 'orphan_ledger').map(e => e.amountCents)) !== s.orphanLedgerCents || c.ledgerEntries - safeSum(cs.map(r => r.ledgerEntries)) !== es.filter(e => e.kind === 'orphan_ledger').length) return false
  try { return new TextEncoder().encode(JSON.stringify(v)).byteLength <= l.maxResponseBytes } catch { return false }
}
