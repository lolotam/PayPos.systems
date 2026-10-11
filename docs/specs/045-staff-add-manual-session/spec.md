# Feature Specification: Add a manual attendance session (applied on owner approval)

**Feature Branch**: `feat/p1-26b-add-manual-session`

**Created**: 2026-10-10

**Status**: Draft — owner questions **ANSWERED** (Waleed, 2026-10-10, the recommended option on all) in the shared file
[044 owner-questions.ar.md](../044-staff-attendance-change-requests/owner-questions.ar.md) (ACR-Q10, ACR-Q11,
ACR-Q13…ACR-Q18, ACR-Q22). Implemented after 26a merges.

**Input**: User description: "`add-manual-session` (source MANUAL, reason, actor recorded — spec 035 CA-Q6) — applied
only after owner approval through 26a."

**Phase 1 row**: 26b (`docs/specs/phase-1/IMPLEMENTATION-PLAN.md:74`, depends on 26 and 26a). Runs in parallel with
26c ([spec 046](../046-staff-void-attendance-session/spec.md)) after 26a ([spec 044](../044-staff-attendance-change-requests/spec.md))
merges.

**What the documents already decide**

- CA-Q6 (2026-10-08) and its 2026-10-09 update: a manager may add a missing day, recorded under her name, **only
  after the owner approves** (spec 044).
- `MANUAL` is a planned attendance source (`docs/PRD.md:215`; spec 035 "Room for 26b and 26c").
- `working_date` is the clock-in date in the branch timezone (SPEC §7). Lateness is the AT-Q7 rule (0 up to 10
  minutes, otherwise all whole minutes; ADR-0028).
- Attendance never touches commission (SPEC §7, A7).
- Spec 035 left room: `attendance_corrections` does not assume the source is QR/BARCODE, and "26b decides its own
  `scheduled_start` snapshot rule".

## Owner questions

All in [044 owner-questions.ar.md](../044-staff-attendance-change-requests/owner-questions.ar.md). Waleed decided all on
2026-10-10 (the recommended option each time); the decisions are:

- **ACR-Q14** — what a manual day holds. clock-in + clock-out (both required), branch, reason; no breaks.
- **ACR-Q15** — time limits. CA-Q8 exactly: out > in, nothing in the future, ≤ 16 h, no overlap with another
  session of the employee (OPEN included).
- **ACR-Q16** — branch and contract. the branch must be attached to the employee on that working date, and the date
  inside her contract (AT-Q4 rule).
- **ACR-Q17** — lateness. recomputed from the employee's scheduled shift with the AT-Q7 rule.
- **ACR-Q18** — reports. counts like any day, labelled "manual" with requester and approver (PR 27 shows it).
- **ACR-Q10** — later correction. a MANUAL session is **not** correctable through PR 26; a wrong manual day is voided
  (26c) and requested again.
- **ACR-Q11** — PENDING ADD requests of one employee may not overlap each other.
- **ACR-Q13** — at approval every rule is re-checked; a failure leaves the request PENDING.
- **ACR-Q22** — any past date (no limit), leave not read, device refused, no commission effect.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Reem's forgotten Thursday (Priority: P1)

Reem worked Thursday 10:00–19:00 at Salmiya and never scanned. The Salmiya branch manager files an `ADD_SESSION`
request with those times and the reason "worked all day, confirmed by the cashier". The owner approves. A CLOSED
session now exists with source MANUAL, linked to the request, carrying who asked and who approved.

**Why this priority**: the reason the row exists.

**Independent Test**: file an ADD request, approve it (spec 044), then read one MANUAL session, the request APPROVED
with `session_id` set, and the audit entries.

**Acceptance Scenarios**:

1. **Given** a holder of the request permission on Salmiya and Reem attached to Salmiya that Thursday, **When** she
   files `{kind: 'ADD_SESSION', employee_id, branch_id, clock_in, clock_out, reason}`, **Then** the request is PENDING
   and **no** session exists yet.
2. **Given** that PENDING request, **When** the owner approves it, **Then** one session is inserted with `source
   'MANUAL'`, `status 'CLOSED'`, `closed_by 'MANUAL'`, the requested times, `working_date` from the clock-in in the
   branch timezone, `geo 'NONE'`, no device/binding/location, `late_minutes` per ACR-Q17, `revision 0`, and
   `change_request_id` = the request; the request becomes APPROVED with `session_id` = the new session; one audit
   entry `attendance_session.added_manual` (plus 044's `attendance_change.approved`).
3. **Given** the owner herself files the same request, **Then** it is approved in one step and the session exists at
   once (044 ACR-Q2).

---

### User Story 2 - Impossible days are refused (Priority: P1)

The manager types 19:00–10:00, or a day in the future, or 18 hours, or hours that overlap a real scan; or a branch
Reem is not attached to. The request is refused when filed; and if the world changes before approval (Reem's real
scan appears), the approval is refused.

**Acceptance Scenarios**:

1. **Given** times that break ACR-Q15, **When** filed, **Then** `ATTENDANCE_MANUAL_INVALID_TIMES` (422).
2. **Given** a branch not attached on that date or a date outside the contract, **Then**
   `ATTENDANCE_MANUAL_NOT_ELIGIBLE` (422) (ACR-Q16, decided 2026-10-10).
3. **Given** a PENDING request, **When** a real scan or another approved manual day now overlaps it and the owner
   approves, **Then** `ATTENDANCE_MANUAL_INVALID_TIMES` (422) and the request stays PENDING (ACR-Q13, decided 2026-10-10).
4. **Given** a PENDING ADD request for Reem 10:00–19:00, **When** another ADD request for 18:00–20:00 is filed, **Then**
   `ATTENDANCE_CHANGE_DUPLICATE_PENDING` (409) (ACR-Q11, decided 2026-10-10).

---

### User Story 3 - A manual day is not quietly stretched (Priority: P2)

After approval, a manager tries to move the manual day's clock-out from 19:00 to 23:00 with the ordinary correction.
She is refused; she must ask for a void and a new day, both approved by the owner (ACR-Q10, decided 2026-10-10).

**Acceptance Scenarios**:

1. **Given** a MANUAL session, **When** `correct-attendance` is called on it, **Then**
   `ATTENDANCE_CORRECTION_MANUAL_SESSION` (409) and nothing changes.

---

### Edge Cases

- Overnight: clock-in 22:00 Thursday, clock-out 02:00 Friday → `working_date` Thursday (SPEC §7).
- A day without a scheduled shift → `scheduled_start`/`scheduled_end` NULL and `late_minutes` 0 (AT-Q7, CA-Q10 note).
- Touching ends with another session (out = next in) are not an overlap (CA-Q8).
- A request on an approved-leave day is accepted; leave is not read (ACR-Q22b, decided 2026-10-10).
- A very old date is accepted (ACR-Q22a, decided 2026-10-10).
- The employee scans now while a manual day for the past exists: unaffected (the scan reads only the OPEN session).
- The missed-out job and the not-clocked-in job read only OPEN sessions / clock-ins near a shift start: a manual
  session never schedules a missed-out run and publishes no clock event.
- Voided sessions (26c) are ignored by the overlap check once 26c lands.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The `ADD_SESSION` kind MUST carry employee, branch, clock-in, clock-out and the request reason
  (ACR-Q14, decided 2026-10-10).
- **FR-002**: The kind's rules (times ACR-Q15, eligibility ACR-Q16) MUST be checked when filed and again at approval
  under the employee's `AttendanceState` lock (044 BR-003).
- **FR-003**: Approval MUST insert exactly one CLOSED session with source MANUAL, linked to the request, in the
  approval's transaction; filing MUST insert none.
- **FR-004**: A manual session MUST record its lateness per ACR-Q17 and keep its scheduled start/end snapshot.
- **FR-005**: A manual session MUST NOT carry scan facts (device, operator, binding, QR window, location).
- **FR-006**: A manual session MUST NOT be changed by the ordinary correction (ACR-Q10, decided 2026-10-10).
- **FR-007**: A manual session MUST NOT create hours, pay, deductions or commission input (SPEC A7).

### Key Entities

- **Attendance session** (exists): source gains `MANUAL`; `closed_by` gains `MANUAL`; new `change_request_id`
  (the approved request).
- **Attendance change request** (spec 044): gains the ADD values `clock_in`, `clock_out`, `working_date`, `timezone`.

## Slice design *(mandatory — `CLAUDE.md` §1)*

### Business rules

- **BR-001**: One pure function `planManualSession(input, context)` in `domain/manual-attendance-session.ts`. Inputs:
  the requested employee/branch/times, and a context of `now`, the branch timezone, the employee's eligibility facts
  (hire date, contract end, branch attachments), the scheduled shifts of that branch around the clock-in, and the
  neighbouring sessions (OPEN included, voided excluded). It returns the session values (working date, lateness,
  scheduled start/end) or a named refusal. It reuses — **imports only, no edit** — `attendanceWorkingDate`,
  `attendanceEligible`, `attendanceSchedule`, `attendanceLateMinutes` from `domain/clock-attendance.ts`, and the
  overlap/limit rule of `domain/attendance-correction.ts` (extracted there as an exported helper if needed).
- **BR-002**: The planner is registered as the `ADD_SESSION` kind in 044's kinds port: `check` at file and approval
  time, `apply` inserts the session and sets `attendance_change_requests.session_id`.
- **BR-003**: The schedule and eligibility reads live in a **new** adapter
  `persistence/manual-session-context.adapter.ts`; `persistence/attendance-context.adapter.ts` is not edited (lane
  16b-2 owns it). The small schedule query is duplicated deliberately; a follow-up may extract it after 16b-2 merges.
- **BR-004**: `planAttendanceCorrection` refuses a MANUAL session with `ATTENDANCE_CORRECTION_MANUAL_SESSION`
  (ACR-Q10, decided 2026-10-10).

### Schema changes

One expand migration (plan from 0111, numbered at merge after 26a's).

| Table | Columns added / changed | RLS | Indexes | Tenant-qualified FKs |
|---|---|---|---|---|
| `attendance_sessions` | `source` CHECK → IN ('QR','BARCODE','MANUAL'); `close_pair` CHECK accepts `closed_by` 'MANUAL'; add `change_request_id uuid NULL`; CHECK `(source = 'MANUAL') = (change_request_id IS NOT NULL)`; CHECK MANUAL ⇒ status 'CLOSED', closed_by 'MANUAL', no binding/device/operator/location, `geo = 'NONE'` (CHECKs added `NOT VALID` then validated, ADR-0033 style) | unchanged | `(company_id, change_request_id)` (FK index, built `CONCURRENTLY`) | `(company_id, change_request_id)` → `attendance_change_requests` |
| `attendance_change_requests` | add `clock_in timestamptz`, `clock_out timestamptz`, `working_date date`, `timezone text`; CHECK `kind <> 'ADD_SESSION' OR (all four NOT NULL AND clock_out > clock_in AND session_revision IS NULL)`; `pospay_app` gains no new UPDATE column | unchanged | `(company_id, employee_id, status) WHERE kind='ADD_SESSION'` for the pending-overlap check | — |

- `pospay_app` INSERT on `attendance_sessions` is unchanged (it already inserts sessions).
- The grant allowlist in `privileges.spec.ts` is unchanged except for any new column grant.

### API contract

- No new endpoint. The `ADD_SESSION` member joins 044's discriminated union in
  `packages/contracts/src/staff/attendance-change-request.ts`: `{ kind: 'ADD_SESSION', employee_id, branch_id,
  clock_in: ISO instant, clock_out: ISO instant, reason }`. The list/response `requested` field carries
  `{ branch_id, clock_in, clock_out, working_date }`; the decide response carries the created session.
- **Errors (new)**: `ATTENDANCE_MANUAL_INVALID_TIMES` 422 · `ATTENDANCE_MANUAL_NOT_ELIGIBLE` 422 · `ATTENDANCE_MANUAL_TIMEZONE_CHANGED` 409 (branch time zone changed after filing — reject and file again) ·
  `ATTENDANCE_CORRECTION_MANUAL_SESSION` 409 (on PR 26's endpoint), each with `message_ar` / `message_en`.

### Permissions

- None new; 044's request and decide permissions apply.

### Events

- **Published**: none. A manual session is already closed, so the worker's missed-out scheduling
  (`AttendanceClockedIn`) has nothing to do, and attendance has no business consumer. 044's
  `AttendanceChangeDecided` carries the approval notice.
- **Consumed**: none.

### Test plan

- **Domain unit** (`manual-attendance-session.spec.ts`): out ≤ in, future by 1 ms, exactly 16 h vs 16 h + 1 ms,
  touching vs overlapping neighbour, overlap with OPEN, voided neighbour ignored; overnight working date across a
  Kuwait midnight; eligibility (not attached, attachment ended exclusive, contract ended inclusive, before hire);
  lateness at 10/11 minutes, no schedule → 0; correction refusal of MANUAL in `attendance-correction.spec.ts`.
- **Integration** (`AMS-01`…): `AMS-01` file → PENDING, no session · `AMS-02` approve → one MANUAL session + links +
  audit · `AMS-03` owner one-step · `AMS-04` invalid times / not eligible refused at file · `AMS-05` real scan
  overlapping before approval → approval refused, request PENDING · `AMS-06` overlapping PENDING ADDs refused ·
  `AMS-07` correction of a MANUAL session refused · `AMS-08` approve vs a concurrent scan of the same employee is
  serialised by the State lock · `AMS-09` the inserted session has no scan facts and `geo 'NONE'`.
- **RLS negative**: unchanged tables' policies; a `change_request_id` of company B cannot be referenced by company A
  (tenant-qualified FK).
- **Queries**: none new (044's list shows the requested values; PR 27's board shows the MANUAL badge).

### Files this slice touches (26b)

- New: `apps/api/src/modules/staff/domain/manual-attendance-session.ts` (+ `__tests__`),
  `persistence/manual-session-context.adapter.ts`, `persistence/manual-session-writes.ts`,
  `persistence/add-session-kind.ts` (kind registration), migration `01xx_…_manual-attendance-session.sql`.
- Edited: `packages/db/schema/staff-attendance.ts` (source/closed_by CHECKs, `change_request_id`),
  `packages/db/schema/staff-attendance-change-requests.ts` (ADD columns), `staff/domain/attendance-correction.ts`
  (MANUAL refusal), `staff/persistence/attendance-correction-records.ts` (select `source`), `staff.module.ts`,
  `packages/contracts/src/staff/attendance-change-request{,-openapi}.ts`, `apps/api/src/shared/errors.ts`,
  `packages/i18n/src/{ar,en}.ts`, `openapi/openapi.json`, `apps/{admin,pos}/src/shared/api/schema.d.ts`,
  `docs/module-map.md` (new synchronous line `staff -> tenancy.attendanceBranch @ …/manual-session-context.adapter.ts`).
- **Read-only imports, not edited**: `staff/domain/clock-attendance.ts`. **Not touched**:
  `staff/persistence/attendance-context.adapter.ts`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An employee's forgotten day appears in attendance only after the owner approves, in one approval.
- **SC-002**: 100 % of manual days show who asked, who approved, when and why.
- **SC-003**: After manual days are added, no employee has two sessions covering the same minute.
- **SC-004**: No manual day ever changes commission or carries a fake location or device.

## Assumptions

- No production data.
- Times arrive as UTC instants; the future form (PR 27) converts from the branch timezone.
- The branch timezone used is the effective one (branch, else business) through the tenancy read already used by
  attendance (spec 027).
