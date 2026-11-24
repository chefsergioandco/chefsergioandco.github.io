// Image guard.
// 1. No image in the build may carry a generative-AI content credential (C2PA "trainedAlgorithmicMedia").
// 2. Every reference image must match its generated pixels and have a license entry.
//    Watermarking is the default; an explicitly captioned slot also requires a visible adjacent disclosure and credit.
// 3. Other photographs must be listed as Sergio's own in content/photos.owned.json.
//    Original brand artwork/icons have a separate, exact-byte manifest.
//    Authored Blender animation renders have exact-byte AND source-code hashes.
//    One separately registered user-supplied portrait is preview-only, never verified/owned photography.
// 4. Production builds may not contain or reference any reference image.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { decode, DIST, PROD, report, textOf, walk } from './lib.mjs'

const credits = JSON.parse(fs.readFileSync('src/content/reference-credits.json', 'utf8'))
const selection = JSON.parse(fs.readFileSync('reference/selection.json', 'utf8'))
const owned = fs.existsSync('content/photos.owned.json') ? JSON.parse(fs.readFileSync('content/photos.owned.json', 'utf8')) : []
const placeholder = fs.existsSync('content/photos.placeholders.json') ? JSON.parse(fs.readFileSync('content/photos.placeholders.json', 'utf8')) : null
const placeholderAssets = Array.isArray(placeholder?.assets) ? placeholder.assets : []
const placeholderByPath = new Map()
const brand = fs.existsSync('content/brand-assets.json') ? JSON.parse(fs.readFileSync('content/brand-assets.json', 'utf8')).assets : []
const brandByPath = new Map(brand.map(asset => [asset.file, asset]))
const art = fs.existsSync('content/art.source.json') ? JSON.parse(fs.readFileSync('content/art.source.json', 'utf8')) : null
const artSources = Array.isArray(art?.sources) ? art.sources : []
const artAssets = Array.isArray(art?.assets) ? art.assets : []
const artByPath = new Map()
const bySha = new Map()
for (const [slot, c] of Object.entries(credits)) for (const f of c.files) bySha.set(f.file, { slot, sha: f.sha256, c })

const failures = []
const notes = []
if (placeholder) {
  // This exception is only the three registered portrait derivatives. The source
  // HEIC need not be distributed, and this manifest never establishes ownership.
  const validProvenance = placeholder.kind === 'user-supplied-placeholder' &&
    typeof placeholder.provenance === 'string' && /supplied by the user/i.test(placeholder.provenance) && /unverified/i.test(placeholder.provenance)
  if (!validProvenance || placeholderAssets.length !== 3) failures.push('content/photos.placeholders.json: expected the separately registered, unverified user-supplied preview portrait')
  const seen = new Set()
  for (const asset of placeholderAssets) {
    const expected = /^placeholders\/sergio-portrait-(480|800|1072)\.webp$/.exec(asset?.file ?? '')
    if (!validProvenance || !expected || seen.has(asset.file) || !/^[a-f0-9]{64}$/.test(asset.sha256 ?? '') || asset.width !== Number(expected[1]) || !Number.isInteger(asset.height) || asset.height < 1) {
      failures.push(`${asset?.file ?? 'unknown placeholder'}: invalid or duplicated preview portrait path/hash`)
      continue
    }
    seen.add(asset.file)
    const file = path.join(DIST, asset.file)
    if (!fs.existsSync(file)) failures.push(`${asset.file}: registered preview portrait is missing from build`)
    else if (crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== asset.sha256) failures.push(`${asset.file}: bytes differ from the user-supplied placeholder manifest`)
    else placeholderByPath.set(asset.file, asset)
  }
}
if (art) {
  const filmPipeline = art.pipeline === 'conservative-viscous-film'
  const knownPipeline = art.pipeline === undefined || filmPipeline
  const requiredSources = new Set([
    'scripts/blender/create_plating_scene.py',
    'scripts/blender/plating_spoon.py',
    'scripts/blender/plating_fluid.py',
    'scripts/blender/plating_materials.py',
    'scripts/blender/plating_engraving.py',
    'scripts/blender/plating_reservoir.py',
    'scripts/blender/plating_external.py',
    ...(filmPipeline ? [
      'scripts/blender/plating_thinfilm.py',
      'scripts/blender/plating_thinfilm_solver.cpp',
      'scripts/blender/prepare_plating_performance.py',
      'scripts/blender/plating_surface.py',
      'scripts/blender/render_thinfilm_sequence.py',
    ] : [
      'scripts/blender/render_plating_sequence.py',
      'scripts/blender/plating_surface.py',
    ]),
  ])
  let sourcesValid = knownPipeline && art.kind === 'authored-3d-render' && Array.isArray(art.sources) && Array.isArray(art.assets)
  if (!knownPipeline) failures.push(`content/art.source.json: unknown authored-art pipeline ${String(art.pipeline)}`)
  if (!sourcesValid) failures.push('content/art.source.json: expected an authored-3d-render manifest with sources and assets')
  const seenSources = new Set()
  for (const source of artSources) {
    if (!requiredSources.has(source?.path) || seenSources.has(source?.path) || !/^[a-f0-9]{64}$/.test(source?.sha256 ?? '')) {
      sourcesValid = false
      failures.push(`${source?.path ?? 'unknown source'}: invalid or duplicated authored-art source entry`)
      continue
    }
    seenSources.add(source.path)
    if (!fs.existsSync(source.path) || !fs.statSync(source.path).isFile()) {
      sourcesValid = false
      failures.push(`${source.path}: authored-art source is missing`)
    } else if (crypto.createHash('sha256').update(fs.readFileSync(source.path)).digest('hex') !== source.sha256) {
      sourcesValid = false
      failures.push(`${source.path}: source differs from the packaged authored render; render/package the matching scene`)
    }
  }
  for (const source of requiredSources) if (!seenSources.has(source)) {
    sourcesValid = false
    failures.push(`${source}: required authored-art source hash is missing`)
  }
  const seenAssets = new Set()
  for (const asset of artAssets) {
    // This is a narrow exception for the rendered spoon animation. It cannot
    // authorize reference photographs, arbitrary media, or unrelated paths.
    if (!/^art\/plating\/(?:(?:desktop|mobile)\/\d{4,}\.webp|poster-(?:1920|1280|640)\.webp)$/.test(asset?.file ?? '') ||
        seenAssets.has(asset?.file) || !/^[a-f0-9]{64}$/.test(asset?.sha256 ?? '')) {
      failures.push(`${asset?.file ?? 'unknown asset'}: invalid or duplicated authored-art asset path/hash`)
      continue
    }
    seenAssets.add(asset.file)
    const file = path.join(DIST, asset.file)
    if (!fs.existsSync(file)) failures.push(`${asset.file}: packaged authored render is missing from build`)
    else if (crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== asset.sha256) failures.push(`${asset.file}: bytes differ from the authored-art manifest`)
    else if (sourcesValid) artByPath.set(asset.file, asset)
  }
}
for (const asset of brand) {
  // Keep this exception restricted to the actual brand family, never arbitrary photographs.
  if (!/^(?:brand\/logo-(?:primary|compact|symbol|micro)-(?:ink|reverse)\.svg|favicon(?:-(?:light|dark))?\.svg|favicon(?:-dark)?\.ico|favicon-(?:16x16|32x32)(?:-dark)?\.png|apple-touch-icon\.png)$/.test(asset.file)) {
    failures.push(`${asset.file}: unsupported first-party brand asset path`)
    continue
  }
  const file = path.join(DIST, asset.file)
  if (!fs.existsSync(file)) failures.push(`${asset.file}: approved brand asset missing from build`)
  else if (crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== asset.sha256) failures.push(`${asset.file}: bytes differ from the approved brand manifest`)
}
const images = walk(DIST).filter((f) => /\.(jpe?g|png|webp|avif|gif)$/i.test(f))
let refCount = 0
let captionedCount = 0
let artCount = 0
let shareCount = 0
let placeholderCount = 0
const shareCards = fs.existsSync('public/og/manifest.json') ? JSON.parse(fs.readFileSync('public/og/manifest.json', 'utf8')) : {}
for (const f of images) {
  const rel = path.relative(DIST, f).split(path.sep).join('/')
  const bytes = fs.readFileSync(f)
  if (/trainedAlgorithmicMedia|compositeWithTrainedAlgorithmicMedia/.test(bytes.toString('latin1'))) failures.push(`${rel}: carries a generative-AI content credential`)
  if (rel.startsWith('reference/')) {
    refCount++
    if (PROD) {
      failures.push(`${rel}: reference image in a production build`)
      continue
    }
    const entry = bySha.get(rel)
    if (!entry) {
      failures.push(`${rel}: not produced by scripts/watermark.mjs (no credit entry)`)
      continue
    }
    const sha = crypto.createHash('sha256').update(await sharp(bytes).raw().toBuffer()).digest('hex')
    if (sha !== entry.sha) failures.push(`${rel}: pixels differ from the generated reference output (replaced or edited?)`)
    for (const k of ['license', 'landing', 'provider']) if (!entry.c[k]) failures.push(`${rel}: credit missing ${k}`)
    const treatment = entry.c.treatment ?? 'watermarked'
    if (treatment !== (selection[entry.slot]?.treatment ?? 'watermarked')) failures.push(`${rel}: treatment does not match the explicit selection`)
    if (!['watermarked', 'captioned'].includes(treatment)) failures.push(`${rel}: unknown reference treatment ${treatment}`)
    if (treatment === 'captioned') {
      captionedCount++
      for (const k of ['creator', 'license_url', 'src', 'source_sha256', 'provenance']) if (!entry.c[k]) failures.push(`${rel}: captioned reference missing ${k}`)
    }
  } else if (rel.startsWith('og/')) {
    // Share cards: exactly the bytes scripts/og-cards.mjs rendered (type + brand logo), or a card built
    // around one of Sergio's own photos. Anything else dropped into og/ fails here.
    const card = Object.values(shareCards).find((c) => `og/${c.file}` === rel)
    if (!card) failures.push(`${rel}: not a share card in public/og/manifest.json`)
    else if (crypto.createHash('sha256').update(bytes).digest('hex') !== card.sha256) failures.push(`${rel}: bytes differ from the rendered share card (run npm run og)`)
    else if (card.file.endsWith('.jpg') && !(card.photo && owned.includes(card.photo))) failures.push(`${rel}: photo share card without an owned photo`)
    else shareCount++
  } else if (rel.startsWith('art/plating/')) {
    if (!artByPath.has(rel)) failures.push(`${rel}: not a verified authored Blender render in content/art.source.json`)
    else artCount++
  } else if (rel.startsWith('placeholders/')) {
    if (PROD) failures.push(`${rel}: user-supplied placeholder in a production build`)
    else if (!placeholderByPath.has(rel)) failures.push(`${rel}: not the exact registered user-supplied preview portrait`)
    else placeholderCount++
  } else if (!owned.includes(rel) && !brandByPath.has(rel)) {
    failures.push(`${rel}: not a licensed reference and not listed in content/photos.owned.json`)
  }
}

const attribute = (tag, name) => {
  const value = tag.match(new RegExp(`\\b${name}=(['"])(.*?)\\1`, 'i'))
  return value ? decode(value[2]) : null
}
const hidden = (tag) => /\shidden(?:\s|=|>)/i.test(tag) || attribute(tag, 'aria-hidden') === 'true' ||
  /(?:^|\s)(?:sr-only|hidden|invisible|opacity-0)(?:\s|$)/.test(attribute(tag, 'class') ?? '') ||
  /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:[;\s]|$)/i.test(attribute(tag, 'style') ?? '')

// Check every rendered use, including an image whose data-reference marker was accidentally omitted.
// Source checks cannot prove computed visibility; browser verification still checks the final caption on screen.
const captioned = Object.entries(credits).filter(([, c]) => c.treatment === 'captioned')
const portraitPages = new Set()
for (const file of walk(DIST).filter((f) => f.endsWith('.html'))) {
  const html = fs.readFileSync(file, 'utf8')
  const figures = [...html.matchAll(/<figure\b[^>]*>[\s\S]*?<\/figure>/gi)]
  const images = [...html.matchAll(/<img\b[^>]*>/gi)]
  for (const image of images.filter(match => attribute(match[0], 'data-placeholder') === 'sergio-portrait' || placeholderAssets.some(asset => match[0].includes(asset.file)) || figures.some(figure => match.index >= figure.index && match.index < figure.index + figure[0].length && attribute(figure[0].match(/^<figure\b[^>]*>/i)?.[0] ?? '', 'data-placeholder-figure') === 'sergio-portrait'))) {
    const relative = path.relative(DIST, file).split(path.sep).join('/')
    const figure = figures.find(match => image.index >= match.index && image.index < match.index + match[0].length)
    const figureTag = figure?.[0].match(/^<figure\b[^>]*>/i)?.[0] ?? ''
    const caption = figure?.[0].match(/<figcaption\b[^>]*>[\s\S]*?<\/figcaption>/i)?.[0]
    const captionTag = caption?.match(/^<figcaption\b[^>]*>/i)?.[0] ?? ''
    const disclosure = caption ? textOf(caption) : ''
    const registeredSource = [...placeholderByPath.keys()].some(asset => image[0].includes(asset)) || attribute(image[0], 'data-deferred-photo') === 'true'
    if (PROD || !registeredSource || !placeholderByPath.size || attribute(image[0], 'data-placeholder') !== 'sergio-portrait' ||
        attribute(figureTag, 'data-placeholder-figure') !== 'sergio-portrait' || hidden(figureTag) || hidden(image[0]) || hidden(captionTag) ||
        !/placeholder portrait/i.test(disclosure) || !/supplied for this preview/i.test(disclosure)) {
      failures.push(`${relative}: preview portrait needs its registered bytes, data-placeholder marker and visible adjacent placeholder disclosure; production use is forbidden`)
    } else portraitPages.add(relative)
  }
  for (const [slot, credit] of captioned) {
    for (const image of images.filter((m) => attribute(m[0], 'data-reference') === slot || credit.files.some((f) => m[0].includes(f.file)))) {
      const figure = figures.find((m) => image.index >= m.index && image.index < m.index + m[0].length)
      const figureTag = figure?.[0].match(/^<figure\b[^>]*>/i)?.[0] ?? ''
      const caption = figure?.[0].match(/<figcaption\b[^>]*>[\s\S]*?<\/figcaption>/i)?.[0]
      const captionTag = caption?.match(/^<figcaption\b[^>]*>/i)?.[0] ?? ''
      const text = caption ? textOf(caption) : ''
      const links = caption ? [...caption.matchAll(/<a\b[^>]*>/gi)].map((m) => attribute(m[0], 'href')) : []
      if (attribute(figureTag, 'data-reference-figure') !== slot || attribute(captionTag, 'data-reference-caption') !== slot ||
          hidden(figureTag) || hidden(captionTag) || !/reference (?:photo|image)/i.test(text) || !/not Sergio['’]s food/i.test(text) ||
          !text.includes(credit.creator) || !links.includes(credit.landing) || !links.includes(credit.license_url)) {
        failures.push(`${path.relative(DIST, file)}: ${slot} needs a matching visible reference caption with disclosure, creator, source and license`)
      }
    }
  }
}
if (!PROD && placeholderByPath.size) {
  for (const page of ['index.html', 'about/index.html']) if (!portraitPages.has(page)) failures.push(`${page}: registered preview portrait needs a visible, disclosed use on home and About`)
}
if (PROD) {
  for (const f of walk(DIST).filter((f) => f.endsWith('.html'))) {
    if (fs.readFileSync(f, 'utf8').includes('data-reference=')) failures.push(`${path.relative(DIST, f)}: renders a reference image`)
  }
}
notes.push(`${images.length} images scanned; ${refCount - captionedCount} watermarked and ${captionedCount} captioned reference files; ${owned.length} owned photos; ${artCount} verified authored Blender renders; ${shareCount} share cards; 0 allowed with AI credentials`)
notes.push(`${placeholderCount} exact-byte user-supplied preview portrait files; ownership/capture unverified, never counted as owned photos`)
notes.push(`${brand.length} original brand assets checked against their separate SHA-256 manifest`)
report('images: licensed reference treatments verified, no AI-generated media', failures, notes)
