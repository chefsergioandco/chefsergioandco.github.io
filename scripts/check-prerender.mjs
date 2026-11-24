// Passes only if every route's static HTML (no JavaScript) already contains its real H1, the booking CTA,
// a title/description, and the menu items for pages that show the menu.
import fs from 'node:fs'
import path from 'node:path'
import { DIST, loadRoutes, report, textOf } from './lib.mjs'

const { routes } = await loadRoutes()
const menu = JSON.parse(fs.readFileSync('content/menu.source.json', 'utf8')).named.map((d) => d.name)
const failures = []
const notes = []
const clientEntry = fs.readFileSync('src/entry-client.tsx', 'utf8')
const hydratedPaths = new Set(Array.from(clientEntry.matchAll(/['"](\/[^'"]*)['"]\s*:\s*\(\)\s*=>/g), match => match[1]))
for (const r of routes) {
  if (!hydratedPaths.has(r.path)) failures.push(`${r.path}: missing browser route registration; the page cannot load live content or handle input`)
  const file = path.join(DIST, r.path, 'index.html')
  if (!fs.existsSync(file)) {
    failures.push(`${r.path}: missing ${file}`)
    continue
  }
  const html = fs.readFileSync(file, 'utf8')
  const text = textOf(html)
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)
  if (!h1 || textOf(h1[1]) !== r.h1) failures.push(`${r.path}: expected <h1> "${r.h1}", found "${h1 ? textOf(h1[1]) : 'none'}"`)
  if (!/<title>[^<]{10,}<\/title>/.test(html)) failures.push(`${r.path}: no <title>`)
  if (!/<meta name="description" content="[^"]{50,}"/.test(html)) failures.push(`${r.path}: description missing or under 50 chars`)
  const bookingHref = `${process.env.BASE_PATH || '/'}book/`
  if (r.bookingLinkRequired !== false && r.path !== '/book/' && r.path !== '/shot-list/' && !html.includes(`href="${bookingHref}`)) failures.push(`${r.path}: no booking link in static HTML`)
  if (html.includes('data-menu-item')) {
    const missing = menu.filter((m) => !text.includes(m))
    if (missing.length) failures.push(`${r.path}: menu items missing from static HTML: ${missing.join(', ')}`)
  }
  notes.push(`${r.path.padEnd(18)} h1 ok · ${text.split(' ').length} words without JS`)
}
report('prerender: every route has its content without JavaScript', failures, notes)
