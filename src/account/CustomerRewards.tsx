import { useEffect, useState } from 'react'
import { accountApi, AccountApiError } from './api'

type Rewards = {
  code: string; link: string; evenings: number; available: number
  milestones: { evenings: number; perk: string; reached: boolean }[]
  referrals: { id: string; name: string; service: string | null; status: 'pending' | 'earned' | 'void'; source: 'link' | 'invitation'; createdAt: string }[]
  credits: { id: string; kind: 'welcome' | 'referral'; amount: number; status: 'pending' | 'available' | 'applied' | 'void'; createdAt: string; appliedAt: string | null }[]
  terms: { welcome: number; referral: number; services: string[] }
}
const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value)
const shortDate = (value: string) => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const friendStatus = { pending: 'Booked. Your credit arrives after their evening.', earned: 'Their evening happened. Your credit is ready.', void: 'Their evening didn’t go ahead.' }
const creditLabel = (credit: Rewards['credits'][number]) => credit.kind === 'welcome' ? 'Welcome gift on your first evening' : 'For a friend’s evening'
const PLURAL: Record<string, string> = { 'Private dinner': 'private dinners', 'Cooking class': 'cooking classes', 'Small event': 'small events', 'Sergio’s Table': 'seats at Sergio’s table' }
const creditStatus = { pending: 'Pending', available: 'Ready for your next bill', applied: 'Used', void: 'Not available' }

/** Share Sergio with friends, see what it has earned, and the perks your own evenings have unlocked. */
export function CustomerRewards() {
  const [data, setData] = useState<Rewards | null>(null), [error, setError] = useState(''), [copied, setCopied] = useState(false)
  useEffect(() => { accountApi<Rewards>('/customer/rewards').then(setData, value => setError(value instanceof AccountApiError || value instanceof Error ? value.message : 'Your rewards could not be opened.')) }, [])
  const url = data ? new URL(data.link, location.origin).href : ''
  const message = data ? `I’ve been cooking with Chef Sergio. Book your first evening through my link and it comes with ${money(data.terms.welcome)} off (I get a credit too):` : ''
  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2500) }
    catch { (document.getElementById('reward-link') as HTMLInputElement | null)?.select() }
  }
  async function share() {
    try { await navigator.share({ title: 'An evening with Chef Sergio', text: message, url }) } catch { /* Closing the share sheet is fine. */ }
  }
  const next = data?.milestones.find(milestone => !milestone.reached)
  return <section className="ev-panel ev-rewards">
    <h1 tabIndex={-1}>Rewards.</h1>
    {error && <div className="notice error" role="alert">{error}</div>}
    {!data ? !error && <p className="ev-note" role="status">Opening your rewards…</p> : <>
      <p className="ev-intro">Share Sergio with friends. Their first evening through your link comes with {money(data.terms.welcome)} off its final bill, and once it has happened, you get {money(data.terms.referral)} off your next one.</p>

      <section className="ev-reward-share" aria-labelledby="reward-share-title">
        <h2 id="reward-share-title">Your invitation link</h2>
        <div className="ev-reward-link"><input id="reward-link" readOnly value={url} aria-label="Your invitation link" onFocus={event => event.currentTarget.select()}/>
          <button className="ev-primary" type="button" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy link'}</button>
          {typeof navigator !== 'undefined' && 'share' in navigator && <button className="ev-text-button" type="button" onClick={() => void share()}>Share…</button>}
        </div>
        <p className="ev-note" role="status">{copied ? 'Your link is copied.' : ''}</p>
        <p className="ev-note">Friends see your first name and last initial. If you post your link publicly, mention that you get a credit when friends book. It applies to {data.terms.services.map(service => PLURAL[service] ?? service.toLowerCase()).join(', ').replace(/, ([^,]*)$/, ' and $1')}.</p>
      </section>

      <section className="ev-reward-balance" aria-labelledby="reward-balance-title">
        <h2 id="reward-balance-title">Your credit</h2>
        <p className="ev-reward-amount">{money(data.available)}</p>
        <p className="ev-note">{data.available > 0 ? 'Sergio takes it off the final bill of your next evening.' : 'Credits appear here once a friend’s evening has happened.'}</p>
        {data.credits.length > 0 && <ul className="ev-reward-list">{data.credits.map(credit => <li key={credit.id}><span>{money(credit.amount)} · {creditLabel(credit)}</span><span className="ev-note">{creditStatus[credit.status]}{credit.appliedAt ? ` ${shortDate(credit.appliedAt)}` : ''}</span></li>)}</ul>}
      </section>

      <section aria-labelledby="reward-friends-title">
        <h2 id="reward-friends-title">Friends who booked</h2>
        {data.referrals.length ? <ul className="ev-reward-list">{data.referrals.map(referral => <li key={referral.id}><span>{referral.name}{referral.service ? ` · ${referral.service === 'Sergio’s Table' ? 'Sergio’s table' : referral.service}` : ''}{referral.source === 'invitation' ? ' · a guest at your table' : ''}</span><span className="ev-note">{friendStatus[referral.status]}</span></li>)}</ul>
          : <p className="ev-note">No one yet. Guests at your table can also book through a link on their invitation, the morning after.</p>}
      </section>

      <section aria-labelledby="reward-regular-title">
        <h2 id="reward-regular-title">Your evenings with Sergio: {data.evenings}</h2>
        <ul className="ev-reward-milestones">{data.milestones.map(milestone => <li key={milestone.evenings} data-reached={milestone.reached}><span className="ev-reward-mark" aria-hidden="true">{milestone.reached ? '✓' : milestone.evenings}</span><span><strong>{milestone.perk}</strong><span className="ev-note">{milestone.reached ? 'Yours. Mention it when you plan your next evening.' : `After ${milestone.evenings} evenings`}</span></span></li>)}</ul>
        {next && <p className="ev-note">{next.evenings - data.evenings === 1 ? 'One more evening' : `${next.evenings - data.evenings} more evenings`} until the next.</p>}
      </section>
    </>}
  </section>
}
