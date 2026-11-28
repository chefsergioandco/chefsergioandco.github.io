import { sensitiveDataConsent } from '../privacy/policy'
import { booking } from '../content/booking'
import type { BookingRequest, Kind, Night, PlanningConfig, PlanningRequest, Where } from './types'

export const DRAFT_KEY = 'booking-draft:v2'
export type PlanningState = {
  kind?: Kind
  occasion: string
  dateMode: PlanningRequest['dateMode']
  date?: string
  time?: string
  dateFrom: string
  dateTo: string
  partyBandId: string
  headcountMode: 'exact' | 'approximate'
  guests?: number
  where: Where
  place: string
  kitchen: string
  budgetMode: 'range' | 'guidance'
  budgetMin: string
  budgetMax: string
  budgetUnit: PlanningRequest['budgetUnit']
  foodIdeas: string
  dietary: string[]
  allergies: string
  sensitiveConsent?: boolean
  notes: string
  nightId?: string
  seats: number
  name: string
  email: string
  phone: string
  contactBy: 'call' | 'text' | 'email'
  physicalInvitations: boolean
  gift: string
}
export const EMPTY: PlanningState = {
  occasion: '', dateMode: 'exact', dateFrom: '', dateTo: '', partyBandId: '', headcountMode: 'approximate',
  where: 'home', place: '', kitchen: '', budgetMode: 'guidance', budgetMin: '', budgetMax: '', budgetUnit: 'total',
  foodIdeas: '', dietary: [], allergies: '', sensitiveConsent: false, notes: '', seats: 2, name: '', email: '', phone: '', contactBy: 'email', physicalInvitations: false, gift: '',
}
export const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
export const todayET = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
export function selectedBand(s: PlanningState, config: PlanningConfig | null) { return config?.partyBands.find(band => band.id === s.partyBandId) }
export function budgetLabel(s: PlanningState) {
  if (s.budgetMode === 'guidance') return 'Sergio’s guidance requested'
  const format = (value: string) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value))
  return s.budgetMin && s.budgetMax ? `${format(s.budgetMin)}–${format(s.budgetMax)} ${s.budgetUnit === 'total' ? 'for the gathering' : 'per guest'}` : 'Spending range to complete'
}
export function validatePlanningStep(s: PlanningState, step: number, config: PlanningConfig | null, options: { openTimes: string[]; availabilityLoaded: boolean; night?: Night; seatsMax: number; today?: string }) {
  const errors: Record<string, string> = {}, today = options.today ?? todayET(), table = s.kind === 'table'
  if (step === 0 && !['dinner', 'class', 'event', 'table'].includes(s.kind ?? '')) errors.kind = 'Choose what you’re planning.'
  if (step === 1 && table) {
    if (!options.night || options.night.state === 'cancelled' || options.night.state === 'full' || options.night.date < today) errors.night = 'Choose an evening open for seat requests.'
    if (!Number.isInteger(s.seats) || s.seats < 1 || s.seats > options.seatsMax) errors.seats = `Choose 1 to ${options.seatsMax} seats.`
  }
  if (step === 1 && !table) {
    if (!config) errors.config = 'Load the booking settings before continuing.'
    const band = selectedBand(s, config)
    if (!band) errors.partyBand = 'Choose an approximate party size. The exact count can wait.'
    if (s.headcountMode === 'exact' && (!Number.isInteger(s.guests) || !s.guests || !band || s.guests < band.min || s.guests > band.max)) errors.guests = band ? `Enter a whole number from ${band.min} to ${band.max}, or change the party-size range.` : 'Choose a party-size range first.'
    if (s.dateMode === 'exact') {
      if (!options.availabilityLoaded) errors.date = 'Load Sergio’s open dates, or choose a flexible date.'
      else if (!s.date || !validDate(s.date) || s.date < today || !options.openTimes.length) errors.date = 'Choose one of Sergio’s open dates.'
      else if (!s.time || !options.openTimes.includes(s.time)) errors.time = 'Choose an available start time.'
    }
    if (s.dateMode === 'flexible') {
      if (s.dateFrom && (!validDate(s.dateFrom) || s.dateFrom < today)) errors.dateFrom = 'Enter a preferred date today or later, or leave the range open.'
      if (s.dateTo && (!validDate(s.dateTo) || s.dateTo < today || !!s.dateFrom && s.dateTo < s.dateFrom)) errors.dateTo = 'Enter an end date on or after the start date.'
    }
  }
  if (step === 2 && !table && s.budgetMode === 'range') {
    const minimum = Number(s.budgetMin), maximum = Number(s.budgetMax)
    if (!s.budgetMin || !Number.isFinite(minimum) || minimum < 1 || minimum > 1000000) errors.budgetMin = 'Enter the lower end of your spending range.'
    if (!s.budgetMax || !Number.isFinite(maximum) || maximum < minimum || maximum > 1000000) errors.budgetMax = 'Enter an upper amount at least as large as the lower amount.'
  }
  if (step === 3) {
    if (s.name.trim().length < 2 || s.name.length > 150) errors.name = 'Enter your name using at least two characters.'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email.trim()) || s.email.length > 254) errors.email = 'Enter an email address like name@example.com.'
    if ((s.contactBy !== 'email' || s.phone.trim()) && (s.phone.replace(/\D/g, '').length < 10 || s.phone.length > 40)) errors.phone = 'Enter a phone number with at least 10 digits.'
    if (!config) errors.config = 'Load the booking settings before sending.'
  }
  return errors
}
export function planningRequest(s: PlanningState): BookingRequest {
  const table = s.kind === 'table'
  return {
    kind: s.kind!, name: s.name.trim(), email: s.email.trim(), phone: s.phone.trim(), contactBy: s.contactBy,
    dietary: s.sensitiveConsent ? s.dietary : [], allergies: s.sensitiveConsent ? s.allergies.trim() : '', sensitiveDataConsent: sensitiveDataConsent(s.sensitiveConsent === true), notes: s.notes.trim(), gift: s.gift || undefined,
    ...(table ? { nightId: s.nightId, seats: s.seats, planning: undefined } : {
      preparationMeta: { version: 1, source: 'full', budgetExplicit: true },
      ...(s.dateMode === 'exact' ? { date: s.date, time: s.time } : {}),
      flexible: s.dateMode !== 'exact', guests: s.headcountMode === 'exact' ? s.guests : undefined,
      where: s.where, place: s.where === 'his' ? undefined : s.place.trim(), occasion: s.occasion.trim(),
      planning: {
        dateMode: s.dateMode, ...(s.dateMode === 'flexible' ? { dateFrom: s.dateFrom || undefined, dateTo: s.dateTo || undefined } : {}),
        partyBandId: s.partyBandId, headcount: s.headcountMode === 'exact' ? s.guests ?? null : null,
        kitchen: s.kitchen.trim(), budgetMode: s.budgetMode,
        budgetMin: s.budgetMode === 'range' ? Number(s.budgetMin) : null,
        budgetMax: s.budgetMode === 'range' ? Number(s.budgetMax) : null,
        budgetUnit: s.budgetUnit, foodIdeas: s.foodIdeas.trim(), allergies: s.sensitiveConsent ? s.allergies.trim() : '', physicalInvitations: s.physicalInvitations,
      },
    }),
    // Table guests' allergy reports remain requirements for Sergio to review, not promises of accommodation.

  }
}
export type SavedDraft = { version: 2; savedAt: string; step: number; s: PlanningState }
export function validDraft(value: any): value is SavedDraft {
  if (!value || value.version !== 2 || !value.s || typeof value.s !== 'object' || !Number.isInteger(value.step) || value.step < 0 || value.step > 3) return false
  const age = Date.now() - Date.parse(value.savedAt)
  if (!Number.isFinite(age) || age < -300000 || age > 7 * 864e5) return false
  const s = value.s
  if (s.kind !== undefined && !['dinner', 'class', 'event', 'table'].includes(s.kind)) return false
  for (const [key, values] of Object.entries({ dateMode: ['exact', 'flexible', 'undecided'], headcountMode: ['exact', 'approximate'], where: ['home', 'rental', 'his'], budgetMode: ['range', 'guidance'], budgetUnit: ['total', 'per_person'], contactBy: ['call', 'text', 'email'] })) if (!values.includes(s[key])) return false
  for (const [key, max] of Object.entries({ occasion: 1000, dateFrom: 10, dateTo: 10, partyBandId: 100, place: 300, kitchen: 2000, budgetMin: 20, budgetMax: 20, foodIdeas: 2000, allergies: 2000, notes: 4000, name: 150, email: 254, phone: 40, gift: 100 })) if (typeof s[key] !== 'string' || s[key].length > max) return false
  if (!Array.isArray(s.dietary) || s.dietary.length > 20 || s.dietary.some((value: unknown) => typeof value !== 'string' || value.length > 150)) return false
  if (typeof s.physicalInvitations !== 'boolean' || !Number.isInteger(s.seats) || s.seats < 1 || s.seats > booking.table.maxSeatsPerBooking) return false
  if (s.guests !== undefined && (!Number.isInteger(s.guests) || s.guests < 1 || s.guests > 1000)) return false
  if (s.date !== undefined && (typeof s.date !== 'string' || !validDate(s.date))) return false
  if (s.time !== undefined && (typeof s.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time))) return false
  return s.nightId === undefined || typeof s.nightId === 'string' && s.nightId.length <= 100
}

/** Carry a valid request from the previous form into the richer brief without guessing missing answers. */
export function migrateLegacyDraft(value: any): SavedDraft | null {
  if (!value || value.version !== undefined || !value.s || typeof value.s !== 'object') return null
  const old = value.s
  for (const key of ['notes', 'name', 'email', 'phone', 'gift']) if (typeof old[key] !== 'string') return null
  if (!Array.isArray(old.dishes) || old.dishes.length > 20 || old.dishes.some((item: unknown) => typeof item !== 'string' || item.length > 150)) return null
  const converted: SavedDraft = {
    version: 2, savedAt: value.savedAt, step: value.step,
    s: {
      ...EMPTY, kind: old.kind, date: old.date, time: old.time,
      dateMode: old.flexible ? 'flexible' : old.date ? 'exact' : 'undecided', dateFrom: old.flexible ? old.date ?? '' : '',
      guests: old.guests, headcountMode: old.guests === undefined ? 'approximate' : 'exact',
      where: old.where, place: old.place ?? '', occasion: old.occasion ?? '',
      foodIdeas: old.dishes.join(', '), dietary: old.dietary, notes: old.notes,
      name: old.name, email: old.email, phone: old.phone, contactBy: old.contactBy,
      nightId: old.nightId, seats: old.seats, gift: old.gift,
    },
  }
  return validDraft(converted) ? converted : null
}

/** Device drafts contain resumable logistics, never sensitive/free-form answers or a gift capability. */
export function privateDraftState(state: PlanningState): PlanningState {
  return { ...EMPTY, ...(state.kind ? { kind: state.kind } : {}), dateMode: state.dateMode, date: state.date, time: state.time, dateFrom: state.dateFrom, dateTo: state.dateTo, partyBandId: state.partyBandId, headcountMode: state.headcountMode, guests: state.guests, where: state.where, budgetMode: state.budgetMode, budgetMin: state.budgetMin, budgetMax: state.budgetMax, budgetUnit: state.budgetUnit, nightId: state.nightId, seats: state.seats, name: state.name, email: state.email, phone: state.phone, contactBy: state.contactBy, physicalInvitations: state.physicalInvitations, dietary: [] }
}
