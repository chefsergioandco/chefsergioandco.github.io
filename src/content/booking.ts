import { accountConfig } from '../account/config'

/**
 * Sergio's booking settings (docs/BOOKING.md §7). Every `null` is a decision he hasn't made yet:
 * the prototype's mock API (src/booking/mock.ts) uses clearly-labelled sample rules meanwhile,
 * and GO-LIVE.md lists each value that must be filled before launch.
 */

/** A cooking window: which weekdays (0 = Sunday) and which start times are offered. */
export type CookingWindow = { days: number[]; starts: string[] }

type FormatRules = {
  windows: CookingWindow[] | null // e.g. [{ days: [4, 5, 6, 0], starts: ['17:00', '18:00', '19:00'] }]
  perDay: number | null // events per day (1 = the day closes once booked)
  leadDays: number | null // minimum notice, in days
  durationHours: number | null // blocks his calendar for this long (+ buffer)
  bufferHours: number | null
}

export const booking = {
  /** The Cloudflare Worker's URL once it's deployed (GO-LIVE.md step 6). null = the in-browser mock. */
  apiBase: accountConfig.apiOrigin as string | null,

  formats: {
    dinner: { windows: null, perDay: null, leadDays: null, durationHours: null, bufferHours: null, deposit: null as number | null } satisfies FormatRules & { deposit: number | null },
    class: { windows: null, perDay: null, leadDays: null, durationHours: null, bufferHours: null, deposit: null as number | null } satisfies FormatRules & { deposit: number | null },
    event: { windows: null, perDay: null, leadDays: null, durationHours: null, bufferHours: null, softHoldDays: null as number | null } satisfies FormatRules & { softHoldDays: number | null },
  },

  table: {
    /** Largest booking through the seat flow; bigger groups are sent to "book the whole table" (a private dinner at his home). */
    maxSeatsPerBooking: 6,
    /** Title Sergio gives a night in his Google Calendar so the backend publishes it. Seats, minimum, price and cutoff go in its description. */
    calendarTitle: "Sergio's table",
  },

  /** After a date is held: does Sergio call the guest, or does the guest pick a call time? */
  menuCall: null as null | 'sergio-calls' | 'guest-picks',
}
