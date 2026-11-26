import { useEffect, useState } from 'react'
import { hostInvite } from '../booking/referral'
import { href, track } from '../components/ui'

/** Once the evening has happened, a guest's invitation thanks them and offers an evening of their own, through
 * the host's link: the guest's first evening comes with a welcome gift, and the host earns a credit. */
export function InvitationAfterEvening({ invitationId, accessToken }: { invitationId: string; accessToken: string }) {
  const [offer, setOffer] = useState<{ code: string; host: string; welcome: number } | null>(null)
  useEffect(() => {
    let current = true
    hostInvite(invitationId, accessToken).then(value => { if (current && value.available && value.code && value.host && typeof value.welcome === 'number') setOffer({ code: value.code, host: value.host, welcome: value.welcome }) }, () => {})
    return () => { current = false }
  }, [invitationId, accessToken])
  if (!offer) return null
  const welcome = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(offer.welcome)
  return <section className="invitation-after" aria-labelledby="invitation-after-title">
    <p className="invitation-after-eyebrow">after the evening</p>
    <h2 id="invitation-after-title">Thank you for coming to {offer.host}’s table.</h2>
    <p>If you’d like Sergio to cook for your own guests, your first evening comes with {welcome} off, as {offer.host}’s guest.</p>
    <a className="invitation-after-action" href={href(`/book/?friend=${offer.code}&via=invitation`)} onClick={() => track('invitation_host_your_own', {})}>Plan your own evening</a>
  </section>
}
