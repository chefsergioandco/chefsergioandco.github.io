import { useCallback, useEffect, useRef, useState } from 'react'
import { accountConfig } from '../account/config'
import { Icon } from './Icons'
import { Logo } from './Logo'
import { href } from './ui'
import './NewsletterTokenPage.css'

type Kind = 'confirm' | 'unsubscribe'
type TokenStatus = 'ready' | 'confirmed' | 'unsubscribed' | 'expired' | 'invalid'
type TokenResponse = { status: TokenStatus; title: string; message: string; canAct: boolean; actionLabel: string }
type Phase = 'loading' | 'acting' | 'settled' | 'unavailable'
const tokenPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[0-9a-f]{64}$/i
const statuses: TokenStatus[] = ['ready', 'confirmed', 'unsubscribed', 'expired', 'invalid']
const defaultTitle = (kind: Kind) => kind === 'confirm' ? 'Confirm your subscription' : 'Unsubscribe from the letter'

function readFragment() {
  if (window.location.hash.length > 2048) return null
  const values = new URLSearchParams(window.location.hash.slice(1)).getAll('token')
  return values.length === 1 && tokenPattern.test(values[0]) ? values[0] : null
}
function validResponse(value: unknown): value is TokenResponse {
  if (!value || typeof value !== 'object') return false
  const result = value as Partial<TokenResponse>
  return statuses.includes(result.status as TokenStatus) && typeof result.title === 'string' && result.title.length > 0 && result.title.length <= 200 && typeof result.message === 'string' && result.message.length <= 3000 && typeof result.canAct === 'boolean' && typeof result.actionLabel === 'string' && result.actionLabel.length <= 120
}

function NewsletterTokenPage({ kind }: { kind: Kind }) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [result, setResult] = useState<TokenResponse | null>(null)
  const [uncertainAction, setUncertainAction] = useState(false)
  const token = useRef<string | null>(null)
  const captured = useRef(false)
  const alive = useRef(false)
  const busy = useRef(false)
  const sequence = useRef(0)
  const requestController = useRef<AbortController | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)

  const check = useCallback(async (action: boolean) => {
    if (!token.current || busy.current) return
    const serial = ++sequence.current
    requestController.current?.abort()
    const controller = new AbortController()
    requestController.current = controller
    busy.current = true
    setPhase(action ? 'acting' : 'loading')
    let timedOut = false
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort() }, 15000)
    try {
      const response = await fetch(accountConfig.apiOrigin + '/api/newsletter/token/' + (action ? 'action' : 'preview'), {
        method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'X-Newsletter-Request': '1' },
        body: JSON.stringify({ kind, token: token.current }),
      })
      const payload: unknown = await response.json().catch(() => null)
      if (!alive.current || serial !== sequence.current) return
      if (!validResponse(payload) || !response.ok && payload.status === 'ready') throw new Error('Unavailable token response')
      const next = { ...payload, canAct: response.ok && payload.status === 'ready' && payload.canAct }
      setResult(next); setUncertainAction(false); setPhase('settled')
      if (action) window.requestAnimationFrame(() => { if (alive.current && serial === sequence.current) heading.current?.focus({ preventScroll: true }) })
    } catch {
      if (!alive.current || serial !== sequence.current || controller.signal.aborted && !timedOut) return
      setUncertainAction(previous => action || previous)
      setPhase('unavailable')
    } finally {
      window.clearTimeout(timeout)
      if (serial === sequence.current) busy.current = false
    }
  }, [kind])

  useEffect(() => {
    alive.current = true
    if (!captured.current) {
      token.current = readFragment()
      captured.current = true
      // Keep the bearer proof only in this mounted component's memory. It is
      // never copied into a query, storage, an outgoing link or an analytics event.
      if (window.location.hash) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
    }
    if (!token.current) {
      setResult({ status: 'invalid', title: defaultTitle(kind), message: 'Open the complete link from your newsletter email to continue. No subscription change has been made by this page.', canAct: false, actionLabel: '' })
      setPhase('settled')
    } else { busy.current = false; void check(false) }
    return () => { alive.current = false; ++sequence.current; busy.current = false; requestController.current?.abort() }
  }, [check, kind])

  const pending = phase === 'loading' || phase === 'acting'
  const completed = result?.status === 'confirmed' || result?.status === 'unsubscribed'
  const title = phase === 'unavailable' ? uncertainAction ? 'Let’s check that change.' : 'A moment before we continue.' : result?.title || defaultTitle(kind)
  const message = phase === 'unavailable'
    ? uncertainAction ? 'We could not confirm the result. Check the current subscription status before trying the action again.' : 'This link could not be checked right now. Please try again in a moment.'
    : phase === 'loading' ? 'Checking your private link. Your subscription stays unchanged until you choose the button below.'
    : phase === 'acting' ? 'Saving your choice. Please keep this page open for the result.'
    : result?.message || 'Use the link in your email to continue.'

  return <section className="newsletter-token-page" aria-labelledby="newsletter-token-title" aria-busy={pending}>
    <div className="newsletter-token-inner">
      <a href={href('/')} className="newsletter-token-brand" aria-label="Chef Sergio and Co. home"><Logo variant="compact" decorative/></a>
      <div className="newsletter-token-content">
        <span className={'newsletter-token-symbol' + (completed ? ' is-complete' : '')} aria-hidden="true"><Icon name={completed ? 'check' : kind === 'confirm' ? 'mail' : 'book-open'} size={26}/></span>
        <p className="newsletter-token-eyebrow">THE SEASONAL LETTER</p>
        <h1 id="newsletter-token-title" ref={heading} tabIndex={-1}>{title}</h1>
        <p className="newsletter-token-message" role={phase === 'unavailable' ? 'alert' : 'status'} aria-live="polite" aria-atomic="true">{message}</p>
        {phase === 'settled' && result?.canAct && <button className="newsletter-token-action" disabled={pending} onClick={() => void check(true)}>{result.actionLabel || (kind === 'confirm' ? 'Confirm my subscription' : 'Unsubscribe')}<Icon name="arrow-right" size={18}/></button>}
        {phase === 'acting' && <button className="newsletter-token-action" disabled>Saving your choice…</button>}
        {phase === 'unavailable' && token.current && <button className="newsletter-token-action" disabled={pending} onClick={() => void check(false)}>{uncertainAction ? 'Check status again' : 'Try again'}<Icon name="arrow-right" size={18}/></button>}
        {!pending && <a className="newsletter-token-home" href={href('/')}><Icon name="arrow-left" size={16}/>Back to Sergio’s table</a>}
        <div className="newsletter-token-note"><p>{kind === 'confirm' ? 'A personal note from Sergio, with something useful to bring to your own kitchen.' : 'This choice applies to the seasonal letter. Your existing bookings and account stay as they are.'}</p><p>A question? <a href="mailto:hello@chefsergioandco.com">Write to Sergio</a>.</p></div>
        <noscript><p className="newsletter-token-noscript">Enable JavaScript to check this private link and choose whether to continue. Opening this page alone does not change your subscription.</p></noscript>
      </div>
    </div>
  </section>
}

export function NewsletterConfirm() { return <NewsletterTokenPage kind="confirm"/> }
export function NewsletterUnsubscribe() { return <NewsletterTokenPage kind="unsubscribe"/> }
