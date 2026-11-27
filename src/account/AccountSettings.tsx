import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { accountApi, accountFetch, AccountApiError } from './api'
import { useAuth } from './AuthProvider'
import { accountReturnHref, currentReturnTo } from './config'
import { AccountIconNavControl } from './AccountIconNav'
import { renderPersonalDataCopy } from './export-copy'
import { AccountFeedback, type AccountNotice } from './AccountFeedback'
import './AccountSettings.css'

type Profile = { displayName: string; preferences: string; email: string; emailVerified: boolean }
type Method = { provider: 'auth0' | 'google-oauth2' | 'external'; label: string; primary: boolean; passwordManagedBy: 'auth0' | 'google' | 'provider' }
type Security = {
  email: string | null; emailVerified: boolean; methodsVerified: boolean; methods: Method[];
  passwordResetEnabled: boolean; passwordResetEmail?: string | null;
  passwordResetReason?: string; googleDisconnect: { available: boolean; mode: 'review_request' | 'not_connected' | 'unavailable'; reason: string };
}
type RequestKind = 'access_export' | 'account_closure' | 'erasure' | 'sign_in_change' | 'rectification' | 'restriction' | 'objection' | 'portability' | 'consent_withdrawal'
type PrivacyRequest = { id: string; kind: RequestKind; signInAction?: string | null; status: string; revision: number; message: string; responseNote: string; retainedRecordsNote: string; fulfillmentEvidence?: string; createdAt: string; updatedAt: string; responseDueAt?: string; extensionReason?: string | null; exportAvailable: boolean; exportKind?: 'interim' | 'final' | null; history?: { id: string; at: string; actor: string; status: string; message: string; responseNote: string; retainedRecordsNote: string; fulfillmentEvidence?: string }[] }
type Privacy = { requests: PrivacyRequest[] }
type Newsletter = { newsletter: { status: string; consentVersion: string | null; updatedAt: string | null } }
const RETURN_TO = '/dashboard/?view=settings'
const failure = (error: unknown) => error instanceof Error ? error.message : 'This part of your settings could not be opened. Please try again.'
const requestTitles: Record<RequestKind, string> = { access_export: 'Personal-data access & export', account_closure: 'Account closure', erasure: 'Personal-data erasure', sign_in_change: 'Sign-in change', rectification: 'Correct personal information', restriction: 'Restrict processing', objection: 'Object to processing', portability: 'Data portability', consent_withdrawal: 'Withdraw sensitive-information consent' }
const requestStatus: Record<string, string> = { received: 'Received · awaiting review', pending: 'Received · awaiting review', in_review: 'In review', needs_information: 'Your reply is needed', completed: 'Completed · outcome recorded below', declined: 'Not fulfilled · explanation below', cancelled: 'Cancelled' }
const date = (value: string) => new Date(value).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
const validSecurity = (value: any) => typeof value?.methodsVerified === 'boolean' && typeof value.passwordResetEnabled === 'boolean' && typeof value.emailVerified === 'boolean' && Array.isArray(value.methods) && value.methods.every((method: any) => method && ['auth0', 'google-oauth2', 'external'].includes(method.provider) && typeof method.label === 'string' && typeof method.primary === 'boolean' && ['auth0', 'google', 'provider'].includes(method.passwordManagedBy)) && value.googleDisconnect && typeof value.googleDisconnect.available === 'boolean' && ['review_request', 'not_connected', 'unavailable'].includes(value.googleDisconnect.mode) && typeof value.googleDisconnect.reason === 'string' && (!value.passwordResetEnabled || typeof value.passwordResetEmail === 'string' && value.passwordResetEmail.length > 0)
const validRequest = (value: any) => value && /^pr_[a-f0-9]{32}$/.test(value.id) && Object.hasOwn(requestTitles, value.kind) && Object.hasOwn(requestStatus, value.status) && Number.isSafeInteger(value.revision) && value.revision >= 0 && ['message', 'responseNote', 'retainedRecordsNote', 'createdAt', 'updatedAt'].every(key => typeof value[key] === 'string') && typeof value.exportAvailable === 'boolean' && Array.isArray(value.history)

function useSection<T>(path: string) {
  const [data, setData] = useState<T | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true)
  const sequence = useRef(0), controller = useRef<AbortController | null>(null)
  const load = useCallback(async () => {
    const run = ++sequence.current
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort
    setLoading(true); setError('')
    try {
      const response = await accountFetch(path, { signal: abort.signal })
      const value = await response.json().catch(() => null)
      if (!response.ok || !value) throw new AccountApiError(value?.error?.message || 'These settings could not be read. Please try again.', response.status)
      if (path === '/customer/profile' && (!value.profile || typeof value.profile.displayName !== 'string' || typeof value.profile.preferences !== 'string' || typeof value.profile.email !== 'string' || typeof value.profile.emailVerified !== 'boolean') || path === '/account/security' && !validSecurity(value) || path === '/customer/privacy' && (!Array.isArray(value.requests) || !value.requests.every(validRequest)) || path === '/customer/newsletter-preference' && !['not_subscribed', 'pending', 'subscribed', 'unsubscribed'].includes(value.newsletter?.status)) throw new Error('The service returned incomplete settings. Please refresh this section.')
      if (run === sequence.current) setData(value)
    } catch (error) { if (run === sequence.current && !abort.signal.aborted) setError(failure(error)) }
    finally { if (run === sequence.current) setLoading(false) }
  }, [path])
  useEffect(() => { void load(); return () => { ++sequence.current; controller.current?.abort() } }, [load])
  return { data, setData, error, loading, load }
}
function SectionFailure({ message, retry }: { message: string; retry: () => void }) {
  return <AccountFeedback title="This section couldn’t be opened" detail={message} alert><button type="button" className="ev-text-button" onClick={retry}>Try again</button></AccountFeedback>
}

/** Each account gets a separate instance; pending responses from a previous account cannot populate this one. */
export function AccountSettings() {
  const { state } = useAuth()
  return state.kind === 'authenticated' ? <SettingsContents key={state.identity.sub} verified={state.identity.email_verified}/> : null
}
function SettingsContents({ verified }: { verified: boolean }) {
  const returnTo = typeof location === 'undefined' ? RETURN_TO : currentReturnTo()
  const profile = useSection<{ profile: Profile }>('/customer/profile')
  const security = useSection<Security>('/account/security')
  const privacy = useSection<Privacy>('/customer/privacy')
  const newsletter = useSection<Newsletter>('/customer/newsletter-preference')
  const [name, setName] = useState(''), [preferences, setPreferences] = useState(''), [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(''), [notice, setNotice] = useState<AccountNotice | null>(null), [actionError, setActionError] = useState('')
  const [resetStatus, setResetStatus] = useState('')
  const [draft, setDraft] = useState<{ kind: RequestKind; signInAction?: 'change_method' | 'disconnect_google' } | null>(null)
  const [message, setMessage] = useState(''), [confirmed, setConfirmed] = useState(false)
  const [replyTo, setReplyTo] = useState<string | null>(null), [reply, setReply] = useState('')
  const pending = useRef(new Map<string, { payload: string; id: string }>()), flight = useRef(false), epoch = useRef(0)
  const requestHeading = useRef<HTMLHeadingElement>(null)
  const feedback = useRef<HTMLDivElement>(null)
  useEffect(() => { if (profile.data && !dirty) { setName(profile.data.profile.displayName); setPreferences(profile.data.profile.preferences) } }, [profile.data, dirty])
  useEffect(() => { if (draft) requestHeading.current?.focus({ preventScroll: true }) }, [draft])
  useEffect(() => { if (notice || actionError) { feedback.current?.focus({ preventScroll: true }); feedback.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' }) } }, [notice, actionError])
  useEffect(() => () => { ++epoch.current }, [])
  function mutationId(key: string, payload: object) {
    const fingerprint = JSON.stringify(payload), previous = pending.current.get(key)
    if (previous?.payload === fingerprint) return previous.id
    const id = crypto.randomUUID(); pending.current.set(key, { payload: fingerprint, id }); return id
  }
  async function act(key: string, task: (current: () => boolean) => Promise<void>) {
    if (flight.current) return
    const run = epoch.current
    flight.current = true; setBusy(key); setNotice(null); setActionError('')
    try { await task(() => run === epoch.current) }
    catch (error) { if (run === epoch.current) setActionError(failure(error)) }
    finally { if (run === epoch.current) { flight.current = false; setBusy('') } }
  }
  function save(event: FormEvent) {
    event.preventDefault()
    void act('profile', async current => {
      const result = await accountApi<{ profile: Profile }>('/customer/profile', { displayName: name, preferences })
      if (!current()) return
      if (!result.profile || typeof result.profile.displayName !== 'string' || typeof result.profile.preferences !== 'string' || typeof result.profile.email !== 'string' || typeof result.profile.emailVerified !== 'boolean') throw new Error('The saved profile could not be confirmed. Refresh it before trying again.')
      profile.setData(result); setName(result.profile.displayName); setPreferences(result.profile.preferences); setDirty(false)
      window.dispatchEvent(new Event('site:account-profile-saved'))
      setNotice({ title: 'Profile saved', detail: 'Existing bookings and their contact details have not changed.' })
    })
  }
  function resetPassword() {
    void act('password', async current => {
      const result = await accountApi<{ status: string }>('/account/password/reset', { requestId: mutationId('password', {}) })
      if (!current()) return
      setResetStatus(result.status)
      if (result.status === 'requested') setNotice({ title: 'Reset link requested', detail: 'Check the sign-in email shown below, including its spam folder.', note: 'An accepted request does not confirm email delivery or a changed password.', icon: 'mail' })
      else if (result.status === 'processing' || result.status === 'unknown') setNotice({ title: 'Reset request not confirmed', detail: 'Check your inbox first.', note: 'Retrying checks the same request so it does not deliberately send a second message.', icon: 'clock' })
      else throw new Error('Password recovery is not available for this sign-in method right now. Refresh your sign-in methods or use secure sign-in help.')
    })
  }
  function openRequest(kind: RequestKind, signInAction?: 'change_method' | 'disconnect_google') {
    setDraft({ kind, signInAction }); setMessage(''); setConfirmed(false); setNotice(null); setActionError('')
  }
  function sendRequest(event: FormEvent) {
    event.preventDefault()
    if (!draft || !confirmed) return
    const payload = { ...draft, message: message.trim() }
    void act('request', async current => {
      const result = await accountApi<{ request: PrivacyRequest }>('/customer/privacy/request', { ...payload, requestId: mutationId('request', payload) })
      if (!current()) return
      if (!validRequest(result.request) || result.request.kind !== payload.kind || (result.request.signInAction ?? undefined) !== payload.signInAction) throw new Error('Receipt of this request could not be confirmed. Retry to recover the same request.')
      pending.current.delete('request'); setDraft(null); setMessage(''); setConfirmed(false)
      setNotice(payload.kind === 'consent_withdrawal' ? { title: 'Consent withdrawal recorded', detail: 'Optional sensitive-information use is blocked. Removal and any necessary retained records are being reviewed.', note: 'Your bookings are unchanged.' } : payload.kind === 'restriction' ? { title: 'Restriction recorded', detail: 'Optional processing is paused while reviewed.', note: 'Necessary booking and rights correspondence can continue.' } : payload.kind === 'objection' ? { title: 'Objection recorded', detail: 'Marketing is blocked while the remaining scope is reviewed.' } : { title: 'Request received', detail: 'Follow its progress and replies below.', note: 'Bookings and sign-in methods are unchanged.' })
      await privacy.load()
    })
  }
  function sendReply(event: FormEvent, request: PrivacyRequest) {
    event.preventDefault()
    const payload = { id: request.id, expectedRevision: request.revision, message: reply.trim() }
    void act('reply', async current => {
      const result = await accountApi<{ request: PrivacyRequest }>('/customer/privacy/reply', { ...payload, requestId: mutationId('reply', payload) })
      if (!current()) return
      if (!validRequest(result.request) || result.request.id !== request.id || result.request.revision <= request.revision || !result.request.history?.some(event => event.actor === 'customer' && event.message === payload.message)) throw new Error('Your saved reply could not be confirmed. Retry to recover the same reply.')
      pending.current.delete('reply'); setReplyTo(null); setReply(''); setNotice({ title: 'Reply saved for review' }); await privacy.load()
    })
  }
  async function download(request: PrivacyRequest, format: 'json' | 'html' = 'json') {
    void act('export:' + request.id, async current => {
      const path = '/customer/privacy/export?id=' + encodeURIComponent(request.id)
      async function read(path: string) { const response = await accountFetch(path); if (!response.ok || !response.headers.get('Content-Type')?.includes('application/json')) throw new Error('The personal-data export could not be downloaded. Refresh the request and try again.'); return response.json() }
      const manifest = await read(path)
      if (!current()) return
      if (manifest.delivery !== 'parts' || !Number.isSafeInteger(manifest.partCount) || manifest.partCount < 1 || !Number.isSafeInteger(manifest.byteLength) || !/^[a-f0-9]{64}$/.test(manifest.sha256)) throw new Error('The export manifest is incomplete. No partial file was saved.')
      const chunks: string[] = []
      for (let i = 0; i < manifest.partCount; i++) {
        const part = await read(path + '&part=' + i)
        if (!current()) return
        if (part.partIndex !== i || typeof part.content !== 'string') throw new Error('A file part was missing. Retry the download; no partial file was saved.')
        chunks.push(part.content)
      }
      const content = chunks.join(''), bytes = new TextEncoder().encode(content)
      const checksum = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('')
      if (bytes.byteLength !== manifest.byteLength || checksum !== manifest.sha256) throw new Error('The file did not pass its integrity check. Retry the download; no partial file was saved.')
      const parsed = JSON.parse(content)
      const interim = manifest.releaseKind === 'interim'
      if ((request.exportKind === 'interim') !== interim || interim && (parsed.releaseKind !== 'interim' || parsed.completion?.complete !== false)) throw new Error('The file’s delivery status changed. Refresh the request before downloading again; no file was saved.')
      const blob = format === 'html' ? new Blob([renderPersonalDataCopy(parsed)], {type:'text/html;charset=utf-8'}) : new Blob([bytes], {type:'application/json'})
      if (!current()) return
      const url = URL.createObjectURL(blob), link = document.createElement('a')
      link.href = url; link.download = 'chef-sergio-personal-data' + (interim ? '-available' : '') + '.' + format; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000)
      setNotice(interim ? { title: 'Available file verified', detail: 'The reviewed collected-data file passed its integrity check. Your browser was asked to save it; allow or save the download if prompted.', note: 'Your request is still in review. The file lists outstanding sources and does not represent a completed response.' } : { title: 'Export file verified', detail: 'Your personal-data export passed its integrity check. Your browser was asked to save it; allow or save the download if prompted.', note: 'The file includes source coverage and any redaction explanations.' })
    })
  }
  const s = security.data, methodsReady = !!s?.methodsVerified && Array.isArray(s.methods)
  const google = methodsReady && s!.methods.some(method => method.provider === 'google-oauth2')
  const subscription = newsletter.data?.newsletter.status
  const subscribed = subscription === 'confirmed' || subscription === 'subscribed' || subscription === 'pending'
  const destructive = draft?.kind === 'erasure' || draft?.kind === 'account_closure'
  return <section className="ev-panel account-settings" aria-labelledby="settings-heading">
    <header className="settings-heading"><p className="ev-eyebrow">Your account, in your hands</p><h1 id="settings-heading" tabIndex={-1}>Settings &amp; profile.</h1><p className="ev-intro">Your personal details, how you sign in, and what happens to your information.</p></header>
    <nav className="settings-sections account-icon-nav" aria-label="Settings sections">{([['settings-profile', 'Profile', 'profile'], ['settings-security', 'Sign-in & security', 'security'], ['settings-privacy', 'Privacy & account', 'privacy']] as const).map(([id, label, symbol], index, items) => <AccountIconNavControl key={id} kind="button" symbol={symbol} label={label} controls={id} edge={index === 0 ? 'start' : index === items.length - 1 ? 'end' : undefined} onClick={() => { const section = document.getElementById(id); section?.scrollIntoView({ block: 'start', behavior: 'instant' }); section?.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true }) }}/>)}</nav>
    <div ref={feedback} tabIndex={-1} className="settings-feedback">{notice && <AccountFeedback {...notice}/>}
    {actionError && <AccountFeedback title="Please check this request" detail={actionError} note={dirty || draft || replyTo ? 'Your unsent answers are still here.' : undefined} alert/>}</div>

    <section id="settings-profile" className="settings-section" aria-labelledby="settings-profile-heading">
      <div className="settings-section-heading"><span aria-hidden="true">01</span><div><h2 id="settings-profile-heading" tabIndex={-1}>Profile</h2><p>How Sergio knows you.</p></div></div>
      {profile.error ? <SectionFailure message={profile.error} retry={() => void profile.load()}/> : !profile.data ? <p role="status">Opening your profile…</p> : <>
        <form className="ev-form settings-profile-form" onSubmit={save}>
          <label htmlFor="settings-name">What should we call you?<input id="settings-name" value={name} autoComplete="name" maxLength={100} disabled={!!busy || profile.loading || !verified} onChange={event => { setDirty(true); setName(event.target.value) }}/></label>
          <label htmlFor="settings-preferences">Your usual preferences<textarea id="settings-preferences" value={preferences} rows={4} maxLength={2000} disabled={!!busy || profile.loading || !verified} aria-describedby="settings-preferences-help" placeholder="The pace, setting or kind of evening you enjoy" onChange={event => { setDirty(true); setPreferences(event.target.value) }}/></label>
          <p id="settings-preferences-help" className="ev-note">These preferences help future conversations. Keep medical, allergy and religious details out of your profile; share your own event needs through the separate consent choice for that booking. Contact details are confirmed for each booking.</p>
          <button className="ev-primary" type="submit" disabled={!!busy || profile.loading || !dirty || !verified}>{busy === 'profile' ? 'Saving profile…' : 'Save profile'}</button>
        </form>
        <div className="settings-fact"><h3>Your account email</h3><p className="settings-email">{profile.data.profile.email}</p><p className="ev-note">{profile.data.profile.emailVerified ? 'Verified sign-in email.' : 'Email verification is needed.'} This is managed by your sign-in provider. It is separate from the contact details already saved for each evening.</p><div className="ev-actions"><button className="ev-text-button" type="button" disabled={!!busy || !verified} onClick={() => openRequest('sign_in_change', 'change_method')}>Ask to change sign-in details</button><a className="ev-text-button" href="/dashboard/">View your evenings</a></div><p className="ev-note">Changing an email needs care so your existing bookings stay connected. Sending a request does not change it.</p></div>
      </>}
    </section>

    <section id="settings-security" className="settings-section" aria-labelledby="settings-security-heading">
      <div className="settings-section-heading"><span aria-hidden="true">02</span><div><h2 id="settings-security-heading" tabIndex={-1}>Sign-in &amp; security</h2><p>Keep a way back to your plans.</p></div></div>
      {security.error ? <SectionFailure message={security.error} retry={() => void security.load()}/> : !s ? <p role="status">Checking your sign-in methods…</p> : !methodsReady ? <SectionFailure message="Your connected sign-in methods could not be verified." retry={() => void security.load()}/> : <>
        <ul className="settings-methods">{s.methods.map((method, index) => <li key={method.provider + index}><div><h3>{method.label}</h3><p className="ev-note">Connected{method.primary ? ' · main sign-in method' : ''}. {method.passwordManagedBy === 'google' ? 'Your Google password is managed by Google.' : method.passwordManagedBy === 'auth0' ? 'Password managed by the secure Chef Sergio sign-in service.' : 'Credentials managed by your sign-in provider.'}</p></div><span className="settings-connected">Connected</span></li>)}</ul>
        {s.passwordResetEnabled && <div className="settings-fact"><h3>Change or recover your password</h3><p>A secure reset link goes to <span className="settings-email">{s.passwordResetEmail || s.email}</span>. You’ll choose the new password on the sign-in service, then sign in again.</p><button className="ev-text-button" type="button" onClick={resetPassword} disabled={!!busy || resetStatus === 'requested'}>{busy === 'password' ? 'Requesting reset…' : resetStatus === 'requested' ? 'Reset request accepted' : resetStatus === 'unknown' || resetStatus === 'processing' ? 'Check the same reset request' : 'Request password reset'}</button><p className="ev-note">A request being accepted does not confirm that the email arrived or that your password changed.</p></div>}
        {!s.passwordResetEnabled && s.methods.some(method => method.provider === 'auth0') && <AccountFeedback title="Password reset unavailable" detail={s.passwordResetReason === 'staging_email_restricted' ? 'Password-reset delivery is limited to the approved test inbox on this preview. Your connected password sign-in has not changed.' : 'We can’t verify password-reset eligibility for this connected method right now. Refresh the sign-in methods or ask for a sign-in review.'} icon="clock"/>}
        {google && <div className="settings-fact"><h3>Google sign-in</h3><p>You can manage your Google password in <a className="ev-text-button" href="https://myaccount.google.com/security" target="_blank" rel="noopener noreferrer">Google Account security (opens in a new tab)</a>.</p><p className="ev-note">{s.googleDisconnect.reason === 'last_method' ? 'Google is your only connected sign-in method. A verified alternative is needed before it can be disconnected.' : s.googleDisconnect.reason === 'primary_identity' ? 'This account was created with Google. Changing that sign-in needs a review so your bookings stay connected.' : 'Disconnection needs an identity check and a verified alternative sign-in. Sergio will arrange the next steps before any change.'}</p><button type="button" className="ev-text-button" disabled={!!busy || !verified} onClick={() => openRequest('sign_in_change', 'disconnect_google')}>Request a Google sign-in change</button><p className="ev-note">This requests a review; it does not disconnect Google. Removing Chef Sergio from Google’s connected apps is a separate action and does not erase this account.</p></div>}
        <div className="ev-actions"><a className="ev-text-button" href={accountReturnHref('/account/verify-email/', returnTo)}>Email verification</a><a className="ev-text-button" href={accountReturnHref('/account/password-reset/', returnTo)}>Secure sign-in help</a><a className="ev-text-button" href="/auth/logout/">Sign out of this browser</a><button className="ev-text-button" type="button" disabled={!!busy || security.loading} onClick={() => void security.load()}>Refresh sign-in methods</button></div>
      </>}
    </section>

    <section id="settings-privacy" className="settings-section" aria-labelledby="settings-privacy-heading">
      <div className="settings-section-heading"><span aria-hidden="true">03</span><div><h2 id="settings-privacy-heading" tabIndex={-1}>Privacy &amp; account</h2><p>Clear choices about your information.</p></div></div>
      <div className="settings-fact"><h3>Sergio’s seasonal letter</h3>{newsletter.error ? <SectionFailure message={newsletter.error} retry={() => void newsletter.load()}/> : !newsletter.data ? <p role="status">Checking your letter preference…</p> : <><p>{subscription === 'confirmed' || subscription === 'subscribed' ? 'You’re subscribed.' : subscription === 'pending' ? 'Your subscription is awaiting confirmation.' : subscription === 'unsubscribed' ? 'You’ve opted out.' : 'This account email is not subscribed.'}</p>{subscribed && <button type="button" className="ev-text-button" disabled={!!busy || !verified} onClick={() => void act('newsletter', async current => { const result = await accountApi<Newsletter>('/customer/newsletter/withdraw', { requestId: mutationId('newsletter', {}) }); if (!current()) return; if (result.newsletter?.status !== 'unsubscribed') throw new Error('Withdrawal could not be confirmed. Retry to recover the same request.'); newsletter.setData(result); pending.current.delete('newsletter'); setNotice({ title: 'Seasonal-letter consent withdrawn', detail: 'Booking messages and existing bookings are separate.' }); await newsletter.load() })}>Withdraw seasonal-letter consent</button>}<p className="ev-note">This preference covers the seasonal letter. Necessary messages about a booking are separate. Booking never signs you up for the letter.</p></>}</div>
      <div className="settings-privacy-options">
        <article><h3>Access &amp; export your information</h3><p>Request your personal data, including relevant booking, communication, payment and provider records, together with information about how it is used. Other people’s information and access credentials are protected.</p><button type="button" className="ev-text-button" disabled={!!busy || !verified} onClick={() => openRequest('access_export')}>Request personal-data export</button></article>
        <article><h3>Close your account</h3><p>Ask to end account access. Closure is reviewed separately from erasing records and does not cancel a booking or arrange a refund.</p><button type="button" className="ev-text-button" disabled={!!busy || !verified} onClick={() => openRequest('account_closure')}>Request account closure</button></article>
        <article><h3>Erase personal information</h3><p>Ask what can be removed. Some booking, payment or communication records may need to be retained. The response will explain what was removed, what remains and why.</p><button type="button" className="ev-text-button" disabled={!!busy || !verified} onClick={() => openRequest('erasure')}>Request erasure</button></article>
        <article><h3>Correct your information</h3><p>Use Profile for your name and usual preferences. Request corrections to other personal information here, including information in existing booking records.</p><button type="button" className="ev-text-button" disabled={!!busy || !verified} onClick={() => openRequest('rectification')}>Request a correction</button></article>
        <article><h3>Restrict or object to processing</h3><p>Ask us to limit use of disputed information, or object to processing based on legitimate interests. Marketing consent can be withdrawn directly above.</p><div className="ev-actions"><button type="button" className="ev-text-button" disabled={!!busy || !verified} onClick={() => openRequest('restriction')}>Request restriction</button><button type="button" className="ev-text-button" disabled={!!busy || !verified} onClick={() => openRequest('objection')}>Object to processing</button></div></article>
        <article><h3>Withdraw consent for saved event information</h3><p>Stop optional use of your saved allergy, dietary or other sensitive event information. We will remove working copies and explain any specific records that must be retained. This does not cancel your booking; contact Sergio about safe participation.</p><button type="button" className="ev-text-button" disabled={!!busy || !verified} onClick={() => openRequest('consent_withdrawal')}>Withdraw event-information consent</button></article>
        <article><h3>Data portability</h3><p>Request a structured, machine-readable copy of information you provided where portability applies. This is distinct from the broader right of access.</p><button type="button" className="ev-text-button" disabled={!!busy || !verified} onClick={() => openRequest('portability')}>Request portability</button></article>
      </div>
      <p className="ev-note">We respond to data-rights requests within one calendar month of receipt. If a lawful extension is necessary, we explain it within that first month. Asking for clarification does not automatically restart that deadline. Sending a request does not cancel a booking. You can also contact <a href="mailto:admin.chefsergioandco@gmail.com?subject=Personal%20data%20rights%20request">admin.chefsergioandco@gmail.com</a>, including if you cannot sign in. You may complain to your competent data-protection authority.</p>
      {!verified && <AccountFeedback title="Confirm your email first" detail="Verify your account email before sending an account or privacy request." icon="mail"><a className="ev-text-button" href={accountReturnHref('/account/verify-email/', returnTo)}>Verify email</a></AccountFeedback>}

      {draft && <form className={`ev-form settings-request-form${destructive ? ' settings-request-form--consequential' : ''}`} onSubmit={sendRequest}>
        <h3 ref={requestHeading} tabIndex={-1}>{draft.signInAction === 'disconnect_google' ? 'Request a Google sign-in change' : requestTitles[draft.kind]}</h3>
        <p>{draft.kind === 'consent_withdrawal' ? 'Sending this instruction immediately blocks optional use of your saved sensitive event information. Working-copy removal and any necessary retained records are reviewed separately. Your booking remains in place; contact Sergio about safe participation.' : draft.kind === 'restriction' ? 'Sending this instruction pauses optional processing while the scope is reviewed. Necessary booking fulfillment, storage and rights correspondence can continue.' : draft.kind === 'objection' ? 'Sending this objection blocks direct marketing immediately. We review the remaining processing you identify and explain its outcome.' : draft.kind === 'sign_in_change' ? 'Sergio will review how to verify your identity, keep a usable sign-in method and preserve your existing records. No sign-in method changes until those checks are complete.' : ['access_export','portability'].includes(draft.kind) ? 'We collect the relevant data from the site and other systems used for your information. The response includes source coverage and explanations of any lawful restrictions. The completed file is downloaded through your signed-in account.' : 'We will review the request, act where the right applies, and explain the outcome and any lawful restriction. Sending this form records your request; it does not itself change records.'}</p>
        <label htmlFor="settings-request-message">What would you like us to know? <span className="ev-note">(optional)</span><textarea id="settings-request-message" value={message} maxLength={2000} rows={4} onChange={event => setMessage(event.target.value)} disabled={!!busy}/></label>
        <p className="ev-note">Describe the change or records you need. Don’t include passwords, card details or private sign-in links.</p>
        <label className="settings-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={!!busy}/><span>{['consent_withdrawal','restriction','objection'].includes(draft.kind)?'I understand the immediate processing control and the review of its remaining scope. My bookings and sign-in methods stay in place.':'I understand this sends a review request. It does not change my sign-in, delete data or cancel bookings.'}</span></label>
        <div className="ev-actions"><button type="submit" className="ev-primary" disabled={!!busy || !confirmed || !verified}>{busy === 'request' ? 'Sending request…' : 'Send review request'}</button><button type="button" className="ev-text-button" disabled={!!busy} onClick={() => { setDraft(null); setActionError('') }}>Keep editing settings</button></div>
      </form>}

      <section className="settings-requests" aria-labelledby="settings-requests-heading"><div className="settings-requests-heading"><h3 id="settings-requests-heading">Your requests</h3><button type="button" className="ev-text-button" disabled={!!busy || privacy.loading} onClick={() => void privacy.load()}>{privacy.loading ? 'Refreshing…' : 'Refresh requests'}</button></div>
        {privacy.error ? <SectionFailure message={privacy.error} retry={() => void privacy.load()}/> : !privacy.data ? <p role="status">Opening your requests…</p> : !privacy.data.requests.length ? <p className="ev-note">No account or privacy requests have been sent from this account.</p> : <ul className="settings-request-list">{privacy.data.requests.map(request => <li key={request.id}>
          <div className="settings-request-title"><h4>{request.signInAction === 'disconnect_google' ? 'Google sign-in change' : requestTitles[request.kind]}</h4><p>{requestStatus[request.status] || 'Status needs review'}</p></div>
          <p className="ev-note">Received {date(request.createdAt)} · Reference {request.id}</p>
          {request.responseDueAt && <p className="ev-note">Response due {date(request.responseDueAt)}{request.extensionReason ? ` · Extension reason: ${request.extensionReason}` : ''}</p>}
          {request.message && <p className="settings-preserve">{request.message}</p>}
          {request.responseNote && <div className="settings-response"><h5>Sergio’s response</h5><p className="settings-preserve">{request.responseNote}</p>{request.retainedRecordsNote && <><h5>Records retained</h5><p className="settings-preserve">{request.retainedRecordsNote}</p></>}{request.fulfillmentEvidence && <><h5>Recorded work and scope</h5><p className="settings-preserve">{request.fulfillmentEvidence}</p></>}</div>}
          {request.exportAvailable && <>{request.exportKind === 'interim' && <p className="ev-note"><strong>Available data · review ongoing.</strong> This reviewed copy contains data collected so far and lists outstanding sources. Your request remains open; this is not the completed response.</p>}<div className="ev-actions"><button type="button" className="ev-text-button" disabled={!!busy} onClick={() => void download(request)}>{busy === 'export:' + request.id ? 'Collecting and verifying file…' : request.exportKind === 'interim' ? 'Download available personal data' : 'Download personal-data export'}</button><button type="button" className="ev-text-button" disabled={!!busy} onClick={() => void download(request, 'html')}>Download readable copy</button></div></>}
          {request.status === 'needs_information' && <>{replyTo !== request.id ? <button type="button" className="ev-text-button" disabled={!!busy} onClick={() => { setReplyTo(request.id); setReply('') }}>Reply to this request</button> : <form className="ev-form" onSubmit={event => sendReply(event, request)}><label htmlFor={'settings-reply-' + request.id}>Your reply<textarea id={'settings-reply-' + request.id} rows={3} maxLength={2000} value={reply} onChange={event => setReply(event.target.value)} disabled={!!busy} required/></label><button className="ev-primary" disabled={!!busy || !reply.trim()}>{busy === 'reply' ? 'Saving reply…' : 'Send reply'}</button></form>}</>}
          {!!request.history?.length && <details className="settings-request-history"><summary>Request history</summary><ol>{request.history.map(event => <li key={event.id}><p className="ev-note">{date(event.at)} · {event.actor === 'admin' ? 'Sergio’s team' : 'You'} · {requestStatus[event.status] || event.status}</p>{event.message && <p className="settings-preserve">{event.message}</p>}{event.responseNote && <p className="settings-preserve">{event.responseNote}</p>}{event.fulfillmentEvidence && <p className="settings-preserve">{event.fulfillmentEvidence}</p>}</li>)}</ol></details>}
        </li>)}</ul>}
      </section>
    </section>
  </section>
}
