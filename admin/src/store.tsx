import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AdminState } from './model'
import { AdminApiError as ApiError, adminFetch, getAdminNavigation } from './api-client'
export { adminFetch } from './api-client'
export type AdminUser={id:string;email:string;name:string}
export type Capabilities={cardPayments:boolean;publicBooking:boolean;websitePublishing:boolean}
type Envelope={state:AdminState;revision:number;user:AdminUser;businessDate:string;capabilities:Capabilities;updatedAt:string}
type Store={state:AdminState;user:AdminUser;businessDate:string;capabilities:Capabilities;pending:boolean;updatedAt:string;saveError:string;update:(label:string,change:(draft:AdminState)=>void)=>Promise<boolean>;billingAction:(kind:'offline'|'collection',payload:Record<string,unknown>)=>Promise<boolean>;planningAction:(payload:Record<string,unknown>)=>Promise<boolean>;notify:(message:string)=>void;refresh:()=>Promise<boolean>}
const Context=createContext<Store|null>(null)
async function request(path:string,body?:unknown):Promise<Envelope>{
 const response=await adminFetch(path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:body?{'Content-Type':'application/json','X-Admin-Request':'1'}:undefined,body:body?JSON.stringify(body):undefined})
 let data:any
 try{data=await response.json()}catch{throw new ApiError('The workspace could not be reached. Your changes have not been confirmed.',response.status)}
 if(!response.ok)throw new ApiError(data.error?.message||'The change could not be saved.',response.status)
 return data as Envelope
}
export function AdminProvider({children}:{children:React.ReactNode}){
 const [envelope,setEnvelope]=useState<Envelope|null>(null),current=useRef<Envelope|null>(null)
 const [loading,setLoading]=useState(true),[loadError,setLoadError]=useState(''),[unauthorized,setUnauthorized]=useState(false)
 const [pending,setPending]=useState(false),locked=useRef(false),[saveError,setSaveError]=useState(''),[toast,setToast]=useState('')
 function accept(next:Envelope){
  const previous=current.current
  if(previous){const known=new Set(previous.state.bookings.map(booking=>booking.id));const arrivals=next.state.bookings.filter(booking=>booking.source==='public'&&booking.status==='requested'&&!known.has(booking.id));if(arrivals.length)setToast(arrivals.length===1?'A new booking request has arrived.':`${arrivals.length} new booking requests have arrived.`)}
  current.current=next;setEnvelope(next)
 }
 async function refresh(){
  try{accept(await request('/api/workspace'));setLoadError('');setUnauthorized(false);return true}
  catch(error){const err=error as ApiError;if(err.status===401||err.status===403){current.current=null;setEnvelope(null);setUnauthorized(true)}setLoadError(err.message);return false}
  finally{setLoading(false)}
 }
 useEffect(()=>{try{localStorage.removeItem('sergio-admin-prototype-v1');sessionStorage.removeItem('sergio-admin-website-work-in-progress')}catch{}void refresh()},[])
 useEffect(()=>{
  const check=()=>{if(document.visibilityState==='visible'&&!locked.current&&(!location.hash||location.hash==='#overview')&&!document.querySelector('[aria-modal="true"]'))void refresh()}
  const timer=setInterval(check,15000)
  window.addEventListener('focus',check);window.addEventListener('hashchange',check)
  return()=>{clearInterval(timer);window.removeEventListener('focus',check);window.removeEventListener('hashchange',check)}
 },[])
 useEffect(()=>{if(!toast)return;const id=setTimeout(()=>setToast(''),5000);return()=>clearTimeout(id)},[toast])
 async function mutate(path:string,payload:Record<string,unknown>):Promise<boolean>{
  if(locked.current||!current.current){setToast('Please wait for the current save to finish.');return false}
  locked.current=true;setPending(true);setSaveError('')
  const body={...payload,expectedRevision:current.current.revision,idempotencyKey:crypto.randomUUID()}
  try{
   let result:Envelope
   try{result=await request(path,body)}catch(error){if(error instanceof ApiError)throw error;result=await request(path,body)}
   accept(result);return true
  }catch(error){
   const err=error as ApiError
   if(err.status===401||err.status===403){current.current=null;setEnvelope(null);setUnauthorized(true);setLoadError('Your access has expired. Sign in again to continue.')}
   else if(err.status===409){const refreshed=await refresh();setSaveError(refreshed?'Another session changed these records. The latest records are loaded; review your entries and save again.':'Records changed in another session. Reload the dashboard before saving again. Your entries are still open.');setToast('Records changed in another session. Review before saving again.')}
   else{setSaveError(err.message||'The save could not be confirmed. Keep this window open and try again.');setToast('The change was not saved. Your entries are still open.')}
   return false
  }finally{locked.current=false;setPending(false)}
 }
 const update:Store['update']=async(label,change)=>{
  if(!current.current||locked.current)return false
  const before=current.current.state,next=structuredClone(before)
  try{change(next)}catch{setSaveError('Please review the change and try again.');return false}
  const changes:Record<string,unknown>={}
  for(const key of ['bookings','nights','blocks','availability','bookingSettings'] as const)if(JSON.stringify(before[key])!==JSON.stringify(next[key]))changes[key]=next[key]
  for(const key of ['details','sessions'] as const)if(JSON.stringify(before.operations[key])!==JSON.stringify(next.operations[key]))changes[key]=next.operations[key]
  if(JSON.stringify(before.website.draft)!==JSON.stringify(next.website.draft))changes.websiteDraft=next.website.draft
  if(!Object.keys(changes).length)return true
  return mutate('/api/workspace',{changes,label})
 }
 const billingAction:Store['billingAction']=(kind,payload)=>mutate('/api/billing/'+kind,payload)
 const planningAction:Store['planningAction']=(payload)=>mutate('/api/planning/action',payload)
 if(!envelope)return <main className="access-screen"><img src="/brand/logo-compact-ink.svg" alt="Chef Sergio & Co."/><p className="eyebrow">PRIVATE WORKSPACE</p><h1>{loading?'Opening your workspace…':unauthorized?'Sign in to continue':'Your workspace is unavailable'}</h1><p role={loadError?'alert':undefined}>{loadError||'Checking your access and loading saved records.'}</p>{!loading&&(unauthorized?<a className="button" href={getAdminNavigation().signInUrl} target="_top">Sign in</a>:<button className="button" onClick={()=>{setLoading(true);void refresh()}}>Try again</button>)}<small>Continue with Google or your email and password. Access is restricted to the business owner and approved administrators.</small></main>
 return <Context.Provider value={{...envelope,update,billingAction,planningAction,notify:setToast,pending,saveError,refresh}}>{children}{saveError&&createPortal(<div className="save-error" role="alert"><p>{saveError}</p><button aria-label="Dismiss save error" onClick={()=>setSaveError('')}>×</button></div>,document.body)}{createPortal(<div data-modal-live="" className={'toast '+(toast?'visible':'')} role="status" aria-live="polite">{toast}</div>,document.body)}</Context.Provider>
}
export function useAdmin(){const ctx=useContext(Context);if(!ctx)throw new Error('Missing AdminProvider');return ctx}
