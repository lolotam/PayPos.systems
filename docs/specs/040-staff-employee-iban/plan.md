# Implementation Plan: Employee IBAN — set and read (masked by default)

**Branch**: `feat/p1-09b-employee-iban` | **Date**: 2026-10-09 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `docs/specs/040-staff-employee-iban/spec.md` (owner answers 2026-10-09).

## Summary

One use case, `set-employee-iban`, and two read queries (current entry, history) in the `staff` module, copied from
the `set-salary` slice (spec 021). Bank details live in a new append-only tenant table `employee_ibans`. IBAN
validation (GCC countries, registry lengths/shapes, ISO 7064 MOD 97-10) and the GCC bank reference list are pure,
dependency-free value logic in `packages/domain`, shared by the API and the admin form. Access reuses the salary
permissions (full read / manage) and the employee-management permission (last 4 only). Masking is done in SQL;
audit and logs never hold a full IBAN or holder name. Admin gets an IBAN section in the employee record.

## Technical Context

**Language/Version**: TypeScript 6 on Node 22 (local) / 24 (CI)

**Primary Dependencies**: NestJS (Fastify), Drizzle + drizzle-kit, Zod 4, React / Next.js admin, TanStack Query —
all existing; no new library. `apps/admin` gains the internal workspace package `@pospay/domain`.

**Storage**: PostgreSQL — new table `employee_ibans` (RLS, FORCE, SELECT/INSERT only)

**Testing**: Vitest — domain unit (no DB), API integration on the T2 compose Postgres (one cloned DB per spec file,
ADR-0006), RLS negative, query shape + `EXPLAIN ANALYZE`, observability leak paths, admin component/hook tests

**Target Platform**: `apps/api` (Linux container), `apps/admin` (browser)

**Project Type**: modular-monolith web service + admin web app

**Performance Goals**: every request well under 200 ms (one tenant transaction, indexed lookups)

**Constraints**: tenant isolation by RLS; full IBAN never sent to a masked reader, never logged, never audited;
optimistic revision, no Idempotency-Key; the company-row lock serialises IBAN writes (duplicate rule)

**Scale/Scope**: tens to hundreds of employees per company; a handful of revisions per employee

## Constitution Check

| Principle | Check | Result |
|---|---|---|
| I. One vertical slice | one use case (`set-employee-iban`) + its reads; no edits to create/update-employee | PASS |
| II. Domain purity & money | IBAN rules pure in `packages/domain` + `staff/domain`; no arithmetic in the use case; no money | PASS |
| III. Tenant isolation by the DB | `company_id`, PK `(company_id, id)`, ENABLE+FORCE RLS, tenant-qualified FK, negative test, `withTenant()` only | PASS |
| IV. Boundaries machine-enforced | staff → identity via `index.ts` only (existing arrow); domain imports only `packages/domain` | PASS |
| V. Test-backed delivery | domain unit, integration IB-01…IB-13, RLS negative, EXPLAIN, admin tests | PASS |
| VI. Arabic-first RTL | all strings via `packages/i18n` (ar/en), logical CSS, `packages/ui` | PASS |
| VII. Documented why, in Arabic | Arabic JSDoc on `domain/**`, `ports/**`, `packages/domain` exports; one-liners on use case / queries / schema | PASS |
| Security (CLAUDE.md §8) | audit on change; PII redaction; no secrets; encryption deferred by owner decision IB-Q8 | PASS |

Post-design re-check: unchanged — PASS.

## Project Structure

### Documentation (this feature)

```text
docs/specs/040-staff-employee-iban/
├── spec.md  owner-questions.ar.md  plan.md  research.md  data-model.md  quickstart.md
├── contracts/employee-iban-api.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/domain/src/
├── iban.ts                     normalise, validate (GCC), mod-97, bank code, mask
├── gcc-banks.ts                reference list of GCC banks
├── index.ts                    + exports
└── __tests__/iban.spec.ts, gcc-banks.spec.ts

packages/db/
├── schema/staff-ibans.ts       employee_ibans
├── schema/index.ts             + export
├── migrations/NNNN_2026-10-09_employee-ibans.sql, NNNN_2026-10-09_employee-ibans-rls.sql (+ journal/meta)
└── src/__tests__/privileges.spec.ts   + grants

packages/contracts/src/staff/
├── employee-iban.ts            SetEmployeeIbanInput, EmployeeIbanView, EmployeeIbanHistoryQuery/Page
└── employee-iban-openapi.ts    (+ registration in the openapi registry and index.ts)

packages/i18n/src/
├── employee-iban-catalog.ts    section, form, history, errors (ar/en); bank names are reference data in gcc-banks.ts
└── ar.ts, en.ts                + registration

packages/observability/src/redaction.ts (+ __tests__/leak-paths.spec.ts)

apps/api/src/
├── shared/errors.ts            + 7 codes
└── modules/staff/
    ├── domain/employee-iban.ts (+ __tests__/employee-iban.spec.ts)
    ├── ports/employee-iban-transactions.port.ts
    ├── use-cases/set-employee-iban/set-employee-iban.usecase.ts
    ├── persistence/drizzle-employee-iban-transactions.ts, employee-iban-access.adapter.ts
    ├── queries/employee-iban.query.ts, employee-iban-history.query.ts
    ├── http/employee-iban.controller.ts
    ├── staff.module.ts         + wiring
    └── __tests__/set-employee-iban.spec.ts, employee-iban-rls.spec.ts, employee-iban-queries.spec.ts

apps/admin/
├── package.json                + "@pospay/domain": "workspace:*"
├── src/shared/api/schema.d.ts  regenerated
└── src/staff/
    ├── api/use-employee-iban.ts (+ spec)
    └── ui/employee-iban-section.tsx, iban-form.tsx, iban-history-table.tsx (+ specs),
        employee-record-sections.tsx (+1 line)

apps/pos/src/shared/api/schema.d.ts   regenerated
```

**Structure Decision**: the existing modular-monolith layout (`CLAUDE.md` §2, `CLAUDE.architecture.md` §3); the
slice copies the salary slice file for file.

## Complexity Tracking

| Choice | Why needed | Simpler alternative rejected because |
|---|---|---|
| IBAN logic in `packages/domain` (shared kernel) | the admin form pre-selects the bank and hints the format with the same function the server uses | duplicating it in the admin re-implements a rule in the browser (CLAUDE.md §11); staff/domain cannot be imported by admin |
| append-only table instead of a current row | owner IB-Q3 = keep full history, immutable | an UPDATE-able current row loses old IBANs |
