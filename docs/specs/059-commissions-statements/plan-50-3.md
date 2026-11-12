# Plan — row 50-3, commissions bootstrap replay (spec 059)

Status: PROPOSED, waiting for the manager's decision on the split and on Q1/Q2 below. The Astra debate (one round)
runs after that decision, on the agreed scope. No production code written yet.

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
| Tips bootstrap page | `pospay_app`, `withTenant`, one transaction per page: `listCurrentSessionTips`, then per session the tip reducer with its revision guard, then `markEventConsumed` for every event id the reader lists |
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

50-3c needs 50-3a and 50-3b only for its end-to-end tests; 53-2 needs all three.

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
