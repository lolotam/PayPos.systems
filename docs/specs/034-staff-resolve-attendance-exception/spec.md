# Feature Specification: Resolve an attendance exception

**Feature Branch**: `feat/p1-25-resolve-attendance-exception`

**Created**: 2026-10-08

**Status**: Draft — owner questions decided 2026-10-08.

**Input**: User description: "staff-resolve-attendance-exception — Phase 1 PR 25."

**Phase 1 row**: PR 25 (`docs/specs/phase-1/IMPLEMENTATION-PLAN.md`). Builds on spec 027 (clock attendance),
029 (missed-out job) and 032 (clock by card).

## Owner questions

All twelve were settled on 2026-10-08. Numbering follows the PR 25 research.

- **RE-Q1 — Which kinds a manager resolves by hand.** `OUT_OF_RANGE` and `NONE` only (Waleed).
  `SUSPECTED_MISSED_OUT` stays system-resolved: closed late by the next scan, or `MISSED_OUT` at 16 h (specs 027, 029).
- **RE-Q2 — Reason.** Mandatory on every resolution (Waleed; PRD D-12).
- **RE-Q3 — Who resolves.** The managers: owner, general manager, business manager and branch manager — the same
  default holders as `decide:leave:branch` (Waleed). The paired device is refused. Nobody resolves an exception on
  their own attendance.
- **RE-Q4 — Card scans.** A clock-by-card movement raises **no** attendance exception (Waleed). The card is scanned on
  the shop's paired device, so the employee's presence is known; an exception there is a false alarm on every
  movement. QR / phone clocking keeps raising `NONE` and `OUT_OF_RANGE` exactly as today. This changes the exception
  side of spec 032's CB-Q1 (2026-10-07); the session's location field still records `NONE` for a card movement, so
  the attendance report stays truthful. Waleed first chose bulk acknowledgement, then changed to this after a worked
  explanation of the false-alarm volume (about 20 a day for 10 employees).
- **RE-Q5 — Commission approval gate.** Confirmed dropped (Waleed): commission-statement approval does **not** wait for
  attendance exceptions to be resolved (SPEC §1 and §6 override PRD P1-T10.4).
- **RE-Q6 — Reopen.** A resolved exception **can** be reopened (Waleed, against the recommendation of "final"). The same
  managers may reopen it, a reason is mandatory, and the earlier resolution and its reason are never erased — the
  owner sees the whole history.
- **RE-Q7 — History.** Every resolve and reopen writes an audit entry with before and after. No outbox event in this
  PR: nothing consumes one until alert rules ship (PR 28 / PR 62, module-map row 173), and an event without a consumer
  would be an undeclared arrow. Backfilling audit for scan-raised exceptions and system resolutions is a follow-up.
- **RE-Q8 — Two managers at once.** Only one change wins; the other gets a conflict and changes nothing.
- **RE-Q9 — Fixing the times of a `MISSED_OUT` session.** PR 26 (`correct-attendance`), not here.
- **RE-Q10 — Branch scope.** A manager is authorised on the exception's own branch (the branch of the scan that
  raised it, which can differ from the session's branch on a cross-branch close).
- **RE-Q11 — Screen.** API only in this PR (Waleed); the list and the manager's screen ship with the attendance board
  (PR 27).
- **RE-Q12 — Tell the employee.** No message to the employee on resolve or reopen (Waleed).

RE-Q7 to RE-Q10 are technical defaults the orchestrator chose and reported to Waleed; the others are his decisions.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A manager closes a location warning with a reason (Priority: P1)

Sara clocks in from her phone 5 km from the salon. The system flags her movement "out of range". The branch manager
checks with her (she was on an errand for the shop), and closes the warning with the reason "errand for the shop".
The warning is now closed, and who closed it, when and why is recorded for the owner.

**Why this priority**: This is the use case. Without it every location warning stays open forever.

**Independent Test**: Raise an `OUT_OF_RANGE` exception by a QR clock-in, resolve it as a branch manager with a
reason, and read back the closed record and its audit entry.

**Acceptance Scenarios**:

1. **Given** an open `OUT_OF_RANGE` exception in branch A, **When** the branch manager of branch A resolves it with a
   reason, **Then** it is `RESOLVED` with resolution `ACKNOWLEDGED`, the manager as resolver, the reason, the time,
   and one audit entry holding before and after.
2. **Given** an open `NONE` exception (phone sent no location), **When** a business manager resolves it with a
   reason, **Then** the same happens.
3. **Given** the same request is sent twice with the same `Idempotency-Key`, **Then** the second answer replays the
   first and writes nothing.

---

### User Story 2 - A manager reopens a warning closed by mistake (Priority: P2)

The manager closed Heba's "no location" warning, then learns she was not at work at all. The manager reopens it with
the reason "closed by mistake — she was absent". It is open again; the first closing and its reason stay in the
history.

**Why this priority**: The owner chose reopening (RE-Q6). It corrects a wrong closure without losing what happened.

**Independent Test**: Resolve, then reopen with a reason; the exception is `OPEN` and the audit trail holds both
changes in order.

**Acceptance Scenarios**:

1. **Given** a resolved `NONE` exception, **When** a manager reopens it with a reason, **Then** it is `OPEN`, its
   resolution fields are empty, and a second audit entry records the reopen with before (the old resolution and
   reason) and after.
2. **Given** a reopened exception, **When** a manager resolves it again, **Then** it is `RESOLVED` and a third audit
   entry exists; all three are readable in order.

---

### User Story 3 - Card scans stop raising false warnings (Priority: P1)

Sawsan clocks in and out with her card on the reception tablet. No warning is raised for either movement. Her
session still records that no phone location was taken.

**Why this priority**: Without it, every card movement creates a warning nobody can act on (RE-Q4), and the manager
learns to ignore warnings — including real ones.

**Independent Test**: Clock in and out by card; zero exceptions exist for the session, the session's location fields
are `NONE`, and the scan result lists no exceptions.

**Acceptance Scenarios**:

1. **Given** a card clock-in, **Then** no exception row is written, the session's `geo` is `NONE`, and the result's
   `exceptions` is empty.
2. **Given** a card clock-out of a session opened by QR, **Then** no exception is written for the clock-out; any
   exception from the QR clock-in is untouched.
3. **Given** a QR clock-in with no location, **Then** a `NONE` exception is still raised (unchanged).

---

### Edge Cases

- Resolving a `SUSPECTED_MISSED_OUT` exception → refused (`ATTENDANCE_EXCEPTION_NOT_MANUAL`, 409); nothing changes. Reopening one
  is refused the same way.
- Resolving an exception that is already resolved, or reopening one that is open → `ATTENDANCE_EXCEPTION_REVISION_CONFLICT` (409).
- The request carries a `revision` that is no longer current (someone else changed it in between) →
  `ATTENDANCE_EXCEPTION_REVISION_CONFLICT` (409); nothing changes. Two managers at the same moment: exactly one wins.
- A manager resolving or reopening an exception on **their own** attendance → `ATTENDANCE_EXCEPTION_SELF_FORBIDDEN` (403), even the owner
  (pattern of `LEAVE_SELF_DECISION_FORBIDDEN`).
- A branch manager of branch B acting on an exception raised in branch A → `FORBIDDEN`.
- The paired device (staff session on the reception tablet) → `FORBIDDEN`; the permission is device-forbidden.
- An exception id from another business of the same company, or another company → `NOT_FOUND` (404); the response
  never confirms that it exists.
- Reason empty, only spaces, or longer than 500 characters → `VALIDATION_FAILED` (422).
- Resolving does not change the session's times, status, hours or anything commission reads (SPEC A7). Times are PR 26.
- Exceptions already raised by card scans before this release (staging only; there is no production yet) are closed by
  the migration as system resolutions (see BR-007).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A holder of `resolve:attendance:branch` on the exception's branch MUST be able to resolve an open
  `OUT_OF_RANGE` or `NONE` exception with a reason of 1–500 characters (trimmed).
- **FR-002**: The same holder MUST be able to reopen a resolved `OUT_OF_RANGE` or `NONE` exception with a reason of
  1–500 characters (trimmed).
- **FR-003**: The system MUST refuse both actions on `SUSPECTED_MISSED_OUT`, on the actor's own attendance, from the
  paired device, outside the actor's branch scope, and on a stale `revision`.
- **FR-004**: Every resolve and reopen MUST write exactly one audit entry with before and after, in the same
  transaction as the change. The audit trail is the exception's permanent history.
- **FR-005**: Resolving or reopening MUST NOT change the session, its times, hours, lateness or any commission input.
- **FR-006**: A clock-by-card movement MUST NOT raise an attendance exception; QR clocking is unchanged.
- **FR-007**: Both actions MUST require `Idempotency-Key`; a replay with the same key and body returns the stored
  answer and writes nothing; the same key with a different body is refused.
- **FR-008**: No message is sent to the employee (RE-Q12).

### Key Entities

- **Attendance exception** (exists): a warning on one movement of one session — kind, status `OPEN` / `RESOLVED`,
  resolution, who resolved, when, reason. Gains a `revision` that increases on every change.
- **Audit entry** (exists): one per resolve or reopen, holding before and after; never updated or deleted.

## Slice design *(mandatory — `CLAUDE.md` §1)*

### Business rules

- **BR-001**: Only `OUT_OF_RANGE` and `NONE` are resolved or reopened by hand (RE-Q1).
- **BR-002**: Resolve: `OPEN` → `RESOLVED`, resolution `ACKNOWLEDGED`, `resolved_by` = actor, `resolved_at` = now,
  `reason` = the trimmed reason, `revision` + 1.
- **BR-003**: Reopen: `RESOLVED` → `OPEN`; `resolution`, `resolved_by`, `resolved_at` and `reason` become empty;
  `revision` + 1. The earlier values live on in the audit entry's `before` (RE-Q6).
- **BR-004**: The actor may not act on an exception whose employee is linked to the actor's own user (RE-Q3).
- **BR-005**: Authority is checked on the exception's `branch_id` (RE-Q10).
- **BR-006**: A clock-by-card movement writes no exception row; the session still stores `geo` / `out_geo` = `NONE`,
  and the card scan result's `exceptions` is `[]` (RE-Q4).
- **BR-007**: The migration closes every `OPEN` `NONE` exception raised by a card movement as resolution `CARD_SCAN`,
  `resolved_by` NULL (system), `reason` NULL, `resolved_at` = the migration time. A card movement is a clock-in of a
  session with `source = 'BARCODE'`, or a clock-out with `out_operator_id` set — the implementation proves this
  identification with a test that QR movements are never matched.
- **BR-008**: All decisions are pure functions in `domain/` (transition, kind check, self-check); the use case only
  orchestrates.

### Schema changes

| Table | Columns added / changed | RLS policy | Indexes | Tenant-qualified FKs |
|---|---|---|---|---|
| `attendance_exceptions` | add `revision integer NOT NULL DEFAULT 0`; CHECK `resolution IN ('CLOSED_LATE','MISSED_OUT','ACKNOWLEDGED','CARD_SCAN')`; CHECK that `OPEN` ⇒ resolution, resolved_by, resolved_at and reason are all NULL, and `RESOLVED` ⇒ resolution and resolved_at are set; CHECK `reason` NULL or 1–500 trimmed characters | unchanged (existing tenant policy, FORCE RLS) | none new — updates go by primary key; `actor_idx` already covers `resolved_by` | unchanged |
| `permissions`, `role_permissions` | insert `resolve:attendance:branch`, default to owner, general manager, business manager, branch manager | unchanged | — | — |

- Migration: one expand migration (next free number at merge time) — the column, the CHECKs added `NOT VALID` and
  then validated, the card cleanup of BR-007 **before** validation, and the permission rows (pattern of 0075 / 0087).
  Nothing is dropped.
- `pospay_app` already has UPDATE on the table; the grant allowlist is unchanged.

### API contract

- **Resolve**: `POST /v1/businesses/:businessId/attendance-exceptions/:exceptionId/resolve` ·
  `@Authenticated()` plus the use-case permission check · feature flag: none (same as clock attendance).
- **Reopen**: `POST /v1/businesses/:businessId/attendance-exceptions/:exceptionId/reopen` · same guards.
- **Request** (both): `{ revision: int ≥ 0, reason: string 1–500 trimmed }` — Zod in
  `packages/contracts/src/staff/attendance-exception.ts`, with its OpenAPI file.
- **Response** (both, 200): `{ id, session_id, employee_id, branch_id, kind, status, resolution, resolved_by,
  resolved_at, reason, raised_at, revision }`.
- **Idempotency-Key**: required (leave-decision pattern).
- **Errors**: `NOT_FOUND` 404 · `FORBIDDEN` 403 · `ATTENDANCE_EXCEPTION_SELF_FORBIDDEN` 403 ·
  `ATTENDANCE_EXCEPTION_NOT_MANUAL` 409 · `ATTENDANCE_EXCEPTION_REVISION_CONFLICT` 409 (stale revision or wrong state) ·
  `VALIDATION_FAILED` 422 · `IDEMPOTENCY_KEY_REUSED` 422 · `NOT_READY` 503 — each with `message_ar` / `message_en`.
- **Card scan contract**: unchanged schema; `exceptions` is now always `[]` for a card movement.

### Permissions

- `resolve:attendance:branch` — new; covers resolve and reopen. Default holders: owner, general manager, business
  manager (`managers`) and branch manager, mirroring `decide:leave:branch`. Added to `deviceForbidden`, to the access
  catalog, the role defaults and `packages/i18n` permission names.

### Events

- **Published**: none (RE-Q7).
- **Consumed**: none.

### Test plan

- **Domain unit**: resolve and reopen transitions (every status × kind), the kind rule, the self rule, reason
  trimming / bounds, revision mismatch.
- **Integration scenarios**: `RAE-01` resolve `OUT_OF_RANGE` as branch manager · `RAE-02` resolve `NONE` as business
  manager · `RAE-03` reopen then resolve again, three audit entries in order · `RAE-04` `SUSPECTED_MISSED_OUT` refused ·
  `RAE-05` own attendance refused (owner too) · `RAE-06` other branch refused · `RAE-07` device refused · `RAE-08`
  stale revision and double resolve → 409 · `RAE-09` two concurrent resolves, exactly one wins · `RAE-10` idempotent
  replay and key reuse with another body · `RAE-11` session, times and late minutes unchanged · `RAE-12` card clock-in
  and clock-out write no exception, `geo` stays `NONE`, result `exceptions` is `[]` · `RAE-13` QR clock-in without
  location still raises `NONE` · `RAE-14` migration cleanup closes card-raised rows only.
- **RLS negative**: an exception of company B is `NOT_FOUND` for company A on both routes and is not changed;
  cross-business id → `NOT_FOUND`.
- **Queries**: none in this PR (the list ships with PR 27).

### Documents to update in the same PR

- `docs/specs/phase-1/SPEC.md` §7 (geofence line): "no location → `NONE` exception" applies to QR; a card movement
  raises none (RE-Q4).
- `docs/specs/032-staff-clock-by-card/spec.md` CB-Q1 and line 44: note that spec 034 RE-Q4 removed the exception and
  kept `NONE` on the session.
- `docs/adr/0010-phase-1-ports-and-events.md` line 46: geofence exceptions are raised without an event today; the
  event remains the missed-out job's (module-map row 173).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A manager closes a location warning with a reason in one action, and the owner can see who, when and why
  for 100 % of closures and reopenings.
- **SC-002**: Card clocking produces zero warnings; a business with 10 card-clocking employees goes from about 20
  warnings a day to none.
- **SC-003**: No resolve or reopen ever changes an employee's recorded hours, lateness or commission.
- **SC-004**: When two managers act on the same warning at the same moment, exactly one change is recorded.

## Assumptions

- The manager's list and screen arrive with PR 27; until then the API is exercised by tests only.
- There is no production data; card-raised exceptions exist only on staging and are closed by the migration.
- Resolution `ACKNOWLEDGED` is the only manual outcome; a manager who thinks the time is wrong uses PR 26.
- "Linked to the actor's own user" uses the existing `employees.user_id` link; an employee without a user link cannot
  be the actor.
