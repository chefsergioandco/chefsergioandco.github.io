import { clock, longDate } from './format'

export type InvitationPaperDetails = {
  title: string; hostName: string; date: string; time: string; venueName: string; address: string[];
  menuReady?: boolean; menu?: string | null; menuVersion?: string;
}

/** The menu is an inside leaf of this invitation, available only after release. */
export function InvitationPaper({ invitation, hasNewMenu = false, onMenuOpen }: { invitation: InvitationPaperDetails; hasNewMenu?: boolean; onMenuOpen?: () => void }) {
  const menu = invitation.menuReady === true && typeof invitation.menu === 'string' ? invitation.menu.trim() : ''
  const newMenu = !!menu && hasNewMenu
  return <article className={`event-invitation-card${newMenu ? ' has-new-menu' : ''}`} data-menu-ready={!!menu} data-new-menu={newMenu}>
    <div className="event-invitation-front">
      {newMenu && <button type="button" className="event-invitation-new-menu" onClick={event => {
        const details = event.currentTarget.closest('article')?.querySelector<HTMLDetailsElement>('[data-invitation-menu]')
        if (details) { details.open = true; details.querySelector('summary')?.focus() }
      }}><span className="event-invitation-new-spark" aria-hidden="true">✦</span><span>Menu added<small>Open your menu</small></span></button>}
      <p className="eyebrow">YOU’RE INVITED</p>
      <h2>{invitation.title}</h2>
      <p className="event-invitation-host">Hosted by {invitation.hostName}</p>
      <div className="event-invitation-rule" />
      <p className="event-invitation-date">{longDate(invitation.date)}</p>
      <p>{clock(invitation.time)} · Orlando / Eastern time</p>
      <address><strong>{invitation.venueName}</strong>{invitation.address.map((line, index) => <span key={index}>{line}</span>)}</address>
      <p className="event-invitation-signature">An evening with Sergio.</p>
    </div>
    {menu && <details key={invitation.menuVersion ?? menu} className="event-invitation-inside" data-invitation-menu="" onToggle={event => { if (event.currentTarget.open) onMenuOpen?.() }}>
      <summary><span id="invitation-menu-title" className="eyebrow">THE MENU</span><span className="event-invitation-menu-action"><span className="event-menu-open-label">Open menu</span><span className="event-menu-close-label">Close menu</span><span className="event-menu-chevron" aria-hidden="true">⌄</span></span></summary>
      <div className="event-invitation-menu">{menu.split('\n').filter(line => line.trim()).map((line, index) => <p key={index}>{line}</p>)}</div>
    </details>}
    {menu && <section className="event-invitation-print-menu" aria-hidden="true"><h3 className="eyebrow">THE MENU</h3><div className="event-invitation-menu">{menu.split('\n').filter(line => line.trim()).map((line, index) => <p key={index}>{line}</p>)}</div></section>}
    {newMenu && <span className="sr-only" role="status">A menu has been added to your invitation. Open your menu to see what’s new.</span>}
  </article>
}
