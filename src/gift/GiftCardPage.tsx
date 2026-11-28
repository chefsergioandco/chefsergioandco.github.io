import { useEffect, useState, type FormEvent } from 'react'
import { formatAmount } from '../../prototypes/sergio-admin/shared/gift-cards/artwork'
import { formatGiftCode, isGiftCode, normalizeGiftCode } from '../../prototypes/sergio-admin/shared/gift-cards/code'
import { CtaButton, CtaLink } from '../components/CallToAction'
import { href } from '../components/ui'
import { site } from '../content/site'
import { GiftCard } from './GiftCard'
import { giftCardStatus, giftPurchaseProof, giftPurchaseStatus, GiftError, type GiftCardStatus, type GiftDeliveryStatus, type GiftPurchaseProof, type GiftPurchaseStatus } from './api'
import './GiftPage.css'

type View = { kind: 'idle' } | { kind: 'loading' } | { kind: 'found'; code: string; card: GiftCardStatus } | { kind: 'error'; message: string }

/** The code is the card: it arrives in the link's #fragment, which never reaches a server log. */
function codeFromFragment(): string {
  if (typeof window === 'undefined') return ''
  return new URLSearchParams(window.location.hash.slice(1)).get('code') ?? ''
}

/** The recipient's page: their card, lit, with what's left on it and the way to book with it. */
export function GiftCardPage() {
  const [entry, setEntry] = useState('')
  const [view, setView] = useState<View>({ kind: 'idle' })
  const open = async (raw: string) => {
    if (!isGiftCode(raw)) { setView({ kind: 'error', message: 'That code isn’t complete. It has 16 characters; the letters I, L, O and U aren’t used.' }); return }
    setView({ kind: 'loading' })
    try { setView({ kind: 'found', code: normalizeGiftCode(raw), card: await giftCardStatus(raw) }) }
    catch (error) {
      const code = error instanceof GiftError ? error.code : 'network'
      setView({ kind: 'error', message: code === 'not-found' ? 'We couldn’t find a card with that code. Check it against your email, or call Sergio.' : code === 'unavailable' ? 'Gift cards aren’t open online yet. Sergio can check your card by phone.' : code === 'rate_limited' ? 'Too many tries for now. Please wait a little, or call Sergio.' : 'The card service didn’t answer. Please try again in a moment.' })
    }
  }
  useEffect(() => { const code = codeFromFragment(); if (code) { setEntry(formatGiftCode(code)); void open(code) } }, [])
  const submit = (event: FormEvent) => { event.preventDefault(); void open(entry) }

  if (view.kind === 'found') {
    const { card, code } = view, usable = card.status === 'active' && card.balanceCents > 0
    return <div className="gift-page wrap">
      <header className="gift-intro">
        <p className="font-display text-lg italic text-ink-muted">{card.sender ? `from ${card.sender}` : 'a gift'}</p>
        <h1 className="mt-2 text-4xl sm:text-5xl">{card.recipient ? `For ${card.recipient}.` : 'Your gift card.'}</h1>
      </header>
      <div className="gift-layout">
        <div className="gift-object"><GiftCard document={{ amountCents: card.amountCents, recipient: card.recipient, sender: card.sender, note: card.note, code, redeemUrl: `${site.url}/book/`, phone: site.phone }} label={`${formatAmount(card.amountCents)} gift card`} /></div>
        <div className="gift-form">
          <p className="text-2xl" role="status">{card.status === 'frozen' ? 'This card is on hold. Please call Sergio.' : card.status === 'void' ? 'This card is no longer valid.' : `${formatAmount(card.balanceCents)} available to use now.`}</p>
          <p className="text-ink-muted">It never expires. Use it in part or in full toward any dinner, class or gathering; it pays the deposit first, then the rest.</p>
          <p className="gift-hint">An open checkout can temporarily reserve part of the card’s value.</p>
          {usable ? <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <CtaLink emphasis="primary" href={`${href('/book/')}#gift=${encodeURIComponent(code)}`}>Book an evening with it</CtaLink>
            <a className="link text-sm" href={site.phoneHref}>Or call Sergio, {site.phone}</a>
          </div> : <a className="link" href={site.phoneHref}>Call Sergio, {site.phone}</a>}
          <p className="gift-hint">Keep this page private: the code on the back of the card is what makes it yours.</p>
        </div>
      </div>
    </div>
  }
  return <div className="gift-page wrap">
    <header className="gift-intro">
      <h1 className="text-4xl sm:text-5xl">Your gift card.</h1>
      <p className="mt-5 max-w-prose text-lg text-ink-muted">Enter the code from the back of your card to see what’s on it and book with it.</p>
    </header>
    <form className="gift-form mt-10 max-w-md" onSubmit={submit} noValidate>
      <label className="gift-field"><span>Gift code</span>
        <input id="gift-code" className="gift-input" autoComplete="off" autoCapitalize="characters" spellCheck={false} inputMode="text" maxLength={24} placeholder="XXXX XXXX XXXX XXXX" value={entry} onChange={event => setEntry(event.target.value)} aria-invalid={view.kind === 'error' || undefined} aria-describedby={view.kind === 'error' ? 'gift-code-error' : undefined} />
      </label>
      {view.kind === 'error' ? <p className="gift-error" id="gift-code-error" role="alert">{view.message}</p> : null}
      <div><CtaButton emphasis="primary" type="submit" disabled={view.kind === 'loading'} aria-busy={view.kind === 'loading'}>{view.kind === 'loading' ? 'Opening…' : 'Open my card'}</CtaButton></div>
    </form>
  </div>
}

const deliveryLabels: Record<GiftDeliveryStatus, string> = {
  not_issued: 'Waiting for the card', scheduled: 'Scheduled', disabled: 'Email setup needs attention', preview: 'Delivery not confirmed',
  queued: 'Waiting to send', sending: 'Sending', sent: 'Sent · delivery not yet confirmed', delivered: 'Delivered', retry: 'Waiting to retry',
  failed: 'Could not send', bounced: 'Email could not be delivered', complained: 'Delivery stopped', needs_review: 'Needs Sergio’s attention',
  suppressed: 'Delivery stopped', cancelled: 'Sending cancelled', needs_contact: 'Contact details need review',
}
const paymentLabels: Record<GiftPurchaseStatus['payment'], string> = { pending: 'Awaiting payment', processing: 'Payment processing', paid: 'Payment confirmed', expired: 'Checkout expired', unverified: 'Payment not yet verified' }
const attentionStatuses: GiftDeliveryStatus[] = ['disabled', 'preview', 'failed', 'bounced', 'complained', 'needs_review', 'suppressed', 'cancelled', 'needs_contact']
type PurchaseView = { kind: 'checking' } | { kind: 'missing' } | { kind: 'error'; message: string } | { kind: 'current'; value: GiftPurchaseStatus }

/** The return URL is context, not proof of payment. Only this purchase's protected status can confirm a result. */
export function GiftThanks() {
  const [proof, setProof] = useState<GiftPurchaseProof | null>(null), [view, setView] = useState<PurchaseView>({ kind: 'checking' }), [refresh, setRefresh] = useState(0)
  useEffect(() => {
    const read = () => { setView({ kind: 'checking' }); setProof(giftPurchaseProof(location.search, location.hash)); setRefresh(value => value + 1) }
    read()
    window.addEventListener('popstate', read); window.addEventListener('hashchange', read); window.addEventListener('site:navigate', read)
    return () => { window.removeEventListener('popstate', read); window.removeEventListener('hashchange', read); window.removeEventListener('site:navigate', read) }
  }, [])
  useEffect(() => {
    if (!proof) { setView({ kind: 'missing' }); return }
    const controller = new AbortController()
    setView({ kind: 'checking' })
    giftPurchaseStatus(proof, controller.signal).then(value => { if (!controller.signal.aborted) setView({ kind: 'current', value }) }).catch(error => {
      if (!controller.signal.aborted) setView({ kind: 'error', message: error instanceof Error ? error.message : 'The purchase result could not be confirmed. Refresh or contact Sergio.' })
    })
    return () => controller.abort()
  }, [proof, refresh])
  const status = view.kind === 'current' ? view.value : null
  const needsAttention = status && (status.issuance === 'needs_review' || attentionStatuses.includes(status.delivery.recipient) || attentionStatuses.includes(status.delivery.sender))
  const sendDay = status?.sendOn ? new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(status.sendOn + 'T12:00:00Z')) : null
  return <div className="gift-page wrap">
    <header className="gift-intro">
      <p className="font-display text-lg italic text-ink-muted">an evening to give</p>
      <h1 className="mt-2 text-4xl sm:text-5xl">Your gift purchase.</h1>
      <p className="mt-5 max-w-prose text-lg text-ink-muted">Payment, your card and its emails are checked separately here.</p>
    </header>
    <section className="gift-purchase-status" aria-label="Gift purchase status" aria-busy={view.kind === 'checking'}>
      {view.kind === 'checking' && <p role="status">Checking the current purchase result…</p>}
      {view.kind === 'missing' && <div role="status"><h2 className="text-2xl">Use your private purchase link.</h2><p>This page alone cannot confirm a purchase. Return using the complete link from checkout, or call Sergio if it is missing. A new payment is not needed just to check a result.</p></div>}
      {view.kind === 'error' && <p className="gift-error" role="alert">{view.message} Please check this purchase before starting another payment.</p>}
      {status && <>
        <h2 className="text-2xl" role="status">{paymentLabels[status.payment]}</h2>
        <p className="mt-3">{status.payment === 'paid' ? status.issuance === 'issued' ? 'Your gift card has been issued. The email results are shown below.' : 'Payment is recorded, but the card has not been confirmed as issued. Sergio needs to check it.' : status.payment === 'processing' ? 'Your payment is still processing. Please keep this link and check again; do not start another payment.' : status.payment === 'expired' ? 'This checkout has expired. No completed payment is recorded for this purchase.' : status.payment === 'unverified' ? 'The payment result needs checking. Please refresh or contact Sergio before making another payment.' : 'No completed payment has been confirmed yet. If you have finished checkout, refresh the status before trying another payment.'}</p>
        <dl className="gift-purchase-facts">
          <div><dt>Gift card</dt><dd>{status.issuance === 'issued' ? 'Issued' : status.issuance === 'needs_review' ? 'Needs Sergio’s review' : 'Not yet issued'}</dd></div>
          <div><dt>Recipient email</dt><dd>{deliveryLabels[status.delivery.recipient]}{sendDay && <span>Chosen day: {sendDay} · Orlando time</span>}</dd></div>
          <div><dt>Your receipt and card copy</dt><dd>{deliveryLabels[status.delivery.sender]}<span>Sent after payment and card issuance</span></dd></div>
        </dl>
        {needsAttention && <p className="gift-error">Part of this gift needs attention. Call Sergio and give him the purchase reference below.</p>}
        <p className="gift-hint">Checked {new Date(status.checkedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/New_York' })} Eastern. “Sent” and “Delivered” are separate email results.</p>
      </>}
      {proof && <p className="gift-purchase-reference">Purchase reference <span>{proof.purchaseId}</span></p>}
      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">{proof && <CtaButton emphasis="secondary" type="button" disabled={view.kind === 'checking'} onClick={() => setRefresh(value => value + 1)}>Refresh status</CtaButton>}<a className="link" href={site.phoneHref}>Call Sergio, {site.phone}</a></div>
      <p className="gift-hint mt-5">Keep this purchase link private. The gift code is sent in the card emails and is never displayed on this status page.</p>
    </section>
    <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">{status?.payment === 'paid' && status.issuance === 'issued' && <CtaLink emphasis="secondary" href={href('/gift/')}>Give another</CtaLink>}<a className="link text-sm" href={href('/')}>Back to the home page</a></div>
  </div>
}
