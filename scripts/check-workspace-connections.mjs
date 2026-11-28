import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../', import.meta.url))
const source = await readFile(new URL('../admin/src/App.tsx', import.meta.url), 'utf8')
const parsed = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let modal
function visit(node) {
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(parsed) === 'Modal' &&
      node.openingElement.attributes.properties.some(attribute =>
        ts.isJsxAttribute(attribute) && attribute.name.getText(parsed) === 'title' &&
        attribute.initializer && ts.isStringLiteral(attribute.initializer) && attribute.initializer.text === 'Workspace & connections')) modal = node
  ts.forEachChild(node, visit)
}
visit(parsed)
assert(modal, 'The existing Workspace & connections modal remains accessible.')
assert.match(source, /const\s*\{[^}]*\bcapabilities\b[^}]*\}\s*=\s*useAdmin\(\)/,
  'Connection labels use the capabilities already loaded into the authenticated store.')

// Render the actual modal content, replacing only its overlay shell and decorative icon.
// No workspace/provider request or fabricated connection check runs in this fixture.
const temporary = await mkdtemp(join(tmpdir(), 'sergio-workspace-connections-'))
try {
  const bundle = join(temporary, 'render.cjs')
  await build({ absWorkingDir: root, stdin: { contents: `
    import React from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    const Modal=({title,children})=><section aria-label={title}>{children}</section>;
    const Icon=()=>null;
    const user={email:'operator@example.test'},setHelp=()=>{};
    export function render(capabilities){return renderToStaticMarkup(${modal.getText(parsed)})}
  `, resolveDir: root, loader: 'tsx' }, outfile: bundle, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' })
  const { render } = await import(pathToFileURL(bundle))
  const unescape = value => value.replaceAll('&amp;', '&')
  const rows = html => Object.fromEntries([...html.matchAll(/<dt>(.*?)<\/dt><dd>(.*?)<\/dd>/g)].map(([, label, value]) => [unescape(label), unescape(value)]))

  for (const cardPayments of [false, true]) for (const publicBooking of [false, true]) for (const websitePublishing of [false, true]) {
    const html = render({cardPayments, publicBooking, websitePublishing}), status = rows(html)
    assert.equal(status['Card payments'], cardPayments ? 'Enabled · secure checkout available' : 'Unavailable · offline receipts available')
    assert.equal(status['Public booking page'], publicBooking ? 'Connected · new requests arrive here' : 'Unavailable · booking connection needs attention')
    assert.equal(status['Website publishing'], websitePublishing ? 'Connected · publishing available' : 'Not connected · save drafts here')
    assert.equal(status['Google Calendar'], 'Not connected')
    assert.equal(status['Guest email'], 'Connection status in Communications')
    assert(html.includes('These labels describe the current setup.'))
    assert(html.includes('Check each payment in Billing &amp; records and email delivery in Communications to confirm the result.'))
    assert(!html.includes('Payment received') && !html.includes('Email delivered'), 'Readiness must not imply a completed transaction or delivery.')
  }
  console.log('PASS all 8 capability combinations render truthful labels in the existing modal; Google/email boundaries and result-verification guidance remain.')
} finally {
  await rm(temporary, {recursive: true, force: true})
}
