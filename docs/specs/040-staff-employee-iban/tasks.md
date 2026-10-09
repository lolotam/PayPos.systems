# Tasks: Employee IBAN — set and read (masked by default)

**Input**: `docs/specs/040-staff-employee-iban/` — spec.md, plan.md, research.md, data-model.md,
contracts/employee-iban-api.md, quickstart.md.

**Tests are mandatory** (`CLAUDE.md` §9): written first, failing before the code exists.

Format: `- [ ] Tnnn [P?] [USn?] description — path`.

## Phase 1: Setup

- [ ] T001 Add the internal workspace dependency `"@pospay/domain": "workspace:*"` to `apps/admin/package.json` and run `pnpm install` (lockfile updated; no external library).

## Phase 2: Foundational (blocks every story)

### Shared IBAN value logic (`packages/domain`)

- [ ] T002 [P] Write failing unit tests `packages/domain/src/__tests__/iban.spec.ts`: normalisation (spaces, tabs refused, lower case, Arabic-Indic ٠–٩ and Persian ۰–۹ digits); per country KW 30 `4!a22!c`, SA 24 `2!n18!c`, AE 23 `3!n16!n`, BH 22 `4!a14!c`, QA 29 `4!a21!c`, OM 23 `3!n16!c` — valid, length −1/+1, wrong BBAN shape; non-GCC (`GB`, `EG`, `DE`) → country error; registry example `KW81CBKU0000000000001234560101` valid; every single-digit change of a valid IBAN and every adjacent swap of two different digits refused by the checksum (a letter in place of a digit is the BBAN shape's job, SC-002 amended 2026-10-09); bank-code extraction (4 letters KW/BH/QA, 2 digits SA, 3 digits AE/OM); mask = last 4. Build valid fixtures for the other five countries by computing their check digits in the test (no real account numbers).
- [ ] T003 [P] Write failing unit tests `packages/domain/src/__tests__/gcc-banks.spec.ts`: ids unique, `id` starts with the lower-case country + `-`, `ibanBankCode` (when present) matches the country's code shape and is unique per country, exactly one `<cc>-other` per country, every country of the six present.
- [ ] T004 Implement `packages/domain/src/iban.ts`: `GCC_IBAN_COUNTRIES`, `normalizeIban`, `validateIban` → `{ ok: true, iban, country, bankCode } | { ok: false, reason: 'FORMAT' | 'COUNTRY' | 'CHECKSUM' }`, `ibanChecksumValid` (character-by-character MOD 97-10), `ibanBankCode`, `maskIban` (last 4), `formatIbanForDisplay` (groups of 4). Arabic JSDoc on every export. Zero dependencies.
- [ ] T005 Implement `packages/domain/src/gcc-banks.ts`: `GCC_BANKS: readonly GccBank[]` `{ id, country, ibanBankCode | null, nameEn, nameAr }` — KW/BH/QA codes only where equal to the SWIFT BIC prefix; SA/AE/OM codes `null`; one `<cc>-other` per country; plus `findGccBank(id)` and `banksForCountry(country)`, `bankForIbanCode(country, code)`. Arabic JSDoc. Export both files from `packages/domain/src/index.ts`.

### Database (`packages/db`)

- [ ] T006 Add `packages/db/schema/staff-ibans.ts` (`employee_ibans`, per data-model.md: PK `(company_id, id)`; UNIQUE `(company_id, employee_id, revision)`; FK `(company_id, business_id, employee_id)` → employees; `set_by` → user; indexes `(company_id, business_id)`, `(set_by)`, `(company_id, iban) WHERE iban IS NOT NULL`; CHECKs: `revision > 0`, the three bank fields all NULL or all NOT NULL, the per-country `iban` regex from spec.md, `bank_id ~ '^[a-z]{2}-[a-z0-9-]{1,40}$'`, `left(bank_id,2) = lower(left(iban,2))`, holder name 1–100 after trim, reason 1–500 after trim). One-line comments on non-obvious columns. Export from `packages/db/schema/index.ts`.
- [ ] T007 Generate the table migration `packages/db/migrations/NNNN_2026-10-09_employee-ibans.sql` with drizzle-kit (journal + snapshot), then a custom RLS migration `NNNN_2026-10-09_employee-ibans-rls.sql`: `ENABLE` + `FORCE ROW LEVEL SECURITY`; `employee_ibans_select` FOR SELECT TO pospay_app USING `company_id = app_company_id()`; `employee_ibans_insert` FOR INSERT TO pospay_app WITH CHECK same; `GRANT SELECT, INSERT ON employee_ibans TO pospay_app` — no UPDATE, no DELETE. Drift check prints "No schema changes".
- [ ] T008 Update the grant allowlist in `packages/db/src/__tests__/privileges.spec.ts` (and `packages/db/test/employee-grants.ts` if it enumerates staff tables).

### Contracts, errors, i18n, redaction

- [ ] T009 [P] Add `packages/contracts/src/staff/employee-iban.ts`: `setEmployeeIbanInput` (strict: `iban` string ≤ 64 | null, `bank_id` string ≤ 48 | null, `holder_name_en` string ≤ 200 | null, `reason` trim 1–500, `expected_revision` int ≥ 0; refine: the three nullable fields all null or all strings), `employeeIbanView`, `employeeIbanHistoryQuery` (`cursor` int ≥ 1 optional, `limit` 1–100 default 20), `employeeIbanHistoryPage`; meta ids. Add `employee-iban-openapi.ts` (GET, GET history, PUT; descriptions state masking and uniform 404) and register it and the exports in the contracts index/openapi registry. Contract tests in `packages/contracts/src/__tests__/employee-iban.spec.ts`.
- [ ] T010 [P] Add error codes to `apps/api/src/shared/errors.ts`: `IBAN_FORMAT_INVALID` 400, `IBAN_COUNTRY_NOT_ALLOWED` 400, `IBAN_CHECKSUM_INVALID` 400, `IBAN_BANK_INVALID` 400, `IBAN_HOLDER_NAME_INVALID` 400, `EMPLOYEE_IBAN_ALREADY_USED` 409, `EMPLOYEE_IBAN_REVISION_CONFLICT` 409, with ar/en messages in `packages/i18n` (new `employee-iban-catalog.ts`, registered in `ar.ts` / `en.ts`). Messages: "only Kuwait and GCC bank accounts are accepted", "the IBAN check digits do not match — re-check the number", "the bank does not match the IBAN", "enter the account holder's name in English", "this IBAN is already registered to another employee in the company".
- [ ] T011 [P] Redaction in `packages/observability/src/redaction.ts`: add `iban`, `holdername` to `SECRET_SUFFIXES`; in `sanitize`, replace IBAN-shaped tokens of KW/SA/AE/BH/QA/OM (spaced or not) in free text. Tests in `packages/observability/src/__tests__/leak-paths.spec.ts`: keys `iban`, `employee_iban`, `holder_name_en` at depth and in arrays redacted; `iban_last4` kept; IBAN inside a message string redacted; ordinary error codes and UUIDs untouched; `redactSecrets` also drops `iban` keys. Make sure the validation pipe's error `details` for these routes never echo the received IBAN or holder name (test).

### Staff domain + ports

- [ ] T012 Write failing tests `apps/api/src/modules/staff/domain/__tests__/employee-iban.spec.ts`: holder-name rules (trim, collapse spaces, 1–100, `^[A-Za-z][A-Za-z .'-]*$`, Arabic refused); bank must exist, be of the IBAN's country, and match a known bank code (else `IBAN_BANK_INVALID`); unknown-code IBAN accepts any bank of its country incl. `<cc>-other`; clear (all null) vs set; reason 1–500; `expected_revision` ≠ current → conflict; no-op detection (same IBAN+bank+holder; clear when already clear/never set); revision +1; audit snapshot shape `{ entry_id, revision, iban_last4, bank_id, cleared }`.
- [ ] T013 Implement `apps/api/src/modules/staff/domain/employee-iban.ts` (imports only `@pospay/domain`): `EmployeeIbanError` (codes above + `VALIDATION_FAILED` `NOT_FOUND` `FEATURE_DISABLED` `TRANSACTION_RETRY_REQUIRED`; message never carries the IBAN), `validateIbanEntry(input, banks)`, `nextIbanEntry(current, terms, id, employeeId, userId, expectedRevision)` → entry or `null` (no-op), `ibanAuditSnapshot(entry)`. Full Arabic JSDoc.
- [ ] T014 Add `apps/api/src/modules/staff/ports/employee-iban-transactions.port.ts` (transaction with `loadCurrent`, `ibanUsedByOtherEmployee`, `save`; `run(context, work)`; ids port) with one-line Arabic doc per method.

## Phase 3: User Story 1 — the owner records bank details (P1) 🎯 MVP

**Independent test**: set valid details as the owner and read them back in full; audit holds last 4 only.

- [ ] T015 [US1] Write failing integration tests `apps/api/src/modules/staff/__tests__/set-employee-iban.spec.ts` IB-01, IB-02, IB-03, IB-06, IB-13 (follow `set-salary.spec.ts` and `salary.fixture.ts`): first set → revision 1, history row, one audit row whose JSON contains neither the full IBAN nor the holder name; normalised storage; each invalid input → its named error and nothing written; same values → no row, no audit; bank mismatch / unknown / other country.
- [ ] T016 [US1] Implement `apps/api/src/modules/staff/use-cases/set-employee-iban/set-employee-iban.usecase.ts` (one-line Arabic comment above the class; no SQL, no arithmetic, no `Date.now()`; ids injected; bank list injected via constructor from `@pospay/domain` `GCC_BANKS`).
- [ ] T017 [US1] Implement `apps/api/src/modules/staff/persistence/employee-iban-access.adapter.ts` (salary access + `readEmployeeManagementAccess` / lock functions from `../../identity/index.ts`) and `persistence/drizzle-employee-iban-transactions.ts`: `withTenant`; `lockEmployeeSalaryAccess` → employee `FOR UPDATE` (non-deleted, business match) → branch list → manage check (else `NOT_FOUND`) → feature check; load current (max revision); duplicate lookup (BR-006: latest entry per other non-deleted employee of the company with `iban = $1`); `INSERT` row; `appendAuditLog` (`entity 'employee_iban'`, `action 'iban.set' | 'iban.cleared'`, `ibanAuditSnapshot`); map 40001/40P01/55P03 to `TRANSACTION_RETRY_REQUIRED`, unique violation on `(company_id, employee_id, revision)` to the revision conflict. No `runIdempotent`.
- [ ] T018 [US1] Implement `apps/api/src/modules/staff/queries/employee-iban.query.ts` (one-line comment: employee record IBAN section): employee + branches, access (full read via salary read, masked via `manage:employees:business`), uniform `null` → 404, feature after access; latest entry; select full columns only when full read, else `right(iban, 4)` only; parse with `employeeIbanView`.
- [ ] T019 [US1] Implement `apps/api/src/modules/staff/http/employee-iban.controller.ts` (`@Controller('businesses/:businessId/employees/:employeeId/iban')`; GET, PUT; `@Authenticated()` + `SelectedCompanyGuard` on each; Zod pipes; map `EmployeeIbanError` → `ApiError`) and wire providers + controller in `apps/api/src/modules/staff/staff.module.ts` (same shape as `salaryProviders`).

## Phase 4: User Story 2 — managers see only the last 4 (P1)

**Independent test**: a `manage:employees:business` holder without the salary read gets the last 4 only.

- [ ] T020 [US2] Add IB-07, IB-08, IB-09 to `set-employee-iban.spec.ts`: masked reader — body has `iban`, `bank_id`, `holder_name_en`, `set_by` null and the raw response text contains no full IBAN or holder name; masked reader PUT and history → 404; no access / foreign tenant / foreign business / deleted employee → identical 404 on GET, history and PUT; Device refused; feature off.
- [ ] T021 [US2] Write `apps/api/src/modules/staff/__tests__/employee-iban-rls.spec.ts`: cross-tenant SELECT = 0 rows; cross-tenant INSERT rejected; FK to another tenant's / another business's employee rejected; UPDATE and DELETE not permitted for `pospay_app`.
- [ ] T022 [US2] Write `apps/api/src/modules/staff/__tests__/employee-iban-queries.spec.ts`: result shape (full vs masked) and `EXPLAIN ANALYZE` index use for the current-entry read, the history page and the duplicate lookup.

## Phase 5: User Story 3 — change, clear, trace (P2)

**Independent test**: change, clear, then read the history in full.

- [ ] T023 [US3] Add IB-04, IB-05, IB-10, IB-11 to `set-employee-iban.spec.ts`: replace → revision 2, audit before/after; stale revision → 409; clear → new revision with null fields, view NOT_SET, `action 'iban.cleared'`; clear again → no-op; history newest first, cursor, limit bounds, full-read only.
- [ ] T024 [US3] Implement `apps/api/src/modules/staff/queries/employee-iban-history.query.ts` (full-read only, else `null` → 404; cursor `revision < $cursor`, `ORDER BY revision DESC LIMIT n+1`; parse with `employeeIbanHistoryPage`) and the `GET …/iban/history` route in the controller.

## Phase 6: User Story 4 — one IBAN, one employee (P2)

**Independent test**: the same IBAN on a second employee is refused without identity.

- [ ] T025 [US4] Add IB-12 to `set-employee-iban.spec.ts`: other employee in another business of the same company holds X → 409 `EMPLOYEE_IBAN_ALREADY_USED`, error body holds no id/name/business; after the other changes/clears or is soft-deleted → accepted; X in another company → accepted; two concurrent PUTs of X for two employees → exactly one 200, one 409; the same employee re-saving her own current IBAN with a new holder name → accepted.

## Phase 7: Admin UI (serves US1–US4)

- [ ] T026 [P] Add `apps/admin/src/staff/api/use-employee-iban.ts` (+ `use-employee-iban.spec.tsx`): view query and history query with the salary cache rules (staleTime 0, `refetchOnMount: 'always'`, `retry: false`, removed on unmount and on 403/404), PUT mutation (no Idempotency-Key) invalidating both.
- [ ] T027 [P] Add `apps/admin/src/staff/ui/iban-form.tsx` (+ `iban-form.spec.tsx`): IBAN input (shown grouped by 4, `dir="ltr"`), bank select filtered to the IBAN's country and pre-selected via `bankForIbanCode` (user can change; server is the authority), holder name (English), reason, save and clear actions, instant hint from `validateIban`; react-hook-form + the contract schema; strings via `t()`; logical CSS only.
- [ ] T028 [P] Add `apps/admin/src/staff/ui/iban-history-table.tsx` (revision, IBAN, bank name in the current locale, holder, cleared, date via `format-instant`, actor id, reason).
- [ ] T029 Add `apps/admin/src/staff/ui/employee-iban-section.tsx` (+ `employee-iban-section.spec.tsx`): renders nothing until a fresh successful read after mount; masked → `•••• 1234` or "no IBAN"; full → IBAN, bank, holder, history, and the form only when `can_manage`; then mount it with one added line in `apps/admin/src/staff/ui/employee-record-sections.tsx` after `EmployeeSalarySection`.
- [ ] T030 Add i18n keys for the section, form, history, hints and the clear confirmation in `packages/i18n/src/employee-iban-catalog.ts` (ar + en, same keys).

## Phase 8: Polish & gates

- [ ] T031 Regenerate OpenAPI and clients: `pnpm contracts:openapi`; admin and pos `src/shared/api/schema.d.ts`.
- [ ] T032 Run `pnpm run typecheck`, `pnpm run lint`, `pnpm run lint:docs`, `pnpm run module-map:check`, the drift check, and the tests of `@pospay/domain`, `@pospay/contracts`, `@pospay/observability`, `@pospay/db`, `@pospay/api`, `@pospay/admin`; all green.
- [ ] T033 Check the CLAUDE.md §3.1 doc comments (Arabic JSDoc on new `domain/**`, `ports/**`, `packages/domain` exports; one-liners on use case, queries, schema columns) and the §11 list (no floats, no left/right CSS, no hardcoded strings, no raw client, no deep imports).

## Dependencies

- Phase 2 blocks everything. T004 ← T002; T005 ← T003; T013 ← T012, T004, T005; T017 ← T006–T008, T013, T014.
- US1 (T015–T019) is the MVP. US2 (T020–T022) needs T018–T019. US3 (T023–T024) needs US1. US4 (T025) needs US1.
- Admin (T026–T030) needs T009 and T031's regenerated `schema.d.ts`; T029 needs T026–T028.

## Parallel examples

- T002 ∥ T003 ∥ T009 ∥ T010 ∥ T011 (different packages).
- T021 ∥ T022 after T019.
- T026 ∥ T027 ∥ T028.

## Implementation strategy

MVP = Phase 2 + US1 (owner can set and see the IBAN, audited). Then US2 (masking — required before merge, P1),
US3 (history/clear), US4 (duplicate rule), admin UI, gates. One PR for the whole slice (one use case).
