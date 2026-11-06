# 47-2b bounded slot batching measurement

Date: 2026-11-06. Base checkpoint: `295395ddce7faa620df15537b721e42ad0ed02cf`.
PP-136 advice was completed by the parent. This task implements only the authorized
per-entitlement typed JSONB slot batch. Parent review and independent Astra high
review remain pending; this receipt is not production readiness or a timeout decision.

## Implementation

The winning entitlement is inserted first, followed by all its components, then one
slot INSERT SELECT from typed jsonb_to_recordset. Each entitlement contributes at most
20 x 365 = 7,300 records; there is no cross-entitlement slot array. JSON unit_value
fields are moneyToString strings. UUIDv7 IDs remain injected and assigned in the same
component/slot traversal order. createPackageSlots receives the frozen explicit base
and last values. Company/business/entitlement remain static SQL parameters.

The early external_ref conflict return still precedes child IDs and child inserts.
No pricing, domain, use case, schema, routes, recovery, transport, env, bounds,
atomicity, deadline, RLS, FK, statement guard, conservation, identity or audit changes.
No migration generation, git writes, installs, push, PR, delegated work or review.

0215 SHA256: `3489780f8d577f7a77fdc17f32474dc0ab94c223d70cf21fe4eb6be931bf4125`.
0216 SHA256: `f39d230f570a6d7f7c081f16bfebd4c29081c74fcc8bdb02040a186ee979d10c`.
Both match the required hashes. No journal/snapshot/order edits.

## Verification before measurement

- Worker `tsc --noEmit`: passed.
- Focused ESLint on writer, commit money regression and diagnostic: passed, existing
  boundaries deprecation warnings only. No added exemptions. The diagnostic's local
  max-lines-per-function exemption was removed through fixture, sampler, verification
  and raw database decorator extraction. Timing origins, stages, sampling frequency,
  SQL, fail-fast behavior and safe raw error metadata policy remain unchanged.
- Worker actual-numbered migration selection: 4 files, 34 tests passed, 23.59 s:
  package-import-commit.spec.ts, package-import-commit-money.spec.ts,
  package-import-commit-retry.spec.ts, domain/__tests__/package-import-commit.spec.ts.
  This includes full-transaction rollback/negative isolation and overlapping concurrent
  previews, both competing commit and competing rollback.
- DB actual-numbered migration selection: 8 files, 103 tests passed, 20.21 s:
  package-storage-money, package-storage-guards, package-composition,
  rls-package-storage, package-fk-indexes, privileges, function-inventory,
  concurrent-migrations (all .spec.ts).
- New DB-backed regression asserts every persisted ordinal/state and exact numeric text
  across two components for 10.001, zero and numeric(14,3) maximum 99999999999.999.
  It explicitly proves the entire remainder belongs to the last slot of the last
  component, with IMPORTED_USED prefixes and FREE suffixes. No mock-only assertion.

Initial worker run: 32 passed / 2 failed because the new test incorrectly distributed
remainder across components. Existing domain behavior and actual writes were correct;
test expectations were corrected from that domain contract, then all 34 passed.
Initial lint rejected function/file length; decomposition fixed both without exemptions.
The first hidden helper exited 99 before tests because Windows PowerShell treated pnpm's
stderr script banner as terminating under ErrorActionPreference=Stop. The helper now
uses Continue for native output and explicit nonzero-exit gates; the final run exited 0.
The first helper receipt is preserved separately, not counted as success.

## Identical measurement configuration

Private existing Postgres lane localhost:55418 (Redis localhost:56488 unused).
No competing task DB/build process was started by this task. Regression gates completed
before measurement. Same config and command as baseline:
`pnpm --filter @pospay/worker exec vitest run --config vitest.package-import-diagnostic.config.ts`.
One sequential orchestration, fresh fixture clone for each 1/10/50/100 case, 20 components,
365 sessions each, remaining=364, same synthetic workbook, actual numbered migrations,
30-minute ceiling 1,800,000 ms. No full 3.65-million-slot rerun.
All four completed COMMIT and persisted verification. Diagnostic runner: 585.43 s,
1 file / 1 orchestration test passed; durable exitcode.txt=0. No failure/sampler-error
records. Time values below are milliseconds, rounded to four decimals; JSON retains
full precision. Callback end and return are relative to port.run entry.

| Rows | lock | insert | complete | callback end | run return | return tail |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 2.9765 | 722.7627 | 17.2891 | 755.4902 | 806.0476 | 50.5574 |
| 10 | 3.1503 | 9593.8552 | 22.9137 | 9630.6626 | 9952.4654 | 321.8028 |
| 50 | 3.3741 | 109484.9894 | 68.6919 | 109575.3934 | 113382.6140 | 3807.2206 |
| 100 | 4.0080 | 428611.5818 | 41.0086 | 428697.4099 | 433882.7573 | 5185.3474 |

## Before / after

Baseline values are from 47-2b-diagnostic-baseline.md; no baseline was rerun.

| Rows | baseline insert | batched insert | insert reduction | baseline return | batched return | return reduction |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 2314.4006 | 722.7627 | 68.77% | 2561.0161 | 806.0476 | 68.53% |
| 10 | 39353.1612 | 9593.8552 | 75.62% | 39896.5371 | 9952.4654 | 75.05% |
| 50 | 175134.0019 | 109484.9894 | 37.49% | 177217.5934 | 113382.6140 | 36.02% |
| 100 | 471662.2978 | 428611.5818 | 9.13% | 476394.5944 | 433882.7573 | 8.92% |

All measured cases improved insertion and run-return time, but improvement varies sharply
with scale. At 100 rows it is only about 9%, despite the 20-to-1 slot statement reduction.
Insertion still dominates. The COMMIT-inclusive tail increased at 50 and 100 rows
(baseline 2015.4621 / 4652.6569 ms); no claim of universally faster stages or linear scaling.
One run per size is not a repeatability study, and baseline/after are different wall-clock
runs. This evidence does not isolate Node construction, JSON parsing, RI/index work,
statement guards, PostgreSQL CPU or host scheduling.

| Rows | entitlements | components | slots | exact slot sum KWD | peak RSS bytes | peak heap bytes |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1 | 20 | 7300 | 10.001 | 0 | 0 |
| 10 | 10 | 200 | 73000 | 100.010 | 323698688 | 133411488 |
| 50 | 50 | 1000 | 365000 | 500.050 | 329953280 | 140123960 |
| 100 | 100 | 2000 | 730000 | 1000.100 | 324440064 | 134479856 |

Memory is sampled process-wide every second. For 1 row, the transaction finished before
the first tick: zero means no sample, not zero memory consumption. Other peaks can miss
short allocations and are not isolated allocation deltas. Baseline RSS/heap at 100 were
518942720/320885144 bytes, but these sampled process peaks are not a controlled memory study.

## Sampling and EXPLAIN

Same one-second nonoverlapping sampler; busy ticks skipped. Only whitelisted category,
state/wait metadata recorded. No raw SQL, parameter values, errors/messages or plans.
Observations are point samples, not duration-weighted accounting or proof of absent waits.

- 1 rows: `{}`.
- 10 rows: `{"active / None / None / INSERT": 9}`.
- 50 rows: `{"active / None / None / INSERT": 105, "active / Client / ClientRead / INSERT": 3, "active / None / None / COMMIT": 4}`.
- 100 rows: `{"active / None / None / INSERT": 420, "active / Client / ClientRead / INSERT": 3, "active / IO / WALInitWrite / INSERT": 1, "active / IO / DataFileExtend / INSERT": 1, "active / None / None / COMMIT": 5}`.

50-row EXPLAIN: planning 0.247 ms; execution 38.801 ms.
The exact same conservation aggregation ran after commit under pospay_app withTenant.
Allowed per-node actual times, loops, row counts, index names and buffer counters are in
explain-summary.json. This one warm representative query is not all deferred trigger
work or full-bound behavior. Raw schema-safe errors remain captured before adapter mapping
and retry wrapping; no error paths fired during measurement.

## Durable artifacts and handoff

`F:/Dev/Temp/pospay-47-2b-batched-db0365f4b38740efa7bf1c4f05bc8547`
contains run.ps1, typecheck.log, lint.log, worker-tests.log, db-tests.log, runner.log,
batched.jsonl, case-summary.json, sample-summary.json, explain-summary.json and exitcode.txt.
Initial-helper failure receipts remain named initial-helper-*.txt. Final exit 0 covers
all sequential gates and the completed diagnostic. The helper uses hidden Start-Process
and survives tool lifetime. No background benchmark work remains required.

Recommended next step: parent independently reviews the bounded diff and decides whether
these modest 100-row gains warrant a full-bound rerun, then dispatches Astra high.
Do not select a production timeout or infer 3.65-million-slot success from these samples.
