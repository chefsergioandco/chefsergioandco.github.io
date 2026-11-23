import React, { memo, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { buildInvitationArtwork, INVITATION_COLORS, INVITATION_FONTS, type FaceArtwork, type InvitationDocument, type InvitationFace } from '../../shared/invitations/artwork'
import { cottonPaper, createFoilRenderer, type FoilRenderer } from './foil-renderer'
import { usePaperRotation } from './usePaperRotation'
import './InvitationCard.css'

export type InvitationCardProps = ({ document: InvitationDocument; artwork?: Record<InvitationFace, FaceArtwork> } | { document?: never; artwork: Record<InvitationFace, FaceArtwork> }) & {
  /** 0 = closed, 1 = fully open. The containing page owns scroll progress. */
  openProgress?: number
  className?: string
  /** Accessible copy remains available without a visible transcript control. */
  showTranscript?: boolean
  /** The opening sheet can be slightly larger before docking into a narrower page column. */
  maxSheetWidth?: number
  /** Projected anchors for a containing page to place real DOM on the lower leaf. */
  surfaceMarkers?: boolean
  /** A real folded insert, between the stationary leaf and the cover. */
  enclosure?: ReactNode
  enclosureProgress?: number
  menuNew?: boolean
  onOpenRequest?: () => void
}
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const radians = (degrees: number) => degrees * Math.PI / 180
const localAngle = (degrees: number) => Math.atan2(Math.sin(radians(degrees)), Math.cos(radians(degrees)))
const fontName = (font: 'serif' | 'italic' | 'sans') => INVITATION_FONTS[font]
const logoUrl = `${import.meta.env.BASE_URL}invitations/logo-primary-ink.svg`

function useReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)'), change = () => setReduced(media.matches)
    change(); media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [])
  return reduced
}

const PaperFace = memo(function PaperFace({ artwork, yaw, pitch, visible }: { artwork: FaceArtwork; yaw: number; pitch: number; visible: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null), renderer = useRef<FoilRenderer | null>(null)
  const angles = useRef({ yaw, pitch })
  const [ready, setReady] = useState(false)
  angles.current = { yaw, pitch }
  useEffect(() => {
    let cancelled = false
    const target = canvasRef.current
    if (!target) return
    setReady(false)
    const image = new Image()
    const imageReady = new Promise<void>(resolve => { image.onload = () => resolve(); image.onerror = () => resolve() })
    image.src = logoUrl
    const load = async () => {
      const usedFonts = [...new Set(artwork.commands.flatMap(command => command.kind === 'text' ? [command.font] : []))]
      await Promise.all([...usedFonts.map(font => document.fonts.load(`${font === 'italic' ? 'italic ' : ''}500 43px "${fontName(font)}"`)), imageReady])
      if (cancelled) return
      const color = document.createElement('canvas'); color.width = 1400; color.height = 1000
      const context = color.getContext('2d')!
      context.scale(2, 2); context.textBaseline = 'alphabetic'
      for (const command of artwork.commands) {
        if (command.kind === 'logo') { if (image.complete && image.naturalWidth) context.drawImage(image, command.x, command.y, command.width, command.height); continue }
        context.fillStyle = INVITATION_COLORS[command.color]
        context.font = `${command.font === 'italic' ? 'italic ' : ''}${command.weight} ${command.size}px "${fontName(command.font)}"`
        context.textAlign = command.align
        context.fillText(command.text, command.x, command.y)
      }
      const height = document.createElement('canvas'); height.width = color.width; height.height = color.height
      const heightContext = height.getContext('2d')!; heightContext.filter = 'blur(.7px)'; heightContext.drawImage(color, 0, 0)
      const material = createFoilRenderer(target, cottonPaper(), color, height, artwork.finish === 'foil')
      if (cancelled) { material?.dispose(); return }
      renderer.current = material
      if (material) { material.draw(angles.current.yaw, false, angles.current.pitch); setReady(true) }
    }
    void load().catch(() => { if (!cancelled) setReady(false) })
    const lost = (event: Event) => { event.preventDefault(); setReady(false) }
    target.addEventListener('webglcontextlost', lost)
    return () => { cancelled = true; renderer.current?.dispose(); renderer.current = null; target.removeEventListener('webglcontextlost', lost) }
  }, [artwork])
  useEffect(() => { if (visible) renderer.current?.draw(yaw, false, pitch) }, [yaw, pitch, ready, visible])
  useEffect(() => {
    const target = canvasRef.current
    return () => {
      // Release context slots on unmount; artwork updates reuse the live canvas.
      queueMicrotask(() => {
        if (!target || target.isConnected) return
        try { target.getContext('webgl')?.getExtension('WEBGL_lose_context')?.loseContext() } catch { /* The flat SVG remains the fallback. */ }
      })
    }
  }, [])
  return <div className={`invitation-paper invitation-paper--${artwork.face}${ready ? ' has-material' : ''}`} data-invitation-face={artwork.face} data-finish={artwork.finish} aria-hidden="true">
    <svg className="invitation-print-fallback" viewBox="0 0 700 500" focusable="false" aria-hidden="true">
      {artwork.commands.map((command, index) => command.kind === 'logo'
        ? <image key={index} href={logoUrl} x={command.x} y={command.y} width={command.width} height={command.height} />
        : <text key={index} x={command.x} y={command.y} fontFamily={fontName(command.font)} fontSize={command.size} fontWeight={command.weight} fontStyle={command.font === 'italic' ? 'italic' : 'normal'} textAnchor={command.align === 'center' ? 'middle' : 'start'} fill={INVITATION_COLORS[command.color]}>{command.text}</text>)}
    </svg>
    <canvas ref={canvasRef} width={1400} height={1000} aria-hidden="true" />
  </div>
})

/** One physical invitation, rotated in place; its containing page owns the fold. */
export function InvitationCard({ document, artwork: providedArtwork, openProgress, className = '', showTranscript = true, maxSheetWidth = 470, surfaceMarkers = false, enclosure, enclosureProgress = 0, menuNew = false, onOpenRequest }: InvitationCardProps) {
  const descriptionId = useId(), stage = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(470)
  const reduced = useReducedMotion(), actualProgress = clamp(openProgress ?? 1, 0, 1)
  const [lift, setLift] = useState(0), insert = useRef<HTMLDivElement>(null), tap = useRef({ x: 0, y: 0, distance: Infinity })
  const progress = clamp(actualProgress + (actualProgress < .05 ? lift : 0), 0, 1)
  const insertProgress = clamp(enclosureProgress, 0, 1)
  const rotationEnabled = actualProgress <= .001 || actualProgress >= .999
  const rotation = usePaperRotation({ yaw: 0, pitch: 0, enabled: rotationEnabled, minYaw: -Infinity, maxYaw: Infinity })
  const key = JSON.stringify(document)
  const artwork = useMemo(() => providedArtwork ?? buildInvitationArtwork(document!), [key, providedArtwork])
  useEffect(() => {
    if (!menuNew || !enclosure || actualProgress >= .05 || reduced) { setLift(0); return }
    let frame = 0, start = performance.now()
    const animate = (now: number) => {
      const elapsed = now - start
      if (elapsed >= 3600) { setLift(.012); return }
      setLift(.012 + Math.sin((elapsed % 1800) / 1800 * Math.PI) ** 2 * .025)
      frame = requestAnimationFrame(animate)
    }
    frame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frame)
  }, [menuNew, !!enclosure, actualProgress < .05, reduced])
  useEffect(() => { if (insert.current) insert.current.inert = actualProgress < .94 }, [actualProgress < .94, !!enclosure])
  useEffect(() => {
    if (!stage.current) return
    const observer = new ResizeObserver(entries => {
      const next = entries[0].contentRect.width
      setWidth(previous => previous === next ? previous : next)
    })
    observer.observe(stage.current)
    return () => observer.disconnect()
  }, [])
  const sheet = Math.min(maxSheetWidth, Math.max(220, width - 40)), height = sheet * 5 / 7
  const styles = { '--invitation-sheet-w': `${sheet}px`, '--invitation-sheet-h': `${height}px`, '--invitation-stage-h': `${height * (1 + progress * .96) + 80}px` } as React.CSSProperties
  const transform = `translate(-50%, ${-50 + progress * 50}%) rotateX(${8 + rotation.pitch}deg) rotateY(${-6 + rotation.yaw}deg) rotateZ(-1deg)`
  const faceAngles = (face: InvitationFace) => {
    const foldRotation = face === 'cover' ? progress * 170 : face === 'note' ? progress * 170 + 180 : 0
    const normal = Math.cos(radians(rotation.yaw - 6 + (face === 'back' ? 180 : 0))) * Math.cos(radians(rotation.pitch + 8 + foldRotation))
    const visible = normal > 0 && !(face === 'details' && progress < .01)
    return { yaw: localAngle(rotation.yaw - (face === 'back' ? 180 : 0)), pitch: radians(rotation.pitch + (face === 'note' ? 180 - progress * 170 : 0)), visible }
  }
  const faces = ['cover', 'note', 'details'] as const
  return <figure className={`invitation-card ${className}`.trim()} style={styles} data-invitation-card="" data-open-progress={actualProgress.toFixed(3)} data-menu-new={!!enclosure && menuNew} data-enclosure-progress={insertProgress.toFixed(3)} data-has-enclosure={!!enclosure} data-reduced-motion={reduced}>
    <div ref={stage} className="invitation-card-stage">
      <div className="invitation-card-book" style={{ transform }} {...rotation.handlers}
        onPointerDown={event => { if ((event.target as HTMLElement).closest('[data-dinner-menu]')) return; tap.current = { x: event.clientX, y: event.clientY, distance: 0 }; rotation.handlers.onPointerDown(event) }}
        onPointerMove={event => { tap.current.distance = Math.max(tap.current.distance, Math.hypot(event.clientX - tap.current.x, event.clientY - tap.current.y)); rotation.handlers.onPointerMove(event) }}
        onPointerCancel={event => { tap.current.distance = Infinity; rotation.handlers.onPointerCancel(event) }}
        onClick={event => { if (tap.current.distance < 6 && actualProgress < .94) { event.stopPropagation(); onOpenRequest?.() } }}
        onKeyDown={event => { if (event.target === event.currentTarget && onOpenRequest && actualProgress < .94 && ['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); onOpenRequest() } else rotation.handlers.onKeyDown(event) }}
        role={onOpenRequest && actualProgress < .94 ? 'button' : 'group'} aria-expanded={onOpenRequest ? actualProgress >= .94 : undefined} tabIndex={0} aria-label="Invitation" aria-describedby={descriptionId} data-paper-rotation="" data-paper-yaw={rotation.yaw.toFixed(3)} data-paper-pitch={rotation.pitch.toFixed(3)} data-paper-dragging={rotation.dragging} data-paper-rotation-enabled={rotationEnabled}>
        <div className="invitation-card-turning" style={{ transform: `translateZ(.25px) rotateX(${170 * progress}deg)` }}>
          {(['cover', 'note'] as const).map(face => <PaperFace key={face} artwork={artwork[face]} {...faceAngles(face)} />)}
        </div>
        <div className="invitation-card-stationary">
          {(['details', 'back'] as const).map(face => <PaperFace key={face} artwork={artwork[face]} {...faceAngles(face)} />)}
          {enclosure && <div ref={insert} className="invitation-card-enclosure" data-open={insertProgress >= .999} aria-hidden={actualProgress < .94} style={{transform:`translate3d(${12 * insertProgress}%,${-19 * insertProgress - 8 * Math.sin(Math.PI * insertProgress)}%,${.3 + 119.7 * insertProgress}px) rotateZ(${insertProgress}deg)`}}>{enclosure}</div>}
          {surfaceMarkers && (['tl', 'tr', 'br', 'bl'] as const).map(corner => <span key={corner} data-invitation-corner={corner} aria-hidden="true" style={{ position: 'absolute', width: 0, height: 0, left: corner.endsWith('l') ? 0 : '100%', top: corner.startsWith('t') ? 0 : '100%', transform: 'translateZ(.1px)', pointerEvents: 'none' }} />)}
        </div>
      </div>
    </div>
    {showTranscript ? <figcaption className="invitation-sr-only" id={descriptionId}>{faces.map(face => <section key={face} aria-label={face === 'cover' ? 'Cover' : face === 'note' ? 'Personal note' : 'Event details'}>{artwork[face].copy.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</section>)}</figcaption> : <p className="invitation-sr-only" id={descriptionId}>{faces.flatMap(face => artwork[face].copy).join(' ')}</p>}
  </figure>
}

export default InvitationCard
