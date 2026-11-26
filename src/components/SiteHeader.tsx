import { useEffect, useRef, useState, type FocusEvent, type MouseEvent } from 'react'
import { site } from '../content/site'
import { Icon, type IconName } from './Icons'
import { href, track } from './ui'
import { Logo } from './Logo'
import { HeaderIconAction } from './HeaderIconAction'
import { ExperienceNavIcon } from './ExperienceNavIcon'
import { AccountMenu } from './AccountAccess'
import { useReducedMotion } from 'framer-motion'
import { useDrawer } from './drawer-motion'
import { GuestTag } from './GuestTag'
import type { FormatKey } from '../content/site'

const services = [
  { path: '/privatedining/', label: 'Private dinners', description: 'A menu for your table.', format: 'dinner', icon: 'utensils-crossed' },
  { path: '/cookingclasses/', label: 'Cooking classes', description: 'Cook alongside Sergio.', format: 'class', icon: 'chef-hat' },
  { path: '/catering/', label: 'Small events', description: 'A gathering, thoughtfully catered.', format: 'event', icon: 'party-popper' },
] as const

/** Selected Open house header: a nonmodal overview, with booking always in reach. */
export function SiteHeader({ route }: { route: string }) {
  const [open, setOpen] = useState(false)
  const [near, setNear] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const reduce = useReducedMotion()
  const header = useRef<HTMLElement>(null)
  const row = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLElement>(null)
  const opener = useRef<HTMLButtonElement | null>(null)
  const desktopTrigger = useRef<HTMLButtonElement>(null)
  const openMode = useRef<'hover' | 'manual' | null>(null)
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useDrawer(panel, open, !!reduce)
  const secondary: { path: string; label: string; icon: IconName }[] = [
    ...(site.features.sergiosTable ? [{ path: '/sergios-table/', label: 'Sergio’s table', icon: 'armchair' as const }] : []),
    { path: '/about/', label: 'About Sergio', icon: 'book-open' },
    { path: '/gift/', label: 'Gift cards', icon: 'gift' },
  ]

  const close = (restoreFocus = false) => {
    clearTimeout(dismissTimer.current)
    openMode.current = null
    setOpen(false)
    if (restoreFocus) {
      const visible = opener.current?.getClientRects().length ? opener.current :
        [...(header.current?.querySelectorAll<HTMLButtonElement>('[data-site-navigation-toggle]') ?? [])].find(button => button.getClientRects().length)
      visible?.focus({ preventScroll: true })
    }
  }
  const toggle = (event: MouseEvent<HTMLButtonElement>) => {
    clearTimeout(dismissTimer.current)
    opener.current = event.currentTarget
    if (open && openMode.current === 'hover') {
      openMode.current = 'manual'
      return
    }
    if (open) close()
    else { openMode.current = 'manual'; setOpen(true) }
  }

  const leaveHover = () => {
    clearTimeout(dismissTimer.current)
    dismissTimer.current = setTimeout(() => {
      if (openMode.current !== 'hover') return
      const active = document.activeElement
      if (active && (active === desktopTrigger.current || panel.current?.contains(active))) return
      close()
    }, 150)
  }

  useEffect(() => {
    const hover = matchMedia('(hover: hover) and (pointer: fine)')
    const reduced = matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0, x = 0, y = 0, previous = Infinity, cue = false
    const update = () => {
      frame = 0
      const target = desktopTrigger.current
      if (!target || !target.getClientRects().length || !hover.matches || reduced.matches) {
        if (cue) { cue = false; setNear(false) }
        return
      }
      const r = target.getBoundingClientRect()
      const distance = Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom))
      // Anticipate an approaching pointer, with a wider exit band to avoid
      // jitter. The disclosure stays closed until the trigger is hovered.
      const next = distance > 0 && (cue ? distance < 44 : distance < 30 && distance < previous)
      previous = distance
      if (next !== cue) { cue = next; setNear(next) }
    }
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return
      x = event.clientX; y = event.clientY
      if (!frame) frame = requestAnimationFrame(update)
    }
    const reset = () => {
      cancelAnimationFrame(frame); frame = 0; previous = Infinity
      if (cue) { cue = false; setNear(false) }
    }
    const exit = (event: PointerEvent) => { if (!event.relatedTarget) reset() }
    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('pointerout', exit, { passive: true })
    hover.addEventListener('change', reset)
    reduced.addEventListener('change', reset)
    return () => {
      cancelAnimationFrame(frame); clearTimeout(dismissTimer.current)
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerout', exit)
      hover.removeEventListener('change', reset); reduced.removeEventListener('change', reset)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !header.current?.contains(event.target)) close()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault()
        close(!!(document.activeElement && header.current?.contains(document.activeElement)))
      }
    }
    // Any navigation closes the overview at once: a choice in it, a link elsewhere on the page, Back or Forward. The
    // header is not remounted between routes, and a choice of the current page does not change the route at all.
    const navigated = () => close()
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    window.addEventListener('site:navigate', navigated)
    window.addEventListener('popstate', navigated)
    return () => {
      document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape)
      window.removeEventListener('site:navigate', navigated); window.removeEventListener('popstate', navigated)
    }
  }, [open])
  /** A plain activation of any link in the overview (including a call link, or a page outside the in-page router). */
  const chose = (event: MouseEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    if (event.target instanceof Element && event.target.closest('a[href]')) close()
  }

  useEffect(() => {
    // Account for the prototype notice and the mobile browser's changing viewport.
    const measure = () => {
      const main = row.current?.getBoundingClientRect()
      if (!main || !header.current) return
      const height = window.visualViewport?.height ?? window.innerHeight
      const layoutHeight = row.current?.offsetHeight ?? main.height
      let bottom = main.bottom
      if (header.current.closest('[data-arrival-active=true]')) {
        let layoutTop = 0
        for (let node: HTMLElement | null = row.current; node; node = node.offsetParent as HTMLElement | null) layoutTop += node.offsetTop
        bottom = layoutTop + layoutHeight - scrollY
      }
      document.documentElement.style.setProperty('--site-header-height', `${layoutHeight}px`)
      header.current.style.setProperty('--sergio-panel-space', `${Math.max(0, height - Math.max(0, bottom))}px`)
    }
    const resize = new ResizeObserver(measure)
    if (row.current) resize.observe(row.current)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, { passive: true })
    window.visualViewport?.addEventListener('resize', measure)
    measure()
    return () => {
      resize.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure)
      window.visualViewport?.removeEventListener('resize', measure)
      document.documentElement.style.removeProperty('--site-header-height')
    }
  }, [])

  useEffect(() => {
    const breakpoint = window.matchMedia('(max-width: 700px)')
    const change = () => {
      const active = document.activeElement
      const needsFocus = !!(active && (panel.current?.contains(active) || (active === opener.current && !opener.current?.getClientRects().length)))
      close(needsFocus)
    }
    breakpoint.addEventListener('change', change)
    return () => breakpoint.removeEventListener('change', change)
  }, [])

  const focusLeftHeader = (event: FocusEvent<HTMLElement>) => {
    if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) close()
  }
  const trigger = (mobile: boolean) => (
    <button type="button" className={`sergio-header-toggle${mobile ? ' sergio-header-mobile-toggle' : ''}`}
      ref={mobile ? undefined : desktopTrigger}
      data-site-navigation-toggle aria-expanded={open} aria-controls="site-navigation-overview"
      data-experience-near={!mobile && near || undefined}
      data-current={services.some(service => service.path === route) || undefined} onClick={toggle}
      onPointerEnter={event => {
        if (mobile || event.pointerType !== 'mouse' || !matchMedia('(hover: hover) and (pointer: fine)').matches) return
        clearTimeout(dismissTimer.current)
        setHovered(true)
        opener.current = event.currentTarget
        if (!openMode.current) { openMode.current = 'hover'; setOpen(true) }
      }}
      onPointerLeave={() => { if (!mobile) { setHovered(false); leaveHover() } }}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}>
      <ExperienceNavIcon mobile={mobile} active={open || !mobile && (focused || near || hovered)} reduced={!!reduce} />
      <span>{mobile ? 'Explore' : 'Experiences'}</span>
    </button>
  )

  return (
    <header ref={header} data-site-header className={`sergio-header${route === '/' ? ' home-header' : ''}`}
      onBlur={focusLeftHeader} onKeyDown={event => {
        if (event.key === 'Escape' && open) { event.preventDefault(); close(true) }
      }}>
      <div className="sergio-header-main" ref={row}>
        <a className="sergio-header-brand" href={href('/')} aria-label={`${site.name} — Home`}>
          <Logo variant="responsive" decorative />
        </a>
        <nav className="sergio-header-desktop" aria-label="Main">
          {trigger(false)}
          {secondary.map(link => (
            <a key={link.path} href={href(link.path)} aria-current={route === link.path ? 'page' : undefined}><Icon name={link.icon} size={17} /><span>{link.label}</span></a>
          ))}
          <AccountMenu navigationOpen={open} onOpen={() => close()}/>
        </nav>
        <div className="sergio-header-controls">
          <HeaderIconAction kind="link" icon="calendar-days" label="Start planning" emphasis="primary"
            className="sergio-header-cta" href={href('/book/')} current={route === '/book/'} booking
            onClick={() => track('cta_check_date', { where: 'header' })} />
          {trigger(true)}
        </div>
      </div>
      <section id="site-navigation-overview" ref={panel} className="sergio-header-overview" hidden={!open} aria-labelledby="site-navigation-title" onClick={chose}
        onPointerEnter={event => { if (event.pointerType === 'mouse') clearTimeout(dismissTimer.current) }}
        onPointerLeave={event => { if (event.pointerType === 'mouse') leaveHover() }}>
        <div className="sergio-header-overview-inner">
          <div className="sergio-header-overview-heading">
            <p id="site-navigation-title">A good reason to gather.</p>
            <HeaderIconAction kind="button" icon="x" label="Close navigation" closesNavigation onClick={() => close(true)} />
          </div>
          <nav aria-label="Experiences">
            <div className="sergio-header-experiences">
              {services.map(service => (
                <a key={service.path} href={href(service.path)} aria-current={route === service.path ? 'page' : undefined}>
                  <span className="sergio-header-service-heading">
                    <span className="sergio-header-service-title"><Icon name={service.icon} size={22} />{service.label}</span>
                    <GuestTag format={service.format as FormatKey} />
                  </span>
                  <span className="sergio-header-service-description">{service.description}</span>
                  <span className="sergio-header-service-action">Discover more<Icon name="arrow-right" size={15} /></span>
                </a>
              ))}
            </div>
          </nav>
          <div className="sergio-header-overview-bottom">
            <nav aria-label="More pages">
              <a href={href('/')} aria-current={route === '/' ? 'page' : undefined}><Icon name="home" size={17} />Home</a>
              {secondary.map(link => <a key={link.path} href={href(link.path)} aria-current={route === link.path ? 'page' : undefined}><Icon name={link.icon} size={17} />{link.label}</a>)}
            </nav>
            <HeaderIconAction kind="link" icon="phone" label={`Call Sergio at ${site.phone}`} href={site.phoneHref}
              onClick={() => track('cta_call', { where: 'header_overview' })} />
          </div>
        </div>
      </section>
      <noscript><nav className="sergio-header-fallback" aria-label="Site navigation">
        {[...services, ...secondary].map(link => <a key={link.path} href={href(link.path)} aria-current={route === link.path ? 'page' : undefined}><Icon name={link.icon} size={17} />{link.label}</a>)}
        <HeaderIconAction kind="link" icon="phone" label={`Call Sergio at ${site.phone}`} href={site.phoneHref} />
      </nav></noscript>
    </header>
  )
}
