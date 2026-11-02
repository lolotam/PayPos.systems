# CI performance — baseline (CI-PERF Phase A)

Roadmap code `CI-PERF` — «قياس وتسريع فحوص CI مع الحفاظ على الجودة». This file records how long the `CI` workflow takes
today and what it executes, **before** any scheduling or caching change. Phase A adds measurement only; it changes no
gate, no command, no concurrency and no cache key.

## 1. Baseline from existing runs (before instrumentation)

Source: the GitHub Actions jobs API (`gh api repos/lolotam/PayPos.systems/actions/runs/<id>/jobs --paginate`) and the job
logs (`gh run view --job <id> --log`) of three `push` runs on `main`, all `success`, standard `ubuntu-latest` runners.
Job time is `completed_at − started_at`; wall time runs from the start of `changes` to the end of `ci-gate`.

| Run | Head | `check` | `full-check` | api shards (each) | `images` | `build` | Wall time |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [41379740955](https://github.com/lolotam/PayPos.systems/actions/runs/41379740955) | `034db9cd` | 16 m 16 s | 53 m 46 s | 8 m 27 s – 10 m 06 s | 6 m 52 s | 1 m 48 s | 70 m 20 s |
| [41433297180](https://github.com/lolotam/PayPos.systems/actions/runs/41433297180) | `7b52176f` | 13 m 05 s | 53 m 25 s | 6 m 34 s – 9 m 11 s | 8 m 42 s | 1 m 59 s | 66 m 53 s |
| [41478671079](https://github.com/lolotam/PayPos.systems/actions/runs/41478671079) | `68e3e360` | 16 m 00 s | 44 m 07 s | 6 m 44 s – 9 m 48 s | 9 m 06 s | 0 m 47 s | 60 m 41 s |

- The critical path is `changes → check → full-check → ci-gate`. `full-check` needs `check`, so it starts only after
  `check` ends, and it is about three quarters of the wall time.
- Inside `full-check`, the step `pnpm check` alone took 51 m 54 s in run 41433297180 (Turbo printed `Time: 51m32.105s`)
  and Turbo printed `Time: 42m28.451s` in run 41478671079. Install, Postgres/Redis start-up and the Turbo cache restore
  take under 20 seconds each in every job.
- The four `api-tests` shards run beside `full-check`, so they are not on the critical path.

These are three runs with different heads and different cache contents. They describe the current shape; they are not a
controlled comparison, and no speed-up is claimed from them.

## 2. What the logs show about the Turbo cache

`turbo.json` gives `test` no `cache: false`, so Turbo caches test tasks and, on a hash match, **replays the saved log
instead of running the tests** (`cache hit, replaying logs`). Every job restores `.turbo/cache` with the broad
`turbo-Linux-` restore key.

In `full-check` of run 41433297180, 11 of the 18 `test` tasks were replayed from cache (commissions-engine, config,
contracts, documents, domain, i18n, ids, notifications, observability, storage, ui) and 7 executed (admin, api, auth,
business, db, pos, worker). In the `check` job of runs 41433297180 and 41478671079, the cache-hit `test` tasks were
commissions-engine, config, domain, ids, notifications, storage and ui.

In these three runs `@pospay/db#test`, `@pospay/auth#test`, `@pospay/api#test` and `@pospay/worker#test` were cache
misses, because their inputs had changed. **That does not prove the policy is safe:** a change that leaves those inputs
untouched would let Turbo replay the database, RLS-negative and integration suites instead of executing them. The
`api-tests` shards call vitest directly and always execute. Phase A records the cache status of every task so the actual
hits are visible; the policy change belongs to Phase B.

## 3. What Phase A1 records

Per job (`check`, `full-check`, each `api-tests` shard), one artifact `ci-telemetry-<job>-<attempt>`, kept 14 days, built
by `scripts/ci-telemetry/cli.mjs` from an allowlist of fields:

- every Turbo task: duration, cache status and source, exit code, dependencies (`TURBO_RUN_SUMMARY=true`, which does not
  change any task hash);
- the run metadata needed for a like-for-like comparison: commit, PR head and base, event, run attempt, runner OS and
  architecture, Node and pnpm versions (the Turbo version is in each Turbo run).

A missing Turbo summary is listed as incomplete, never as zero. Only validated metadata fields leave the environment;
raw summaries, command lines, input hashes, absolute paths and failure messages are not uploaded. Upload steps run with
`if: always()` and are best-effort: a hard cancellation or runner loss can prevent an artifact.

A1 measures Turbo tasks only. Direct Vitest calls (API shards and worker) have no per-file telemetry yet; their job
artifacts contain the Turbo build summaries only. Per-file timings and memory/load measurements remain Phase A2 work.
Install and direct test step durations remain available through the Actions jobs API, separate from Turbo durations.

## 4. Instrumented run

Pending the first instrumented CI run: record its run id, head, per-task durations of `pnpm check`, cache hits/misses,
replayed test tasks and Actions step durations. No measured improvement is claimed before an equivalent comparison.
