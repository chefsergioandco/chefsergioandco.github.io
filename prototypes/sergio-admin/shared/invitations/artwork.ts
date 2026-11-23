import type { InvitationDocument } from './types'

export type { InvitationDocument } from './types'
export type InvitationFace = 'cover' | 'note' | 'details' | 'back'
export type ArtworkText = {
  kind: 'text'; text: string; x: number; y: number; size: number
  font: 'serif' | 'italic' | 'sans'; weight: 400 | 500; align: 'left' | 'center'; color: 'ink' | 'rouge'
}
export type ArtworkLogo = { kind: 'logo'; x: number; y: number; width: number; height: number }
export type ArtworkCommand = ArtworkText | ArtworkLogo
export type FaceArtwork = { face: InvitationFace; finish: 'foil' | 'letterpress'; width: 700; height: 500; commands: ArtworkCommand[]; copy: string[] }
export type ArtworkOptions = { logoSvg?: string; logoUrl?: string; fontCss?: string; assetsBase?: string }
export type PrintOptions = ArtworkOptions & { title?: string; showInstructions?: boolean }

export const INVITATION_FORMAT = Object.freeze({ width: 700, height: 500, closedWidthIn: 7, closedHeightIn: 5, sheetWidthIn: 7, sheetHeightIn: 10, paperGsm: 120, fold: 'top' as const })
export const INVITATION_COLORS = Object.freeze({ paper: '#fcfaf5', ink: '#2d2b27', rouge: '#8e352f' })
export const INVITATION_FONTS = Object.freeze({ serif: 'Invitation Garamond', italic: 'Invitation Garamond Italic', sans: 'Invitation Archivo' })

const xml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]!))
const clean = (value: string) => value.trim().replace(/\s+/g, ' ')
const possessive = (value: string) => /s$/i.test(value) ? `${value}’` : `${value}’s`

/** Fixed, conservative Garamond advances keep wrapping identical in the browser and vector export. */
export function textAdvance(value: string, size: number): number {
  let em = 0
  for (const char of value) {
    if (/\s/.test(char)) em += .24
    else if (/[ilI1.,:;'’!|]/.test(char)) em += .25
    else if (/[mwMW@&]/.test(char)) em += .81
    else if (/[A-Z0-9]/.test(char)) em += .58
    else if (/[frt]/.test(char)) em += .34
    else em += .46
  }
  return em * size
}

function wrap(value: string, size: number, width: number): string[] {
  const output: string[] = []
  for (const paragraph of value.split('\n')) {
    let line = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word
      if (line && textAdvance(candidate, size) > width) { output.push(line); line = word }
      else line = candidate
    }
    if (line || !paragraph) output.push(line)
  }
  return output
}

type TextOptions = Partial<Pick<ArtworkText, 'font' | 'weight' | 'align' | 'color'>> & { width?: number; maxLines?: number; minSize?: number; leading?: number }
function text(commands: ArtworkCommand[], value: string, x: number, y: number, size: number, options: TextOptions = {}): number {
  const width = options.width ?? 560, maxLines = options.maxLines ?? 5, min = options.minSize ?? size
  let lines = wrap(value, size, width), fitted = size
  while ((lines.length > maxLines || lines.some(line => textAdvance(line, fitted) > width)) && fitted > min) { fitted -= 1; lines = wrap(value, fitted, width) }
  if (lines.length > maxLines || lines.some(line => textAdvance(line, fitted) > width)) throw new RangeError('This invitation copy is too long for the printed card. Shorten the name, title, note or address before printing.')
  const leading = options.leading ? options.leading * fitted / size : fitted * 1.2
  lines.forEach((line, index) => commands.push({ kind: 'text', text: line, x, y: y + leading * index, size: fitted, font: options.font ?? 'serif', weight: options.weight ?? 400, align: options.align ?? 'left', color: options.color ?? 'ink' }))
  return y + leading * (lines.length - 1)
}
const logo = (commands: ArtworkCommand[], x: number, y: number, width: number) => commands.push({ kind: 'logo', x, y, width, height: width * 65 / 426 })

export function invitationDateLabel(date: string): string {
  const parsed = new Date(`${date}T12:00:00Z`)
  return Number.isNaN(parsed.valueOf()) ? date : new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(parsed)
}
export function invitationTimeLabel(time: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(time)
  if (!match) return time
  const hour = Number(match[1])
  return `${hour % 12 || 12}:${match[2]} ${hour >= 12 ? 'pm' : 'am'} Eastern time`
}

export function invitationCopy(document: InvitationDocument) {
  const name = clean(document.recipientName), host = clean(document.hostName)
  const customer = document.recipientRole === 'customer'
  const note = document.personalNote?.trim() || ({
    dinner: customer ? 'I look forward to preparing a private dinner for you and your guests.' : `I look forward to cooking for you at ${possessive(host)} private dinner.`,
    class: customer ? 'I look forward to cooking with you and your guests, then sharing what we have made.' : `Please join ${host} for a private cooking class. I look forward to welcoming you to the kitchen.`,
    event: customer ? 'I look forward to cooking for your celebration and welcoming your guests.' : `Please join ${host} for a private celebration. I look forward to cooking for you.`,
    table: customer ? 'I look forward to welcoming you and your guests to my table.' : `I look forward to welcoming you and ${host} to my table.`,
  }[document.experience])
  return {
    dedication: name ? `For ${name}` : 'A personal invitation',
    salutation: name ? `${name},` : 'Welcome,',
    title: document.title || ({ dinner: 'A private dinner', class: 'A private cooking class', event: 'A private celebration', table: 'An evening at Sergio’s table' }[document.experience]),
    note,
    date: invitationDateLabel(document.date),
    time: invitationTimeLabel(document.startTime),
    venue: clean(document.venueName),
    address: document.address.map(clean).filter(Boolean),
  }
}

/** The public cover shares the print master without pretending to name a booked guest. */
export function buildInvitationCover(dedication?: string): FaceArtwork {
  const cover: FaceArtwork = { face: 'cover', width: 700, height: 500, finish: 'foil', commands: [], copy: [] }
  if (dedication) text(cover.commands, dedication, 350, 87, 29, { align: 'center', color: 'rouge', maxLines: 1, minSize: 22 })
  text(cover.commands, 'An invitation\nfrom Sergio.', 350, 228, 69, { align: 'center', leading: 72, weight: 500, maxLines: 2 })
  logo(cover.commands, 250, 414, 200)
  cover.copy = [...(dedication ? [dedication] : []), 'An invitation from Sergio.', 'Chef Sergio & Co.']
  return cover
}

/** A single layout description supplies both the physical master and every web face. */
export function buildInvitationArtwork(document: InvitationDocument): Record<InvitationFace, FaceArtwork> {
  const copy = invitationCopy(document)
  const face = (name: InvitationFace): FaceArtwork => ({ face: name, width: 700, height: 500, finish: name === 'cover' || name === 'back' ? 'foil' : 'letterpress', commands: [], copy: [] })
  const result: Record<InvitationFace, FaceArtwork> = { cover: face('cover'), note: face('note'), details: face('details'), back: face('back') }
  result.cover = buildInvitationCover(copy.dedication)
  const note = result.note
  text(note.commands, copy.salutation, 84, 103, 32, { color: 'rouge', width: 532, maxLines: 1, minSize: 23 })
  const noteBottom = text(note.commands, copy.note, 84, 183, 36, { width: 532, maxLines: 5, minSize: 27, leading: 44 })
  const closing = Math.max(331, noteBottom + 51)
  if (closing > 415) throw new RangeError('The personal note is too long for the printed invitation.')
  text(note.commands, 'With pleasure,', 84, closing, 29, { maxLines: 1 })
  text(note.commands, 'Sergio', 84, closing + 51, 43, { font: 'italic', maxLines: 1 })
  note.copy = [copy.salutation, copy.note, 'With pleasure,\nSergio']
  const details = result.details
  text(details.commands, copy.title, 350, 99, 47, { align: 'center', width: 568, maxLines: 2, minSize: 34, leading: 47 })
  text(details.commands, copy.date, 350, 191, 30, { align: 'center', width: 584, maxLines: 1, minSize: 25 })
  text(details.commands, copy.time, 350, 234, 30, { align: 'center', maxLines: 1 })
  const venueBottom = text(details.commands, copy.venue, 350, 309, 33, { align: 'center', width: 570, maxLines: 2, minSize: 25, leading: 36 })
  const addresses = copy.address.flatMap(line => wrap(line, 28, 574))
  const available = 464 - Math.max(352, venueBottom + 40)
  const addressSize = Math.min(28, addresses.length > 1 ? available / ((addresses.length - 1) * 1.18) : 28)
  if (addresses.length > 4 || addressSize < 22) throw new RangeError('The address is too long for the printed invitation. Use no more than four concise address lines.')
  text(details.commands, copy.address.join('\n'), 350, Math.max(352, venueBottom + 40), addressSize, { align: 'center', width: 574, maxLines: 4, leading: addressSize * 1.18 })
  details.copy = [copy.title, `${copy.date}\n${copy.time}`, [copy.venue, ...copy.address].join('\n')]
  logo(result.back.commands, 225, 229, 250)
  result.back.copy = ['Chef Sergio & Co.']
  return result
}

export function invitationFontCss(assetsBase = '/invitations/'): string {
  const base = assetsBase.replace(/\/?$/, '/')
  return `@font-face{font-family:'${INVITATION_FONTS.serif}';src:url('${base}eb-garamond-core-wght.woff2') format('woff2');font-weight:400 500;font-style:normal;font-display:block}@font-face{font-family:'${INVITATION_FONTS.italic}';src:url('${base}eb-garamond-core-italic-wght.woff2') format('woff2');font-weight:400 500;font-style:italic;font-display:block}@font-face{font-family:'${INVITATION_FONTS.sans}';src:url('${base}archivo-core-wght.woff2') format('woff2');font-weight:400 500;font-style:normal;font-display:block}`
}

function logoSource(options: ArtworkOptions): string {
  return options.logoSvg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(options.logoSvg)}` : options.logoUrl ?? `${options.assetsBase ?? '/invitations/'}logo-primary-ink.svg`
}

function artworkSvg(artwork: FaceArtwork, options: ArtworkOptions): string {
  const commands = artwork.commands.map(command => command.kind === 'logo'
    ? `<image x="${command.x}" y="${command.y}" width="${command.width}" height="${command.height}" href="${xml(logoSource(options))}"/>`
    : `<text x="${command.x}" y="${command.y}" font-family="${xml(INVITATION_FONTS[command.font])}" font-size="${command.size}" font-weight="${command.weight}"${command.font === 'italic' ? ' font-style="italic"' : ''} text-anchor="${command.align === 'center' ? 'middle' : 'start'}" fill="${INVITATION_COLORS[command.color]}">${xml(command.text)}</text>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 500" width="7in" height="5in" role="img" aria-label="${xml(artwork.copy.join(' '))}"><style>${(options.fontCss ?? invitationFontCss(options.assetsBase)).replace(/<\/style/gi, '<\\/style')}</style>${commands}</svg>`
}

export function renderInvitationSvg(document: InvitationDocument, face: InvitationFace, options: ArtworkOptions = {}): string {
  return artworkSvg(buildInvitationArtwork(document)[face], options)
}

/** A flat vector finishing separation. The selected artwork is 100% black, not a material simulation. */
export function renderInvitationPlateSvg(document: InvitationDocument, face: InvitationFace, color: 'ink' | 'rouge', options: ArtworkOptions = {}): string {
  const artwork = buildInvitationArtwork(document)[face]
  const commands = artwork.commands.filter(command => command.kind === 'logo' ? color === 'ink' : command.color === color)
  if (commands.some(command => command.kind === 'logo') && !options.logoSvg) throw new Error('The outlined brand SVG is required for a portable ink plate.')
  const monochrome = commands.map(command => command.kind === 'text' ? { ...command, color: 'ink' as const } : command)
  const copy = monochrome.flatMap(command => command.kind === 'text' ? [command.text] : ['Chef Sergio & Co.'])
  const svg = artworkSvg({ ...artwork, commands: monochrome, copy }, { ...options, logoSvg: options.logoSvg?.replace(/#[0-9a-f]{3,8}\b/gi, '#000000') })
  return svg.split(`fill="${INVITATION_COLORS.ink}"`).join('fill="#000000"')
}

/** Duplex at 100%, flip on the short edge. The outside back is intentionally upside down. */
export function createPrintHtml(documents: InvitationDocument | InvitationDocument[], options: PrintOptions = {}): string {
  const cards = Array.isArray(documents) ? documents : [documents]
  // The surrounding document owns the fonts; repeating embedded font data per face bloats large sets.
  const faceOptions = { ...options, fontCss: '' }
  const pages = cards.flatMap((document, index) => [
    `<section class="sheet outside" aria-label="Invitation ${index + 1}, outside"><div class="half reverse">${renderInvitationSvg(document, 'back', faceOptions)}</div><div class="half">${renderInvitationSvg(document, 'cover', faceOptions)}</div></section>`,
    `<section class="sheet inside" aria-label="Invitation ${index + 1}, inside"><div class="half">${renderInvitationSvg(document, 'note', faceOptions)}</div><div class="half">${renderInvitationSvg(document, 'details', faceOptions)}</div></section>`,
  ]).join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${xml(options.title ?? 'Chef Sergio invitation print set')}</title><style>${options.fontCss ?? invitationFontCss(options.assetsBase)}*{box-sizing:border-box}body{margin:0;background:#e6e1d8;color:#2d2b27;font:16px/1.5 '${INVITATION_FONTS.sans}',Arial,sans-serif}.print-notes{max-width:50rem;margin:2rem auto;padding:1.5rem;background:#fcfaf5}.print-notes h1{font:500 2rem/1.1 '${INVITATION_FONTS.serif}',Georgia,serif;margin:0 0 1rem}.print-notes p{margin:.6rem 0}.sheet{width:7in;height:10in;margin:.4in auto;display:grid;grid-template-rows:5in 5in;background:#fcfaf5;break-after:page;page-break-after:always;box-shadow:0 2px 12px #2d2b2720}.sheet:last-child{break-after:auto;page-break-after:auto}.half{width:7in;height:5in;overflow:hidden}.half svg{display:block;width:7in;height:5in}.reverse svg{transform:rotate(180deg)}@page{size:7in 10in;margin:0}@media print{html,body{width:7in;background:transparent}.print-notes{display:none}.sheet{margin:0;box-shadow:none;background:transparent}.half{background:transparent}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body>${options.showInstructions === false ? '' : `<aside class="print-notes"><h1>${xml(options.title ?? 'Your invitation print set')}</h1><p>${cards.length} folded invitation${cards.length === 1 ? '' : 's'} · 7 × 5 inches closed · 120 gsm cotton.</p><p>Print at 100% on 7 × 10 inch sheets, duplex, flipping on the short edge. The two halves meet at the horizontal fold. Begin with one proof to confirm the front, back and inside orientation.</p><p>The artwork uses flat ink colors. Cotton paper and the cover’s gloss foil are physical production finishes; this export does not imitate them with printed shadows or gradients.</p></aside>`}${pages}</body></html>`
}
