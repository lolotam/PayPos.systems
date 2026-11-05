# 47-1 work in progress — 2026-11-05

Historical initial checkpoint. Superseded by
[the validation and blocker record](47-1-validation-and-blocker.md).

This is an incomplete implementation, not a delivery receipt or lane request.
No commit, push or PR has been made.

Base: `f8a55d6a98e552dc056347c01513c65348bd533d` (origin/main at refresh).
Branch: `T3-CODE/packages-import-preview`.
The initial branch inherited six process-document commits already represented
on main. A normal rebase conflicted; it was aborted. The inherited head is
preserved at `backup/47-1-inherited-policy-20261105`; this branch was then
rebased onto origin/main without replaying the inherited policy commits.

## Implemented so far

- Shared `readWorkbookMatrix(bytes, bounds)` and shared `ImportWorkbookError`.
  Staff adapter supplies its original bounds and maps errors back to
  `EmployeeImportError`. Existing staff test call sites use that adapter.
- Independent orders import cells and row validator, including service-name
  ambiguity, dates, money, complete groups and package-definition checks.
- Explicit session-count allocation and optional explicit session values for
  the slot builder, preserving the full remainder in the final package slot.
- Batched customers public reader with aligned, privacy-limited results and
  orders adapter/port; module-map declaration and ADR-0010 addendum.
- Binding manager design copied alongside the spec; TD-11 method renamed.

## Executed checks

- `pnpm install --frozen-lockfile`: passed.
- `pnpm --filter '@pospay/api^...' build`: passed (workspace prerequisites).
- `pnpm --filter @pospay/api typecheck`: passed after the current source edits.
- Orders package allocation, slots and import-row domain specs: 62 passed.
- Staff xlsx-sheet-reader and xlsx-structure specs: 24 passed on the private
  `packages-47-1` cluster. Cluster and data volume removed with lane down.
- `pnpm lint:docs`: passed with 29 existing warnings at that point.
- `pnpm module-map:check`: initially failed on the new reader declaration;
  passed after declaring the read and regenerating the YAML.
- Targeted production ESLint: found an oversized row function. It was split;
  row-file lint passed afterward. Full lint and the complete local gate set
  have not passed yet.
- `git diff --check`: passed.

The first attempted API test run failed before collection because workspace
package `@pospay/ids` had not been built. The workspace prerequisite build
resolved that setup failure. The initial lane command refused a missing .env;
the worktree .env was then created exclusively from .env.example with fresh
local random secrets. `git check-ignore .env` passed. No other env was read.

## Required work remaining

1. Package preview contract, template and single preview use case, with safe
   duplicate-external-ref handling, batched customer resolution and stored
   preview rows containing no full phone.
2. Read/save adapters and file ownership/readiness/purge validation; declare
   orders-to-files in module-map plus ADR-0010/ADR-0034 addenda.
3. Permission catalog, owner/GM/BM defaults, device denial, i18n and a seed
   migration draft in the 0201 shape. No final numbering or db:generate before
   the manager's explicit lane grant.
4. HTTP guards, feature declaration, route coverage and composition wiring.
   Shared files must be rebased against 42-3b, never hand-merged.
5. Move shared reader tests; add packages bounds and hardening tests, privacy,
   authorization, duplicate, use-case and real-database preview tests.
   The new customer reader has not yet had its own integration test.
6. Complete local gates, clean-code-guard, test-guard and docs-guard; then the
   independent read-only gpt-6-astra medium review and P0–P3 corrections.
7. Report readiness for the migration lane only after the implementation and
   applicable tests are complete; final migration generation and push wait
   for `lane granted`. No PR until the required review and gates pass.

No 47-2 commit route, worker, event or sweep was added. No sell-package,
record-service-session, append-service-session-lines or cancel-redemption
implementation was edited.
