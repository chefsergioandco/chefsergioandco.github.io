import { balanceFor, creditFor, rewardCreditFor, receivedFor, type BillingEvent, type BillingRecord } from './operations'
import './BillingDocument.css'

export type BillingDocumentProps = { record: BillingRecord; receipt?: BillingEvent }

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const cents = (amount: number) => Math.round(amount * 100) / 100
const paymentKinds = new Set<BillingEvent['kind']>(['posted', 'offline_received'])

function dateLabel(value: string, eventDate = false) {
  if (!value) return eventDate ? 'Date to be agreed' : 'Not recorded'
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value)
  const parsed = new Date(dateOnly ? value + 'T12:00:00Z' : value)
  if (!Number.isFinite(parsed.getTime())) return 'Not recorded'
  return parsed.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: dateOnly ? 'UTC' : 'America/New_York' })
}

function paymentMethod(payment: BillingEvent) {
  if (payment.kind === 'posted') return 'Card via Stripe'
  const method = /^Received (cash|bank transfer|check|other) payment\./i.exec(payment.description)?.[1]
  return method ? method.charAt(0).toUpperCase() + method.slice(1).toLowerCase() : 'Offline payment'
}

function invoiceStatus(record: BillingRecord, balance: number, credits: number, received: number) {
  if (record.invoiceState === 'void') return 'Voided invoice'
  if (record.invoiceState === 'draft' || !record.total) return 'Draft · not issued'
  if (record.invoiceState === 'uncollectible') return 'Marked uncollectible'
  if (record.refundReview) return 'Payment review needed'
  if (credits > 0 && !balance) return received ? 'Balance closed by credit' : 'Fully credited'
  if (!balance && received > 0) return 'Paid in full'
  return received ? 'Part paid' : 'Payment outstanding'
}

/** A current billing view. Specific payment facts come from the saved event, never current card consent. */
export function BillingDocument({ record, receipt }: BillingDocumentProps) {
  const payment = receipt ? record.events.find(event => event.id === receipt.id && paymentKinds.has(event.kind)) : undefined
  if (receipt && !payment) return <article className="billing-paper" data-billing-document="unavailable"><h2>Payment receipt unavailable</h2><p>Choose a posted payment or a confirmed offline payment from this billing record.</p></article>

  const credits = creditFor(record), rewards = rewardCreditFor(record), received = receivedFor(record), balance = balanceFor(record)
  const draft = record.invoiceState !== 'void' && (record.invoiceState === 'draft' || !record.total)
  const voided = record.invoiceState === 'void'
  const effective = voided ? 0 : Math.max(0, cents(record.total - credits))
  const grossReceived = cents(record.events.filter(event => paymentKinds.has(event.kind)).reduce((sum, event) => sum + event.amount, 0))
  const refunds = cents(record.events.filter(event => event.kind === 'refunded').reduce((sum, event) => sum + event.amount, 0))
  const status = invoiceStatus(record, balance, credits, received)
  const title = payment ? 'Payment receipt' : draft ? 'Draft invoice' : 'Invoice'
  const currentBalanceLabel = draft ? 'Invoice total to be finalized' : voided ? 'Invoice voided · no balance due' : 'Current invoice balance'

  return <article className="billing-paper" data-billing-document={payment ? 'receipt' : 'invoice'} aria-label={payment ? `Payment receipt for ${record.customer}` : `${title} ${record.invoiceNumber}`}>
    <header className="billing-paper-letterhead">
      <img className="billing-paper-logo" src="/brand/logo-compact-ink.svg" alt="Chef Sergio & Co." />
      <p className="billing-paper-service">Private dining<br />&amp; culinary experiences</p>
    </header>
    <div className="billing-paper-title-row"><h2>{title}</h2><p className="billing-paper-reference">{payment ? `Invoice ${record.invoiceNumber}` : record.invoiceNumber}</p></div>
    <div className="billing-paper-meta">
      <div><span className="billing-paper-label">{payment ? 'Received from' : 'Prepared for'}</span><p className="billing-paper-name">{record.customer}</p><p className="billing-paper-detail">{record.eventLabel}</p></div>
      <div><span className="billing-paper-label">Your event</span><p>{dateLabel(record.eventDate, true)}</p>{!payment && <p className="billing-paper-detail">{draft ? 'Created' : 'Recorded'} {dateLabel(record.issuedAt)}</p>}</div>
    </div>
    <div className="billing-paper-amount-block">
      <div><span className="billing-paper-label">{payment ? 'Payment received' : draft ? 'Draft total' : record.invoiceState === 'uncollectible' ? 'Unpaid balance' : 'Balance due'}</span><p className="billing-paper-amount" data-billing-amount>{payment ? currency.format(payment.amount) : draft ? record.total > 0 ? currency.format(record.total) : 'To be agreed' : currency.format(balance)}</p></div>
      <p className="billing-paper-status" data-billing-status>{payment ? 'Payment recorded' : status}</p>
    </div>

    {payment ? <>
      <dl className="billing-paper-receipt-facts">
        <div><dt className="billing-paper-label">Received on</dt><dd><time dateTime={payment.at}>{dateLabel(payment.at)}</time></dd></div>
        <div><dt className="billing-paper-label">Payment method</dt><dd>{paymentMethod(payment)}</dd></div>
      </dl>
      <dl className="billing-paper-allocation">
        <div><dt>Applied to</dt><dd>{record.invoiceNumber}</dd></div>
        <div><dt>Payment reference</dt><dd className="billing-paper-reference-value">{payment.reference || 'Not recorded'}</dd></div>
      </dl>
      <div className="billing-paper-current-balance"><span>{currentBalanceLabel}</span>{!draft && <span className="billing-paper-number">{currency.format(balance)}</span>}</div>
      {refunds > 0 && <p className="billing-paper-note">Refunds recorded against this invoice: {currency.format(refunds)}. This receipt retains the original payment amount.</p>}
      <p className="billing-paper-note">The invoice balance reflects the current billing record, including later payments and adjustments.</p>
    </> : <>
      <table className="billing-paper-items"><caption className="billing-paper-sr-only">Invoice items, in US dollars</caption><thead><tr><th scope="col">Description</th><th scope="col">Amount</th></tr></thead><tbody>
        {record.items.map((item, index) => <tr key={index}><td><p>{item.description}</p><p className="billing-paper-detail">{item.quantity.toLocaleString('en-US')} × {currency.format(item.unitPrice)}</p></td><td className="billing-paper-number">{currency.format(cents(item.quantity * item.unitPrice))}</td></tr>)}
        {!record.items.length && <tr><td colSpan={2}>Line items have not been recorded.</td></tr>}
      </tbody></table>
      <dl className="billing-paper-totals">
        <div><dt>{draft ? 'Draft total' : 'Invoice total'}</dt><dd>{currency.format(record.total)}</dd></div>
        {credits - rewards > 0 && <div><dt>Other credit notes</dt><dd>−{currency.format(cents(credits - rewards))}</dd></div>}{rewards > 0 && <div><dt>Reward credits applied</dt><dd>−{currency.format(rewards)}</dd></div>}
        {(credits > 0 || voided) && <div><dt>{voided ? 'Invoice voided' : 'Total after credits'}</dt><dd>{currency.format(effective)}</dd></div>}
        {grossReceived > 0 && <div><dt>Payments received</dt><dd>−{currency.format(grossReceived)}</dd></div>}
        {refunds > 0 && <div><dt>Refunds recorded</dt><dd>+{currency.format(refunds)}</dd></div>}
        <div className="billing-paper-total-final"><dt>{draft ? 'Draft · not due for payment' : voided ? 'No balance due' : record.invoiceState === 'uncollectible' ? 'Unpaid balance' : 'Balance due'}</dt><dd>{draft ? 'Not issued' : currency.format(balance)}</dd></div>
      </dl>
    </>}

    {record.refundReview && <aside className="billing-paper-review"><strong>Payment review needed.</strong> The recorded payment history is retained. Any refund requires a separate confirmed record.</aside>}
    <footer className="billing-paper-closing">
      <p className="billing-paper-signoff">{payment ? 'Thank you.' : 'For any questions, please contact Sergio.'}</p>
      <div className="billing-paper-footer"><span>Chef Sergio &amp; Co. · USD</span><span>{payment ? `Payment record ${payment.id}` : record.invoiceNumber}</span></div>
      {!payment && <p className="billing-paper-note">Current billing record. This is not a tax invoice.</p>}
    </footer>
  </article>
}

export default BillingDocument
