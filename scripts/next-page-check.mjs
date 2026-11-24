// Next-page prediction (src/next-page/): does it pick the right page early enough, how much does it fetch by mistake,
// and does the next page actually open sooner in a real browser? Needs Chrome and a build (dist/, or DIST_DIR).
//
//   node scripts/next-page-check.mjs          everything (about 4 minutes)
//   node scripts/next-page-check.mjs model    simulated pointer movements only
//   REPS=3 node scripts/next-page-check.mjs   more browser repetitions per journey
//
// 1. Simulation. Real link layouts are captured from the built pages, then thousands of synthetic aimed movements
//    (minimum-jerk speed profile, Fitts's-law durations, curved paths, 25% missed first submovements, 125 Hz) and
//    aimless ones are replayed through three predictors: Chromium's own hover trigger, straight-line extrapolation
//    ("inertia"), and model.ts. Synthetic movement is a model of people, not people: it ranks methods and catches
//    regressions; it does not prove field accuracy.
// 2. Browser. Chrome against a local GitHub-Pages-like server (max-age=600, ETag, gzip) with a simulated 4G link,
//    each journey moved and clicked like a person would, in four conditions: no speculation, Chromium's built-in
//    hover/press rules only, the full predictor, and the predictor without Speculation Rules or link prefetch (the
//    path Safari takes, but run in Chromium's cache: whether WebKit reuses a fetched document for the navigation is
//    not shown here). The booking API host is mapped to localhost, so prerendered booking pages never reach it.
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import zlib from 'node:zlib'
import { build } from 'esbuild'
import puppeteer from 'puppeteer-core'
import { DIST, report } from './lib.mjs'

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ONLY_MODEL = process.argv[2] === 'model'
const REPS = Number(process.env.REPS) || 2
const API_HOST = new URL((await import('./lib.mjs').then(m => m.loadRoutes())).booking.apiBase ?? 'https://api.invalid').host
const failures = [], notes = []
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)))

// ---- The model, compiled from the same source the site ships ----
const bundled = await build({ entryPoints: ['src/next-page/model.ts'], bundle: true, format: 'esm', write: false, platform: 'neutral' })
const model = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'))

// ---- A GitHub-Pages-like server on a simulated link ----
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' }
const RULES = /<script id="next-page-rules">[\s\S]*?<\/script>/g
const HINTS = /<script type="application\/json" id="next-page-hints">[\s\S]*?<\/script>/g
const variants = { none: (h) => h.replace(RULES, '').replace(HINTS, ''), rules: (h) => h.replace(HINTS, ''), full: (h) => h, 'fetch-only': (h) => h.replace(RULES, '') }
function serve(variant, { rtt = 0, bytesPerSecond = Infinity } = {}) {
  let downlinkFree = 0
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x')
    let file = path.join(DIST, decodeURIComponent(url.pathname))
    if (!file.startsWith(DIST)) return res.writeHead(403).end()
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html')
    if (!fs.existsSync(file)) return res.writeHead(404).end()
    const type = TYPES[path.extname(file)] ?? 'application/octet-stream'
    let body = fs.readFileSync(file)
    if (type.startsWith('text/html')) body = Buffer.from(variants[variant](body.toString()))
    const etag = `"${crypto.createHash('sha1').update(body).digest('hex').slice(0, 16)}"`
    await sleep(rtt)
    const headers = { 'Cache-Control': 'max-age=600', ETag: etag }
    if (req.headers['if-none-match'] === etag) return res.writeHead(304, headers).end()
    const zip = /text|javascript|json|svg/.test(type)
    if (zip) body = zlib.gzipSync(body)
    res.writeHead(200, { ...headers, 'Content-Type': type, ...(zip ? { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } : {}) })
    // One shared downlink: concurrent responses queue behind each other.
    for (let i = 0; i < body.length; i += 16384) {
      const chunk = body.subarray(i, i + 16384), now = performance.now()
      downlinkFree = Math.max(now, downlinkFree) + (chunk.length / bytesPerSecond) * 1000
      await sleep(downlinkFree - now)
      if (!res.write(chunk)) await new Promise((r) => res.once('drain', r))
    }
    res.end()
  })
  return new Promise((resolve) => server.listen(0, () => resolve({ server, origin: `http://localhost:${server.address().port}` })))
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [`--host-resolver-rules=MAP ${API_HOST} 127.0.0.1:9`, '--window-size=1440,900'],
})
const settledHome = () => { try { sessionStorage.setItem('sergio.home-arrival.v1', 'settled') } catch {} }
// The site leaves automated browsers alone (navigator.webdriver); this check stands in for a person.
const person = () => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false })

// ---- 1. Link layouts as visitors see them ----
const PAGES = ['/', '/privatedining/', '/cookingclasses/', '/catering/', '/about/', '/book/', '/gift/']
const layouts = []
{
  const { server, origin } = await serve('full')
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 })
  await page.evaluateOnNewDocument(settledHome)
  await page.evaluateOnNewDocument(person)
  for (const route of PAGES) {
    await page.goto(origin + route, { waitUntil: 'networkidle0' })
    const height = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)
    for (const y of [0, 0.35, 0.7, 1].map((f) => Math.round(f * height))) {
      await page.evaluate((y) => scrollTo({ top: y, behavior: 'instant' }), y)
      await sleep(150)
      const spots = await page.evaluate(() => {
        const hints = JSON.parse(document.getElementById('next-page-hints').textContent)
        const out = []
        for (const a of document.querySelectorAll('a[href]')) {
          const u = new URL(a.href)
          if (u.origin !== location.origin || (u.pathname === location.pathname && u.search === location.search) || !hints[u.pathname]) continue
          if (a.checkVisibility && !a.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue
          for (const r of a.getClientRects()) {
            if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue
            out.push({ url: u.pathname + u.search, box: { left: r.left - 4, top: r.top - 4, right: r.right + 4, bottom: r.bottom + 4 } })
          }
        }
        return out
      })
      if (spots.length) layouts.push({ route, y, spots })
    }
  }
  await page.close()
  server.close()
  notes.push(`layouts: ${layouts.length} views of ${PAGES.length} pages at 1440×900, ${layouts.reduce((n, l) => n + l.spots.length, 0)} link boxes`)
}

// ---- 2. Simulated movements ----
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const gauss = (rand) => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand())
const minJerk = (s) => 10 * s ** 3 - 15 * s ** 4 + 6 * s ** 5

/** An aimed movement: Fitts's-law duration, minimum-jerk speed profile, a bend, sometimes a missed first submovement. */
function movement(rand, from, to, width, t0 = 0) {
  const dx = to.x - from.x, dy = to.y - from.y, distance = Math.hypot(dx, dy)
  const duration = (90 + 150 * Math.log2(distance / Math.max(width, 8) + 1)) * (0.85 + 0.3 * rand())
  const miss = rand() < 0.25 ? (rand() < 0.5 ? 1.08 : 0.9) : 1
  const end = { x: from.x + dx * miss + gauss(rand) * 3, y: from.y + dy * miss + gauss(rand) * 3 }
  const bend = gauss(rand) * 0.06 * distance, nx = -dy / distance, ny = dx / distance
  const out = []
  for (let t = 0; t <= duration; t += 8) {
    const s = t / duration, k = minJerk(s), off = bend * Math.sin(Math.PI * s)
    out.push({ t: t0 + t, x: Math.round(from.x + (end.x - from.x) * k + nx * off), y: Math.round(from.y + (end.y - from.y) * k + ny * off) })
  }
  if (miss !== 1) {
    const last = out[out.length - 1], fix = 140 + 80 * rand()
    for (let t = 8; t <= fix; t += 8) {
      const k = minJerk(t / fix)
      out.push({ t: last.t + t, x: Math.round(last.x + (to.x - last.x) * k), y: Math.round(last.y + (to.y - last.y) * k) })
    }
  }
  return out
}
const inside = (b, p) => p.x >= b.left && p.x <= b.right && p.y >= b.top && p.y <= b.bottom

/** Replays a movement through a predictor; returns when each URL first reached each level, in ms. */
function replay(method, samples, spots, end) {
  const first = new Map()
  const reach = (url, level, t) => { for (let l = 1; l <= level; l++) if (!first.has(`${l}${url}`)) first.set(`${l}${url}`, t) }
  const last = samples[samples.length - 1]
  if (method === 'model') {
    const aim = model.createAim()
    let i = 0
    for (let t = samples[0].t + 16; t <= last.t + 16; t += 16) {
      while (i < samples.length && samples[i].t <= t) i++
      const window = samples.slice(Math.max(0, i - 40), i)
      for (const w of aim(window, spots)) reach(w.url, w.level, t)
    }
    for (const rested of [40, model.REST_MS]) if (last.t + rested < end) for (const w of aim(samples, spots, rested)) reach(w.url, w.level, last.t + rested)
  } else if (method === 'inertia') {
    // The pointer's current velocity carried forward 150 ms; two frames in a row on one link earns a render.
    let i = 0, streak = ''
    for (let t = samples[0].t + 16; t <= last.t + 16; t += 16) {
      while (i < samples.length && samples[i].t <= t) i++
      const a = samples[Math.max(0, i - 3)], b = samples[i - 1]
      const dt = Math.max(1, b.t - a.t), ahead = { x: b.x + ((b.x - a.x) / dt) * 150, y: b.y + ((b.y - a.y) / dt) * 150 }
      const hit = spots.find((s) => inside(s.box, ahead))?.url ?? ''
      if (hit) reach(hit, streak === hit ? 3 : 2, t)
      streak = hit
    }
    const hit = spots.find((s) => inside(s.box, last))
    if (hit && last.t + 80 < end) reach(hit.url, 3, last.t + 80)
  } else {
    // Chromium's document rules as shipped in the page: prefetch after 200 ms over a link, render on press.
    const hit = spots.find((s) => inside(s.box, last))
    if (hit && last.t + 200 < end) reach(hit.url, 2, last.t + 200)
  }
  return first
}

function simulate(n, seed) {
  const rand = rng(seed)
  const methods = ['hover', 'inertia', 'model']
  const stats = Object.fromEntries(methods.map((m) => [m, { lead: { 2: [], 3: [] }, wrong: { 2: 0, 3: 0 }, aimless: { 2: 0, 3: 0 } }]))
  for (let k = 0; k < n; k++) {
    const layout = layouts[Math.floor(rand() * layouts.length)]
    const target = layout.spots[Math.floor(rand() * layout.spots.length)]
    const b = target.box, w = b.right - b.left, h = b.bottom - b.top
    const to = { x: b.left + w / 2 + gauss(rand) * w / 8, y: b.top + h / 2 + gauss(rand) * h / 8 }
    let from
    do from = { x: rand() * 1440, y: rand() * 900 }
    while (Math.hypot(from.x - to.x, from.y - to.y) < 120)
    const samples = movement(rand, from, to, Math.min(w, h))
    const arrive = samples[samples.length - 1].t, click = arrive + 100 + 250 * rand() // mouseup
    // An aimless movement of the same shape that ends on no link: reading, selecting text, parking the pointer.
    let rest
    do rest = { x: rand() * 1440, y: rand() * 900 }
    while (layout.spots.some((s) => inside(s.box, rest)) || Math.hypot(from.x - rest.x, from.y - rest.y) < 120)
    const idle = movement(rand, from, rest, 40)
    for (const m of methods) {
      const first = replay(m, samples, layout.spots, click)
      for (const level of [2, 3]) {
        // Press: Chromium's conservative rule (and model.ts's press handler) renders at mousedown, ~90 ms before click.
        const at = Math.min(first.get(`${level}${target.url}`) ?? Infinity, level === 3 ? click - 90 : Infinity)
        if (at <= click) stats[m].lead[level].push(click - at)
        for (const key of first.keys()) if (key[0] === String(level) && key.slice(1) !== target.url && first.get(key) <= click) stats[m].wrong[level]++
      }
      const lost = replay(m, idle, layout.spots, idle[idle.length - 1].t + 1000)
      for (const key of lost.keys()) if (key[0] === '2' || key[0] === '3') stats[m].aimless[key[0]]++
    }
  }
  return stats
}
const pct = (xs, q) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(q * (xs.length - 1))] : NaN)
{
  const N = 4000
  const stats = simulate(N, 7)
  console.log(`\nSimulated movements: ${N} aimed + ${N} aimless, 1440×900`)
  console.log('method   | warm lead p25/p50 | render lead p25/p50 | wrong warms/aimed | wrong renders/aimed | warms/aimless | renders/aimless')
  for (const [m, s] of Object.entries(stats)) {
    const row = [
      `${pct(s.lead[2], 0.25) | 0}/${pct(s.lead[2], 0.5) | 0} ms (${((100 * s.lead[2].length) / N).toFixed(0)}%)`,
      `${pct(s.lead[3], 0.25) | 0}/${pct(s.lead[3], 0.5) | 0} ms`,
      (s.wrong[2] / N).toFixed(2), (s.wrong[3] / N).toFixed(2), (s.aimless[2] / N).toFixed(2), (s.aimless[3] / N).toFixed(2),
    ]
    console.log(`${m.padEnd(8)} | ${row.join(' | ')}`)
  }
  const ours = stats.model, hover = stats.hover
  if (pct(ours.lead[3], 0.5) < pct(hover.lead[3], 0.5) + 100) failures.push(`model: median render lead ${pct(ours.lead[3], 0.5) | 0} ms is not clearly ahead of the hover baseline's ${pct(hover.lead[3], 0.5) | 0} ms`)
  if (ours.lead[2].length / N < 0.9) failures.push(`model: warmed the clicked page in only ${((100 * ours.lead[2].length) / N).toFixed(0)}% of aimed movements`)
  if (ours.wrong[3] / N > 0.25) failures.push(`model: ${(ours.wrong[3] / N).toFixed(2)} wrong renders per aimed movement (budget 0.25)`)
  if (ours.aimless[3] / N > 0.1) failures.push(`model: ${(ours.aimless[3] / N).toFixed(2)} renders per aimless movement (budget 0.10)`)
}

// ---- 3. Real browser, simulated 4G ----
const JOURNEYS = [
  ['/', '/sergios-table/'],
  ['/privatedining/', '/book/?type=dinner'],
  ['/cookingclasses/', '/about/'],
  ['/about/', '/book/'],
  ['/catering/', '/gift/'],
  ['/book/', '/'],
]
const NETWORK = { rtt: 80, bytesPerSecond: 1.2e6 } // ~10 Mbps, 80 ms: a typical 4G phone link to a CDN edge
const PHONE_JOURNEYS = [
  ['/', '/book/?type=dinner'],
  ['/privatedining/', '/book/?type=dinner'],
  ['/about/', '/book/'],
  ['/cookingclasses/', '/gift/'],
  ['/book/', '/'],
]
async function journey(origin, variant, from, href, rand, phone = false) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport(phone ? { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { width: 1440, height: 900 })
  await page.evaluateOnNewDocument(settledHome)
  await page.evaluateOnNewDocument(person)
  if (variant === 'fetch-only')
    await page.evaluateOnNewDocument(() => {
      HTMLScriptElement.supports = () => false
      const supports = DOMTokenList.prototype.supports
      DOMTokenList.prototype.supports = function (token) { return token === 'prefetch' ? false : supports.call(this, token) }
    })
  await page.goto(origin + from, { waitUntil: 'load' })
  await sleep(2500) // reading: the idle step runs, and the first page's own late requests finish
  if (phone) {
    // Scroll the link to the middle of the screen, read for a moment, tap it.
    const found = await page.evaluate((href) => {
      const links = [...document.querySelectorAll(`a[href="${href}"]`)].filter((a) => a.getClientRects().length && a.checkVisibility({ visibilityProperty: true, opacityProperty: true }))
      const a = links.find((a) => a.closest('#main')) ?? links[0]
      if (!a) return false
      a.scrollIntoView({ block: 'center', behavior: 'instant' })
      return true
    }, href)
    if (!found) { await context.close(); return { missing: true } }
    await sleep(500 + 600 * rand())
    const box = await page.evaluate((href) => {
      const r = [...document.querySelectorAll(`a[href="${href}"]`)].map((a) => a.getBoundingClientRect()).find((r) => r.width && r.top >= 0 && r.bottom <= innerHeight)
      return r && { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    }, href)
    if (!box) { await context.close(); return { missing: true } }
    await page.touchscreen.touchStart(box.x, box.y)
    await sleep(90) // a tap: finger down to finger up
  } else {
    const box = await page.evaluate((href) => {
      const a = [...document.querySelectorAll(`a[href="${href}"]`)].map((a) => a.getBoundingClientRect()).find((r) => r.width && r.top >= 0 && r.bottom <= innerHeight)
      return a && { x: a.left + a.width / 2, y: a.top + a.height / 2, w: a.width, h: a.height }
    }, href)
    if (!box) { await context.close(); return { missing: true } }
    let start
    do start = { x: 200 + rand() * 1040, y: 250 + rand() * 600 }
    while (Math.hypot(start.x - box.x, start.y - box.y) < 250)
    await page.mouse.move(start.x, start.y)
    await sleep(300)
    const path = movement(rand, start, box, Math.min(box.w, box.h))
    const began = performance.now()
    for (const p of path) {
      await sleep(p.t - (performance.now() - began))
      await page.mouse.move(p.x, p.y)
    }
    await sleep(100 + 200 * rand()) // settling on the link before pressing
    await page.mouse.down()
    await sleep(90)
  }
  const before = await page.evaluate(() => ({ clock: performance.timeOrigin + performance.now(), marks: performance.getEntriesByType('mark').filter((m) => m.name.startsWith('next-page:')).map((m) => `${m.name.slice(10)} ${Math.round(performance.now() - m.startTime)}ms`) }))
  await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), phone ? page.touchscreen.touchEnd() : page.mouse.up()])
  await sleep(1200)
  const after = await page.evaluate(() => new Promise((resolve) => {
    let lcp = 0
    new PerformanceObserver((list) => { for (const e of list.getEntries()) lcp = e.startTime }).observe({ type: 'largest-contentful-paint', buffered: true })
    setTimeout(() => {
      const nav = performance.getEntriesByType('navigation')[0]
      const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0
      resolve({ origin: performance.timeOrigin, url: location.pathname + location.search, activationStart: nav.activationStart, transferSize: nav.transferSize, deliveryType: nav.deliveryType, fcp, lcp })
    }, 50)
  }))
  await context.close()
  const visible = (t) => after.origin + Math.max(t || 0, after.activationStart) - before.clock
  return { ...after, activationFromClick: after.activationStart ? after.origin + after.activationStart - before.clock : 0, fcpFromClick: visible(after.fcp), lcpFromClick: visible(after.lcp || after.fcp), marks: before.marks }
}

if (!ONLY_MODEL) {
  const results = {}
  const rand = rng(11)
  for (const variant of ['none', 'rules', 'full', 'fetch-only']) {
    const { server, origin } = await serve(variant, NETWORK)
    for (const [device, journeys] of [['desktop', JOURNEYS], ['phone', PHONE_JOURNEYS]])
      for (const [from, href] of journeys)
        for (let r = 0; r < REPS; r++) {
          const result = await journey(origin, variant, from, href, rand, device === 'phone')
          const name = `${device} ${from} → ${href}`
          if (result.missing) { failures.push(`browser: no visible link to ${href} on ${from} (${device})`); continue }
          if (result.url !== href) failures.push(`browser ${variant}: ${name} arrived at ${result.url}`)
          ;(results[name] ??= {})[variant] ??= []
          results[name][variant].push(result)
          if (process.env.VERBOSE) console.log(`  ${variant.padEnd(10)} ${name}: largest paint ${result.lcpFromClick | 0} ms after click${result.activationStart ? `, prerender shown ${result.activationFromClick | 0} ms after click` : ''}${result.transferSize === 0 ? ', document from cache' : ''}; before click: ${result.marks.join(', ') || 'nothing'}`)
        }
    server.close()
  }
  const median = (rs, k) => pct(rs.map((r) => r[k]), 0.5)
  console.log(`\nBrowser: click to largest paint (ms), median of ${REPS}; simulated link ${NETWORK.rtt} ms RTT, ${(NETWORK.bytesPerSecond * 8e-6).toFixed(0)} Mbps`)
  console.log('journey                                         | none | rules | full (prerendered) | fetch-only (doc from cache)')
  for (const [name, by] of Object.entries(results)) {
    const full = by.full ?? [], fetchOnly = by['fetch-only'] ?? []
    const prerendered = full.filter((r) => r.activationStart > 0).length
    const cached = fetchOnly.filter((r) => r.transferSize === 0).length
    console.log(`${name.padEnd(47)} | ${median(by.none ?? [], 'lcpFromClick') | 0} | ${median(by.rules ?? [], 'lcpFromClick') | 0} | ${median(full, 'lcpFromClick') | 0} (${prerendered}/${full.length}) | ${median(fetchOnly, 'lcpFromClick') | 0} (${cached}/${fetchOnly.length})`)
    if (prerendered < full.length) failures.push(`browser full: ${name} was prerendered in ${prerendered}/${full.length} runs (marks before click: ${full.map((r) => r.marks.join(' ') || 'none').join(' | ')})`)
    // On a phone, a link nothing pointed to before the tap gets only the tap's head start: reported, not required.
    if (name.startsWith('phone')) continue
    if (cached < fetchOnly.length) failures.push(`browser fetch-only: ${name} document came from the network in ${fetchOnly.length - cached}/${fetchOnly.length} runs`)
    if (median(full, 'lcpFromClick') >= median(by.none ?? [], 'lcpFromClick')) failures.push(`browser: ${name} was not faster with the predictor`)
  }

  // ---- 4. A prerender nobody opens leaves nothing behind (any version of the booking draft key) ----
  {
    const { server, origin } = await serve('full', NETWORK)
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    await page.setViewport({ width: 1440, height: 900 })
    await page.evaluateOnNewDocument(person)
    await page.goto(origin + '/privatedining/', { waitUntil: 'load' })
    await sleep(1500)
    const box = await page.evaluate(() => {
      const r = [...document.querySelectorAll('a[href="/book/?type=dinner"]')].map((a) => a.getBoundingClientRect()).find((r) => r.width && r.top >= 0 && r.bottom <= innerHeight)
      return r && { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })
    await page.mouse.move(box.x - 200, box.y + 120)
    await page.mouse.move(box.x, box.y, { steps: 12 })
    await sleep(2500) // long enough for the booking form to load and hydrate in the background
    const unopened = await page.evaluate(() => ({ draft: (Object.keys(localStorage).filter((k) => k.startsWith('booking-draft')).map((k) => localStorage.getItem(k)).join('') || null), rendered: performance.getEntriesByName('next-page:3:/book/?type=dinner').length }))
    if (!unopened.rendered) failures.push('draft: resting on the booking link did not start a prerender')
    if (unopened.draft) failures.push('draft: a prerendered booking form nobody opened saved a draft')
    await Promise.all([page.waitForNavigation(), page.mouse.click(box.x, box.y)])
    await sleep(800)
    const opened = await page.evaluate(() => ({ draft: (Object.keys(localStorage).filter((k) => k.startsWith('booking-draft')).map((k) => localStorage.getItem(k)).join('') || null), activationStart: performance.getEntriesByType('navigation')[0].activationStart }))
    if (!opened.activationStart) failures.push('draft: the booking page was not served from the prerender')
    if (!opened.draft) failures.push('draft: the opened booking form did not save its draft after activation')
    notes.push(`draft: unopened prerender saved ${unopened.draft ? 'a draft' : 'nothing'}; after opening, draft ${opened.draft ? 'saved' : 'missing'}`)
    await context.close()
    server.close()
  }
}

await browser.close()
report('next-page prediction', failures, notes)
