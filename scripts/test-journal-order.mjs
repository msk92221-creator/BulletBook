import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
const extract = name => {
  const start = source.indexOf(`  function ${name}(`);
  assert.notEqual(start, -1);
  return source.slice(start, source.indexOf("\n  function ", start + 1));
};
const context = vm.createContext({});
vm.runInContext(["groupPathForId", "normalizeGroupPageOrder"].map(extract).join("\n"), context);
const groups = [
  { id: "y26", kind: "year", year: 2026 }, { id: "y27", kind: "year", year: 2027 },
  { id: "m9", kind: "month", month: 9, parentId: "y26" },
  { id: "m10", kind: "month", month: 10, parentId: "y26" },
  { id: "w2", kind: "week", weekStart: "2026-10-05", parentId: "m10" },
  { id: "w3", kind: "week", weekStart: "2026-10-12", parentId: "m10" },
  { id: "custom", kind: "custom" },
];
const p = (id, type, groupId, extra = {}) => ({ id, type, groupId,
  elements: [{ id: `text-${id}`, type: "text", text: `보존할 ${id} 기록`, x: 24, y: 48 }],
  templateText: { heading: `수정한 ${id} 제목` }, ...extra });
const pages = [p("cover", "cover", null), p("index", "index", null),
  p("year27", "blank", "y27", { planTemplate: "year-calendar-m01", months: [1] }),
  p("day12", "daily", "w3", { pageDate: "2026-10-12" }),
  p("day10", "daily", "w2", { pageDate: "2026-10-10" }),
  p("monthly10", "monthly", "m10"),
  p("right", "weekly-right", "w2", { weeklyPairId: "pair" }),
  p("left-more", "weekly-left", "w2", { continuationOf: "left", continuationIndex: 1 }),
  p("day9-more", "daily", "w2", { pageDate: "2026-10-09", continuationOf: "day9", continuationIndex: 1 }),
  p("left", "weekly-left", "w2", { weeklyPairId: "pair" }),
  p("day9", "daily", "w2", { pageDate: "2026-10-09" }),
  p("week3", "weekly-left", "w3"),
  p("annual10", "blank", "y26", { planTemplate: "year-calendar-m10", months: [10] }),
  p("annual1", "blank", "y26", { planTemplate: "year-calendar-m01", months: [1] }),
  p("monthly9", "monthly", "m9"), p("noteB", "blank", "custom"), p("noteA", "blank", "custom")];
const before = JSON.stringify({ pages, groups });
const sorted = context.normalizeGroupPageOrder(pages, groups, true);
assert.deepEqual(Array.from(sorted, page => page.id), [
  "cover", "index", "annual1", "annual10", "monthly9", "monthly10", "left", "right", "left-more",
  "day9", "day9-more", "day10", "week3", "day12", "year27", "noteB", "noteA",
]);
assert.equal(JSON.stringify({ pages, groups }), before, "sorting must not mutate a single page, group or record");
assert.equal(new Set(sorted.map(page => page.id)).size, pages.length);
sorted.forEach(page => assert.equal(page, pages.find(original => original.id === page.id)));
assert.deepEqual(Array.from(context.normalizeGroupPageOrder(sorted, groups, true), page => page.id), Array.from(sorted, page => page.id), "reopening must keep the same order");
const added = p("day8", "daily", "w2", { pageDate: "2026-10-08" });
const withNewDay = context.normalizeGroupPageOrder([...sorted, added], groups, true);
assert.equal(withNewDay.findIndex(page => page.id === "day8") + 1, withNewDay.findIndex(page => page.id === "day9"));
const manual = context.normalizeGroupPageOrder(pages, groups, false);
assert.ok(manual.findIndex(page => page.id === "day10") < manual.findIndex(page => page.id === "left"), "explicit manual order stays available");
console.log("Journal hierarchy: real page order, new dates, weekly pairs, continuations, custom notes and record preservation passed.");
