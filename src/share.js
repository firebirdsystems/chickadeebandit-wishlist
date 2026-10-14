/**
 * External share links for a wish list — the wishlist half only.
 *
 * The panel itself (the link list and its overlapping reads, create, copy,
 * revoke, password and expiry choices, the refusal lines) is the hub's
 * `/hub-share-ui.js`, the one copy every app with share links runs. What a
 * wish list adds goes in through the panel's own `deps`:
 *
 *   - `share`: a wrapper whose `create` makes sure the member's `lists` row
 *     exists before the mint (the hub answers 404 for a row it cannot find, and
 *     a wish list only becomes a row when it is first shared), and afterwards
 *     tells the list's owner that someone else shared it;
 *   - `scopeHtml`: what a link would show, from the wish items this module
 *     reads itself when the panel opens — "checking", "couldn't check", or a
 *     count — and Create stays off until that read answers;
 *   - `view`: the hub's overlay, wrapped so a redraw can be repeated when the
 *     item read lands after the panel has drawn.
 *
 * `createShareUi` / `createOverlayView` are passed in rather than imported, so
 * this file runs in Node tests without the browser-only `/hub-share-ui.js`.
 */

import { wishListTitle, shareableItemCount } from "./logic.js";

/**
 * @param deps.createShareUi      from /hub-share-ui.js
 * @param deps.createOverlayView  from /hub-share-ui.js
 * @param deps.document           the page's document
 * @param deps.share        createShareHelper(...) from the hub SDK
 * @param deps.db           the hub SDK database helper — THROWS on a refusal
 * @param deps.esc          HTML escaper
 * @param deps.confirm      async (message, opts) => boolean
 * @param deps.getMe        the session member, or null
 * @param deps.getMembers   the household roster
 * @param deps.getItemsFor  wish items the SHARER can see for a member id
 * @param deps.writeText    clipboard writer
 * @param deps.notify       sendHubNotification, or a no-op — best-effort
 * @param deps.activeLinks  activeShareLinks from the hub SDK
 * @param deps.expiryChoices SHARE_EXPIRY_CHOICES from the hub SDK
 * @param deps.defaultExpiryHours DEFAULT_SHARE_EXPIRY_HOURS from the hub SDK
 */
export function createWishlistShare(deps) {
  /** Whose list the panel is open on, and what we know about its items:
   *  "loading", "failed" (refused — we cannot say what a link exposes), or the
   *  rows themselves. `readSeq` drops a read for a list no longer open. */
  let target = null;
  let items = "loading";
  let readSeq = 0;
  const ready = () => Array.isArray(items);
  const memberOf = (id) => deps.getMembers().find((m) => m.id === id);

  function scopeText() {
    if (items === "loading") return "Checking what’s on this list…";
    if (items === "failed") {
      return `<strong>Couldn’t check what’s on this list.</strong> Until that read succeeds
        there is no way to say what a link would show, so creating one is held back.`;
    }
    const shown = shareableItemCount(items);
    const hidden = items.length - shown;
    if (shown === 0) {
      return `<strong>Nothing would be shared yet.</strong> Only items marked <em>Everyone</em> appear on a shared list.`;
    }
    // A count of what stays behind is only truthful on the sharer's OWN list.
    // On someone else's, the row policy has already hidden their private items
    // from this reader, so any number here would be short — and publishing the
    // real one would leak what "private" means.
    const own = target === deps.getMe()?.id;
    return `<strong>${shown} item${shown === 1 ? "" : "s"}</strong> will be visible.` + (own
      ? (hidden > 0 ? ` ${hidden} more — marked <em>Adults only</em> or <em>Private</em> — ${hidden === 1 ? "stays" : "stay"} in the family.` : "")
      : ` Anything marked <em>Adults only</em> or <em>Private</em> stays in the family.`);
  }

  // The hub panel redraws by replacing its markup; the last markup is kept so
  // it can be drawn again when the item read lands, with the scope and the
  // Create button brought up to date after every draw.
  const overlay = deps.createOverlayView(deps.document);
  let lastHtml = "";
  const view = {
    bind: (controller) => overlay.bind(controller),
    show: () => overlay.show(),
    hide: () => { overlay.hide(); lastHtml = ""; target = null; readSeq++; },
    render(html) {
      lastHtml = html;
      overlay.render(html);
      const panel = deps.document.querySelector('[data-testid="share-panel"]');
      // A redraw of kept markup carries the scope as it was then.
      const scope = panel?.querySelector("[data-wishlist-scope]");
      if (scope) scope.innerHTML = scopeText();
      // The panel's own reasons (busy, a refused list) already disable Create;
      // this only adds the wish list's: not until we know what a link shows.
      const create = panel?.querySelector('[data-share-action="create"]');
      if (create && !ready()) create.disabled = true;
    },
  };

  /**
   * The `lists` row a link points at. `lists` is `adult_writable`, so the adult
   * sharing can create it for anyone — a parent sharing a child's list is the
   * main thing this is for. `db` throws if this is refused or never lands: a
   * write that did not happen must not be followed by a mint.
   */
  async function ensureListRow(memberId, title) {
    const now = new Date().toISOString();
    await deps.db(
      "INSERT INTO app_wishlist__lists (member_id, title, created_at, updated_at) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT(member_id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at",
      [memberId, title, now, now],
    );
  }

  const share = {
    listAll: (...args) => deps.share.listAll(...args),
    revoke: (...args) => deps.share.revoke(...args),
    async create(itemType, memberId, opts) {
      // The button is off until the item read answers; this holds the line if
      // a click lands in between.
      if (memberId !== target || !ready()) {
        throw Object.assign(new Error("No link was made: what’s on this list couldn’t be checked yet."), { forUser: true });
      }
      // The row must exist before the mint, not after: the hub verifies the id.
      // A mint refused after this point leaves an anchor row no link points at —
      // invisible elsewhere, overwritten by the next share. Not worth undoing.
      await ensureListRow(memberId, opts?.label ?? wishListTitle(memberOf(memberId)));
      const link = await deps.share.create(itemType, memberId, opts);
      // Any adult may share any member's list, and only the minter can revoke
      // it. Telling the owner keeps that from being done TO them. Sent only to
      // them, no item content, best-effort: the link is already made.
      const sharer = deps.getMe();
      if (memberId !== sharer?.id) {
        Promise.resolve(deps.notify?.({
          title: "Your wish list was shared",
          body: `${sharer?.name ?? "Another adult"} created a link anyone can open.`,
          audience: [memberId],
        })).catch(() => {});
      }
      return link;
    },
  };

  const ui = deps.createShareUi({
    share,
    itemType: "list",
    noun: "wish list",
    scopeHtml: () => `<span data-wishlist-scope>${scopeText()}</span>`,
    esc: deps.esc,
    confirm: deps.confirm,
    writeText: deps.writeText,
    activeLinks: deps.activeLinks,
    expiryChoices: deps.expiryChoices,
    defaultExpiryHours: deps.defaultExpiryHours,
    getMe: deps.getMe,
    isAdmin: () => !!deps.getMe()?.isAdmin,
    memberName: (id) => memberOf(id)?.name,
    view,
  });
  overlay.bind(ui);

  /** Open the panel on one member's list, and read what a link would show.
   *  The items are read here rather than taken from the browse view, which is
   *  emptied while another member's items load. */
  function open(memberId) {
    target = memberId;
    items = "loading";
    const seq = ++readSeq;
    ui.open({ id: memberId, title: wishListTitle(memberOf(memberId)) });
    deps.getItemsFor(memberId).then((rows) => rows ?? [], () => "failed").then((answer) => {
      if (seq !== readSeq) return;
      items = answer;
      if (lastHtml) view.render(lastHtml);
    });
  }

  return { open, close: () => ui.close() };
}
