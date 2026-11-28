import { useEffect, useRef, useState } from 'react'
import { readPreparationAttention } from './preparation-api'
import { useAdmin } from './store'
import type { PreparationAttention as Attention } from '../../src/preparation/types'
import type { Booking } from './model'
import '../../src/preparation/Preparation.css'
/** Independent metadata only; never becomes part of editable Booking payloads. */
export default function PreparationAttention({ open }: { open: (booking: Booking) => void }) {
  const { user, state, refresh } = useAdmin(), [data, setData] = useState<Attention | null>(null), [owner, setOwner] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const serial = useRef(0), abort = useRef<AbortController | null>(null), actor = useRef(user.id), page = useRef(0); actor.current = user.id
  async function load(next = page.current) {
    const id = user.id, run = ++serial.current, controller = new AbortController(); abort.current?.abort(); abort.current = controller; setBusy(true); setError('')
    try { const result = await readPreparationAttention(controller.signal, next, id); if (run === serial.current && actor.current === id) { setData(result); setOwner(id); page.current = result.page.page } }
    catch (failure) { if (run === serial.current && actor.current === id && !controller.signal.aborted) { setError(failure instanceof Error ? failure.message : 'Preparation reviews could not be opened.'); if ([401,403].includes(Number((failure as { status?: number })?.status))) { setData(null); setOwner(''); void refresh() } } }
    finally { if (run === serial.current) setBusy(false) }
  }
  useEffect(() => { setData(null); setOwner(''); page.current = 0; void load(0); return () => { ++serial.current; abort.current?.abort() } }, [user.id])
  useEffect(() => { const reload = () => { if (document.visibilityState === 'visible') void load() }; window.addEventListener('focus', reload); window.addEventListener('site:preparation-updated', reload); return () => { window.removeEventListener('focus', reload); window.removeEventListener('site:preparation-updated', reload) } }, [user.id])
  const visible = owner === user.id ? data : null
  return <section className="panel prep-details" style={{ padding: 20, marginBottom: 20 }} aria-label="Preparation changes needing attention"><div className="prep-field-head"><div><h2 style={{ fontSize: '1.15em' }}>Preparation changes{visible ? ` · ${visible.total} ${visible.total === 1 ? 'booking' : 'bookings'} need attention` : ''}</h2><p className="muted">Host corrections and arrangements checks, separate from payment and booking status.</p></div><button type="button" disabled={busy} onClick={() => void load()}>Refresh preparation reviews</button></div>{busy && <p role="status">Checking preparation reviews…</p>}{error && <p className="prep-error" role="alert">{error} Counts may be out of date.</p>}{visible && !error && !busy && !visible.total && <p>No preparation changes currently need review.</p>}{visible && <><ul>{visible.items.map(item => { const booking = state.bookings.find(b => b.id === item.bookingId); return <li key={item.bookingId}><button type="button" disabled={!booking || busy} onClick={() => booking && open(booking)}>{booking?.guest || item.bookingId} · {item.pendingCount} proposed {item.pendingCount === 1 ? 'answer' : 'answers'} · {item.agreementReviewCount} arrangements {item.agreementReviewCount === 1 ? 'check' : 'checks'}</button>{!booking && <small>This record is not in the current workspace. Refresh the workspace before reviewing it.</small>}</li> })}</ul>{visible.total > 20 && <div className="prep-actions"><button type="button" disabled={busy || visible.page.previousPage === null} onClick={() => visible.page.previousPage !== null && void load(visible.page.previousPage)}>Previous preparation reviews</button><span>Page {visible.page.page + 1}</span><button type="button" disabled={busy || visible.page.nextPage === null} onClick={() => visible.page.nextPage !== null && void load(visible.page.nextPage)}>Next preparation reviews</button></div>}</>}</section>
}
