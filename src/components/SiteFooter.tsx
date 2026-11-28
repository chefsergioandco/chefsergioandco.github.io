import { SeasonalLetter } from './SeasonalLetter'
import { useEffect, useState } from 'react'
import { IS_PROTOTYPE, site } from '../content/site'
import { Icon } from './Icons'
import { CtaLink } from './CallToAction'
import { href, track } from './ui'
import { Logo } from './Logo'
import { AppearanceControl } from './AppearanceControl'
import { useOnceVisible } from './useOnceVisible'
import { FooterAccount } from './AccountAccess'

const experiences = [
  { path: '/privatedining/', label: 'Private dinners', icon: 'utensils-crossed' },
  { path: '/cookingclasses/', label: 'Cooking classes', icon: 'chef-hat' },
  { path: '/catering/', label: 'Small event catering', icon: 'party-popper' },
  ...(site.features.sergiosTable ? [{ path: '/sergios-table/', label: "Sergio’s table", icon: 'armchair' } as const] : []),
] as const

/** Each footer moment finishes permanently, including when motion preferences change. */
function useFooterMotionSettlement(entered: boolean) {
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    if (!entered || settled) return
    const preference = matchMedia('(prefers-reduced-motion: reduce)')
    const settle = () => setSettled(true)
    if (preference.matches) { settle(); return }
    const timer = window.setTimeout(settle, 1200)
    const preferenceChanged = () => { if (preference.matches) settle() }
    preference.addEventListener('change', preferenceChanged)
    return () => {
      window.clearTimeout(timer)
      preference.removeEventListener('change', preferenceChanged)
    }
  }, [entered, settled])
  return { settled, finish: () => setSettled(true) }
}

/** A last invitation, then the few routes and contact details a guest may still need. */
export function SiteFooter() {
  const socials = Object.entries(site.social).filter(([, url]) => url) as [string, string][]
  const { ref: invitationRef, entered: invitationEntered } = useOnceVisible<HTMLDivElement>()
  const { ref: ruleRef, entered: ruleEntered } = useOnceVisible<HTMLDivElement>()
  const headlineMotion = useFooterMotionSettlement(invitationEntered)
  const ruleMotion = useFooterMotionSettlement(ruleEntered)

  return (
    <footer className="site-footer cta-on-dark" aria-labelledby="footer-invitation"
      data-footer-entered={(invitationEntered && !headlineMotion.settled) || undefined}
      data-footer-state={headlineMotion.settled ? 'done' : invitationEntered ? 'playing' : 'static'}>
      <div className="site-footer-inner">
        <div className="footer-invitation">
          <div ref={invitationRef} className="footer-invitation-copy">
            <p className="footer-eyebrow">Your next gathering</p>
            <h2 id="footer-invitation"><span>Let’s make</span><span
              onAnimationEnd={event => { if (event.animationName === 'footer-headline-rise') headlineMotion.finish() }}>an evening of it.</span></h2>
            <p className="footer-invitation-note">Your guests. Your occasion.<br />A menu made around you.</p>
          </div>
          <div className="footer-inquiry">
            <p>Start with the occasion.<br />We’ll plan the menu together.</p>
            <CtaLink emphasis="primary" className="footer-inquiry-button" href={href('/book/')} onClick={() => track('cta_check_date', { where: 'footer' })}>
              Start planning<Icon name="arrow-up-right" size={20} />
            </CtaLink>
            <CtaLink emphasis="secondary" className="footer-conversation" href={site.phoneHref} onClick={() => track('cta_call', { where: 'footer' })}>
              <Icon name="phone" size={17} /><span>Or call Sergio</span>
            </CtaLink>
          </div>
        </div>

        <SeasonalLetter/>
        <div className="footer-directory">
          <div ref={ruleRef} className="footer-rule" data-rule-entered={(ruleEntered && !ruleMotion.settled) || undefined}
            data-rule-state={ruleMotion.settled ? 'done' : ruleEntered ? 'playing' : 'static'} aria-hidden="true"
            onAnimationEnd={event => { if (event.animationName === 'footer-rule-draw') ruleMotion.finish() }} />
          <div className="footer-about">
            <a className="footer-brand" href={href('/')} aria-label={`${site.name}, home`}>
              <Logo reversed decorative />
            </a>
            <p>Private dinners, cooking classes and small celebrations. Personal cooking, thoughtful hospitality.</p>
            <p className="footer-area"><Icon name="map-pin" size={17} /><span>{site.area}</span></p>
          </div>

          <nav className="footer-column" aria-label="Footer experiences">
            <h3>Gather with Sergio</h3>
            <ul>
              {experiences.map((item) => (
                <li key={item.path}>
                  <a className="footer-link" href={href(item.path)}><Icon name={item.icon} size={18} /><span>{item.label}</span></a>
                </li>
              ))}
            </ul>
          </nav>

          <nav className="footer-column" aria-label="More about Sergio">
            <h3>A little more</h3>
            <ul>
              <li><a className="footer-link" href={href('/about/')}><Icon name="book-open" size={18} /><span>Sergio’s story</span></a></li>
              <li><a className="footer-link" href={href('/gift/')}><Icon name="gift" size={18} /><span>Give an evening</span></a></li>
              <li><a className="footer-link" href={href('/status/')} data-native-navigation><Icon name="clock" size={18} /><span>Service status</span></a></li>
              {IS_PROTOTYPE && <li><a className="footer-link footer-prototype-link" href={href('/shot-list/')}><Icon name="arrow-up-right" size={18} /><span>Photo plan <small>Prototype</small></span></a></li>}
            </ul>
          </nav>

          <div className="footer-column footer-contact">
            <h3>Talk to Sergio</h3>
            <ul>
              <li><a className="footer-link" href={site.phoneHref}><Icon name="phone" size={18} /><span>{site.phone}</span></a></li>
              <li><a className="footer-link footer-email" href={`mailto:${site.email}`}><Icon name="mail" size={18} /><span>{site.email}</span></a></li>
              {socials.map(([name, url]) => (
                <li key={name}><a className="footer-link" href={url}><Icon name={name === 'instagram' ? 'instagram' : name === 'facebook' ? 'facebook' : 'arrow-up-right'} size={18} /><span>{name.charAt(0).toUpperCase() + name.slice(1)}</span></a></li>
              ))}
            </ul>
          </div>
        </div>

        <FooterAccount/>
        <div className="footer-colophon">
          <p>© {new Date().getFullYear()} {site.name}</p>
          <nav className="footer-legal" aria-label="Legal"><a href={href('/privacy/')} data-native-navigation>Privacy Policy</a><a href={href('/terms/')} data-native-navigation>Terms of Service</a></nav>
          <AppearanceControl/>
          <a href="#main"><span>Back to top</span><Icon name="arrow-up" size={16} /></a>
        </div>
      </div>
    </footer>
  )
}
