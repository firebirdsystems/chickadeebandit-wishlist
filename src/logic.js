import { isAdult } from "./shared.js";
export { isAdult };

/**
 * Returns true if `me` is allowed to see `targetMemberId`'s list in Browse.
 * Children only see lists set to "everyone"; adults see all.
 * Own list is never shown in Browse.
 */
export function canSeeMember(targetMemberId, wishlists, me, members) {
  if (targetMemberId === me.id) return false;
  const wl = wishlists[targetMemberId];
  if (!wl) return false;
  if (wl.visibility === "everyone") return true;
  const myRecord = members.find(m => m.id === me.id);
  return isAdult(myRecord);
}

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

export function priorityOrder(priority) {
  return PRIORITY_ORDER[priority] ?? 1;
}

export function sortItems(items) {
  return [...items].sort((a, b) => {
    const po = priorityOrder(a.priority) - priorityOrder(b.priority);
    if (po !== 0) return po;
    return new Date(b.created_at) - new Date(a.created_at);
  });
}

export function priorityLabel(priority) {
  switch (priority) {
    case "high": return { label: "High",   color: "#dc2626", bg: "#fee2e2" };
    case "low":  return { label: "Low",    color: "#6b7280", bg: "#f3f4f6" };
    default:     return { label: "Medium", color: "#d97706", bg: "#fef3c7" };
  }
}
