import { StrictMode, useEffect, useState, type ComponentType } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { App } from './App'
import { installScrollNavigation } from './scroll-navigation'

installScrollNavigation()

// Route-level code splitting: each page hydrates with only its own code (the home page never downloads the booking form).
const pages: Record<string, () => Promise<ComponentType>> = {
  '/': () => import('./pages/Home').then((m) => m.Home),
  '/privatedining/': () => import('./pages/Services').then((m) => m.PrivateDining),
  '/cookingclasses/': () => import('./pages/Services').then((m) => m.CookingClasses),
  '/catering/': () => import('./pages/Services').then((m) => m.Catering),
  '/sergios-table/': () => import('./pages/Services').then((m) => m.SergiosTable),
  '/about/': () => import('./pages/About').then((m) => m.About),
  '/book/': () => import('./pages/Services').then((m) => m.Book),
  '/gift/': () => import('./pages/Services').then((m) => m.Gift),
  '/shot-list/': () => import('./pages/ShotList').then((m) => m.ShotList),
  '/book/done/': () => import('./booking/StatusPages').then((m) => m.BookDone),
  '/invitation/': () => import('./invitations/InvitationPage').then((m) => m.InvitationPage),
  '/invitation/preview/': () => import('./invitations/InvitationPage').then((m) => m.InvitationPreview),
  '/newsletter/confirm/': () => import('./components/NewsletterTokenPage').then(m => m.NewsletterConfirm),
  '/newsletter/unsubscribe/': () => import('./components/NewsletterTokenPage').then(m => m.NewsletterUnsubscribe),
  '/dashboard/': () => import('./account/CustomerDashboard').then((m) => m.CustomerDashboard),
  '/receipt/': () => import('./account/ReceiptPage').then((m) => m.ReceiptPage),
  '/admin/': () => import('./account/AdminPage').then((m) => m.AdminPage),
  '/account/sign-in/': () => import('./account/AccountPages').then(m => m.SignIn),
  '/account/create/': () => import('./account/AccountPages').then(m => m.CreateAccount),
  '/account/verify-email/': () => import('./account/AccountPages').then(m => m.VerifyEmail),
  '/account/password-reset/': () => import('./account/AccountPages').then(m => m.PasswordReset),
  '/account/check-email/': () => import('./account/AccountPages').then(m => m.CheckEmail),
  '/account/sign-out/': () => import('./account/AccountPages').then(m => m.SignOut),
  '/auth/logout/': () => import('./account/AccountPages').then(m => m.SignOut),
  '/account/signed-out/': () => import('./account/AccountPages').then(m => m.SignedOut),
  '/auth/callback/': () => import('./account/AccountPages').then(m => m.AuthCallback),
  '/account/callback/': () => import('./account/AccountPages').then(m => m.AuthCallback),
  '/book/pay/': () => import('./booking/StatusPages').then((m) => m.MockCheckout),
}

function RoutedApp({ initialPath, initialPage }: { initialPath: string; initialPage: ComponentType }) {
  const [route, setRoute] = useState({ path: initialPath, Page: initialPage }), [error, setError] = useState('')
  useEffect(() => {
    let request = 0
    const load = async () => {
      const path = location.pathname, loader = pages[path]
      if (!loader) return
      const own = ++request
      try { const Page = await loader(); if (own === request) { setError(''); setRoute({ path, Page }); document.title = path.startsWith('/dashboard/') ? 'Your evenings | Chef Sergio & Co.' : path.startsWith('/account/') || path.startsWith('/admin/') ? 'Your account | Chef Sergio & Co.' : document.title } }
      catch { if (own === request) setError('This page could not be opened. Check your connection and try again.') }
    }
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
      if (!target || target.hasAttribute('download') || target.target || target.hasAttribute('data-native-navigation')) return
      const url = new URL(target.href, location.href)
      if (url.origin !== location.origin || !pages[url.pathname] || (url.pathname === location.pathname && url.search === location.search && url.hash)) return
      event.preventDefault(); history.pushState(null, '', url.pathname + url.search + url.hash); window.dispatchEvent(new Event('site:navigate')); scrollTo(0, 0)
    }
    document.addEventListener('click', click); window.addEventListener('site:navigate', load); window.addEventListener('popstate', load)
    // A callback child can navigate during its first effect, before this parent effect installs.
    if (location.pathname !== initialPath) void load()
    return () => { ++request; document.removeEventListener('click', click); window.removeEventListener('site:navigate', load); window.removeEventListener('popstate', load) }
  }, [])
  return <>{error && <p role="alert" className="notice">{error} <a href={location.href} data-native-navigation>Reload page</a></p>}<App path={route.path} Page={route.Page}/></>
}
const root = document.getElementById('root')!
const path = root.dataset.route || '/'
void pages[path]?.().then(Page => hydrateRoot(root, <StrictMode><RoutedApp initialPath={path} initialPage={Page}/></StrictMode>))
