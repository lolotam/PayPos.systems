# 42-3b1 — next diagnostic plan, pending manager review

**Later execution checkpoint:** the manager approved this bounded plan. Its first run
stopped on invalid Docker load telemetry before a valid A/B comparison. See the
[stop receipt](42-3b1-statistics-stop-receipt.md). No retry is authorized by that receipt.
The planning status below is preserved as historical context.

## Status and authority

Planning only, per the latest PP-112 manager instruction. No part of this plan has run.
The last implementation/evidence head is 915ce78f; b1 remains unready, SA-10 fails,
and there is no sale HTTP activation, PR, migration or approved storage dependency.
The [completed index experiment](42-3b1-index-experiment.md) and earlier
[performance diagnosis](42-3b1-performance-diagnosis.md) remain the historical evidence.
This plan grants no execution authority. PP-136 advice has been received and incorporated
below; it is non-binding and does not replace manager review or the independent Astra gate.
The advisor read the plan, experiment, diagnosis, scope and package index definitions, but
disclosed that architecture/technology documents and ADRs were not read. It ran no commands.

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

Preregistered expectation: correcting H1 alone may still fail SA-10. Earlier instrumented
company RI alone took about 219 ms in one sample, with additional heap/index/application
and COMMIT work. Those observations motivate H2; they must not be added across overlapping
awaits or different runs into a predicted total, or treated as a minimum possible latency.
Within each instrumented B sale, compare component RI with company RI trigger time/calls
as an observed reference, not an assumed interchangeable per-call cost.

The alternative position index is `(company_id,entitlement_id,position)`: its two-column
equality prefix still produced the same filtering. This supports investigating row-count
estimates/cost ties; the specific reason for index selection remains unproven.

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
   Gate stale-statistics H1 specifically: compare last_analyze/last_autoanalyze and
   entitlement_id n_distinct with actual seeded cardinality and estimated/actual plan rows.
   If estimates are already accurate, record weakened support for stale statistics before
   B; do not silently reinterpret H1 as a different planner hypothesis.
3. Prepare the unchanged 20-component/365-slot fixture and execute one complete warmup
   sale before freezing its snapshot: package_components otherwise has no sale rows to
   analyze. Record the 20 newly committed parent components and 7,300 slots. Copy three
   identical private databases. Arm A keeps statistics untouched. Arm B runs ANALYZE on
   package_components only, using its owner setup connection, before opening a fresh
   restricted application connection. Arm A2 is a fresh untouched baseline control.
   ANALYZE changes statistics, not schema; it is proposed here, not already authorized.
   Do not manufacture rows, alter cardinality, rewrite constraints or introduce an index.
   Before freezing and before treatment in every copy, fingerprint the relevant pg_stats
   content and pg_class estimates to prove the same starting state. Capture
   pg_stat_user_tables before/after warmup, freeze and each arm. An automatic ANALYZE during
   preparation or measurement can invalidate the intended untreated comparison; do not
   disable autovacuum to conceal this. Record and mark such a comparison inconclusive.
4. The snapshot contains the common warmup. Warm each fresh connection identically with
   ping/read-only setup outside timing, then measure five complete execute calls per arm.
   Do not add a second sale warmup or change any original assertion. Alternate the
   A/B order in a second independent block, with fresh copies, then baseline control.
   Keep application pools, fixture values, seed snapshot, writer, ids implementation,
   clock, transaction options and all queries identical. No other local gates run during
   measurements. Report all samples and load observations, not only a selected median.
   Match B's cache warming with the same explicit full parent-table read in all arms after
   treatment and before timing; save its plan/buffers. This reduces, but cannot guarantee
   removal of, ANALYZE-related cache differences. Sample host/container CPU, memory pressure
   and I/O before/during/after every arm, not just preflight. Predeclare a load guard:
   CPU means differing by more than 10 percentage points, new memory pressure, or baseline
   median drift over 20% makes latency attribution inconclusive. Never adjust these guards
   after seeing results; keep the two-block cap.
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
   Trigger durations come from TIMING ON; TIMING OFF supplies execution totals and call
   counts only when present. Never manufacture absent trigger durations from totals.

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
- Decision rule linking H1/H2: exact B lookups plus five failures means plan correction
  was insufficient. Return the measured RI-call multiplicity and remaining phases to the
  manager for a separately scoped structural investigation; no further index trial is
  implied. Even one failure prevents readiness. Five passes in one arm require the second
  controlled block and a production-applicable explanation, not automatic acceptance of B.

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

## Optional question for manager review — not an extra authorized arm

Historical production statistics may differ from this minimal fixture. A separate option
is statistics collection before the common sale warmup, followed by new parent insertion;
however, an empty package_components table cannot model historical parent statistics.
This option therefore needs an explicit representative synthetic history/data plan and
matched controls before approval. It is not added to the two-block experiment, does not
replace normal SA-10, and cannot be silently introduced as a more favorable fixture.
Recommendation: review the bounded plan first; keep this production-representativeness
question separate rather than expanding the current experiment or its row limits.
