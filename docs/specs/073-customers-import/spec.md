# Feature Specification: Customers import — template, preview, all-or-nothing commit

**Created**: 2026-11-01
**Status**: Draft. The owner questions are in [owner-questions.ar.md](owner-questions.ar.md):
- CI-Q1 to CI-Q19 are feature questions: batch 88, `PP-102.1` to `PP-102.19`.
- CI-Q20 is a feature question: batch 90, `PP-105.1`. Both owners chose option A (`choice: 0`): the «السنة معروفة؟» Yes/No column settles file entry when the birth year is unknown. Original answers, channels and timestamps remain in the audit record.
- CI-T1 to CI-T8 are technical questions: `PP-103.1` to `PP-103.8`. Waleed also settled the 34-pre split (see Delivery).
- CI-T9 (`PP-107.1`) and CI-T10 (`PP-107.2`) are answered by Waleed on 2026-11-01, channel «كارت بشات مدير الويب», relayed by the manager's message labelled 17:37 Kuwait: B for a typed field inside existing `business.settings`, A for self-registration delivery in its future slice. Both verbatim answers remain in the audit record. The manager corrected the country-settings identifier to 34-pre-3 at 17:58, preserving 34-pre-2 for Waleed's original customer-UI delivery; the 17:52 scope is unchanged. Superseded wording is retained verbatim in the audit record. Neither technical question goes on the decisions site.
- Waleed has answered CI-Q1 to CI-Q4 and CI-T1 to CI-T8. The manager confirmed that the newer CI-Q17 answer supersedes CI-T7's cross-business read restriction; the original answer remains in the audit record. D-8 records the reconciled design.
- Waleed has also answered CI-Q5 to CI-Q16, on the decisions page itself (his own picks, 11:07–11:08 and 12:10–12:13).
- Abu Salem answered all twenty feature questions in batches 88 and 90; his live notes were verified on 2026-11-01. His answers bind. Two changes from Waleed's original answers affect the specification: CI-Q10 requires gender for every new customer, and the CI-Q7 note makes the business's country the default rather than a fixed Kuwait default.
- **The accepted feature scope includes:**
  - CI-Q1 (`PP-102.1`): extra customer fields first.
  - CI-Q8 (`PP-102.8`): the extra fields are birthday, notes, gender and email.
  - CI-Q4 (`PP-102.4`): branch managers and cashiers may import too.
  - CI-Q10 (`PP-102.10`): gender is required for every new customer, **activated in 34-pre-2** with the reception UI in the same PR. `TODO(spec)` 34-pre-2: activate the required-on-creation contract/rule and its test. 34-pre-1 is the backward-compatible expand release and accepts omitted gender without a default (manager delivery sequencing at 18:58, 2026-11-01). The binding business choice remains `choice: 1`, `2026-11-01T13:03:47.246Z`.
  - CI-Q13 (`PP-102.13`): the note is kept per business, not per company.
  - CI-Q16 (`PP-102.16`): an existing customer's rating refusal is not set by the import.
  - CI-Q17 (`PP-102.17`): the restaurant cashier may see the salon's note for the same customer within the company.
  - CI-Q18 (`PP-102.18`): birthdays use normal Excel date cells.
- **[PP-102.1]** and **[PP-102.4]** identify the accepted extra-fields and branch-import scope. They no longer indicate unanswered feature questions. The migration lane, unresolved technical questions and spec/design gates still apply.

Every section marked `TODO(spec)` waits on its answer. **Local implementation exception, manager authorization at 18:40 on 2026-11-01:** start 34-pre-1 now, including the brief, MiniMax dispatch, implementation, local gates and reviews. A placeholder migration may be tested only on this worktree's private Docker Postgres lane, stopped with `lane.mjs down` after testing. The manager granted the lane at 19:15 Kuwait on 2026-11-01: #762 merged as `1df1f24b`, last migration 0197. After local proof, rebase latest main, number from 0198 (the slice ships two migrations: 0198 builds the shape, 0199 builds the notes index `CONCURRENTLY` and validates the six profile CHECKs), run `pnpm db:generate`, push with an explicit refspec, then open the PR. Notify the manager after merge so 42-2 can take the lane. This supersedes the earlier no-code-before-spec-merge restriction only for this authorized local 34-pre-1 work; all technical, security and review gates remain. 34-pre-3 follows it and is not part of this implementation.

**Input**:
- Phase 1 plan row 34b ("customers import", size S, depends on 34 and 11).
- PRD D-48: an Excel template per entity, preview with per-row errors, and one invalid row saves nothing.
- PRD D-26: customers come from Twlm at go-live.
- SPEC §2 "Import"; SPEC §11: acceptance criterion "An import with any invalid row saves nothing" and rule R1.
- Spec 010: customer identity and phone normalization.
- Spec 030 and ADR-0034: the import framework.
- Spec 072: the second consumer of that framework, whose design decisions this row follows.
- CLAUDE.md §5, §6 and §8.

## User Scenarios & Testing

An authorised user downloads the customers template, fills in one row per customer and uploads it through the existing
private-files flow. The user previews the file and commits only when the preview has no error. One invalid row saves
nothing. The commit runs in the worker, and the screen polls for the result.

**Example (the «الأميرة» salon):**
- The manager imports 300 customers from the old system.
- Reception had already registered 40 of them this week. Those 40 rows are kept unchanged and are marked as already
  registered in the preview (CI-Q2).
- Row 57 repeats the phone of row 12. Both rows are errors, and the commit stays disabled until one is fixed (CI-Q3).
- Every phone in the preview and in every error shows only its last three digits (R1).

### Acceptance scenarios (settled parts)

- CIM-01: preview parses only the first sheet and validates every row with the find-or-create rules of spec 010
  (`BR-001` normalization, name bounds and control characters). It writes no customer. It reports every bad row, not
  only the first.
- CIM-02: the commit runs in ONE transaction, and any failure saves nothing. The only partial thing is the report.
- CIM-03 (CI-Q2, narrowed by CI-Q15 and CI-Q16): a row whose normalized phone already belongs to a customer of the company is not an error.
  - The preview marks it `existing`.
  - The commit never changes that customer's name, phone, language or rating opt-out, whatever the file says.
  - **[PP-102.1]** The only change allowed is filling a new field that is still empty (CI-Q15): birthday, gender and
    email on the customer, and the note of the previewed business. A field that already has a value is never
    overwritten. Abu Salem approved CI-Q1 and CI-Q15, so this fill-empty behavior is part of the accepted scope.
  - The row is counted apart from the created rows.
  - Re-uploading the same file creates nobody twice and fills nothing the second time.
- CIM-04 (CI-Q3): two or more rows of the same file with the same normalized phone are each a row error on the phone
  column, and nothing is kept silently.
- CIM-05: a phone that another customer takes between the preview and the commit is treated like CIM-03 at commit
  time, under the company/phone unique key. The commit does not fail; it counts the row as existing.
  `TODO(spec)`: confirm with the design advisors that the existing-row count may differ from the preview's count.
- CIM-06 (R1): no response, error, log line or audit entry carries more than the last three digits of a phone.
  Rows are identified by row number and masked phone.
- CIM-07: the business, file and preview of another tenant or another business answer exactly like unknown ones. A
  customers preview is never visible through the employee or services import routes, and the reverse holds too.
- CIM-08: the commit requires an `Idempotency-Key`. A preview expires after 24 h and is single-use. Concurrent commits
  yield the same 202 acceptance and one worker effect.
- CIM-09: a workbook over 2 MiB or over 500 data rows is refused before any write.
- CIM-10: importing never sends a message to anyone. A rating request is still created only by a visit.
- CIM-11 **[PP-102.1]** (CI-Q16, CI-Q5): the «لا ترسل تقييم» column only applies to a customer the import creates.
  For an existing customer the column is ignored and her opt-out is not touched.
  CI-Q19 (`PP-102.19`): the preview shows the non-blocking warning «موجودة — رفض التقييم مش هيتسجّل» beside an existing row whose file value is «نعم».
- CIM-12 **[PP-102.1]** (CI-Q11): an email is stored as typed, trimmed, only after it passes the shape check (it has
  an `@` and a dot). It is never confirmed by a message, and two customers may share one email.
- CIM-13 **[PP-102.1]** (CI-Q20, `PP-105.1`, option A): the workbook has a «السنة معروفة؟» column with «نعم» / «لا» beside the normal Excel birthday date.
  - A date with «نعم» retains its actual day, month and year, including a real birth year of 2000.
  - A date with «لا» retains only day and month; its year is discarded. File instructions tell staff to enter year 2000 when the year is unknown, so 29 February can be entered as 29 February 2000 without saving a made-up birth year. Any year supplied with «لا» is discarded.
  - A date with a blank flag is a row error («حدد هل سنة الميلاد معروفة»); the flag must be «نعم» or «لا» when a date is present. One invalid row prevents the entire import from saving.
  - An empty date means no birthday from this row; the flag is ignored. Existing nonempty birthday fields remain protected by CIM-03 and D-9.
- CIM-14 **[PP-102.1]** (CI-Q10, `PP-102.10`, Abu Salem's binding answer; activation sequencing from the manager at 18:58): `TODO(spec)` **34-pre-2 activates** refusal of a new customer without gender. Its UI field, required-on-creation contract/rule and proving test ship in the same PR. Subsequent import creation must enforce the rule at commit; an invalid new row prevents the entire import from saving. Existing customers are not rejected solely because stored gender is empty. **34-pre-1 does not activate this requirement:** creation without gender remains valid, with no default or guessed value; a supplied gender is still validated.
- CIM-16 **[PP-102.1]** (34-pre-1 expand/rollback): after applying the draft migration to the private lane, existing reception requests and the previous customer INSERT/lookup/opt-out behavior continue working without gender. New columns are nullable with no backfill or gender-required INSERT guard. Test backward schema/write compatibility and the new optional values; record the actual rollback proof and any limits rather than claiming an unrun image test passed.
- CIM-15 (CI-Q7, `PP-102.7`, Abu Salem's note; CI-T9, `PP-107.1`, option B): an empty `country_code` uses the country calling code of the import's business (for example Kuwait 965 or Saudi Arabia 966), from an explicitly configured, typed country field inside existing `business.settings`. A supplied calling code remains editable and explicit. The field needs management, validation and a public reader; the current generic JSON is not a ready provider. Existing businesses must have their country supplied explicitly; no country is inferred from timezone, currency or tax settings. Country configuration is a delivery dependency, not an implemented capability yet. CI-T10 (`PP-107.2`, option A) assigns editable calling codes in self-registration to its future menu/customer sign-in slice; 34b adds no self-registration route.

## Requirements

### Scope decisions

1. **All-or-nothing** (SPEC §11, ADR-0034). The import creates customers and never deletes one (CI-Q2). It never
   changes an existing customer's name, phone, language or rating opt-out. **[PP-102.1]** Narrowed by CI-Q15, it may
   fill a new field that is still empty on an existing customer (see CIM-03), as approved by both owners.
2. **Company-wide identity** (D-30). A created customer belongs to the company, whichever business or branch the
   import ran from.
3. **Columns.** The feature scope below follows Abu Salem's binding answers to batches 88 and 90:

   | Column | Rule |
   |---|---|
   | `name` | Required. The spec 010 name bounds and control-character rule. |
   | `phone` | Required. Normalized with spec 010 `BR-001`, together with the country code. |
   | `country_code` | Optional. Blank means the calling code of the business's explicitly configured country, not a fixed `965` (CI-Q7, `PP-102.7`). Explicit values can override it. CI-T9 (`PP-107.1`, option B) places the country in a typed field inside existing `business.settings`, with management, validation and a public reader. No new table column or implicit default; the generic JSON alone is insufficient. |
   | `locale` | Optional, `ar` or `en`. Blank means `ar` (CI-Q6, `PP-102.6`). |
   | `no_rating` («لا ترسل تقييم») | Optional, «نعم» or blank. «نعم» creates a NEW customer already opted out of rating requests; blank creates her like any new customer (CI-Q5, `PP-102.5`). For an existing customer the column is ignored (CI-Q16, `PP-102.16`, Waleed's pick against the recommendation). |

   **[PP-102.1]** Both owners picked "add more fields first", and CI-Q8 (`PP-102.8`) names four fields. They are added
   to the customer first, in a «customer fields» slice 34-pre with a migration, and then to the template. Gender becomes required for new customers when 34-pre-2 activates CI-Q10; all four fields are optional in the 34-pre-1 expand release. Birthday, email and notes remain optional afterward.

   | Column | Rule (Abu Salem's binding answers) |
   |---|---|
   | `birthday` | Optional. Day and month; the year is optional (CI-Q9, `PP-102.9`). Normal Excel date cell (CI-Q18, `PP-102.18`), paired with «السنة معروفة؟» (CI-Q20, `PP-105.1`, option A). Instructions use year 2000 when the year is unknown; with «لا» only day and month are saved. With «نعم» the actual year is saved. An empty date supplies no birthday, regardless of the flag. |
   | «السنة معروفة؟» | Workbook column, «نعم» or «لا», required when `birthday` is filled (CI-Q20, `PP-105.1`, option A). A blank flag with a date is a row error. Ignored when the date is empty. It distinguishes a real birth year of 2000 from the example year; the flag itself is not a new customer database column. |
   | `gender` | ذكر / أنثى when supplied. Optional in 34-pre-1's expand creation contract/storage, with no default or guessed values. `TODO(spec)` 34-pre-2: require gender on new creation together with the reception UI and a proving test, activating CI-Q10 (`PP-102.10`, final `choice: 1`). Existing legacy rows may remain empty; subsequent import fill-empty behavior follows CI-Q15. |
   | `email` | Optional. Refused only for a wrong shape (an `@` and a dot); no confirmation message; two customers may share one (CI-Q11, `PP-102.11`). Maximum 254 characters (CI-T6, `PP-103.6`, final). |
   | `notes` | Optional. One note **per business**, the business of the preview (CI-Q13, `PP-102.13`, Waleed's pick against the recommendation). Anyone who can see the customer sees the notes of all businesses within the same company (CI-Q12, CI-Q17). The card names the business that wrote each note. The field carries the hint «ماتكتبش أسرار أو بيانات حساسة» (CI-Q12, `PP-102.12`). Maximum 500 characters per note (CI-T6, `PP-103.6`, final). D-8 defines company isolation and per-business storage. |

   CI-Q14 (`PP-102.14`): the four fields show on the reception registration screen and on the customer card in 34-pre-2. That same PR activates required gender for new registrations by CI-Q10; the other new fields are optional. 34-pre-1 keeps the current screen's creation requests valid. There is no edit screen until phase 2, so a wrong value waits for the customer-management screen.
4. **Who may import.**
   - Under either answer, the business route `/v1/businesses/{businessId}/customers/import/…` (CI-T3) accepts the
     existing `create:customers:business`, which the general manager covers through `create:customers:company`.
   - **[PP-102.4]** Waleed picked "also branch managers and cashiers", so `create:customers:branch` is accepted too.
     **CI-T5 (`PP-103.5`, final):** a branch route `/v1/branches/{branchId}/customers/import/…` accepts any of
     `create:customers:{company,business,branch}` on that branch. The preview stores the branch's `business_id`, the
     customers are created for the company, and no migration is needed. The business route above stays; both routes
     share one use case.

### Contract requirements for 34-pre-1 and 34b-2

- **34-pre-1 expand:** the creation transport and internal creation data permit omitted gender; supplied values must be valid, and omission is stored as NULL without a default or guessed value. Existing lookup remains compatible with legacy NULL values. Do not add a required-gender INSERT trigger or unconditional contract requirement in this release.
- `TODO(spec)` **34-pre-2 activation:** add the reception gender field and require valid gender only on actual new creation, with its proving contract/use-case test in the same PR. Preserve legacy lookup; the server resolves existing identity, and a client cannot declare a row existing to bypass required creation. The later workbook creation path follows the activated rule. CI-Q15's future fill-empty behavior remains unchanged.
- Country calling-code normalization continues to use spec 010's explicit calling-code and national-number rules. The import resolves only a blank calling code from the typed country field inside existing `business.settings` through an approved public reader (CI-T9, `PP-107.1`, B). The field needs management and validation; no new table column is added. Existing businesses need explicit configuration, not a guessed backfill or implicit default. The importer must not embed `965` as a universal default or reuse nullable tax-country metadata as the business's country.
- Baseline implementation evidence before local work: `packages/contracts/src/customers.ts` has only `phone`, `name` and `locale` on `FindOrCreateCustomerInput`; `packages/db/schema/customers.ts` has no 34-pre fields. 34-pre-1 expands the executable Zod contract, storage and generated OpenAPI/clients with optional gender and optional profile fields. The required-on-new-creation change is reserved for 34-pre-2 together with its UI, preserving staging between merges. Local work follows the 18:40 authorization; the lane was granted at 19:15; final numbering from 0198 and metadata generation follow local proof and a rebase on latest main.
- CI-T10 (`PP-107.2`, A): keep this specification limited to import and reception. Track the customer's editable calling code as a requirement of the future menu self-registration/customer sign-in slice, using the approved business-country source. Do not add a self-registration route in 34b.
- The manager approved country settings as the separate 34-pre-3 delivery (identifier corrected at 17:58), after 34-pre-1, before 34-pre-2 and before 34b-2. `TODO(spec)`: if its spec needs behavior for a business whose country is unset, route that question to the manager before its brief. No fallback or backfill is implied. Recording this split does not start implementation or grant the migration lane.

### Design decisions (settled by the files; the design advisors confirm before code)

| # | Decision |
|---|---|
| D-1 | The preview is stored in `import_previews` with `entity = 'customers'`. No new table. Every customers read, lock and update filters `entity = 'customers'`. |
| D-2 | Customers own their import flow: the API use cases, a worker processor and the stale-request sweep, as catalog does in spec 072 D-2. Only entity-agnostic pieces are shared. **CI-T1 (`PP-103.1`, final): 34b moves them to `apps/api/src/shared/import/`** (the xlsx reader with caller-passed bounds and error translation, and the object-bytes reader), with staff re-importing them and staff's tests unchanged. Spec 072's 32b-1 then reuses them; its split gets a one-line amendment in this spec's PR. |
| D-3 | The row plug-in reuses the spec 010 domain rules unchanged: phone normalization, name bounds and masking. There is no second validator. |
| D-4 | One new event type `CustomerImportCommitRequested` (id-only `{ preview_id }`), emitted in the acceptance transaction. No per-customer event: SPEC §3 names none for customer creation. The worker registers the type with its transport, and the API producer ships last (072 D-5 rollout order). |
| D-5 | **CI-T4 (`PP-103.4`, final): the commit runs in the worker** (the 200 ms rule), in `apps/worker/src/modules/customers`, so that sub-PR waits for 59b-2b to merge. |
| D-6 | **CI-T2 (`PP-103.2`, final): the normalized E.164 phone is stored in `import_previews.rows`**, under the table's RLS like the `customers` table, so the worker inserts from it. It is never returned. Every response, error and log carries only the masked phone. Retention follows the open IM-Q3. |
| D-7 | **CI-T3 (`PP-103.3`, final): the routes sit under the business**, and the preview's `business_id` is that business. Customers are created for the company. No migration for the import itself. |
| D-8 **[PP-102.1]** | **Per-business storage, company-wide visibility (CI-Q13, CI-Q17; manager clarification, 2026-11-01, message labelled 13:40 Kuwait).** A new `customer_notes` table keeps primary key (`company_id`, `customer_id`, `business_id`), a CHECK on length at most 500, RLS on `company_id`, a negative isolation test between companies and an index on every FK. The write happens in the same transaction as the customer save; reads go through `queries/`. All businesses of the same company may read the customer's notes, and the card names the business that wrote each note. CI-Q17 supersedes only the part of CI-T7 (`PP-103.7`) that forbade cross-business reads; both original answers remain in the audit record. `business_id` remains in the key, so a later binding pick by Abu Salem to restrict reads can be applied through policy without changing the table shape. No cross-company read is permitted. |
| D-9 **[PP-102.1]** | **Design impact of CI-Q15 (fill empty fields).** Today `pospay_app` can only INSERT on `customers`, plus UPDATE of the opt-out columns (migration 0188). Filling birthday, gender and email on an existing customer needs a column-level UPDATE grant on exactly those columns and a database guard that refuses to change a value already set, as 0188 does for the opt-out. The worker writes with `UPDATE … WHERE column IS NULL`. **CI-T8 (`PP-103.8`, final):** `birth_month`, `birth_day`, `birth_year` (a date column cannot hold a missing year), `gender` and `email`, all nullable. UPDATE is granted per column, and a DB trigger refuses to change any value that is not NULL, as 0188 does for the opt-out. The worker updates with `WHERE column IS NULL`. |
| D-10 **[PP-102.1]** | **CI-T6 (`PP-103.6`, final): birthday, gender, email and notes are personal data.** None of them appears in a log line or an import error message; an error names the row number and the column only. The columns are nullable and expand-only, email has no unique constraint, notes are capped at 500 characters (a CHECK on the per-business notes table, D-8) and email at 254. |

## Delivery: the sub-PR split

Waleed's pick on the 34-pre split (manager chat, 2026-11-01, about 13:01, final): «(أ) خطوتين: الأولى قاعدة البيانات
والسيستم، والتانية الشاشات ⭐ المقترح». The manager corrected the identifiers at 17:58 on 2026-11-01 to preserve Waleed's original 34-pre-2 customer-UI identifier: country settings is 34-pre-3. This session executes 34-pre-1, then 34-pre-3, then 34-pre-2, followed by 34b-1, 34b-2 and 34b-3 in the existing 073 order, without parallel work between these deliveries. The superseded 17:52 wording is retained verbatim in the audit record.

| Sub-PR | Content | Waits on |
|---|---|---|
| 34-pre-1 **[PP-102.1]** | Expand migration, contract, domain, storage and API for birthday, per-business notes, gender and email: all optional in this release, with nullable scalar columns, no gender default/backfill, per-business notes table and non-NULL overwrite guards (D-8, D-9, D-10). Preserve creation from the current reception UI and prove rollback on the private lane. CI-Q10 activation is deferred to 34-pre-2. | Local brief/dispatch/implementation/placeholder-migration tests/reviews authorized at 18:40. Lane granted at 19:15, after #762 merged as `1df1f24b` (last migration 0197). After local proof: rebase latest main, number from 0198 and 0199 (0198 builds the shape; 0199 builds the notes index `CONCURRENTLY` and validates the six profile CHECKs), generate metadata, explicit-refspec push and PR. |
| 34-pre-3 — دولة النشاط في إعدادات النشاط | Typed country field inside existing `business.settings`, its contract, management, validation and public reader from `tenancy/index.ts`. Scope unchanged from 17:52: no new table column, no backfill and no implicit default. | After 34-pre-1 in this same session, not in parallel; before 34-pre-2 and required before 34b-2. Conditional migration lane below. |
| 34-pre-2 **[PP-102.1]** | The reception registration form and customer card (CI-Q14), including the gender field; in the same PR, activate required gender on new creation and its proving test (CI-Q10, manager sequencing at 18:58). Waleed's original identifier is retained. | After 34-pre-1 and 34-pre-3 in the same session. |
| 34b-1 | Move the shared xlsx adapters to `apps/api/src/shared/import/` (CI-T1). | Follows 34-pre-2 in this session's execution order; the adapter move has no additional technical prerequisite. |
| 34b-2 | Contracts, template, preview and the business and branch routes (CI-T3, CI-T5), the `CustomerImportCommitRequested` event type (D-4). | 34b-1, 34-pre-1 and 34-pre-3 (country settings), following 34-pre-2 in the session order. |
| 34b-3 | The worker commit and the stale-request sweep in `apps/worker/src/modules/customers` (D-5), then the API producer last (072 D-5 rollout order). | 34b-2 and 59b-2b. |

`TODO(spec)`: the 34b sub-PR boundaries above are a draft for the design advisors to confirm.
Known constraints:
- **Approved country-settings split (manager, 2026-11-01, 17:52; identifier corrected at 17:58):** 34-pre-3 is «دولة النشاط في إعدادات النشاط», owned by this session, after 34-pre-1 and before 34-pre-2, without parallel execution. It is a prerequisite for 34b-2. 34-pre-1 stays limited to customer fields and creation rules; 34-pre-2 retains reception registration and the customer card. Existing businesses get their country explicitly; no backfill or implicit default.
- **Conditional 34-pre-3 migration lane:** if there is no migration, new CHECK or data step, this delivery needs no migration-lane slot. If it requires a migration or data step, the order is 49-1, 34-pre-1, 42-2, 34-pre-3. This queue is not a grant.
- **Roadmap trigger:** when 34-pre-3 actually starts, add its row to plan's `roadmap.json`, after `git pull --rebase`, staging that exact path and pushing `HEAD:main`. The manager confirmed at 17:58 that 34-pre-3 is unused there. This correction does not start 34-pre-3 and does not update the roadmap yet.
- The 34-pre-1 PR also carries the `PP-102`, `PP-103` and `PP-105` index rows in `docs/owner-decisions.ar.md`, with the owner answers, channels and dates copied verbatim from this slice's audit record (manager instruction, 2026-11-01, message labelled 15:46 Kuwait). These rows do not get a separate PR.
- The first 34b sub-PR moves the shared xlsx adapters to `apps/api/src/shared/import/` (CI-T1), so 34b does not wait
  on 072's 32b-1.
- The worker sub-PR waits on 59b-2b, which owns `apps/worker/src/modules/customers/**` now.
- **[PP-102.1]** 34-pre needs the single migration lane. The manager explicitly granted 34-pre-1 the lane at 19:15 Kuwait on 2026-11-01, after #762 merged as `1df1f24b` with migrations through 0197. After local proof, the root rebases latest main, numbers from 0198 (the slice ships two migrations, 0198 and 0199), runs `pnpm db:generate`, pushes with an explicit refspec and opens the PR. Notify the manager after merge to hand the lane to 42-2. Earlier wait instructions remain in the audit as history.
- **[PP-102.1]** Customer fields and the customer UI remain separate deliveries, 34-pre-1 and 34-pre-2; 34-pre-3 names country settings between them in the session order. The reception form
  lives in `apps/admin/src/orders` and goes through the find-or-create use case of spec 010.
