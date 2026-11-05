# Binding manager design - 47-1

Source: manager note, 2026-11-05.

## 47-1 — package import framework

1. **New arrow `orders → files`.** The preview needs `documentFileFacts`, as staff does. The manager approves adding
   the arrow **inside 47-1**, with its row in `docs/module-map.md` and an ADR-0010/ADR-0034 addendum (CLAUDE.md §4.1).
2. **The reader.**
   - It moves to `apps/api/src/shared/import/xlsx-sheet-reader.ts` as `readWorkbookMatrix(bytes, bounds)`, with `bounds = { maxBytes, maxDataRows, maxColumns, maxWorksheets }`.
   - It throws a shared error carrying `IMPORT_FILE_CONTENT_INVALID | IMPORT_ROW_LIMIT_EXCEEDED`.
   - Staff passes its current constants unchanged, and its adapter maps the shared error to `EmployeeImportError`. The staff reader file is deleted and its tests move.
   - The packages bounds are 2 MiB, 500 data rows, 68 columns and 4 worksheets.
3. **The domain.**
   - `orders/domain` imports only `@pospay/domain`. `package-import-cells.ts` holds `ImportCell`, `INVALID_CELL`, `cellText` and Excel dates, as staff's precedent does.
   - `package-import-row.ts` validates each row:
     - E.164 phone;
     - money with at most 3 decimals through `parseMoney`;
     - a date, with past dates allowed;
     - `external_ref` of 1…100 characters, a duplicate in the file is an error, and one already in the company is a skip;
     - each group is all three columns or none, with at least one group;
     - the service matches `name_en` or `name_ar` case-insensitively, else `IMPORT_SERVICE_AMBIGUOUS`;
     - sessions and remaining go through `validatePackageDefinition`.
   - Allocation uses bigint mills in session-count mode: the remainder goes to the last slot of the last component, so 10.001 becomes 3.333 / 3.333 / 3.335.
4. **Customer lookup, batched (Fable's P1 is adopted).**
   - `CustomerLookupPort.findByPhones(e164s)` makes one query per preview. That changes the method name TD-11 records, and the change is noted in the spec.
   - It goes through a reader exported from `customers/index.ts`, on the same transaction.
   - It returns `{ id, phone_last3 }` only. The full phone never appears in logs, errors, audit or the preview JSON.
5. **Permission.**
   - `import:packages:business`, defaulting to the owner, general manager and business manager.
   - It is device-denied, with a seed migration in the 0201 shape.
   - The routes use `@Require('import:packages:business', { business })` and `@RequiresFeature('orders')`, and are registered in `route-coverage.ts`.
6. **Out of scope.**
   - The commit, worker, event and recovery sweep belong to 47-2.
   - 47-1 must not touch `sell-package`, `record-service-session`, `append-service-session-lines` or `cancel-redemption`.
   - Shared files with 42-3b are `orders.module.ts`, the contracts index and the generated OpenAPI. Rebase on them; never hand-merge.
   - Shared files with 46-1 are the access catalog, the role defaults, the device-deny policy, i18n and the seed migration number.


## Superseding manager decisions - asynchronous split

The original copied note above is preserved verbatim. The manager subsequently
approved a preview worker inside 47-1 after the 719.70 ms measurement, then approved
47-1a request/polling and 47-1b worker/activation in the decision supplied as 15:57
Kuwait. This supersedes item 6 only for preview jobs/events; financial import commit
and its recovery remain 47-2. See owner-questions.ar.md and 47-1-async-split-plan.md.
In 47-1a the controller is absent from ordersControllers in production; tests mount
it explicitly. 47-1b starts in the same session only after 47-1a merges.
