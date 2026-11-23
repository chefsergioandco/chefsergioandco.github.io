/** The seasonal letter has its own consent and provider-broadcast ledger. */
import type { NewsletterRichBody } from './newsletter-document'
export type { NewsletterRichBody, NewsletterDocumentNode } from './newsletter-document'
export type NewsletterSettings = { senderName: string; replyTo: string; postalAddress: string }
export type NewsletterDraft = { subject: string; previewText: string; body: string; richBody?:NewsletterRichBody|null }
export type NewsletterAsset = {id:string;url:string;label:string;alt?:string;width?:number;height?:number}
export type NewsletterSubscriberStatus = 'pending' | 'confirmed' | 'unsubscribed'
export type NewsletterSubscriber = { id: string; email: string; name: string; status: NewsletterSubscriberStatus; requestedAt: string; confirmedAt: string | null; unsubscribedAt: string | null; synced: boolean; syncError?:string }
export type NewsletterCampaignStatus = 'preparing' | 'sending' | 'sent' | 'test_sent' | 'needs_review' | 'failed'
export type NewsletterCampaign = { id: string; subject: string; status: NewsletterCampaignStatus; createdAt: string; updatedAt: string; audienceCount: number; providerBroadcastId: string | null; lastError: string }
export type NewsletterReadiness = { mode: 'preview' | 'test' | 'live' | 'staging'; canSubscribe: boolean; canTest: boolean; canSend: boolean; missing: string[] }
export type NewsletterPreview = { subject: string; html: string; text: string }
export type NewsletterResponse = {
  revision: number; settings: NewsletterSettings; draft: NewsletterDraft; readiness: NewsletterReadiness;
  subscribers: { pending: number; confirmed: number; unsubscribed: number; eligible: number; items: NewsletterSubscriber[] };
  history: NewsletterCampaign[]; preview: NewsletterPreview; assets?:NewsletterAsset[];
}
export type NewsletterWrite = { expectedRevision: number; requestId: string }
export type NewsletterSettingsWrite = NewsletterWrite & { settings: NewsletterSettings }
export type NewsletterDraftWrite = NewsletterWrite & { draft: NewsletterDraft }
export type NewsletterSendWrite = NewsletterWrite & { expectedAudienceCount: number }
export type NewsletterActionResponse = NewsletterResponse & { action?: { id: string; status: NewsletterCampaignStatus; message: string }; replayed?: boolean }
export type NewsletterPublicStatus = { available: boolean; consentVersion: string; consentText: string; message: string; operatorOnly?:boolean }
export type NewsletterSubscribeWrite = { email: string; name?: string; consent: true; consentVersion: string; requestId: string; honeypot?: string }
export type NewsletterTokenResponse = { status:'ready'|'confirmed'|'unsubscribed'|'expired'|'invalid'; title:string; message:string; canAct:boolean; actionLabel:string }
