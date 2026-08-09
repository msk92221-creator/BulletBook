import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist in app.js`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} body is incomplete`);
}

const context = vm.createContext({
  normalizedDateOrBlank(value) {
    const text = String(value || "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
  },
});
vm.runInContext(
  `${extractFunction("missionDuplicateSignature")}\n${extractFunction("dedupeDuplicatedMissions")}\n` +
  `${extractFunction("removeMissionsFromDate")}\n` +
  "this.missionDuplicateSignature = missionDuplicateSignature; " +
  "this.dedupeDuplicatedMissions = dedupeDuplicatedMissions; " +
  "this.removeMissionsFromDate = removeMissionsFromDate;",
  context
);

const book = {
  goalSystem: {
    missions: [
      { id: "m1", goalId: "quick", title: "유플러스 쿠폰받기", bulletBase: "circle", schedule: "monthly-date", monthDay: 9, active: false, startDate: "2026-08-09" },
      { id: "m2", goalId: "quick", title: "  유플러스   쿠폰받기 ", bulletBase: "circle", schedule: "monthly-date", monthDay: 9, active: true, startDate: "2026-08-01" },
      { id: "m3", goalId: "quick", title: "관리비 납부", bulletBase: "circle", schedule: "monthly-date", monthDay: 9, active: true, startDate: "2026-08-01" },
    ],
  },
  pages: [{
    id: "day",
    pageDate: "2026-08-09",
    elements: [
      { id: "e1", type: "text", missionId: "m1", missionDate: "2026-08-09", layoutTarget: "daily-todo" },
      { id: "e2", type: "text", missionId: "m2", missionDate: "2026-08-09", layoutTarget: "daily-todo" },
      { id: "e3", type: "text", missionId: "m3", missionDate: "2026-08-09", layoutTarget: "daily-todo" },
    ],
  }],
  calendarEvents: [
    { id: "old-1", date: "2026-08-09", title: "유플러스 쿠폰받기", missionId: "m1" },
    { id: "old-2", date: "2026-08-09", title: "유플러스 쿠폰받기", missionId: "m2", status: "completed" },
    { id: "old-3", date: "2026-09-09", title: "유플러스 쿠폰받기", missionId: "m2" },
    { id: "other", date: "2026-08-09", title: "관리비 납부", missionId: "m3" },
  ],
};

assert.equal(context.dedupeDuplicatedMissions(book), 1);
assert.equal(book.goalSystem.missions.length, 2);
assert.equal(book.goalSystem.missions[0].active, true);
assert.equal(book.goalSystem.missions[0].startDate, "2026-08-01");
assert.equal(book.pages[0].elements.length, 2);
assert.equal(book.calendarEvents.length, 3);
assert.equal(book.calendarEvents.find(event => event.date === "2026-08-09" && event.missionId === "m1")?.status, "completed");
assert.equal(book.calendarEvents.find(event => event.date === "2026-09-09")?.id, "mission-event-m1-2026-09-09");
assert.notEqual(
  context.missionDuplicateSignature(book.goalSystem.missions[0]),
  context.missionDuplicateSignature(book.goalSystem.missions[1])
);

const removalBook = {
  goalSystem: {
    missions: [
      { id: "monthly", title: "유플러스 쿠폰받기" },
      { id: "keep", title: "관리비 납부" },
    ],
  },
  calendarEvents: [
    { id: "past", date: "2026-07-09", missionId: "monthly" },
    { id: "today", date: "2026-08-09", missionId: "monthly" },
    { id: "future", date: "2026-09-09", missionId: "monthly" },
    { id: "other", date: "2026-08-09", missionId: "keep" },
  ],
  pages: [
    {
      id: "past-page",
      pageDate: "2026-07-09",
      elements: [{ id: "past-row", missionId: "monthly", missionDate: "2026-07-09" }],
    },
    {
      id: "today-page",
      pageDate: "2026-08-09",
      elements: [{ id: "today-row", missionId: "monthly", missionDate: "2026-08-09" }],
    },
    {
      id: "future-page",
      pageDate: "2026-09-09",
      elements: [{ id: "future-row", missionId: "monthly", missionDate: "2026-09-09" }],
    },
    {
      id: "undated-page",
      elements: [{ id: "undated-row", missionId: "monthly" }],
    },
  ],
};

assert.equal(context.removeMissionsFromDate(removalBook, new Set(["monthly"]), "2026-08-09"), 1);
assert.deepEqual(removalBook.goalSystem.missions.map(mission => mission.id), ["keep"]);
assert.deepEqual(removalBook.calendarEvents.map(event => event.id), ["past", "other"]);
assert.equal(removalBook.pages[0].elements.length, 1);
assert.equal(removalBook.pages[1].elements.length, 0);
assert.equal(removalBook.pages[2].elements.length, 0);
assert.equal(removalBook.pages[3].elements.length, 1);

console.log("Routine dedupe regression test passed.");