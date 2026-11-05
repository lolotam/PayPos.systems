# 50-2b card 1 — schema refresh

Refresh: 2026-11-05. Baseline: `cc085aac` (`origin/main` fetched before inspection).

## Scope and overlap

- `gh pr list --json number,title,headRefName,files` returned only #842, the owner-decision documentation PR.
- Its seven paths are process documents; none overlaps the proposed DB schema, migrations, contracts or tests.
- #790 (50-1), #813 (50-2a) and #826 are merged and present on the baseline.
- #790 supplies the existing commission-line consumer and tenant test fixtures. #826 tests the real producer/delivery path without production changes.
- #813 supplies the accepted pure tip/salary reducers: 190 production and 287 test lines count inside the overall 50-2b ceiling.
- Card 1 is limited to three tables, their keys, checks, RLS, grants, indexes, necessary contracts and DB isolation tests; at most 600 production and 600 test lines.
- Overall approved ceiling: 1,100 production, 1,400 test and 80 documentation lines, including 50-2a history.
- Card 2 consumer integration and card 3 staff-owned legacy employee/business reader remain separate later PRs.

## Design against spec and reducers

- All three tables carry `company_id`, `business_id`, UUID v7 `id` and primary key `(company_id, id)`.
- `commission_tip_heads`: session, branch, positive revision, business date and matching period; unique `(company_id, session_id)`.
- Keep the head after an empty replacement so an older event cannot recreate removed tips (CM-18).
- `commission_tips`: session, employee, CASH/CARD method and nonnegative amount; unique `(company_id, session_id, employee_id, method)`.
- Heads also have `UNIQUE(company_id, business_id, session_id)` as the target of the tips' three-column FK; employees and branches must belong to that same company and business.
- Session identity is an event snapshot, with no FK to orders-owned session tables, following 50-1's boundary.
- `commission_salaries`: employee, effective date, nonnegative amount and positive revision; unique `(company_id, employee_id, effective_from)` (CM-19).
- Amounts use SQL `numeric(14,3)` and existing reducer `Money`/bigint mills, without JavaScript number conversion.
- Head grants: SELECT/INSERT and UPDATE only on revision/branch/date/period. Tips: SELECT/INSERT/DELETE for replacement. Salaries: SELECT/INSERT and UPDATE only on amount/revision. Row identities are immutable to the app.
- Every table has ENABLE and FORCE RLS, tenant USING/WITH CHECK policies and indexed foreign keys; other runtime roles receive no privileges.
- Reuse existing `SessionTipsChanged` and `SalaryChanged` Zod contracts. Salary business is optional for legacy events; schema does not implement its resolver.
- CM-25 delivery, consumed mark atomicity, replay and legacy routing belong to later cards; card 1 does not claim their completion.

## Migration and validation

- Current main journal ends at `0207_2026-11-05_rating-requests-scheduled-index`; next free number is `0208`.
- Recheck main immediately before generation/push; never modify or renumber a migration already merged.
- Schema artifacts must be generated with drizzle-kit; custom RLS/grant statements preserve dependency order.
- Planned tests: successful exact money round trip, natural-key uniqueness, wrong business/tenant foreign keys, invalid money/method/revision/period, head retained after tip deletion, negative SELECT/INSERT/UPDATE/DELETE, tenant-changing UPDATE, isolated UPSERT, missing tenant context and foreign-role denial.
- Local gates: typecheck, lint, lint:docs, module-map:check and owned DB tests on `lane.mjs up 50-2b-c1`.
- Required guard passes: clean-code-guard, test-guard, docs-guard; then fresh read-only Astra high DB review before publication.
- Schema generated as `0208_2026-11-05_commission-tip-salary`; custom RLS/grants as `0209_2026-11-05_commission-tip-salary-rls`. Both are provisional until the manager sets merge order.
- Astra high design advice accepted: exact three-column head FK, minimal column UPDATE grants and bounded amount CHECK rejecting NaN. This advice is separate from the final DB review.
- First DB attempt failed before tests because workspace dependencies were unbuilt; built the DB dependencies and retried. The next run passed 43/45 tests; two privilege checks exposed unsorted new allowlist entries, now corrected. Lint also caught a non-null assertion, now removed. Final verification is pending.
- The lane initially refused a missing local `.env`. The manager's 14:00 direction authorized creating only this worktree's file from `.env.example`, randomizing password/secret/token/key values and preserving non-secret settings. `git check-ignore .env` succeeded; no other `.env` was read or copied. The owned cluster started on loopback port 55404; it must be stopped after tests.
- Local validation passed: `pnpm --filter @pospay/db typecheck`, `pnpm --filter @pospay/db lint`, `pnpm lint:docs` (0 errors, 29 existing warnings), `pnpm module-map:check`, Prettier and `git diff --check`.
- The two owned projection specs plus `privileges.spec.ts` passed 45/45 tests in 202.25s. After strengthening the cross-tenant UPDATE revision assertion, the isolation spec passed 8/8 again in 36.35s; scoped ESLint and DB typecheck passed on that change.
- Owned lane `50-2b-c1` was stopped successfully after the final run, removing its container, data volume and lane override. The ignored worktree-local test `.env` remains untracked and is never staged.
- Guard passes completed: clean-code-guard (declarative schema, no business arithmetic or new runtime surface), test-guard (real Postgres, no mocks; strengthened the UPDATE oracle), docs-guard (corrected grants and recorded actual failures and receipts).
- Status: implementation and local gates complete; final independent DB review pending. No push, PR, merge or deploy yet. CI remains required on the published head.
- PP-124/125 are supplied by the task and pending #842; baseline owner-decision file currently ends at §61.
- Migration merge belongs to the manager. This session must not merge or deploy.
