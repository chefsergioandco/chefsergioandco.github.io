// The approved micro symbol on a transparent canvas, in black or white for the browser theme.
// Generates an adaptive SVG, fixed-color SVG/PNG/ICO fallbacks and the separate touch icon.
import crypto from 'node:crypto'
import fs from 'node:fs'
import sharp from 'sharp'

const VERSION = 'faces-3'
const source = 'public/brand/logo-micro-ink.svg'
const original = fs.readFileSync(source, 'utf8')
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
if (sha(original) !== '52fbbead0a270e90b561a00b0f4cce664a2800fbc8e7514045a43dfe25aaf5fd') {
  throw new Error('Approved micro symbol changed; review its fit before regenerating icons')
}
const paths = [...original.matchAll(/<path\b[^>]*d="([^"]*)"/g)].map(match => match[1])
if (paths.length !== 2) throw new Error('Expected the two approved face outlines')

// Tight, centered square viewBox: maximum useful width without changing the approved proportions.
// There is no tab-icon background, border, stroke or tile; the glass is genuine transparent negative space.
function svg(size, mode = 'adaptive', touch = false) {
  const color = mode === 'dark' ? '#fff' : '#000'
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-3.2 -40.2 150.4 150.4" width="${size}" height="${size}" role="img" aria-label="Chef Sergio and Co.">
<title>Chef Sergio and Co.</title>
${touch ? '<rect x="-3.2" y="-40.2" width="150.4" height="150.4" fill="#fefefd"/>' : ''}
<style>path{fill:${color}}${mode === 'adaptive' ? '@media(prefers-color-scheme:dark){path{fill:#fff}}' : ''}</style>
${paths.map(path => `<path d="${path}"/>`).join('\n')}
</svg>
`
}

fs.writeFileSync('public/favicon.svg', svg(32))
fs.writeFileSync('public/favicon-light.svg', svg(32, 'light'))
fs.writeFileSync('public/favicon-dark.svg', svg(32, 'dark'))

const files = new Set(['favicon.svg', 'favicon-light.svg', 'favicon-dark.svg', 'apple-touch-icon.png'])
for (const mode of ['light', 'dark']) {
  const suffix = mode === 'dark' ? '-dark' : ''
  const pngs = []
  for (const size of [16, 32, 48]) {
    const bytes = await sharp(Buffer.from(svg(size, mode))).png().toBuffer()
    if (size !== 48) {
      const file = `favicon-${size}x${size}${suffix}.png`
      fs.writeFileSync(`public/${file}`, bytes)
      files.add(file)
    }
    pngs.push({ size, bytes })
  }
  // Each ICO contains native transparent 16/32/48px PNGs.
  const directory = Buffer.alloc(6 + 16 * pngs.length)
  directory.writeUInt16LE(1, 2)
  directory.writeUInt16LE(pngs.length, 4)
  let offset = directory.length
  pngs.forEach(({ size, bytes }, index) => {
    const entry = 6 + index * 16
    directory.writeUInt8(size, entry)
    directory.writeUInt8(size, entry + 1)
    directory.writeUInt16LE(1, entry + 4)
    directory.writeUInt16LE(32, entry + 6)
    directory.writeUInt32LE(bytes.length, entry + 8)
    directory.writeUInt32LE(offset, entry + 12)
    offset += bytes.length
  })
  const file = `favicon${suffix}.ico`
  fs.writeFileSync(`public/${file}`, Buffer.concat([directory, ...pngs.map(png => png.bytes)]))
  files.add(file)
}
// Installed Apple icons use an opaque surface; tab icons above are all transparent.
fs.writeFileSync('public/apple-touch-icon.png', await sharp(Buffer.from(svg(180, 'light', true))).png().toBuffer())

const manifestPath = 'content/brand-assets.json'
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
manifest.description = 'Original project vector logo selected for the site; favicon uses the approved micro faces/glass symbol with transparent black/light and white/dark treatments.'
manifest.icon_version = VERSION
manifest.icon_source = { file: source, sha256: sha(original), treatment: 'Unchanged outlines; tightly centered; transparent black on light and white on dark.' }
for (const file of files) {
  let asset = manifest.assets.find(asset => asset.file === file)
  if (!asset) { asset = { file, sha256: '', kind: 'derived-brand-icon' }; manifest.assets.push(asset) }
  asset.sha256 = sha(fs.readFileSync(`public/${file}`))
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
console.log(`Generated ${VERSION}: transparent adaptive/light/dark SVGs, native light/dark PNGs and ICOs, separate 180px touch icon. Approved logo outlines unchanged.`)
