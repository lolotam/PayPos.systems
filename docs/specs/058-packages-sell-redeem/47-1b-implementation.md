# 47-1b — execute package preview and activate its routes

Base: `88f822be` (merged 47-1a). The manager assigned this slice after Waleed's
worker-split confirmation recorded by #860. One worker use case; no financial commit.

The approved `47-1-async-split-plan.md` is binding. Implement the shared technical
workspace `@pospay/import-workbooks`, preserving API facades, staff bounds and errors.
Move pure package definition/allocation/slot/error primitives into `@pospay/domain`
with API compatibility exports; default sale behavior is unchanged. Package imports
select session-count allocation and put the remainder on the last final-component slot.

The worker loads pending facts under withTenant, reads bounded bytes and parses them
outside a transaction, then locks/rechecks the pending preview and file identity,
reads services/external refs/customers in batches, and writes privacy-safe ready results.
Permanent input failures conditionally fail pending; transient errors retry and last
attempt failure cannot replace a terminal result. Job and event payloads contain IDs
only. Storage exceptions and SQL parameters cannot leak into queue error messages.

Outbox transport uses the existing BullMQ pattern outside the outbox transaction.
Known types come from the real module transport, never an unconditional ack registry.
The 47-1a production controller is registered with this completed worker lifecycle.
An older 47-1a worker keeps retrying the unknown type during a rolling deployment.

## #863 — ready-result consistency

This worker is the writer of ready, so this PR takes #863. Add a NEW custom migration;
0211 is merged and must not change. Before ready, rows/errors must be arrays,
error_count must equal errors length, and valid/skipped/distinct-invalid-row counts
must form the input-row partition. Multiple field errors on one row remain valid.
No simple error_count+skipped_count<=row_count condition is permitted. Existing staff
results and transitions remain unchanged. Test all metadata negatives, multiple
issues per row, tenant isolation and immutable ready/failed terminal states.

The SQL draft is tested on a private cluster; final numbering, db:generate and push
wait for the manager's shared migration lane. #864's general staged-check rollout
follow-up remains separate; no merged migration is rewritten.

## Verification and publication

Keep 2 MiB / 500 rows / 68 columns / 4 sheets and the full 500-row/20-group workload.
Keep the full HTTP warm acceptance median <200 ms. Run reader/staff compatibility,
money identity/default regression, worker duplicate/retry/race/privacy/transport and
lifecycle tests, local typecheck/lint/boundaries/docs/module-map checks, the three
guards and independent Astra before PR. Full suite/API shards run in CI only.
No merge/deploy/server/real env is authorized for this implementation session.
