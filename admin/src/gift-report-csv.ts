import { isGiftBalanceReport, type GiftBalanceReport } from './gift-report-types'
const columns = ['row_type', 'capture_id', 'captured_at_utc', 'currency', 'reference', 'card_reference', 'card_last_four', 'card_status', 'purchase_reference', 'purchase_status', 'booking_reference', 'hold_purpose', 'expires_at_utc', 'issued_at_utc', 'face_value_usd', 'purchase_value_usd', 'issued_usd', 'spent_usd', 'restored_usd', 'adjustment_usd', 'balance_usd', 'live_held_usd', 'available_usd', 'ledger_entries', 'anomalies', 'exception_kind', 'exception_amount_usd', 'metric', 'metric_value', 'metric_unit'] as const
type Column = typeof columns[number]
type Cell = string | number | { decimal: string }
type Row = Partial<Record<Column, Cell>>
/** Text is independent of financial numbers: negative amounts remain numeric. */
export function giftReportTextCell(value: string): string {
  const unsafe = /^[\s\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f]*[=+\-@]/u.test(value) || /^[\u0000-\u001f\u007f]/.test(value)
  return '"' + (unsafe ? "'" : '') + value.replace(/"/g, '""') + '"'
}
export function giftReportDecimal(cents: number): string { if (!Number.isSafeInteger(cents)) throw new TypeError('A safe integer amount is required.'); const n = BigInt(cents), abs = n < 0n ? -n : n; return (n < 0n ? '-' : '') + (abs / 100n) + '.' + String(abs % 100n).padStart(2, '0') }
export function giftReportMoney(cents: number): string { const value = giftReportDecimal(cents), negative = value.startsWith('-'), [whole, fraction] = (negative ? value.slice(1) : value).split('.'); return (negative ? '-$' : '$') + whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + fraction }
const dollars = (cents: number) => ({ decimal: giftReportDecimal(cents) })
/** Complete, validated capture only. No fetching, paging, private artifacts or provider values. */
export function giftReportCsv(report: GiftBalanceReport): string {
  if (!isGiftBalanceReport(report)) throw new TypeError('A complete verified gift balance report is required for export.')
  const output = [columns.map(giftReportTextCell).join(',')]
  function row(value: Row) { const full: Row = { capture_id: report.captureId, captured_at_utc: report.capturedAt, currency: report.currency, ...value }; output.push(columns.map(k => { const v = full[k]; if (typeof v === 'number') { if (!Number.isSafeInteger(v)) throw new TypeError('An exact numeric cell is required.'); return String(v) } if (v && typeof v === 'object') { if (!/^-?\d+\.\d{2}$/.test(v.decimal)) throw new TypeError('An exact decimal cell is required.'); return v.decimal } return giftReportTextCell(v ?? '') }).join(',')) }
  row({ row_type: 'report_note', metric: 'Holds are subsets of recorded balances, not additional liability. Frozen value is outstanding but not spendable; void residuals and exceptions are separate. Do not add different row types together.', metric_value: 'Complete captured report', metric_unit: 'scope' })
  for (const [section, values] of Object.entries({ reconciliation: report.summary.reconciliation, balances: report.summary.balances, holds: report.summary.holds })) for (const [name, value] of Object.entries(values)) row({ row_type: 'total', metric: section + '.' + name, metric_value: dollars(value), metric_unit: 'USD' })
  for (const name of ['paidWithoutCardCents', 'orphanLedgerCents'] as const) row({ row_type: 'exception_total', metric: name, metric_value: dollars(report.summary[name]), metric_unit: 'USD' })
  for (const name of ['anomalousCards', 'exceptionCount'] as const) row({ row_type: 'count', metric: name, metric_value: report.summary[name], metric_unit: 'records' })
  for (const [name, value] of Object.entries(report.sourceCounts)) row({ row_type: 'source_count', metric: name, metric_value: value, metric_unit: 'records' })
  for (const [name, value] of Object.entries(report.limits)) row({ row_type: 'capture_limit', metric: name, metric_value: value, metric_unit: name === 'maxResponseBytes' ? 'bytes' : 'records' })
  for (const c of report.cards) row({ row_type: 'card', reference: c.cardId, card_reference: c.cardId, card_last_four: c.last4, card_status: c.status, purchase_reference: c.purchaseId ?? '', purchase_status: c.purchaseStatus ?? '', issued_at_utc: c.issuedAt, face_value_usd: dollars(c.faceValueCents), purchase_value_usd: c.purchaseValueCents === null ? '' : dollars(c.purchaseValueCents), issued_usd: dollars(c.issuedCents), spent_usd: dollars(c.spentCents), restored_usd: dollars(c.restoredCents), adjustment_usd: dollars(c.adjustmentCents), balance_usd: dollars(c.balanceCents), live_held_usd: dollars(c.liveHeldCents), available_usd: dollars(c.availableCents), ledger_entries: c.ledgerEntries, anomalies: c.anomalies.join('; ') })
  for (const h of report.liveHolds) row({ row_type: 'live_hold_subset', reference: h.id, card_reference: h.cardId, card_status: h.cardStatus ?? 'missing', booking_reference: h.bookingId, hold_purpose: h.purpose, expires_at_utc: h.expiresAt, live_held_usd: dollars(h.amountCents) })
  for (const e of report.exceptions) row({ row_type: 'exception', reference: e.recordId, card_reference: e.cardId ?? '', purchase_reference: e.purchaseId ?? '', booking_reference: e.bookingId ?? '', exception_kind: e.kind, exception_amount_usd: dollars(e.amountCents) })
  for (const r of report.bookingReferences) row({ row_type: 'booking_reference', card_reference: r.cardId, booking_reference: r.bookingId })
  return '\uFEFF' + output.join('\r\n') + '\r\n'
}
