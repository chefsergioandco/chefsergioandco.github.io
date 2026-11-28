import { useEffect, useRef, useState } from 'react'
import { useAdmin } from './store'
import { Icon, Modal } from './ui'
import { changeReward, readRewards, rewardRequestHash, RewardApiError } from './reward-api'
import { isRewardAction, isRewardActionResult, type RewardAction, type RewardActionName, type RewardCredit, type RewardPagesQuery, type RewardsResponse } from './reward-types'
import './Rewards.css'

const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(cents / 100)
const shortDate = (value: string) => new Date(value.length === 10 ? value + 'T12:00:00Z' : value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })
const actionLabel: Record<RewardActionName, string> = { apply: 'Apply reviewed credit', reverse: 'Reverse reviewed credit', void: 'Void unused credit', reopen: 'Reopen unused credit', reconcile_legacy: 'Record reconciliation' }
const titles: Record<RewardActionName, string> = { apply: 'Apply a credit to a bill', reverse: 'Reverse a linked credit', void: 'Void unused credit', reopen: 'Reopen unused credit', reconcile_legacy: 'Review a historical marker' }
const prefix = 'sergio-reward-action-v2:'
const storageKey = (owner: string) => prefix + encodeURIComponent(owner)
function savedAction(owner: string): RewardAction | null { try { const raw = sessionStorage.getItem(storageKey(owner)); if (!raw || raw.length > 5000) return null; const value: unknown = JSON.parse(raw); return isRewardAction(value) ? value : null } catch { return null } }
function keepAction(owner: string, value: RewardAction | null): boolean { try { if (value) { const exact = JSON.stringify(value); sessionStorage.setItem(storageKey(owner), exact); return sessionStorage.getItem(storageKey(owner)) === exact } sessionStorage.removeItem(storageKey(owner)); return sessionStorage.getItem(storageKey(owner)) === null } catch { return false } }
type Review = { id: string; action: RewardActionName; allocationId: string; billingId: string; amount: string; reason: string; outcome: '' | 'external_confirmed' | 'marker_error'; stage: 'edit' | 'review' }
function reviewFor(credit: RewardCredit, action: RewardActionName, allocationId = ''): Review { return { id: credit.id, action, allocationId, billingId: '', amount: '', reason: '', outcome: '', stage: 'edit' } }
function pendingReview(input: RewardAction): Review { return { id: input.id, action: input.action, allocationId: input.action === 'reverse' ? input.allocationId : '', billingId: input.action === 'apply' ? input.billingId : '', amount: input.action === 'apply' ? String(input.amountCents / 100) : '', reason: input.reason, outcome: input.action === 'reconcile_legacy' ? input.outcome : '', stage: 'review' } }

/** Server-authorized final bills only. Financial changes are confirmed by their exact saved action and fresh readback. */
export default function Rewards() {
  const { user, refresh, pending: workspaceBusy } = useAdmin()
  const [data, setData] = useState<RewardsResponse | null>(null), [recordOwner, setRecordOwner] = useState(''), [error, setError] = useState(''), [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState(false), [fresh, setFresh] = useState(false), [accessLost, setAccessLost] = useState(false), [storedIntent, setStoredIntent] = useState<RewardAction | null>(null), [storedDialog, setStoredDialog] = useState<Review | null>(null), [intentOwner, setIntentOwner] = useState(user.id), [dialogOwner, setDialogOwner] = useState(user.id), [conflict, setConflict] = useState(false)
  const owner = useRef(user.id), live = useRef(true), sequence = useRef(0), controller = useRef<AbortController | null>(null), working = useRef(false), heading = useRef<HTMLHeadingElement | null>(null), creditsHeading = useRef<HTMLHeadingElement | null>(null), referralsHeading = useRef<HTMLHeadingElement | null>(null)
  owner.current = user.id
  const intent = intentOwner === user.id ? storedIntent : null, dialog = dialogOwner === user.id ? storedDialog : null
  function setIntent(value: RewardAction | null) { setStoredIntent(value); setIntentOwner(user.id) }
  function setDialog(value: Review | null) { setStoredDialog(value); setDialogOwner(user.id) }
  const visible = recordOwner === user.id ? data : null, credit = visible?.credits.find(row => row.id === dialog?.id), target = credit?.targets.find(row => row.billingId === dialog?.billingId), allocation = credit?.allocations.find(row => row.id === dialog?.allocationId)
  function clearPrivate() { setAccessLost(true); setError('Your access has ended. Sign in again, then check access. Any pending credit request is retained so its recorded result can be checked.'); setData(null); setRecordOwner(''); setIntent(null); setDialog(null); setFeedback(''); setFresh(false); setConflict(false) }
  async function acceptRecorded(result: RewardsResponse, input: RewardAction, current: () => boolean) {
    if (!isRewardActionResult(result.actionResult, input, await rewardRequestHash(input)) || result.workspaceRevision < result.actionResult.workspaceRevision) return false
    if (!await refresh()) throw new Error('The credit action is recorded, but the billing workspace could not be refreshed. Check this same recorded action before continuing.')
    if (!current()) return false
    keepAction(user.id, null); setIntent(null); setDialog(null); setConflict(false); setData(result); setRecordOwner(user.id); setFresh(true); setError('')
    setFeedback(`${input.action === 'apply' ? 'Credit applied to the bill. Any unused credit remains available.' : input.action === 'reverse' ? 'The linked credit was reversed. Its value is available again; original payment receipts are retained.' : input.action === 'reconcile_legacy' ? 'The historical marker was reconciled. No new bill discount was created.' : input.action === 'void' ? 'Unused credit was voided. Existing bill allocations are retained.' : 'Unused credit was reopened.'} Current credit and billing records are loaded.`)
    return true
  }
  async function load(input: RewardAction | null = intent || savedAction(user.id), focusedId: string | null | undefined = input?.id || visible?.focusedCreditId || undefined, pages: RewardPagesQuery = { creditPage: visible?.pages.credits.page || 0, referralPage: visible?.pages.referrals.page || 0 }, section?: 'credits' | 'referrals') {
    if (working.current) return
    const run = ++sequence.current, identity = user.id, abort = new AbortController(); controller.current?.abort(); controller.current = abort
    const current = () => live.current && owner.current === identity && run === sequence.current && !abort.signal.aborted
    setBusy(true); setFresh(false); setError('')
    try {
      // Access recovery first rechecks the current operator. No financial retry is sent here.
      if (accessLost) {
        const allowed = await refresh()
        if (!current()) return
        if (!allowed) { setError('Your access could not be checked. Check your connection and sign-in, then try again. Any pending credit request is still retained.'); return }
      }
      const result = await readRewards(abort.signal, input?.requestId, focusedId || undefined, pages)
      if (!current()) return
      setAccessLost(false)
      if (input && await acceptRecorded(result, input, current)) return
      setData(result); setRecordOwner(identity); setFresh(true)
      if (section) requestAnimationFrame(() => { const node = section === 'credits' ? creditsHeading.current : referralsHeading.current; node?.focus({ preventScroll: true }); node?.scrollIntoView({ block: 'start' }) })
      if (input) { setIntent(input); setDialog(pendingReview(input)); const row = result.credits.find(row => row.id === input.id); setConflict(result.workspaceRevision !== input.expectedWorkspaceRevision || !!row && row.revision !== input.expectedRevision); setError('This request is not confirmed in the saved action record. Check or retry the original request before starting another change.') }
    } catch (cause) { if (current()) { if (cause instanceof RewardApiError && [401,403].includes(cause.status)) clearPrivate(); setError(cause instanceof Error ? cause.message : 'Credit records could not be opened.') } }
    finally { if (current()) setBusy(false) }
  }
  useEffect(() => { live.current = true; const stored = savedAction(user.id); setIntent(null); setData(null); setRecordOwner(''); setDialog(null); void load(stored); return () => { live.current = false; ++sequence.current; controller.current?.abort() } }, [user.id])
  useEffect(() => { if (!fresh) return; const timer = setTimeout(() => setFresh(false), 60_000); return () => clearTimeout(timer) }, [fresh, data])
  useEffect(() => { if (dialog?.stage === 'review') requestAnimationFrame(() => { heading.current?.focus({ preventScroll: true }); heading.current?.closest('.modal')?.scrollTo({ top: 0 }) }) }, [dialog?.stage])
  function open(credit: RewardCredit, action: RewardActionName, allocationId = '') { if (busy || workspaceBusy || intent || !fresh || !credit.detailsLoaded) return; const pending = savedAction(user.id); if (pending) { void load(pending); return } setDialog(reviewFor(credit, action, allocationId)); setError(''); setFeedback('') }
  function review() {
    if (!dialog || !credit || !fresh || busy) return
    if (dialog.reason.trim().length < 3 || dialog.reason.trim().length > 1000) { setError('Add a reason between 3 and 1,000 characters.'); return }
    const amount = Number(dialog.amount), cents = Math.round(amount * 100)
    if (dialog.action === 'apply' && (!target || !Number.isFinite(amount) || Math.abs(amount * 100 - cents) > .000001 || cents < 1 || cents > target.maxApplyCents)) { setError(`Choose an eligible final bill and an amount up to ${money(target?.maxApplyCents || 0)}.`); return }
    if (dialog.action === 'reverse' && !allocation?.canReverse || dialog.action === 'void' && !credit.canVoid || dialog.action === 'reopen' && !credit.canReopen || dialog.action === 'reconcile_legacy' && (!credit.canReconcile || !dialog.outcome)) { setError('That action is not available on the current record. Refresh and review it again.'); return }
    setError(''); setDialog({ ...dialog, stage: 'review' })
  }
  function newIntent(): RewardAction | null {
    if (!dialog || !credit || !visible) return null
    const base = { requestId: crypto.randomUUID(), expectedRevision: credit.revision, expectedWorkspaceRevision: visible.workspaceRevision, id: credit.id, reason: dialog.reason.trim() }
    return dialog.action === 'apply' ? { ...base, action: 'apply', billingId: dialog.billingId, amountCents: Math.round(Number(dialog.amount) * 100) } : dialog.action === 'reverse' ? { ...base, action: 'reverse', allocationId: dialog.allocationId } : dialog.action === 'reconcile_legacy' && dialog.outcome ? { ...base, action: 'reconcile_legacy', outcome: dialog.outcome } : dialog.action === 'void' || dialog.action === 'reopen' ? { ...base, action: dialog.action } : null
  }
  async function save() {
    if (working.current || busy || workspaceBusy || !intent && (!fresh || dialog?.stage !== 'review')) return
    if (!intent) { const pending = savedAction(user.id); if (pending) { void load(pending); return } }
    const input = intent || newIntent(); if (!input || !isRewardAction(input)) return
    if (!keepAction(user.id, input) && !intent) { setError('This browser cannot keep a recovery record. Allow tab storage, then try again. This request was not sent.'); return }
    setIntent(input); working.current = true; setBusy(true); setError(''); setFeedback('')
    const identity = user.id, run = ++sequence.current, abort = new AbortController(); controller.current?.abort(); controller.current = abort
    const current = () => live.current && owner.current === identity && run === sequence.current && !abort.signal.aborted
    try {
      await changeReward(input, abort.signal)
      if (!current()) return
      const result = await readRewards(abort.signal, input.requestId, input.id, { creditPage: visible?.pages.credits.page || 0, referralPage: visible?.pages.referrals.page || 0 })
      if (!current()) return
      if (!await acceptRecorded(result, input, current)) throw new Error('The matching saved action could not be read back. Check or retry this original request.')
    } catch (cause) {
      if (!current()) return
      if (cause instanceof RewardApiError && [401,403].includes(cause.status)) clearPrivate()
      else if (cause instanceof RewardApiError && cause.status === 409) {
        try { const result = await readRewards(abort.signal, input.requestId, input.id, { creditPage: visible?.pages.credits.page || 0, referralPage: visible?.pages.referrals.page || 0 }); if (!current()) return; if (await acceptRecorded(result, input, current)) return; setData(result); setRecordOwner(identity); setFresh(true); setConflict(true); setError('These records changed or the bill is no longer eligible. The original request is retained. Check its result, or explicitly review a new change against the latest records.') }
        catch (readFailure) { if (current()) { if (readFailure instanceof RewardApiError && [401,403].includes(readFailure.status)) clearPrivate(); setFresh(false); setError(readFailure instanceof Error ? readFailure.message : 'The current credit records could not be read.') } }
      } else setError(cause instanceof Error ? cause.message : 'The credit result could not be confirmed. Retry this same request.')
    } finally { working.current = false; if (current()) setBusy(false) }
  }
  function rereview() { if (!intent || !credit || !fresh || busy) return; const draft = pendingReview(intent); keepAction(user.id, null); setIntent(null); setConflict(false); setDialog({ ...draft, stage: 'edit' }); setError('Review the current bill and amount before starting a new request.') }
  const pinned = visible?.credits.find(row => row.id === visible.pinnedCreditId), pageCredits = visible?.credits.filter(row => row.id !== visible.pinnedCreditId) ?? []
  const available = pageCredits.filter(row => row.remainingCents > 0 && row.status === 'available'), other = pageCredits.filter(row => !available.includes(row))
  const locked = busy || workspaceBusy || !!intent || !fresh
  function row(credit: RewardCredit) { return <li className="admin-reward" key={credit.id} data-reward-credit={credit.id}>
    <p className="admin-reward-main"><strong>{money(credit.remainingCents)} available</strong> · {credit.kind === 'welcome' ? 'Welcome gift' : 'Referral credit'} for {credit.owner.who}{credit.owner.email && <span> · {credit.owner.email}</span>}</p>
    <p className="admin-reward-meta">Original {money(credit.originalCents)} · Applied to bills {money(credit.allocatedCents)}{credit.voidedCents > 0 && <> · Voided {money(credit.voidedCents)}</>} · Issued {shortDate(credit.createdAt)}</p>
    {credit.legacy === 'unreconciled' && <p className="admin-reward-attention">Historical “applied” marker · confirm whether the discount was already given. No new discount is available until reconciled.</p>}
    {credit.legacy === 'external_confirmed' && <p className="admin-reward-meta">Discount confirmed outside this ledger. It cannot be applied again.</p>}
    <div className="admin-reward-actions">{!credit.detailsLoaded ? <button className="button secondary" disabled={locked} onClick={() => void load(null, credit.id)}>Open credit</button> : <>{credit.targets.length > 0 && <button className="button" disabled={locked} onClick={() => open(credit, 'apply')}>Review credit</button>}{credit.canReconcile && <button className="button secondary" disabled={locked} onClick={() => open(credit, 'reconcile_legacy')}>Reconcile historical marker</button>}{credit.canVoid && <button className="button secondary" disabled={locked} onClick={() => open(credit, 'void')}>Review void</button>}{credit.canReopen && <button className="button secondary" disabled={locked} onClick={() => open(credit, 'reopen')}>Review reopening</button>}</>}</div>
    {credit.detailsLoaded && credit.remainingCents > 0 && credit.allocatedCents > 0 && !credit.canVoid && <p className="admin-reward-meta">Reverse active allocations before voiding unused credit.</p>}
    {credit.detailsLoaded && credit.remainingCents > 0 && !credit.targets.length && credit.legacy !== 'unreconciled' && <p className="admin-reward-meta">No eligible owned final bill is available. {credit.eligibilityNote || 'Carry-forward credit remains available. The original welcome credit starts on its qualifying bill; later use requires bookings linked to the same verified customer account.'}</p>}
    {credit.detailsLoaded && credit.limits.targetsTruncated && <p className="admin-reward-meta">Showing up to {credit.limits.maxTargets} eligible bills.</p>}
    {credit.detailsLoaded && credit.allocations.length > 0 && <details className="admin-reward-allocations"><summary>Bill allocations ({credit.allocations.length}{credit.limits.allocationsTruncated ? '+' : ''})</summary><ol>{credit.allocations.map(a => <li key={a.id} data-reward-allocation={a.id}><strong>{money(a.amountCents)} · {a.invoiceNumber}</strong><span>{a.reversedAt ? 'Reversed ' + shortDate(a.reversedAt) : 'Applied ' + shortDate(a.appliedAt)}</span><p>{a.reason}</p><a className="text-button" href={'#payments?recordId=' + encodeURIComponent(a.billingId)}>Open bill {a.invoiceNumber}</a>{a.reversalReason && <p>Reversal: {a.reversalReason}</p>}{a.canReverse ? <button className="button secondary" disabled={locked} onClick={() => open(credit, 'reverse', a.id)}>Review reversal</button> : !a.reversedAt && a.blockReason && <p>{a.blockReason}</p>}</li>)}</ol>{credit.limits.allocationsTruncated && <p>Showing up to {credit.limits.maxAllocations} allocations, with active allocations first. Some history is not included in this view.</p>}</details>}
  </li> }
  const amountCents = dialog ? Math.round(Number(dialog.amount) * 100) : 0
  return <section className="admin-rewards" aria-label="Referrals and credits">
    <div className="admin-rewards-heading"><p className="admin-rewards-intro">Review a credit, apply it to an eligible final bill, and keep any unused amount for later.</p><button className="button secondary" disabled={busy} onClick={() => void load()}>{accessLost ? 'Check access again' : 'Refresh credits'}</button></div>
    {error && !dialog && <p className="admin-rewards-error" role="alert">{error}</p>}{feedback && <p className="admin-rewards-feedback" role="status">{feedback}</p>}
    {intent && !dialog && <div className="admin-reward-attention"><p>An earlier credit request needs its recorded result checked.</p><button className="button secondary" disabled={busy} onClick={() => setDialog(pendingReview(intent))}>Review pending request</button></div>}
    {!visible ? !error && <p role="status">Opening rewards…</p> : <>
      {!fresh && <p className="admin-reward-attention">Earlier records · refresh before starting a new credit change.</p>}
      <p className="admin-reward-meta">Read {shortDate(visible.checkedAt)}. {pageCredits.length} credit records on this page{pinned ? ', plus the selected record' : ''}. The available balance includes all credit records.</p>
      <p className="admin-rewards-intro">Friends’ first eligible evening comes with {money(visible.terms.welcomeCents)} off its final bill. After that evening, the inviter can earn {money(visible.terms.referralCents)}. <span className="admin-rewards-provisional">Amounts, services and perks remain provisional.</span></p>
      <h3 ref={creditsHeading} tabIndex={-1} aria-label={'Total available credit ' + money(visible.availableCents) + '. Credit page ' + (visible.pages.credits.page + 1)}>Total available credit <span>{money(visible.availableCents)}</span></h3>{pinned && <section className="admin-reward-pinned" aria-label="Selected credit outside this page"><p className="admin-reward-meta">{intent?.id === pinned.id ? 'Pending' : 'Selected'} credit · outside this page</p><ol className="admin-rewards-list">{row(pinned)}</ol></section>}<p className="admin-reward-meta">Available credits on this page</p><ol className="admin-rewards-list">{available.map(row)}</ol>{!available.length && <p className="admin-rewards-empty">No available credit on this page.</p>}
      {other.length > 0 && <details className="admin-rewards-history"><summary>Other credits and historical markers on this page ({other.length})</summary><ol className="admin-rewards-list">{other.map(row)}</ol></details>}
      <nav className="admin-reward-pagination" aria-label="Credit pages"><button className="button secondary" aria-label="Previous credit page" disabled={locked || visible.pages.credits.previousPage === null} onClick={() => void load(null, null, { creditPage: visible.pages.credits.previousPage!, referralPage: visible.pages.referrals.page }, 'credits')}>Previous credits</button><span>Credit page {visible.pages.credits.page + 1}</span><button className="button secondary" aria-label="Next credit page" disabled={locked || visible.pages.credits.nextPage === null} onClick={() => void load(null, null, { creditPage: visible.pages.credits.nextPage!, referralPage: visible.pages.referrals.page }, 'credits')}>Next credits</button></nav>
      <h3 ref={referralsHeading} tabIndex={-1} aria-label={'Referrals, page ' + (visible.pages.referrals.page + 1)}>Referrals</h3>{visible.referrals.length ? <ol className="admin-rewards-list">{visible.referrals.map(r => <li className="admin-reward" key={r.id}><p className="admin-reward-main"><strong>{r.friend}</strong> · {r.friendBookingId} · invited by {r.owner.who}</p><p className="admin-reward-meta">{{ pending: 'Booked · credit after their evening', earned: 'Evening happened · credit issued', void: 'Didn’t go ahead' }[r.status]}</p></li>)}</ol> : <p className="admin-rewards-empty">No referrals on this page.</p>}<nav className="admin-reward-pagination" aria-label="Referral pages"><button className="button secondary" aria-label="Previous referral page" disabled={locked || visible.pages.referrals.previousPage === null} onClick={() => void load(null, visible.focusedCreditId, { creditPage: visible.pages.credits.page, referralPage: visible.pages.referrals.previousPage! }, 'referrals')}>Previous referrals</button><span>Referral page {visible.pages.referrals.page + 1}</span><button className="button secondary" aria-label="Next referral page" disabled={locked || visible.pages.referrals.nextPage === null} onClick={() => void load(null, visible.focusedCreditId, { creditPage: visible.pages.credits.page, referralPage: visible.pages.referrals.nextPage! }, 'referrals')}>Next referrals</button></nav>
      <h3>Regulars’ perks</h3><ul className="admin-rewards-perks">{visible.terms.milestones.map(m => <li key={m.evenings}>After {m.evenings} evenings: {m.perk}</li>)}</ul><p className="admin-rewards-empty">Clients see their earned perks in their account. You honour them when planning the next evening.</p>
    </>}
    {dialog && <Modal title={titles[dialog.action]} onClose={() => { if (!busy) { setDialog(null); setError('') } }}><div className="reward-review" data-reward-review={dialog.action}>
      <h3 ref={heading} tabIndex={-1}>{dialog.stage === 'review' ? 'Review the proposed change' : credit?.owner.who || 'Original pending request'}</h3>
      {error && <p className="admin-rewards-error" role="alert">{error}</p>}
      {intent ? <><p>This exact request is retained until its saved result is confirmed. A retry uses the original amount, reason and request identity.</p><dl className="reward-review-facts"><div><dt>Credit</dt><dd>{intent.id}</dd></div>{intent.action === 'apply' && <><div><dt>Bill</dt><dd>{intent.billingId}</dd></div><div><dt>Credit amount</dt><dd>{money(intent.amountCents)}</dd></div></>}<div><dt>Reason</dt><dd>{intent.reason}</dd></div></dl><div className="reward-review-actions"><button className="button secondary" disabled={busy} onClick={() => void load(intent)}>Check recorded result</button><button className="button" disabled={busy || workspaceBusy} onClick={() => void save()}>{busy ? 'Checking…' : 'Retry original request'}</button>{conflict && credit && <button className="button secondary" disabled={busy || !fresh} onClick={rereview}>Review a new change</button>}</div></> : credit && <>
        {dialog.action === 'apply' && <><label className="field">Eligible final bill<select aria-label="Eligible final bill" value={dialog.billingId} disabled={busy || dialog.stage === 'review'} onChange={e => { const selected = credit.targets.find(t => t.billingId === e.target.value); setDialog({ ...dialog, billingId: e.target.value, amount: selected ? String(selected.maxApplyCents / 100) : '' }) }}><option value="">Choose an eligible bill</option>{credit.targets.map(t => <option key={t.billingId} value={t.billingId}>{t.invoiceNumber} · {t.customer} · {money(t.balanceCents)} due</option>)}</select></label><label className="field">Credit to apply ($)<input aria-label="Credit to apply ($)" type="number" min="0.01" step="0.01" max={target ? target.maxApplyCents / 100 : undefined} value={dialog.amount} disabled={busy || dialog.stage === 'review'} onChange={e => setDialog({ ...dialog, amount: e.target.value })}/></label>{target && <dl className="reward-review-facts"><div><dt>Selected bill</dt><dd>{target.invoiceNumber}<br/>{target.customer}</dd></div><div><dt>Current bill balance</dt><dd>{money(target.balanceCents)}</dd></div><div><dt>Credit applied now</dt><dd>{money(Number.isFinite(amountCents) ? Math.max(0, amountCents) : 0)}</dd></div><div><dt>Bill balance after</dt><dd>{money(target.balanceCents - (Number.isFinite(amountCents) ? amountCents : 0))}</dd></div><div><dt>Credit left for later</dt><dd>{money(credit.remainingCents - (Number.isFinite(amountCents) ? amountCents : 0))}</dd></div></dl>}<p>The credit reduces the final bill. It is separate from money received and does not charge or refund the customer.</p></>}
        {dialog.action === 'reverse' && allocation && <><p>Reverse the {money(allocation.amountCents)} allocation on {allocation.invoiceNumber}. The bill balance increases by that amount and the credit becomes available again. Collection is paused for review.</p><dl className="reward-review-facts"><div><dt>Selected bill</dt><dd>{allocation.invoiceNumber}</dd></div><div><dt>Current bill balance</dt><dd>{money(allocation.balanceCents || 0)}</dd></div><div><dt>Bill balance after</dt><dd>{money((allocation.balanceCents || 0) + allocation.amountCents)}</dd></div><div><dt>Credit available after</dt><dd>{money(credit.remainingCents + allocation.amountCents)}</dd></div></dl><p>Original payments and receipts stay in the history. This action does not refund or collect money.</p></>}
        {dialog.action === 'void' && <p>Void the unused {money(credit.remainingCents)}. Existing bill allocations stay recorded.</p>}
        {dialog.action === 'reopen' && <p>Restore {money(credit.voidedCents)} of unused entitlement. No bill discount is created.</p>}
        {dialog.action === 'reconcile_legacy' && <><p>This older record marked the credit applied without changing a bill in this system. Confirm what actually happened before releasing any value.</p><label className="reward-review-choice"><input type="radio" name="legacy-outcome" checked={dialog.outcome === 'external_confirmed'} disabled={dialog.stage === 'review'} onChange={() => setDialog({ ...dialog, outcome: 'external_confirmed' })}/>The discount was already given outside this ledger. Keep it used.</label><label className="reward-review-choice"><input type="radio" name="legacy-outcome" checked={dialog.outcome === 'marker_error'} disabled={dialog.stage === 'review'} onChange={() => setDialog({ ...dialog, outcome: 'marker_error' })}/>The marker was a mistake; no discount was given. Restore availability.</label><p>Reconciliation records this decision. It does not add a discount to a bill.</p></>}
        <label className="field">Reason for this change<textarea aria-label="Reason for this change" rows={3} maxLength={1000} value={dialog.reason} disabled={busy || dialog.stage === 'review'} onChange={e => setDialog({ ...dialog, reason: e.target.value })}/></label>
        <div className="reward-review-actions"><button className="button secondary" disabled={busy} onClick={() => dialog.stage === 'review' ? setDialog({ ...dialog, stage: 'edit' }) : setDialog(null)}>{dialog.stage === 'review' ? 'Keep editing' : 'Cancel'}</button><button className="button" disabled={busy || workspaceBusy || !fresh} onClick={() => dialog.stage === 'review' ? void save() : review()}>{busy ? 'Saving…' : dialog.stage === 'review' ? actionLabel[dialog.action] : 'Review change'}</button></div>
      </>}
    </div></Modal>}
  </section>
}
