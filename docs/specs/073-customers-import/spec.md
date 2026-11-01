# Feature Specification: Customers import — template, preview, all-or-nothing commit

**Created**: 2026-11-01
**Status**: Draft. The owner questions are in [owner-questions.ar.md](owner-questions.ar.md):
- CI-Q1 to CI-Q19 are feature questions: batch 88, `PP-102.1` to `PP-102.19`.
- CI-T1 to CI-T8 are technical questions: `PP-103.1` to `PP-103.8`. Waleed also settled the 34-pre split (see Delivery).
- Waleed has answered CI-Q1 to CI-Q4 and CI-T1 to CI-T6. His technical answers are final.
- Waleed has also answered CI-Q5 to CI-Q16, on the decisions page itself (his own picks, 11:07–11:08 and 12:10–12:13).
- CI-T7 and CI-T8 (round 4) are pending, and so is Abu Salem's pick on every feature question.
- **Five of Waleed's picks go against the recommendation, and Abu Salem has not answered them yet:**
  - CI-Q1 (`PP-102.1`): extra customer fields first.
  - CI-Q8 (`PP-102.8`): the extra fields are birthday, notes, gender and email.
  - CI-Q4 (`PP-102.4`): branch managers and cashiers may import too.
  - CI-Q13 (`PP-102.13`): the note is kept per business, not per company.
  - CI-Q16 (`PP-102.16`): an existing customer's rating refusal is not set by the import.
- Every part marked **[PP-102.1]** (which includes CI-Q8) or **[PP-102.4]** depends on one of those picks. Nothing in those parts is
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
- CIM-03 (CI-Q2, narrowed by CI-Q15 and CI-Q16): a row whose normalized phone already belongs to a customer of the company is not an error.
  - The preview marks it `existing`.
  - The commit never changes that customer's name, phone, language or rating opt-out, whatever the file says.
  - **[PP-102.1]** The only change allowed is filling a new field that is still empty (CI-Q15): birthday, gender and
    email on the customer, and the note of the previewed business. A field that already has a value is never
    overwritten. Without Abu Salem's pick on CI-Q1 the row is left fully unchanged.
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
  `TODO(spec)` CI-Q19 (`PP-102.19`): whether the preview tells the manager that the refusal will not be recorded.
- CIM-12 **[PP-102.1]** (CI-Q11): an email is stored as typed, trimmed, only after it passes the shape check (it has
  an `@` and a dot). It is never confirmed by a message, and two customers may share one email.

## Requirements

### Scope decisions

1. **All-or-nothing** (SPEC §11, ADR-0034). The import creates customers and never deletes one (CI-Q2). It never
   changes an existing customer's name, phone, language or rating opt-out. **[PP-102.1]** Narrowed by CI-Q15, it may
   fill a new field that is still empty on an existing customer (see CIM-03); without Abu Salem's pick on CI-Q1 it
   stays create-only.
2. **Company-wide identity** (D-30). A created customer belongs to the company, whichever business or branch the
   import ran from.
3. **Columns.** These hold under either answer to CI-Q1 (Waleed's picks; Abu Salem's pick is pending):

   | Column | Rule |
   |---|---|
   | `name` | Required. The spec 010 name bounds and control-character rule. |
   | `phone` | Required. Normalized with spec 010 `BR-001`, together with the country code. |
   | `country_code` | Optional. Blank means Kuwait, `965` (CI-Q7, `PP-102.7`). |
   | `locale` | Optional, `ar` or `en`. Blank means `ar` (CI-Q6, `PP-102.6`). |
   | `no_rating` («لا ترسل تقييم») | Optional, «نعم» or blank. «نعم» creates a NEW customer already opted out of rating requests; blank creates her like any new customer (CI-Q5, `PP-102.5`). For an existing customer the column is ignored (CI-Q16, `PP-102.16`, Waleed's pick against the recommendation). |

   **[PP-102.1]** Waleed picked "add more fields first", and CI-Q8 (`PP-102.8`) names four fields. They are added
   to the customer first, in a «customer fields» slice 34-pre with a migration, and then to the template as optional
   columns. If Abu Salem picks "name, phone and language only", 34-pre is dropped and the import needs no migration.

   | Column | Rule (Waleed's picks, Abu Salem's pending) |
   |---|---|
   | `birthday` | Optional. Day and month; the year is optional (CI-Q9, `PP-102.9`). `TODO(spec)` CI-Q18 (`PP-102.18`): how it is typed in the cell. |
   | `gender` | Optional: ذكر / أنثى / blank (CI-Q10, `PP-102.10`). |
   | `email` | Optional. Refused only for a wrong shape (an `@` and a dot); no confirmation message; two customers may share one (CI-Q11, `PP-102.11`). Maximum 254 characters (CI-T6, `PP-103.6`, final). |
   | `notes` | Optional. One note **per business**, the business of the preview (CI-Q13, `PP-102.13`, Waleed's pick against the recommendation). Anyone who can see the customer sees the note, and the field carries the hint «ماتكتبش أسرار أو بيانات حساسة» (CI-Q12, `PP-102.12`). `TODO(spec)` CI-Q17 (`PP-102.17`): whether a business sees another business's note. Maximum 500 characters (CI-T6, `PP-103.6`, final). |

   CI-Q14 (`PP-102.14`): the four fields show on the reception registration screen (optional) and on the customer
   card. There is no edit screen until phase 2, so a wrong value waits for the customer-management screen.
4. **Who may import.**
   - Under either answer, the business route `/v1/businesses/{businessId}/customers/import/…` (CI-T3) accepts the
     existing `create:customers:business`, which the general manager covers through `create:customers:company`.
   - **[PP-102.4]** Waleed picked "also branch managers and cashiers", so `create:customers:branch` is accepted too.
     **CI-T5 (`PP-103.5`, final):** a branch route `/v1/branches/{branchId}/customers/import/…` accepts any of
     `create:customers:{company,business,branch}` on that branch. The preview stores the branch's `business_id`, the
     customers are created for the company, and no migration is needed. The business route above stays; both routes
     share one use case.

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
| D-8 **[PP-102.1]** | **Design impact of CI-Q13 (per-business notes).** The customer is one row for the company (D-30), so a note per business cannot be a column on `customers`. It is a row keyed by company, customer and business, with RLS, a negative isolation test and an index on every FK, written in the same transaction as the customer. `TODO(spec)` CI-T7 (`PP-103.7`, technical): the table shape. |
| D-9 **[PP-102.1]** | **Design impact of CI-Q15 (fill empty fields).** Today `pospay_app` can only INSERT on `customers`, plus UPDATE of the opt-out columns (migration 0188). Filling birthday, gender and email on an existing customer needs a column-level UPDATE grant on exactly those columns and a database guard that refuses to change a value already set, as 0188 does for the opt-out. The worker writes with `UPDATE … WHERE column IS NULL`. `TODO(spec)` CI-T8 (`PP-103.8`, technical): the column shape (birthday as month, day and optional year, because a date column cannot hold a missing year) and the guard. |
| D-10 **[PP-102.1]** | **CI-T6 (`PP-103.6`, final): birthday, gender, email and notes are personal data.** None of them appears in a log line or an import error message; an error names the row number and the column only. The columns are nullable and expand-only, email has no unique constraint, notes are capped at 500 characters (a CHECK on the per-business notes table, D-8) and email at 254. |

## Delivery: the sub-PR split

Waleed's pick on the 34-pre split (manager chat, 2026-11-01, about 13:01, final): «(أ) خطوتين: الأولى قاعدة البيانات
والسيستم، والتانية الشاشات ⭐ المقترح». The same session implements every sub-PR below, in this worktree, in this order.

| Sub-PR | Content | Waits on |
|---|---|---|
| 34-pre-1 **[PP-102.1]** | Migration, contract, domain and API for birthday, notes (per business, CI-Q13), gender and email: new nullable customer columns, the per-business notes table, the column grants and the guard (D-8, D-9, D-10), and the find-or-create use case of spec 010 accepting the optional fields. | Abu Salem's pick on CI-Q1 and CI-Q13, CI-T7, CI-T8, and the migration lane (32b-pre-1 holds it, then 49-1, then this one, and only with the manager's yes). |
| 34-pre-2 **[PP-102.1]** | The reception registration form and the customer card (CI-Q14). | 34-pre-1. |
| 34b-1 | Move the shared xlsx adapters to `apps/api/src/shared/import/` (CI-T1). | Nothing. |
| 34b-2 | Contracts, template, preview and the business and branch routes (CI-T3, CI-T5), the `CustomerImportCommitRequested` event type (D-4). | 34b-1; the fields columns wait on 34-pre-1. |
| 34b-3 | The worker commit and the stale-request sweep in `apps/worker/src/modules/customers` (D-5), then the API producer last (072 D-5 rollout order). | 34b-2 and 59b-2b. |

`TODO(spec)`: the 34b sub-PR boundaries above are a draft for the design advisors to confirm.
Known constraints:
- The first 34b sub-PR moves the shared xlsx adapters to `apps/api/src/shared/import/` (CI-T1), so 34b does not wait
  on 072's 32b-1.
- The worker sub-PR waits on 59b-2b, which owns `apps/worker/src/modules/customers/**` now.
- **[PP-102.1]** 34-pre needs the single migration lane. It is queued after 32b-pre-1 and after 49-1 (the manager's order
  of 2026-11-01 12:28: 49-1 is ready with its migration, 34-pre still waits on Abu Salem's CI-Q1 and the per-business
  notes design), and it is taken only with the manager's yes.
- **[PP-102.1]** 34-pre is larger than "add four columns". With CI-Q13, CI-Q14 and CI-Q15 it covers: the migration (new
  customer columns, the per-business note table, the column grants and the guard), the contracts, the find-or-create
  use case of spec 010 accepting the optional fields, the reception registration screen in `apps/admin/src/orders`,
  and the customer card. `TODO(spec)`: the manager decides whether that is one sub-PR or a migration sub-PR followed
  by a UI sub-PR.
