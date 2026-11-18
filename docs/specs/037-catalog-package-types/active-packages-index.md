# Active package list index

The sellable package picker filters by company, business and active selling status.
This expand-only migration adds a partial index matching its cursor ordering. No
row data, RLS policy, privilege, endpoint contract or business behavior changes.
No production slowness has been established; CLAUDE.md section 5 requires indexes
for known list filters.

## Query and index

The actual consumer is `apps/api/src/modules/catalog/queries/sellable-package-types.query.ts`,
merged by #1073 into main at `1105b98a7`. Its WHERE has company equality,
business equality, `selling_stopped_at IS NULL` and optional `id > cursor`;
ORDER BY is `id ASC`, LIMIT is page size plus one. Components are aggregated by
position in a correlated subquery joined to services.

The existing `package_types_company_business_id_key` indexes
`(company_id,business_id,id)` but includes stopped rows. The primary key is
`(company_id,id)`; name indexes enforce uniqueness. All existing indexes remain
because the general management list also returns stopped packages.

The new `package_types_active_business_id_idx` indexes
`(company_id,business_id,id) WHERE selling_stopped_at IS NULL`.
Equality prefixes constrain tenant/business; the final key supports ordered
first/cursor pages. The predicate excludes stopped rows without retaining a
redundant timestamp key. Stop/resume operations maintain the partial index.

## Migration

Final SQL: [0231_2026-11-18_active-packages-index.sql](../../../packages/db/migrations/0231_2026-11-18_active-packages-index.sql).

SHA256: `5b2ffbf4aa594dadea38d70329c49214fc61894e80ae584cdf90b540854f3c84`.

Manager granted lane 0231 on 2026-11-18, after confirming no open migration PR.
The branch was rebased onto main and `pnpm db:generate active-packages-index`
generated SQL, journal entry 231 and snapshot 0231. Snapshot prevId must equal
snapshot 0230's id (verified: `81b31e6e-a7be-4a5d-a714-d4fbae616cd3`). Generation retains `.concurrently()` in the schema.

This follows migration 0229's CREATE INDEX CONCURRENTLY pattern.
`concurrent-migrations.ts` recognizes the concurrent prefix and delegates to
`recover-concurrent-index.ts` outside the transactional suffix. The journal
record commits afterward. There is no BEGIN/COMMIT around the index build,
DROP in the production migration, data change or new table.
Production migration execution requires Waleed's separate approval.

## EXPLAIN evidence and regression

Private T2 compose PostgreSQL 16 lane `active-packages-index`, localhost 55405.
One DB test run at a time. The regression uses the actual exported query, a
fully migrated clone and the app role through `withTenant`. It verifies the
migrated index is valid/ready, drops it only in that disposable clone, seeds
20,000 synthetic packages (200 active), ANALYZEs and records baseline plans.
It recreates the index from the final migration SQL, ANALYZEs and repeats.
No planner option is changed. Teardown drops the clone.

Full `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`:
[active-packages-explain.json](active-packages-explain.json).

The natural planner selects the partial index for both the first and cursor
pages, with no sort or active-status row filter. Assertions also check 21
projected rows and exact ordered identifiers. The existing sellable query tests
cover full quote/component shape, cursor behavior and tenant/business isolation.
Synthetic local timings do not prove production slowness or promise a latency reduction.

Run from the repository root:

```powershell
$env:POSPAY_INDEX_EXPLAIN_OUTPUT = Join-Path (Get-Location) 'docs/specs/037-catalog-package-types/active-packages-explain.json'
pnpm --filter @pospay/api exec vitest run src/modules/catalog/__tests__/active-packages-index.spec.ts src/modules/catalog/__tests__/sellable-package-types.spec.ts src/modules/catalog/__tests__/sellable-package-types-access.spec.ts
```

Owner lane history is preserved in [owner-questions.ar.md](owner-questions.ar.md).
Publication is authorized; review requests, merge and server operations are not.

## Measured local plans

| Page | Index before / after | Rows filtered before / after | Root shared hits before / after | Execution ms before / after |
| --- | --- | --- | --- | --- |
| First (21 rows) | package_types_pkey / package_types_active_business_id_idx | 2079 / 0 | 95 / 65 | 1.504 / 0.813 |
| Cursor after ID 10000 (21 rows) | package_types_pkey / package_types_active_business_id_idx | 2079 / 0 | 95 / 65 | 1.694 / 0.616 |

## Local validation after rebase

- Dependency build: passed.
- `pnpm typecheck`: passed, 32/32 Turbo tasks.
- `pnpm lint` including boundaries: passed, 33/33 Turbo tasks; existing warnings remain.
- `pnpm lint:docs`: passed, zero errors and 30 existing TODO warnings.
- `pnpm module-map:check`: passed.
- `pnpm migration-chain:check --base origin/main`: passed against `1105b98a76bd91f42df2407b6278fbcee803695c`.
- Snapshot comparison: only the new index differs apart from snapshot identity.
- Query, access and EXPLAIN regression: 3 files, 12/12 tests passed on T2; the migrated index was valid and ready.
- Formatting and `git diff --check`: passed.
- CI/reviews are not local receipts; no review request or merge is authorized here.
