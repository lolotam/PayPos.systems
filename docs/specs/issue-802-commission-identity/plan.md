# Execution plan

Manager reviewed Sol planning plus Astra advisory on 2026-11-10 under the owner's batch-only lane exception. No unresolved business questions.

1. Write focused domain/use-case and real-PostgreSQL regressions first. Stop for manager review and failing-baseline execution before production changes.
2. On continuation, extend held-head types and tenant-scoped projection, and validate strictly newer identities in domain selection before timezone/period orchestration. Update local fixture heads and Arabic comments.
3. Manager reads every changed file before running targeted regressions and applicable local gates. Initial implementer retains failed attempts until clean handoff.
4. Run clean-code/test/docs guards and independent review; do not claim completion before applicable exact-head CI/review gates.

Private worktree: `F:/Dev/Worktrees/PosPay/fix-802-commission-identity`. Private database lane: `batch-20261110-802`, `127.0.0.1:55410`. No copied environment or shared Redis. Worker has file tools only by instruction: no shell, git, generators, tests, publication or deployment. One task, one eventual PR.
