#!/usr/bin/env node
// Actual PrepareDetails + booking API, actual Worker + migrations, disposable SQLite.
// Every browser request is intercepted locally. No live account, provider, or database is used.
import assert from 'node:assert/strict'
import { webcrypto, createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { access, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import puppeteer from 'puppeteer-core'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'

if (!globalThis.crypto) globalThis.crypto = webcrypto
const root = fileURLToPath(new URL('../', import.meta.url))
assert(process.env.PREPARE_DETAILS_BACKEND_ROOT, 'Set PREPARE_DETAILS_BACKEND_ROOT to the admin directory containing server/index.ts and drizzle/.')
const backend = resolve(process.env.PREPARE_DETAILS_BACKEND_ROOT)
await access(join(backend, 'server/index.ts'))
const temporary = await mkdtemp(join(tmpdir(), 'sergio-prepare-details-'))
const output = resolve(root, 'output/connection-completion/preparation-consent')
const componentPath = resolve(root, 'src/booking/PrepareDetails.tsx')
const sourcePaths = [componentPath, ...['src/booking/api.ts', 'src/booking/types.ts', 'src/booking/details-result.ts', 'src/privacy/SensitiveDataConsent.tsx', 'src/styles.css', 'src/components/BookingForm.css', 'src/components/QuickBooking.css', 'src/components/CallToAction.css'].map(path => resolve(root, path)), ...['server/public-booking.ts', 'server/booking-detail-outcomes.ts', 'server/schema.ts', 'drizzle/0017_booking_detail_outcomes.sql'].map(path => join(backend, path))]
const sourceHashes = async () => Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, createHash('sha256').update(await readFile(path)).digest('hex')])))
const beforeSourceHashes = await sourceHashes()
const browserOrigin = 'https://preparation.fixture.test', adminOrigin = 'https://operator.fixture.test'
const bridgeSecret = 'preparation-fixture-secret-over-thirty-two-characters'
const checks = [], requests = [], errors = [], forbiddenNetwork = [], dimensions = [], screenshots = []
const originalFetch = globalThis.fetch
globalThis.fetch = async input => { forbiddenNetwork.push(String(input)); throw Error('Provider/network access is prohibited by this local check.') }
const check = async (name, fn) => { await fn(); checks.push(name); console.log('PASS ' + name) }
async function localCss(path) {
  let css = await readFile(path, 'utf8')
  for (const match of [...css.matchAll(/@import\s+['"]([^'"]+)['"];?/g)]) css = css.replace(match[0], await localCss(resolve(dirname(path), match[1])))
  for (const match of [...css.matchAll(/url\(['"]?(\.\.?\/[^'"\s)]+)['"]?\)/g)]) {
    const bytes = await readFile(resolve(dirname(path), match[1]))
    const mime = match[1].endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream'
    css = css.replace(match[0], `url(data:${mime};base64,${bytes.toString('base64')})`)
  }
  return css
}
const sqlPython = `import sqlite3,json,sys
p=json.load(sys.stdin);c=sqlite3.connect(p['file']);c.row_factory=sqlite3.Row
try:
 if p.get('migration'):c.executescript(p['migration']);c.commit();print('[]')
 else:
  c.execute('BEGIN IMMEDIATE');out=[]
  for s in p['statements']:
   before=c.total_changes;q=c.execute(s['sql'],s['args']);rows=[dict(r) for r in q.fetchall()] if q.description else []
   out.append({'results':rows,'meta':{'changes':c.total_changes-before}})
  c.commit();print(json.dumps(out))
except Exception as e:c.rollback();print(json.dumps({'error':str(e)}));sys.exit(1)
finally:c.close()`
class D1 {
  constructor(file) { this.file = file }
  execute(statements, migration) {
    const result = spawnSync('python3', ['-c', sqlPython], { input: JSON.stringify({ file: this.file, statements, migration }), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    if (result.status) throw Error(result.stdout || result.stderr)
    return JSON.parse(result.stdout)
  }
  prepare(sql) {
    const db = this
    return { sql, args: [], bind(...args) { this.args = args; return this }, async first(column) { const row = db.execute([{ sql, args: this.args }])[0].results[0]; return column ? row?.[column] ?? null : row ?? null }, async all() { return db.execute([{ sql, args: this.args }])[0] }, async run() { return db.execute([{ sql, args: this.args }])[0] } }
  }
  async batch(statements) { return this.execute(statements.map(({ sql, args }) => ({ sql, args }))) }
}

let browser
try {
  const bundlePath = join(temporary, 'worker.mjs')
  await build({ absWorkingDir: backend, stdin: { contents: "export {default as worker} from './server/index.ts';export {SENSITIVE_CONSENT_VERSION} from './server/privacy-consent.ts'", resolveDir: backend }, outfile: bundlePath, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'silent' })
  const { worker, SENSITIVE_CONSENT_VERSION } = await import(pathToFileURL(bundlePath))
  const DB = new D1(join(temporary, 'preparation.sqlite'))
  const migrations = (await readdir(join(backend, 'drizzle'))).filter(name => name.endsWith('.sql')).sort()
  for (const migration of migrations) DB.execute([], await readFile(join(backend, 'drizzle', migration), 'utf8'))
  const identity = { 'oai-authenticated-user-id': 'preparation-fixture', 'oai-authenticated-user-email': 'operator@example.test' }
  const env = { DB, ADMIN_EMAILS: identity['oai-authenticated-user-email'], BOOKING_BRIDGE_SECRET: bridgeSecret, PUBLIC_BOOKING_ORIGIN: browserOrigin, PUBLIC_SITE_ORIGIN: browserOrigin, EMAIL_MODE: 'preview', ASSETS: { fetch: async () => new Response('Local fixture') } }
  const call = async (path, body, headers = identity) => {
    const response = await worker.fetch(new Request(adminOrigin + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env)
    return { status: response.status, data: await response.json() }
  }
  const bridge = body => call('/api/booking-bridge/v1', body, { 'X-Booking-Bridge': bridgeSecret })
  const workspace = async () => { const result = await call('/api/workspace'); assert.equal(result.status, 200); return result.data }
  const seed = async change => {
    const current = await workspace()
    change(current.state.bookings.find(item => item.id === ref), current.state)
    await DB.prepare('UPDATE admin_workspace SET state_json=?, revision=revision+1 WHERE id=?').bind(JSON.stringify(current.state), 'main').run()
  }
  await workspace()
  const consent = granted => ({ version: SENSITIVE_CONSENT_VERSION, granted, scope: 'self' })
  const created = await bridge({ operation: 'submit', requestId: crypto.randomUUID(), visitorKey: 'c'.repeat(64), honeypot: '', request: { kind: 'dinner', where: 'home', place: '', occasion: '', dietary: ['Vegetarian'], allergies: 'Peanut', sensitiveDataConsent: consent(true), notes: '', name: 'Preparation fixture', email: 'preparation@example.test', phone: '', contactBy: 'email', planning: { dateMode: 'undecided', partyBandId: 'small', headcount: null, kitchen: '', budgetMode: 'guidance', budgetMin: null, budgetMax: null, budgetUnit: 'total', foodIdeas: '', allergies: 'Peanut', physicalInvitations: false } } })
  assert.equal(created.status, 200, JSON.stringify(created.data))
  const { ref, accessToken } = created.data
  const health = data => {
    const booking = data.state.bookings.find(item => item.id === ref)
    return { dietary: booking.dietary, originalAllergies: booking.planning.original.allergies, topic: booking.planning.topics.find(item => item.id === 'dietary'), operations: data.state.operations.details[ref].dietary }
  }
  const initialHealth = health(await workspace())
  assert.match(initialHealth.dietary, /Peanut/)
  assert.equal(initialHealth.originalAllergies, 'Peanut')

  const tailwindConfig = (await import(pathToFileURL(resolve(root, 'tailwind.config.js')))).default
  const css = (await postcss([tailwindcss({ ...tailwindConfig, content: [resolve(root, 'index.html'), resolve(root, 'src/**/*.{ts,tsx}')] }), autoprefixer]).process((await Promise.all(['src/styles.css', 'src/components/BookingForm.css', 'src/components/QuickBooking.css', 'src/components/CallToAction.css', 'src/privacy/SensitiveDataConsent.css'].map(path => localCss(resolve(root, path))))).join('\n'), { from: resolve(root, 'src/styles.css') })).css
  const result = await build({ absWorkingDir: root, stdin: { contents: "import React from 'react';import{createRoot}from'react-dom/client';import{PrepareDetails}from'./src/booking/PrepareDetails';createRoot(document.getElementById('root')).render(<PrepareDetails bookingRef={new URLSearchParams(location.search).get('ref')}/>);", resolveDir: root, loader: 'tsx' }, write: false, bundle: true, platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent', loader: { '.css': 'empty' }, define: { __SITE_MODE__: '"prototype"', __LOOK__: '"c"', __PLATING_SEQUENCE_AVAILABLE__: 'false', 'import.meta.env.BASE_URL': '"/"', 'import.meta.env.VITE_AUTH0_SPA_CLIENT_ID': '""' }, plugins: [{ name: 'local-booking-origin', setup(builder) { builder.onLoad({ filter: /content\/booking\.ts$/ }, async args => ({ contents: (await readFile(args.path, 'utf8')).replace('accountConfig.apiOrigin as string | null', JSON.stringify(browserOrigin)), loader: 'ts' })) } }] })
  const componentBundle = result.outputFiles[0].text
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
  const html = '<!doctype html><html data-look="c" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"></head><body><main class="wrap py-10"><div class="max-w-prose" id="root"></div></main></body></html>'
  async function pageWith(proof = accessToken, options = {}) {
    const page = await browser.newPage()
    page.setDefaultTimeout(10000)
    page.on('pageerror', error => errors.push(error.message))
    await page.setRequestInterception(true)
    page.on('request', async request => {
      try {
        const url = new URL(request.url())
        if (url.protocol === 'data:') return await request.continue()
        if (url.origin !== browserOrigin) { forbiddenNetwork.push(request.url()); return await request.abort() }
        if (request.isNavigationRequest() && url.pathname === '/') return await request.respond({ status: 200, contentType: 'text/html', body: html })
        assert.equal(url.pathname, '/api/booking/details', 'Unexpected browser request')
        assert.equal(request.method(), 'POST')
        const body = JSON.parse(request.postData())
        const reply = await bridge({ operation: 'details', ...body })
        const observed = { body, status: reply.status, serverReply: structuredClone(reply.data) }
        requests.push(observed)
        if (options.beforeReply) await options.beforeReply(observed)
        if (options.dropReplies > 0) { options.dropReplies--; observed.dropped = true; return await request.abort('connectionfailed') }
        const data = options.transformReply ? options.transformReply(structuredClone(reply.data), body) : reply.data
        observed.deliveredReply = structuredClone(data)
        await request.respond({ status: reply.status, contentType: 'application/json', body: JSON.stringify(data) })
      } catch (error) { errors.push(error.stack || error.message); await request.abort().catch(() => {}) }
    })
    await page.goto(browserOrigin + '/?ref=' + encodeURIComponent(ref) + '#access=' + proof, { waitUntil: 'domcontentloaded' })
    await page.addStyleTag({ content: css })
    await page.addScriptTag({ type: 'module', content: componentBundle })
    await page.waitForSelector('#d-occasion')
    await page.evaluate(() => document.fonts.ready)
    assert.equal(await page.$eval('.sensitive-consent input', node => node.checked), false)
    return page
  }
  async function button(page, label) {
    const handle = await page.waitForFunction(label => [...document.querySelectorAll('button')].find(node => node.textContent.trim() === label), {}, label)
    await handle.asElement().click(); await handle.dispose()
  }
  async function sent(page, fill) {
    const before = requests.length
    await fill(page)
    await page.click('button[type=submit]')
    await page.waitForFunction(() => document.querySelector('main')?.textContent.includes('Your details are recorded.'))
    assert(await page.$('form'), 'A confirmed save must retain the form and its answers')
    assert.equal(requests.length, before + 1, 'One Send must make one details request')
    const call = requests.at(-1)
    assert.equal(call.status, 200)
    assert.equal(call.body.ref, ref)
    assert.equal(call.body.accessToken, accessToken)
    assert.match(call.body.requestId, /^[0-9a-f-]{36}$/)
    return call.body.details
  }
  async function feedback(page, fill = async () => {}, selector = '[data-details-result]') {
    const before = requests.length
    await fill(page)
    await page.click('button[type=submit]')
    await page.waitForFunction(selector => !document.querySelector('button[type=submit]')?.hasAttribute('aria-busy') && !!document.querySelector(selector), {}, selector)
    assert.equal(requests.length, before + 1)
    assert(await page.$('form'), 'Partial and uncertain answers must remain in the form')
    return requests.at(-1)
  }
  async function retained(page, values) {
    assert(await page.$('form'))
    for (const [selector, value] of Object.entries(values)) assert.equal(await page.$eval(selector, node => node.value), value)
    assert.equal((await page.$eval('main', node => node.textContent)).includes('Sent to Sergio.'), false)
  }
  async function noStoredAnswers(page, values) {
    const storage = await page.evaluate(() => JSON.stringify({ local: Object.entries(localStorage), session: Object.entries(sessionStorage), url: location.href }))
    for (const value of values) assert.equal(storage.includes(value), false, 'A raw preparation answer reached browser storage or URL')
  }
  async function capture(page, name) {
    await mkdir(output, { recursive: true })
    const path = join(output, name + '.png')
    await page.screenshot({ path, fullPage: true })
    screenshots.push(path)
  }
  await check('occasion-only actual form Send omits consent and preserves every existing health source', async () => {
    const page = await pageWith()
    const details = await sent(page, page => page.type('#d-occasion', 'Graduation'))
    assert.deepEqual(details, { occasion: 'Graduation' })
    assert.deepEqual(health(await workspace()), initialHealth)
    await page.close()
  })
  await check('kitchen and spending updates omit consent and preserve saved health facts', async () => {
    const page = await pageWith()
    const details = await sent(page, async page => { await page.type('#d-kitchen', 'Gas range'); await button(page, 'I have a range in mind'); await page.type('#d-min', '800'); await page.type('#d-max', '1200') })
    assert.equal(Object.hasOwn(details, 'sensitiveDataConsent'), false)
    assert.equal(details.kitchen, 'Gas range'); assert.equal(details.budgetMax, 1200)
    assert.deepEqual(health(await workspace()), initialHealth)
    await page.close()
  })
  await check('untouched guidance default cannot submit by itself or replace an existing spending range', async () => {
    const before = (await workspace()).state.bookings.find(item => item.id === ref).planning.topics.find(item => item.id === 'budget'), page = await pageWith()
    assert.equal(before.supplied, '$800–$1200 for the gathering')
    assert.equal(await page.$eval('button[type=submit]', node => node.disabled), true)
    const details = await sent(page, page => page.type('#d-occasion', 'SPENDING_DEFAULT_UNTOUCHED'))
    assert.deepEqual(details, { occasion: 'SPENDING_DEFAULT_UNTOUCHED' })
    assert.deepEqual((await workspace()).state.bookings.find(item => item.id === ref).planning.topics.find(item => item.id === 'budget'), before)
    await page.close()
  })
  await check('deliberately choosing guidance alone sends one spending field with a matching recorded acknowledgment', async () => {
    const page = await pageWith()
    const details = await sent(page, page => button(page, 'I’d like Sergio’s guidance'))
    assert.deepEqual(details, { budgetMode: 'guidance' })
    assert.deepEqual(requests.at(-1).serverReply.detailsResult.outcomes, { budget: 'recorded' })
    assert.equal((await workspace()).state.bookings.find(item => item.id === ref).planning.topics.find(item => item.id === 'budget').supplied, 'I need guidance')
    assert.match(await page.$eval('[data-details-result]', node => node.textContent), /Spending:.*Recorded/)
    assert.equal(await page.$eval('button[type=submit]', node => node.disabled), true)
    assert.equal(await page.evaluate(id => Object.values(localStorage).includes(id), requests.at(-1).body.requestId), false)
    await page.close()
  })
  await check('changing a submitted range to guidance keeps the new intent and omits stale range amounts', async () => {
    const page = await pageWith()
    await sent(page, async page => { await button(page, 'I have a range in mind'); await page.type('#d-min', '900'); await page.type('#d-max', '1400') })
    const first = requests.at(-1)
    await button(page, 'I’d like Sergio’s guidance')
    assert.match(await page.$eval('[data-details-result]', node => node.textContent), /These edits haven’t been sent/)
    assert.equal(await page.$eval('button[type=submit]', node => node.disabled), false)
    const details = await sent(page, async () => {})
    assert.deepEqual(details, { budgetMode: 'guidance' })
    assert.notEqual(requests.at(-1).body.requestId, first.body.requestId)
    assert.equal((await workspace()).state.bookings.find(item => item.id === ref).planning.topics.find(item => item.id === 'budget').supplied, 'I need guidance')
    await page.close()
  })
  await check('a lost guidance response preserves its retry identity and original field acknowledgment', async () => {
    await seed(booking => Object.assign(booking.planning.topics.find(item => item.id === 'budget'), { status: 'tentative', updatedBy: 'Guest', supplied: '$1000–$1500 for the gathering' }))
    const page = await pageWith(accessToken, { dropReplies: 1 })
    const first = await feedback(page, page => button(page, 'I’d like Sergio’s guidance'), '[role=alert]')
    assert.equal(first.dropped, true)
    assert.deepEqual(first.body.details, { budgetMode: 'guidance' })
    assert.equal(await page.$eval('button[type=submit]', node => node.disabled), false)
    const second = await feedback(page)
    assert.equal(second.body.requestId, first.body.requestId)
    assert.deepEqual(second.serverReply.detailsResult, first.serverReply.detailsResult)
    assert.match(await page.$eval('[data-details-result]', node => node.textContent), /Spending:.*Recorded/)
    await page.close()
  })
  await check('explicit guidance respects an agreed spending answer and shows that Sergio must review it', async () => {
    await seed(booking => Object.assign(booking.planning.topics.find(item => item.id === 'budget'), { status: 'agreed', updatedBy: 'Sergio', supplied: '$1600 agreed ceiling' }))
    const page = await pageWith()
    const result = await feedback(page, page => button(page, 'I’d like Sergio’s guidance'))
    assert.deepEqual(result.body.details, { budgetMode: 'guidance' })
    assert.deepEqual(result.serverReply.detailsResult.outcomes, { budget: 'requires_review' })
    assert.match(await page.$eval('[data-details-result]', node => node.textContent), /Spending:.*Not applied/)
    assert.equal((await workspace()).state.bookings.find(item => item.id === ref).planning.topics.find(item => item.id === 'budget').supplied, '$1600 agreed ceiling')
    await page.close()
  })
  await check('guidance-only pending submission blocks spending changes until its own result returns', async () => {
    await seed(booking => Object.assign(booking.planning.topics.find(item => item.id === 'budget'), { status: 'tentative', updatedBy: 'Guest', supplied: '$1000–$1500 for the gathering' }))
    let release, notify
    const held = new Promise(resolve => { release = resolve }), started = new Promise(resolve => { notify = resolve })
    const page = await pageWith(accessToken, { beforeReply: async () => { notify(); await held } })
    await button(page, 'I’d like Sergio’s guidance'); await page.click('button[type=submit]'); await started
    assert.equal(await page.$eval('fieldset', node => node.disabled), true)
    assert.equal(await page.$$eval('[aria-labelledby=d-budget-label] button', nodes => nodes.every(node => node.matches(':disabled'))), true)
    await button(page, 'I have a range in mind')
    assert.equal(await page.$('#d-min'), null)
    assert.deepEqual(requests.at(-1).body.details, { budgetMode: 'guidance' })
    release()
    await page.waitForFunction(() => document.querySelector('[data-details-result]')?.textContent.includes('Your details are recorded.'))
    assert.match(await page.$eval('[data-details-result]', node => node.textContent), /Spending:.*Recorded/)
    await page.close()
  })
  await check('checking consent without adding health fields does not submit a consent mutation', async () => {
    const page = await pageWith()
    const details = await sent(page, async page => { await page.click('.sensitive-consent input'); await page.type('#d-allergies', '   '); await page.type('#d-occasion', 'Anniversary') })
    assert.deepEqual(details, { occasion: 'Anniversary' })
    assert.deepEqual(health(await workspace()), initialHealth)
    await page.close()
  })
  await check('new explicitly consented dietary and allergy fields send true self-consent and reach the real Worker', async () => {
    const page = await pageWith()
    const details = await sent(page, async page => { await page.click('.sensitive-consent input'); await button(page, 'Vegan'); await page.type('#d-allergies', 'Sesame') })
    assert.deepEqual(details.sensitiveDataConsent, consent(true))
    assert.deepEqual(details.dietary, ['Vegan']); assert.equal(details.allergies, 'Sesame')
    assert.equal(health(await workspace()).topic.supplied, 'Vegan\nSesame')
    await page.close()
  })
  await check('unticking unsent health fields followed by an ordinary Send preserves previously saved facts', async () => {
    const before = health(await workspace()), page = await pageWith()
    const details = await sent(page, async page => { await page.click('.sensitive-consent input'); await button(page, 'Gluten-free'); await page.type('#d-allergies', 'Unsent detail'); await page.click('.sensitive-consent input'); await page.type('#d-occasion', 'Family evening') })
    assert.deepEqual(details, { occasion: 'Family evening' })
    assert.deepEqual(health(await workspace()), before)
    await page.close()
  })
  await check('the actual Remove action cannot withdraw information with an invalid private receipt capability', async () => {
    const before = await workspace(), page = await pageWith('A'.repeat(43))
    await button(page, 'Remove my saved dietary and allergy details')
    await page.waitForSelector('[role=alert]')
    assert.equal(requests.at(-1).status, 404)
    const after = await workspace()
    assert.equal(after.revision, before.revision); assert.deepEqual(health(after), health(before))
    await page.close()
  })
  await check('explicit Remove sends false consent and clears active health details without cancelling the booking', async () => {
    const before = requests.length, page = await pageWith()
    await button(page, 'Remove my saved dietary and allergy details')
    await page.waitForFunction(() => document.querySelector('[role=status]')?.textContent.includes('were removed'))
    assert.equal(requests.length, before + 1)
    assert.deepEqual(requests.at(-1).body.details, { sensitiveDataConsent: consent(false), dietary: [], allergies: '' })
    assert.equal(requests.at(-1).status, 200)
    const data = await workspace(), saved = health(data), booking = data.state.bookings.find(item => item.id === ref)
    assert.equal(saved.dietary, ''); assert.equal(saved.originalAllergies, ''); assert.equal(saved.topic.supplied, ''); assert.equal(saved.topic.answer, ''); assert.equal(saved.topic.notes, '')
    assert.equal(saved.operations.originalNote, ''); assert.equal(saved.operations.prepNotes, '')
    assert.equal(booking.status, 'requested'); assert.equal(booking.id, ref); assert.equal(data.state.bookings.length, 1)
    await page.close()
  })
  await check('saving, removing and restoring identical health answers in one page creates a fresh action and restores current facts', async () => {
    const page = await pageWith()
    const enterHealth = async page => { await page.click('.sensitive-consent input'); await button(page, 'Vegan'); await page.type('#d-allergies', 'SAME_PAGE_RESTORED_HEALTH') }
    await sent(page, enterHealth)
    const first = requests.at(-1)
    assert.equal(health(await workspace()).topic.supplied, 'Vegan\nSAME_PAGE_RESTORED_HEALTH')
    await button(page, 'Remove my saved dietary and allergy details')
    await page.waitForFunction(() => [...document.querySelectorAll('[role=status]')].some(node => node.textContent.includes('were removed')))
    assert.equal(health(await workspace()).topic.supplied, '')
    await sent(page, enterHealth)
    const restored = requests.at(-1)
    assert.notEqual(restored.body.requestId, first.body.requestId, 'A completed then removed answer must not replay an obsolete save')
    assert.deepEqual(restored.body.details, first.body.details)
    const current = health(await workspace())
    assert.equal(current.topic.supplied, 'Vegan\nSAME_PAGE_RESTORED_HEALTH'); assert.equal(current.dietary, 'Vegan\nSAME_PAGE_RESTORED_HEALTH')
    await noStoredAnswers(page, ['SAME_PAGE_RESTORED_HEALTH'])
    await page.close()
  })
  await check('all locked fields stay visible with exact requires-review outcomes and no false success', async () => {
    await seed(booking => { Object.assign(booking.planning.topics.find(item => item.id === 'kitchen'), { status: 'agreed', supplied: 'Sergio agreed kitchen' }); Object.assign(booking.planning.topics.find(item => item.id === 'menu'), { status: 'tentative', updatedBy: 'Sergio', supplied: 'Sergio menu draft' }) })
    const page = await pageWith(), kitchen = 'Host kitchen correction', foodIdeas = 'Host menu correction'
    const result = await feedback(page, async page => { await page.type('#d-kitchen', kitchen); await page.type('#d-food', foodIdeas) })
    assert.deepEqual(result.serverReply.detailsResult.outcomes, { kitchen: 'requires_review', foodIdeas: 'requires_review' })
    const notice = await page.$eval('[data-details-result]', node => node.textContent)
    assert.match(notice, /Some details need Sergio’s review/); assert.match(notice, /Kitchen:.*Not applied/); assert.match(notice, /Food ideas:.*Not applied/)
    assert(!notice.includes('Your details are recorded.'))
    await retained(page, { '#d-kitchen': kitchen, '#d-food': foodIdeas })
    assert.equal(await page.$eval('button[type=submit]', node => node.disabled), true, 'A confirmed identical action must not silently become a new intent')
    await capture(page, 'desktop-all-locked')
    await page.type('#d-kitchen', ' edited')
    assert.match(await page.$eval('[data-details-result]', node => node.textContent), /These edits haven’t been sent/)
    assert.equal(await page.$eval('button[type=submit]', node => node.disabled), false)
    await page.close()
  })
  await check('partial saves distinguish recorded occasion from blocked kitchen without hiding either answer', async () => {
    const page = await pageWith(), occasion = 'PARTIAL_HOST_OCCASION', kitchen = 'PARTIAL_HOST_KITCHEN'
    const result = await feedback(page, async page => { await page.type('#d-occasion', occasion); await page.type('#d-kitchen', kitchen) })
    assert.deepEqual(result.serverReply.detailsResult.outcomes, { occasion: 'recorded', kitchen: 'requires_review' })
    const notice = await page.$eval('[data-details-result]', node => node.textContent)
    assert.match(notice, /Occasion:.*Recorded/); assert.match(notice, /Kitchen:.*Not applied/)
    await retained(page, { '#d-occasion': occasion, '#d-kitchen': kitchen })
    await noStoredAnswers(page, [occasion, kitchen])
    await capture(page, 'desktop-partial')
    await page.setViewport({ width: 390, height: 900 }); await capture(page, 'phone-partial')
    await page.close()
  })
  await check('unchanged fields receive an already-recorded outcome without another planning event', async () => {
    const before = await workspace(), occasion = before.state.bookings.find(item => item.id === ref).occasion, page = await pageWith()
    const result = await feedback(page, page => page.type('#d-occasion', occasion))
    assert.deepEqual(result.serverReply.detailsResult.outcomes, { occasion: 'unchanged' })
    assert.match(await page.$eval('[data-details-result]', node => node.textContent), /These details were already recorded/)
    const after = await workspace()
    assert.equal(after.state.bookings.find(item => item.id === ref).planning.events.length, before.state.bookings.find(item => item.id === ref).planning.events.length)
    await retained(page, { '#d-occasion': occasion })
    await page.close()
  })
  await check('recording consent does not make locked dietary answers appear accepted', async () => {
    await seed(booking => Object.assign(booking.planning.topics.find(item => item.id === 'dietary'), { status: 'agreed', supplied: 'Protected agreed requirement', answer: 'Protected answer' }))
    const page = await pageWith()
    const result = await feedback(page, async page => { await page.click('.sensitive-consent input'); await button(page, 'Vegan'); await page.type('#d-allergies', 'LOCKED_HOST_HEALTH') })
    assert.deepEqual(result.serverReply.detailsResult.outcomes, { dietary: 'requires_review', allergies: 'requires_review', sensitiveDataConsent: 'recorded' })
    const notice = await page.$eval('[data-details-result]', node => node.textContent)
    assert.match(notice, /Dietary needs:.*Not applied/); assert.match(notice, /Allergies:.*Not applied/); assert.match(notice, /Permission for dietary information:.*Recorded/)
    assert(!notice.includes('Your details are recorded.'))
    assert.equal(await page.$eval('.sensitive-consent input', node => node.checked), true)
    await retained(page, { '#d-allergies': 'LOCKED_HOST_HEALTH' })
    await noStoredAnswers(page, ['LOCKED_HOST_HEALTH'])
    await page.close()
  })
  const invalidAcknowledgments = {
    missing: data => { delete data.detailsResult; return data },
    wrong_id: data => { data.detailsResult.requestId = crypto.randomUUID(); return data },
    wrong_booking: data => ({ ...data, ref: 'WEB-wrong-fixture-booking' }),
    wrong_version: data => { data.detailsResult.version = 2; return data },
    missing_field: data => { delete data.detailsResult.outcomes.occasion; return data },
    extra_field: data => { data.detailsResult.outcomes.kitchen = 'recorded'; return data },
    malformed: data => { data.detailsResult.outcomes.occasion = 'sent'; return data },
  }
  for (const [kind, transformReply] of Object.entries(invalidAcknowledgments)) await check(`${kind} acknowledgment retains entered answers and retry identity until a validated replay`, async () => {
    const options = { transformReply }, page = await pageWith(accessToken, options), occasion = 'UNCERTAIN_' + kind
    const first = await feedback(page, page => page.type('#d-occasion', occasion), '[role=alert]')
    assert.equal(await page.$('[data-details-result]'), null)
    await retained(page, { '#d-occasion': occasion })
    assert.equal(await page.evaluate(id => Object.values(localStorage).includes(id), first.body.requestId), true)
    await noStoredAnswers(page, [occasion])
    options.transformReply = null
    const second = await feedback(page)
    assert.equal(second.body.requestId, first.body.requestId)
    assert.deepEqual(second.serverReply.detailsResult, first.serverReply.detailsResult)
    assert.match(await page.$eval('[data-details-result]', node => node.textContent), /Your details are recorded/)
    assert.equal(await page.evaluate(id => Object.values(localStorage).includes(id), first.body.requestId), false)
    await page.close()
  })
  await check('a legacy action with no stored proof stays unverified and retryable without guessing saved fields', async () => {
    const options = { transformReply: invalidAcknowledgments.missing }, page = await pageWith(accessToken, options), occasion = 'LEGACY_HOST_ANSWER'
    const first = await feedback(page, page => page.type('#d-occasion', occasion), '[role=alert]')
    await DB.prepare('UPDATE booking_detail_actions SET outcomes_json=NULL WHERE request_id=?').bind(first.body.requestId).run()
    options.transformReply = null
    const second = await feedback(page)
    assert.equal(second.body.requestId, first.body.requestId)
    assert.deepEqual(second.serverReply.detailsResult.outcomes, { occasion: 'unverified' })
    assert.match(await page.$eval('[data-details-result]', node => node.textContent), /could not confirm all of its changes/)
    assert.equal(await page.$eval('button[type=submit]', node => node.disabled), false)
    assert.equal(await page.$eval('button[type=submit]', node => node.textContent), 'Retry these details')
    assert.equal(await page.evaluate(id => Object.values(localStorage).includes(id), first.body.requestId), true)
    await retained(page, { '#d-occasion': occasion })
    await capture(page, 'desktop-unverified')
    await page.close()
  })
  await check('lost response replays original outcomes after a later staff lock without another note or overwrite', async () => {
    await seed(booking => Object.assign(booking.planning.topics.find(item => item.id === 'kitchen'), { status: 'tentative', updatedBy: 'Guest', supplied: 'Before lost reply' }))
    const options = { dropReplies: 1 }, page = await pageWith(accessToken, options), kitchen = 'LOST_REPLY_KITCHEN', note = 'ONE_DURABLE_HOST_NOTE'
    const first = await feedback(page, async page => { await page.type('#d-kitchen', kitchen); await page.type('#d-notes', note) }, '[role=alert]')
    assert.equal(first.dropped, true)
    await retained(page, { '#d-kitchen': kitchen, '#d-notes': note })
    assert.equal(await page.evaluate(id => Object.values(localStorage).includes(id), first.body.requestId), true)
    await seed(booking => Object.assign(booking.planning.topics.find(item => item.id === 'kitchen'), { status: 'agreed', updatedBy: 'Sergio', supplied: 'Later agreed kitchen' }))
    const second = await feedback(page)
    assert.equal(second.body.requestId, first.body.requestId)
    assert.deepEqual(second.serverReply.detailsResult, first.serverReply.detailsResult)
    const received = await page.evaluate(at => 'Submission received ' + new Date(at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/New_York' }) + ' Eastern.', first.serverReply.detailsResult.recordedAt)
    assert((await page.$eval('[data-details-result]', node => node.textContent)).includes(received), 'The visible acknowledgment must identify the original submission time in Eastern time')
    const booking = (await workspace()).state.bookings.find(item => item.id === ref)
    assert.equal(booking.planning.topics.find(item => item.id === 'kitchen').supplied, 'Later agreed kitchen')
    assert.equal(booking.planning.events.filter(item => item.description.includes(note)).length, 1)
    await noStoredAnswers(page, [kitchen, note])
    await page.close()
  })
  await check('every editable control is blocked while pending and the submitted answer remains unchanged', async () => {
    let release, notify
    const held = new Promise(resolve => { release = resolve }), started = new Promise(resolve => { notify = resolve })
    const options = { beforeReply: async () => { notify(); await held } }, page = await pageWith(accessToken, options)
    await page.type('#d-occasion', 'PENDING_HOST_ANSWER'); await page.click('button[type=submit]'); await started
    assert.equal(await page.$eval('fieldset', node => node.disabled), true)
    assert.equal(await page.$$eval('fieldset input,fieldset textarea,fieldset button', nodes => nodes.every(node => node.matches(':disabled'))), true)
    await page.type('#d-occasion', 'MUST_NOT_APPEAR')
    assert.equal(await page.$eval('#d-occasion', node => node.value), 'PENDING_HOST_ANSWER')
    await capture(page, 'desktop-pending')
    release()
    await page.waitForFunction(() => document.querySelector('[data-details-result]')?.textContent.includes('Your details are recorded.'))
    await retained(page, { '#d-occasion': 'PENDING_HOST_ANSWER' })
    await page.close()
  })
  for (const width of [1280, 390, 320]) await check(`${width}px real CSS geometry adds no fieldset box, spacing or horizontal overflow`, async () => {
    const page = await pageWith(); await page.setViewport({ width, height: 900 }); await page.evaluate(() => document.fonts.ready)
    await button(page, 'I have a range in mind')
    const measure = () => {
      const selectors = ['form', '#d-occasion', '.sensitive-consent', '#d-allergies', '#d-food', '#d-kitchen', '#d-min', '#d-max', '#d-notes', 'button[type=submit]']
      return Object.fromEntries(selectors.map(selector => { const box = document.querySelector(selector).getBoundingClientRect(); return [selector, { x: box.x, y: box.y, width: box.width, height: box.height }] }))
    }
    const before = await page.evaluate(measure)
    assert.equal(await page.$eval('fieldset', node => getComputedStyle(node).display), 'contents')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await capture(page, `geometry-${width}`)
    await page.evaluate(() => { const fieldset = document.querySelector('fieldset'); fieldset.replaceWith(...fieldset.childNodes) })
    const flattened = await page.evaluate(measure)
    for (const selector of Object.keys(before)) for (const dimension of ['x', 'y', 'width', 'height']) assert(Math.abs(before[selector][dimension] - flattened[selector][dimension]) <= 0.5, `${selector} ${dimension} changed when flattening the fieldset`)
    dimensions.push({ width, before, flattened })
    await page.close()
  })
  assert.deepEqual(errors, []); assert.deepEqual(forbiddenNetwork, [])
  assert.deepEqual(await sourceHashes(), beforeSourceHashes, 'Application source changed during the run')
  await mkdir(output, { recursive: true })
  await writeFile(join(output, 'results.json'), JSON.stringify({ checks, count: checks.length, actualComponent: 'src/booking/PrepareDetails.tsx', sourceHashes: beforeSourceHashes, actualWorker: join(backend, 'server/index.ts'), migrations: migrations.length, dimensions, screenshots, providerCalls: 0, errors, limits: 'Local intercepted transport, actual component/CSS/fonts and real SQLite; no live delivery, deployment or human acceptance claimed.' }, null, 2) + '\n')
  console.log(`\n${checks.length} actual-component preparation consent checks passed against ${migrations.length} SQLite migrations.`)
} finally {
  await browser?.close()
  globalThis.fetch = originalFetch
  await rm(temporary, { recursive: true, force: true })
}
