import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const context = {window:{}, console, setTimeout, clearTimeout, setInterval, clearInterval,
  location:{protocol:'http:', hostname:'127.0.0.1'}, navigator:{onLine:true}, document:{visibilityState:'visible'}};
vm.runInNewContext(await readFile(new URL('../inbox.js', import.meta.url), 'utf8'), context);
vm.runInNewContext(await readFile(new URL('../cloud-sync.js', import.meta.url), 'utf8'), context);
const {normalizeTasks, addTask, updateTask} = context.window.BulletBookInbox;
const {mergeBooks} = context.window.BulletBookCloudSync.__test;
const t0 = '2026-10-16T01:00:00Z', t1 = '2026-10-16T02:00:00Z', t2 = '2026-10-16T03:00:00Z';
const json = value => JSON.parse(JSON.stringify(value));
const task = (id, title) => ({id,title,completed:false,deleted:false,createdAt:t0,updatedAt:t0});
const book = tasks => ({format:'bulletbook', version:6, id:'b1', updatedAt:t0,
  pages:[{id:'p1',type:'blank',title:'기존 페이지',elements:[]}], groups:[], inboxTasks:tasks});

assert.equal(normalizeTasks(undefined).length, 0);
let tasks = addTask([], '  자동차 정비 예약  ', 'a', t0);
assert.equal(tasks[0].title, '자동차 정비 예약');
assert.equal(addTask(tasks, '   ', 'empty', t1), tasks);
assert.equal(tasks[0].completed, false);
tasks = updateTask(tasks, 'a', {completed:true}, t1);
assert.equal(tasks[0].completed, true);
tasks = updateTask(tasks, 'a', {completed:false,title:'자동차 정비 알아보기'}, t2);
assert.equal(tasks[0].completed, false);
assert.equal(tasks[0].title, '자동차 정비 알아보기');
assert.deepEqual(json(normalizeTasks(json(tasks))), json(tasks), 'backup/reload preserves all inbox fields');
assert.deepEqual(json(updateTask(tasks,'missing',{completed:true},t2)), json(tasks));
assert.equal(normalizeTasks([null,{}, {title:' '}]).length, 0);

const base = book([task('a','서류 정리'),task('b','책 읽기')]);
const local = structuredClone(base), remote = structuredClone(base);
local.inboxTasks = json(updateTask(local.inboxTasks,'a',{completed:true},t1));
remote.inboxTasks = json(updateTask(remote.inboxTasks,'b',{title:'밀린 책 읽기'},t2));
local.inboxTasks.push(task('local','휴대폰에서 추가'));
remote.inboxTasks.push(task('remote','PC에서 추가'));
const result = mergeBooks(base,local,remote);
assert.equal(result.book.inboxTasks.length,4);
assert.equal(result.book.inboxTasks.find(t=>t.id==='a').completed,true);
assert.equal(result.book.inboxTasks.find(t=>t.id==='b').title,'밀린 책 읽기');
assert.equal(result.hadConflict,false);
assert.deepEqual(json(result.book.pages), base.pages, 'inbox changes do not alter journal pages');

// Independent title and completion edits to the same task both survive.
const edited = structuredClone(base), checked = structuredClone(base);
edited.inboxTasks = json(updateTask(edited.inboxTasks,'a',{title:'서류 분류하기'},t1));
checked.inboxTasks = json(updateTask(checked.inboxTasks,'a',{completed:true},t2));
const combined = mergeBooks(base,edited,checked).book.inboxTasks[0];
assert.equal(combined.title,'서류 분류하기'); assert.equal(combined.completed,true);

// A stale device cannot resurrect a deleted task, with or without a common baseline.
const deleted = structuredClone(base);
deleted.inboxTasks = json(updateTask(deleted.inboxTasks,'a',{deleted:true},t2));
for (const baseline of [base,null]) {
  assert.equal(mergeBooks(baseline,deleted,base).book.inboxTasks.find(t=>t.id==='a').deleted,true);
}
const olderApp = structuredClone(base); delete olderApp.inboxTasks;
assert.equal(mergeBooks(base,deleted,olderApp).book.inboxTasks.find(t=>t.id==='a').deleted,true);
assert.equal(mergeBooks(null,base,olderApp).book.inboxTasks.length,2);

// Resolve simultaneous completion/reopening by the task edit time, not an unrelated page edit.
const completedBase = book([task('a','정리')]);
const newer = structuredClone(completedBase), stale = structuredClone(completedBase);
newer.inboxTasks = json(updateTask(newer.inboxTasks,'a',{completed:false},t2));
stale.inboxTasks = json(updateTask(stale.inboxTasks,'a',{completed:true},t1));
stale.updatedAt='2026-10-16T05:00:00Z';
assert.equal(mergeBooks(null,newer,stale).book.inboxTasks[0].completed,false);
console.log('Inbox: editing, completion, backup, concurrent additions/edits, deletion, older-app merge and unrelated page preservation passed.');
