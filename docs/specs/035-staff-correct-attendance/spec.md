# Feature Specification: Correct an attendance session

**Feature Branch**: `feat/p1-26-correct-attendance`

**Created**: 2026-10-08

**Status**: Draft — owner questions CA-Q1…CA-Q16 decided (Waleed, 2026-10-08).

**Input**: User description: "staff-correct-attendance — Phase 1 PR 26."

**Phase 1 row**: PR 26 (`docs/specs/phase-1/IMPLEMENTATION-PLAN.md:66`, depends on 22). Builds on spec 027 (clock
attendance), 029 (missed-out job), 032 (clock by card) and **builds on spec 034** (PR 25, resolve / reopen an
attendance exception, PR #126). Implementation starts only after #126 merges.

**Follow-ups (CA-Q6, out of scope here)**: PR 26b `add-manual-session` and PR 26c `void-attendance-session`, each its
own spec and PR, both depending on 26 (plan rows added after row 26).

**What the documents already decide**

- The manager corrects with a reason; the old value is kept; a missed clock-out is never turned into hours or a
  deduction (PRD D-32, `docs/PRD.md:978`; P1-T5.6, `docs/PRD.md:601`).
- The manager handles exceptions with a mandatory reason and **the owner sees every edit** (PRD D-12,
  `docs/PRD.md:958`).
- The history entity exists in the domain model: `AttendanceCorrection session_id · field · before · after · reason ·
  by · at` (SPEC §4, `docs/specs/phase-1/SPEC.md:126`).
- Attendance never touches commission (SPEC §7 and A7, `docs/specs/phase-1/SPEC.md:361`, `:447`). A correction
  therefore has no effect on statements, approvals or commission corrections.
- `working_date` is the clock-in date in the branch timezone (SPEC §7, `docs/specs/phase-1/SPEC.md:353`).
- Lateness is a report fact snapshotted at clock-in: 0 up to 10 minutes after the scheduled start, otherwise all
  elapsed whole minutes (spec 027 AT-Q7; ADR-0028).
- A MISSED_OUT session is closed at clock-in + 16 h (spec 027 AT-Q6). Fixing its times is this PR (spec 034 RE-Q9;
  spec 029 MO-Q6).
- Resolving an exception never changes times (spec 034 FR-005). Changing times is only this PR.

## Owner questions

All sixteen were decided by Waleed on 2026-10-08. The salon examples use invented names.

- **CA-Q1 — Who may correct.** Decided (Waleed, 2026-10-08): a new permission `correct:attendance:branch`. By default
  it is held by the owner, the general manager, the business manager and the branch manager, on the session's branch.
  It is device-forbidden, so the paired device is always refused. It is separate from `resolve:attendance:branch`, so
  "close warnings" and "change times" can be given to different people.
- **CA-Q2 — Correcting your own attendance.** Decided (Waleed, 2026-10-08): **only the owner may correct the owner's
  own attendance.** Every other role, the general manager included, is refused on their own attendance.
  **This deliberately differs from spec 034 RE-Q3**, which refuses the owner too on their own exceptions. Reviewers
  must not "align" the two: they are separate owner decisions. "Owner" means the actor holds the system Owner role
  identified by its fixed global role ID at COMPANY scope (ADR-0025), not a personal ALLOW.
- **CA-Q3 — Second-person approval.** Decided (Waleed, 2026-10-08): none. A correction takes effect at once, and the
  owner sees the full history. PRD P1-T5.6's "approval" is superseded (`docs/PRD.md:554`).
- **CA-Q4 — Which fields.** Decided (Waleed, 2026-10-08): the clock-in time and the clock-out time of a session that
  is CLOSED or MISSED_OUT, one or both in one request. The branch and everything else are not editable.
- **CA-Q5 — A session that is still open.** Decided (Waleed, 2026-10-08): not corrected here. The employee's next scan
  or the 16 h job closes it, and then the manager corrects it.
- **CA-Q6 — Adding a missing session, removing a wrong one.** Decided (Waleed, 2026-10-08): managers may add a missing
  session and remove a wrong one, always recorded under the actor's name. "Remove" means **void**, not delete: the
  session stays, marked voided with who, when and why, and is left out of reports. This follows `CLAUDE.md` §5, where
  soft delete is allowed only for items, customers, employees and categories. One use case per PR (`CLAUDE.md` §1)
  makes three PRs: **26 correct** (this spec), **26b add-manual-session** (source `MANUAL`) and **26c void-session**.
  26b and 26c are out of scope here. The constraints they place on this PR are listed under "Room for 26b and 26c".
- **CA-Q7 — A corrected MISSED_OUT session.** Decided (Waleed, 2026-10-08): it stays `MISSED_OUT`, with `closed_by`
  still `MISSED_OUT`. The clock-out becomes the corrected time, and the correction history shows the change.
- **CA-Q8 — Limits on the new times.** Decided (Waleed, 2026-10-08):
  - clock-out strictly after clock-in
  - no time later than now
  - at most 16 h long
  - no overlap with another session of the same employee
- **CA-Q9 — How far back.** Decided (Waleed, 2026-10-08): any date, always audited.
- **CA-Q10 — Lateness after a clock-in change.** Decided (Waleed, 2026-10-08): recompute it from the shift recorded at
  clock-in (`scheduled_start`), with the same 10-minute rule (AT-Q7).
- **CA-Q11 — A clock-in change that crosses midnight.** Decided (Waleed, 2026-10-08): refuse a clock-in correction
  that would move the session to another working date.
- **CA-Q12 — Effect on the session's exceptions.** Decided (Waleed, 2026-10-08): none. Exceptions stay as they are,
  and the manager closes them with PR 25. PR 25's resolution CHECK is untouched.
- **CA-Q13 — A correction inside approved leave.** Decided (Waleed, 2026-10-08): allowed, with no leave check.
  PR 26 reads no leave data. The note at `docs/module-map.md:161` is corrected in the implementation PR.
- **CA-Q14 — Telling the employee.** Decided (Waleed, 2026-10-08): no message.
- **CA-Q15 — Screen.** Decided (Waleed, 2026-10-08): API only. The correction form ships with the attendance board
  (PR 27).
- **CA-Q16 — Correcting again.** Decided (Waleed, 2026-10-08): a session may be corrected any number of times. Every
  correction adds history rows, and nothing is erased.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A manager fixes a forgotten clock-out (Priority: P1)

Lina forgot to clock out. At 16 h the system closed her session as MISSED_OUT at 02:00 the next morning. The
branch manager knows she left at 18:00. The manager sets the clock-out to 18:00 with the reason "left at 18:00,
confirmed by reception". The session now shows 18:00 and is still marked MISSED_OUT. The history keeps 02:00, the
new 18:00, who changed it, when and why.

**Why this priority**: D-32's core promise: missed punches are fixed by a manager, never silently.

**Independent Test**: Close a session MISSED_OUT, correct its clock-out with a reason, then read back the session,
one correction row and one audit entry.

**Acceptance Scenarios**:

1. **Given** a MISSED_OUT session in branch A, **When** the branch manager of A corrects `clock_out` with a reason,
   **Then** `clock_out` is the new time, status and `closed_by` stay `MISSED_OUT`, `revision` + 1, one
   `attendance_corrections` row holds the field, before, after, reason, actor and time, and one audit entry holds
   before and after.
2. **Given** the same request is sent twice with the same `Idempotency-Key`, **Then** the second answer replays the
   first and writes nothing.
3. **Given** a session already corrected once, **When** it is corrected again, **Then** a further correction row is
   added and the earlier rows are unchanged (CA-Q16).

---

### User Story 2 - A manager fixes a wrong clock-in (Priority: P2)

Huda's phone was dead. She scanned at 10:40 but arrived at 10:05; her shift started at 10:00. The manager corrects
the clock-in with a reason. Her lateness drops from 40 minutes to 0.

**Independent Test**: Correct `clock_in` on a CLOSED session. The correction row exists and `late_minutes` is
recomputed.

**Acceptance Scenarios**:

1. **Given** a CLOSED session with `late_minutes` 40 and a recorded shift start of 10:00, **When** clock-in is
   corrected to 10:05, **Then** `late_minutes` is 0, the correction history has a `CLOCK_IN` row, and the audit
   `before`/`after` include `late_minutes` 40 → 0.
2. **Given** both times are corrected in one request, **Then** one correction row exists per changed field, and they
   share the reason, actor, time and request id.
3. **Given** a session with no recorded shift (`scheduled_start` empty), **When** clock-in is corrected, **Then**
   `late_minutes` stays 0.

---

### User Story 3 - The owner corrects her own day; a manager cannot (Priority: P2)

The owner also works shifts. She forgot to clock out and corrects her own session herself; that is allowed. The
general manager tries to correct his own late clock-in and is refused; another manager must do it.

**Independent Test**: The owner corrects her own session (200). A general manager with the permission corrects his
own session (403).

**Acceptance Scenarios**:

1. **Given** the owner's own CLOSED session, **When** the owner corrects it, **Then** it succeeds and is recorded
   under her name.
2. **Given** a general manager's own session, **When** he corrects it, **Then**
   `ATTENDANCE_CORRECTION_SELF_FORBIDDEN` (403) and nothing changes. The same applies to business and branch managers
   and to anyone with a personal ALLOW.

---

### Edge Cases

- A reason that is empty, only spaces, or over 500 characters → `VALIDATION_FAILED` (400), the same bounds as spec
  034.
- No time in the body, or a new time equal to the current one → `VALIDATION_FAILED`. A correction must change
  something.
- A stale `revision` (someone else corrected the session, or a scan or the job closed it, in between) →
  `ATTENDANCE_SESSION_REVISION_CONFLICT` (409). Nothing changes. With two concurrent corrections, exactly one wins.
- An OPEN session → `ATTENDANCE_SESSION_OPEN` (409) (CA-Q5).
- Any of the following → `ATTENDANCE_CORRECTION_INVALID_TIMES` (422) (CA-Q8):
  - clock-out at or before clock-in
  - a time after now
  - a session longer than 16 h (exactly 16 h is allowed, matching the MISSED_OUT closure)
  - an overlap with another session of the same employee

  Touching ends (one session's clock-out equals the next one's clock-in) are not an overlap. The overlap check
  includes the employee's OPEN session, if any.
- A clock-in moved to another working date (in the session's stored timezone) → `ATTENDANCE_CORRECTION_WORKING_DATE`
  (422) (CA-Q11). Moving clock-out past midnight is allowed: overnight sessions keep their clock-in working date.
- A non-owner correcting their own session → `ATTENDANCE_CORRECTION_SELF_FORBIDDEN` (403). The owner correcting their
  own session is allowed (CA-Q2, differs from RE-Q3 on purpose).
- A caller without the permission on the session's branch, or a session of another business or company →
  `NOT_FOUND`. The response never confirms that the session exists.
- The paired device → `FORBIDDEN` (403). A personal staff session is refused earlier by the shared session guard with `UNAUTHENTICATED` (401), the same as every other management route; this slice does not change that guard.
- A correction on a day of approved leave is accepted; leave is not read (CA-Q13).
- A correction on a very old date is accepted (CA-Q9).
- An employee scans within 5 minutes after a correction to her latest session. The 5-minute repeat-scan rule replays
  her stored last scan result unchanged. That is harmless: the stored result is the scan's own answer, not the
  session.
- A card-closed session (`out_operator_id` set) is corrected like any other. The operator and device fields are
  scan facts and stay unchanged.
- Location fields (`geo`, coordinates, accuracy) are facts of the scan and never change. Exceptions are never
  touched (CA-Q12).
- When the order of rules matters for a well-formed request, they are checked in this order: self, then state (open),
  then revision, then times and working date.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A holder of `correct:attendance:branch` on the session's branch MUST be able to correct the clock-in
  and/or clock-out of a CLOSED or MISSED_OUT session, with a reason of 1–500 trimmed characters (CA-Q1, CA-Q4).
- **FR-002**: Every correction MUST keep the previous value. It writes one `AttendanceCorrection` row per changed
  field (SPEC §4) and one audit entry with before and after, in the same transaction as the change (D-12, D-32).
  Corrections take effect at once, with no approval step (CA-Q3), and may be repeated without limit (CA-Q16).
- **FR-003**: A correction MUST NOT create hours, pay, deductions or any commission input (D-32, SPEC §7 A7).
- **FR-004**: The system MUST refuse the following:
  - OPEN sessions (CA-Q5)
  - times that break CA-Q8
  - a clock-in that changes the working date (CA-Q11)
  - a non-owner's own attendance (CA-Q2)
  - callers outside the branch scope
  - the paired device
  - a stale `revision`
- **FR-005**: A corrected clock-in MUST recompute `late_minutes` from the stored `scheduled_start` with the AT-Q7 rule
  (CA-Q10). Correcting only the clock-out leaves `late_minutes` unchanged.
- **FR-006**: A corrected MISSED_OUT session MUST keep status and `closed_by` `MISSED_OUT` (CA-Q7).
- **FR-007**: A correction MUST NOT change the session's exceptions (CA-Q12), and MUST NOT read leave (CA-Q13).
- **FR-008**: The action MUST require `Idempotency-Key`. Replaying the same key and body returns the stored answer and
  writes nothing; the same key with another body is refused.
- **FR-009**: No message is sent to the employee (CA-Q14).
- **FR-010**: There is no date limit on corrections (CA-Q9).

### Key Entities

- **Attendance session** (exists): gains a `revision` that increases on every change, including scan and job
  closures.
- **Attendance correction** (new, SPEC §4): one append-only row per changed field. It holds the session, the field
  (`CLOCK_IN` | `CLOCK_OUT`), the before value, the after value, the reason, the actor, the time and the request id.
  It is never updated or deleted.
- **Audit entry** (exists): one per correction request.

## Slice design *(mandatory — `CLAUDE.md` §1)*

### Business rules

- **BR-001**: The only decision function is a pure domain function, `planAttendanceCorrection(session, change,
  context)`. Its inputs are the session, the requested times, and a context of now, the neighbouring sessions, and
  the actor-is-employee and actor-is-owner flags. It returns the new session values plus the correction rows, or a
  named refusal. It checks the following:
  - the state: CLOSED or MISSED_OUT only (CA-Q5)
  - the limits, using the neighbouring sessions passed in (CA-Q8)
  - the working date, using `attendanceWorkingDate` with the session's stored timezone (CA-Q11)
  - the self rule: refuse when the actor is the employee unless the actor is the owner (CA-Q2)

  Lateness reuses `attendanceLateMinutes(scheduled_start, newClockIn)` (CA-Q10).
- **BR-002**: Lock order follows ADR-0028: the employee's `AttendanceState` first, then identity's company and ordered
  membership locks (the PR 25 access pattern), then the session row and the employee's neighbouring sessions. The
  injected Clock is sampled for a non-locking branch-permission precheck before any target lock (so an unauthorised caller always gets the same `NOT_FOUND`, never a lock timeout), and again after the locks; the post-lock sample is the authoritative one for every rule. This serialises a correction with scans and the missed-out job.
- **BR-003**: `revision` on `attendance_sessions` increases with every write: the scan close, the card close, the job
  close and the correction. A request carries the revision it saw.
- **BR-004**: Authority is checked on the session's `branch_id` (the clock-in branch).
- **BR-005**: The scan facts never change: source, binding, QR window, location, device, operator, and also status
  and `closed_by` (CA-Q7).
- **BR-006**: The owner check uses identity's resolved membership (fixed global Owner role at COMPANY scope,
  ADR-0025). It is read through the same identity access port as the permission, never from the client.

### Room for 26b and 26c (CA-Q6)

PR 26 must not block the two follow-ups:

- `attendance_corrections` refers to a session only by `(company_id, session_id)` and does not assume `source` is QR
  or BARCODE. A `MANUAL` session from 26b is correctable by the same function. 26b decides its own `scheduled_start`
  snapshot rule.
- `revision` is a plain counter on the session that 26c's void will also increment.
- 26c adds its own void columns (or status), and adds "voided session → refused" and "voided sessions are ignored by
  the overlap check" to `planAttendanceCorrection`. PR 26 adds no `source` or `status` values.
- The `field` CHECK covers only `CLOCK_IN` and `CLOCK_OUT`. Add and void are recorded by their own audit entries and
  their own columns, not as fake correction rows.

### Schema changes

| Table | Columns added / changed | RLS policy | Indexes | Tenant-qualified FKs |
|---|---|---|---|---|
| `attendance_sessions` | add `revision integer NOT NULL DEFAULT 0` (+ CHECK ≥ 0). The `status`, `closed_by` and `source` CHECKs are unchanged | unchanged | none new | unchanged |
| `attendance_corrections` (new) | `company_id`, `id` (UUID v7), `business_id`, `branch_id`, `employee_id`, `session_id`, `request_id`, `field` CHECK IN ('CLOCK_IN','CLOCK_OUT'), `before_at timestamptz NOT NULL`, `after_at timestamptz NOT NULL`, `reason` (trimmed, 1–500), `corrected_by` → user, `corrected_at timestamptz NOT NULL` | ENABLE + FORCE; tenant policy; `pospay_app` SELECT + INSERT only (append-only) | PK `(company_id, id)`; `(company_id, session_id, corrected_at)`; `(company_id, business_id, branch_id, corrected_at)` for the PR 27 board; `(company_id, employee_id, corrected_at)`; `(company_id, corrected_by)` | `(company_id, session_id)` → sessions; `(company_id, business_id, employee_id)` → employees; `(company_id, business_id, branch_id)` → branches |
| `permissions`, `role_permissions` | insert `correct:attendance:branch`; default holders owner, general_manager, business_manager, branch_manager | — | — | — |

- One expand migration, numbered at merge time (after PR 25's migration). It adds the new table, its RLS and grants,
  the session column, and the permission rows. Nothing is dropped. Exceptions and their CHECKs are untouched
  (CA-Q12).
- The grant allowlist in `packages/db/src/__tests__/privileges.spec.ts` gains `attendance_corrections`.

### API contract

- **Correct**: `POST /v1/businesses/:businessId/attendance-sessions/:sessionId/correct`, with `@Authenticated()` plus
  the use-case permission check (PR 25 pattern). Feature flag: none (as clock attendance).
- **Request**: `{ revision: int ≥ 0, clock_in?: ISO instant, clock_out?: ISO instant, reason: string 1–500 trimmed }`.
  At least one time is required. The Zod schema lives in `packages/contracts/src/staff/attendance-correction.ts`, with
  its OpenAPI file.
- **Response (200)**: `{ session: { id, employee_id, branch_id, working_date, clock_in, clock_out, status, closed_by,
  late_minutes, revision }, corrections: [{ id, field, before, after, reason, corrected_by, corrected_at }] }`. The
  `corrections` list holds the rows written by this request.
- **Idempotency-Key**: required.
- **Errors**:
  - `NOT_FOUND` 404
  - `FORBIDDEN` 403
  - `ATTENDANCE_CORRECTION_SELF_FORBIDDEN` 403
  - `ATTENDANCE_SESSION_OPEN` 409
  - `ATTENDANCE_SESSION_REVISION_CONFLICT` 409
  - `ATTENDANCE_CORRECTION_INVALID_TIMES` 422
  - `ATTENDANCE_CORRECTION_WORKING_DATE` 422
  - `VALIDATION_FAILED` 400
  - `IDEMPOTENCY_KEY_REUSED`
  - `TRANSACTION_RETRY_REQUIRED`
  - `NOT_READY` 503

  Each one carries `message_ar` / `message_en`.

### Permissions

- `correct:attendance:branch` (new) is added to the access catalog, `ROLE_DEFAULTS` (`[...managers,
  'branch_manager']`), `deviceForbidden`, `system-role-policy` and the `packages/i18n` permission names. As with
  `resolve:attendance:branch`, it is not added to the list every system role may be granted.

### Events

- **Published**: none. Nothing consumes attendance (`module-map.md:151`), and an event without a consumer would be an
  undeclared arrow (the same reasoning as spec 034 RE-Q7).
- **Consumed**: none. No notification (CA-Q14).

### Test plan

- **Domain unit**:
  - each field (clock-in, clock-out, both) × each state (OPEN refused, CLOSED, MISSED_OUT stays MISSED_OUT)
  - limits at their boundaries: equal times, exactly 16 h vs 16 h + 1 ms, a touching neighbour vs an overlapping one,
    an overlap with the OPEN session, now vs now + 1 ms
  - working date across a Kuwait midnight (clock-in refused, clock-out allowed)
  - lateness at 10 and 11 minutes, with no schedule, and unchanged on a clock-out-only correction
  - the self rule: owner allowed, general manager refused
  - reason bounds and revision mismatch
- **Integration** (`CA-01`…):
  - `CA-01` correct the clock-out of a MISSED_OUT session; status stays MISSED_OUT
  - `CA-02` correct the clock-in of a CLOSED session; lateness recomputed
  - `CA-03` both fields in one request: two rows, one audit entry
  - `CA-04` OPEN session refused
  - `CA-05` the owner corrects her own session (200); a general manager, a business manager and a branch manager on
    their own session (403)
  - `CA-06` another branch → NOT_FOUND
  - `CA-07` device and personal session refused
  - `CA-08` stale revision → 409; two concurrent corrections, exactly one wins
  - `CA-09` a correction racing a scan close on the same employee is serialised by the State lock
  - `CA-10` idempotent replay and key reuse with another body
  - `CA-11` exceptions, geo and scan facts unchanged
  - `CA-12` overlap, over 16 h and future refused
  - `CA-13` cross-midnight clock-in refused
  - `CA-14` a scan close, a card close and a job close increment `revision`
  - `CA-15` a session corrected twice: two history rows kept in order
  - `CA-16` a correction on an approved-leave day and one on a date months back are accepted
- **RLS negative**: `attendance_corrections` cross-tenant SELECT = 0 and INSERT refused, with no UPDATE or DELETE
  privilege; a session of company B is `NOT_FOUND` for company A.
- **Queries**: none in this PR (the board and correction history ship with PR 27).

### Documents to update in the same PR

- `docs/module-map.md:161`: remove "attendance PR 26 will read approved intervals" (CA-Q13: PR 26 reads no leave).
- `docs/specs/029-staff-missed-out-job/spec.md:118` (MO-Q6): point MISSED_OUT correction to this spec.

### Files expected to be shared with PR 25 (spec 034, PR #126)

PR #126 merges first; PR 26 rebases on it.

- `packages/db/schema/staff-attendance.ts`: PR 25 adds `revision` to exceptions; PR 26 adds `revision` to sessions
  and the new table.
- `apps/api/src/modules/staff/persistence/attendance-writes.ts`: both bump revisions on close.
- `apps/api/src/modules/staff/staff.module.ts`.
- `apps/api/src/shared/errors.ts`.
- `packages/db/src/access-catalog.ts`, `role-defaults.ts` and `system-role-policy.ts`, plus `role-defaults.spec.ts`.
- `packages/i18n/src/{ar,en,permission-name}.ts`.
- `packages/contracts/src/{index,openapi}.ts` and `openapi/openapi.json`.
- `apps/{admin,pos}/src/shared/api/schema.d.ts`.
- `packages/db/migrations/meta/_journal.json`.
- PR 25's `apps/api/src/modules/identity/persistence/attendance-exception-access.ts` is reused or generalised for the
  correction permission and the owner check.

Also touched: `apps/worker/src/modules/staff/persistence/missed-out-writes.ts` (revision bump on the job close).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A manager fixes a wrong or missing clock time in one action. For 100 % of corrections the owner can see
  the old value, the new value, who changed it, when and why.
- **SC-002**: No correction ever changes commission, pay, exceptions, or any scan fact (location, device, operator).
- **SC-003**: When two managers correct the same session at the same moment, exactly one change is recorded.
- **SC-004**: After corrections, no employee has two sessions covering the same minute.

## Assumptions

- There is no production data. Existing sessions get `revision` 0.
- The board, the correction history list and the form arrive with PR 27 (CA-Q15). Until then the API is exercised by
  tests only.
- Times are sent as UTC instants. The future screen converts from the branch timezone.
- "The actor is the employee" uses `employees.user_id`, as in spec 034.
- PRD P1-T10.4 (approval blocked by open attendance exceptions) stays dropped (spec 034 RE-Q5). SPEC §6 "blocked
  correction" concerns commission periods, not attendance.


## Implementation notes (orchestrator, 2026-10-08)

- A request succeeds when at least one field differs from the current value. Only the fields that changed get a correction row. A request in which nothing changes is a validation error.
- "Nothing consumes attendance" is out of date: the worker's missed-out and not-clocked-in jobs schedule themselves from attendance events. Corrections still publish no event, so those jobs are unaffected.
