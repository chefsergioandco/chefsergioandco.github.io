import { useId } from 'react'
import { PRIVACY_CONTACT_EMAIL, PRIVACY_REQUEST_HREF, SENSITIVE_DATA_CONSENT_TEXT } from './policy'
import './SensitiveDataConsent.css'

/** One person's optional sensitive event information; separate from booking and marketing. */
export function SensitiveDataConsent({ checked, onChange, disabled = false, id, withdrawalInstruction = 'update your response without those details' }: { checked: boolean; onChange: (granted: boolean) => void; disabled?: boolean; id?: string; withdrawalInstruction?: string }) {
  const generated = useId(), control = id || 'sensitive-consent-' + generated
  return <div className="sensitive-consent">
    <p id={control + '-purpose'}>Dietary, allergy and accessibility details are optional and private. Share only your own needs; other adults should use their own private guest response. You can book or respond without entering these details.</p>
    <label className="sensitive-consent-choice" htmlFor={control}><input id={control} type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} aria-describedby={control + '-purpose ' + control + '-withdrawal'}/><span>{SENSITIVE_DATA_CONSENT_TEXT}</span></label>
    <p className="sensitive-consent-note" id={control + '-withdrawal'}>Untick to remove details you have not sent. To withdraw information already saved, {withdrawalInstruction} or contact <a href={'mailto:' + PRIVACY_CONTACT_EMAIL + '?subject=Withdraw%20sensitive%20event%20information'}>{PRIVACY_CONTACT_EMAIL}</a>. Withdrawal does not cancel your booking or RSVP.</p>
    <p className="sensitive-consent-note">Only Sergio and authorized people preparing the experience use these details. We normally remove them 30 days after the event; a limited record may be needed for an open data-rights request, incident or legal claim. Sergio must confirm any essential accommodation. <a href={PRIVACY_REQUEST_HREF}>Privacy and your choices</a>.</p>
  </div>
}

export default SensitiveDataConsent
