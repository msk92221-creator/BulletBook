import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile, sendPasswordResetEmail } from 'firebase/auth';
import { getFirestore, doc, collection, onSnapshot, setDoc, deleteDoc, runTransaction, writeBatch, serverTimestamp, Timestamp, getDoc } from 'firebase/firestore';
import type { CalendarEvent, Member, EventCategory } from './calendar';
import { COLORS } from './calendar';
import config from '../firebase-config.json';
export const configured=!!(config.apiKey&&config.projectId&&config.appId);
const app=configured?initializeApp(config):null;
export const auth=app?getAuth(app):null;
export const db=app?getFirestore(app):null;
export const login=()=>{if(!auth)throw new Error('Firebase 연결 정보가 필요해요.');return signInWithPopup(auth,new GoogleAuthProvider());};
export const logout=()=>auth?signOut(auth):Promise.resolve();
export async function emailLogin(email:string,password:string,name?:string){
  if(!auth)throw new Error('Firebase 연결 정보가 필요해요.');
  if(name!==undefined){const result=await createUserWithEmailAndPassword(auth,email,password);await updateProfile(result.user,{displayName:name.trim()||'가족'});return result;}
  return signInWithEmailAndPassword(auth,email,password);
}
export async function resetPassword(email:string){if(!auth)throw new Error('Firebase 연결 정보가 필요해요.');await sendPasswordResetEmail(auth,email);}
export interface Family {id:string;name:string;ownerId:string}
export function friendlyError(error:unknown):string {
  const code=(error as {code?:string})?.code;
  const map:Record<string,string>={
    'auth/invalid-credential':'이메일과 비밀번호를 확인해 주세요.',
    'auth/email-already-in-use':'이미 가입된 이메일이에요. 로그인해 주세요.',
    'auth/weak-password':'비밀번호는 6자 이상으로 입력해 주세요.',
    'auth/invalid-email':'이메일 주소를 확인해 주세요.',
    'auth/too-many-requests':'요청이 많아요. 잠시 후 다시 시도해 주세요.',
    'auth/popup-closed-by-user':'로그인 창이 닫혔어요. 다시 시도해 주세요.',
    'auth/cancelled-popup-request':'다른 로그인 창에서 진행해 주세요.',
    'auth/popup-blocked':'브라우저에서 팝업을 허용한 뒤 다시 로그인해 주세요.',
    'auth/operation-not-allowed':'Firebase에서 선택한 로그인 방식을 활성화해야 해요.',
    'auth/unauthorized-domain':'이 사이트 주소를 Firebase의 인증 허용 도메인에 추가해야 해요.',
    'auth/network-request-failed':'인터넷 연결을 확인해 주세요.',
    'permission-denied':'접근 권한이 없어요. 가족 가입 상태와 Firebase 보안 규칙을 확인해 주세요.',
    'unavailable':'서버에 연결할 수 없어요. 인터넷 연결 후 다시 시도해 주세요.',
  };
  return map[code??''] || (error instanceof Error?error.message:'처리하지 못했어요. 다시 시도해 주세요.');
}
export async function createFamily(uid:string,userName:string,name:string):Promise<string>{
  const ref=doc(collection(db!,'families')),batch=writeBatch(db!);
  batch.set(ref,{name:name.trim().slice(0,40),ownerId:uid,createdAt:serverTimestamp()});
  batch.set(doc(ref,'members',uid),{name:userName.slice(0,40)||'나',color:COLORS[0],joinedAt:serverTimestamp()});
  batch.set(doc(db!,'users',uid),{familyId:ref.id});
  await batch.commit();return ref.id;
}
export async function createInvite(family:Family,uid:string):Promise<string>{
  const code=crypto.randomUUID().replaceAll('-','');
  await setDoc(doc(db!,'invites',code),{familyId:family.id,familyName:family.name,createdBy:uid,expiresAt:Timestamp.fromMillis(Date.now()+24*3600000),usedBy:'',usedAt:null});
  return code;
}
export async function joinFamily(uid:string,userName:string,rawCode:string){
  let code=rawCode.trim();
  if(code.includes('://')){try{code=new URL(code).searchParams.get('invite')??'';}catch{code='';}}
  if(!/^[a-f0-9]{32}$/.test(code))throw new Error('초대 코드나 초대 링크를 다시 확인해 주세요.');
  await runTransaction(db!,async transaction=>{
    const inviteRef=doc(db!,'invites',code),snap=await transaction.get(inviteRef);
    if(!snap.exists())throw new Error('초대 코드를 찾을 수 없어요.');
    const data=snap.data();
    if(data.usedBy||data.expiresAt.toMillis()<Date.now())throw new Error('이미 사용했거나 만료된 초대예요. 새 초대를 받아 주세요.');
    const memberRef=doc(db!,'families',data.familyId,'members',uid);
    const existing=await transaction.get(doc(db!,'users',uid));
    if(existing.exists()&&existing.data().familyId)throw new Error('이미 가족 캘린더에 가입되어 있어요.');
    transaction.update(inviteRef,{usedBy:uid,usedAt:serverTimestamp()});
    transaction.set(memberRef,{name:userName.slice(0,40)||'가족',color:COLORS[Math.floor(Math.random()*COLORS.length)],inviteCode:code,joinedAt:serverTimestamp()});
    transaction.set(doc(db!,'users',uid),{familyId:data.familyId});
  });
}
export async function findFamily(uid:string):Promise<Family|null>{
  const profile=await getDoc(doc(db!,'users',uid));
  if(!profile.exists()||!profile.data().familyId)return null;
  const id=profile.data().familyId,snap=await getDoc(doc(db!,'families',id));
  if(!snap.exists())throw new Error('가족 캘린더를 찾을 수 없어요.');
  return {id,...snap.data()} as Family;
}
export function listenFamily(familyId:string,uid:string,onEvents:(e:CalendarEvent[])=>void,onMembers:(m:Member[])=>void,onCategories:(c:EventCategory[])=>void,onError:(error:unknown)=>void){
  let shared:CalendarEvent[]=[],personal:CalendarEvent[]=[];
  const publish=()=>onEvents([...shared,...personal]);
  const a=onSnapshot(collection(db!,'families',familyId,'events'),s=>{shared=s.docs.map(d=>({...d.data(),id:d.id} as CalendarEvent));publish();},onError);
  const b=onSnapshot(collection(db!,'users',uid,'privateEvents'),s=>{personal=s.docs.map(d=>({...d.data(),id:d.id} as CalendarEvent));publish();},onError);
  const c=onSnapshot(collection(db!,'families',familyId,'members'),s=>onMembers(s.docs.map(d=>({...d.data(),id:d.id} as Member))),onError);
  const d=onSnapshot(collection(db!,'families',familyId,'categories'),s=>onCategories(s.docs.map(d=>({...d.data(),id:d.id} as EventCategory))),onError);
  return ()=>{a();b();c();d();};
}
export async function saveCloudCategory(category:EventCategory,familyId:string){
  await setDoc(doc(db!,'families',familyId,'categories',category.id),{label:category.label.trim(),color:category.color,deleted:category.deleted,updatedAt:serverTimestamp()});
}
function eventRef(event:CalendarEvent,familyId:string,uid:string){
  return event.isPrivate?doc(db!,'users',uid,'privateEvents',event.id):doc(db!,'families',familyId,'events',event.id);
}
export async function saveCloudEvent(event:CalendarEvent,familyId:string,uid:string,previous?:CalendarEvent){
  const batch=writeBatch(db!);
  if(previous&&previous.isPrivate!==event.isPrivate){
    if(previous.createdBy!==uid)throw new Error('공유 범위는 작성자만 변경할 수 있어요.');
    batch.delete(eventRef(previous,familyId,uid));
  }
  batch.set(eventRef(event,familyId,uid),{...event,title:event.title.trim(),updatedAt:serverTimestamp()});
  await batch.commit();
}
export async function deleteCloudEvent(event:CalendarEvent,familyId:string,uid:string){await deleteDoc(eventRef(event,familyId,uid));}
