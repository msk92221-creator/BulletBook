import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { addDays, dateKey, monthGrid, parseDate } from './calendar';

const weekdays=['일','월','화','수','목','금','토'];
const fullDate=(day:string)=>new Intl.DateTimeFormat('ko-KR',{year:'numeric',month:'long',day:'numeric',weekday:'short'}).format(parseDate(day));

function CalendarPicker({label,value,min,onSelect,onClose,optional}:{label:string;value:string;min?:string;onSelect:(day:string)=>void;onClose:()=>void;optional:boolean}){
  const today=dateKey(new Date()),initial=value||(min&&today<min?min:today);
  const [month,setMonth]=useState(()=>parseDate(initial));
  const [focused,setFocused]=useState(initial);
  const panel=useRef<HTMLDivElement>(null),days=monthGrid(month);
  useEffect(()=>{panel.current?.scrollIntoView({block:'nearest'});},[]);
  useEffect(()=>{panel.current?.querySelector<HTMLButtonElement>(`[data-day="${focused}"]`)?.focus({preventScroll:true});},[focused]);
  const select=(day:string)=>{if(!min||day>=min)onSelect(day);};
  const move=(year:number,monthIndex:number)=>{
    const next=new Date(year,monthIndex,1,12);
    setMonth(next);setFocused(dateKey(next));
  };
  const navigate=(e:KeyboardEvent<HTMLButtonElement>,day:string)=>{
    let target:string|undefined;
    const offsets:Record<string,number>={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7};
    if(e.key in offsets)target=addDays(day,offsets[e.key]);
    if(e.key==='Home')target=addDays(day,-parseDate(day).getDay());
    if(e.key==='End')target=addDays(day,6-parseDate(day).getDay());
    if(target){e.preventDefault();if(min&&target<min)target=min;setFocused(target);setMonth(parseDate(target));}
  };
  const year=month.getFullYear();
  const firstYear=Math.min(1900,year),lastYear=Math.max(2199,year);
  return <div className="date-picker-panel" ref={panel} role="group" aria-label={`${label} 달력`} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();onClose();}}}>
    <div className="date-picker-title"><strong>{label} 선택</strong><button type="button" className="icon-button" aria-label={`${label} 달력 닫기`} onClick={onClose}><X size={18}/></button></div>
    <div className="date-picker-nav">
      <button type="button" className="icon-button" aria-label={`${label} 이전 달`} onClick={()=>move(year,month.getMonth()-1)}><ChevronLeft size={19}/></button>
      <select aria-label={`${label} 연도`} value={year} onChange={e=>move(Number(e.target.value),month.getMonth())}>{Array.from({length:lastYear-firstYear+1},(_,i)=>firstYear+i).map(y=><option key={y} value={y}>{y}년</option>)}</select>
      <select aria-label={`${label} 월`} value={month.getMonth()} onChange={e=>move(year,Number(e.target.value))}>{Array.from({length:12},(_,i)=><option key={i} value={i}>{i+1}월</option>)}</select>
      <button type="button" className="icon-button" aria-label={`${label} 다음 달`} onClick={()=>move(year,month.getMonth()+1)}><ChevronRight size={19}/></button>
    </div>
    <div className="date-picker-grid">
      {weekdays.map((day,i)=><span key={day} aria-hidden="true" className={i===0?'sunday':i===6?'saturday':''}>{day}</span>)}
      {days.map((day,i)=><button type="button" key={day} data-day={day} aria-label={fullDate(day)} aria-pressed={day===value} aria-current={day===today?'date':undefined} aria-disabled={!!min&&day<min} tabIndex={day===focused?0:-1}
        className={`${parseDate(day).getMonth()!==month.getMonth()?'other-month':''} ${i%7===0?'sunday':i%7===6?'saturday':''} ${day===value?'picked':''}`}
        onKeyDown={e=>navigate(e,day)} onClick={()=>select(day)}>{parseDate(day).getDate()}</button>)}
    </div>
    <div className="date-picker-footer"><button type="button" className="text-button" disabled={!!min&&today<min} onClick={()=>select(today)}>오늘</button><span>{value?fullDate(value):'날짜를 선택해 주세요'}</span>{optional&&<button type="button" className="text-button" onClick={()=>onSelect('')}>종료 없음</button>}</div>
  </div>;
}

export function DatePicker({label,shortLabel,value,min,open,onOpenChange,onChange,optional=false,children}:{label:string;shortLabel?:string;value:string;min?:string;open:boolean;onOpenChange:(open:boolean)=>void;onChange:(day:string)=>void;optional?:boolean;children?:ReactNode}){
  const id=useId(),trigger=useRef<HTMLButtonElement>(null);
  const close=()=>{onOpenChange(false);trigger.current?.focus();};
  return <div className={`date-field ${optional?'repeat-date':''}`}>
    <div className="date-row"><span>{shortLabel||label}</span><button type="button" ref={trigger} className={`date-trigger ${open?'active':''}`} aria-label={label} aria-expanded={open} aria-controls={open?id:undefined} onClick={()=>onOpenChange(!open)}><span>{value?<>{value.replaceAll('-','.')}<span className="date-weekday"> ({weekdays[parseDate(value).getDay()]})</span></>:'종료 없음'}</span><CalendarDays size={17}/></button>{children}</div>
    {open&&<div id={id}><CalendarPicker label={label} value={value} min={min} optional={optional} onSelect={day=>{onChange(day);close();}} onClose={close}/></div>}
  </div>;
}
