/** Canonical gift commands and actual licensed glyph outlines, not a second card design. */
import { GIFT_OUTLINES } from './outlines'
import { PDFDocument, PDFHexString, PDFName, beginText, endText, rgb, setFontAndSize, setTextMatrix, setTextRenderingMode, showText, TextRenderingMode } from 'pdf-lib'
import { buildGiftCardArtwork, GIFT_CARD_COLORS, textAdvance, type GiftCardDocument, type GiftText } from './artwork'
import { GIFT_LOGO } from './logo'

const SCALE = 72 / 200, WIDTH = 360, HEIGHT = 252
const color = (hex:string) => rgb(...[1,3,5].map(at=>parseInt(hex.slice(at,at+2),16)/255) as [number,number,number])
type OutlineFont={unitsPerEm:number;glyphs:Record<string,{advance:number;path:string}>}
const fonts=GIFT_OUTLINES as Record<'serif'|'italic'|'sans'|'medium',OutlineFont>
export function validateGiftDocument(document:GiftCardDocument):void{
  const art=buildGiftCardArtwork(document)
  for(const face of Object.values(art))for(const c of face.commands)if(c.kind==='text'){
    const f=c.font==='serif'&&c.weight===500?fonts.medium:fonts[c.font]
    if(Array.from(c.text).some(char=>!f.glyphs[char]))throw new RangeError('The actual card typeface does not contain a supplied character.')
  }
}
const utf16=(value:string)=>Array.from({length:value.length},(_,i)=>value.charCodeAt(i).toString(16).padStart(4,'0')).join('')
/** Invisible Unicode copy layer, as in an OCR PDF. Visible text always uses the actual house outlines. */
function copyFont(doc:PDFDocument,text:string){
  const chars=[...new Set(Array.from(text))];if(chars.length>255)throw new Error('The card copy exceeds its supported text repertoire.')
  const map=new Map(chars.map((char,index)=>[char,index+1])),hex=(n:number)=>n.toString(16).padStart(2,'0')
  const cmap=`/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /GiftUnicode def\n/CMapType 2 def\n1 begincodespacerange\n<00> <FF>\nendcodespacerange\n${chars.length} beginbfchar\n${chars.map(char=>`<${hex(map.get(char)!)}> <${utf16(char)}>`).join('\n')}\nendbfchar\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`
  const unicode=doc.context.register(doc.context.flateStream(cmap)),ref=doc.context.register(doc.context.obj({Type:'Font',Subtype:'Type1',BaseFont:'Helvetica',Encoding:'WinAnsiEncoding',ToUnicode:unicode}))
  return {ref,encode:(value:string)=>PDFHexString.of(Array.from(value).map(char=>hex(map.get(char)!)).join(''))}
}
export async function buildGiftPDF(document:GiftCardDocument,issuedAt:string):Promise<Uint8Array>{
  const art=buildGiftCardArtwork(document),doc=await PDFDocument.create(),stamp=new Date(issuedAt)
  if(!Number.isFinite(+stamp))throw new Error('A recorded gift issue time is required.')
  doc.setCreationDate(stamp);doc.setModificationDate(stamp);doc.setTitle('Chef Sergio & Co. — Gift card');doc.setAuthor('Chef Sergio & Co.');doc.setCreator('Chef Sergio gift artwork');doc.setProducer('Chef Sergio gift artwork')
  validateGiftDocument(document)
  const unicode=copyFont(doc,Object.values(art).flatMap(face=>face.commands.filter((c):c is GiftText=>c.kind==='text').map(c=>c.text)).join(''))
  for(const face of Object.values(art)){
    const page=doc.addPage([WIDTH,HEIGHT]);page.drawRectangle({x:0,y:0,width:WIDTH,height:HEIGHT,color:color(GIFT_CARD_COLORS.paper)})
    page.node.setFontDictionary(PDFName.of('GiftCopy'),unicode.ref)
    for(const c of face.commands){
      const ink=color(c.finish==='foil-rouge'||c.finish==='ink-rouge'?GIFT_CARD_COLORS.rouge:GIFT_CARD_COLORS.ink)
      if(c.kind==='rule'){if(c.height)page.drawRectangle({x:c.x*SCALE,y:HEIGHT-(c.y+c.height)*SCALE,width:c.width*SCALE,height:c.height*SCALE,borderWidth:c.stroke*SCALE,borderColor:ink});else page.drawLine({start:{x:c.x*SCALE,y:HEIGHT-c.y*SCALE},end:{x:(c.x+c.width)*SCALE,y:HEIGHT-c.y*SCALE},thickness:c.stroke*SCALE,color:ink});continue}
      if(c.kind==='logo'){const unit=c.width*SCALE/GIFT_LOGO.viewBox[2],x=c.x*SCALE-GIFT_LOGO.viewBox[0]*unit,y=HEIGHT-c.y*SCALE+GIFT_LOGO.viewBox[1]*unit;for(const path of GIFT_LOGO.paths)page.drawSvgPath(path,{x,y,scale:unit,color:ink});continue}
      const f=c.font==='serif'&&c.weight===500?fonts.medium:fonts[c.font],glyphs=Array.from(c.text).map(char=>f.glyphs[char]),size=c.size*SCALE,scale=size/f.unitsPerEm,width=textAdvance(c.text,c.size,c.font,c.weight)*SCALE,left=c.x*SCALE-(c.align==='center'?width/2:c.align==='right'?width:0),natural=glyphs.reduce((sum,g)=>sum+g.advance,0)*scale,spacing=natural?width/natural:1
      let advance=0
      glyphs.forEach(glyph=>{if(glyph.path)page.drawSvgPath(glyph.path,{x:left+advance*scale*spacing,y:HEIGHT-c.y*SCALE,scale,color:ink});advance+=glyph.advance})
      page.pushOperators(beginText(),setFontAndSize(PDFName.of('GiftCopy'),size),setTextRenderingMode(TextRenderingMode.Invisible),setTextMatrix(1,0,0,1,left,HEIGHT-c.y*SCALE),showText(unicode.encode(c.text)),endText())
    }
  }
  return doc.save({useObjectStreams:false})
}
