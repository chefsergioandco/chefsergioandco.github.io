import type { ReactNode } from 'react'
import { BookingForm } from '../components/BookingForm'
import { Faq, FAQ } from '../components/Faq'
import { DinnerMenuCard } from '../invitations/DinnerMenuCard'
import { SAMPLE_DINNER_MENU } from '../invitations/menu-sample'
import { CtaLink } from '../components/CallToAction'
import { Icon } from '../components/Icons'
import { FromPrice, href, Photo, Policy, TBD, track } from '../components/ui'
import { dishes } from '../content/menu'
import { booking } from '../content/booking'
import { site } from '../content/site'
import { TableNightsLive } from '../booking/StatusPages'

function PageHero({ title, lead, slot, alt, cta, ctaHref, price }: { title: string; lead: ReactNode; slot: string; alt: string; cta: string; ctaHref: string; price?: ReactNode }) {
  return (
    <section>
      <div className="apron" />
      <div className="wrap grid grid-cols-1 gap-10 py-12 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:items-center md:py-20">
        <div>
          <h1 className="text-4xl sm:text-5xl">{title}</h1>
          <p className="mt-5 max-w-prose text-lg text-ink-muted">{lead}</p>
          {price && (
            <p data-price-line className="mt-4 font-medium">
              {price}
            </p>
          )}
          <div className="cta-pair mt-8">
            <CtaLink emphasis="primary" data-hero-cta href={/^https?:/.test(ctaHref) ? ctaHref : href(ctaHref)} onClick={() => track('cta_check_date', { where: 'page_hero' })}>
              {cta}
            </CtaLink>
            <CtaLink emphasis="secondary" href={site.phoneHref}>
              Call {site.phone}
            </CtaLink>
          </div>
        </div>
        <Photo slot={slot} alt={alt} priority sizes="(min-width: 768px) 45vw, 100vw" className="aspect-[3/2] w-full rounded-card" />
      </div>
    </section>
  )
}

function Included({ title, items }: { title: string; items: ReactNode[] }) {
  return (
    <section className="bg-paper py-14 md:py-20">
      <div className="wrap">
        <h2 className="text-3xl">{title}</h2>
        <ul className="mt-8 grid max-w-4xl gap-x-10 gap-y-4 sm:grid-cols-2">
          {items.map((it, i) => (
            <li key={i} className="border-l-2 border-cta pl-4">
              {it}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

const whereLine = `In your home${site.features.vacationRentals ? ' or a vacation rental' : ''}, anywhere across ${site.area}.`

export function PrivateDining() {
  return (
    <>
      <PageHero
        title={`Private dinners for ${site.formats.dinner.min} to ${site.formats.dinner.max}, cooked in your kitchen.`}
        lead={<>Not a fixed menu. Your menu. Tell Sergio what you love, what you're celebrating and who's coming, and he writes the menu around it. {whereLine}</>}
        slot="guests-at-table"
        alt="Reference: guests at a dinner table mid-meal"
        cta="Plan a dinner"
        ctaHref="/book/?type=dinner"
        price={<FromPrice k="dinnerFromPerGuest" />}
      />
      <Included
        title="What's included"
        items={[
          'A seasonal menu written around your guests, their tastes and any dietary needs',
          'Every course prepared fresh in your kitchen and plated at the table',
          'Organic ingredients, no seed oils, nothing frozen',
          'Setup, service and cleanup, so you stay with your guests',
          <>Groceries: <Policy k="groceries" need="included, or billed at cost?" /></>,
          <>What your kitchen needs: <Policy k="kitchen" need="equipment list" /></>,
        ]}
      />
      <section className="wrap grid grid-cols-1 gap-10 py-14 md:grid-cols-[minmax(0,1fr)_minmax(0,min(22rem,45%))] md:items-center md:py-20">
        <div className="max-w-prose">
          <h2 className="text-3xl">Good for</h2>
          <p className="mt-4 text-lg text-ink-muted">Birthdays and anniversaries, a holiday at home, a dinner for clients, a family trip in a rented house, or a Saturday with friends that deserves more than takeout.</p>
          <h2 className="mt-10 text-3xl">Dishes clients can ask for</h2>
          <ul className="mt-4 space-y-1 font-display text-xl">
            {dishes.map((d) => (
              <li key={d.name} data-menu-item>
                {d.name}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <DinnerMenuCard document={SAMPLE_DINNER_MENU} />
          <p className="mt-5 text-sm leading-relaxed text-ink-muted">A menu designed for the table. This typesetting specimen shows the format; its occasion, course order and descriptions are illustrative. Sergio agrees your actual menu and any dietary accommodations with you.</p>
        </div>
      </section>
      <Faq items={[FAQ.cost, FAQ.included, FAQ.kitchen, FAQ.rentals, FAQ.dietary, FAQ.deposit, FAQ.tip]} />
    </>
  )
}

export function CookingClasses() {
  return (
    <>
      <PageHero
        title="Cook with Sergio in your own kitchen."
        lead={<>Hands-on lessons from a chef with forty years of restaurant experience. Learn techniques you'll keep using, then sit down together and eat what you made. {whereLine}</>}
        slot="class-hands"
        alt="Reference: hands learning a technique at a kitchen counter"
        cta="Plan a class"
        ctaHref={site.hooks.classBookingUrl ?? '/book/?type=class'}
        price={<FromPrice k="classFromPerGuest" />}
      />
      <Included
        title="How a class works"
        items={[
          <>Format: <Policy k="classFormat" need="length, group size, and what a typical class covers" /></>,
          'You choose what to learn, from his dishes or something you have always wanted to master',
          'Everyone cooks: knives, pans and plating, not just watching',
          'You eat what you made together at the end',
        ]}
      />
      <section className="wrap py-14 md:py-20">
        <div className="grid gap-6 md:grid-cols-2">
          {[
            ['Date night', 'Two people, one evening, a menu you can make again.'],
            ['Friends and family', 'A birthday or a get-together where the cooking is the activity.'],
            ['Teens and new cooks', 'Basics done right: knife work, heat, seasoning.'],
            ['Team gatherings', 'A small group cooking together.'],
          ].map(([t, b]) => (
            <div key={t} className="border-t border-rule pt-5">
              <h2 className="text-2xl">{t}</h2>
              <p className="mt-2 text-ink-muted">{b}</p>
            </div>
          ))}
        </div>
        <p className="mt-10">
          A class makes a good gift.{' '}
          <a href={href('/gift/')} className="link">
            Buy a cooking class gift card.
          </a>
        </p>
      </section>
      <Faq items={[FAQ.cost, FAQ.kitchen, FAQ.dietary, FAQ.ahead, FAQ.deposit]} />
    </>
  )
}

export function Catering() {
  return (
    <>
      <PageHero
        title={`Small events for ${site.formats.event.min} to ${site.formats.event.max} guests, fully catered.`}
        lead="Menu, staff and a fully set table, arranged so you can host and enjoy the party at the same time."
        slot="catering-table"
        alt="Reference: a table set with linens, glassware and a centerpiece"
        cta="Request a proposal"
        ctaHref="/book/?type=event"
        price={<FromPrice k="eventFromPerGuest" />}
      />
      <Included
        title="One proposal covers everything"
        items={[
          'A menu designed around your occasion, preferences and guests',
          'Organic ingredients, no seed oils, nothing frozen, cooked on site when possible',
          'Tablecloths, napkins, dinnerware, silverware, glassware and centerpieces',
          'Professional staff to look after your guests',
          'An all-inclusive quote: menu, table, staffing and event needs in one price',
        ]}
      />
      <section className="wrap py-14 md:py-20">
        <h2 className="text-3xl">For gatherings like these</h2>
        <ul className="mt-6 flex flex-wrap gap-3">
          {['Intimate celebrations', 'Family gatherings', 'Birthdays and anniversaries', 'Client entertaining', 'Special occasions'].map((o) => (
            <li key={o} className="rounded-full border border-ink/25 px-4 py-2">
              {o}
            </li>
          ))}
        </ul>
        <h2 className="mt-12 text-3xl">Dishes from past menus</h2>
        <ul tabIndex={0} aria-label="Dishes from past menus" className="-mx-4 mt-6 flex snap-x gap-4 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-5 md:overflow-visible md:px-0 md:pb-0">
          {dishes.map((d) => (
            <li key={d.name} className="w-[42%] shrink-0 snap-start md:w-auto">
              {d.slot && <Photo slot={d.slot} alt={`Reference photo for ${d.name}`} sizes="(min-width: 768px) 20vw, 50vw" className="aspect-[4/5] w-full rounded-card" />}
              <p className="mt-2 font-display text-lg" data-menu-item>
                {d.name}
              </p>
            </li>
          ))}
        </ul>
      </section>
      <Faq items={[FAQ.cost, FAQ.included, FAQ.area, FAQ.ahead, FAQ.deposit]} />
    </>
  )
}

/** Sergio's table: shared seats on nights he publishes in his calendar (docs/BOOKING.md §5). Airbnb appears only here. */
export function SergiosTable() {
  return (
    <>
      <PageHero
        title="Dinner at Sergio's table."
        lead="Some evenings Sergio opens his own table: one menu, one shared table at his home. Browse the evenings he has published and request seats. Sergio reviews each request before confirming."
        slot="sergios-table"
        alt="Reference: a dining table set in a home dining room"
        cta="See upcoming nights"
        ctaHref="/sergios-table/#nights"
        price={<FromPrice k="tableFromPerGuest" unit="per seat" />}
      />
      <section id="nights" aria-labelledby="nights-h" className="wrap scroll-mt-24 py-14 md:py-20">
        <h2 id="nights-h" className="text-3xl">
          Upcoming nights
        </h2>
        <div className="mt-8">
          <TableNightsLive />
        </div>
      </section>
      <Included
        title="How it works"
        items={[
          'Each night has one menu, written by Sergio, served at a shared table in his home',
          `Book 1 to ${booking.table.maxSeatsPerBooking} seats. For a bigger group, book the whole table as a private dinner`,
          'Request seats without entering a card. Sergio reviews your request before reserving your places',
          'If plans change or the minimum is at risk, Sergio reviews the evening and contacts the guests',
          <>Before the first paid guest: <Policy k="hostingCheck" need="confirm Florida food-service licensing (DBPR) and home insurance cover paying guests" /></>,
        ]}
      />
      <section className="wrap py-14 md:py-20">
        <div className="max-w-prose">
          <h2 className="text-3xl">Visiting Orlando?</h2>
          {site.hooks.airbnbExperienceUrl ? (
            <p className="mt-4 text-lg text-ink-muted">
              Sergio's table is also listed on{' '}
              <a className="link" href={site.hooks.airbnbExperienceUrl}>
                Airbnb Experiences
              </a>
              , if you'd rather book there.
            </p>
          ) : (
            <p className="mt-4">
              Request seats here and Sergio will contact you about the evening.
            </p>
          )}
        </div>
      </section>
      <Faq items={[FAQ.table, FAQ.cost, FAQ.dietary, FAQ.deposit]} />
    </>
  )
}

export function Book() {
  return (
    <section className="wrap py-10 md:py-16">
      <p className="booking-eyebrow">Your next gathering</p>
      <h1 className="mt-3 text-4xl sm:text-5xl">Book with Sergio</h1>
      <p className="mt-3 max-w-prose text-lg text-ink-muted">
        Start with what you know. Share your gathering, your people and your ideas; Sergio will help settle the rest in a personal conversation. Prefer to talk?{' '}
        <a href={site.phoneHref} className="link">
          Call {site.phone}
        </a>
        .
      </p>
      <div className="mt-10">
        <BookingForm />
      </div>
    </section>
  )
}

