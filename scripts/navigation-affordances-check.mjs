// Focused proof for the selected Open house header's service information, icons and footer.
// The selected-header owner's navigation-check.mjs covers its complete interaction contract.
// This script never builds. DIST_DIR selects a build snapshot; SHOTS_DIR selects its captures.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import puppeteer from 'puppeteer-core'
import { serve } from './serve.mjs'

const require = createRequire(import.meta.url)
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = Number(process.env.NAV_AFFORDANCES_PORT) || 4358
const EXTERNAL = process.env.NAV_BASE_URL
const ORIGIN = (EXTERNAL || `http://localhost:${PORT}`).replace(/\/$/, '')
const SHOTS = process.env.SHOTS_DIR || '.audit'
const HEADER = 'header[data-site-header]'
const PANEL = '#site-navigation-overview'
const rows = [], errors = [], axeResults = []
const pass = (name, ok, detail = '') => rows.push({ name, pass: !!ok, detail })
const source = fs.readFileSync(new URL('../src/content/site.ts', import.meta.url), 'utf8')
const services = [
  ['dinner', '/privatedining/', 'Private dinners'],
  ['class', '/cookingclasses/', 'Cooking classes'],
  ['event', '/catering/', 'Small events'],
].map(([format, href, label]) => {
  const range = source.match(new RegExp(`\\b${format}:\\s*\\{[^}]*\\bmin:\\s*(\\d+)[^}]*\\bmax:\\s*(\\d+)`))
  if (!range) throw new Error(`Missing canonical guest range for ${format}`)
  return { href, label, range: `${range[1]}–${range[2]} guests` }
})
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))

async function watch(page, label) {
  page.on('pageerror', error => errors.push(`${label}: ${error.message}`))
  // The homepage asks the booking service for client reviews; answer locally instead of calling the live Worker.
  await page.setRequestInterception(true)
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/reviews' && !request.url().startsWith(ORIGIN)) return request.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': ORIGIN }, body: JSON.stringify({ reviews: [] }) })
    return request.continue()
  })
  page.on('console', message => {
    if (message.type() === 'error' && !/\/favicon\.ico(?:\?|$)/.test(message.location().url || '')) errors.push(`${label}: ${message.text()}`)
  })
}

async function open(page, width, noScript = false) {
  if (noScript) await page.setJavaScriptEnabled(false)
  await page.setViewport({ width, height: width === 320 ? 568 : 900, deviceScaleFactor: 1 })
  // Test the settled homepage: the first-visit arrival holds the hero and header until it finishes.
  await page.evaluateOnNewDocument(() => { try { sessionStorage.setItem('sergio.home-arrival.v1', 'settled') } catch {} })
  await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle0' })
  await page.evaluate(() => document.fonts.ready)
}

async function triggerFor(page) {
  for (const element of await page.$$(`${HEADER} [data-site-navigation-toggle]`)) {
    if (await element.evaluate(element => element.getClientRects().length > 0)) return element
  }
  throw new Error('No visible navigation trigger')
}

async function expand(page, keyboard) {
  const trigger = await triggerFor(page)
  if (keyboard) { await trigger.focus(); await page.keyboard.press('Enter') }
  else await trigger.click()
  await page.waitForSelector(`${PANEL}:not([hidden])`, { visible: true })
  await page.$eval(PANEL, element => Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))))
  pass(`${keyboard ? 'Enter' : 'pointer'} opens a correctly labelled nonmodal overview`,
    await trigger.evaluate(element => element.getAttribute('aria-expanded') === 'true' && element.getAttribute('aria-controls') === 'site-navigation-overview') &&
    await page.$eval(PANEL, element => !element.hidden && element.tagName === 'SECTION' && element.getAttribute('role') !== 'dialog'))
  return trigger
}

async function checkIcons(page, label) {
  const missing = await page.$$eval(`${HEADER} a, ${HEADER} button, footer a`, elements => elements
    .filter(element => element.getClientRects().length > 0 && !element.matches('.sergio-header-brand, .footer-brand'))
    .filter(element => !element.querySelector('svg[aria-hidden="true"]'))
    .map(element => element.textContent.replace(/\s+/g, ' ').trim()))
  pass(`${label}: visible navigation and footer controls have decorative icons`, missing.length === 0, missing.join(', '))
}

async function checkServices(page, label) {
  const rendered = await page.$$eval(`${PANEL} .sergio-header-experiences>a`, elements => elements.map(element => ({
    href: new URL(element.href).pathname,
    label: element.querySelector('.sergio-header-service-title')?.textContent.trim(),
    guests: element.querySelector('.sergio-header-guest-tag')?.textContent.replace(/\s+/g, ' ').trim(),
    icon: !!element.querySelector('.sergio-header-service-title svg[aria-hidden="true"]'),
    current: element.getAttribute('aria-current'),
  })))
  pass(`${label}: three service cards show canonical guest ranges, routes and icons`, rendered.length === services.length && services.every((service, index) =>
    rendered[index]?.href.endsWith(service.href) && rendered[index].label === service.label && rendered[index].guests === service.range && rendered[index].icon),
    rendered.map(service => `${service.label}: ${service.guests}`).join('; '))
  return rendered
}

async function checkReading(page, label) {
  const state = await page.evaluate(() => {
    const within = element => {
      if (!element) return false
      const rect = element.getBoundingClientRect(), style = getComputedStyle(element)
      return rect.width > 0 && rect.height > 0 && rect.left >= -1 && rect.right <= innerWidth + 1 && style.visibility !== 'hidden' && Number(style.opacity) > 0
    }
    const heading = document.querySelector('[data-home-hero] h1'), description = document.querySelector('.home-description')
    const footer = document.querySelector('footer h2'), inquiry = document.querySelector('footer .footer-inquiry-button')
    return {
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      readable: [heading, description, footer, inquiry].every(within),
      headingSize: heading ? Number.parseFloat(getComputedStyle(heading).fontSize) : 0,
      bodySize: description ? Number.parseFloat(getComputedStyle(description).fontSize) : 0,
      inquiry: inquiry?.href,
    }
  })
  pass(`${label}: hero and footer remain readable without horizontal overflow`, !state.overflow && state.readable && state.headingSize >= 32 && state.bodySize >= 16)
  pass(`${label}: footer inquiry is an unprefilled native booking link`, !!state.inquiry && new URL(state.inquiry).pathname.endsWith('/book/') && !new URL(state.inquiry).search, state.inquiry)
}

async function audit(page, label, selectors) {
  if (!await page.evaluate(() => !!window.axe)) await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') })
  const result = await page.evaluate(async selectors => {
    const { violations, incomplete } = await window.axe.run({ include: selectors.map(selector => [selector]) }, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
    })
    return { violations, incomplete }
  }, selectors)
  axeResults.push({ label, ...result })
  pass(`${label}: scoped WCAG A/AA axe checks`, result.violations.length === 0,
    result.violations.map(item => `${item.id}: ${item.nodes.map(node => node.target.join(' ')).join(', ')}`).join('; '))
}

async function checkShortScreen(page) {
  const geometry = await page.$eval(PANEL, panel => {
    const rect = panel.getBoundingClientRect()
    return { horizontal: panel.scrollWidth > panel.clientWidth + 1, scrollable: panel.scrollHeight > panel.clientHeight, bounded: rect.top >= -1 && rect.bottom <= innerHeight + 1 && rect.left >= -1 && rect.right <= innerWidth + 1 }
  })
  pass('320×568 overview fits horizontally with internal vertical scrolling', !geometry.horizontal && geometry.scrollable && geometry.bounded, JSON.stringify(geometry))
  const failures = []
  const controls = await page.$$(`${PANEL} button, ${PANEL} a[href]`)
  for (const control of controls) {
    await control.focus()
    await settle(page)
    const state = await control.evaluate(element => {
      const rect = element.getBoundingClientRect(), panel = document.getElementById('site-navigation-overview').getBoundingClientRect()
      return { label: element.textContent.replace(/\s+/g, ' ').trim(), width: rect.width, height: rect.height, visible: rect.top >= panel.top - 1 && rect.bottom <= Math.min(panel.bottom, innerHeight) + 1 && rect.left >= -1 && rect.right <= innerWidth + 1 }
    })
    if (!state.visible || state.width < 44 || state.height < 44) failures.push(`${state.label}: ${Math.round(state.width)}×${Math.round(state.height)}, visible=${state.visible}`)
  }
  pass('320×568 overview controls scroll into view and provide 44px targets', controls.length > 0 && failures.length === 0, failures.join('; ') || `${controls.length} controls`)
  await page.keyboard.press('Tab')
  await settle(page)
  pass('overview lets focus leave into the page and closes without a focus trap', await page.$eval(HEADER, header => !header.contains(document.activeElement)) && await page.$eval(PANEL, panel => panel.hidden))
}

fs.mkdirSync(SHOTS, { recursive: true })
let server, browser
try {
  if (!EXTERNAL) server = await serve(PORT)
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true })
  for (const width of [1440, 320]) {
    const context = await browser.createBrowserContext(), page = await context.newPage()
    const label = `${width}px`
    await watch(page, label)
    await open(page, width)
    await checkReading(page, label)
    await checkIcons(page, `${label} closed`)
    await audit(page, `${label} closed header and footer`, [HEADER, 'footer'])
    await page.screenshot({ path: path.join(SHOTS, `navigation-affordances-${width}-closed.png`) })
    const trigger = await expand(page, width === 1440)
    await checkServices(page, label)
    await checkIcons(page, `${label} open`)
    await audit(page, `${label} open header`, [HEADER])
    await page.screenshot({ path: path.join(SHOTS, `navigation-affordances-${width}-open.png`) })
    await page.focus(`${PANEL} .sergio-header-experiences>a`)
    await page.keyboard.press('Escape')
    await settle(page)
    pass(`${label}: Escape closes and restores the visible opener`, await page.$eval(PANEL, panel => panel.hidden) && await trigger.evaluate(element => document.activeElement === element && element.getAttribute('aria-expanded') === 'false'))
    await expand(page, true)
    if (width === 320) await checkShortScreen(page)
    else {
      await page.click('[data-home-hero] h1')
      await settle(page)
      pass('desktop outside pointer closes the overview', await page.$eval(PANEL, panel => panel.hidden))
      await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }))
      await expand(page, true)
      await page.focus(`${PANEL} .sergio-header-experiences>a`)
      await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.keyboard.press('Enter')])
      pass('private-dinner card opens its real service route', new URL(page.url()).pathname.endsWith('/privatedining/'))
      // The site routes in the page: the URL changes first, then the new page renders, the overview closes and focus
      // moves to the page. Reopen only after that, as a visitor would.
      await page.waitForFunction(panel => document.querySelector(panel)?.hidden && /private dinner/i.test(document.querySelector('main h1')?.textContent ?? ''), {}, PANEL)
      await settle(page)
      await expand(page, true)
      const current = await checkServices(page, 'private-dinner route')
      pass('private-dinner route identifies only its own service current', current[0]?.current === 'page' && current.filter(service => service.current === 'page').length === 1)
      // Choosing the page you are already on changes no route, so the overview has to close on the choice itself.
      await page.click(`${PANEL} .sergio-header-experiences>a[aria-current=page]`)
      pass('choosing the current page closes the overview at once', await page.$eval(PANEL, panel => panel.hidden) && new URL(page.url()).pathname.endsWith('/privatedining/'))
    }
    await page.$eval('footer', footer => footer.scrollIntoView({ block: 'start', behavior: 'instant' }))
    await (await page.$('footer')).screenshot({ path: path.join(SHOTS, `navigation-affordances-${width}-footer.png`) })
    if (width === 1440) {
      await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('footer .footer-inquiry-button')])
      pass('footer inquiry opens the existing booking page', new URL(page.url()).pathname.endsWith('/book/') && await page.$('main h1') !== null)
    }
    await context.close()
  }
  {
    const context = await browser.createBrowserContext(), page = await context.newPage()
    await watch(page, 'no-JS 320px')
    await open(page, 320, true)
    await checkReading(page, 'no-JS 320px')
    await checkIcons(page, 'no-JS 320px')
    const links = await page.$$eval('.sergio-header-fallback a[href]', elements => elements.map(element => ({ href: new URL(element.href).pathname, visible: element.getClientRects().length > 0 })))
    pass('no-JS fallback exposes all three real service destinations', services.every(service => links.some(link => link.visible && link.href.endsWith(service.href))))
    await page.screenshot({ path: path.join(SHOTS, 'navigation-affordances-320-no-javascript.png') })
    await context.close()
  }
} catch (error) {
  pass('navigation affordance check completes', false, error.stack || String(error))
} finally {
  if (browser) await browser.close()
  if (server) await new Promise(resolve => server.close(resolve))
  pass('affordance checks have no console, hydration or page errors', errors.length === 0, errors.join('; '))
  fs.writeFileSync(path.join(SHOTS, 'navigation-affordances-axe.json'), JSON.stringify(axeResults, null, 2))
  fs.writeFileSync(path.join(SHOTS, 'navigation-affordances-results.json'), JSON.stringify({ rows, errors, humanEvaluation: 'NOT RUN' }, null, 2))
}
console.log(rows.map(row => `${row.pass ? '✓' : '✗'} ${row.name}${row.detail ? ` (${row.detail})` : ''}`).join('\n'))
const failures = rows.filter(row => !row.pass).length
if (failures) {
  console.error(`\n✗ navigation affordance check: ${failures} failure(s)`)
  process.exitCode = 1
} else console.log(`\n✓ navigation affordance check passed (${rows.length} assertions)`)
