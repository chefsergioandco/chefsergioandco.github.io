// Gift-card checks that can fail: codes, print rules, and the rendered card in a real browser.
//   node scripts/gift-card-check.mjs            (after a build; serves dist/ itself)
//   CHECK_BASE_URL=http://127.0.0.1:4436 node scripts/gift-card-check.mjs
// No request leaves the machine: every call to the booking service is intercepted.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { randomBytes } from 'node:crypto'
import { build } from 'esbuild'
import puppeteer from 'puppeteer-core'
import { serve } from './serve.mjs'

const directory = await mkdtemp(join(tmpdir(), 'sergio-gift-'))
const require = createRequire(import.meta.url)
const port = Number(process.env.GIFT_CHECK_PORT) || 4426
const origin = (process.env.CHECK_BASE_URL || `http://localhost:${port}`).replace(/\/$/, '')
let browser, server, passed = 0
const check = async (name, run) => { await run(); passed++; console.log(`✓ ${name}`) }
const STRESS = [
  { amountCents: 50000, recipient: 'Maximiliana Bartholomew-Featherstonehaugh', sender: 'The Okonkwo-Vanderbilt family, with love', note: 'For your fortieth: an evening where you do not lift a finger. Invite whoever you like, choose the night, and let Sergio cook. We will bring the wine and the speeches, and you will bring nothing at all.' },
  { amountCents: 10000, recipient: 'Mia', sender: 'Jo', note: '' },
  { amountCents: 15000 },
  { amountCents: 25000, recipient: 'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWW', sender: 'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMM', note: 'W'.repeat(40) },
]
try {
  const bundle = join(directory, 'gift.cjs')
  await build({ stdin: { contents: `export * from './prototypes/sergio-admin/shared/gift-cards/artwork';export * from './prototypes/sergio-admin/shared/gift-cards/code'`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'silent' })
  const gift = require(bundle)
  const doc = extra => ({ redeemUrl: 'https://chefsergioandco.github.io/book/', phone: '(407) 757-3009', code: gift.generateGiftCode(bytes => randomBytes(bytes.length)), ...extra })

  await check('codes: 16 Crockford characters, unique, and every one passes its own check', async () => {
    const codes = new Set()
    for (let index = 0; index < 5000; index++) { const code = gift.generateGiftCode(bytes => randomBytes(bytes.length)); assert.match(code, /^[0-9A-HJKMNP-TV-Z]{16}$/); assert(gift.isGiftCode(code)); codes.add(code) }
    assert.equal(codes.size, 5000)
    const code = [...codes][0]
    assert(gift.isGiftCode(gift.formatGiftCode(code).toLowerCase()), 'Lower case with spaces is accepted')
    assert(gift.isGiftCode(code.replace(/0/g, 'O').replace(/1/g, 'I')), 'O and I are read as 0 and 1')
  })
  await check('codes: every single mistyped character is caught, and nearly every swap of neighbours', async () => {
    let substitutions = 0, transpositions = 0, missedSwaps = 0
    for (let sample = 0; sample < 300; sample++) {
      const code = gift.generateGiftCode(bytes => randomBytes(bytes.length))
      for (let position = 0; position < 16; position++) for (const char of gift.GIFT_CODE_ALPHABET) {
        if (char === code[position]) continue
        substitutions++; assert(!gift.isGiftCode(code.slice(0, position) + char + code.slice(position + 1)), `Undetected substitution in ${code} at ${position}`)
      }
      for (let position = 0; position < 15; position++) {
        if (code[position] === code[position + 1]) continue
        transpositions++; if (gift.isGiftCode(code.slice(0, position) + code[position + 1] + code[position] + code.slice(position + 2))) missedSwaps++
      }
    }
    const rate = 1 - missedSwaps / transpositions
    assert(rate > .99, `Only ${(rate * 100).toFixed(2)}% of neighbour swaps caught`)
    console.log(`  ${substitutions} substitutions all caught; ${(rate * 100).toFixed(2)}% of ${transpositions} neighbour swaps caught`)
  })
  await check('artwork: every accepted card passes the print rules; per-card text is never foil and never on the front', async () => {
    for (const extra of STRESS) {
      let artwork
      try { artwork = gift.buildGiftCardArtwork(doc(extra)) } catch (error) { assert(error instanceof RangeError, String(error)); continue }
      assert.deepEqual(gift.printProblems(artwork), [], JSON.stringify(extra).slice(0, 80))
      const personal = [extra.recipient, extra.sender, extra.note].filter(Boolean)
      for (const command of artwork.front.commands) if (command.kind === 'text') assert(!personal.some(value => value.includes(command.text) || command.text.includes(value)), `Front carries per-card text: ${command.text}`)
      for (const command of artwork.back.commands) if (command.kind === 'text') assert(!command.finish.startsWith('foil'), `Back text in foil: ${command.text}`)
    }
    assert.throws(() => gift.buildGiftCardArtwork(doc({ amountCents: 25000, note: 'Word '.repeat(90) })), RangeError, 'An overlong note is refused, not clipped')
    assert.throws(() => gift.buildGiftCardArtwork(doc({ amountCents: 0 })), RangeError)
  })
  await check('print master: each pass is its own black plate, and the plates add up to the card', async () => {
    const logoSvg = await fs.readFile('public/invitations/logo-primary-ink.svg', 'utf8')
    const card = doc(STRESS[0]), artwork = gift.buildGiftCardArtwork(card)
    for (const face of ['front', 'back']) {
      const composite = gift.renderGiftCardSvg(card, face, { logoSvg })
      assert.match(composite, /width="5in" height="3.5in"/)
      assert.match(composite, /<rect width="1000" height="700" rx="25" ry="25"/, 'The composite shows the rounded card')
      assert.match(gift.renderGiftCardPlateSvg(card, face, 'dieline', { logoSvg }), /rx="25" ry="25" fill="none"/, 'The cutting line has 1/8 in corners')
      assert.match(gift.renderGiftCardPlateSvg(card, face, 'flood', { logoSvg }), /width="5.25in" height="3.75in"[\s\S]*x="-25" y="-25" width="1050" height="750"/, 'The ivory runs 1/8 in past the trim')
      let total = 0
      for (const plate of ['foil-black', 'foil-rouge', 'ink-black', 'ink-rouge']) {
        const svg = gift.renderGiftCardPlateSvg(card, face, plate, { logoSvg })
        assert(!/#(?!000000)[0-9a-f]{6}/i.test(svg.replace(/<style>[\s\S]*?<\/style>/, '').replace(/data:image\/svg\+xml[^"]*/g, '')), `${face} ${plate} plate has a colour other than black`)
        total += artwork[face].commands.filter(command => gift.plateOf(command.finish) === plate).length
      }
      assert.equal(total, artwork[face].commands.length)
    }
    const front = gift.buildGiftCardArtwork(card).front.commands
    assert(front.some(command => command.kind === 'logo') && front.some(command => command.kind === 'text' && command.finish === 'foil-black' && command.text === '$500'), 'Logo and amount are gloss black foil')
  })

  if (!process.env.CHECK_BASE_URL) server = await serve(port)
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  const page = await browser.newPage(), errors = [], outside = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setRequestInterception(true)
  page.on('request', request => {
    const url = new URL(request.url())
    if (url.origin === new URL(origin).origin || url.protocol === 'data:' || url.protocol === 'blob:') return void request.continue()
    outside.push(url.origin + url.pathname)
    if (url.pathname === '/api/gift/config') return void request.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ ready: false, amounts: [10000, 15000, 25000, 50000] }) })
    return void request.abort()
  })
  await page.setViewport({ width: 1440, height: 1000 })
  await page.goto(origin + '/gift/', { waitUntil: 'networkidle0' })
  await page.waitForFunction(() => document.querySelectorAll('canvas[data-gift-material][data-renderer=webgl]').length === 2, { timeout: 30000 })
  await page.evaluate(() => document.fonts.ready)

  await check('the real fonts fit: every line of every accepted card stays inside the trim margin, with no collisions', async () => {
    for (const extra of STRESS) {
      let artwork
      try { artwork = gift.buildGiftCardArtwork(doc(extra)) } catch { continue }
      const problems = await page.evaluate((artwork, fonts) => {
        const context = document.createElement('canvas').getContext('2d'), found = []
        for (const face of Object.values(artwork)) {
          const boxes = face.commands.filter(command => command.kind === 'text').map(command => {
            context.font = `${command.font === 'italic' ? 'italic ' : ''}${command.weight} ${command.size}px "${fonts[command.font]}"`
            const metrics = context.measureText(command.text), width = metrics.width
            const left = command.align === 'center' ? command.x - width / 2 : command.align === 'right' ? command.x - width : command.x
            return { text: command.text, left, right: left + width, top: command.y - metrics.actualBoundingBoxAscent, bottom: command.y + metrics.actualBoundingBoxDescent }
          })
          for (const box of boxes) if (box.left < 25 || box.right > 975 || box.top < 25 || box.bottom > 675) found.push(`${face.face}: "${box.text.slice(0, 30)}" leaves the safe area (${box.left.toFixed(0)}–${box.right.toFixed(0)})`)
          for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
            const x = Math.min(boxes[a].right, boxes[b].right) - Math.max(boxes[a].left, boxes[b].left), y = Math.min(boxes[a].bottom, boxes[b].bottom) - Math.max(boxes[a].top, boxes[b].top)
            if (x > 1 && y > 1) found.push(`${face.face}: "${boxes[a].text.slice(0, 20)}" overlaps "${boxes[b].text.slice(0, 20)}"`)
          }
        }
        return found
      }, artwork, gift.GIFT_CARD_FONTS)
      assert.deepEqual(problems, [], JSON.stringify(extra).slice(0, 60))
    }
  })

  await check('plastic under light: the foil glints far more than ink or bare plastic, the sheen on bare plastic is smooth, and the light travels with the turn', async () => {
    const card = await page.$('.gift-card-body'), box = await card.boundingBox()
    const front = gift.buildGiftCardArtwork(doc({ amountCents: await page.$eval('.gift-amount[data-checked=true] input', input => Number(input.value)), note: '', recipient: '', sender: '' })).front
    const pose = async dx => {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2, { steps: 6 }); await page.mouse.up()
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 150)))))
      return page.$eval('.gift-card-body', element => Number(element.dataset.giftYaw))
    }
    await page.evaluate(() => { window.__giftShots = [] })
    const capture = () => page.evaluate(() => new Promise(resolve => { const image = new Image(); image.onload = () => { const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height; const context = canvas.getContext('2d'); context.drawImage(image, 0, 0); window.__giftShots.push(context.getImageData(0, 0, canvas.width, canvas.height).data); resolve(canvas.width) }; image.src = document.querySelector('canvas[data-gift-material=front]').toDataURL() }))
    const yaws = [await pose(-60)]; await capture(); yaws.push(await pose(60)); await capture(); yaws.push(await pose(60)); await capture()
    const result = await page.evaluate(async (commands, fonts, logoPath) => {
      const width = 1600, height = 1120, scale = 1.6
      const logo = new Image(); await new Promise(resolve => { logo.onload = resolve; logo.onerror = resolve; logo.src = logoPath })
      const maskOf = select => {
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
        const context = canvas.getContext('2d'); context.scale(scale, scale)
        for (const command of commands) {
          if (!select(command)) continue
          if (command.kind === 'logo') context.drawImage(logo, command.x, command.y, command.width, command.height)
          else if (command.kind === 'rule') { context.lineWidth = command.stroke; if (command.height) context.strokeRect(command.x, command.y, command.width, command.height); else { context.beginPath(); context.moveTo(command.x, command.y); context.lineTo(command.x + command.width, command.y); context.stroke() } }
          else { context.font = `${command.font === 'italic' ? 'italic ' : ''}${command.weight} ${command.size}px "${fonts[command.font]}"`; context.textAlign = command.align === 'center' ? 'center' : command.align === 'right' ? 'right' : 'left'; context.fillText(command.text, command.x, command.y) }
        }
        const alpha = context.getImageData(0, 0, width, height).data, near = new Uint8Array(width * height), solid = new Uint8Array(width * height)
        for (let index = 0; index < width * height; index++) if (alpha[index * 4 + 3]) { solid[index] = alpha[index * 4 + 3] > 200 ? 1 : 0; const x = index % width, y = (index / width) | 0; for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && xx < width && yy >= 0 && yy < height) near[yy * width + xx] = 1 } }
        return { near, solid }
      }
      const foil = maskOf(command => command.finish.startsWith('foil')), ink = maskOf(command => !command.finish.startsWith('foil'))
      const [a, b, c] = window.__giftShots, lum = (shot, offset) => shot[offset] * .2126 + shot[offset + 1] * .7152 + shot[offset + 2] * .0722
      const change = new Float32Array(width * height), groups = { foil: [], ink: [], plastic: [] }
      const centroid = [0, 0, 0], weight = [0, 0, 0]
      // Stay clear of the rounded corners and the edge pixels, which the card shape itself trims.
      for (let y = 40; y < height - 40; y++) for (let x = 40; x < width - 40; x++) {
        const index = y * width + x, offset = index * 4, values = [lum(a, offset), lum(b, offset), lum(c, offset)], low = Math.min(...values)
        change[index] = Math.max(...values) - low
        if (foil.solid[index]) { groups.foil.push(change[index]); values.forEach((value, pose) => { centroid[pose] += x * (value - low); weight[pose] += value - low }) }
        else if (ink.solid[index] && !foil.near[index]) groups.ink.push(change[index])
        else if (!foil.near[index] && !ink.near[index]) groups.plastic.push(change[index])
      }
      const p90 = list => { const sorted = [...list].sort((x, y) => x - y); return sorted[Math.floor(sorted.length * .9)] ?? 0 }
      // Smoothness on bare plastic: neighbouring pixels 3 apart change by almost the same amount.
      let roughest = 0
      for (let y = 40; y < height - 40; y += 2) for (let x = 40; x < width - 43; x += 2) { const i = y * width + x, j = i + 3; if (!foil.near[i] && !ink.near[i] && !foil.near[j] && !ink.near[j]) roughest = Math.max(roughest, Math.abs(change[i] - change[j])) }
      return { foil: p90(groups.foil), ink: p90(groups.ink), plastic: p90(groups.plastic), roughest, centroids: centroid.map((sum, pose) => weight[pose] ? sum / weight[pose] / width : null) }
    }, front.commands, gift.GIFT_CARD_FONTS, '/invitations/logo-primary-ink.svg')
    console.log(`  yaw ${yaws.map(value => value.toFixed(1)).join(' → ')}°; 90th-percentile change: foil ${result.foil.toFixed(0)}, ink ${result.ink.toFixed(0)}, bare plastic ${result.plastic.toFixed(0)}; roughest step on bare plastic ${result.roughest.toFixed(1)}; highlight x ${result.centroids.map(value => value?.toFixed(3)).join(' → ')}`)
    assert(result.foil >= 2 * Math.max(result.ink, result.plastic, 1), 'The foil does not glint clearly more than the ink and the plastic')
    assert(result.roughest <= 6, 'The sheen on bare plastic has texture: something other than a smooth laminate is reflecting')
    const [left, middle, right] = result.centroids
    assert(left !== null && middle !== null && right !== null && (left - middle) * (middle - right) > 0, 'The highlight does not travel steadily with the turn')
  })

  await check('the page: no overflow at phone width, the card turns over, nothing is sold while the service is closed, and nothing reached the live service', async () => {
    await page.setViewport({ width: 320, height: 760 })
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 300)))
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Horizontal overflow at 320px')
    await page.click('.gift-object-actions button')
    await page.waitForFunction(() => document.querySelector('[data-gift-card]')?.dataset.giftShown === 'back', { timeout: 5000 })
    assert.equal(await page.$('.gift-form button[type=submit]'), null, 'No checkout while the gift service reports not ready')
    assert(await page.$eval('.gift-closed', element => element.textContent.includes('open soon')))
    assert(outside.every(url => url.endsWith('/api/gift/config')), `Unexpected outside requests: ${outside.join(', ')}`)
    assert.deepEqual(errors, [])
    await fs.mkdir('output/gift-card', { recursive: true })
    await page.screenshot({ path: 'output/gift-card/phone.png' })
  })
  console.log(`${passed} gift card checks passed.`)
} catch (error) {
  console.error(`✗ ${error.stack || error}`)
  process.exitCode = 1
} finally {
  await browser?.close(); await new Promise(resolve => server ? server.close(resolve) : resolve()); await rm(directory, { recursive: true, force: true })
}
