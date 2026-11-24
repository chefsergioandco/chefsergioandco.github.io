#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../', import.meta.url))
await mkdir(path.join(root, 'tmp'), { recursive: true })
const temporary = await mkdtemp(path.join(root, 'tmp', 'invitation-assembly-check-'))
let count = 0
function check(name, run) { run(); count++; process.stdout.write(`PASS ${name}\n`) }
try {
  const output = path.join(temporary, 'assembly.mjs')
  await build({
    absWorkingDir: root, stdin: {
      contents: `export { InvitationAssembly } from './src/invitations/InvitationAssembly'; export { SAMPLE_INVITATION } from './src/invitations/sample'; export { SAMPLE_DINNER_MENU } from './src/invitations/menu-sample';`,
      resolveDir: root, sourcefile: 'invitation-assembly-check-entry.ts', loader: 'ts',
    },
    outfile: output, bundle: true, platform: 'node', format: 'esm', target: 'es2022', jsx: 'automatic',
    external: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/server'],
    loader: { '.css': 'empty' }, define: { 'import.meta.env.BASE_URL': '"/"' },
  })
  const { InvitationAssembly, SAMPLE_INVITATION, SAMPLE_DINNER_MENU } = await import(pathToFileURL(output).href)
  // The assembly returns the invitation card followed by its print-only menu; property checks read the card.
  const assembled = props => [].concat(InvitationAssembly(props).props.children)[0]
  const base = { ...SAMPLE_INVITATION, recipientName: '', hostName: 'The Rivera family', title: 'A graduation together', menu: [], menuConfirmed: false }
  const approved = { ...base, menuConfirmed: true, menu: ['Lobster Bisque', 'Cordon Bleu', 'Crème Brûlée'] }
  const render = props => renderToStaticMarkup(React.createElement(InvitationAssembly, props))
  const plain = render({ document: base, openProgress: 1 })
  const live = render({ document: approved, openProgress: 1, menuNew: true })
  check('the assembly renders the current four-face invitation master', () => {
    const faces = [...plain.matchAll(/data-invitation-face="([^"]+)"/g)].map(match => match[1])
    assert.deepEqual(faces, ['cover', 'note', 'details', 'back'])
    assert.equal((plain.match(/class="invitation-print-fallback"/g) || []).length, 4)
    assert(plain.includes('Welcome,'))
    assert(plain.includes('A graduation together'))
    assert(plain.includes('Winter Park, Florida'))
  })
  check('an unready live menu adds neither an enclosure nor a placeholder or new-menu cue', () => {
    const draft = render({ document: { ...base, menu:['UNPUBLISHED MENU'] }, menuNew:true, menuProgress:1 })
    for (const html of [plain, draft]) {
      assert(html.includes('data-has-enclosure="false"'))
      assert(html.includes('data-menu-new="false"'))
      assert.equal(assembled({document:base,menuProgress:1}).props.enclosureProgress,0)
      assert(!html.includes('invitation-print-menu'))
      assert(!html.includes('data-dinner-menu='))
      assert(!html.includes('UNPUBLISHED MENU'))
      assert(!/menu (?:to follow|unavailable|not ready|coming soon)/i.test(html))
    }
  })
  check('confirmed whitespace-only menu content cannot create a physical enclosure', () => {
    const html=render({document:{...base,menuConfirmed:true,menu:['  ','\n']},menuNew:true})
    assert(html.includes('data-has-enclosure="false"'))
    assert(html.includes('data-menu-new="false"'))
    assert(!html.includes('data-dinner-menu='))
    assert(!html.includes('invitation-print-menu'))
  })
  check('the current flat 5-by-8 menu is one unbroken horizontal insert inside the invitation leaf', () => {
    assert(/class="invitation-card-stationary"[\s\S]*class="invitation-card-enclosure"[\s\S]*data-dinner-menu=""/.test(live))
    assert(live.includes('dinner-menu-card--inserted'))
    assert(live.includes('data-menu-inserted="true"'))
    assert(live.includes('data-menu-status="confirmed"'))
    assert(live.includes('data-menu-reveal-progress="0.000"'))
    assert(live.includes('rotateZ(-90deg)'))
    assert(live.includes('aria-label="Menu. Take out and turn the menu upright."'))
    assert.equal((live.split('class="invitation-print-menu"')[0].match(/viewBox="0 0 360 576"/g) || []).length,1)
    assert.equal((live.match(/<canvas[^>]*width="1080"[^>]*height="1728"/g) || []).length,1)
    assert(!/dinner-menu-(?:fold|fragment|crease)|data-menu-fold|CottonReverse/.test(live))
    for(const course of approved.menu) assert(live.includes(course))
  })
  check('a ready menu also prints whole after the invitation, once, as flat 5-by-8 artwork hidden from screen readers', () => {
    const print = live.split('class="invitation-print-menu"')[1]
    assert(print, 'print-only menu block is present')
    assert(/^ aria-hidden="true"/.test(print))
    assert.equal((print.match(/<svg/g) || []).length, 1)
    assert(print.includes('width="5in" height="8in"'))
    for (const course of approved.menu.filter(line => !/[&<>"']/.test(line))) assert(print.includes(course))
  })
  check('the physical controls have no legacy toolbar, transcript toggle or menu-added HUD', () => {
    for(const html of [plain,live]) {
      assert(!/<button(?:\s|>)/.test(html))
      assert(!/<(?:details|summary)(?:\s|>)/.test(html))
      assert(!/<section[^>]+aria-label="Cover"/.test(html))
      assert(!/menu added|view invitation text|show transcript|hide transcript|rotate left|rotate right/i.test(html))
    }
    assert(plain.includes('class="invitation-sr-only"'))
    assert(live.includes('class="dinner-menu-sr-only"'))
  })
  check('the specimen enclosure requires an explicit specimen prop and stays visibly a specimen', () => {
    const specimen=render({document:base,specimenMenu:SAMPLE_DINNER_MENU})
    assert(specimen.includes('data-has-enclosure="true"'))
    assert(specimen.includes('data-menu-status="specimen"'))
    assert(specimen.includes('aria-label="Menu design specimen"'))
    assert(specimen.includes('Lobster Bisque'))
    assert(!plain.includes('Lobster Bisque'))
    const disguised=render({document:base,specimenMenu:{...SAMPLE_DINNER_MENU,status:'draft'}})
    assert(disguised.includes('data-has-enclosure="false"'))
    const liveFirst=render({document:approved,specimenMenu:{...SAMPLE_DINNER_MENU,courses:[{name:'PREVIEW ONLY'}]}})
    assert(liveFirst.includes('data-menu-status="confirmed"'))
    assert(!liveFirst.includes('PREVIEW ONLY'))
  })
  check('newness and reveal progress are gated by the actual enclosure', () => {
    const newClosed=render({document:approved,openProgress:0,menuNew:true,menuProgress:0})
    assert(newClosed.includes('data-menu-new="true"'))
    assert(newClosed.includes('data-menu-reveal-progress="0.000"'))
    const old=render({document:approved,menuNew:false,menuProgress:1})
    assert(old.includes('data-menu-new="false"'))
    assert(old.includes('data-menu-reveal-progress="1.000"'))
    assert(old.includes('rotateZ(0deg)'))
    assert(old.includes('aria-expanded="true"'))
    const hidden=assembled({document:base,menuNew:true,menuProgress:1})
    assert.equal(hidden.props.enclosure,undefined)
    assert.equal(hidden.props.enclosureProgress,0)
    assert.equal(hidden.props.menuNew,false)
  })
  check('only changed menu artwork or its explicit edition replaces the enclosure', () => {
    const first=assembled({document:approved})
    const revised=assembled({document:{...approved,version:approved.version+10,title:'An updated invitation title'}})
    const changed=assembled({document:{...approved,menu:[...approved.menu,'A new course']}})
    assert.equal(first.props.enclosure.key,revised.props.enclosure.key)
    assert.notEqual(first.props.enclosure.key,changed.props.enclosure.key)
    assert.notEqual(assembled({document:approved,menuVersion:'edition-1'}).props.enclosure.key,assembled({document:approved,menuVersion:'edition-2'}).props.enclosure.key)
    assert.equal(first.props.showTranscript,false)
    assert.equal(first.props.enclosure.props.inserted,true)
    assert.equal(first.props.enclosure.props.revealProgress,0)
    assert.equal(first.props.enclosure.props.folded,undefined)
  })
  check('physical reveal callbacks and the shared progress pass through without a second interface', () => {
    const open=()=>{},menuOpen=()=>{},reveal=()=>{}
    const element=assembled({document:approved,onOpenRequest:open,onMenuOpen:menuOpen,onMenuRevealRequest:reveal,menuProgress:.4,maxSheetWidth:540,openProgress:.6})
    assert.equal(element.props.onOpenRequest,open)
    assert.equal(element.props.enclosure.props.onOpen,menuOpen)
    assert.equal(element.props.enclosure.props.onRevealRequest,reveal)
    assert.equal(element.props.enclosure.props.revealProgress,.4)
    assert.equal(element.props.enclosureProgress,.4)
    assert.equal(element.props.maxSheetWidth,540)
    assert.equal(element.props.openProgress,.6)
    assert.equal(element.props.enclosure.props.onFoldChange,undefined)
  })
  process.stdout.write(`\n${count} invitation assembly checks passed (actual React SSR; browser material and gestures remain separate checks).\n`)
} finally { await rm(temporary,{recursive:true,force:true}) }
