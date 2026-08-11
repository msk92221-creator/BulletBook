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

const dateFromIso = value => {
  const [year, month, day] = String(value).split("-").map(Number);
  return new Date(year, month - 1, day);
};
const isoDate = date => [
  date.getFullYear(),
  String(date.getMonth() + 1).padStart(2, "0"),
  String(date.getDate()).padStart(2, "0"),
].join("-");
const mondayOf = value => {
  const date = new Date(value);
  const day = date.getDay();
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
  return date;
};
const normalizedDateOrBlank = value => {
  const text = String(value || "");
  return /^\d{4}-\d{2}-\d{2}$/u.test(text) ? text : "";
};
const context = vm.createContext({
  clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
  dateFromIso,
  isoDate,
  mondayOf,
  normalizedDateOrBlank,
  weekNumberForMonday: value => Math.floor((mondayOf(value).getDate() - 1) / 7) + 1,
  monthlyDateContext: page => ({
    year: Number(page.year),
    month: Number(page.month),
    hasCalendarDate: Number.isInteger(Number(page.year)) && Number.isInteger(Number(page.month)),
  }),
  isYearCalendarTemplate: value => /^year-calendar-/u.test(String(value || "")),
  isWeeklyPage: page => page?.type === "weekly-left" || page?.type === "weekly-right",
});
const names = [
  "groupPathForId",
  "normalizeGroupPageOrder",
  "pruneEmptyPageGroups",
  "canonicalCalendarGroup",
  "repairLegacyCalendarGroupHierarchy",
];
vm.runInContext(
  names.map(extractFunction).join("\n") +
  `\n${names.map(name => `this.${name} = ${name};`).join("\n")}`,
  context
);

const value = {
  createdAt: "2026-01-01T00:00:00.000Z",
  groups: [
    { id: "orphan-week-a", name: "1주차", kind: "week", parentId: null, weekStart: "2026-08-03" },
    { id: "orphan-week-b", name: "1주차", kind: "week", parentId: null, weekStart: "2026-08-03" },
    { id: "empty-week", name: "5주차", kind: "week", parentId: null, weekStart: "2026-07-27" },
  ],
  pages: [
    { id: "cover", type: "cover", groupId: null, elements: [] },
    { id: "feedback", type: "feedback", groupId: null, elements: [{ id: "note" }] },
    { id: "daily", type: "daily", pageDate: "2026-08-09", groupId: "orphan-week-a", elements: [{ id: "daily-note" }] },
    { id: "weekly", type: "weekly-left", weekStart: "2026-08-03", groupId: "orphan-week-b", elements: [{ id: "weekly-note" }] },
    { id: "annual", type: "blank", planTemplate: "year-calendar-m01", year: 2026, groupId: null, elements: [] },
    { id: "monthly", type: "monthly", year: 2026, month: 8, groupId: null, elements: [] },
  ],
};

assert.equal(context.repairLegacyCalendarGroupHierarchy(value), true);
assert.equal(value.calendarGroupHierarchyVersion, 1);
assert.equal(value.__calendarGroupsRepaired, true);
assert.deepEqual(
  [...value.pages].map(page => page.id),
  ["cover", "annual", "monthly", "daily", "weekly", "feedback"]
);
assert.equal(value.pages.find(page => page.id === "daily").elements[0].id, "daily-note");
assert.equal(value.pages.find(page => page.id === "weekly").elements[0].id, "weekly-note");
assert.equal(value.pages.find(page => page.id === "annual").groupId, "calendar-year-2026");
assert.equal(value.pages.find(page => page.id === "monthly").groupId, "calendar-month-2026-08");
assert.equal(value.pages.find(page => page.id === "daily").groupId, "calendar-week-2026-08-03");
assert.equal(value.pages.find(page => page.id === "weekly").groupId, "calendar-week-2026-08-03");
assert.deepEqual(
  [...value.groups].map(group => [group.id, group.parentId]).sort((left, right) => left[0].localeCompare(right[0])),
  [
    ["calendar-month-2026-08", "calendar-year-2026"],
    ["calendar-week-2026-08-03", "calendar-month-2026-08"],
    ["calendar-year-2026", null],
  ]
);
const stable = JSON.stringify(value);
assert.equal(context.repairLegacyCalendarGroupHierarchy(value), false);
assert.equal(JSON.stringify(value), stable);
console.log("Legacy calendar group hierarchy repair: ok");
