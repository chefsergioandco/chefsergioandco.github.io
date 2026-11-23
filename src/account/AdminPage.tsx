import './AccountPages.css'
import { useEffect, useState, type ComponentType } from 'react'
import { useAuth } from './AuthProvider'
import { getAccessToken } from './auth-client'
import { accountConfig, signInHref } from './config'
import { navigateAccount } from './navigation'
import { AccountFrame } from './AccountFrame'
export function AdminPage() {
  const { state } = useAuth(), [Portal, setPortal] = useState<ComponentType | null>(null), [error, setError] = useState('')
  useEffect(() => { if (state.kind !== 'authenticated' || !state.identity.isAdmin) return; let active = true
    void import('../../admin/src/spa-entry').then(module => {
      module.configureAdminApi({ apiBase: accountConfig.apiOrigin + '/api/spa', getAccessToken, onUnauthorized: () => navigateAccount(signInHref('/admin/')), navigation: { signInUrl: signInHref('/admin/'), accountUrl: '/dashboard/', signOutUrl: '/auth/logout/' } })
      if (active) setPortal(() => module.AdminPortal)
    }).catch(() => { if (active) setError('The admin workspace could not be opened. Reload this page to try again.') })
    return () => { active = false }
  }, [state])
  if (state.kind === 'authenticated' && state.identity.isAdmin && Portal) return <Portal/>
  return <AccountFrame><section className="arrival"><p className="eyebrow">Chef Sergio &amp; Co.</p><h1>Admin dashboard.</h1>{state.kind === 'loading' || state.kind === 'authenticated' && state.identity.isAdmin && !error ? <p role="status" className="introduction">Opening your workspace…</p> : state.kind === 'authenticated' ? <><p className="introduction">This account does not have access to the admin dashboard.</p><a className="button" href="/dashboard/">Your evenings</a></> : <><p className="introduction">Sign in with an authorized account to manage bookings.</p><a className="button" href={signInHref('/admin/')}>Sign in to admin</a></>}{error && <p className="notice error" role="alert">{error}</p>}</section></AccountFrame>
}
