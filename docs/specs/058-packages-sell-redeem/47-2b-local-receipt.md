# 47-2b local verification — 2026-11-06

Current base: main `dd7c42baaa04b5cb0df5fde03cb739ffde7e9e78`, after #883/0214.
The manager granted the lane after that merge on 2026-11-06. Final local numbering
is 0215/0216; no push or PR, because full-bound performance remains blocked.

## Migration order

PP-136 advice confirmed the existing runner requires two entries. Draft A
(`47-2b-contract.draft.sql`) adds nullable accepted membership, its NOT VALID FK,
the narrow grant and contract guards. Draft B (`47-2b-index-validate.draft.sql`)
starts with CREATE INDEX CONCURRENTLY, then SET LOCAL lock_timeout and VALIDATE.
Existing rows remain NULL; no backfill, file reread or merged SQL is modified.
PP-134's verbatim answer remains unchanged in the owner audit.

Before the lane grant, tests used actual applyMigrations with temporary draft
fixtures outside the repository. After rebasing, the parent generated schema entry
0215 with pnpm db:generate package-import-commit-contract, preserved reviewed draft A
in its SQL, then generated 0216 with --custom and copied reviewed draft B. The
ordinary generated index is intentionally created only in 0216's concurrent prefix.
Journal idx 215/216 and snapshot prevId 0214->0215->0216 are verified; migration-chain
check passes. Merged SQL and snapshots through 0214 are untouched.

- 0215 SHA256: `3489780f8d577f7a77fdc17f32474dc0ab94c223d70cf21fe4eb6be931bf4125`.
- 0216 SHA256: `f39d230f570a6d7f7c081f16bfebd4c29081c74fcc8bdb02040a186ee979d10c`.

The first actual-numbered worker regression run had 145/147 passing, with two
staff job lock-timeout failures; the simultaneous DB setup also timed out waiting
for the cluster role lock. These are failed receipts. The worker's first failure
was the existing two-worker/same-500-row-preview test; the later counter wait can
be consequential. Static typecheck/lint/docs/map/chain and boundaries passed on the
new base. With all competing local gate/setup processes finished, the unchanged
staff job file passed alone (8/8, 41.33 seconds), including its two-worker same-
500-row-preview assertion. Then the real-numbered DB selection passed alone
(8 files, 103 tests, 76.99 seconds). No deadline, lock assertion or guard was weakened.
The separate successful runs validate these cases; the initial combined failed
run remains recorded and is not relabeled as a clean run.

## Completed checks

- Full local typecheck, lint, lint:docs and module-map:check passed. Documentation
  lint reports 0 errors and the 29 pre-existing warnings. Boundaries: 3 tests passed.
- Selected DB tests: 8 files, 103 tests passed, including concurrent migrations,
  privileges, function inventory, money, composition, guards, FK indexes and RLS.
- Initial worker selection: 11 files, 138 tests passed; separate Redis processor
  selection: 3 files, 7 tests passed. After the retry redaction change, commit and
  redaction selection: 2 files, 17 tests passed. These selections overlap; do not
  add their counts as independent tests. The final combined worker selection
  passed: 15 files, 147 tests, 62.78 seconds. Together with the selected DB and
  boundaries tests, 253 non-overlapping tests passed.
- Benchmark discovery was checked using vitest list --filesOnly: the dedicated
  vitest.package-import-benchmark.config.ts selects only the .benchmark.ts file;
  default worker discovery selects none for that filename filter.

## Independent review and fixes

PP-136 advisor and Astra high reviewed the design. Astra high then reviewed the
actual financial implementation and SQL, finding two additional P2 issues and no
proven P0/P1 or additional money defect. Both P2 findings were fixed:

1. PackageCommitRetryError exposes only a fixed retry message and optional safe
   failureCode; no raw SQL, source parameters or cause escape from execution or
   terminal failure persistence. Tests cover both paths. 47-2c must preserve that
   safe failureCode during retry/finalization, as for preview jobs.
2. The full-bound benchmark is named .benchmark.ts and uses a dedicated opt-in
   config, outside the normal src/**/*.spec.ts discovery. It is not a routine CI
   worker test and its 30-minute ceiling is not a production transaction budget.

The ordinary index found by the parent was split into draft B's concurrent prefix.
Self-review applies clean-code-guard, test-guard and docs-guard to these changes.

## Infrastructure and performance status

Private Postgres lane: lane.mjs up packages-47-2b, bound to localhost:55418,
Postgres 16 with the dev-compose resource/timeout settings and a 1 GiB memory limit.
Private Redis 7: localhost:56488. The local .env was created only from .env.example
with fresh random secrets and git check-ignore .env passed. No other env was read
or copied. Redis test commands explicitly override REDIS_URL to the private instance.

The first full-bound attempt produced no completion/exit receipt and left no
financial writes committed; it is not a passing benchmark or a production timeout
measurement. The second attempt used a separate hidden local test process with
durable output and an exit-code receipt. It FAILED at the 30-minute test ceiling:
test duration 1,800,840 ms, total run 1820.42 seconds, exitCode 1 at
2026-11-06 12:47:32.732 Kuwait. The safe error was PACKAGE_IMPORT_COMMIT_RETRY.
There is no completedCommit success receipt or emitted elapsedMs/peakRss/peakHeap
measurement. The safe wrapper intentionally omits the internal error, so this does
not identify whether writing, finalization or deferred COMMIT checks dominated.

Highest observed docker-stats sample: 378.7 MiB / 1 GiB. This is not a proven peak
and excludes reclaimable cache. The container was not OOM-killed or restarted.
At 12:49 Kuwait, the private cluster had no active test transaction or remaining
test/template database after teardown. Evidence retained in task TEMP:
pospay-47-2b-full-bound-v2.log and pospay-47-2b-full-bound-v2-status.json.

This is a performance readiness blocker, despite the 253 passing focused tests
and static gates. Do not increase timeout, reduce file/session bounds, split the
financial transaction or claim readiness. Next diagnostic proposal: stage timings
for writes/finalization/COMMIT, safe error classification without SQL parameters,
and smaller controlled scaling runs before another full-bound attempt. No such
diagnostic rerun or design adjustment is claimed in this receipt.
No bound or atomicity has been reduced. Full suite and API shards remain CI-only.
