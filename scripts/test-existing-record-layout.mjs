import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
const extract = name => {
  const start = source.indexOf(`  function ${name}(`);
  assert.notEqual(start, -1, name);
  return source.slice(start, source.indexOf("\n  function ", start + 1));
};
export const context = vm.createContext({
  PAGE_W: 672, PAGE_H: 1224, GRID_SIZE: 24,
  clamp: (n, min, max) => Math.min(max, Math.max(min, n)),
  snapToGrid: (n, min = 0, max = Infinity) => Math.min(max, Math.max(min, Math.round(n / 24) * 24)),
  snapSizeToGrid: n => Math.max(24, Math.round(n / 24) * 24),
  rectsOverlap: (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y,
  isWeeklyPage: p => ["weekly-left", "weekly-right"].includes(p.type),
  isYearCalendarTemplate: t => /^year-calendar-/u.test(t || ""),
  yearCalendarMonths: p => p.months || [1],
  normalizedDateOrBlank: date => /^\d{4}-\d{2}-\d{2}$/u.test(date || "") ? date : "",
  normalizedWeekStart: date => date || "",
  dateFromIso: date => new Date(`${date}T00:00:00`),
  monthlyDateContext: p => ({ year: p.year, month: p.month, hasCalendarDate: !!p.year && !!p.month }),
  commitHistory() {}, renderAll() {}, showToast() {}, refs: { mobileMoreDialog: { close() {} } },
});
vm.runInContext(["isoDate", "offsetDate", "dayLabel", "calendarEventsForDate", "mobileWriteTargetsForPage",
  "mobileTextCharacterWidth", "mobileTextWrappedLineCount", "existingRecordTarget", "existingRecordBottom", "existingRecordPlacements",
  "alignExistingTemplateRecords", "restoreOriginalRecordLayout"].map(extract).join("\n"), context);
const text = (id, extra = {}) => ({ id, type: "text", text: `• ${id} 기존 기록`, x: 48, y: 192,
  width: 240, height: 24, fontSize: 16, color: "#123456", ...extra });
const page = (id, type, elements, extra = {}) => ({ id, type, groupId: "same-group", elements,
  templateText: { heading: "직접 고친 제목" }, ...extra });
const record = {
  groups: [{ id: "same-group" }],
  calendarEvents: [{ id: "event", date: "2026-10-10", title: "원래 일정", column: "daily-todo" }],
  pages: [
    page("day", "daily", [text("late", { y: 480 }), text("early", { y: 216 }),
      text("log", { x: 360, y: 220, layoutTarget: "daily-log", text: "− 긴 한국어 기록을 여러 줄로 표시하면서 뒤의 내용과 겹치지 않도록 보존합니다.\n둘째 문단도 그대로 둡니다." }),
      text("log2", { x: 384, y: 240, layoutTarget: "daily-log" }),
      { id: "ink", type: "stroke", points: [[1, 2], [3, 4]], color: "red" },
      text("heading", { y: 40 }), text("empty", { text: "", width: 18 })], { pageDate: "2026-10-10" }),
    page("week", "weekly-left", [text("summary", { x: 55, y: 184, width: 556, fontSize: 15 }),
      text("monday", { x: 24, y: 350, width: 144, layoutTarget: "weekly-day-0", missionId: "routine", missionDate: "2026-10-05" })], { weekStart: "2026-10-05" }),
    page("month", "monthly", [text("day5", { x: 120, y: 288, width: 264, fontSize: 12, text: "− 기존 메모" }),
      text("goal", { x: 456, y: 260, width: 168, layoutTarget: "monthly-goal" })], { year: 2026, month: 10 }),
    page("custom", "blank", [text("free", { x: 225, y: 370, width: 340 })]),
    page("overflow", "daily", [text("large", { layoutTarget: "daily-log", x: 384, text: "긴 기록\n".repeat(100) })], { pageDate: "2026-10-09" }),
    page("new", "daily", [text("recent", { templateLayoutVersion: 1, x: 72, y: 600 })], { pageDate: "2026-10-11" }),
  ],
};
const original = structuredClone(record);
const content = value => ({ groups: value.groups, events: value.calendarEvents,
  pages: value.pages.map(p => ({ ...p, elements: p.elements.map(e => Object.fromEntries(Object.entries(e)
    .filter(([key]) => !["x", "y", "width", "height", "gridLocked", "layoutTarget", "templateLayoutVersion", "templateLayoutOriginal"].includes(key)))) })) });
assert.equal(context.alignExistingTemplateRecords(record), 8);
assert.deepEqual(content(record), content(original), "all content, dates, IDs, styles, routines, annotations and pages must survive");
const daily = record.pages[0].elements;
assert.ok(daily.find(e => e.id === "early").y < daily.find(e => e.id === "late").y, "preserve original reading order");
assert.ok(daily.find(e => e.id === "early").y >= 216, "leave a row for the existing calendar event");
const log = daily.find(e => e.id === "log");
assert.equal(log.x, 384);
assert.ok(daily.find(e => e.id === "log2").y >= log.y + log.height, "long text must not overlap the next record");
assert.equal(record.pages[2].elements[0].y, 292, "monthly text stays on the same fifth-day row");
assert.deepEqual(record.pages[3], original.pages[3], "unclassified free notes stay where the user put them");
assert.deepEqual(record.pages[4], original.pages[4], "overflow must not be clipped, split, deleted or moved to another page");
assert.deepEqual(record.pages[5], original.pages[5], "new records and deliberate edits are not migrated again");
const persisted = JSON.parse(JSON.stringify(record));
assert.equal(context.alignExistingTemplateRecords(persisted), 0);
assert.deepEqual(persisted, JSON.parse(JSON.stringify(record)), "save/reopen and cloud normalization must be idempotent");
context.book = persisted;
context.restoreOriginalRecordLayout();
for (let i = 0; i < original.pages.length; i++) {
  assert.deepEqual(persisted.pages[i].elements.map(({ templateLayoutVersion, ...e }) => e),
    original.pages[i].elements.map(({ templateLayoutVersion, ...e }) => e), "restore must recover the exact original layout");
}
assert.equal(context.alignExistingTemplateRecords(persisted), 0, "restored positions must survive reopening");
const packed = { groups: [], calendarEvents: [], pages: [page("packed", "daily", [
  text("dense", { x: 360, layoutTarget: "daily-log", text: "가나다라마바사아자차카타파하".repeat(40) }),
], { pageDate: "2026-10-12" })] };
assert.equal(context.alignExistingTemplateRecords(packed), 1);
const fitted = packed.pages[0].elements[0];
assert.ok(fitted.fontSize >= 12 && fitted.fontSize < 16, "dense old records may shrink within a readable limit");
assert.ok(fitted.y + fitted.height <= 1224 - 58);
assert.equal(fitted.text, "가나다라마바사아자차카타파하".repeat(40));
assert.equal(fitted.templateLayoutOriginal.fontSize, 16, "original font size must also be recoverable");
const monthly = page("annotated-month", "monthly", [text("goal-note", { x: 432, y: 320, width: 168, layoutTarget: "monthly-goal" }),
  text("queue-note", { x: 432, y: 700, width: 168 })], { year: 2026, month: 10, templateText: { "x.monthly-goal-1": "직접 입력한 월간 목표" } });
assert.equal(context.alignExistingTemplateRecords({ pages: [monthly], groups: [], calendarEvents: [] }), 1);
assert.ok(monthly.elements[0].y >= 257 && monthly.elements[0].y + monthly.elements[0].height <= 370,
  "monthly records must avoid edited template text and the Queue heading");
assert.equal(monthly.elements[1].y, 700, "unlabelled Queue notes must not be reclassified as goals");
Object.assign(context, { monthlyDayCount: () => 31, calendarEventSummary: () => "○ 일정",
  fixedDateTitleBlock: () => "", escapeHtml: String });
vm.runInContext(extract("monthlyTemplate"), context);
const monthMarkup = context.monthlyTemplate("", page("month-render", "monthly", [text("goal", {
  x: 432, y: 240, width: 168, height: 48, gridLocked: true, layoutTarget: "monthly-goal",
})], { year: 2026, month: 10 }));
assert.equal((monthMarkup.match(/class="monthly-calendar-summary"/g) || []).length, 31,
  "a goal on the right must not hide calendar events on the left");
assert.match(monthMarkup, /data-template-key="monthly-goal-1"[^>]*visibility:hidden/u);
console.log("Existing record layout: template fields, long text, dates, events, routines, content preservation, overflow, reopen and restore passed.");
