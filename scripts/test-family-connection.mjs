import assert from 'node:assert/strict';
import vm from 'node:vm';
import {build} from 'esbuild';
import {webcrypto} from 'node:crypto';
const fake = `
const t=globalThis.testBackend;
export const auth=t.auth,db={};
export const findFamily=async()=>({id:'family',name:'Test'}),friendlyError=e=>e.message;
export const onAuthStateChanged=(_,fn)=>{t.authListener=fn;queueMicrotask(()=>fn(t.auth.currentUser));return()=>{}};
export const onIdTokenChanged=()=>()=>{};
export const collection=(_, ...p)=>p.join('/'),doc=collection,serverTimestamp=()=>null;
export const onSnapshot=(path,options,next)=>{t.listeners.set(path,next);queueMicrotask(()=>t.emit(path));return()=>t.listeners.delete(path)};
export const runTransaction=async(_,fn)=>{
  const writes=[];
  const result=await fn({get:async path=>({exists:()=>t.docs.has(path),data:()=>t.docs.get(path)}),set:(path,value)=>writes.push([path,value])});
  for(const [path,value] of writes){t.docs.set(path,value);t.writeCount++;}
  if(writes.length)queueMicrotask(()=>t.emit('families/family/events'));
  return result;
};`;
const bundle=await build({entryPoints:['family-calendar/connection.ts'],write:false,bundle:true,platform:'browser',format:'iife',globalName:'connection',
  plugins:[{name:'fake-backend',setup(b){b.onResolve({filter:/^(firebase\/(auth|firestore)|\.\/ui\/firebase)$/},()=>({path:'backend',namespace:'fake'}));b.onLoad({filter:/.*/,namespace:'fake'},()=>({contents:fake,loader:'js'}));}}]});
const messages=[],listeners=new Map();
const testBackend={docs:new Map(),listeners:new Map(),writeCount:0,
  auth:{currentUser:{uid:'owner',refreshToken:'TEST_ONLY',getIdToken:async()=>'TEST_ONLY'}},
  emit(path){this.listeners.get(path)?.({metadata:{fromCache:false},docs:[...this.docs].filter(([key])=>key.startsWith(path+'/')).map(([key,value])=>({id:key.split('/').at(-1),data:()=>value}))});}};
const parent={postMessage:m=>messages.push(structuredClone(m))};
const window={parent,addEventListener:(name,fn)=>listeners.set(name,fn),dispatchEvent:e=>listeners.get(e.type)?.(e)};
const timers=new Set();
const context=vm.createContext({window,location:{origin:'https://localhost'},testBackend,crypto:webcrypto,TextEncoder,CustomEvent,queueMicrotask,
  setTimeout:(fn,ms)=>{const timer=setTimeout(()=>{timers.delete(timer);fn()},ms);timers.add(timer);return timer},clearTimeout:t=>{clearTimeout(t);timers.delete(t)}});
vm.runInContext(bundle.outputFiles[0].text,context);context.connection.startConnection();
const waitFor=async predicate=>{const until=Date.now()+12000;while(!predicate()){if(Date.now()>until)throw Error('Connection test timed out');await new Promise(r=>setTimeout(r,20));}};
const entry={sourceId:'event:historic',kind:'event',date:'2020-01-01',title:'과거 기록'};
const book={type:'book',scope:'owner:family',bookId:'book',entries:[entry],bindings:{},from:'2025-01-01',to:'2028-12-31'};
const receive=message=>listeners.get('message')({source:parent,origin:'https://localhost',data:{channel:'bulletbook-family-v1',...message}});
try{
  await waitFor(()=>messages.some(m=>m.type==='ready'));receive(book);
  await waitFor(()=>messages.some(m=>m.type==='projection'&&m.days['2020-01-01']?.length===1));
  assert.equal(testBackend.writeCount,1);const path=[...testBackend.docs.keys()][0];
  testBackend.docs.set(path,{...testBackend.docs.get(path),title:'가족 변경'});testBackend.emit('families/family/events');
  await waitFor(()=>messages.some(m=>m.type==='projection'&&m.days['2020-01-01']?.[0]?.title==='가족 변경'));
  receive({...book,entries:[]});await new Promise(r=>setTimeout(r,1100));assert.equal(testBackend.docs.size,1,'restoring a notebook never deletes family schedules');
  receive(book);testBackend.docs.delete(path);testBackend.emit('families/family/events');
  await waitFor(()=>messages.some(m=>m.type==='projection'&&m.bindings[entry.sourceId]?.deleted));
  assert.equal(testBackend.writeCount,1,'remote deletion is not re-created');
  await testBackend.authListener(null);assert.equal(messages.at(-1).type,'disconnected');
  console.log('Actual connection adapter: initial import, historical projection, live edit/delete, older backup and logout passed.');
}finally{for(const timer of timers)clearTimeout(timer);}
