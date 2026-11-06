# 47-2a local receipt — 2026-11-06

Base: `3fc65c268377ca01dd48e98f67529f7e16e72a97` (main). One use case:
`ExecutePackagePreview`, with the package preview partition guard. Closes #875 and #876.

## Migration

- Granted lane: `0213_2026-11-06_package-preview-partition-proof.sql`, after 0212.
- Round 1 SHA256: `2e6fa61319528dfda7163abcc21fe0605d75d358bbbd2b046faf020489e72ab7`.
- Generated with `pnpm db:generate package-preview-partition-proof`; journal idx 213
  follows 212 and snapshot prevId equals the 0212 snapshot id. Apart from snapshot
  identity, the schema delta is exactly nullable `source_rows` and `skipped_rows`.
- No data UPDATE, backfill, new CHECK or table-validation scan. Existing rows keep
  NULL proof, so there is no existing-data CHECK validation failure. The #864
  NOT VALID / separate VALIDATE pattern is not needed for this trigger migration.
- The 0212 guard is retained, expanding only its pending-result column allowlist.
  The additional trigger checks exact source coverage, disjointness, uniqueness,
  ordinal types and bounds when proof is supplied. Proof is immutable outside
  pending-to-ready. Both NULL arrays are accepted for the old worker during rollout
  and one-click rollback; partial proof is refused.
- PP-134's decision is unchanged. Mandatory proof and the legacy commit refusal
  (`IMPORT_PREVIEW_EXPIRED`) move to the 47-2b contract migration, after staging has
  the 47-2a worker. 0213 does not alter legacy ready-to-commit_requested behavior.
- Migrations 0211 and 0212 are unchanged. There are no financial writes or product
  activation changes; the later financial commit slices remain separate.

## Local verification

| Gate | Result |
| --- | --- |
| `pnpm typecheck` | Passed, 32 tasks |
| `pnpm lint` (including boundaries) | Passed, 33 tasks; existing warnings only |
| `node --test scripts/module-map/boundaries.test.mjs` | Passed, 3 tests |
| `pnpm lint:docs` | Passed, 0 errors; 29 existing warnings |
| `pnpm module-map:check` | Passed |
| `pnpm migration-chain:check` | Passed |
| Selected worker tests | 8 files, 101 tests passed |
| DB privileges and function inventory | 2 files, 28 tests passed |
| Package API and staff import regressions | 5 files, 31 tests passed |

The worker selection covers package row parsing, sheet validation, preview domain,
real preview execution and partition persistence, failure retry, processor and
workbook reading. It includes the full 500-row / 20-component / 365-session bound,
multi-error rows, exact non-contiguous partitions, malformed proof, immutable proof,
old-worker NULL-proof compatibility, staff behavior and negative tenant isolation.
Round 1 adds the old 47-1b UPDATE without either proof column, partial-proof
rejection and unchanged legacy transition until 47-2b. Component-cell regressions
cover INVALID_CELL in service, sessions and remaining, each with exactly one
IMPORT_CELL_INVALID; truly empty siblings still get IMPORT_REQUIRED_CELL.

API selection: package preview request, status and production fence; staff employee
import and import RLS. Round 1 warm request median was 103.93 ms; the existing less-than-200-ms
assertion is unchanged.

Tests used private disposable Postgres 16 and Redis 7 containers. Test process
configuration came only from `.env.example` with fresh random secrets; no env file
was read, copied or created. Both private containers were removed after testing.
The full suite and full API shards remain CI gates under PP-113.

Self-review applied clean-code-guard, test-guard and docs-guard: source ordinals stay
inside the existing tenant transaction, no provider call is introduced there,
money and phone privacy rules stay unchanged, and documentation matches the guard.
No external review was requested; the manager owns review triggers and merge.
