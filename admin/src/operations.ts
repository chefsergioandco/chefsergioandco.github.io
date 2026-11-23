import type { Booking, Night } from './model'
export type BillingEventKind = 'initiated'|'processing'|'posted'|'failed'|'canceled'|'refund_initiated'|'refunded'|'offline_received'|'plan_changed'|'invoice_issued'|'payment_link_created'|'credit_issued'
export type BillingEvent = {id:string;kind:BillingEventKind;at:string;amount:number;reference:string;description:string;actor:string;transactionId?:string}
export type CollectionPlan = {mode:'auto_debit'|'manual'|'paused';dueAt:string;amount:number;changedAt:string;reason:string}
export type BillingRecord = {id:string;invoiceState?:'draft'|'open'|'paid'|'void'|'uncollectible';bookingId:string|null;nightId?:string;reservationId?:string;customer:string;eventDate:string;eventLabel:string;invoiceNumber:string;issuedAt:string;items:{description:string;quantity:number;unitPrice:number}[];total:number;consent:{status:'on_file'|'not_recorded'|'revoked';recordedAt:string|null;method:string;last4:string};collection:CollectionPlan;events:BillingEvent[];refundReview:boolean}
export type VenueRecord={kind:'guest_home'|'sergio_home'|'event_venue'|'undecided';name:string;address:{line1:string;line2:string;city:string;region:string;postalCode:string};contactName:string;contactPhone:string;arrivalNotes:string;parking:string;kitchen:{hob:'gas'|'electric'|'induction'|'unknown';oven:'yes'|'no'|'unknown';refrigerator:'yes'|'no'|'unknown';prepSpace:string};reviewedAt:string|null}
export type Allergy={allergen:string;severity:'allergy'|'severe_allergy'|'intolerance'|'unconfirmed';crossContact:'avoid'|'ask_guest'|'not_required';notes:string}
export type DietaryGuest={id:string;name:string;restrictions:string[];allergies:Allergy[];notes:string}
export type DietaryRecord={confirmationDate?:string;originalNote?:string;confirmedAt:string|null;source:string;guests:DietaryGuest[];prepNotes:string}
export type BookingDetails={venue:VenueRecord;dietary:DietaryRecord}
export type TableReservation={id:string;guest:string;seats:number;status:'active'|'cancellation_requested'|'cancelled';bookedAt:string;requestedAt:string|null;cancelledAt:string|null;billingId:string}
export type TableEvent={id:string;at:string;description:string;actor:string}
export type TableSession={nightId:string;reachedAt:string|null;decision:'standard'|'recovering'|'continue_below'|'cancelled';reason:string;decidedAt:string|null;recoveryDeadline:string|null;reservations:TableReservation[];events:TableEvent[]}
export type OperationsState={billing:BillingRecord[];details:Record<string,BookingDetails>;sessions:Record<string,TableSession>}
export const DEMO_NOW='2026-11-23T14:00:00Z'
export const businessDate=(value:string,precise=false)=>new Date(value).toLocaleString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',second:precise?'2-digit':undefined})+' ET'
export function receivedFor(record:BillingRecord){return Math.max(0,record.events.reduce((sum,e)=>sum+(['posted','offline_received'].includes(e.kind)?e.amount:e.kind==='refunded'?-e.amount:0),0))}
export function creditFor(record:BillingRecord){return record.events.filter(e=>e.kind==='credit_issued').reduce((sum,e)=>sum+e.amount,0)}
export function creditNeededForRefund(record:BillingRecord,amount:number){const effective=record.invoiceState==='void'?0:Math.max(0,record.total-creditFor(record));const overpayment=Math.max(0,receivedFor(record)-effective);return Math.min(Math.max(0,record.total-creditFor(record)),Math.max(0,Math.round((amount-overpayment)*100)/100))}
export function balanceFor(record:BillingRecord){if(record.invoiceState==='void')return 0;return Math.max(0,Math.round((record.total-creditFor(record)-receivedFor(record))*100)/100)}
/** Close a cancellation without voiding an invoice that already has a receipt. */
export function closeBillingInvoice(record:BillingRecord,at:string,reason:string){
 const received=receivedFor(record),outstanding=balanceFor(record)
 const hasReceipt=record.events.some(e=>e.kind==='posted'||e.kind==='offline_received')||record.invoiceState==='paid'
 if(hasReceipt){
  if(outstanding>0)record.events.push({id:crypto.randomUUID(),kind:'credit_issued',at,amount:outstanding,reference:'DEMO-CN-'+crypto.randomUUID().slice(0,8).toUpperCase(),description:'Unpaid remainder credited after cancellation. '+reason,actor:'Sergio · sample'})
  record.invoiceState='paid'
  record.refundReview=received>0
 }else record.invoiceState='void'
 record.collection={...record.collection,mode:'paused',amount:0,changedAt:at,reason}
}
export function quorumFor(night:Night,session?:TableSession){
 const reserved=session?session.reservations.filter(r=>r.status!=='cancelled').reduce((n,r)=>n+r.seats,0):night.booked
 const uncertain=session?session.reservations.filter(r=>r.status==='cancellation_requested').reduce((n,r)=>n+r.seats,0):0
 const state=night.status==='cancelled'||session?.decision==='cancelled'?'cancelled':session?.decision==='continue_below'?'continuing_below':session?.decision==='recovering'?'recovering':session?.reachedAt&&reserved<night.minimum?'below':session?.reachedAt&&reserved-uncertain<night.minimum?'at_risk':reserved>=night.minimum?'confirmed':'gathering'
 return {state,reserved,uncertain,secure:reserved-uncertain,shortfall:Math.max(0,night.minimum-reserved)}
}
const event=(kind:BillingEventKind,at:string,amount:number,reference:string,description:string,transactionId?:string):BillingEvent=>({id:crypto.randomUUID(),kind,at,amount,reference,description,actor:'Stripe · sample',transactionId})
export function newDetails(booking:Booking):BookingDetails{
 const city=booking.location.split(',')[0]||''
 const guests:DietaryGuest[]=[]
 if(booking.id==='SC-1048'){guests.push({id:'diet-1',name:'Guest to identify',restrictions:['Gluten-free'],allergies:[],notes:'Guest requested gluten-free; confirm whether this is an allergy or preference.'},{id:'diet-2',name:'Birthday guest',restrictions:['No shellfish'],allergies:[],notes:'Confirm the reason and cross-contact requirements with the guest.'})}
 else if(booking.id==='SC-1047')guests.push({id:'diet-1',name:'Maya Chen',restrictions:['Vegetarian'],allergies:[],notes:''})
 else if(booking.id==='SC-1045')guests.push({id:'diet-1',name:'Guest to identify',restrictions:[],allergies:[{allergen:'Tree nuts',severity:'unconfirmed',crossContact:'ask_guest',notes:'Nut allergy reported in the request; confirm the specific nuts and requirements.'}],notes:''},{id:'diet-2',name:'Two guests to identify',restrictions:['Vegetarian'],allergies:[],notes:'Confirm both names before the menu is finalized.'})
 else if(booking.id==='SC-1044')guests.push({id:'diet-1',name:'Guest to identify',restrictions:['Dairy-free'],allergies:[],notes:'Confirm the reason with the guest.'})
 else if(booking.id==='SC-1043')guests.push({id:'diet-1',name:'Whole party',restrictions:['No beef'],allergies:[],notes:''})
 else if(booking.id==='SC-1042')guests.push({id:'diet-1',name:'Whole party',restrictions:['Pescatarian'],allergies:[],notes:''})
 return {venue:{kind:'guest_home',name:'Guest’s home',address:{line1:'',line2:'',city,region:'FL',postalCode:''},contactName:booking.guest,contactPhone:booking.phone,arrivalNotes:'',parking:'',kitchen:{hob:'unknown',oven:'unknown',refrigerator:'unknown',prepSpace:''},reviewedAt:null},dietary:{originalNote:booking.dietary,confirmedAt:null,source:'Guest request',guests,prepNotes:booking.dietary}}
}
export function newBilling(booking:Booking):BillingRecord{
 const issuedAt=/Z$|[+-]\d{2}:\d{2}$/.test(booking.created)?booking.created:booking.created+'-05:00'
 const dueAt=booking.date?new Date(new Date(booking.date+'T15:00:00-05:00').getTime()-72*3600000).toISOString():''
 const paidAt=new Date(new Date(issuedAt).getTime()+30*60000).toISOString()
 const transactionId='DEMO-PI-'+booking.id
 const events=[event('invoice_issued',issuedAt,booking.total,'INV-'+booking.id.slice(3),'Draft quote and billing record created')]
 if(booking.paid>0){events.push(event('initiated',new Date(new Date(paidAt).getTime()-90000).toISOString(),booking.paid,transactionId,'Guest initiated payment',transactionId),event('posted',paidAt,booking.paid,transactionId,'Payment posted to the guest ledger',transactionId))}
 if(booking.status==='cancelled')events.push(event('canceled',new Date(new Date(paidAt).getTime()+3600000).toISOString(),0,'CXL-'+booking.id,'Booking cancelled; no further collection scheduled'))
 return {id:'bill-'+booking.id,invoiceState:booking.status==='cancelled'?'void':booking.total===0?'draft':booking.paid>=booking.total?'paid':'open',bookingId:booking.id,customer:booking.guest,eventDate:booking.date,eventLabel:booking.type,invoiceNumber:'INV-'+booking.id.slice(3),issuedAt,items:[{description:booking.type+' · '+booking.guests+' guests',quantity:booking.guests,unitPrice:booking.guests?booking.total/booking.guests:0}],total:booking.total,consent:{status:booking.paid>0?'on_file':'not_recorded',recordedAt:booking.paid>0?paidAt:null,method:booking.paid>0?'Visa':'No payment method on file',last4:booking.paid>0?'4242':''},collection:{mode:booking.status==='cancelled'?'paused':booking.paid>0&&booking.paid<booking.total?'auto_debit':'manual',dueAt,amount:booking.status==='cancelled'?0:Math.max(0,booking.total-booking.paid),changedAt:issuedAt,reason:booking.paid>0?'Sample authorization collected at checkout':'No authorization for automatic collection recorded'},events,refundReview:false}
}
export function seedOperations(bookings:Booking[],nights:Night[]):OperationsState{
 const billing=bookings.map(newBilling)
 const sessions:Record<string,TableSession>={}
 for(const night of nights){
  const reservations:TableReservation[]=[]
  let remaining=night.booked
  for(let i=0;remaining>0;i++){
   const seats=Math.min(2,remaining);remaining-=seats
   const reservationId=`${night.id}-party-${i+1}`;const billingId='bill-'+reservationId;const guest=['Riley Hart','Jordan Ellis','Morgan Davis'][i]||`Guest party ${i+1}`
   const at='2026-11-20T19:00:00Z';const ref=`DEMO-TABLE-${night.id}-${i+1}`
   reservations.push({id:reservationId,guest,seats,status:i===0?'cancellation_requested':'active',bookedAt:at,requestedAt:i===0?'2026-11-23T12:45:00Z':null,cancelledAt:null,billingId})
   billing.push({id:billingId,invoiceState:'paid',bookingId:null,nightId:night.id,reservationId,customer:guest,eventDate:night.date,eventLabel:'Sergio’s Table · '+night.title,invoiceNumber:`INV-TABLE-${night.id}-${i+1}`,issuedAt:at,items:[{description:night.title,quantity:seats,unitPrice:night.price}],total:seats*night.price,consent:{status:'on_file',recordedAt:at,method:'Visa',last4:'4242'},collection:{mode:i===0?'paused':'manual',dueAt:night.date+'T15:00:00-05:00',amount:0,changedAt:at,reason:i===0?'Cancellation requested; collection paused while Sergio reviews the guest change':'Seat payment posted when the minimum was reached'},events:[event('invoice_issued',at,seats*night.price,`INV-TABLE-${night.id}-${i+1}`,'Seat invoice created'),event('initiated',at,seats*night.price,ref,'Minimum reached; seat payment initiated',ref),event('posted','2026-11-20T19:01:00Z',seats*night.price,ref,'Seat payment posted',ref)],refundReview:false})
  }
  sessions[night.id]={nightId:night.id,reachedAt:night.booked>=night.minimum?'2026-11-20T19:00:00Z':null,decision:'standard',reason:'',decidedAt:null,recoveryDeadline:null,reservations,events:night.booked>=night.minimum?[{id:crypto.randomUUID(),at:'2026-11-20T19:00:00Z',description:`Minimum reached with ${night.booked} seats; evening confirmed.`,actor:'Booking system · sample'}]:[]}
 }
 for(const session of Object.values(sessions)){if(session.reservations.some(r=>r.status==='cancellation_requested')){session.events.unshift({id:crypto.randomUUID(),at:'2026-11-23T12:45:00Z',description:'Riley Hart requested cancellation of two seats. The minimum is at risk; the reservation remains held pending review.',actor:'Guest request · sample'});const bill=billing.find(record=>record.reservationId===session.reservations[0]?.id);if(bill)bill.events.push({...event('plan_changed','2026-11-23T12:45:00Z',0,bill.invoiceNumber,'Cancellation requested; collection paused pending review. No refund decision recorded.'),actor:'Booking system · sample'})}}
 return {billing,details:Object.fromEntries(bookings.map(b=>[b.id,newDetails(b)])),sessions}
}
export function hydrateOperations(bookings:Booking[],nights:Night[],current?:OperationsState):OperationsState{
 const seeded=seedOperations(bookings,nights)
 if(!current)return seeded
 return {billing:[...current.billing.map(record=>({...seeded.billing.find(seed=>seed.id===record.id),...record})),...seeded.billing.filter(b=>!current.billing.some(existing=>existing.id===b.id))],details:{...seeded.details,...current.details},sessions:{...seeded.sessions,...current.sessions}}
}
