import { invitationCalendarTimes } from '../../prototypes/sergio-admin/shared/invitations/links'
import type { InvitationDocument, PublicInvitation } from '../../prototypes/sergio-admin/shared/invitations/types'

/** The current token-protected event-invitation endpoint. No recipient identity is implied. */
export type EventInvitationDto = {
  id: string
  version: number
  title: string
  hostName: string
  date: string
  time: string
  timeZone: string
  venueName: string
  address: string[]
  menuReady: boolean
  menu?: string
  menuVersion?: string
  guestCount: number
  experience?: InvitationDocument['experience']
}

const experiences: InvitationDocument['experience'][] = ['dinner', 'class', 'event', 'table']
const nonblankMenuLines = (menu: string) => menu.split(/\r\n|\r|\n/).filter(line => line.trim().length > 0)

/** Map the live DTO to the existing artwork contract without inventing duration or personalization. */
export function eventInvitationDocument(dto: EventInvitationDto): InvitationDocument {
  if (!dto || typeof dto !== 'object' || typeof dto.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(dto.id) || !Number.isSafeInteger(dto.version) || dto.version < 1) throw new Error('The invitation reference is incomplete.')
  for (const key of ['title', 'hostName', 'date', 'time', 'venueName'] as const) if (typeof dto[key] !== 'string') throw new Error('The invitation details are incomplete.')
  if (dto.timeZone !== 'America/New_York' || !Array.isArray(dto.address) || dto.address.some(line => typeof line !== 'string') || !Number.isSafeInteger(dto.guestCount) || dto.guestCount < 1) throw new Error('The invitation details are incomplete.')
  const menu = dto.menuReady === true && typeof dto.menu === 'string' ? nonblankMenuLines(dto.menu) : []
  return {
    version: dto.version,
    calendarUid: `event-${dto.id}@chefsergioandco.github.io`,
    title: dto.title,
    hostName: dto.hostName,
    recipientName: '',
    recipientRole: 'guest',
    experience: dto.experience && experiences.includes(dto.experience) ? dto.experience : 'event',
    date: dto.date,
    startTime: dto.time,
    endAt: '',
    timeZone: 'America/New_York',
    venueName: dto.venueName,
    address: [...dto.address],
    menu,
    menuConfirmed: dto.menuReady === true && menu.length > 0,
    guestCount: dto.guestCount,
  }
}

/** Same 24-hour lifetime as the live server, measured from the actual Eastern event start. */
export function eventInvitationExpiry(document: InvitationDocument): string {
  // The calendar helper requires an end for validation. This sentinel never enters the document,
  // artwork, a calendar export, or the returned invitation; no event duration is inferred.
  const { start } = invitationCalendarTimes({ ...document, endAt: '9999-12-31T23:59:59.999Z' })
  return new Date(start.getTime() + 86_400_000).toISOString()
}

/** A document edit alone must never make an unchanged menu look newly delivered. */
export async function invitationMenuVersion(document: InvitationDocument, supplied?: string | null): Promise<string | null> {
  if (!document.menuConfirmed || !document.menu.some(line => line.trim())) return null
  if (typeof supplied === 'string' && supplied.trim()) return supplied
  const bytes = new TextEncoder().encode(JSON.stringify(document.menu))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

/** Envelope for the current service. Its transport does not provide view tracking. */
export function eventPublicInvitation(dto: EventInvitationDto): PublicInvitation {
  const document = eventInvitationDocument(dto)
  return { document, revision: dto.version, expiresAt: eventInvitationExpiry(document), viewTracking: 'none', channel: 'shared' }
}
