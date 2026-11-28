import { useEffect, useRef, useState } from 'react'
import { isPreparationAck, type PreparationAck, type PreparationIntent, type PreparationOperation, type PreparationResponse } from './types'
import { clearPreparationRecovery, preparationRequestHash, readPreparationRecovery, storePreparationRecovery, type PreparationRecovery, type PreparationRecoveryRead } from './recovery'

type Adapter<T> = { read: (bookingId: string, signal: AbortSignal, requestId?: string, page?: number, actor?: string) => Promise<PreparationResponse>; write: (input: T, signal: AbortSignal, actor?: string) => Promise<PreparationAck>; abandon: (bookingId: string, requestId: string, signal: AbortSignal, actor?: string) => Promise<PreparationAck> }
type Options<T> = { actor: string; bookingId: string; operation: PreparationOperation; enabled: boolean; adapter: Adapter<T>; clearPrivate: () => void; recorded?: (ack: PreparationAck) => void; accessLost?: () => void; privacyLost?: () => void; snapshotChanged?: (before: PreparationResponse, after: PreparationResponse) => void }
/** Sensitive drafts and full hashes stay in memory. Only the opaque, actor-scoped marker survives navigation. */
export function usePreparation<T extends PreparationIntent>(options: Options<T>) {
  const [saved, setSaved] = useState<PreparationResponse | null>(null), [owner, setOwner] = useState(''), [recovery, setRecovery] = useState<PreparationRecoveryRead>({ kind: 'empty' }), [recoveryOwner, setRecoveryOwner] = useState('')
  const [busy, setBusy] = useState<'read' | 'write' | 'abandon' | null>(null), [fresh, setFresh] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const latest = useRef(options); latest.current = options
  const active = useRef(true), serial = useRef(0), controller = useRef<AbortController | null>(null), lock = useRef<number | null>(null), savedRef = useRef<PreparationResponse | null>(null)
  const memory = useRef<{ input: T; hash: string } | null>(null)
  const bound = options.actor + '\n' + options.bookingId + '\n' + options.operation
  const data = options.enabled && owner === bound ? saved : null
  const marker = options.enabled && recoveryOwner === bound && recovery.kind === 'pending' ? recovery.marker : null
  function clear() { lock.current = null; ++serial.current; controller.current?.abort(); memory.current = null; savedRef.current = null; setSaved(null); setOwner(''); setFresh(false); setBusy(null); latest.current.clearPrivate() }
  function begin(kind: 'read' | 'write' | 'abandon') {
    const config = latest.current, run = ++serial.current, key = config.actor + '\n' + config.bookingId + '\n' + config.operation, abort = new AbortController()
    controller.current?.abort(); controller.current = abort; setBusy(kind); setError('')
    const current = () => active.current && !abort.signal.aborted && run === serial.current && latest.current.enabled && latest.current.actor + '\n' + latest.current.bookingId + '\n' + latest.current.operation === key
    return { config, run, key, abort, current }
  }
  function apply(result: PreparationResponse, key: string) {
    const before = savedRef.current, lostHealth = result.permissions.healthState === 'restricted' || result.permissions.healthState === 'withdrawn' || before?.permissions.canReadHealth && !result.permissions.canReadHealth
    if (lostHealth) { memory.current = null; latest.current.clearPrivate(); latest.current.privacyLost?.() }
    if (before && (before.revision !== result.revision || before.workspaceRevision !== result.workspaceRevision)) latest.current.snapshotChanged?.(before, result)
    savedRef.current = result; setSaved(result); setOwner(key); setFresh(true)
  }
  function matching(result: PreparationResponse, pending: PreparationRecovery): PreparationAck | null {
    const ack = result.actionResult
    if (!isPreparationAck(ack, { bookingId: pending.bookingId, requestId: pending.requestId, operation: pending.operation }) || result.revision < ack.revision || result.workspaceRevision < ack.workspaceRevision) return null
    const exact = memory.current
    if (ack.state === 'recorded' && exact?.input.requestId === pending.requestId && !isPreparationAck(ack, { ...exact.input, operation: pending.operation, requestHash: exact.hash })) return null
    return ack
  }
  function resolve(ack: PreparationAck, pending: PreparationRecovery, actor: string) {
    clearPreparationRecovery(actor, pending); memory.current = null; setRecovery({ kind: 'empty' }); latest.current.clearPrivate()
    setNotice(ack.state === 'recorded' ? 'Your earlier request was recorded. The current saved answers and its outcome are shown below.' : 'The earlier request was not applied. You can review and enter a new change.')
    latest.current.recorded?.(ack)
  }
  async function load(page = savedRef.current?.history.page || 0) {
    if (lock.current || !latest.current.enabled) return
    const task = begin('read'), pending = readPreparationRecovery(task.config.actor, task.config.bookingId, task.config.operation)
    setFresh(false); setRecovery(pending); setRecoveryOwner(task.key)
    try {
      const result = await task.config.adapter.read(task.config.bookingId, task.abort.signal, pending.kind === 'pending' ? pending.marker.requestId : undefined, page, task.config.actor)
      if (!task.current()) return
      apply(result, task.key)
      if (pending.kind === 'pending') { const ack = matching(result, pending.marker); if (ack) resolve(ack, pending.marker, task.config.actor) }
    } catch (failure) {
      if (!task.current()) return
      if ([401,403].includes(Number((failure as { status?: number })?.status))) { clear(); task.config.accessLost?.() }
      setError(failure instanceof Error ? failure.message : 'Your saved details could not be opened. Check your sign-in and connection, then try again.')
    } finally { if (task.current()) setBusy(null) }
  }
  async function perform(input: T, retry = false) {
    if (lock.current || !latest.current.enabled || !fresh && !retry) return
    const config = latest.current, pending = readPreparationRecovery(config.actor, config.bookingId, config.operation)
    if (!retry && pending.kind === 'pending') { void load(); return }
    if (!retry && ['invalid','unavailable'].includes(pending.kind)) { setError('This browser cannot check its recovery record. Allow tab storage, then refresh before submitting a change. This request was not sent.'); return }
    const task = begin('write'); lock.current = task.run; setNotice('')
    try {
      const hash = await preparationRequestHash(input)
      if (!task.current()) return
      const next: PreparationRecovery = { version: 1, bookingId: input.bookingId, requestId: input.requestId, operation: task.config.operation, expectedRevision: input.expectedRevision }
      if (!storePreparationRecovery(task.config.actor, next) && !retry) { setError('This browser cannot keep a recovery record. Allow tab storage, then try again. This request was not sent.'); return }
      memory.current = { input, hash }; setRecovery({ kind: 'pending', marker: next }); setRecoveryOwner(task.key)
      await task.config.adapter.write(input, task.abort.signal, task.config.actor)
      if (!task.current()) return
      const result = await task.config.adapter.read(task.config.bookingId, task.abort.signal, input.requestId, savedRef.current?.history.page || 0, task.config.actor)
      if (!task.current()) return
      const ack = matching(result, next)
      if (!ack) throw new Error('The matching saved result could not be verified. Check the original request before submitting another change.')
      apply(result, task.key); resolve(ack, next, task.config.actor)
    } catch (failure) {
      if (!task.current()) return
      if ([401,403].includes(Number((failure as { status?: number })?.status))) { clear(); task.config.accessLost?.() }
      setFresh(false); setError(failure instanceof Error ? failure.message : 'The result could not be confirmed. Check the original request.')
    } finally { if (lock.current === task.run) lock.current = null; if (task.current()) setBusy(null) }
  }
  async function retry() { const exact = memory.current; if (exact && marker?.requestId === exact.input.requestId) await perform(exact.input, true) }
  async function discard() {
    if (!marker || lock.current || !latest.current.enabled) return
    const task = begin('abandon'), pending = marker; lock.current = task.run
    try {
      const result = await task.config.adapter.abandon(pending.bookingId, pending.requestId, task.abort.signal, task.config.actor)
      if (!task.current()) return
      if (!isPreparationAck(result, { bookingId: pending.bookingId, requestId: pending.requestId, operation: pending.operation })) throw new Error('The earlier request is not resolved. Check it again before entering another change.')
      memory.current = null
      const current = await task.config.adapter.read(task.config.bookingId, task.abort.signal, pending.requestId, savedRef.current?.history.page || 0, task.config.actor)
      if (!task.current()) return
      const ack = matching(current, pending)
      if (!ack) throw new Error('The resolved request could not be read back. Check it again before entering another change.')
      apply(current, task.key); resolve(ack, pending, task.config.actor)
    } catch (failure) { if (task.current()) { if ([401,403].includes(Number((failure as { status?: number })?.status))) { clear(); task.config.accessLost?.() }; setFresh(false); setError(failure instanceof Error ? failure.message : 'The earlier request could not be resolved.') } }
    finally { if (lock.current === task.run) lock.current = null; if (task.current()) setBusy(null) }
  }
  useEffect(() => { active.current = true; clear(); setError(''); setNotice(''); setRecovery({ kind: 'empty' }); setRecoveryOwner(''); if (options.enabled) void load(0); return () => { active.current = false; ++serial.current; controller.current?.abort(); memory.current = null; latest.current.clearPrivate() } }, [options.actor, options.bookingId, options.enabled, options.operation])
  useEffect(() => { const hide = () => clear(), show = (event: PageTransitionEvent) => { if (event.persisted && latest.current.enabled) void load(0) }, focus = () => { if (document.visibilityState === 'visible' && !lock.current && latest.current.enabled) void load() }; window.addEventListener('pagehide', hide); window.addEventListener('pageshow', show); window.addEventListener('focus', focus); return () => { window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', show); window.removeEventListener('focus', focus) } }, [])
  useEffect(() => { if (!fresh) return; const timer = setTimeout(() => setFresh(false), 60_000); return () => clearTimeout(timer) }, [fresh, saved])
  return { data, marker, busy, fresh, error, notice, setError, load, commit: perform, retry, discard, canRetry: !!marker && memory.current?.input.requestId === marker.requestId, recoveryBlocked: recoveryOwner === bound && ['invalid','unavailable'].includes(recovery.kind) }
}
