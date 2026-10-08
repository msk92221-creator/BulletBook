import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, name);
  let depth = 0;
  for (let index = source.indexOf("{", start); index < source.length; index++) {
    if (source[index] === "{") depth++;
    if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Incomplete function: ${name}`);
}

let answer;
let lastPrompt;
let commits = 0;
const toasts = [];
const context = vm.createContext({
  Date: class extends Date {
    constructor(...args) { super(...(args.length ? args : [2026, 9, 9])); }
  },
  prompt: (message, initial) => { lastPrompt = { message, initial }; return answer; },
  showToast: message => toasts.push(message),
  book: { pages: [], groups: [] },
  currentIndex: 0,
  activePageId: "",
  isYearCalendarTemplate: () => false,
  ensureWeeklyPagePair: () => {},
  weekGroupForDate: date => ({ id: `week-${context.isoDate(context.mondayOf(date))}` }),
  makePage: (type, title, extra) => ({ type, title, elements: [], ...extra }),
  insertIndexForGroup: () => context.book.pages.length,
  materializeDueMissions: () => 0,
  commitHistory: () => { commits++; },
  renderAll: () => {},
  movePagesToStructuredGroup: (pages, group) => pages.forEach(page => { page.groupId = group.id; }),
  navigateToBookPage: page => { context.activePageId = page.id; },
});
const names = ["isoDate", "dateFromIso", "mondayOf", "offsetDate", "dailyDateLabel",
  "normalizedDateOrBlank", "promptIsoDate", "ensureDailyPage", "addTemplate",
  "setDailyPageDate", "editStructuredPageDate"];
vm.runInContext(names.map(extract).join("\n"), context);

for (const [input, expected] of [
  ["20261009", "2026-10-09"],
  [" 20260803 ", "2026-08-03"],
  ["2026-10-09", "2026-10-09"],
  ["20240229", "2024-02-29"],
  ["20000229", "2000-02-29"],
]) {
  answer = input;
  assert.equal(context.promptIsoDate("날짜"), expected);
  assert.equal(lastPrompt.initial, "20261009");
  assert.match(lastPrompt.message, /YYYYMMDD/);
}

for (const input of ["", "20260229", "19000229", "20260431", "20260009", "20261309",
  "20261000", "20261032", "2026109", "202610090", "2026/10/09", "2026-02-29", "2026abcd"]) {
  answer = input;
  const before = toasts.length;
  assert.equal(context.promptIsoDate("날짜"), null, input);
  assert.equal(toasts.length, before + 1);
}
answer = null;
const beforeCancel = toasts.length;
assert.equal(context.promptIsoDate("날짜"), null);
assert.equal(toasts.length, beforeCancel, "cancelling does not report an invalid date");

answer = "20261009";
context.addTemplate("daily");
assert.equal(context.book.pages.length, 1);
const page = context.book.pages[0];
assert.equal(page.pageDate, "2026-10-09", "storage remains compatible with calendars and sync");
assert.equal(page.groupId, "week-2026-10-05");
assert.equal(commits, 1);
page.elements.push({ type: "text", text: "기존 기록" });
answer = "2026-10-09";
context.addTemplate("daily");
assert.equal(context.book.pages.length, 1, "both input formats find the same existing page");
assert.equal(commits, 1);

answer = "20261012";
context.editStructuredPageDate(page, "daily");
assert.equal(lastPrompt.initial, "20261009");
assert.equal(page.pageDate, "2026-10-12");
assert.equal(page.groupId, "week-2026-10-12");
assert.equal(page.elements[0].text, "기존 기록");
assert.equal(commits, 2);
for (const input of ["20260229", null]) {
  answer = input;
  context.editStructuredPageDate(page, "daily");
  context.addTemplate("daily");
  assert.equal(page.pageDate, "2026-10-12");
  assert.equal(context.book.pages.length, 1);
  assert.equal(commits, 2);
}

answer = "20261231";
context.addTemplate("daily-week");
assert.deepEqual(Array.from(context.book.pages.slice(1), item => item.pageDate), [
  "2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03",
]);
assert.equal(new Set(context.book.pages.slice(1).map(item => item.groupId)).size, 1);

answer = "20261231";
context.editStructuredPageDate(page, "daily");
assert.equal(page.pageDate, "2026-10-12", "an existing target date does not overwrite either page");
assert.equal(context.activePageId, "calendar-day-2026-12-31");
assert.equal(commits, 3);
console.log("Plan dates passed: compact/legacy input, leap days, invalid/cancel, add/edit, duplicates, year-boundary week, record preservation.");
