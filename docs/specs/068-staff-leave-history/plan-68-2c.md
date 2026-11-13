# Plan 68-2c — leave-history report routes (acceptance, status and pages)

Spec: [spec.md](spec.md); parent plan [plan-68-2.md](plan-68-2.md) rows D9, D10, D13, D14, D15 (this file refines them
and does not replace them); worker side [plan-68-2b-2.md](plan-68-2b-2.md). Branch `feat/p1-068-2c-leave-report-api`,
base `9622d4fba` (68-2b-2a #981 and 68-2b-2b #982 merged and on staging since 2026-11-12 23:56 Kuwait, worker `/ready`
includes `leave-history-reports`, so the D15 gate is met). Retention is one hour (PP-178). Lanes (PP-178, Waleed
2026-11-12): Claude writes briefs, reviews, runs gates and commits; every line of code and tests is written by a CLI
implementer (Kimi `k3.1-pro` for production, Agy or Grok for tests). No push, PR or merge.

## Scope

In: `POST /v1/businesses/{businessId}/leave-history/reports` (acceptance), `GET …/reports/{reportId}?cursor&limit`
(status and pages), their contracts and OpenAPI, the use case, port, persistence and reader, four error codes plus the
two failure codes, the PP-7.1 write declaration, the staff module wiring, the three regenerated clients. Out: any
worker change, any migration (none: the tables exist), any `apps/admin` screen (68-4), the sync route and the tab.

## Decisions (68-2c)

| ID | Decision | Why |
|---|---|---|
| C1 | **Acceptance order (D9, D10).** In one `withTenant(companyId, …, { userId })` transaction: `access.check(tx, { companyId, userId, businessId, own: false })` (no `employeeId`, no `purpose`) → `null`, no read branch, or empty `eligibilityDays` → 404 `NOT_FOUND`; feature off → `FEATURE_DISABLED`; `branch_id` outside `scope.branches` → 404 → `pg_advisory_xact_lock(hashtextextended(company\|business\|creator, 0))` → look for a `pending` report of the same creator, business and fingerprint with `deadline_at > now` → `202` with its id, no row, no event → count `pending` reports of the creator and business with `deadline_at > now`; 3 or more → `409 LEAVE_HISTORY_REPORT_BUSY` → insert `pending` → id-only outbox event `LeaveHistoryReportRequested { report_id }` (`aggregateType` `leave_history_report`, `aggregateId` the report id) → `202 { report_id }`. `now` is the injected `Clock`; it only chooses reuse or `409`, never a status. | Same order as `getBusinessLeaveHistory` (an unauthorized caller learns nothing), serialized dedupe and cap. |
| C2 | **Stored values.** `as_of` = `Clock.now()`, `deadline_at` = `as_of` + 10 min (`LEAVE_HISTORY_REPORT_DEADLINE_MS`), `expires_at` = `as_of` + `LEAVE_HISTORY_REPORT_RETENTION_MS` (contracts, one hour). `query` is the normalized request parsed by `leaveHistoryReportStoredQuery` (arrays sorted and deduplicated, `branch_id` lower-cased, defaults filled); `scope` is the access result's seven sets, each sorted, `eligibilityBranchIds` = the branch ids of `eligibilityDays`, parsed by `leaveHistoryReportStoredScope`. `fingerprint` = SHA-256 hex of one canonical JSON string of `{ query, scope }` with fixed key order (the pure function is in `domain/`, the hash in persistence, `domain/` imports nothing outside `packages/domain`). | D10: a changed scope changes the fingerprint, so a report that would read `STALE` is never handed back. |
| C3 | **Request body** `LeaveHistoryReportRequest`: strict, `from`, `to`, `types[]`, `statuses[]` (JSON arrays), `branch_id?`, the same range refinement as the query; no `cursor`, `limit` or `employee_id` (a strict object answers 400). Response `LeaveHistoryReportAccepted { report_id }`. | D9. |
| C4 | **Status read order (D13).** Report row lookup by (company, business, `created_by` = caller, id) and `expires_at > now()` → none → `404 LEAVE_HISTORY_REPORT_NOT_FOUND` (an unknown, expired, foreign or another creator's id look the same) → `access.check` as in C1 → `null` or no read branch → 404 `NOT_FOUND`; feature off → `FEATURE_DISABLED` → stale check, branch-id sets only: frozen `branches` ⊆ current `branches`, frozen `attendanceBranches` ⊆ current `attendanceBranches`, frozen `eligibilityBranchIds` ⊆ current `eligibilityDays` branch ids; not a subset → `409 LEAVE_HISTORY_REPORT_STALE` (pure function in `domain/`, unit tested; dates are never compared) → body by status. `pending` and `clock_timestamp() < deadline_at` → `{ status: 'pending' }`. `pending` and past the deadline → `SELECT 1 … WHERE status='pending' FOR SHARE SKIP LOCKED`: no row back (a build holds it) → `pending`; a row back → `{ status: 'failed', error }` with `LEAVE_HISTORY_REPORT_FAILED`. Stored `failed` → `{ status: 'failed', error: { code, message_ar, message_en } }` from the catalogue. The read never writes. | D13 verbatim. |
| C5 | **Ready pages (D13).** `{ status: 'ready', computed_at, items, next_cursor, as_of (frozen), last_taken: null, request_branch_ids (current createBranches), absence_branch_ids (frozen attendanceBranches) }`. Cursor is opaque `{ report_id, seq }` (strict Zod, `seq` integer 0..25,000; a cursor for another report or a malformed one answers 400 on `cursor`). Window rule: read `seq > after AND seq <= after + 1,000` (`LEAVE_HISTORY_REPORT_PAGE_WINDOW`), join `employees e` on (company, business, id = `employee_id`, `deleted_at IS NULL`) with `historyEmployeeVisible(context, scope, 'e', 'current')` (exported from `@pospay/db` by this PR), take at most `limit + 1` visible rows ordered by `seq`; more than `limit` → `next_cursor` = the `limit`-th row's `seq`; otherwise, if `after + 1,000 < row_count` → `next_cursor` = `after + 1,000` (a short, even empty, page); otherwise `null`. | Bounded scan per request, live #901 visibility (PP-171). |
| C6 | **Errors.** New codes `LEAVE_HISTORY_REPORT_BUSY` (409), `LEAVE_HISTORY_REPORT_NOT_FOUND` (404), `LEAVE_HISTORY_REPORT_STALE` (409), `LEAVE_HISTORY_REPORT_FAILED` (500) and `LEAVE_HISTORY_REPORT_TOO_LARGE` (422): the last two appear only inside a `200 failed` body; all five are raised-by-the-API-only (`codeForStatus` never returns them), with Arabic and English messages in `packages/i18n/src/leave-catalog.ts`, as `LEAVE_HISTORY_REPORT_REQUIRED` was. | `CLAUDE.md` §6 error envelope. |
| C7 | **PP-7.1.** The POST is `@Authenticated()` + `SelectedCompanyGuard` and writes, so it is declared in `identity/http/authenticated-writes.ts` as `RECORD_SCOPED`, `checkedIn` the persistence function that calls `access.check`. The GET is the same kind of read as the sync route. No `Idempotency-Key` (no money or stock effect; dedupe replaces it). | `CLAUDE.md` §6, spec "Permissions". |
| C8 | **No-producer scan deleted.** `leave-history-report-no-producer.spec.ts` (plan 68-2b-2 E10) is deleted by this PR; the declaration comment in `events/published.ts` is updated. | E10 said 68-2c deletes it. |

## Files (CLAUDE.md §1 order) and lanes

1. Contracts (Kimi, run K1): `packages/contracts/src/staff/leave-history-report-api.ts` (request, accepted, result
   query, status union, cursor), `leave-history-report-api-openapi.ts` (two paths), `leave-history.ts` (export four
   existing consts), `staff/index.ts`, `openapi.ts`, `openapi-schemas.ts`; the schema names list in
   `packages/contracts/src/__tests__/openapi-schema-names.ts` (add-only).
2. Migration/RLS: none.
3. Domain (K1): `apps/api/src/modules/staff/domain/leave-history-report-request.ts` (normalize, canonical
   fingerprint source, timestamps, the request error) and `leave-history-report-scope.ts` (the stale test).
4. Ports and use case (K1): `ports/leave-history-report-request.port.ts`,
   `use-cases/request-leave-history-report/request-leave-history-report.usecase.ts`.
5. Persistence (K1): `persistence/leave-history-report-request.transactions.ts`.
6. Errors, i18n, PP-7.1, wiring (K1): `apps/api/src/shared/errors.ts`, `packages/i18n/src/leave-catalog.ts`,
   `identity/http/authenticated-writes.ts`, `staff/events/published.ts` (comment), `staff/staff.module.ts`.
7. HTTP acceptance (K1) and reads (run K2): `http/leave-history-report-jobs.controller.ts`;
   `queries/leave-history-report-result.query.ts` (+ a second `queries/leave-history-report-page.sql.ts` if the
   300-line rule needs it); `packages/db/src/index.ts` (one export line); module wiring.
8. Generated (Claude, after the fences close): `pnpm contracts:openapi`, `pnpm --filter @pospay/admin api:generate`,
   the same for `pos` and `menu`.
9. Tests (Agy, fall back to Grok then Kimi): `apps/api/src/modules/staff/__tests__/leave-history-report-request.spec.ts`,
   `leave-history-report-result.spec.ts`, `leave-history-report-result-performance.spec.ts`,
   `leave-history-report-request-http.spec.ts`, `domain/__tests__/leave-history-report-*.spec.ts`,
   `packages/contracts/src/staff/leave-history-report-api.spec.ts`; delete `leave-history-report-no-producer.spec.ts`;
   add the new schema names.
10. Docs (Claude): this plan, `spec.md` implementation note, the openapi artifacts.

## Tests (brief for the tests lane)

Acceptance: 202 stores one pending row (frozen query and scope, `as_of`, deadline `as_of`+10 min, `expires_at`
`as_of`+1 h, 64-hex fingerprint) and one id-only outbox event atomically; the same creator and query again answers the
same id with no new row and no event; a different creator, a different filter, and a changed scope get their own
report; a `ready` or `failed` report is never reused; the 4th pending report answers 409 BUSY and a deadline-expired
`pending` does not count; two concurrent identical requests produce one row (advisory lock) and four concurrent
different requests produce three rows and one 409; the deadline boundary (`deadline_at` equal to now is not
reusable and not counted); unauthorized, foreign-tenant, no-read-scope and out-of-scope `branch_id` are 404 with no
row; feature off is `FEATURE_DISABLED`; body 400s (`employee_id`, `cursor`, `limit`, range over 366 days); warm
acceptance p95 under 200 ms (as 47-1a); the PP-7.1 declaration test.
Status and pages: pending, failed (stored, both codes, message_ar and message_en), pending past the deadline with no
lock (failed) and with a build holding the row `FOR UPDATE` (pending, no `55P03`), `ready` pages over a 25,000-row
report (first, middle, last page, no row lost or repeated, `seq` order), each stale-scope case (a lost read branch, a
lost attendance branch, a lost eligibility branch) and midnight not staling, creator scope (another creator, another
business, another tenant, unknown id, expired id: all `LEAVE_HISTORY_REPORT_NOT_FOUND`), PP-171 detachment (an
employee detached or soft-deleted after the build is skipped; most employees invisible with limit 100 gives short
pages and a window cursor), a cursor for another report and a malformed cursor are 400, access `null` is 404 and
feature off is `FEATURE_DISABLED`, `last_taken` null, `as_of` frozen, `request_branch_ids` current. `EXPLAIN ANALYZE`
on the page statement (no sequential scan on the rows table, plan under 200 ms) and HTTP p95 under 200 ms with
access included on first and late pages of a 25,000-row report with all or most employees invisible and `limit` 100
(§6 budget; PP-165.1). OpenAPI: both paths, operation ids `requestLeaveHistoryReport` and
`getLeaveHistoryReportResult`, schema names. Regression: every `leave-history-*.spec.ts`.

## Gates (local, PP-113)

Contracts typecheck and build, `pnpm --filter @pospay/db build`, `pnpm --filter @pospay/api typecheck`, scoped ESLint,
`pnpm lint:docs`, `pnpm module-map:check`, the new specs and the existing leave-history specs on a private lane
(`node scripts/test-db/lane.mjs up <lane>` after `pnpm --filter "@pospay/db^..." build`; env from `.env.example`).
Full `pnpm check` and the API shards are `ci-gate`'s on the exact head.

## Size estimate (changed lines, additions + deletions)

| Category | Estimate | Refuse above (2x) |
|---|---|---|
| Production (contracts, domain, port, use case, persistence, reader, controller, errors, i18n, wiring) | 500–650 | 1,300 |
| Tests | 700–900 | 1,800 |
| Generated (`openapi.json`, three `schema.d.ts`) | 550–700 | n/a |
| Docs (this file, spec note) | 80–120 | n/a |
| **Total** | **1,850–2,350** | |
