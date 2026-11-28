declare const __SITE_MODE__: string
declare const __LOOK__: string
export const SITE_MODE = __SITE_MODE__ as 'prototype' | 'production'
export const IS_PROTOTYPE = SITE_MODE !== 'production'
export type Look = 'a' | 'b' | 'c'
/** 'all' = prototype carrying all three looks with a switcher; otherwise the single look this build ships. */
export const LOOK = __LOOK__ as Look | 'all'
export const LOOKS: { id: Look; name: string; bet: string }[] = [
  { id: 'a', name: 'Menu card', bet: 'The personal menu is the promise' },
  { id: 'b', name: "Chef's whites", bet: 'Trust in the chef sells the evening' },
  { id: 'c', name: 'Evening at home', bet: 'A personal evening, with the cooking taken care of' },
]

/**
 * Every fact on the site lives here. Values marked null are decisions only Sergio can make:
 * in the prototype they render as a visible yellow "to decide" marker; `npm run build:prod`
 * refuses to build while any of them is still null.
 */
export const site = {
  name: 'Chef Sergio & Co.',
  chef: 'Chef Sergio',
  phone: '(407) 757-3009',
  phoneHref: 'tel:+14077573009',
  email: 'hello@chefsergioandco.com',
  area: 'Orlando and Central Florida',
  url: 'https://chefsergioandco.github.io',

  // From his About page, verbatim facts.
  credentials: [
    { body: 'American Culinary Federation', title: 'Culinary Diploma', year: 1993 },
    { body: 'National Capital Chefs Association', title: 'Culinary Diploma, Washington, D.C.', year: 1993 },
  ],
  // From his catering page ("Organic ingredients, no seed oils, never frozen ingredient").
  standards: ['Organic ingredients', 'No seed oils', 'Nothing frozen'],

  formats: {
    dinner: { label: 'Private dinner', min: 2, max: 12 }, // "dinner for two to a gathering of twelve"
    class: { label: 'Cooking class', min: 1, max: 12 }, // range TBD by Sergio
    event: { label: 'Small event catering', min: 8, max: 24 }, // "8–24 Guests"
  },

  // ---- Sergio decides (null = not decided yet) ----
  pricing: {
    dinnerFromPerGuest: null as number | null,
    classFromPerGuest: null as number | null,
    eventFromPerGuest: null as number | null,
    tableFromPerGuest: null as number | null, // dinner or class hosted at Sergio's home
  },
  policies: {
    replyWithin: null as string | null, // e.g. "24 hours"
    deposit: null as string | null, // e.g. "50% deposit"
    cancellation: null as string | null,
    leadTime: null as string | null, // how far ahead to book
    travel: null as string | null, // radius / travel fee
    groceries: null as string | null, // included or billed at cost
    gratuity: null as string | null,
    kitchen: null as string | null, // what the client's kitchen needs
    classFormat: null as string | null, // length, group size, what's taught
    tableFormat: null as string | null, // Sergio's table: private group or shared seats, which nights, how many guests
    hostingCheck: null as string | null, // confirmed with Florida DBPR (food service licensing) + home insurer before paid guests at home
  },

  // ---- Gift cards (docs/GIFT-CARDS.md) ----
  // Florida §501.95: a gift certificate sold in Florida may not expire or carry any post-sale fee, so these
  // cards never do. They are denominated in dollars, never in "a dinner for four", because they must be
  // honoured whenever they are used. The amounts are placeholders until Sergio confirms them; each printed
  // amount is its own foil die if cards are ever made physically.
  gift: {
    amounts: [10000, 15000, 25000, 50000] as number[], // cents; TBD by Sergio
    amountsConfirmed: false,
    // Suggested 2026-11-26 and shown on the page; marked for Sergio until he confirms (build:prod fails until then).
    refunds: 'A card none of which has been used can be refunded within 14 days of purchase, to the card that paid for it.',
    refundsConfirmed: false,
  },

  // ---- Booking & payment hooks (paste URLs; empty = feature shows as "not connected") ----
  hooks: {
    formEndpoint: null as string | null, // Formspree: https://formspree.io/f/xxxxxxx
    giftCardUrl: null as string | null, // retired: gift cards are sold and redeemed by the site itself (src/gift/)
    classBookingUrl: null as string | null, // optional Cal.com event with Stripe deposit
    // Optional Airbnb Experiences listing for Sergio's table. Airbnb's host fee page (read 2026-11-22):
    // 20% on experience bookings, 15% on service bookings; direct via Stripe is 2.9% + 30¢.
    airbnbExperienceUrl: null as string | null,
  },
  // The current site shows Instagram/Facebook/Pinterest icons but no profile URLs exist in its source.
  social: { instagram: null as string | null, facebook: null as string | null, pinterest: null as string | null },
  // Search. Optional: none of these blocks a launch, but each one helps Google tie the site to the right Sergio.
  seo: {
    // Search Console's "HTML tag" token (only the content="…" value). Not needed if the property is verified by DNS.
    googleSiteVerification: null as string | null,
    // The Google Business Profile's share link (maps.app.goo.gl/… or the g.page link). Added to the structured data as sameAs.
    googleBusinessProfile: null as string | null,
    // His full name as he wants it public. Many chefs are called "Chef Sergio"; the full name is what disambiguates.
    chefFullName: null as string | null,
  },

  // Optional modules
  // The offer is one question with two answers:
  //   Sergio comes to you (dinner / class / small event, in your home or a vacation rental)
  //   You come to Sergio's table (dinner or class at his home; optionally also listed on Airbnb Experiences)
  features: {
    vacationRentals: true, // "A vacation rental" as an answer in the booking form + one FAQ. Not a page.
    sergiosTable: true, // hosting at his own home. Set false to remove the tab, the page and the form option.
  },
}

export type FormatKey = keyof typeof site.formats

/** Verified reviews only. Each needs a real source the visitor could check. */
export const reviews: { quote: string; name: string; context: string; source: string; url?: string }[] = []
