# Feature Specification: Employee import — template, preview, all-or-nothing commit

**Created**: 2026-10-04
**Status**: Implementation slice; recorded PR 11 acceptance contract, amended by the 2026-10-05 delta.
**Input**: Phase 1 plan row 11, SPEC §2 "Import", §11 acceptance "An import with any invalid row saves nothing",
the later rows that reuse this framework (32b services, 34b customers, D-51 open packages), spec 013 create-employee,
spec 017 update-employee, spec 014 + ADR-0022 (files), CLAUDE.md §6/§8, ADR-0018.

## User Scenarios & Testing

An authorised manager downloads the employee template for one business, fills it, uploads it through the
existing private-files flow, previews it, and commits only when the preview is clean. One invalid row
saves nothing.

**Independent Test**: preview a workbook with one invalid row → no employees written; fix the row,
preview again, commit → every employee created in one transaction, each with its audit row and outbox
event, plus one import summary event.

### Acceptance scenarios

- IM-01: the template is downloadable per business as one `.xlsx` workbook, bilingual headers.
- IM-02: preview parses only the first sheet, validates every row and cell with the create-employee rules,
  and writes no employees. Unknown business/file returns the same 404 as a missing one.
- IM-03: a preview with zero errors can commit; every row lands in ONE transaction; any failure saves nothing.
- IM-04: commit re-validates under lock; a branch deleted between preview and commit fails the whole commit.
- IM-05: a preview expires after 24 h and is single-use; concurrent commit requests yield the same 202
  acceptance, one request event, and one worker effect. Terminal worker retries cannot create duplicates.
- IM-06: the business/file/preview of another tenant or another business answer exactly like unknown.
- IM-07: commit requires an `Idempotency-Key`; a repeat returns the stored result without a second import.
- IM-08: permission is `manage:employees:business` at API acceptance; Device is never accepted.
  Later revocation does not cancel the durable command; worker does not recheck feature flag/company
  deletion. Stale requests recover through the ten-minute sweep threshold described below.
- IM-09: a workbook over 2 MiB or over 500 data rows is refused before any write.

## Requirements

### Review hardening (2026-10-04)

Workbook loading is guarded at 2 MiB compressed and 5 MiB actual decompressed ZIP content,
without a new dependency. Read only present rows and stop at 501 non-empty data rows; trailing
blank rows are ignored. Data beneath an empty header is an `IMPORT_COLUMN_UNEXPECTED` row error.
Storage read size violations and invalid workbook content return `IMPORT_FILE_CONTENT_INVALID`
(422); storage outages return `STORAGE_UNAVAILABLE` (503), with bilingual envelopes.
Template and preview authorization reads do not lock companies or memberships. Unknown/foreign
businesses follow create-employee's refusal. Commit authorizes before idempotency and requires
the preview creator. Employee and attachment inserts, audit and outbox writes are batched.
The injected clock supplies employee and commit timestamps. Stage A measured the synchronous work;
Stage B moves creation to the worker and tests the warm API acceptance against the 200 ms rule.

### Touched outside the slice

- `identity/persistence/employee-creation-access.ts` and `identity/index.ts`: reuse the PR 7
  lock protocol for commit and expose a non-locking management access read for template/preview.
- `files/queries/document-file.query.ts`: include verified file facts needed to check import
  business, uploader, status, type and size without exposing storage details in the HTTP response.
- `packages/db/src/outbox.ts`: batch events while retaining aggregate locks and ordering.
- Delta: `packages/db/src/audit-log.ts` and outbox batch writers use JSONB recordsets with one bound
    payload, preserving SQL NULL/JSON null, redaction and explicit event order.
- Layer-2 review: create-employee rules remain in API staff domain; the shared kernel has no staff
  records or rules. Worker checks only immutable-preview request-time expiry and current branch membership.
- Delta: worker tenancy exposes `employeeImportBranches` to staff through its declared adapter;
    branch KEY SHARE locks preserve ownership during the job without cross-module SQL in staff.
- Delta: import i18n errors move into the existing employee-import catalog file to keep ar/en
    catalogs below 400 lines; both generated admin/POS API schemas follow the changed OpenAPI.
- The leave fixture is main's version, unchanged by this hardening.
- Delta: bounded production smoke fixtures use an OS-assigned available port; fixed random ranges
  can hit Windows-reserved ports and reject an otherwise healthy built worker.
- Delta: the OTP startup unit fixture preloads the expanded staff graph before timed tests,
  matching its notification preload; startup deadlines and assertions remain unchanged.
- `apps/worker/src/main.ts`: compact the existing Redis logging callback with identical behavior
  to resolve the pre-existing 401-line lint failure discovered by the required full gate.

Branch re-validation requires that the stored branch id still belongs to the business. Renaming
does not change the id and remains valid. Inactive branches follow create-employee exactly
(creation permits inactive branches; import does too). There is no branch soft delete.
TODO(spec) IM-Q3: define preview retention and the privileged cleanup grant/job in a later slice;
recommend deleting expired previews after 30 days, subject to the owner's retention decision.

- FR-001: one `.xlsx` workbook, first sheet only. English header row is authoritative; the Arabic labels
  ride as cell comments on the header cells and are never parsed, so the first data row is the sheet's
  second row. `exceljs` is pinned to exactly `4.4.0` (ADR-0034).
- FR-002: upload through the existing files presigned flow; no multipart route, no file on disk.
- FR-003: the import reads the READY file object by id, verifies company, business, caller, status,
  content type and size (≤ 2 MiB), and needs ≤ 500 data rows.
- FR-004: employee columns are exactly the PR 8 create-employee inputs a manager types — no salary,
  no permissions, no phone/user linking. Names/roles/branch by name; branch name resolves inside the business.
- FR-005: preview reuses `validateEmployeeCreation` and the create-employee contract rules; it never writes
  employees. It returns a stable preview id, the row count and per-row/per-column named errors (i18n keys).
- FR-006: commit accepts only a preview with zero errors; all rows in one tenant transaction; re-validates
  branch ownership under lock; branches are never invented.
- FR-007: each created employee writes an audit row, one `EmployeeImported` outbox event, and the commit
  writes one `ImportCommitted` summary event — all inside the same transaction (ADR-0034).
- FR-008: duplicate names and future hire dates are allowed (owner decision PR 8); create-only, no updates.
- FR-009 (TODO(spec) IM-Q1): using a real `user_id` in the sheet is out of scope; `user_id` is not a column.

### Edge cases

Before ExcelJS loads any sheet, every worksheet XML part is structurally bounded: at most four
worksheets, 502 physical rows (header plus the 501st data row needed for the named row-limit error),
and eight columns (the six template columns plus two for nearby unexpected-column feedback).
Oversized dimensions, merged ranges, data-validation ranges or defined names (whole rows, whole
columns and formulas included), even in ignored sheets, return IMPORT_FILE_CONTENT_INVALID.
ZIP input must have exactly one EOCD signature, an EOF-aligned comment, a consistent central directory,
and no ZIP64 or trailing bytes. Commit expiry and requested_at use one injected Clock instant;
equality with expires_at is expired. Duplicate aliases of one branch remain resolvable; only different
branch ids make a name ambiguous. Selecting another file clears the displayed preview/result and
discards late preview responses for superseded selections.

Empty rows are skipped. Formulas are read as their cached result; an error cell is `IMPORT_CELL_INVALID`.
Dates accept real dates, Excel serial numbers and ISO text. Extra or missing headers, or a duplicate header,
refuse the whole preview as `IMPORT_HEADER_INVALID`. An empty data sheet is `IMPORT_HEADER_INVALID`
(no body). A row beyond 500 is `IMPORT_ROW_LIMIT_EXCEEDED`.

## Slice design

### Framework

A small, entity-agnostic table reader (`apps/api/src/shared/import/import-sheet.ts`) normalises an xlsx matrix into headers
and data rows and enforces the header contract and row cap. An entity plug-in (`domain/employee-import-row.ts`)
maps an employee row to a candidate and reuses `validateEmployeeCreation`. Later services/customers/packages
imports reuse `import-sheet.ts` and add their own plug-in; the preview table, storage reader, API shape and
UI shell are shared, so PRs 32b/34b/D-51 add a plug-in, not a second engine.

### Storage and content type

`files` accepts one more upload type, the xlsx MIME
`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (owner decision is required to widen
the PR 12 allowlist; recorded in ADR-0034). The worker's `file-type` detection already names this MIME, so
the existing verification pipeline proves it. The import re-checks ≤ 2 MiB and parses server-side only.

### Schema changes

| Table | Columns | RLS / grants | Indexes | FKs |
| --- | --- | --- | --- | --- |
| import_previews | company_id, id, business_id, entity, file_id, created_by, created_at, expires_at, committed_at?, status, requested_at?, created_count, error_code?, row_count, error_count, rows, errors | SELECT/INSERT/column UPDATE, FORCE | company/business/created_at; company/file; company/created_by; company/status/requested_at/id | company root; company/business; company/file_objects |

`rows` and `errors` are JSONB and carry no secret: names, role codes, dates, branch names and named error
codes only. `file_id` is stored for provenance. No DELETE grant: TODO(spec) IM-Q3 tracks the retention decision and future cleanup job/grant.

### API contract

- GET `/v1/businesses/{businessId}/employees/import/template`: 200
  `{ file_name, content_type, content_base64 }`; `manage:employees:business` + staff feature + selected company.
- POST `/v1/businesses/{businessId}/employees/import/previews`: 201
  `{ preview_id, row_count, error_count, errors:[{row,column,code}] }`; body `{ file_id }`.
- POST `/v1/businesses/{businessId}/employees/import/commits`: 202
  `{ preview_id }`; body `{ preview_id }`; requires `Idempotency-Key`. Atomically authorizes, locks the
  creator-owned clean/unused/unexpired preview, sets `commit_requested` and appends one id-only
  `EmployeeImportCommitRequested`. Repeated requests for the same preview return the same acceptance.
- GET `/v1/businesses/{businessId}/employees/import/previews/{previewId}`: 200
  `{ preview_id, status: ready|commit_requested|committed|failed, created_count, error_code }`.
  Another user's/tenant's/business's preview returns exactly the unknown-preview refusal.
- All four use `@Authenticated()` + `SelectedCompanyGuard`; request permission is resolved inside the tenant
  transaction at the business primary scope. Template/preview use non-locking authorization reads;
  commit follows create-employee's write-lock protocol.
- Errors: `IMPORT_FILE_NOT_FOUND` (404, unknown/cross-tenant/cross-business/not-uploaded-by-caller alike),
  `IMPORT_FILE_NOT_READY` (409), `IMPORT_FILE_TYPE_INVALID` (415), `IMPORT_FILE_SIZE_INVALID` (413),
  `IMPORT_PREVIEW_NOT_FOUND` (404), `IMPORT_PREVIEW_EXPIRED` (409),
  `IMPORT_HEADER_INVALID` (422), `IMPORT_ROW_LIMIT_EXCEEDED` (422), `IMPORT_PREVIEW_HAS_ERRORS` (409),
  `IMPORT_FILE_CONTENT_INVALID` (422), `STORAGE_UNAVAILABLE` (503), plus standard access/validation/retry envelopes.

### Permissions

`manage:employees:business`. No new permission. Device never accepted (selected-company guard).

### Events

- `EmployeeImported` — one per created employee, `aggregate_type employee`, inside the commit transaction.
- `ImportCommitted` — one summary, `aggregate_type import_preview`.
- `EmployeeImportCommitRequested` — id-only `{preview_id}`; company id comes from the outbox envelope.
  Staff worker transports it to BullMQ outside the outbox claim transaction (ADR-0018).
EmployeeImported/ImportCommitted have no Phase 1 business consumer; module-map §4 records all events.

### The 200 ms rule

The earlier synchronous constraint and < 1,000 ms fallback came from the orchestrator's brief,
not an owner decision; the fallback was withdrawn on 2026-10-05. The 200 ms rule is mandatory.
Stage A ran one warm-up plus five 500-row commits: median 470.01 ms before, 594.43 ms after retained
audit/outbox parameter optimisations. JSONB employee/attachment trials also remained above 200 ms.
ADR-0034 records the full breakdown and FK/attendance trigger evidence. Stage B is implemented:
API accepts in a short transaction (warm integration assertion < 200 ms); worker owns the heavy commit.
Preview and commit retain their 500-row / 2 MiB bounds.
The maximum-field-length 500-row template preview benchmark has a warm five-run median of
88.85 ms (maximum 92.42 ms); its 541,718-byte expansion fits the reduced 5 MiB guard (ADR-0034).

### Worker and polling

The staff worker uses one tenant transaction and preview FOR UPDATE. Expiry is checked against
stored requested_at (expires_at must be strictly later), rather than the worker clock. It checks errors,
locks branch keys to prevent deletion, verifies branch membership, and creates every immutable validated row
and audit/event, writes ImportCommitted and marks committed with counts using one Clock instant.
Validation failure rolls back all rows and records a stable failed code in a separate transaction;
unexpected errors retry three times before IMPORT_COMMIT_FAILED. Terminal status makes crash retries
and redelivery harmless. Authorization is checked at API acceptance; the worker executes that durable
command and stamps audit with its locked creator. IM-08 accepts revocation after API acceptance:
the manager's later revocation does not cancel creation; feature flag and company deletion are not
rechecked by the worker. Normally the window is seconds; an outage can delay execution for hours.
A recurring staff sweep fails still-pending requests aged at least ten minutes once the worker/DB
are available, bounding recovery by the threshold plus sweep cadence; an already committed row wins.
Inactive and renamed branches match create-employee.
Tenant discovery follows PR 24 / ADR-0022: EmployeeImportCommitRequested registers a recurring
per-company BullMQ sweep outside the outbox transaction, before publishing the commit job.
The sweep conditionally fails only still-pending stale rows with IMPORT_COMMIT_FAILED; it cannot
overwrite a committed row. Admin polling stops on terminal status or after two minutes, showing a
bilingual delayed state. The last accepted preview is retained per company/business/user in session
storage, so reopening the page reads its status again. No component fetch.
Migration 0079 adds status/requested_at/created_count/error_code and UPDATE grants; older consumed rows
backfill to committed. New migration 0080 adds the creator/sweep indexes and checks: committed status
iff committed_at exists, failed requires error_code, and created_count is zero outside committed.
Only 0077's file_objects_type re-add changes to NOT VALID followed by VALIDATE; its snapshot is unchanged.
Employee documents still accept only PDF/JPEG/PNG, rejecting XLSX with DOCUMENT_FILE_TYPE_INVALID.
No additional external dependency.

### Test plan

- Pure domain: header contract (missing/extra/duplicate), row cap 500/501, serial/ISO/text dates, contract
  ordering reuse, branch name resolution, error codes per column.
- Parser adapter: bad headers, extra columns, formula/rich-text cells, dates as serials vs text, empty rows,
  a 2 MiB+1 and 501-row workbook.
- Integration: preview → commit happy path, invalid row saves nothing, concurrent double commit, expired and
  used previews, cross-tenant file/preview, branch deleted after preview, idempotent repeat, RLS negative.
- Query shape + `EXPLAIN ANALYZE` for the preview lookup.
- Admin UI: template download, upload/preview, per-row errors, commit disabled until clean, result summary.

## Success Criteria

- An import with any invalid row saves nothing.
- A clean preview commits exactly its rows, once, with one audit and one event per employee.
- No cross-tenant or cross-business file or preview can be read, previewed or committed.
- Both languages expose the same template, preview and error feedback.

## Assumptions

Admin is online. Storage is configured; without it the import answers `STORAGE_NOT_CONFIGURED` on preview.
No new external dependency beyond `exceljs@4.4.0` (apps/api). Staff's existing tenancy arrow gains
the declared worker `employeeImportBranches` reader.

## Open questions for the owner

- **IM-Q1** — should a later PR allow a `user_id`/phone column to link imported employees to existing users?
  Recommendation: no in Phase 1; linking stays an explicit edit (spec 017).
- **IM-Q3** — define retention for names/dates in expired previews and authorize a cleanup job.
  Recommendation: 30 days after expiry, in a separate retention slice.
