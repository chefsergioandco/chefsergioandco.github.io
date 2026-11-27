import type { AdminState, Booking } from './model'

export const MINIMUM_NOTICE_DAYS = 7
export const START_INTERVAL_MINUTES = 30

/** Actual holiday dates only. No substitute Friday/Monday observance is added. */
export function calendarClosedReason(day: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const value = new Date(day + 'T12:00:00Z')
  if (!Number.isFinite(value.getTime()) || value.toISOString().slice(0, 10) !== day) return null
  const month = value.getUTCMonth() + 1, date = value.getUTCDate(), weekday = value.getUTCDay()
  if (month === 1 && date === 1) return 'New Year’s Day'
  if (month === 5 && weekday === 1 && date >= 25) return 'Memorial Day'
  if (month === 7 && date === 4) return 'Independence Day'
  if (month === 9 && weekday === 1 && date <= 7) return 'Labor Day'
  if (month === 11 && weekday === 4 && date >= 22 && date <= 28) return 'Thanksgiving Day'
  if (month === 12 && date === 25) return 'Christmas Day'
  return weekday === 0 ? 'Sunday' : null
}

/** Pending public inquiries reserve nothing; a scheduled event occupies its entire date. */
export function occupiesDate(booking: Booking): boolean {
  return !!booking.date && booking.status !== 'cancelled' && booking.type !== 'Sergio’s Table' && !booking.nightId && (booking.planning ? booking.planning.dateReserved || booking.status === 'held' : !(booking.source === 'public' && booking.status === 'requested'))
}

export function scheduleConflictReason(state: Pick<AdminState, 'bookings' | 'nights' | 'blocks'>, day: string, except: { bookingId?: string; nightId?: string } = {}): string | null {
  const booking = state.bookings.find(item => item.id !== except.bookingId && item.date === day && occupiesDate(item))
  if (booking?.type === 'Cooking class') return 'A cooking class is already scheduled on this date. Classes keep the entire day unavailable; choose another date.'
  if (booking) return 'An active booking is already scheduled on this date. Only one event can be scheduled per day; choose another date.'
  if (state.nights.some(item => item.id !== except.nightId && item.date === day && item.status === 'published')) return 'A Table evening is already scheduled on this date. Only one event can be scheduled per day; choose another date.'
  return state.blocks.some(item => item.date === day) ? 'This date is blocked. Reopen it on the calendar before scheduling.' : null
}
