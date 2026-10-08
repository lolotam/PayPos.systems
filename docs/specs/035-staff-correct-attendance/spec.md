# Feature Specification: Correct an attendance session

**Feature Branch**: `feat/p1-26-correct-attendance`

**Created**: 2026-10-08

**Status**: Draft — owner questions CA-Q1…CA-Q16 **PENDING**.

**Input**: User description: "staff-correct-attendance — Phase 1 PR 26."

**Phase 1 row**: PR 26 (`docs/specs/phase-1/IMPLEMENTATION-PLAN.md:66`, depends on 22). Builds on spec 027 (clock
attendance), 029 (missed-out job), 032 (clock by card) and **sits on top of spec 034** (PR 25, resolve / reopen an
attendance exception), which merges first.

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

All **PENDING**. In each one the recommended option comes first. The salon examples use invented names.

- **CA-Q1 — Who may correct.** **PENDING**
  1. *(recommended)* A new permission `correct:attendance:branch`. By default the four managers hold it (owner,
     general manager, business manager, branch manager), on the session's branch. The paired device is refused.
  2. Reuse PR 25's `resolve:attendance:branch` (one permission for "manage attendance").
  3. Option 1 plus the shift supervisor.
  *Why:* the four managers already decide leave and resolve exceptions. A separate code lets the owner give
  "close warnings" to someone without also giving "change times".
  *Example:* a branch manager fixes Mona's clock-out. Can the reception cashier do the same?

- **CA-Q2 — Correcting your own attendance.** **PENDING**
  1. *(recommended)* Refused for everyone, the owner too. Another manager has to do it.
  2. Refused except for the owner.
  3. Allowed, because it is audited.
  *Why:* this mirrors leave decisions and RE-Q3. A manager who edits her own hours cannot be checked.
  *Example:* the branch manager forgot to clock out. Should she fix it herself?

- **CA-Q3 — Second-person approval.** PRD P1-T5.6 says "approval"; D-32, D-12 and SPEC §4 do not. **PENDING**
  1. *(recommended)* No second approval. The manager's correction takes effect at once, and the owner sees the full
     history.
  2. Every correction by someone other than the owner waits for the owner's approval.
  3. Approval only when a time moves by more than N hours.
  *Why:* SPEC supersedes the PRD where they differ (`docs/PRD.md:554`). Nothing financial depends on attendance in
  Phase 1. An approval queue would add a screen and a state machine.
  *Example:* the manager moves Sara's clock-in from 10:40 to 10:05. Does the owner have to press "approve"?

- **CA-Q4 — Which fields.** **PENDING**
  1. *(recommended)* The clock-in time and the clock-out time of a session that is CLOSED or MISSED_OUT, one or both
     in one request.
  2. Clock-out only.
  3. Option 1 plus the branch of the session.
  *Why:* the decided documents only talk about times.
  *Example:* Huda scanned the QR 30 minutes late because her phone was dead. Can the clock-in be fixed, or only a
  forgotten clock-out?

- **CA-Q5 — A session that is still open.** **PENDING**
  1. *(recommended)* Not here. The employee's next scan or the 16 h job closes it, and then the manager corrects it.
  2. The manager may close an open session by entering its clock-out time. This needs a new "closed by manager"
     value.
  *Why:* closing by hand races the employee's own scan and the missed-out job. It also leaves a suspected
  exception and the 5-minute repeat-scan rule to handle.
  *Example:* at 21:00 Nour is still "in" although she left at 19:00. Close her now, or wait for the system?

- **CA-Q6 — Adding a missing session, or deleting a mistaken one.** **PENDING**
  1. *(recommended)* Not in this PR. Each is a separate later slice, if wanted.
  2. Add a whole session by hand (source `MANUAL`, which the PRD lists at `docs/PRD.md:215` but SPEC §4 does not).
  3. Both adding and deleting.
  *Why:* PR 26 is "correct a session". Adding or deleting a session is a different use case (`CLAUDE.md` §1).
  *Example:* Reem worked all day but never scanned. Can the manager create her day?

- **CA-Q7 — A corrected MISSED_OUT session.** **PENDING**
  1. *(recommended)* It stays MISSED_OUT ("she forgot to clock out" remains a fact). The clock-out becomes the
     corrected time, and the correction history shows the change.
  2. It becomes CLOSED, as if she had clocked out.
  *Why:* the board and the monthly report still show who forgets to clock out, while the hours become right.
  *Example:* Lina forgot to clock out and the system closed her at 16 h. The manager sets 18:00. Does she still count
  as "forgot"?

- **CA-Q8 — Limits on the new times.** **PENDING**
  1. *(recommended)* Clock-out after clock-in. No time in the future. At most 16 h long. No overlap with another
     session of the same employee.
  2. Only clock-out after clock-in and no future time.
  *Why:* 16 h is the system's own limit (D-53). An overlap would count the same hour twice in the report.
  *Example:* a typing mistake makes Sara's shift 9:00 to 9:00 the next day (24 h). Refuse it?

- **CA-Q9 — How far back.** **PENDING**
  1. *(recommended)* Any date, always audited (the same rule as salary, SPEC §4).
  2. The current and the previous calendar month only.
  3. The last N days.
  *Why:* nothing financial reads attendance in Phase 1. A cut-off only matters if lateness deductions arrive later,
  and that is a later decision.
  *Example:* in March the manager finds a January mistake. Can she still fix it?

- **CA-Q10 — Lateness after a clock-in change.** **PENDING**
  1. *(recommended)* Recompute it from the same shift that was recorded at clock-in, with the same 10-minute rule.
  2. Keep the original lateness unchanged.
  *Why:* the report should show when she really arrived. The old figure stays in the history.
  *Example:* Huda's shift starts at 10:00. Her scan said 10:40, which counted 40 late minutes. Corrected to 10:05,
  she has 0 late minutes.

- **CA-Q11 — A clock-in change that crosses midnight.** **PENDING**
  1. *(recommended)* Refuse a clock-in correction that would move the session to another working date.
  2. Allow it, and recompute the working date and the shift for that day.
  *Why:* the working date picks the day's shift and the board day. Moving across days is rare and confusing.
  *Example:* a night session recorded at 00:10 should have been 23:50 the evening before.

- **CA-Q12 — Effect on the session's exceptions.** **PENDING**
  1. *(recommended)* None. Location warnings stay as they are, and the manager closes them with PR 25.
  2. A correction closes the session's open exceptions automatically. This needs a new resolution value and changes
     PR 25's CHECK.
  *Why:* a time correction says nothing about where she was. Keeping the two actions apart keeps each one audited
  with its own reason.
  *Example:* Sara's clock-in had an "out of range" warning. Fixing her clock-out should not close that warning.

- **CA-Q13 — A correction inside approved leave.** `module-map.md:161` says "attendance PR 26 will read approved
  intervals". **PENDING**
  1. *(recommended)* Allow it with no leave check, and fix the module-map note.
  2. Refuse a correction whose times fall inside her approved leave.
  3. Allow it but return a warning.
  *Why:* if she actually worked, the record must say so. Reading leave adds a cross-check and a new arrow.
  *Example:* Mona was on approved leave on Thursday but came in for 2 hours.

- **CA-Q14 — Telling the employee.** **PENDING**
  1. *(recommended)* No message (the same as RE-Q12). She will see the corrected times when her own attendance view
     ships.
  2. An in-app note, once the staff inbox exists.
  3. WhatsApp.
  *Example:* should Lina receive "your clock-out on 5 October was changed to 18:00"?

- **CA-Q15 — Screen.** **PENDING**
  1. *(recommended)* API only. The correction form ships with the attendance board (PR 27, which depends on 26), as
     RE-Q11 did for exceptions.
  2. A small form in this PR.

- **CA-Q16 — Correcting again.** **PENDING**
  1. *(recommended)* A session may be corrected any number of times. Every correction adds history rows, and nothing
     is erased.
  2. Only once.
  *Example:* the manager typed 18:00 instead of 16:00 and fixes it again.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A manager fixes a forgotten clock-out (Priority: P1)

Lina forgot to clock out. At 16 h the system closed her session as MISSED_OUT at 02:00 the next morning. The
branch manager knows she left at 18:00. The manager sets the clock-out to 18:00 with the reason "left at 18:00,
confirmed by reception". The session now shows 18:00. The history keeps 02:00, the new 18:00, who changed it,
when and why.

**Why this priority**: D-32's core promise: missed punches are fixed by a manager, never silently.

**Independent Test**: Close a session MISSED_OUT, correct its clock-out with a reason, then read back the session,
one correction row and one audit entry.

**Acceptance Scenarios**:

1. **Given** a MISSED_OUT session in branch A, **When** the branch manager of A corrects `clock_out` with a reason,
   **Then** `clock_out` is the new time, the status follows CA-Q7, one `attendance_corrections` row holds the field,
   before, after, reason, actor and time, and one audit entry holds before and after.
2. **Given** the same request is sent twice with the same `Idempotency-Key`, **Then** the second answer replays the
   first and writes nothing.

---

### User Story 2 - A manager fixes a wrong clock-in (Priority: P2, subject to CA-Q4)

Huda's phone was dead. She scanned at 10:40 but arrived at 10:05. The manager corrects the clock-in with a reason.
Lateness is handled per CA-Q10.

**Independent Test**: Correct `clock_in` on a CLOSED session. The correction row exists and `late_minutes` follows
CA-Q10.

**Acceptance Scenarios**:

1. **Given** a CLOSED session with `late_minutes` 40 and a shift start of 10:00, **When** clock-in is corrected to
   10:05, **Then** per CA-Q10 option 1 `late_minutes` is 0, and the correction history has a clock-in row (plus a
   lateness entry in the audit `before`/`after`).
2. **Given** both times are corrected in one request, **Then** one correction row exists per changed field, and they
   share the reason, actor and time.

---

### Edge Cases

- A reason that is empty, only spaces, or over 500 characters → `VALIDATION_FAILED` (400), the same bounds as spec
  034.
- A new time equal to the current one → `VALIDATION_FAILED`. A correction must change something.
- A stale `revision` (someone else corrected the session, or a scan or the job closed it, in between) →
  `ATTENDANCE_SESSION_REVISION_CONFLICT` (409). Nothing changes. With two concurrent corrections, exactly one wins.
- An OPEN session → `ATTENDANCE_SESSION_OPEN` (409), unless CA-Q5 chooses option 2.
- Clock-out before clock-in, a future time, over 16 h, or an overlap with another session of the same employee →
  `ATTENDANCE_CORRECTION_INVALID_TIMES` (422), as far as CA-Q8 decides.
- A clock-in moved to another working date → refused per CA-Q11 option 1
  (`ATTENDANCE_CORRECTION_WORKING_DATE`, 422).
- Correcting your own session → `ATTENDANCE_CORRECTION_SELF_FORBIDDEN` (403), per CA-Q2.
- A caller without the permission on the session's branch, or a session of another business or company →
  `NOT_FOUND`. The response never confirms that the session exists.
- The paired device or a personal staff session → `FORBIDDEN`.
- An employee scans within 5 minutes after a correction to her latest session. The 5-minute repeat-scan rule replays
  her stored last scan result unchanged. That is harmless: the stored result is the scan's own answer, not the
  session.
- A card-closed session (`out_operator_id` set) is corrected like any other. The operator and device fields are
  scan facts and stay unchanged.
- Location fields (`geo`, coordinates, accuracy) are facts of the scan and never change.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A holder of the correction permission (CA-Q1) on the session's branch MUST be able to correct the
  allowed time fields (CA-Q4) of an eligible session (CA-Q5, CA-Q7). A reason of 1–500 trimmed characters is
  required.
- **FR-002**: Every correction MUST keep the previous value. It writes one `AttendanceCorrection` row per changed
  field (SPEC §4) and one audit entry with before and after, in the same transaction as the change (D-12, D-32).
- **FR-003**: A correction MUST NOT create hours, pay, deductions or any commission input (D-32, SPEC §7 A7).
- **FR-004**: The system MUST refuse corrections that break the CA-Q8 limits, the CA-Q11 working-date rule, the CA-Q2
  self rule, the branch scope, or a stale `revision`.
- **FR-005**: The lateness of a corrected clock-in MUST follow CA-Q10.
- **FR-006**: A correction MUST NOT change the session's exceptions, unless CA-Q12 decides otherwise.
- **FR-007**: The action MUST require `Idempotency-Key`. Replaying the same key and body returns the stored answer and
  writes nothing; the same key with another body is refused.
- **FR-008**: No message is sent to the employee, unless CA-Q14 decides otherwise.

### Key Entities

- **Attendance session** (exists): gains a `revision` that increases on every change, including scan and job
  closures.
- **Attendance correction** (new, SPEC §4): one append-only row per changed field. It holds the session, the field
  (`CLOCK_IN` | `CLOCK_OUT`), the before value, the after value, the reason, the actor and the time. It is never
  updated or deleted.
- **Audit entry** (exists): one per correction request.

## Slice design *(mandatory — `CLAUDE.md` §1)*

### Business rules

- **BR-001**: The only decision function is a pure domain function, `planAttendanceCorrection(session, change,
  context)`. It validates the fields (CA-Q4), the state (CA-Q5, CA-Q7), the limits (CA-Q8, using the neighbouring
  sessions passed in), the working date (CA-Q11, using `attendanceWorkingDate`) and the self rule (CA-Q2). It returns
  the new session values plus the correction rows, or a named refusal. Lateness reuses `attendanceLateMinutes` with
  the stored `scheduled_start` (CA-Q10).
- **BR-002**: Lock order follows ADR-0028: the employee's `AttendanceState` first, then identity's company and ordered
  membership locks (the PR 25 access pattern), then the session row. The injected Clock is sampled once, after the
  locks. This serialises a correction with scans and the missed-out job.
- **BR-003**: `revision` on `attendance_sessions` increases with every write: the scan close, the card close, the job
  close and the correction. A request carries the revision it saw.
- **BR-004**: Authority is checked on the session's `branch_id` (the clock-in branch).
- **BR-005**: The scan facts never change: source, binding, QR window, location, device, operator.

### Schema changes

| Table | Columns added / changed | RLS policy | Indexes | Tenant-qualified FKs |
|---|---|---|---|---|
| `attendance_sessions` | add `revision integer NOT NULL DEFAULT 0` (+ CHECK ≥ 0). If CA-Q5 option 2 or CA-Q7 option 2 is chosen: widen the `closed_by` / `status` CHECKs | unchanged | none new | unchanged |
| `attendance_corrections` (new) | `company_id`, `id` (UUID v7), `business_id`, `branch_id`, `employee_id`, `session_id`, `field` CHECK IN ('CLOCK_IN','CLOCK_OUT'), `before_at timestamptz`, `after_at timestamptz NOT NULL`, `reason` (trimmed, 1–500), `corrected_by` → user, `corrected_at`, `request_id` (groups the rows of one request) | ENABLE + FORCE; tenant policy; `pospay_app` SELECT + INSERT only (append-only) | PK `(company_id, id)`; `(company_id, session_id, corrected_at)`; `(company_id, business_id, branch_id, corrected_at)` for the PR 27 board; `(company_id, employee_id, corrected_at)`; `(company_id, corrected_by)` | `(company_id, session_id)` → sessions; `(company_id, business_id, employee_id)` → employees; `(company_id, business_id, branch_id)` → branches |
| `permissions`, `role_permissions` | per CA-Q1: insert `correct:attendance:branch` with its default holders | — | — | — |

- One expand migration, numbered at merge time (after PR 25's 0088). The new table, its RLS and grants, the session
  column, and the permission rows. Nothing is dropped.
- The grant allowlist in `packages/db/src/__tests__/privileges.spec.ts` gains `attendance_corrections`.

### API contract

- **Correct**: `POST /v1/businesses/:businessId/attendance-sessions/:sessionId/correct`, with `@Authenticated()` plus
  the use-case permission check (PR 25 pattern). Feature flag: none (as clock attendance).
- **Request**: `{ revision: int ≥ 0, clock_in?: ISO instant, clock_out?: ISO instant, reason: string 1–500 trimmed }`.
  At least one time is required. The Zod schema lives in `packages/contracts/src/staff/attendance-correction.ts`, with
  its OpenAPI file.
- **Response (200)**: `{ session: { id, employee_id, branch_id, working_date, clock_in, clock_out, status, closed_by,
  late_minutes, revision }, corrections: [{ id, field, before, after, reason, corrected_by, corrected_at }] }`.
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

- Per CA-Q1. The recommended option adds `correct:attendance:branch` to the access catalog, `ROLE_DEFAULTS`
  (`[...managers, 'branch_manager']`), `deviceForbidden`, `system-role-policy` and the `packages/i18n` permission names.

### Events

- **Published**: none. Nothing consumes attendance (`module-map.md:151`), and an event without a consumer would be an
  undeclared arrow (the same reasoning as spec 034 RE-Q7).
- **Consumed**: none.

### Test plan

- **Domain unit**:
  - every field × state combination
  - limits at their boundaries: equal times, exactly 16 h, a touching neighbour vs an overlapping one, now vs the future
  - working date across a Kuwait midnight
  - lateness at 10 and 11 minutes and with no schedule
  - self rule, reason bounds, revision mismatch
- **Integration** (`CA-01`…):
  - `CA-01` correct the clock-out of a MISSED_OUT session
  - `CA-02` correct the clock-in of a CLOSED session, lateness recomputed
  - `CA-03` both fields in one request: two rows, one audit entry
  - `CA-04` OPEN session refused
  - `CA-05` own session refused, the owner too
  - `CA-06` another branch → NOT_FOUND
  - `CA-07` device and personal session refused
  - `CA-08` stale revision → 409; two concurrent corrections, exactly one wins
  - `CA-09` a correction racing a scan close on the same employee is serialised by the State lock
  - `CA-10` idempotent replay and key reuse with another body
  - `CA-11` exceptions, geo and scan facts unchanged
  - `CA-12` overlap, 16 h and future refused
  - `CA-13` cross-midnight clock-in refused
  - `CA-14` a scan close and a job close increment `revision`
- **RLS negative**: `attendance_corrections` cross-tenant SELECT = 0 and INSERT refused, with no UPDATE or DELETE
  privilege; a session of company B is `NOT_FOUND` for company A.
- **Queries**: none in this PR (the board and correction history ship with PR 27).

### Documents to update in the same PR

- `docs/module-map.md:161`: per CA-Q13, either remove "attendance PR 26 will read approved intervals" or declare the
  leave read port.
- `docs/specs/029-staff-missed-out-job/spec.md:118` (MO-Q6): point to this spec.

### Files expected to be shared with PR 25 (spec 034)

PR 25 merges first; PR 26 rebases on it.

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
  correction permission.

Nothing in PR 26 can merge until PR 25 is on `main`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A manager fixes a wrong or missing clock time in one action. For 100 % of corrections the owner can see
  the old value, the new value, who changed it, when and why.
- **SC-002**: No correction ever changes commission, pay, or any scan fact (location, device, operator).
- **SC-003**: When two managers correct the same session at the same moment, exactly one change is recorded.
- **SC-004**: After corrections, no employee has two sessions covering the same minute (CA-Q8).

## Assumptions

- There is no production data. Existing sessions get `revision` 0.
- The board, the correction history list and the form arrive with PR 27 (CA-Q15). Until then the API is exercised by
  tests only.
- Times are sent as UTC instants. The future screen converts from the branch timezone.
- "Linked to the actor's own user" uses `employees.user_id`, as in spec 034.
- PRD P1-T10.4 (approval blocked by open attendance exceptions) stays dropped (spec 034 RE-Q5). SPEC §6 "blocked
  correction" concerns commission periods, not attendance.
