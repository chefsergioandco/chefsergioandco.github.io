import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { adminFetch } from './api-client'
import { Icon } from './ui'
import { ATTENTION_AREAS, OPERATIONS_VIEWS, isOperationsResponse, isOperationsView, type OperationsResponse, type OperationsTarget, type OperationsView, type ServiceStatus, type JobStatus } from './service-operations-types'
import './ServiceOperations.css'

const viewLabels: Record<OperationsView, string> = { connections: 'Connections', background: 'Background work', attention: 'Needs attention' }
const serviceLabels: Record<ServiceStatus, string> = { ready: 'Ready', limited: 'Limited', blocked: 'Needs setup', not_connected: 'Not connected', unknown: 'Not verified' }
const jobLabels: Record<JobStatus, string> = { healthy: 'Completed', failed: 'Failed', running: 'Running', never_recorded: 'No run recorded', overdue: 'Overdue', unknown: 'Not verified' }
const areaLabels = { email: 'Guest email', newsletter: 'Newsletter', payments: 'Payments & gifts', privacy: 'Account & privacy', configuration: 'Connections & setup', monitoring: 'Background checks' }
const sectionLabels = { communications: 'Communications', newsletter: 'Newsletter', payments: 'Billing & records', privacy: 'Account & privacy', calendar: 'Calendar', bookings: 'Bookings', website: 'Your website', operations: 'Service operations' }
const severityLabels = { error: 'Action needed', warning: 'Review needed', info: 'For your review' }
const dateTime = (value: string) => new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/New_York' }).format(new Date(value))
const When = ({ value, empty = 'Not recorded' }: { value: string | null; empty?: string }) => value ? <time dateTime={value}>{dateTime(value)}</time> : <span>{empty}</span>

export default function ServiceOperations({ onNavigate, onViewChange, initialView = 'connections' }: { onNavigate?: (target: OperationsTarget) => void; onViewChange?: (view: OperationsView) => void; initialView?: OperationsView }) {
  const [view, setView] = useState<OperationsView>(initialView)
  const [data, setData] = useState<OperationsResponse | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState('')
  const currentRequest = useRef<AbortController | null>(null), sequence = useRef(0), uid = useId()
  async function refresh() {
    const request = new AbortController(), run = ++sequence.current
    currentRequest.current?.abort(); currentRequest.current = request
    setLoading(true); setError('')
    try {
      const response = await adminFetch('/api/operations', { method: 'GET', cache: 'no-store', headers: { Accept: 'application/json' }, signal: request.signal })
      if (response.status === 401 || response.status === 403) { if (run === sequence.current) setData(null); throw new Error('Your access could not be verified. Sign in with an approved administrator account.') }
      if (!response.ok) throw new Error('Service operations could not be read. Refresh to check the current state.')
      const result: unknown = await response.json()
      if (!isOperationsResponse(result)) throw new Error('The service report was incomplete or its run evidence could not be verified. Refresh before relying on these results.')
      if (run === sequence.current) setData(result)
    } catch (cause) {
      if (!request.signal.aborted && run === sequence.current) setError(cause instanceof Error && cause.message.startsWith('The service report') ? cause.message : cause instanceof Error && cause.message.startsWith('Your access') ? cause.message : 'Service operations could not be read. Refresh to check the current state.')
    } finally { if (run === sequence.current) setLoading(false) }
  }
  useEffect(() => { void refresh(); return () => { ++sequence.current; currentRequest.current?.abort() } }, [])
  useEffect(() => { setView(initialView) }, [initialView])
  function selectView(next: OperationsView) { setView(next); onViewChange?.(next) }
  function navigate(target: OperationsTarget) {
    if (target.section === 'operations') selectView(isOperationsView(target.view) ? target.view : 'connections')
    else onNavigate?.(target)
  }
  function tabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index
    if (event.key === 'ArrowRight') next = (index + 1) % OPERATIONS_VIEWS.length
    else if (event.key === 'ArrowLeft') next = (index + OPERATIONS_VIEWS.length - 1) % OPERATIONS_VIEWS.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = OPERATIONS_VIEWS.length - 1
    else return
    event.preventDefault(); selectView(OPERATIONS_VIEWS[next])
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
  }
  const recovery = (target: OperationsTarget | null, exact = false) => target && (onNavigate || target.section === 'operations') && !(target.section === 'operations' && view === (isOperationsView(target.view) ? target.view : 'connections')) ? <button type="button" className="button secondary operations-review" onClick={() => navigate(target)}>{target.section === 'operations' ? 'Review connections' : exact && (target.recordId || target.bookingId) ? 'Review this record' : 'Open ' + sectionLabels[target.section]}<Icon name="chevron" size={16}/></button> : null
  const attentionCount = data?.attention.length ?? 0
  return <section className="service-operations" aria-labelledby={uid + '-heading'}>
    <header className="operations-heading"><div><p className="eyebrow">YOUR WORKSPACE, WORKING</p><h2 id={uid + '-heading'}>Service operations.</h2><p>Connections, recorded background work, and the next things that need you.</p></div><button type="button" className="button secondary" disabled={loading} onClick={() => void refresh()}><Icon name="history" size={17}/>{loading ? 'Checking…' : 'Refresh checks'}</button></header>
    <p className="operations-checked" role="status">{data ? <>Checked <When value={data.checkedAt}/>{loading ? ' · Refreshing' : error ? ' · Earlier report; refresh failed' : ''}. All times Eastern.</> : loading ? 'Reading service setup and saved run evidence…' : 'No service report is loaded.'}</p>
    {error && <p role="alert" className="operations-notice is-error">{error}{data && ' The earlier report below may be out of date.'}</p>}
    <div className="operations-tabs" role="tablist" aria-label="Service operations views">{OPERATIONS_VIEWS.map((item, index) => <button type="button" key={item} id={uid + '-tab-' + item} role="tab" aria-selected={view === item} aria-controls={uid + '-panel'} tabIndex={view === item ? 0 : -1} onClick={() => selectView(item)} onKeyDown={event => tabKey(event, index)}>{viewLabels[item]}{item === 'attention' && data && <span className="operations-count" aria-label={data.limits.truncated ? `${attentionCount} or more items` : `${attentionCount} items`}>{attentionCount}{data.limits.truncated ? '+' : ''}</span>}</button>)}</div>
    <div id={uid + '-panel'} role="tabpanel" aria-labelledby={uid + '-tab-' + view} tabIndex={0} className="operations-panel" aria-busy={loading}>
      {!data ? <div className="operations-empty"><Icon name={loading ? 'clock' : 'info'} size={30}/><h3>{loading ? 'Reading the current picture…' : 'Your service report is unavailable.'}</h3><p>{loading ? 'The report checks setup and reads saved work. It does not send messages or start payments.' : 'Use Refresh checks to try again. No healthy or connected state has been assumed.'}</p></div> : view === 'connections' ? <>
        <p className="operations-intro">Ready describes the current setup. Confirm each payment or message in its own record; a ready connection is not proof of a completed transaction.</p>
        <ul className="operations-connections">{data.services.map(service => <li key={service.id} className="operations-service"><div className="operations-item-heading"><h3>{service.label}</h3><span className={'operations-status service-' + service.status}>{serviceLabels[service.status]}</span></div><p>{service.summary}</p>{service.reasons.length > 0 && <ul className="operations-reasons">{service.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>}<div className="operations-item-footer"><p><span>Who can help</span>{service.owner}</p>{recovery(service.target)}</div></li>)}</ul>
      </> : view === 'background' ? <>
        <p className="operations-intro">A run is shown only when its evidence was saved. A passed check is separate from provider delivery, payment settlement or completion of a customer request.</p>
        {!data.limits.historyAvailable && <p className="operations-notice is-warning">Saved run history is unavailable. The current setup cannot tell us when the work last completed.</p>}
        <ul className="operations-jobs">{data.jobs.map(job => <li key={job.key} className="operations-job"><div className="operations-item-heading"><div><p className="operations-kicker">{job.kind === 'probe' ? 'Background check' : 'Background work'}{!job.enabled ? ' · Not enabled' : ''}</p><h3>{job.label}</h3></div><span className={'operations-status job-' + job.status}>{job.status === 'healthy' && job.kind === 'probe' ? 'Check passed' : jobLabels[job.status]}</span></div><dl className="operations-run-times"><div><dt>Last started</dt><dd><When value={job.lastRun?.startedAt ?? null} empty="No run recorded"/></dd></div><div><dt>Next expected</dt><dd><When value={job.nextExpectedAt} empty={job.enabled ? 'Not established' : 'Not scheduled'}/></dd></div></dl>{job.lastRun ? <details className="operations-run-evidence"><summary>Inspect the last recorded run</summary><p>{job.lastRun.summary}</p><dl><div><dt>Result</dt><dd>{job.lastRun.outcome === 'succeeded' ? 'Succeeded' : job.lastRun.outcome === 'failed' ? 'Failed' : 'Still running'}</dd></div><div><dt>Finished</dt><dd><When value={job.lastRun.finishedAt} empty="No finish recorded"/></dd></div><div><dt>Run reference</dt><dd>{job.lastRun.id}</dd></div></dl></details> : <p className="operations-no-evidence">No saved run evidence is available for this work.</p>}{recovery(job.target)}</li>)}</ul>
      </> : <>
        <p className="operations-intro">Open the relevant record to review the evidence and choose its supported next step. Refreshing these checks does not retry payments, send mail or erase data.</p>
        {data.limits.truncated && <p className="operations-notice is-warning">Showing the first {data.limits.maxAttention} items. Open the relevant workspace to review the remaining records.</p>}
        {attentionCount === 0 ? <div className="operations-empty"><Icon name="check" size={30}/><h3>No attention items were returned.</h3><p>That describes this check. Review Connections and Background work for unavailable setup or missing run evidence.</p></div> : ATTENTION_AREAS.map(area => {
          const items = data.attention.filter(item => item.area === area)
          return items.length > 0 && <section className="operations-attention-group" key={area} aria-labelledby={uid + '-area-' + area}><h3 id={uid + '-area-' + area}>{areaLabels[area]} <span>{items.length}</span></h3><ul>{items.map(item => <li key={item.id}><div className="operations-item-heading"><h4>{item.title}</h4><span className={'operations-status severity-' + item.severity}>{severityLabels[item.severity]}</span></div><p>{item.summary}</p><div className="operations-item-footer"><p><span>Recorded</span><When value={item.at}/></p>{recovery(item.target, true)}</div></li>)}</ul></section>
        })}
      </>}
    </div>
  </section>
}
