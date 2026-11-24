# 074-11b — Schedule settings page, Setup pages on the templates, branch pickers: delivery spec and plan

Parent: [`spec.md`](../spec.md) (User Story 4 scenario 4: «the shift limits are on their own Schedule settings page, linked from the Weekly schedules header»), [`design.md`](../design.md) §4 (route map rows `/schedules` and «`/schedules` settings block», «New routes») and §6 (templates), [`pr-sequence.md`](../pr-sequence.md) row 11, [`074-11a-attendance-leave-pages/spec.md`](../074-11a-attendance-leave-pages/spec.md) (the layout rules this slice reuses, and its note «Branch pickers still read their own state (11b)»).

## Owner decision

Waleed, 2026-11-24, in the 074 session: «يلا نكمل واحدة بواحدة نخلصها وندمج» (PP-260), which ends the «after launch» deferral. The 11a/11b split is PP-234. Tier Medium (front end only; no money, permission, migration, API or contract change). Estimate 1,400 added plus removed lines of code and tests; cap 2,800; review fixes up to 4,200. Gate: `ci-gate` on the exact head and the implementer's guards; no separate independent review unless the diff touches permissions or sign-in (it must not).

## What changes for a user

1. **Schedule settings is its own page** at `/schedules/settings`, with its own menu entry in all three styles. The block leaves the top of Weekly schedules. Weekly schedules keeps a link to it in its header.
2. **Six Setup pages get the shared page layout** (centred page of the template width, one header, cards in the template's order, tables that become stacked cards on a phone): Weekly schedules, Permissions, Alert rules, Staff app link, Staff app columns, Imported refunds.
3. **Branch pickers:** nothing a user can see changes, except where the audit below finds a «working branch» picker that kept its own state.

Addresses of existing pages, permissions, data, validation, messages and actions do not change.

## In scope

### 1. Schedule settings route

- New route file `apps/admin/app/(dashboard)/schedules/settings/page.tsx`, a thin re-export of a `_frame/schedule-settings-route.tsx` in the existing pattern (see `_frame/schedules-route.tsx`). It needs a ready workspace and a selected business, as the panel's scope does today (`companyId`, `businessId`, `userId`); it does not need a branch. No business chosen → the existing `admin.chooseBusiness` line.
- New page component `apps/admin/src/staff/pages/schedule-settings-page.tsx`: `PageShell` form variant (840px), `PageHeader` with the existing title key `shell.schedule_settings_title` (and an existing description key if one fits; no new copy), then `ScheduleSettingsPanel` unchanged in behaviour (same key, same scope, same requests, same refusal handling).
- `SchedulesPage` no longer renders `ScheduleSettingsPanel`. Its `PageHeader` gains one secondary action: a link to `/schedules/settings` labelled with `shell.schedule_settings_title` (outline style, before any primary action; use the app's link component the other header links use). The link is shown under the same condition the menu entry is visible.
- **Does the week grid depend on the panel?** `ScheduleLimitContext` takes `max_shifts_per_day` from the week read, not from the panel. Confirm. If saving the settings must refresh the week read (same query cache), keep that working across the two pages (invalidate by key on save, as today); prove it with a test: save on the settings page, open Weekly schedules, the new limit is used.
- **Navigation model** (`apps/admin/src/staff/nav.ts`): the entry `schedule-settings` gets `route: '/schedules/settings'`, loses `parent` and `embeddedInParent`, keeps its id, label, section and sub-menu, and gets the same `visible` condition the panel's access really has today (read `ScheduleSettingsPanel` and its hooks: if any user who opens `/schedules` sees the block, keep `always`; do not invent a permission). Placement in the three groupings follows `design.md` §4: A «Team › Schedules › Shift limits», B «Setup › Business», C «Team › Planning». Add any missing label key in `ar` and `en` only if the design names a label no existing key carries (search first).
- `navigation-model.spec.ts` and its route-coverage test pass with the new `page.tsx`; exactly one top-level entry is current on `/schedules/settings` in each style, and Weekly schedules is not marked current there. One rendered test per style through the mounted frame for the visible current item on the new route.
- A direct link to `/schedules` still works; there is no redirect. An old `/soon/schedule-settings` address, if that id was ever published as a Soon entry (check `formerSoonId` handling and git history of the entry), forwards to the new route; if it never was, do nothing.
- **Map source:** change `docs/specs/074-admin-navigation-layout-restructure/app-map.shared.mjs` for the new route and regenerate both `app-map.md` outputs with the existing script, never by hand. Say so in the report: the manager opens the matching docs PR in `lolotam/lovable-pospay`.

### 2. Setup pages on the templates

Apply the 11a requirements 1 to 6 and acceptance 1 to 4 (read them in `074-11a-attendance-leave-pages/spec.md`; they are binding here word for word) to:

| Page | Address | Component | Template (`design.md` §6) |
|---|---|---|---|
| Weekly schedules | `/schedules` | `staff/pages/schedules-page.tsx` | List (week controls are the filter bar; the grid card; paging in the footer) |
| Permissions | `/permissions` | `permissions/pages/permissions-page.tsx` | Whichever its content is today: a list of roles/permissions → List; a form → Form |
| Alert rules | `/alert-rules` | `settings/alert-rules/pages/alert-rules-page.tsx` | Form (840px) with the scope selector above the card, unless its content is a table → List |
| Staff app link | `/staff/employee-app-link` | find it from `staff/nav.ts` id `staff-app-link` | Form (840px) |
| Staff app columns | `/staff-app-columns` | `settings/staff-app-columns/pages/staff-app-columns-page.tsx` | Form or List, whichever its content is today |
| Imported refunds | `/imported-refunds` | `settings/imported-refunds/pages/imported-refunds-page.tsx` | List |

Where the table says «whichever», read the page and choose; record each choice and its reason in the notes. A page already on `PageShell`/`PageHeader` with the right variant is left alone and listed as such. Behaviour is unchanged: same requests when a page is refused, one observer per query per screen, inputs keep their React position so focus and values survive a reload or a late refusal, dialogs and their focus return untouched (11a requirement 4).

### 3. Branch pickers: audit, then fix only one class

`design.md` §2 counted «a second picker on 8 pages». Since then the attendance pages were wired so their picker calls `workspace.choose(...)` (see `_frame/attendance-board-route.tsx`). Audit every page under `apps/admin/src/**/pages` and its route in `_frame` that offers a branch choice, and classify each:

- **Working branch** (the page shows one branch's data and the picker says which): its value must be the workspace branch and choosing must call `workspace.choose` with the same company and business. If the audit finds one that keeps its own `useState`, wire it like the attendance routes. The workspace switcher in the frame and the page picker then always agree; prove it with a test per fixed page (choose on the page → the frame's switcher shows that branch; choose in the switcher → the page shows that branch).
- **Filter or scope** (the control allows «all branches» or «business level», or filters a list: for example the Ratings filters, the leave report, Attendance requests «all», the Alert rules scope selector, Service categories' branch section): keeps its own state and its existing default. **No default changes in this slice.** This is a decision of the owning session: changing what a list shows by default is a product change, not a layout one.

The notes carry the audit table: page, control, class, where its value comes from, changed or not. If a control does not fit either class, do not change it; list it as an open point.

### 4. Docs in the same PR

`pr-sequence.md` (row 11: 11b done state; the branch-picker rule as delivered); this file with filled implementation notes; the regenerated `app-map.md` files. No ADR.

## Not in this PR

Employee detail and the employee leave page (10b); any API, contract, migration, permission, dependency or deploy change; `apps/admin/src/session/**`; `packages/ui` unless a template defect blocks you (listed with its reason); the three frames' code and the menu view model beyond the one entry; any colour, font, radius or button-variant change; changing any filter's default; the open 074 issues (#1192, #1227, #1236, #1237, #1239); the account preference work on branch `feat/074-12-account-nav-style` (do not touch `_frame/nav-style/**`, `dashboard-shell.tsx`, `src/shared/nav-style/**`).

## Acceptance

1. `/schedules/settings` renders the settings inside the frame with the right current item in A, B and C; `/schedules` no longer shows the block and its header links to the new page; a settings save is reflected on Weekly schedules.
2. Each of the six pages has a rendered test proving its template structure with what a user or a screen reader gets (11a acceptance 1), and each real table has a stacked-row test covering every cell (11a acceptance 2).
3. No existing assertion is deleted or weakened; each changed assertion is listed with its reason.
4. The branch audit table is complete; each fixed «working branch» picker has the two-direction test; no filter default changed (the existing tests of those pages pass unchanged).
5. `navigation-model.spec.ts` and the route-coverage test pass; label keys exist in `ar` and `en`.
6. Gates, each in the foreground and wrapped in `timeout`: `pnpm typecheck`; `pnpm lint`; `pnpm lint:docs`; `pnpm module-map:check`; `pnpm --filter @pospay/i18n test` if keys changed; `timeout 1800 pnpm --filter @pospay/admin test` (the whole admin suite, because the model and shared tables are touched). A `timeout` that fires is a hang: report the file, do not background it.
7. Widths, stacking under 600px and 44px targets are CSS outcomes: reported as not browser-verified.

Tests write expected literals, do not import production constants to assert against them, do not name a constant «token» or «secret», keep one React component per file (helpers included) and 60 lines per function.

**A trap already hit in this spec's work:** the frame specs mock modules with factories that `await import('./frame-test-support')`. Anything `frame-test-support` imports statically must not import a module mocked that way (the locale context, `next/navigation`), or every frame spec hangs at collection. If a frame spec stops collecting, look for that cycle first.

## Plan

1. Read the parents listed above, `schedules-route.tsx`, `schedules-page.tsx`, `ScheduleSettingsPanel` and its hooks, `staff/nav.ts`, the three groupings, `navigation-model.spec.ts`, the six pages and their specs, the attendance routes (the `workspace.choose` pattern).
2. Schedule settings route, page, model entry, header link, tests.
3. Map source and regenerated maps.
4. The six pages, one commit per page, tests with each.
5. Branch audit; fixes if any; tests.
6. Docs, gates, `clean-code-guard` and `test-guard` as skills, size.

Stop and report if: code plus tests passes 2,200 before step 6; a page needs a behaviour change to fit a template; the settings panel turns out to need a branch or a permission the route does not have; anything under `src/session/**`, `packages/ui` or the frames needs editing.

## Implementation notes

### The route and its visibility condition

`apps/admin/app/(dashboard)/schedules/settings/page.tsx` re-exports `_frame/schedule-settings-route.tsx`, which follows `schedules-route.tsx`: it needs a ready workspace, a session user and a selected business, and it does not need a branch (the branch part of the panel appears only when the workspace has a branch). The nav entry `schedule-settings` keeps `visible: 'always'`: the panel is readable by everyone who opens `/schedules`, and the read itself refuses the users who have no permission on it (the panel returns nothing on `FORBIDDEN`/`NOT_FOUND`). No permission was added and the `roles` of the app-map (`Owner`) were not turned into a show condition, because FR-022 hands that to the page's own permission once the page is built.

### The grouping placements

The three groupings are derived from the entry's `section` and `submenu`, so `section: 'team'` and `submenu: 'schedules'` put the page in the Team group of A and in the Team workspace of C by themselves. Style B was the one gap: `design.md` §4 and the B prototype put «إعدادات الورديات» in the Setup module's Business column, next to the business identity and the alerts, and the model could not derive that from the page's section. The model now carries one explicit placement for that page in style B (`STYLE_B_PAGE_PLACEMENT`), so:

| Style | Placement | Where it comes from |
|---|---|---|
| A | Team › Schedules | the entry's section and sub-menu |
| B | Setup › Business | the explicit placement of design.md §4 (the B prototype: `setup` › `Business` = identity, alerts, schedule rules) |
| C | Team › Schedules | the entry's section and sub-menu (the prototype calls that panel section Planning) |

The model labels every style with the app-map sub-menu names, so the C section reads «الجداول» and not the prototype's «التخطيط»; `design.md` §3 gives the app-map precedence over the design's own wording.

### The template per page, and why

| Page | Template | Reason |
|---|---|---|
| Weekly schedules `/schedules` | List | a week grid with a week picker and paging: the week controls are the filter bar, the grid is the card, the paging is its footer |
| Permissions `/permissions` | List | the page's content is the list of the role holders; the discount default is a form of its own above the list |
| Alert rules `/alert-rules` | Form (840px) | a request form of titled rule sections with a save button, not a table |
| Staff app link `/staff/employee-app-link` | Form (840px) | a link, a code and the actions: no table, no list |
| Staff app columns `/staff-app-columns` | Form (840px) | a form of check boxes and one number field with a save button |
| Imported refunds `/imported-refunds` | List | the spec's table names List; the page holds one card and has no table, no filter and no paging, so the list template degenerates to a header over one card |

Three pages keep a card of their own instead of taking the template's outer card, because an outer card would nest cards and change the look (11a requirement 5): the Alert rules page (its rule rows and its two switches are already bordered blocks), the Imported refunds page (its switch is one bordered block) and the Weekly schedules page (the grid card is the template's card).

The Permissions page keeps its scope selector above the card: the selector filters the membership list, but it lives outside the keyed membership browser, so it keeps its React position and the focus when the scope changes.

### Pages left alone

None of the six pages was already on `PageShell`/`PageHeader`: every one of them used a plain `<section>` (and the Imported refunds page its own `<h1>`), so every one was laid out. Left alone on purpose: the employee detail page and the employee leave page (step 10b), the three frames and the menu view model beyond the one entry, `packages/ui`, `apps/admin/src/session/**`, and every filter default in the app.

### Branch picker audit

Every page and rendered component offering a branch choice was read against its source and route. A «working branch» control reads one branch's data, so it must read the workspace branch and call `workspace.choose` with the same company and business. A «filter/scope» control allows all branches or the business level, or filters a list, and keeps its own state and default. Every cell below comes from code at the named file:line; where the code does not fit either class, the class is «unsure» with the reason.

| Page (address) | Control (component file) | Class | Where its value comes from | What choosing does | Allows «all branches» or «business level»? | Needs a change? |
|---|---|---|---|---|---|---|
| Header switcher, every page | `WorkspaceSwitcher` in `apps/admin/app/(dashboard)/_frame/frames/frame-workspace-switcher.tsx:39-59` | working branch | `workspace.branch` at `:35`, passed as `branchValue` at `:49` | `choose({ companyId: company?.id, businessId: business?.id, branchId })` at `:57-59`, calling `workspace.choose` at `:36` | No — branch options only (`:52`) | No — already reads the workspace branch and chooses the same company and business. |
| `/staff/attendance` Attendance board | Native select in `apps/admin/src/staff/ui/attendance-board-filters.tsx:29-35`, fed by `attendance-board-page.tsx:34-40` | working branch | route `workspace.branch ?? business.branches[0]` `attendance-board-route.tsx:16`, `scope.branchId` `:21`, page `:36` | page `onBranch` `:40` → route `:32-33` `workspace.choose({ companyId: scope.companyId, businessId: scope.businessId, branchId })` | No — no «all» option (`attendance-board-filters.tsx:30-35`) | No — already wired both ways. |
| `/staff/attendance-requests` Attendance requests | `AttendanceActionBranch` via `apps/admin/src/staff/ui/attendance-request-filters.tsx:28-32`; control `attendance-action-branch.tsx:22-35` | working branch for a branch, filter/scope for «all» | route `attendance-requests-route.tsx:14,19`; page `scope.branchId` unless local `view === 'all'` `attendance-requests-page.tsx:24-26,49` | a branch: page `:52-56` → route `:27-29` `workspace.choose` with `scope.companyId` and `scope.businessId`; «all»: only local `view` at page `:54` | Yes — «all branches» `attendance-action-branch.tsx:27-29` when `allowAllBranches` is set at `attendance-requests-page.tsx:51` | No — a concrete branch already chooses the same ids; «all» is a deliberate local filter. |
| `/staff/attendance-exceptions` Attendance exceptions | `AttendanceActionBranch` via `apps/admin/src/staff/ui/attendance-exception-filters.tsx:22` | working branch | route `attendance-exceptions-route.tsx:14,19`; page `attendance-exceptions-page.tsx:41` | page `:43` → route `:27-29` `workspace.choose` with `scope.companyId` and `scope.businessId` | No — `allowAllBranches` defaults to false (`attendance-action-branch.tsx:11,27`) | No — already wired. |
| `/staff/attendance-report` Monthly report | Native select `apps/admin/src/staff/ui/attendance-report-filters.tsx:41-54` via `attendance-report-filter-bar.tsx:35-42` | working branch for a branch, filter/scope for «all» | route `attendance-report-route.tsx:17,35`; page `selected` `attendance-report-page.tsx:35-37` | a branch: page `:68-71` → route `:45-50` `workspace.choose` with `scope.companyId` and `scope.businessId`; «all»: only local `all` at page `:69` | Yes — «all branches» `attendance-report-filters.tsx:46-48` when allowed by `attendance-report-route.tsx:43` | No — same as requests: the branch writes the workspace, «all» stays local. |
| `/staff/attendance-statement` Statement | Native select `apps/admin/src/staff/ui/attendance-statement-form.tsx:125-135` via `attendance-statement-page.tsx:132-144` | working branch | route `attendance-statement-route.tsx:18,22`; page `:134`; form `:127` | form `:128` → page `:144` → route `:43-48` `workspace.choose` with `scope.companyId` and `scope.businessId` | No — branch list only (`attendance-statement-form.tsx:130-134`) | No — already wired. |
| `/orders/customers/[customerId]/packages` Customer packages | Scope switch button `apps/admin/app/(dashboard)/_frame/customer-packages-scope-gate.tsx:26-37` (not a select) | unsure — a switch button, not a picker select; it still chooses a working branch | URL hint `scope_branch` `customer-packages-route.tsx:39` resolved to a validated choice `:35-47`; neither the workspace branch nor local state | button `:30-33` → route `:52-57` `workspace.choose(choice)` with `companyId`, `businessId` and `branchId` from `resolve-scope-hint.ts:51-53` | No — `choice` always includes a branch (`resolve-scope-hint.ts:27,51-53`) | No — it already calls `workspace.choose` with all three ids. |
| `/ratings` Ratings | Native select `apps/admin/src/ratings/ui/ratings-filters.tsx:33-44` | filter/scope | page local `filters` `ratings-page.tsx:34,63`; default `initialRatingsFilters()` `ratings-filters.ts:31-33` with `branchId: ''` | control `:36` → page `onChange` `ratings-page.tsx:66` `setFilters` | Yes — empty value means all branches (`ratings-filters.ts:4,32`, option at `ratings-filters.tsx:38`) | No — keeps its own state and all-branches default. |
| `/leave` Leave approvals | Native select `apps/admin/src/staff/ui/leave-inbox-filters.tsx:34-41` (uncontrolled `name="branch_id"`) | filter/scope | form reads FormData `:23-28`; submitted query in page state `leave-inbox-page.tsx:21,29`, default `{ limit: 20 }` at `:21` | submit `leave-inbox-filters.tsx:28` → `setQuery` `leave-inbox-page.tsx:29` | Yes — empty «all branches» option at `leave-inbox-filters.tsx:35` | No — a local list filter by design. |
| `/staff/leave-history` Leave history | Select `apps/admin/src/staff/ui/leave-history-filters-form.tsx:116-121`, options `:62-70` | filter/scope | query state `use-leave-report-state.ts:47`, default `firstQuery` `:38-41` → `defaultLeaveFilters` `leave-history-filters.ts:14-22` with `branchId: ''`; form defaults `initial` `leave-history-filters-form.tsx:85` from `leave-report-page.tsx:23` | submit `leave-history-filters-form.tsx:89-93` → `report.apply` `leave-report-page.tsx:43` → state `use-leave-report-state.ts:57-63` | Yes — empty «all branches» option `leave-history-filters-form.tsx:64` | No — local filter, no workspace write. |
| `/alert-rules` Alert rules | `apps/admin/src/settings/alert-rules/ui/scope-selector.tsx:22-35` | filter/scope | page local `useState<string | null>(null)` `alert-rules-page.tsx:24`; control `value` `scope-selector.tsx:24` | control `:25` → page `:41` `setBranchId` (also the form key at `:66` and query argument at `:25`) | Yes — empty value is the whole business (`scope-selector.tsx:27`) | No — a rule's scope, not the working branch. |
| `/catalog/categories` Service categories | `apps/admin/src/catalog/ui/service-category-scope-select.tsx:25-34` | filter/scope | page local `useState` `service-categories-screen.tsx:56-58` from `openingBranch` `:35-43` and route `rememberedBranchId` `service-categories-route.tsx:25`; control `value` `service-category-scope-select.tsx:27` | control `:28` → screen `:70` `setBranchId` | Yes — business-level option `service-category-scope-select.tsx:30-32` when `includeBusiness` (`service-categories-screen.tsx:59,68`) | No — a list scope, not the working branch. |

Controls that need a change: none. No filter default was changed, and no existing filter test was edited to make it pass.

Read but deliberately not in the table because the code proves they are not branch pickers: the employee record's primary branch field (`apps/admin/src/staff/ui/employee-placement-fields.tsx:27-42`) and branch checkbox list (`employee-branch-fields.tsx:14-26`), the leave request's branch field (`leave-branch-field.tsx:18-25`), the schedule settings branch list that only displays limits (`schedule-settings-panel.tsx:134-153`), the permission scope type plus free-text scope id (`permission-scope-fields.tsx:18-33`), and the orders forms that only read `scope.branchId` (`package-sale-form.tsx:134`, `record-service-session-form.tsx:79`).

### Changed assertions

1. `apps/admin/app/(dashboard)/_frame/navigation-model.spec.ts`, «resolves an embedded page through its published Soon alias»: the fixture was rewritten with a literal `EmbeddedLivePageEntry` (`:150-167`) because the model holds no embedded schedule settings entry any more — the page became a route of its own. The `findNavigationEntryByPathname` assertion was kept, with the reason in a comment next to it.
2. The same file's Soon-entry boundary test (`:415-417`): `pageEntryHref(scheduleSettings)` now expects `/schedules/settings`, and the test resolves `/schedules/settings` to `schedule-settings` and `/schedules` to `weekly-schedules`.

No other existing assertion was deleted or weakened. `schedule-settings-current.spec.tsx` is a new spec, not a changed assertion; its style B case reads that «Weekly schedules» is absent from the style B local list because the settings page sits in the Setup module's Business column, while exactly one link in that list is current. The specs of the tables that lost their own card (`permission-membership-table.spec.tsx`, `schedule-edit-dialog.spec.tsx`) pass unchanged.

### Guard results

`clean-code-guard` and `test-guard` were run over the whole branch diff. The audit recorded here changed only this notes file; no production code, test, route, frame, permission or dependency was changed by it.

### What is not verified

The widths, the stacking under 600px, the 44px targets, the padding inside the cards and the Arabic layout are CSS outcomes: no real browser session verified them, and they belong to the 074-7b browser pass (#1192). The polling of the week read was not exercised either; only the request counts on the first mount and after a filter change.

### Sizes (against `origin/main`)

Measured with `git diff --numstat origin/main...HEAD` at head `c681ac166`, before this audit note: production +464 / −223 = 687, tests +808 / −6 = 814, docs +168 / −3 = 171. Outside the docs that is 1,501 lines added plus removed, inside the 2,800 cap. Steps 4 to 6 alone (against `af59d7bfb`) are production +411 / −214 = 625, tests +450 / −1 = 451 and docs +78 / −2 = 80. The generated maps are counted inside docs.

