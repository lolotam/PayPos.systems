# Feature Specification: Catalog services import — template, preview, all-or-nothing commit

**Created**: 2026-10-25
**Status**: Draft spec for plan row 32b, amended on 2026-10-25 and again on 2026-10-29 with the owner answers
(`owner-questions.ar.md`). SI-Q1 to SI-Q10 are closed: Waleed answered by card and Abu Salem on the decisions page with
the same picks (batches 74 and 76, `PP-64.1` to `PP-64.11`). SI-T1 (technical, `PP-64.6`) was answered by Waleed and is
final. SI-Q11 and SI-Q13 are closed (batch 78, `PP-67.1` and `PP-67.3`; on SI-Q13 the owners differed and Abu Salem's
pick binds). SI-Q12 is replaced by its confirmation SI-Q14. **SI-Q14 to SI-Q24 are closed** (batches 80 to 83,
`PP-75` to `PP-78`): Abu Salem answered on the decisions page on 2026-10-29 with Waleed's picks on every one but SI-Q17,
where the owners differed and his pick binds (the owner, general manager and business manager only, the recommended
option; CLAUDE.md §1 5b). Waleed answered SI-Q5 against the recommendation, so a duration and a category are added to the
service first, and SI-Q7 (also against the recommendation) makes the category a managed list per business with its own
close and reopen; those come in the sub-PRs `32b-cat-1`, `32b-pre-1`, `32b-cat-2`, `32b-pre-2` and `32b-cat-3` before
the import carries them. **No code starts before this spec is merged.**
**Input**: Phase 1 plan row 32b ("services import", size S, depends on 32); SPEC §2 "Import" and §11 acceptance
"An import with any invalid row saves nothing"; spec 031 (SR-006, SV-02, SV-10, the 200 ms rule and SV-Q2); spec 030
and ADR-0034 (the import framework this row reuses); `docs/journey/29-services.md`; CLAUDE.md §5/§6/§8/§9.

## User Scenarios & Testing

A manager of a business downloads the services template, fills one row per service (names, price, duration, category, commission rule),
uploads it through the existing private-files flow, previews it, and commits only when the preview has no error.
One invalid row saves nothing. The commit runs in the worker and the screen polls its result.

**Example (a salon called «الأميرة»):** the manager imports 40 services. Row 2 is «Haircut / قص شعر», price `7.500`,
rule `FOLLOW_PLAN`; row 3 is «Full colour / صبغة كاملة», `25.000`, `PCT` 20 %; row 4 is «Manicure / مانيكير»,
`5.000`, `FIXED` `0.500`. Row 17 has a price of `7.5555`: the preview names row 17, column `price`, and the commit
button stays disabled. After the manager fixes it and previews again, all 40 services are created once, each with
its audit row.

**Independent Test**: preview a workbook with one invalid row → no service written; fix the row, preview again,
commit → every service created in one transaction with its audit row, and the services list shows each exactly once.

### Acceptance scenarios

- SI-01: the template is downloadable per business as one `.xlsx` workbook with bilingual headers (English header
  row authoritative, Arabic labels as cell comments) and a reference sheet listing the four commission rules.
- SI-02: preview parses only the first sheet, validates every row and every cell with the create-service rules
  (`validateServiceDraft` through `serviceTerms`), and writes no service. It returns a stable preview id, the row
  count and per-row/per-column named errors (i18n keys), **for every bad row, not only the first**.
- SI-03: a preview with zero errors can commit; every row lands in ONE transaction; any failure saves nothing.
  **There is no partial commit** (SPEC §11). "Partial-success reporting" in the plan means exactly this: the preview
  reports which rows are good and which are bad, with the counts, and the commit is still all-or-nothing.
- SI-04: a preview expires after 24 h and is single-use; concurrent commit requests yield the same 202 acceptance,
  one request event and one worker effect.
- SI-05: the business, file and preview of another tenant or another business answer exactly like an unknown one
  (404 `IMPORT_FILE_NOT_FOUND` / `IMPORT_PREVIEW_NOT_FOUND`); a services preview is never visible through the
  employee import routes, nor an employee preview through these.
- SI-06: commit requires an `Idempotency-Key`; a repeat returns the stored acceptance without a second import.
- SI-07: permission is `manage:services:business` and the `catalog` feature, checked by the same guard the services
  controller uses; a Device never holds it.
- SI-08: a workbook over 2 MiB or over 500 data rows is refused before any write.
- SI-09 (SI-Q1, SI-Q2): a row whose `name_en` equals an existing service of the business, or equals
  another row of the same file, is a named row error; nothing is skipped silently and nothing is updated.
- SI-11: before committing, the manager sees every error-free row as the server resolved it (names, price, the commission rule
  that will be stored, whether it was a default, the tier flag; a clean preview therefore shows all rows), so a blank commission cell turned into `FOLLOW_PLAN`
  (SI-Q3) is never a surprise; see FR-014.
- SI-12 (SI-Q6 to SI-Q9, SI-Q13): the template, the preview and the commit carry `duration_minutes` and `category` under the same rules as the manual service form (the same limits, because the import calls the same rule functions); the `category` cell names an **open** category of the business by its English name, and the import never creates a category; a bad duration or an unknown or closed category is a named row error in its own column, and a blank cell is "no value" (SI-Q8).
- SI-10: money never undergoes float arithmetic and is never stored or passed on as a number past the reader boundary: a price cell follows the single rule of FR-005 and becomes the contract's 3-decimal string, and a fourth decimal is a row error, not a rounding.

## Requirements

### Scope decisions (read before the rest)

1. **Columns equal the create-service inputs, and the create-service inputs gain a duration and a category first.**
   The plan brief for this row asked for a duration and a category column. The `services` table
   (`packages/db/schema/catalog.ts`), `createServiceInput` (`packages/contracts/src/catalog/service.ts`), spec 031 and
   SPEC §4 carry neither today; the commission rule, which the brief omitted, is **mandatory** in `createServiceInput`.
   Waleed answered SI-Q5 «Yes, add them first» (`PP-64.5`, 2026-10-25, against the recommendation): the two attributes
   become part of the service in their own sub-PRs `32b-pre-1` and `32b-pre-2` (`32b-pre-1`: contract, migration, rules, create and
   update, queries; `32b-pre-2`: the form and the list), and only then does the import carry them. So the template has the create-service inputs as
   they stand after those PRs, and no others, as spec 030 FR-004 did for employees. The rules of the two attributes
   (unit and limits, the shape of the category, required or optional, whether the category changes what a duplicate
   is, and whether the list filters by it) were asked as **SI-Q6 to SI-Q10** and are answered: whole minutes 1 to 600,
   a **managed category list per business** (SI-Q7, against the recommendation), both optional, the name alone decides a
   duplicate, and the services list **filters by category now** (SI-Q10, against the recommendation). The managed list
   raised SI-Q11 to SI-Q16 (who manages it, both names required, and what closing a category does to its services);
   see "Service categories" under Schema changes.
2. **All-or-nothing, no partial commit** (SI-03, SPEC §11, ADR-0034). The only "partial" thing is the report.
3. **Create-only.** The import never updates or deletes an existing service. (An "update by name" import is a
   different feature with its own revision, audit and permission questions; it is an SI-Q1 option Waleed did not pick and the
   import leaves it out.)

### Touched outside the slice

- `apps/api/src/shared/import/`: the parts of the staff import adapters that have no employee meaning (the xlsx
  workbook reader, the object-bytes reader wrapper, and any template-building helper without employee meaning) move here from
  `apps/api/src/modules/staff/persistence/` so catalog can use them without a deep import. Staff re-imports them from
  the new place with identical behaviour; sub-PR 32b-1 identifies the parts, and any part that has employee meaning
  stays in staff and is re-written (not moved) in catalog. Staff's own tests run unchanged. The xlsx reader is
  bound to staff today (`xlsx-sheet-reader.ts` throws `EmployeeImportError` and fixes `maxColumns` at the employee
  header count + 2): moving it means the caller passes its bounds and translates the reader's errors. Staff keeps its
  current values; services pass their own header count + the same 2-column margin, so an unlabelled data column is
  still reported. The guard algorithms do not change, but they take the same caller bound (8 for staff, 10 for
  services); 32b-1 restates the derived other-sheet row ceiling (65,536 / 10 = 6,553) and the six-times budget margin
  for the services grid, as the ADR-0034 addendum §3 says. The object-bytes reader moves the same way: the read is generic,
  its error translation stays with each entity.
- `docs/module-map.md`: one Port row (D-4) and one event row (D-5) with a note on the worker `catalog` module (D-6);
  `docs/module-map.yaml` does not change; an ADR-0034 addendum records them (32b-0).
- `apps/worker/src/outbox/known-event-types.ts`: one new event type (D-5), added by the same PR that adds its worker
  transport (32b-3), never earlier, so no worker can recognise the event without being able to enqueue its job.
- `packages/i18n`: ar/en messages for the new error codes and the screen.
- `apps/admin`: a `catalog/import` page; staff's import panel is not modified except, if the design advice for 32b-6
  says so, to share entity-agnostic pieces with it.
- **Touched only by the category and attribute PRs `32b-cat-1`, `32b-pre-1`, `32b-cat-2`, `32b-pre-2` and `32b-cat-3`**
  (not by the import PRs): `packages/db` (the `service_categories` table with its RLS, grants and permission seed in
  `32b-cat-1`; the attribute columns on `services` and their concurrent index in `32b-pre-1`; the closed state of
  services in `32b-cat-2`), `packages/contracts/src/catalog/service.ts` and a new `service-category.ts`, the catalog
  domain, the category use cases (create, rename, close, reopen), the create-service and update-service use cases, a
  close-service and a reopen-service use case, the service and category queries, the `orders` catalog-reader adapter
  (a closed service is refused at record time, `32b-cat-2`), and an addendum to spec 031 that supersedes SV-09 and
  answers SV-Q3 (a service can now be closed); the `apps/admin` service form, list and filter in `32b-pre-2` and the
  category screen in `32b-cat-3`. In each PR the contract comes first, so a field the contract accepts is always stored
  and returned (CLAUDE.md §1.3).
- **Not touched by the import PRs 32b-0 to 32b-6:** `packages/db` (no migration, no schema change, no grant, no
  permission seed; see Schema changes), `packages/domain`, `modules/staff` behaviour, `services` rows already stored
  (an existing service keeps no duration and no category), the `files` upload policy.

### Design decisions

Decided here from the files; the design advisors confirm them in the ADR sub-PR (32b-0) before any code, as spec 059
did. A decision that depends on an owner answer says so.

| # | Decision | Rejected alternative |
|---|---|---|
| D-1 | **The preview is stored in the existing `import_previews` table with `entity = 'services'`.** `entity` is free text under `CHECK (entity ~ '^[a-z][a-z0-9_]{1,31}$')`, `rows` and `errors` are `jsonb`, and the status, count and expiry checks and the RLS policies and grants do not look at `entity`; ADR-0034 and the schema comment announce `services` as the next entity. No migration. The entity split is the application's job: every catalog read, lock and update of a preview filters `entity = 'services'`, the stand-alone failure updates included (staff's worker `fail` path in `employee-import.transactions.ts` does not filter `entity` and is not copied as is). | A `service_import_previews` table (a second table, its RLS, its grants and a second negative test, for no benefit) |
| D-2 | **Catalog owns its whole import flow** (API use cases, worker module, sweep). Staff's flow is not generalised in place: its queries, its commit transaction and its sweep filter `entity = 'employees'` and write employee rows. Only entity-agnostic pieces move to `apps/api/src/shared/import/` (see Touched outside the slice) and `readSheet`, `ImportCell` and the zip and XML guards stay exactly as they are (staff byte for byte, header and blank-row checks unchanged). The one new shared piece is the generic cell-tagging step of FR-005, which has no services knowledge. "A plug-in, not a second engine" (ADR-0034, spec 030) is read as: one sheet engine, one preview table, one API shape, one UI shell; the per-entity commit lives with the entity. | Making staff's use cases entity-generic: it rewrites merged, heavily hardened code (ADR-0034 "Review hardening") for a second consumer |
| D-3 | **Authorization is the guard the services controller already uses:** `@Require('manage:services:business', { business: 'businessId' })` plus `@RequiresFeature('catalog')` on all five routes (template, preview, rows, commit, status). There is no identity read inside the use-case transaction (the employee import needed one for the PR 7 lock protocol; services have no such protocol, and create-service authorizes by the guard alone). As in ADR-0034 IM-08, authorization is checked at acceptance; a later revocation does not cancel an accepted commit, and the worker does not recheck the feature flag. | Copying the employee import's in-transaction identity locks (adds an import arrow `catalog → identity`, ADR required, for no rule that needs it) |
| D-4 | **File facts and file bytes come through catalog-owned ports bound at the composition root** (`ImportFileFactsPort`, `ObjectBytesReader`), the pattern of spec 059 D-16: no `catalog → files` import arrow. Catalog may import `tenancy` only (module-map §2), and `packages/storage` is restricted to `files`. Answered by Waleed, **SI-T1** (technical, final, `PP-64.6`, 2026-10-25): ports wired from outside, no new import arrow; the rejected alternative is the arrow with an ADR. | A `catalog → files` arrow |
| D-5 | **One new event type, `ServiceImportCommitRequested`** (id-only `{ preview_id }`, company in the outbox envelope), emitted in the acceptance transaction, as `EmployeeImportCommitRequested` is. The worker registers the type the way staff does, through `knownEventTypes(...)` from the catalog worker module, not as a constant in `KNOWN_EVENT_TYPES`, and its transport takes the event before `outbox/deliver.ts` can acknowledge a known event that has no consumer. **No per-service event and no summary event:** spec 031 SV-10 records that no consumer needs a service event, and an unconsumed outbox row is a cost with no reader. The record of what was imported is the preview row (`status = committed`, `created_count`, `committed_at`) and the audit rows. The module-map §4 row lands in 32b-0 (documentation only); the event type is added to `apps/worker/src/outbox/known-event-types.ts` in 32b-3 together with the catalog worker transport, and the API producer ships last (32b-5), after the worker consumer and the sweep are deployed everywhere, so a rolling deployment never has an event whose consumer is missing. | Reusing `ImportCommitted` (a staff event whose payload carries `employee_ids`) |
| D-6 | **A new worker module `apps/worker/src/modules/catalog`** (today the worker has no catalog module): the BullMQ jobs `service-import-commit` and `service-import-recovery` (the per-company stale-request sweep, with the tenant discovery and scheduler protocol of PR 24 / ADR-0022, exactly as staff registers its own), wired in the worker composition root. The `catalog → tenancy` arrow already covers api and worker. The sweep reads only `entity = 'services'`, and staff's sweep, which reads only `entity = 'employees'`, never touches a services preview. | Extending staff's sweep to other entities |
| D-7 | **Preview stays synchronous, commit moves to the worker.** Spec 031 already says the service import "is the heavy path and uses the PR 11 worker framework", and CLAUDE.md §6 sends anything over 200 ms to the worker. The API acceptance transaction must stay under 200 ms warm (asserted in an integration test, as ADR-0034 did). The services preview test asserts the bound explicitly and times the whole call (file read, parse, validation and save), not the parse alone; staff's preview benchmark only logs its median and is not the model for that assertion. The synchronous preview of a 500-row workbook is measured in 32b-2 (one warm-up and five runs, median under 200 ms, the ADR-0034 method); if it is not, 32b-2 stops and reports instead of weakening a bound. | A synchronous commit: not allowed by the 200 ms rule without a measurement that does not exist yet |
| D-8 | **Row validation reuses the create-service rules exactly (SR-006), in four steps.** (1) The plug-in converts each cell to the wire shape of the contract (strings for money, an integer for `PCT`, `ServiceRuleWire`). (2) It converts the wire shape to the domain shape with the same conversion `serviceTerms` uses: `parseServicePrice` for the price and `toCommissionRule` for the rule (the `PCT` integer and the `FIXED` string become bigint values); `toCommissionRule` is private to `service.ts` today and `32b-pre-1` exports it, so `validateServiceCommissionRule` always receives the bigint shape it requires. (3) It runs **every field validator separately** and collects each field's error, so a row with several bad cells reports all of them: `validateServiceNameEn` and `validateServiceNameAr` (the split of `validateServiceName`, which throws one `SERVICE_NAME_INVALID` for either name; certain, and owned by `32b-pre-1` because that PR already touches the catalog domain), `parseServicePrice` and `validateServiceCommissionRule` (they throw their `ServiceError`, which the plug-in catches field by field) and, new in `32b-pre-1`, `validateServiceDuration` (it returns its `ServiceError` or null); the category cell is resolved against the open categories the preview reads once per business, not by a rule function. (4) Only a row with no error then goes through `serviceTerms` as the final check, so the import can never disagree with create-service. Each named error (`SERVICE_NAME_INVALID`, `SERVICE_PRICE_INVALID`, `SERVICE_COMMISSION_RULE_INVALID`, `SERVICE_DURATION_INVALID`) maps to the row error of its column, and the category errors `SERVICE_CATEGORY_NOT_FOUND` and `SERVICE_CATEGORY_CLOSED` both map to `IMPORT_CATEGORY_NOT_FOUND` on the `category` column. `validateServiceDraft`, which `serviceTerms` calls for create and update, composes the same per-field validators and still stops at the first error: one source of truth, no second validation engine. | A parallel validator in the import code |
| D-9 | **The stored `rows` are the normalized preview rows of FR-014:** `{ row, name_en, name_ar, price (3-decimal string), duration_minutes (integer or null), category_id (uuid or null), category_name_en (string or null, for display), commission_rule, commission_value, commission_rule_defaulted, counts_toward_threshold }`, never a number for money (SI-Q6 to SI-Q9); `commission_value` is the normalized value of the rule (basis points as an integer for `PCT`, a KWD amount as a 3-decimal string for `FIXED`, such as `"0.500"` for 500 fils, null for `FOLLOW_PLAN` and `ZERO`); for `PCT` and `FIXED` it equals `commission_rule.value`, and `FOLLOW_PLAN` and `ZERO` carry no `value`. The worker consumes them as immutable validated rows and projects only the service fields into the insert (`name_en`, `name_ar`, `price`, `duration_minutes`, `category_id`, `commission_rule`, `counts_toward_threshold`; dropping `row`, `category_name_en`, `commission_value` and `commission_rule_defaulted`), where `commission_rule` is a logical shape that persistence splits into the `commission_rule_kind`, `commission_pct_bps` and `commission_fixed_amount` columns, as create-service does; it re-checks only what can change after the preview (that the business still exists, SI-Q1 that no service now has the same name, and that every referenced category is still open: a category closed after the preview fails the whole commit with status `failed` and the top-level `error_code` `IMPORT_CATEGORY_NOT_FOUND`, as the name race of FR-007 reports `IMPORT_SERVICE_EXISTS`, because the stored rows and errors of a preview never change after it is saved, ADR-0034), as the staff worker re-checks only branches. | Re-parsing the workbook in the worker |

### Functional requirements

- FR-001: one `.xlsx` workbook, first sheet only. The English header row is authoritative; the Arabic labels are cell
  comments on the header cells and are never parsed, so the first data row is the sheet's second row. Headers must
  match the expected set exactly (no missing, extra or duplicate column) except that `duration_minutes` and `category` may
  each be absent (SI-Q8: both optional): an absent optional header reads as no value for every row,
  so a legacy file without them keeps importing. `readSheet` stays unchanged and still demands an exact set (D-2), so the plug-in first reads the header row with a new generic `readHeaderRow` in `apps/api/src/shared/import/` (the same zip and XML guards, no new parser), builds `expected` as the required columns plus whichever of `duration_minutes` and `category` are present, then calls `readSheet(expected)` and maps cells by header name; a duplicate or unknown header still fails there. Any
  other violation refuses the whole workbook with
  `IMPORT_HEADER_INVALID`; an empty data sheet is also `IMPORT_HEADER_INVALID` (the `readSheet` contract). `exceljs` is
  already pinned in `apps/api` (ADR-0034); no new dependency.
- FR-002: upload through the existing files presigned flow (PUT, confirm, worker verification). No multipart route, no
  file on disk. The `files` policy already accepts the xlsx MIME (migration 0077); this row changes nothing in `files`.
- FR-003: preview reads the READY file object by id and verifies company, business, uploader (the caller), status,
  content type and size (at most 2 MiB); at most 500 data rows, blank trailing rows ignored, sparse source row
  numbers kept. All the zip, XML and expansion guards of ADR-0034 "Review hardening" apply unchanged because they sit
  in `apps/api/src/shared/import/`.
- FR-004: the columns are exactly:

  | Column (English header) | Required | Meaning | Cell rule |
  |---|---|---|---|
  | `name_en` | yes | English name | 1 to 255 after trim, no control character (SR-001) |
  | `name_ar` | no | Arabic name | blank means no Arabic name; else 1 to 255 after trim, no control character |
  | `price` | yes | price in KWD | see FR-005; zero allowed (SV-03) |
  | `duration_minutes` | no (SI-Q6, SI-Q8); the header itself may be absent (FR-001) | service length in minutes | blank means no duration; else a whole number of minutes from 1 to 600 (an integer cell or the text of one); a fraction, zero, a negative, a text cell in exponent form (`"1e2"`) or a value above 600 is `IMPORT_DURATION_INVALID`, never rounded; a numeric cell entered as `1e2` reaches the plug-in as the text `100` and is accepted as 100; a numeric cell tagged `numeric-unrepresentable` (`1e21`, a 16-digit value) is `IMPORT_DURATION_INVALID` |
  | `category` | no (SI-Q7, SI-Q8); the header itself may be absent (FR-001) | the English name of an open category of the business | blank means no category; else the cell is matched against the business's **open** categories by the category key (trim, collapse each run of whitespace into one space, case fold: the key of the unique index of `service_categories`); no match, or a match only with a closed category, is `IMPORT_CATEGORY_NOT_FOUND`; the import never creates a category; the Arabic name is not matched (the English name is the key, as in SI-Q1) |
  | `commission_rule` | no (SI-Q3) | rule kind | `FOLLOW_PLAN`, `ZERO`, `PCT` or `FIXED`, case-insensitive; blank means `FOLLOW_PLAN` (SI-Q3, Waleed's pick) |
  | `commission_value` | by rule | value of the rule | blank for `FOLLOW_PLAN` and `ZERO`; required for `PCT` and `FIXED` (see FR-006) |
  | `counts_toward_threshold` | no | counts toward the commission tiers | blank means `true` (SR-005); else a boolean cell, or the text `true`/`false`, `yes`/`no`, `نعم`/`لا`, case-insensitive |

  The duration and category columns are in the template only once `32b-pre-2` has merged (SI-Q5), so the categories can be managed and set by hand first. A duration cell is read through the same `tagCells` text as FR-005: digits only, no float arithmetic, and a cell with a fraction (`90.5`) is refused, not rounded. Exponent form is refused only in a text cell, because `tagCells` has already normalized a numeric `1e2` to `100`.

  **The services list filters by category now** (SI-Q10, against the recommendation): the list read of `32b-pre-1` takes an optional `category_id` and `32b-pre-2` adds the filter to the screen; grouping was not asked for (this settles the filter note of issue #683). The template's reference sheet lists the open categories of the business (English and Arabic name) so the manager types an existing name.
- FR-005: **money in cells (one rule, the same in SI-10 and the delivery table).** No arithmetic on money in floating point, and no JavaScript number crosses the reader boundary. **The boundary is a new generic step in `apps/api/src/shared/import/`**, for example `tagCells(matrix, formats)`, that runs after `readSheet` (`readSheet` and `ImportCell` are unchanged) and knows nothing about services. It turns each cell into one of: `{ kind: 'text', text }`, `{ kind: 'boolean', value }`, `{ kind: 'numeric', text, percentFormat }`, `{ kind: 'numeric-unrepresentable', display }`, `{ kind: 'error' }` for an Excel error cell (`#REF!`, `#DIV/0!`, a formula whose result is an error; the reader's `INVALID_CELL` sentinel), or null for a blank. An `error` cell is never null and never text, so a broken cell can never fall back to a default (`FOLLOW_PLAN`, `true`, "no Arabic name"): the plug-in turns it into `IMPORT_CELL_INVALID` on that cell's column. For a numeric cell, `text` is the shortest round-trip decimal text of the value (ECMAScript Number to String); if that text has more than 15 significant digits or uses exponent form the cell is `numeric-unrepresentable` (carrying a safe display string, never a number) instead. The sheet reader returns, beside the matrix, a parallel `formats` matrix with the same row and column indexes as `ImportMatrix` (null where a cell has no format), produced by the same ExcelJS pass, which `tagCells(matrix, formats)` reads; `readSheet` and `ImportCell` stay unchanged; there is no "services mode". The catalog plug-in does every service-specific conversion and validation on the tagged cells, and turns `numeric-unrepresentable` into the column's own row error (`IMPORT_PRICE_INVALID`, `IMPORT_COMMISSION_VALUE_INVALID`, `IMPORT_DURATION_INVALID`), so one row can still report several errors in one preview. From the text on, everything is string to bigint mills. The shortest form returns exactly what the manager typed for any value of at most 15 significant digits (a price has at most 11 + 3), even though Excel stores `0.57` in the file as `0.56999999999999995`; the raw `<v>` text is deliberately not read. The plug-in converts a price (and a `FIXED` value) to the
  contract's 3-decimal string with string handling, never with float arithmetic: `12.5` becomes `"12.500"`, `0` becomes `"0.000"`. A value with a fourth decimal, a
  negative value, an exponent form (`1e21`), a thousands separator, a non-ASCII digit, or a value at or above
  `10^11` KWD is `IMPORT_PRICE_INVALID` (or `IMPORT_COMMISSION_VALUE_INVALID` for the `FIXED` value); it is never
  rounded. A text cell holding `"12.5"` or `"12.500"` is accepted the same way. The result then goes through
  `parseServicePrice`, so the domain function stays the only authority on the number.
- FR-006: **commission rule cells.** `FOLLOW_PLAN` and `ZERO` with a non-blank `commission_value` is
  `IMPORT_COMMISSION_VALUE_INVALID`. `PCT` needs a value and SI-Q4 (Waleed's pick) sets its unit: a plain
  percent with at most two decimals (`20` or `12.5`) converted by string handling to basis points (`2000`,
  `1250`), a value above 100 refused (the rejected alternative was basis points as typed in the manual form). `FIXED` needs a
  KWD amount under the FR-005 rule, and, as in spec 031, it may exceed the price. **A cell formatted as a percentage in Excel stores the fraction** (typing `20%` stores `0.2`): `tagCells` sets `percentFormat` on the numeric cell (below), and a
  percentage-formatted cell goes through two steps. (a) The plug-in scales the cell's decimal
  text by 100 as a string, giving the percent text (`0.07` is `"7"`, `0.2` is `"20"`, `0.125` is `"12.5"`). (b) The
  percent text then follows the rule above to basis points, times 100 (`"7"` is `700`, `"20"` is `2000`,
  `"12.5"` is `1250`), and an unformatted `0.2` stays `0.2`
  percent (20 basis points). The template's `commission_value` column is not percentage-formatted, its Arabic comment says
  "type 20 for 20 percent", and FR-014 shows every resolved rule before commit, so a misread value is visible. **`percentFormat` classification** (generic, in `tagCells`): take the number format's first section (split on `;` outside quotes), drop quoted text, backslash-escaped characters and `_x` / `*x` pairs, and `percentFormat` is true when an unescaped `%` remains.
  A kind that is not one of the four is `IMPORT_COMMISSION_RULE_INVALID`. `PCT` 0 is valid and different from `ZERO` (spec 031).
- FR-007: **duplicate names** (SI-Q1, SI-Q2: Waleed's picks). The comparison key is `name_en` after
  trim, collapsing inner whitespace and case folding; `name_ar` is not part of the key, and neither is the category (SI-Q9: the name alone decides). An existing service counts whether it is open or closed: a closed service with the same name blocks the row, because reopening it later would leave two services with one name.
  - A row whose key equals the key of an existing service of the same business is `IMPORT_SERVICE_EXISTS` on column
    `name_en`.
  - Every row of the file that shares a key with another row of the file is `IMPORT_DUPLICATE_IN_FILE` on column
    `name_en` (all of them, not only the later ones).
  - The existing-service check is repeated in the worker transaction, after the per-business advisory lock of FR-009,
    so two imports of one business (two different clean previews of the same file) cannot both pass it: the second
    sees the first one's services and is refused whole. There is no unique index on names (SV-02, SV-Q2 chose none),
    so against a **manual** create the check is a guard, not an invariant: a manual create of the same name in the
    same instant can still produce a duplicate, which SV-02 allows. This spec adds no lock and no constraint to
    `services` and changes nothing in create-service.
- FR-008: commit accepts only a preview with zero errors, unused and unexpired, created by the caller; it returns 202
  `{ preview_id }`, requires `Idempotency-Key`, locks the preview `FOR UPDATE`, sets `commit_requested` and
  `requested_at` from one injected Clock instant and appends the id-only `ServiceImportCommitRequested`, all in one
  tenant transaction. Repeats for the same preview return the same acceptance and add no event.
- FR-009: the worker job `service-import-commit` runs in one `withTenant(company_id)` transaction, locks the preview,
  runs only if it is `commit_requested`, checks expiry against the stored `requested_at` (equality is expired; a
  delay in execution does not expire an accepted request), re-checks the business and (SI-Q1) the names, then takes a transaction-scoped advisory lock for the business (key: company, business and the import purpose), so two different previews of one business commit one after the other, and only then re-checks the names and inserts
  every service (revision 1, `counts_toward_threshold` as stored, one injected Clock instant for `created_at` and
  `updated_at`, ids from the injected `IdGenerator`), appends one audit row per service in the same shape as
  create-service (the new record only, no before value), with the actor taken from the locked preview's `created_by` (the manager who asked for the import), never a null system actor (ADR-0034), and marks the preview `committed` with `created_count`, all
  in the one transaction. A failure rolls back every insert. A validation-type failure marks the preview `failed` in a
  later transaction with a stable code; an unexpected failure is retried three times, then becomes
  `IMPORT_COMMIT_FAILED`. A crash before commit rolls back; a crash after commit replays a terminal preview without a
  second insert.
- FR-010: the recovery sweep fails, with `IMPORT_COMMIT_FAILED`, a services request still `commit_requested` ten
  minutes after `requested_at`, in batches of at most 50, conditionally (a job that commits between the read and the
  update wins), once the worker, database and Redis are up. It never re-enqueues.
- FR-011: `GET .../previews/{previewId}` returns `{ preview_id, status, created_count, error_code }` to the creator
  only; another user's, tenant's, business's or entity's preview is the same unknown-preview refusal.
- FR-012: the admin screen `catalog/import` mirrors the employee import screen (journey 27): template download, file
  pick and upload, preview with the per-row error table, commit disabled until clean, polling every second for at most
  two minutes with a bilingual "still running" state, and the last accepted preview id kept per
  company, business and user in session storage so reopening the page reads its status again. A link to it sits on the
  services list.
- FR-014: **the preview shows what will be saved.** Besides counts and errors, the preview returns the normalized
  rows the commit will insert, in sheet order. **Only error-free rows are returned**; a row with an error appears in
  `errors` by its row number and column and is never echoed back, so there is no half-valid row to represent, and the
  two lists align by `row`. A clean preview, the only one that can commit, returns every row. Each row is `{ row, name_en, name_ar, price, duration_minutes, category_id, category_name_en, commission_rule, commission_value,
  commission_rule_defaulted, counts_toward_threshold }`, with `price` the 3-decimal string, `commission_rule` the
  contract shape and `commission_value` the normalized value of D-9, shown beside the rule on screen (never a number for money); `duration_minutes` is an integer or null, and `category_id` and `category_name_en` are the matched open category or null (SI-Q6 to SI-Q8). The POST
  response carries the first 100 rows and a `next_cursor`; `GET .../previews/{previewId}/rows?cursor&limit` (1 to
  100) pages the rest, creator-only, with the same unknown-preview refusal as the status read. The screen lists them
  in a table, marks a defaulted rule ("حسب الخطة (افتراضي)" / "Follow plan (default)"), and keeps the commit button
  disabled until the preview is clean; a test must show the defaulted rule on screen. `commission_rule_defaulted` is
  stored with each row in `rows` (D-9). The status read stays small and returns no rows.
- FR-013: no strings in JSX; all text through `packages/i18n` keys in ar and en. RTL-safe CSS.

### Edge cases

- A formula cell is read as its cached result; an Excel error cell is `IMPORT_CELL_INVALID`.
- Data beneath an empty header is `IMPORT_COLUMN_UNEXPECTED` on that row.
- A row beyond 500 non-empty data rows refuses the workbook with `IMPORT_ROW_LIMIT_EXCEEDED` (501st row), even if the
  first 500 are valid.
- A row whose only filled cell is `name_ar` is a row with `name_en` missing: `IMPORT_REQUIRED_CELL` on `name_en`.
- A price of `0` is valid; `0.000` and `0` give the same stored value.
- A duration of `0`, `7.5` or `601` is `IMPORT_DURATION_INVALID`; a blank duration or category is "no value" (SI-Q6 to SI-Q8).
- Two rows with the same `name_en` and different categories are a duplicate (SI-Q9).
- A `category` cell `" hair  care "` matches the open category `Hair Care`; a cell naming a closed category, or a name
  that exists only in Arabic, is `IMPORT_CATEGORY_NOT_FOUND`.
- A row whose `name_en` equals a closed service of the business is `IMPORT_SERVICE_EXISTS` (FR-007).
- A category is closed between preview and commit: the whole commit fails with the top-level `error_code` `IMPORT_CATEGORY_NOT_FOUND`, nothing is saved (D-9).
- Two cells that differ only by case or surrounding spaces in `name_en` are the same name (FR-007).
- The business is deleted or nonexistent between preview and commit: the whole commit fails, nothing is saved.
- The caller loses `manage:services:business` after acceptance: the accepted commit still runs (D-3, IM-08).
- A manager previews, then another manager creates a service with the same name by hand, then the first commits:
  under SI-Q1 the worker refuses the whole import (`IMPORT_SERVICE_EXISTS`, status `failed`,
  nothing saved), except for the instant-race described in FR-007.
- An xlsx accepted as an employee document: still refused (employee documents keep PDF/JPEG/PNG only, ADR-0034).
- Preview retention (IM-Q3 of spec 030) applies unchanged: the preview rows hold service names and prices, no
  personal data; the cleanup slice of IM-Q3 will cover the `services` entity too and is not opened again here.

## Slice design

### Schema changes

**None for the import itself (32b-0 to 32b-6).** The question "does a new import kind need a migration?" is answered from the code, not assumed. The migrations of this work belong to the category and attribute sub-PRs `32b-cat-1`, `32b-pre-1` and `32b-cat-2`, described after the table:

| Item | Finding | Source |
|---|---|---|
| Table for previews | `import_previews` already holds `entity text` under `CHECK (entity ~ '^[a-z][a-z0-9_]{1,31}$')`; `'services'` matches; the schema comment says the table is reused for services, customers and open packages | `packages/db/schema/staff-import.ts`, migration 0077 |
| Status machine and counts | `status IN ('ready','commit_requested','committed','failed')`, `created_count` 0 to 500, `row_count` 0 to 500, committed/failed/requested consistency checks: all entity-agnostic | migrations 0077, 0079, 0080 |
| RLS and grants | policies are `company_id = app_company_id()` only; `pospay_app` has SELECT, INSERT and column UPDATE on the status columns; nothing mentions an entity | migrations 0078, 0079, `packages/db/test/import-grants.ts` |
| File type | `file_objects_type` already allows the xlsx MIME | migration 0077 |
| Services table | unchanged by the import PRs; it gets two additive nullable columns from `32b-pre-1` (below); `services` rows are written by the worker through the same columns create-service writes | `packages/db/schema/catalog.ts` |
| Permission and feature | `manage:services:business` and the `catalog` flag exist (spec 031); the import adds no permission and no seed migration (the category permission and its seed belong to `32b-cat-1`, below) | spec 031, `services.controller.ts` |

Consequences for the import: no new table, so **no new RLS policy and no new negative isolation test for a table**. The existing
`import_previews` isolation tests stay. The 500-row cap is a database CHECK, so raising it would need a migration;
this spec keeps 500. If 32b-0 finds a reason this table cannot be shared (for example a grant that must differ), the
sub-PR stops and amends this section; it does not add a table silently.

**Service categories (`32b-cat-1`, `32b-cat-1b`, `32b-cat-2`; SI-Q7, SI-Q11, SI-Q13 to SI-Q16, SI-Q19 to SI-Q22).** The closing rules follow
both owners' picks on SI-Q14 to SI-Q16 (2026-10-29).

- **`service_categories`** (new tenant table, `32b-cat-1`): key `(company_id, id)` (ADR-0007); `business_id uuid NOT
  NULL` with the composite foreign key `(company_id, business_id)` to `businesses`; `name_en text NOT NULL` and `name_ar
  text NOT NULL` (SI-Q13: both names required, Abu Salem's pick), each 1 to 100 characters after trim with no control
  character, stored normalized (trimmed, each run of whitespace collapsed into one space, in the case typed) and checked
  so by a CHECK as `name_ar` of `services` is; `closed_at timestamptz NULL`; `created_at`, `updated_at` and `revision`.
  - The **category key** is `lower(name_en)` of the stored, already normalized value, so trim, whitespace collapse and
    case fold together decide sameness (issue #709 item 1). A unique index `service_categories_business_name_uq` on
    `(company_id, business_id, lower(name_en))` covers open and closed rows: a closed category's name cannot be taken by
    a new one, and reopening it is the way back. The same index serves the list read and the import match. `name_ar` is
    not unique and is not a match key (issue #709 item 3; matching by the Arabic name would be a new owner question).
  - A second unique key `(company_id, business_id, id)` exists only as the target of the services foreign key below.
  - RLS policy `company_id = app_company_id()` and a negative isolation test (another tenant reads 0 rows; an insert or
    update for another tenant is refused). `pospay_app` gets SELECT, INSERT and column UPDATE on `name_en`, `name_ar`,
    `closed_at`, `updated_at` and `revision`; no DELETE: a category is closed, never deleted.
  - The table is reachable only through `withTenant()`, like every catalog table.
- **`services` columns:**
  - `duration_minutes smallint NULL` with `CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 600)`
    (SI-Q6, SI-Q8), `32b-pre-1`.
  - `category_id uuid NULL` (SI-Q7, SI-Q8), `32b-pre-1`, with the composite foreign key `(company_id, business_id,
    category_id)` → `service_categories (company_id, business_id, id)`: the key is composite (ADR-0007), and carrying
    `business_id` makes a category of another business impossible in the database, not only in the domain.
  - `closed_at timestamptz NULL` and `closed_by_category_id uuid NULL`, `32b-cat-2`. A service is closed when
    `closed_at` is set. `closed_by_category_id` is set only when the service was closed by closing its category, and is
    the marker that reopening the category reads (SI-Q16). Two CHECKs: `closed_by_category_id IS NULL OR closed_at IS
    NOT NULL`, and `closed_by_category_id IS NULL OR closed_by_category_id = category_id`, so the marker always names the
    service's current category. **Moving a service to another category clears its marker**: a service closed with
    category A and then moved to B stays closed, now on its own, and reopening A does not reopen it.
  - One index `services_business_category_idx` on `(company_id, business_id, category_id)` for the list filter (SI-Q10),
    the close cascade and the reopen restore. Because the CHECK above makes the marker equal `category_id`, the reopen
    restore filters `category_id = X AND closed_by_category_id = X` and uses this index; no second index is needed. It is created `CONCURRENTLY` in its own second migration file of
    `32b-pre-1`, whose leading statement is the `CREATE INDEX CONCURRENTLY`: the ADR-0033 pattern of migration 0068,
    which the runner executes outside a transaction and recovers if a build was interrupted.
  - The UPDATE grant on `services` is column-level (migration 0084), so `32b-pre-1` adds `duration_minutes` and
    `category_id` and `32b-cat-2` adds `closed_at` and `closed_by_category_id`; the grants test
    `packages/db/test/catalog-grants.ts` follows each.
  - Additive and nullable, so expand/contract holds: running code ignores the columns, there is no backfill, and no
    value is invented for the services that already exist (they stay open, with no duration and no category).
- **Permission (new, seeded in `32b-cat-1`):** `manage:service-categories:business` for create, rename, close and
  reopen, with the role defaults owner, general manager and business manager (SI-Q11 as amended by SI-Q22: the branch manager manages categories through `manage:service-categories:branch`, see «Branch-level categories» below), seeded by a
  migration as migration 0057 seeds role permissions. A second new permission, `read:service-categories:business`,
  guards the business-wide category reads, with the defaults owner, general manager and business manager. The branch
  manager, whose branch-scoped membership cannot satisfy a `:business` permission in the PR 7 matrix (spec 031), reads
  categories through `read:service-categories:branch` and the branch view instead (see «Branch-level categories»
  below), so the check this bullet once asked of the design advisors is settled.
- **Branch-level categories (SI-Q19 to SI-Q22, both owners' picks of 2026-10-29).** They amend the
  permission bullet above and the closing rules below, and resolve the branch-manager check that bullet asked for: a
  branch manager now acts on categories only inside their own branch, through `:branch` permissions the PR 7 matrix
  already expresses (a `BRANCH` grant covers a target that carries that branch).
  - **Owner and visibility (SI-Q19).** `service_categories` gains `owner_branch_id uuid NULL`, with a composite foreign
    key `(company_id, business_id, owner_branch_id)` → `branches (company_id, business_id, id)` (the existing unique key
    `branches_company_business_id_key`, migration 0038), so the owner branch is always a branch of the
    category's business, and `visibility text NOT NULL` with `CHECK (visibility IN ('BUSINESS', 'BRANCH'))`. The index
    `service_categories_owner_branch_idx` on `(company_id, business_id, owner_branch_id)` serves that foreign key and the
    branch view's "owned by that branch" and "other branches' private ones" filters; it is created in the `32b-cat-1`
    migration that creates the table. A category created at business level has no owner branch and is `BUSINESS`. A
    category created from a branch records that branch, and its creator picks `BUSINESS` (shared with every branch) or
    `BRANCH` (private to the owner branch). A `BRANCH` category always has an owner branch (CHECK). The name key stays
    business-wide (`service_categories_business_name_uq` is unchanged): two branches cannot each create their own
    «صبغة»; the second is offered the existing category to enable instead.
  - **Sharing goes one way (SI-Q23).** A private category can be made shared (`BRANCH` → `BUSINESS`); a shared category is never
    made private again, through any route. Making a shared category private would take it out of every other branch
    that uses it, which is exactly what SI-Q22's pick refuses («فرع واحد مايوقفش شغل الفروع التانية»). For the same
    reason the owner branch renames only its own private categories; a shared category, whoever created it, is renamed
    through the business route. A branch that no longer wants a shared category hides it (SI-Q22).
  - **Enabling another branch's category (SI-Q20).** A new tenant table `service_category_branch_settings`
    (`32b-cat-1b`): `id uuid` (UUID v7) with the primary key `(company_id, id)` (ADR-0007) and the unique business key
    `service_category_branch_settings_branch_category_uq` on `(company_id, branch_id, category_id)`; the composite
    foreign key `(company_id, business_id, branch_id)` → `branches (company_id, business_id, id)`
    (`branches_company_business_id_key`) has its own index `service_category_branch_settings_branch_idx` on
    `(company_id, business_id, branch_id)`, since the unique key's column order cannot serve it; the composite foreign key `(company_id, business_id, category_id)` → `service_categories (company_id, business_id, id)`
    has its own index `service_category_branch_settings_category_idx` on `(company_id, business_id, category_id)`.
    Carrying `business_id` keeps the branch and the category in the same business. `state text NOT NULL CHECK (state IN
    ('ENABLED', 'HIDDEN'))`, `updated_at` and `revision`. RLS `company_id = app_company_id()`, a negative isolation
    test and a grants test. `pospay_app` gets SELECT, INSERT and column UPDATE on `state`, `updated_at` and `revision`,
    and no DELETE. A category is **in use** in a branch when it is open, has no `HIDDEN` row for that branch, and is
    either `BUSINESS`, owned by that branch, or has an `ENABLED` row for that branch. A `HIDDEN` row wins over
    ownership, so a branch can stop using any category, its own private ones included, without touching another
    branch: hiding its own private category takes it off its own lists, and branches that enabled it keep it. Any
    branch may enable another branch's private category without asking (Waleed's pick).
  - **A category only groups (SI-Q21).** Whether a category is in use in a branch changes what that branch's lists
    and filters show, never what it can sell: a service under a category not in use in a branch is still offered and
    recorded there exactly as today. The session-service-options query and the catalog reader do not read
    `service_category_branch_settings`.
  - **Closing from a branch (SI-Q22).** A branch manager who "closes" a category hides it in their own branch only (a
    `HIDDEN` row). It stays in use elsewhere and no service is touched. The close that closes the category and its
    services in every branch (SI-Q14, SI-Q16) needs `manage:service-categories:business`, whose defaults become owner,
    general manager and business manager. This replaces Waleed's SI-Q15 pick (branch manager) for the business-wide
    close.
  - **Permissions.** `manage:service-categories:business` (owner, general manager, business manager): create at
    business level, rename any category, make any private category shared, and close and reopen with the cascade. New
    `manage:service-categories:branch` (owner, general manager, business manager **and branch manager**): create a
    category owned by the route's branch, rename that branch's own private categories and make them shared, and enable
    or hide any category of the business in that branch. `read:service-categories:business` drops the branch manager
    from its defaults (owner, general manager, business manager): a branch-scoped membership cannot satisfy a
    `:business` permission in the PR 7 matrix (spec 031), and the branch manager reads the same categories through the
    branch view. New `read:service-categories:branch` (owner, general manager, business manager and branch manager)
    reads the branch view. Both new codes and the changed default are seeded by the `32b-cat-1` migration. Branch
    routes are `/v1/businesses/{businessId}/branches/{branchId}/service-categories…`; the guard resolves the branch's
    business from the database, never from the client. A role that sets a category on a service while holding only
    `read:service-categories:branch` picks it from the branch view.
  - **Branch view read** (`32b-cat-1b`): `GET …/branches/{branchId}/service-categories?view=in_use|available`,
    cursor-paginated (CLAUDE.md §6) in the category key order of the business list, with a next cursor. `in_use` lists
    the categories in use in the branch; `available` lists the business's other open categories the branch may enable
    (other branches' private ones and the categories it hid). Each item is `{ id, name_en, name_ar, visibility,
    owner_branch_id, closed_at, revision, setting_state, setting_revision }`, where `setting_state` and
    `setting_revision` are the branch's settings row, both `null` when the branch has none. A result-shape test and an
    `EXPLAIN ANALYZE` assertion that the key-ordered page reads `service_categories_business_name_uq` and checks the
    settings row through `service_category_branch_settings_branch_category_uq`, with no sequential scan of either
    table.
  - **Writes added.** `POST …/branches/{branchId}/service-categories` `{ name_en, name_ar, visibility }` → 201
    (`32b-cat-1`). The branch `PATCH` on a private category owned by that branch accepts `{ name_en, name_ar,
    visibility, expected_revision }`, where `visibility` may only become `BUSINESS` (`32b-cat-1`); the business `PATCH`
    accepts the same `visibility` change on any private category. Any other visibility change, and a branch rename of a
    shared category, is refused with `SERVICE_CATEGORY_VISIBILITY_FIXED` (409). So the `pospay_app` column UPDATE grant
    on `service_categories` adds `visibility` (never `owner_branch_id`, which is fixed at creation), and the grants
    test covers it. `PUT …/branches/{branchId}/service-categories/{categoryId}/state` `{ state, expected_revision }`
    → 200 (`32b-cat-1b`): `expected_revision` is `null` when the branch has no settings row yet (the first write
    inserts it at revision 1, and a concurrent first write loses on the unique key and is refused with the same 409
    as a stale revision), and the row's `setting_revision` afterwards. The state write locks the category row first
    (`FOR SHARE`, the lock order below), so it never interleaves with a close or a visibility change. Every write is
    audited.
  - **Settled for `32b-cat-2`:** closing a single service stays with the owner, general manager and business manager
    (SI-Q17, Abu Salem's pick), so no branch-scoped membership needs a `:business` permission there.
- **One lock order for every category write** (`32b-cat-1`, `32b-pre-1`, `32b-cat-2`, `32b-3`): a transaction that
  closes, reopens or renames a category locks its row first (`SELECT … FOR UPDATE`); a transaction that sets a
  `category_id` on a service (create-service, update-service, the import commit) locks the referenced category rows
  `FOR SHARE`, in ascending `id` order, before it checks that they are open, and then writes the service. A close and an
  assignment therefore run one after the other, never interleaved, so no open service can land under a category that
  closed in between. Create-service and update-service lock the category rows they touch (the current and the new category, ascending
  `id`, `FOR SHARE`) **before** they load the service row `FOR UPDATE`, so an edit inside a category and a close of
  that category take their locks in the same order and cannot deadlock; `32b-cat-2`, where close-category
  exists, adds a concurrent edit-in-category and close-category test. Closing and reopening a single service
  (`32b-cat-2`) follow the same order, because both change the category's `open_service_count`: each locks the service's category row
  `FOR SHARE`, then the service row `FOR UPDATE`, and checks under both locks that the service still has that
  category (and, for a reopen, that the category is open); if the category changed in between, it starts over. A
  service with no category locks only its own row. So a single-service close or reopen and a category close never
  interleave, the count a manager confirmed stays exact, and the category is always locked before its services.
  The category cascade locks its service rows explicitly (`SELECT … ORDER BY id FOR UPDATE`) before its set-based
  `UPDATE`, so it takes them in ascending `id` order, the same order an order recording takes them `FOR SHARE`; a
  cascade and a recording therefore wait for each other instead of deadlocking.
- **Every state change advances the revision**: closing, reopening, renaming and sharing (a visibility change) a
  category, and every service that a
  close or reopen touches, set `updated_at` and increment `revision`, so a client holding an older revision gets the
  stale-revision conflict.
- **Closing a category** (`32b-cat-2`, SI-Q14, SI-Q15 and SI-Q22): any holder of `manage:service-categories:business` (no longer the
  branch manager by default, SI-Q22) can close any category of the business, with or without services on it. In one transaction
  it sets the category's `closed_at` and closes every **open** service of it (`closed_at = now`,
  `closed_by_category_id = the category`); a service already closed keeps its own `closed_at` and gets no marker. One
  audit row for the category and one per service it closed.
- **Reopening a category** (`32b-cat-2`, SI-Q16): clears the category's `closed_at` and reopens exactly the services
  whose `closed_by_category_id` is this category (both columns cleared). A service closed before the category, or
  closed on its own, stays closed. One audit row for the category and one per service it reopened.
- **A closed category** cannot be picked for a new or edited service and is not offered by the form, the filter shows
  it with a closed mark, and the services that keep it show its name with that mark.
- **Closing a single service** (`32b-cat-2`): SI-Q14 needs a service closed state that spec 031 did not have (SV-09,
  SV-Q3). Closing and reopening one service needs a new permission, `close:services:business`, defaulted to the owner,
  general manager and business manager (SI-Q17: the owners differed, and Abu Salem's pick, the recommended option,
  replaces Waleed's «the branch manager too»), seeded by the `32b-cat-2` migration. It is separate from
  `manage:services:business` so that a custom role can be given the close without the edit; the branch manager holds
  neither. The close and reopen routes need `close:services:business` **and** `read:services:business`,
  so every caller that closes a service can find it and its revision through the services reads. `32b-cat-2` adds
  `@RequireAll([...])` to `apps/api/src/shared/access.decorators.ts`, beside `@RequireAny`: the same permission guard
  checks every listed permission (same scope, same target validation) in its one transaction and refuses with the
  uniform 403 when one is missing. The check stays in the guard, so the catalog use case reads no membership and
  `catalog` gains no import arrow (D-3, D-4), and no second transaction opens (the connection budget, CLAUDE.md §6). Reopening a service whose category is closed is refused with
  `SERVICE_CATEGORY_CLOSED`, and reopening a service clears its marker.
  - **The services reads are unchanged.** They stay behind `read:services:business` alone and return their full
    shape. `32b-cat-2` adds an integration test in which a default branch manager is refused the close and the reopen
    with the uniform 403, and one in which a role holding `close:services:business` without `read:services:business`
    is refused the same way.
  - **No order line after the close.** The catalog reader locks the requested service rows `FOR SHARE`, in ascending
    `id` order, inside the order-recording transaction before it checks `closed_at`; close-service, reopen-service and
    the category cascade lock the service rows `FOR UPDATE`. A close and a recording therefore serialize: the
    recording either commits first (its line stands, like any line recorded before the close) or sees the service
    closed and is refused with `SERVICE_CLOSED`. `32b-cat-2` adds a test for each order.
- **What closed means for selling** (`32b-cat-2`, SI-Q18, both owners' pick, the recommended option): a
  closed service is not offered for a new order line (the session-service-options query
  `apps/api/src/modules/catalog/queries/session-service-options.query.ts` leaves it out), and the catalog reader that
  `orders` calls refuses it at record time with `SERVICE_CLOSED`; an order line recorded before the close is
  untouched. Abu Salem's note on SI-Q18 extends this to self-service: no self-service or public menu catalog exists
  yet (`apps/menu` is not built), and the first query that offers services there must leave closed services out too;
  `32b-cat-2` lists every query that offers services for sale at the time it merges, and the dashboard lists keep
  showing a closed service with its closed mark. `CatalogReaderPort` is an `orders` port whose adapter is
  `apps/api/src/modules/orders/persistence/catalog-reader.adapter.ts`, so this touches the `orders` module: `32b-cat-2`
  says so in its PR (CLAUDE.md §1.4) and lists every caller of the reader it changes.
- **Category list read** (`32b-cat-1`; it replaces the free-text suggestions search, which SI-Q7 made unnecessary):
  `queries/service-categories.query.ts`, `GET /v1/businesses/{businessId}/service-categories?status=open|closed|all`
  (default `open`) → 200, cursor-paginated (CLAUDE.md §6), items `{ id, name_en, name_ar, visibility, owner_branch_id, closed_at, revision }`
  ordered by the category key. Read-only, behind `read:service-categories:business` and the `catalog` feature; Zod schemas in a
  new `packages/contracts/src/catalog/service-category.ts`; a result-shape test and an `EXPLAIN ANALYZE` assertion on
  `service_categories_business_name_uq`.
- **Category writes** (Zod schemas in `service-category.ts`; error envelope of CLAUDE.md §6; no money or stock effect,
  so no `Idempotency-Key`):
  - `POST /v1/businesses/{businessId}/service-categories` `{ name_en, name_ar }` → 201 the category (`32b-cat-1`).
  - `PATCH /v1/businesses/{businessId}/service-categories/{categoryId}` `{ name_en, name_ar, visibility?,
    expected_revision }` → 200 (`32b-cat-1`); a closed category can be renamed, and `visibility` may only turn a private
    category shared («Sharing goes one way» above).
  - `POST …/service-categories/{categoryId}/close` and `…/reopen` `{ expected_revision, expected_service_count }`
    → 200 the category with `services_closed` or `services_reopened` (`32b-cat-2`). `expected_service_count` is the
    `open_service_count` (close) or `marked_service_count` (reopen) the manager confirmed; assigning a service to a
    category does not advance the category's revision, so the use case recounts under the category lock and refuses a
    different count with `SERVICE_CATEGORY_COUNT_CHANGED` (409), and the screen reloads the count and asks again. The
    revision and both counts come from the category detail read, so these routes are guarded by
    `@RequireAll(['manage:service-categories:business', 'read:service-categories:business'])` the same way, and
    `32b-cat-2` tests that a role holding only the manage permission is refused.
  - `POST /v1/businesses/{businessId}/services/{serviceId}/close` and `…/reopen` `{ expected_revision }` → 200 the
    service (`32b-cat-2`), in the same shape as the service detail read.
  - Errors: `SERVICE_CATEGORY_NAME_INVALID` (422), `SERVICE_CATEGORY_NAME_TAKEN` (409, the category key is in use, open
    or closed), `SERVICE_CATEGORY_NOT_FOUND` (404, also for another business or tenant), `SERVICE_CATEGORY_ALREADY_CLOSED`
    and `SERVICE_CATEGORY_NOT_CLOSED` (409), `SERVICE_ALREADY_CLOSED` and `SERVICE_NOT_CLOSED` (409),
    `SERVICE_CATEGORY_CLOSED` (409, reopening a service under a closed category), `SERVICE_CATEGORY_COUNT_CHANGED` (409,
    the services under the category changed after the confirmation), and the standard stale-revision 409.
- **Category detail read** (`32b-cat-2`): `GET …/service-categories/{categoryId}` → the category plus
  `open_service_count` (services a close would close) and `marked_service_count` (services a reopen would reopen), two
  counts on `services_business_category_idx` with an `EXPLAIN ANALYZE` assertion. The close and reopen confirmations of
  `32b-cat-3` show these counts; the close and reopen responses return the counts actually changed.
- **The services list filter** (`32b-pre-1`, SI-Q10): the services list read takes an optional `category_id`, uses
  `services_business_category_idx`, and gets its own `EXPLAIN ANALYZE` assertion; the list items carry `category_id`,
  the category names and whether the category is closed. The service's own `closed_at` joins the detail and list
  projections in `32b-cat-2`, the PR that adds the column.
- The database review of pipeline §5 is mandatory for `32b-cat-1`, `32b-cat-1b`, `32b-pre-1` and `32b-cat-2`.

### API contract

Contracts in `packages/contracts/src/catalog/service-import.ts` (Zod) with OpenAPI registration; the column enum and
the row error enum are the service import's own (not the employee import's).

- `GET /v1/businesses/{businessId}/services/import/template` → 200 `{ file_name, content_type, content_base64 }`.
- `POST /v1/businesses/{businessId}/services/import/previews` → 201
  `{ preview_id, row_count, error_count, errors: [{ row, column, code }], rows: [normalized row], next_cursor }`
  (FR-014: the first 100 normalized rows); body `{ file_id }`.
- `GET /v1/businesses/{businessId}/services/import/previews/{previewId}/rows?cursor&limit` → 200
  `{ items: [normalized row], next_cursor }`, cursor by sheet row number, limit 1 to 100, creator only.
- `POST /v1/businesses/{businessId}/services/import/commits` → 202 `{ preview_id }`; body `{ preview_id }`;
  `Idempotency-Key` required.
- `GET /v1/businesses/{businessId}/services/import/previews/{previewId}` → 200
  `{ preview_id, status: ready|commit_requested|committed|failed, created_count, error_code }`.
- All five: `@Require('manage:services:business', { business: 'businessId' })`, `@RequiresFeature('catalog')`.
  Template, status and rows are reads, preview is a write of a preview row only (no money or stock effect, so no
  `Idempotency-Key`), commit requires the key (CLAUDE.md §6). The static `import/...` paths do not collide with
  `services/:serviceId` (different segment count); a route test proves it.
- Column enum: `name_en`, `name_ar`, `price`, `duration_minutes`, `category`, `commission_rule`, `commission_value`, `counts_toward_threshold`,
  `unexpected_column`.
- Row error codes: `IMPORT_REQUIRED_CELL`, `IMPORT_NAME_INVALID`, `IMPORT_PRICE_INVALID`,
  `IMPORT_COMMISSION_RULE_INVALID`, `IMPORT_COMMISSION_VALUE_INVALID`, `IMPORT_BOOLEAN_INVALID`, `IMPORT_DURATION_INVALID`, `IMPORT_CATEGORY_NOT_FOUND`,
  `IMPORT_CELL_INVALID`, `IMPORT_COLUMN_UNEXPECTED`, `IMPORT_DUPLICATE_IN_FILE`, `IMPORT_SERVICE_EXISTS`.
- Request-level errors, the same family as spec 030 with the same statuses: `IMPORT_FILE_NOT_FOUND` (404),
  `IMPORT_FILE_NOT_READY` (409), `IMPORT_FILE_TYPE_INVALID` (415), `IMPORT_FILE_SIZE_INVALID` (413),
  `IMPORT_PREVIEW_NOT_FOUND` (404), `IMPORT_PREVIEW_EXPIRED` (409), `IMPORT_HEADER_INVALID` (422),
  `IMPORT_ROW_LIMIT_EXCEEDED` (422), `IMPORT_PREVIEW_HAS_ERRORS` (409), `IMPORT_FILE_CONTENT_INVALID` (422),
  `STORAGE_UNAVAILABLE` (503), `IMPORT_COMMIT_FAILED` (status field only), plus the standard access, validation and
  retry envelopes. Error envelope `{ code, message_ar, message_en, details? }`.

### Permissions

`manage:services:business` for all five routes (the rows read included, never `read:services:business`), defaults as spec 031 (owner, general manager, business manager);
Branch Manager and Device are refused by the PR 7 matrix. The import adds no permission, no role default change and no
seeding migration. `read:services:business` is not enough to import. The category management permission
`manage:service-categories:business` (SI-Q11) is a separate permission of `32b-cat-1` (see Schema changes); holding it
does not let a branch manager import services.

### Events

- **Published:** `ServiceImportCommitRequested` (D-5), emitted by the acceptance transaction; transported to the
  `service-import-commit` job by the catalog worker after the outbox claim commits (ADR-0018), which also registers the
  per-company recovery sweep before publishing the job (ADR-0022 protocol, as for the employee import).
- **Not published:** any per-service event, any summary event (D-5, SV-10).
- **Consumed:** none from other modules.

### The 200 ms rule

Acceptance is one short transaction (warm integration assertion under 200 ms). The commit of up to 500 inserts and 500
audit rows runs in the worker. The synchronous preview is measured in 32b-2 (D-7). Template download stays synchronous.

The category close and reopen cascades (`32b-cat-2`) stay synchronous only while they fit the budget: each is one
set-based `UPDATE` of the matching services plus one `INSERT … SELECT` of their audit rows, never a row-by-row loop.
`32b-cat-2` measures a warm close and reopen of a category holding 1,000 services against 200 ms. No maximum number
of services per category exists today, so a measured 1,000 does not by itself bound the work: before `32b-cat-2`
the design advisors pick either the worker for every cascade or a synchronous path for categories up to the measured
size with the worker above it, and if they do not fit at all, the design advisors move the cascade to the worker (a durable command with status and retries, like the import
commit), and `32b-cat-2` stops and asks Waleed before it goes on (a technical question, never on the decisions page).

### Test plan

- **Domain unit** (`catalog/domain`, no database): the cell converters (price strings: `12.5`, `0`, `7.500`, `7.5555`,
  `-1`, `1e21`, `١٢`, `10^11`; boolean tokens; the kind token; the percent-to-bps conversion for `20`, `12.5`, `12.55`,
  `12.555`, `100`, `100.01`, `0`, and percentage-formatted cells `0.07` (7%) and `0.2` (20%), tested as step (a) giving the percent text `"7"` and `"20"` and step (b) giving `700` and `2000` basis points), the mapping from each `ServiceError` code to a column and code, the duplicate-key
  function, and the plug-in over a full matrix (all valid; each error code once; many errors in one file, all
  reported).
- **Attribute rules** (`32b-pre-1`, domain unit, no database): duration `1` and `600` valid; `0`, `601`, `-5` and `7.5` invalid; a `category_id` that is unknown, of another business or of a closed category; the named errors `SERVICE_DURATION_INVALID`, `SERVICE_CATEGORY_NOT_FOUND` and `SERVICE_CATEGORY_CLOSED`. The create and update integration tests cover setting, clearing, a stale revision, another tenant, and the audit row content. `validateServiceDuration` is tested on its own (each returns its error or null), and `validateServiceDraft` is tested to compose them. The import cell converters add: duration cells `120`, `"120"`, `7.5`, `0`, `601`, a numeric `1e2` (accepted as 100), a text `"1e2"` (refused), and a numeric `1e21` and a 16-digit value (`IMPORT_DURATION_INVALID`), and category cells (an exact name, a name differing in case and spaces, a closed category's name, an Arabic-only name, a blank); one row with a bad duration and an unknown category reports both.
- **Category rules and use cases** (`32b-cat-1`, `32b-cat-2`): the domain unit tests of the category names (1 and 100 characters, 101, empty after trim, a control character, the normalization); the database tests of the unique key (two names that differ only in case or spaces collide, also with a closed category), the composite foreign key (a category of another business is refused), the RLS negative test and the grants test; the integration tests of create, rename, close and reopen (a close closes only the open services of the category and marks them; a reopen reopens only the marked ones and leaves a service closed before it closed; a default branch manager is refused the business-wide close and reopen (403) and can only hide the category in their branch (`32b-cat-1b`); a role without the permission is refused; the audit rows), of closing and reopening a single service (refused under a closed category), of moving a closed service to another category (its marker cleared; reopening the old category leaves it closed), of the revision advancing on every close and reopen, of a concurrent close and service assignment (the assignment waits for the lock and is then refused), of the category detail counts, of the session-service-options query leaving closed services out, and of the catalog reader refusing a closed service at record time.
- **Sheet adapter** (moved code): `tagCells` is tested here, in `shared/import`, without any services knowledge (an Excel error cell gives `{ kind: 'error' }`, and a `20%` cell read through the formats matrix reaches the plug-in with `percentFormat: true` and becomes 2000 basis points): `0.57` gives `"0.57"`, `2.3` gives `"2.3"`, `1e21` and a 16-digit value give `numeric-unrepresentable`, a boolean cell gives `{ kind: 'boolean' }`, and `percentFormat` is true for `0%`, `0.00%` and `0%;-0%` and false for `0.0"%"`, `0\%`, `General` and `0.000`; the domain plug-in tests receive only tagged cells, including a boolean `counts_toward_threshold` cell and a row with a 16-digit price (`IMPORT_PRICE_INVALID`) beside a second error in the same row, both reported; the existing staff adapter tests run unchanged against the moved module; new tests
  for the services header set (missing, extra, duplicate, empty; a legacy template with neither new header, a file with only `duration_minutes`, a file with only `category` and a file with both import as no value for the absent column (the header pre-selection of FR-001), while a missing required header is refused), 500 and 501 rows, a 2 MiB plus 1 byte file.
- **Integration scenarios**, against the real Postgres of the compose stack with a cloned database per spec file
  (CLAUDE.md §9):
  - SIT-01 template download, bilingual headers, reference sheet.
  - SIT-02 preview with one invalid row writes no service; every bad row is reported.
  - SIT-16 an Excel error cell in `name_ar`, in `counts_toward_threshold` and in `commission_rule` is `IMPORT_CELL_INVALID` on its own column in each case, and never becomes "no Arabic name", `true` or `FOLLOW_PLAN`.
  - SIT-03 preview then commit: all services created once, each with revision 1 and one audit row, `created_count` right.
  - SIT-04 commit failure (business deleted between preview and commit) saves nothing and marks the preview `failed`.
  - SIT-05 concurrent double commit: one acceptance, one event, one effect; redelivery after commit inserts nothing.
  - SIT-06 expired, used and creator-mismatch previews refused.
  - SIT-07 another tenant's and another business's file and preview answer as unknown; a services preview polled
    through the employee import status route is unknown, and an employee preview polled through the services route is
    unknown.
  - SIT-08 permission refused (a role without `manage:services:business`, a Device); feature flag off.
  - SIT-09 idempotent repeat of the commit with the same key; a different key for the same preview returns the same
    acceptance.
  - SIT-10 duplicate-name rules (SI-Q1, SI-Q2): existing name, in-file duplicate, case and whitespace
    variants, the same name in another business of the same company (not a duplicate).
  - SIT-11 crash and retry: a job killed before commit rolls back; after commit it is a no-op.
  - SIT-12 the recovery sweep fails a stale `commit_requested` services preview and never touches an employee preview;
    staff's sweep never touches a services preview.
  - SIT-14 the preview response and the rows read carry every normalized row in sheet order, a blank commission rule
    appears as `FOLLOW_PLAN` with `commission_rule_defaulted` true and `commission_value` null (`PCT` 20 percent shows 2000, `FIXED` 0.5 shows `"0.500"`), the worker inserts exactly the stored rule and value, money is a 3-decimal string, paging by cursor
    returns all rows once, and another user's or tenant's preview answers as unknown.
  - SIT-15 two clean previews of the same file for one business committed at the same time: one creates the services,
    the other is refused whole and saves nothing; the audit rows of the first name the manager who requested it.
  - SIT-13 route precedence: `GET services/import/template` is not read as a service id.
  - SIT-17 (SI-Q6 to SI-Q9) the template carries the duration and category columns and the reference sheet lists the open categories; a row with a bad duration and a bad category reports both; a clean preview shows both values; the worker inserts them; blank cells insert null; a legacy file without the two headers, and a file with only one of them, imports with null for the absent column.
- **RLS:** no new table, so no new table-level test; the existing `import_previews` negative tests remain, and SIT-07
  adds the cross-entity and cross-business cases.
- **Queries:** the status read and the rows read are `queries/` files, each with a result-shape test and an `EXPLAIN`
  assertion that it uses the primary key `(company_id, id)`; the existing-names read has an `EXPLAIN` assertion on its business-scoped index; the category list read (`32b-cat-1`) has a result-shape test and an `EXPLAIN` assertion on `service_categories_business_name_uq`, and the services list filter (`32b-pre-1`) one on `services_business_category_idx`.
- **Performance:** the 500-row maximum-field-length preview benchmark (D-7) and the acceptance assertion.
- **Admin UI** (asserts what the user sees, CLAUDE.md §9): template download, upload and preview with the per-row
  error table in both languages, the table of resolved rows showing a defaulted commission rule as such, commit disabled until clean, the queued state, the result count, the delayed state
  after two minutes, reopening the page re-reading the status.

## Success Criteria

### Measurable Outcomes

- **SC-001**: A manager can import a 40-service menu from a filled workbook in under five minutes, from opening the
  import page to seeing every service in the list.
- **SC-002**: An import with any invalid row saves no service; the preview names every invalid row and column in one
  pass, so the manager fixes the file once rather than discovering errors one at a time.
- **SC-003**: A clean preview creates exactly its rows, once, with one audit entry per service, even when the button
  is pressed twice or the request is repeated.
- **SC-004**: No service, file or preview of another company or another business can be read, previewed or committed,
  and the answer never tells "does not exist" apart from "not yours".
- **SC-005**: No imported price or commission amount differs from the cell by even one mill; a cell with more than
  three decimals is refused, never rounded.
- **SC-006**: Importing the same file twice, even from two screens at the same moment, does not double the menu
  (SI-Q1).
- **SC-007**: Both languages show the same template, preview and error feedback.

## Assumptions

- Admin is online; the commit needs the worker, Redis and storage running, as for the employee import; without storage
  the preview answers `STORAGE_NOT_CONFIGURED`.
- The business has no limit on the number of services, but one workbook holds at most 500 rows; a larger menu is
  imported in more than one file.
- Token spellings for the boolean column (`yes`/`no`, `نعم`/`لا`) and the case-insensitive rule kind are
  non-business conveniences; the reference sheet of the template lists the accepted spellings.
- Every service imported has the exact semantics of one created by hand; nothing about commission calculation
  changes (SPEC §5 consumes the rule as stored).
- No new external dependency. `exceljs` and `saxes` stay where ADR-0034 pinned them.
- The decisions D-1 to D-9 are checked by the design advisors in 32b-0 before code; a change they make is written back
  into this spec in the same PR.

## Open questions for the owner

Recorded in `owner-questions.ar.md` (Arabic, with options, a recommendation and a salon example each). SI-Q1 to SI-Q16
were published on the decisions page and sent to Waleed as cards; SI-T1 is technical and went to Waleed only; SI-Q17
to SI-Q24 were answered by Waleed by card and by Abu Salem on the decisions page on 2026-10-29.

| Id | Kind | Question | Answer | Rule it settles |
|---|---|---|---|---|
| SI-Q1 | feature (decisions page) | An existing service with the same name | Both owners: refuse the row, save nothing | FR-007, SI-09, SC-006 |
| SI-Q2 | feature | The same name twice inside the file | Both owners: refuse both rows | FR-007, SI-09 |
| SI-Q3 | feature (money) | A blank commission rule | Both owners: `FOLLOW_PLAN`, shown in the preview | FR-004 |
| SI-Q4 | feature (money) | The unit of a percentage cell | Both owners: plain percent, converted to basis points by string handling | FR-006 |
| SI-Q5 | feature | Duration and category columns | Both owners, **against the recommendation**: add them to the service first, then the import | Scope decision 1, FR-004 |
| SI-T1 | technical (Waleed only) | How catalog reads the uploaded file | Waleed, final: ports wired from outside, no new import arrow | D-4 |
| SI-Q6 | feature | Duration: unit and limits | Both owners: whole minutes, 1 to 600; blank is no duration | FR-004, `32b-pre-1` |
| SI-Q7 | feature | Category: shape | Both owners, **against the recommendation**: a managed list per business | Schema changes, FR-004, `32b-cat-1` |
| SI-Q8 | feature | Duration and category required or optional | Both owners: both optional; existing services unchanged | FR-001, FR-004 |
| SI-Q9 | feature | Does the category change what counts as the same service | Both owners: no, the name alone decides | FR-007 |
| SI-Q10 | feature | Filter or group the services list by category now, or later | Both owners, **against the recommendation**: filter now | FR-004, `32b-pre-1`, `32b-pre-2` |
| SI-Q11 | feature | Who manages the category list by default | Both owners: owner, general manager, business manager and branch manager | Schema changes (permission), `32b-cat-1` |
| SI-Q12 | feature | What a category close does to its services | Replaced by SI-Q14 (Abu Salem's pick and comment disagreed) | — |
| SI-Q13 | feature | Is the Arabic name required too | The owners differed; Abu Salem's pick binds: both names required | Schema changes, `32b-cat-1` |
| SI-Q14 | feature | Do the services close with their category | Both owners: yes (Abu Salem: the cashier no longer sees them) | Schema changes (closing), `32b-cat-2` |
| SI-Q15 | feature | Who can close a category that has open services | Waleed: the branch manager too, any category; for the business-wide close this is replaced by his SI-Q22 pick (owner, general manager and business manager; a branch manager hides in their branch only). Abu Salem: the same pick | Schema changes (closing), `32b-cat-2` |
| SI-Q16 | feature | What reopening a category does | Both owners: it reopens the services closed with it; those closed before stay closed | Schema changes (reopening), `32b-cat-2` |
| SI-Q17 | feature | Who can close and reopen a single service | The owners differed; Abu Salem's pick binds (the recommended option): owner, general manager and business manager (`close:services:business`). Waleed had picked the branch manager too | Schema changes (closing a single service), `32b-cat-2` |
| SI-Q18 | feature | What a closed service means for selling | Both owners (recommended): not offered for a new order line and refused at record time; past order lines untouched (Abu Salem: shown as closed in the dashboard only) | Schema changes (what closed means), `32b-cat-2` |
| SI-Q19 | feature | Who a category is made for | Waleed (free text, the recommended option): created at business level or from a branch, shared or private to the branch; any branch can enable others' categories or make its own. Abu Salem: the same pick | Branch-level categories, `32b-cat-1`, `32b-cat-1b` |
| SI-Q20 | feature | Enabling another branch's private category | Both owners (recommended): without asking | `32b-cat-1b` |
| SI-Q21 | feature | A service under a category not in use in a branch | Both owners (recommended): the category only groups; the service sells everywhere | Branch-level categories |
| SI-Q22 | feature | A branch manager closing a shared category | Waleed (recommended): hidden in their branch only; the business-wide close stays with owner, general manager and business manager (replaces his SI-Q15 pick for that close). Abu Salem: the same pick | `32b-cat-1b`, `32b-cat-2` |
| SI-Q23 | feature | Can a shared category become private again, or be renamed by its branch | Both owners (recommended): no, shared stays shared; renamed at business level only | «Sharing goes one way», `32b-cat-1` |
| SI-Q24 | feature | Can a branch hide its own private category | Both owners (recommended): yes, in its own branch only | «Enabling another branch's category», `32b-cat-1b` |

Abu Salem answered SI-Q14 to SI-Q24 on 2026-10-29 and differed only on SI-Q17, amended above. Had another pick
differed, it would have replaced Waleed's the same way: this spec and
`owner-questions.ar.md` are amended (the old answer kept as history), and `32b-cat-1`, `32b-cat-1b` and `32b-cat-2`
follow the new rule, through a follow-up if they have already merged. Such a follow-up is expand-only: a column or
table his pick makes unnecessary (`owner_branch_id`, `visibility`, `service_category_branch_settings`) stays in place
unused until a later contract release removes it, and a changed role default (the branch manager's place in
`manage:service-categories:business` or `read:service-categories:business`, SI-Q11) is restored by a seed migration. If SI-Q14 becomes "the services stay", SI-Q15 and SI-Q16 are read again (issue #709
item 4).

## Delivery: the sub-PR split

Owner rule 2026-10-12: at most three subtasks per PR. The plan row is sized S; once the framework has to be split from
staff and the worker gets a catalog module, the real work is several PRs, so the plan row's size should be updated by
the orchestrator when this spec merges. The answers to SI-Q5 and SI-Q7 add six PRs before the import (`32b-cat-1`, `32b-cat-1b` (SI-Q19 to SI-Q22), `32b-pre-1`, `32b-cat-2`, `32b-pre-2` and `32b-cat-3`), which the orchestrator records in the plan too. Sizes are hand-written lines including tests and copy.

Order: the category list and the service attributes (`32b-cat-1` to `32b-cat-3`, `32b-pre-1` and `32b-pre-2`) and the ADR first, then the pure rules, then the read side, then the write side, then the screen. The design
advisors (Codex `gpt-6-astra` and Claude Fable 5.1, read-only) are required before 32b-0, 32b-1 (money in cells), 32b-2 (parses files and may
approach 200 ms) and 32b-3 (worker, long work), pipeline §3 step 2.

| PR | Result | Subtasks | Blocked on | Size |
|---|---|---|---|---|
| **32b-cat-1** | The category list: storage, permission, create and rename, list read | 1. The contract first (`service-category.ts`: create, rename and list schemas, OpenAPI registration), then the migration: the `service_categories` table with `owner_branch_id` and `visibility` (SI-Q19), its CHECKs, the unique key, RLS, grants, the `manage:service-categories:business`, `read:service-categories:business`, `manage:service-categories:branch` and `read:service-categories:branch` permissions and their role defaults (SI-Q11 as amended by SI-Q22), the Drizzle schema. 2. The domain (`validateServiceCategoryNames`, the category key) with unit tests, and the create (business and branch routes) and rename use cases with audit rows (a branch renames its own private categories and may only make them shared, `SERVICE_CATEGORY_VISIBILITY_FIXED` otherwise) (rename locks the category row, the lock order of Schema changes). 3. HTTP, the cursor-paginated list read with its `EXPLAIN` test, the RLS negative test, the grants test, the integration tests (a shared category never made private, a branch rename of a shared category refused, a stale revision after sharing refused), and the database review | this spec merged; the single migration lane (the permission-scope check is settled by SI-Q19 to SI-Q22) | 600 to 850 |
| **32b-cat-1b** | Categories per branch: enable, hide, branch view (SI-Q19 to SI-Q22) | 1. The contract (the branch view read and the state write), then the migration: the `service_category_branch_settings` table, its CHECKs, composite foreign keys, RLS and column grants, the Drizzle schema. 2. The domain rule "in use in a branch" (a `HIDDEN` row wins over ownership) with unit tests, and the set-state use case with audit rows (the first write with `expected_revision` null, a hidden own private category, a stale or concurrent first write refused). 3. HTTP, the branch view read (`in_use`, `available`) with its `EXPLAIN` test, the RLS negative test, the grants test, the integration tests (enable another branch's private category, hide a shared one, a branch manager of another branch refused, services still sold in a branch that hid their category) and the database review | 32b-cat-1; the single migration lane | 450 to 650 |
| **32b-pre-1** | Duration and category on the service: contract, storage, rules, create/update and queries (one PR) | 1. The contract first, then the migrations: `createServiceInput`, `updateServiceInput`, `service` and `serviceListItem` carry `duration_minutes` and `category_id` (nullable, optional on input; on update an omitted field keeps the stored value and `null` clears it, so a client that does not know the fields yet cannot wipe them by omission, which is why this differs from the full replacement of `name_ar`), the list query's `category_id` filter, OpenAPI registration, the additive migration of Schema changes (columns, CHECK, the composite foreign key, the column-level UPDATE grant), a second migration with the concurrent index, the Drizzle schema. 2. The domain and the use cases: `validateServiceNameEn` and `validateServiceNameAr` (split from `validateServiceName`), `validateServiceDuration`, the category reference check (exists, same business, open, after a `FOR SHARE` lock on the category row), `toCommissionRule` exported, `validateServiceDraft` composing them (D-8), with domain unit tests; create-service and update-service store the fields and the audit rows carry them. 3. The queries and the tests: the detail and list projections with the category names and the category's closed mark, the filter and its `EXPLAIN` test, the grants test `packages/db/test/catalog-grants.ts`, the CHECK bounds, integration tests (set, clear, a closed or foreign category refused, stale revision, another tenant, audit content) and the database review. One PR, deployed as one, so the contract never accepts a field before it is stored and returned | 32b-cat-1; the single migration lane | 600 to 900 |
| **32b-cat-2** | Closing and reopening: categories and single services | 1. The migration adding `closed_at` and `closed_by_category_id` to `services` (CHECKs, column grants) and seeding `close:services:business` (SI-Q17), the contract (close and reopen routes for a category and a service; `closed_at` on the service shapes) and the addendum to spec 031 (SV-09 superseded, SV-Q3 answered). 2. The close-category and reopen-category use cases (the cascade and the marker restore, SI-Q14 to SI-Q16), the close-service and reopen-service use cases, with audit rows, the revision rule and the lock order. 3. The category detail read with its two counts, the service's `closed_at` in the detail and list projections, the session-service-options query leaving closed services out, the `orders` catalog-reader adapter refusing a closed service at record time (`SERVICE_CLOSED`), the integration tests and the database review | 32b-cat-1 and 32b-pre-1; the single migration lane; design advisors (the cascade execution path, the 200 ms rule) | 600 to 850 |
| **32b-pre-2** | Duration and category on the service: the form, the list and the filter | 1. The create and edit forms get the duration and a category picker that offers only open categories (from the category list read), through `packages/i18n` keys in ar and en. 2. The services list shows both columns (RTL-safe), a closed mark for a closed category, and the filter by category (SI-Q10). 3. Component tests that assert visible outcomes (field errors, the picker offering open categories only, the filtered list); the journey doc 29 update follows in its own docs PR (pipeline step 14) | 32b-pre-1 | 350 to 500 |
| **32b-cat-3** | The category screen | 1. The `catalog/categories` page: the list (open, closed, all), create and rename forms with both names required, through `packages/i18n` keys in ar and en. 2. Close and reopen with a confirmation that names how many open services will close (or reopen), the close and reopen of a single service on the service panel, and the closed mark of a closed service on the services list. 3. The branch context (SI-Q19 to SI-Q22): for a branch the user manages, the `in_use` and `available` views, create with the shared or private choice, make shared, enable and hide. 4. Component tests that assert visible outcomes (the closed mark, the confirmation count, a refused reopen, a branch manager who sees only the branch views and the enable and hide actions) | 32b-cat-2, 32b-cat-1b and 32b-pre-2 | 400 to 600 |
| **32b-0** | ADR and map, no behaviour | 1. ADR-0034 addendum (or a new ADR, numbered at merge) recording D-1 to D-9, the `catalog` worker module, the new event and the rollout order, and the answer to SI-T1 (ports, `PP-64.6`). 2. `docs/module-map.md`: the §3 Port row (SI-T1 settled ports, so no arrow), the `ServiceImportCommitRequested` §4 event row with a note on the worker `catalog` module beside it (no code registers the event yet). `docs/module-map.yaml` does not change: its checker reads only `imports`, `packages_restricted`, `composition_roots`, `sync_writes` and `reads`, and none of these grows (as spec 059 D-29). 3. The design advisors' findings written back into this spec in the same PR | this spec merged; design advisors | 100 to 200 |
| **32b-1** | Contracts, moved adapters, pure rules | 1. `service-import.ts` contracts (including the normalized row and the rows page), OpenAPI registration and the i18n error messages (ar and en). 2. Move the entity-agnostic import adapters to `apps/api/src/shared/import/` with staff re-importing them (staff tests unchanged), and add the generic `readHeaderRow` (FR-001) and the generic `tagCells` step (FR-005, FR-006) that turns every cell into tagged text with `percentFormat`, so no JavaScript number leaves the reader boundary; `readSheet` and `ImportCell` stay as they are. 3. The domain plug-in: cell converters (duration and category cells included), row mapper that runs the per-field validators and calls `serviceTerms` only for an error-free row (D-8), duplicate-key function and in-file duplicates, with the domain unit tests | 32b-0; 32b-pre-2 merged, which means 32b-cat-1 and 32b-pre-1 too (the rules the plug-in calls and the form that sets them); design advisors | 500 to 700 |
| **32b-2** | Template, preview, rows, status | 1. Template use case and workbook (headers including duration and category, comments, reference sheet). 2. Preview use case: file facts and bytes ports, sheet read, normalized rows, existing-names read (open and closed services), open-categories read, save with `entity = 'services'`. 3. HTTP (preview with first rows page, rows page, status) with their `EXPLAIN` tests, SIT-01, SIT-02, SIT-06, SIT-07, SIT-08, SIT-10, SIT-13, SIT-14 and the preview timing | 32b-1; 32b-cat-2 merged (a closed service still blocks a name, FR-007); design advisors | 500 to 700 |
| **32b-3** | Worker commit | 1. The worker `catalog` module: processor, the transport of the request event, and the registration of the event type in `known-event-types.ts`. 2. The commit transaction: per-business advisory lock, name re-check, inserts (including `duration_minutes` and `category_id`), the `FOR SHARE` lock on every referenced category and the re-check that each is still open, audit rows with the requesting manager as actor, status. 3. SIT-03, SIT-04, SIT-11, SIT-15, driven by a seeded `commit_requested` preview and event (no API route yet) | 32b-1; 32b-cat-2 merged (the columns and the closed state exist); design advisors | 450 to 650 |
| **32b-4** | Stale-request sweep | 1. Per-company sweep registration (ADR-0022 protocol) in the catalog worker, done before the transport acknowledges an event. 2. The recovery use case and transactions. 3. SIT-12 | 32b-3 | 200 to 320 |
| **32b-5** | Commit request (the producer) | 1. Commit-request use case and route (202, idempotency, the id-only event). 2. Wiring and rollout note: ships only after 32b-3 and 32b-4 are deployed to the environment, so no event is emitted without its consumer and sweep. 3. SIT-05, SIT-09 and the acceptance timing | 32b-2, 32b-3, 32b-4 | 250 to 400 |
| **32b-6** | The screen | 1. The `catalog/import` page and panel, with the polling hook and the stored request id. 2. The table of resolved rows with the defaulted-rule marker, the link on the services list and the ar/en keys. 3. Component tests that assert visible outcomes; the journey doc `docs/journey/NN-services-import.md` follows in its own docs PR (pipeline step 14) | 32b-5 | 350 to 500 |

The graph is: the category and attribute PRs run as one serial chain, because three of them carry migrations and take
the single migration lane: 32b-cat-1, then 32b-cat-1b, then 32b-pre-1, then 32b-cat-2. 32b-pre-2 starts after 32b-pre-1, beside
32b-cat-2 (disjoint files: the admin service form and list against the API and database), and 32b-cat-3 after
32b-cat-2, 32b-cat-1b and 32b-pre-2. 32b-0 runs beside the chain. Then 32b-1 after both 32b-0 and 32b-pre-2; then 32b-2 and 32b-3
in parallel once 32b-cat-2 has merged (the API catalog files and the worker catalog files are disjoint paths; 32b-3 is
tested with a seeded preview, so it does not wait for 32b-2), then 32b-4 after 32b-3, then 32b-5 after 32b-2, 32b-3 and
32b-4, then 32b-6 after 32b-5. The screen cannot reach users before the sweep exists. Only 32b-cat-1, 32b-cat-1b, 32b-pre-1 and
32b-cat-2 add migrations; if any other PR finds that one is needed, it stops and amends the Schema changes section
first.
