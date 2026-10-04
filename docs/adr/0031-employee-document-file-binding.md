# ADR-0031 — Employee documents bind verified files; staff reads files

Date: 2026-10-04. Status: Accepted technical scope for Phase 1 PR 13; DOC-Q1…Q7 settled 2026-10-04 (owner decision, recommended options; spec 028).

## Context

SPEC §3 says documents are uploaded and opened through `files`' own endpoints and `staff` stores the
object key only. Owner decision 2026-10-03 (ADR-0022) gives owner, general manager and business manager
(own business) upload/read of employee documents and keeps verified files until deleted or replaced.
`record-employee-document` must never accept a key the caller did not upload: a client-supplied key would
let a manager attach any other company object they can name. Staff therefore has to look at the file.

## Decision

The client sends a **file id**. Inside the same `withTenant` transaction, after the company, ordered
membership and employee locks and a live recheck of `read:files:business` + `manage:files:business` at the
employee's business, staff reads the file through a new `files` export, `documentFileFacts`, under RLS.
The file must be READY, not purged, owned by `staff` and this employee, in the employee's business with no
branch, stored with `read:files:business`, created by the recorder and not yet recorded. Every mismatch is
`NOT_FOUND`, identical to an unknown employee. Staff persists only the verified key.

This adds the import arrow `staff → files` (files imports only tenancy, so no cycle) and three read
symbols beside it: identity `lockDocumentAccess`/`readDocumentAccess` and tenancy `businessTimeZone` for
the expiry badge. No write crosses modules. Audit rows and `EmployeeDocumentRecorded` carry no object key.

Document types are company rows managed with the new `manage:document-types:company` (owner and general
manager by default, business manager by personal ALLOW, Device never). Existing companies are seeded by the
migration; new companies by a worker consumer of `CompanyCreated` (event arrow identity ⇒ staff) that
inserts the same five types idempotently on `(company_id, code)`.

## Consequences

Extracting `staff` later needs a files read API for this one check. A company created while an older worker
still runs during a deploy can miss the seed; the manager adds types by hand (DOC-Q7). Expiry status uses
the type's current `alert_days`, computed by `documentStatus` and, on the read path, by the same rule in SQL
(parity test). PR 15 reads `expires_on` and `alert_days` from the current-document index. No dependency,
no new runtime role, no RLS exception.

Known limit: the binding has no purpose discriminator. Today the staff module has exactly one upload kind (employee documents), so any staff file owned by the employee is a document upload. When a second staff upload kind for employees appears (for example a photo), add a `purpose` (or a distinct owner module) to the file and check it here, so a file uploaded for another purpose cannot be recorded as a document.
