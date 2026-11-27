// Renders every route to static HTML so the content exists without JavaScript (search engines, slow phones).
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ensureCards } from './og-cards.mjs'

// DIST_DIR / SSR_DIR let a check build a second copy (e.g. production mode) without touching dist/.
const dist = path.resolve(process.env.DIST_DIR || 'dist')
const clientHtml = fs.readFileSync(path.join(dist, 'index.html'), 'utf8')
const templateCache = path.join(dist, '.vite/prerender-template.json')
// Keep the client shell so a second prerender cannot use the already-rendered home page as every route's template.
let template
if (clientHtml.includes('<!--app-head-->') && clientHtml.includes('<!--app-html-->')) {
  template = clientHtml
  fs.mkdirSync(path.dirname(templateCache), { recursive: true })
  fs.writeFileSync(templateCache, JSON.stringify(template))
} else if (fs.existsSync(templateCache)) template = JSON.parse(fs.readFileSync(templateCache, 'utf8'))
else throw new Error('Client template missing. Run npm run build:client before prerendering.')
const { render, routes, redirects, caseRedirects, IS_PROTOTYPE, site } = await import(pathToFileURL(path.resolve(process.env.SSR_DIR || 'dist-ssr', 'entry-server.js')).href)
const base = process.env.BASE_PATH || '/'

const LOOK = process.env.LOOK || 'c'
const iconHead = [
  `<link rel="icon" data-favicon="ico" href="${base}favicon.ico?v=faces-3" sizes="16x16 32x32 48x48">`,
  `<link rel="icon" data-favicon="32" type="image/png" href="${base}favicon-32x32.png?v=faces-3" sizes="32x32">`,
  `<link rel="icon" data-favicon="16" type="image/png" href="${base}favicon-16x16.png?v=faces-3" sizes="16x16">`,
  `<link rel="icon" data-favicon="svg" type="image/svg+xml" href="${base}favicon.svg?v=faces-3" sizes="any">`,
  `<link rel="apple-touch-icon" href="${base}apple-touch-icon.png?v=faces-3" sizes="180x180">`,
  `<script src="${base}favicon-theme.js?v=faces-3"></script>`,
].join('\n')

// Preload the fonts the shipped look renders above the fold, so text doesn't reflow when they arrive (layout shift).
const assets = fs.readdirSync(path.join(dist, 'assets'))
const manifest = JSON.parse(fs.readFileSync(path.join(dist, '.vite/manifest.json'), 'utf8'))
// Discover only the homepage's hydration graph in the HTML. Otherwise the route and its static imports
// wait for the entry script before they can compete with below-the-fold lazy images for a connection.
function homeModulePreloads() {
  const seen = new Set()
  const files = new Set()
  const visit = (key) => {
    if (seen.has(key)) return
    seen.add(key)
    const chunk = manifest[key]
    if (!chunk) throw new Error(`Homepage preload chunk missing from Vite manifest: ${key}`)
    for (const dependency of chunk.imports ?? []) visit(dependency)
    if (chunk.file.endsWith('.js') && !template.includes(`src="${base}${chunk.file}"`)) files.add(chunk.file)
  }
  visit('src/pages/Home.tsx')
  return [...files].map((file) => `<link rel="modulepreload" crossorigin href="${base}${file}">`).join('\n    ')
}
const homePreloads = homeModulePreloads()
// Account CSS stays outside the anonymous homepage graph but is present before
// first paint on direct static account/newsletter routes, including without JS.
function routeStyleLinks(route) {
  const key = route.startsWith('/invitation/') ? 'src/invitations/InvitationPage.tsx'
    : route === '/status/' ? 'src/pages/ServiceStatus.tsx'
    : route === '/privacy/' || route === '/terms/' ? 'src/pages/Legal.tsx'
    : route === '/gift/' ? 'src/gift/GiftPage.tsx'
    : route.startsWith('/gift/') ? 'src/gift/GiftCardPage.tsx'
    : route.startsWith('/newsletter/') ? 'src/components/NewsletterTokenPage.tsx'
    : route === '/dashboard/' ? 'src/account/CustomerDashboard.tsx'
    : route === '/admin/' ? 'src/account/AdminPage.tsx'
    : route === '/receipt/' ? 'src/account/ReceiptPage.tsx'
    : route.startsWith('/account/') || route.startsWith('/auth/') ? 'src/account/AccountPages.tsx' : null
  if (!key) return ''
  const seen = new Set(), files = new Set()
  const visit = name => {
    if (seen.has(name)) return
    seen.add(name)
    const item = manifest[name]
    if (!item) return
    for (const file of item.css || []) if (!template.includes(`href="${base}${file}"`)) files.add(file)
    for (const dependency of item.imports || []) visit(dependency)
  }
  visit(key)
  return [...files].map(file => `<link rel="stylesheet" crossorigin href="${base}${file}">`).join('\n    ')
}


// Next page (src/next-page/): what each page needs to open instantly, so it can be loaded before the visitor asks
// for it. Only these public pages are ever loaded ahead: account, sign-in/out, receipt, invitation and checkout pages
// must run only when a person opens them.
const AHEAD = new Set(['/', '/privatedining/', '/cookingclasses/', '/catering/', '/about/', '/book/', '/gift/', '/sergios-table/', '/shot-list/'])
const entrySource = fs.readFileSync(path.resolve('src/entry-client.tsx'), 'utf8')
const pageModules = Object.fromEntries([...entrySource.matchAll(/'(\/[^']*)':\s*\(\)\s*=>\s*import\('\.\/([^']+)'\)/g)].map(([, route, file]) => [route, file]))
function pageChunks(route) {
  const file = pageModules[route]
  if (!file) throw new Error(`next-page: no page module for ${route} in src/entry-client.tsx`)
  // A page module also imported statically elsewhere becomes a shared chunk, listed under its chunk name.
  const key = [`src/${file}.tsx`, `src/${file}.ts`].find((k) => manifest[k]) ?? Object.keys(manifest).find((k) => manifest[k].isDynamicEntry && manifest[k].name === path.basename(file))
  if (!key) throw new Error(`next-page: ${file} is missing from the Vite manifest`)
  const files = [], styles = new Set()
  const seen = new Set(['index.html']) // the entry is already running on every page
  const visit = (k) => {
    if (seen.has(k)) return
    seen.add(k)
    for (const dependency of manifest[k].imports ?? []) visit(dependency)
    if (manifest[k].file.endsWith('.js')) files.push(manifest[k].file)
    for (const css of manifest[k].css ?? []) styles.add(css)
  }
  visit(key)
  return { m: files, ...(styles.size ? { c: [...styles] } : {}) }
}
const unescapeAttribute = (s) => s?.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
const preloads = [/^eb-garamond-core-wght-.*\.woff2$/, /^archivo-core-wght-.*\.woff2$/]
  .map((re) => assets.find((a) => re.test(a)))
  .filter(Boolean)
  .map((f) => `<link rel="preload" href="${base}assets/${f}" as="font" type="font/woff2" crossorigin>`)
  .join('\n    ')
// Runs before first paint: marks JS as available (for CSS-only entrances) and, in the all-looks prototype,
// applies ?look= or the remembered look so there is no flash of the wrong look.
const bootScript = `<script>document.documentElement.classList.add('js');${
  LOOK === 'all'
    ? `try{var q=new URLSearchParams(location.search).get('look'),l=q||localStorage.getItem('look');if(l&&/^[abc]$/.test(l)){document.documentElement.setAttribute('data-look',l);if(q)localStorage.setItem('look',q)}}catch(e){}`
    : ''
}</script>`

// Share cards: re-rendered only when their words, the logo or the fonts change (see og-cards.mjs).
const arrivalBootScript = `<script>(function(){try{var n=performance.getEntriesByType('navigation')[0],s=sessionStorage.getItem('sergio.home-arrival.v1'),i=document.referrer&&new URL(document.referrer).origin===location.origin;if(!matchMedia('(prefers-reduced-motion: reduce)').matches&&s!=='settled'&&!location.hash&&!i&&(!n||n.type!=='reload'&&n.type!=='back_forward')&&innerHeight>=440){document.documentElement.dataset.homeArrivalBoot='pending';setTimeout(function(){if(document.documentElement.dataset.homeArrivalBoot==='pending')document.documentElement.dataset.homeArrivalBoot='expired'},1800)}}catch(e){}})()</script>`

const shareImages = await ensureCards(routes, { distDir: dist })
// Absolute URL for og:url/og:image. A prototype preview can set PUBLIC_URL (e.g. https://name.github.io/repo) so its
// shared links show cards; production always uses the real domain.
const publicUrl = (IS_PROTOTYPE && process.env.PUBLIC_URL?.replace(/\/$/, '')) || site.url

const rendered = routes.map((r) => {
  const { html, head } = render(r.path, { image: shareImages[r.path], publicUrl })
  // Discover service-page priority images before font downloads as well.
  const heroPhoto = html.match(/<img\b(?=[^>]*fetchpriority="high")(?=[^>]*data-reference=)[^>]*>/)?.[0]
  const imageAttribute = (name) => heroPhoto?.match(new RegExp(`\\b${name}="([^"]*)"`, 'i'))?.[1]
  // The photograph the page opens with (usually its largest paint): the priority hero, else the first eager image.
  const lead = heroPhoto ?? html.slice(html.indexOf('id="main"')).match(/<img\b(?=[^>]*(?:fetchpriority="high"|loading="eager"))[^>]*>/)?.[0]
  const leadImage = lead && ['src', 'srcset', 'sizes'].map((name) => unescapeAttribute(lead.match(new RegExp(`\\b${name}="([^"]*)"`, 'i'))?.[1]) ?? '')
  return { r, html, head, heroPhoto, imageAttribute, leadImage }
})

const nextPageHints = Object.fromEntries(
  rendered
    .filter(({ r }) => AHEAD.has(r.path))
    .map(({ r, leadImage }) => [r.path, { ...pageChunks(r.path), ...(leadImage ? { i: leadImage } : {}) }]),
)
// Internal links are followed in the page (src/entry-client.tsx keeps the account session in memory), so there are
// no document Speculation Rules: a prefetched or prerendered document would never be used. next-page/ loads the
// next page's code, styles and lead photo instead. Automated browsers (navigator.webdriver) are left alone.
const json = (value) => JSON.stringify(value).replace(/</g, '\\u003c')
const nextPageHead = `<script type="application/json" id="next-page-hints">${json(nextPageHints)}</script>`

for (const { r, html, head, heroPhoto, imageAttribute } of rendered) {
  // Discover the responsive hero image ahead of module preloads so hydration never queues it behind scripts.
  const imagePreload = heroPhoto
    ? `<link rel="preload" as="image" href="${imageAttribute('src')}" imagesrcset="${imageAttribute('srcset')}" imagesizes="${imageAttribute('sizes')}" fetchpriority="high">`
    : ''
  const page = template
    .replace('<html lang="en">', `<html lang="en" data-look="${LOOK === 'all' ? 'c' : LOOK}">`)
    .replace('<!--app-head-->', `${bootScript}\n    ${r.path === '/' ? arrivalBootScript : ''}\n    ${imagePreload}\n    ${preloads}\n    ${r.path === '/' ? homePreloads : ''}\n    ${routeStyleLinks(r.path)}\n    ${head}\n    ${r.path.startsWith('/invitation/') ? '' : nextPageHead}`)
    .replace('<div id="root"><!--app-html--></div>', `<div id="root" data-route="${r.path}">${html}</div>`)
  const out = path.join(dist, r.path, 'index.html')
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, page)
  console.log('prerendered', r.path, `${(page.length / 1024).toFixed(1)} KB`)
}

// Redirect stubs for old Wix URLs (no JS needed). Google treats an instant meta refresh as a permanent redirect.
const writeStub = (from, to) => {
  const target = base + to.replace(/^\//, '')
  const stub = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Moved</title><meta name="robots" content="noindex">${iconHead}<link rel="canonical" href="${site.url}${to}"><meta http-equiv="refresh" content="0; url=${target}"></head><body><p>This page moved to <a href="${target}">${target}</a>.</p></body></html>`
  const out = path.join(dist, from, 'index.html')
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, stub)
}
for (const [from, to] of Object.entries(redirects)) writeStub(from, to)
// Mis-cased old URLs need their own folder (/About/ next to /about/), which only a case-sensitive filesystem can hold.
// The deploy builds on Linux, so the live site gets them; a macOS build skips them and 404.html's script covers browsers.
const probe = path.join(dist, '.case-probe')
fs.writeFileSync(probe, '')
const caseSensitive = !fs.existsSync(path.join(dist, '.CASE-PROBE'))
fs.rmSync(probe)
if (caseSensitive) for (const [from, to] of Object.entries(caseRedirects)) writeStub(from, to)

// 404: first try a lowercase / trailing-slash version of the URL (old Wix links like /About), then show a branded fallback.
const known = JSON.stringify(routes.map((r) => r.path))
fs.writeFileSync(
  path.join(dist, '404.html'),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Page not found | ${site.name}</title>${iconHead}<meta name="robots" content="noindex"><meta name="color-scheme" content="light dark"><script src="${base}theme-init.js?v=1"></script><style>a{color:#8E352F}.logo-reverse{display:none}@media screen and (prefers-color-scheme:dark){html:not([data-theme=light]) body{background:#191714!important;color:#EDE7DC!important}html:not([data-theme=light]) a{color:#DE7F72}html:not([data-theme=light]) .logo-ink{display:none}html:not([data-theme=light]) .logo-reverse{display:inline}}@media screen{html[data-theme=dark] body{background:#191714!important;color:#EDE7DC!important}html[data-theme=dark] a{color:#DE7F72}html[data-theme=dark] .logo-ink{display:none}html[data-theme=dark] .logo-reverse{display:inline}}</style><script>(function(){var b=${JSON.stringify(base)},k=${known},p=location.pathname.slice(b.length-1).toLowerCase().replace(/\\/?$/,'/');if(k.indexOf(p)>-1&&p!==location.pathname.slice(b.length-1))location.replace(b+p.slice(1)+location.search+location.hash)})()</script></head><body style="font-family:system-ui;max-width:36rem;margin:4rem auto;padding:0 1rem;background:#FCFAF5;color:#2D2B27"><a href="${base}" aria-label="Chef Sergio and Company, home"><img class="logo-ink" src="${base}brand/logo-primary-ink.svg?v=salon-1" alt="" width="426" height="65" style="width:280px;max-width:100%;height:auto;margin-bottom:3rem"><img class="logo-reverse" src="${base}brand/logo-primary-reverse.svg?v=salon-1" alt="" width="426" height="65" style="width:280px;max-width:100%;height:auto;margin-bottom:3rem"></a><h1>That page doesn't exist</h1><p>Try the <a href="${base}">home page</a>, or <a href="${base}book/">check your date</a> with Chef Sergio.</p></body></html>`,
)

// robots.txt only controls crawling; noindex controls indexing, and a crawler can only see noindex on a page it's
// allowed to fetch. So the prototype allows crawling (every page carries noindex) and blocks only the watermarked
// reference photos, which can't carry a meta tag. Production allows everything, AI assistants' crawlers included:
// being the answer when someone asks an assistant for a private chef in Orlando is worth more than hiding from it.
fs.writeFileSync(
  path.join(dist, 'robots.txt'),
  IS_PROTOTYPE
    ? `# Prototype: every page is noindex. Reference photos are third-party and watermarked.\nUser-agent: *\nDisallow: ${base}reference/\n`
    : `User-agent: *\nAllow: /\n\nSitemap: ${site.url}/sitemap.xml\n`,
)
// The sitemap lists exactly the indexable, canonical URLs. No <lastmod>: Google only trusts it when it's accurate,
// and nothing here records when a page's content last changed. A prototype has no indexable pages, so no sitemap.
const indexable = routes.filter((r) => !r.noindex)
fs.rmSync(path.join(dist, 'sitemap.xml'), { force: true })
if (!IS_PROTOTYPE)
  fs.writeFileSync(
    path.join(dist, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${indexable.map((r) => `  <url><loc>${site.url}${r.path}</loc></url>`).join('\n')}\n</urlset>\n`,
  )
fs.writeFileSync(path.join(dist, '.nojekyll'), '')
// No CNAME: the site's address is always https://chefsergioandco.github.io. A custom domain is a separate, deliberate change.
if (!IS_PROTOTYPE) fs.rmSync(path.join(dist, 'reference'), { recursive: true, force: true })
console.log(`mode=${IS_PROTOTYPE ? 'prototype' : 'production'} look=${LOOK} routes=${routes.length} redirects=${Object.keys(redirects).length}${caseSensitive ? ` case-redirects=${Object.keys(caseRedirects).length}` : ' (case redirects skipped: case-insensitive filesystem)'} share-url=${publicUrl}`)
