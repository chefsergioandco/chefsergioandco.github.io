/** Public PKCE application configuration. This file contains no client secret. */
export const accountConfig = {
  apiOrigin: 'https://chef-sergio-staging.chefsergioandco.workers.dev',
  issuer: 'https://dev-o4q68hw4dzervof0.us.auth0.com/',
  clientId: import.meta.env.VITE_AUTH0_SPA_CLIENT_ID || '8yzWOR4tovuL5WTBwvNnbNSjk1Q5g5bk',
  audience: 'https://chefsergioandco.github.io/staging-api',
  scope: 'openid profile email access:chef',
  callbackPath: '/auth/callback/',
} as const
export function safeReturnTo(value: unknown, fallback = '/dashboard/'): string {
  if (typeof value !== 'string' || value.length > 4096 || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(value)) return fallback
  try {
    const decoded = decodeURIComponent(value)
    if (decoded.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(decoded)) return fallback
    const target = new URL(value, 'https://return.invalid')
    if (target.origin !== 'https://return.invalid' || ['/auth/callback/', '/account/callback/', '/auth/logout/', '/account/sign-out/'].includes(target.pathname)) return fallback
    const routes = ['/', '/dashboard/', '/admin/', '/account/sign-in/', '/account/create/', '/account/verify-email/', '/account/password-reset/', '/account/check-email/', '/account/signed-out/', '/receipt/', '/newsletter/confirm/', '/newsletter/unsubscribe/', '/book/', '/book/done/', '/invitation/', '/privatedining/', '/cookingclasses/', '/catering/', '/about/', '/gift/', '/sergios-table/', '/privacy/', '/terms/']
    return routes.includes(target.pathname) ? target.pathname + target.search + target.hash : fallback
  } catch { return fallback }
}
export const currentReturnTo = () => typeof location === 'undefined' ? '/dashboard/' : safeReturnTo(location.pathname + location.search + location.hash)
/** Keep private access proof in a fragment when passing between local account pages. */
export function accountReturnHref(path: string, returnTo: string) {
  const target = new URL(safeReturnTo(returnTo), 'https://return.invalid')
  return path + '?' + new URLSearchParams({ returnTo: target.pathname + target.search }) + target.hash
}
export const signInHref = (returnTo = currentReturnTo()) => accountReturnHref('/account/sign-in/', returnTo)
