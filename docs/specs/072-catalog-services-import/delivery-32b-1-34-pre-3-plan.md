# Shared implementation plan: 32b-1 (services import: contracts and pure rules) + 34-pre-3 (business country setting)

**Rows:** `32b-1` (spec 072) and `34-pre-3` (spec 073). **One PR.** **Created:** 2026-11-21, planner lane (PP-204).
**Source pin:** `origin/main` `4d7992afb77badc763f1776cb2f7ea95a19e20ee`. The implementer branches from the current
`origin/main` and re-checks every «exists at the pin» statement of the delivery spec §2 against its own base.
**Requirements:** [delivery-32b-1-34-pre-3-spec.md](delivery-32b-1-34-pre-3-spec.md) (called «DS» below). Canonical
product specs: [072](spec.md), [073](../073-customers-import/spec.md).

Planning only. OQ-2 and OQ-3 are approved. Waleed's verbatim reply (2026-11-21): «اعتمد OQ-2 أ وOQ-3 أ».
[Owner decision record](../073-customers-import/owner-questions.ar.md#قرارات-دولة-النشاط-34-pre-3--oq-2-وoq-3). Implementation is pending.

## 1. Before any brief (manager)

| # | Item | Why | Blocks |
|---|---|---|---|
| 1 | One spec, plan and implementation PR for both rows recorded (PP-212) | DS §9 | cleared |
| 2 | Waleed approved **Medium** | PP-212 | cleared |
| 3 | OQ-2 (أ) approved: `manage:settings:business` on the target business | DS §7 | cleared |
| 4 | OQ-3 (أ) approved: `KW`, `SA`, `AE`, `BH`, `QA`, `OM` | DS §7 | cleared |
| 5 | API-only scope for this delivery | DS §7 | cleared |
| 6 | OQ-1 (unset country) asked. It does not block this PR | DS §7 | 34b-2 only |
| 7 | One independent design round completed and incorporated | §8 and DS §7 | cleared |
| 8 | `roadmap.json`: add the 34-pre-3 row when the work starts (073 «Roadmap trigger») | 073 | nothing |

The country choices are settled for stage 2. Open the single PR after both halves are complete.

## 2. Pipeline

**Medium** under PP-195. Waleed's verbatim decision (2026-11-21): «Medium».
The owner selected it for this combined delivery after a Heavy recommendation. [Decision record](../../owner-decisions.ar.md).

- Plan: Claude Fable 5.2 Medium. The independent Astra 6.2 High design round is complete (§8).
- Implementer: GLM 5.3 Flash via Z.AI Coding Plan in OpenCode (PP-194/PP-204). After coding and tests, the same
  session runs `clean-code-guard` and `test-guard`.
- Review: a different-model whole-diff code review, MergePilot and green `ci-gate` on the exact head and current
  main, under the Medium rules (PP-195/PP-198/PP-202/PP-208). CodeRabbit is optional. Triage published findings.
- Merge: the manager, after the gates (PP-201). No migration is in this PR, so no snapshot step applies.
- Schedule any staging validation separately after merge.

## 3. Fences

**May create or edit only the paths of §5, plus:** `packages/contracts/src/catalog/service.ts` for `export`
keywords only (stage 1, no schema change); and the stage 5 documents (`docs/specs/072-catalog-services-import/spec.md`,
`docs/specs/073-customers-import/spec.md`, the two `owner-questions.ar.md`, `docs/owner-decisions.ar.md`,
`docs/adr/0034-employee-import-framework.md`).

**Must not touch:** `packages/db/**` (no migration, schema, grant, seed, policy); `packages/import-workbooks/**`;
`apps/api/src/shared/import/**`; `apps/api/src/modules/staff/**`; `apps/api/src/modules/settings/**`;
`apps/api/src/modules/customers/**`; `apps/worker/**`; `apps/admin`, `apps/pos`, `apps/menu` except their generated
`src/shared/api/schema.d.ts`; `service-import-price-cell.ts`, `service-import-commission.ts` and their specs (read,
never edited); `docs/module-map.yaml`.

Extend existing tests only where listed in section 5. Preserve their existing assertions.

**Must not add:** a dependency; a workbook parser or any reading of raw xlsx bytes; a test that feeds a hostile or
malformed archive (the reader's defensive tests already exist and stay as they are); a fourth tagged-cell type; a
second whitespace-normalizing expression; a default or guessed country; a `Date.now()` or `randomUUID()` in a use
case; a number that carries money.

**Stop and report, do not improvise,** when: a rule is missing from DS; the
B-11 search finds a reader of a `settings` key; the country write turns out to need a grant or migration; a file
would pass 300 lines or a function 60; the delivery heads past the §7 numbers.

## 4. Stages (CLAUDE.md §1 order: contract → domain → use case → adapters → tests)

**Stage 1: 32b-1 contracts.**
1. `service-import.ts`: DS A-1. Reuse the existing `id`, `responseObject`, `ServicePrice`, `ServiceDurationMinutes`
   and `serviceCommissionRuleView`; export the two that `service.ts` keeps private only if needed, without changing them.
2. Register service-import schemas without paths. Generate once both halves are ready in stage 4.

**Stage 2: 34-pre-3 country contracts and tenancy.**
1. Add reference/country.ts and the typed create settings and country request/response contracts in tenancy/business.ts.
   The change route accepts only `KW`, `SA`, `AE`, `BH`, `QA`, and `OM`. The create settings input reserves the
   `country` key outright (manager disposition 2026-11-21 on OQ-2/B-5): its presence with any value refuses the
   request, every other key passes, no default. Register the PUT request, response and refusals. Keep the change decision
   pure in domain/business-country.ts with Arabic JSDoc.
2. Expose read-for-change and update operations in ports/tenancy-transactions.port.ts with Arabic JSDoc.
3. Read by company_id and id under FOR NO KEY UPDATE. On change, merge only the country key with SQL
   settings || jsonb_build_object('country', value). Use one tenant transaction for read, optional update and audit.
4. The use case locks and reads, decides, then updates and audits only on change. Audit before/after country only.
   Use the existing not-found error when the business is absent.
5. Export the indexed reader from tenancy/index.ts. The reader validates with the shared contracts schema.
6. `http/businesses.controller.ts`: the `PUT` route with `manage:settings:business`, scoped `{ business: 'businessId' }`.
   Thin: validate, call, map.
7. `tenancy.module.ts` wiring. Then the tests of DS §6 «34-pre-3».

**Stage 3 — 32b-1 (catalog domain, pure).**
1. `service-import.ts`: header names (six required, two optional), the three bounds constants of DS A-13 (bytes,
   data rows, columns; no `maxWorksheets` and no `WorkbookBounds` object, which 32b-2 builds), the column and code
   types, the header pre-selection of A-4.
2. `service-import-cells.ts`: the name, duration, category and boolean converters of A-5, taking
   `ServiceImportTaggedCell` from the existing price file.
3. `service-import-duplicates.ts`: the name key through `normalizeServiceCategoryName` (A-9) and the grouping of A-10.
4. `service-import-row.ts`: the mapper of A-6 to A-8, A-11 and A-12, calling the existing price and commission
   parsers and `serviceTerms`. `service.ts`: export the existing rule-to-wire conversion with its Arabic doc; no
   behaviour change.
5. The tests of DS §6 «32b-1», including the vectors file.

**Stage 4 — messages and generated files, once.** `packages/i18n` (A-3); then `pnpm contracts:openapi`; then
`api:generate` in `apps/admin`, `apps/pos` and `apps/menu`. The four generated files are produced by the tools and
never edited by hand.

**Stage 5 — docs in the same PR.** A dated note in 072 `spec.md` (delivery row 32b-1: the reader move and
`tagCells` are shipped, `readHeaderRow` is not built, P-1 to P-4 and P-7 moved to 32b-2), the same one-line note in
the ADR-0034 addendum §3, and a dated note in 073 `spec.md` (the xlsx reader half of 34b-1 is shipped by #871, the
object-bytes reader is not; 34-pre-3 delivered here); preserve the recorded answers to OQ-2/OQ-3 and record any subsequently resolved owner question verbatim in the applicable
`owner-questions.ar.md` files; the PP rows in `docs/owner-decisions.ar.md`. The journey documents follow in their
own docs PR (pipeline step 14).

**Stage 6 — local gates** (PP-113): typecheck, lint, `pnpm lint:docs`, boundaries, `pnpm module-map:check`,
`pnpm migration-chain:check`, `pnpm --filter @pospay/admin api:check`, `pnpm --filter @pospay/pos api:check`, and
this delivery's own tests. Database tests run on the task's own lane, one spec file at a time. The full suite and
the API shards are decided by `ci-gate`. Until it is green the state is «implementation complete, pending `ci-gate`».

## 5. Paths and expected size

Lines are hand-written physical lines after Prettier. «new» = new file.

| Row | Path | Kind | Production | Test |
|---|---|---|---|---|
| 32b-1 | `packages/contracts/src/catalog/service-import.ts` | new | 110 | |
| 32b-1 | `packages/contracts/src/catalog/service-import.spec.ts` | new | | 90 |
| 32b-1 | `packages/i18n/src/service-import.ts` and its wiring line in the catalog screens catalog | new | 66 | |
| 32b-1 | `packages/i18n/src/__tests__/service-import-catalog.spec.ts` | new | | 30 |
| 32b-1 | `apps/api/src/modules/catalog/domain/service-import.ts` | new | 80 | |
| 32b-1 | `…/catalog/domain/service-import-cells.ts` | new | 120 | |
| 32b-1 | `…/catalog/domain/service-import-duplicates.ts` | new | 45 | |
| 32b-1 | `…/catalog/domain/service-import-row.ts` | new | 170 | |
| 32b-1 | `…/catalog/domain/service.ts` | edit | 6 | |
| 32b-1 | `…/catalog/domain/__tests__/service-import.spec.ts` (headers, bounds) | new | | 80 |
| 32b-1 | `…/domain/__tests__/service-import-cells.spec.ts` | new | | 230 |
| 32b-1 | `…/domain/__tests__/service-import-row.spec.ts` | new | | 280 |
| 32b-1 | `…/domain/__tests__/service-import-duplicates.spec.ts` and `service-import-key-vectors.json` | new | | 120 |
| 34-pre-3 | `packages/contracts/src/reference/country.ts` | new | 20 | |
| 34-pre-3 | `packages/contracts/src/tenancy/business.ts` | edit | 30 | |
| 34-pre-3 | `packages/contracts/src/tenancy/business.spec.ts` | new | | 60 |
| 34-pre-3 | `packages/contracts/src/tenancy/business-openapi.ts` (only if T-10 says yes) | new | 40 | |
| 34-pre-3 | `apps/api/src/modules/tenancy/domain/business-country.ts` | new | 45 | |
| 34-pre-3 | `…/tenancy/domain/__tests__/business-country.spec.ts` | new | | 70 |
| 34-pre-3 | `…/tenancy/ports/tenancy-transactions.port.ts` | edit | 30 | |
| 34-pre-3 | `…/tenancy/persistence/tenancy-transactions.ts` | edit | 45 | |
| 34-pre-3 | `…/tenancy/use-cases/set-business-country/set-business-country.ts` | new | 75 | |
| 34-pre-3 | `…/tenancy/queries/business-country.query.ts` | new | 35 | |
| 34-pre-3 | `…/tenancy/http/businesses.controller.ts`, `tenancy.module.ts`, `index.ts` | edit | 41 | |
| 34-pre-3 | `…/tenancy/__tests__/set-business-country.spec.ts` (integration) | new | | 230 |
| 34-pre-3 | `…/tenancy/__tests__/business-country-query.spec.ts` (shape, `EXPLAIN`, other tenant) | new | | 95 |
| 34-pre-3 | the existing create-business integration spec | edit | | 50 |
| both | `packages/contracts/src/openapi-schemas.ts`, `packages/contracts/src/index.ts` | edit | 60 | |
| | **Sub-total 32b-1** | | **about 640** | **about 830** |
| | **Sub-total 34-pre-3** | | **about 380** | **about 505** |
| | **Total** | | **about 1,020** | **about 1,335** |

Not hand-written: `packages/contracts/openapi/openapi.json` and the three `schema.d.ts` files, about 1,000 generated
lines together. Docs of stage 5: about 130 lines, plus these two artifacts (about 420 lines) if they are committed.

The test file names under `__tests__` follow the folders that exist at the pin; the implementer uses the real
neighbouring spec of create-business rather than inventing one.

## 6. Shared files and order

Only `openapi-schemas.ts`, `index.ts`, `openapi.json` and the three `schema.d.ts` are touched by both rows. Every
other path belongs to one row. So the two halves must not run in parallel sessions: one implementer, one branch,
stages in order, generation once at stage 4. A second generation is needed only if a contract changes afterwards.

## 7. Size and cap assessment

| | Production | Test | Hand-written total |
|---|---|---|---|
| 072's estimate for all of 32b-1 (tests and copy included) | | | 500 to 700 |
| Already merged as 32b-1a, 32b-1c, 32b-1d (PR #817, #823, #824 file counts) | 262 | 612 | 874 |
| This PR, 32b-1 remainder | 640 | 830 | 1,470 |
| This PR, 34-pre-3 (API only) | 380 | 505 | 885 |
| **This PR** | **1,020** | **1,335** | **2,355** |

- The historical estimate was already passed by the three merged slices. 32b-1 as a whole ends near 2,340 lines,
  about 3.4 to 4.7 times its estimate. The reasons are visible in the merged work: exhaustive cell cases (the tests
  are 70 percent of it) and the 60-line function cap, which spreads the mapper over four files.
- The brief must state 1,020 production and 1,335 test lines. The pipeline refuses a delivery over twice the brief:
  2,040 and 2,670. No other numeric PR cap was found in `docs/agent-delivery-pipeline.md` at the pin; PP-197 and
  PP-199 set a cap for 48-3 only. If the manager holds a cap not in that file, it applies.
- Every file stays under 300 lines by this plan. The row spec at 280 is the closest; it splits by converter group
  if it grows.
- **Split:** not planned, by the owner's one-PR choice. The repository's own rules would make it two PRs (DS §9).
  If a gate forces a split (for example a review snapshot that truncates), the only clean line is by row, 34-pre-3
  first, each with its own generation; nothing else in §5 crosses the rows.
- A screen for the country (OQ-4 option ب) adds about 300 lines and pushes the PR past 2,650.

## 8. Design debate hand-off (fresh, read-only, one round)

Give the debater exactly: the two artifacts, the pin, and these files at the pin: 072 `spec.md` (D-8, D-9, FR-001,
FR-004 to FR-007, FR-014), 073 `spec.md` (CIM-15, Requirements, Delivery), ADR-0034 addendum §3,
`packages/import-workbooks/src/{import-sheet,xlsx-sheet-reader,xlsx-xml-guard}.ts`,
`apps/api/src/shared/import/tag-cells.ts`, the catalog domain files `service.ts`, `service-validation.ts`,
`service-category.ts`, `service-import-price-cell.ts`, `service-import-commission.ts`, the tenancy files
`index.ts`, `http/businesses.controller.ts`, `use-cases/create-business/create-business.ts`,
`persistence/tenancy-transactions.ts`, `queries/business-time-zone.query.ts`, `packages/contracts/src/tenancy/business.ts`,
`packages/db/src/role-defaults.ts`, and migration `0002_2026-09-23_tenancy-rls.sql`.

Ask it to attack, with a file and line for every finding, and to write no code:

1. Each ◊ default of DS A-5 and T-1 to T-10: is any of them a business rule in disguise that needs an owner?
2. The mapper input of A-12 and the hand-offs P-1 and P-2: can 32b-2 build the join without changing this code?
3. The duplicate key: JavaScript `toLowerCase` against Postgres `lower()` on non-ASCII names; whether the worker of
   32b-3 can share one implementation; whether the vectors are enough.
4. One error per row and column, the in-file duplicate rule for rows that carry other errors, and the order of errors.
5. Money: any path where a number could carry a price, a `FIXED` value or a percent.
6. The country write: the row lock and the database-side merge, the missing revision column (last write wins),
   the audit content, 404 parity, the guard scope, and the unvalidated create path closed by B-5.
7. The reader: null for «not visible» against `{ country: null }` for «unset», and an invalid stored value.
8. Whether anything in this delivery needs a grant, a migration or a module-map arrow after all.
9. The one-PR sequencing of §4 and §6 and the numbers of §7.

Its findings are written back into DS before the brief. A finding that changes a rule 072 or 073 states is not
applied here; it goes to the manager as a question.

## 9. Done

- DS §4 and §5 are met and every test of DS §6 exists and passes locally where it can run.
- Arabic JSDoc on every new `domain/` export and `ports/` method; one line on the use case and above the query's SQL.
- No migration, no new dependency, no new module-map arrow; `module-map:check` and `migration-chain:check` unchanged.
- The PR body names both rows («32b-1 — استيراد الخدمات: العقود والقواعد» and «34-pre-3 — دولة النشاط في إعدادات
  النشاط»), the pipeline and its card answer, the owner steering record, the measured sizes per category against §7,
  the open hand-offs P-1 to P-7, and the Arabic summary with the money and permission flags.
- `ci-gate` green on the exact head; reviews complete on that head.
