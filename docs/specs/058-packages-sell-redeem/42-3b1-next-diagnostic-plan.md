# 42-3b1 — next diagnostic plan, pending manager review

## Status and authority

Planning only, per the latest PP-112 manager instruction. No part of this plan has run.
The last implementation/evidence head is 915ce78f; b1 remains unready, SA-10 fails,
and there is no sale HTTP activation, PR, migration or approved storage dependency.
The [completed index experiment](42-3b1-index-experiment.md) and earlier
[performance diagnosis](42-3b1-performance-diagnosis.md) remain the historical evidence.
This plan grants no execution authority. Mandatory PP-136 advice is requested separately;
advice is non-binding and does not replace manager review or the independent Astra gate.

## Questions, hypotheses and discriminating observations

H1: poor selectivity/cost estimates on newly inserted parent components allow a shorter
prefix index to win even though it rejects component ids. Removing one index simply moves
the same work to another prefix index. Existing evidence supports the second sentence:
both actual plans reject 69,350 rows across 7,300 RI lookups. It does not yet prove why
the planner prefers them or that statistics correction will change that choice.

H2: even an exact component lookup may leave material per-row RI and other transaction
costs. Company RI already uses companies_pkey without rejected rows. Its measured trigger
time includes instrumentation and other execution effects, so it is not an established
hardware-independent floor. No claim of impossibility or inevitable success is justified.

| Question | Comparison | Observation that discriminates |
| --- | --- | --- |
| Are component estimates misleading? | Untouched statistics versus parent-table ANALYZE on identical seeded snapshots | Estimated/actual rows, chosen index, all four index predicates versus id filter, rows rejected |
| Does the actual RI plan improve? | Restricted full-use-case nested plans in both arms | All 7,300 component checks captured; exact lookups with zero rejected rows, or unchanged prefix filtering |
| Does this matter to the sale? | Uninstrumented full transactions in both arms and baseline control | Every one of five warm transactions stays below 200 ms; preserve all individual failures |
| What cost remains? | Separate TIMING ON/OFF EXPLAIN and nested traces per arm | Company/component trigger calls and observed durations, statement execution, entry, other statements, COMMIT/return |

## Proposed bounded sequence — execution requires manager review

1. Read-only preflight on a newly owned private lane: record PostgreSQL image/version,
   memory/CPU limits, PostgreSQL settings and host/container load. Do not stop another
   task's processes or containers. Use random synthetic values, no existing .env reads.
2. Capture catalog definitions, table RLS/policies, all trigger and constraint definitions,
   validity/readiness of every component index, column ordering, relpages/reltuples,
   pg_stats entries and last-analyze metadata. Verify all existing indexes are present:
   this experiment does not repeat the rejected index deletion.
3. Make one seeded snapshot with the unchanged 20-component/365-slot fixture. Copy three
   identical private databases. Arm A keeps statistics untouched. Arm B runs ANALYZE on
   package_components only, using its owner setup connection, before opening a fresh
   restricted application connection. Arm A2 is a fresh untouched baseline control.
   ANALYZE changes statistics, not schema; it is proposed here, not already authorized.
   Do not manufacture rows, alter cardinality, rewrite constraints or introduce an index.
4. Use one warmup and five measured complete execute calls in every arm. Alternate the
   A/B order in a second independent block, with fresh copies, then baseline control.
   Keep application pools, fixture values, seed snapshot, writer, ids implementation,
   clock, transaction options and all queries identical. No other local gates run during
   measurements. Report all samples and load observations, not only a selected median.
5. After each arm's normal timings, run separate instrumented sales on its own equivalent
   snapshot: EXPLAIN ANALYZE BUFFERS with TIMING OFF; a separate TIMING ON sale; then
   nested auto_explain on a new pospay_app connection, configured by the clone owner only.
   Preserve exact parent-row predicates and FOR KEY SHARE behavior. Tag by backend pid
   and arm. Save/summarize logs immediately after each arm, before the next arm can rotate
   them away; require all 7,300 component and 7,300 slot-company checks, identified by
   their enclosing slot statement, rather than counting company checks from other tables.
6. Record top-level planning/execution, trigger call counts/time where available, nested
   chosen indexes, conditions/filters, actual/estimated rows, loops, rejected rows and
   buffers. Record complete client phases including COMMIT. Trigger time and nested-query
   time overlap; do not sum them or subtract them to claim exact RI framework CPU cost.
   TIMING ON/OFF differences under varying load do not isolate instrumentation overhead.

## Invariants and stop conditions

- No DROP/CREATE/ALTER index, table or constraint; no constraint deferral/disable,
  replica role, RLS bypass, seal alteration, production planner GUC or worker conversion.
  Clone-only diagnostic logging defaults are reset in finally; no shared/server changes.
- Every original financial INSERT-count, row-count, money conservation, component,
  event-contract and saved-idempotency-response assertion remains. Full timing remains
  execute-through-COMMIT, each of five warm transactions strictly below 200 ms. Failures
  stay failures; diagnostic collection must never become a waiver or change normal SA-10.
- Stop immediately on ownership ambiguity, non-disposable target, integrity fingerprint
  change, missing required index, data assertion failure, unexpected privileges, missing
  nested-plan coverage or incomplete cleanup. Repair evidence collection before comparison.
- At most two comparison blocks (A/B and B/A, each with a baseline control). If host load
  changes substantially or baselines drift, mark latency evidence inconclusive; do not
  keep retrying until a favorable run appears. No correction-budget reset is inferred.
- If statistics do not remove the filter in actual RI plans, stop H1 investigation after
  those blocks. No next index deletion or constraint/index-layout experiment is implied.
- If exact lookups appear but any complete transaction still exceeds 200 ms, report the
  measured remaining phases and stop before proposing a broader storage/contract change.
  Do not infer a universal floor from local results or alter the threshold/data limits.

## Deliverable and subsequent decision

Produce one receipt with raw full timings, catalog/statistics fingerprints, complete nested
plan summaries, EXPLAIN artifacts, instrumentation limitations and cleanup proof. Preserve
failed/inconclusive runs. Remove only owned temporary resources and restore original env
files without reading them. No schema/migration file enters the repository.

Even a successful ANALYZE arm would not justify adding ANALYZE to the request transaction:
its owner-only setup and already-seeded statistics are diagnostic conditions, whereas sale
inserts its own new components. The proposed experiment tests a planner hypothesis, not a
production fix. A useful result leads only to a separately reviewed dependency proposal
with a production-applicable mechanism, ownership, size estimate and negative tests.
An unchanged plan or inconclusive result leads to no migration recommendation. B1's
remaining acceptance tests, guards, Astra review and PR readiness remain outstanding.
