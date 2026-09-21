import { readFileSync, readdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { describe, it, expect } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf-8"));
const prefix = `app_${manifest.id.replace(/-/g, "_")}__`;

/**
 * Every column the manifest names must exist in the schema the migrations build.
 *
 * Nothing else checks this. The hub validates the manifest's SHAPE and runs the
 * migrations, but never compares the two — so a column renamed in a migration,
 * or a typo in a manifest, is caught by neither. The failure surfaces at
 * runtime, on the anonymous share page, as a SQL error against a column that
 * does not exist: the one surface in this app where nobody is signed in to
 * report it, and the last place anyone looks.
 *
 * The share block alone names nine columns across two tables.
 */
function schema() {
  const tables = {};
  for (const file of readdirSync(join(root, "migrations")).sort()) {
    const sql = readFileSync(join(root, "migrations", file), "utf-8")
      .replace(/^\s*--.*$/gm, "");   // comments can contain anything
    for (const m of sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+(\w+)\s*\(([\s\S]*?)\n\s*\);/g)) {
      const [, table, body] = m;
      tables[table] ??= new Set();
      for (const line of body.split("\n")) {
        const col = line.trim().match(/^(\w+)\s+(TEXT|INTEGER|REAL|BLOB|NUMERIC)/i);
        if (col) tables[table].add(col[1]);
      }
    }
    for (const m of sql.matchAll(/ALTER TABLE\s+(\w+)\s+ADD COLUMN\s+(\w+)/g)) {
      const [, table, col] = m;
      (tables[table] ??= new Set()).add(col);
    }
  }
  return tables;
}

const tables = schema();
const has = (table, column) => tables[prefix + table]?.has(column) ?? false;

describe("the migrations build the schema the manifest describes", () => {
  it("parsed both app tables out of the migrations", () => {
    // Guards the parser itself: if these regexes ever stop matching, every
    // assertion below would pass vacuously against an empty schema.
    expect(Object.keys(tables).sort()).toEqual([`${prefix}lists`, `${prefix}wish_items`]);
    expect([...tables[`${prefix}wish_items`]]).toEqual(
      expect.arrayContaining(["id", "member_id", "name", "visibility", "priority", "url", "source_event_id"]));
  });

  for (const [type, item] of Object.entries(manifest.shareable ?? {})) {
    describe(`shareable.${type}`, () => {
      it("anchors on columns the lists table really has", () => {
        expect(has(item.table, item.id_column ?? "id"), `${item.table}.${item.id_column}`).toBe(true);
        expect(has(item.table, item.title_column), `${item.table}.${item.title_column}`).toBe(true);
      });

      it("projects only columns that exist", () => {
        for (const c of item.columns ?? []) {
          expect(has(item.table, c.column), `${item.table}.${c.column}`).toBe(true);
        }
      });

      it("feeds from columns that exist, including its filter and sort keys", () => {
        const feed = item.feed;
        if (!feed) return;
        for (const c of feed.columns ?? []) {
          expect(has(feed.table, c.column), `${feed.table}.${c.column}`).toBe(true);
        }
        expect(has(feed.table, feed.fk_column), `${feed.table}.${feed.fk_column}`).toBe(true);
        if (feed.order_column) {
          expect(has(feed.table, feed.order_column), `${feed.table}.${feed.order_column}`).toBe(true);
        }
        for (const w of feed.where ?? []) {
          expect(has(feed.table, w.column), `${feed.table}.${w.column}`).toBe(true);
        }
      });
    });
  }

  it("governs and cleans up every table it declares", () => {
    for (const table of Object.keys(manifest.row_policies ?? {})) {
      expect(tables[prefix + table], `row_policies.${table} has no table`).toBeTruthy();
    }
    for (const [table, ref] of Object.entries(manifest.member_references ?? {})) {
      expect(has(table, ref.column), `member_references.${table}.${ref.column}`).toBe(true);
      expect(has(table, ref.id_column ?? "id"), `member_references.${table} id column`).toBe(true);
    }
  });

  it("reads preload and glance columns that exist", () => {
    const sql = [
      ...Object.values(manifest.preload ?? {}).map((p) => p.sql),
      manifest.glance?.source?.query,
    ].filter(Boolean).join(" ");
    for (const m of sql.matchAll(new RegExp(`FROM\\s+(${prefix}\\w+)`, "g"))) {
      expect(tables[m[1]], `${m[1]} is queried but never created`).toBeTruthy();
    }
  });
});
