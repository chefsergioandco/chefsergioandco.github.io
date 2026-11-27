import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const temporary = await mkdtemp(join(tmpdir(), 'sergio-readable-export-'))
try {
  const bundle = join(temporary, 'render.mjs')
  await build({entryPoints:[fileURLToPath(new URL('../src/account/export-copy.ts',import.meta.url))],outfile:bundle,bundle:true,format:'esm',platform:'node',logLevel:'silent'})
  const {renderPersonalDataCopy} = await import(pathToFileURL(bundle))
  const response = {generatedAt:'2026-11-27T19:00:00Z',readMe:{guide:'Read the snapshot and current records. <script>alert(1)</script>'},records:Array.from({length:205},(_,id)=>({id,notes:'Élise 🍽 <img src="https://outside.invalid" onerror="alert(1)"> & "quoted"'}))}
  const html=renderPersonalDataCopy(response)
  const body=html.match(/<pre>([\s\S]*)<\/pre>/)?.[1]
  assert(body)
  const decoded=body.replace(/&(amp|lt|gt|quot|#39);/g,(_,entity)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"}[entity]))
  assert.deepEqual(JSON.parse(decoded),response)
  console.log('PASS all 205 records and Unicode survive the readable rendition without truncation')
  assert(!html.includes('<script>'));assert(!html.includes('<img src='));assert(html.includes("default-src 'none'"));assert(html.includes("form-action 'none'"))
  assert(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'))
  console.log('PASS source text and guide cannot inject executable markup or load remote resources')
  const interim = renderPersonalDataCopy({...response,releaseKind:'interim',completion:{complete:false},pendingSources:['stripe']})
  assert(interim.includes('Available data · review ongoing.'))
  assert(interim.includes('not the completed response'))
  assert(interim.includes('Available collected data and outstanding coverage'))
  assert(!interim.includes('<h2>Complete response</h2>'))
  console.log('PASS interim readable copies preserve pending coverage and cannot imply a completed response')
} finally { await rm(temporary,{recursive:true,force:true}) }
