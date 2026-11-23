import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import { Extension, mergeAttributes, type Editor, type JSONContent } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import type { DOMOutputSpec } from '@tiptap/pm/model'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import { Color, TextStyle } from '@tiptap/extension-text-style'
import TextAlign from '@tiptap/extension-text-align'
import { Modal } from './ui'
import { adminFetch } from './store'
import type { NewsletterAsset, NewsletterDraft, NewsletterRichBody } from './newsletter-types'
import { NEWSLETTER_COLORS, newsletterDocumentText, plainTextToDocument, safeNewsletterImageUrl, safeNewsletterLinkUrl, validateNewsletterRichBody } from './newsletter-document'
import './RichLetterEditor.css'

type Props = {
  value: NewsletterDraft
  onChange: (value: { body: string; richBody: NewsletterRichBody }) => void
  disabled?: boolean
  assets?: NewsletterAsset[]
  labelledBy: string
  validationError?: string
  onValidityChange?: (valid: boolean, message: string) => void
}
type Selection = { from: number; to: number }
type PreparedImage = { base64: string; contentType: 'image/jpeg' | 'image/png'; width: number; height: number; bytes: number; previewUrl: string; needsConversion: boolean; converted: boolean }
type UploadBody = { requestId: string; contentType: 'image/jpeg' | 'image/png'; base64: string; label: string; alt: string }
class UploadError extends Error { constructor(message: string, public status: number) { super(message) } }
const MAX_IMAGE_BYTES = 128 * 1024
const imageBlob = (canvas: HTMLCanvasElement, contentType: string, quality?: number) => new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('The image could not be prepared.')), contentType, quality))
async function prepareImage(file: File, convertPng = false): Promise<PreparedImage> {
  if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 20 * 1024 * 1024) throw new Error('Choose a JPG or PNG photograph smaller than 20 MB.')
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas'), context = canvas.getContext('2d')
    if (!context) throw new Error('This browser could not prepare the image. Try another photograph.')
    let longest = Math.min(1280, Math.max(bitmap.width, bitmap.height))
    const contentType = file.type === 'image/png' && !convertPng ? 'image/png' : 'image/jpeg'
    function draw() {
      const scale = Math.min(1, longest / Math.max(bitmap.width, bitmap.height))
      canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      if (contentType === 'image/jpeg') { context!.fillStyle = '#fcfaf5'; context!.fillRect(0, 0, canvas.width, canvas.height) }
      context!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    }
    draw()
    let blob = await imageBlob(canvas, contentType, .88)
    if (contentType === 'image/jpeg') {
      while (blob.size > MAX_IMAGE_BYTES) {
        for (const quality of [.8, .7, .6, .5, .4]) { blob = await imageBlob(canvas, contentType, quality); if (blob.size <= MAX_IMAGE_BYTES) break }
        if (blob.size <= MAX_IMAGE_BYTES) break
        if (longest <= 400) throw new Error('This photograph is still too large. Choose a simpler or smaller image.')
        longest = Math.max(400, Math.floor(longest * .8)); draw()
      }
    }
    const needsConversion = blob.size > MAX_IMAGE_BYTES
    let base64 = ''
    if (!needsConversion) {
      const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = ''
      for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
      base64 = btoa(binary)
    }
    return { base64, contentType, width: canvas.width, height: canvas.height, bytes: blob.size, previewUrl: URL.createObjectURL(blob), needsConversion, converted: file.type === 'image/png' && convertPng }
  } finally { bitmap.close() }
}
const colorNames = ['Ink', 'Sergio red', 'Olive', 'Stone', 'Plum', 'Ochre']
const fingerprint = (value: NewsletterDraft) => JSON.stringify(value.richBody || { legacy: value.body })
const asDoc = (value: NewsletterDraft): JSONContent => value.richBody?.doc || plainTextToDocument(value.body)
/** Tiptap 3 adds a null title to Link marks; it has no letter semantics. */
export function normalizeEditorRichBody(value: JSONContent): NewsletterRichBody {
  const doc = structuredClone(value)
  function visit(node: JSONContent) {
    for (const mark of node.marks || []) {
      if (mark.type === 'link' && mark.attrs?.title === null) delete mark.attrs.title
    }
    for (const child of node.content || []) visit(child)
  }
  visit(doc)
  return validateNewsletterRichBody({ version: 1, doc })
}
function paletteColor(value: string): string | null {
  let color = value.trim().toLowerCase()
  const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(color)
  if (rgb) color = '#' + rgb.slice(1).map(part => Number(part).toString(16).padStart(2, '0')).join('')
  return NEWSLETTER_COLORS.includes(color as typeof NEWSLETTER_COLORS[number]) ? color : null
}
const LetterColor = Color.extend({
  addGlobalAttributes() {
    return [{ types: ['textStyle'], attributes: { color: { default: null, parseHTML: (element: HTMLElement) => paletteColor(element.style.color), renderHTML: (attrs: Record<string, unknown>) => attrs.color ? { style: `color:${attrs.color}` } : {} } } }]
  },
})
const LetterImage = Image.extend({
  addAttributes() {
    return { ...this.parent?.(), caption: { default: null, parseHTML: element => element.closest('figure')?.querySelector('figcaption')?.textContent || null } }
  },
  parseHTML() {
    return [{ tag: 'img[src]', getAttrs: element => {
      const src = safeNewsletterImageUrl(element.getAttribute('src'))
      const alt = element.getAttribute('alt')?.trim()
      return src && alt ? { src, alt } : false
    } }]
  },
  renderHTML({ HTMLAttributes }) {
    const { caption, ...attrs } = HTMLAttributes
    return ['figure', { 'data-letter-image': '', style: `max-width:${Number(attrs.width) || 600}px` }, ['img', mergeAttributes(attrs, { loading: 'lazy', referrerpolicy: 'no-referrer', style: 'max-width:100%;height:auto' })], ...(caption ? [['figcaption', {}, String(caption)]] : [])] as DOMOutputSpec
  },
}).configure({ allowBase64: false, inline: false, resize: false })

function ToolIcon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    bullets: <><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3" cy="6" r=".6"/><circle cx="3" cy="12" r=".6"/><circle cx="3" cy="18" r=".6"/></>,
    numbers: <><path d="M9 6h12M9 12h12M9 18h12M3 4v4M2 4h1M2 13c0-2 3-2 3 0 0 1-3 2-3 4h3"/></>,
    quote: <><path d="M4 7h6v6H5c0 3 2 4 4 4M14 7h6v6h-5c0 3 2 4 4 4"/></>,
    link: <><path d="m10 14 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/></>,
    image: <><rect x="3" y="3" width="18" height="18" rx="1"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 3-3 5 5"/></>,
    left: <path d="M3 5h18M3 10h11M3 15h18M3 20h11"/>,
    center: <path d="M3 5h18M7 10h10M3 15h18M7 20h10"/>,
    right: <path d="M3 5h18M10 10h11M3 15h18M10 20h11"/>,
    undo: <><path d="m8 4-5 5 5 5M3 9h10a7 7 0 0 1 7 7v3"/></>,
    redo: <><path d="m16 4 5 5-5 5m5-5H11a7 7 0 0 0-7 7v3"/></>,
    clear: <><path d="M5 4h14M12 4 8 17m6-1 6 6m0-6-6 6"/></>,
    rule: <path d="M3 12h18"/>,
  }
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

export default function RichLetterEditor({ value, onChange, disabled = false, assets = [], labelledBy, validationError = '', onValidityChange }: Props) {
  const id = useId()
  const [dialog, setDialog] = useState<'link' | 'image' | null>(null)
  const [notice, setNotice] = useState('')
  const [localValidationError, setLocalValidationError] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [linkText, setLinkText] = useState('')
  const [existingLink, setExistingLink] = useState(false)
  const [imageSource, setImageSource] = useState<'library' | 'url' | 'upload'>('library')
  const [image, setImage] = useState({ src: '', alt: '', caption: '', width: 600 })
  const [dialogError, setDialogError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [prepared, setPrepared] = useState<PreparedImage | null>(null)
  const [uploadLabel, setUploadLabel] = useState('')
  const [uploadError, setUploadError] = useState('')
  const [uploadUncertain, setUploadUncertain] = useState(false)
  const [catalog, setCatalog] = useState<NewsletterAsset[]>(assets)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogError, setCatalogError] = useState('')
  const [editingImage, setEditingImage] = useState(false)
  const selection = useRef<Selection>({ from: 1, to: 1 })
  const onChangeRef = useRef(onChange)
  const validityRef = useRef(onValidityChange)
  const localFile = useRef<File | null>(null)
  const uploadAttempt = useRef<UploadBody | null>(null)
  const uploadBusy = useRef(false)
  const lastValue = useRef(fingerprint(value))
  onChangeRef.current = onChange
  validityRef.current = onValidityChange
  const editorError = validationError || localValidationError
  function reportValidity(message: string) {
    setLocalValidationError(message)
    validityRef.current?.(!message, message)
  }
  const imageAssets = catalog.filter(asset => safeNewsletterImageUrl(asset.url))
  useEffect(() => () => { if (prepared) URL.revokeObjectURL(prepared.previewUrl) }, [prepared])
  useEffect(() => {
    if (dialog !== 'image') return
    const controller = new AbortController()
    setCatalogLoading(true); setCatalogError('')
    void adminFetch('/api/newsletters/assets', { cache: 'no-store', signal: controller.signal }).then(async response => {
      const payload = await response.json().catch(() => null)
      if (!response.ok || !Array.isArray(payload?.assets)) throw new Error(payload?.error?.message || 'The image library could not be loaded.')
      if (!controller.signal.aborted) setCatalog(payload.assets)
    }).catch(error => { if (!controller.signal.aborted) setCatalogError(error instanceof Error ? error.message : 'The image library could not be loaded.') }).finally(() => { if (!controller.signal.aborted) setCatalogLoading(false) })
    return () => controller.abort()
  }, [dialog])
  const extensions = useMemo(() => [
    StarterKit.configure({ heading: { levels: [2, 3] }, code: false, codeBlock: false, trailingNode: false,
      link: { openOnClick: false, autolink: false, linkOnPaste: false, defaultProtocol: 'https', isAllowedUri: uri => !!safeNewsletterLinkUrl(uri) } }),
    TextStyle, LetterColor, TextAlign.configure({ types: ['paragraph', 'heading'], alignments: ['left', 'center', 'right'] }), LetterImage,
    Extension.create({ name: 'letterDocumentLimits', addProseMirrorPlugins() {
      return [new Plugin({ filterTransaction(transaction) {
        if (!transaction.docChanged) return true
        try { normalizeEditorRichBody(transaction.doc.toJSON()); return true }
        catch (error) { queueMicrotask(() => reportValidity(error instanceof Error ? error.message : 'That change is not supported in this letter.')); return false }
      } })]
    } }),
  ], [])
  const editor = useEditor({
    extensions, content: asDoc(value), editable: !disabled, immediatelyRender: false,
    editorProps: {
      attributes: { class: 'rich-letter-content', role: 'textbox', 'aria-multiline': 'true', 'aria-labelledby': labelledBy, 'aria-describedby': id + '-help' },
      handleKeyDown: (_view, event) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openLink(); return true } return false },
      handlePaste: (_view, event) => { const file = event.clipboardData?.files[0]; if (!file) return false; event.preventDefault(); void useFile(file); return true },
      handleDrop: (_view, event) => { const file = event.dataTransfer?.files[0]; if (!file) return false; event.preventDefault(); void useFile(file); return true },
    },
    onUpdate: ({ editor: current }) => {
      try {
        const richBody = normalizeEditorRichBody(current.getJSON())
        lastValue.current = JSON.stringify(richBody)
        onChangeRef.current({ richBody, body: newsletterDocumentText(richBody) })
        reportValidity(''); setNotice('')
      } catch (error) { reportValidity(error instanceof Error ? error.message : 'The visible letter could not be prepared for saving.') }
    },
  }, [])
  const state = useEditorState({ editor, selector: ({ editor: current }) => current ? ({ bold: current.isActive('bold'), italic: current.isActive('italic'), underline: current.isActive('underline'), bulletList: current.isActive('bulletList'), orderedList: current.isActive('orderedList'), quote: current.isActive('blockquote'), link: current.isActive('link'), image: current.isActive('image'), heading: current.isActive('heading', { level: 2 }) ? '2' : current.isActive('heading', { level: 3 }) ? '3' : 'p', align: current.getAttributes('paragraph').textAlign || current.getAttributes('heading').textAlign || 'left', color: current.getAttributes('textStyle').color || NEWSLETTER_COLORS[0], undo: current.can().undo(), redo: current.can().redo() }) : null })
  useEffect(() => { editor?.setEditable(!disabled, false) }, [editor, disabled])
  useEffect(() => {
    const key = fingerprint(value)
    if (!editor || key === lastValue.current) return
    editor.commands.setContent(asDoc(value), { emitUpdate: false })
    lastValue.current = key; setNotice(''); reportValidity('')
  }, [editor, value])

  function rememberSelection(current: Editor) { selection.current = { from: current.state.selection.from, to: current.state.selection.to } }
  function openLink() {
    if (!editor || disabled) return
    rememberSelection(editor); setExistingLink(editor.isActive('link')); setLinkUrl(editor.getAttributes('link').href || '')
    setLinkText(editor.state.doc.textBetween(selection.current.from, selection.current.to)); setDialogError(''); setDialog('link')
  }
  function openImage() {
    if (!editor || disabled) return
    rememberSelection(editor)
    if (uploadUncertain) { setImageSource('upload'); setDialog('image'); return }
    const active = editor.isActive('image'), attrs = active ? editor.getAttributes('image') : {}
    setEditingImage(active); setImage({ src: attrs.src || '', alt: attrs.alt || '', caption: attrs.caption || '', width: Number(attrs.width) || 600 })
    setImageSource(imageAssets.length && !active ? 'library' : 'url'); setDialogError(''); setDialog('image')
  }
  async function useFile(file: File) {
    if (disabled || uploadBusy.current || uploadUncertain) return
    if (editor) rememberSelection(editor)
    setImageSource('upload'); setDialog('image'); setEditingImage(false); setUploadError(''); setPreparing(true)
    localFile.current = file; uploadAttempt.current = null
    setUploadLabel(file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').slice(0, 120))
    setImage({ src: '', alt: '', caption: '', width: 600 })
    try { setPrepared(await prepareImage(file)) }
    catch (error) { setPrepared(null); setUploadError(error instanceof Error ? error.message : 'The image could not be prepared.') }
    finally { setPreparing(false) }
  }
  async function convertPng() {
    if (!localFile.current || preparing) return
    setPreparing(true); setUploadError('')
    try { setPrepared(await prepareImage(localFile.current, true)) }
    catch (error) { setUploadError(error instanceof Error ? error.message : 'The image could not be converted.') }
    finally { setPreparing(false) }
  }
  async function publishImage() {
    if (uploadBusy.current || !prepared || prepared.needsConversion) return
    if (!uploadUncertain && (!uploadLabel.trim() || !image.alt.trim())) { setUploadError('Add a library name and a description of the image before publishing.'); return }
    const body = uploadUncertain && uploadAttempt.current ? uploadAttempt.current : { requestId: crypto.randomUUID(), contentType: prepared.contentType, base64: prepared.base64, label: uploadLabel.trim(), alt: image.alt.trim() }
    uploadAttempt.current = body; uploadBusy.current = true; setUploading(true); setUploadError('')
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 20000)
    try {
      const response = await adminFetch('/api/newsletters/assets', { method: 'POST', cache: 'no-store', signal: controller.signal, headers: { 'Content-Type': 'application/json', 'X-Admin-Request': '1' }, body: JSON.stringify(body) })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new UploadError(payload?.error?.message || 'The image could not be published.', response.status)
      if (!payload?.asset || !safeNewsletterImageUrl(payload.asset.url) || !Array.isArray(payload.assets)) throw new Error('The upload response could not be confirmed.')
      const asset = payload.asset as NewsletterAsset
      setCatalog(payload.assets); setImage(current => ({ ...current, src: asset.url, alt: asset.alt || body.alt, width: 600 }))
      setUploadUncertain(false); uploadAttempt.current = null; setImageSource('library'); setPrepared(null)
      setNotice('Your image is published in the library. Add it to the letter when you are ready.')
    } catch (error) {
      const status = error instanceof Error && 'status' in error && typeof error.status === 'number' ? error.status : 0
      if (!status || status >= 500) { setUploadUncertain(true); setUploadError('The upload result is not confirmed. Retry this same upload before publishing another image; its request ID is retained.') }
      else { setUploadUncertain(false); uploadAttempt.current = null; setUploadError(error instanceof Error ? error.message : 'The image could not be published.') }
    } finally { window.clearTimeout(timeout); uploadBusy.current = false; setUploading(false) }
  }
  function applyLink() {
    const url = safeNewsletterLinkUrl(linkUrl.trim())
    if (!url || !editor) { setDialogError('Use a complete HTTPS address, such as https://your-website.com/page.'); return }
    const chain = editor.chain().focus().setTextSelection(selection.current)
    if (selection.current.from === selection.current.to && !existingLink) {
      if (!linkText.trim()) { setDialogError('Add the words you want the reader to click.'); return }
      chain.insertContent({ type: 'text', text: linkText.trim(), marks: [{ type: 'link', attrs: { href: url } }] }).run()
    } else chain.extendMarkRange('link').setLink({ href: url }).run()
    setDialog(null)
  }
  function applyImage() {
    const src = safeNewsletterImageUrl(image.src.trim())
    if (!src || !editor) { setDialogError('Use a complete HTTPS address ending in .jpg, .jpeg, .png, .webp or .gif.'); return }
    if (!image.alt.trim()) { setDialogError('Describe the image so everyone can understand your letter.'); return }
    const attrs = { src, alt: image.alt.trim(), width: image.width, height: null, title: null, caption: image.caption.trim() || null }
    const chain = editor.chain().focus()
    if (editingImage) chain.setNodeSelection(selection.current.from).updateAttributes('image', attrs).run()
    else chain.setTextSelection(selection.current).insertContent({ type: 'image', attrs }).run()
    setDialog(null)
  }
  function uploadPanel() {
    return <section className="rich-letter-upload-panel" aria-label="Publish an image">
      <p className="rich-letter-public-note"><strong>A public image, ready to share.</strong> Published images are persistent public files. Choose a photograph you own or have permission to share. Publishing an image does not send your letter.</p>
      <label className="rich-letter-file-picker">Choose a JPG or PNG<input type="file" accept="image/jpeg,image/png" disabled={uploading || preparing || uploadUncertain} onChange={event => { const file = event.target.files?.[0]; if (file) void useFile(file); event.target.value = '' }}/></label>
      {preparing && <p className="rich-letter-upload-status" role="status">Preparing your photograph on this device…</p>}
      {prepared && <><figure className="rich-letter-image-preview local"><img src={prepared.previewUrl} alt={image.alt || 'Your selected image, not yet published'}/><figcaption>{prepared.width} × {prepared.height} px · {Math.ceil(prepared.bytes / 1024)} KB · {prepared.converted ? 'Converted to JPEG on an ivory background' : prepared.contentType === 'image/png' ? 'PNG transparency preserved' : 'Prepared as JPEG'}</figcaption></figure>
        {prepared.needsConversion ? <div className="rich-letter-png-choice"><p>This PNG is larger than the 128 KB image limit after resizing. You can choose a smaller PNG, or convert it to JPEG. Any transparency will be replaced by ivory.</p><button type="button" className="button secondary" disabled={preparing} onClick={() => void convertPng()}>Convert to JPEG on ivory</button></div> : <><label className="field">Name in your image library<input maxLength={120} value={uploadLabel} disabled={uploading || uploadUncertain} onChange={event => setUploadLabel(event.target.value)} placeholder="A name you will recognise later"/></label><label className="field">Describe the image<input maxLength={300} value={image.alt} disabled={uploading || uploadUncertain} onChange={event => setImage(current => ({ ...current, alt: event.target.value }))} placeholder="What should a reader know if they cannot see it?"/><small>This description accompanies the published image and is used as alternative text.</small></label><button type="button" className="button" disabled={uploading || preparing} onClick={() => void publishImage()}>{uploading ? 'Publishing image…' : uploadUncertain ? 'Retry the same upload' : 'Publish image to library'}</button></>}
      </>}
      {uploadError && <p className="rich-letter-error" role="alert">{uploadError}</p>}
    </section>
  }
  function tool(label: string, command: () => void, children: ReactNode, active: boolean | undefined = undefined, unavailable = false) {
    return <button type="button" title={label} aria-label={label} aria-pressed={active} disabled={disabled || !editor || unavailable} onMouseDown={event => event.preventDefault()} onClick={command}>{children}</button>
  }
  return <div className={'rich-letter-editor' + (disabled ? ' is-disabled' : '')}>
    <div className="rich-letter-toolbar" role="toolbar" aria-label="Letter formatting" onKeyDown={event => {
      if (event.target instanceof HTMLSelectElement || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('button:not(:disabled),select:not(:disabled)'))
      const index = controls.indexOf(event.target as HTMLButtonElement)
      if (index < 0) return
      event.preventDefault(); controls[event.key === 'Home' ? 0 : event.key === 'End' ? controls.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + controls.length) % controls.length]?.focus()
    }}>
      <div className="rich-letter-tools"><label className="rich-letter-style"><span className="sr-only">Text style</span><select aria-label="Text style" disabled={disabled || !editor} value={state?.heading || 'p'} onChange={event => event.target.value === 'p' ? editor?.chain().focus().setParagraph().run() : editor?.chain().focus().toggleHeading({ level: Number(event.target.value) as 2 | 3 }).run()}><option value="p">Body text</option><option value="2">Heading</option><option value="3">Small heading</option></select></label>
        <div className="rich-letter-tool-group">{tool('Bold (⌘/Ctrl+B)', () => editor?.chain().focus().toggleBold().run(), <strong>B</strong>, state?.bold)}{tool('Italic (⌘/Ctrl+I)', () => editor?.chain().focus().toggleItalic().run(), <em>I</em>, state?.italic)}{tool('Underline (⌘/Ctrl+U)', () => editor?.chain().focus().toggleUnderline().run(), <u>U</u>, state?.underline)}</div>
        <div className="rich-letter-tool-group">{tool('Bulleted list', () => editor?.chain().focus().toggleBulletList().run(), <ToolIcon name="bullets"/>, state?.bulletList)}{tool('Numbered list', () => editor?.chain().focus().toggleOrderedList().run(), <ToolIcon name="numbers"/>, state?.orderedList)}{tool('Quotation', () => editor?.chain().focus().toggleBlockquote().run(), <ToolIcon name="quote"/>, state?.quote)}</div>
        <div className="rich-letter-tool-group">{tool('Add or edit link (⌘/Ctrl+K)', openLink, <ToolIcon name="link"/>, state?.link)}{tool('Add or edit image', openImage, <><ToolIcon name="image"/><span>Image</span></>, state?.image)}</div>
      </div>
      <div className="rich-letter-tools secondary"><div className="rich-letter-tool-group">{(['left', 'center', 'right'] as const).map(align => <button key={align} type="button" title={`Align ${align}`} aria-label={`Align ${align}`} aria-pressed={state?.align === align} disabled={disabled || !editor} onMouseDown={event => event.preventDefault()} onClick={() => editor?.chain().focus().setTextAlign(align).run()}><ToolIcon name={align}/></button>)}</div><div className="rich-letter-palette" role="group" aria-label="Text color"><span>Color</span>{NEWSLETTER_COLORS.map((color, index) => <button key={color} type="button" className="rich-letter-swatch" style={{ '--letter-swatch': color } as React.CSSProperties} aria-label={`${colorNames[index]} text`} title={colorNames[index]} aria-pressed={state?.color === color} disabled={disabled || !editor} onMouseDown={event => event.preventDefault()} onClick={() => color === NEWSLETTER_COLORS[0] ? editor?.chain().focus().unsetColor().run() : editor?.chain().focus().setColor(color).run()}><span/></button>)}</div><div className="rich-letter-tool-group rich-letter-history-tools">{tool('Undo (⌘/Ctrl+Z)', () => editor?.chain().focus().undo().run(), <ToolIcon name="undo"/>, undefined, !state?.undo)}{tool('Redo (⌘/Ctrl+Shift+Z)', () => editor?.chain().focus().redo().run(), <ToolIcon name="redo"/>, undefined, !state?.redo)}{tool('Clear text formatting', () => editor?.chain().focus().unsetAllMarks().clearNodes().run(), <ToolIcon name="clear"/>)}</div></div>
    </div>
    {state?.image && <div className="rich-letter-selected-image"><span>Image selected</span><button type="button" disabled={disabled} onClick={openImage}>Edit image & caption</button><button type="button" disabled={disabled} onClick={() => editor?.chain().focus().deleteSelection().run()}>Remove image</button></div>}
    <EditorContent editor={editor}/>
    {editorError && <div className="rich-letter-validation" role="alert"><strong>This letter needs attention before saving.</strong><p>{editorError} Unsupported changes are not silently saved. Your current visible letter is retained.</p><button type="button" disabled={disabled || !editor} onClick={() => {
      if (!editor) return
      try { const richBody = normalizeEditorRichBody(editor.getJSON()); lastValue.current = JSON.stringify(richBody); onChangeRef.current({ richBody, body: newsletterDocumentText(richBody) }); reportValidity('') }
      catch (error) { reportValidity(error instanceof Error ? error.message : 'Correct the unsupported formatting first.') }
    }}>Review and keep the current letter</button></div>}
    <div className="rich-letter-editor-footnote" id={id + '-help'}><span>Your formatted email includes a readable plain-text version.</span><span>A signed footer is added automatically.</span></div>
    {(notice || uploading) && <p className="rich-letter-notice" role="status">{uploading ? 'Uploading your image…' : notice}</p>}
    {dialog === 'link' && <Modal title={existingLink ? 'Edit the link' : 'Add a useful link'} subtitle="Choose clear words and a complete HTTPS destination." onClose={() => setDialog(null)}><form onSubmit={event => { event.preventDefault(); applyLink() }}><div className="modal-body rich-letter-dialog">{selection.current.from === selection.current.to && !existingLink && <label className="field">Link text<input autoFocus required maxLength={300} value={linkText} onChange={event => setLinkText(event.target.value)} placeholder="See what’s coming to the table"/></label>}<label className="field">Web address<input autoFocus={selection.current.from !== selection.current.to || existingLink} required type="url" maxLength={2048} value={linkUrl} onChange={event => setLinkUrl(event.target.value)} placeholder="https://…"/></label>{dialogError && <p className="rich-letter-error" role="alert">{dialogError}</p>}</div><footer className="modal-actions">{existingLink && <button type="button" className="rich-letter-remove" onClick={() => { editor?.chain().focus().setTextSelection(selection.current).extendMarkRange('link').unsetLink().run(); setDialog(null) }}>Remove link</button>}<button type="button" className="button secondary" onClick={() => setDialog(null)}>Cancel</button><button className="button">Save link</button></footer></form></Modal>}
    {dialog === 'image' && <Modal title={editingImage ? 'A little care for this image.' : 'Bring something into the letter.'} subtitle="Choose your photograph, an approved library image, or a public HTTPS image address." onClose={() => { if (!uploading && !preparing) setDialog(null) }} wide>
      <form onSubmit={event => { event.preventDefault(); if (imageSource !== 'upload') applyImage() }}><div className="modal-body rich-letter-dialog">
        <div className="rich-letter-image-tabs" aria-label="Image source"><button type="button" disabled={uploading || uploadUncertain} aria-pressed={imageSource === 'library'} onClick={() => setImageSource('library')}>Your image library</button><button type="button" aria-pressed={imageSource === 'upload'} onClick={() => setImageSource('upload')}>Upload a photograph</button><button type="button" disabled={uploading || uploadUncertain} aria-pressed={imageSource === 'url'} onClick={() => setImageSource('url')}>Image address</button></div>
        {imageSource === 'upload' ? uploadPanel() : imageSource === 'library' ? <>
          {catalogLoading && <p className="rich-letter-upload-status" role="status">Opening your image library…</p>}
          {catalogError && <p className="rich-letter-error" role="alert">{catalogError}</p>}
          {imageAssets.length ? <div className="rich-letter-asset-grid">{imageAssets.map(asset => <button key={asset.id} type="button" aria-pressed={image.src === asset.url} onClick={() => { setImage(current => ({ ...current, src: asset.url, alt: asset.alt || current.alt })); setDialogError('') }}><img src={asset.url} alt="" loading="lazy" referrerPolicy="no-referrer"/><span>{asset.label}</span></button>)}</div> : !catalogLoading && <div className="rich-letter-library-empty"><p>Your own photographs can live here.</p><button type="button" className="button secondary" onClick={() => setImageSource('upload')}>Publish your first image</button></div>}
        </> : <label className="field">Image address<input required type="url" maxLength={2048} value={image.src} onChange={event => setImage(current => ({ ...current, src: event.target.value }))} placeholder="https://your-website.com/photograph.jpg"/><small>JPG, PNG, WebP or GIF. Embedded images and SVG are not used in email.</small></label>}
        {imageSource !== 'upload' && <><div className="rich-letter-image-details"><div><label className="field">Describe the image<input required maxLength={300} value={image.alt} onChange={event => setImage(current => ({ ...current, alt: event.target.value }))} placeholder="What should a reader know if they cannot see it?"/><small>This alternative text is included with the image.</small></label><label className="field">Caption <span>Optional</span><input maxLength={400} value={image.caption} onChange={event => setImage(current => ({ ...current, caption: event.target.value }))}/></label></div><label className="field">Image width<select value={image.width} onChange={event => setImage(current => ({ ...current, width: Number(event.target.value) }))}><option value={600}>Full · 600 px</option><option value={420}>Medium · 420 px</option><option value={280}>Small · 280 px</option>{![280, 420, 600].includes(image.width) && <option value={image.width}>{image.width} px</option>}</select><small>Automatically fits smaller screens.</small></label></div>
          {safeNewsletterImageUrl(image.src) && <figure className="rich-letter-image-preview"><img src={image.src} alt={image.alt} referrerPolicy="no-referrer" style={{ maxWidth: Math.min(image.width, 600) }}/>{image.caption && <figcaption>{image.caption}</figcaption>}</figure>}
        </>}
        {dialogError && <p className="rich-letter-error" role="alert">{dialogError}</p>}
      </div><footer className="modal-actions"><button type="button" className="button secondary" disabled={uploading || preparing} onClick={() => setDialog(null)}>Cancel</button><button className="button" disabled={uploading || preparing || uploadUncertain || imageSource === 'upload' || !safeNewsletterImageUrl(image.src)}>{editingImage ? 'Save image' : 'Add image to letter'}</button></footer></form>
    </Modal>}

  </div>
}
