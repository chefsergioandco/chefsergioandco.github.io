import React, { memo, useEffect, useId, useMemo, useRef, useState } from 'react'
import { buildGiftCardArtwork, GIFT_CARD_COLORS, GIFT_CARD_FONTS, GIFT_CARD_FORMAT, type GiftCardDocument, type GiftCommand, type GiftFace, type GiftFaceArtwork } from '../../shared/gift-cards/artwork'
import { createFoilRenderer, type FoilRenderer } from '../invitations/foil-renderer'
import { usePaperRotation } from '../invitations/usePaperRotation'
import '../invitations/InvitationCard.css' // the shared @font-face rules
import './GiftCard.css'

export type GiftCardProps = {
  document: GiftCardDocument
  /** Which side faces the viewer. The card turns over to reach it. */
  face?: GiftFace
  className?: string
  maxWidth?: number
  /** Scrolling past the card tilts it, so the foil catches the light as a real card would in hand. */
  scrollTilt?: boolean
  label?: string
}

const SCALE = 1.6, PIXEL_W = GIFT_CARD_FORMAT.width * SCALE, PIXEL_H = GIFT_CARD_FORMAT.height * SCALE
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const radians = (degrees: number) => degrees * Math.PI / 180
const wrapAngle = (degrees: number) => Math.atan2(Math.sin(radians(degrees)), Math.cos(radians(degrees)))
const logoUrl = `${import.meta.env.BASE_URL}invitations/logo-primary-ink.svg`
const fontName = (font: 'serif' | 'italic' | 'sans') => GIFT_CARD_FONTS[font]
const colorOf = (command: GiftCommand) => command.finish === 'foil-rouge' || command.finish === 'ink-rouge' ? GIFT_CARD_COLORS.rouge : GIFT_CARD_COLORS.ink

function useReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)'), change = () => setReduced(media.matches)
    change(); media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [])
  return reduced
}

/** Draws the commands into a 2D canvas: every mark in colour, or (mask) only the foil marks in solid alpha. */
function draw(context: CanvasRenderingContext2D, commands: GiftCommand[], logo: HTMLImageElement | null, only?: (command: GiftCommand) => boolean) {
  context.save(); context.scale(SCALE, SCALE); context.textBaseline = 'alphabetic'
  for (const command of commands) {
    if (only && !only(command)) continue
    const color = only ? '#000' : colorOf(command)
    if (command.kind === 'logo') { if (logo?.complete && logo.naturalWidth) context.drawImage(logo, command.x, command.y, command.width, command.height); continue }
    if (command.kind === 'rule') {
      context.strokeStyle = color; context.lineWidth = command.stroke
      if (command.height) context.strokeRect(command.x, command.y, command.width, command.height)
      else { context.beginPath(); context.moveTo(command.x, command.y); context.lineTo(command.x + command.width, command.y); context.stroke() }
      continue
    }
    context.fillStyle = color
    context.font = `${command.font === 'italic' ? 'italic ' : ''}${command.weight} ${command.size}px "${fontName(command.font)}"`
    context.textAlign = command.align === 'center' ? 'center' : command.align === 'right' ? 'right' : 'left'
    context.fillText(command.text, command.x, command.y)
  }
  context.restore()
}
const isFoil = (command: GiftCommand) => command.finish === 'foil-black' || command.finish === 'foil-rouge'

/** Printed ivory on smooth PVC: no fibres, only enough noise to keep the gradient of the sheen from banding. */
let sheet: HTMLCanvasElement | null = null
function plasticSheet(): HTMLCanvasElement {
  if (sheet) return sheet
  sheet = document.createElement('canvas'); sheet.width = PIXEL_W; sheet.height = PIXEL_H
  const context = sheet.getContext('2d')!, image = context.createImageData(PIXEL_W, PIXEL_H), pixels = image.data
  let seed = 90127
  for (let offset = 0; offset < pixels.length; offset += 4) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5
    const noise = ((seed >>> 0) / 4294967296 - .5) * .9
    pixels[offset] = 252 + noise; pixels[offset + 1] = 250 + noise; pixels[offset + 2] = 245 + noise; pixels[offset + 3] = 255
  }
  context.putImageData(image, 0, 0)
  return sheet
}

const CardFace = memo(function CardFace({ artwork, yaw, pitch, visible }: { artwork: GiftFaceArtwork; yaw: number; pitch: number; visible: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null), renderer = useRef<FoilRenderer | null>(null), angles = useRef({ yaw, pitch })
  const [ready, setReady] = useState(false)
  angles.current = { yaw, pitch }
  useEffect(() => {
    let cancelled = false
    const target = canvasRef.current
    if (!target) return
    const load = async () => {
      const usesLogo = artwork.commands.some(command => command.kind === 'logo')
      const logo = usesLogo ? new Image() : null
      const logoReady = logo ? new Promise<void>(resolve => { logo.onload = () => resolve(); logo.onerror = () => resolve(); logo.src = logoUrl }) : Promise.resolve()
      const fonts = [...new Set(artwork.commands.flatMap(command => command.kind === 'text' ? [`${command.font === 'italic' ? 'italic ' : ''}${command.weight} 40px "${fontName(command.font)}"`] : []))]
      await Promise.all([...fonts.map(font => document.fonts.load(font)), logoReady])
      if (cancelled) return
      const canvas = () => { const element = document.createElement('canvas'); element.width = PIXEL_W; element.height = PIXEL_H; return element }
      const color = canvas(), mask = canvas(), height = canvas()
      draw(color.getContext('2d')!, artwork.commands, logo)
      draw(mask.getContext('2d')!, artwork.commands, logo, isFoil)
      // Hot-stamped foil and printed ink both sit flat on smooth plastic under the laminate: no impression,
      // so the height map stays empty. Only the foil mirrors the light; the laminate sheens over everything.
      renderer.current?.dispose()
      const material = createFoilRenderer(target, plasticSheet(), color, height, true, mask, 1)
      if (cancelled) { material?.dispose(); return }
      renderer.current = material
      if (material) { material.draw(angles.current.yaw, false, angles.current.pitch); setReady(true) } else setReady(false)
    }
    void load().catch(() => { if (!cancelled) setReady(false) })
    const lost = (event: Event) => { event.preventDefault(); setReady(false) }
    target.addEventListener('webglcontextlost', lost)
    return () => { cancelled = true; target.removeEventListener('webglcontextlost', lost) }
  }, [artwork])
  useEffect(() => { if (visible) renderer.current?.draw(yaw, false, pitch) }, [yaw, pitch, ready, visible])
  useEffect(() => {
    const target = canvasRef.current
    return () => {
      renderer.current?.dispose(); renderer.current = null
      queueMicrotask(() => { if (target && !target.isConnected) try { target.getContext('webgl')?.getExtension('WEBGL_lose_context')?.loseContext() } catch { /* The flat SVG remains. */ } })
    }
  }, [])
  return <div className={`gift-card-face gift-card-face--${artwork.face}${ready ? ' has-material' : ''}`} data-gift-face={artwork.face} aria-hidden="true">
    <svg className="gift-card-flat" viewBox="0 0 1000 700" focusable="false" aria-hidden="true">
      {artwork.commands.map((command, index) => command.kind === 'logo'
        ? <image key={index} href={logoUrl} x={command.x} y={command.y} width={command.width} height={command.height} />
        : command.kind === 'rule'
          ? command.height ? <rect key={index} x={command.x} y={command.y} width={command.width} height={command.height} fill="none" stroke={colorOf(command)} strokeWidth={command.stroke} /> : <line key={index} x1={command.x} y1={command.y} x2={command.x + command.width} y2={command.y} stroke={colorOf(command)} strokeWidth={command.stroke} />
          : <text key={index} x={command.x} y={command.y} fontFamily={fontName(command.font)} fontSize={command.size} fontWeight={command.weight} fontStyle={command.font === 'italic' ? 'italic' : 'normal'} textAnchor={command.align === 'center' ? 'middle' : command.align === 'right' ? 'end' : 'start'} fill={colorOf(command)}>{command.text}</text>)}
    </svg>
    <canvas ref={canvasRef} width={PIXEL_W} height={PIXEL_H} data-gift-material={artwork.face} aria-hidden="true" />
  </div>
})

/** Scroll position → a gentle tilt, as if the card were held while walking past it. */
function useScrollTilt(target: React.RefObject<HTMLElement>, enabled: boolean) {
  const [tilt, setTilt] = useState(0)
  useEffect(() => {
    const element = target.current
    if (!enabled || !element) { setTilt(0); return }
    let frame = 0, visible = false
    const measure = () => {
      frame = 0
      const box = element.getBoundingClientRect(), middle = innerHeight / 2
      setTilt(clamp((box.top + box.height / 2 - middle) / Math.max(1, middle), -1, 1))
    }
    const schedule = () => { if (visible && !frame) frame = requestAnimationFrame(measure) }
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; schedule() })
    observer.observe(element)
    addEventListener('scroll', schedule, { passive: true }); addEventListener('resize', schedule)
    return () => { observer.disconnect(); removeEventListener('scroll', schedule); removeEventListener('resize', schedule); cancelAnimationFrame(frame) }
  }, [enabled])
  return tilt
}

/** A phone's tilt, where the browser gives it without a permission prompt. iOS asks, so iOS uses scroll and touch only. */
function useDeviceTilt(enabled: boolean) {
  const [tilt, setTilt] = useState({ yaw: 0, pitch: 0 })
  useEffect(() => {
    const Orientation = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: unknown } }).DeviceOrientationEvent
    if (!enabled || !Orientation || typeof Orientation.requestPermission === 'function' || !matchMedia('(pointer: coarse)').matches) return
    let origin: { beta: number; gamma: number } | null = null, frame = 0, next = { yaw: 0, pitch: 0 }
    const change = (event: DeviceOrientationEvent) => {
      if (event.beta === null || event.gamma === null) return
      origin ??= { beta: event.beta, gamma: event.gamma }
      next = { yaw: clamp((event.gamma - origin.gamma) * .7, -22, 22), pitch: clamp((event.beta - origin.beta) * -.4, -12, 12) }
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; setTilt(next) })
    }
    addEventListener('deviceorientation', change)
    return () => { removeEventListener('deviceorientation', change); cancelAnimationFrame(frame) }
  }, [enabled])
  return tilt
}

/** Turning over: a damped spring toward 0° or 180°, so the shader and the CSS turn together. */
function useTurn(target: number, reduced: boolean) {
  const [angle, setAngle] = useState(target), state = useRef({ angle: target, velocity: 0 })
  useEffect(() => {
    if (reduced) { state.current = { angle: target, velocity: 0 }; setAngle(target); return }
    let frame = 0, last = performance.now()
    const step = (now: number) => {
      const dt = Math.min(.032, (now - last) / 1000); last = now
      const s = state.current, force = (target - s.angle) * 120 - s.velocity * 19
      s.velocity += force * dt; s.angle += s.velocity * dt
      if (Math.abs(target - s.angle) < .05 && Math.abs(s.velocity) < .05) { s.angle = target; s.velocity = 0; setAngle(target); return }
      setAngle(s.angle); frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [target, reduced])
  return angle
}

/** The gift card as an object: plastic, gloss black and rouge foil, rouge core edges, rounded corners. Light moves; the artwork never does. */
export function GiftCard({ document, face = 'front', className = '', maxWidth = 460, scrollTilt = true, label = 'Gift card' }: GiftCardProps) {
  const descriptionId = useId(), stage = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(maxWidth)
  const reduced = useReducedMotion()
  const rotation = usePaperRotation({ yaw: 0, pitch: 0, minYaw: -40, maxYaw: 40, minPitch: -28, maxPitch: 28 })
  const scroll = useScrollTilt(stage, scrollTilt && !reduced)
  const device = useDeviceTilt(!reduced)
  const turn = useTurn(face === 'back' ? 180 : 0, reduced)
  const key = JSON.stringify(document)
  const artwork = useMemo(() => buildGiftCardArtwork(document), [key])
  useEffect(() => {
    if (!stage.current) return
    const observer = new ResizeObserver(entries => { const next = entries[0].contentRect.width; setWidth(previous => previous === next ? previous : next) })
    observer.observe(stage.current)
    return () => observer.disconnect()
  }, [])
  const cardWidth = Math.min(maxWidth, Math.max(240, width - 32)), cardHeight = cardWidth * GIFT_CARD_FORMAT.heightIn / GIFT_CARD_FORMAT.widthIn
  const thickness = cardWidth * GIFT_CARD_FORMAT.thicknessMm / (GIFT_CARD_FORMAT.widthIn * 25.4)
  // A resting pose slightly off square: the light sits on the foil, not on a flat screen.
  const yaw = -9 + rotation.yaw + scroll * -16 + device.yaw + turn
  const pitch = 7 + rotation.pitch + scroll * 5 + device.pitch
  const faceAngles = (name: GiftFace) => {
    const local = yaw - (name === 'back' ? 180 : 0)
    return { yaw: wrapAngle(local), pitch: radians(pitch), visible: Math.cos(radians(local)) * Math.cos(radians(pitch)) > -.02 }
  }
  const styles = { '--gift-w': `${cardWidth}px`, '--gift-h': `${cardHeight}px`, '--gift-t': `${Math.max(1.5, thickness)}px`, '--gift-r': `${cardWidth * GIFT_CARD_FORMAT.cornerRadius / GIFT_CARD_FORMAT.width}px` } as React.CSSProperties
  const shown = Math.cos(radians(yaw)) >= 0 ? 'front' : 'back'
  return <figure className={`gift-card ${className}`.trim()} style={styles} data-gift-card="" data-gift-shown={shown}>
    <div ref={stage} className="gift-card-stage">
      <div className="gift-card-shadow" aria-hidden="true" style={{ transform: `translate(-50%, -50%) translate(${-yaw * .25}px, ${14 + pitch * .5}px) scale(${.96 - Math.abs(Math.sin(radians(yaw))) * .1}, .9)` }} />
      <div className="gift-card-body" style={{ transform: `translate(-50%, -50%) rotateX(${pitch}deg) rotateY(${yaw}deg) rotateZ(-1.2deg)` }} {...rotation.handlers}
        role="group" tabIndex={0} aria-roledescription="card" aria-label={`${label}, ${shown === 'front' ? 'front' : 'back'}`} aria-describedby={descriptionId}
        data-paper-dragging={rotation.dragging} data-gift-yaw={yaw.toFixed(2)} data-gift-pitch={pitch.toFixed(2)}>
        <CardFace artwork={artwork.front} {...faceAngles('front')} />
        <CardFace artwork={artwork.back} {...faceAngles('back')} />
        <span className="gift-card-edge gift-card-edge--top" aria-hidden="true" />
        <span className="gift-card-edge gift-card-edge--bottom" aria-hidden="true" />
        <span className="gift-card-edge gift-card-edge--left" aria-hidden="true" />
        <span className="gift-card-edge gift-card-edge--right" aria-hidden="true" />
      </div>
    </div>
    <figcaption className="gift-sr-only" id={descriptionId}>
      <span>Front: {artwork.front.copy.join(' ')}</span> <span>Back: {artwork.back.copy.join(' ')}</span>
    </figcaption>
  </figure>
}

export default GiftCard
