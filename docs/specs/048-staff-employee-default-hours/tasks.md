# Tasks: Default working hours and break on the employee profile

**Input**: `docs/specs/048-staff-employee-default-hours/` — spec.md, plan.md, research.md, data-model.md,
contracts/default-shifts-api.md, quickstart.md. Owner answers DH-Q1 … DH-Q7 (Waleed, 2026-10-10, provisional until the
partner answers).

**Tests are mandatory** (`CLAUDE.md` §9) and come first in each phase; they must fail before the code exists.

**Start condition**: met 2026-10-11 — row 16c-2 (spec 047, PR #151) is merged and this branch is merged on it;
migrations start at 0115. Touch only the lines this
slice needs in the shared schedule files (`queries/schedule-week.query.ts`, `contracts/staff/schedules.ts`, the admin
schedule editor). No reformatting of unrelated code.

## Phase 1: Setup

- [ ] T001 Generate the schema migration after T006 with `pnpm db:generate employee-default-shifts`, then custom
  migrations `pnpm db:generate employee-default-shifts-rls --custom` and
  `pnpm db:generate employee-hours-permission --custom`; check every new journal `when` is strictly increasing

## Phase 2: Foundational (blocks every story)

- [ ] T002 [P] Failing unit tests `packages/domain/src/__tests__/default-shifts.spec.ts`: `defaultShiftMinutes`
  (09:00–17:00 = 480 with a break, 22:00–06:00 = 480, 10:00–22:00 = 720); `contractedMinutes` (Sara Salmiya October
  2026 = 228 h = 13 680 min; empty entries = 0; dates outside are the caller's filter); `dayDiffersFromDefault` (equal →
  false; other start, end, break, missing break, extra break, two shifts → true; empty day → false; null entry → false)
- [ ] T003 [P] Failing staff-domain tests `apps/api/src/modules/staff/domain/__tests__/employee-default-shifts.spec.ts`:
  `validateDefaultShifts` (two entries same day → `SCHEDULE_DAY_LIMIT_EXCEEDED`; > 16 h → `SCHEDULE_SHIFT_INVALID`;
  break touching/outside → `SCHEDULE_BREAK_INVALID`; overnight ok; empty ok); `sameDefaultShifts` order-insensitive;
  `linkedOn` (from inclusive, to exclusive, null open)
- [ ] T004 [P] Failing RLS negative test `apps/api/src/modules/staff/__tests__/employee-default-shifts-rls.spec.ts` as
  `pospay_app`: cross-tenant SELECT = 0; INSERT with another `company_id` rejected; cross-tenant DELETE = 0 rows; no
  UPDATE grant; FK to another tenant's employee or branch rejected; FK to a branch of another business rejected; CHECK
  day 7 and half-break refused
- [ ] T005 Implement `packages/domain/src/default-shifts.ts` (Arabic JSDoc on each export) and export from
  `packages/domain/src/index.ts`
- [ ] T006 Create `packages/db/schema/staff-default-shifts.ts` per data-model.md (export from `schema/index.ts`); one
  Arabic line on `day` (0 = Saturday) and on the break pair
- [ ] T007 Fill the RLS migration: ENABLE + FORCE; SELECT / INSERT / DELETE policies for `pospay_app`;
  `GRANT SELECT, INSERT, DELETE ON employee_default_shifts TO pospay_app`
- [ ] T008 Update `packages/db/src/__tests__/privileges.spec.ts` (additive)
- [ ] T009 Permission `manage:employee-hours:business`: `packages/db/src/access-catalog.ts`; `ROLE_DEFAULTS = ['owner']`
  with an Arabic comment citing DH-Q5 (2026-10-10) in `role-defaults.ts`; `OWNER_GRANTED_PERMISSIONS` in
  `role-defaults.ts` **and** `apps/api/src/modules/identity/domain/permission-edit.ts`; human-only in
  `system-role-policy.ts`; their specs; i18n `permission-codes-catalog.ts` and `permission-name.ts`
- [ ] T010 Fill the permission migration (pattern `0105_2026-10-10_schedule-settings-permission.sql`)
- [ ] T011 `EMPLOYEE_BRANCH_NOT_LINKED: 422` in `apps/api/src/shared/errors.ts` with ar/en messages, and in
  `RAISED_BY_THE_API_ONLY` in the same file
- [ ] T012 Implement `apps/api/src/modules/staff/domain/employee-default-shifts.ts` (Arabic JSDoc)

## Phase 3: User Story 1 — set a branch's default week (P1)

- [ ] T013 [US1] Failing integration tests `apps/api/src/modules/staff/__tests__/employee-default-shifts.spec.ts`:
  DH-01 set/read/audit per branch (Salmiya and Hawalli independent) · DH-02 no-op no audit · DH-03 invalid refused,
  nothing written · DH-04 owner allowed, owner-granted person allowed, non-holder `FORBIDDEN`, device refused · DH-05
  unlinked branch `EMPLOYEE_BRANCH_NOT_LINKED` · DH-06 empty set clears (audited) · DH-09 concurrent saves serialized,
  both audited
- [ ] T014 [US1] Contracts `packages/contracts/src/staff/employee-default-shifts.ts` + `-openapi.ts`, register in
  `staff-openapi.ts` and `index.ts`
- [ ] T015 [US1] Port `ports/employee-default-shifts.port.ts` (Arabic one-liners per method)
- [ ] T016 [US1] Identity reader for `manage:employee-hours:business`, exported through `identity/index.ts`
- [ ] T017 [US1] Adapter `persistence/employee-default-shifts.adapter.ts` (company lock, employee `FOR NO KEY UPDATE`,
  links, delete + insert, `appendAuditLog`)
- [ ] T018 [US1] Use case `use-cases/set-employee-default-shifts/set-employee-default-shifts.usecase.ts` (`Clock`
  injected; no arithmetic, no SQL)
- [ ] T019 [US1] Query `queries/employee-default-shifts.query.ts` (+ `can_manage`, linked + unlinked branches) and
  controller `http/employee-default-shifts.controller.ts` (GET + PUT, guards); providers in a new
  `staff-default-shifts.providers.ts` spread into `staff.module.ts` (pattern `staff-schedule.providers.ts`)

## Phase 4: User Story 2 — profile notice (P1)

- [ ] T020 [US2] Failing admin tests: section lists linked branches, «دوامها مش مكتوب» for a branch with no rows,
  edit controls only with `can_manage`, save and clear
- [ ] T021 [US2] `apps/admin/src/staff/api/use-employee-default-hours.ts`, `ui/employee-default-hours-section.tsx`,
  `ui/employee-default-hours-form.tsx` (seven weekday rows, day length shown via `defaultShiftMinutes`), added to
  `ui/employee-record-sections.tsx`; i18n ar/en strings

## Phase 5: User Stories 3 + 4 — pre-fill and warning (P1)

- [ ] T022 [US3] Failing query test in `apps/api/src/modules/staff/__tests__/schedule-queries.spec.ts`: DH-07 grid row
  `default_shifts` holds this branch's rows only, `[]` without; `EXPLAIN` uses the PK / branch index
- [ ] T023 [US3] `queries/schedule-week.query.ts` adds `default_shifts`; `contracts/staff/schedules.ts`
  `scheduleGridRow.default_shifts`
- [ ] T024 [US3] Failing admin tests: first "Add shift" on a day uses the weekday default (times + break), second uses
  today's suggestion, no default → today's suggestion; Hawalli grid never uses Salmiya defaults
- [ ] T025 [US3] `model/schedule-form.ts` (`newScheduleShift(day, count, defaults)`), `ui/schedule-shift-fields.tsx`,
  `ui/schedule-shift-break-fields.tsx`, `model/use-schedule-editor.ts`
- [ ] T026 [US4] Failing admin tests: warning shown on a differing day, hidden on equal / empty / no-default days, save
  never blocked
- [ ] T027 [US4] `ui/schedule-day-warning.tsx` using `dayDiffersFromDefault`, rendered in `ui/schedule-day-form.tsx`;
  i18n «ده مختلف عن دوام {name}»

## Phase 6: User Story 5 — contracted hours for row 27 (P2)

- [ ] T028 [US5] Failing test DH-10: `employee-contracted-minutes.query.ts` returns entries, hire/contract and link
  intervals for a branch and October 2026; summing with `contractedMinutes` gives 228 h for Sara; `EXPLAIN` asserts the
  branch index
- [ ] T029 [US5] Implement `queries/employee-contracted-minutes.query.ts` (one-line comment: consumed by row 27's
  monthly report)

## Phase 7: User Story 6 + polish

- [ ] T030 [US6] DH-08: changing a default leaves saved weeks and templates untouched (integration)
- [ ] T031 `pnpm contracts:openapi`; regenerate admin and pos `schema.d.ts`
- [ ] T032 Gates: typecheck, lint, lint:docs, module-map:check, `@pospay/domain`, `@pospay/db`, full `@pospay/api`,
  `@pospay/admin` tests, drift-check "No schema changes"
- [ ] T033 Docs: mark spec 041/020 notes if needed; the orchestrator adds row 16d and the 27 → 16d dependency to
  `IMPLEMENTATION-PLAN.md`

## Dependencies

- Phase 2 blocks all stories. US1 before US2 (section reads the GET). US3/US4 need T023. US5 needs T005 and T006 only.
- [P] tasks touch different files and can run in parallel.
