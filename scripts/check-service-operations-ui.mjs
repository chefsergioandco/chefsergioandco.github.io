import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import puppeteer from 'puppeteer-core'

const root = fileURLToPath(new URL('../', import.meta.url))
const temporary = await mkdtemp(join(tmpdir(), 'sergio-service-operations-'))
const outputFlag = process.argv.indexOf('--evidence-dir')
const evidenceDir = outputFlag >= 0 ? process.argv[outputFlag + 1] : null
let browser, server, checks = 0
const check = async (name, action) => { await action(); checks++; console.log('PASS ' + name) }
const now = new Date(), at = now.toISOString(), startedAt = new Date(+now - 2 * 60_000).toISOString(), nextAt = new Date(+now + 15 * 60_000).toISOString()

try {
  await build({absWorkingDir: root, entryPoints: ['admin/src/service-operations-types.ts'], outfile: join(temporary, 'contract.mjs'), bundle: true, platform: 'node', format: 'esm', logLevel: 'silent'})
  const contract = await import(pathToFileURL(join(temporary, 'contract.mjs')))
  const fixture = {
    version: 1, checkedAt: at,
    services: contract.SERVICE_IDS.map((id, index) => ({id, label: ['Secure sign-in', 'Card payments', 'Guest email', 'Newsletter', 'Gift cards', 'Public booking', 'Website publishing', 'Calendar & Meet'][index], status: ['ready', 'ready', 'limited', 'blocked', 'unknown', 'ready', 'not_connected', 'not_connected'][index], summary: 'Fictional setup evidence for ' + id + '.', reasons: index === 2 ? ['The business sender needs review.'] : [], owner: 'Business owner or service administrator', target: {section: id === 'identity' ? 'privacy' : id === 'email' ? 'communications' : id === 'gifts' ? 'payments' : id === 'booking' ? 'bookings' : id === 'publishing' ? 'website' : id === 'payments' || id === 'newsletter' || id === 'calendar' ? id : 'operations'}})),
    jobs: contract.JOB_KEYS.map((key, index) => ({key, label: ['Guest email dispatch', 'Newsletter sync'][index] || key.replaceAll('_', ' '), kind: index < 2 || index > 9 ? 'job' : 'probe', status: index === 0 ? 'healthy' : index === 1 ? 'failed' : index === 4 ? 'overdue' : 'never_recorded', enabled: index !== 3, lastRun: index < 2 ? {id: 'run-' + index, startedAt, finishedAt: at, outcome: index === 0 ? 'succeeded' : 'failed', summary: index === 0 ? 'The saved dispatch run completed.' : 'The saved newsletter run requires review.'} : null, nextExpectedAt: index === 3 ? null : nextAt, target: {section: index === 1 ? 'newsletter' : 'communications', ...(index === 1 ? {view: 'history', recordId: 'campaign-fixture-1'} : {})}})),
    attention: [
      {id: 'email-fixture-attention', area: 'email', severity: 'error', title: 'Guest message needs review', summary: 'A saved fictional delivery needs an individual decision.', at, target: {section: 'communications', recordId: 'email-fixture-7', bookingId: 'WEB-fixture-1'}},
      {id: 'privacy-fixture-attention', area: 'privacy', severity: 'warning', title: 'Source collection is incomplete', summary: 'Review the exact fictional request before releasing its response.', at: null, target: {section: 'privacy', recordId: 'pr_fixture7', view: 'request'}},
    ],
    limits: {maxAttention: 100, maxRunsPerJob: 1, truncated: false, historyAvailable: true},
  }
  await check('contract accepts complete evidence, safe record targets and honest never-recorded states', () => assert(contract.isOperationsResponse(fixture)))
  await check('contract rejects missing coverage, malformed targets, duplicate records and invented healthy evidence', () => {
    for (const mutate of [value => value.jobs.pop(), value => value.services.pop(), value => value.jobs[3].status = 'healthy', value => value.jobs[0].lastRun = null, value => value.jobs[0].lastRun.outcome = 'running', value => value.jobs[1].lastRun.finishedAt = null, value => value.services[0] = null, value => value.attention[1].id = value.attention[0].id, value => value.services[0].target = {section: 'https://outside.invalid'}, value => value.attention[0].target.recordId = 'person@example.test', value => value.checkedAt = 'today']) {
      const value = structuredClone(fixture); mutate(value); assert.equal(contract.isOperationsResponse(value), false)
    }
  })
  await build({absWorkingDir: root, stdin: {resolveDir: root, loader: 'tsx', contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import ServiceOperations from './admin/src/ServiceOperations';import './admin/src/styles.css';
    window.__operationsPayload=${JSON.stringify(fixture)};window.__operationsRequests=[];window.__operationsTargets=[];window.__operationsFailure=0;
    window.fetch=async(input,init={})=>{window.__operationsRequests.push({url:String(input),method:init.method||'GET'});if(String(input)!=='/api/operations'||(init.method||'GET')!=='GET')throw new Error('Unexpected fixture request');await new Promise(resolve=>setTimeout(resolve,20));return Response.json(window.__operationsFailure?{}:window.__operationsPayload,{status:window.__operationsFailure||200})};
    createRoot(document.getElementById('app')).render(<ServiceOperations onNavigate={target=>window.__operationsTargets.push(target)}/>);
  `}, outfile: join(temporary, 'entry.js'), bundle: true, platform: 'browser', format: 'esm', external: ['/fonts/*'], logLevel: 'silent'})
  server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname
    if (path === '/') {response.writeHead(200, {'Content-Type': 'text/html'}); response.end('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Service operations fixture</title><link rel="stylesheet" href="/entry.css"><main id="app" style="padding:28px;max-width:1120px;margin:auto"></main><script type="module" src="/entry.js"></script></html>');return}
    if (['/entry.js', '/entry.css'].includes(path)) {response.writeHead(200, {'Content-Type': path.endsWith('.css') ? 'text/css' : 'application/javascript'});response.end(await readFile(join(temporary, path.slice(1))));return}
    if (/^\/fonts\/[A-Za-z0-9_.-]+\.woff2$/.test(path)) {for(const directory of ['admin/public','public']){try {const content=await readFile(join(root,directory,path));response.writeHead(200, {'Content-Type': 'font/woff2'});response.end(content);return}catch{}}}
    response.writeHead(404);response.end()
  })
  await new Promise((resolve, reject) => {server.once('error', reject);server.listen(0, '127.0.0.1', resolve)})
  const origin = 'http://127.0.0.1:' + server.address().port
  const executablePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  assert(existsSync(executablePath), 'A local Chrome executable is required for the browser check.')
  browser = await puppeteer.launch({executablePath, headless: true, userDataDir: join(temporary, 'chrome-profile'), args: ['--no-sandbox', '--disable-dev-shm-usage']})
  const page = await browser.newPage(), errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setRequestInterception(true)
  page.on('request', request => request.url().startsWith(origin + '/') ? request.continue() : request.abort())
  await page.setViewport({width: 1280, height: 1000})
  await page.goto(origin, {waitUntil: 'networkidle0'})
  await page.waitForSelector('.operations-service')
  const openView = async name => {await page.evaluate(value => [...document.querySelectorAll('[role="tab"]')].find(button => button.textContent.startsWith(value)).click(), name)}
  const refresh = async () => {await page.click('.operations-heading > button');await page.waitForFunction(() => !document.querySelector('.operations-heading > button').disabled)}
  await check('Connections renders actual ready, limited, blocked, disconnected and unknown labels', async () => {
    assert.equal(await page.$$eval('.operations-service', items => items.length), 8)
    for (const status of ['ready', 'limited', 'blocked', 'not_connected', 'unknown']) assert(await page.$('.service-' + status))
    assert((await page.$eval('.operations-intro', node => node.textContent)).includes('not proof of a completed transaction'))
    assert((await page.$eval('.operations-checked', node => node.textContent)).includes('All times Eastern'))
  })
  if (evidenceDir) {await mkdir(evidenceDir, {recursive: true});await page.screenshot({path: join(evidenceDir, 'frontend-connections-desktop.png'), fullPage: true})}
  await check('Background work exposes real last-run evidence and honest missing/overdue states', async () => {
    await openView('Background work'); assert.equal(await page.$$eval('.operations-job', nodes => nodes.length), 13)
    assert(await page.$('.job-failed'));assert(await page.$('.job-overdue'));assert(await page.$('.job-never_recorded'))
    await page.click('.operations-run-evidence > summary')
    assert((await page.$eval('.operations-run-evidence', node => node.textContent)).includes('run-0'))
    await page.evaluate(() => document.querySelectorAll('.operations-job')[1].querySelector('button').click())
    assert.deepEqual(await page.evaluate(() => window.__operationsTargets.at(-1)), {section: 'newsletter', view: 'history', recordId: 'campaign-fixture-1'})
  })
  await check('Arrow/Home/End tab navigation and exact-record recovery preserve target metadata', async () => {
    await page.focus('[role="tab"][aria-selected="true"]');await page.keyboard.press('End')
    assert((await page.$eval('[role="tab"][aria-selected="true"]', node => node.textContent)).startsWith('Needs attention'))
    assert.equal(await page.$eval('[role="tab"][aria-selected="true"]', node => node === document.activeElement), true)
    await page.click('.operations-attention-group .operations-review')
    assert.deepEqual(await page.evaluate(() => window.__operationsTargets.at(-1)), {section: 'communications', recordId: 'email-fixture-7', bookingId: 'WEB-fixture-1'})
    await page.focus('[role="tab"][aria-selected="true"]');await page.keyboard.press('Home');await page.keyboard.press('ArrowRight')
    assert((await page.$eval('[role="tab"][aria-selected="true"]', node => node.textContent)).startsWith('Background work'))
  })
  await check('History unavailable, unknown setup and bounded attention are visible without fabricated success', async () => {
    await page.evaluate(() => {window.__operationsPayload.limits.historyAvailable=false;window.__operationsPayload.limits.truncated=true;for(const service of window.__operationsPayload.services)service.status='unknown';for(const job of window.__operationsPayload.jobs){job.status='unknown';job.lastRun=null}})
    await refresh();await openView('Background work')
    assert((await page.$eval('.operations-notice', node => node.textContent)).includes('Saved run history is unavailable'))
    assert.equal(await page.$('.job-healthy'), null)
    await openView('Connections');assert.equal(await page.$$eval('.service-unknown', nodes => nodes.length), 8)
    await openView('Needs attention');assert((await page.$eval('.operations-notice', node => node.textContent)).includes('Showing the first'))
  })
  await check('Malformed or failed refresh keeps earlier evidence explicitly marked out of date', async () => {
    await page.evaluate(() => window.__operationsPayload.jobs.pop());await refresh()
    assert((await page.$eval('[role="alert"]', node => node.textContent)).includes('incomplete'))
    assert((await page.$eval('.operations-checked', node => node.textContent)).includes('Earlier report'))
    await page.evaluate(() => window.__operationsFailure=503);await refresh()
    assert((await page.$eval('[role="alert"]', node => node.textContent)).includes('out of date'))
  })
  await check('Revoked administrator access clears private diagnostic evidence', async () => {
    await page.evaluate(() => window.__operationsFailure=403);await refresh()
    assert.equal(await page.$('.operations-service, .operations-job, .operations-attention-group'), null)
    assert((await page.$eval('[role="alert"]', node => node.textContent)).includes('approved administrator'))
  })
  await page.setViewport({width: 390, height: 844});await page.emulateMediaFeatures([{name: 'prefers-reduced-motion', value: 'reduce'}]);await page.reload({waitUntil: 'networkidle0'});await page.waitForSelector('.operations-service');await openView('Needs attention')
  await check('Phone/reduced-motion layout remains readable and every network action is a diagnostic GET', async () => {
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    assert.equal(await page.$eval('.operations-review', node => getComputedStyle(node).animationName), 'none')
    assert((await page.evaluate(() => window.__operationsRequests)).every(request => request.url === '/api/operations' && request.method === 'GET'))
    assert.deepEqual(errors, [])
  })
  if (evidenceDir) {await page.screenshot({path: join(evidenceDir, 'frontend-attention-mobile.png'), fullPage: true});await writeFile(join(evidenceDir, 'frontend-checks.json'), JSON.stringify({checkedAt: new Date().toISOString(), checks, passed: true, browser: 'Isolated headless Chrome', input: 'Automated mouse and keyboard; phone viewport emulation', providerActions: false, limits: ['Fictional API transport, not hosted backend acceptance', 'No physical phone, native screen reader or uncoached human acceptance']}, null, 2) + '\n')}
  console.log(`${checks} Service operations frontend checks passed.`)
} finally {
  if (browser) await browser.close()
  if (server?.listening) await new Promise(resolve => server.close(resolve))
  await rm(temporary, {recursive: true, force: true})
}
