export type Repeat = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
export type Category = string;
export interface EventCategory { id: string; label: string; color: string; deleted: boolean }
export interface Member { id: string; name: string; color: string }
export interface CalendarEvent {
  id: string; title: string; location: string; notes: string;
  startDate: string; endDate: string; startTime: string; endTime: string;
  allDay: boolean; repeat: Repeat; repeatUntil: string; category: Category;
  participants: string[]; isPrivate: boolean; createdBy: string;
}
export interface Occurrence extends CalendarEvent { occurrenceId: string; originalId: string }
export const CATEGORIES: Record<Category, {label:string;color:string;bg:string}> = {
  family: {label:'가족',color:'#4555ce',bg:'#e9ecff'},
  personal: {label:'개인',color:'#8260be',bg:'#f0e9fa'},
  school: {label:'학교·교육',color:'#257763',bg:'#e4f3ec'},
  health: {label:'건강',color:'#bb5b3e',bg:'#fff0e8'},
  anniversary: {label:'기념일',color:'#b37419',bg:'#fff3d6'},
};
export const UNCATEGORIZED = {id:'uncategorized',label:'미분류',color:'#737b8c',bg:'#eef0f4',deleted:false};
export const CATEGORY_COLORS = ['#4555ce','#8260be','#257763','#bb5b3e','#b37419','#be517d','#327fba','#737b8c'];
// Overrides include tombstones so deleting a default never restores it on another device.
export function activeCategories(overrides:EventCategory[]):EventCategory[] {
  const categories=new Map(Object.entries(CATEGORIES).map(([id,c])=>[id,{id,label:c.label,color:c.color,deleted:false}]));
  for(const category of overrides)categories.set(category.id,category);
  return [...categories.values()].filter(c=>!c.deleted);
}
export function categoryAppearance(categories:EventCategory[],id:string){
  const category=categories.find(c=>c.id===id);
  return category?{...category,bg:`${category.color}18`}:UNCATEGORIZED;
}
export const REPEATS: Record<Repeat,string> = {none:'반복 안 함',daily:'매일',weekly:'매주',monthly:'매월',yearly:'매년'};
export const COLORS = ['#4555ce','#d17a5d','#339985','#a46cc2','#bc942e','#458cc0'];
export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export function parseDate(key: string): Date { const [y,m,d]=key.split('-').map(Number); return new Date(y,m-1,d,12); }
export function addDays(key: string, days: number): string { const d=parseDate(key); d.setDate(d.getDate()+days); return dateKey(d); }
export function dayDiff(a:string,b:string):number {
  const [ay,am,ad]=a.split('-').map(Number); const [by,bm,bd]=b.split('-').map(Number);
  return Math.round((Date.UTC(by,bm-1,bd)-Date.UTC(ay,am-1,ad))/86400000);
}
export function monthGrid(month: Date): string[] {
  const first=new Date(month.getFullYear(),month.getMonth(),1,12);
  const start=addDays(dateKey(first),-first.getDay());
  const last=new Date(month.getFullYear(),month.getMonth()+1,0,12);
  const count=Math.ceil((first.getDay()+last.getDate())/7)*7;
  return Array.from({length:count},(_,i)=>addDays(start,i));
}
export function expandEvents(events:CalendarEvent[], from:string, to:string):Occurrence[] {
  const output:Occurrence[]=[];
  for(const event of events){
    const span=dayDiff(event.startDate,event.endDate);
    if(span<0) continue;
    const emit=(start:string)=>{
      const end=addDays(start,span);
      if(start<=to && end>=from) output.push({...event,startDate:start,endDate:end,originalId:event.id,occurrenceId:`${event.id}:${start}`});
    };
    if(event.repeat==='none'){emit(event.startDate);continue;}
    const stop=event.repeatUntil && event.repeatUntil<to ? event.repeatUntil : to;
    const first=addDays(from,-span)>event.startDate ? addDays(from,-span) : event.startDate;
    const origin=parseDate(event.startDate);
    for(let day=first;day<=stop;day=addDays(day,1)){
      const d=parseDate(day), diff=dayDiff(event.startDate,day);
      if(event.repeat==='daily' || (event.repeat==='weekly'&&diff%7===0) ||
        (event.repeat==='monthly'&&d.getDate()===origin.getDate()) ||
        (event.repeat==='yearly'&&d.getDate()===origin.getDate()&&d.getMonth()===origin.getMonth())) emit(day);
    }
  }
  return output.sort((a,b)=>a.startDate.localeCompare(b.startDate) || Number(b.allDay)-Number(a.allDay) || a.startTime.localeCompare(b.startTime) || a.title.localeCompare(b.title));
}
export function weekLanes(events:Occurrence[],week:string[]) {
  const occupied:boolean[][]=[];
  return events.filter(e=>e.startDate<=week[6]&&e.endDate>=week[0])
    .sort((a,b)=>a.startDate.localeCompare(b.startDate)||b.endDate.localeCompare(a.endDate)||a.startTime.localeCompare(b.startTime))
    .map(event=>{
      const start=Math.max(0,dayDiff(week[0],event.startDate)),end=Math.min(6,dayDiff(week[0],event.endDate));
      let lane=0;
      while(occupied[lane]?.slice(start,end+1).some(Boolean))lane++;
      occupied[lane]??=Array(7).fill(false);
      for(let i=start;i<=end;i++)occupied[lane][i]=true;
      return {event,start,end,lane};
    });
}
export function validateEvent(e:CalendarEvent):string|null {
  if(!e.title.trim())return '일정 제목을 입력해 주세요.';
  if(e.title.length>100)return '제목은 100자 이내로 입력해 주세요.';
  if(!e.startDate||!e.endDate||!/^\d{4}-\d{2}-\d{2}$/.test(e.startDate)||!/^\d{4}-\d{2}-\d{2}$/.test(e.endDate))return '시작일과 종료일을 확인해 주세요.';
  if(dateKey(parseDate(e.startDate))!==e.startDate||dateKey(parseDate(e.endDate))!==e.endDate)return '올바른 날짜를 입력해 주세요.';
  if(e.endDate<e.startDate)return '종료일은 시작일보다 빠를 수 없어요.';
  if(!e.allDay&&(!/^([01]\d|2[0-3]):[0-5]\d$/.test(e.startTime)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(e.endTime)))return '시작 시간과 종료 시간을 입력해 주세요.';
  if(!e.allDay&&e.startDate===e.endDate&&e.endTime<=e.startTime)return '종료 시간은 시작 시간보다 늦어야 해요.';
  if(e.repeat!=='none'&&e.repeatUntil&&e.repeatUntil<e.startDate)return '반복 종료일은 시작일 이후로 선택해 주세요.';
  if(dayDiff(e.startDate,e.endDate)>366)return '한 일정의 기간은 최대 1년으로 입력해 주세요.';
  return null;
}
export function newEvent(day:string,uid:string):CalendarEvent {
  return {id:crypto.randomUUID(),title:'',location:'',notes:'',startDate:day,endDate:day,startTime:'09:00',endTime:'10:00',allDay:false,repeat:'none',repeatUntil:'',category:'family',participants:[uid],isPrivate:false,createdBy:uid};
}
export function demoData(){
  const today=dateKey(new Date()),first=`${today.slice(0,7)}-01`;
  const day=(n:number)=>addDays(first,n-1);
  const make=(id:string,title:string,startDate:string,category:Category,extra:Partial<CalendarEvent>={})=>({...newEvent(startDate,'me'),id,title,category,...extra});
  return {categories:[] as EventCategory[],members:[{id:'me',name:'나',color:COLORS[0]},{id:'partner',name:'배우자',color:COLORS[1]},{id:'child',name:'아이',color:COLORS[2]}],events:[
    make('demo-1','가족 저녁 식사',today,'family',{startTime:'18:30',endTime:'20:00',location:'우리 집',participants:['me','partner','child'],notes:'좋아하는 음식을 하나씩 골라요.'}),
    make('demo-2','주말 가족 여행',day(16),'family',{endDate:day(18),allDay:true,location:'강릉',participants:['me','partner','child']}),
    make('demo-3','피아노 학원',day(5),'school',{repeat:'weekly',startTime:'16:00',endTime:'17:00',participants:['child']}),
    make('demo-4','정기 건강검진',day(13),'health',{startTime:'09:00',endTime:'11:00',participants:['partner']}),
    make('demo-5','할머니 생신',day(24),'anniversary',{allDay:true,repeat:'yearly',participants:['me','partner','child']}),
    make('demo-6','함께 장보기',day(10),'family',{startTime:'11:00',endTime:'12:00',participants:['me','partner']}),
    make('demo-7','운동하는 날',day(7),'personal',{repeat:'weekly',startTime:'19:00',endTime:'20:00',participants:['me']}),
    make('demo-8','가을 소풍',day(22),'school',{allDay:true,participants:['child'],location:'어린이대공원'}),
  ]};
}
