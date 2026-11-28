import { useEffect, useRef, useState } from 'react'
import { abandonRetained, readRetained, retainedRequestHash, writeRetained } from './retained-record-api'
import { isRetainedAck, type RetainedAck, type RetainedInput, type RetainedRead, type RetainedFlags } from './retained-record-types'
import { clearRetainedRecovery, readRetainedRecovery, storeRetainedRecovery, type RetainedRecovery, type RetainedRecoveryRead } from './retained-record-recovery'

type Options = { actor: string; caseId: string; revision: number; clearPrivate: () => void; accessLost: () => void; changed?: () => void }
const action = (m: RetainedRecovery) => m.operation === 'financial_fact' ? 'record_financial_fact' as const : 'release_restriction' as const
export function useRetainedRecords(options: Options) {
  const latest = useRef(options); latest.current = options
  const [saved, setSaved] = useState<RetainedRead | null>(null), [owner, setOwner] = useState(''), [recovery, setRecovery] = useState<RetainedRecoveryRead>({ kind: 'empty' }), [recoveryOwner, setRecoveryOwner] = useState('')
  const [busy, setBusy] = useState(false), [fresh, setFresh] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [outcome, setOutcome] = useState<RetainedAck | null>(null)
  const serial = useRef(0), active = useRef(true), lock = useRef<number | null>(null), abort = useRef<AbortController | null>(null), view = useRef<RetainedRead | null>(null)
  const memory = useRef<{ input: RetainedInput; hash: string; flags?: RetainedFlags } | null>(null), selected = useRef<string | undefined>(), page = useRef(0)
  const bound = options.actor + '\n' + options.caseId
  const data = owner === bound ? saved : null, marker = recoveryOwner === bound && recovery.kind === 'pending' ? recovery.marker : null
  function clear() { ++serial.current; abort.current?.abort(); lock.current = null; memory.current = null; view.current = null; setSaved(null); setOwner(''); setOutcome(null); setFresh(false); setBusy(false); latest.current.clearPrivate() }
  function begin() {
    const config = latest.current, key = config.actor + '\n' + config.caseId, run = ++serial.current, controller = new AbortController()
    abort.current?.abort(); abort.current = controller; setBusy(true); setError('')
    return { config, key, run, controller, current: () => active.current && !controller.signal.aborted && serial.current === run && latest.current.actor + '\n' + latest.current.caseId === key }
  }
  function apply(value: RetainedRead, key: string) { view.current = value; setSaved(value); setOwner(key); setFresh(true) }
  function match(value: RetainedRead, pending: RetainedRecovery) {
    const result = value.actionResult
    if (result?.state !== 'recorded' || !isRetainedAck(result.ack, { id: pending.caseId, requestId: pending.requestId }) || result.ack.action !== action(pending) || value.case.revision < result.ack.caseRevision || value.controls.revision < result.ack.controlRevision) return null
    const exact = memory.current
    if (exact?.input.requestId === pending.requestId && !isRetainedAck(result.ack, { id: pending.caseId, requestId: pending.requestId, input: exact.input, hash: exact.hash })) return null
    if (exact?.flags && (Object.keys(exact.flags) as (keyof RetainedFlags)[]).some(key => result.ack.controlsAfter[key] !== (result.ack.action === 'release_restriction' && key === 'restricted' ? false : exact.flags![key]))) return null
    return result.ack
  }
  function resolve(value: RetainedRead, pending: RetainedRecovery, actor: string) {
    const ack = match(value, pending), state = value.actionResult?.state
    if (!ack && (state !== 'abandoned' || value.actionResult?.state !== 'abandoned' || value.actionResult.action !== action(pending))) return false
    memory.current = null; latest.current.clearPrivate(); if (ack) setOutcome(ack)
    if (!clearRetainedRecovery(actor, pending)) { setError('The action result was checked, but this tab could not clear its recovery record. Check the original action again before starting another.'); return false }
    setRecovery({ kind: 'empty' }); setNotice(ack ? 'The earlier action was recorded. Its result and the current records are shown separately below.' : 'The earlier action was not applied and is now blocked. Review the current records before entering a new action.')
    if (ack) latest.current.changed?.()
    return true
  }
  async function readCurrent(task: ReturnType<typeof begin>, pending?: RetainedRecovery) {
    let value = await readRetained(task.config.caseId, task.config.actor, task.controller.signal, { page: page.current, bookingId: selected.current, requestId: pending?.requestId })
    if (!task.current()) return null
    if (pending && value.actionResult?.state === 'recorded' && value.actionResult.ack.financial && value.selected?.bookingId !== value.actionResult.ack.financial.bookingId) {
      selected.current = value.actionResult.ack.financial.bookingId
      value = await readRetained(task.config.caseId, task.config.actor, task.controller.signal, { page: page.current, bookingId: selected.current, requestId: pending.requestId })
      if (!task.current()) return null
    }
    apply(value, task.key); if (pending) resolve(value, pending, task.config.actor)
    return value
  }
  function failure(error: unknown) {
    if ([401, 403].includes(Number((error as { status?: number })?.status))) { clear(); latest.current.accessLost() }
    setFresh(false); setError(error instanceof Error ? error.message : 'The current action could not be verified. Check the original action before starting another.')
  }
  async function load(nextPage = page.current, bookingId: string | null | undefined = selected.current) {
    if (lock.current || !latest.current.actor) return
    page.current = nextPage; selected.current = bookingId || undefined; const task = begin(), pending = readRetainedRecovery(task.config.actor, task.config.caseId)
    setFresh(false); setRecovery(pending); setRecoveryOwner(task.key)
    try { await readCurrent(task, pending.kind === 'pending' ? pending.marker : undefined) }
    catch (error) { if (task.current()) failure(error) }
    finally { if (task.current()) setBusy(false) }
  }
  async function commit(input: RetainedInput, retry = false, beforeFlags?: RetainedFlags) {
    if (lock.current || !latest.current.actor || !retry && !fresh) return
    const existing = readRetainedRecovery(latest.current.actor, latest.current.caseId)
    if (retry && (existing.kind !== 'pending' || existing.marker.requestId !== input.requestId || existing.marker.operation !== (input.action === 'record_financial_fact' ? 'financial_fact' : 'release_restriction'))) { setError('The original recovery record could not be verified. Refresh it before retrying.'); void load(); return }
    if (!retry && existing.kind !== 'empty') { setError('Check the earlier action and this tab’s recovery record before preparing another.'); void load(); return }
    const task = begin(); lock.current = task.run; setNotice('')
    try {
      const exact = structuredClone(input), hash = await retainedRequestHash(exact)
      if (!task.current()) return
      const pending: RetainedRecovery = { version: 1, caseId: exact.id, requestId: exact.requestId, operation: exact.action === 'record_financial_fact' ? 'financial_fact' : 'release_restriction', expectedRevision: exact.expectedCaseRevision }
      if (!storeRetainedRecovery(task.config.actor, pending) && !retry) throw new Error('Allow tab storage before saving a control. This action was not sent because a recovery record could not be kept.')
      const flags: RetainedFlags | undefined = beforeFlags ? { restricted: beforeFlags.restricted, marketingObjected: beforeFlags.marketingObjected, accountClosed: beforeFlags.accountClosed, erasureRequested: beforeFlags.erasureRequested, sensitiveWithdrawn: beforeFlags.sensitiveWithdrawn } : undefined
      memory.current = { input: exact, hash, flags }; setRecovery({ kind: 'pending', marker: pending }); setRecoveryOwner(task.key)
      await writeRetained(exact, task.config.actor, task.controller.signal)
      if (!task.current()) return
      const value = await readCurrent(task, pending)
      if (task.current() && (!value || !match(value, pending))) throw new Error('The exact original action could not be read back. Check it before preparing another.')
    } catch (error) { if (task.current()) failure(error) }
    finally { if (lock.current === task.run) lock.current = null; if (task.current()) setBusy(false) }
  }
  async function retry() { if (marker && memory.current?.input.requestId === marker.requestId) await commit(memory.current.input, true, memory.current.flags) }
  async function discard() {
    if (!marker || lock.current) return
    const task = begin(), pending = marker; lock.current = task.run
    try {
      await abandonRetained(pending.caseId, pending.requestId, action(pending), task.config.actor, task.controller.signal)
      if (!task.current()) return
      memory.current = null; const value = await readCurrent(task, pending)
      if (task.current() && value?.actionResult?.state !== 'recorded' && value?.actionResult?.state !== 'abandoned' && value?.actionResult?.state !== 'expired') throw new Error('The earlier action is not yet resolved. Check it again before entering another.')
    } catch (error) { if (task.current()) failure(error) }
    finally { if (lock.current === task.run) lock.current = null; if (task.current()) setBusy(false) }
  }
  async function acknowledgeExpired() {
    if (!marker || lock.current) return
    const pending = marker, task = begin(); lock.current = task.run
    try {
      const value = await readRetained(pending.caseId, task.config.actor, task.controller.signal, { page: page.current, bookingId: selected.current, requestId: pending.requestId })
      if (!task.current()) return
      if (value.actionResult?.state !== 'expired' || !['pending', 'in_review', 'needs_information'].includes(value.case.status)) throw new Error('The expired action cannot be cleared for a fresh review in this case. Refresh its current status.')
      if (!clearRetainedRecovery(task.config.actor, pending)) throw new Error('This tab could not clear its recovery metadata. Check the current state again.')
      memory.current = null; latest.current.clearPrivate(); setRecovery({ kind: 'empty' }); apply(value, task.key); setNotice('The earlier action details expired and cannot be replayed. No success is assumed. Review the current records before entering a new action.')
    } catch (error) { if (task.current()) failure(error) }
    finally { if (lock.current === task.run) lock.current = null; if (task.current()) setBusy(false) }
  }
  useEffect(() => { active.current = true; clear(); selected.current = undefined; page.current = 0; setError(''); setNotice(''); setRecovery({ kind: 'empty' }); setRecoveryOwner(''); if (options.actor) void load(0, undefined); return () => { active.current = false; ++serial.current; abort.current?.abort(); memory.current = null; latest.current.clearPrivate() } }, [options.actor, options.caseId, options.revision])
  useEffect(() => { const hide = () => clear(), show = (event: PageTransitionEvent) => { if (event.persisted) void load() }, focus = () => { if (document.visibilityState === 'visible' && !lock.current) void load() }; window.addEventListener('pagehide', hide); window.addEventListener('pageshow', show); window.addEventListener('focus', focus); return () => { window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', show); window.removeEventListener('focus', focus) } }, [])
  useEffect(() => { if (!fresh) return; const timer = setTimeout(() => setFresh(false), 60_000); return () => clearTimeout(timer) }, [fresh, saved])
  return { data, marker, busy, fresh, error, notice, outcome: owner === bound ? outcome : null, setError, load, commit, retry, discard, acknowledgeExpired, canRetry: !!marker && memory.current?.input.requestId === marker.requestId, blocked: recoveryOwner === bound && ['invalid', 'unavailable'].includes(recovery.kind) }
}
