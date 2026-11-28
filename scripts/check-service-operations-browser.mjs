#!/usr/bin/env node
// Actual App/AdminProvider, actual dashboard CSS, fictional read-only API evidence.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import puppeteer from 'puppeteer-core'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = resolve(root, process.env.OPERATIONS_SHOTS_DIR || 'output/connection-completion/service-operations-browser')
const checks = [], failures = [], pageErrors = [], boundaryErrors = [], reads = [], forbiddenWrites = []
const sourcePaths = ['admin/src/App.tsx', 'admin/src/ServiceOperations.tsx', 'admin/src/ServiceOperations.css', 'admin/src/service-operations-types.ts', 'admin/src/Communications.tsx', 'admin/src/Billing.tsx', 'admin/src/Newsletter.tsx', 'admin/src/PrivacyRequests.tsx', 'admin/src/PrivacyExternalRequests.tsx']
const hash = value => createHash('sha256').update(value).digest('hex')
const sourceHashes = async () => Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, hash(await readFile(resolve(root, path)))])))
const beforeSourceHashes = await sourceHashes()
const definitions = { __SITE_MODE__: '"prototype"', __LOOK__: '"c"', __PLATING_SEQUENCE_AVAILABLE__: 'false', 'import.meta.env.BASE_URL': '"/"', 'import.meta.env.VITE_AUTH0_SPA_CLIENT_ID': '""' }
async function moduleAt(path) {
  const result = await build({ absWorkingDir: root, entryPoints: [path], write: false, bundle: true, platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent', define: definitions })
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'))
}
const { seedState } = await moduleAt('admin/src/model.ts')
const { SERVICE_IDS, JOB_KEYS, isOperationsResponse } = await moduleAt('admin/src/service-operations-types.ts')
const at = '2026-11-27T23:00:00Z'
const ids = { booking: 'fixture-booking-1', bill: 'bill-fixture-1', message: 'msg_fixture_1', subscriber: 'sub_fixture_1', campaign: 'campaign_fixture_1', privacy: 'pr_' + 'a'.repeat(32), external: 'extcase_' + 'b'.repeat(32) }
const targets = {
  message: { section: 'communications', recordId: ids.message, bookingId: ids.booking },
  bill: { section: 'payments', bookingId: ids.booking, filter: 'review' },
  booking: { section: 'bookings', bookingId: ids.booking },
  subscriber: { section: 'newsletter', view: 'subscribers', recordId: ids.subscriber },
  campaign: { section: 'newsletter', view: 'history', recordId: ids.campaign },
  privacy: { section: 'privacy', recordId: ids.privacy },
  external: { section: 'privacy', view: 'external', recordId: ids.external },
}
const titles = { message: 'Review the saved guest email', bill: 'Review this booking’s refund balance', booking: 'Review the original booking', subscriber: 'Review this subscriber’s sync', campaign: 'Review this campaign’s uncertain result', privacy: 'Review this account request', external: 'Review this external request' }
const serviceNames = { identity: 'Account sign-in', payments: 'Card payments', email: 'Guest email', newsletter: 'Seasonal letter', gifts: 'Gift cards', booking: 'Public bookings', publishing: 'Website publishing', calendar: 'Google Calendar' }
const standardReport = {
  version: 1, checkedAt: at,
  services: SERVICE_IDS.map((id, index) => ({ id, label: serviceNames[id], status: ['ready', 'limited', 'ready', 'limited', 'blocked', 'ready', 'not_connected', 'unknown'][index], summary: id === 'gifts' ? 'Gift accounting exists; recipient delivery is unavailable in this fixture.' : `Fictional ${serviceNames[id].toLowerCase()} setup evidence.`, reasons: id === 'gifts' ? ['Recipient delivery needs its own supported connection.'] : [], owner: 'Sergio and the site operator', target: id === 'email' ? { section: 'communications' } : id === 'payments' ? { section: 'calendar', view: 'booking-setup' } : id === 'newsletter' ? { section: 'newsletter' } : null })),
  jobs: JOB_KEYS.map((key, index) => ({ key, label: key.replaceAll('_', ' ').replace(/^./, value => value.toUpperCase()), kind: index < 2 || key.startsWith('privacy') ? 'job' : 'probe', status: index === 1 ? 'failed' : index === 11 ? 'never_recorded' : index === 12 ? 'unknown' : 'healthy', enabled: true, lastRun: index >= 11 ? null : { id: 'fixture-run-' + index, startedAt: '2026-11-27T22:40:00Z', finishedAt: '2026-11-27T22:40:05Z', outcome: index === 1 ? 'failed' : 'succeeded', summary: index === 1 ? 'The fixture subscriber sync needs review. No send was attempted.' : 'This fictional run saved its own completion evidence; it does not prove delivery.' }, nextExpectedAt: '2026-11-27T23:15:00Z', target: index === 1 ? { section: 'newsletter', view: 'subscribers' } : null })),
  attention: Object.entries(targets).map(([key, target], index) => ({ id: 'fixture-attention-' + key, area: ['email', 'payments', 'configuration', 'newsletter', 'newsletter', 'privacy', 'privacy'][index], severity: index % 2 ? 'warning' : 'error', title: titles[key], summary: 'Fictional record for navigation checks. Open it to inspect the exact saved result.', at, target })),
  limits: { maxAttention: 100, maxRunsPerJob: 1, truncated: false, historyAvailable: true },
}
assert(isOperationsResponse(standardReport), 'The main browser fixture must satisfy the real response validator.')
const state = seedState()
const booking = { ...state.bookings[0], id: ids.booking, guest: 'Operations Fixture Host', email: 'operations-fixture@example.test', date: '2099-01-15', status: 'requested', notes: 'Fictional navigation record; no customer action.' }
state.bookings = [booking]
state.nights = []; state.blocks = []; state.activity = []
state.operations = { details: {}, sessions: {}, billing: [{ ...state.operations.billing[0], id: ids.bill, bookingId: ids.booking, customer: booking.guest, invoiceNumber: 'INV-OPS-FIXTURE', eventDate: booking.date, refundReview: true }] }
const envelope = { state, revision: 1, user: { id: 'fixture-admin', name: 'Sergio Demo', email: 'operator-fixture@example.test' }, businessDate: '2026-11-27', capabilities: { cardPayments: false, publicBooking: true, websitePublishing: false }, updatedAt: at }
const message = { id: ids.message, bookingId: ids.booking, kind: 'request_received', status: 'failed', recipientEmail: booking.email, recipientName: booking.guest, subject: 'Exact operations message fixture', createdAt: at, updatedAt: at, attempts: 1, sentAt: null, deliveredAt: null, lastError: 'Fictional sender-recovery issue', receiptId: null, parentId: null }
const communications = { configuration: { mode: 'preview', ready: false, canSend: false, canTest: false, from: '', replyTo: '', testRecipient: '', missing: [] }, messages: [], bookings: [{ id: ids.booking, guest: booking.guest, email: booking.email, status: booking.status }], kinds: [{ kind: 'request_received', label: 'Request received' }] }
const subscriber = { id: ids.subscriber, email: 'subscriber-fixture@example.test', name: 'Exact Subscriber Fixture', status: 'confirmed', requestedAt: at, confirmedAt: at, unsubscribedAt: null, synced: false, syncError: 'Fictional sync review needed' }
const campaign = { id: ids.campaign, subject: 'Exact campaign fixture', status: 'needs_review', createdAt: at, updatedAt: at, audienceCount: 1, providerBroadcastId: null, lastError: 'Fictional uncertain provider result' }
const newsletter = { revision: 1, settings: { senderName: 'Sergio Fixture', replyTo: 'reply-fixture@example.test', postalAddress: 'Fictional address for interface checks' }, draft: { subject: 'Fixture seasonal letter', previewText: 'Local navigation fixture', body: 'A fictional saved letter. No send is permitted.' }, readiness: { mode: 'preview', canSubscribe: false, canTest: false, canSend: false, missing: [] }, subscribers: { pending: 0, confirmed: 0, unsubscribed: 0, eligible: 0, items: [] }, history: [], preview: { subject: 'Fixture seasonal letter', html: '<!doctype html><p>Fictional letter preview.</p>', text: 'Fictional letter preview.' }, assets: [] }
const privacy = { id: ids.privacy, subject: 'auth0|fictional-navigation-user', email: 'privacy-fixture@example.test', name: 'Exact Account Request Fixture', kind: 'account_closure', signInAction: null, status: 'in_review', revision: 2, message: 'Fictional account request for navigation only.', responseNote: '', retainedRecordsNote: '', fulfillmentEvidence: '', createdAt: at, updatedAt: at, responseDueAt: '2026-12-27T23:00:00Z', exportAvailable: false, history: [] }
const external = { id: ids.external, principal: 'external_' + 'c'.repeat(32), principalKind: 'external_case', name: 'Exact External Case Fixture', email: 'external-fixture@example.test', kind: 'rectification', status: 'pending_identity', revision: 1, receivedAt: at, responseDueAt: '2026-12-27T23:00:00Z', message: 'Fictional external request for navigation only.', receiptEvidence: 'Local fixture; no actual received request exists.' }
let mode = 'standard', operationsReads = 0, bundle, css, browser, server, origin
const screenshots = []
const clone = value => structuredClone(value)
function reportForMode() {
  const report = clone(standardReport)
  if (mode === 'unknown' || mode === 'history-unavailable') {
    report.jobs = report.jobs.map(job => ({ ...job, status: 'unknown', lastRun: null, nextExpectedAt: null }))
    report.limits.historyAvailable = false
    if (mode === 'unknown') report.services = report.services.map(service => ({ ...service, status: 'unknown', summary: 'This setup has not been verified.', reasons: ['No current connection evidence is available.'] }))
  }
  if (mode === 'empty') report.attention = []
  if (mode === 'malformed') report.services.pop()
  if (mode === 'contradictory') report.jobs[0].lastRun = null
  return report
}

await mkdir(output, { recursive: true })
try {
  server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, origin || 'http://127.0.0.1')
      if (url.pathname === '/fixture.js' || url.pathname === '/fixture.css') {
        response.writeHead(200, { 'Content-Type': url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript' }); return response.end(url.pathname.endsWith('.css') ? css : bundle)
      }
      if (url.pathname.startsWith('/fonts/') || url.pathname.startsWith('/brand/')) {
        const file = resolve(root, 'public', '.' + url.pathname)
        if (!file.startsWith(resolve(root, 'public') + '/')) throw Error('Unsafe fixture asset path')
        try { const contents = await readFile(file); response.writeHead(200, { 'Content-Type': extname(file) === '.svg' ? 'image/svg+xml' : 'font/woff2' }); return response.end(contents) }
        catch { response.writeHead(404); return response.end() }
      }
      if (!url.pathname.startsWith('/api/')) {
        response.writeHead(200, { 'Content-Type': 'text/html' }); return response.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/fixture.css"><title>Local Service operations fixture</title></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>')
      }
      if (request.method !== 'GET') {
        forbiddenWrites.push({ method: request.method, path: url.pathname }); response.writeHead(405, { 'Content-Type': 'application/json' }); return response.end(JSON.stringify({ error: { message: 'Writes are prohibited by the local browser fixture.' } }))
      }
      reads.push(url.pathname + url.search)
      let value, status = 200
      if (url.pathname === '/api/workspace') value = envelope
      else if (url.pathname === '/api/operations') {
        operationsReads++
        if (mode === 'error' || mode === 'unauthorized') { status = mode === 'error' ? 503 : 403; value = { error: { message: 'Fictional unavailable report' } } }
        else value = reportForMode()
      } else if (url.pathname === '/api/communications') value = { ...communications, messages: url.searchParams.get('id') === ids.message ? [message] : [] }
      else if (url.pathname === '/api/communications/preview') value = { id: ids.message, subject: message.subject, html: '<!doctype html><p>Exact saved message fixture. No email is sent.</p>', text: 'Exact saved message fixture. No email is sent.', receiptId: null, sample: false }
      else if (url.pathname === '/api/newsletters') {
        value = clone(newsletter)
        if (url.searchParams.get('recordId') === ids.subscriber) value.subscribers = { ...value.subscribers, confirmed: 1, items: [subscriber] }
        if (url.searchParams.get('recordId') === ids.campaign) value.history = [campaign]
      } else if (url.pathname === '/api/customer-privacy') value = { requests: url.searchParams.get('id') === ids.privacy ? [privacy] : [], pagination: { offset: 0, limit: 25, hasMore: false } }
      else if (url.pathname === '/api/privacy-controls') value = { id: ids.privacy, revision: 2, controls: { restricted: false, marketingObjected: false, accountClosed: false, erasureRequested: false, sensitiveWithdrawn: false, addressMarketingBlocked: false, addressSensitiveWithdrawn: false }, holds: [] }
      else if (url.pathname === '/api/privacy-external') value = url.searchParams.get('id') === ids.external ? { case: external } : { cases: [], pagination: { offset: 0, limit: 25, hasMore: false } }
      else { status = 599; value = { error: { message: 'Unexpected fixture read: ' + url.pathname } }; boundaryErrors.push(url.pathname + url.search) }
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value))
    } catch (error) { boundaryErrors.push(error.message); response.writeHead(599); response.end() }
  })
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen) })
  origin = 'http://127.0.0.1:' + server.address().port
  const built = await build({ absWorkingDir: root, stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import App from './admin/src/App';import{AdminProvider}from'./admin/src/store';import './admin/src/styles.css';import './admin/src/Kiosk.css';import './admin/src/DashboardChrome.css';createRoot(document.getElementById('root')).render(<AdminProvider><App/></AdminProvider>);`, resolveDir: root, loader: 'tsx' }, outfile: resolve(output, 'fixture.js'), write: false, bundle: true, platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent', define: definitions, external: ['/fonts/*', '/brand/*'] })
  bundle = built.outputFiles.find(file => file.path.endsWith('.js')).text
  css = built.outputFiles.find(file => file.path.endsWith('.css')).text
  await writeFile(resolve(output, 'fixture-contract.json'), JSON.stringify({ scope: 'Fictional credential-free read-only browser fixture', ids, envelope, report: standardReport, targetRecordsOmittedFromInitialLists: true }, null, 2))
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
  const page = await browser.newPage()
  page.setDefaultTimeout(8000)
  await page.setViewport({ width: 1440, height: 1000 })
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.setRequestInterception(true)
  page.on('request', request => {
    const url = new URL(request.url())
    if (url.origin === origin || ['data:', 'blob:', 'about:'].includes(url.protocol)) return request.continue()
    boundaryErrors.push('Blocked external request: ' + url.origin + url.pathname); return request.abort()
  })
  async function screenshot(name) {
    // Fixed workspace windows scroll internally. A full-page phone capture would
    // invent a tall screen and expose background below the actual viewport.
    const path = resolve(output, name + '.png'); await page.screenshot({ path, fullPage: false }); screenshots.push(path)
  }
  async function test(name, work) {
    try { await work(); checks.push(name); console.log('PASS ' + name) }
    catch (error) { failures.push({ name, message: error.message, url: page.url() }); console.log('FAIL ' + name + ': ' + error.message); await screenshot('failure-' + (failures.length)); await writeFile(resolve(output, 'failure-' + failures.length + '.txt'), await page.$eval('body', node => node.innerText).catch(() => 'Unavailable DOM')) }
  }
  let fixturePage = 0
  async function openOperations(nextMode = 'standard') {
    mode = nextMode
    // Hash-only navigation does not remount App or refetch the report. Each fixture state
    // starts a real new document so earlier evidence cannot mask an error/unknown case.
    await page.goto(origin + '/admin/?fixture=' + (++fixturePage) + '#operations', { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.service-operations')
    await page.waitForFunction(() => document.querySelector('.operations-panel')?.getAttribute('aria-busy') === 'false' && (document.querySelector('.operations-checked')?.textContent.startsWith('Checked') || !!document.querySelector('.operations-notice.is-error')))
  }
  async function tab(label) {
    const handle = await page.waitForFunction(label => [...document.querySelectorAll('.operations-tabs [role=tab]')].find(node => node.textContent.startsWith(label)), {}, label)
    await handle.asElement().click(); await handle.dispose()
    await page.waitForFunction(label => document.querySelector('.operations-tabs [aria-selected=true]')?.textContent.startsWith(label), {}, label)
  }
  async function attentionLink(key) {
    await openOperations(); await tab('Needs attention')
    const button = await page.waitForFunction(title => [...document.querySelectorAll('.operations-attention-group li')].find(node => node.querySelector('h4')?.textContent === title)?.querySelector('button'), {}, titles[key])
    await button.asElement().click(); await button.dispose()
  }
  async function exactTarget(key) {
    if (key === 'message') { await page.waitForSelector('.communications-message-body'); await page.waitForFunction(subject => [...document.querySelectorAll('.communications-envelope dd')].some(node => node.textContent === subject), {}, message.subject) }
    else if (key === 'bill') { await page.waitForSelector('.billing-record-workspace'); assert.match(await page.$eval('.billing-record-workspace', node => node.textContent), /INV-OPS-FIXTURE/) }
    else if (key === 'booking') { await page.waitForSelector('.booking-detail-columns'); assert.equal(await page.$eval('[aria-modal=true] .modal-header h2', node => node.textContent), booking.guest) }
    else if (key === 'subscriber' || key === 'campaign') await page.waitForSelector('#newsletter-record-' + ids[key])
    else if (key === 'privacy') { await page.waitForSelector('#privacy-review-heading'); assert.match(await page.$eval('#privacy-review-heading', node => node.textContent), /Exact Account Request Fixture/) }
    else if (key === 'external') { await page.waitForSelector('#external-privacy-case-heading'); assert.match(await page.$eval('#external-privacy-case-heading', node => node.textContent), /Exact External Case Fixture/) }
  }
  async function noOverflow() {
    const layout = await page.evaluate(() => {
      const frame = document.querySelector('[aria-modal=true]')
      const content = frame?.querySelector('.workspace-window-content')
      const service = document.querySelector('.service-operations')
      return { viewport: innerWidth, document: document.documentElement.scrollWidth, frame: frame ? [frame.clientWidth, frame.scrollWidth] : null, content: content ? [content.clientWidth, content.scrollWidth] : null, service: service ? [service.clientWidth, service.scrollWidth] : null }
    })
    assert(layout.document <= layout.viewport + 1, JSON.stringify(layout))
    for (const value of [layout.frame, layout.content, layout.service].filter(Boolean)) assert(value[1] <= value[0] + 1, JSON.stringify(layout))
  }

  await test('actual dashboard Connections displays all eight statuses without equating readiness to delivery', async () => {
    await openOperations(); assert.equal(await page.$$eval('.operations-service', nodes => nodes.length), 8)
    assert.match(await page.$eval('.operations-intro', node => node.textContent), /not proof/)
    assert.equal(await page.$eval('.service-operations', node => getComputedStyle(node).fontFamily), 'Archivo, Arial, sans-serif')
    await page.evaluate(() => document.fonts.ready)
    await noOverflow(); await screenshot('01-connections-desktop')
  })
  await test('keyboard tabs support arrows, Home and End with one selected focusable tab', async () => {
    await openOperations(); await page.focus('.operations-tabs [aria-selected=true]')
    for (const [key, label] of [['ArrowRight', 'Background work'], ['End', 'Needs attention'], ['Home', 'Connections'], ['ArrowLeft', 'Needs attention']]) {
      await page.keyboard.press(key)
      assert((await page.evaluate(() => document.activeElement?.textContent)).startsWith(label))
      assert.equal(await page.$$eval('.operations-tabs [tabindex="0"]', nodes => nodes.length), 1)
      assert((await page.$eval('.operations-tabs [aria-selected=true]', node => node.textContent)).startsWith(label))
    }
  })
  await test('Background work shows real saved run evidence separately from missing history', async () => {
    await openOperations(); await tab('Background work')
    assert.equal(await page.$$eval('.operations-job', nodes => nodes.length), 13)
    await page.click('.operations-run-evidence summary')
    assert.match(await page.$eval('.operations-run-evidence[open]', node => node.textContent), /fixture-run-0/)
    assert(await page.$('.operations-no-evidence'))
    await screenshot('02-background-desktop')
  })
  await test('Needs attention groups the seven exact record handoffs', async () => {
    await openOperations(); await tab('Needs attention')
    assert.equal(await page.$$eval('.operations-attention-group li', nodes => nodes.length), 7)
    assert.match(await page.$eval('.operations-intro', node => node.textContent), /does not retry payments/)
    await screenshot('03-attention-desktop')
  })
  for (const key of Object.keys(targets)) await test('attention opens exact ' + key + ' record, including bounded-list fallback', async () => {
    const first = reads.length; await attentionLink(key); await exactTarget(key)
    if (key === 'message') assert(reads.slice(first).some(path => path.includes('/api/communications?id=' + ids.message)))
    if (key === 'subscriber' || key === 'campaign') assert(reads.slice(first).some(path => path.includes('/api/newsletters?recordId=' + ids[key])))
    if (key === 'privacy') assert(reads.slice(first).some(path => path === '/api/customer-privacy?id=' + ids.privacy))
    if (key === 'external') assert(reads.slice(first).some(path => path === '/api/privacy-external?id=' + ids.external))
    await screenshot('target-' + key + '-desktop')
  })
  await test('browser Back returns to Needs attention after reviewing a message', async () => {
    await attentionLink('message'); await exactTarget('message'); await page.evaluate(() => history.back())
    await page.waitForSelector('.service-operations')
    assert((await page.$eval('.operations-tabs [aria-selected=true]', node => node.textContent)).startsWith('Needs attention'))
  })
  for (const key of ['message', 'bill', 'subscriber', 'campaign', 'privacy', 'external']) await test('refresh preserves exact ' + key + ' record navigation', async () => {
    await attentionLink(key); await exactTarget(key); await page.reload({ waitUntil: 'domcontentloaded' }); await exactTarget(key)
  })
  await test('empty attention state does not claim every connection or job is healthy', async () => {
    await openOperations('empty'); await tab('Needs attention')
    assert.match(await page.$eval('.operations-empty', node => node.textContent), /No attention items were returned/)
    assert.match(await page.$eval('.operations-empty', node => node.textContent), /missing run evidence/)
    await screenshot('04-empty-attention')
  })
  await test('unknown connection and unavailable history remain explicitly unverified', async () => {
    await openOperations('unknown'); assert.equal(await page.$$eval('.service-unknown', nodes => nodes.length), 8)
    assert.equal(await page.$$eval('.service-ready', nodes => nodes.length), 0)
    await tab('Background work'); assert.match(await page.$eval('.operations-notice', node => node.textContent), /history is unavailable/)
    assert.equal(await page.$$eval('.job-healthy', nodes => nodes.length), 0)
    await screenshot('05-unknown-history')
  })
  await test('malformed and contradictory reports never become green service evidence', async () => {
    for (const value of ['malformed', 'contradictory']) { await openOperations(value); assert(await page.$('.operations-notice.is-error')); assert.equal(await page.$$eval('.operations-service', nodes => nodes.length), 0) }
  })
  await test('initial service failure has explicit recovery, and refresh reads a new report', async () => {
    await openOperations('error'); assert(await page.$('.operations-notice.is-error')); assert.equal(await page.$$eval('.operations-service', nodes => nodes.length), 0)
    mode = 'standard'; await page.click('.operations-heading button'); await page.waitForSelector('.operations-service')
    assert.equal(await page.$$eval('.operations-service', nodes => nodes.length), 8)
  })
  await test('failed refresh labels earlier evidence as stale; authorization loss clears it', async () => {
    await openOperations(); mode = 'error'; await page.click('.operations-heading button'); await page.waitForSelector('.operations-notice.is-error')
    assert.match(await page.$eval('.operations-checked', node => node.textContent), /Earlier report/)
    assert.equal(await page.$$eval('.operations-service', nodes => nodes.length), 8)
    await screenshot('06-stale-report')
    mode = 'unauthorized'; await page.click('.operations-heading button'); await page.waitForFunction(() => document.querySelectorAll('.operations-service').length === 0)
    assert.match(await page.$eval('.operations-notice', node => node.textContent), /approved administrator/)
  })
  await test('phone and narrow phone layouts keep all three views within their viewport', async () => {
    for (const width of [390, 320]) {
      await page.setViewport({ width, height: 844 }); await openOperations()
      for (const [label, file] of [['Connections', 'connections'], ['Background work', 'background'], ['Needs attention', 'attention']]) {
        await tab(label); await noOverflow(); await screenshot(`phone-${width}-${file}`)
        const selector = file === 'connections' ? '.operations-service:last-child' : file === 'background' ? '.operations-job:last-child' : '.operations-attention-group:last-child li:last-child'
        const visible = await page.$eval(selector, node => { node.scrollIntoView({ block: 'end' }); const box = node.getBoundingClientRect(); return { top: box.top, bottom: box.bottom, viewport: innerHeight } })
        assert(visible.bottom <= visible.viewport + 1 && visible.bottom > 0 && visible.top < visible.viewport, JSON.stringify(visible))
        if (width === 390) await screenshot(`phone-${width}-${file}-last-record`)
        await page.$eval('.workspace-window-content', node => { node.scrollTop = 0 })
      }
    }
  })
  await test('phone target handoff opens the saved message with readable real styles', async () => {
    await page.setViewport({ width: 390, height: 844 }); await attentionLink('message'); await exactTarget('message'); await noOverflow(); await screenshot('phone-390-message-target')
  })
  await test('all interactions stayed read-only, with no account profile or external provider used', async () => {
    assert.deepEqual(forbiddenWrites, []); assert.deepEqual(boundaryErrors, []); assert.deepEqual(pageErrors, []); assert(operationsReads >= 1)
  })
} finally {
  if (browser) await browser.close()
  if (server) { server.closeAllConnections(); await new Promise(resolveClose => server.close(resolveClose)) }
  const afterSourceHashes = await sourceHashes()
  const result = { checkedAt: new Date().toISOString(), scope: 'Actual App/AdminProvider/components and real CSS in a local credential-free fixture. Only navigation/GET reads; no live acceptance implied.', screenshotMode: 'Actual viewport; modal content scrolls internally.', checks, failures, pageErrors, boundaryErrors, forbiddenWrites, reads, screenshots, sourceHashes: beforeSourceHashes, sourceChangedDuringRun: Object.keys(beforeSourceHashes).filter(path => beforeSourceHashes[path] !== afterSourceHashes[path]) }
  await writeFile(resolve(output, 'results.json'), JSON.stringify(result, null, 2))
  console.log(`\n${checks.length} checks passed; ${failures.length} failed. Results: ${output}/results.json`)
}
if (failures.length || pageErrors.length || boundaryErrors.length || forbiddenWrites.length) process.exitCode = 1
