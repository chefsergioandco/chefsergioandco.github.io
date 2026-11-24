import { useEffect, useState, type ReactNode } from 'react'
import { Icon } from '../components/Icons'
import { useAuth } from './AuthProvider'
import { currentReturnTo, signInHref } from './config'
export function AccountFrame({ children, route }: { children: ReactNode; route: string }) {
  const { state } = useAuth(), authenticated = state.kind === 'authenticated'
  const [returnTo, setReturnTo] = useState(route)
  useEffect(() => {
    const update = () => setReturnTo(currentReturnTo())
    update()
    window.addEventListener('site:navigate', update); window.addEventListener('popstate', update); window.addEventListener('hashchange', update)
    return () => { window.removeEventListener('site:navigate', update); window.removeEventListener('popstate', update); window.removeEventListener('hashchange', update) }
  }, [route])
  return <div className="account-shell"><a className="skip" href="#main">Skip to content</a><header className="header"><div className="wrap header-inner"><a className="wordmark" href="/" aria-label="Chef Sergio and Co. home"><img className="wordmark-tone--ink" src="/brand/logo-compact-ink.svg?v=salon-1" width="250" height="39" alt="Chef Sergio & Co."/><img className="wordmark-tone--reverse" src="/brand/logo-compact-reverse.svg?v=salon-1" width="250" height="39" alt="" aria-hidden="true"/></a><nav className="account-navigation" aria-label="Account navigation">{authenticated && state.identity.isAdmin && <a href="/admin/"><Icon name="chef-hat" size={16}/><span>Admin</span></a>}{route !== '/dashboard/' && <a href="/dashboard/"><Icon name="book-open" size={16}/><span>Your evenings</span></a>}<a href={authenticated ? '/auth/logout/' : signInHref(returnTo)}><Icon name="arrow-right" size={16}/><span>{authenticated ? 'Sign out' : 'Sign in'}</span></a></nav></div></header><main id="main" className="wrap">{children}</main><footer className="footer"><div className="wrap footer-inner"><p>Chef Sergio &amp; Co.<br/>Orlando and Central Florida</p><p>A question about your plans?<br/><a href="mailto:hello@chefsergioandco.com">hello@chefsergioandco.com</a><br/>(407) 757-3009</p><p><a href="/book/">Plan an evening</a></p></div></footer></div>
}
