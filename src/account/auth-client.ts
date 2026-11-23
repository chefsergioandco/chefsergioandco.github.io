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
  callback ??= authClient().then(client => client.handleRedirectCallback()).then(result => safeReturnTo(result.appState?.returnTo))
  return callback
}
export async function endSignIn() { return (await authClient()).logout({ logoutParams: { returnTo: location.origin + '/account/signed-out/' } }) }
