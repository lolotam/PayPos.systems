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

### What moved, per page

| Page | What moved | Test that proves the structure |
|---|---|---|
| Package types | `PageShell list`; `PackageTypesListPanel` now owns one `DataTableFrame stacked` with the paging in its footer; loading, error and empty states render inside the card; the table is bare with explicit roles and `data-cell-label` on every cell after the first | `catalog/pages/package-types-page.spec.tsx` (new) |
| Add package type | `PageShell form`; one card, titled section «Package details» (new key `catalogPackageTypes.basics`) on the 12-column grid (names span 6, price and validity span 4), services section keeps its own legend, save action last in the card foot | `catalog/pages/create-package-type-page-layout.spec.tsx` (new) |
| Categories (business view) | one `PageShell list` at `ServiceCategoriesScreen`; status tabs moved into the card's filter area; list, table and paging in one card; stacked rows | `catalog/pages/service-categories-layout.spec.tsx` (new) |
| Categories (branch view) | a `PageHeader` (title, lead, the same outline create button) replaces the bare lead and button row; view tabs in the filter area; table and paging in one card; stacked rows | same spec |
| Day list | `PageShell list` (keeps `dir`); one card holds the date and late filter, the visit cards and the «Load more» action in the footer; a refused day keeps the filter bar in the card beside the message and its retry | `orders/pages/service-session-day-layout.spec.tsx` (new) |
| Customer packages | `PageShell list` with `PageHeader`; the package cards and the load-more or retry action sit in one card; the unreadable-customer and proof-pending messages stay plain messages under the header | `orders/pages/customer-packages-page-layout.spec.tsx` (new) |
| Sell a package | `PageShell form`; the fields sit in one card, the sell action is last at the card foot, the sale result moved out of the card to below it | `orders/pages/package-sale-page.spec.tsx` (new) |
| Record a visit | `PageShell two-column` rendered by `RecordServiceSessionForm` (the form provider wraps both columns); the draft summary moved from between the recorder field and the lines to the side column, sticky from 1024px; the discount limit state moved from `SessionRecordingHeader` to the form so it travels with the summary; refusal and loading states render in `PageShell form` | `orders/pages/record-service-session-layout.spec.tsx` (new) |

### Changed assertions and fixtures

All assertions on these pages stay. Two fixtures and one selector changed because the DOM moved:

- `orders/pages/service-session-day-page.spec.tsx`, «uses the locale direction on the day list»: the selector `container.querySelector('section')` became `'[data-page-shell="list"]'`. The `dir` still sits on the page root, which is now the shell instead of a `section`.
- `orders/ui/session-tips-dialog.spec.tsx`: removed the props `hasNext` and `onMore` from the `ServiceSessionDayList` fixture. The load-more action moved to the card footer in `ServiceSessionDayBody`, so the list no longer takes them. No assertion touched.
- `orders/ui/session-recording-header.spec.tsx`: the harness now holds the limit state and renders `SessionDraftSummary` beside the header, because the header no longer renders the summary. The four assertions are unchanged.

### `packages/ui` changes

None.

### Other production changes outside the seven pages' own files

- `packages/i18n/src/catalog-package-types.ts`: one key, `basics`, in `ar` and `en` (the «Package details» section title).
- `BranchServiceCategoriesFrame` renamed `BranchServiceCategoriesGrid` (it is a bare table now).
- New `catalog/ui/list-query-states.tsx`: the loading, error and empty states shared by the three catalog list cards (keeps each panel under the 60-line function rule).
- New `orders/ui/record-visit-columns.tsx`: owns the form provider, the two-column shell and the discount-limit state for Record a visit (keeps `RecordServiceSessionForm` under the 60-line rule). `PackageTypeBasicsFields` takes an optional `grid` prop so the edit panel keeps its stacked fields.

### Open points

1. **No tables on the two Sales lists.** Day list and Customer packages are lists of cards, not tables, so there are no stacked rows to switch on and acceptance 2 does not apply to them. No table was invented. Stacked-row labels are proved for the three real tables: Package types, Categories (business) and Categories (branch).
2. **12-column grid and section titles on Sell a package and Record a visit.** Not done. Their fields are label, input and message fragments shared with the recovery and replay logic, so a grid would need a wrapper per field and would touch dense shared components. Both pages keep one column inside their card or column. A follow-up can do it per field component.
3. **Page descriptions.** Five of the seven pages have a title only; no description keys were added (the brief allows only section titles and stacked-row labels). Pages without a description: Add package type, Day list, Customer packages, Sell a package, Record a visit.
4. **Categories header order.** The scope select (branch or whole business) still sits above the header, because it switches between two page bodies that each own their header and their create action. Lifting it would move create and selection state, which this slice does not touch.
5. **Inline edit panels stay where they are.** The Services edit panel (requirement 7), the Package types edit panel and the Categories editor are still rendered below the list card; no document says where they move.
6. **Component rows in Add package type** (the «Sessions» input) stay stacked in their bordered row, not on the grid: the row is shared with the edit panel.

### Not verified in a browser

Widths, the 12-column grid spans, the sticky side column and its `top-4` offset under the final frame, stacking under 600px, 44px targets, the look of a nested card in Sell a package, Day list and Customer packages (cards inside the frame card), dialogs inside the Day list card (not clipped by its `overflow-hidden`), and the Arabic layout. They are CSS outcomes a DOM test cannot measure and wait for the browser pass after the 074-7b release.

### Sizes (against `origin/main`)

Production +527 / −384, tests +704 / −4, i18n +2, docs notes excluded. About 1,600 lines added plus removed outside docs, below the 2,800 stop line.
