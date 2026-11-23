import React, { createContext, useContext, useId, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
export function Icon({name,size=20,...props}:{name:string;size?:number}&React.SVGProps<SVGSVGElement>){
 const paths: Record<string,React.ReactNode>={
  home:<><path d="m3 10 9-7 9 7v10H3Z"/><path d="M9 20v-7h6v7"/></>,book:<><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h4"/></>,calendar:<><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-13 5h2m4 0h2"/></>,globe:<><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/></>,chevron:<path d="m9 5 7 7-7 7"/>,down:<path d="m6 9 6 6 6-6"/>,search:<><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,plus:<path d="M12 5v14M5 12h14"/>,close:<path d="m6 6 12 12M18 6 6 18"/>,check:<path d="m5 12 4 4L19 6"/>,clock:<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,people:<><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2m1-15a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v2"/></>,shield:<><path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6Z"/><path d="m8 12 3 3 5-6"/></>,logout:<><path d="M9 4H4v16h5m5-13 5 5-5 5m-6-5h11"/></>,menu:<path d="M4 6h16M4 12h16M4 18h16"/>,edit:<><path d="m15 4 5 5M4 20l5-1L21 7l-5-5L4 14Z"/></>,mail:<><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/></>,pin:<><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/></>,external:<><path d="M14 3h7v7m0-7L10 14M9 4H4v16h16v-5"/></>,history:<><path d="M3 5v5h5M3 10a9 9 0 1 1 1 8m8-12v6l4 2"/></>,card:<><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/></>,sun:<><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></>,cutlery:<><path d="M6 3v6m-3-6v4a3 3 0 0 0 6 0V3M6 10v11M18 3c-4 3-4 9 0 9m0-9v18"/></>,info:<><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-11v1"/></>,undo:<><path d="m8 4-5 5 5 5M3 9h10a7 7 0 0 1 7 7v4"/></>,lock:<><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>}
 return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]||paths.info}</svg>
}
export function Badge({status,children}:{status:string;children?:React.ReactNode}){return <span className={'badge '+status}>{children||({requested:'New request',held:'Date held',confirmed:'Confirmed',cancelled:'Cancelled',draft:'Draft',published:'Published'}[status]||status)}</span>}
type ModalLayer = {
 id: string
 depth: number
 order: number
 root: HTMLDivElement
 backdrop: HTMLDivElement
 opener: HTMLElement | null
 close: () => void
}

// Portals make each window a sibling of the app. Only the active layer remains
// interactive; child dialogs never inherit their parent window's inert state.
const DepthContext = createContext(0)
const layers: ModalLayer[] = []
const covered = new Map<HTMLElement, { inert: boolean; hidden: string | null }>()
let sequence = 0
let originalOverflow = ''
let bodyObserver: MutationObserver | null = null
const topLayer = () => layers[layers.length - 1]
const focusableSelector = 'button:not(:disabled), a[href], input:not(:disabled):not([type="hidden"]), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'

function focusable(root: HTMLElement) {
 return Array.from(root.querySelectorAll<HTMLElement>(focusableSelector)).filter(element =>
  element.tabIndex >= 0 && element.getClientRects().length > 0 && !element.closest('[inert]') && getComputedStyle(element).visibility !== 'hidden'
 )
}
function restoreCovered(element: HTMLElement) {
 const previous = covered.get(element)
 if (!previous) return
 element.inert = previous.inert
 if (previous.hidden === null) element.removeAttribute('aria-hidden')
 else element.setAttribute('aria-hidden', previous.hidden)
 covered.delete(element)
}
function synchronizeLayers() {
 const top = topLayer()
 for (const [index, layer] of layers.entries()) {
  layer.backdrop.style.zIndex = String(100 + index * 10)
  layer.root.setAttribute('aria-modal', layer === top ? 'true' : 'false')
 }
 if (!top) {
  for (const element of Array.from(covered.keys())) restoreCovered(element)
  return
 }
 for (const element of Array.from(document.body.children)) {
  if (!(element instanceof HTMLElement) || ['SCRIPT', 'STYLE', 'LINK'].includes(element.tagName)) continue
  // Noninteractive live announcements stay readable while the app is inert.
  if (element === top.backdrop || element.hasAttribute('data-modal-live')) { restoreCovered(element); continue }
  if (!covered.has(element)) covered.set(element, { inert: element.inert, hidden: element.getAttribute('aria-hidden') })
  element.inert = true
  element.setAttribute('aria-hidden', 'true')
 }
}
function handleModalKey(event: KeyboardEvent) {
 const top = topLayer()
 if (!top) return
 if (event.key === 'Escape' && !event.isComposing) {
  event.preventDefault()
  event.stopImmediatePropagation()
  top.close()
  return
 }
 if (event.key !== 'Tab') return
 const items = focusable(top.root)
 const first = items[0], last = items[items.length - 1]
 if (!first) { event.preventDefault(); top.root.focus({ preventScroll: true }); return }
 const active = document.activeElement
 if (event.shiftKey && (active === first || active === top.root || !top.root.contains(active))) {
  event.preventDefault(); last.focus()
 } else if (!event.shiftKey && (active === last || active === top.root || !top.root.contains(active))) {
  event.preventDefault(); first.focus()
 }
}
function containModalFocus(event: FocusEvent) {
 const top = topLayer()
 if (top && event.target instanceof Node && !top.root.contains(event.target)) top.root.focus({ preventScroll: true })
}
function registerLayer(layer: ModalLayer) {
 if (!layers.length) {
  originalOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  document.addEventListener('keydown', handleModalKey, true)
  document.addEventListener('focusin', containModalFocus, true)
  bodyObserver = new MutationObserver(synchronizeLayers)
  bodyObserver.observe(document.body, { childList: true })
 }
 layers.push(layer)
 layers.sort((a, b) => a.depth - b.depth || a.order - b.order)
 synchronizeLayers()
 if (topLayer() === layer) layer.root.focus({ preventScroll: true })
 return () => {
  const wasTop = topLayer() === layer
  const index = layers.indexOf(layer)
  if (index !== -1) layers.splice(index, 1)
  // React removes the portal after effect cleanup; restore it before removal.
  restoreCovered(layer.backdrop)
  synchronizeLayers()
  if (!layers.length) {
   bodyObserver?.disconnect(); bodyObserver = null
   document.body.style.overflow = originalOverflow
   document.removeEventListener('keydown', handleModalKey, true)
   document.removeEventListener('focusin', containModalFocus, true)
  }
  if (wasTop) {
   const opener = layer.opener
   if (opener?.isConnected && !opener.closest('[inert]') && !opener.matches(':disabled')) {
    opener.focus({ preventScroll: true })
    if(document.activeElement!==opener)topLayer()?.root.focus({preventScroll:true})
   } else topLayer()?.root.focus({ preventScroll: true })
  }
 }
}

type DialogFrameProps = {
 title: string
 description?: string
 children: React.ReactNode
 onClose: () => void
 workspace?: boolean
 wide?: boolean
}
function DialogFrame({ title, description, children, onClose, workspace = false, wide = false }: DialogFrameProps) {
 const id = useId()
 const depth = useContext(DepthContext)
 const ref = useRef<HTMLDivElement>(null)
 const backdrop = useRef<HTMLDivElement>(null)
 const opener = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null)
 const close = useRef(onClose)
 close.current = onClose
 useLayoutEffect(() => {
  if (!ref.current || !backdrop.current) return
  return registerLayer({ id, depth, order: ++sequence, root: ref.current, backdrop: backdrop.current, opener: opener.current, close: () => close.current() })
 }, [id, depth])
 useLayoutEffect(() => {
  if (topLayer()?.id === id) ref.current?.focus({ preventScroll: true })
 }, [id, title])
 const dismissBackdrop = (event: React.MouseEvent<HTMLDivElement>) => {
  if (event.target === event.currentTarget && topLayer()?.id === id) close.current()
 }
 return createPortal(<DepthContext.Provider value={depth + 1}>
  <div ref={backdrop} className={workspace ? 'modal-backdrop workspace-window-backdrop' : 'modal-backdrop'} onMouseDown={dismissBackdrop}>
   <div ref={ref} tabIndex={-1} className={workspace ? 'workspace-window' : 'modal ' + (wide ? 'wide' : '')} role="dialog" aria-modal="true" aria-labelledby={id + '-title'} aria-describedby={description ? id + '-description' : undefined}>
    <header className={workspace ? 'workspace-window-header' : 'modal-header'}>
     <div><h2 id={id + '-title'}>{title}</h2>{description && <p id={id + '-description'}>{description}</p>}</div>
     <button className="icon-button" aria-label={workspace ? `Close ${title}` : 'Close dialog'} onClick={() => close.current()}><Icon name="close"/></button>
    </header>
    {workspace ? <div className="workspace-window-content">{children}</div> : children}
   </div>
  </div>
 </DepthContext.Provider>, document.body)
}

export function Modal({ title, subtitle, children, onClose, wide = false }: { title: string; subtitle?: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
 return <DialogFrame title={title} description={subtitle} onClose={onClose} wide={wide}>{children}</DialogFrame>
}

export function WorkspaceWindow({ title, description, children, onClose }: { title: string; description?: string; children: React.ReactNode; onClose: () => void }) {
 return <DialogFrame title={title} description={description} onClose={onClose} workspace>{children}</DialogFrame>
}
