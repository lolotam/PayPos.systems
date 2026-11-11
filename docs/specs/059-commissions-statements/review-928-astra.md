# PR #928 internal review — Astra (gpt-6-astra, effort high, read-only)

Run 2026-11-11 on head `2f7d2738e`, diff `origin/main...HEAD`, against CLAUDE.md, spec 059 and plan-50-2b-c2. Output verbatim:

1. **P2 — Valid salary events rejected for UUID casing** — [project-salary.ts:83](/F:/Dev/Worktrees/PosPay/feat-p1-059-50-projection-consumer/apps/worker/src/modules/commissions/use-cases/project-salary/project-salary.ts:83). The salary API accepts uppercase employee UUIDs and preserves them in the payload; PostgreSQL normalizes the envelope’s `aggregate_id` to lowercase. This comparison rejects the same UUID with `AGGREGATE_MISMATCH`, leaving the salary unprojected through retries and parking. Reproduced read-only. **Done:** compare canonicalized UUIDs; add a regression covering uppercase payload versus lowercase persisted envelope, including legacy events.

2. **P2 — Required statement-lock ordering tests missing** — [commission-tip-salary-concurrency.spec.ts:132](/F:/Dev/Worktrees/PosPay/feat-p1-059-50-projection-consumer/apps/worker/src/modules/commissions/__tests__/commission-tip-salary-concurrency.spec.ts:132). These tests block identity advisory locks only. They do not prove either writer acquires `lockStatementPeriods` on the same transaction before its first projection write, explicitly required by spec FR-004. Existing closed-month tests would still pass if projection writes happened first and subsequently rolled back. **Done:** exercise both writers with `expectLockBeforeFirstWrite` from `packages/db/test/statement-lock-order.ts`, checking `commission_tip_heads`, `commission_tips`, and `commission_salaries`.

## Session verdict

1. Raised to P1 by the coordinator after tracing producers: the salary producer builds `payload.employee_id` from the route parameter (`employee-salaries.controller.ts:48`, `z.uuid()` keeps case; `set-salary.ts:69`; `drizzle-salary-transactions.ts:62`), while the worker reads `aggregate_id` from a `uuid` column in lowercase. Tip and service-line producers take `session_id` from DB rows or server ids, so they cannot mismatch. Fixed in a separate PR covering all three normalizers and the producer; PR #928 waits for it.
2. Accepted as P2, deferred to issue #930: add `expectLockBeforeFirstWrite` coverage for the tip and salary writers.
