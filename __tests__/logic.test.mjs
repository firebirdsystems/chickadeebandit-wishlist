import { describe, it, expect } from "vitest";
import { canSeeMember, priorityOrder, sortItems, priorityLabel } from "../src/logic.js";

const members = [
  { id: "adult-1", name: "Alex",  role: "adult" },
  { id: "adult-2", name: "Morgan", role: "adult" },
  { id: "child-1", name: "Casey", role: "child" },
];

const wishlists = {
  "adult-1": { visibility: "everyone" },
  "adult-2": { visibility: "adults_only" },
  "child-1": { visibility: "everyone" },
};

describe("canSeeMember", () => {
  it("adults can see everyone lists", () => {
    expect(canSeeMember("child-1", wishlists, { id: "adult-1" }, members)).toBe(true);
  });

  it("adults can see adults_only lists", () => {
    expect(canSeeMember("adult-2", wishlists, { id: "adult-1" }, members)).toBe(true);
  });

  it("children can see everyone lists", () => {
    expect(canSeeMember("adult-1", wishlists, { id: "child-1" }, members)).toBe(true);
  });

  it("children cannot see adults_only lists", () => {
    expect(canSeeMember("adult-2", wishlists, { id: "child-1" }, members)).toBe(false);
  });

  it("never shows own list in browse", () => {
    expect(canSeeMember("adult-1", wishlists, { id: "adult-1" }, members)).toBe(false);
  });

  it("hides members with no wishlist row", () => {
    expect(canSeeMember("unknown", wishlists, { id: "adult-1" }, members)).toBe(false);
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
