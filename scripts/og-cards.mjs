// Share cards (og:image): one 1200×630 card per indexable page, set in the site's own type, colors and logo.
// No generated imagery and no reference photos: a share card travels beyond the site, so until Sergio's own
// photographs exist the card is typographic. Give a route `og.photo` (a file in public/ listed in
// content/photos.owned.json) and its card puts that photo in the arch instead of the mark.
//
// Cards are cached in public/og/ (committed) with a hash of everything that draws them. prerender.mjs calls
// ensureCards() on every build: fresh cards are reused, stale ones are re-rendered with headless Chrome
// (set CHROME_PATH if it isn't in the usual place). `npm run og` re-renders all of them.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const CARD = { width: 1200, height: 630, maxBytes: 300 * 1024 } // WhatsApp drops preview images over ~300 KB
export const LINE = 'Private chef in Orlando and Central Florida'
const OG_DIR = path.resolve('public/og')
const MANIFEST = path.join(OG_DIR, 'manifest.json')
const SELF = fs.readFileSync(fileURLToPath(import.meta.url))
const read = (p) => fs.readFileSync(path.resolve(p))
const FONTS = { garamond: 'src/fonts/eb-garamond-core-wght.woff2', archivo: 'src/fonts/archivo-core-wght.woff2' }
const LOGOS = { primary: 'public/brand/logo-primary-ink.svg', mark: 'public/brand/logo-symbol-reverse.svg' }

export const slugOf = (routePath) => (routePath === '/' ? 'home' : routePath.replace(/^\/|\/$/g, '').replace(/\//g, '-'))
/** The words on a route's card: its own share line if it has one, otherwise its H1. */
export const cardText = (r) => (r.og?.card ?? r.h1).replace(/'/g, '\u2019')
/** Pages that get their own card. Noindex pages (booking status, prototype tools) share the home card. */
export const cardRoutes = (routes) => routes.filter((r) => !r.noindex)

function hashFor(r) {
  const h = crypto.createHash('sha256').update(SELF).update(JSON.stringify({ text: cardText(r), line: LINE, photo: r.og?.photo ?? null }))
  for (const f of [...Object.values(FONTS), ...Object.values(LOGOS)]) h.update(read(f))
  if (r.og?.photo) h.update(read(path.join('public', r.og.photo)))
  return h.digest('hex').slice(0, 12)
}

const svg = (p) => read(p).toString('utf8').replace(/<\?xml[^>]*>/, '').replace(/<title>[\s\S]*?<\/title>/, '')
const font = (p) => `url(data:font/woff2;base64,${read(p).toString('base64')}) format('woff2')`

function cardHtml(r) {
  const photo = r.og?.photo ? `<img src="data:image/${path.extname(r.og.photo).slice(1).replace('jpg', 'jpeg')};base64,${read(path.join('public', r.og.photo)).toString('base64')}" alt="">` : svg(LOGOS.mark)
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:'EB Garamond';src:${font(FONTS.garamond)};font-weight:400 800}
@font-face{font-family:'Archivo';src:${font(FONTS.archivo)};font-weight:100 900}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${CARD.width}px;height:${CARD.height}px;overflow:hidden;background:#fefefd;color:#2D2B27}
.logo{position:absolute;left:72px;top:64px;width:320px}
.logo svg{display:block;width:100%;height:auto}
.copy{position:absolute;left:72px;top:156px;bottom:128px;width:628px;display:flex;align-items:center}
h1{font-family:'EB Garamond',serif;font-weight:500;letter-spacing:-.005em;line-height:1.04;text-wrap:balance}
.line{position:absolute;left:72px;bottom:60px;font-family:'Archivo',sans-serif;font-weight:400;font-size:30px;line-height:36px;letter-spacing:.01em}
.arch{position:absolute;left:784px;top:64px;right:64px;bottom:0;border-radius:176px 176px 0 0;background:#8E352F;overflow:hidden;display:grid;place-items:center}
.arch svg{width:216px;height:auto}
.arch img{width:100%;height:100%;object-fit:cover}
</style></head><body>
<div class="logo">${svg(LOGOS.primary)}</div>
<div class="copy"><h1 id="h">${cardText(r).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</h1></div>
<p class="line">${LINE}</p>
<div class="arch">${photo}</div>
</body></html>`
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean)
  return candidates.find((p) => fs.existsSync(p))
}

/** Headline sizes tried in order: the largest that fits the copy box without overflow wins. */
const SIZES = [96, 92, 88, 84, 80, 76, 72, 68, 64]

async function render(stale) {
  const executablePath = findChrome()
  if (!executablePath) throw new Error(`Share cards need re-rendering (${stale.map((r) => r.path).join(', ')}) but Chrome wasn't found. Set CHROME_PATH, or run npm run og on a machine with Chrome and commit public/og/.`)
  const { default: puppeteer } = await import('puppeteer-core')
  const sharp = (await import('sharp')).default
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--font-render-hinting=none'] })
  const out = {}
  try {
    for (const r of stale) {
      const page = await browser.newPage()
      await page.setViewport({ width: CARD.width, height: CARD.height, deviceScaleFactor: 1 })
      await page.setContent(cardHtml(r), { waitUntil: 'load' })
      await page.evaluate(() => document.fonts.ready)
      const size = await page.evaluate((sizes) => {
        const h = document.getElementById('h')
        const box = h.parentElement
        for (const s of sizes) {
          h.style.fontSize = `${s}px`
          if (h.scrollHeight <= box.clientHeight && h.scrollWidth <= box.clientWidth) return s
        }
        return null
      }, SIZES)
      if (!size) throw new Error(`${r.path}: "${cardText(r)}" doesn't fit the share card even at ${SIZES.at(-1)}px. Give the route a shorter og.card.`)
      const png = await page.screenshot({ type: 'png' })
      await page.close()
      const file = r.og?.photo ? `${slugOf(r.path)}.jpg` : `${slugOf(r.path)}.png`
      // Flat type on flat color compresses best as a palette PNG; a photo goes out as JPEG.
      const buf = r.og?.photo
        ? await sharp(png).jpeg({ quality: 84, mozjpeg: true }).toBuffer()
        : await sharp(png).png({ palette: true, colors: 96, compressionLevel: 9, effort: 10 }).toBuffer()
      fs.writeFileSync(path.join(OG_DIR, file), buf)
      out[r.path] = { file, size, bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') }
      console.log(`  share card ${r.path} → public/og/${file} (${(buf.length / 1024).toFixed(0)} KB, headline ${size}px)`)
    }
  } finally {
    await browser.close()
  }
  return out
}

/**
 * Makes sure every indexable route has a current card in public/og/, copies the cards into distDir/og/,
 * and returns { [routePath]: { url path, width, height, type, alt } } for the head tags.
 */
export async function ensureCards(routes, { distDir, force = false } = {}) {
  fs.mkdirSync(OG_DIR, { recursive: true })
  const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : {}
  const wanted = cardRoutes(routes)
  const stale = wanted.filter((r) => force || manifest[r.path]?.hash !== hashFor(r) || !fs.existsSync(path.join(OG_DIR, manifest[r.path].file)))
  if (stale.length) {
    const rendered = await render(stale)
    for (const r of stale) manifest[r.path] = { ...rendered[r.path], hash: hashFor(r), text: cardText(r), photo: r.og?.photo ?? null }
  }
  // Drop cards for routes that no longer exist.
  for (const p of Object.keys(manifest)) {
    if (!wanted.some((r) => r.path === p)) {
      fs.rmSync(path.join(OG_DIR, manifest[p].file), { force: true })
      delete manifest[p]
    }
  }
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n')
  if (distDir) {
    fs.mkdirSync(path.join(distDir, 'og'), { recursive: true })
    for (const f of fs.readdirSync(OG_DIR)) fs.copyFileSync(path.join(OG_DIR, f), path.join(distDir, 'og', f))
  }
  const home = manifest['/']
  const meta = (m, r) => ({
    path: `og/${m.file}?v=${m.hash.slice(0, 8)}`,
    width: CARD.width,
    height: CARD.height,
    type: m.file.endsWith('.jpg') ? 'image/jpeg' : 'image/png',
    alt: `${cardText(r).replace(/[^.?!]$/, '$&.')} Chef Sergio & Co., ${LINE.charAt(0).toLowerCase()}${LINE.slice(1)}.`,
  })
  const homeRoute = routes.find((r) => r.path === '/')
  return Object.fromEntries(routes.map((r) => [r.path, manifest[r.path] ? meta(manifest[r.path], r) : meta(home, homeRoute)]))
}

// npm run og: re-render every card from the current SSR build.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { pathToFileURL } = await import('node:url')
  const { routes } = await import(pathToFileURL(path.resolve(process.env.SSR_DIR || 'dist-ssr', 'entry-server.js')).href)
  await ensureCards(routes, { force: process.argv.includes('--force') })
}
