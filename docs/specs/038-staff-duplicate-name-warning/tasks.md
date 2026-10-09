---

description: "Tasks for 038 — duplicate-name warning on create / update employee"
---

# Tasks: Duplicate-name warning on create / update employee

**Input**: `docs/specs/038-staff-duplicate-name-warning/` — spec.md, plan.md, research.md, data-model.md,
contracts/employee-name-matches.md, quickstart.md

**Tests are MANDATORY** (`CLAUDE.md` §9). No `domain/` function and no new tenant table in this slice, so there is no
domain unit task and no new RLS suite; the `queries/` file gets its result-shape + `EXPLAIN ANALYZE` test, and the
integration test proves another tenant's / business's same-name employee is never returned.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [ ] T001 Confirm the T2 compose Postgres is up (`docker ps`) and shared packages build (`pnpm --filter "@pospay/contracts..." --filter "@pospay/i18n..." build`); no file change.

---

## Phase 2: Foundational (contract + query + route — blocks every story)

- [ ] T002 [P] Write failing contract tests in `packages/contracts/src/staff/employee-name-matches.spec.ts` (co-located, like `attendance-correction.spec.ts`): strict input refuses unknown keys; `name_en` is `nameEn` ("trim, 1–255"); `name_ar` is `nameAr.nullable().optional()`; `exclude_employee_id` is `employeeInputId.optional()` (lower-cases); response `matches` max 10 items `{ id, name_en, name_ar|null, primary_branch_id, role_code }`, `visible_total` and `hidden_count` non-negative integers.
- [ ] T003 Create `packages/contracts/src/staff/employee-name-matches.ts` (`employeeNameMatchesInput` meta id `EmployeeNameMatchesInput`, `employeeNameMatch`, `employeeNameMatches` meta id `EmployeeNameMatches`, types) and export it additively from `packages/contracts/src/index.ts`.
- [ ] T004 Register `POST /v1/businesses/{businessId}/employees/name-matches` (200 `EmployeeNameMatches`; 400/403 envelopes like the other employee paths) in `packages/contracts/src/staff/staff-openapi.ts`; run `pnpm contracts:openapi` and regenerate `apps/admin/src/shared/api/schema.d.ts` and `apps/pos/src/shared/api/schema.d.ts` the same way the previous staff slices did.
- [ ] T005 Write failing integration tests in `apps/api/src/modules/staff/__tests__/employee-name-matches.spec.ts` (fixtures modelled on `employee-list.spec.ts` / `employees.fixture.ts`, T2 Postgres, cloned DB): see story tasks T008, T012, T015 for the scenario list; plus result shape (exact keys) and `EXPLAIN (ANALYZE, FORMAT JSON)` of the exported statement builder asserting `employees_company_business_id_idx` is used.
- [ ] T006 Create `apps/api/src/modules/staff/queries/employee-name-matches.query.ts`: export `employeeNameMatchesStatement(companyId, businessId, input, allowedBranches)` and `employeeNameMatches(tx, companyId, businessId, userId, input, access: EmployeeDetailAccess)`. One-line Arabic comment above the SQL naming the consuming screen (create/edit employee forms). Rules: filter `company_id`, `business_id`, `deleted_at IS NULL`, `id <> exclude` when given; match `key(name_en)=key($name_en)` OR (`name_ar IS NOT NULL` AND `$name_ar IS NOT NULL` AND `key(name_ar)=key($name_ar)`); key = `btrim(regexp_replace(lower(translate(regexp_replace(normalize(x, NFKC), '[ً-ْٰـ]', '', 'g'), 'أإآٱةى', 'ااااهي')), '\s+', ' ', 'g'))` applied to both column and parameter; visible = primary branch and every open (`"to" IS NULL`) attachment inside `allowedBranches` (same predicate as `list-employees.query.ts`); return ≤ 10 visible rows ordered by `name_en, id`, `visible_total`, `hidden_count`, parsed with `employeeNameMatches`. `listScope` → no allowed branch ⇒ `'FORBIDDEN'`; feature off ⇒ `'FEATURE_DISABLED'`. Must not import `domain/` or `use-cases/`; no writes.
- [ ] T007 Add `@Post('name-matches') @HttpCode(200) @Authenticated() @UseGuards(SelectedCompanyGuard)` to `apps/api/src/modules/staff/http/employees.controller.ts`, declared before the `:employeeId` handlers; body through `ZodValidationPipe(employeeNameMatchesInput)`; run the query inside `database.withTenant(actor.companyId, …, { userId })` like `list`; map `'FORBIDDEN'`/`'FEATURE_DISABLED'` to `ApiError`; `NOT_READY` when providers are null.

---

## Phase 3: User Story 1 — warned before creating a same-name employee (P1) 🎯 MVP

**Independent test**: one "سارة" in the business; submit a new "ساره" → warning; "save anyway" creates; "edit name" keeps values.

- [ ] T008 [P] [US1] In `employee-name-matches.spec.ts`: DN-01 (same names match), DN-04 (no match → empty, totals 0), DN-05 (spaces/case "  heba " vs "Heba"; ة/ه; أ/إ/آ/ٱ→ا; ى/ي; diacritics "سَارَة"; tatweel "ســارة"), ended contract still matches (DN-Q4), soft-deleted never matches, null Arabic never matches null Arabic, English-only input compares English only, 11 matches → 10 returned and `visible_total` 11, "سارة" does not match "سارة أحمد" (exact only).
- [ ] T009 [P] [US1] Add i18n keys under `staff` in `packages/i18n/src/en.ts` and `packages/i18n/src/ar.ts` (additive only): `duplicateNameTitle`, `duplicateNameLead` (en "An employee with the same name exists. Add the full four-part name?" / ar «فيه موظفة بنفس الاسم، ضيف الاسم الرباعي؟»), `duplicateNameHidden` (one line: same name in another branch, no details), `duplicateNameMore` (count of further visible matches), `duplicateNameEdit`, `duplicateNameSaveAnyway`.
- [ ] T010 [P] [US1] Create `apps/admin/src/staff/api/use-employee-name-matches.ts`: `useMutation` over the generated client `POST /v1/businesses/{businessId}/employees/name-matches` with `x-company-id`, parsing with `employeeNameMatches`.
- [ ] T011 [US1] Write failing UI tests then create `apps/admin/src/staff/model/use-name-checked-submit.ts` (wraps `onSave`: runs the check, holds pending terms while a warning is open, saves directly on no match or on check error; exposes `confirm()` and `dismiss()`), `apps/admin/src/staff/ui/duplicate-name-warning.tsx` (`role="alert"`, i18n text, visible matches with branch names resolved from the workspace `branches`, hidden line when `hidden_count > 0`, "edit name" focuses `#employee-name-ar`, "save anyway"; logical CSS only; `packages/ui` components) and wire `create-employee-form.tsx` + `create-employee-page.tsx`. Tests in `apps/admin/src/staff/ui/duplicate-name-warning.spec.tsx` and `create-employee-form.spec.tsx`: DN-02, DN-03, DN-04, DN-12, Arabic and English text, workspace switch clears a pending warning.

---

## Phase 4: User Story 2 — warned when renaming to an existing name (P2)

**Independent test**: rename to an existing name → warning without self; change only hire date → no check.

- [ ] T012 [P] [US2] In `employee-name-matches.spec.ts`: DN-06 — `exclude_employee_id` removes the edited employee even when her name is identical; upper-case UUID is lower-cased.
- [ ] T013 [US2] Wire `edit-employee-form.tsx` + `employee-edit-panel.tsx` through `use-name-checked-submit.ts` with `exclude_employee_id = record.id`, calling the check only when trimmed `name_en` or `name_ar` differs from the loaded record. Tests in `edit-employee-form.spec.tsx`: DN-07 (save anyway sends the same PATCH terms incl. `expected_revision`, `branch_ids`, `branch_effective_date`), DN-08 (only non-name change → no check call).

---

## Phase 5: User Story 3 — never leaks, never blocks (P1)

- [ ] T014 [P] [US3] In `employee-name-matches.spec.ts`: DN-09 (same name in another company and in another business of the same company → nothing, totals 0), DN-10 (same name only in a branch outside the caller's allowed branches → `matches` empty, `hidden_count` 1, no id/name in the body).
- [ ] T015 [P] [US3] HTTP tests in `employee-name-matches.spec.ts` (pattern of the existing employee HTTP specs): DN-11 — no grant → 403 `FORBIDDEN`; branch-only ALLOW works; business ALLOW + branch DENY hides that branch's employee into `hidden_count`; staff feature off → `FEATURE_DISABLED`; invalid body → 400; DN-13 — a duplicate-name create (201) and update (200) still succeed through the existing endpoints.

---

## Phase 6: Polish

- [ ] T016 Run gates: `pnpm run typecheck`, `pnpm run lint`, `pnpm run lint:docs`, `pnpm run module-map:check`, `pnpm --filter @pospay/contracts test`, `pnpm --filter @pospay/api test`, `pnpm --filter @pospay/admin test`; fix every failure.
- [ ] T017 Validate `quickstart.md` manual steps against the running admin when possible.

---

## Dependencies

- T002–T007 block all stories. T003 before T004/T006/T010. T006 before T007.
- US1 (T008–T011) is the MVP. US2 (T012–T013) needs T011's hook. US3 (T014–T015) needs only Phase 2.

## Parallel examples

- After T003: T004, T005, T009, T010 in parallel (different files).
- Story tests T008, T012, T014, T015 all append to one spec file — write them in one pass, not in parallel.

## Implementation strategy

Phase 2 → US1 (MVP, demonstrable) → US3 tests (security) → US2 → gates. One PR; no migration; no use case change.
