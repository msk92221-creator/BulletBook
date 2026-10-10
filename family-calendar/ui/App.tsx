import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type CSSProperties } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Search, Settings, Users, X, Check, MapPin, Clock3, Repeat2, LockKeyhole, LogOut, Copy, UserPlus, Menu, List, ArrowLeft, Heart, LoaderCircle, ChevronDown } from 'lucide-react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { Capacitor } from '@capacitor/core';
import { dateKey, parseDate, addDays, monthGrid, expandEvents, weekLanes, newEvent, demoData, validateEvent, activeCategories, categoryAppearance, UNCATEGORIZED, REPEATS, type CalendarEvent, type Occurrence, type Member, type EventCategory } from './calendar';
import { auth, configured, login, logout, emailLogin, resetPassword, createFamily, joinFamily, findFamily, listenFamily, createInvite, saveCloudEvent, deleteCloudEvent, saveCloudCategory, friendlyError, type Family } from './firebase';
import { DatePicker } from './DatePicker';
import { CategoryManager } from './CategoryManager';

const WEEKDAYS=['일','월','화','수','목','금','토'];
const DEMO_KEY='familyteamroom:demo:v1';
const longDate=(day:string)=>new Intl.DateTimeFormat('ko-KR',{month:'long',day:'numeric',weekday:'long'}).format(parseDate(day));
function readDemo(){try{const raw=localStorage.getItem(DEMO_KEY);if(raw){const data=JSON.parse(raw);if(Array.isArray(data.events)&&Array.isArray(data.members))return {...data,categories:Array.isArray(data.categories)?data.categories:[]} as ReturnType<typeof demoData>;}}catch{/* A corrupt preview never affects cloud data. */}return demoData();}
function Spinner(){return <LoaderCircle size={18} className="spin"/>;}
function Avatar({member,small=false}:{member:Member;small?:boolean}){return <span className={`avatar ${small?'small':''}`} style={{'--member-color':member.color} as CSSProperties}>{member.name.slice(0,1)}</span>;}
function Modal({title,children,onClose,wide=false}:{title:string;children:ReactNode;onClose:()=>void;wide?:boolean}){
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{ref.current?.showModal();return()=>ref.current?.close();},[]);
  return <dialog ref={ref} className={`modal ${wide?'wide':''}`} aria-label={title} onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===ref.current)onClose();}}><div className="modal-inner"><div className="modal-header"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="닫기"><X size={22}/></button></div>{children}</div></dialog>;
}
function AuthScreen({user,onDemo,onReady}:{user:User|null;onDemo:()=>void;onReady:(f:Family)=>void}){
  const [mode,setMode]=useState<'login'|'signup'|'reset'>('login');
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[name,setName]=useState('');
  const [familyName,setFamilyName]=useState('우리집 팀룸'),[invite,setInvite]=useState(new URLSearchParams(location.search).get('invite')??'');
  const [join,setJoin]=useState(!!invite),[busy,setBusy]=useState(false),[error,setError]=useState(''),[info,setInfo]=useState('');
  const run=async(fn:()=>Promise<unknown>)=>{setBusy(true);setError('');setInfo('');try{await fn();}catch(e){setError(friendlyError(e));}finally{setBusy(false);}};
  const submit=(e:FormEvent)=>{e.preventDefault();void run(async()=>{
    if(user){
      if(join)await joinFamily(user.uid,user.displayName||name||user.email?.split('@')[0]||'가족',invite);
      else await createFamily(user.uid,user.displayName||name||user.email?.split('@')[0]||'나',familyName);
      const family=await findFamily(user.uid);if(family){onReady(family);window.dispatchEvent(new Event('bulletbook-family-joined'));}
      history.replaceState(null,'',location.pathname);
    }else if(mode==='reset'){await resetPassword(email);setInfo('비밀번호 재설정 메일을 보냈어요. 받은 편지함을 확인해 주세요.');}
    else await emailLogin(email,password,mode==='signup'?name:undefined);
  });};
  return <main className="auth-page"><div className="auth-card"><div className="brand-mark large"><CalendarDays size={30}/></div><p className="eyebrow">FAMILY TEAMROOM</p><h1>{user?'우리 가족의 캘린더':'우리집 팀룸'}</h1><p className="auth-description">{user?'새로운 가족 달력을 만들거나 초대받은 달력에 참여하세요.':'가족의 일정을 한곳에. 오늘도 함께하는 하루.'}</p>
    {user?<div className="segmented full"><button className={!join?'active':''} onClick={()=>setJoin(false)}>새로 만들기</button><button className={join?'active':''} onClick={()=>setJoin(true)}>초대로 참여</button></div>:<div className="segmented full"><button className={mode==='login'?'active':''} onClick={()=>{setMode('login');setError('');}}>로그인</button><button className={mode==='signup'?'active':''} onClick={()=>{setMode('signup');setError('');}}>회원가입</button></div>}
    <form onSubmit={submit} className="auth-form">
      {user?join?<label>초대 코드 또는 링크<input required value={invite} onChange={e=>setInvite(e.target.value)} placeholder="가족에게 받은 초대 코드를 붙여넣으세요"/></label>:<label>가족 캘린더 이름<input required maxLength={40} value={familyName} onChange={e=>setFamilyName(e.target.value)}/></label>:<>
        {mode==='signup'&&<label>이름<input required autoComplete="name" maxLength={40} value={name} onChange={e=>setName(e.target.value)} placeholder="가족에게 보일 이름"/></label>}
        <label>이메일<input required type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="hello@example.com"/></label>
        {mode!=='reset'&&<label>비밀번호<input required minLength={6} type="password" autoComplete={mode==='signup'?'new-password':'current-password'} value={password} onChange={e=>setPassword(e.target.value)} placeholder="6자 이상 입력해 주세요"/></label>}
      </>}
      {error&&<p className="form-error" role="alert">{error}</p>}{info&&<p className="form-info" role="status">{info}</p>}
      <button className="button primary full" disabled={busy||!configured}>{busy?<Spinner/>:user?join?'가족 캘린더 참여하기':'가족 캘린더 만들기':mode==='signup'?'가입하고 시작하기':mode==='reset'?'재설정 메일 보내기':'로그인'}</button>
    </form>
    {!user&&<>{mode==='login'&&<button className="text-button reset-link" onClick={()=>setMode('reset')}>비밀번호를 잊으셨나요?</button>}{!Capacitor.isNativePlatform()&&!/Android/i.test(navigator.userAgent)&&<><div className="divider"><span>또는</span></div><button className="button full google-button" disabled={busy||!configured} onClick={()=>void run(login)}><span className="google-g">G</span> Google로 계속하기</button></>}<button className="text-button demo-link" onClick={onDemo}>예시 달력 먼저 둘러보기</button></>}
    {user&&<button className="text-button demo-link" onClick={()=>void logout()}>다른 계정으로 로그인</button>}
    {!configured&&<p className="form-info">Firebase 연결을 준비 중이에요. 예시 달력은 바로 사용할 수 있어요.</p>}
  </div><p className="auth-footer"><Heart size={13}/> 우리 가족만의 작은 공간</p></main>;
}

function EventEditor({event,existing,members,categories,uid,onSave,onDelete,onClose,onManageCategories}:{event:CalendarEvent;existing:boolean;members:Member[];categories:EventCategory[];uid:string;onSave:(e:CalendarEvent)=>Promise<void>;onDelete:()=>Promise<void>;onClose:()=>void;onManageCategories:()=>void}){
  const [draft,setDraft]=useState(event),[busy,setBusy]=useState(false),[error,setError]=useState(''),[confirmDelete,setConfirmDelete]=useState(false);
  const [dateField,setDateField]=useState<'startDate'|'endDate'|'repeatUntil'|null>(null);
  const category=categories.some(c=>c.id===draft.category)?draft.category:UNCATEGORIZED.id;
  const set=<K extends keyof CalendarEvent>(key:K,value:CalendarEvent[K])=>setDraft(d=>({...d,[key]:value}));
  const submit=async(e:FormEvent)=>{e.preventDefault();const problem=validateEvent(draft);if(problem){setError(problem);return;}setBusy(true);setError('');try{await onSave({...draft,category});}catch(e){setError(friendlyError(e));setBusy(false);}};
  return <Modal title={existing?'일정 수정':'새 일정'} onClose={()=>{if(dateField)setDateField(null);else if(!busy)onClose();}} wide><form onSubmit={submit} className="event-form">
    <input className="title-input" aria-label="일정 제목" placeholder="어떤 일정인가요?" required maxLength={100} autoFocus value={draft.title} onChange={e=>set('title',e.target.value)}/>
    <div className="input-with-icon"><MapPin size={19}/><input aria-label="장소" placeholder="장소 추가" maxLength={200} value={draft.location} onChange={e=>set('location',e.target.value)}/></div>
    <div className="form-section"><div className="section-label"><Clock3 size={18}/><span>날짜와 시간</span><label className="switch-label">종일<input type="checkbox" checked={draft.allDay} onChange={e=>set('allDay',e.target.checked)}/><span className="switch"/></label></div>
      <DatePicker label="시작일" shortLabel="시작" value={draft.startDate} open={dateField==='startDate'} onOpenChange={open=>setDateField(open?'startDate':null)} onChange={value=>setDraft(d=>({...d,startDate:value,endDate:d.endDate<value?value:d.endDate,repeatUntil:d.repeatUntil&&d.repeatUntil<value?value:d.repeatUntil}))}>{!draft.allDay&&<input aria-label="시작 시간" type="time" required value={draft.startTime} onInput={e=>set('startTime',e.currentTarget.value)} onChange={e=>set('startTime',e.target.value)}/>}</DatePicker>
      <DatePicker label="종료일" shortLabel="종료" min={draft.startDate} value={draft.endDate} open={dateField==='endDate'} onOpenChange={open=>setDateField(open?'endDate':null)} onChange={value=>set('endDate',value)}>{!draft.allDay&&<input aria-label="종료 시간" type="time" required value={draft.endTime} onInput={e=>set('endTime',e.currentTarget.value)} onChange={e=>set('endTime',e.target.value)}/>}</DatePicker>
    </div>
    <div className="form-section"><label className="select-row"><span><Repeat2 size={18}/>반복</span><select value={draft.repeat} onChange={e=>set('repeat',e.target.value as CalendarEvent['repeat'])}>{Object.entries(REPEATS).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
      {draft.repeat!=='none'&&<DatePicker label="반복 종료일" value={draft.repeatUntil} min={draft.startDate} optional open={dateField==='repeatUntil'} onOpenChange={open=>setDateField(open?'repeatUntil':null)} onChange={value=>set('repeatUntil',value)}/>}
      {draft.repeat!=='none'&&<p className="field-hint">종료일을 비우면 계속 반복해요. 31일·2월 29일처럼 없는 날짜는 건너뛰어요.{existing?' 수정·삭제는 반복 일정 전체에 적용돼요.':''}</p>}
      <label className="select-row"><span><CalendarDays size={18}/>분류</span><select value={category} onChange={e=>set('category',e.target.value)}>{categories.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}<option value={UNCATEGORIZED.id}>미분류</option></select></label>
      <button type="button" className="text-button manage-categories-link" onClick={onManageCategories}><Settings size={14}/>분류 관리 · 추가·수정·삭제</button>
    </div>
    <div className="form-section"><div className="section-label"><Users size={18}/><span>함께하는 가족</span></div><div className="participant-options">{members.map(m=><button type="button" key={m.id} className={`participant ${draft.participants.includes(m.id)?'selected':''}`} aria-pressed={draft.participants.includes(m.id)} onClick={()=>set('participants',draft.participants.includes(m.id)?draft.participants.filter(x=>x!==m.id):[...draft.participants,m.id])}><Avatar member={m} small/>{m.name}{draft.participants.includes(m.id)&&<Check size={14}/>}</button>)}</div></div>
    <label className="privacy-row"><LockKeyhole size={18}/><span>나만 보는 일정<small>가족 달력에는 표시되지 않아요</small></span><input type="checkbox" checked={draft.isPrivate} disabled={existing&&event.createdBy!==uid} onChange={e=>set('isPrivate',e.target.checked)}/></label>
    <label className="notes-label">메모<textarea rows={3} maxLength={3000} placeholder="가족에게 남길 이야기나 준비물을 적어보세요." value={draft.notes} onChange={e=>set('notes',e.target.value)}/></label>
    {error&&<p className="form-error" role="alert">{error}</p>}
    {confirmDelete&&<div className="delete-confirm"><p>{event.repeat==='none'?'이 일정을 삭제할까요?':'반복 일정 전체를 삭제할까요?'}</p><button type="button" className="text-button" onClick={()=>setConfirmDelete(false)}>취소</button><button type="button" className="button danger" disabled={busy} onClick={async()=>{setBusy(true);try{await onDelete();}catch(e){setError(friendlyError(e));setBusy(false);}}}>삭제하기</button></div>}
    <div className="form-actions">{existing&&<button type="button" className="text-button danger-text" disabled={busy} onClick={()=>setConfirmDelete(true)}>일정 삭제</button>}<div className="spacer"/><button type="button" className="button" disabled={busy} onClick={onClose}>취소</button><button className="button primary" disabled={busy}>{busy?<Spinner/>:<Check size={17}/>}저장</button></div>
  </form></Modal>;
}

export default function App(){
  const [demo,setDemo]=useState(()=>new URLSearchParams(location.search).get('demo')==='1'||sessionStorage.getItem('familyteamroom:demo')==='1');
  const [user,setUser]=useState<User|null>(null),[family,setFamily]=useState<Family|null>(null),[boot,setBoot]=useState(!!auth),[accountError,setAccountError]=useState('');
  const [events,setEvents]=useState<CalendarEvent[]>([]),[members,setMembers]=useState<Member[]>([]),[syncError,setSyncError]=useState('');
  const [categoryOverrides,setCategoryOverrides]=useState<EventCategory[]>([]),[categoriesOpen,setCategoriesOpen]=useState(false);
  const categories=useMemo(()=>activeCategories(categoryOverrides),[categoryOverrides]);
  const appearance=(id:string)=>categoryAppearance(categories,id);
  const today=dateKey(new Date()),uid=demo?'me':user?.uid??'';
  const [month,setMonth]=useState(()=>parseDate(today)),[selected,setSelected]=useState(today),[view,setView]=useState<'month'|'list'>('month');
  useEffect(()=>{
    const open=(value:string)=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return;setSelected(value);setMonth(parseDate(value));setView('month');};
    const receive=(e:Event)=>open((e as CustomEvent).detail);
    open((window as any).__bulletbookDate);
    window.addEventListener('bulletbook-date',receive);
    return()=>window.removeEventListener('bulletbook-date',receive);
  },[]);
  const [filter,setFilter]=useState('all'),[query,setQuery]=useState(''),[searchOpen,setSearchOpen]=useState(false),[sidebar,setSidebar]=useState(false);
  const [editor,setEditor]=useState<CalendarEvent|null>(null),[settings,setSettings]=useState(false),[inviteOpen,setInviteOpen]=useState(false),[inviteCode,setInviteCode]=useState(''),[inviteBusy,setInviteBusy]=useState(false),[inviteError,setInviteError]=useState(''),[toast,setToast]=useState('');
  useEffect(()=>{if(!auth)return;let active=true;const off=onAuthStateChanged(auth,u=>{setUser(u);setFamily(null);setEvents([]);setMembers([]);setCategoryOverrides([]);setAccountError('');if(u){setBoot(true);findFamily(u.uid).then(f=>{if(active&&auth?.currentUser?.uid===u.uid)setFamily(f);}).catch(e=>{if(active)setAccountError(friendlyError(e));}).finally(()=>{if(active)setBoot(false);});}else setBoot(false);});return()=>{active=false;off();};},[]);
  useEffect(()=>{setSyncError('');if(demo){const d=readDemo();setEvents(d.events);setMembers(d.members);setCategoryOverrides(d.categories);return;}if(!family||!user)return;return listenFamily(family.id,user.uid,setEvents,setMembers,setCategoryOverrides,e=>setSyncError(friendlyError(e)));},[demo,family?.id,user?.uid,boot]);
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(''),3500);return()=>clearTimeout(timer);},[toast]);
  const days=useMemo(()=>monthGrid(month),[month]);
  const visibleEvents=useMemo(()=>events.filter(e=>(filter==='all'||e.participants.includes(filter))&&(!query||`${e.title} ${e.location} ${e.notes}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))),[events,filter,query]);
  const occurrences=useMemo(()=>expandEvents(visibleEvents,days[0],days[days.length-1]),[visibleEvents,days]);
  const selectedEvents=occurrences.filter(e=>e.startDate<=selected&&e.endDate>=selected);
  const upcoming=useMemo(()=>expandEvents(visibleEvents,today,addDays(today,30)).filter(e=>e.endDate>=today).slice(0,4),[visibleEvents,today]);
  const monthEvents=occurrences.filter(e=>e.startDate<=dateKey(new Date(month.getFullYear(),month.getMonth()+1,0,12))&&e.endDate>=dateKey(new Date(month.getFullYear(),month.getMonth(),1,12)));
  const currentMember=members.find(m=>m.id===uid)??{id:uid,name:user?.displayName||'나',color:'#4555ce'};
  const enterDemo=()=>{sessionStorage.setItem('familyteamroom:demo','1');setDemo(true);};
  const leaveDemo=()=>{sessionStorage.removeItem('familyteamroom:demo');const url=new URL(location.href);url.searchParams.delete('demo');history.replaceState(null,'',url.pathname+url.search);setDemo(false);setEvents([]);setMembers([]);setCategoryOverrides([]);setCategoriesOpen(false);setSettings(false);setInviteOpen(false);};
  const moveMonth=(delta:number)=>{const next=new Date(month.getFullYear(),month.getMonth()+delta,1,12);setMonth(next);setSelected(dateKey(next));};
  const save=async(event:CalendarEvent)=>{
    if(!demo&&!navigator.onLine)throw new Error('인터넷 연결 후 다시 저장해 주세요.');
    if(event.repeat==='none')event={...event,repeatUntil:''};
    const previous=events.find(e=>e.id===event.id);
    if(demo){const next=previous?events.map(e=>e.id===event.id?event:e):[...events,event];localStorage.setItem(DEMO_KEY,JSON.stringify({events:next,members,categories:categoryOverrides}));setEvents(next);}
    else if(family)await saveCloudEvent(event,family.id,uid,previous);
    else throw new Error('가족 캘린더 연결을 확인해 주세요.');
    setEditor(null);setToast(previous?'일정을 수정했어요.':'새 일정을 저장했어요.');
  };
  const remove=async()=>{if(!editor)return;if(demo){const next=events.filter(e=>e.id!==editor.id);localStorage.setItem(DEMO_KEY,JSON.stringify({events:next,members,categories:categoryOverrides}));setEvents(next);}else if(family)await deleteCloudEvent(editor,family.id,uid);setEditor(null);setToast('일정을 삭제했어요.');};
  const saveCategory=async(category:EventCategory)=>{
    if(!demo&&!navigator.onLine)throw new Error('인터넷 연결 후 다시 저장해 주세요.');
    if(demo){const next=[...categoryOverrides.filter(c=>c.id!==category.id),category];localStorage.setItem(DEMO_KEY,JSON.stringify({events,members,categories:next}));setCategoryOverrides(next);}
    else if(family)await saveCloudCategory(category,family.id);
    else throw new Error('가족 캘린더 연결을 확인해 주세요.');
  };
  const openEvent=(e:Occurrence)=>{const source=events.find(item=>item.id===e.originalId);if(source)setEditor(source);};
  const eventCard=(e:Occurrence)=><button key={e.occurrenceId} className="agenda-event" onClick={()=>openEvent(e)}><span className="event-color" style={{background:appearance(e.category).color}}/><div><span className="event-time">{e.allDay?'종일':`${e.startTime} – ${e.endTime}`}{e.repeat!=='none'&&<Repeat2 size={12}/>}</span><strong>{e.title}{e.isPrivate&&<LockKeyhole size={12}/>}</strong>{e.location&&<small><MapPin size={12}/>{e.location}</small>}<span className="event-members">{e.participants.map(id=>members.find(m=>m.id===id)?.name).filter(Boolean).join(' · ')}</span></div><ChevronRight size={16}/></button>;

  if(boot&&!demo)return <main className="loading-page"><div className="brand-mark"><CalendarDays/></div><Spinner/><p>가족 달력을 불러오고 있어요.</p></main>;
  if(!demo&&(!user||!family))return <>{accountError&&<div className="global-error" role="alert">{accountError}<button onClick={()=>location.reload()}>다시 연결</button></div>}<AuthScreen user={user} onDemo={enterDemo} onReady={setFamily}/></>;
  return <div className="app-shell">
    {sidebar&&<button className="sidebar-backdrop" aria-label="메뉴 닫기" onClick={()=>setSidebar(false)}/>}
    <aside className={`sidebar ${sidebar?'open':''}`}>
      <div className="sidebar-brand"><div className="brand-mark"><CalendarDays size={23}/></div><div><strong>{family&&!demo?family.name:'우리집 팀룸'}</strong><small>FAMILY TEAMROOM</small></div><button className="icon-button mobile-only" onClick={()=>setSidebar(false)} aria-label="메뉴 닫기"><X size={20}/></button></div>
      <button className="button primary create-button" onClick={()=>{setEditor(newEvent(selected,uid));setSidebar(false);}}><Plus size={20}/>일정 만들기</button>
      <nav className="main-nav" aria-label="달력 보기"><button className={view==='month'?'active':''} onClick={()=>{setView('month');setSidebar(false);}}><CalendarDays size={19}/>우리 가족 달력</button><button className={view==='list'?'active':''} onClick={()=>{setView('list');setSidebar(false);}}><List size={19}/>일정 모아보기</button></nav>
      <div className="sidebar-section"><div className="sidebar-section-title"><span>함께하는 가족</span><button className="icon-button" aria-label="가족 초대" onClick={()=>setInviteOpen(true)}><Plus size={16}/></button></div><button className={`member-filter ${filter==='all'?'active':''}`} onClick={()=>setFilter('all')}><span className="all-avatar"><Users size={17}/></span>가족 전체<span className="check-box">{filter==='all'&&<Check size={12}/>}</span></button>{members.map(m=><button key={m.id} className={`member-filter ${filter===m.id?'active':''}`} onClick={()=>setFilter(filter===m.id?'all':m.id)}><Avatar member={m} small/>{m.name}{m.id===uid&&<small>나</small>}<span className="check-box">{filter===m.id&&<Check size={12}/>}</span></button>)}</div>
      <div className="sidebar-section category-legend"><div className="sidebar-section-title"><span>일정 분류</span><button className="icon-button" aria-label="분류 관리" onClick={()=>{setCategoriesOpen(true);setSidebar(false);}}><Settings size={16}/></button></div>{categories.map(c=><div key={c.id}><i style={{background:c.color}}/>{c.label}</div>)}</div>
      <div className="sidebar-bottom"><button className="invite-card" onClick={()=>setInviteOpen(true)}><UserPlus size={21}/><span><strong>가족과 함께 쓰세요</strong><small>우리 달력에 가족 초대하기</small></span><ChevronRight size={16}/></button><button className="profile-button" onClick={()=>setSettings(true)}><Avatar member={currentMember} small/><span>{currentMember.name}<small>{demo?'예시 계정':'가족 캘린더'}</small></span><Settings size={18}/></button></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div className="topbar-title"><button className="icon-button mobile-only" aria-label="메뉴 열기" onClick={()=>setSidebar(true)}><Menu size={22}/></button><h1>우리 가족 달력</h1><span className="header-label">함께하는 일상</span></div><div className="topbar-actions"><button className={`icon-button ${searchOpen?'selected':''}`} aria-label="일정 검색" onClick={()=>setSearchOpen(!searchOpen)}><Search size={20}/></button><div className="avatar-stack">{members.slice(0,4).map(m=><Avatar key={m.id} member={m} small/>)}</div><button className="button invite-top" onClick={()=>setInviteOpen(true)}><UserPlus size={16}/>가족 초대</button><button className="icon-button mobile-only" aria-label="설정" onClick={()=>setSettings(true)}><Settings size={20}/></button></div></header>
      {demo&&<div className="demo-banner"><span>예시 달력 <span className="banner-detail">· 변경 내용은 이 기기에만 저장돼요</span></span><button onClick={leaveDemo}>로그인하고 가족과 공유<ChevronRight size={14}/></button></div>}
      {syncError&&<div className="global-error" role="alert">{syncError}<button onClick={()=>location.reload()}>다시 연결</button></div>}
      <main className="calendar-page">
        <div className="calendar-toolbar"><div className="month-controls"><h2>{month.getFullYear()}<span>년</span> {month.getMonth()+1}<span>월</span></h2><div className="month-arrows"><button className="icon-button" aria-label="이전 달" onClick={()=>moveMonth(-1)}><ChevronLeft size={19}/></button><button className="icon-button" aria-label="다음 달" onClick={()=>moveMonth(1)}><ChevronRight size={19}/></button></div><button className="button today-button" onClick={()=>{setMonth(parseDate(today));setSelected(today);}}>오늘</button></div><div className="toolbar-right"><div className="segmented"><button className={view==='month'?'active':''} onClick={()=>setView('month')}>월간</button><button className={view==='list'?'active':''} onClick={()=>setView('list')}>목록</button></div><button className="button primary desktop-add" onClick={()=>setEditor(newEvent(selected,uid))}><Plus size={17}/>새 일정</button></div></div>
        {searchOpen&&<div className="search-field"><Search size={18}/><input autoFocus aria-label="검색어" placeholder="이번 달 제목, 장소, 메모 검색" value={query} onChange={e=>setQuery(e.target.value)}/><button className="icon-button" aria-label="검색 닫기" onClick={()=>{setQuery('');setSearchOpen(false);}}><X size={18}/></button></div>}
        <div className="mobile-filters"><button className={filter==='all'?'active':''} onClick={()=>setFilter('all')}>가족 전체</button>{members.map(m=><button key={m.id} className={filter===m.id?'active':''} onClick={()=>setFilter(filter===m.id?'all':m.id)}><i style={{background:m.color}}/>{m.name}</button>)}</div>
        <div className="calendar-layout"><section className="calendar-surface" aria-label="월간 일정">
          {view==='month'?<><div className="weekdays">{WEEKDAYS.map((d,i)=><div key={d} className={i===0?'sunday':i===6?'saturday':''}>{d}</div>)}</div><div className="month-grid">{Array.from({length:days.length/7},(_,w)=>{
            const week=days.slice(w*7,w*7+7),lanes=weekLanes(occurrences,week),maxLanes=4;
            return <div className="calendar-week" key={week[0]}><div className="day-cells">{week.map((day,i)=>{
              const overflow=lanes.filter(l=>l.lane>=maxLanes&&l.start<=i&&l.end>=i).length;
              return <button key={day} aria-label={`${longDate(day)} 일정 보기`} aria-pressed={selected===day} className={`day-cell ${parseDate(day).getMonth()!==month.getMonth()?'outside':''} ${day===selected?'selected-day':''} ${i===0?'sunday':i===6?'saturday':''}`} onClick={()=>setSelected(day)} onDoubleClick={()=>setEditor(newEvent(day,uid))}><span className={`day-number ${day===today?'today':''}`}>{parseDate(day).getDate()}</span>{overflow>0&&<span className="overflow-count">+{overflow}개 더 보기</span>}</button>;
            })}</div><div className="week-events">{lanes.filter(l=>l.lane<maxLanes).map(({event,start,end,lane})=>{
              const c=appearance(event.category),isSpan=event.startDate!==event.endDate;
              return <button key={event.occurrenceId} className={`calendar-event ${isSpan?'spanning':''} ${event.allDay?'all-day':''}`} style={{gridColumn:`${start+1} / ${end+2}`,gridRow:lane+1,'--event-color':c.color,'--event-bg':c.bg} as CSSProperties} onClick={()=>openEvent(event)} title={`${event.title}${event.allDay?'':` · ${event.startTime}`}`}><span className="calendar-event-content">{!event.allDay&&!isSpan&&<i/>}{event.isPrivate&&<LockKeyhole size={10}/>}<span>{event.title}</span>{!event.allDay&&!isSpan&&<small>{event.startTime}</small>}</span></button>;
            })}</div></div>;
          })}</div></>:<div className="list-view">{monthEvents.length===0?<div className="empty-state"><CalendarDays size={32}/><p>{query?'검색 결과가 없어요.':'이번 달 일정이 없어요.'}</p><button className="text-button" onClick={()=>setEditor(newEvent(selected,uid))}>첫 일정 만들기</button></div>:monthEvents.map(e=><div className="list-item" key={e.occurrenceId}><span className="list-date"><strong>{parseDate(e.startDate).getDate()}</strong><small>{parseDate(e.startDate).getMonth()+1}월 {WEEKDAYS[parseDate(e.startDate).getDay()]}요일</small></span>{eventCard(e)}</div>)}</div>}
          <div className="calendar-footer"><span><i/>오늘</span><span>날짜를 선택하면 일정을 볼 수 있어요</span><span className="month-count">이번 달 {monthEvents.length}개 일정</span></div>
        </section>
        <aside className="day-panel"><section className="selected-agenda"><div className="day-heading"><div><p>{selected===today?'TODAY':'SCHEDULE'}</p><h3>{longDate(selected)}</h3></div><button className="icon-button add-day" aria-label="선택한 날짜에 일정 추가" onClick={()=>setEditor(newEvent(selected,uid))}><Plus size={20}/></button></div>{selectedEvents.length?selectedEvents.map(eventCard):<div className="empty-agenda"><CalendarDays size={30}/><p>아직 일정이 없어요</p><button className="text-button" onClick={()=>setEditor(newEvent(selected,uid))}>새 일정 추가하기</button></div>}</section><section className="upcoming"><div className="upcoming-heading"><h3>다가오는 일정</h3><span>30일 이내</span></div>{upcoming.length?upcoming.map(e=><button className="upcoming-event" key={e.occurrenceId} onClick={()=>{setMonth(parseDate(e.startDate));setSelected(e.startDate);openEvent(e);}}><div className="upcoming-date"><small>{parseDate(e.startDate).getMonth()+1}월</small><strong>{parseDate(e.startDate).getDate()}</strong></div><div><strong>{e.title}</strong><small>{e.allDay?'종일':e.startTime} · {appearance(e.category).label}</small></div></button>):<p className="muted">예정된 일정이 없어요.</p>}</section><div className="family-note"><Heart size={16}/><p>작은 약속도, 특별한 날도<br/>우리 가족 달력에 함께 담아요.</p></div></aside></div>
      </main><button className="mobile-fab" aria-label="새 일정 만들기" onClick={()=>setEditor(newEvent(selected,uid))}><Plus size={27}/></button>
    </div>
    {editor&&<EventEditor key={editor.id} event={editor} existing={events.some(e=>e.id===editor.id)} members={members} categories={categories} uid={uid} onManageCategories={()=>setCategoriesOpen(true)} onSave={save} onDelete={remove} onClose={()=>setEditor(null)}/>}
    {inviteOpen&&<Modal title="가족 초대" onClose={()=>setInviteOpen(false)}><div className="settings-content"><div className="invite-illustration"><Users size={30}/></div>{demo?<><h3>우리 가족만의 달력을 시작해요</h3><p>로그인하고 가족 달력을 만들면 웹과 앱에서 같은 일정을 함께 볼 수 있어요.</p><button className="button primary full" onClick={leaveDemo}>로그인하고 시작하기</button></>:family?.ownerId!==uid?<p>가족 달력을 만든 분에게 새 초대 코드를 요청해 주세요.</p>:<><p>가족 한 명에게 초대 코드를 전달해 주세요. 코드는 <strong>24시간 동안, 한 번만</strong> 사용할 수 있어요.</p>{inviteCode?<><label>초대 코드<div className="copy-field"><input aria-label="초대 코드" readOnly value={inviteCode}/><button className="icon-button" aria-label="초대 코드 복사" onClick={async()=>{try{await navigator.clipboard.writeText(inviteCode);setToast('초대 코드를 복사했어요.');}catch{setInviteError('코드를 길게 눌러 직접 복사해 주세요.');}}}><Copy size={18}/></button></div></label><p className="field-hint">가족이 로그인한 뒤 ‘초대로 참여’에 입력하면 돼요.</p></>:null}{inviteError&&<p className="form-error" role="alert">{inviteError}</p>}<button className="button primary full" disabled={inviteBusy} onClick={async()=>{if(!family)return;setInviteBusy(true);setInviteError('');try{setInviteCode(await createInvite(family,uid));}catch(e){setInviteError(friendlyError(e));}finally{setInviteBusy(false);}}}>{inviteBusy?<Spinner/>:<UserPlus size={17}/>} {inviteCode?'다른 가족을 위한 코드 만들기':'초대 코드 만들기'}</button></>}</div></Modal>}
    {settings&&<Modal title="설정" onClose={()=>setSettings(false)}><div className="settings-content"><div className="settings-profile"><Avatar member={currentMember}/><div><h3>{currentMember.name}</h3><p>{demo?'예시 달력을 이용 중이에요':user?.email}</p></div></div><div className="settings-row"><span>캘린더</span><strong>{demo?'우리집 팀룸':family?.name}</strong></div><button className="settings-category-button" onClick={()=>setCategoriesOpen(true)}><span><CalendarDays size={18}/>분류 관리</span><small>추가·이름·색상·삭제</small><ChevronRight size={17}/></button><div className="settings-row"><span>저장 위치</span><strong>{demo?'이 기기 · 체험용':'가족 공유 · Firebase'}</strong></div><p className="field-hint">{demo?'예시 일정과 변경 내용은 가족에게 공유되지 않아요. 실제 일정은 로그인 후 등록해 주세요.':'공유 일정은 모든 가족이 수정할 수 있어요. 나만 보는 일정은 본인만 읽고 수정할 수 있어요.'}</p><button className="button full" onClick={async()=>{if(demo){leaveDemo();return;}try{await logout();setSettings(false);setEvents([]);setMembers([]);}catch(e){setToast(friendlyError(e));}}}><LogOut size={17}/>{demo?'체험 끝내고 로그인':'로그아웃'}</button></div></Modal>}
    {categoriesOpen&&<Modal title="분류 관리" onClose={()=>setCategoriesOpen(false)}><CategoryManager categories={categories} onSave={saveCategory}/></Modal>}
    {toast&&<div className="toast" role="status"><Check size={17}/>{toast}</div>}
  </div>;
}
