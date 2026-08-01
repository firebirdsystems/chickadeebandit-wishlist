import { describe, it, expect } from "vitest";
import { canSeeMember, canSeeItem, priorityOrder, sortItems, priorityLabel, searchableFields } from "../src/logic.js";

const members = [
  { id: "adult-1", name: "Alex",   role: "adult" },
  { id: "adult-2", name: "Morgan", role: "adult" },
  { id: "child-1", name: "Casey",  role: "child" },
];

const wishlists = {
  "adult-1": { visibility: "everyone" },
  "adult-2": { visibility: "everyone" },
  "child-1": { visibility: "everyone" },
};

describe("canSeeMember", () => {
  it("adults can see other members", () => {
    expect(canSeeMember("child-1", wishlists, { id: "adult-1" })).toBe(true);
    expect(canSeeMember("adult-2", wishlists, { id: "adult-1" })).toBe(true);
  });

  it("children can see other members", () => {
    expect(canSeeMember("adult-1", wishlists, { id: "child-1" })).toBe(true);
    expect(canSeeMember("adult-2", wishlists, { id: "child-1" })).toBe(true);
  });

  it("never shows own list in browse", () => {
    expect(canSeeMember("adult-1", wishlists, { id: "adult-1" })).toBe(false);
  });

  it("hides members with no wishlist row", () => {
    expect(canSeeMember("unknown", wishlists, { id: "adult-1" })).toBe(false);
  });
});

describe("canSeeItem", () => {
  const everyone = { id: "x", visibility: "everyone", priority: "medium", name: "A", created_at: "2025-01-01T00:00:00Z" };
  const adultsOnly = { ...everyone, visibility: "adults" };
  const priv = { ...everyone, visibility: "private" };

  it("everyone items are visible to adults", () => {
    expect(canSeeItem(everyone, members[0])).toBe(true);
  });

  it("everyone items are visible to children", () => {
    expect(canSeeItem(everyone, members[2])).toBe(true);
  });

  it("adults items are visible to adults", () => {
    expect(canSeeItem(adultsOnly, members[0])).toBe(true);
  });

  it("adults items are hidden from children", () => {
    expect(canSeeItem(adultsOnly, members[2])).toBe(false);
  });

  it("private items are hidden from everyone", () => {
    expect(canSeeItem(priv, members[0])).toBe(false);
    expect(canSeeItem(priv, members[2])).toBe(false);
  });
});

describe("priorityOrder", () => {
  it("high sorts before medium sorts before low", () => {
    expect(priorityOrder("high")).toBeLessThan(priorityOrder("medium"));
    expect(priorityOrder("medium")).toBeLessThan(priorityOrder("low"));
  });

  it("unknown priority falls back to medium order", () => {
    expect(priorityOrder("unknown")).toBe(1);
  });
});

describe("sortItems", () => {
  it("sorts high priority first", () => {
    const items = [
      { id: "a", priority: "low",    created_at: "2025-01-01T00:00:00Z" },
      { id: "b", priority: "high",   created_at: "2025-01-01T00:00:00Z" },
      { id: "c", priority: "medium", created_at: "2025-01-01T00:00:00Z" },
    ];
    const sorted = sortItems(items);
    expect(sorted[0].id).toBe("b");
    expect(sorted[1].id).toBe("c");
    expect(sorted[2].id).toBe("a");
  });

  it("breaks ties by newest created_at first", () => {
    const items = [
      { id: "older", priority: "medium", created_at: "2025-01-01T00:00:00Z" },
      { id: "newer", priority: "medium", created_at: "2025-06-01T00:00:00Z" },
    ];
    const sorted = sortItems(items);
    expect(sorted[0].id).toBe("newer");
  });

  it("does not mutate the original array", () => {
    const items = [
      { id: "a", priority: "low",  created_at: "2025-01-01T00:00:00Z" },
      { id: "b", priority: "high", created_at: "2025-01-01T00:00:00Z" },
    ];
    sortItems(items);
    expect(items[0].id).toBe("a");
  });
});

describe("priorityLabel", () => {
  it("returns distinct colors for each level", () => {
    const high   = priorityLabel("high");
    const medium = priorityLabel("medium");
    const low    = priorityLabel("low");
    expect(high.color).not.toBe(medium.color);
    expect(medium.color).not.toBe(low.color);
  });

  it("falls back to medium for unknown priority", () => {
    expect(priorityLabel("???").label).toBe("Medium");
  });
});

describe("searchableFields", () => {
  it("matches on the description and link, not just the item name", () => {
    const fields = searchableFields({
      name: "Trainers", description: "blue, size 9", url: "https://shop.example/blue", priority: "high",
    });
    expect(fields).toContain("blue, size 9");
    expect(fields).toContain("https://shop.example/blue");
  });
});
