import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { buildGiftCardArtwork, formatAmount, type GiftCardDocument, type GiftFace } from '../../prototypes/sergio-admin/shared/gift-cards/artwork'
import { CtaButton, CtaLink } from '../components/CallToAction'
import { href, TBD, track } from '../components/ui'
import { site } from '../content/site'
import { todayET } from '../booking/planning'
import { GiftCard } from './GiftCard'
import { giftConfig, GiftError, startGiftCheckout, type GiftConfig } from './api'
import './GiftPage.css'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const NOTE_MAX = 220
const yearAhead = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return `${y + 1}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` }

type Draft = { amountCents: number; recipientName: string; recipientEmail: string; senderName: string; senderEmail: string; note: string; sendOn: string }

/** The card the buyer is writing: what they see is exactly what is sent, and what would be printed. */
function cardDocument(draft: Draft): GiftCardDocument {
  return { amountCents: draft.amountCents, recipient: draft.recipientName, sender: draft.senderName, note: draft.note, redeemUrl: `${site.url}/book/`, phone: site.phone }
}

export function GiftPage() {
  const [config, setConfig] = useState<GiftConfig>({ ready: false, amounts: site.gift.amounts, fulfillment: null })
  const [draft, setDraft] = useState<Draft>({ amountCents: site.gift.amounts[2] ?? site.gift.amounts[0], recipientName: '', recipientEmail: '', senderName: '', senderEmail: '', note: '', sendOn: '' })
  const [face, setFace] = useState<GiftFace>('front')
  const [honeypot, setHoneypot] = useState('')
  const [errors, setErrors] = useState<Partial<Record<keyof Draft | 'form', string>>>({})
  const [busy, setBusy] = useState(false)
  const mounted = useRef(true)
  const download = config.fulfillment === 'download'
  const emailDelivery = config.fulfillment === 'email'
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  // Orlando's date, as the gift service checks it: a late order from another time zone still counts as today there.
  const today = useMemo(() => typeof window === 'undefined' ? '' : todayET(), [])

  useEffect(() => { void giftConfig(site.gift.amounts).then(setConfig) }, [])
  useEffect(() => { if (today) setDraft(current => current.sendOn ? current : { ...current, sendOn: today }) }, [today])
  useEffect(() => { if (!config.amounts.includes(draft.amountCents)) setDraft(current => ({ ...current, amountCents: config.amounts[Math.min(2, config.amounts.length - 1)] })) }, [config.amounts])

  // A note the printed card can't hold is refused here, before payment, with the last fitting card still shown.
  const [preview, noteError] = useMemo((): [GiftCardDocument, string] => {
    const document = cardDocument(draft)
    try { buildGiftCardArtwork(document); return [document, ''] }
    catch (error) {
      const reason = error instanceof RangeError && /typeface/.test(error.message) ? error.message : 'That’s more than the card holds. Shorten the note or the names.'
      return [cardDocument({ ...draft, note: '', recipientName: '', senderName: '' }), reason]
    }
  }, [draft])
  const set = (patch: Partial<Draft>) => { setDraft(current => ({ ...current, ...patch })); setErrors(current => ({ ...current, ...Object.fromEntries(Object.keys(patch).map(key => [key, undefined])), form: undefined })) }

  const validate = () => {
    const next: typeof errors = {}
    if (!draft.recipientName.trim()) next.recipientName = 'Who is it for?'
    if (!download && !EMAIL.test(draft.recipientEmail.trim())) next.recipientEmail = 'Their email, so the card can reach them.'
    if (!draft.senderName.trim()) next.senderName = 'Your name, as it should appear on the card.'
    if (!EMAIL.test(draft.senderEmail.trim())) next.senderEmail = 'Enter your email for the payment record.'
    if (noteError) next.note = noteError
    if (!download && (!draft.sendOn || draft.sendOn < today || draft.sendOn > yearAhead(today))) next.sendOn = 'Choose a day from today to a year ahead.'
    if (!config.ready || !config.fulfillment) next.form = 'Refresh the gift page before continuing to payment.'
    return next
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    const next = validate()
    setErrors(next)
    if (Object.keys(next).length) { (document.getElementById(`gift-${Object.keys(next)[0]}`) as HTMLElement | null)?.focus(); return }
    setBusy(true)
    try {
      track('gift_checkout', { amount: String(draft.amountCents) })
      const purchase = { amountCents: draft.amountCents, recipientName: draft.recipientName.trim(), senderName: draft.senderName.trim(), senderEmail: draft.senderEmail.trim(), note: draft.note.trim() }
      const url = await startGiftCheckout(download ? { ...purchase, fulfillment: 'download' } : { ...purchase, fulfillment: 'email', recipientEmail: draft.recipientEmail.trim(), sendOn: draft.sendOn }, honeypot)
      if (mounted.current) window.location.assign(url)
    } catch (error) {
      if (mounted.current) { setErrors({ form: error instanceof GiftError ? error.message : 'The payment page could not be confirmed. Retry this purchase or contact Sergio before starting another payment.' }); setBusy(false) }
    }
  }
  const field = (key: keyof Draft) => ({ id: `gift-${key}`, 'aria-invalid': errors[key] ? true : undefined, 'aria-describedby': errors[key] ? `gift-${key}-error` : undefined })
  const message = (key: keyof Draft) => errors[key] ? <p className="gift-error" id={`gift-${key}-error`}>{errors[key]}</p> : null
  const back = () => setFace('back'), front = () => setFace('front')

  return <div className="gift-page wrap">
    <header className="gift-intro">
      <p className="font-display text-lg italic text-ink-muted">an evening to give</p>
      <h1 className="mt-2 text-4xl sm:text-5xl">Give a dinner, not a thing.</h1>
      <p className="mt-5 max-w-prose text-lg text-ink-muted">A gift card toward a private dinner, a cooking class or a gathering with Sergio. {download ? 'Download it after payment and give it to them yourself. It never expires.' : config.fulfillment === 'email' ? 'It reaches them by email on the day you choose, and it never expires.' : 'Choose the amount and make it personal. It never expires.'}</p>
    </header>
    <div className="gift-layout">
      <div className="gift-object">
        <GiftCard document={preview} face={face} label={`${formatAmount(draft.amountCents)} gift card`} />
        <div className="gift-object-actions">
          <button type="button" className="link text-sm" onClick={() => setFace(face === 'front' ? 'back' : 'front')} aria-pressed={face === 'back'}>Turn it over</button>
          <p className="text-sm text-ink-muted">Gloss black and rouge foil on plastic. Drag it, or scroll, to catch the light.</p>
        </div>
      </div>
      <form className="gift-form" onSubmit={submit} noValidate>
        <fieldset className="gift-fieldset" onFocus={front} disabled={busy}>
          <legend className="gift-legend">Amount {!site.gift.amountsConfirmed && !config.fulfillment && <TBD k="gift.amounts">Amounts to confirm with Sergio</TBD>}</legend>
          <div className="gift-amounts" role="radiogroup" aria-label="Amount">
            {config.amounts.map(amount => <label key={amount} className="gift-amount" data-checked={draft.amountCents === amount}>
              <input type="radio" name="gift-amount" value={amount} checked={draft.amountCents === amount} onChange={() => set({ amountCents: amount })} />
              <span>{formatAmount(amount)}</span>
            </label>)}
          </div>
          <p className="gift-hint">Use it in part or in full. Whatever is left stays on the card.</p>
        </fieldset>
        <fieldset className="gift-fieldset" onFocus={back} disabled={busy}>
          <legend className="gift-legend">For</legend>
          <div className={emailDelivery ? 'gift-pair' : undefined}>
            <label className="gift-field"><span>Their name</span><input {...field('recipientName')} className="gift-input" autoComplete="off" maxLength={60} value={draft.recipientName} onChange={event => set({ recipientName: event.target.value })} />{message('recipientName')}</label>
            {emailDelivery && <label className="gift-field"><span>Their email</span><input {...field('recipientEmail')} className="gift-input" type="email" autoComplete="off" maxLength={254} value={draft.recipientEmail} onChange={event => set({ recipientEmail: event.target.value })} />{message('recipientEmail')}</label>}
          </div>
        </fieldset>
        <fieldset className="gift-fieldset" onFocus={back} disabled={busy}>
          <legend className="gift-legend">From</legend>
          <div className="gift-pair">
            <label className="gift-field"><span>Your name</span><input {...field('senderName')} className="gift-input" autoComplete="name" maxLength={60} value={draft.senderName} onChange={event => set({ senderName: event.target.value })} />{message('senderName')}</label>
          <label className="gift-field"><span>Your email</span><input {...field('senderEmail')} className="gift-input" type="email" autoComplete="email" maxLength={254} value={draft.senderEmail} onChange={event => set({ senderEmail: event.target.value })} />{message('senderEmail')}</label>
          </div>
          <label className="gift-field" onFocus={back}><span>A note <span className="text-ink-muted">(optional)</span></span>
            <textarea {...field('note')} className="gift-input gift-note" rows={3} maxLength={NOTE_MAX} value={draft.note} onChange={event => set({ note: event.target.value })} />
            <span className="gift-hint" aria-live="polite">{noteError || `${NOTE_MAX - draft.note.length} characters left. It’s printed on the back of the card.`}</span>
            {errors.note && !noteError ? message('note') : null}
          </label>
        </fieldset>
        {emailDelivery && <fieldset className="gift-fieldset" onFocus={front} disabled={busy}>
          <label className="gift-field"><span>Send it on</span><input {...field('sendOn')} className="gift-input gift-date" type="date" min={today || undefined} max={today ? yearAhead(today) : undefined} value={draft.sendOn} onChange={event => set({ sendOn: event.target.value })} />
            <span className="gift-hint">Scheduled for that morning, Orlando time. Same-day orders placed later are sent after payment. Your receipt and card copy are sent after payment and issuance.</span>{message('sendOn')}</label>
        </fieldset>}
        {download && <section className="gift-delivery-note" aria-label="How you will receive this card"><h2 className="gift-legend">Download and give</h2><p>After payment is confirmed, return here to download the front and back of your gift card as a PDF. Save it, print it or share the file with them yourself.</p><p className="gift-hint">No card email is sent to you or the recipient. Keep your private purchase link so you can download it again.</p></section>}
        <label className="gift-trap" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={honeypot} onChange={event => setHoneypot(event.target.value)} /></label>
        <ul className="gift-terms">
          <li>Never expires, and there are no fees.</li>
          <li>Toward any dinner, class or gathering with Chef Sergio &amp; Co. Not exchangeable for cash, except where the law requires.</li>
          <li>{site.gift.refundsConfirmed ? site.gift.refunds : <TBD k="gift.refunds">{site.gift.refunds}</TBD>}</li>
        </ul>
        {errors.form ? <p className="gift-error" role="alert">{errors.form}</p> : null}
        {config.ready
          ? <CtaButton emphasis="primary" type="submit" disabled={busy} aria-busy={busy}>{busy ? 'Opening payment…' : `Continue to payment, ${formatAmount(draft.amountCents)}`}</CtaButton>
          : <div className="gift-closed" role="status">
              <p>Online gift cards open soon. Until then, Sergio can arrange one with you directly.</p>
              <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
                <CtaLink emphasis="primary" href={`mailto:${site.email}?subject=${encodeURIComponent(`A ${formatAmount(draft.amountCents)} gift card`)}`} onClick={() => track('cta_gift', { where: 'gift-closed' })}>Email Sergio</CtaLink>
                <a className="link text-sm" href={site.phoneHref}>Or call {site.phone}</a>
              </div>
            </div>}
      </form>
    </div>
    <section className="gift-how" aria-labelledby="gift-how-heading">
      <h2 id="gift-how-heading" className="text-3xl">How the gift works</h2>
      <ol>
        <li><h3>Write the card</h3><p>Choose the amount and write it to them. The card above is the card they receive.</p></li>
        <li><h3>{download ? 'Download and give' : config.fulfillment === 'email' ? 'Choose their day' : 'Receive the card'}</h3><p>{download ? 'After payment is confirmed, download the two-sided PDF from your private purchase page. Print it or share the file when the moment is right.' : config.fulfillment === 'email' ? 'The recipient’s card is scheduled for that morning, Orlando time, or after payment for later same-day orders. Your receipt and card copy are sent after payment and issuance.' : 'Delivery details are confirmed before you continue to payment.'}</p></li>
        <li><h3>They book with it</h3><p>They <a className="link" href={href('/book/')}>book like anyone else</a> and enter the code. It pays the deposit first, then the rest of the evening.</p></li>
      </ol>
    </section>
  </div>
}
