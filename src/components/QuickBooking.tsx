import { useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { api } from '../booking/api'
import { attachFriend, forgetFriendCode, lookupFriend, pendingFriendCode, type FriendCode, type FriendInvite } from '../booking/referral'
import { navigateAccount } from '../account/navigation'
import { Calendar } from '../booking/Calendar'
import { addMonths, clock, longDate, money } from '../booking/format'
import { todayET, validDate } from '../booking/planning'
import { formatFits, formatsFor, nextOpenDays, preferredTime, quickBand, quickRequest, QUICK_EMPTY, validateQuick, type QuickState } from '../booking/quick'
import { BookingError, type Availability, type PlanningConfig, type PublicHoldResult } from '../booking/types'
import { site, type FormatKey } from '../content/site'
import { formatGiftCode, isGiftCode } from '../../prototypes/sergio-admin/shared/gift-cards/code'
import { CtaButton } from './CallToAction'
import { Icon } from './Icons'
import { href, track } from './ui'
import './BookingForm.css'
import './QuickBooking.css'

const FORMAT_CHOICE: Record<FormatKey, { title: string; detail: string; noun: string }> = {
  dinner: { title: 'A seated dinner', detail: 'Sergio cooks and serves at your table.', noun: 'a private dinner' },
  event: { title: 'A catered party', detail: 'Staff, tablecloths, dinnerware and glassware.', noun: 'a small event' },
  class: { title: 'A cooking class', detail: 'Cook with Sergio, then eat together.', noun: 'a cooking class' },
}
const shortDay = (iso: string) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })

function Group({ id, label, error, children, hint }: { id: string; label: string; error?: string; hint?: ReactNode; children: ReactNode }) {
  return <div className="quick-group" id={`wrap-${id}`}>
    <p className="quick-label" id={`${id}-label`}>{label}</p>
    {hint && <p className="booking-field-hint">{hint}</p>}
    <div id={id} tabIndex={-1} role="radiogroup" aria-labelledby={`${id}-label`} aria-invalid={!!error} aria-describedby={error ? `${id}-err` : undefined} className="quick-chips">{children}</div>
    {error && <p id={`${id}-err`} className="booking-field-error">{error}</p>}
  </div>
}
function Chip({ checked, onClick, children, detail, pressed }: { checked: boolean; onClick: () => void; children: ReactNode; detail?: ReactNode; pressed?: boolean }) {
  return <button type="button" className="quick-chip" {...(pressed ? { 'aria-pressed': checked } : { role: 'radio', 'aria-checked': checked })} onClick={onClick}>
    <span className="quick-chip-main">{children}</span>{detail && <span className="quick-chip-detail">{detail}</span>}
  </button>
}
function Input({ id, label, error, hint, ...props }: { id: string; label: string; error?: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return <div className="booking-field quick-field" id={`wrap-${id}`}><label htmlFor={id}>{label}</label>{hint && <p id={`${id}-hint`} className="booking-field-hint">{hint}</p>}<input id={id} className="booking-input" aria-invalid={!!error} aria-describedby={[hint && `${id}-hint`, error && `${id}-err`].filter(Boolean).join(' ') || undefined} {...props}/>{error && <p id={`${id}-err`} className="booking-field-error">{error}</p>}</div>
}

/**
 * The one-screen booking. On a product page the format is set by the page; on /book/ the party size decides which
 * formats are offered. Everything for the menu conversation is asked after the deposit, on the booking page.
 */
export function QuickBooking({ format: fixed, initialState, onDraft, onMoreDetails, onReceived, getDraftIdentity, registerRecovery }: { format?: FormatKey; initialState?: QuickState; onDraft?: (state: QuickState) => void; onMoreDetails?: (state: QuickState) => void; onReceived?: () => void; getDraftIdentity?: () => string | undefined; registerRecovery?: (handler: (result: PublicHoldResult) => Promise<void>, ownerId: string) => () => void }) {
  const [s, setState] = useState<QuickState>({ ...QUICK_EMPTY, format: fixed, ...initialState })
  const [config, setConfig] = useState<PlanningConfig | null>(null), [configError, setConfigError] = useState(''), [configRetry, setConfigRetry] = useState(0)
  const [months, setMonths] = useState<(Availability | null)[]>([null, null]), [availabilityError, setAvailabilityError] = useState(''), [availabilityRetry, setAvailabilityRetry] = useState(0)
  const [otherDate, setOtherDate] = useState(false), [calMonth, setCalMonth] = useState(() => todayET().slice(0, 7)), [calAvail, setCalAvail] = useState<Availability | null>(null)
  const [calError, setCalError] = useState(''), [calRetry, setCalRetry] = useState(0)
  const [errors, setErrors] = useState<Record<string, string>>({}), [submissionError, setSubmissionError] = useState(''), [busy, setBusy] = useState(false)
  const [honeypot, setHoneypot] = useState(''), [giftOpen, setGiftOpen] = useState(false), [switched, setSwitched] = useState('')
  const [friendCode, setFriendCode] = useState<FriendCode | null>(null), [friend, setFriend] = useState<FriendInvite | null>(null), [friendNotice, setFriendNotice] = useState('')
  const [savedRequest, setSavedRequest] = useState<PublicHoldResult | null>(null), [friendFailure, setFriendFailure] = useState('')
  const inFlight = useRef(false)
  const active = useRef(true), ownerId = useRef(crypto.randomUUID()), submittedPath = useRef('')
  const currentForm = () => active.current && (!submittedPath.current || submittedPath.current === location.pathname + location.search)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const set = (patch: Partial<QuickState>) => { setState(previous => ({ ...previous, ...patch })); setErrors({}) }
  const latestDraft = useRef(onDraft); latestDraft.current = onDraft
  useEffect(() => { latestDraft.current?.(s) }, [s])
  useEffect(() => { const hide = () => { active.current = false; setState(previous => ({ ...previous, dietary: [], place: '', gift: '' })) }; window.addEventListener('pagehide', hide); return () => window.removeEventListener('pagehide', hide) }, [])
  const today = todayET(), band = quickBand(s, config), format = s.format
  const kindForDates: FormatKey = format ?? 'dinner'
  const loadedDays = [...(months[0]?.days ?? []), ...(months[1]?.days ?? []), ...(calAvail?.days ?? [])]
  const times = loadedDays.find(day => day.date === s.date)?.times ?? []
  const chips = nextOpenDays(months, today, 6)
  const availabilityLoaded = !!months[0] && !availabilityError

  useEffect(() => {
    let current = true
    const pending = pendingFriendCode(); setFriendCode(pending)
    if (pending) lookupFriend(pending.code, pending.source).then(value => {
      if (!current) return
      setFriend(value)
      if (!value) setFriendNotice('This invitation could not be verified. You can still send your booking request.')
    }, () => { if (current) setFriendNotice('Your invitation could not be checked yet. We’ll try again when your request is saved.') })
    return () => { current = false }
  }, [])

  // Prefill from the address: ?guests, ?date, ?where, ?type (on /book/ only) and a gift code from #gift= (an older
  // ?gift= link still works, but the code is taken out of the address so it isn't bookmarked or shared).
  useEffect(() => {
    if (initialState) return
    const query = new URLSearchParams(location.search), patch: Partial<QuickState> = {}
    const type = query.get('type') as FormatKey | null
    if (!fixed && type && type in site.formats) patch.format = type
    const where = query.get('where'); if (where === 'rental' || where === 'his') patch.where = where
    const date = query.get('date'); if (date && validDate(date) && date >= todayET()) { patch.date = date; patch.dateMode = 'exact' }
    const giftCode = new URLSearchParams(window.location.hash.slice(1)).get('gift') ?? query.get('gift')
    if (giftCode) {
      patch.gift = (isGiftCode(giftCode) ? formatGiftCode(giftCode) : giftCode).slice(0, 100); setGiftOpen(true)
      if (query.has('gift')) { const clean = new URL(window.location.href); clean.searchParams.delete('gift'); history.replaceState(history.state, '', clean.pathname + clean.search) }
    }
    const guests = Number(query.get('guests'))
    setState(previous => ({ ...previous, ...patch, ...(Number.isInteger(guests) && guests > 0 ? { partyBandId: `guests:${guests}` } : {}) }))
  }, [fixed])
  useEffect(() => {
    let current = true; setConfigError('')
    api.config().then(value => { if (current) setConfig(value) }, failure => { if (current) setConfigError(failure instanceof Error ? failure.message : 'Booking settings could not be loaded.') })
    return () => { current = false }
  }, [configRetry])
  // A ?guests= prefill becomes the band that contains it once the bands are known.
  useEffect(() => {
    if (!config || !s.partyBandId.startsWith('guests:')) return
    const count = Number(s.partyBandId.slice(7)), found = config.partyBands.find(item => count >= item.min && count <= item.max)
    setState(previous => ({ ...previous, partyBandId: found?.id ?? '' }))
  }, [config, s.partyBandId])
  // The next open evenings: this month and next, loaded as the page opens.
  useEffect(() => {
    let current = true; setAvailabilityError('')
    const first = today.slice(0, 7), second = addMonths(first, 1)
    Promise.all([api.availability(kindForDates, first), api.availability(kindForDates, second)]).then(values => { if (current) setMonths(values) }, failure => { if (current) setAvailabilityError(failure instanceof Error ? failure.message : 'Open dates could not be loaded.') })
    return () => { current = false }
  }, [kindForDates, availabilityRetry, today])
  useEffect(() => {
    if (!otherDate) return
    let current = true; setCalAvail(null); setCalError('')
    api.availability(kindForDates, calMonth).then(value => { if (current) setCalAvail(value) }, failure => { if (current) setCalError(failure instanceof Error ? failure.message : 'This month could not be loaded. Please try again.') })
    return () => { current = false }
  }, [otherDate, calMonth, kindForDates, calRetry])
  // A prefilled date gets its usual start time once the open times are known.
  useEffect(() => { if (s.date && !s.time && times.length) setState(previous => ({ ...previous, time: preferredTime(times) })) }, [s.date, s.time, times.join()])

  function chooseBand(id: string) {
    const chosen = config?.partyBands.find(item => item.id === id)
    const fits = chosen ? formatsFor(chosen, fixed ?? s.format) : []
    let next = s.format
    if (chosen && (!next || !formatFits(next, chosen))) {
      // One fitting format is chosen for the guest; several are left to them.
      next = fits.length === 1 ? fits[0] : fixed && fits.includes(fixed) ? fixed : undefined
      setSwitched(fixed && next && next !== fixed ? `For ${chosen.label.toLowerCase()}, Sergio plans ${FORMAT_CHOICE[next].noun}.` : '')
    } else setSwitched('')
    set({ partyBandId: id, format: next, where: next !== 'dinner' && s.where === 'his' ? 'home' : s.where })
  }
  function reveal(key: string) {
    // Wait for the error description to render before focus announces the field.
    requestAnimationFrame(() => {
      const element = document.getElementById(`f-${key}`) ?? document.getElementById(key)
      if (!element) return
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      element.closest<HTMLElement>('.quick-group, .booking-field')?.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' })
      element.focus({ preventScroll: true })
    })
  }
  const canPay = !!config?.paymentReady && band?.deposit != null && config.planningFee != null
  async function openSavedBooking(result: PublicHoldResult) {
    if (!currentForm()) return
    setBusy(true)
    try {
      if (canPay && !result.checkout?.paid) {
        if (result.checkout?.url) { window.location.assign(result.checkout.url); return }
        // An older booking service answers without a checkout: open it the usual way.
        if (!result.checkoutError) {
          try { const checkout = await api.checkout(result.ref); if (!currentForm()) return; if (!checkout.paid) { window.location.assign(checkout.url); return } }
          catch (failure) { try { sessionStorage.setItem('booking-pay-error:' + result.ref, failure instanceof Error ? failure.message : 'Checkout could not be opened. Your request is saved.') } catch { /* The receipt still offers payment. */ } }
        } else try { sessionStorage.setItem('booking-pay-error:' + result.ref, result.checkoutError.message) } catch { /* The receipt still offers payment. */ }
      }
      if (!currentForm()) return
      const destination = new URL(result.url, window.location.href)
      if (destination.origin === window.location.origin && destination.pathname === href('/book/done/')) { navigateAccount(destination.pathname + destination.search + destination.hash); window.scrollTo(0, 0) }
      else window.location.assign(result.url)
    } catch {
      setSavedRequest(result); setBusy(false)
      setSubmissionError('Your request is saved, but its page could not be opened. Continue to try opening the same booking again.')
    }
  }
  async function connectFriend(result: PublicHoldResult) {
    if (!currentForm()) return
    const pending = friendCode ?? pendingFriendCode()
    if (pending) {
      try { await attachFriend(result.ref, result.accessToken, pending); forgetFriendCode(pending.code); setFriendFailure('') }
      catch (failure) {
        setSavedRequest(result); setBusy(false)
        setFriendFailure(failure instanceof Error ? failure.message : 'The invitation credit could not be confirmed.')
        return
      }
    }
    if (currentForm()) await openSavedBooking(result)
  }
  async function submit() {
    if (inFlight.current) return
    const found = validateQuick(s, config, { openTimes: times, availabilityLoaded, today })
    setErrors(found)
    const first = Object.keys(found)[0]
    if (first) { reveal(first); track('booking_error', { step: 'quick', field: first }); return }
    submittedPath.current = location.pathname + location.search; inFlight.current = true; setBusy(true); setSubmissionError('')
    try {
      const result = await api.hold(quickRequest(s), honeypot, { checkout: canPay, elapsedMs: Math.round(performance.now()), draftId: getDraftIdentity?.(), ownerId: ownerId.current })
      if (!currentForm()) return
      onReceived?.()
      track('booking_submitted', { kind: s.format ?? '', quick: 'yes' })
      await connectFriend(result)
    } catch (failure) {
      if (!currentForm()) return
      inFlight.current = false; setBusy(false)
      setSubmissionError(failure instanceof Error ? failure.message : 'Your request could not be confirmed. Your answers are still here.')
      if (failure instanceof BookingError && failure.code === 'unavailable') { set({ date: undefined, time: undefined }); setAvailabilityRetry(value => value + 1) }
    }
  }

  useEffect(() => registerRecovery?.(async result => { if (!currentForm()) return; onReceived?.(); await connectFriend(result) }, ownerId.current))

  const fits = band ? formatsFor(band, fixed ?? s.format) : []
  const showFormats = !fixed ? !!band && fits.length > 1 : !!band && !formatFits(fixed, band) && fits.length > 1
  const action = busy ? 'Opening your booking…' : canPay ? s.dateMode === 'exact' && s.date ? `Hold ${shortDay(s.date)} · ${money(band!.deposit!)} deposit` : `Continue to ${money(band!.deposit!)} deposit` : 'Send your request'

  if (savedRequest) return <section className="quick-booking booking-referral-recovery" aria-label="Your saved booking">
    <h2>Your request is saved.</h2><p>Reference: <strong>{savedRequest.ref}</strong>. You do not need to send it again.</p>
    <p role="alert">{friendFailure || submissionError}</p>{friendFailure && <p>The invitation credit is not confirmed. You can retry it, or continue and ask Sergio to check your invitation.</p>}
    <div className="cta-pair">{friendFailure && <CtaButton emphasis="secondary" disabled={busy} onClick={() => { setBusy(true); void connectFriend(savedRequest) }}>{busy ? 'Checking…' : 'Retry invitation'}</CtaButton>}<CtaButton emphasis="primary" disabled={busy} onClick={() => void openSavedBooking(savedRequest)}>{canPay ? 'Continue to payment' : 'Continue to your booking'}</CtaButton></div>
    <p className="booking-help">Need help? <a className="link" href={site.phoneHref}>Call Sergio</a> with your booking reference.</p>
  </section>

  return <div><form className="quick-booking" noValidate onSubmit={event => { event.preventDefault(); void submit() }} aria-label="Book with Sergio">
    <div aria-hidden="true" className="booking-honeypot"><label>Website<input name="website" autoComplete="off" tabIndex={-1} value={honeypot} onChange={event => setHoneypot(event.target.value)}/></label></div>
    {configError && <div className="booking-notice" role="alert" id="f-config" tabIndex={-1}><p>{configError}</p><button type="button" className="link" onClick={() => setConfigRetry(value => value + 1)}>Reload booking settings</button></div>}
    {friend && <p className="booking-friend" role="status"><Icon name="gift" size={18}/><span><strong>Invited by {friend.name}{friend.name.endsWith('.') ? '' : '.'}</strong> Eligible first bookings can receive {money(friend.welcome)} off the final bill. We’ll confirm eligibility when you send your request.</span></p>}
    {friendNotice && <p className="booking-small" role="status">{friendNotice}</p>}

    <Group id="f-partyBand" label="How many people?" error={errors.partyBand}>
      {config ? config.partyBands.map(item => <Chip key={item.id} checked={s.partyBandId === item.id} onClick={() => chooseBand(item.id)} detail={item.deposit != null ? `${money(item.deposit)} deposit` : undefined}>{item.label}</Chip>) : !configError && <span className="quick-loading" role="status">Loading…</span>}
    </Group>
    {switched && <p className="quick-note" role="status"><Icon name="circle-check" size={17}/>{switched}</p>}
    {(showFormats || errors.format) && <Group id="f-format" label="What kind of gathering?" error={errors.format}>
      {(band ? fits : Object.keys(FORMAT_CHOICE) as FormatKey[]).map(item => <Chip key={item} checked={s.format === item} onClick={() => { setSwitched(''); set({ format: item, where: item !== 'dinner' && s.where === 'his' ? 'home' : s.where }) }} detail={FORMAT_CHOICE[item].detail}>{FORMAT_CHOICE[item].title}</Chip>)}
    </Group>}

    <Group id="f-date" label="When?" error={errors.date || errors.time} hint={<>Sergio’s open evenings · Eastern time</>}>
      {!months[0] && !availabilityError && <span className="quick-loading" role="status">Finding open evenings…</span>}
      {chips.map(day => <Chip key={day.date} checked={s.dateMode === 'exact' && s.date === day.date} onClick={() => { setOtherDate(false); set({ dateMode: 'exact', date: day.date, time: preferredTime(day.times) }) }} detail={clock(preferredTime(day.times)!)}>{shortDay(day.date)}</Chip>)}
      {availabilityLoaded && <Chip checked={otherDate && s.dateMode === 'exact'} onClick={() => { setOtherDate(true); set({ dateMode: 'exact', date: undefined, time: undefined }) }}>Other date</Chip>}
      <Chip checked={s.dateMode === 'undecided'} onClick={() => { setOtherDate(false); set({ dateMode: 'undecided', date: undefined, time: undefined }) }} detail="Settle it with Sergio">Not sure yet</Chip>
    </Group>
    {availabilityError && <div className="booking-notice" role="alert"><p>{availabilityError}</p><button className="link" type="button" onClick={() => setAvailabilityRetry(value => value + 1)}>Reload open dates</button></div>}
    {otherDate && s.dateMode === 'exact' && <div className="booking-calendar-section quick-calendar">
      <Calendar month={calMonth} days={calAvail?.days ?? []} loading={!calAvail && !calError} error={calError} onRetry={() => setCalRetry(value => value + 1)} value={s.date} minMonth={today.slice(0, 7)} nextOpen={calAvail?.nextOpen ?? null} onMonth={setCalMonth} onSelect={date => { const open = calAvail?.days.find(day => day.date === date)?.times ?? []; set({ date, time: preferredTime(open) }) }}/>
    </div>}
    {s.dateMode === 'exact' && s.date && times.length > 0 && <div className="booking-field quick-time" id="wrap-f-time">
      <label htmlFor="f-time">Start time on {longDate(s.date)}</label>
      <select id="f-time" className="booking-input" value={s.time ?? ''} onChange={event => set({ time: event.target.value })} aria-invalid={!!errors.time}>{times.map(time => <option key={time} value={time}>{clock(time)}</option>)}</select>
    </div>}

    {(site.features.vacationRentals || (site.features.sergiosTable && format === 'dinner')) && <Group id="f-where" label="Where?" error={errors.where}>
      <Chip checked={s.where === 'home'} onClick={() => set({ where: 'home' })}>At home</Chip>
      {site.features.vacationRentals && <Chip checked={s.where === 'rental'} onClick={() => set({ where: 'rental' })}>A vacation rental</Chip>}
      {site.features.sergiosTable && format === 'dinner' && <Chip checked={s.where === 'his'} onClick={() => set({ where: 'his' })}>At Sergio’s table</Chip>}
    </Group>}

    <div className="quick-contact">
      <Input id="f-name" label="Your name" autoComplete="name" maxLength={150} value={s.name} onChange={event => set({ name: event.target.value })} error={errors.name}/>
      <Input id="f-email" label="Email" type="email" inputMode="email" autoComplete="email" maxLength={254} value={s.email} onChange={event => set({ email: event.target.value })} error={errors.email}/>
      <Input id="f-phone" label={`Phone${s.contactBy === 'email' ? ' (optional)' : ''}`} type="tel" autoComplete="tel" maxLength={40} value={s.phone} onChange={event => set({ phone: event.target.value })} error={errors.phone}/>
      {s.where !== 'his' && <Input id="f-place" label="City (optional)" autoComplete="address-level2" maxLength={300} value={s.place} onChange={event => set({ place: event.target.value })} placeholder={`Within ${config?.travelMiles ?? 75} miles of Clermont`}/>}
    </div>
    {(s.phone.replace(/\D/g, '').length >= 10 || s.contactBy !== 'email') && <Group id="f-contactBy" label="Sergio will reach you by">
      {(['email', 'call', 'text'] as const).map(item => <Chip key={item} checked={s.contactBy === item} onClick={() => set({ contactBy: item })}>{item === 'email' ? 'Email' : item === 'call' ? 'Phone call' : 'Text'}</Chip>)}
    </Group>}
    {giftOpen
      ? <Input id="f-gift" label="Gift card code" hint="Sergio applies the card to your deposit, then the rest." maxLength={100} autoComplete="off" spellCheck={false} value={s.gift} onChange={event => set({ gift: event.target.value.toUpperCase() })} onBlur={() => { if (isGiftCode(s.gift)) set({ gift: formatGiftCode(s.gift) }) }} error={errors.gift ?? (s.gift.trim() && !isGiftCode(s.gift) ? 'That code isn’t complete. It has 16 characters; the letters I, L, O and U aren’t used.' : undefined)}/>
      : <button type="button" className="link quick-gift" onClick={() => setGiftOpen(true)}>Have a gift card?</button>}

    <section className="quick-terms" aria-label="Payment and next steps" data-money-line>
      {canPay ? <>
        <p><strong>{money(band!.deposit!)} deposit</strong>, credited in full to your event bill. Your menu and final price come from your conversation with Sergio.</p>
        <p>{s.dateMode === 'exact' ? 'Your receipt states whether your date is reserved.' : 'No date is reserved until you and Sergio agree one.'} Cancel before Sergio sends your menu-interview invitation for a full refund{config?.planningFee ? `; after that, a planning fee of up to ${money(config.planningFee)} may be kept` : ''}.</p>
      </> : config?.paymentReady && !band ? <p>A deposit holds your request and is credited in full to your event bill. Choose how many people to see it.</p> : <p>No card is taken. Sergio reviews your request and contacts you.</p>}
      <p className="quick-after">Right after, you can tell Sergio the occasion, food ideas, allergies and kitchen.</p>
    </section>
    {submissionError && <p className="booking-notice booking-notice--error" role="alert">{submissionError} Your answers are still here. You can also <a className="link" href={site.phoneHref}>call Sergio</a>.</p>}
    <CtaButton type="submit" emphasis="primary" className="quick-submit" disabled={busy || !config} aria-busy={busy || undefined}>{action}</CtaButton>
    <p className="booking-help">More than 24 guests, or a private cooking class for your group? <a className="link" href={site.phoneHref}>Ask Sergio at {site.phone}</a>.{site.features.sergiosTable && !fixed ? <> Joining a published evening? <a className="link" href={href('/sergios-table/')}>Sergio’s table</a>.</> : null}</p>
  </form>{onMoreDetails && <p className="booking-more-details"><button type="button" className="link" disabled={busy} onClick={() => onMoreDetails(s)}>Add more detail before sending</button><span className="booking-small"> Your current date and contact choices carry across in this tab.</span></p>}</div>
}
