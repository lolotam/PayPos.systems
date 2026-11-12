# Plan 68-3 — the admin «الإجازات» tab in the employee file

Spec: [spec.md](spec.md) (FR-001, FR-003…FR-008, TD-2, TD-5, User Stories 1–2, sub-PR row 68-3).
Branch `feat/p1-068-3-leave-tab`, base `origin/main` `e8d5b8230`. Batch PP-168 (2026-11-11): plan debate Codex
`gpt-6-astra` medium one round (Astra was out of quota, the `pospay-advisor` stood in, see
[debate-68-3-astra.md](debate-68-3-astra.md)); production code Kimi `kimi-code/k3.1-pro`; tests Agy
`gemini-3.8-flash-high` (Kimi CLI fallback when Agy is denied); Claude writes briefs, reviews, runs gates and commits;
no push, PR or merge.

## Scope

In (admin UI and i18n only): the tab bar in the employee file; part (a) «طلبات جاية ومستنية»; part (b) the history
with filters and the last-taken line; the new i18n catalog; UI tests; the edits to the specs that mount the section.
Out: `apps/api`, `packages/db` and the leave-history SQL (68-2b-1 #951 is moving them), `packages/contracts`, the
generated client, the inbox (`leave-inbox-page`) and its components, the report screen (68-4, LH-Q12 stays there),
`packages/ui`. No migration. `schema.d.ts` already carries `getEmployeeLeaveHistory`, `LeaveHistoryPage` and `open` /
`as_of` on the employee list (verified), so **no client regeneration is needed**.
Open owner items: owner-questions §16 (wording of shared labels, PENDING, non-blocking). LH-Q12 and §15 concern the
report (68-2/68-4), not this tab.

## Decisions

| ID | Decision | Why |
|---|---|---|
| D1 | **Default period time zone.** FR-007 says «the business's effective time zone», but `WorkspaceBusiness` has no zone; only branches carry `effective_timezone`, which already includes the business fallback (spec #901 section). The section takes an optional `timeZone` prop: the panel passes the employee's primary branch zone; the standalone route and any miss fall back to the first business branch's zone. It only seeds the two date inputs (both editable); the server decides «today» per branch for the open split. Reported as a known approximation, not a blocking question (no contract change, no rule guessed) | no business-level zone is reachable from the admin without a contract change |
| D2 | **Two reads, one boundary (TD-2), tolerant of a failed history.** The history read starts first. The open read is `enabled` once the history has settled (data or error): with data it sends `open: 'true'` and the history's `as_of`; after a history error it sends `open: 'true'` alone (the server clock), so an employee whose attachment ended (history 404, spec #901) keeps today's access to cancel, decide and revoke. Keys under the prefix `['leave', companyId, businessId, userId, employeeId]`: open `[..., 'open', cursor, asOf]`, history `[..., 'history', query, cursor]`, so `useLeaveDecisions` (prefix `['leave', company, business, user]`) and the save/cancel mutations refetch both parts after every own action (TD-2). Both use `placeholderData: keepPreviousData`, `refetchOnMount: 'always'`, `refetchOnWindowFocus: 'always'`; the history polls every 30 s and the open read has its own 30 s interval only when it has no `as_of` (otherwise the history's changing `as_of` drives it). The id cursor of (a) is independent of `as_of`. A history page 2 returns the first page's `as_of`; a tab left on it for 24 h gets the server's `400` as an alert in part (b), and «previous» restarts at page 1. Risk noted: the server refuses an `as_of` later than its own clock, so API instances with clock skew could answer 400 | TD-2 plus the review of 2026-11-12 |
| D3 | **Eviction.** `api/leave-query-scope.ts` holds `leaveScopeKey` and `useLeaveScopeEviction(companyId, businessId, userId, employeeId, openDenied)` with primitive arguments only: unmount and an open-read 403/404 remove every scope query. A history 403/404 is **not** evicted (removing a query whose observer is mounted makes it refetch in a loop); the history panel hides its rows while the read is in error and shows the alert, and part (a) is untouched. Rows of a read show only when its data is fresh for this mount or is placeholder data of a key change, so cached rows of an earlier visit never show before the first fresh answer | keeps the fresh-read guarantee without losing today's open-list access or looping |
| D4 | **Components.** `employee-leave-section.tsx` stays the section (the standalone route `staff/[employeeId]/leave` keeps rendering it, now with both parts) and is thin: it renders what `api/use-employee-leave-tab.ts` (orchestration: filter state seeded lazily, cursors, the two reads, mutations, eviction) returns. Part (a) is `leave-open-requests.tsx` (the existing `EmployeeLeaveHistory`, the request form, `LeavePagination`); part (b) is `leave-history-panel.tsx` (last-taken line, filters form, rows table with decision editor, loading/alert/empty, pagination), keyed by the applied query so the decision selection resets; with `leave-history-rows-table.tsx`, `leave-history-columns.tsx`, `leave-history-filters-form.tsx`, `leave-last-taken.tsx`. The inbox components stay untouched; the small cancel/approve/reject/revoke cell is repeated in the new columns rather than refactoring the inbox files | one component per file, the 60-line function cap, no inbox regression |
| D5 | **Row rendering (FR-003…FR-005a, TD-5).** `LEAVE`: dates (times and zone for a partial), type, status `leave.<status>` with the revocation reason in the details (FR-004), note and reasons, the four actions by flag. `UNEXCUSED_ABSENCE`: working date, type «غياب من غير عذر», status «غياب», the shift ranges (a split day keeps both), no action. `COVERED_ELSEWHERE`: date and the shift only, label «متغطي خارج الفرع», no type, status or action (BR-008: nothing about where). Rows render in server order; the UI never merges or dedupes; the table has `'use no memo'` like the existing one | no request shows twice: (a) and (b) are disjoint by the server's `open` split |
| D6 | **Filters (FR-006, FR-007, LH-Q8).** react-hook-form with a Zod form schema whose output is validated by `leaveHistoryQuery` (366-day range, `from <= to`); an invalid range shows an alert and sends nothing. Fields: from, to (default 1 January of the current year to today, seeded in a lazy `useState`), one type («الكل» or one), one status, optional branch (the workspace branches; an out-of-scope branch answers 404, shown as the part (b) alert). The absence type and the status «غياب» are offered only when the last response had a non-empty `absence_branch_ids`. Applying resets the history cursor; the last-taken line does not depend on the filters | spec |
| D7 | **Last-taken line (FR-008).** «آخر سنوية · آخر مرضية · آخر من غير مرتب» (range, one date when `from == to`, «مفيش» when null) plus «آخر غياب من غير عذر» only when `absence_branch_ids` is non-empty; hidden when `last_taken` is null | spec |
| D8 | **Tab bar.** `packages/ui` has no Tabs, so `employee-file-tabs.tsx` in `staff/ui` follows `attendance-exception-tabs.tsx`: a `role="group"` of buttons with `aria-pressed` (no tablist roles, so no keyboard contract to implement). «البيانات» holds every existing section unchanged and **stays mounted** (hidden with `hidden`) while «الإجازات» is open, so unsaved edits survive a tab switch; the leave panel mounts lazily and unmounts on leaving (its queries are removed by the eviction hook). The reload/close actions stay after the tab content on both tabs | no `packages/ui` change; no lost edits |
| D9 | **i18n.** New catalog `packages/i18n/src/leave-history-catalog.ts`, registered in `catalog.ts` as the section `leaveHistory` (the spec's `staff.leaveHistory.*` cannot be a nested key: `MessageKey` is two-level), with the spec's exact Arabic for the new labels. The existing `leave.*` labels («معلقة»، «ملغاة»، «بدون أجر») are shared with the inbox and are **not** reworded here; the difference from the owner's «مستنية»، «ملغية»، «من غير مرتب» is owner-questions §16 (PENDING, non-blocking, recommended: keep `leave.*`, unify later) | scope and inbox regression |

## Files and size (changed lines; the spec row estimates 300–400, which is low for UI plus tests)

| Category | File | Action | Est. |
|---|---|---|---|
| prod | `apps/admin/src/staff/api/leave-query-scope.ts` | create | 35 |
| prod | `apps/admin/src/staff/api/use-leave.ts` | edit (`open`, `as_of`, `enabled`, key; effects moved out) | +/-20 |
| prod | `apps/admin/src/staff/api/use-leave-history.ts` | create | 45 |
| prod | `apps/admin/src/staff/api/use-employee-leave-tab.ts` | create (orchestration) | 75 |
| prod | `apps/admin/src/staff/model/leave-history-filters.ts` | create | 60 |
| prod | `apps/admin/src/staff/ui/employee-leave-section.tsx` | rewrite | 55 |
| prod | `apps/admin/src/staff/ui/leave-open-requests.tsx` | create | 50 |
| prod | `apps/admin/src/staff/ui/leave-history-panel.tsx` | create | 65 |
| prod | `apps/admin/src/staff/ui/leave-history-rows-table.tsx` | create | 70 |
| prod | `apps/admin/src/staff/ui/leave-history-columns.tsx` | create | 90 |
| prod | `apps/admin/src/staff/ui/leave-history-filters-form.tsx` | create | 90 |
| prod | `apps/admin/src/staff/ui/leave-last-taken.tsx` | create | 40 |
| prod | `apps/admin/src/staff/ui/employee-file-tabs.tsx` | create | 30 |
| prod | `apps/admin/src/staff/ui/employee-edit-panel.tsx` | edit (tab state, hidden data panel, `timeZone`) | +30 |
| i18n | `packages/i18n/src/leave-history-catalog.ts`, `catalog.ts` | create + register | 65 |
| tests | `employee-leave-section.spec.tsx`, `employee-leave-section-history.spec.tsx`, `employee-file-tabs.spec.tsx`, `leave-history-filters.spec.ts`, `leave-history.fixture.ts`, edits to `use-leave.spec.tsx`, one i18n parity spec | create + edit | 500 |
| docs | this plan, the debate record, owner-questions §16 | create | 160 |

Production and i18n ~820, tests ~500: ~1320 against the spec row's 300–400, a ~3x overshoot of the spec's own sizing; the
manager is told in the report (the PP-112/§14 cap applies to the brief's estimate, 2x per category).

## Tests (visible outcomes, `CLAUDE.md` §9; fake `Date` only; the shared `api.GET` mock routes by path)

The default dates (1 January to today in the zone) · a filtered list after applying type or status (request carries the
filter, only matching rows show) · «مفيش» in the last-taken line · the absence row (a split day shows both ranges) · the
«متغطي خارج الفرع» row · an upcoming and a pending request in the top part and absent from the history · each request
shown once across both parts · cancel, approve/reject and revoke present on both parts, and the request form · after a
decision made in (b) both reads are requested again · the absence type and the last-taken absence item hidden for a
leave-only caller · an invalid range shows an alert and sends no request · the `types[]` wire key in the request URL ·
the tab switch keeps unsaved edits in «البيانات» and mounts «الإجازات» lazily · a history 404 shows the alert in part
(b) while part (a) still lists and acts · an open-read 403 evicts the scope · a history `400` shows an alert and
«previous» restarts · one Arabic-locale run for the labels. The open read waits for the history, then carries
`open=true` and that `as_of` (asserted next to the visible rows).

## Gates (PP-113)

`pnpm --filter @pospay/admin typecheck`, `pnpm --filter @pospay/admin lint`, `pnpm --filter @pospay/i18n typecheck`,
`pnpm --filter @pospay/i18n lint`, `pnpm lint:docs`, `pnpm module-map:check`, the touched admin specs and the i18n specs.
Then `clean-code-guard`, `test-guard`, `docs-guard`.
