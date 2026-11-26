# Wish List

A [Chickadee Bandit](https://chickadeebandit.com/app-library/wishlist) app.

Personal gift wishlists for every family member. Add items with priorities and links; family can browse each other's lists.

## Features

- Personal wish lists per member, with priorities and optional links.
- Each item visible to everyone, adults only, or only its owner.
- Browse other members' lists, and mark an item **reserved** then **bought**. A claim is hidden from the
  item's owner (row policy `hidden_from_parent_owner`): they cannot read or write claims on their own
  items, whatever their role, while every other member who can see the item sees it is taken. (An admin's
  storage-usage totals still count every row in the table.) One claim per item (a unique index).
- In a household, adults (in a shared space, its admins) add to and edit a **child's** list (`supervisor_assigns_owner` + `supervisor_children_only`: an
  adult writes their own rows and the child's items they can see, never another adult's and never a child's
  "only me" item), and see the claims on it.
- Deleting an item deletes its claim too (`delete_cascades`): a giver who had marked it bought is not told.
- Share a read-only link to a list. The public page shows items marked "everyone" and never claims.

Needs a hub that knows `hidden_from_parent_owner` and `supervisor_children_only`: release this version only
after that hub is deployed.

## Install

In your hub, go to **Apps → Install from URL** and paste:

```
https://github.com/firebirdsystems/chickadeebandit-wishlist/releases/latest/download/bundle.json
```

## Development

See the [app-template](https://github.com/firebirdsystems/chickadeebandit-app-template) for build instructions and the full manifest field reference.
