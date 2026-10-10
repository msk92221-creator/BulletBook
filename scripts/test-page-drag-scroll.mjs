import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
const extract = name => {
  const start = source.indexOf(`  function ${name}(`);
  assert.notEqual(start, -1);
  return source.slice(start, source.indexOf("\n  function ", start + 1));
};
const listeners = new Map();
const frames = new Map();
const timers = new Map();
let nextId = 1;
const list = {
  scrollTop: 1800, scrollHeight: 5000, clientHeight: 500,
  getBoundingClientRect: () => ({ top: 280, bottom: 780, left: 0, right: 390, height: 500 }),
  classList: { add() {}, remove() {} },
};
const context = vm.createContext({
  refs: { pageList: list }, pageListDragState: null,
  pageListAutoScrollFrame: null, pageListAutoScrollPointer: null, pageListAutoScrollTime: null,
  clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
  requestAnimationFrame: callback => { const id = nextId++; frames.set(id, callback); return id; },
  cancelAnimationFrame: id => frames.delete(id),
  clearTimeout: id => timers.delete(id),
  document: { addEventListener: (type, callback) => listeners.set(type, callback) },
  window: {
    addEventListener: (type, callback) => listeners.set(type, callback),
    setTimeout: callback => { const id = nextId++; timers.set(id, callback); return id; },
  },
  navigator: {},
  groupListDropPosition: () => ({ position: list.scrollTop, kind: "group" }),
  pageListDropPosition: () => ({ position: list.scrollTop, kind: "pages" }),
  pageDragIdsForSource: id => [id], markPageDragSources() {},
  clearPageListDropVisuals() {}, reorderGroupFromList() {}, applyPageListDrop() {},
});
vm.runInContext([
  "stopPageListAutoScroll", "pageListAutoScrollSpeed", "updatePageListAutoScroll",
  "bindPageListDragScrolling", "wirePageGroupReorder", "wirePageListReorder",
].map(extract).join("\n"), context);
const tick = time => {
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach(callback => callback(time));
};
const event = (x = 180, y = 285) => ({ clientX: x, clientY: y, preventDefault() {}, stopPropagation() {} });
context.bindPageListDragScrolling();

// One dragover is enough: holding still at the edge keeps scrolling and retargeting.
for (const kind of ["group", "pages"]) {
  list.scrollTop = 1800;
  context.pageListDragState = { kind, sourceId: "annual", sourceIds: ["annual"] };
  listeners.get("dragover")(event());
  for (let t = 0; t < 500; t += 16) tick(t);
  assert.ok(list.scrollTop < 1500, `${kind}: native drag must keep scrolling upward`);
  assert.equal(context.pageListDragState.drop.position, list.scrollTop, "drop target follows scrolling without more pointer movement");
  listeners.get("dragover")(event(180, 775));
  const beforeDown = list.scrollTop;
  for (let t = 500; t < 1000; t += 16) tick(t);
  assert.ok(list.scrollTop > beforeDown, `${kind}: lower edge scrolls downward`);
  listeners.get("dragover")(event(180, 500));
  const centerTop = list.scrollTop;
  tick(1016);
  assert.equal(list.scrollTop, centerTop, "center stops scrolling");
  listeners.get("dragover")(event(180, 220));
  assert.equal(frames.size, 1, "dragging over the search header keeps the edge scroll active");
  listeners.get("dragover")(event(450, 220));
  assert.equal(frames.size, 0, "outside horizontal bounds stops scrolling");
}
for (const endEvent of ["drop", "dragend", "blur"]) {
  listeners.get("dragover")(event());
  listeners.get(endEvent)({});
  assert.equal(frames.size, 0, `${endEvent} cancels the loop`);
}
context.pageListDragState = null;
listeners.get("dragover")(event());
assert.equal(frames.size, 0, "unrelated document dragging does not scroll the notebook");

// Both touch handlers must be wired to the same continuous loop.
for (const kind of ["group", "pages"]) {
  const handlers = new Map();
  const node = { addEventListener: (type, callback) => handlers.set(type, callback), classList: { add() {} } };
  if (kind === "group") context.wirePageGroupReorder(node, { id: "annual" });
  else context.wirePageListReorder(node, { id: "note", type: "blank" });
  const touch = { identifier: 7, clientX: 180, clientY: 600 };
  handlers.get("touchstart")({ touches: [touch], target: { closest: () => null } });
  const pending = [...timers.values()]; timers.clear(); pending.forEach(callback => callback());
  list.scrollTop = 1800;
  const movedTouch = { ...touch, clientY: 285 };
  handlers.get("touchmove")({ ...event(), touches: [movedTouch] });
  for (let t = 0; t < 500; t += 16) tick(t);
  assert.ok(list.scrollTop < 1500, `${kind}: touch hold must scroll`);
  handlers.get("touchcancel")({ ...event(), changedTouches: [movedTouch] });
  assert.equal(frames.size, 0, `${kind}: touch cancellation stops scrolling`);
}

// A Fold's 120 Hz display must not double the speed. Endpoints must stop the loop.
const distance = hz => {
  list.scrollTop = 2500;
  context.updatePageListAutoScroll(180, 285);
  for (let i = 0; i < hz; i++) tick(i * 1000 / hz);
  context.stopPageListAutoScroll();
  return 2500 - list.scrollTop;
};
assert.ok(Math.abs(distance(60) - distance(120)) < 20);
for (const [top, y, expected] of [[5, 285, 0], [4495, 775, 4500]]) {
  list.scrollTop = top;
  context.updatePageListAutoScroll(180, y);
  tick(0); tick(16);
  assert.equal(list.scrollTop, expected);
  assert.equal(frames.size, 0, "boundary ends the animation loop");
}
console.log("Page/group drag: native and touch edge holds, target refresh, direction, cancellation, 120 Hz and boundaries passed.");
