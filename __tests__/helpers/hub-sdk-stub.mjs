/**
 * Stand-in for the hub's /hub-sdk.js, which the page imports by absolute URL.
 *
 * Only the surface index.html actually uses, with real behaviour where the
 * behaviour matters — `createDbHelper` throws on a refusal exactly as the hub's
 * does, because the app's error handling is built on that contract.
 */
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const initial = (name) => String(name ?? "?").trim().charAt(0).toUpperCase() || "?";
export const memberColor = () => "#888888";
export const searchMatch = (q, fields) =>
  !q || fields.some((f) => String(f ?? "").toLowerCase().includes(q.toLowerCase()));
export const hubConfirm = async () => true;
/** Records what it was asked to show, so a test can assert the member was told
 *  something — the point of an alert is that it is the LAST resort surface. */
export const hubAlert = async (message) => { (globalThis.__hubAlerts ??= []).push(message); };

export function createDbHelper(dbUrl) {
  async function dbq(sql, params = []) {
    if (!dbUrl) return { rows: [] };
    const res = await fetch(dbUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql, params }),
    });
    const json = await res.json();
    if (!res.ok || json.error) throw new Error(json.error || `Database request failed (${res.status})`);
    return json;
  }
  dbq.batch = async () => [];
  return dbq;
}

export const SHARE_EXPIRY_CHOICES = Object.freeze([
  { hours: 24, label: "1 day" }, { hours: 168, label: "7 days" }, { hours: 720, label: "30 days" },
]);
export const DEFAULT_SHARE_EXPIRY_HOURS = 168;
export const activeShareLinks = (links, itemId, now = new Date()) =>
  (links ?? []).filter((l) =>
    (itemId === undefined || l.itemId === itemId)
    && !l.revokedAt && new Date(l.expiresAt).getTime() > now.getTime());
export const sendHubNotification = async () => ({ web: 0, expo: 0 });

export function createShareHelper(createUrl, revokeUrl, listUrl) {
  return {
    enabled: !!createUrl,
    async status() { return { enabled: !!listUrl, entitled: false, bundle: null, limits: null, links: [] }; },
    async list() { return (await this.status()).links; },
    async listAll() { return this.status(); },
    async create() { throw new Error("not used in the boot test"); },
    async revoke() { throw new Error("not used in the boot test"); },
  };
}
