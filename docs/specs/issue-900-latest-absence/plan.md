# Execution plan

Manager reviewed Sol planning and Astra risk advisory on 2026-11-10, under the owner's batch-only model exception. No new owner business question.

1. Write dedicated result/EXPLAIN/multi-year performance regressions first; stop for manager source review and baseline measurements before production changes.
2. On continuation, build query-only early seeking and bounded refinement, reusing exact coverage semantics. Preserve company/business scoping and UTC-safe stop proof.
3. Manager reviews SQL and all executed tests before running them on the task's private PostgreSQL. Compare recent, old and exhaustive cases without weakening a gate.
4. Run relevant guards, targeted regression/performance tests and local type/lint/docs/module-map checks. Heavy suites remain in CI. Any failing real threshold is investigated, not hidden by retries or relaxed assertions.

Private worktree: `F:/Dev/Worktrees/PosPay/fix-900-latest-absence`. Private lane: `batch-20261110-900`, `127.0.0.1:55409`. Independently generated ignored credentials; no copied env or shared Redis. Worker runs no shell/git/tests/generators and performs no commit, PR, merge or deployment. One eventual PR.
