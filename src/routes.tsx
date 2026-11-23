import type { ComponentType } from 'react'
import { faqJsonLd, FAQ } from './components/Faq'
import { HOME_H1 } from './components/HomeHero'
import { IS_PROTOTYPE, site } from './content/site'
import { Home } from './pages/Home'
import { Book, Catering, CookingClasses, Gift, PrivateDining, SergiosTable } from './pages/Services'
import { About } from './pages/About'
import { about } from './content/about'
import { ShotList } from './pages/ShotList'
import { BookDone, MockCheckout } from './booking/StatusPages'
import { InvitationPage, InvitationPreview } from './invitations/InvitationPage'

import { SignIn, CreateAccount, VerifyEmail, PasswordReset, CheckEmail, SignOut, SignedOut, AuthCallback } from './account/AccountPages'
import { CustomerDashboard } from './account/CustomerDashboard'
import { ReceiptPage } from './account/ReceiptPage'
import { NewsletterConfirm, NewsletterUnsubscribe } from './components/NewsletterTokenPage'
import { AdminPage } from './account/AdminPage'

export type Route = {
  path: string
  title: string
  description: string
  h1: string // what the prerender check expects to find
  Page: ComponentType
  noindex?: boolean
  bookingLinkRequired?: boolean
  jsonld?: object[]
  /**
   * Sharing (og:image). `card`: the words on the share card when the H1 doesn't stand alone out of context.
   * `title`: og:title when it should differ from <title> minus the brand. `photo`: one of Sergio's own photos
   * (a path in public/, listed in content/photos.owned.json) to put in the card's arch.
   */
  og?: { card?: string; title?: string; photo?: string }
}

// Structured data. Only properties Google or the schema.org vocabulary actually define (check-seo.mjs validates
// every type and property against content/schemaorg-vocab.json). The FAQ markup is for Bing and AI assistants: Google
// stopped showing FAQ rich results for sites like this in 2023. No review markup: Google ignores self-hosted review stars.
const BUSINESS_ID = `${site.url}/#business`
const telephone = site.phoneHref.replace(/^tel:/, '')
const sameAs = [...Object.values(site.social), site.seo.googleBusinessProfile].filter(Boolean) as string[]

const website = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  '@id': `${site.url}/#website`,
  // Google reads the site name shown above results from this, on the home page only.
  name: site.name,
  alternateName: ['Chef Sergio and Co.', 'Chef Sergio & Co. Orlando'],
  url: `${site.url}/`,
  publisher: { '@id': BUSINESS_ID },
}

const business = {
  '@context': 'https://schema.org',
  '@type': 'LocalBusiness',
  '@id': BUSINESS_ID,
  name: site.name,
  url: `${site.url}/`,
  logo: `${site.url}/apple-touch-icon.png`, // 180×180; Google wants at least 112×112
  image: `${site.url}/og/home.png`,
  telephone,
  email: site.email,
  // A service-area business: he cooks at the guest's address, so only the city is public.
  address: { '@type': 'PostalAddress', addressLocality: 'Orlando', addressRegion: 'FL', addressCountry: 'US' },
  areaServed: [
    { '@type': 'City', name: 'Orlando' },
    { '@type': 'AdministrativeArea', name: 'Central Florida' },
  ],
  ...(site.pricing.dinnerFromPerGuest ? { priceRange: `From $${site.pricing.dinnerFromPerGuest} per guest` } : {}),
  ...(site.seo.chefFullName
    ? {
        founder: {
          '@type': 'Person',
          name: site.seo.chefFullName,
          jobTitle: 'Chef',
          hasCredential: site.credentials.map((c) => ({
            '@type': 'EducationalOccupationalCredential',
            name: c.title,
            recognizedBy: { '@type': 'Organization', name: c.body },
            dateCreated: String(c.year),
          })),
        },
      }
    : {}),
  ...(sameAs.length ? { sameAs } : {}),
}

const service = (name: string, path: string, description: string, from: number | null) => ({
  '@context': 'https://schema.org',
  '@type': 'Service',
  name,
  serviceType: 'Private chef',
  url: site.url + path,
  description,
  provider: { '@type': 'LocalBusiness', '@id': BUSINESS_ID, name: site.name, url: `${site.url}/` },
  areaServed: site.area,
  ...(from
    ? { offers: { '@type': 'Offer', priceSpecification: { '@type': 'UnitPriceSpecification', minPrice: from, priceCurrency: 'USD', unitText: 'per guest' } } }
    : {}),
})

const all: Route[] = [
  { path: '/newsletter/confirm/', title: 'Confirm your subscription | Chef Sergio & Co.', description: 'Confirm your choice to receive the seasonal letter from Chef Sergio and Co.', h1: 'Confirm your subscription', Page: NewsletterConfirm, noindex: true, og: {card:'home'} },
  { path: '/newsletter/unsubscribe/', title: 'Unsubscribe from the letter | Chef Sergio & Co.', description: 'Manage your subscription to the seasonal letter from Chef Sergio and Co.', h1: 'Unsubscribe from the letter', Page: NewsletterUnsubscribe, noindex: true, og: {card:'home'} },

  { path: '/dashboard/', title: 'Your evenings | Chef Sergio & Co.', description: 'Your private account, bookings, menus and receipts with Chef Sergio and Co. in Orlando.', h1: 'A place to return to.', Page: CustomerDashboard, noindex: true, og: { card: 'home' } },
  { path: '/receipt/', title: 'Your receipt | Chef Sergio & Co.', description: 'Your private account, bookings, menus and receipts with Chef Sergio and Co. in Orlando.', h1: 'Your receipt.', Page: ReceiptPage, noindex: true, og: { card: 'home' } },
  { path: '/admin/', title: 'Admin dashboard | Chef Sergio & Co.', description: 'Your private account, bookings, menus and receipts with Chef Sergio and Co. in Orlando.', h1: 'Admin dashboard.', Page: AdminPage, noindex: true, og: { card: 'home' } },
  { path: '/account/sign-in/', title: 'Sign in | Chef Sergio & Co.', description: 'Your private account, bookings, menus and receipts with Chef Sergio and Co. in Orlando.', h1: 'Good to have you here.', Page: SignIn, noindex: true, og: { card: 'home' } },
  { path: '/account/create/', title: 'Create an account | Chef Sergio & Co.', description: 'Your private account, bookings, menus and receipts with Chef Sergio and Co. in Orlando.', h1: 'A place for your plans.', Page: CreateAccount, noindex: true, og: { card: 'home' } },
  { path: '/account/verify-email/', title: 'Verify your email | Chef Sergio & Co.', description: 'Your private account, bookings, menus and receipts with Chef Sergio and Co. in Orlando.', h1: 'Confirm your email.', Page: VerifyEmail, noindex: true, og: { card: 'home' } },
  { path: '/account/password-reset/', title: 'Reset your password | Chef Sergio & Co.', description: 'Your private account, bookings, menus and receipts with Chef Sergio and Co. in Orlando.', h1: 'Reset your password.', Page: PasswordReset, noindex: true, og: { card: 'home' } },
  { path: '/account/check-email/', title: 'Check your email | Chef Sergio & Co.', description: 'Your private account, bookings, menus and receipts with Chef Sergio and Co. in Orlando.', h1: 'Check your email.', Page: CheckEmail, noindex: true, og: { card: 'home' } },
  { path: '/account/sign-out/', title: 'Sign out | Chef Sergio & Co.', description: 'Your private account, bookings, menus and receipts with Chef Sergio and Co. in Orlando.', h1: 'Ready to sign out?', Page: SignOut, noindex: true, og: { card: 'home' } },
  { path: '/auth/logout/', title: 'Sign out | Chef Sergio & Co.', description: 'Your private account, bookings, menus and receipts with Chef Sergio and Co. in Orlando.', h1: 'Ready to sign out?', Page: SignOut, noindex: true, og: { card: 'home' } },
  { path: '/account/signed-out/', title: 'Signed out | Chef Sergio & Co.', description: 'Your private account, bookings, menus and receipts with Chef Sergio and Co. in Orlando.', h1: 'You’re signed out.', Page: SignedOut, noindex: true, og: { card: 'home' } },
  { path: '/auth/callback/', title: 'Opening your account | Chef Sergio & Co.', description: 'Your private account, bookings, menus and receipts with Chef Sergio and Co. in Orlando.', h1: 'Opening your account.', Page: AuthCallback, noindex: true, og: { card: 'home' } },
  { path: '/account/callback/', title: 'Opening your account | Chef Sergio & Co.', description: 'Your private account, bookings, menus and receipts with Chef Sergio and Co. in Orlando.', h1: 'Opening your account.', Page: AuthCallback, noindex: true, og: { card: 'home' } },

  { path: '/invitation/', title: 'Your invitation | Chef Sergio & Co.', description: 'Your private invitation to a gathering with Chef Sergio.', h1: 'Opening your invitation…', Page: InvitationPage, noindex: true, bookingLinkRequired: false, og: { card: 'home' } },
  ...(IS_PROTOTYPE ? [{ path: '/invitation/preview/', title: 'Invitation design preview | Chef Sergio & Co.', description: 'A fictional invitation and menu for reviewing the printed design with Chef Sergio.', h1: 'An invitation from Sergio.', Page: InvitationPreview, noindex: true, bookingLinkRequired: false, og: { card: 'home' } }] : []),
  {
    path: '/',
    title: 'Private chef in Orlando, FL | Chef Sergio & Co.',
    description: 'Chef Sergio cooks private dinners, cooking classes and small events in your home across Orlando and Central Florida. Organic, no seed oils, nothing frozen.',
    h1: HOME_H1,
    Page: Home,
    jsonld: [website, business, faqJsonLd([FAQ.cost, FAQ.included, FAQ.dietary, FAQ.area, FAQ.ahead, FAQ.deposit])].filter(Boolean) as object[],
  },
  {
    path: '/privatedining/',
    title: 'Private chef dinners at home in Orlando | Chef Sergio & Co.',
    description: 'A private chef dinner for 2 to 12 guests, with a menu written around your occasion, cooked in your kitchen, served at your table, and cleaned up after.',
    h1: 'Private dinners for 2 to 12, cooked in your kitchen.',
    Page: PrivateDining,
    jsonld: [service('Private dinner', '/privatedining/', 'In-home private dinners for 2 to 12 guests.', site.pricing.dinnerFromPerGuest)],
  },
  {
    path: '/cookingclasses/',
    title: 'In-home cooking classes in Orlando | Chef Sergio & Co.',
    description: 'Hands-on private cooking classes with Chef Sergio in your own Orlando kitchen. Learn techniques by doing them, then sit down and eat what you made.',
    h1: 'Cook with Sergio in your own kitchen.',
    Page: CookingClasses,
    jsonld: [service('Private cooking class', '/cookingclasses/', 'Hands-on in-home cooking classes.', site.pricing.classFromPerGuest)],
  },
  {
    path: '/catering/',
    title: 'Small event catering in Orlando | Chef Sergio & Co.',
    description: 'Full-service catering for 8 to 24 guests: menu, staff, tablecloths, dinnerware, glassware and centerpieces in one all-inclusive proposal.',
    h1: 'Small events for 8 to 24 guests, fully catered.',
    Page: Catering,
    jsonld: [service('Small event catering', '/catering/', 'Full-service catering for 8 to 24 guests.', site.pricing.eventFromPerGuest)],
  },
  {
    path: '/about/',
    title: 'About Chef Sergio, private chef in Orlando',
    description: 'Chef Sergio founded CeDAC in Caracas and owned Mia Pizza in Davenport for over 21 years. Now he cooks private dinners and classes in Central Florida.',
    h1: about.headline,
    Page: About,
  },
  {
    path: '/book/',
    title: 'Book with Sergio | Chef Sergio & Co.',
    noindex: true,
    description: 'Plan a private dinner, cooking class or small celebration with Sergio. Share what you know and clarify the rest together.',
    h1: 'Book with Sergio',
    Page: Book,
    og: { card: 'Pick a date. Send a request. Plan the menu together.' },
  },
  {
    path: '/gift/',
    title: 'Private chef gift cards in Orlando | Chef Sergio & Co.',
    description: 'Give a private dinner or an in-home cooking class with Chef Sergio in Orlando. Gift cards in any amount, delivered by email.',
    h1: 'Give a dinner, not a thing.',
    Page: Gift,
  },
  ...(site.features.sergiosTable
    ? [
        {
          path: '/sergios-table/',
          title: "Supper club seats at Sergio's table | Chef Sergio & Co.",
          description: 'Browse the evenings Sergio has published and request seats at his shared table. Sergio reviews each request before confirming.',
          h1: "Dinner at Sergio's table.",
          Page: SergiosTable,
          jsonld: [service("Dinner at Sergio's table", '/sergios-table/', 'A dinner or cooking class hosted at the chef\'s home.', site.pricing.tableFromPerGuest)],
        },
      ]
    : []),
  {
    path: '/book/done/',
    title: 'Your booking | Chef Sergio & Co.',
    description: 'The status of your booking with Chef Sergio (held, reserved, confirmed or requested) and what happens next.',
    h1: 'Your booking',
    Page: BookDone,
    noindex: true,
  },
  ...(IS_PROTOTYPE
    ? [{ path: '/book/pay/', title: 'Online checkout is unavailable | Chef Sergio & Co.', description: 'No card is saved or charged online. Send a booking request for Sergio to review.', h1: 'Online checkout is unavailable', Page: MockCheckout, noindex: true }]
    : []),
  ...(IS_PROTOTYPE
    ? [{ path: '/shot-list/', title: 'Photo shot list (prototype) | Chef Sergio & Co.', description: 'Watermarked reference photos for every image slot on the site, with specs for shooting Sergio\'s own versions.', h1: 'Photo shot list', Page: ShotList, noindex: true }]
    : []),
]

export const routes = all
export const routeByPath = Object.fromEntries(all.map((r) => [r.path, r]))

/**
 * Old Wix URLs that must keep working. Case variants (the old nav linked /About) are handled in 404.html,
 * not with stub folders: macOS filesystems are case-insensitive, so an /About/ folder would overwrite /about/.
 */
export const redirects: Record<string, string> = {
  '/contact/': '/book/',
}

/**
 * Mis-cased old URLs Google has indexed: the Wix site declared https://www.chefsergioandco.com/About as the About
 * page's canonical (checked 2026-11-22). Googlebot doesn't run 404.html's script, so these need real redirect stubs.
 * prerender.mjs writes them only on a case-sensitive filesystem (the Linux CI build that deploys), never on macOS.
 */
export const caseRedirects: Record<string, string> = {
  '/About/': '/about/',
}
