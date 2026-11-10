# Execution plan

Manager reviewed Sol planning and Astra advisory on 2026-11-10 under the approved batch-only lane substitution. No unresolved questions.

1. Extend the current rendered regression with selectable/reset locale, missing cells and populated controls. Stop for manager review and baseline run before production edits. A green visible baseline is expected because the display must not change.
2. On continuation, add one bilingual key and replace both literals, preserving layout.
3. Manager reviews diff, applies code/test/docs guards and runs focused admin spec plus applicable i18n/type/lint/docs/module-map checks. No full heavy suite locally.

Private worktree: `F:/Dev/Worktrees/PosPay/fix-774-catalog-placeholder`. Reserved private PostgreSQL lane: `batch-20261110-774`, `127.0.0.1:55481`; UI tests need no DB. No copied secrets or shared Redis. No worker shell/git/tests/generators/publication/deployment. One eventual PR.
