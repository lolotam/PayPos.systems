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

### The branch audit

Every page under `apps/admin/src/**/pages` and its route in `_frame` that offers a branch choice was read. No working-branch picker keeps its own state: the five working-branch pickers of the attendance pages were already wired to `workspace.choose` by 074-11a, and their route specs already prove that choosing on the page calls `workspace.choose` with the same company and business and that a workspace branch change reaches the page. Nothing was changed, so no new two-direction test was needed.

| Page | Control | Class | Where the value comes from | Changed |
|---|---|---|---|---|
| `/staff/attendance` Attendance board | branch select in `attendance-board-filters.tsx` | working branch | the workspace branch (`scope.branchId`); the choice calls `workspace.choose` | No |
| `/staff/attendance-requests` Attendance requests | `attendance-action-branch.tsx` (with «all branches») | working branch for a branch, filter for «all» | the workspace branch; «all» stays a page filter | No |
| `/staff/attendance-exceptions` Attendance exceptions | `attendance-action-branch.tsx` | working branch | the workspace branch | No |
| `/staff/attendance-report` Monthly report | `attendance-report-filters.tsx` (with «all branches») | working branch for a branch, filter for «all» | the workspace branch; «all» stays a page filter | No |
| `/staff/attendance-statement` Statement | branch select in `attendance-statement-form.tsx` | working branch | the workspace branch | No |
| `/ratings` Ratings | branch filter in `ratings-filters.tsx` («all branches») | filter | the page's own filters state, default «all branches» | No |
| `/leave` Leave approvals | branch filter in `leave-inbox-filters.tsx` («all branches») | filter | the filter form, default «all branches» | No |
| `/staff/leave-history` Leave history | branch filter in `leave-history-filters-form.tsx` | filter | the filter form, default «all branches» | No |
| `/alert-rules` Alert rules | `scope-selector.tsx` (the business or one branch) | scope | the page's own state, default the business | No |
| `/catalog/categories` Service categories | `service-category-scope-select.tsx` (the business level or one branch) | scope | the page's own state, default from `openingBranch` | No |
| `/staff` Create and edit employee | branch field in `employee-placement-fields.tsx` | neither: a field of the employee record | the employee's own branch | No — open point |
| `/staff/[employeeId]/leave` Employee leave | branch field in `leave-branch-field.tsx` | neither: a field of the leave request | the leave request's branch | No — open point |
| `/schedules/settings` Schedule settings | no picker: the panel lists the branches of the business with their limits and edits the limit of the workspace branch | no choice | the workspace branch | No — open point |

No filter default was changed, and the existing tests of the filter pages pass unchanged.

### Changed assertions

1. `navigation-model.spec.ts`, «resolves an embedded page through its published Soon alias»: the fixture was rewritten with a literal embedded entry because the model holds no embedded entry any more — the schedule settings page became a route of its own. The assertion was kept as it is, with the reason in a comment next to it.
2. `navigation-model.spec.ts`, the Soon-entry boundary test: `pageEntryHref(scheduleSettings)` now expects `/schedules/settings`, and the test resolves both `/schedules/settings` and `/schedules` to their own entries.
3. `schedule-settings-current.spec.tsx`, the style B case: the local list of `/schedules/settings` in style B is the Setup module's Business column, so «Weekly schedules» is not in that list any more. The assertion now reads that it is absent instead of reading a missing `aria-current`; the list still holds exactly one current entry, and it is the settings page.

No other existing assertion was deleted or weakened. The specs of the tables that lost their own card (`permission-membership-table.spec.tsx`, `schedule-edit-dialog.spec.tsx`) pass unchanged.

### Guard results

`clean-code-guard` and `test-guard` were run over the whole branch diff; the findings and what was done about them are in the last section of these notes.

### What is not verified

The widths, the stacking under 600px, the 44px targets, the padding inside the cards and the Arabic layout are CSS outcomes: they are not browser-verified and belong to the 074-7b browser pass (#1192). The polling of the week read was not exercised either; only the request counts on the first mount and after a filter change.

### Sizes (against `origin/main`)

The whole branch is production +506 / −226 = 732 and tests +699 / −0 = 699, so 1,431 lines added plus removed outside the docs, inside the 2,800 cap. Steps 4 to 6 alone (against `af59d7bfb`) are production +434 / −211 = 645 and tests +360 / −1 = 361, so 1,006 lines. The docs are 89 lines (this file) and the generated maps are 4 lines (2 in `app-map.md`, 2 in its source), counted separately.

