# Implementation Plan: Employee documents — owner-only by default

**Branch**: `feat/p1-13b-documents-owner-default` | **Date**: 2026-10-09 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `docs/specs/039-permissions-documents-owner-default/spec.md` (owner answers
2026-10-09, design D1).

## Summary

`read:files:business`, `manage:files:business` and `manage:document-types:company` leave the general_manager and
business_manager system-role bundles (the owner keeps them), become eligible for a personal ALLOW on all 13 human
roles (never Device), and only the canonical active company owner may save such an ALLOW (`PERMISSION_OWNER_ONLY`).
One idempotent reference-data migration deletes the five global rows. Employee import upload follows the files right,
so managers without a personal grant get 403 on it (owner decision OD-Q4 = B).

## Technical Context

**Language/Version**: TypeScript 6 on Node 24 (ADR-0002)

**Primary Dependencies**: NestJS (Fastify), Drizzle ORM + drizzle-kit, Vitest; no new dependency

**Storage**: PostgreSQL — reference data in `role_permissions` (global rows); no schema change

**Testing**: Vitest unit (`packages/db`, `apps/api` domain); integration on the T2 compose Postgres (ADR-0006)

**Target Platform**: `apps/api` container; `apps/admin` only a test fixture

**Project Type**: modular monolith (web service + admin web app)

**Performance Goals**: unchanged; one extra membership lookup inside the existing locked editor transaction

**Constraints**: expand-only idempotent migration; no runtime role, grant or RLS change; ADR-0025 history rules

**Scale/Scope**: 5 global rows, 1 domain rule, 1 error code, ~10 test files

## Constitution Check

| Principle | Check | Result |
|---|---|---|
| I. One vertical slice | One use case: the document-access defaults and their granting rule | ✅ |
| II. Domain purity | Owner-only rule is a pure check in `domain/permission-edit.ts`; no money | ✅ |
| III. Tenant isolation | No table / RLS change; global reference rows changed by migration (ADR-0025 precedent) | ✅ |
| IV. Boundaries | identity stays the only owner of permission editing; no new import arrow | ✅ |
| V. Tests | Unit + integration ODOC-01…09; migration regression | ✅ |
| VI. Arabic-first | New error message ar/en through `packages/i18n` | ✅ |
| VII. Documented why | Arabic JSDoc on the changed domain function and the new list; ADR-0025/0031 amendments | ✅ |

Post-design re-check: unchanged, ✅.

## Project Structure

### Documentation (this feature)

```text
docs/specs/039-permissions-documents-owner-default/
├── spec.md · owner-questions.ar.md · plan.md · research.md · data-model.md · quickstart.md
├── contracts/permission-override-errors.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/db/
├── migrations/0096_2026-10-09_documents-owner-default.sql   (+ meta/_journal.json entry)
├── src/role-defaults.ts            ROLE_DEFAULTS + OWNER_GRANTED_PERMISSIONS
├── src/system-role-policy.ts       eligibility for every human role
├── src/index.ts                    export OWNER_GRANTED_PERMISSIONS
└── src/__tests__/role-defaults.spec.ts · system-role-policy.spec.ts
apps/api/src/
├── shared/errors.ts                PERMISSION_OWNER_ONLY → 403
└── modules/identity/
    ├── domain/permission-edit.ts   editorIsCompanyOwner + owner-only ALLOW rule (+ unit tests)
    ├── persistence/permission-editor-context.ts   editor canonical-owner flag
    └── __tests__/role-default-grants.spec.ts and the new documents-owner-default.spec.ts
apps/api/src/modules/files/__tests__/owner-decisions.spec.ts
apps/api/src/modules/staff/__tests__/employee-documents-http.spec.ts · employee-import tests
packages/i18n/src/ar.ts · en.ts     error message
apps/admin/src/permissions/ui/role-defaults.spec.tsx
docs/adr/0025, 0031 (amendments) · docs/specs/019, 028, 033 · IMPLEMENTATION-PLAN.md row 13b
```

**Structure Decision**: existing identity module shape; reference data in `packages/db`.

## Complexity Tracking

None.
