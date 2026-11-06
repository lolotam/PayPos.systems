# 57b-2a personal branch discovery validation

Date: 2026-11-06. Implementation only; no commit, push, PR, migration or deployment.
Worktree: `F:/Dev/Worktrees/PosPay/57b-2-my-leave`.

## Contract and authorization (PP-7.1)

`GET /v1/staff/me/branches` returns exactly
`{ items: [{ id, name_ar, name_en, timezone }] }` with `Cache-Control: no-store`.
The route declares `@Authenticated()` and `PERSONAL_ROUTE = true`.
`SessionGuard` selects `personalSessionRequest`, which requires the configured origin,
refuses Authorization, resolves the personal cookie and checks live personal eligibility.
There is no admin fallback, kiosk policy or private-view window.

`PersonalBranchesController.read` rejects all query fields, samples its injected Clock once,
and opens one `withTenant` with the verified user. `readPersonalBranches` rechecks the
employee id/user/business link, soft deletion, inclusive hire/contract dates and dated
attachments (`from` inclusive, `to` exclusive) using each branch's effective timezone.
The read-side adapter uses tenancy's `describeWorkspaces` and identity's
`personalMemberships(..., false, now)` on that same Tx. Only active branches covered
by a live company/business/branch membership survive. No leave permission is required;
this discovers the employee's own context. No lock, write, nested transaction or client
employee selector is introduced. Existing leave routes are unchanged.

The small persistence adapter is required by the existing import matrix: module roots
cannot import provider readers and persistence cannot import query types. Module wiring
binds the structurally compatible reader. Module-map entries use existing staff-to-tenancy
and staff-to-identity edges. No new architectural edge is added.

## Owned files

- `apps/api/src/modules/staff/queries/personal-branches.query.ts`
- `apps/api/src/modules/staff/http/personal-branches.controller.ts`
- `apps/api/src/modules/staff/persistence/personal-branches.adapter.ts`
- `apps/api/src/modules/staff/staff.module.ts`
- `apps/api/src/modules/staff/__tests__/personal-branches.spec.ts`
- `apps/api/src/modules/staff/__tests__/personal-branches-http.spec.ts`
- `packages/contracts/src/staff/personal-branches.ts`
- `packages/contracts/src/staff/personal-branches-openapi.ts`
- `packages/contracts/src/staff/personal-branches.spec.ts`
- `packages/contracts/src/staff/index.ts`
- `packages/contracts/src/index.ts`
- `packages/contracts/src/openapi.ts`
- `packages/contracts/openapi/openapi.json`
- `apps/admin/src/shared/api/schema.d.ts`
- `apps/pos/src/shared/api/schema.d.ts`
- `docs/module-map.md`, `docs/module-map.yaml`
- This receipt.

Staff exports moved to `src/staff/index.ts` to keep the root barrel below the existing
400-line limit; public exports are preserved. UI/i18n/plan edits in this shared worktree
belong to the concurrent UI implementer and are not part of this delivery.

## Commands and results

- `pnpm install --frozen-lockfile`: passed.
- `pnpm exec turbo run build --filter=@pospay/api^... --concurrency=4`: passed;
  dependency artifacts were needed for the fresh worktree's tests.
- `pnpm contracts:openapi`: passed.
- `pnpm --filter @pospay/pos api:generate`: passed.
- `pnpm --filter @pospay/admin api:generate`: passed.
- `pnpm module-map:generate`: passed.
- `pnpm --filter @pospay/contracts exec vitest run src/staff/personal-branches.spec.ts`:
  1 test passed.
- `pnpm --filter @pospay/api exec vitest run src/modules/staff/__tests__/personal-branches.spec.ts src/modules/staff/__tests__/personal-branches-http.spec.ts`:
  14 tests passed before the additional timezone case and stronger index assertions.
- `pnpm --filter @pospay/api exec vitest run src/modules/staff/__tests__/personal-branches.spec.ts`:
  final 13 query tests passed, including branch-local employment endpoints and index-name assertions.
  Together with the 2 passing HTTP tests: 15 API tests, plus the 1 contracts test.
- `pnpm --filter @pospay/api typecheck`: passed.
- `pnpm --filter @pospay/contracts typecheck`: passed.
- `pnpm --filter @pospay/api lint`: passed after adapter boundary corrections.
- `pnpm lint:docs`: passed, 0 errors and 29 existing warnings.
- `pnpm module-map:check`: passed.
- `pnpm --filter @pospay/pos api:check`: passed.
- `pnpm --filter @pospay/admin api:check`: passed.
- Root `pnpm typecheck`: initial UI errors while the concurrent implementer was writing;
  latest attempt fails because `apps/menu` reports its generated `schema.d.ts` stale.
  Menu generation is outside this worker's explicit write ownership; parent must regenerate it.
- Root `pnpm lint`: passed, 33 tasks successful; existing warnings only.

No full `pnpm check`, full API suite or E2E ran. Root Turbo typecheck/lint invoked their
configured dependency builds, including POS, without a separate full application build gate.

## Database evidence and corrections

Private Postgres lane: `node scripts/test-db/lane.mjs up personal-branches-57b2a`,
port `55406`. A fresh local `.env` was created from `.env.example` with random credentials;
no pre-existing `.env` was opened. The lane/test harness consume this newly created file.
Private Redis: `pospay-test-personal-branches-redis-57b2a`, localhost port `56406`,
random password passed by environment name. Both containers remain owned by this task;
no cleanup was authorized. No shared database, Redis configuration or existing service changed.

The first test attempt failed because package build artifacts were absent. The first DB
attempt then had an invalid test mutation of close-only attachment history, and HTTP
setup had `STAFF_SESSION_REFUSED_CREATE_23514`; corrected fixture dates and immutable-history
updates passed the combined run. A mismatched default local Redis password produced
`WRONGPASS`; the private Redis run passed. These failed attempts are not counted as success.

The query's real `EXPLAIN (ANALYZE, FORMAT JSON)` runs under the restricted tenant wrapper
with `enable_seqscan=off`, checking existing index access for employees and attachments.
No new index or migration was needed. The small fixture proves index availability, not
production latency or scale. Tests cover exact output projection, cross-context identities,
expired memberships, unlinked/deleted/out-of-employment employees, ended attachments,
inactive branches, membership coverage and nonpersonal HTTP sessions.

Guard passes: clean-code-guard, test-guard and docs-guard applied locally. Independent
code review and exact-head CI/reviews remain the parent's responsibility.

## Parent verification before PR

The parent regenerated `apps/menu/src/shared/api/schema.d.ts` using
`pnpm --filter @pospay/menu api:generate` after the reader's OpenAPI generation.
Its complete diff contains exactly 64 added lines: the new `/v1/staff/me/branches`
path and `personalBranches` operation, with no removed lines or unrelated operation
changes. Admin and POS generated clients each have the same 64-line addition.
This is a consequence of this slice's OpenAPI change, not pre-existing client drift.

The parent reran root `pnpm typecheck`, `pnpm lint`, `pnpm lint:docs` and
`pnpm module-map:check`: all passed. The contract test passed again. Selected POS
regression tests passed (7 files, 42 tests), plus the new i18n test. No heavy suite
or production-scale performance claim is made.

Independent Astra high review completed: no P0/P1 or confirmed production leak;
one P2 found that the foreign-identity test used an unseeded UUID. The parent replaced
that test with real linked colleagues in the current company and a second company,
positive reads for each subject, mismatched user/employee checks, foreign context under
the current tenant, and current context under the foreign tenant. Only the test changed.
The final parent run passed 12 API tests across both files (10 query tests and 2 HTTP
tests), including EXPLAIN; the contract test also passed. Earlier counts above describe
the earlier test layout. API typecheck and scoped test lint passed after the correction.
The parent run used this task's private PostgreSQL lane on 55406 and its additional
local Redis container on 56407; no infrastructure cleanup was performed.

## PR correction round 1

All four panel bots completed on `2748ebffcd0f4f918382e52c47ef2d380fdbdd0e`.
The manager rejected the kiosk-access finding: this reader is personal-only by the
approved split; reception already has the device branch and bypasses discovery in #882.
The accepted LOW finding adds the existing `503 NOT_READY` failure to OpenAPI with
`ErrorEnvelope`, plus a contract assertion and regenerated admin/POS/menu clients.
Contracts test, typecheck and lint passed; `git diff --check` passed. No production
authorization or query changed. Per the manager's clarification, correction pushes
wait for panel completion, while CI runs again on the resulting head.
