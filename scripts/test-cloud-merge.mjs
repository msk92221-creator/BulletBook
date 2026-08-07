import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../cloud-sync.js", import.meta.url), "utf8");
const context = {
  window: {},
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  location: { protocol: "http:", hostname: "127.0.0.1" },
  navigator: { onLine: true },
  document: { visibilityState: "visible" },
  fetch: async () => { throw new Error("unexpected fetch"); },
};
vm.runInNewContext(source, context, { filename: "cloud-sync.js" });
const { mergeBooks, bookContentSignature } = context.window.BulletBookCloudSync.__test;

const element = (id, text) => ({
  id,
  type: "text",
  x: 24,
  y: 24,
  width: 240,
  height: 48,
  text,
});
const page = (id, title, elements = []) => ({
  id,
  type: "blank",
  title,
  elements,
  templateText: {},
  createdAt: "2026-08-01T00:00:00.000Z",
});
const book = (updatedAt, pages) => ({
  format: "bulletbook",
  version: 6,
  id: "book-1",
  title: "나의 불렛북",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt,
  syncPristine: false,
  pages,
  groups: [],
  goalSystem: { version: 1, areas: [], goals: [], missions: [] },
});

{
  const local = book("2026-08-03T01:05:00.000Z", [
    page("p1", "공통", [element("e1", "기존"), element("e-local", "폰 메모")]),
  ]);
  const remote = book("2026-08-03T01:00:00.000Z", [
    page("p1", "공통", [element("e1", "기존"), element("e-remote", "PC 메모")]),
    page("p2", "PC에서 추가한 페이지", [element("e2", "사라지면 안 됨")]),
  ]);
  const merged = mergeBooks(null, local, remote);
  assert.equal(JSON.stringify(merged.book.pages.map(item => item.id)), JSON.stringify(["p1", "p2"]));
  assert.equal(
    JSON.stringify(merged.book.pages[0].elements.map(item => item.id)),
    JSON.stringify(["e1", "e-local", "e-remote"])
  );
  assert.equal(merged.hadConflict, false);
}

{
  const base = book("2026-08-03T01:00:00.000Z", [
    page("p1", "첫 페이지", [element("e1", "기존 1")]),
    page("p2", "둘째 페이지", [element("e2", "기존 2")]),
  ]);
  const local = structuredClone(base);
  local.updatedAt = "2026-08-03T01:02:00.000Z";
  local.pages[0].elements[0].text = "폰에서 수정";
  const remote = structuredClone(base);
  remote.updatedAt = "2026-08-03T01:03:00.000Z";
  remote.pages[1].elements[0].text = "PC에서 수정";
  const merged = mergeBooks(base, local, remote);
  assert.equal(merged.book.pages[0].elements[0].text, "폰에서 수정");
  assert.equal(merged.book.pages[1].elements[0].text, "PC에서 수정");
  assert.equal(merged.hadConflict, false);
}

{
  const base = book("2026-08-03T01:00:00.000Z", [
    page("cover", "표지"),
    page("delete-me", "삭제 대상", [element("e1", "그대로")]),
  ]);
  const local = structuredClone(base);
  local.updatedAt = "2026-08-03T01:02:00.000Z";
  local.pages = local.pages.filter(item => item.id !== "delete-me");
  const remote = structuredClone(base);
  remote.updatedAt = "2026-08-03T01:03:00.000Z";
  const merged = mergeBooks(base, local, remote);
  assert.equal(merged.book.pages.some(item => item.id === "delete-me"), false);
}

{
  const base = book("2026-08-03T01:00:00.000Z", [
    page("cover", "표지"),
    page("keep-me", "삭제와 수정 충돌", [element("e1", "기존")]),
  ]);
  const local = structuredClone(base);
  local.updatedAt = "2026-08-03T01:02:00.000Z";
  local.pages = local.pages.filter(item => item.id !== "keep-me");
  const remote = structuredClone(base);
  remote.updatedAt = "2026-08-03T01:03:00.000Z";
  remote.pages[1].elements[0].text = "다른 기기에서 수정";
  const merged = mergeBooks(base, local, remote);
  assert.equal(merged.book.pages.find(item => item.id === "keep-me").elements[0].text,
    "다른 기기에서 수정");
  assert.equal(merged.hadConflict, true);
}

{
  const base = book("2026-08-03T01:00:00.000Z", [
    page("p1", "동시 수정", [element("e1", "원문")]),
  ]);
  const local = structuredClone(base);
  local.updatedAt = "2026-08-03T01:02:00.000Z";
  local.pages[0].elements[0].text = "폰 수정";
  const remote = structuredClone(base);
  remote.updatedAt = "2026-08-03T01:03:00.000Z";
  remote.pages[0].elements[0].text = "PC 수정";
  const merged = mergeBooks(base, local, remote);
  assert.equal(merged.book.pages[0].elements[0].text, "PC 수정");
  assert.equal(merged.hadConflict, true);
}

{
  const older = book("2026-08-03T01:00:00.000Z", [page("p1", "같은 내용")]);
  const newer = structuredClone(older);
  newer.updatedAt = "2026-08-03T02:00:00.000Z";
  newer.syncPristine = true;
  assert.equal(bookContentSignature(older), bookContentSignature(newer));
}

{
  const base = book("2026-08-03T01:00:00.000Z", [page("p1", "목표")]);
  base.goalSystem.areas.push({ id: "a1", name: "건강", purpose: "유지" });
  base.goalSystem.goals.push({
    id: "g1", areaId: "a1", title: "체력 향상", currentValue: 1, status: "active",
  });
  base.goalSystem.missions.push({
    id: "m1", goalId: "g1", title: "걷기", schedule: "daily", active: true,
  });
  const local = structuredClone(base);
  local.updatedAt = "2026-08-03T01:02:00.000Z";
  local.goalSystem.goals[0].currentValue = 2;
  local.goalSystem.areas.push({ id: "a-local", name: "성장", purpose: "학습" });
  const remote = structuredClone(base);
  remote.updatedAt = "2026-08-03T01:03:00.000Z";
  remote.goalSystem.areas[0].purpose = "건강한 상태 유지";
  remote.goalSystem.areas.push({ id: "a-remote", name: "관계", purpose: "연결" });
  remote.goalSystem.missions.push({
    id: "m2", goalId: "g1", title: "근력 운동", schedule: "weekly", weeklyTarget: 3, active: true,
  });
  const merged = mergeBooks(base, local, remote);
  assert.equal(merged.book.goalSystem.goals[0].currentValue, 2);
  assert.equal(merged.book.goalSystem.areas.find(item => item.id === "a1").purpose,
    "건강한 상태 유지");
  assert.deepEqual(
    new Set(merged.book.goalSystem.areas.map(item => item.id)),
    new Set(["a1", "a-local", "a-remote"])
  );
  assert.deepEqual(
    new Set(merged.book.goalSystem.missions.map(item => item.id)),
    new Set(["m1", "m2"])
  );
  assert.equal(merged.hadConflict, false);
}

{
  const base = book("2026-08-03T01:00:00.000Z", [
    page("p1", "공통", [element("e1", "기존")]),
  ]);
  let local = structuredClone(base);
  local.updatedAt = "2026-08-03T01:02:00.000Z";
  local.pages[0].elements.push(element("e-local", "폰 기록"));
  const remote = structuredClone(base);
  remote.updatedAt = "2026-08-03T01:03:00.000Z";
  remote.pages.push(page("p-remote", "PC 추가", [element("e-remote", "PC 기록")]));
  const writes = [];
  const recoveries = [];
  let storedBase = null;
  context.setInterval = () => 1;
  context.clearInterval = () => {};
  context.fetch = async (path, options = {}) => {
    if (path === "/api/cloud/status") {
      return { ok: true, status: 200, json: async () => ({ connected: true }) };
    }
    if (path === "/api/cloud/book" && (!options.method || options.method === "GET")) {
      return { ok: true, status: 200, text: async () => JSON.stringify(remote) };
    }
    if (path === "/api/cloud/book" && options.method === "PUT") {
      writes.push(JSON.parse(options.body));
      return { ok: true, status: 200, json: async () => ({ saved: true }) };
    }
    throw new Error(`unexpected request: ${path}`);
  };
  const sync = context.window.BulletBookCloudSync.create({
    getBook: () => structuredClone(local),
    applyBook: async value => { local = structuredClone(value); },
    isValidBook: value => value?.format === "bulletbook" && Array.isArray(value.pages),
    isPristineBook: () => false,
    isLocalDirty: () => false,
    getSyncBase: async () => structuredClone(base),
    setSyncBase: async value => { storedBase = structuredClone(value); return true; },
    saveRecoverySnapshot: async (value, info) => {
      recoveries.push({ value: structuredClone(value), info });
      return true;
    },
    notify: () => {},
    onState: () => {},
  });
  assert.equal(await sync.restore(), true);
  assert.equal(writes.length, 1);
  assert.equal(recoveries.length, 2);
  assert.equal(writes[0].pages.some(item => item.id === "p-remote"), true);
  assert.equal(writes[0].pages[0].elements.some(item => item.id === "e-local"), true);
  assert.equal(bookContentSignature(storedBase), bookContentSignature(writes[0]));
}

{
  const base = book("2026-08-03T01:00:00.000Z", [
    page("p1", "공통", [element("e1", "동기화 기준")]),
  ]);
  let local = structuredClone(base);
  const remote = structuredClone(base);
  remote.updatedAt = "2026-08-03T01:03:00.000Z";
  remote.pages[0].elements[0].text = "PC에서 수정";
  let dirty = false;
  let applyCount = 0;
  const writes = [];
  context.fetch = async (path, options = {}) => {
    if (path === "/api/cloud/status") {
      return { ok: true, status: 200, json: async () => ({ connected: true }) };
    }
    if (path === "/api/cloud/book" && (!options.method || options.method === "GET")) {
      return { ok: true, status: 200, text: async () => JSON.stringify(remote) };
    }
    if (path === "/api/cloud/book" && options.method === "PUT") {
      writes.push(JSON.parse(options.body));
      return { ok: true, status: 200, json: async () => ({ saved: true }) };
    }
    throw new Error(`unexpected request: ${path}`);
  };
  const sync = context.window.BulletBookCloudSync.create({
    getBook: () => structuredClone(local),
    applyBook: async value => { applyCount += 1; local = structuredClone(value); },
    isValidBook: value => value?.format === "bulletbook" && Array.isArray(value.pages),
    isPristineBook: () => false,
    isLocalDirty: () => dirty,
    flushLocalChanges: async () => { dirty = false; return true; },
    getSyncBase: async () => structuredClone(base),
    setSyncBase: async () => true,
    saveRecoverySnapshot: async () => {
      // IndexedDB 저장이 끝나기 전에 사용자가 새 글을 쓴 상황을 재현한다.
      local.pages[0].elements.push(element("e-during-sync", "동기화 중 작성"));
      local.updatedAt = "2026-08-03T01:04:00.000Z";
      dirty = true;
      return true;
    },
    notify: () => {},
    onState: () => {},
  });
  assert.equal(await sync.restore(), true);
  assert.equal(applyCount, 0);
  assert.equal(writes.length, 0);
  assert.equal(local.pages[0].elements.some(item => item.id === "e-during-sync"), true);
}

{
  const base = book("2026-08-03T01:00:00.000Z", [page("p1", "공통")]);
  base.calendarEvents = [];
  const local = structuredClone(base);
  const remote = structuredClone(base);
  local.updatedAt = "2026-08-03T01:02:00.000Z";
  remote.updatedAt = "2026-08-03T01:03:00.000Z";
  local.calendarEvents.push({
    id: "cal-local", date: "2026-08-03", title: "폰 일정",
    createdAt: local.updatedAt, updatedAt: local.updatedAt,
  });
  remote.calendarEvents.push({
    id: "cal-remote", date: "2026-08-04", title: "PC 일정",
    createdAt: remote.updatedAt, updatedAt: remote.updatedAt,
  });
  const merged = mergeBooks(base, local, remote);
  assert.deepEqual(
    new Set(merged.book.calendarEvents.map(item => item.id)),
    new Set(["cal-local", "cal-remote"])
  );
}

console.log("cloud three-way merge: ok");
