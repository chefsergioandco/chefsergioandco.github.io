import { useEffect, useState, type ReactNode } from 'react'
import { IS_PROTOTYPE, LOOK, LOOKS, type Look } from '../content/site'
import { track } from './ui'
import { SiteHeader } from './SiteHeader'
import { SiteFooter } from './SiteFooter'
import { HomeDepth } from './HomeDepth'

/** Prototype only: switch between the three looks. State lives on <html data-look> so CSS can swap tokens instantly. */
function LookSwitcher() {
  const [look, setLook] = useState<Look>('c')
  useEffect(() => setLook((document.documentElement.dataset.look as Look) || 'c'), [])
  const choose = (l: Look) => {
    setLook(l)
    document.documentElement.dataset.look = l
    try {
      localStorage.setItem('look', l)
    } catch {
      /* private mode: the switch still works for this page */
    }
    const u = new URL(window.location.href)
    u.searchParams.set('look', l)
    history.replaceState(null, '', u)
    track('look_switch', { look: l })
  }
  const i = LOOKS.findIndex((l) => l.id === look)
  return (
    <div role="radiogroup" aria-label="Design look" className="relative grid grid-cols-3 rounded-full bg-ink/10 p-1">
      <span aria-hidden className="pointer-events-none absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/3)] rounded-full bg-paper shadow transition-transform duration-300 ease-[var(--ease)]" style={{ transform: `translateX(${i * 100}%)` }} />
      {LOOKS.map((l) => (
        <button key={l.id} role="radio" aria-checked={look === l.id} onClick={() => choose(l.id)} title={l.bet} className="relative z-[1] min-h-[32px] whitespace-nowrap rounded-full px-3 text-xs font-medium text-ink">
          {l.id.toUpperCase()} {l.name}
        </button>
      ))}
    </div>
  )
}

export function Layout({ route, children }: { route: string; children: ReactNode }) {
  const content = (
    <>
      <a href="#main" data-skip-link className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-paper focus:p-3">
        Skip to content
      </a>
      {IS_PROTOTYPE && route === '/about/' && <section aria-label="Prototype notice" className="about-prototype-notice">Page preview. Portrait, archive photographs and certificate scans are still to come.</section>}
      {IS_PROTOTYPE && route !== '/about/' && (
        <section aria-label="Prototype notice" className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 bg-rule px-4 py-2 text-center font-sans text-sm text-ink">
          <span>
            Prototype. Photos are labelled references; <mark className="tbd">striped</mark> items are Sergio's decisions.
          </span>
          {LOOK === 'all' && <LookSwitcher />}
        </section>
      )}
      <SiteHeader route={route} />
      {route === '/' ? (
        <HomeDepth><main id="main">{children}</main><SiteFooter /></HomeDepth>
      ) : (
        <><main id="main">{children}</main><SiteFooter /></>
      )}
    </>
  )
  return route === '/about/' ? <div className="about-shell">{content}</div> : content
}
