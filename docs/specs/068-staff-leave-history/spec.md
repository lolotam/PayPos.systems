# Feature Specification: Staff leave history («سجل الإجازات»)

**Feature Branch**: `docs/spec-068-leave-history` (this spec); code sub-PRs `feat/p1-68-<n>-…`

**Created**: 2026-10-24

**Status**: Draft — waits for row **27g** to finish (LV-Q1). Owner questions LH-Q1…LH-Q5 (batch 63, PP-47.2…PP-47.6)
are answered by Waleed on the decisions page (2026-10-24); Abu Salem is **PENDING** on all of them, and work follows
Waleed's picks until he answers (`CLAUDE.md` §1 5b). Three new questions, LH-Q6…LH-Q8, are **PENDING** for both owners
and each blocks only the rule marked `TODO(spec)` below ([owner-questions.ar.md](owner-questions.ar.md)). **No code starts
before row 27g is done and this spec is merged.**

**Input**: Abu Salem's note on ST-Q7 (batch 59, 2026-10-23): a leave filter that shows everything about past leave — the
last annual, sick, unpaid and unexcused leave — over a date range (from … to …), and narrowed to one type such as annual
only.

**Roadmap**: partner request **AS-26** on the decisions page («المشروع أول بأول»). It has no row in
`docs/specs/phase-1/IMPLEMENTATION-PLAN.md`; LV-Q1 (batch 62, PP-46.1, Waleed's card 2026-10-24: «مهمة جديدة بعد
الكشف») made it a new task after 27g, with a spec and questions before code.

**Sources**: spec 023 (request leave), spec 025 (decide and revoke leave), spec 049 (attendance board and the 27b monthly
report), spec 061 (the 27g attendance statement: the «لا يوجد حضور مسجّل» day rule, FR-011b, FR-013), spec 064 (BR-002,
BR-003: eligibility and presence at any branch), ADR-0024 (schedules), ADR-0056 (attendance statement reads),
`packages/db/schema/staff-leave.ts`, `apps/api/src/modules/staff/queries/leave-requests.query.ts`,
`apps/api/src/modules/staff/persistence/leave-read-access.adapter.ts`.

## What exists today

- `leave_requests` holds every request: `type` ∈ `ANNUAL`, `SICK`, `UNPAID`, `OTHER` (`OTHER` requires a note);
  `kind` ∈ `FULL_DAY`, `PARTIAL` (one date, start–end times); `status` ∈ `PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`
  (a revoked approval is `CANCELLED` with `revoked_by`, `revoked_at` and `revocation_reason`, spec 025).
- The employee file (`apps/admin/src/staff/ui/employee-edit-panel.tsx`) is one stack of sections. Its leave section
  (`employee-leave-section.tsx`) lists the employee's requests in id order, with no filter, through
  `GET /v1/businesses/{businessId}/employees/{employeeId}/leave-requests`, and carries the request, cancel, decide and
  revoke actions.
- The leave inbox (`GET /v1/businesses/{businessId}/leave-requests`) lists **pending** requests only, filtered by branch
  and dates.
- Both reads are `@Authenticated()` + `SelectedCompanyGuard` routes whose scope comes from `LeaveReadAccess.check`
  (`read:leave:branch`, default owner, general manager, business manager and branch manager, migration 0064), honour the
  leave feature switch, and leave out soft-deleted employees.
- Nothing lists unexcused absence. Spec 061 prints «لا يوجد حضور مسجّل» on a statement date that had a scheduled shift
  and no counted session; that rule lives in `packages/domain` (spec 061 FR-013, row 27g).

## Owner answers this spec follows

| Question | Answer (Waleed, decisions page, 2026-10-24; Abu Salem PENDING) | Rule |
|---|---|---|
| LV-Q1 (batch 62, PP-46.1) | Card «مهمة جديدة بعد الكشف»: a new task after 27g, spec and questions before code | this spec; code after 27g |
| LH-Q1 (PP-47.2) | Option 3, against the recommendation: «الاتنين: تبويب في الملف، وتقرير لكل الموظفات.» | FR-001, FR-002 |
| LH-Q2 (PP-47.3) | Option 1: the people who see leave requests today, with no new permission; a branch manager sees her branch only | FR-010 |
| LH-Q3 (PP-47.4) | Option 2, against the recommendation: «كل الحالات، وجنب كل واحدة حالتها (معتمدة، مرفوضة، مستنية، ملغية).», note «مع فلتر بالحاله» | FR-004, FR-006 |
| LH-Q4 (PP-47.5) | Option 1: unexcused absence is its own type in the history and in the filter, computed from the schedule and attendance | FR-005, BR-001…BR-006 |
| LH-Q5 (PP-47.6) | Option 1: the screen opens on the current year (1 January to today); the «آخر سنوية / آخر مرضية / آخر من غير مرتب» line covers all history | FR-007, FR-008 |

## User Scenarios & Testing *(mandatory)*

The running example: salon «الأميرة», branches السالمية and حولي, time zone Asia/Kuwait. ريم works at السالمية; منى is
the السالمية branch manager; هدى is the owner. Today is 24 October 2026.

### User Story 1 — The «الإجازات» tab in ريم's file (Priority: P1)

1. **Given** هدى opens ريم's file, **when** she opens the «الإجازات» tab, **then** the period reads 1 January 2026 to
   24 October 2026, and the list shows every leave request of ريم that overlaps the period, newest first, each with its
   type, dates (or the date and times of a partial leave), status (معتمدة، مرفوضة، مستنية، ملغية) and note, plus a
   «غياب من غير عذر» row for each date that counts as unexcused absence (BR-001).
2. Above the list, one line reads «آخر سنوية: 20 أكتوبر 2026 · آخر مرضية: 14 أكتوبر 2026 · آخر من غير مرتب: مفيش»,
   computed over all of ريم's history whatever the period (FR-008).
3. The request, cancel, decide and revoke actions of today's leave section stay in this tab and work as before.

### User Story 2 — Filters (Priority: P1)

1. **When** هدى sets the period to 1 March – 31 March 2026, **then** only rows of that period show; the last-taken line
   does not change.
2. **When** she picks the type «سنوية» only, **then** only annual leave shows; picking «غياب من غير عذر» only shows only
   absence rows.
3. **When** she picks the status «مرفوضة», **then** only rejected requests show (absence rows: LH-Q6, FR-006).

### User Story 3 — The report for all employees (Priority: P1)

1. **Given** هدى opens «سجل الإجازات» under staff, **then** she sees the same rows for every employee of the business,
   each with the employee's name and number and the branch, with the same filters plus an employee and a branch filter.
2. **When** she picks ريم in the employee filter, **then** the list is ريم's and the last-taken line shows for her.

### User Story 4 — Who sees what (Priority: P1)

1. منى (branch manager of السالمية) sees the السالمية rows only: requests whose branch is السالمية and absence on
   السالمية shifts; a حولي request of the same employee is not listed.
2. A cashier, a shift supervisor or an accountant without `read:leave:branch` gets 404 on both routes, as today's leave
   reads do.
3. With the leave feature switched off, both routes answer `FEATURE_DISABLED`, as today.

### Edge Cases

- ريم had a scheduled shift on 12 October, no session and no leave: one absence row on 12 October (BR-001).
- A partial approved leave (10:00–12:00) on a scheduled day with no session: a leave row, no absence (BR-002).
- A pending or rejected request on a scheduled day with no session: the request row **and** an absence row (BR-002).
- A shift that has not ended yet (today's 16:00–22:00 at 15:00): no absence (BR-004).
- An OPEN session (still clocked in): no absence (BR-003).
- A voided session only: absence (BR-003).
- She clocked in at حولي on a day scheduled at السالمية: no absence (BR-003).
- A split day (two shifts), one attended: no absence; absence is per date, not per shift (BR-005).
- An overnight shift 22:00–02:00 belongs to its start date (`working_date`, ADR-0024).
- A scheduled date before `hire_date` or after `contract_end`: no absence (BR-006).
- A soft-deleted employee is not listed anywhere, as in today's leave reads.
- A leave of 28 December 2025 – 3 January 2026 overlaps the default period and is listed.
- An approved leave dated next month is outside the default period but counts for the last-taken line only if LH-Q8
  says so.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** The employee file gets a «الإجازات» tab (LH-Q1). The file has no tab bar today, so 68-3 adds one: «البيانات»
  (every existing section, unchanged) and «الإجازات» (today's leave section with its actions, plus this history).
- **FR-002** A report screen «سجل الإجازات» under staff lists the history of every employee of the selected business,
  with an employee filter (LH-Q1).
- **FR-003** Both views read one row list ordered by date descending (a request's `from`, an absence's working date),
  then leave rows before absence rows on the same date, then id; rows overlap the period (`to ≥ period.from` and
  `from ≤ period.to` for a request, the working date inside the period for an absence).
- **FR-004** A leave row carries the request as today's `LeaveListItem` does (type, kind, dates, times, time zone,
  status, note, decision, rejection and revocation reasons, branch, employee names) and the same `can_cancel`,
  `can_decide`, `can_revoke` flags. All four statuses are listed (LH-Q3); a revoked approval shows «ملغية» and its
  revocation reason.
- **FR-005** An absence row carries `working_date`, `branch_id`, the scheduled `start`/`end` of the day's shifts at that
  branch, and the employee names and number. It has no status and no action (LH-Q4).
- **FR-006** Filters: `from`, `to` (required by the API; the screens fill them, FR-007), `types[]` (any of `ANNUAL`,
  `SICK`, `UNPAID`, `OTHER`, `UNEXCUSED_ABSENCE`; empty = all), `statuses[]` (any of `PENDING`, `APPROVED`, `REJECTED`,
  `CANCELLED`; empty = all), `branch_id` (optional, inside the caller's scope), and on the report route only
  `employee_id`. Whether absence rows show while a status is picked is **`TODO(spec)` LH-Q6**; until it is answered the
  screens follow the recommended option: absence rows are hidden whenever a status is picked.
- **FR-007** The screens open on 1 January of the current year to today, both in the business's effective time zone
  (LH-Q5); the user can change both dates. A range longer than 366 days is refused with `422 VALIDATION_FAILED`
  (`to`), which keeps the absence scan bounded.
- **FR-008** The last-taken line shows, for one employee, the latest **approved** `ANNUAL`, `SICK` and `UNPAID` leave
  over all her history, each with its dates, or «مفيش» (LH-Q5). Whether a leave that has not started yet counts is
  **`TODO(spec)` LH-Q8** (until answered: only leave that started on or before today). Whether a fourth item «آخر غياب
  من غير عذر» is added is **`TODO(spec)` LH-Q7** (until answered: not shown). In the report it shows only when one
  employee is selected.
- **FR-009** Pagination: an opaque keyset cursor over `(date, row kind, id)` (an absence's id is the first shift id of
  the date), limit 1–100, default 50. Today's bare-id `next_cursor` is not reused, because the order is not by id.
- **FR-010** Access (LH-Q2): exactly today's leave read scope, `LeaveReadAccess.check` on `read:leave:branch`, with no new
  permission. A leave row is listed when its `branch_id` is in the caller's read branches; an absence row when its
  shift's branch is. The tab route also requires the employee to be attached to one of those branches, as today's
  employee route does.
- **FR-011** No write: the history is a read; the existing actions keep their routes, guards and `Idempotency-Key`.

### Business rules (unexcused absence)

- **BR-001** A date `D` is unexcused absence for employee `E` at branch `B` when `E` has a schedule shift at `B` whose
  `working_date` is `D` and all of BR-002…BR-006 hold. One row per (employee, date, branch).
- **BR-002** No `APPROVED` leave of `E` covers `D` (`from ≤ D ≤ to`), of any type or kind, partial included — the same
  precedence as spec 061 Story 2 §2 (an approved-leave date shows the leave type). A pending, rejected or cancelled
  request does not excuse (the LH-Q4 definition: «مافيش حضور ولا إجازة معتمدة»).
- **BR-003** No non-voided session of `E` has `working_date = D` at **any** branch of the business, whatever its status
  (`OPEN` and `MISSED_OUT` included), the presence rule of spec 064 BR-003. A voided session does not count.
- **BR-004** Every shift of `E` at `B` on `D` had ended (`ends_at ≤ now`) when the list is read, as spec 061 FR-013a
  never prints «لا يوجد حضور مسجّل» for a shift that had not ended. `now` comes from the injected `LeaveClock`, passed
  into the query as a parameter, never `now()` in SQL (`CLAUDE.md` §4.3).
- **BR-005** Absence is per date: a split day with one attended shift is not absence (BR-003 already holds).
- **BR-006** `D` lies between `hire_date` and `contract_end` (inclusive) of `E`; outside it there is no absence (the
  `INELIGIBLE` rule of spec 064 BR-002).

### Key Entities

- **LeaveHistoryItem** (contract, new): a discriminated union on `kind`: `LEAVE` (today's `LeaveListItem` fields) or
  `UNEXCUSED_ABSENCE` (FR-005). Both carry `employee_id`, `employee_name_en`, `employee_name_ar`, `employee_number`.
- **LeaveHistoryPage** (contract, new): `items`, `next_cursor`, `last_taken` (`{ annual, sick, unpaid }`, each
  `{ from, to } | null`, or `null` when the page is not for one employee), `request_branch_ids` (as today's `LeavePage`).

## Slice design *(mandatory — `CLAUDE.md` §1)*

A read-only slice: two read routes over one `queries/` builder and two admin screens. No table, no migration expected,
no event, no audit entry (a read of leave data is not on the `CLAUDE.md` §8 audit list).

### Technical decisions

| ID | Decision | Rejected |
|---|---|---|
| TD-1 | **Absence is computed in SQL in `queries/`** (a `NOT EXISTS` anti-join of shifts against sessions and approved leave), because `queries/` may not import `domain/` (`CLAUDE.md` §6). A **parity test** keeps it equal to the 27g day-breakdown function of spec 061 FR-013: on the same fixtures at one branch (overnight shift, split shift, voided session, OPEN session, partial leave, unended shift), the absence dates equal the dates the 27g employee form prints «لا يوجد حضور مسجّل». The only allowed difference is a session at another branch (BR-003), covered by its own test | a read use case that runs the domain function (would need a recorded exception like ADR-0054 §5 for commissions); a stored absence table (a second truth that drifts on every correction) |
| TD-2 | **New routes, not new query parameters on today's routes.** Today's employee list and pending inbox keep their shape and their clients | widening `leaveListQuery` (changes every caller's contract and its id cursor) |
| TD-3 | **One builder, two scopes.** `queries/leave-history.query.ts` builds the rows for one employee (tab) or a business (report); the routes differ only in the scope and the `employee_id` filter | two copies of the SQL |
| TD-4 | **The last-taken line is three `LIMIT 1` lookups** on `leave_requests_company_employee_period_idx`, in the same `withTenant` transaction as the page (`CLAUDE.md` §6 connection budget) | computing it from the page (wrong once the period is narrowed) |

### Schema changes

None. The reads rely on existing indexes; the EXPLAIN tests decide:

| Read | Index |
|---|---|
| Tab: leave rows | `leave_requests_company_employee_period_idx` `(company_id, employee_id, starts_at, ends_at)` |
| Report: leave rows | `leave_requests_company_business_branch_dates_idx` `(company_id, business_id, branch_id, from, to, id)` |
| Tab: shifts | `staff_schedule_shifts_employee_idx` `(company_id, employee_id, starts_at)` |
| Report: shifts | `staff_schedules_branch_week_idx` `(company_id, business_id, branch_id, week_start, employee_id)`, then `staff_schedule_shifts_schedule_idx` (shifts carry no business or branch) |
| Sessions anti-join | `attendance_sessions_employee_date_idx` `(company_id, employee_id, working_date, clock_in)` |
| Approved-leave anti-join, last-taken line | `leave_requests_company_employee_period_idx` |

If an EXPLAIN shows a sequential scan on a seeded volume, that sub-PR adds the index in its own migration,
`CONCURRENTLY` (ADR-0033), after checking with the orchestrator which lane holds the next migration number.

### API contract

- `GET /v1/businesses/{businessId}/employees/{employeeId}/leave-history` — the tab. Query `leaveHistoryQuery`:
  `from`, `to`, `types[]`, `statuses[]`, `branch_id?`, `cursor?`, `limit`. Response `LeaveHistoryPage` with `last_taken`.
- `GET /v1/businesses/{businessId}/leave-history` — the report. The same query plus `employee_id?`. `last_taken` is filled
  only when `employee_id` is given.
- Errors: `404 NOT_FOUND` (no scope, unknown or foreign business or employee, a soft-deleted employee), `422
  VALIDATION_FAILED` (`from > to`, a range over 366 days, an unknown type or status, a bad cursor), `FEATURE_DISABLED`
  as today. No `Idempotency-Key` (a read).
- `packages/contracts/src/staff/leave-history.ts`: `leaveHistoryQuery`, `leaveHistoryReportQuery`, `leaveHistoryItem`,
  `leaveHistoryPage`, OpenAPI ids `LeaveHistoryQuery`, `LeaveHistoryItem`, `LeaveHistoryPage`; then
  `pnpm contracts:openapi` and the admin client regenerated (never hand-edited).

### Permissions

None new (LH-Q2). Both routes are `@Authenticated()` + `SelectedCompanyGuard`, and the read scope is
`LeaveReadAccess.check` inside the route's one `withTenant(companyId, …, { userId })` transaction, exactly as
`employee-leave.controller.ts` `list` does today: a record-scoped read (`CLAUDE.md` §6). They write nothing, so they need
no write declaration for the PP-7.1 test.

### i18n

`packages/i18n` keys under `staff.leaveHistory.*`: the tab and screen titles, the five types (with «غياب من غير عذر» /
"Unexcused absence"), the four statuses as today's leave table names them, the filter labels, «مفيش» / "None", the
last-taken labels and the empty state. Dates and times through the existing formatters, in the branch time zone.

### Sub-PRs (one at a time, each in a fresh worktree from main, after 27g is done)

| # | Title | Subtasks | Waits for | Size |
|---|---|---|---|---|
| **68-1** | Contracts and the employee read | 1. `packages/contracts/src/staff/leave-history.ts` (FR-003…FR-009 shapes) and the OpenAPI regeneration. 2. `queries/leave-history.query.ts` (leave rows, absence rows BR-001…BR-006, keyset cursor, last-taken lookups) and `GET …/employees/{employeeId}/leave-history`. 3. Result-shape tests, `EXPLAIN ANALYZE` assertions, the TD-1 parity test, and integration tests LH-01…LH-12 | 27g done; this spec merged | 380–480 |
| **68-2** | The business report read | 1. `GET …/leave-history` with `employee_id` and the business scope over the 68-1 builder. 2. Scope tests (branch manager sees her branch only, a request at another branch hidden, absence by shift branch) and `EXPLAIN ANALYZE` on a seeded volume (50 employees × one year of shifts). 3. The report `last_taken` rule (only with `employee_id`) | 68-1 | 200–300 |
| **68-3** | Admin «الإجازات» tab | 1. The tab bar in the employee file (FR-001) with today's leave section moved into «الإجازات» unchanged. 2. The history list, the filters with the current-year default, the last-taken line, and the i18n keys. 3. UI tests that assert what the user sees (the default dates, a filtered list, «مفيش», the absence row, the actions still present) | 68-1 | 300–400 |
| **68-4** | Admin report screen «سجل الإجازات» | 1. The page and its navigation entry, shown to holders of the leave read scope. 2. The employee and branch filters and the last-taken line for one employee. 3. UI tests (visible outcomes) | 68-2, 68-3 | 250–350 |

### Test plan

- **Integration (68-1, 68-2)**, PostgreSQL, one cloned database per spec file (ADR-0006), as `pospay_app`:
  `LH-01` all four statuses listed, newest first · `LH-02` period overlap at both edges (a leave across 1 January) ·
  `LH-03` type and status filters, absence-only filter · `LH-04` absence on a scheduled day with no session and no leave ·
  `LH-05` approved partial leave excuses; pending and rejected do not · `LH-06` OPEN and `MISSED_OUT` sessions excuse, a
  voided one does not · `LH-07` a session at another branch excuses · `LH-08` an unended shift is not absence (the clock
  passed in) · `LH-09` split day with one shift attended · `LH-10` dates outside `hire_date`/`contract_end` ·
  `LH-11` last-taken line over all history, independent of the period · `LH-12` keyset pagination across a date with
  leave and absence rows, no row twice or lost · plus the access cases of User Story 4 and a cross-tenant read that
  returns 404.
- **Queries**: a result-shape test and an `EXPLAIN ANALYZE` assertion for each route (`CLAUDE.md` §9).
- **Parity (TD-1)**: the absence dates equal the 27g employee form's «لا يوجد حضور مسجّل» dates on shared fixtures.
- **UI (68-3, 68-4)**: visible outcomes only (`CLAUDE.md` §9).
- No RLS negative test is added: no table is added.

### Documents to update in the same PRs

- 68-1: `docs/module-map.md` only if a new port is added (none is expected: the read stays inside `staff`).
- 68-4: the roadmap row AS-26 is set done by the orchestrator after the merge (`CLAUDE.md` §1 5c).
- If Abu Salem picks differently on LH-Q1…LH-Q5, or when LH-Q6…LH-Q8 are answered, this spec and
  `owner-questions.ar.md` change first, before the affected sub-PR.

## Success Criteria *(mandatory)*

- **SC-001** A manager answers «ريم أخدت سنوية آخر مرة إمتى؟» from the employee file in one click.
- **SC-002** Every leave request and every unexcused absence of the period appears exactly once, with its status.
- **SC-003** A branch manager never sees a row of another branch.
- **SC-004** Each route answers within 200 ms at p95 for one year of one business's data on the seeded volume.

## Assumptions

- Row 27g has merged its day-breakdown function (spec 061 FR-013) before 68-1 starts, so the parity test has its
  reference.
- The schedule (ADR-0024) is the only source of scheduled days; default contract hours without a schedule shift never
  create an absence, as spec 061 never prints «لا يوجد حضور مسجّل» for them.
- No export (PDF or Excel) and no totals per type in this slice; either would be a new owner request.
