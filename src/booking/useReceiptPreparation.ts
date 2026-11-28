import { useEffect, useRef, useState } from 'react'
import { api, legacyDetailsAttempt, receiptDetailsInput, receiptPreparation, type ReceiptPreparationMetadata } from './api'
import type { DetailsIntent, GuestDetails } from './types'
import { isPreparationAck } from '../preparation/types'
import { clearPreparationRecovery, preparationRequestHash, readPreparationRecovery, storePreparationRecovery, type PreparationRecovery } from '../preparation/recovery'
/** Public readback contains journal metadata, never saved answers or other guests' information. */
export function useReceiptPreparation(ref: string, clearPrivate: () => void) {
  const [meta, setMeta] = useState<ReceiptPreparationMetadata | null>(null), [owner, setOwner] = useState(''), [pending, setPending] = useState<PreparationRecovery | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [blocked, setBlocked] = useState(false)
  const latest = useRef({ ref, clearPrivate }); latest.current = { ref, clearPrivate }
  const sequence = useRef(0), lock = useRef<number | null>(null), memory = useRef<{ details: GuestDetails; intent: DetailsIntent; hash: string } | null>(null), currentMeta = useRef<ReceiptPreparationMetadata | null>(null)
  const actor = 'receipt:' + ref
  function clear() { lock.current = null; ++sequence.current; memory.current = null; currentMeta.current = null; setMeta(null); setOwner(''); setBusy(false); latest.current.clearPrivate() }
  function accept(value: ReceiptPreparationMetadata, request?: PreparationRecovery) {
    if (request && value.bookingId !== request.bookingId || currentMeta.current && currentMeta.current.bookingId !== value.bookingId) throw new Error('The result does not match this booking. Check the original request before entering another change.')
    currentMeta.current = value; setMeta(value); setOwner(latest.current.ref)
    if (request && (value.actionResult || value.legacyResult)) {
      const exact = memory.current, ack = value.actionResult
      if (ack && exact && ack.state === 'recorded' && !isPreparationAck(ack, { ...exact.intent, bookingId: value.bookingId, operation: 'save', requestHash: exact.hash })) throw new Error('The exact earlier submission could not be verified. Keep checking its original request.')
      clearPreparationRecovery('receipt:' + latest.current.ref, request); setPending(null); memory.current = null; latest.current.clearPrivate()
      setNotice(value.legacyResult ? 'An earlier submission was received. This historical receipt cannot verify the exact answers now typed below. Sign in to your linked account to review saved answers.' : ack?.state === 'abandoned' ? 'The earlier request was not applied and is now blocked. You can enter a new contribution.' : 'Your earlier submission was recorded. Sign in to your linked account to review the current saved answers and Sergio’s responses.')
    }
  }
  async function load() {
    if (lock.current || !ref) return
    const run = ++sequence.current, requestedRef = ref; setBusy(true); setError('')
    try {
      const initial = await receiptPreparation(requestedRef)
      if (run !== sequence.current || latest.current.ref !== requestedRef) return
      const recovery = readPreparationRecovery(actor, initial.bookingId, 'save'); setBlocked(['invalid','unavailable'].includes(recovery.kind))
      const marker = recovery.kind === 'pending' ? recovery.marker : null; setPending(marker)
      const result = marker ? await receiptPreparation(requestedRef, marker.requestId) : initial
      if (run !== sequence.current || latest.current.ref !== requestedRef) return
      accept(result, marker || undefined)
    } catch (failure) { if (run === sequence.current && latest.current.ref === requestedRef) { setError(failure instanceof Error ? failure.message : 'The preparation form could not be opened.'); if ([401,403].includes(Number((failure as {status?:number})?.status))) clear() } }
    finally { if (run === sequence.current) setBusy(false) }
  }
  async function submit(details: GuestDetails, retry = false) {
    const initial = currentMeta.current
    const withdrawal = details.sensitiveDataConsent?.granted === false && Object.keys(details).every(field => ['sensitiveDataConsent','dietary','allergies'].includes(field)) && !details.dietary?.length && !details.allergies
    if (lock.current || !initial || !(initial.canContribute || withdrawal && initial.canWithdraw) || !retry && pending) return
    const run = ++sequence.current, requestedRef = ref; lock.current = run; setBusy(true); setError(''); setNotice('')
    const current = () => run === sequence.current && latest.current.ref === requestedRef
    try {
      if (!retry) {
        const previous = readPreparationRecovery(actor, initial.bookingId, 'save')
        if (previous.kind !== 'empty') throw new Error('Check the browser recovery record before entering another submission. Allow tab storage and refresh this form.')
        const legacy = await legacyDetailsAttempt(ref, details)
        if (!current()) return
        if (legacy) {
          const marker: PreparationRecovery = { version: 1, bookingId: initial.bookingId, requestId: legacy.requestId, operation: 'save', expectedRevision: initial.revision }
          if (!storePreparationRecovery(actor, marker)) throw new Error('Allow tab storage to safely resolve the earlier submission. No new details were sent.')
          setPending(marker)
          const proof = await receiptPreparation(ref, legacy.requestId, true)
          if (!current()) return
          if (!proof.actionResult && !proof.legacyResult) throw new Error('The earlier request could not be resolved. Check it again before continuing.')
          legacy.clear(); accept(proof, marker); return
        }
      }
      const intent = retry && memory.current ? memory.current.intent : { bookingId: initial.bookingId, requestId: crypto.randomUUID(), expectedRevision: initial.revision, expectedWorkspaceRevision: initial.workspaceRevision }
      const raw = retry && memory.current ? memory.current.details : details
      const hash = await preparationRequestHash(receiptDetailsInput(ref, raw, intent))
      if (!current()) return
      const marker: PreparationRecovery = { version: 1, bookingId: initial.bookingId, requestId: intent.requestId, operation: 'save', expectedRevision: intent.expectedRevision }
      if (!storePreparationRecovery(actor, marker) && !retry) throw new Error('This browser cannot keep a recovery record. Allow tab storage, then try again. This submission was not sent.')
      memory.current = { details: raw, intent, hash }; setPending(marker)
      await api.details(ref, raw, intent)
      if (!current()) return
      const proof = await receiptPreparation(ref, intent.requestId)
      if (!current()) return
      if (!proof.actionResult) throw new Error('The saved result is not yet confirmed. Check the original submission before entering another change.')
      accept(proof, marker)
    } catch (failure) { if (current()) { setError(failure instanceof Error ? failure.message : 'The saved result could not be confirmed.'); if ([401,403].includes(Number((failure as {status?:number})?.status))) clear() } }
    finally { if (lock.current === run) lock.current = null; if (current()) setBusy(false) }
  }
  async function discard() {
    if (!pending || lock.current) return
    const run = ++sequence.current, requestedRef = ref; lock.current = run; setBusy(true); setError('')
    try { const value = await receiptPreparation(ref, pending.requestId, true); if (run !== sequence.current || latest.current.ref !== requestedRef) return; if (!value.actionResult && !value.legacyResult) throw new Error('The earlier submission is not yet resolved. Check it again.'); memory.current = null; accept(value, pending) }
    catch (failure) { if (run === sequence.current) setError(failure instanceof Error ? failure.message : 'The earlier submission could not be resolved.') }
    finally { if (lock.current === run) lock.current = null; if (run === sequence.current) setBusy(false) }
  }
  useEffect(() => { clear(); setPending(null); setError(''); setNotice(''); setBusy(false); setBlocked(false); void load(); return () => { ++sequence.current; memory.current = null; latest.current.clearPrivate() } }, [ref])
  useEffect(() => { const hide = () => { clear(); setBusy(false) }, show = (event: PageTransitionEvent) => { if (event.persisted) void load() }; window.addEventListener('pagehide', hide); window.addEventListener('pageshow', show); return () => { window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', show) } }, [ref])
  return { meta: owner === ref ? meta : null, pending, busy, error, notice, blocked, setError, load, submit, retry: () => memory.current && submit(memory.current.details, true), canRetry: !!pending && memory.current?.intent.requestId === pending.requestId, discard }
}
