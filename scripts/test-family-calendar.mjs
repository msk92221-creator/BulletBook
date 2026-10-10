import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import {linkedEventId, importedEvent, reconcileEntry, remoteFingerprint} from '../family-calendar/sync-model.mjs';
const entry={sourceId:'event:old',date:'2020-09-01',title:'오래된 일정',kind:'event'};
const id=await linkedEventId('book',entry.sourceId);
assert.equal(await linkedEventId('book',entry.sourceId),id);
assert.notEqual(await linkedEventId('other',entry.sourceId),id);
const first=reconcileEntry(entry,null,null,id,'owner');
assert.equal(first.write.isPrivate,false);
assert.equal(first.write.startDate,entry.date);
const long=importedEvent({...entry,title:'가'.repeat(241)},id,'owner');
assert.equal(long.title.length,100);assert.equal(long.notes.length,241);
const baseline={...first.binding,cloud:remoteFingerprint(first.write)};
assert.equal(reconcileEntry(entry,baseline,first.write,id,'owner').write,null);
assert.equal(reconcileEntry(entry,null,first.write,id,'owner').write,null,'restart after partial import adopts existing doc');
const deleted=reconcileEntry(entry,baseline,null,id,'owner');
assert.equal(deleted.binding.deleted,true);assert.equal(deleted.write,null);
assert.equal(reconcileEntry({...entry,title:'changed'},deleted.binding,null,id,'owner').write,null);
const familyChange={...first.write,title:'가족이 변경',startDate:'2020-09-02',endDate:'2020-09-04'};
const conflict=reconcileEntry({...entry,title:'내 변경'},baseline,familyChange,id,'owner');
assert.equal(conflict.write,null);assert.equal(conflict.conflict,true);
const moved=reconcileEntry({...entry,date:'2020-09-05'}, {...baseline,cloud:remoteFingerprint(familyChange)},familyChange,id,'owner');
assert.equal(moved.write.endDate,'2020-09-07');
const original=structuredClone(entry);
reconcileEntry(entry,baseline,first.write,id,'owner');assert.deepEqual(entry,original);

// Parent/iframe boundary: only a verified same-origin child can link records,
// backup must finish first, and delayed replies from another book/account are ignored.
let listener,frame;const posts=[],native=[],updates=[];
const book={id:'book',pages:[{text:'PRIVATE JOURNAL'}],calendarEvents:[entry]};
const make=tag=>tag==='iframe'?(frame={contentWindow:{postMessage:m=>posts.push(m)},addEventListener(){}}):
  {open:false,setAttribute(){},append(){},showModal(){this.open=true},close(){this.open=false}};
const window={addEventListener:(type,fn)=>listener=fn,BulletBookNative:{configureFamilyCalendar:(_,json)=>native.push(JSON.parse(json))}};
vm.runInNewContext(await readFile(new URL('../family-bridge.js',import.meta.url),'utf8'),{
  window,document:{createElement:make,body:{append(){}}},location:{origin:'https://localhost'},setTimeout,clearTimeout,Set,JSON,Date});
let releaseBackup;const backup=new Promise(resolve=>releaseBackup=resolve);
const host=window.BulletBookFamilyHost.create({getBook:()=>book,exportEntries:async()=>({entries:[entry],from:'2020-01-01',to:'2028-12-31'}),
  backup:()=>backup,bindings:(...x)=>updates.push(x),changed(){}});
const receive=(data,origin='https://localhost',source=frame.contentWindow)=>listener({data:{channel:'bulletbook-family-v1',...data},origin,source});
await receive({type:'ready',scope:'owner:family'},'https://evil.invalid');assert.equal(host.isConnected(),false);
const waiting=receive({type:'ready',scope:'owner:family'});assert.equal(posts.length,0);releaseBackup(true);await waiting;
await new Promise(r=>setImmediate(r));assert.equal(host.isConnected(),true);
assert.equal(JSON.stringify(posts).includes('PRIVATE JOURNAL'),false);
await receive({type:'projection',scope:'owner:family',bookId:'other',days:{secret:[{}]},linkedSources:[]});assert.equal(Object.keys(host.days()).length,0);
await receive({type:'projection',scope:'owner:family',bookId:'book',days:{'2020-09-01':[{title:'가족 일정'}]},linkedSources:['event:old'],bindings:{'event:old':baseline}});
assert.equal(host.hides('event:old'),true);assert.equal(host.events('2020-09-01')[0].title,'가족 일정');
await receive({type:'disconnected'});assert.equal(host.isConnected(),false);assert.equal(host.events('2020-09-01').length,0);
await new Promise(r=>setTimeout(r,800));assert.equal(updates.length,0,'logout cancels pending bindings');
assert.equal(native.at(-1).disconnected,true);
console.log('Family calendar IDs, migration, conflict/deletion safety, backup and account isolation: ok');
