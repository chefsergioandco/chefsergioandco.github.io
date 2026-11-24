import { AnimatePresence, m, useReducedMotion } from 'framer-motion'
import type { ReactNode } from 'react'
import { site, type FormatKey } from '../content/site'
import { inWords } from './ui'
import { Logo } from './Logo'
import './MenuCard.css'

export type Where = 'home' | 'rental' | 'his'

export type CardData = {
  format?: FormatKey
  /** 'table' = seats at a published Sergio's table night (overrides format) */
  table?: boolean
  occasion?: string
  guests?: number
  date?: string // yyyy-mm-dd
  time?: string // HH:MM
  flexible?: boolean
  where?: Where
  place?: string
  dishes?: string[]
  /** a table night's menu title, shown instead of chosen dishes */
  nightTitle?: string
  dietary?: string[]
  name?: string
}

const NOUN: Record<FormatKey, string> = { dinner: 'dinner', class: 'cooking class', event: 'gathering' }
const an = (w: string) => (/^[aeiou]/i.test(w) ? 'An' : 'A')

function title(d: CardData) {
  if (d.table) return "Sergio's table"
  const noun = d.format ? NOUN[d.format] : 'evening'
  if (d.occasion && d.occasion !== 'Something else') return `${an(d.occasion)} ${d.occasion.toLowerCase()} ${noun}`
  return d.format === 'dinner' ? 'A private dinner' : `${an(noun)} ${noun}`
}

function formatDate(iso?: string) {
  if (!iso) return null
  const [y, mo, day] = iso.split('-').map(Number)
  if (!y || !mo || !day) return null
  return new Date(Date.UTC(y, mo - 1, day, 12)).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function clock(hhmm?: string) {
  if (!hhmm) return ''
  const [h, mi] = hhmm.split(':').map(Number)
  return `${((h + 11) % 12) + 1}:${String(mi).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
}

function placeLine(d: CardData) {
  if (d.table || d.where === 'his') return "at Sergio's table"
  if (!d.place) return d.where === 'rental' ? 'at your vacation rental' : null
  return `in ${d.place}`
}

function signoff(d: CardData) {
  if (d.table || d.where === 'his') return 'Hosted by Chef Sergio at his home'
  if (d.format === 'event') return `Catered by ${site.name}`
  return `Cooked in your ${d.where === 'rental' ? "rental's " : ''}kitchen by ${site.chef}`
}

/**
 * One line of the card. When `live`, a line that changes is "written in" left to right (a clip reveal), which is the
 * card's state change made visible. First render never animates, so the prerendered card is fully visible.
 */
function Line({ live, id, className, children }: { live: boolean; id: string; className?: string; children: ReactNode }) {
  const reduce = useReducedMotion()
  if (!live || reduce) return <p className={className}>{children}</p>
  return (
    <AnimatePresence initial={false} mode="wait">
      <m.p
        key={id}
        className={className}
        initial={{ clipPath: 'inset(0 100% 0 0)' }}
        animate={{ clipPath: 'inset(0 0% 0 0)' }}
        exit={{ opacity: 0, transition: { duration: 0.08 } }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      >
        {children}
      </m.p>
    </AnimatePresence>
  )
}

/**
 * The status page's card, composed like the printed dinner menu (menu-artwork.ts): rouge dedication, tracked capital
 * label and italic date at the head; the menu in the middle with rouge hairlines; logo and a rouge status line at the
 * foot, where the printed menu states whether it is a draft.
 */
function PrintedMenuCard({ data, stamp, className }: { data: CardData; stamp: string; className: string }) {
  const date = formatDate(data.date)
  const g = data.guests
  const where = placeLine(data)
  return (
    <div className={`menu-card menu-card--printed ${className}`}>
      <div className="menu-sheet">
        <header>
          {g ? <p className="menu-sheet-dedication">For {inWords(g)} {g === 1 ? 'guest' : 'guests'}</p> : null}
          <p className="menu-sheet-label">{title(data)}</p>
          {date && (
            <p className="menu-sheet-date">
              {date}
              {data.time ? `, ${clock(data.time)}` : ''}
              {data.flexible ? ', or nearby' : ''}
            </p>
          )}
          {where && <p className="menu-sheet-date">{where}</p>}
        </header>
        <div className="menu-sheet-body">
          {data.nightTitle ? (
            <p className="menu-sheet-course">{data.nightTitle}</p>
          ) : data.dishes && data.dishes.length > 0 ? (
            <ul className="menu-sheet-courses">
              {data.dishes.map((d, i) => (
                <li key={d}>
                  {i > 0 && <div className="menu-sheet-rule" aria-hidden />}
                  <p className="menu-sheet-course">{d}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="menu-sheet-course menu-sheet-course--pending">Menu written around your guests</p>
          )}
          {data.dietary && data.dietary.length > 0 && (
            <p className="menu-sheet-note">Prepared {data.dietary.map((x) => x.toLowerCase()).join(', ')}</p>
          )}
        </div>
        <footer>
          <p className="menu-sheet-signoff">{signoff(data)}</p>
          <Logo />
          <p data-stamp className="menu-sheet-status">{stamp}</p>
        </footer>
      </div>
    </div>
  )
}

/**
 * The printed menu card. On the booking page it fills in as the visitor answers; on the status page it carries a
 * status (Held, Reserved, Requested) and is set like the printed dinner menu; elsewhere it shows a finished example.
 * Centered like a real menu; everything else on the site is left-aligned.
 */
export function MenuCard({ data, live = false, stamp, className = '' }: { data: CardData; live?: boolean; stamp?: string; className?: string }) {
  if (stamp) return <PrintedMenuCard data={data} stamp={stamp} className={className} />
  const date = formatDate(data.date)
  const g = data.guests
  const where = placeLine(data)
  return (
    <div className={`menu-card relative px-8 py-10 sm:px-10 ${className}`} aria-live={live ? 'polite' : undefined} aria-label={live ? 'Your request so far' : undefined}>
      <Logo />
      <div className="mx-auto my-4 h-px w-10 bg-ink/30" aria-hidden />
      <Line live={live} id={title(data)} className="font-display text-2xl leading-tight sm:text-3xl">
        {title(data)}
      </Line>
      <Line live={live} id={`g${g}`} className="mt-2 font-display text-lg italic">
        {g ? `for ${inWords(g)} ${g === 1 ? 'guest' : 'guests'}` : live ? <span className="text-ink-muted">for your guests</span> : null}
      </Line>
      <Line live={live} id={`d${date}${data.time}${data.flexible}`} className="mt-1 text-sm text-ink-muted">
        {date ?? (live ? 'Date to be chosen' : null)}
        {date && data.time ? `, ${clock(data.time)}` : ''}
        {data.flexible && date ? ', or nearby' : ''}
      </Line>
      {where && (
        <Line live={live} id={where} className="text-sm text-ink-muted">
          {where}
        </Line>
      )}

      <div className="mx-auto my-5 h-px w-10 bg-ink/30" aria-hidden />
      {data.nightTitle ? (
        <Line live={live} id={data.nightTitle} className="font-display text-lg">
          {data.nightTitle}
        </Line>
      ) : data.dishes && data.dishes.length > 0 ? (
        <ul className="space-y-1.5 font-display text-lg">
          {data.dishes.map((d) => (
            <li key={d}>
              <Line live={live} id={d}>
                {d}
              </Line>
            </li>
          ))}
        </ul>
      ) : (
        <p className="font-display text-base italic text-ink-muted">
          {live ? 'Your menu is written with you after this request.' : 'Menu written around your guests'}
        </p>
      )}
      {data.dietary && data.dietary.length > 0 && (
        <Line live={live} id={data.dietary.join()} className="mt-4 text-sm text-ink-muted">
          Prepared {data.dietary.map((x) => x.toLowerCase()).join(', ')}
        </Line>
      )}
      <div className="mx-auto my-5 h-px w-10 bg-ink/30" aria-hidden />
      <Line live={live} id={signoff(data)} className="font-display text-sm italic text-ink-muted">
        {signoff(data)}
      </Line>
    </div>
  )
}
