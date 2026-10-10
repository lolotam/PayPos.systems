# Implementation Plan: Max shifts per day becomes an owner setting

**Branch**: `feat/p1-16c-max-shifts-setting` | **Date**: 2026-10-10 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `docs/specs/042-staff-max-shifts-setting/spec.md` (owner answers MS-Q1 … MS-Q5,
2026-10-10; MS-Q3 = 1 … 4).

## Summary

The fixed "2 shifts per start day" becomes a per-business setting `max_shifts_per_day` (1 … 4, default 3 when no row
exists), stored in a new staff-owned table `staff_schedule_settings` and read inside the schedule write transaction
after the company lock. A new use case `set-schedule-settings` (PUT) and a query (GET) expose it behind the new
owner-granted permission `manage:schedule-settings:business`. The domain checks the limit only on start days a save
changes (MS-Q4); template apply checks every day of every new copy. Over-limit days get the new
`SCHEDULE_DAY_LIMIT_EXCEEDED` (422). The contract bound `.max(14)` becomes `.max(28)`. The admin "Add shift" control
follows the effective limit, and a small settings panel lets permission holders change it.

## Technical Context

**Language/Version**: TypeScript 6 on Node 24 (ADR-0002; this machine runs 22.14 locally)

**Primary Dependencies**: NestJS (Fastify), Drizzle ORM + drizzle-kit, Zod, TanStack Query, Vitest; no new dependency

**Storage**: PostgreSQL — new tenant table `staff_schedule_settings` (RLS, FORCE, tenant FK); no change to
`staff_schedule_shifts` or `staff_shift_templates`

**Testing**: Vitest unit (domain); integration on the T2 compose Postgres, one cloned database per spec file
(ADR-0006); RLS negative; query shape + `EXPLAIN`; admin component tests

**Target Platform**: `apps/api` container, `apps/admin` web app; POS only regenerated types

**Project Type**: modular monolith (web service + admin web app)

**Performance Goals**: settings read is one primary-key lookup in the existing transaction; apply-template at
20 copies × 28 shifts is measured against 200 ms (FR-013) and reported, cap unchanged

**Constraints**: expand-only migrations; `staff → tenancy, identity, files` only (no new arrow); company lock
`FOR NO KEY UPDATE` taken before the settings row (TD-2); row 16b rebases on this PR, so changes stay focused

**Scale/Scope**: 1 table, 1 permission, 1 error code, 1 new use case, 1 new query, 4 use cases changed, ~12 test files

## Constitution Check

| Principle | Check | Result |
|---|---|---|
| I. One vertical slice | One use case (set the limit) plus the rule change it implies in the existing schedule writes | ✅ |
| II. Domain purity | Range, per-day count and changed-days helpers are pure functions in `staff/domain`; use cases only orchestrate; no money | ✅ |
| III. Tenant isolation | New table: `company_id`, PK `(company_id, business_id)`, ENABLE + FORCE RLS, tenant FK to `businesses`, negative test, exact grants | ✅ |
| IV. Boundaries | Settings live in staff; permission check through `identity/index.ts` (`scheduleAccess`, arrow already declared); no new arrow, no ADR | ✅ |
| V. Tests | Domain unit, integration MS-01 … MS-09, RLS negative, query shape + EXPLAIN, perf measurement | ✅ |
| VI. Arabic-first | Error text, panel labels via `packages/i18n` ar/en; logical CSS only | ✅ |
| VII. Documented why | Arabic JSDoc on new/changed domain functions and port methods; the stale "اثنتين" doc on `validateSchedulePattern` moves with the code | ✅ |

Post-design re-check: unchanged, ✅.

## Design notes

1. **Port.** `ScheduleScope` gains `maxShiftsPerDay(businessId): Promise<number>` (absent row → 3). Every schedule
   write calls it **after** `branch()` / `business()` (which take the company lock). A separate
   `ScheduleSettingsTransactions` port serves the new use case: `authorize(businessId)` (permission + feature +
   company lock), `settings(businessId)` (row `FOR UPDATE` or null), `save(before, after)` (upsert + audit).
2. **Domain** (`staff/domain/schedule-settings.ts`, new, plus `schedules.ts` edits):
   - `DEFAULT_MAX_SHIFTS_PER_DAY = 3`, `validateMaxShiftsPerDay(value)` (integer 1 … 4, else `VALIDATION_FAILED`).
   - `changedScheduleDays(before, after)` — start dates whose canonical shift set differs (the comparison now inside
     `requirePastScheduleReason`, extracted and reused there).
   - `changedPatternDays(before, after)` — weekday indexes whose `(start, end)` set differs, for template edits.
   - `validateSchedulePattern(shifts, limit, checkedDays?)` counts per `day` and throws
     `SCHEDULE_DAY_LIMIT_EXCEEDED` only for days in `checkedDays` (all days when omitted).
   - `validateScheduleOverlap(shifts, others, limit, checkedDates?)` — same, per `working_date`, counting the
     employee's other shifts in every branch and week.
   - `ScheduleError` carries `details` for the new code: `{ max_shifts_per_day, working_dates }` for schedule saves
     and apply, `{ max_shifts_per_day, days }` (weekday indexes 0 = Saturday) for template create/edit.
3. **Use cases.**
   - `set-schedule`: limit = `scope.maxShiftsPerDay`; materialize with the pattern check limited to changed days;
     overlap/day-count check on changed dates only.
   - `apply-shift-template`: template pattern checked on **all** days (a template with an excess day is refused
     before any write); each copy's dates checked against stored shifts and the other new copies of the same employee.
   - `create-shift-template`: all days. `update-shift-template`: changed weekdays only (name-only edit passes).
   - `set-schedule-settings` (new): validate range → lock → read row → no-op when equal (no audit) → upsert + audit
     `{ before: { max_shifts_per_day, is_default }, after: { max_shifts_per_day } }`.
4. **Queries.** `schedule-settings.query.ts` (GET, guarded by `manage:schedule-settings:business` through the identity
   reader); `schedule-week.query.ts` and `shift-templates.query.ts` add
   `COALESCE((SELECT max_shifts_per_day FROM staff_schedule_settings …), 3)`.
5. **Permission.** `manage:schedule-settings:business` added to `access-catalog.ts`, `ROLE_DEFAULTS` = `['owner']`,
   `OWNER_GRANTED_PERMISSIONS` (db and `identity/domain/permission-edit.ts`), human-role eligibility in
   `system-role-policy.ts`, and a reference-data migration inserting the owner `role_permissions` row if the
   catalog requires one (pattern: `0096_2026-10-09_documents-owner-default.sql`, `0058_…system-role-default-bundles.sql`).
   `scheduleAccess` gains a `'settings'` action that maps to it.
6. **Errors.** `SCHEDULE_DAY_LIMIT_EXCEEDED: 422` in `apps/api/src/shared/errors.ts` and `schedule-errors.ts`;
   ar/en texts; `SCHEDULE_SHIFT_INVALID` text drops "two per day".
7. **Admin.** `schedule-shift-fields.tsx` takes `maxShiftsPerDay` from the grid response; new
   `schedule-settings-panel.tsx` + `use-schedule-settings.ts` hook on the schedules page, shown only when the GET
   succeeds (403 → hidden).

## Project Structure

### Documentation (this feature)

```text
docs/specs/042-staff-max-shifts-setting/
├── spec.md · owner-questions.ar.md · plan.md · research.md · data-model.md · quickstart.md
├── contracts/schedule-settings-api.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/db/
├── schema/staff-schedule-settings.ts (new) · schema/index.ts
├── migrations/NNNN_2026-10-10_staff-schedule-settings.sql · NNNN+1_…-rls.sql · (permission row migration if needed) + journal
├── src/access-catalog.ts · role-defaults.ts · system-role-policy.ts
└── src/__tests__/privileges.spec.ts · role-defaults / system-role-policy specs
packages/contracts/src/staff/
├── schedule-settings.ts (new) · schedule-settings-openapi.ts (new) · schedules.ts (.max(28), grid/page field)
└── staff-openapi.ts · ../index.ts · generated/**
packages/i18n/src/ar.ts · en.ts
apps/api/src/shared/errors.ts
apps/api/src/modules/identity/
├── persistence/schedule-access.ts ('settings' action) · domain/permission-edit.ts (list)
apps/api/src/modules/staff/
├── domain/schedule-settings.ts (new) · schedules.ts · schedule-types.ts · __tests__/
├── ports/schedules.port.ts · schedule-settings.port.ts (new)
├── use-cases/set-schedule-settings/ (new) · set-schedule · apply-shift-template · create/update-shift-template
├── persistence/schedule-settings.adapter.ts (new) · drizzle-schedules.ts · schedule-context.adapter.ts
├── queries/schedule-settings.query.ts (new) · schedule-week.query.ts · shift-templates.query.ts
├── http/schedule-settings.controller.ts (new) · schedule-errors.ts
├── staff.module.ts
└── __tests__/schedule-settings.spec.ts · schedule-settings-rls.spec.ts (new) · schedule-batch.spec.ts · schedule-queries.spec.ts
apps/admin/src/staff/
├── ui/schedule-shift-fields.tsx · ui/schedule-settings-panel.tsx (new) · api/use-schedule-settings.ts (new)
└── pages/schedules-page.tsx · model/schedule-form.ts
apps/admin/src/shared/api/schema.d.ts · apps/pos/src/shared/api/schema.d.ts (regenerated)
docs/specs/020-staff-schedules/spec.md (note: limit is now a setting) · docs/specs/phase-1/IMPLEMENTATION-PLAN.md row 16c
```

**Structure Decision**: existing staff module shape; the permission check stays in identity (declared arrow).

## Complexity Tracking

None.
