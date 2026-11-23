import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { Icon, Modal, WorkspaceWindow } from './ui'
import { adminFetch } from './store'
import { adminDownload } from './api-client'
import type { CommunicationsResponse, EmailConfiguration, EmailKind, EmailMessageSummary, EmailPreview, EmailStatus } from './communications-types'
import './Communications.css'

const examples: { kind: EmailKind; label: string; description: string }[] = [
  { kind: 'request_received', label: 'Request received', description: 'A warm welcome, with the details of their request.' },
  { kind: 'waitlist_received', label: 'Waitlist received', description: 'A place on the list, with clear expectations.' },
  { kind: 'plan_ready', label: 'Plan ready', description: 'The next step in planning an evening together.' },
  { kind: 'interview_scheduled', label: 'Menu interview', description: 'The agreed time and link for a conversation.' },
  { kind: 'booking_held', label: 'Date held', description: 'A little reassurance while the plans come together.' },
  { kind: 'booking_confirmed', label: 'Booking confirmed', description: 'The evening is in the diary.' },
  { kind: 'booking_changed', label: 'Booking updated', description: 'A clear account of what has changed.' },
  { kind: 'booking_cancelled', label: 'Booking cancelled', description: 'A thoughtful confirmation of a cancellation.' },
  { kind: 'payment_received', label: 'Payment receipt', description: 'A payment acknowledgement and a PDF receipt.' },
  { kind: 'refund_received', label: 'Refund receipt', description: 'The recorded refund, clearly explained.' },
  { kind: 'invitation_ready', label: 'Guest invitation', description: 'An invitation to share with the people at their table.' },
  { kind: 'pre_event', label: 'Before the evening', description: 'The practical details before everyone arrives.' },
  { kind: 'thank_you', label: 'Thank you', description: 'One final note after a memorable meal.' },
]
const emptyConfiguration: EmailConfiguration = { mode: 'preview', ready: false, canSend: false, canTest: false, from: '', replyTo: '', testRecipient: '', missing: [] }
const statusLabels: Record<EmailStatus, string> = { preview: 'Preview', queued: 'Queued', sending: 'Sending', sent: 'Accepted', delivered: 'Delivered', retry: 'Retry scheduled', failed: 'Failed', bounced: 'Bounced', complained: 'Complaint received', needs_review: 'Needs review', suppressed: 'Suppressed', cancelled: 'Cancelled', needs_contact: 'Missing email' }
const statusDescriptions: Record<EmailStatus, string> = {
  preview: 'Saved for review. This message has not been sent.', queued: 'Waiting to be processed. This message has not been accepted by the email provider.',
  sending: 'A delivery attempt is in progress. Refresh for the result.', sent: 'Accepted by the email provider. Delivery has not been confirmed.',
  delivered: 'Delivery to the recipient’s mail server has been confirmed.', retry: 'A previous attempt failed. Another attempt is scheduled.',
  failed: 'The delivery attempt failed. Review the error before trying again.', bounced: 'The recipient’s mail server rejected this message. Check their address before composing a new message.',
  complained: 'A complaint was received. Do not send another copy to this address.', needs_review: 'The previous attempt could not be safely retried. It may have been accepted. Review it before sending a new copy.',
  suppressed: 'Delivery is blocked for this recipient.', cancelled: 'This message was cancelled and will not be sent.', needs_contact: 'Correct the guest email address on the booking, then prepare a fresh preview. This saved message keeps its original recipient.',
}
const kindLabel = (kind: EmailKind) => examples.find(example => example.kind === kind)?.label || kind.replaceAll('_', ' ')
const instant = (value: string | null) => value && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Not recorded'
const updatedEvent = 'chef-communications-updated'
type MessageAction = 'send' | 'retry' | 'resend' | 'cancel'

function inactiveEmailHtml(html: string) {
  const document = new DOMParser().parseFromString(html, 'text/html')
  for (const anchor of document.querySelectorAll('a')) {
    anchor.removeAttribute('href')
    anchor.removeAttribute('target')
    anchor.setAttribute('tabindex', '-1')
  }
  return `<!doctype html>${document.documentElement.outerHTML}`
}

async function api<T>(path: string, body?: object, signal?: AbortSignal): Promise<T> {
  const response = await adminFetch(path, { credentials: 'same-origin', cache: 'no-store', signal, ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Request': '1' }, body: JSON.stringify(body) } : {}) })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : typeof payload?.error?.message === 'string' ? payload.error.message : typeof payload?.message === 'string' ? payload.message : response.status === 401 || response.status === 403 ? 'Your session needs attention. Sign in again, then refresh.' : `The request could not be completed (${response.status}). Please try again.`)
  if (!payload) throw new Error('The server returned an unreadable response. Please refresh and try again.')
  return payload as T
}

function useCommunications(bookingId?: string) {
  const [data, setData] = useState<CommunicationsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const controller = useRef<AbortController | null>(null)
  const lastLoaded = useRef(0)
  const refresh = useCallback(async () => {
    controller.current?.abort()
    const request = new AbortController()
    controller.current = request
    setLoading(true)
    setError('')
    try {
      const result = await api<CommunicationsResponse>(`/api/communications${bookingId ? `?bookingId=${encodeURIComponent(bookingId)}` : ''}`, undefined, request.signal)
      if (request.signal.aborted) return
      setData(result)
      lastLoaded.current = Date.now()
      setUpdatedAt(new Date().toISOString())
    } catch (cause) {
      if (!request.signal.aborted) setError(cause instanceof Error ? cause.message : 'Communications could not be loaded.')
    } finally { if (!request.signal.aborted) setLoading(false) }
  }, [bookingId])
  useEffect(() => {
    setData(null); setUpdatedAt(null); lastLoaded.current = 0
    void refresh()
    const whenVisible = () => { if (!document.hidden && Date.now() - lastLoaded.current > 60_000) void refresh() }
    const whenChanged = () => void refresh()
    const timer = window.setInterval(whenVisible, 60_000)
    window.addEventListener('focus', whenVisible)
    window.addEventListener(updatedEvent, whenChanged)
    document.addEventListener('visibilitychange', whenVisible)
    return () => { controller.current?.abort(); window.clearInterval(timer); window.removeEventListener('focus', whenVisible); window.removeEventListener(updatedEvent, whenChanged); document.removeEventListener('visibilitychange', whenVisible) }
  }, [refresh])
  const record = useCallback((message: EmailMessageSummary) => {
    setData(current => current ? { ...current, messages: [message, ...current.messages.filter(item => item.id !== message.id)] } : current)
    window.dispatchEvent(new Event(updatedEvent))
  }, [])
  return { data, configuration: data?.configuration || emptyConfiguration, loading, error, updatedAt, refresh, record }
}

function Status({ status }: { status: EmailStatus }) { return <span className={`communications-status status-${status}`}>{statusLabels[status] || status}</span> }

function ConfigurationNotice({ configuration }: { configuration: EmailConfiguration }) {
  const missing = configuration.missing.filter(name => /^[A-Z][A-Z0-9_]*$/.test(name))
  return <aside className={`communications-configuration ${configuration.canSend ? 'is-ready' : ''}`} aria-label="Email connection">
    <span className="communications-connection-icon"><Icon name={configuration.canSend ? 'check' : 'mail'} size={22}/></span>
    <div><strong>{configuration.canSend ? 'Customer email is ready' : configuration.mode === 'test' ? 'Test delivery only' : 'Preview mode'}</strong>
      <p>{configuration.canSend ? 'Review each message before sending. Accepted messages are tracked separately from confirmed deliveries.' : configuration.mode === 'test' ? 'Customer delivery is disabled. Only fictional design previews can be sent to the configured test inbox.' : 'Review every email and receipt here. Customer delivery stays disabled until the email connection is ready.'}</p>
      {missing.length > 0 && <p className="communications-missing">Connection settings needed: {missing.map((name, index) => <span key={name}>{index > 0 && ', '}<code>{name}</code></span>)}</p>}
    </div><span className="communications-mode">{configuration.mode === 'live' ? configuration.canSend ? 'Live' : 'Not ready' : configuration.mode === 'test' ? 'Test' : 'Preview'}</span>
  </aside>
}

function PreviewContent({ message, example, configuration, onReady }: { message?: EmailMessageSummary; example?: EmailKind; configuration: EmailConfiguration; onReady?: (ready: boolean) => void }) {
  const [preview, setPreview] = useState<EmailPreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [format, setFormat] = useState<'html' | 'text'>('html')
  const [viewport, setViewport] = useState<600 | 360>(600)
  const [reload, setReload] = useState(0)
  const [receiptPending, setReceiptPending] = useState(false)
  const [receiptError, setReceiptError] = useState('')
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady
  const previewKey = message?.id || example
  const html = useMemo(() => preview ? inactiveEmailHtml(preview.html) : '', [preview?.html])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError(''); setReceiptError(''); setPreview(null); onReadyRef.current?.(false)
    void api<EmailPreview>(`/api/communications/preview?${message ? `id=${encodeURIComponent(message.id)}` : `example=${encodeURIComponent(example || 'request_received')}`}`, undefined, controller.signal)
      .then(result => { if (!controller.signal.aborted) { setPreview(result); onReadyRef.current?.(true) } })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'The preview could not be loaded.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [previewKey, reload])
  const isSample = !!example || !!preview?.sample
  const receiptExample = example || (preview?.sample ? message?.kind : undefined)
  const receiptUrl = preview && (receiptExample === 'payment_received' || receiptExample === 'refund_received' ? `/api/communications/receipt.pdf?example=${receiptExample}` : !isSample && preview.receiptId ? `/api/communications/receipt.pdf?id=${encodeURIComponent(preview.receiptId)}` : null)
  async function downloadReceipt() {
    if (!receiptUrl || receiptPending) return
    setReceiptPending(true); setReceiptError('')
    try { await adminDownload(receiptUrl, `${isSample ? 'sample-' : ''}${preview?.receiptId || receiptExample || 'payment'}-receipt.pdf`) }
    catch (cause) { setReceiptError(cause instanceof Error ? cause.message : 'The receipt could not be downloaded. Please try again.') }
    finally { setReceiptPending(false) }
  }
  return <div className="communications-preview">
    {isSample && <div className="communications-fictional"><Icon name="info" size={16}/><span>Design preview · Fictional guest and booking details</span></div>}
    <dl className="communications-envelope"><div><dt>Subject</dt><dd>{preview?.subject || message?.subject || (loading ? 'Loading subject…' : kindLabel(example || 'request_received'))}</dd></div><div><dt>To</dt><dd>{example ? 'Fictional guest · not a customer' : message?.recipientEmail ? `${message.recipientName ? `${message.recipientName} · ` : ''}${message.recipientEmail}` : 'No email address on this booking'}</dd></div><div><dt>From</dt><dd>{configuration.from || 'Sender not configured'}</dd></div>{configuration.replyTo && <div><dt>Reply to</dt><dd>{configuration.replyTo}</dd></div>}</dl>
    <div className="communications-preview-tools"><div className="communications-segmented" aria-label="Preview format"><button type="button" aria-pressed={format === 'html'} onClick={() => setFormat('html')}>Email</button><button type="button" aria-pressed={format === 'text'} onClick={() => setFormat('text')}>Plain text</button></div><div className="communications-segmented communications-viewport" aria-label="Email viewport"><button type="button" disabled={format === 'text'} aria-pressed={viewport === 600} onClick={() => setViewport(600)}>Desktop · 600</button><button type="button" disabled={format === 'text'} aria-pressed={viewport === 360} onClick={() => setViewport(360)}>Mobile · 360</button></div>{receiptUrl && <button type="button" className="button secondary small communications-receipt" disabled={receiptPending} onClick={() => void downloadReceipt()}><Icon name="card" size={16}/>{receiptPending ? 'Downloading…' : 'Receipt PDF'}</button>}</div>
    {receiptError && <p className="communications-error" role="alert">{receiptError}</p>}
    {loading && <div className="communications-preview-placeholder" role="status"><Icon name="mail" size={28}/><p>Preparing the email preview…</p></div>}
    {error && <div className="communications-preview-placeholder"><p className="communications-error" role="alert">{error}</p><button className="button secondary" onClick={() => setReload(value => value + 1)}>Try preview again</button></div>}
    {preview && (format === 'text' ? <pre className="communications-plain-text" tabIndex={0} aria-label="Plain text email">{preview.text}</pre> : <div className="communications-preview-stage"><iframe key={`${preview.id}-${viewport}`} className="communications-email-frame" title={`${example ? 'Fictional design preview' : 'Email preview'}: ${preview.subject}`} srcDoc={html} tabIndex={0} sandbox="" referrerPolicy="no-referrer" style={{ width: viewport }} /></div>)}
    <p className="communications-preview-caption">{format === 'html' ? 'A secure preview of the email. Links are inactive here.' : 'The plain text version accompanies the designed email.'}</p>
  </div>
}

function MessageDialog({ message, configuration, onClose, onChanged }: { message: EmailMessageSummary; configuration: EmailConfiguration; onClose: () => void; onChanged: (message: EmailMessageSummary) => void }) {
  const [current, setCurrent] = useState(message)
  const [ready, setReady] = useState(false)
  const [pending, setPending] = useState<MessageAction | null>(null)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [confirmResend, setConfirmResend] = useState(false)
  const requestIds = useRef<Record<string, string>>({})
  useEffect(() => { setCurrent(message) }, [message])
  async function act(action: MessageAction) {
    if (pending) return
    setPending(action); setError(''); setFeedback('')
    try {
      const key = `${current.id}:${action}`
      const requestId = requestIds.current[key] ||= crypto.randomUUID()
      const result = await api<{ message: EmailMessageSummary }>('/api/communications/action', { id: current.id, action, requestId })
      delete requestIds.current[key]
      setCurrent(result.message); onChanged(result.message); setConfirmResend(false)
      setFeedback(`${action === 'resend' ? 'New copy' : 'Message'}: ${statusLabels[result.message.status]}. ${statusDescriptions[result.message.status]}`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'This action could not be completed.') }
    finally { setPending(null) }
  }
  const canSend = configuration.canSend && ready && !!current.recipientEmail
  const accepted = current.status === 'sent' || current.status === 'delivered' || current.status === 'needs_review'
  return <Modal wide title={kindLabel(current.kind)} subtitle={`${current.bookingId} · Saved ${instant(current.createdAt)}`} onClose={onClose}>
    <div className="communications-message-body"><div className="communications-message-state"><Status status={current.status}/><p>{statusDescriptions[current.status]}</p></div>
      {current.lastError && <p className="communications-error communications-provider-error"><strong>Delivery detail:</strong> {current.lastError}</p>}
      <PreviewContent message={current} configuration={configuration} onReady={setReady}/>
      <dl className="communications-delivery-details"><div><dt>Last updated</dt><dd>{instant(current.updatedAt)}</dd></div><div><dt>Attempts</dt><dd>{current.attempts}</dd></div>{current.sentAt && <div><dt>Accepted</dt><dd>{instant(current.sentAt)}</dd></div>}{current.deliveredAt && <div><dt>Delivered</dt><dd>{instant(current.deliveredAt)}</dd></div>}{current.parentId && <div><dt>Copy of</dt><dd>{current.parentId}</dd></div>}</dl>
      {error && <p className="communications-error" role="alert">{error}</p>}{feedback && <p className="communications-feedback" role="status">{feedback}</p>}
      {!configuration.canSend && <p className="communications-send-help">Customer delivery is disabled in {configuration.mode} mode{!configuration.ready ? ' until the connection is ready' : ''}.</p>}
    </div>
    <div className="modal-actions communications-message-actions"><button className="button secondary" onClick={onClose}>Close</button>{['preview', 'queued', 'retry', 'needs_review'].includes(current.status) && <button className="button secondary" disabled={!!pending} onClick={() => void act('cancel')}>{pending === 'cancel' ? 'Cancelling…' : 'Cancel message'}</button>}{current.status === 'preview' && <button className="button" disabled={!!pending || !canSend} onClick={() => void act('send')}><Icon name="mail" size={17}/>{pending === 'send' ? 'Sending…' : 'Send to guest'}</button>}{['failed', 'retry'].includes(current.status) && <button className="button" disabled={!!pending || !canSend} onClick={() => void act('retry')}>{pending === 'retry' ? 'Retrying…' : 'Retry delivery'}</button>}{accepted && <button className="button" disabled={!!pending || !canSend} onClick={() => setConfirmResend(true)}><Icon name="mail" size={17}/>Send a new copy</button>}</div>
    {confirmResend && <Modal title="Send a new copy?" subtitle={current.status === 'needs_review' ? 'The previous attempt may already have been accepted.' : 'The previous message was already accepted.'} onClose={() => setConfirmResend(false)}><div className="modal-body"><p>This sends another email to <strong>{current.recipientEmail}</strong>. They may already have the original. The new copy will have its own delivery record.</p>{error && <p className="communications-error" role="alert">{error}</p>}</div><div className="modal-actions communications-dialog-actions"><button className="button secondary" disabled={!!pending} onClick={() => setConfirmResend(false)}>Keep original only</button><button className="button" disabled={!!pending || !canSend} onClick={() => void act('resend')}>{pending === 'resend' ? 'Sending new copy…' : 'Send a new copy'}</button></div></Modal>}
  </Modal>
}

function ComposeDialog({ data, bookingId, onClose, onCreated }: { data: CommunicationsResponse; bookingId?: string; onClose: () => void; onCreated: (message: EmailMessageSummary) => void }) {
  const [selectedBooking, setSelectedBooking] = useState(bookingId || '')
  const [kind, setKind] = useState<EmailKind>(() => data.kinds.some(item => item.kind === 'thank_you') ? 'thank_you' : data.kinds[0]?.kind || 'thank_you')
  const [note, setNote] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const requestId = useRef(crypto.randomUUID())
  const recipient = data.bookings.find(booking => booking.id === selectedBooking)
  const kinds = data.kinds.length ? data.kinds : examples
  async function compose(event: FormEvent) {
    event.preventDefault()
    if (pending || !selectedBooking) return
    setPending(true); setError('')
    try { const result = await api<{ message: EmailMessageSummary }>('/api/communications/compose', { bookingId: selectedBooking, kind, note: note.trim(), requestId: requestId.current }); onCreated(result.message) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The preview could not be prepared.') }
    finally { setPending(false) }
  }
  return <Modal title="Prepare a guest email" subtitle="Review the full email before deciding to send." onClose={onClose}><form onSubmit={event => void compose(event)}><div className="modal-body communications-compose">
    <label className="field">Booking<select required value={selectedBooking} onChange={event => { setSelectedBooking(event.target.value); setError(''); requestId.current = crypto.randomUUID() }} disabled={pending || !!bookingId}><option value="">Choose a booking</option>{data.bookings.map(booking => <option key={booking.id} value={booking.id}>{booking.guest} · {booking.id}</option>)}</select></label>
    {recipient && <p className={`communications-recipient ${recipient.email ? '' : 'communications-error'}`}><Icon name="mail" size={16}/>{recipient.email || 'This guest needs an email address before delivery.'}</p>}
    <label className="field">Message<select value={kind} onChange={event => { setKind(event.target.value as EmailKind); setError(''); requestId.current = crypto.randomUUID() }} disabled={pending}>{kinds.map(item => <option key={item.kind} value={item.kind}>{item.label}</option>)}</select><small>Messages use the saved booking details. A message can only be prepared when those details support it.</small></label>
    <label className="field">A personal note <span className="communications-optional">Optional</span><textarea rows={4} maxLength={2000} value={note} disabled={pending} onChange={event => { setNote(event.target.value); requestId.current = crypto.randomUUID() }} placeholder="A few words from Sergio…"/><small>This note will be visible to the guest. {note.length.toLocaleString()} / 2,000 characters</small></label>
    {error && <p className="communications-error" role="alert">{error}</p>}
    <p className="communications-compose-note"><Icon name="shield" size={17}/>Preparing a preview does not send an email.</p>
  </div><div className="modal-actions communications-dialog-actions"><button className="button secondary" type="button" disabled={pending} onClick={onClose}>Cancel</button><button className="button" disabled={pending || !selectedBooking} type="submit"><Icon name="mail" size={17}/>{pending ? 'Preparing…' : 'Prepare preview'}</button></div></form></Modal>
}

export default function Communications({ bookingId }: { bookingId?: string }) {
  const { data, configuration, loading, error, updatedAt, refresh, record } = useCommunications(bookingId)
  const [tab, setTab] = useState<'history' | 'examples'>('history')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [bookingFilter, setBookingFilter] = useState(bookingId || 'all')
  const [example, setExample] = useState<EmailKind>('request_received')
  const [compose, setCompose] = useState(false)
  const [selected, setSelected] = useState<EmailMessageSummary | null>(null)
  const [testPending, setTestPending] = useState(false)
  const [sampleReady, setSampleReady] = useState(false)
  const testRequestIds = useRef<Partial<Record<EmailKind, string>>>({})
  const [testError, setTestError] = useState('')
  const [testFeedback, setTestFeedback] = useState('')
  const [dispatchDialog, setDispatchDialog] = useState(false)
  const [dispatchPending, setDispatchPending] = useState(false)
  const [dispatchError, setDispatchError] = useState('')
  const [dispatchFeedback, setDispatchFeedback] = useState('')
  const tabsId = useId()
  const messages = useMemo(() => [...(data?.messages || [])].sort((left, right) => right.createdAt.localeCompare(left.createdAt)), [data?.messages])
  const visible = messages.filter(message => (status === 'all' || message.status === status || status === 'attention' && ['failed', 'bounced', 'complained', 'needs_review', 'needs_contact', 'suppressed'].includes(message.status)) && (bookingFilter === 'all' || message.bookingId === bookingFilter) && (!query.trim() || [message.subject, message.recipientName, message.recipientEmail, message.bookingId, kindLabel(message.kind)].some(value => value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))))
  const attention = messages.filter(message => ['failed', 'bounced', 'complained', 'needs_review', 'needs_contact', 'suppressed'].includes(message.status)).length
  const queued = messages.filter(message => message.status === 'queued').length
  const sample = examples.find(item => item.kind === example)!
  async function sendTest() {
    if (!configuration.canTest || !sampleReady || testPending) return
    setTestPending(true); setTestError(''); setTestFeedback('')
    try {
      const requestId = testRequestIds.current[example] ||= crypto.randomUUID()
      const result = await api<{ message: EmailMessageSummary }>('/api/communications/test', { example, requestId })
      delete testRequestIds.current[example]
      if (result.message) { record(result.message); setTestFeedback(`${kindLabel(example)} test: ${statusLabels[result.message.status]}. ${statusDescriptions[result.message.status]}`) }
      else { setTestFeedback('The test request completed. Refresh the message history to review its delivery record.'); void refresh() }
    } catch (cause) { setTestError(cause instanceof Error ? cause.message : 'The test could not be sent.') }
    finally { setTestPending(false) }
  }
  async function dispatch() {
    setDispatchPending(true); setDispatchError(''); setDispatchFeedback('')
    try {
      const result = await api<Record<string, number>>('/api/communications/dispatch', {})
      const counts = Object.entries(result).filter(([, value]) => typeof value === 'number').map(([name, value]) => `${name.replaceAll('_', ' ')}: ${value}`).join(' · ')
      setDispatchFeedback(counts ? `Queue result — ${counts}.` : 'Queue processing completed. Review the refreshed delivery records.')
      setDispatchDialog(false); window.dispatchEvent(new Event(updatedEvent))
    } catch (cause) { setDispatchError(cause instanceof Error ? cause.message : 'The queue could not be processed.') }
    finally { setDispatchPending(false) }
  }
  return <section className="communications" aria-label={bookingId ? `Communications for ${bookingId}` : 'Customer communications'}>
    <div className="communications-intro"><div><p className="eyebrow">A NOTE FROM YOUR KITCHEN</p><h2>Good hospitality, in every message.</h2><p>Thoughtful emails for each step around the table.</p></div><div className="communications-heading-actions"><button className="button secondary" disabled={loading} onClick={() => void refresh()}><Icon name="history" size={17}/>{loading ? 'Refreshing…' : 'Refresh'}</button><button className="button" disabled={!data || !data.bookings.length} onClick={() => setCompose(true)}><Icon name="plus" size={18}/>Prepare an email</button></div></div>
    <ConfigurationNotice configuration={configuration}/>
    {error && <div className="communications-load-error" role="alert"><div><strong>{data ? 'The latest records could not be loaded.' : 'Communications could not be loaded.'}</strong><p>{error}{data && ' The records below may be out of date.'}</p></div><button className="button secondary" disabled={loading} onClick={() => void refresh()}>Try again</button></div>}
    <div className="communications-tabs" role="tablist" aria-label="Communications view"><button id={`${tabsId}-history-tab`} role="tab" aria-selected={tab === 'history'} aria-controls={`${tabsId}-history`} tabIndex={tab === 'history' ? 0 : -1} onClick={() => setTab('history')} onKeyDown={event => { if (['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 'history' : 'examples'; setTab(next); document.getElementById(`${tabsId}-${next}-tab`)?.focus() } }}>Message history <span>{messages.length}</span></button><button id={`${tabsId}-examples-tab`} role="tab" aria-selected={tab === 'examples'} aria-controls={`${tabsId}-examples`} tabIndex={tab === 'examples' ? 0 : -1} onClick={() => setTab('examples')} onKeyDown={event => { if (['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'End' ? 'examples' : 'history'; setTab(next); document.getElementById(`${tabsId}-${next}-tab`)?.focus() } }}>Design previews <Icon name="mail" size={17}/></button></div>
    {tab === 'history' && <div id={`${tabsId}-history`} role="tabpanel" aria-labelledby={`${tabsId}-history-tab`}>
      <div className="communications-history-summary"><p><strong>{messages.length}</strong> {messages.length === 1 ? 'message' : 'messages'}{bookingId ? ` for ${bookingId}` : ' in your outbox'}{attention > 0 && <button onClick={() => setStatus('attention')}>{attention} {attention === 1 ? 'needs' : 'need'} attention</button>}</p><span>{loading ? <span role="status">Loading records…</span> : updatedAt ? `Refreshed ${new Date(updatedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : 'Not loaded'}</span></div>
      <div className="communications-filters"><label className="communications-search"><Icon name="search" size={19}/><input aria-label="Search messages" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search guests, bookings or subjects…"/></label>{!bookingId && <label className="communications-filter"><span>Booking</span><select value={bookingFilter} onChange={event => setBookingFilter(event.target.value)}><option value="all">All bookings</option>{data?.bookings.map(booking => <option key={booking.id} value={booking.id}>{booking.guest} · {booking.id}</option>)}</select></label>}<label className="communications-filter"><span>Status</span><select value={status} onChange={event => setStatus(event.target.value)}><option value="all">All statuses</option><option value="attention">Needs attention</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
      {dispatchFeedback && <p className="communications-feedback" role="status">{dispatchFeedback}</p>}
      {queued > 0 && <div className="communications-queue"><p><Icon name="clock" size={18}/>{queued} {queued === 1 ? 'message is' : 'messages are'} queued for delivery.</p><button className="button secondary small" disabled={!configuration.canSend || loading} onClick={() => setDispatchDialog(true)}>Process queued messages</button></div>}
      {loading && !data ? <div className="communications-empty" role="status"><Icon name="mail" size={30}/><h3>Opening your outbox…</h3><p>Loading guest messages and delivery records.</p></div> : error && !data ? <div className="communications-empty"><Icon name="mail" size={30}/><h3>Your outbox is unavailable.</h3><p>Refresh to load your records. You can still explore the email designs.</p><button className="button secondary" onClick={() => setTab('examples')}>Explore email designs</button></div> : visible.length ? <div className="communications-message-list">{visible.map(message => <button className="communications-message-row" key={message.id} onClick={() => setSelected(message)}><span className="communications-row-icon"><Icon name={message.receiptId ? 'card' : 'mail'} size={21}/></span><span className="communications-row-main"><strong>{message.subject || kindLabel(message.kind)}</strong><span>{message.recipientName || 'Guest'} · {message.recipientEmail || 'Email missing'}</span><small>{message.bookingId} · {kindLabel(message.kind)}</small></span><span className="communications-row-meta"><Status status={message.status}/><time dateTime={message.updatedAt}>{instant(message.updatedAt)}</time>{message.lastError && <span className="communications-row-error">Delivery needs attention</span>}</span><Icon name="chevron" size={18}/></button>)}</div> : <div className="communications-empty"><span className="communications-empty-icon"><Icon name={messages.length ? 'search' : 'mail'} size={30}/></span><h3>{messages.length ? 'No matching messages' : 'Your guest correspondence starts here.'}</h3><p>{messages.length ? 'Try a different guest, booking or status.' : 'Booking emails and receipts appear here as you work. Explore the designs with a fictional booking while your outbox is quiet.'}</p>{messages.length ? <button className="button secondary" onClick={() => { setQuery(''); setStatus('all'); setBookingFilter(bookingId || 'all') }}>Clear filters</button> : <button className="button secondary" onClick={() => setTab('examples')}>Explore email designs<Icon name="chevron" size={16}/></button>}</div>}
      <p className="communications-history-note"><Icon name="info" size={16}/>“Accepted” means the provider accepted the email. “Delivered” requires a delivery confirmation. Records refresh every minute while this window is visible.</p>
    </div>}
    {tab === 'examples' && <div id={`${tabsId}-examples`} role="tabpanel" aria-labelledby={`${tabsId}-examples-tab`} className="communications-design-layout"><aside className="communications-template-sidebar"><div className="communications-template-heading"><p className="eyebrow">THE CORRESPONDENCE</p><h3>A considered collection.</h3><p>From the first hello to a final thank you.</p></div><label className="field communications-mobile-template">Choose a design<select value={example} onChange={event => { setExample(event.target.value as EmailKind); setSampleReady(false); setTestError(''); setTestFeedback('') }}>{examples.map(item => <option key={item.kind} value={item.kind}>{item.label}</option>)}</select></label><div className="communications-template-list" aria-label="Email designs">{examples.map(item => <button key={item.kind} aria-pressed={example === item.kind} onClick={() => { if (example !== item.kind) setSampleReady(false); setExample(item.kind); setTestError(''); setTestFeedback('') }}><span>{item.label}</span><Icon name="chevron" size={15}/></button>)}</div><div className="communications-sample-note"><Icon name="shield" size={18}/><p>Every design uses fictional details. Your guest records are never used for test delivery.</p></div></aside><div className="communications-design-preview"><div className="communications-design-heading"><div><h3>{sample.label}</h3><p>{sample.description}</p></div><span className="communications-design-label">Design preview</span></div><PreviewContent example={example} configuration={configuration} onReady={setSampleReady}/><div className="communications-test"><div><strong>Try it in your inbox</strong><p>{configuration.canTest ? `Fictional details only. Test recipient: ${configuration.testRecipient}` : 'Test delivery becomes available when a test inbox and email connection are configured.'}</p></div><button className="button secondary" disabled={!configuration.canTest || !sampleReady || testPending} onClick={() => void sendTest()}><Icon name="mail" size={17}/>{testPending ? 'Sending test…' : 'Send a test email'}</button></div>{testError && <p className="communications-error" role="alert">{testError}</p>}{testFeedback && <p className="communications-feedback" role="status">{testFeedback}</p>}</div></div>}
    {compose && data && <ComposeDialog data={data} bookingId={bookingId} onClose={() => setCompose(false)} onCreated={message => { record(message); setCompose(false); setSelected(message) }}/>}
    {selected && <MessageDialog message={messages.find(message => message.id === selected.id) || selected} configuration={configuration} onClose={() => setSelected(null)} onChanged={message => { record(message); setSelected(message) }}/>}
    {dispatchDialog && <Modal title="Process the email queue?" onClose={() => setDispatchDialog(false)}><div className="modal-body"><p>This attempts delivery for the queued messages in your workspace. Review the recipients and previews in the message history first.</p>{dispatchError && <p className="communications-error" role="alert">{dispatchError}</p>}</div><div className="modal-actions communications-dialog-actions"><button className="button secondary" disabled={dispatchPending} onClick={() => setDispatchDialog(false)}>Back to history</button><button className="button" disabled={dispatchPending || !configuration.canSend} onClick={() => void dispatch()}>{dispatchPending ? 'Processing…' : 'Process queued messages'}</button></div></Modal>}
  </section>
}

export function BookingCommunications({ bookingId }: { bookingId: string }) {
  const { data, configuration, loading, error, refresh, record } = useCommunications(bookingId)
  const [expanded, setExpanded] = useState(false)
  const [selected, setSelected] = useState<EmailMessageSummary | null>(null)
  const messages = [...(data?.messages || [])].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  return <section className="booking-detail-section booking-communications"><div className="booking-communications-heading"><h3>Guest emails</h3><Icon name="mail" size={19}/></div>{loading && !data ? <p className="booking-communications-note" role="status">Loading messages…</p> : error ? <><p className="communications-error" role="alert">{error}</p><button className="text-button" disabled={loading} onClick={() => void refresh()}>Try again</button></> : messages.length ? <ul>{messages.slice(0, 3).map(message => <li key={message.id}><button onClick={() => setSelected(message)}><strong>{kindLabel(message.kind)}</strong><Status status={message.status}/><time dateTime={message.updatedAt}>{instant(message.updatedAt)}</time></button></li>)}</ul> : <p className="booking-communications-note">No email records for this booking yet.</p>}<button className="button secondary small" onClick={() => setExpanded(true)}><Icon name="mail" size={16}/>{messages.length ? 'View all guest emails' : 'Open guest emails'}</button>{data && !configuration.canSend && <p className="booking-communications-note">Preview available · customer delivery disabled</p>}{selected && <MessageDialog message={messages.find(message => message.id === selected.id) || selected} configuration={configuration} onClose={() => setSelected(null)} onChanged={message => { record(message); setSelected(message) }}/>} {expanded && <WorkspaceWindow title="Guest communications" description={`Booking ${bookingId}`} onClose={() => setExpanded(false)}><Communications bookingId={bookingId}/></WorkspaceWindow>}</section>
}
