import * as Checkbox from '@radix-ui/react-checkbox'
import * as RadioGroup from '@radix-ui/react-radio-group'
import { AnimatePresence, m, useReducedMotion } from 'framer-motion'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '../booking/api'
import { navigateAccount } from '../account/navigation'
import { Calendar } from '../booking/Calendar'
import { addMonths, clock, longDate, money } from '../booking/format'
import { budgetLabel, DRAFT_KEY, EMPTY, migrateLegacyDraft, planningRequest, selectedBand, todayET, validDate, validDraft, validatePlanningStep, type PlanningState, type SavedDraft } from '../booking/planning'
import { canRequestNight, NightPicker } from '../booking/TableNights'
import { BookingError, type Availability, type Kind, type Night, type PlanningConfig } from '../booking/types'
import { booking } from '../content/booking'
import { site } from '../content/site'
import { BookingBrief } from './BookingBrief'
import { CtaButton } from './CallToAction'
import { Icon } from './Icons'
import { href, track } from './ui'
import './BookingForm.css'

const KINDS: { key: Kind; title: string; detail: string }[] = [
  { key: 'dinner', title: 'A private dinner', detail: 'A personal menu, cooked and served for your people.' },
  { key: 'class', title: 'A cooking class', detail: 'Cook with Sergio, then gather around what you made.' },
  { key: 'event', title: 'A small event', detail: 'A graduation, a milestone, a reason to bring everyone together.' },
  ...(site.features.sergiosTable ? [{ key: 'table' as const, title: 'Seats at Sergio’s table', detail: 'Choose a published evening with its own menu and fellow guests.' }] : []),
]
const DIETARY = ['Vegetarian', 'Vegan', 'Gluten-free', 'Dairy-free']
const STEPS = ['Your gathering', 'What’s settled', 'Your starting ideas', 'Review and continue']
const TABLE_STEPS = ['Your gathering', 'Night and seats', 'Your requirements', 'Review and continue']
const inputClass = 'booking-input'
function ErrorText({ id, error }: { id: string; error?: string }) { return error ? <p id={`${id}-err`} className="booking-field-error">{error}</p> : null }
function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: ReactNode }) {
  return <div id={`wrap-${id}`} className="booking-field"><label htmlFor={id}>{label}</label>{hint && <p id={`${id}-hint`} className="booking-field-hint">{hint}</p>}{children}<ErrorText id={id} error={error}/></div>
}
function Check({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <div className="booking-check"><Checkbox.Root id={id} checked={checked} onCheckedChange={value => onChange(value === true)} className="booking-checkbox"><Checkbox.Indicator><Icon name="check" size={15}/></Checkbox.Indicator></Checkbox.Root><label htmlFor={id}>{label}</label></div>
}
function Choices<T extends string>({ id, label, value, onChange, options, error }: { id: string; label: string; value?: T; onChange: (value: T) => void; options: { value: T; label: string; detail?: string }[]; error?: string }) {
  return <fieldset className="booking-field" id={`wrap-${id}`}><legend>{label}</legend><RadioGroup.Root id={id} tabIndex={-1} aria-label={label} aria-invalid={!!error} aria-describedby={error ? `${id}-err` : undefined} value={value} onValueChange={value => onChange(value as T)} className="booking-choices">{options.map(option => <RadioGroup.Item key={option.value} value={option.value} className={`booking-choice ${option.detail ? 'booking-choice--detailed' : ''}`}><span className="booking-choice-marker"><RadioGroup.Indicator/></span><span><span className="booking-choice-label">{option.label}</span>{option.detail && <span className="booking-choice-detail">{option.detail}</span>}</span></RadioGroup.Item>)}</RadioGroup.Root><ErrorText id={id} error={error}/></fieldset>
}
function NumberStepper({ id, value, min, max, onChange, label, error }: { id: string; value?: number; min: number; max: number; onChange: (value?: number) => void; label: string; error?: string }) {
  return <div className="booking-stepper"><button type="button" aria-label={`One fewer ${label}`} disabled={(value ?? min) <= min} onClick={() => onChange(Math.max(min, (value ?? min + 1) - 1))}>−</button><input className={inputClass} id={id} type="number" inputMode="numeric" min={min} max={max} aria-label={label} aria-invalid={!!error} aria-describedby={error ? `${id}-err` : undefined} value={value ?? ''} onChange={event => onChange(event.target.value ? Number(event.target.value) : undefined)}/><button type="button" aria-label={`One more ${label}`} disabled={(value ?? 0) >= max} onClick={() => onChange(Math.min(max, (value ?? min - 1) + 1))}>+</button></div>
}

export function BookingForm() {
  const [s, setState] = useState<PlanningState>(EMPTY), [step, setStep] = useState(0), [direction, setDirection] = useState(1)
  const [config, setConfig] = useState<PlanningConfig | null>(null), [configError, setConfigError] = useState(''), [configRetry, setConfigRetry] = useState(0)
  const [avail, setAvail] = useState<Availability | null>(null), [availabilityError, setAvailabilityError] = useState(''), [availabilityRetry, setAvailabilityRetry] = useState(0)
  const [month, setMonth] = useState(() => todayET().slice(0, 7)), [nights, setNights] = useState<Night[] | null>(null), [nightsError, setNightsError] = useState(''), [nightsRetry, setNightsRetry] = useState(0)
  const [errors, setErrors] = useState<Record<string, string>>({}), [submissionError, setSubmissionError] = useState(''), [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<SavedDraft | null>(null), [hydrated, setHydrated] = useState(false), [honeypot, setHoneypot] = useState(''), [giftOpen, setGiftOpen] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null), inFlight = useRef(false), reduced = useReducedMotion()
  const set = (patch: Partial<PlanningState>) => { setState(previous => ({ ...previous, ...patch })); setErrors({}) }
  const table = s.kind === 'table', format = s.kind && s.kind !== 'table' ? s.kind : undefined
  const night = nights?.find(item => item.id === s.nightId), band = selectedBand(s, config)
  const times = avail?.days.find(day => day.date === s.date)?.times ?? []
  const seatsMax = night ? Math.max(1, Math.min(booking.table.maxSeatsPerBooking, night.seats - night.taken)) : booking.table.maxSeatsPerBooking
  const labels = table ? TABLE_STEPS : STEPS

  useEffect(() => {
    const query = new URLSearchParams(location.search), patch: Partial<PlanningState> = {}
    let saved: SavedDraft | null = null
    try {
      const candidate = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null')
      saved = validDraft(candidate) ? candidate : migrateLegacyDraft(JSON.parse(localStorage.getItem('booking-draft') || 'null'))
    } catch { /* Storage is optional. */ }
    if (query.get('resume') && saved) { setState(saved.s); setStep(saved.step); if (saved.s.date) setMonth(saved.s.date.slice(0, 7)) }
    else {
      const kind = query.get('type') as Kind
      if (KINDS.some(item => item.key === kind)) patch.kind = kind
      const where = query.get('where'); if (where === 'rental' || where === 'his' && kind === 'dinner') patch.where = where
      const count = Number(query.get('guests')); if (Number.isInteger(count) && count > 0 && count <= 24) { patch.guests = count; patch.headcountMode = 'exact' }
      const date = query.get('date'); if (date && validDate(date) && date >= todayET()) { patch.date = date; setMonth(date.slice(0, 7)) }
      const when = query.get('when'); if (when && ['this', 'next', 'later'].includes(when)) {
        patch.dateMode = 'flexible'
        if (when !== 'later') { const start = when === 'next' ? `${addMonths(todayET().slice(0, 7), 1)}-01` : todayET(); patch.dateFrom = start; patch.dateTo = new Date(Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)), 0, 12)).toISOString().slice(0, 10) }
      }
      if (query.get('night')) patch.nightId = query.get('night')!.slice(0, 100)
      if (query.get('gift')) { patch.gift = query.get('gift')!.slice(0, 100); setGiftOpen(true) }
      setState(previous => ({ ...previous, ...patch })); if (patch.kind) setStep(1); else if (saved && !query.toString()) setDraft(saved)
    }
    setHydrated(true)
  }, [])
  useEffect(() => {
    if (!hydrated || !s.kind || draft) return
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ version: 2, savedAt: new Date().toISOString(), step, s })) } catch { /* A server receipt never depends on local storage. */ }
  }, [s, step, hydrated, draft])
  useEffect(() => {
    let current = true; setConfigError('')
    api.config().then(value => { if (current) setConfig(value) }, failure => { if (current) setConfigError(failure instanceof Error ? failure.message : 'Booking settings could not be loaded.') })
    return () => { current = false }
  }, [configRetry])
  useEffect(() => {
    if (!config || s.partyBandId || !s.guests) return
    const found = config.partyBands.find(item => s.guests! >= item.min && s.guests! <= item.max)
    if (found) setState(previous => ({ ...previous, partyBandId: found.id }))
  }, [config, s.guests, s.partyBandId])
  useEffect(() => {
    if (!format || s.dateMode !== 'exact') return
    let current = true; setAvail(null); setAvailabilityError('')
    api.availability(format, month).then(value => { if (current) setAvail(value) }, failure => { if (current) setAvailabilityError(failure instanceof Error ? failure.message : 'Open dates could not be loaded.') })
    return () => { current = false }
  }, [format, month, s.dateMode, availabilityRetry])
  useEffect(() => {
    if (!table) return
    let current = true; setNights(null); setNightsError('')
    api.nights().then(value => { if (current) setNights(value) }, failure => { if (current) setNightsError(failure instanceof Error ? failure.message : 'Upcoming nights could not be loaded.') })
    return () => { current = false }
  }, [table, nightsRetry])

  function check(index: number) {
    const found = validatePlanningStep(s, index, config, { openTimes: times, availabilityLoaded: !!avail && !availabilityError, night, seatsMax })
    if (index === 1 && table && night && !canRequestNight(night)) found.night = 'Choose a night with places still available.'
    setErrors(found)
    const first = Object.keys(found)[0]
    if (first) { requestAnimationFrame(() => (document.getElementById(`f-${first}`) ?? heading.current)?.focus()); track('booking_error', { step: String(index + 1), field: first }) }
    return !first
  }
  function go(target: number) { setDirection(target > step ? 1 : -1); setStep(target); setErrors({}); requestAnimationFrame(() => heading.current?.focus()) }
  function next() { if (check(step)) { track('booking_step', { step: String(step + 2), kind: s.kind ?? '' }); go(step + 1) } }
  async function submit() {
    if (inFlight.current) return
    for (const index of [0, 1, 2, 3]) if (!check(index)) { setDirection(index > step ? 1 : -1); setStep(index); return }
    inFlight.current = true; setBusy(true); setSubmissionError('')
    try {
      const result = await api.hold(planningRequest(s), honeypot)
      try { localStorage.removeItem(DRAFT_KEY); localStorage.removeItem('booking-draft') } catch { /* The confirmed server receipt is sufficient. */ }
      const destination = new URL(result.url, window.location.href)
      if (result.next === 'done' && destination.origin === window.location.origin && destination.pathname === href('/book/done/')) {
        navigateAccount(destination.pathname + destination.search + destination.hash)
        window.scrollTo(0, 0)
      } else window.location.assign(result.url)
    } catch (failure) {
      inFlight.current = false; setBusy(false); setSubmissionError(failure instanceof Error ? failure.message : 'Your request could not be confirmed. Your answers are still here.')
      if (failure instanceof BookingError && ['unavailable', 'seats-gone'].includes(failure.code)) { setAvail(null); setAvailabilityRetry(value => value + 1); setNightsRetry(value => value + 1); go(1) }
    }
  }
  const seatTotal = night?.pricePerSeat != null ? night.pricePerSeat * s.seats : null
  const canPay = !!config?.paymentReady && (table ? seatTotal != null : band?.deposit != null && config.planningFee != null)
  const action = table ? canPay ? 'Continue to seat payment' : `Request ${s.seats} ${s.seats === 1 ? 'seat' : 'seats'}` : canPay ? `Continue to ${money(band!.deposit!)} deposit` : 'Send your planning request'
  const described = (id: string, hint = false) => [hint && `${id}-hint`, errors[id.replace('f-', '')] && `${id}-err`].filter(Boolean).join(' ') || undefined

  return <div className="booking-layout">
    <form className="booking-flow" noValidate onSubmit={event => { event.preventDefault(); step === 3 ? void submit() : next() }}>
      <div aria-hidden="true" className="booking-honeypot"><label>Website<input name="website" autoComplete="off" tabIndex={-1} value={honeypot} onChange={event => setHoneypot(event.target.value)}/></label></div>
      {draft && <div className="booking-draft" role="status"><div><strong>Your gathering is still here.</strong><p>Continue the details you saved on {new Date(draft.savedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}.</p></div><div className="cta-pair"><CtaButton type="button" emphasis="secondary" onClick={() => { setState(draft.s); setStep(draft.step); if (draft.s.date) setMonth(draft.s.date.slice(0, 7)); setDraft(null) }}>Continue it</CtaButton><button type="button" className="link" onClick={() => { try { localStorage.removeItem(DRAFT_KEY); localStorage.removeItem('booking-draft') } catch {} setDraft(null) }}>Start fresh</button></div></div>}
      <div className="booking-step-heading"><p className="booking-eyebrow">{table ? 'An evening at Sergio’s table' : 'A gathering shaped around you'}</p><span>Step {step + 1} of 4</span></div>
      <h2 ref={heading} tabIndex={-1} className="booking-step-title">{labels[step]}</h2>
      <ol className="booking-progress" aria-label="Booking progress">{labels.map((label, index) => <li key={label} aria-current={step === index ? 'step' : undefined} className={index <= step ? 'reached' : ''}><span className="sr-only">{label}{index < step ? ', completed' : ''}</span></li>)}</ol>
      {configError && <div className="booking-notice" role="alert" id="f-config" tabIndex={-1}><p>{configError}</p><button type="button" className="link" onClick={() => setConfigRetry(value => value + 1)}>Reload booking settings</button></div>}
      {!!Object.keys(errors).length && <div className="booking-error-summary" role="alert"><strong>A few details need your attention.</strong><ul>{Object.entries(errors).map(([key, value]) => <li key={key}><button type="button" onClick={() => document.getElementById(`f-${key}`)?.focus()}>{value}</button></li>)}</ul></div>}
      <AnimatePresence initial={false} mode="wait" custom={direction}><m.div key={`${step}-${table}`} custom={direction} initial={reduced ? false : { opacity: 0, x: direction * 14 }} animate={{ opacity: 1, x: 0 }} exit={reduced ? undefined : { opacity: 0, x: direction * -10 }} transition={{ duration: reduced ? 0 : 0.18 }} className="booking-step-content" data-step={step}>
        {step === 0 && <>
          <Choices id="f-kind" label="What are you planning?" value={s.kind} onChange={kind => set({ kind, where: kind === 'dinner' ? s.where : s.where === 'his' ? 'home' : s.where })} options={KINDS.map(item => ({ value: item.key, label: item.title, detail: item.detail }))} error={errors.kind}/>
          {!table && <Field id="f-occasion" label="What’s the occasion?" hint="Optional. A graduation, an anniversary, or simply dinner together."><input id="f-occasion" className={inputClass} maxLength={1000} value={s.occasion} onChange={event => set({ occasion: event.target.value })} placeholder="A college graduation with our family" aria-describedby="f-occasion-hint"/></Field>}
          <p className="booking-small">Giving an experience? <a className="link" href={href('/gift/')}>Explore gift cards</a>.</p>
        </>}
        {step === 1 && table && <>
          <p className="booking-intro">A published evening has its own date and menu. Choose where you’d like to join.</p>
          {nightsError ? <div className="booking-notice" role="alert"><p>{nightsError}</p><button type="button" className="link" onClick={() => setNightsRetry(value => value + 1)}>Try again</button></div> : nights ? <NightPicker paymentReady={!!config?.paymentReady} nights={nights} value={s.nightId} onChange={nightId => { const picked = nights.find(item => item.id === nightId); set({ nightId, seats: Math.max(1, Math.min(s.seats, picked ? picked.seats - picked.taken : 6)) }) }} error={errors.night}/> : <p role="status">Loading Sergio’s published evenings…</p>}
          <Field id="f-seats" label="How many seats?" error={errors.seats}><NumberStepper id="f-seats" label="seats" error={errors.seats} value={s.seats} min={1} max={seatsMax} onChange={value => set({ seats: value ?? 1 })}/></Field>
          <p className="booking-small">A group of more than {booking.table.maxSeatsPerBooking}? <a className="link" href={href('/book/?type=dinner&where=his')}>Plan a private gathering at Sergio’s table</a>.</p>
        </>}
        {step === 1 && !table && <>
          <p className="booking-intro">Start with what you know. Anything unsettled becomes a question for your interview.</p>
          <Choices id="f-dateMode" label="How settled is your date?" value={s.dateMode} onChange={dateMode => set({ dateMode })} options={[{ value: 'exact', label: 'I have a date in mind' }, { value: 'flexible', label: 'My dates are flexible' }, { value: 'undecided', label: 'Help me choose a date' }]}/>
          {s.dateMode === 'exact' && <div className="booking-calendar-section" id="f-date" tabIndex={-1} aria-describedby={errors.date ? 'f-date-err' : undefined}>
            <p className="booking-field-hint">Sergio’s saved availability · Eastern time · At least one week’s notice.</p>
            <Calendar month={month} days={avail?.days ?? []} loading={!avail && !availabilityError} value={s.date} minMonth={todayET().slice(0, 7)} nextOpen={avail?.nextOpen ?? null} onMonth={setMonth} onSelect={date => { const available = avail?.days.find(day => day.date === date)?.times ?? []; set({ date, time: available.includes(s.time ?? '') ? s.time : undefined }) }}/>
            <ErrorText id="f-date" error={errors.date}/>
            {availabilityError && <div className="booking-notice" role="alert"><p>{availabilityError}</p><button className="link" type="button" onClick={() => setAvailabilityRetry(value => value + 1)}>Reload open dates</button></div>}
            {s.date && times.length > 0 && <Choices id="f-time" label={`Start time on ${longDate(s.date)}`} value={s.time} onChange={time => set({ time })} options={times.map(time => ({ value: time, label: clock(time) }))} error={errors.time}/>}
          </div>}
          {s.dateMode === 'flexible' && <div className="booking-field-pair"><Field id="f-dateFrom" label="From (optional)" error={errors.dateFrom}><input className={inputClass} id="f-dateFrom" type="date" min={todayET()} value={s.dateFrom} onChange={event => set({ dateFrom: event.target.value })} aria-invalid={!!errors.dateFrom} aria-describedby={described('f-dateFrom')}/></Field><Field id="f-dateTo" label="Through (optional)" error={errors.dateTo}><input className={inputClass} id="f-dateTo" type="date" min={s.dateFrom || todayET()} value={s.dateTo} onChange={event => set({ dateTo: event.target.value })} aria-invalid={!!errors.dateTo} aria-describedby={described('f-dateTo')}/></Field></div>}
          {s.dateMode !== 'exact' && <p className="booking-inline-note"><Icon name="calendar-days" size={19}/><span>Your interview can settle the date. A planning deposit does not reserve a date until one is agreed.</span></p>}
          {config ? <Choices id="f-partyBand" label="About how many people?" value={s.partyBandId} onChange={partyBandId => { const chosen = config.partyBands.find(item => item.id === partyBandId); set({ partyBandId, guests: s.guests && chosen && s.guests >= chosen.min && s.guests <= chosen.max ? s.guests : undefined }) }} options={config.partyBands.map(item => ({ value: item.id, label: item.label, detail: item.deposit == null ? undefined : `${money(item.deposit)} deposit, credited to your event` }))} error={errors.partyBand}/> : !configError && <p role="status">Loading party-size ranges…</p>}
          <Check id="f-exactHeadcount" label="I know the exact guest count" checked={s.headcountMode === 'exact'} onChange={checked => set({ headcountMode: checked ? 'exact' : 'approximate' })}/>
          {s.headcountMode === 'exact' && <Field id="f-guests" label="Number of guests" error={errors.guests}><NumberStepper id="f-guests" label="guests" error={errors.guests} value={s.guests} min={band?.min ?? 1} max={band?.max ?? config?.maxGuests ?? 24} onChange={guests => set({ guests })}/></Field>}
          <Choices id="f-where" label="Where are you gathering?" value={s.where} onChange={where => set({ where })} options={[{ value: 'home', label: 'At home' }, ...(site.features.vacationRentals ? [{ value: 'rental' as const, label: 'A vacation rental' }] : []), ...(site.features.sergiosTable && s.kind === 'dinner' ? [{ value: 'his' as const, label: 'Sergio’s whole table' }] : [])]}/>
          {s.where !== 'his' && <><Field id="f-place" label="City or neighborhood (if you know)" hint={`Usually within ${config?.travelMiles ?? 75} miles of Clermont, Florida. Sergio reviews travel and venue suitability.`}><input id="f-place" className={inputClass} value={s.place} maxLength={300} autoComplete="address-level2" onChange={event => set({ place: event.target.value })} placeholder="Winter Park" aria-describedby="f-place-hint"/></Field><Field id="f-kitchen" label="What can you tell us about the kitchen?" hint={config?.kitchenRequirements || 'Optional. Share what you know about the equipment and preparation space. Sergio will clarify what the menu needs.'}><textarea id="f-kitchen" className={inputClass} rows={3} maxLength={2000} value={s.kitchen} onChange={event => set({ kitchen: event.target.value })} aria-describedby="f-kitchen-hint" placeholder="Or leave this for your conversation with Sergio."/></Field></>}
        </>}
        {step === 2 && <>
          {!table && <>
            <p className="booking-intro">A direction is enough. Sergio will agree on a spending ceiling with you during the interview, then finish a menu within it.</p>
            <Choices id="f-budgetMode" label="Do you have a spending range in mind?" value={s.budgetMode} onChange={budgetMode => set({ budgetMode })} options={[{ value: 'guidance', label: 'I’d like Sergio’s guidance' }, { value: 'range', label: 'I have a comfortable range' }]}/>
            {s.budgetMode === 'range' && <><Choices id="f-budgetUnit" label="That range is for…" value={s.budgetUnit} onChange={budgetUnit => set({ budgetUnit })} options={[{ value: 'total', label: 'The whole gathering' }, { value: 'per_person', label: 'Each guest' }]}/><div className="booking-field-pair"><Field id="f-budgetMin" label="From ($)" error={errors.budgetMin}><input id="f-budgetMin" type="number" inputMode="decimal" step="0.01" className={inputClass} min={1} max={1000000} value={s.budgetMin} onChange={event => set({ budgetMin: event.target.value })} aria-invalid={!!errors.budgetMin} aria-describedby={described('f-budgetMin')}/></Field><Field id="f-budgetMax" label="Up to ($)" error={errors.budgetMax}><input id="f-budgetMax" type="number" inputMode="decimal" step="0.01" className={inputClass} min={1} max={1000000} value={s.budgetMax} onChange={event => set({ budgetMax: event.target.value })} aria-invalid={!!errors.budgetMax} aria-describedby={described('f-budgetMax')}/></Field></div></>}
            <Field id="f-foodIdeas" label="What would you love to eat?" hint="Optional. A dish, a favorite ingredient, a style of cooking, or the feeling you want."><textarea id="f-foodIdeas" className={inputClass} rows={3} maxLength={2000} value={s.foodIdeas} onChange={event => set({ foodIdeas: event.target.value })} aria-describedby="f-foodIdeas-hint" placeholder="We’re celebrating a graduation. Something like cordon bleu would be lovely."/></Field>
          </>}
          {table && night && <div className="booking-night-menu"><p className="booking-eyebrow">{night.title}</p><p>{night.menu}</p></div>}
          <fieldset className="booking-field"><legend>Dietary requirements (if known)</legend><p className="booking-field-hint">These are requirements for Sergio to review. He will confirm what he can accommodate.</p><div className="booking-dietary">{DIETARY.map(item => <Check key={item} id={`diet-${item}`} label={item} checked={s.dietary.includes(item)} onChange={checked => set({ dietary: checked ? [...s.dietary, item] : s.dietary.filter(value => value !== item) })}/>)}</div></fieldset>
          <Field id="f-allergies" label="Any allergies Sergio should discuss with you?" hint="Optional if not yet known. Please describe allergies separately from food preferences."><textarea id="f-allergies" className={inputClass} rows={3} maxLength={2000} value={s.allergies} onChange={event => set({ allergies: event.target.value })} aria-describedby="f-allergies-hint"/></Field>
          <Field id="f-notes" label="Anything else for your conversation?" hint="Optional. Any details you haven’t settled can be discussed with Sergio."><textarea id="f-notes" className={inputClass} rows={3} maxLength={4000} value={s.notes} onChange={event => set({ notes: event.target.value })} aria-describedby="f-notes-hint"/></Field>
        </>}
        {step === 3 && <>
          <p className="booking-intro">{canPay ? 'Review your gathering and what today’s payment secures.' : 'Your ideas will go straight to Sergio’s dashboard. Online payments are not enabled yet, so this step sends an unpaid request.'}</p>
          <div className="booking-review-mobile"><BookingBrief state={s} config={config} night={night} compact/></div>
          <Field id="f-name" label="Your name" error={errors.name}><input id="f-name" className={inputClass} autoComplete="name" maxLength={150} value={s.name} onChange={event => set({ name: event.target.value })} aria-invalid={!!errors.name} aria-describedby={described('f-name')}/></Field>
          <Field id="f-email" label="Email" error={errors.email}><input id="f-email" className={inputClass} type="email" autoComplete="email" maxLength={254} value={s.email} onChange={event => set({ email: event.target.value })} aria-invalid={!!errors.email} aria-describedby={described('f-email')}/></Field>
          <Choices id="f-contactBy" label="How would you like Sergio to reach you?" value={s.contactBy} onChange={contactBy => set({ contactBy })} options={[{ value: 'email', label: 'Email' }, { value: 'call', label: 'Phone call' }, { value: 'text', label: 'Text message' }]}/>
          <Field id="f-phone" label={`Phone${s.contactBy === 'email' ? ' (optional)' : ''}`} error={errors.phone}><input id="f-phone" className={inputClass} type="tel" autoComplete="tel" maxLength={40} value={s.phone} onChange={event => set({ phone: event.target.value })} aria-invalid={!!errors.phone} aria-describedby={described('f-phone')}/></Field>
          {!table && <div className="booking-invitations"><Check id="f-physical" label="I’m interested in physical invitations for my guests" checked={s.physicalInvitations} onChange={physicalInvitations => set({ physicalInvitations })}/><p className="booking-field-hint">Your digital invitation is a link you can share, with guest RSVPs and dietary details. Physical invitations are optional and sent to you.{config?.postageAllowance != null ? ` The fixed postage allowance is ${money(config.postageAllowance)}, added to the final bill.` : ' Sergio will confirm the physical-invitation cost and postage before adding them to your final bill.'}</p></div>}
          {giftOpen ? <Field id="f-gift" label="Gift card code" hint="Sergio checks and applies any credit separately."><input id="f-gift" className={inputClass} maxLength={100} value={s.gift} onChange={event => set({ gift: event.target.value.toUpperCase() })}/></Field> : <button type="button" className="link" onClick={() => setGiftOpen(true)}>Have a gift card?</button>}
          <section className="booking-payment-review" aria-label="Payment and next steps" data-money-line>
            <div className="booking-payment-total"><span>{table ? 'Listed seat total' : 'Your deposit'}</span><strong>{table ? seatTotal == null ? 'To be confirmed' : money(seatTotal) : band?.deposit == null ? 'To be confirmed' : money(band.deposit)}</strong></div>
            {table ? <><p>{canPay ? `Your seats are held for checkout${config?.checkoutMinutes ? ` for ${config.checkoutMinutes} minutes` : ''}. Complete payment to secure them.` : 'This sends a seat request. It does not hold seats, save a card, or take payment.'}</p>{night && <p>{night.state === 'confirmed' ? 'This evening is confirmed.' : `This evening is awaiting its minimum of ${night.minimum} guests. Sergio’s decision date is ${longDate(night.cutoff.slice(0, 10))}.`} When paid seats are cancelled by Sergio, the seat payment is refunded in full.</p>}</> : <><p>{canPay ? 'The whole deposit is credited toward your event bill. Your menu and final price follow the interview, within the spending ceiling you agree with Sergio.' : 'No money is collected here. Your deposit amount and planning fee still need to be confirmed before online checkout can open. Sergio can discuss your gathering from this request.'}</p><p>{s.dateMode === 'exact' ? canPay ? 'A date reservation and payment will each be stated on your receipt. Requests outside Sergio’s service criteria need his review.' : 'Your selected date is a preference until Sergio confirms it. Sending this request does not reserve it.' : 'Your event date is still to be agreed. No calendar date is reserved by a flexible-date planning deposit.'}</p>{config?.planningFee != null && <p><strong>Cancellation:</strong> Before Sergio sends your menu-interview invitation, cancellation receives a full deposit refund. An explicit cancellation afterward may retain a planning fee of {money(config.planningFee)}; Sergio may choose to refund fully. An unanswered invitation or a request for another interview time keeps the booking active.</p>}</>}
            {!canPay && <p className="booking-payment-status"><Icon name="circle-check" size={17}/><span>Request only · No card saved · No payment taken</span></p>}
          </section>
          <p className="booking-small">{table ? 'Sergio reviews your requirements and seat availability.' : 'Sergio’s interview brief will include your answers and everything still to clarify.'} <button type="button" className="link" onClick={() => go(1)}>Edit the details</button></p>
        </>}
      </m.div></AnimatePresence>
      {submissionError && <p className="booking-notice booking-notice--error" role="alert">{submissionError} Your answers are still here. You can also <a className="link" href={site.phoneHref}>call Sergio</a>.</p>}
      <div className="booking-actions">{step > 0 && <CtaButton type="button" emphasis="secondary" disabled={busy} onClick={() => go(step - 1)}>Back</CtaButton>}<CtaButton type="submit" emphasis="primary" disabled={busy || step === 3 && !config} aria-busy={busy || undefined}>{busy ? 'Sending your request…' : step === 3 ? action : 'Continue'}</CtaButton></div>
      <p className="booking-help">Prefer to talk it through? <a className="link" href={site.phoneHref}>Call {site.phone}</a>.</p>
    </form>
    <div className="booking-summary-column"><BookingBrief state={s} config={config} night={night}/><p className="booking-summary-caption">Your starting brief, carried into your conversation with Sergio.</p></div>
  </div>
}
