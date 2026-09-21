/**
 * External share links for a wish list.
 *
 * This is the app's only anonymous surface, and it is the part of the app with
 * real sequencing in it — two reads of the link list can be in flight at once,
 * a modal can be replaced while a request is out, and a refused write must not
 * look like one that landed. That is why it lives here as a controller with its
 * dependencies passed in rather than inline in index.html: everything below can
 * then be driven against a real DOM in __tests__/share-ui.test.mjs, which is
 * the only kind of test that sees this class of defect at all.
 *
 * It owns no DOM of its own. The page's modal primitives are injected, so the
 * share modal is the same modal as every other one and closing works the usual
 * way.
 */

import { wishListTitle, shareableItemCount, shareTargetOf } from "./logic.js";

/** The expiry choices and the live-link filter are the SDK's — every sharing
 *  app used to inline both, and a change to the hub's 30-day free ceiling
 *  should not need ten edits. Injected rather than imported so this module
 *  stays testable in Node without the browser-only /hub-sdk.js URL. */

/**
 * @param deps.share        createShareHelper(...) from the hub SDK
 * @param deps.db           the hub SDK database helper — THROWS on a refusal
 * @param deps.esc          HTML escaper
 * @param deps.confirm      async (message, opts) => boolean
 * @param deps.getMe        the session member, or null
 * @param deps.getMembers   the household roster
 * @param deps.getItemsFor  wish items the SHARER can see for a member id
 * @param deps.openModal    (html, kind) => void — tears down any open modal first
 * @param deps.getModalEl   the live modal element, or null
 * @param deps.writeText    clipboard writer
 * @param deps.notify       sendHubNotification, or a no-op — best-effort
 * @param deps.activeLinks  activeShareLinks from the hub SDK
 * @param deps.expiryChoices SHARE_EXPIRY_CHOICES from the hub SDK
 */
export function createShareUi(deps) {
  let links = [];
  /**
   * What we know about the target's wish items — one value, three answers:
   *   "loading" — the read is still out
   *   "failed"  — it came back refused, so we cannot say what a link exposes
   *   Array     — the rows themselves
   *
   * These were three separate flags (`items`, `itemsFailed`, `loading`), which
   * is two more than there are answers: a failed read set `items = []`, and []
   * is also a genuinely empty list, so a second flag existed purely to tell
   * those apart — and a third tracked a state that was already `items === null`.
   */
  let itemRows = "loading";
  /**
   * The FIRST read of this modal's links was refused, so we have never had a
   * trustworthy view of them. That is the case worth explaining and gating on:
   * the usual cause is the household's sharing_policy (in a shared space the
   * default is admins_only), which the app cannot read directly.
   *
   * A later read failing is a different thing entirely — we already showed a
   * good list, and one blip does not mean sharing is forbidden. Treating the
   * two the same put "Sharing isn't available here right now" directly above
   * "Link created" after a successful mint, and disabled Create on a household
   * that plainly allows it.
   */
  let listFailed = false;
  let listEverLoaded = false;
  let busy = false;
  let error = "";
  let expiry = deps.defaultExpiryHours;
  let loadSeq = 0;

  /** Whose list the open modal is for, or null. Read off the element every
   *  time — see shareTargetOf for why it is not held here. */
  const target = () => shareTargetOf(deps.getModalEl());

  /**
   * Pins the list this operation started on, and answers whether the modal is
   * still showing it. Every async path needs this before it paints: the member
   * can open another member's modal, or close it, while a request is out, and
   * a result painted then belongs to a list nobody is looking at.
   *
   * Note this is NOT the same question as `loadSeq` in `refresh()`. That one
   * orders two reads of the SAME list — open's and create's — which no target
   * comparison can tell apart.
   */
  function pinTarget() {
    const pinned = target();
    return () => target() === pinned;
  }

  /**
   * Make sure the member has a `lists` row before a link is minted for it.
   *
   * The hub refuses to mint a link for a row that does not exist (it verifies
   * the id first and answers 404), and a wish list only becomes a row when
   * someone first shares it — there is nothing to create at install time and
   * nothing a migration could back-fill, because the title needs the member's
   * name and migrations run outside the codec that would encrypt it.
   *
   * `lists` is `adult_writable`, so the adult doing the sharing can create this
   * row for anyone — which is the point: a parent sharing a child's list is the
   * main thing this feature is for, and the child cannot mint links themselves.
   */
  async function ensureListRow(memberId, title) {
    const now = new Date().toISOString();
    // `db` throws if this is refused or never lands, which is what the caller
    // needs: a write that did not happen must not be followed by a mint, or
    // the member is told "Item not found" — a message about the list rather
    // than about the write.
    await deps.db(
      "INSERT INTO app_wishlist__lists (member_id, title, created_at, updated_at) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT(member_id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at",
      [memberId, title, now, now],
    );
  }

  /**
   * Every path that changes links re-reads them, so two reads are routinely in
   * flight at once: opening the modal starts one, and creating a link starts
   * another that finishes with the new link in it. Without the sequence guard
   * the slower OPEN can land last and overwrite the fresher list, and the link
   * the member just made disappears from under them while its url is on the
   * clipboard.
   *
   * Re-read this household's links, discarding a reply that a newer read — or a
   * closed modal — has already made stale.
   *
   * It reads `status()`, not `list()`, and that is the whole point. The SDK
   * turns EVERY non-2xx into `{ entitled: false, bundle: null, limits: null,
   * links: [] }` — a 403 from the household's `sharing_policy` included — and
   * `list()` hands back only `.links`. So a refusal and a household with no
   * links are the same empty array, and nothing throws.
   *
   * It reads `listAll()`, which follows the server's cursor: the single-page
   * `list()` returns only the newest 500, so an older live link on a household
   * with a long audit tail would be invisible here — and therefore impossible
   * to copy or revoke from the app that made it.
   *
   * `limits` is the discriminator: the hub sends it on every successful list,
   * and the SDK can only produce null for it when the response was not ok.
   * Relying on `list()` to throw here was wrong, and the test that "proved" it
   * mocked a rejection the SDK never produces.
   */
  async function refresh() {
    const seq = ++loadSeq;
    const sameTarget = pinTarget();
    let status = null;
    try {
      status = await deps.share.listAll();
    } catch {
      status = null;   // fetch itself rejected — offline, DNS, aborted
    }
    // Superseded is not failed. A newer read — another create, a revoke — owns
    // the list now, and its answer is the authoritative one; saying "failed"
    // here made create() append a link the newer read had already listed, and
    // apologise for a refresh that actually worked.
    if (seq !== loadSeq || !sameTarget()) return "stale";
    // A read that failed is NOT an empty list. Blanking here told a member who
    // had just minted a link that they had none — and the obvious response to
    // that is to mint a second one.
    if (!status || status.limits === null) {
      if (!listEverLoaded) listFailed = true;
      return "failed";
    }
    listEverLoaded = true;
    listFailed = false;
    links = status.links ?? [];
    return "ok";
  }

  function render() {
    if (!target()) return;
    deps.getModalEl().querySelector(".modal").innerHTML = html();
  }

  function html() {
    const esc = deps.esc;
    const me = deps.getMe();
    const id = target();
    const member = deps.getMembers().find((m) => m.id === id);
    const own = id === me?.id;
    const loaded = Array.isArray(itemRows) ? itemRows : null;
    const shown = loaded ? shareableItemCount(loaded) : 0;
    const hidden = loaded ? loaded.length - shown : 0;
    const active = deps.activeLinks(links, id);

    const rows = active.map((l) => {
      // Two different questions, and they were once the same variable. The hub
      // lets the MINTER revoke, plus admins — but an admin did not mint these,
      // and showing them unattributed made every adult's public link look like
      // the admin's own.
      const isMine = l.createdBy === me?.id;
      const canRevoke = isMine || !!me?.isAdmin;
      const by = deps.getMembers().find((m) => m.id === l.createdBy);
      return `
    <div class="share-row">
      <input readonly class="share-url" value="${esc(l.url)}" onclick="this.select()"
        aria-label="Share link" />
      <div class="share-meta">
        Expires ${new Date(l.expiresAt).toLocaleDateString()} · ${l.viewCount} view${l.viewCount === 1 ? "" : "s"}
        ${isMine ? "" : ` · shared by ${esc(by?.name ?? "another adult")}`}
      </div>
      <div class="share-row-actions">
        <button class="btn btn-ghost btn-sm" data-share-action="copy" data-link-id="${esc(l.id)}">Copy</button>
        ${canRevoke ? `<button class="btn btn-danger btn-sm" data-share-action="revoke" data-link-id="${esc(l.id)}">Revoke</button>` : ""}
      </div>
    </div>`;
    }).join("");

    return `
    <h3>Share ${esc(wishListTitle(member))}</h3>
    <p class="share-intro">
      Anyone with the link can see this list — no account needed. Links expire on their own,
      and you can revoke one at any time.
    </p>
    <p class="share-scope">
      ${itemRows === "loading"
        ? `Checking what\u2019s on this list\u2026`
        : itemRows === "failed"
        ? `<strong>Couldn\u2019t check what\u2019s on this list.</strong> Until that read succeeds
           there is no way to say what a link would show, so creating one is held back.`
        : shown === 0
          ? `<strong>Nothing would be shared yet.</strong> Only items marked <em>Everyone</em> appear on a shared list.`
          : `<strong>${shown} item${shown === 1 ? "" : "s"}</strong> will be visible.` +
            // A count of what stays behind is only truthful on the sharer's OWN
            // list. On someone else's, the row policy has already hidden their
            // private items from this reader, so any number here would be short
            // — and publishing the real one would leak what "private" means.
            (own
              ? (hidden > 0 ? ` ${hidden} more — marked <em>Adults only</em> or <em>Private</em> — ${hidden === 1 ? "stays" : "stay"} in the family.` : "")
              : ` Anything marked <em>Adults only</em> or <em>Private</em> stays in the family.`)}
    </p>
    ${listFailed ? `<p class="share-error">
      Sharing isn\u2019t available here right now. In a shared space only stewards can
      create links unless a steward opens it up, and a household can switch sharing
      off entirely.
    </p>` : ""}
    ${error ? `<p class="share-error">${esc(error)}</p>` : ""}
    ${rows || (listFailed ? "" : `<p class="share-empty">No active links yet.</p>`)}
    <div class="share-create">
      <label class="share-expiry-label" for="share-expiry">Link lasts</label>
      <select id="share-expiry" class="share-expiry" data-share-action="expiry">
        ${deps.expiryChoices.map(({ hours, label }) =>
          `<option value="${hours}"${hours === expiry ? " selected" : ""}>${label}</option>`).join("")}
      </select>
      <button class="btn btn-primary" data-share-action="create" ${busy || listFailed || !Array.isArray(itemRows) ? "disabled" : ""}>
        ${busy ? "Creating…" : "Create link"}
      </button>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Close</button>
    </div>`;
  }

  async function open(memberId) {
    busy = false;
    error = "";
    links = [];
    listFailed = false;
    listEverLoaded = false;
    // Create stays shut until both reads answer. Whether this household allows
    // sharing at all is only knowable from status(), and what a link would
    // expose only from the item read — an enabled button before either is a
    // click that writes the anchor row and only then gets refused.
    itemRows = "loading";
    // The target goes in as the modal is built, not attached after: openModal
    // tears down whatever was open first, and anything set afterwards has a
    // window in which the modal exists without it.
    deps.openModal("", "share", { shareTarget: memberId });
    const sameTarget = pinTarget();
    render();
    // The modal asks for the item list itself rather than reading whatever the
    // browse view happens to hold: that list is emptied while a different
    // member's items are being fetched, and a modal opened in that window would
    // report a full list as having nothing to share.
    // Settled separately: a failed item read must not also discard the link
    // list, and "no items" and "could not read the items" are different answers
    // — the modal exists to tell an adult which one it is.
    const reading = deps.getItemsFor(memberId)
      .then((rows) => ({ ok: true, rows }), () => ({ ok: false }));
    const [read] = await Promise.all([reading, refresh()]);
    if (!sameTarget()) return;
    itemRows = read.ok ? (read.rows ?? []) : "failed";
    render();
  }

  async function create() {
    const id = target();
    if (!id) return;
    const still = pinTarget();
    const member = deps.getMembers().find((m) => m.id === id);
    const title = wishListTitle(member);
    busy = true;
    error = "";
    render();
    try {
      // The row must exist before the mint, not after: the hub verifies the id
      // and answers 404 for a list it cannot find. A mint refused after this
      // point (sharing switched off household-wide, or the active-link cap)
      // leaves an anchor row with no link pointing at it — invisible to every
      // other surface in the app, overwritten by the next share, and removed
      // with the member. Not worth a compensating delete.
      await ensureListRow(id, title);
      const link = await deps.share.create("list", id, { expiresInHours: expiry, label: title });
      const listed = await refresh();
      if (!still()) return;
      if (listed === "failed") {
        // The link EXISTS — only our picture of the list is behind. Show it
        // from the create response rather than waiting for a re-read that has
        // already failed: otherwise the one copy of a url that is now live
        // outside the household is a clipboard write that may also fail.
        //
        // The mint reply carries id/url/expiresAt; the rest of what the row
        // needs is what we just asked for, so it is known here.
        links = [...links, {
          id: link.id,
          url: link.url,
          itemId: id,
          createdBy: deps.getMe()?.id,
          expiresAt: link.expiresAt,
          revokedAt: null,
          viewCount: 0,
        }];
        error = "Link created — the list of links couldn\u2019t be refreshed.";
      }
      try {
        await deps.writeText(link.url);
      } catch {
        /* the url is on screen in a selectable field either way — see above */
      }
      // Any adult may share any member's list, and only the member who minted
      // a link can revoke it. Telling the owner is what keeps that from being
      // something done TO them: they learn a link exists and who to ask. Sent
      // only to them, carries no item content, and is best-effort — the link
      // is already made, so a failed notification must not read as a failure.
      const sharer = deps.getMe();
      if (id !== sharer?.id) {
        try {
          await deps.notify?.({
            title: "Your wish list was shared",
            body: `${sharer?.name ?? "Another adult"} created a link anyone can open.`,
            audience: [id],
          });
        } catch { /* best-effort */ }
      }
    } catch (err) {
      if (!still()) return;
      error = err?.message ?? "Couldn't create the link.";
    } finally {
      // One teardown for both outcomes: the button must come back whether the
      // mint succeeded or failed, and the two branches were drifting apart.
      if (still()) {
        busy = false;
        render();
      }
    }
  }

  async function copy(id) {
    const same = pinTarget();
    const link = links.find((l) => l.id === id);
    if (!link) return;
    try {
      await deps.writeText(link.url);
      if (error && same()) {
        error = "";
        render();
      }
    } catch {
      if (!same()) return;
      error = "Couldn't copy — select the link text instead.";
      render();
    }
  }

  async function revoke(id) {
    const same = pinTarget();
    if (!await deps.confirm("Revoke this link?", {
      description: "Anyone using it will lose access to this wish list straight away.",
      confirmLabel: "Revoke",
    })) return;
    try {
      await deps.share.revoke(id);
      // Drop it locally FIRST. The link is dead the moment the hub says so, and
      // leaving it on screen because the re-read failed invites a second revoke
      // that comes back "Share link not found". refresh() then reconciles the
      // rest; if it fails, the one thing we know for certain is still right.
      links = links.filter((l) => l.id !== id);
      await refresh();
      if (!same()) return;
      error = "";
    } catch (err) {
      if (!same()) return;
      error = err?.message ?? "Couldn't revoke the link.";
    }
    render();
  }

  /** Click delegation for the modal. Link ids come from the hub and are kept
   *  out of inline handler strings for the same reason item ids are. */
  function handleClick(e) {
    const el = e.target.closest?.("[data-share-action]");
    if (!el) return;
    const { shareAction, linkId } = el.dataset;
    if (shareAction === "create") create();
    else if (shareAction === "copy") copy(linkId);
    else if (shareAction === "revoke") revoke(linkId);
  }

  /** The select is rebuilt on every re-render, so the choice has to live in
   *  state rather than in the element the next render throws away. */
  function handleChange(e) {
    if (e.target?.dataset?.shareAction === "expiry") {
      expiry = Number(e.target.value) || deps.defaultExpiryHours;
    }
  }

  return { open, handleClick, handleChange, render, target };
}
