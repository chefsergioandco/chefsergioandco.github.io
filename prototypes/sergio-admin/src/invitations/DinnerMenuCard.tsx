import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { buildMenuArtwork, type DinnerMenuDocument, type MenuArtwork } from '../../shared/invitations/menu-artwork'
import { INVITATION_COLORS, INVITATION_FONTS } from '../../shared/invitations/artwork'
import { cottonPaper, createFoilRenderer, type FoilRenderer } from './foil-renderer'
import { usePaperRotation } from './usePaperRotation'
import './DinnerMenuCard.css'

export type DinnerMenuCardProps = {
  document: DinnerMenuDocument; className?: string
  /** A flat 5 × 8 inch insert, initially horizontal inside the invitation. */
  inserted?: boolean
  /** Parent-owned extraction timeline: 0 is horizontal; 1 is upright and readable. */
  revealProgress?: number
  onRevealRequest?: (reveal: boolean) => void
  onOpen?: () => void
  onRevealChange?: (revealed: boolean) => void
}
const logoUrl = `${import.meta.env.BASE_URL}invitations/logo-primary-ink.svg`
const radians = (degrees: number) => degrees * Math.PI / 180
const READING_ANGLE = -12

type MenuPose = { yaw: number; pitch: number }

function MenuSurface({ artwork, embedded = false, pose, onMaterialReady }: { artwork: MenuArtwork; embedded?: boolean; pose?: MenuPose; onMaterialReady?: (ready: boolean) => void }) {
  const surface = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), renderer = useRef<FoilRenderer | null>(null)
  const [nearby, setNearby] = useState(false), [ready, setReady] = useState(false), [generation, setGeneration] = useState(0)
  const rotation = usePaperRotation({ yaw: READING_ANGLE, pitch: 4, enabled: !embedded }), currentPose = useRef(pose ?? { yaw: rotation.yaw, pitch: rotation.pitch })
  const materialPose = pose ?? rotation
  currentPose.current = { yaw: materialPose.yaw, pitch: materialPose.pitch }
  useEffect(() => {
    const node = surface.current
    if (!node) return
    if (!('IntersectionObserver' in window)) { setNearby(true); return }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setNearby(true); observer.disconnect() }
    }, { rootMargin: '320px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!nearby || !canvas.current) return
    const target = canvas.current
    let cancelled = false
    setReady(false); onMaterialReady?.(false)
    const load = async () => {
      const logo = new Image()
      const logoLoaded = new Promise<void>((resolve, reject) => { logo.onload = () => resolve(); logo.onerror = () => reject(new Error('Menu logo unavailable')) })
      logo.src = logoUrl
      const usedFonts = [...new Set(artwork.commands.flatMap(command => command.kind === 'text' ? [command.font] : []))]
      await Promise.all([logoLoaded, ...usedFonts.map(font => document.fonts.load(`${font === 'italic' ? 'italic ' : ''}400 32px "${INVITATION_FONTS[font]}"`))])
      if (cancelled) return
      const scale = 3, width = artwork.width * scale, height = artwork.height * scale
      const color = document.createElement('canvas'); color.width = width; color.height = height
      const context = color.getContext('2d')!
      context.scale(scale, scale); context.textBaseline = 'alphabetic'; context.fontKerning = 'none'
      for (const command of artwork.commands) {
        if (command.kind === 'logo') { context.drawImage(logo, command.x, command.y, command.width, command.height); continue }
        if (command.kind === 'line') {
          context.strokeStyle = INVITATION_COLORS[command.color]; context.lineWidth = command.width
          context.beginPath(); context.moveTo(command.x1, command.y); context.lineTo(command.x2, command.y); context.stroke(); continue
        }
        context.fillStyle = INVITATION_COLORS[command.color]
        context.font = `${command.font === 'italic' ? 'italic ' : ''}${command.weight} ${command.size}px "${INVITATION_FONTS[command.font]}"`
        const characters = [...command.text], advances = characters.map(character => context.measureText(character).width)
        const spacing = characters.length > 1 ? (command.width - advances.reduce((sum, advance) => sum + advance, 0)) / (characters.length - 1) : 0
        let x = command.x - command.width / 2
        context.textAlign = 'left'
        characters.forEach((character, index) => { context.fillText(character, x, command.y); x += advances[index] + spacing })
      }
      const impression = document.createElement('canvas'); impression.width = width; impression.height = height
      const impressionContext = impression.getContext('2d')!; impressionContext.filter = 'blur(.7px)'; impressionContext.drawImage(color, 0, 0)
      // Matching portrait textures preserve the cotton grain and inward glyph normals.
      const material = createFoilRenderer(target, cottonPaper(width, height), color, impression, true)
      if (cancelled) { material?.dispose(); return }
      renderer.current = material
      if (material) { material.draw(radians(currentPose.current.yaw), true, radians(currentPose.current.pitch)); setReady(true); onMaterialReady?.(true) }
    }
    void load().catch(() => { if (!cancelled) { setReady(false); onMaterialReady?.(false) } })
    const lost = (event: Event) => { event.preventDefault(); setReady(false); onMaterialReady?.(false) }
    const restored = () => setGeneration(value => value + 1)
    target.addEventListener('webglcontextlost', lost); target.addEventListener('webglcontextrestored', restored)
    return () => {
      cancelled = true; renderer.current?.dispose(); renderer.current = null
      target.removeEventListener('webglcontextlost', lost); target.removeEventListener('webglcontextrestored', restored)
    }
  }, [artwork, nearby, generation, onMaterialReady])
  useEffect(() => { if (ready) renderer.current?.draw(radians(materialPose.yaw), true, radians(materialPose.pitch)) }, [materialPose.yaw, materialPose.pitch, ready])
  useEffect(() => {
    const target = canvas.current
    return () => {
      queueMicrotask(() => {
        if (!target || target.isConnected) return
        try { target.getContext('webgl')?.getExtension('WEBGL_lose_context')?.loseContext() } catch { /* Vector artwork remains available. */ }
      })
    }
  }, [])
  if (embedded) return <div ref={surface} className={`dinner-menu-insert-surface${ready ? ' has-material' : ''}`} data-menu-material={ready ? 'gloss-foil-debossed' : 'vector'} aria-hidden="true"><MenuVector artwork={artwork} /><canvas ref={canvas} width={1080} height={1728} aria-hidden="true" /></div>
  return <div ref={surface} className="dinner-menu-stage">
      <div className={`dinner-menu-paper${ready ? ' has-material' : ''}`} data-paper-rotation="" data-dragging={rotation.dragging} data-menu-material={ready ? 'gloss-foil-debossed' : 'vector'} data-menu-angle={rotation.yaw.toFixed(3)} data-menu-pitch={rotation.pitch.toFixed(3)} role="group" aria-label="Menu" tabIndex={0} {...rotation.handlers} style={{ transform: `rotateX(${rotation.pitch}deg) rotateY(${rotation.yaw}deg) rotateZ(-.25deg)` }}>
        <MenuVector artwork={artwork} />
        <canvas ref={canvas} width={1080} height={1728} aria-hidden="true" />
      </div>
    </div>
}

function MenuVector({ artwork }: { artwork: MenuArtwork }) {
  return <svg className="dinner-menu-vector" viewBox={`0 0 ${artwork.width} ${artwork.height}`} aria-hidden="true" focusable="false">
    {artwork.commands.map((command, index) => command.kind === 'logo'
      ? <image key={index} href={logoUrl} x={command.x} y={command.y} width={command.width} height={command.height} />
      : command.kind === 'line'
        ? <line key={index} x1={command.x1} x2={command.x2} y1={command.y} y2={command.y} stroke={INVITATION_COLORS[command.color]} strokeWidth={command.width} />
        : <text key={index} x={command.x - command.width / 2} y={command.y} fontFamily={INVITATION_FONTS[command.font]} fontSize={command.size} fontWeight={command.weight} fontStyle={command.font === 'italic' ? 'italic' : 'normal'} textLength={command.width} lengthAdjust="spacing" letterSpacing={command.tracking || undefined} fill={INVITATION_COLORS[command.color]}>{command.text}</text>)}
  </svg>
}

function InsertedMenuSurface({ artwork, revealProgress, onRevealRequest, onOpen, onRevealChange }: { artwork: MenuArtwork; revealProgress?: number; onRevealRequest?: (reveal: boolean) => void; onOpen?: () => void; onRevealChange?: (revealed: boolean) => void }) {
  const [target, setTarget] = useState(false), [internalProgress, setInternalProgress] = useState(0), [reduced, setReduced] = useState(false), [materialReady, setMaterialReady] = useState(false)
  const controlled = revealProgress !== undefined
  const progress = controlled ? Math.min(1, Math.max(0, Number.isFinite(revealProgress) ? revealProgress! : 0)) : internalProgress
  const fullyRevealed = progress >= .999
  const announced = useRef(false), requested = useRef(false), progressValue = useRef(0)
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null), suppressClick = useRef(false)
  const rotation = usePaperRotation({ yaw: 0, pitch: 0, enabled: fullyRevealed })
  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)'), change = () => setReduced(query.matches)
    change(); query.addEventListener('change', change)
    return () => query.removeEventListener('change', change)
  }, [])
  useEffect(() => {
    if (controlled || onRevealRequest) return
    const destination = target ? 1 : 0
    if (reduced) { progressValue.current = destination; setInternalProgress(destination); return }
    const from = progressValue.current, started = performance.now(), duration = 480 * Math.abs(destination - from)
    if (duration < 1) return
    let frame = 0
    const tick = (now: number) => {
      const time = Math.min(1, (now - started) / duration), eased = 1 - Math.pow(1 - time, 3)
      progressValue.current = from + (destination - from) * eased; setInternalProgress(progressValue.current)
      if (time < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [controlled, onRevealRequest, target, reduced])
  useEffect(() => {
    if (progress <= .001) requested.current = false
    else if (fullyRevealed) requested.current = true
    if (announced.current === fullyRevealed) return
    announced.current = fullyRevealed; onRevealChange?.(fullyRevealed)
    if (fullyRevealed) onOpen?.()
  }, [progress, fullyRevealed, onOpen, onRevealChange])
  const requestReveal = () => {
    const next = !requested.current
    requested.current = next
    if (onRevealRequest) onRevealRequest(next)
    else if (!controlled) setTarget(next)
  }
  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.stopPropagation()
    if (!event.isPrimary || event.button !== 0) return
    suppressClick.current = false; drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false }
    if (fullyRevealed) rotation.handlers.onPointerDown(event)
  }
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    event.stopPropagation()
    const current = drag.current
    if (current?.id === event.pointerId && Math.hypot(event.clientX - current.x, event.clientY - current.y) > 6) current.moved = true
    if (fullyRevealed) rotation.handlers.onPointerMove(event)
  }
  const pointerUp = (event: PointerEvent<HTMLDivElement>) => {
    event.stopPropagation()
    if (drag.current?.id === event.pointerId) { suppressClick.current = drag.current.moved; drag.current = null }
    rotation.handlers.onPointerUp(event)
  }
  const pointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    event.stopPropagation(); suppressClick.current = true; drag.current = null; rotation.handlers.onPointerCancel(event)
  }
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    if (event.key === 'Enter' || event.key === ' ') { event.stopPropagation(); event.preventDefault(); if (!event.repeat) requestReveal(); return }
    if (fullyRevealed && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) { event.stopPropagation(); rotation.handlers.onKeyDown(event) }
  }
  const pose = { yaw: rotation.yaw * progress, pitch: rotation.pitch * progress }
  return <div className="dinner-menu-insert-stage" data-menu-revealed={fullyRevealed} data-menu-reveal-progress={progress.toFixed(3)} style={{ '--menu-reveal-progress': progress } as CSSProperties}>
    <div className="dinner-menu-insert-paper" role="button" aria-label={fullyRevealed ? 'Menu. Return menu to the invitation. Arrow keys turn the paper.' : 'Menu. Take out and turn the menu upright.'} aria-expanded={fullyRevealed} tabIndex={0} data-paper-rotation="" data-dragging={rotation.dragging} data-menu-material={materialReady ? 'gloss-foil-debossed' : 'vector'} data-menu-angle={pose.yaw.toFixed(3)} data-menu-pitch={pose.pitch.toFixed(3)} data-menu-reveal-progress={progress.toFixed(3)}
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerCancel} onLostPointerCapture={event => { event.stopPropagation(); rotation.handlers.onLostPointerCapture(event) }} onKeyDown={keyboard}
      onClick={event => { event.stopPropagation(); if (suppressClick.current) { suppressClick.current = false; return } requestReveal() }}
      style={{ transform: `rotateX(${pose.pitch}deg) rotateY(${pose.yaw}deg) rotateZ(${-90 * (1 - progress)}deg)` }}>
      <MenuSurface artwork={artwork} embedded pose={pose} onMaterialReady={setMaterialReady} />
    </div>
  </div>
}

/** The table menu uses the invitation's cotton, gloss foil and inward impression renderer. */
export function DinnerMenuCard({ document, className = '', inserted = false, revealProgress, onRevealRequest, onOpen, onRevealChange }: DinnerMenuCardProps) {
  const key = JSON.stringify(document)
  const artwork = useMemo(() => {
    try { return buildMenuArtwork(document) }
    catch (error) { if (error instanceof RangeError) return null; throw error }
  }, [key])
  return <figure className={`dinner-menu-card${inserted ? ' dinner-menu-card--inserted' : ''} ${className}`.trim()} data-dinner-menu="" data-menu-status={document.status} data-menu-inserted={inserted || undefined} aria-label={document.status === 'specimen' ? 'Menu design specimen' : 'Dinner menu'}>
    {artwork && (inserted ? <InsertedMenuSurface artwork={artwork} revealProgress={revealProgress} onRevealRequest={onRevealRequest} onOpen={onOpen} onRevealChange={onRevealChange} /> : <MenuSurface artwork={artwork} />)}
    <figcaption className={artwork ? 'dinner-menu-sr-only' : undefined}><MenuCopy document={document} /></figcaption>
  </figure>
}

function MenuCopy({ document }: { document: DinnerMenuDocument }) {
  return <ol className="dinner-menu-copy">{document.courses.map((course, index) => <li key={`${index}-${course.name}`}><span>{course.name}</span>{course.description && <em>{course.description}</em>}</li>)}</ol>
}

export default DinnerMenuCard
