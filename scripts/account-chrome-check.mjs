import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import puppeteer from 'puppeteer-core'
import { serve } from './serve.mjs'

const directory = await mkdtemp(join(tmpdir(), 'sergio-account-'))
const require = createRequire(import.meta.url)
const port = Number(process.env.ACCOUNT_CHECK_PORT) || 4418
const origin = process.env.CHECK_BASE_URL || `http://localhost:${port}`
let browser, server, passed = 0
const check = async (name, run) => { await run(); passed++; console.log(`✓ ${name}`) }
try {
  const fixture = join(directory, 'account.cjs')
  await build({ stdin: { contents: `import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {AccountContext,AccountMenu,FooterAccount,BookingAccountAccess} from './src/components/AccountAccess';export {readAccountSummary} from './src/components/AccountAccess';export * from './src/content/account';export {safeReturnTo,accountReturnHref} from './src/account/config';export function render(state){return renderToStaticMarkup(React.createElement(AccountContext.Provider,{value:{state,refresh(){}}},React.createElement(React.Fragment,null,React.createElement(AccountMenu,{navigationOpen:false,onOpen(){}}),React.createElement(FooterAccount),React.createElement(BookingAccountAccess))))}`, resolveDir: process.cwd() }, outfile: fixture, bundle: true, format: 'cjs', platform: 'node', target: 'es2022', define: { 'import.meta.env': '{}' }, loader: { '.css': 'empty' }, logLevel: 'silent' })
  const { accountHref, safeReturnTo, accountReturnHref, readAccountSummary, render } = require(fixture)
  await check('all account destinations are local static Pages routes', async () => {
    for (const destination of ['bookings','admin','signIn','signOut','createAccount','verifyEmail']) { const path = accountHref(destination); assert(path.startsWith('/') && !path.startsWith('//')); assert(path.endsWith('/')) }
  })
  await check('local return paths retain fragments without moving private proof into query strings', async () => {
    const proof = 'a'.repeat(43), target = '/dashboard/?ref=CS-check#access=' + proof
    const link = new URL(accountReturnHref('/account/sign-in/', target), origin)
    assert.equal(link.searchParams.get('returnTo'), '/dashboard/?ref=CS-check'); assert.equal(link.hash, '#access=' + proof); assert(!link.search.includes(proof)); assert.equal(safeReturnTo(target), target)
    for (const unsafe of ['https://attacker.test/','//attacker.test/','/%2f/attacker.test/','/\\attacker.test/','/missing/','/auth/callback/?code=x','/auth/logout/']) assert.equal(safeReturnTo(unsafe), '/dashboard/')
  })
  await check('status retains only the four public fields and never grants an anonymous admin display', async () => {
    const summary = readAccountSummary({ authenticated: true, displayName: 'Fixture guest', emailVerified: true, isAdmin: false, email: 'private@example.invalid', csrfToken: 'private-fixture', accessToken: 'private-fixture' })
    assert.deepEqual(Object.keys(summary).sort(), ['authenticated', 'displayName', 'emailVerified', 'isAdmin'])
    assert.equal(readAccountSummary({ authenticated: false, displayName: 'Ignored', emailVerified: true, isAdmin: true }).isAdmin, false)
    assert.equal(readAccountSummary({ authenticated: 'true' }), null)
  })
  await check('unknown, signed-in, admin and unavailable views expose only their actual account actions', async () => {
    const unknown = render({ kind: 'unknown' }), unavailable = render({ kind: 'unavailable' })
    for (const html of [unknown, unavailable]) { assert(html.includes(accountHref('bookings'))); assert(html.includes(accountHref('signIn'))); assert(html.includes(accountHref('createAccount'))); assert(!html.includes('Admin dashboard')); assert(html.includes(accountHref('signOut'))) }
    const customer = render({ kind: 'ready', value: { authenticated: true, displayName: '<Fixture>', emailVerified: true, isAdmin: false } })
    assert(customer.includes('&lt;Fixture&gt;')); assert(customer.includes(accountHref('signOut'))); assert(!customer.includes(accountHref('signIn'))); assert(!customer.includes('Admin dashboard'))
    const admin = render({ kind: 'ready', value: { authenticated: true, displayName: 'Fixture owner', emailVerified: true, isAdmin: true } })
    assert(admin.includes('Admin dashboard')); assert(admin.includes(accountHref('admin')))
    const unverified = render({ kind: 'ready', value: { authenticated: true, displayName: 'Fixture guest', emailVerified: false, isAdmin: false } })
    assert(unverified.includes(accountHref('verifyEmail'))); assert(unverified.includes('Verify my email')); assert(unverified.includes(accountHref('signOut')))
    assert(!customer.includes('private-fixture'))
    assert(!accountHref('bookings').includes('#')); assert(!accountHref('bookings').includes('?'))
  })
  if (!process.env.CHECK_BASE_URL) server = await serve(port)
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-sandbox'] })
  const page = await browser.newPage(), statusRequests = [], errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('/api/auth/status')) statusRequests.push(request.url()) })
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  await page.goto(origin + '/', { waitUntil: 'networkidle0' })
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  // My account is a plain link: the dashboard handles signed-out visitors by sending them through sign-in and back.
  const until = async (predicate, ms = 15000) => { for (const end = Date.now() + ms; Date.now() < end; await new Promise(resolve => setTimeout(resolve, 100))) { try { if (await predicate()) return } catch { /* Navigating. */ } } throw new Error('Timed out waiting for the account destination') }
  await check('My account is a direct dashboard link that fits desktop, intermediate and narrow mobile viewports', async () => {
    for (const width of [1440, 1200, 1080, 960, 800, 700, 390, 320]) {
      await page.setViewport({ width, height: 900 }); await settle()
      const layout = await page.$eval('.account-access-trigger', element => { const box = element.getBoundingClientRect(); return { tag: element.tagName, href: element.getAttribute('href'), expanded: element.getAttribute('aria-expanded'), width: box.width, height: box.height, left: box.left, right: box.right, pageWidth: document.documentElement.scrollWidth, viewport: innerWidth } })
      assert.equal(layout.tag, 'A'); assert.equal(layout.href, '/dashboard/'); assert.equal(layout.expanded, null, 'No disclosure state on a link')
      assert(layout.width >= 44 && layout.height >= 44, `Account target too small at ${width}: ${JSON.stringify(layout)}`)
      assert(layout.left >= 0 && layout.right <= width, `Account target overflow at ${width}`)
      assert(layout.pageWidth <= layout.viewport + 1, `Horizontal overflow at ${width}`)
    }
    assert.equal(await page.$('.account-access-panel'), null, 'The header has no account dropdown')
  })
  await check('opening My account while signed out goes through sign-in and returns to the dashboard', async () => {
    await page.setViewport({ width: 1440, height: 900 }); await settle()
    await page.focus('.account-access-trigger'); await page.keyboard.press('Enter')
    await until(() => new URL(page.url()).pathname === '/account/sign-in/')
    assert.equal(new URL(page.url()).searchParams.get('returnTo'), '/dashboard/')
    await page.goto(origin + '/', { waitUntil: 'networkidle0' }); await settle()
  })
  await check('footer offers the same dashboard destination with sign-in, and cross-site status requests stay disabled', async () => {
    const header = await page.$eval('.account-access-trigger', link => link.href)
    const footer = await page.$$eval('.footer-account nav a', links => links.map(link => ({ text: link.textContent.trim(), href: link.href })))
    assert(footer.some(link => link.text === 'Your evenings' && link.href === header), JSON.stringify({ header, footer }))
    assert(footer.some(link => link.text === 'Sign in')); assert.equal(statusRequests.length, 0); assert.deepEqual(errors, [])
    await fs.mkdir('output/account-chrome', { recursive: true })
    await page.setViewport({ width: 1440, height: 960 }); await page.screenshot({ path: 'output/account-chrome/desktop.png' })
    await page.setViewport({ width: 390, height: 844 }); await settle(); await page.screenshot({ path: 'output/account-chrome/mobile-account.png' })
    await page.$eval('.footer-account', element => element.scrollIntoView({ block: 'center' })); await settle(); await page.screenshot({ path: 'output/account-chrome/mobile-footer.png' })
  })
  await check('request handoff keeps proof in the local fragment and waits for an explicit verified claim', async () => {
    const proof = 'f'.repeat(43), reference = 'WEB-account-fixture'
    await page.setRequestInterception(true)
    page.on('request', request => {
      const url = new URL(request.url())
      if (url.origin === origin) return void request.continue()
      const headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,X-Booking-Request' }
      if (request.method() === 'OPTIONS') return void request.respond({ status: 204, headers })
      if (url.pathname === '/api/booking/status') return void request.respond({ status: 200, contentType: 'application/json', headers, body: JSON.stringify({ ref: reference, kind: 'dinner', status: 'requested', date: '2027-06-20', time: '18:00', guests: 4 }) })
      if (url.pathname === '/api/planning-config') return void request.respond({ status: 200, contentType: 'application/json', headers, body: JSON.stringify({ paymentReady: false, partyBands: [{ id: 'small', label: '2–4 guests', min: 2, max: 4, deposit: null }], maxGuests: 12, interviewSlots: [] }) })
      return void request.abort()
    })
    await page.goto(`${origin}/book/done/?ref=${reference}#access=${proof}`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('.booking-account-access')
    const destination = await page.$eval('.booking-account-access a', link => link.href)
    const target = new URL(destination)
    assert.equal(target.origin, origin); assert.equal(target.pathname, '/dashboard/'); assert.equal(target.searchParams.get('ref'), reference)
    assert.equal(target.hash, '#access=' + proof); assert(!target.search.includes(proof))
    assert.equal(await page.$$eval('.account-access-panel a,.footer-account a', (links, proof) => links.some(link => link.href.includes(proof)), proof), false, 'Generic navigation must not carry private booking proof.')
    assert.equal(await page.evaluate(value => Object.values(localStorage).some(item => item.includes(value)), proof), false)
    await page.$eval('.booking-account-access', element => element.scrollIntoView({ block: 'center' })); await settle(); await page.screenshot({ path: 'output/account-chrome/mobile-booking-status.png' })
    let claims = 0
    page.on('request', request => { if (request.url().includes('/customer/claim')) claims++ })
    await page.click('.booking-account-access a')
    // Signed out, the dashboard sends the visitor straight to sign-in, carrying the exact claim target.
    await until(() => new URL(page.url()).pathname === '/account/sign-in/')
    const signIn = new URL(page.url())
    assert.equal(signIn.searchParams.get('returnTo'), '/dashboard/?ref=' + reference); assert.equal(signIn.hash, '#access=' + proof); assert(!signIn.search.includes(proof)); assert.equal(claims, 0)
  })
  console.log(`${passed} account chrome checks passed. Authenticated states used fictional fixtures; no real sign-in or booking requests were submitted.`)
} finally {
  await browser?.close(); await new Promise(resolve => server ? server.close(resolve) : resolve()); await rm(directory, { recursive: true, force: true })
}
