// Link-scroll and native cross-document motion. Browser evidence, not physical-device/user acceptance.
// Never builds; DIST_DIR and SHOTS_DIR select the immutable preview and its evidence directory.
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import puppeteer from 'puppeteer-core'

const BUILD = path.resolve(process.env.DIST_DIR || 'dist')
process.env.DIST_DIR = BUILD
const { serve } = await import('./serve.mjs')
const PORT = Number(process.env.NAVIGATION_MOTION_PORT) || 4388
const ORIGIN = process.env.NAVIGATION_MOTION_ORIGIN || `http://localhost:${PORT}`
const OUT = path.resolve(process.env.SHOTS_DIR || 'output/navigation-motion/check')
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const checks = [], evidence = [], errors = []
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const check = (name, pass, detail = {}) => { checks.push({ name, pass: !!pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`) }
const close = (a, b, tolerance = 3) => Math.abs(a - b) <= tolerance
const save = (name, value) => fs.writeFileSync(path.join(OUT, name), JSON.stringify(value, null, 2))
const signature = () => Object.fromEntries(['index.html', '.vite/manifest.json'].map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(BUILD, file))).digest('hex')]))
let browser, server
fs.mkdirSync(OUT, { recursive: true })

async function installProbe(page) {
  // Test the settled homepage: a first visit plays Sergio's invitation before the page is there to measure.
  await page.evaluateOnNewDocument(() => { try { sessionStorage.setItem('sergio.home-arrival.v1', 'settled') } catch {} })
  await page.evaluateOnNewDocument(() => {
    window.__navigationDocument = Math.random().toString(36).slice(2)
    const probe = window.__navigationMotion = { token: window.__navigationDocument, reveal: [], swaps: [], supported: 'CSSViewTransitionRule' in window && 'onpagereveal' in window }
    addEventListener('pageswap', event => probe.swaps.push({ t: performance.now(), transition: !!event.viewTransition }))
    addEventListener('pagereveal', event => {
      const row = { t: performance.now(), transition: !!event.viewTransition, frames: [], ready: false, finished: false }
      probe.reveal.push(row)
      if (!event.viewTransition) return
      event.viewTransition.ready.then(() => {
        row.ready = true
        const sample = t => {
          row.frames.push({ t, animations: document.getAnimations().filter(animation => animation.effect?.pseudoElement?.startsWith('::view-transition')).map(animation => {
            const timing = animation.effect.getComputedTiming()
            let style = null
            try { style = getComputedStyle(animation.effect.target, animation.effect.pseudoElement) } catch {}
            return { name: animation.animationName, pseudo: animation.effect.pseudoElement, progress: timing.progress, duration: timing.duration, time: animation.currentTime, opacity: style?.opacity, transform: style?.transform }
          }) })
          if (!row.finished) requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      }).catch(error => { row.error = error.name })
      event.viewTransition.finished.then(() => { row.finished = true; row.finishedAt = performance.now() }).catch(error => { row.error = error.name })
    })
  })
}

async function open({ route = '/', width = 1440, height = 1000, reduced = false, js = true, touch = false, historyClickFixture = false } = {}) {
  const page = await browser.newPage()
  page.on('pageerror', error => errors.push({ error: error.message, url: page.url() }))
  page.on('console', message => { if (message.type() === 'error' && !/favicon\.ico/.test(message.location().url || '')) errors.push({ error: message.text(), source: message.location().url, url: page.url() }) })
  await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: width < 620, hasTouch: width < 620 || touch })
  await installProbe(page)
  if (historyClickFixture) await page.evaluateOnNewDocument(() => {
    // Register before the entry module. Both rAF callbacks run after the browser's native fragment step.
    addEventListener('popstate', () => {
      const fixture = window.__semanticRestoreRetarget
      if (!fixture?.armed) return
      fixture.armed = false
      requestAnimationFrame(() => { fixture.clicked = performance.now(); document.getElementById('navigation-ordering-target')?.click() })
    })
  })
  if (reduced) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  if (!js) await page.setJavaScriptEnabled(false)
  await page.goto(ORIGIN + route, { waitUntil: 'networkidle0' })
  await page.evaluate(() => document.fonts.ready)
  await pause(120)
  return page
}

const point = (page, selector) => page.$eval(selector, element => { const r = element.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, visible: r.top >= 0 && r.bottom <= innerHeight } })
async function clickWithoutScrolling(page, selector) { const p = await point(page, selector); if (!p.visible) throw new Error(`Expected visible link ${selector}`); await page.mouse.click(p.x, p.y) }
async function align(page, y = 0) { await page.evaluate(y => { document.activeElement?.blur(); scrollTo({ top: y, behavior: 'instant' }) }, y); await pause(150) }

const destination = (page, id) => page.evaluate(id => {
  const element = document.getElementById(id), header = document.querySelector('header'), row = document.querySelector('.sergio-header-main') || header
  const sticky = ['sticky', 'fixed'].includes(getComputedStyle(header).position)
  let top = 0; for (let node = element; node; node = node.offsetParent) top += node.offsetTop
  const maximum = document.documentElement.scrollHeight - innerHeight
  const expectedY = id === 'main' ? 0 : Math.max(0, Math.min(maximum, top - (sticky ? row.getBoundingClientRect().height : 0) - 24))
  const heading = id === 'main' || element.matches('h1,h2,h3') ? element : element.querySelector('h1,h2,h3') || element
  const targetTop = element.getBoundingClientRect().top, obstruction = sticky ? Math.max(0, header.getBoundingClientRect().bottom) : 0
  return { id, top, expectedY, y: scrollY, maximum, targetTop, clearance: targetTop - obstruction, sticky, hash: location.hash, focused: document.activeElement === heading, focusId: document.activeElement?.id, token: window.__navigationDocument }
}, id)

async function startRun(page, id) {
  await page.evaluate(id => {
    const run = window.__linkMotionRun = { active: true, id, y: scrollY, rows: [], inputs: [], focus: [], clicks: [] }
    const onInput = event => run.inputs.push({ t: performance.now(), type: event.type, deltaY: event.deltaY ?? null, key: event.key ?? null, trusted: event.isTrusted })
    const onFocus = event => run.focus.push({ t: performance.now(), id: event.target.id, tag: event.target.tagName })
    const onClick = event => run.clicks.push({ t: performance.now(), href: event.target.closest?.('a')?.href, trusted: event.isTrusted })
    const types = ['wheel', 'touchstart', 'keydown', 'pointerdown']
    for (const type of types) addEventListener(type, onInput, { passive: true, capture: true })
    addEventListener('focusin', onFocus, true); addEventListener('click', onClick, true)
    const sample = t => {
      if (!run.active) {
        for (const type of types) removeEventListener(type, onInput, { capture: true })
        removeEventListener('focusin', onFocus, true); removeEventListener('click', onClick, true)
        return
      }
      run.rows.push({ t, y: scrollY, hash: location.hash, focusedId: document.activeElement?.id })
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  }, id)
}

async function finishRun(page, name) {
  const data = await page.evaluate(() => { window.__linkMotionRun.active = false; return window.__linkMotionRun })
  evidence.push({ name, data }); save(`${name}.json`, data)
  return data
}

async function smoothLink(page, selector, id, name) {
  const before = await destination(page, id)
  await startRun(page, id)
  await clickWithoutScrolling(page, selector)
  await pause(950)
  const after = await destination(page, id), data = await finishRun(page, name)
  const firstClick = data.clicks[0]?.t ?? data.rows[0].t
  const intermediate = new Set(data.rows.filter(row => row.t >= firstClick && Math.abs(row.y - before.y) > 2 && Math.abs(row.y - after.expectedY) > 2).map(row => row.y))
  const arrived = data.rows.find(row => row.t >= firstClick && close(row.y, after.expectedY))
  const duration = arrived ? arrived.t - firstClick : null
  check(`${name}: actual intermediate positions replace the initial endpoint jump`, intermediate.size >= 3 && duration !== null && duration >= 300 && duration <= 900, { intermediatePositions: intermediate.size, durationMs: duration, before, after })
  check(`${name}: final sticky clearance, destination focus and hash agree`, close(after.y, after.expectedY) && after.focused && decodeURIComponent(after.hash) === `#${id}` && before.token === after.token, after)
  return { before, after, data }
}

async function interrupt(page, kind) {
  await align(page)
  const historyBefore = await page.evaluate(() => history.length)
  await startRun(page, 'ways')
  await clickWithoutScrolling(page, '.home-experience-link')
  await pause(90)
  const during = await destination(page, 'ways')
  if (kind === 'wheel') { await page.mouse.move(1400, 650); await page.mouse.wheel({ deltaY: -120 }) }
  else if (kind === 'key') await page.keyboard.press('ArrowUp')
  else if (kind === 'pointer') await page.mouse.click(1400, 800)
  else {
    const cdp = await page.createCDPSession()
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 1300, y: 700 }] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 1300, y: 740 }] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await cdp.detach()
  }
  await pause(1000)
  const after = await destination(page, 'ways'), data = await finishRun(page, `interrupt-${kind}`)
  const late = data.rows.filter(row => row.t > data.rows.at(-1).t - 250)
  check(`${kind} interruption keeps user control without endpoint pullback or end focus`, during.y > 2 && !close(during.y, during.expectedY, 15) && !close(after.y, after.expectedY, 15) && !after.focused && Math.max(...late.map(row => row.y)) - Math.min(...late.map(row => row.y)) <= 2, { during, after, inputs: data.inputs })
  if (kind === 'wheel') check('Repeating the same hash adds no duplicate history entry', historyBefore === await page.evaluate(() => history.length))
}

async function fixtureLink(page, { id, href, text, prevent = false }) {
  await page.evaluate(({ id, href, text, prevent }) => {
    const link = document.createElement('a'); link.id = id; link.href = href; link.textContent = text
    link.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:9999;padding:12px;background:white;color:black'
    if (prevent) link.addEventListener('click', event => { event.preventDefault(); link.dataset.handled = 'true' })
    document.body.append(link)
  }, { id, href, text, prevent })
}

try {
  if (!process.env.NAVIGATION_MOTION_ORIGIN) server = await serve(PORT)
  const beforeHash = signature()
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true })
  {
    const page = await open()
    await smoothLink(page, '.home-experience-link', 'ways', 'home-gathering-anchor')
    for (const kind of ['wheel', 'key', 'pointer']) await interrupt(page, kind)
    await page.close()
    const touchPage = await open({ touch: true })
    await interrupt(touchPage, 'touch'); await touchPage.close()
  }
  {
    const page = await open()
    await page.$eval('a[href="#main"]', link => link.focus({ preventScroll: true }))
    await page.keyboard.press('Enter'); await pause(70)
    const after = await destination(page, 'main')
    check('Keyboard skip-to-main moves focus immediately without animated travel', after.focused && close(after.y, 0), after)
    await page.close()
  }
  for (const width of [1440, 390]) {
    const page = await open({ route: '/#ways', width, height: width === 390 ? 844 : 1000 })
    const after = await destination(page, 'ways')
    check(`Fresh Home hash at${width}px uses the shared native clearance after fonts`, close(after.y, after.expectedY) && after.hash === '#ways' && close(after.clearance, 24), after)
    await page.close()
  }
  {
    const page = await open({ route: '/about/' })
    await page.$eval('.about-chapters', element => element.scrollIntoView({ block: 'center', behavior: 'instant' })); await pause(120)
    await startRun(page, 'at-your-table')
    await clickWithoutScrolling(page, '.about-chapters a[href="#cedac"]'); await pause(50)
    const beforeSecond = await page.evaluate(() => scrollY)
    await clickWithoutScrolling(page, '.about-chapters a[href="#at-your-table"]'); await pause(950)
    const after = await destination(page, 'at-your-table'), data = await finishRun(page, 'rapid-anchor-retarget')
    const second = data.clicks[1]?.t
    const firstAfter = data.rows.find(row => row.t >= second)
    check('A rapid second anchor retargets smoothly from the current position', data.clicks.length === 2 && close(after.y, after.expectedY) && after.focused && decodeURIComponent(after.hash) === '#at-your-table' && firstAfter && Math.abs(firstAfter.y - beforeSecond) < Math.abs(after.expectedY - beforeSecond) * .5, { beforeSecond, firstAfter, after })
    await page.close()
  }
  {
    const page = await open({ route: '/about/', historyClickFixture: true })
    await clickWithoutScrolling(page, '.about-hero-actions a[href="#cedac"]'); await pause(950)
    await page.$eval('.about-chapters', element => element.scrollIntoView({ block: 'center', behavior: 'instant' })); await pause(150)
    await page.mouse.move(1400, 650); await page.mouse.wheel({ deltaY: 1 }); await pause(150)
    await clickWithoutScrolling(page, '.about-chapters a[href="#archive"]'); await pause(950)
    await fixtureLink(page, { id: 'navigation-ordering-target', href: '#at-your-table', text: 'Diagnostic semantic ordering link' })
    await page.evaluate(() => {
      window.__semanticRestoreRetarget = { armed: true, clicked: null, trusted: null }
      document.getElementById('navigation-ordering-target').addEventListener('click', event => { window.__semanticRestoreRetarget.trusted = event.isTrusted })
    })
    await startRun(page, 'at-your-table')
    await page.goBack({ waitUntil: 'domcontentloaded' }); await pause(1050)
    const after = await destination(page, 'at-your-table'), fixture = await page.evaluate(() => window.__semanticRestoreRetarget)
    const data = await finishRun(page, 'diagnostic-click-only-history-ordering')
    check('Diagnostic click-only anchor intent wins over a pending history restoration', fixture.clicked !== null && fixture.trusted === false && data.inputs.length === 0 && after.hash === '#at-your-table' && close(after.y, after.expectedY) && after.focused, { fixture, after, method: 'Ordered semantic HTMLElement.click fixture; not physical AT timing evidence.' })
    await page.close()
  }
  {
    const page = await open({ route: '/about/', width: 390, height: 844 })
    await smoothLink(page, '.about-hero-actions a[href="#cedac"]', 'cedac', 'mobile-about-story-anchor')
    await page.close()
  }
  {
    const page = await open({ route: '/about/' })
    await smoothLink(page, '.about-hero-actions a[href="#cedac"]', 'cedac', 'about-story-anchor')
    await page.$eval('.about-chapters', element => element.scrollIntoView({ block: 'center', behavior: 'instant' })); await pause(160)
    await page.mouse.move(1400, 650); await page.mouse.wheel({ deltaY: 1 }); await pause(160)
    const savedA = await page.evaluate(() => scrollY)
    await clickWithoutScrolling(page, '.about-chapters a[href="#archive"]'); await pause(850)
    await page.mouse.move(1400, 650); await page.mouse.wheel({ deltaY: 83 }); await pause(250)
    const savedB = await page.evaluate(() => scrollY)
    await page.goBack({ waitUntil: 'domcontentloaded' }); await pause(400)
    const back = await page.evaluate(() => ({ y: scrollY, hash: location.hash }))
    await page.goForward({ waitUntil: 'domcontentloaded' }); await pause(400)
    const forward = await page.evaluate(() => ({ y: scrollY, hash: location.hash, restoration: history.scrollRestoration }))
    check('Back and Forward retain native saved positions instead of forcing hash alignment', close(back.y, savedA) && back.hash === '#cedac' && close(forward.y, savedB) && forward.hash === '#archive' && forward.restoration === 'auto', { savedA, savedB, back, forward })
    await page.close()
  }
  {
    const page = await open()
    const oldToken = await page.evaluate(() => window.__navigationDocument)
    await fixtureLink(page, { id: 'deep-link-fixture', href: '/about/#archive', text: 'Diagnostic deep link' })
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('#deep-link-fixture')])
    await page.evaluate(() => document.fonts.ready); await pause(180)
    const after = await destination(page, 'archive')
    check('A fresh cross-page deep link lands at the correct offset in a new document', after.token !== oldToken && close(after.y, after.expectedY) && after.hash === '#archive', after)
    await page.mouse.move(1400, 650); await page.mouse.wheel({ deltaY: 83 }); await pause(250)
    const beforeReload = await page.evaluate(() => scrollY)
    await page.reload({ waitUntil: 'networkidle0' }); await page.evaluate(() => document.fonts.ready); await pause(180)
    check('Reload preserves the saved reading position without a delayed hash realignment', close(await page.evaluate(() => scrollY), beforeReload), { savedY: beforeReload, actualY: await page.evaluate(() => scrollY) })
    await page.close()
  }
  {
    const page = await open()
    const oldToken = await page.evaluate(() => window.__navigationDocument)
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('[data-hero-cta]')])
    await pause(120)
    const native = await page.evaluate(() => ({ token: window.__navigationDocument, probe: window.__navigationMotion, h1: document.querySelector('main h1')?.textContent.trim() }))
    check('Booking remains a real full-document navigation with readable content', new URL(page.url()).pathname.endsWith('/book/') && native.token !== oldToken && !!native.h1, native)
    const transitions = native.probe.reveal.filter(row => row.transition)
    const mid = transitions.flatMap(row => row.frames).filter(frame => frame.animations.some(animation => animation.progress > .02 && animation.progress < .98))
    const visibleStyles = new Set(mid.flatMap(frame => frame.animations.map(animation => `${animation.pseudo}:${animation.opacity}:${animation.transform}`)))
    check('Supported cross-document transitions produce changing intermediate pseudo-animation frames', !native.probe.supported || transitions.some(row => row.ready && row.finished) && mid.length >= 2 && visibleStyles.size > 2, { supported: native.probe.supported, transitions: native.probe.reveal, midFrames: mid.length })
    evidence.push({ name: 'native-booking-transition', data: native })
    await page.close()
  }
  {
    const page = await open({ height: 1100 })
    await page.$eval('[data-plating-timeline]', element => element.scrollIntoView({ block: 'start', behavior: 'instant' }))
    await page.waitForFunction(() => window.__platingTimeline?.ready || document.querySelector('[data-plating-timeline]')?.dataset.graphics === 'fallback', { timeout: 12000 })
    await pause(180)
    const timeline = await page.evaluate(() => ({ ...window.__platingTimeline }))
    if (timeline.pinned) {
      await page.evaluate(y => scrollTo({ top: y, behavior: 'instant' }), timeline.start); await pause(120)
      await startRun(page, 'how')
      await clickWithoutScrolling(page, '#plating-step-3 h3 button'); await pause(1000)
      const data = await finishRun(page, 'plating-stop-selection'), selected = await page.evaluate(() => ({ ...window.__platingTimeline, y: scrollY }))
      const positions = new Set(data.rows.filter(row => row.y > timeline.start + 3 && row.y < timeline.start + timeline.travel - 3).map(row => row.y))
      check('Pinned timeline step selection has real intermediate scroll and a correct final stop', positions.size >= 3 && selected.active === 3 && close(selected.y, timeline.start + timeline.travel), { timeline, selected, positions: positions.size })
      await clickWithoutScrolling(page, '#plating-step-0 h3 button'); await pause(90)
      await page.mouse.move(1400, 700); await page.mouse.wheel({ deltaY: 160 }); await pause(900)
      const interrupted = await page.evaluate(() => ({ ...window.__platingTimeline, y: scrollY }))
      check('Timeline button scrolling yields to wheel input without pulling back to its old stop', interrupted.y > timeline.start + 50, interrupted)
    } else {
      await page.click('#plating-step-3 h3 button'); await pause(150)
      check('Static timeline fallback still accepts step selection', await page.evaluate(() => window.__platingTimeline?.active === 3), { timeline, limit: 'Pinned scroll choreography unavailable in this rendered state.' })
    }
    await page.close()
  }
  {
    const page = await open()
    await fixtureLink(page, { id: 'custom-handler-fixture', href: '#ways', text: 'Diagnostic custom handler', prevent: true })
    const before = await page.evaluate(() => ({ y: scrollY, hash: location.hash }))
    await page.click('#custom-handler-fixture'); await pause(800)
    const after = await page.evaluate(() => ({ y: scrollY, hash: location.hash, handled: document.getElementById('custom-handler-fixture').dataset.handled }))
    check('An existing preventDefault handler retains control of its link', close(before.y, after.y) && before.hash === after.hash && after.handled === 'true', { before, after, method: 'Labelled diagnostic link fixture.' })
    await page.evaluate(() => document.getElementById('custom-handler-fixture').remove())
    await page.close()
  }
  for (const mode of ['middle', 'modifier']) {
    const page = await open(), oldUrl = page.url(), beforeY = await page.evaluate(() => scrollY)
    // Native new-tab navigation may intentionally have no opener; identify the newly created page instead.
    const existing = new Set(browser.targets())
    const popup = browser.waitForTarget(target => !existing.has(target) && target.type() === 'page' && target.url().includes('#ways'), { timeout: 5000 }).catch(() => null)
    if (mode === 'middle') await page.click('.home-experience-link', { button: 'middle' })
    else {
      const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
      await page.keyboard.down(modifier); await page.click('.home-experience-link'); await page.keyboard.up(modifier)
    }
    const target = await popup, child = target && await target.page()
    check(`${mode} click preserves native new-tab hash navigation`, !!target && page.url() === oldUrl && close(await page.evaluate(() => scrollY), beforeY), { current: page.url(), child: target?.url() })
    if (child) await child.close()
    await page.close()
  }
  for (const [name, options] of [['reduced', { reduced: true }], ['no-js', { js: false }]]) {
    const page = await open(options)
    await startRun(page, 'ways'); await clickWithoutScrolling(page, '.home-experience-link'); await pause(500)
    const after = await destination(page, 'ways'), data = await finishRun(page, `${name}-anchor`)
    const clamp = close(after.expectedY, 0) || close(after.expectedY, after.maximum)
    check(`${name}: real hash links retain visible native clearance`, after.hash === '#ways' && close(after.y, after.expectedY) && (clamp ? after.clearance >= 21 : close(after.clearance, 24)), after)
    if (name === 'reduced') {
      const click = data.clicks[0]?.t ?? data.rows[0].t, arrived = data.rows.find(row => row.t >= click && close(row.y, after.expectedY))
      check('Reduced motion avoids sustained same-page travel', !!arrived && arrived.t - click <= 100, { elapsedMs: arrived?.t - click })
    }
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('[data-hero-cta]')])
    check(`${name}: booking stays a native link`, new URL(page.url()).pathname.endsWith('/book/'))
    if (name === 'reduced') {
      const probe = await page.evaluate(() => window.__navigationMotion)
      const sustained = probe.reveal.flatMap(row => row.frames.flatMap(frame => frame.animations)).filter(animation => animation.duration > 50 && animation.progress > .02 && animation.progress < .98)
      check('Reduced motion removes sustained cross-document pseudo animation', sustained.length === 0, probe)
    }
    await page.close()
  }
  check('No console or uncaught page errors occur', errors.length === 0, errors)
  const afterHash = signature()
  check('Served HTML and manifest stayed immutable', JSON.stringify(beforeHash) === JSON.stringify(afterHash), { beforeHash, afterHash })
  save('results.json', { contract: '24px shared sticky-header clearance;360–820ms cancellable anchor travel;success-only focus;native history restoration and cross-document navigation.', checks, errors, evidence, build: BUILD, beforeHash, afterHash, humanAcceptance: 'NOT RUN' })
} catch (error) { check('Navigation-motion browser check completes', false, { error: error.stack || String(error) }); save('incomplete-results.json', { checks, errors, evidence }) }
finally { if (browser) await browser.close(); if (server) await new Promise(resolve => server.close(resolve)) }
const failures = checks.filter(row => !row.pass).length
console.log(`RESULT ${checks.length - failures}/${checks.length}; evidence=${OUT}`)
if (failures) process.exitCode = 1
