# Plan 68-4 — the admin report screen «سجل الإجازات»

Spec: [spec.md](spec.md) (FR-006…FR-011, User Story 3, sub-PR row 68-4).
Branch `feat/p1-068-4-leave-report-screen`, base `origin/main` `d1ab2c773` (68-2c #997 and 50-3b #998 merged). Lanes: MiniMax-M3.1-Flash
(opencode) writes production code and tests, Kimi CLI is the fallback (Codex is out of quota until Nov 14 11:20, Grok and
Agy are not used); Claude writes briefs, reviews, runs gates and commits. No push, PR or merge (PP-186).

LH-Q12 runs on Waleed's pick «زي التبويب بالظبط»; Abu Salem's answer is still PENDING
([owner-questions.ar.md](owner-questions.ar.md) §13). The screen therefore shows exactly what the API returns.

## Scope

In (admin UI and i18n only): the report page and its navigation entry, shown to the holders of the leave read scope; the
employee and branch filters; the last-taken line for one employee; the heavy-report flow (the `422` refusal, the one POST,
the polling); the UI tests; the i18n keys.
Out: `apps/api`, `packages/db`, `packages/contracts`, `packages/ui`, the generated client (`schema.d.ts` already carries
`getLeaveHistoryReport`, `requestLeaveHistoryReport` and `getLeaveHistoryReportResult` — verified, so **no client
regeneration is needed**), the inbox and the tab components, except one tiny export edit named below
(`leave-history-columns.tsx` gains four `export` keywords); no migration.

## Decisions

| ID | Decision | Why |
|---|---|---|
| R1 | **Route `/staff/leave-history`** (spec US3: «under staff»). `apps/admin/app/(dashboard)/staff/leave-history/page.tsx` re-exports `LeaveReportRoute` from `app/(dashboard)/_frame/leave-report-route.tsx`; the nav entry `_frame/leave-report-nav-item.tsx` is added to `staff-navigation.tsx`, which also excludes `/staff/leave-history` from the «staff list» entry's active test | the sidebar's «staff list» entry matches every `/staff` path (`staff-navigation.tsx`), so a new entry needs the exclusion or both entries light up, as `/staff/attendance`, `/staff/import` and `/staff/employee-app-link` already do |
| R2 | **Access is a probe**, like `employee-app-link-nav-item.tsx`. `api/use-leave-report-access.ts` sends one `GET /v1/businesses/{businessId}/leave-history` with `from=to=2000-01-01` and `limit=1` (a fixed date: no clock, always a tiny fast read). Allowed when it answers 200 **or** the refusal `LEAVE_HISTORY_REPORT_REQUIRED`, which is raised only after every authorization (plan-68-2 D8). A 404, 403, `FEATURE_DISABLED` or any other error hides the entry. `retry: false`, `staleTime` 60 s, no polling, no focus refetch. The nav item renders nothing until allowed. The page itself never blanks on a 404: it shows the envelope message as an alert in the results area (a 404 can also come from a selected employee or branch outside her scope, LH-Q12) | there is no read-scope endpoint on the admin side (the scope is server-side, `LeaveReadAccess.check`); the cheapest read that answers the same question is one row over a fixed day, and the `422` itself proves the caller was authorized |
| R3 | **The report rows are read-only**: no cancel, decide or revoke (FR-011 gives the report no write, and a stored heavy result is a snapshot, plan-68-2 D14). Recorded as numbered product decision **PD-1**, to be named in the manager report | the spec's report has no actions, and the tab's actions mutate rows a stored snapshot can no longer change |
| R4 | **Columns**: employee (the name in the locale, then «#number»), period/date, branch (the workspace branch name by `branch_id`, falling back to nothing; the column header reuses the existing `leave.branch` key), type, status, details. To reuse the tab's cells, `leave-history-columns.tsx` gets four `export` keywords (the period, type, status and details builders); nothing else changes in it. New `ui/leave-report-columns.tsx` builds the employee and branch columns and composes the four. New `ui/leave-report-rows-table.tsx` (same shape as `leave-history-rows-table.tsx`, with `'use no memo'`, no actions) | the tab's builders already render the period, type, status and details of all three row types (`LEAVE`, `UNEXCUSED_ABSENCE`, `COVERED_ELSEWHERE`); exporting them avoids a second copy that would drift |
| R5 | **Filters**: `LeaveHistoryFiltersForm` is reused unchanged (period, type, status, branch; the defaults are 1 January of the current year to today in the first branch's time zone through `defaultLeaveFilters`, FR-007). The employee filter is a separate control `ui/leave-report-employee-picker.tsx` (a search input plus a `NativeSelect` fed by `useEmployees(...)` with `q`; the chosen employee stays selectable after the search changes; a failed or forbidden employees list shows a small status text and never breaks the report). Choosing an employee applies immediately; Apply on the form applies the period/type/status/branch. Both start a new «run» | the tab's form already carries the period and the three filters and already validates the range; the employee filter is not a tab concept, so it stays out of the shared form |
| R6 | **One sync read first.** Every run starts with `GET /v1/businesses/{businessId}/leave-history` (params: from, to, `types[]`, `statuses[]`, `branch_id`, `employee_id` when chosen, `cursor`, `limit` 20). The query key includes a run counter, so every Apply or employee change is a fresh read; `refetchInterval` false, `refetchOnWindowFocus` false, `retry` false | the server decides fast vs heavy (plan-68-2 D7/D8); the client only reacts to the `422`. A report is a point in time, and a re-fired read of a heavy query would create report jobs |
| R7 | **Heavy mode is detected by the envelope code `LEAVE_HISTORY_REPORT_REQUIRED`, never by status 422 alone.** It can only happen without an employee (an employee always makes the sync read fast, plan-68-2 D7) | the code travels in the error envelope, so the client reads the code and not the status number |
| R8 | **Exactly one POST per run**: `POST /v1/businesses/{businessId}/leave-history/reports` fires once when heavy mode is detected for that run (guarded by a ref holding the run number; a refetch, a remount or a focus must not fire a second one, because a `ready` or `failed` report is never reused — plan-68-2 D10 — and three pending reports answer `409 LEAVE_HISTORY_REPORT_BUSY`). Strict body: `from`, `to`, `types[]`, `statuses[]`, optionally `branch_id`; never `employee_id`, `cursor` or `limit` (the request is a strict object, plan-68-2c C3, and answers 400 on an extra key). A POST failure (BUSY, 404, anything) shows the envelope message as an alert and does not retry; the user re-applies | the acceptance is deduped and capped server-side, so the client must not multiply jobs by re-firing |
| R9 | **Poll only while pending**: `GET …/leave-history/reports/{reportId}` with `cursor` and `limit`; `refetchInterval` 3 s only while the status is `pending`, no focus refetch, `retry` false. States: `pending` shows a «preparing the report» status text; `failed` shows the stored envelope message (ar/en by locale; `LEAVE_HISTORY_REPORT_FAILED` or `LEAVE_HISTORY_REPORT_TOO_LARGE`); `ready` shows the rows and the pagination; an HTTP error (`LEAVE_HISTORY_REPORT_NOT_FOUND` after the report expired, `LEAVE_HISTORY_REPORT_STALE`, a 404) shows an alert and the user re-applies | the report is computed by the worker (plan-68-2 D12), so the polling stops as soon as the status is terminal |
| R10 | **Short or empty pages**: a `ready` page may be short or even empty with a non-null `next_cursor` (plan-68-2c C5: the window rule returns a short, even empty, page with a cursor). The empty message shows only when `items` is empty **and** `next_cursor` is null; «Next» stays enabled while `next_cursor` is set. Paging reuses `LeavePagination` (its «previous» restarts at page 1) | the stored result pages by a bounded window, so "no rows" is not the same as "no more rows" |
| R11 | **Cursors**: one `cursor` state, reset on every run (Apply, employee change). Sync cursors and report cursors are never mixed, because the mode is fixed per run | the two cursor shapes differ (the sync cursor carries `as_of`, the report cursor carries `{ report_id, seq }`) |
| R12 | **Last-taken line**: shown only when the run has an employee and the sync read succeeded with a non-null `last_taken`; `LeaveLastTaken` is reused with `showAbsence = offeredAbsence(absence_branch_ids)`. Report-job pages have `last_taken: null`, so there is no line there. The absence type and status are offered in the form only when the last response had a non-empty `absence_branch_ids` (the same rule as the tab) | `last_taken` is computed only with `employee_id` (FR-008), and a stored report returns `last_taken: null` (plan-68-2c C5) |
| R13 | **Query keys** use their own prefix `['leave-report', companyId, businessId, userId, …]`, not the tab's `['leave', …]` prefix; the prefix is removed on unmount | `useLeaveDecisions` invalidates the `['leave', …]` prefix after every own action; the report has no actions, so it must stay out of that invalidation |
| R14 | **i18n**: six new keys in the existing `packages/i18n/src/leave-history-catalog.ts`, in both `leaveHistoryEn` and `leaveHistoryAr` (the Arabic parity type already forces both): `reportTitle` «سجل الإجازات» / "Leave history report", `reportEmployee` الموظفة / Employee, `reportAllEmployees` كل الموظفات / All employees, `reportSearchEmployee`, `reportEmployeesUnavailable`, `reportPreparing` «بنجهّز التقرير…» / "Preparing the report…". The branch column adds no key: it reuses the existing `leave.branch`. Other existing keys are reused wherever they already fit (`leave.*`, `leaveHistory.*`, `admin.loading`). The navigation label reuses `reportTitle` | the tab's catalog is the section for both screens, and the Arabic parity type turns a missing Arabic string into a type error. The Arabic `reportTitle` repeats `leaveHistory.historyTitle` («سجل الإجازات») while the English one says "Leave history report" to tell the report from the tab |

## Files and size (changed lines)

The spec row 68-4 says 250–350, which is low: the tab's row 68-3 ran about 3x its own estimate (300–400 planned,
~1,320 delivered: production and i18n ~820, tests ~500). This slice has the same shape — a screen, five hooks, four
components and their tests — so it is estimated at ~3x the spec row as well; the manager is told in the report (the
PP-112/§14 cap applies to the brief's estimate, 2x per category).

| Category | File | Action | Est. |
|---|---|---|---|
| prod | `apps/admin/src/staff/api/use-leave-report-access.ts` | create (the access probe) | 45 |
| prod | `apps/admin/src/staff/api/use-leave-report-sync.ts` | create (the sync read) | 50 |
| prod | `apps/admin/src/staff/api/use-leave-report-job.ts` | create (the POST and the polling) | 55 |
| prod | `apps/admin/src/staff/api/use-leave-report.ts` | create (orchestration: run counter, cursor, one-POST guard, one normalised view) | 126 |
| prod | `apps/admin/src/staff/api/use-leave-report-state.ts` | create (state, run counter, outcome) | 90 |
| prod | `apps/admin/src/staff/model/leave-report-view.ts` | create (pure helpers: `isReportRequired(error)`, `toReportBody(query)`, view-state classification) | 60 |
| prod | `apps/admin/src/staff/pages/leave-report-page.tsx` | create | 80 |
| prod | `apps/admin/src/staff/ui/leave-report-employee-picker.tsx` | create | 70 |
| prod | `apps/admin/src/staff/ui/leave-report-columns.tsx` | create | 80 |
| prod | `apps/admin/src/staff/ui/leave-report-rows-table.tsx` | create | 55 |
| prod | `apps/admin/src/staff/ui/leave-report-results.tsx` | create | 80 |
| prod | `apps/admin/app/(dashboard)/_frame/leave-report-route.tsx` | create | 30 |
| prod | `apps/admin/app/(dashboard)/_frame/leave-report-nav-item.tsx` | create | 30 |
| prod | `apps/admin/app/(dashboard)/staff/leave-history/page.tsx` | create (the re-export) | 1 |
| prod | `apps/admin/app/(dashboard)/_frame/staff-navigation.tsx` | edit (add the nav item, exclude the path from the «staff list» active test) | 3 |
| prod | `apps/admin/src/staff/ui/leave-history-columns.tsx` | edit (four `export` keywords) | 4 |
| i18n | `packages/i18n/src/leave-history-catalog.ts` | edit (six keys, both catalogs) | 25 |
| tests | `apps/admin/src/staff/pages/leave-report-page.spec.tsx` | create (the fast flow) | 190–230 |
| tests | `apps/admin/src/staff/pages/leave-report-page-heavy.spec.tsx` | create (the heavy flow) | 210–250 |
| tests | `apps/admin/src/staff/api/use-leave-report-access.spec.tsx` | create | 75–95 |
| tests | `apps/admin/src/staff/model/leave-report-view.spec.ts` | create | 65–85 |
| tests | `apps/admin/app/(dashboard)/_frame/leave-report-nav-item.spec.tsx` | create | 65–85 |
| tests | `apps/admin/src/staff/api/leave-report.fixture.ts` | create (the shared fixture) | 45–65 |
| tests | the i18n catalog parity spec | exists, unchanged | 0 |
| docs | this plan | create | 130 |

| Category | Estimate | Refuse above (2x) |
|---|---|---|
| Production (admin UI, hooks, i18n) | 600–800 (the file rows add up to about 795 with the i18n catalog and the two small edits) | 1,600 |
| Tests | 650–850 | 1,700 |
| Generated | 0 (the client already carries the three operations) | n/a |
| Docs | 130 | n/a |
| **Total** | **1,380–1,780** | |

## Tests (visible outcomes only, `CLAUDE.md` §9 and PP-7.2; fake timers; the shared `api.GET` / `api.POST` mock routes by path)

The navigation entry shows on a 200 probe and on the `LEAVE_HISTORY_REPORT_REQUIRED` refusal, and stays hidden on a 404
probe · the form opens on the default dates (1 January to today) · an employee chosen: the request carries `employee_id`,
the last-taken line shows, and with no employee there is no line · a filtered list (type or status) shows only the matching
rows and the request carries the filter · the heavy flow: the sync read answers 422 `LEAVE_HISTORY_REPORT_REQUIRED`, then
exactly one POST with the strict body (no `employee_id`, `cursor` or `limit`), then the «preparing the report» text while
the status is pending, then the rows after `ready` — and no second POST after 10 s of polling or a window focus · a
`failed` status shows the stored envelope message · `409 LEAVE_HISTORY_REPORT_BUSY` shows an alert and sends no second
POST · an empty ready page with a `next_cursor` shows no empty message and «Next» works; an empty ready page with a null
`next_cursor` shows the empty message · a 404 with an employee selected shows the alert and keeps the filters · the rows
show the employee name, the number and the branch · the rows carry no action buttons · an invalid range shows an alert and
sends nothing · one Arabic-locale run for the labels · a failing employees list leaves the report working.

## Gates (PP-113)

`pnpm --filter @pospay/admin typecheck`, `pnpm --filter @pospay/admin lint`, `pnpm --filter @pospay/i18n typecheck`,
`pnpm --filter @pospay/i18n lint`, `pnpm lint:docs`, `pnpm module-map:check`, the touched admin specs and the i18n catalog
specs. Then `clean-code-guard`, `test-guard`, `docs-guard`.
A fresh worktree needs `pnpm install` and a build of the workspace packages before the typecheck runs.

## Open owner items

LH-Q12: Waleed's pick «زي التبويب بالظبط» is applied — the screen shows exactly what the API returns, and the API already
enforces «زي التبويب» — while Abu Salem's answer is still PENDING ([owner-questions.ar.md](owner-questions.ar.md) §13).
owner-questions §16 (the shared wording of the status and type labels) stays PENDING, and its wording is unchanged here.

## Delivered notes

- The heavy POST is fired from an effect in `use-leave-report.ts`, and its guard is a ref holding the run number: one run
  fires one POST, and a refetch or a focus fires none.
- The result read keeps the previous page as a placeholder only while the report id is the same one, so a new run never
  shows the rows of the old report.
- The sidebar probe and the page's first read are two separate GETs on the same endpoint: the probe
  (`use-leave-report-access.ts`) is cached for 60 s, while the page's sync read is keyed by the run and never refetches on
  focus.
