# Tasks: Max shifts per day becomes a per-branch setting

**Input**: `docs/specs/047-staff-branch-max-shifts/` — spec.md, plan.md, research.md, data-model.md,
contracts/branch-schedule-settings-api.md, quickstart.md. Owner answers MB-Q1 … MB-Q3 (Waleed, 2026-10-10).

**Tests are mandatory** (`CLAUDE.md` §9) and come first in each phase; they must fail before the code exists.

**Fences**: row 16d (spec 048) rebases on this PR — touch only the lines this slice needs in the shared schedule files
(`queries/schedule-week.query.ts`, `contracts/staff/schedules.ts`, the schedule use cases, the admin panel). No
reformatting of unrelated code. Do not touch the 16c business endpoints' behaviour.

## Phase 1: Setup

- [x] T001 After T005, generate the schema migration with `pnpm db:generate staff-branch-schedule-settings`, then the
  custom migration `pnpm db:generate staff-branch-schedule-settings-rls --custom`; number = next after the highest on
  `origin/main`; check every new journal `when` is strictly increasing

## Phase 2: Foundational

- [x] T002 [P] Failing domain tests in `apps/api/src/modules/staff/domain/__tests__/schedule-settings.spec.ts`:
  `effectiveMaxShiftsPerDay` (4,3 → 4; null,2 → 2; null,null → 3); `scheduleSettingsSource`; `templateMaxShiftsPerDay`
  ([2,4] → 4; [] with business 2 → 2; [] with null → 3)
- [x] T003 [P] Failing domain tests in `apps/api/src/modules/staff/domain/__tests__/schedules.spec.ts`:
  `validateScheduleOverlap` with `branchId` — Sara 2 Hawalli + 1 Salmiya at Salmiya limit 2 accepted; 3 Salmiya refused
  with `{ max_shifts_per_day: 2, working_dates }`; overlap with a Hawalli shift still `SCHEDULE_SHIFT_OVERLAP`; without
  `branchId` the old employee-wide count is unchanged (other callers)
- [x] T004 [P] Failing RLS negative test `apps/api/src/modules/staff/__tests__/branch-schedule-settings-rls.spec.ts` as
  `pospay_app`: cross-tenant SELECT = 0; INSERT with another `company_id` rejected; cross-tenant UPDATE/DELETE = 0 rows;
  FK to another tenant's branch rejected; FK to a branch of another business of the same tenant rejected; CHECK refuses
  0 and 5; UPDATE of `company_id`/`branch_id` has no grant
- [x] T005 Add `staffBranchScheduleSettings` to `packages/db/schema/staff-schedule-settings.ts` per data-model.md (PK
  `staff_branch_schedule_settings_pkey`, FK `staff_branch_schedule_settings_branch_fk` to
  `branches(company_id, business_id, id)`, CHECK `staff_branch_schedule_settings_max_shifts_per_day`, indexes
  `(company_id, business_id)` and `(updated_by)`; one Arabic line on `max_shifts_per_day`)
- [x] T006 Fill the RLS migration: ENABLE + FORCE; SELECT / INSERT / UPDATE / DELETE policies for `pospay_app`;
  `GRANT SELECT, INSERT, DELETE` and `GRANT UPDATE (max_shifts_per_day, updated_by, updated_at)`
- [x] T007 Update `packages/db/src/__tests__/privileges.spec.ts` and `packages/db/test/schedule-grants.ts` (additive)
- [x] T008 Implement the domain functions (T002, T003) with Arabic JSDoc; update the JSDoc of
  `validateScheduleOverlap`, `validateSchedulePattern`, `materializeSchedule` where they say "حد النشاط"

## Phase 3: User Story 1 + 2 — branch number applies to saves (P1)

- [x] T009 [US1] Failing integration tests in `apps/api/src/modules/staff/__tests__/branch-schedule-settings.spec.ts`:
  MB-01 (Hawalli 4 accepts 4; Salmiya 2 refuses 3) · MB-02 (no own number → business number, then 3) · MB-03 (Sara two
  branches) · MB-06 (lowering keeps rows; changed day refused) · MB-08 (concurrent lower vs save serialized)
- [x] T010 [US1] Ports: `ScheduleScope.maxShiftsPerDay(businessId, branchId)` and `templateMaxShiftsPerDay(businessId)`
  with Arabic one-liners
- [x] T011 [US1] `persistence/drizzle-schedules.ts`: branch `COALESCE` read; template maximum over active branches from
  `describeWorkspaces`
- [x] T012 [US1] Use cases `set-schedule`, `apply-shift-template` (limit by branch, `branchId` passed to every
  `validateScheduleOverlap` call), `create-shift-template`, `update-shift-template` (template maximum)

## Phase 4: User Story 3 — set and clear (P1)

- [x] T013 [US3] Failing tests: MB-04 (set/change/clear audited; no-op and clear-without-row not audited) · MB-05
  (non-holder `NOT_FOUND`, owner-granted person allowed, device refused) · MB-09 (0, 5 refused) · MB-10 (business
  change moves only branches without own number) · GET `branches[]` shape and sources
- [x] T014 [US3] Contracts in `packages/contracts/src/staff/schedule-settings.ts` (`scheduleSettingsSource`,
  `branchScheduleSettings`, `scheduleSettings.branches`) + `schedule-settings-openapi.ts`
- [x] T015 [US3] `ports/schedule-settings.port.ts` (branch scope methods), `persistence/schedule-settings.adapter.ts`
- [x] T016 [US3] Use cases `use-cases/set-branch-schedule-settings/`, `use-cases/clear-branch-schedule-settings/`
  (`Clock` injected; no SQL, no arithmetic)
- [x] T017 [US3] `http/branch-schedule-settings.controller.ts` (PUT, DELETE), `staff.module.ts`;
  `queries/schedule-settings.query.ts` (`branches[]`)

## Phase 5: User Story 4 — templates (P2)

- [x] T018 [US4] Failing test MB-07: template with 4 on Thursday saved (Hawalli 4, Salmiya 2); apply to Salmiya refused
  before any write; apply to Hawalli succeeds; all-branches-2 refuses a 3-shift pattern
- [x] T019 [US4] `queries/schedule-week.query.ts:47` (branch effective) and `queries/shift-templates.query.ts:19`
  (template maximum); result-shape tests and `EXPLAIN` in `schedule-queries.spec.ts`

## Phase 6: Admin + polish

- [x] T020 Failing admin tests in `apps/admin/src/staff/ui/schedule-settings-panel.spec.tsx` and
  `api/use-schedule-settings.spec.tsx`: branch number + source shown; set; clear ("use the business number"); list of
  branches with names from the workspace; hidden on `NOT_FOUND`/`FORBIDDEN`
- [x] T021 `ui/schedule-settings-panel.tsx`, `api/use-schedule-settings.ts`; i18n ar/en in
  `packages/i18n/src/schedule-shell-catalog.ts`
- [x] T022 `pnpm contracts:openapi`; regenerate admin and pos `schema.d.ts`
- [x] T023 Re-measure apply-template 20 × 28 (`schedule-batch.spec.ts`) and record the numbers for the PR
- [x] T024 Gates: typecheck, lint, lint:docs, module-map:check, `@pospay/db`, full `@pospay/api`, `@pospay/admin`,
  drift-check "No schema changes"

## Dependencies

- Phase 2 blocks everything. US1 before US3 (shared adapter). US4 needs T010–T011. Admin needs T014.
- [P] tasks touch different files.
