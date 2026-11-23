import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { adminFetch } from './store'
import { Icon, Modal } from './ui'
import type { NewsletterActionResponse, NewsletterDraft, NewsletterResponse, NewsletterSettings } from './newsletter-types'
import './Newsletter.css'

type View = 'letter' | 'subscribers' | 'history'
type Action = 'draft' | 'settings' | 'test' | 'send'
type Attempt = { kind: Action; body: Record<string, unknown> }
const blankDraft: NewsletterDraft = { subject: '', previewText: '', body: '' }
const blankSettings: NewsletterSettings = { senderName: '', replyTo: '', postalAddress: '' }
const outline = 'Hello,\n\n[A personal opening in your own words.]\n\n[One useful seasonal cooking idea for the reader to try.]\n\n[Optional: an upcoming opportunity and one helpful link. Remove this paragraph if there is nothing to share.]'
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
const letterReady = (draft: NewsletterDraft) => !!draft.subject.trim() && !!draft.body.trim() && !/\[(A personal opening|One useful seasonal|Optional: an upcoming)/.test(draft.body)
const date = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Not recorded'
class NewsletterError extends Error { constructor(message: string, public status: number) { super(message) } }
async function request(path = '', body?: Record<string, unknown>, signal?: AbortSignal): Promise<NewsletterActionResponse> {
  const response = await adminFetch('/api/newsletters' + path, { cache: 'no-store', signal, ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Request': '1' }, body: JSON.stringify(body) } : {}) })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new NewsletterError(typeof payload?.error === 'string' ? payload.error : payload?.error?.message || `The request could not be completed (${response.status}).`, response.status)
  if (!payload || !Number.isInteger(payload.revision) || !payload.draft || !payload.settings || !payload.readiness) throw new Error('The server response could not be confirmed. Keep this window open and retry the same request.')
  return payload
}
function inactiveHtml(html: string) {
  const document = new DOMParser().parseFromString(html, 'text/html')
  for (const anchor of document.querySelectorAll('a')) { anchor.removeAttribute('href'); anchor.removeAttribute('target'); anchor.setAttribute('tabindex', '-1') }
  return '<!doctype html>' + document.documentElement.outerHTML
}

function LetterPreview({ data, dirty, expanded = false }: { data: NewsletterResponse; dirty: boolean; expanded?: boolean }) {
  const [format, setFormat] = useState<'html' | 'text'>('html')
  const [viewport, setViewport] = useState<600 | 360>(600)
  const [stageWidth, setStageWidth] = useState(500)
  const stage = useRef<HTMLDivElement>(null)
  const html = useMemo(() => inactiveHtml(data.preview.html), [data.preview.html])
  useEffect(() => {
    if (!stage.current) return
    const observer = new ResizeObserver(entries => setStageWidth(entries[0].contentRect.width))
    observer.observe(stage.current)
    return () => observer.disconnect()
  }, [])
  const scale = Math.min(1, Math.max(1, stageWidth - 32) / viewport)
  return <section className={'newsletter-preview' + (expanded ? ' expanded' : '')} aria-label="Saved letter preview">
    <div className="newsletter-preview-heading"><span className="eyebrow">THE LETTERBOX</span><span>{dirty ? 'Saved version · edits not shown' : 'Your saved letter'}</span></div>
    <div className="newsletter-preview-controls"><div className="newsletter-segmented" aria-label="Preview format"><button type="button" aria-pressed={format === 'html'} onClick={() => setFormat('html')}>Email</button><button type="button" aria-pressed={format === 'text'} onClick={() => setFormat('text')}>Plain text</button></div><div className="newsletter-segmented" aria-label="Preview width"><button type="button" disabled={format === 'text'} aria-pressed={viewport === 600} onClick={() => setViewport(600)}>Desktop</button><button type="button" disabled={format === 'text'} aria-pressed={viewport === 360} onClick={() => setViewport(360)}>Mobile</button></div></div>
    {dirty && <p className="newsletter-preview-saved"><Icon name="edit" size={15}/>Save your edits to update this preview.</p>}
    <div ref={stage} className="newsletter-preview-stage">{format === 'text' ? <pre tabIndex={0} className="newsletter-plain-text">{data.preview.text || 'Your saved letter will appear here.'}</pre> : <div className="newsletter-preview-paper" style={{ width: viewport * scale, height: 780 * scale }}><iframe title={`Saved newsletter: ${data.preview.subject || 'Untitled letter'}`} srcDoc={html} sandbox="" tabIndex={0} referrerPolicy="no-referrer" style={{ width: viewport, height: 780, transform: `scale(${scale})` }}/></div>}</div>
    <p className="newsletter-preview-footnote">Private preview · links are inactive · no email is sent</p>
  </section>
}

const campaignLabels = { preparing: 'Preparing', sending: 'Submitting', sent: 'Provider accepted', test_sent: 'Test accepted', needs_review: 'Needs review', failed: 'Failed' }

export default function Newsletter() {
  const [data, setData] = useState<NewsletterResponse | null>(null)
  const [draft, setDraft] = useState<NewsletterDraft>(blankDraft)
  const [settings, setSettings] = useState<NewsletterSettings>(blankSettings)
  const [view, setView] = useState<View>('letter')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [pending, setPending] = useState<Action | null>(null)
  const [ambiguous, setAmbiguous] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [review, setReview] = useState<NewsletterResponse | null>(null)
  const [reviewLoading, setReviewLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [subscriberStatus, setSubscriberStatus] = useState('all')
  const [outlineUsed, setOutlineUsed] = useState(false)
  const server = useRef<NewsletterResponse | null>(null)
  const localDraft = useRef(draft), localSettings = useRef(settings)
  const attempt = useRef<Attempt | null>(null)
  const busy = useRef(false)
  const tabs = useId()
  localDraft.current = draft; localSettings.current = settings
  const accept = useCallback((next: NewsletterResponse, saved?: Action) => {
    const previous = server.current
    const keepDraft = previous && !equal(localDraft.current, previous.draft) && saved !== 'draft'
    const keepSettings = previous && !equal(localSettings.current, previous.settings) && saved !== 'settings'
    if (!keepDraft) { localDraft.current = { ...next.draft }; setDraft(localDraft.current) }
    if (!keepSettings) { localSettings.current = { ...next.settings }; setSettings(localSettings.current) }
    if (!saved && previous && previous.revision !== next.revision && (keepDraft || keepSettings)) setConflict(true)
    server.current = next; setData(next)
  }, [])
  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setLoadError('')
    try { const next = await request('', undefined, signal); if (!signal?.aborted) accept(next); return next }
    catch (cause) { if (!signal?.aborted) setLoadError(cause instanceof Error ? cause.message : 'The newsletter could not be loaded.'); return null }
    finally { if (!signal?.aborted) setLoading(false) }
  }, [accept])
  useEffect(() => { const controller = new AbortController(); void refresh(controller.signal); return () => controller.abort() }, [refresh])
  const draftDirty = !!data && !equal(draft, data.draft)
  const settingsDirty = !!data && !equal(settings, data.settings)
  const locked = !!pending || ambiguous
  const deliveryReady = !!data && !draftDirty && !settingsDirty && !conflict && !locked && letterReady(data.draft)

  async function act(kind: Action, extra: Record<string, unknown> = {}, revision?: number) {
    if (busy.current || !server.current || ambiguous && attempt.current?.kind !== kind) return
    const action = ambiguous && attempt.current ? attempt.current : { kind, body: { expectedRevision: revision ?? server.current.revision, requestId: crypto.randomUUID(), ...extra } }
    attempt.current = action; busy.current = true; setPending(kind); setError(''); setFeedback('')
    try {
      const next = await request('/' + kind, action.body)
      accept(next, kind); attempt.current = null; setAmbiguous(false); setConflict(false)
      setFeedback(next.action?.message || ({ draft: 'Your letter is saved. The preview now shows this version.', settings: 'Sender and footer saved.', test: 'The provider accepted the test. Inbox delivery is separate.', send: 'The provider accepted the newsletter request. This does not confirm delivery.' })[kind])
      if (kind === 'settings') setSettingsOpen(false)
      if (kind === 'send') setReview(null)
    } catch (cause) {
      const status = cause instanceof Error && 'status' in cause && typeof cause.status === 'number' ? cause.status : 0
      if (!status || status >= 500) {
        setAmbiguous(true); setReview(null); setSettingsOpen(false)
        setError('The outcome is not confirmed. Your edits are retained. Retry this same request before starting another action; its request ID is kept to prevent duplicate submissions.')
      } else {
        attempt.current = null; setAmbiguous(false)
        setError(cause instanceof Error ? cause.message : 'The action could not be completed.')
        if (status === 409) { setReview(null); await refresh(); setConflict(true) }
      }
    } finally { busy.current = false; setPending(null) }
  }
  async function prepareSend() {
    if (!deliveryReady || !data?.readiness.canSend) return
    setReviewLoading(true); setError(''); setFeedback('')
    try {
      const next = await request()
      const previous = server.current
      accept(next)
      if (previous?.revision !== next.revision) { setConflict(true); setError('The saved letter changed. Review the latest saved version before preparing delivery.'); return }
      if (!next.readiness.canSend || next.subscribers.eligible < 1 || !letterReady(next.draft)) { setError('Delivery is not ready for this letter and audience.'); return }
      setReview(structuredClone(next))
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The audience could not be reviewed.') }
    finally { setReviewLoading(false) }
  }
  function changeDraft(key: keyof NewsletterDraft, value: string) { setDraft(current => ({ ...current, [key]: value })); setFeedback('') }
  function changeSettings(key: keyof NewsletterSettings, value: string) { setSettings(current => ({ ...current, [key]: value })); setFeedback('') }
  function startOutline() {
    setDraft(current => ({ subject: current.subject || 'A seasonal note from Sergio', previewText: current.previewText, body: outline })); setOutlineUsed(true); setFeedback('A private outline is in your editor. Replace every bracketed prompt with your own words before sending.')
  }
  const tabItems: { id: View; label: string; icon: string }[] = [{ id: 'letter', label: 'Letter', icon: 'edit' }, { id: 'subscribers', label: 'Subscribers', icon: 'people' }, { id: 'history', label: 'History', icon: 'history' }]
  const people = data?.subscribers.items.filter(person => (subscriberStatus === 'all' || person.status === subscriberStatus) && (!query.trim() || `${person.name} ${person.email}`.toLowerCase().includes(query.trim().toLowerCase()))) || []
  const missingLabels: Record<string, string> = { RESEND_API_KEY: 'email connection', RESEND_NEWSLETTER_API_KEY: 'newsletter delivery connection', RESEND_WEBHOOK_SECRET: 'delivery notifications', EMAIL_SENDER_VERIFIED: 'sending domain verification', EMAIL_FROM: 'sender address', EMAIL_TEST_TO: 'operator test inbox', EMAIL_REPLY_TO: 'reply inbox', EMAIL_MODE: 'delivery activation', NEWSLETTER_MODE: 'newsletter activation', RESEND_NEWSLETTER_SEGMENT_ID: 'subscriber audience', BOOKING_BRIDGE_SECRET: 'secure subscription links', EMAIL_PUBLIC_ORIGIN: 'subscription pages', NEWSLETTER_PUBLIC_ORIGIN: 'subscription pages', NEWSLETTER_CONTACT_PROPERTY_VERIFIED: 'personal unsubscribe links', COMPLETE_LETTER_DRAFT: 'a finished draft', TEST_CURRENT_DRAFT: 'a test of this saved letter', CONFIRMED_SUBSCRIBERS: 'confirmed subscribers', CAMPAIGN_REVIEW: 'review of the previous send' }
  const missing = [...new Set(data?.readiness.missing.map(value => missingLabels[value] || 'delivery setup') || [])]
  const blockedReason = !data ? '' : data.readiness.mode === 'preview' ? 'Preview mode is on. Saving and previewing work; test and subscriber delivery are disabled.' : draftDirty || settingsDirty ? 'Save your letter and sender settings before testing or reviewing delivery.' : !letterReady(data.draft) ? 'Add a subject and your own letter, replacing any outline prompts, before delivery.' : data.readiness.mode === 'test' ? 'Test mode sends only to the configured operator inbox. Subscribers will not receive it.' : !data.readiness.canSend ? 'Complete the sender and subscriber connection before delivery.' : !data.subscribers.eligible ? 'No confirmed subscribers are eligible for delivery yet.' : ''

  if (!data) return <section className="newsletter-page newsletter-loading"><Icon name="mail" size={32}/><h3>{loading ? 'Opening the letter desk…' : 'Your letter desk is unavailable'}</h3><p role={loadError ? 'alert' : 'status'}>{loadError || 'Loading your saved letter and subscriber consent.'}</p>{!loading && <button className="button secondary" onClick={() => void refresh()}>Try again</button>}</section>
  return <div className="newsletter-page">
    <header className="newsletter-heading"><div><p className="eyebrow">THE SEASONAL LETTER</p><h3>A note worth opening.</h3><p>A personal hello, one useful idea, and a little of what’s in season.</p></div><button className="button secondary" onClick={() => setSettingsOpen(true)} disabled={locked}><Icon name="edit" size={16}/>Sender & footer{settingsDirty && <span aria-label="Unsaved settings"> ·</span>}</button></header>
    <div className="newsletter-navigation" role="tablist" aria-label="Newsletter sections">{tabItems.map((item, index) => <button key={item.id} id={`${tabs}-${item.id}-tab`} role="tab" aria-selected={view === item.id} aria-controls={`${tabs}-${item.id}-panel`} tabIndex={view === item.id ? 0 : -1} onClick={() => setView(item.id)} onKeyDown={event => { let next = index; if (event.key === 'ArrowRight') next = (index + 1) % tabItems.length; else if (event.key === 'ArrowLeft') next = (index + tabItems.length - 1) % tabItems.length; else if (event.key === 'Home') next = 0; else if (event.key === 'End') next = tabItems.length - 1; else return; event.preventDefault(); setView(tabItems[next].id); document.getElementById(`${tabs}-${tabItems[next].id}-tab`)?.focus() }}><Icon name={item.icon} size={17}/>{item.label}{item.id === 'subscribers' && <span>{data.subscribers.confirmed}</span>}</button>)}</div>
    <aside className="newsletter-readiness"><span className={'newsletter-mode ' + data.readiness.mode}>{data.readiness.mode === 'preview' ? 'Preview mode' : data.readiness.mode === 'test' ? 'Test delivery' : data.readiness.canSend ? 'Ready to send' : 'Connection needed'}</span><p>{blockedReason || 'Only confirmed, eligible subscribers receive your letter.'}{missing.length > 0 && <small>Still needed: {missing.join(', ')}.</small>}</p><button className="newsletter-text-button" disabled={locked || loading || reviewLoading} onClick={() => void refresh()}><Icon name="history" size={14}/>{loading ? 'Refreshing…' : 'Refresh'}</button></aside>
    {loadError && <p className="newsletter-error" role="alert">{loadError} Your open edits are retained.</p>}
    {error && <div className="newsletter-error" role="alert"><p>{error}</p>{ambiguous && <button className="button secondary" disabled={!!pending} onClick={() => attempt.current && void act(attempt.current.kind)}>{pending ? 'Retrying…' : 'Retry the same request'}</button>}</div>}
    {feedback && <p className="newsletter-feedback" role="status">{feedback}</p>}
    {conflict && <div className="newsletter-conflict"><strong>Review the latest saved version.</strong><p>Your open edits have been kept. Compare them with the saved preview before saving over the newer version.</p><div><button className="button secondary" onClick={() => setPreviewOpen(true)}>View saved letter</button><button className="button secondary" disabled={locked} onClick={() => { setConflict(false); setError('') }}>Keep my edits</button><button className="newsletter-text-button" disabled={locked} onClick={() => { setDraft({ ...data.draft }); setSettings({ ...data.settings }); setConflict(false); setError('') }}>Load saved version</button></div></div>}
    {view === 'letter' && <section id={`${tabs}-letter-panel`} role="tabpanel" aria-labelledby={`${tabs}-letter-tab`}>
      <div className="newsletter-draft-bar"><div><span className={'newsletter-save-dot' + (draftDirty ? ' dirty' : '')}/><strong>{draftDirty ? 'You have unsaved edits' : 'Your letter is saved'}</strong><span>Private until you choose to send.</span></div><div><button className="button secondary" onClick={() => setPreviewOpen(true)}><Icon name="external" size={16}/>Preview</button><button className="button" disabled={locked || conflict || !draftDirty} onClick={() => void act('draft', { draft: { ...draft } })}>{pending === 'draft' ? 'Saving…' : 'Save letter'}</button></div></div>
      <div className="newsletter-letter-layout"><div className="newsletter-editor"><section className="newsletter-envelope"><div className="newsletter-section-heading"><span className="eyebrow">THE ENVELOPE</span><p>A clear subject. A small reason to open.</p></div><label className="field" htmlFor={`${tabs}-subject`}>Subject<input id={`${tabs}-subject`} value={draft.subject} maxLength={180} disabled={locked} onChange={event => changeDraft('subject', event.target.value)} placeholder="A seasonal note from Sergio"/></label><label className="field" htmlFor={`${tabs}-preview`}>Preview text <span className="newsletter-optional">Optional</span><input id={`${tabs}-preview`} value={draft.previewText} maxLength={220} disabled={locked} onChange={event => changeDraft('previewText', event.target.value)} placeholder="A little context beside the subject line"/><small>The short line a reader sees before opening the email.</small></label></section>
        <section className="newsletter-writing"><div className="newsletter-section-heading"><span className="eyebrow">IN YOUR OWN WORDS</span><p>Write as you would to someone at your table.</p></div><label className="field" htmlFor={`${tabs}-body`}>Your letter<textarea id={`${tabs}-body`} className="newsletter-body" value={draft.body} rows={16} maxLength={18000} disabled={locked} onChange={event => changeDraft('body', event.target.value)} placeholder={'Hello,\n\nStart with a personal note. Share one useful seasonal idea. If there is something to join or book, finish with one clear invitation.'}/></label><div className="newsletter-writing-footer"><span>{draft.body.length.toLocaleString()} characters</span>{!draft.body && !outlineUsed && <button className="newsletter-text-button" disabled={locked} onClick={startOutline}>Use a private outline<Icon name="chevron" size={13}/></button>}</div><p className="newsletter-writing-guide"><strong>A good rhythm</strong> A personal opening. One useful idea. An optional invitation and one link. <span>A signed footer is added automatically.</span></p></section>
        <section className="newsletter-delivery"><div><span className="eyebrow">WHEN IT FEELS READY</span><h4>A careful last look.</h4><p>{data.subscribers.eligible.toLocaleString()} confirmed {data.subscribers.eligible === 1 ? 'subscriber is' : 'subscribers are'} eligible. Test delivery uses only the configured operator inbox.</p></div><div className="newsletter-delivery-actions"><button className="button secondary" title={blockedReason || undefined} disabled={!deliveryReady || !data.readiness.canTest} onClick={() => void act('test')}><Icon name="mail" size={16}/>{pending === 'test' ? 'Submitting test…' : 'Send a test'}</button><button className="button" title={blockedReason || undefined} disabled={!deliveryReady || !data.readiness.canSend || !data.subscribers.eligible || reviewLoading} onClick={() => void prepareSend()}>{reviewLoading ? 'Checking audience…' : 'Review sending'}<Icon name="chevron" size={15}/></button></div><p className="newsletter-delivery-reason">{blockedReason}</p></section>
      </div><LetterPreview data={data} dirty={draftDirty || settingsDirty}/></div>
    </section>}
    {view === 'subscribers' && <section id={`${tabs}-subscribers-panel`} role="tabpanel" aria-labelledby={`${tabs}-subscribers-tab`} className="newsletter-subscribers"><header className="newsletter-section-title"><h3>People who asked to hear from you.</h3><p>New opt-ins only. Bookings, guest lists and past inquiries are never added automatically.</p></header><dl className="newsletter-counts"><div><dt>Confirmed</dt><dd>{data.subscribers.confirmed}</dd></div><div><dt>Eligible for delivery</dt><dd>{data.subscribers.eligible}</dd></div><div><dt>Awaiting confirmation</dt><dd>{data.subscribers.pending}</dd></div><div><dt>Unsubscribed</dt><dd>{data.subscribers.unsubscribed}</dd></div></dl><p className="newsletter-consent-note"><Icon name="shield" size={17}/>Only confirmed, available addresses are included. Unsubscribes and provider suppression are rechecked before delivery.</p>{data.subscribers.items.length ? <><div className="newsletter-filters"><label className="newsletter-search"><Icon name="search" size={17}/><input aria-label="Search subscribers" placeholder="Find a name or email" value={query} onChange={event => setQuery(event.target.value)}/></label><label className="newsletter-filter">Status<select value={subscriberStatus} onChange={event => setSubscriberStatus(event.target.value)}><option value="all">All subscribers</option><option value="confirmed">Confirmed</option><option value="pending">Awaiting confirmation</option><option value="unsubscribed">Unsubscribed</option></select></label></div><div className="newsletter-person-list">{people.map(person => <article key={person.id}><span className="newsletter-person-icon"><Icon name="people" size={18}/></span><div><strong>{person.name || person.email}</strong>{person.name && <span>{person.email}</span>}<small>{person.status === 'confirmed' ? `Confirmed ${date(person.confirmedAt)}` : person.status === 'unsubscribed' ? `Unsubscribed ${date(person.unsubscribedAt)}` : `Requested ${date(person.requestedAt)}`}</small></div><span className={'newsletter-status ' + person.status}>{person.status === 'pending' ? 'Awaiting confirmation' : person.status === 'confirmed' ? person.synced ? 'Confirmed' : 'Confirmed · sync pending' : 'Unsubscribed'}</span></article>)}{!people.length && <p className="newsletter-empty-results">No subscribers match those filters.</p>}</div></> : <div className="newsletter-empty"><Icon name="people" size={35}/><h4>Let the list grow naturally.</h4><p>People appear here after asking for your seasonal letter. They become eligible only after confirming their email.</p><span>No booking addresses have been imported.</span></div>}</section>}
    {view === 'history' && <section id={`${tabs}-history-panel`} role="tabpanel" aria-labelledby={`${tabs}-history-tab`}><header className="newsletter-section-title"><h3>Letters that have left the desk.</h3><p>A record of submission and provider outcomes. Provider acceptance does not mean an email was delivered or read.</p></header>{data.history.length ? <div className="newsletter-history">{data.history.map(campaign => <article key={campaign.id}><span className="newsletter-person-icon"><Icon name={campaign.status === 'needs_review' || campaign.status === 'failed' ? 'info' : 'mail'} size={20}/></span><div><strong>{campaign.subject || 'Untitled letter'}</strong><span>{campaign.status === 'test_sent' ? 'Operator test' : `${campaign.audienceCount.toLocaleString()} confirmed subscribers`} · {date(campaign.createdAt)}</span>{campaign.lastError && <p className="newsletter-history-error">{campaign.lastError}</p>}</div><span className={'newsletter-status ' + campaign.status}>{campaignLabels[campaign.status]}</span></article>)}</div> : <div className="newsletter-empty"><Icon name="mail" size={35}/><h4>The first letter is still yours to write.</h4><p>Saved drafts stay at your desk. Test submissions and newsletter sends will appear here when they happen.</p><button className="button secondary" onClick={() => setView('letter')}>Back to your letter</button></div>}</section>}
    {previewOpen && <Modal title="Your saved letter" subtitle={draftDirty || settingsDirty ? 'Your open edits are retained. This preview shows the last saved version.' : 'Private HTML and plain text preview. No email is sent.'} onClose={() => setPreviewOpen(false)} wide><div className="newsletter-preview-modal"><LetterPreview data={data} dirty={draftDirty || settingsDirty} expanded/></div><footer className="modal-actions"><button className="button secondary" onClick={() => setPreviewOpen(false)}>Back to writing</button></footer></Modal>}
    {settingsOpen && <Modal title="The sender & the small print" subtitle="Shared details for this seasonal letter. Provider credentials stay outside the editor." onClose={() => setSettingsOpen(false)}><form onSubmit={event => { event.preventDefault(); void act('settings', { settings: { ...settings } }) }}><div className="modal-body newsletter-settings"><label className="field">Sender name<input required maxLength={100} value={settings.senderName} disabled={locked} onChange={event => changeSettings('senderName', event.target.value)}/></label><label className="field">Reply-to email<input required type="email" maxLength={254} value={settings.replyTo} disabled={locked} onChange={event => changeSettings('replyTo', event.target.value)}/><small>A real inbox for a personal reply.</small></label><label className="field">Business postal address<textarea required rows={3} maxLength={500} value={settings.postalAddress} disabled={locked} onChange={event => changeSettings('postalAddress', event.target.value)}/><small>Shown in the letter footer alongside the unsubscribe link.</small></label><p className="newsletter-settings-note"><Icon name="shield" size={17}/>Saving these details does not verify a sending domain or enable email delivery.</p>{error && <p className="newsletter-error" role="alert">{error}</p>}</div><footer className="modal-actions"><button type="button" className="button secondary" disabled={!!pending} onClick={() => setSettingsOpen(false)}>Close</button><button className="button" disabled={locked || conflict || !settingsDirty}>{pending === 'settings' ? 'Saving…' : 'Save sender details'}</button></footer></form></Modal>}
    {review && <Modal title="One last look, then send." subtitle="This review uses the saved letter and a fresh eligible audience count." onClose={() => { if (!pending) setReview(null) }} wide><div className="modal-body newsletter-send-review"><dl><div><dt>Letter</dt><dd>{review.draft.subject}</dd></div><div><dt>From</dt><dd>{review.settings.senderName}</dd></div><div><dt>Replies</dt><dd>{review.settings.replyTo}</dd></div><div><dt>Audience</dt><dd>{review.subscribers.eligible.toLocaleString()} confirmed, eligible subscribers</dd></div><div><dt>Footer</dt><dd>{review.settings.postalAddress}</dd></div></dl><p>Only people who confirmed their subscription are included. The server checks the saved letter, recipient count and exclusions again before submission.</p><LetterPreview data={review} dirty={false} expanded/>{error && <p className="newsletter-error" role="alert">{error}</p>}</div><footer className="modal-actions"><button className="button secondary" disabled={!!pending} onClick={() => setReview(null)}>Back to the letter</button><button className="button" disabled={!!pending || ambiguous || !review.readiness.canSend} onClick={() => void act('send', { expectedAudienceCount: review.subscribers.eligible }, review.revision)}>{pending === 'send' ? 'Submitting…' : `Send to ${review.subscribers.eligible.toLocaleString()} ${review.subscribers.eligible === 1 ? 'subscriber' : 'subscribers'}`}</button></footer></Modal>}
  </div>
}
