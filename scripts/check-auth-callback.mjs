#!/usr/bin/env node
// Actual installed SDK + application adapter, in Node with an in-memory browser storage surface.
// No browser, token exchange, provider request, sign-in, email or persisted credential is used.
import assert from 'node:assert/strict'
import { createHash, webcrypto } from 'node:crypto'
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../', import.meta.url)), require = createRequire(import.meta.url)
const sdkMetadata = require.resolve('@auth0/auth0-spa-js/package.json'), sdkRoot = dirname(sdkMetadata)
const sdk = JSON.parse(await readFile(sdkMetadata, 'utf8')), temporary = await mkdtemp(join(tmpdir(), 'chef-callback-contract-'))
const output = process.env.AUTH_CALLBACK_PROOF_DIR || resolve(root, 'output/connection-completion/account-callback-recovery')
const checks = [], sourceHashes = {}, sha = value => createHash('sha256').update(value).digest('hex')
class Storage {
 values = new Map(); blocked = false; reads = 0; writes = 0; removals = 0
 getItem(key) { if (this.blocked) throw new DOMException('Fictional blocked storage', 'SecurityError'); this.reads++; return this.values.get(key) ?? null }
 setItem(key, value) { this.writes++; this.values.set(key, String(value)) }
 removeItem(key) { this.removals++; this.values.delete(key) }
 clear() { this.values.clear(); this.blocked = false; this.reads = this.writes = this.removals = 0 }
}
const local = new Storage(), session = new Storage(), origin = 'https://local.example.invalid'
const original = Object.fromEntries(['window', 'document', 'sessionStorage', 'localStorage', 'location', 'fetch', 'crypto'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
let forbiddenNetwork = 0
const location = { origin, href: origin + '/auth/callback/', assign() { throw new Error('Provider navigation is forbidden') } }
Object.defineProperties(globalThis, {
 window: { value: { location, crypto: webcrypto }, configurable: true }, document: { value: { cookie: '' }, configurable: true },
 sessionStorage: { value: session, configurable: true }, localStorage: { value: local, configurable: true },
 location: { value: location, configurable: true }, crypto: { value: webcrypto, configurable: true },
 fetch: { value: () => { forbiddenNetwork++; throw new Error('Provider traffic is forbidden') }, configurable: true },
})
window.fetch = globalThis.fetch
const target = '/dashboard/?ref=WEB-callback-fixture#access=' + 'c'.repeat(43), state = 'fictional-local-state-43-characters-minimum-value'
const url = (query = 'error=access_denied&state=' + state) => origin + '/auth/callback/?' + query
const transaction = overrides => ({ nonce: 'fictional-sdk-nonce', scope: 'openid profile email access:chef', audience: 'https://chefsergioandco.github.io/staging-api', appState: { returnTo: target }, code_verifier: 'v'.repeat(43), redirect_uri: origin + '/auth/callback/', state, response_type: 'code', ...overrides })
let app, key
const reset = overrides => { local.clear(); session.clear(); session.setItem(key, JSON.stringify(transaction(overrides))); session.writes = 0; location.href = url() }
async function rejected(callbackUrl) { let failure; try { await app.completeSignIn(callbackUrl) } catch (error) { failure = error } assert(failure instanceof app.SignInCallbackError); return failure }
async function check(name, run) { await run(); checks.push(name); console.log('PASS ' + name) }
async function bundle(versionOverride) {
 const file = join(temporary, versionOverride ? 'version-drift.cjs' : 'actual.cjs')
 await build({ absWorkingDir: root, stdin: { contents: "export * from './src/account/auth-client';export {accountConfig}from './src/account/config';export{Auth0Client,AuthenticationError}from'@auth0/auth0-spa-js';", resolveDir: root }, outfile: file, bundle: true, platform: 'node', format: 'cjs', target: 'es2022', logLevel: 'silent', define: { 'import.meta.env.VITE_AUTH0_SPA_CLIENT_ID': '""' }, plugins: [{ name: 'capture-source', setup(builder) { builder.onLoad({ filter: /\.(?:ts|json)$/ }, async args => { if (args.path === sdkMetadata && versionOverride) return { contents: JSON.stringify({ version: versionOverride }), loader: 'json' }; if (!args.path.startsWith(root) || args.path.includes('/node_modules/')) return; const contents = await readFile(args.path, 'utf8'); sourceHashes[args.path.slice(root.length)] = sha(contents); return { contents, resolveDir: dirname(args.path), loader: args.path.endsWith('.json') ? 'json' : 'ts' } }) } }] })
 return require(file)
}
try {
 assert.equal(sdk.version, '2.30.0', 'Revalidate the read-only transaction adapter before upgrading the installed SDK')
 app = await bundle(); key = 'a0.spajs.txs.' + app.accountConfig.clientId
 await check('installed SDK contract exposes error appState before rejecting a mismatched error state', async () => { reset(); const actual = new app.Auth0Client({ domain: 'fixture.auth0.com', clientId: app.accountConfig.clientId, cacheLocation: 'memory', useRefreshTokens: false, useCookiesForTransactions: false }); let failure; try { await actual.handleRedirectCallback(url('error=access_denied&state=wrong')) } catch (error) { failure = error } assert(failure instanceof app.AuthenticationError); assert.equal(failure.appState.returnTo, target); assert.equal(failure.state, 'wrong'); assert.equal(session.getItem(key), null) })
 await check('matched denial recovers only the stored safe target and consumes the actual SDK transaction once', async () => { reset(); const failure = await rejected(url()); assert.equal(failure.returnTo, target); assert.equal(failure.providerError, 'access_denied'); assert.equal(session.getItem(key), null); assert.equal(session.removals, 1); assert.equal(session.writes, 0); assert.equal(local.getItem('account:resume'), null) })
 await check('consumed transaction replay returns generic retry without recovering the earlier target', async () => { const failure = await rejected(url()); assert.equal(failure.returnTo, null); assert.equal(failure.providerError, null); assert.equal(session.removals, 1) })
 await check('wrong or stale callback state cannot consume or borrow the pending transaction', async () => { reset(); const failure = await rejected(url('error=access_denied&state=wrong')); assert.equal(failure.returnTo, null); assert(session.getItem(key)); assert.equal(session.removals, 0) })
 await check('missing, duplicated and contradictory callback parameters fail closed', async () => { for (const query of ['error=access_denied', 'state=' + state, 'error=access_denied&state=' + state + '&state=' + state, 'error=access_denied&state=' + state + '&error=login_required', 'error=access_denied&state=' + state + '&code=unexpected', 'error=access_denied&state=' + state + '&connect_code=unexpected']) { reset(); const failure = await rejected(url(query)); assert.equal(failure.returnTo, null); assert.equal(local.getItem('account:resume'), null) } })
 await check('missing, consumed or malformed transaction storage cannot recover a target', async () => { for (const raw of [null, '', '{broken', '[]', 'null']) { reset(); if (raw === null) session.removeItem(key); else session.setItem(key, raw); const failure = await rejected(url()); assert.equal(failure.returnTo, null) } })
 await check('stale app/callback settings and unknown transaction schemas fail closed', async () => { for (const overrides of [{ redirect_uri: 'https://old.example.invalid/auth/callback/' }, { audience: 'https://old-api.example.invalid' }, { scope: 'openid' }, { response_type: 'connect_code' }, { code_verifier: '' }, { code_verifier: 'not a verifier' }, { nonce: '' }, { organization: {} }, { max_age: null }, { future_transaction_layout: true }]) { reset(overrides); const failure = await rejected(url()); assert.equal(failure.returnTo, null); assert.equal(session.removals, 0) } })
 await check('blocked session storage gives generic retry and does not persist recovery state', async () => { reset(); session.blocked = true; const failure = await rejected(url()); assert.equal(failure.returnTo, null); assert.equal(session.writes, 0); session.blocked = false })
 await check('unsafe or absent stored appState never becomes a retry destination', async () => { for (const returnTo of ['https://attacker.invalid/', '//attacker.invalid/', '/%2f/attacker.invalid/', '/auth/callback/?code=x', undefined]) { reset({ appState: { returnTo } }); const failure = await rejected(url()); assert.equal(failure.returnTo, null) } })
 await check('URL returnTo and provider descriptions never replace the transaction destination or become UI error text', async () => { reset(); const failure = await rejected(url('error=access_denied&state=' + state + '&returnTo=' + encodeURIComponent('/admin/') + '&error_description=' + encodeURIComponent('Go to https://attacker.invalid/'))); assert.equal(failure.returnTo, target); assert.equal(failure.message, 'Sign-in could not be completed.'); assert(!failure.message.includes('attacker')) })
 await check('non-error mismatched code state remains an SDK rejection without token exchange or target recovery', async () => { reset(); const failure = await rejected(url('code=fictional&state=wrong')); assert.equal(failure.returnTo, null); assert.equal(session.getItem(key), null); assert.equal(local.getItem('account:resume'), null) })
 await check('silent-resume fallback requires a validated denial and matching original target', async () => { reset(); local.setItem('account:resume', '1'); session.setItem('account:resume-attempt', target); assert.equal(app.endedResume('login_required'), null); const failure = await rejected(url('error=login_required&state=' + state)); assert.equal(app.endedResume(failure), target); assert.equal(local.getItem('account:resume'), null); reset(); local.setItem('account:resume', '1'); session.setItem('account:resume-attempt', '/admin/'); const other = await rejected(url('error=login_required&state=' + state)); assert.equal(app.endedResume(other), null); assert.equal(local.getItem('account:resume'), '1') })
 await check('forged silent-resume error cannot clear markers or consume an unmatched transaction', async () => { reset(); local.setItem('account:resume', '1'); session.setItem('account:resume-attempt', target); const failure = await rejected(url('error=login_required&state=wrong')); assert.equal(app.endedResume(failure), null); assert.equal(local.getItem('account:resume'), '1'); assert(session.getItem(key)) })
 await check('SDK version drift disables private-layout recovery while preserving a generic safe error', async () => { const changed = await bundle('99.0.0'); reset(); let failure; try { await changed.completeSignIn(url()) } catch (error) { failure = error } assert(failure instanceof changed.SignInCallbackError); assert.equal(failure.returnTo, null); assert(session.getItem(key)); assert.equal(session.removals, 0) })
 assert.equal(forbiddenNetwork, 0)
 await mkdir(output, { recursive: true })
 const sdkFiles = ['package.json', 'src/Auth0Client.ts', 'src/transaction-manager.ts', 'src/storage.ts', 'src/errors.ts', 'dist/lib/auth0-spa-js.cjs.js']
 const sdkHashes = Object.fromEntries(await Promise.all(sdkFiles.map(async file => [file, sha(await readFile(resolve(sdkRoot, file)))])))
 const result = { at: new Date().toISOString(), passed: checks.length, checks, scope: 'Actual installed Auth0 SDK2.30.0 public callback method and application adapter executed in Node with in-memory window/location/document/storage and WebCrypto. No browser or provider traffic.', sdkVersion: sdk.version, sdkHashes, sourceHashes, testSha256: sha(await readFile(fileURLToPath(import.meta.url))), providerRequests: forbiddenNetwork, limits: ['The SDK session transaction has no creation timestamp or enforced clock expiry; proof covers consumed/missing transactions and stale configuration, not age-based expiry.', 'Successful code exchange and hosted Auth0/provider acceptance are not exercised here; browser component checks separately cover callback routing and StrictMode.'] }
 await writeFile(resolve(output, 'sdk-validation.json'), JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify({ passed: checks.length, providerRequests: forbiddenNetwork, output }))
} finally {
 await rm(temporary, { recursive: true, force: true })
 for (const [key, descriptor] of Object.entries(original)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key] }
}
