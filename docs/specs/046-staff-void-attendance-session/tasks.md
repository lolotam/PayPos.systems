# Tasks: Void an attendance session (and restore a voided one) on approval

**Input**: `docs/specs/046-staff-void-attendance-session/` — spec.md, plan.md, research.md, data-model.md,
contracts/void-restore-kinds-api.md, quickstart.md. Owner answers ACR-Q10, ACR-Q11, ACR-Q13, ACR-Q19 … ACR-Q22
(2026-10-10; ACR-Q21 → option 2, `RESTORE_SESSION`). Stacked on 26a (spec 044, PR #148).

**Tests are mandatory** (`CLAUDE.md` §9) and come first in each phase; they must fail before the code exists.

**Fences**: do NOT edit `apps/api/src/modules/staff/domain/clock-attendance.ts`,
`apps/api/src/modules/staff/persistence/attendance-context.adapter.ts`,
`apps/api/src/modules/staff/persistence/attendance-writes.ts` or anything under `apps/worker/src/modules/staff/` (lane
16b-2). Lane 26b edits `staff/domain/attendance-correction.ts`, `staff/persistence/attendance-correction-records.ts` and
`packages/db/schema/staff-attendance.ts` in parallel: keep those edits small and additive. Shared registries (contracts
`index.ts`, `openapi.json`, `schema.d.ts`, i18n `ar.ts`/`en.ts`, `errors.ts`, migrations journal) get additive edits
only. Migrations are numbered **0116+**. No new dependency, no new grant, no new permission, no ADR.

## Phase 1: Setup (schema and migrations)

- [x] T001 In `packages/db/schema/staff-attendance.ts` add to `attendanceSessions`: `voidedAt: timestamp('voided_at',
  { withTimezone: true })`, `voidedBy: uuid('voided_by').references(() => user.id)`, `voidRequestId:
  uuid('void_request_id')` (one-line Arabic comment on `void_request_id`: the approved void request); CHECK
  `attendance_sessions_void_marks` "all three NULL or all three NOT NULL"; CHECK `attendance_sessions_void_closed`
  `voided_at IS NULL OR status <> 'OPEN'`; FK `attendance_sessions_void_request_fk` `(company_id, void_request_id)` →
  `attendance_change_requests(company_id, id)` (lazy reference to avoid the import cycle with
  `staff-attendance-change-requests.ts`); indexes `attendance_sessions_voided_by_idx (company_id, voided_by)` and
  `attendance_sessions_void_request_idx (company_id, void_request_id)`
- [x] T002 In `packages/db/schema/staff-attendance-change-requests.ts`: CHECK `attendance_change_requests_kind` →
  `kind IN ('ADD_SESSION','VOID_SESSION','RESTORE_SESSION')`; new CHECK `attendance_change_requests_session_kind`
  `kind NOT IN ('VOID_SESSION','RESTORE_SESSION') OR (session_id IS NOT NULL AND session_revision IS NOT NULL)`; replace
  the partial UNIQUE `attendance_change_requests_one_pending_void` with `attendance_change_requests_one_pending_session`
  on `(company_id, session_id) WHERE status = 'PENDING' AND kind IN ('VOID_SESSION','RESTORE_SESSION')`
- [x] T003 Generate the migrations with the repo generator (`packages/db/scripts/generate-migration.ts`, snapshots and
  `meta/_journal.json`, `when` strictly increasing) and shape them per research R5:
  `0120_2026-10-10_attendance-session-void.sql` (ADD COLUMN ×3; CHECKs and FK added `NOT VALID`; the FK is
  immediate (research R3, revised 2026-10-11); `kind` CHECK dropped and re-added `NOT VALID`; session-shape CHECK `NOT VALID`),
  `0121_…_attendance-session-void-validate.sql` (`VALIDATE CONSTRAINT` for each, 0110 precedent),
  `0122_…_attendance-session-void-indexes.sql` (`CREATE [UNIQUE] INDEX CONCURRENTLY` for the three indexes, ADR-0033
  leading prefix), `0123_…_attendance-session-void-drop-old-index.sql` (`DROP INDEX CONCURRENTLY
  attendance_change_requests_one_pending_void`). Then `node --experimental-strip-types scripts/generate-migration.ts
  drift-check` must print "No schema changes"

## Phase 2: Foundational (shared seams)

- [x] T004 [P] `apps/api/src/modules/staff/ports/attendance-change-kinds.port.ts`: `AttendanceChangeKindCode` adds
  `'RESTORE_SESSION'`; `AttendanceChangeKindValues` gains optional `requested` (`{ branch_id, working_date, clock_in,
  clock_out } | null`) and `effect` (`{ session: … } | null`); `AttendanceChangeKindScope` gains `requestId: string`;
  Arabic JSDoc on each new member
- [x] T005 [P] `apps/api/src/modules/staff/domain/attendance-change-request.ts`: `AttendanceChangeError` code union adds
  `ATTENDANCE_SESSION_OPEN`, `ATTENDANCE_SESSION_VOIDED`, `ATTENDANCE_SESSION_NOT_VOIDED`,
  `ATTENDANCE_SESSION_REVISION_CONFLICT`, `ATTENDANCE_RESTORE_OVERLAP`
- [x] T006 `apps/api/src/modules/staff/persistence/drizzle-attendance-change-transactions.ts`: mint `requestId` before
  `work` (existing request id for cancel/decide, `ids.newId()` for file) and pass it on the scope; map 23505 on
  `attendance_change_requests_one_pending_session` to `ATTENDANCE_CHANGE_DUPLICATE_PENDING`;
  `persistence/attendance-change-writes.ts` uses `scope`'s `requestId` for the insert and puts `requested` on the row
- [x] T007 [P] Contracts `packages/contracts/src/staff/attendance-change-request.ts` (+ `-openapi.ts`, spec):
  `attendanceChangeKind` adds `RESTORE_SESSION`; strict union members `VOID_SESSION` and `RESTORE_SESSION` with
  mandatory `session_id` and `session_revision` (`int ≥ 0`) — leave the `ADD_SESSION` member as 26a shipped it; row
  field `requested: { branch_id, working_date, clock_in, clock_out } | null`; `effect: { session: { id, working_date,
  clock_in, clock_out, status, revision, voided_at, voided_by, void_request_id } } | null`;
  `packages/contracts/src/in-app-notifications.ts` `change` enum adds `RESTORE_SESSION`
- [x] T008 [P] Errors: `apps/api/src/shared/errors.ts` adds `ATTENDANCE_SESSION_VOIDED` 409,
  `ATTENDANCE_SESSION_NOT_VOIDED` 409, `ATTENDANCE_RESTORE_OVERLAP` 422 (reuse existing `ATTENDANCE_SESSION_OPEN`,
  `ATTENDANCE_SESSION_REVISION_CONFLICT`); `packages/i18n` ar/en texts for the three; the correction contract's error
  list adds `ATTENDANCE_SESSION_VOIDED`; the HTTP mapping of `AttendanceChangeError` passes the new codes through
- [x] T009 [P] Bell: i18n `inApp.attendance_change_restore` («استرجاع يوم حضور» / "Restore attendance day") in
  `packages/i18n/src/attendance-change.ts`; `apps/admin/src/notifications/model/render-notification.ts` maps
  `RESTORE_SESSION` (+ its spec); `apps/api/src/modules/staff/events/published.ts` kind unions add `RESTORE_SESSION`

## Phase 3: User Story 1 — void a wrong day (P1) 🎯 MVP

**Goal**: a CLOSED/MISSED_OUT session is marked voided only when the request is approved.
**Independent test**: file → PENDING, session unchanged; approve → void marks, `revision + 1`, audit; owner one-step.

- [x] T010 [P] [US1] Domain tests `apps/api/src/modules/staff/domain/__tests__/attendance-void.spec.ts`
  (`planAttendanceVoid`): CLOSED ok, MISSED_OUT ok (status/closed_by untouched), OPEN → `ATTENDANCE_SESSION_OPEN`,
  voided → `ATTENDANCE_SESSION_VOIDED` (checked before OPEN), revision mismatch and int ceiling →
  `ATTENDANCE_SESSION_REVISION_CONFLICT`, result `{ voided_at: now, voided_by: approver, void_request_id, revision + 1 }`
- [x] T011 [P] [US1] Integration tests `apps/api/src/modules/staff/__tests__/attendance-void.spec.ts` (real kinds,
  production registry): AVS-01 file → PENDING, session row unchanged; AVS-02 approve → `voided_at`, `voided_by` =
  approver, `void_request_id` = request, `revision + 1`, status/times/scan facts unchanged, request APPROVED, one
  `attendance_session.voided` audit with before/after, decide response `effect.session`; AVS-03 owner one-step (the
  request FK holds); AVS-09 exceptions and correction rows byte-identical after the void
- [x] T012 [US1] Implement `apps/api/src/modules/staff/domain/attendance-void.ts` (`AttendanceVoidSession`,
  `planAttendanceVoid`; full Arabic JSDoc per `CLAUDE.md` §3.1)
- [x] T013 [US1] Implement `apps/api/src/modules/staff/persistence/void-session-writes.ts` (session lock `FOR UPDATE`
  scoped to company + business + id, PENDING-sibling check, guarded UPDATE `WHERE revision = <seen>` → 0 rows =
  `ATTENDANCE_SESSION_REVISION_CONFLICT`, audit entry entity `attendance_session`, `requested` and `effect` reads) and
  `persistence/void-session-kind.ts` (`target`, `check`, `apply` per plan note 2)
- [x] T014 [US1] Register the kind in `apps/api/src/modules/staff/attendance-change.providers.ts`; decide use case
  `use-cases/decide-attendance-change/decide-attendance-change.usecase.ts` returns `effect: values.effect ?? null`;
  update ACR-12 in `__tests__/attendance-change-production.spec.ts` (only `ADD_SESSION` still answers
  `ATTENDANCE_CHANGE_KIND_UNAVAILABLE`)

## Phase 4: User Story 2 — what cannot be voided (P1)

**Independent test**: each refusal code, request state after a refusal at approval.

- [x] T015 [P] [US2] Integration tests in `apps/api/src/modules/staff/__tests__/attendance-void.spec.ts`: AVS-04 OPEN
  refused at filing (409 `ATTENDANCE_SESSION_OPEN`); AVS-05 already voided refused at filing and at approval
  (`ATTENDANCE_SESSION_VOIDED`, request stays PENDING); AVS-06 correction between filing and approval → approval
  `ATTENDANCE_SESSION_REVISION_CONFLICT`, request PENDING; AVS-07 second PENDING void →
  `ATTENDANCE_CHANGE_DUPLICATE_PENDING`, and the owner one-step void while another void waits is refused the same way
- [x] T016 [P] [US2] Race test `apps/api/src/modules/staff/__tests__/attendance-void-races.spec.ts`: AVS-10 approve vs
  a concurrent PR-26 correction of the same session — exactly one commits, the other gets a revision/voided refusal
- [x] T017 [US2] Make the tests pass through T012/T013 (no new code path expected beyond the planner order)

## Phase 5: User Story 3 — a voided day is inert (P2)

**Independent test**: correction refuses a voided target and ignores a voided neighbour.

- [x] T018 [P] [US3] Domain tests in `apps/api/src/modules/staff/domain/__tests__/attendance-correction.spec.ts`:
  voided target → `ATTENDANCE_SESSION_VOIDED` (before the OPEN check); exported `attendanceSessionsOverlap` cases
- [x] T019 [P] [US3] Integration AVS-08 in `apps/api/src/modules/staff/__tests__/attendance-void.spec.ts`: PR-26
  `correct-attendance` on a voided session → 409 `ATTENDANCE_SESSION_VOIDED`; a voided 10:00–19:00 neighbour does not
  block correcting another session to 12:00–15:00
- [x] T020 [US3] `apps/api/src/modules/staff/domain/attendance-correction.ts`: `voided_at` on
  `AttendanceCorrectionSession`, voided refusal, error code, export `attendanceSessionsOverlap` with Arabic JSDoc;
  `persistence/attendance-correction-records.ts`: select `voided_at`, add `AND voided_at IS NULL` to both halves of
  `correctionNeighboursStatement`; update `__tests__/attendance-correction-neighbours.spec.ts` EXPLAIN if needed

## Phase 6: User Story 4 — undo a wrong void (P2)

**Independent test**: restore filed and approved; refusals; void request row unchanged.

- [x] T021 [P] [US4] Domain tests in `attendance-void.spec.ts` (`planAttendanceRestore`): not voided →
  `ATTENDANCE_SESSION_NOT_VOIDED`; revision mismatch → `ATTENDANCE_SESSION_REVISION_CONFLICT`; overlap with a CLOSED,
  MISSED_OUT or OPEN neighbour → `ATTENDANCE_RESTORE_OVERLAP`; touching edges allowed; result clears the three marks,
  `revision + 1`
- [x] T022 [P] [US4] Integration tests: AVS-11 restore filed (session stays voided) and approved → marks NULL,
  `revision + 1`, `attendance_session.restored` audit, original `VOID_SESSION` row unchanged; AVS-12 restore of a
  non-voided session → `ATTENDANCE_SESSION_NOT_VOIDED`; AVS-13 overlap appears before approval → 422
  `ATTENDANCE_RESTORE_OVERLAP`, request PENDING; AVS-14 duplicate PENDING restore, and a void filed while a restore
  waits → `ATTENDANCE_CHANGE_DUPLICATE_PENDING`; AVS-15 (races file) restore approval vs a concurrent void approval of
  the same session — exactly one commits
- [x] T023 [US4] Implement `planAttendanceRestore` in `domain/attendance-void.ts` and
  `persistence/restore-session-kind.ts` (neighbours via `correctionNeighbours`, voided-aware); register it in
  `attendance-change.providers.ts`

## Phase 7: Polish & cross-cutting

- [x] T024 [P] RLS negative `apps/api/src/modules/staff/__tests__/attendance-void-rls.spec.ts`: company A cannot set
  `void_request_id` to a company B request (FK/RLS refusal at commit); company A cannot read company B's void marks
- [x] T025 [P] List query `apps/api/src/modules/staff/queries/attendance-change-requests.query.ts` and
  `persistence/attendance-change-records.ts`: `requested` via `LEFT JOIN attendance_sessions` on
  `(company_id, session_id)`; update `__tests__/attendance-change-requests.query.spec.ts` (shape + EXPLAIN)
- [x] T026 Regenerate `packages/contracts/openapi/openapi.json` (`pnpm contracts:openapi`) and
  `apps/{admin,pos}/src/shared/api/schema.d.ts`
- [x] T027 Run gates: `pnpm run typecheck`, `pnpm run lint`, `pnpm run lint:docs`, `pnpm run module-map:check`,
  `pnpm --filter @pospay/api test`, `pnpm --filter @pospay/db test`, `pnpm --filter @pospay/contracts test`,
  `pnpm --filter @pospay/admin test`, drift check

## Dependencies

- Phase 1 → Phase 2 → US1 → (US2, US3, US4 in any order) → Polish. US4 depends on US3's voided-aware neighbour read.
- T004, T005, T007, T008, T009 are parallel; T006 follows T004.

## Parallel example (US1)

```text
T010 domain tests  ║  T011 integration tests   → then T012 → T013 → T014
```

## Implementation strategy

MVP = Phases 1–4 (void with its refusals). Then US3 (inert), US4 (restore), Polish. One PR for the whole row (26c).
