import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");

function extractFunction(name) {
  const start = source.indexOf("function " + name + "(");
  assert.notEqual(start, -1, name + " must exist in app.js");
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(name + " body is incomplete");
}

const makeBook = () => ({
  groups: [
    { id: "year", name: "2026년", kind: "year", parentId: null },
    { id: "august", name: "8월", kind: "month", parentId: "year" },
    { id: "september", name: "9월", kind: "month", parentId: "year" },
  ],
  pages: [
    { id: "cover", type: "cover", groupId: null },
    { id: "annual-1", type: "blank", groupId: "year" },
    { id: "annual-2", type: "blank", groupId: "year" },
    { id: "august-page", type: "monthly", groupId: "august" },
    { id: "september-page", type: "monthly", groupId: "september" },
  ],
});

const context = vm.createContext({
  book: makeBook(),
  clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
  activePageId: "annual-1",
  currentIndex: 1,
  selection: null,
  selectedPageIds: new Set(),
  isWeeklyPage: page => page.type === "weekly-left" || page.type === "weekly-right",
  commitHistory: () => {},
  renderAll: () => {},
  showToast: () => {},
  pruneEmptyBookGroups: () => new Set(),
});
const names = [
  "groupPathForId",
  "groupDescendantIdSet",
  "canSetGroupParent",
  "normalizeGroupPageOrder",
  "syncGroupOrderToPageOrder",
  "orderedMovablePageIds",
  "movePagesToBookStart",
  "reorderGroupFromList",
];
vm.runInContext(
  names.map(extractFunction).join("\n") +
  "\n" + names.map(name => "this." + name + " = " + name + ";").join("\n"),
  context
);

assert.equal(context.reorderGroupFromList("august", {
  targetPageId: "annual-1",
  after: false,
  parentId: "year",
}), true);
assert.equal(context.book.groups.find(group => group.id === "august").parentId, "year");
assert.deepEqual(
  [...context.book.pages].map(page => page.id),
  ["cover", "august-page", "annual-1", "annual-2", "september-page"]
);

context.book = makeBook();
context.activePageId = "annual-1";
assert.equal(context.reorderGroupFromList("august", {
  nestIntoGroupId: "year",
  atStart: true,
}), true);
assert.equal(context.book.groups.find(group => group.id === "august").parentId, "year");
assert.deepEqual(
  [...context.book.pages].map(page => page.id),
  ["cover", "august-page", "annual-1", "annual-2", "september-page"]
);

context.book = makeBook();
context.activePageId = "annual-1";
assert.equal(context.reorderGroupFromList("august", {
  targetPageId: "annual-1",
  after: true,
  parentId: "year",
}), true);
assert.deepEqual(
  [...context.book.pages].map(page => page.id),
  ["cover", "annual-1", "august-page", "annual-2", "september-page"]
);


context.book = {
  groups: [
    { id: "year", name: "2026년", kind: "year", parentId: null },
    { id: "annual", name: "연간계획", kind: "custom", parentId: "year" },
  ],
  pages: [
    { id: "cover", type: "cover", groupId: null },
    { id: "index", type: "blank", groupId: "annual", elements: [{ text: "목차" }] },
    { id: "symbols", type: "blank", groupId: "annual", elements: [{ text: "기호" }] },
    { id: "annual-1", type: "blank", groupId: "annual" },
  ],
};
context.activePageId = "index";
context.selectedPageIds = new Set(["index", "symbols"]);
assert.equal(context.movePagesToBookStart(["symbols", "index"], true), true);
assert.deepEqual(
  [...context.book.pages].map(page => [page.id, page.groupId]),
  [
    ["cover", null],
    ["index", null],
    ["symbols", null],
    ["annual-1", "annual"],
  ]
);
assert.equal(context.book.pages[1].elements[0].text, "목차");
assert.equal(context.book.pages[2].elements[0].text, "기호");
assert.equal(context.selectedPageIds.size, 0);
console.log("Nested group page ordering: ok");
