# Plan 56-1b: commission statement workbook and worker source

Scope: spec 059 FR-050, FR-051, CM-55, CM-55b, CM-55f and CM-56 only.
No request/poll/collect use cases, HTTP, audit, schema, migration or UI (56-1a/56-1c).

## 1. Files

- `packages/documents/src/excel/commission-statement.ts`: pure ExcelJS workbook builder and input types.
- `packages/documents/src/excel/commission-statement-rows.ts`: the workbook row and total types only.
- `apps/worker/src/modules/commissions/domain/commission-statement-totals.ts`: per-employee totals and net payable, using `Money`/`sumMoney` only.
- `apps/worker/src/modules/commissions/ports/commission-branch-names.port.ts` and `apps/worker/src/modules/tenancy/persistence/branch-names.ts`: the branch names where the work was done, bound in `apps/worker/src/main.ts` (ADR-0054 §4).
- `packages/documents/src/__tests__/commission-statement.spec.ts`: open the bytes with ExcelJS and assert the real cells.
- `packages/documents/src/index.ts`, `packages/documents/package.json`: export the builder; add `exceljs` 4.4.0 (the version already in the lockfile).
- `packages/i18n/src/commission-statement-catalog.ts`, `packages/i18n/src/index.ts`: ar/en labels in one catalog file.
- `apps/worker/src/documents/sources/commission-statement-labels.ts`: catalog accessor, following the attendance labels source.
- `apps/worker/src/documents/sources/commission-statement.source.ts`: `BytesDocumentSource`, `output: 'bytes'`, the contract's xlsx MIME type.
- `apps/worker/src/modules/commissions/{ports,persistence,queries,use-cases}/…`: read-only export reader and its typed missing-request error.
- `apps/worker/src/modules/commissions/{commissions.module.ts,index.ts}`: composition and public reader factory.
- `apps/worker/src/main.ts`: register `COMMISSION_STATEMENT_EXPORT_DOCUMENT_KIND` at the existing document composition root.
- `apps/worker/src/modules/commissions/__tests__/…`: real-Postgres reader/filter/RLS/result-shape/EXPLAIN tests and their fixture.

`packages/contracts/src/documents-render.ts` already contains the xlsx entry keyed by the 56-1a kind constant, so no contract edit is needed.

## 2. Reader and row filter

The reader opens one `withTenant(companyId, …)` transaction, performs only SELECT statements, and loads the export request by `(company_id, render_id)`. A missing/cross-tenant request throws the typed missing-request error and reads no statement rows. It then reads only `commission_statement_lines` for the request's `statement_id`, ordered deterministically; it never reads projection, employee or customer tables. The one live read is the branch names, through the `CommissionBranchNamesReader` port on the same transaction (CS-Q35 is pending; the freeze is #718).

- `BUSINESS`: keep every frozen row, including rows whose `attached_branch_ids` is empty.
- `BRANCHES`: keep a row only when its `employee_id` is in saved `employee_ids` **and** its frozen `attached_branch_ids` overlaps saved `branch_ids`.
- The rule applies identically to `EMPLOYEE`, service, sale, tip, correction and carry rows. Thus a transferred employee contributes only the saved branches' rows (CM-55f), while `source_branch_id` remains display data and is never a filter key.
- The reader returns frozen amounts as `bigint` mills via `parseMoney`; the workbook formats with `moneyToString`, never a JS `number`.

## 3. Workbook columns

Summary sheet, one row per employee: employee number, localized frozen employee name, commission (`COMMISSION`), sales commission (`SALE`), corrections received (`CORRECTION` plus `CARRY_COMMISSION`), card tips (`TIP_CARD`, its corrections and carry), cash tips for information (`TIP_CASH` and its corrections), and net payable, plus a «Partial» column in `BRANCHES` scope. Net payable follows spec §9: `max(0, commission + sales + commission-side corrections) + max(0, card-tip side)`, all in `bigint` mills. Cash tips never enter payable.

Detail sheet, one row per non-`EMPLOYEE` frozen source row: employee number, localized employee name, localized entry kind, business date, localized branch where the work was done (performed at), localized frozen service name, frozen full customer name, source period, previous amount, new amount and amount. Service/customer labels come only from the frozen row; no phone or live name is read. Empty fields stay empty.

All money cells are strings with exactly three decimals (`41.003` remains `41.003`). Arabic sheets use `rightToLeft: true`; English sheets use LTR. The cash-paid case adds summary column «اتصرف كاش» / "Paid cash" with the stored rounded per-employee amount (`41.005`), while net payable stays exact.

## 4. Tests

- Builder: Arabic and English sheet/header labels and RTL; summary totals and net payable; exact amount strings after reopening with ExcelJS; frozen employee/service/customer names; no phone field; paid-cash column present only with cash-payment data and carrying the rounded value.
- Reader (real Postgres, using `packages/db/test/commission-statement-fixtures.ts` like 48a-2): BUSINESS keeps all rows; BRANCHES applies both saved sets; the transferred-employee case keeps early rows plus their correction and excludes later rows, amounts and customer names; missing render id; another tenant's render id is invisible; result shape and index usage through EXPLAIN ANALYZE.
- Source: returns bytes with the xlsx MIME type and does not invoke any PDF renderer (the existing 56-0 transport tests already prove that branch).

## 5. Integration blocker, not a guessed rule

CS-Q34 is decided, and the builder/test contract above implements it. This checkout has no 54-1 `paid_method` or stored rounded per-employee payment columns/record in `packages/db/schema` (and no payment table elsewhere). Therefore the persistence reader cannot obtain the cash-paid inputs without a schema dependency outside 56-1b. The workbook API accepts those inputs explicitly; no fallback recomputes rounding and no PAID status is treated as proof of cash. On this schema the use case fails PAID requests with `COMMISSION_STATEMENT_PAYMENT_DATA_UNAVAILABLE` inside the worker, which the document job records as `STATEMENT_EMPTY` until a dedicated render error code exists (#719), rather than silently omitting the required cash column; APPROVED requests are unaffected. The final handoff must call out this remaining 54-1 wiring gap rather than claim the end-to-end cash-paid export is complete.

One `TODO(spec)` stays in the code: a statement whose payment data cannot be read is reported as `STATEMENT_EMPTY`, because the document contract has no dedicated error code yet (#719). One owner question is still open: CS-Q35 (freeze the branch name at approval, PP-80.1). Waleed picked the freeze and the partner's answer is pending; until it settles the export reads the name live by id, and the freeze is tracked in #718. The export's use case is the third read use case, recorded in the ADR-0054 §5 addendum.
