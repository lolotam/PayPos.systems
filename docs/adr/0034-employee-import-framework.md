# ADR-0034 — Employee import framework: XLSX, preview, all-or-nothing commit

Date: 2026-10-04; amended 2026-10-05. Status: Accepted for Phase 1 PR 11. `IM-Q1`/`IM-Q3` recorded in spec 030.

## Context

SPEC §2 ships "Excel template, preview, all-or-nothing commit" for employees, services, customers and open
packages; §11 requires "an import with any invalid row saves nothing". Plan row 11 builds the framework and
the employee import; rows 32b/34b/D-51 reuse it. The brief fixes the format (one `.xlsx`, first sheet),
the library (`exceljs` exactly `4.4.0`), the upload path (the PR 12 `files` presigned flow), the preview
contract, the single transaction, and the permission.

Two tensions have to be resolved here.

1. `files` (owner decision 2026-10-03, ADR-0022) accepts only PDF, JPEG and PNG. An import needs a
   spreadsheet MIME, so the allowlist must widen.
2. Anything expected to exceed 200 ms is a BullMQ job (`CLAUDE.md` §6). Atomicity requires one
   transaction; it does not require synchronous HTTP completion.

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

**Commit request.** `POST …/employees/import/commits` requires `Idempotency-Key` and returns **202**
`{preview_id}`. One API tenant transaction authorizes, locks the creator-owned preview `FOR UPDATE`,
checks zero errors/unused/unexpired, sets `commit_requested`, and appends an id-only
`EmployeeImportCommitRequested`. Same-preview repeats return the same acceptance without another event.
Authorization precedes key claim/replay. The request is the authorization point for the durable command.

**Worker commit.** The staff BullMQ `employee-import-commit` job uses `withTenant(company_id)` and
locks the preview. Only `commit_requested` can execute. Expiry compares expires_at to stored requested_at
(equality is expired); execution delay does not expire a previously accepted request. It checks errors and branch ownership,
locks current branch keys `FOR KEY SHARE`, then writes employees, primary attachments, audits,
`EmployeeImported` events, the `ImportCommitted` summary and final status/count in one transaction.
Injected Clock supplies one instant. The audit actor comes from the locked preview's creator.
Any failure rolls back inserts; validation failures are marked `failed` in a subsequent transaction.
Unexpected failures retry three times, then become stable `IMPORT_COMMIT_FAILED`. A crash before commit
rolls back; a crash after commit replays a terminal preview without another insert. Redis publishing runs
after outbox claim commit (ADR-0018), following the missed-out transport pattern and staff module wiring.
GET `…/previews/:id` returns creator-only status/count/error; admin polls every second and stops on
`committed`, `failed`, or a two-minute client deadline with a bilingual delayed state. Session storage
retains only the accepted id, scoped by company/business/user; reopening the page reads status again.
Failed previews require a new preview rather than a second commit request.

**Recovery.** Before acknowledging EmployeeImportCommitRequested delivery, staff registers a per-company
BullMQ sweep every minute, using PR 24 / ADR-0022's outbox tenant discovery and scheduler protocol.
No cross-tenant reader or dispatcher exception is added. Each tenant-scoped read takes at most 50
requests aged at least ten minutes, drains successive batches, and conditionally marks only still-pending requests failed with
IMPORT_COMMIT_FAILED. A job that commits between read and update wins. No recovery re-enqueue occurs.

**Sync vs worker.** The earlier synchronous constraint and < 1,000 ms fallback came from the
orchestrator's brief, not an owner decision. That fallback was withdrawn on 2026-10-05.
`CLAUDE.md` §6 requires work expected to exceed 200 ms to run in BullMQ in the worker.
Earlier full-use-case measurements were 478.40, 556.74, 634.35 and 472.37 ms.
The delta first profiles one warm-up and five 500-row commits, including authorization and COMMIT,
then optimises without weakening atomicity or authorization. A median ≤ 200 ms permits synchronous
commit; otherwise the whole transaction moves to the worker with preview-status polling in this PR.
Template download remains synchronous. The final measurements and execution decision follow below.

### Stage A evidence and final execution decision

Temporary test-only transaction/statement instrumentation ran one separate 500-row warm-up and five
500-row commits on the repository test harness. The table gives per-step medians in milliseconds;
independent step medians do not sum to the total median. Total covers the entire use-case call,
including tenant setup, idempotency, record/SQL preparation and instrumentation. COMMIT is measured
from return of the transaction callback to return of `withTenant` (including driver completion).

| Step | Before | After retained optimisations |
| --- | ---: | ---: |
| Authorization/locks | 17.76 | 24.18 |
| Preview FOR UPDATE | 2.87 | 4.08 |
| Branch re-resolution | 7.38 | 9.57 |
| Employees INSERT | 133.79 | 230.93 |
| employee_branches INSERT | 82.41 | 181.18 |
| appendAuditLogs | 79.19 | 42.18 |
| appendOutboxEvents (aggregate locks + INSERT) | 76.41 | 57.72 |
| ImportCommitted | 5.32 | 4.85 |
| Preview update | 1.58 | 2.21 |
| COMMIT | 1.58 | 1.89 |
| Idempotency | 4.85 | 7.60 |
| Tenant setup | 2.40 | 3.00 |
| Preparation/instrumentation | 52.33 | 45.68 |
| **Full call median** | **470.01** | **594.43** |

JSONB recordsets retained for audit/outbox reduce parameters and preserve SQL NULL versus JSON null,
redaction, actor/tenant stamping and aggregate lock order. Employees/attachments INSERT SELECT trials
did not improve the full median (469.87–571.06 ms), so their existing multi-row VALUES are retained.
No total improvement is claimed: shared database scheduling and per-row trigger costs remain dominant.
EXPLAIN ANALYZE found employee foreign-key checks ~46 ms and attendance-state initialization ~79 ms
per 500-row statement; employee INSERT alone was ~134–141 ms. Attachments have three FK triggers;
audit/outbox have company FK triggers. No integrity trigger was disabled or weakened.

Import authorization now locks only the caller's memberships, while retaining the company
`FOR NO KEY UPDATE` lock. PR 7 permission/membership editors acquire that same company lock first,
so they cannot change grants during acceptance; create-employee's original broader protocol is unchanged.
Outbox uses one batch INSERT after one ordered aggregate-lock statement, preserving commit order.
The warm median remains above 200 ms: **Stage B is implemented in this PR**, with no deferred IM-Q2.
The warm API acceptance integration assertion is **< 200 ms**; the full workspace check measured
**32.48 ms** for acceptance of a 500-row preview after a separate warm-up request. This is one
acceptance measurement, not a median or worker creation time. Heavy creation runs only in worker.
The temporary profiler is removed. No new external dependency. API staff owns create-employee rules;
the worker consumes immutable validated preview rows and checks only branch membership and request-time
expiry. Staff types/rules are removed from the shared kernel and worker no longer depends on it.

**Events.** `EmployeeImported` and `ImportCommitted` are emitted in the worker commit transaction.
They have no Phase 1 business consumer. `EmployeeImportCommitRequested` is transported to the staff
worker job; all three names are registered in module-map §4.

**Reuse.** `apps/api/src/shared/import/import-sheet.ts` is entity-agnostic (headers, caller-supplied row cap and source row positions);
`domain/employee-import-row.ts` and `domain/employee-import-cells.ts` hold pure employee row/date rules;
the application passes plain contract results into the domain. Later imports add a plug-in and a column map, reusing
the preview table, storage reader, API shape and UI shell. No second engine.

## Consequences

- API `staff → files` is already declared. Worker `staff → tenancy.employeeImportBranches` is added
  for locked branch revalidation. The module map declares all three import events and the request consumer.
- Widening the `files` transport allowlist changes the policy, `requestFileUpload` enum and
  `file_objects_type` check constraint (migration 0077). Employee documents retain PDF/JPEG/PNG only
  (owner decision 2026-10-03), rejecting XLSX with bilingual DOCUMENT_FILE_TYPE_INVALID.
- The preview row holds names, roles, dates and branch names in JSONB under RLS. TODO(spec) IM-Q3 tracks the retention policy and future privileged cleanup job/grant
  (select/insert/update only today); recommend deletion 30 days after expiry, pending owner decision.
- Extracting `staff` later needs the object-storage port and a files read API.
- `exceljs@4.4.0` becomes a production dependency of `apps/api`; it is not imported by `packages/domain`,
  so the shared kernel stays dependency-free.
- Migration 0079 adds status/request/count/error fields and column UPDATE grants, backfilling older
  consumed previews as committed. New migration 0080 adds company/creator and company/status/requested_at/id
  indexes plus committed timestamp, failed error and committed-only count checks. In 0077 only the
  file_objects_type re-add becomes NOT VALID followed by VALIDATE; its snapshot and 0078 are unchanged.
- Pure employee-creation rules stay in API staff domain. Commit persistence exists only in worker.
- IM-08 explicitly accepts the authorization window: a manager revoked after API acceptance still
  gets the accepted import committed. Worker does not recheck the feature flag or company deletion.
  Normally the window is seconds; worker/dispatcher outages can make it hours. The ten-minute stale
  threshold plus one-minute sweep cadence bounds recovery once worker/DB/Redis are available; recovery
  cannot run while they are down. A commit that already won the transaction race remains committed.

## Review hardening

ZIP input is limited to 2 MiB and 5 MiB actual expansion. The dependency-free central-directory
reader also bounds real inflation with Node zlib, rejecting forged size metadata before ExcelJS.
The layer-2 benchmark fills a real downloadable template with 500 valid rows, unique 255-character
English/Arabic names, a 255-character branch label, role and both dates. Its compressed size is
26,051 bytes and actual expansion 541,718 bytes, comfortably within 5 MiB. One separate preview
warm-up followed by five full preview-use-case calls (authorization, object read, ZIP guard,
ExcelJS parse, row validation and saved preview) measured 92.42, 90.30, 87.64, 88.85 and 88.30 ms;
median **88.85 ms**, maximum **92.42 ms**, on the worktree's isolated test DB. This measures the
maximum-field-length template case, not every possible malformed ZIP or extra-sheet payload.
Preview remains synchronous for this review round.
Third-layer hardening scans dimensions and merged ranges in every worksheet before ExcelJS loads.
Bounds are 502 physical rows, eight columns and four worksheet parts: the row-limit error still
sees the 501st data row; two spare columns retain unexpected-column feedback; the two-sheet template
has room for two additional sheets. Oversized structure, including ignored-sheet merges, is 422
IMPORT_FILE_CONTENT_INVALID. Exactly one EOCD signature, an EOF-aligned ZIP comment, consistent
central/local metadata and no ZIP64 or alternate paths prevent guard/parser directory disagreements.
API expiry and requested_at share one Clock instant, with equality expired. Aliases of one branch
do not create ambiguity. Admin preview/result state belongs to the current file selection; selecting
another file resets it and stale preview responses cannot enable commit.
Only populated rows are visited; 501 non-empty data rows refuse the workbook. Blank trailing rows
are ignored and source row numbers survive sparse input. Unheaded data produces a named row error.
Storage read size failures and workbook parse failures are 422 `IMPORT_FILE_CONTENT_INVALID`;
transient storage errors are 503 `STORAGE_UNAVAILABLE`, both bilingual.

Read authorization for template/preview takes no company or membership write lock and validates
business existence before disclosure. Commit authorizes and verifies creator ownership before any
idempotency replay. Employee/attachment inserts, audits and outbox events use batch statements;
`appendOutboxEvents` preserves advisory aggregate locks and event order. No new dependency.

Commit uses branch ids: they must still exist in the business. Rename is allowed. Inactive branches
are allowed exactly like create-employee (`employeeWorkplace` has no `is_active` predicate).
Injected Clock supplies the same instant for employee creation, summary event and preview consumption.
Identity access and files fact-reader edits outside staff are declared in spec 030.
