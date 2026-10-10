# Quickstart — validating 042

Prerequisites: T2 compose Postgres up (`docker ps`), `.env` present, shared packages built.

1. `pnpm --filter @pospay/db test` — privileges allowlist and role-defaults include the new table and permission.
2. `pnpm --filter @pospay/api test -- schedules schedule-settings schedule-batch schedule-queries schedule-rls` —
   domain unit (limit 1/3/4, changed days), integration MS-01 … MS-09, RLS negative, query shape + EXPLAIN.
3. `schedule-batch.spec.ts` prints `schedule_apply.bounded_batch` with `elapsed_ms` for 20 copies × 28 shifts; record
   the numbers in the PR (FR-013). Over 200 ms → owner question; the cap is not changed.
4. `cd packages/db && node --experimental-strip-types scripts/generate-migration.ts drift-check` → "No schema changes".
5. Admin: `pnpm --filter @pospay/admin test -- schedule` — "Add shift" disabled at the effective limit; settings panel
   hidden on 403.
6. Manual (optional): as owner, `PUT /v1/businesses/{id}/schedule-settings {"max_shifts_per_day":4}`, then save 4
   shifts on one day → 200; a 5th → 422 `SCHEDULE_DAY_LIMIT_EXCEEDED`.
