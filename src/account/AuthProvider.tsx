import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { accountApi } from './api'
import { accountConfig } from './config'
import { resumeSignIn, SignInRequired } from './auth-client'
export type AccountIdentity = { sub: string; email: string; email_verified: boolean; name?: string; isAdmin: boolean; permissions: string[] }
export type AuthState = { kind: 'loading' | 'signed-out' | 'unavailable'; error?: string } | { kind: 'authenticated'; identity: AccountIdentity }
const Context = createContext<{ state: AuthState; refresh: () => Promise<void> }>({ state: { kind: 'loading' }, refresh: async () => {} })
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ kind: 'loading' }), sequence = useRef(0)
  const refresh = useCallback(async () => {
    const run = ++sequence.current
    if (!accountConfig.clientId) { setState({ kind: 'unavailable', error: 'Account sign-in is being connected. Please try again shortly.' }); return }
    try {
      const session = await accountApi<{ authenticated: boolean; identity: AccountIdentity | null }>('/auth/session')
      if (run !== sequence.current) return
      setState(session.authenticated && session.identity ? { kind: 'authenticated', identity: session.identity } : { kind: 'signed-out' })
    } catch (failure) { if (run === sequence.current) setState(failure instanceof SignInRequired ? { kind: 'signed-out' } : { kind: 'unavailable', error: failure instanceof Error ? failure.message : 'Your account could not be opened.' }) }
  }, [])
  useEffect(() => {
    // The callback route owns code exchange; initial cache-only lookup is otherwise safe.
    const accountIntent = () => /^\/(account|dashboard|admin|auth)(\/|$)/.test(location.pathname)
    if (accountIntent() && !['/auth/callback/', '/account/callback/'].includes(location.pathname)) void refresh()
    else setState({ kind: 'signed-out' })
    const navigate = () => { if (accountIntent() && !['/auth/callback/', '/account/callback/'].includes(location.pathname)) void refresh() }
    const expire = () => { ++sequence.current; setState({ kind: 'signed-out' }) }
    const focus = () => { if (!document.hidden && accountIntent() && !['/auth/callback/', '/account/callback/'].includes(location.pathname)) void refresh() }
    window.addEventListener('site:navigate', navigate); window.addEventListener('popstate', navigate); window.addEventListener('account:expired', expire); window.addEventListener('focus', focus)
    return () => { window.removeEventListener('site:navigate', navigate); window.removeEventListener('popstate', navigate); window.removeEventListener('account:expired', expire); window.removeEventListener('focus', focus) }
  }, [refresh])
  useEffect(() => {
    // Only pages that need an account resume a previous sign-in; public pages never redirect.
    if (state.kind !== 'signed-out') return
    const path = location.pathname
    const target = path === '/account/sign-in/' ? new URLSearchParams(location.search).get('returnTo') || '/dashboard/'
      : /^\/(dashboard|admin)\//.test(path) ? path + location.search + location.hash : null
    if (target) void resumeSignIn(target).catch(() => { /* The page's ordinary sign-in remains available. */ })
  }, [state.kind])
  useEffect(() => {
    if (state.kind !== 'authenticated') return
    const timer = setInterval(() => { if (!document.hidden) void refresh() }, 60000)
    return () => clearInterval(timer)
  }, [state.kind, refresh])
  return <Context.Provider value={{ state, refresh }}>{children}</Context.Provider>
}
export const useAuth = () => useContext(Context)
