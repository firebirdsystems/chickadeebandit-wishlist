import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { describe, it, expect } from "vitest";
import { shareableItemCount } from "../src/logic.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(__dirname, "../manifest.json"), "utf-8"));
const migrations = readFileSync(join(__dirname, "../migrations/004_shareable_lists.sql"), "utf-8");

const item = manifest.shareable.list;

/**
 * The share link is the app's only anonymous surface: what these assert is not
 * that the manifest parses, but that the two halves of the same promise agree.
 * The hub validates the shape at admission; nothing there knows that this app's
 * modal tells an adult how many items will be visible.
 */
describe("shareable.list", () => {
  it("anchors on the lists table the migration creates, keyed by member", () => {
    expect(item.table).toBe("lists");
    expect(item.id_column).toBe("member_id");
    expect(migrations).toMatch(/CREATE TABLE IF NOT EXISTS app_wishlist__lists/);
    expect(migrations).toMatch(/PRIMARY KEY \(member_id\)/);
  });

  // The count in the share modal and the filter on the public page are the same
  // claim made twice. If the manifest ever admitted "adults" here, the modal
  // would under-report and items would leave the household unannounced.
  it("publishes only items marked everyone — the filter shareableItemCount assumes", () => {
    const visibility = item.feed.where.find((w) => w.column === "visibility");
    expect(visibility, "the feed must filter on visibility").toBeTruthy();
    expect(visibility.values).toEqual(["everyone"]);

    const sample = [
      { visibility: "everyone" }, { visibility: "adults" },
      { visibility: "private" }, { visibility: "everyone" },
    ];
    const byManifest = sample.filter((i) => visibility.values.includes(i.visibility)).length;
    expect(shareableItemCount(sample)).toBe(byManifest);
  });

  it("feeds from wish_items on the same member_id the link is keyed by", () => {
    expect(item.feed.table).toBe("wish_items");
    expect(item.feed.fk_column).toBe(item.id_column);
  });

  // A removed member's list row must go with their items, or a revoked-by-
  // departure list would still resolve for anyone holding an old link.
  it("deletes the list row when the member is removed", () => {
    // id_column is required and does NOT default usefully here: the cleanup
    // looks for an "id" column, and this table's key is member_id.
    expect(manifest.member_references.lists)
      .toEqual({ column: "member_id", id_column: "member_id", on_removed: "delete" });
    expect(manifest.member_references.wish_items.on_removed).toBe("delete");
  });

  // Minting is adults-only in the hub, and `lists` must be writable by the
  // adult doing it — including for a child, who cannot mint at all.
  //
  // Deliberately NOT `owner_column`/`owner_only`: that would stop a parent
  // sharing their child's list, which is the point of the feature. The app
  // therefore accepts that any adult may share any member's list, and does not
  // pretend to restrict it client-side. See canShare in src/logic.js.
  it("lets adults write the anchor row for anyone", () => {
    expect(manifest.row_policies.lists).toEqual({ kind: "adult_writable" });
    expect(item.owner_column, "owner_column would break parent-shares-child").toBeUndefined();
    expect(item.mint_roles, "mint_roles admin would break sharing your own list").toBeUndefined();
  });

  // Every column the feed filters or orders by has to be plaintext, or the
  // comparison silently matches nothing. `visibility` is built-in plaintext,
  // `created_at`/`member_id` carry plaintext suffixes.
  it("filters and orders only on plaintext columns", () => {
    const plaintext = (c) =>
      ["visibility", "priority", ...(manifest.db_plaintext_columns ?? [])].includes(c)
      || /_(id|at|date|by|time)$/.test(c);
    for (const w of item.feed.where) expect(plaintext(w.column), w.column).toBe(true);
    expect(plaintext(item.feed.order_column), item.feed.order_column).toBe(true);
    expect(plaintext(item.id_column), item.id_column).toBe(true);
  });

  // The link format is a hub feature this app is the first to use; if it is
  // dropped from the manifest the url renders as unclickable text.
  // `lists.updated_at` moves only when a link is minted, so the label must not
  // claim to track the items. A child cannot write this row at all.
  it("labels the list column for what it records, not for item freshness", () => {
    const col = item.columns.find((c) => c.column === "updated_at");
    expect(col.label).toBe("Shared");
    expect(col.label.toLowerCase()).not.toContain("updated");
  });

  it("marks the item link as a url so the shared page renders it as a link", () => {
    const url = item.feed.columns.find((c) => c.column === "url");
    expect(url.format).toBe("url");
    expect(["body", "detail"]).toContain(url.role);
  });
});
