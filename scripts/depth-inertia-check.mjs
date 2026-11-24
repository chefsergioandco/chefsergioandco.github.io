// Continuous input and weighted following: actual native scroll versus delivered pixel energy.
// Synthetic CDP input is not physical-device or unfamiliar-reader acceptance. Never builds.
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import puppeteer from 'puppeteer-core'

const BUILD = path.resolve(process.env.DIST_DIR || 'dist')
process.env.DIST_DIR = BUILD
const { serve } = await import('./serve.mjs')
const PORT = Number(process.env.DEPTH_INERTIA_PORT) || 4380
const ORIGIN = process.env.DEPTH_INERTIA_ORIGIN || `http://localhost:${PORT}`
const OUT = path.resolve(process.env.SHOTS_DIR || 'output/depth-flow/check')
const PHASE = process.env.DEPTH_INERTIA_PHASE || 'candidate'
const FOCUS_CONTINUOUS = process.env.DEPTH_INERTIA_FOCUS === 'continuous-wheel-across-seams'
const FOCUS_SATURATED = process.env.DEPTH_INERTIA_FOCUS === 'saturated-wheel-burst'
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const CONTRACT = { energyTolerancePx: 3, tinyTolerancePx: .75, maxActivePlateauMs: 80, maxWheelSpeedPxSec: 1150,
  maxWheelResidualPx: 200, wheelStopMs: 900, maxTouchFlickResidualPx: 550 }
const checks = [], scenarios = [], errors = []
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const close = (a, b, tolerance = 3) => Math.abs(a - b) <= tolerance
const check = (name, pass, detail = {}) => { checks.push({ name, pass: !!pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`) }
const save = (name, value) => fs.writeFileSync(path.join(OUT, name), JSON.stringify(value, null, 2))
const signature = () => Object.fromEntries(['index.html', '.vite/manifest.json'].map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(BUILD, file))).digest('hex')]))
let browser, server
fs.mkdirSync(OUT, { recursive: true })

// Register before application capture listeners: the authored pinned timeline
// intentionally stops propagation once it owns a wheel or touch event.
function installInputRecorder() {
  let touchY = null
  const record = event => {
    let delta = 0
    if (event.type === 'wheel') delta = event.deltaY * (event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? innerHeight : 1)
    if (event.type === 'touchstart') touchY = event.touches[0]?.clientY ?? null
    if (event.type === 'touchmove') { const next = event.touches[0]?.clientY; if (touchY !== null && next !== undefined) delta = touchY - next; touchY = next ?? null }
    if (event.type === 'touchend' || event.type === 'touchcancel') touchY = null
    const run = window.__flowEvidence
    if (!run?.active) return
    const input = { t: performance.now(), type: event.type, delta, key: event.key ?? null, y: scrollY, trusted: event.isTrusted, prevented: false,
      plating: window.__platingTimeline ? { ...window.__platingTimeline } : null }
    run.inputs.push(input)
    setTimeout(() => { input.prevented = event.defaultPrevented; input.platingAfter = window.__platingTimeline ? { ...window.__platingTimeline } : null }, 0)
  }
  for (const type of ['wheel', 'touchstart', 'touchmove', 'touchend', 'touchcancel', 'keydown']) window.addEventListener(type, record, { passive: true, capture: true })
}

async function open({ width = 1440, height = 1000, reduced = false, disabled = false, js = true } = {}) {
  const page = await browser.newPage()
  page.on('pageerror', error => errors.push({ error: error.message, url: page.url() }))
  page.on('console', message => { if (message.type() === 'error' && !/favicon\.ico/.test(message.location().url || '')) errors.push({ error: message.text(), source: message.location().url, url: page.url() }) })
  await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: width <= 620, hasTouch: width <= 620 })
  if (reduced) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  if (!js) await page.setJavaScriptEnabled(false)
  await page.evaluateOnNewDocument(installInputRecorder)
  // The folded-invitation arrival has its own checks; these test the settled homepage a returning visitor sees.
  await page.evaluateOnNewDocument(() => { try { sessionStorage.setItem('sergio.home-arrival.v1', 'settled') } catch {} })
  await page.goto(`${ORIGIN}/?depth=${disabled ? 'off' : 'on'}`, { waitUntil: 'networkidle0' })
  await page.evaluate(() => document.fonts.ready)
  if (js) await page.waitForFunction(() => !!window.__depthStudy, { timeout: 5000 })
  await pause(150)
  return page
}

const state = page => page.evaluate(() => {
  const top = element => { let y = 0; for (let node = element; node; node = node.offsetParent) y += node.offsetTop; return y }
  const header = document.querySelector('header').getBoundingClientRect()
  const sections = [...document.querySelectorAll('[data-depth-study]>main>section,[data-depth-study]>footer')]
  return { diagnostic: { ...window.__depthStudy }, y: scrollY, height: innerHeight, headerHeight: header.height, maxScroll: document.documentElement.scrollHeight - innerHeight,
    sections: sections.map((section, index) => ({ id: section.id || section.getAttribute('aria-labelledby') || `section-${index}`, top: top(section), height: section.offsetHeight })),
    seams: sections.slice(1).map(section => Math.max(0, top(section) - header.height)) }
})

async function align(page, y) {
  await page.evaluate(() => { document.activeElement?.blur(); document.body.tabIndex = -1; document.body.focus({ preventScroll: true }) })
  await page.keyboard.press('Escape')
  await page.evaluate(y => scrollTo({ top: y, behavior: 'instant' }), y)
  await pause(150)
}

async function startTrace(page) {
  await page.evaluate(() => {
    if (window.__flowEvidence) window.__flowEvidence.active = false
    const run = window.__flowEvidence = { active: true, frames: [], inputs: [] }
    const sample = t => {
      if (!run.active) return
      const diagnostic = window.__depthStudy || {}
      run.frames.push({ t, y: scrollY, phase: diagnostic.phase, velocity: diagnostic.velocity, targetY: diagnostic.targetY, lag: diagnostic.lag,
        plating: window.__platingTimeline ? { ...window.__platingTimeline } : null,
        headings: [...document.querySelectorAll('main>section h1,main>section h2')].flatMap(heading => { const box = heading.getBoundingClientRect(); return box.bottom > 0 && box.top < innerHeight ? [{ text: heading.textContent.trim(), top: box.top, bottom: box.bottom }] : [] }) })
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
}

async function finishTrace(page) { await pause(30); return page.evaluate(() => { window.__flowEvidence.active = false; return window.__flowEvidence }) }

async function wheel(page, profile) {
  const viewport = page.viewport()
  await page.mouse.move(viewport.width - 24, Math.max(180, viewport.height * .65))
  const start = performance.now()
  for (const input of profile) { await pause(Math.max(0, start + input.at - performance.now())); await page.mouse.wheel({ deltaY: input.delta }) }
}

function measure(trace, before, after) {
  const inputs = trace.inputs.filter(input => input.type === 'wheel' || input.type === 'touchmove')
  const lastPhysical = trace.inputs.filter(input => ['wheel', 'touchmove', 'touchend'].includes(input.type)).at(-1)?.t ?? trace.frames[0].t
  const firstInput = inputs[0]?.t ?? trace.frames[0].t, lastMove = inputs.at(-1)?.t ?? firstInput
  const totalInput = inputs.reduce((sum, input) => sum + input.delta, 0)
  const expectedY = Math.max(0, Math.min(before.maxScroll, before.y + totalInput))
  const speeds = trace.frames.slice(1).map((frame, index) => ({ t: frame.t, value: (frame.y - trace.frames[index].y) / (frame.t - trace.frames[index].t) * 1000 }))
  let flatStart = null, longestPlateau = 0, flatY = null
  for (const frame of trace.frames) {
    const active = frame.t >= firstInput + 80 && frame.t <= lastMove && inputs.some(input => input.t <= frame.t && frame.t - input.t <= 100)
    if (!active || frame.y <= 1 || frame.y >= before.maxScroll - 1) { flatStart = null; flatY = null; continue }
    if (flatStart === null || Math.abs(frame.y - flatY) > .5) { flatStart = frame.t; flatY = frame.y }
    longestPlateau = Math.max(longestPlateau, frame.t - flatStart)
  }
  const releaseFrame = trace.frames.findLast(frame => frame.t <= lastPhysical) || trace.frames[0]
  const released = trace.frames.filter(frame => frame.t >= lastPhysical)
  const settled = released.find((frame, index) => index < released.length - 2 && released.slice(index).every(later => Math.abs(later.y - after.y) <= 1))
  const recent = trace.frames.filter(frame => frame.t >= trace.frames.at(-1).t - 250)
  const direction = Math.sign(after.y - before.y)
  const crossedSeams = before.seams.filter(seam => direction > 0 ? seam > before.y + 2 && seam <= after.y : seam < before.y - 2 && seam >= after.y)
  return { totalInputPx: totalInput, actualDisplacementPx: after.y - before.y, expectedY, finalY: after.y, energyErrorPx: after.y - expectedY,
    platingCapturedInputs: inputs.filter(input => input.platingAfter?.capturing).length,
    activePlateauMs: longestPlateau, peakVelocityPxSec: Math.max(0, ...speeds.map(speed => Math.abs(speed.value))),
    residualTravelPx: released.reduce((sum, frame, index) => sum + Math.abs(frame.y - (released[index - 1]?.y ?? releaseFrame.y)), 0),
    stopAfterReleaseMs: settled ? Math.max(0, settled.t - lastPhysical) : null,
    finalDriftPx: Math.max(...recent.map(frame => frame.y)) - Math.min(...recent.map(frame => frame.y)),
    firstInput, lastMove, lastPhysical, actualInputDurationMs: lastMove - firstInput, crossedSeams, speeds }
}

function graph(data) {
  const frames = data.trace.frames, inputs = data.trace.inputs.filter(input => input.delta), t0 = frames[0].t, span = frames.at(-1).t - t0
  const values = [...frames.map(frame => frame.y), data.metrics.expectedY], lo = Math.min(...values), hi = Math.max(lo + 1, ...values)
  const x = t => 60 + (t - t0) / Math.max(1, span) * 1080, y = value => 40 + (hi - value) / (hi - lo) * 260
  const expected = frames.map(frame => ({ t: frame.t, y: Math.max(0, Math.min(data.before.maxScroll, data.before.y + inputs.filter(input => input.t <= frame.t).reduce((sum, input) => sum + input.delta, 0))) }))
  const line = rows => rows.map(row => `${x(row.t)},${y(row.y)}`).join(' ')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="380"><rect width="1200" height="380" fill="#fffdf8"/><g font-family="sans-serif" fill="#292723"><text x="60" y="24" font-size="16">${data.name}: input target versus actual native scroll</text><polyline fill="none" stroke="#b09873" stroke-width="1.5" points="${line(expected)}"/><polyline fill="none" stroke="#285a69" stroke-width="2.5" points="${line(frames)}"/>${data.before.seams.filter(seam => seam >= lo && seam <= hi).map(seam => `<path d="M60 ${y(seam)}H1140" stroke="#aaa" stroke-dasharray="3 4"/>`).join('')}<text x="60" y="360" font-size="12">Input ${data.metrics.totalInputPx}px; movement ${data.metrics.actualDisplacementPx}px; plateau ${Math.round(data.metrics.activePlateauMs)}ms; residual ${Math.round(data.metrics.residualTravelPx)}px. Synthetic input.</text></g></svg>`
}

async function run(page, name, from, action, { waitMs = 1150 } = {}) {
  if (from !== null) await align(page, from)
  const before = await state(page)
  await startTrace(page); await action(); await pause(waitMs)
  const after = await state(page), trace = await finishTrace(page)
  const data = { name, before, after, trace, metrics: measure(trace, before, after) }
  scenarios.push(data); save(`${name}.json`, data); fs.writeFileSync(path.join(OUT, `${name}.svg`), graph(data))
  const { totalInputPx, actualDisplacementPx, energyErrorPx, activePlateauMs, residualTravelPx, stopAfterReleaseMs } = data.metrics
  console.log(`METRICS ${name} ${JSON.stringify({ totalInputPx, actualDisplacementPx, energyErrorPx, activePlateauMs, residualTravelPx, stopAfterReleaseMs })}`)
  return data
}

function ordinary(data, tolerance = 3) {
  check(`${data.name}: displacement conserves delivered input rather than choosing a section endpoint`, Math.abs(data.metrics.energyErrorPx) <= tolerance, data.metrics)
  check(`${data.name}: input stops without runaway scroll debt`, data.metrics.finalDriftPx <= 1 && data.metrics.stopAfterReleaseMs !== null && data.metrics.stopAfterReleaseMs <= CONTRACT.wheelStopMs, data.metrics)
}

async function saturated(page, from) {
  const data = await run(page, 'saturated-wheel-burst', from, () => wheel(page, Array.from({ length: 36 }, (_, index) => ({ at: index * 20, delta: 160 }))))
  check('Oversized wheel input leaves at most200px residual and settles within900ms', data.metrics.residualTravelPx <= 203 && data.metrics.stopAfterReleaseMs !== null && data.metrics.stopAfterReleaseMs <= 900 && data.metrics.finalDriftPx <= 1, data.metrics)
  check('Saturated following crosses seams without an input-active stop', data.metrics.crossedSeams.length >= 1 && data.metrics.activePlateauMs <= 80 && data.metrics.platingCapturedInputs === 0, data.metrics)
}

async function touchAction(page, deltas, { gap = 35, pauseAfterFirst = 0, holdMs = 500 } = {}) {
  const cdp = await page.createCDPSession(), x = page.viewport().width - 35
  let y = page.viewport().height - 100
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  for (let index = 0; index < deltas.length; index++) { y -= deltas[index]; await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] }); await pause(index === 0 && pauseAfterFirst ? pauseAfterFirst : gap) }
  if (holdMs) await pause(holdMs)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.detach()
}

try {
  if (!process.env.DEPTH_INERTIA_ORIGIN) server = await serve(PORT)
  const beforeHash = signature()
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true })
  const page = await open()
  if (!FOCUS_CONTINUOUS) {
    // The authored scene changes its section height when ready. Measure the
    // independent native seams only after that layout has settled.
    await page.$eval('[data-plating-timeline]', element => element.scrollIntoView({ block: 'center', behavior: 'instant' }))
    await page.waitForFunction(() => ['ready', 'fallback'].includes(document.querySelector('[data-plating-timeline]')?.dataset.graphics), { timeout: 15000 })
    await page.evaluate(() => document.fonts.ready)
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await align(page, 0)
  }
  const geometry = await state(page)
  check('Natural seams are measured independently of controller state', geometry.seams.length >= 4, geometry)
  const seam = geometry.seams[0], start = Math.max(20, seam - 90)
  const standards = geometry.sections.find(section => section.id === 'standards')
  if (!FOCUS_CONTINUOUS && !standards) throw new Error('Missing standards section for independent HomeDepth continuity test')
  const ownerStart = FOCUS_CONTINUOUS ? start : standards.top - geometry.headerHeight - 90
  if (FOCUS_SATURATED) await saturated(page, ownerStart)
  if (!FOCUS_SATURATED) {
  {
    // Keep the focused diagnostic at its original cross-owner location. The
    // strict HomeDepth regression crosses dishes→standards→meet instead of
    // asserting HomeDepth physics inside the separate pinned-film controller.
    const data = await run(page, 'continuous-wheel-across-seams', ownerStart, () => wheel(page, Array.from({ length: 64 }, (_, index) => ({ at: index * 30, delta: 18 }))))
    ordinary(data)
    check('Sustained wheel input crosses multiple natural seams without an80ms plateau', data.metrics.crossedSeams.length >= 2 && data.metrics.activePlateauMs <= 80 && (FOCUS_CONTINUOUS || data.metrics.platingCapturedInputs === 0), data.metrics)
    check('Wheel following retains a bounded speed', data.metrics.peakVelocityPxSec <= 1150 * 1.15, data.metrics)
    if (FOCUS_CONTINUOUS) check('The pre-application recorder observes all64 delivered trusted wheel inputs', data.trace.inputs.filter(input => input.type === 'wheel' && input.trusted).length === 64, { recorded: data.trace.inputs.filter(input => input.type === 'wheel').length, totalInputPx: data.metrics.totalInputPx })
  }
  if (!FOCUS_CONTINUOUS) {
  for (const [name, profile, tolerance] of [
    ['tiny-wheel-at-seam', [{ at: 0, delta: 2 }], .75],
    ['small-wheel-samples-across-seam', Array.from({ length: 45 }, (_, index) => ({ at: index * 40, delta: 2 })), 3],
    ['slow-continuation-after-peak', [{ at: 0, delta: 60 }, ...Array.from({ length: 40 }, (_, index) => ({ at: 100 + index * 45, delta: 2 }))], 3],
    ['zero-delta-tail-preserves-input', [{ at: 0, delta: 90 }, ...[40, 60, 80, 100].map(at => ({ at, delta: 0 }))], 3],
    ['ordinary-notch-travel', [0, 160, 320].map(at => ({ at, delta: 90 })), 3],
  ]) {
    const data = await run(page, name, seam, () => wheel(page, profile))
    if (name === 'zero-delta-tail-preserves-input') check('Zero-delta tail markers reach the browser and preserve pending positive input', data.trace.inputs.filter(input => input.type === 'wheel' && input.delta === 0).length >= 2 && close(data.metrics.actualDisplacementPx, 90) && data.metrics.finalDriftPx <= 1 && data.metrics.stopAfterReleaseMs <= 900, data.metrics)
    else ordinary(data, tolerance)
    if (profile.length > 4) check(`${name}: tiny continuing input is not put behind a gesture lock`, data.metrics.activePlateauMs <= 80, data.metrics)
  }
  await saturated(page, ownerStart)
  {
    const data = await run(page, 'wheel-reversal-retires-old-lag', start, () => wheel(page, [{ at: 0, delta: 200 }, { at: 100, delta: -2 }]))
    const reverse = data.trace.inputs.find(input => input.delta < 0)
    // Compare against native position at input dispatch, avoiding a pre-input forward movement masking a tiny turn.
    const turned = data.trace.frames.find(frame => frame.t >= reverse.t && frame.y < reverse.y - .5)
    const latency = turned ? turned.t - reverse.t : null
    const frameTimes = data.trace.frames.slice(1).map((frame, index) => frame.t - data.trace.frames[index].t).sort((a, b) => a - b)
    const twoFrames = frameTimes[Math.floor(frameTimes.length / 2)] * 2 + 8
    check('Even a2px wheel reversal turns native motion within two frames', latency !== null && latency <= twoFrames, { latencyMs: latency, limitMs: twoFrames, metrics: data.metrics })
    check('Wheel reversal retires prior lag and applies its2px exactly once', close(data.after.y, reverse.y - 2, .25), { expectedY: reverse.y - 2, finalY: data.after.y })
  }
  await page.close()

  const mobile = await open({ width: 390, height: 844 }), mobileGeometry = await state(mobile), mobileSeam = mobileGeometry.seams[0]
  const paired = []
  for (const [name, deltas] of [['same-finger-control', [80]], ['same-finger-continuation', [80, ...Array.from({ length: 20 }, () => 2)]]]) {
    const data = await run(mobile, name, mobileSeam - 60, () => touchAction(mobile, deltas, { pauseAfterFirst: 180 })); ordinary(data)
    const movements = data.trace.inputs.filter(input => input.type === 'touchmove'), contact = data.trace.inputs.find(input => input.type === 'touchstart')
    const errorsAtMoves = movements.slice(1).map((input, index) => input.y - contact.y - movements.slice(0, index + 1).reduce((sum, move) => sum + move.delta, 0))
    check(`${name}: same-finger moves stay direct1:1 after crossing the seam`, errorsAtMoves.every(error => Math.abs(error) <= 3), { errorsAtMoves })
    paired.push(data)
  }
  check('Extra2px same-finger moves add exactly40px instead of riding old momentum', close(paired[1].metrics.actualDisplacementPx - paired[0].metrics.actualDisplacementPx, 40), paired.map(data => data.metrics))
  {
    const data = await run(mobile, 'new-touch-retires-wheel-lag', mobileSeam - 100, async () => { await wheel(mobile, [{ at: 0, delta: 200 }]); await pause(25); await touchAction(mobile, [40]) })
    const contact = data.trace.inputs.find(input => input.type === 'touchstart')
    check('A fresh touch retires wheel lag and moves exactly with its finger', close(data.after.y, contact.y + 40), { contactY: contact.y, finalY: data.after.y })
  }
  {
    const data = await run(mobile, 'touch-release-bounded-coast', mobileSeam - 80, () => touchAction(mobile, [180, 180, 180], { gap: 16, holdMs: 0 }), { waitMs: 1900 })
    check('Touch release has finite coast without a whole-viewport automatic flight', data.metrics.residualTravelPx <= 550 && data.metrics.finalDriftPx <= 1 && data.metrics.stopAfterReleaseMs !== null && data.metrics.stopAfterReleaseMs <= 1700, data.metrics)
  }
  {
    const data = await run(mobile, 'touch-tiny-reverse-release', mobileSeam - 80, () => touchAction(mobile, [180, -2], { gap: 16, holdMs: 0 }), { waitMs: 1500 })
    const release = data.trace.inputs.find(input => input.type === 'touchend')
    const furthest = Math.max(...data.trace.frames.filter(frame => frame.t >= release.t).map(frame => frame.y))
    check('A tiny finger reversal retires forward velocity before release', data.after.y <= release.y + 1 && furthest <= release.y + 2, { releaseY: release.y, finalY: data.after.y, furthest })
  }
  await mobile.close()
  {
    const nested = await open({ width: 320, height: 568 })
    for (const button of await nested.$$('[data-site-navigation-toggle]')) if (await button.evaluate(element => element.getClientRects().length > 0)) { await button.click(); break }
    await nested.waitForSelector('#site-navigation-overview:not([hidden])')
    const panel = await nested.$eval('#site-navigation-overview', element => { const rect = element.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + Math.min(120, rect.height / 2), scrollable: element.scrollHeight > element.clientHeight, before: element.scrollTop } })
    const before = await state(nested)
    await nested.mouse.move(panel.x, panel.y); await nested.mouse.wheel({ deltaY: 180 }); await pause(300)
    const after = await state(nested), scrollTop = await nested.$eval('#site-navigation-overview', element => element.scrollTop)
    check('Real nested navigation consumes input without moving the page', panel.scrollable && scrollTop > panel.before + 80 && close(before.y, after.y), { panel, scrollTop, before, after })
    await nested.close()
  }
  {
    const native = await open(), before = await state(native)
    await native.evaluate(() => { document.body.tabIndex = -1; document.body.focus() })
    await native.keyboard.press('PageDown'); await pause(450)
    const after = await state(native)
    check('Native PageDown bypasses following rather than waiting for a target', after.y > before.y + 100, { before, after })
    await native.evaluate(() => scrollTo(0, 0)); await native.click('.home-experience-link'); await pause(950)
    const anchor = await native.evaluate(() => { const section = document.getElementById('ways').getBoundingClientRect(), header = document.querySelector('.sergio-header-main').getBoundingClientRect(); return { hash: location.hash, top: section.top, header: header.height, focused: document.activeElement?.id } })
    check('Gathering link completes with shared clearance and destination focus', anchor.hash === '#ways' && close(anchor.top, anchor.header + 24) && anchor.focused === 'home-gather-heading', anchor)
    await align(native, start); await wheel(native, [{ at: 0, delta: 200 }]); await pause(30)
    const requested = Math.min(before.maxScroll, before.seams.at(-1))
    await native.evaluate(y => scrollTo({ top: y, behavior: 'instant' }), requested); await pause(950)
    const jumped = await state(native)
    check('External native scrolling cancels old follower lag without pullback', close(jumped.y, requested), { requested, after: jumped, note: 'Programmatic native-scroll path; not physical scrollbar acceptance.' })
    let expectedAfterTinyJump = null
    const tinyJump = await run(native, 'one-pixel-resting-native-jump', start, async () => {
      await wheel(native, [{ at: 0, delta: 60 }]); await pause(1050)
      expectedAfterTinyJump = await native.evaluate(() => { const y = scrollY + 1; scrollTo({ top: y, behavior: 'instant' }); return y + 2 })
      await pause(80); await wheel(native, [{ at: 0, delta: 2 }])
    })
    check('A1px resting native jump becomes the origin of the next2px input', close(tinyJump.after.y, expectedAfterTinyJump, .25), { expectedY: expectedAfterTinyJump, actualY: tinyJump.after.y })
    await native.close()
  }
  // Real links must remain hittable after native center-scrolling their transformed section.
  for (const format of ['dinner', 'class', 'event']) {
    const booking = await open(), selector = `[data-service-inquiry][data-format="${format}"]`
    await booking.$eval(selector, element => element.scrollIntoView({ block: 'center', behavior: 'instant' }))
    await pause(100)
    const hit = await booking.$eval(selector, element => {
      const box = element.getBoundingClientRect(), target = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
      const header = document.querySelector('header').getBoundingClientRect()
      return { owned: !!target && (target === element || element.contains(target)), visible: box.top >= header.bottom - 2 && box.bottom <= innerHeight + 2,
        href: element.href, target: target?.tagName, text: element.textContent.trim() }
    })
    save(`service-cta-${format}-hit.json`, hit)
    console.log(`CTA_HIT ${format} ${JSON.stringify(hit)}`)
    await Promise.all([booking.waitForNavigation({ waitUntil: 'networkidle0' }), booking.click(selector)])
    const url = new URL(booking.url())
    check(`${format} service CTA remains visible, owns its center hit and opens its booking format`, hit.owned && hit.visible && url.pathname.endsWith('/book/') && url.searchParams.get('type') === format, { hit, url: booking.url() })
    await booking.close()
  }
  {
    const booking = await open({ width: 390, height: 844 }), events = []
    const selector = '[data-service-inquiry][data-format="event"]'
    const prefix = '__DEPTH_OUTGOING_INQUIRY__'
    booking.on('console', message => { if (message.text().startsWith(prefix)) events.push(JSON.parse(message.text().slice(prefix.length))) })
    await booking.evaluate(prefix => {
      for (const type of ['pointerdown', 'pointerup', 'click']) document.addEventListener(type, event => {
        const link = event.target instanceof Element ? event.target.closest('[data-service-inquiry]') : null
        console.log(prefix + JSON.stringify({ type, trusted: event.isTrusted, target: event.target.tagName, format: link?.getAttribute('data-format') || null }))
      }, true)
      const handoff = document.querySelector('[data-home-handoff]')
      let naturalTop = 0
      for (let node = handoff; node; node = node.offsetParent) naturalTop += node.offsetTop
      scrollTo({ top: naturalTop - document.querySelector('header').getBoundingClientRect().height + 6, behavior: 'instant' })
    }, prefix)
    await pause(100)
    const hit = () => booking.$eval(selector, element => {
      const box = element.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2
      const header = document.querySelector('header').getBoundingClientRect()
      const points = [['center', x, y], ['top-left', box.left + 4, box.top + 4], ['top-right', box.right - 4, box.top + 4], ['bottom-left', box.left + 4, box.bottom - 4], ['bottom-right', box.right - 4, box.bottom - 4]]
        .map(([name, x, y]) => { const target = document.elementFromPoint(x, y); return { name, owned: !!target && (target === element || element.contains(target)), target: target?.tagName } })
      return { x, y, scrollY, owned: points.every(point => point.owned), visible: box.top >= header.bottom - 2 && box.bottom <= innerHeight + 2 && box.left >= 0 && box.right <= innerWidth, points }
    })
    const beforeDown = await hit()
    await booking.mouse.move(beforeDown.x, beforeDown.y)
    await booking.mouse.down()
    await booking.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const afterDown = await hit()
    const navigation = booking.waitForNavigation({ waitUntil: 'networkidle0', timeout: 7000 }).then(() => true).catch(() => false)
    await booking.mouse.up()
    const navigated = await navigation, url = new URL(booking.url())
    const evidence = { beforeDown, afterDown, events, url: booking.url(), navigated }
    save('outgoing-mobile-event-inquiry.json', evidence)
    check('Outgoing mobile handoff keeps Small Events hittable through trusted down/up and booking navigation', beforeDown.visible && beforeDown.owned && afterDown.owned && ['pointerdown', 'pointerup', 'click'].every(type => events.some(event => event.type === type && event.trusted && event.format === 'event')) && navigated && url.pathname.endsWith('/book/') && url.searchParams.get('type') === 'event', evidence)
    await booking.close()
  }
  for (const [name, options] of [['reduced', { reduced: true }], ['disabled', { disabled: true }], ['no-js', { js: false }]]) {
    const native = await open(options), before = await state(native)
    await wheel(native, [{ at: 0, delta: 320 }]); await pause(400)
    const after = await state(native), painted = await native.$$eval('[data-depth-pose]', elements => elements.some(element => getComputedStyle(element).transform !== 'none'))
    check(`${name}: native scrolling remains available without custom plane motion`, after.y > before.y + 100 && !painted && !after.diagnostic.enabled, { before, after })
    await native.close()
  }
  }
  }
  check('No console or uncaught browser errors occur', errors.length === 0, errors)
  const afterHash = signature()
  check('Served HTML and manifest stayed immutable', JSON.stringify(beforeHash) === JSON.stringify(afterHash), { beforeHash, afterHash })
  save('results.json', { phase: PHASE, contract: CONTRACT, method: 'Trusted synthetic CDP and actual native scroll. Ordinary input conserves pixels; saturated stress explicitly permits bounded budget clipping. Physical-device feel and reader acceptance unverified.', build: BUILD, origin: ORIGIN, beforeHash, afterHash, checks, errors, scenarios: scenarios.map(({ name, metrics }) => ({ name, metrics })) })
} catch (error) { check('Continuous depth browser check completes', false, { error: error.stack || String(error) }); save('incomplete-results.json', { phase: PHASE, checks, errors }) }
finally { if (browser) await browser.close(); if (server) await new Promise(resolve => server.close(resolve)) }
const failures = checks.filter(row => !row.pass).length
console.log(`RESULT ${checks.length - failures}/${checks.length}; phase=${PHASE}; evidence=${OUT}`)
if (failures) process.exitCode = 1
