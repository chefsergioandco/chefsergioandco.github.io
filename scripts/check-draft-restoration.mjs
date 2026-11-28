#!/usr/bin/env node
// Exercise real draft validation/migration, the public seat limit, and privacy-safe resume data.
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../', import.meta.url))
let checks = 0
function check(name, run) { run(); checks++; console.log(`PASS ${name}`) }
async function loadPlanning(seatLimit) {
  const result = await build({
    absWorkingDir: root, entryPoints: ['src/booking/planning.ts'], bundle: true, write: false,
    format: 'esm', platform: 'browser', target: 'es2022', define: { 'import.meta.env': '{}' },
    plugins: seatLimit === undefined ? [] : [{ name: 'configured-seat-limit', setup(builder) {
      builder.onLoad({ filter: /content\/booking\.ts$/ }, () => ({
        contents: `export const booking = { table: { maxSeatsPerBooking: ${seatLimit} } }`, loader: 'ts',
      }))
    } }],
  })
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'))
}
const planning = await loadPlanning()
const draft = (seats = 2, state = {}, saved = {}) => ({
  version: 2, savedAt: new Date().toISOString(), step: 2,
  s: { ...planning.EMPTY, kind: 'table', nightId: 'night-draft-check', seats, ...state }, ...saved,
})
check('seven- and eight-seat drafts restore without lowering the requested party size', () => {
  for (const seats of [7, 8]) {
    const saved = draft(seats)
    assert.equal(planning.validDraft(saved), true)
    assert.equal(saved.s.seats, seats)
  }
})
check('invalid and over-limit seat counts cannot restore', () => {
  for (const seats of [0, -1, 9, 24, 1.5, NaN, Infinity, '8', null, undefined]) {
    assert.equal(planning.validDraft(draft(2, { seats })), false, `rejected seats: ${String(seats)}`)
  }
})
const smaller = await loadPlanning(4)
check('the validator follows the configured public maximum rather than an independent hardcoded limit', () => {
  assert.equal(smaller.validDraft(draft(4)), true)
  assert.equal(smaller.validDraft(draft(5)), false)
  assert.equal(smaller.validDraft(draft(8)), false)
})
check('seat restoration does not bypass draft shape, age, version, or field validation', () => {
  for (const saved of [null, [], {}, draft(8, {}, { version: 1 }), draft(8, {}, { step: 4 }),
    draft(8, {}, { savedAt: new Date(Date.now() - 8 * 864e5).toISOString() }),
    draft(8, {}, { savedAt: new Date(Date.now() + 600000).toISOString() }),
    draft(8, { kind: 'unknown' }), draft(8, { date: '2026-02-30' }),
    draft(8, { time: '25:00' }), draft(8, { dietary: 'not-an-array' }),
    draft(8, { allergies: 'x'.repeat(2001) }), draft(8, { physicalInvitations: 'yes' })]) {
    assert.equal(planning.validDraft(saved), false)
  }
})
check('legacy seven- and eight-seat requests migrate and larger parties are rejected', () => {
  for (const seats of [7, 8, 9]) {
    const old = { savedAt: new Date().toISOString(), step: 2, s: {
      kind: 'table', where: 'home', nightId: 'night-draft-check', seats, dishes: [], dietary: [],
      notes: '', name: 'Example guest', email: 'guest@example.test', phone: '', contactBy: 'email', gift: '',
    } }
    const restored = planning.migrateLegacyDraft(old)
    assert.equal(restored?.s.seats ?? null, seats <= 8 ? seats : null)
  }
})
check('restored seat drafts keep private answers and gift proof out of device persistence', () => {
  const state = { ...draft(8).s, occasion: 'PRIVATE occasion', kitchen: 'PRIVATE kitchen',
    foodIdeas: 'PRIVATE food', place: 'PRIVATE address', notes: 'PRIVATE note',
    dietary: ['PRIVATE requirement'], allergies: 'PRIVATE allergy', sensitiveConsent: true, gift: 'PRIVATE code' }
  const safe = planning.privateDraftState(state)
  assert.equal(planning.validDraft(draft(8, safe)), true)
  assert.equal(safe.seats, 8)
  assert.equal(safe.sensitiveConsent, false)
  assert.deepEqual(safe.dietary, [])
  assert.equal(JSON.stringify(safe).includes('PRIVATE'), false)
  assert.equal(state.sensitiveConsent, true)
  assert.equal(state.gift, 'PRIVATE code')
})
const bundledDrafts = await build({ absWorkingDir: root, entryPoints: ['src/booking/drafts.ts'], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', define: { 'import.meta.env': '{}', __SITE_MODE__: '"prototype"', __LOOK__: '"c"', __PLATING_SEQUENCE_AVAILABLE__: 'false' } })
const current = await import('data:text/javascript;base64,' + Buffer.from(bundledDrafts.outputFiles[0].text).toString('base64'))
const memory = new Map(), originalStorage = globalThis.localStorage
const storage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, String(value)), removeItem: key => memory.delete(key) }
globalThis.localStorage = storage
try {
  check('version3 explicitly allows incomplete quick party selection without inventing its format', () => { const saved = current.makeBookingDraft('quick', { ...planning.EMPTY, partyBandId: 'mixed' }, 0); assert(current.isBookingDraft(saved)); assert.equal(saved.data.kind, undefined); assert.equal(current.writeBookingDraft(saved), true) })
  check('version3 uses a fresh opaque snapshot id and strips unknown or excluded input', () => { const state = { ...planning.EMPTY, kind: 'dinner', name: 'Alex', unknownPrivate: 'PRIVATE EXTRA', kitchen: 'PRIVATE kitchen', gift: 'PRIVATE code', dietary: ['PRIVATE requirement'] }; const one = current.makeBookingDraft('details', state, 1), two = current.makeBookingDraft('details', state, 1); assert.notEqual(one.id, two.id); assert(!JSON.stringify(one).includes('PRIVATE')); assert.equal(current.isBookingDraft({ ...one, data: { ...one.data, extraHealth: 'PRIVATE' } }), false); assert(!JSON.stringify(planning.privateDraftState(state)).includes('PRIVATE')) })
  check('seven-day and future draft age checks also protect version3', () => { const saved = current.makeBookingDraft('quick', { ...planning.EMPTY, kind: 'dinner', name: 'Alex' }, 0); assert(!current.isBookingDraft({ ...saved, savedAt: new Date(Date.now() - 8 * 864e5).toISOString() })); assert(!current.isBookingDraft({ ...saved, savedAt: new Date(Date.now() + 600000).toISOString() })) })
  check('valid version2 migration removes obsolete private copies and preserves unrelated financial attempts', () => { memory.clear(); storage.setItem('booking-draft:v2', JSON.stringify(draft(8, { allergies: 'PRIVATE HEALTH', gift: 'PRIVATE GIFT', extraHealth: 'PRIVATE EXTRA' }))); storage.setItem('booking-pending:v1:keep:checkout:unrelated', 'original-financial-id'); const result = current.readBookingDraft(); assert.equal(result.kind, 'draft'); assert.equal(result.draft.data.seats, 8); assert(!JSON.stringify([...memory]).includes('PRIVATE')); assert.equal(storage.getItem('booking-draft:v2'), null); assert.equal(storage.getItem('booking-pending:v1:keep:checkout:unrelated'), 'original-financial-id') })
  check('malformed and expired obsolete draft JSON is removed from only its exact known keys', () => { for (const value of ['{PRIVATE invalid JSON', JSON.stringify(draft(8, {}, { savedAt: new Date(Date.now() - 8 * 864e5).toISOString() }))]) { memory.clear(); storage.setItem('booking-draft:v2', value); storage.setItem('booking-draft', '{PRIVATE invalid'); assert.equal(current.readBookingDraft().kind, 'empty'); assert.equal(memory.size, 0) } })
  check('successful old submission cleanup preserves a newer unrelated draft', () => { const old = current.makeBookingDraft('quick', { ...planning.EMPTY, kind: 'dinner', name: 'Alex' }, 0), newer = current.makeBookingDraft('details', { ...planning.EMPTY, kind: 'class', name: 'Another host' }, 1); current.writeBookingDraft(newer); assert(current.clearMatchingBookingDraft(old.id)); assert.equal(JSON.parse(storage.getItem(current.BOOKING_DRAFT_KEY)).id, newer.id); assert(current.clearMatchingBookingDraft(newer.id)); assert.equal(storage.getItem(current.BOOKING_DRAFT_KEY), null) })
} finally { if (originalStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = originalStorage }
console.log(`\n${checks} draft-restoration checks passed.`)
