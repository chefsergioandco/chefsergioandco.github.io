import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'

type Pose = { yaw: number; pitch: number }
type Options = Partial<Pose> & { enabled?: boolean; minYaw?: number; maxYaw?: number; minPitch?: number; maxPitch?: number }
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** Direct paper manipulation; touch retains the page's native scrolling and zoom. */
export function usePaperRotation({ yaw = 0, pitch = 0, enabled = true, minYaw = -65, maxYaw = 65, minPitch = -60, maxPitch = 60 }: Options = {}) {
  const initial = useRef({ yaw, pitch })
  const [pose, setPose] = useState<Pose>(initial.current), [dragging, setDragging] = useState(false)
  const poseRef = useRef(pose), pending = useRef<Pose | null>(null), frame = useRef<number | null>(null)
  const gesture = useRef<{ id: number; x: number; y: number; pose: Pose; element: HTMLDivElement } | null>(null)
  poseRef.current = pose
  const queue = (next: Pose) => {
    pending.current = next
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      if (pending.current) { poseRef.current = pending.current; setPose(pending.current); pending.current = null }
    })
  }
  const end = (event?: PointerEvent<HTMLDivElement>) => {
    const current = gesture.current
    if (!current || event && event.pointerId !== current.id) return
    gesture.current = null; setDragging(false)
    try { if (current.element.hasPointerCapture(current.id)) current.element.releasePointerCapture(current.id) } catch { /* The browser may already have released capture. */ }
  }
  useEffect(() => { if (!enabled) end() }, [enabled])
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current) }, [])
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!enabled || event.pointerType === 'touch' || event.button !== 0 || !event.isPrimary || gesture.current) return
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, pose: { ...(pending.current ?? poseRef.current) }, element: event.currentTarget }
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = gesture.current
    if (!enabled || !start || event.pointerId !== start.id) return
    event.preventDefault()
    queue({ yaw: clamp(start.pose.yaw + (event.clientX - start.x) * .34, minYaw, maxYaw), pitch: clamp(start.pose.pitch - (event.clientY - start.y) * .26, minPitch, maxPitch) })
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!enabled || event.target !== event.currentTarget) return
    const current = pending.current ?? poseRef.current, next = { ...current }
    if (event.key === 'ArrowLeft') next.yaw = clamp(next.yaw - 5, minYaw, maxYaw)
    else if (event.key === 'ArrowRight') next.yaw = clamp(next.yaw + 5, minYaw, maxYaw)
    else if (event.key === 'ArrowUp') next.pitch = clamp(next.pitch + 5, minPitch, maxPitch)
    else if (event.key === 'ArrowDown') next.pitch = clamp(next.pitch - 5, minPitch, maxPitch)
    else if (event.key === 'Home') Object.assign(next, initial.current)
    else return
    event.preventDefault(); queue(next)
  }
  return { ...pose, dragging, handlers: { onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end, onLostPointerCapture: end, onKeyDown } }
}
