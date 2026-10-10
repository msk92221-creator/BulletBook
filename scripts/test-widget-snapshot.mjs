import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
function extract(name) {
  const match = new RegExp(`(?:async )?function ${name}\\(`).exec(source);
  assert.ok(match, name);
  const start = match.index;
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`Incomplete function: ${name}`);
}

const book = {
  calendarEvents: [{ id: "saved", date: "2026-08-11", title: "기존 일정", status: "completed" }],
  goalSystem: { missions: [
    { id: "weekly", goalId: "g", active: true, title: "주간", schedule: "weekly", weeklyTarget: 1 },
    { id: "monthly", goalId: "g", active: true, title: "월말", schedule: "monthly-last" },
    { id: "leap", goalId: "g", active: true, title: "윤일", schedule: "yearly-date", yearMonth: 2, yearDay: 29 },
    { id: "custom", goalId: "g", active: true, title: "요일", schedule: "custom", weekdays: [1, 3] },
  ] },
};
let scans = 0;
let yields = 0;
let onYield = () => {};
const timers = new Map();
let timerId = 0;
const pushed = [];
const context = vm.createContext({
  book,
  Date: class extends Date {
    constructor(...args) { super(...(args.length ? args : [2026, 7, 11])); }
  },
  setTimeout: (fn, delay) => {
    if (!delay) {
      yields++;
      queueMicrotask(() => { onYield(); fn(); });
      return 0;
    }
    timers.set(++timerId, fn);
    return timerId;
  },
  clearTimeout: id => timers.delete(id),
  isAndroidApp: true,
  window: { BulletBookNative: { pushCalendarWidget: (_, json) => pushed.push(JSON.parse(json)) } },
  lastWidgetSnapshotJson: "", widgetNativeSequence: 0, widgetSyncTimer: null,
  widgetSnapshotGeneration: 0, saveRevision: 0,
  BULLET_SYMBOLS: { circle: { open: "○", completed: "⊗" }, dot: { open: "•" } },
  normalizedDateOrBlank: value => /^\d{4}-\d{2}-\d{2}$/.test(value || "") ? value : "",
  currentGoalSystem: () => book.goalSystem,
  goalForMission: () => ({ status: "active" }),
  completedMissionElements: () => { scans++; return [{ date: "2026-08-11" }]; },
  missionCompletionCount: (_, start, end) => start <= "2026-08-11" && end >= "2026-08-11" ? 1 : 0,
});
const names = ["isoDate", "offsetDate", "mondayOf", "weekRangeFor",
  "missionDuplicateSignature", "missionRunsOnDate", "missionsDueOn", "missionBulletText",
  "calendarEventText", "calendarEventSymbol", "addCalendarWidgetItem",
  "buildCalendarWidgetSnapshot", "syncCalendarWidget"];
vm.runInContext(names.map(extract).join("\n"), context);

const snapshot = await context.buildCalendarWidgetSnapshot();
assert.equal(scans, 1, "completed records are scanned once per weekly mission, not every projected day");
assert.ok(yields > 1, "projection yields so navigation/input can run");
const expected = {};
context.addCalendarWidgetItem(expected, "2026-08-11", "completed", "⊗ 기존 일정");
for (let date = new Date(2025, 0, 1); date <= new Date(2028, 11, 31); date = context.offsetDate(date, 1)) {
  for (const mission of context.missionsDueOn(date)) {
    context.addCalendarWidgetItem(expected, context.isoDate(date), "open", context.missionBulletText(mission));
  }
}
assert.equal(JSON.stringify(snapshot.days), JSON.stringify(expected));
assert.ok(snapshot.days["2028-02-29"].items.includes("• 윤일"));

async function runScheduled() {
  assert.equal(timers.size, 1);
  const [id, fn] = [...timers][0];
  timers.delete(id);
  await fn();
}
context.syncCalendarWidget();
context.syncCalendarWidget();
assert.equal(pushed.length, 0, "snapshot calculation must not block the caller");
await runScheduled();
assert.equal(pushed.length, 1);
context.syncCalendarWidget();
await runScheduled();
assert.equal(pushed.length, 1, "unchanged snapshots are not pushed again");

book.calendarEvents.push({ id: "new", date: "2026-08-12", title: "새 일정" });
context.syncCalendarWidget();
onYield = () => { context.saveRevision++; onYield = () => {}; };
await runScheduled();
assert.equal(pushed.length, 1, "an edit during projection cancels the stale snapshot");
context.syncCalendarWidget();
await runScheduled();
assert.equal(pushed.length, 2);
assert.ok(pushed[1].days["2026-08-12"].items.includes("○ 새 일정"));
console.log("Widget snapshot parity, yielding, caching and cancellation: ok");
context.familyCalendar={isConnected:()=>true,hides:id=>id==='event:saved',days:()=>({
  '2026-08-11':[{title:'가족이 수정한 일정',time:'12:30',status:'open'}],
  '2020-01-01':[{title:'과거 가족 일정',status:'open'}],
})};
const familySnapshot=await context.buildCalendarWidgetSnapshot();
assert.equal(familySnapshot.version,4);
assert.equal(familySnapshot.days['2026-08-11'].items.includes('⊗ 기존 일정'),false);
assert.equal(familySnapshot.days['2026-08-11'].items.includes('12:30 가족이 수정한 일정'),true);
assert.equal(familySnapshot.localDays['2020-01-01'],undefined);
assert.equal(familySnapshot.days['2020-01-01'].items[0],'과거 가족 일정');
console.log('Family widget overlay: linked local copies hidden, unsynced records retained, historical schedules present.');
