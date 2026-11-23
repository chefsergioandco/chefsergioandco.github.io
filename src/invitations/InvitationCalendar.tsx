import { useMemo, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type { InvitationDocument } from '../../prototypes/sergio-admin/shared/invitations/types'
import { invitationCalendarFile, invitationCalendarLinks } from '../../prototypes/sergio-admin/shared/invitations/links'
import { Icon } from '../components/Icons'
import './InvitationLocation.css'
import './InvitationCalendar.css'

export function InvitationCalendar({ document: invitation, preview = false, revision }: { document: InvitationDocument; preview?: boolean; revision?: number }) {
  const [open, setOpen] = useState(false), [message, setMessage] = useState('')
  const trigger = useRef<HTMLButtonElement>(null)
  const data = useMemo(() => { try { return { links: invitationCalendarLinks(invitation), file: invitationCalendarFile(invitation, { preview, revision }) } } catch { return null } }, [invitation, preview, revision])
  const date = new Date(invitation.date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  const [hours, minutes] = invitation.startTime.split(':').map(Number)
  const time = `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${hours >= 12 ? 'pm' : 'am'} Eastern time`
  function download() {
    if (!data) return
    const url = URL.createObjectURL(new Blob([data.file], { type: 'text/calendar;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = `chef-sergio-${invitation.date}.ics`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1500)
    setMessage('Open or import the calendar file in your calendar app.')
  }
  return <div className="invitation-calendar">
    <button ref={trigger} className="invitation-calendar-button" disabled={!data} type="button" onClick={() => { setMessage(''); setOpen(true) }}><Icon name="calendar-days" size={18} />Add to calendar</button>
    <p className="invitation-calendar-hint">{data ? 'Choose Apple Calendar, Google Calendar, Outlook or a calendar file.' : 'Calendar details will be available once the event time is confirmed.'}</p>
    <Dialog.Root open={open} onOpenChange={setOpen}><Dialog.Portal><Dialog.Overlay className="invitation-choice-overlay" /><Dialog.Content className="invitation-choice-dialog invitation-calendar-dialog" onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus() }}><header><div><Dialog.Title>Keep the evening free.</Dialog.Title><Dialog.Description>Choose where to add a calendar copy of your invitation.</Dialog.Description></div><Dialog.Close className="invitation-choice-close" aria-label="Close calendar options"><Icon name="x" size={22} /></Dialog.Close></header>
      <div className="invitation-calendar-summary"><strong>{invitation.title}</strong><span>{date}</span><span>{time}</span><span>{invitation.venueName}</span></div>
      <div className="invitation-choice-options">{data && <><button type="button" onClick={download}><span>Apple Calendar</span><span>Open or import an .ics file</span></button><a href={data.links.google} target="_blank" rel="noreferrer"><span>Google Calendar</span><span>Review and save</span></a><a href={data.links.outlook} target="_blank" rel="noreferrer"><span>Outlook.com</span><span>Review and save</span></a><a href={data.links.outlookWork} target="_blank" rel="noreferrer"><span>Microsoft 365</span><span>Work or school Outlook</span></a><button type="button" onClick={download}><span>Download calendar file</span><span>For another calendar app</span></button></>}</div>
      <p className="invitation-choice-note">You review the event before saving it. Calendar copies do not update automatically; the invitation page has the latest confirmed details.</p><p className="invitation-calendar-download-status" role="status" aria-live="polite">{message}</p>
    </Dialog.Content></Dialog.Portal></Dialog.Root>
  </div>
}

export default InvitationCalendar
