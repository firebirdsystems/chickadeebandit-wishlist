// @vitest-environment jsdom
/**
 * Does the page actually run?
 *
 * Nothing executed src/index.html until this file. `build.mjs` runs
 * `node --check`, which only parses, and every other test imports the small
 * modules beside it — so roughly seven hundred lines of app code, including all
 * the wiring, had no execution coverage at all.
 *
 * That was not theoretical. A refactor replaced a lazy `(html, kind) =>
 * modal.open(html, kind)` with an eager `modal.open` in a deps object declared
 * ABOVE `const modal`, which is a temporal-dead-zone ReferenceError at module
 * evaluation: the whole script aborted before first render and the app showed a
 * blank page. Ninety-five tests passed. A second refactor deleted a `const` a
 * throw still referenced.
 *
 * Both are module-evaluation and first-render failures, which is exactly what
 * this file covers: import the page's script and watch it come up. It runs in
 * DEMO mode (no injected URLs), so there is no network and no hub — the point
 * is that the module evaluates, wires itself together and paints.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

// Paths off cwd, not import.meta.url: under the jsdom environment that is an
// http:// URL, which node:fs will not take.
const srcDir = resolve(process.cwd(), "src");
const html = readFileSync(resolve(srcDir, "index.html"), "utf-8");

/**
 * The page's script lives inline, so it is written out beside its siblings —
 * relative imports (./logic.js, ./share.js, ./modal.js) have to resolve the way
 * they do in the browser, and "/hub-sdk.js" is aliased to a stub in
 * vitest.config.mjs. The file is temporary and removed afterwards.
 */
const MODULE = resolve(srcDir, "__boot.generated.mjs");

function inlineModule() {
  const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  if (!m) throw new Error("no inline module found in index.html");
  return m[1];
}

beforeAll(() => writeFileSync(MODULE, inlineModule()));
afterAll(() => { try { unlinkSync(MODULE); } catch { /* already gone */ } });
/**
 * Evaluate the page's script afresh. The query string defeats the ESM cache:
 * without it the module runs once for the whole file, its init IIFE paints into
 * whichever test happened to be first, and every later test inspects a DOM that
 * nothing has rendered into since.
 */
let boots = 0;
const boot = () => import(`${pathToFileURL(MODULE).href}?boot=${++boots}`);

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div><div id="toast"></div>';
  // Demo mode: the page short-circuits every read to its built-in sample data.
  for (const k of ["__CONTEXT_URL", "__DB_URL", "__EVENTS_URL",
                   "__SHARE_CREATE_URL", "__SHARE_REVOKE_URL", "__SHARE_LIST_URL"]) {
    window[k] = "";
  }
  window.__APP_ID = "wishlist";
  window.__CURRENT_MEMBER = null;
  globalThis.__hubAlerts = [];
});

/** Boot with a database configured, answering every statement from `reply`. */
async function bootWithDb(reply) {
  window.__DB_URL = "/api/db";
  window.__CURRENT_MEMBER = { id: "adult-1", name: "Alex", role: "adult", isAdmin: false };
  globalThis.fetch = async (_url, init) => {
    const { sql } = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => reply(sql) };
  };
  await boot();
  await new Promise((r) => setTimeout(r, 0));
}

describe("saving an item through the page", () => {
  const ITEM = {
    id: "x1", member_id: "adult-1", name: "Trainers", description: "", url: "",
    priority: "medium", visibility: "everyone", created_at: "2026-01-01T00:00:00Z",
  };

  // The row is gone — deleted on another device, or excluded by the owner
  // guard in the WHERE. The statement RAN, so the hub answers 200; only
  // `changed` says otherwise, and the member must be told rather than shown a
  // modal closing over an edit that never saved.
  it("reports an edit whose row no longer exists", async () => {
    await bootWithDb((sql) =>
      sql.startsWith("SELECT") ? { rows: [ITEM] } : { rows: [], changed: 0 });

    window.editItem("x1");
    document.getElementById("f-name").value = "Trainers, blue";
    await window.submitItem();

    const err = document.getElementById("f-error");
    expect(err.textContent).toContain("no longer on your list");
    // and the editor stays open over the unsaved edit
    expect(document.querySelector(".modal-backdrop")).not.toBeNull();
  });

  // Leaving the phantom rendered meant every retry edited a row that was not
  // there and failed the same way, with no way out but a reload.
  it("takes the vanished item off the list", async () => {
    await bootWithDb((sql) =>
      sql.startsWith("SELECT") ? { rows: [ITEM] } : { rows: [], changed: 0 });
    expect(document.getElementById("root").textContent).toContain("Trainers");

    window.editItem("x1");
    await window.submitItem();
    window.closeModal();

    expect(document.getElementById("root").textContent).not.toContain("Trainers");
  });

  // `errEl` and `btn` are captured before the await. If the member opened
  // something else meanwhile, those nodes are detached and writing to them
  // reports the failure to nobody.
  it("does not report a failure into a modal that has been replaced", async () => {
    await bootWithDb((sql) =>
      sql.startsWith("SELECT") ? { rows: [ITEM] } : { error: "Over the storage quota" });

    window.editItem("x1");
    const submitting = window.submitItem();
    window.openAddModal();                       // a different modal takes over
    await submitting;

    // The add-item form is untouched: no error text bled into it...
    expect(document.getElementById("f-error").style.display).not.toBe("block");
    expect(document.querySelector(".modal-backdrop").textContent).toContain("Add to Wish List");
    // ...and the failure was still reported somewhere the member can see it,
    // rather than written into the detached node the submit had captured.
    expect(globalThis.__hubAlerts.join(" ")).toContain("Over the storage quota");
  });

  it("closes the editor when the edit really saved", async () => {
    await bootWithDb((sql) =>
      sql.startsWith("SELECT") ? { rows: [ITEM] } : { rows: [], changed: 1 });

    window.editItem("x1");
    document.getElementById("f-name").value = "Trainers, blue";
    await window.submitItem();

    expect(document.querySelector(".modal-backdrop")).toBeNull();
    expect(document.getElementById("root").textContent).toContain("Trainers, blue");
  });

  // The hub's refusals carry the text worth showing.
  it("surfaces the hub's own refusal verbatim", async () => {
    await bootWithDb((sql) =>
      sql.startsWith("SELECT") ? { rows: [ITEM] } : { error: "Over the storage quota" });

    window.editItem("x1");
    await window.submitItem();
    expect(document.getElementById("f-error").textContent).toContain("Over the storage quota");
  });
});

describe("the page boots", () => {
  it("evaluates its module without throwing", async () => {
    // A TDZ error, a missing import or a deleted const all land here.
    await expect(boot()).resolves.toBeTruthy();
  });

  it("renders the wish list into #root", async () => {
    await boot();
    await new Promise((r) => setTimeout(r, 0));   // the init IIFE is async
    const root = document.getElementById("root");
    expect(root.innerHTML).not.toBe("");
    expect(root.textContent).toContain("Wish List");
  });

  it("wires up the handlers the markup calls by name", async () => {
    await boot();
    // These are invoked from inline onclick attributes, so a rename or a lost
    // window binding is invisible to every other kind of test.
    for (const fn of ["setTab", "selectBrowseMember", "openAddModal",
                      "submitItem", "editItem", "deleteItem", "closeModal"]) {
      expect(typeof window[fn], `window.${fn}`).toBe("function");
    }
  });

  it("opens the add-item modal without throwing", async () => {
    await boot();
    await new Promise((r) => setTimeout(r, 0));
    window.openAddModal();
    expect(document.querySelector(".modal-backdrop")).not.toBeNull();
    expect(document.getElementById("f-name")).not.toBeNull();
    window.closeModal();
    expect(document.querySelector(".modal-backdrop")).toBeNull();
  });
});
