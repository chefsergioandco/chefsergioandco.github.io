import { useEffect, useState } from 'react'
import { adminFetch } from './api-client'
import { useAdmin } from './store'
import './Rewards.css'

type Owner = { who: string; email: string; bookingId: string | null }
type Credit = { id: string; kind: 'welcome' | 'referral'; amount: number; status: 'pending' | 'available' | 'applied' | 'void'; createdAt: string; appliedAt: string | null; note: string | null; owner: Owner; appliedBookingId: string | null; appliedBy: string | null }
type Referral = { id: string; friend: string; friendBookingId: string; service: string | null; date: string | null; owner: Owner; source: 'link' | 'invitation'; status: 'pending' | 'earned' | 'void'; createdAt: string; voidReason: string | null }
type Terms = { welcomeCents: number; referralCents: number; services: string[]; milestones: { evenings: number; perk: string }[] }

async function api<T>(path: string, body?: object): Promise<T> {
  const response = await adminFetch(path, { credentials: 'same-origin', cache: 'no-store', ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Request': '1' }, body: JSON.stringify(body) } : {}) })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(typeof payload?.error?.message === 'string' ? payload.error.message : typeof payload?.message === 'string' ? payload.message : 'Rewards could not be opened. Please try again.')
  if (!payload) throw new Error('The server returned an unreadable response. Please refresh and try again.')
  return payload as T
}
const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(value)
const shortDate = (value: string) => new Date(value.length === 10 ? value + 'T12:00:00Z' : value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', ...(value.length === 10 ? { timeZone: 'UTC' } : {}) })
const referralStatus = { pending: 'Booked · credit after their evening', earned: 'Evening happened · credit issued', void: 'Didn’t go ahead' }

/** Credits Sergio owes (and whose bill each comes off), every referral, and the current terms. */
export default function Rewards() {
  const { state } = useAdmin()
  const [data, setData] = useState<{ credits: Credit[]; referrals: Referral[]; terms: Terms } | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(''), [targets, setTargets] = useState<Record<string, string>>({})
  const load = async () => { setError(''); try { setData(await api('/api/rewards/manage')) } catch (value) { setError(value instanceof Error ? value.message : String(value)) } }
  useEffect(() => { void load() }, [])
  async function act(credit: Credit, action: 'apply' | 'void' | 'reopen') {
    setBusy(credit.id + action); setError('')
    try { await api('/api/rewards/manage/action', { id: credit.id, action, ...(action === 'apply' ? { bookingId: targets[credit.id] || suggested(credit) } : {}) }); await load() }
    catch (value) { setError(value instanceof Error ? value.message : String(value)) } finally { setBusy('') }
  }
  // A welcome comes off the friend's own booking; a referral credit off the client's next booking.
  const choices = (credit: Credit) => credit.owner.bookingId && credit.kind === 'welcome' ? state.bookings.filter(item => item.id === credit.owner.bookingId) : state.bookings.filter(item => credit.owner.email && item.email.trim().toLowerCase() === credit.owner.email.trim().toLowerCase() && item.status !== 'cancelled')
  const suggested = (credit: Credit) => choices(credit).sort((a, b) => a.date.localeCompare(b.date)).find(item => item.date >= new Date().toISOString().slice(0, 10))?.id ?? choices(credit)[0]?.id ?? ''
  const owed = data?.credits.filter(credit => credit.status === 'available') ?? [], settled = data?.credits.filter(credit => credit.status !== 'available') ?? []
  return <section className="admin-rewards" aria-label="Referrals and credits">
    {error && <p className="admin-rewards-error" role="alert">{error} <button className="button secondary" type="button" onClick={() => void load()}>Try again</button></p>}
    {!data ? !error && <p role="status">Opening rewards…</p> : <>
      <p className="admin-rewards-intro">Friends who book their first evening through a client’s link get {money(data.terms.welcomeCents / 100)} off its final bill. Once that evening has happened, the client who invited them gets {money(data.terms.referralCents / 100)} off their next one. Take each credit off the bill, then mark it applied here. <span className="admin-rewards-provisional">Amounts, services and perks are provisional: yours to set.</span></p>
      <h3>Credits to take off a bill <span>{owed.length ? money(owed.reduce((sum, credit) => sum + credit.amount, 0)) : ''}</span></h3>
      {owed.length ? <ol className="admin-rewards-list">{owed.map(credit => <li key={credit.id} className="admin-reward">
        <p className="admin-reward-main"><strong>{money(credit.amount)}</strong> · {credit.kind === 'welcome' ? 'Welcome gift' : 'Referral credit'} for {credit.owner.who}{credit.owner.email ? <span> · {credit.owner.email}</span> : null}</p>
        <p className="admin-reward-meta">Issued {shortDate(credit.createdAt)}</p>
        <div className="admin-reward-actions">
          <label>Off the bill of <select value={targets[credit.id] ?? suggested(credit)} onChange={event => setTargets(current => ({ ...current, [credit.id]: event.target.value }))}>
            <option value="">Choose a booking</option>
            {(choices(credit).length ? choices(credit) : state.bookings).map(item => <option key={item.id} value={item.id}>{item.id} · {item.guest} · {shortDate(item.date)}</option>)}
          </select></label>
          <button className="button" type="button" disabled={!!busy || !(targets[credit.id] ?? suggested(credit))} onClick={() => void act(credit, 'apply')}>{busy === credit.id + 'apply' ? 'Saving…' : 'Mark applied'}</button>
          <button className="button secondary" type="button" disabled={!!busy} onClick={() => void act(credit, 'void')}>Void</button>
        </div>
      </li>)}</ol> : <p className="admin-rewards-empty">Nothing owed right now.</p>}

      <h3>Referrals</h3>
      {data.referrals.length ? <ol className="admin-rewards-list">{data.referrals.map(referral => <li key={referral.id} className="admin-reward">
        <p className="admin-reward-main"><strong>{referral.friend}</strong> ({referral.friendBookingId}{referral.date ? `, ${shortDate(referral.date)}` : ''}) · invited by {referral.owner.who}{referral.source === 'invitation' ? ', from their dinner invitation' : ''}</p>
        <p className="admin-reward-meta">{referralStatus[referral.status]}</p>
      </li>)}</ol> : <p className="admin-rewards-empty">No referrals yet.</p>}

      {settled.length > 0 && <details className="admin-rewards-history"><summary>Applied and voided credits ({settled.length})</summary><ol className="admin-rewards-list">{settled.map(credit => <li key={credit.id} className="admin-reward">
        <p className="admin-reward-main">{money(credit.amount)} · {credit.owner.who} · {credit.status === 'applied' ? `applied to ${credit.appliedBookingId}${credit.appliedAt ? ' on ' + shortDate(credit.appliedAt) : ''}` : credit.note || 'Voided'}</p>
        <div className="admin-reward-actions"><button className="button secondary" type="button" disabled={!!busy} onClick={() => void act(credit, 'reopen')}>Reopen</button></div>
      </li>)}</ol></details>}

      <h3>Regulars’ perks</h3>
      <ul className="admin-rewards-perks">{data.terms.milestones.map(milestone => <li key={milestone.evenings}>After {milestone.evenings} evenings: {milestone.perk}</li>)}</ul>
      <p className="admin-rewards-empty">Clients see these in their account once they’ve had that many evenings. You honour them when you plan the next one.</p>
    </>}
  </section>
}
