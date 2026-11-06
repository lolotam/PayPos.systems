# 42-3b1 — single authorized statistics run: stopped, inconclusive

## Decision and scope

2026-11-07 Kuwait. Manager approved one A/B then B/A run, at most two blocks, after the
dual-error harness fix. Initial recorded size was 2624/2800, margin 176 lines.
Exactly one execution ran. It stopped at the approved automatic-ANALYZE guard in block1_B.
The baseline control, second block and instrumented RI sales were not run. No retry/reset.
**Decision: no valid isolated statistics comparison, no performance acceptance, no fix.**
No production/schema/index/FK/RLS/timeout change, optional history, b2 or PR was added.

## Harness and evidence completeness

finishLoadArm records the original work/data error and collection error together before
rethrowing the original error unchanged; a collection-only failure remains a failure.
Its independent regression test injects both errors and verifies original identity and
both receipt fields. The six focused load-tool tests passed before this DB run.
After the run, the negative test was strengthened to require the original error receipt
before finish starts, and to preserve the original error even if receipt writing fails;
the helper was tightened accordingly. No DB retry was used for that fault-injection check.
The actual armErrors entries for A and B have workFailed=false, collectionFailed=false,
originalSaleDataError=null and collectionError=null. The later guard stop remains recorded.
Execute-through-COMMIT elapsed/phases were flushed before data assertions and parsing.
Raw stdout/stderr, host samples, chunk arrival times and all ten completed sales survived.
Load observation awaited samples before work, sampled during work, and awaited fresh host/
Docker observations after work. Completeness is not acceptance of an equal environment.

## Observations, milliseconds including COMMIT

- A: 3223.1488, 3966.1127, 4524.8503, 3458.2448, 2960.4908.
- B: 1071.2315, 1323.0436, 2434.1185, 2507.9155, 3330.9046.
- All ten unchanged <200-ms checks failed; all financial INSERT-count, 7300-row,
  30.000 conservation, 20-component, event and saved-response assertions passed.
- Source statistics had no manual/automatic ANALYZE. Both clones passed the starting
  statistics/catalog fingerprints. B's explicit parent ANALYZE completed at
  2026-11-06T21:30:21.554Z; last_autoanalyze was then null/count 0. After B, it was
  2026-11-06T21:30:29.592Z/count 1. This automatic update invalidates treatment isolation.
- A retained 74 host / 39 Docker samples; B retained 47 / 24. Host CPU means were
  99.7641% and 90.2447%; container means 75.1372% and 72.0683%. Raw values were not
  clipped/filtered. Both differences are below 10 percentage points; high absolute host
  utilization remains visible. Host memory-pressure flags were false. Full BlockIO/NetIO
  series remain in the receipt and raw journals. No causal speedup is inferred.
- The autoanalyze guard stopped before baseline-drift evaluation and 7300+7300 nested RI
  capture. That coverage is **incomplete**, not waived or inferred from earlier runs.
  H1/H2 remain unresolved; this is not evidence that ANALYZE is a production sale fix.

## Artifacts and cleanup

Large artifacts remain outside the repository under `F:/Dev/Temp/`:

- `pospay-42b1-stats-93468-receipt.json`: full environment, statistics, integrity, phases,
  load/IO series, both error fields, stop reason and databaseCleanup=true.
- `pospay-42b1-stats-93468-block1_{A,B}-load/`: docker.stdout.raw, docker.stderr.raw,
  sales.jsonl, host.jsonl, arrivals.jsonl and completeness status.json.
- `pospay-42b1-authorized-once.ts`: exact executed harness source.
- `pospay-42b1-authorized-once.log`: failures, stop and cleanup transcript; process exit 1.

Owned lane pospay-test-sale-b1-a27c8fab5f and Redis were removed with their temporary data;
source/arm databases and fixture resources closed, source connection setting restored.
Original env files were restored without reading them. Temporary repo harness/config
files were removed. No remaining acceptance test was dropped or made weaker.

Next: manager reviews this stop receipt before any new plan/execution. Do not disable
autovacuum, add history, relax 200 ms or retry to obtain favorable results. Any alternative
investigation needs a bounded plan that addresses the observed statistics interference.
B1 remains unready; remaining acceptance coverage, guards, Astra review and PR remain open.
