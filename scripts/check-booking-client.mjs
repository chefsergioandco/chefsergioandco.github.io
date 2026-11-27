#!/usr/bin/env node
// Runs the real browser API and calendar formatter through their external contracts.
// Only configuration and browser/network surfaces are supplied by this harness.
import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../', import.meta.url))
const savedGlobals = Object.fromEntries(['fetch', 'window', 'sessionStorage', 'localStorage', 'setTimeout', 'clearTimeout'].map(key => [key, globalThis[key]]))
if (!globalThis.crypto) globalThis.crypto = webcrypto
let checks = 0
function check(name, assertion) { assertion(); checks++; process.stdout.write(`PASS ${name}\n`) }
let moduleId = 0
async function actualModule(path, apiBase) {
  const output = await build({
    absWorkingDir: root, entryPoints: [path], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
    plugins: apiBase === undefined ? [] : [{ name: 'test-runtime-configuration', setup(builder) {
      builder.onLoad({ filter: /content\/booking\.ts$/ }, () => ({ contents: `export const booking = {apiBase:${JSON.stringify(apiBase)}}`, loader: 'ts' }))
    } }],
  })
  return import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text + `\n// harness-module-${++moduleId}`).toString('base64'))
}
const receipt = { ref: 'CS-contract-check', status: 'requested', kind: 'dinner', date: '2026-12-20', time: '18:00', guests: 2, amount: null, amountWhen: 'after-quote', createdAt: '2026-11-23T16:00:00Z' }
const request = { kind: 'dinner', date: receipt.date, time: receipt.time, guests: receipt.guests, name: 'Contract check', email: 'check@example.test', phone: '4075550100', contactBy: 'email' }
const result = { ref: receipt.ref, next: 'done', url: `https://pages.example.test/book/done/?ref=${receipt.ref}#access=contract-token`, accessToken: 'contract-token' }
const memory = new Map()
const pendingMemory = new Map()
const calls = []
function browser(hash = '') {
  globalThis.window = { location: { hash } }
  globalThis.sessionStorage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, String(value)) }
  globalThis.localStorage = { getItem: key => pendingMemory.get(key) ?? null, setItem: (key, value) => pendingMemory.set(key, String(value)), removeItem: key => pendingMemory.delete(key) }
}
function observed(url, options) {
  const entry = { url: String(url), options, body: options.body ? JSON.parse(options.body) : undefined }
  calls.push(entry)
  return entry
}
function writeBoundary(entry) {
  assert.equal(entry.options.method, 'POST')
  assert.equal(entry.options.headers['Content-Type'], 'application/json')
  // Matches the anonymous gateway's cross-origin write boundary.
  assert.equal(entry.options.headers['X-Booking-Request'], '1')
  assert.equal(entry.options.credentials, 'omit')
  assert.equal(entry.options.referrerPolicy, 'no-referrer')
  assert.equal(entry.options.cache, 'no-store')
}

try {
  browser()
  const { api } = await actualModule('src/booking/api.ts', 'https://api.example.test')
  const committed = new Map()
  let loseFirstResponse = true
  globalThis.fetch = async (url, options) => {
    const entry = observed(url, options)
    writeBoundary(entry)
    if (!committed.has(entry.body.requestId)) committed.set(entry.body.requestId, result)
    if (loseFirstResponse) { loseFirstResponse = false; throw new TypeError('Connection dropped after the server committed') }
    return Response.json(committed.get(entry.body.requestId))
  }
  await assert.rejects(api.hold(request), error => error.code === 'network')
  const retry = await api.hold(request)
  await api.hold(request)
  check('lost-reply retry and repeated submission reuse one server mutation', () => {
    assert.equal(committed.size, 1)
    assert.equal(calls[0].body.requestId, calls[1].body.requestId)
    assert.equal(calls[1].body.requestId, calls[2].body.requestId)
    assert.match(calls[0].body.requestId, /^[0-9a-f-]{36}$/i)
    assert.deepEqual(calls[0].body.request, request)
    assert.equal(calls[0].body.honeypot, '')
    assert.deepEqual(retry, result)
  })
  await api.hold({ ...request, date: '2026-12-21' }, 'filled-by-bot')
  check('a different request gets a new mutation ID and carries its honeypot', () => {
    assert.equal(committed.size, 2)
    assert.notEqual(calls[3].body.requestId, calls[0].body.requestId)
    assert.equal(calls[3].body.honeypot, 'filled-by-bot')
  })

  const priorCount = calls.length
  globalThis.fetch = async (url, options) => { observed(url, options); return Response.json(receipt) }
  const loaded = await api.booking(receipt.ref)
  check('submission token is recovered from session storage and sent only in POST body', () => {
    assert.deepEqual(loaded, receipt)
    const entry = calls[priorCount]
    writeBoundary(entry)
    assert.equal(entry.url, 'https://api.example.test/api/booking/status')
    assert.deepEqual(entry.body, { ref: receipt.ref, accessToken: 'contract-token' })
    assert(!entry.url.includes('contract-token'))
  })
  browser('#access=fragment-token')
  await api.booking('CS-fragment-check')
  browser()
  await api.booking('CS-fragment-check')
  check('fragment access survives refresh within the tab without exposing it in query strings', () => {
    assert.equal(memory.get('booking-access:CS-fragment-check'), 'fragment-token')
    assert.deepEqual(calls.at(-1).body, { ref: 'CS-fragment-check', accessToken: 'fragment-token' })
  })
  const beforeMissingToken = calls.length
  assert.equal(await api.booking('CS-no-token'), null)
  assert.equal(await api.booking(''), null)
  check('a missing private access token does not request a booking record', () => assert.equal(calls.length, beforeMissingToken))

  let loseWaitlistResponse = true
  globalThis.fetch = async (url, options) => {
    const entry = observed(url, options); writeBoundary(entry)
    if (loseWaitlistResponse) { loseWaitlistResponse = false; throw new TypeError('Reply lost') }
    return Response.json({ ok: true })
  }
  await assert.rejects(api.waitlist('night-contract', 'check@example.test'))
  await api.waitlist('night-contract', 'check@example.test')
  check('waitlist retry retains one mutation ID and the gateway write marker', () => {
    assert.equal(calls.at(-2).body.requestId, calls.at(-1).body.requestId)
    assert.equal(calls.at(-1).body.nightId, 'night-contract')
    assert.equal(calls.at(-1).body.email, 'check@example.test')
    assert.equal(calls.at(-1).body.honeypot, '')
  })

  const reloadBase = 'https://reload.example.test'
  const beforeReload = (await actualModule('src/booking/api.ts', reloadBase)).api
  const reloadCommits = new Map()
  let loseReloadResponse = true
  globalThis.fetch = async (url, options) => {
    const entry = observed(url, options); writeBoundary(entry)
    if (!reloadCommits.has(entry.body.requestId)) reloadCommits.set(entry.body.requestId, result)
    if (loseReloadResponse) { loseReloadResponse = false; throw new TypeError('Reply lost before page reload') }
    return Response.json(reloadCommits.get(entry.body.requestId))
  }
  await assert.rejects(beforeReload.hold(request), error => error.code === 'network')
  const reloadId = calls.at(-1).body.requestId
  const pendingKey = [...pendingMemory.keys()].find(key => pendingMemory.get(key) === reloadId)
  const persisted = JSON.stringify([pendingKey, pendingMemory.get(pendingKey)])
  const afterReload = (await actualModule('src/booking/api.ts', reloadBase)).api
  await afterReload.hold(request)
  check('a fresh module recovers a lost-reply request without persisting guest details', () => {
    assert.equal(reloadCommits.size, 1)
    assert.equal(calls.at(-1).body.requestId, reloadId)
    assert.match(pendingKey, /^booking-pending:v1:https%3A%2F%2Freload\.example\.test:request:[a-f0-9]{64}$/)
    assert(!persisted.includes(request.name))
    assert(!persisted.includes(request.email))
    assert(!persisted.includes(request.phone))
    assert.equal(pendingMemory.has(pendingKey), false)
  })
  const newIntent = (await actualModule('src/booking/api.ts', reloadBase)).api
  await newIntent.hold(request)
  check('a completed request clears pending metadata so a fresh module can start a new intent', () => {
    assert.notEqual(calls.at(-1).body.requestId, reloadId)
    assert.equal(reloadCommits.size, 2)
    assert.equal(pendingMemory.has(pendingKey), false)
  })

  globalThis.fetch = async (url, options) => { observed(url, options); throw new TypeError('Keep both attempts pending') }
  const left = (await actualModule('src/booking/api.ts', 'https://left.example.test')).api
  const right = (await actualModule('src/booking/api.ts', 'https://right.example.test')).api
  await assert.rejects(left.hold(request))
  const leftId = calls.at(-1).body.requestId
  await assert.rejects(right.hold(request))
  const rightId = calls.at(-1).body.requestId
  const freshLeft = (await actualModule('src/booking/api.ts', 'https://left.example.test')).api
  await assert.rejects(freshLeft.hold(request))
  check('pending identities are isolated by API origin and recover only their own request', () => {
    assert.notEqual(leftId, rightId)
    assert.equal(calls.at(-1).body.requestId, leftId)
    assert([...pendingMemory.keys()].some(key => key.includes(encodeURIComponent('https://left.example.test') + ':request:')))
    assert([...pendingMemory.keys()].some(key => key.includes(encodeURIComponent('https://right.example.test') + ':request:')))
  })

  const normalStorage = globalThis.localStorage
  globalThis.localStorage = { getItem() { throw new Error('Storage blocked') }, setItem() { throw new Error('Storage blocked') }, removeItem() { throw new Error('Storage blocked') } }
  try {
    const blockedStorage = (await actualModule('src/booking/api.ts', 'https://blocked.example.test')).api
    let lost = true
    globalThis.fetch = async (url, options) => {
      observed(url, options)
      if (lost) { lost = false; throw new TypeError('Reply lost') }
      return Response.json(result)
    }
    await assert.rejects(blockedStorage.hold(request), error => error.code === 'network')
    const firstId = calls.at(-1).body.requestId
    await blockedStorage.hold(request)
    check('blocked browser storage preserves safe same-page retry behavior', () => assert.equal(calls.at(-1).body.requestId, firstId))
  } finally { globalThis.localStorage = normalStorage }

  const acknowledgmentBase = 'https://acknowledgment.example.test'
  const acknowledgmentApi = (await actualModule('src/booking/api.ts', acknowledgmentBase)).api
  let firstAckId
  for (const acknowledgment of [{}, { ok: false }, { ok: 'true' }, [], true, null]) {
    globalThis.fetch = async (url, options) => { const entry = observed(url, options); firstAckId ??= entry.body.requestId; return Response.json(acknowledgment) }
    await assert.rejects(acknowledgmentApi.waitlist('night-acknowledgment', 'check@example.test'), error => error.code === 'network')
    assert.equal(calls.at(-1).body.requestId, firstAckId)
  }
  const acknowledgmentKey = [...pendingMemory.keys()].find(key => pendingMemory.get(key) === firstAckId)
  assert(acknowledgmentKey?.includes(':waitlist:'))
  const recoveredWaitlist = (await actualModule('src/booking/api.ts', acknowledgmentBase)).api
  globalThis.fetch = async (url, options) => { observed(url, options); return Response.json({ ok: true }) }
  await recoveredWaitlist.waitlist('night-acknowledgment', 'check@example.test')
  check('malformed waitlist acknowledgments fail closed and preserve recovery until ok:true', () => {
    assert.equal(calls.at(-1).body.requestId, firstAckId)
    assert.equal(pendingMemory.has(acknowledgmentKey), false)
  })

  const incompleteBase = 'https://incomplete.example.test'
  const incomplete = (await actualModule('src/booking/api.ts', incompleteBase)).api
  globalThis.fetch = async (url, options) => { observed(url, options); return Response.json({ ...result, accessToken: '' }) }
  await assert.rejects(incomplete.hold(request), error => error.code === 'network')
  const incompleteId = calls.at(-1).body.requestId
  const incompleteKey = [...pendingMemory.keys()].find(key => pendingMemory.get(key) === incompleteId)
  assert(incompleteKey)
  globalThis.fetch = async (url, options) => { observed(url, options); return Response.json(result) }
  await (await actualModule('src/booking/api.ts', incompleteBase)).api.hold(request)
  check('an incomplete booking receipt remains recoverable across reload until valid success', () => {
    assert.equal(calls.at(-1).body.requestId, incompleteId)
    assert.equal(pendingMemory.has(incompleteKey), false)
  })

  globalThis.fetch = async (url, options) => { observed(url, options); return Response.json({ error: { code: 'seats-gone', message: 'These seats are no longer available.' } }, { status: 409 }) }
  await assert.rejects(api.hold({ ...request, kind: 'table', nightId: 'night-full', seats: 2 }), error => error.code === 'seats-gone' && error.message === 'These seats are no longer available.')
  checks++; process.stdout.write('PASS authoritative availability conflicts reach the form as booking errors\n')

  const timeoutApi = (await actualModule('src/booking/api.ts', 'https://timeout.example.test')).api
  let fireTimeout, timeoutCleared = false, timeoutDelay, markStarted
  const networkStarted = new Promise(resolve => { markStarted = resolve })
  globalThis.setTimeout = (callback, delay) => { fireTimeout = callback; timeoutDelay = delay; return 1 }
  globalThis.clearTimeout = () => { timeoutCleared = true }
  globalThis.fetch = (url, options) => {
    observed(url, options)
    markStarted()
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')), { once: true }))
  }
  const timedOut = timeoutApi.hold(request)
  await networkStarted
  check('requests have a bounded abort timeout', () => { assert.equal(timeoutDelay, 20000); assert.equal(typeof fireTimeout, 'function') })
  fireTimeout()
  await assert.rejects(timedOut, error => error.code === 'network')
  check('timeout aborts cleanly and releases its timer', () => assert.equal(timeoutCleared, true))
  globalThis.setTimeout = savedGlobals.setTimeout
  globalThis.clearTimeout = savedGlobals.clearTimeout
  const abortedId = calls.at(-1).body.requestId
  globalThis.fetch = async (url, options) => { const entry = observed(url, options); writeBoundary(entry); return Response.json(result) }
  await timeoutApi.hold(request)
  check('retry after timeout keeps the original mutation ID', () => assert.equal(calls.at(-1).body.requestId, abortedId))

  const closed = (await actualModule('src/booking/api.ts', null)).api
  const beforeUnconfigured = calls.length
  await assert.rejects(closed.hold(request), error => error.code === 'network')
  await assert.rejects(closed.availability('dinner', '2026-12'), error => error.code === 'network')
  check('missing live configuration fails closed without a mock or network write', () => assert.equal(calls.length, beforeUnconfigured))

  const planning = await actualModule('src/booking/planning.ts')
  check('sensitive event data is transmitted only with an explicit own-person consent choice',()=>{
    const state={...planning.EMPTY,kind:'dinner',dietary:['Vegetarian'],allergies:'Private allergy detail'}
    const withheld=planning.planningRequest({...state,sensitiveConsent:false})
    assert.deepEqual(withheld.dietary,[]);assert.equal(withheld.allergies,'');assert.equal(withheld.planning.allergies,'');assert.equal(withheld.sensitiveDataConsent.granted,false)
    const supplied=planning.planningRequest({...state,sensitiveConsent:true})
    assert.deepEqual(supplied.dietary,state.dietary);assert.equal(supplied.allergies,state.allergies);assert.equal(supplied.sensitiveDataConsent.granted,true);assert.equal(supplied.sensitiveDataConsent.scope,'self')
  })
  check('saved browser drafts exclude health, sensitive consent and unrestricted personal text without changing the unsent form',()=>{
    const state={...planning.EMPTY,name:'Host',email:'host@example.test',dietary:['Private choice'],allergies:'Private health',sensitiveConsent:true,notes:'Private volunteered note',foodIdeas:'Private volunteered detail',occasion:'Private occasion',place:'Private address',kitchen:'Private access',gift:'Private code'}
    const draft=planning.privateDraftState(state),encoded=JSON.stringify(draft)
    assert(!encoded.includes('Private'));assert.equal(draft.sensitiveConsent,false);assert.equal(draft.email,state.email);assert.equal(state.allergies,'Private health');assert.equal(state.sensitiveConsent,true)
  })
  const config = { partyBands: [{id:'small',label:'1–6 guests',min:1,max:6,deposit:null},{id:'family',label:'7–12 guests',min:7,max:12,deposit:null}], planningFee:null,checkoutMinutes:null,postageAllowance:null,kitchenRequirements:'',travelMiles:75,maxGuests:24,interviewScheduling:'undecided',paymentReady:false,interviewSlots:[],policyVersion:1 }
  const uncertain = { ...planning.EMPTY, kind:'dinner', dateMode:'undecided', partyBandId:'family', name:'Graduation host', email:'host@example.test', foodIdeas:'Cordon bleu ideas' }
  const validation = {openTimes:[],availabilityLoaded:false,seatsMax:6,today:'2026-11-23'}
  check('an undecided date and exact headcount can become interview questions without fake values', () => {
    assert.deepEqual(planning.validatePlanningStep(uncertain,1,config,validation),{})
    const request = planning.planningRequest(uncertain)
    assert(!Object.hasOwn(request,'date'))
    assert(!Object.hasOwn(request,'time'))
    assert.equal(request.guests,undefined)
    assert.equal(request.planning.headcount,null)
    assert.equal(request.planning.dateMode,'undecided')
    assert.equal(request.planning.foodIdeas,'Cordon bleu ideas')
  })
  check('party-size band is required even while the exact headcount remains open', () => {
    assert(planning.validatePlanningStep({...uncertain,partyBandId:''},1,config,validation).partyBand)
    assert(planning.validatePlanningStep({...uncertain,partyBandId:'unknown-band'},1,config,validation).partyBand)
    assert(planning.validatePlanningStep({...uncertain,headcountMode:'exact',guests:20},1,config,validation).guests)
  })
  check('an exact date must still be available and its chosen time current', () => {
    const exact = {...uncertain,dateMode:'exact',date:'2026-12-20',time:'18:00',headcountMode:'exact',guests:8}
    assert(planning.validatePlanningStep(exact,1,config,validation).date)
    assert(planning.validatePlanningStep(exact,1,config,{...validation,availabilityLoaded:true,openTimes:['19:00']}).time)
    assert.deepEqual(planning.validatePlanningStep(exact,1,config,{...validation,availabilityLoaded:true,openTimes:['18:00']}),{})
  })
  check('flexible ranges reject past and reversed dates without requiring an invented range', () => {
    assert.deepEqual(planning.validatePlanningStep({...uncertain,dateMode:'flexible'},1,config,validation),{})
    const invalid = planning.validatePlanningStep({...uncertain,dateMode:'flexible',dateFrom:'2026-11-22',dateTo:'2026-11-21'},1,config,validation)
    assert(invalid.dateFrom);assert(invalid.dateTo)
  })
  check('budget guidance clears stale price guesses and ranges require a valid upper bound', () => {
    const guidance = planning.planningRequest({...uncertain,budgetMin:'100',budgetMax:'1000'})
    assert.equal(guidance.planning.budgetMin,null);assert.equal(guidance.planning.budgetMax,null)
    assert(planning.validatePlanningStep({...uncertain,budgetMode:'range',budgetMin:'1000',budgetMax:'100'},2,config,validation).budgetMax)
    assert.deepEqual(planning.validatePlanningStep({...uncertain,budgetMode:'range',budgetMin:'100',budgetMax:'1000'},2,config,validation),{})
  })
  check('email contact does not force a second contact channel, while calls and texts need a phone', () => {
    assert.deepEqual(planning.validatePlanningStep(uncertain,3,config,validation),{})
    assert(planning.validatePlanningStep({...uncertain,contactBy:'call'},3,config,validation).phone)
    assert(planning.validatePlanningStep({...uncertain,contactBy:'text'},3,config,validation).phone)
    assert.deepEqual(planning.validatePlanningStep({...uncertain,contactBy:'call',phone:'4075550100'},3,config,validation),{})
  })
  check('unknown settings stop submission rather than creating sample pricing or a local booking', () => {
    assert(planning.validatePlanningStep(uncertain,1,null,validation).config)
    assert(planning.validatePlanningStep(uncertain,3,null,validation).config)
    assert.equal(planning.selectedBand(uncertain,config).deposit,null)
  })
  check('versioned drafts retain unanswered topics and reject malformed or stale storage', () => {
    const valid = {version:2,savedAt:new Date().toISOString(),step:2,s:uncertain}
    assert(planning.validDraft(valid))
    assert(!planning.validDraft({...valid,version:1}))
    assert(!planning.validDraft({...valid,savedAt:'2020-01-01T00:00:00Z'}))
    assert(!planning.validDraft({...valid,s:{...uncertain,dateMode:'made-up'}}))
    assert(!planning.validDraft({...valid,s:{...uncertain,foodIdeas:'x'.repeat(2001)}}))
  })
  check('legacy saved requests migrate their real answers without inventing the new planning fields', () => {
    const old = {savedAt:new Date().toISOString(),step:2,s:{kind:'dinner',date:'2026-12-20',time:'18:00',guests:8,where:'home',place:'Winter Park',occasion:'Graduation',dishes:['Cordon bleu'],dietary:[],notes:'Family gathering',name:'Graduation host',email:'host@example.test',phone:'4075550100',contactBy:'email',gift:'',seats:2}}
    const restored=planning.migrateLegacyDraft(old)
    assert(restored)
    assert.equal(restored.s.foodIdeas,'Cordon bleu')
    assert.equal(restored.s.place,'Winter Park')
    assert.equal(restored.s.guests,8)
    assert.equal(restored.s.partyBandId,'')
    assert.equal(restored.s.budgetMode,'guidance')
    assert.equal(restored.s.kitchen,'')
    assert.equal(planning.migrateLegacyDraft({...old,s:{...old.s,date:'invalid'}}),null)
  })
  const actionApi = (await actualModule('src/booking/api.ts','https://actions.example.test')).api
  browser('#access=action-private-token')
  let lostCancellation = true
  globalThis.fetch = async (url,options) => {
    const entry=observed(url,options);writeBoundary(entry)
    if(lostCancellation){lostCancellation=false;throw new TypeError('Reply lost')}
    return Response.json({...receipt,status:'cancelled'})
  }
  await assert.rejects(actionApi.cancel(receipt.ref,'Plans changed'))
  const cancellationId=calls.at(-1).body.requestId
  await actionApi.cancel(receipt.ref,'Plans changed')
  check('cancellation retries carry private access in the body and retain one mutation identity', () => {
    const entry=calls.at(-1)
    assert.equal(entry.url,'https://actions.example.test/api/booking/cancel')
    assert.equal(entry.body.requestId,cancellationId)
    assert.equal(entry.body.accessToken,'action-private-token')
    assert.equal(entry.body.reason,'Plans changed')
    assert(!entry.url.includes('action-private-token'))
  })
  globalThis.fetch=async(url,options)=>{observed(url,options);return Response.json({url:'https://attacker.example.test/pay'})}
  await assert.rejects(actionApi.checkout(receipt.ref),error=>error.code==='network')
  const checkoutId=calls.at(-1).body.requestId
  globalThis.fetch=async(url,options)=>{observed(url,options);return Response.json({url:'https://checkout.stripe.com/c/pay/contract-check',expiresAt:'2026-12-20T18:00:00Z'})}
  const checkout=await actionApi.checkout(receipt.ref)
  check('checkout accepts only the payment provider host and keeps invalid replies recoverable', () => {
    assert.equal(calls.at(-1).body.requestId,checkoutId)
    assert(checkout.url.startsWith('https://checkout.stripe.com/'))
  })

  const { ics } = await actualModule('src/booking/format.ts')
  check('unconfirmed, held and cancelled requests do not become calendar appointments', () => {
    for (const status of ['requested', 'held', 'cancelled']) assert.equal(ics({ ...receipt, status }), null)
  })
  check('confirmed winter and summer appointments use Eastern Time across DST', () => {
    assert(ics({ ...receipt, status: 'confirmed' }).includes('DTSTART:20261220T230000Z'))
    assert(ics({ ...receipt, status: 'confirmed', date: '2027-07-20' }).includes('DTSTART:20270720T220000Z'))
    assert(ics({ ...receipt, status: 'confirmed', time: '22:15' }).includes('DTSTART:20261221T031500Z'))
  })
  check('calendar export rejects a nonexistent spring-forward wall clock', () => assert.equal(ics({ ...receipt, status: 'confirmed', date: '2027-03-14', time: '02:30' }), null))
  check('calendar export does not invent a duration or disclose private guest fields', () => {
    const calendar = ics({ ...receipt, status: 'confirmed', email: 'private@example.test', place: 'Private home address', notes: 'Private dietary note' })
    assert(calendar.includes('STATUS:CONFIRMED'))
    assert(!calendar.includes('DURATION:'))
    assert(!calendar.includes('DTEND:'))
    assert(!calendar.includes('private@example.test'))
    assert(!calendar.includes('Private home address'))
    assert(!calendar.includes('Private dietary note'))
  })
  process.stdout.write(`\n${checks} public booking client checks passed.\n`)
} finally {
  for (const [key, value] of Object.entries(savedGlobals)) {
    if (value === undefined) delete globalThis[key]
    else globalThis[key] = value
  }
}
