/**
 * The one-screen booking: party size first, then the format that fits it, an open evening, and contact details.
 * Everything Sergio needs for the menu conversation is collected after the deposit (see PrepareDetails), so a guest
 * reaches the payment screen in seconds. Pure functions only, so they can be tested without a browser.
 */
import { site, type FormatKey } from '../content/site'
import { formatGiftCode, isGiftCode } from '../../prototypes/sergio-admin/shared/gift-cards/code'
import type { Availability, BookingRequest, OpenDay, PartyBand, PlanningConfig, Where } from './types'

export type QuickState = {
  format?: FormatKey
  partyBandId: string
  dateMode: 'exact' | 'undecided'
  date?: string
  time?: string
  dietary: string[]
  where: Where
  place: string
  name: string
  email: string
  phone: string
  contactBy: 'email' | 'call' | 'text'
  gift: string
}

export const QUICK_EMPTY: QuickState = { partyBandId: '', dateMode: 'exact', dietary: [], where: 'home', place: '', name: '', email: '', phone: '', contactBy: 'email', gift: '' }

/** Order in which formats are offered when a party size fits more than one. */
export const FORMAT_ORDER: FormatKey[] = ['dinner', 'event']

/** A format fits a party-size band when the band overlaps the guest range Sergio serves for it. */
export function formatFits(format: FormatKey, band: Pick<PartyBand, 'min' | 'max'>): boolean {
  const range = site.formats[format]
  return band.max >= range.min && band.min <= range.max
}
export function formatsFor(band: Pick<PartyBand, 'min' | 'max'> | undefined, requested?: FormatKey): FormatKey[] {
  const choices = requested === 'class' ? [...FORMAT_ORDER, 'class' as const] : FORMAT_ORDER
  return band ? choices.filter(format => formatFits(format, band)) : choices
}

/** A dinner start Sergio's guests usually want: 6:30 pm, then the nearest evening slot, then the latest open time. */
export function preferredTime(times: string[]): string | undefined {
  if (!times.length) return undefined
  for (const time of ['18:30', '18:00', '19:00', '17:30', '19:30', '17:00']) if (times.includes(time)) return time
  return times.find(time => time >= '17:00') ?? times[times.length - 1]
}

/** The next open days across the loaded months, soonest first. */
export function nextOpenDays(months: (Availability | null | undefined)[], today: string, count = 6): OpenDay[] {
  const seen = new Set<string>(), days: OpenDay[] = []
  for (const month of months) for (const day of month?.days ?? []) {
    if (day.date < today || !day.times.length || seen.has(day.date)) continue
    seen.add(day.date); days.push(day)
  }
  return days.sort((a, b) => a.date.localeCompare(b.date)).slice(0, count)
}

export function quickBand(s: QuickState, config: PlanningConfig | null) { return config?.partyBands.find(band => band.id === s.partyBandId) }

/** The same planning request the multi-step form sends, with the menu-conversation answers left for later. */
export function quickRequest(s: QuickState): BookingRequest {
  const exact = s.dateMode === 'exact'
  return {
    preparationMeta: { version: 1, source: 'quick', budgetExplicit: false },
    kind: s.format!, name: s.name.trim(), email: s.email.trim(), phone: s.phone.trim(), contactBy: s.contactBy,
    dietary: s.dietary, notes: '', gift: s.gift.trim() ? (isGiftCode(s.gift) ? formatGiftCode(s.gift) : s.gift.trim()) : undefined,
    ...(exact ? { date: s.date, time: s.time } : {}),
    flexible: !exact, where: s.where, place: s.where === 'his' ? undefined : s.place.trim(), occasion: '',
    planning: {
      dateMode: s.dateMode, partyBandId: s.partyBandId, headcount: null, kitchen: '', budgetMode: 'guidance',
      budgetMin: null, budgetMax: null, budgetUnit: 'total', foodIdeas: '', allergies: '', physicalInvitations: false,
    },
  }
}

/** Field errors keyed like the multi-step form's, so the same error styling and focus handling apply. */
export function validateQuick(s: QuickState, config: PlanningConfig | null, options: { openTimes: string[]; availabilityLoaded: boolean; today: string }): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!config) errors.config = 'Load the booking settings before sending.'
  const band = quickBand(s, config)
  if (!band) errors.partyBand = 'Choose about how many people.'
  if (!s.format) errors.format = 'Choose the kind of gathering.'
  else if (band && !formatFits(s.format, band)) errors.format = `For ${band.label.toLowerCase()}, choose a format that fits the group.`
  if (s.where === 'his' && s.format !== 'dinner') errors.where = 'Only a private dinner can be hosted at Sergio’s table.'
  if (s.dateMode === 'exact') {
    if (!options.availabilityLoaded) errors.date = 'Load Sergio’s open dates, or choose “Not sure yet”.'
    else if (!s.date || s.date < options.today || !options.openTimes.length) errors.date = 'Choose one of Sergio’s open evenings.'
    else if (!s.time || !options.openTimes.includes(s.time)) errors.time = 'Choose an available start time.'
  }
  if (s.name.trim().length < 2 || s.name.length > 150) errors.name = 'Enter your name.'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email.trim()) || s.email.length > 254) errors.email = 'Enter an email address like name@example.com.'
  if ((s.contactBy !== 'email' || s.phone.trim()) && (s.phone.replace(/\D/g, '').length < 10 || s.phone.length > 40)) errors.phone = 'Enter a phone number with at least 10 digits.'
  if (s.gift.trim() && !isGiftCode(s.gift)) errors.gift = 'That code isn’t complete. It has 16 characters; the letters I, L, O and U aren’t used.'
  return errors
}
