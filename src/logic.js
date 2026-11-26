import { isAdult } from "./shared.js";
export { isAdult };

/**
 * Returns true if `me` is allowed to see `targetMemberId` in Browse.
 * Members only appear if they have a wishlist row and are not the viewer.
 * Item-level visibility is enforced separately via canSeeItem.
 */
export function canSeeMember(targetMemberId, wishlists, me, target = null, tenant = HOUSEHOLD) {
  if (targetMemberId === me.id) return false;
  // A supervisor also sees a child with no list yet, so they can start one.
  return targetMemberId in wishlists || (target !== null && canEditListOf(me, target, tenant));
}

/** The default tenant: a household, where every adult supervises. */
export const HOUSEHOLD = Object.freeze({ tenantKind: "household", isAdmin: false });

/**
 * Whether the hub treats `viewer` as a supervisor here: every adult in a
 * household, and only an admin (the steward) in a shared space. Mirrors the
 * hub's own rule, which decides whose rows a supervisor may write.
 */
export function supervises(viewer, tenant = HOUSEHOLD) {
  if (!isAdult(viewer)) return false;
  return tenant?.tenantKind === "shared_space" ? tenant.isAdmin === true : true;
}

/**
 * Whether `viewer` may add to and edit `subject`'s list from this app: their
 * own, or a CHILD's when the viewer supervises (a four-year-old cannot type a
 * list, and grandparents ask the parents anyway).
 *
 * The hub enforces the same line: wish_items sets `supervisor_children_only`,
 * so a supervisor writes their own rows and current children's and never
 * another adult's, and keeps a supplied owner on an INSERT only for a child.
 * Offering the buttons to anyone the hub would not let through would make an
 * "add" land on the viewer's own list and an edit silently change nothing.
 */
export function canEditListOf(viewer, subject, tenant = HOUSEHOLD) {
  if (!viewer?.id || !subject?.id) return false;
  if (viewer.id === subject.id) return true;
  return subject.role === "child" && supervises(viewer, tenant);
}

/** Claims keyed by the item they are on. One claim per item (a unique index),
 *  so a second row for an item would be a bug; the first one read wins. */
export function claimsByItem(claims) {
  const out = new Map();
  for (const claim of claims ?? []) {
    if (claim?.item_id && !out.has(claim.item_id)) out.set(claim.item_id, claim);
  }
  return out;
}

/**
 * What a giver sees on someone else's item:
 *   "open"            nobody has claimed it
 *   "mine-reserved"   the viewer said they will get it
 *   "mine-bought"     the viewer has bought it
 *   "taken-reserved"  someone else said they will get it
 *   "taken-bought"    someone else has bought it
 * The item's owner never reaches this: the hub returns them no claims.
 */
export function claimState(claim, viewerId) {
  if (!claim) return "open";
  const mine = claim.member_id === viewerId;
  const bought = claim.status === "bought";
  if (mine) return bought ? "mine-bought" : "mine-reserved";
  return bought ? "taken-bought" : "taken-reserved";
}

/** The badge line for a claim someone else made: "Bought by Morgan". */
export function claimLabel(claim, members) {
  const who = (members ?? []).find((m) => m.id === claim?.member_id)?.name ?? "someone";
  return `${claim?.status === "bought" ? "Bought" : "Reserved"} by ${who}`;
}

/**
 * Returns true if `viewer` is allowed to see `item`.
 * "everyone" → all members; "adults" → adults only; "private" → owner only (never shown in browse).
 */
export function canSeeItem(item, viewer) {
  if (item.visibility === "private") return false;
  if (item.visibility === "adults") return isAdult(viewer);
  return true;
}

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

export function priorityOrder(priority) {
  return PRIORITY_ORDER[priority] ?? 1;
}

export function sortItems(items) {
  return [...items].sort((a, b) => {
    const po = priorityOrder(a.priority) - priorityOrder(b.priority);
    if (po !== 0) return po;
    return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;
  });
}

export function priorityLabel(priority) {
  switch (priority) {
    case "high": return { label: "High",   color: "#dc2626", bg: "#fee2e2" };
    case "low":  return { label: "Low",    color: "#6b7280", bg: "#f3f4f6" };
    default:     return { label: "Medium", color: "#d97706", bg: "#fef3c7" };
  }
}

/**
 * Fields the in-app search matches against (see hub-sdk `searchMatch`).
 * The description and the link both count: a wish is often remembered
 * by the thing itself ("the blue running shoes") or by where it came
 * from, not by whatever name it was saved under.
 */
export function searchableFields(item) {
  return [item.name, item.description, item.url, item.priority];
}

/**
 * Title stored on the `lists` row and shown as the heading of the public share
 * page. The member's name is copied into this app's own table on purpose: the
 * page is rendered by the hub for someone with no session, so it cannot look
 * anyone up in `family.members` the way the in-app views do.
 */
export function wishListTitle(member) {
  const name = (member?.name ?? "").trim();
  return name ? `${name}'s Wish List` : "Wish List";
}

/**
 * How many of `items` a share link would actually show.
 *
 * The shareable feed filters on `visibility = 'everyone'`, so items marked
 * "adults" or "private" never leave the household. The share modal states this
 * count before a link is minted — the alternative is an adult sharing what they
 * believe is a full list and a relative seeing three of eleven items, with
 * nothing on either side saying why.
 */
export function shareableItemCount(items) {
  return items.filter((i) => i.visibility === "everyone").length;
}


/**
 * Whether to offer sharing of `subject`'s list to `me`.
 *
 * `me` must be the SESSION member, not the browse-view fallback: minting needs
 * a real member id (the hub refuses a memberless caller) and an adult role. An
 * admin viewing a household where they hold no member row has neither, and
 * without the id check the button rendered with an empty one — enough to write
 * a junk anchor row keyed on "" before the mint refused it.
 *
 * Any adult may share ANY member's list, and that is deliberate.
 *
 * It is also the only honest option. The rule we would want — "the owner, or
 * any adult when the subject is a minor" — cannot be expressed in the hub's
 * `shareable` contract, which offers owner-only (`owner_column`), admin-only
 * (`mint_roles`), or any-adult. Owner-only would stop a parent sharing their
 * child's list, which is the main thing this feature is for; admin-only would
 * stop a parent sharing their own. So the server enforces any-adult, and this
 * function must not pretend otherwise: a check here hides a button, it does not
 * close a door, and an adult who wanted to could call the endpoint directly.
 *
 * What makes that acceptable rather than merely unavoidable:
 *   - in a household, the other adults are the member's family, and a shared
 *     link only ever carries items already marked visible to everyone
 *   - in a shared space, where participants are not family, the hub's default
 *     `sharing_policy` is `admins_only`, so only a steward can mint at all
 *   - every link is attributed in the modal ("shared by Morgan"), so a member
 *     who finds one they did not make knows who to ask to revoke it
 *
 * If that last point ever stops being enough, the fix is a hub-side mint
 * predicate, not a stricter check here.
 */
export function canShare(shareEnabled, me, subject) {
  if (!shareEnabled || !me?.id || !isAdult(me)) return false;
  // A subject is still required: the id goes straight into the anchor row and
  // the mint call, and an absent one wrote a row keyed on "".
  return !!subject?.id;
}

/**
 * Whether a write that RAN actually touched a row.
 *
 * The SDK's db helper throws when a statement is REFUSED, which covers row
 * policy, quota, a bad statement and a dead network. It cannot cover this:
 * a statement that executed and matched nothing is a perfectly good 200.
 *
 * What that means depends on the statement, so only the caller can decide:
 *   UPDATE of one specific row → the row is gone (deleted on another device,
 *     or excluded by the owner guard in the WHERE), and closing the editor
 *     over it shows the member an edit that never saved
 *   DELETE → already gone is the outcome that was asked for
 */
export function changedARow(res) {
  return res?.changed !== 0;
}

/**
 * The line a failed write shows ("Refused, gone, or failed" in the app-template guide):
 * "try again" only when retrying can work. `thing` and `action` are the app's own nouns
 * ("item", "save the item"). `found` is the caller's re-read after a write that changed
 * nothing (or a 404/409): false = the row is gone, true = it is still there and the hub
 * narrowed the write away from this member. A `forUser` error keeps the message the page
 * wrote for it (an edit whose item is gone has its own). Never shows hub text.
 */
export function failureLine(e, { action, thing, found } = {}) {
  if (e?.forUser) return e.message;
  if (e?.code === "UNIQUE_CONSTRAINT" || /UNIQUE constraint failed/i.test(String(e?.message ?? ""))) return `That ${thing} already exists.`;
  if (e?.status === 403) return `You don’t have permission to ${action}.`;
  if (e?.status === 507) return "The household’s storage is full — free up space first.";
  if (found === false || (found === undefined && e?.status === 404)) return `This ${thing} has been removed.`;
  if (found === true) return `You don’t have permission to ${action}.`;
  if (e?.status === 409 || e?.status === 404) return `This ${thing} was changed by someone else — check it first.`;
  if (e?.status === 429) return "Too many tries — wait a minute and try again.";
  return `Couldn’t ${action} — try again.`;
}
