# Spec 061 — The official attendance statement PDF (Phase 1 row 27g)

> **Status:** Draft · 2026-10-21 · docs-only PR (sub-PR 0 of §9). **No code starts before this spec and
> [ADR-0056](../../adr/0056-attendance-statement-reads-and-logo-reader.md) are merged.**
> **Owner answers:** ST-Q1…ST-Q5 (batch 14) were answered on 2026-10-12 by Waleed and Abu Salem with the same pick, plus
> three clarifications by Waleed; they are recorded in
> [spec 051's owner-questions](../051-staff-employee-number/owner-questions.ar.md) §5–§9 and cited in §3, not asked again.
> **ST-Q6** (how a shift is identified for the shift filter) was answered by Waleed on 2026-10-21 (PP-15.4, through his
> super agent) with the recommended option: a shift is a start–end pair from the schedule (BR-11). Abu Salem picked the
> same option on the decisions page (batch 40, 2026-10-21), so the answer is final. Recorded in
> [owner-questions.ar.md](owner-questions.ar.md).
> **ST-Q7** (what the leave column counts under a shift filter) and **ST-Q8** (contracted hours of a date whose default
> hours have not ended at the request, and leave on it) were answered by Waleed on 2026-10-23 (PP-43.1, PP-43.2,
> through his super agent and the decisions page), each with the recommended option: BR-11 and FR-013a. Abu Salem has
> not answered yet; work follows Waleed's pick, and Abu Salem's pick replaces it if it differs (`CLAUDE.md` §1 5b).
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
| The `files`-owned logo bytes reader and its access audit (ADR-0049 §6, ADR-0056) | A page number on every page (needs a renderer option; §10) |
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
  **Leave (ST-Q7, Waleed 2026-10-23, PP-43.1: «إجازات الشيفت ده بس (Recommended)»):** the leave-by-type column of a
  filtered statement counts only approved leave on the dates whose scheduled shift at the branch had that pair.
- **BR-12 (ST-Q8, Waleed 2026-10-23, PP-43.2: «بعد ما ساعاته تخلص (Recommended)»):** a date adds its contracted minutes
  only once its default working hours have ended at the request; an approved leave on such a date is shown but is not
  subtracted from the contracted minutes until then (FR-013a).

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
   employee with any counted session, contracted minutes (BR-12) or approved leave on a contract day at the branch in
   the period, a signature column, the
   manager's signature line and the footer (BR-01, BR-02, BR-04, BR-06).
5. For a full calendar month at one branch with no shift filter, whose every scheduled shift end and default-entry end
   is at or before the request, each row's figures equal the 27b monthly report row of the same employee, branch and
   month read at the same moment (parity test). Any other range with no shift filter, under the same condition, is
   checked against the sum of the 27b per-day figures over its dates, with no parity test. Otherwise the schedule-based
   figures (scheduled and contracted minutes, «لا يوجد حضور مسجّل») cover only the shifts and default hours that had
   ended at the request, while sessions count as 27b counts them at render time (FR-013a). Admission (FR-003) is only a quick pre-check: if the render finds the
   employee or the whole statement empty, the status ends `FAILED / STATEMENT_EMPTY` and no PDF is produced.
6. **Given** سارة always on 09:00–20:00, هبة always on 08:00–16:00 and ريم on 09:00–20:00 on some days and 08:00–16:00 on
   others, **when** the manager filters October by the shift 09:00–20:00, **then** the table has سارة with all her days
   and ريم with her 09:00–20:00 days only; هبة has no row; contracted hours and difference print «—» (BR-11). ريم's
   sick leave on 14 October (scheduled 09:00–20:00) is in her leave column, and her annual leave on 20 October
   (scheduled 08:00–16:00) is not (ST-Q7).

### Story 2 — The employee statement (P1)

1. **Given** the same manager, **when** she requests هبة's statement for 1–15 October in English, **then** the PDF has
   `dir="ltr" lang="en"`, the English official name, هبة's name and employee number, and one block per date of the
   period in date order.
2. A date with sessions lists each counted session (clock-in, clock-out, lateness, source note «يدوي» / "Manual" for a
   MANUAL session) and the day's worked hours; a date with an uncorrected missed clock-out shows «ناقص بصمة خروج» /
   "Missing clock-out" and adds 0 hours (BR-05); a date with approved leave shows the leave type; a date with a
   scheduled shift and no counted session shows the scheduled times and «لا يوجد حضور مسجّل» / "No attendance
   recorded"; any other date shows the date only. A shift that had not ended at the request (FR-013a), on any date,
   adds no scheduled minutes and never prints «لا يوجد حضور مسجّل»; a closed session on that date still counts, its
   lateness included. A date with an OPEN session (at render time) shows «لسه جوّه»
   and never «لا يوجد حضور مسجّل», whatever its schedule.
3. The totals under the table are the 27b columns for that employee and period, then her signature line and the
   manager's (BR-04).

### Story 3 — Refusals (P1)

1. A user without `read:attendance:branch` on the branch gets `403` on request, status and collect.
2. Another user, another company, an unknown `render_id` and an id requested for another branch all get the same `404`
   on status and collect (ADR-0049 §1.5).
3. An employee who has no counted session, no contracted minutes that count under BR-12 and no approved leave on a
   contract day at the branch in the period (a period of only future dates with no approved leave included), or who
   belongs to another
   business or company: `404 ATTENDANCE_STATEMENT_EMPLOYEE_NOT_FOUND`, no request row, no job (FR-003). This is the
   same rule that decides who has a row in the branch table (Story 1.4).
   A route whose branch belongs to another business of the same company: `404 ATTENDANCE_STATEMENT_BRANCH_NOT_FOUND`,
   no request row, no job (FR-003).
4. `from > to`, a period longer than 366 days, or `to` after the last day of the current month in the branch time
   zone: `422 ATTENDANCE_STATEMENT_PERIOD_INVALID`. The current month can be asked for on any day; a shift or default
   hours that had not ended at the request add no scheduled or contracted minutes (FR-013a).
5. The renderer is down (no `documents:renderer-alive` key): `503 RENDERER_UNAVAILABLE`, no request row, no job.
6. More than 20 requests by the same user in one fixed hourly window: `429 ATTENDANCE_STATEMENT_RATE_LIMITED`.
7. The staff feature is disabled for the business: the same refusal as the monthly report (`@RequiresFeature('staff')`).

### Story 4 — Collect once (P1)

1. A second collect of the same `render_id` gets `410 DOCUMENT_EXPIRED` and writes no audit entry.
2. A collect after the 120-second byte TTL gets `410 DOCUMENT_EXPIRED`; the status reads `EXPIRED`.
3. A collect before `READY` gets `409 DOCUMENT_NOT_READY`.
4. A collect whose audit write fails delivers no file (§6.4).

### Story 5 — Logo and identity (P2)

1. A business with no logo when the request is made: the header has the name only (BR-01) on every attempt, even if a
   logo is bound before a retry; no `file_access_audit` row is written.
2. A business with a logo: exactly one `file_access_audit` row (`outcome = 'ALLOW'`, actor = the requester, `id =
   render_id`) and one `file`/`access` audit entry per render, even when the job's attempt is retried; every attempt
   embeds the file recorded on the request row, never a logo bound after it (ADR-0056 §3).
3. A logo replaced or purged between the request and the render: the statement uses the logo bound when the request
   was made (recorded on the request row), or the name only if none was bound or that file no longer qualifies.
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
- **FR-003** The use case checks the renderer liveness key and the per-user rate limit, then in **one**
  `withTenant(companyId, …, { userId })` transaction first confirms that the route's branch belongs to the route's
  business (`branches` row with `(company_id, business_id, id)`; otherwise `404 ATTENDANCE_STATEMENT_BRANCH_NOT_FOUND`,
  nothing written), before any period check, so a mismatched route always gets that `404`. Then it checks the period's
  shape (`from <= to`, at most 366 days; otherwise `422 ATTENDANCE_STATEMENT_PERIOD_INVALID`), loads the branch's
  effective time zone (the branch's, otherwise the business's, through the `tenancy.describeWorkspaces` read staff already uses)
  and only then checks the ceiling of Story 3.4: `to` must not pass the last day of the month that the injected `Clock`
  falls in **in that time zone** (at 22:00 UTC on 31 October it is already November in `Asia/Kuwait`, so November is
  the current month). A violation is `422 ATTENDANCE_STATEMENT_PERIOD_INVALID` with nothing written. The same
  transaction then confirms the employee (when given) with the **same candidate rule the branch table uses** (Story
  1.4, Story 3.3): she belongs to that business and has, at that branch in the period, a counted session, a contract
  day that counts under BR-12 (its default working-hours entry ends at or before the injected `Clock` instant, the same
  instant stored as `requested_at`), or an approved leave on a contract day, whether or not that day had ended (the
  leave is shown, BR-12). An employee whose only coverage has not ended yet and who has no approved leave on it (hired
  today with a 17:00 default entry, asked at 10:00) is refused here. The check is an eligibility statement in
  `@pospay/db` beside the shared 27b inputs statement (ADR-0056 §2): the 27b `candidates` rule limited to that one
  employee, plus the end-instant predicate on contract days and the approved-leave case, with the instant as a
  parameter; the 27b statement takes no instant and stays unchanged. It is a quick pre-check on the current state, and the render reads the current state again
  (FR-013a): if the render then finds the employee or the whole statement empty, the job ends `FAILED /
  STATEMENT_EMPTY` (a visible status, FR-005) and no PDF is produced. Otherwise `404
  ATTENDANCE_STATEMENT_EMPLOYEE_NOT_FOUND` before any insert (no request row, no job). An employee whose only activity
  is an OPEN session is refused too: an OPEN session is not counted until it closes (AB-Q9g). Then it reads the
  business's bound `logo_file_id` through a port the API `staff` module owns (`StatementLogoReferenceReader` in
  `staff/ports/`, its `persistence/` adapter calling the shared `@pospay/db` `readBusinessIdentity`; the use case
  depends only on the port, ADR-0056 §1) and inserts the request row with it (§6.2), so the logo decision of the render, a file or none, is fixed before any attempt. The `branch` guard authorizes the branch by its own stored business, so this check is
  what stops a business A route with a business B branch from mixing A's identity with B's attendance. After commit it writes the status hash `QUEUED` (`requested_by`, `filename`) with its
  900-second TTL, then adds the BullMQ job `{ company_id, render_id, kind: 'attendance-statement' }` with
  `jobId = render_id` (ADR-0049 §1.1–§1.3), and answers `202 { render_id }`. `render_id` comes from the injected
  `IdGenerator`; the clock from the injected `Clock`.
- **FR-004** If the enqueue fails after the status hash was written, the use case sets the status `FAILED` with
  `DOCUMENT_RENDER_FAILED` and answers `503 RENDERER_UNAVAILABLE`. The request row stays (it records the attempt).
- **FR-005** `GET …/attendance-statements/:renderId` is a **read**, so it goes through `queries/`, not a use case
  (`CLAUDE.md` §6): `queries/attendance-statement-status.query.ts` reads the request-row binding with SQL (result-shape
  test and `EXPLAIN` assertion), and the Redis status hash through a read-side interface declared **beside the query**
  in `queries/` (`DocumentStatusRead`, as `EmployeeDetailAccess` sits beside its query, module map §3), not in
  `ports/`; the module wiring supplies its Redis adapter from `persistence/` (the same Redis keys ADR-0049 §1.3 names). It writes
  nothing and imports no `domain/` or `use-cases/`. It returns `{ state, error_code? }` (`error_code` includes
  `STATEMENT_EMPTY`, FR-013a; `QUEUED | RENDERING | READY |
  FAILED | EXPIRED | CONSUMED`) with `Cache-Control: no-store`. It answers `404` unless the request row exists in the
  tenant, its `business_id` is the route business, its `branch_id` is the route branch, and `requested_by` is the caller
  (ADR-0049 §1.5). The business match matters because the `branch` guard authorizes a branch by its own stored
  business (FR-003), so a render made under business B must not be reachable through a business A route.
- **FR-006** `POST …/attendance-statements/:renderId/download` collects the PDF once (§6.4) and replies
  `application/pdf`, `Content-Disposition: attachment` with an RFC 5987 file name and an ASCII fallback, `Cache-Control:
  no-store`, `X-Content-Type-Options: nosniff` (ADR-0049 §1.4). It writes the audit entry of BR-09 in the same
  transaction that consumes the bytes.
- **FR-007** The file name is `attendance-statement-{branch|employee}-{from}_{to}.pdf` (ASCII only; no employee name in
  it, so the name never travels in a header).
- **FR-008** The rate limit is a Redis counter per `company_id` + `user_id`: at most 20 requests in one fixed hourly
  window, through the existing fixed-window `createRedisRateLimiter` (`apps/api/src/shared/adapters/redis-rate-limiter.ts`,
  the same limiter every other API rate limit uses; `CLAUDE.md` §8 "rate-limit in Redis"). Up to 40 requests can
  therefore land within one rolling hour across a window boundary; that is accepted. It is a technical guard against filling the render queue, not an owner rule.
- **FR-009** Reads go through `queries/` and writes through use cases (`CLAUDE.md` §6): the request is a use case (it
  writes the request row), collect is a use case (it consumes the bytes and writes the audit), and status (FR-005) and
  the shift options (FR-001a) are `queries/` reads. No arithmetic in any of them.

### Worker (`apps/worker`)

- **FR-010** `apps/worker/src/main.ts` registers the kind `attendance-statement` in the 056 `DocumentSourceRegistry`
  with a source built by a factory in `apps/worker/src/documents/sources/attendance-statement.source.ts`. `main.ts`
  passes the worker `staff` reader and the worker `files` `readStatementLogo` into that factory, so the `sources/` folder
  imports no module index (the composition-root pattern). The source calls the `staff` reader for the typed statement
  data, then, when the request row recorded a logo, `readStatementLogo`, which audits and reads it in the `files`
  module's own transaction and step (ADR-0056 §3), then fills the template from `packages/documents` (ADR-0056 §4). The
  two calls are sequential, never nested.
- **FR-011** The `staff` data reader (`readAttendanceStatement(companyId, renderId, signal)`, exported by
  `apps/worker/src/modules/staff/index.ts`) runs one read-only `withTenant(companyId, …)` transaction, with no `userId`
  option because `requested_by` is known only once the request row is read and nothing in it is written, that
  reads the request row, the business and branch names, the employees with `employee_number`, the period inputs through
  the shared 27b inputs statement (ADR-0056 §2), the employee's OPEN sessions in the period for the employee form
  (FR-011a) and the stored identity (ADR-0056 §2), and never calls `files`. It commits, then computes the figures with
  `packages/domain` and returns its internal result `AttendanceStatementData` (a TypeScript type exported from the
  worker `staff` index, not a contract): `businessId`, `requesterUserId` (the request row's `requested_by`),
  `logoFileId` (the request row's `logo_file_id`, untouched, or `null`) and `statement`, the statement data without a
  logo (FR-014). No transaction is open while
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
  unit tests, including a parity test that a full calendar month at one branch with no shift filter gives the 27b
  row when both are computed from the same inputs and every scheduled shift end and default-entry end of that month is
  at or before `requested_at`; any other range with no shift filter, under the same condition, is checked against the
  sum of the 27b per-day figures, with no parity test.
- **FR-013a** What has not happened yet (ST-Q8, BR-12). The cutoff is the instant `requested_at` of the request row,
  compared in the branch time zone (or the business's when the branch has none, as in Story 3.4). It governs only the
  schedule-based figures: contracted minutes, scheduled minutes and the «لا يوجد حضور مسجّل» note. Sessions are not
  cut by it.
  - **scheduled shifts:** a shift's scheduled minutes and its «لا يوجد حضور مسجّل» note count only when its `ends_at` is
    at or before `requested_at`. This holds on every date of the period: at 01:00 a 22:00–06:00 shift of the previous
    working date has not ended, so it stays attributed to its working date (AB-Q9b) but adds no scheduled minutes;
  - **contracted minutes (BR-12):** a date's contracted minutes count only when that date's default working-hours entry
    (the contract `entries` the 27b rules use, branch-local start and end, an end not after the start meaning the next
    day) ends at or before `requested_at`. An approved leave on a date whose entry has not ended is shown (leave
    column, employee form) but is not subtracted from contracted minutes until then. This compares the contract with
    the clock only; it never ties contracted minutes to a scheduled shift;
  - **sessions:** a `CLOSED` or `MISSED_OUT` session counts exactly as 27b counts it in its render-time state (below),
    its lateness included, even before its shift ends (an employee who came in late and left early has her lateness
    counted at once); an OPEN session prints «لسه جوّه».

  A date prints as the date only when it has no counted session, no OPEN session, no approved leave and no scheduled
  shift that had ended; the future dates of a current-month period are such dates unless they have approved leave. A
  period with no counted session, no counted contracted minutes and no approved leave counts nothing: Story 3.3
  refuses the employee form, and the branch table has no row.
  - **Render-time state:** sessions, approved leave and schedule shifts are read in their state at render time, as
    27b reads them, and admission reads the same current state. An edit made after the request (a void, a correction,
    a leave decision, a schedule edit) changes the figures, and a retry reads them again (`TODO(spec)`, issue #552:
    freezing the inputs at the request is a separate design). A session prints «لسه جوّه» when it is still OPEN at
    render time, and a `MISSED_OUT` session is judged by its state at render. On a date with an OPEN session,
    «لسه جوّه» takes precedence: that date never prints «لا يوجد حضور مسجّل».
  - **Empty at render:** if the render finds the requested employee, or every branch row, empty, the source throws
    `AttendanceStatementEmptyError` and the status ends `FAILED / STATEMENT_EMPTY`: final, no retry, no PDF.
  - **The render contract:** `STATEMENT_EMPTY` is added to `documentRenderErrorCode` in
    `packages/contracts/src/documents-render.ts` (the `DocumentRenderErrorCode` enum of spec 056), and
    `apps/worker/src/documents/process-job.ts` maps the error class to it in `errorCode` and treats it as final in
    `failsAtOnce`, beside `DOCUMENT_KIND_UNKNOWN` and `DOCUMENT_TOO_LARGE` (§9, sub-PR 3).
- **FR-014** The template's input is a Zod schema in `packages/contracts` (`attendanceStatementDocument`). The source
  builds it, after the two calls of FR-010, from the reader's `statement` (FR-011) and the `readStatementLogo` result
  encoded as `logo: { content_type, base64 }`, or `logo: null` when `logoFileId` is `null` or the logo reader returned
  `null`; it validates it before it formats it for the template (ADR-0049 §2.2). It carries names, numbers, dates,
  minutes and the logo; never a phone, salary, IBAN or user id. `businessId`, `requesterUserId` and `logoFileId` stay
  in `AttendanceStatementData`, used only to call `readStatementLogo`, and never reach the template or the PDF.
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
            (one withTenant: request row, names, inputs, identity, logo_file_id) → commit → packages/domain figures
       ──▶ (logo recorded) files readStatementLogo: own withTenant: file check + access audit → commit
            → storage read + re-encode (outside tx)
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
| `logo_file_id` | uuid NULL | the business's bound logo when the request was made, read through the shared `@pospay/db` `readBusinessIdentity` in the request transaction; null = no logo. No FK (ADR-0056 §5) |
| `requested_by` | uuid NOT NULL | the user; the binding of ADR-0049 §1.5 |
| `requested_at` | timestamptz NOT NULL | from the injected clock |

Indexes (one for every foreign key and every list filter, `CLAUDE.md` §5): `(company_id, business_id, branch_id,
requested_at)` (covers the business and the branch foreign keys), `(company_id, business_id, employee_id)`,
`(company_id, requested_by, requested_at)`. The rows are kept; they hold ids, dates and times only. A cleanup is out of
scope.

### 6.3 Status binding

Status and collect read the request row first (in the guard's tenant scope) and answer `404` when it is missing, belongs
to another business than the route's or another branch than the route's, or `requested_by` differs from the caller. The Redis status hash's `requested_by` is checked as well
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
(one employee, and the shift pair, BR-11). A shift-filtered table prints «—» for contracted hours and difference, and
its leave-by-type column counts only leave on the dates scheduled on the pair (BR-11, ST-Q7).

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
| `STATEMENT_EMPTY` | — (status `FAILED`) | FR-013a: the render found the statement empty; in `documentRenderErrorCode`, final, with `message_ar` / `message_en` |

### 6.9 Module map

ADR-0056: no new import arrow and no `sync_writes` row. The worker `staff` reader never calls `files`; the documents
source calls `files` `readStatementLogo`, which writes its own access audit in its own transaction (ADR-0056 §3). The
`staff` reads of identity go through module-owned ports to `@pospay/db` (worker `StatementIdentityReader`, API
`StatementLogoReferenceReader`), and the 27b inputs statement is shared through `@pospay/db`; `apps/worker/src/documents/` imports `@pospay/documents` (already allowed)
and no module index: `apps/worker/src/main.ts` injects the `staff` reader and the `files` logo reader into the source
factory. The code PRs add the two port rows.

## 7. Tests

- **Domain (`packages/domain`):** period totals (every 27b column) for partial months, year boundaries, hire and contract
  edges, AB-Q11 leave at every branch, AB-Q12 deletion; day-by-day rows (sessions, MISSED_OUT with and without
  correction, MANUAL, OPEN, overnight, leave, scheduled with no session); BR-11 shift-day selection (one pair, a
  split-shift day, an overnight shift, a pair that matches nothing, «—» for contracted and difference, and the ST-Q7
  leave column: ريم's leave on a 09:00–20:00 date is counted under that filter and her leave on an 08:00–16:00 date is
  not); parity with 27b for full months with no filter whose every shift and default-entry end is at or before the
  request; at the month end, an October statement requested at 01:00 on 1 November (`Asia/Kuwait`) with a
  22:00–06:00 shift and default entry on 31 October is not asserted equal to 27b, and the same request at 06:00 or
  later equals the 27b row; the FR-013a instant rule with a fixed clock: at 10:00 on 23 October a 17:00–21:00 shift
  that day adds no scheduled minutes and prints no «لا يوجد حضور مسجّل», a 08:00–09:30 shift that day counts its
  scheduled minutes, 24–31 October print the date only, and a 09:00–17:00 default entry on 23 October adds no
  contracted minutes until 17:00 (BR-12); an approved leave on 23 October is shown and not subtracted before 17:00,
  and subtracted after; at 13:00 a session from 09:20 to 12:00 on a 09:00–17:00 shift counts with its 20 minutes of
  lateness while the shift's scheduled minutes do not count yet; at 01:00 a 22:00–06:00 shift of the previous working
  date adds no scheduled minutes; an OPEN session at render prints «لسه جوّه» on its date.
- **Contracts:** request body (forms, `employee_id` rule, `strictObject`), status reply, the template data schema.
- **API integration (T2 Postgres, one cloned DB per file, ADR-0006):** 202 and the request row; every refusal of
  Story 3 including `403` without the permission, `404` cross-tenant/other-user/other-branch, and `404` for a business A
  route with a business B branch the caller may read (no row, no job); status and collect of a render made under
  business B, called through a business A route with the same branch, get `404` and write no audit; the month ceiling
  at the time-zone boundary with a fixed clock for an `Asia/Kuwait` branch: at 2026-10-31T20:59Z `to = 2026-11-30`
  gets `422 ATTENDANCE_STATEMENT_PERIOD_INVALID` (still October), at 2026-10-31T21:00Z `to = 2026-12-01` gets the same
  `422`, and at 2026-10-31T21:00Z `to = 2026-11-30` is accepted (November is the current month); a branch without its
  own time zone uses the business's;
  `404` for an employee of the business with
  no counted session and no contracted minutes at the branch in the period, or only an OPEN session (no row, no job),
  while one with only contracted minutes is accepted; with a fixed clock in an `Asia/Kuwait` branch, an employee
  form for 25–31 October asked on 23 October gets `404 ATTENDANCE_STATEMENT_EMPLOYEE_NOT_FOUND` (no row, no job), and
  so does an employee hired on 23 October with a 17:00 default entry asking at 10:00, while the same request at 23:30 is
  accepted, and so is the 10:00 request when she has an approved leave on 23 October (BR-12); a `shift` on the branch form is accepted and on the employee form gets `422
  ATTENDANCE_STATEMENT_SHIFT_FILTER_INVALID`; the shift-options read lists the pairs in the period; the
  rate limit at its boundary: the 20th request in a window is
  accepted, the 21st gets `429`, and the first request after the window expires is accepted; collect once, expired,
  not ready; the audit entry's fields; no audit when nothing is delivered.
- **RLS:** negative isolation test for `attendance_statement_requests` (cross-tenant read = 0 rows, write = error), and
  that `pospay_app` cannot `UPDATE` or `DELETE` it. A negative constraint test: inserting a row whose branch (or
  employee) belongs to another business of the same company fails on the composite foreign key.
- **Queries:** every new or moved `queries/` statement has a result-shape test and an `EXPLAIN` assertion.
- **Worker:** the source against the T2 Redis with a fake renderer: data read, `readStatementLogo` (file check +
  access audit in its own transaction) as `pospay_app`, the `staff` reader writing nothing in `files`, a retry after the logo was replaced embeds the recorded file and adds no row, a request made with no
  logo stays name-only after a logo is bound, logo fetch outside
  the transaction, missing request row fails, no figure or HTML in a log line; render-time reads: a session closed
  between the request and the render counts as closed, and one still OPEN at render prints «لسه جوّه» (#552); an
  employee whose only session is voided between the request and the render ends `FAILED / STATEMENT_EMPTY` with no
  PDF and no retry; `process-job.ts` maps the error class to `STATEMENT_EMPTY` as final; one end-to-end run with the
  real renderer that checks `%PDF-`, `dir`/`lang`, and the escaped employee names.
- **Template:** escaping of names with `<script>`, quotes and `&`; no external URL; signature places and footer present
  in both languages.
- **Admin (sub-PR 5):** the screen shows the form choices, the waiting state, the download and each refusal message —
  asserting what the user sees (PP-7.2).

## 8. Success criteria

- A pilot branch (30 employees) month statement is `READY` within 10 seconds of the request on staging.
- For a full calendar month at one branch with no shift filter, whose every shift and default-entry end is at or
  before the request, the branch statement figures equal the 27b report for the same month, read at the same moment,
  in every column.
- Every delivered PDF has exactly one audit entry; no PDF byte exists anywhere after collection or 120 seconds.

## 9. Delivery: the sub-PR split

| # | PR | Content |
|---|---|---|
| 0 | docs (PR #439, and the follow-up with the ST-Q7 and ST-Q8 answers) | spec 061, ADR-0056, owner questions ST-Q6, ST-Q7 and ST-Q8 (answered) |
| 1 | shared reads + logo reader | move the identity read statement to `@pospay/db` and `statementIdentity` to `packages/domain` (settings re-exports both, no behaviour change); move the 27b inputs statement to `@pospay/db` (27b unchanged, its EXPLAIN and shape tests follow it); worker `files` `readStatementLogo` with its own transaction and the once-per-render access audit (ADR-0056 §2–§3) |
| 2 | schema, contracts, domain | migration + RLS + negative test for `attendance_statement_requests` (with the shift columns); contracts (request body, status, `attendanceStatementDocument`); `packages/domain` period, day-by-day, BR-11 shift-day (with the ST-Q7 leave rule) and BR-12 / FR-013a instant functions with unit tests |
| 3 | worker | worker `staff` `readAttendanceStatement` and the OPEN-sessions query (FR-011a); template; source (staff reader, then `files` `readStatementLogo`) and its registration in `main.ts`; the typed `STATEMENT_EMPTY` source error, added to `documentRenderErrorCode` and mapped as final in `apps/worker/src/documents/process-job.ts` (FR-013a) |
| 4 | API | request and collect use cases (with the shift filter, the BR-12 eligibility predicate, the business–branch check and the `StatementLogoReferenceReader` port and adapter), the status and shift-options `queries/` reads with the status read interface beside its query (FR-005, FR-001a), the guard, the rate limit, the audit entry and every refusal test |
| 5 | admin | the download screen (form, period, employee, shift picker, language, waiting state, download, refusals), i18n ar/en, RTL |

The worker source (3) ships **before** the API that admits requests (4), so every request the API accepts has a
registered `attendance-statement` source; until 4 is deployed nothing enqueues that kind. ST-Q6, ST-Q7 and ST-Q8
are answered, so no sub-PR waits on an owner answer: the shift filter with its leave rule and the FR-013a instant rule
are built in 2–5 with the rest. If Abu Salem later picks differently on ST-Q7 or ST-Q8, a follow-up changes this spec
and the code. Each code sub-PR passes
the gates of `CLAUDE.md` §10 before merge.

## 10. Assumptions

- The footer is printed once at the end of the document body, as the 056 base layout does (ADR-0049 §2.1). A footer and
  page number on every printed page needs a Chromium header/footer option in `packages/documents`; it is out of scope.
- A period is at most 366 days and never ends after the current month in the branch time zone. These are technical
  bounds (render time and size), not owner rules; Waleed can widen them without a schema change other than the CHECK.
- The admin screen offers the current month by default and polls the status every 2 seconds for at most 60 seconds.
