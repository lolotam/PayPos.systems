# Data model: 61-2a + 62-2e

## 1. 61-2a — no schema change

Read only. Source table `rating_attributions` (`packages/db/schema/ratings-attributions.ts`, migration 0185):

| Column | Use in the summary |
|---|---|
| `company_id` | tenant predicate (and RLS through `withTenant`) |
| `employee_id` | the caller's own employee, resolved by `staff.readOwnEmployee` |
| `business_id` | the session's business (residual filter) |
| `stars smallint` | `avg` and `count` |
| `submitted_at timestamptz` | month window, compared as a bare column |

Index used: `rating_attributions_employee_idx (company_id, employee_id, submitted_at)`. No stored average (D-B12).

Window: calculate the first local instant of this month and of the next month in the business timezone.
Convert each boundary to timestamptz separately and apply the half-open SQL range. The existing rating submission
(60-1) writes the rows.

## 2. 62-2e — one nullable column

Table `employee_documents` (`packages/db/schema/staff-documents.ts`):

| Change | Definition |
|---|---|
| New column | `document_number text NULL` — one-line Arabic comment in the schema file (the name is clear; the comment states the privacy rule) |
| New CHECK `employee_documents_document_number` | NULL is allowed. Non-null values must have 1 to 64 Unicode code points (char_length), no C0/C1 controls and no edge whitespace under the contract's trim policy. PostgreSQL text rejects NUL. Verify parity for supplementary characters and edge whitespace, including NBSP. |

Unchanged: primary key `(company_id, id)`, every index, the RLS policies and grants of migration 0074
(`SELECT, INSERT` on the table, `UPDATE(replaced_at)` only). Consequences:

- The application role can write the number only at `INSERT`. No code path can update or clear it.
- No index on the number: nothing searches by it.
- No backfill: existing rows read `NULL`.

### Migration strategy (expand only)

| File (provisional number — tail at the pin is 0235) | Content | Lock |
|---|---|---|
| `0236_<date>_employee-document-number.sql` | `SET LOCAL lock_timeout = '5s'`; `ADD COLUMN`; `ADD CONSTRAINT … CHECK (…) NOT VALID` | short `ACCESS EXCLUSIVE`, no table scan |
| `0237_<date>_employee-document-number-validate.sql` | `VALIDATE CONSTRAINT` | `SHARE UPDATE EXCLUSIVE`, in its own transaction |

Model: 0194 → 0195. Generated beside them: two `meta/NNNN_snapshot.json` files (about 30,800 lines each at the pin)
and two `_journal.json` entries. Old code keeps working against the new column (it never names it), so the release
can be rolled back to the previous image with the column in place.

Final numbers, the journal `idx` chain and the snapshot `prevId` chain are fixed only at the migration-lane step, on
the manager's word (PP-130).

### Where the number may exist

| Place | Allowed |
|---|---|
| `employee_documents.document_number` | yes — the only stored copy |
| Response of the documents list and of the number lookup, to a current `read:files:business` holder | yes |
| Admin memory while the bell panel or the employee documents section is open | yes, then removed |
| `audit_log`, `outbox`, `in_app_notifications.safe_parameters`, any other notification table, `idempotency_keys.response_body`, pino logs, error bodies, worker code | **no** |

## 3. Domain types

- `EmployeeDocumentRecord` (`apps/api/src/modules/staff/domain/employee-documents.ts`) is **not** extended. The number
  travels beside it (research D-8).
- New contract types: `OwnRatingSummary`, `EmployeeDocumentListItem`, `EmployeeDocumentNumbers`,
  `EmployeeDocumentNumbersQuery`.
