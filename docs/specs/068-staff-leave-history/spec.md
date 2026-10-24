# Feature Specification: Staff leave history («سجل الإجازات»)

**Feature Branch**: `docs/spec-068-leave-history` (this spec); code sub-PRs `feat/p1-68-<n>-…`

**Created**: 2026-10-24

**Status**: Draft — waits for row **27g** to finish (LV-Q1). Owner questions LH-Q1…LH-Q5 (batch 63, PP-47.2…PP-47.6)
are answered by Waleed and Abu Salem on the decisions page (2026-10-24, the same option on each), so they are **final**.
Four follow-ups, LH-Q6…LH-Q9 (batch 66, PP-50.1…PP-50.4), are **final**: Abu Salem answered all four on the decisions
page (2026-10-24, 14:27–14:30), the same as Waleed on LH-Q6 and LH-Q7 and the recommended option on LH-Q8 and LH-Q9, where
his pick binds over Waleed's cards (15:10) (`CLAUDE.md` §1 5b; [owner-questions.ar.md](owner-questions.ar.md)). One
follow-up from his LH-Q7 note, LH-Q10 (batch 67, PP-52.1), is final on Abu Salem's pick (decisions page, 15:32: the late
leave changes the closed month itself; Waleed's card of 15:40, a correction in the next month, is history) and only sets
a rule for the payroll and statement side (BR-007, Assumptions). One question is **open**: LH-Q11 (from MergePilot's
review of #606, answer PENDING), what a caller who reads some branches only sees on a day covered at another branch
(BR-002, BR-003, `TODO(spec)`); it must be answered before 68-1 starts. **No code starts before row 27g is done and
this spec is merged.**

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

| Question | Answer (Waleed and Abu Salem, decisions page, 2026-10-24, the same option; final) | Rule |
|---|---|---|
| LV-Q1 (batch 62, PP-46.1) | Waleed's card «مهمة جديدة بعد الكشف», Abu Salem the same: a new task after 27g, spec and questions before code | this spec; code after 27g |
| LH-Q1 (PP-47.2) | Option 3, against the recommendation: «الاتنين: تبويب في الملف، وتقرير لكل الموظفات.» | FR-001, FR-002 |
| LH-Q2 (PP-47.3) | Option 1: the people who see leave requests today, with no new permission; a branch manager sees her branch only | FR-010 |
| LH-Q3 (PP-47.4) | Option 2, against the recommendation: «كل الحالات، وجنب كل واحدة حالتها (معتمدة، مرفوضة، مستنية، ملغية).», note «مع فلتر بالحاله» | FR-004, FR-006 |
| LH-Q4 (PP-47.5) | Option 1: unexcused absence is its own type in the history and in the filter, computed from the schedule and attendance | FR-005, BR-001…BR-006 |
| LH-Q5 (PP-47.6) | Option 1: the screen opens on the current year (1 January to today); the «آخر سنوية / آخر مرضية / آخر من غير مرتب» line covers all history | FR-007, FR-008 |

The follow-ups (batch 66; Abu Salem on the decisions page 2026-10-24 14:27–14:30, Waleed by cards through his super agent
15:10; final):

| Question | Final answer | Rule |
|---|---|---|
| LH-Q6 (PP-50.1) | Option 1, both owners: absence rows and the absence filter need `read:attendance:branch` too | FR-010 |
| LH-Q7 (PP-50.2) | Option 1, both owners: after the shift has ended; a pending request holds the absence back until it is decided; a rejected or cancelled one does not. Abu Salem's note adds a sick leave brought a day or two later (BR-007) and a month-end close before payroll (LH-Q10: a late leave changes the closed month; the close lifecycle is issue #607) | BR-002, BR-004, BR-007 |
| LH-Q8 (PP-50.3) | Option 1, Abu Salem's pick, binding (Waleed picked option 3 «مع أي حالة», history): «غياب» is its own status value, and the type and status filters combine with AND | FR-006 |
| LH-Q9 (PP-50.4) | Option 1, Abu Salem's pick, binding (Waleed picked option 3 «التلاتة بأي حالة», history): approved leave that has started by today only, with its range, plus «آخر غياب من غير عذر» for callers allowed to see absences | FR-008 |

## User Scenarios & Testing *(mandatory)*

The running example: salon «الأميرة», branches السالمية and حولي, time zone Asia/Kuwait. ريم works at السالمية; منى is
the السالمية branch manager; هدى is the owner. Today is 24 October 2026.

### User Story 1 — The «الإجازات» tab in ريم's file (Priority: P1)

1. **Given** هدى opens ريم's file, **when** she opens the «الإجازات» tab, **then** the period reads 1 January 2026 to
   24 October 2026, and the list shows every leave request of ريم that overlaps the period, newest first, each with its
   type, dates (or the date and times of a partial leave), status (معتمدة، مرفوضة، مستنية، ملغية) and note, plus a
   «غياب من غير عذر» row for each date that counts as unexcused absence (BR-001).
2. Above the list, one line reads «آخر سنوية: 20 أكتوبر 2026 · آخر مرضية: 14 أكتوبر 2026 · آخر من غير مرتب: مفيش · آخر
   غياب من غير عذر: 12 أكتوبر 2026», computed over all of ريم's history whatever the period (FR-008, LH-Q9).
3. On top of the tab, «طلبات جاية ومستنية» lists ريم's requests that end today or later or are still pending (her
   annual leave approved for 10 November, her request for 1 December), whatever the period, with today's request,
   cancel, decide and revoke actions, which work as before (FR-001). The history below leaves those requests out, so no
   request shows twice.

### User Story 2 — Filters (Priority: P1)

In the tab the filters apply to the history (part (b)) only; «طلبات جاية ومستنية» stays a simple list (FR-001).

1. **When** هدى sets the period to 1 March – 31 March 2026, **then** only rows of that period show; the last-taken line
   does not change.
2. **When** she picks the type «سنوية» only, **then** only annual leave shows; picking «غياب من غير عذر» only shows only
   absence rows.
3. **When** she picks the status «مرفوضة», **then** only rejected requests show; absence rows show only when the status
   filter also includes «غياب» (or is empty) and the type filter includes «غياب من غير عذر» (or is empty) (LH-Q8, FR-006).

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
- A pending request on a scheduled day with no session: the request row only, no absence, until it is decided (LH-Q7,
  BR-002).
- A rejected or cancelled request on a scheduled day with no session: the request row with its status **and** an absence
  row (LH-Q7, BR-002).
- A shift that has not ended yet (today's 16:00–22:00 at 15:00): no absence (LH-Q7, BR-004).
- A split day (09:00–12:00 and 16:00–20:00) read at 13:00 with no session: absence, which disappears if she clocks in at
  16:00 (BR-003, BR-004).
- An OPEN session (still clocked in): no absence (BR-003).
- A voided session only: absence (BR-003).
- She clocked in at حولي on a day scheduled at السالمية: no absence (BR-003). What منى, who reads السالمية only, sees
  on that day is `TODO(spec)` LH-Q11 (BR-002).
- A split day (two shifts), one attended: no absence; absence is per date, not per shift (BR-005).
- An overnight shift 22:00–02:00 belongs to its start date (`working_date`, ADR-0024).
- A scheduled date before `hire_date` or after `contract_end`: no absence (BR-006).
- A soft-deleted employee is not listed anywhere, as in today's leave reads.
- A leave of 28 December 2025 – 3 January 2026 overlaps the default period and is listed.
- An annual leave approved for 10 November and one requested for 1 December, still pending: both show in the tab's
  «طلبات جاية ومستنية» part (FR-001), and neither counts for the last-taken line, which keeps «آخر سنوية: 20 أكتوبر»
  until 10 November (LH-Q9, FR-008).
- ريم was absent on 12 October and brings a sick leave for that day on 14 October, approved the same day: from then on,
  12 October shows the sick leave and no absence (BR-007).
- ريم has a sick leave filed at حولي: منى (السالمية) does not see it in the list or in the last-taken line (FR-008).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** The employee file gets a «الإجازات» tab (LH-Q1). The file has no tab bar today, so 68-3 adds one: «البيانات»
  (every existing section, unchanged) and «الإجازات». The tab has **two parts** and replaces today's request list, so
  each request shows once per tab:
  - (a) **«طلبات جاية ومستنية»** on top: **today's** employee leave list
    (`GET /v1/businesses/{businessId}/employees/{employeeId}/leave-requests`) with one new optional filter `open=true`:
    a request whose `to` is on or after today in its branch's local date, or whose status is `PENDING`. It keeps that
    route's branch scope (FR-010), cursor pagination (no cap, nothing lost) and actions: the «request leave» button and
    cancel, decide and revoke (`can_cancel`, `can_decide`, `can_revoke`). Upcoming and waiting leave therefore stays
    reachable «as before» (User Story 1.3). It has its own simple list, as today, and the tab's filters do not apply
    to it.
  - (b) **the history** of the chosen period below it (FR-003, FR-006, FR-007), leaving out the open requests of (a)
    by the same `open` definition; the tab's period, type and status filters apply to this part only, and its rows keep
    the same actions where their flags allow.
  The all-employees report (FR-002) has only the history, with the period filter, and excludes nothing.
- **FR-002** A report screen «سجل الإجازات» under staff lists the history of every employee of the selected business,
  with an employee filter (LH-Q1).
- **FR-003** Both views read one row list ordered by `date DESC` (a request's `from`, an absence's working date), then
  `row_type ASC` (`LEAVE` before `UNEXCUSED_ABSENCE` on the same date), then `id DESC` (a request's id; an absence's
  canonical id is `(array_agg(shift.id ORDER BY shift.id))[1]` over that employee's shifts on that date at that branch,
  the same expression on PostgreSQL 16 in CI and 18 on staging); rows overlap the period (`to ≥ period.from` and
  `from ≤ period.to` for a request, the working date inside the period for an absence).
- **FR-004** A leave row carries the request as today's `LeaveListItem` does (type, kind, dates, times, time zone,
  status, note, decision, rejection and revocation reasons, branch, employee names) and the same `can_cancel`,
  `can_decide`, `can_revoke` flags. All four statuses are listed (LH-Q3); a revoked approval shows «ملغية» and its
  revocation reason.
- **FR-005** An absence row carries `working_date`, `branch_id`, `shifts` (every schedule shift of `E` at that branch
  on that date, each `{ start, end }` in branch-local `HH:MM`, so a split day keeps both ranges), and the employee names
  and number. Its status value is `ABSENT` («غياب», LH-Q8), and it has no action (LH-Q4). Whether a day covered only
  outside the caller's branches gets a row of its own is `TODO(spec)` LH-Q11 (BR-002).
- **FR-006** Filters: `from`, `to` (required by the API; the screens fill them, FR-007), `types[]` (any of `ANNUAL`,
  `SICK`, `UNPAID`, `OTHER`, `UNEXCUSED_ABSENCE`; empty = all), `statuses[]` (any of `PENDING`, `APPROVED`, `REJECTED`,
  `CANCELLED`; empty = all), `branch_id` (optional, inside the caller's scope), and on the report route only
  `employee_id`. `statuses[]` also accepts `ABSENT`, the status value of an absence row
  («غياب»). The two filters combine with AND (LH-Q8, Abu Salem's option 1, binding; Waleed's option 3 is history): an
  absence row shows only when `types[]` is empty or includes `UNEXCUSED_ABSENCE` **and** `statuses[]` is empty or
  includes `ABSENT`; a leave row shows only when its type and its status both pass. The absence type and status are
  offered only to a caller who may see absences (FR-010).
- **FR-007** The history (FR-001 part (b) and the report) opens on 1 January of the current year to today, both in the business's effective time zone
  (LH-Q5); the user can change both dates. A range longer than 366 days is refused with `400 VALIDATION_FAILED`
  (`to`), which keeps the absence scan bounded.
- **FR-008** The last-taken line shows, for one employee, the latest `ANNUAL`, `SICK` and `UNPAID` leave over all her
  history, counting only `APPROVED` leave whose `from` is on or before today in the branch-local date (a pending,
  rejected or cancelled request, or an approved leave that has not started, never counts), each with its range (from …
  to …; a multi-day leave counts by its first day), or «مفيش» (LH-Q5; LH-Q9, Abu Salem's option 1, binding; Waleed's
  option 3 is history). A fourth item «آخر غياب من غير عذر» gives the latest absence date (BR-001…BR-007) over
  `absence_branch_ids` only, shown only to a caller who may see absences (LH-Q6, FR-010). The line is computed only over rows the caller may see (FR-010): leave
  whose `branch_id` is in her read branches, so a branch manager never learns the date of a leave filed at another
  branch. In the report it shows only when one employee is selected.
- **FR-009** Pagination: an opaque keyset cursor over `(date, row_type, id)` with the canonical ids of FR-003; the next
  page compares the same tuple in the same directions (`date` lower, or equal and `row_type` higher, or both equal and
  `id` lower), so a row is never repeated or skipped while the data does not change. The cursor also carries the first page's
  `as_of` (TD-2): every later page derives **every** time-dependent predicate from that instant (its branch-local date
  for the `excludeOpen` split and for FR-008's «started by today», the instant itself for BR-004's ended shifts) instead
  of reading the clock again, and returns the same `as_of`, so the promise holds across branch-local midnight. **The
  server never trusts a client `as_of`:** the cursor is encoded with the existing `encodeCursor`/`decodeCursor`
  (`apps/api/src/shared/persistence/name-options-cursor.ts`, canonical but not signed; the repo has no signed-cursor
  helper), so its `as_of` is bounds-checked: an `as_of` that is not a valid instant, later than the injected
  `LeaveClock`'s now, or older than 24 hours is `400 VALIDATION_FAILED`, and the client restarts from page 1. The
  `open=true` list (FR-001 (a)) applies the same rule to its `as_of` parameter. Limit 1–100, default 50. Today's bare-id `next_cursor` is not reused, because the order is not by id.
- **FR-010** Access (LH-Q2): exactly today's leave read scope, `LeaveReadAccess.check` on `read:leave:branch`, with no new
  permission. A leave row is listed when its `branch_id` is in the caller's read branches; an absence row when its
  shift's branch is. Both routes, when they name an employee (the tab's path, the report's `employee_id`), require
  that employee to be attached to one of those branches, as today's employee route does, or answer 404. An absence row,
  which is attendance-derived, is listed only when the caller also holds `read:attendance:branch` on its shift's branch
  (LH-Q6); a caller with the leave scope alone sees leave rows only, and the absence type is not offered to her. This
  is a second read of an existing permission in the same transaction, no new permission.
- **FR-011** No write: the history is a read; the existing actions keep their routes, guards and `Idempotency-Key`.

### Business rules (unexcused absence)

- **BR-001** A date `D` is unexcused absence for employee `E` at branch `B` when `E` has a schedule shift at `B` whose
  `working_date` is `D` and all of BR-002…BR-006 hold. One row per (employee, date, branch).
- **BR-002** Any leave of `E` covers `D` whatever its branch, so an `APPROVED` or `PENDING` request filed at a branch
  outside the caller's scope also keeps `D` from being an absence. The caller never sees that leave's type, branch,
  status or dates, because its row stays hidden (FR-008, FR-010), but a caller who reads some branches only can infer
  that **something** at another branch covered the day: a shift at her branch, no session there, and no absence row.
  Whether that inference is acceptable, and what the day shows her, is **`TODO(spec)` LH-Q11**
  ([owner-questions.ar.md](owner-questions.ar.md) §12, answer PENDING). The recommended option: no absence, and a
  neutral «متغطي خارج الفرع» / "Covered outside this branch" row with only the date and her branch's shifts (no branch,
  type, status or time of the covering fact), listed only where she may see absences (LH-Q6). The alternatives are no
  row at all, and scoping the coverage to her branches, which would list a day the employee worked at another branch as
  an absence. Until LH-Q11 is answered this draft keeps the coverage across branches and shows no row. In detail:
  no `APPROVED` leave of `E` covers `D` (`from ≤ D ≤ to`), of any type or kind, partial included — the same
  precedence as spec 061 Story 2 §2 (an approved-leave date shows the leave type). A `PENDING` request covering `D` holds the
  absence back until it is decided; a `REJECTED` or `CANCELLED` one does not, and it still shows with its status beside
  the absence row (LH-Q7).
- **BR-003** No non-voided session of `E` has `working_date = D` at **any** branch of the business, whatever its status
  (`OPEN` and `MISSED_OUT` included), the presence rule of spec 064 BR-003. A voided session does not count. A session
  at a branch outside the caller's scope raises the same inference as BR-002, and LH-Q11 settles it the same way.
- **BR-004** A shift counts only after it has ended (LH-Q7, as spec 061 ST-Q8 and FR-013a: «لا يوجد حضور مسجّل» shows
  for an ended shift and never for one that had not ended): at least one shift of `E` at `B` on `D` has `ends_at ≤ now`, so a split day read between its shifts is
  absence until a session of that date appears (BR-003). `now` comes from the injected `LeaveClock`, passed into the
  query as a parameter, never `now()` in SQL (`CLAUDE.md` §4.3).
- **BR-005** Absence is per date: a split day with one attended shift is not absence (BR-003 already holds).
- **BR-006** `D ≥ hire_date` and (`contract_end IS NULL` or `D ≤ contract_end`) for `E`: an open-ended contract (a null
  `contract_end`) never hides an absence; outside the contract there is no absence (the `INELIGIBLE` rule of spec 064
  BR-002).
- **BR-007** The history is computed on every read and never stored, so a sick leave (or any leave) approved later for a
  past day replaces that day's «غياب من غير عذر» on the next read, with no correction step (Abu Salem's note on LH-Q7:
  an employee may be absent and bring a medical leave a day or two later). A leave approved after its month was closed
  for payroll is approved and **changes that closed month's derived figures**, in this history as everywhere else (LH-Q10,
  batch 67, PP-52.1: Abu Salem's option 3 on the decisions page, 2026-10-24 15:32, binding; Waleed's card of 15:40,
  option 1 «a correction in the next month», is history). What that means for a payroll already issued for the month
  belongs to the payroll and statement slice (issue #607), not this read. **Accepted limitation:** the same holds for the schedule. A past schedule can be replaced with a reason
  (spec 020, `SCHEDULE_PAST_REASON_REQUIRED`; ADR-0024 removes the replaced shift rows and keeps only the immutable
  audit), so a correction to a past schedule changes the derived history, exactly as it changes the official statement
  (spec 061 reads the same rows, TD-1 parity). An immutable source for past shifts is issue #609.

### Key Entities

- **LeaveHistoryItem** (contract, new): a discriminated union on `row_type`: `LEAVE` (today's `LeaveListItem` fields,
  its `kind` `FULL_DAY`/`PARTIAL` kept unchanged) or `UNEXCUSED_ABSENCE` (FR-005); a third, neutral covered-elsewhere
  row only if LH-Q11 picks it (BR-002). Both carry `employee_id`, `employee_name_en`, `employee_name_ar`, `employee_number`.
- **LeaveHistoryPage** (contract, new): `items`, `next_cursor`, `as_of` (the boundary instant of the read, TD-2), `last_taken` (`{ annual, sick, unpaid }`, each
  `{ from, to } | null`, plus `unexcused_absence` (`working_date | null`, absent from the object for a caller who may not
  see absences), or `null` when the page is not for one employee), `request_branch_ids` (as today's `LeavePage`), and `absence_branch_ids` (the caller's read branches where she also
  holds `read:attendance:branch`, LH-Q6), so both screens offer the absence type and status only when it is not empty,
  even on an empty page.

## Slice design *(mandatory — `CLAUDE.md` §1)*

A read-only slice: two read routes over one `queries/` builder and two admin screens. No table, no migration expected,
no event, no audit entry (a read of leave data is not on the `CLAUDE.md` §8 audit list).

### Technical decisions

| ID | Decision | Rejected |
|---|---|---|
| TD-1 | **Absence is computed in SQL in `queries/`** (a `NOT EXISTS` anti-join of shifts against sessions, `APPROVED` leave and `PENDING` requests covering the date, BR-002), because `queries/` may not import `domain/` (`CLAUDE.md` §6). A **parity test** keeps it equal to the 27g day-breakdown function of spec 061 FR-013: on the same fixtures at one branch (overnight shift, split shift, voided session, OPEN session, partial leave, unended shift), the absence dates equal the dates the 27g employee form prints «لا يوجد حضور مسجّل». Two differences are allowed, each with its own fixture and test: a session at another branch (BR-003; what a caller scoped to one branch sees on that day is LH-Q11), and a date covered only by a `PENDING` request, which the statement still prints as «لا يوجد حضور مسجّل» while this history holds the absence back (BR-002, LH-Q7) | a read use case that runs the domain function (would need a recorded exception like ADR-0054 §5 for commissions); a stored absence table (a second truth that drifts on every correction) |
| TD-2 | **New routes for the history; one optional filter on today's employee list.** The history is a new shape on new routes; part (a) of the tab reuses today's employee list with an optional, default-off `open` filter, so today's clients and its id cursor are unchanged and part (a) inherits its scope, pagination and actions. Parts (a) and (b) are two reads that share one boundary: the history response returns `as_of` (the instant from the injected `LeaveClock`), and the screen sends it as `as_of` to the part (a) list, so both split on the same branch-local «today» even across midnight. The server bounds every client `as_of` (not later than the clock's now, not older than 24 hours, else `400 VALIDATION_FAILED`; FR-009). A request whose **status** changes between the two reads (a concurrent decision) can still show in neither or both until the next read; this window is accepted, and the screen refetches both parts after every action of its own and when the tab regains focus | a separate endpoint for part (a) (duplicates today's scope, flags, actions and pagination); one statement for both parts (part (a) needs its own cursor pagination) |
| TD-3 | **One builder, two scopes, one exclusion switch.** `queries/leave-history.query.ts` builds the rows for one employee (tab) or a business (report); the routes differ in the scope, the `employee_id` filter and an explicit `excludeOpen` argument: `true` on the tab route only (FR-001 (b)), `false` on the report route, which excludes nothing (LH-14b) | two copies of the SQL; deriving the exclusion from the scope (an implicit mode) |
| TD-4 | **The last-taken line is three `LIMIT 1` lookups** (one per type, `APPROVED` and started, latest `from`) plus one latest-absence lookup over the same anti-join as the rows, on `leave_requests_company_employee_period_idx`, computed **in the same single SQL statement as the page** (CTEs), because `withTenant` offers no isolation option (`packages/db/src/with-tenant.ts` `TenantOptions`: `userId`, `timeoutMs`, `drainOnTimeout`) and under READ COMMITTED two statements could see different data; one statement reads one snapshot; the three leave lookups are filtered to the caller's leave-read branches, the absence lookup to `absence_branch_ids` only (the branches where she also holds `read:attendance:branch`, LH-Q6) (FR-008), in the same `withTenant` transaction as the page (`CLAUDE.md` §6 connection budget) | computing it from the page (wrong once the period is narrowed); separate statements in one transaction (READ COMMITTED gives each its own snapshot) |

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
  `from`, `to`, `types[]`, `statuses[]`, `branch_id?`, `cursor?`, `limit`. Response `LeaveHistoryPage` with `last_taken`; the open requests of (a) are left out (FR-001).
- `GET /v1/businesses/{businessId}/employees/{employeeId}/leave-requests` (today's route) gains an optional `open`
  boolean and an optional `as_of` instant in `leaveListQuery` (both default off, so today's callers see no change):
  `open=true` keeps only the FR-001 (a) requests, with the same id cursor, scope, flags and `request_branch_ids`.
  «Today» is the branch-local date of `as_of` when given (bounded as in FR-009: not later than now, not older than 24
  hours, else `400 VALIDATION_FAILED`), else of the injected `LeaveClock`'s `now` (the same clock
  `LeaveReadAccess.check` already reads), passed into the SQL as a parameter, never `now()` (`CLAUDE.md` §4.3).
- The history response carries `as_of` (FR-001 (b)'s boundary instant), which the tab passes to part (a) (TD-2).
- `GET /v1/businesses/{businessId}/leave-history` — the report. The same query plus `employee_id?`. `last_taken` is filled
  only when `employee_id` is given.
- Errors: `404 NOT_FOUND` (no scope, unknown or foreign business or employee, a soft-deleted employee), `400
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
| **68-1** | Contracts and the employee read | 1. `packages/contracts/src/staff/leave-history.ts` (FR-003…FR-009 shapes), the optional `open` filter on `leaveListQuery` and today's employee leave list (FR-001 (a)), and the OpenAPI regeneration. 2. `queries/leave-history.query.ts` (leave rows without the open requests, absence rows BR-001…BR-007, keyset cursor, last-taken lookups in one statement) and `GET …/employees/{employeeId}/leave-history`. 3. Result-shape tests, `EXPLAIN ANALYZE` assertions, the TD-1 parity test, and integration tests LH-01…LH-24 except the report-only LH-14 and LH-14b (68-2); LH-23 and LH-24 test the cursor's `as_of` and its bounds, which 68-1 ships | 27g done; this spec merged; LH-Q11 answered | 380–480 |
| **68-2** | The business report read | 1. `GET …/leave-history` with `employee_id` and the business scope over the 68-1 builder. 2. Scope tests (branch manager sees her branch only, a request at another branch hidden, absence by shift branch) and `EXPLAIN ANALYZE` on a seeded volume (50 employees × one year of shifts). 3. The report `last_taken` rule (only with `employee_id`) | 68-1 | 200–300 |
| **68-3** | Admin «الإجازات» tab | 1. The tab bar in the employee file (FR-001); in «الإجازات» the part «طلبات جاية ومستنية» on top (today's employee list with `open=true` and its own pagination) with the request button and the cancel, decide and revoke actions, and the history of the period below it without those requests; today's separate request list is removed. 2. The filters with the current-year default, the last-taken line, and the i18n keys. 3. UI tests that assert what the user sees (the default dates, a filtered list, «مفيش», the absence row, an upcoming and a pending request in the top part and not in the history, each request once, the actions still present) | 68-1 | 300–400 |
| **68-4** | Admin report screen «سجل الإجازات» | 1. The page and its navigation entry, shown to holders of the leave read scope. 2. The employee and branch filters and the last-taken line for one employee. 3. UI tests (visible outcomes) | 68-2, 68-3 | 250–350 |

### Test plan

- **Integration (68-1, 68-2)**, PostgreSQL, one cloned database per spec file (ADR-0006), as `pospay_app`:
  `LH-01` all four statuses listed, newest first · `LH-02` period overlap at both edges (a leave across 1 January) ·
  `LH-03` type and status filters, absence-only filter, the type and status filters combined with AND, the `ABSENT` status (LH-Q8) · `LH-04` absence on a scheduled day with no session and no leave ·
  `LH-05` approved partial leave excuses; a pending request holds the absence back; rejected and cancelled do not (LH-Q7) · `LH-06` OPEN and `MISSED_OUT` sessions excuse, a
  voided one does not · `LH-07` a session at another branch excuses (and what a caller scoped to the other branch sees follows LH-Q11) · `LH-08` an unended shift is not absence (the clock
  passed in) · `LH-09` split day: one shift attended is not absence; read between its shifts with no session it is · `LH-10` dates outside `hire_date`/`contract_end`, and an open-ended contract (null `contract_end`) still shows absence ·
  `LH-11` last-taken line over all history, independent of the period, approved and started leave only (a future approved and a pending request ignored), the latest absence item shown only with the attendance permission (LH-Q9) · `LH-12` keyset pagination across a date with
  leave and absence rows, no row twice or lost · `LH-13` the last-taken line ignores a leave at a branch outside the caller's scope · `LH-13b` a caller with `read:leave:branch` on السالمية and حولي but `read:attendance:branch` on السالمية only: the latest-absence item never comes from حولي · `LH-13c` an `APPROVED` or `PENDING` leave filed at حولي keeps an السالمية shift day from being an absence for منى, while the حولي leave row stays hidden from her (BR-002); what that day shows her follows LH-Q11 · `LH-19` replacing a past schedule with a reason changes the derived absence the same way it changes the 27g statement (BR-007, issue #609) · `LH-20` a concurrent leave approval never shows an absence row and a `last_taken` that disagree (one statement, TD-4) · `LH-21` today's employee list with `open=true` returns every request with `to ≥` today (branch date) or `PENDING`, keeps the branch scope (a حولي open request hidden from منى), pages through more than 100 open requests with its cursor, and none of those requests appears in the tab's history rows; without `open` the list is unchanged; the report excludes nothing · `LH-22` the absence id is `(array_agg(shift.id ORDER BY shift.id))[1]`, stable across reads and pages on a split day · `LH-23` page 2 read after the branch-local date has rolled over (the clock moved past midnight between pages) reuses the cursor's `as_of`: no row twice, none skipped, the same open split, the same ended shifts, and a `last_taken` consistent with the advertised `as_of` (a leave starting on the new day does not count yet) · `LH-24` an `as_of` later than the clock's now, or older than 24 hours, in a history cursor or in the `open=true` list, is `400 VALIDATION_FAILED` · `LH-14` the report's `employee_id` of an employee outside the caller's branches answers 404 · `LH-14b` the report lists an old pending request and a request ending today (open requests are never excluded there) · `LH-15` a caller with `read:leave:branch` but not `read:attendance:branch` gets leave rows only and no absence type (LH-Q6) · plus the access cases of User Story 4 and a cross-tenant read that
  returns 404.
- `LH-16` a sick leave approved later for a past absent day replaces that day's absence on the next read (BR-007).
- `LH-17` a date covered only by a `PENDING` request shows the request and no absence, the statement-parity exception of
  TD-1 (BR-002); `LH-18` `absence_branch_ids` is empty for a leave-only caller, also on an empty page (LH-Q6).
- **Queries**: a result-shape test and an `EXPLAIN ANALYZE` assertion for each route (`CLAUDE.md` §9).
- **Parity (TD-1)**: the absence dates equal the 27g employee form's «لا يوجد حضور مسجّل» dates on shared fixtures,
  except the two named differences (another-branch session, pending request), each with its own fixture.
- **UI (68-3, 68-4)**: visible outcomes only (`CLAUDE.md` §9).
- No RLS negative test is added: no table is added.

### Documents to update in the same PRs

- 68-1: `docs/module-map.md` only if a new port is added (none is expected: the read stays inside `staff`).
- 68-4: the roadmap row AS-26 is set done by the orchestrator after the merge (`CLAUDE.md` §1 5c).
- When the close lifecycle of issue #607 is decided, the payroll and statement spec changes, not this one.

## Success Criteria *(mandatory)*

- **SC-001** A manager answers «ريم أخدت سنوية آخر مرة إمتى؟» from the employee file in one click.
- **SC-002** Every leave request and every unexcused absence appears exactly once per view, with its status: in the tab
  either in «طلبات جاية ومستنية» or in the history of the period, never both, for the shared `as_of` boundary
  (FR-001); the only exception is the accepted status-change window between the two reads (TD-2), closed by the next
  refetch.
- **SC-003** A branch manager never sees a row of another branch.
- **SC-004** Each route answers within 200 ms at p95 for one year of one business's data on the seeded volume.

## Assumptions

- Row 27g has merged its day-breakdown function (spec 061 FR-013) before 68-1 starts, so the parity test has its
  reference.
- The schedule (ADR-0024) is the only source of scheduled days; default contract hours without a schedule shift never
  create an absence, as spec 061 never prints «لا يوجد حضور مسجّل» for them.
- No export (PDF or Excel) and no totals per type in this slice; either would be a new owner request.
- **Month-end close before payroll** (Abu Salem's note on LH-Q7: «و نحط في الحسبان الايام الأخير في نهاية الشهر انه لازم
  يتقفل قبل اصدار تقرير الرواتب»). This screen only reads, so it closes nothing. LH-Q10 ([owner-questions.ar.md](owner-questions.ar.md)
  §11, Abu Salem's option 3, binding: the late leave changes the closed month itself) settles what a late leave does to a
  closed month (BR-007). The close lifecycle itself (is a close mandatory, who closes, reopening) is **`TODO(spec)`** in the payroll
  and statement slice, issue #607.
