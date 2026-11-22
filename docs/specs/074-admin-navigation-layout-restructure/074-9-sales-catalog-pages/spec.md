# 074-9 — Sales and Catalog pages on the shared templates: delivery spec and plan

Parent: [`spec.md`](../spec.md) (FR-002, FR-008, FR-015, FR-016), [`design.md`](../design.md) §6 and §7, [`pr-sequence.md`](../pr-sequence.md) row 9. Reference delivery: [`074-3-8-shell-parts-and-page-frame`](../074-3-8-shell-parts-and-page-frame/spec.md), whose three migrated pages (Services, Add service, Business identity) are the pattern to copy. Where this file is silent, those documents decide.

Tier Medium (`pr-sequence.md`, recommended tier for rows 9 to 11). One PR. Review pipeline PP-228. Independent of 074-7: every page here renders inside today's frame.

## What changes for a user

The Sales and Catalog pages get the same layout as the three reference pages: a centred page of a fixed maximum width, one header, cards in the template's order, and tables that become stacked cards on a phone. Nothing else changes: same addresses, permissions, data, validation, messages and actions.

| Page | Address | Component | Template (`design.md` §6) |
|---|---|---|---|
| Record a visit | `/orders/service-sessions/new` | `orders/pages/record-service-session-page.tsx` | Two-column: form in the main column, the draft summary in the side column, sticky from 1024px |
| Day list | `/orders/service-sessions` | `orders/pages/service-session-day-page.tsx` | List |
| Sell a package | `/orders/package-sales/new` | `orders/pages/package-sale-page.tsx` | Form (840px) |
| Customer packages | `/orders/customers/[customerId]/packages` | `orders/pages/customer-packages-page.tsx` | List |
| Categories | `/catalog/categories` | `catalog/pages/service-categories-page.tsx`, `service-categories-screen.tsx`, `branch-service-categories-section.tsx` | List |
| Package types | `/catalog/package-types` | `catalog/pages/package-types-page.tsx` | List |
| Add package type | `/catalog/package-types/create` | `catalog/pages/create-package-type-page.tsx` | Form (840px) |

Already done in 074-3 + 074-8 and not touched here: Services (`/catalog`), Add service (`/catalog/create`).

## Requirements

1. Each page above is wrapped in `PageShell` with the variant its template names, and uses `PageHeader` for title, one-line description and actions (one primary action at the inline end, further actions as outline buttons before it).
2. List pages: one card holding filter bar, table and footer with paging, in that order, using `DataTableFrame`'s filter and footer areas. Stacked rows under 600px are switched on for each table here: the first cell is the card title and every other cell shows its column label above its value. Row actions stay reachable and at least 44px tall.
3. Form pages: one card of titled sections on the 12-column grid (fields span 6, short fields 4, long fields 12), action bar at the card foot with the primary action last. On a phone the fields stack in one column.
4. Record a visit: two-column from a 1024px viewport, stacked below it with the form first. The draft summary is in the side column and stays in view while the form scrolls (sticky) from 1024px. If the page has no separate summary block today, do not invent one: report it as an open point and lay the page out as a form.
5. Behaviour is unchanged: addresses, permission checks, data reads and writes, validation, loading, empty, error and success messages, and every existing test assertion about these pages stay. Only layout moves.
6. Look: no colour, font, radius or button-variant change. Logical inline properties only. All text through `packages/i18n`; a new key is allowed only for a form section title or a stacked-row label that has no existing key, in `ar` and `en` together.
7. The inline edit panel under the Services list: the 3+8 spec says it «moves in 074-9» but no document says where. Leave it where it is and record it under «Open points»; do not guess a destination.

## Not in this PR

The frames, the style switch and new routes (074-7). Team and Pay pages (074-10). Attendance, Leave and Setup pages (074-11). Any `packages/ui` change other than a defect that blocks a template (list each one). No API, contract, migration, permission, dependency or deploy change.

## Acceptance

1. Each of the seven pages has a rendered test asserting the visible structure of its template (for a list: filter, table and paging inside one card; for a form: the primary action last at the card foot; for Record a visit: form before summary), in addition to every existing assertion, which stays.
2. Each table has a rendered test showing a stacked row's labels are present for the phone layout (the label text beside or above the value in the DOM, as the 3+8 Services test does).
3. No existing test for these pages is deleted or weakened. A changed assertion is listed with the reason.
4. `pnpm typecheck`, `pnpm lint`, `pnpm lint:docs`, `pnpm module-map:check` and `pnpm --filter @pospay/admin test` pass.
5. Widths, sticky behaviour, stacking under 600px and 44px targets are CSS outcomes a DOM test cannot measure. They are verified in the browser pass that follows the 074-7b release (#1192) and are reported here as not browser-verified.

## Plan

1. Read the three reference pages as merged on `main`, their tests, and the `PageShell`, `PageHeader` and `DataTableFrame` props and specs in `packages/ui`.
2. Catalog first: Package types, Add package type, Categories. Commit with tests green.
3. Sales: Day list, Customer packages, Sell a package, then Record a visit. Commit with tests green.
4. Gates, guards (`clean-code-guard`, `test-guard`), size count.

Estimate: 650 production, 750 tests. Stop and report if code plus tests passes 2,800 added plus removed lines.

## Implementation notes

*(filled by the implementer: per page what moved, changed assertions, `packages/ui` changes, open points, actual sizes)*
