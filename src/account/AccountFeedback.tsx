import type { ReactNode } from 'react'
import { Icon, type IconName } from '../components/Icons'
import './AccountFeedback.css'

export type AccountNotice = { title: string; detail?: string; note?: string; icon?: IconName }

/** An account update reads as a small receipt, with its outcome stated in words. */
export function AccountFeedback({ title, detail, note, icon = 'check', children, alert = false }: AccountNotice & { children?: ReactNode; alert?: boolean }) {
  return <div className="account-feedback" role={alert ? 'alert' : 'status'}>
    <Icon className="account-feedback-icon" name={alert ? 'x' : icon} size={22}/>
    <div className="account-feedback-copy">
      <p className="account-feedback-title">{title}</p>
      {detail && <p className="account-feedback-detail">{detail}</p>}
      {note && <p className="account-feedback-note">{note}</p>}
      {children}
    </div>
  </div>
}
