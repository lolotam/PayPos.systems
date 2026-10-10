# Implementation Plan: Void an attendance session (and restore a voided one) on approval

**Branch**: `feat/p1-26c-void-attendance-session` (stacked on 26a, PR #148) | **Date**: 2026-10-10 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `docs/specs/046-staff-void-attendance-session/spec.md` (owner answers ACR-Q10,
ACR-Q11, ACR-Q13, ACR-Q19 … ACR-Q22, Waleed 2026-10-10; ACR-Q21 changed the same day to option 2 → `RESTORE_SESSION`).

## Summary

26c registers two kinds in 26a's `attendance-change-kinds` port: `VOID_SESSION` marks a CLOSED or MISSED_OUT
attendance session voided (who approved, when, which request) and `RESTORE_SESSION` clears those marks again. Both are
filed and decided through 26a's existing endpoints; each kind checks its rules at filing and again under locks at
approval, and applies inside the approval transaction. Nothing is deleted. A voided session is refused by the PR-26
correction and ignored by its overlap check. One expand migration set adds the three void columns to
`attendance_sessions`, widens the request `kind` CHECK, and replaces 26a's "one PENDING void per session" index with
"one PENDING void **or restore** per session".

## Technical Context

**Language/Version**: TypeScript 6 on Node 24 (ADR-0002; this machine runs 22.14 locally)

**Primary Dependencies**: NestJS (Fastify), Drizzle ORM + drizzle-kit, Zod, Vitest; no new dependency

**Storage**: PostgreSQL — `attendance_sessions` gains `voided_at`, `voided_by`, `void_request_id` (+ CHECKs, tenant FK,
two indexes); `attendance_change_requests` gets a wider `kind` CHECK, a session-shape CHECK and a replaced partial
UNIQUE index. No new table, no new permission, no new grant (`pospay_app` already holds table-level UPDATE on
`attendance_sessions` since 0072 — research R2)

**Testing**: Vitest unit (domain); integration on the T2 compose Postgres, one cloned database per spec file
(ADR-0006); RLS negative for the new FK; query shape + `EXPLAIN` for the touched list query

**Target Platform**: `apps/api` (+ the admin bell renderer for the new kind label); no new screen (ACR-Q6)

**Project Type**: modular monolith (web service + admin web app)

**Performance Goals**: each kind adds two or three indexed statements to 26a's transaction, well under 200 ms

**Constraints**: expand-only migrations, renumbered on 2026-10-11 to **0118–0121** (main 0111–0112, 26a 0113–0115, lane
26b 0116–0117; first planned as 0116+). The later PR to
merge renumbers with `renumber_migrations.py`; **no edit** to `staff/domain/clock-attendance.ts`,
`staff/persistence/attendance-context.adapter.ts`, `staff/persistence/attendance-writes.ts` or any worker job (lane
16b-2); edits to `attendance-correction.ts`, `attendance-correction-records.ts`, `schema/staff-attendance.ts` are small
and additive (lane 26b edits them too); shared registries edited additively only

**Scale/Scope**: 2 kinds, 1 domain file, 3 persistence files, up to 4 migrations, 3 new error codes, ~6 test files

## Constitution Check

| Principle | Check | Result |
|---|---|---|
| I. One vertical slice | One aggregate state (the void mark) with its undo: one domain file, one set of columns, 26a's three use cases; no new use case or endpoint | ✅ |
| II. Domain purity | `planAttendanceVoid` / `planAttendanceRestore` are pure, in `staff/domain/attendance-void.ts`; no arithmetic in use cases; Clock injected (26a scope `now`) | ✅ |
| III. Tenant isolation | New FK is tenant-qualified `(company_id, void_request_id)`; no new table; RLS unchanged; negative test that company A cannot reference company B's request | ✅ |
| IV. Boundaries | Staff-internal only; no new module arrow; kinds bound in `attendance-change.providers.ts` (module wiring) | ✅ |
| V. Tests | Domain unit, integration AVS-01 … AVS-15, RLS negative, list query shape + EXPLAIN | ✅ |
| VI. Arabic-first | New error texts and the restore label in the bell via `packages/i18n` ar+en | ✅ |
| VII. Documented why | Arabic JSDoc on every new domain function and port member | ✅ |

Post-design re-check: unchanged, ✅. No ADR is needed: the mechanism is ADR-0040's kinds port; the void columns and the
restore kind are business rules recorded in the spec and the owner-questions file (research R1).

## Design notes

1. **Domain** (`staff/domain/attendance-void.ts`, new, pure):
   - `AttendanceVoidSession` = `{ id, status, clock_in, clock_out, revision, voided_at }` (status
     `OPEN | CLOSED | MISSED_OUT`; a MANUAL session from 26b is CLOSED).
   - `planAttendanceVoid(session, request: { session_revision }, context: { now, approverId, requestId })` — order:
     voided → `ATTENDANCE_SESSION_VOIDED`; OPEN → `ATTENDANCE_SESSION_OPEN` (ACR-Q19); revision mismatch or at the int
     ceiling → `ATTENDANCE_SESSION_REVISION_CONFLICT` (ACR-Q13); returns `{ voided_at: now, voided_by: approverId,
     void_request_id: requestId, revision: revision + 1 }` (BR-001, BR-004).
   - `planAttendanceRestore(session, request: { session_revision }, context: { neighbours })` — not voided →
     `ATTENDANCE_SESSION_NOT_VOIDED`; revision mismatch or ceiling → `ATTENDANCE_SESSION_REVISION_CONFLICT`; overlap
     with any non-voided neighbour (OPEN = open-ended) → `ATTENDANCE_RESTORE_OVERLAP` (FR-008); returns `{ voided_at:
     null, voided_by: null, void_request_id: null, revision: revision + 1 }` (BR-005).
   - Overlap reuses PR 26's rule: `attendance-correction.ts` exports its existing interval test as
     `attendanceSessionsOverlap` (the private `overlaps`, now exported with Arabic JSDoc; additive).
   - `attendance-correction.ts` (BR-003): `AttendanceCorrectionSession` gains `voided_at: string | null`;
     `planAttendanceCorrection` refuses a voided session with `ATTENDANCE_SESSION_VOIDED` **before** the OPEN check;
     the error union gains that code. `attendance-correction-records.ts` selects `voided_at` and adds
     `AND voided_at IS NULL` to both halves of `correctionNeighboursStatement`.
2. **Kinds** (`persistence/void-session-kind.ts`, `persistence/restore-session-kind.ts`, each an `AttendanceChangeKind`):
   - `target(scope)` — non-locking read of `attendance_sessions` by `(company_id, business_id, id = input.session_id)`
     → `{ employee_id, branch_id }`, else `null` (→ `NOT_FOUND`).
   - `check(scope)` — runs after 26a has taken the State → identity → request locks: locks the session row
     `FOR UPDATE` (and verifies it still belongs to `scope.target`, else `NOT_FOUND`), refuses if another PENDING
     `VOID_SESSION` or `RESTORE_SESSION` request exists for that session (excluding `scope.request?.id`) with
     `ATTENDANCE_CHANGE_DUPLICATE_PENDING` (ACR-Q11; the partial UNIQUE index is the race backstop), reads the
     voided-aware neighbours (restore only), calls the pure planner with `scope.input.session_revision`, and returns
     `{ session_id, session_revision, requested }`.
   - `apply(scope, values)` — re-plans with `approverId = scope.userId` and `requestId = scope.requestId` (note 4), then
     one guarded `UPDATE attendance_sessions SET voided_at, voided_by, void_request_id, revision = revision + 1 WHERE
     company_id AND id AND revision = <seen>` (0 rows → `ATTENDANCE_SESSION_REVISION_CONFLICT`), one audit entry
     `attendance_session.voided` / `.restored` (entity `attendance_session`) with before/after `{ voided_at, voided_by,
     void_request_id, revision }`, and returns the values plus `effect: { session }`.
   - Writes live in `persistence/void-session-writes.ts`; both kinds are registered in `attendance-change.providers.ts`:
     `createAttendanceChangeKinds([voidSessionKind, restoreSessionKind])`.
3. **26a seams (additive edits)**:
   - `ports/attendance-change-kinds.port.ts`: `AttendanceChangeKindCode` adds `'RESTORE_SESSION'`; `AttendanceChangeKindValues`
     gains optional `requested` and `effect`; `AttendanceChangeKindScope` gains `requestId: string` (note 4).
   - `domain/attendance-change-request.ts`: the `AttendanceChangeError` code union adds `ATTENDANCE_SESSION_OPEN`,
     `ATTENDANCE_SESSION_VOIDED`, `ATTENDANCE_SESSION_NOT_VOIDED`, `ATTENDANCE_SESSION_REVISION_CONFLICT`,
     `ATTENDANCE_RESTORE_OVERLAP`.
   - `use-cases/decide-attendance-change`: returns `effect: values.effect ?? null` instead of the constant `null`.
   - `persistence/drizzle-attendance-change-transactions.ts`: mints `requestId` (existing request id on cancel/decide,
     `ids.newId()` on file) before `work`; the 23505 mapping uses the new index name
     `attendance_change_requests_one_pending_session`.
   - `persistence/attendance-change-writes.ts`: uses `scope.requestId` for the insert; the row carries `requested`.
   - `persistence/attendance-change-records.ts` and `queries/attendance-change-requests.query.ts`: `requested` read with
     `LEFT JOIN attendance_sessions s ON s.company_id = r.company_id AND s.id = r.session_id` (`null` when no session).
4. **Owner one-step and the request id** (research R3): the owner's own filing is approved in one step, so `apply`
   runs before 26a inserts the request row. `void_request_id` must name that row, so (a) the transactions adapter mints
   the request id before `work` and exposes it as `scope.requestId`, used by `apply` and by `save`; (b) the FK
   `(company_id, void_request_id) → attendance_change_requests` is altered to `DEFERRABLE INITIALLY DEFERRED` in the
   migration (Drizzle does not model deferrability; the snapshot is unaffected, so the drift check stays clean).
5. **Locks** (044 BR-003, unchanged order): authority precheck → employee `AttendanceState` → identity locks → request
   row (decide) → the kind locks the session row → neighbours read under the State lock. The PR-26 correction takes the
   same State lock first, so void-vs-correction and void-vs-restore serialise (AVS-10, AVS-15).
6. **Errors** (`apps/api/src/shared/errors.ts`, i18n ar/en): new `ATTENDANCE_SESSION_VOIDED` 409,
   `ATTENDANCE_SESSION_NOT_VOIDED` 409, `ATTENDANCE_RESTORE_OVERLAP` 422; reused `ATTENDANCE_SESSION_OPEN` 409,
   `ATTENDANCE_SESSION_REVISION_CONFLICT` 409, `ATTENDANCE_CHANGE_DUPLICATE_PENDING` 409. The PR-26 correction endpoint
   also returns `ATTENDANCE_SESSION_VOIDED` (contracts `attendance-correction.ts` error list + OpenAPI).
7. **Contracts**: the request input union gets strict members `VOID_SESSION` and `RESTORE_SESSION` with mandatory
   `session_id` and `session_revision` (the `ADD_SESSION` member is left as 26a shipped it, lane 26b narrows it);
   `attendanceChangeKind` adds `RESTORE_SESSION`; the row gains `requested` `{ clock_in, clock_out, working_date, timezone } | null` (the same shape as lane 26b's, spec 045 research R3); the decision result's `effect` becomes
   `{ session } | null` (contracts/void-restore-kinds-api.md).
8. **Bell copy**: the `change` enum (contracts `in-app-notifications.ts`, event payload types in `events/published.ts`)
   adds `RESTORE_SESSION`; i18n adds `inApp.attendance_change_restore` («استرجاع يوم حضور» / "Restore attendance day");
   `apps/admin/src/notifications/model/render-notification.ts` maps it.
9. **Not in this slice** (spec FR-005, ACR-Q20): board/report reads do not exist yet (PR 27 adds the
   `voided_at IS NULL` filter); no exception or correction row is touched; no worker change.

## Project Structure

### Documentation (this feature)

```text
docs/specs/046-staff-void-attendance-session/
├── spec.md · plan.md · research.md · data-model.md · quickstart.md · tasks.md
├── contracts/void-restore-kinds-api.md
└── checklists/requirements.md
```

### Source Code (repository root)

```text
packages/db/
├── schema/staff-attendance.ts                    (void columns, CHECKs, FK, indexes)
├── schema/staff-attendance-change-requests.ts    (kind CHECK, session-shape CHECK, replaced partial UNIQUE)
├── migrations/0116…0119_2026-10-10_attendance-session-void*.sql (+ meta/_journal.json, snapshots)
└── src/__tests__/ or apps/api staff __tests__ (RLS negative for the new FK)
packages/contracts/src/staff/attendance-change-request{,-openapi}.ts · attendance-correction*.ts (error list) ·
  in-app-notifications.ts · openapi/openapi.json
packages/i18n/src/{attendance-change,ar,en}.ts (errors + restore label)
apps/api/src/modules/staff/
├── domain/attendance-void.ts (+ __tests__) · domain/attendance-correction.ts (+ spec)
├── ports/attendance-change-kinds.port.ts
├── persistence/{void-session-kind,restore-session-kind,void-session-writes}.ts (new)
├── persistence/{attendance-correction-records,attendance-change-records,attendance-change-writes,drizzle-attendance-change-transactions}.ts
├── queries/attendance-change-requests.query.ts · use-cases/decide-attendance-change/
├── events/published.ts · attendance-change.providers.ts
└── __tests__/ (integration AVS-01…15, races, RLS)
apps/api/src/shared/errors.ts
apps/admin/src/notifications/model/render-notification.ts · apps/{admin,pos}/src/shared/api/schema.d.ts
```

**Structure Decision**: the standard staff module shape (`CLAUDE.md` §2.2); no new folder.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Deferred FK `void_request_id` | The owner one-step voids the session in the same transaction, before 26a inserts the request row | Inserting the request before `apply` would reorder 26a's shared save path for every kind (26b's `ADD_SESSION` needs the reverse order); dropping the FK would lose tenant-qualified integrity |
