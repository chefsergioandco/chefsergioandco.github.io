/** Shared customer-communication contracts. Private links are resolved only while rendering. */
export type EmailKind = 'request_received' | 'waitlist_received' | 'plan_ready' | 'interview_scheduled' | 'booking_held' | 'booking_confirmed' | 'booking_changed' | 'booking_cancelled' | 'payment_received' | 'refund_received' | 'invitation_ready' | 'pre_event' | 'thank_you'
export type EmailMode = 'preview' | 'test' | 'live'
export type EmailStatus = 'preview' | 'queued' | 'sending' | 'sent' | 'delivered' | 'retry' | 'failed' | 'bounced' | 'complained' | 'needs_review' | 'suppressed' | 'cancelled' | 'needs_contact'
export type ReceiptSnapshot = {
  version: 1; id: string; number: string; bookingId: string; billingId: string; eventId: string;
  type: 'payment' | 'refund'; customer: string; service: string; eventDate: string; issuedAt: string;
  currency: 'USD'; amountMinor: number; totalMinor: number | null; balanceMinor: number | null;
  method: string; reference: string; invoiceNumber: string;
}
export type EmailSnapshot = {
  version: 1; kind: EmailKind; bookingId: string; recipientName: string; recipientEmail: string;
  service: string; date: string; time: string; guests: number | null; status: string; createdAt: string;
  contactBy?: string; location?: string; note?: string; changes?: string[]; details?: { label: string; value: string }[];
  invitationId?: string; invitationVersion?: number; receipt?: ReceiptSnapshot;
  /** Resolved in memory only; never persist bearer URLs in the outbox snapshot. */
  action?: { label: string; url: string }; calendar?: string;
}
export type EmailIntent = { id: string; eventKey: string; bookingId: string; kind: EmailKind; snapshot: EmailSnapshot; createdAt: string; notBefore?: string; receiptId?: string; parentId?: string; previewOnly?: boolean }
export type EmailStoredMessage = {
  id: string; event_key: string; booking_id: string; kind: EmailKind; status: EmailStatus; delivery_mode: EmailMode;
  recipient_email: string; recipient_name: string; payload_json: string; template_version: string; provider_id: string | null;
  created_at: string; updated_at: string; attempts: number; next_attempt_at: string | null; first_attempt_at: string | null;
  last_attempt_at: string | null; sent_at: string | null; delivered_at: string | null; last_error: string;
  lease_token: string | null; lease_until: string | null; receipt_id: string | null; parent_id: string | null;
  render_hash: string | null;
}
export type EmailMessageSummary = {
  id: string; bookingId: string; kind: EmailKind; status: EmailStatus; recipientEmail: string; recipientName: string;
  subject: string; createdAt: string; updatedAt: string; attempts: number; sentAt: string | null; deliveredAt: string | null;
  lastError: string; receiptId: string | null; parentId: string | null;
}
export type EmailConfiguration = { mode: EmailMode; ready: boolean; canSend: boolean; canTest: boolean; from: string; replyTo: string; testRecipient: string; missing: string[] }
export type EmailAttachment = { filename: string; content: string; content_type?: string }
export type RenderedEmail = { subject: string; html: string; text: string; attachments?: EmailAttachment[] }
export type CommunicationsResponse = { configuration: EmailConfiguration; messages: EmailMessageSummary[]; bookings: { id: string; guest: string; email: string; status: string }[]; kinds: { kind: EmailKind; label: string }[] }
export type EmailPreview = { id: string; subject: string; html: string; text: string; receiptId: string | null; sample: boolean }
