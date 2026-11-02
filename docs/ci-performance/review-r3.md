# CI-PERF A1 — external review disposition, R3/5

Reviewed source head: `8aa020bb485dd6d55158b7aaa6e34c34bf97e13d`. This is correction round 3 of 5, without a reset.

## Receipts

[Codex receipt](https://github.com/lolotam/PayPos.systems/pull/806#pullrequestreview-5742531089) records that head.
The [complete MergePilot panel receipt](https://github.com/lolotam/PayPos.systems/pull/806#pullrequestreview-5742532466)
has the same full head in its marker and all four roles completed: cross-file consumers, context outside the diff,
security, and owner rules. Security and owner findings were published in the cross-file bot's wording, as the receipt
explicitly records. These receipts establish completion on the old head; they do not approve the correction head.

## Disposition

- [4447082891](https://github.com/lolotam/PayPos.systems/pull/806#discussion_r4447082891) and
  [4447084081](https://github.com/lolotam/PayPos.systems/pull/806#discussion_r4447084081): accepted, same attribution
  defect. Each report step now supplies `git rev-parse HEAD` as `CI_TELEMETRY_CHECKOUT_SHA`. `meta.commit` accepts only
  that validated value, with no fallback to the event SHA. Checkout settings, gate commands and cache keys stay intact.
- [4447084091](https://github.com/lolotam/PayPos.systems/pull/806#discussion_r4447084091): the proposed exclusion is
  rejected for normal Turbo 2.11.2 runs. Source evidence below shows no-command tasks are omitted before execution
  tracking. Entries without execution remain visible and incomplete; dry-run output lacks the required run execution
  block and is not a completed run. A real CLI regression retains the entry and its task instead of filtering it out.
- [4447084104](https://github.com/lolotam/PayPos.systems/pull/806#discussion_r4447084104): accepted. Required sanitized
  identity/version fields, counters, dependencies and cache measurements must be valid. Unknown cache status produces
  `malformed`; missing timing remains `unfinished`. Counts must reconcile with task count and cache hits. A `MISS`
  has `timeSaved: 0` and omits source; a `HIT` requires a valid source and saved time. A missing/null `HIT` exit code
  remains allowed, while a supplied malformed exit code is rejected. Zero duration remains valid.

## Pinned source evidence

In Turbo 2.11.2, [exec_context](https://github.com/vercel/turborepo/blob/v2.11.2/crates/turborepo-lib/src/task_graph/visitor/exec.rs)
returns `Ok(None)` when there is no command. The [visitor](https://github.com/vercel/turborepo/blob/v2.11.2/crates/turborepo-lib/src/task_graph/visitor/mod.rs)
continues on `None` before constructing the task tracker. [ExecutionTracker](https://github.com/vercel/turborepo/blob/v2.11.2/crates/turborepo-run-summary/src/execution.rs)
adds tasks only from tracker messages carrying state. [RunTracker](https://github.com/vercel/turborepo/blob/v2.11.2/crates/turborepo-run-summary/src/tracker.rs)
builds normal summaries from that state list, rather than every task-graph node. This source chain clears the no-script
hypothesis without weakening detection of unfinished tasks.

[TaskCacheSummary](https://github.com/vercel/turborepo/blob/v2.11.2/crates/turborepo-run-summary/src/task.rs) serializes
status and saved time, omits source on a miss, and supplies source on a hit. Other raw fields remain outside the
telemetry allowlist. No command, environment value or source path is added to uploaded artifacts.

## Instrumented evidence

Run [41514441911](https://github.com/lolotam/PayPos.systems/actions/runs/41514441911) was still in progress with zero
artifacts at the R3 inspection. Baseline section 4 remains pending completion; no inferred timings or speedup are added.
The manager owns monitoring and completion notification. The correction is held locally through independent review
and the first run's completion, because pushing earlier would cancel it under the unchanged workflow concurrency.
