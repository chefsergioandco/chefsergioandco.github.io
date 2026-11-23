import type { InvitationDocument } from '../../prototypes/sergio-admin/shared/invitations/types'

/** Design review only. Never a booking, delivery record or counted invitation. */
export const SAMPLE_INVITATION: InvitationDocument = {
  version: 1,
  calendarUid: 'design-preview-invitation@chefsergioandco.com',
  title: 'An evening at Alex’s table',
  hostName: 'Alex',
  recipientName: 'Jordan',
  recipientRole: 'guest',
  experience: 'dinner',
  date: '2026-12-12',
  startTime: '18:30',
  endAt: '2026-12-13T02:30:00.000Z',
  timeZone: 'America/New_York',
  venueName: 'Alex’s home in Winter Park',
  address: ['The confirmed street address will appear here.', 'Winter Park, Florida'],
  venueCoordinates: { latitude: 28.5977, longitude: -81.3515 },
  menu: [],
  menuConfirmed: false,
  guestCount: 8,
}
