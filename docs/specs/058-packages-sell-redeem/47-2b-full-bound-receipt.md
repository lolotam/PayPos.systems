# 47-2b — completed full-bound COMMIT receipt

Result: PASS, exit code 0. Completed 2026-11-06 at 15:27:17.882 Kuwait
(12:27:17.882 UTC), on main base dd7c42ba with this slice's local changes.
This is local verification, not deployment, merge approval or an exact-head CI result.

## Exact run

From the worktree root:

```powershell
$env:PACKAGE_BENCHMARK_OUTPUT='F:/Dev/Temp/pospay-47-2b-full-bound-v4.jsonl'
pnpm --filter @pospay/worker exec vitest run --config vitest.package-import-benchmark.config.ts
```

The dedicated config selects package-import-commit-full-bound.benchmark.ts only.
The ordinary worker spec glob excludes this benchmark. No planner settings or
manual statistics priming are used by the accepted run. Its fresh clone applies
the actual numbered 0215/0216 migrations through the normal test setup.

Input: one synthetic XLSX of 101,036 bytes; 500 data rows; 20 components per row;
365 original sessions and 364 remaining sessions per component; price_paid
10.001 KWD per row. Thus 500 entitlements, 10,000 components and 3,650,000 slots.
The source-file, row, column, sheet and session limits are unchanged.

Private Postgres 16 lane packages-47-2b: localhost:55418, dev-compose settings and
a 1-GiB container memory limit. Redis and providers are not involved in financial
commit. No other local DB suite or build was run alongside this measurement.

## Actual result

| Measurement | Result |
| --- | ---: |
| Whole use case through completed COMMIT | 470313.2967 ms |
| Unchanged transaction ceiling | 1800000 ms |
| Vitest total duration | 512.15 s |
| Persisted entitlements | 500 |
| Persisted components | 10000 |
| Persisted slots | 3650000 |
| IMPORTED_USED slots | 10000 |
| Exact sum of slot values | 5000.500 KWD |
| Preview state / created_count | committed / 500 |
| Sampled process peak RSS | 440553472 bytes |
| Sampled process peak heap | 250489880 bytes |

All original assertions remain. Additional assertions verify component/entitlement
counts, the exact monetary sum, imported-used count and elapsed time within the
same ceiling. The memory sampler runs every 10 ms; these are process-wide sampled
peaks, not isolated allocations, guaranteed instantaneous maxima or Postgres memory.

All writes, audit, outbox and final status share one transaction. The awaited use
case returned after COMMIT, including deferred conservation checks. The last slot
batch was recorded at 445429.7009 ms on the transaction-body timer. That timer and
the whole-use-case timer have slightly different origins; their difference is not
an exact server-only COMMIT duration.

Component INSERTs were measured without executing them twice: the first, 250th
and 500th use actual EXPLAIN ANALYZE, and their returned rows are unused by the
writer. At component batch 500, execution was 7.470 ms, including parent FK
2.997 ms, service FK 1.078 ms and statement guard 1.664 ms for 20 components.
The remaining instrumentation records only whitelisted table names and timings.

## Fix and regressions

See 47-2b-performance-correction.md for the actual bad index plan, rejected planner
experiments and before/after first-batch measurements. Production writes use
bounded typed JSONB batches after all winning parents and components are prepared.
The service FK/index retain the same column equalities with reordered keys. The
slot guard groups equivalent checks while retaining every refusal, RLS, FK,
creation seal and deferred money-conservation constraint.

The worker selection passed 17 files / 152 tests. The final DB selection passed
9 files / 109 tests, including actual 0216 replay after concurrent DROP and suffix
rollback, mixed slot guard negatives, money, composition, RLS, privileges and
FK indexes. Earlier failed and cancelled measurements remain in their original
receipts; they are not relabelled as passing runs.

Final migration SHA256 values, after UTF-8/LF normalization:

Only line endings were normalized after measurement; SQL statements are unchanged.
The final 109-test DB regression applied the normalized artifacts.

- 0215: a1900631eb181b8a331bb19f24157969e92ae7b3003b65375ec44a6eb78e1c03.
- 0216: 1361da69949c84ef176933fbec4c205631b0695d3f0321c210fc0843c2a45691.

Journal idx values are 214,215,216; each snapshot prevId matches the preceding id.
0214 and earlier merged migration artifacts are untouched. Existing membership
values remain NULL; the reordered service FK has exactly the old valid-row set.
No new CHECK constraint or backfill is introduced. The FK replacement/validation
holds ACCESS EXCLUSIVE on package_components until the transactional suffix ends;
NOT VALID followed by separate VALIDATE here does not reduce that lock lifetime.
The accepted product does not yet enqueue financial imports; 47-2c/d remain fenced.

Durable local artifacts: F:/Dev/Temp/pospay-47-2b-full-bound-v4.ps1, .log, .jsonl,
-status.json and -input-bytes.txt. No real customer data or secrets are included.
