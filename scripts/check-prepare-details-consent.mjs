#!/usr/bin/env node
// Actual PrepareDetails + booking API, actual Worker + migrations, disposable SQLite.
// Every browser request is intercepted locally. No live account, provider, or database is used.
import assert from 'node:assert/strict'
import { webcrypto, createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { access, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import puppeteer from 'puppeteer-core'

if (!globalThis.crypto) globalThis.crypto = webcrypto
const root = fileURLToPath(new URL('../', import.meta.url))
assert(process.env.PREPARE_DETAILS_BACKEND_ROOT, 'Set PREPARE_DETAILS_BACKEND_ROOT to the admin directory containing server/index.ts and drizzle/.')
const backend = resolve(process.env.PREPARE_DETAILS_BACKEND_ROOT)
await access(join(backend, 'server/index.ts'))
const temporary = await mkdtemp(join(tmpdir(), 'sergio-prepare-details-'))
const output = resolve(root, 'output/connection-completion/preparation-consent')
const componentPath = resolve(root, 'src/booking/PrepareDetails.tsx')
const componentHash = createHash('sha256').update(await readFile(componentPath)).digest('hex')
const browserOrigin = 'https://preparation.fixture.test', adminOrigin = 'https://operator.fixture.test'
const bridgeSecret = 'preparation-fixture-secret-over-thirty-two-characters'
const checks = [], requests = [], errors = [], forbiddenNetwork = []
const originalFetch = globalThis.fetch
globalThis.fetch = async input => { forbiddenNetwork.push(String(input)); throw Error('Provider/network access is prohibited by this local check.') }
const check = async (name, fn) => { await fn(); checks.push(name); console.log('PASS ' + name) }
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

  const result = await build({ absWorkingDir: root, stdin: { contents: "import React from 'react';import{createRoot}from'react-dom/client';import{PrepareDetails}from'./src/booking/PrepareDetails';createRoot(document.getElementById('root')).render(<PrepareDetails bookingRef={new URLSearchParams(location.search).get('ref')}/>);", resolveDir: root, loader: 'tsx' }, write: false, bundle: true, platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent', loader: { '.css': 'empty' }, define: { __SITE_MODE__: '"prototype"', __LOOK__: '"c"', __PLATING_SEQUENCE_AVAILABLE__: 'false', 'import.meta.env.BASE_URL': '"/"', 'import.meta.env.VITE_AUTH0_SPA_CLIENT_ID': '""' }, plugins: [{ name: 'local-booking-origin', setup(builder) { builder.onLoad({ filter: /content\/booking\.ts$/ }, async args => ({ contents: (await readFile(args.path, 'utf8')).replace('accountConfig.apiOrigin as string | null', JSON.stringify(browserOrigin)), loader: 'ts' })) } }] })
  const componentBundle = result.outputFiles[0].text
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
  const html = '<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"></head><body><main id="root"></main></body></html>'
  async function pageWith(proof = accessToken) {
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
        requests.push({ body, status: reply.status })
        await request.respond({ status: reply.status, contentType: 'application/json', body: JSON.stringify(reply.data) })
      } catch (error) { errors.push(error.stack || error.message); await request.abort().catch(() => {}) }
    })
    await page.goto(browserOrigin + '/?ref=' + encodeURIComponent(ref) + '#access=' + proof, { waitUntil: 'domcontentloaded' })
    await page.addScriptTag({ type: 'module', content: componentBundle })
    await page.waitForSelector('#d-occasion')
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
    await page.waitForFunction(() => document.querySelector('main')?.textContent.includes('Sent to Sergio.'))
    assert.equal(requests.length, before + 1, 'One Send must make one details request')
    const call = requests.at(-1)
    assert.equal(call.status, 200)
    assert.equal(call.body.ref, ref)
    assert.equal(call.body.accessToken, accessToken)
    assert.match(call.body.requestId, /^[0-9a-f-]{36}$/)
    return call.body.details
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
  assert.deepEqual(errors, []); assert.deepEqual(forbiddenNetwork, [])
  assert.equal(createHash('sha256').update(await readFile(componentPath)).digest('hex'), componentHash, 'Component changed during the run')
  await mkdir(output, { recursive: true })
  await writeFile(join(output, 'results.json'), JSON.stringify({ checks, count: checks.length, actualComponent: 'src/booking/PrepareDetails.tsx', componentHash, actualWorker: join(backend, 'server/index.ts'), migrations: migrations.length, providerCalls: 0, errors, limits: 'Local intercepted transport and real SQLite; no live delivery, deployment or visual acceptance claimed.' }, null, 2) + '\n')
  console.log(`\n${checks.length} actual-component preparation consent checks passed against ${migrations.length} SQLite migrations.`)
} finally {
  await browser?.close()
  globalThis.fetch = originalFetch
  await rm(temporary, { recursive: true, force: true })
}
