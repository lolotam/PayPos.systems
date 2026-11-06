# 59b-2c — local validation receipt

Date: 2026-11-06. Implementer: Codex `gpt-6.1-sol`, effort `medium` (PP-125).
Base after the manager's lane grant: `ef9209bafb8ad541d437d7bc472cf544e4cda84a`.
Scope: dormant inventory, discovery, registration recovery and retained-source replay.
No activation, sender implementation or fixes to #803/#804/#805/#808/#809/#810/#811.

## Migration

- Generated with `pnpm --filter @pospay/db db:generate rating-claims-discovery`
  after rebase, not by editing a merged migration.
- File: `packages/db/migrations/0214_2026-11-06_rating-claims-discovery.sql`.
- SHA-256: `3139f39654d3a6e2574a6153ed81a6c5dadf22d2d41d1b8fa574097258cc83af`.
- Snapshot `prevId`: `fc481331-9587-49d5-bf02-f5f98442eeed`, equal to 0213's `id`.
  A structural comparison, ignoring only the new snapshot identity/link and the
  added `outbox_rating_claims_replay_idx`, found no other snapshot change.
- `pnpm migration-chain:check`: passed.
- ADR-0038 marker invokes the registered data step before SQL. Concurrent
  drop/create repairs an incomplete prior index build; discovery is idempotent
  across a committed company transaction whose response is lost. The migration
  runner's existing session lock serializes the step.

## Private infrastructure

`node scripts/test-db/lane.mjs up rating-discovery-2c` created this worktree's
Postgres on `127.0.0.1:55405`; a separate test Redis used `127.0.0.1:56405`.
Only synthetic local test configuration was created. No real environment file was
read or copied, and no staging SQL, deploy, server or DNS change was made.
Vitest global setup migrated the real chain through 0214 before cloning test DBs.

## Final local gates

| Command / set | Result |
| --- | --- |
| `pnpm turbo run typecheck lint --filter=@pospay/worker --filter=@pospay/db --filter=@pospay/contracts --concurrency=2` | 28 tasks successful; 18 cached; includes boundary checks |
| `pnpm lint:docs` | 0 errors; 29 existing TODO warnings |
| `pnpm module-map:check` | passed |
| `pnpm migration-chain:check` | passed |
| DB: `rating-claims-discovery`, `migration-data-steps`, `concurrent-migrations`, `dispatcher-role`, `dispatcher` | 82 tests passed in 5 files |
| Worker: `rating-discovery-claim`, `rating-discovery-replay`, `rating-claims.processor`, `otp-startup` | 24 tests passed in 4 files |
| Contracts: `rating-claims` | 5 tests passed |
| `git diff --check` | passed |

The worker DB/Redis tests ran with `REDIS_URL` set to this private Redis. No E2E,
full `pnpm check` or full API shards ran locally (PP-113); those belong to CI.
The dependency build and worker build also passed during local preparation.

## Guard pass and evidence

`clean-code-guard`, `test-guard` and `docs-guard` were applied to the changed code,
tests and docs. Issues found during implementation were fixed before delivery:

- The first data-step test correctly rejected an application-role outbox SELECT.
  The existence check now uses the restricted dispatcher facade outside the app
  transaction. Counts and appends use `withTenant`; no grant was widened.
- Cleanup preserves the primary sanitized failure while attempting both pool
  closes. Function-size checks were fixed by extracting named responsibilities,
  not by suppressing lint or squashing lines. Shared discovery validation lives
  under customers jobs, respecting the jobs dependency policy.
- A test attempted a forbidden historical status reversal during cleanup. It was
  replaced by an isolated empty-company scenario; historical rows are not reset.
  The complete DB set then passed, with no reliance on a prior test's effects.

The tests prove tenant-scoped discovery and replay, read-only parked/published
outbox metadata, unchanged historical `SENDING`/`SENT` requests and terminal
attempts, registration failure/retry, racing registration, lost scheduler repair,
and old-worker-acknowledged late-visit recovery through one `SENDING` claim with
one ready event. The main startup test still proves dormancy with valid token
settings. A real dispatcher-query capture plus EXPLAIN uses the new partial index
with 20,000 unrelated retained events; this proves that plan on this fixture,
not production latency or capacity.

The historical-send owner question remains PENDING. DEP-1 must read migrate's
counts before any dependent activation; this receipt is not a deployment or merge
approval. The manager retains the migration lane through this PR's merge.
