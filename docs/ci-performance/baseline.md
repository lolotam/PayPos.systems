# CI performance — baseline (CI-PERF Phase A)

Roadmap code `CI-PERF` — «قياس وتسريع فحوص CI مع الحفاظ على الجودة». This file records how long the `CI` workflow takes
today and what it executes, **before** any scheduling or caching change. Phase A adds measurement only; it changes no
existing gate command, concurrency or cache key.

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

Run [41514441911](https://github.com/lolotam/PayPos.systems/actions/runs/41514441911), attempt 1, completed successfully
on PR head `8aa020bb485dd6d55158b7aaa6e34c34bf97e13d`: all 10 CI jobs succeeded, including all four API shards,
`full-check`, build, images and `ci-gate`. Sources are its jobs API and all six downloaded telemetry artifacts.

The event was `pull_request`, base `89da918358cbec0ffd43d9b41f768e0eb54337da`, synthetic merge checkout
`9a57c90b6abaa3b08d621bc46222517faa378143`. `check` and API shards used that merge checkout; `full-check` explicitly
used the PR head. Its old `meta.commit` incorrectly reports the merge SHA; the R3 correction records actual checkout
HEAD instead. These first-run artifacts predate that correction and are not rewritten or treated as new-head evidence.
Recorded toolchain: Node `v24.22.1`, pnpm `12.5.1`, Turbo `2.11.2`, Linux X64; all jobs used `ubuntu-latest`.

### 4.1 Job and step durations

Job time includes setup and post-job work. Actions step timestamps have one-second resolution: `0 s` means the step
started and completed in the same recorded second. Steps below run within their jobs and must not be added to job time.

| Job | Job time | Install | Build step | Test/check step |
| --- | --- | --- | --- | --- |
| `check` | 8 m 45 s | 7 s | included in worker step | worker build + direct Vitest: 6 m 59 s |
| `full-check` | 1 m 38 s | 5 s | API/worker dependencies: 0 s | literal `pnpm check`: 15 s |
| API shard 1 | 9 m 18 s | 6 s | dependencies: 0 s | direct Vitest: 8 m 27 s |
| API shard 2 | 9 m 00 s | 6 s | dependencies: 1 s | direct Vitest: 8 m 03 s |
| API shard 3 | 8 m 00 s | 6 s | dependencies: 0 s | direct Vitest: 7 m 01 s |
| API shard 4 | 9 m 50 s | 5 s | dependencies: 0 s | direct Vitest: 8 m 55 s |
| `build` | 1 m 06 s | 5 s | all apps: 1 s | — |
| `images` | 7 m 35 s | — | image build step: 7 m 21 s | image-secret inspection: 9 s |

Wall time from `changes` start (19:55:40 UTC) to `ci-gate` completion (20:15:57 UTC) was **20 m 17 s**. The path that
finished last was `check → API shard 4 → build → ci-gate`; this differs from the historical cache-miss-heavy runs.

### 4.2 Turbo records and cache coverage

All 11 Turbo summaries in the six artifacts report complete, with no missing-timing tasks or incomplete-file entries.
All 234 task records are cache hits (records repeat tasks across commands/jobs): **zero Turbo task cache misses and zero
fresh Turbo task executions**. Direct Vitest commands are outside those Turbo counts.

| Artifact/job | Turbo summaries: task count / cache hits / run duration |
| --- | --- |
| `check` | typecheck 29/29/186 ms; lint 30/30/84 ms; domain 2/2/52 ms; packages 28/28/516 ms; worker build 12/12/213 ms |
| `full-check` | dependency build 13/13/264 ms; `pnpm check` Turbo invocation 68/68/270 ms |
| API shard 1 | dependency build 13/13/479 ms |
| API shard 2 | dependency build 13/13/496 ms |
| API shard 3 | dependency build 13/13/361 ms |
| API shard 4 | dependency build 13/13/479 ms |

The `pnpm check` invocation lists 15 build, 17 typecheck, 18 lint and 18 test task records. Every task's ID, dependencies,
exit code and replay duration are in the full-check JSON; its Markdown intentionally shows only the 15 slowest records.
The 18 test task replay times are below, all `HIT`. These are **log replay milliseconds, not test execution times**.

| Package (`@pospay/…#test`) | Replay duration (ms) |
| --- | --- |
| api | 4 |
| admin | 1 |
| auth | 1 |
| business | 1 |
| contracts | 1 |
| i18n | 1 |
| ids | 1 |
| notifications | 1 |
| pos | 1 |
| storage | 1 |
| worker | 1 |
| commissions-engine | 0 |
| config | 0 |
| db | 0 |
| documents | 0 |
| domain | 0 |
| observability | 0 |
| ui | 0 |

`check` also replayed 16 distinct test tasks, including `db` and `auth`. This demonstrates the **inherited DB-test cache
limitation in an actual run**: green `full-check` does not establish fresh execution of its DB, migration, RLS-negative
or integration assertions. The four API shards and worker invoked Vitest directly and their steps succeeded, but this
does not prove that every database suite covered by the cached tasks executed afresh. A1 preserves this cache policy;
changing it belongs to Phase B. Neither the 15-second check step nor the total wall time is a measured speedup: source,
event and cache conditions differ from the historical runs.

### 4.3 Artifact receipts and remaining measurement limits

- [check, 13173909252](https://github.com/lolotam/PayPos.systems/actions/runs/41514441911/artifacts/13173909252)
- [full-check, 13175103256](https://github.com/lolotam/PayPos.systems/actions/runs/41514441911/artifacts/13175103256)
- [API shard 1, 13175538558](https://github.com/lolotam/PayPos.systems/actions/runs/41514441911/artifacts/13175538558)
- [API shard 2, 13175966507](https://github.com/lolotam/PayPos.systems/actions/runs/41514441911/artifacts/13175966507)
- [API shard 3, 13176825042](https://github.com/lolotam/PayPos.systems/actions/runs/41514441911/artifacts/13176825042)
- [API shard 4, 13176220794](https://github.com/lolotam/PayPos.systems/actions/runs/41514441911/artifacts/13176220794)

Each artifact contains sanitized JSON and Markdown, with a 14-day retention period. All six were downloaded and
inspected before publication. API shard artifacts measure their Turbo dependency builds; they do not contain the
direct tests' file timings. A2 still owes per-file timings and memory/load measurements. No measurement here removes
any requirement for fresh CI and five external review receipts on the correction head.
