/** Shared artwork data. The same version supplies the web card and physical set. */
export type InvitationDocument = {
  version: number
  /** Stable event identity across reschedules and personalized copies. Server owned. */
  calendarUid?: string
  title: string
  hostName: string
  recipientName: string
  recipientRole: 'customer' | 'guest'
  experience: 'dinner' | 'class' | 'event' | 'table'
  date: string
  startTime: string
  endAt: string
  timeZone: 'America/New_York'
  venueName: string
  address: string[]
  /** Team-confirmed pin. Never obtained by automatically geocoding a private address. */
  venueCoordinates?: { latitude: number; longitude: number }
  personalNote?: string
  menu: string[]
  menuConfirmed: boolean
  guestCount: number
}

export type InvitationRecipient = {
  id: string
  name: string
  email: string
  role: 'customer' | 'guest'
  delivery: 'not_sent' | 'queued' | 'sent' | 'delivered' | 'bounced'
  sentAt: string | null
  deliveredAt: string | null
  bouncedAt: string | null
  createdAt: string
}
export type InvitationMailingAddress = {
  name: string
  line1: string
  line2: string
  city: string
  region: string
  postalCode: string
  country: string
}
export type InvitationPrintBatch = {
  id: string
  version: number
  document: InvitationDocument
  recipients: Pick<InvitationRecipient, 'id' | 'name' | 'role'>[]
  quantity: number
  mailingAddress: InvitationMailingAddress
  printedAt: string
  mailedAt: string | null
}
export type PhysicalInvitationSet = {
  requested: boolean
  quantity: number
  mailingAddress: InvitationMailingAddress | null
  status: 'not_requested' | 'requested' | 'preparing' | 'printed' | 'mailed'
  requestedAt: string | null
  preparingAt: string | null
  printedAt: string | null
  mailedAt: string | null
  printedVersion: number | null
  batches: InvitationPrintBatch[]
}
export type InvitationViewChannel = 'digital' | 'shared' | 'print_qr'
/** Anonymous page opens, including repeat opens. Never a reader identity or unique people count. */
export type InvitationViewTotal = { channel: InvitationViewChannel; opens: number; firstOpenedAt: string | null; lastOpenedAt: string | null }
export type InvitationActivity = { id: string; kind: string; at: string; actor: string; description: string }
export type InvitationRecord = {
  id: string
  bookingId: string
  revision: number
  status: 'draft' | 'ready'
  document: InvitationDocument
  confirmedAt: string | null
  createdAt: string
  updatedAt: string
  recipients: InvitationRecipient[]
  physical: PhysicalInvitationSet
  activity: InvitationActivity[]
  views: InvitationViewTotal[]
  /** Latest booking changes require team reconfirmation before a new physical set. */
  detailsChanged: boolean
  /** Derived current-menu readiness; independent of an older printed invitation batch. */
  menuPrintReady: boolean
  expired: boolean
}
export type InvitationCapabilities = {
  emailSending: boolean
  publicLinks: boolean
  viewTracking: boolean
  printGeneration: boolean
  publicOrigin: string | null
}
export type InvitationsEnvelope = { invitations: InvitationRecord[]; capabilities: InvitationCapabilities; updatedAt: string }
export type InvitationMutationResult = InvitationsEnvelope & { invitation?: InvitationRecord; link?: { url: string; token: string; channel: InvitationViewChannel; expiresAt: string }; replayed?: boolean }
export type PublicInvitation = { document: InvitationDocument; revision: number; expiresAt: string; viewTracking: 'anonymous_totals' | 'none'; channel: InvitationViewChannel }

export type InvitationAction = 'save' | 'confirm' | 'add-recipient' | 'remove-recipient' | 'request-print' | 'mark-preparing' | 'mark-printed' | 'mark-mailed' | 'create-link'
