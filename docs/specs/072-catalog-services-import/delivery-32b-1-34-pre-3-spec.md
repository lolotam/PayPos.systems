# Shared delivery spec: 32b-1 (services import: contracts and pure rules) + 34-pre-3 (business country setting)

**Rows:** `32b-1` (plan row 32b, spec 072) and `34-pre-3` «دولة النشاط في إعدادات النشاط» (plan row 34b, spec 073).
**Created:** 2026-11-21. **Status:** delivery draft after independent design review. OQ-2 and OQ-3 have owner answers. Implementation is pending.
**Source pin:** `origin/main` `4d7992afb77badc763f1776cb2f7ea95a19e20ee`. Every code file, line and commit cited
here was read at that pin with `git show`; `docs/agent-delivery-pipeline.md` and `docs/owner-decisions.ar.md` were
read there by section, not end to end. The worktree this file sits in is older than the pin and is not the source.
**Companion:** [delivery-32b-1-34-pre-3-plan.md](delivery-32b-1-34-pre-3-plan.md).

This document does **not** replace a product spec. The canonical specs stay
[072 spec.md](spec.md) and [073 spec.md](../073-customers-import/spec.md), with their audit records
[072 owner-questions.ar.md](owner-questions.ar.md) and
[073 owner-questions.ar.md](../073-customers-import/owner-questions.ar.md). Where this document and a canonical spec
disagree, the canonical spec wins, except for the reconciliations of §2, which record what `main` actually contains.

## 1. Why one delivery

Owner steering relayed by the manager thread on 2026-11-21: «SAME PR SAME PLANE SAME SPEC». One PR, one plan and
one delivery spec carry both rows. The two rows share no behaviour. They share only four generated or registry
files (plan §6). §9 lists the repository rules this choice overrides and what the manager must record first.

## 2. What already exists on `main` (do not rebuild)

| Piece | Where it is at the pin | Shipped by | Consequence |
|---|---|---|---|
| Price cell → 3-decimal KWD text and mills | `apps/api/src/modules/catalog/domain/service-import-price-cell.ts` (`parseServiceImportPriceCell`, type `ServiceImportTaggedCell`) | PR #817 (32b-1a), merge `f20c08061` | Reused as is |
| Commission cells → service rule | `…/catalog/domain/service-import-commission.ts` (`parseServiceImportCommissionCells`) | PR #824 (32b-1d), merge `b809075c0` | Reused as is. Its PR body leaves the transport code of its `REQUIRED` reason to the row mapper |
| Generic cell tagging | `apps/api/src/shared/import/tag-cells.ts` (`tagCells`, `TaggedImportCell`) | PR #823 (32b-1c), merge `ed5ee5e15` | Reused as is |
| The xlsx reader, zip guard, XML guard, `readSheet`, `ImportCell`, `INVALID_CELL` | package `packages/import-workbooks` (`@pospay/import-workbooks`); `apps/api/src/shared/import/import-sheet.ts` and `xlsx-sheet-reader.ts` only re-export it; staff keeps a thin wrapper with its own bounds and error type | PR #871 (47-1b, package import preview), commit `3fc65c268`, the only commit in the package's history | The reader move that 072 gave to 32b-1 and that `PP-103.1` (CI-T1) gave to 34b was **done by neither**. It is not work of this delivery. The object-bytes reader was **not** moved (§8, P-4) |
| Per-field service validators, `serviceTerms`, exported `toCommissionRule` | `…/catalog/domain/service-validation.ts`, `service.ts` | PR #757 (32b-pre-1), `185f328f3` | Reused as is |
| Category key | `serviceCategoryKey`, `normalizeServiceCategoryName` in `…/catalog/domain/service-category.ts` | PR #721 (32b-cat-1) | Reused for the category cell and for the duplicate key |
| Service form, list, filter; branch category actions | admin | PR #771 (32b-pre-2), PR #1139 (32b-cat-3b-3, `81c336a07`) | The 32b-1 blockers of 072 are met |
| ADR-0034 services addendum, module-map rows | `docs/adr/0034-employee-import-framework.md` | PR #706 (32b-0), `474145c84` | Governs D-1 to D-9 |
| Customer profile fields | — | PR #766 (34-pre-1), `4a9898818` | 34-pre-3 is next in the corrected order 34-pre-1 → 34-pre-3 → 34-pre-2 → 34b |

Findings that correct older text:

- **`readHeaderRow` does not exist** anywhere at the pin, and it is not needed. `readWorkbookMatrix` now returns the
  whole first-sheet matrix before any header check, so the header row is `matrix[0]`. 072 FR-001 and ADR-0034
  addendum §3 describe a separate guarded header read; that text predates #871.
- **32b-1b** was drafted in a previous task session as duration and category cell converters and tests. The source
  pin has neither file. Reuse applicable ideas with current A-5 acceptance, including duration text such as `090`.
- **The reader returns no `formats` matrix.** 072 FR-005 requires `tagCells(matrix, formats)` to receive number
  formats from the same ExcelJS pass. `readWorkbookMatrix` returns cells only, so on the real path `percentFormat`
  is never true and a `20%` cell would be read as 0.2 percent. This is reader work, outside this delivery (§8, P-1).
- Three structurally identical tagged-cell types exist (`TaggedImportCell`, `ServiceImportTaggedCell`,
  `ServiceImportCommissionCell`). The domain cannot import `shared/`, so a domain copy is required; a fourth is not.

## 3. Scope

**In — 32b-1 remainder:** the service-import contracts and their OpenAPI schema registration; the generated OpenAPI
document and clients; ar/en messages for the row error codes and column names; the pure converters for the name,
duration, category and boolean cells; the header pre-selection for the two optional legacy columns; the row mapper
that runs every field validator and calls `serviceTerms` for an error-free row; the canonical duplicate key and the
in-file duplicate detection; the services workbook bounds as constants; unit tests.

**In — 34-pre-3:** a typed `country` inside the existing `businesses.settings`; its contract; validation at create
and at change; one authorized change route; an audit row; a reader exported from `apps/api/src/modules/tenancy/index.ts`;
tests.

**Out:** any database read, migration, grant, seed or data step; the template; the preview, rows, status and commit
routes; the worker; any screen; the check against services already stored (32b-2); reader changes (the formats
matrix); the calling-code reference and every customer-import behaviour (34b-2); self-registration (CI-T10,
`PP-107.2`); the gender activation and reception UI (34-pre-2); a backfill or default country for any business.

## 4. 32b-1 requirements

Sources: 072 FR-001, FR-004 to FR-007, FR-014, D-8, D-9, SI-Q1 to SI-Q4, SI-Q6 to SI-Q9; ADR-0034 addendum §3.

- **A-1 Contracts** (`packages/contracts/src/catalog/service-import.ts`): the column enum (the eight headers and
  `unexpected_column`), the twelve row error codes of 072 «API contract», the row error `{ row ≥ 2, column, code }`,
  the template, the preview input, the normalized row of D-9 and FR-014, the preview with its first 100 rows and
  `next_cursor`, the rows page and its query (limit 1 to 100), the commit input and acceptance, and the status.
  Money is the existing 3-decimal string; `commission_value` is an integer (basis points), a 3-decimal string or null.
  The worker job schema and the event payload are not added here (32b-3, 32b-5).
- **A-2 OpenAPI:** the schemas are registered; **no path is registered**, because no route exists until 32b-2 and
  32b-5 and a published path would describe an endpoint that answers 404. Each later PR registers its own paths.
- **A-3 Messages:** ar and en text for the twelve row codes and nine column names, in `packages/i18n`, no string
  elsewhere. The request-level `IMPORT_*` messages already exist and are entity-neutral (`employee-import.ts`
  lines 70 to 98); they are not duplicated. No API error code is added.
- **A-4 Header pre-selection (FR-001, SI-Q8):** a pure function takes the header texts of `matrix[0]` and returns the
  expected header list using the same header trimming as readSheet: the six required headers plus whichever of `duration_minutes` and `category` are present.
  `readSheet` then enforces the exact set, so a missing required header, an unknown header or a duplicate still
  refuses the workbook with `IMPORT_HEADER_INVALID`. An absent optional column reads as no value for every row.
- **A-5 Cell rules.** Every converter takes a tagged cell and returns a value or a named refusal. An `error` cell is
  `IMPORT_CELL_INVALID` on its own column in every column and never becomes a default (072 SIT-16).

  | Column | blank | `text` | `numeric` | `boolean` | `numeric-unrepresentable` |
  |---|---|---|---|---|---|
  | `name_en` | `IMPORT_REQUIRED_CELL` | trimmed; `validateServiceNameEn`, else `IMPORT_NAME_INVALID`; empty after trim is `IMPORT_REQUIRED_CELL` | its text is the name ◊ | `IMPORT_NAME_INVALID` ◊ | `IMPORT_NAME_INVALID` ◊ |
  | `name_ar` | no Arabic name | trimmed; `validateServiceNameAr`, else `IMPORT_NAME_INVALID`; empty after trim is no Arabic name | its text is the name ◊ | `IMPORT_NAME_INVALID` ◊ | `IMPORT_NAME_INVALID` ◊ |
  | `price` | existing `parseServiceImportPriceCell`, unchanged | | | | |
  | `duration_minutes` | no duration | ASCII digits only, then `validateServiceDuration` (1 to 600); a fraction, a sign, exponent text, `0`, `601` are `IMPORT_DURATION_INVALID`; leading zeroes are allowed (090 represents 90) | same rule on its text (a numeric `1e2` arrives as `100`) | `IMPORT_DURATION_INVALID` | `IMPORT_DURATION_INVALID` |
  | `category` | no category | matched by `serviceCategoryKey` against the open categories given; no match is `IMPORT_CATEGORY_NOT_FOUND` | matched by its text ◊ | `IMPORT_CATEGORY_NOT_FOUND` ◊ | `IMPORT_CATEGORY_NOT_FOUND` ◊ |
  | `commission_rule`, `commission_value` | existing `parseServiceImportCommissionCells`, unchanged; reasons map `CELL_INVALID` → `IMPORT_CELL_INVALID`, `RULE_INVALID` → `IMPORT_COMMISSION_RULE_INVALID`, `VALUE_INVALID` → `IMPORT_COMMISSION_VALUE_INVALID`, `REQUIRED` → `IMPORT_REQUIRED_CELL` on `commission_value` ◊ | | | | |
  | `counts_toward_threshold` | `true` (SR-005) | `true`/`false`, `yes`/`no`, `نعم`/`لا`, case-insensitive after trim; else `IMPORT_BOOLEAN_INVALID` | `IMPORT_BOOLEAN_INVALID` | its value | `IMPORT_BOOLEAN_INVALID` |

  ◊ = 072 is silent. The value shown is this plan's default, taken from the nearest precedent (the employee import
  accepts a number as a name; «This cell is required» describes a missing
  value). The Heavy debate confirms or rejects each one; a rejected one becomes a technical card for Waleed (§7, T-1
  to T-3). None of them is an owner business answer.
- **A-6 Unexpected data:** a non-blank cell beyond the last header is `IMPORT_COLUMN_UNEXPECTED` on
  `unexpected_column`, once per row (the staff rule, `employee-import-row.ts` line 171).
- **A-7 Row mapper (D-8):** every field is checked separately and every bad column of a row is reported, at most one
  error per row and column, in sheet order. Only a row with no error goes through `serviceTerms` as the final check.
  A `ServiceError` there maps `SERVICE_NAME_INVALID` → `name_en`/`IMPORT_NAME_INVALID`, `SERVICE_PRICE_INVALID` →
  `price`/`IMPORT_PRICE_INVALID`, `SERVICE_COMMISSION_RULE_INVALID` → `commission_value`/`IMPORT_COMMISSION_VALUE_INVALID`,
  `SERVICE_DURATION_INVALID` → `duration_minutes`/`IMPORT_DURATION_INVALID`, `SERVICE_CATEGORY_NOT_FOUND` and
  `SERVICE_CATEGORY_CLOSED` → `category`/`IMPORT_CATEGORY_NOT_FOUND`; any other error is rethrown.
- **A-8 Normalized rows (D-9, FR-014):** only error-free rows are returned, in sheet order, as
  `{ row, name_en, name_ar, price, duration_minutes, category_id, category_name_en, commission_rule, commission_value,
  commission_rule_defaulted, counts_toward_threshold }`. `category_name_en` is the stored name of the matched category,
  not the cell text. No JavaScript number carries money.
- **A-9 Duplicate key (FR-007, SI-Q1, SI-Q2, SI-Q9):** the key of a service name is the name trimmed, each run of
  whitespace collapsed to one space, lower-cased: the same recipe as `serviceCategoryKey`, through the same
  normalizer, not a second regular expression. `name_ar` and the category are not part of it.
- **A-10 In-file duplicates:** every row whose key equals another row's key is `IMPORT_DUPLICATE_IN_FILE` on
  `name_en`: **all** rows of the group, not only the later ones, and all of them leave the normalized rows. A key
  exists for every row whose `name_en` passed its validator, even when another column of that row is wrong.
- **A-11 Hand-off to 32b-2:** the mapper returns each row's key, so 32b-2 adds `IMPORT_SERVICE_EXISTS` against stored
  services without deriving the key again. The existing API catalog normalizer defines the key for this slice. Test vectors cover
  Arabic, NBSP and mixed whitespace, Turkish dotted I, Greek and composed/decomposed spellings. 32b-2 and 32b-3 own
  boundary-safe sharing or verification of SQL parity on Postgres. Vectors alone do not establish Unicode parity.
  Do not add Unicode normalization or accent folding.
- **A-12 Mapper input, fixed here:** `{ headers: string[], rows: { row: number, cells: tagged cell[] }[] }` plus
  `{ openCategories: { id, name_en }[] }`. `row` is the original sourceRows entry. 32b-2 supplies aligned formats and sourceRows after blank rows are removed or columns are reordered. Closed categories are not passed, so
  a closed one is simply not found (FR-004).
- **A-13 Bounds (ADR-0034 addendum §3):** services constants are 2 MiB, 500 data rows, 10 columns (eight headers and
  the two-column margin). `WorkbookBounds` also needs `maxWorksheets`; it depends on how many reference sheets the
  template has, so 32b-2 sets it with the template and this delivery does not build the bounds object. Restated margin: `XLSX_EXPANSION_BUDGET` is 65,536; six times the services grid is
  6 × 502 × 10 = 30,120, leaving 35,416 positions for reference sheets, and the other-sheet row ceiling at 10 columns
  is 6,553. The margin holds for the grid. It holds for the template only if its reference sheets stay inside both
  numbers, which is a condition on 32b-2 (§8, P-3). No guard, limit or parser changes.

## 5. 34-pre-3 requirements

Sources: 073 CIM-15 and Requirements; CI-T9 = `PP-107.1`, Waleed's answer «107.1 ب - الاعدادات العامة للنشاط»;
the manager's 17:52 approval and 17:58 identifier correction of 2026-11-01 (073 owner-questions.ar.md).

- **B-1 Where the value lives:** the `settings` jsonb column of the `businesses` table
  (`packages/db/schema/tenancy.ts` line 74), owned by `tenancy`. It is **not** the `business_settings` table of the
  `settings` module, and not that table's `tax_rule.country_code`, which 073 excludes as a source. Key name `country`,
  so it is never confused with the import column `country_code`, which is a calling code.
- **B-2 No schema change:** no column, table, CHECK, grant, policy, seed or data step. Verified: `pospay_app` already
  holds `UPDATE` on `businesses` with a tenant policy (migration 0002, lines 39 to 45), and no later migration revokes it.
- **B-3 Typed contract:** a country schema in `packages/contracts`. The accepted codes are `KW`, `SA`, `AE`, `BH`, `QA`, and `OM` (OQ-3). The `settings` input of create-business **reserves the `country` key: its presence — with a valid or an invalid value — refuses the request** (manager disposition 2026-11-21 on OQ-2/B-5: a create grant alone must never set the country), and passes every other key through. The `Business` response keeps `settings` as an open record: a stored value this delivery did not validate must not break the businesses list.
- **B-4 No guess, no default, no backfill:** a business that never had a country set has none. Nothing derives it
  from `currency`, `timezone`, `tax_rule` or the vertical template. Create-business does not add the key when the
  request omits it. No existing row is rewritten.
- **B-5 Create path:** today `createBusinessInput.settings` is a free record merged over the vertical template
  (`create-business.ts`), so a holder of `create:businesses:company` could store any `country` value unchecked.
  From this delivery the `country` key is reserved at creation — the contract refuses its presence outright, valid
  codes included — and the separately authorized `manage:settings:business` PUT on the created business is the only
  way to set it (manager disposition 2026-11-21, closing the OQ-2 question this bullet opened).
- **B-6 Change route:** `PUT /v1/businesses/{businessId}/country`, body `{ country }`, answer 200
  `{ business_id, country }`. No update path for a business exists at the pin; this is the first. One
  `withTenant` transaction merges only the `country` key into `settings` in the database (every other key keeps
  its stored value, `modules` and `features` included) and writes one audit row with the country before and after
  (CLAUDE.md §8: every settings change is audited). Read the prior value under FOR NO KEY UPDATE, then decide whether
  to write. FOR KEY SHARE on the parent remains available to child inserts. If unchanged, return 200 without UPDATE
  or audit. Audit only the country before and after, representing an absent or invalid prior value as unset. No outbox event: nothing consumes one. No money or stock effect, so no `Idempotency-Key`.
- **B-7 Who may change it:** holders of `manage:settings:business` effective for the target business (OQ-2, option أ). Reuse
  the existing permission with the business-scoped guard (CLAUDE.md §6). No seed migration.
- **B-8 Unknown or foreign business:** a business of another company or an unknown id answers the same refusal —
  the shared business-scoped guard's 403, like every business route (correction 2026-11-21: the delivery spec first
  assumed a 404; the guard answers first and the parity property holds, with nothing written) — and the foreign row
  is verified under its own company, not the caller's.
- **B-9 Reader («public reader»):** in this repository that means a function exported from the module's `index.ts`
  that takes the caller's transaction, like `businessTimeZone` (`queries/business-time-zone.query.ts`). It is **not**
  an HTTP route and exposes nothing without a session. `businessCountry(tx, companyId, businessId)` returns `null`
  when the business is not visible, else `{ country }` where `country` is the valid stored code or `null` when unset.
  A stored value that fails the shared contracts schema reads as unset. The query uses that schema directly. A consumer reaches it through its own port (073 D-2); none
  is added here.
- **B-10 HTTP visibility:** the value is visible only inside `settings` of the existing `GET /v1/businesses`
  (`read:businesses:company`) and in the change route's answer. `apps/menu` and every public route are untouched.
- **B-11 Existing consumers audited:** a search of `apps/` and `packages/` at the pin (non-test code, the patterns
  `businesses.settings`, `b.settings`, `settings->`, `settings ->>`, `settings @>`) found one writer, create-business
  (`persistence/tenancy-transactions.ts` line 16), and one reader, `list-businesses.query.ts` line 89, which returns
  the column whole. No code was found reading a single key of it. The implementer repeats this search on its base
  and stops if a key reader appears; how a feature flag is resolved at request time was not traced here.

## 6. Tests required

**32b-1** (domain unit, no database, no workbook file, no security payload; the reader's own tests are untouched):

1. Header pre-selection: neither optional header, only `duration_minutes`, only `category`, both; a missing required
   header and an unknown header are left for `readSheet` to refuse.
2. Each cell of the A-5 table, including every ◊ cell, and an `error` cell in every column.
3. Duration: 120, "120", "090", 1 and 600 are accepted. Refuse 0, 601, 7.5, -5, "1e2" as text, booleans
   and unrepresentable numbers. A numeric tagged with text 100 is accepted.
4. Category: exact name, a name differing in case and inner spaces (`" hair  care "` → `Hair Care`), an Arabic-only
   name, an unknown name, a blank; the row carries the stored English name and the id.
5. Boolean: each of the six spellings in both cases, a boolean cell, a blank giving `true`, an unknown word.
6. Commission mapping: each of the four reasons to its code and column; a blank rule gives `FOLLOW_PLAN` with
   `commission_rule_defaulted` true and `commission_value` null; `PCT` 20 gives 2000; `FIXED` 0.5 gives `"0.500"`.
7. Mapper over a full sheet: all valid; each of the twelve codes at least once except `IMPORT_SERVICE_EXISTS`
   (32b-2); one row with several bad columns reports all of them; one error per row and column; errors in sheet
   order; an error row is never in the normalized rows; a row with an absent optional column gives null.
8. Final check: a row accepted by the mapper is accepted by `serviceTerms` with equal values; each mapped
   `ServiceError` code of A-7.
9. Duplicates: two and three rows with one key all flagged; case and whitespace variants are one key; the same
   name with different categories is a duplicate; a row with a bad price still takes part; the vectors file.
10. Money: the normalized price and the `FIXED` value are 3-decimal strings; no test or type lets a number carry money.
11. Bounds: the constants and the A-13 arithmetic against the exported `XLSX_EXPANSION_BUDGET`.
12. Contracts: each schema accepts its shape and refuses a number for `price`, a fourth decimal, a row below 2, a
    limit of 0 and 101; the OpenAPI document test (`openapi.spec.ts`) passes after regeneration.
13. Messages: every row code and column has both languages.

**34-pre-3:**

1. Contract: accepted and refused country values per OQ-3; create input with a good, a bad and an absent `country`;
   other `settings` keys pass through; no default is injected.
2. Domain (no database): the merge keeps every other key and replaces only `country`; reading a `settings` object
   with no key, a non-string, a malformed value gives unset; a business with `KWD` and `Asia/Kuwait` and no key
   gives unset.
3. Integration (real Postgres, one cloned database per spec file): set on a business whose settings hold the
   template's `modules` and `features` and one custom key → all three unchanged, `country` stored, one audit row with
   before unset and after the value; change to another value → audit before and after; the same value again → 200
   and no new audit row (no `UPDATE businesses` statement at the database boundary); a bad value → refused, row
   unchanged; another company's business and an unknown id → the same guard refusal, row unchanged (the foreign row
   verified under its own company); a role without the permission and a Device → 403; create reserves the `country`
   key (a valid or an invalid value is refused) while other settings pass and the scoped PUT sets the country after
   creation; a business created before this delivery (`{}` or template only) still lists and reads as unset; an
   audit failure inside the transaction rolls the write back and records no audit row (the BD-05 fault pattern);
   two concurrent changes produce two audit rows that chain before/after with the last matching the stored value.
4. Reader: result shape for set, unset, invalid and invisible. Verify company isolation and check the index plan.
5. Route coverage: exercise HTTP denial for unknown and cross-company targets, access to a different business in
   the same company, missing permission and Device sessions. Verify concurrent before/after ordering, no UPDATE or
   audit for an unchanged value, and rollback on audit failure. Test the OQ-2 create path. Register the actual PUT
   path, its request, response and authorization refusals in OpenAPI.
6. No migration: `pnpm migration-chain:check` unchanged; no new table, so no new RLS policy or table-level test. The
   existing `businesses` isolation tests stay.

## 7. Questions

Nothing below is answered by a record at the pin. The search covered the repository at the pin only
(`docs/owner-decisions.ar.md`, both `owner-questions.ar.md`, both specs, `docs/adr`); the decisions site and thread
history were not searched. The manager decides the kind, numbers them and asks; the answers are copied verbatim
into the canonical `owner-questions.ar.md` files inside the implementation PR.

**OQ-1 — نشاط مالوش دولة متحددة** (073 `TODO(spec)`, line 136). **لا يوقف 34-pre-3** (القارئ بيرجّع «مش متحددة»
وده مجرد تمثيل)، **لكنه يوقف:** قاعدة CIM-15 في 34b-2، وهل الدولة تتمسح بعد ما تتحدد، وهل تبقى مطلوبة عند إنشاء
نشاط جديد. مثال: صالون في الرياض رفع ملف عملاء وأرقامه من غير كود دولة، والمالك لسه ما حدّدش دولة الصالون.
**اللي الـ PR ده بيعمله لحد ما ييجي الرد (أقل حاجة، مش إجابة):** تحديد وتغيير بس، من غير مسار مسح، والدولة مش
مطلوبة عند إنشاء نشاط. لو الرد اختار المسح أو الإلزام، ده بند متابعة.

- ⭐ (أ) المعاينة ترفض وتطلب تحديد دولة النشاط الأول، ومفيش أي رقم بيتخمّن. الدولة لما تتحدد تتغيّر بس وما تتمسحش.
- (ب) الصفوف اللي خانة كود الدولة فيها فاضية بس هي اللي تترفض، والباقي يعدّي.
- (ج) تحديد الدولة يبقى إجباري عند إنشاء أي نشاط جديد، والأنشطة القديمة تمشي على (أ).
- افتراضي ثابت 965 مرفوض بملاحظة أبو سالم الملزمة على CI-Q7، فمش معروض.

**OQ-2 — مين يقدر يحدد دولة النشاط؟** **معتمد: الاختيار (أ)** لمسار التعديل B-6 وB-7 واختباراته.

- ⭐ (أ) اللي معاه إعدادات النشاط `manage:settings:business` (المالك والمدير العام ومدير النشاط افتراضيًا، حسب
  `role-defaults.ts`؛ مدير الفرع بتفويض شخصي بس حسب `system-role-policy.ts`). أقرب لنص إجابة وليد «الاعدادات العامة للنشاط». من غير migration.
- (ب) المالك بس، بصلاحية هوية النشاط `manage:business-identity:business`. من غير migration.
- (ج) صلاحية جديدة خاصة. **محتاجة migration لبذر الصلاحية** (زي 0148) ودور في مسار الـ migrations ومراجعة قاعدة
  بيانات، وده عكس شرط «من غير migration» في قرار 17:52.

**OQ-3 — أنهي دول مقبولة؟** **معتمد: الاختيار (أ)** لعقد B-3 واختبارات القيم.

- ⭐ (أ) دول الخليج الست (KW, SA, AE, BH, QA, OM)، زي قائمة `GccIbanCountry` الموجودة، وتتزوّد بعدين من غير كسر.
- (ب) كل دول ISO 3166-1 من قائمة متخزنة في المشروع، زي قائمة العملات ISO 4217. حجم أكبر (ملف مولّد). سابقة تشهد
  لها: `packages/contracts/src/reference/currency.ts` مسجّل فيه «أي كود ISO 4217 (قرار Waleed)».
- (ج) أي حرفين كبار (زي `tax_rule.country_code`). بيقبل كود مالوش دولة، فمش مقترح.

**رد وليد حرفيًا (2026-11-21):** «اعتمد OQ-2 أ وOQ-3 أ». [سجل القرار](../073-customers-import/owner-questions.ar.md#قرارات-دولة-النشاط-34-pre-3--oq-2-وoq-3).

**OQ-4 — هل «الإدارة» فيها شاشة؟** (قرار نطاق للمدير.) ⭐ (أ) API بس في الـ PR ده، والشاشة بند جديد بعده.
(ب) خانة في صفحة هوية النشاط دلوقتي: حوالي 300 سطر زيادة بالاختبارات، والصفحة دي للمالك بس.

**Technical defaults after independent design review:** T-1 the `REQUIRED` commission reason is `IMPORT_REQUIRED_CELL`; T-2 a numeric cell is accepted as
a name or a category name, a boolean is not; T-3 duration text with leading zeroes is accepted within 1 to 600; T-4 the status
`error_code` enum lists the codes 072 names (`IMPORT_SERVICE_EXISTS`, `IMPORT_CATEGORY_NOT_FOUND`,
`IMPORT_PREVIEW_EXPIRED`, `IMPORT_PREVIEW_HAS_ERRORS`, `IMPORT_COMMIT_FAILED`) and 072 names no code for a business
that vanished before commit, so 32b-3 may extend it; T-5 no `readHeaderRow` is built (§2); T-6 the key lives in the
API catalog domain with boundary-safe handoff in A-11; T-7 schemas without paths (A-2); T-8 the `Business`
response keeps an open `settings` record (B-3); T-9 the key name `country`; T-10 register the country PUT OpenAPI path.

## 8. Prerequisites handed to other rows (not built here)

| # | What | Evidence | Owner row |
|---|---|---|---|
| P-1 | `readWorkbookMatrix` must also return the parallel number-format matrix (072 FR-005), or percentage-formatted commission cells are misread | `packages/import-workbooks/src/xlsx-sheet-reader.ts` returns `ImportMatrix` only | 32b-2 (its sheet-read subtask), with the reader's tests |
| P-2 | The join from `readSheet` rows (raw cells, blank rows skipped) to tagged cells by source row number, producing the A-12 input | specified nowhere | 32b-2 |
| P-3 | The template's reference sheets must fit 35,416 positions in total and 6,552 data rows each, or a manager's own template is refused on upload; categories per business are unbounded | A-13 | 32b-2 |
| P-4 | The object-bytes reader is still staff-only: `createObjectBytesReader` in `staff/persistence/import-adapters.ts` translates storage failures into `EmployeeImportError`. 072 D-4 gives catalog its own `ObjectBytesReader` port, and 073 D-2 gives 34b the same piece | file history: PR #107 only | 32b-2 for catalog; 34b for customers |
| P-5 | The country → calling-code reference and the customer port over `businessCountry` | 073 CIM-15 | 34b-2 |
| P-6 | 073's 34b-1 row («move the shared xlsx adapters»): the xlsx reader half is already done by #871; only the object-bytes reader of P-4 is left of it | §2 | manager: re-scope 34b-1 |
| P-7 | The services tests through the real reader that 072 lists under «Sheet adapter» (the header set in a real file, 500 and 501 rows, 2 MiB plus one byte) have no owner row now that the reader is not 32b-1 work | 072 Test plan | 32b-2 |

## 9. Conflicts and authorizations the manager must settle before a brief

1. **One slice per PR.** CLAUDE.md §1 and §10 («One slice per PR»), `docs/agent-delivery-pipeline.md` §1 («One use
   case per PR. A task needing two use cases is two PRs.») and the owner rule of 2026-10-12 quoted in 072 («at most
   three subtasks per PR»). This delivery is two rows of two specs in two modules. PP-212 records the owner's one-delivery instruction.
2. **Pipeline card (PP-195).** Waleed decided «Medium» (PP-212 and plan §2).
3. **Session ownership.** 073 gives 34-pre-3 to the 34b session, «after 34-pre-1, not in parallel». Moving it into
   this delivery is recorded alongside the one-delivery steering in PP-212.
4. **Roadmap.** 073 requires the 34-pre-3 row to be added to `roadmap.json` when it starts.
5. **Size.** The combined change is about four times the 500 to 700 lines 072 estimated for all of 32b-1 (plan §7).
   A delivery over twice its brief's stated size is refused (pipeline, «Delivery size»), so the brief must carry the
   plan's numbers, not the historical one.
6. **OQ-2 (أ)** uses the existing permission. OQ-3 (أ) fixes the six-country list. No migration is needed for these decisions.
