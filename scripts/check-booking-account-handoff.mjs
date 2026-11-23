/**
 * Real BookingForm submission with fictional SDK/API boundaries. No live booking,
 * Auth0 or payment request can leave this harness. Serve a built site through
 * CHECK_BASE_URL, or run from a built checkout to start a temporary local server.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { transform } from 'esbuild'
import puppeteer from 'puppeteer-core'
import { serve } from './serve.mjs'

const source = await fs.readFile(new URL('../src/account/config.ts', import.meta.url), 'utf8')
const compiled = await transform(source.replaceAll('import.meta.env.VITE_AUTH0_SPA_CLIENT_ID', '""'), { loader: 'ts', format: 'esm', target: 'es2022' })
const { accountConfig } = await import('data:text/javascript;base64,' + Buffer.from(compiled.code).toString('base64'))
const apiOrigin = new URL(accountConfig.apiOrigin).origin
const port = Number(process.env.HANDOFF_CHECK_PORT) || 4493
const base = (process.env.CHECK_BASE_URL || `http://127.0.0.1:${port}`).replace(/\/$/, '')
const localOrigin = new URL(base).origin
const directory = process.env.SHOTS_DIR || 'output/booking-account-handoff'
const proof = 'f'.repeat(43), ref = 'CS-local-handoff-fixture'
const config = { partyBands: [{ id: 'one-six', label: '1–6 guests', min: 1, max: 6, deposit: null }], planningFee: null, checkoutMinutes: null, postageAllowance: null, kitchenRequirements: '', travelMiles: 30, maxGuests: 24, interviewScheduling: 'undecided', paymentReady: false, interviewSlots: [], policyVersion: 1 }
const receipt = { ref, status: 'requested', kind: 'dinner', date: null, time: null, guests: null, amount: null, amountWhen: 'after-quote', createdAt: '2026-11-23T12:00:00Z', planning: { dateMode: 'undecided', partyBandLabel: '1–6 guests', interviewStatus: 'not_started', dateReserved: false, depositStatus: 'not_required' } }
const checks = [], errors = [], routeErrors = [], blockedExternal = []
const pass = label => { checks.push(label); console.log('PASS ' + label) }
let browser, server

async function clickRadio(page, id, label) {
  await page.waitForSelector(`#${id} [role=radio]`)
  for (const control of await page.$$(`#${id} [role=radio]`)) {
    if (await control.$eval('.booking-choice-label', node => node.textContent.trim()) === label) { await control.click(); return }
  }
  throw Error('Missing radio choice: ' + label)
}
async function step(page, index) { await page.waitForFunction(index => document.querySelector('.booking-step-content')?.getAttribute('data-step') === String(index), {}, index) }
async function continueForm(page) { await page.click('form.booking-flow button[type=submit]') }
async function fillForm(page) {
  await step(page, 0)
  await clickRadio(page, 'f-kind', 'A private dinner')
  await page.type('#f-occasion', 'Local handoff fixture — not a real request')
  await continueForm(page); await step(page, 1)
  await clickRadio(page, 'f-dateMode', 'Help me choose a date')
  await clickRadio(page, 'f-partyBand', '1–6 guests')
  await continueForm(page); await step(page, 2)
  await clickRadio(page, 'f-budgetMode', 'I’d like Sergio’s guidance')
  await continueForm(page); await step(page, 3)
  await page.type('#f-name', 'Local fixture guest')
  await page.type('#f-email', 'fixture@example.test')
  await page.waitForFunction(() => !document.querySelector('form.booking-flow button[type=submit]')?.disabled)
}

async function scenario(name, destination) {
  const page = await browser.newPage(), writes = [], documents = []
  page.on('pageerror', error => errors.push({ scenario: name, message: error.message }))
  await page.setViewport({ width: 1440, height: 1000 })
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  await page.setRequestInterception(true)
  const cors = { 'Access-Control-Allow-Origin': localOrigin, 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Authorization,Content-Type,X-Customer-Request,X-Booking-Request' }
  page.on('request', async request => {
    const url = new URL(request.url())
    try {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents.push(url.origin + url.pathname)
      if (url.origin === localOrigin && url.pathname.includes('auth0-spa-js.production.esm-')) {
        return request.respond({ status: 200, contentType: 'application/javascript', body: `export class Auth0Client {
          constructor(options){this.token=undefined;window.__sdkOptions=options;window.__sdkInstances=(window.__sdkInstances||0)+1}
          async handleRedirectCallback(){this.token='fictional-memory-access-token';return {appState:{returnTo:'/book/'}}}
          async getTokenSilently(options){if(options.cacheMode!=='cache-only')throw Error('Unexpected token acquisition');return this.token}
          async loginWithRedirect(){throw Error('No real authorization allowed by this fixture')}
          async logout(){this.token=undefined}
        }` })
      }
      if (url.origin === apiOrigin) {
        if (request.method() === 'OPTIONS') return request.respond({ status: 204, headers: cors })
        const body = request.postData() ? JSON.parse(request.postData()) : null
        let data
        if (url.pathname.startsWith('/api/spa/')) {
          assert.equal(request.headers().authorization, 'Bearer fictional-memory-access-token')
          if (url.pathname === '/api/spa/auth/session') data = { authenticated: true, identity: { sub: 'auth0|fixture', email: 'fixture@example.test', name: 'Local fixture guest', email_verified: true, isAdmin: false, permissions: [] }, csrfToken: null }
          else if (url.pathname === '/api/spa/customer/bookings') data = { user: { name: 'Local fixture guest', email: 'fixture@example.test', emailVerified: true }, bookings: [] }
          else if (url.pathname === '/api/spa/customer/profile') data = { profile: { displayName: 'Local fixture guest', preferences: '', email: 'fixture@example.test', emailVerified: true } }
          else if (url.pathname === '/api/spa/customer/menus') data = { menus: [] }
          else if (url.pathname === '/api/spa/account/security') data = { email: 'fixture@example.test', emailVerified: true, verificationResendEnabled: false, verificationCheckEnabled: true, passwordResetEnabled: true, passwordProvider: 'auth0' }
          else throw Error('Unexpected authenticated fixture route: ' + url.pathname)
        } else {
          assert(!request.headers().authorization, 'Public booking operations must not receive the account JWT')
          if (request.method() === 'POST') { assert.equal(request.headers()['x-booking-request'], '1'); writes.push({ path: url.pathname, body }) }
          if (url.pathname === '/api/planning-config') data = config
          else if (url.pathname === '/api/newsletter/status') data = { available: false, consentVersion: 'local-fixture', consentText: 'Local fixture only.', message: 'Signup is paused in this local fixture.' }
          else if (url.pathname === '/api/availability') data = { month: url.searchParams.get('month'), days: [], nextOpen: null, sample: false }
          else if (url.pathname === '/api/nights') data = []
          else if (url.pathname === '/api/hold') data = { ref, next: 'done', url: destination, accessToken: proof }
          else if (url.pathname === '/api/booking/status') { assert.equal(body.ref, ref); assert.equal(body.accessToken, proof); data = receipt }
          else throw Error('Unexpected public fixture route: ' + url.pathname)
        }
        return request.respond({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(data) })
      }
      if (request.isNavigationRequest() && (url.origin === 'https://checkout.stripe.com' || url.origin === localOrigin && url.pathname === '/local-wrong-destination/')) {
        assert(!request.url().includes(proof), 'URL fragments must not enter a document request')
        return request.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><html><head><title>Local native navigation fixture</title><link rel="icon" href="data:,"></head><body><h1>Native destination fixture</h1></body></html>' })
      }
      if (url.origin !== localOrigin && !['data:', 'blob:'].includes(url.protocol)) {
        blockedExternal.push({ scenario: name, origin: url.origin })
        return request.abort()
      }
      assert(!request.headers().authorization, 'Static assets must not receive the account JWT')
      return request.continue()
    } catch (error) {
      routeErrors.push({ scenario: name, message: error.message })
      if (!request.isInterceptResolutionHandled()) await request.respond({ status: 599, contentType: 'application/json', headers: cors, body: JSON.stringify({ error: { message: 'Unexpected local fixture request.' } }) })
    }
  })
  await page.goto(base + '/auth/callback/?code=local-fixture&state=local-fixture', { waitUntil: 'networkidle0' })
  await page.waitForFunction(() => location.pathname === '/book/' && !!document.querySelector('.account-signed-in-dot'))
  const sentinel = await page.evaluate(() => { window.__handoffSentinel = crypto.randomUUID(); return window.__handoffSentinel })
  assert.equal(await page.evaluate(() => window.__sdkInstances), 1)
  const beforeDocuments = documents.length
  await fillForm(page)
  await continueForm(page)
  await page.waitForFunction(path => location.pathname === path, {}, new URL(destination).pathname)
  assert.equal(writes.filter(item => item.path === '/api/hold').length, 1)
  assert.match(writes.find(item => item.path === '/api/hold').body.requestId, /^[0-9a-f-]{36}$/)
  if (name === 'confirmation') {
    await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Your request is with Sergio')
    assert.equal(documents.length, beforeDocuments, 'Confirmation must not request a new document')
    assert.equal(await page.evaluate(() => window.__handoffSentinel), sentinel)
    assert.equal(await page.evaluate(() => window.__sdkInstances), 1)
    assert.equal(await page.evaluate(() => window.__sdkOptions.cacheLocation), 'memory')
    assert(await page.$('.account-signed-in-dot'), 'The existing authenticated account must remain available')
    const location = new URL(page.url())
    assert.equal(location.searchParams.get('ref'), ref)
    assert.equal(new URLSearchParams(location.hash.slice(1)).get('access'), proof)
    assert.equal(await page.evaluate(ref => sessionStorage.getItem('booking-access:' + ref), ref), proof)
    assert(writes.some(item => item.path === '/api/booking/status'))
    pass('real four-step confirmation keeps the document, singleton SDK and memory-only signed-in session')
    pass('confirmation preserves the exact reference/private fragment and loads its token-protected receipt')
    await page.screenshot({ path: directory + '/confirmation-desktop.png', fullPage: true })
    await page.setViewport({ width: 390, height: 844 })
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.screenshot({ path: directory + '/confirmation-mobile.png', fullPage: true })
    await page.click('.booking-account-access a')
    await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Your evenings.' && [...document.querySelectorAll('button')].some(node => node.textContent === 'Link this booking'))
    assert.equal(documents.length, beforeDocuments)
    assert.equal(await page.evaluate(() => window.__handoffSentinel), sentinel)
    assert.equal(await page.evaluate(() => window.__sdkInstances), 1)
    assert.equal(new URL(page.url()).searchParams.get('ref'), ref)
    assert.equal(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('access'), proof)
    assert.equal(writes.filter(item => item.path === '/api/spa/customer/claim').length, 0)
    pass('the confirmation account handoff keeps auth and proof through the dashboard without auto-claiming')
  } else {
    await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Native destination fixture')
    assert.equal(documents.length, beforeDocuments + 1)
    assert.equal(await page.evaluate(() => window.__handoffSentinel), undefined)
    pass(name === 'external' ? 'an external provider destination retains native navigation (intercepted local fixture, no Stripe call)' : 'a same-origin destination outside the canonical confirmation route is not silently routed as an SPA confirmation')
  }
  await page.close()
}

await fs.mkdir(directory, { recursive: true })
try {
  if (!process.env.CHECK_BASE_URL) server = await serve(port)
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
  await scenario('confirmation', base + '/book/done/?ref=' + ref + '#access=' + proof)
  await scenario('external', 'https://checkout.stripe.com/c/pay/cs_test_local_fixture#access=' + proof)
  await scenario('wrong-path', base + '/local-wrong-destination/?ref=' + ref + '#access=' + proof)
  assert.deepEqual(routeErrors, [])
  assert.deepEqual(errors, [])
  assert.deepEqual(blockedExternal, [])
  pass('every API/provider boundary is intercepted; no uncaught browser errors or outside network requests')
  await fs.writeFile(directory + '/results.json', JSON.stringify({ scope: 'Built local application with fictional SDK/API boundaries. No live authentication, booking, email or payment acceptance claimed. External fallback cases intentionally supply unusual successful response destinations to exercise native navigation.', checks, errors, routeErrors, blockedExternal }, null, 2))
} finally {
  if (browser) await browser.close()
  if (server) await new Promise(resolve => server.close(resolve))
}
