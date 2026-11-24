// Read-only integration of the actual emitted production renderer. No app or
// artwork is replaced: only drawImage calls are observed in an isolated host.
import fs from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'
import { serve } from './serve.mjs'

const DIST = path.resolve(process.env.DIST_DIR || 'dist')
const OUT = path.resolve(process.env.SHOTS_DIR || 'output/plating-timeline/clipping-checks/runtime')
const PORT = Number(process.env.PLATING_PORT) || 5190
const ORIGIN = `http://localhost:${PORT}`
const manifest = JSON.parse(fs.readFileSync(path.join(DIST, '.vite/manifest.json'), 'utf8'))
const rendererFile = manifest[Object.keys(manifest).find(key => key.endsWith('/plating/frames.ts'))].file
const sequence = JSON.parse(fs.readFileSync(path.join(DIST, 'art/plating/sequence.json'), 'utf8'))
const photography = JSON.parse(fs.readFileSync(path.join(DIST, 'art/plating/scene-provenance.json'), 'utf8')).photography
const historicalSourcePath = path.resolve('output/plating-timeline/thinfilm-final/frames/0000.png')
const historicalSource = `data:image/png;base64,${fs.readFileSync(historicalSourcePath).toString('base64')}`
const sizes = [[1000, 900], [1200, 900], [1440, 1000], [1000, 600], [390, 844], [320, 740]]
const cases = [], alignments = [], errors = [], failures = [], screenshots = []
let browser, server
fs.mkdirSync(OUT, { recursive: true })

function inspect(record, native = true) {
  if (!record) return { ok: false, reason: 'No actual drawImage call was observed' }
  const { source, crop, destination: [x, y, width, height], transform: [a, b, c, d, e, f], bitmap, css } = record
  const corners = [[x, y], [x + width, y], [x, y + height], [x + width, y + height]].map(([u, v]) => [a * u + c * v + e, b * u + d * v + f])
  const bounds = [Math.min(...corners.map(p => p[0])), Math.min(...corners.map(p => p[1])), Math.max(...corners.map(p => p[0])), Math.max(...corners.map(p => p[1]))]
  const ratios = [bitmap[0] / css[0], bitmap[1] / css[1]]
  const margins = [bounds[0] / ratios[0], bounds[1] / ratios[1], (bitmap[0] - bounds[2]) / ratios[0], (bitmap[1] - bounds[3]) / ratios[1]]
  const wholeSource = Math.abs(crop[0]) < .001 && Math.abs(crop[1]) < .001 && Math.abs(crop[2] - source[0]) < .001 && Math.abs(crop[3] - source[1]) < .001
  // The backing store rounds fractional CSS dimensions to whole pixels.
  const inside = bounds[0] >= -.51 && bounds[1] >= -.51 && bounds[2] <= bitmap[0] + .51 && bounds[3] <= bitmap[1] + .51
  const aspect = Math.abs(width / height - source[0] / source[1]) < .001 && Math.abs(Math.hypot(a, b) - Math.hypot(c, d)) < .001
  const gutter = Math.min(margins[1], margins[3]) >= 7.5
  const fullWidth = Math.max(Math.abs(margins[0]), Math.abs(margins[2])) <= .51
  const nativeAspect = !native || Math.abs(source[0] / source[1] - 3.2) < .001
  return { ok: wholeSource && inside && aspect && gutter && fullWidth && nativeAspect, wholeSource, inside, aspect, gutter, fullWidth, nativeAspect, bitmapBounds: bounds, cssMargins: margins, backingStoreRoundingAllowancePx: .51 }
}

function installSpy() {
  window.__drawAudit = { serial: 0, last: null }
  const original = CanvasRenderingContext2D.prototype.drawImage
  CanvasRenderingContext2D.prototype.drawImage = function (image, ...args) {
    if (this.canvas.dataset.clipControl || this.canvas.closest('[data-clipping-fixture],.plating-scene')) {
      const source = [image.naturalWidth || image.width, image.naturalHeight || image.height]
      const crop = args.length === 8 ? args.slice(0, 4) : [0, 0, ...source]
      const destination = args.length === 8 ? args.slice(4) : args.length === 4 ? args : [args[0], args[1], ...source]
      const t = this.getTransform(), rect = this.canvas.getBoundingClientRect()
      window.__drawAudit.last = { serial: ++window.__drawAudit.serial, source, crop, destination, transform: [t.a, t.b, t.c, t.d, t.e, t.f], bitmap: [this.canvas.width, this.canvas.height], css: [rect.width || Number(this.canvas.dataset.cssWidth), rect.height || Number(this.canvas.dataset.cssHeight)] }
      window.__drawAudit.image = image
    }
    return original.call(this, image, ...args)
  }
}

try {
  server = await serve(PORT)
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-sandbox'] })
  const hosts = []
  for (const [width, height] of sizes) {
    const page = await browser.newPage()
    page.on('pageerror', error => errors.push(error.message))
    await page.evaluateOnNewDocument(installSpy)
    try {
      await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: width < 681, hasTouch: width < 681 })
      await page.goto(ORIGIN, { waitUntil: 'networkidle0' })
      await page.evaluate(() => document.fonts.ready)
      await page.evaluate(() => {
        const root = document.querySelector('[data-plating-timeline]')
        window.scrollTo({ top: root.getBoundingClientRect().top + scrollY - document.querySelector('.home-header').getBoundingClientRect().height - 12, behavior: 'instant' })
      })
      await page.waitForFunction(() => window.__platingTimeline?.ready)
      for (let station = 0; station < 4; station++) {
        await page.evaluate(index => window.scrollTo({ top: window.__platingTimeline.start + window.__platingTimeline.travel * index / 3, behavior: 'instant' }), station)
        await page.waitForFunction(({ index, frame }) => Number(document.querySelector('.plating-scene canvas')?.dataset.frame) === frame && Math.abs(window.__platingTimeline.progress - index / 3) < .002, {}, { index: station, frame: sequence.stations[station] })
        const sourceFrame = sequence.frames[sequence.stations[station]]
        const framePhotography = photography.frames.find(frame => frame.frame === sourceFrame)
        if (!framePhotography?.projectedStopUv) throw new Error(`Missing public projectedStopUv for frame${sourceFrame}`)
        const alignment = await page.evaluate(({ station, uv }) => {
          const record = window.__drawAudit.last
          const canvas = document.querySelector('.plating-scene canvas'), rect = canvas.getBoundingClientRect()
          const [sx, sy, sw, sh] = record.crop, [dx, dy, dw, dh] = record.destination
          const x = dx + (uv[0] * record.source[0] - sx) / sw * dw
          const y = dy + (uv[1] * record.source[1] - sy) / sh * dh
          const [a, b, c, d, e, f] = record.transform
          const paintedX = rect.left + (a * x + c * y + e) / record.bitmap[0] * rect.width
          const paintedY = rect.top + (b * x + d * y + f) / record.bitmap[1] * rect.height
          const root = document.querySelector('[data-plating-timeline]')
          const useNav = root.dataset.compactLayout === 'true' || innerWidth <= 680
          const target = root.querySelectorAll(useNav ? '.plating-mobile-stops button' : '.plating-steps > li')[station]
          const box = target.getBoundingClientRect(), pseudo = getComputedStyle(target, '::before')
          const markerLeft = pseudo.left.endsWith('%') ? parseFloat(pseudo.left) / 100 * target.clientWidth : parseFloat(pseudo.left)
          const tickX = box.left + (markerLeft + parseFloat(pseudo.width) / 2) * box.width / target.offsetWidth
          return { sourceUv: uv, paintedX, paintedY, tickX, errorCssPx: Math.abs(paintedX - tickX), marker: useNav ? 'navigation-tick' : 'column-tick', actualFrame: Number(canvas.dataset.simulationFrame), record }
        }, { station, uv: framePhotography.projectedStopUv })
        alignments.push({ viewport: [width, height], station, simulationFrame: sourceFrame, ...alignment })
        if (!Number.isFinite(alignment.errorCssPx) || alignment.errorCssPx > 1 || alignment.actualFrame !== sourceFrame) failures.push({ reason: 'Painted stop does not align with its actual text marker within1CSSpx', viewport: [width, height], station, ...alignment })
      }
      await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.plating-still')).opacity) < .01)
      const host = await page.evaluate(() => {
        const rect = document.querySelector('.plating-scene').getBoundingClientRect()
        return { width: rect.width, height: rect.height, compact: document.querySelector('[data-plating-timeline]').dataset.compactLayout }
      })
      hosts.push({ viewport: [width, height], ...host })
      const shot = path.join(OUT, `contain-${width}x${height}.png`)
      await (await page.$('.plating-frame')).screenshot({ path: shot })
      screenshots.push(shot)
    } finally { await page.close() }
  }

  const page = await browser.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1.5 })
  await page.setRequestInterception(true)
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/__plating_clip_fixture') void request.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"></body></html>' }).catch(() => {})
    else void request.continue().catch(() => {})
  })
  await page.evaluateOnNewDocument(installSpy)
  await page.goto(`${ORIGIN}/__plating_clip_fixture`)
  const progressAt = index => {
    const segment = Math.min(2, Math.max(0, sequence.stations.findIndex((station, i) => i < 3 && index <= sequence.stations[i + 1])))
    return (segment + (index - sequence.stations[segment]) / (sequence.stations[segment + 1] - sequence.stations[segment])) / 3
  }
  let negativeControl
  for (const host of hosts) {
    await page.evaluate(async ({ rendererFile, host }) => {
      window.__clipScene?.dispose()
      document.body.replaceChildren()
      const element = document.createElement('div')
      element.dataset.clippingFixture = 'true'
      Object.assign(element.style, { position: 'relative', width: `${host.width}px`, height: `${host.height}px` })
      document.body.appendChild(element)
      const module = await import(`/${rendererFile}`)
      window.__clipScene = module.createPlatingScene(element, { onError: error => { window.__clipError = String(error) } })
    }, { rendererFile, host })
    const observations = []
    for (let index = 0; index < sequence.frames.length; index++) {
      const serial = await page.evaluate(progress => { const before = window.__drawAudit.serial; window.__clipScene.setProgress(progress); return before }, progressAt(index))
      await page.waitForFunction(({ index, serial }) => window.__clipError || window.__drawAudit.serial > serial && Number(document.querySelector('canvas')?.dataset.frame) === index, { timeout: 15000 }, { index, serial })
      const observed = await page.evaluate(() => ({ error: window.__clipError, record: window.__drawAudit.last, variant: document.querySelector('canvas').dataset.variant, index: Number(document.querySelector('canvas').dataset.frame) }))
      const result = inspect(observed.record)
      observations.push({ index, simulationFrame: sequence.frames[index], variant: observed.variant, record: observed.record, ...result })
      if (!result.ok || observed.error || observed.index !== index) failures.push({ viewport: host.viewport, index, ...result, error: observed.error })
      if (!negativeControl && index === 0) {
        const oldRecord = await page.evaluate(async data => {
          const image = await createImageBitmap(await (await fetch(data)).blob())
          if (image.width !== 1920 || image.height !== 900) throw new Error('Historical negative control must use a1920×900source')
          const aux = document.createElement('canvas')
          aux.dataset.clipControl = 'true'; aux.dataset.cssWidth = 952; aux.dataset.cssHeight = 280
          aux.width = 1428; aux.height = 420
          const context = aux.getContext('2d');context.setTransform(1.5,0,0,1.5,0,0)
          const naturalHeight = image.height * 952 / image.width
          context.drawImage(image,0,Math.max(0,280-naturalHeight),952,naturalHeight)
          const record = window.__drawAudit.last;image.close();return record
        }, historicalSource)
        negativeControl = { historicalSourcePath, historicalHost: [952,280], record: oldRecord, ...inspect(oldRecord,false) }
      }
    }
    cases.push({ ...host, framesChecked: observations.length, observations })
  }
  await page.evaluate(() => window.__clipScene.dispose())
  await page.close()
  if (negativeControl?.ok !== false || negativeControl.inside !== false) failures.push({ reason: 'Old full-width cropped draw was not rejected', negativeControl })
  fs.writeFileSync(path.join(OUT, 'canvas-clipping-report.json'), JSON.stringify({ generatedAt: new Date().toISOString(), dist: DIST, rendererFile, requestedFrames: sequence.frames, framesChecked: cases.reduce((sum, c) => sum + c.framesChecked, 0), cases, alignments, negativeControl, failures, errors, screenshots }, null, 2) + '\n')
  console.log(JSON.stringify({ cases: cases.length, framesChecked: cases.reduce((sum, c) => sum + c.framesChecked, 0), alignmentsChecked: alignments.length, maximumAlignmentErrorCssPx: Math.max(...alignments.map(row => row.errorCssPx)), failures: failures.length, errors, negativeControl: { inside: negativeControl.inside, bounds: negativeControl.bitmapBounds, bitmap: negativeControl.record.bitmap }, report: path.join(OUT, 'canvas-clipping-report.json') }))
  if (failures.length || errors.length) process.exitCode = 1
} finally {
  if (browser) await browser.close()
  if (server) await new Promise(resolve => server.close(resolve))
}
