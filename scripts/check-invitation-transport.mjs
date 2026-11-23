#!/usr/bin/env node
import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

if (!globalThis.crypto) globalThis.crypto = webcrypto
const root = fileURLToPath(new URL('../', import.meta.url))
async function actualModule(entry) {
  const output = await build({ absWorkingDir: root, entryPoints: [entry], bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022' })
  return import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64'))
}
const transport = await actualModule('src/invitations/event-transport.ts')
const calendar = await actualModule('prototypes/sergio-admin/shared/invitations/links.ts')
const artwork = await actualModule('prototypes/sergio-admin/shared/invitations/artwork.ts')
const source = {
  id: 'opaque-event-123', version: 4, title: 'A graduation — together', hostName: 'The Rivera family',
  date: '2026-12-12', time: '18:00', timeZone: 'America/New_York', venueName: 'The family home',
  address: [' 120 Example Lane ', 'Winter Park, FL'], guestCount: 8,
  menuReady: true, menu: '  Cordon bleu, as discussed  \r\n\r\nSeasonal vegetables\n   \nCrème brûlée',
}
let count = 0
function check(name, run) { run(); count++; process.stdout.write(`PASS ${name}\n`) }
const doc = transport.eventInvitationDocument(source)
check('event and menu wording are retained exactly; only blank menu lines disappear', () => {
  assert.equal(doc.title, source.title)
  assert.equal(doc.hostName, source.hostName)
  assert.equal(doc.venueName, source.venueName)
  assert.deepEqual(doc.address, source.address)
  assert.deepEqual(doc.menu, ['  Cordon bleu, as discussed  ', 'Seasonal vegetables', 'Crème brûlée'])
  assert.equal(doc.menuConfirmed, true)
  assert.notEqual(doc.address, source.address)
})
check('missing personalization uses the canonical anonymous salutation', () => {
  assert.equal(doc.recipientName, '')
  assert.equal(artwork.invitationCopy(doc).salutation, 'Welcome,')
  assert.equal(doc.experience, 'event')
  assert.equal(transport.eventInvitationDocument({...source,experience:'class'}).experience, 'class')
  assert.equal(transport.eventInvitationDocument({...source,experience:'unknown'}).experience, 'event')
})
check('a supplied draft menu never reaches the artwork as confirmed content', () => {
  const draft = transport.eventInvitationDocument({...source,menuReady:false})
  assert.deepEqual(draft.menu, [])
  assert.equal(draft.menuConfirmed, false)
  for (const menu of ['', ' \n\r\n ', undefined]) {
    const empty = transport.eventInvitationDocument({...source,menu})
    assert.deepEqual(empty.menu, [])
    assert.equal(empty.menuConfirmed, false)
  }
})
check('no end time or invented event duration is exposed for calendar use', () => {
  assert.equal(doc.endAt, '')
  assert.throws(() => calendar.invitationCalendarFile(doc), /end time is incomplete/)
  assert.throws(() => calendar.invitationCalendarLinks(doc), /end time is incomplete/)
  transport.eventInvitationExpiry(doc)
  assert.equal(doc.endAt, '')
})
check('expiry follows the actual Eastern start in winter, summer and across a DST change', () => {
  assert.equal(transport.eventInvitationExpiry(doc),'2026-12-13T23:00:00.000Z')
  assert.equal(transport.eventInvitationExpiry({...doc,date:'2027-07-20'}),'2027-07-21T22:00:00.000Z')
  assert.equal(transport.eventInvitationExpiry({...doc,date:'2027-03-13'}),'2027-03-14T23:00:00.000Z')
  assert.throws(() => transport.eventInvitationExpiry({...doc,date:'2027-03-14',startTime:'02:30'}), /not valid/)
  assert.throws(() => transport.eventInvitationExpiry({...doc,date:'2027-02-30'}), /invalid/)
})
check('the normalized envelope retains revision and lifetime without inventing view tracking', () => {
  const result = transport.eventPublicInvitation(source)
  assert.equal(result.revision,source.version)
  assert.equal(result.document.version,source.version)
  assert.equal(result.expiresAt,'2026-12-13T23:00:00.000Z')
  assert.equal(result.viewTracking,'none')
  assert.equal(result.channel,'shared')
})
check('calendar identity remains opaque and stable across unrelated event edits', () => {
  assert.equal(doc.calendarUid,transport.eventInvitationDocument({...source,title:'Updated title',date:'2026-12-19',hostName:'Another host label'}).calendarUid)
  assert(!doc.calendarUid.includes('Rivera'))
  assert.throws(() => transport.eventInvitationDocument({...source,id:'host@example.test'}), /reference/)
})
const marker = await transport.invitationMenuVersion(doc)
const edited = await transport.invitationMenuVersion({...doc,version:40,title:'An updated invitation',address:['Another confirmed venue']})
const changed = await transport.invitationMenuVersion({...doc,menu:[...doc.menu,'A new course']})
check('fallback newness depends on exact ready menu content, never the document revision', () => {
  assert.match(marker,/^[0-9a-f]{64}$/)
  assert.equal(marker,edited)
  assert.notEqual(marker,changed)
})
assert.equal(await transport.invitationMenuVersion(doc,'server-menu-v7'),'server-menu-v7')
assert.equal(await transport.invitationMenuVersion({...doc,version:100},'server-menu-v7'),'server-menu-v7')
assert.equal(await transport.invitationMenuVersion({...doc,menuConfirmed:false},'server-menu-v7'),null)
assert.equal(await transport.invitationMenuVersion({...doc,menu:[]},'server-menu-v7'),null)
count++;process.stdout.write('PASS server menu markers take precedence only for ready nonempty content\n')
process.stdout.write(`\n${count} invitation transport checks passed.\n`)
