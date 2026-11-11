# Plan 68-2 — the business leave-history report read

Spec: [spec.md](spec.md) (FR-001…FR-011, BR-001…BR-008, TD-1…TD-5, sub-PR row 68-2, LH-14, LH-14b).
Branch `feat/p1-068-2-leave-history-report`, base `origin/main` `73dbfc2fd`. Batch PP-168 (2026-11-11): plan debate
Codex `gpt-6-astra` medium one round; production code Kimi `kimi-code/k3.1-pro`; tests and any migration Agy
`gemini-3.8-flash-high`; Claude writes briefs, reviews, runs gates and commits; no push, PR or merge.

## Scope

In: `GET /v1/businesses/{businessId}/leave-history` over the 68-1b builder, with the same query as the tab plus an
optional `employee_id`; `excludeOpen=false` (TD-3, LH-14b); `last_taken` only with `employee_id`, else `null`; the
contract, OpenAPI and regenerated clients; result-shape, `EXPLAIN ANALYZE`, scope and integration tests.
Out: 68-3 (the tab UI), 68-4 (the report screen, i18n, navigation), any change to the tab route's behaviour, 68-1a's
open list, the inbox and 27g.

Reused unchanged: `LeaveReadAccess.check` (`persistence/leave-read-access.adapter.ts`), `leaveListRecord`, the cursor
codec (`shared/persistence/name-options-cursor.ts`), `leaveHistoryCursorData`, `leaveHistoryItem`, `leaveHistoryPage`.

## Decisions

| ID | Decision | Why |
|---|---|---|
| D1 | **PENDING (LH-Q12, owner-questions §13, `TODO(spec)`).** Whether the report applies the #901 unended-attachment rule. Recommended: yes, uniformly (with `employee_id` → 404 when no unended attachment in a readable branch, early check plus final-statement recheck; without it, one per-employee visibility predicate on all three row sources so the list never shows an employee whose filter answers 404). Alternatives: the inbox's any-attachment rule; or 404 with `employee_id` but old rows in the unfiltered list. | The spec's #901 section predates the report and names only the tab; the report with `employee_id` returns the same rows and `last_taken`, so without the rule it reopens what #901 closed. A "who sees what" rule is an owner decision (`CLAUDE.md` §1 5b, §11). Both advisors (pospay-advisor and the reviewer) concur. |
| D2 | **One builder, explicit modes (TD-3).** `historyDays`, `historyRows` and `leaveHistorySql` take the employee as optional and a new explicit `subject` option: `'eligible'` (the tab, today's `currentAttachment(days)` recheck, unchanged), and for the report with `employee_id` a subject that **always** rechecks the employee's existence (non-deleted, this business) in the final statement plus the attachment predicate D1 decides, or `'business'` (no employee: `TRUE`; deleted employees still drop out of all three row sources). The tab's rendered SQL text stays byte-identical (guarded by the existing 68-1b suites and one snapshot-of-SQL assertion). `last_taken` is computed only when an employee is named; otherwise the statement returns SQL `NULL`. `excludeOpen` stays an explicit argument: `true` tab, `false` report. | TD-3 rejects two SQL copies and implicit modes. `c.employeeId` is interpolated today in `leave-history-days.sql.ts:47`, `leave-history-rows.sql.ts:36`, `leave-history-last.sql.ts:10`, `leave-history.query.ts:31-34`. |
| D3 | **New reader file and controller.** `queries/leave-history-report.query.ts` holds `getBusinessLeaveHistory` and `LeaveHistoryReportReader` (owns `withTenant`, as `LeaveHistoryReader` does, the #897 R1 item 4 design), and `http/leave-history-report.controller.ts` (`@Authenticated()` + `SelectedCompanyGuard`, one controller per resource). Access call: without `employee_id`, `access.check` gets no `employeeId` and no `purpose` (the adapter denies `purpose:'history'` with no employee, `leave-read-access.adapter.ts:88-93`); with it, `employeeId` is set and `purpose` follows LH-Q12. Real order: query validation (400, pipe) → adapter `null` (unknown, foreign, soft-deleted or out-of-scope employee, or no read scope) → 404, which precedes `FEATURE_DISABLED` exactly as on the tab → `FEATURE_DISABLED` → bad cursor or `as_of` out of bounds → 400 on `cursor` → `branch_id` outside scope → 404 → final-statement subject false → 404. Tests: invalid employee + feature off (404), invalid employee + bad cursor (404), successful unfiltered read (200). | Keeps `leave-history.query.ts` under 300 lines and functions under 60 (`CLAUDE.md` §3). |
| D4 | **Contract.** `leave-history.ts` gets one shared shape object and two refined schemas: `leaveHistoryQuery` (unchanged behaviour; still strict, so `employee_id` on the tab answers 400) and `leaveHistoryReportQuery` (+ `employee_id: employeeInputId.optional()`). No new OpenAPI component id: parameters are built inline as in `leave-history-openapi.ts`; the response is `LeaveHistoryPage`. New path with `operationId` `getLeaveHistoryReport`. | Zod 4 refuses `.extend()` on a refined object. Spec lists only three ids. |
| D5 | **Clocks (FR-009, TD-2).** `scope.now` drives permissions, `can_revoke` and any eligibility; the cursor's `as_of` drives row-time predicates only, bounded to `[now − 24 h, now]`, both edges included (tested at each edge and 1 ms beyond). | Same as 68-1b (`leave-history.query.ts:74`). |
| D6 | **No migration expected.** Report shifts: `staff_schedule_shifts_company_starts_idx (company_id, starts_at)` with the existing `starts_at` bound, or the spec's `staff_schedules_branch_week_idx` then `staff_schedule_shifts_schedule_idx`; leave rows: `leave_requests_company_business_branch_dates_idx` (filter only; it cannot supply a global `from DESC, id DESC` order across branches); sessions: `attendance_sessions_employee_date_idx`. The EXPLAIN decides. A sequential scan on `leave_requests`, `staff_schedule_shifts`, `attendance_sessions`, `staff_schedules` or `employees` stops delivery; I report it to the manager and ask for the next migration number before Agy writes a `CONCURRENTLY` index migration (ADR-0033, PP-124/PP-130). | Spec "Schema changes", manager brief for this row. |

## Performance checkpoint and fallback

Risk: business-wide, `days` groups about 18k (employee, date) groups for a year and probes four `EXISTS` each before
`LIMIT` (the tab: about 365). SC-004 requires 200 ms p95 per route (`CLAUDE.md` §6; PP-165.1 keeps this budget).

Checkpoint, right after Kimi's delivery and before Agy's brief: I run `EXPLAIN (ANALYZE, BUFFERS)` and a 50-read timing
on the 68-1b performance fixture (`leave-history-performance.fixture.ts`: 50 employees, 2,650 schedules, 18,250
shifts, 1,000 leaves, foreign tenants), default year, for: page 1 with no `employee_id`; an absence-only filter; no
qualifying leaves (a type filter matching none); dense absences (sessions removed for a share of days); a late cursor;
a restricted branch scope; and `employee_id` with all-history `last_taken`. The budget holds in every case, not only on
the optimized page 1. The plan of all five tables, sorts and buffers is captured per case.

Fallback if a case misses the budget (correction round 1, Kimi): **leave-floor pushdown.** The candidates are the leave
rows after **every** predicate (visibility, employee, branch, period, type and status, `excludeOpen`, the full tuple
cursor). If at least `limit+1` exist, `floor` is the date of the `(limit+1)`-th in `(date DESC, rank, id DESC)` order and
`days` is bounded to `working_date >= floor`, ties on that date kept; with fewer, or with an absence-only filter, no
floor is applied (never a comparison with `NULL`). Correct because every row dated strictly before `floor` sorts after
at least `limit+1` qualifying rows. With a cursor, `days` is also bounded by `working_date <= cursor.date`, and the full
tuple cursor is applied afterward. Still one statement, one snapshot. Tests compare it with the unoptimized query for
zero, few and filtered leaves, later pages, and cursors at ranks 1–3. The cases with no floor stay unoptimized, so if
they miss the budget the next step goes to the manager (an index or a narrower default period), not a third design.

## Files (CLAUDE.md §1 order)

1. Contract (Kimi): `packages/contracts/src/staff/leave-history.ts`, `packages/contracts/src/staff/leave-history-openapi.ts`.
2. Migration/RLS: none (unless D6 fires; then Agy, after the manager names the number).
3. Domain: none.
4. Queries (Kimi): `apps/api/src/modules/staff/queries/leave-history-days.sql.ts`, `leave-history-rows.sql.ts`,
   `leave-history.query.ts`, new `leave-history-report.query.ts`; comments on shared fragments updated (`CLAUDE.md` §3.1).
5. HTTP (Kimi): new `apps/api/src/modules/staff/http/leave-history-report.controller.ts`; `staff.module.ts` (add the
   controller and the reader provider, add-only lines).
6. Generated (Claude, after the Kimi fence closes): `pnpm contracts:openapi` →
   `packages/contracts/openapi/openapi.json`; `pnpm --filter @pospay/admin api:generate` and the same for `pos`, `menu`
   (their `src/shared/api/schema.d.ts`).
7. Tests (Agy): new `apps/api/src/modules/staff/__tests__/leave-history-report.spec.ts` (integration),
   `leave-history-report-performance.spec.ts` (result shape + `EXPLAIN ANALYZE` + 50-read p95 on the seeded volume),
   additions to `leave-history-http.spec.ts` (route 400s, tab refuses `employee_id`), and
   `packages/contracts/src/__tests__/leave-history.spec.ts` (report query parse).
8. Docs (Claude): this plan, `debate-68-2-astra.md`, `spec.md` (68-2 implementation note, D1 answer when it lands).

## Tests (Agy brief)

- LH-14: `employee_id` of an employee outside the caller's branches → 404; unknown or foreign-tenant employee → 404;
  soft-deleted → 404.
- LH-14b: the report lists an old `PENDING` request and a request ending today (`excludeOpen=false`).
- Scope: منى (السالمية) sees السالمية leave rows only; a حولي request of the same employee hidden; absence by shift
  branch; `COVERED_ELSEWHERE` rows per BR-008 for her; a leave-only caller gets no absence rows and empty
  `absence_branch_ids` (LH-15/LH-18 on the report route); `branch_id` outside scope → 404.
- `last_taken`: `null` without `employee_id`; with it, the same values as the tab for the same employee (parity).
- Many employees: rows of several employees on one date ordered by `(date, rank, id)`; keyset paging across employees
  with no row repeated or lost; `as_of` reused and bounded (LH-23/LH-24 on the report route).
- Feature off → `FEATURE_DISABLED`; cross-tenant → 404; cashier without `read:leave:branch` → 404; invalid employee +
  feature off → 404; invalid employee + bad cursor → 404; `as_of` at exactly now and now − 24 h accepted, 1 ms beyond
  either refused.
- Races on the report reader (`employee_id`): soft deletion between `access.check` and the final statement → 404 with no
  page or `last_taken`; an approval during the read never yields an absence row and a `last_taken` that disagree;
  unfiltered reads drop a deleted employee from leave, absence and covered rows.
- D1 visibility test (blocked until LH-Q12 answers): an ended-attachment, non-deleted employee in all three row
  sources, with and without `employee_id`.
- Regression: every `leave-history-*.spec.ts`, `leave-open-list.spec.ts`, `leave-queries.spec.ts`; the tab's SQL text
  unchanged.
- No RLS negative test: no table is added.

## Gates (local, PP-113)

`pnpm --filter @pospay/contracts typecheck` and build, `pnpm --filter @pospay/api typecheck`, scoped ESLint on touched
files, `pnpm lint:docs`, `pnpm module-map:check`, the contracts unit test, and the staff leave-history DB specs above on
a private lane (`node scripts/test-db/lane.mjs up <lane>` after building `@pospay/db^...`, env from `.env.example`).
Full `pnpm check` and the API shards: `ci-gate` on the exact head.

## Size estimate (changed lines, additions + deletions, PP-112 / §14)

| Category | Estimate |
|---|---|
| Production (contracts, queries, controller, module) | 170–260 |
| Tests | 450–650 |
| Generated (`openapi.json`, three `schema.d.ts`) | 200–350 |
| Docs (plan, debate record, spec, owner question) | 180–260 |
| **Total** | **1,000–1,520** |

This total exceeds the spec row's 200–300 for 68-2 (whose basis is not stated; row 68-1a's 775–1140 counts tests, docs
and generated files), so the estimate needs the manager's acceptance before dispatch. Production alone stays near the
spec row. A Kimi delivery
above 520 production lines or an Agy delivery above 1,300 test lines is refused.

## Debate

One round with Astra, recorded in [debate-68-2-astra.md](debate-68-2-astra.md): 6 findings (1 P1, 4 P2, 1 P3), all accepted and applied above.

## Blockers

- LH-Q12 (D1) blocks the report's employee-visibility predicate and its test. Per batch COMMON stop conditions, this
  session stops after the plan and the debate and reports the question to the manager.
