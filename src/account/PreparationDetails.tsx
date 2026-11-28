import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from './AuthProvider'
import { navigateAccount } from './navigation'
import { abandonPreparation, readPreparation, savePreparation } from './preparation-api'
import { PREPARATION_FIELDS, type PreparationChange, type PreparationField, type PreparationSave, type PreparationValue } from '../preparation/types'
import { usePreparation } from '../preparation/usePreparation'
import { PreparationAgreed, PreparationHistory, PreparationProvenance, PREPARATION_LABELS, preparationSnapshot, preparationValue } from '../preparation/presentation'
import { RecoveryNotice } from '../preparation/RecoveryNotice'
import { SensitiveDataConsent } from '../privacy/SensitiveDataConsent'
import { sensitiveDataConsent } from '../privacy/policy'
import '../preparation/Preparation.css'
const adapter = { read: readPreparation, write: savePreparation, abandon: abandonPreparation }
type Editor = { field: PreparationField; text: string; mode: '' | 'guidance' | 'range'; min: string; max: string; unit: 'total' | 'per_person'; physical: boolean; clear: boolean; consent: boolean }
function editor(field: PreparationField, value: PreparationValue | null): Editor { const budget = value && typeof value === 'object' && !Array.isArray(value) ? value : null; return { field, text: Array.isArray(value) ? value.join('\n') : typeof value === 'string' ? value : '', mode: budget?.mode || '', min: budget?.mode === 'range' ? String(budget.min) : '', max: budget?.mode === 'range' ? String(budget.max) : '', unit: budget?.mode === 'range' ? budget.unit : 'total', physical: value === true, clear: false, consent: false } }
export function PreparationDetails({ bookingId }: { bookingId: string }) {
  const { state, refresh } = useAuth(), actor = state.kind === 'authenticated' ? state.identity.sub : '', enabled = state.kind === 'authenticated' && state.identity.email_verified === true && !!bookingId
  const [edit, setEdit] = useState<Editor | null>(null), [review, setReview] = useState<{ change: PreparationChange; revision: number; workspaceRevision: number } | null>(null)
  const [withdrawReview, setWithdrawReview] = useState(false), [draftOwner, setDraftOwner] = useState('')
  const heading = useRef<HTMLHeadingElement>(null), editorHeading = useRef<HTMLHeadingElement>(null), reviewHeading = useRef<HTMLHeadingElement>(null)
  const clearPrivate = useCallback(() => { setEdit(null); setReview(null); setWithdrawReview(false); setDraftOwner('') }, [])
  const flow = usePreparation<PreparationSave>({ actor, bookingId, operation: 'save', enabled, adapter, clearPrivate, accessLost: () => { void refresh() }, snapshotChanged: () => { setReview(null); setWithdrawReview(false) } })
  const data = flow.data, bound = actor + '\n' + bookingId, currentEdit = enabled && draftOwner === bound ? edit : null
  const locked = !!flow.busy || !flow.fresh || !!flow.marker || flow.recoveryBlocked
  useEffect(() => { heading.current?.focus() }, [bookingId])
  useEffect(() => { if (currentEdit) editorHeading.current?.focus() }, [currentEdit?.field])
  useEffect(() => { if (review || withdrawReview) reviewHeading.current?.focus() }, [!!review, withdrawReview])
  const back = () => { const url = new URL(location.href); url.searchParams.delete('view'); url.searchParams.delete('booking'); navigateAccount(url.pathname + url.search + url.hash) }
  function start(field: PreparationField) { if (!data || locked || !data.permissions.canSave || data.fields[field].editMode === 'closed') return; setDraftOwner(bound); setEdit(editor(field, data.fields[field].pending?.value ?? data.fields[field].accepted.value)); setReview(null); setWithdrawReview(false); flow.setError('') }
  function propose() {
    if (!currentEdit || !data || locked) return
    const item = currentEdit
    let value: PreparationValue
    if (item.clear) { setReview({ change: { op: 'clear' }, revision: data.revision, workspaceRevision: data.workspaceRevision }); return }
    if (item.field === 'budget') {
      if (!item.mode) { flow.setError('Choose a spending preference before reviewing your change.'); return }
      if (item.mode === 'range') { const min = Number(item.min), max = Number(item.max); if (!item.min || !item.max || !Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 1 || max < min || max > 1_000_000) { flow.setError('Enter a whole-dollar range, with the upper amount at least the lower.'); return }; value = { mode: 'range', min, max, unit: item.unit } } else value = { mode: 'guidance' }
    } else if (item.field === 'physicalInvitations') value = item.physical
    else if (item.field === 'dietary') { const values = item.text.split('\n').map(v => v.trim()).filter(Boolean); if (values.length > 20 || values.some(v => v.length > 150)) { flow.setError('Use up to 20 dietary needs, one per line, each no longer than 150 characters.'); return }; value = values }
    else { value = item.text.trim(); if (!value) { flow.setError('Enter an answer, or select “Clear this answer” to remove it explicitly.'); return } }
    if (['dietary','allergies'].includes(item.field) && !item.consent) { flow.setError('Give explicit permission for your own dietary or allergy answer, or use Remove below.'); return }
    flow.setError(''); setReview({ change: { op: 'set', value }, revision: data.revision, workspaceRevision: data.workspaceRevision })
  }
  function save() {
    if (!currentEdit || !review || !data || locked || review.revision !== data.revision || review.workspaceRevision !== data.workspaceRevision) return
    void flow.commit({ bookingId, requestId: crypto.randomUUID(), expectedRevision: review.revision, expectedWorkspaceRevision: review.workspaceRevision, changes: { [currentEdit.field]: review.change }, ...(['dietary','allergies'].includes(currentEdit.field) && review.change.op === 'set' ? { sensitiveDataConsent: sensitiveDataConsent(true) } : {}) })
  }
  function withdraw() { if (!data || locked || !data.permissions.canWithdraw) return; void flow.commit({ bookingId, requestId: crypto.randomUUID(), expectedRevision: data.revision, expectedWorkspaceRevision: data.workspaceRevision, changes: { dietary: { op: 'clear' }, allergies: { op: 'clear' } }, sensitiveDataConsent: sensitiveDataConsent(false) }) }
  return <section className="ev-panel prep-details" data-preparation-booking={bookingId}>
    <button className="ev-text-button" type="button" onClick={back}>Back to your evenings</button><p className="ev-eyebrow">Your private saved brief</p><h1 tabIndex={-1} ref={heading}>Your details</h1><p>What you told us, what is saved now, and the arrangements agreed with Sergio. Only your own dietary and allergy information appears here.</p>
    {flow.error && <p className="prep-error" role="alert">{flow.error}</p>}{flow.notice && <p className="prep-notice" role="status">{flow.notice}</p>}
    <div className="prep-actions"><button type="button" disabled={!!flow.busy} onClick={() => void flow.load()}>Refresh saved details</button>{flow.busy && <span role="status">{flow.busy === 'read' ? 'Opening saved details…' : 'Checking your request…'}</span>}</div>
    {flow.marker && data && <RecoveryNotice busy={!!flow.busy} canRetry={flow.canRetry} check={() => void flow.load()} retry={() => void flow.retry()} discard={() => void flow.discard()}/>}
    {flow.recoveryBlocked && <p className="prep-error">This browser cannot verify its tab recovery record. Allow tab storage and refresh before making changes. Saved answers remain available to read.</p>}
    {!data ? <p role="status">{flow.busy ? 'Opening your saved brief…' : 'Your saved brief is unavailable. Refresh after checking your sign-in and connection.'}</p> : <>
      <PreparationAgreed data={data}/>
      {(data.hasPending || data.agreementReview) && <p className="prep-notice" role="status">{data.hasPending ? 'Some answers are waiting for Sergio’s review. ' : ''}{data.agreementReview ? 'A changed host report needs the current arrangements checked with Sergio. ' : ''}Your agreed arrangements remain in place until separately agreed.</p>}
      {!data.permissions.canSave && <p>{data.permissions.reason || 'This brief is read-only.'}</p>}
      {PREPARATION_FIELDS.map(field => { const record = data.fields[field], isEditing = currentEdit?.field === field; return <section className="prep-field" data-preparation-field={field} key={field}>
        <div className="prep-field-head"><div><h2>{PREPARATION_LABELS[field]}</h2><small>Latest accepted host answer</small><p className="prep-answer">{preparationSnapshot(record.accepted)}</p><PreparationProvenance snapshot={record.accepted}/></div>{data.permissions.canSave && record.editMode !== 'closed' && <button type="button" aria-label={`Edit ${field} answer`} disabled={locked} onClick={() => start(field)}>{record.editMode === 'review' ? 'Propose a correction' : 'Edit answer'}</button>}</div>
        <details><summary>Original answer and provenance</summary><p className="prep-answer">{preparationSnapshot(record.original)}</p><PreparationProvenance snapshot={record.original}/></details>
        {record.pending && <div className="prep-pending"><strong>{record.pending.status === 'discussion' ? 'Sergio needs to discuss this proposal' : 'Your proposed answer · waiting for Sergio'}</strong><p className="prep-answer">{record.pending.operation === 'clear' ? 'Clear this answer' : preparationValue(record.pending.value)}</p><small>This is a proposal, not an accepted answer or an agreed arrangement.</small></div>}
        {record.agreementReview && <p className="prep-status">Current arrangements need checking against this changed host report.</p>}
        {isEditing && <form className="prep-editor" onSubmit={event => { event.preventDefault(); propose() }} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setEdit(null); setReview(null) } }}><h3 tabIndex={-1} ref={editorHeading}>Correct {PREPARATION_LABELS[field].toLowerCase()}</h3><p>{record.editMode === 'review' ? 'Sergio has already reviewed or agreed this topic. Your correction will be saved as a review request.' : 'This answer has not been protected by a later review. It can be saved directly as your latest report.'}</p>{record.pending && <p>Your new proposal replaces the current pending proposal only after it is saved.</p>}
          <label><input type="checkbox" checked={currentEdit.clear} disabled={locked || !!review} onChange={event => setEdit({ ...currentEdit, clear: event.target.checked })}/>Clear this answer explicitly</label>
          {!currentEdit.clear && (field === 'budget' ? <><label>Spending preference<select value={currentEdit.mode} disabled={locked || !!review} onChange={event => setEdit({ ...currentEdit, mode: event.target.value as Editor['mode'] })}><option value="">Choose a preference</option><option value="guidance">I need Sergio’s guidance</option><option value="range">I have a range</option></select></label>{currentEdit.mode === 'range' && <><label>From ($)<input type="number" min={1} step={1} value={currentEdit.min} disabled={locked || !!review} onChange={event => setEdit({ ...currentEdit, min: event.target.value })}/></label><label>Up to ($)<input type="number" min={1} step={1} value={currentEdit.max} disabled={locked || !!review} onChange={event => setEdit({ ...currentEdit, max: event.target.value })}/></label><label>Range applies to<select value={currentEdit.unit} disabled={locked || !!review} onChange={event => setEdit({ ...currentEdit, unit: event.target.value as Editor['unit'] })}><option value="total">The gathering</option><option value="per_person">Each guest</option></select></label></>}</> : field === 'physicalInvitations' ? <label><input type="checkbox" checked={currentEdit.physical} disabled={locked || !!review} onChange={event => setEdit({ ...currentEdit, physical: event.target.checked })}/>Request physical invitations</label> : <label>{field === 'dietary' ? 'Your own dietary needs · one per line' : PREPARATION_LABELS[field]}<textarea rows={3} maxLength={field === 'occasion' ? 1000 : field === 'notes' ? 5000 : 3000} value={currentEdit.text} disabled={locked || !!review} onChange={event => setEdit({ ...currentEdit, text: event.target.value })}/></label>)}
          {['dietary','allergies'].includes(field) && !currentEdit.clear && <SensitiveDataConsent checked={currentEdit.consent} onChange={granted => setEdit({ ...currentEdit, consent: granted, ...(!granted ? { text: '' } : {}) })} disabled={locked || !!review} withdrawalInstruction="use Remove my saved dietary and allergy details below"/>}
          {review ? <div className="prep-review"><h3 tabIndex={-1} ref={reviewHeading}>Review this change</h3><dl><dt>Current accepted answer</dt><dd>{preparationSnapshot(record.accepted)}</dd><dt>{record.editMode === 'review' ? 'Proposed answer for Sergio’s review' : 'New host answer'}</dt><dd>{review.change.op === 'clear' ? 'Explicitly clear this answer' : preparationValue(review.change.value)}</dd></dl><p>Agreed arrangements, reservations and payments are unchanged.</p><div className="prep-actions"><button className="prep-primary" type="button" disabled={locked} onClick={save}>{record.editMode === 'review' ? 'Send for review' : 'Save answer'}</button><button type="button" disabled={!!flow.busy} onClick={() => setReview(null)}>Keep editing</button></div></div> : <div className="prep-actions"><button className="prep-primary" type="submit" disabled={locked}>Review change</button><button type="button" disabled={!!flow.busy} onClick={() => setEdit(null)}>Cancel edit</button></div>}
        </form>}
      </section> })}
      {data.permissions.canWithdraw && <section className="prep-field"><h2>Your dietary and allergy privacy</h2><p>You can remove your own saved dietary and allergy answers. This does not cancel your booking or alter other guests’ information. Required retained evidence remains restricted to its permitted purpose.</p>{withdrawReview ? <div className="prep-review"><h3 tabIndex={-1} ref={reviewHeading}>Remove your saved dietary and allergy details?</h3><p>Your active answers will be withdrawn. Sergio will need to discuss any future requirements with you again.</p><div className="prep-actions"><button disabled={locked} type="button" onClick={withdraw}>Confirm removal</button><button disabled={!!flow.busy} type="button" onClick={() => setWithdrawReview(false)}>Keep details</button></div></div> : <button disabled={locked} type="button" onClick={() => { setEdit(null); setReview(null); setWithdrawReview(true) }}>Remove my saved dietary and allergy details</button>}</section>}
      <PreparationHistory data={data} busy={!!flow.busy || !!flow.marker} load={page => void flow.load(page)}/>
    </>}
  </section>
}
