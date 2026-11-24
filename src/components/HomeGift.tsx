import { CtaLink } from './CallToAction'
import { MenuCard } from './MenuCard'
import { href, track } from './ui'
import { site } from '../content/site'

const OCCASIONS = ['Birthdays', 'Anniversaries', 'Holidays', 'Thank-yous', 'Housewarmings']
// The gift page's journey, ending on what the recipient actually gets: Sergio cooking for them.
const STEPS: [string, string][] = [
  ['Choose the gift', 'A contribution toward a private dinner or a cooking class. Talk it through with Sergio.'],
  ['They make it theirs', 'The recipient tells Sergio the occasion and asks for an open date.'],
  ['Sergio cooks for them', 'He plans the menu around their guests, cooks in their kitchen and leaves it clean.'],
]

/** The homepage's gift section: what the gift is, who it suits and how it works. Online checkout replaces the
 * gift-page link only once a checkout link is set in site.ts. */
export function HomeGift() {
  const url = site.hooks.giftCardUrl
  return (
    <section className="wrap py-16 md:py-24" aria-labelledby="home-gift-heading">
      <div className="grid grid-cols-1 items-center gap-12 border-t border-rule pt-12 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] md:gap-16 md:pt-16">
        <div className="min-w-0">
          <p className="font-display text-lg italic text-ink-muted">an evening to give</p>
          <h2 id="home-gift-heading" className="mt-2 text-4xl sm:text-5xl">Give someone an evening.</h2>
          <p className="mt-5 max-w-prose text-lg text-ink-muted">
            A private dinner or a cooking class with Sergio, in their own kitchen. They choose the date and the guests; he writes the menu around them, serves it and clears up.
          </p>
          <ul className="mt-6 flex flex-wrap gap-2" aria-label="Good for">
            {OCCASIONS.map((occasion) => (
              <li key={occasion} className="rounded-btn border border-rule px-3 py-1 text-sm">{occasion}</li>
            ))}
          </ul>
          <ol className="mt-10 grid gap-6 sm:grid-cols-3">
            {STEPS.map(([step, detail], index) => (
              <li key={step} className="min-w-0 border-t border-ink/20 pt-4">
                <p className="text-sm tabular-nums text-ink-muted">{index + 1}</p>
                <h3 className="mt-1 font-display text-xl">{step}</h3>
                <p className="mt-2 text-sm text-ink-muted">{detail}</p>
              </li>
            ))}
          </ol>
          <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3">
            {url ? (
              <CtaLink emphasis="primary" href={url} onClick={() => track('gift_checkout', { where: 'home' })}>Buy a gift card</CtaLink>
            ) : (
              <CtaLink emphasis="primary" href={href('/gift/')} onClick={() => track('cta_gift', { where: 'home' })}>Give an evening</CtaLink>
            )}
            <a className="link text-sm" href={site.phoneHref}>Or call Sergio, {site.phone}</a>
          </div>
        </div>
        <figure className="mx-auto w-full max-w-sm">
          <MenuCard data={{ format: 'dinner', occasion: 'Anniversary', guests: 2, dishes: ['Lobster Bisque', 'Beef Stroganoff'] }} className="md:-rotate-1" />
          <figcaption className="mt-4 text-center text-sm text-ink-muted">A sample menu card. Theirs is written around them.</figcaption>
        </figure>
      </div>
    </section>
  )
}
