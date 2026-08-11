import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const [source, markup, styles] = await Promise.all([
  readFile(new URL("../app.js", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../styles.css", import.meta.url), "utf8"),
]);

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

let sequence = 0;
const dailyTarget = {
  id: "daily-todo",
  label: "할 일",
  x: 58,
  width: 246,
  yStart: 202,
  rowGap: 42,
  maxRows: 3,
  fontSize: 16,
  color: "#172033",
};
const page = {
  id: "daily-root",
  type: "daily",
  title: "",
  pageDate: "2026-08-11",
  groupId: "week-group",
  templateText: {},
  _targets: [dailyTarget],
  elements: [
    { id: "first", type: "text", text: "• 첫 번째", x: 48, y: 192, width: 240, height: 24, gridLocked: true, layoutTarget: "daily-todo" },
    { id: "second", type: "text", text: "• 두 번째", x: 48, y: 192, width: 240, height: 24, gridLocked: true, layoutTarget: "daily-todo" },
  ],
};
const context = vm.createContext({
  PAGE_W: 672,
  PAGE_H: 1008,
  GRID_SIZE: 24,
  book: { pages: [page], groups: [] },
  clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
  snapToGrid: (value, min = 0, max = Number.POSITIVE_INFINITY) =>
    Math.max(min, Math.min(max, Math.round((Number(value) || 0) / 24) * 24)),
  snapSizeToGrid: value => Math.max(24, Math.round((Number(value) || 24) / 24) * 24),
  rectsOverlap: (left, right) =>
    left.x < right.x + right.width && left.x + left.width > right.x &&
    left.y < right.y + right.height && left.y + left.height > right.y,
  dailyColumnEventRects: () => [],
  weeklyColumnEventRects: () => [],
  isWeeklyPage: candidate => candidate?.type === "weekly-left" || candidate?.type === "weekly-right",
  clone: value => JSON.parse(JSON.stringify(value)),
  uid: () => `generated-${++sequence}`,
  makePage: (type, title, extra = {}) => ({
    id: `generated-${++sequence}`,
    type,
    title,
    elements: [],
    templateText: {},
    createdAt: "2026-08-11T00:00:00.000Z",
    ...extra,
  }),
  pageTitleTemplateField: () => "x.daily-title",
  weeklyPageTitle: candidate => `주간 계획${candidate.continuationIndex ? ` · 계속 ${candidate.continuationIndex + 1}` : ""}`,
  mobileWriteTargetsForPage: candidate => candidate._targets || [],
});

const names = [
  "groupPathForId",
  "normalizeGroupPageOrder",
  "pruneEmptyPageGroups",
  "continuationPageNumber",
  "continuedPageLabel",
  "mobileTextCharacterWidth",
  "mobileTextWrappedLineCount",
  "mobileTextHeight",
  "nextMobileWriteSlot",
  "weeklyPairPages",
  "weeklyDateLinkedPages",
  "reflowMobileWriteTarget",
  "mobileWriteContinuationChain",
  "createMobileWriteContinuationPage",
  "mobileWriteDestination",
];
vm.runInContext(
  names.map(extractFunction).join("\n") +
  `\n${names.map(name => `this.${name} = ${name};`).join("\n")}`,
  context
);

assert.equal(context.reflowMobileWriteTarget(page, dailyTarget), true);
assert.deepEqual(page.elements.map(element => element.y), [192, 240]);

const third = context.mobileWriteDestination(page, dailyTarget, "• 세 번째");
assert.equal(third.created, false);
assert.equal(third.page.id, "daily-root");
assert.equal(third.slot.y, 288);
page.elements.push({
  id: "third",
  type: "text",
  text: "• 세 번째",
  gridLocked: true,
  layoutTarget: "daily-todo",
  ...third.slot,
});

const fourth = context.mobileWriteDestination(page, dailyTarget, "• 네 번째");
assert.equal(fourth.created, true);
assert.equal(fourth.page.type, "daily");
assert.equal(fourth.page.pageDate, "2026-08-11");
assert.equal(fourth.page.groupId, "week-group");
assert.equal(fourth.page.continuationOf, "daily-root");
assert.equal(fourth.page.continuationIndex, 1);
assert.equal(fourth.page.elements.length, 0);
assert.equal(fourth.slot.y, 192);
assert.equal(context.continuedPageLabel(fourth.page, "8월 11일(화)"), "8월 11일(화) · 계속 2");
assert.deepEqual(context.book.pages.map(candidate => candidate.id), ["daily-root", fourth.page.id]);
const longTarget = { ...dailyTarget, id: "daily-log", label: "오늘의 기록", maxRows: 10 };
const longPage = {
  id: "daily-long",
  type: "daily",
  title: "",
  pageDate: "2026-08-12",
  groupId: "week-group",
  templateText: {},
  _targets: [longTarget],
  elements: [],
};
context.book.pages.push(longPage);
const longKoreanText = "− 오늘의 기록에서 글자 폭과 줄바꿈을 실제 높이에 맞춰 안전하게 배치합니다";
const longFirst = context.mobileWriteDestination(longPage, longTarget, longKoreanText);
assert.equal(longFirst.page.id, "daily-long");
assert.ok(longFirst.slot.height > 48, "long Korean text must reserve more than one row");
longPage.elements.push({
  id: "long-first",
  type: "text",
  text: longKoreanText,
  gridLocked: true,
  layoutTarget: "daily-log",
  ...longFirst.slot,
});
const longSecond = context.mobileWriteDestination(longPage, longTarget, "− 다음 기록");
assert.equal(longSecond.page.id, "daily-long");
assert.ok(
  longSecond.slot.y >= longFirst.slot.y + longFirst.slot.height,
  "the next record must start below the rendered text height"
);

const weeklyTarget = {
  id: "weekly-overview",
  label: "주간 종합 계획",
  x: 58,
  width: 556,
  yStart: 174,
  rowGap: 31,
  maxRows: 3,
  fontSize: 15,
  color: "#172033",
};
const weeklyLeft = {
  id: "weekly-left",
  type: "weekly-left",
  weeklyPairId: "weekly-pair",
  weekStart: "2026-08-10",
  weekNumber: "33",
  groupId: "week-group",
  templateText: {},
  _targets: [weeklyTarget],
  elements: [0, 1, 2].map(index => ({
    id: `overview-${index}`,
    type: "text",
    text: `• 종합 ${index + 1}`,
    x: 48,
    y: 168 + index * 24,
    width: 552,
    height: 24,
    gridLocked: true,
    layoutTarget: "weekly-overview",
  })),
};
const weeklyRight = {
  id: "weekly-right",
  type: "weekly-right",
  weeklyPairId: "weekly-pair",
  weekStart: "2026-08-10",
  weekNumber: "33",
  groupId: "week-group",
  templateText: {},
  _targets: [],
  elements: [],
};
context.book.pages.push(weeklyLeft, weeklyRight);
const weeklyOverflow = context.mobileWriteDestination(weeklyLeft, weeklyTarget, "• 종합 4");
assert.equal(weeklyOverflow.created, true);
assert.equal(weeklyOverflow.page.type, "weekly-left");
assert.equal(weeklyOverflow.page.weekStart, "2026-08-10");
assert.equal(weeklyOverflow.page.continuationOf, "weekly-left");
const weeklyIds = context.book.pages.map(candidate => candidate.id);
assert.ok(weeklyIds.indexOf("weekly-right") < weeklyIds.indexOf(weeklyOverflow.page.id));

const projectPage = {
  id: "project-root",
  type: "blank",
  title: "프로젝트 계획",
  planTemplate: "project",
  calendarPairId: "must-not-be-copied",
  groupId: "project-group",
  templateText: { "project-subtitle": "나만의 기준" },
  elements: [{ id: "project-entry", type: "text", text: "기존 기록" }],
};
context.book.pages.push(projectPage);
const projectCopy = context.createMobileWriteContinuationPage(projectPage);
assert.equal(projectCopy.type, "blank");
assert.equal(projectCopy.planTemplate, "project");
assert.equal(projectCopy.groupId, "project-group");
assert.equal(projectCopy.continuationOf, "project-root");
assert.equal(projectCopy.calendarPairId, undefined);
assert.equal(projectCopy.elements.length, 0);
assert.equal(Object.keys(projectCopy.templateText).length, 0);
assert.equal(context.createMobileWriteContinuationPage({ id: "cover", type: "cover" }), null);

const groupedBook = {
  groups: [
    { id: "year", parentId: null },
    { id: "month", parentId: "year" },
    { id: "empty-parent", parentId: null },
    { id: "empty-child", parentId: "empty-parent" },
    { id: "empty-custom", parentId: null },
  ],
  pages: [
    { id: "cover", type: "cover", groupId: null },
    { id: "annual", type: "blank", groupId: "year" },
    { id: "month-page", type: "monthly", groupId: "month" },
  ],
};
const removedGroups = context.pruneEmptyPageGroups(groupedBook);
assert.deepEqual([...removedGroups].sort(), ["empty-child", "empty-custom", "empty-parent"]);
assert.deepEqual(groupedBook.groups.map(group => group.id), ["year", "month"]);
assert.deepEqual(
  [...context.normalizeGroupPageOrder(groupedBook.pages, groupedBook.groups)]
    .map(candidate => candidate.id),
  ["cover", "annual", "month-page"],
  "a page placed first in a parent group must remain above its child groups"
);

assert.match(markup, /id="mobilePageWriteAddContinuationButton"/u);
assert.doesNotMatch(markup, /id="mobilePageWriteAddContinuationButton"[^>]*hidden/u);
assert.match(source, /sourcePage\.type === "cover"/u);
assert.match(source, /drop\.bookStart/u);
assert.match(source, /pruneEmptyBookGroups/u);
assert.match(styles, /\.page-list-top-drop-zone/u);
assert.match(source, /mobilePageWriteAddContinuationButton\.addEventListener/u);
assert.match(styles, /\.mobile-bottom-nav small\s*\{[\s\S]*?white-space:\s*nowrap;/u);
assert.match(styles, /\.page-write-nav-button small::after\s*\{[\s\S]*?content:\s*"페이지 쓰기";/u);
console.log("Mobile write sequential layout and continuation regression test passed.");
