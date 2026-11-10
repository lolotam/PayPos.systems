# Execution plan

Sol planner and Astra advisory were reviewed by the manager on 2026-11-10. The owner approved this batch-only lane substitution and independent worktree/database execution.

1. Write focused real-catalog regression tests first. Hand tests back for manager review and an expected failing baseline; do not change production in this first stage.
2. On manager continuation, add the exact schema index declaration.
3. Hand back schema and tests. Do not run shell, git, generators or tests; the manager owns execution.
4. `I836-Q1` authorizes manager-only migration/journal integration. After schema review, the manager generates, reviews SQL/snapshot and performs private-lane migration tests. Workers never edit the journal.
5. Run applicable guards, targeted tests, type/lint/docs/module-map and migration-chain checks. Full heavy gates remain in CI.

Private worktree: `F:/Dev/Worktrees/PosPay/fix-836-fk-index`. Private database lane: `batch-20261110-836`, `127.0.0.1:55444`. Credentials are independently generated, ignored and never copied. No Redis use. One separate PR; no worker commit, push, merge or deployment.
