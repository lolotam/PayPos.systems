# Quickstart — validating 047

Prerequisites: T2 compose Postgres up (`docker ps`), `.env` present, shared packages built.

1. `pnpm --filter @pospay/db test` — privileges allowlist includes the new table.
2. `pnpm --filter @pospay/api test -- schedule-settings branch-schedule-settings schedules schedule-batch schedule-queries`
   — domain unit, integration MB-01 … MB-10, RLS negative, query shape + EXPLAIN.
3. `schedule-batch.spec.ts` prints `schedule_apply.bounded_batch` with `elapsed_ms` for 20 copies × 28 shifts; record it
   in the PR (spec 042 FR-013). The cap is not changed.
4. `cd packages/db && node --experimental-strip-types scripts/generate-migration.ts drift-check` → "No schema changes".
5. `pnpm --filter @pospay/admin test -- schedule` — panel shows branch number and source; set / clear; "Add shift"
   follows the branch number.
6. Manual (optional): as owner, `PUT /v1/businesses/{b}/branches/{hawalli}/schedule-settings {"max_shifts_per_day":4}`,
   save 4 Thursday shifts in Hawalli → 200; in Salmiya (business 3) a 4th → 422 `SCHEDULE_DAY_LIMIT_EXCEEDED`.
