import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
const start = source.indexOf("  async function init() {");
const end = source.indexOf("\n  init();", start);
assert.ok(start >= 0 && end > start);

for (const reject of [false, true]) {
  const calls = [];
  let settleCloud;
  const cloud = new Promise((resolve, rejectPromise) => {
    settleCloud = reject ? () => rejectPromise(new Error("offline")) : resolve;
  });
  const noop = () => {};
  const context = vm.createContext({
    console: { error: noop },
    setTimeout, clearTimeout,
    window: {
      BulletBookNative: { readyForWidgetNavigation: () => calls.push("widget-ready") },
      BulletBookCloudSync: { create: () => ({ restore: () => {
        calls.push("restore"); return cloud;
      } }) },
    },
    book: { title: "local", pages: [{ id: "daily" }] },
    refs: { bookTitle: {}, welcome: { showModal: () => calls.push("welcome") } },
    localStorage: { getItem: () => true }, WELCOME_KEY: "welcome",
    bindEvents: noop, loadSavedBook: async () => null, normalizeBook: value => value,
    createDefaultBook: () => { throw new Error("local book should load"); },
    ensureCalendarFeatureSetup: () => false, materializeDueMissions: () => 0,
    initializeHistory: noop, updateViewModeControls: noop,
    renderAll: () => calls.push("render"), markDirty: noop,
    clone: structuredClone, cloudSync: null,
    applyCloudBook: noop, normalizeValidatedBook: noop, isCompatibleBook: noop,
    isPristineBook: noop, isLocalDirty: noop, flushLocalChanges: noop,
    loadSyncBase: noop, persistSyncBase: noop, clearSyncBase: noop,
    saveRecoverySnapshot: noop, showToast: noop, updateCloudState: noop,
    showCloudAuthChallenge: noop, finishCloudAuthentication: noop,
    syncCalendarWidget: () => calls.push("snapshot"),
  });
  vm.runInContext(source.slice(start, end) + "\nthis.initialized = init();", context);
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(calls.includes("widget-ready"), "widget must navigate while OneDrive is still pending");
  assert.ok(calls.indexOf("render") < calls.indexOf("widget-ready"));
  assert.ok(calls.indexOf("widget-ready") < calls.indexOf("restore"));
  settleCloud();
  await context.initialized;
}
console.log("Widget startup does not wait for OneDrive: ok");
