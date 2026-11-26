// Browser proof for the selected counter, arrow and footer accents. Never builds or runs Lighthouse.
import fs from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'
import { serve } from './serve.mjs'

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env.SELECTED_MOTION_PORT) || 4370
const ORIGIN = `http://localhost:${PORT}`
const SHOTS = process.env.SHOTS_DIR || '.audit'
const NUMBER = '[data-experience-counter]'
const RULE = '.footer-rule'
const HEADLINE = '.footer-invitation-copy'
const FOOTER_TIMING = { headlineMs: 850, secondLineDelayMs: 100, ruleMs: 900 }
const DIAGONAL = '[data-hero-cta]'
const RIGHT = '[data-service-inquiry][data-format="dinner"]'
const rows = [], errors = [], evidence = []
const pass = (name, ok, detail = '') => rows.push({ name, pass: !!ok, detail })
// Test clocks stay in Node so static/no-JavaScript cases never depend on page callbacks.
const delay = (_page, ms) => new Promise(resolve => setTimeout(resolve, ms))
const frames = async page => { await delay(page, 40); await page.evaluate(() => document.documentElement.getBoundingClientRect().width) }
const near = (actual, expected, tolerance = .35) => Math.abs(actual - expected) <= tolerance

function watch(page, label) {
  page.on('pageerror', error => errors.push(`${label}: ${error.message}`))
  page.on('response', response => {
    if (response.status() >= 400) evidence.push({ label, failedResponse: { url: response.url(), status: response.status() } })
  })
  page.on('console', message => {
    const url = message.location().url || ''
    if (message.type() === 'error' && !/\/favicon\.ico(?:\?|$)/.test(url)) errors.push(`${label}: ${message.text()}${url ? ` [${url}]` : ''}`)
  })
}

// Install before navigation so a quick first-view animation cannot finish before the test observes it.
async function probe(page) {
  // Test the settled homepage: a first visit plays Sergio's invitation before the page is there to measure.
  await page.evaluateOnNewDocument(() => { try { sessionStorage.setItem('sergio.home-arrival.v1', 'settled') } catch {} })
  await page.evaluateOnNewDocument(() => {
    const record = window.__selectedMotionProbe = { number: [], footer: [], events: [], layoutShifts: [] }
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) if (!entry.hadRecentInput) record.layoutShifts.push({ time: entry.startTime, value: entry.value })
    }).observe({ type: 'layout-shift', buffered: true })
    const rect = element => {
      const box = element.getBoundingClientRect()
      return { width: box.width, height: box.height }
    }
    const visibleStyle = element => {
      for (let node = element; node; node = node.parentElement) {
        const style = getComputedStyle(node)
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) < .99) return false
      }
      return true
    }
    for (const type of ['animationstart', 'animationend', 'animationcancel']) document.addEventListener(type, event => {
      const group = event.target.closest?.('[data-experience-counter]') ? 'number' : event.target.closest?.('footer') && event.animationName.startsWith('footer-') ? 'footer' : null
      if (group) record.events.push({ group, type, name: event.animationName, text: event.target.textContent.trim().slice(0, 80), time: performance.now(), elapsed: event.elapsedTime, pseudo: event.pseudoElement })
    }, true)
    const sample = time => {
      const number = document.querySelector('[data-experience-counter]')
      if (number && record.number.length < 2000) {
        const style = getComputedStyle(number), reel = number.querySelector('[data-counter-reel]')
        record.number.push({ time, state: number.dataset.counterState, ...rect(number), intrinsicWidth: number.offsetWidth, intrinsicHeight: number.offsetHeight,
          scale: new DOMMatrixReadOnly(style.transform).a, fontSize: Number.parseFloat(style.fontSize), fontReady: document.fonts.status === 'loaded', transform: reel ? getComputedStyle(reel).transform : null })
      }
      const rule = document.querySelector('.footer-rule'), footer = document.querySelector('footer')
      if (rule && footer && record.footer.length < 2000) {
        const matrix = new DOMMatrixReadOnly(getComputedStyle(rule, '::before').transform)
        record.footer.push({ time, entered: rule.dataset.ruleEntered, state: rule.dataset.ruleState, headlineState: footer.dataset.footerState,
          scale: matrix.a, height: footer.offsetHeight, headingLayoutHeight: footer.querySelector('#footer-invitation').offsetHeight,
          headlines: [...footer.querySelectorAll('#footer-invitation>span')].map(line => { const style = getComputedStyle(line)
            return { y: new DOMMatrixReadOnly(style.transform).f, width: line.offsetWidth, height: line.offsetHeight, duration: style.animationDuration, delay: style.animationDelay }
          }),
          copyVisible: [...footer.querySelectorAll('.footer-invitation h2>span,.footer-invitation p,.footer-column')].every(visibleStyle) })
      }
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
}

async function open(page, width, options = {}) {
  await page.setViewport({ width, height: options.height || (width === 1440 ? 900 : width === 320 ? 740 : 844), deviceScaleFactor: 1, isMobile: !!options.touch, hasTouch: !!options.touch })
  if (options.reduced) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  if (options.noScript) await page.setJavaScriptEnabled(false)
  if (options.noObserver) await page.evaluateOnNewDocument(() => { delete window.IntersectionObserver })
  await probe(page)
  await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle0' })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForSelector(NUMBER)
}

async function enter(page, selector) {
  await page.$eval(selector, element => element.scrollIntoView({ block: 'center', behavior: 'instant' }))
  await frames(page)
}

async function accessibleForty(page, label) {
  const root = await page.$(NUMBER)
  const tree = await page.accessibility.snapshot({ root, interestingOnly: false })
  const nodes = []
  const walk = node => { if (!node) return; nodes.push(node); for (const child of node.children || []) walk(child) }
  walk(tree)
  const spoken = nodes.filter(node => node.role === 'StaticText').map(node => node.name)
  const dom = await page.$eval(NUMBER, number => ({
    value: number.querySelector('.experience-counter-value')?.textContent.trim(),
    decorative: number.querySelector('.experience-counter-window')?.getAttribute('aria-hidden') === 'true',
    live: !!number.querySelector('[aria-live]:not([aria-live="off"])') || !!number.closest('[aria-live]:not([aria-live="off"])'),
    width: number.getBoundingClientRect().width, height: number.getBoundingClientRect().height,
    visible: getComputedStyle(number).display !== 'none' && getComputedStyle(number.parentElement).display !== 'none',
  }))
  pass(`${label}: one accessible 40, decorative reel and no live announcements`, dom.value === '40' && dom.decorative && !dom.live && spoken.length === 1 && spoken[0] === '40', JSON.stringify(spoken))
  pass(`${label}: the 40 remains visibly reserved`, dom.visible && dom.width > 0 && dom.height > 0, `${dom.width.toFixed(1)}×${dom.height.toFixed(1)}`)
  return dom
}

async function assertNoOverflow(page, label) {
  pass(`${label}: no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
}

const startsByName = events => events.filter(event => event.type === 'animationstart').reduce((counts, event) => ({ ...counts, [event.name]: (counts[event.name] || 0) + 1 }), {})
const sameStarts = (before, after) => JSON.stringify(startsByName(before)) === JSON.stringify(startsByName(after))

async function counterProof(page, label) {
  await enter(page, NUMBER)
  await page.waitForFunction(() => document.querySelector('[data-experience-counter]').dataset.counterState === 'done', { timeout: 4000 })
  await frames(page)
  await accessibleForty(page, label)
  const record = await page.evaluate(() => window.__selectedMotionProbe)
  const samples = record.number.filter(sample => sample.fontReady && sample.width > 0)
  const finalSize = samples.at(-1)?.fontSize
  const finalFont = samples.filter(sample => sample.fontSize === finalSize)
  const widths = finalFont.map(sample => sample.intrinsicWidth), heights = finalFont.map(sample => sample.intrinsicHeight)
  const starts = record.events.filter(event => event.name === 'experience-count-settle' && event.type === 'animationstart')
  const ends = record.events.filter(event => event.name === 'experience-count-settle' && event.type === 'animationend')
  const transforms = new Set(finalFont.filter(sample => sample.state === 'playing').map(sample => sample.transform))
  const reel = await page.$$eval('[data-counter-reel]>span', spans => spans.map(span => span.textContent.trim()))
  pass(`${label}: full 00→40 reel rolls through actual frames over 1600ms`, starts.length === 1 && ends.length === 1 && near(ends[0].elapsed, 1.6, .04) && transforms.size > 20 && reel.length === 41 && reel.every((value, index) => value === String(index).padStart(2, '0')), `${starts.length} start(s), ${ends[0]?.elapsed ?? '?'}s, ${transforms.size} moving transforms`)
  const crest = Math.max(...finalFont.map(sample => sample.scale))
  pass(`${label}: counter visibly crests at scale1.22 and settles at1`, crest >= 1.19 && crest <= 1.24 && near(finalFont.at(-1)?.scale, 1, .001), `peak ${crest.toFixed(3)}, final ${finalFont.at(-1)?.scale}`)
  pass(`${label}: intrinsic numeral dimensions stay fixed throughout the visual emphasis`, finalFont.length > 3 && Math.max(...widths) - Math.min(...widths) === 0 && Math.max(...heights) - Math.min(...heights) === 0 && finalFont.some(sample => sample.state === 'static') && finalFont.some(sample => sample.state === 'done'))
  return starts.length
}

async function footerProof(page, label) {
  const before = await page.$eval('footer', footer => footer.offsetHeight)
  await enter(page, HEADLINE)
  await page.waitForFunction(() => document.querySelector('footer').dataset.footerState === 'done', { timeout: 3000 })
  await enter(page, RULE)
  await page.waitForFunction(() => document.querySelector('.footer-rule').dataset.ruleState === 'done', { timeout: 3000 })
  const record = await page.evaluate(() => window.__selectedMotionProbe)
  const starts = record.events.filter(event => event.name === 'footer-rule-draw' && event.type === 'animationstart')
  const ends = record.events.filter(event => event.name === 'footer-rule-draw' && event.type === 'animationend')
  const during = record.footer.filter(sample => sample.time >= starts[0]?.time && sample.time <= ends[0]?.time + 30)
  pass(`${label}: footer rule draws once through intermediate scales over900ms`, starts.length === 1 && ends.length === 1 && near(ends[0].elapsed, FOOTER_TIMING.ruleMs / 1000, .04) && during.some(sample => sample.scale > .02 && sample.scale < .98), `${starts.length} start(s), measured ${ends[0]?.elapsed ?? '?'}s`)
  const headlineStarts = record.events.filter(event => event.name === 'footer-headline-rise' && event.type === 'animationstart')
  const headlineEnds = record.events.filter(event => event.name === 'footer-headline-rise' && event.type === 'animationend')
  const stagger = headlineStarts.length === 2 ? headlineStarts[1].time - headlineStarts[0].time : 0
  const lineTravel = [0, 1].map(index => record.footer.map(sample => sample.headlines[index]?.y).filter(Number.isFinite))
  pass(`${label}: both footer headline lines rise for850ms and stagger by100ms`, headlineStarts.length === 2 && headlineEnds.length === 2 && headlineEnds.every(event => near(event.elapsed, FOOTER_TIMING.headlineMs / 1000, .04)) && stagger >= 65 && stagger <= 140 && lineTravel.every(values => Math.max(...values) >= 17 && Math.min(...values) < -1 && near(values.at(-1), 0, .1)), `measured ${headlineEnds.map(event => event.elapsed).join('/')}s; ${stagger.toFixed(1)}ms stagger; peak travel ${lineTravel.map(values => Math.max(...values).toFixed(1)).join('/')}px`)
  const footerDuring = record.footer.filter(sample => sample.time >= headlineStarts[0]?.time)
  pass(`${label}: footer copy stays visible and layout height stays fixed throughout`, footerDuring.length > 2 && footerDuring.every(sample => sample.copyVisible && near(sample.height, before, .5)))
  pass(`${label}: headline intrinsic line and heading dimensions stay fixed`, footerDuring.length > 2 && footerDuring.every(sample => sample.headingLayoutHeight === footerDuring[0].headingLayoutHeight && sample.headlines.length === 2 && sample.headlines.every((line, index) => line.width === footerDuring[0].headlines[index].width && line.height === footerDuring[0].headlines[index].height)))
  await page.screenshot({ path: path.join(SHOTS, `selected-motion-${label}-footer.png`) })
  const baseline = record.events
  await enter(page, NUMBER)
  await delay(page, 1750)
  await enter(page, HEADLINE)
  await delay(page, 1000)
  await enter(page, RULE)
  await delay(page, 1000)
  const after = await page.evaluate(() => window.__selectedMotionProbe.events)
  pass(`${label}: scroll reentry replays none of the counter or footer animations`, sameStarts(baseline, after))
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  await frames(page)
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }])
  await delay(page, 1750)
  const toggled = await page.evaluate(() => ({
    events: window.__selectedMotionProbe.events,
    counter: document.querySelector('[data-experience-counter]').dataset.counterState,
    rule: document.querySelector('.footer-rule').dataset.ruleState,
    headline: document.querySelector('footer').dataset.footerState,
  }))
  pass(`${label}: reduced-motion toggling after completion replays no accent`, toggled.counter === 'done' && toggled.rule === 'done' && toggled.headline === 'done' && sameStarts(baseline, toggled.events))
}

async function midAnimationPreferenceProof(browser, group) {
  // Each preference test needs its own page: opting out before an unvisited decoration is intentionally final.
  const context = await browser.createBrowserContext(), page = await context.newPage()
  const label = `${group} mid-animation preference`
  const config = group === 'number' ? { selector: NUMBER, enter: NUMBER, state: 'counterState', animation: 'experience-count-settle' }
    : group === 'headline' ? { selector: 'footer', enter: '.footer-invitation-copy', state: 'footerState', animation: 'footer-headline-rise' }
      : { selector: RULE, enter: RULE, state: 'ruleState', animation: 'footer-rule-draw' }
  config.expectedStarts = group === 'headline' ? 2 : 1
  watch(page, label)
  await open(page, 1440, { height: group === 'footer' ? 900 : 450 })
  await enter(page, config.enter)
  await page.waitForFunction(config => document.querySelector(config.selector).dataset[config.state] === 'playing', { timeout: 3000 }, config)
  // The second headline line starts after its 100ms stagger; that initial start must not be mistaken for replay.
  // Wait for both original lines before opting out, then require the count to stay fixed when opting back in.
  await page.waitForFunction(config => window.__selectedMotionProbe.events.filter(event => event.name === config.animation && event.type === 'animationstart').length === config.expectedStarts, { timeout: 3000 }, config)
  if (group === 'number') await accessibleForty(page, `${label} while playing`)
  await delay(page, 80)
  const starts = await page.evaluate(name => window.__selectedMotionProbe.events.filter(event => event.name === name && event.type === 'animationstart').length, config.animation)
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  await page.waitForFunction(config => document.querySelector(config.selector).dataset[config.state] === 'done', {}, config)
  const settled = await page.evaluate(({ group, config }) => {
    const target = document.querySelector(config.selector)
    return group === 'number'
      ? getComputedStyle(target.querySelector('.experience-counter-value')).opacity === '1' && new DOMMatrixReadOnly(getComputedStyle(target).transform).a === 1
      : group === 'headline'
        ? [...target.querySelectorAll('#footer-invitation>span')].every(line => new DOMMatrixReadOnly(getComputedStyle(line).transform).f === 0) && !target.hasAttribute('data-footer-entered')
        : new DOMMatrixReadOnly(getComputedStyle(target, '::before').transform).a === 1 && !target.hasAttribute('data-rule-entered')
  }, { group, config })
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }])
  await delay(page, 1750)
  const after = await page.evaluate(config => ({
    starts: window.__selectedMotionProbe.events.filter(event => event.name === config.animation && event.type === 'animationstart').length,
    state: document.querySelector(config.selector).dataset[config.state],
  }), config)
  pass(`${label}: opting out immediately settles and opting in again never replays`, starts === config.expectedStarts && settled && after.starts === starts && after.state === 'done', `${starts}→${after.starts} start(s), final ${after.state}`)
  evidence.push({ label, probe: await page.evaluate(() => window.__selectedMotionProbe) })
  await context.close()
}

async function arrowGeometry(page, control, icon) {
  return page.$eval(control, (control, icon) => {
    const arrow = control.querySelector(icon), box = arrow.getBoundingClientRect(), parent = control.getBoundingClientRect()
    const matrix = new DOMMatrixReadOnly(getComputedStyle(arrow).transform)
    return { x: box.left - parent.left, y: box.top - parent.top, tx: matrix.e, ty: matrix.f, scale: matrix.a,
      width: control.offsetWidth, height: control.offsetHeight, duration: getComputedStyle(arrow).transitionDuration }
  }, icon)
}

async function arrowProof(page, control, icon, expectedX, expectedY, label, reduced = false) {
  await enter(page, control)
  await page.mouse.move(0, 0)
  await page.$eval(control, element => element.blur())
  await delay(page, 400)
  const before = await arrowGeometry(page, control, icon)
  await page.hover(control)
  const moving = await page.$eval(control, (control, icon) => new Promise(resolve => {
    const values = [], start = performance.now(), arrow = control.querySelector(icon)
    const sample = time => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(arrow).transform)
      values.push({ time: time - start, tx: matrix.e, ty: matrix.f, scale: matrix.a })
      if (time - start < 400) requestAnimationFrame(sample)
      else resolve(values)
    }
    requestAnimationFrame(sample)
  }), icon)
  const hover = await arrowGeometry(page, control, icon)
  await page.mouse.move(0, 0)
  await delay(page, 400)
  await page.keyboard.press('Tab')
  await page.focus(control)
  await delay(page, 400)
  const focus = await arrowGeometry(page, control, icon)
  const dx = reduced ? 0 : expectedX, dy = reduced ? 0 : expectedY
  const fixed = [hover, focus].every(state => near(state.width, before.width, .1) && near(state.height, before.height, .1))
  pass(`${label}: ${reduced ? 'reduced motion keeps' : 'hover and keyboard focus visibly translate and enlarge'} the arrow ${reduced ? 'static' : 'without moving its control'}`, [hover, focus].every(state => near(state.tx - before.tx, dx) && near(state.ty - before.ty, dy) && near(state.scale, reduced ? 1 : 1.2, .02)) && fixed, `hover matrix ${hover.tx.toFixed(2)},${hover.ty.toFixed(2)} scale${hover.scale.toFixed(2)}; focus ${focus.tx.toFixed(2)},${focus.ty.toFixed(2)} scale${focus.scale.toFixed(2)}`)
  if (!reduced) pass(`${label}: arrow traverses actual intermediate frames over a300ms transition`, before.duration.split(',').some(duration => near(Number.parseFloat(duration), .3, .015)) && moving.some(state => state.scale > 1.02 && state.scale < 1.18), before.duration)
  evidence.push({ label, arrowFrames: moving })
  await page.$eval(control, element => element.blur())
}

async function touchProof(page) {
  await enter(page, DIAGONAL)
  await page.$eval(DIAGONAL, element => { element.blur(); element.addEventListener('click', event => event.preventDefault(), { once: true }) })
  const before = await arrowGeometry(page, DIAGONAL, '.icon-arrow-up-right')
  const point = await page.$eval(DIAGONAL, element => { const box = element.getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + box.height / 2 } })
  await page.touchscreen.touchStart(point.x, point.y)
  await delay(page, 200)
  const pressed = await arrowGeometry(page, DIAGONAL, '.icon-arrow-up-right')
  await page.screenshot({ path: path.join(SHOTS, 'selected-motion-touch-pressed.png') })
  await page.touchscreen.touchEnd()
  await delay(page, 450)
  const released = await arrowGeometry(page, DIAGONAL, '.icon-arrow-up-right')
  // Native touch browsers may defer :active until the synthesized click. The hold must never move the button.
  const dx = pressed.tx - before.tx, dy = pressed.ty - before.ty
  pass('native touch press keeps inquiry bounds fixed within the2px arrow state', dx >= -.1 && dx <= 2.1 && dy >= -2.1 && dy <= .1 && pressed.scale >= .99 && pressed.scale <= 1.09 && near(pressed.width, before.width, .1) && near(pressed.height, before.height, .1), JSON.stringify({ before, pressed, released }))
  pass('touch release leaves no arrow hover trap or accidental navigation', near(released.tx, 0, .05) && near(released.ty, 0, .05) && near(released.scale, 1, .01) && new URL(page.url()).pathname === '/')
}

async function staticProof(page, label) {
  await enter(page, NUMBER)
  await delay(page, 850)
  await accessibleForty(page, label)
  await enter(page, HEADLINE)
  await delay(page, 500)
  await enter(page, RULE)
  await delay(page, 500)
  const state = await page.evaluate(() => {
    const number = document.querySelector('[data-experience-counter]'), value = number.querySelector('.experience-counter-value')
    const rule = document.querySelector('.footer-rule'), style = getComputedStyle(rule, '::before')
    const matrix = new DOMMatrixReadOnly(style.transform)
    const footer = document.querySelector('footer'), lines = [...footer.querySelectorAll('#footer-invitation>span')]
    return { state: number.dataset.counterState, counterScale: new DOMMatrixReadOnly(getComputedStyle(number).transform).a,
      visibleValue: getComputedStyle(value).opacity === '1', ruleScale: matrix.a, headlineState: footer.dataset.footerState, ruleState: rule.dataset.ruleState,
      headlineStatic: lines.length === 2 && lines.every(line => new DOMMatrixReadOnly(getComputedStyle(line).transform).f === 0 && getComputedStyle(line).opacity === '1' && line.offsetWidth > 0 && line.offsetHeight > 0),
      numberAnimations: number.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length,
      footerAnimations: footer.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length,
      events: window.__selectedMotionProbe?.events || [] }
  })
  pass(`${label}: 40, footer headline and rule stay complete and static`, state.state === 'static' && state.visibleValue && state.headlineState === 'static' && state.ruleState === 'static' && near(state.counterScale, 1, .01) && near(state.ruleScale, 1, .01) && state.headlineStatic && state.numberAnimations === 0 && state.footerAnimations === 0 && state.events.length === 0, JSON.stringify(state))
}

async function layoutShiftProof(page, label) {
  const shifts = await page.evaluate(() => window.__selectedMotionProbe.layoutShifts)
  const score = shifts.reduce((sum, entry) => sum + entry.value, 0)
  pass(`${label}: motion produces no measurable layout shift`, score <= .001, `observed CLS ${score.toFixed(4)}`)
}

fs.mkdirSync(SHOTS, { recursive: true })
let server, browser
try {
  server = await serve(PORT)
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true })
  for (const width of [1440, 390, 320]) {
    const context = await browser.createBrowserContext(), page = await context.newPage()
    const label = `${width}px`
    watch(page, label)
    await open(page, width, { touch: width !== 1440 })
    await counterProof(page, label)
    await assertNoOverflow(page, label)
    await page.screenshot({ path: path.join(SHOTS, `selected-motion-${label}-counter.png`) })
    if (width === 1440) {
      await arrowProof(page, DIAGONAL, '.icon-arrow-up-right', 7, -7, 'inquiry')
      await arrowProof(page, RIGHT, '.icon-arrow-right', 10, 0, 'experience link')
    } else if (width === 390) await touchProof(page)
    await footerProof(page, label)
    await assertNoOverflow(page, `${label} after interaction`)
    await layoutShiftProof(page, label)
    evidence.push({ label, probe: await page.evaluate(() => window.__selectedMotionProbe) })
    await context.close()
  }
  for (const options of [{ reduced: true }, { noObserver: true }]) {
    const context = await browser.createBrowserContext(), page = await context.newPage()
    const label = options.reduced ? 'reduced-motion' : 'no-observer'
    watch(page, label)
    await open(page, 1440, options)
    await staticProof(page, label)
    if (options.reduced) {
      await arrowProof(page, DIAGONAL, '.icon-arrow-up-right', 0, 0, label, true)
      await arrowProof(page, RIGHT, '.icon-arrow-right', 0, 0, `${label} experience link`, true)
    }
    await assertNoOverflow(page, label)
    evidence.push({ label, probe: await page.evaluate(() => window.__selectedMotionProbe) })
    await context.close()
  }
  await midAnimationPreferenceProof(browser, 'number')
  await midAnimationPreferenceProof(browser, 'footer')
  await midAnimationPreferenceProof(browser, 'headline')
  for (const width of [1440, 320]) {
    const context = await browser.createBrowserContext(), page = await context.newPage()
    const label = `no-JS ${width}px`
    watch(page, label)
    await open(page, width, { noScript: true })
    await accessibleForty(page, label)
    const state = await page.$eval(NUMBER, number => ({ state: number.dataset.counterState, visibleValue: getComputedStyle(number.querySelector('.experience-counter-value')).opacity === '1' }))
    pass(`${label}: SSR shows the final 40 without waiting for JavaScript`, state.state === 'static' && state.visibleValue)
    const footerStatic = await page.$eval('footer', footer => {
      const lines = [...footer.querySelectorAll('#footer-invitation>span')], rule = footer.querySelector('.footer-rule')
      return footer.dataset.footerState === 'static' && rule.dataset.ruleState === 'static' && lines.length === 2 && lines.every(line => new DOMMatrixReadOnly(getComputedStyle(line).transform).f === 0 && getComputedStyle(line).opacity === '1' && line.offsetWidth > 0 && line.offsetHeight > 0) && new DOMMatrixReadOnly(getComputedStyle(rule, '::before').transform).a === 1
    })
    pass(`${label}: SSR preserves the complete footer headline and divider`, footerStatic)
    await assertNoOverflow(page, label)
    await page.screenshot({ path: path.join(SHOTS, `selected-motion-no-js-${width}.png`) })
    await context.close()
  }
} catch (error) {
  pass('selected-motion browser check completes', false, error.stack || String(error))
} finally {
  if (browser) await browser.close()
  if (server) await new Promise(resolve => server.close(resolve))
  pass('selected motion causes no console, hydration or page errors', errors.length === 0, errors.join('; '))
  fs.writeFileSync(path.join(SHOTS, 'selected-motion-results.json'), JSON.stringify({ rows, errors, evidence, footerTiming: FOOTER_TIMING, humanEvaluation: 'NOT RUN' }, null, 2))
}
console.log(rows.map(row => `${row.pass ? '✓' : '✗'} ${row.name}${row.detail ? ` (${row.detail})` : ''}`).join('\n'))
const failures = rows.filter(row => !row.pass).length
if (failures) { console.error(`\n✗ selected-motion check: ${failures} failure(s)`); process.exitCode = 1 }
else console.log(`\n✓ selected-motion check passed (${rows.length} assertions)`)
