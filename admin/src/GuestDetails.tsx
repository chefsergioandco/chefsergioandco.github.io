import { useState, type FormEvent } from 'react'
import { useAdmin } from './store'
import { Icon, Modal } from './ui'
import { businessDate, type Allergy, type DietaryGuest, type DietaryRecord, type VenueRecord, type BookingDetails } from './operations'
import type { Booking } from './model'
import './GuestDetails.css'
const venueKinds: Record<VenueRecord['kind'], string> = {guest_home:'Guest’s home',sergio_home:'Sergio’s home',event_venue:'Event venue',undecided:'To be decided'}
const yesNo = {yes:'Available',no:'Not available',unknown:'Not confirmed'}
const allergyLabels: Record<Allergy['severity'],string> = {allergy:'Reported allergy',severe_allergy:'Reported severe allergy',intolerance:'Reported intolerance',unconfirmed:'Needs clarification'}
const contactLabels: Record<Allergy['crossContact'],string> = {avoid:'Avoid cross-contact',ask_guest:'Ask guest about cross-contact',not_required:'Not required, confirmed by guest'}
const restrictions = ['Vegetarian','Vegan','Pescatarian','Gluten-free','Dairy-free','No pork','No beef','Halal','Kosher']
type DietaryWithSource = DietaryRecord & {originalNote?:string}
const completeAddress = (venue: VenueRecord) => venue.kind !== 'undecided' && [venue.address.line1,venue.address.city,venue.address.region,venue.address.postalCode].every(value=>value.trim())
const addressText = (venue:VenueRecord) => [venue.address.line1,venue.address.line2,[venue.address.city,venue.address.region,venue.address.postalCode].filter(Boolean).join(', ')].filter(Boolean).join(', ')
const recordedAt = () => new Date().toISOString()
function emptyDetails(booking:Booking):BookingDetails {
  return {venue:{kind:'undecided',name:'',address:{line1:'',line2:'',city:booking.location,region:'',postalCode:''},contactName:booking.guest,contactPhone:booking.phone,arrivalNotes:'',parking:'',kitchen:{hob:'unknown',oven:'unknown',refrigerator:'unknown',prepSpace:''},reviewedAt:null},dietary:{originalNote:booking.dietary,confirmedAt:null,source:'',guests:[],prepNotes:booking.dietary}}
}
const unidentified = (name:string) => !name.trim() || /to identify|to confirm|tbd|unknown|birthday guest|whole party|two guests/i.test(name)
function dietaryIssues(record:DietaryRecord) {
  const issues:string[]=[]
  record.guests.forEach((guest,index)=>{
    const label=guest.name.trim()||`Guest ${index+1}`
    if(unidentified(guest.name))issues.push(`Identify ${label.toLowerCase()}.`)
    guest.allergies.forEach(allergy=>{
      if(!allergy.allergen.trim())issues.push(`Add the allergen for ${label}.`)
      if(allergy.severity==='unconfirmed')issues.push(`Clarify the reported requirement for ${label}${allergy.allergen?` (${allergy.allergen})`:''}.`)
      if(allergy.crossContact==='ask_guest')issues.push(`Confirm cross-contact instructions for ${label}${allergy.allergen?` (${allergy.allergen})`:''}.`)
    })
  })
  return issues
}
function DetailStatus({confirmed,children}:{confirmed:boolean;children:string}) {return <span className={'guest-detail-status '+(confirmed?'complete':'pending')}><Icon name={confirmed?'check':'clock'} size={14}/>{children}</span>}

export function VenueDetails({bookingId}:{bookingId:string}) {
  const {state,update,notify,pending}=useAdmin()
  const booking=state.bookings.find(item=>item.id===bookingId)
  const [editing,setEditing]=useState(false)
  const [draft,setDraft]=useState<VenueRecord|null>(null)
  const [addressConfirmed,setAddressConfirmed]=useState(false)
  const [error,setError]=useState('')
  if(!booking)return null
  const saved=state.operations.details[bookingId]?.venue??emptyDetails(booking).venue
  const reviewed=!!saved.reviewedAt&&!!completeAddress(saved)
  const missing=[!completeAddress(saved)&&'Exact address',!saved.contactName.trim()&&'Arrival contact',!saved.contactPhone.trim()&&'Contact phone',!saved.parking.trim()&&'Parking',saved.kitchen.hob==='unknown'&&'Hob type',saved.kitchen.oven==='unknown'&&'Oven',saved.kitchen.refrigerator==='unknown'&&'Refrigeration',!saved.kitchen.prepSpace.trim()&&'Preparation space'].filter(Boolean) as string[]
  const open=()=>{setDraft(structuredClone(saved));setAddressConfirmed(false);setError('');setEditing(true)}
  const change=<K extends keyof VenueRecord>(key:K,value:VenueRecord[K])=>{setDraft(valueDraft=>valueDraft?{...valueDraft,[key]:value}:valueDraft);setAddressConfirmed(false);setError('')}
  const changeAddress=(key:keyof VenueRecord['address'],value:string)=>{if(draft)change('address',{...draft.address,[key]:value})}
  const save=async(review:boolean)=>{
    if(!draft)return
    if(review&&(!completeAddress(draft)||!addressConfirmed)){setError('Add the full address and confirm it with the host before marking the venue reviewed.');return}
    const venue={...draft,name:draft.name.trim(),address:Object.fromEntries(Object.entries(draft.address).map(([key,value])=>[key,value.trim()])) as VenueRecord['address'],reviewedAt:review?recordedAt():null}
    const persisted=await update(`${review?'Reviewed':'Updated'} venue details for ${bookingId}`,next=>{
      const details=next.operations.details[bookingId]??emptyDetails(booking)
      next.operations.details[bookingId]={...details,venue}
      const item=next.bookings.find(item=>item.id===bookingId)
      if(item)item.location=[venue.name||venueKinds[venue.kind],[venue.address.city,venue.address.region].filter(Boolean).join(', ')].filter(Boolean).join(' · ')
    })
    if(!persisted)return
    setEditing(false);notify(review?'Venue reviewed. Arrival and kitchen notes saved.':'Venue details saved. Address review is still open.')
  }
  return <section className="guest-details-section venue-details">
    <div className="guest-details-heading"><div><h3>Venue & arrival</h3><DetailStatus confirmed={reviewed}>{reviewed?'Address reviewed':'Needs venue review'}</DetailStatus></div><button className="button secondary" onClick={open}><Icon name="edit" size={15}/>Edit venue</button></div>
    {booking.location&&!saved.address.line1&&<p className="guest-detail-form-note">Requested location or area: {booking.location}</p>}
    <div className="guest-venue-address"><Icon name="pin" size={19}/><div><strong>{saved.name||venueKinds[saved.kind]}</strong><p>{saved.address.line1?addressText(saved):`${saved.address.city||'Area to confirm'}${saved.address.region?', '+saved.address.region:''} · Exact address needed`}</p>{completeAddress(saved)&&<a className="guest-map-link" href={'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(addressText(saved))} target="_blank" rel="noopener noreferrer">Open address in Maps<Icon name="external" size={14}/></a>}</div></div>
    <dl className="guest-venue-facts"><div><dt>Arrival contact</dt><dd>{saved.contactName||'Not confirmed'}{saved.contactPhone&&<span>{saved.contactPhone}</span>}</dd></div><div><dt>Arrival & access</dt><dd>{saved.arrivalNotes||'Not recorded'}</dd></div><div><dt>Parking & unloading</dt><dd>{saved.parking||'Not recorded'}</dd></div></dl>
    <div className="guest-kitchen-checklist"><h4>Kitchen check</h4><ul><li><Icon name={saved.kitchen.hob==='unknown'?'clock':'check'} size={14}/><span>Hob</span><strong>{saved.kitchen.hob==='unknown'?'Not confirmed':saved.kitchen.hob[0].toUpperCase()+saved.kitchen.hob.slice(1)}</strong></li><li><Icon name={saved.kitchen.oven==='yes'?'check':'clock'} size={14}/><span>Oven</span><strong>{yesNo[saved.kitchen.oven]}</strong></li><li><Icon name={saved.kitchen.refrigerator==='yes'?'check':'clock'} size={14}/><span>Refrigeration</span><strong>{yesNo[saved.kitchen.refrigerator]}</strong></li><li><Icon name={saved.kitchen.prepSpace.trim()?'check':'clock'} size={14}/><span>Preparation space</span><strong>{saved.kitchen.prepSpace||'Not confirmed'}</strong></li></ul></div>
    {missing.length>0&&<p className="guest-detail-followup"><Icon name="info" size={15}/><span>Still to check: {missing.join(', ')}.</span></p>}{reviewed&&saved.reviewedAt&&<p className="guest-detail-date">Address reviewed {businessDate(saved.reviewedAt)}</p>}
    {editing&&draft&&<Modal title="Venue & arrival details" subtitle={`${booking.guest} · ${bookingId}`} onClose={()=>setEditing(false)} wide><form className="guest-detail-form" onSubmit={(event:FormEvent)=>{event.preventDefault();save(false)}}>
      <div className="guest-detail-form-grid"><label className="field">Venue type<select value={draft.kind} onChange={event=>change('kind',event.target.value as VenueRecord['kind'])}>{Object.entries(venueKinds).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label className="field">Venue name<input value={draft.name} onChange={event=>change('name',event.target.value)} maxLength={120} placeholder="Guest’s home or venue name"/></label></div>
      <fieldset className="guest-detail-fieldset"><legend>Exact address</legend><label className="field">Street address<input value={draft.address.line1} onChange={event=>changeAddress('line1',event.target.value)} autoComplete="street-address" maxLength={160}/></label><label className="field">Apartment, suite, or access point<input value={draft.address.line2} onChange={event=>changeAddress('line2',event.target.value)} maxLength={120}/></label><div className="guest-address-locality"><label className="field">City<input value={draft.address.city} onChange={event=>changeAddress('city',event.target.value)} maxLength={100}/></label><label className="field">State / region<input value={draft.address.region} onChange={event=>changeAddress('region',event.target.value)} maxLength={70}/></label><label className="field">Postal code<input value={draft.address.postalCode} onChange={event=>changeAddress('postalCode',event.target.value)} maxLength={20}/></label></div></fieldset>
      <fieldset className="guest-detail-fieldset"><legend>On the day</legend><div className="guest-detail-form-grid"><label className="field">Arrival contact<input value={draft.contactName} onChange={event=>change('contactName',event.target.value)} maxLength={120}/></label><label className="field">Contact phone<input type="tel" value={draft.contactPhone} onChange={event=>change('contactPhone',event.target.value)} maxLength={50}/></label></div><label className="field">Arrival & access notes<textarea rows={3} value={draft.arrivalNotes} onChange={event=>change('arrivalNotes',event.target.value)} placeholder="Arrival time, gate code, entry point, or who will meet you" maxLength={1200}/></label><label className="field">Parking & unloading<textarea rows={2} value={draft.parking} onChange={event=>change('parking',event.target.value)} maxLength={800}/></label></fieldset>
      <fieldset className="guest-detail-fieldset"><legend>Kitchen equipment</legend><div className="guest-kitchen-form-grid"><label className="field">Hob type<select value={draft.kitchen.hob} onChange={event=>change('kitchen',{...draft.kitchen,hob:event.target.value as VenueRecord['kitchen']['hob']})}><option value="unknown">Not confirmed</option><option value="gas">Gas</option><option value="electric">Electric</option><option value="induction">Induction</option></select></label>{(['oven','refrigerator'] as const).map(key=><label key={key} className="field">{key==='oven'?'Oven':'Refrigeration'}<select value={draft.kitchen[key]} onChange={event=>change('kitchen',{...draft.kitchen,[key]:event.target.value as VenueRecord['kitchen'][typeof key]})}>{Object.entries(yesNo).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>)}</div><label className="field">Preparation space & equipment notes<textarea rows={2} value={draft.kitchen.prepSpace} onChange={event=>change('kitchen',{...draft.kitchen,prepSpace:event.target.value})} placeholder="Counter space, serving equipment, and anything to bring" maxLength={1200}/></label></fieldset>
      <label className="guest-confirm-checkbox"><input type="checkbox" checked={addressConfirmed} onChange={event=>{setAddressConfirmed(event.target.checked);setError('')}}/><span>I have confirmed the exact address and access arrangements with the host.</span></label><p className="guest-detail-form-note">Address review is separate from the kitchen check. Any missing equipment stays visibly unconfirmed.</p>{error&&<p className="form-error" role="alert">{error}</p>}<div className="guest-detail-form-actions"><button className="button secondary" type="button" onClick={()=>setEditing(false)}>Cancel</button><button className="button secondary" type="submit" disabled={pending}>{pending?'Saving…':'Save details'}</button><button className="button" type="button" disabled={pending} onClick={()=>save(true)}>Save and mark reviewed</button></div>
    </form></Modal>}
  </section>
}

export function DietaryDetails({bookingId}:{bookingId:string}) {
  const {state,update,notify,businessDate:today,pending}=useAdmin()
  const booking=state.bookings.find(item=>item.id===bookingId)
  const [draft,setDraft]=useState<DietaryWithSource|null>(null)
  const [editing,setEditing]=useState(false)
  const [confirmed,setConfirmed]=useState(false)
  const [confirmedDate,setConfirmedDate]=useState(today)
  const [error,setError]=useState('')
  if(!booking)return null
  const saved=(state.operations.details[bookingId]?.dietary??emptyDetails(booking).dietary) as DietaryWithSource
  const originalNote=saved.originalNote??saved.prepNotes??booking.dietary
  const issues=dietaryIssues(saved)
  const reviewed=!!saved.confirmedAt&&!issues.length
  const open=()=>{setDraft({...structuredClone(saved),originalNote});setConfirmed(false);setConfirmedDate(saved.confirmationDate??saved.confirmedAt?.slice(0,10)??today);setError('');setEditing(true)}
  const changeDraft=(change:(current:DietaryWithSource)=>DietaryWithSource)=>{setConfirmed(false);setError('');setDraft(current=>current?change(current):current)}
  const editGuest=(id:string,change:(guest:DietaryGuest)=>DietaryGuest)=>changeDraft(current=>({...current,guests:current.guests.map(guest=>guest.id===id?change(guest):guest)}))
  const editAllergy=(guestId:string,index:number,key:keyof Allergy,value:string)=>editGuest(guestId,guest=>({...guest,allergies:guest.allergies.map((allergy,i)=>i===index?{...allergy,[key]:value}:allergy)}))
  const addGuest=()=>changeDraft(current=>({...current,guests:[...current.guests,{id:crypto.randomUUID(),name:'',restrictions:[],allergies:[],notes:''}]}))
  const save=async(markConfirmed:boolean)=>{
    if(!draft)return
    const nextIssues=dietaryIssues(draft)
    if(markConfirmed&&(!confirmed||!draft.source.trim()||!confirmedDate||confirmedDate>today||nextIssues.length)){setError(nextIssues.length?nextIssues.join(' '):'Record the source and confirmation date, then confirm that these details cover the whole party.');return}
    const dietary:DietaryWithSource={...draft,source:draft.source.trim(),originalNote,guests:draft.guests.map(guest=>({...guest,name:guest.name.trim()||'Guest to identify',restrictions:guest.restrictions.map(value=>value.trim()).filter(Boolean),allergies:guest.allergies.map(allergy=>({...allergy,allergen:allergy.allergen.trim()}))})),confirmationDate:confirmedDate,confirmedAt:markConfirmed?recordedAt():null}
    const persisted=await update(`${markConfirmed?'Confirmed':'Updated'} dietary details for ${bookingId}`,next=>{
      const details=next.operations.details[bookingId]??emptyDetails(booking)
      next.operations.details[bookingId]={...details,dietary}
      const item=next.bookings.find(item=>item.id===bookingId)
      if(item){const individual=dietary.guests.map(guest=>`${guest.name}: ${[...guest.restrictions,...guest.allergies.map(allergy=>`${allergy.allergen||'Allergen to confirm'} (${allergyLabels[allergy.severity].toLowerCase()}; ${contactLabels[allergy.crossContact].toLowerCase()})`)].join(', ')||'No restrictions recorded'}`).join('; ');item.dietary=[individual,dietary.prepNotes.trim()].filter(Boolean).join('\n')||originalNote||'No individual dietary requirements recorded.'}
    })
    if(!persisted)return
    setEditing(false);notify(markConfirmed?'Dietary details confirmed and saved.':'Dietary details saved. Confirmation is still open.')
  }
  const draftIssues=draft?dietaryIssues(draft):[]
  return <section className="guest-details-section dietary-details">
    <div className="guest-details-heading"><div><h3>Dietary needs & allergies</h3><DetailStatus confirmed={reviewed}>{reviewed?'Guest details confirmed':'Needs guest confirmation'}</DetailStatus></div><button className="button secondary" onClick={open}><Icon name="edit" size={15}/>Edit dietary details</button></div>
    {saved.guests.length?<div className="guest-dietary-list">{saved.guests.map(guest=><article className="guest-dietary-record" key={guest.id}><div className="guest-dietary-person"><Icon name="people" size={17}/><strong>{guest.name||'Guest to identify'}</strong>{unidentified(guest.name)&&<span className="guest-unidentified">Name needed</span>}</div>{guest.restrictions.length>0&&<ul className="guest-restriction-list">{guest.restrictions.map((restriction,i)=><li key={i}>{restriction}</li>)}</ul>}{guest.allergies.map((allergy,i)=><div className={'guest-allergy-summary '+(allergy.severity==='severe_allergy'?'severe':'')} key={i}><strong>{allergy.allergen||'Allergen to confirm'}</strong><span>{allergyLabels[allergy.severity]}</span><p>{contactLabels[allergy.crossContact]}</p>{allergy.notes&&<p>{allergy.notes}</p>}</div>)}{guest.notes&&<p className="guest-dietary-note">{guest.notes}</p>}</article>)}</div>:<p className="guest-no-records">No individual guest requirements are recorded yet. Confirm the whole party’s needs before finalizing the menu.</p>}
    {issues.length>0&&<div className="guest-detail-followup"><Icon name="info" size={16}/><span>{issues.length} {issues.length===1?'detail needs':'details need'} confirmation. Open the record to resolve names and reported requirements.</span></div>}
    <details className="guest-original-note"><summary>Original guest note</summary><p>{originalNote||'No dietary note was supplied.'}</p></details>{saved.prepNotes&&saved.prepNotes!==originalNote&&<div className="guest-prep-notes"><h4>Preparation notes</h4><p>{saved.prepNotes}</p></div>}
    <p className="guest-detail-date">Source: {saved.source||'Not recorded'}{reviewed&&saved.confirmedAt?` · Guest confirmed ${new Date((saved.confirmationDate??saved.confirmedAt.slice(0,10))+'T12:00:00Z').toLocaleDateString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',year:'numeric'})}`:' · Not yet confirmed'}</p>{reviewed&&saved.confirmedAt&&<p className="guest-detail-recorded">Recorded {businessDate(saved.confirmedAt)}</p>}
    {editing&&draft&&<Modal title="Dietary details, guest by guest" subtitle={`${booking.guest} · ${booking.guests} guests · ${bookingId}`} onClose={()=>setEditing(false)} wide><form className="guest-detail-form" onSubmit={(event:FormEvent)=>{event.preventDefault();save(false)}}>
      <div className="guest-source-note"><strong>Original guest note</strong><p>{originalNote||'No dietary note was supplied.'}</p><span>Kept with the record. Reported preferences are not automatically classified as allergies.</span></div>
      {draft.guests.map((guest,index)=><fieldset className="guest-dietary-editor" key={guest.id}><legend>Guest {index+1}</legend><div className="guest-editor-heading"><label className="field">Guest’s name<input value={guest.name} onChange={event=>editGuest(guest.id,current=>({...current,name:event.target.value}))} maxLength={120} placeholder="Use a name you can identify on the day"/></label><button className="guest-remove" type="button" onClick={()=>changeDraft(current=>({...current,guests:current.guests.filter(item=>item.id!==guest.id)}))}>Remove guest</button></div>{unidentified(guest.name)&&<p className="guest-record-warning">Identify this guest before confirming the record.</p>}
        <div className="guest-restrictions-editor"><span>Dietary preferences & restrictions</span><div>{restrictions.map(restriction=><button key={restriction} type="button" aria-pressed={guest.restrictions.includes(restriction)} onClick={()=>editGuest(guest.id,current=>({...current,restrictions:current.restrictions.includes(restriction)?current.restrictions.filter(value=>value!==restriction):[...current.restrictions,restriction]}))}>{guest.restrictions.includes(restriction)&&<Icon name="check" size={13}/>}<span>{restriction}</span></button>)}</div></div><label className="field">Other restrictions (separate with commas)<input value={guest.restrictions.filter(value=>!restrictions.includes(value)).join(', ')} onChange={event=>editGuest(guest.id,current=>({...current,restrictions:[...current.restrictions.filter(value=>restrictions.includes(value)),...event.target.value.split(',').map(value=>value.trimStart())]}))} maxLength={500}/></label>
        <div className="guest-allergy-editor-heading"><h4>Reported allergies & intolerances</h4><button className="button secondary" type="button" onClick={()=>editGuest(guest.id,current=>({...current,allergies:[...current.allergies,{allergen:'',severity:'unconfirmed',crossContact:'ask_guest',notes:''}]}))}><Icon name="plus" size={15}/>Add reported requirement</button></div>
        {guest.allergies.map((allergy,allergyIndex)=><div className="guest-allergy-editor" key={allergyIndex}><div className="guest-allergy-title"><strong>Requirement {allergyIndex+1}</strong><button className="guest-remove" type="button" onClick={()=>editGuest(guest.id,current=>({...current,allergies:current.allergies.filter((_,i)=>i!==allergyIndex)}))}>Remove requirement</button></div><div className="guest-detail-form-grid"><label className="field">Food / allergen<input value={allergy.allergen} onChange={event=>editAllergy(guest.id,allergyIndex,'allergen',event.target.value)} maxLength={120} placeholder="Record the guest’s wording"/></label><label className="field">How the guest described it<select value={allergy.severity} onChange={event=>editAllergy(guest.id,allergyIndex,'severity',event.target.value)}>{Object.entries(allergyLabels).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label></div><label className="field">Cross-contact instructions<select value={allergy.crossContact} onChange={event=>editAllergy(guest.id,allergyIndex,'crossContact',event.target.value)}>{Object.entries(contactLabels).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label><label className="field">Guest’s instructions & follow-up notes<textarea rows={2} value={allergy.notes} onChange={event=>editAllergy(guest.id,allergyIndex,'notes',event.target.value)} maxLength={1600}/></label></div>)}
        <label className="field">Other notes for this guest<textarea rows={2} value={guest.notes} onChange={event=>editGuest(guest.id,current=>({...current,notes:event.target.value}))} maxLength={1200}/></label>
      </fieldset>)}
      <button className="button secondary guest-add-person" type="button" onClick={addGuest}><Icon name="plus" size={16}/>Add a guest</button><label className="field">Preparation notes for the kitchen<textarea rows={3} value={draft.prepNotes} onChange={event=>changeDraft(current=>({...current,prepNotes:event.target.value}))} maxLength={2500}/></label><div className="guest-detail-form-grid"><label className="field">Source / who confirmed these details<input value={draft.source} onChange={event=>changeDraft(current=>({...current,source:event.target.value}))} placeholder="For example: guest name, phone call" maxLength={250}/></label><label className="field">Confirmation date<input type="date" value={confirmedDate} max={today} onInput={event=>{setConfirmedDate(event.currentTarget.value);setConfirmed(false);setError('')}}/></label></div>
      {draftIssues.length>0&&<div className="guest-open-questions"><strong>Still to confirm</strong><ul>{draftIssues.map((issue,i)=><li key={i}>{issue}</li>)}</ul></div>}<label className="guest-confirm-checkbox"><input type="checkbox" checked={confirmed} onChange={event=>{setConfirmed(event.target.checked);setError('')}}/><span>The guest has confirmed this list covers the whole party, including any cross-contact instructions.</span></label><p className="guest-detail-form-note">Saving changes reopens confirmation. “Save and confirm” records the source and date after the open questions are resolved.</p>{error&&<p className="form-error" role="alert">{error}</p>}<div className="guest-detail-form-actions"><button className="button secondary" type="button" onClick={()=>setEditing(false)}>Cancel</button><button className="button secondary" type="submit" disabled={pending}>{pending?'Saving…':'Save details'}</button><button className="button" type="button" disabled={pending} onClick={()=>save(true)}>Save and confirm</button></div>
    </form></Modal>}
  </section>
}
