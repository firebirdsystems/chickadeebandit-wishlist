// @vitest-environment jsdom
/**
 * The wish-list half of the share panel, driven against a real DOM.
 *
 * The panel itself is the hub's `/hub-share-ui.js` (its sequencing — link
 * reads, create, copy, revoke — is tested where it lives, in hub-contract).
 * What is wish-list-specific is what `src/share.js` hands it: the list row
 * before a mint, the owner's notice after, and what a link would show, read
 * here while the panel is already open. These drive the REAL adapter with a
 * stand-in panel that draws the scope and a Create button the way the hub's
 * does, so the order of reads, draws and writes is what a member would get.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createWishlistShare } from "../src/share.js";

const ME = { id: "adult-1", name: "Alex", role: "adult", isAdmin: false };
const MEMBERS = [ME, { id: "kid-1", name: "Emma", role: "child" }, { id: "kid-2", name: "Sam", role: "child" }];

/** An item read the test settles when it chooses. */
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

/** The hub's overlay, reduced to what the adapter relies on: a panel element
 *  with data-testid="share-panel" whose markup each render replaces. */
function createOverlayView(doc) {
  let el = null;
  return {
    bind() {},
    show() {
      el?.remove();
      el = doc.createElement("div");
      el.setAttribute("data-testid", "share-panel");
      doc.body.appendChild(el);
    },
    render(html) { if (el) el.innerHTML = html; },
    hide() { el?.remove(); el = null; },
  };
}

/** The hub's panel, reduced: open draws the scope and an ENABLED Create
 *  button (the hub's own reasons to disable it are not in play here). */
let panel;
function createShareUi(deps) {
  panel = { deps };
  return {
    open(item) {
      panel.item = item;
      deps.view.show();
      deps.view.render(`<p class="share-scope">${deps.scopeHtml(item)}</p>
        <button data-share-action="create">Create link</button>`);
    },
    close() { deps.view.hide(); },
  };
}

function harness({ me = ME } = {}) {
  const reads = [];
  const calls = [];
  const deps = {
    createShareUi,
    createOverlayView,
    document,
    share: {
      listAll: vi.fn(async () => ({ links: [], limits: {} })),
      revoke: vi.fn(async () => {}),
      create: vi.fn(async (type, id, opts) => { calls.push(["mint", type, id, opts.label]); return { id: "link-1", url: "https://hub.example/s/1" }; }),
    },
    db: vi.fn(async (sql, params) => { calls.push(["row", params[0], params[1]]); return { changed: 1 }; }),
    esc: (s) => String(s),
    confirm: async () => true,
    getMe: () => me,
    getMembers: () => MEMBERS,
    getItemsFor: vi.fn((id) => { const d = deferred(); reads.push({ id, ...d }); return d.promise; }),
    writeText: async () => {},
    notify: vi.fn(async () => { calls.push(["notify"]); }),
    activeLinks: () => [],
    expiryChoices: [],
    defaultExpiryHours: 168,
  };
  const ui = createWishlistShare(deps);
  const scope = () => document.querySelector("[data-wishlist-scope]")?.textContent.replace(/\s+/g, " ").trim();
  const createDisabled = () => document.querySelector('[data-share-action="create"]')?.disabled;
  return { ui, deps, reads, calls, scope, createDisabled };
}

const item = (visibility) => ({ id: `i-${Math.random()}`, visibility });

beforeEach(() => { document.body.innerHTML = ""; panel = null; });

describe("what a link would show", () => {
  it("says it is checking, with Create off, until the item read answers", async () => {
    const h = harness();
    h.ui.open("kid-1");
    expect(panel.item).toEqual({ id: "kid-1", title: expect.stringContaining("Emma") });
    expect(h.scope()).toMatch(/Checking what’s on this list/);
    expect(h.createDisabled()).toBe(true);

    h.reads[0].resolve([item("everyone"), item("everyone"), item("adults")]);
    await flush();
    expect(h.scope()).toMatch(/2 items will be visible/);
    expect(h.createDisabled()).toBe(false);
  });

  it("holds Create back when the item read is refused, and says why", async () => {
    const h = harness();
    h.ui.open("kid-1");
    h.reads[0].reject(new Error("refused"));
    await flush();
    expect(h.scope()).toMatch(/Couldn’t check what’s on this list/);
    expect(h.createDisabled()).toBe(true);
  });

  it("counts what stays behind only on the sharer's own list", async () => {
    const own = harness();
    own.ui.open(ME.id);
    own.reads[0].resolve([item("everyone"), item("private"), item("adults")]);
    await flush();
    expect(own.scope()).toMatch(/1 item will be visible\. 2 more/);

    document.body.innerHTML = "";
    const other = harness();
    other.ui.open("kid-1");
    other.reads[0].resolve([item("everyone"), item("private")]);
    await flush();
    expect(other.scope()).toMatch(/Anything marked Adults only or Private stays in the family/);
    expect(other.scope()).not.toMatch(/more/);
  });

  it("says nothing would be shared when no item is marked Everyone", async () => {
    const h = harness();
    h.ui.open("kid-1");
    h.reads[0].resolve([item("private")]);
    await flush();
    expect(h.scope()).toMatch(/Nothing would be shared yet/);
  });

  it("ignores a late read for a list that is no longer open", async () => {
    const h = harness();
    h.ui.open("kid-1");
    h.ui.open("kid-2");
    h.reads[1].resolve([]);
    await flush();
    h.reads[0].resolve([item("everyone"), item("everyone"), item("everyone")]);
    await flush();
    expect(h.scope()).toMatch(/Nothing would be shared yet/);
  });

  it("draws nothing for a read that lands after the panel was closed", async () => {
    const h = harness();
    h.ui.open("kid-1");
    h.ui.close();
    h.reads[0].resolve([item("everyone")]);
    await flush();
    expect(document.querySelector('[data-testid="share-panel"]')).toBeNull();
  });
});

describe("minting a link for a wish list", () => {
  async function ready(h, id = "kid-1") {
    h.ui.open(id);
    h.reads.at(-1).resolve([item("everyone")]);
    await flush();
  }

  it("creates the list row before the mint, then tells the owner", async () => {
    const h = harness();
    await ready(h);
    const link = await panel.deps.share.create("list", "kid-1", { label: "Emma’s wish list" });
    expect(link.url).toBe("https://hub.example/s/1");
    await flush();
    expect(h.calls).toEqual([
      ["row", "kid-1", "Emma’s wish list"],
      ["mint", "list", "kid-1", "Emma’s wish list"],
      ["notify"],
    ]);
    expect(h.deps.notify).toHaveBeenCalledWith(expect.objectContaining({ audience: ["kid-1"] }));
  });

  it("sends no notice for the sharer's own list", async () => {
    const h = harness();
    await ready(h, ME.id);
    await panel.deps.share.create("list", ME.id, { label: "Alex’s wish list" });
    await flush();
    expect(h.deps.notify).not.toHaveBeenCalled();
  });

  it("mints nothing when the row write is refused", async () => {
    const h = harness();
    await ready(h);
    h.deps.db.mockRejectedValueOnce(Object.assign(new Error("hub text"), { status: 403 }));
    await expect(panel.deps.share.create("list", "kid-1", { label: "x" })).rejects.toMatchObject({ status: 403 });
    expect(h.deps.share.create).not.toHaveBeenCalled();
  });

  it("refuses a mint before the item read answers, without writing anything", async () => {
    const h = harness();
    h.ui.open("kid-1");
    await expect(panel.deps.share.create("list", "kid-1", { label: "x" })).rejects.toMatchObject({ forUser: true });
    expect(h.deps.db).not.toHaveBeenCalled();
    expect(h.deps.share.create).not.toHaveBeenCalled();
  });

  it("keeps the link when the owner's notice fails", async () => {
    const h = harness();
    await ready(h);
    h.deps.notify.mockRejectedValueOnce(new Error("down"));
    await expect(panel.deps.share.create("list", "kid-1", { label: "x" })).resolves.toMatchObject({ id: "link-1" });
  });

  it("passes the panel the wish list's type, noun and revoke rule", () => {
    const h = harness({ me: { ...ME, isAdmin: true } });
    expect(panel.deps.itemType).toBe("list");
    expect(panel.deps.noun).toBe("wish list");
    expect(panel.deps.isAdmin()).toBe(true);
    expect(panel.deps.memberName("kid-1")).toBe("Emma");
    void h;
  });
});
