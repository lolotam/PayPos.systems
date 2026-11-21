# Feature Specification: 61-2a staff rating summary API + 62-2e employee document number

**Feature folder**: `docs/specs/060-ratings-and-staff-app/61-2a-62-2e/` (a scoped part of spec 060, not a new numbered spec)
**Created**: 2026-11-21
**Status**: Draft — plan only (PP-204). No production code, test, migration or tracked document is changed by this file.
**Source pin**: `origin/main` = `cf70114e2cbe9efcb2b5dc4d327f2c82f87d54b3`. Every "today" statement below was read from that commit.
**Input**: one approved delivery, one PR, two roadmap rows:

- **61-2a** — staff own rating-summary API (spec 060 FR-A05, FR-B14, D-B12, RT-24, S-9, S-11; `plan-61.md` §6).
- **62-2e** — optional employee document number in the document form, and its permission-gated display in the
  in-app document-expiry bell (spec 060 AL-Q8, AL-Q8c, sub-PR row 62-2e).

The two rows share no code. They ship together only because the owner asked for one spec, one plan and one PR.
Each row has its own acceptance criteria and can be verified without the other.

**Words used below.** *Today* = behaviour verified in the source at the pin. *This PR* = behaviour this delivery adds.
*Later* = a named future row, out of scope here.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — An employee's own rating average is available to her app (61-2a, Priority: P1)

سارة works in a salon. Customers rate their visit. The staff app needs one number for her «شغلي» screen: her
average this month and how many ratings it comes from. This PR builds the server read only. No screen shows it yet.

**Why this priority**: 61-3 (the card on «شغلي») cannot start without this read.

**Independent Test**: call the route as an employee with ratings; the answer is hidden while the column is switched
off, and shows the average and the count when a test allows the column.

**Acceptance Scenarios**:

1. **Given** the `rating_average` staff column is not allowed (always the case until 61-3), **When** سارة asks for her
   summary, **Then** the answer says only «hidden»: no average, no count, nothing that tells whether ratings exist.
2. **Given** the column is allowed (injected by the test) and سارة has ratings of 4 and 5 stars this month, **When**
   she asks, **Then** she gets average `"4.5"` and count `2`.
3. **Given** the column is allowed and she has no rating this month, **When** she asks, **Then** she gets average
   `null` and count `0` (the client shows «لسه مفيش تقييمات»; one rating is enough to show an average, PP-18.15).
4. **Given** ratings from last month and from another employee exist, **When** she asks, **Then** neither is counted.
5. **Given** her `read:ratings:own` is denied, her employment ended, or the `customers` feature is off, **When** she
   asks, **Then** she is refused and learns nothing, not even whether the column is hidden.
6. **Given** a request that names an employee, branch, business or company, **When** it arrives, **Then** it is
   refused: the employee always comes from the session.

### User Story 2 — A manager records a document's number when uploading it (62-2e, Priority: P1)

A manager uploads سارة's residency permit. The form has a new optional field «رقم المستند». She may leave it empty.

**Why this priority**: the owners chose the detailed bell text that includes the document number (AL-Q8), and no
number is stored today.

**Independent Test**: upload one document with a number and one without; the documents list shows the number for
the first and none for the second.

**Acceptance Scenarios**:

1. **Given** a manager who may upload documents, **When** she types `  A1234567  ` and uploads, **Then** the document
   is saved with `A1234567` and the list shows it.
2. **Given** she leaves the field empty or types only spaces in the form, **When** she uploads, **Then** the document
   is saved with no number, exactly as today.
3. **Given** a number longer than 64 characters, **When** she submits, **Then** the form refuses it and nothing is saved.
4. **Given** a document with a number is replaced by a new upload with the field empty, **When** the upload succeeds,
   **Then** the new current document has no number; the replaced document keeps its own number in history.
5. **Given** documents uploaded before this PR, **When** the list opens, **Then** they show no number and keep working.

### User Story 3 — The expiry bell shows the number only to people allowed to read documents (62-2e, Priority: P1)

The bell «مستند … ينتهي يوم …» already exists (62-2d). This PR adds the document number to the bell text, read at
display time, and only for a viewer who can read that business's files right now.

**Why this priority**: it is the visible half of AL-Q8.

**Independent Test**: open the bell as a files reader and as a user whose permission was removed; the first sees the
number, the second sees today's text.

**Acceptance Scenarios**:

1. **Given** a document with a number and a viewer holding `read:files:business` on that business, **When** she
   opens the bell, **Then** the bell shows type, exact expiry date and the number.
2. **Given** the same bell and a viewer whose permission was removed after the bell was sent, **When** she opens the
   bell, **Then** she sees today's text without the number.
3. **Given** a bell for a document that has no number, was replaced, belongs to a deleted employee, or cannot be read
   for any reason, **When** the bell opens, **Then** it shows today's text. No error is shown.
4. **Given** bells created before this PR, **When** they open, **Then** they behave by the same rules (they already
   carry the document id).

### Edge Cases

- A rating submitted at 23:59:59 on the last day of the month in the business timezone belongs to that month; one
  submitted at 00:00:00 the next day does not (RT-Q6a, D-A9).
- An average that falls exactly between two tenths rounds up: 4.25 → `"4.3"` (D-B12, half up).
- A request for document numbers that mixes ids from another business or another company: those ids are silently
  absent from the answer, exactly like ids that have no number.
- A viewer with no file-read permission gets the same refusal whatever ids she sends, so the answer never tells her
  whether a document exists.
- The number field contains a control character: refused.

## Requirements *(mandatory)*

### Functional Requirements — 61-2a

- **FR-R01** The system MUST expose `GET /v1/staff/me/rating-summary` returning either `{ visibility: 'HIDDEN' }` or
  `{ visibility: 'VISIBLE', average, count }` (`plan-61.md` T5).
- **FR-R02** `average` MUST be a string with exactly one decimal (`"1.0"` … `"5.0"`), rounded half up in the database,
  or `null` when `count` is `0`; `count` is a non-negative integer. No float crosses the wire (`plan-61.md` T6).
- **FR-R03** The window MUST be the current calendar month of the business timezone, applied to
  `rating_attributions.submitted_at` (D-B12, RT-Q6a, `plan-61.md` T10).
- **FR-R04** The employee MUST be resolved on the server from the session; the caller cannot name a subject (FR-A06).
- **FR-R05** The route MUST accept the personal staff session only, and MUST re-check, inside its one read
  transaction: the workspace, the caller's own eligible employee, membership, the `customers` feature and
  `read:ratings:own`. A failure inside that transaction returns 403 `FORBIDDEN`. The existing personal-session
  guard returns 401 first when the personal session or pre-controller eligibility fails.
- **FR-R06** After authority passes, when `rating_average` is not an allowed staff column the answer MUST be `HIDDEN`
  and no rating row is read. The column gate itself is not changed by this PR; it stays off until 61-3.
- **FR-R07** The response MUST never carry a comment, a customer, a star list, a rating id or another employee's
  number (S-9, S-11), and MUST be sent `Cache-Control: no-store`.

### Functional Requirements — 62-2e

- **FR-D01** A document MAY have a number: text, trimmed, 1 to 64 Unicode code points (AL-Q8c). Reject raw C0/C1 controls before trimming.
- **FR-D02** The record request accepts `document_number` omitted, `null`, or a valid string. Omitted and `null` both
  mean «no number». An empty or whitespace-only string sent to the API is refused as invalid; the admin form turns
  an empty field into `null` before sending.
- **FR-D03** Existing documents are not changed and get no number (expand-only, no backfill).
- **FR-D04** A replacement never copies the number from the document it replaces.
- **FR-D05** The number MUST be returned only by reads that check `read:files:business` for the document's business
  in the caller's company inside the same transaction: the employee documents list, and the new number lookup used
  by the bell.
- **FR-D06** The number MUST NOT appear in: any event or outbox payload, any notification `safe_parameters` or other
  stored notification data, any log line, any audit `before`/`after` value, the stored idempotency response, or a
  validation error body.
- **FR-D07** The bell text shows the number only when the lookup returned one for that document. In every other case
  (no permission, permission removed, replaced or missing document, deleted employee, no number, lookup failed or
  still loading, bell without a business) the bell shows today's text.
- **FR-D08** The lookup MUST give one shape for «absent»: an id the caller may not see is simply not in the answer.
  A caller without file-read permission on that business gets the same refusal whatever ids are sent.
- **FR-D09** The admin MUST NOT keep fetched numbers after the bell panel closes or the user, company, business or visible id set changes. Cancel obsolete requests
  and ignore late results. Refetching or denied access shows the existing bell text, even after a successful read.

### Key Entities

- **Rating attribution** (exists today): one row per rating and performer, with stars and the submission instant.
- **Employee document** (exists today): gains one optional attribute, the document number.
- **Document-expiry bell** (exists today): unchanged in storage; it already carries the document id.

## Slice design *(mandatory — `CLAUDE.md` §1)*

### Business rules

- **BR-R1** Average = mean of the stars of the caller's own attributions in the current business-timezone month,
  rounded half up to one decimal. Example: 5, 4, 4, 4 → 4.25 → `"4.3"`. Source: D-B12, RT-Q6a (Abu Salem, binding).
- **BR-R2** Shown from the first rating; zero ratings → `null` / `0`. Source: PP-18.15.
- **BR-D1** The number is optional and legacy documents keep working without it. Source: AL-Q8c (Waleed and Abu Salem,
  2026-10-23, final).
- **BR-D2** Only current holders of `read:files:business` see the number. Source: AL-Q8 record
  (`owner-questions.ar.md` §28), spec 060 rows 62-2d and 62-2e, S-18.
- **BR-D3** [NEEDS CLARIFICATION — **DN-Q1**, non-blocking] May a manager add or change the number of an existing
  document **without uploading a new file**? Today there is no document edit route at all (only record/replace), and
  the database lets the application write a document row once. This PR ships the number on record/replace only; an
  in-place edit is not built. See `pending-deltas.md` §1 for the question as recorded for the manager.

### Schema changes

| Table | Columns added / changed | RLS policy | Indexes | Tenant-qualified FKs |
|---|---|---|---|---|
| `employee_documents` | `document_number text NULL` + CHECK `employee_documents_document_number` (NULL, or 1–64 code points, equal to its `btrim`, no control characters) | unchanged (table policies of 0074 already cover every column) | none added | unchanged |
| `rating_attributions` | none | unchanged | none added; the read uses the existing `rating_attributions_employee_idx (company_id, employee_id, submitted_at)` | unchanged |

Grants are unchanged: `pospay_app` holds table-level `SELECT, INSERT` and `UPDATE(replaced_at)` only (migration 0074,
`packages/db/test/document-grants.ts`), so a stored number cannot be updated by the application. Details:
`data-model.md`.

### API contract

Full shapes: `contracts/api.md`.

- **`GET /v1/staff/me/rating-summary`** (customers, `queries/`) · `@Authenticated()` + `PERSONAL_ROUTE = true`: the
  ADR-0027 personal staff session only, as the `GET` in `my-schedule.controller.ts` does today. The reception-device
  operator session is not accepted in this PR (gate G-5 in `plan.md` §2 hands that choice to 61-3) · permission
  `read:ratings:own` checked in the read transaction · feature `customers` · not a write, no `Idempotency-Key`.
  Errors: `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `VALIDATION_FAILED`, `NOT_READY`.
- **`POST /v1/businesses/:businessId/employees/:employeeId/documents`** (exists) · request gains optional
  `document_number` · response unchanged (no number) · `Idempotency-Key` as today.
- **`GET /v1/businesses/:businessId/employees/:employeeId/documents`** (exists) · each item gains
  `document_number: string | null`.
- **`GET /v1/businesses/:businessId/employee-document-numbers?ids=`** (new, staff, `queries/`) · `@Authenticated()` +
  `SelectedCompanyGuard`; checks `read:files:business` at that business and feature `staff` in its own transaction
  through the existing `EmployeeDocumentReadAccess` · not a write. Errors: `NOT_FOUND` 404 (no read permission, same
  as the list), `FEATURE_DISABLED`, `VALIDATION_FAILED`, `NOT_READY`.

### Permissions

- `read:ratings:own` — exists (migration 0210; every human role by default; devices never). No change.
- `read:files:business`, `manage:files:business` — exist. No change. No new permission, no role-default change.

### Events

- **Published**: none added. `EmployeeDocumentRecorded` and `DocumentExpiring` keep their payloads; the number is not
  added to either.
- **Consumed**: none.

### Test plan

- **Domain unit**: none new for 61-2a (the read has no `domain/` code; rounding is asserted at the query). 62-2e: the
  pure «omitted or null means no number» rule.
- **Integration scenarios**: `RS-01…RS-12` (rating summary) and `DN-01…DN-22` (document number) — listed with their
  files in `plan.md` §6.
- **RLS negative**: `employee_documents` — extend the existing cross-tenant test to read `document_number` (0 rows);
  `rating_attributions` — the summary of a user in company A never counts company B's rows.
- **Queries**: result shape + `EXPLAIN ANALYZE` for `own-rating-summary.query.ts` (index
  `rating_attributions_employee_idx`) and for `employee-document-numbers.query.ts` (index `employee_documents_pkey`).
- **UI**: every admin test asserts visible text (the field, the number in the row, the bell text with and without a
  number), never only a mock call (`CLAUDE.md` §9).

## Success Criteria *(mandatory)*

- **SC-1** With the column off, no caller can tell from the summary answer whether an employee has ratings.
- **SC-2** With the column allowed in a test, the average and count match a hand calculation for every listed case,
  including both month boundaries and the half-up case.
- **SC-3** A manager can save a document with or without a number in one upload, with no extra step.
- **SC-4** A user without current file-read permission never receives a document number from any route, in any case
  listed in FR-D07 and FR-D08.
- **SC-5** A search of every stored event, outbox row, notification row, audit row and idempotency row written during
  the tests finds no occurrence of the synthetic document numbers used.
- **SC-6** Documents and bells created before this PR behave exactly as they did.

## Assumptions

- The number field starts empty on upload and on replace. It is not pre-filled from the replaced document (FR-D04).
- Bell wording with a number is a non-business default: today's sentence followed by «— رقم المستند {{…}}» /
  `· document no. {{…}}`. AL-Q8 fixed what the bell contains, not the punctuation.
- The lookup accepts at most 20 ids per call, the page size the admin bell requests today
  (`apps/admin/src/notifications/api/use-notifications.ts`, `limit: 20`).
- The number is stored as plain text protected by tenant RLS and the file-read permission, like the employee IBAN
  (`packages/db/schema/staff-ibans.ts`). `CLAUDE.md` §8 requires envelope encryption for third-party credentials
  only; no owner decision asks for more here.
- The response field is named `visibility`, as `plan-61.md` T5 fixed it. The own-tips route names its field `status`;
  the difference is known and kept.

## Out of scope (named future rows)

- **61-3**: lifting the `rating_average` column gate, the «شغلي» card, any POS change, and whether the card also
  opens on the shared reception device behind the private-view window (D-A13).
- **61-1c…61-1i**: the low-rating notice, the `LOW_RATING` kind, `read:ratings:branch`.
- **61-2b, 61-2c, 61-2d**: admin ratings list, averages and screen.
- In-place edit of a stored document number (DN-Q1), showing replaced documents' history, any email/WhatsApp/push
  text carrying the number, any new template revision.
- Deploy, staging migration, production data: not authorized by this document.
