/** The cookie-based workspace is the default. Static clients opt in before mounting. */
export type AdminNavigation = { signInUrl: string; accountUrl: string; signOutUrl: string }
export type AdminApiOptions = {
  /** Absolute HTTPS API prefix, for example https://worker.example/api/spa. */
  apiBase: string
  getAccessToken: () => Promise<string>
  onUnauthorized?: (status: 401 | 403) => void | Promise<void>
  navigation?: Partial<AdminNavigation>
}
export class AdminApiError extends Error {
  constructor(message: string, public status: number) { super(message); this.name = 'AdminApiError' }
}
const defaultNavigation: AdminNavigation = {
  signInUrl: '/account/sign-in/?returnTo=%2Fadmin%2F',
  accountUrl: '/dashboard/',
  signOutUrl: '/auth/logout',
}
type Configuration = AdminApiOptions & { apiBase: string; navigation: AdminNavigation }
let configuration: Configuration | null = null

function localNavigation(value: string) {
  // Navigation stays on the frontend origin; never put tokens in a URL.
  if (!value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020]/.test(value)) throw new TypeError('Admin navigation must be a local absolute path.')
  const parsed = new URL(value, 'https://admin.invalid')
  if (parsed.origin !== 'https://admin.invalid') throw new TypeError('Admin navigation must stay on this site.')
  return parsed.pathname + parsed.search + parsed.hash
}

/** Call with null to restore the unchanged same-origin cookie/CSRF transport. */
export function configureAdminApi(options: AdminApiOptions | null) {
  if (!options) { configuration = null; return }
  const base = new URL(options.apiBase)
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || base.pathname.replace(/\/$/, '') !== '/api/spa') throw new TypeError('The admin API base must be an HTTPS /api/spa endpoint.')
  if (typeof options.getAccessToken !== 'function') throw new TypeError('An access-token getter is required.')
  const navigation = { ...defaultNavigation, signOutUrl: '/auth/logout/', ...options.navigation }
  for (const key of Object.keys(navigation) as (keyof AdminNavigation)[]) navigation[key] = localNavigation(navigation[key])
  configuration = { ...options, apiBase: base.origin + '/api/spa', navigation }
}

export function getAdminNavigation(): AdminNavigation { return { ...(configuration?.navigation || defaultNavigation) } }

function endpoint(path: string, config: Configuration) {
  if (!path.startsWith('/api/') || /[\\\u0000-\u0020]/.test(path)) throw new TypeError('Admin requests must use a local /api/ path.')
  const url = new URL(config.apiBase + path.slice(4))
  if (url.origin !== new URL(config.apiBase).origin || !url.pathname.startsWith('/api/spa/') || url.hash) throw new TypeError('Admin requests must stay inside the configured API.')
  return url.href
}

async function unauthorized(config: Configuration, status: 401 | 403) {
  // Navigation failures must not turn a rejected write into a network retry.
  try { await config.onUnauthorized?.(status) } catch { /* The response still reaches the workspace. */ }
}

export async function adminFetch(path: string, init: RequestInit = {}, expectedActor?: string): Promise<Response> {
  const headers = new Headers(init.headers)
  const config = configuration
  if (config) {
    const url = endpoint(path, config)
    let token: string
    try { token = await config.getAccessToken() }
    catch (cause) {
      await unauthorized(config, 401)
      throw new AdminApiError(cause instanceof Error ? cause.message : 'Your access has expired. Sign in again to continue.', 401)
    }
    if (typeof token !== 'string' || !token || /\s/.test(token)) {
      await unauthorized(config, 401)
      throw new AdminApiError('Your sign-in session could not be verified. Sign in again to continue.', 401)
    }
    if (expectedActor) {
      const check = await fetch(endpoint('/api/auth/session', config), { signal: init.signal, credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } })
      const session = await check.json().catch(() => null)
      if (!check.ok) { if (check.status === 401 || check.status === 403) await unauthorized(config, check.status); throw new AdminApiError('Your current workspace account could not be checked. Refresh access before continuing.', check.status) }
      if (session?.authenticated !== true || session.identity?.sub !== expectedActor || session.identity?.isAdmin !== true || session.identity?.email_verified !== true) { await unauthorized(config, 403); throw new AdminApiError('Your workspace account changed. Refresh access before reviewing private details.', 403) }
    }
    headers.set('Authorization', 'Bearer ' + token)
    headers.delete('X-CSRF-Token')
    // Never follow a provider/API redirect with a bearer credential.
    const response = await fetch(url, { ...init, credentials: 'omit', redirect: 'error', headers })
    if (response.status === 401 || response.status === 403) await unauthorized(config, response.status)
    return response
  }
  const method = (init.method || 'GET').toUpperCase()
  if (expectedActor || !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const session = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store', signal: init.signal })
    const data = await session.json().catch(() => null)
    if (!session.ok) throw new AdminApiError(data?.error?.message || 'Your sign-in session needs attention. Sign in again to continue.', session.status)
    if (expectedActor && data?.user?.id !== expectedActor) throw new AdminApiError('Your workspace account changed. Refresh access before reviewing private details.', 403)
    const csrfToken = data?.csrfToken
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && (typeof csrfToken !== 'string' || !csrfToken)) throw new AdminApiError('Your sign-in session could not be verified. Refresh the dashboard and try again.', 403)
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) headers.set('X-CSRF-Token', csrfToken)
  }
  return fetch(path, { ...init, credentials: 'same-origin', headers })
}

/** Download through the active authenticated transport; bearer tokens never enter links. */
export async function adminDownload(path: string, filename: string): Promise<void> {
  const response = await adminFetch(path, { cache: 'no-store' })
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new AdminApiError(payload?.error?.message || 'The receipt could not be downloaded. Please try again.', response.status)
  }
  if (!response.headers.get('Content-Type')?.toLowerCase().startsWith('application/pdf')) throw new AdminApiError('The server did not return a PDF receipt. Please try again.', response.status)
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename.replace(/[^A-Za-z0-9._-]/g, '-') || 'receipt.pdf'
  anchor.hidden = true
  document.body.append(anchor)
  try { anchor.click() }
  finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
}
