# Tasks: Employee documents — owner-only by default

**Input**: `docs/specs/039-permissions-documents-owner-default/` — spec.md, plan.md, research.md, data-model.md,
contracts/permission-override-errors.md, quickstart.md.

**Tests are mandatory** (`CLAUDE.md` §9) and come first in each phase; they must fail before the code exists.
No new tenant table → no new RLS negative test; no `queries/` file → no new `EXPLAIN` test.

## Phase 1: Setup

- [x] T001 Generate the custom migration with `pnpm db:generate documents-owner-default --custom` (creates
  `packages/db/migrations/0096_<date>_documents-owner-default.sql`, its snapshot and the `meta/_journal.json` entry;
  check the journal `when` is strictly greater than entry 95)

## Phase 2: Foundational (blocks every story)

- [x] T002 [P] Write the failing reference tests in `packages/db/src/__tests__/role-defaults.spec.ts`: remove
  `read:files:business`, `manage:files:business`, `manage:document-types:company` from the `general_manager`
  expectations and `read:files:business`, `manage:files:business` from `business_manager`; owner keeps all three
- [x] T003 [P] Write the failing eligibility tests in `packages/db/src/__tests__/system-role-policy.spec.ts`: every one
  of the 13 human system roles is eligible for each of the three codes; Device is not; flip
  `['kitchen', 'manage:files:business', false]` to `true`; the follow-up row for `manage:document-types:company` lists
  all 13 human roles
- [x] T004 Fill the migration SQL in `packages/db/migrations/0096_*_documents-owner-default.sql` with an Arabic header
  comment and exactly: `DELETE FROM role_permissions WHERE role_owner_key = 'global' AND company_id IS NULL AND role_id IN
  ('01920000-0000-7000-8000-000000000102','01920000-0000-7000-8000-000000000104') AND permission_code IN
  ('read:files:business','manage:files:business','manage:document-types:company');` (idempotent; nothing else)
- [x] T005 In `packages/db/src/role-defaults.ts`: set `'manage:files:business'`, `'read:files:business'` and
  `'manage:document-types:company'` to `['owner']` with an Arabic comment citing the owner decision 2026-10-09
  (DOC-Q2 + S014-GRANTS, spec 039); add and export `OWNER_GRANTED_PERMISSIONS = ['read:files:business',
  'manage:files:business','manage:document-types:company'] as const satisfies readonly Permission[]` with Arabic JSDoc
  (eligible for every human role, granted only by the owner)
- [x] T006 In `packages/db/src/system-role-policy.ts`: make `OWNER_GRANTED_PERMISSIONS` eligible for every human role
  (same pattern as `SCHEDULE_PERMISSIONS`); remove `'manage:document-types:company'` from the `business_manager`
  entry of `optional`; Device stays forbidden (codes already in `deviceForbidden`); export the list from
  `packages/db/src/index.ts`

## Phase 3: User Story 1 — owner-only by default (P1)

**Goal**: GM/BM without a grant get 403 on documents and document types; the owner keeps everything.
**Independent test**: ODOC-01…04, ODOC-09.

- [ ] T007 [P] [US1] New integration spec `apps/api/src/modules/identity/__tests__/documents-owner-default.spec.ts`
  (or extend an existing fixture-based spec) covering ODOC-01 owner lists/opens/uploads a document, ODOC-02 GM default →
  403 on `GET/POST /v1/businesses/:b/employees/:e/documents` and on the download of an existing document file,
  ODOC-03 BM default → same 403s, ODOC-04 GM → 403 on `/v1/document-types`
- [x] T008 [P] [US1] Update `apps/api/src/modules/identity/__tests__/role-default-grants.spec.ts`: append the new
  migration to `applyReferenceMigrations` (after 0087) and also delete `manage:document-types:company` global rows
  before re-applying so ODOC-09 proves the stored rows equal `ROLE_DEFAULTS` with overrides, memberships and custom-role
  rows unchanged
- [x] T009 [P] [US1] Update `apps/api/src/modules/files/__tests__/owner-decisions.spec.ts`: stored files rows 6 → 2;
  owner uploads ✅; GM and BM uploads now 403 (rename the test titles accordingly)
- [x] T010 [P] [US1] Update `apps/api/src/modules/staff/__tests__/employee-documents-http.spec.ts` and any staff /
  files / worker test that relied on a manager holding files by default: give the actor an explicit personal ALLOW
  (seeded as owner) or use the owner, keeping each test's original intent
- [x] T011 [P] [US1] Update `apps/admin/src/permissions/ui/role-defaults.spec.tsx` fixture: business manager defaults
  no longer contain `manage:files:business` / `read:files:business`

## Phase 4: User Story 2 — the owner grants to a chosen person (P1)

**Goal**: any human role can receive the three codes by personal ALLOW; only the owner can save that ALLOW.
**Independent test**: ODOC-05…07.

- [x] T012 [P] [US2] Domain unit tests in `apps/api/src/modules/identity/domain/__tests__/` for `permissionEditFailure`:
  editor not owner + `effect: 'ALLOW'` + each of the three codes → `'PERMISSION_OWNER_ONLY'`; editor owner → no new
  failure; non-owner DENY and `'REVOKE'`/`'CHECK'` operations → unchanged results; other codes unchanged
- [ ] T013 [P] [US2] Integration in `documents-owner-default.spec.ts`: ODOC-05 accountant with owner-saved ALLOW of
  `read:files:business` at business X → list/open ✅ (`can_manage` false), upload 403, business Y 403; + `manage:files:business`
  → upload/record ✅; ODOC-06 GM with ALLOW `manage:document-types:company` → create type ✅; ODOC-07 a business manager
  holding files by grant and `manage:memberships:business` saving an ALLOW of `read:files:business` for a cashier of
  his business → 403 `PERMISSION_OWNER_ONLY`; owner saving ALLOW for a Device membership → `PERMISSION_ROLE_FORBIDDEN`
- [x] T014 [US2] Add `PERMISSION_OWNER_ONLY: 403` and its list entry in `apps/api/src/shared/errors.ts`; messages in
  `packages/i18n/src/ar.ts` («صاحب الشركة فقط يقدر يمنح الصلاحية دي») and `packages/i18n/src/en.ts` ("Only the company
  owner can grant this permission") — additive only
- [x] T015 [US2] In `apps/api/src/modules/identity/domain/permission-edit.ts`: add `readonly editorIsCompanyOwner:
  boolean` to `PermissionEditContext`; in `permissionEditFailure`, when `operation === 'SAVE'`, `terms.effect ===
  'ALLOW'`, `OWNER_GRANTED_PERMISSIONS` includes the code and `!context.editorIsCompanyOwner` → return
  `'PERMISSION_OWNER_ONLY'` (after the existing FORBIDDEN / self-edit / catalog checks, before eligibility); update the
  return type and the Arabic JSDoc in the same change
- [x] T016 [US2] In `apps/api/src/modules/identity/persistence/permission-editor-context.ts`: compute
  `editorIsCompanyOwner` inside the same transaction after the existing locks, with `canonicalOwnerSql` over the
  editor's memberships (`user_id = editor`) that are active at `now` (`starts_at <= now AND (ends_at IS NULL OR ends_at
  > now)`); fix every other builder of `PermissionEditContext` (e.g. discount-limit context, test fixtures) so typecheck
  passes

## Phase 5: User Story 3 — employee import follows the files right (P2)

**Goal**: regression proof of OD-Q4 = B. **Independent test**: ODOC-08.

- [x] T017 [US3] Integration (in `documents-owner-default.spec.ts` or the import spec family under
  `apps/api/src/modules/staff/__tests__/`): GM default → `POST /v1/businesses/:b/files/uploads` for the xlsx → 403;
  owner → upload ✅ and preview/commit ✅ (seed the READY file like `employee-import.fixture.ts` if the storage fake is
  not wired); GM with owner-saved ALLOWs of `read:files:business` + `manage:files:business` at the business → upload ✅
  then preview ✅

## Phase 6: Polish & documents

- [x] T018 [P] ADR-0025 amendment (`docs/adr/0025-system-role-default-bundles.md`): 13b section — the three codes leave
  GM/BM bundles, eligible on all human roles, owner-only granting with `PERMISSION_OWNER_ONLY`, migration 0096, rollback
  note
- [x] T019 [P] ADR-0031 amendment (`docs/adr/0031-employee-document-file-binding.md`): default holder of the stored
  file permission is the owner; import consequence
- [x] T020 [P] Update spec 028 permission table + DOC-Q2, spec 019 files row, spec 033 MO-Q1 recommendation (recipients
  = holders of `read:files:business` at the employee's business), and `IMPLEMENTATION-PLAN.md` row 13b (import
  consequence)
- [ ] T021 Gates: `pnpm run typecheck`, `lint`, `lint:docs`, `module-map:check`, `@pospay/db` and `@pospay/api` tests,
  `@pospay/admin` tests, drift check "No schema changes"

## Dependencies

T001 → T004. T002/T003 → T005/T006. Phase 2 → Phases 3–5. T012/T013 → T014–T016. T017 needs T005. Polish last.

## Parallel examples

- Phase 2: T002 ∥ T003.
- Phase 3: T007 ∥ T008 ∥ T009 ∥ T010 ∥ T011.
- Phase 6: T018 ∥ T019 ∥ T020.

## Implementation strategy

MVP = Phase 2 + US1 (defaults removed). US2 adds the granting rule; US3 is a regression guard. One PR for all.
