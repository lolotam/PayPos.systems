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
| `formerSoonId` | Optional on a live entry: its previously published `/soon/<id>` ID. Keep it on promotion, including when the page becomes a child or an embedded section. Current and former IDs share one namespace. After checking the entry's current visibility, a promoted static route or embedded entry forwards to its concrete route (or concrete parent route), whereas a parameterized child with a published alias requires an explicit concrete `formerSoonDestination` and otherwise resolves to not found |
| `formerSoonDestination` | Optional on a live entry with a published `formerSoonId`: explicit concrete destination path (no dynamic `[param]`, e.g., a feature record picker) required before forwarding a promoted parameterized route (#1167) |
| `visible` | The condition that shows the page: the same permission or state check its `*-nav-item.tsx` uses today |
| `count` | Optional: where a pending count comes from |
| `state` | `live` (the page exists) or `soon` (not built). A `soon` entry has no `route` of its own; it opens `/soon/<id>` |
| `businessTypes` | The business types (PRD §7.1) that see the entry; empty means every type. It applies to `soon` and `live` entries alike and is checked against the business selected in the workspace switcher |
| `countries` | Optional: the countries whose businesses see the entry (ZATCA: Saudi Arabia only). Checked against the selected business, like `businessTypes`, for `soon` and `live` entries alike |
| `roles` | For a `soon` entry: the roles (PRD §3.2) that see it. A `live` entry uses `visible` instead |
| `section`, `submenu` | Where the entry sits in `app-map.md`; the three groupings are built from these |

**Rules**

- Every `page.tsx` under `(dashboard)`, plus `/security/two-factor`, has exactly one `live` entry.
- Every Management-area page listed in `app-map.md` has exactly one entry, `live` or `soon`. The other areas of that file are not part of this model.
- A page marked New in `app-map.md` (the Approvals inbox, Appearance) has no route until step 7 adds it. In steps 1 to 6 its entry is `soon`; step 7 turns it `live` in the same change that adds `/approvals` and `/appearance`. Nothing a user sees depends on this, because the model is not rendered before step 7.
- A `soon` entry carries the business types and roles that see it (NAV-Q14) and is hidden from everyone else. Building the page turns it `live` and gives it its route and its own condition in the same change.
- Each business area owns its entries, their conditions, section and sub-menu (`apps/admin/src/<area>/nav.ts`); the model only composes them and arranges sections per style.
- `visible` is moved as-is from today's code. This feature adds and removes no permission.

## Where business type and country come from

The menu checks `businessTypes` and `countries` against the business selected in the workspace switcher. Today that business carries neither value: `WorkspaceBusiness` in `packages/contracts/src/identity/workspaces.ts` holds only `id`, the two names and `branches`. The business type exists server-side as the vertical whose template is copied into the business settings (`packages/db/src/vertical-templates.ts`), and a country code exists only inside the tax rule of the business settings (`packages/contracts/src/settings/business-settings.ts`).

Step 0c of `pr-sequence.md` therefore adds two read-only fields to `WorkspaceBusiness` in `GET /v1/me/workspaces`: the business type and the country code. Which stored value each field is read from is settled in that step's own spec (`TODO(spec)`). Step 7 depends on step 0c. Until it merges, the model carries `businessTypes` and `countries` but nothing can apply them.

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
