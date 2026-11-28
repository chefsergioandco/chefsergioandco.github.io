import './AccountPages.css'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from '../components/Icons'
import { useAuth } from './AuthProvider'
import { accountApi } from './api'
import { accountConfig, accountReturnHref, currentReturnTo, safeReturnTo, signInHref } from './config'
import { beginSignIn, completeSignIn, endedResume, endSignIn } from './auth-client'
import { navigateAccount } from './navigation'

type Kind = 'sign-in' | 'create' | 'check-email' | 'verify-email' | 'password-reset' | 'sign-out' | 'signed-out'
type Security = { email: string | null; emailVerified: boolean; verificationResendEnabled: boolean; verificationCheckEnabled: boolean; passwordResetEnabled: boolean; passwordResetEmail?: string | null; passwordProvider: 'auth0' | 'google' | 'external' | null; passwordPolicyVerified: boolean; minLength: number | null }
const failureText = (error: unknown) => error instanceof Error ? error.message : 'Your request could not be completed. Please try again.'
function useReturnTo() {
  const [target, setTarget] = useState('/dashboard/')
  useEffect(() => {
    const update = () => {
      const requested = new URLSearchParams(location.search).get('returnTo')
      const fallback = /^\/(account|auth)(\/|$)/.test(location.pathname) ? '/dashboard/' : currentReturnTo()
      const next = new URL(safeReturnTo(requested, fallback), location.origin)
      if (!next.hash) next.hash = location.hash
      setTarget(safeReturnTo(next.pathname + next.search + next.hash))
    }
    update(); window.addEventListener('site:navigate', update); window.addEventListener('popstate', update)
    return () => { window.removeEventListener('site:navigate', update); window.removeEventListener('popstate', update) }
  }, [])
  return target
}
const accountLink = accountReturnHref
export function AuthRequired({ children }: { children: ReactNode }) {
  const { state, refresh } = useAuth()
  // "My account" leads here; a signed-out visitor goes straight to sign-in and
  // returns to this exact page (query and private #fragment included).
  useEffect(() => { if (state.kind === 'signed-out') navigateAccount(signInHref(), true) }, [state.kind])
  if (state.kind === 'authenticated') return <>{children}</>
  if (state.kind === 'signed-out') return <section className="arrival signed-out"><p className="introduction" role="status">Opening sign-in…</p></section>
  return <section className="arrival signed-out"><p className="eyebrow arrival-subtitle">your evenings with sergio</p><h1>A place to return to.</h1><p className="introduction">Keep your plans, approved menus and receipts together, from the first conversation to another evening at your table.</p>{state.kind === 'loading' ? <p className="quiet" role="status">Opening your account…</p> : <><a className="button" href={signInHref()}>Continue to your account</a>{state.kind === 'unavailable' && <><p className="notice error" role="alert">{state.error}</p><button className="text-link link-reset" onClick={() => void refresh()}>Try again</button></>}</>}<div className="arrival-note"><p>You can plan an evening without creating an account.</p><a className="text-link" href="/book/">Start planning</a></div></section>
}
export function VerificationPanel({ page = false }: { page?: boolean }) {
  const { state } = useAuth()
  return state.kind === 'authenticated' ? <VerificationContents key={state.identity.sub} page={page}/> : null
}
function VerificationContents({ page }: { page: boolean }) {
  const { state, refresh } = useAuth(), [security, setSecurity] = useState<Security | null>(null), [message, setMessage] = useState('Checking your account’s verification status…'), [busy, setBusy] = useState(''), [error, setError] = useState(false), [locked, setLocked] = useState<Record<string, number>>({})
  const requests = useRef<Record<string, string>>({}), target = useReturnTo(), live = useRef(true)
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  const subject = state.kind === 'authenticated' ? state.identity.sub : '', emailVerified = state.kind === 'authenticated' && state.identity.email_verified
  useEffect(() => { let active = true; if (!subject) { setSecurity(null); return }; accountApi<Security>('/account/security').then(value => { if (active) { setSecurity(value); setMessage(''); setError(false) } }, error => { if (active) { setMessage(failureText(error)); setError(true) } }); return () => { active = false } }, [subject, emailVerified])
  async function act(action: 'verification/resend' | 'verification/check') {
    if (busy) return; setBusy(action); setError(false); setMessage('')
    requests.current[action] ??= crypto.randomUUID()
    try {
      const result = await accountApi<{ status: string; emailVerified?: boolean }>('/account/' + action, { requestId: requests.current[action] })
      if (!live.current) return
      if (!['processing', 'unknown'].includes(result.status)) delete requests.current[action]
      const checked = await accountApi<Security>('/account/security'); if (!live.current) return; setSecurity(checked); await refresh(); if (!live.current) return
      if (result.status === 'requested') { setMessage('Your verification request was accepted. Check your inbox and spam folder. This does not confirm delivery.'); setLocked(value => ({ ...value, [action]: Date.now() + 60000 })); setTimeout(() => { if (live.current) setLocked(value => ({ ...value })) }, 60000) }
      else if (result.status === 'verified' || result.status === 'already_verified' || checked.emailVerified) setMessage('Your email is verified. You can continue to your account.')
      else if (result.status === 'processing') setMessage('This request is still processing. Wait a moment before checking again.')
      else if (result.status === 'unknown') setMessage('The outcome could not be confirmed. Check your inbox before requesting another message.')
      else setMessage('Your email is not confirmed yet. Follow the link in your email, then check again. If needed, sign in again to refresh your account.')
    } catch (failure) { if (!live.current) return; setMessage(failureText(failure)); setError(true); const delay = Number((failure as { retryAfterSeconds?: number }).retryAfterSeconds) || 0; if (delay) { setLocked(value => ({ ...value, [action]: Date.now() + delay * 1000 })); setTimeout(() => { if (live.current) setLocked(value => ({ ...value })) }, delay * 1000) } }
    finally { if (live.current) setBusy('') }
  }
  if (state.kind !== 'authenticated' || (!page && (security?.emailVerified || state.identity.email_verified))) return null
  return <section className="account-security" aria-labelledby="verification-heading"><h2 id="verification-heading">{security?.emailVerified ? 'Your email is verified.' : 'Confirm your email.'}</h2><p>{security?.emailVerified ? 'Your account is ready to connect an existing booking using its private link.' : 'Verify the email on your account before connecting an existing booking.'}</p><p className="security-email">{security?.email || state.identity.email}</p>{!security?.emailVerified && <div className="security-actions"><button className="button secondary" disabled={!!busy || !security?.verificationResendEnabled || Date.now() < (locked['verification/resend'] || 0)} onClick={() => void act('verification/resend')}>{busy === 'verification/resend' ? 'Requesting…' : 'Resend verification email'}</button><button className="button secondary" disabled={!!busy || !security?.verificationCheckEnabled || Date.now() < (locked['verification/check'] || 0)} onClick={() => void act('verification/check')}>{busy === 'verification/check' ? 'Checking…' : 'I’ve verified my email'}</button><a className="text-link" href={accountLink('/account/sign-in/', target)}>Sign in again to refresh verification</a></div>}{message && <p className={'auth-status' + (error ? ' is-error' : '')} role={error ? 'alert' : 'status'}>{message}</p>}{security?.emailVerified && <a className="button" href={target}>Continue to your account</a>}</section>
}
function AccountPage({ kind }: { kind: Kind }) {
  const { state } = useAuth()
  return <AccountPageContents key={kind + ':' + (state.kind === 'authenticated' ? state.identity.sub : 'signed-out')} kind={kind}/>
}
function AccountPageContents({ kind }: { kind: Kind }) {
  const { state } = useAuth(), authenticated = state.kind === 'authenticated', target = useReturnTo(), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [security, setSecurity] = useState<Security | null>(null), requestId = useRef('')
  const live = useRef(true), resetInstructions = new URLSearchParams(typeof location === 'undefined' ? '' : location.search).get('for') === 'password_reset'
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  useEffect(() => { if (kind !== 'password-reset' || !authenticated) return; let active = true; accountApi<Security>('/account/security').then(value => { if (active) setSecurity(value) }, error => { if (active) setMessage(failureText(error)) }); return () => { active = false } }, [kind, authenticated])
  async function login(connection: 'google-oauth2' | 'Username-Password-Authentication', signup = false) { setBusy(true); setMessage(''); try { await beginSignIn(connection, target, signup) } catch (error) { if (live.current) { setMessage(failureText(error)); setBusy(false) } } }
  async function logout() { setBusy(true); setMessage(''); try { await endSignIn() } catch (error) { if (live.current) { setMessage(failureText(error)); setBusy(false) } } }
  async function reset() { if (busy) return; setBusy(true); setMessage(''); requestId.current ||= crypto.randomUUID(); try { const result = await accountApi<{ status: string }>('/account/password/reset', { requestId: requestId.current }); if (!live.current) return; if (result.status === 'requested') { requestId.current = ''; const next = new URL(accountLink('/account/check-email/', target), location.origin); next.searchParams.set('for', 'password_reset'); navigateAccount(next.pathname + next.search + next.hash) } else setMessage(result.status === 'processing' ? 'This request is still processing. Please check again shortly.' : 'Reset instructions are not available for this account right now. Use the secure email sign-in page for help.') } catch (error) { if (live.current) setMessage(failureText(error)) } finally { if (live.current) setBusy(false) } }
  const headings: Record<Kind, [string, string]> = { 'sign-in': ['Good to have you here.', 'Keep your plans with Sergio close at hand.'], create: ['A place for your plans.', 'Keep your bookings, occasion details and receipts together.'], 'verify-email': ['Confirm your email.', 'A small step that keeps your booking details private.'], 'password-reset': ['Reset your password.', 'Return to the plans you have made with Sergio.'], 'check-email': ['Check your email.', 'The next step happens in your inbox.'], 'sign-out': ['Ready to sign out?', 'This signs out your Chef Sergio account on this browser.'], 'signed-out': ['You’re signed out.', 'Sign in again whenever you need your plans.'] }
  const loginButton = (google: boolean, signup = false) => <button className={'button' + (google ? '' : ' secondary')} disabled={busy || !accountConfig.clientId} onClick={() => void login(google ? 'google-oauth2' : 'Username-Password-Authentication', signup)}><Icon name={google ? 'arrow-up-right' : 'mail'} size={20}/>{google ? 'Continue with Google' : signup ? 'Create an email account' : 'Continue with email'}</button>
  return <div className="auth-layout"><section className="auth-story"><p className="eyebrow">Chef Sergio &amp; Co. · Your account</p><h1>{headings[kind][0]}</h1><p className="introduction">{headings[kind][1]}</p><ul className="auth-points">{['Current booking details, close at hand.', 'Recorded receipts, kept together.', 'Private access to your plans.'].map(text => <li key={text}><Icon name="check" size={20}/><span>{text}</span></li>)}</ul></section><section className="auth-panel" aria-label="Account access">
    {(kind === 'sign-in' || kind === 'create') && <><h2>{kind === 'create' ? 'Create your account' : 'Sign in to your account'}</h2><p>{kind === 'create' ? 'Use Google or create an email account.' : 'Choose how you would like to continue.'}</p>{authenticated && <p>You’re signed in. <a href={target}>Continue to your account</a>, or choose another sign-in below.</p>}{loginButton(true)}<div className="auth-divider">or</div>{loginButton(false, kind === 'create')}<p className="auth-fine">You’ll enter your password on the secure {kind === 'create' ? 'sign-up' : 'sign-in'} page.{kind === 'create' && ' Verify your email before connecting an existing booking.'}</p><div className="auth-links"><a href={accountLink('/account/password-reset/', target)}>Forgot your password?</a><span>{kind === 'create' ? 'Already have an account? ' : 'New here? '}<a href={accountLink(kind === 'create' ? '/account/sign-in/' : '/account/create/', target)}>{kind === 'create' ? 'Sign in' : 'Create an account'}</a></span></div>{!accountConfig.clientId && <p className="auth-status is-error" role="alert">Account sign-in is being connected. Please try again shortly.</p>}</>}
    {kind === 'verify-email' && (authenticated ? <VerificationPanel page/> : <><h2>Sign in to verify your email</h2><p>We can only check or resend verification for the account you are signed in to.</p><a className="button" href={signInHref(accountLink('/account/verify-email/', target))}>Sign in to continue</a></>)}
    {kind === 'password-reset' && <><h2>{authenticated ? 'Your account password' : 'Continue with your email account'}</h2>{authenticated ? <><p>Request reset instructions for the verified email attached to your password sign-in.</p><p className="account-address">{security?.passwordResetEmail || security?.email || state.identity.email}</p><button className="button" disabled={busy || !security?.passwordResetEnabled} onClick={() => void reset()}>{busy ? 'Requesting…' : 'Request a password reset'}</button>{security && !security.passwordResetEnabled && <p>{security.passwordProvider === 'google' ? 'This account signs in through Google. Its password is managed by Google.' : 'You can use the secure email sign-in page for sign-in help.'}</p>}</> : <><p>Open the secure email sign-in page, then choose <strong>Forgot password</strong>.</p>{loginButton(false)}<p className="auth-fine">If you use Google to sign in, your password is managed by Google.</p></>}<div className="auth-links"><a href={signInHref(target)}>Back to sign in</a></div></>}
    {kind === 'check-email' && <><span className="auth-page-icon"><Icon name="mail" size={20}/></span><h2>{resetInstructions ? 'Look for reset instructions' : 'Look for the verification message'}</h2><p>{resetInstructions ? 'If reset instructions are available for the account, they’ll go to its email address.' : 'If a verification request was accepted for your account, follow the email link to confirm the address.'}</p><p>Check your spam folder before requesting another message. This page does not confirm delivery.</p><a className="button" href={accountLink(resetInstructions ? '/account/password-reset/' : '/account/verify-email/', target)}>{resetInstructions ? 'Back to password reset' : 'Check verification status'}</a><a className="text-link" href={authenticated ? target : signInHref(target)}>{authenticated ? 'Back to your account' : 'Back to sign in'}</a></>}
    {(kind === 'sign-out' || kind === 'signed-out') && (authenticated || kind === 'sign-out' ? <><h2>Finish this session</h2><p>Your bookings and receipts remain saved in your account. This also ends your secure sign-in session, even if this page has been refreshed.</p><button className="button" disabled={busy} onClick={() => void logout()}>{busy ? 'Signing out…' : 'Sign out'}</button><a className="button secondary" href={target}>Keep me signed in</a></> : <><h2>Until next time.</h2><p>Your bookings and receipts stay in your account.</p><a className="button" href={signInHref(target)}>Sign in again</a><a className="text-link" href="/">Return to the website</a></>)}
    {message && <p className="auth-status is-error" role="alert">{message}</p>}<noscript><p className="notice">Enable JavaScript to sign in securely. You can still <a href="/book/">plan an evening</a> without an account.</p></noscript>
  </section></div>
}
export const SignIn = () => <AccountPage kind="sign-in"/>
export const CreateAccount = () => <AccountPage kind="create"/>
export const VerifyEmail = () => <AccountPage kind="verify-email"/>
export const PasswordReset = () => <AccountPage kind="password-reset"/>
export const CheckEmail = () => <AccountPage kind="check-email"/>
export const SignOut = () => <AccountPage kind="sign-out"/>
export const SignedOut = () => <AccountPage kind="signed-out"/>
export function AuthCallback() {
  const { refresh } = useAuth(), [error, setError] = useState('')
  useEffect(() => { let active = true; const params = new URLSearchParams(location.search)
    if (params.has('error')) {
      // A silent resume found no Auth0 session: show the ordinary sign-in, not an error.
      const resumeTarget = endedResume(params.get('error'))
      if (resumeTarget) { navigateAccount(signInHref(resumeTarget), true); return }
      history.replaceState(null, '', '/auth/callback/'); setError('Sign-in was not completed. You can start again from the sign-in page.'); return
    }
    if (!params.has('code') || !params.has('state')) { navigateAccount('/account/verify-email/', true); return }
    void completeSignIn().then(async target => { history.replaceState(null, '', '/auth/callback/'); await refresh(); if (active) navigateAccount(target, true) }).catch(() => { history.replaceState(null, '', '/auth/callback/'); if (active) setError('Your sign-in could not be completed. Please start again from the sign-in page.') })
    return () => { active = false }
  }, [refresh])
  return <section className="arrival"><p className="eyebrow">Your account</p><h1>Opening your account.</h1>{error ? <><p className="notice error" role="alert">{error}</p><a className="button" href="/account/sign-in/">Return to sign in</a></> : <p className="introduction" role="status">Completing secure sign-in…</p>}</section>
}
