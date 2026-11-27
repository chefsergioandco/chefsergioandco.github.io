import * as RadioGroup from '@radix-ui/react-radio-group'
import { useRef, useState, type ReactNode } from 'react'
import { CtaButton, CtaLink } from '../components/CallToAction'
import { href } from '../components/ui'
import { api } from './api'
import { clock, longDate, money } from './format'
import type { Night } from './types'

const todayET = () => new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
export const canRequestNight = (night:Night) => night.state !== 'cancelled' && night.state !== 'full' && night.taken < night.seats && night.date >= todayET()

export function SeatMeter({ n, paymentReady = false }: { n: Night; paymentReady?: boolean }) {
  const left = Math.max(0,n.seats - n.taken)
  const text = n.state === 'cancelled' ? 'This evening is cancelled.' : n.state === 'full' ? 'Full. Ask to join the waitlist.' : n.state === 'confirmed' ? `Evening confirmed. ${left} ${left === 1 ? 'seat' : 'seats'} available to request.` : `${n.taken} reserved seats toward a minimum of ${n.minimum}. ${n.seats} seats in all.`
  return <div className="min-w-0" data-seat-meter><div className="relative h-2 overflow-hidden rounded-full bg-ink/10" aria-hidden><div className={`h-full rounded-full ${n.state === 'pending' ? 'bg-ink/50' : 'bg-ink'}`} style={{width:`${n.seats ? Math.min(100,n.taken/n.seats*100) : 0}%`}}/><div className="absolute inset-y-0 w-0.5 bg-ink" style={{left:`calc(${n.seats ? n.minimum/n.seats*100 : 0}% - 1px)`}}/></div><p className="mt-2 text-sm">{text}</p>{n.state === 'pending' && <p className="text-sm text-ink-muted">Decision by {longDate(n.cutoff.slice(0,10))}. {paymentReady ? 'Payment secures your seats while the evening gathers its minimum. A full seat refund follows if Sergio cancels.' : 'Unpaid requests do not reserve seats. Online payments are not enabled yet.'}</p>}</div>
}
const price = (night:Night) => night.pricePerSeat ? `${money(night.pricePerSeat)} per seat` : 'Price to be agreed'
function NightInfo({n}:{n:Night}) {
  return <><p className="font-display text-xl">{longDate(n.date)}</p><p className="text-ink-muted">{clock(n.start)}, {n.title}, {price(n)}</p>{n.kind === 'class' && n.location && <p className="text-ink-muted" data-night-location>{n.location}</p>}</>
}
function Waitlist({n,embedded=false}:{n:Night;embedded?:boolean}) {
  const [email,setEmail] = useState(''),[done,setDone] = useState(false),[busy,setBusy] = useState(false),[error,setError] = useState(''),[honeypot,setHoneypot] = useState('')
  const input=useRef<HTMLInputElement>(null),inFlight=useRef(false)
  async function join() {
    if(inFlight.current)return
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.length > 254){setError('Enter a valid email address.');input.current?.focus();return}
    inFlight.current=true;setBusy(true);setError('')
    try{await api.waitlist(n.id,email,honeypot);setDone(true)}
    catch(failure){setError(failure instanceof Error ? failure.message : 'Your waitlist request could not be confirmed. Please try again.')}
    finally{inFlight.current=false;setBusy(false)}
  }
  if(done)return <p role="status" className="text-sm">Your waitlist request is with Sergio. Joining does not reserve a seat.</p>
  const fields=<><label className="sr-only" htmlFor={`wl-${n.id}`}>Email for the waitlist</label><input ref={input} id={`wl-${n.id}`} type="email" autoComplete="email" placeholder="Your email" maxLength={254} value={email} disabled={busy} onChange={event=>setEmail(event.target.value)} onKeyDown={embedded?event=>{if(event.key==='Enter'){event.preventDefault();event.stopPropagation();void join()}}:undefined} className="min-h-[44px] min-w-0 flex-1 rounded-btn border border-ink/30 bg-paper px-3"/><div aria-hidden="true" style={{position:'absolute',left:'-10000px',width:1,height:1,overflow:'hidden'}}><label>Website<input name="website" autoComplete="off" tabIndex={-1} value={honeypot} onChange={event=>setHoneypot(event.target.value)}/></label></div><CtaButton type={embedded?'button':'submit'} emphasis="secondary" disabled={busy} onClick={embedded?()=>void join():undefined}>{busy?'Sending':'Join the waitlist'}</CtaButton>{error&&<p role="alert" className="w-full text-sm text-alert">{error}</p>}</>
  return embedded ? <div role="group" aria-label={`Waitlist for ${longDate(n.date)}`} className="flex flex-wrap gap-2">{fields}</div> : <form className="flex flex-wrap gap-2" onSubmit={event=>{event.preventDefault();event.stopPropagation();void join()}}>{fields}</form>
}
export function NightList({nights,paymentReady=false,empty}:{nights:Night[];paymentReady?:boolean;empty?:string}) {
  if(!nights.length)return <p className="text-ink-muted">{empty ?? 'No evenings are open for requests right now. New evenings appear when Sergio schedules them.'}</p>
  return <ul className="divide-y divide-rule border-y border-rule">{nights.map(n=><li key={n.id} data-night={n.id} className="grid grid-cols-1 gap-4 py-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] lg:items-center"><div className="min-w-0"><NightInfo n={n}/></div><SeatMeter n={n} paymentReady={paymentReady}/><div className="min-w-0 lg:justify-self-end">{n.state==='full'?<Waitlist n={n}/>:canRequestNight(n)?<CtaLink emphasis="primary" href={href(`/book/?type=table&night=${encodeURIComponent(n.id)}`)}>{paymentReady?'Book seats':'Request seats'}</CtaLink>:<p className="text-sm text-ink-muted">Requests are closed for this evening.</p>}</div></li>)}</ul>
}
export function NightPicker({nights,value,onChange,error,paymentReady=false}:{nights:Night[];value?:string;onChange:(id:string)=>void;error?:ReactNode;paymentReady?:boolean}) {
  return <fieldset><legend className="font-medium">Choose a night</legend>{!nights.length&&<p className="mt-3 text-ink-muted">No evenings are open for requests right now. Contact Sergio to discuss another arrangement.</p>}<RadioGroup.Root id="f-night" value={value} onValueChange={onChange} className="mt-2 space-y-3" aria-describedby={error?'f-night-err':undefined}>{nights.map(n=>n.state==='full'||!canRequestNight(n)?<div key={n.id} className="space-y-3 rounded-card border border-ink/15 p-4 opacity-90"><NightInfo n={n}/><SeatMeter n={n} paymentReady={paymentReady}/>{n.state==='full'?<Waitlist n={n} embedded/>:<p className="text-sm text-ink-muted">Requests are closed for this evening.</p>}</div>:<RadioGroup.Item key={n.id} value={n.id} data-night={n.id} className="block w-full space-y-3 rounded-card border border-ink/25 bg-paper p-4 text-left transition-[border-color,box-shadow] duration-150 hover:border-ink/60 data-[state=checked]:border-brand data-[state=checked]:ring-2 data-[state=checked]:ring-brand"><NightInfo n={n}/><SeatMeter n={n} paymentReady={paymentReady}/></RadioGroup.Item>)}</RadioGroup.Root>{error&&<p id="f-night-err" className="mt-2 text-sm font-medium text-alert">{error}</p>}</fieldset>
}
