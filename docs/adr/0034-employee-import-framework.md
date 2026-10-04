# ADR-0034 — Employee import framework: XLSX, preview, all-or-nothing commit

Date: 2026-10-04. Status: Accepted for Phase 1 PR 11. `IM-Q1`/`IM-Q2` recorded in spec 030.

## Context

SPEC §2 ships "Excel template, preview, all-or-nothing commit" for employees, services, customers and open
packages; §11 requires "an import with any invalid row saves nothing". Plan row 11 builds the framework and
the employee import; rows 32b/34b/D-51 reuse it. The brief fixes the format (one `.xlsx`, first sheet),
the library (`exceljs` exactly `4.4.0`), the upload path (the PR 12 `files` presigned flow), the preview
contract, the single transaction, and the permission.

Two tensions have to be resolved here.

1. `files` (owner decision 2026-10-03, ADR-0022) accepts only PDF, JPEG and PNG. An import needs a
   spreadsheet MIME, so the allowlist must widen.
2. Anything expected to exceed 200 ms is a BullMQ job (`CLAUDE.md` §6), but the commit must be one
   transaction whose result the manager sees immediately.

## Decision

**Format and library.** One `.xlsx` workbook, first sheet only. The English header row is authoritative;
the Arabic labels are cell comments on the header cells, never a data row, so the sheet's second row is
the first data row. `exceljs` is pinned to exactly `4.4.0` in `apps/api` (parsing is server-side only; no
browser parser). Headers must match the expected set exactly (no missing, extra or duplicate column) or the
preview refuses the whole workbook.

**Upload path.** Through `files`' existing presigned PUT → confirm → worker verification. `files` widens
its single upload policy with the xlsx MIME
`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`; the worker's `file-type@22` already
detects that MIME from the zip's `[Content_Types].xml`, so no new verifier is added. `file_objects` keeps
its 10 MiB cap; the import applies its own ≤ 2 MiB check. There is no multipart route and no file on disk.

**Preview.** `POST …/employees/import/previews` reads the READY file object by id (company, business,
uploader, status, content type, size), downloads it through the injected object-storage port, parses it in
memory and validates every row by reusing the create-employee rules (`validateEmployeeCreation` plus the
`createEmployeeInput` contract). It writes a single `import_previews` row and **never** an employee. The
response carries a stable preview id, the row count and per-row/per-column named errors (i18n keys). A
preview expires after 24 h and is single-use.

**Commit.** `POST …/employees/import/commits` accepts only a zero-error preview. In one `withTenant`
transaction it locks the preview row `FOR UPDATE`, re-checks unused/unexpired, re-resolves every branch of
the preview's business under the current state (a branch deleted since preview fails the whole commit),
inserts every employee and its dated primary attachment, writes one audit row and one `EmployeeImported`
outbox event per employee, writes one `ImportCommitted` summary event, marks the preview committed, and
commits. Any failure rolls back everything. It requires an `Idempotency-Key`.

**Sync vs worker.** Preview and commit run synchronously in `api`. Both are bounded at 500 rows / 2 MiB, the
parse is milliseconds, and the all-or-nothing single transaction cannot be observed asynchronously without
losing the "preview then commit" contract the brief fixes. If profiling at the 500-row cap ever exceeds
200 ms, the commit moves to a worker job with a polling status on the preview row (`IM-Q2`). The template
download is synchronous and tiny.

**Events.** `EmployeeImported` (one per created employee) and `ImportCommitted` (one summary) are emitted
in the commit transaction. No Phase 1 consumer; they are registered in `docs/module-map.md` §4 as known to
the dispatcher, like `EmployeeDocumentRecorded`.

**Reuse.** `domain/import-sheet.ts` is entity-agnostic (headers, row cap, cell coercion, date serials);
`domain/employee-import.ts` is the employee plug-in. Later imports add a plug-in and a column map, reusing
the preview table, storage reader, API shape and UI shell. No second engine.

## Consequences

- `staff → files` is already declared; the import adds no module arrow. It adds the `EmployeeImported` and
  `ImportCommitted` event names only.
- Widening the `files` allowlist means a one-line changeset in the policy, the `requestFileUpload` enum and
  the `file_objects_type` check constraint (new migration); the worker and RLS are unchanged.
- The preview row holds names, roles, dates and branch names in JSONB under RLS. A future retention job may
  delete expired rows (select/insert/update only today).
- Extracting `staff` later needs the object-storage port and a files read API.
- `exceljs@4.4.0` becomes a production dependency of `apps/api`; it is not imported by `packages/domain`,
  so the shared kernel stays dependency-free.
