import type { InvitationDocument } from './types'

export type VenueCoordinates = { latitude: number; longitude: number }
export function validCoordinates(value: unknown): value is VenueCoordinates {
  if (!value || typeof value !== 'object') return false
  const point = value as VenueCoordinates
  return Number.isFinite(point.latitude) && point.latitude >= -90 && point.latitude <= 90 && Number.isFinite(point.longitude) && point.longitude >= -180 && point.longitude <= 180
}

/** No geocoding. Coordinates must come from Sergio’s confirmed location. */
export function invitationDestination(document: InvitationDocument) {
  const address = document.address.map(line => line.trim()).filter(Boolean).join(', ')
  const coordinates = validCoordinates(document.venueCoordinates) ? document.venueCoordinates : null
  return { address, coordinates, destination: coordinates ? `${coordinates.latitude},${coordinates.longitude}` : address }
}

export function invitationDirections(document: InvitationDocument) {
  const { address, coordinates, destination } = invitationDestination(document)
  if (!destination) return null
  const apple = new URL('https://maps.apple.com/directions')
  apple.searchParams.set('destination', destination); apple.searchParams.set('mode', 'driving')
  const google = new URL('https://www.google.com/maps/dir/')
  google.searchParams.set('api', '1'); google.searchParams.set('destination', destination); google.searchParams.set('travelmode', 'driving')
  const waze = new URL('https://waze.com/ul')
  if (coordinates) { waze.searchParams.set('ll', `${coordinates.latitude},${coordinates.longitude}`); waze.searchParams.set('navigate', 'yes') }
  else waze.searchParams.set('q', address)
  return { apple: apple.href, google: google.href, waze: waze.href }
}

export function invitationMap(document: InvitationDocument) {
  const { coordinates } = invitationDestination(document)
  // OpenStreetMap’s Mercator display cannot show the poles. Directions still work.
  if (!coordinates || Math.abs(coordinates.latitude) > 85) return null
  const { latitude, longitude } = coordinates
  const west = Math.max(-180, longitude - .007), east = Math.min(180, longitude + .007)
  const south = Math.max(-85.05, latitude - .0045), north = Math.min(85.05, latitude + .0045)
  const embed = new URL('https://www.openstreetmap.org/export/embed.html')
  embed.searchParams.set('bbox', `${west},${south},${east},${north}`); embed.searchParams.set('layer', 'mapnik'); embed.searchParams.set('marker', `${latitude},${longitude}`)
  const full = new URL('https://www.openstreetmap.org/')
  full.searchParams.set('mlat', String(latitude)); full.searchParams.set('mlon', String(longitude)); full.hash = `map=16/${latitude}/${longitude}`
  return { embed: embed.href, full: full.href }
}

function localParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(instant)
  return Object.fromEntries(parts.map(part => [part.type, part.value]))
}

export function invitationCalendarTimes(document: InvitationDocument) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(document.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(document.startTime)) throw new Error('The invitation date or time is incomplete.')
  const [year, month, day] = document.date.split('-').map(Number), [hours, minutes] = document.startTime.split(':').map(Number)
  const target = Date.UTC(year, month - 1, day, hours, minutes)
  const validDate = new Date(target)
  if (validDate.toISOString().slice(0, 10) !== document.date) throw new Error('The invitation date is invalid.')
  let start = target
  for (let i = 0; i < 3; i++) { const p = localParts(new Date(start), document.timeZone); start += target - Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) }
  const p = localParts(new Date(start), document.timeZone)
  if (`${p.year}-${p.month}-${p.day}` !== document.date || `${p.hour}:${p.minute}` !== document.startTime) throw new Error('The invitation time is not valid in its time zone.')
  const end = new Date(document.endAt).getTime()
  if (!Number.isFinite(end) || end <= start) throw new Error('The invitation end time is incomplete.')
  return { start: new Date(start), end: new Date(end) }
}
const stamp = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const calendarLocation = (document: InvitationDocument) => [document.venueName, ...document.address].filter(Boolean).join(', ')
const calendarDescription = 'A private experience with Chef Sergio & Co. Refer to your invitation for the latest confirmed details.'
const escapeCalendar = (value: string) => value.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;')
function foldLine(line: string) {
  const result: string[] = [], encoder = new TextEncoder()
  let part = ''
  for (const character of line) { if (encoder.encode(part + character).length > 75) { result.push(part); part = ' ' } part += character }
  return [...result, part]
}
function previewUid(document: InvitationDocument) {
  let hash = 2166136261
  for (const character of `${document.hostName}|${document.experience}|preview`) { hash ^= character.codePointAt(0)!; hash = Math.imul(hash, 16777619) }
  return `preview-${(hash >>> 0).toString(16)}@chefsergioandco.github.io`
}

export function invitationCalendarFile(document: InvitationDocument, options: { revision?: number; preview?: boolean; now?: Date } = {}) {
  const { start, end } = invitationCalendarTimes(document)
  const uid = document.calendarUid || (options.preview ? previewUid(document) : '')
  if (!uid || !/^[A-Za-z0-9._@+-]{1,250}$/.test(uid)) throw new Error('The invitation calendar reference is not ready.')
  const sequence = Number.isSafeInteger(options.revision) && options.revision! >= 0 ? options.revision! : Math.max(0, Math.floor(document.version))
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Chef Sergio and Co//Invitation//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT', `UID:${uid}`, `SEQUENCE:${sequence}`, `DTSTAMP:${stamp(options.now || new Date())}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`, `SUMMARY:${escapeCalendar(document.title)}`, `LOCATION:${escapeCalendar(calendarLocation(document))}`, `DESCRIPTION:${escapeCalendar(calendarDescription)}`, 'STATUS:CONFIRMED', 'TRANSP:OPAQUE']
  if (validCoordinates(document.venueCoordinates)) lines.push(`GEO:${document.venueCoordinates.latitude};${document.venueCoordinates.longitude}`)
  lines.push('END:VEVENT', 'END:VCALENDAR')
  return lines.flatMap(foldLine).join('\r\n') + '\r\n'
}

export function invitationCalendarLinks(document: InvitationDocument) {
  const { start, end } = invitationCalendarTimes(document)
  const google = new URL('https://calendar.google.com/calendar/render')
  google.searchParams.set('action', 'TEMPLATE'); google.searchParams.set('text', document.title); google.searchParams.set('dates', `${stamp(start)}/${stamp(end)}`); google.searchParams.set('ctz', document.timeZone); google.searchParams.set('location', calendarLocation(document)); google.searchParams.set('details', calendarDescription)
  const outlook = (origin: string) => { const url = new URL('/calendar/0/deeplink/compose', origin); url.searchParams.set('path', '/calendar/action/compose'); url.searchParams.set('rru', 'addevent'); url.searchParams.set('subject', document.title); url.searchParams.set('startdt', start.toISOString()); url.searchParams.set('enddt', end.toISOString()); url.searchParams.set('location', calendarLocation(document)); url.searchParams.set('body', calendarDescription); return url.href }
  return { google: google.href, outlook: outlook('https://outlook.live.com'), outlookWork: outlook('https://outlook.office.com') }
}
