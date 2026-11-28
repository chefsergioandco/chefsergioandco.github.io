import credits from '../content/reference-credits.json'
import { IS_PROTOTYPE, site } from '../content/site'
import { CtaLink } from './CallToAction'
import { href, Photo, track } from './ui'
import { Icon } from './Icons'
import { ExperienceCounter } from './ExperienceCounter'

export const HOME_H1 = 'Dinner at home. Be a guest.'

const photoCredit = (credits as Record<string, { creator: string; landing: string; license_url: string }>)['home-dish']

/** The selected opening: one invitation, with the existing booking flow collecting the details. */
export function HomeHero() {
  return (
    <section className="home-hero" data-home-hero aria-labelledby="home-heading">
      <div className="home-hero-inner">
        <div className="home-hero-copy">
          <p className="home-location">Private chef in Orlando and Central Florida</p>
          <h1 id="home-heading"><span>Dinner at home.</span>{' '}<span>Be a guest.</span></h1>
          <p className="home-description">A menu around your guests. Sergio cooks in your kitchen, serves dinner and leaves it clean. You enjoy the company.</p>
          <div className="home-actions cta-pair">
            <CtaLink emphasis="primary" data-hero-cta href={href('/book/')} onClick={() => track('cta_check_date', { where: 'hero' })}>
              Start planning<Icon name="arrow-up-right" size={18} />
            </CtaLink>
            <CtaLink emphasis="secondary" className="home-experience-link" href="#ways">See how you can gather</CtaLink>
          </div>
          <p className="home-guest-range">Private dinners for {site.formats.dinner.min}–{site.formats.dinner.max} guests.</p>
          <p className="home-experience"><ExperienceCounter /><span>years in<br />restaurant kitchens.</span></p>
        </div>

        <figure className="home-photograph" data-reference-figure="home-dish">
          <div className="home-photo-scene">
            <div className="home-photo-mat">
              <Photo slot="home-dish" alt={IS_PROTOTYPE ? 'Reference photograph of a plated vegetable pastry; not Sergio’s food' : 'A dish prepared by Chef Sergio'} sizes="(min-width: 1700px) 660px, (min-width: 1200px) 40vw, (min-width: 621px) 46vw, 90vw" priority className="home-dish" />
            </div>
            <div className="home-evening-card">
              <p className="home-card-overline">Your evening, taken care of.</p>
              <p className="home-card-title">Cooked.<br />Served.<br />Cleaned up.</p>
              <span className="home-card-rule" aria-hidden="true" />
              <p className="home-card-close">You stay at the table.</p>
            </div>
          </div>
          <figcaption className="home-photo-caption" data-reference-caption="home-dish">
            <span className="home-photo-promise"><span>A personal menu.</span><span>Your own table.</span></span>
            {IS_PROTOTYPE && photoCredit && (
              <span className="home-photo-credit">Reference photo · not Sergio’s food. <a href={photoCredit.landing}>{photoCredit.creator}</a> · <a href={photoCredit.license_url}>CC BY 2.0</a></span>
            )}
          </figcaption>
        </figure>
      </div>
    </section>
  )
}

const gatherings = [
  { type: 'dinner', title: 'Private dinners', description: 'A menu for your table.', action: 'Plan a dinner' },
  { type: 'class', title: 'Cooking classes', description: 'Cook alongside Sergio.', action: 'Plan a class' },
  { type: 'event', title: 'Small event catering', description: 'A gathering, thoughtfully catered.', action: 'Plan an event' },
] as const

export function HomeHandoff() {
  return (
    <section id="ways" className="home-handoff cta-on-dark" data-home-handoff aria-labelledby="home-gather-heading">
      <div className="home-handoff-inner">
        <div className="home-handoff-heading">
          <p>Make room for a good evening.</p>
          <h2 id="home-gather-heading">How would you like to gather?</h2>
        </div>
        <div className="home-gather-options">
          {gatherings.map((g) => (
            <a key={g.type} href={href(`/book/?type=${g.type}`)} className="home-gather-option" data-cta-card data-service-inquiry data-format={g.type} onClick={() => track('cta_service', { type: g.type, where: 'home_handoff' })}>
              <span className="home-option-title">{g.title}</span>
              <span className="home-option-description">{g.description}</span>
              <span className="home-option-action cta-link cta-link--secondary">{g.action}<Icon name="arrow-right" size={15} /></span>
            </a>
          ))}
        </div>
      </div>
    </section>
  )
}
