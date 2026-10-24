# ADR-0056 — Attendance statement: where its reads live, the files-owned logo reader, and the request record

- **Status:** Accepted — 2026-10-23, with sub-PR 27g-1 (proposed 2026-10-21 with
  [spec 061](../specs/061-staff-attendance-statement-pdf/spec.md), Phase 1 row 27g).
- **Amends:** [ADR-0046](0046-business-identity-settings-reads-and-logo-lifecycle.md) §5 (where the identity read and the
  logo bytes reader live, and the `staff → settings` arrow it left to this ADR); a pointer is added there and in
  ADR-0049 §6.
- **Builds on:** [ADR-0049](0049-pdf-renderer-in-phase-1.md) §1 (request, poll, collect once), §5 (module map) and §6
  (the logo bytes reader moves to 27g, PP-6.2); [ADR-0031](0031-employee-document-file-binding.md) (`staff → files`).

## Context

Row 27g prints the official attendance statement. ADR-0049 fixed the transport: the API writes a request record and
enqueues `{ company_id, render_id, kind }`; a document source in the **worker** reads every fact under
`withTenant(company_id)`, closes the transaction, then renders. The statement needs four reads:

1. the attendance inputs of the period, today read by the API's 27b query
   (`apps/api/src/modules/staff/queries/attendance-monthly-report.query.ts`, `attendanceMonthlyInputsStatement`);
2. the business's stored identity (`official_name_ar`, `official_name_en`, `logo_file_id` on `business_settings`) and the
   pure header fallback `statementIdentity`, both exported today by `apps/api/src/modules/settings/index.ts`;
3. the logo bytes, which only `files` may read (`packages/storage` belongs to `files`), with an access audit for the
   requester (ADR-0046 §5);
4. the request parameters (form, branch, employee, period, language), which the job payload must not carry.

ADR-0046 §5 assumed an **API** `staff → settings` import and left that arrow to this ADR. ADR-0049 then put the reads in
the **worker**. The worker has no `settings` module, and an app never imports another app's code (only test fixtures do
today). Duplicating the 27b SQL or the header fallback in the worker would let the statement and the monthly report
drift apart, which is exactly the failure the statement must not have: its figures must equal the report's.

## Decision

### 1. All statement data is read in the worker; the API only records which logo the render will use

The API side of 27g (request, status, collect) reads `staff`'s own request table, the permission through the existing
guard, Redis, and one stored fact: the business's bound `logo_file_id`, read in the request transaction through a
port the API `staff` module owns (`StatementLogoReferenceReader` in `staff/ports/`), whose `persistence/` adapter calls
the shared `@pospay/db` `readBusinessIdentity` (§2); the use case depends only on the port. The id is written on the
request row (§5). That makes the logo decision of a
render, a file **or none**, durable before any attempt, so a retry can never change it (§3). This is a read of a shared
statement, not a `settings` import: **no API `staff → settings` arrow** is added, and the API's `staff → files` arrow
keeps its ADR-0031 purpose only.

### 2. Shared reads go to the shared packages, not to a second copy

Following the precedent of `lockBusinessLogoReference` (ADR-0046 §4: one function in `@pospay/db`, called by the API
settings adapter and the worker files adapter, with no `files → settings` import):

- The identity read statement moves from `apps/api/src/modules/settings/persistence/read-business-identity.ts` to
  `@pospay/db` (`readBusinessIdentity`, same SQL, same `businessIdentityReadStatement` for EXPLAIN). `settings/index.ts`
  keeps exporting it, so its callers do not change.
- The pure fallback `statementIdentity` (and its types) moves from `settings/domain/statement-identity.ts` to
  `packages/domain`, with its unit tests. `settings/index.ts` re-exports it. It is pure TypeScript with no dependency,
  which is what `packages/domain` holds.
- The 27b inputs statement (`attendanceMonthlyInputsStatement` and `attendanceReportContractsStatement`) moves to
  `@pospay/db` beside `employee-branch-links.ts` and `employee-default-shifts-projection.ts`, unchanged. It already
  takes `from` and `to` (the monthly report passes its month's first and last day), so a period needs no new SQL. The API 27b query
  and the worker statement reader both call it; its result-shape and EXPLAIN tests keep running against the shared statement from the API 27b test files, which import it from `@pospay/db` (the precedent of `employeeDefaultShiftsStatement`), so their fixtures are not ported. It keeps leaving OPEN
  sessions out (AB-Q9g); the employee statement shows them from a separate small worker `queries/` read (spec 061
  FR-011a), so the shared statement and the monthly report stay unchanged.
- The 27b statement returns only its candidates (a session or contracted minutes), so it leaves out an employee whose
  only coverage at the branch is a scheduled shift. 27g reads that set through its own statement,
  `attendanceStatementScheduledEmployeesStatement` in `@pospay/db` beside the 27b one, added by sub-PR 27g-2, without
  changing the 27b statement. For a branch and a period it returns every employee of the business with a schedule shift
  there in the period, whether or not she is also a 27b candidate, in the 27b row shape: identity and `employee_number`, the branch time zone, her
  shifts (working date, start, end, break), her approved leave, and no sessions or contract (spec 061 FR-011b). It does not
  repeat the 27b candidate rule: rows are merged by employee id and the 27b row wins (`mergeAttendanceStatementRows`
  in `packages/domain`, issue #561). The worker reader and the API eligibility check both use it.

The worker `staff` module reads identity through a port it owns (`StatementIdentityReader`) whose adapter calls
`@pospay/db`, the same shape as the worker `files` `LogoReference` row in the module map. **No `staff → settings` import
arrow is added**; the module map gains a port row (`worker staff | StatementIdentityReader | @pospay/db`). Settings
still owns the table and the rule; the shared package is only where the one copy lives.

### 3. The logo is read and audited by worker `files` in its own step, called by the documents source

The logo read writes an access audit, so a call into it from `staff` would be a second synchronous cross-module write,
which the module map forbids (§3.1: one recorded exception). Instead no business module calls it: the documents source
(`apps/worker/src/documents/sources/attendance-statement.source.ts`, infrastructure wired by `apps/worker/src/main.ts`,
§4) calls the `staff` data reader first and the `files` logo reader second. Each runs its **own** `withTenant`
transaction, one after the other, never nested (PP-7.2). `staff` never imports `files` for this, and `files` never
imports `staff`.

Worker `files` exposes one function, `readStatementLogo(companyId, { businessId, fileId, requesterUserId, renderId },
signal)`: the handle that `startFilesWorker` (exported by `apps/worker/src/modules/files/index.ts`) returns carries it,
bound to the module's database, storage client and clock, and the index exports its type `StatementLogoReader`. When the
worker has no storage configured, it throws before any transaction, so nothing is written. The source passes the `logo_file_id` the `staff` reader returned
from the request row (§1, §5); when that is `null` the source does not call it and the statement prints the name only
(spec 052 BR-04) on every attempt, even if a logo is bound in between. The function has two phases:

1. **Its own transaction** (`withTenant(companyId, …, { userId: requesterUserId })`): it reads that file's
   `file_objects` row (READY, `owner_module = 'settings'`, owner = the business, `purge_started_at IS NULL`); if the
   file no longer qualifies it returns `null` (name only) and writes nothing. It never looks up the logo bound now.
   When the file qualifies, it inserts one access row (`file_access_audit.id = renderId`, `file_id`, `outcome =
   'ALLOW'`, `actor_user_id` = the requester) with `ON CONFLICT (company_id, id) DO NOTHING RETURNING id`, and only when
   the insert returned a row it appends the `file`/`access` audit-log entry, as the API files repository does for a
   download. It commits. A retry (spec 056 FR-006) passes the same `fileId`, so it embeds the same file and writes
   nothing new: every logo embedded in a PDF has exactly one access row for that render, naming that file. `render_id`
   is a fresh UUID v7, so it never collides with another access row. `pospay_app` holds `SELECT, INSERT` on
   `file_access_audit` (`packages/db/migrations/0042_2026-10-03_files-rls.sql`), which covers `RETURNING id`; an
   integration test runs a first attempt and a retry as `pospay_app`.
2. **After commit**, outside any transaction: it reads the object through `packages/storage` and re-encodes it with the
   same `sharp` setup as upload inspection to fit 512 × 512 px, PNG for a PNG and JPEG for a JPEG, at most 512 KiB. A
   10 MiB logo (spec 052 BR-10) would otherwise take most of the 4 MiB HTML cap as base64. A missing object returns
   `null` (name only); `packages/storage` reports it as `StorageObjectMissingError`, a subclass of `StorageError`, and
   the re-encoder is its `fitImage`, beside `inspectContent`. The access row written in phase 1 stays: the logo was
   looked up for her. A stored logo that cannot be re-encoded within the limits throws too. A storage error or a timeout of 5 seconds throws, so the job's attempt fails and BullMQ retries
   it once (spec 056 FR-006). It returns `{ content_type, bytes }` or `null`.

The write stays inside the module that owns `file_access_audit`, in that module's own transaction, so it is not a
cross-module write and needs no `sync_writes` row; the module map gains no port row and no `reads:` entry for the logo.
The requester needs no `files` or `settings` permission: the statement's permission (`read:attendance:branch`) was
checked when the request was made, and the stored permission of a settings file gates only the admin preview (ADR-0046
§5).

### 4. The template stays inside the documents boundary

`packages/documents` may be imported only by `apps/worker/src/main.ts` and `apps/worker/src/documents/` (module map,
ADR-0049 §5). So the worker `staff` module returns **typed data**, not HTML: its internal result
`AttendanceStatementData` (the statement data plus `businessId`, `requesterUserId` and `logoFileId`, which the source
needs only to call `readStatementLogo`). The source then builds the template input `attendanceStatementDocument` (Zod in
`packages/contracts`) from the statement data and the logo, `{ content_type, base64 }` or `null`, with no user id. The template lives in `packages/documents/src/templates/attendance-statement.ts`, and
`apps/worker/src/documents/sources/attendance-statement.source.ts` turns the data into HTML. `main.ts` builds that
source with the worker `staff` reader and the worker `files` `readStatementLogo` injected (so `sources/` imports no
module index) and registers it for the kind `attendance-statement`. A business module still never imports `packages/documents`.

### 5. The request record is a `staff` table

`attendance_statement_requests` (spec 061 §6.2), written by the API in the request transaction and read by the worker
reader by `(company_id, render_id)`. It is the "own request record" ADR-0049 §1.1 allows, with RLS, a negative isolation
test, `(company_id, id)` key (ADR-0007), and `SELECT, INSERT` only for `pospay_app`. It carries ids, dates, form,
language and the logo decision (`logo_file_id`, null for "no logo"); never a figure. `logo_file_id` has no foreign key
to `file_objects`: it records a decision, and the file's own lifecycle (retire, purge) must not be blocked by a
statement request; the files reader re-checks the file at render time (§3). The download audit (ST-Q5) is a separate `audit_log` entry written at collection (spec 061
§6.5), because "downloaded" means the file reached the requester (ADR-0049 §1.4).

## Consequences

- No new import arrow, no `sync_writes` row, and no new runtime role, grant beyond the new table, or RLS exception. The
  module map gains two port rows for the identity reads (worker `StatementIdentityReader`, API
  `StatementLogoReferenceReader`, both through `@pospay/db`); `packages/documents` keeps its two allowed importers.
- `settings/index.ts`'s public surface is unchanged; two of its exports become re-exports.
- The 27b report and the statement read the same SQL and compute with the same `packages/domain` functions, so a parity
  test can hold them equal.
- Every rendered statement with a logo leaves one `file_access_audit` row for its requester, even if she never collects
  the PDF. That is the honest record: the logo was read for her.
- A storage outage fails statements with a logo (one retry, then `FAILED`) instead of silently printing an "official"
  statement without the logo the owner uploaded.

## Alternatives rejected

- **An API `staff → settings` import (ADR-0046 §5 as first written):** the reads moved to the worker with ADR-0049; the
  API no longer needs them.
- **A worker `settings` module with a copy of the reader and the fallback:** two copies of a business rule in two apps.
- **Reading the data in the API and passing it to the worker:** the job would carry tenant data (ADR-0049 §1.2), or the
  data would need a second store.
- **Embedding the stored logo as is:** up to 10 MiB as base64 breaks the 4 MiB HTML cap.
- **Printing the name only when the logo cannot be fetched:** quietly produces a statement that differs from what the
  owner set up; a retry or a visible failure is better.
- **Reading the logo bytes inside the tenant transaction:** storage IO in a transaction (ADR-0046 §4).

## Addendum 2026-10-24 — the employee-app screen's logo read in the API (spec 069, M-1g)

- **Status:** Proposed with the spec 069 plan (docs PR); accepted with sub-PR 069-2, which builds it. EL-TQ1 answered
  by Waleed on 2026-10-24: (a).

**Context.** Spec 069's print sheet carries the salon logo (EL-Q4). The screen opens for a user who may add and edit
employees of the business (EL-Q3, Abu Salem's binding pick, 2026-10-24): `manage:employees:business`. The stored
permission of the logo file (`manage:business-identity:business`, ADR-0046 §5) cannot be the rule, because a manager
who adds employees need not edit the business identity; this is the same reasoning as the attendance statement's
requester, who needs no files or settings permission (§3 above). `readStatementLogo` cannot be reused: it lives in the
worker, embeds bytes in a PDF, and needs a render id.

**Decision.**

1. **API `files` owns the read**, as a use case beside `issue-download` (`use-cases/issue-business-logo-download/`),
   because `files` owns `file_access_audit` and `packages/storage`. Route:
   `POST /v1/businesses/{businessId}/employee-app-link/logo-download`, `@HttpCode(200)`, guarded by
   `@Require('manage:employees:business', { business: 'businessId' })` with the staff feature, exactly the guard of
   the screen's read (spec 069). The guard resolves the company from the validated `x-company-id` and refuses, with
   its single 403, a caller without the permission, a DENY, an unknown business and another company's business, so the
   use case starts only for a permitted caller on a business of that company. The audit id comes from the injected
   `IdGenerator`.
2. **Phase 1, one transaction** `withTenant(company, …, { userId })`, after the guard, in this order. The permission
   is checked twice, as `IssueDownload` does: by the route guard, and again by the use case after it has resolved the logo
   file and right before the audit,
   through the existing `FilePermissions` port (`allowed(actor, 'manage:employees:business', businessId, null)`),
   whose adapter calls the shared `RequestAuthorizer` that ADR-0022 exposes to `files`. That is not a `files → identity`
   arrow. A refusal there writes the `DENY` access audit on that file and answers the guard's same 403, as a download refusal does.
   Neither check locks the membership rows, so a revocation that commits between the second check and the commit
   still gets one audited URL that lives 60 seconds. That is the **accepted residual of every download in the
   project**, since ADR-0022 states that the audit measures URL issuance, and this route is no weaker than
   `IssueDownload`.
   - Read the bound `logo_file_id` through `@pospay/db` `readBusinessIdentity` (§2's shared read), through a port
     `BusinessLogoReference` whose adapter calls `@pospay/db`. There is no `files → settings` import, as with the
     worker `LogoReference` row.
   - Check the `file_objects` row as §3 phase 1 does: READY, `owner_module = 'settings'`, owner = the business,
     `purge_started_at IS NULL`.
   - Insert the `file_access_audit` row (`outcome = 'ALLOW'`, `actor_user_id` = the caller) and append the
     `file`/`access` `audit_log` entry.
   - Sign the GET URL with `packages/storage` `presignDownload`, still inside the transaction. Signing is local
     computation with no network call (ADR-0046 §4 holds), so a signing failure rolls both audit records back and an
     `ALLOW` is never recorded for a URL that was not issued. Commit. Both records and the URL stand together or not at all.
   - **No access** is the guard's 403 before the transaction, so it writes nothing; the screen shows its no-access
     state and does not print.
   - **Access but no logo** (none bound, or a bound file that no longer qualifies) answers 200 with
     `{ download_url: null }` and writes nothing; the sheet prints with the name only. Access and "no logo" are never the
     same answer.
   - A **signing or storage-configuration failure is not a miss**: it rolls the transaction back like any error, and
     answers the files module's existing `STORAGE_UNAVAILABLE` (503), or `STORAGE_NOT_CONFIGURED` when no storage is
     configured. The screen shows «اللوجو مش متاح دلوقتي، جرّبي تاني» with a retry for these, never the name-only sheet;
     only the API's `download_url: null` and storage's `NoSuchKey` print the name only.
3. **After the commit:** return the signed URL. No storage network call happens in the request; the browser reads the
   object itself. The URL lives 60 seconds, as `IssueDownload` does. `presignDownload` gains an optional response cache policy so the stored
   object answers `Cache-Control: private, no-store`. The API answer is `{ download_url, expires_in: 60 }` (or `{ download_url: null }` with
   no logo), also `no-store`. **Issuing the URL is the audited access:** every URL leaves one audit pair, and the 60-second life
   bounds its reuse, the accepted residual of every download in the project (ADR-0022).
4. **Missing object versus failure** (spec 069: a missing object prints the name only; a storage error offers a
   retry). The admin reads the object with `fetch` on the signed URL, and that needs the bucket's CORS to allow `GET`
   from the back-office origins. ADR-0022 documents `PUT` only. That was **EL-TQ1**, a server setting; Waleed picked (a) on 2026-10-24 and applies the rule himself (spec 069
   `plan.md`):
   - ⭐ (a) add `GET` from the back-office origins to the bucket's CORS. Then a 404 whose body carries the storage error code `NoSuchKey`
     means name only; a 404 with any other code (`NoSuchBucket` is an outage, as `packages/storage` already treats it,
     `s3.spec.ts`) or an unreadable body counts as a failure; 403 (an expired URL) means one new URL then the retry
     message; any other failure or a 10-second timeout means the retry message.
   - (b) keep CORS as is and load the logo with `<img>` only. A load failure cannot tell missing from error, so every
     failure shows the retry message, and a truly missing logo blocks printing until the logo is uploaded again. The
     message then says so. This changes spec 069's missing-object rule.

**Consequences.** One new route and use case in API `files`, one port row (`BusinessLogoReference` → `@pospay/db`) in
the module map, and an optional cache policy on `presignDownload`. No new import arrow, table, permission, grant or
role. Every sheet printed with a logo leaves an audit pair for the user who opened it.

**Alternatives rejected.**
- **Streaming the bytes through the API:** storage IO in a request (ADR-0046 §4), and up to 10 MiB held by an `api`
  worker.
- **The logo file's stored permission:** it would hide the logo from managers EL-Q3 lets open the screen.
- **A session-only route with its own membership lock** (the design while EL-Q3 followed Waleed's «anyone in the back
  office»): Abu Salem's pick makes the standard permission guard the rule, which needs no `files → identity` arrow and
  no lock of its own.
