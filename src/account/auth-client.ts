import type { Auth0Client } from '@auth0/auth0-spa-js'
import { accountConfig, safeReturnTo } from './config'
let client: Auth0Client | undefined
let callback: Promise<string> | undefined
export class SignInRequired extends Error { constructor() { super('Please sign in to continue.'); this.name = 'SignInRequired' } }
export async function authClient() {
  if (!accountConfig.clientId) throw new Error('Account sign-in is being connected. Please try again shortly.')
  const { Auth0Client } = await import('@auth0/auth0-spa-js')
  client ??= new Auth0Client({ domain: new URL(accountConfig.issuer).hostname, clientId: accountConfig.clientId, cacheLocation: 'memory', useRefreshTokens: false, authorizationParams: { redirect_uri: location.origin + accountConfig.callbackPath, audience: accountConfig.audience, scope: accountConfig.scope } })
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
export function completeSignIn(): Promise<string> {
  // React StrictMode must not consume a one-use authorization code twice.
  callback ??= authClient().then(client => client.handleRedirectCallback()).then(result => { rememberSignIn(); return safeReturnTo(result.appState?.returnTo) })
  return callback
}
export async function endSignIn() { forgetSignIn(); return (await authClient()).logout({ logoutParams: { returnTo: location.origin + '/account/signed-out/' } }) }

// A new tab or reload has no in-memory token. When this browser has signed in
// before, ask Auth0 once per tab with a top-level prompt=none redirect: no iframe,
// no third-party cookie and no stored token. Only a non-secret marker is kept.
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
export function endedResume(error: string | null): string | null {
  if (!error || !['login_required', 'consent_required', 'interaction_required'].includes(error)) return null
  let target: string | null = null
  try { target = sessionStorage.getItem(ATTEMPT_KEY) } catch { /* Fall through to the ordinary error. */ }
  if (!target) return null
  forgetSignIn()
  return safeReturnTo(target)
}
