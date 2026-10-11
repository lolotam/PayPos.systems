# Quickstart — validating 048

Prerequisites: T2 compose Postgres up (`docker ps`), `.env` present, shared packages built; 16c-2 merged first.

1. `pnpm --filter @pospay/domain test -- default-shifts` — day length, contracted minutes (October 2026, Sara in
   Salmiya = 228 h), day-differs cases.
2. `pnpm --filter @pospay/db test` — privileges allowlist, role defaults and the owner-granted list include the new
   table and permission.
3. `pnpm --filter @pospay/api test -- employee-default-shifts schedule-queries` — DH-01 … DH-10, RLS negative, query
   shape + EXPLAIN.
4. `cd packages/db && node --experimental-strip-types scripts/generate-migration.ts drift-check` → "No schema changes".
5. `pnpm --filter @pospay/admin test -- default-hours schedule` — section + notice, pre-fill per branch, warning.
6. Manual (optional): as owner, PUT Sara's Salmiya week, open the Salmiya grid, add Thursday → 09:00–21:00 with the
   14:00–15:00 break; change it to 09:00–17:00 → warning shown, Save works.
