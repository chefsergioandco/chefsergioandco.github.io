import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Icon } from './ui'
import { GiftApiError, queueGiftAction, readGifts, readGiftSettings, saveGiftSettings } from './gift-api'
import { isGiftSettingsAction, type GiftAction, type GiftDelivery, type GiftDeliveryStatus, type GiftDetail, type GiftPurchase, type GiftsResponse, type GiftSettingsAction, type GiftSettingsResponse } from './gift-types'
import './Gifts.css'

const paymentLabels: Record<GiftPurchase['status'], string> = { creating: 'Preparing checkout', open: 'Awaiting payment', paid: 'Paid', expired: 'Checkout expired' }
const deliveryLabels: Record<GiftDeliveryStatus, string> = { not_issued: 'Not issued', scheduled: 'Scheduled', disabled: 'Delivery disabled', preview: 'Preview only', queued: 'Queued', sending: 'Sending', sent: 'Accepted by email service', delivered: 'Delivered to mail server', retry: 'Retry scheduled', failed: 'Failed', bounced: 'Bounced', complained: 'Complaint received', needs_review: 'Needs review', suppressed: 'Suppressed', cancelled: 'Cancelled', needs_contact: 'Missing contact', not_applicable: 'Not applicable' }
const deliveryHelp: Record<GiftDeliveryStatus, string> = {
  not_issued: 'There is no issued card to deliver yet.', scheduled: 'The copy is scheduled for the date below. It has not been sent.', disabled: 'Customer delivery is unavailable until its connection is ready.', preview: 'A preview exists. No customer copy has been sent.', queued: 'Waiting for background delivery. Queued does not mean delivered.', sending: 'A delivery attempt is in progress. Refresh for its result.', sent: 'The email service accepted this copy. Delivery has not been confirmed.', delivered: 'Delivery to the receiving mail server was confirmed. This does not confirm the email was opened.', retry: 'Another attempt is scheduled. It has not been confirmed delivered.', failed: 'The attempt failed. Only a supported retry is available here.', bounced: 'The receiving server rejected this copy. It is not safe to send it again here.', complained: 'A complaint was received. Do not send another copy.', needs_review: 'The result is uncertain and cannot be safely retried here.', suppressed: 'Sending to this address is blocked.', cancelled: 'This delivery was cancelled.', needs_contact: 'A usable delivery address is missing. This view cannot change the purchase’s recipients.', not_applicable: 'This purchase uses download and share; no email copy is scheduled.',
}
const attentionStates: GiftDeliveryStatus[] = ['disabled', 'preview', 'failed', 'bounced', 'complained', 'needs_review', 'suppressed', 'needs_contact']
const money = (cents: number, signed = false) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', ...(signed ? { signDisplay: 'exceptZero' as const } : {}) }).format(cents / 100)
const instant = (value: string) => new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York', timeZoneName: 'short' }).format(new Date(value))
const calendarDate = (value: string) => new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(value + 'T12:00:00Z'))
const When = ({ value, empty = 'Not recorded' }: { value: string | null; empty?: string }) => value ? <time dateTime={value}>{instant(value)}</time> : <span>{empty}</span>
const needsAttention = (purchase: GiftPurchase) => purchase.status === 'paid' && !purchase.card || purchase.card?.status === 'frozen' || purchase.card?.status === 'void' || [purchase.delivery.recipient.status, purchase.delivery.sender.status].some(status => attentionStates.includes(status))
type Filter = 'all' | 'paid' | 'unpaid' | 'attention'
type View = { query: string; cursor: string | null; id: string | null }
const keyFor = (value: View) => JSON.stringify(value)
const intentPrefix = 'sergio-gift-action-v1:'
const settingsIntentKey = 'sergio-gift-settings-intent-v1'
function rememberedIntent(key: string): string | null {
  try { const id = sessionStorage.getItem(intentPrefix + key); return id && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : null } catch { return null }
}
function rememberIntent(key: string, id: string | null) {
  try { if (id) sessionStorage.setItem(intentPrefix + key, id); else sessionStorage.removeItem(intentPrefix + key) } catch { /* Same-page recovery remains in memory when storage is blocked. */ }
}
function forgetIntents() {
  try { for (const key of Object.keys(sessionStorage)) if (key.startsWith(intentPrefix) || key === settingsIntentKey) sessionStorage.removeItem(key) } catch { /* No answer content or credential is stored here. */ }
}
type Props = { initialPurchaseId?: string; onSelectPurchase?: (id: string | null) => void; onOpenBooking?: (bookingId: string) => void }

export default function Gifts({ initialPurchaseId, onSelectPurchase, onOpenBooking }: Props) {
  const [panel, setPanel] = useState<'purchases' | 'amounts'>('purchases')
  const [view, setView] = useState<View>({ query: '', cursor: null, id: initialPurchaseId || null }), [search, setSearch] = useState(''), [filter, setFilter] = useState<Filter>('all')
  const [report, setReport] = useState<{ key: string; data: GiftsResponse; readAt: string } | null>(null)
  const [loading, setLoading] = useState(false), [fresh, setFresh] = useState(false), [error, setError] = useState(''), [feedback, setFeedback] = useState(''), [pending, setPending] = useState<string | null>(null)
  const request = useRef<AbortController | null>(null), sequence = useRef(0), action = useRef<AbortController | null>(null), working = useRef(false), attempts = useRef(new Map<string, string>()), previousCursors = useRef<(string | null)[]>([])
  const activeView = useRef(view), callbacks = useRef({ onSelectPurchase, onOpenBooking }), heading = useRef<HTMLHeadingElement | null>(null), focusAfterLoad = useRef(false), uid = useId()
  activeView.current = view; callbacks.current = { onSelectPurchase, onOpenBooking }
  const viewKey = keyFor(view), current = report?.key === viewKey ? report : null, data = current?.data, selected = data?.selected
  const clearPrivate = useCallback(() => {
    setReport(null); setFresh(false); setSearch(''); setFeedback(''); attempts.current.clear(); forgetIntents(); previousCursors.current = []
    setView({ query: '', cursor: null, id: null }); callbacks.current.onSelectPurchase?.(null)
  }, [])
  const refresh = useCallback(async (target = activeView.current): Promise<GiftsResponse | null> => {
    const controller = new AbortController(), run = ++sequence.current, key = keyFor(target)
    request.current?.abort(); request.current = controller
    setLoading(true); setFresh(false); setError('')
    try {
      const result = await readGifts({ query: target.query, cursor: target.cursor, id: target.id }, controller.signal)
      if (controller.signal.aborted || run !== sequence.current || key !== keyFor(activeView.current)) return null
      setReport({ key, data: result, readAt: result.checkedAt }); setFresh(true)
      return result
    } catch (cause) {
      if (controller.signal.aborted || run !== sequence.current) return null
      if (cause instanceof GiftApiError && [401, 403].includes(cause.status)) clearPrivate()
      setError(cause instanceof Error ? cause.message : 'Gift records could not be read. Please refresh.')
      return null
    } finally { if (run === sequence.current && !controller.signal.aborted) setLoading(false) }
  }, [clearPrivate])
  useEffect(() => { if ((initialPurchaseId || null) !== activeView.current.id) { setPanel('purchases'); focusAfterLoad.current = true; setFeedback(''); setView(current => ({ ...current, id: initialPurchaseId || null })) } }, [initialPurchaseId])
  useEffect(() => { void refresh(view); return () => request.current?.abort() }, [viewKey, refresh])
  useEffect(() => () => { ++sequence.current; request.current?.abort(); action.current?.abort() }, [])
  useEffect(() => {
    if (!current?.readAt || !fresh) return
    const timer = window.setTimeout(() => setFresh(false), 60_000)
    return () => window.clearTimeout(timer)
  }, [current?.readAt, fresh])
  useEffect(() => { if (!loading && current && focusAfterLoad.current) { focusAfterLoad.current = false; heading.current?.focus() } }, [loading, current])
  function select(id: string | null) {
    if (working.current) return
    focusAfterLoad.current = true; setFeedback(''); setError(''); setView(current => ({ ...current, id })); callbacks.current.onSelectPurchase?.(id)
  }
  function searchPurchases(event: FormEvent) {
    event.preventDefault(); if (working.current) return
    previousCursors.current = []; setFilter('all'); setFeedback(''); setView({ query: search.trim(), cursor: null, id: null }); callbacks.current.onSelectPurchase?.(null)
  }
  function page(next: boolean) {
    if (working.current || loading) return
    if (next && data?.page.nextCursor) { previousCursors.current.push(view.cursor); setView(current => ({ ...current, cursor: data.page.nextCursor, id: null })) }
    else if (!next && previousCursors.current.length) { const cursor = previousCursors.current.pop() ?? null; setView(current => ({ ...current, cursor, id: null })) }
  }
  async function queue(kind: GiftAction['action'], messageId?: string) {
    if (working.current || !fresh || loading || !selected) return
    if (kind === 'reconcile_purchase' ? !selected.canReconcile : selected.fulfillment !== 'email' || !data?.readiness.deliveryReady || (kind === 'queue_due' ? !selected.canQueueDue : !messageId || !Object.values(selected.delivery).some(row => row.messageId === messageId && row.canRetry))) return
    const purchaseId = selected.id, attemptKey = `${purchaseId}:${kind}:${messageId || ''}`, controller = new AbortController()
    const requestId = attempts.current.get(attemptKey) || rememberedIntent(attemptKey) || crypto.randomUUID(); attempts.current.set(attemptKey, requestId); rememberIntent(attemptKey, requestId)
    const expectedCopies = kind === 'queue_due' ? (['sender', 'recipient'] as const).filter(role => !selected.delivery[role].messageId && (role === 'sender' || selected.delivery[role].scheduledFor !== null && Date.parse(selected.delivery[role].scheduledFor!) <= Date.parse(current!.readAt))) : []
    working.current = true; action.current = controller; setPending(attemptKey); setError(''); setFeedback('')
    try {
      await queueGiftAction({ purchaseId, action: kind, requestId, ...(messageId ? { messageId } : {}) }, controller.signal)
      if (controller.signal.aborted) return
      const result = await refresh()
      if (!result?.selected || result.selected.id !== purchaseId || kind === 'retry_delivery' && !Object.values(result.selected.delivery).some(row => row.messageId === messageId) || expectedCopies.some(role => !result.selected?.delivery[role].messageId)) throw new GiftApiError('The queue request was acknowledged, but its saved record could not be read back. Refresh or retry the same action.')
      attempts.current.delete(attemptKey); rememberIntent(attemptKey, null)
      setFeedback(kind === 'reconcile_purchase' ? 'The recorded checkout was checked. Current payment, card and fulfillment results are shown.' : 'The request to queue delivery was recorded. Current recipient and sender results are shown below; this does not confirm an email was delivered.')
    } catch (cause) {
      if (controller.signal.aborted) return
      if (cause instanceof GiftApiError && [401, 403].includes(cause.status)) clearPrivate()
      setError(cause instanceof Error ? cause.message : 'Delivery could not be confirmed. Retry the same action.')
    } finally { working.current = false; action.current = null; if (!controller.signal.aborted) setPending(null) }
  }
  const disabled = loading || !!pending, actionDisabled = disabled || !fresh
  const rows = data?.purchases.filter(item => filter === 'paid' ? item.status === 'paid' : filter === 'unpaid' ? item.status !== 'paid' : filter === 'attention' ? needsAttention(item) : true) ?? []
  if (panel === 'amounts') return <section className="gifts" aria-label="Gift amount settings"><GiftAmounts onBack={() => { setPanel('purchases'); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.gifts-amounts-open')?.focus()) }} onAccessDenied={clearPrivate}/></section>
  return <section className="gifts" aria-label="Gift purchases">
    <header className="gifts-heading"><div><p className="eyebrow">A place at the table</p><h2 ref={heading} tabIndex={-1}>{selected ? `A gift for ${selected.recipientName}` : view.id ? 'Gift purchase.' : 'Gift cards.'}</h2><p>{selected ? `From ${selected.senderName} · ${money(selected.amountCents)}` : 'Follow each purchase, card balance and fulfillment method.'}</p></div><div className="gifts-heading-actions">{!view.id && <button type="button" className="button secondary gifts-amounts-open" disabled={disabled} onClick={() => setPanel('amounts')}><Icon name="edit" size={17}/>Gift amounts</button>}<button type="button" className="button secondary" disabled={disabled} onClick={() => void refresh()}><Icon name="history" size={17}/>{loading ? 'Refreshing…' : 'Refresh gifts'}</button></div></header>
    {current && <p className="gifts-read-at">{fresh ? 'Read' : 'Earlier records · refresh before acting'} <When value={current.readAt}/>. All times Eastern.</p>}
    {error && <p className="gifts-notice gifts-error" role="alert">{error}{current && ' Earlier records may be out of date; delivery actions are unavailable until refreshed.'}</p>}
    {feedback && <p className="gifts-notice" role="status">{feedback}</p>}
    {data && <>
      {view.id ? <details className="gifts-readiness-compact" aria-label="Gift connection"><summary><Icon name={data.readiness.salesReady ? 'check' : 'lock'} size={17}/>{data.readiness.salesReady ? 'Gift checkout is enabled' : 'New gift sales are closed'}{data.readiness.missing.length > 0 ? ' · setup details' : ' · connection details'}</summary><p>Payment, card issuance and fulfillment are separate results. This purchase’s current results are below.</p>{data.readiness.missing.length > 0 && <ul>{data.readiness.missing.map((item, index) => <li key={index}>{item}</li>)}</ul>}</details> : <aside className={`gifts-readiness ${data.readiness.salesReady ? 'is-ready' : ''}`} aria-label="Gift connection"><Icon name={data.readiness.salesReady ? 'check' : 'lock'} size={22}/><div><strong>{data.readiness.salesReady ? 'Gift checkout is enabled' : 'Gift checkout is closed'}</strong><p>{data.readiness.salesReady ? data.readiness.fulfillment === 'download' ? 'New purchases use download and share. The buyer downloads the issued card and shares it; email delivery is not part of these purchases.' : 'Paid, issued and delivered are separate results. Review the individual purchase before promising a card has arrived.' : 'New sales remain unavailable until their payment and fulfillment setup is ready. Existing records are still shown here.'}</p>{!data.readiness.deliveryReady && data.purchases.some(row => row.fulfillment === 'email') && <p>Email delivery is unavailable. Earlier email purchases keep their own delivery records and may still need attention.</p>}{data.readiness.missing.length > 0 && <details><summary>Setup still needed</summary><ul>{data.readiness.missing.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}</div></aside>}
      {!view.id && <><dl className="gifts-summary"><div><dt>Purchases</dt><dd>{data.summary.purchases}</dd></div><div><dt>Issued cards</dt><dd>{data.summary.issued}</dd></div><div><dt>Recorded card balance</dt><dd>{money(data.summary.outstandingCents)}</dd></div><div><dt>In checkout holds</dt><dd>{money(data.summary.heldCents)}</dd></div></dl><p className="gifts-summary-scope">Across all gift purchases, regardless of search or page. All amounts USD.</p>
        <form className="gifts-search" onSubmit={searchPurchases}><label htmlFor={uid + '-search'}>Search purchases<input id={uid + '-search'} type="search" maxLength={200} value={search} disabled={!!pending} onChange={event => setSearch(event.target.value)} placeholder="Name, email, purchase ID or last four"/></label><button className="button secondary" type="submit" disabled={disabled}><Icon name="search" size={17}/>Search</button></form>
        <div className="gifts-list-heading"><label htmlFor={uid + '-filter'}>Show on this page<select id={uid + '-filter'} disabled={disabled} value={filter} onChange={event => setFilter(event.target.value as Filter)}><option value="all">All purchases</option><option value="paid">Paid</option><option value="unpaid">Not paid</option><option value="attention">Needs attention</option></select></label><p>Search checks all purchases. Filters apply to this page.</p></div>
        <div aria-busy={loading} className="gifts-list" aria-label="Purchase results">{rows.length ? <ul>{rows.map(item => <li key={item.id}><button type="button" className="gifts-purchase" disabled={disabled} onClick={() => select(item.id)}><span className="gifts-purchase-person"><strong>{item.recipientName}</strong><span>From {item.senderName}</span><span>{calendarDate(item.sendOn)} · {item.card ? `Ending ${item.card.last4}` : 'Card not issued'}</span></span><span className="gifts-purchase-state"><strong>{money(item.amountCents)}</strong><span className={'gifts-status payment-' + item.status}>{paymentLabels[item.status]}</span><span>{item.card?.status === 'frozen' ? 'Spending frozen' : item.card?.status === 'void' ? 'Card void' : item.card ? 'Card issued' : 'Not issued'}</span>{item.fulfillment === 'download' ? <><span>Download and share</span><span>{item.canDownload ? 'Buyer download available' : item.card ? 'Buyer download unavailable' : 'Available after paid issuance'}</span></> : <><span>Recipient: {deliveryLabels[item.delivery.recipient.status]}</span><span>Sender: {deliveryLabels[item.delivery.sender.status]}</span></>}</span><Icon name="chevron" size={18}/></button></li>)}</ul> : <div className="gifts-empty"><Icon name="card" size={28}/><h3>{data.summary.purchases === 0 && !view.query ? 'No gift purchases yet.' : 'No matching purchases on this page.'}</h3><p>{data.summary.purchases === 0 && !view.query ? 'Real purchases will appear here when gift checkout is enabled and a customer begins one.' : 'Try a different search or filter, or continue to the next page if available.'}</p></div>}</div>
        <nav className="gifts-pagination" aria-label="Gift purchase pages"><button type="button" className="button secondary" disabled={disabled || !previousCursors.current.length} onClick={() => page(false)}>Previous page</button><span>Showing {rows.length} of up to {data.page.limit} purchases on this page.</span><button type="button" className="button secondary" disabled={disabled || !data.page.nextCursor} onClick={() => page(true)}>Next page</button></nav>
      </>}
      {view.id && selected && <GiftPurchaseDetail purchase={selected} checkedAt={data.checkedAt} disabled={actionDisabled} working={!!pending} deliveryReady={data.readiness.deliveryReady} onBack={() => select(null)} onQueue={(kind, id) => void queue(kind, id)} onOpenBooking={onOpenBooking}/>}
    </>}
    {!data && loading && <p className="gifts-empty" role="status">Opening gift records…</p>}
    {!data && !loading && !error && <p className="gifts-notice" role="status">Refresh to read gift records.</p>}
  </section>
}
function GiftPurchaseDetail({ purchase, checkedAt, disabled, working, deliveryReady, onBack, onQueue, onOpenBooking }: { purchase: GiftDetail; checkedAt: string; disabled: boolean; working: boolean; deliveryReady: boolean; onBack: () => void; onQueue: (action: GiftAction['action'], messageId?: string) => void; onOpenBooking?: (id: string) => void }) {
  const card = purchase.card
  return <div className="gifts-detail">
    <button className="gifts-back" type="button" disabled={working} onClick={onBack}><Icon name="undo" size={17}/>Back to purchases</button>
    <div className="gifts-detail-heading"><div><p className="gifts-kicker">Purchase reference</p><p className="gifts-reference">{purchase.id}</p></div><span className={'gifts-status payment-' + purchase.status}>{paymentLabels[purchase.status]}</span></div>
    <dl className="gifts-facts"><div><dt>Purchase created</dt><dd><When value={purchase.createdAt}/></dd></div><div><dt>Checkout deadline</dt><dd><When value={purchase.expiresAt}/></dd></div><div><dt>{purchase.fulfillment === 'download' ? 'Purchase date' : 'Requested send date'}</dt><dd>{calendarDate(purchase.sendOn)}</dd></div><div><dt>Card issuance</dt><dd>{card ? <>Issued <When value={card.issuedAt}/></> : purchase.status === 'paid' ? 'Paid · issuance needs review' : 'Not issued'}</dd></div></dl>
    {purchase.canReconcile && <div className="gifts-reconcile"><button className="button secondary" type="button" disabled={disabled} onClick={() => onQueue('reconcile_purchase')}>{working ? 'Checking…' : 'Check payment result'}</button><p className="gifts-help">Check the payment service for the checkout already associated with this purchase.</p></div>}
    {purchase.note && <div className="gifts-note"><strong>Sender’s note</strong><p>{purchase.note}</p></div>}
    <section className="gifts-section" aria-label="Gift card balance"><div className="gifts-section-heading"><h3>Card &amp; balance</h3>{card && <span className={'gifts-status card-' + card.status}>{card.status === 'active' ? 'Active card' : card.status === 'frozen' ? 'Spending frozen' : 'Card void'}</span>}</div>{card ? <><p className="gifts-kicker">Card ending {card.last4}. Full gift codes are kept out of the dashboard.</p><dl className="gifts-balance"><div><dt>Recorded balance</dt><dd>{money(card.balanceCents)}</dd></div><div><dt>Active checkout holds</dt><dd>{money(card.heldCents)}</dd></div><div><dt>Available to use</dt><dd>{money(card.availableCents)}</dd></div></dl><p className="gifts-help">{card.status === 'frozen' ? 'Spending is frozen while the purchase is reviewed. Its recorded balance remains visible.' : card.status === 'void' ? 'This card cannot be used.' : 'Active checkout holds reduce the amount available. A hold is separate from a completed redemption.'}</p></> : <p className="gifts-help">{purchase.status === 'paid' ? 'Payment is recorded, but an issued card was not found. Review this before promising delivery.' : 'There is no issued card or spendable balance for this purchase.'}</p>}</section>
    {purchase.fulfillment === 'download' ? <section className="gifts-section gifts-download" aria-label="Gift download fulfillment"><h3>Download and share</h3><p className="gifts-help">The buyer downloads the card and shares it with the recipient. No sender or recipient email copies are scheduled for this purchase.</p><span className="gifts-status">{purchase.canDownload ? 'Ready for buyer download' : card ? 'Buyer download unavailable' : 'Available after paid issuance'}</span><p className="gifts-help">{purchase.canDownload ? 'The download is available through the buyer’s private purchase link. Gift codes and private downloads stay out of the admin workspace.' : purchase.status === 'paid' && !card ? 'Card issuance needs review before a download can be offered.' : card?.status === 'frozen' || card?.status === 'void' ? 'Review this card’s status before advising the buyer.' : 'The buyer’s download becomes available after payment and card issuance.'}</p><dl className="gifts-facts"><div><dt>For</dt><dd>{purchase.recipientName}</dd></div><div><dt>Purchased by</dt><dd>{purchase.senderName}{purchase.senderEmail && <><br/>{purchase.senderEmail}</>}</dd></div></dl></section> : <section className="gifts-section" aria-label="Gift email copies"><div className="gifts-section-heading"><div><h3>Recipient &amp; sender copies</h3><p className="gifts-help">Scheduled times, provider acceptance and confirmed delivery are separate steps.</p></div>{purchase.canQueueDue && <button className="button secondary" type="button" disabled={disabled || !deliveryReady} onClick={() => onQueue('queue_due')}>{working ? 'Recording…' : 'Queue due copies'}</button>}</div><div className="gifts-deliveries">{(['recipient', 'sender'] as const).map(kind => <GiftDeliveryCard key={kind} kind={kind} name={kind === 'recipient' ? purchase.recipientName : purchase.senderName} email={kind === 'recipient' ? purchase.recipientEmail : purchase.senderEmail} delivery={purchase.delivery[kind]} disabled={disabled || !deliveryReady} onRetry={() => onQueue('retry_delivery', purchase.delivery[kind].messageId || undefined)}/>)}</div></section>}
    <section className="gifts-section" aria-label="Gift redemptions and adjustments"><h3>Card history</h3><p className="gifts-help">Issue adds value. Redemption uses it. Restoration returns value from a booking. Adjustments are recorded separately.</p>{purchase.limits.ledgerTruncated && <p className="gifts-notice">Showing the latest {purchase.limits.maxLedger} entries. Earlier card history is not included in this view.</p>}{purchase.ledger.length ? <ol className="gifts-history">{purchase.ledger.map(row => <li key={row.id}><div><strong>{{ issue: 'Card issued', spend: 'Redeemed', restore: 'Value restored', adjust: 'Adjustment' }[row.kind]}</strong><p><When value={row.createdAt}/>{row.actor ? ` · ${row.actor}` : ''}</p>{row.bookingId && onOpenBooking && <button type="button" className="gifts-record-link" disabled={working} onClick={() => onOpenBooking(row.bookingId!)}>Open booking {row.bookingId}<Icon name="chevron" size={14}/></button>}</div><strong className="gifts-money">{money(row.amountCents, true)}</strong></li>)}</ol> : <p className="gifts-help">No card history is recorded for this purchase.</p>}</section>
    <section className="gifts-section" aria-label="Gift checkout holds"><h3>Checkout holds</h3>{purchase.limits.holdsTruncated && <p className="gifts-notice">Showing the latest {purchase.limits.maxHolds} holds. Earlier holds are not included in this view.</p>}{purchase.holds.length ? <ul className="gifts-history">{purchase.holds.map(row => <li key={row.id}><div><strong>{row.purpose === 'deposit' ? 'Initial booking payment' : 'Remaining event balance'} · {row.status === 'held' && Date.parse(row.expiresAt) <= Date.parse(checkedAt) ? 'Hold expired' : { held: 'Held for checkout', captured: 'Captured', released: 'Released' }[row.status]}</strong><p>Deadline <When value={row.expiresAt}/>{row.settledAt && <> · Settled <When value={row.settledAt}/></>}</p>{onOpenBooking && <button type="button" className="gifts-record-link" disabled={working} onClick={() => onOpenBooking(row.bookingId)}>Open booking {row.bookingId}<Icon name="chevron" size={14}/></button>}</div><strong className="gifts-money">{money(row.amountCents)}</strong></li>)}</ul> : <p className="gifts-help">No checkout holds are recorded for this purchase.</p>}</section>
  </div>
}
function GiftDeliveryCard({ kind, name, email, delivery, disabled, onRetry }: { kind: 'recipient' | 'sender'; name: string; email: string; delivery: GiftDelivery; disabled: boolean; onRetry: () => void }) {
  const address = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : 'Contact email unavailable'
  return <article className="gifts-delivery"><h4>{kind === 'recipient' ? 'Recipient’s gift' : 'Sender’s receipt & card copy'}</h4><p className="gifts-delivery-person"><strong>{name}</strong><span>{address}</span></p><span className={'gifts-status delivery-' + delivery.status}>{deliveryLabels[delivery.status]}</span><p className="gifts-help">{deliveryHelp[delivery.status]}</p><dl className="gifts-delivery-times"><div><dt>Scheduled</dt><dd><When value={delivery.scheduledFor} empty="After card issuance"/></dd></div><div><dt>Accepted by email service</dt><dd><When value={delivery.sentAt}/></dd></div><div><dt>Delivery confirmed</dt><dd><When value={delivery.deliveredAt}/></dd></div></dl>{delivery.lastError && <p className="gifts-delivery-error">{delivery.lastError}</p>}{delivery.canRetry && <button className="button secondary" type="button" disabled={disabled} onClick={onRetry}>Retry {kind === 'recipient' ? 'recipient delivery' : 'sender copy'}</button>}</article>
}

const sameAmounts = (left: number[], right: number[]) => JSON.stringify(left) === JSON.stringify(right)
const amountLabel = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: value % 100 ? 2 : 0 }).format(value / 100)
function savedSettingsIntent(): GiftSettingsAction | null {
  try { const raw = sessionStorage.getItem(settingsIntentKey); if (!raw || raw.length > 5000) return null; const value: unknown = JSON.parse(raw); return isGiftSettingsAction(value) ? value : null } catch { return null }
}
function storeSettingsIntent(value: GiftSettingsAction | null) {
  try { if (value) sessionStorage.setItem(settingsIntentKey, JSON.stringify(value)); else sessionStorage.removeItem(settingsIntentKey) } catch { /* Same-page retries remain exact when storage is blocked. */ }
}
function settingsRecorded(result: GiftSettingsResponse, input: GiftSettingsAction) {
  const entry = result.history.find(row => row.requestId === input.requestId && row.revision === input.expectedRevision + 1 && sameAmounts(row.amounts, input.amounts))
  return !!entry && (result.settings.revision > entry.revision || result.settings.revision === entry.revision && sameAmounts(result.settings.amounts, input.amounts))
}
function GiftAmounts({ onBack, onAccessDenied }: { onBack: () => void; onAccessDenied: () => void }) {
  const [data, setData] = useState<GiftSettingsResponse | null>(null), [draft, setDraft] = useState<number[]>([]), [newAmount, setNewAmount] = useState(''), [selected, setSelected] = useState<number | null>(null)
  const [stage, setStage] = useState<'edit' | 'review'>('edit'), [intent, setIntent] = useState<GiftSettingsAction | null>(savedSettingsIntent), [busy, setBusy] = useState<'read' | 'save' | null>('read')
  const [fresh, setFresh] = useState(false), [readAt, setReadAt] = useState(''), [conflict, setConflict] = useState(false), [error, setError] = useState(''), [fieldError, setFieldError] = useState(''), [feedback, setFeedback] = useState('')
  const controller = useRef<AbortController | null>(null), sequence = useRef(0), saving = useRef(false), live = useRef(true), heading = useRef<HTMLHeadingElement | null>(null), reviewHeading = useRef<HTMLHeadingElement | null>(null), addInput = useRef<HTMLInputElement | null>(null), uid = useId()
  const current = useRef({ data, draft, intent }); current.current = { data, draft, intent }
  const dirty = !!data && !sameAmounts(data.settings.amounts, draft), disabled = !!busy || !!intent || !fresh
  function clearPrivate() {
    ++sequence.current; controller.current?.abort(); storeSettingsIntent(null); setIntent(null); setData(null); setDraft([]); setSelected(null); setNewAmount(''); setFeedback(''); setFresh(false); setConflict(false); setBusy(null); onAccessDenied()
  }
  function finish(result: GiftSettingsResponse, input: GiftSettingsAction, recovered = false) {
    storeSettingsIntent(null); setIntent(null); setData(result); setDraft(result.settings.amounts); setStage('edit'); setConflict(false); setError(''); setFresh(true); setReadAt(new Date().toISOString())
    setFeedback(result.settings.revision > input.expectedRevision + 1 ? 'Your change is recorded. A newer change is now active; the latest offered amounts are shown.' : recovered ? 'Your saved change was confirmed in the recorded history. These amounts are now offered for new purchases.' : 'Gift amounts saved. These choices apply to new purchases; existing cards keep their value.')
    requestAnimationFrame(() => heading.current?.focus())
  }
  async function load() {
    if (saving.current) return
    const run = ++sequence.current, abort = new AbortController(); controller.current?.abort(); controller.current = abort
    setBusy('read'); setError(''); setFeedback(''); setFresh(false)
    try {
      const result = await readGiftSettings(abort.signal)
      if (!live.current || abort.signal.aborted || run !== sequence.current) return
      const previous = current.current
      if (previous.intent && settingsRecorded(result, previous.intent)) { finish(result, previous.intent, true); return }
      setData(result); setReadAt(new Date().toISOString()); setFresh(true)
      if (previous.intent) {
        setDraft(previous.intent.amounts); setStage('review'); setConflict(result.settings.revision !== previous.intent.expectedRevision)
        setError(result.settings.revision === previous.intent.expectedRevision ? 'The saved result is not confirmed yet. Retry this same change, or refresh its recorded result.' : 'The saved amounts have changed. Review your draft against the latest amounts before starting another save.')
      } else if (previous.data && !sameAmounts(previous.draft, previous.data.settings.amounts)) {
        setConflict(previous.data.settings.revision !== result.settings.revision); setStage('edit')
        if (previous.data.settings.revision !== result.settings.revision) setError('Another session changed the saved amounts. Your draft is still here; review it against the latest amounts.')
      } else { setDraft(result.settings.amounts); setConflict(false) }
    } catch (cause) {
      if (!live.current || abort.signal.aborted || run !== sequence.current) return
      if (cause instanceof GiftApiError && [401, 403].includes(cause.status)) clearPrivate()
      setError(cause instanceof Error ? cause.message : 'Gift amounts could not be read. Refresh to try again.')
    } finally { if (live.current && !abort.signal.aborted && run === sequence.current) setBusy(null) }
  }
  useEffect(() => { live.current = true; void load(); heading.current?.focus(); return () => { live.current = false; ++sequence.current; controller.current?.abort() } }, [])
  useEffect(() => { if (!fresh) return; const timer = setTimeout(() => setFresh(false), 60_000); return () => clearTimeout(timer) }, [fresh, readAt])
  useEffect(() => { if (!draft.includes(selected ?? -1)) setSelected(draft.includes(25000) ? 25000 : draft[0] ?? null) }, [draft, selected])
  function add(event: FormEvent) {
    event.preventDefault(); if (disabled) return
    const raw = newAmount.trim(), amount = Math.round(Number(raw) * 100)
    if (!/^\d+(?:\.\d{1,2})?$/.test(raw) || !Number.isSafeInteger(amount) || amount < 500 || amount > 10_000_000) { setFieldError('Enter an amount from $5 to $100,000, with up to two decimal places.'); return }
    if (draft.includes(amount)) { setFieldError('That amount is already offered.'); return }
    if (draft.length >= 32) { setFieldError('Keep up to 32 offered amounts. Remove one before adding another.'); return }
    setDraft(previous => [...previous, amount].sort((left, right) => left - right)); setNewAmount(''); setFieldError(''); setFeedback('')
  }
  function review() {
    if (!data || !fresh || busy || !dirty) return
    if (conflict) { storeSettingsIntent(null); setIntent(null); setConflict(false); setError('') }
    setStage('review'); requestAnimationFrame(() => reviewHeading.current?.focus())
  }
  function useLatest() {
    if (!data || busy) return
    storeSettingsIntent(null); setIntent(null); setDraft(data.settings.amounts); setStage('edit'); setConflict(false); setError(''); setFeedback('The latest offered amounts are shown. Your draft was not saved.')
  }
  async function save() {
    if (saving.current || busy || !data || conflict && !intent || stage !== 'review' || !dirty && !intent || !fresh && !intent) return
    const input = intent || { requestId: crypto.randomUUID(), expectedRevision: data.settings.revision, amounts: [...draft] }
    storeSettingsIntent(input); setIntent(input); saving.current = true; setBusy('save'); setError(''); setFeedback('')
    const abort = new AbortController(), run = ++sequence.current; controller.current?.abort(); controller.current = abort
    try {
      const acknowledgment = await saveGiftSettings(input, abort.signal)
      if (!live.current || abort.signal.aborted || run !== sequence.current) return
      const result = await readGiftSettings(abort.signal)
      if (!live.current || abort.signal.aborted || run !== sequence.current) return
      setData(result); setFresh(true); setReadAt(new Date().toISOString())
      if (result.settings.revision < acknowledgment.settings.revision || result.settings.revision === acknowledgment.settings.revision && !sameAmounts(result.settings.amounts, acknowledgment.settings.amounts)) throw new GiftApiError('The save was acknowledged, but its matching saved revision could not be read back. Refresh or retry this same change.')
      finish(result, input)
    } catch (cause) {
      if (!live.current || abort.signal.aborted || run !== sequence.current) return
      if (cause instanceof GiftApiError && [401, 403].includes(cause.status)) { clearPrivate(); setError(cause.message); return }
      if (cause instanceof GiftApiError && cause.status === 409) {
        try {
          const result = await readGiftSettings(abort.signal)
          if (!live.current || abort.signal.aborted || run !== sequence.current) return
          if (settingsRecorded(result, input)) { finish(result, input, true); return }
          setData(result); setFresh(true); setReadAt(new Date().toISOString()); setConflict(true)
          setError('The change could not be saved against its original version. Your draft is preserved. Review it against the latest amounts, or use the latest offered choices.')
        } catch (readFailure) {
          if (!live.current || abort.signal.aborted) return
          if (readFailure instanceof GiftApiError && [401, 403].includes(readFailure.status)) clearPrivate()
          setFresh(false); setError(readFailure instanceof Error ? readFailure.message : 'The latest gift amounts could not be read. Refresh before continuing.')
        }
      } else setError(cause instanceof Error ? cause.message : 'The save could not be confirmed. Retry this same change.')
    } finally { saving.current = false; if (live.current && !abort.signal.aborted) setBusy(null) }
  }
  const added = data ? draft.filter(amount => !data.settings.amounts.includes(amount)) : [], removed = data ? data.settings.amounts.filter(amount => !draft.includes(amount)) : []
  return <div className="gifts-amounts">
    <button type="button" className="gifts-back" disabled={!!busy} onClick={onBack}><Icon name="undo" size={17}/>Back to purchases</button>
    <header className="gifts-heading"><div><p className="eyebrow">A place at the table</p><h2 ref={heading} tabIndex={-1}>Gift amounts.</h2><p>Choose the amounts guests can purchase.</p></div><button className="button secondary" type="button" disabled={!!busy} onClick={() => void load()}><Icon name="history" size={17}/>{busy === 'read' ? 'Refreshing…' : 'Refresh amounts'}</button></header>
    {error && <p className="gifts-notice gifts-error" role="alert">{error}</p>}{feedback && <p className="gifts-notice" role="status">{feedback}</p>}
    {data && !fresh && <p className="gifts-notice">Earlier settings · refresh before starting a new change.</p>}
    {!data ? <p className="gifts-help" role={busy ? 'status' : undefined}>{busy ? 'Opening saved gift amounts…' : 'Refresh to read the saved gift amounts.'}</p> : <>
      {stage === 'edit' ? <section className="gifts-amount-editor" aria-label="Offered gift amounts"><div className="gifts-amount-section-heading"><h3>Offered amounts</h3><span>{draft.length} choices</span></div><ul className="gifts-amount-chips">{draft.map(amount => <li key={amount}><span>{amountLabel(amount)}</span><button type="button" aria-label={'Remove ' + amountLabel(amount)} title={draft.length === 1 ? 'Keep at least one amount' : 'Remove ' + amountLabel(amount)} disabled={disabled || draft.length === 1} onClick={() => { setDraft(previous => previous.filter(value => value !== amount)); setFieldError(''); setFeedback('') }}><Icon name="close" size={16}/></button></li>)}</ul><form onSubmit={add} noValidate><label htmlFor={uid + '-amount'}>Add an amount · USD</label><div className="gifts-amount-add"><div><span aria-hidden="true">$</span><input ref={addInput} id={uid + '-amount'} type="number" inputMode="decimal" min="5" max="100000" step="0.01" value={newAmount} disabled={disabled} onChange={event => { setNewAmount(event.target.value); setFieldError('') }} placeholder="e.g. 200" aria-invalid={!!fieldError} aria-describedby={fieldError ? uid + '-error' : undefined}/></div><button className="button secondary" type="submit" disabled={disabled}><Icon name="plus" size={17}/>Add amount</button></div>{fieldError && <p className="gifts-amount-error" id={uid + '-error'} role="alert">{fieldError}</p>}</form></section> : <section className="gifts-amount-review" aria-label="Review gift amount changes"><div><h3 ref={reviewHeading} tabIndex={-1}>Review your changes</h3><p className="gifts-help">For new gift purchases. Existing cards keep their value.</p></div><dl className="gifts-amount-diff">{added.length > 0 && <div><dt>Adding</dt><dd>{added.map(amountLabel).join(', ')}</dd></div>}{removed.length > 0 && <div><dt>Removing</dt><dd>{removed.map(amountLabel).join(', ')}</dd></div>}<div><dt>Will offer</dt><dd>{draft.map(amountLabel).join(', ')}</dd></div></dl><div className="gifts-amount-actions">{intent ? <button className="button secondary" type="button" disabled={!!busy} onClick={useLatest}>Use latest amounts</button> : <button className="button secondary" type="button" disabled={!!busy} onClick={() => { setStage('edit'); requestAnimationFrame(() => addInput.current?.focus()) }}><Icon name="undo" size={17}/>Keep editing</button>}{conflict && <button className="button secondary" type="button" disabled={!!busy || !fresh || !dirty} onClick={review}>Review against latest</button>}{(!conflict || intent) && <button className="button" type="button" disabled={!!busy || !dirty && !intent || !fresh && !intent} onClick={() => void save()}><Icon name="check" size={17}/>{busy === 'save' ? 'Saving…' : intent ? conflict ? 'Check original save' : 'Retry same save' : 'Save gift amounts'}</button>}</div></section>}
      <section className="gifts-amount-preview" aria-label="Customer gift amount preview"><div><h3>Choose your gift</h3><span>Customer preview</span></div><div className="gifts-amount-options" aria-label="Select a preview gift amount">{draft.map(amount => <button type="button" key={amount} disabled={!!busy} aria-pressed={selected === amount} onClick={() => setSelected(amount)}>{amountLabel(amount)}</button>)}</div><p aria-live="polite">{selected !== null ? amountLabel(selected) + ' gift card selected' : 'Choose an amount'}</p></section>
      {stage === 'edit' && <div className="gifts-amount-footer"><p role="status">{dirty ? 'Changes not saved.' : `${data.settings.amounts.length} amounts currently offered.`}{readAt && !dirty && <> Read <When value={readAt}/>.</>}</p><button className="button" type="button" disabled={!!busy || !fresh || !dirty || !!intent} onClick={review}>{conflict ? 'Review against latest' : 'Review changes'}<Icon name="chevron" size={16}/></button></div>}
      {conflict && stage === 'edit' && <button className="text-button" type="button" disabled={!!busy} onClick={useLatest}>Use latest amounts</button>}
      <details className="gifts-amount-history"><summary>Recent changes{data.limits.historyTruncated ? ` · latest ${data.limits.historyLimit}` : ''}</summary>{data.history.length ? <ol>{data.history.map(row => <li key={row.requestId}><strong>{row.amounts.map(amountLabel).join(', ')}</strong><span><When value={row.changedAt}/> · {row.actor}</span><span>Previously {row.previousAmounts.map(amountLabel).join(', ')}</span></li>)}</ol> : <p className="gifts-help">No gift amount changes are recorded yet.</p>}</details>
      <p className="gifts-amount-note">Saving updates the choices for new purchases. It does not change an existing card’s value or a checkout already prepared.</p>
    </>}
  </div>
}
