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
