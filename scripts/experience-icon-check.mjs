// Small runtime check for the Experiences proximity cue and disclosure.
// Uses actual SVG path data and synthetic browser input; no source-state mutation.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import puppeteer from 'puppeteer-core'
import sharp from 'sharp'
import { serve } from './serve.mjs'

const OUT = path.resolve(process.env.EXPERIENCE_OUTPUT || 'output/experience-icon')
const ORIGIN = (process.env.NAV_BASE_URL || 'http://localhost:4359').replace(/\/$/, '')
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BUTTON = '.sergio-header-desktop [data-site-navigation-toggle]'
const MOBILE = '.sergio-header-mobile-toggle'
const PANEL = '#site-navigation-overview'
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const checks = [], errors = []
const check = (name, pass, detail = {}) => { checks.push({ name, pass: !!pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`) }
const save = (name, data) => fs.writeFileSync(path.join(OUT, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2))
fs.mkdirSync(OUT, { recursive: true })
let browser, server
const read = (page, selector = BUTTON) => page.$eval(selector, (button) => {
  const icon = button.querySelector('svg[data-experience-icon]'), r = button.getBoundingClientRect(), panel = document.querySelector('#site-navigation-overview')
  return { d: [...(icon?.querySelectorAll('path') || [])].map((p) => p.getAttribute('d')), iconState: icon?.getAttribute('data-experience-icon'), hover: button.matches(':hover'), focus: document.activeElement === button,
    expanded: button.getAttribute('aria-expanded'), hidden: panel.hidden, rect: { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }, finePointer: matchMedia('(hover:hover) and (pointer:fine)').matches }
})
const samePaths = (a, b) => a.d.length === b.d.length && a.d.every((d, i) => {
  const number = /[-+]?(?:\d*\.?\d+)(?:e[-+]?\d+)?/gi, other = b.d[i]
  const left = (d.match(number) || []).map(Number), right = (other.match(number) || []).map(Number)
  return d.replace(number,'#').replace(/\s/g,'') === other.replace(number,'#').replace(/\s/g,'') && left.length === right.length && left.every((value, n) => Math.abs(value - right[n]) < .0001)
})
async function open({ width = 1440, reduced = false, js = true } = {}) {
  const p = await browser.newPage(); p.on('pageerror', (e) => errors.push(e.message))
  await p.setViewport({ width, height: width === 390 ? 844 : 900, isMobile: width === 390, hasTouch: width === 390, deviceScaleFactor: 1 })
  if (!js) await p.setJavaScriptEnabled(false)
  if (reduced) await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  // The folded-invitation arrival has its own checks; these test the settled homepage a returning visitor sees.
  await p.evaluateOnNewDocument(() => { try { sessionStorage.setItem('sergio.home-arrival.v1', 'settled') } catch {} })
  await p.goto(`${ORIGIN}/`, { waitUntil: 'networkidle0' }); await p.evaluate(() => document.fonts.ready)
  await p.mouse.move(20, 700); await pause(220); return p
}
async function sample(page) {
  await page.evaluate(() => {
    window.__experienceFrames = []; window.__experienceStop = false
    const frame = (t) => {
      if (window.__experienceStop) return
      const b = document.querySelector('.sergio-header-desktop [data-site-navigation-toggle]'), svg = b.querySelector('svg[data-experience-icon]')
      window.__experienceFrames.push({ t, hover: b.matches(':hover'), hidden: document.getElementById('site-navigation-overview').hidden, d: [...svg.querySelectorAll('path')].map((p) => p.getAttribute('d')), svg: new XMLSerializer().serializeToString(svg), color: getComputedStyle(svg).color })
      requestAnimationFrame(frame)
    }; requestAnimationFrame(frame)
  })
}
async function finishFrames(page) {
  const frames = await page.evaluate(() => { window.__experienceStop = true; return window.__experienceFrames })
  save('path-frames.json', frames)
  const unique = frames.filter((f, i, all) => all.findIndex((q) => JSON.stringify(q.d) === JSON.stringify(f.d)) === i)
  const selected = [unique[0], unique[Math.floor(unique.length / 3)], unique[Math.floor(unique.length * 2 / 3)], unique.at(-1)].filter(Boolean)
  const tiles = await Promise.all(selected.map(async (f, i) => {
    const svg = f.svg.replace('width="20"', 'width="160"').replace('height="20"', 'height="160"').replace('<svg ', `<svg style="color:${f.color}" `)
    return { input: await sharp(Buffer.from(svg)).png().toBuffer(), left: i * 180 + 10, top: 10 }
  }))
  await sharp({ create: { width: Math.max(180, selected.length * 180), height: 180, channels: 3, background: '#fcfaf5' } }).composite(tiles).png().toFile(path.join(OUT, 'path-interpolation.png'))
  return frames
}
try {
  if (!process.env.NAV_BASE_URL) server = await serve(4359)
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true })
  const page = await open(), baseline = await read(page)
  check('Resting desktop icon is the utensil path with a closed disclosure', baseline.d.length === 4 && baseline.iconState === 'rest' && baseline.hidden && !baseline.hover, baseline)
  await page.screenshot({ path: path.join(OUT, 'resting.png') })
  const r = baseline.rect, near = { x: r.x - 20, y: r.y + r.height / 2 }
  const recorder = await page.screencast({ path: path.join(OUT, 'experience-cue.webm'), ffmpegPath: '/opt/homebrew/bin/ffmpeg' })
  await sample(page)
  await page.mouse.move(near.x, near.y); await pause(230)
  const approached = await read(page)
  const frames = await finishFrames(page)
  check('Pointer20px outside the button morphs actual path data before hover', !approached.hover && !samePaths(approached, baseline) && approached.iconState === 'dropdown', { pointer: near, baseline, approached })
  check('Proximity alone keeps the disclosure closed', approached.hidden && approached.expanded === 'false', approached)
  check('The outside-hover path transition has intermediate rendered shapes', new Set(frames.filter((f) => !f.hover && f.hidden).map((f) => JSON.stringify(f.d))).size >= 3, { samples: frames.length })
  await page.screenshot({ path: path.join(OUT, 'outside-cue.png') })
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2); await pause(230)
  const hovered = await read(page)
  check('Direct hover opens the overview and shows its chevron state', hovered.hover && !hovered.hidden && hovered.expanded === 'true' && hovered.iconState === 'dropdown', hovered)
  await page.screenshot({ path: path.join(OUT, 'hovered-menu.png') })
  const panel = await page.$eval(PANEL, (e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom } })
  await page.mouse.move(r.x + r.width / 2, (r.bottom + panel.top) / 2); await pause(40)
  check('Pointer bridge from trigger to panel stays open', !(await read(page)).hidden)
  await page.mouse.move(r.x + r.width / 2, panel.top + 70); await pause(200)
  check('Moving into the actual panel keeps the disclosure open', !(await read(page)).hidden)
  await page.mouse.move(20, 850); await pause(420)
  const left = await read(page)
  check('Leaving the interaction closes it and reverses to utensils', left.hidden && samePaths(left, baseline), left)
  await recorder.stop()
  execFileSync('/opt/homebrew/bin/ffmpeg', ['-y','-loglevel','error','-i',path.join(OUT,'experience-cue.webm'),'-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',path.join(OUT,'experience-cue.mp4')])
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2); await pause(80); await page.click(BUTTON)
  await page.mouse.move(20,850); await pause(260)
  check('Click pins an already hovered disclosure open after leaving', !(await read(page)).hidden)
  await page.click(BUTTON); await pause(200)
  check('A second trigger click toggles the pinned disclosure closed', (await read(page)).hidden)
  await page.mouse.move(20,850); await page.focus(BUTTON); await page.keyboard.press('Enter'); await pause(80)
  check('Enter opens navigation from keyboard focus', !(await read(page)).hidden)
  await page.keyboard.press('Escape'); await pause(80)
  check('Escape closes navigation and restores trigger focus', (await read(page)).hidden && (await read(page)).focus)
  await page.keyboard.press('Space'); await pause(80)
  check('Space opens navigation from keyboard focus', !(await read(page)).hidden)
  await page.focus('[data-hero-cta]'); await pause(180)
  check('Moving focus outside the header closes navigation', (await read(page)).hidden)
  await page.close()
  const mobile = await open({ width: 390 }); await mobile.tap(MOBILE); await pause(180)
  check('Mobile tap opens navigation', !(await read(mobile,MOBILE)).hidden)
  await mobile.tap(MOBILE); await pause(160)
  check('A second mobile tap closes navigation', (await read(mobile,MOBILE)).hidden)
  await mobile.close()
  const reduced = await open({ reduced: true }), reducedRest = await read(reduced)
  await reduced.mouse.move(reducedRest.rect.x - 20, reducedRest.rect.y + reducedRest.rect.height / 2); await pause(250)
  const reducedNear = await read(reduced)
  check('Reduced motion disables proximity morphing without opening navigation', samePaths(reducedNear,reducedRest) && reducedNear.hidden, reducedNear)
  await reduced.hover(BUTTON); await pause(120)
  check('Reduced-motion hover still opens accessible navigation', !(await read(reduced)).hidden)
  await reduced.close()
  const noJs = await open({ js: false })
  const links = await noJs.$$eval('noscript + nav, .sergio-header-fallback a[href]', (items) => items.filter((e) => e.matches('a')).map((e) => ({ href: e.getAttribute('href'), visible: e.getClientRects().length > 0 })))
  check('Without JavaScript the real service navigation links remain visible', ['/privatedining/','/cookingclasses/','/catering/'].every((route) => links.some((l) => l.href.endsWith(route) && l.visible)), links)
  await noJs.close()
  check('No uncaught browser errors occurred', errors.length === 0, errors)
  save('results.json', { passed: checks.filter((c) => c.pass).length, total: checks.length, checks, errors, method: 'Isolated headless Chrome with synthetic mouse, keyboard and touch input; direct rendered SVG d measurements and browser screenshots. No physical-device or unfamiliar-user acceptance claim.' })
  save('results.txt', checks.map((c) => `${c.pass ? 'PASS' : 'FAIL'} ${c.name}`).join('\n'))
  if (checks.some((c) => !c.pass)) process.exitCode = 1
} catch (error) { save('harness-error.txt', error.stack || String(error)); console.error(error); process.exitCode = 1 }
finally { await browser?.close(); await new Promise((resolve) => server ? server.close(resolve) : resolve()) }
