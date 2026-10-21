# Spec 061 — The official attendance statement PDF (Phase 1 row 27g)

> **Status:** Draft · 2026-10-21 · docs-only PR (sub-PR 0 of §9). **No code starts before this spec and
> [ADR-0051](../../adr/0051-attendance-statement-reads-and-logo-reader.md) are merged.**
> **Owner answers:** ST-Q1…ST-Q5 (batch 14) were answered on 2026-10-12 by Waleed and Abu Salem with the same pick, plus
> three clarifications by Waleed; they are recorded in
> [spec 051's owner-questions](../051-staff-employee-number/owner-questions.ar.md) §5–§9 and cited in §3, not asked again.
> **ST-Q6** (how a shift is identified for the shift filter) was answered by Waleed on 2026-10-21 (PP-15.4, through his
> super agent) with the recommended option: a shift is a start–end pair from the schedule (BR-11). Recorded in
> [owner-questions.ar.md](owner-questions.ar.md). No question is open and no sub-PR waits on an owner answer.
> **Depends on (all merged):** row 27 ([spec 049](../049-staff-attendance-board-report/spec.md), 27b report and its audit),
> row 8c ([spec 051](../051-staff-employee-number/spec.md), `employee_number`), row 27h
> ([spec 052](../052-settings-business-identity/spec.md), official names and logo, 27h-1…27h-5), row 27i
> ([spec 056](../056-documents-pdf-renderer/spec.md), [ADR-0049](../../adr/0049-pdf-renderer-in-phase-1.md), PR #413).
> **Requested by:** Abu Salem's pick on AB-Q10 ([spec 049 owner-questions](../049-staff-attendance-board-report/owner-questions.ar.md)),
> Waleed agreed on 2026-10-12.

## 1. What and why

A manager downloads an **official attendance statement** as a PDF, for a calendar month or any date range, in Arabic or
English. It carries the business logo and official name at the top, signature places, and the footer «صادر من نظام
PosPay للحضور والانصراف» with the issue date and time, so it can be handed to an employee or an authority as a document
that came out of the attendance system. Every download is written to the audit log.

It comes in two forms (ST-Q2 + ST-Q3, §3):

- **Branch statement:** one table for the whole branch, one row per employee with her totals for the period, a signature
  column in front of each row, and the manager's signature under the table.
- **Employee statement:** one employee at one branch, day by day, with her totals, her signature and the manager's.

**Worked example.** Salon «صالون الأميرة», branch السالمية (`Asia/Kuwait`), employees سارة (number 1), هبة (2), ريم (3).
The branch manager asks on 2026-11-02 for the branch statement of October 2026 in Arabic. The PDF shows the logo and
«صالون الأميرة» at the top, «فرع السالمية», «من 1/10/2026 إلى 31/10/2026», then three rows (number, name, days present,
worked hours, contracted hours, difference, leave, late, missing clock-out, manual days, signature), the manager's
signature line, and the footer «صادر من نظام PosPay للحضور والانصراف — 2/11/2026 10:14». On 14 October هبة has a missed
clock-out that nobody corrected: that day adds 0 worked hours and the row shows 1 missing clock-out; the employee statement
of هبة shows that date with the note «ناقص بصمة خروج». After the manager corrects the clock-out (rows 26/26a), a new
statement counts it.

## 2. Scope

| In this spec (row 27g) | Not here |
|---|---|
| The two forms, their data and their ar/en template on the 056 base layout | Excel export (Phase 5), storing a copy of any PDF (needs a `files`-owned handoff and its own ADR, plan row 27i) |
| The request, status and collect endpoints in `staff`, their contracts, the request record table | A schedule of statements or sending them by message |
| The `attendance-statement` document source and its data reader in the worker | The employee's own statement in her app (row 57b) |
| The download audit (ST-Q5) | Payroll, deductions, public holidays (spec 049 §7) |
| The `files`-owned logo bytes reader and its access audit (ADR-0049 §6, ADR-0051) | A page number on every page (needs a renderer option; §10) |
| The admin download screen, with the shift picker (BR-11) | Named shifts (ST-Q6 option ج, not chosen) |

## 3. Owner rules (final, cited — not asked again)

From [spec 051 owner-questions](../051-staff-employee-number/owner-questions.ar.md) §5–§9 (batch 14, Waleed and Abu Salem,
2026-10-12, same pick on every question):

- **BR-01 (ST-Q1):** the header carries the business logo and official name from the business settings; with no logo
  the header shows the name only. Implemented by spec 052 (BR-01…BR-05, BR-11) and its `statementIdentity` fallback.
- **BR-02 (ST-Q2 + ST-Q3 and the coordinator's note there):** two forms with the same header and footer: the branch
  statement (one table, a row per employee with her totals for the period) and the employee statement (her table day by
  day).
- **BR-03 (ST-Q2, Abu Salem's comment + Waleed's clarification «مفيش فلتر بالساعة… فلتر بالشيفت»):** the branch statement
  can be filtered by one employee, by a date or period, or by a shift. There is no filter by hour. What a shift is:
  BR-11 (ST-Q6).
- **BR-04 (ST-Q2, Waleed's clarification «التوقيع»):** both forms have signature places: in the branch statement a
  «التوقيع» column in front of each employee's row and the manager's signature under the table; in the employee
  statement the employee's and the manager's signature under the table.
- **BR-05 (ST-Q2, Waleed's clarification «البصمة الناقصة»):** a day with a missing clock-out adds no worked hours until a
  manager corrects it through the existing manual-correction flow (rows 26/26a), and it shows the note «ناقص بصمة خروج».
  This is the same rule as spec 049 AB-Q6.
- **BR-06 (ST-Q2):** the footer reads «صادر من نظام PosPay للحضور والانصراف» (English: "Issued by the PosPay attendance
  system") with the issue date and time.
- **BR-07 (ST-Q4):** the language, Arabic or English, is chosen at download; the header name follows it (spec 052 BR-05).
- **BR-08 (ST-Q5):** whoever may see the monthly report may download the statement: the permission
  `read:attendance:branch` (spec 049 AB-Q2), with its branch scope.
- **BR-09 (ST-Q5):** every download is written to the audit log with who, when, which form, the branch, the employee
  when one, the period, the shift filter when one, and the language.
- **BR-10 (plan row 27g):** a month or any date range.
- **BR-11 (ST-Q6, Waleed 2026-10-21, PP-15.4, through his super agent: «وقت بداية ونهاية (Recommended)»):** a shift is
  a **start–end pair** of the branch schedule (for example 09:00–20:00). The filtered branch statement counts **only the
  days** on which the employee's scheduled shift at the branch had that pair: days present, worked hours, lateness,
  missing clock-out, manual days and scheduled hours. The contracted hours and the difference print «—» in a filtered
  statement, because they are not tied to a shift. An employee with no day on that pair in the period has no row.

Carried from earlier decisions (no new rule): the column rules of the 27b report (spec 049 §5: AB-Q3…AB-Q9c, AB-Q11,
AB-Q12, BW-Q8, ACR-Q18, ACR-Q20, D-32, DH-Q4); `employee_number` on every employee (spec 051, EN-Q1…EN-Q14); a voided
session never appears (ACR-Q20); no phone, salary or IBAN on any export (AB-Q9e); hours shown as h:mm (AB-Q9d).

## 4. User scenarios and acceptance criteria

### Story 1 — A manager downloads the branch statement (P1)

1. **Given** a branch manager with `read:attendance:branch` on السالمية, **when** she requests the branch statement for
   October 2026 in Arabic, **then** the API answers `202 { render_id }` without waiting for the PDF.
2. **When** she polls the status, **then** it moves `QUEUED → RENDERING → READY` (ADR-0049 §1.4).
3. **When** she collects it, **then** she receives `application/pdf` with `Content-Disposition: attachment`, and the
   audit log has one entry for that download (BR-09).
4. The PDF has `dir="rtl" lang="ar"`, the logo and the Arabic official name, «فرع السالمية», the period, one row per
   employee with any counted session or contracted minutes at the branch in the period, a signature column, the
   manager's signature line and the footer (BR-01, BR-02, BR-04, BR-06).
5. Each row's figures equal the 27b monthly report row of the same employee, branch and month (parity test).
6. **Given** سارة always on 09:00–20:00, هبة always on 08:00–16:00 and ريم on 09:00–20:00 on some days and 08:00–16:00 on
   others, **when** the manager filters October by the shift 09:00–20:00, **then** the table has سارة with all her days
   and ريم with her 09:00–20:00 days only; هبة has no row; contracted hours and difference print «—» (BR-11).

### Story 2 — The employee statement (P1)

1. **Given** the same manager, **when** she requests هبة's statement for 1–15 October in English, **then** the PDF has
   `dir="ltr" lang="en"`, the English official name, هبة's name and employee number, and one block per date of the
   period in date order.
2. A date with sessions lists each counted session (clock-in, clock-out, lateness, source note «يدوي» / "Manual" for a
   MANUAL session) and the day's worked hours; a date with an uncorrected missed clock-out shows «ناقص بصمة خروج» /
   "Missing clock-out" and adds 0 hours (BR-05); a date with approved leave shows the leave type; a date with a
   scheduled shift and no counted session shows the scheduled times and «لا يوجد حضور مسجّل» / "No attendance
   recorded"; any other date shows the date only.
3. The totals under the table are the 27b columns for that employee and period, then her signature line and the
   manager's (BR-04).

### Story 3 — Refusals (P1)

1. A user without `read:attendance:branch` on the branch gets `403` on request, status and collect.
2. Another user, another company, an unknown `render_id` and an id requested for another branch all get the same `404`
   on status and collect (ADR-0049 §1.5).
3. An employee who has no session and no contracted minutes at the branch in the period, or who belongs to another
   business or company: `404 ATTENDANCE_STATEMENT_EMPLOYEE_NOT_FOUND`.
   A route whose branch belongs to another business of the same company: `404 ATTENDANCE_STATEMENT_BRANCH_NOT_FOUND`,
   no request row, no job (FR-003).
4. `from > to`, a period longer than 366 days, or `to` after the last day of the current month in the branch time
   zone (so the current month can be asked for on any day; its future dates show the date only, Story 2.2):
   `422 ATTENDANCE_STATEMENT_PERIOD_INVALID`.
5. The renderer is down (no `documents:renderer-alive` key): `503 RENDERER_UNAVAILABLE`, no request row, no job.
6. More than 20 requests by the same user in a rolling hour: `429 ATTENDANCE_STATEMENT_RATE_LIMITED`.
7. The staff feature is disabled for the business: the same refusal as the monthly report (`@RequiresFeature('staff')`).

### Story 4 — Collect once (P1)

1. A second collect of the same `render_id` gets `410 DOCUMENT_EXPIRED` and writes no audit entry.
2. A collect after the 120-second byte TTL gets `410 DOCUMENT_EXPIRED`; the status reads `EXPIRED`.
3. A collect before `READY` gets `409 DOCUMENT_NOT_READY`.
4. A collect whose audit write fails delivers no file (§6.4).

### Story 5 — Logo and identity (P2)

1. A business with no logo: the header has the name only (BR-01); no `file_access_audit` row is written.
2. A business with a logo: exactly one `file_access_audit` row (`outcome = 'ALLOW'`, actor = the requester, `id =
   render_id`) and one `file`/`access` audit entry per render, even when the job's attempt is retried; a retry embeds
   the file that row names, never a logo bound after it (ADR-0051 §3).
3. A logo replaced or purged between the request and the render: the statement uses the logo bound at the render's
   first attempt (the one its access row names, also on a retry), or the name only if none was bound or that file is
   gone.
4. With no official names written, the header follows spec 052 BR-11 (the display name).

### Edge cases

- An employee linked to two branches appears in each branch's statement with that branch's sessions only (AB-Q7).
- An employee soft-deleted inside the period is charged contracted minutes only up to the deletion date (AB-Q12) and
  still appears.
- An OPEN session is not counted until it closes (AB-Q9g); the employee statement shows it as «لسه جوّه» / "Still clocked
  in" on its date and adds 0 hours.
- An overnight session belongs to its clock-in date (AB-Q9b).
- A period that starts before the employee's hire date or ends after her contract end counts only the covered days
  (the 27b contract rules).
- The PDF exceeds 8 MiB: the status ends `FAILED / DOCUMENT_TOO_LARGE` (spec 056 FR-004). A branch statement row is a few
  hundred bytes and an employee statement of 366 days stays far below the 4 MiB HTML cap.

## 5. Requirements

### API (`apps/api`, module `staff`)

- **FR-001** `POST /v1/businesses/:businessId/branches/:branchId/attendance-statements` with body
  `{ form: 'BRANCH' | 'EMPLOYEE', from, to, employee_id?, language: 'ar' | 'en' }` (Zod `z.strictObject` in
  `packages/contracts`). `employee_id` is required when `form = 'EMPLOYEE'`; on `BRANCH` it is the optional one-employee
  filter (BR-03). `from`/`to` are branch-local dates (`YYYY-MM-DD`, SPEC §7 working dates). The optional
  `shift: { start, end }` (branch-local `HH:MM`, the `scheduleShift` time format) is the BR-11 filter; it is accepted on
  `BRANCH` only and refused on `EMPLOYEE` with `422 ATTENDANCE_STATEMENT_SHIFT_FILTER_INVALID`.
- **FR-001a** `GET /v1/businesses/:businessId/branches/:branchId/attendance-statement-shifts?from&to` (a `queries/` read,
  same guard as FR-002) lists the distinct start–end pairs of the branch's schedule shifts in the period, ordered by
  start then end, for the screen's shift picker (BR-11). A pair not in that list is still accepted by FR-001 and simply
  matches no day.
- **FR-002** The route is guarded by `@Require('read:attendance:branch', { branch: 'branchId' })` and
  `@RequiresFeature('staff')`, like `attendance-monthly-report.controller.ts` (BR-08).
- **FR-003** The use case validates the period (FR-001, Story 3.4), checks the renderer liveness key, the per-user rate
  limit, then in **one** `withTenant(companyId, …, { userId })` transaction confirms that the route's branch belongs to
  the route's business (`branches` row with `(company_id, business_id, id)`; otherwise `404
  ATTENDANCE_STATEMENT_BRANCH_NOT_FOUND`, nothing written), confirms the employee (when given) in that business, and
  inserts the request row (§6.2). The `branch` guard authorizes the branch by its own stored business, so this check is
  what stops a business A route with a business B branch from mixing A's identity with B's attendance. After commit it writes the status hash `QUEUED` (`requested_by`, `filename`) with its
  900-second TTL, then adds the BullMQ job `{ company_id, render_id, kind: 'attendance-statement' }` with
  `jobId = render_id` (ADR-0049 §1.1–§1.3), and answers `202 { render_id }`. `render_id` comes from the injected
  `IdGenerator`; the clock from the injected `Clock`.
- **FR-004** If the enqueue fails after the status hash was written, the use case sets the status `FAILED` with
  `DOCUMENT_RENDER_FAILED` and answers `503 RENDERER_UNAVAILABLE`. The request row stays (it records the attempt).
- **FR-005** `GET …/attendance-statements/:renderId` is a **read**, so it goes through `queries/`, not a use case
  (`CLAUDE.md` §6): `queries/attendance-statement-status.query.ts` reads the request-row binding with SQL (result-shape
  test and `EXPLAIN` assertion), and the Redis status hash through a read port the module owns
  (`ports/document-status.port.ts`, adapter in `persistence/`, the same Redis keys ADR-0049 §1.3 names). It writes
  nothing and imports no `domain/` or `use-cases/`. It returns `{ state, error_code? }` (`QUEUED | RENDERING | READY |
  FAILED | EXPIRED | CONSUMED`) with `Cache-Control: no-store`. It answers `404` unless the request row exists in the
  tenant, its branch is the route branch, and `requested_by` is the caller (ADR-0049 §1.5).
- **FR-006** `POST …/attendance-statements/:renderId/download` collects the PDF once (§6.4) and replies
  `application/pdf`, `Content-Disposition: attachment` with an RFC 5987 file name and an ASCII fallback, `Cache-Control:
  no-store`, `X-Content-Type-Options: nosniff` (ADR-0049 §1.4). It writes the audit entry of BR-09 in the same
  transaction that consumes the bytes.
- **FR-007** The file name is `attendance-statement-{branch|employee}-{from}_{to}.pdf` (ASCII only; no employee name in
  it, so the name never travels in a header).
- **FR-008** The rate limit is a Redis counter per `company_id` + `user_id`: at most 20 requests in a rolling hour
  (`CLAUDE.md` §8 "rate-limit in Redis"). It is a technical guard against filling the render queue, not an owner rule.
- **FR-009** Reads go through `queries/` and writes through use cases (`CLAUDE.md` §6): the request is a use case (it
  writes the request row), collect is a use case (it consumes the bytes and writes the audit), and status (FR-005) and
  the shift options (FR-001a) are `queries/` reads. No arithmetic in any of them.

### Worker (`apps/worker`)

- **FR-010** `apps/worker/src/main.ts` registers the kind `attendance-statement` in the 056 `DocumentSourceRegistry`
  with a source built by a factory in `apps/worker/src/documents/sources/attendance-statement.source.ts`. `main.ts`
  passes the worker `staff` reader into that factory, so the `sources/` folder imports no module index (the composition-root
  pattern). The source calls the reader for the typed statement data, then fills the template from `packages/documents`
  (ADR-0051 §4).
- **FR-011** The `staff` data reader (`readAttendanceStatement(companyId, renderId, signal)`, exported by
  `apps/worker/src/modules/staff/index.ts`) runs one `withTenant(companyId, …, { userId: requested_by })` transaction that
  reads the request row, the business and branch names, the employees with `employee_number`, the period inputs through
  the shared 27b inputs statement (ADR-0051 §2), the employee's OPEN sessions in the period for the employee form
  (FR-011a), the stored identity (ADR-0051 §2) and resolves the logo through its own `StatementLogoReader` port, whose
  adapter calls the worker `files` reader; that reader writes the access audit on the first attempt and reuses the
  audited file on a retry (ADR-0051 §3). It commits, then fetches the logo bytes outside any
  transaction (ADR-0051 §3), then computes the figures with `packages/domain` and returns. No transaction is open while
  Chromium runs (spec 056 FR-003).
- **FR-011a** The 27b inputs statement leaves OPEN sessions out (`s.status<>'OPEN'` in
  `attendance-monthly-report.query.ts`, AB-Q9g), and it stays unchanged so the report and the branch statement keep the
  same figures. The employee form reads the employee's OPEN sessions of the period at the branch through its own worker
  `queries/` statement (`attendance-statement-open-sessions.query.ts`: working date and clock-in only, non-voided), and
  shows them as «لسه جوّه» / "Still clocked in" with 0 hours. They never enter a total.
- **FR-012** A missing request row (or one for another company) fails the job with `DOCUMENT_RENDER_FAILED`; it is never
  rendered for anyone.
- **FR-013** The figures come from pure functions in `packages/domain`: the 27b `computeAttendanceMonthlyReport` rules
  generalised to a `from`–`to` period (the month becomes one period, with the 27b report unchanged), plus a day-by-day
  breakdown for the employee form, plus the BR-11 day selection: the working dates whose schedule shift at the branch,
  in branch-local time, starts and ends at the pair; on such a date the counted sessions are those the 27b rules
  attribute to the matching shift (on a split-shift day, the other shift's sessions are left out). Each has exhaustive
  unit tests, including a parity test that a full calendar month with no shift filter gives the 27b row.
- **FR-014** The data the staff reader returns is a Zod schema in `packages/contracts` (`attendanceStatementDocument`),
  validated by the source before it formats it for the template (ADR-0049 §2.2). It carries names, numbers, dates, minutes and the logo as `{ content_type, base64 }`
  or `null`; never a phone, salary, IBAN or user id.
- **FR-015** The template (`packages/documents/src/templates/attendance-statement.ts`) uses the 056 `html` kit and base
  layout only: escaped interpolation, `raw()` only for the logo data URI it builds, logical CSS, `<bdi>` around Latin
  runs in Arabic, the table header repeated on every printed page, hours as h:mm (AB-Q9d), dates in the Gregorian
  calendar. Dates and times are formatted by the source in `apps/worker/src/documents/sources/` with the
  `packages/i18n` formatters of that language (the worker already depends on `@pospay/i18n`;
  `packages/documents` does not, and gets no new dependency), so the template receives display strings.
- **FR-016** The issue date and time in the footer come from the worker's injected clock, shown in the branch time zone.

### Data

- **FR-017** New tenant table `attendance_statement_requests` (§6.2), RLS policy and negative isolation test in the same
  PR; `pospay_app` gets `SELECT, INSERT` only (rows are immutable).
- **FR-018** No PDF byte, HTML or figure is written to Postgres, R2, a log line or the job (spec 056 FR-007). The request
  row holds parameters only.

## 6. Slice design

### 6.1 Flow

```
admin ── POST …/attendance-statements ──▶ api staff use case
            (guard, period, liveness, rate limit, one withTenant: employee check + request row)
            ──▶ Redis status QUEUED ──▶ BullMQ documents-render {company_id, render_id, kind}
admin ── GET …/:renderId (poll) ──▶ api: request row binding + Redis status
worker documents processor ──▶ source(kind) ──▶ worker staff readAttendanceStatement
            (one withTenant: request row, names, inputs, identity, logo resolve + access audit) → commit
            ──▶ files fetchStatementLogo (outside tx) ──▶ packages/domain figures
            ──▶ packages/documents template → HTML ──▶ renderer → PDF → Redis bytes (120 s) → READY
admin ── POST …/:renderId/download ──▶ api: one withTenant: binding + GETDEL + audit → commit → PDF
```

### 6.2 Schema: `attendance_statement_requests`

| Column | Type | Note |
|---|---|---|
| `company_id` | uuid NOT NULL | tenant; RLS predicate |
| `id` | uuid NOT NULL | = `render_id` (UUID v7); PK `(company_id, id)` (ADR-0007) |
| `business_id` | uuid NOT NULL | FK `(company_id, business_id)` → `businesses` |
| `branch_id` | uuid NOT NULL | FK `(company_id, business_id, branch_id)` → `branches (company_id, business_id, id)` (the `branches_company_business_id_key` key, as `employee_branches` does), so the branch always belongs to the row's business |
| `form` | text NOT NULL | CHECK `IN ('BRANCH','EMPLOYEE')` |
| `employee_id` | uuid NULL | FK `(company_id, business_id, employee_id)` → `employees (company_id, business_id, id)` (`employees_company_business_id_key`); CHECK NOT NULL when `form = 'EMPLOYEE'` |
| `period_from`, `period_to` | date NOT NULL | branch-local working dates; CHECK `period_from <= period_to` and at most 366 days |
| `language` | text NOT NULL | CHECK `IN ('ar','en')` |
| `shift_start`, `shift_end` | time NULL | the BR-11 pair; CHECK both null or both set, and set only when `form = 'BRANCH'` |
| `requested_by` | uuid NOT NULL | the user; the binding of ADR-0049 §1.5 |
| `requested_at` | timestamptz NOT NULL | from the injected clock |

Indexes (one for every foreign key and every list filter, `CLAUDE.md` §5): `(company_id, business_id, branch_id,
requested_at)` (covers the business and the branch foreign keys), `(company_id, business_id, employee_id)`,
`(company_id, requested_by, requested_at)`. The rows are kept; they hold ids, dates and times only. A cleanup is out of
scope.

### 6.3 Status binding

Status and collect read the request row first (in the guard's tenant scope) and answer `404` when it is missing, belongs
to another branch, or `requested_by` differs from the caller. The Redis status hash's `requested_by` is checked as well
(ADR-0049 §1.5). A status hash that is gone (its 900-second TTL ran out) answers the same `404` as an unknown id
(ADR-0049 §1.5); bytes that are gone while the status hash remains read as `EXPIRED` (ADR-0049 §1.6).

### 6.4 Collect

One `withTenant(companyId, …, { userId })` transaction: read the request row (binding, §6.3); `GETDEL` the bytes key;
if nothing came back, roll back and answer `410 DOCUMENT_EXPIRED` (or `409 DOCUMENT_NOT_READY` when the status is
`QUEUED`/`RENDERING`); otherwise append the audit entry and set the status `CONSUMED`; commit; only then send the
bytes. If the commit fails the bytes are already consumed and the user requests again: an audit entry is never missing
for a delivered file. The guard and this transaction are the request's only two connections (PP-7.2: no nested or
concurrent transactions).

### 6.5 The audit entry (BR-09)

`appendAuditLog(tx, id, { entity: 'attendance_statement', entityId: render_id, action: 'attendance.statement.downloaded',
after: { form, business_id, branch_id, employee_id, from, to, shift, language } })`, through the module's existing
`AuditTrail` port as `attendance-report-audit.adapter.ts` does for the CSV (AB-Q9f). Who and when are the audit row's
actor and time. `shift` is `{ start, end }` or `null`.

### 6.6 The two forms' data

**Header (both):** logo or none, header name (`statementIdentity(language, …)`, spec 052 BR-11), branch name in that
language, the period. Employee form adds the employee's name and `employee_number`. Branch form adds the applied filter
(one employee, and the shift pair, BR-11). A shift-filtered table prints «—» for contracted hours and difference.

**Branch table:** `employee_number`, name, days present, worked hours, scheduled hours, contracted hours, difference,
leave by type, late count and minutes, missing clock-out count, manual days (the 27b columns, spec 049 §5), «التوقيع».
Then the manager's signature line.

**Employee table:** every date of the period (Story 2.2), then the totals (the same 27b columns for her), then her
signature line and the manager's.

**Footer (both):** «صادر من نظام PosPay للحضور والانصراف» / "Issued by the PosPay attendance system" and the issue date
and time (BR-06, FR-016), at the end of the document body (ADR-0049 §2.1).

### 6.7 Permissions

No new permission: `read:attendance:branch` (spec 049 AB-Q2) on request, status and collect (BR-08). The requester needs
no `files` or `settings` permission to see the logo in her statement (ADR-0046 §5).

### 6.8 Error codes (added to `src/shared/errors.ts` with `message_ar` / `message_en`)

| Code | HTTP | When |
|---|---|---|
| `ATTENDANCE_STATEMENT_PERIOD_INVALID` | 422 | Story 3.4 |
| `ATTENDANCE_STATEMENT_EMPLOYEE_NOT_FOUND` | 404 | Story 3.3 |
| `ATTENDANCE_STATEMENT_BRANCH_NOT_FOUND` | 404 | Story 3.3, FR-003: the route's branch is not in the route's business |
| `ATTENDANCE_STATEMENT_RATE_LIMITED` | 429 | FR-008 |
| `ATTENDANCE_STATEMENT_SHIFT_FILTER_INVALID` | 422 | FR-001: a shift on the employee form |
| `RENDERER_UNAVAILABLE` | 503 | ADR-0049 §3.6, FR-004 |
| `DOCUMENT_NOT_READY` | 409 | Story 4.3 |
| `DOCUMENT_EXPIRED` | 410 | Story 4.1, 4.2 |

### 6.9 Module map

ADR-0051: no new import arrow. The worker `staff` reader reaches worker `files` only through its `StatementLogoReader`
port and adapter (`staff → files` is already declared, ADR-0031) and uses two shared `@pospay/db` reads; `apps/worker/src/documents/` imports `@pospay/documents` (already allowed)
and no module index: `apps/worker/src/main.ts` injects the `staff` reader into the source factory. The code PRs add the matching `reads:` entries and port rows.

## 7. Tests

- **Domain (`packages/domain`):** period totals (every 27b column) for partial months, year boundaries, hire and contract
  edges, AB-Q11 leave at every branch, AB-Q12 deletion; day-by-day rows (sessions, MISSED_OUT with and without
  correction, MANUAL, OPEN, overnight, leave, scheduled with no session); BR-11 shift-day selection (one pair, a
  split-shift day, an overnight shift, a pair that matches nothing, «—» for contracted and difference); parity with 27b
  for full months with no filter.
- **Contracts:** request body (forms, `employee_id` rule, `strictObject`), status reply, the template data schema.
- **API integration (T2 Postgres, one cloned DB per file, ADR-0006):** 202 and the request row; every refusal of
  Story 3 including `403` without the permission, `404` cross-tenant/other-user/other-branch, and `404` for a business A
  route with a business B branch the caller may read (no row, no job); collect once, expired,
  not ready; the audit entry's fields; no audit when nothing is delivered.
- **RLS:** negative isolation test for `attendance_statement_requests` (cross-tenant read = 0 rows, write = error), and
  that `pospay_app` cannot `UPDATE` or `DELETE` it. A negative constraint test: inserting a row whose branch (or
  employee) belongs to another business of the same company fails on the composite foreign key.
- **Queries:** every new or moved `queries/` statement has a result-shape test and an `EXPLAIN` assertion.
- **Worker:** the source against the T2 Redis with a fake renderer: data read, logo resolve + access audit as
  `pospay_app`, a retry after the logo was replaced embeds the first audited file and adds no row, logo fetch outside
  the transaction, missing request row fails, no figure or HTML in a log line; one end-to-end run with the real
  renderer that checks `%PDF-`, `dir`/`lang`, and the escaped employee names.
- **Template:** escaping of names with `<script>`, quotes and `&`; no external URL; signature places and footer present
  in both languages.
- **Admin (sub-PR 5):** the screen shows the form choices, the waiting state, the download and each refusal message —
  asserting what the user sees (PP-7.2).

## 8. Success criteria

- A pilot branch (30 employees) month statement is `READY` within 10 seconds of the request on staging.
- The branch statement figures equal the 27b report for the same month in every column.
- Every delivered PDF has exactly one audit entry; no PDF byte exists anywhere after collection or 120 seconds.

## 9. Delivery: the sub-PR split

| # | PR | Content |
|---|---|---|
| 0 | docs (this PR) | spec 061, ADR-0051, owner question ST-Q6 (answered) |
| 1 | shared reads + logo reader | move the identity read statement to `@pospay/db` and `statementIdentity` to `packages/domain` (settings re-exports both, no behaviour change); move the 27b inputs statement to `@pospay/db` (27b unchanged, its EXPLAIN and shape tests follow it); worker `files` `resolveStatementLogo` / `fetchStatementLogo` with the once-per-render access audit (ADR-0051 §2–§3) |
| 2 | schema, contracts, domain | migration + RLS + negative test for `attendance_statement_requests` (with the shift columns); contracts (request body, status, `attendanceStatementDocument`); `packages/domain` period, day-by-day and BR-11 shift-day functions with unit tests |
| 3 | worker | worker `staff` `readAttendanceStatement` and the OPEN-sessions query (FR-011a); template; source and its registration in `main.ts` |
| 4 | API | request and collect use cases (with the shift filter and the business–branch check), the status and shift-options `queries/` reads with their read port (FR-005, FR-001a), the guard, the rate limit, the audit entry and every refusal test |
| 5 | admin | the download screen (form, period, employee, shift picker, language, waiting state, download, refusals), i18n ar/en, RTL |

The worker source (3) ships **before** the API that admits requests (4), so every request the API accepts has a
registered `attendance-statement` source; until 4 is deployed nothing enqueues that kind. ST-Q6 is answered, so the
shift filter is no longer a separate PR waiting on the owner: it is built in 2–5 with the rest. Each code sub-PR passes
the gates of `CLAUDE.md` §10 before merge.

## 10. Assumptions

- The footer is printed once at the end of the document body, as the 056 base layout does (ADR-0049 §2.1). A footer and
  page number on every printed page needs a Chromium header/footer option in `packages/documents`; it is out of scope.
- A period is at most 366 days and never ends after the current month in the branch time zone. These are technical
  bounds (render time and size), not owner rules; Waleed can widen them without a schema change other than the CHECK.
- The admin screen offers the current month by default and polls the status every 2 seconds for at most 60 seconds.
