/** Pure, versioned rich-letter contract shared by the editor and Worker. No HTML input. */
export const NEWSLETTER_COLORS = ['#2d2b27', '#8e352f', '#526044', '#686354', '#76545c', '#886222'] as const
export type NewsletterColor = typeof NEWSLETTER_COLORS[number]
export type NewsletterAlignment = 'left' | 'center' | 'right'
export type NewsletterMark = { type:'bold'|'italic'|'underline'|'strike'|'link'|'textStyle'; attrs?:{href?:string;color?:NewsletterColor} }
export type NewsletterNodeType = 'doc'|'paragraph'|'heading'|'bulletList'|'orderedList'|'listItem'|'blockquote'|'horizontalRule'|'hardBreak'|'text'|'image'
export type NewsletterDocumentNode = {
  type:NewsletterNodeType; text?:string; marks?:NewsletterMark[]; content?:NewsletterDocumentNode[];
  attrs?:{textAlign?:NewsletterAlignment;level?:2|3;start?:number;src?:string;alt?:string;title?:string;width?:number;height?:number;caption?:string;align?:NewsletterAlignment}
}
export type NewsletterRichBody = {version:1;doc:NewsletterDocumentNode}
export const NEWSLETTER_DOCUMENT_LIMITS = {depth:10,nodes:1000,images:8,text:18000,jsonBytes:64000,htmlBytes:70000} as const
export class NewsletterDocumentError extends Error { constructor(message:string){super(message);this.name='NewsletterDocumentError'} }
const fail=(message:string):never=>{throw new NewsletterDocumentError(message)}
const object=(value:unknown):Record<string,unknown>=>{
  if(!value||typeof value!=='object'||Array.isArray(value))return fail('Use a supported rich letter document.')
  return value as Record<string,unknown>
}
function keys(value:Record<string,unknown>,allowed:readonly string[]){if(Object.keys(value).some(key=>!allowed.includes(key)))fail('The rich letter contains unsupported attributes.')}
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
function text(value:unknown,max:number,multiline=false):string{
  if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)||!multiline&&/[\r\n]/.test(value)||value.includes('{{'))return fail('Keep rich-letter text within its supported length and formatting.')
  return value
}
export function safeNewsletterLinkUrl(value:unknown):string|null{
  if(typeof value!=='string'||value.length>2048||/[\u0000-\u0020\u007f<>"'`\\]/.test(value)||/%(?:00|0a|0d)/i.test(value)||value.includes('{{'))return null
  try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!!url.hostname&&!url.href.includes('{{')&&!decodeURIComponent(url.href).includes('{{')?url.href:null}catch{return null}
}
/** Raster suffixes are required. Remote image bytes are not fetched or verified here. */
export function safeNewsletterImageUrl(value:unknown):string|null{
  const safe=safeNewsletterLinkUrl(value);if(!safe)return null
  try{return /\.(?:jpe?g|png|webp|gif)$/i.test(decodeURIComponent(new URL(safe).pathname))?safe:null}catch{return null}
}
function alignment(value:unknown):NewsletterAlignment|undefined{
  if(value===undefined||value===null||value==='left')return undefined
  if(value==='center'||value==='right')return value
  return fail('Choose left, center or right text alignment.')
}
function color(value:unknown):NewsletterColor|null{
  if(value===undefined||value===null||value==='')return null
  if(typeof value!=='string')return fail('Choose a color from the letter palette.')
  let normalized=value.toLowerCase()
  const rgb=/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(normalized)
  if(rgb&&rgb.slice(1).every(v=>Number(v)<=255))normalized='#'+rgb.slice(1).map(v=>Number(v).toString(16).padStart(2,'0')).join('')
  if(!NEWSLETTER_COLORS.includes(normalized as NewsletterColor))return fail('Choose a color from the letter palette.')
  return normalized as NewsletterColor
}
const markOrder=['bold','italic','underline','strike','textStyle','link']
function marks(value:unknown):NewsletterMark[]|undefined{
  if(value===undefined)return undefined
  if(!Array.isArray(value)||value.length>6)return fail('Use supported letter text formatting.')
  const result:NewsletterMark[]=[],seen=new Set<string>()
  for(const entry of value){
    const mark=object(entry);keys(mark,['type','attrs']);if(typeof mark.type!=='string'||!markOrder.includes(mark.type)||seen.has(mark.type))return fail('Use supported letter text formatting.');seen.add(mark.type)
    const attrs=mark.attrs===undefined?{}:object(mark.attrs)
    if(mark.type==='link'){
      // Tiptap's standard nonsemantic defaults are accepted and canonicalized away.
      keys(attrs,['href','target','rel','class'])
      if(attrs.target!==undefined&&attrs.target!==null&&!['_blank','_self'].includes(String(attrs.target)))return fail('Use a supported link target.')
      if(attrs.rel!==undefined&&attrs.rel!==null&&(typeof attrs.rel!=='string'||attrs.rel.split(/\s+/).some(v=>v&&!['noopener','noreferrer','nofollow'].includes(v))))return fail('Use supported link attributes.')
      if(attrs.class!==undefined&&attrs.class!==null&&attrs.class!=='')return fail('Custom link styling is not supported.')
      const href=safeNewsletterLinkUrl(attrs.href);if(!href)return fail('Letter links must use a complete HTTPS address without credentials.')
      result.push({type:'link',attrs:{href}})
    }else if(mark.type==='textStyle'){
      keys(attrs,['color']);const selected=color(attrs.color);if(selected)result.push({type:'textStyle',attrs:{color:selected}})
    }else{keys(attrs,[]);result.push({type:mark.type as NewsletterMark['type']})}
  }
  result.sort((a,b)=>markOrder.indexOf(a.type)-markOrder.indexOf(b.type))
  return result.length?result:undefined
}
const blockTypes=['paragraph','heading','bulletList','orderedList','blockquote','horizontalRule','image']
const inlineTypes=['text','hardBreak']
export function validateNewsletterRichBody(value:unknown):NewsletterRichBody{
  const envelope=object(value);keys(envelope,['version','doc']);if(envelope.version!==1)return fail('This rich letter version is not supported.')
  let nodes=0,images=0,characters=0
  function visit(raw:unknown,depth:number,parent:string):NewsletterDocumentNode{
    if(depth>NEWSLETTER_DOCUMENT_LIMITS.depth||++nodes>NEWSLETTER_DOCUMENT_LIMITS.nodes)return fail('Keep the letter shorter and use fewer nested lists.')
    const input=object(raw);keys(input,['type','attrs','content','text','marks'])
    if(typeof input.type!=='string')return fail('Use a supported letter block.')
    const type=input.type
    if(parent==='root'?type!=='doc':parent==='paragraph'||parent==='heading'?!inlineTypes.includes(type):parent==='bulletList'||parent==='orderedList'?type!=='listItem':!blockTypes.includes(type))return fail('The rich letter contains an unsupported block or nesting.')
    const attrs=input.attrs===undefined?{}:object(input.attrs),out:NewsletterDocumentNode={type:type as NewsletterNodeType}
    if(type==='text'){
      keys(attrs,[]);if(input.content!==undefined)return fail('Text cannot contain nested blocks.')
      out.text=text(input.text,18000,true);if(!out.text.length)return fail('Remove empty text nodes from the rich letter.');characters+=out.text.length
      if(characters>18000)return fail('Keep the rich letter under 18,000 text characters.')
      const formatted=marks(input.marks);if(formatted)out.marks=formatted;return out
    }
    if(input.text!==undefined)return fail('Only text nodes may carry text.')
    if(type==='hardBreak'){
      keys(attrs,[]);if(input.content!==undefined)return fail('A line break cannot contain blocks.');const formatted=marks(input.marks);if(formatted)out.marks=formatted;return out
    }
    if(input.marks!==undefined)return fail('Apply text formatting to text, not whole blocks.')
    if(type==='paragraph'||type==='heading'){
      keys(attrs,type==='heading'?['level','textAlign']:['textAlign']);const align=alignment(attrs.textAlign)
      if(type==='heading'){if(attrs.level!==2&&attrs.level!==3)return fail('Use heading level 2 or 3.');out.attrs={level:attrs.level,...(align?{textAlign:align}:{})}}
      else if(align)out.attrs={textAlign:align}
    }else if(type==='orderedList'){
      keys(attrs,['start','type']);const start=attrs.start??1;if(!Number.isSafeInteger(start)||Number(start)<1||Number(start)>1000||attrs.type!==undefined&&attrs.type!==null&&attrs.type!=='1')return fail('Use a standard numbered list.');out.attrs={start:Number(start)}
    }else if(type==='image'){
      if(++images>8)return fail('Use no more than eight images in one letter.')
      keys(attrs,['src','alt','title','width','height','caption','align']);const src=safeNewsletterImageUrl(attrs.src)
      if(!src)return fail('Use a complete HTTPS JPG, PNG, WebP or GIF image URL. SVG and embedded images are not supported.')
      const alt=text(attrs.alt,300);if(!alt.trim())return fail('Describe each image with alternative text.')
      const image:NonNullable<NewsletterDocumentNode['attrs']>={src,alt}
      for(const field of ['width','height'] as const){const dimension=attrs[field];if(dimension!==undefined&&dimension!==null){if(!Number.isSafeInteger(dimension)||Number(dimension)<(field==='width'?120:64)||Number(dimension)>(field==='width'?1200:2400))return fail('Use a supported image size.');image[field]=Number(dimension)}}
      for(const field of ['title','caption'] as const){if(attrs[field]!==undefined&&attrs[field]!==null){const content=text(attrs[field],field==='caption'?400:200,field==='caption');if(content)image[field]=content}}
      const align=alignment(attrs.align);if(align)image.align=align
      out.attrs=image;if(input.content!==undefined)return fail('Images cannot contain nested blocks.');return out
    }else keys(attrs,[])
    if(type==='horizontalRule'){if(input.content!==undefined)return fail('A divider cannot contain blocks.');return out}
    if(input.content!==undefined&&!Array.isArray(input.content))return fail('Use a supported rich letter document.')
    const children=(input.content??[]) as unknown[];if(children.length>1000)return fail('Keep the letter shorter.')
    if(['bulletList','orderedList','listItem','blockquote'].includes(type)&&!children.length)return fail('Remove empty lists and quotations.')
    out.content=children.map(child=>visit(child,depth+1,type))
    if(type==='listItem'&&out.content[0]?.type!=='paragraph')return fail('Begin each list item with a paragraph.')
    // Canonical empty paragraph representation matches an empty Tiptap block.
    if(!out.content.length&&type==='paragraph')delete out.content
    return out
  }
  const normalized:NewsletterRichBody={version:1,doc:visit(envelope.doc,0,'root')}
  if(new TextEncoder().encode(JSON.stringify(normalized)).length>64000)return fail('Keep the formatted letter under its document size limit.')
  if(documentText(normalized.doc).length>18000)return fail('Keep the letter, image descriptions and links under 18,000 characters.')
  if(new TextEncoder().encode(renderNode(normalized.doc)).length>70000)return fail('Keep the formatted letter smaller so email clients can show its complete footer.')
  return normalized
}
function inlineText(node:NewsletterDocumentNode):string{
  if(node.type==='hardBreak')return '\n'
  const content=node.text??'',href=node.marks?.find(mark=>mark.type==='link')?.attrs?.href
  return href&&href!==content?`${content} (${href})`:content
}
function documentText(node:NewsletterDocumentNode,depth=0):string{
  const children=node.content??[]
  if(node.type==='text'||node.type==='hardBreak')return inlineText(node)
  if(node.type==='paragraph'||node.type==='heading')return children.map(inlineText).join('')
  if(node.type==='image')return `[Image: ${node.attrs?.alt??''}] ${node.attrs?.src??''}`+(node.attrs?.caption?'\n'+node.attrs.caption:'')
  if(node.type==='horizontalRule')return '---'
  if(node.type==='bulletList'||node.type==='orderedList')return children.map((child,index)=>{const value=documentText(child,depth+1),prefix=node.type==='bulletList'?'- ':`${(node.attrs?.start??1)+index}. `;return '  '.repeat(depth)+prefix+value.replace(/\n/g,'\n'+'  '.repeat(depth+1))}).join('\n')
  if(node.type==='blockquote')return children.map(child=>documentText(child,depth)).join('\n\n').split('\n').map(line=>'> '+line).join('\n')
  return children.map(child=>documentText(child,depth)).join('\n\n')
}
function renderInline(node:NewsletterDocumentNode):string{
  const value=node.text??'',linked=node.marks?.some(mark=>mark.type==='link')
  const rendered=linked?escape(value):value.split(/(https:\/\/[^\s<>]+)/g).map(part=>{const href=part.startsWith('https://')?safeNewsletterLinkUrl(part):null;return href?`<a href="${escape(href)}" target="_blank" rel="noopener noreferrer nofollow" style="color:#8e352f;text-decoration:underline">${escape(part)}</a>`:escape(part)}).join('')
  let html=node.type==='hardBreak'?'<br>':rendered.replace(/\r?\n/g,'<br>')
  for(const mark of [...(node.marks??[])].reverse()){
    if(mark.type==='bold')html='<strong>'+html+'</strong>'
    else if(mark.type==='italic')html='<em>'+html+'</em>'
    else if(mark.type==='underline')html='<span style="text-decoration:underline">'+html+'</span>'
    else if(mark.type==='strike')html='<span style="text-decoration:line-through">'+html+'</span>'
    else if(mark.type==='textStyle')html=`<span style="color:${mark.attrs!.color}">${html}</span>`
    else if(mark.type==='link')html=`<a href="${escape(mark.attrs!.href!)}" target="_blank" rel="noopener noreferrer nofollow" style="color:#8e352f;text-decoration:underline">${html}</a>`
  }
  return html
}
function renderNode(node:NewsletterDocumentNode):string{
  const children=(node.content??[]).map(child=>renderNode(child)).join('')
  if(node.type==='text'||node.type==='hardBreak')return renderInline(node)
  if(node.type==='doc')return children
  if(node.type==='paragraph')return `<p style="margin:0 0 22px;font:18px/1.75 Georgia,'Times New Roman',serif;overflow-wrap:anywhere;text-align:${node.attrs?.textAlign??'left'}">${children||'<br>'}</p>`
  if(node.type==='heading'){const level=node.attrs!.level!;return `<h${level} style="margin:30px 0 18px;font:normal ${level===2?30:24}px/1.3 Georgia,'Times New Roman',serif;color:#2d2b27;text-align:${node.attrs?.textAlign??'left'}">${children}</h${level}>`}
  if(node.type==='bulletList'||node.type==='orderedList'){const tag=node.type==='bulletList'?'ul':'ol';return `<${tag}${tag==='ol'?` start="${node.attrs?.start??1}"`:''} style="margin:0 0 24px;padding-left:27px;font:18px/1.75 Georgia,'Times New Roman',serif">${children}</${tag}>`}
  if(node.type==='listItem')return `<li style="margin:0 0 8px">${children}</li>`
  if(node.type==='blockquote')return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;border-left:3px solid #ba8e54"><tr><td style="padding:4px 0 4px 22px">${children}</td></tr></table>`
  if(node.type==='horizontalRule')return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0"><tr><td height="1" style="height:1px;background:#e6e1d8;font-size:1px;line-height:1px">&nbsp;</td></tr></table>'
  if(node.type==='image'){
    const attrs=node.attrs!,width=Math.min(attrs.width??536,536),align=attrs.align??'center',height=attrs.height&&attrs.width?Math.round(attrs.height*width/attrs.width):undefined
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0"><tr><td align="${align}"><img src="${escape(attrs.src!)}" alt="${escape(attrs.alt!)}"${attrs.title?` title="${escape(attrs.title)}"`:''} width="${width}"${height?` height="${height}"`:''} border="0" style="display:block;width:100%;max-width:${width}px;height:auto;border:0;outline:none;text-decoration:none">${attrs.caption?`<p style="margin:10px 0 0;font:13px/1.6 Arial,Helvetica,sans-serif;color:#686354;text-align:${align}">${escape(attrs.caption).replace(/\r?\n/g,'<br>')}</p>`:''}</td></tr></table>`
  }
  return ''
}
export function plainTextToDocument(body:string):NewsletterDocumentNode{
  const paragraphs=body.trim()?body.trim().split(/\r?\n\s*\r?\n/):['']
  return {type:'doc',content:paragraphs.map(paragraph=>{const lines=paragraph.split(/\r?\n/),content:NewsletterDocumentNode[]=[];lines.forEach((line,index)=>{if(index)content.push({type:'hardBreak'});if(line)content.push({type:'text',text:line})});return {type:'paragraph',...(content.length?{content}:{})}})}
}
export const plainTextFromDocument=(doc:NewsletterDocumentNode):string=>documentText(validateNewsletterRichBody({version:1,doc}).doc).trim()
export const newsletterDocumentText=(richBody:NewsletterRichBody):string=>documentText(validateNewsletterRichBody(richBody).doc).trim()
export const renderNewsletterDocument=(richBody:NewsletterRichBody):string=>renderNode(validateNewsletterRichBody(richBody).doc)
