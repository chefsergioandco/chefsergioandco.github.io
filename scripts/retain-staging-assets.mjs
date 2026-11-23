// Keep cached pages working across three subsequent staging deployments.
// Download only successful main-branch Pages artifacts from this exact repository.
// The archive reader uses each original Vite manifest, never its retained history.
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const REPOSITORY = 'chefsergioandco/chefsergioandco.github.io'
const MAX_ARCHIVES = 3
const MAX_DOWNLOAD = 64 * 1024 * 1024
const token = process.env.GH_TOKEN
if (process.env.GITHUB_REPOSITORY !== REPOSITORY || !/^\d+$/.test(process.env.GITHUB_RUN_ID ?? '') || !token) throw new Error('Run asset retention only in the staging Pages workflow.')
const base = `https://api.github.com/repos/${REPOSITORY}/actions`
const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
async function api(path) {
  const response = await fetch(base + path, { headers, redirect: 'error', signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`Pages artifact metadata unavailable (${response.status}).`)
  return response.json()
}
async function boundedBytes(response) {
  if (!response.ok || Number(response.headers.get('content-length') || 0) > MAX_DOWNLOAD) throw new Error('Previous Pages artifact exceeds the download limit or is unavailable.')
  const chunks = []; let length = 0
  for await (const chunk of response.body) {
    length += chunk.byteLength
    if (length > MAX_DOWNLOAD) throw new Error('Previous Pages artifact exceeds the download limit.')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}
async function download(id, digest) {
  if (!Number.isSafeInteger(id) || !/^sha256:[a-f0-9]{64}$/.test(digest ?? '')) throw new Error('Previous Pages artifact lacks verified integrity metadata.')
  const response = await fetch(`${base}/artifacts/${id}/zip`, { headers, redirect: 'manual', signal: AbortSignal.timeout(30000) })
  if (response.status !== 302) throw new Error(`Previous Pages artifact redirect unavailable (${response.status}).`)
  const location = new URL(response.headers.get('location') || '')
  if (location.protocol !== 'https:' || location.username || location.password || location.port || !/\.(?:blob\.core\.windows\.net|githubusercontent\.com)$/.test(location.hostname)) throw new Error('Unexpected Pages artifact download destination.')
  // Never send the GitHub token to the signed storage URL, or follow another redirect.
  const bytes = await boundedBytes(await fetch(location, { redirect: 'error', signal: AbortSignal.timeout(30000) }))
  if ('sha256:' + createHash('sha256').update(bytes).digest('hex') !== digest) throw new Error('Previous Pages artifact integrity check failed.')
  return bytes
}

const directory = await mkdtemp(join(tmpdir(), 'chef-pages-assets-'))
try {
  const listed = await api('/workflows/pages.yml/runs?branch=main&status=success&per_page=4')
  const runs = (listed.workflow_runs ?? []).filter(run => String(run.id) !== process.env.GITHUB_RUN_ID && run.status === 'completed' && run.conclusion === 'success' && run.head_branch === 'main' && ['push', 'workflow_dispatch'].includes(run.event) && run.path === '.github/workflows/pages.yml' && run.repository?.full_name === REPOSITORY && run.head_repository?.full_name === REPOSITORY).slice(0, MAX_ARCHIVES)
  const archives = [], restored = []
  for (const run of runs) {
    const listing = await api(`/runs/${run.id}/artifacts`)
    const matches = (listing.artifacts ?? []).filter(item => item.name === 'github-pages' && !item.expired)
    if (matches.length > 1) throw new Error('Ambiguous previous Pages artifact.')
    if (!matches.length) continue // Old artifacts may have reached their one-day retention limit.
    const artifact = matches[0]
    if (artifact.size_in_bytes > MAX_DOWNLOAD) throw new Error('Previous Pages artifact exceeds the download limit.')
    const path = join(directory, `${run.id}.zip`)
    await writeFile(path, await download(artifact.id, artifact.digest), { flag: 'wx' })
    archives.push(path); restored.push({ run: run.id, commit: run.head_sha })
  }
  const result = spawnSync('python3', ['scripts/retain-staging-assets.py', 'dist', ...archives], { encoding: 'utf8', maxBuffer: 1024 * 1024 })
  if (result.status !== 0) throw new Error('Previous Pages assets failed archive validation. ' + (result.stderr || '').trim().slice(0, 500))
  console.log(JSON.stringify({ ...JSON.parse(result.stdout), previousBuilds: restored }))
} finally { await rm(directory, { recursive: true, force: true }) }
