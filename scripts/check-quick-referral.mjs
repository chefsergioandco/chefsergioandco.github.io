#!/usr/bin/env node
// Real referral client and real booking components; all HTTP/provider boundaries are local fixtures.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import puppeteer from 'puppeteer-core'

const root = fileURLToPath(new URL('../', import.meta.url))
const code = '23456789', proof = 'r'.repeat(43), ref = 'WEB-referral-fixture'
const friend = { valid: true, code, name: 'Alex R.', welcome: 50, services: ['dinner', 'class', 'event'] }
const checks = [], errors = []
const pass = text => { checks.push(text); console.log('PASS ' + text) }
const definitions = { __SITE_MODE__: '"prototype"', __LOOK__: '"c"', __PLATING_SEQUENCE_AVAILABLE__: 'false', 'import.meta.env.BASE_URL': '"/"', 'import.meta.env.VITE_AUTH0_SPA_CLIENT_ID': '""' }
const apiPlugin = origin => ({ name: 'fixture-booking-service', setup(builder) {
  builder.onLoad({ filter: /content\/booking\.ts$/ }, async args => ({ contents: (await readFile(args.path, 'utf8')).replace('accountConfig.apiOrigin as string | null', JSON.stringify(origin)), loader: 'ts' }))
} })
async function moduleAt(path, origin) {
  const result = await build({ absWorkingDir: root, entryPoints: [path], write: false, bundle: true, platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent', define: definitions, plugins: [apiPlugin(origin)] })
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'))
}

const memory = new Map()
globalThis.location = { search: '?friend=' + code + '&via=invitation' }
globalThis.sessionStorage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key) }
const referral = await moduleAt('src/booking/referral.ts', 'https://fixture.example')
assert.deepEqual(referral.pendingFriendCode(), { code, source: 'invitation' })
globalThis.location.search = ''
assert.deepEqual(referral.pendingFriendCode(), { code, source: 'invitation' })
pass('referral code and invitation provenance survive the visit without storing booking proof')

globalThis.location.search = '?friend=' + code
const storage = globalThis.sessionStorage
globalThis.sessionStorage = { ...storage, setItem() { throw Error('Storage blocked') } }
assert.deepEqual(referral.pendingFriendCode(), { code, source: 'link' })
globalThis.sessionStorage = storage
pass('a valid link still works when session storage cannot be written')

let response = friend, status = 200, lastCall
globalThis.fetch = async (url, options) => { lastCall = { url, options }; return Response.json(response, { status }) }
assert.equal((await referral.lookupFriend(code, 'link')).name, friend.name)
assert.equal(lastCall.options.credentials, 'omit')
response = { ...friend, code: 'ABCDEFGH' }
await assert.rejects(referral.lookupFriend(code, 'link'), /incomplete/)
response = { valid: false }
assert.equal(await referral.lookupFriend(code, 'link'), null)
status = 503
await assert.rejects(referral.lookupFriend(code, 'link'), /could not be checked/)
pass('lookup distinguishes invalid codes, wrong-code replies and unavailable service without claiming a credit')

status = 200; response = { ok: false }
await assert.rejects(referral.attachFriend(ref, proof, { code, source: 'link' }), /not confirmed/)
assert(memory.has('booking-friend:v1'))
status = 409; response = { error: { code: 'not_first', message: 'The welcome gift is for a first evening with Sergio.' } }
await assert.rejects(referral.attachFriend(ref, proof, { code, source: 'link' }), /first evening/)
assert.equal(lastCall.options.referrerPolicy, 'no-referrer')
assert.equal(lastCall.options.credentials, 'omit')
assert.deepEqual(JSON.parse(lastCall.options.body), { ref, accessToken: proof, code, source: 'link' })
pass('only explicit attachment acknowledgment succeeds; private proof stays in the request body and nested errors remain truthful')
memory.set('booking-friend:v1', JSON.stringify({ code: '34567892', source: 'link' }))
referral.forgetFriendCode(code)
assert(memory.has('booking-friend:v1'))
pass('completing an older invitation cannot discard a different pending code')

let scenario, bundle, server, browser
const config = { partyBands: [{ id: 'small', label: '1–6 guests', min: 1, max: 6, deposit: 100 }], planningFee: 50, checkoutMinutes: 30, postageAllowance: null, kitchenRequirements: '', travelMiles: 75, maxGuests: 24, interviewScheduling: 'undecided', interviewSlots: [], policyVersion: 1 }
const night = { id: 'fixture-night', kind: 'dinner', title: 'Local fixture evening', date: '2099-02-13', start: '18:30', cutoff: '2099-02-10T18:30:00-05:00', seats: 8, taken: 0, minimum: 4, pricePerSeat: 100, state: 'pending', menu: 'Fixture menu' }
const html = '<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>'
let origin
try {
  server = createServer(async (request, res) => {
    const url = new URL(request.url, origin || 'http://127.0.0.1')
    if (url.pathname === '/fixture.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(bundle) }
    if (!url.pathname.startsWith('/api/')) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(html) }
    let body = ''
    for await (const chunk of request) body += chunk
    const data = body ? JSON.parse(body) : null
    scenario.calls.push({ path: url.pathname, data })
    let reply, status = 200
    if (url.pathname === '/api/planning-config') reply = { ...config, paymentReady: !!scenario.paid }
    else if (url.pathname === '/api/availability') reply = { month: url.searchParams.get('month'), days: [], nextOpen: null, sample: false }
    else if (url.pathname === '/api/nights') reply = [night]
    else if (url.pathname === '/api/referral') {
      if (scenario.lookupFailure) { status = 503; reply = { error: { message: 'Local lookup unavailable' } } }
      else reply = friend
    } else if (['/api/hold', '/api/request'].includes(url.pathname)) {
      reply = { ref, accessToken: proof, next: 'done', url: origin + '/book/done/?ref=' + ref + '#access=' + proof,
        ...(scenario.paid && data.checkoutRequestId ? { checkout: scenario.giftCovered ? { paid: true, ref, requestId: data.checkoutRequestId } : { url: 'https://checkout.stripe.com/c/pay/cs_test_referral_fixture' } } : {}) }
    } else if (url.pathname === '/api/referral/attach') {
      scenario.attachCount++
      if (scenario.attachCount === 1 && scenario.dropAfterAttach) {
        // Confirm that the server accepted the request, then lose the response body.
        // Dropping before headers can cause Chrome itself to retry transparently.
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.flushHeaders(); res.write('{"ok":')
        setTimeout(() => res.destroy(), 10); return
      }
      if (scenario.attachCount === 1 && scenario.badAcknowledgment) reply = { ok: false }
      else if (scenario.rejectAttachment) { status = 409; reply = { error: { message: 'The welcome gift is for a first evening with Sergio.' } } }
      else reply = { ok: true, welcome: 50 }
    } else if (url.pathname === '/api/booking/checkout') {
      if (scenario.checkoutFailure) { status = 503; reply = { error: { message: 'Checkout is unavailable in this fixture.' } } }
      else reply = scenario.giftCovered ? { paid: true, ref, requestId: data.requestId } : { url: 'https://checkout.stripe.com/c/pay/cs_test_referral_fixture' }
    } else { status = 599; reply = { error: { message: 'Unexpected fixture request: ' + url.pathname } }; errors.push(reply.error.message) }
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(reply))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = 'http://127.0.0.1:' + server.address().port
  const result = await build({ absWorkingDir: root, stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{LazyMotion,domAnimation}from'framer-motion';import{QuickBooking}from'./src/components/QuickBooking';import{BookingForm}from'./src/components/BookingForm';createRoot(document.getElementById('root')).render(<LazyMotion features={domAnimation}>{new URLSearchParams(location.search).get('form')==='legacy'?<BookingForm/>:<QuickBooking/>}</LazyMotion>);`, resolveDir: root, loader: 'tsx' }, write: false, bundle: true, platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent', loader: { '.css': 'empty' }, define: definitions, plugins: [apiPlugin(origin)] })
  bundle = result.outputFiles[0].text
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })

  async function button(page, text) {
    const handle = await page.waitForFunction(text => [...document.querySelectorAll('button')].find(node => node.textContent.trim() === text), {}, text)
    await handle.asElement().click(); await handle.dispose()
  }
  async function choice(page, group, text) {
    await page.waitForSelector('#' + group + ' [role=radio]')
    for (const item of await page.$$('#' + group + ' [role=radio]')) if ((await item.evaluate(node => node.textContent)).includes(text)) { await item.click(); return }
    throw Error('Missing choice ' + group + ': ' + text)
  }
  async function fill(page, legacy, table) {
    if (!legacy) {
      await choice(page, 'f-partyBand', '1–6 guests'); await choice(page, 'f-date', 'Not sure yet')
    } else {
      await choice(page, 'f-kind', table ? 'Seats at Sergio’s table' : 'A private dinner')
      await page.click('form button[type=submit]'); await page.waitForSelector('[data-step="1"]')
      if (table) { await page.waitForSelector('#f-night [data-night]'); await page.click('#f-night [data-night]') }
      else { await choice(page, 'f-dateMode', 'Help me choose a date'); await choice(page, 'f-partyBand', '1–6 guests') }
      await page.click('form button[type=submit]'); await page.waitForSelector('[data-step="2"]')
      if (!table) await choice(page, 'f-budgetMode', 'I’d like Sergio’s guidance')
      await page.click('form button[type=submit]'); await page.waitForSelector('[data-step="3"]')
    }
    await page.type('#f-name', 'Referral fixture guest'); await page.type('#f-email', 'referral-fixture@example.test')
    await page.waitForFunction(() => !document.querySelector('form button[type=submit]').disabled)
  }
  async function run(name, options = {}) {
    console.log('CHECK ' + name)
    scenario = { calls: [], attachCount: 0, ...options }
    const page = await browser.newPage()
    page.setDefaultTimeout(10000)
    page.on('pageerror', error => errors.push(name + ': ' + error.message))
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
    await page.setRequestInterception(true)
    page.on('request', async request => {
      const url = new URL(request.url())
      if (url.origin === origin || url.protocol === 'data:') return request.continue()
      if (url.origin === 'https://checkout.stripe.com' && request.isNavigationRequest()) return request.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><head><title>Local checkout fixture</title><link rel="icon" href="data:,"></head><body><h1>Local checkout fixture</h1></body>' })
      errors.push(name + ': blocked external request ' + url.origin); return request.abort()
    })
    const query = new URLSearchParams({ ...(options.legacy ? { form: 'legacy' } : {}), ...(options.noFriend ? {} : { friend: code, ...(options.invitation ? { via: 'invitation' } : {}) }) })
    await page.goto(origin + '/book/?' + query, { waitUntil: 'domcontentloaded' })
    if (!options.noFriend && !options.lookupFailure) assert.match(await page.$eval('.booking-friend', node => node.textContent), /Eligible first bookings|welcome gift applies/)
    await fill(page, options.legacy, options.table)
    if (options.doubleSubmit) await page.evaluate(() => { const form = document.querySelector('form'); form.requestSubmit(); form.requestSubmit() })
    else await page.click('form button[type=submit]')
    const failed = options.dropAfterAttach || options.badAcknowledgment || options.rejectAttachment
    if (failed) {
      await page.waitForSelector('.booking-referral-recovery')
      const recovery = await page.$eval('.booking-referral-recovery', node => node.textContent)
      assert.match(recovery, /Your request is saved/); assert.match(recovery, /credit is not confirmed/)
      if (options.rejectAttachment) assert.match(recovery, /first evening with Sergio/)
      assert.equal(await page.$('form'), null, 'saved request cannot be resubmitted from a failed-referral form')
      assert(await page.evaluate(() => sessionStorage.getItem('booking-friend:v1')))
      if (options.legacy) assert.equal(await page.evaluate(() => localStorage.getItem('booking-draft:v2')), null)
      if (options.continue) await button(page, options.paid ? 'Continue to payment' : 'Continue to your booking')
      else await button(page, 'Retry invitation')
    }
    await page.waitForFunction(paid => paid ? location.hostname === 'checkout.stripe.com' : location.pathname === '/book/done/', {}, !!options.paid && !options.checkoutFailure && !options.giftCovered)
    if (options.paid && !options.checkoutFailure && !options.giftCovered) {
      await page.waitForSelector('h1')
      assert.equal(await page.$eval('h1', node => node.textContent), 'Local checkout fixture')
    }
    const holds = scenario.calls.filter(call => ['/api/hold', '/api/request'].includes(call.path))
    const attachments = scenario.calls.filter(call => call.path === '/api/referral/attach')
    assert.equal(holds.length, 1, 'referral recovery must never create another hold/request')
    assert.match(holds[0].data.requestId, /^[0-9a-f-]{36}$/)
    if (options.noFriend || options.table) assert.equal(attachments.length, 0)
    else {
      assert.equal(attachments.length, failed && !options.continue ? 2 : 1)
      for (const call of attachments) assert.deepEqual(call.data, { ref, accessToken: proof, code, source: options.invitation ? 'invitation' : 'link' })
      if (!options.paid || options.checkoutFailure) assert.equal(!!(await page.evaluate(() => sessionStorage.getItem('booking-friend:v1'))), !!options.continue)
    }
    if (options.noFriend) assert.equal(scenario.calls.filter(call => call.path === '/api/referral').length, 0)
    if (options.table) assert(await page.evaluate(() => sessionStorage.getItem('booking-friend:v1')))
    if (options.paid && !options.legacy) {
      assert.match(holds[0].data.checkoutRequestId, /^[0-9a-f-]{36}$/)
      assert.equal(scenario.calls.filter(call => call.path === '/api/booking/checkout').length, 0, 'combined checkout must not be created twice')
    }
    if (options.checkoutFailure) assert.match(await page.evaluate(ref => sessionStorage.getItem('booking-pay-error:' + ref), ref), /Checkout is unavailable/)
    if (options.giftCovered) { assert.equal(await page.evaluate(ref => sessionStorage.getItem('booking-pay-error:' + ref), ref), null); assert.equal(new URL(page.url()).pathname, '/book/done/') }
    pass(name)
    await page.close()
  }

  await run('ordinary quick referral attaches once despite repeated submit, and clears only after acknowledgment', { doubleSubmit: true })
  await run('post-evening invitation provenance survives quick booking even when the initial lookup is unavailable', { invitation: true, lookupFailure: true })
  await run('ambiguous attachment retries the same saved booking/proof without another hold', { dropAfterAttach: true })
  await run('malformed attachment success remains recoverable; continuing preserves the pending code', { badAcknowledgment: true, continue: true })
  await run('eligibility rejection preserves the booking and displays the actual reason before continuing', { rejectAttachment: true, continue: true })
  await run('failed referral can continue to the original combined payment session', { paid: true, badAcknowledgment: true, continue: true })
  await run('successful referral keeps the original combined payment navigation', { paid: true })
  await run('a booking without a referral keeps its original payment path and makes no referral calls', { paid: true, noFriend: true })
  await run('legacy planning attaches the referral using the same verified receipt proof', { legacy: true })
  await run('legacy referral recovery clears the submitted draft and retries no booking', { legacy: true, dropAfterAttach: true })
  await run('legacy payment fallback failure still opens the original saved private booking', { legacy: true, paid: true, checkoutFailure: true })
  await run('Table seat bookings do not consume a private-event referral', { legacy: true, table: true })
  await run('fully gift-covered quick checkout opens the saved receipt without another checkout or Stripe redirect', { paid: true, noFriend: true, giftCovered: true })
  await run('fully gift-covered legacy Table checkout opens the same saved receipt without an undefined redirect', { legacy: true, table: true, paid: true, giftCovered: true })
  assert.deepEqual(errors, [])
  pass('all browser API/provider requests were local fixtures; no real booking, charge or email occurred')
} finally {
  if (browser) await browser.close()
  if (server) await new Promise(resolve => server.close(resolve))
}
console.log(`\n${checks.length} quick/referral checks passed.`)
