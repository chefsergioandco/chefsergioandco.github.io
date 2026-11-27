import { seedOperations, type OperationsState } from './operations'
import type { BookingPlanning, BookingSettings } from './planning'
export type BookingStatus = 'requested' | 'held' | 'confirmed' | 'cancelled'
export type Booking = {
  id: string; guest: string; email: string; phone: string; type: 'Private dinner' | 'Cooking class' | 'Small event' | "Sergio’s Table";
  date: string; time: string; guests: number; status: BookingStatus; deposit: number; paid: number; total: number;
  /** Milliseconds from page load to submit, measured by the guest's browser (no analytics tracker). */
  clientElapsedMs?: number;
  location: string; occasion: string; dietary: string; notes: string; created: string; source?: 'public'; nightId?: string; planning?: BookingPlanning
}
/** A published date guests join by the seat: dinner at Sergio's table (his home) or a cooking class (location set per date). */
export type Night = { id: string; title: string; date: string; time: string; seats: number; booked: number; minimum: number; price: number; cutoff: number; menu: string; status: 'draft' | 'published' | 'cancelled'; kind?: 'table' | 'class'; location?: string }
export type Block = {id: string; date: string; reason: string}
export type WebsiteContent = {headline: string; introduction: string; dinnerPrice: number; classPrice: number; tablePrice: number; dinnerMenu: string; replyTime: string; cancellation: string; photo: string}
export type Revision = { id: string; date: string; content: WebsiteContent; label: string }
export type Activity = {id: string; at: string; text: string}
export type AdminState = {
  bookings: Booking[]; nights: Night[]; blocks: Block[]; operations: OperationsState;
  availability: {days: number[]; start: string; end: string; leadDays: number};
  website: {draft: WebsiteContent; published: WebsiteContent; revisions: Revision[]};
  activity: Activity[]
  bookingSettings?: BookingSettings
}
export const DEMO_TODAY = '2026-11-23'
export const money = (n: number) => new Intl.NumberFormat('en-US', {style:'currency', currency:'USD', minimumFractionDigits:0, maximumFractionDigits:2}).format(n)
export const dateLabel = (date: string, options?: Intl.DateTimeFormatOptions) => date ? new Date(date+'T12:00:00').toLocaleDateString('en-US', options ?? {month:'short',day:'numeric'}) : 'Date to agree'
export const timeLabel = (time: string) => time ? new Date('2026-11-23T'+time).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}) : 'Time to agree'
const content: WebsiteContent = {headline:'Good food. Better company.',introduction:'Private dinners, hands-on cooking classes, and evenings around Sergio’s table. Thoughtfully prepared, made to be shared.',dinnerPrice:125,classPrice:85,tablePrice:95,dinnerMenu:'Seared scallops · saffron cauliflower · citrus butter\nSlow-braised short rib · potato pavé · red wine jus\nVanilla bean panna cotta · seasonal berries',replyTime:'Within 24 hours',cancellation:'Deposits are refundable up to 7 days before your event. Within 7 days, we will work with you to find a new date.',photo:'dinner'}
export function seedState(): AdminState {
  const base: Omit<AdminState,'operations'> = {
    bookings:[
      {id:'SC-1048',guest:'Olivia Bennett',email:'olivia.bennett@example.com',phone:'(407) 555-0148',type:'Private dinner',date:'2026-11-28',time:'18:30',guests:8,status:'requested',deposit:250,paid:0,total:1000,location:'Winter Park, FL',occasion:'A 40th birthday, quietly celebrated',dietary:'One guest is gluten-free. No shellfish for the birthday guest.',notes:'Prefers a seasonal menu. Ask about access to the kitchen before the menu call.',created:'2026-11-23T08:42:00'},
      {id:'SC-1047',guest:'James & Maya Chen',email:'james.chen@example.com',phone:'(321) 555-0147',type:'Private dinner',date:'2026-11-27',time:'18:00',guests:6,status:'held',deposit:250,paid:250,total:750,location:'Baldwin Park, FL',occasion:'Our tenth anniversary',dietary:'Maya is vegetarian; everyone else eats everything.',notes:'Deposit received. Menu call on Tuesday at 10 am.',created:'2026-11-22T16:15:00'},
      {id:'SC-1046',guest:'The Rivera family',email:'ana.rivera@example.com',phone:'(407) 555-0146',type:'Cooking class',date:'2026-11-25',time:'17:00',guests:4,status:'confirmed',deposit:150,paid:150,total:340,location:'Orlando, FL',occasion:'Fresh pasta, together',dietary:'No restrictions.',notes:'Two adults and two teenagers. Bring extra aprons.',created:'2026-11-21T11:30:00'},
      {id:'SC-1045',guest:'Alex Morgan',email:'alex.morgan@example.com',phone:'(407) 555-0145',type:'Small event',date:'2026-12-05',time:'19:00',guests:18,status:'requested',deposit:0,paid:0,total:2160,location:'Lake Nona, FL',occasion:'A holiday gathering for our team',dietary:'Two vegetarians; one nut allergy.',notes:'Needs a quote. Interested in passed small plates and a family-style main.',created:'2026-11-21T09:20:00'},
      {id:'SC-1044',guest:'Sophie Williams',email:'sophie.williams@example.com',phone:'(321) 555-0144',type:'Private dinner',date:'2026-11-26',time:'18:00',guests:10,status:'confirmed',deposit:250,paid:1250,total:1250,location:'Windermere, FL',occasion:'Thanksgiving with friends',dietary:'One dairy-free guest.',notes:'Menu approved. Groceries confirmed. Arrive at 3:30 pm.',created:'2026-11-18T14:05:00'},
      {id:'SC-1043',guest:'Noah Patel',email:'noah.patel@example.com',phone:'(407) 555-0143',type:'Cooking class',date:'2026-12-02',time:'17:30',guests:6,status:'held',deposit:150,paid:150,total:510,location:'Winter Garden, FL',occasion:'A gift for the family',dietary:'No beef.',notes:'Would love a Spanish menu.',created:'2026-11-17T10:00:00'},
      {id:'SC-1042',guest:'Emma Laurent',email:'emma.laurent@example.com',phone:'(407) 555-0142',type:'Private dinner',date:'2026-12-12',time:'19:00',guests:4,status:'confirmed',deposit:250,paid:250,total:500,location:'Winter Park, FL',occasion:'An evening with visiting friends',dietary:'Pescatarian menu for all four.',notes:'Likes Mediterranean flavors.',created:'2026-11-16T12:30:00'},
      {id:'SC-1041',guest:'Daniel Brooks',email:'daniel.brooks@example.com',phone:'(321) 555-0141',type:'Private dinner',date:'2026-11-24',time:'18:00',guests:6,status:'cancelled',deposit:250,paid:0,total:750,location:'Orlando, FL',occasion:'Family dinner',dietary:'No restrictions.',notes:'Guest cancelled on November 15. Deposit refunded.',created:'2026-11-14T09:00:00'}
    ],
    nights:[
      {id:'night-1',title:'An evening in Valencia',date:'2026-12-04',time:'19:00',seats:10,booked:6,minimum:6,price:95,cutoff:72,menu:'Pan con tomate\nSeafood paella, cooked together\nOrange & olive oil cake',status:'published'},
      {id:'night-2',title:'The winter table',date:'2026-12-11',time:'19:00',seats:10,booked:0,minimum:6,price:110,cutoff:72,menu:'Roasted squash & brown butter\nBraised short rib, family style\nDark chocolate crémeux',status:'draft'}
    ],
    blocks:[{id:'block-1',date:'2026-11-30',reason:'A day with family'},{id:'block-2',date:'2026-12-24',reason:'Holiday break'},{id:'block-3',date:'2026-12-25',reason:'Holiday break'}],
    availability:{days:[2,3,4,5,6],start:'17:00',end:'21:00',leadDays:3},
    website:{draft:{...content},published:{...content},revisions:[{id:'rev-1',date:'2026-11-20T10:00:00',content:{...content},label:'Original preview'}]},
    activity:[{id:'act-1',at:'2026-11-23T08:42:00',text:'New dinner request from Olivia Bennett'},{id:'act-2',at:'2026-11-22T16:15:00',text:'James & Maya Chen paid their $250 deposit'},{id:'act-3',at:'2026-11-21T11:30:00',text:'Rivera family cooking class confirmed'}]
  }
  return {...base,operations:seedOperations(base.bookings,base.nights)}
}
