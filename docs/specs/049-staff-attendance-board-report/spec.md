# Spec 049 — Attendance board, monthly report and CSV (Phase 1 row 27)

> **Status:** Draft · 2026-10-11 · owner answers AB-Q1…AB-Q9 recorded in [owner-questions.ar.md](owner-questions.ar.md)
> (batch 11; Waleed and Abu Salem picked the same option on all nine).
> **Depends on:** rows 25, 26, 26a/b/c, 16b-2, 16d, 21b — all merged.

## 1. Scope and split (AB-Q1)

Row 27 ships as four PRs, one use case each, in this order:

| Part | What | Layers |
|------|------|--------|
| **27a** | Daily board read API: who is in now, the day's sessions per branch, refused clock attempts; new permission `read:attendance:branch` | contract, migration (permission + role defaults only), queries, http, tests |
| 27b | Monthly report read API + CSV export | domain (hours), queries, http, audit, tests |
| 27c | Admin screens: board (30 s polling) and monthly report + CSV download | `apps/admin` |
| 27d | Admin screens: open exceptions + resolve, correction form + history, change requests (create / decide / withdraw) | `apps/admin` (+ any missing list query) |

This spec states the rules for all four; 27a is detailed enough to implement now. 27b–27d get their plan when they
start, against the rules below.

## 2. Decisions carried into row 27 (already final)

- **BW-Q4 / FR-011 (spec 041):** the break never reduces hours. Scheduled hours = shift end − start. For worked hours,
  time clocked out *inside* the scheduled break window of that shift counts as worked; time clocked out outside it
  does not (BW-Q8).
- **A5 / A7:** lateness is reported, never deducted; attendance never changes commission.
- **ACR-Q18:** a MANUAL session counts like any day (hours and lateness) and is labelled "manual" with the requester
  and the approver.
- **ACR-Q20 / spec 046 FR-005:** a voided session is excluded from the board and every report, and its OPEN exceptions
  are hidden with it (not closed, not changed).
- **DH-Q4 / spec 048:** the monthly report shows "contracted hours this month" from `contractedMinutes()` and
  `queries/employee-contracted-minutes.query.ts`, using the current default for the whole month (rule b).
- **PL-Q3 / ADR-0039:** refused clock attempts are shown to the manager on the board, no instant notice; the old
  two-employees-one-device pair list is dropped from scope (query `attendance-device-refusals`).
- **RE-Q11, CA-Q15, ACR-Q6:** the exceptions, correction and change-request screens ship with row 27 (part 27d).
- **D-32:** a missed clock-out is a warning, never hours or a deduction. **SPEC §7:** `working_date` is the clock-in
  date in the branch time zone; an overnight session belongs to it.

## 3. New decisions (batch 11)

| ID | Decision |
|----|----------|
| AB-Q1 | Split into 27a–27d as in §1. |
| AB-Q2 | New permission `read:attendance:branch`. Role defaults: `owner`, `general_manager`, `business_manager`, `branch_manager`, `accountant` (Abu Salem's comment: also the administrative/finance manager and the accountant). Scope follows the holder's branch access: a branch manager sees only his branches; company-wide roles see all. The owner can grant it to any person (existing ALLOW/DENY). There is no "finance manager" role; the owner grants it by name. An employee sees only her own attendance in her app (row 57b, not here). |
| AB-Q3 | Report month = calendar month (1st → last day), by `working_date`. |
| AB-Q4 | Contracted hours for the month **minus** every APPROVED leave (ANNUAL, SICK, UNPAID, OTHER): a full-day leave removes that date's contracted minutes; a PARTIAL leave removes the overlap of its hours with that day's default. A separate column shows leave days by type. **AB-Q11 (Waleed 2026-10-11):** approved leave removes contracted minutes at **every** branch the employee is linked to that day, not only the branch it was filed under. |
| AB-Q5 | No public-holiday list now (comes with payroll). Contracted hours are not reduced for holidays. |
| AB-Q6 | A `MISSED_OUT` session counts **0** worked minutes and is flagged "missing clock-out" until corrected; once it has a correction of `CLOCK_OUT` (spec 035, status stays `MISSED_OUT`) it counts with the corrected clock-out. |
| AB-Q7 | The report is per branch: an employee linked to two branches appears in each with that branch's sessions and contracted hours. Readers whose access covers every branch of the business also get an "all branches" view: one row per employee, sums across branches. "All branches" means every branch of **one business**: the request is `GET /v1/businesses/:businessId/attendance-report` (single branch: `…/branches/:branchId/attendance-report`; API shape decided by the orchestrator 2026-10-11, not an owner question), and the reader must hold the permission on every branch of that business. |
| AB-Q8 | One difference column: actual − contracted (after AB-Q4 leave). Positive = worked more. |
| AB-Q9a | Board per branch: who is in now; every session of the day (in, out, lateness, open exceptions, "manual" with requester/approver); refused clock attempts. The screen polls every 30 s. |
| AB-Q9b | Overnight sessions belong to the clock-in working date. |
| AB-Q9c | Lateness in the report: count of late sessions and total late minutes, including return-from-break lateness (16b-2). |
| AB-Q9d | Hours shown as h:mm; the CSV also has decimal hours (2 decimals). |
| AB-Q9e | CSV in Arabic (UTF-8 with BOM so Excel opens it), employee name only — never phone, salary or IBAN. The employee record has no employee number today; none is added now (AB-Q10, Waleed 2026-10-11: the name is enough). |
| AB-Q9f | Every CSV download writes one audit entry: who, when, branch (or all), month. |
| AB-Q9g | An OPEN session is not in the monthly report until it is closed; the board shows it as "still in" from its clock-in. |

## 4. Part 27a — daily board (implement now)

### 4.1 Use case

A holder of `read:attendance:branch` opens the board for one branch and one working date (default: today in the
branch time zone) and sees who is in, the day's sessions, and recent refused clock attempts. Read only.

### 4.2 Endpoints (under `/v1`, guarded `@Require('read:attendance:branch')`, branch scope checked server-side)

1. `GET /v1/businesses/:businessId/branches/:branchId/attendance-board?date=YYYY-MM-DD` → one object:
   - `branch_id`, `date`, `timezone`, `generated_at`;
   - `in_now[]`: every OPEN, non-voided session at that branch (any working date), with employee id, name
     (ar/en), `clock_in`, `source`, `scheduled_end` (nullable);
   - `sessions[]`: every non-voided session at that branch whose `working_date` = `date`, ordered by `clock_in`, each
     with: session id, employee id and name (ar/en), `clock_in`, `clock_out` (nullable), `status`
     (`OPEN|CLOSED|MISSED_OUT`), `source` (`QR|BARCODE|MANUAL`…as stored), `late_minutes`, `scheduled_start`,
     `scheduled_end`, `geo`/`out_geo`, `corrected` (boolean: at least one correction row), `revision`,
     `open_exceptions[]` (kind + id; OPEN only), and for MANUAL sessions `manual: { change_request_id, requested_by,
     approved_by }` (user ids, as the change-request list returns them; the 27c screen shows the names);
   - no hours figure on the board (hours are 27b).
2. `GET /v1/businesses/:businessId/branches/:branchId/attendance-board/refusals?cursor=&limit=` → the existing
   `queries/attendance-device-refusals.query.ts` page (newest first, keyset cursor, no installation hash), now routed.

Errors use the standard envelope. A branch outside the caller's scope → the same not-found answer used by other
branch-scoped staff reads (no existence leak). Staff feature disabled → `FEATURE_DISABLED` as elsewhere.

### 4.3 Rules

- Voided sessions never appear, nor their exceptions (§2).
- "Today" = the branch-local date from the injected clock path the staff queries already use; `date` may be any past
  date; a future date returns empty lists.
- An employee seen at the branch through a session but no longer linked to it still appears for that session (the
  board is about sessions at the branch, not current links).
- Employee phone, salary, IBAN and documents are never in the response.
- Polling budget: each endpoint ≤ 200 ms for a branch of 60 employees and a day of 200 sessions; `EXPLAIN` tests prove
  index use. Add a partial `WHERE voided_at IS NULL` index only if `EXPLAIN` needs it (spec 046 note).

### 4.4 Data changes

- Migration: `INSERT` permission `read:attendance:branch`; role defaults for the five roles in AB-Q2 (pattern of
  migration 0088). Update the reviewed grant/permission tests and the permissions catalog i18n (ar/en label
  «عرض الحضور» / "View attendance").
- No new table. Index only if `EXPLAIN` asks.

### 4.5 Tests (required)

- Result-shape test + `EXPLAIN ANALYZE` assertion for each query (`CLAUDE.md` §9).
- Integration: a manager scoped to branch A gets 404-equivalent for branch B; owner/general manager/accountant see
  any branch; a person with a personal DENY is refused; voided session and its OPEN exception absent; MANUAL session
  carries requester and approver ids; overnight session listed on its clock-in date; OPEN session in `in_now` and in
  `sessions` of its working date; refusals route returns the 043 query page and never a hash.
- Tenant isolation: another company's sessions never appear.

## 5. Part 27b — monthly report and CSV (rules only; planned when it starts)

Per branch and calendar month, one row per employee with any session or contracted minutes at that branch:

| Column | Rule |
|--------|------|
| days present | count of distinct working dates with a counted session |
| worked hours | Σ over CLOSED sessions (+ MISSED_OUT with a clock-out correction) of `clock_out − clock_in`, plus the BW-Q8 break credit: for two sessions of the same shift where the first clock-out and the next clock-in both fall inside that shift's scheduled break window, the gap counts; outside the window it does not. MANUAL counts. Voided and OPEN do not. |
| scheduled hours | Σ of `ends_at − starts_at` of the employee's schedule shifts at that branch in the month (break included) |
| contracted hours | `contractedMinutes()` for the month − approved leave (AB-Q4) |
| leave days | by type (ANNUAL, SICK, UNPAID, OTHER); partial leave shown as hours |
| difference | worked − contracted |
| late | count of late sessions; total late minutes (incl. return from break) |
| missing clock-out | count of uncorrected MISSED_OUT sessions |
| manual days | count of MANUAL sessions |

The hours arithmetic lives in `packages/domain` as pure functions with exhaustive unit tests (no arithmetic in a use
case or query mapper beyond projection). CSV export follows AB-Q9d/e/f; anything above 200 ms becomes a worker job
(`CLAUDE.md` §6) — decide in 27b's plan with a measurement.
**Decided (Waleed 2026-10-11):** measured 113 ms at 3 branches × 30 employees (pilot scale, enforced by a test), 387 ms at 5 × 60, 578 ms at 10 × 60. The all-branches route stays synchronous for now; moving it to a worker job before large customers is deferred to issue #161 (row 27e).

## 6. Parts 27c and 27d — screens (rules only)

- 27c: board page polls every 30 s and falls back gracefully; report page with month and branch pickers, "all
  branches" when the reader's scope allows, CSV download. All strings through `packages/i18n`, RTL logical CSS,
  `packages/ui` components, TanStack Query hooks.
- 27d: open-exceptions list with the resolve action (spec 034), correction form + history (spec 035), change-request
  forms and the owner's decide/withdraw list (specs 044–046). Times entered in the branch time zone and sent as UTC.

## 7. Out of scope

Payroll, overtime pay, deductions, public holidays (AB-Q5), the employee's own attendance view (57b), notifications.
