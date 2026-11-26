import { describe, it, expect } from "vitest";
import { canSeeMember, canSeeItem, priorityOrder, sortItems, priorityLabel, searchableFields,
         wishListTitle, shareableItemCount, canShare, changedARow, canEditListOf, claimsByItem,
         claimState, claimLabel, supervises } from "../src/logic.js";

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

describe("changedARow", () => {
  it("accepts a write that touched its row", () => {
    expect(changedARow({ rows: [], changed: 1 })).toBe(true);
  });

  // The case the SDK cannot catch: the statement ran, and matched nothing.
  it("rejects a write that matched nothing", () => {
    expect(changedARow({ rows: [], changed: 0 })).toBe(false);
  });
});

describe("canEditListOf", () => {
  const adult = { id: "adult-1", role: "adult" };
  const other = { id: "adult-2", role: "adult" };
  const kid = { id: "child-1", role: "child" };
  const kid2 = { id: "child-2", role: "child" };

  it("lets anyone edit their own list", () => {
    expect(canEditListOf(adult, adult)).toBe(true);
    expect(canEditListOf(kid, kid)).toBe(true);
  });
  it("lets an adult keep a child's list", () => {
    expect(canEditListOf(adult, kid)).toBe(true);
  });
  it("never offers another adult's list, or a child another child's", () => {
    expect(canEditListOf(adult, other)).toBe(false);
    expect(canEditListOf(kid, kid2)).toBe(false);
    expect(canEditListOf(kid, adult)).toBe(false);
  });
  it("refuses a viewer or subject with no id", () => {
    expect(canEditListOf(null, kid)).toBe(false);
    expect(canEditListOf({ role: "adult" }, kid)).toBe(false);
    expect(canEditListOf(adult, { role: "child" })).toBe(false);
  });
});

describe("canSeeMember for a child with no list yet", () => {
  it("shows an adult the child, so they can start a list", () => {
    expect(canSeeMember("child-9", {}, { id: "adult-1", role: "adult" }, { id: "child-9", role: "child" })).toBe(true);
  });
  it("does not show an empty adult list, or an empty child's list to a child", () => {
    expect(canSeeMember("adult-9", {}, { id: "adult-1", role: "adult" }, { id: "adult-9", role: "adult" })).toBe(false);
    expect(canSeeMember("child-9", {}, { id: "child-1", role: "child" }, { id: "child-9", role: "child" })).toBe(false);
  });
});

describe("claims", () => {
  const claims = [
    { id: "c1", item_id: "i1", member_id: "adult-2", status: "reserved" },
    { id: "c2", item_id: "i2", member_id: "adult-1", status: "bought" },
    { id: "c3", item_id: "i1", member_id: "adult-1", status: "bought" },
  ];

  it("keys claims by item, first one read winning", () => {
    const map = claimsByItem(claims);
    expect(map.get("i1").id).toBe("c1");
    expect(map.get("i2").id).toBe("c2");
    expect(claimsByItem(null).size).toBe(0);
    expect(claimsByItem([{ id: "x" }]).size).toBe(0);
  });

  it("names every state from the viewer's side", () => {
    expect(claimState(undefined, "adult-1")).toBe("open");
    expect(claimState(claims[0], "adult-1")).toBe("taken-reserved");
    expect(claimState(claims[0], "adult-2")).toBe("mine-reserved");
    expect(claimState(claims[1], "adult-1")).toBe("mine-bought");
    expect(claimState(claims[1], "adult-2")).toBe("taken-bought");
  });

  it("labels someone else's claim with their name, or someone", () => {
    expect(claimLabel(claims[0], members)).toBe("Reserved by Morgan");
    expect(claimLabel(claims[1], members)).toBe("Bought by Alex");
    expect(claimLabel({ member_id: "gone", status: "bought" }, members)).toBe("Bought by someone");
  });
});

describe("supervises / canEditListOf in a shared space", () => {
  const adult = { id: "adult-1", role: "adult" };
  const kid = { id: "child-1", role: "child" };
  const space = { tenantKind: "shared_space", isAdmin: false };
  const stewardSpace = { tenantKind: "shared_space", isAdmin: true };

  it("every adult supervises in a household, only the admin in a space", () => {
    expect(supervises(adult)).toBe(true);
    expect(supervises(adult, space)).toBe(false);
    expect(supervises(adult, stewardSpace)).toBe(true);
    expect(supervises(kid, stewardSpace)).toBe(false);
  });
  it("offers a child's list only to a supervisor", () => {
    expect(canEditListOf(adult, kid, space)).toBe(false);
    expect(canEditListOf(adult, kid, stewardSpace)).toBe(true);
    expect(canSeeMember("child-1", {}, adult, kid, space)).toBe(false);
  });
});
