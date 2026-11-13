# Plan — row 50-3, commissions bootstrap replay (spec 059)

Status: split APPROVED by the manager 2026-11-12 (Q1 = option 1, Q2 = option 1, Q3 as written). 50-3a is built first, then 50-3b, then 50-3c, one PR each; the six-type post-rollback replay with its index is a fourth sub-PR, 50-3d (approved 2026-11-12, migration lane), and 53-2 needs all four.
Q1 (move the `listCurrentSessionTips` SQL builder to `packages/db`, byte-identical, api keeps a thin wrapper) belongs to 50-3b; Q2 (pure comparison in `packages/commissions-engine`) belongs to 50-3c; Q3 (operator-supplied `BUSINESS_IDS`/`FROM`/`TO`, documented in the runbook) belongs to 50-3b.

Inputs: spec D-8, D-9, D-15, D-27, CM-20b, CM-24, CM-25, FR-018b, FR-020, the 50-3 row (CS-Q41..CS-Q44, PP-185),
ADR-0012, ADR-0041 §6, ADR-0054 §4, `docs/runbook.md` 35b-2.

## What exists (merged dependencies)

- 50-0: `commissionInputReplayPage(companyId, afterId, throughId, limit)` on `createOutboxDispatcherDatabase`
  (`pospay_dispatcher`, read-only, own transaction, four types, UUID keyset, fixed upper bound, no `consumed_events` join).
- 50-1/50-2: worker consumer `commissions.project-inputs` (`createCommissionInputsConsumer`), handlers for lines, tips,
  salaries; salary handler already resolves a legacy event through `employeeBusiness` (`readEmployeeBusiness`,
  `apps/worker/src/modules/staff`), and a null result throws before any write (the event stays unmarked).
- 36-5: `listCurrentSessionTips(tx, companyId, businessId, range, page)` in `apps/api/src/modules/orders` (api only).
- Projection revision columns: `commission_line_heads.revision`, `commission_tip_heads.revision`,
  `commission_salaries.revision`. Authoritative sources: `service_lines.revision`, `session_tip_revisions.revision`,
  `employee_salaries.revision`.
- `createDeliverer` applies every consumer registered for an event type. The replay therefore builds its own deliverer
  with the commissions consumer alone (the 35b-2 script does the same), and never touches `published_at`.

## Transaction and role per step

| Step | Role and transaction |
| --- | --- |
| Page read of lines/salaries events | `pospay_dispatcher`, one read-only transaction per page, through `commissionInputReplayPage` only |
| Apply one replayed event | `pospay_app`, `withTenant(companyId)`, one transaction per event: `markEventConsumed` then `consumer.handle`, via the commissions-only `createDeliverer`; a failed handle rolls the mark back |
| Tips bootstrap | `pospay_app`, `withTenant`: one read-only transaction per page (`listCurrentSessionTips`), then one tenant transaction per visit: `markEventConsumed` for every event id the reader lists (in the live delivery order), then the tip reducer with its revision guard; a failed visit rolls back its own marks and projection, and visits already committed stay committed |
| Coverage reads | `pospay_app`, `withTenant`, read-only: orders line reader, staff salary reader, tips reader against the projection heads; no write, no lock |
| Legacy `SalaryChanged` (CS-Q44) | same transaction as its delivery: `readEmployeeBusiness`; `null` leaves the event unmarked and is counted in the report |

No new role, grant, `SECURITY DEFINER` function or `BYPASSRLS`. No migration is planned.

## Files (all sizes are changed production lines, tests excluded)

Worker commissions: bootstrap runner for lines and salaries (checkpoint, counts, upper bound) ~110; tips bootstrap ~110;
coverage use case and report ~130; projection-side coverage readers ~80; ports ~70; wiring in `commissions.module.ts`
and `index.ts` ~25; operator entry used by the runbook ~40.
Orders (worker side): tips reader binding ~30 plus the moved SQL builder ~140 (see Q1); service-line coverage reader ~70.
Staff (worker side): salary history coverage reader ~55.
Docs: ADR-0054 §4 addendum, `docs/module-map.md` §3 Port rows (two root readers), `docs/runbook.md` 50-3 section
(upper-bound capture after every replica runs the consumer, checkpoint and counts, «after any rollback then upgrade,
re-run the replay with a new upper bound», remedy by re-running the replay for a missing line or salary).

Estimate: about 690 production lines plus the 140-line SQL move, far over the row's 300–420.

## Proposed split (each sub-PR inside the row's size)

| Sub-PR | Scope | Production lines |
| --- | --- | --- |
| 50-3a | Replay runner for lines and salaries through the commissions-only deliverer, CM-25 backfill run and legacy-salary null path, runbook replay section with item (a) and (d) | ~200 |
| 50-3b | Tips bootstrap (reader binding, revision guard, discharge of event ids), CM-24 race test for tips, runbook tips section | ~315 |
| 50-3c | Coverage: orders line reader, staff salary reader, tips coverage, projection readers, report, ADR-0054 §4 addendum, module-map Port rows, CM-24 coverage tests for lines and salaries | ~375 |

50-3c needs 50-3a and 50-3b only for its end-to-end tests; 53-2 needs all four (50-3a, 50-3b, 50-3c and 50-3d).

## Open design questions for the manager

- **Q1 (blocks 50-3b and 50-3c).** The only tips reader lives in `apps/api` orders, but the tip projection scope and the
  consumer live in `apps/worker`, and the worker does not import `apps/api`. Options:
  1. (recommended) Move the SQL builder and row grouping of `listCurrentSessionTips` to `packages/db` (precedent: 68-2b-1
     moved the leave-history builder), keep the api orders export as a thin wrapper, and add a worker orders reader that
     calls the same builder; the bootstrap runs from the worker like 35b-2.
  2. Copy the SQL into the worker orders module (smaller diff, two copies that can drift; the comment in the worker
     customers handler is the precedent).
  3. Run the tips bootstrap in the api and project through a second projection writer there (duplicates the reducer; rejected).
- **Q2 (blocks 50-3c).** 53-2's approve use case runs in `apps/api`, the report runs in the worker. Options:
  1. (recommended) Put the pure coverage comparison (rows of identity plus orders revision against rows of identity plus
     projection revision) in `packages/commissions-engine`, used by the worker report now and by 53-2 later with api-side
     readers bound in `app.ts`; 50-3c ships only the worker adapters and the pure function.
  2. Keep the comparison in the worker only and let 53-2 duplicate it.
- **Q3 (no block).** The tips reader needs a business id and a date range, and no enumerator exists. Recommended: the
  operator passes `BUSINESS_IDS`, `FROM` and `TO` from the release inventory, as 35b-2 passes company ids and counts.

## Tests (Agy lane, after the split is agreed)

CM-24: a tip revision written between a page read and the first live delivery still ends in the projection; a lower or
equal revision is ignored; event ids are discharged; lines replayed whether published or not; approval inputs report a
missing line. CM-25: a legacy `SalaryChanged` is applied once to the employee's business, a repeat adds nothing, a null
business leaves the mark absent. Replay uses only the 50-0 facade (no `published_at` or `consumed_events` reset). Coverage:
missing, stale and ahead rows for lines, salaries and tips; tenant isolation. DB tests on a private cluster, one at a time.

## Shared files touched (add-only)

`apps/worker/src/main.ts` only if the operator entry is wired there (not planned), `apps/worker/src/modules/orders/index.ts`,
`apps/worker/src/modules/staff/index.ts`, `apps/api/src/modules/orders/index.ts` only under Q1 option 1 (wrapper over the
moved builder). `orders.module.ts` and `identity/index.ts` are not touched.

## 50-3a scope (built first; revised after the Fable debate, `debate-50-3a-fable.md`)

Files (production, about 200 lines):
- `apps/worker/src/modules/commissions/jobs/replay-commission-inputs.ts`: `runCommissionInputReplay(deps, cursor)` and
  `recordCommissionFailureCodes(consumer, sink)`. Exported from the module `index.ts` (add-only).
- `apps/worker/src/replay-commission-inputs.ts`: explicit operator entry (not imported by `main.ts`), modelled on
  `recover-rating-claims.ts`; it builds the consumer with the same three readers as `main.ts` (`businessTimeZone`,
  `readEmployeeBusiness`, `businessCalendar`), a commissions-only `createDeliverer`, and prints one JSON result.

Behaviour of the runner:
- Reads only through `commissionInputReplayPage` (`pospay_dispatcher`, read-only). Asserts `event.companyId` equals the requested company and the
  event type is one of the four; otherwise throws a typed error. Never writes `published_at`, `attempts`, `parked_at`, `next_attempt_at`,
  `last_error` or `consumed_events` itself; the only writes are the consumer's, in `pospay_app` `withTenant`, through `createDeliverer`.
- The deliverer swallows the thrown error, so the caller wraps `consumer.handle` with `recordCommissionFailureCodes`, which records the error's
  `code` per event id and rethrows. The runner reads that sink.
- A not-delivered event whose code is in the closed allowlist (`COMMISSION_EMPLOYEE_BUSINESS_MISSING` (CS-Q44), `COMMISSION_LINE_EVENT_INVALID`,
  `COMMISSION_TIP_SALARY_INPUT_INVALID`, `COMMISSION_BUSINESS_MISSING`, `COMMISSION_PERIOD_CLOSED`) is listed in `undelivered`
  (event id, type, code only, never the payload; capped at 200 with a `truncated` flag) and the runner continues. Any other failure stops the run
  with `ABORTED` and the checkpoint.
- Result `{ status, afterId, handledThroughId, throughId, counts, undelivered, truncated }`; `status` is `COMPLETE`, `UNDELIVERED` (finished,
  list not empty), `PAGE_LIMIT` (100 pages of 100 per invocation, resume from `afterId`) or `ABORTED`. `afterId` is the safe resume cursor and
  stops before the first undelivered event; `handledThroughId` is the last handled event. The entry exits non-zero unless `COMPLETE`.
- Resume with `AFTER_ID` and `THROUGH_ID` applies to `UNDELIVERED` too: after fixing the cause, resume from the safe `afterId`; a re-run from the
  beginning with the same `THROUGH_ID` is also valid. Marks make the re-run idempotent. `AFTER_ID` without `THROUGH_ID` is refused.

Runbook section `50-3a` (add-only, `docs/runbook.md`): the entry command and its env (`DATABASE_URL`, `DISPATCHER_DATABASE_URL`), capturing the
upper bound only after every worker replica runs the consumer (item a), that `THROUGH_ID` is an id bound and not a commit-order proof so live
delivery covers rows that commit behind the cursor, the statuses above, the legacy salary outcome (CS-Q44: unmarked, approval closed, manager
investigates), the «after any rollback then upgrade, re-run the replay with a new upper bound» step (item d, CS-Q43), the noisy "parked" log line
for rows with many attempts (nothing is written), and that an unmarked event aimed at an APPROVED month stays undelivered by design.

Tests (Agy): a fast unit spec with fakes (deterministic failure continues, unknown failure aborts, counts, fence, page limit, empty company,
`afterId == throughId`, no payload in the result); a DB spec through the real 50-0 facade and the real consumer (CM-25 backfill of a legacy salary
applied once to the employee's business and a repeat adds nothing; a legacy salary of an unknown employee is undelivered and unmarked; CM-24
published, unpublished and parked line events replayed, a live event of equal or lower revision ignored; full re-run after a continue delivers the
previously failed event; one employee's salaries applied in reverse date order; replay and live `dispatchBatch` of the same event give one effect
and one mark with `published_at` set only by the live path; no change to `published_at`, `attempts`, `parked_at`, `next_attempt_at`, `last_error`;
an event committed behind the cursor lands through live delivery; tenant isolation).

## Sub-PR record (53-2 depends on 50-3a, 50-3b, 50-3c and 50-3d)

50-3a replay runner and runbook replay section; 50-3b tips bootstrap and the shared tips SQL builder; 50-3c coverage readers, report, pure
comparison, ADR-0054 §4 addendum and Port rows.

## Post-rollback replay of all six counted types (manager request 2026-11-12, PR #980 findings)

Placement after the second advisor round: its own sub-PR **50-3d**, not 50-3a (delivered) and not 50-3b (a migration would put the whole
tips PR on the migration lane, and the facade does not depend on tips). A current-state reader is bound to the business and date range the
operator supplies and to the revisions that exist when it runs, while the ADR-0012 count is company-wide, so rows published later or outside that
scope would keep approval closed. The post-rollback run therefore replays the retained events of all six counted types with one fixed upper
bound through a six-type facade with its own partial index (the existing 50-0 index covers four types), a migration of index only. Until 50-4
registers the `PackageSaleChanged` handler the runner reports those rows as not handled and never prints `COMPLETE` (the deliverer would
otherwise count a type with no registered consumer as delivered). Every re-run path has an upper-bound contract (runbook), and each bootstrap
reader proves that every retained event id is returned (the 50-3c report lists retained counted event ids without a mark). The six-type run keeps
the same result line and resume contract as 50-3a.

Sizes: 50-3a about 240 production lines (delivered); 50-3b about 315 (tips bootstrap 110, shared SQL builder move 140, glue 30, runbook);
50-3c about 375; 50-3d about 100 production lines (facade 40, schema 5, runner mode and entry flag 50) plus the migration and tests, band 200-300.
Dependencies: 53-2 needs 50-3a, 50-3b, 50-3c and 50-3d; 50-3d needs 50-3a and 50-0; 50-4 owns the `PackageSaleChanged` handler and its delivery test.

Addendum 2026-11-13 (PR #998 review, fix round 1): the tips bootstrap changed from one transaction per page with a savepoint per visit to one read transaction per page plus one tenant transaction per visit. Reasons: (1) lock order: live delivery claims `consumed_events` first and then takes the session lock and the period locks, so the bootstrap claims every listed event id before it projects; (2) lock retention: releasing a savepoint does not release `pg_advisory_xact_lock` or the period locks, so a page-wide transaction kept one visit's locks while it moved to the next and could deadlock against live delivery. Counts: `counts.sessions` is the number of committed visits and `counts.events` the number of event ids newly claimed by the run; ABORTED keeps the visits committed before the failure.

Addendum 2026-11-13 (manager decision, 50-3c scope): "tip coverage by revision + tip event-id check" moves from 50-3c to 50-3d. The
deferred scope is the tip projection heads against the tips reader's revisions, and every retained `SessionTipsChanged` event id
carrying the consumer mark. Both need the six-type retained-event facade that 50-3d builds, so they are deferred rather than
dropped. 50-3c ships the lines, the salaries and the four-type unmarked-event check only, and 50-3d's scope now lists the tip
coverage by revision and the tip event-id check.
