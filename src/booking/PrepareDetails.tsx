import { useState } from 'react'
import { CtaButton } from '../components/CallToAction'
import { api } from './api'
import { DETAILS_FIELDS } from './details-result'
import { SensitiveDataConsent } from '../privacy/SensitiveDataConsent'
import { sensitiveDataConsent } from '../privacy/policy'
import { site } from '../content/site'
import type { DetailsField, DetailsOutcome, DetailsResult, GuestDetails } from './types'

const DIETARY = ['Vegetarian', 'Vegan', 'Gluten-free', 'Dairy-free']
const FIELD_LABELS: Record<DetailsField, string> = { occasion: 'Occasion', kitchen: 'Kitchen', foodIdeas: 'Food ideas', dietary: 'Dietary needs', allergies: 'Allergies', notes: 'Additional note', budget: 'Spending', physicalInvitations: 'Physical invitations', sensitiveDataConsent: 'Permission for dietary information' }
const OUTCOME_LABELS: Record<DetailsOutcome, string> = { recorded: 'Recorded', unchanged: 'Already recorded', requires_review: 'Not applied · discuss with Sergio', unverified: 'Not confirmed' }

/**
 * "Help Sergio prepare": the menu-conversation answers the one-screen booking leaves for after the deposit. They go
 * into Sergio's interview brief; anything he has already agreed with the guest is never overwritten.
 */
export function PrepareDetails({ bookingRef }: { bookingRef: string }) {
  const [sensitiveConsent,setSensitiveConsent] = useState(false), [withdrawn,setWithdrawn]=useState(false)
  const [occasion, setOccasion] = useState(''), [dietary, setDietary] = useState<string[]>([]), [allergies, setAllergies] = useState('')
  const [foodIdeas, setFoodIdeas] = useState(''), [kitchen, setKitchen] = useState(''), [notes, setNotes] = useState('')
  const [budgetMode, setBudgetMode] = useState<'guidance' | 'range'>('guidance'), [budgetMin, setBudgetMin] = useState(''), [budgetMax, setBudgetMax] = useState(''), [budgetUnit, setBudgetUnit] = useState<'total' | 'per_person'>('total')
  const [budgetSelected, setBudgetSelected] = useState(false)
  const [busy, setBusy] = useState(false), [acknowledgment, setAcknowledgment] = useState<{ result: DetailsResult; input: string } | null>(null), [error, setError] = useState('')
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
  const input = JSON.stringify(detailsInput()), matchesAcknowledgment = acknowledgment?.input === input
  const outcomes = acknowledgment?.result.outcomes ?? {}, needsReview = Object.values(outcomes).includes('requires_review'), unverified = Object.values(outcomes).includes('unverified')
  const confirmedSubmission = !!matchesAcknowledgment && !unverified

  async function send() {
    if (busy || empty || confirmedSubmission) return
    if (!rangeValid) { setError('Enter a spending range in whole dollars, with the upper amount at least the lower.'); return }
    setBusy(true); setError(''); setWithdrawn(false)
    const details = detailsInput()
    try { const receipt = await api.details(bookingRef, details); setAcknowledgment({ result: receipt.detailsResult, input: JSON.stringify(details) }) }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Your details could not be saved. Please try again.') }
    finally { setBusy(false) }
  }

  async function withdraw() {
    if (busy) return
    setBusy(true); setError('')
    try {
      const receipt = await api.details(bookingRef, { sensitiveDataConsent: sensitiveDataConsent(false), dietary: [], allergies: '' })
      if (!(['sensitiveDataConsent', 'dietary', 'allergies'] as const).every(field => ['recorded', 'unchanged'].includes(receipt.detailsResult.outcomes[field] ?? ''))) throw new Error('Removal could not be confirmed. Your answers are still here. Retry Remove or call Sergio.')
      setDietary([]); setAllergies(''); setSensitiveConsent(false); setAcknowledgment(null); setWithdrawn(true)
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Withdrawal could not be confirmed. Retry the same action.') }
    finally { setBusy(false) }
  }
  return <section className="booking-receipt-section" aria-labelledby="prepare-h">
    <p className="booking-eyebrow">Optional · about a minute</p>
    <h2 id="prepare-h" className="mt-2 text-2xl">Help Sergio prepare</h2>
    <p className="booking-small mt-2">Add what you know. We’ll confirm which details were recorded and which need Sergio’s review.</p>
    {acknowledgment && <div className="booking-notice mt-4" role="status" data-details-result>
      {matchesAcknowledgment ? <>
        <p>{unverified ? 'We recovered this submission, but could not confirm all of its changes.' : needsReview ? 'Some details need Sergio’s review.' : Object.values(outcomes).every(outcome => outcome === 'unchanged') ? 'These details were already recorded.' : 'Your details are recorded.'}</p>
        <p className="booking-small mt-2">Submission received {new Date(acknowledgment.result.recordedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/New_York' })} Eastern.</p>
        <ul className="mt-2">{DETAILS_FIELDS.filter(field => outcomes[field]).map(field => <li key={field}><strong>{FIELD_LABELS[field]}:</strong> {OUTCOME_LABELS[outcomes[field]!]}</li>)}</ul>
        <p className="mt-2">{unverified ? 'Your answers remain below. Retry this submission or call Sergio before assuming it was saved.' : needsReview ? 'The changes marked “Not applied” need a conversation with Sergio. Your answers remain below.' : 'Sergio will discuss and confirm the arrangements with you.'}</p>
        {(needsReview || unverified) && <a className="link" href={site.phoneHref}>Call Sergio</a>}
      </> : <p>These edits haven’t been sent. Send them when you’re ready.</p>}
    </div>}
    <form className="quick-booking mt-6" noValidate onSubmit={event => { event.preventDefault(); void send() }}>
      <fieldset className="contents" disabled={busy} aria-label="Preparation details">
      <div className="booking-field quick-field"><label htmlFor="d-occasion">The occasion</label><input id="d-occasion" className="booking-input" maxLength={1000} value={occasion} onChange={event => setOccasion(event.target.value)} placeholder="A 50th birthday"/></div>
      <SensitiveDataConsent checked={sensitiveConsent} onChange={granted=>{setSensitiveConsent(granted);if(!granted){setDietary([]);setAllergies('')}}} disabled={busy} withdrawalInstruction="choose “Remove my saved dietary and allergy details” below"/><div className="quick-group"><p className="quick-label" id="d-dietary-label">Your own dietary needs</p><div className="quick-chips" role="group" aria-labelledby="d-dietary-label">{DIETARY.map(item => <button key={item} type="button" className="quick-chip" disabled={!sensitiveConsent || busy} aria-pressed={dietary.includes(item)} onClick={() => setDietary(dietary.includes(item) ? dietary.filter(value => value !== item) : [...dietary, item])}><span className="quick-chip-main">{item}</span></button>)}</div></div>
      <div className="booking-field quick-field"><label htmlFor="d-allergies">Allergies Sergio should discuss with you</label><textarea id="d-allergies" disabled={!sensitiveConsent || busy} className="booking-input" rows={2} maxLength={3000} value={allergies} onChange={event => setAllergies(event.target.value)}/></div>
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
      <button className="link" type="button" disabled={busy} onClick={()=>void withdraw()}>Remove my saved dietary and allergy details</button>{withdrawn && <p role="status" className="booking-small">Your saved dietary and allergy details were removed from the active planning brief. Your booking is unchanged. Any required retained evidence is restricted to its permitted purpose.</p>}
      {error && <p className="booking-notice booking-notice--error" role="alert">{error}</p>}
      <CtaButton type="submit" emphasis="secondary" disabled={busy || empty || confirmedSubmission} aria-busy={busy || undefined}>{busy ? 'Sending…' : matchesAcknowledgment && unverified ? 'Retry these details' : 'Send to Sergio'}</CtaButton>
      </fieldset>
    </form>
  </section>
}
