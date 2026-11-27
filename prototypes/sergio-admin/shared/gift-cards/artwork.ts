import { GIFT_FONT_ADVANCES } from './metrics'
import { formatGiftCode } from './code'

/**
 * One gift card, drawn once. The same commands drive the lit card on the site, the email image and the
 * vector print master, so a printed card can only ever look like the digital one.
 *
 * Physical card: 5 × 3.5 in PVC, 30 mil (0.76 mm), with a rouge colour core so the edges show rouge, a satin
 * overlaminate, and 1/8 in rounded corners. The ivory is printed edge to edge (1/8 in bleed); the corners are
 * die-cut. The units are 200 per inch: 1000 × 700.
 *
 * Production rule this file enforces: foil needs a metal die made before the run, so only fixed artwork
 * may be foil. Fixed means the logo, the frame, the rule and the printed amounts (one die each). Anything
 * that changes per card (names, note, code) is flat ink, the same on paper and on screen.
 */
export const GIFT_CARD_FORMAT = Object.freeze({ width: 1000, height: 700, widthIn: 5, heightIn: 3.5, unitsPerInch: 200, thicknessMm: .76, cornerRadius: 25, bleed: 25, material: 'PVC, rouge colour core, satin overlaminate' as const })
export const GIFT_CARD_COLORS = Object.freeze({ paper: '#fcfaf5', ink: '#2d2b27', rouge: '#8e352f' })
export const GIFT_CARD_FONTS = Object.freeze({ serif: 'Invitation Garamond', italic: 'Invitation Garamond Italic', sans: 'Invitation Archivo' })

/** foil-black: gloss black foil. foil-rouge: rouge foil. ink / ink-rouge: flat printed ink, no reflection. */
export type GiftFinish = 'foil-black' | 'foil-rouge' | 'ink' | 'ink-rouge'
export type GiftFace = 'front' | 'back'
export type GiftText = { kind: 'text'; text: string; x: number; y: number; size: number; font: 'serif' | 'italic' | 'sans'; weight: 400 | 500; align: 'left' | 'center' | 'right'; finish: GiftFinish }
export type GiftLogo = { kind: 'logo'; x: number; y: number; width: number; height: number; finish: 'foil-black' }
export type GiftRule = { kind: 'rule'; x: number; y: number; width: number; height: number; stroke: number; finish: GiftFinish }
export type GiftCommand = GiftText | GiftLogo | GiftRule
export type GiftFaceArtwork = { face: GiftFace; width: 1000; height: 700; commands: GiftCommand[]; copy: string[] }

export type GiftCardDocument = {
  amountCents: number
  recipient?: string
  sender?: string
  note?: string
  /** The 16-character code. Absent on a preview: the code exists only once the card is paid for. */
  code?: string
  redeemUrl: string
  phone: string
}

/** Minimum sizes a press can hold: 6 pt for flat ink, 0.5 pt for a foil line. 1 pt = 200/72 units. */
export const PRINT_LIMITS = Object.freeze({ minInkSize: 6 * 200 / 72, minFoilStroke: .5 * 200 / 72, safeInset: .125 * 200 })
const LOGO_RATIO = 64.54713 / 425.696
const MARGIN = 90, MEASURE = 1000 - MARGIN * 2

export const formatAmount = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`
const clean = (value?: string) => (value ?? '').trim().replace(/\s+/g, ' ')

/** The width of a line in the real typeface. A character the typeface lacks is refused, never substituted. */
export function textAdvance(value: string, size: number, font: GiftText['font'] = 'serif', weight: 400 | 500 = 400): number {
  const table = GIFT_FONT_ADVANCES[`${font}-${weight}`]
  let em = 0
  for (const char of value) {
    const advance = table[char]
    if (advance === undefined) throw new RangeError(`The card’s typeface has no “${char}”. Spell it without that character, or ask Sergio.`)
    em += advance
  }
  return em * size
}

function wrap(value: string, size: number, width: number, font: GiftText['font'], weight: 400 | 500): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of value.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word
    if (line && textAdvance(candidate, size, font, weight) > width) { lines.push(line); line = word } else line = candidate
  }
  if (line) lines.push(line)
  return lines
}

type Options = { font?: GiftText['font']; weight?: 400 | 500; align?: GiftText['align']; finish?: GiftFinish; width?: number; maxLines?: number; minSize?: number; leading?: number }
/** Lays text out to fit the card, shrinking to minSize; refuses copy the printed card cannot hold. */
function text(commands: GiftCommand[], value: string, x: number, y: number, size: number, options: Options = {}): number {
  const width = options.width ?? MEASURE, maxLines = options.maxLines ?? 1, min = options.minSize ?? size
  const font = options.font ?? 'serif', weight = options.weight ?? 400, measure = (line: string, at: number) => textAdvance(line, at, font, weight)
  let fitted = size, lines = wrap(value, fitted, width, font, weight)
  while ((lines.length > maxLines || lines.some(line => measure(line, fitted) > width)) && fitted > min) { fitted -= 1; lines = wrap(value, fitted, width, font, weight) }
  if (lines.length > maxLines || lines.some(line => measure(line, fitted) > width)) throw new RangeError('This is too long for the printed gift card. Shorten the name or note.')
  const leading = (options.leading ?? size * 1.2) * fitted / size
  lines.forEach((line, index) => commands.push({ kind: 'text', text: line, x, y: y + leading * index, size: fitted, font: options.font ?? 'serif', weight: options.weight ?? 400, align: options.align ?? 'left', finish: options.finish ?? 'ink' }))
  return y + leading * Math.max(0, lines.length - 1)
}

export const GIFT_TEXT_LIMITS = Object.freeze({ name: 60, note: 220 })
export function giftCardCopy(document: GiftCardDocument) {
  const recipient = clean(document.recipient), sender = clean(document.sender), note = clean(document.note)
  // Refused, never cut: a printed card must not end mid-sentence.
  if (recipient.length > GIFT_TEXT_LIMITS.name || sender.length > GIFT_TEXT_LIMITS.name) throw new RangeError('Names on the gift card are limited to 60 characters.')
  if (note.length > GIFT_TEXT_LIMITS.note) throw new RangeError('The note on the gift card is limited to 220 characters.')
  return {
    amount: formatAmount(document.amountCents),
    recipient,
    sender,
    note,
    code: document.code ? formatGiftCode(document.code) : '',
    terms: 'No expiry and no fees. Toward any dinner, class or gathering with Chef Sergio & Co. Not exchangeable for cash, except where the law requires.',
  }
}

/** Front: fixed artwork only, so a physical run needs one die per amount and nothing else. */
function front(document: GiftCardDocument): GiftFaceArtwork {
  const copy = giftCardCopy(document), commands: GiftCommand[] = []
  const inset = 46
  commands.push({ kind: 'rule', x: inset, y: inset, width: 1000 - inset * 2, height: 700 - inset * 2, stroke: 2.2, finish: 'foil-rouge' })
  const logoWidth = 500
  commands.push({ kind: 'logo', x: (1000 - logoWidth) / 2, y: 122, width: logoWidth, height: logoWidth * LOGO_RATIO, finish: 'foil-black' })
  text(commands, copy.amount, 500, 420, 168, { align: 'center', weight: 500, finish: 'foil-black', minSize: 120 })
  text(commands, 'toward an evening with Sergio', 500, 492, 36, { font: 'italic', align: 'center' })
  text(commands, 'Gift card', 500, 600, 24, { font: 'sans', align: 'center', finish: 'foil-rouge' })
  return { face: 'front', width: 1000, height: 700, commands, copy: [`${copy.amount} gift card`, 'Toward an evening with Sergio.', 'Chef Sergio & Co.'] }
}

/** Back: what changes per card, all in flat ink. Empty fields leave a line to write on, as a blank card would. */
function back(document: GiftCardDocument): GiftFaceArtwork {
  const copy = giftCardCopy(document), commands: GiftCommand[] = [], spoken: string[] = []
  // The greeting block is laid out from y=0, then centred in the space above the rule (y 70–430).
  const block: GiftCommand[] = []
  text(block, 'For', MARGIN, 0, 27, { font: 'italic', finish: 'ink-rouge' })
  if (copy.recipient) { text(block, copy.recipient, MARGIN + 52, 0, 46, { width: MEASURE - 52, minSize: 30 }); spoken.push(`For ${copy.recipient}.`) }
  else block.push({ kind: 'rule', x: MARGIN + 52, y: 6, width: 420, height: 0, stroke: 1.2, finish: 'ink' })
  let y = 74
  if (copy.note) { y = text(block, copy.note, MARGIN, y, 29, { font: 'italic', maxLines: 4, minSize: 23, leading: 38 }) + 62; spoken.push(copy.note) }
  else y = 140
  text(block, 'From', MARGIN, y, 27, { font: 'italic', finish: 'ink-rouge' })
  if (copy.sender) { text(block, copy.sender, MARGIN + 66, y, 34, { width: MEASURE - 66, minSize: 24 }); spoken.push(`From ${copy.sender}.`) }
  else block.push({ kind: 'rule', x: MARGIN + 66, y: y + 6, width: 360, height: 0, stroke: 1.2, finish: 'ink' })
  // Cap height of the first line (≈34) to the baseline of the last: the block's visible height.
  const top = 70, bottom = 430, height = y + 34 - (-34)
  if (height > bottom - top) throw new RangeError('The note is too long for the printed gift card.')
  const shift = top + 34 + (bottom - top - height) / 2
  for (const command of block) commands.push({ ...command, y: command.y + shift })
  commands.push({ kind: 'rule', x: MARGIN, y: 452, width: MEASURE, height: 0, stroke: 1.6, finish: 'foil-rouge' })
  text(commands, 'Gift code', MARGIN, 500, 18, { font: 'sans', finish: 'ink-rouge' })
  text(commands, copy.code || '•••• •••• •••• ••••', MARGIN, 546, 36, { font: 'sans', weight: 500 })
  text(commands, 'Redeem when you book', 910, 500, 18, { font: 'sans', align: 'right', finish: 'ink-rouge' })
  text(commands, document.redeemUrl.replace(/^https?:\/\//, '').replace(/\/$/, ''), 910, 532, 19, { font: 'sans', align: 'right', width: 420, minSize: PRINT_LIMITS.minInkSize })
  text(commands, `or call ${document.phone}`, 910, 558, 19, { font: 'sans', align: 'right', width: 420 })
  text(commands, copy.terms, MARGIN, 614, 17, { font: 'sans', maxLines: 2, leading: 23, minSize: PRINT_LIMITS.minInkSize })
  spoken.push(copy.code ? `Gift code ${copy.code}.` : 'The gift code is issued once the card is paid for.', `Redeem when you book at ${document.redeemUrl}, or call ${document.phone}.`, copy.terms)
  return { face: 'back', width: 1000, height: 700, commands, copy: spoken }
}

export function buildGiftCardArtwork(document: GiftCardDocument): Record<GiftFace, GiftFaceArtwork> {
  if (!Number.isInteger(document.amountCents) || document.amountCents <= 0) throw new RangeError('A gift card needs a positive whole-cent amount.')
  return { front: front(document), back: back(document) }
}

/** Every rule a printer would check, applied to the artwork itself. Returns problems; empty means printable. */
export function printProblems(artwork: Record<GiftFace, GiftFaceArtwork>): string[] {
  const problems: string[] = []
  for (const face of Object.values(artwork)) for (const command of face.commands) {
    const where = `${face.face} ${command.kind}${command.kind === 'text' ? ` "${command.text.slice(0, 24)}"` : ''}`
    if (command.kind === 'text' && command.size < PRINT_LIMITS.minInkSize - 1e-6) problems.push(`${where}: under 6 pt`)
    if (command.kind === 'rule' && command.finish.startsWith('foil') && command.stroke < PRINT_LIMITS.minFoilStroke - 1e-6) problems.push(`${where}: foil line under 0.5 pt`)
    const box = command.kind === 'text'
      ? (() => { const w = textAdvance(command.text, command.size, command.font, command.weight), left = command.align === 'center' ? command.x - w / 2 : command.align === 'right' ? command.x - w : command.x; return { left, right: left + w, top: command.y - command.size * .8, bottom: command.y + command.size * .25 } })()
      : { left: command.x, right: command.x + command.width, top: command.y, bottom: command.y + command.height }
    if (box.left < PRINT_LIMITS.safeInset || box.right > 1000 - PRINT_LIMITS.safeInset || box.top < PRINT_LIMITS.safeInset || box.bottom > 700 - PRINT_LIMITS.safeInset) problems.push(`${where}: inside the 1/8 in trim margin`)
    if (face.face === 'back' && command.finish.startsWith('foil') && command.kind === 'text') problems.push(`${where}: per-card text cannot be foil`)
  }
  return problems
}

const xml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]!))
export type GiftSvgOptions = { logoSvg?: string; logoUrl?: string; fontCss?: string; assetsBase?: string }
export function giftFontCss(assetsBase = '/invitations/'): string {
  const base = assetsBase.replace(/\/?$/, '/')
  return `@font-face{font-family:'${GIFT_CARD_FONTS.serif}';src:url('${base}eb-garamond-core-wght.woff2') format('woff2');font-weight:400 500;font-style:normal;font-display:block}@font-face{font-family:'${GIFT_CARD_FONTS.italic}';src:url('${base}eb-garamond-core-italic-wght.woff2') format('woff2');font-weight:400 500;font-style:italic;font-display:block}@font-face{font-family:'${GIFT_CARD_FONTS.sans}';src:url('${base}archivo-core-wght.woff2') format('woff2');font-weight:400 500;font-style:normal;font-display:block}`
}
const colorOf = (finish: GiftFinish) => finish === 'foil-rouge' || finish === 'ink-rouge' ? GIFT_CARD_COLORS.rouge : GIFT_CARD_COLORS.ink
/** Which physical pass prints this element. Each pass is a separate plate in the print master. */
export const plateOf = (finish: GiftFinish): 'foil-black' | 'foil-rouge' | 'ink-black' | 'ink-rouge' => finish === 'ink' ? 'ink-black' : finish

function commandSvg(command: GiftCommand, options: GiftSvgOptions, fill?: string): string {
  if (command.kind === 'logo') {
    const source = options.logoSvg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(fill ? options.logoSvg.replace(/#[0-9a-f]{3,8}\b/gi, fill) : options.logoSvg)}` : options.logoUrl ?? `${options.assetsBase ?? '/invitations/'}logo-primary-ink.svg`
    return `<image x="${command.x}" y="${command.y}" width="${command.width}" height="${command.height}" href="${xml(source)}"/>`
  }
  if (command.kind === 'rule') return command.height
    ? `<rect x="${command.x}" y="${command.y}" width="${command.width}" height="${command.height}" fill="none" stroke="${fill ?? colorOf(command.finish)}" stroke-width="${command.stroke}"/>`
    : `<line x1="${command.x}" y1="${command.y}" x2="${command.x + command.width}" y2="${command.y}" stroke="${fill ?? colorOf(command.finish)}" stroke-width="${command.stroke}"/>`
  return `<text x="${command.x}" y="${command.y}" font-family="${xml(GIFT_CARD_FONTS[command.font])}" font-size="${command.size}" font-weight="${command.weight}"${command.font === 'italic' ? ' font-style="italic"' : ''} text-anchor="${command.align === 'center' ? 'middle' : command.align === 'right' ? 'end' : 'start'}" fill="${fill ?? colorOf(command.finish)}">${xml(command.text)}</text>`
}

/** The composite face: what the card looks like flat, with no simulated light. */
export function renderGiftCardSvg(document: GiftCardDocument, face: GiftFace, options: GiftSvgOptions = {}): string {
  const artwork = buildGiftCardArtwork(document)[face], r = GIFT_CARD_FORMAT.cornerRadius
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 700" width="5in" height="3.5in" role="img" aria-label="${xml(artwork.copy.join(' '))}"><style>${(options.fontCss ?? giftFontCss(options.assetsBase)).replace(/<\/style/gi, '<\\/style')}</style><rect width="1000" height="700" rx="${r}" ry="${r}" fill="${GIFT_CARD_COLORS.paper}"/>${artwork.commands.map(command => commandSvg(command, options)).join('')}</svg>`
}

export type GiftPlate = ReturnType<typeof plateOf> | 'flood' | 'dieline'
/**
 * One production pass as vector artwork, on the bleed canvas (5.25 × 3.75 in, trim 1/8 in inside):
 * flood is the ivory background printed past the trim; dieline is the rounded cutting path (never printed);
 * the others are 100% black separations for each foil and ink.
 */
export function renderGiftCardPlateSvg(document: GiftCardDocument, face: GiftFace, plate: GiftPlate, options: GiftSvgOptions = {}): string {
  const artwork = buildGiftCardArtwork(document)[face], b = GIFT_CARD_FORMAT.bleed, r = GIFT_CARD_FORMAT.cornerRadius
  const open = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-b} ${-b} ${1000 + b * 2} ${700 + b * 2}" width="${(1000 + b * 2) / 200}in" height="${(700 + b * 2) / 200}in" data-plate="${plate}">`
  if (plate === 'flood') return `${open}<rect x="${-b}" y="${-b}" width="${1000 + b * 2}" height="${700 + b * 2}" fill="#000000"/></svg>`
  if (plate === 'dieline') return `${open}<rect x="0" y="0" width="1000" height="700" rx="${r}" ry="${r}" fill="none" stroke="#000000" stroke-width="1"/></svg>`
  const selected = artwork.commands.filter(command => plateOf(command.finish) === plate)
  if (selected.some(command => command.kind === 'logo') && !options.logoSvg) throw new Error('The outlined brand SVG is required for a portable foil plate.')
  return `${open}<style>${(options.fontCss ?? giftFontCss(options.assetsBase)).replace(/<\/style/gi, '<\\/style')}</style>${selected.map(command => commandSvg(command, options, '#000000')).join('')}</svg>`
}
