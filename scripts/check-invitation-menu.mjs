import assert from 'node:assert/strict'
import { build } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const result = await build({ entryPoints: ['src/booking/InvitationPaper.tsx'], bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } })
const { InvitationPaper } = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'))
const attentionBuild = await build({entryPoints:['src/booking/invitation-attention.ts'],bundle:true,write:false,platform:'node',format:'esm'})
const {observeInvitation,acknowledgeMenu,parseInvitationAttention} = await import('data:text/javascript;base64,'+Buffer.from(attentionBuild.outputFiles[0].text).toString('base64'))
const invitation = { title: 'Graduation dinner', hostName: 'Example host', date: '2027-05-15', time: '18:00', venueName: 'At home', address: ['123 Example Lane', 'Winter Park, FL'] }
const render = extra => renderToStaticMarkup(React.createElement(InvitationPaper, { invitation: { ...invitation, ...extra } }))
let count = 0
function check(name, run) { run(); count++; console.log('PASS ' + name) }
check('an invitation without a menu keeps its event details and renders no menu section or placeholder', () => {
  const html = render({ menuReady: false })
  assert.match(html, /Graduation dinner/); assert.match(html, /123 Example Lane/)
  assert.doesNotMatch(html, /data-invitation-menu|THE MENU|coming soon|finishing touches|menu to follow/i)
})
check('draft or stale menu text is never shown without an explicit ready status', () => {
  for (const menuReady of [undefined, false]) assert.doesNotMatch(render({ menuReady, menu: 'PRIVATE draft dish' }), /PRIVATE draft dish|data-invitation-menu|THE MENU/)
})
check('a ready flag with empty or whitespace content creates no empty inside leaf', () => {
  for (const menu of [undefined, null, '', ' \n ']) assert.doesNotMatch(render({ menuReady: true, menu }), /data-invitation-menu|THE MENU/)
})
check('a ready menu is included inside the same invitation article', () => {
  const html = render({ menuReady: true, menu: 'Cordon bleu\nCelebration dessert' })
  assert.equal((html.match(/<article/g) || []).length, 1)
  assert.match(html, /data-menu-ready="true"/); assert.match(html, /Cordon bleu/); assert.match(html, /Celebration dessert/)
  assert.ok(html.indexOf('data-invitation-menu') < html.indexOf('</article>'))
})
check('withdrawing a previously ready menu removes its heading, content and inside leaf', () => {
  assert.match(render({ menuReady: true, menu: 'Published dish' }), /Published dish/)
  assert.doesNotMatch(render({ menuReady: false, menu: 'Published dish' }), /Published dish|data-invitation-menu|THE MENU/)
})
check('menu copy is rendered as text rather than executable markup', () => {
  const html = render({ menuReady: true, menu: '<script>alert(1)</script>' })
  assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>/)
})
check('the printable invitation includes only a ready menu even before its on-screen leaf is opened', () => {
  assert.match(render({menuReady:true,menu:'Cordon bleu'}), /event-invitation-print-menu/)
  assert.doesNotMatch(render({menuReady:false,menu:'PRIVATE draft dish'}), /event-invitation-print-menu|PRIVATE draft dish/)
})
check('a first visit establishes a baseline without pretending existing content was just added', () => {
  assert.equal(observeInvitation(null,null).newVersion,null)
  assert.equal(observeInvitation(null,'menu-v1').newVersion,null)
})
check('a menu arriving after the invitation was viewed creates a persistent new-content cue', () => {
  const first=observeInvitation(null,null), added=observeInvitation(first,'menu-v1')
  assert.equal(added.newVersion,'menu-v1')
  assert.equal(observeInvitation(added,'menu-v1').newVersion,'menu-v1')
  assert.equal(observeInvitation(parseInvitationAttention(JSON.stringify(added)),'menu-v1').newVersion,'menu-v1')
})
check('opening the new menu clears the cue across later visits to the same version', () => {
  const added=observeInvitation(observeInvitation(null,null),'menu-v1'), opened=acknowledgeMenu(added,'menu-v1')
  assert.equal(opened.newVersion,null)
  assert.equal(observeInvitation(parseInvitationAttention(JSON.stringify(opened)),'menu-v1').newVersion,null)
})
check('a later menu edition is new even when the previous edition was opened', () => {
  const opened=acknowledgeMenu(observeInvitation(null,'menu-v1'),'menu-v1')
  assert.equal(observeInvitation(opened,'menu-v2').newVersion,'menu-v2')
  assert.equal(acknowledgeMenu(observeInvitation(opened,'menu-v2'),'menu-v1').newVersion,'menu-v2')
})
check('withdrawal removes the cue while keeping a later ready edition discoverable', () => {
  const pending=observeInvitation(observeInvitation(null,null),'menu-v1'), withdrawn=observeInvitation(pending,null)
  assert.equal(withdrawn.newVersion,null);assert.equal(withdrawn.availableVersion,null)
  assert.equal(observeInvitation(withdrawn,'menu-v2').newVersion,'menu-v2')
})
check('view memory rejects malformed or excessive browser state', () => {
  for(const value of [null,'broken','{}','x'.repeat(1001),JSON.stringify({viewed:true,availableVersion:'<script>',openedVersion:null,newVersion:null})])assert.equal(parseInvitationAttention(value),null)
})
check('the arrival affordance belongs only to an available menu and includes a keyboard-operable open action', () => {
  const waiting=renderToStaticMarkup(React.createElement(InvitationPaper,{invitation:{...invitation,menuReady:false,menu:'Private'},hasNewMenu:true}))
  assert.doesNotMatch(waiting,/has-new-menu|Menu added|data-invitation-menu/)
  const arrived=renderToStaticMarkup(React.createElement(InvitationPaper,{invitation:{...invitation,menuReady:true,menu:'Cordon bleu'},hasNewMenu:true}))
  assert.match(arrived,/has-new-menu/);assert.match(arrived,/<button[^>]*type="button"/);assert.match(arrived,/Menu added/);assert.match(arrived,/role="status"/)
})
console.log(`${count} invitation-menu rendering checks passed.`)
