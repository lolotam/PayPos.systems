# Feature Specification: Customers import — template, preview, all-or-nothing commit

**Created**: 2026-11-01
**Status**: Draft. The owner questions are in [owner-questions.ar.md](owner-questions.ar.md):
- CI-Q1 to CI-Q8 are feature questions: batch 88, `PP-102.1` to `PP-102.8`.
- CI-T1 to CI-T5 are technical questions: `PP-103.1` to `PP-103.5`.
- Waleed has answered CI-Q1 to CI-Q4 and CI-T1 to CI-T4. His technical answers are final.
- CI-Q5 to CI-Q8 and CI-T5 are pending, and so is Abu Salem's pick on every feature question.
- **Two of Waleed's picks go against the recommendation, and Abu Salem has not answered them yet:**
  - CI-Q1 (`PP-102.1`): extra customer fields first.
  - CI-Q4 (`PP-102.4`): branch managers and cashiers may import too.
- Every part marked **[PP-102.1]** or **[PP-102.4]** depends on one of those two picks. Nothing in those parts is
  built before Abu Salem answers or the manager says to proceed. The rest of the spec holds under either answer.

Every section marked `TODO(spec)` waits on an answer. **No code starts before this spec is merged.**

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
- CIM-03 (CI-Q2): a row whose normalized phone already belongs to a customer of the company is not an error.
  - The preview marks it `existing`.
  - The commit leaves that customer unchanged: name, locale, opt-out and timestamps.
  - The row is counted apart from the created rows.
  - Re-uploading the same file creates nobody twice.
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

## Requirements

### Scope decisions

1. **All-or-nothing, create-only** (SPEC §11, ADR-0034). The import never updates or deletes a customer (CI-Q2).
2. **Company-wide identity** (D-30). A created customer belongs to the company, whichever business or branch the
   import ran from.
3. **Columns.** The base columns, `name` and `phone`, hold under either answer.
   - `TODO(spec)` CI-Q6: the language default.
   - `TODO(spec)` CI-Q7: the country code.
   - `TODO(spec)` CI-Q5: an opt-out column.
   - **[PP-102.1]** Waleed picked "add more fields first", so a customer-fields slice (34-pre, with a migration) comes
     before the import. Which fields waits on CI-Q8 (`PP-102.8`). If Abu Salem picks "name, phone and language only",
     34-pre is dropped and the import needs no migration.
4. **Who may import.**
   - Under either answer, the business route `/v1/businesses/{businessId}/customers/import/…` (CI-T3) accepts the
     existing `create:customers:business`, which the general manager covers through `create:customers:company`.
   - **[PP-102.4]** Waleed picked "also branch managers and cashiers", so `create:customers:branch` is accepted too, on
     a branch route whose shape waits on CI-T5 (`PP-103.5`).

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

## Delivery: the sub-PR split

`TODO(spec)`: this is drafted once CI-Q1, CI-Q4 and CI-Q8 have Abu Salem's pick and CI-T5 is answered. Known constraints:
- The first 34b sub-PR moves the shared xlsx adapters to `apps/api/src/shared/import/` (CI-T1), so 34b does not wait
  on 072's 32b-1.
- The worker sub-PR waits on 59b-2b, which owns `apps/worker/src/modules/customers/**` now.
- **[PP-102.1]** 34-pre needs the single migration lane. It is queued after 32b-pre-1 (34-pre first, then 49-1), and
  it is taken only with the manager's yes.
