# CI-PERF A1 — outcome reconciliation, R4/5

Source head: `97c043bf011cf2f543f638be4c9c1539ed886370`. This is logical correction round 4 of 5, without reset.
The [complete panel receipt](https://github.com/lolotam/PayPos.systems/pull/806#pullrequestreview-5742836949) has that
head in its marker and all four roles completed. Those receipts are not approval of a subsequent correction head.
[Codex's completed receipt](https://github.com/lolotam/PayPos.systems/pull/806#issuecomment-6587607512) names the same
head and reports no major issues. CodeRabbit's non-required review reports no actionable comments, but repeats the
outcome limitation covered below; it does not waive that defect.

- [4447332274](https://github.com/lolotam/PayPos.systems/pull/806#discussion_r4447332274), MEDIUM: accepted. The previous
  sum and cache-hit checks did not reconcile non-cached successes/failures with exit codes. `outcomes.mjs` now derives
  both counts from non-HIT records and requires a HIT exit code to be zero or absent/null. It retains the attempted
  total check. Contradictions produce `count-mismatch`, while missing non-HIT exit codes remain incomplete under the
  existing rule. Outcome validation is separate from whether the run passed: a coherent failed run may be complete.
- [4447332285](https://github.com/lolotam/PayPos.systems/pull/806#discussion_r4447332285), LOW: accepted. The explanatory
  MISS/HIT comment is now Arabic, with identifiers unchanged, following `CLAUDE.md` §3.1.

## Evidence and regression coverage

Pinned Turbo 2.11.2 [SummaryState and TaskTracker](https://github.com/vercel/turborepo/blob/v2.11.2/crates/turborepo-run-summary/src/execution.rs)
increment `cached`, `success` and `failed` for distinct tracker events. `cached()` synthesizes exit code zero. The
[task executor](https://github.com/vercel/turborepo/blob/v2.11.2/crates/turborepo-task-executor/src/exec.rs) records
executed success through `build_succeeded(0)` and task errors through `build_failed(exit_code, message)`.

All 11 summaries in the six preserved artifacts of run41514441911 have `cached == attempted`, `success == failed == 0`
and no nonzero HIT exit codes. They support cached-run compatibility, not fresh execution of failed DB suites. The
documented missing/null HIT exception remains deliberately broader than the zero synthesized by this pinned source.

CLI regressions cover a MISS exit zero paired with `failed: 1, success: 0`, and a MISS nonzero exit paired with a
success counter; both assert incomplete JSON and Markdown. The cached-task regression now rejects HIT exit one and
explicitly accepts HIT null, preserving the existing missing-exit assertions. Existing zero-duration coverage remains.
No prior assertion is removed. A small outcome-validation module keeps each production file below 300 lines without
compressing code. No workflow, dependencies, lint configuration, scheduling, cache or gate changes are included.

Lead validation: all 33 scoped tests pass, none skipped; test sources total 700 lines within the declared ceiling.
Scoped ESLint, Prettier and diff checks pass; `lint:docs` reports zero errors and 29 existing warnings. A separate probe
passes the 11 preserved real-artifact summaries through the actual outcome checker and confirms that a coherent MISS
failure (`exitCode: 1`, `failed: 1`, `success: 0`) is accepted, so completeness remains distinct from run success.

CodeRabbit's repeated outcome limitation is handled by the same fix. Its missing-dependency ESLint sandbox result is
an environment limitation of that review; local lint remains required, and no configuration/dependency workaround is
made for the bot. Fresh external receipts and CI on the correction head remain required; the manager owns monitoring.
