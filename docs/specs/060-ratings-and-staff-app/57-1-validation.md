# 57-1a — local validation

## Post-#844 rebase receipts (2026-11-05)

Rebased with `git rebase origin/main` onto `6a94e8d1`, without a merge commit.
The journal conflict was resolved by restoring the main journal, then removing only
this PR's unmerged SQL/snapshot and running `pnpm db:generate staff-own-read-defaults --custom`.
The highest merged migration is 0209, so the newly generated number remains **0210**.
Restored the unchanged custom data SQL into the generated empty SQL file. No merged
migration was renumbered or modified. The regenerated snapshot includes #844's schema.

Fresh local runs on private lane `own-access-571`, sequential DB then API:

- `pnpm typecheck`: passed, 29/29 tasks.
- DB migration/defaults/seed selection listed below: **1082/1082 passed**.
- API own-access/private-view selection listed below: **41/41 passed**.
- i18n permission names: **4/4 passed**.
- `pnpm lint`: passed, 30/30 tasks.
- `pnpm lint:docs`: passed, 0 errors and 29 existing warnings.
- `pnpm module-map:check`: passed, `module map: ok`.
- `git diff --check`: passed.

Fresh read-only Astra high review passed with no confirmed defects across all 18 files.
It independently compared snapshot 0210 with 0209 and in-memory `generateDrizzleJson`
schema: all 113 tables match, ignoring only id/prevId/key order, including #844's
commission tables. `0210.prevId = 0209.id`; only 0210 is added to the main journal;
custom SQL is byte-identical to its pre-rebase version. Shared semantic SHA-256:
`429f27f95cdd844722d688bd87041b7be2ce60330b4ff591ba46d4b3be7d591b`.
Clean-code-guard, test-guard and docs-guard were reapplied to the rebase delta:
no handwritten production/test change; generated artifacts and audit updates only.
New external reviews and exact-final-SHA DEP-1 backup/restore remain pending.
Earlier-head receipts below are historical and do not establish readiness of this head.

Date: 2026-11-05. Branch: `feat/p1-060-57-1-own-access-codes`.
Migration: **0210**, provisional under the manager's 14:03 reservation. No merge or deploy.

## Local receipts

- `pnpm typecheck`: passed, 29 tasks successful. The initial run caught an
  `exactOptionalPropertyTypes` error in the new ownership test. Missing identities now
  omit the properties; the successful run includes that correction.
- `pnpm lint`: passed, 30 tasks successful, including boundaries. The initial run caught
  a forbidden non-null assertion in the new device test; it was removed before the pass.
  Existing React compiler and boundary-rule deprecation warnings remain.
- `pnpm lint:docs`: passed, zero errors and 29 existing warnings.
- `pnpm module-map:check`: passed (`module map: ok`).
- `pnpm --filter @pospay/db exec vitest run src/__tests__/staff-own-defaults.spec.ts src/__tests__/role-defaults.spec.ts src/__tests__/seed.spec.ts`:
  the new migration/default inventory files passed. Overall first run: 1,081 passed,
  one existing seed idempotency test timed out at 20 seconds.
- `pnpm --filter @pospay/db exec vitest run src/__tests__/seed.spec.ts`:
  the first retry overlapped another test run on the same private cluster and failed
  in global setup on the cluster-role advisory lock (`55P03`); no tests ran. After
  the API run ended, the sequential run passed **12/12** in 23.19 seconds overall.
  Neither the seed implementation nor the timeout was changed. The original timeout
  did not reproduce once the earlier concurrent checks ended; resource contention is
  a hypothesis, not a measured root cause of that first timeout.
- `pnpm --filter @pospay/api exec vitest run src/modules/identity/__tests__/staff-own-permissions.spec.ts src/modules/identity/__tests__/private-view.spec.ts src/modules/identity/__tests__/private-view-window.spec.ts src/modules/identity/domain/__tests__/staff-own-access.spec.ts`:
  passed **41/41** on the final test source, with `REDIS_URL` selecting the private
  Redis at `127.0.0.1:56476`. The initial run passed the two own-access files but
  failed the private-view setup because the newly randomized local Redis password
  did not match the shared development Redis (`WRONGPASS`). The rerun uses its own
  Redis; no shared Redis credentials or configuration were read or changed.
- `pnpm --filter @pospay/i18n exec vitest run src/__tests__/permission-name.spec.ts`:
  passed **4/4**.
- `git diff --check`: passed.

Database tests ran on `pospay-test-own-access-571`, port `55476`, created with
`node scripts/test-db/lane.mjs up own-access-571`. The local Redis is
`pospay-test-own-access-571-redis`, published on loopback only. Both belong to this
session. The generated worktree-local `.env` and lane override are gitignored and
are never staged. No other checkout's environment file was accessed.

The prescribed typecheck/lint commands transitively invoke prerequisite builds via
the existing Turbo graph; no separate full check, API shard, E2E or image gate was run.
Full CI coverage remains required on the PR head.

## Guard pass and design boundary

Applied `clean-code-guard`, `test-guard` and `docs-guard` to the complete handwritten
diff. Production changes use the existing catalog, human defaults and device eligibility
projection, without new auth mechanisms or unused authorization wrappers. Tests use real
database clones and real ownership evaluation, assert refusal/results and preserve stored
override history. The test fixture resets membership/overrides between cases. Documentation
distinguishes capability registration from the consuming APIs' later live employee rechecks.

The custom migration was generated with the project generator, then assigned the manager's
provisional number before publication. Comparing normalized JSON against snapshot 0207,
excluding `id` and `prevId`, confirms identical schema; the generated file has key-order
changes only. Existing migrations are unchanged. The migration adds reference data only,
with no new SQL privileges or tenant schema.

## Independent internal review

A fresh read-only `gpt-6-astra` review at reasoning effort `high` completed on
2026-11-05 with **no confirmed defects within 57-1a**. It covered the full handwritten
diff and generated migration artifacts, including permissions/own-only scoping and
database/security. The reviewer independently confirmed the snapshot's unchanged schema.
The review was static: no test execution or edits by the reviewer. Consuming APIs retain
the live employee recheck obligations in the existing plan. Correction rounds used: **0/5**.

The pre-push overlap refresh found #844 (50-2b) in addition to #842. Only the migration
journal overlaps #844, under the manager's explicit shared-file order: #844 reserves
0208/0209, this PR reserves 0210, and the later merge regenerates against main. No shared
schema/table or handwritten production file is edited by these two slices.

External exact-head reviews and CI remain required; this receipt does not claim CI
readiness or permission to merge. This session must not merge the PR.
