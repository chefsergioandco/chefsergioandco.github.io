import { Faq, FAQ } from '../components/Faq'
import { HomeHandoff, HomeHero } from '../components/HomeHero'
import { PlatingTimeline } from '../components/PlatingTimeline'
import { CtaLink } from '../components/CallToAction'
import { href, Photo } from '../components/ui'
import { DishCarousel } from '../components/DishCarousel'
import { DeferredImage } from '../components/DeferredImage'
import { sergioPortrait } from '../content/portrait'
import { site } from '../content/site'
import { HomeGift } from '../components/HomeGift'
import { HomeReviews } from '../components/HomeReviews'

export function Home() {
  return (
    <>
      <HomeHero />
      <HomeHandoff />

      <PlatingTimeline />

      <DishCarousel />

      <section aria-labelledby="standards" className="bg-canvas">
        <div className="wrap grid grid-cols-1 gap-10 py-16 md:grid-cols-2 md:items-center md:py-24">
          <div>
            <h2 id="standards" className="text-3xl md:text-4xl">
              Organic ingredients. No seed oils. Nothing frozen.
            </h2>
            <p className="mt-4 max-w-prose text-lg text-ink-muted">Ingredients are chosen for your event and cooked fresh, on site in your kitchen whenever possible</p>
          </div>
          <Photo slot="mise-en-place" alt="Reference: fresh ingredients prepared before cooking" sizes="(min-width: 768px) 50vw, 100vw" className="aspect-square w-full rounded-card" defer />
        </div>
      </section>

      <section aria-labelledby="meet" className="home-meet wrap grid grid-cols-1 gap-10 py-16 md:grid-cols-[minmax(0,min(20rem,35%))_minmax(0,1fr)] md:items-center md:py-24">
        <figure data-placeholder-figure={sergioPortrait.placeholder} data-tbd="photo.sergio-portrait">
          <DeferredImage src={href(sergioPortrait.src)} srcSet={sergioPortrait.sources.map(source => `${href(source.src)} ${source.width}w`).join(', ')}
            width={sergioPortrait.width} height={sergioPortrait.height} alt={sergioPortrait.alt}
            sizes="(min-width: 768px) 20rem, calc(100vw - 2rem)" loading="lazy" decoding="async"
            className="aspect-[4/5] w-full rounded-card object-cover" data-placeholder={sergioPortrait.placeholder} />
          <figcaption className="mt-3 font-ui text-xs text-ink-muted">{sergioPortrait.caption}</figcaption>
        </figure>
        <div className="max-w-prose">
          <h2 id="meet" className="text-3xl md:text-4xl">
            Meet Sergio
          </h2>
          <p className="mt-4 text-lg">
            Four decades in restaurant kitchens taught Sergio that a great dinner takes more than a well-made plate: attention to detail, respect for ingredients and real hospitality. He started Chef Sergio &amp; Co. to bring that into people's homes.
          </p>
          <ul className="mt-6 space-y-1 text-ink-muted">
            {site.credentials.map((c) => (
              <li key={c.body}>
                {c.body}, {c.title}, {c.year}
              </li>
            ))}
          </ul>
          <CtaLink emphasis="secondary" href={href('/about/')} className="mt-6">
            Read Sergio's story
          </CtaLink>
        </div>
      </section>

      <HomeReviews />

      <HomeGift />

      <Faq items={[FAQ.cost, FAQ.included, FAQ.rentals, FAQ.dietary, FAQ.area, FAQ.ahead, FAQ.deposit].filter(Boolean)} />
    </>
  )
}
