import { useEffect, useRef, useState, type FormEvent } from 'react'
import { adminFetch } from './api-client'
import './PrivacyExportCollection.css'

type ExportRequest = { id: string; subject: string; email: string; revision: number; kind: string }
type Source = 'auth0' | 'stripe' | 'resend' | 'mailbox' | 'infrastructure' | 'other' | 'controller_information' | 'portability_dataset'
type Inventory = { subject: string; email: string; revision: number; sources: { source: Source; status: 'outstanding' | 'collected' | 'not_applicable'; evidence: string; reviewedAt: string | null }[] }
type Obligation = { id: string; source: string; category: string; reason: string }
type Coverage = { obligations: Obligation[] }
type Draft = { content: string; fileName: string; evidence: string; status: 'collected' | 'not_applicable'; confirmed: boolean }
type Attempt = { fingerprint: string; uploadId: string; actionId: string; stageIds: string[]; nextPart: number; expectedRevision: number }
const CATEGORIES: Record<Source, string[]> = {
  auth0: ['profile', 'retained_logs', 'linked_identity_history', 'roles_permissions', 'mfa_sessions', 'log_streams_retention'],
  stripe: ['customer_records', 'payments_refunds', 'disputes', 'payment_methods', 'processor_metadata'],
  resend: ['message_content', 'delivery_events', 'contacts_preferences'], mailbox: ['correspondence', 'attachments'],
  infrastructure: ['access_security_logs', 'backups_archives'], other: ['additional_systems'],
  controller_information: ['response_information'], portability_dataset: ['provided_personal_data', 'eligibility'],
}
const LABELS: Record<Source, string> = { auth0: 'Sign-in provider · Auth0', stripe: 'Payments · Stripe', resend: 'Email delivery · Resend', mailbox: 'Business correspondence', infrastructure: 'Hosting, logs & backups', other: 'Other systems & manual records', controller_information: 'Processing information', portability_dataset: 'Portable data & eligibility' }
const MAX_BYTES = 8 * 1024 * 1024

function sourceIds(kind: string): Source[] { return [...Object.keys(CATEGORIES).filter(key => key !== 'portability_dataset') as Source[], ...(kind === 'portability' ? ['portability_dataset' as const] : [])] }
function template(source: Source, request: ExportRequest, obligations: Obligation[] = []): string {
  const now = new Date().toISOString()
  return JSON.stringify({ dataSubject: { subject: request.subject, email: request.email }, source, collectedAt: now,
    records: [],
    coverage: { complete: false, ...(source === 'controller_information' ? { controllerPoliciesVerified: false } : {}), systems: ['DRAFT_VERIFY: actual systems searched'], identifiers: [request.subject, request.email], period: { from: null, to: now }, unresolved: [],
      categories: CATEGORIES[source].map(id => ({ id, status: source === 'controller_information' ? 'records' : 'no_records', recordCount: source === 'controller_information' ? 1 : 0, searchEvidence: 'DRAFT_VERIFY: record actual search/export scope, identifiers and results', ...(source === 'controller_information' ? {} : { reason: 'DRAFT_VERIFY: explain the actual evidenced result; unavailable is not no records' }) })) },
    resolutions: obligations.filter(obligation => obligation.source === source).map(obligation => ({ obligation: obligation.id, category: obligation.category, outcome: 'supplemented', recordIndexes: [], reason: 'DRAFT_VERIFY: explain how the actual indexed records resolve this specific collection gap, or document an evidenced no-records/lawful-restriction decision' })), ...(source === 'portability_dataset' ? { eligibility: { automatedProcessing: false, consentOrContract: false, providedByDataSubject: false, explanation: 'DRAFT_VERIFY: assess Article 20 eligibility and identify the actual reusable data subset' } } : {}),
  }, null, 2)
}
function freshDraft(source: Source, request: ExportRequest): Draft { return { content: '', fileName: '', evidence: '', status: 'collected', confirmed: false } }
async function api(path: string, body?: object): Promise<any> {
  const response = await adminFetch(path, { cache: 'no-store', ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Request': '1' }, body: JSON.stringify(body) } : {}) })
  const value = await response.json().catch(() => null)
  if (!response.ok || !value) throw new Error(value?.error?.message || value?.message || 'Export collection could not be confirmed. Your file and notes remain here for retry.')
  return value
}
/** Keep each UTF-16 surrogate pair together; the receiver hashes the reconstructed UTF-8 file. */
export function splitPrivacyExportContent(content: string): string[] {
  const parts: string[] = []
  for (let start = 0; start < content.length;) {
    let end = Math.min(content.length, start + 120_000)
    if (end < content.length && /[\uD800-\uDBFF]/.test(content[end - 1]) && /[\uDC00-\uDFFF]/.test(content[end])) --end
    parts.push(content.slice(start, end)); start = end
  }
  return parts.length ? parts : ['']
}
async function digest(bytes: Uint8Array) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(value => value.toString(16).padStart(2, '0')).join('') }
function inspect(content: string, source: Source, request: ExportRequest, status: Draft['status']) {
  const value = JSON.parse(content)
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.dataSubject?.subject !== request.subject || typeof value.dataSubject?.email !== 'string' || value.dataSubject.email.toLowerCase() !== request.email.toLowerCase() || value.source !== source || !Array.isArray(value.records)) throw new Error('The JSON must identify this exact subject, email and source and contain its categorized records array.')
  const coverage = value.coverage
  if (coverage?.complete !== true || !Array.isArray(coverage.unresolved) || coverage.unresolved.length || !Array.isArray(coverage.categories)) throw new Error('Finish the source coverage review: complete must be true, unresolved must be empty and every required category must be classified.')
  const draftFields = [...(Array.isArray(coverage.systems) ? coverage.systems : []), ...coverage.categories.flatMap((category: any) => [category?.searchEvidence, category?.reason, category?.legalBasis]), ...(Array.isArray(value.resolutions) ? value.resolutions.flatMap((resolution: any) => [resolution?.reason, resolution?.legalBasis]) : []), value.eligibility?.explanation, ...(source === 'controller_information' ? value.records.flatMap((record: any) => record?.category === 'response_information' && record.data && typeof record.data === 'object' ? Object.values(record.data) : []) : [])]
  if (draftFields.some(field => typeof field === 'string' && field.trimStart().startsWith('DRAFT_VERIFY:'))) throw new Error('Replace every DRAFT_VERIFY preparation prompt with verified facts before recording this source.')
  if (coverage.categories.length !== CATEGORIES[source].length || CATEGORIES[source].some(id => coverage.categories.filter((entry: any) => entry?.id === id).length !== 1)) throw new Error('The coverage file must classify every required category exactly once: ' + CATEGORIES[source].join(', ') + '.')
  for (const category of coverage.categories) {
    const records = value.records.filter((record: any) => record?.category === category.id)
    if (!['records', 'no_records', 'not_applicable', 'restricted'].includes(category.status) || !Number.isSafeInteger(category.recordCount) || category.recordCount !== records.length || typeof category.searchEvidence !== 'string' || category.searchEvidence.trim().length < 20) throw new Error('Check record counts and actual search evidence for ' + category.id + '.')
    if (category.status === 'records' ? records.length === 0 : records.length !== 0 || typeof category.reason !== 'string' || category.reason.trim().length < 40) throw new Error('Explain the evidenced zero-result, not-applicable or restricted decision for ' + category.id + '.')
    if (category.status === 'restricted' && (typeof category.legalBasis !== 'string' || category.legalBasis.trim().length < 20)) throw new Error('A restricted category needs its actual legal basis: ' + category.id + '.')
    if (status === 'not_applicable' && category.status !== 'not_applicable') throw new Error('A not-applicable source needs an evidenced not-applicable decision for every category, with no records.')
  }
  if (value.records.some((record: any) => !record || !CATEGORIES[source].includes(record.category) || !record.data || typeof record.data !== 'object')) throw new Error('Every record needs a required category and actual data object.')
  if (source === 'controller_information' && coverage.controllerPoliciesVerified !== true) throw new Error('Verify the actual controller policies, adopted retention and provider/transfer facts before setting controllerPoliciesVerified to true.')
  if (source === 'portability_dataset' && (value.eligibility?.automatedProcessing !== true || value.eligibility?.providedByDataSubject !== true || value.eligibility?.consentOrContract !== true || typeof value.eligibility.explanation !== 'string' || value.eligibility.explanation.trim().length < 20)) throw new Error('Record the actual Article 20 eligibility assessment. An ineligible request needs an explained review outcome, not a fabricated portable dataset.')
}

export default function PrivacyExportCollection({ request, onUpdated }: { request: ExportRequest; onUpdated: () => void }) {
  const sources = sourceIds(request.kind)
  const [inventory, setInventory] = useState<Inventory | null>(null), [selected, setSelected] = useState<Source>('auth0'), [drafts, setDrafts] = useState<Partial<Record<Source, Draft>>>({})
  const [preparation,setPreparation]=useState<Partial<Record<Source,{pending:boolean;notBefore?:string}>>>({})
  const [coverage, setCoverage] = useState<Coverage | null>(null), [checkingCoverage, setCheckingCoverage] = useState(false)
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const attempts = useRef<Partial<Record<Source, Attempt>>>({}), collectAttempts=useRef<Partial<Record<Source,{key:string;payload:Record<string,unknown>}>>>({}), generation = useRef(0), flight = useRef(false), activeId = useRef(request.id)
  activeId.current = request.id
  const draft = drafts[selected] || freshDraft(selected, request)
  function update(change: Partial<Draft>) { setDrafts(values => ({ ...values, [selected]: { ...(values[selected] || freshDraft(selected, request)), ...change } })); setNotice('') }
  async function load(owner = request, inspectCoverage = false): Promise<Inventory | null> {
    const run = ++generation.current; setLoading(true)
    try {
      const result = await api('/api/customer-privacy/export?id=' + encodeURIComponent(owner.id) + (inspectCoverage ? '&coverage=1' : ''))
      const expected = sourceIds(owner.kind)
      if (result.subject !== owner.subject || typeof result.email !== 'string' || result.email.toLowerCase() !== owner.email.toLowerCase() || !Number.isSafeInteger(result.revision) || result.revision < 0 || !Array.isArray(result.sources) || result.sources.length !== expected.length || expected.some(source => result.sources.filter((item: any) => item?.source === source).length !== 1) || result.sources.some((item: any) => !['outstanding', 'collected', 'not_applicable'].includes(item.status) || typeof item.evidence !== 'string' || item.reviewedAt !== null && typeof item.reviewedAt !== 'string')) throw new Error('The source inventory could not be verified for this request. Refresh before uploading.')
      if (inspectCoverage && (!result.coverage || !Array.isArray(result.coverage.obligations) || result.coverage.obligations.some((item: any) => !item || ['id', 'source', 'category', 'reason'].some(key => typeof item[key] !== 'string' || !item[key])))) throw new Error('The detailed collection coverage could not be verified. Keep the request open and retry inspection.')
      if (run === generation.current && activeId.current === owner.id) { setInventory(result); if (inspectCoverage) setCoverage(result.coverage) }
      return result
    } finally { if (run === generation.current) setLoading(false) }
  }
  useEffect(() => {
    setInventory(null); setPreparation({}); setCoverage(null); setCheckingCoverage(false); setDrafts({}); setSelected('auth0'); setError(''); setNotice(''); attempts.current = {}; collectAttempts.current={};flight.current = false; setBusy(false)
    void load().catch(cause => { if (activeId.current === request.id) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { ++generation.current }
  }, [request.id, request.subject, request.email, request.kind])
  async function refresh() { const owner = request; setError(''); try { await load(owner) } catch (cause) { if (activeId.current === owner.id) setError(cause instanceof Error ? cause.message : String(cause)) } }
  async function inspectCoverage() { const owner = request; setError(''); setCheckingCoverage(true); try { await load(owner, true) } catch (cause) { if (activeId.current === owner.id) setError(cause instanceof Error ? cause.message : String(cause)) } finally { if (activeId.current === owner.id) setCheckingCoverage(false) } }
  async function readFile(file?: File) {
    if (!file) return
    const ownerId = request.id, source = selected
    setError('')
    try {
      if (file.size > MAX_BYTES) throw new Error('This source file exceeds the 8 MiB upload limit. Keep the request open and arrange complete alternate secure fulfillment; it will not be truncated.')
      const content = await file.text()
      if (activeId.current !== ownerId) return
      setDrafts(values => ({ ...values, [source]: { ...(values[source] || freshDraft(source, request)), content, fileName: file.name, confirmed: false } }))
      setNotice('The full file is loaded for review. It has not been uploaded.')
    } catch (cause) { if (activeId.current === ownerId) setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  async function collectSource(restart=false) {
    if(flight.current||!inventory)return
    const owner=request,source=selected
    if(!['auth0','stripe','resend','controller_information'].includes(source))return
    const notBefore=preparation[source]?.notBefore
    if(restart&&collectAttempts.current[source]){setError('The previous source read is unconfirmed. Retry that saved action before refreshing the provider snapshot.');return}
    if(notBefore&&Date.parse(notBefore)>Date.now()){setError('The provider requested a pause. Resume collection after '+new Date(notBefore).toLocaleString()+'.');return}
    flight.current=true;setBusy(true);setError('');setNotice('Reading this person’s authoritative source records…')
    try {
      if(!collectAttempts.current[source]){const key=crypto.randomUUID();collectAttempts.current[source]={key,payload:{operation:'collect',source,id:owner.id,expectedRevision:inventory.revision,requestId:key,...(restart?{restart:true}:{})}}}
      const action=collectAttempts.current[source]!
      const result=await api('/api/customer-privacy/export',action.payload)
      if(activeId.current!==owner.id)return
      if(result.draft?.source!==source||result.draft?.dataSubject?.subject!==owner.subject||result.draft?.dataSubject?.email?.toLowerCase()!==owner.email.toLowerCase()||!Array.isArray(result.draft.records)||!Array.isArray(result.draft.coverage?.categories)||!Array.isArray(result.draft.coverage?.unresolved)||typeof result.progress?.pending!=='boolean'||result.progress.collectionKey!==action.key||result.progress.notBefore!==undefined&&(typeof result.progress.notBefore!=='string'||!Number.isFinite(Date.parse(result.progress.notBefore))))throw new Error('The collected source could not be verified for this person and action. Retry the saved action; keep the source outstanding.')
      setDrafts(values=>({...values,[source]:{...(values[source]||freshDraft(source,owner)),content:JSON.stringify(result.draft,null,2),fileName:'Authoritative server collection',confirmed:false}}))
      setPreparation(values=>({...values,[source]:result.progress}))
      delete collectAttempts.current[source]
      setNotice(result.progress.pending?'Collection is pending. The saved provider job can be resumed here; inspect its specific unresolved categories. Nothing has been marked complete.':'The source draft is loaded with its actual collection time. Review remaining categories before recording it. Refresh the provider snapshot after fixing credentials or permissions.')
    }catch(cause){if(activeId.current===owner.id)setError(cause instanceof Error?cause.message:String(cause))}
    finally{if(activeId.current===owner.id){flight.current=false;setBusy(false)}}
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    if (flight.current || !inventory) return
    const owner = request, source = selected, captured = { ...draft }
    flight.current = true; setBusy(true); setError(''); setNotice('')
    try {
      if (!captured.confirmed || captured.evidence.trim().length < 20 || captured.evidence.length > 6000) throw new Error('Record collection evidence and confirm identity, completeness and third-party review first.')
      const bytes = new TextEncoder().encode(captured.content)
      if (!bytes.length || bytes.length > MAX_BYTES) throw new Error('Provide the complete JSON source file, up to the 8 MiB upload limit. Larger responses need complete alternate secure fulfillment; files are never truncated.')
      inspect(captured.content, source, owner, captured.status)
      const sha256 = await digest(bytes), chunks = splitPrivacyExportContent(captured.content)
      const fingerprint = JSON.stringify({ id: owner.id, source, sha256, evidence: captured.evidence.trim(), status: captured.status })
      if (attempts.current[source]?.fingerprint !== fingerprint) attempts.current[source] = { fingerprint, uploadId: crypto.randomUUID(), actionId: crypto.randomUUID(), stageIds: chunks.map(() => crypto.randomUUID()), nextPart: 0, expectedRevision: inventory.revision }
      const attempt = attempts.current[source]!
      for (; attempt.nextPart < chunks.length;) {
        if (activeId.current !== owner.id) return
        const partIndex = attempt.nextPart
        setNotice(`Uploading the complete source file: part ${partIndex + 1} of ${chunks.length}.`)
        const result = await api('/api/customer-privacy/export', { requestId: attempt.stageIds[partIndex], id: owner.id, expectedRevision: attempt.expectedRevision, operation: 'stage', uploadId: attempt.uploadId, partIndex, content: chunks[partIndex] })
        if (result.staged !== true || result.partIndex !== partIndex) throw new Error('This file part was not confirmed. Retry retains the same upload and action identifiers.')
        ++attempt.nextPart
      }
      if (activeId.current !== owner.id) return
      setNotice('All file parts uploaded. Recording and verifying source coverage…')
      const result = await api('/api/customer-privacy/export', { requestId: attempt.actionId, id: owner.id, expectedRevision: attempt.expectedRevision, operation: 'source', source, sourceStatus: captured.status, evidence: captured.evidence.trim(), subjectReviewConfirmed: true, uploadId: attempt.uploadId, partCount: chunks.length, byteLength: bytes.byteLength, sha256 })
      if (result.request?.id !== owner.id || result.request.revision !== attempt.expectedRevision + 1) throw new Error('The source action could not be confirmed. Retry to recover this same action; your file and notes are preserved.')
      const verified = await load(owner), saved = verified?.sources.find(item => item.source === source)
      if (!verified || verified.revision < result.request.revision || saved?.status !== captured.status || saved.evidence !== captured.evidence.trim() || !saved.reviewedAt) throw new Error('The source update needs reconciliation. Refresh coverage; your file and the same action remain available for retry.')
      if (activeId.current !== owner.id) return
      delete attempts.current[source]
      setNotice(LABELS[source] + ' collection is saved and read back. This does not complete the rights request.'); onUpdated()
    } catch (cause) { if (activeId.current === owner.id) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { if (activeId.current === owner.id) { flight.current = false; setBusy(false) } }
  }
  return <section className="privacy-export" aria-labelledby={'export-collection-' + request.id}>
    <header><h4 id={'export-collection-' + request.id}>Collect the personal-data response</h4><p>The local collector covers application records. Review every external source, correspondence and processing information before the request can be fulfilled.</p></header>
    <p className="privacy-export-note">Keep each source tied to this person: <strong>{request.email}</strong><br/><span className="privacy-export-id">{request.subject}</span>. Missing access, an API failure or an unanswered provider request is outstanding work, not evidence of no data.</p>
    {request.kind==='access_export'&&inventory&&<InterimDeliveryReview request={{...request,revision:inventory.revision}} onUpdated={()=>{void load().then(()=>onUpdated())}}/>}
    <div className="privacy-export-actions"><button type="button" className="button secondary" disabled={busy || loading} onClick={() => void refresh()}>{loading && !checkingCoverage ? 'Reading sources…' : 'Refresh source coverage'}</button><button type="button" className="button secondary" disabled={busy || loading} onClick={() => void inspectCoverage()}>{checkingCoverage ? 'Inspecting local and provider coverage…' : 'Inspect full collection coverage'}</button></div>
    {inventory && <p className="privacy-export-id">Current reviewed request revision: {inventory.revision}</p>}
    {error && <p role="alert" className="privacy-export-error">{error} Your loaded file and notes remain available. A changed request may require refresh and reconciliation before a new action.</p>}
    {notice && <p role="status" className="privacy-export-note">{notice}</p>}
    {coverage && <section className="privacy-export-obligations" aria-label="Automatic collection gaps"><h5>Collection gaps requiring a supported resolution</h5><p>This inspection can identify missing, redacted or partial automatic data. Review these exact obligations against actual source records. Refresh source coverage preserves this list; inspect again after resolving gaps because the underlying records can change.</p>{coverage.obligations.length ? <ul>{coverage.obligations.map(obligation => <li key={obligation.id}><strong>{LABELS[obligation.source as Source] || obligation.source} · {obligation.category}</strong><code>{obligation.id}</code><p>{obligation.reason}</p></li>)}</ul> : <p>No automatic collection gaps were reported by this inspection. Every external/manual source still needs its own complete review.</p>}</section>}
    <ul className="privacy-export-sources" aria-label="Export source coverage">{sources.map(source => { const item = inventory?.sources.find(item => item.source === source); return <li key={source}><button type="button" disabled={busy} aria-current={selected === source ? 'true' : undefined} onClick={() => { setSelected(source); setError(''); setNotice('') }}><strong>{LABELS[source]}</strong><span>{!inventory ? 'Not yet verified' : item?.status === 'collected' ? 'Collected & reviewed' : item?.status === 'not_applicable' ? 'Not applicable · evidence recorded' : 'Outstanding'}</span>{item?.reviewedAt && <small>{new Date(item.reviewedAt).toLocaleString()}</small>}</button>{item?.evidence && <details><summary>Saved collection evidence</summary><p>{item.evidence}</p></details>}</li> })}</ul>
    <form onSubmit={event => void save(event)}>
      <fieldset disabled={busy || !inventory}>
        <legend>{LABELS[selected]}</legend>
        <p>Required categories: <span className="privacy-export-id">{CATEGORIES[selected].join(', ')}</span>. Classify every category, reconcile record counts and record the actual systems, identifiers and period searched. Explain zero results and specific lawful redactions.</p>
        <label>Source outcome<select value={draft.status} onChange={event => update({ status: event.target.value as Draft['status'], confirmed: false })}><option value="collected">Complete collection, including evidenced zero results</option><option value="not_applicable" disabled={['auth0', 'controller_information', 'portability_dataset'].includes(selected)}>Not applicable · complete reviewed manifest still required</option></select></label>
        {['auth0','stripe','resend','controller_information'].includes(selected)&&<div className="privacy-export-actions"><button type="button" className="button secondary" onClick={()=>void collectSource()}>{busy?'Collecting source…':collectAttempts.current[selected]?'Retry saved source read':preparation[selected]?.pending?'Resume authoritative collection':selected==='controller_information'?'Load adopted processing information':'Collect authoritative source records'}</button>{preparation[selected]&&!preparation[selected]?.pending&&<button type="button" className="button secondary" disabled={!!collectAttempts.current[selected]} onClick={()=>void collectSource(true)}>Refresh provider snapshot</button>}{preparation[selected]?.notBefore&&<p>Provider retry after {new Date(preparation[selected]!.notBefore!).toLocaleString()}.</p>}</div>}
        <label>Load complete source JSON<input type="file" accept=".json,application/json" onChange={event => void readFile(event.target.files?.[0])}/></label>
        {draft.fileName && <p className="privacy-export-id">Loaded: {draft.fileName}</p>}
        <button className="button secondary" type="button" disabled={selected==='controller_information'} onClick={() => update({ content: template(selected, request, coverage?.obligations), fileName: '', confirmed: false })}>Prepare editable {selected === 'controller_information' ? 'processing-information' : 'coverage'} template</button>
        {selected === 'controller_information' && <p className="privacy-export-note">Load the owner-adopted processing information from the server. Review any case-specific processing, recipients or holds before recording it. This information is versioned with the adopted policy; it is separate from collecting the person’s actual records.</p>}
        <label>Review or edit full source JSON<textarea className="privacy-export-json" rows={12} spellCheck={false} value={draft.content} onChange={event => update({ content: event.target.value, fileName: '', confirmed: false })} required/></label>
        <label>Collection evidence<textarea rows={4} minLength={20} maxLength={6000} required value={draft.evidence} onChange={event => update({ evidence: event.target.value, confirmed: false })} placeholder="Actual systems and time range searched; subject/email and verified source bindings; query/export references; category counts and zero-result checks; specific redaction decisions. No credentials or other people’s private details."/></label>
        <label className="privacy-export-confirm"><input type="checkbox" checked={draft.confirmed} onChange={event => update({ confirmed: event.target.checked })} required/><span>I checked this exact person’s identity and source bindings, all categories and record counts, the period searched, unresolved gaps, and contextual third-party/secret redactions. These are actual collected records or evidenced decisions.</span></label>
        <button className="button" disabled={!draft.confirmed || !draft.content}>{busy ? 'Saving source…' : attempts.current[selected] ? 'Retry this source action' : 'Upload & record this source'}</button>
        {attempts.current[selected] && <div className="privacy-export-reconcile"><p>Retry keeps the same action and upload identifiers to recover an unknown response. If another operator changed this request, refresh and compare saved coverage first. Start a new action only after reconciling whether the earlier one was recorded.</p><button className="button secondary" type="button" onClick={() => { delete attempts.current[selected]; update({ confirmed: false }); setNotice('Your file and notes are preserved. Review the current saved coverage and confirm again before a new action uses the displayed request revision.') }}>Prepare a new action after reconciliation</button></div>}
      </fieldset>
    </form>
  </section>
}

type InterimPreparation={kind:string;requestId:string;subject:string;email:string;requestRevision:number;reviewExpiresAt:string;artifact:{artifactId:string;sha256:string;partCount:number;byteLength:number};proof:string}
/** Releasing available records is separate from attesting that the full rights request is fulfilled. */
function InterimDeliveryReview({request,onUpdated}:{request:ExportRequest;onUpdated:()=>void}) {
  const [identityConfirmed,setIdentityConfirmed]=useState(false),[sourceText,setSourceText]=useState(''),[sourceConfirmed,setSourceConfirmed]=useState(false)
  const [prepared,setPrepared]=useState<InterimPreparation|null>(null),[content,setContent]=useState(''),[reviewed,setReviewed]=useState(false),[evidence,setEvidence]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const flight=useRef(false),attempts=useRef<{prepare?:{fingerprint:string;key:string};release?:{fingerprint:string;key:string}}>({}),generation=useRef(0)
  useEffect(()=>{++generation.current;setPrepared(null);setContent('');setReviewed(false);setEvidence('');attempts.current={};setIdentityConfirmed(false);setSourceConfirmed(false);setSourceText('');setError('');setNotice('');return()=>{++generation.current}},[request.id,request.subject,request.email])
  const changed=!!prepared&&prepared.requestRevision!==request.revision
  async function readSource(file?:File) {
    if(!file)return
    try{if(file.size>1024*1024)throw new Error('The additional inline source file exceeds 1 MiB; arrange a suitable larger-file workflow.');setSourceText(await file.text());setSourceConfirmed(false);setPrepared(null);setContent('');setReviewed(false)}catch(cause){setError(cause instanceof Error?cause.message:String(cause))}
  }
  async function prepare() {
    if(flight.current||!identityConfirmed)return
    const run=generation.current,owner=request
    flight.current=true;setBusy(true);setError('');setNotice('');setReviewed(false)
    try {
      const reviewedSourceFiles=sourceText.trim()?JSON.parse(sourceText):[],files=Array.isArray(reviewedSourceFiles)?reviewedSourceFiles:[reviewedSourceFiles]
      if(files.length&&!sourceConfirmed)throw new Error('Review the additional source file and confirm its exact-person, third-party and credential checks first.')
      if(new TextEncoder().encode(JSON.stringify(files)).byteLength>1024*1024)throw new Error('The additional inline sources exceed 1 MiB. Arrange a suitable larger-file workflow; records will not be truncated.')
      const body={id:owner.id,expectedRevision:owner.revision,operation:'prepare_interim',identityReviewConfirmed:true,reviewedSourceFiles:files,sourceContentReviewConfirmed:sourceConfirmed},fingerprint=JSON.stringify(body)
      if(attempts.current.prepare?.fingerprint!==fingerprint)attempts.current.prepare={fingerprint,key:crypto.randomUUID()}
      const result=await api('/api/customer-privacy/export',{...body,requestId:attempts.current.prepare.key}),value=result.preparation as InterimPreparation
      if(run!==generation.current)return
      if(value?.kind!=='privacy-interim-preparation-v1'||value.requestId!==owner.id||value.subject!==owner.subject||value.email!==owner.email.toLowerCase()||value.requestRevision!==owner.revision||!value.artifact||!/^[a-f0-9]{64}$/.test(value.artifact.sha256)||!Number.isSafeInteger(value.artifact.partCount)||value.artifact.partCount<1)throw new Error('The private review-copy binding could not be verified.')
      setPrepared(value)
      const chunks:string[]=[]
      for(let part=0;part<value.artifact.partCount;part++){
        const received=await api('/api/customer-privacy/export',{id:owner.id,expectedRevision:owner.revision,requestId:crypto.randomUUID(),operation:'read_interim',preparation:value,part})
        if(run!==generation.current)return
        if(received.export?.partIndex!==part||typeof received.export.content!=='string')throw new Error('A private review-copy part was missing. Retry preparation to recover the same immutable copy.')
        chunks.push(received.export.content)
      }
      const full=chunks.join(''),bytes=new TextEncoder().encode(full),sha256=await digest(bytes),parsed=JSON.parse(full)
      if(bytes.byteLength!==value.artifact.byteLength||sha256!==value.artifact.sha256||parsed.releaseKind!=='interim'||parsed.completion?.complete!==false||parsed.dataSubject?.subject!==owner.subject||parsed.requestId!==owner.id)throw new Error('The private copy failed its complete-file integrity or identity check. It cannot be released.')
      setContent(full);setNotice('The complete immutable private copy passed its byte-length and checksum checks. Download and inspect its actual records before releasing those exact bytes. The full rights request remains open.')
    }catch(cause){if(run===generation.current)setError(cause instanceof Error?cause.message:String(cause))}
    finally{flight.current=false;if(run===generation.current)setBusy(false)}
  }
  function downloadReview() {
    if(!prepared||!content||changed)return
    const url=URL.createObjectURL(new Blob([content],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='chef-sergio-private-review-'+request.id+'.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
  async function release() {
    if(flight.current||!prepared||!content||!reviewed||changed)return
    const run=generation.current,owner=request
    flight.current=true;setBusy(true);setError('');setNotice('')
    try {
      const body={id:owner.id,expectedRevision:owner.revision,operation:'release_interim',preparation:prepared,contentReviewConfirmed:true,reviewedSha256:prepared.artifact.sha256,evidence:evidence.trim()},fingerprint=JSON.stringify(body)
      if(attempts.current.release?.fingerprint!==fingerprint)attempts.current.release={fingerprint,key:crypto.randomUUID()}
      const result=await api('/api/customer-privacy/export',{...body,requestId:attempts.current.release.key})
      if(run!==generation.current)return
      if(result.request?.id!==owner.id||result.request.revision!==owner.revision+1||result.request.exportKind!=='interim'||!result.request.exportAvailable||!['pending','in_review','needs_information'].includes(result.request.status))throw new Error('The interim release could not be confirmed. Retry the same action, then refresh before making another release.')
      setNotice('The reviewed available-data copy is released to this customer. The full access request is still open and its deadline is unchanged.');setPrepared(null);setContent('');setReviewed(false);attempts.current={};onUpdated()
    }catch(cause){if(run===generation.current)setError(cause instanceof Error?cause.message:String(cause))}
    finally{flight.current=false;if(run===generation.current)setBusy(false)}
  }
  return <section className="privacy-export-interim" aria-label="Reviewed available-data delivery"><h5>Available collected data, review ongoing</h5><p>Provide actual reviewed records while outstanding collection continues. This does not fulfill the access request, change its status, or extend its deadline. A prepared private copy is not visible to the customer until explicitly released.</p>
    <label className="privacy-export-confirm"><input type="checkbox" checked={identityConfirmed} disabled={busy} onChange={event=>setIdentityConfirmed(event.target.checked)}/><span>I verified this exact person, account, email and access request before preparing a private review copy.</span></label>
    <details><summary>Include additional actual partial provider records</summary><p>Optional: load an Auth0, Stripe or Resend source file with complete:false and truthful category counts and pending coverage. This never marks a source collected or clears a gap.</p><label>Load actual partial source JSON<input type="file" accept=".json,application/json" disabled={busy} onChange={event=>void readSource(event.target.files?.[0])}/></label><label>Actual partial source JSON<textarea className="privacy-export-json" rows={5} value={sourceText} disabled={busy} onChange={event=>{setSourceText(event.target.value);setSourceConfirmed(false);setPrepared(null);setContent('');setReviewed(false)}}/></label>{sourceText&&<label className="privacy-export-confirm"><input type="checkbox" checked={sourceConfirmed} disabled={busy} onChange={event=>setSourceConfirmed(event.target.checked)}/><span>I inspected the actual additional records and verified exact-person attribution, category counts, pending scope, third-party details, attachments and credential redactions.</span></label>}</details>
    <button type="button" className="button secondary" disabled={busy||!identityConfirmed||!!sourceText.trim()&&!sourceConfirmed} onClick={()=>void prepare()}>{busy?'Preparing or reading private copy…':prepared?'Retry the same private preparation':'Prepare private copy for review'}</button>
    {error&&<p role="alert" className="privacy-export-error">{error} No completion is recorded. Preserve this review and retry the same action after reconciliation.</p>}{notice&&<p role="status">{notice}</p>}
    {prepared&&<><p className="privacy-export-id">Prepared request revision {prepared.requestRevision}. SHA-256 {prepared.artifact.sha256}. Private review expires {new Date(prepared.reviewExpiresAt).toLocaleString()}.</p>{changed&&<p role="alert">The request changed. Prepare and inspect a new copy before release.</p>}{content&&<><button type="button" className="button secondary" disabled={busy||changed} onClick={downloadReview}>Download private review JSON</button><details><summary>Inspect complete immutable private JSON</summary><pre className="privacy-export-json">{content}</pre></details><label>Actual review evidence <span>(customer-visible)</span><textarea rows={4} minLength={40} maxLength={3000} disabled={busy||changed} value={evidence} onChange={event=>{setEvidence(event.target.value);setReviewed(false)}}/></label><label className="privacy-export-confirm"><input type="checkbox" checked={reviewed} disabled={busy||changed} onChange={event=>setReviewed(event.target.checked)}/><span>I inspected this complete exact copy, including actual free text, record ownership, third-party information, private links and credentials, and its explicit outstanding coverage. I am releasing the checksum shown above as an interim copy; I am not attesting full fulfillment.</span></label><button type="button" className="button" disabled={busy||changed||!reviewed||evidence.trim().length<40} onClick={()=>void release()}>{busy?'Releasing reviewed copy…':'Release reviewed available-data copy'}</button></>}<button type="button" className="button secondary" disabled={busy} onClick={()=>{setPrepared(null);setContent('');setReviewed(false);attempts.current={};setNotice('The private review was discarded in this view. Prepare and inspect a new copy before release.')}}>Discard private review and prepare again</button></>}
  </section>
}
