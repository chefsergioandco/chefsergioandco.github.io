// Focused integration checks for the booking timeline. Builds and shared GPU
// ownership belong to the caller; this script only serves the existing dist/.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import puppeteer from 'puppeteer-core'
import { serve } from './serve.mjs'

const require = createRequire(import.meta.url)
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env.PLATING_PORT) || 5190
const ORIGIN = `http://localhost:${PORT}`
const DIST = path.resolve(process.env.DIST_DIR || 'dist')
const OUT = path.resolve(process.env.SHOTS_DIR || 'output/plating-timeline')
const ROOT = '[data-plating-timeline]'
const FRAME = `${ROOT} .plating-frame`
const CANVAS = `${ROOT} .plating-scene canvas[data-progress]`
const FALLBACK_WIDTHS = [390, 600]
const rows = []
const errors = []
const unavailable = []
const screenshots = []
const wheelBursts = []
const pages = new Set()
let browser, server

fs.mkdirSync(OUT, { recursive: true })

function pass(name, ok, detail = '') {
  rows.push({ name, ok: !!ok, detail })
}

function notRun(name, detail = 'The served snapshot has no packaged sequence; the build guard prevents this runtime path.') {
  unavailable.push({ name, status: 'not-run', detail })
}

function graphFiles(manifest, key, files = new Set(), seen = new Set()) {
  if (seen.has(key)) return files
  seen.add(key)
  const chunk = manifest[key]
  if (!chunk) return files
  if (chunk.file?.endsWith('.js')) files.add(chunk.file)
  for (const dependency of chunk.imports ?? []) graphFiles(manifest, dependency, files, seen)
  return files
}

const manifest = JSON.parse(fs.readFileSync(path.join(DIST, '.vite/manifest.json'), 'utf8'))
const sceneKey = Object.keys(manifest).find(key => key.endsWith('/plating/frames.ts'))
const hydration = graphFiles(manifest, 'src/pages/Home.tsx')
const graphicsFiles = [...graphFiles(manifest, sceneKey)].filter(file => !hydration.has(file))
const compiledApp = [...new Set([...hydration, ...graphicsFiles])].map(file => ({
  file, sha256: createHash('sha256').update(fs.readFileSync(path.join(DIST, file))).digest('hex'),
}))
const isGraphicsRequest = url => graphicsFiles.some(file => new URL(url).pathname.endsWith(`/${file}`))
const isSequenceRequest = url => new URL(url).pathname.endsWith('/art/plating/sequence.json')
const isFrameRequest = url => /\/art\/plating\/[^/]+\/\d+\.webp$/.test(new URL(url).pathname)
const sequencePath = path.join(DIST, 'art/plating/sequence.json')
const sequence = fs.existsSync(sequencePath) ? JSON.parse(fs.readFileSync(sequencePath, 'utf8')) : null
pass('the served snapshot contains its packaged frame manifest', !!sequence, sequencePath)
if (sequence) {
  pass('the sequence declares ordered frames and four valid stations', sequence.version === 1
    && Array.isArray(sequence.frames) && sequence.frames.length >= 4
    && sequence.frames.every((frame, index, all) => Number.isInteger(frame) && frame >= 0 && (!index || frame > all[index - 1]))
    && Array.isArray(sequence.stations) && sequence.stations.length === 4
    && sequence.stations.every((index, station, all) => Number.isInteger(index) && index >= 0 && index < sequence.frames.length && (!station || index > all[station - 1])),
  JSON.stringify({ count: sequence.frames.length, frames: [sequence.frames[0], sequence.frames.at(-1)], stations: sequence.stations, desktop: sequence.desktop, mobile: sequence.mobile }))
  pass('graphics are emitted as an independent lazy chunk', !!sceneKey && graphicsFiles.length > 0, graphicsFiles.join(', '))
}
else notRun('independent lazy graphics chunk', 'The missing-sequence build guard can omit the graphics chunk; real sequence readiness is not available to verify.')

async function openPage(label, viewport, options = {}) {
  const page = await browser.newPage()
  pages.add(page)
  page.setDefaultTimeout(25000)
  await page.setViewport({ ...viewport, deviceScaleFactor: 1 })
  if (options.reduced) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  if (options.noJs) await page.setJavaScriptEnabled(false)
  if (options.noCanvas) {
    await page.evaluateOnNewDocument(() => {
      const original = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
        if (kind === '2d') return null
        return original.call(this, kind, ...args)
      }
    })
  }
  const requests = []
  const blocked = []
  await page.setRequestInterception(true)
  page.on('request', request => {
    const local = ['localhost', '127.0.0.1'].includes(new URL(request.url()).hostname)
    if (request.method() === 'POST' && !local) return void request.abort('blockedbyclient').catch(() => {})
    const fault = options.failManifest && isSequenceRequest(request.url()) || options.failFrames && isFrameRequest(request.url())
    if (fault) {
      blocked.push(request.url())
      return void request.respond({ status: 503, contentType: isSequenceRequest(request.url()) ? 'application/json' : 'image/webp', body: '' }).catch(() => {})
    }
    void request.continue().catch(() => {})
  })
  page.on('request', request => requests.push(request.url()))
  page.on('pageerror', error => errors.push({ page: label, message: error.message }))
  await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle0' })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForSelector(ROOT)
  return { page, requests, blocked }
}

async function closePage(page) {
  pages.delete(page)
  await page.close()
}

async function nearTimeline(page) {
  await page.evaluate(selector => {
    const element = document.querySelector(selector)
    const header = document.querySelector('.home-header')
    window.scrollTo({ top: element.getBoundingClientRect().top + scrollY - (header?.getBoundingClientRect().height || 0) - 12, behavior: 'instant' })
  }, ROOT)
}

async function readyTimeline(page, requirePinned = false) {
  if (!sequence) throw new Error(`No packaged frame manifest exists in the served snapshot: ${sequencePath}`)
  await nearTimeline(page)
  await page.waitForFunction(({ root, pinned }) => {
    const element = document.querySelector(root)
    const state = window.__platingTimeline
    return element?.dataset.graphics === 'fallback' || element?.dataset.graphics === 'ready' && state?.ready && (!pinned || (state.pinned && element.dataset.pinned === 'true'))
  }, {}, { root: ROOT, pinned: requirePinned })
  const graphics = await page.$eval(ROOT, element => element.dataset.graphics)
  if (graphics === 'fallback') throw new Error('Expected the decoded frame sequence to become ready, but it fell back. Inspect the packaged manifest and frame requests in the served build snapshot.')
}

async function atStation(page, station) {
  await page.evaluate(index => {
    const state = window.__platingTimeline
    window.scrollTo({ top: state.start + state.travel * index / 3, behavior: 'instant' })
  }, station)
  await settledAt(page, station)
}

async function settledAt(page, station) {
  await page.waitForFunction(({ index, canvasSelector }) => {
    const state = window.__platingTimeline
    const canvas = document.querySelector(canvasSelector)
    return state?.active === index && Math.abs(state.progress - index / 3) < .002 && canvas && Math.abs(Number(canvas.dataset.progress) - index / 3) < .003
  }, {}, { index: station, canvasSelector: CANVAS })
}

const quiet = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

async function wheelStation(page, station, delta) {
  const began = Date.now()
  let remaining = await page.evaluate(index => {
    const state = window.__platingTimeline
    return state.start + state.travel * index / 3 - scrollY
  }, station)
  while (Math.abs(remaining) > .1) {
    const amount = Math.sign(remaining) * Math.min(48, Math.abs(remaining))
    await page.mouse.wheel({ deltaY: amount })
    remaining -= amount
    await quiet(20)
  }
  await settledAt(page, station)
  // HomeDepth's wheel follower coasts a little after input stops, so the page settles inside the station's soft
  // pause (platingProgress holds the spoon for 1/30 of the travel each side), not on its exact pixel.
  await page.waitForFunction(index => Math.abs(window.__platingTimeline.progress - index / 3) < .003, {}, station)
  await quiet(Math.max(0, 650 - (Date.now() - began)))
  return page.evaluate(() => ({ ...window.__platingTimeline, y: scrollY }))
}

async function enterWithWheel(page, end = false) {
  await page.evaluate(last => {
    const state = window.__platingTimeline
    window.scrollTo({ top: state.start + (last ? state.travel + 80 : -80), behavior: 'instant' })
  }, end)
  const viewport = page.viewport()
  await page.mouse.move(viewport.width / 2, viewport.height / 2)
  const station = end ? 3 : 0
  await page.mouse.wheel({ deltaY: end ? -120 : 120 })
  await settledAt(page, station)
  // HomeDepth owns wheel travel through the pinned scene (the scene follows native scroll and only owns explicit
  // station selections), so entering means the page is inside the scene near the edge it came from, not captured.
  await page.waitForFunction(last => {
    const state = window.__platingTimeline
    return scrollY >= state.start - 2 && scrollY <= state.start + state.travel + 2 && Math.abs(scrollY - state.start - (last ? state.travel : 0)) < 160
  }, {}, end)
  await quiet(250)
}

async function releaseWithWheel(page, end) {
  const edge = await page.evaluate(last => window.__platingTimeline.start + (last ? window.__platingTimeline.travel : 0), end)
  await page.mouse.wheel({ deltaY: end ? 200 : -200 })
  await page.waitForFunction(({ edge, last }) => !window.__platingTimeline.capturing && (last ? scrollY > edge + 3 : scrollY < edge - 3), {}, { edge, last: end })
  const state = await page.evaluate(() => ({ y: scrollY, capturing: window.__platingTimeline.capturing }))
  await quiet(700)
  return { edge, ...state }
}

async function geometryState(page) {
  return page.evaluate(selector => {
    const root = document.querySelector(selector)
    const frame = root.querySelector('.plating-frame')
    const visible = element => {
      const css = getComputedStyle(element)
      return css.visibility !== 'hidden' && css.display !== 'none' && element.getBoundingClientRect().height > 0
    }
    return {
      enhanced: root.dataset.enhanced,
      pinned: root.dataset.pinned,
      rootHeight: root.getBoundingClientRect().height,
      frameHeight: frame.getBoundingClientRect().height,
      overflow: document.documentElement.scrollWidth - innerWidth,
      visibleDescriptions: [...root.querySelectorAll('.plating-steps > li')].filter(visible).length,
      headingFont: getComputedStyle(root.querySelector('h2')).fontFamily,
      headingSize: parseFloat(getComputedStyle(root.querySelector('h2')).fontSize),
    }
  }, ROOT)
}

async function posterState(page) {
  await page.waitForFunction(selector => {
    const still = document.querySelector(selector)?.querySelector('.plating-still')
    const image = still?.tagName === 'IMG' ? still : still?.querySelector('img')
    return !image || image.complete
  }, { timeout: 5000 }, ROOT)
  return page.evaluate(selector => {
    const still = document.querySelector(selector)?.querySelector('.plating-still')
    if (!still) return { present: false, loaded: false, width: 0, opacity: 0 }
    const image = still.tagName === 'IMG' ? still : still.querySelector('img')
    const art = still.closest('.plating-art').getBoundingClientRect()
    const rect = image?.getBoundingClientRect()
    const css = image && getComputedStyle(image)
    const number = value => parseFloat(value) || 0
    const padding = css ? [number(css.paddingLeft), number(css.paddingTop), number(css.paddingRight), number(css.paddingBottom)] : [0, 0, 0, 0]
    const boxWidth = image?.offsetWidth || 0, boxHeight = image?.offsetHeight || 0
    const contentWidth = Math.max(0, (image?.clientWidth || 0) - padding[0] - padding[2])
    const contentHeight = Math.max(0, (image?.clientHeight || 0) - padding[1] - padding[3])
    const scale = image?.naturalWidth && image?.naturalHeight ? Math.min(contentWidth / image.naturalWidth, contentHeight / image.naturalHeight) : 0
    const drawnWidth = (image?.naturalWidth || 0) * scale, drawnHeight = (image?.naturalHeight || 0) * scale
    const positions = css?.objectPosition.split(' ') || ['50%', '50%']
    const offset = (position, free) => position.endsWith('%') ? number(position) / 100 * free : position === 'center' ? free / 2 : position === 'right' || position === 'bottom' ? free : number(position)
    const left = padding[0] + offset(positions[0], contentWidth - drawnWidth)
    const top = padding[1] + offset(positions[1] || '50%', contentHeight - drawnHeight)
    const factorX = rect && boxWidth ? rect.width / boxWidth : 1, factorY = rect && boxHeight ? rect.height / boxHeight : 1
    const fitted = rect ? { left: rect.left + left * factorX, top: rect.top + top * factorY, right: rect.left + (left + drawnWidth) * factorX, bottom: rect.top + (top + drawnHeight) * factorY } : null
    return {
      present: true, loaded: !!image && image.complete && image.naturalWidth > 0,
      width: still.getBoundingClientRect().width, opacity: Number(getComputedStyle(still).opacity),
      imageWidth: rect?.width || 0, imageHeight: rect?.height || 0, artWidth: art.width,
      fitMode: css?.objectFit, padding, fittedContent: fitted,
      fitsHorizontally: !!fitted && fitted.left >= art.left - 1 && fitted.right <= art.right + 1,
      fitsVertically: !!fitted && fitted.top >= art.top - 1 && fitted.bottom <= art.bottom + 1,
      preservesAspect: css?.objectFit === 'contain' && drawnHeight > 0 && Math.abs(drawnWidth / drawnHeight - image.naturalWidth / image.naturalHeight) < .01,
      hasGutter: Math.min(top, boxHeight - top - drawnHeight) >= 7.5,
      fullWidth: padding[0] < .01 && padding[2] < .01 && Math.abs(left) <= 1 && Math.abs(boxWidth - left - drawnWidth) <= 1,
    }
  }, ROOT)
}

function checkPoster(label, poster) {
  pass(`${label}: rendered still preserves full source width and vertical gutters`, poster.present && poster.loaded && poster.width > 0 && poster.opacity > .99 && poster.fitsHorizontally && poster.fitsVertically && poster.preservesAspect && poster.hasGutter && poster.fullWidth, JSON.stringify(poster))
}

async function checkStaticTreatment(page, label, requests) {
  await nearTimeline(page)
  await page.waitForFunction(() => !!window.__platingTimeline)
  const state = await geometryState(page)
  const poster = await posterState(page)
  pass(`${label}: static treatment preserves all four descriptions`, state.visibleDescriptions === 4, JSON.stringify(state))
  pass(`${label}: static treatment has no pinned scroll spacer`, state.pinned !== 'true' && Math.abs(state.rootHeight - state.frameHeight) < 2 && state.overflow <= 1, JSON.stringify(state))
  checkPoster(label, poster)
  pass(`${label}: unavailable sequence guard makes no graphics or frame requests`, !requests.some(url => isGraphicsRequest(url) || isSequenceRequest(url) || isFrameRequest(url)))
}

async function screenshot(page, name) {
  const filename = path.join(OUT, name)
  await page.waitForFunction(selector => {
    const root = document.querySelector(selector)
    const poster = root?.querySelector('.plating-still')
    return root?.dataset.graphics !== 'ready' || !poster || Number(getComputedStyle(poster).opacity) < .01
  }, {}, ROOT)
  // A frame capture includes the complete composition without the scroll space.
  await page.$eval(FRAME, element => element.getBoundingClientRect())
  await (await page.$(FRAME)).screenshot({ path: filename })
  screenshots.push(filename)
}

async function run(name, body) {
  try { await body() }
  catch (error) { pass(`${name} completes`, false, error.stack || String(error)) }
}

try {
  server = await serve(PORT)
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })

  await run('desktop timeline', async () => {
    const { page, requests } = await openPage('desktop', { width: 1440, height: 900 })
    try {
      if (!sequence) {
        notRun('desktop decoded-frame progression, detents, reverse scroll, pinning and pixel assertions')
        await checkStaticTreatment(page, '1440px', requests)
        await screenshot(page, 'desktop-static.png')
        return
      }
      const initial = await page.$eval(ROOT, element => ({ top: element.getBoundingClientRect().top, viewport: innerHeight }))
      if (initial.top > initial.viewport + 160) {
        pass('graphics stay unloaded before the timeline approaches the viewport', !requests.some(url => isGraphicsRequest(url) || isSequenceRequest(url) || isFrameRequest(url)), `timeline starts ${Math.round(initial.top)}px below a ${initial.viewport}px viewport`)
      } else rows.push({ name: 'first-fold lazy-load boundary', ok: true, detail: 'Timeline is within its loading margin at this viewport; the deferred-chunk check is not applicable.' })

      await readyTimeline(page, true)
      pass('desktop activates a complete pinned composition', true)
      await enterWithWheel(page)
      await screenshot(page, 'desktop-first.png')
      // Element screenshots can scroll a transformed depth plane a few pixels
      // outside capture. Re-enter with native input before measuring scrub.
      await enterWithWheel(page)
      const states = []
      for (const station of [0, 1, 2, 3]) {
        if (station) await wheelStation(page, station, 120)
        states.push(await page.evaluate(selector => {
          const canvas = document.querySelector(selector)
          const bytes = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
          let alphaSamples = 0, hash = 2166136261
          for (let i = 0; i < bytes.length; i += 64) {
            if (bytes[i + 3]) alphaSamples++
            for (let channel = 0; channel < 4; channel++) hash = Math.imul(hash ^ bytes[i + channel], 16777619) >>> 0
          }
          return { ...window.__platingTimeline, y: scrollY, rendered: { frame: Number(canvas.dataset.frame), simulationFrame: Number(canvas.dataset.simulationFrame), variant: canvas.dataset.variant, alphaSamples, pixelHash: hash } }
        }, CANVAS))
      }
      pass('wheel travel reaches all four rendered stations', states.every((state, index) => state.active === index && Math.abs(state.progress - index / 3) < .003), JSON.stringify(states.map(state => ({ raw: state.raw, progress: state.progress, active: state.active, capturing: state.capturing }))))
      pass('settled stations draw their decoded sequence frames', states.every((state, index) => state.rendered.frame === sequence?.stations?.[index] && state.rendered.simulationFrame === sequence?.frames?.[sequence.stations[index]] && state.rendered.alphaSamples > 0), JSON.stringify(states.map(state => state.rendered)))
      pass('the rendered canvas changes at all four stations', new Set(states.map(state => state.rendered.pixelHash)).size === 4)

      pass('the final detent releases a subsequent downward wheel gesture', true, JSON.stringify(await releaseWithWheel(page, true)))
      await enterWithWheel(page, true)
      const reversed = []
      for (const station of [2, 1, 0]) reversed.push(await wheelStation(page, station, -120))
      pass('reverse native wheel gestures reach every prior detent', reversed.every((state, index) => state.active === 2 - index), reversed.map(state => state.active).join(' → '))
      pass('the first detent releases a subsequent upward wheel gesture', true, JSON.stringify(await releaseWithWheel(page, false)))
      await enterWithWheel(page)
      // The compact layout stacks the step texts (only the active one is visible) and offers station buttons instead,
      // so select the third stop with whichever control a visitor can actually see.
      const compactNow = await page.$eval(ROOT, element => element.dataset.compactLayout === 'true')
      await page.click(compactNow ? `${ROOT} button[aria-controls="plating-step-2"]` : `${ROOT} .plating-steps > li:nth-child(3) h3 button`)
      await settledAt(page, 2)
      pass(`the visible ${compactNow ? 'station button' : 'heading'} selects its corresponding scroll stop`, true)
      await atStation(page, 3)
      pass('desktop has no horizontal overflow', (await geometryState(page)).overflow <= 1)

      await page.addScriptTag({ content: fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8') })
      const axe = await page.evaluate(async selector => {
        const result = await window.axe.run(document.querySelector(selector), { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] })
        return result.violations.filter(violation => violation.impact === 'serious' || violation.impact === 'critical').map(violation => ({
          id: violation.id,
          impact: violation.impact,
          targets: violation.nodes.map(node => node.target),
          existingDecisionOnly: violation.id === 'color-contrast' && violation.nodes.every(node => {
            const target = node.target[0]
            if (typeof target !== 'string') return false
            try { return !!document.querySelector(target)?.closest('[data-tbd]') }
            catch { return false }
          }),
        }))
      }, ROOT)
      const actionable = axe.filter(violation => !violation.existingDecisionOnly)
      pass('timeline has no serious or critical scoped axe violations', actionable.length === 0, JSON.stringify(actionable))
      if (axe.some(violation => violation.existingDecisionOnly)) rows.push({ name: 'existing policy decision contrast', ok: true, detail: 'Retained TBD marker contrast reported separately from the timeline.' })
      await screenshot(page, 'desktop-last.png')
    } finally { await closePage(page) }
  })

  for (const [width, height] of [[1000, 600], [1200, 650]]) {
    await run(`${width}×${height} compact desktop wheel travel`, async () => {
      const { page } = await openPage(`compact-desktop-${width}`, { width, height })
      try {
        await readyTimeline(page, true)
        await enterWithWheel(page)
        const forward = []
        for (const station of [1, 2, 3]) forward.push(await wheelStation(page, station, 120))
        pass(`${width}×${height}: real forward wheel gestures advance each detent`, forward.every((state, index) => state.active === index + 1), forward.map(state => state.active).join(' → '))
        const reading = await page.evaluate(selector => {
          const root = document.querySelector(selector)
          const frame = root.querySelector('.plating-frame').getBoundingClientRect()
          const active = root.querySelector('.plating-steps > li[data-active="true"]')
          const title = active.querySelector('h3').getBoundingClientRect()
          const description = active.querySelector('p').getBoundingClientRect()
          const header = document.querySelector('.home-header')?.getBoundingClientRect()
          return { pinned: root.dataset.pinned === 'true', compact: root.dataset.compactLayout === 'true', overflow: document.documentElement.scrollWidth - innerWidth, frameTop: frame.top, frameBottom: frame.bottom, titleTop: title.top, descriptionBottom: description.bottom, readingTop: (header?.bottom || 0) + 12, readingBottom: innerHeight - 16 }
        }, ROOT)
        pass(`${width}×${height}: compact composition pins with readable selected copy`, reading.pinned && reading.compact && reading.overflow <= 1 && reading.titleTop >= reading.readingTop - 2 && reading.descriptionBottom <= reading.readingBottom + 2 && reading.frameBottom <= reading.readingBottom + 2, JSON.stringify(reading))
        await screenshot(page, `desktop-compact-${width}.png`)
        pass(`${width}×${height}: last detent releases downward wheel scrolling`, true, JSON.stringify(await releaseWithWheel(page, true)))
        await enterWithWheel(page, true)
        const reverse = []
        for (const station of [2, 1, 0]) reverse.push(await wheelStation(page, station, -120))
        pass(`${width}×${height}: real reverse wheel gestures reach the first detent`, reverse.every((state, index) => state.active === 2 - index), reverse.map(state => state.active).join(' → '))
        pass(`${width}×${height}: first detent releases upward wheel scrolling`, true, JSON.stringify(await releaseWithWheel(page, false)))
      } finally { await closePage(page) }
    })
  }

  await run('small continuous wheel scrub', async () => {
    const { page } = await openPage('small-wheel-scrub', { width: 1000, height: 600 })
    try {
      await readyTimeline(page, true)
      await enterWithWheel(page)
      const sample = () => page.evaluate(selector => {
        const canvas = document.querySelector(selector)
        return { ...window.__platingTimeline, y: scrollY, frame: Number(canvas.dataset.frame), simulationFrame: Number(canvas.dataset.simulationFrame) }
      }, CANVAS)
      const samples = []
      for (let index = 0; index < 6; index++) {
        await page.mouse.wheel({ deltaY: 24 })
        await quiet(220)
        samples.push(await sample())
      }
      const intermediate = samples.filter(state => state.frame > sequence.stations[0] && state.frame < sequence.stations[1])
      const monotonic = samples.every((state, index) => !index || state.progress >= samples[index - 1].progress - .002)
      pass('small wheel deltas scrub monotonically through real intermediate frames', monotonic && new Set(intermediate.map(state => state.frame)).size >= 3, JSON.stringify(samples.map(state => ({ progress: state.progress, frame: state.frame, y: state.y }))))
      await quiet(450)
      const stopped = await sample()
      await quiet(450)
      const rested = await sample()
      // The depth follower may coast into the next soft pause; what must not happen is travel past it or autoplay.
      pass('stopping wheel input leaves the spoon between detents without autoplay', stopped.progress > .03 && stopped.progress <= 1 / 3 + .003 && Math.abs(rested.progress - stopped.progress) < .002 && Math.abs(rested.y - stopped.y) <= 1 && rested.frame === stopped.frame, JSON.stringify({ stopped, rested }))
      await wheelStation(page, 1, 120)
      const beforePause = await sample()
      await page.mouse.wheel({ deltaY: 12 })
      await quiet(450)
      const inPause = await sample()
      pass('a soft detent pauses the rendered spoon while pixel input continues', inPause.y > beforePause.y + 5 && Math.abs(inPause.progress - 1 / 3) < .003 && inPause.frame === sequence.stations[1], JSON.stringify({ beforePause, inPause }))
      await page.mouse.wheel({ deltaY: 48 })
      await quiet(450)
      const afterPause = await sample()
      pass('continued pixel input smoothly leaves the detent pause', afterPause.progress > 1 / 3 + .02 && afterPause.frame > sequence.stations[1] && afterPause.frame < sequence.stations[2], JSON.stringify(afterPause))
    } finally { await closePage(page) }
  })

  await run('sustained wheel travel', async () => {
    const { page } = await openPage('continuous-wheel', { width: 1000, height: 600 })
    try {
      await readyTimeline(page, true)
      await enterWithWheel(page)
      const began = Date.now(), samples = []
      while (Date.now() - began < 2800) {
        await page.mouse.wheel({ deltaY: 40 })
        samples.push(await page.evaluate(started => {
          const state = window.__platingTimeline
          const canvas = document.querySelector('[data-plating-timeline] .plating-scene canvas')
          return { elapsed: Date.now() - started, active: state.active, progress: state.progress, capturing: state.capturing, y: scrollY, end: state.start + state.travel, simulationFrame: Number(canvas?.dataset.simulationFrame) }
        }, began))
        await quiet(60)
      }
      const gaps = samples.slice(1).map((sample, index) => sample.elapsed - samples[index].elapsed)
      const maximumGap = Math.max(...gaps)
      const seenStops = [1, 2, 3].filter(station => samples.some(sample => sample.active === station))
      const intermediateFrames = new Set(samples.filter(sample => !sequence.stations.some(index => sequence.frames[index] === sample.simulationFrame)).map(sample => sample.simulationFrame))
      const monotonic = samples.every((sample, index) => !index || sample.progress >= samples[index - 1].progress - .003)
      const released = samples.find(sample => sample.y > sample.end + 3)
      wheelBursts.push({ viewport: [1000, 600], deltaY: 40, requestedGapMs: 60, samples })
      pass('dense native wheel input scrubs through intermediate frames and all later stops', maximumGap < 180 && seenStops.length === 3 && intermediateFrames.size >= 8 && monotonic, JSON.stringify({ maximumGapMs: maximumGap, seenStops, intermediateFrames: [...intermediateFrames], events: samples.length }))
      pass('dense native wheel input releases after the final scrub endpoint', !!released, JSON.stringify(released || samples.at(-1)))
    } finally { await closePage(page) }
  })

  for (const [width, height] of [[390, 844], [320, 740], [600, 844]]) {
    await run(`${width}px mobile timeline`, async () => {
      const { page, requests } = await openPage(`mobile-${width}`, { width, height, isMobile: true, hasTouch: true })
      try {
        if (!sequence) {
          notRun(`${width}px decoded-frame readiness, native tap and right-arrow station selection`)
          await checkStaticTreatment(page, `${width}px`, requests)
          if (width === 390) await screenshot(page, 'mobile-static.png')
          return
        }
        await readyTimeline(page)
        await page.tap(`${ROOT} .plating-mobile-stops button:first-child`)
        await settledAt(page, 0)
        if (width === 390 || width === 320) await screenshot(page, width === 390 ? 'mobile-first.png' : 'mobile-320-first.png')
        const nextLabel = await page.$eval(`${ROOT} .plating-mobile-stops button:nth-child(2)`, button => button.textContent.trim())
        await page.focus(`${ROOT} .plating-mobile-stops button:first-child`)
        await page.keyboard.press('ArrowRight')
        await settledAt(page, 1)
        const state = await page.evaluate(selector => {
          const root = document.querySelector(selector)
          const active = root.querySelector('.plating-steps > li[data-active="true"]')
          const description = active.querySelector('p').getBoundingClientRect()
          const title = active.querySelector('h3').getBoundingClientRect()
          const bar = document.querySelector('[data-mobile-bar]')
          const header = document.querySelector('.home-header')
          const nav = [...root.querySelectorAll('.plating-mobile-stops button')].map(button => {
            const icon = button.querySelector('svg')?.getBoundingClientRect()
            const text = [...button.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim())
            const range = document.createRange()
            if (text) range.selectNodeContents(text)
            const label = text ? range.getBoundingClientRect() : null
            const bounds = button.getBoundingClientRect()
            return {
              name: button.textContent.trim(), height: bounds.height,
              iconAboveLabel: !!icon && !!label && icon.bottom <= label.top + 1,
              centered: !!icon && !!label && Math.abs((icon.left + icon.right - label.left - label.right) / 2) < 2,
              labelFits: !!label && label.left >= bounds.left - 1 && label.right <= bounds.right + 1,
            }
          })
          return {
            overflow: document.documentElement.scrollWidth - innerWidth,
            current: root.querySelector('.plating-mobile-stops [aria-current="step"]')?.textContent,
            focused: document.activeElement?.textContent,
            selectedVisible: getComputedStyle(active).visibility === 'visible' && description.height > 0,
            insideReadingArea: title.top >= (header?.getBoundingClientRect().bottom || 0) - 1 && description.bottom <= (bar?.getBoundingClientRect().top || innerHeight) + 1,
            pinned: root.dataset.pinned === 'true',
            nav,
          }
        }, ROOT)
        pass(`${width}px: native right-arrow selects and focuses the next step`, !!nextLabel && state.current === nextLabel && state.focused === nextLabel, JSON.stringify({ expected: nextLabel, ...state }))
        pass(`${width}px: selected detail is readable with no horizontal overflow`, state.selectedVisible && state.overflow <= 1 && (!state.pinned || state.insideReadingArea), JSON.stringify(state))
        pass(`${width}px: all four navigation icons stack above centered, fitting labels`, state.nav.length === 4 && state.nav.every(item => item.height >= 58 && item.iconAboveLabel && item.centered && item.labelFits), JSON.stringify(state.nav))
        const variant = await page.$eval(CANVAS, canvas => canvas.dataset.variant)
        pass(`${width}px: the mobile frame variant is actually drawn`, variant === 'mobile', variant)
        if (width === 390) await screenshot(page, 'mobile-current.png')
        if (width === 390 || width === 320) {
          await page.tap(`${ROOT} .plating-mobile-stops button:last-child`)
          await settledAt(page, 3)
          await quiet(250)
          await screenshot(page, width === 390 ? 'mobile-last.png' : 'mobile-320-last.png')
        }
      } finally { await closePage(page) }
    })
  }

  await run('short viewport', async () => {
    const { page, requests } = await openPage('short-mobile', { width: 390, height: 664, isMobile: true, hasTouch: true })
    try {
      if (!sequence) {
        notRun('short-viewport decoded-frame readiness and pin eligibility')
        await checkStaticTreatment(page, '390×664px', requests)
        return
      }
      await readyTimeline(page)
      const state = await page.evaluate(selector => {
        const root = document.querySelector(selector)
        const frame = root.querySelector('.plating-frame')
        const available = innerHeight - (document.querySelector('.home-header')?.getBoundingClientRect().height || 0) - 12 - 92
        return { pinned: root.dataset.pinned === 'true', frameHeight: frame.offsetHeight, available, overflow: document.documentElement.scrollWidth - innerWidth }
      }, ROOT)
      pass('short viewport fits and pins its condensed composition', state.overflow <= 1 && state.frameHeight <= state.available + 1 && state.pinned, JSON.stringify(state))
    } finally { await closePage(page) }
  })

  for (const width of FALLBACK_WIDTHS) await run(`${width}px reduced motion`, async () => {
    const { page, requests } = await openPage(`reduced-motion-${width}`, { width, height: 844, isMobile: true, hasTouch: true }, { reduced: true })
    try {
      await nearTimeline(page)
      await page.waitForFunction(() => !!window.__platingTimeline)
      const state = await geometryState(page)
      pass(`${width}px: reduced motion keeps all four descriptions and no scroll spacer`, state.visibleDescriptions === 4 && state.pinned !== 'true' && Math.abs(state.rootHeight - state.frameHeight) < 2 && state.overflow <= 1, JSON.stringify(state))
      checkPoster(`${width}px reduced motion`, await posterState(page))
      pass(`${width}px: initial reduced motion makes no graphics or frame requests`, !requests.some(url => isGraphicsRequest(url) || isSequenceRequest(url) || isFrameRequest(url)))
    } finally { await closePage(page) }
  })

  for (const width of FALLBACK_WIDTHS) await run(`${width}px no JavaScript`, async () => {
    const { page, requests } = await openPage(`no-js-${width}`, { width, height: 844, isMobile: true, hasTouch: true }, { noJs: true })
    try {
      await nearTimeline(page)
      const state = await geometryState(page)
      pass(`${width}px: no JavaScript preserves all four descriptions without a spacer`, state.visibleDescriptions === 4 && state.pinned !== 'true' && Math.abs(state.rootHeight - state.frameHeight) < 2, JSON.stringify(state))
      pass(`${width}px: no JavaScript keeps the section heading styled`, /EB Garamond/i.test(state.headingFont) && state.headingSize >= 32 && state.overflow <= 1, JSON.stringify(state))
      checkPoster(`${width}px no JavaScript`, await posterState(page))
      pass(`${width}px: no JavaScript makes no graphics or frame requests`, !requests.some(url => isGraphicsRequest(url) || isSequenceRequest(url) || isFrameRequest(url)))
      if (width === 600) await screenshot(page, 'mobile-600-no-js.png')
    } finally { await closePage(page) }
  })

  for (const width of FALLBACK_WIDTHS) await run(`${width}px graphics fallback`, async () => {
    if (!sequence) {
      notRun('unavailable 2D-canvas fault injection', 'No packaged sequence is installed, so the build guard never constructs the renderer; static treatment was checked separately.')
      return
    }
    const { page } = await openPage(`canvas-unavailable-${width}`, { width, height: 844, isMobile: true, hasTouch: true }, { noCanvas: true })
    try {
      await nearTimeline(page)
      await page.waitForFunction(selector => document.querySelector(selector)?.dataset.graphics === 'fallback', {}, ROOT)
      const state = await geometryState(page)
      const illustration = await posterState(page)
      pass(`${width}px: unavailable canvas preserves complete copy`, state.visibleDescriptions === 4, JSON.stringify(state))
      checkPoster(`${width}px canvas failure`, illustration)
      pass(`${width}px: graphics failure creates no empty scroll spacer`, state.pinned !== 'true' && Math.abs(state.rootHeight - state.frameHeight) < 2 && state.overflow <= 1, JSON.stringify(state))
    } finally { await closePage(page) }
  })

  for (const failure of [
    { name: 'sequence manifest HTTP failure', options: { failManifest: true }, matches: isSequenceRequest },
    { name: 'decoded frame HTTP failure', options: { failFrames: true }, matches: isFrameRequest },
  ]) {
    for (const width of FALLBACK_WIDTHS) await run(`${width}px ${failure.name}`, async () => {
      if (!sequence) {
        notRun(failure.name, 'No packaged sequence is installed, so the build guard prevents the asset request; this fault was not injected or covered.')
        return
      }
      const { page, blocked } = await openPage(`${failure.name}-${width}`, { width, height: 844, isMobile: true, hasTouch: true }, failure.options)
      try {
        await nearTimeline(page)
        await page.waitForFunction(selector => document.querySelector(selector)?.dataset.graphics === 'fallback', {}, ROOT)
        const state = await geometryState(page)
        const illustration = await posterState(page)
        pass(`${width}px ${failure.name}: the intended local asset request was failed`, blocked.some(failure.matches), JSON.stringify(blocked))
        pass(`${width}px ${failure.name}: complete copy remains visible`, state.visibleDescriptions === 4, JSON.stringify(state))
        checkPoster(`${width}px ${failure.name}`, illustration)
        pass(`${width}px ${failure.name}: failure creates no empty scroll spacer`, state.pinned !== 'true' && Math.abs(state.rootHeight - state.frameHeight) < 2 && state.overflow <= 1, JSON.stringify(state))
      } finally { await closePage(page) }
    })
  }
} catch (error) {
  pass('integration runner completes', false, error.stack || String(error))
} finally {
  for (const page of pages) await page.close().catch(() => {})
  if (browser) await browser.close()
  if (server) await new Promise(resolve => server.close(resolve))
}

pass('pages complete without uncaught browser errors', errors.length === 0, JSON.stringify(errors))
const failures = rows.filter(row => !row.ok)
const report = { generatedAt: new Date().toISOString(), origin: ORIGIN, dist: DIST, compiledApp, sequence: sequence && { frames: sequence.frames, stations: sequence.stations, desktop: sequence.desktop, mobile: sequence.mobile }, checks: rows, unavailable, errors, screenshots, wheelBursts, failures: failures.length }
fs.writeFileSync(path.join(OUT, 'integration-report.json'), JSON.stringify(report, null, 2) + '\n')
for (const row of rows) console.log(`${row.ok ? '✓' : '✗'} ${row.name}${row.detail ? `  (${row.detail})` : ''}`)
for (const row of unavailable) console.log(`↷ NOT RUN: ${row.name}  (${row.detail})`)
console.log(`${failures.length ? '✗' : '✓'} plating integration: ${rows.length - failures.length}/${rows.length} checks passed; ${unavailable.length} cases unavailable; report ${path.join(OUT, 'integration-report.json')}`)
if (failures.length) process.exitCode = 1
