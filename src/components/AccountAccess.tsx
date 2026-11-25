import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { accountHref } from '../content/account'
import { useAuth } from '../account/AuthProvider'
import { Icon } from './Icons'
import './AccountAccess.css'

export type AccountSummary = { authenticated: boolean; displayName: string; emailVerified: boolean; isAdmin: boolean }
type AccountState = { kind: 'unknown' | 'loading' | 'unavailable' } | { kind: 'ready'; value: AccountSummary }
type AccountContextValue = { state: AccountState; refresh: () => void }
export const AccountContext = createContext<AccountContextValue>({ state: { kind: 'unknown' }, refresh: () => {} })

export function readAccountSummary(value: unknown): AccountSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const data = value as Record<string, unknown>
  if (typeof data.authenticated !== 'boolean' || typeof data.displayName !== 'string' || data.displayName.length > 200 || /[\u0000-\u001f\u007f]/.test(data.displayName) || typeof data.emailVerified !== 'boolean' || typeof data.isAdmin !== 'boolean') return null
  return { authenticated: data.authenticated, displayName: data.authenticated ? data.displayName.trim() : '', emailVerified: data.authenticated && data.emailVerified, isAdmin: data.authenticated && data.isAdmin }
}

/** No account status, identity or bearer proof is stored in browser storage. */
export function AccountProvider({ children }: { children: ReactNode }) {
  const { state: auth, refresh } = useAuth()
  const state: AccountState = auth.kind === 'authenticated' ? { kind: 'ready', value: { authenticated: true, displayName: auth.identity.name || '', emailVerified: auth.identity.email_verified, isAdmin: auth.identity.isAdmin } } : auth.kind === 'signed-out' ? { kind: 'ready', value: { authenticated: false, displayName: '', emailVerified: false, isAdmin: false } } : { kind: auth.kind === 'loading' ? 'loading' : 'unavailable' }
  return <AccountContext.Provider value={{ state, refresh: () => { void refresh() } }}>{children}</AccountContext.Provider>
}

function AccountLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { state } = useContext(AccountContext)
  const signedIn = state.kind === 'ready' && state.value.authenticated
  return <>
    <a href={accountHref('bookings')} onClick={onNavigate}><Icon name="book-open" size={18}/><span>Your evenings</span><Icon name="arrow-up-right" size={15}/></a>
    {signedIn && state.value.isAdmin && <a href={accountHref('admin')} onClick={onNavigate}><Icon name="chef-hat" size={18}/><span>Admin dashboard</span><Icon name="arrow-up-right" size={15}/></a>}
    {signedIn && !state.value.emailVerified && <a href={accountHref('verifyEmail')} onClick={onNavigate}><Icon name="mail" size={18}/><span>Verify my email</span></a>}
    {signedIn ? <a href={accountHref('signOut')} onClick={onNavigate}><Icon name="arrow-right" size={18}/><span>Sign out</span></a> : <>
      <a href={accountHref('signIn')} onClick={onNavigate}><Icon name="arrow-up-right" size={18}/><span>Sign in</span></a>
      <a href={accountHref('createAccount')} onClick={onNavigate}><Icon name="plus" size={18}/><span>Create an account</span></a>
      {state.kind !== 'ready' && <a href={accountHref('signOut')} onClick={onNavigate}><Icon name="arrow-right" size={18}/><span>Sign out</span></a>}
    </>}
  </>
}

/** The header's account entry is a direct link to the dashboard, which sends a
 * signed-out visitor through sign-in and back. Sign-out lives in the dashboard's
 * own navigation and in the footer's account section. */
export function AccountMenu({ onOpen }: { navigationOpen: boolean; onOpen: () => void }) {
  const { state } = useContext(AccountContext)
  const signedIn = state.kind === 'ready' && state.value.authenticated
  return <div className="account-access">
    <a className="account-access-trigger" href={accountHref('bookings')} onClick={onOpen}
      aria-label={signedIn && state.value.displayName ? `My account, signed in as ${state.value.displayName}` : 'My account'}>
      <span className="account-access-icon"><Icon name="users" size={18}/>{signedIn && <span className="account-signed-in-dot" aria-hidden="true"/>}</span>
      <span>My account</span>
    </a>
  </div>
}

export function FooterAccount() {
  const { state } = useContext(AccountContext)
  const signedIn = state.kind === 'ready' && state.value.authenticated
  return <section className="footer-account" aria-labelledby="footer-account-title">
    <div className="footer-account-copy"><Icon name="users" size={23}/><div><h3 id="footer-account-title">Your account</h3><p>{signedIn ? 'Your evenings, menus and receipts, together.' : 'A place for your evenings, menus and receipts.'}</p></div></div>
    <nav aria-label="Footer account"><AccountLinks/></nav>
  </section>
}

export function BookingAccountAccess() {
  const { state } = useContext(AccountContext)
  const signedIn = state.kind === 'ready' && state.value.authenticated
  const [claimHref, setClaimHref] = useState<string | null>(null)
  useEffect(() => {
    const current = new URL(location.href), ref = current.searchParams.get('ref')
    if (current.pathname !== '/book/done/' || !ref || !/^[A-Za-z0-9_-]{3,128}$/.test(ref)) return
    let proof = new URLSearchParams(current.hash.slice(1)).get('access') || ''
    if (!proof) { try { proof = sessionStorage.getItem('booking-access:' + ref) || '' } catch { /* The original private link remains usable. */ } }
    if (!/^[A-Za-z0-9_-]{43}$/.test(proof)) return
    const target = new URL(accountHref('bookings'), location.origin)
    target.searchParams.set('ref', ref); target.hash = new URLSearchParams({ access: proof }).toString()
    setClaimHref(target.pathname + target.search + target.hash)
  }, [])
  return <aside className="booking-account-access" aria-labelledby="booking-account-title"><Icon name="book-open" size={23}/><div><h2 id="booking-account-title">Your account, when you need it.</h2><p>{claimHref ? 'Keep this request with your evenings. You’ll review and confirm the link in your account.' : 'Open the bookings and receipts linked to your account. Keep this private link for the current status of this request.'}</p><a href={claimHref || accountHref('bookings')}>{claimHref ? 'Keep this request in your account' : signedIn ? 'Open your evenings' : 'Open my account'}<Icon name="arrow-up-right" size={16}/></a></div></aside>
}
