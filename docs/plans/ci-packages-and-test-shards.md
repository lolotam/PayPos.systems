# CI packages and test shards

## Scope

This change separates package integration tests from the static check job and increases the existing app test shard counts.

- `packages-tests` owns the existing package integration, RLS-negative, and EXPLAIN workload.
- `api-tests` expands from four shards to eight without changing its Vitest selection.
- `worker-tests` expands from one job to four direct-Vitest shards.
- `build` and `ci-gate` require the new package job as well as every previously required job.

It does not enable the expanded proposal's steps 1 or 3, change CLAUDE.md PP-131.3, or alter deployment behavior.

## Gate contract

`changes` remains the only classifier and still fails closed when classification is unknown.

| Classification | Required heavy-job results | `ci-gate` |
| --- | --- | --- |
| `code=true` | `check`, `packages-tests`, `api-tests`, `worker-tests`, `build`, `images`, and `admin-document-popup` succeed | Success |
| `code=false` | Every heavy job is skipped | Success |
| Unknown or any other result | No skipped or failed dependency is accepted | Failure |

For code changes, `build` requires success from `check`, `packages-tests`, and `api-tests` as before for their respective workloads.
`admin-document-popup` still starts only after a successful `build`.
The PR #909 exception remains limited to a failed `worker-tests` ancestor for that pull request; `ci-gate` still requires worker success.

## Test selection

- `check` keeps all static gates, generated-client checks, domain tests, and the separately configured API unit tests.
- `packages-tests` runs the unchanged Turbo filter excluding only domain, API, and worker from this package integration command.
- Each API shard invokes the existing default Vitest configuration with `--shard=N/8`.
- Each worker shard invokes the existing default Vitest configuration with `--shard=N/4`.

The API default configuration retains `src/**/*.spec.ts`, its global database setup, timeouts, and serial file execution.
The worker default configuration retains the same selection and isolation model.
Direct worker Vitest avoids Turbo's `worker#test` dependency on `api#test`, preventing an additional unsharded API run.

## Preserved release behavior

- Workflow permissions, environment references, secret references, runners, and timeouts are unchanged.
- Docker builds remain sequential, including both staging variants on pull requests.
- Images are pushed only for a push to `main`, using the existing commit-SHA tags and registry token reference.
- `admin-document-popup` gains no cache step or new dependency, and its existing browser assertions are unchanged.

## Parent verification

Validate the final YAML, action references, dependency graph, expressions, and gate truth table with the available reviewed tooling.
Inspect the complete selected suites and confirm eight API partitions and four worker partitions cover every existing spec exactly once.
Run the normal separately reviewed PR and require exact-head CI and all applicable reviews before merge.
Compare real GitHub run and job durations with the supplied historical baseline, labeling skipped jobs accurately.
Do not claim a runtime or timing improvement before that evidence exists.

Static candidate preparation did not execute the workflow, tests, actionlint, or a GitHub run.
