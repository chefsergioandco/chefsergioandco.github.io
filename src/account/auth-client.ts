import type { Auth0Client } from '@auth0/auth0-spa-js'
import { version as authSdkVersion } from '@auth0/auth0-spa-js/package.json'
import { accountConfig, safeReturnTo } from './config'
let client: Auth0Client | undefined
export class SignInRequired extends Error { constructor() { super('Please sign in to continue.'); this.name = 'SignInRequired' } }
export class SignInCallbackError extends Error {
  constructor(public readonly returnTo: string | null = null, public readonly providerError: string | null = null) { super('Sign-in could not be completed.'); this.name = 'SignInCallbackError' }
}
export async function authClient() {
  if (!accountConfig.clientId) throw new Error('Account sign-in is being connected. Please try again shortly.')
  const { Auth0Client } = await import('@auth0/auth0-spa-js')
  client ??= new Auth0Client({ domain: new URL(accountConfig.issuer).hostname, clientId: accountConfig.clientId, cacheLocation: 'memory', useRefreshTokens: false, useCookiesForTransactions: false, authorizationParams: { redirect_uri: location.origin + accountConfig.callbackPath, audience: accountConfig.audience, scope: accountConfig.scope } })
  return client
}
/** Cache-only is deliberate: a fresh page requires a top-level sign-in, never an iframe. */
export async function getAccessToken(): Promise<string> {
  const token = await (await authClient()).getTokenSilently({ cacheMode: 'cache-only' })
  if (!token) throw new SignInRequired()
  return token
}
export async function beginSignIn(connection: 'google-oauth2' | 'Username-Password-Authentication', returnTo: string, signup = false, reauthenticate = false) {
  return (await authClient()).loginWithRedirect({ appState: { returnTo: safeReturnTo(returnTo) }, authorizationParams: { connection, ...(signup ? { screen_hint: 'signup' } : {}), ...(reauthenticate ? { prompt: 'login' } : {}) } })
}
/** Read-only compatibility adapter for the pinned SDK's own session transaction.
 * In 2.30.0 an error callback throws before the SDK's state comparison. Recovery
 * therefore requires an exact local binding before the SDK consumes the record. */
function failedCallbackBinding(url: string): { state: string; error: string; returnTo: string } | null {
  if (authSdkVersion !== '2.30.0') return null
  try {
    const callback = new URL(url), params = callback.searchParams
    if (callback.origin !== location.origin || callback.pathname !== accountConfig.callbackPath || params.getAll('state').length !== 1 || params.getAll('error').length !== 1 || params.has('code') || params.has('connect_code')) return null
    const state = params.get('state'), error = params.get('error')
    if (!state || state.length > 1024 || !error || error.length > 200) return null
    const raw = sessionStorage.getItem('a0.spajs.txs.' + accountConfig.clientId)
    if (!raw || raw.length > 32768) return null
    const transaction = JSON.parse(raw)
    if (!transaction || typeof transaction !== 'object' || Array.isArray(transaction) || !Object.keys(transaction).every(key => ['nonce', 'scope', 'audience', 'appState', 'code_verifier', 'redirect_uri', 'organization', 'state', 'max_age', 'response_type'].includes(key)) || transaction.response_type !== 'code' || transaction.state !== state || transaction.redirect_uri !== location.origin + accountConfig.callbackPath || transaction.audience !== accountConfig.audience || transaction.scope !== accountConfig.scope || typeof transaction.nonce !== 'string' || !transaction.nonce || typeof transaction.code_verifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(transaction.code_verifier) || transaction.organization !== undefined && typeof transaction.organization !== 'string' || transaction.max_age !== undefined && !(typeof transaction.max_age === 'string' || typeof transaction.max_age === 'number' && Number.isFinite(transaction.max_age))) return null
    const returnTo = safeReturnTo(transaction.appState?.returnTo, '')
    return returnTo ? { state, error, returnTo } : null
  } catch { return null }
}
export async function completeSignIn(url = location.href): Promise<string> {
  const sdk = await import('@auth0/auth0-spa-js'), current = await authClient()
  const input = new URL(url), params = input.searchParams, denied = params.has('error'), binding = denied ? failedCallbackBinding(url) : null
  if (input.origin !== location.origin || input.pathname !== accountConfig.callbackPath || !denied && (params.getAll('code').length !== 1 || !params.get('code') || params.getAll('state').length !== 1 || !params.get('state') || params.has('connect_code'))) throw new SignInCallbackError()
  if (denied && !binding) throw new SignInCallbackError()
  try {
    const result = await current.handleRedirectCallback(url)
    rememberSignIn()
    return safeReturnTo(result.appState?.returnTo)
  } catch (failure) {
    if (binding && failure instanceof sdk.AuthenticationError && failure.state === binding.state && failure.error === binding.error && safeReturnTo(failure.appState?.returnTo, '') === binding.returnTo) throw new SignInCallbackError(binding.returnTo, binding.error)
    throw new SignInCallbackError()
  }
}
export async function endSignIn() { forgetSignIn(); return (await authClient()).logout({ logoutParams: { returnTo: location.origin + '/account/signed-out/' } }) }

// A new tab or reload has no in-memory token. When this browser has signed in
// before, ask Auth0 once per tab with a top-level prompt=none redirect: no iframe,
// no third-party cookie and no stored token. localStorage holds only the non-secret
// resume marker. The existing tab attempt and SDK transaction retain a safe return
// target, which can include a private fragment; access tokens stay in memory.
const RESUME_KEY = 'account:resume', ATTEMPT_KEY = 'account:resume-attempt'
function rememberSignIn() {
  try { localStorage.setItem(RESUME_KEY, '1'); sessionStorage.removeItem(ATTEMPT_KEY) } catch { /* Resume is a convenience; sign-in still works. */ }
}
function forgetSignIn() {
  try { localStorage.removeItem(RESUME_KEY) } catch { /* Nothing to forget. */ }
}
/** Starts the silent redirect and resolves true, or resolves false when it should not run. */
export async function resumeSignIn(returnTo: string): Promise<boolean> {
  const target = safeReturnTo(returnTo)
  try {
    if (localStorage.getItem(RESUME_KEY) !== '1' || sessionStorage.getItem(ATTEMPT_KEY)) return false
    sessionStorage.setItem(ATTEMPT_KEY, target)
  } catch { return false }
  await (await authClient()).loginWithRedirect({ appState: { returnTo: target }, authorizationParams: { prompt: 'none' } })
  return true
}
/** Auth0 answered a silent attempt with "sign-in needed": forget the marker and
 * return the sign-in page for the original destination, or null if this was not one. */
export function endedResume(failure: unknown): string | null {
  if (!(failure instanceof SignInCallbackError) || !failure.returnTo || !failure.providerError || !['login_required', 'consent_required', 'interaction_required'].includes(failure.providerError)) return null
  let target: string | null = null
  try { target = sessionStorage.getItem(ATTEMPT_KEY) } catch { /* Fall through to the ordinary error. */ }
  if (!target || safeReturnTo(target, '') !== failure.returnTo) return null
  forgetSignIn()
  return failure.returnTo
}
