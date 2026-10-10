# Tasks: Max shifts per day becomes an owner setting

**Input**: `docs/specs/042-staff-max-shifts-setting/` — spec.md, plan.md, research.md, data-model.md,
contracts/schedule-settings-api.md, quickstart.md. Owner answers 2026-10-10 (MS-Q3 = **1 … 4**).

**Tests are mandatory** (`CLAUDE.md` §9) and come first in each phase; they must fail before the code exists.

**Fences**: row 16b (break windows) rebases on this PR — touch only the lines this slice needs in the shared schedule
files (`domain/schedules.ts`, `contracts/staff/schedules.ts`, the four schedule use cases, admin shift fields). No
reformatting of unrelated code.

## Phase 1: Setup

- [ ] T001 Generate the schema migration after T005 with `pnpm db:generate staff-schedule-settings` (creates
  `packages/db/migrations/NNNN_2026-10-10_staff-schedule-settings.sql`, snapshot and `meta/_journal.json` entry), then
  custom migrations `pnpm db:generate staff-schedule-settings-rls --custom` and
  `pnpm db:generate schedule-settings-permission --custom`; check every new journal `when` is strictly greater than
  the previous entry

## Phase 2: Foundational (blocks every story)

- [ ] T002 [P] Write failing domain unit tests in
  `apps/api/src/modules/staff/domain/__tests__/schedule-settings.spec.ts`: `validateMaxShiftsPerDay` accepts 1, 2, 3, 4
  and refuses 0, 5, 2.5, NaN with `VALIDATION_FAILED`; `DEFAULT_MAX_SHIFTS_PER_DAY === 3`; `changedScheduleDays`
  (unchanged day not listed, changed time listed, removed shift listed, added day listed, order/JSON key order not a
  change); `changedPatternDays` (weekday indexes, name-only edit → empty)
- [ ] T003 [P] Update failing domain tests in `apps/api/src/modules/staff/domain/__tests__/schedules.spec.ts`: limit
  1/3/4 per day; 3rd shift accepted at default 3, 4th refused with `SCHEDULE_DAY_LIMIT_EXCEEDED` and
  `details { max_shifts_per_day: 3, working_dates: [...] }`; employee-wide count with other-branch shifts; overnight and
  Friday→Saturday counted on the start day; only `checkedDates` counted (unchanged excess day passes, changed excess
  day fails); 16 h and bad time still `SCHEDULE_SHIFT_INVALID`; touching shifts allowed (MS-Q5). Replace the two
  assertions at `:87` and `:101` that expect a 3rd shift to be refused
- [ ] T004 [P] Write the failing RLS negative test `apps/api/src/modules/staff/__tests__/schedule-settings-rls.spec.ts`
  as `pospay_app`: cross-tenant SELECT = 0 rows; INSERT with another `company_id` rejected; cross-tenant UPDATE affects
  0 rows; same-tenant UPDATE cannot change `company_id`; FK to another tenant's business rejected; DELETE has no grant;
  CHECK refuses 0 and 5 (`max_shifts_per_day smallint NOT NULL CHECK (BETWEEN 1 AND 4)`)
- [ ] T005 Create `packages/db/schema/staff-schedule-settings.ts` (export from `packages/db/schema/index.ts`):
  `company_id uuid NOT NULL`, `business_id uuid NOT NULL`, `max_shifts_per_day smallint NOT NULL` with CHECK
  `staff_schedule_settings_max_shifts_per_day` `BETWEEN 1 AND 4`, `updated_by uuid NOT NULL` → `user(id)`,
  `updated_at timestamptz NOT NULL`; PK `staff_schedule_settings_pkey (company_id, business_id)`; FK
  `(company_id, business_id) → businesses(company_id, id)`; index `(updated_by)`; one-line Arabic comment per
  non-obvious column
- [ ] T006 Fill the RLS migration: `ENABLE` + `FORCE ROW LEVEL SECURITY`; policies for `pospay_app` — SELECT
  `USING (company_id = app_company_id())`, INSERT `WITH CHECK (…)`, UPDATE `USING (…) WITH CHECK (…)`; no DELETE
  policy; `GRANT SELECT, INSERT ON staff_schedule_settings TO pospay_app` and
  `GRANT UPDATE (max_shifts_per_day, updated_by, updated_at) ON staff_schedule_settings TO pospay_app`
- [ ] T007 Update the grant allowlist in `packages/db/src/__tests__/privileges.spec.ts` for the new table (additive)
- [ ] T008 Permission `manage:schedule-settings:business`: add to `packages/db/src/access-catalog.ts`;
  `ROLE_DEFAULTS` = `['owner']` with an Arabic comment citing MS-Q2 (2026-10-10) in `packages/db/src/role-defaults.ts`;
  append to `OWNER_GRANTED_PERMISSIONS` there **and** in `apps/api/src/modules/identity/domain/permission-edit.ts`;
  human-role eligibility and Device forbidden in `packages/db/src/system-role-policy.ts`; update
  `packages/db/src/__tests__/role-defaults.spec.ts` / `system-role-policy.spec.ts` and the parity test
  `apps/api/src/modules/identity/__tests__/documents-owner-default.spec.ts` if it enumerates the list
- [ ] T009 Fill the permission migration (pattern `0067_2026-10-04_passkey-unbind-permissions.sql`):
  `INSERT INTO permissions(code) VALUES ('manage:schedule-settings:business') ON CONFLICT DO NOTHING;` and the owner
  global role row `('01920000-0000-7000-8000-000000000101','global',NULL,'manage:schedule-settings:business')`
  `ON CONFLICT DO NOTHING`; Arabic header comment citing MS-Q2
- [ ] T010 Add `SCHEDULE_DAY_LIMIT_EXCEEDED: 422` in `apps/api/src/shared/errors.ts`, map it in
  `apps/api/src/modules/staff/http/schedule-errors.ts` with its `details`; ar/en messages in
  `packages/i18n/src/ar.ts` / `en.ts`; rewrite the `SCHEDULE_SHIFT_INVALID` ar/en text without "two per day"
- [ ] T011 Domain: create `apps/api/src/modules/staff/domain/schedule-settings.ts` (`DEFAULT_MAX_SHIFTS_PER_DAY`,
  `MAX_SHIFTS_PER_DAY_RANGE = { min: 1, max: 4 }`, `validateMaxShiftsPerDay`, `changedScheduleDays`,
  `changedPatternDays`) with full Arabic JSDoc; in `domain/schedules.ts` give `validateSchedulePattern` and
  `validateScheduleOverlap` a `limit` and optional checked-days argument, throw the new code with details, reuse
  `changedScheduleDays` inside `requirePastScheduleReason`; move every touched doc comment in the same edit; add
  `details` support to `ScheduleError` in `domain/schedule-types.ts`
- [ ] T012 Contracts: `packages/contracts/src/staff/schedule-settings.ts` (`scheduleSettings`,
  `setScheduleSettingsInput` strict `{ max_shifts_per_day: z.number().int().min(1).max(4) }`) + OpenAPI registration
  (`schedule-settings-openapi.ts`, `staff-openapi.ts`, `packages/contracts/src/index.ts`); in `schedules.ts` change both
  `.max(14)` to `.max(28)` and add `max_shifts_per_day: z.number().int()` to `scheduleGrid` and the template page

**Checkpoint**: domain tests green; `pnpm --filter @pospay/db test` green; drift-check "No schema changes".

## Phase 3: User Story 1 — a third shift in one day (P1) 🎯 MVP

**Goal**: default 3 everywhere; 4th refused with the new code; "Add shift" follows the effective limit.

**Independent test**: save 3 shifts on Thursday for a business with no settings row → 200; a 4th → 422.

- [ ] T013 [P] [US1] Integration tests in `apps/api/src/modules/staff/__tests__/schedule-settings.spec.ts`: MS-01
  (default 3 accepted, 4th refused, nothing written), cross-branch count (Salmiya 2 + Hawalli 2 refused)
- [ ] T014 [P] [US1] Query tests in `apps/api/src/modules/staff/__tests__/schedule-queries.spec.ts`: grid and template
  page carry `max_shifts_per_day` (3 without a row, stored value with one); `EXPLAIN` shows the settings lookup on
  `staff_schedule_settings_pkey`
- [ ] T015 [US1] Port + persistence: `maxShiftsPerDay(businessId)` on `ScheduleScope`
  (`apps/api/src/modules/staff/ports/schedules.port.ts`, Arabic one-liner) implemented in
  `persistence/drizzle-schedules.ts` (row or `DEFAULT_MAX_SHIFTS_PER_DAY`), read after the company lock
- [ ] T016 [US1] Use cases: `set-schedule` (changed dates only), `apply-shift-template` (all template days; copies vs
  stored and vs each other), `create-shift-template` (all days), `update-shift-template` (changed weekdays only) —
  limit from `scope.maxShiftsPerDay`, no arithmetic in the use case
- [ ] T017 [US1] Queries: `queries/schedule-week.query.ts` and `queries/shift-templates.query.ts` project
  `COALESCE(…, 3) AS max_shifts_per_day`
- [ ] T018 [US1] Admin: `apps/admin/src/staff/ui/schedule-shift-fields.tsx` disables "Add shift" at the grid's
  `max_shifts_per_day` (prop through `model/schedule-form.ts` / the edit dialog); component test updated

## Phase 4: User Story 2 — the owner changes the limit (P1)

**Goal**: owner reads and sets 1 … 4; audited; owner-only grant.

**Independent test**: owner PUT 4 → next save allows 4; audit row before/after; non-holder 403.

- [ ] T019 [P] [US2] Integration tests in `schedule-settings.spec.ts`: MS-02 (owner sets 4, next save allows 4, one
  audit row with before `{3, is_default: true}` / after `{4}` and actor), MS-03 (same value → no audit row), MS-04
  (business_manager refused 403, personal ALLOW granted by the owner allowed, ALLOW saved by a non-owner editor →
  `PERMISSION_OWNER_ONLY`, device role refused), MS-09 (0, 5, 2.5, extra key → 400 `VALIDATION_FAILED`), GET shape
  `{ business_id, max_shifts_per_day, is_default, updated_at }`, unknown business → same 404 as schedules
- [ ] T020 [P] [US2] Query test for `queries/schedule-settings.query.ts`: result shape + `EXPLAIN` on the PK
- [ ] T021 [US2] `apps/api/src/modules/identity/persistence/schedule-access.ts`: add the `'settings'` action mapping to
  `manage:schedule-settings:business` at business scope (doc comment updated)
- [ ] T022 [US2] Port `apps/api/src/modules/staff/ports/schedule-settings.port.ts` (Arabic one-liner per method) +
  adapter `persistence/schedule-settings.adapter.ts`: authorize (permission + feature + company lock
  `FOR NO KEY UPDATE`), read row `FOR UPDATE`, upsert `ON CONFLICT (company_id, business_id)`, audit row in the same
  transaction
- [ ] T023 [US2] Use case `use-cases/set-schedule-settings/set-schedule-settings.usecase.ts` (one-line Arabic comment;
  clock/user injected; no-op when equal)
- [ ] T024 [US2] Query `queries/schedule-settings.query.ts` + controller `http/schedule-settings.controller.ts`
  (GET/PUT, `@Authenticated()` + `SelectedCompanyGuard`, Zod pipe), wired in `staff.module.ts`
- [ ] T025 [US2] Admin: `apps/admin/src/staff/api/use-schedule-settings.ts` + `ui/schedule-settings-panel.tsx` on
  `pages/schedules-page.tsx` (hidden on 403, number field 1 … 4, i18n keys ar/en, logical CSS) + component test

## Phase 5: User Story 3 — Eid as consecutive shifts (P2)

- [ ] T026 [US3] Integration test MS-08 in `schedule-settings.spec.ts`: Thu 08:00–24:00, Fri 03:00–19:00,
  Fri 21:00–Sat 13:00, Sat 16:00–Sun 08:00 across two weeks saved; a single 24 h shift refused
  `SCHEDULE_SHIFT_INVALID`; touching shifts accepted (no code change expected)

## Phase 6: User Story 4 — lowering the limit later (P2)

- [ ] T027 [US4] Integration tests MS-05 (stored 4 on Thursday, lower to 3: rows untouched; edit Saturday only → 200;
  change a Thursday shift with 4 left → 422), MS-06 (template with 4 on a day: apply refused before any write;
  name-only edit → 200; editing that day must respect 3), MS-07 (concurrent lower vs 4th-shift save serialized — no
  excess row stored under the lower limit)

## Phase 7: Polish

- [ ] T028 Performance (FR-013): in `apps/api/src/modules/staff/__tests__/schedule-batch.spec.ts` set the business
  limit to 4 and use a 28-shift template (4 per day × 7); assert 560 shift rows; keep the `elapsed_ms` log; do **not**
  change the 20-copy cap
- [ ] T029 Regenerate `pnpm contracts:openapi`, `apps/admin/src/shared/api/schema.d.ts`,
  `apps/pos/src/shared/api/schema.d.ts`
- [ ] T030 Docs: note in `docs/specs/020-staff-schedules/spec.md` that the per-day limit is now the 042 setting; mark
  row 16c in `docs/specs/phase-1/IMPLEMENTATION-PLAN.md`
- [ ] T031 Gates: `pnpm run typecheck`, `lint`, `lint:docs`, `module-map:check`, touched-package tests, drift-check

## Dependencies

Setup T001 runs after T005 (schema) and before T006/T009. Phase 2 blocks all stories. US1 (T015–T018) before US2's
use case (both touch the staff module). US3 and US4 are tests on top of US1+US2. Polish last.

## Parallel examples

- Phase 2: T002, T003, T004 together (different files).
- US1: T013 and T014 together; US2: T019 and T020 together.

## Implementation strategy

MVP = Phase 2 + US1 (default 3 with the new error). Then US2 (the owner's setting), then US3/US4 test coverage,
then polish and the performance measurement.
