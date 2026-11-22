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

1. Each page above is wrapped in `PageShell` with the variant its template names, and uses `PageHeader` for the title, an optional one-line description where an existing key fits, and actions (one primary action at the inline end, further actions as outline buttons before it).
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

Two rounds: the first delivery, then correction round 1 after the independent review (findings P1-1 to P3-9). The notes show the state after round 1.

### What moved, per page

| Page | What moved | Tests that prove the structure |
|---|---|---|
| Package types | `PageShell list`; `PackageTypesListPanel` owns one `DataTableFrame stacked` with paging in its footer; loading, error and empty render inside the card; bare table with explicit roles; labels on every cell that has content | `catalog/pages/package-types-page.spec.tsx` |
| Add package type | `PageShell form`; one card; titled section «Package details» on the 12-column grid (names 6, price and validity 4); the services section rows (service 6, sessions 4, remove 2) on the grid from the create page only; save last at the card foot | `catalog/pages/create-package-type-page-layout.spec.tsx` |
| Categories | One `PageShell list` at `ServiceCategoriesScreen` with one header first in every state (no-branch state too), then the scope select, then the card; the status or view tabs, the table and the paging in one card; create action in the header; stacked rows | `catalog/pages/service-categories-layout.spec.tsx` |
| Day list | `PageShell list` (keeps `dir`); one card in one stable position holds the date and late filter, the visits and Load more in the footer; a refused read swaps only the card content and keeps the same filter inputs and their focus | `orders/pages/service-session-day-layout.spec.tsx` |
| Customer packages | `PageShell list` with `PageHeader`; package cards and the load-more or retry action in one card; proof-gating messages unchanged | `orders/pages/customer-packages-page-layout.spec.tsx` |
| Sell a package | `PageShell form`; one card with titled sections «Package» and «Payment» on the 12-column grid (recorder 6, customer and package type 12, price, method and seller 4 each); sale action last at the foot; the result below the card | `orders/pages/package-sale-page.spec.tsx` |
| Record a visit | `PageShell two-column` built by `RecordVisitColumns` (the form provider wraps both columns); the draft summary sits in the side column; the side column stretches to the row height so the sticky summary has room to move | `orders/pages/record-service-session-layout.spec.tsx` |

### Correction round 1: finding by finding

| Finding | Result | Proving test |
|---|---|---|
| P1-1 sticky summary had no room | Fixed. The template grid aligns its items `items-start`, so the side wrapper was only content tall. `RecordVisitColumns` passes `lg:[&>div:last-child]:items-stretch` to the shell root, which stretches the grid items from 1024px; the sticky summary stays a direct child of the side grid item. No `packages/ui` change. | `record-service-session-layout.spec.tsx`, «puts the sticky summary directly in the side grid item, and stretches that item to the row» (structure only) |
| P1-2 form template | Fixed for Sell a package (sections and 12-column cells; every field, label and message is one cell) and for the Add package type service row (opt-in `grid` prop; the edit panel is unchanged). Record a visit unchanged. | `package-sale-page.spec.tsx` (sections order, 4-column cells), `create-package-type-page-layout.spec.tsx` (row spans) |
| P2-3 Day list focus | Fixed. The page owns one `ServiceSessionDayFrame`; only its content and footer change. The body reports its load-more function to the page. | «keeps the same date input, and keyboard focus on it, when a later read is refused» |
| P2-4 branch actions label | Fixed. «Actions» label on the cell, visually hidden header (the header was empty). Stacked tests now cover every cell of all three tables. | `service-categories-layout.spec.tsx`, `package-types-page.spec.tsx` |
| P2-5 Categories header | Fixed. One header first in every state (the no-branch state included), then the scope select. The header and its create action belong to the screen; each view registers its create handler through `useRegisterCreateAction` when it is the visible one. A page or section rendered alone keeps its own header. The scope select stays one element, so its focus survives a view switch. | «a branch membership with no active branch still shows the page heading», «keeps the very same scope select, and its focus» |
| P2-6 one component per file | Fixed. Split: `ServiceSessionDayFrame`, `ServiceSessionDayLoadMore`, `ServiceSessionDayVisitSlot` (out of the list file), `PackageTypeName`, `PackageTypeSellingCell`, `BranchServiceCategoryMarks`, `ServiceCategoriesHeader`, `BranchServiceCategoriesHeader`. A scan of every file created or edited found no other file with two components. | lint (`max-lines-per-function`), typecheck |
| P3-7 price direction | Fixed: `<bdi dir="ltr">` around the number; the cell has no `dir`. | «isolates the price number as left-to-right» |
| P3-8 action-only cells | Fixed. Cells whose only content is a button (Edit, Open) carry no label. The Selling cell and the branch marks cell carry a label only when they have content, and are hidden under 600px when empty. The merged Services reference page labels its Edit cell with the header text, a duplicate of its button; it was not touched (brief). | «renders no label for a selling cell whose button is hidden», the stacked-row tests |
| P3-9 implementation-pinned tests | Partly. Width and `mx-auto` class checks were removed; headings, region order, labels and control presence are asserted instead. Kept as structure where nothing visible distinguishes it: the template identity (`data-page-shell`), the card (the frame has no landmark), the stacked classes on the table wrapper (so the tests fail if `stacked` is removed), the 12-column span classes. | the specs above |

### Changed assertions and fixtures

All assertions on the seven pages stay. Fixtures and selectors changed because the DOM moved:

- `service-session-day-page.spec.tsx`, «uses the locale direction on the day list»: `querySelector('section')` became `'[data-page-shell="list"]'`; `dir` is still on the page root.
- `session-tips-dialog.spec.tsx`: removed the props `hasNext` and `onMore` from the `ServiceSessionDayList` fixture (Load more moved to the page card footer). No assertion touched.
- `session-recording-header.spec.tsx`: the harness holds the limit state and renders `SessionDraftSummary` beside the header. The assertions are unchanged.

### `packages/ui` changes

None.

### Other production changes outside the seven pages' own files

- i18n: `catalogPackageTypes.basics`, `catalogServiceCategoryBranches.actionsColumn`, `packageSale.sectionPackage` and `packageSale.sectionPayment`, each in `ar` and `en`.
- `BranchServiceCategoriesFrame` renamed `BranchServiceCategoriesGrid` (a bare table now).
- New: `catalog/ui/list-query-states.tsx` (loading, error and empty states shared by the three catalog lists), `catalog/model/use-register-create-action.ts`, `orders/ui/record-visit-columns.tsx`, `orders/ui/service-session-day-list-props.ts`.
- `PackageTypeBasicsFields`, `PackageComponentsFields` and `PackageComponentRow` take an optional `grid` prop; the package type edit panel keeps stacked fields.

### Decisions by the owning session

- The header description is optional and used only where an existing key fits (requirement 1 amended). Add package type, Day list, Customer packages, Sell a package and Record a visit have a title only; no new copy was written.
- `PageHeader` makes the page title `text-2xl font-bold`. That is the intended template heading, not a font change.
- The inline edit panels (Services, Package types, Categories editor) stay below their list card. Day list and Customer packages are card lists with no table, so no stacked rows exist there; none was invented.

### Open points

1. The Categories create action moved from each view into the screen header. Its handler still lives in the view and is reached through the registration hook. A page or section rendered alone keeps its own header, which is how their specs render them.
2. Sell a package keeps its customer and package-type pickers as full-width cells; their internals are untouched.
3. Record a visit has no inner 12-column grid (two-column template), as the review decided.

### Not verified in a browser

Widths, the 12-column spans, the sticky behaviour of the summary (the stretch override and the `top-4` offset are CSS outcomes that only the browser pass can confirm), stacking under 600px and 44px targets, how cards nested inside the frame card look, dialogs inside the Day list card (not clipped by `overflow-hidden`), whether the registered create button keeps its focus ring across a view switch, and the Arabic layout. They wait for the browser pass after the 074-7b release.

### Sizes (against `origin/main`)

Production +962 / −560, tests +869 / −4, i18n +8, docs excluded. 2,403 lines added plus removed outside docs after round 1 (1,621 after the first delivery), below the 2,800 stop line.
