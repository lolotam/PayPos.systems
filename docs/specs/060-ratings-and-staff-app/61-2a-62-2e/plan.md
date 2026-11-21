# Implementation Plan: 61-2a staff rating summary API + 62-2e employee document number

**Date**: 2026-11-21 | **Spec**: [spec.md](spec.md) | **Evidence**: [research.md](research.md) |
**Contract**: [contracts/api.md](contracts/api.md) | **Data**: [data-model.md](data-model.md)
**Design source pin**: `cf70114e2cbe9efcb2b5dc4d327f2c82f87d54b3`. **Implementation base**: `9e056209b42f08a4e00bdec6ed70efbc3796c58c`. Only unrelated spec 074 files changed between them.
**Status**: PLAN ONLY (PP-204). This plan describes proposed code, tests and migrations for the implementation PR.
**Pipeline tier**: Waleed approved «Medium» for this combined delivery (PP-213). One spec, plan and implementation PR.
Independent Sol 6.2 Medium security review covers the document number, its access checks and the migration.

## Summary

Two independent rows in one PR.

- **61-2a** adds one read, `GET /v1/staff/me/rating-summary`, in API `customers`. It copies the shape of the merged
  own-tips read: one transaction, authority first, then the `rating_average` column gate, then one aggregate over
  `rating_attributions`. The gate stays off, so production answers `HIDDEN` until 61-3.
- **62-2e** adds a nullable `document_number` to `employee_documents`, accepts it on the existing record route, returns
  it in the existing documents list, and adds one small staff read that the admin bell calls to show the number to a
  current `read:files:business` holder. Nothing that is stored, queued, logged or audited ever carries the number.

## Technical Context

**Language/Version**: TypeScript, Node (repo toolchain) · **Primary dependencies**: NestJS + Fastify, Drizzle
(`sql` tag), Zod (`packages/contracts`), Next.js + TanStack Query + react-hook-form (admin) — all already in use; no
new dependency.
**Storage**: PostgreSQL through `withTenant`; one expand-only column.
**Testing**: Vitest; API integration on the lane's own Postgres cluster (`scripts/test-db/lane.mjs`, ADR-0006).
**Project type**: modular monolith (`apps/api`, `apps/admin`, `packages/*`).
**Performance**: both new reads are single indexed statements, far below the 200 ms rule; each has an `EXPLAIN` test.
**Constraints**: file ≤ 300 lines (warn) / 400 (error), function ≤ 60; `queries/` imports neither `domain/` nor
`use-cases/`; no raw Drizzle client; Arabic JSDoc on `domain/**` and `ports/**`.
**Scale/Scope**: about 720 hand-written production lines and about 1,230 test lines (§7).

## Constitution Check

Constitution 3.9.0 (`.specify/memory/constitution.md`), principles I–VII.

| Principle | Result |
|---|---|
| I. One vertical slice at a time | **Deviation, owner-directed**: two rows in one PR. Each row keeps its own acceptance criteria, files and tests (§3, §4) and can be reverted separately. Recorded in Complexity Tracking |
| II. Domain purity and money | Pass. No money. No arithmetic in a use case; the average is one SQL aggregate in `queries/` (D-B12 computes on read) |
| III. Tenant isolation by the database | Pass. No new table. Every read and write runs in `withTenant`; the RLS negative test is extended for the new column |
| IV. Machine-enforced boundaries | Pass with documentation in the same PR: no new arrow; four new `reads` lines and two port rows (research D-1) |
| V. Test-backed delivery | Pass. §6 |
| VI. Arabic-first, RTL | Pass. New strings through `packages/i18n` in ar and en; logical CSS only |
| VII. Documented why, in Arabic | Pass. Arabic JSDoc on the new `ports/` method changes and the new `domain/` function; one line above each query |

Re-check after design: unchanged.

## Project Structure

### Documentation (this feature)

```text
docs/specs/060-ratings-and-staff-app/61-2a-62-2e/
├── spec.md
├── plan.md               (this file)
├── research.md           evidence at the pin, open checks, decisions D-1…D-16
├── data-model.md
├── quickstart.md         commands and gates for the implementer
├── contracts/api.md
├── checklists/requirements.md
└── pending-deltas.md     exact edits to tracked documents, to apply on a branch cut from the pin
```

`tasks.md` is not produced here (`/speckit-tasks` is a separate step; §5 is ordered finely enough for the brief).

### Source code touched

```text
packages/contracts/src/customers/      own-rating-summary.ts, own-rating-summary-openapi.ts            (new)
packages/contracts/src/staff/          employee-documents.ts, employee-documents-openapi.ts            (edit)
packages/contracts/src/                openapi.ts, customers/index.ts or index.ts                      (edit)
packages/db/schema/                    staff-documents.ts                                              (edit)
packages/db/migrations/                two files + meta                                                (new, generated + hand NOT VALID/VALIDATE)
packages/i18n/src/                     employee-documents-catalog.ts, in-app-catalog.ts                (edit)
apps/api/src/modules/identity/         persistence/own-ratings-access.ts (new), index.ts (edit)
apps/api/src/modules/customers/        persistence/own-rating-context.adapter.ts, queries/own-rating-context.ts,
                                       queries/own-rating-summary.query.ts, http/own-rating-summary.controller.ts (new),
                                       customers.module.ts (edit)
apps/api/src/modules/staff/            domain/employee-documents.ts, ports/employee-documents.port.ts,
                                       use-cases/record-employee-document/…usecase.ts,
                                       persistence/drizzle-employee-documents.ts, queries/employee-documents.query.ts (edit),
                                       queries/employee-document-numbers.query.ts,
                                       http/employee-document-numbers.controller.ts (new), staff wiring (edit)
apps/admin/src/staff/                  ui/employee-document-form.tsx, ui/employee-document-columns.tsx,
                                       api/use-employee-documents.ts (edit)
apps/admin/src/notifications/          api/use-document-numbers.ts (new), model/render-notification.ts,
                                       ui/notification-item.tsx, ui/notification-panel.tsx, ui/notification-bell.tsx (edit)
docs/                                  module-map.md (+ regenerated module-map.yaml), adr/0010 addendum,
                                       specs/060 spec.md + owner-questions.ar.md (see pending-deltas.md)
```

**No hand-written change** (generated `schema.d.ts` aside): `apps/pos`, `apps/menu`. **Not touched at all**:
`apps/worker` production code, `packages/notifications`, `packages/domain`,
`settings/domain/staff-columns.ts`, any permission catalog or role default, `staff-alert-notifications.ts`.

**Structure decision**: existing module shapes; no new folder kind.

## 1. Existing behaviour this plan relies on

Each line is backed by a row in `research.md` §1.

- Own reads: the tips route, its context adapter and its reads token are the template for 61-2a.
- `rating_attributions` and its employee index exist and are filled by the merged rating submission.
- `customers` already declares arrows to `tenancy`, `settings`, `staff`, `identity`, and already owns a
  `StaffColumnsPort` adapter that no route uses yet.
- Documents: record/replace and list only; the record response is stored by the idempotency layer; audit and event are
  built from `EmployeeDocumentRecord`; the application role cannot update a document row except `replaced_at`.
- Bell: `document_id` is already a stored parameter; the admin renderer hides it; recipients were already filtered by
  `read:files:business` when the bell was sent.

## 2. Open gates and questions (none blocks the start of implementation)

| # | Item | Kind | Who | Effect |
|---|---|---|---|---|
| G-1 | Manager accepted the 61-2a-specific ADR and module-map declarations | technical | manager | Implement the small scoped addendum while 61-1a is absent. If 61-1a lands first, reconcile overlap before opening the PR. |
| G-2 | **DN-Q1** (spec BR-D3): edit a stored number without a new file? Recorded `PENDING` in `pending-deltas.md` §1 | feature | manager routes it (PP-117; decisions page) | None on this PR: record/replace ships either way. A «yes» is a later slice (new `UPDATE` grant, new write route, value-free audit) |
| G-3 | Independent Astra 6.2 Medium design round completed | process | manager | Findings on DST, cache lifecycle, Unicode and guard status incorporated. Waleed subsequently approved Medium with independent Sol security review. |
| G-4 | Migration lane turn and final migration numbers (PP-130); stacking if another migration PR is open | process | manager | Only the last renumber/regenerate step waits |
| G-5 | Route policy of the summary: this plan builds **personal session only**, as briefed (research D-2). Should the reception device also read it behind the private-view window, like «شغلي»? | technical now; a product point in 61-3, where the card is shown | manager; 61-3's plan | None now. If the manager wants both paths in this PR: add `STAFF_ROUTE = 'staff'`, `PERSONAL_ROUTE = 'staff'`, `@PrivateViewRoute()` and the tips controller's session line, plus one window test (≈ +45 lines) |

No owner answer is guessed. Every other choice is a technical decision listed in `research.md` §3.

## 3. Row 61-2a — design

### 3.1 Flow

`OwnRatingSummaryController` (`@Controller('staff/me')`, `@Get('rating-summary')`, `@Authenticated()`,
`@SetMetadata(PERSONAL_ROUTE, true)`, `@Header('Cache-Control', 'no-store')`, and the tips route's `no-store` error
filter; the context comes from `request.personalSession` only) →
sample the clock once → `database.withTenant(companyId, tx => readOwnRatingSummary(tx, context, query, now, reads),
{ userId })`. One transaction, one connection (`CLAUDE.md` §6 guard budget).

`readOwnRatingSummary` (`queries/own-rating-summary.query.ts`), in order:

1. `reads.context(tx, context, now)` → `null` → `FORBIDDEN`.
2. Subject keys in the raw query → `FORBIDDEN`; then strict parse → `VALIDATION_FAILED`.
3. `reads.allowed(tx, companyId, businessId)` lacks `rating_average` → return `{ visibility: 'HIDDEN' }`. No further
   statement runs.
4. One aggregate statement → `{ visibility: 'VISIBLE', average, count }`, parsed through the contract.

### 3.2 Ports and adapters

| Piece | File | Calls |
|---|---|---|
| Reads token + interface `OwnRatingReads { context, allowed }` and the authority helper | `customers/queries/own-rating-context.ts` | — (shape of `orders/queries/own-work-context.ts`, without the month-range parts) |
| Context adapter | `customers/persistence/own-rating-context.adapter.ts` | `tenancy.describeWorkspaces`, `staff.readOwnEmployee`, `identity.readOwnRatingsAccess` (new), `tenancy.activeBusinessTimeZone`; returns `{ employeeId, timeZone }` or `null` |
| Access reader | `identity/persistence/own-ratings-access.ts`, exported from `identity/index.ts` | `readAccessTransaction`, `readFeatureEnabled(tx, companyId, 'customers', now)`, `evaluateAccess(grants, 'read:ratings:own', …)` — a copy of `own-service-sessions-access.ts` with the feature and the code changed |
| Column gate | existing `customers/persistence/staff-columns.adapter.ts` (`staffColumns.allowed`) | `settings.readStaffColumns` (line already in the module map) |
| Wiring | `customers.module.ts`: controller added to `customersControllers`; providers for the reads token and the clock | — |

Whether `OwnRatingReads` counts as a `ports/` interface: orders keeps the equivalent interface in `queries/` beside its
authority helper. This plan follows that precedent. `pnpm lint:docs` decides; if it requires `ports/`, the interface
moves there with Arabic JSDoc and nothing else changes.

### 3.3 The statement (design, not executed)

- Predicates: `company_id`, `employee_id`, `business_id`, and
  compute local_start = date_trunc('month', now AT TIME ZONE tz). Convert local_start and
  (local_start + interval '1 month') to timestamptz separately with AT TIME ZONE tz. Compare the bare column
  against these half-open bounds. Test DST start and end months in America/New_York and vary the database session
  timezone as well as testing Asia/Kuwait.
- Projection: `count(*)::int` and `round(avg(stars), 1)::text` (text `NULL` when there are no rows).
- One-line Arabic comment above it naming the consuming screen: «كارت متوسط تقييمي في شاشة شغلي (61-3)».

### 3.4 Acceptance criteria — 61-2a (independent of 62-2e)

- **AC-R1** Default settings: any eligible employee, with or without ratings, receives exactly `{ "visibility": "HIDDEN" }`.
- **AC-R2** Column allowed by test injection: 4 and 5 stars → `"4.5"` / `2`; 5,4,4,4 → `"4.3"` / `4`; one rating of 5 →
  `"5.0"` / `1`; none → `null` / `0`.
- **AC-R3** Asia/Kuwait: a row at the last second of the previous month is excluded, a row at the first instant of
  the month is included, a row at the first instant of the next month is excluded.
- **AC-R4** Another employee's rows and another company's rows are never counted.
- **AC-R5** A personal DENY on read:ratings:own, a disabled customers feature, or a business outside the
  company is 403 FORBIDDEN in the authorized read transaction. Ended employment caught by the personal-session
  guard returns 401. A loss of eligibility after the guard is 403 in the read transaction.
- **AC-R6** `?employee_id=…` (and the three other subject keys) → 403; `?x=1` → `VALIDATION_FAILED`.
- **AC-R7** No session → 401. An admin session cookie and a reception-device operator session are not accepted
  (research §2 item 4).
- **AC-R8** `Cache-Control: no-store` on success and on error.
- **AC-R9** `EXPLAIN ANALYZE` of the statement names `rating_attributions_employee_idx`.
- **AC-R10** `settings/domain/staff-columns.ts` is unchanged in the diff, and no hand-written file under `apps/pos`
  changes (its generated `schema.d.ts` does).

## 4. Row 62-2e — design

### 4.1 Write path (record / replace)

| Layer | Change |
|---|---|
| Contract | Reject raw C0/C1 control characters before trimming. Normalize edge whitespace with ECMAScript trim, require 1 to 64 Unicode code points, and accept omitted or null on record. Apply the same policy to the form, with an empty value allowed so it can submit null. |
| Domain | one pure function in `domain/employee-documents.ts` turning «omitted or `null`» into `null` and passing a valid value through, with Arabic JSDoc stating FR-D04 (never copied from the replaced document). `EmployeeDocumentRecord` and `documentView` are unchanged |
| Port | `EmployeeDocumentScope.save(replaced, recorded, documentNumber)` — third argument, JSDoc updated in the same commit, stating that the number is stored only and never enters the audit entry or the event |
| Use case | passes the value through; still contains no SQL and no arithmetic |
| Persistence | the `INSERT` writes the column from the third argument. `snapshot()` and the event payload are not edited |
| Database | CHECK as in `data-model.md` §2. A violation that slips past the contract surfaces as a 500 (broken invariant), not a new typed error |

Blank handling, end to end: form field empty or spaces → form sends `null`; API receives `""` or spaces from another
client → `VALIDATION_FAILED`; omitted → `NULL` stored.

### 4.2 Read paths

- **List** (`queries/employee-documents.query.ts`): add `'document_number', d.document_number` to the item object.
  Send Cache-Control: no-store for the list as well as the lookup. Access is already decided before the statement runs.
- **Lookup** (`queries/employee-document-numbers.query.ts`, new): `access.check` first; then one statement joining
  `employee_documents` to `employees` on `(company_id, business_id, employee_id)` with `d.id = ANY(ids)`,
  explicit `d.company_id = :companyId`, `d.business_id = :businessId`, `d.replaced_at IS NULL`, `e.deleted_at IS NULL`, `d.document_number IS NOT NULL`.
  Reuses the existing `EMPLOYEE_DOCUMENT_ACCESS` provider; no new port, no new arrow, no new `reads` line.

### 4.3 Admin

- **Form**: a text input «رقم المستند (اختياري)» between the file and the expiry date,
  with autocomplete disabled. Enforce the shared code-point validator instead of HTML maxLength. Use translated labels.
- **Table**: a «رقم المستند» column showing the number or «—».
- **Record call**: `document_number: values.document_number === '' ? null : values.document_number` (two lines in
  `use-employee-documents.ts`, which stays under 400 lines; nothing else is added to that file).
- **Bell**: Look up current ids by company, user, business and normalized id set only while the panel is open.
  Cancel the lookup and remove cached values on close, identity, business or id-set changes. Pass AbortSignal and
  reject late results against the active context. Recheck on reopen, notification refresh and known access changes.
  Only a current success may supply a number. Use existing text while loading/refetching, on errors and for absent
  ids. Never keep previous or placeholder data or store numbers in the inbox cache or persistent storage. Clear
  submitted form and mutation values when their scope ends. Test success then revocation, close during pending,
  reopen, identity/business changes and out-of-order results.
- **i18n**: `inApp.document_expiring_numbered` = today's sentence + the number (spec Assumptions).
  `inApp.document_expiring` and the template copy are not edited.

### 4.4 Privacy rules the tests pin (synthetic values only)

Tests use obviously synthetic numbers such as `SYN-DOC-0001`. After the write and bell scenarios, the tests read back
every row written to `audit_log`, `outbox`, `in_app_notifications`, `idempotency_keys` and assert that the synthetic
value occurs in none of them, and that the `POST` response and every error body lack it. No test probes a real
system; no exploit development is part of this work.

### 4.5 Acceptance criteria — 62-2e (independent of 61-2a)

- **AC-D1** Record with `"  SYN-DOC-0001  "` → stored `SYN-DOC-0001`; the list returns it; the `POST` body has no
  `document_number` key.
- **AC-D2** Omitted and `null` → stored `NULL`; `""`, `"   "`, 65 characters, a control character → `VALIDATION_FAILED`
  and no row; 64 characters → accepted.
- **AC-D3** Replace without a number → the new current row is `NULL`; the replaced row still holds its number.
- **AC-D4** Rows that existed before the migration read `NULL`; the list and the bell behave as before for them.
- **AC-D5** Lookup as a holder: returns exactly the current, numbered documents of the path's business among the ids.
- **AC-D6** Lookup without `read:files:business` (never held, or denied after the bell was sent) → 404, the same body
  for existing, foreign and random ids.
- **AC-D7** Lookup omits: another business's id, another company's id, a replaced document, a deleted employee's
  document, a document without a number.
- **AC-D8** Feature `staff` off → `FEATURE_DISABLED`; `ids` empty, 21 ids, a non-UUID, a duplicate → `VALIDATION_FAILED`.
- **AC-D9** Bell UI: the number is visible when the lookup returns it; today's text is visible when the lookup fails,
  is pending, returns nothing for that id, or the item has no `business_id`; the document id is never visible.
- **AC-D10** No request for numbers is made while the panel is closed or when no `document_expiring` item is listed.
- **AC-D11** The synthetic number is absent from audit, outbox, notification and idempotency rows (§4.4).
- **AC-D12** `pospay_app` cannot `UPDATE employee_documents.document_number` (permission denied); the CHECK refuses
  `''`, untrimmed text and 65 characters at the database.
- **AC-D13** `packages/contracts/src/staff-alert-notifications.ts`, `packages/notifications/**` and every production
  file under `apps/worker/**` are unchanged in the diff; a worker test proves a document with a number still produces a six-parameter bell.

## 5. Ordered implementation (one PR, commits in this order)

`CLAUDE.md` §1 order: contract → migration → domain → use case → adapters → integration tests → UI.

| Step | Row | Work | Done when |
|---|---|---|---|
| 0 | both | Cut the branch from the pin. Apply `pending-deltas.md` §3–§4 (ADR-0010 addendum, spec 060 notes) and the two port-table rows of §2 | documents only |
| 1 | 61-2a | Contract + OpenAPI path for the summary; contract spec | contract tests green |
| 2 | 61-2a | `identity.readOwnRatingsAccess` + export | typecheck |
| 3 | 61-2a | Context adapter, reads token, query, controller, module wiring; **in the same commit** the four `reads` lines of `pending-deltas.md` §2 and `pnpm module-map:generate` | RS-01…RS-12 green on the lane cluster; `pnpm module-map:check` passes |
| 4 | 62-2e | Contract changes + OpenAPI; contract spec | contract tests green |
| 5 | 62-2e | Schema edit; migrations built and tested **on the lane's private cluster** with provisional numbers | DN-18…DN-20 green |
| 6 | 62-2e | Domain function, port, use case, persistence | DN-01…DN-08 green |
| 7 | 62-2e | List projection; lookup query, controller, wiring | DN-09…DN-17 green |
| 8 | 62-2e | Admin form, table, bell hook, renderer, i18n | DN-21, DN-22 and the admin specs green |
| 9 | both | `pnpm contracts:openapi`; `api:generate` for admin, pos and menu; local gates (`quickstart.md`) | gates exit 0 |
| 10 | both | Implementer runs `clean-code-guard` and `test-guard`, fixes, reports once | report with findings and their state |
| 11 | 62-2e | **Only on the manager's «lane granted»**: renumber, `pnpm db:generate`, re-run migration and isolation tests | `pnpm migration-chain:check` passes |

Steps 1–3 and 4–8 do not depend on each other; either row can be finished first.

## 6. Tests

Integration tests run against real Postgres, one cloned database per spec file. UI tests assert visible text.

### 6.1 61-2a

| Id | File | Asserts |
|---|---|---|
| — | `packages/contracts/src/customers/own-rating-summary.spec.ts` | both variants; strictness; `average` pattern; `count = 0 ⇔ average = null`; no comment/customer/employee key parses |
| RS-01…03 | `apps/api/src/modules/customers/queries/__tests__/own-rating-summary.query.spec.ts` | result shape; AC-R2 rounding cases; AC-R3 boundaries |
| RS-04 | same | AC-R4 other employee; AC-R9 `EXPLAIN` |
| RS-05 | `apps/api/src/modules/customers/__tests__/own-rating-summary-http.spec.ts` | AC-R1 hidden by default with ratings present |
| RS-06, RS-07 | same | AC-R2 visible and empty, with `allowed` injected through the reads token |
| RS-08 | same | AC-R5 (DENY, ended employment, feature off) |
| RS-09 | same | AC-R6 |
| RS-10 | same | AC-R7, AC-R8 |
| RS-11 | same | cross-tenant: company B's attributions for the same user id are not counted |
| RS-12 | `apps/api/src/modules/identity/__tests__/own-ratings-access.spec.ts` | membership scope, feature, own-code refusal for another subject |

### 6.2 62-2e

| Id | File | Asserts |
|---|---|---|
| — | `packages/contracts/src/__tests__/employee-documents.spec.ts` (extend) | AC-D2 shapes; list item has the key; `EmployeeDocument` does not; lookup query bounds |
| DN-01…04 | `apps/api/src/modules/staff/__tests__/employee-documents.spec.ts` (extend) | AC-D1, AC-D2, AC-D3 |
| DN-05…08 | `apps/api/src/modules/staff/__tests__/employee-document-number-privacy.spec.ts` (new) | AC-D11 for audit, outbox, idempotency; `POST` and error bodies; a forced persistence failure of a record carrying a number answers the plain `INTERNAL_ERROR` envelope and, with the test logger captured, logs no occurrence of the synthetic value |
| DN-09 | `apps/api/src/modules/staff/__tests__/employee-documents-queries.spec.ts` (extend) | list shape with the number; lookup shape; `EXPLAIN` on `employee_documents_pkey` |
| DN-10…17 | `apps/api/src/modules/staff/__tests__/employee-document-numbers-http.spec.ts` (new) | AC-D5…AC-D8, `no-store`, 401 |
| DN-18 | `apps/api/src/modules/staff/__tests__/employee-documents-rls.spec.ts` (extend) | cross-tenant read of the column = 0 rows |
| DN-19, DN-20 | `packages/db/src/__tests__/employee-document-number.spec.ts` (new) | AC-D12 CHECK and grant |
| — | `apps/api/src/modules/staff/domain/__tests__/employee-documents.spec.ts` (extend) | the pure rule |
| — | `apps/worker/src/modules/staff/__tests__/alert-rule-document-expiry.spec.ts` (extend) | AC-D13: six parameters, no number in the event, the audit row or `safe_parameters` |
| DN-21 | `apps/admin/src/staff/ui/employee-document-form.spec.tsx` (new) + table assertion | AC-D1/AC-D2 as the user sees them: the field, the sent body, the visible «invalid» alert, the number in the row, «—» |
| DN-22 | `apps/admin/src/notifications/ui/document-number-bell.spec.tsx` (new) + `render-staff-alert-notification.spec.ts` (extend) | AC-D9, AC-D10 |
| — | `packages/i18n/src/__tests__/staff-alert-bells-catalog.spec.ts` (extend) | the new key in both locales with its placeholders; the old key unchanged |

## 7. Size estimate

Hand-written lines the implementer authors. Generated output is listed separately and does not count toward the
PP-112 «twice the brief» rule. Each figure is an estimate from the files read at the pin, not a measurement.

### 7.1 Production (hand-written)

| File | Row | + | − | Basis |
|---|---|---|---|---|
| `contracts/src/customers/own-rating-summary.ts` | 61-2a | 25 | 0 | `orders/own-tips.ts` is 15 lines |
| `contracts/src/customers/own-rating-summary-openapi.ts` | 61-2a | 45 | 0 | `own-tips-openapi.ts` is 49 |
| `contracts/src/openapi.ts`, index | both | 6 | 0 | two registrations |
| `identity/persistence/own-ratings-access.ts` + index | 61-2a | 46 | 0 | its model is 42 lines |
| `customers/persistence/own-rating-context.adapter.ts` | 61-2a | 45 | 0 | its model is 48 lines |
| `customers/queries/own-rating-context.ts` | 61-2a | 45 | 0 | model is 64 lines, minus the month parts |
| `customers/queries/own-rating-summary.query.ts` | 61-2a | 50 | 0 | `own-tips.query.ts` is 42 |
| `customers/http/own-rating-summary.controller.ts` | 61-2a | 62 | 0 | `own-work.controller.ts` is 68 |
| `customers/customers.module.ts` | 61-2a | 16 | 0 | controller + two providers |
| **61-2a subtotal** | | **≈ 340** | 0 | |
| `contracts/src/staff/employee-documents.ts` | 62-2e | 48 | 6 | scalar, input key, list item, lookup query and response, form key |
| `contracts/src/staff/employee-documents-openapi.ts` | 62-2e | 45 | 2 | one new path, one changed schema ref |
| `contracts/src/__tests__/openapi-schema-names.staff.ts` and the `employeeDocumentSchemas` array | 62-2e | 6 | 0 | new named schemas registered |
| `db/schema/staff-documents.ts` | 62-2e | 8 | 0 | column + check |
| `staff/domain/employee-documents.ts` | 62-2e | 14 | 0 | one function + JSDoc |
| `staff/ports/employee-documents.port.ts` | 62-2e | 6 | 2 | `save` signature + JSDoc |
| `record-employee-document.usecase.ts` | 62-2e | 4 | 1 | |
| `staff/persistence/drizzle-employee-documents.ts` | 62-2e | 8 | 5 | insert column, `save` argument |
| `staff/queries/employee-documents.query.ts` | 62-2e | 2 | 1 | one projection key |
| `staff/queries/employee-document-numbers.query.ts` | 62-2e | 55 | 0 | list query is 63 |
| `staff/http/employee-document-numbers.controller.ts` | 62-2e | 52 | 0 | documents controller is 78 for two routes |
| staff wiring (`staff-records.providers.ts` / `staff.module.ts`) | 62-2e | 6 | 0 | |
| `i18n/src/employee-documents-catalog.ts`, `in-app-catalog.ts` | 62-2e | 12 | 0 | three strings × 2 + one bell string × 2 |
| `admin/src/staff/ui/employee-document-form.tsx` | 62-2e | 10 | 1 | label + input + default |
| `admin/src/staff/ui/employee-document-columns.tsx` | 62-2e | 9 | 2 | one column, item type |
| `admin/src/staff/api/use-employee-documents.ts` | 62-2e | 2 | 0 | 344 → 346 lines |
| `admin/src/notifications/api/use-document-numbers.ts` | 62-2e | 62 | 0 | new |
| `admin/src/notifications/model/render-notification.ts` | 62-2e | 14 | 4 | 225 → ≈ 235 lines |
| `notification-item.tsx`, `notification-panel.tsx`, `notification-bell.tsx` | 62-2e | 14 | 3 | one prop through three files |
| **62-2e subtotal** | | **≈ 377** | ≈ 27 | |
| **Production total** | | **≈ 717** | **≈ 27** | brief figure: **720** (refusal line at 1,440) |

### 7.2 Tests (hand-written)

| Area | Row | Lines |
|---|---|---|
| Contract spec | 61-2a | 40 |
| Query spec (shape, rounding, boundaries, `EXPLAIN`) | 61-2a | 115 |
| HTTP spec | 61-2a | 200 |
| Identity access spec | 61-2a | 45 |
| **61-2a subtotal** | | **≈ 400** |
| Contract spec (extend) | 62-2e | 45 |
| Domain spec (extend) | 62-2e | 12 |
| Record / replace integration (extend) | 62-2e | 90 |
| Privacy spec (new) | 62-2e | 95 |
| Queries spec (extend) | 62-2e | 50 |
| Lookup HTTP spec (new) | 62-2e | 170 |
| RLS spec (extend) | 62-2e | 15 |
| DB CHECK + grant spec (new) | 62-2e | 60 |
| Worker spec (extend) | 62-2e | 35 |
| Admin form + table spec | 62-2e | 95 |
| Admin bell + renderer specs | 62-2e | 150 |
| i18n catalog spec (extend) | 62-2e | 16 |
| **62-2e subtotal** | | **≈ 830** |
| **Test total** | | **≈ 1,230** |

Brief figure for tests: **1,150–1,250**.

### 7.3 SQL, generated files, documents

| Kind | Lines | Note |
|---|---|---|
| Hand-written SQL (two migration files, with Arabic comments) | ≈ 18 | `ADD COLUMN`, CHECK `NOT VALID`, `VALIDATE` |
| Generated: two `meta/*_snapshot.json` | ≈ 61,600 | 30,797 lines each at the pin; PP-126 applies if a panel bot truncates them |
| Generated: `_journal.json` | 14 | two entries |
| Generated: `packages/contracts/openapi/openapi.json` | ≈ 200–300 | two new paths, three schemas |
| Generated: `schema.d.ts` under `apps/admin`, `apps/pos` and `apps/menu` (`src/shared/api/`) | ≈ 120–180 each | each app's `api:check` compares it to the OpenAPI document (menu runs it inside its `typecheck`) |
| Generated: `docs/module-map.yaml` | 3 | from the markdown |
| Documents: `module-map.md`, ADR-0010 addendum, spec 060 notes, `owner-questions.ar.md` entry | ≈ 75 | `pending-deltas.md` |
| Planning artifacts (this folder) | already written | not counted |

**The spec 060 row estimates are superseded for this PR.** Row 62-2e said 200–300 lines; that figure predates the
lookup read, the admin fetch and the privacy tests that AL-Q8's display rule requires. `plan-61.md` gave 61-2a
300–380 for production + tests; the test list above is longer than the one it assumed.

## 8. Gates, review and merge order

| Stage | Who | Rule |
|---|---|---|
| Plan review, once | manager | Done, including Astra design findings and PP-213. DN-Q1 remains a nonblocking follow-up. |
| Implementation + tests | GLM 5.3 Flash through the OpenCode CLI, in a worktree cut from the pin | PP-204; brief states §7 sizes |
| Guards | the same implementer session | `clean-code-guard`, `test-guard` (PP-198) |
| Token counters | the same session | three snapshots: before any code, after implementation + tests, after the guards. Report input, output, reasoning and cache-read/cache-write counters as the CLI prints them, as **deltas between snapshots** so nothing is counted twice; if the CLI exposes no counter, write «unavailable» with the command tried — never an estimate |
| Independent review | Codex Sol 6.2, effort medium, fresh context, with `waleed-security-reviewer` | reads the diff, `spec.md`, `plan.md`, `contracts/api.md`; focus list in `quickstart.md` §4 |
| PR | one PR for 61-2a and 62-2e. State the Medium exception, Sol security review, scope and migration flag. | PP-211 and PP-213 |
| CI | `ci-gate` green on the exact head | PP-113 |
| Bots | Medium reviews under PP-195/PP-202 and CodeRabbit optional under PP-208. Triage comments; at most three rounds. | Exact-head `ci-gate`, different-model whole-diff review and independent Sol security receipt remain gates. |
| Snapshot check | independent confirmation that the snapshots match the schema, **if** a panel receipt is partial only because of `meta/*_snapshot.json` | PP-126 |
| Staging snapshot | Take a fresh staging snapshot before migrate if the staging rollout is authorized. | PP-129 and the 2026-11-17 backup/restore decision |
| Merge | manager, after every gate (PP-201); migration order set by the manager | this PR is independent of 42-4 + 46-2a-S and of 32b-1 + 34-pre-3; only their migrations, if any, order against this one (PP-130) |

Reported state after local gates: «implementation complete, pending `ci-gate`», never «done».

**Rollback**: the previous API and admin images work with the new column present; nothing reads it. No data is
destroyed by rolling back. The column is removed, if ever, by a separate contract-phase migration.

## Complexity Tracking

| Violation | Why needed | Simpler alternative rejected because |
|---|---|---|
| Two rows in one PR (Principle I) | The owner asked for one spec, one plan and one PR for 61-2a and 62-2e | Two PRs would be the default; the rows are kept separable by commit order and by their own acceptance criteria |
