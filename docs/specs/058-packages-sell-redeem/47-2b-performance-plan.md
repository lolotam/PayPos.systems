# 47-2b performance diagnosis — before changing the writer

Checkpoint: `295395ddce7faa620df15537b721e42ad0ed02cf`, based on main dd7c42ba.
Migrations 0215/0216 are generated and chain-checked; no push or PR. The real
numbered DB selection passed 103 tests, and staff job regression passed 8 tests
alone without changing deadlines. The initial parallel/load failures remain in
the local receipt. Private lane packages-47-2b is reserved for sequential runs.

The full-bound attempt failed at 1,800,840 ms, with a 1,800,000-ms deadline and no
success receipt. The first withDeadline timer rejects before COMMIT is sent;
the post-COMMIT unknown-outcome watchdog would require another timeout window.
This supports pre-COMMIT work as the observed limit, but does not prove whether
Node, statement guards, RI, indexes or I/O dominate. Deferred conservation checks
have not been measured at full scale and remain a later risk.

PP-136 advice: bounded JSONB slot insertion per entitlement is compliant but must
be measured as an optimization, not presumed to fix the bottleneck. No new owner
question is open. No file/session bound, one-transaction atomicity or test ceiling
may change; no production transaction budget is selected by this session.

## Baseline diagnostics

- Add opt-in diagnostic benchmark coverage only. Do not change production writer,
  schema, migration SQL, journal or snapshots during the baseline measurement.
- Fresh cloned database per 1/10/50/100-row case, each with 20 components and
  365 original sessions. Verify actual completed COMMIT and persisted counts.
- Decorate PackageCommitTransactions in the harness to time service locking,
  cumulative insert, completion and return of the transaction after its body.
  The return tail is a COMMIT-inclusive observation, not exact server-only latency.
- Capture only safe error class/SQLSTATE/constraint metadata before the use case's
  retry wrapper; never output messages, causes, SQL text or source parameters.
- Sample pg_stat_activity once a second, no overlapping sampler queries. Retain
  state/wait-event counts and a whitelisted statement category, never raw query text.
- At 50 rows, use EXPLAIN ANALYZE BUFFERS for the conservation component aggregation
  as pospay_app under withTenant. Record plan-node/index names, rows, loops, buffers
  and times only, without conditions containing source values.
- Keep the existing 30-minute test ceiling, fail-fast, and record partial stage and
  memory evidence even on failure. Run alone, not alongside builds/other DB suites.

## Measured optimization, only after baseline

If baseline evidence supports statement overhead, replace up to 20 component slot
INSERTs per entitlement with one typed jsonb_to_recordset INSERT of at most 7,300
rows. IDs remain injected UUIDv7, amounts remain moneyToString strings, and every
component is inserted before the first slot. Keep all RLS/FK/composition/conservation
checks, targeted external-ref conflict skip, immutable identity/proof and atomic
audit/outbox. No SQL UUID function, global millions-of-slots array or new migration.

Repeat the same diagnostic cases and compare before another full-bound attempt.
An unnest alternative is available if JSON parsing dominates; it is not assumed
superior without measurement. Any writer change needs focused regression gates
and an independent Astra high review. A need to lower business bounds or choose
a production transaction budget goes through the manager to Waleed (PP-117).
