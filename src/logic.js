import { isAdult } from "./shared.js";
export { isAdult };

/**
 * Returns true if `me` is allowed to see `targetMemberId` in Browse.
 * Members only appear if they have a wishlist row and are not the viewer.
 * Item-level visibility is enforced separately via canSeeItem.
 */
export function canSeeMember(targetMemberId, wishlists, me) {
  if (targetMemberId === me.id) return false;
  return targetMemberId in wishlists;
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
 * Whose list a modal element is the share modal for, or null.
 *
 * The target is read back off the element that carries it rather than held in
 * app state, because `openModal` tears down whatever was open before building
 * the next one — so anything kept beside it is state that teardown can clear
 * out from under the modal being opened. That is not hypothetical: clearing the
 * target in `closeModal` once left the share modal opening with no target at
 * all, which rendered no links and sent a null member_id to the anchor insert.
 *
 * Taking the modal's own word for it also answers the other direction: once a
 * different modal has replaced this one, a late re-render finds nothing to do.
 */
export function shareTargetOf(modalEl) {
  if (modalEl?.dataset?.modal !== "share") return null;
  return modalEl.dataset.shareTarget || null;
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
