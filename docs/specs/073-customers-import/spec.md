# Feature Specification: Customers import — template, preview, all-or-nothing commit

**Created**: 2026-11-01
**Status**: Draft. The owner questions are in [owner-questions.ar.md](owner-questions.ar.md):
- CI-Q1 to CI-Q8 are feature questions: batch 88, `PP-102.1` to `PP-102.7`; CI-Q8 is not numbered yet.
- CI-T1 to CI-T5 are technical questions: `PP-103.1` to `PP-103.4`; CI-T5 is not numbered yet.
- Waleed has answered CI-Q1 to CI-Q4. Every other question is pending, and so is Abu Salem's pick on every feature question.

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
3. **Columns.** `TODO(spec)` CI-Q1 and CI-Q8:
   - Waleed picked "add more fields first", so a customer-fields slice (34-pre) comes before the import.
   - The fields wait on CI-Q8; the language default on CI-Q6; the country code on CI-Q7; an opt-out column on CI-Q5.
   - If Abu Salem picks "name, phone and language only", 34-pre is dropped.
4. **Who may import.** `TODO(spec)` CI-Q4 and CI-T5:
   - Waleed picked "also branch managers and cashiers", so the branch-scope permission `create:customers:branch` is
     accepted too.
   - The route shape waits on CI-T5.

### Design decisions (settled by the files; the design advisors confirm before code)

| # | Decision |
|---|---|
| D-1 | The preview is stored in `import_previews` with `entity = 'customers'`. No new table. Every customers read, lock and update filters `entity = 'customers'`. |
| D-2 | Customers own their import flow: the API use cases, a worker processor and the stale-request sweep, as catalog does in spec 072 D-2. Only entity-agnostic pieces are shared: `TODO(spec)` CI-T1. |
| D-3 | The row plug-in reuses the spec 010 domain rules unchanged: phone normalization, name bounds and masking. There is no second validator. |
| D-4 | One new event type `CustomerImportCommitRequested` (id-only `{ preview_id }`), emitted in the acceptance transaction. No per-customer event: SPEC §3 names none for customer creation. The worker registers the type with its transport, and the API producer ships last (072 D-5 rollout order). |
| D-5 | The commit runs in the worker (the 200 ms rule): `TODO(spec)` CI-T4. It goes in `apps/worker/src/modules/customers`, so that sub-PR waits for 59b-2b to merge. |
| D-6 | The full E.164 phone in the preview rows: `TODO(spec)` CI-T2. |

## Delivery: the sub-PR split

`TODO(spec)`: this is drafted once CI-Q1, CI-Q4, CI-Q8 and CI-T1 to CI-T5 are answered. Known constraints:
- The shared xlsx adapters are planned in 072's 32b-1, which waits on 32b-pre-2 and 32b-cat-2 (CI-T1).
- The worker sub-PR waits on 59b-2b, which owns `apps/worker/src/modules/customers/**` now.
- 34-pre needs the single migration lane, after 32b-pre-1 and only with the manager's yes.
