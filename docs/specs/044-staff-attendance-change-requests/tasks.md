# Tasks: Attendance change requests (request → owner approval)

**Input**: `docs/specs/044-staff-attendance-change-requests/` — spec.md, plan.md, research.md, data-model.md,
contracts/attendance-change-requests-api.md, quickstart.md. Owner answers ACR-Q1 … ACR-Q22, 2026-10-10; ACR-Q4 and
ACR-Q21 changed to option 2 the same day (Phase 8).

**Tests are mandatory** (`CLAUDE.md` §9) and come first in each phase; they must fail before the code exists.

**Fences**: do NOT edit `apps/api/src/modules/staff/domain/clock-attendance.ts` or
`apps/api/src/modules/staff/persistence/attendance-context.adapter.ts` (lane 16b-2). Do not change
`attendance_sessions`, the correction slice or the exception slice. Shared registries (contracts `index.ts`,
`openapi.json`, `schema.d.ts`, i18n `ar.ts`/`en.ts`, `errors.ts`, migrations journal, `privileges.spec.ts`,
role defaults) get additive edits only. **No production kind**: `staff.module.ts` wires an empty kinds registry.

## Phase 1: Setup

- [ ] T001 Add `packages/db/schema/staff-attendance-change-requests.ts` (table per data-model.md: columns, CHECKs
  `kind IN ('ADD_SESSION','VOID_SESSION')`, `status IN ('PENDING','APPROVED','REJECTED','CANCELLED')`,
  `reason = btrim(reason) AND char_length(reason) BETWEEN 1 AND 500`, `decision_reason IS NULL OR (trimmed, 1–500)`,
  `revision >= 0`, `session_revision IS NULL OR session_revision >= 0`, the four status-shape CHECKs; PK
  `(company_id, id)`; tenant FKs `(company_id, business_id, employee_id)` → employees, `(company_id, business_id,
  branch_id)` → branches, `(company_id, session_id)` → attendance_sessions; user FKs; the indexes and the partial UNIQUE
  `attendance_change_requests_one_pending_void`), export it from the schema index, with one-line Arabic comments on
  non-obvious columns
- [ ] T002 Generate `packages/db/migrations/0111_2026-10-10_attendance-change-requests.sql` with `pnpm db:generate`
  (snapshot + `meta/_journal.json`; journal `when` strictly increasing), then a custom migration for ENABLE + FORCE RLS,
  the tenant policy, `pospay_app` grants (SELECT, INSERT, UPDATE on `status, decided_by, decided_at, decision_reason,
  cancelled_by, cancelled_at, session_id, revision`; no DELETE) and the permission row
  `request:attendance-change:branch` with default role rows for owner, general_manager, business_manager,
  branch_manager (follow the `correct:attendance:branch` migration of PR 26)
- [ ] T003 Add `request:attendance-change:branch` to `packages/db/src/access-catalog.ts`, `role-defaults.ts`
  (`[...managers, 'branch_manager']`), `system-role-policy.ts` (`deviceForbidden`), `packages/i18n/src/permission-name.ts`

## Phase 2: Foundational (blocks every story)

- [ ] T004 [P] Failing domain tests `apps/api/src/modules/staff/domain/__tests__/attendance-change-request.spec.ts`:
  reason bounds (0, 1, 500, 501, spaces only); `planChangeRequest` self rule (non-owner employee refused
  `ATTENDANCE_CHANGE_SELF_FORBIDDEN`, owner allowed) and owner one-step (APPROVED, `decided_by = requested_by`,
  revision 1); `planChangeCancel` (requester only else `NOT_FOUND`, PENDING only else `ATTENDANCE_CHANGE_NOT_PENDING`,
  revision mismatch `ATTENDANCE_CHANGE_REVISION_CONFLICT`); `planChangeDecision` (owner only else `NOT_FOUND`, every
  non-PENDING status refused, revision mismatch, REJECTED without reason `VALIDATION_FAILED`, APPROVED with and
  without reason); check order authority → self → state → revision
- [ ] T005 Implement `apps/api/src/modules/staff/domain/attendance-change-request.ts` (pure, Arabic JSDoc on every
  export, `AttendanceChangeError` with the named codes)
- [ ] T006 [P] Ports with one-line Arabic docs per method: `ports/attendance-change-transactions.port.ts` (file,
  cancel, decide scopes) and `ports/attendance-change-kinds.port.ts` (`AttendanceChangeKinds.find`,
  `AttendanceChangeKind.target/check/apply`)
- [ ] T007 Identity helpers `apps/api/src/modules/identity/persistence/attendance-change-access.ts`:
  `readAttendanceChangeAccess` (`{ canRequest, owner }`, permission via `evaluateAccess`, owner via
  `canonicalOwnerSql`) and `readAttendanceChangeApprovers` (distinct active owner `user_id`s at `now`); export from
  `identity/index.ts`; add the synchronous adapter lines to `docs/module-map.md`
- [ ] T008 Persistence: `persistence/attendance-change-records.ts` (peek, State lock, locked request `FOR UPDATE`,
  employee `user_id`, names), `persistence/attendance-change-writes.ts` (insert/update row, `appendAuditLog`
  `attendance_change.requested|approved|rejected|cancelled`, `appendOutboxEvents`), `persistence/attendance-change-context.adapter.ts`
  (identity calls), `persistence/drizzle-attendance-change-transactions.ts` (withTenant, lock order of plan note 4,
  `runIdempotent` with operations `file-attendance-change`, `cancel-attendance-change`, `decide-attendance-change`,
  retryable SQLSTATEs → `TRANSACTION_RETRY_REQUIRED`, partial UNIQUE violation → `ATTENDANCE_CHANGE_DUPLICATE_PENDING`),
  `persistence/attendance-change-kinds.ts` (`createAttendanceChangeKinds(list)`)
- [ ] T009 [P] Contracts `packages/contracts/src/staff/attendance-change-request.ts` + `-openapi.ts` (input union,
  cancel, decide, list query, item, page) per contracts/attendance-change-requests-api.md; export from `index.ts`,
  register in `openapi.ts`; error codes in `apps/api/src/shared/errors.ts` with ar/en text in `packages/i18n`
- [ ] T010 [P] Events: `AttendanceChangeRequested` and `AttendanceChangeDecided` in
  `apps/api/src/modules/staff/events/published.ts` (Arabic one-liners) and staff `index.ts`; worker
  `apps/worker/src/outbox/known-event-types.ts` and `docs/specs/worker/known-event-types.md`;
  `NOTIFICATION_SOURCE_EVENTS`; in-app templates `attendance_change_requested` / `attendance_change_decided` in
  `packages/notifications/src/templates/` + registry, recipient/notification schemas in
  `packages/contracts/src/in-app-notifications.ts`, admin `render-notification.ts`, i18n copy; module-map event rows

**Checkpoint**: domain tests green; schema + migration + drift check clean.

## Phase 3: User Story 1 — a manager asks, the owner approves (P1) 🎯 MVP

**Independent Test**: with a test-only kind registered in the test module, file → PENDING + audit + owner notices;
approve → APPROVED + kind applied once + audit + requester notice.

- [ ] T011 [P] [US1] Failing integration tests `apps/api/src/modules/staff/__tests__/attendance-change-requests.spec.ts`
  (+ fixture registering a test-only kind via the test module's provider override): ACR-01, ACR-02, ACR-11 (replay /
  key reuse for file and decide), ACR-12 (production registry: any kind → `ATTENDANCE_CHANGE_KIND_UNAVAILABLE`, nothing
  stored), ACR-13 (kind refusal at approval keeps PENDING), ACR-14 (rollback of effect + audit + event together)
- [ ] T012 [US1] Use cases `use-cases/request-attendance-change/` and `use-cases/decide-attendance-change/` (approve
  path), one-line Arabic doc above each class
- [ ] T013 [US1] HTTP `http/attendance-change-requests.controller.ts` + `http/attendance-change-http.ts` (file and
  decide routes, `@Authenticated()`, Idempotency-Key, error envelope mapping), wiring in `staff.module.ts` with the
  empty production registry under the `ATTENDANCE_CHANGE_KINDS` token
- [ ] T014 [P] [US1] Worker test: both events store one in-app row per recipient and an event without recipients is
  acknowledged unsent (`apps/worker/src/modules/notifications/__tests__/`)

## Phase 4: User Story 2 — reject and withdraw (P1)

- [ ] T015 [P] [US2] Failing integration tests: ACR-03 (reject with/without reason), ACR-04 (withdraw by requester;
  another manager → NOT_FOUND), ACR-05 (every action on a terminal request → NOT_PENDING), ACR-07 (stale revision),
  ACR-06 races in `__tests__/attendance-change-races.spec.ts` (approve vs withdraw, approve vs approve: one commits)
- [ ] T016 [US2] Reject path in `decide-attendance-change`, `use-cases/cancel-attendance-change/`, cancel route

## Phase 5: User Story 3 — nobody approves their own manipulation (P1)

- [ ] T017 [P] [US3] Failing integration tests: ACR-08 (GM, business manager, branch manager on their own employee →
  SELF_FORBIDDEN; owner one-step APPROVED with two audit entries, no approver notice), ACR-09 (non-owner decide →
  NOT_FOUND; other branch/business/company → identical NOT_FOUND envelopes), ACR-10 (device FORBIDDEN, personal
  session 401) in `__tests__/attendance-change-requests-http.spec.ts`
- [ ] T018 [US3] Owner one-step path in `request-attendance-change`; device refusal in the transactions adapter

## Phase 6: User Story 4 — the owner sees what is waiting (P2)

- [ ] T019 [P] [US4] Failing query tests `apps/api/src/modules/staff/queries/__tests__/attendance-change-requests.query.spec.ts`:
  result shape, owner sees the business, branch manager sees her branches, `can_decide` / `can_cancel`, cursor order
  `(requested_at desc, id desc)`, `EXPLAIN ANALYZE` uses the inbox index for `status=PENDING` and the branch index for
  a branch filter
- [ ] T020 [US4] `queries/attendance-change-requests.query.ts` (one-line comment naming the consumer screen) + GET route

## Phase 7: Polish & cross-cutting

- [ ] T021 [P] RLS negative test for `attendance_change_requests` (cross-tenant SELECT = 0, INSERT refused, UPDATE only
  on granted columns, no DELETE) and `packages/db/src/__tests__/privileges.spec.ts` allowlist entry; `role-defaults.spec.ts`
- [ ] T022 [P] ADR `docs/adr/0040-attendance-change-requests.md` (kinds port shipped empty, owner-only decision through
  `canonicalOwnerSql`, lock order, approval re-check, reason in the requester notice)
- [ ] T023 Regenerate `openapi/openapi.json` (`pnpm contracts:openapi`) and `apps/{admin,pos}/src/shared/api/schema.d.ts`
- [ ] T024 Run gates: typecheck, lint, lint:docs, module-map:check, db + api + worker tests, drift check

## Dependencies

- Phase 1 → Phase 2 → US1 → (US2, US3, US4 in any order). T011 needs T008's test-kind override seam.
- Parallel: T004/T006/T009/T010; within stories the [P] test tasks.

## Implementation strategy

MVP = Phases 1–3 (file + approve with the test kind). Then reject/withdraw, self rules, the list. One PR for all.

## Phase 8: ACR-Q4 change (2026-10-10) — grantable decide permission

- [ ] T025 Failing tests first: domain (`planChangeDecision` with `canDecide` instead of owner; non-owner holder on
  his own filing or own attendance → `ATTENDANCE_CHANGE_SELF_FORBIDDEN`; owner on her own attendance allowed),
  integration ACR-15 in `apps/api/src/modules/staff/__tests__/attendance-change-requests-http.spec.ts` or a new
  `attendance-change-delegation.spec.ts` (owner grants to a general manager by personal ALLOW → he decides and is a
  notice recipient; SELF_FORBIDDEN cases; a non-owner editor granting it → `PERMISSION_OWNER_ONLY`; Device ALLOW
  ignored), list `can_decide` for a delegated holder, role-defaults and privileges specs
- [ ] T026 New expand migration `packages/db/migrations/0113_2026-10-10_attendance-change-decide-permission.sql`:
  permission row `decide:attendance-change:company` + owner default role row (journal `when` strictly increasing;
  drift check clean)
- [ ] T027 Add the code to `packages/db/src/access-catalog.ts`, `role-defaults.ts` (`['owner']`,
  `OWNER_GRANTED_PERMISSIONS`), `system-role-policy.ts` (`deviceForbidden`), `apps/api/src/modules/identity/domain/permission-edit.ts`,
  `packages/i18n` permission name
- [ ] T028 Identity `readAttendanceChangeAccess` returns `canDecide`; `readAttendanceChangeApprovers` returns every
  holder on the request's business/branch (owners always); domain, use cases, query `can_decide` and list scope switch
  from the owner flag to `canDecide`; ACR-Q2 one-step and ACR-Q22c keep the owner flag
- [ ] T029 Update `docs/adr/0040-attendance-change-requests.md` (decision moved to option 2, guard rails as orchestrator
  defaults) and confirm the `kind` CHECK is an explicit list 26c can extend with `RESTORE_SESSION`
