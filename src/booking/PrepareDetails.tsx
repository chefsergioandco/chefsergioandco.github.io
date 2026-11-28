import { useCallback, useState } from 'react'
import { CtaButton } from '../components/CallToAction'
import { useReceiptPreparation } from './useReceiptPreparation'
import { RecoveryNotice } from '../preparation/RecoveryNotice'
import '../preparation/Preparation.css'
import { SensitiveDataConsent } from '../privacy/SensitiveDataConsent'
import { sensitiveDataConsent } from '../privacy/policy'
import type { GuestDetails } from './types'

const DIETARY = ['Vegetarian', 'Vegan', 'Gluten-free', 'Dairy-free']
/**
 * "Help Sergio prepare": the menu-conversation answers the one-screen booking leaves for after the deposit. They go
 * into Sergio's interview brief; anything he has already agreed with the guest is never overwritten.
 */
export function PrepareDetails({ bookingRef }: { bookingRef: string }) {
  const [sensitiveConsent,setSensitiveConsent] = useState(false)
  const [occasion, setOccasion] = useState(''), [dietary, setDietary] = useState<string[]>([]), [allergies, setAllergies] = useState('')
  const [foodIdeas, setFoodIdeas] = useState(''), [kitchen, setKitchen] = useState(''), [notes, setNotes] = useState('')
  const [budgetMode, setBudgetMode] = useState<'guidance' | 'range'>('guidance'), [budgetMin, setBudgetMin] = useState(''), [budgetMax, setBudgetMax] = useState(''), [budgetUnit, setBudgetUnit] = useState<'total' | 'per_person'>('total')
  const [budgetSelected, setBudgetSelected] = useState(false)
  const clearPrivate = useCallback(() => { setOccasion(''); setDietary([]); setAllergies(''); setFoodIdeas(''); setKitchen(''); setNotes(''); setBudgetMode('guidance'); setBudgetMin(''); setBudgetMax(''); setBudgetSelected(false); setSensitiveConsent(false) }, [])
  const flow = useReceiptPreparation(bookingRef, clearPrivate), { busy, error } = flow
  const recoveryLocked = busy || !!flow.pending || !flow.meta || flow.blocked
  const locked = recoveryLocked || !flow.meta?.canContribute
  const min = Number(budgetMin), max = Number(budgetMax)
  const rangeValid = budgetMode === 'guidance' || Number.isInteger(min) && Number.isInteger(max) && min >= 1 && max >= min
  const empty = !occasion.trim() && !dietary.length && !allergies.trim() && !foodIdeas.trim() && !kitchen.trim() && !notes.trim() && !budgetSelected

  function detailsInput(): GuestDetails {
    return {
      // An ordinary update leaves saved sensitive details alone; only Remove below withdraws them.
      ...(sensitiveConsent && (dietary.length || allergies.trim()) ? { sensitiveDataConsent: sensitiveDataConsent(true) } : {}),
      ...(occasion.trim() ? { occasion: occasion.trim() } : {}), ...(sensitiveConsent && dietary.length ? { dietary } : {}), ...(sensitiveConsent && allergies.trim() ? { allergies: allergies.trim() } : {}),
      ...(foodIdeas.trim() ? { foodIdeas: foodIdeas.trim() } : {}), ...(kitchen.trim() ? { kitchen: kitchen.trim() } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}),
      // The displayed default is not a request to replace a saved spending answer.
      ...(budgetSelected ? budgetMode === 'range' ? { budgetMode, budgetMin: min, budgetMax: max, budgetUnit } : { budgetMode } : {}),
    }
  }
  async function send() {
    if (locked || empty) return
    if (!rangeValid) { flow.setError('Enter a spending range in whole dollars, with the upper amount at least the lower.'); return }
    await flow.submit(detailsInput())
  }
  async function withdraw() { if (recoveryLocked || !flow.meta?.canWithdraw) return; await flow.submit({ sensitiveDataConsent: sensitiveDataConsent(false), dietary: [], allergies: '' }) }
  return <section className="booking-receipt-section" aria-labelledby="prepare-h">
    <p className="booking-eyebrow">Optional · about a minute</p>
    <h2 id="prepare-h" className="mt-2 text-2xl">Help Sergio prepare</h2>
    <p className="booking-small mt-2">Add what you know. We’ll confirm which details were recorded and which need Sergio’s review.</p>
    <div className="prep-details">{flow.notice && <p className="booking-notice mt-4" role="status">{flow.notice}</p>}{flow.meta?.actionResult?.state === 'recorded' && <div className="booking-small mt-2"><strong>Earlier submission result</strong><ul>{Object.entries(flow.meta.actionResult.outcomes).map(([field, outcome]) => <li key={field}>{({occasion:'Occasion',kitchen:'Kitchen',foodIdeas:'Food ideas',dietary:'Your dietary needs',allergies:'Your allergies',notes:'Additional note',budget:'Spending preference',physicalInvitations:'Physical invitations'} as Record<string,string>)[field]}: {({accepted:'Saved host answer',pending_review:'Saved for Sergio’s review',unchanged:'Already saved',cleared:'Explicitly cleared',withdrawn:'Withdrawn from the active brief',declined:'Declined',discussion:'Needs discussion',confirmed:'Arrangements checked'} as Record<string,string>)[outcome]}</li>)}</ul></div>}{flow.pending && <RecoveryNotice busy={busy} canRetry={flow.canRetry} check={() => void flow.load()} retry={() => void flow.retry()} discard={() => void flow.discard()}/>}{!flow.meta && <button type="button" className="link" disabled={busy} onClick={() => void flow.load()}>Refresh preparation form</button>}{flow.blocked && <p className="booking-notice booking-notice--error">Allow tab storage and refresh before contributing details.</p>}{flow.meta && !flow.meta.canContribute && <p>This private link cannot add further preparation answers. Sign in to your linked account to review your saved brief.</p>}<p className="booking-small mt-2">For saved answers, corrections and Sergio’s responses, open Your details in your <a className="link" href="/dashboard/">linked account</a>. This private receipt does not reveal saved personal answers.</p></div>
    <form className="quick-booking mt-6" noValidate onSubmit={event => { event.preventDefault(); void send() }}>
      <fieldset className="contents" disabled={locked} aria-label="Preparation details">
      <div className="booking-field quick-field"><label htmlFor="d-occasion">The occasion</label><input id="d-occasion" className="booking-input" maxLength={1000} value={occasion} onChange={event => setOccasion(event.target.value)} placeholder="A 50th birthday"/></div>
      <SensitiveDataConsent checked={sensitiveConsent} onChange={granted=>{setSensitiveConsent(granted);if(!granted){setDietary([]);setAllergies('')}}} disabled={locked} withdrawalInstruction="choose “Remove my saved dietary and allergy details” below"/><div className="quick-group"><p className="quick-label" id="d-dietary-label">Your own dietary needs</p><div className="quick-chips" role="group" aria-labelledby="d-dietary-label">{DIETARY.map(item => <button key={item} type="button" className="quick-chip" disabled={!sensitiveConsent || locked} aria-pressed={dietary.includes(item)} onClick={() => setDietary(dietary.includes(item) ? dietary.filter(value => value !== item) : [...dietary, item])}><span className="quick-chip-main">{item}</span></button>)}</div></div>
      <div className="booking-field quick-field"><label htmlFor="d-allergies">Allergies Sergio should discuss with you</label><textarea id="d-allergies" disabled={!sensitiveConsent || locked} className="booking-input" rows={2} maxLength={3000} value={allergies} onChange={event => setAllergies(event.target.value)}/></div>
      <div className="booking-field quick-field"><label htmlFor="d-food">What would you love to eat?</label><textarea id="d-food" className="booking-input" rows={2} maxLength={3000} value={foodIdeas} onChange={event => setFoodIdeas(event.target.value)} placeholder="A dish, an ingredient, a style of cooking"/></div>
      <div className="booking-field quick-field"><label htmlFor="d-kitchen">About the kitchen</label><textarea id="d-kitchen" className="booking-input" rows={2} maxLength={3000} value={kitchen} onChange={event => setKitchen(event.target.value)} placeholder="Gas or induction, oven, counter space"/></div>
      <div className="quick-group"><p className="quick-label" id="d-budget-label">Spending</p><div className="quick-chips" role="radiogroup" aria-labelledby="d-budget-label">
        <button type="button" className="quick-chip" role="radio" aria-checked={budgetMode === 'guidance'} onClick={() => { setBudgetMode('guidance'); setBudgetSelected(true) }}><span className="quick-chip-main">I’d like Sergio’s guidance</span></button>
        <button type="button" className="quick-chip" role="radio" aria-checked={budgetMode === 'range'} onClick={() => { setBudgetMode('range'); setBudgetSelected(true) }}><span className="quick-chip-main">I have a range in mind</span></button>
      </div></div>
      {budgetMode === 'range' && <div className="quick-contact">
        <div className="booking-field quick-field"><label htmlFor="d-min">From ($)</label><input id="d-min" className="booking-input" type="number" inputMode="numeric" min={1} step={1} value={budgetMin} onChange={event => setBudgetMin(event.target.value)}/></div>
        <div className="booking-field quick-field"><label htmlFor="d-max">Up to ($)</label><input id="d-max" className="booking-input" type="number" inputMode="numeric" min={1} step={1} value={budgetMax} onChange={event => setBudgetMax(event.target.value)}/></div>
        <div className="quick-chips" role="radiogroup" aria-label="The range is for">
          <button type="button" className="quick-chip" role="radio" aria-checked={budgetUnit === 'total'} onClick={() => setBudgetUnit('total')}><span className="quick-chip-main">The whole gathering</span></button>
          <button type="button" className="quick-chip" role="radio" aria-checked={budgetUnit === 'per_person'} onClick={() => setBudgetUnit('per_person')}><span className="quick-chip-main">Each guest</span></button>
        </div>
      </div>}
      <div className="booking-field quick-field"><label htmlFor="d-notes">Anything else</label><textarea id="d-notes" className="booking-input" rows={2} maxLength={5000} value={notes} onChange={event => setNotes(event.target.value)}/></div>

      {error && <p className="booking-notice booking-notice--error" role="alert">{error}</p>}
      <CtaButton type="submit" emphasis="secondary" disabled={locked || empty} aria-busy={busy || undefined}>{busy ? 'Checking…' : 'Send to Sergio'}</CtaButton>
      </fieldset>
    </form>
          <button className="link" type="button" disabled={recoveryLocked || !flow.meta?.canWithdraw} onClick={()=>void withdraw()}>Remove my saved dietary and allergy details</button>
  </section>
}
