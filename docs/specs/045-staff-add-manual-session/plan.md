# Implementation Plan: Add a manual attendance session (applied on owner approval)

**Branch**: `feat/p1-26b-add-manual-session` (stacked on `feat/p1-26a-attendance-change-requests`, PR #148) |
**Date**: 2026-10-10 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `docs/specs/045-staff-add-manual-session/spec.md` (owner answers ACR-Q10, Q11,
Q13…Q18, Q22 — Waleed 2026-10-10, recorded in
[044 owner-questions.ar.md](../044-staff-attendance-change-requests/owner-questions.ar.md)).

## Summary

26a shipped the request → owner-approval mechanism with an **empty** kinds registry. This slice registers the
`ADD_SESSION` kind: a manager files `{ kind: 'ADD_SESSION', employee_id, branch_id, clock_in, clock_out, reason }`,
the kind's `check` runs the manual-day rules (CA-Q8 times, AT-Q4 eligibility, ACR-Q11 no overlapping pending ADD) at
filing and again under the employee's `AttendanceState` lock at approval, and its `apply` inserts one CLOSED
`MANUAL` session linked to the request inside the approval transaction. Lateness is the AT-Q7 rule against the
employee's scheduled shift at that branch. The ordinary correction (PR 26) refuses a MANUAL session (ACR-Q10).

## Technical Context

**Language/Version**: TypeScript 6 on Node 24 (ADR-0002; this machine runs 22.14 locally)

**Primary Dependencies**: NestJS (Fastify), Drizzle ORM + drizzle-kit, Zod, Vitest; no new dependency

**Storage**: PostgreSQL — `attendance_sessions` gains `MANUAL` source/closed_by and `change_request_id`;
`attendance_change_requests` gains `clock_in`, `clock_out`, `working_date`, `timezone`. Migrations **0114** (expand,
CHECKs `NOT VALID`) and **0115** (concurrent index + `VALIDATE`). No new table, no new grant, no new permission.

**Testing**: Vitest unit (domain); integration on the T2 compose Postgres, one cloned database per spec file
(ADR-0006); RLS negative for the new FK

**Target Platform**: `apps/api` only (no new endpoint, no worker change, no screen — PR 27 renders)

**Project Type**: modular monolith (web service)

**Performance Goals**: filing and approval stay a handful of indexed statements in one transaction (< 200 ms)

**Constraints**: no edit to `staff/domain/clock-attendance.ts` or `staff/persistence/attendance-context.adapter.ts`
(lane 16b-2) — import only; edits to the 26c-shared files (`domain/attendance-correction.ts`,
`persistence/attendance-correction-records.ts`, `packages/db/schema/staff-attendance.ts`) small and additive; shared
registries additive; migrations numbered 0114–0115 (lane 26c uses 0116+)

**Scale/Scope**: 2 domain files, 1 kind adapter, 1 context adapter, 1 writes file, 2 migrations, 3 error codes,
~5 test files

## Constitution Check

| Principle | Check | Result |
|---|---|---|
| I. One vertical slice | One use case: add a manual day through 26a's mechanism; no new endpoint | ✅ |
| II. Domain purity | `planManualSession` pure, imports `clock-attendance.ts` helpers read-only; no arithmetic in the kind adapter; `now` from 26a's injected clock; ids from the injected `IdGenerator` | ✅ |
| III. Tenant isolation | No new table; new FK tenant-qualified `(company_id, change_request_id)`; existing RLS covers both tables; negative FK test | ✅ |
| IV. Boundaries | `tenancy.attendanceBranch` through `tenancy/index.ts`; new synchronous adapter line in `docs/module-map.md`; no new arrow | ✅ |
| V. Tests | Domain unit + AMS-01…AMS-09 integration + RLS FK negative | ✅ |
| VI. Arabic-first | 3 error codes with `message_ar`/`message_en` via i18n | ✅ |
| VII. Documented why | Arabic JSDoc on `planManualSession`, the interval helper, every new port field | ✅ |

Post-design re-check: unchanged, ✅. One recorded deviation: a `DEFERRABLE INITIALLY DEFERRED` FK (research R1).

## Design notes

1. **Domain** — `staff/domain/manual-attendance-session.ts` (new, pure):
   - `planManualSession(input, context)` → `{ working_date, timezone, clock_in, clock_out, late_minutes,
     scheduled_start, scheduled_end }` or throws `AttendanceChangeError` with
     `ATTENDANCE_MANUAL_INVALID_TIMES` | `ATTENDANCE_MANUAL_NOT_ELIGIBLE` | `ATTENDANCE_CHANGE_DUPLICATE_PENDING`.
   - Context: `now`, branch `timezone`, employee `{ hire_date, contract_end, attachments }`, branch `shifts`
     (`{ startsAt, endsAt, workingDate }`), `neighbours` (sessions of the employee, OPEN included, voided excluded),
     `pending` (other PENDING ADD requests of the employee: `{ id, clock_in, clock_out }`), `selfRequestId` (the
     request being approved, excluded from `pending`).
   - Order (first refusal wins): times shape (out > in, ≤ 16 h, not in the future) → working date =
     `attendanceWorkingDate(clock_in, timezone)` → eligibility `attendanceEligible(employee, branch, date)` →
     overlap with neighbours → overlap with pending ADDs → schedule `attendanceSchedule(shifts, clock_in, date)` →
     `attendanceLateMinutes(shift?.startsAt ?? null, clock_in)`.
   - The CA-Q8 interval rule moves into a new pure helper `domain/attendance-interval.ts`
     (`attendanceIntervalRefused(start, end, now, neighbours, excludeId)`); `attendance-correction.ts`'s private
     `assertTimes` delegates to it (same behaviour, its existing tests stay green).
2. **Correction refusal** (ACR-Q10) — `AttendanceCorrectionSession` gains `source`; `planAttendanceCorrection`
   throws `ATTENDANCE_CORRECTION_MANUAL_SESSION` right after the self rule (before OPEN/revision/time checks);
   `lockedCorrectionSession` selects `source`. `closed_by` type gains `'MANUAL'`.
3. **Kind** — `staff/persistence/add-session-kind.ts` exports `createAddSessionKind(ids)` implementing 26a's
   `AttendanceChangeKind` for `ADD_SESSION`:
   - `target(scope)` — the employee (business-scoped, `deleted_at IS NULL`) and the requested branch must exist in the
     business, else `null` (→ `NOT_FOUND`); no locks.
   - `check(scope)` — reads the context through `manual-session-context.adapter.ts` (already under 26a's State lock),
     calls `planManualSession`, returns the values to store on the request (`manual: { clock_in, clock_out,
     working_date, timezone }`, `session_id: null`, `session_revision: null`).
   - `apply(scope, values)` — inserts the session through `manual-session-writes.ts` with a fresh id, `source
     'MANUAL'`, `status 'CLOSED'`, `closed_by 'MANUAL'`, `geo 'NONE'`, `out_geo 'NONE'`, no device/operator/binding/
     QR window/location, `revision 0`, `change_request_id = scope.requestId`; appends audit
     `attendance_session.added_manual`; returns `session_id`.
   - Registered in `attendance-change.providers.ts`: `createAttendanceChangeKinds([createAddSessionKind(ids)])`.
     `VOID_SESSION` stays unavailable until 26c.
4. **26a mechanism — small additive changes** (stacked PR, same module):
   - `AttendanceChangeKindInput` gains optional `branch_id`, `clock_in`, `clock_out`; `AttendanceChangeKindValues`
     gains optional `manual`; `AttendanceChangeKindScope` gains `requestId` (pre-generated id for filing, the row id
     for decide).
   - `drizzle-attendance-change-transactions.ts` generates the id once in `load` for filing; `inputFrom(before)`
     rebuilds the ADD input from the stored row; `saveAttendanceChange` uses `scope.requestId` and writes the four
     ADD columns on insert.
   - `AttendanceChangeError` gains `ATTENDANCE_MANUAL_INVALID_TIMES`, `ATTENDANCE_MANUAL_NOT_ELIGIBLE`; the HTTP
     mapping covers them (422).
5. **Contract** — `attendanceChangeRequestInput` ADD member becomes `{ kind, employee_id, branch_id, clock_in,
   clock_out, reason }` (strict, timestamps as ISO instants); `attendanceChangeRequest` gains
   `requested: { clock_in, clock_out, working_date, timezone } | null` (null for VOID), built by `readChangeRequest`,
   the list query and `saveAttendanceChange`. The decide response keeps `effect: null`; the created session is
   `session_id` (research R3). OpenAPI + admin/pos `schema.d.ts` regenerated.
6. **Context adapter** — `persistence/manual-session-context.adapter.ts` (new): branch timezone via
   `attendanceBranch` (tenancy index); employee eligibility facts (`employees` + `employee_branches`, `FOR SHARE`);
   schedule candidates of that branch around the clock-in (copy of the 16b-2 query, research R5); neighbours (same
   ±2-day window + OPEN shape as `correctionNeighboursStatement`, research R2); pending ADD requests of the employee.
7. **Errors** (`apps/api/src/shared/errors.ts`, i18n ar/en): `ATTENDANCE_MANUAL_INVALID_TIMES` 422,
   `ATTENDANCE_MANUAL_NOT_ELIGIBLE` 422, `ATTENDANCE_CORRECTION_MANUAL_SESSION` 409.
8. **Audit** — `attendance_session.added_manual` (entity `attendance_session`, after = source, working date, times,
   lateness, scheduled start, `change_request_id`, requester, approver), in addition to 26a's request audits.
9. **Events** — none new (spec). The worker's missed-out scheduling never sees a MANUAL session.

## Project Structure

### Documentation (this feature)

```text
docs/specs/045-staff-add-manual-session/
├── spec.md · plan.md · research.md · data-model.md · quickstart.md · tasks.md
├── contracts/add-manual-session-api.md
└── checklists/requirements.md
```

### Source Code (repository root)

```text
packages/db/
├── schema/staff-attendance.ts                         (source/closed_by CHECKs, change_request_id, FK, index)
├── schema/staff-attendance-change-requests.ts         (clock_in, clock_out, working_date, timezone, CHECKs, index)
├── migrations/0114_2026-10-10_manual-attendance-session.sql (+ snapshot, journal)
└── migrations/0115_2026-10-10_manual-attendance-session-validate.sql (+ snapshot, journal)
packages/contracts/src/staff/attendance-change-request{,-openapi}.ts (+ spec), openapi/openapi.json
packages/i18n/src/{ar,en}.ts
apps/api/src/modules/staff/
├── domain/{manual-attendance-session,attendance-interval}.ts (new, + __tests__)
├── domain/{attendance-correction,attendance-change-request}.ts (additive)
├── ports/attendance-change-kinds.port.ts (additive fields)
├── persistence/{add-session-kind,manual-session-context.adapter,manual-session-writes}.ts (new)
├── persistence/{attendance-correction-records,attendance-change-records,attendance-change-writes,drizzle-attendance-change-transactions}.ts
├── queries/attendance-change-requests.query.ts (requested field)
├── attendance-change.providers.ts
└── __tests__/manual-attendance-session*.spec.ts (new) + 26a/26 specs updated
apps/api/src/shared/errors.ts · apps/{admin,pos}/src/shared/api/schema.d.ts
docs/module-map.md · docs/adr/0040-attendance-change-requests.md (ADD kind note)
```

**Structure Decision**: the standard staff module shape (`CLAUDE.md` §2.2); no new folder.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| `DEFERRABLE INITIALLY DEFERRED` FK `attendance_sessions(company_id, change_request_id)` | Owner one-step (ACR-Q2) inserts the session in `apply` before 26a's `save` inserts the request row; the request row also references the session | Re-ordering 26a's save into insert-then-link would rewrite the mechanism under review in #148; dropping the FK loses the tenant-qualified link the spec requires |
| Schedule query duplicated from `attendance-context.adapter.ts` | That file belongs to lane 16b-2 and must not be edited | Extracting now collides with 16b-2; a follow-up extracts it after 16b-2 merges |
