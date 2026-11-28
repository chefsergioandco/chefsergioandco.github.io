import { useState } from 'react'
import { CtaButton } from '../components/CallToAction'
import { Icon } from '../components/Icons'
import { api } from './api'
import { SensitiveDataConsent } from '../privacy/SensitiveDataConsent'
import { sensitiveDataConsent } from '../privacy/policy'
import type { GuestDetails } from './types'

const DIETARY = ['Vegetarian', 'Vegan', 'Gluten-free', 'Dairy-free']

/**
 * "Help Sergio prepare": the menu-conversation answers the one-screen booking leaves for after the deposit. They go
 * into Sergio's interview brief; anything he has already agreed with the guest is never overwritten.
 */
export function PrepareDetails({ bookingRef }: { bookingRef: string }) {
  const [sensitiveConsent,setSensitiveConsent] = useState(false), [withdrawn,setWithdrawn]=useState(false)
  const [occasion, setOccasion] = useState(''), [dietary, setDietary] = useState<string[]>([]), [allergies, setAllergies] = useState('')
  const [foodIdeas, setFoodIdeas] = useState(''), [kitchen, setKitchen] = useState(''), [notes, setNotes] = useState('')
  const [budgetMode, setBudgetMode] = useState<'guidance' | 'range'>('guidance'), [budgetMin, setBudgetMin] = useState(''), [budgetMax, setBudgetMax] = useState(''), [budgetUnit, setBudgetUnit] = useState<'total' | 'per_person'>('total')
  const [busy, setBusy] = useState(false), [saved, setSaved] = useState(false), [error, setError] = useState('')
  const min = Number(budgetMin), max = Number(budgetMax)
  const rangeValid = budgetMode === 'guidance' || Number.isInteger(min) && Number.isInteger(max) && min >= 1 && max >= min
  const empty = !occasion.trim() && !dietary.length && !allergies.trim() && !foodIdeas.trim() && !kitchen.trim() && !notes.trim() && budgetMode === 'guidance'

  async function send() {
    if (busy || empty) return
    if (!rangeValid) { setError('Enter a spending range in whole dollars, with the upper amount at least the lower.'); return }
    setBusy(true); setError('')
    const details: GuestDetails = {
      // An ordinary update leaves saved sensitive details alone; only Remove below withdraws them.
      ...(sensitiveConsent && (dietary.length || allergies.trim()) ? { sensitiveDataConsent: sensitiveDataConsent(true) } : {}),
      ...(occasion.trim() ? { occasion: occasion.trim() } : {}), ...(sensitiveConsent && dietary.length ? { dietary } : {}), ...(sensitiveConsent && allergies.trim() ? { allergies: allergies.trim() } : {}),
      ...(foodIdeas.trim() ? { foodIdeas: foodIdeas.trim() } : {}), ...(kitchen.trim() ? { kitchen: kitchen.trim() } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}),
      ...(budgetMode === 'range' ? { budgetMode, budgetMin: min, budgetMax: max, budgetUnit } : {}),
    }
    try { await api.details(bookingRef, details); setSaved(true) }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Your details could not be saved. Please try again.') }
    finally { setBusy(false) }
  }

  async function withdraw() { if(busy)return;setBusy(true);setError('');try{await api.details(bookingRef,{sensitiveDataConsent:sensitiveDataConsent(false),dietary:[],allergies:''});setDietary([]);setAllergies('');setSensitiveConsent(false);setWithdrawn(true)}catch(failure){setError(failure instanceof Error?failure.message:'Withdrawal could not be confirmed. Retry the same action.')}finally{setBusy(false)} }
  if (saved) return <section className="booking-receipt-section" aria-live="polite"><p className="booking-eyebrow">Help Sergio prepare</p><p className="mt-2 flex items-start gap-2"><Icon name="circle-check" size={19} className="mt-1 shrink-0"/><span>Sent to Sergio. He’ll go through it with you in your menu conversation.</span></p></section>
  return <section className="booking-receipt-section" aria-labelledby="prepare-h">
    <p className="booking-eyebrow">Optional · about a minute</p>
    <h2 id="prepare-h" className="mt-2 text-2xl">Help Sergio prepare</h2>
    <p className="booking-small mt-2">Anything you share goes straight into your interview brief. Leave out whatever you haven’t decided.</p>
    <form className="quick-booking mt-6" noValidate onSubmit={event => { event.preventDefault(); void send() }}>
      <div className="booking-field quick-field"><label htmlFor="d-occasion">The occasion</label><input id="d-occasion" className="booking-input" maxLength={1000} value={occasion} onChange={event => setOccasion(event.target.value)} placeholder="A 50th birthday"/></div>
      <SensitiveDataConsent checked={sensitiveConsent} onChange={granted=>{setSensitiveConsent(granted);if(!granted){setDietary([]);setAllergies('')}}} disabled={busy}/><div className="quick-group"><p className="quick-label" id="d-dietary-label">Your own dietary needs</p><div className="quick-chips" role="group" aria-labelledby="d-dietary-label">{DIETARY.map(item => <button key={item} type="button" className="quick-chip" disabled={!sensitiveConsent || busy} aria-pressed={dietary.includes(item)} onClick={() => setDietary(dietary.includes(item) ? dietary.filter(value => value !== item) : [...dietary, item])}><span className="quick-chip-main">{item}</span></button>)}</div></div>
      <div className="booking-field quick-field"><label htmlFor="d-allergies">Allergies Sergio should discuss with you</label><textarea id="d-allergies" disabled={!sensitiveConsent || busy} className="booking-input" rows={2} maxLength={3000} value={allergies} onChange={event => setAllergies(event.target.value)}/></div>
      <div className="booking-field quick-field"><label htmlFor="d-food">What would you love to eat?</label><textarea id="d-food" className="booking-input" rows={2} maxLength={3000} value={foodIdeas} onChange={event => setFoodIdeas(event.target.value)} placeholder="A dish, an ingredient, a style of cooking"/></div>
      <div className="booking-field quick-field"><label htmlFor="d-kitchen">About the kitchen</label><textarea id="d-kitchen" className="booking-input" rows={2} maxLength={3000} value={kitchen} onChange={event => setKitchen(event.target.value)} placeholder="Gas or induction, oven, counter space"/></div>
      <div className="quick-group"><p className="quick-label" id="d-budget-label">Spending</p><div className="quick-chips" role="radiogroup" aria-labelledby="d-budget-label">
        <button type="button" className="quick-chip" role="radio" aria-checked={budgetMode === 'guidance'} onClick={() => setBudgetMode('guidance')}><span className="quick-chip-main">I’d like Sergio’s guidance</span></button>
        <button type="button" className="quick-chip" role="radio" aria-checked={budgetMode === 'range'} onClick={() => setBudgetMode('range')}><span className="quick-chip-main">I have a range in mind</span></button>
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
      <button className="link" type="button" disabled={busy} onClick={()=>void withdraw()}>Remove my saved dietary and allergy details</button>{withdrawn && <p role="status" className="booking-small">Your saved dietary and allergy details were removed from the active planning brief. Your booking is unchanged. Any required retained evidence is restricted to its permitted purpose.</p>}
      {error && <p className="booking-notice booking-notice--error" role="alert">{error}</p>}
      <CtaButton type="submit" emphasis="secondary" disabled={busy || empty} aria-busy={busy || undefined}>{busy ? 'Sending…' : 'Send to Sergio'}</CtaButton>
    </form>
  </section>
}
