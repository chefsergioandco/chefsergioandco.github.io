import type { InvitationDocument } from './types'
import { INVITATION_COLORS, INVITATION_FONTS, invitationFontCss, type ArtworkOptions, type PrintOptions } from './artwork'

export type DinnerMenuCourse = { name: string; description?: string }
export type DinnerMenuDocument = {
  hostName: string
  date: string
  title?: string
  courses: DinnerMenuCourse[]
  status: 'draft' | 'confirmed' | 'specimen'
  version?: number
}
export type MenuTextRole = 'dedication' | 'menuLabel' | 'date' | 'dishName' | 'dishDescription' | 'specimenLabel' | 'specimenDetail' | 'draftLabel'
export type MenuTextCommand = {
  kind: 'text'; role: MenuTextRole; text: string; x: number; y: number; size: number
  font: 'serif' | 'italic'; weight: 400; align: 'center'; color: 'ink' | 'rouge'
  /** Nominal unkerned advance in points, including tracking between characters. */
  width: number; tracking: number
}
export type MenuLogoCommand = { kind: 'logo'; role: 'brand'; x: number; y: number; width: number; height: number }
export type MenuLineCommand = { kind: 'line'; role: 'divider'; x1: number; x2: number; y: number; width: number; color: 'rouge' }
export type MenuArtworkCommand = MenuTextCommand | MenuLogoCommand | MenuLineCommand
export type MenuArtwork = {
  width: 360; height: 576; status: DinnerMenuDocument['status']; finish: 'foil-debossed'
  finishes: typeof MENU_FINISHES
  commands: MenuArtworkCommand[]; copy: string[]
  layout: { courseCount: number; nameSize: number; descriptionSize: 11.5; nameDescriptionBaselineGap: number; courseBaselinePitch: number | null; nameBaselines: number[]; maxTextWidth: 270 }
}

export const MENU_FORMAT = Object.freeze({ width: 360, height: 576, widthIn: 5, heightIn: 8, fold: 'none' as const, paperGsm: 120 })
export const MENU_COLORS = INVITATION_COLORS
export const MENU_FONTS = INVITATION_FONTS
/** Production intent, not a claim that a physical press proof has been accepted. */
export const MENU_FINISHES = Object.freeze({ ink: 'gloss-black-foil-debossed', rouge: 'rouge-foil-debossed', physicalProof: 'required' } as const)

const xml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]!))
const clean = (value: string) => value.trim().replace(/\s+/g, ' ')
const possessive = (value: string) => /s$/i.test(value) ? `${value}’` : `${value}’s`
const WIDTH = 270, BODY_TOP = 145, BODY_BOTTOM = 445

// Nominal advances from the same regular/true-italic Garamond outlines used by
// the accepted PDF specimen (1000 units/em). No kerning or discretionary ligatures.
const ASCII_REGULAR = [200,250,330,468,441,650,756,200,315,315,340,590,230,274,230,399,480,480,480,480,480,480,480,480,480,480,248,228,560,566,560,376,749,692,587,710,754,564,512,729,810,340,340,681,584,901,792,763,552,763,713,465,670,738,672,916,707,578,603,331,399,331,500,500,200,399,515,407,506,390,318,435,515,245,226,469,240,778,528,495,519,522,334,323,314,527,438,685,430,438,377,376,260,376,500]
const ASCII_ITALIC = [200,287,330,449,483,644,822,200,308,309,339,590,215,268,215,276,480,480,480,480,480,480,480,480,480,480,216,215,590,590,590,316,761,658,572,631,752,576,509,687,751,362,293,699,583,991,771,694,566,694,687,467,622,700,683,1067,633,575,635,361,410,360,501,464,200,491,449,313,516,341,321,415,488,294,259,455,286,789,527,380,439,473,379,276,292,509,410,623,438,405,407,352,260,352,500]
const SPECIAL: Record<string, [number, number]> = {
  'Æ':[872,800], 'æ':[557,521], 'Ø':[773,713], 'ø':[485,380], 'Ð':[754,752], 'ð':[487,415], 'Þ':[559,551], 'þ':[505,451], 'ß':[504,522],
  '‐':[274,268], '‑':[274,268], '–':[550,519], '—':[950,891], '‘':[242,215], '’':[242,215], '“':[418,389], '”':[418,390], '•':[348,341], '…':[686,671], '€':[707,627],
}

export function menuTextAdvance(value: string, size: number, font: 'serif' | 'italic' = 'serif', tracking = 0): number {
  const italic = font === 'italic', advances = italic ? ASCII_ITALIC : ASCII_REGULAR
  let units = 0
  for (const character of value) {
    const code = character.codePointAt(0)!
    if (code >= 32 && code <= 126) units += advances[code - 32]
    else if (SPECIAL[character]) units += SPECIAL[character][italic ? 1 : 0]
    else {
      const base = character.normalize('NFD').replace(/\p{M}/gu, '')
      const baseCode = base.codePointAt(0) ?? 0
      // Unknown characters get a conservative bound rather than being removed.
      units += base.length === 1 && baseCode >= 32 && baseCode <= 126 ? advances[baseCode - 32] : 1100
    }
  }
  return units * size / 1000 + Math.max(0, [...value].length - 1) * tracking
}

/** A lossless adapter for the existing name-only contract. Never infers recipes. */
export function menuDocumentFromInvitation(document: InvitationDocument): DinnerMenuDocument {
  return {
    hostName: document.hostName, date: document.date, title: ({ dinner: 'A PRIVATE DINNER', class: 'A PRIVATE COOKING CLASS', event: 'A PRIVATE CELEBRATION', table: 'AT SERGIO’S TABLE' }[document.experience]),
    courses: document.menu.map(name => ({ name })), status: document.menuConfirmed ? 'confirmed' : 'draft', version: document.version,
  }
}

function wrap(value: string, size: number, font: 'serif' | 'italic', maxLines: number, tracking = 0): string[] {
  const words = clean(value).split(' ').filter(Boolean), result: string[] = []
  let line = ''
  for (const word of words) {
    if (menuTextAdvance(word, size, font, tracking) > WIDTH) throw new RangeError('A menu word is too long for the printed card. Shorten the copy before printing.')
    const next = line ? `${line} ${word}` : word
    if (line && menuTextAdvance(next, size, font, tracking) > WIDTH) { result.push(line); line = word }
    else line = next
  }
  if (line) result.push(line)
  if (result.length > maxLines) throw new RangeError('This menu copy is too long for the printed card. Shorten it before printing.')
  return result
}

function dateLabel(date: string): string {
  const parsed = new Date(`${date}T12:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0,10) !== date) throw new RangeError('Use a valid menu date before preparing artwork.')
  return `${parsed.getUTCDate()} ${new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(parsed)} ${parsed.getUTCFullYear()}`
}

type FittedCourse = { names: string[]; descriptions: string[]; height: number; nameLeading: number; descriptionOffset: number }
function fitCourses(courses: DinnerMenuCourse[]) {
  const count = courses.length, startingSize = count <= 4 ? 16 : ({ 5:15, 6:14, 7:13, 8:12.5 }[count] ?? 12.5)
  const preferredPitch = ({ 1:0, 2:99, 3:99, 4:78, 5:62, 6:51, 7:43, 8:37 }[count] ?? 37)
  for (let size = startingSize; size >= 11.5; size -= .5) {
    let fitted: FittedCourse[]
    try {
      fitted = courses.map(course => {
        const names = wrap(course.name, size, 'serif', 3)
        const descriptions = course.description?.trim() ? wrap(course.description, 11.5, 'italic', 3) : []
        const nameLeading = size * 1.15, descriptionOffset = count >= 7 ? 17 : size >= 15 ? 20 : 18
        const height = size * 1.05 + (names.length - 1) * nameLeading + (descriptions.length ? descriptionOffset + (descriptions.length - 1) * 14 + 11.5 * .3 : size * .3)
        return { names, descriptions, height, nameLeading, descriptionOffset }
      })
    } catch (error) { if (error instanceof RangeError) continue; throw error }
    if (count === 3 && size === 16) {
      const baselines = [190,289,388]
      const ends = fitted.map((course,index) => baselines[index] - size * 1.05 + course.height)
      if (ends.every((end,index) => index === count - 1 ? end <= BODY_BOTTOM : end <= baselines[index] + 57)) return { fitted, size, baselines, accepted: true }
    }
    const minimumGap = count === 8 ? 4 : count === 7 ? 6 : count >= 5 ? 10 : 14
    const heightSum = fitted.reduce((sum,course) => sum+course.height,0)
    if (heightSum + Math.max(0,count-1)*minimumGap > BODY_BOTTOM-BODY_TOP) continue
    const gap = count === 1 ? 0 : Math.max(minimumGap,Math.min(preferredPitch-Math.max(...fitted.map(course=>course.height)),(BODY_BOTTOM-BODY_TOP-heightSum)/(count-1)))
    let top = BODY_TOP + (BODY_BOTTOM-BODY_TOP-heightSum-gap*Math.max(0,count-1))/2
    const baselines = fitted.map(course => { const baseline=top+size*1.05; top+=course.height+gap; return baseline })
    return { fitted, size, baselines, accepted: false }
  }
  throw new RangeError('This menu does not fit the 5 × 8 inch card at a readable size. Shorten the copy or reduce the number of courses before printing.')
}

export function buildMenuArtwork(document: DinnerMenuDocument): MenuArtwork {
  if (!document || !Array.isArray(document.courses) || document.courses.length < 1 || document.courses.length > 8) throw new RangeError('Use one to eight courses for the printed dinner menu.')
  if (!['draft','confirmed','specimen'].includes(document.status)) throw new RangeError('Choose an honest menu status before preparing artwork.')
  if (typeof document.hostName !== 'string' || !clean(document.hostName)) throw new RangeError('Add the actual menu host before preparing artwork.')
  for (const course of document.courses) if (!course || typeof course.name !== 'string' || !clean(course.name) || (course.description !== undefined && typeof course.description !== 'string')) throw new RangeError('Each menu course needs a name and, when supplied, a text description.')
  const commands: MenuArtworkCommand[] = [], copy: string[] = []
  const addText = (value: string, role: MenuTextRole, y: number, size: number, font: 'serif' | 'italic' = 'serif', color: 'ink' | 'rouge' = 'ink', maxLines = 1, tracking = 0, leading = size*1.2) => {
    const lines = wrap(value,size,font,maxLines,tracking)
    lines.forEach((text,index) => commands.push({ kind:'text',role,text,x:180,y:y+index*leading,size,font,weight:400,align:'center',color,width:menuTextAdvance(text,size,font,tracking),tracking }))
    copy.push(value)
  }
  addText(`At ${possessive(clean(document.hostName))} table`,'dedication',55,12,'serif','rouge',2,0,14)
  addText(document.title?.trim() || 'A PRIVATE DINNER','menuLabel',91,9.5,'serif','ink',1,1.05)
  addText(dateLabel(document.date),'date',111,11,'italic')
  const fitted = fitCourses(document.courses)
  fitted.fitted.forEach((course,index) => {
    const y=fitted.baselines[index]
    course.names.forEach((name,line) => addText(name,'dishName',y+line*course.nameLeading,fitted.size))
    course.descriptions.forEach((description,line) => addText(description,'dishDescription',y+(course.names.length-1)*course.nameLeading+course.descriptionOffset+line*14,11.5,'italic'))
    if (index < document.courses.length-1) {
      const end=y-fitted.size*1.05+course.height, nextTop=fitted.baselines[index+1]-fitted.size*1.05
      commands.push({ kind:'line',role:'divider',x1:171,x2:189,y:fitted.accepted ? y+60 : (end+nextTop)/2,width:.3,color:'rouge' })
    }
  })
  commands.push({ kind:'logo',role:'brand',x:108,y:475,width:144,height:144*64.54713/425.696 })
  copy.push('Chef Sergio & Co.')
  if (document.status === 'specimen') {
    addText('TYPESETTING SPECIMEN','specimenLabel',530,8.25,'serif','rouge',1,.55)
    addText('Occasion, sequence and descriptions are illustrative.','specimenDetail',545,8.5,'italic')
  } else if (document.status === 'draft') addText('MENU DRAFT — NOT CONFIRMED','draftLabel',535,9,'serif','rouge',1,.3)
  const pitches=fitted.baselines.slice(1).map((baseline,index)=>baseline-fitted.baselines[index])
  return { width:360,height:576,status:document.status,finish:'foil-debossed',finishes:MENU_FINISHES,commands,copy,
    layout:{courseCount:document.courses.length,nameSize:fitted.size,descriptionSize:11.5,nameDescriptionBaselineGap:fitted.fitted[0].descriptionOffset,courseBaselinePitch:pitches.length && pitches.every(pitch=>Math.abs(pitch-pitches[0])<.001) ? pitches[0] : null,nameBaselines:fitted.baselines,maxTextWidth:270} }
}

function logoSvg(command: MenuLogoCommand, options: ArtworkOptions, plate = false): string {
  if (options.logoSvg) {
    const source = plate ? options.logoSvg.replace(/#[0-9a-f]{3,8}\b/gi,'#000000') : options.logoSvg
    const viewBox=source.match(/\bviewBox=["']([^"']+)["']/)?.[1] ?? '-1.53684 -1.53684 425.696 64.54713'
    const inner=source.replace(/^[\s\S]*?<svg\b[^>]*>/,'').replace(/<\/svg>\s*$/,'')
    return `<svg x="${command.x}" y="${command.y}" width="${command.width}" height="${command.height}" viewBox="${xml(viewBox)}" aria-hidden="true">${inner}</svg>`
  }
  if (plate) throw new Error('The outlined brand SVG is required for a portable menu ink plate.')
  const url=options.logoUrl ?? `${(options.assetsBase ?? '/invitations/').replace(/\/?$/,'/')}logo-primary-ink.svg`
  return `<image x="${command.x}" y="${command.y}" width="${command.width}" height="${command.height}" href="${xml(url)}"/>`
}

function artworkSvg(artwork: MenuArtwork, options: ArtworkOptions, plate?: 'ink' | 'rouge'): string {
  const selected=plate ? artwork.commands.filter(command=>command.kind==='logo' ? plate==='ink' : command.color===plate) : artwork.commands
  const commands=selected.map(command => {
    if (command.kind==='logo') return logoSvg(command,options,!!plate)
    const color=plate ? '#000000' : MENU_COLORS[command.color]
    if (command.kind==='line') return `<line x1="${command.x1}" x2="${command.x2}" y1="${command.y}" y2="${command.y}" stroke="${color}" stroke-width="${command.width}"/>`
    return `<text data-role="${command.role}" x="${command.x-command.width/2}" y="${command.y}" font-family="${xml(MENU_FONTS[command.font])}" font-size="${command.size}" font-weight="400"${command.font==='italic'?' font-style="italic"':''} letter-spacing="${command.tracking}" textLength="${command.width}" lengthAdjust="spacing" fill="${color}">${xml(command.text)}</text>`
  }).join('')
  const css=(options.fontCss ?? invitationFontCss(options.assetsBase)).replace(/<\/style/gi,'<\\/style')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 576" width="5in" height="8in" role="img" aria-label="${xml(artwork.copy.join(' '))}" data-finish="foil-debossed"${plate?` data-separation="${plate}"`:''}><metadata>${xml(JSON.stringify({format:MENU_FORMAT,finishes:MENU_FINISHES,status:artwork.status,separation:plate??null}))}</metadata><style>${css}text{font-kerning:none;font-variant-ligatures:none}</style>${commands}</svg>`
}

/** Flat artwork only. The web object owns lighting; the substrate is unprinted. */
export function renderMenuSvg(document: DinnerMenuDocument, options: ArtworkOptions = {}): string {
  return artworkSvg(buildMenuArtwork(document),options)
}

/** A finishing plate is 100% black vector artwork, never a simulated reflection. */
export function renderMenuPlateSvg(document: DinnerMenuDocument, color: 'ink' | 'rouge', options: ArtworkOptions = {}): string {
  if (color!=='ink' && color!=='rouge') throw new RangeError('Choose the ink or rouge menu separation.')
  return artworkSvg(buildMenuArtwork(document),options,color)
}

export function createMenuPrintHtml(documents: DinnerMenuDocument | DinnerMenuDocument[], options: PrintOptions = {}): string {
  const cards=Array.isArray(documents)?documents:[documents]
  if (!cards.length) throw new RangeError('Choose at least one menu to print.')
  const title=options.title ?? 'Chef Sergio dinner menu print set'
  const sheets=cards.map((document,index)=>`<section class="menu-sheet" aria-label="Menu ${index+1}">${renderMenuSvg(document,{...options,fontCss:''})}</section>`).join('')
  const notes=options.showInstructions===false?'':`<aside class="print-notes"><h1>${xml(title)}</h1><p>${cards.length} flat menu${cards.length===1?'':'s'} · 5 × 8 inches · single-sided. Print at 100% and check a physical size proof.</p><p>Production intent: gloss black foil and rouge foil with a debossed impression on ivory cotton. The ink and rouge plates contain flat vector artwork; this file prints no shadows, reflections or paper texture. Confirm the actual stock, impression and finishing registration with the printer.</p>${cards.some(card=>card.status==='specimen')?'<p>Typesetting specimen: occasion, course sequence and descriptions are illustrative.</p>':''}${cards.some(card=>card.status==='draft')?'<p>Draft menu: the food is not confirmed.</p>':''}</aside>`
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${xml(title)}</title><style>${options.fontCss??invitationFontCss(options.assetsBase)}*{box-sizing:border-box}body{margin:0;background:#e4e4e1;color:${MENU_COLORS.ink};font:16px/1.5 '${MENU_FONTS.sans}',Arial,sans-serif}.print-notes{max-width:50rem;margin:2rem auto;padding:1.5rem;background:${MENU_COLORS.paper}}.print-notes h1{font:400 2rem/1.1 '${MENU_FONTS.serif}',Georgia,serif;margin:0 0 1rem}.menu-sheet{width:5in;height:8in;margin:.4in auto;background:${MENU_COLORS.paper};break-after:page;page-break-after:always}.menu-sheet:last-child{break-after:auto;page-break-after:auto}.menu-sheet svg{display:block;width:5in;height:8in}@page{size:5in 8in;margin:0}@media print{html,body{width:5in;background:transparent}.print-notes{display:none}.menu-sheet{margin:0;background:transparent}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body>${notes}${sheets}</body></html>`
}
