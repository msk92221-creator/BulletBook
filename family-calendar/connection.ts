import { onAuthStateChanged, onIdTokenChanged } from 'firebase/auth';
import { collection, doc, onSnapshot, runTransaction, serverTimestamp } from 'firebase/firestore';
import { auth, db, findFamily, friendlyError } from './ui/firebase';
import { activeCategories, expandEvents, addDays } from './ui/calendar';
import config from './firebase-config.json';
import { linkedEventId, reconcileEntry, localFingerprint, remoteFingerprint } from './sync-model.mjs';

const embedded = window.parent !== window;
const origin = location.origin;
let statusListener: (s:string)=>void = ()=>{};
let currentStatus = '기존 패밀리팀룸 계정으로 로그인하면 BulletBook 일정도 가족에게 공유됩니다.';
export const onConnectionState = (listener:(s:string)=>void) => { statusListener=listener; listener(currentStatus); return ()=>{statusListener=()=>{}}; };
export const sendParent = (message:unknown) => { if(embedded)window.parent.postMessage({channel:'bulletbook-family-v1',...message as object},origin); };
const status = (text:string) => { currentStatus=text;statusListener(text); };
let generation=0, session:any=null, snapshot:any=null, bindings:Record<string,any>={}, scope='';
let remote=new Map<string,any>(), categories:any[]=[], shared:any[]=[], personal:any[]=[];
let ready=false, running=false, again=false, timer:any=null, publishTimer:any=null;
let unsubscribers:(()=>void)[]=[];

function publish(){
  clearTimeout(publishTimer);
  publishTimer=setTimeout(()=>{
    if(!session||!ready||!snapshot)return;
    const colors=activeCategories(categories);
    const from=snapshot.from,to=snapshot.to;
    const events=[...remote.values()];
    const occurrences=[...expandEvents(events.filter(e=>e.repeat!=='none'),from,to),
      ...events.filter(e=>e.repeat==='none')];
    const days:Record<string,any[]>={};
    const sourceIds=new Map(Object.entries(bindings).map(([sourceId,binding])=>[binding.id,sourceId]));
    for(const event of occurrences){
      const start=event.startDate,end=event.endDate;
      for(let day=start;day<=end;day=addDays(day,1)){
        (days[day]??=[]).push({id:event.id+':'+event.startDate,sourceId:sourceIds.get(event.id)||'',date:day,title:event.title,
          time:event.allDay?'':event.startTime,color:colors.find(c=>c.id===event.category)?.color||'#737b8c',
          isPrivate:event.isPrivate,status:'open'});
      }
    }
    sendParent({type:'projection',bookId:snapshot.bookId,scope,days,bindings,
      linkedSources:Object.keys(bindings),familyName:session.family.name});
    // The native worker gets its own protected session; credentials never enter a .buj file.
    const accountGeneration=generation;
    auth?.currentUser?.getIdToken().then(token=>{
      if(accountGeneration!==generation||!session||auth?.currentUser?.uid!==session.uid)return;
      sendParent({type:'native-session',session:{uid:session.uid,familyId:session.family.id,
        familyName:session.family.name,projectId:config.projectId,apiKey:config.apiKey,
        idToken:token,refreshToken:auth.currentUser.refreshToken},events,categories:colors});
    }).catch(()=>{});
  },500);
}

async function synchronize(){
  if(!session||!snapshot||!ready)return;
  if(running){again=true;return}
  running=true; const token=generation, book=snapshot, account=session;
  try{
    let done=0,conflicts=0;
    const entries=book.entries||[];
    for(const entry of entries){
      if(token!==generation||snapshot!==book) { again=true;break; }
      const old=bindings[entry.sourceId];
      const id=old?.id||await linkedEventId(book.bookId,entry.sourceId);
      const current=remote.get(id);
      if(old&&old.local===localFingerprint(entry)){
        if(!current){bindings[entry.sourceId]={...old,deleted:true,cloud:null};}
        else bindings[entry.sourceId]={...old,cloud:remoteFingerprint(current),deleted:false};
        done++;continue;
      }
      const result=await runTransaction(db!,async tx=>{
        const publicRef=doc(db!,'families',account.family.id,'events',id);
        const privateRef=doc(db!,'users',account.uid,'privateEvents',id);
        const publicDoc=await tx.get(publicRef),privateDoc=await tx.get(privateRef);
        const existing=privateDoc.exists()?privateDoc.data():publicDoc.exists()?publicDoc.data():null;
        const action=reconcileEntry(entry,old,existing,id,account.uid);
        if(action.write){
          // Extra SDK metadata is never written as part of an event.
          const {updatedAt,...data}=action.write;
          tx.set(data.isPrivate?privateRef:publicRef,{...data,updatedAt:serverTimestamp()});
          action.binding.cloud=remoteFingerprint(data);
        }
        return action;
      });
      if(token!==generation||snapshot!==book)break;
      if(result.write)remote.set(id,result.write);
      bindings[entry.sourceId]=result.binding;
      if(result.conflict)conflicts++;
      done++;
      if(done%20===0){status(`기존 일정 가족 공유 중 · ${done}/${entries.length}`);publish();}
    }
    // A restored/older notebook may omit newer schedules. Never treat that as a
    // family deletion; explicit deletions go through the shared calendar editor.
    if(token===generation&&snapshot===book){
      status(conflicts?'가족 변경을 우선 반영했습니다. 원래 기록은 불렛북에 보관됩니다.':`가족 달력 연결됨 · 기존 일정 ${entries.length}개 연동`);
      publish();
    }
  }catch(error){status(friendlyError(error));}
  finally{running=false;if(again){again=false;schedule()}}
}
function schedule(){clearTimeout(timer);timer=setTimeout(()=>void synchronize(),500);}

function disconnect(notify=true){
  generation++;ready=false;session=null;scope='';snapshot=null;bindings={};remote.clear();shared=[];personal=[];categories=[];
  clearTimeout(timer);clearTimeout(publishTimer);unsubscribers.forEach(off=>off());unsubscribers=[];
  if(notify)sendParent({type:'disconnected'});
}
export function startConnection(){
  if(!embedded||!auth)return;
  window.addEventListener('message',event=>{
    if(event.source!==window.parent||event.origin!==origin||event.data?.channel!=='bulletbook-family-v1')return;
    const message=event.data;
    if(message.type==='book'&&message.scope===scope&&session){
      if(snapshot?.bookId!==message.bookId)bindings={...(message.bindings||{})};
      snapshot=message; schedule();publish();
    }
    if(message.type==='open-date'){
      (window as any).__bulletbookDate=message.date;
      window.dispatchEvent(new CustomEvent('bulletbook-date',{detail:message.date}));
    }
    if(message.type==='backup-error')status('자동 백업을 저장하지 못했습니다. 저장 공간을 확인해 주세요.');
  });
  onAuthStateChanged(auth,async user=>{
    disconnect(!user);
    if(!user){status('패밀리팀룸 계정으로 로그인하면 기존 일정도 가족에게 공유됩니다.');return}
    sendParent({type:'account',uid:user.uid});
    const token=generation;
    try{
      const family=await findFamily(user.uid);
      if(token!==generation)return;
      if(!family){status('패밀리팀룸에서 가족 달력을 만들거나 초대로 참여해 주세요.');return}
      session={uid:user.uid,family};scope=user.uid+':'+family.id;
      const loaded=new Set();
      const received=(kind:string,s:any)=>{
        if(token!==generation)return;
        if(kind==='shared')shared=s.docs.map((d:any)=>({...d.data(),id:d.id}));
        if(kind==='personal')personal=s.docs.map((d:any)=>({...d.data(),id:d.id}));
        if(kind==='categories')categories=s.docs.map((d:any)=>({...d.data(),id:d.id}));
        if(!s.metadata.fromCache)loaded.add(kind);
        remote=new Map([...shared,...personal].map(e=>[e.id,e]));
        if(loaded.size===3&&!ready){ready=true;status('기존 일정 연결 준비 중…');sendParent({type:'ready',scope});}
        if(ready){schedule();publish();}
      };
      const error=(e:unknown)=>{if(token!==generation)return;ready=false;sendParent({type:'disconnected'});status(friendlyError(e));};
      unsubscribers=[
        onSnapshot(collection(db!,'families',family.id,'events'),{includeMetadataChanges:true},s=>received('shared',s),error),
        onSnapshot(collection(db!,'users',user.uid,'privateEvents'),{includeMetadataChanges:true},s=>received('personal',s),error),
        onSnapshot(collection(db!,'families',family.id,'categories'),{includeMetadataChanges:true},s=>received('categories',s),error),
      ];
    }catch(error){status(friendlyError(error));}
  });
  onIdTokenChanged(auth,()=>{if(ready)publish()});
  window.addEventListener('online',schedule);
  window.addEventListener('bulletbook-family-joined',()=>location.reload());
  sendParent({type:'loaded'});
}
