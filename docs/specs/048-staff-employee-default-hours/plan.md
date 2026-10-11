# Implementation Plan: Default working hours and break on the employee profile

**Branch**: `feat/p1-16d-employee-default-hours` | **Date**: 2026-10-10 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `docs/specs/048-staff-employee-default-hours/spec.md` (owner answers DH-Q1 …
DH-Q7, Waleed 2026-10-10, provisional until the partner answers — his pick wins on a difference).

**Refreshed 2026-10-11**: row 16c-2 (spec 047, PR #151) has landed on `main` (605d627); this branch is merged on it.
16c-2 took migrations 0113/0114 (`staff_branch_schedule_settings`) and moved the schedule wiring into
`apps/api/src/modules/staff/staff-schedule.providers.ts`. 16d first started its migrations at 0115; after row 26a (PR #148) took 0115–0117 on `main` they were renumbered to **0118–0120**. It wires its
providers in a new `staff-default-shifts.providers.ts` (`staff.module.ts` is already 337 lines, warn at 300). Derived
rules (a) and (b) were confirmed by Waleed on 2026-10-11 and need no design change.

## Summary

Each employee gets, per linked branch (DH-Q7) and per weekday (DH-Q2), a default shift: start, end and an optional
break from–to (DH-Q1), stored in a new staff table `employee_default_shifts`. A new use case
`set-employee-default-shifts` (PUT per branch) and a read query (GET) expose it on the employee profile, behind the new
owner-granted permission `manage:employee-hours:business` (DH-Q5); the profile shows «دوامها مش مكتوب» for a linked
branch without a default (DH-Q6). The schedule grid row carries the branch's defaults so the admin editor pre-fills
the first shift of a day and shows a non-blocking warning on days that differ (DH-Q3). Three pure functions in
`packages/domain` (day length, contracted minutes, day-differs) are shared by the API and the admin; a `queries/`
reader returns contracted-minutes inputs for a branch and month for row 27 (DH-Q4).

## Dependency on row 27 (DH-Q4)

- **16d stores and exposes**: the table, `contractedMinutes()` in `packages/domain`, and
  `queries/employee-contracted-minutes.query.ts` (inputs for one branch and date range, tested with the October 2026
  example = 228 h). No HTTP endpoint and no report UI in 16d.
- **Row 27 shows**: the "contracted hours this month" column next to the actual hours in the monthly report and its
  CSV. Row 27's spec decides how approved leave and public holidays affect the column (not decided here).
- Order: 16d before 27; row 27 must list 16d as a dependency in `IMPLEMENTATION-PLAN.md` (orchestrator edits the row).

## Technical Context

**Language/Version**: TypeScript 6 on Node 24 (ADR-0002; this machine runs 22.14 locally)

**Primary Dependencies**: NestJS (Fastify), Drizzle ORM + drizzle-kit, Zod, react-hook-form, TanStack Query, Vitest;
no new dependency

**Storage**: PostgreSQL — new tenant table `employee_default_shifts` (RLS, FORCE, tenant FKs to employees and
branches); no change to `employees`, `staff_schedule_shifts` or `staff_shift_templates`

**Testing**: Vitest unit (`packages/domain`, staff domain); integration on the T2 compose Postgres, one cloned database
per spec file (ADR-0006); RLS negative; query shape + `EXPLAIN`; admin component tests

**Target Platform**: `apps/api`, `apps/admin`; POS only regenerated types

**Project Type**: modular monolith (web service + admin web app)

**Performance Goals**: profile read = one PK-range read; the grid adds one `jsonb_agg` over ≤ 7 rows per employee by
index; contracted-minutes read for one branch and month = one indexed scan, summed in memory

**Constraints**: expand-only migrations; no new module arrow (staff → identity already declared); writes take the
employee row lock; 16c-2 lands first and 16d rebases on it

**Scale/Scope**: 1 table, 1 permission, 1 error code, 1 use case, 3 queries, 3 shared pure functions, an admin section
and editor changes, ~12 test files

## Constitution Check

| Principle | Check | Result |
|---|---|---|
| I. One vertical slice | One use case (set a branch's default week) plus its reads and the editor pre-fill/warning | ✅ |
| II. Domain purity | Validation reuses `validateSchedulePattern(·, 1)`; day length, contracted minutes and day-differs are pure functions in `packages/domain`, imported by the API and the admin (no logic in React) | ✅ |
| III. Tenant isolation | `company_id`, PK `(company_id, employee_id, branch_id, day)`, ENABLE + FORCE RLS, tenant FKs to employees and branches, negative test, exact grants | ✅ |
| IV. Boundaries | Permission check through `identity/index.ts` (declared arrow); no new arrow, no ADR | ✅ |
| V. Tests | Domain unit, integration DH-01 … DH-10, RLS negative, query shape + EXPLAIN, admin tests | ✅ |
| VI. Arabic-first | Labels, notice and warning via `packages/i18n` ar/en; logical CSS only | ✅ |
| VII. Documented why | Arabic JSDoc on every new domain function and port method; the changed `newScheduleShift` comment moves with it | ✅ |

Post-design re-check: unchanged, ✅.

## Design notes

1. **Shared domain** (`packages/domain/src/default-shifts.ts`, new, exported from `index.ts`) — local `HH:mm` only:
   - `defaultShiftMinutes({ start, end })` → minutes, overnight aware (`end <= start` → +1440); the break is **not**
     subtracted (BW-Q4).
   - `contractedMinutes(entries, dates)` — `entries`: weekday → `{ start, end }`; `dates`: `{ weekday }[]` already
     filtered by the caller to employed and linked dates; returns the sum. Weekday 0 = Saturday.
   - `dayDiffersFromDefault(dayShifts, entry | null)` → `false` when `dayShifts` is empty or `entry` is null; else
     `true` unless exactly one shift equal on start, end, break_start, break_end (null equals null).
2. **Staff domain** (`apps/api/src/modules/staff/domain/employee-default-shifts.ts`, new):
   `validateDefaultShifts(shifts)` = `validateSchedulePattern(shifts, 1)` (one per weekday, ≤ 16 h, break inside);
   `sameDefaultShifts(before, after)` for the no-op check (order-insensitive); `linkedOn(links, branchId, date)`.
3. **Port** (`ports/employee-default-shifts.port.ts`, new): `EmployeeDefaultShiftsTransactions.run(actor, work)` with a
   scope: `authorize(businessId)` (permission + feature + company lock), `employee(businessId, employeeId, branchId)`
   (employee row `FOR NO KEY UPDATE`, branch links, branch time zone), `current(employeeId, branchId)`,
   `replace(before, after)` (delete + insert + audit).
4. **Use case** `use-cases/set-employee-default-shifts/`: authorize → lock employee → `EMPLOYEE_BRANCH_NOT_LINKED` if
   no open link to the branch on today's branch-local date (`Clock` injected) → validate → no-op → replace + audit
   `{ before: { branch_id, shifts }, after: { branch_id, shifts } }`.
5. **Queries**: `employee-default-shifts.query.ts` (GET; same access as the employee detail; `can_manage` from the
   identity reader; currently linked branches plus stored unlinked ones); `schedule-week.query.ts` adds
   `'default_shifts'` to each row (this branch only); `employee-contracted-minutes.query.ts` (branch + date range →
   per employee: entries, hire date, contract end, link intervals).
6. **Permission** `manage:employee-hours:business`: `access-catalog.ts`, `ROLE_DEFAULTS = ['owner']`,
   `OWNER_GRANTED_PERMISSIONS` (db + identity), `system-role-policy.ts` human-only, a migration inserting the permission
   and the owner role row (pattern `0105_…schedule-settings-permission.sql`), i18n permission catalogs; identity
   exposes the reader through `identity/index.ts`.
7. **Errors**: `EMPLOYEE_BRANCH_NOT_LINKED: 422` (`apps/api/src/shared/errors.ts`, ar/en), also listed in
   `RAISED_BY_THE_API_ONLY` (a bare framework 422 must never be reported as it); reuse the schedule codes.
8. **Admin**: `ui/employee-default-hours-section.tsx` (+ form), `api/use-employee-default-hours.ts`, added to
   `employee-record-sections.tsx`; editor: `newScheduleShift(day, count, defaults)` uses the weekday default when
   `count === 0`; `ui/schedule-day-warning.tsx` calls `dayDiffersFromDefault` per day.

## Project Structure

### Documentation (this feature)

```text
docs/specs/048-staff-employee-default-hours/
├── spec.md · owner-questions.ar.md · plan.md · research.md · data-model.md · quickstart.md
├── contracts/default-shifts-api.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/domain/src/default-shifts.ts (new) · index.ts · __tests__/default-shifts.spec.ts (new)
packages/db/
├── schema/staff-default-shifts.ts (new) · schema/index.ts
├── migrations/NNNN_…_employee-default-shifts.sql · NNNN+1_…-rls.sql · NNNN+2_…-permission.sql + journal/snapshot
├── src/access-catalog.ts · role-defaults.ts · system-role-policy.ts
└── src/__tests__/privileges.spec.ts · role-defaults / system-role-policy specs
packages/contracts/src/staff/
├── employee-default-shifts.ts (new) · employee-default-shifts-openapi.ts (new) · schedules.ts (grid row)
└── staff-openapi.ts · ../index.ts · openapi/openapi.json
packages/i18n/src/ (ar/en errors, schedule-shell-catalog.ts, employee catalog, permission catalogs)
apps/api/src/shared/errors.ts
apps/api/src/modules/identity/ (employee-hours access reader · domain/permission-edit.ts · index.ts)
apps/api/src/modules/staff/
├── domain/employee-default-shifts.ts (new) + __tests__
├── ports/employee-default-shifts.port.ts (new)
├── use-cases/set-employee-default-shifts/ (new)
├── persistence/employee-default-shifts.adapter.ts (new)
├── queries/employee-default-shifts.query.ts (new) · employee-contracted-minutes.query.ts (new) · schedule-week.query.ts
├── http/employee-default-shifts.controller.ts (new) · staff-default-shifts.providers.ts (new) · staff.module.ts
└── __tests__/employee-default-shifts.spec.ts · employee-default-shifts-rls.spec.ts (new) · schedule-queries.spec.ts
apps/admin/src/staff/
├── ui/employee-default-hours-section.tsx · employee-default-hours-form.tsx · schedule-day-warning.tsx (new)
├── ui/employee-record-sections.tsx · schedule-shift-fields.tsx · schedule-shift-break-fields.tsx · schedule-day-form.tsx
└── api/use-employee-default-hours.ts (new) · model/schedule-form.ts · model/use-schedule-editor.ts
apps/admin/src/shared/api/schema.d.ts · apps/pos/src/shared/api/schema.d.ts (regenerated)
```

**Structure Decision**: existing staff module shape; shared pure functions in `packages/domain`; permission in identity.

## Complexity Tracking

None.
