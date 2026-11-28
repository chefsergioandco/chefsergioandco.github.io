#!/usr/bin/env node
// The one-screen booking: its pure rules, the client calls it makes, and (when the Worker source is beside this
// checkout) that the request it builds passes the real booking gateway's validation.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createHash, webcrypto } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../', import.meta.url))
if (!globalThis.crypto) globalThis.crypto = webcrypto
let checks = 0
const check = async (name, run) => { await run(); checks++; process.stdout.write(`PASS ${name}\n`) }
async function load(path, apiBase) {
  const output = await build({
    absWorkingDir: root, entryPoints: [path], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'silent',
    define: { 'import.meta.env': '{}', __SITE_MODE__: JSON.stringify('prototype'), __LOOK__: JSON.stringify('c'), __PLATING_SEQUENCE_AVAILABLE__: 'false' },
    plugins: apiBase === undefined ? [] : [{ name: 'api-base', setup(builder) { builder.onLoad({ filter: /content\/booking\.ts$/ }, () => ({ contents: `export const booking = {apiBase:${JSON.stringify(apiBase)}}`, loader: 'ts' })) } }],
  })
  return import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64'))
}

const quick = await load('src/booking/quick.ts')
const bands = [{ id: 'small', label: '1–6 guests', min: 1, max: 6, deposit: 100 }, { id: 'medium', label: '7–12 guests', min: 7, max: 12, deposit: 150 }, { id: 'large', label: '13–24 guests', min: 13, max: 24, deposit: 250 }]
const config = { partyBands: bands, planningFee: 50, checkoutMinutes: 30, paymentReady: true, maxGuests: 24, interviewSlots: [], travelMiles: 75 }
const filled = { ...quick.QUICK_EMPTY, format: 'dinner', partyBandId: 'small', dateMode: 'exact', date: '2027-02-13', time: '18:30', name: 'Quick Guest', email: 'quick@example.com' }

await check('party size decides between a dinner and an event; classes are published dates, not offered here', () => {
  assert.deepEqual(quick.formatsFor(bands[0]), ['dinner'])
  assert.deepEqual(quick.formatsFor(bands[1]), ['dinner', 'event'])
  assert.deepEqual(quick.formatsFor(bands[2]), ['event'])
  assert.equal(quick.FORMAT_ORDER.includes('class'), false)
  assert.equal(quick.formatFits('dinner', bands[2]), false); assert.equal(quick.formatFits('event', bands[0]), false)
})
await check('an explicitly requested private class stays visible while its party band fits', () => {
  assert(quick.formatsFor(bands[0], 'class').includes('class'))
  assert(quick.formatsFor(bands[1], 'class').includes('class'))
  assert(!quick.formatsFor(bands[2], 'class').includes('class'))
  assert(!quick.formatsFor(bands[0]).includes('class'), 'ordinary dinner/event choices remain unchanged')
  const classState = { ...filled, format: 'class', where: 'home' }
  assert.deepEqual(quick.validateQuick(classState, config, { openTimes: ['18:30'], availabilityLoaded: true, today: '2027-01-15' }), {})
  assert.equal(quick.quickRequest(classState).kind, 'class')
})
await check('the default start is an evening time that is actually open', () => {
  assert.equal(quick.preferredTime(['17:00', '18:00', '18:30', '20:00']), '18:30')
  assert.equal(quick.preferredTime(['08:00', '17:30', '20:30']), '17:30')
  assert.equal(quick.preferredTime(['08:00', '09:30']), '09:30')
  assert.equal(quick.preferredTime([]), undefined)
})
await check('the next open evenings come soonest first across months, without past or full days', () => {
  const months = [{ month: '2027-01', days: [{ date: '2027-01-30', times: ['18:00'] }, { date: '2027-01-10', times: ['18:00'] }, { date: '2027-01-20', times: [] }], nextOpen: null, sample: false }, { month: '2027-02', days: [{ date: '2027-02-02', times: ['19:00'] }], nextOpen: null, sample: false }]
  assert.deepEqual(quick.nextOpenDays(months, '2027-01-15', 6).map(day => day.date), ['2027-01-30', '2027-02-02'])
  assert.equal(quick.nextOpenDays([null, undefined], '2027-01-15').length, 0)
})
await check('a filled one-screen booking validates and builds the same planning request as the step-by-step form', () => {
  assert.deepEqual(quick.validateQuick(filled, config, { openTimes: ['18:30'], availabilityLoaded: true, today: '2027-01-15' }), {})
  const request = quick.quickRequest(filled)
  assert.equal(request.kind, 'dinner'); assert.equal(request.date, '2027-02-13'); assert.equal(request.time, '18:30'); assert.equal(request.flexible, false)
  assert.deepEqual(request.planning, { dateMode: 'exact', partyBandId: 'small', headcount: null, kitchen: '', budgetMode: 'guidance', budgetMin: null, budgetMax: null, budgetUnit: 'total', foodIdeas: '', allergies: '', physicalInvitations: false })
  const undecided = quick.quickRequest({ ...filled, dateMode: 'undecided', date: undefined, time: undefined })
  assert.equal('date' in undecided, false); assert.equal(undecided.flexible, true); assert.equal(undecided.planning.dateMode, 'undecided')
})
await check('validation names every missing answer, and a format that doesn’t fit the group', () => {
  const errors = quick.validateQuick({ ...quick.QUICK_EMPTY }, config, { openTimes: [], availabilityLoaded: true, today: '2027-01-15' })
  for (const key of ['partyBand', 'format', 'date', 'name', 'email']) assert(key in errors, key)
  assert('format' in quick.validateQuick({ ...filled, partyBandId: 'large' }, config, { openTimes: ['18:30'], availabilityLoaded: true, today: '2027-01-15' }))
  assert('time' in quick.validateQuick({ ...filled, time: '07:00' }, config, { openTimes: ['18:30'], availabilityLoaded: true, today: '2027-01-15' }))
  assert('phone' in quick.validateQuick({ ...filled, contactBy: 'text' }, config, { openTimes: ['18:30'], availabilityLoaded: true, today: '2027-01-15' }))
  assert('where' in quick.validateQuick({ ...filled, format: 'class', where: 'his' }, config, { openTimes: ['18:30'], availabilityLoaded: true, today: '2027-01-15' }))
  assert('gift' in quick.validateQuick({ ...filled, gift: 'ABC' }, config, { openTimes: ['18:30'], availabilityLoaded: true, today: '2027-01-15' }))
  assert.deepEqual(quick.validateQuick({ ...filled, dateMode: 'undecided', date: undefined, time: undefined }, config, { openTimes: [], availabilityLoaded: false, today: '2027-01-15' }), {})
})

// Browser surfaces for the real client API module.
const session = new Map(), local = new Map(), calls = []
const events = new EventTarget()
globalThis.window = { location: { hash: '', origin: 'https://pages.example.test' }, addEventListener: events.addEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events) }
globalThis.sessionStorage = { getItem: key => session.get(key) ?? null, setItem: (key, value) => session.set(key, String(value)), removeItem: key => session.delete(key) }
globalThis.localStorage = { getItem: key => local.get(key) ?? null, setItem: (key, value) => local.set(key, String(value)), removeItem: key => local.delete(key), get length() { return local.size }, key: index => [...local.keys()][index] ?? null }
const locks = new Set()
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { async request(name, _options, callback) { if (locks.has(name)) return callback(null); locks.add(name); try { return await callback({ name }) } finally { locks.delete(name) } } } } })
const { api, bookingIntake } = await load('src/booking/api.ts', 'https://api.example.test')
const ref = 'WEB-quick-contract', accessToken = 'quick-contract-token'.padEnd(43, 'x')
const saved = { ref, next: 'done', url: `https://pages.example.test/book/done/?ref=${ref}#access=${accessToken}`, accessToken }
let reply = () => saved, dropFirst = false
globalThis.fetch = async (url, options) => {
  const body = options.body ? JSON.parse(options.body) : undefined
  calls.push({ url: String(url), body })
  if (dropFirst) { dropFirst = false; throw new TypeError('Connection dropped after the server committed') }
  return Response.json(reply(body, String(url)))
}
const request = quick.quickRequest(filled)

await check('a hold asks for checkout with a stable ID and sends the elapsed time outside the request identity', async () => {
  reply = () => ({ ...saved, checkout: { url: 'https://checkout.stripe.com/c/pay/cs_live_Quick1', expiresAt: '2027-01-15T18:30:00Z' } })
  dropFirst = true
  await assert.rejects(api.hold(request, '', { checkout: true, elapsedMs: 17000 }))
  const result = await api.hold(request, '', { checkout: true, elapsedMs: 19000 })
  const [lost, retried] = calls.slice(-2).map(call => call.body)
  assert.equal(retried.requestId, lost.requestId); assert.equal(retried.checkoutRequestId, lost.checkoutRequestId)
  assert.match(retried.checkoutRequestId, /^[0-9a-f-]{36}$/); assert.notEqual(retried.checkoutRequestId, retried.requestId)
  assert.equal(lost.elapsedMs, 17000); assert.equal(retried.elapsedMs, 17000)
  assert.equal(calls.at(-1).url, 'https://api.example.test/api/hold')
  assert.equal(result.checkout.url, 'https://checkout.stripe.com/c/pay/cs_live_Quick1')
})
await check('a checkout link that isn’t the payment provider becomes a checkout error, never a redirect', async () => {
  await bookingIntake.startDifferent()
  reply = () => ({ ...saved, checkout: { url: 'https://evil.example/pay' } })
  const result = await api.hold({ ...request, email: 'other@example.com' }, '', { checkout: true })
  assert.equal(result.checkout, undefined); assert.equal(result.checkoutError.code, 'invalid_checkout')
})
await check('events and holds without payment never ask for checkout; bad elapsed times are not sent', async () => {
  await bookingIntake.startDifferent()
  reply = () => saved
  await api.hold({ ...request, kind: 'event', email: 'event@example.com' }, '', { checkout: true, elapsedMs: 12000 })
  assert.equal(calls.at(-1).url, 'https://api.example.test/api/request'); assert.equal('checkoutRequestId' in calls.at(-1).body, false); assert.equal(calls.at(-1).body.elapsedMs, 12000)
  await bookingIntake.startDifferent()
  await api.hold({ ...request, email: 'nopay@example.com' }, '', { elapsedMs: -5 })
  assert.equal('checkoutRequestId' in calls.at(-1).body, false); assert.equal('elapsedMs' in calls.at(-1).body, false)
})
await check('guest details go to the booking’s private receipt with its access token in the body only', async () => {
  reply = body => ({ ref, status: 'requested', kind: 'dinner', preparationAction: { version: 1, bookingId: ref, requestId: body.requestId, requestHash: createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(body).sort(([a],[b])=>a.localeCompare(b))))).digest('hex'), operation: 'save', state: 'recorded', revision: 1, workspaceRevision: 39, recordedAt: '2026-11-27T20:00:00.000Z', outcomes: { occasion: 'accepted', dietary: 'accepted' }, entryIds: {} }, detailsResult: { version: 1, requestId: body.requestId, recordedAt: '2026-11-27T20:00:00.000Z', outcomes: { occasion: 'recorded', dietary: 'recorded' } } })
  await api.details(ref, { occasion: 'Birthday', dietary: ['Gluten-free'] }, { bookingId: ref, requestId: crypto.randomUUID(), expectedRevision: 0, expectedWorkspaceRevision: 38 })
  const last = calls.at(-1)
  assert.equal(last.url, 'https://api.example.test/api/booking/details'); assert.equal(last.body.ref, ref); assert.equal(last.body.accessToken, accessToken)
  assert.deepEqual(last.body.details, { occasion: 'Birthday', dietary: ['Gluten-free'] }); assert.match(last.body.requestId, /^[0-9a-f-]{36}$/)
  await assert.rejects(api.details('WEB-unknown', { occasion: 'x' }), error => error.code === 'invalid')
})

// Cross-repository contract: the request the form builds passes the deployed gateway's own validation.
const gatewaySource = fileURLToPath(new URL('../../../work/cloudflare/gateway/server/index.ts', import.meta.url))
if (existsSync(gatewaySource)) {
  const gateway = await build({ entryPoints: [gatewaySource], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'silent' })
  const { handleGateway } = await import('data:text/javascript;base64,' + Buffer.from(gateway.outputFiles[0].text).toString('base64'))
  await check('the one-screen request and its options pass the real booking gateway unchanged', async () => {
    const trusted = readFileSync(gatewaySource, 'utf8').match(/TRUSTED_ADMIN_ORIGIN\s*=\s*'([^']+)'/)?.[1]
    assert(trusted, 'the gateway names its trusted admin origin')
    const env = { ADMIN_SITE_ORIGIN: trusted, ADMIN_SITE_SERVICE_TOKEN: 'service-token', BOOKING_BRIDGE_SECRET: 'test-bridge-secret-32-characters-minimum', PUBLIC_SITE_ORIGIN: 'https://chefsergioandco.github.io' }
    const forwarded = []
    const upstream = async (url, init) => { forwarded.push(JSON.parse(init.body)); return Response.json({ ok: true }) }
    for (const candidate of [request, quick.quickRequest({ ...filled, dateMode: 'undecided', date: undefined, time: undefined, dietary: ['Vegan'], phone: '4075550123', contactBy: 'text', place: 'Winter Park' })]) {
      const body = { request: candidate, requestId: crypto.randomUUID(), honeypot: '', checkoutRequestId: crypto.randomUUID(), elapsedMs: 18000 }
      const response = await handleGateway(new Request('https://api.example/api/hold', { method: 'POST', headers: { Origin: env.PUBLIC_SITE_ORIGIN, 'Content-Type': 'application/json', 'X-Booking-Request': '1', 'CF-Connecting-IP': '203.0.113.4' }, body: JSON.stringify(body) }), env, upstream)
      assert.equal(response.status, 200, await response.clone().text())
      assert.equal(forwarded.at(-1).checkoutRequestId, body.checkoutRequestId); assert.equal(forwarded.at(-1).elapsedMs, 18000)
    }
  })
} else process.stdout.write('SKIP gateway contract (Worker source not beside this checkout)\n')

process.stdout.write(`\n${checks} one-screen booking checks passed.\n`)
