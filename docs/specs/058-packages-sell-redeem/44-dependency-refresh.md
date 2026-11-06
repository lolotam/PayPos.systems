# Row 44 dependency refresh

Date: 2026-11-05. Baseline: `cc085aac` (main, PR #841).

- `gh pr list --state open --json number,title,headRefName,createdAt` returned only #842 (owner-decision documentation). Its complete file list was checked with `gh pr view 842 --json files`; none overlaps the row 44 implementation files in orders.
- #838 supplies redemption storage, contracts and reversal integrity; #839 supplies the temporary 054/055 refusals and permanent price-edit refusal; #841 supplies the component-locked redemption writer. All three are on this baseline.
- 42-3b owns sales files in progress. Row 44 must not edit sales files or package sale writers.
- No migration is needed: existing redemption reversal columns, cancellation FK, slot UPDATE grants and deferred integrity triggers support the specified transaction. Do not create or number a migration. If implementation reveals a storage gap, stop and report it.
- Scope: extend the existing 054 writer, lift the temporary 055 refusal, retain and rerun RC-06, and fix #843 (SessionError-only catch in record and append, unchanged database-error propagation, fresh authority before append date validation).
- Required tests: real PostgreSQL on a private `lane.mjs` cluster; happy path, lowest free slot reuse, idempotent replay/double cancel, concurrency, rollback, expiry, tenant isolation, performer preservation and price refusal. No `.env` may be read or copied.

This refresh is dependency evidence, not an implementation or gate-pass receipt.
