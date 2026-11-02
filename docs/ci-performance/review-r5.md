# CI-PERF A1 — overall exit consistency, final R5/5

Source head: `9c0351f4b724048714f6838ac1003fcf23fb481a`. This is logical correction round 5 of 5, without reset or a
sixth round. The [complete panel receipt](https://github.com/lolotam/PayPos.systems/pull/806#pullrequestreview-5742972923)
has all four roles completed on that head and explicitly confirms the prior outcome and Arabic-comment corrections.
It does not approve the subsequent R5 head.

## Disposition and source evidence

[4447440950](https://github.com/lolotam/PayPos.systems/pull/806#discussion_r4447440950), MEDIUM: accepted after checking
Turbo 2.11.2's continuation and error handling. The [task executor](https://github.com/vercel/turborepo/blob/v2.11.2/crates/turborepo-task-executor/src/exec.rs)
adds a nonzero child exit to the error collector before returning a task failure. `Always` and
`DependenciesSuccessful` continuation modes keep running; `Never` stops the process manager. None clears the errors.
[Run's exit calculation](https://github.com/vercel/turborepo/blob/v2.11.2/crates/turborepo-lib/src/run/mod.rs) takes the
maximum recorded task error code, or defaults to one for errors without a code, and passes that result to the summary.
Therefore the reported failed task with exit one cannot accompany run exit zero in this pinned implementation.

The correction passes run `exitCode` into outcome validation and requires it to be nonzero when `failed > 0`.
This rule has one direction only: a nonzero run exit does **not** require a failed task. Infrastructure or cancellation
outcomes without recorded task failures remain possible, subject to the existing record-completeness checks.
HIT missing/null exit codes and zero durations retain their previous treatment. A coherent failed run may still have
a complete report; completeness does not make the job pass.

## Coverage and size

The real CLI case table retains all earlier mutations and assertions, and adds three cases with JSON/Markdown checks:

- MISS exit one with matching failed/success counts and run exit zero: incomplete, `count-mismatch`.
- The same failed task and counts with run exit one: complete, without an incomplete marker.
- A successful task and matching counts with run exit one: complete, preserving the legitimate reverse case.

The duplicated child-process launcher is now shared by the two CLI spec files in `test-cli.mjs`. It keeps the existing
environment merge and step-summary isolation behavior. Its **11 lines count as test code**: the refactor reduced the
700-line total to 686 before adding regressions; the final total is 693/700. No prior coverage was removed, no lines
were compressed, and no test code was reclassified as production to meet the ceiling. Production telemetry is 452/680
lines, each production file below 300; workflow remains unchanged from R4.

Lead execution: all 33 scoped tests pass, none skipped. Fresh exact-head independent review and external CI/review
receipts are required before readiness. No scheduling, cache, gate, configuration, dependency or deployment changes
are included. The manager retains monitoring; no polling or watch is started by this task session.
