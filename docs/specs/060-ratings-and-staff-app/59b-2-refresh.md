# 59b-2 — remaining-work refresh

Date: 2026-11-06 (Asia/Kuwait).
Baseline: `3fc65c268377ca01dd48e98f67529f7e16e72a97` (`origin/main`).
Branch: `feat/59b-2-claim-completion`.
Worktree: `F:/Dev/Worktrees/PosPay/59b-2-claim-completion`.

## Already on main

- 59b-2a: `ClaimRatingRequest` locks customer then request, rechecks opt-out,
  switch and schedule, snapshots attribution and the token version, and atomically
  sets `SENDING` with `RatingRequestReady`. The worker factory and its tests exist.
- 59b-2b: the Redis-fenced forward/retry sweep, BullMQ registration on visit events,
  claim processor and runtime factory exist. Migration 0207 already supplies the
  scheduled-only partial index; it must not be regenerated or renumbered.
- The production root installs `closedRatingClaimsLifecycle()`. Only the scheduling
  consumer is live: it creates `SCHEDULED` rows. No production call activates the
  claim factory. This is an explicit fence, not missing wiring to remove casually.
- 59b-1 supplies the worker-only token codec; 59b-3 (actual sending) is separate.

## Missing recovery and discovery work (59b-2c)

- An ADR-0038 migration data step that enumerates only company IDs with the migration
  owner, then uses `pospay_app` and `withTenant` to append idempotent, per-company
  discovery events for existing scheduled requests.
- A discovery contract/handler using the independent aggregate type
  `rating_claims_discovery` (PP-96), so a parked discovery cannot block unrelated
  company events. Visit-trigger registration must preserve PP-97 retry/parking.
- Supported replay/inventory paths for pre-existing companies, parked discovery and
  late visits already acknowledged by an older worker, without changing dispatcher
  publication metadata, consumed-event receipts or historical request states.
- Redis-loss recovery and a runbook procedure, including queue-race/retry continuation,
  tenant isolation and idempotency tests on private infrastructure.

The spec's reference to migration **0194 is historical**, not an available number:
main already owns `0194_2026-11-01_service-duration-category.sql`. The new data step
needs a new migration when the manager grants the lane. Do not edit a merged migration.

## Activation blockers carried by #785

All seven issues are open; they were accepted only for dormant code:

| Issue | Remaining condition | Principal files |
| --- | --- | --- |
| #803 | Close state Redis even if processor close fails, preserving the primary error | `customers.module.ts`, runtime composition tests |
| #804 | Complete typed Redis state validation; corrupt inputs return `CORRUPT` without changing bytes | `rating-claim-state-validate.lua.ts`, entry scripts, real Redis tests |
| #805 | Measure real claim latency and queue capacity before activation; no timeout/concurrency increase by assumption | claim transaction/turn and processor measurement tests/report |
| #808 | Sanitized failure diagnostics with available company/event/job context | processor, runtime factory, turn and diagnostics tests |
| #809 | Prove parking/replay/manual recovery preserves request creation and ordering | processor/deliverer, real DB/Redis recovery tests and runbook |
| #810 | Observe coded release outcomes without masking the original turn reason/error | `rating-claims-turn-state.ts`, summary/diagnostic tests |
| #811 | Settle outbox public boundary or composition injection while preserving PP-97 | processor import, composition root and ADR |

The production factory must stay dormant until these conditions are resolved and
verified. Completing discovery alone is not permission to activate it or to send.

## Expected change surfaces

Recovery work touches worker customers contracts/events/ports/adapters/jobs, the worker
composition and its tests, the contracts event schemas, the DB data-step registry and
its new step/tests, ADR-0010 and the runbook. The blocker fixes additionally touch the
existing runtime/state/diagnostics files above. No public rating page change is needed.

## Migration lane and questions

A new **data-step migration is required** for the specified pre-deployment inventory.
The manager reports that 47-2a owns the final migration lane. Build and test only on
private infrastructure; stop before renumbering, `db:generate` or push until granted.

No new business rule is required for scheduling or at-most-once claiming: PP-96,
PP-97, PP-98 and PP-99 already answer their design choices. If release inventory finds
historical pre-activation `SENDING`/terminal notification attempts, their disposition
remains an owner question under the spec; this refresh has not inspected staging.

Manager instruction, 2026-11-06: approved **59b-2c only**, with the seven activation
blockers excluded. Each blocker will have a separate limited PR after 2c merges.
Build and test the data step on a private `lane.mjs up` cluster now; renumbering,
`db:generate` and push wait for the explicit words **lane granted**, after 47-2a (#877).
Historical `SENDING` and terminal attempts are counted, logged and left unchanged;
the owner question stays `PENDING` until DEP-1 inventory establishes whether any exist.

**Lane granted, 2026-11-06:** the manager authorized rebase onto `ef9209ba` after
#877 merged, migration **0214** (snapshot `prevId` from 0213), generation, chain
validation and push. The branch rebased without conflicts. The unnumbered SQL
draft was replaced by `packages/db/migrations/0214_2026-11-06_rating-claims-discovery.sql`;
no merged migration was edited. The lane remains assigned until this PR merges.
