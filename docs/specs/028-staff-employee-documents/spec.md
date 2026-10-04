# Feature Specification: Document types and record-employee-document

**Feature Branch**: `feat/p1-13-employee-documents`
**Created**: 2026-10-04
**Status**: Owner decision 2026-10-03 for access/files; DOC-Q1…Q7 settled 2026-10-04 (owner decision, recommended options)
**Sources**: Phase 1 SPEC §3 (files row), §4 (`EmployeeDocument`, `DocumentType`), §11 V4; PRD P1-T4.2;
implementation plan row 13; spec 014 + ADR-0022 (files); ADR-0025 (role bundles); ADR-0031 (this slice).

## User Scenarios & Testing

### User Story 1 — Keep each employee's papers current (Priority: P1)

A manager opens an employee, uploads a PDF/JPEG/PNG through the files flow, picks its document type and
expiry date, and records it. The employee page lists the current document of every type with a status
badge (valid, expiring, expired, no expiry), opens it through files, and replaces it with a newer one.

**Acceptance Scenarios**:

1. **DOC-01**: Upload uses `files`' own endpoints with `owner_module = staff`, `owner_entity_id` = the
   employee, the employee's business, no branch, and `required_permission = read:files:business`.
   Recording requires the object to be READY. Staff stores the verified object key only, never bytes.
2. **DOC-02**: `record-employee-document` accepts a **file id**, never a client object key. The file must be
   in the same company and business, owned by `staff`/this employee, carry `read:files:business`, be uploaded
   by the recording user, not purged, and not already recorded. Every mismatch, and an unknown, deleted,
   foreign or inaccessible employee, returns the same `NOT_FOUND`. A matching file that is not READY returns
   `FILE_NOT_READY`; an already recorded file returns `DOCUMENT_FILE_ALREADY_RECORDED`.
3. **DOC-03**: One current document per employee per type. Recording a new one marks the previous current
   one replaced (`replaced_at`; the forward link lives in the `EmployeeDocumentRecorded` payload `replaced_document_id` and the audit snapshot) in the same transaction; history rows stay forever and
   their files follow the files lifecycle (verified files are kept until deleted/replaced — owner decision
   2026-10-03; this slice deletes no file).
4. **DOC-04**: `expires_on` is a real Gregorian date; past dates are accepted and recorded as already
   expired. A type with `requires_expiry` refuses a missing date (`DOCUMENT_EXPIRY_REQUIRED`); a type
   without it accepts an optional date. Unknown or inactive types return `DOCUMENT_TYPE_UNAVAILABLE`.
5. **DOC-05**: Row, replacement, audit (`employee_document.record`, no object key) and outbox
   `EmployeeDocumentRecorded` (no object key) commit together. `Idempotency-Key` is mandatory; a retry
   replays the stored response, a changed body with the same key returns 422.
6. **DOC-06**: Status = `NO_EXPIRY` without a date; `EXPIRED` when `expires_on` < today; `EXPIRING` when
   `expires_on − today ≤ alert_days` of the type (0 days = the expiry day itself); otherwise `VALID`. Today
   is the injected clock's date in the **business timezone**. The query computes the same rule in SQL; a
   parity test checks both against one table of cases.

### User Story 2 — Manage the company's document types (Priority: P1)

**Acceptance Scenarios**:

1. **TYP-01**: Types are per company: `name_en` required (1–255, trimmed), `name_ar` optional (1–255),
   `alert_days` 0–365, `requires_expiry`, active/inactive, revision. Codes are immutable; seeded types use
   `civil_id`, `passport`, `residency`, `health_certificate`, `work_contract`; created types get
   `custom_<id hex>`.
2. **TYP-02**: Create (201), update (PATCH, `expected_revision`), deactivate and reactivate (POST,
   `expected_revision`), each with `Idempotency-Key`, audit `document_type.*`, revision +1. A stale
   revision returns `DOCUMENT_TYPE_REVISION_CONFLICT`. No type is ever hard-deleted; an inactive type
   cannot be chosen for new documents and its existing documents keep their status.
3. **TYP-03**: At most 100 types per company (`DOCUMENT_TYPE_LIMIT_REACHED`).
4. **TYP-04**: Every company gets the five recommended types, idempotently: existing companies through the
   migration, new companies through the worker's `CompanyCreated` consumer. Civil ID, Passport,
   Residency and Health certificate: alert 30 days, expiry required; Work contract: alert 30, expiry optional.

### Edge Cases

- Two concurrent records for one employee/type serialize on the employee lock; the second replaces the
  first. Two records of one file: one wins, the other gets `DOCUMENT_FILE_ALREADY_RECORDED`.
- Permission revoked while a write waits: company and ordered membership locks, then a live recheck.
- A type edited after recording changes the badge (status always uses the type's current `alert_days`).
- Deleted employees: documents stay; reads and writes return `NOT_FOUND` like every staff route.

## Requirements

### Access (owner decision 2026-10-03, PR 7a grants)

| Action | Permission | Default roles |
|---|---|---|
| List an employee's documents, open them through files | `read:files:business` at the employee's business | owner, general_manager, business_manager (own business) |
| Upload and record | `read:files:business` **and** `manage:files:business` at the employee's business | same |
| List/create/update/deactivate types | `manage:document-types:company` (new) | owner, general_manager ✅; business_manager ⚙️ personal ALLOW; Device ❌ |

Feature `staff` must be enabled (checked after access). Documents are business-level files, so access is
evaluated at the business exactly as `files` evaluates the stored permission.

### API

- `GET /v1/document-types` → `DocumentTypeList` (all types, active first, bounded by TYP-03).
- `POST /v1/document-types` (201) `CreateDocumentTypeInput` → `DocumentType`.
- `PATCH /v1/document-types/{typeId}` `UpdateDocumentTypeInput` → `DocumentType`.
- `POST /v1/document-types/{typeId}/deactivate` and `/reactivate` `DocumentTypeRevisionInput` → `DocumentType`.
- `GET /v1/businesses/{businessId}/employees/{employeeId}/documents` → `EmployeeDocumentsView`
  (`today`, current documents with type names and status, active types, `can_manage`).
- `POST /v1/businesses/{businessId}/employees/{employeeId}/documents` (200) `RecordEmployeeDocumentInput`
  (`type_code`, `file_id`, `expires_on | null`) → `EmployeeDocument`.

### Schema

- `document_types`: PK `(company_id,id)`, unique `(company_id,code)`, names, `alert_days` CHECK 0–365,
  `requires_expiry`, `active`, `revision > 0`, `created_at`. Index `(company_id, active, name_en)`.
- `employee_documents`: PK `(company_id,id)`, FK `(company_id,business_id,employee_id)` → employees,
  FK `(company_id,type_code)` → document_types code, `object_key` unique per company, `expires_on` date,
  `uploaded_by` → user, `recorded_at`, `replaced_at`. Partial unique current
  `(company_id,employee_id,type_code) WHERE replaced_at IS NULL`; `(company_id, expires_on) WHERE current`
  for PR 15; business and uploader indexes.
- FORCE RLS on both; `pospay_app` SELECT/INSERT, column UPDATE only (types: names, alert days,
  requires_expiry, active, revision; documents: replaced_at). No DELETE.

### Events

`EmployeeDocumentRecorded` — `document_id`, `employee_id`, `business_id`, `type_code`, `expires_on`,
`replaced_document_id`, `recorded_at`. Known to the dispatcher; no consumer in Phase 1 (PR 15 reads
`expires_on` + `alert_days` directly).

### Admin

- `/staff/document-types` (linked from the employees header): table of types with state badges, add/edit form,
  deactivate/reactivate; 403 shows a bilingual "not available" state.
- Employee panel → documents section, shown only after a fresh successful read; cache evicted on close and on
  403/404. Upload = request upload → PUT to the signed URL → confirm → poll status until READY → record with a
  new Idempotency-Key. Open uses `POST /v1/files/download` with the stored key. Replace preselects the type.

## Tests

Domain: type terms, revision, limit, record validation, replacement, status table, business-day boundary.
Integration: record/replace/history, idempotent replay and reuse, every NOT_FOUND oracle case, FILE_NOT_READY,
already recorded, inactive type, expiry required, concurrent record, rollback leaves nothing; type CRUD,
revision conflict, BM personal ALLOW, Device refused. RLS negative tests and grants for both tables. Query
shape + EXPLAIN + SQL/domain status parity. Worker seed consumer idempotent. Admin hooks/forms ar/en.

## Owner decisions 2026-10-04 (recommended options, DOC-Q1–Q7)

- **DOC-Q1** Types per company, editable, seeded with five types (TYP-01/04). Recommended: as implemented.
- **DOC-Q2** Type management: owner/GM by default, BM by personal ALLOW of the company code, Device never.
  A BM's ALLOW lets them edit the company-wide list. Recommended: as implemented.
- **DOC-Q3** One current document per type; replacement keeps history; past expiry accepted. History is kept
  but not yet listed in the admin. Recommended: as implemented; a history view in a later slice.
- **DOC-Q4** Only the uploader can record their own upload. Recommended: keep (prevents binding a file
  someone else prepared for another purpose).
- **DOC-Q5** `alert_days` 0 means the expiry day itself shows EXPIRING. Recommended: keep.
- **DOC-Q6** Cap of 100 types per company. Recommended: keep.
- **DOC-Q7** New companies are seeded by the worker's `CompanyCreated` consumer; a company created while
  an older worker is still running during a deploy may miss the seed and the manager adds types by hand.
  Recommended: accept for Phase 1.

No npm dependency added.
