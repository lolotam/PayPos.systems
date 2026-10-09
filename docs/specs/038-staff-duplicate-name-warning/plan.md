# Implementation Plan: Duplicate-name warning on create / update employee

**Branch**: `feat/p1-08b-duplicate-name-warning` | **Date**: 2026-10-09 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `docs/specs/038-staff-duplicate-name-warning/spec.md` (owner answers
2026-10-09 in [owner-questions.ar.md](owner-questions.ar.md)).

## Summary

Before a create, or an update that changes a name, the admin employee form asks the server for same-name employees
in the same business. The server answers from one read-only `queries/` statement that normalises both the stored and
the typed name in SQL (NFKC, no diacritics/tatweel, أ/إ/آ/ٱ→ا, ة→ه, ى→ي, lower case, collapsed spaces) and compares
Arabic with Arabic and English with English. Visible matches come back with details; matches outside the caller's
visible branches only increase `hidden_count`. The form shows a bilingual warning with "edit name" / "save anyway";
"save anyway" calls the unchanged create/update endpoints. The write path, schema and audits do not change.

## Technical Context

**Language/Version**: TypeScript 5 (Node 22 locally, Node 24 in images), React 19 / Next.js (admin)

**Primary Dependencies**: NestJS (Fastify), Drizzle `sql` tag, Zod 4, TanStack Query, react-hook-form — all existing

**Storage**: PostgreSQL 16, existing `employees` and `employee_branches` tables; no migration

**Testing**: Vitest (contracts; api integration on the T2 compose Postgres with a cloned DB per spec file; admin with
Testing Library)

**Target Platform**: `apps/api` + `apps/admin`

**Project Type**: web service + web admin in the pnpm monorepo

**Performance Goals**: the check answers well under 200 ms for a business of a few hundred employees (one indexed
scan of one business)

**Constraints**: `queries/` may not import `domain/` or `use-cases/`; reads only; guard on the route; i18n keys only;
logical CSS properties; names never in URLs (TD-1)

**Scale/Scope**: one query file, one route, one contract file, three new admin files, two forms, i18n keys

## Constitution Check

| Principle | Check | Result |
|---|---|---|
| I. One slice | No use case added or changed; one read + its UI. Spec written first, owner answers recorded. | Pass |
| II. Domain purity | No arithmetic, no money, no use case. The name key is a matching rule kept in SQL inside `queries/` because `queries/` may not import `domain/` and both sides of the comparison must use one definition. | Pass |
| III. Tenant isolation | Runs inside `withTenant(companyId)`; filter on `company_id` + `business_id`; RLS on `employees` already FORCE. No new table. | Pass |
| IV. Boundaries | Query lives in `staff/queries/`, uses the existing `EmployeeDetailAccess` reader next to the queries; no new module arrow. | Pass |
| V. Tests | Query result shape + `EXPLAIN ANALYZE` index assertion; HTTP guard tests; UI tests. No new tenant table → no new RLS suite; cross-tenant non-leak asserted in the integration test. | Pass |
| VI. Arabic-first | New `staff.duplicateName*` keys in `ar.ts` / `en.ts`; RTL-safe markup; `packages/ui` components. | Pass |
| VII. Documented why | One-line Arabic comment above the SQL naming the consuming screen; no `domain/`/`ports/` additions. | Pass |

Post-design re-check: unchanged — Pass.

## Project Structure

### Documentation (this feature)

```text
docs/specs/038-staff-duplicate-name-warning/
├── spec.md
├── owner-questions.ar.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/employee-name-matches.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/contracts/src/staff/employee-name-matches.ts        (new — input/output Zod)
packages/contracts/src/staff/staff-openapi.ts                 (path registration)
packages/contracts/src/index.ts                               (additive export)
packages/contracts/openapi/openapi.json                       (regenerated)
packages/i18n/src/en.ts, packages/i18n/src/ar.ts              (staff.duplicateName* keys)
apps/api/src/modules/staff/queries/employee-name-matches.query.ts   (new)
apps/api/src/modules/staff/http/employees.controller.ts      (POST name-matches route)
apps/api/src/modules/staff/__tests__/employee-name-matches.spec.ts  (new — integration, shape, EXPLAIN, HTTP)
apps/admin/src/shared/api/schema.d.ts, apps/pos/src/shared/api/schema.d.ts  (regenerated)
apps/admin/src/staff/api/use-employee-name-matches.ts         (new)
apps/admin/src/staff/model/use-name-checked-submit.ts         (new)
apps/admin/src/staff/ui/duplicate-name-warning.tsx            (new, + spec)
apps/admin/src/staff/ui/create-employee-form.tsx, edit-employee-form.tsx (+ specs)
apps/admin/src/staff/pages/create-employee-page.tsx, apps/admin/src/staff/ui/employee-edit-panel.tsx
```

**Structure Decision**: existing staff module and admin `staff/` business folder; nothing new at top level.

## Complexity Tracking

None.
