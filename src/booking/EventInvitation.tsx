import { useEffect, useRef, useState, type FormEvent } from 'react'
import { booking } from '../content/booking'
import { CtaButton } from '../components/CallToAction'
import { InvitationPaper, type InvitationPaperDetails } from './InvitationPaper'
import { acknowledgeMenu, observeInvitation, parseInvitationAttention, type InvitationAttention } from './invitation-attention'
import './EventInvitation.css'

type Invitation = InvitationPaperDetails & { id: string; version: number; timeZone: string; guestCount: number; ownResponse?: {name: string; email: string; attending: string; dietary: string; allergies: string; revision: number} }
async function invitationCall<T>(path: string, body: unknown): Promise<T> {
  if (!booking.apiBase) throw new Error('This invitation is temporarily unavailable. Please contact your host.')
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000)
  try {
    const response = await fetch(booking.apiBase.replace(/\/$/, '') + path, { method: 'POST', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal, headers: { 'Content-Type': 'application/json', 'X-Booking-Request': '1' }, body: JSON.stringify(body) })
    const value = await response.json().catch(() => null)
    if (!response.ok || !value) throw new Error(value?.message || 'Your response could not be confirmed. Please retry or contact your host.')
    return value as T
  } finally { clearTimeout(timer) }
}
export function EventInvitation() {
  const [invitation, setInvitation] = useState<Invitation | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [retry, setRetry] = useState(0)
  const [name, setName] = useState(''), [email, setEmail] = useState(''), [attending, setAttending] = useState('yes'), [dietary, setDietary] = useState(''), [allergies, setAllergies] = useState(''), [sending, setSending] = useState(false), [saved, setSaved] = useState(false)
  const [hasNewMenu, setHasNewMenu] = useState(false), attention = useRef<InvitationAttention | null>(null), hydratedInvitation = useRef('')
  const proof = useRef({ id: '', accessToken: '' }), attempt = useRef<{ body: string; id: string } | null>(null), responseToken = useRef(''), responseVersion = useRef(0), live = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    let current = true
    const id = new URLSearchParams(location.search).get('id') || '', accessToken = new URLSearchParams(location.hash.slice(1)).get('invite') || ''
    proof.current = { id, accessToken }; setLoading(true); setError('')
    try { attention.current = parseInvitationAttention(localStorage.getItem('sergio-invitation-view:v1:' + id)) } catch { /* Same-page transitions still work when storage is unavailable. */ }
    try { const saved = JSON.parse(sessionStorage.getItem('invitation-response:' + id) || 'null'); responseToken.current = saved?.token || ''; responseVersion.current = saved?.version ?? 0 } catch { /* Responding still works without storage. */ }
    if (!id || !accessToken) { setError('Open the complete private invitation link shared by your host.'); setLoading(false); return }
    let refreshing = false
    const refresh = async () => {
      if (refreshing) return
      refreshing = true
      try {
        const value = await invitationCall<Invitation>('/api/invitation', { ...proof.current, ...(responseToken.current ? { responseToken: responseToken.current } : {}) })
        if (!current) return
        const available = value.menuReady === true && value.menu?.trim() && value.menuVersion ? value.menuVersion : null
        let previous = attention.current
        try { previous = parseInvitationAttention(localStorage.getItem('sergio-invitation-view:v1:' + id)) ?? previous } catch { /* Same-page memory remains available. */ }
        attention.current = observeInvitation(previous, available)
        try { localStorage.setItem('sergio-invitation-view:v1:' + id, JSON.stringify(attention.current)) } catch { /* Optional cross-visit memory. */ }
        setHasNewMenu(!!available && attention.current.newVersion === available)
        setInvitation(value); setError('')
        if (hydratedInvitation.current !== id) {
          if (value.ownResponse) { const r = value.ownResponse; setName(r.name); setEmail(r.email); setAttending(r.attending); setDietary(r.dietary); setAllergies(r.allergies); responseVersion.current = r.revision }
          hydratedInvitation.current = id
        }
      } catch (failure) { if (current) { setInvitation(null); setError(failure instanceof Error ? failure.message : 'This invitation could not be loaded.') } }
      finally { refreshing = false; if (current) setLoading(false) }
    }
    const visibleRefresh = () => { if (document.visibilityState === 'visible') void refresh() }
    void refresh()
    const timer = setInterval(visibleRefresh, 60000)
    window.addEventListener('focus', visibleRefresh); document.addEventListener('visibilitychange', visibleRefresh)
    return () => { current = false; clearInterval(timer); window.removeEventListener('focus', visibleRefresh); document.removeEventListener('visibilitychange', visibleRefresh) }
  }, [retry])
  function openMenu() {
    if (!attention.current || !invitation?.menuVersion) return
    attention.current = acknowledgeMenu(attention.current, invitation.menuVersion)
    try { localStorage.setItem('sergio-invitation-view:v1:' + invitation.id, JSON.stringify(attention.current)) } catch { /* Same-page acknowledgment is sufficient. */ }
    setHasNewMenu(!!attention.current.newVersion)
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (sending || !invitation) return
    if (name.trim().length < 2) { setError('Enter your name so your host knows who is responding.'); document.getElementById('invite-name')?.focus(); return }
    const payload = { ...proof.current, name: name.trim(), email: email.trim(), attending, dietary: dietary.trim(), allergies: allergies.trim(), ...(responseToken.current ? { responseToken: responseToken.current, version: responseVersion.current } : {}) }
    const body = JSON.stringify(payload)
    if (attempt.current?.body !== body) attempt.current = { body, id: crypto.randomUUID() }
    setSending(true); setSaved(false); setError('')
    try {
      const result = await invitationCall<{ ok: boolean; responseToken: string; version: number }>('/api/invitation/rsvp', { ...payload, requestId: attempt.current.id })
      if (result.ok !== true || !/^[a-f0-9]{64}$/.test(result.responseToken)) throw new Error('Your response could not be confirmed. Retry to recover the same response.')
      responseToken.current = result.responseToken; responseVersion.current = result.version
      try { sessionStorage.setItem('invitation-response:' + invitation.id, JSON.stringify({token: result.responseToken, version: result.version})) } catch { /* The current page retains access to this response. */ }
      setSaved(true); attempt.current = null; requestAnimationFrame(() => live.current?.focus())
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Your response could not be confirmed. Please retry.') }
    finally { setSending(false) }
  }
  return <section className="event-invitation-page wrap">
    <header className="event-invitation-heading"><p className="eyebrow">CHEF SERGIO &amp; CO.</p><h1>Your invitation</h1><p>A gathering worth looking forward to.</p></header>
    {loading ? <p role="status">Opening your invitation…</p> : !invitation ? <div className="event-invitation-empty"><p role="alert">{error}</p><CtaButton emphasis="secondary" onClick={() => setRetry(value => value + 1)}>Try again</CtaButton></div> : <div className="event-invitation-layout">
      <InvitationPaper invitation={invitation} hasNewMenu={hasNewMenu} onMenuOpen={openMenu} />
      <form className="event-invitation-response" onSubmit={submit}><h2>Will you join us?</h2><p>Your response goes privately to Sergio. Other guests cannot see your contact details, dietary needs or allergies.</p><fieldset><legend>Your RSVP</legend><label><input type="radio" name="attendance" value="yes" checked={attending === 'yes'} onChange={() => { setAttending('yes'); setSaved(false) }}/>I’ll be there</label><label><input type="radio" name="attendance" value="no" checked={attending === 'no'} onChange={() => { setAttending('no'); setSaved(false) }}/>I can’t make it</label></fieldset><label htmlFor="invite-name">Your name<input id="invite-name" value={name} onChange={event => { setName(event.target.value); setSaved(false) }} autoComplete="name" maxLength={150} required minLength={2}/></label><label htmlFor="invite-email">Email <span>(optional)</span><input id="invite-email" type="email" value={email} onChange={event => { setEmail(event.target.value); setSaved(false) }} autoComplete="email" maxLength={254}/></label>{attending === 'yes' && <><label htmlFor="invite-dietary">Dietary needs <span>(optional)</span><textarea id="invite-dietary" value={dietary} onChange={event => { setDietary(event.target.value); setSaved(false) }} rows={3} maxLength={2000}/></label><label htmlFor="invite-allergies">Allergies <span>(optional)</span><textarea id="invite-allergies" value={allergies} onChange={event => { setAllergies(event.target.value); setSaved(false) }} rows={3} maxLength={2000}/><small>Sergio will review accommodation with you. Submitting a requirement does not confirm it can be accommodated.</small></label></>}{error && <p role="alert" className="event-invitation-error">{error}</p>}{saved && <p ref={live} tabIndex={-1} role="status" className="event-invitation-saved">Your response is saved. You can update it from this browser.</p>}<CtaButton emphasis="primary" type="submit" disabled={sending} aria-busy={sending}>{sending ? 'Saving…' : responseToken.current ? 'Update my response' : 'Send my response'}</CtaButton></form>
    </div>}
  </section>
}
