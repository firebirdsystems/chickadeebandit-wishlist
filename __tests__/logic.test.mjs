import { describe, it, expect } from "vitest";
import { canSeeMember, canSeeItem, priorityOrder, sortItems, priorityLabel, searchableFields,
         wishListTitle, shareableItemCount, canShare, shareTargetOf, changedARow } from "../src/logic.js";

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

describe("wishListTitle", () => {
  it("names the list after its owner", () => {
    expect(wishListTitle({ name: "Emma" })).toBe("Emma's Wish List");
  });

  // The title is the heading of a page shown to someone with no session, so it
  // must never come out as "'s Wish List" for a member with no name on record.
  it("falls back to a bare title when there is no name", () => {
    expect(wishListTitle({ name: "   " })).toBe("Wish List");
    expect(wishListTitle({})).toBe("Wish List");
    expect(wishListTitle(null)).toBe("Wish List");
  });
});

describe("shareableItemCount", () => {
  // This count is what the modal promises before a link is minted. If it ever
  // disagreed with the manifest's feed filter (visibility = 'everyone'), the
  // app would be telling an adult that fewer — or worse, more — items leave
  // the household than actually do.
  it("counts only items marked everyone", () => {
    const items = [
      { visibility: "everyone" },
      { visibility: "adults" },
      { visibility: "private" },
      { visibility: "everyone" },
    ];
    expect(shareableItemCount(items)).toBe(2);
  });

  it("is zero for a list with nothing public", () => {
    expect(shareableItemCount([{ visibility: "adults" }, { visibility: "private" }])).toBe(0);
    expect(shareableItemCount([])).toBe(0);
  });
});


describe("canShare", () => {
  const adult = { id: "adult-1", name: "Alex", role: "adult" };
  const admin = { id: "adult-3", name: "Sam", role: "adult", isAdmin: true };
  const other = { id: "adult-2", name: "Morgan", role: "adult" };
  const child = { id: "kid-1", name: "Emma", role: "child" };

  it("lets an adult share their own list", () => {
    expect(canShare(true, adult, adult)).toBe(true);
  });

  it("lets any adult share a child's list — the child cannot do it themselves", () => {
    expect(canShare(true, adult, child)).toBe(true);
  });

  // Deliberately permitted. The hub enforces any-adult and cannot express
  // "owner, or any adult for a minor", so restricting it here would hide a
  // button without closing the endpoint — a boundary that is not one. In a
  // household these adults are family; in a shared space the hub's default
  // sharing_policy is admins_only, so a stranger cannot mint at all.
  it("lets one adult share another adult's list", () => {
    expect(canShare(true, adult, other)).toBe(true);
  });

  it("lets an admin share anyone's list", () => {
    expect(canShare(true, admin, other)).toBe(true);
    expect(canShare(true, admin, child)).toBe(true);
  });

  // The hub refuses a memberless caller, so a button here would mint nothing —
  // but only after ensureListRow had already written a row keyed on "".
  it("refuses a caller with no member row, whatever their role", () => {
    expect(canShare(true, null, adult)).toBe(false);
    expect(canShare(true, { role: "adult" }, adult)).toBe(false);
    expect(canShare(true, { id: "", role: "adult" }, adult)).toBe(false);
  });

  it("refuses a child — minting is adults-only in the hub", () => {
    expect(canShare(true, child, child)).toBe(false);
  });

  it("refuses a subject that is not a known member", () => {
    expect(canShare(true, adult, null)).toBe(false);
    expect(canShare(true, adult, {})).toBe(false);
  });

  it("stays off when the hub injected no share urls", () => {
    expect(canShare(false, adult, adult)).toBe(false);
  });
});

describe("shareTargetOf", () => {
  const shareModal = (target) => ({ dataset: { modal: "share", ...(target ? { shareTarget: target } : {}) } });

  it("reads the target off the share modal", () => {
    expect(shareTargetOf(shareModal("emma"))).toBe("emma");
  });

  // The regression this exists for: the target used to live in module state,
  // and openModal's teardown cleared it while the share modal was being built
  // — so the modal opened with no target, rendered no links, and sent a null
  // member_id to an insert whose column is NOT NULL.
  it("is null when no modal is open", () => {
    expect(shareTargetOf(null)).toBeNull();
    expect(shareTargetOf(undefined)).toBeNull();
  });

  // A late re-render must not paint share markup into the item form.
  it("is null once a different modal has taken over", () => {
    expect(shareTargetOf({ dataset: { modal: "", shareTarget: "emma" } })).toBeNull();
    expect(shareTargetOf({ dataset: {} })).toBeNull();
  });

  it("is null for a share modal that never received a target", () => {
    expect(shareTargetOf(shareModal(null))).toBeNull();
    expect(shareTargetOf({ dataset: { modal: "share", shareTarget: "" } })).toBeNull();
  });
});



describe("changedARow", () => {
  it("accepts a write that touched its row", () => {
    expect(changedARow({ rows: [], changed: 1 })).toBe(true);
  });

  // The case the SDK cannot catch: the statement ran, and matched nothing.
  it("rejects a write that matched nothing", () => {
    expect(changedARow({ rows: [], changed: 0 })).toBe(false);
  });
});
