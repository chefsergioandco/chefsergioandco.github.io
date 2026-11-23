#!/usr/bin/env node
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const built = await build({ entryPoints: [new URL('../src/invitations/invitation-sequence.ts', import.meta.url).pathname], bundle: true, write: false, platform: 'node', format: 'esm', target: 'es2022' })
const { invitationSequence, INVITATION_FOLD_DISTANCE, MENU_REVEAL_DISTANCE } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'))
let count = 0
const close = (actual, expected) => assert(Math.abs(actual - expected) < 1e-9, `${actual} should equal ${expected}`)
function check(name, run) { run(); count++; process.stdout.write(`PASS ${name}\n`) }

check('the first 400 input pixels open the invitation before moving the menu or page', () => {
  assert.equal(INVITATION_FOLD_DISTANCE, 400)
  const start = invitationSequence(0, true, 1200), midway = invitationSequence(200, true, 1200), opened = invitationSequence(400, true, 1200)
  assert.deepEqual([start.fold, start.menu, start.scroll], [0,0,0])
  assert.deepEqual([midway.fold, midway.menu, midway.scroll], [.5,0,0])
  assert.deepEqual([opened.fold, opened.menu, opened.scroll], [1,0,0])
})
check('the next 540 input pixels extract and turn the flat menu before ordinary scrolling', () => {
  assert.equal(MENU_REVEAL_DISTANCE, 540)
  const midway = invitationSequence(670, true, 1200), upright = invitationSequence(940, true, 1200)
  assert.deepEqual([midway.fold, midway.menu, midway.scroll], [1,.5,0])
  assert.deepEqual([upright.fold, upright.menu, upright.scroll], [1,1,0])
  assert.equal(upright.ceremonyDistance, 940)
})
check('ordinary page travel starts immediately after the flat menu is upright', () => {
  const page = invitationSequence(1140, true, 1200)
  assert.deepEqual([page.fold, page.menu, page.scroll], [1,1,200])
})
check('one accumulated flick carries its remaining distance through both transitions into the page', () => {
  const before = invitationSequence(350, true, 1200), after = invitationSequence(before.distance + 900, true, 1200)
  assert.equal(before.scroll,0)
  assert.deepEqual([after.distance, after.fold, after.menu, after.scroll], [1250,1,1,310])
})
check('reversing the same distance walks from page to menu to invitation without a reset', () => {
  const page = invitationSequence(1240, true, 1200)
  const menu = invitationSequence(page.distance - 570, true, 1200)
  const cover = invitationSequence(menu.distance - 470, true, 1200)
  assert.deepEqual([page.fold,page.menu,page.scroll], [1,1,300])
  assert.deepEqual([menu.fold,menu.menu,menu.scroll], [1,.5,0])
  assert.deepEqual([cover.fold,cover.menu,cover.scroll], [.5,0,0])
})
check('an invitation with no ready menu skips the entire 540-pixel menu segment', () => {
  const noMenu = invitationSequence(670, false, 1200)
  assert.deepEqual([noMenu.ceremonyDistance,noMenu.fold,noMenu.menu,noMenu.scroll], [400,1,0,270])
  assert.equal(invitationSequence(400,false,0).distance,400)
})
check('both transition boundaries are continuous in forward and reverse travel', () => {
  const epsilon = .001
  for (const boundary of [400,940]) {
    const before = invitationSequence(boundary - epsilon, true, 1200), exact = invitationSequence(boundary, true, 1200), after = invitationSequence(boundary + epsilon, true, 1200)
    for (const key of ['fold','menu','scroll']) {
      assert(before[key] <= exact[key] && exact[key] <= after[key])
      assert(after[key] - before[key] <= .0020000001)
    }
  }
  close(invitationSequence(940 + epsilon,true,1200).scroll, epsilon)
})
check('bounds include the ceremony when there is no native page height', () => {
  assert.deepEqual(invitationSequence(-100,true,0), {distance:0,ceremonyDistance:940,fold:0,menu:0,scroll:0})
  assert.deepEqual(invitationSequence(50000,true,0), {distance:940,ceremonyDistance:940,fold:1,menu:1,scroll:0})
  assert.deepEqual(invitationSequence(50000,false,0), {distance:400,ceremonyDistance:400,fold:1,menu:0,scroll:0})
  assert.equal(invitationSequence(50000,true,-200).scroll,0)
})
check('native travel is bounded and nonfinite input cannot produce invalid transforms', () => {
  const end = invitationSequence(50000,true,300)
  assert.deepEqual([end.distance,end.scroll], [1240,300])
  for (const input of [NaN,Infinity,-Infinity]) assert.deepEqual([invitationSequence(input,true,300).fold,invitationSequence(input,true,300).menu,invitationSequence(input,true,300).scroll], [0,0,0])
})
process.stdout.write(`\n${count} invitation sequence checks passed (pure distance mapping; real input/device feel remains a browser check).\n`)
