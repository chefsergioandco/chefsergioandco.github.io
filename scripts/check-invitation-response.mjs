import assert from 'node:assert/strict'
import http from 'node:http'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises'
import { resolve, join, extname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const root = fileURLToPath(new URL('../', import.meta.url))
await mkdir(join(root, 'tmp'), { recursive: true })
const temporary = await mkdtemp(join(root, 'tmp/invitation-response-check-'))
const output = join(root, 'output/invitation-response')
const invitationId = 'invite_fictional-rsvp', accessToken = 'b'.repeat(64), responseToken = 'a'.repeat(64)
let browser, server, count = 0
const pass = name => { count++; console.log('PASS ' + name) }
try {
  const module = join(temporary, 'response.mjs')
  await build({ entryPoints: [join(root, 'src/invitations/InvitationResponse.tsx')], outfile: module, bundle: true, packages: 'external', platform: 'node', format: 'esm', jsx: 'automatic', loader: { '.css': 'empty' }, define: { 'import.meta.env': '{}' } })
  const { InvitationResponse } = await import(pathToFileURL(module).href)
  const html = renderToStaticMarkup(React.createElement(InvitationResponse, { invitationId, accessToken, invitationVersion: 9 }))
  assert(html.includes('Will you join us?')); assert(html.includes('Opening your response…'))
  assert(!html.includes(accessToken)); assert(!html.includes(responseToken)); assert(!html.includes('data-invitation-face'))
  pass('SSR is a private operational form, without capability disclosure or paper artwork')
  if (!process.argv.includes('--static-only')) {
    const require = createRequire(import.meta.url)
    const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
    const built = await build({
      stdin: { loader: 'tsx', resolveDir: join(root, 'src'), contents: `
        import React from 'react'; import {createRoot} from 'react-dom/client';
        import {InvitationResponse} from './invitations/InvitationResponse'; import {booking} from './content/booking';
        import {InvitationPage,InvitationPreview} from './invitations/InvitationPage';
        booking.apiBase='https://rsvp.example.test';
        const query=new URLSearchParams(location.search),missing=query.has('missing');
        const root=createRoot(document.getElementById('root'));
        const response=version=><InvitationResponse invitationId={missing?'':${JSON.stringify(invitationId)}} accessToken={missing?'':${JSON.stringify(accessToken)}} invitationVersion={version}/>;
        // The host changing the event gives the open page a new invitation version.
        window.fixtureInvitationVersion=version=>root.render(response(version));
        root.render(query.has('page-preview')?<InvitationPreview/>:query.has('page')?<InvitationPage/>:response(9));
      ` },
      outdir: '/fixture', entryNames: 'entry', bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false, external: ['/invitations/*'], define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}', 'import.meta.env.BASE_URL': '"/"', '__SITE_MODE__': '"prototype"', '__LOOK__': '"c"', '__PLATING_SEQUENCE_AVAILABLE__': 'false' },
    })
    const files = new Map(built.outputFiles.map(file => [file.path, file.contents]))
    server = http.createServer(async (request, response) => {
      const path = new URL(request.url, 'http://localhost').pathname
      try {
        if (path === '/') {
          const query = new URL(request.url, 'http://localhost').searchParams, integrated = query.has('page') || query.has('page-preview')
          response.setHeader('Content-Type', 'text/html'); response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fictional private response fixture</title><link rel="stylesheet" href="/fixture/entry.css"><style>@font-face{font-family:Archivo;src:url('/invitations/archivo-core-wght.woff2')}@font-face{font-family:'EB Garamond';src:url('/invitations/eb-garamond-core-wght.woff2')}body{margin:0;background:#fcfaf5;color:#2d2b27}.fixture-wrap{width:${integrated ? '100%' : 'min(540px,calc(100% - 40px))'};margin:${integrated ? '0' : '32px auto 64px'}}</style><div class="fixture-wrap"><div id="root"></div></div><script type="module" src="/fixture/entry.js"></script></html>`); return
        }
        if (files.has(path)) { response.setHeader('Content-Type', path.endsWith('.css') ? 'text/css' : 'text/javascript'); response.end(files.get(path)); return }
        if (/^\/(?:invitations|brand)\/[A-Za-z0-9._-]+$/.test(path)) { response.setHeader('Content-Type', extname(path) === '.svg' ? 'image/svg+xml' : 'font/woff2'); response.end(await readFile(join(root, 'public', path))); return }
        response.writeHead(404); response.end('Not found')
      } catch { response.writeHead(500); response.end('Fixture unavailable') }
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${server.address().port}`
    browser = await playwright.chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) })
    const context = await browser.newContext({ viewport: { width: 1120, height: 1200 } })
    await context.addInitScript(() => {
      window.fixtureFetchOptions = []
      const original = window.fetch.bind(window)
      window.fetch = (input, init) => {
        window.fixtureFetchOptions.push({ credentials: init?.credentials, cache: init?.cache, referrerPolicy: init?.referrerPolicy })
        return original(input, init)
      }
    })
    const page = await context.newPage(), calls = [], errors = []
    page.setDefaultTimeout(10_000); page.on('pageerror', error => errors.push(error.message))
    let saved = null, mutationMode = 'uncertain', mutationCount = 0, pendingReply, pendingArrival
    const hostLinkCalls = []
    await context.route('https://rsvp.example.test/api/invitation**', async route => {
      const request = route.request(), url = new URL(request.url()), headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'content-type,x-booking-request', 'Access-Control-Allow-Methods': 'POST,OPTIONS' }
      if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return }
      const body = request.postDataJSON()
      // After the evening, the page asks for the host's link with the same private proof; before it, there's none.
      if (url.pathname === '/api/invitation/referral') { hostLinkCalls.push(body); assert.equal(body.id, invitationId); assert.equal(body.accessToken, accessToken); await route.fulfill({ json: { available: false }, headers }); return }
      calls.push({ path: url.pathname, method: request.method(), body, headers: request.headers() })
      assert.equal(body.id, invitationId); assert.equal(body.accessToken, accessToken)
      if (url.pathname === '/api/invitation') {
        assert.deepEqual(Object.keys(body).sort(), body.responseToken ? ['accessToken','id','responseToken'] : ['accessToken','id'])
        const ownResponse = body.responseToken === responseToken && saved ? saved : undefined
        await route.fulfill({ json: { id: invitationId, version: 9, title: 'A fictional staged evening', hostName: 'A fictional host', date: '2099-02-14', time: '18:30', timeZone: 'America/New_York', venueName: 'Fictional dining room', address: ['123 Example Lane', 'Example City'], guestCount: 4, menuReady: true, menu: 'Sample starter\nSample main', ...(ownResponse ? { ownResponse } : {}) }, headers }); return
      }
      assert.equal(url.pathname, '/api/invitation/rsvp'); mutationCount++
      assert.match(body.requestId, /^[0-9a-f-]{36}$/)
      const answers = { name: body.name, email: body.email, attending: body.attending, dietary: body.dietary, allergies: body.allergies }
      if (mutationMode === 'conflict') {
        saved = { ...saved, name: 'Latest saved guest', revision: 2 }; mutationMode = 'success'
        await route.fulfill({ status: 409, json: { error: { message: 'Your response changed in another session. Please review it.' } }, headers }); return
      }
      if (mutationMode === 'incomplete') { await route.fulfill({ json: { ok: true, responseToken }, headers }); return }
      saved = { ...answers, revision: body.responseToken ? body.version + 1 : 0 }
      if (mutationMode === 'pending') {
        mutationMode = 'success'
        pendingReply = () => route.fulfill({ json: { ok: true, responseToken, version: saved.revision }, headers })
        pendingArrival?.()
        return
      }
      if (mutationMode === 'uncertain') { mutationMode = 'success'; await route.fulfill({ status: 503, json: { message: 'The response could not be confirmed. Retry to recover it.' }, headers }); return }
      await route.fulfill({ json: { ok: true, responseToken, version: saved.revision }, headers })
    })
    await page.goto(origin + '/?missing')
    await page.getByRole('alert').filter({ hasText: 'Open the complete private invitation link' }).waitFor()
    assert.equal(calls.length, 0); assert.equal(await page.locator('form').count(), 0)
    pass('missing invitation proof makes no API call and offers no submit action')
    await page.goto(origin)
    const name = page.getByLabel('Your name', { exact: true }), email = page.getByLabel('Email (optional)', { exact: true })
    await name.waitFor(); assert.equal(await name.inputValue(), '')
    assert.equal(calls.length, 1); assert.equal(calls[0].path, '/api/invitation')
    await page.getByRole('button', { name: 'Send my response' }).click()
    assert.equal(await name.evaluate(node => document.activeElement === node), true); assert.equal(mutationCount, 0)
    await name.fill('Sample guest'); await email.fill('invalid')
    await page.getByRole('button', { name: 'Send my response' }).click()
    assert.equal(await email.evaluate(node => document.activeElement === node), true); assert.equal(mutationCount, 0)
    await email.fill('')
    await page.getByLabel('Dietary needs (optional)', { exact: true }).fill('Sample dietary report')
    await page.getByLabel('Allergies (optional)', { exact: true }).fill('Sample allergy report')
    assert.equal(await page.getByText('Submitting a requirement does not confirm it can be accommodated.', { exact: false }).count(), 1)
    pass('fresh guests stay unnamed; required name and optional email validate with focus; dietary reports make no accommodation promise')
    await page.getByRole('button', { name: 'Send my response' }).click()
    await page.getByRole('alert').filter({ hasText: 'Retry to recover it.' }).waitFor()
    assert.equal(await page.getByRole('status').count(), 0)
    assert.equal(await name.inputValue(), 'Sample guest')
    const firstAttempt = calls.filter(call => call.path.endsWith('/rsvp'))[0].body
    assert.equal('version' in firstAttempt, false); assert.equal('responseToken' in firstAttempt, false)
    await page.getByRole('button', { name: 'Send my response' }).click()
    await page.getByRole('status').filter({ hasText: 'Your response is saved.' }).waitFor()
    const secondAttempt = calls.filter(call => call.path.endsWith('/rsvp'))[1].body
    assert.deepEqual(secondAttempt, firstAttempt)
    assert.equal(await page.getByRole('status').evaluate(node => document.activeElement === node), true)
    const memory = await page.evaluate(() => ({ session: Object.entries(sessionStorage), local: Object.entries(localStorage) }))
    assert.deepEqual(memory.session, [['invitation-response:' + invitationId, JSON.stringify({ token: responseToken, version: 0 })]])
    assert.deepEqual(memory.local, [])
    pass('uncertain saves retain answers and retry the identical request ID; confirmed response stores only its own token/revision in sessionStorage')
    await name.fill('Updated sample guest')
    await page.getByRole('button', { name: 'Update my response' }).click()
    await page.getByRole('status').filter({ hasText: 'Your response is saved.' }).waitFor()
    const update = calls.filter(call => call.path.endsWith('/rsvp')).at(-1).body
    assert.equal(update.responseToken, responseToken); assert.equal(update.version, 0); assert.notEqual(update.requestId, firstAttempt.requestId)
    await page.reload(); await name.waitFor(); assert.equal(await name.inputValue(), 'Updated sample guest')
    const reload = calls.filter(call => call.path === '/api/invitation').at(-1).body
    assert.equal(reload.responseToken, responseToken); assert.equal('version' in reload, false)
    pass('updates use the own-response revision, never invitation version; reload reads only that capability-protected response')
    mutationMode = 'conflict'; await name.fill('Unsaved working answer')
    await page.getByRole('button', { name: 'Update my response' }).click()
    await page.getByRole('alert').filter({ hasText: 'changed in another session' }).waitFor()
    assert.equal(await name.inputValue(), 'Unsaved working answer')
    assert.equal(await page.getByRole('alert').evaluate(node => document.activeElement === node), true)
    await page.getByRole('button', { name: 'Reload my saved response' }).click()
    await page.waitForFunction(() => document.querySelector('input[autocomplete="name"]')?.value === 'Latest saved guest')
    assert.equal(await name.inputValue(), 'Latest saved guest')
    await name.fill('Reviewed guest response'); await page.getByRole('button', { name: 'Update my response' }).click()
    await page.getByRole('status').filter({ hasText: 'Your response is saved.' }).waitFor()
    assert.equal(calls.filter(call => call.path.endsWith('/rsvp')).at(-1).body.version, 2)
    pass('revision conflicts preserve working answers and require explicit reload before using the latest saved revision')
    mutationMode = 'incomplete'; await name.fill('Unconfirmed response')
    await page.getByRole('button', { name: 'Update my response' }).click()
    await page.getByRole('alert').filter({ hasText: 'Retry to recover the same response.' }).waitFor()
    assert.equal(await page.getByRole('status').count(), 0)
    assert.deepEqual(JSON.parse(await page.evaluate(key => sessionStorage.getItem(key), 'invitation-response:' + invitationId)), { token: responseToken, version: 3 })
    pass('an incomplete receipt never shows success or overwrites the last verified own-response revision')
    await mkdir(output, { recursive: true }); await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: join(output, 'desktop.png'), fullPage: true, animations: 'disabled' })
    await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: join(output, 'mobile.png'), fullPage: true, animations: 'disabled' })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    const heights = await page.locator('button,.invitation-response-choice').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height))
    assert(heights.every(height => height >= 44))
    await page.getByRole('radio', { name: 'I can’t make it' }).focus(); await page.keyboard.press('Space')
    assert.equal(await page.getByRole('radio', { name: 'I can’t make it' }).isChecked(), true)
    assert.equal(await page.locator('textarea').count(), 0)
    pass('mobile has no overflow, targets meet 44px, and keyboard decline hides optional requirements')
    mutationMode = 'pending'
    const beforePending = mutationCount
    const arrived = new Promise(resolve => { pendingArrival = resolve })
    await page.getByRole('button', { name: 'Update my response' }).click()
    await arrived
    await page.getByRole('button', { name: 'Saving…' }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Saving…' }).isDisabled(), true)
    assert.equal(await name.isDisabled(), true)
    await page.getByRole('button', { name: 'Saving…' }).evaluate(node => node.click())
    assert.equal(mutationCount, beforePending + 1)
    await pendingReply()
    await page.getByRole('status').filter({ hasText: 'Your response is saved.' }).waitFor()
    pass('an active save disables the form and prevents duplicate submissions')
    const readsSoFar = () => calls.filter(call => call.path === '/api/invitation').length
    let reads = readsSoFar()
    saved = { ...saved, name: 'Saved on another device', revision: saved.revision + 1 }
    await page.evaluate(() => window.fixtureInvitationVersion(10))
    await page.waitForFunction(() => document.querySelector('input[autocomplete="name"]')?.value === 'Saved on another device')
    assert.equal(readsSoFar(), reads + 1)
    pass('when the host changes the event, an untouched form shows the latest saved answers')
    await name.fill('Typed but not sent'); reads = readsSoFar()
    await page.evaluate(() => { window.fixtureFormRemoved = false; new MutationObserver(() => { if (!document.querySelector('form')) window.fixtureFormRemoved = true }).observe(document.body, { childList: true, subtree: true }) })
    await page.evaluate(() => window.fixtureInvitationVersion(11))
    for (let wait = 0; readsSoFar() === reads && wait < 100; wait++) await page.waitForTimeout(50)
    await page.waitForTimeout(300)
    assert.equal(readsSoFar(), reads + 1)
    assert.equal(await name.inputValue(), 'Typed but not sent')
    assert.equal(await name.evaluate(node => document.activeElement === node), true)
    assert.equal(await page.evaluate(() => window.fixtureFormRemoved), false)
    assert.equal(await page.getByText('Opening your response…').count(), 0)
    pass('when the host changes the event mid-answer, the form stays open with the guest’s unsent answers and focus')
    const fetchOptions = await page.evaluate(() => window.fixtureFetchOptions)
    assert(fetchOptions.every(options => options.credentials === 'omit' && options.cache === 'no-store' && options.referrerPolicy === 'no-referrer'))
    const blocked = await context.newPage(); blocked.setDefaultTimeout(10_000)
    await blocked.addInitScript(() => { Object.defineProperty(window, 'sessionStorage', { get() { throw new DOMException('Fictional blocked storage', 'SecurityError') } }) })
    await blocked.goto(origin)
    const blockedName = blocked.getByLabel('Your name', { exact: true })
    await blockedName.waitFor(); assert.equal(await blockedName.inputValue(), '')
    await blockedName.fill('Storage blocked sample')
    await blocked.getByRole('button', { name: 'Send my response' }).click()
    await blocked.getByRole('status').filter({ hasText: 'Your response is saved.' }).waitFor()
    await blockedName.fill('Storage blocked update')
    await blocked.getByRole('button', { name: 'Update my response' }).click()
    await blocked.getByRole('status').filter({ hasText: 'Your response is saved.' }).waitFor()
    assert.equal(calls.filter(call => call.path.endsWith('/rsvp')).at(-1).body.responseToken, responseToken)
    pass('blocked session storage still supports confirmed save and own-response update in the current page')
    await blocked.close()
    const invalid = await context.newPage(); invalid.setDefaultTimeout(10_000)
    await invalid.addInitScript(({ key, token }) => sessionStorage.setItem(key, JSON.stringify({ token, version: 0 })), { key: 'invitation-response:' + invitationId, token: 'c'.repeat(64) })
    const beforeInvalid = mutationCount
    await invalid.goto(origin)
    await invalid.getByRole('alert').filter({ hasText: 'Your saved response could not be verified.' }).waitFor()
    assert.equal(await invalid.locator('form').count(), 0); assert.equal(mutationCount, beforeInvalid)
    pass('an unverifiable saved response cannot silently create a second guest response')
    await invalid.close()
    assert.deepEqual(errors, [])
    assert(calls.every(call => call.method === 'POST' && call.headers['x-booking-request'] === '1' && !call.headers.authorization && !call.headers.cookie))
    assert(calls.every(call => !('visitorKey' in call.body)))
    pass('all intercepted requests use the private booking transport, without Auth0, cookies, guest-list calls or client visitor identity')
    const mounted = await context.newPage(); mounted.setDefaultTimeout(10_000)
    await mounted.goto(origin + '/?page&id=' + invitationId + '#invite=' + accessToken)
    await mounted.locator('.invitation-response').waitFor({ state: 'attached' })
    await mounted.waitForFunction(() => document.querySelector('.invitation-body')?.inert === true)
    assert.equal(await mounted.locator('.invitation-details').getAttribute('data-ready'), 'false')
    assert.equal(await mounted.locator('.invitation-response').evaluate(node => node.previousElementSibling?.classList.contains('invitation-contact')), true)
    await mounted.locator('.invitation-opening-skip').focus(); await mounted.keyboard.press('Enter')
    await mounted.locator('.invitation-details[data-ready="true"]').waitFor()
    await mounted.getByLabel('Your name', { exact: true }).waitFor()
    assert.equal(await mounted.locator('.invitation-details').evaluate(node => node.inert), false)
    assert.equal(await mounted.getByLabel('Your name', { exact: true }).inputValue(), '')
    await mounted.getByLabel('Your name', { exact: true }).scrollIntoViewIfNeeded()
    await mounted.screenshot({ path: join(output, 'mounted-below-contact.png'), animations: 'disabled' })
    pass('the real legacy page mounts RSVP below contact inside the existing inert details gate')
    const callsBeforePreview = calls.length
    await mounted.goto(origin + '/?page-preview&id=' + invitationId + '#invite=' + accessToken)
    await mounted.locator('[data-invitation-face="cover"]').waitFor({ state: 'attached' })
    assert.equal(await mounted.locator('.invitation-response').count(), 0)
    assert.equal(calls.length, callsBeforePreview)
    await mounted.goto(origin + '/?page#token=fictional-modern-proof')
    await mounted.getByText('The invitation service is not available here yet.', { exact: false }).waitFor()
    assert.equal(await mounted.locator('.invitation-response').count(), 0)
    assert.equal(calls.length, callsBeforePreview)
    pass('preview and modern-token pages never mount the legacy RSVP form or forward that proof')
    await mounted.close()
    await context.close()
  }
  console.log(`\n${count} invitation response checks passed. Fictional local fixtures only; no real API, email, provider or customer writes.`)
} finally { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); await rm(temporary, { recursive: true, force: true }) }
