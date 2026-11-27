/** Local browser contracts only. Fictional SDK/API fixtures never contact Auth0 or customer systems. */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { transform } from 'esbuild'
import puppeteer from 'puppeteer-core'
// Import the application's public configuration without Vite or any credential store.
const configSource = await fs.readFile(new URL('../src/account/config.ts', import.meta.url), 'utf8')
const compiled = await transform(configSource.replaceAll('import.meta.env.VITE_AUTH0_SPA_CLIENT_ID', '""'), { loader: 'ts', format: 'esm', target: 'es2022' })
const { accountConfig } = await import('data:text/javascript;base64,' + Buffer.from(compiled.code).toString('base64'))
const apiOrigin = new URL(accountConfig.apiOrigin).origin
assert.equal(apiOrigin, 'https://chef-sergio-staging.chefsergioandco.workers.dev')
assert.equal(accountConfig.audience, 'https://chefsergioandco.github.io/staging-api')
let adminIdentity = false
const base = (process.env.CHECK_BASE_URL || 'http://127.0.0.1:4427').replace(/\/$/, '')
const localOrigin = new URL(base).origin
const directory = 'output/staging-account'
await fs.mkdir(directory, { recursive: true })
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const checks = [], errors = [], routeErrors = [], blockedExternal = []
const pass = label => { checks.push(label); console.log('PASS ' + label) }
let profile = { displayName: 'Alex', preferences: 'An unhurried evening.', email: 'alex@example.test', emailVerified: true }, saved = []
let emailVerified = true, bookingsStatus = 200, menusStatus = 200, extraBookings = []
const edition = { text: 'An evening at your table\n\nGarden tomatoes\nRoasted seasonal vegetables\nCitrus and cream', finalizedAt: '2026-11-20T12:00:00Z', version: 'a'.repeat(64) }
const booking = { id: 'CS-fixture', service: 'Private dinner', date: '2099-12-20', time: '18:00', status: 'confirmed', guests: 6, occasion: 'An evening together', location: 'At your table', actionUrl: base + '/book/done/?ref=CS-fixture#access=' + 'a'.repeat(43), planning: { menu: edition }, receipts: [{ id: 'rc_fixture', number: 'CS-2026-0001', type: 'payment', amountMinor: 90000, issuedAt: '2026-11-20T12:00:00Z' }], nextAction: { kind: 'view_menu', title: 'Your approved menu is ready.', detail: 'Open the current menu agreed with Sergio.' } }
const clickText = (page, selector, text) => page.evaluate(({ selector, text }) => { const node = [...document.querySelectorAll(selector)].find(node => node.textContent.trim() === text); if (!node) throw Error('Missing control: ' + text); node.click() }, { selector, text })
const tab = (page, text) => clickText(page, 'nav.ev-nav a', text)
const refreshDetails = async page => { const response=page.waitForResponse(response=>response.url().endsWith('/api/spa/customer/bookings')&&response.request().method()==='GET'); await clickText(page, 'button', 'Refresh details');await response;await page.waitForFunction(() => ![...document.querySelectorAll('main button')].some(node => node.textContent === 'Refreshing…')) }
try {
 const page = await browser.newPage(), network = []
 page.on('pageerror', error => errors.push(error.message))
 page.on('request', request => network.push(new URL(request.url()).pathname))
 await page.setViewport({ width: 1440, height: 1000 })
 await page.goto(base + '/', { waitUntil: 'networkidle0' })
 assert(!network.some(path => path.includes('auth0-spa-js') || path.startsWith('/api/spa/')))
 pass('anonymous homepage loads no Auth0 SDK or authenticated API request')
 await page.goto(base + '/account/sign-in/', { waitUntil: 'networkidle0' })
 assert.equal(await page.$eval('h1', node => node.textContent), 'Good to have you here.')
 await page.screenshot({ path: directory + '/sign-in-desktop.png', fullPage: true })
 await page.setViewport({ width: 390, height: 844 })
 assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
 await page.screenshot({ path: directory + '/sign-in-mobile.png', fullPage: true })
 pass('real SDK signed-out account page renders desktop and mobile without overflow')
 let authorization
 await page.setRequestInterception(true)
 page.on('request', request => { const url = new URL(request.url()); if (url.hostname.endsWith('.auth0.com')) { authorization = url; return request.abort() }; return request.continue() })
 const proof = 'c'.repeat(43)
 await page.goto(base + '/account/sign-in/?returnTo=' + encodeURIComponent('/dashboard/?ref=CS-sdk#access=' + proof), { waitUntil: 'networkidle0' })
 const authorize = async (label, connection) => {
   authorization = null
   await page.evaluate(label => [...document.querySelectorAll('.auth-panel button')].find(node => node.textContent.includes(label)).click(), label)
   await page.waitForFunction(() => document.readyState === 'complete').catch(() => {})
   for(let index=0; index<50&&!authorization; index++)await new Promise(resolve=>setTimeout(resolve,20))
   assert(authorization, 'SDK must begin a top-level authorization redirect')
   assert.equal(authorization.searchParams.get('response_type'),'code');assert.equal(authorization.searchParams.get('code_challenge_method'),'S256')
   assert.equal(authorization.searchParams.get('connection'),connection);assert.equal(authorization.searchParams.get('redirect_uri'),new URL(base).origin+accountConfig.callbackPath)
   assert.equal(authorization.searchParams.get('audience'),accountConfig.audience)
   assert(authorization.searchParams.get('scope').split(' ').includes('access:chef'));assert(!authorization.href.includes(proof))
   await page.goto(base + '/account/sign-in/', { waitUntil: 'networkidle0' })
 }
 await authorize('Continue with Google','google-oauth2')
 await authorize('Continue with email','Username-Password-Authentication')
 pass('official SDK starts Google/email top-level PKCE with the exact callback, audience and scope; proof stays out of the provider URL')
 const initial = await page.evaluate(() => { window.__pageSentinel = 'same-document'; return location.pathname })
 await page.click('a[href^="/account/create/"]')
 await page.waitForFunction(() => location.pathname === '/account/create/' && document.querySelector('h1')?.textContent === 'A place for your plans.')
 assert.equal(await page.evaluate(() => window.__pageSentinel), 'same-document')
 pass('local route navigation preserves the document and in-memory session owner')
 await page.goto(base + '/auth/callback/?success=true', { waitUntil: 'networkidle0' })
 await page.waitForFunction(() => location.pathname === '/account/verify-email/' && document.querySelector('main')?.textContent.includes('Sign in to verify your email'))
 assert((await page.$eval('main', node => node.textContent)).includes('Sign in to verify your email'))
 pass('verification landing without code/state never consumes an OAuth callback or grants verification')
 await page.close()
 const fixture = await browser.newPage(), writes = [], sdk = { count: 0 }
 fixture.on('pageerror', error => errors.push(error.message))
 await fixture.setRequestInterception(true)
 fixture.on('request', async request => {
  const url = new URL(request.url())
  try {
  if (url.origin === localOrigin && (url.pathname.includes('auth0-spa-js.production.esm-') || url.pathname.endsWith('/@auth0_auth0-spa-js.js'))) { sdk.count++; return request.respond({ status: 200, contentType: 'application/javascript', body: `export class Auth0Client { constructor(options){window.__sdkOptions=options;window.__sdkInstances=(window.__sdkInstances||0)+1} async getTokenSilently(options){if(options.cacheMode!=='cache-only')throw Error('iframe fallback forbidden');return 'fixture-only-token'} async handleRedirectCallback(){return {appState:{returnTo:'/dashboard/?ref=CS-fixture#access=${'a'.repeat(43)}'}}} async loginWithRedirect(){} async logout(){} }` }) }
  if (url.origin === apiOrigin) {
   if (request.method() === 'OPTIONS') return request.respond({ status: 204, headers: { 'Access-Control-Allow-Origin': new URL(base).origin, 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Authorization,Content-Type,X-Customer-Request' } })
   assert.equal(request.headers().authorization, 'Bearer fixture-only-token')
   const path = url.pathname.replace('/api/spa', ''), body = request.postData() ? JSON.parse(request.postData()) : null
   if (request.method() === 'POST') { assert.equal(request.headers()['x-customer-request'], '1'); writes.push({ path, body }) }
   let data, status = 200
   if (path === '/auth/session') data = { authenticated: true, identity: { sub: 'auth0|fixture', name: profile.displayName, email: profile.email, email_verified: emailVerified, isAdmin: adminIdentity, permissions: adminIdentity ? ['admin:access'] : [] }, csrfToken: null }
   else if (path === '/customer/bookings') { status = bookingsStatus; data = status === 200 ? { user: { name: profile.displayName, email: profile.email, emailVerified }, bookings: emailVerified ? [booking, ...extraBookings] : [] } : {error:{code:'access_denied',message:'Local fixture: booking access was revoked.'}} }
   else if (path === '/customer/profile') { if (body) profile = { ...profile, ...body }; data = { profile: {...profile,emailVerified} } }
   else if (path === '/customer/menus') { status = menusStatus; data = status === 200 ? { menus: saved } : {error:{code:'access_denied',message:'Local fixture: saved-menu access was revoked.'}} }
   else if (path === '/customer/privacy') data = {requests:[]}
   else if (path === '/customer/newsletter-preference') data = {newsletter:{status:'not_subscribed',consentVersion:null,updatedAt:null}}
   else if (path === '/account/security') data = { email: profile.email, emailVerified, verificationResendEnabled: false, verificationCheckEnabled: true, passwordResetEnabled: true, passwordProvider: 'auth0', passwordResetEmail: profile.email, methodsVerified: true, methods: [{provider:'auth0',label:'Email and password',primary:true,passwordManagedBy:'auth0'}],googleDisconnect:{available:false,mode:'not_connected',reason:'not_connected'} }
   else if (path === '/customer/menus/save') { if(body.version !== edition.version) {status=409;data={error:{code:'menu_changed',message:'The approved menu changed. Open the current menu before saving it.'}}}else{saved = [{ ...edition, id: 'cm_' + edition.version.slice(0,32), bookingId: booking.id, service: booking.service, date: booking.date, occasion: booking.occasion, savedAt: '2026-11-23T12:00:00Z' }]; data = { menu: saved[0] }} }
   else if (path === '/customer/menus/remove') {saved=saved.filter(menu=>menu.id!==body.id);data={ok:true}}
   else if (path === '/workspace') return request.respond({ status: 503, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': new URL(base).origin }, body: JSON.stringify({error:{code:'fixture_unavailable',message:'Local transport fixture.'}}) })
   else if (path === '/customer/claim') data = { ok: true }
   else if (path === '/customer/receipt.pdf') return request.respond({ status: 200, headers: { 'Access-Control-Allow-Origin': new URL(base).origin }, contentType: 'application/pdf', body: '%PDF-1.4\n% local download transport fixture\n' })
   else throw Error('Unexpected fixture path ' + path)
   return request.respond({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': new URL(base).origin }, body: JSON.stringify(data) })
  }
  // No unknown/new API origin or provider may receive a fictional JWT through the network.
  if (url.origin !== localOrigin && !['data:','blob:'].includes(url.protocol)) {blockedExternal.push({origin:url.origin,tokenAttached:request.headers().authorization==='Bearer fixture-only-token'});return request.abort()}
  assert(!request.headers().authorization,'Static/local requests must never receive the fictional JWT')
  return request.continue()
  } catch(error) {routeErrors.push(error.message);if(!request.isInterceptResolutionHandled())await request.respond({status:599,contentType:'application/json',headers:{'Access-Control-Allow-Origin':localOrigin},body:JSON.stringify({error:{message:'Unexpected local fixture request.'}})})}
 })
 await fixture.setViewport({ width: 1440, height: 1000 })
 await fixture.goto(base + '/auth/callback/?code=fixture&state=fixture', { waitUntil: 'networkidle0' })
 await fixture.waitForFunction(() => document.querySelector('h1')?.textContent === 'Your evenings.' && document.body.textContent.includes('Your approved menu is ready.'))
 assert.equal(await fixture.evaluate(() => window.__sdkInstances), 1)
 assert.equal(await fixture.evaluate(() => window.__sdkOptions.cacheLocation), 'memory')
 assert.equal(await fixture.evaluate(() => window.__sdkOptions.useRefreshTokens), false)
 assert.equal(writes.length, 0)
 pass('fixture callback restores local query/hash through one SDK singleton without auto-claiming')
 await fixture.screenshot({ path: directory + '/fixture-evenings-desktop.png', fullPage: true })
 for(const label of ['Saved menus','Settings & profile','Your evenings']) {
  await tab(fixture,label)
  assert.equal(await fixture.evaluate(()=>new URLSearchParams(location.search).get('ref')),'CS-fixture')
  assert.equal(await fixture.evaluate(()=>location.hash),'#access='+'a'.repeat(43))
 }
 await tab(fixture,'Settings & profile')
 await fixture.waitForFunction(()=>['Email verification','Secure sign-in help'].every(label=>[...document.querySelectorAll('a')].some(node=>node.textContent.trim()===label)))
 for(const label of ['Email verification','Secure sign-in help']) {
  const href=await fixture.evaluate(label=>[...document.querySelectorAll('a')].find(node=>node.textContent.trim()===label)?.href,label)
  assert(href,label+' must have a real destination')
  const url=new URL(href),target=new URL(url.searchParams.get('returnTo'),base);if(!target.hash)target.hash=url.hash
  assert.equal(target.pathname,'/dashboard/');assert.equal(target.searchParams.get('ref'),'CS-fixture');assert.equal(target.searchParams.get('view'),'settings');assert.equal(target.hash,'#access='+'a'.repeat(43))
  assert(!url.search.includes('a'.repeat(43)),'Private proof must stay in fragment, outside account URL query')
 }
 pass('prepared reference and private fragment survive every tab and verification/help round-trip')
 await tab(fixture,'Your evenings')
 // Explicit private-link claim, never an email-based automatic lookup.
 await fixture.evaluate(() => { const control = [...document.querySelectorAll('button')].find(node => node.textContent === 'Link this booking'); control.click() })
 await fixture.waitForFunction(() => !location.hash && !new URLSearchParams(location.search).has('ref'))
 assert(writes.some(item => item.path === '/customer/claim' && item.body.accessToken === 'a'.repeat(43)))
 pass('linking requires explicit action and clears private proof after success')
 assert.equal(await fixture.$eval('.ev-upcoming .ev-primary',node=>node.textContent.trim()),'View your menu')
 await fixture.click('.ev-upcoming .ev-primary')
 await fixture.waitForFunction(() => document.querySelector('h1')?.textContent === 'Your menu.')
 await fixture.waitForFunction(() => [...document.querySelectorAll('button')].some(node => node.textContent === 'Save this menu' && !node.disabled))
 await fixture.evaluate(() => [...document.querySelectorAll('button')].find(node => node.textContent === 'Save this menu').click())
 await fixture.waitForFunction(() => document.body.textContent.includes('This approved edition is saved to your menus.'))
 assert(writes.some(item => item.path === '/customer/menus/save' && item.body.version === edition.version))
 pass('saving a menu sends its actual approved version and confirms the server response')
 await tab(fixture,'Settings & profile')
 await fixture.waitForSelector('textarea')
 await fixture.$eval('textarea', node => { const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set; setter.call(node, 'A long, relaxed supper.'); node.dispatchEvent(new Event('input',{bubbles:true})) })
 await fixture.waitForFunction(() => !document.querySelector('form.ev-form button[type=submit]')?.disabled)
 await fixture.evaluate(() => document.querySelector('form.ev-form button[type=submit]').click())
 await fixture.waitForFunction(() => document.body.textContent.includes('Profile saved') && document.body.textContent.includes('Existing bookings and their contact details have not changed.'))
 assert(writes.some(item => item.path === '/customer/profile' && item.body.preferences === 'A long, relaxed supper.'))
 pass('profile changes use the authenticated API and reflect its returned saved state')
 const priorTheme = await fixture.evaluate(() => document.documentElement.getAttribute('data-theme'))
 for (const theme of ['light', 'dark']) {
  await fixture.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
  const rewardControl = 'nav.ev-nav [aria-label="Rewards"]'
  await fixture.mouse.move(0,0)
  await fixture.hover(rewardControl)
  const label = rewardControl + ' .account-icon-nav-hint > span'
  await fixture.waitForSelector(label, { visible: true })
  const result = await fixture.$eval(label, node => {
   const style = getComputedStyle(node), context = document.createElement('canvas').getContext('2d')
   const channels = color => { context.clearRect(0,0,1,1); context.fillStyle=color; context.fillRect(0,0,1,1); return [...context.getImageData(0,0,1,1).data] }
   const luminance = rgba => { const c=rgba.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4); return .2126*c[0]+.7152*c[1]+.0722*c[2] }
   const foreground=channels(style.color), background=channels(style.backgroundColor), values=[luminance(foreground),luminance(background)].sort((a,b)=>a-b)
   return {text:node.textContent,contrast:(values[1]+.05)/(values[0]+.05),alpha:background[3]}
  })
  assert.equal(result.text, 'Rewards'); assert.equal(result.alpha,255); assert(result.contrast >= 4.5, theme + ' account hover label lacks text contrast')
  await fixture.keyboard.press('Escape')
  await fixture.waitForFunction(selector => document.querySelector(selector)?.hidden === true, {}, rewardControl + ' .account-icon-nav-hint')
 }
 await fixture.evaluate(theme => { if(theme===null)document.documentElement.removeAttribute('data-theme');else document.documentElement.setAttribute('data-theme',theme) }, priorTheme)
 pass('account hover labels remain readable in both themes and dismiss with Escape')

 const savedText=edition.text
 edition.text='LOCAL REVISED EDITION BETA\n\nA different approved menu';edition.version='b'.repeat(64)
 await tab(fixture,'Your evenings');await refreshDetails(fixture)
 await tab(fixture,'Saved menus')
 await fixture.waitForFunction(text=>document.querySelector('main')?.textContent.includes(text),{},savedText)
 assert(!(await fixture.$eval('main',node=>node.textContent)).includes(edition.text))
 await clickText(fixture,'a,button','Read menu')
 await fixture.waitForFunction(text=>document.querySelector('.ev-menu-copy')?.textContent===text,{},savedText)
 assert((await fixture.$eval('main',node=>node.textContent)).includes('Saved approved edition'))
 pass('saved menus preserve the exact old approved edition after the current booking menu changes')
 await tab(fixture,'Your evenings');await fixture.click('.ev-upcoming .ev-primary')
 await fixture.waitForFunction(text=>document.querySelector('.ev-menu-copy')?.textContent===text,{},edition.text)
 const staleVersion=edition.version,staleText=edition.text
 edition.text='LOCAL REVISED EDITION GAMMA';edition.version='d'.repeat(64)
 await clickText(fixture,'button','Save this menu')
 await fixture.waitForFunction(()=>document.querySelector('main')?.textContent.includes('The approved menu changed.'))
 assert.equal(writes.filter(item=>item.path==='/customer/menus/save').at(-1).body.version,staleVersion)
 assert(!saved.some(menu=>menu.version===staleVersion))
 assert.equal(await fixture.$eval('.ev-menu-copy',node=>node.textContent),staleText)
 pass('stale409 cannot silently replace the chosen menu with a newer approved version')
 await tab(fixture,'Your evenings');await refreshDetails(fixture)
 extraBookings=[
  {...booking,id:'CS-sooner',date:'2099-12-01',occasion:'Sooner pending request',status:'requested',planning:null,nextAction:{kind:'review_request',title:'Sergio is reviewing your request.',detail:'No date is reserved yet.'}},
  {...booking,id:'CS-cancelled',date:'2099-11-01',occasion:'Cancelled future request',status:'cancelled',planning:null,nextAction:null},
  {...booking,id:'CS-past',date:'1999-01-01',occasion:'A past evening',planning:null,nextAction:null},
 ]
 await refreshDetails(fixture)
 const upcoming=await fixture.$eval('.ev-upcoming',node=>node.textContent)
 assert(upcoming.includes('Sooner pending request'));assert(upcoming.includes('Request received'));assert(!upcoming.includes('Approved with Sergio'))
 assert.equal(await fixture.$eval('.ev-upcoming .ev-primary',node=>node.textContent.trim()),'View your request')
 assert((await fixture.$eval('main',node=>node.textContent)).includes('Earlier evenings & closed requests'))
 pass('upcoming date order excludes cancellations and keeps a pending request separate from confirmed arrangements')
 extraBookings=[];await refreshDetails(fixture)
 await tab(fixture,'Saved menus');await fixture.waitForFunction(text=>document.querySelector('main')?.textContent.includes(text),{},savedText)
 menusStatus=403;await tab(fixture,'Your evenings');await refreshDetails(fixture)
 await fixture.waitForFunction(()=>document.querySelector('main')?.textContent.includes('Local fixture: saved-menu access was revoked.'))
 await tab(fixture,'Saved menus');assert(!(await fixture.$eval('main',node=>node.textContent)).includes(savedText))
 pass('saved-menu403 clears previously rendered private editions instead of retaining cached content')
 menusStatus=200;await tab(fixture,'Your evenings');await refreshDetails(fixture)
 bookingsStatus=403;await refreshDetails(fixture)
 await fixture.waitForFunction(()=>document.querySelector('main')?.textContent.includes('Local fixture: booking access was revoked.'))
 assert(!(await fixture.$eval('main',node=>node.textContent)).includes(booking.occasion))
 await tab(fixture,'Saved menus');assert(!(await fixture.$eval('main',node=>node.textContent)).includes(savedText))
 pass('booking403 clears prior bookings and saved menus and disables further writes')
 bookingsStatus=200
 await fixture.goto(base+'/dashboard/?view=menus',{waitUntil:'networkidle0'})
 await fixture.waitForFunction(text=>document.querySelector('main')?.textContent.includes(text),{},savedText)
 emailVerified=false;await fixture.evaluate(()=>window.dispatchEvent(new Event('focus')))
 await fixture.waitForFunction(()=>document.querySelector('main')?.textContent.includes('Confirm your email.'))
 await fixture.waitForFunction(text=>!document.querySelector('main')?.textContent.includes(text),{},savedText)
 assert(await fixture.evaluate(()=>[...document.querySelectorAll('main button')].find(node=>node.textContent==='Link this booking')?.disabled))
 pass('unverified refreshed identity cannot retain private saved menus or link another booking')
 emailVerified=true
 await fixture.goto(base+'/dashboard/',{waitUntil:'networkidle0'})
 await fixture.waitForFunction(()=>document.querySelector('h1')?.textContent==='Your evenings.'&&document.querySelector('.ev-upcoming'))
 await tab(fixture,'Your evenings')
 await fixture.waitForFunction(() => document.querySelector('h1')?.textContent === 'Your evenings.')
 await fixture.evaluate(() => { window.__downloads = []; const click = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function(){ if(this.download)window.__downloads.push({name:this.download,url:this.href});else click.call(this) } })
 await fixture.waitForFunction(() => [...document.querySelectorAll('button')].some(node => node.textContent === 'Download PDF' && !node.disabled))
 await fixture.evaluate(() => [...document.querySelectorAll('button')].find(node => node.textContent === 'Download PDF').click())
 await fixture.waitForFunction(() => window.__downloads?.length === 1)
 assert(await fixture.evaluate(() => window.__downloads[0].url.startsWith('blob:')))
 pass('receipt download uses bearer fetch then a temporary Blob, with no credential in its link')
 await fixture.setViewport({ width: 390, height: 844 })
 assert(await fixture.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
 await fixture.screenshot({ path: directory + '/fixture-evenings-mobile.png', fullPage: true })
 for(const width of [320,390,1200]) {
  await fixture.setViewport({width,height:844})
  for(const label of ['Your evenings','Saved menus','Settings & profile']) {await tab(fixture,label);assert(await fixture.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),label+' overflows at '+width+'px')}
 }
 await fixture.setViewport({width:320,height:844});await fixture.evaluate(()=>{document.documentElement.style.fontSize='200%'})
 for(const label of ['Your evenings','Saved menus','Settings & profile']) {await tab(fixture,label);assert(await fixture.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),label+' overflows at320px with doubled text')}
 await fixture.evaluate(()=>{document.documentElement.style.fontSize=''})
 pass('all account panels fit320–1200px and320px with doubled root text')
 await fixture.goto(base + '/admin/', { waitUntil: 'networkidle0' })
 assert((await fixture.$eval('main', node => node.textContent)).includes('does not have access'))
 pass('non-admin authenticated identity receives a local access-denied page')
 const normalColor = await fixture.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ink'))
 adminIdentity = true
 await fixture.goto(base + '/admin/', { waitUntil: 'networkidle0' })
 await fixture.waitForFunction(() => document.body.textContent.includes('Your workspace is unavailable'))
 assert(await fixture.evaluate(() => document.documentElement.hasAttribute('data-admin-route')))
 await fixture.evaluate(() => { const link = document.createElement('a'); link.href = '/dashboard/'; document.body.append(link); link.click(); link.remove() })
 await fixture.waitForFunction(() => document.querySelector('h1')?.textContent === 'Your evenings.' && !document.documentElement.hasAttribute('data-admin-route'))
 assert.equal(await fixture.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ink')), normalColor)
 pass('admin CSS applies only on its route and releases the public/account design after navigation')
 {
  // A new tab has no in-memory token. With the non-secret marker from an earlier sign-in,
  // protected pages ask Auth0 once at top level (prompt=none); public pages never redirect.
  const resume = await browser.newPage(), silent = []
  resume.on('pageerror', error => errors.push(error.message))
  await resume.setRequestInterception(true)
  resume.on('request', request => { const url = new URL(request.url()); if (url.hostname.endsWith('.auth0.com')) { silent.push(url); return request.abort() }; return request.continue() })
  await resume.goto(base + '/', { waitUntil: 'networkidle0' })
  await resume.evaluate(() => localStorage.setItem('account:resume', '1'))
  await resume.goto(base + '/', { waitUntil: 'networkidle0' })
  assert.equal(silent.length, 0, 'public pages never redirect to Auth0')
  await resume.goto(base + '/admin/', { waitUntil: 'networkidle0' }).catch(() => {})
  for (let index = 0; index < 150 && !silent.length; index++) await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(silent.length, 1, 'a protected page makes one silent attempt')
  assert.equal(silent[0].searchParams.get('prompt'), 'none');assert.equal(silent[0].searchParams.get('response_type'), 'code')
  assert.equal(silent[0].searchParams.get('redirect_uri'), new URL(base).origin + accountConfig.callbackPath);assert.equal(silent[0].searchParams.get('audience'), accountConfig.audience)
  await resume.goto(base + '/admin/', { waitUntil: 'networkidle0' }).catch(() => {})
  await new Promise(resolve => setTimeout(resolve, 400))
  assert.equal(silent.length, 1, 'the same tab never loops through Auth0')
  await resume.goto(base + '/auth/callback/?error=login_required&state=fixture', { waitUntil: 'networkidle0' })
  await resume.waitForFunction(() => location.pathname === '/account/sign-in/')
  assert.equal(new URL(resume.url()).searchParams.get('returnTo'), '/admin/')
  assert.equal(await resume.evaluate(() => document.querySelector('[role="alert"]')?.textContent ?? null), null, 'an ended session is not reported as an error')
  assert.equal(await resume.evaluate(() => localStorage.getItem('account:resume')), null)
  await resume.close()
  pass('a returning tab resumes sign-in once at top level; an ended Auth0 session falls back to the ordinary sign-in')
 }
 assert.equal(errors.length, 0, errors.join('\n'));assert.equal(routeErrors.length,0,routeErrors.join('\n'))
 assert(!blockedExternal.some(item=>item.tokenAttached),'A fictional JWT was attached to an unmocked origin (request blocked, never forwarded)')
 pass('tested account routes have no uncaught browser errors; all unmocked external fixture requests are blocked')
 await fs.writeFile(directory + '/results.json', JSON.stringify({ scope: 'Local real-SDK blocked redirect inspection and fictional authenticated transport fixtures; no successful live sign-in, provider delivery or production acceptance claimed.',target:{apiOrigin,audience:accountConfig.audience}, checks, errors,routeErrors,blockedExternal }, null, 2))
} finally { await browser.close() }
