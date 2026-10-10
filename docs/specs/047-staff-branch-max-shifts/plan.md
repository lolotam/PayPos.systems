# Implementation Plan: Max shifts per day becomes a per-branch setting

**Branch**: `feat/p1-16c2-branch-max-shifts` | **Date**: 2026-10-10 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `docs/specs/047-staff-branch-max-shifts/spec.md` (owner answers MB-Q1 … MB-Q3,
Waleed 2026-10-10, all the recommended option; provisional until the partner answers).

## Summary

A branch may now carry its own "max shifts starting on one day" (1 … 4) in a new staff table
`staff_branch_schedule_settings`; a branch without one follows the 16c business number, else 3 (MB-Q2). Schedule saves
and template applies use the saving/target branch's effective number and count only that branch's shifts for the
employee (MB-Q1); overlap stays checked across all branches. Template create/update uses the largest effective number
among the business's active branches (MB-Q3). Two new routes set and clear a branch's number under the existing
owner-granted permission; the existing GET gains a `branches[]` list. Pure expand: nothing from 16c is removed.

## Technical Context

**Language/Version**: TypeScript 6 on Node 24 (ADR-0002; this machine runs 22.14 locally)

**Primary Dependencies**: NestJS (Fastify), Drizzle ORM + drizzle-kit, Zod, TanStack Query, Vitest; no new dependency

**Storage**: PostgreSQL — new tenant table `staff_branch_schedule_settings` (RLS, FORCE, tenant FK to branches);
`staff_schedule_settings` unchanged

**Testing**: Vitest unit (domain); integration on the T2 compose Postgres, one cloned database per spec file
(ADR-0006); RLS negative; query shape + `EXPLAIN`; admin component tests

**Target Platform**: `apps/api`, `apps/admin`; POS only regenerated types

**Project Type**: modular monolith (web service + admin web app)

**Performance Goals**: one extra PK lookup per schedule write; the template maximum reads ≤ a few rows by
`(company_id, business_id)`; apply-template 20 × 28 re-measured (spec 042 FR-013)

**Constraints**: expand-only migrations; no new module arrow (active branches through tenancy `describeWorkspaces`,
ADR-0024); company lock before the settings row; 16d (spec 048) rebases on this PR

**Scale/Scope**: 1 table, 0 permissions, 0 error codes, 2 new use cases (set / clear branch number), 4 schedule use
cases changed, 3 queries changed, ~8 test files

## Constitution Check

| Principle | Check | Result |
|---|---|---|
| I. One vertical slice | The per-branch number (set/clear) plus the rule change it implies in the existing schedule writes | ✅ |
| II. Domain purity | Effective value, per-branch count, template maximum are pure functions in `staff/domain`; use cases orchestrate | ✅ |
| III. Tenant isolation | `company_id`, PK `(company_id, branch_id)`, ENABLE + FORCE RLS, tenant FK `(company_id, business_id, branch_id) → branches`, negative test, exact grants | ✅ |
| IV. Boundaries | Permission through `identity/index.ts` (`scheduleAccess` `'settings'`), branches through `tenancy/index.ts`; no new arrow, no ADR | ✅ |
| V. Tests | Domain unit, integration MB-01 … MB-10, RLS negative, query shape + EXPLAIN, perf re-measure | ✅ |
| VI. Arabic-first | Panel labels and source names via `packages/i18n` ar/en; logical CSS | ✅ |
| VII. Documented why | Arabic JSDoc on new/changed domain functions and port methods; changed docs (`حد النشاط` → branch) move with the code | ✅ |

Post-design re-check: unchanged, ✅.

## Design notes

1. **Domain** (`staff/domain/schedule-settings.ts`):
   - `effectiveMaxShiftsPerDay(branchValue: number | null, businessValue: number | null)` → branch ?? business ?? 3.
   - `templateMaxShiftsPerDay(branchValues: readonly number[], businessValue: number | null)` → max of the active
     branches' effective values, or business ?? 3 when the list is empty. (Callers pass already-effective values.)
   - `scheduleSettingsSource(branchValue, businessValue)` → `'branch' | 'business' | 'default'`.
2. **Domain** (`staff/domain/schedules.ts`): `validateScheduleOverlap(shifts, others, limit, checkedDates?, branchId?)` —
   when `branchId` is given, the day count uses `others.filter(o => o.branch_id === branchId)`; the overlap loop uses
   all `others`. `ConcreteShift` already carries `branch_id` in `others` (`persistence/schedule-records.ts:51`).
3. **Ports** (`ports/schedules.port.ts`): `maxShiftsPerDay(businessId, branchId)` (branch effective) and
   `templateMaxShiftsPerDay(businessId)`; JSDoc updated. `ports/schedule-settings.port.ts`: scope gains
   `branch(businessId, branchId)` (active branch of the business, else `NOT_FOUND`), `branchSettings(branchId)` (row
   `FOR UPDATE` + business value), `saveBranch(before, after)` (upsert + audit), `clearBranch(before)` (delete + audit).
4. **Use cases**:
   - `set-schedule`, `apply-shift-template`: `limit = scope.maxShiftsPerDay(businessId, branchId)`;
     pass `branchId` to `validateScheduleOverlap` (also the cross-copy check in apply).
   - `create-shift-template`, `update-shift-template`: `limit = scope.templateMaxShiftsPerDay(businessId)`.
   - New `set-branch-schedule-settings` (PUT): validate range → authorize → branch → read → no-op when the own value is
     equal → upsert + audit `{ before: { branch_id, max_shifts_per_day | null, source }, after: { branch_id,
     max_shifts_per_day } }`.
   - New `clear-branch-schedule-settings` (DELETE): authorize → branch → no own row → return current (no audit) → delete
     + audit `{ before: { branch_id, max_shifts_per_day }, after: { branch_id, max_shifts_per_day: null, source } }`.
5. **Persistence**: `drizzle-schedules.ts` reads
   `COALESCE((branch row), (business row), 3)` for `maxShiftsPerDay`, and for `templateMaxShiftsPerDay` the active
   branch ids from `describeWorkspaces` then `max(COALESCE(branch, business, 3))` (business ?? 3 when none).
   `schedule-settings.adapter.ts` gains the branch scope methods; same company lock (`settingsAccess(…, lock=true)`).
6. **Queries**: `schedule-settings.query.ts` adds `branches[]` (active branches from `describeWorkspaces`, values by one
   `(company_id, business_id)` read); `schedule-week.query.ts:47` uses the branch `COALESCE`; `shift-templates.query.ts:19`
   uses the template maximum (active branch ids passed in).
7. **HTTP**: `http/branch-schedule-settings.controller.ts` (new, `businesses/:businessId/branches/:branchId/schedule-settings`,
   PUT + DELETE, same decorators as `schedule-settings.controller.ts`); wire in `staff.module.ts`.
8. **Contracts**: `scheduleSettings` gains `branches`; new `branchScheduleSettings` and `scheduleSettingsSource`; OpenAPI.
9. **Admin**: `schedule-settings-panel.tsx` adds the branch block (own number / "use the business number" / source) and
   the read-only list; `use-schedule-settings.ts` adds `useSetBranchScheduleSettings` / `useClearBranchScheduleSettings`
   invalidating the settings, grid and template keys.

## Project Structure

### Documentation (this feature)

```text
docs/specs/047-staff-branch-max-shifts/
├── spec.md · owner-questions.ar.md · plan.md · research.md · data-model.md · quickstart.md
├── contracts/branch-schedule-settings-api.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/db/
├── schema/staff-schedule-settings.ts (+ staffBranchScheduleSettings) · schema/index.ts (if needed)
├── migrations/NNNN_2026-10-10_staff-branch-schedule-settings.sql · NNNN+1_…-rls.sql + journal/snapshot
└── src/__tests__/privileges.spec.ts · test/schedule-grants.ts
packages/contracts/src/staff/schedule-settings.ts · schedule-settings-openapi.ts · openapi/openapi.json
packages/i18n/src/schedule-shell-catalog.ts
apps/api/src/modules/staff/
├── domain/schedule-settings.ts · schedules.ts · __tests__/schedule-settings.spec.ts · __tests__/schedules.spec.ts
├── ports/schedules.port.ts · schedule-settings.port.ts
├── use-cases/set-branch-schedule-settings/ (new) · clear-branch-schedule-settings/ (new)
├── use-cases/set-schedule · apply-shift-template · create-shift-template · update-shift-template
├── persistence/drizzle-schedules.ts · schedule-settings.adapter.ts
├── queries/schedule-settings.query.ts · schedule-week.query.ts · shift-templates.query.ts
├── http/branch-schedule-settings.controller.ts (new) · staff.module.ts
└── __tests__/branch-schedule-settings.spec.ts · branch-schedule-settings-rls.spec.ts (new) · schedule-queries.spec.ts
apps/admin/src/staff/ui/schedule-settings-panel.tsx (+ spec) · api/use-schedule-settings.ts (+ spec)
apps/admin/src/shared/api/schema.d.ts · apps/pos/src/shared/api/schema.d.ts (regenerated)
```

**Structure Decision**: existing staff module shape; permission in identity, active branches in tenancy (declared arrows).

## Complexity Tracking

None.
