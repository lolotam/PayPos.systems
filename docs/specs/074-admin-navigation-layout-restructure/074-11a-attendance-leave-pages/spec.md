# 074-11a — Attendance and Leave pages on the shared templates (layout only): delivery spec and plan

Parent: [`spec.md`](../spec.md) (FR-002, FR-008, FR-015, FR-016), [`design.md`](../design.md) §6 and §7, [`pr-sequence.md`](../pr-sequence.md) row 11. Pattern to copy: the merged deliveries [`074-3-8-shell-parts-and-page-frame`](../074-3-8-shell-parts-and-page-frame/spec.md) and [`074-9-sales-catalog-pages`](../074-9-sales-catalog-pages/spec.md), including the «Implementation notes» of 074-9, which record what three review passes corrected.

## Owner decision

Row 11 is delivered in two parts. Waleed, card of 2026-11-23, «نقسّم: التخطيط دلوقتي والمسارات بعد 7b (Recommended)»: **11a** (this slice) lays the existing Attendance and Leave pages out on the shared templates and adds no route; **11b**, after 074-7b merges, makes Schedule settings its own page, makes the per-page branch pickers read the workspace branch, and lays out the Setup pages (Weekly schedules, Permissions, Alerts, Staff app link, Staff app columns, Imported refunds). Tier Medium. Cap: 2,800 added plus removed lines of code and tests, docs counted separately. Review pipeline PP-228. Recorded as PP-234; its block is added to `docs/owner-decisions.ar.md` by the 074-10a PR.

## What changes for a user

Seven pages get the layout of the reference pages: a centred page of a fixed maximum width, one header, cards in the template's order, tables that become stacked cards on a phone. Addresses, permissions, data, validation, messages, actions and every branch or date picker's behaviour do not change.

| Page | Address | Component | Template (`design.md` §6) |
|---|---|---|---|
| Attendance board | `/staff/attendance` | `staff/pages/attendance-board-page.tsx` | Board: header → status blocks → table |
| Attendance requests | `/staff/attendance-requests` | `staff/pages/attendance-requests-page.tsx` | List |
| Attendance exceptions | `/staff/attendance-exceptions` | `staff/pages/attendance-exceptions-page.tsx` | List |
| Monthly report | `/staff/attendance-report` | `staff/pages/attendance-report-page.tsx` | List |
| Statement | `/staff/attendance-statement` | `staff/pages/attendance-statement-page.tsx` | Form (840px) |
| Leave approvals | `/leave` | `staff/pages/leave-inbox-page.tsx` | List |
| Leave history report | `/staff/leave-history` | `staff/pages/leave-report-page.tsx` | List |

Not in 11a: the employee leave page (`/staff/[employeeId]/leave`, part of 10b), Weekly schedules and every Setup page (11b), and any change to how a branch picker chooses its branch (11b).

## Requirements

1. Each page is wrapped in `PageShell`: the list variant for six pages (the board uses the list width) and the form variant (840px) for Statement, whose content is a request form with a short outcome and no table. Each uses `PageHeader` for the title, an optional one-line description where an existing i18n key fits (no new copy), and actions: one primary action at the inline end, further actions as outline buttons before it.
2. List pages: one card holding filter bar, table and footer with paging, in that order, through `DataTableFrame`'s filter and footer areas. Stacked rows under 600px are switched on for every real table: the first cell is the card title; every other cell that has content shows its column label; a cell whose only content is an action carries no duplicate label; an empty cell collapses without `display: none`, so it stays in the accessibility tree. A list that is a set of cards and not a table keeps its cards and gets no stacked rows.
3. Board: header, then the filters, then the status blocks («in now», refusals and the like) in their current order, then the sessions table in its card. No block is merged, dropped or reordered beyond what the template names.
4. Behaviour is unchanged. In particular: a page that is refused keeps exactly the requests `main` makes (no new query observer that fetches while a screen is closed); one query has one observer per screen, so data, refusal and paging come from one snapshot; filters, date and branch pickers keep their React position so focus and their chosen value survive a late refusal, a reload or a decision; polling intervals, approve and reject actions, dialogs and their focus return are untouched.
5. Look: no colour, font, radius or button-variant change. `PageHeader`'s heading size is the template's and is intended. Logical inline properties only. All text through `packages/i18n`; a new key only for a stacked-row label with no existing key in either language (search the catalogs for the same text first), `ar` and `en` together.
6. One React component per file, test helper components included; 60 lines per function; 400 per file. `attendance-statement-page.tsx` is 166 lines today: if the template pushes it over a limit, split by responsibility, not by line count.

## Not in this PR

Any route, `page.tsx` or `layout.tsx`; anything under `apps/admin/app/(dashboard)/_frame/`, `apps/admin/src/shared/frame/` or the navigation model; `packages/ui` (unless a template defect blocks you, listed with its reason); Team and Pay pages (074-10a, running in parallel on another branch: do not touch `staff/pages/employees-page.tsx`, `create-employee-page.tsx`, `employee-import-page.tsx`, `document-types-page.tsx`, `staff/company-numbers/**`, `commissions/**`, or the `staff/ui` files only those pages use); any API, contract, migration, permission, dependency or deploy change.

## Acceptance

1. Each page has a rendered test that proves its template structure with what a user or a screen reader gets: the filter, the table and the paging are inside one card (`within(card)`), in order; for the board, the order header → filters → status blocks → table.
2. Each real table has a test covering every cell of a stacked row.
3. No existing assertion is deleted or weakened; a changed assertion is listed with its reason.
4. Tests do not pin implementation details where a visible or structural assertion exists, do not import production constants to assert against them, and do not name a constant «token» or «secret» (the PR's secret scanner flags it).
5. `pnpm typecheck`, `pnpm lint`, `pnpm lint:docs`, `pnpm module-map:check`, `pnpm --filter @pospay/admin test` pass.
6. Widths, stacking under 600px and 44px targets are CSS outcomes; they are reported as not browser-verified and belong to the 074-7b browser pass (#1192).

## Plan

1. Read the reference pages and 074-9's pages and specs as merged on `main`, then `PageShell`, `PageHeader` and `DataTableFrame` in `packages/ui`.
2. Leave: Leave approvals, Leave history report.
3. Attendance lists: Requests, Exceptions, Monthly report, Statement.
4. Attendance board.
5. Gates, guards (`clean-code-guard`, `test-guard` run as skills), size.

Estimate: 600 production, 850 tests. Review rounds roughly doubled 074-9, so stop and report if code plus tests passes 1,700 before step 5.

## Implementation notes

### What moved, per page

Six pages are now `PageShell layout="list"` and Statement is `PageShell layout="form"` (840px), all with `PageHeader`. One shared piece does the stacked rows: `staff/ui/stacked-table.tsx` (a table with no card, explicit roles, `data-cell-label` on every cell that has content, none on the first cell or on an action-only column, and no content, so a `:empty` cell collapses under 600px with `max-[599.99px]:empty:py-0`, never `display: none`) and `staff/model/stacked-cell.ts` (decides «has content»).

| Page | What moved | Proving test |
|---|---|---|
| Attendance board | Header, then the filters (outside any card), the last-updated line, In now, **Refusals (moved above the table)**, then the sessions table alone in its card (title «Sessions» is the card title; the section keeps its `aria-labelledby`) | `attendance-board-layout.spec.tsx` |
| Attendance requests | One card: branch and status filters, table, Load more. The «Manual entry» button moved from the filter bar to the header action | `attendance-requests-layout.spec.tsx` |
| Attendance exceptions | One card: branch picker and Open/Resolved tabs, table, Load more | `attendance-exceptions-layout.spec.tsx` |
| Monthly report | One card: month and branch filters, a sort control shown under 600px only, the download status and alert, then the hours note and the table. **Download is the header action** | `attendance-report-layout.spec.tsx` |
| Statement | The form in one card under the header; the request outcome below the card; the no-access state now shows the header and the shell around its message | `attendance-statement-layout.spec.tsx` |
| Leave approvals | One card: the filter form, the table (with the decision editor under it, as on `main`), paging | `leave-inbox-page-layout.spec.tsx` |
| Leave history report | One card: employee picker and filter form, then last-taken line, table, paging | `leave-report-page-layout.spec.tsx` |

Each spec asserts the structure with `within(card)` and document order, a stacked row's labels cell by cell, the request count on first mount, and that a refused read keeps the same filter element and its focus, with no paging beside the refusal. `stacked-table.spec.tsx` covers the content rules (first cell, action column, null, empty string, empty wrapper, fragment, the number 0).

### Requests, polling and states compared with `origin/main`

| Page | Result |
|---|---|
| Board | Unchanged: board read (30 s poll) and, only after board data and no access loss, the refusals read; the capabilities read still starts only when the sessions table mounts (visible board). The refusal block now sits above the table; its own states and Load more are untouched. |
| Requests | The page keeps the access read (30 s poll). The list query has one observer, in `AttendanceRequestsList`, which stays mounted so the filters keep their place. `enabled` is `!inboxAccess.isPending && Boolean(timezone)`: with no time zone no list read is made, as on `main`. **The list's lifetime follows the time zone exactly as on `main`** (round 1, P1): `useAttendanceRequestsLifetime` has two separate effects (round 2). **Selection:** it ends only when the time zone is lost (or at unmount); a workspace-branch change does not end it, so the editor comes back when the new read returns the same request `id` and `revision`, as on `main`; after a lost time zone returns, the row shows but the editor does not. **Cache:** the requests cache of the previous scope is removed at a scope change, at the moment the time zone disappears and at unmount, so when it returns the read starts fresh with no old rows. The editor and the selected row are computed only while a time zone exists, so no render after the flip shows a row, a name, a reason or a decision control. Proven by `attendance-requests-lifetime.spec.tsx` (a `Profiler` reads every commit; 4 tests). |
| Exceptions | Unchanged: one observer in the page, 30 s poll; the table needs a time zone, the message and Load more do not, as on `main`. |
| Monthly report | Unchanged requests: one report observer in the page, no poll. The CSV mutation is still owned by one keyed component (`AttendanceReportDownload`, key `branch:month`), now only the button, in the header; its status and alert text are shown by `AttendanceReportDownloadMessages`, keyed the same way, which only reads the mutation cache (`useMutationState`) and makes no request and no second mutation observer. Sorting state moved to the page so the header buttons and the sort control share it; its lifetime is the visible table's (round 2): it is keyed by `branch:month` while the table shows and by «no table» while a refusal or a load hides it, and it is reset during the render in which that key changes, so a month left and opened again, or a table hidden by a refusal and shown again by a retry, starts in source order, as the remount did. Under 600px the header shows plain column text and no sort button (the `matchMedia` width read by `useStackedWidth`), so the «Sort by» select is the only sort control there (see «PR review round 1», item 2). |
| Statement | Unchanged: every hook stays in the page; the outcome state (`checkingAgain`) stays in the page. |
| Leave approvals | Unchanged: one observer in the page (30 s poll, the inbox cache removal on 403 or 404); the editor, selection and mutations are inside the same keyed `EmployeeLeaveHistory`. |
| Leave history report | Unchanged: one observer (`useLeaveReport`) in the page; the footer and the body come from the same `view`. |

### Correction round 1 (review of head `60a97a097`)

| Item | Result | Proving test |
|---|---|---|
| 1 P1 Requests lifetime | Fixed: selection, editor and cache follow the time zone as on `main` | `attendance-requests-lifetime.spec.tsx` (2 tests; both fail without the fix) |
| 2 P2 sort under 600px | Fixed: «Sort by» select under 600px on the shared sorting state | `attendance-report-layout.spec.tsx`, «offers the same sorting…» (fails without the control) |
| 3 P2 empty leave cell | Fixed: the leave cell renders nothing for an empty array | `attendance-report-layout.spec.tsx`, «gives no label to the leave cell…» (fails without the fix) |
| 4 P2 Download in the header | Fixed with no second mutation observer and no change to when anything is requested | `attendance-report-layout.spec.tsx`, header, disabled states, busy and failed download |
| 5 P3 Sessions title | Fixed: `text-lg font-semibold` back on the title text | `attendance-board-layout.spec.tsx` |
| 6 P3 stacked class | Added, read from a literal, for every table (leave inbox through the closest ancestor, because the editor wrapper sits between) | the stacked-cell tests of the six table specs (fail when `stacked` is removed from the frame) |
| 7 P3 refusals | Board: a refusal without a remount keeps the filter element and focus; both Leave pages: 500 and 403, no employee data in any commit after the refusal | board, inbox and report layout specs |

### Correction round 2 (review of head `e4fe680a0`)

| Item | Result | Proving test |
|---|---|---|
| 1 P2 old sort comes back | Fixed: the sort lives and dies with the visible table | `attendance-report-layout.spec.tsx`: month left and opened again, and refusal then retry, both start in source order (both fail with the round-1 hook) |
| 2 P2 scope change cleared the selection | Fixed: selection ends only on a lost time zone; cache cleanup is separate | `attendance-requests-lifetime.spec.tsx`: branch change, new read returns the same row, the editor shows again (fails with the round-1 hook); round-1 tests stay green |
| 3 P2 hidden sort buttons in the Tab order | Fixed in round 2 with `tabindex=-1` at the stacked width; **superseded by PR review item 2 below**, which removes the buttons at that width | `attendance-report-layout.spec.tsx` (fails without the attribute) |
| 4 P3 literal «—» | Fixed: `catalogServices.missingValue` | same spec, first option text |
| 5 test gap | Covered by item 2's tests, plus «row shows, no editor, after a lost time zone returns» | `attendance-requests-lifetime.spec.tsx` |

### After the third review (PASS, three follow-ups)

| Item | Result | Proving test |
|---|---|---|
| P2 sort control on an empty report | The «Sort by» select is disabled when the read succeeded with no rows; the sort state is kept (not reset for the empty state), so a chosen sort applies again when rows arrive for the same `branch:month` | `attendance-report-layout.spec.tsx`, «disables the sort control for a report with no rows…» (fails without the new condition) |
| P3 `matchMedia` query | `useStackedWidth` uses `(width < 599.99px)`, the same strict comparison Tailwind generates, so the header, the select and the Tab order agree at exact equality; the test stub answers only for that exact query string | the stacked-width test (fails with the old `max-width` query) |
| (replaced) stacked-width test | The test that asserted `tabindex=-1` on header buttons is replaced by the PR review item 2 tests (no buttons at the stacked width), because the buttons no longer exist there | see above |
| P3 month tests | The two month-change tests pick a month different from the one the page shows, whatever the run date | the refusal and the month round-trip tests |

### PR review round 1 (MergePilot panel, PR #1235)

| Item | Result | Proving test |
|---|---|---|
| 1 MEDIUM Statement width | The outcome under the form is short text rows and buttons (status, error, download, new request), so the whole page, in the normal and the no-access state, uses the form shell (840px). This corrects the first delivery, which gave Statement the list shell; the open point «Statement is a form at list width» is closed. | `attendance-statement-layout.spec.tsx`: the page shell is `data-page-shell="form"` in both states (fails with the list shell) |
| 2 MEDIUM hidden sort buttons | At the stacked width the header cells hold plain column text and no sort button (`AttendanceReportHeader` → `AttendanceReportSortButton` only above the width). A focused header button that goes away because the width narrows hands focus to the «Sort by» select, and a focused select that is hidden because the width widens hands focus to the header button of the sorted column (the first button when nothing is sorted); both directions belong to one owner, `useSortFocusHandOver` (bot review round 2), which notes where focus is when the media query changes and applies the move after the render. | `attendance-report-layout.spec.tsx`: no button in the header cells and the select sorts; buttons named and sorting above the width; focus on a header button then narrowing lands on the select (the focus test fails without the hand-over) |
| 3 MEDIUM details label | The stacked cell of the details column is labelled by what it holds: `leave.decisionReason` for leave rows and the existing `attendanceStatementScreen.shift` («Shift» / «الشيفت») for unexcused-absence and covered-elsewhere rows. Searched both catalogs for a shift or scheduled-time label: `attendanceStatementScreen.shift` fits; `scheduledHours` («Scheduled hours») means a total; no key added. The desktop header and the column order are unchanged. `StackedTable` takes an optional `cellLabel`. | `leave-report-page-layout.spec.tsx`, row by row for a leave, an absence and a covered row (fails without the override) |
| 4 LOW childless elements | `hasStackedContent` recurses only into fragments and a fixed list of layout wrappers (`div`, `span`, `p`, `section`, `ul`, `ol`, `li`, `dl`, `dt`, `dd`, `strong`, `em`, `b`, `bdi`) that carry no `aria-label`, `aria-labelledby`, `title` or `role`; every other element (image, field, icon, link) is content even without children. | `stacked-table.spec.tsx`: an `img`, an `input` and a `span` with `role="img"` keep their cells and labels (fails with the old helper) |
| (bot round 2) widening hand-over | Added: select focused, width widens, focus lands on the sorted column's header button or the first one; the narrowing move now lives in the same hook | `attendance-report-layout.spec.tsx`, two widening tests plus «leaves the focus alone…» (both widening tests fail without the move) |
| (bot round 3) capture races the render | The round-2 hand-over listened on its own `MediaQueryList`, created after the ones the header cells listen on. A browser fires `change` per object in creation order and flushes React between them, so the header had already re-rendered when the capture ran. Now `use-stacked-width.ts` owns one `MediaQueryList` and one `change` listener for the module, with subscribers and a «before notify» group; `useSortFocusHandOver` registers its capture there and applies the move in its layout effect. The `useStackedWidth` callers are the header cells and the hook itself. Within the single listener the order is defensive (React flushes after the listener returns); what the tests prove is the single object. | `attendance-report-layout.spec.tsx`: the stub now models the browser (a distinct object per `matchMedia()` call, `change` fired per object in creation order with a React flush between); against the round-2 hook it failed the narrowing and both widening tests (3 of 17), and it passes with the fix |
| (bot round 3) secondary sort column | Widening lands on the header button of `sorting[0]`, the column the select shows (each header cell carries `data-sort-column`), and on the first sort button only when nothing is sorted | `attendance-report-layout.spec.tsx`, shift-click sort with the secondary column first in the table (fails when the first sorted header in DOM order is used) |
| 5 LOW desktop multi-sort | Not in this PR (tracked as a follow-up issue). | none |

### Changed assertions

One fixture change, no assertion changed: `staff/api/attendance-report-client.spec.tsx` («shows NOT_FOUND / FEATURE_DISABLED when the actual client receives a failed CSV download») rendered `AttendanceReportDownload` alone and read its alert; the alert now lives in `AttendanceReportDownloadMessages`, so the test renders both components with the same props and keeps its assertions (the alert text and the request URL). No other existing test file was edited. The DOM that moved without a test noticing: the empty `div` of the request row actions, of the session exceptions cell and of an empty leave cell is no longer rendered when it has nothing in it; the board refusals block comes before the sessions section.

### Shared `staff/ui` files touched

Attendance only (no Team or Pay page uses them): `attendance-actions-table`, `attendance-request-row-actions`, `attendance-session-columns`, `attendance-sessions-table`, `attendance-requests-list`, `attendance-request-filters`, `attendance-report-table`, `attendance-report-header`, `attendance-report-columns`, `attendance-report-download`, `attendance-report-results`, `leave-report-results`, `leave-report-rows-table`. Opt-in with an unchanged default, reachable from the employee leave page (10b): `leave-history-table` and `employee-leave-history` (prop `stacked`, default `false`). `packages/ui`: no change. i18n: one new key, `attendanceReport.sortBy` (`ar` and `en`), for the sort control; no existing text matched.

### Open points

1. Statement is a request form with a short outcome and no table: it uses the form shell (840px) and one card for the form (PR review round 1, item 1; the first delivery had given it the list shell).
2. Manual entry (Requests) and Download (Monthly report) are the header actions (the owning session's decision, round 1). The download status and alert stay in the card under the filters.
3. The leave decision editor and the last-taken line stay inside the card (between the table and the paging, and above the table), where they were in order on `main`.
4. The first cell is the card title as the template says: the board shows the employee number, Requests the branch, Leave approvals the period, the Monthly report the employee number. A better title needs a column reorder, which this layout-only slice does not do.
5. Under 600px the table header is visually hidden; the Monthly report gets a «Sort by» select (shown only under 600px, one new key `attendanceReport.sortBy`, `ar` and `en`) with every sortable column in both directions, on the same sorting state as the header buttons, whose header buttons are not rendered at that width. Its empty option reads `catalogServices.missingValue` («—» in both languages; nothing else in either catalog says «none» for a sort, so no key was added). The separator between a column name and its direction inside an option is punctuation, not text. The control's visibility is a CSS class and is not browser-verified; the width switch is a `matchMedia` read, tested with a stub.
6. The editor padding inside the Leave approvals card uses a CSS selector on the last child.
7. Branch pickers still read their own state (11b).

### Not verified

Widths, stacking under 600px, 44px targets, the padding of the messages and the editor inside the cards, the Arabic layout and a phone's sticky behaviour are CSS outcomes; they are not browser-verified and belong to the 074-7b browser pass (#1192). The 30 s polling itself was not exercised in a test; only the request counts on first mount and after a filter change.

### Sizes (against `origin/main`)

After the PR review round: production +1,046 / −391, tests +1,310 / −0, i18n +2, docs excluded: **2,747** lines added plus removed outside docs, inside the 2,800 cap (2,542 before the third review and this round).
