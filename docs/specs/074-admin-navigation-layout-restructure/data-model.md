# Data Model: Admin navigation — three switchable styles

Three of the four entities live in front-end code only. One is stored.

## Navigation style

A fixed set: `A`, `B`, `C`. Default `C`. Display names come from `packages/i18n`: "A — Sidebar and tabs", "B — Top bar and hubs", "C — Rail and panel".

**Validation**: any other value, including an old or damaged one, is treated as the default.

## Page entry (front end)

One admin page as the menu knows it.

| Field | Meaning |
|---|---|
| `id` | Stable identifier, unique across the app |
| `route` | The page's existing address |
| `labelKey` | `packages/i18n` key for its name |
| `descriptionKey` | Optional key for the one-line description used on overview cards |
| `icon` | A Phosphor icon exported by `packages/ui` (ADR-0060) |
| `parent` | Optional: the page this one is a child of (create and detail pages). A child has no menu entry of its own and marks its parent's entry current |
| `visible` | The condition that shows the page: the same permission or state check its `*-nav-item.tsx` uses today |
| `count` | Optional: where a pending count comes from |
| `state` | `live` (the page exists) or `soon` (not built). A `soon` entry has no `route` of its own; it opens `/soon/<id>` |
| `businessTypes` | The business types (PRD §7.1) that see the entry; empty means every type. It applies to `soon` and `live` entries alike and is checked against the business selected in the workspace switcher |
| `roles` | For a `soon` entry: the roles (PRD §3.2) that see it. A `live` entry uses `visible` instead |
| `section`, `submenu` | Where the entry sits in `app-map.md`; the three groupings are built from these |

**Rules**

- Every `page.tsx` under `(dashboard)`, plus `/security/two-factor`, has exactly one `live` entry.
- Every page listed in `app-map.md` has exactly one entry, `live` or `soon`.
- A `soon` entry carries the business types and roles that see it (NAV-Q14) and is hidden from everyone else. Building the page turns it `live` and gives it its route and its own condition in the same change.
- Each business area owns its entries, their conditions, section and sub-menu (`apps/admin/src/<area>/nav.ts`); the model only composes them and arranges sections per style.
- `visible` is moved as-is from today's code. This feature adds and removes no permission.

## Grouping (front end)

For one style, where each page entry sits.

| Style | Shape |
|---|---|
| A | groups → tabs → optional sub-pages (pills). Up to four groups are marked for the phone bottom bar |
| B | modules → columns → pages; a module may be a direct link. Each module with columns has an overview |
| C | workspaces → sections → pages. Each workspace has an overview on phones |

**Rules**

- Every page entry without a `parent` appears exactly once in each of the three groupings.
- Exactly one top-level entry is current for any route.
- A group, tab, column or section with no visible page is not shown.
- The placement of every route in each style is the route map in `design.md` §4.

## Style preference (stored)

A user's chosen style.

| Field | Type | Rule |
|---|---|---|
| `user.nav_style` | text, nullable | `A`, `B` or `C` when set (check constraint). `NULL` means "never chosen", shown as C |

- **Owner**: the user. One value per user, the same in every company they belong to.
- **Table**: `user`, a global identity table (ADR-0003). No tenant RLS. Reached only through `packages/auth` on the `pospay_auth` role.
- **Migration**: expand only. Add the nullable column and its check. No backfill, no index, nothing dropped.
- **Lifecycle**: unset → set on first choice → overwritten on each later choice. Never deleted separately from the user. Writes from one tab are serialised and coalesced to the newest choice (see `contracts/me-preferences.md`).
- **Device copy**: cookie `pospay_nav_style`, same three values. Written on every choice, overwritten from the account on sign-in, cleared on sign-out. It is a cache for the first paint, never the source of truth once the account value exists: it is refreshed from the account at every sign-in, and between sign-ins it only decides the first frame on that device.
