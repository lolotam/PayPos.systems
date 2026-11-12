# Plan 68-2b-2 — leave-history report: migration, worker job and cleanup (inert)

Spec: [spec.md](spec.md), sub-PR row 68-2. Parent plan: [plan-68-2.md](plan-68-2.md), decisions D11, D12, D14 and D15
(PP-176), which this file refines and does not replace. Branch `feat/p1-068-2b-2-leave-report-worker`, base `origin/main`
`848080ca8` (68-2a #942 and 68-2b-1 #951 merged). Batch PP-168: Astra debates the plan once, Kimi `k3.1-pro` writes the
production code, Agy `gemini-3.8-flash-high` writes the tables and the tests, Claude briefs, reviews, runs gates, commits.
No push, PR or merge.

## Scope

In: the two tables with RLS, grants, guard triggers and indexes (one migration); the worker's `leave-history-report`
build (processor, use case, port, transactions adapter); the hourly per-company cleanup (processor, use case, adapter);
`LeaveHistoryReportRequested` registered as a known event type of the staff worker module; the job, event, stored-query and
stored-scope shapes in `packages/contracts`; the readiness entry for both processors; an API-side `published.ts`
declaration; the production-wiring tests; the ADR-0034 addendum and the ADR-0010 event line.
Out: any route, acceptance use case, status or page reader, OpenAPI path, error-catalogue entry or `apps/admin` change
(68-2c); any producer of the event. Nothing in production can create a report, so the consumer stays inert until 68-2c.

## Decisions (68-2b-2)

| ID | Decision | Why |
|---|---|---|
| E1 | **Table shape.** `leave_history_reports`: `company_id`, `id` (PK `(company_id, id)`), `business_id`, `created_by` (FK `user`), `query jsonb`, `fingerprint text`, `scope jsonb`, `as_of timestamptz`, `deadline_at timestamptz`, `status text` (`pending`/`ready`/`failed`), `error_code text`, `row_count integer`, `computed_at timestamptz`, `created_at timestamptz default now()`, `expires_at timestamptz`. `leave_history_report_rows`: `company_id`, `report_id`, `seq integer` (PK `(company_id, report_id, seq)`), `employee_id uuid NOT NULL` (no FK), `record jsonb NOT NULL`; composite FK `(company_id, report_id)` to the report `ON DELETE CASCADE`. Everything else is D11 unchanged (grants, triggers, RLS `ENABLE`+`FORCE`, indexes `(company_id, business_id, created_by, fingerprint, deadline_at)` and `(company_id, expires_at)`). Every FK column gets the index the repo's FK guard demands (`created_by`, business). | D11 left names open; the worker SQL and the tables must agree. |
| E2 | **Stored shapes live in `packages/contracts`** (`staff/leave-history-report-job.ts`, strict Zod, not OpenAPI components): `leaveHistoryReportRequested { report_id }`, `leaveHistoryReportJob { companyId, reportId }`, `leaveHistoryReportStoredQuery { from, to, types[], statuses[], branch_id? }` (no cursor, limit or employee), `leaveHistoryReportStoredScope { branches, attendanceBranches, cancelBranches, decideBranches, revokeBranches, createBranches, eligibilityBranchIds }` (uuid arrays), `LEAVE_HISTORY_REPORT_ROW_CAP = 25_000`, `LEAVE_HISTORY_REPORT_RETENTION_MS = 3_600_000` (PP-178), failure codes `LEAVE_HISTORY_REPORT_FAILED` and `LEAVE_HISTORY_REPORT_TOO_LARGE`. The API (68-2c) writes them and the worker parses them, so one definition serves both. | One source for both sides; the worker cannot import `apps/api`. |
| E3 | **Builder inputs.** The worker builds `LeaveHistoryContext { companyId, userId: created_by, businessId, own: false }`, the `LeaveHistoryBuilderQuery` from the stored query (`limit` is a placeholder the INSERT ignores), and a `HistoryScope` from the stored scope with `now = as_of`. `eligibilityDays` is computed in the build transaction as `{ branchId, today }` for each stored eligibility branch, `today` = the branch's (else the business's) local date of the transaction time (`now()`), the same rule as the API's `branchDays`. `asOf` passed to `historyRows` is `as_of`; `excludeOpen` is `false`; `visibility` is `'current'`. A stored query or scope that fails its schema, or a missing branch, is a permanent `LEAVE_HISTORY_REPORT_FAILED`. | D12; `HistoryScope` needs dated eligibility. Page reads re-apply visibility live (D13), so the stored rows only need to be a superset at build time. |
| E4 | **Build transaction (D12).** One `withTenant(companyId, tx => …, { userId: created_by, timeoutMs })`: `SELECT … FOR UPDATE` the report where `status='pending'`; none → return (nothing to do); found but `clock_timestamp() >= deadline_at` → conditional `UPDATE … SET status='failed', error_code='LEAVE_HISTORY_REPORT_FAILED' WHERE status='pending'`, commit, return; otherwise `historyRows` + `INSERT … SELECT row_number() OVER (ORDER BY date DESC, rank, id DESC), (record->>'employee_id')::uuid, record FROM rows ORDER BY date DESC, rank, id DESC LIMIT 25001`, count the inserted rows by the PK range; more than 25,000 → throw a named refusal (rollback); else conditional `UPDATE … SET status='ready', row_count, computed_at=clock_timestamp(), error_code=NULL WHERE status='pending' AND clock_timestamp() < deadline_at`; zero rows updated → named deadline refusal (rollback). `timeoutMs` is the constant `LEAVE_HISTORY_REPORT_BUILD_TIMEOUT_MS = 60_000` bound at wiring and passed through the adapter constructor (placeholder; the run on the 68-2a performance fixture is recorded in the receipt, the final value is ten times that run). | D12 verbatim. |
| E5 | **Failure protocol (as `package-preview.processor.ts`).** Named size refusal → a short transaction marks `failed` `LEAVE_HISTORY_REPORT_TOO_LARGE`, no retry. Named deadline refusal, a `TimeoutError` from `withTenant`, or a permanent input error → `failed` `LEAVE_HISTORY_REPORT_FAILED`, no retry (a rerun would repeat the same cost). `CommitOutcomeUnknownError` → re-read the row: `ready` wins and nothing is written; `failed` stands; still `pending` is retried like any transient error. Any other error → `LeaveHistoryReportRetryError` (no cause, no message from the driver) so BullMQ retries (3 attempts, exponential 2 s); the last attempt saves `{ stage: 'finalizing-leave-history-failure', code }` in job progress and finalizes with `moveToDelayed` + `DelayedError` while the failure write fails; every failure write is `UPDATE … WHERE status='pending'`. `removeOnComplete: true`, `removeOnFail: 100`, `concurrency: 1`, `jobId` = outbox event id. | D12; 47-1b pattern. |
| E6 | **ANSWERED (PP-179, Waleed, 2026-11-12 before 18:15 Kuwait, direct card under PP-117; [owner-questions.ar.md](owner-questions.ar.md) §17): «عدّ الصفوف الأول».** Inside the same build `withTenant` transaction, after the lock and the deadline check and before the build, the worker runs a bounded count over the same frozen scope and `as_of` (`SELECT count(*) FROM (<rows> LIMIT 25001)`, never a full count). A count above 25,000 refuses: the report is marked `failed` `LEAVE_HISTORY_REPORT_TOO_LARGE` by the existing short conditional transaction, with no build. The in-build 25,001 cap stays as the race backstop. A timeout during the count or the build still ends as `LEAVE_HISTORY_REPORT_FAILED`. Cost note: the count shares the `days` CTE cost with the build, so a heavy report pays about twice; this is the owner's choice. The `TODO(spec)` of D12 is closed. |
| E7 | **Delivery and scheduling.** `LeaveHistoryReportRequested` is added to the staff worker's `eventTypes`. `deliver` for that type runs `cleanup.deliver(event, () => reports.deliver(event))`: the cleanup scheduler upserts `leave-history-report-cleanup-<companyId>` (`every: LEAVE_HISTORY_REPORT_RETENTION_MS`) before the event is acknowledged (as `employee-import-recovery.processor.ts`), then `reports.deliver` validates `{ report_id }` against `event.aggregateId` and enqueues `jobId: event.id` on queue `leave-history-report`; a mismatched event marks the report `failed` `LEAVE_HISTORY_REPORT_FAILED` (retry on a failed write) and is not retried. | D14, D15. |
| E8 | **Cleanup (D14).** Queue `leave-history-report-cleanup`; per company, inside `withTenant`, delete reports where `expires_at <= now()` in batches of 20 reports chosen `FOR UPDATE SKIP LOCKED` (a build holding the row is left for the next run), looping until a batch deletes none or 50 batches ran; each batch is its own transaction with a 30 s `timeoutMs`; rows leave by the cascade. | A report can hold 25,000 rows; the batch keeps each delete short. |
| E9 | **Readiness (D15).** `startStaffWorker` returns `reportsReady()` awaiting the build and cleanup workers; `main.ts` adds one readiness entry `leave-history-reports`. The existing staff processors are not added to `/ready` (out of scope). | D15 needs `/ready` to wait on both processors without changing the existing checks. |
| E10 | **No producer.** The API gets only the type declaration in `staff/events/published.ts`; no use case, controller, route, OpenAPI path or `outbox` insert of this type exists. A test scans `apps/api/src` (non-test files) and fails if `LeaveHistoryReportRequested` or `leave_history_reports` appears outside that declaration, and asserts the OpenAPI document has no `/leave-history/reports` path. | D15. |

## Files (CLAUDE.md §1 order) and lanes

1. Contracts (Kimi): `packages/contracts/src/staff/leave-history-report-job.ts`, one export line in `staff/index.ts`.
2. Schema and migration (Agy, then Claude runs `pnpm db:generate`, then Agy appends the custom SQL):
   `packages/db/schema/staff-leave-history-reports.ts`, `schema/index.ts` (add-only), the generated
   `migrations/0221_…_leave-history-reports.sql` and `meta/` (0222 after the renumber at the migration lane),
   `packages/db/test/tenant-table-inventory.ts` (add-only), a grants fixture if the existing one is closed over tables.
3. Domain: none (the SQL lives in `packages/db`, the rules in the one use case).
4. Worker production (Kimi), under `apps/worker/src/modules/staff/`: `ports/leave-history-report.port.ts`,
   `use-cases/build-leave-history-report/build-leave-history-report.ts`,
   `use-cases/clean-leave-history-reports/clean-leave-history-reports.ts`,
   `persistence/leave-history-report.transactions.ts`, `persistence/leave-history-report-cleanup.transactions.ts`,
   `jobs/leave-history-report.processor.ts`, `jobs/leave-history-report-cleanup.processor.ts`, `staff.module.ts`
   (add-only wiring), `index.ts` (no export change expected); `apps/worker/src/main.ts` (one readiness entry).
5. API declaration (Kimi): `apps/api/src/modules/staff/events/published.ts` (one documented interface).
6. Tests (Agy): `packages/db/src/__tests__/leave-history-reports-{rls,grants,guard,fk,cascade}.spec.ts` (runtime
   roles: cross-company FK writes, cascade, post-completion mutation refused, concurrent insert and completion, rows
   `UPDATE`/`DELETE` refused); `apps/worker/src/modules/staff/__tests__/leave-history-report-{job,failure,deadline,snapshot,cleanup}.spec.ts`
   and the processor specs next to the processors; `apps/worker/src/shared/otp-startup.spec.ts` (add the readiness
   case); `apps/worker/src/outbox/__tests__/known-event-types.spec.ts` (staff type present); `packages/contracts/src/staff/leave-history-report-job.spec.ts`;
   `apps/api/src/modules/staff/__tests__/leave-history-report-no-producer.spec.ts`.
7. Docs (Claude): this plan, `debate-68-2b-2-astra.md`, `owner-questions.ar.md` §17, `spec.md` (68-2b-2 note),
   `docs/adr/0034-employee-import-framework.md` addendum, `docs/adr/0010-phase-1-ports-and-events.md` event line,
   `docs/module-map.md` only if a new arrow appears (none expected).

## Tests (Agy brief)

Tables: RLS negative per table (cross-tenant read 0 rows, write error); grants (`pospay_app` only; no `UPDATE` on rows,
no direct `DELETE` on rows, `UPDATE` only on the four report columns); triggers (insert only `pending` with `row_count`
0; `pending → ready` requires the count to match; `pending → failed` with no rows; `ready` and `failed` immutable; columns
outside the grant unchanged; a row insert refused unless the parent is `pending`; concurrent row insert and completion);
composite-FK cross-company refusal; cascade delete.
Worker: ready on a seeded fixture (rows ordered `(date DESC, rank, id DESC)`, `seq` contiguous, `employee_id` equals the
record's, `row_count` correct); the snapshot rule (a leave approved and an attendance correction between acceptance and
the build appear as approved; `as_of` unchanged); redelivery writes nothing; a `pending` report past `deadline_at` is
marked failed and not computed; a build crossing the deadline rolls back and is `failed`; 25,001 rows →
`LEAVE_HISTORY_REPORT_TOO_LARGE` with no rows left; `TimeoutError` → `LEAVE_HISTORY_REPORT_FAILED`; lost commit reply
(`ready` wins); failed failure write retried by `moveToDelayed`; a `failed` report is never turned `ready`; cleanup
deletes only expired reports of its company, rows cascade, a locked report is skipped; scheduler registered before the
event is acknowledged; mismatched event payload.
Wiring: readiness fails (503, `leave-history-reports` down) when either queue's worker is not ready; both queue names are
constructed; no producer (E10); the staff type is in `knownEventTypes`.

## Gates (local, PP-113)

`pnpm --filter @pospay/contracts typecheck`/build, `pnpm --filter @pospay/db` build, typecheck, lint and the new db
specs on a private lane (`node scripts/test-db/lane.mjs up <lane>`; private Redis, never 6379), `pnpm --filter
@pospay/worker` typecheck, lint and the new specs, `pnpm --filter @pospay/api` typecheck and the new spec,
`pnpm lint:docs`, `pnpm module-map:check`; then `clean-code-guard` and `test-guard`. Full `pnpm check` and the API
shards are `ci-gate`'s on the exact head.

## Size estimate (changed lines, additions + deletions; the drizzle snapshot JSON excluded as generated)

| Category | Estimate | Refuse above (2×) |
|---|---|---|
| Production (contracts, worker, API declaration, main.ts) | 450–600 | 1,200 |
| Migration (schema file, SQL) and test helpers | 260–340 | 680 |
| Tests | 650–850 | 1,700 |
| Docs (this file, debate record, owner question, spec note, two ADR lines) | 150–200 | n/a |
| **Total** | **1,500–2,000** | |

The parent plan's 1,200–1,700 for this sub-PR did not count the migration helpers or the contracts file; the manager
should accept 1,500–2,000 or split the cleanup job into its own PR.

## Deploy order and rollback (D15)

This PR ships the tables, the consumer, the cleanup and the known type with no producer. 68-2c merges only after this is
on staging with `/ready` including `leave-history-reports`. Rollback floor: the API first, then the worker. Migration
numbering, `db:generate` and push wait for the manager's «lane granted».

## Debate round (stand-in) and changes applied

Astra `gpt-6-astra` was out of quota ("usage limit", resets 2026-11-14 11:20), so one round was run with `pospay-advisor`
as a **non-binding stand-in** ([debate-68-2b-2-astra.md](debate-68-2b-2-astra.md)). Its 16 findings (2 P1, 12 P2, 2 P3),
all accepted, change the plan as follows (these override the E-rows above where they differ):

- E3: `today` per eligibility branch is the branch-local date of `as_of` (not `now()`); a branch with no usable timezone is
  dropped like the API's `branchDays`, not a failure. The `'current'` visibility literal is a named constant in the worker.
- E4: `created_by` is read inside the transaction and `app.user_id` set after the lock (`set_config`, as the model); the
  deadline is read in a second statement after the lock; the row cap is injected at wiring (default 25,000) so tests can
  use a small cap; the failure `UPDATE` carries its own `timeoutMs` and, on timeout, falls to `moveToDelayed`.
  No connection drain exists (`main.ts` does not use `boundedTenantTransactions`); stated, not promised.
- E5: SQLSTATE `57014` and `25P03` are permanent `LEAVE_HISTORY_REPORT_FAILED` like `TimeoutError`. The failure mapping and
  cap comparison are a pure `domain/leave-history-report.ts` function with unit tests (CLAUDE.md §4.2). A sanitised log line
  (code only) for a swallowed build error.
- E1: CHECKs (status, state shape, `row_count` 0..25000, `octet_length` caps on `query` and `scope`); `fingerprint` is a
  fixed 64-hex digest; reports get SELECT, INSERT, UPDATE, DELETE policies, rows get SELECT and INSERT only; REVOKE from
  `PUBLIC, pospay_app, pospay_auth, pospay_dispatcher, pospay_notifications`. The cascade spec runs as `pospay_app` under FORCE
  RLS; if it fails the fallback is a `DELETE` grant on rows (reported, not silent).
- E8: batches of 2 reports; the schedule interval has its own constant `LEAVE_HISTORY_REPORT_CLEANUP_EVERY_MS = 3_600_000`.
  A lost scheduler (Redis flush) leaves expired reports until that company's next event: accepted.
- E9: `otp-startup.spec.ts` mock gains `reportsReady` and its name list is updated; the per-queue readiness proof is a
  separate spec on the real `startStaffWorker` with a bullmq mock (both queue names constructed, 503 per queue).
- E10: the no-producer scan is deleted by 68-2c.
- Tests added: invalid stored query/scope; two concurrent builds; job after cleanup deleted the report; scheduler-upsert
  and `queue.add` failures; eligibility at a midnight/timezone boundary; cross-tenant UPDATE/DELETE 0 rows; a row insert
  naming another tenant's report; exactly-cap and cap+1 (small injected cap); deadline seam by `pg_sleep` in a held lock;
  the timeout calibration on a near-cap fixture recorded in the receipt.
- Size: tests 1,100-1,500, total 2,000-2,600 (the manager accepts this, or takes the cleanup split, which must still land
  before 68-2c per D15).

## Manager decisions (2026-11-12)

Size accepted at 2,000-2,600 as one PR (stop and report before committing above 3,400); the advisor stand-in is accepted as
non-binding; the migration is 0222 (renumbered at the lane, after 0221 package-extensions) and «lane granted» comes at the final step; the oversized-report
question is §17 (renumbered, PR #958 owns §16) and stays PENDING while the recommended behaviour is built.

## PP-179 delta (2026-11-12)

E6 above replaces the "no pre-count" behaviour. Tests added: over the cap -> `TOO_LARGE` with zero rows; exactly the cap ->
builds; timeout (count or build) -> `FAILED`; an `EXPLAIN` on the count following the slice's EXPLAIN pattern. The cap is
injectable at wiring (E4), so tests use a small cap instead of 25,000 real rows; that is recorded in the receipt. The 3,400
stop line still applies.
