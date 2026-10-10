# Tasks: Passkey phone lock (043, phase 1 row 21b)

**Input**: `docs/specs/043-staff-passkey-device-lock/` — spec.md, plan.md (D1–D10), data-model.md,
contracts/passkey-device-lock-api.md, research.md, quickstart.md; ADR-0039 (Accepted 2026-10-10).

**Tests are mandatory** (`CLAUDE.md` §9) and are written first; they must fail before the code exists.

Paths below are relative to the repo root. `staff/` = `apps/api/src/modules/staff/`.

## Phase 1: Setup

- [x] T001 Confirm no new library is needed and the next free migration number (today 0103) in `packages/db/migrations/meta/_journal.json`; numbers are reassigned at merge

## Phase 2: Foundational (blocks every story)

- [x] T002 [P] Write the domain decision-table unit tests in `staff/domain/__tests__/passkey-device-lock.spec.ts`: no lock → ACCEPT attach; own THIS → ACCEPT no attach (unless binding unlocked → attach); held by other → `DEVICE_LOCKED` (CLOCK/CHALLENGE) / `DEVICE_TAKEN` (ENROL) with holder; own OTHER → `NOT_ENROLLED` / `OTHER_DEVICE` holder null; held-by-other wins over own OTHER (BR-009); CHALLENGE never attaches
- [x] T003 Implement `decidePasskeyDeviceLock(facts)` with full Arabic JSDoc in `staff/domain/passkey-device-lock.ts` (plan D1 types; pure, zero imports outside `packages/domain`)
- [x] T004 [P] Add `installationHash: text('installation_hash')` (nullable, CHECK `installation_hash ~ '^[a-f0-9]{64}$'`, one-line column comment) and partial index `employee_passkeys_active_installation_idx (company_id, installation_hash) WHERE unbound_at IS NULL AND installation_hash IS NOT NULL` (non-unique) in `packages/db/schema/staff-passkeys.ts`
- [x] T005 [P] Create `packages/db/schema/staff-device-refusals.ts` table `attendance_device_refusals` exactly as data-model.md: PK `(company_id, id)`; `business_id`, `branch_id`, `employee_id` NOT NULL; `holder_employee_id` NULL; `step` CHECK in (`CHALLENGE`,`CLOCK`,`ENROL`); `reason` CHECK in (`DEVICE_LOCKED`,`NOT_ENROLLED`,`DEVICE_TAKEN`,`OTHER_DEVICE`); `installation_hash` NOT NULL CHECK hex 64; `attempted_at timestamptz NOT NULL`; CHECK holder NOT NULL exactly when reason in (`DEVICE_LOCKED`,`DEVICE_TAKEN`); tenant FKs to employees (both) and branches; indexes `attendance_device_refusals_branch_time_idx (company_id, business_id, branch_id, attempted_at, id)`, `…_employee_idx`, `…_holder_idx` partial; export from `packages/db/schema/index.ts`
- [x] T006 Generate the migrations (`packages/db/migrations/NNNN_2026-10-10_passkey-installation-lock.sql` create + `NNNN_2026-10-10_passkey-installation-lock-rls.sql`), journal and meta: index on the existing table `CONCURRENTLY` per ADR-0033; ENABLE + FORCE RLS + tenant policy on the new table; `GRANT SELECT, INSERT` on it to `pospay_app`; `GRANT UPDATE (installation_hash) ON employee_passkeys TO pospay_app`; set-once trigger refusing a change or clear of a non-NULL `installation_hash`
- [x] T007 Update the grant allowlist in `packages/db/src/__tests__/privileges.spec.ts` (additive) and run the drift check (`No schema changes`)
- [x] T008 [P] Write the RLS negative spec (new file next to the existing staff RLS specs in `staff/__tests__/`): cross-tenant read of `attendance_device_refusals` = 0 rows, cross-tenant insert refused, cross-tenant FK refused, UPDATE/DELETE refused for `pospay_app`; `employee_passkeys.installation_hash` cross-tenant update refused; trigger refuses change and clear; only `installation_hash` is newly updatable
- [x] T009 Add error codes `ATTENDANCE_DEVICE_LOCKED: 403`, `ATTENDANCE_DEVICE_NOT_ENROLLED: 403`, `PASSKEY_DEVICE_TAKEN: 409`, `PASSKEY_OTHER_DEVICE: 409` with DL-15 messages in `apps/api/src/shared/errors.ts` (additive, follow the file's lists)
- [x] T010 [P] Write the port `staff/ports/attendance-device-refusals.port.ts` (Arabic JSDoc) and the writer `staff/persistence/attendance-device-refusals.ts` (own `withTenant`, hashes with `installationHash()`, ENROL branch = employee `primary_branch_id`, injected failure reporter that never logs the installation id); wire in `staff/staff.module.ts`

## Phase 3: User Story 1 — My phone clocks only me (P1)

**Goal**: challenge and clock refuse another person's phone and the person's other phones; the owner clocks as before.
**Independent test**: DL-01 … DL-04, DL-10, DL-11 on real Postgres with the synthetic authenticator.

- [x] T011 [P] [US1] Contract tests: `clockChallengeInput` accepts optional `installation_id`; `clockAttendanceInput` still requires it, in `packages/contracts/src/staff/__tests__/` (existing contract test file for clock-attendance)
- [x] T012 [P] [US1] Integration spec `staff/__tests__/passkey-device-lock-clock.spec.ts`: DL-01 (B on A's X → `ATTENDANCE_DEVICE_LOCKED` at challenge and clock, no ceremony issued, no session/audit/outbox/idempotency/signal row), DL-02 (A on X unchanged), DL-03 (lock change between challenge and clock → clock decides), DL-04 (A on Y → `ATTENDANCE_DEVICE_NOT_ENROLLED`), DL-10 (legacy binding attaches on first accepted clock; refused if X held by another person), dedupe never attaches, replay of an accepted clock from another installation returns the stored response, concurrent attach of one installation by two people → exactly one wins, DL-11 card regression
- [x] T013 [US1] `packages/contracts/src/staff/clock-attendance.ts`: add optional `installation_id` to `clockChallengeInput`, keep it required in `clockAttendanceInput` (override in `extend`)
- [x] T014 [US1] Ports: `AttendanceTransaction.deviceLock(installationId)` and `AttendanceWrite.attachInstallation` with Arabic JSDoc in `staff/ports/clock-attendance.port.ts`
- [x] T015 [US1] Persistence: facts reader + installation advisory lock (after binding `FOR UPDATE`) in `staff/persistence/attendance-transactions.ts` / `attendance-context.adapter.ts`; attach UPDATE (`… AND installation_hash IS NULL AND unbound_at IS NULL`) in `staff/persistence/attendance-writes.ts` when `attachInstallation`
- [x] T016 [US1] Use case `staff/use-cases/request-clock-challenge/request-clock-challenge.ts`: check after QR verify, before `attendanceOptions`, only when `installation_id` present; record refusal outside `run`; rethrow mapped code
- [x] T017 [US1] Use case `staff/use-cases/clock-attendance/clock-attendance.ts`: check inside the idempotent effect before `verifyAttendance` and before `attendanceDuplicate`; pass `attach` to `persist`; record refusal outside `run`
- [x] T018 [US1] HTTP: map the two codes in `staff/http/clock-attendance.controller.ts`; challenge body passes `installation_id` (not in `scan_digest`, not in the clock fingerprint)
- [x] T019 [P] [US1] POS: send `installation_id` on the challenge in `apps/pos/src/personal-staff/api/attendance-calls.ts`; `navigator.storage?.persist?.()` in `apps/pos/src/personal-staff/model/installation-id.ts`; refusal messages in `apps/pos/src/personal-staff/ui/clock-attendance-screen.tsx` (+ tests); i18n keys in `packages/i18n/src/ar.ts`, `en.ts`

## Phase 4: User Story 2 — A phone cannot be enrolled for a second person (P1)

**Goal**: enrollment records the phone and refuses another person's phone and the person's second phone.
**Independent test**: DL-05 … DL-07b.

- [x] T020 [P] [US2] Contract tests for `passkeyVerifyInput.installation_id` (optional) and `passkeyOptionsInput` (missing body = `{}`) in `packages/contracts/src/staff/__tests__/`
- [x] T021 [P] [US2] Integration spec `staff/__tests__/passkey-device-lock-enrol.spec.ts`: DL-05 (options and verify refused `PASSKEY_DEVICE_TAKEN`, no binding/audit/event; pre-registered credential inert), DL-06 (two concurrent enrolments on one new installation → exactly one binding), DL-07 (same person, second business, same phone → accepted), DL-07b (`PASSKEY_OTHER_DEVICE`), verify without `installation_id` → binding with NULL hash
- [x] T022 [US2] `packages/contracts/src/staff/passkeys.ts`: optional `installation_id` on `passkeyVerifyInput`; new `passkeyOptionsInput`; export from the contracts index (additive)
- [x] T023 [US2] Ports in `staff/ports/passkeys.port.ts` (Arabic JSDoc): binding tx `deviceLock`, insert record `installationId: string | null`, read-only device-lock reader for the options pre-check
- [x] T024 [US2] Persistence `staff/persistence/passkey-transactions.ts`: facts reader + installation advisory lock after the employee lock; insert writes the hash
- [x] T025 [US2] Use case `staff/use-cases/enrol-passkey/enrol-passkey.ts`: `execute(..., installationId?)` decision + record outside; `checkInstallation(scope, installationId)` pre-check
- [x] T026 [US2] HTTP `staff/http/passkeys.controller.ts`: optional options body → pre-check before `enrollmentOptions`; verify passes `installation_id`; map the two codes
- [x] T027 [P] [US2] POS: send `installation_id` on options and verify in `apps/pos/src/personal-staff/api/personal-calls.ts` and `use-enrol-passkey.ts`; refusal messages in `apps/pos/src/personal-staff/ui/enrol-passkey-screen.tsx` (+ tests)

## Phase 5: User Story 3 — Releasing a phone (P2)

**Goal**: unbind frees the phone; recovery after loss is manager unbind (PL-Q2).
**Independent test**: DL-08, DL-09.

- [x] T028 [P] [US3] Integration cases in `staff/__tests__/passkey-device-lock-enrol.spec.ts`: after unbind of A, B enrols on X; A enrols on Y and Y becomes her lock; a stale challenge for A fails as today
- [x] T029 [US3] Query `staff/queries/employee-passkeys.query.ts` + its contract: `phone_locked`, `phone_locked_since` (never the hash), result-shape test update
- [x] T030 [P] [US3] Admin: "phone locked" on the active binding in `apps/admin/src/staff/ui/employee-passkey-section.tsx`; unbind form line "unbinding also frees the phone" in `unbind-passkey-form.tsx` (+ tests, i18n additive)

## Phase 6: User Story 5 — The manager sees refused attempts (P2)

**Goal**: one refusal row per refusal, after rollback; a board query.
**Independent test**: DL-12 … DL-15.

- [x] T031 [P] [US5] Integration assertions in the clock and enrol specs: exactly one `attendance_device_refusals` row per refusal with the right step/reason/holder/branch, written after rollback; DL-13 writer failure still returns the same refusal; no raw installation id in DB rows or captured logs
- [x] T032 [P] [US5] Query test `staff/__tests__/attendance-device-refusals.query.spec.ts`: result shape (no hash), newest first, keyset cursor, tenant-only rows, `EXPLAIN` uses `attendance_device_refusals_branch_time_idx`
- [x] T033 [US5] Contract `packages/contracts/src/staff/attendance-device-refusals.ts` (row + page) and query `staff/queries/attendance-device-refusals.query.ts` (one-line comment naming the row-27 board)

## Phase 7: Polish & cross-cutting

- [x] T034 Retire the pair rule: delete `staff/domain/shared-installation.ts` + test, `staff/queries/shared-installations.query.ts`, `sharedInstallationFlag*` in `packages/contracts/src/staff/unbind-passkey.ts` and index; trim `staff/__tests__/attendance-device-signals.spec.ts` and `shared-installation-flow.spec.ts` to the observation assertions
- [x] T035 Regenerate OpenAPI (`pnpm contracts:openapi`) and `apps/admin` / `apps/pos` `schema.d.ts`
- [x] T036 [P] Docs: notes in `docs/specs/026-*/spec.md` and `docs/specs/027-*/spec.md` pointing to 043 / ADR-0039; row 27 note in `docs/specs/phase-1/IMPLEMENTATION-PLAN.md`
- [x] T037 Gates: `pnpm run typecheck`, `lint`, `lint:docs`, `module-map:check`, API/db/contracts/pos/admin tests, drift check

## Dependencies

- Phase 2 blocks everything. US1 and US2 share T003/T009/T010 and can run in parallel after Phase 2 (disjoint files
  except `errors.ts` / i18n, which are touched once in Phase 2 / T019).
- US3 needs US2 (enrolment writes the hash). US5 assertions need US1 + US2.
- Polish last.

## Parallel examples

- Phase 2: T002, T004, T005, T008, T010 together.
- US1: T011, T012, T019 together; US2: T020, T021, T027 together.

## Implementation strategy

MVP = Phase 2 + US1 + US2 (the lock is only real when both clock and enrollment enforce it), then US3, US5, polish —
all in this one PR.
