import { getAccessToken, SignInRequired } from './auth-client'
import { accountConfig } from './config'
export class AccountApiError extends Error { constructor(message: string, public status: number, public retryAfterSeconds = 0) { super(message) } }
export async function accountFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid account request.')
  const token = await getAccessToken(), headers = new Headers(init.headers)
  headers.set('Authorization', 'Bearer ' + token)
  headers.set('Accept', 'application/json')
  if (init.method && !['GET', 'HEAD'].includes(init.method.toUpperCase())) { headers.set('Content-Type', 'application/json'); headers.set('X-Customer-Request', '1') }
  const response = await fetch(accountConfig.apiOrigin + '/api/spa' + path, { ...init, headers, credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer' })
  if (response.status === 401) { window.dispatchEvent(new Event('account:expired')); throw new SignInRequired() }
  return response
}
export async function accountApi<T>(path: string, body?: unknown): Promise<T> {
  const response = await accountFetch(path, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) })
  const value = await response.json().catch(() => null)
  if (!response.ok || !value) throw new AccountApiError(typeof value?.error?.message === 'string' ? value.error.message : typeof value?.message === 'string' ? value.message : 'Your request could not be completed. Please try again.', response.status, Number(value?.retryAfterSeconds || response.headers.get('Retry-After')) || 0)
  return value as T
}
export async function downloadReceipt(id: string, number = 'receipt') {
  const response = await accountFetch('/customer/receipt.pdf?id=' + encodeURIComponent(id))
  if (!response.ok || !response.headers.get('Content-Type')?.includes('application/pdf')) throw new Error('This receipt could not be downloaded. Please try again.')
  savePdf(await response.blob(), number)
}
export function savePdf(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), link = document.createElement('a')
  link.href = url; link.download = name.replace(/[^A-Za-z0-9_.-]/g, '-') + '.pdf'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000)
}
