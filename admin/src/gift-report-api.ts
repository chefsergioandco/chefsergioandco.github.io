import { adminFetch, AdminApiError } from './api-client'
import { isGiftBalanceReport, type GiftBalanceReport } from './gift-report-types'
export class GiftReportError extends Error { constructor(message: string, public status = 0) { super(message); this.name = 'GiftReportError' } }
async function get(path: string, actor: string, signal: AbortSignal): Promise<unknown> {
  if (!actor) throw new GiftReportError('Your workspace account must be checked before opening this report.', 403)
  const abort = new AbortController(), stop = () => abort.abort(); signal.addEventListener('abort', stop, { once: true }); if (signal.aborted) stop(); const timer = setTimeout(stop, 20_000)
  try {
    const response = await Promise.race([adminFetch(path, { signal: abort.signal, cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', headers: { Accept: 'application/json' } }, actor), new Promise<never>((_, reject) => { if (abort.signal.aborted) reject(new GiftReportError('The complete report could not be checked. Try again.')); else abort.signal.addEventListener('abort', () => reject(new GiftReportError('The complete report could not be checked. Try again.')), { once: true }) })])
    const reader = response.body?.getReader(), chunks: Uint8Array[] = []; let size = 0
    if (reader) { while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 1_048_576) { await reader.cancel(); throw new GiftReportError('The complete report exceeded its safe size limit. No partial report was opened or exported.') } chunks.push(part.value) } }
    const bytes = new Uint8Array(size); let offset = 0; for (const part of chunks) { bytes.set(part, offset); offset += part.byteLength }
    let value: any = null; try { value = JSON.parse(new TextDecoder().decode(bytes)) } catch { /* Strict callers reject incomplete JSON. */ }
    if (!response.ok) throw new GiftReportError([401, 403].includes(response.status) ? 'Your administrator access could not be verified. Check your access before opening another report.' : value?.error?.code === 'gift_report_too_large' ? 'The complete report exceeds its safe size limit. No partial report was opened or exported.' : 'A complete gift balance report could not be captured. Try again; no gift records were changed.', response.status)
    return value
  } catch (error) { if (error instanceof AdminApiError) throw new GiftReportError(error.message, error.status); if (error instanceof GiftReportError || signal.aborted) throw error; throw new GiftReportError('The complete report could not be checked. Try again; no gift records were changed.') } finally { clearTimeout(timer); signal.removeEventListener('abort', stop) }
}
export async function readGiftBalanceReport(actor: string, signal: AbortSignal): Promise<GiftBalanceReport> {
  const value = await get('/api/gifts/report', actor, signal)
  if (!isGiftBalanceReport(value)) throw new GiftReportError('The report was incomplete or its totals could not be verified. No partial report was opened or exported.')
  return value
}
/** Uses one captured token for the existing expected-actor check and session request; never recaptures report data. */
export async function checkGiftReportAccess(actor: string, signal: AbortSignal): Promise<void> {
  const value = await get('/api/auth/session', actor, signal) as { authenticated?: boolean; identity?: { sub?: string; isAdmin?: boolean; email_verified?: boolean };  user?: { id?: string } }
  if (!value || ('identity' in value || 'authenticated' in value ? value.authenticated !== true || value.identity?.sub !== actor || value.identity?.isAdmin !== true || value.identity?.email_verified !== true : value.user?.id !== actor)) throw new GiftReportError('Your workspace account changed. Open a new report after checking your access.', 403)
}
