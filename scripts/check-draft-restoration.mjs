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
console.log(`\n${checks} draft-restoration checks passed.`)
