# 42-3b1 — SA-10 local stop receipt, 2026-11-06

**Later manager instruction:** diagnosis and bounded correction resumed without changing
SA-10. See [the performance diagnosis](42-3b1-performance-diagnosis.md). The stop status
below describes this earlier checkpoint, not the current authorization to investigate.

Status: **FAILED / sale delivery stopped for spec review**. No PR or push. This is not
a waiver, an implementation-complete receipt, or evidence about CI performance.

## Scope and measurement

After merge `60332778`, the manager-approved [b1 scope](42-3b1-scope.md) is active.
`package-sale-volume.spec.ts` calls `SellPackageUseCase.execute` through
`createPackageSaleTransactions` and `bindPackageSaleReaders` on real Postgres. Timing
starts immediately before execute and ends after its promise resolves, including the
tenant wrapper's COMMIT and deferred constraints. It includes idempotency claim/response,
authorization, catalog/seller reads and locks, domain planning and IDs, all financial
inserts, audit and outbox. Setup, persisted-result assertions and fixture teardown are
outside the measured interval. There is one warmup followed by five measured new sales.

Each sale has 20 components × 365 sessions = 7,300 slots. Statement interception checks
exactly one INSERT for each of the three financial tables. Before the final timing
assertion, all six sales passed the statement-count checks, persisted 7,300 slots whose
sum was 30.000, returned 20 components, emitted a contract-valid PackageSaleChanged and
stored the matching idempotent 201 body. These facts do not imply complete SA coverage.

| Measured sale after warmup | Full transaction, ms |
| --- | ---: |
| 1 | 918.4180 |
| 2 | 922.6799 |
| 3 | 978.9565 |
| 4 | 1018.6616 |
| 5 | 1130.2548 |

The approved gate is **each measurement below 200 ms**, not a median. All five exceed it.
No timing threshold, constraint, seal or money rule was changed. The cause has not been
profiled; no attribution to Docker load, storage, SQL, IDs or application work is proven.

## Reproduction and environment

- Command under isolated temporary environment:
  `pnpm --filter @pospay/api exec vitest run src/modules/orders/__tests__/package-sale-volume.spec.ts`.
- Node v24.21.0, Windows x64, Intel Core i7-8700 @ 3.20GHz. Docker Desktop reported
  8 CPUs and 16,772,689,920 bytes of memory. PostgreSQL image requested: postgres:16-alpine;
  Redis: redis:7-alpine. No pinned image digest or concurrent-host-load measurement was captured.
- Private lane `sale-b1-b8b28d1c87`, loopback port 55487, real migrations and a cloned
  database for the spec. The lane uses the existing development compose settings, including
  synchronous_commit=off; this is not a production durability benchmark.
- Both containers used temporary generated values and were removed afterward. Existing
  `.env` and `.env.test.local` were renamed aside without reading/copying their contents;
  only a newly generated test configuration was consumed. Originals were restored in finally.
  An initial cross-volume rename failed with EXDEV before moving a file; same-volume
  temporary preservation corrected that setup issue without reading the originals.
- First Vitest attempt failed during import, with zero tests, because the new main dependency
  @pospay/import-workbooks had no local build. After inspecting their scripts, builds of
  @pospay/import-workbooks, @pospay/domain, @pospay/contracts and @pospay/db each exited 0.
  The next focused run reached SA-10: one test failed, process exit 1, total 51.97 seconds.

## Required next step

Spec 058 SA-10 and the manager plan review require returning the sale to spec review
when this budget fails. Further dependent implementation, race tests, guards, Astra
review and PR publication are therefore not complete and remain stopped here. The
failing test stays enabled. b2 HTTP work remains preserved in the pre-split commits;
no route, migration, deploy or second session was added.

The PP-136 advisor recommended running SA-10 first and agreed with the transaction-only
boundary. Its read of PRD/owner decisions was incomplete and it executed no tests; it
is advice only and does not satisfy the independent Astra review gate. No new business
answer or permission to relax SA-10 is inferred from it.
