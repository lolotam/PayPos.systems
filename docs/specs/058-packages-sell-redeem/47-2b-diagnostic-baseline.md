# 47-2b diagnostic baseline receipt

Date: 2026-11-06. Requested checkpoint: 295395ddce7faa620df15537b721e42ad0ed02cf.
This run measures the existing writer before any optimization. No production writer,
domain, use case, schema, migration, journal, snapshot, environment file or git operation
was changed/performed by this diagnostic task. Existing writer still inserts 365 slots per
component (20 slot INSERT statements per entitlement). Current writer SHA256:
AB993B160DB1B9C92FECE6C885B22BC76EEA8098494AB1B35B0B1AECCDCA61D2.
This is a current-file fingerprint, not a git comparison to the requested checkpoint.

## Execution

- Private existing packages-47-2b lane, localhost:55418; Redis is not used by this harness.
- Normal packages/db/test/global-setup.ts; real migrations 0215/0216, no draft wrapper.
- One test process, sequential cases, fresh packagePreviewFixture clone per case,
  20 components and 365 sessions per component. Synthetic workbook remaining=364.
- Command: pnpm --filter @pospay/worker exec vitest run --config vitest.package-import-diagnostic.config.ts
- Hidden PowerShell helper; durable exitcode.txt = 0. Vitest: 1 file/1 orchestration test passed,
  four cases completed; total runner duration 738.37 s. Test ceiling 1,800,000 ms.
- Worker tsc --noEmit passed before measurement. Focused ESLint passed before measurement
  (existing boundaries deprecation warnings). Initial lint rejected the long orchestration;
  a documented local max-lines-per-function exception was added before measurement.
- No full suite, API shards, full-bound benchmark, installs, reviews, push or PR.

## Exact measured stages (milliseconds)

| Rows | lockServices | summed insert | complete | callback end | run return | return tail |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 6.3085 | 2314.4006 | 31.4827 | 2395.8053 | 2561.0161 | 165.2108 |
| 10 | 23.0967 | 39353.1612 | 21.6074 | 39463.9321 | 39896.5371 | 432.6050 |
| 50 | 6.5228 | 175134.0019 | 26.2304 | 175202.1313 | 177217.5934 | 2015.4621 |
| 100 | 3.7229 | 471662.2978 | 42.2696 | 471741.9375 | 476394.5944 | 4652.6569 |

Callback end and run return are relative to port.run entry. The tail includes COMMIT,
deferred checks, driver/network and scheduling; it is not pure PostgreSQL latency.
Every run returned successfully before verification. No failures or sampler errors occurred.

| Rows | persisted entitlements | components | slots | sum slot money KWD | peak RSS bytes | peak heap bytes |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1 | 20 | 7300 | 10.001 | 274984960 | 126973376 |
| 10 | 10 | 200 | 73000 | 100.010 | 309731328 | 144951240 |
| 50 | 50 | 1000 | 365000 | 500.050 | 510627840 | 334478168 |
| 100 | 100 | 2000 | 730000 | 1000.100 | 518942720 | 320885144 |

All persisted statuses were committed and created_count matched rows. Counts and money
were asserted after completed COMMIT. These are aggregate assertions, not a replacement
for the existing component invariants or regression suite.

## Sampling and EXPLAIN limits

One-second interval, no overlapping sampler query; busy ticks are skipped. Samples are
point observations, not CPU profiles or duration-weighted server accounting. Memory peaks
are sampled on the same interval and can miss short spikes; they are process-wide, not
isolated allocation deltas. Monitoring uses an owner connection filtered to current cloned
database and pospay_app. Only state/wait categories and server-side whitelisted statement
verbs leave PostgreSQL; no raw query text is returned or recorded.

Observed INSERT active/no-wait samples: 1 row=2, 10=29, 50=162, 100=451.
ClientRead/idle observations also occurred. DataFileExtend: one sample at 50, two at 100.
COMMIT active/no-wait: two samples at 50, five at 100. No Lock wait was sampled.
Absence in a one-second sample does not establish absence of short waits.

After 50 successful commits, one representative entitlement's exact component-conservation
aggregation was explained with ANALYZE/BUFFERS under pospay_app withTenant. Planning 0.324 ms;
execution 54.510 ms. Aggregate -> Sort -> Result -> Nested Loop, with Index Scan on
package_components_service_fk_idx (20 rows, 1 loop) and
package_session_slots_component_fk_idx (7300 rows per loop, 20 loops). Root returned zero
broken components, 2951 shared hits, zero shared reads/dirties/writes and zero temp blocks.
The JSON artifact preserves allowed per-node actual times/rows/loops/buffers/index names,
without conditions, parameter values or full plans. This one warm post-commit query does
not measure all deferred trigger work, inserts, all entitlements or full-bound behavior.

Raw DB error metadata capture is inside the harness database decorator, before adapter
mapping and use-case retry wrapping; port errors also captured before retry wrapping.
Only bounded class/code/constraint strings are retained, never messages/SQL/parameters/raw
causes. Failure paths write partial stage/timing/memory evidence; none fired in this run.

## Artifacts and next step

Durable task TEMP directory:
F:/Dev/Temp/pospay-47-2b-diagnostic-445ce6c148da4d5796e342b62bd8c65c

Contains run.ps1, runner.log, baseline.jsonl, case-summary.json, sample-summary.json,
and separate exitcode.txt. No test process remains required after known exit code 0.

Insertion dominates observed time; service locking, complete and COMMIT-inclusive tail
are comparatively small. Evidence does not separate client statement generation/round trips
from PostgreSQL statement guards, RI/index work or CPU. Recommend a separately authorized
bounded-batch comparison using this identical harness, with focused regressions and the
required independent review before adoption. Treat it as a measured hypothesis; do not
claim a speedup, choose a production budget or extrapolate success at 3.65 million slots.
Production batching/JSONB optimization remains unimplemented.
