import * as Accordion from '@radix-ui/react-accordion'
import type { ReactNode } from 'react'
import { site } from '../content/site'
import { Icon } from './Icons'
import { FromPrice, Policy } from './ui'

export type FaqItem = { id: string; q: string; a: ReactNode; plain: string | null }

const p = site.policies
const pr = site.pricing

export const FAQ: Record<string, FaqItem> = {
  cost: {
    id: 'cost',
    q: 'How much does it cost?',
    a: (
      <>
        Private dinners: <FromPrice k="dinnerFromPerGuest" lower />. Cooking classes: <FromPrice k="classFromPerGuest" lower />. Small events:{' '}
        <FromPrice k="eventFromPerGuest" lower />. A planning deposit may be requested before the menu interview. Your final menu and price follow the spending ceiling you agree with Sergio; the deposit is credited toward the event bill.
      </>
    ),
    plain: pr.dinnerFromPerGuest
      ? `Private dinners start at $${pr.dinnerFromPerGuest} per guest. A planning deposit may be requested before the menu interview. Your final menu and price follow the spending ceiling you agree with Sergio; the deposit is credited toward the event bill.`
      : null,
  },
  included: {
    id: 'included',
    q: "What's included?",
    a: (
      <>
        Menu planning with you, cooking in your kitchen, plating, serving at the table, and cleanup. Groceries:{' '}
        <Policy k="groceries" need="included, or billed at cost?" />. For small events, tablecloths, napkins, dinnerware, silverware,
        glassware, centerpieces and service staff are included too.
      </>
    ),
    plain: p.groceries
      ? `Menu planning, cooking in your kitchen, plating, serving and cleanup. Groceries: ${p.groceries}.`
      : null,
  },
  dietary: {
    id: 'dietary',
    q: 'Can you cook for allergies and dietary needs?',
    a: <>Yes. Every menu is written around your guests, including allergies and dietary needs. Tell us about them in your request.</>,
    plain: 'Yes. Every menu is written around your guests, including allergies and dietary needs.',
  },
  ingredients: {
    id: 'ingredients',
    q: 'What ingredients do you use?',
    a: <>Organic ingredients, no seed oils, and nothing frozen. Everything is cooked fresh in your kitchen when possible.</>,
    plain: 'Organic ingredients, no seed oils, and nothing frozen. Everything is cooked fresh in your kitchen when possible.',
  },
  kitchen: {
    id: 'kitchen',
    q: 'What do I need in my kitchen?',
    a: <Policy k="kitchen" need="what the client's kitchen must have, and what Sergio brings" />,
    plain: p.kitchen,
  },
  area: {
    id: 'area',
    q: 'Where do you travel?',
    a: (
      <>
        Homes across {site.area}. <Policy k="travel" need="radius in miles, and any travel fee beyond it" />
      </>
    ),
    plain: p.travel ? `Homes across ${site.area}. ${p.travel}` : null,
  },
  ahead: {
    id: 'ahead',
    q: 'How far ahead should I book?',
    a: <>The booking calendar shows dates that fit Sergio’s saved working days and notice period. If your date is not listed, contact Sergio to discuss it.</>,
    plain: 'The booking calendar shows dates that fit Sergio’s saved working days and notice period. If your date is not listed, contact Sergio to discuss it.',
  },
  deposit: {
    id: 'deposit',
    q: 'How do I pay, and what if plans change?',
    a: (
      <>
        The booking form states whether you are sending a request or continuing to online payment. When checkout is available, review the deposit or seat payment and the cancellation terms before paying. A private-event deposit is credited toward the event bill; your menu and final price follow the interview and agreed spending ceiling. Contact Sergio if your plans change.
      </>
    ),
    plain: 'The booking form states whether you are sending a request or continuing to online payment. When checkout is available, review the deposit or seat payment and the cancellation terms before paying. A private-event deposit is credited toward the event bill; your menu and final price follow the interview and agreed spending ceiling. Contact Sergio if your plans change.',
  },
  tip: {
    id: 'tip',
    q: 'Should I tip?',
    a: <Policy k="gratuity" need="gratuity policy" />,
    plain: p.gratuity,
  },
}

if (site.features.vacationRentals) {
  FAQ.rentals = {
    id: 'rentals',
    q: 'Can Sergio cook at our vacation rental?',
    a: (
      <>
        Yes. Choose "A vacation rental" when you check your date and give the community or area. Rental kitchens vary, so Sergio confirms what the kitchen has before the day.{' '}
        <Policy k="kitchen" need="what Sergio checks about a rental kitchen, and what he brings" />
      </>
    ),
    plain: null,
  }
}
if (site.features.sergiosTable) {
  FAQ.table = {
    id: 'table',
    q: "What is Sergio's table?",
    a: <>Some evenings Sergio hosts at his own home: one menu, one shared table. Browse published evenings for the date, menu, price and available seats. When online payment is available, complete checkout to secure your seats; otherwise, send a seat request for Sergio to review. A request alone does not reserve seats. Check the evening’s guest minimum, decision date and current status before booking.</>,
    plain: 'Some evenings Sergio hosts at his own home: one menu, one shared table. Browse published evenings for the date, menu, price and available seats. When online payment is available, complete checkout to secure your seats; otherwise, send a seat request for Sergio to review. A request alone does not reserve seats. Check the evening’s guest minimum, decision date and current status before booking.',
  }
}

export function Faq({ items, title = 'Questions people ask' }: { items: (FaqItem | undefined)[]; title?: string }) {
  const list = items.filter((x): x is FaqItem => !!x)
  return (
    <section aria-labelledby="faq" className="wrap py-16 md:py-24">
      <h2 id="faq" className="text-3xl md:text-4xl">
        {title}
      </h2>
      <Accordion.Root type="multiple" className="mt-8 max-w-3xl border-t border-rule">
        {list.map((f) => (
          <Accordion.Item key={f.id} value={f.id} className="border-b border-rule">
            <Accordion.Header>
              <Accordion.Trigger className="group flex w-full items-center justify-between gap-6 py-5 text-left font-display text-xl transition-colors hover:text-ink-muted">
                {f.q}
                <Icon name="plus" size={20} className="shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-45" />
              </Accordion.Trigger>
            </Accordion.Header>
            {/* forceMount keeps answers in the prerendered HTML for search engines; hidden until opened. */}
            <Accordion.Content forceMount className="faq-a pb-6 pr-10 text-ink-muted data-[state=closed]:hidden">
              {f.a}
            </Accordion.Content>
          </Accordion.Item>
        ))}
      </Accordion.Root>
    </section>
  )
}

export function faqJsonLd(items: FaqItem[]) {
  const done = items.filter((f) => f.plain)
  if (!done.length) return null
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: done.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.plain } })),
  }
}
