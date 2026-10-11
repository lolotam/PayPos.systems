# Tasks: Add a manual attendance session (applied on owner approval)

**Input**: `docs/specs/045-staff-add-manual-session/` — spec.md, plan.md, research.md, data-model.md,
contracts/add-manual-session-api.md, quickstart.md. Owner answers ACR-Q10, Q11, Q13…Q18, Q22 (Waleed, 2026-10-10).
Stacked on 26a (spec 044, PR #148).

**Tests are mandatory** (`CLAUDE.md` §9) and come first in each phase; they must fail before the code exists.

**Fences**: do NOT edit `apps/api/src/modules/staff/domain/clock-attendance.ts` or
`apps/api/src/modules/staff/persistence/attendance-context.adapter.ts` (lane 16b-2) — import only. Files shared with
lane 26c (`staff/domain/attendance-correction.ts`, `staff/persistence/attendance-correction-records.ts`,
`packages/db/schema/staff-attendance.ts`): small additive edits only. Shared registries (contracts `index.ts`,
`openapi.json`, `schema.d.ts`, i18n `ar.ts`/`en.ts`, `errors.ts`, migrations journal, `privileges.spec.ts`) additive
only. Migrations are **0114** and **0115** only. `VOID_SESSION` stays unavailable (26c).

## Phase 1: Setup — schema and migrations

- [x] T001 Edit `packages/db/schema/staff-attendance.ts`: `source` CHECK → `IN ('QR','BARCODE','MANUAL')`;
  `close_pair` CHECK closed branch → `closed_by IN ('EMPLOYEE','MISSED_OUT','MANUAL')`; add
  `changeRequestId: uuid('change_request_id')` (one-line Arabic comment); FK `attendance_sessions_change_request_fk`
  `(company_id, change_request_id)` → `attendance_change_requests(company_id, id)`; index
  `attendance_sessions_change_request_idx (company_id, change_request_id)`; CHECK `attendance_sessions_manual_link`
  `(source = 'MANUAL') = (change_request_id IS NOT NULL)`; CHECK `attendance_sessions_manual_shape`
  `source <> 'MANUAL' OR (status = 'CLOSED' AND closed_by = 'MANUAL' AND binding_id IS NULL AND out_binding_id IS NULL
  AND device_id IS NULL AND out_device_id IS NULL AND operator_id IS NULL AND out_operator_id IS NULL AND qr_window IS
  NULL AND out_qr_window IS NULL AND latitude IS NULL AND out_latitude IS NULL AND geo = 'NONE' AND (out_geo IS NULL OR
  out_geo = 'NONE'))` and `closed_by <> 'MANUAL' OR source = 'MANUAL'` (fold into the same CHECK or a second one).
  The table import of `attendanceChangeRequests` is lazy inside the FK callback (the two schema files import each other)
- [x] T002 Edit `packages/db/schema/staff-attendance-change-requests.ts`: add `clockIn`, `clockOut` (`timestamptz`),
  `workingDate` (`date`), `timezone` (`text`), all nullable; CHECK `attendance_change_requests_add_values`
  `kind <> 'ADD_SESSION' OR (clock_in IS NOT NULL AND clock_out IS NOT NULL AND working_date IS NOT NULL AND timezone
  IS NOT NULL AND clock_out > clock_in AND session_revision IS NULL)`; CHECK `attendance_change_requests_add_only`
  `kind = 'ADD_SESSION' OR (clock_in IS NULL AND clock_out IS NULL AND working_date IS NULL AND timezone IS NULL)`;
  partial index `attendance_change_requests_pending_add_idx (company_id, employee_id) WHERE kind = 'ADD_SESSION' AND
  status = 'PENDING'`
- [x] T003 Generate `packages/db/migrations/0114_2026-10-10_manual-attendance-session.sql` with `pnpm db:generate
  manual-attendance-session` (snapshot + journal, `when` strictly increasing after 0113), then hand-edit: every new/
  re-added CHECK on `attendance_sessions` gets `NOT VALID`; the FK gets `NOT VALID` (immediate, see research R1); the
  `attendance_sessions_change_request_idx` index statement is moved out (to 0115); a short Arabic header comment
- [x] T004 Add `packages/db/migrations/0115_2026-10-10_manual-attendance-session-validate.sql` (custom, `--custom`,
  snapshot equal to 0114's schema + the index): first `CREATE INDEX CONCURRENTLY "attendance_sessions_change_request_idx"
  …` (concurrent-index prefix, `packages/db/src/concurrent-migrations.ts`), then `VALIDATE CONSTRAINT` for every
  `NOT VALID` constraint of 0114 (the 0109/0110 pattern)
- [x] T005 Run the drift check (`cd packages/db && node --experimental-strip-types scripts/generate-migration.ts
  drift-check` → "No schema changes"); update `packages/db/src/__tests__/privileges.spec.ts` only if a column-scoped
  INSERT grant lists columns (add the four request columns / `change_request_id`)

## Phase 2: Foundational (blocks every story)

- [x] T006 [P] Failing unit tests `apps/api/src/modules/staff/domain/__tests__/attendance-interval.spec.ts`: out = in,
  out < in, start or end 1 ms in the future, exactly 16 h allowed vs 16 h + 1 ms refused, touching ends allowed,
  overlap refused, OPEN neighbour (clock_out null) overlaps any later interval, excluded id ignored
- [x] T007 Add pure `apps/api/src/modules/staff/domain/attendance-interval.ts` exporting
  `attendanceIntervalRefused(start: Date, end: Date, now: Date, neighbours, excludeId: string | null): boolean` (Arabic
  JSDoc, CA-Q8 2026-10-08); make the private `assertTimes` in `domain/attendance-correction.ts` delegate to it with
  unchanged behaviour (its spec must stay green)
- [x] T008 Extend 26a's port `apps/api/src/modules/staff/ports/attendance-change-kinds.port.ts` additively:
  `AttendanceChangeKindInput` gains optional `branch_id`, `clock_in`, `clock_out`; `AttendanceChangeKindValues` gains
  optional `manual?: { clock_in: string; clock_out: string; working_date: string; timezone: string }`;
  `AttendanceChangeKindScope` gains `requestId: string` (Arabic one-line doc each)
- [x] T009 `AttendanceChangeError` in `domain/attendance-change-request.ts` gains `ATTENDANCE_MANUAL_INVALID_TIMES`,
  `ATTENDANCE_MANUAL_NOT_ELIGIBLE`; `apps/api/src/shared/errors.ts` adds them (422) and
  `ATTENDANCE_CORRECTION_MANUAL_SESSION` (409); `packages/i18n/src/{ar,en}.ts` messages (ar: «أوقات اليوم اليدوي مش
  صحيحة: الخروج لازم بعد الدخول، مش في المستقبل، ١٦ ساعة بالكتير، ومن غير تداخل مع حضور تاني» / «الموظفة مش مرتبطة
  بالفرع ده في اليوم ده أو اليوم برّه عقدها» / «اليوم اليدوي مايتصححش؛ اطلب إلغاءه وإضافة يوم جديد»; en equivalents);
  the 26a HTTP error mapping covers the two new change codes
- [x] T010 26a mechanism (`persistence/drizzle-attendance-change-transactions.ts`, `persistence/attendance-change-writes.ts`,
  `persistence/attendance-change-records.ts`): generate the request id once in `load` for filing (`ids.newId()`) and
  expose it as `scope.requestId` (decide/cancel: the row id); `saveAttendanceChange` inserts with that id and writes
  `clock_in, clock_out, working_date, timezone` from `values.manual` (NULL otherwise); `readChangeRequest` returns the
  new `requested` object; `inputFrom(before)` rebuilds `branch_id`, `clock_in`, `clock_out` for ADD
- [x] T011 Contracts `packages/contracts/src/staff/attendance-change-request.ts` (+ `-openapi.ts`, + spec): ADD member
  = strict `{ kind: 'ADD_SESSION', employee_id, branch_id, clock_in: timestamp, clock_out: timestamp, reason }` (no
  `session_id`/`session_revision`); VOID member unchanged; `attendanceChangeRequest` gains
  `requested: { clock_in, clock_out, working_date (YYYY-MM-DD), timezone } | null`; query
  `queries/attendance-change-requests.query.ts` projects it; regenerate `pnpm contracts:openapi` and the admin/pos
  `schema.d.ts`

## Phase 3: User Story 1 — Reem's forgotten Thursday (P1) 🎯 MVP

**Goal**: an ADD request waits PENDING; approval inserts one MANUAL session linked both ways; owner one-step.

**Independent test**: AMS-01, AMS-02, AMS-03, AMS-09.

- [x] T012 [P] [US1] Failing unit tests `apps/api/src/modules/staff/domain/__tests__/manual-attendance-session.spec.ts`:
  overnight 22:00 Thu → 02:00 Fri Kuwait → working date Thursday; working date across Kuwait midnight from UTC instants;
  scheduled shift picked by `attendanceSchedule` (covering shift first, else first start of the day); lateness 10 min →
  0, 11 min → 11; no shift → `scheduled_start`/`end` null and lateness 0; returned values echo the times as ISO
- [x] T013 [US1] Implement `apps/api/src/modules/staff/domain/manual-attendance-session.ts`: `planManualSession(input,
  context)` per plan note 1 (order: times → working date → eligibility → neighbours → pending → schedule → lateness);
  imports `attendanceWorkingDate`, `attendanceEligible`, `attendanceSchedule`, `attendanceLateMinutes` from
  `./clock-attendance.ts` (no edit there) and `attendanceIntervalRefused`; full Arabic JSDoc citing ACR-Q14…Q17
- [x] T014 [US1] `apps/api/src/modules/staff/persistence/manual-session-context.adapter.ts` (new): branch via
  `attendanceBranch` from `../../tenancy/index.ts` (null → `NOT_FOUND`); employee `hire_date`, `contract_end`
  (`deleted_at IS NULL`) and `employee_branches` attachments `FOR SHARE`; shift candidates of that branch (copy of the
  `scheduleCandidates` statement in `attendance-context.adapter.ts`, keyed by the clock-in and its working date);
  neighbours (±2 working days + any OPEN, the `correctionNeighboursStatement` shape); PENDING ADD requests of the
  employee (uses `attendance_change_requests_pending_add_idx`); add the synchronous line
  `staff -> tenancy.attendanceBranch @ apps/api/src/modules/staff/persistence/manual-session-context.adapter.ts` to
  `docs/module-map.md` (and `docs/module-map.yaml` if it lists adapter lines)
- [x] T015 [US1] `apps/api/src/modules/staff/persistence/manual-session-writes.ts` (new): insert the session (values of
  plan note 3) with `change_request_id = scope.requestId`; `appendAuditLog` entity `attendance_session`, action
  `attendance_session.added_manual`, after = `{ source, working_date, clock_in, clock_out, late_minutes,
  scheduled_start, change_request_id, requested_by, approved_by }`
- [x] T016 [US1] `apps/api/src/modules/staff/persistence/add-session-kind.ts` (new): `createAddSessionKind(ids)` with
  `target` / `check` / `apply` (plan note 3); register it in `apps/api/src/modules/staff/attendance-change.providers.ts`
  (`createAttendanceChangeKinds([createAddSessionKind(ids)])`)
- [x] T017 [US1] Integration `apps/api/src/modules/staff/__tests__/manual-attendance-session.spec.ts` (reuse
  `attendance-change.fixture.ts`): AMS-01 file → 201 PENDING, `requested` set, no session row; AMS-02 owner approves →
  one session `source 'MANUAL'`, `status 'CLOSED'`, `closed_by 'MANUAL'`, `geo 'NONE'`, `revision 0`,
  `change_request_id` = request, request APPROVED with `session_id`, audits `attendance_change.approved` and
  `attendance_session.added_manual`, no outbox event other than `AttendanceChangeDecided`; AMS-03 owner's own request →
  APPROVED + session in one call; AMS-09 the session has no binding/device/operator/QR/location columns set
- [x] T018 [US1] Update 26a tests that assumed an empty registry: `attendance-change-production.spec.ts` (only
  `VOID_SESSION` answers `ATTENDANCE_CHANGE_KIND_UNAVAILABLE`; ADD with the new required fields is accepted), and any
  26a spec/fixture whose `changeInput` uses `ADD_SESSION` without `branch_id`/`clock_in`/`clock_out`

## Phase 4: User Story 2 — impossible days are refused (P1)

**Goal**: ACR-Q15/Q16/Q11/Q13 refusals at filing and at approval.

**Independent test**: AMS-04, AMS-05, AMS-06, AMS-08.

- [x] T019 [P] [US2] Extend `manual-attendance-session.spec.ts`: out ≤ in, future by 1 ms, 16 h vs 16 h + 1 ms,
  touching vs overlapping neighbour, overlap with OPEN, excluded/voided neighbour ignored →
  `ATTENDANCE_MANUAL_INVALID_TIMES`; not attached, attachment `to` = date (exclusive) refused, contract_end = date
  (inclusive) allowed, contract_end < date refused, before hire refused → `ATTENDANCE_MANUAL_NOT_ELIGIBLE`; overlapping
  other PENDING ADD → `ATTENDANCE_CHANGE_DUPLICATE_PENDING`, the request's own id excluded; check order (times before
  eligibility)
- [x] T020 [US2] Integration `apps/api/src/modules/staff/__tests__/manual-attendance-session-refusals.spec.ts`: AMS-04
  invalid times and not-eligible refused at filing (422, no request row, no idempotency row); AMS-05 a real/approved
  session overlapping a PENDING request is inserted, then approval → 422 `ATTENDANCE_MANUAL_INVALID_TIMES` and the
  request stays PENDING with no session; AMS-06 overlapping PENDING ADD → 409 `ATTENDANCE_CHANGE_DUPLICATE_PENDING`;
  AMS-08 approve vs a concurrent clock-in of the same employee is serialised by the State lock (one wins, the other
  sees the result); device actor refused `FORBIDDEN`; approved-leave day accepted (leave not read); a date years back
  accepted
- [x] T021 [P] [US2] RLS negative in `manual-attendance-session-refusals.spec.ts` (or the 26a RLS spec): company A cannot
  insert a session whose `change_request_id` is company B's request (FK/RLS error at commit), cannot read B's MANUAL
  sessions

## Phase 5: User Story 3 — a manual day is not quietly stretched (P2)

**Goal**: ACR-Q10 — the ordinary correction refuses a MANUAL session.

**Independent test**: AMS-07.

- [x] T022 [P] [US3] Failing unit test in `apps/api/src/modules/staff/domain/__tests__/attendance-correction.spec.ts`:
  a session with `source 'MANUAL'` → `ATTENDANCE_CORRECTION_MANUAL_SESSION` (after the self rule, before
  OPEN/revision/time checks); QR/BARCODE unaffected
- [x] T023 [US3] `domain/attendance-correction.ts`: `AttendanceCorrectionSession` gains `source: 'QR' | 'BARCODE' |
  'MANUAL'`, `closed_by` gains `'MANUAL'`, error code `ATTENDANCE_CORRECTION_MANUAL_SESSION`, refusal per T022 with an
  Arabic comment citing ACR-Q10 (2026-10-10); `persistence/attendance-correction-records.ts` `lockedCorrectionSession`
  selects `source`; the correction HTTP mapping covers the code (409)
- [x] T024 [US3] Integration AMS-07 in `manual-attendance-session.spec.ts`: `correct-attendance` on an approved MANUAL
  session → 409 `ATTENDANCE_CORRECTION_MANUAL_SESSION`, session revision and times unchanged, no correction row

## Phase 6: Polish

- [x] T025 [P] `docs/adr/0040-attendance-change-requests.md`: short "ADD_SESSION (26b)" note — the immediate FK
  (research R1), `requestId` in the kind scope, the stored ADD values
- [ ] T026 Run the gates: `pnpm run typecheck`, `lint`, `lint:docs`, `module-map:check`, `pnpm --filter @pospay/db test`,
  `pnpm --filter @pospay/contracts test`, `pnpm --filter @pospay/api test`, drift check; tick this file's boxes

## Dependencies

Phase 1 → Phase 2 → US1 → US2 (needs the kind and the context adapter) ; US3 depends only on Phase 2 (T007) and can run
alongside US1. Polish last.

## Parallel examples

- Phase 2: T006 (tests) with T008 (port) and T011 (contracts).
- US1: T012 (domain tests) while T014/T015 are written.
- US3: T022/T023 in parallel with US1.

## Implementation strategy

MVP = Phase 1 + 2 + US1 (a forgotten day can be added and approved). US2 hardens it; US3 closes the correction hole.
One PR for all (row 26b).
