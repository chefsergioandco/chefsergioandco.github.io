import { useEffect, useRef, useState, type MouseEventHandler, type PointerEvent } from 'react'
import { Icon, type IconName } from '../components/Icons'
import './AccountIconNav.css'

export type AccountNavSymbol = 'evenings' | 'menus' | 'reviews' | 'rewards' | 'settings' | 'profile' | 'security' | 'privacy'
type Common = { symbol: AccountNavSymbol; label: string; edge?: 'start' | 'end' }
type Props = Common & ({ kind: 'link'; href: string; current?: boolean } | { kind: 'button'; controls: string; onClick: MouseEventHandler<HTMLButtonElement> })
const existing: Partial<Record<AccountNavSymbol, IconName>> = { evenings: 'calendar-days', menus: 'book-open', rewards: 'gift' }

/** Match the site's outline icons while keeping these account-specific symbols local. */
function NavGlyph({ symbol }: { symbol: AccountNavSymbol }) {
  const icon = existing[symbol]
  if (icon) return <Icon name={icon} size={22}/>
  return <svg className="account-nav-glyph" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {symbol === 'reviews' && <><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z"/><path d="M8 11h8M8 14h5"/></>}
    {symbol === 'settings' && <><path d="M4 7h3m4 0h9M4 17h9m4 0h3"/><circle cx="9" cy="7" r="2"/><circle cx="15" cy="17" r="2"/></>}
    {symbol === 'profile' && <><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></>}
    {symbol === 'security' && <><circle cx="8" cy="8" r="5"/><path d="m11.5 11.5 9 9M16 16l2-2m1 5 2-2"/></>}
    {symbol === 'privacy' && <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/></>}
  </svg>
}

/** Fixed-size navigation targets. The name is always accessible; its visual label appears on hover or focus. */
export function AccountIconNavControl(props: Props) {
  const tooltip = useRef<HTMLSpanElement>(null)
  const [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false), [dismissed, setDismissed] = useState(false)
  const visible = (hovered || focused) && !dismissed
  useEffect(() => {
    if (!visible) return
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !tooltip.current?.getClientRects().length) return
      event.preventDefault(); event.stopPropagation(); setDismissed(true)
    }
    document.addEventListener('keydown', dismiss, true)
    return () => document.removeEventListener('keydown', dismiss, true)
  }, [visible])
  const shared = {
    className: 'account-icon-nav-control',
    'aria-label': props.label,
    'data-label-edge': props.edge,
    onPointerEnter: (event: PointerEvent<HTMLElement>) => { if (event.pointerType !== 'touch') { setHovered(true); setDismissed(false) } },
    onPointerLeave: () => setHovered(false),
    onFocus: () => { setFocused(true); setDismissed(false) },
    onBlur: () => setFocused(false),
    children: <><NavGlyph symbol={props.symbol}/><span ref={tooltip} className="account-icon-nav-hint" data-account-nav-hint hidden={!visible} aria-hidden="true"><span>{props.label}</span></span></>,
  }
  return props.kind === 'link'
    ? <a {...shared} href={props.href} aria-current={props.current ? 'page' : undefined}/>
    : <button {...shared} type="button" aria-controls={props.controls} onClick={props.onClick}/>
}
