import { useEffect, useState, type FormEvent } from 'react'
import { formatAmount } from '../../prototypes/sergio-admin/shared/gift-cards/artwork'
import { formatGiftCode, isGiftCode, normalizeGiftCode } from '../../prototypes/sergio-admin/shared/gift-cards/code'
import { CtaButton, CtaLink } from '../components/CallToAction'
import { href } from '../components/ui'
import { site } from '../content/site'
import { GiftCard } from './GiftCard'
import { giftCardStatus, GiftError, type GiftCardStatus } from './api'
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
      setView({ kind: 'error', message: code === 'not-found' ? 'We couldn’t find a card with that code. Check it against your email, or call Sergio.' : code === 'unavailable' ? 'Gift cards aren’t open online yet. Sergio can check your card by phone.' : 'The card service didn’t answer. Please try again in a moment.' })
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
          <p className="text-2xl" role="status">{card.status === 'frozen' ? 'This card is on hold. Please call Sergio.' : card.status === 'void' ? 'This card is no longer valid.' : card.balanceCents === card.amountCents ? `${formatAmount(card.balanceCents)} to spend.` : `${formatAmount(card.balanceCents)} left of ${formatAmount(card.amountCents)}.`}</p>
          <p className="text-ink-muted">It never expires. Use it in part or in full toward any dinner, class or gathering; it pays the deposit first, then the rest.</p>
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

/** Where Stripe returns the buyer. Nothing is fetched: the card is issued only once Stripe confirms payment. */
export function GiftThanks() {
  return <div className="gift-page wrap">
    <header className="gift-intro">
      <p className="font-display text-lg italic text-ink-muted">thank you</p>
      <h1 className="mt-2 text-4xl sm:text-5xl">Your gift is on its way.</h1>
      <p className="mt-5 max-w-prose text-lg text-ink-muted">Once Stripe confirms the payment, the card reaches them by email on the day you chose, with a copy to you. If anything looks wrong, call Sergio on {site.phone}.</p>
      <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3"><CtaLink emphasis="secondary" href={href('/gift/')}>Give another</CtaLink><a className="link text-sm" href={href('/')}>Back to the home page</a></div>
    </header>
  </div>
}
