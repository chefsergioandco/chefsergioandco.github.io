import type { FormatKey } from '../content/site'

/** What is being booked. `table` = seats at a published Sergio's table night. */
export type Kind = FormatKey | 'table'
export type Where = 'home' | 'rental' | 'his'

/** One bookable day and its start times (24h "HH:MM", Sergio's local time). Only open days are listed. */
export type OpenDay = { date: string; times: string[] }
export type Availability = { month: string; days: OpenDay[]; nextOpen: string | null; sample: boolean }

export type NightState = 'pending' | 'confirmed' | 'full' | 'cancelled'
export type Night = {
  id: string
  date: string // yyyy-mm-dd
  start: string // HH:MM
  title: string
  menu: string
  seats: number
  minimum: number
  taken: number
  pricePerSeat: number | null
  cutoff: string // decision date for Sergio's minimum-attendance review; no automatic cancellation is implied
  state: NightState
  sample: boolean
  /** A dinner at Sergio's table, or a cooking class with its own location. Older services send no kind: a table night. */
  kind?: 'table' | 'class'
  location?: string
}

export type BookingRequest = {
  kind: Kind
  date?: string
  time?: string
  flexible?: boolean
  nightId?: string
  seats?: number
  guests?: number
  where?: Where
  place?: string
  occasion?: string
  dishes?: string[]
  dietary?: string[]
  notes?: string
  name: string
  email: string
  phone: string
  contactBy: 'call' | 'text' | 'email'
  gift?: string
  planning?: PlanningRequest
}

export type BookingStatus = 'pending-payment' | 'held' | 'reserved' | 'confirmed' | 'requested' | 'waitlisted'
export type BookingRecord = BookingRequest & {
  ref: string
  status: BookingStatus
  /** what the guest pays (or is charged later for) */
  amount: number | null
  amountWhen: 'now' | 'when-confirmed' | 'after-quote'
  night?: Night
  createdAt: string
}

/** Where the browser goes next after submitting: Stripe Checkout (or the prototype stand-in), or straight to the status page. */
export type HoldResult = { ref: string; next: 'checkout' | 'done'; url: string }

export class BookingError extends Error {
  constructor(
    public code: 'unavailable' | 'seats-gone' | 'invalid' | 'network',
    message: string,
  ) {
    super(message)
  }
}

export interface BookingApi {
  availability(kind: Exclude<Kind, 'table'>, month: string): Promise<Availability>
  nights(): Promise<Night[]>
  hold(req: BookingRequest): Promise<HoldResult>
  booking(ref: string): Promise<BookingRecord | null>
  waitlist(nightId: string, email: string): Promise<void>
}

/** Safe public receipt. Contact details, addresses, dietary notes and private booking data are never returned. */
export type BookingReceipt = {
  ref: string
  status: 'requested' | 'confirmed' | 'cancelled' | 'held'
  kind: Kind
  date: string | null
  time: string | null
  guests: number | null
  nightId?: string
  nightTitle?: string
  nightKind?: 'table' | 'class'
  location?: string
  amount: null
  amountWhen: 'after-quote'
  createdAt: string
  planning?: PlanningReceipt
  nightMinimumState?: 'awaiting_minimum' | 'confirmed'
  decisionDate?: string
}
export type PublicHoldResult = HoldResult & { next: 'done'; accessToken: string; checkout?: { url: string; expiresAt?: string }; checkoutError?: { code: string; message: string } }
/** Options for a hold: open the deposit checkout in the same round trip, and report the guest's page-load-to-submit time. */
export type HoldOptions = { checkout?: boolean; elapsedMs?: number }
/** Menu-conversation answers a guest can add after the deposit. Sergio's agreed topics are never overwritten. */
export type GuestDetails = { occasion?: string; kitchen?: string; foodIdeas?: string; dietary?: string[]; allergies?: string; notes?: string; budgetMode?: 'range' | 'guidance'; budgetMin?: number; budgetMax?: number; budgetUnit?: 'total' | 'per_person'; physicalInvitations?: boolean }
export interface PublicBookingApi extends Omit<BookingApi, 'booking' | 'hold' | 'waitlist'> {
  config(): Promise<PlanningConfig>
  hold(req: BookingRequest, honeypot?: string, options?: HoldOptions): Promise<PublicHoldResult>
  booking(ref: string): Promise<BookingReceipt | null>
  details(ref: string, details: GuestDetails): Promise<BookingReceipt | null>
  cancel(ref: string, reason: string): Promise<BookingReceipt | null>
  scheduleInterview(ref: string, slotId: string): Promise<BookingReceipt | null>
  checkout(ref: string): Promise<{url: string; expiresAt?: string}>
  waitlist(nightId: string, email: string, honeypot?: string): Promise<void>
}

/** Server-owned settings. A missing amount is undecided, never a sample price. */
export type PartyBand = { id: string; label: string; min: number; max: number; deposit: number | null }
export type PlanningConfig = {
  partyBands: PartyBand[]
  planningFee: number | null
  checkoutMinutes: number | null
  postageAllowance: number | null
  kitchenRequirements: string
  travelMiles: number
  maxGuests: number
  interviewScheduling: 'undecided' | 'self_schedule' | 'sergio_arranges'
  paymentReady: boolean
  interviewSlots: { id: string; at: string; label?: string }[]
  policyVersion: number
}
export type PlanningRequest = {
  dateMode: 'exact' | 'flexible' | 'undecided'
  dateFrom?: string
  dateTo?: string
  partyBandId: string
  headcount: number | null
  kitchen: string
  budgetMode: 'range' | 'guidance'
  budgetMin: number | null
  budgetMax: number | null
  budgetUnit: 'total' | 'per_person'
  foodIdeas: string
  allergies: string
  physicalInvitations: boolean
}
export type PlanningReceipt = {
  dateMode: PlanningRequest['dateMode']
  partyBandLabel: string
  interviewStatus: string
  scheduledAt?: string | null
  interviewAt?: string | null
  meetUrl?: string | null
  dateReserved: boolean
  depositStatus: 'unpaid' | 'processing' | 'paid' | 'refund_pending' | 'refunded'
  depositAmount: number | null
  spendingCeiling: number | null
  menu: string
  followUpCount: number
}
