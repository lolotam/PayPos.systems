# 47-2b implementation handoff

Scope: `CommitPackageImport` only. Base supplied by parent: `f5ed030d0`.
No Git writes, dependency installs, env access, cluster/server changes, migration
number assignment or generation were performed. SQL is now split into unnumbered
`47-2b-contract.draft.sql` (A) and `47-2b-index-validate.draft.sql` (B).
Two consecutive reservations are required; expected 0215/0216 remain provisional,
and the migration lane is not granted.

## Files and behavior

- Worker orders `domain/package-import-commit.ts`: request-time expiry, accepted
  identity, complete disjoint source proof, dense positions, exact frozen allocation.
- `ports/package-import-commit.port.ts`, `use-cases/commit-package-import/`: one
  transactional interactor, known permanent errors finalized only after rollback.
  Unexpected failures propagate for retry. No transport or exhaustion policy added.
- `persistence/package-import-commit.{schema,writes,transactions}.ts`: Zod boundary,
  tenant/preview locking, deterministic targeted conflicts, bounded injected UUIDv7
  writes, audit, distinct ImportCommitted summary, atomic terminal transition.
- Catalog `persistence/package-commit-services.reader.ts` and public index: sorted
  batches of at most 500 referenced IDs, same-transaction FOR SHARE, names only.
- `packages/db/schema/staff-import.ts`: nullable composite accepted-membership FK
  and child index. Contract draft replaces existing guard bodies and preserves their
  result/partition refusals; opens only specified package success/failure transitions.

PP-134 verbatim: «سوال المعاينة القديمة نرفضها ونقبل معاينة جديده».
Legacy proof is refused, never fabricated. Rollback floor after contract: 47-2a.
Staff use cases and existing migrations, journal and snapshots were not edited.

## Initial verification receipt and parent commands (superseded below)

`node_modules` is absent in this worktree. Node v24.21.0 `node --check` passed for all new package commit TypeScript files.
`lint:docs` passed: 0 errors, 29 existing warnings.
No typecheck or runtime test is claimed passed. `module-map:check` was attempted
and failed with ERR_MODULE_NOT_FOUND for typescript (dependencies absent). Parent supplies lane.mjs and applies the unnumbered contract draft
to the private test database before running persistence tests. These tests do not
apply the draft or read env themselves; existing repository DB harness owns setup.

Focused commands from the task worktree after dependencies/private lane are ready:

```powershell
pnpm --filter @pospay/worker exec vitest run src/modules/orders/domain/__tests__/package-import-commit.spec.ts src/modules/orders/__tests__/package-import-commit.spec.ts
pnpm --filter @pospay/worker exec vitest run --config vitest.package-import-benchmark.config.ts
pnpm --filter @pospay/worker typecheck
pnpm --filter @pospay/worker lint
pnpm --filter @pospay/db typecheck
pnpm lint:docs
pnpm module-map:check
```

Parent also runs existing package preview partition/negative tests, package storage
composition/guards/RLS tests and employee import regression tests against contract.
The existing expand-only NULL-proof compatibility assertion must become a contract
refusal assertion in the final contract test lane; it must not be reported as passing
unchanged. Further required persistence scenarios: reverse-order competing previews
across two businesses, competitor rollback, every legacy guard
negative and staff regression. These remain parent verification gaps, not passed tests.

The separate full-bound spec executes 500*20*365 = 3,650,000 slots with a 30-minute
benchmark ceiling, awaits the real worker transaction COMMIT and checks the persisted
count/status. It prints elapsedMs, peakRss, peakHeap, timeoutMs and completedCommit.
Memory is sampled every 10 ms; RSS includes driver/runtime memory, not PostgreSQL
server memory. Parent records actual host/DB settings and server memory separately.
The ceiling is not an approved production timeout. Timeout/performance failure must
be reported before altering file bounds or transaction atomicity.

Remaining parent gates: static checks and focused tests, full-bound benchmark and
budget selection, complete persistence scenarios above, PP-113 gates and final Astra
high review, then manager migration-lane coordination and final generation.


## Continuation receipt ? 2026-11-06

The parent supplied dependencies and the private `packages-47-2b` lane on port
55418. The existing ignored worker config applies the unnumbered draft to test
templates; this continuation did not modify that config, SQL draft, migrations,
journal or snapshots. No env file was accessed or modified, no Git write,
installation, generation, push, PR or review request was performed.

Implementation changes:

- Extracted preview loading, atomic completion and SQL error mapping helpers;
  extracted frozen allocation validation without changing allocation semantics.
  Completed Arabic parameter documentation and replaced generic public descriptions.
- Added the narrow `commit_membership_id` UPDATE privilege to IMPORT_COLUMN_GRANTS.
- Legacy refusal asserts the PostgreSQL cause (`23514`, IMPORT_PREVIEW_EXPIRED).
  The partition tests now reject the old NULL-proof writer, reject legacy commit
  under PP-134, and preserve staff behavior. A ready preview containing errors
  explicitly refuses commit; proof mutation now expects the contract transition
  refusal. Existing malformed metadata negatives supply explicit source proof.
- Added deterministic reverse-source-order overlap across two businesses of one
  company. Both success and rollback cases observe a real ungranted transaction-id
  lock before releasing the first transaction, then verify sorted insertion and
  company-wide conflict results. The rollback case lets the waiting competitor
  create both parents. Shared setup lives in package-import-commit.fixture.ts.
- Added an existing other-user membership FK refusal, failure-finalization isolation
  across tenant/entity/committed/failed states, and a real missing-customer FK after
  an earlier row was inserted. The latter verifies whole-import rollback including
  audit/outbox. The previous unrelated-unique and completion-rollback tests remain.

Final checks:

- `pnpm --filter @pospay/worker lint`: PASS (existing boundaries deprecation warnings).
- `pnpm --filter @pospay/worker typecheck`: PASS.
- Prettier check of all eight modified source/test/grant files: PASS.
- `pnpm lint:docs`: PASS, 0 errors and 29 existing warnings.
- Focused real-PostgreSQL/domain regression run: **11 files, 138 tests passed**,
  duration **40.51 s**. Command:

```powershell
pnpm --filter @pospay/worker exec vitest run --config node_modules/.cache/47-2b.config.ts src/modules/orders/domain/__tests__/package-import-commit.spec.ts src/modules/orders/domain/__tests__/package-import-validation.spec.ts src/modules/orders/domain/__tests__/package-import-row.spec.ts src/modules/orders/domain/__tests__/package-preview.spec.ts src/modules/orders/__tests__/package-import-commit.spec.ts src/modules/orders/__tests__/package-preview-partition.spec.ts src/modules/orders/__tests__/package-preview.spec.ts src/modules/orders/persistence/package-preview-workbook.spec.ts src/modules/staff/domain/employee-import.spec.ts src/modules/staff/__tests__/employee-import-job.spec.ts src/modules/staff/__tests__/employee-import-numbers.spec.ts
```

Earlier attempts are not passing receipts: first 4-file run had 79 passed/1 failed
(contract error expectation); next had 83 passed/2 failed (new concurrency fixture
incorrectly tried inserting proof directly). Both were corrected. The isolated
commit integration run then passed 15/15 before the final 138-test run.

Remaining gaps and blocker:

- Expanded processor runs encountered Redis `WRONGPASS invalid username-password
  pair or user is disabled` and were interrupted. No successful transport receipt
  is claimed for orders/jobs/package-preview.processor.spec.ts,
  orders/__tests__/package-preview-failure.processor.spec.ts or
  staff/jobs/employee-import.processor.spec.ts. Parent must supply a working
  synthetic Redis lane and rerun those; this worker does not read/change env or
  infrastructure to repair authentication. The runtime's Redis error output
  includes AUTH arguments, so future parent runs should redact diagnostic output.
- Full-bound completed-COMMIT performance benchmark was deliberately not run;
  parent owns it and the measured transaction budget.
- Package DB composition/guards/RLS/privileges suite, DB typecheck, boundaries,
  module-map checks, remaining PP-113 gates, review and migration numbering remain
  parent-owned. No full suite or API shard run was performed here.

Recommended next step: repair the synthetic Redis harness, rerun the three
processor specs, then perform the parent-owned full-bound benchmark and gates.

## Parent continuation — 2026-11-06

The three processor specs passed (3 files, 7 tests) after starting a separate
synthetic Redis container and overriding REDIS_URL for that process. Combined with
the implementer's 138 tests, 145 focused tests have passed. The full-bound benchmark
is running; neither its completion nor a production timeout is claimed yet.

The parent added readPackageCommitServices to the module-map adapter inventory and
regenerated YAML. PP-136 advice confirmed two ordered migrations are required:
draft A adds the nullable membership column, NOT VALID FK, narrow grant and guards;
draft B begins with CREATE INDEX CONCURRENTLY and validates the FK afterward.
The runner forbids concurrent indexes after transactional ADD COLUMN in one file;
data steps are not used for DDL. No merged SQL or repository journal/snapshot was
modified. The local ignored test wrapper uses the actual applyMigrations runner
with temporary draft fixtures, not final-number generation.
