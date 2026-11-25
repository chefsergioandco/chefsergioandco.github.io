import type { ReactNode } from 'react'
import { site, type FormatKey } from '../content/site'
import { Icon } from './Icons'

/** The guest range tag shown with each experience in the header's Experiences menu and on the booking form. */
export function GuestTag({ format, children }: { format?: FormatKey; children?: ReactNode }) {
  const range = format ? site.formats[format] : null
  return (
    <span className="sergio-header-guest-tag">
      <Icon name="users" size={14} />
      {children ?? (range ? `${range.min}–${range.max} guests` : null)}
    </span>
  )
}
