#!/usr/bin/env node
// Actual gift client and return component. All transport is intercepted; no live payments or email.
import assert from 'node:assert/strict'
import { createHash, webcrypto } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import puppeteer from 'puppeteer-core'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'

const root = fileURLToPath(new URL('../', import.meta.url)), origin = 'https://gift.fixture.test'
const directory = resolve(root, 'output/connection-completion/gift-purchase-client')
await mkdir(directory, { recursive: true })
if (!globalThis.crypto) globalThis.crypto = webcrypto
const checks = [], calls = [], blocked = [], errors = [], screenshots = [], memory = new Map()
const globals = Object.fromEntries(['fetch', 'sessionStorage'].map(key => [key, globalThis[key]]))
const definitions = { __SITE_MODE__: '"prototype"', __LOOK__: '"c"', __PLATING_SEQUENCE_AVAILABLE__: 'false', 'import.meta.env.BASE_URL': '"/"', 'import.meta.env.VITE_AUTH0_SPA_CLIENT_ID': '""' }
const plugin = { name: 'gift-local-service', setup(builder) { builder.onLoad({ filter: /content\/booking\.ts$/ }, () => ({ contents: `export const booking={apiBase:${JSON.stringify(origin)}}`, loader: 'ts' })) } }
let moduleId = 0, browser
const check = async (name, fn) => { await fn(); checks.push(name); console.log('PASS ' + name) }
async function client(entry = 'src/gift/api.ts') {
  const result = await build({ absWorkingDir: root, entryPoints: [entry], bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent', define: definitions, plugins: [plugin] })
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text + `\n//# sourceURL=gift-client-fixture-${++moduleId}.mjs`).toString('base64'))
}
const purchase = { fulfillment: 'email', amountCents: 10000, recipientName: 'Fixture recipient', recipientEmail: 'recipient@example.test', senderName: 'Fixture sender', senderEmail: 'sender@example.test', note: 'Synthetic gift test', sendOn: '2099-12-12' }
const accessToken = 'g'.repeat(43), purchaseId = crypto.randomUUID(), otherId = crypto.randomUUID()
const status = { version: 1, purchaseId, payment: 'paid', issuance: 'issued', sendOn: purchase.sendOn, timeZone: 'America/New_York', delivery: { recipient: 'scheduled', sender: 'sent' }, checkedAt: '2026-11-28T02:00:00.000Z', fulfillment: 'email', canDownload: false }
const storage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, String(value)), removeItem: key => memory.delete(key) }
function boundary(url, options) {
  calls.push({ url: String(url), body: options.body ? JSON.parse(options.body) : undefined })
  assert.equal(options.credentials, 'omit'); assert.equal(options.cache, 'no-store'); assert.equal(options.referrerPolicy, 'no-referrer')
  if (options.body) { assert.equal(options.method, 'POST'); assert.equal(options.headers['X-Booking-Request'], '1'); assert(!String(url).includes(accessToken)) }
  return calls.at(-1)
}
async function localCss(path) {
  let css = await readFile(path, 'utf8')
  for (const match of [...css.matchAll(/@import\s+['"]([^'"]+)['"];?/g)]) css = css.replace(match[0], await localCss(resolve(dirname(path), match[1])))
  for (const match of [...css.matchAll(/url\(['"]?(\.\.?\/[^'"\s)]+)['"]?\)/g)]) {
    const bytes = await readFile(resolve(dirname(path), match[1])), mime = match[1].endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream'
    css = css.replace(match[0], `url(data:${mime};base64,${bytes.toString('base64')})`)
  }
  return css
}
try {
  globalThis.sessionStorage = storage
  const api = await client()
  await check('missing or malformed service configuration cannot open gift sales', async () => {
    for (const value of [{ ready: true, amounts: [] }, { ready: true, amounts: ['10000'] }, { ready: true, amounts: [1] }, { ready: true, amounts: [10000001] }]) {
      globalThis.fetch = async (url, options) => { boundary(url, options); return Response.json(value) }
      assert.deepEqual(await api.giftConfig([10000]), { ready: false, amounts: [10000], fulfillment: null })
    }
    globalThis.fetch = async () => { throw Error('Local unavailable transport') }
    assert.equal((await api.giftConfig([10000])).ready, false)
  })
  await check('sales require explicit verified fulfillment and preserve the configured denominations', async () => {
    for (const fulfillment of ['download', 'email']) {
      const configured = { ready: true, amounts: [10000, 15000, 25000, 50000], fulfillment }
      globalThis.fetch = async (url, options) => { boundary(url, options); return Response.json(configured) }
      assert.deepEqual(await api.giftConfig([10000]), configured)
    }
    for (const patch of [{}, { fulfillment: 'unknown' }, { fulfillment: 'download', amounts: [10000, 10000] }]) {
      globalThis.fetch = async () => Response.json({ ready: true, amounts: [10000], ...patch })
      assert.equal((await api.giftConfig([10000])).ready, false)
    }
    await assert.rejects(api.startGiftCheckout({ ...purchase, fulfillment: undefined }), error => error.code === 'invalid')
  })
  await check('lost checkout response and blocked storage retain one same-page purchase intent', async () => {
    globalThis.sessionStorage = { getItem() { throw Error('blocked') }, setItem() { throw Error('blocked') } }
    const attempts = [], committed = new Map(); let dropped = false
    globalThis.fetch = async (url, options) => {
      const entry = boundary(url, options), id = entry.body.requestId; attempts.push(id)
      if (!committed.has(id)) committed.set(id, { url: 'https://checkout.stripe.com/c/pay/cs_test_gift', purchaseId: id, accessToken })
      if (!dropped) { dropped = true; throw Error('Dropped after commit') }
      return Response.json(committed.get(id))
    }
    await assert.rejects(api.startGiftCheckout(purchase), error => error.code === 'network' && !error.message.includes('Nothing was charged'))
    assert.match(await api.startGiftCheckout(purchase), /^https:\/\/checkout\.stripe\.com\//)
    assert.equal(committed.size, 1); assert.equal(attempts[0], attempts[1])
    await api.startGiftCheckout({ ...purchase, note: 'A distinct synthetic gift intent' })
    assert.notEqual(attempts.at(-1), attempts[0])
    globalThis.sessionStorage = storage
  })
  await check('checkout proof and recovery identity survive a fresh module without retaining purchase content', async () => {
    globalThis.fetch = async (url, options) => { const { body } = boundary(url, options); return Response.json({ url: 'https://checkout.stripe.com/c/pay/cs_test_reload', purchaseId: body.requestId, accessToken }) }
    const input = { ...purchase, note: 'A separate recoverable intent' }
    await api.startGiftCheckout(input); const first = calls.at(-1).body.requestId
    await (await client()).startGiftCheckout(input); assert.equal(calls.at(-1).body.requestId, first)
    const saved = [...memory.values()].join('\n'); assert(!saved.includes(purchase.senderEmail)); assert(!saved.includes(purchase.recipientName)); assert(!saved.includes(input.note))
  })
  await check('foreign checkout URLs, incomplete proof and wrong-purchase acknowledgments cannot redirect', async () => {
    for (const patch of [{ url: 'https://checkout.stripe.com.evil.test/' }, { url: 'https://someone@checkout.stripe.com/' }, { accessToken: undefined }, { purchaseId: otherId }]) {
      globalThis.fetch = async (url, options) => { const { body } = boundary(url, options); return Response.json({ url: 'https://checkout.stripe.com/c/pay/cs_test_guard', purchaseId: body.requestId, accessToken, ...patch }) }
      await assert.rejects(api.startGiftCheckout({ ...purchase, note: 'Guarded synthetic gift' }), error => error.code === 'network')
    }
  })
  await check('purchase recovery accepts its own fragment proof and never guesses another purchase or query token', async () => {
    assert.deepEqual(api.giftPurchaseProof('?purchase=' + purchaseId, '#access=' + accessToken), { purchaseId, accessToken })
    assert.deepEqual((await client()).giftPurchaseProof('?purchase=' + purchaseId, ''), { purchaseId, accessToken })
    assert.equal(api.giftPurchaseProof('', ''), null)
    assert.equal(api.giftPurchaseProof('?purchase=' + otherId, ''), null)
    assert.equal(api.giftPurchaseProof('?purchase=' + otherId + '&access=' + accessToken, ''), null)
    assert.equal(api.giftPurchaseProof('?purchase=' + purchaseId + '&purchase=' + otherId, '#access=' + accessToken), null)
    assert.equal(api.giftPurchaseProof('?purchase=' + purchaseId, '#access=' + accessToken + '&access=' + accessToken), null)
  })
  await check('protected status sends proof only in its body and validates payment, issuance and each delivery separately', async () => {
    globalThis.fetch = async (url, options) => { const entry = boundary(url, options); assert.deepEqual(entry.body, { purchaseId, accessToken }); return Response.json(status) }
    assert.deepEqual(await api.giftPurchaseStatus({ purchaseId, accessToken }), status)
    assert.equal(calls.at(-1).url, origin + '/api/gift/status')
    for (const patch of [{ purchaseId: otherId }, { version: 2 }, { payment: 'success' }, { issuance: 'mailed' }, { sendOn: '2026-02-31' }, { delivery: { recipient: 'sent', sender: 'not_a_state' } }, { code: 'FORBIDDEN_CODE' }, { senderEmail: 'private@example.test' }, { fulfillment: undefined }, { canDownload: true }, { fulfillment: 'download', canDownload: true }]) {
      globalThis.fetch = async () => Response.json({ ...status, ...patch })
      await assert.rejects(api.giftPurchaseStatus({ purchaseId, accessToken }), error => error.code === 'network')
    }
  })
  await check('download status cannot claim email delivery or offer a card before paid issuance', async () => {
    const current = { ...status, fulfillment: 'download', canDownload: true, delivery: { recipient: 'not_applicable', sender: 'not_applicable' } }
    globalThis.fetch = async () => Response.json(current)
    assert.deepEqual(await api.giftPurchaseStatus({ purchaseId, accessToken }), current)
    for (const patch of [{ payment: 'pending' }, { issuance: 'pending' }, { fulfillment: 'email' }]) {
      globalThis.fetch = async () => Response.json({ ...current, ...patch })
      await assert.rejects(api.giftPurchaseStatus({ purchaseId, accessToken }), error => error.code === 'network')
    }
  })
  await check('explicit download keeps proof in POST and builds the canonical two-page PDF from a bounded, purchase-bound document', async () => {
    const { generateGiftCode } = await client('prototypes/sergio-admin/shared/gift-cards/code.ts'), code = generateGiftCode(bytes => { bytes.fill(7); return bytes })
    const document = { version: 1, purchaseId, issuedAt: '2026-11-28T02:00:00.000Z', document: { amountCents: 10000, recipient: 'Fixture recipient', sender: 'Fixture sender', note: 'Synthetic gift test', code, redeemUrl: 'https://chefsergioandco.github.io/book/', phone: '(407) 757-3009' } }
    globalThis.fetch = async (url, options) => { const entry = boundary(url, options); assert.equal(entry.url, origin + '/api/gift/download'); assert.deepEqual(entry.body, { purchaseId, accessToken }); assert.equal(options.headers.Accept, 'application/json'); return Response.json(document) }
    const file = await api.downloadGiftCard({ purchaseId, accessToken }); assert.equal(file.type, 'application/pdf')
    const { PDFDocument } = await import('pdf-lib'), pdf = await PDFDocument.load(await file.arrayBuffer()); assert.equal(pdf.getPageCount(), 2); assert.deepEqual(pdf.getPages().map(page => page.getSize()), [{ width: 360, height: 252 }, { width: 360, height: 252 }])
    assert.deepEqual(new Uint8Array(await file.arrayBuffer()), new Uint8Array(await (await api.downloadGiftCard({ purchaseId, accessToken })).arrayBuffer()))
    for (const response of [Response.json({}), Response.json({ ...document, purchaseId: otherId }), Response.json({ ...document, code }), Response.json({ ...document, document: { ...document.document, code: 'invalid' } }), new Response('{}', { headers: { 'Content-Type': 'application/pdf' } }), new Response(JSON.stringify(document), { headers: { 'Content-Type': 'application/json', 'Content-Length': String(33 * 1024) } }), new Response('{}', { status: 409, headers: { 'Content-Type': 'application/json' } })]) {
      globalThis.fetch = async () => response
      await assert.rejects(api.downloadGiftCard({ purchaseId, accessToken }), error => ['network', 'unavailable'].includes(error.code))
    }
    globalThis.fetch = async () => { throw Error('Local dropped download') }
    await assert.rejects(api.downloadGiftCard({ purchaseId, accessToken }), error => error.message.includes('another payment is not needed'))
  })
  await check('an aborted status read cannot remain an outstanding request or claim payment success', async () => {
    globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => { if (options.signal.aborted) return reject(Error('aborted')); options.signal.addEventListener('abort', () => reject(Error('aborted')), { once: true }) })
    const controller = new AbortController(), pending = api.giftPurchaseStatus({ purchaseId, accessToken }, controller.signal); controller.abort()
    await assert.rejects(pending, error => error.code === 'network')
  })
  await check('the card credential stays in the body and unknown, negative or unusable value is never treated as spendable', async () => {
    const { generateGiftCode } = await client('prototypes/sergio-admin/shared/gift-cards/code.ts'), code = generateGiftCode(bytes => { bytes.fill(7); return bytes })
    const card = { amountCents: 10000, balanceCents: 5000, status: 'active', recipient: purchase.recipientName, sender: purchase.senderName, note: '', last4: code.slice(-4) }
    globalThis.fetch = async (url, options) => { const entry = boundary(url, options); assert.equal(entry.url, origin + '/api/gift/card'); assert.deepEqual(entry.body, { code }); assert(!entry.url.includes(code)); return Response.json(card) }
    assert.deepEqual(await api.giftCardStatus(code), card)
    for (const patch of [{ balanceCents: undefined }, { balanceCents: -1 }, { balanceCents: 100, status: 'frozen' }, { status: 'unknown' }]) {
      globalThis.fetch = async () => Response.json({ ...card, ...patch })
      await assert.rejects(api.giftCardStatus(code), error => error.code === 'network')
    }
  })

  // The browser below is a fresh isolated headless instance, never the user's Chrome session.
  const bundle = await build({ absWorkingDir: root, stdin: { contents: "import React from'react';import{createRoot}from'react-dom/client';import{GiftThanks}from'./src/gift/GiftCardPage';createRoot(document.getElementById('root')).render(<GiftThanks/>);", resolveDir: root, loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent', define: definitions, loader: { '.css': 'empty' }, plugins: [plugin] })
  const tailwind = (await import(pathToFileURL(resolve(root, 'tailwind.config.js')))).default
  const css = (await postcss([tailwindcss({ ...tailwind, content: [resolve(root, 'src/gift/*.{ts,tsx}'), resolve(root, 'src/components/CallToAction.tsx')] }), autoprefixer]).process((await Promise.all(['src/styles.css', 'src/components/CallToAction.css', 'src/gift/GiftPage.css'].map(path => localCss(resolve(root, path))))).join('\n'), { from: resolve(root, 'src/styles.css') })).css
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
  async function pageWith(value = status, path = '/gift/thanks/?purchase=' + purchaseId + '#access=' + accessToken) {
    const page = await browser.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message))
    const reads = []; let currentValue = value, fail = false
    await page.setRequestInterception(true)
    page.on('request', async request => {
      try {
        const url = new URL(request.url())
        if (url.protocol === 'data:') return await request.continue()
        if (url.origin !== origin) { blocked.push(url.origin); return await request.abort() }
        if (request.isNavigationRequest()) return await request.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><html data-look="c" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"></head><body><main id="root"></main></body></html>' })
        assert.equal(url.pathname, '/api/gift/status'); const body = JSON.parse(request.postData()); reads.push(body)
        assert.equal(request.method(), 'POST'); assert.equal(body.accessToken, accessToken)
        return await request.respond({ status: fail ? 503 : 200, contentType: 'application/json', body: JSON.stringify(fail ? { error: { code: 'unavailable', message: 'Fixture status unavailable.' } } : currentValue) })
      } catch (error) { errors.push(error.message); await request.abort().catch(() => {}) }
    })
    await page.goto(origin + path); await page.addStyleTag({ content: css }); await page.addScriptTag({ type: 'module', content: bundle.outputFiles[0].text }); await page.waitForSelector('h1'); await page.evaluate(() => document.fonts.ready)
    return { page, reads, set(value) { currentValue = value }, fail() { fail = true } }
  }
  await check('opening the return route without proof makes no API call and never claims payment or delivery', async () => {
    const { page, reads } = await pageWith(status, '/gift/thanks/'); await page.waitForFunction(() => document.body.textContent.includes('Use your private purchase link.'))
    assert.equal(reads.length, 0); const copy = await page.$eval('main', node => node.textContent); assert(!copy.includes('Payment confirmed')); assert(!copy.includes('Your gift is on its way.')); await page.close()
  })
  await check('a paid issued gift shows scheduled recipient and sent sender separately, then clears stale success on a failed refresh', async () => {
    const f = await pageWith(); await f.page.waitForFunction(() => document.body.textContent.includes('Payment confirmed'))
    const copy = await f.page.$eval('main', node => node.textContent); assert.match(copy, /Recipient emailScheduled/); assert.match(copy, /Your receipt and card copySent · delivery not yet confirmed/); assert(!copy.includes(accessToken)); assert(!copy.includes(purchase.senderEmail)); assert(!copy.includes('Your gift is on its way.'))
    f.fail(); await f.page.evaluate(() => [...document.querySelectorAll('button')].find(node => node.textContent === 'Refresh status').click()); await f.page.waitForSelector('[role=alert]')
    assert(!(await f.page.$eval('main', node => node.textContent)).includes('Payment confirmed')); await f.page.close()
  })
  await check('processing, issuance trouble, expired and unverified results stay distinct and never invite a duplicate payment', async () => {
    for (const variant of [{ payment: 'processing', issuance: 'pending' }, { payment: 'paid', issuance: 'needs_review' }, { payment: 'expired', issuance: 'pending' }, { payment: 'unverified', issuance: 'pending' }]) {
      const f = await pageWith({ ...status, ...variant, delivery: { recipient: 'not_issued', sender: 'not_issued' } }); await f.page.waitForFunction(() => document.querySelector('.gift-purchase-reference'))
      await f.page.waitForFunction(() => !document.querySelector('[aria-busy=true]')); const copy = await f.page.$eval('main', node => node.textContent)
      assert(!copy.includes('Your gift card has been issued.')); assert.equal(await f.page.$('a[href="/gift/"]'), null); assert(!copy.includes('Nothing was charged')); await f.page.close()
    }
  })
  await check('wrong-purchase status and later URL changes cannot expose a stale purchase result', async () => {
    const f = await pageWith({ ...status, purchaseId: otherId }); await f.page.waitForSelector('[role=alert]'); assert(!(await f.page.$eval('main', node => node.textContent)).includes('Payment confirmed'))
    await f.page.evaluate(() => { history.pushState(null, '', '/gift/thanks/'); dispatchEvent(new PopStateEvent('popstate')) }); await f.page.waitForFunction(() => document.body.textContent.includes('Use your private purchase link.')); assert.equal(f.reads.length, 1); await f.page.close()
  })
  await check('real return-page typography and controls fit desktop and phones without revealing proof', async () => {
    const f = await pageWith(); await f.page.waitForFunction(() => document.body.textContent.includes('Payment confirmed'))
    for (const width of [1280, 390, 320]) {
      await f.page.setViewport({ width, height: 900 }); assert(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      const file = resolve(directory, 'purchase-' + width + '.png'); await f.page.screenshot({ path: file, fullPage: true }); screenshots.push(file)
    }
    await f.page.keyboard.press('Tab'); assert(await f.page.evaluate(() => document.activeElement.tagName === 'BUTTON')); await f.page.close()
  })
  assert.equal(blocked.length, 0); assert.equal(errors.length, 0, errors.join('\n'))
  const paths = ['src/gift/api.ts', 'src/gift/GiftCardPage.tsx', 'src/gift/GiftPage.tsx', 'src/gift/GiftPage.css']
  await writeFile(resolve(directory, 'results.json'), JSON.stringify({ at: new Date().toISOString(), checks, screenshots, browserErrors: errors, blockedExternalRequests: blocked, sourceHashes: Object.fromEntries(await Promise.all(paths.map(async path => [path, createHash('sha256').update(await readFile(resolve(root, path))).digest('hex')]))), scope: 'Actual client and return component with intercepted HTTP only; no financial/provider/human acceptance.' }, null, 2) + '\n')
  console.log(`Passed ${checks.length} actual gift client/return checks; zero live provider requests.`)
} finally { await browser?.close(); Object.assign(globalThis, globals) }
