import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,getDocs,collection,deleteDoc,serverTimestamp,runTransaction} from 'firebase/firestore';
import {linkedEventId,reconcileEntry,remoteFingerprint} from '../family-calendar/sync-model.mjs';
if(!process.env.FIRESTORE_EMULATOR_HOST)throw Error('Start a local Firestore emulator; production is never used by this test.');
const [host,port]=process.env.FIRESTORE_EMULATOR_HOST.split(':');
const env=await initializeTestEnvironment({projectId:'demo-bulletbook-family',firestore:{host,port:Number(port),rules:await readFile(new URL('../family-calendar/firestore.rules',import.meta.url),'utf8')}});
try{
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore();
    await setDoc(doc(db,'families','family'),{name:'Test',ownerId:'owner'});
    for(const uid of ['owner','family-member'])await setDoc(doc(db,'families','family','members',uid),{name:uid});
  });
  const owner=env.authenticatedContext('owner').firestore(),member=env.authenticatedContext('family-member').firestore(),stranger=env.authenticatedContext('stranger').firestore();
  const entry={sourceId:'event:historic',date:'2020-01-01',title:'가'.repeat(241),kind:'event'};
  const id=await linkedEventId('book',entry.sourceId),ref=doc(owner,'families','family','events',id);
  let binding;
  const sync=async input=>runTransaction(owner,async tx=>{
    const existing=await tx.get(ref),privateDoc=await tx.get(doc(owner,'users','owner','privateEvents',id));
    const result=reconcileEntry(input,binding,privateDoc.exists()?privateDoc.data():existing.exists()?existing.data():null,id,'owner');
    if(result.write)tx.set(ref,{...result.write,updatedAt:serverTimestamp()});
    binding={...result.binding,cloud:result.write?remoteFingerprint(result.write):result.binding.cloud};return result;
  });
  await assertSucceeds(sync(entry));await assertSucceeds(sync(entry));
  assert.equal((await getDocs(collection(member,'families','family','events'))).size,1);
  const shared=(await getDoc(ref)).data();assert.equal(shared.notes,entry.title);
  await assertFails(getDoc(doc(stranger,'families','family','events',id)));
  await setDoc(doc(member,'families','family','events',id),{...shared,title:'가족 수정',updatedAt:serverTimestamp()});
  const conflict=await sync({...entry,title:'동시 수정'});assert.equal(conflict.conflict,true);
  assert.equal((await getDoc(ref)).data().title,'가족 수정');
  await deleteDoc(doc(member,'families','family','events',id));await sync(entry);
  assert.equal((await getDoc(ref)).exists(),false);
  assert.equal(binding.deleted,true);
  console.log('Firestore emulator: shared import, restart dedupe, family edit/delete and access rules passed.');
}finally{await env.cleanup();}
