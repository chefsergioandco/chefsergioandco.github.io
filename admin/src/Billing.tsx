import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useAdmin } from './store'
import { balanceFor, businessDate, creditFor, rewardCreditFor, receivedFor, type BillingEvent, type BillingEventKind, type BillingRecord, type CollectionPlan } from './operations'
import { Icon, Modal } from './ui'
import { BillingDocument } from './BillingDocument'
import './Billing.css'

const labels: Record<BillingEventKind, string> = {
  invoice_issued: 'Invoice created', initiated: 'Debit initiated', processing: 'Processing', posted: 'Payment posted', failed: 'Payment failed', canceled: 'Cancelled', refund_initiated: 'Refund initiated', refunded: 'Refund posted', offline_received: 'Offline payment recorded', plan_changed: 'Collection plan changed', payment_link_created: 'Payment link created', credit_issued: 'Credit note issued', reward_credit_applied: 'Reward credit applied', reward_credit_reversed: 'Reward credit reversed',
}
const billingCurrency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const money = (amount: number) => billingCurrency.format(amount)
const transactionKinds = ['initiated', 'processing', 'posted', 'failed', 'canceled', 'refund_initiated', 'refunded']
const terminalKinds = ['posted', 'failed', 'canceled', 'refunded']
const cents = (value: number) => Math.round(value * 100) / 100
function pendingTransactions(record: BillingRecord) {
  const last = new Map<string, BillingEvent>()
  for (const event of [...record.events].sort((a, b) => a.at.localeCompare(b.at))) {
    if (event.transactionId && transactionKinds.includes(event.kind)) last.set(event.transactionId, event)
  }
  return [...last.values()].filter(event => !terminalKinds.includes(event.kind))
}
function paymentState(record: BillingRecord) {
  if (record.refundReview) return 'Refund review needed'
  const pending = pendingTransactions(record)
  if (pending.some(event => event.kind === 'refund_initiated')) return 'Refund processing'
  if (pending.length) return 'Payment processing'
  if (record.invoiceState === 'void') return receivedFor(record) ? 'Voided · receipt retained' : 'Voided invoice'
  if (record.invoiceState === 'uncollectible') return 'Marked uncollectible'
  if (!record.total) return 'Quote pending'
  if (record.invoiceState === 'draft') return 'Draft invoice'
  if (creditFor(record) > 0 && !balanceFor(record)) return receivedFor(record) ? 'Balance closed by credit' : 'Fully credited'
  if (!balanceFor(record)) return 'Paid in full'
  const latest = [...record.events].reverse().find(event => ['posted', 'offline_received', 'refunded', 'failed'].includes(event.kind))
  if (latest?.kind === 'failed') return 'Payment failed'
  return receivedFor(record) ? 'Part paid' : 'Payment outstanding'
}
const effectiveTotal = (record: BillingRecord) => record.invoiceState === 'void' ? 0 : Math.max(0, cents(record.total - creditFor(record)))
const modeLabel = (mode: CollectionPlan['mode']) => mode === 'auto_debit' ? 'Automatic debit' : mode === 'paused' ? 'Collection paused' : 'Manual collection'
const collectionHeading = (record: BillingRecord) => balanceFor(record) ? modeLabel(record.collection.mode) : record.invoiceState === 'void' ? 'Invoice voided' : !record.total ? 'Quote pending' : creditFor(record) > 0 ? 'Collection closed' : 'Collection complete'
const closedCollectionMessage = (record: BillingRecord) => !record.total ? 'No invoice balance has been agreed. No debit is scheduled.' : 'No unpaid balance. No further debit is scheduled.'
function downloadCSV(filename: string, rows: (string | number)[][]) {
  const csv = '\uFEFF' + rows.map(row => row.map(cell => {
    const value = String(cell)
    // Spreadsheet formulas are not part of a billing export.
    const safe = /^[=+@\-]/.test(value) ? "'" + value : value
    return '"' + safe.replaceAll('"', '""') + '"'
  }).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function eventRows(record: BillingRecord): (string | number)[][] {
  return [['Invoice', record.invoiceNumber], ['Customer', record.customer], ['Event', record.eventLabel], ['Event date', record.eventDate], ['Original invoice total', record.total], ['Credits and adjustments', creditFor(record)], ['Reward credits included', rewardCreditFor(record)], ['Effective invoice total', effectiveTotal(record)], ['Invoice status', record.invoiceState || ''], ['Net received', receivedFor(record)], ['Unpaid balance', balanceFor(record)], [], ['Timestamp (ET)', 'Stage', 'Amount USD', 'Reference', 'Transaction ID', 'Description', 'Actor'], ...[...record.events].sort((a, b) => a.at.localeCompare(b.at)).map(event => [businessDate(event.at, true), labels[event.kind], event.amount, event.reference, event.transactionId || '', event.description, event.actor])]
}

function Timeline({ record, compact = false }: { record: BillingRecord; compact?: boolean }) {
  const events = [...record.events].sort((a, b) => b.at.localeCompare(a.at))
  return <ol className={'billing-timeline ' + (compact ? 'compact' : '')}>{(compact ? events.slice(0, 3) : events).map(event => <li key={event.id} className={'billing-stage-' + event.kind}>
    <span className="billing-event-symbol"><Icon name={['posted', 'offline_received', 'refunded', 'credit_issued', 'reward_credit_applied', 'reward_credit_reversed'].includes(event.kind) ? 'check' : ['failed', 'canceled'].includes(event.kind) ? 'close' : 'clock'} size={15}/></span>
    <div><div className="billing-event-heading"><strong>{labels[event.kind]}</strong>{event.amount > 0 && <span>{['refunded', 'credit_issued', 'reward_credit_applied'].includes(event.kind) ? '−' : ''}{money(event.amount)}</span>}</div><time dateTime={event.at}>{businessDate(event.at, true)}</time>{!compact && <><p>{event.description}</p><span className="billing-reference">{event.reference}{event.transactionId && event.transactionId !== event.reference ? ` · ${event.transactionId}` : ''} · {event.actor}</span></>}</div>
  </li>)}</ol>
}

type Action = 'plan' | 'offline' | null
function BillingDetail({ recordId }: { recordId: string }) {
  const { state, billingAction, notify, capabilities, pending: saving } = useAdmin()
  const record = state.operations.billing.find(item => item.id === recordId)
  const [action, setAction] = useState<Action>(null)
  const [mode, setMode] = useState<'manual' | 'paused'>('manual')
  const [reason, setReason] = useState('')
  const [amount, setAmount] = useState('')
  const [reference, setReference] = useState('')
  const [offlineMethod, setOfflineMethod] = useState('Bank transfer')
  const [review, setReview] = useState(false)
  const [error, setError] = useState('')
  const [documentView, setDocumentView] = useState<'invoice' | 'receipts' | null>(null)
  const [receiptId, setReceiptId] = useState('')
  const heading = useRef<HTMLHeadingElement>(null)
  const detail = useRef<HTMLDivElement>(null)
  useEffect(() => { heading.current?.focus({ preventScroll: true }) }, [recordId, action, documentView])
  useEffect(() => () => { document.body.classList.remove('billing-print-document') }, [])
  if (!record) return <p className="billing-empty">No billing record was found for this booking.</p>
  const received = receivedFor(record), balance = balanceFor(record), credits = creditFor(record)
  const receipts = record.events.filter(event => ['posted', 'offline_received'].includes(event.kind)).sort((a, b) => b.at.localeCompare(a.at))
  const selectedReceipt = receipts.find(event => event.id === receiptId) || receipts[0]
  const processing = pendingTransactions(record)
  const open = (next: Action) => {
    setAction(next); setReason(''); setAmount(String(balance)); setReference(''); setReview(false); setError(''); setMode(record.collection.mode === 'paused' ? 'paused' : 'manual')
  }
  async function savePlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    if (reason.trim().length < 5 || reason.trim().length > 1000) { setError('Add a reason for this collection change, between 5 and 1,000 characters.'); return }
    if (!review) { setReview(true); setError(''); return }
    const saved = await billingAction('collection', { recordId: record!.id, mode, reason: reason.trim() })
    if (!saved) { setError('The collection change was not saved. Your reason is still here; review the message and try again.'); return }
    setAction(null); notify('Collection plan saved. Previous payment records are retained.')
  }
  async function recordOffline(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    if (processing.length) { setError('A payment or refund is processing. Wait for its result before recording another payment.'); return }
    const n = Number(amount)
    if (!Number.isFinite(n) || n <= 0 || Math.abs(n * 100 - Math.round(n * 100)) > .000001 || n > balance) { setError(`Enter an amount from $0.01 to ${money(balance)}, with no more than two decimal places.`); return }
    if (reference.trim().length < 3) { setError('Add a receipt, transfer, or check reference for this payment.'); return }
    if (reason.trim().length < 3 || reason.trim().length > 1000) { setError('Add a receipt note between 3 and 1,000 characters, explaining how you confirmed the payment was received.'); return }
    if (!review) { setReview(true); setError(''); return }
    const methods: Record<string, string> = { 'Bank transfer': 'bank_transfer', Cash: 'cash', Check: 'check', 'Other offline method': 'other' }
    const saved = await billingAction('offline', { recordId: record!.id, amount: n, method: methods[offlineMethod], reference: reference.trim(), reason: reason.trim() })
    if (!saved) { setError('The receipt was not saved. Your payment details are still here; review the message and try again.'); return }
    setAction(null); notify('Offline payment saved as a dated receipt.')
  }
  const actionTitle = action === 'plan' ? 'Change collection plan' : 'Record an offline payment'
  async function printDocument() {
    const paper = detail.current?.querySelector<HTMLElement>('.billing-paper')
    await document.fonts.ready
    if (!paper?.isConnected) return
    const cleanup = () => { document.body.classList.remove('billing-print-document'); paper.removeAttribute('data-billing-print-active') }
    paper.setAttribute('data-billing-print-active', '')
    document.body.classList.add('billing-print-document')
    window.addEventListener('afterprint', cleanup, { once: true })
    try { window.print() } catch { cleanup(); notify('The print dialog could not open. Please try again.') }
  }
  return <div className="billing-detail" ref={detail}>
    <div hidden={!!action || !!documentView}>
    <div className="billing-detail-heading"><div><span className="billing-eyebrow">{record.invoiceNumber}</span><h3 ref={!action && !documentView ? heading : undefined} tabIndex={-1}>{record.customer}</h3><p>{record.eventLabel}</p><span className="billing-meta">{record.eventDate || 'Date to be agreed'} · Created {businessDate(record.issuedAt)}</span><span className={'billing-status ' + (record.refundReview ? 'attention' : '')}>{paymentState(record)}</span></div><div className="billing-balance-lead"><span>{!record.total ? 'Quote pending' : 'Balance due'}</span><strong>{!record.total ? 'Not agreed' : money(balance)}</strong><p>{money(received)} net received{record.total > 0 ? ` of ${money(effectiveTotal(record))}` : ''}</p></div></div>
    {record.refundReview && <div className="billing-warning"><Icon name="info" size={19}/><p><strong>This record needs a refund decision.</strong> Review the agreed policy and any unapplied overpayment. Cancelling a reservation does not itself refund a payment.</p></div>}
    {credits > 0 && <p className="billing-credit-summary">Original total {money(record.total)} · Credits and adjustments {money(credits)}{rewardCreditFor(record) > 0 ? ` · Reward credits ${money(rewardCreditFor(record))}` : ''}. Original receipts and credits remain in the history.</p>}
    <div className="billing-actions"><button className="button" onClick={() => setDocumentView('invoice')}><Icon name="book" size={16}/>View invoice</button><button className="button secondary" disabled={!receipts.length} onClick={() => setDocumentView('receipts')}>View {receipts.length === 1 ? 'receipt' : 'receipts'}{receipts.length > 1 ? ` (${receipts.length})` : ''}</button><button className="button secondary" disabled={saving || !balance || processing.length > 0 || record.invoiceState === 'void'} onClick={() => open('offline')}>Record offline payment</button></div>
    {!capabilities.cardPayments && <p className="billing-connection-note"><Icon name="info" size={17}/><span>Card payments are not connected. Record an offline payment only after receiving it.</span></p>}
    {processing.length > 0 && <div className="billing-pending">{processing.map(event => <section key={event.id}><strong>{event.kind === 'refund_initiated' ? 'Refund processing' : 'Payment processing'} · {money(event.amount)}</strong><p>{event.transactionId} · Began {businessDate(event.at, true)}. Its result must come from the payment provider.</p></section>)}</div>}
    <section className="billing-history"><div className="billing-section-heading"><h4>Payment activity</h4><span>Newest first · Eastern Time</span></div><Timeline record={record}/></section>
    <details className="billing-collection-details"><summary>Collection details</summary><div className="billing-plan"><div><h4>{collectionHeading(record)}</h4><p>{!balance ? closedCollectionMessage(record) : record.collection.mode === 'auto_debit' ? `${money(balance)} is scheduled for ${businessDate(record.collection.dueAt)}.` : record.collection.mode === 'paused' ? 'Collection is paused. No automatic debit is scheduled.' : 'Collect the unpaid balance by an agreed method. No automatic debit is scheduled.'}</p><p>Last changed {businessDate(record.collection.changedAt)} · {record.collection.reason}</p></div><button className="button secondary" disabled={saving} onClick={() => open('plan')}>Change collection plan</button></div><div className="billing-authorization"><Icon name="card" size={19}/><div><strong>{record.consent.method}{record.consent.last4 ? ` ending ${record.consent.last4}` : ''}</strong><p>{record.consent.status === 'on_file' ? `Authorization recorded · ${record.consent.recordedAt ? businessDate(record.consent.recordedAt) : 'Date not recorded'}` : record.consent.status === 'revoked' ? 'Guest authorization revoked.' : 'No automatic-debit authorization recorded.'}</p></div></div><p className="billing-meta">Offline receipts record payments you confirmed receiving. A card payment’s posted status is separate from the bank payout.</p><button className="button secondary" onClick={() => { downloadCSV(record.invoiceNumber + '-billing-record.csv', eventRows(record)); notify('Billing record downloaded as CSV.') }}>Download record CSV</button></details>
    </div>
    {documentView && <section className="billing-document-view" aria-label="Billing documents">
      <h3 ref={documentView ? heading : undefined} tabIndex={-1} className="billing-view-title">{record.customer} · Documents</h3>
      <div className="billing-document-toolbar"><button type="button" className="button secondary" onClick={() => setDocumentView(null)}>Back to record</button><button type="button" className="button" onClick={() => void printDocument()} disabled={documentView === 'receipts' && !selectedReceipt}>Print / save PDF</button></div>
      <div className="billing-document-controls"><div className="billing-document-switch" role="group" aria-label="Document type"><button type="button" aria-pressed={documentView === 'invoice'} onClick={() => setDocumentView('invoice')}>Invoice</button><button type="button" aria-pressed={documentView === 'receipts'} onClick={() => setDocumentView('receipts')}>Receipts{receipts.length > 0 ? ` (${receipts.length})` : ''}</button></div>{documentView === 'receipts' && receipts.length > 1 && <label className="billing-receipt-select">Payment received<select value={selectedReceipt.id} onChange={event => setReceiptId(event.target.value)}>{receipts.map(receipt => <option key={receipt.id} value={receipt.id}>{money(receipt.amount)} · {businessDate(receipt.at)} · {receipt.reference}</option>)}</select></label>}</div>
      <div className="billing-document-canvas">{documentView === 'invoice' ? <BillingDocument record={record}/> : selectedReceipt ? <BillingDocument record={record} receipt={selectedReceipt}/> : <div className="billing-empty"><h4>No payment receipts yet</h4><p>A receipt appears here after a payment is confirmed as received.</p></div>}</div>
    </section>}
    {action && <section className="billing-action-view"><header><h3 ref={action ? heading : undefined} tabIndex={-1}>{actionTitle}</h3><p className="billing-meta">{record.invoiceNumber} · {record.customer}</p></header>
      {action === 'plan' && <form className="billing-form" onSubmit={savePlan}><fieldset disabled={saving} className="billing-form-fields">
        {processing.length > 0 && <div className="billing-warning"><p>This changes future collection only. It does not cancel a payment or refund already processing.</p></div>}
        {review ? <><div className="billing-review"><h3>{modeLabel(mode)}</h3><p>{mode === 'paused' ? 'Collection will pause until you review this plan again.' : 'The balance will be collected manually by an agreed method.'}</p><p><strong>Reason:</strong> {reason}</p></div><p className="billing-meta">This adds a dated plan change. Earlier payment records stay intact.</p></> : <><label className="field">Collection method<select value={mode} onChange={event => { setMode(event.target.value as typeof mode); setError('') }}><option value="paused">Pause collection</option><option value="manual">Manual collection</option></select></label><label className="field">Reason for the override<textarea value={reason} onChange={event => setReason(event.target.value)} required minLength={5} maxLength={1000} rows={3} placeholder="Agreed with the guest by phone…"/></label></>}
        {error && <p className="form-error" role="alert">{error}</p>}<div className="billing-form-actions"><button type="button" className="button secondary" onClick={() => review ? setReview(false) : setAction(null)}>{review ? 'Back to editing' : 'Keep current plan'}</button><button className="button" type="submit">{saving ? 'Saving…' : review ? 'Confirm collection change' : 'Review change'}</button></div>
      </fieldset></form>}
      {action === 'offline' && <form className="billing-form" onSubmit={recordOffline}><fieldset disabled={saving} className="billing-form-fields">{review ? <div className="billing-review"><h3>{money(Number(amount))} received offline</h3><p>{offlineMethod} · Reference {reference}</p><p>Confirm this payment has already been received. A separate dated receipt will be saved.</p>{reason && <p>{reason}</p>}</div> : <><label className="field">Amount received ($)<input type="number" step="0.01" min="0.01" max={balance} value={amount} onChange={event => setAmount(event.target.value)} required/></label><label className="field">Payment method<select value={offlineMethod} onChange={event => setOfflineMethod(event.target.value)}><option>Bank transfer</option><option>Cash</option><option>Check</option><option>Other offline method</option></select></label><label className="field">Transfer, receipt, or check reference<input value={reference} onChange={event => setReference(event.target.value)} required minLength={3} maxLength={200}/></label><label className="field">Receipt note<textarea rows={2} value={reason} onChange={event => setReason(event.target.value)} required minLength={3} maxLength={1000} placeholder="How you confirmed this payment was received…"/></label></>}{error && <p className="form-error" role="alert">{error}</p>}<div className="billing-form-actions"><button className="button secondary" type="button" onClick={() => review ? setReview(false) : setAction(null)}>{review ? 'Back to editing' : 'Cancel'}</button><button className="button" type="submit">{saving ? 'Saving…' : review ? 'Confirm offline receipt' : 'Review offline payment'}</button></div></fieldset></form>}
    </section>}
  </div>
}

export function BillingPanel({ bookingId }: { bookingId: string }) {
  const { state } = useAdmin()
  const [open, setOpen] = useState(false)
  const record = state.operations.billing.find(item => item.bookingId === bookingId)
  if (!record) return <section className="billing-compact"><h3>Billing & collection</h3><p>A billing record has not been created for this booking yet.</p></section>
  return <section className="billing-compact"><div className="billing-section-heading"><h3>Billing & collection</h3><span className={'billing-status ' + (record.refundReview ? 'attention' : '')}>{paymentState(record)}</span></div><div className="billing-compact-amounts"><div><span>{record.total ? 'Balance due' : 'Quote pending'}</span><strong>{record.total ? money(balanceFor(record)) : 'Not agreed'}</strong></div><div><span>Net received</span><strong>{money(receivedFor(record))}</strong></div></div><p className="billing-compact-plan"><Icon name="clock" size={17}/><span>{!balanceFor(record) ? <><strong>{collectionHeading(record)}</strong><br/>{closedCollectionMessage(record)}</> : record.collection.mode === 'auto_debit' ? <><strong>{money(balanceFor(record))} auto-debit</strong><br/>{businessDate(record.collection.dueAt)}</> : <><strong>{modeLabel(record.collection.mode)}</strong><br/>No automatic debit scheduled.</>}</span></p>{record.refundReview && <p className="billing-compact-alert">Refund or overpayment review needed.</p>}<Timeline record={record} compact/><button className="button secondary" onClick={() => setOpen(true)}>Open billing record</button>{open && <Modal wide title={'Billing · ' + record.customer} subtitle={record.invoiceNumber} onClose={() => setOpen(false)}><BillingDetail recordId={record.id}/></Modal>}</section>
}

export function BillingRecords({ initialRecordId, initialBookingId, initialFilter = 'all' }: { initialRecordId?: string; initialBookingId?: string; initialFilter?: 'all' | 'outstanding' | 'review' }) {
  const { state, notify, capabilities } = useAdmin()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'outstanding' | 'review'>(initialFilter)
  const [selected, setSelected] = useState<string | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const records = state.operations.billing.filter(record => (!query.trim() || [record.customer, record.invoiceNumber, record.eventLabel].some(value => value.toLowerCase().includes(query.trim().toLowerCase()))) && (filter === 'all' || filter === 'outstanding' && balanceFor(record) > 0 || filter === 'review' && record.refundReview)).sort((a, b) => a.eventDate.localeCompare(b.eventDate))
  const active = state.operations.billing.find(record => record.id === selected)
  useEffect(() => {
    setFilter(initialFilter)
    if (!initialRecordId && !initialBookingId) return
    const target = state.operations.billing.find(record => initialRecordId ? record.id === initialRecordId : record.bookingId === initialBookingId)
    if (target) setSelected(target.id)
    else notify('That billing record is no longer available. The current records are shown below.')
  }, [initialRecordId, initialBookingId, initialFilter])
  function backToList() {
    const previous = selected
    setSelected(null)
    requestAnimationFrame(() => {
      const row = Array.from(list.current?.querySelectorAll<HTMLButtonElement>('[data-billing-record]') || []).find(item => item.dataset.billingRecord === previous)
      row?.focus({ preventScroll: true })
    })
  }
  if (active) return <div className="billing-record-workspace"><div className="billing-workspace-heading"><button className="button secondary" onClick={backToList}>Back to billing</button><span>{active.invoiceNumber}</span></div><BillingDetail key={active.id} recordId={active.id}/></div>
  return <div className="billing-records">
    <div className="billing-records-intro"><p>Invoices, receipts and payment activity.</p><button className="button secondary" disabled={!state.operations.billing.length} onClick={() => { downloadCSV('sergio-billing-records.csv', [['Invoice', 'Customer', 'Event', 'Event date', 'Original total USD', 'Credits USD', 'Reward credits included USD', 'Effective total USD', 'Invoice status', 'Net received USD', 'Unpaid USD', 'Collection method', 'Scheduled at ET', 'Status', 'Refund review'], ...state.operations.billing.map(record => [record.invoiceNumber, record.customer, record.eventLabel, record.eventDate, record.total, creditFor(record), rewardCreditFor(record), effectiveTotal(record), record.invoiceState || '', receivedFor(record), balanceFor(record), collectionHeading(record), record.collection.mode === 'auto_debit' && balanceFor(record) > 0 ? businessDate(record.collection.dueAt) : '', paymentState(record), record.refundReview ? 'Yes' : 'No'])]); notify('Billing records downloaded as CSV.') }}>Export billing CSV</button></div>
    <div className="billing-overall"><div><span>Balance due</span><strong>{money(state.operations.billing.reduce((sum, record) => sum + balanceFor(record), 0))}</strong></div><div><span>Net received</span><strong>{money(state.operations.billing.reduce((sum, record) => sum + receivedFor(record), 0))}</strong></div><div><span>Refund decisions</span><strong>{state.operations.billing.filter(record => record.refundReview).length}</strong></div></div>
    <div className="billing-filter-bar"><label className="billing-search"><Icon name="search" size={18}/><input type="search" aria-label="Search billing records" placeholder="Search guest or invoice" value={query} onChange={event => setQuery(event.target.value)}/></label><label className="billing-filter-label">Show<select value={filter} onChange={event => setFilter(event.target.value as typeof filter)}><option value="all">All records</option><option value="outstanding">Balance due</option><option value="review">Refund review</option></select></label></div>
    <div className="billing-record-list" ref={list}>{records.map(record => <button className="billing-record-row" data-billing-record={record.id} key={record.id} onClick={() => setSelected(record.id)}><div><strong>{record.customer}</strong><span>{record.invoiceNumber} · {record.eventLabel}</span><small>{record.eventDate || 'Date to be agreed'}{record.reservationId ? ' · Table reservation' : ''}</small></div><div className="billing-record-balance"><strong>{record.total ? money(balanceFor(record)) : 'Not agreed'}</strong><span>{record.total ? 'Balance due' : 'Quote pending'} · {money(receivedFor(record))} received</span></div><span className={'billing-status ' + (record.refundReview ? 'attention' : '')}>{paymentState(record)}</span><Icon name="chevron" size={18}/></button>)}{!records.length && <div className="billing-empty"><Icon name="search" size={26}/><h3>{state.operations.billing.length ? 'No matching billing records' : 'No billing records yet'}</h3><p>{state.operations.billing.length ? 'Try another guest, invoice, or filter.' : 'Add your first booking with an agreed quote to start its billing record.'}</p>{state.operations.billing.length > 0 && <button className="button secondary" onClick={() => { setQuery(''); setFilter('all') }}>Clear billing filters</button>}</div>}</div>
    {!capabilities.cardPayments && <p className="billing-connection-note"><Icon name="info" size={17}/><span>Card payments are not connected. Confirmed offline receipts can be recorded here.</span></p>}
    <p className="billing-prototype-note"><Icon name="lock" size={16}/>Payment history stays with each booking in your private workspace.</p>
  </div>
}
