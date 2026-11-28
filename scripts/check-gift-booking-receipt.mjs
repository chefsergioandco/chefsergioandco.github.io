#!/usr/bin/env node
// Actual BookDone and booking client. The browser's entire network is intercepted locally.
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import puppeteer from 'puppeteer-core'

const root = fileURLToPath(new URL('../', import.meta.url)), origin = 'https://gift-redemption.fixture.test', ref = 'WEB-gift-covered', access = 'b'.repeat(43)
const directory = resolve(root, 'output/connection-completion/gift-booking-receipt'), checks = [], errors = [], blocked = []
await mkdir(directory, { recursive: true })
const config = { partyBands: [{ id: 'small', label: '1–6 guests', min: 1, max: 6, deposit: 180 }], planningFee: 0, checkoutMinutes: 30, postageAllowance: null, kitchenRequirements: '', travelMiles: 75, maxGuests: 24, interviewScheduling: 'undecided', interviewSlots: [], policyVersion: 1, paymentReady: true }
const receipt = { ref, status: 'requested', kind: 'table', date: '2099-12-12', time: '18:00', guests: 2, nightId: 'fixture-night', nightTitle: 'A fixture evening', nightMinimumState: 'awaiting_minimum', decisionDate: '2099-12-10T12:00:00Z', amount: 180, amountWhen: 'after-quote', createdAt: '2026-11-28T01:00:00Z', planning: { dateMode: 'exact', partyBandLabel: '2 seats', interviewStatus: 'not_sent', dateReserved: false, depositStatus: 'unpaid', depositAmount: 180, spendingCeiling: null, menu: '', followUpCount: 0 } }
const bundle = await build({ absWorkingDir: root, stdin: { contents: "import React from'react';import{createRoot}from'react-dom/client';import{BookDone}from'./src/booking/StatusPages';createRoot(document.getElementById('root')).render(<BookDone/>);", resolveDir: root, loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent', loader: { '.css': 'empty' }, define: { __SITE_MODE__: '"prototype"', __LOOK__: '"c"', __PLATING_SEQUENCE_AVAILABLE__: 'false', 'import.meta.env.BASE_URL': '"/"', 'import.meta.env.VITE_AUTH0_SPA_CLIENT_ID': '""' }, plugins: [{ name: 'local-api', setup(builder) { builder.onLoad({ filter: /content\/booking\.ts$/ }, async args => ({ contents: (await readFile(args.path, 'utf8')).replace('accountConfig.apiOrigin as string | null', JSON.stringify(origin)), loader: 'ts' })) } }] })
const check = async (name, fn) => { await fn(); checks.push(name); console.log('PASS ' + name) }
let browser
try {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
  async function pageWith(mode) {
    const page = await browser.newPage(), calls = []; let settled = false, checkoutCalls = 0
    page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message)); await page.setRequestInterception(true)
    page.on('request', async request => {
      try {
        const url = new URL(request.url())
        if (url.protocol === 'data:') return await request.continue()
        if (url.origin !== origin) { blocked.push(url.origin); return await request.abort() }
        if (request.isNavigationRequest()) return await request.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><head><meta charset="utf-8"><link rel="icon" href="data:,"></head><body><main id="root"></main></body>' })
        if (['/brand/logo-primary-ink.svg', '/brand/logo-primary-reverse.svg'].includes(url.pathname)) return await request.respond({ status: 200, contentType: 'image/svg+xml', body: await readFile(resolve(root, 'public' + url.pathname)) })
        const body = request.postData() ? JSON.parse(request.postData()) : null
        calls.push({ path: url.pathname, body })
        let data
        if (url.pathname === '/api/planning-config') data = config
        else if (url.pathname === '/api/booking/status') { assert.deepEqual(body, { ref, accessToken: access }); data = settled ? { ...receipt, status: 'confirmed', amountWhen: 'paid', planning: { ...receipt.planning, depositStatus: 'paid' } } : receipt }
        else if (url.pathname === '/api/booking/checkout') {
          assert.equal(body.ref, ref); assert.equal(body.accessToken, access); checkoutCalls++
          if (mode === 'dropped' && checkoutCalls === 1) return await request.abort('connectionfailed')
          if (mode === 'wrong') data = { paid: true, ref: 'A-DIFFERENT-BOOKING', requestId: body.requestId }
          else { settled = true; data = { paid: true, ref, requestId: body.requestId } }
        } else throw Error('Unexpected route ' + url.pathname)
        return await request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(data) })
      } catch (error) { errors.push(error.message); await request.abort().catch(() => {}) }
    })
    await page.goto(origin + '/book/done/?ref=' + ref + '#access=' + access)
    await page.addScriptTag({ type: 'module', content: bundle.outputFiles[0].text })
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(node => node.textContent === 'Pay for your seats'))
    return { page, calls }
  }
  const clickPay = page => page.evaluate(() => [...document.querySelectorAll('button')].find(node => node.textContent === 'Pay for your seats').click())
  await check('a receipt settled entirely by gift value refreshes its own status without a Stripe or undefined redirect', async () => {
    const f = await pageWith('covered'); await clickPay(f.page)
    await f.page.waitForFunction(() => document.querySelector('h1')?.textContent.includes('Your seats are secured'))
    assert.equal(new URL(f.page.url()).pathname, '/book/done/'); assert.equal(f.calls.filter(call => call.path === '/api/booking/checkout').length, 1)
    const copy = await f.page.$eval('main', node => node.textContent)
    assert.match(copy, /Awaiting minimum attendance/); assert(!copy.includes('Pay for your seats')); assert(!copy.includes('menu interview'))
    assert(f.calls.filter(call => call.path === '/api/booking/status').length >= 2)
    await f.page.close()
  })
  await check('an unbound paid claim cannot hide the payment button or claim secured seats', async () => {
    const f = await pageWith('wrong'); await clickPay(f.page); await f.page.waitForSelector('[role=alert]')
    assert(!(await f.page.$eval('h1', node => node.textContent)).includes('Your seats are secured'))
    assert(await f.page.evaluate(() => [...document.querySelectorAll('button')].some(node => node.textContent === 'Pay for your seats' && !node.disabled)))
    assert.equal(new URL(f.page.url()).pathname, '/book/done/'); await f.page.close()
  })
  await check('a lost covered-payment result retries the same action and then shows the authoritative paid receipt', async () => {
    const f = await pageWith('dropped'); await clickPay(f.page); await f.page.waitForSelector('[role=alert]')
    await f.page.waitForFunction(() => [...document.querySelectorAll('button')].some(node => node.textContent === 'Pay for your seats' && !node.disabled))
    await clickPay(f.page); await f.page.waitForFunction(() => document.querySelector('h1')?.textContent.includes('Your seats are secured'))
    const writes = f.calls.filter(call => call.path === '/api/booking/checkout'); assert.equal(writes.length, 2); assert.equal(writes[0].body.requestId, writes[1].body.requestId)
    assert.equal(new URL(f.page.url()).pathname, '/book/done/'); await f.page.close()
  })
  assert.deepEqual(errors, []); assert.deepEqual(blocked, [])
  const sources = ['src/booking/StatusPages.tsx', 'src/booking/api.ts', 'src/booking/types.ts']
  await writeFile(resolve(directory, 'results.json'), JSON.stringify({ at: new Date().toISOString(), checks, browserErrors: errors, blockedExternalRequests: blocked, sourceHashes: Object.fromEntries(await Promise.all(sources.map(async path => [path, createHash('sha256').update(await readFile(resolve(root, path))).digest('hex')]))), scope: 'Actual receipt component and client; mocked financial/API transport. No provider charge, ledger capture or live customer record.' }, null, 2) + '\n')
  console.log(`Passed ${checks.length} actual gift-covered receipt checks; no live financial operations.`)
} finally { await browser?.close() }
