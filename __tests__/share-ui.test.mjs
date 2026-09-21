// @vitest-environment jsdom
/**
 * The share modal, driven against a real DOM.
 *
 * Every other test in this app is a pure-function or source-text test, and this
 * file exists because that turned out not to be enough. A review round found the
 * share feature non-functional end to end — `openModal` tears down the previous
 * modal at the START of an open, and the share target was held in state beside
 * it, so the teardown wiped the target while the modal was being built. The
 * modal rendered no links and Create sent a null member_id at a NOT NULL column.
 * Forty passing tests saw none of it, because none of them opened the modal.
 *
 * So these drive the REAL `createModal` and `createShareUi` — not a
 * re-implementation — and assert on the DOM that the member would be looking at.
 * What is worth covering here is ordering and failure, not markup: overlapping
 * reads, a modal replaced mid-flight, a write that never landed.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createModal } from "../src/modal.js";
import { createShareUi } from "../src/share.js";

/**
 * Stand-ins for the SDK pieces the page injects. The SDK is served by the hub
 * at runtime and only cached here as a gitignored dev file, so an app repo
 * cannot import it in a test that has to pass on a clean clone.
 *
 * That is fine: `activeShareLinks` has its own tests where it lives (the hub's
 * __tests__/unit/hub-sdk-share.test.ts). What these drive is the modal, and
 * for that they only need a filter with the same shape.
 */
const activeShareLinks = (links, itemId, now = new Date()) =>
  (links ?? []).filter((l) =>
    (itemId === undefined || l.itemId === itemId)
    && !l.revokedAt && new Date(l.expiresAt).getTime() > now.getTime());
const SHARE_EXPIRY_CHOICES = [
  { hours: 24, label: "1 day" }, { hours: 168, label: "7 days" }, { hours: 720, label: "30 days" },
];
const DEFAULT_SHARE_EXPIRY_HOURS = 168;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const ME = { id: "adult-1", name: "Alex", role: "adult", isAdmin: false };
const MEMBERS = [
  ME,
  { id: "adult-2", name: "Morgan", role: "adult" },
  { id: "kid-1", name: "Emma", role: "child" },
];

/** A link as the hub's api/share/list returns it. */
function link(over = {}) {
  return {
    id: "link-1",
    url: "https://hub.example/share/abc",
    itemId: "kid-1",
    createdBy: ME.id,
    expiresAt: new Date(Date.now() + 7 * 864e5).toISOString(),
    revokedAt: null,
    viewCount: 0,
    ...over,
  };
}

/** Drain the microtask queue. The share flow is promises only — no timers —
 *  so this runs every continuation that is already scheduled. Needed when the
 *  assertion is that something did NOT happen: there is no event to wait for. */
async function flush(times = 20) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

function deferred() {
  let settle;
  const promise = new Promise((resolve) => { settle = resolve; });
  return { promise, settle };
}

/** Wires the real modal to the real controller, with the hub faked out. */
/**
 * A stand-in for `createShareHelper` that fails the way the REAL one does.
 *
 * This matters more than it looks. The SDK's `status()` turns every non-2xx
 * into `{ entitled: false, bundle: null, limits: null, links: [] }` and never
 * throws — so a mock that rejects on a 403 proves a guard that production will
 * never exercise. One round of review passed on exactly that fiction. The
 * `respond` hook below returns a RESPONSE, and the swallow is re-implemented
 * here from the SDK, so a test can only simulate failures the app can really see.
 */
function fakeShareHelper({ list = [], respond = null }) {
  const status = vi.fn(async () => {
    const res = respond ? await respond() : { ok: true, body: { links: list, entitled: false, limits: { maxActiveLinks: 10 } } };
    if (!res.ok) return { enabled: true, entitled: false, bundle: null, limits: null, links: [] };
    return {
      enabled: true,
      entitled: !!res.body.entitled,
      bundle: res.body.bundle ?? null,
      limits: res.body.limits ?? null,
      links: res.body.links ?? [],
    };
  });
  return {
    status,
    // listAll is what the app reads; single-page `list` is kept so the fake
    // still mirrors the real helper's surface.
    listAll: status,
    list: vi.fn(async () => (await status()).links),
    create: vi.fn().mockResolvedValue({ url: "https://hub.example/share/new" }),
    revoke: vi.fn().mockResolvedValue({ success: true }),
  };
}

function harness({ items = [], list = [], dbResult = { rows: [], changed: 1 }, itemsPromise = null, respond = null, itemsError = null, dbError = null } = {}) {
  const me = { ...ME };
  let current = respond;
  const share = fakeShareHelper({ list, respond: () => (current ? current() : { ok: true, body: { links: list, limits: { maxActiveLinks: 10 } } }) });
  // Models the SDK's createDbHelper, which THROWS on a refused statement and
  // lets a network failure reject — not the lenient local helper it replaced.
  const db = vi.fn(async () => {
    if (dbError) throw new Error(dbError);
    return dbResult;
  });
  const writeText = vi.fn().mockResolvedValue(undefined);
  const notify = vi.fn().mockResolvedValue({});
  const confirm = vi.fn().mockResolvedValue(true);

  let ui;
  const modal = createModal({
    onClick: (e) => ui.handleClick(e),
    onChange: (e) => ui.handleChange(e),
  });
  ui = createShareUi({
    share, db, esc, confirm,
    getMe: () => me,
    getMembers: () => MEMBERS,
    getItemsFor: () => itemsPromise ?? (itemsError ? Promise.reject(new Error(itemsError)) : Promise.resolve(items)),
    openModal: modal.open,
    getModalEl: () => modal.current(),
    writeText,
    notify,
    activeLinks: activeShareLinks,
    expiryChoices: SHARE_EXPIRY_CHOICES,
    defaultExpiryHours: DEFAULT_SHARE_EXPIRY_HOURS,
  });
  const text = () => modal.current()?.textContent ?? "";
  /** Link urls as rendered — they sit in input values, not in text. */
  const urls = () => [...(modal.current()?.querySelectorAll(".share-url") ?? [])].map((i) => i.value);
  const find = (sel) => modal.current()?.querySelector(sel) ?? null;
  /** Point the fake SDK at a new successful payload, or at a raw response. */
  const setLinks = (links) => { current = () => ({ ok: true, body: { links, limits: { maxActiveLinks: 10 } } }); };
  const setResponse = (res) => { current = typeof res === "function" ? res : () => res; };
  return { ui, modal, share, db, writeText, notify, confirm, text, find, urls, me, setLinks, setResponse };
}

beforeEach(() => { document.body.innerHTML = ""; });

describe("opening the share modal", () => {
  // The regression this file was written for. If the target does not survive
  // the open, none of the assertions below can hold.
  it("keeps its target through openModal's teardown and renders the list", async () => {
    const h = harness({ list: [link()] });
    await h.ui.open("kid-1");

    expect(h.ui.target()).toBe("kid-1");
    expect(h.text()).toContain("Emma's Wish List");
    expect(h.find(".share-url")?.value).toBe("https://hub.example/share/abc");
  });

  it("offers a create button even with no links yet", async () => {
    const h = harness();
    await h.ui.open("kid-1");
    expect(h.text()).toContain("No active links yet");
    expect(h.find('[data-share-action="create"]')).not.toBeNull();
  });

  it("shows only the links for the list being shared", async () => {
    const h = harness({ list: [link(), link({ id: "other", itemId: "adult-2", url: "https://hub.example/share/zzz" })] });
    await h.ui.open("kid-1");
    expect(h.modal.current().querySelectorAll(".share-row")).toHaveLength(1);
    expect(h.urls()).not.toContain("https://hub.example/share/zzz");
  });

  const MIXED = [
    { visibility: "everyone" }, { visibility: "everyone" },
    { visibility: "adults" }, { visibility: "private" },
  ];

  it("counts what stays behind on the sharer's OWN list", async () => {
    const h = harness({ items: MIXED });
    await h.ui.open(ME.id);
    expect(h.text()).toContain("2 items");
    expect(h.text()).toContain("2 more");
  });

  // On someone else's list the row policy has already hidden their private
  // items from this reader, so a count here would be short — and the true
  // number would disclose exactly what "private" is for.
  it("gives no count on someone else's list, only the rule", async () => {
    const h = harness({ items: MIXED });
    await h.ui.open("kid-1");
    expect(h.text()).toContain("2 items");
    expect(h.text()).not.toMatch(/\d+ more/);
    expect(h.text()).toContain("Anything marked");
  });

  // The browse view empties its item list while fetching another member's, so
  // the modal must read the list itself rather than trust what is on screen.
  it("waits for the item list instead of reporting an unloaded one as empty", async () => {
    const slow = deferred();
    const h = harness({ items: MIXED, itemsPromise: slow.promise });
    const opening = h.ui.open("kid-1");

    await vi.waitFor(() => expect(h.text()).toContain("Checking what"));
    expect(h.text()).not.toContain("Nothing would be shared yet");

    slow.settle(MIXED);
    await opening;
    expect(h.text()).toContain("2 items");
  });

  it("warns when nothing on the list would be shared", async () => {
    const h = harness({ items: [{ visibility: "private" }] });
    await h.ui.open("kid-1");
    expect(h.text()).toContain("Nothing would be shared yet");
  });
});

describe("a modal that is replaced or closed", () => {
  // A late re-render must not paint share markup into the item form.
  it("does not paint into a different modal that has taken over", async () => {
    const h = harness({ list: [link()] });
    await h.ui.open("kid-1");
    h.modal.open("<p>item form</p>");           // the add-item modal

    h.ui.render();
    expect(h.ui.target()).toBeNull();
    expect(h.text()).toContain("item form");
    expect(h.text()).not.toContain("Wish List");
  });

  it("does nothing when the modal has been closed", async () => {
    const h = harness();
    await h.ui.open("kid-1");
    h.modal.close();
    expect(() => h.ui.render()).not.toThrow();
    expect(document.body.innerHTML).toBe("");
  });

  it("closes on a backdrop click", async () => {
    const h = harness();
    await h.ui.open("kid-1");
    h.modal.current().dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    expect(h.modal.current()).toBeNull();
  });
});

describe("creating a link", () => {
  it("writes the anchor row before minting, then shows the new link", async () => {
    const h = harness();
    await h.ui.open("kid-1");
    h.setLinks([link({ url: "https://hub.example/share/new" })]);

    h.find('[data-share-action="create"]').click();
    await vi.waitFor(() => expect(h.urls()).toContain("https://hub.example/share/new"));

    expect(h.db.mock.calls[0][0]).toContain("INSERT INTO app_wishlist__lists");
    expect(h.db.mock.calls[0][1][0]).toBe("kid-1");
    expect(h.share.create).toHaveBeenCalledWith("list", "kid-1", expect.objectContaining({ label: "Emma's Wish List" }));
    expect(h.writeText).toHaveBeenCalledWith("https://hub.example/share/new");
  });

  // dbRun answers a transport failure with { rows: [] } and no `changed`. That
  // must not read as success, or the mint runs and blames the wrong thing.
  it("does not mint when the anchor write never landed", async () => {
    const h = harness({ dbError: "Failed to fetch" });
    await h.ui.open("kid-1");

    h.find('[data-share-action="create"]').click();
    await vi.waitFor(() => expect(h.find(".share-error")).not.toBeNull());

    expect(h.share.create).not.toHaveBeenCalled();
    expect(h.text()).toContain("Failed to fetch");
  });

  it("surfaces a refusal from the hub verbatim", async () => {
    const h = harness({ dbError: "Table \"lists\" may only be modified by adults" });
    await h.ui.open("kid-1");

    h.find('[data-share-action="create"]').click();
    await vi.waitFor(() => expect(h.text()).toContain("may only be modified by adults"));
    expect(h.share.create).not.toHaveBeenCalled();
  });

  it("surfaces a refused mint and leaves the modal usable", async () => {
    const h = harness();
    h.share.create.mockRejectedValue(new Error("External sharing is disabled for this household"));
    await h.ui.open("kid-1");

    h.find('[data-share-action="create"]').click();
    await vi.waitFor(() => expect(h.text()).toContain("External sharing is disabled"));
    expect(h.find('[data-share-action="create"]').disabled).toBe(false);
  });

  it("keeps a chosen expiry across the re-render and sends it", async () => {
    const h = harness();
    await h.ui.open("kid-1");

    const select = h.find("#share-expiry");
    select.value = "720";
    select.dispatchEvent(new window.Event("change", { bubbles: true }));
    expect(h.find("#share-expiry").value).toBe("720");

    h.find('[data-share-action="create"]').click();
    await vi.waitFor(() => expect(h.share.create).toHaveBeenCalled());
    expect(h.share.create.mock.calls[0][2].expiresInHours).toBe(720);
    // and the rebuilt select still shows it
    expect(h.find("#share-expiry").value).toBe("720");
  });
});

describe("overlapping reads", () => {
  // The open's read and the create's read are both in flight. The open started
  // first and carries a list WITHOUT the new link; if it lands last and wins,
  // the link vanishes while its url is on the clipboard.
  it("ignores a slow open-time read that lands after a create", async () => {
    const h = harness();
    const slow = deferred();
    h.share.list.mockReturnValueOnce(slow.promise);

    const opening = h.ui.open("kid-1");                 // read #1, still pending
    h.setLinks([link({ url: "https://hub.example/share/new" })]);
    h.ui.handleClick({ target: { closest: () => ({ dataset: { shareAction: "create" } }) } });
    await vi.waitFor(() => expect(h.urls()).toContain("https://hub.example/share/new"));

    slow.settle([]);                                     // read #1 finally lands
    await opening;
    expect(h.urls()).toContain("https://hub.example/share/new");
  });
});

describe("revoking", () => {
  it("offers revoke for a link this member minted", async () => {
    const h = harness({ list: [link({ createdBy: ME.id })] });
    await h.ui.open("kid-1");
    expect(h.find('[data-share-action="revoke"]')).not.toBeNull();
  });

  // The hub only lets the minter revoke, so a button here would put a confirm
  // dialog in front of a call that always answers "Share link not found".
  it("offers no revoke for another adult's link, and says whose it is", async () => {
    const h = harness({ list: [link({ createdBy: "adult-2" })] });
    await h.ui.open("kid-1");
    expect(h.find('[data-share-action="revoke"]')).toBeNull();
    expect(h.text()).toContain("shared by Morgan");
  });

  it("revokes after confirmation and drops the link from the list", async () => {
    const h = harness({ list: [link()] });
    await h.ui.open("kid-1");
    h.setLinks([]);

    h.find('[data-share-action="revoke"]').click();
    await vi.waitFor(() => expect(h.text()).toContain("No active links yet"));
    expect(h.share.revoke).toHaveBeenCalledWith("link-1");
  });

  it("does not revoke when the member backs out", async () => {
    const h = harness({ list: [link()] });
    h.confirm.mockResolvedValue(false);
    await h.ui.open("kid-1");

    h.find('[data-share-action="revoke"]').click();
    await vi.waitFor(() => expect(h.confirm).toHaveBeenCalled());
    expect(h.share.revoke).not.toHaveBeenCalled();
  });
});

describe("error banner", () => {
  // A banner from a failed attempt must not outlive a later success.
  it("clears once a retry succeeds", async () => {
    const h = harness({ list: [link()] });
    h.share.revoke.mockRejectedValueOnce(new Error("Share link not found"));
    await h.ui.open("kid-1");

    h.find('[data-share-action="revoke"]').click();
    await vi.waitFor(() => expect(h.text()).toContain("Share link not found"));

    h.find('[data-share-action="revoke"]').click();
    await vi.waitFor(() => expect(h.find(".share-error")).toBeNull());
  });

  it("clears when a copy succeeds after a failure", async () => {
    const h = harness({ list: [link()] });
    h.writeText.mockRejectedValueOnce(new Error("denied"));
    await h.ui.open("kid-1");

    h.find('[data-share-action="copy"]').click();
    await vi.waitFor(() => expect(h.text()).toContain("Couldn't copy"));

    h.find('[data-share-action="copy"]').click();
    await vi.waitFor(() => expect(h.find(".share-error")).toBeNull());
  });
});

describe("when the hub will not list links", () => {
  // In a shared space the default sharing_policy is admins_only, so a
  // non-steward adult's list call is refused. The app cannot read that setting,
  // but it can see that the call failed — and must not then offer a Create
  // that would write the anchor row and only afterwards be refused.
  it("closes the create door and explains, instead of showing an empty list", async () => {
    const h = harness();
    h.setResponse({ ok: false, status: 403 });   // the hub refuses; the SDK swallows it
    await h.ui.open("kid-1");

    expect(h.find('[data-share-action="create"]').disabled).toBe(true);
    expect(h.text()).toContain("only stewards can");
    expect(h.text()).not.toContain("No active links yet");
  });

  // A read that failed is not an empty list. Blanking told a member who had
  // just minted a link that they had none, and the answer to that is to mint
  // another one.
  it("keeps the links it already had when a later read fails", async () => {
    const h = harness({ list: [link()] });
    await h.ui.open("kid-1");
    expect(h.urls()).toContain("https://hub.example/share/abc");

    h.setResponse({ ok: false, status: 500 });
    h.find('[data-share-action="create"]').click();
    await vi.waitFor(() => expect(h.find(".share-error")).not.toBeNull());
    expect(h.urls()).toContain("https://hub.example/share/abc");
  });
});

describe("a link re-read that blips after a good one", () => {
  // The first read is what tells us whether this household allows sharing at
  // all. A later failure is just a failure — saying "sharing isn't available"
  // then put that banner directly above "Link created", and disabled Create on
  // a household that plainly allows it.
  it("does not claim sharing is forbidden, and leaves create open", async () => {
    const h = harness({ list: [link()] });
    await h.ui.open("kid-1");
    expect(h.find('[data-share-action="create"]').disabled).toBe(false);

    h.setResponse({ ok: false, status: 500 });
    h.find('[data-share-action="revoke"]').click();
    await vi.waitFor(() => expect(h.urls()).not.toContain("https://hub.example/share/abc"));

    expect(h.text()).not.toContain("only stewards can");
    expect(h.find('[data-share-action="create"]').disabled).toBe(false);
  });

  // But a first read that fails still closes the door — that is the signal the
  // household's sharing_policy gives us, and the only one we get.
  it("still gates when the very first read is refused", async () => {
    const h = harness({ respond: () => ({ ok: false, status: 403 }) });
    await h.ui.open("kid-1");
    expect(h.text()).toContain("only stewards can");
    expect(h.find('[data-share-action="create"]').disabled).toBe(true);
  });
});

describe("attribution", () => {
  // Revoking and authorship are different questions. An admin may revoke any
  // link, but they did not mint it, and showing it unattributed made every
  // adult's public link look like the admin's own.
  it("tells an admin whose link it is, while still offering revoke", async () => {
    const h = harness({ list: [link({ createdBy: "adult-2" })] });
    h.me.isAdmin = true;
    await h.ui.open("kid-1");

    expect(h.find('[data-share-action="revoke"]')).not.toBeNull();
    expect(h.text()).toContain("shared by Morgan");
  });

  it("does not attribute a member's own link back to them", async () => {
    const h = harness({ list: [link({ createdBy: ME.id })] });
    await h.ui.open("kid-1");
    expect(h.text()).not.toContain("shared by");
  });
});

describe("switching lists mid-flight", () => {
  // The member can open another list's modal while a create is still out. The
  // failure belongs to the list it was for, not to whatever is on screen now.
  it("does not paint one list's failure onto another list's modal", async () => {
    const h = harness();
    const slow = deferred();
    let reached;
    const failing = new Promise((r) => { reached = r; });
    h.share.create.mockReturnValueOnce(
      slow.promise.then(() => { reached(); throw new Error("Item not found"); }));

    await h.ui.open("kid-1");
    h.find('[data-share-action="create"]').click();
    await h.ui.open("adult-2");                 // a different list, same modal slot

    slow.settle();
    // Wait for the rejection to actually happen, THEN drain — an absence has no
    // event of its own, and `share.create` had already been CALLED before this
    // point, so waiting on the call would have proved nothing.
    await failing;
    await flush();

    expect(h.text()).not.toContain("Item not found");
    expect(h.text()).toContain("Morgan's Wish List");

    // And it must not be lurking in state either: any later repaint of this
    // modal would otherwise surface the other list's failure.
    h.ui.render();
    expect(h.text()).not.toContain("Item not found");
  });
});

describe("before sharing authorization is known", () => {
  // Whether this household allows sharing is only knowable from the first
  // status() reply. An enabled Create before then is a click that writes the
  // anchor row and only afterwards gets refused — the sequence the status
  // check exists to prevent.
  it("keeps create shut until the first status answers", async () => {
    const slow = deferred();
    const h = harness();
    h.setResponse(() => slow.promise.then(() => ({ ok: false, status: 403 })));

    const opening = h.ui.open("kid-1");
    await flush();
    expect(h.find('[data-share-action="create"]').disabled).toBe(true);

    slow.settle();
    await opening;
    expect(h.find('[data-share-action="create"]').disabled).toBe(true);   // now for good
    expect(h.db).not.toHaveBeenCalled();
  });

  it("opens create once a good status arrives", async () => {
    const h = harness();
    await h.ui.open("kid-1");
    expect(h.find('[data-share-action="create"]').disabled).toBe(false);
  });
});

describe("a link that was minted but could not be re-read", () => {
  // The link is live outside the household from the moment create() returns.
  // If the re-read fails and the clipboard also fails, a url shown nowhere is
  // a link nobody can use and nobody can revoke.
  it("shows the new link from the mint reply instead of losing it", async () => {
    const h = harness();
    h.writeText.mockRejectedValue(new Error("clipboard denied"));
    h.share.create.mockResolvedValue({
      id: "fresh", url: "https://hub.example/share/fresh",
      expiresAt: new Date(Date.now() + 7 * 864e5).toISOString(),
    });
    await h.ui.open("kid-1");
    h.setResponse({ ok: false, status: 500 });      // the re-read fails

    h.find('[data-share-action="create"]').click();
    await vi.waitFor(() => expect(h.urls()).toContain("https://hub.example/share/fresh"));
    expect(h.text()).toContain("couldn");
  });
});

describe("when the item list cannot be read", () => {
  // The dangerous direction. A failed read used to arrive as an empty array,
  // so the modal promised a link would expose nothing — while the public feed
  // queries the database itself and would publish every `everyone` item.
  it("says so instead of claiming nothing would be shared", async () => {
    const h = harness({ itemsError: "network down" });
    await h.ui.open("kid-1");

    expect(h.text()).toContain("check what");
    expect(h.text()).not.toContain("Nothing would be shared yet");
  });

  it("holds back create until it knows what a link would expose", async () => {
    const h = harness({ itemsError: "network down" });
    await h.ui.open("kid-1");
    expect(h.find('[data-share-action="create"]').disabled).toBe(true);
  });

  // The two reads are independent; one failing must not discard the other.
  it("still shows the links it did manage to read", async () => {
    const h = harness({ itemsError: "network down", list: [link()] });
    await h.ui.open("kid-1");
    expect(h.urls()).toContain("https://hub.example/share/abc");
  });
});

describe("revoking when the re-read fails", () => {
  // The link is dead the moment the hub says so. Leaving it on screen because
  // the follow-up read failed invites a second revoke that answers
  // "Share link not found".
  it("takes the revoked link off screen anyway", async () => {
    const h = harness({ list: [link()] });
    await h.ui.open("kid-1");
    expect(h.urls()).toContain("https://hub.example/share/abc");

    h.setResponse({ ok: false, status: 500 });      // the re-read fails
    h.find('[data-share-action="revoke"]').click();

    await vi.waitFor(() => expect(h.urls()).not.toContain("https://hub.example/share/abc"));
    expect(h.share.revoke).toHaveBeenCalledWith("link-1");
  });
});

describe("telling the owner their list was shared", () => {
  // Any adult may share any member's list, and only the minter can revoke it.
  // The notification is what keeps that from being something done TO someone:
  // they learn the link exists and who to ask about it.
  it("notifies the owner, and only the owner", async () => {
    const h = harness();
    await h.ui.open("kid-1");

    h.find('[data-share-action="create"]').click();
    await vi.waitFor(() => expect(h.notify).toHaveBeenCalled());

    const sent = h.notify.mock.calls[0][0];
    expect(sent.audience).toEqual(["kid-1"]);
    expect(sent.body).toContain("Alex");
    // No item content: the owner's own wishes must not ride out in a preview.
    expect(`${sent.title} ${sent.body}`).not.toMatch(/Trainers|sweater/i);
  });

  it("does not notify a member who shared their own list", async () => {
    const h = harness();
    await h.ui.open(ME.id);

    h.find('[data-share-action="create"]').click();
    await vi.waitFor(() => expect(h.share.create).toHaveBeenCalled());
    expect(h.notify).not.toHaveBeenCalled();
  });

  // The link is already live; a failed notification is not a failed share.
  it("still reports success when the notification fails", async () => {
    const h = harness();
    h.notify.mockRejectedValue(new Error("push service down"));
    h.setLinks([link({ url: "https://hub.example/share/new" })]);
    await h.ui.open("kid-1");

    h.find('[data-share-action="create"]').click();
    await vi.waitFor(() => expect(h.urls()).toContain("https://hub.example/share/new"));
    expect(h.find(".share-error")).toBeNull();
  });
});
