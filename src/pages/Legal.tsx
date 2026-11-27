import type { ReactNode } from 'react'
import { site } from '../content/site'
import { href } from '../components/ui'
import { PRIVACY_CONTACT_EMAIL, PRIVACY_POLICY_VERSION, PRIVACY_RETENTION } from '../privacy/policy'
import './Legal.css'

const UPDATED = '2026-11-27'
const PRIVACY_EMAIL = PRIVACY_CONTACT_EMAIL
type Section = { id: string; title: string; body: ReactNode }

function Contact({ privacy = false }: { privacy?: boolean }) {
  const email = privacy ? PRIVACY_EMAIL : site.email
  return <address className="legal-contact"><strong>{site.name}</strong><span>{site.area}</span><a href={`mailto:${email}${privacy ? '?subject=Privacy%20request' : ''}`}>{email}</a><a href={site.phoneHref}>{site.phone}</a></address>
}

function Contents({ sections }: { sections: Section[] }) {
  return <ol>{sections.map(section => <li key={section.id}><a href={`#${section.id}`}>{section.title}</a></li>)}</ol>
}

function LegalPage({ title, introduction, sections, other }: { title: string; introduction: string; sections: Section[]; other: 'privacy' | 'terms' }) {
  return <article className="legal-page" data-privacy-policy-version={other === 'terms' ? PRIVACY_POLICY_VERSION : undefined}>
    <header className="legal-intro">
      <p className="legal-eyebrow">The small print, in plain language</p>
      <h1>{title}</h1>
      <p className="legal-lead">{introduction}</p>
      <p className="legal-updated">Last updated <time dateTime={UPDATED}>November 27, 2026</time><span aria-hidden="true"> · </span><a data-native-navigation href={href(other === 'terms' ? '/terms/' : '/privacy/')}>{other === 'terms' ? 'Terms of Service' : 'Privacy Policy'}</a></p>
    </header>
    <div className="legal-reading">
      <nav className="legal-contents" aria-label={`${title} contents`}><p>On this page</p><Contents sections={sections}/></nav>
      <details className="legal-mobile-contents"><summary>On this page</summary><nav aria-label={`${title} contents`}><Contents sections={sections}/></nav></details>
      <div className="legal-body">{sections.map(section => <section id={section.id} key={section.id} aria-labelledby={`${section.id}-heading`}><h2 id={`${section.id}-heading`}>{section.title}</h2>{section.body}</section>)}</div>
    </div>
  </article>
}

export function PrivacyPolicy() {
  const sections: Section[] = [
    { id: 'who-we-are', title: 'Who this policy covers', body: <>
      <p>This policy explains how {site.name} handles personal information through this website and when arranging private dinners, cooking classes, shared-table evenings, small events, gift cards, and related communications.</p>
      <p>For a privacy question or request, email <a href={`mailto:${PRIVACY_EMAIL}?subject=Privacy%20request`}>{PRIVACY_EMAIL}</a> or call <a href={site.phoneHref}>{site.phone}</a>. You do not need an account to contact us.</p>
    </> },
    { id: 'information-you-share', title: 'Information you share', body: <>
      <ul>
        <li><strong>Inquiries and bookings.</strong> Your name, email, phone, contact preference, occasion, dates, location, party size, budget, kitchen or venue details, food preferences, and information you put in a request or message.</li>
        <li><strong>Guest responses and dietary needs.</strong> Names, attendance and optional dietary, allergy or accessibility information. Give only your own sensitive information through the private consent form. Other adults should submit their own guest response; a host’s booking does not give permission to collect another adult’s health information.</li>
        <li><strong>Accounts.</strong> Your sign-in identifier, name, email and verification status, chosen account details, linked bookings, saved menus, preferences, and support or privacy requests. Auth0 manages sign-in; Google provides identity information when you choose Google sign-in.</li>
        <li><strong>Gift cards and payments.</strong> Purchaser and recipient details, the gift message and delivery date, amount, balance, redemptions, payment references, receipts, and refund information. Card details are entered through Stripe’s checkout; our booking forms do not collect your full card number or security code.</li>
        <li><strong>Reviews, referrals, and rewards.</strong> Reviews and the display name you choose, permission to publish, referral codes and attribution, qualifying booking activity, and any associated credit.</li>
        <li><strong>The seasonal letter.</strong> Your email, optional name, subscription request and confirmation, consent history, unsubscribe preferences, and delivery information.</li>
      </ul>
    </> },
    { id: 'how-we-use-information', title: 'How we use it', body: <>
      <p>We use this information to respond to you, assess availability, plan and provide your experience, accommodate requirements we have agreed with you, manage accounts and gift cards, process payments and refunds, send operational messages, administer reviews and referrals, and resolve questions or disputes.</p>
      <p>Allergy and dietary information is used for event planning and preparation. It is not a general marketing profile. Providing a requirement does not mean it has been accepted; please confirm any essential accommodation directly with Sergio.</p>
      <p>We also use technical information, request identifiers, and security or transaction records to protect private links, prevent abuse and fraud, keep the service working, and meet applicable recordkeeping obligations.</p>
    </> },
    { id: 'lawful-use-and-consent', title: 'Our reasons for using information', body: <>
      <p>We use the information necessary to discuss or perform your requested booking, provide your account and process your payment on the basis of our contract or steps you ask us to take before a contract. We assess limited security, fraud prevention, guest coordination, suppression and claim-related uses for necessity and our legitimate interests, with safeguards for the people affected.</p>
      <p>Newsletter signup, publication of a review and optional sensitive event information use separate consent. We do not require marketing consent to make a booking. A specific legal duty or justified claim-related purpose may require limited records; this does not authorize keeping unrelated planning details.</p>
    </> },
    { id: 'sensitive-information', title: 'Your sensitive event information', body: <>
      <p>Allergies and some dietary or accessibility details can reveal health or religious information. You choose whether to provide them. Our form asks for your explicit consent to use your own details for planning and preparation, separately from your RSVP, booking and any email choice. Leave them blank if you prefer to discuss an adjustment privately with Sergio.</p>
      <p>You can withdraw this consent without canceling your RSVP or booking. Untick the choice and update your private response without the details, or contact <a href={`mailto:${PRIVACY_EMAIL}?subject=Withdraw%20sensitive%20event%20information`}>{PRIVACY_EMAIL}</a>. We stop using the withdrawn details for that purpose and remove them unless a specific lawful reason requires a limited record. An essential accommodation still needs to be expressly agreed with Sergio.</p>
      <p>Share only necessary adjustments, not diagnoses or another adult’s private information. For a child or a person needing a representative, contact Sergio to arrange an appropriate guardian or authorized-representative process.</p>
    </> },
    { id: 'people-and-providers', title: 'Who receives information', body: <>
      <p>Access is limited to the people and services needed for the purpose involved:</p>
      <ul>
        <li><strong>Sergio and people helping deliver the experience.</strong> Relevant planning, guest, dietary, venue, and contact details may be shared with authorized staff or service partners who need them.</li>
        <li><strong>Hosting and technical services.</strong> GitHub Pages hosts the website; Cloudflare provides the application, data storage, and security infrastructure. Better Stack supports service monitoring and the status page.</li>
        <li><strong>Sign-in, payments, and email.</strong> Auth0 and, if chosen, Google support sign-in. Stripe processes checkout and payment information. Resend delivers messages and manages newsletter subscriptions and delivery preferences.</li>
        <li><strong>People you choose to involve.</strong> A gift recipient receives the relevant gift and message. A shared invitation link reveals the invitation’s event details to people who have the link. Keep private booking, receipt, gift-card, and response links secure.</li>
      </ul>
      <p>With your permission, a review may be published with your chosen display name, service, and event month. A referral link can show the code owner’s abbreviated name to someone using the link. The referrer can see a referred friend’s abbreviated name, service, and limited qualifying-booking or reward status; these features do not expose dietary answers or payment-card details.</p>
      <p>We may disclose information when required by law, to protect people or the service, or to establish or defend legal claims. We do not sell or rent our booking or newsletter lists.</p>
      <p>Providers may process information in the United States and other places where they operate. Their own notices also explain how they handle information on their services, such as a Google sign-in or Stripe checkout page.</p>
    </> },
    { id: 'browser-storage', title: 'Cookies and saved drafts', body: <>
      <p>The website and sign-in services use cookies and browser storage for sign-in, security, appearance preferences, referral attribution, private-link access, and continuity between steps.</p>
      <p><strong>An unfinished booking can be saved on your device.</strong> A draft can contain personal contact and planning information. Use “Start fresh” when offered to remove a saved draft, or clear this site’s data in your browser. A completed submission also clears its local booking draft.</p>
      <p>Clearing cookies or site storage can remove drafts and preferences and require you to sign in again. It does not delete a booking or other record already submitted to us.</p>
      <p>The site does not currently install a separate advertising or marketing-analytics script. Hosting, sign-in, payment, and email providers can still receive technical information such as IP address, browser information, request times, and security or delivery events. Email-service settings can also affect whether opens or link clicks are recorded.</p>
    </> },
    { id: 'your-email-choices', title: 'Your email choices', body: <>
      <p>The seasonal letter is optional and uses a separate signup and confirmation. Making a booking, responding to an invitation, or creating an account does not automatically subscribe you.</p>
      <p>Use the unsubscribe link in a letter, or contact us, to stop future seasonal letters. You do not need to sign in to use the letter’s unsubscribe link. Booking confirmations, receipts, security messages, and other communications needed for your arrangements are separate from newsletter marketing.</p>
    </> },
    { id: 'retention-and-security', title: 'Retention and security', body: <>
      <p>Our policy separates short-lived planning information from the small set of records needed for financial accuracy and claims. Earlier valid erasure or consent withdrawal can apply; an active arrangement or a specific documented obligation can change the handling of a particular record.</p>
      <ul>
        <li><strong>Unconverted inquiries:</strong> {PRIVACY_RETENTION.inquiryDays} days after our last substantive contact, unless you ask for a later follow-up.</li>
        <li><strong>Sensitive event and guest preparation details:</strong> {PRIVACY_RETENTION.sensitiveEventDays} days after the event, or earlier after cancellation when no longer needed. A specific incident or legal claim may require a limited, restricted record.</li>
        <li><strong>Core written booking terms:</strong> a minimized record for {PRIVACY_RETENTION.coreContractYears} years after the event or final resolution for contract-related claims. This does not mean keeping every dietary note or planning draft for five years.</li>
        <li><strong>Financial records:</strong> the minimum payment, refund, receipt and ledger evidence for {PRIVACY_RETENTION.financialYears} years from the relevant final financial or tax-record trigger. An unresolved payment, audit or specific claim may require a documented hold. This is our retention policy, not a claim that tax law requires every customer record for seven years.</li>
        <li><strong>Accounts and saved preferences:</strong> while actively used, with a review after {PRIVACY_RETENTION.inactivityMonths} months of inactivity and {PRIVACY_RETENTION.inactivityNoticeDays} days’ notice before removing an unused account. Existing bookings and stored value preserve only the records they actually need.</li>
        <li><strong>Rights requests:</strong> working copies for {PRIVACY_RETENTION.rightsWorkingDays} days after final resolution, then a minimal decision and delivery audit for {PRIVACY_RETENTION.rightsAuditYears} years. Download copies expire after {PRIVACY_RETENTION.exportDays} days; expiry does not remove your right to ask for access.</li>
        <li><strong>Operational and security logs:</strong> up to {PRIVACY_RETENTION.operationalLogDays} days, except a limited incident or claim record. Provider-controlled records can have their own applicable periods, which we address in your response.</li>
      </ul>
      <p>Purchased gift value does not expire because an account closes; necessary balance and redemption evidence remains while value is outstanding. Newsletter sending stops when you withdraw. We keep only necessary consent, withdrawal and suppression evidence so deletion does not accidentally subscribe you again. Public reviews are removed when their publication consent is withdrawn.</p>
      <p>A preservation hold keeps information needed to answer an open access request, including relevant earlier copies. Restricted backup copies are removed as their actual backup cycle permits, with removal or restriction reapplied before restored information is used. We explain the particular records retained and their reasons rather than promising instant erasure from every provider or backup.</p>
      <p>We use access controls and other reasonable safeguards to protect information. No website, device, or email system can guarantee absolute security.</p>
    </> },
    { id: 'privacy-requests', title: 'Your requests and choices', body: <>
      <p>You can request access and a copy of your personal information, correct inaccurate or incomplete information, request erasure, ask for restriction where its conditions apply, object to relevant processing, withdraw consent, or request qualifying data portability. We offer this rights process to our customers without requiring an account.</p>
      <p>If you already have an account, <a data-native-navigation href={href('/dashboard/?view=settings')}>Settings &amp; profile</a> brings these choices together. You can also use the contact below without signing in or creating an account.</p>
      <p>An access response covers your actual information in relevant account, booking, internal planning, correspondence, financial and provider records, together with how we use it. It is broader than the dashboard. We protect other people’s information and usable access credentials and explain specific lawful restrictions.</p>
      <p>Qualifying portability covers data you provided that is processed automatically on consent or contract. It is a narrower, reusable machine-readable dataset; you may ask for direct transfer where technically feasible. Completed account exports are available as verified JSON and a readable copy. If you cannot use an account or the file needs another delivery method, we arrange a proportionate identity check and secure alternative.</p>
      <p>Email <a href={`mailto:${PRIVACY_EMAIL}?subject=Privacy%20request`}>{PRIVACY_EMAIL}</a> with enough information to identify the request. We may need to verify your identity and clarify its scope before releasing or changing records. Please do not email a password, full payment-card number, or private access code.</p>
      <p>We respond without undue delay and within one calendar month of receipt. If complexity or the number of requests makes a lawful extension necessary, we notify you with reasons within that original month; the extension is at most two additional months. Asking for clarification does not automatically restart the deadline.</p>
      <p>Requests are normally free. If a request is refused or limited, we explain the reasons and your right to complain to the competent data-protection authority and seek a judicial remedy. A fee or refusal for a manifestly unfounded or excessive request requires a specific justification.</p>
      <p>We will consider applicable rights and explain if information must be retained or part of a request cannot be fulfilled. A privacy request is not, by itself, a cancellation of a booking or a request for a payment refund; please tell Sergio separately if you need either.</p>
    </> },
    { id: 'children-and-updates', title: 'Children and policy updates', body: <>
      <p>This is a service for arranging culinary experiences, not a website directed to young children. A parent or guardian should arrange a child’s participation and share only information needed for that experience. Contact us if you believe a child has submitted personal information that needs attention.</p>
      <p>We will post updates to this policy here with a revised date. If a change calls for a new notice or permission, we will take the steps required by applicable law.</p>
      <Contact privacy/>
    </> },
  ]
  return <LegalPage title="Privacy Policy" introduction="What you share with us, why we need it, and the choices you have." sections={sections} other="terms"/>
}

export function TermsOfService() {
  const sections: Section[] = [
    { id: 'using-the-site', title: 'Using this website', body: <>
      <p>These terms cover your use of the {site.name} website, accounts, and online services, and explain the general basis on which we arrange culinary experiences. Please read them alongside our <a data-native-navigation href={href('/privacy/')}>Privacy Policy</a> and the details expressly agreed for your booking or purchase.</p>
      <p>Use the site lawfully, provide accurate information, and contact us if a detail changes. If you arrange something for other people, make sure you are authorized to provide their information and share the relevant arrangements with them. A child’s participation and any supervision requirements should be discussed with Sergio in advance.</p>
    </> },
    { id: 'requests-and-confirmation', title: 'Requests and confirmation', body: <>
      <p>We offer private dinners, private and scheduled cooking classes, small events, and published evenings at Sergio’s table, subject to availability and the arrangements we agree with you.</p>
      <p><strong>Sending a request or joining a waitlist does not, by itself, confirm a booking or reserve a date or seats.</strong> A request receipt acknowledges the information received. Check the actual booking status and Sergio’s confirmation before relying on an arrangement.</p>
      <p>Published classes and shared-table evenings have their own date, location, menu, and seat availability. An evening may depend on its stated minimum attendance and decision date; check its published status. A flexible-date request or deposit does not choose or reserve a date; the date must be agreed separately.</p>
    </> },
    { id: 'your-agreed-arrangements', title: 'Your agreed arrangements', body: <>
      <p>The date, venue, party size, menu, inclusions, spending limit, travel, kitchen requirements, and any other essential details must be agreed for your experience. General website descriptions and provisional totals do not replace that agreement.</p>
      <p>For a particular service or purchase, the written details you expressly agree with Sergio take precedence over general website descriptions for those arrangements, subject to applicable law. Ask us before paying if a price, inclusion, payment obligation, or cancellation condition is unclear.</p>
      <p>Tell Sergio promptly about changes to your plans. A change to guest numbers, date, location, menu, or service may affect availability and price and needs to be agreed; editing an account preference alone does not change an existing booking.</p>
    </> },
    { id: 'payments-and-deposits', title: 'Payments and deposits', body: <>
      <p>Online payment is available only where offered for the specific booking or purchase. The amount, currency, and payment purpose must be clear before you authorize checkout. Stripe processes online card payments. A request, estimate, or saved payment status is not itself authorization for an additional charge.</p>
      <p>Where your agreed private-event arrangements include a deposit, it is credited toward your event bill. The menu and final price may follow the planning discussion within an agreed spending limit. A flexible-date deposit does not reserve a date.</p>
      <p>No general deposit percentage, planning-fee amount, travel surcharge, or gratuity is established by this page. Use the amounts and terms expressly agreed for your booking.</p>
    </> },
    { id: 'changes-cancellations-refunds', title: 'Changes, cancellations, and refunds', body: <>
      <p>Contact Sergio as soon as you need to cancel or reschedule. Cancellation and rescheduling depend on the service and the terms agreed for that booking; a waitlist entry or unanswered planning invitation does not automatically cancel another arrangement.</p>
      <p>For a paid private-event deposit, cancellation before the menu-interview invitation is sent returns the deposit. After that invitation has been sent, only a previously disclosed planning fee within the maximum agreed for your booking may be retained at that stage. Any later cancellation conditions must be agreed for the experience.</p>
      <p>For paid seats at a published class or shared-table evening, contact Sergio about your cancellation or transfer request. If Sergio cancels the published evening, the paid seat amount is refunded. Gift-card-funded amounts return to the gift card rather than being converted to cash.</p>
      <p>Payment corrections and refunds are separate from changing a booking’s status or closing an account. Nothing in these terms removes a refund or other remedy required by law.</p>
    </> },
    { id: 'dietary-venue-and-participation', title: 'Dietary needs, venues, and participation', body: <>
      <p>Share allergies, dietary requirements, accessibility needs, and relevant kitchen or venue limitations as early as possible and before the menu or participation arrangements are finalized. Sergio must review and expressly agree any essential accommodation. Do not assume a request has been accepted simply because it was entered in a form.</p>
      <p>We cannot promise that every request can be accommodated or that a shared or third-party kitchen is free of every allergen or cross-contact risk. Discuss a safety-critical requirement directly with Sergio before making arrangements.</p>
      <p>Provide accurate venue and access information and follow the agreed preparation and safety instructions. Age suitability, a child’s attendance, supervision, and any venue-specific rules must be agreed for the particular class or event.</p>
    </> },
    { id: 'gift-cards', title: 'Gift cards', body: <>
      <p>Our gift cards carry a dollar balance toward eligible {site.name} services. They do not expire and do not carry post-sale maintenance or inactivity fees. Using part of a card leaves the unused balance available.</p>
      <p>A gift card does not guarantee a particular date, menu, price, location, or service availability. Gift value is applied to eligible amounts agreed for a booking; any remaining amount due is paid separately. Refunds of gift-card-funded booking payments restore that value to the card.</p>
      <p>Gift cards are not exchangeable for cash except where required by law. A refund request for an unused gift-card purchase is separate from cancelling a booking; contact Sergio about an unused card, a delivery problem, or a payment error.</p>
      <p>Keep the gift card’s private link or code secure and share it only with its intended recipient. Tell us promptly if you believe a card or payment has been used without authorization.</p>
    </> },
    { id: 'accounts-private-links-and-content', title: 'Accounts, private links, and content', body: <>
      <p>Keep your account credentials and private booking, receipt, invitation-response, and gift-card links secure. Do not access another person’s account or private records without permission, interfere with the service, or submit misleading, unlawful, or harmful material.</p>
      <p>Reviews should reflect your own experience. If you choose to publish one, you authorize us to display the submitted review and the name and experience details you approve. You keep ownership of your own content; we use it to provide the feature you requested. Contact us to correct or remove it.</p>
      <p>Our site text, branding, designs, and original photographs may not be republished commercially without permission, except where the law permits. Third-party material remains subject to its owner’s rights.</p>
    </> },
    { id: 'availability-and-your-rights', title: 'Availability and your rights', body: <>
      <p>We work to keep the site accurate and available, but access may be interrupted and mistakes can occur. Contact us about an error or an arrangement you cannot access. An outage or technical message does not itself cancel a confirmed booking or change an agreed payment obligation.</p>
      <p>Third-party sign-in, payment, and linked services also have their own terms. Our <a data-native-navigation href={href('/privacy/')}>Privacy Policy</a> explains how information is handled. Newsletter signup is optional and separate from a booking or account.</p>
      <p>Nothing here excludes responsibility that cannot lawfully be excluded or limits applicable consumer rights. If you have a concern, contact us so we can try to resolve it.</p>
    </> },
    { id: 'changes-and-contact', title: 'Updates and contact', body: <>
      <p>We may update these terms and will show the revised date on this page. Updates do not rewrite the details of an already confirmed booking or purchase unless you and Sergio expressly agree, or the law requires otherwise.</p>
      <p>For your arrangements or a question about these terms, contact:</p>
      <Contact/>
      <p>For a personal-information request, use the contact details in our <a data-native-navigation href={href('/privacy/#privacy-requests')}>Privacy Policy</a>.</p>
    </> },
  ]
  return <LegalPage title="Terms of Service" introduction="A clear starting point for using the site and arranging an experience with Sergio." sections={sections} other="privacy"/>
}
