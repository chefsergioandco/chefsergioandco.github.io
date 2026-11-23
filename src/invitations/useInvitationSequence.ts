import {useCallback, useEffect, useRef, useState} from 'react'
import {invitationSequence, INVITATION_FOLD_DISTANCE, MENU_REVEAL_DISTANCE} from './invitation-sequence'

/** Input energy continues through both objects and into the page; neither object consumes the next gesture. */
export function useInvitationSequence(enabled: boolean, reduced: boolean, hasMenu: boolean) {
  const [progress, setProgress] = useState(0), [menuProgress, setMenuProgress] = useState(0), [completed, setCompleted] = useState(false), [bypassed, setBypassed] = useState(false)
  const visible = useRef(0), target = useRef(0), frame = useRef<number | null>(null), running = useRef(false), expectedScroll = useRef(0)
  const menuEnabled = useRef(hasMenu), ceremony = useRef(INVITATION_FOLD_DISTANCE + (hasMenu ? MENU_REVEAL_DISTANCE : 0)), seek = useRef<(distance: number) => void>(() => {})
  menuEnabled.current = hasMenu
  const finish = useCallback((skip = false) => {
    visible.current = ceremony.current; target.current = ceremony.current
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null; expectedScroll.current = 0
    window.scrollTo({top:0,behavior:'auto'}); setProgress(1); setMenuProgress(menuEnabled.current ? 1 : 0); setCompleted(true)
    if (skip) setBypassed(true)
  }, [])
  useEffect(() => {
    const next = INVITATION_FOLD_DISTANCE + (hasMenu ? MENU_REVEAL_DISTANCE : 0), delta = next - ceremony.current
    if (visible.current >= ceremony.current) { visible.current += delta; target.current += delta; setMenuProgress(hasMenu ? 1 : 0) }
    ceremony.current = next
  }, [hasMenu])
  useEffect(() => { if (enabled && reduced) finish(true) }, [enabled, reduced, finish])
  useEffect(() => {
    if (!enabled || reduced) return
    running.current = true
    let previous = performance.now(), touch: {x:number;y:number;at:number;velocity:number} | null = null
    const excluded = (event: Event) => (event.target as HTMLElement | null)?.closest('input,select,textarea,[contenteditable=true],[role=dialog],[role=listbox],iframe,[data-radix-popper-content-wrapper]')
    const pageMaximum = () => Math.max(0,document.documentElement.scrollHeight-innerHeight)
    const maximum = () => ceremony.current + pageMaximum()
    const apply = () => {
      const state = invitationSequence(visible.current,menuEnabled.current,pageMaximum())
      setProgress(state.fold); setMenuProgress(state.menu); setCompleted(state.fold >= .9995)
      expectedScroll.current = state.scroll
      window.scrollTo({top:state.scroll,behavior:'auto'})
    }
    const tick = (now:number) => {
      if (!running.current) { frame.current=null; return }
      const dt = Math.min(.05,Math.max(0,(now-previous)/1000)); previous=now
      target.current=Math.max(0,Math.min(maximum(),target.current))
      const difference=target.current-visible.current
      if(Math.abs(difference)<=.15){visible.current=target.current;apply();frame.current=null;return}
      const speed=visible.current<INVITATION_FOLD_DISTANCE ? 320 : visible.current<ceremony.current ? 480 : 1700
      const step=difference*(1-Math.exp(-dt/.14))
      visible.current+=Math.sign(step)*Math.min(Math.abs(step),speed*dt)
      apply(); frame.current=requestAnimationFrame(tick)
    }
    const wake=()=>{if(frame.current===null){previous=performance.now();frame.current=requestAnimationFrame(tick)}}
    const input=(amount:number)=>{target.current=Math.max(0,Math.min(maximum(),target.current+amount));wake()}
    seek.current=distance=>{target.current=Math.max(0,Math.min(maximum(),distance));wake()}
    const wheel=(event:WheelEvent)=>{if(event.ctrlKey||event.defaultPrevented||excluded(event))return;event.preventDefault();input(event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?innerHeight:1)*.9)}
    const start=(event:TouchEvent)=>{const p=event.touches[0];touch=event.touches.length===1&&!excluded(event)?{x:p.clientX,y:p.clientY,at:performance.now(),velocity:0}:null}
    const move=(event:TouchEvent)=>{
      if(event.touches.length!==1||!touch||event.defaultPrevented||excluded(event))return
      const p=event.touches[0],now=performance.now(),dy=touch.y-p.clientY,dx=touch.x-p.clientX
      if(Math.abs(dx)>Math.abs(dy)*1.4){touch={...touch,x:p.clientX,y:p.clientY,at:now,velocity:0};return}
      event.preventDefault();input(dy)
      touch={x:p.clientX,y:p.clientY,at:now,velocity:touch.velocity*.35+dy/Math.max(.016,(now-touch.at)/1000)*.65}
    }
    const end=()=>{if(touch&&performance.now()-touch.at<90)input(Math.max(-400,Math.min(400,touch.velocity*.12)));touch=null}
    const keyboard=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){if(visible.current<ceremony.current)finish(true);return}
      if(event.defaultPrevented||excluded(event)||(event.target as HTMLElement | null)?.closest('button,a'))return
      const amount=event.key==='PageDown'||event.key===' '&&!event.shiftKey?innerHeight*.8:event.key==='PageUp'||event.key===' '&&event.shiftKey?-innerHeight*.8:event.key==='ArrowDown'?64:event.key==='ArrowUp'?-64:event.key==='End'?maximum():event.key==='Home'?-maximum():null
      if(amount===null)return;event.preventDefault();input(amount)
    }
    const native=()=>{
      if(!running.current||Math.abs(scrollY-expectedScroll.current)<2)return
      if(frame.current!==null)cancelAnimationFrame(frame.current)
      frame.current=null;expectedScroll.current=scrollY;visible.current=ceremony.current+scrollY;target.current=visible.current
      setProgress(1);setCompleted(true);setMenuProgress(menuEnabled.current?1:0)
    }
    window.addEventListener('wheel',wheel,{passive:false});window.addEventListener('touchstart',start,{passive:true});window.addEventListener('touchmove',move,{passive:false});window.addEventListener('touchend',end,{passive:true});window.addEventListener('keydown',keyboard);window.addEventListener('scroll',native,{passive:true})
    return()=>{running.current=false;seek.current=()=>{};if(frame.current!==null)cancelAnimationFrame(frame.current);frame.current=null;window.removeEventListener('wheel',wheel);window.removeEventListener('touchstart',start);window.removeEventListener('touchmove',move);window.removeEventListener('touchend',end);window.removeEventListener('keydown',keyboard);window.removeEventListener('scroll',native)}
  },[enabled,reduced,finish])
  return {progress,menuProgress,completed:completed||reduced,bypassed:bypassed||reduced,active:enabled&&!completed&&!reduced,skip:()=>finish(true),open:()=>{if(reduced)finish(true);else seek.current(INVITATION_FOLD_DISTANCE)},revealMenu:(reveal:boolean)=>{if(reduced){setMenuProgress(reveal?1:0);return}seek.current(INVITATION_FOLD_DISTANCE+(reveal?MENU_REVEAL_DISTANCE:0))}}
}
