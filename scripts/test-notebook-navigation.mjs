import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
function extract(name) {
  const start = source.indexOf(`  function ${name}(`);
  assert.notEqual(start, -1);
  const next = source.indexOf("\n  function ", start + 1);
  return source.slice(start, next);
}
const groups = [{ id: "year", name: "2026년" }, { id: "week", parentId: "year", name: "2주차" }];
const pages = [{ id: "a", title: "작업 메모", groupId: "week", pageDate: "2026-10-09", elements: [{ text: "기존 기록" }] }];
const before = JSON.stringify({ groups, pages });
const context = vm.createContext({
  book: { groups, pages },
  pageDisplayTitle: page => page.title,
  dateFromIso: value => new Date(`${value}T00:00:00`),
  isoDate: date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
  isAndroidApp: true, viewMode: "auto", ANDROID_SPREAD_MIN_WIDTH: 600,
  refs: { viewport: { clientWidth: 840 } },
  window: { innerWidth: 840, visualViewport: { width: 840 }, BulletBookNative: { getWindowWidthDp: () => 390 } },
});
vm.runInContext(["groupPathForId", "notebookPageMatches", "shiftNotebookMonth", "androidWindowWidthDp", "isSpreadView"].map(extract).join("\n"), context);
assert.equal(context.notebookPageMatches(pages[0], " 2026년 "), true);
assert.equal(context.notebookPageMatches(pages[0], "2주차"), true);
assert.equal(context.notebookPageMatches(pages[0], "20261009"), true);
assert.equal(context.notebookPageMatches(pages[0], "없는 제목"), false);
assert.equal(JSON.stringify({ groups, pages }), before, "navigation and filtering must not modify records or order");
assert.equal(context.shiftNotebookMonth("2026-01-31", 1), "2026-02-28");
assert.equal(context.shiftNotebookMonth("2024-01-31", 1), "2024-02-29");
assert.equal(context.shiftNotebookMonth("2026-12-31", 1), "2027-01-31");
assert.equal(context.shiftNotebookMonth("2026-01-31", -1), "2025-12-31");
assert.equal(context.isSpreadView(), false, "native folded width wins over wider web viewport");
context.window.BulletBookNative.getWindowWidthDp = () => 840;
assert.equal(context.isSpreadView(), true);
context.viewMode = "single";
assert.equal(context.isSpreadView(), false, "explicit single-page preference survives unfolding");
context.viewMode = "spread";
context.window.BulletBookNative.getWindowWidthDp = () => 390;
assert.equal(context.isSpreadView(), true, "explicit spread preference survives folding");
context.viewMode = "auto";
context.isAndroidApp = false;
assert.equal(context.isSpreadView(), false);
context.refs.viewport.clientWidth = 1030;
assert.equal(context.isSpreadView(), true);
console.log("Notebook search, month boundaries, record preservation and Fold view preferences: ok");
