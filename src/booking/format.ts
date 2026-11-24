import type { BookingReceipt } from './types'

const at = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12))
}
export const longDate = (iso: string) => at(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })
export const shortDate = (iso: string) => at(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
export const monthLabel = (ym: string) => at(`${ym}-01`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
export function clock(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number)
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
}
export const money = (n: number) => new Intl.NumberFormat('en-US', {style:'currency',currency:'USD',minimumFractionDigits:0,maximumFractionDigits:2}).format(n)
export function addMonths(ym: string, n: number) {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Confirmed appointments only, with the business wall clock converted to UTC. No duration is invented. */
export function ics(b: BookingReceipt) {
  if (b.status !== 'confirmed' || !b.date || !b.time) return null
  const wall = Date.parse(b.date + 'T' + b.time + ':00Z')
  const formatter = new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
  const clockAt = (instant:number) => {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(part => [part.type,part.value]))
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00Z`
  }
  let instant = wall
  if (!Number.isFinite(wall)) return null
  for (let i=0;i<3;i++) instant += wall - Date.parse(clockAt(instant))
  if (clockAt(instant) !== b.date + 'T' + b.time + ':00Z') return null
  const stamp = new Date(instant).toISOString().replace(/[-:]/g,'').replace(/\.\d+/, '')
  const what = b.kind === 'table' ? "Sergio's table" : b.kind === 'class' ? 'Cooking class with Chef Sergio' : b.kind === 'event' ? 'Event with Chef Sergio & Co.' : 'Private dinner with Chef Sergio'
  const esc = (value:string) => value.replace(/[\\;,]/g, char => `\\${char}`).replace(/\r?\n/g,'\\n')
  return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Chef Sergio & Co.//Booking//EN','BEGIN:VEVENT',`UID:${esc(b.ref)}@chefsergioandco.github.io`,`DTSTAMP:${new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+/, '')}`,`DTSTART:${stamp}`,`SUMMARY:${esc(what)}`,`DESCRIPTION:${esc('Confirmed appointment. Questions: (407) 757-3009.')}`,'STATUS:CONFIRMED','END:VEVENT','END:VCALENDAR'].join('\r\n')
}
