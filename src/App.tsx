import { useEffect, useLayoutEffect, type ComponentType } from 'react'
const useClientLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect
import { Layout } from './components/Layout'
import { AccountProvider } from './components/AccountAccess'
import { AuthProvider } from './account/AuthProvider'
import { AccountFrame } from './account/AccountFrame'
import { MotionRoot } from './components/motion'
import './styles.css'
import './components/HomeHero.css'
import './components/DishCarousel.css'
import './components/PlatingTimeline.css'
import './pages/About.css'
import './components/SiteNavigation.css'
import './components/SiteFooter.css'
import './components/CallToAction.css'
import './components/linen.css'
import './components/SiteHeader.css'
import './components/SelectedMotion.css'
import './components/NavigationMotion.css'

/** The page component is passed in: the server renders every route; the browser loads only the current route's code. */
export function App({ path, Page }: { path: string; Page: ComponentType }) {
  useClientLayoutEffect(() => { document.documentElement.toggleAttribute('data-admin-route', path === '/admin/') }, [path])
  const account = /^\/(account|dashboard|receipt|auth)(\/|$)/.test(path)
  return <AuthProvider><AccountProvider><MotionRoot>{path === '/status/' || path.startsWith('/invitation/') ? <Page/> : path.startsWith('/newsletter/') ? <><main id="main"><Page/></main><footer className="newsletter-route-footer"><a href="/book/">Plan an evening with Sergio</a></footer></> : path === '/admin/' ? <Page/> : account ? <AccountFrame route={path}><Page/></AccountFrame> : <Layout route={path}><Page/></Layout>}</MotionRoot></AccountProvider></AuthProvider>
}
