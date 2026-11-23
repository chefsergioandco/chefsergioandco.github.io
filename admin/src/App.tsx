import React, { useEffect, useRef, useState } from 'react'
import { useAdmin } from './store'
import { Icon, Modal, WorkspaceWindow } from './ui'
import { dateLabel, money } from './model'
import Counter from './Counter'
import Bookings from './Bookings'
import Calendar from './Calendar'
import Website from './Website'
import {BillingRecords} from './Billing'
import {receivedFor,quorumFor} from './operations'
import Communications from './Communications'
import Newsletter from './Newsletter'
import { getAdminNavigation } from './api-client'

type WindowName = 'requests' | 'bookings' | 'calendar' | 'table' | 'payments' | 'communications' | 'newsletter' | 'website' | 'activity'
const windowTitles: Record<WindowName, string> = {requests:'Bookings',bookings:'Bookings',calendar:'Calendar',table:'Sergio’s Table',payments:'Billing & records',communications:'Communications',newsletter:'Newsletter',website:'Your website',activity:'Recent activity'}
function fromHash():WindowName|null {
 const hash=location.hash.slice(1)
 if(hash==='overview'||!hash)return null
 if(hash==='nights')return 'table'
 return Object.hasOwn(windowTitles,hash)?hash as WindowName:null
}
const navigation: {id:'overview'|WindowName;label:string;icon:string}[]=[{id:'overview',label:'Overview',icon:'home'},{id:'bookings',label:'Bookings',icon:'book'},{id:'calendar',label:'Calendar',icon:'calendar'},{id:'table',label:'Sergio’s Table',icon:'cutlery'},{id:'payments',label:'Billing & records',icon:'card'},{id:'communications',label:'Communications',icon:'mail'},{id:'newsletter',label:'Newsletter',icon:'edit'},{id:'website',label:'Your website',icon:'globe'},{id:'activity',label:'Recent activity',icon:'history'}]
const twoDigits=(value:number)=>String(Math.round(value)).padStart(2,'0')
export default function App(){
 const accountNavigation=getAdminNavigation()
 const {state,pending,businessDate:today,user,updatedAt,saveError}=useAdmin()
 const [activeWindow,setActiveWindow]=useState<WindowName|null>(fromHash)
 const [help,setHelp]=useState(false)
 const [bookingScope,setBookingScope]=useState<'all'|'upcoming'>('all')
 const [menuOpen,setMenuOpen]=useState(false)
 const [isMobile,setIsMobile]=useState(()=>window.matchMedia('(max-width:800px)').matches)
 const sidebarRef=useRef<HTMLElement>(null)
 const workspaceRef=useRef<HTMLDivElement>(null)
 const menuButtonRef=useRef<HTMLButtonElement>(null)
 const drawerOverflow=useRef<string|null>(null)
 const mainRef=useRef<HTMLElement>(null)
 function closeNavigation(restoreFocus=true){
  setMenuOpen(false)
  if(workspaceRef.current)workspaceRef.current.inert=false
  if(drawerOverflow.current!==null){document.body.style.overflow=drawerOverflow.current;drawerOverflow.current=null}
  if(restoreFocus)menuButtonRef.current?.focus({preventScroll:true})
 }
 useEffect(()=>{const query=window.matchMedia('(max-width:800px)');const changed=()=>{setIsMobile(query.matches);if(!query.matches)setMenuOpen(false)};query.addEventListener('change',changed);return()=>query.removeEventListener('change',changed)},[])
 useEffect(()=>{
  if(sidebarRef.current)sidebarRef.current.inert=isMobile&&!menuOpen
  if(workspaceRef.current)workspaceRef.current.inert=isMobile&&menuOpen
  if(!isMobile||!menuOpen)return
  if(drawerOverflow.current===null){drawerOverflow.current=document.body.style.overflow;document.body.style.overflow='hidden'}
  sidebarRef.current?.querySelector<HTMLButtonElement>('button')?.focus({preventScroll:true})
  const key=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){event.preventDefault();closeNavigation()}
   if(event.key==='Tab'){
    const items=Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled)')||[]).filter(el=>el.getClientRects().length>0)
    const first=items[0],last=items[items.length-1]
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
   }
  }
  document.addEventListener('keydown',key)
  return()=>{document.removeEventListener('keydown',key);if(drawerOverflow.current!==null){document.body.style.overflow=drawerOverflow.current;drawerOverflow.current=null}}
 },[isMobile,menuOpen])
 function showHelp(){if(menuOpen)closeNavigation();setHelp(true)}
 useEffect(()=>{const changed=()=>setActiveWindow(fromHash());window.addEventListener('hashchange',changed);window.addEventListener('popstate',changed);return()=>{window.removeEventListener('hashchange',changed);window.removeEventListener('popstate',changed)}},[])
 function openWindow(name:WindowName,scope:'all'|'upcoming'='upcoming'){if(menuOpen)closeNavigation();setBookingScope(scope);setActiveWindow(name);history.pushState({kioskWindow:true},'',`#${name}`)}
 function closeWindow(){setActiveWindow(null);if(history.state?.kioskWindow)history.back();else history.replaceState(null,'','#overview')}
 const requests=state.bookings.filter(b=>b.status==='requested')
 const upcoming=state.bookings.filter(b=>b.status!=='cancelled'&&b.status!=='requested'&&b.date>=today).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time))
 const nextNight=state.nights.filter(n=>n.status==='published'&&n.date>=today).sort((a,b)=>a.date.localeCompare(b.date))[0]
 const remainingSeats=nextNight?Math.max(0,nextNight.seats-nextNight.booked):0
 const received=state.operations.billing.reduce((sum,b)=>sum+receivedFor(b),0)
 const nextQuorum=nextNight?quorumFor(nextNight,state.operations.sessions[nextNight.id]):null
 const needsDecision=nextQuorum&&['at_risk','below'].includes(nextQuorum.state)
 return <div className="dashboard-shell">
  <a className="skip-link" href="#kiosk-main">Skip to dashboard</a>
  {menuOpen&&<button className="dashboard-nav-scrim" aria-label="Close navigation" onClick={()=>closeNavigation()}/>}
  <aside ref={sidebarRef} className={'sidebar dashboard-sidebar'+(menuOpen?' is-open':'')} aria-label="Main navigation" aria-hidden={isMobile&&!menuOpen} role={isMobile?'dialog':undefined} aria-modal={isMobile&&menuOpen?true:undefined}>
   <button className="icon-button dashboard-close-menu" aria-label="Close menu" onClick={()=>closeNavigation()}><Icon name="close"/></button>
   <a className="brand" href="#overview" onClick={event=>{event.preventDefault();if(menuOpen)closeNavigation(false);closeWindow();requestAnimationFrame(()=>mainRef.current?.focus({preventScroll:true}))}}><img src="/brand/logo-compact-reverse.svg" alt="Chef Sergio & Co."/><span>YOUR KITCHEN, ORGANISED</span></a>
   <div className="workspace-caption">WORKSPACE</div>
   <nav aria-label="Dashboard sections">{navigation.map(item=>{const selected=item.id==='overview'?!activeWindow:item.id===activeWindow||(item.id==='bookings'&&activeWindow==='requests');return <button key={item.id} className={'nav-item'+(selected?' active':'')} aria-current={selected?'page':undefined} onClick={()=>{if(item.id==='overview'){if(menuOpen)closeNavigation();closeWindow()}else openWindow(item.id,'all')}}><Icon name={item.icon}/><span>{item.label}</span>{item.id==='bookings'&&requests.length>0&&<span className="nav-count">{requests.length}</span>}</button>})}</nav>
   <div className="sidebar-bottom"><div className="sidebar-note"><Icon name="cutlery" size={24}/><p>A little less admin.<br/>A little more cooking.</p></div><button className="sidebar-help" onClick={showHelp}><Icon name="info" size={18}/><span>Workspace & connections</span></button><div className="sidebar-person"><span className="avatar">{user.name.slice(0,1).toUpperCase()}</span><div><strong>{user.name}</strong><span>Approved administrator</span></div><Icon name="shield" size={18}/></div></div>
  </aside>
  <div ref={workspaceRef} className="dashboard-workspace">
  <header className="topbar dashboard-topbar"><button ref={menuButtonRef} className="icon-button dashboard-menu-button" aria-label="Open navigation" aria-expanded={menuOpen} onClick={()=>setMenuOpen(true)}><Icon name="menu"/></button><div className="dashboard-context"><Icon name="home" size={17}/><span>Overview</span></div><div className="dashboard-topbar-actions"><button className="kiosk-demo" onClick={showHelp}><Icon name={pending?'clock':'shield'} size={16}/><span role="status">{pending?'Saving…':'Private workspace'}</span></button><a className="kiosk-owner" href={accountNavigation.accountUrl} aria-label="Your account and security"><span className="kiosk-avatar">{user.name.slice(0,1).toUpperCase()}</span><span>{user.name}</span></a></div></header>
  <main ref={mainRef} id="kiosk-main" className="kiosk-main" tabIndex={-1}>
   <div className="kiosk-greeting"><p className="eyebrow">{dateLabel(today,{weekday:'long',month:'long',day:'numeric'}).toUpperCase()}</p><h1>Your kitchen, organised.</h1><p>A little order. More time around the table.</p></div>
   <section className="kiosk-metrics" aria-label="Your business at a glance">
    <button className="kiosk-metric requests-metric" onClick={()=>openWindow('requests')} aria-label={`New requests: ${requests.length}. Open requests.`}>
     <div className="kiosk-metric-heading"><span>New requests</span><span className="kiosk-metric-icon"><Icon name="mail" size={29}/></span></div>
     <div className="kiosk-metric-number"><Counter value={requests.length} format={twoDigits}/></div>
     <p>{requests.length?'Ready for your reply':'You’re all caught up'}</p>
     <span className="kiosk-metric-action">Review requests</span>
    </button>
    <button className="kiosk-metric" onClick={()=>openWindow('bookings')} aria-label={`Upcoming bookings: ${upcoming.length}. Open bookings.`}>
     <div className="kiosk-metric-heading"><span>Upcoming bookings</span><span className="kiosk-metric-icon"><Icon name="calendar" size={29}/></span></div>
     <div className="kiosk-metric-number"><Counter value={upcoming.length} format={twoDigits} delay={80}/></div>
     <p>{upcoming[0]?`Next event · ${dateLabel(upcoming[0].date)}`:'Room for something delicious'}</p>
     <span className="kiosk-metric-action">View bookings</span>
    </button>
    <button className="kiosk-metric" onClick={()=>openWindow('table')} aria-label={`Sergio’s Table: ${remainingSeats} seats left. Open table nights.`}>
     <div className="kiosk-metric-heading"><span>At Sergio’s table</span><span className="kiosk-metric-icon"><Icon name="cutlery" size={29}/></span></div>
     <div className="kiosk-metric-number"><Counter value={remainingSeats} delay={160}/><span className="kiosk-counter-unit">seats left</span></div>
     <p className={needsDecision?'kiosk-quorum-alert':''}>{needsDecision?(nextQuorum?.state==='at_risk'?'Quorum at risk · review guest changes':'Below quorum · decision needed'):nextQuorum?.state==='recovering'?'Recovery plan active · view deadline':nextQuorum?.state==='continuing_below'?'Continuing by your decision':nextNight?`${dateLabel(nextNight.date)} · ${nextNight.title}`:'Plan your next evening'}</p>
     <span className="kiosk-metric-action">Manage table nights</span>
    </button>
    <button className="kiosk-metric payments-metric" onClick={()=>openWindow('payments')} aria-label={`Payments received: ${money(received)}. Open payment records.`}>
     <div className="kiosk-metric-heading"><span>Payments received</span><span className="kiosk-metric-icon"><Icon name="card" size={29}/></span></div>
     <div className="kiosk-metric-number"><Counter value={received} format={money} delay={240}/></div>
     <p>Recorded receipts · net of refunds</p>
     <span className="kiosk-metric-action">View payment records</span>
    </button>
   </section>
   <section className="kiosk-tools" aria-label="Manage your business">
    <button className="kiosk-tool" onClick={()=>openWindow('calendar')}><span className="kiosk-tool-icon"><Icon name="calendar" size={35}/></span><span><strong>Calendar</strong><span>Dates & availability</span></span></button>
    <button className="kiosk-tool" onClick={()=>openWindow('website')}><span className="kiosk-tool-icon"><Icon name="globe" size={35}/></span><span><strong>Your website</strong><span>Words, menus & images</span></span></button>
    <button className="kiosk-tool communications-kiosk-tool" onClick={()=>openWindow('communications')}><span className="kiosk-tool-icon"><Icon name="mail" size={35}/></span><span><strong>Communications</strong><span>Guest emails & receipts</span></span></button>
    <button className="kiosk-tool" onClick={()=>openWindow('activity')}><span className="kiosk-tool-icon"><Icon name="history" size={35}/></span><span><strong>Recent activity</strong><span>What’s been happening</span></span></button>
   </section>
  </main>
  <footer className="kiosk-footer"><span>Chef Sergio & Co. · {pending?'Saving…':saveError?'Save needs attention':updatedAt?'Changes saved':'Ready'}</span><nav className="kiosk-account-links" aria-label="Account"><a href={accountNavigation.accountUrl} target="_top"><Icon name="lock" size={15}/>Your account</a><a href={accountNavigation.signOutUrl} target="_top"><Icon name="logout" size={15}/>Sign out</a></nav></footer>
  </div>
  {activeWindow&&<WorkspaceWindow title={windowTitles[activeWindow]} onClose={closeWindow}>
   {activeWindow==='requests'&&<Bookings embedded initialStatus="requested"/>}
   {activeWindow==='bookings'&&<Bookings embedded initialScope={bookingScope}/>}
   {activeWindow==='calendar'&&<Calendar embedded initialTab="calendar"/>}
   {activeWindow==='table'&&<Calendar embedded initialTab="nights"/>}
   {activeWindow==='website'&&<Website embedded/>}
   {activeWindow==='payments'&&<BillingRecords/>}
   {activeWindow==='communications'&&<Communications/>}
   {activeWindow==='newsletter'&&<Newsletter/>}
   {activeWindow==='activity'&&<section className="kiosk-activity"><ol>{state.activity.map(a=><li key={a.id}><span className="kiosk-activity-icon"><Icon name="check" size={18}/></span><div><p>{a.text}</p><time dateTime={a.at}>{new Date(a.at).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</time></div></li>)}</ol>{!state.activity.length&&<p className="empty-state">Your recent actions will appear here.</p>}</section>}
  </WorkspaceWindow>}
  {help&&<Modal title="Workspace & connections" onClose={()=>setHelp(false)}><div className="modal-body help-content"><p>Signed in as <strong>{user.email}</strong>. Your sign-in identity controls access and identifies saved changes in the activity record.</p><div className="notice"><Icon name="shield" size={20}/><p>Bookings, guest requirements, calendar settings, and receipts are saved privately and shared between approved administrators.</p></div><dl className="connection-list"><div><dt>Business records</dt><dd>Connected · shared storage</dd></div><div><dt>Card payments</dt><dd>Not connected · offline receipts available</dd></div><div><dt>Public booking page</dt><dd>Connected · new requests arrive here</dd></div><div><dt>Website publishing</dt><dd>Not connected · save drafts here</dd></div><div><dt>Google Calendar</dt><dd>Not connected</dd></div><div><dt>Guest email</dt><dd>Connection status in Communications</dd></div></dl><p>Use your approved Google or email account to sign in. New records stay empty until you add them; no sample bookings or payments are imported.</p></div><div className="modal-actions"><button className="button" onClick={()=>setHelp(false)}>Done</button></div></Modal>}
 </div>
}
