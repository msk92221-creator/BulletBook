import { colorText } from './color-palette';
import { CalendarDays, MapPin, Repeat2, LockKeyhole, Plus } from 'lucide-react';
import { expandEvents, categoryAppearance, REPEATS, type CalendarEvent, type Occurrence, type EventCategory, type Member } from './calendar';

// Expand only this date, without month filters or the widget's display limit.
export function dayAgendaEvents(events:CalendarEvent[],day:string):Occurrence[] {
  return expandEvents(events,day,day);
}
export function DayAgenda({day,events,categories,members,onOpen,onAdd}:{
  day:string;events:Occurrence[];categories:EventCategory[];members:Member[];
  onOpen:(event:Occurrence)=>void;onAdd:()=>void;
}) {
  return <section className="day-details">
    <div className="day-details-summary"><span>전체 일정 <strong>{events.length}개</strong></span><button className="button" onClick={onAdd}><Plus size={16}/>일정 추가</button></div>
    <div className="day-details-list" tabIndex={0} aria-label={`${day} 전체 일정 목록`}>
      {events.length===0?<div className="empty-agenda"><CalendarDays size={28}/><p>이 날짜에 등록된 일정이 없어요.</p></div>:events.map(event=>{
        const category=categoryAppearance(categories,event.category);
        const names=event.participants.map(id=>members.find(m=>m.id===id)?.name).filter(Boolean).join(' · ');
        return <article className="day-detail-card" key={event.occurrenceId} style={{borderLeftColor:category.color}}>
          <div className="day-detail-heading"><h3>{event.isPrivate&&<LockKeyhole size={14}/>}<span>{event.title}</span></h3><button className="text-button" onClick={()=>onOpen(event)} aria-label={`${event.title} 수정`}>수정</button></div>
          <p className="day-detail-time">{event.startDate===event.endDate?(event.allDay?'종일':`${event.startTime} ~ ${event.endTime}`):`${event.startDate}${event.allDay?'':` ${event.startTime}`} ~ ${event.endDate}${event.allDay?' · 종일':` ${event.endTime}`}`}</p>
          <div className="day-detail-meta"><span className="day-category-label" style={{background:category.color,color:colorText(category.color)}}>{category.label}</span>{event.repeat!=='none'&&<span><Repeat2 size={12}/>{REPEATS[event.repeat]}</span>}</div>
          {event.location&&<p className="day-detail-location"><MapPin size={14}/>{event.location}</p>}
          {names&&<p className="day-detail-members">함께하는 가족 · {names}</p>}
          {event.notes&&<p className="day-detail-notes">{event.notes}</p>}
        </article>;
      })}
    </div>
  </section>;
}
