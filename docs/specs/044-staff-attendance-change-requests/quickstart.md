# Quickstart — validate 044

Prerequisites: T2 compose Postgres up (`docker ps`), `.env` present, `pnpm install`, shared packages built.

1. `pnpm --filter @pospay/db test` — schema, privileges allowlist, role defaults, RLS negative for
   `attendance_change_requests`.
2. `cd packages/db && node --experimental-strip-types scripts/generate-migration.ts drift-check` → "No schema changes".
3. `pnpm --filter @pospay/api test -- attendance-change` — domain unit, integration ACR-01 … ACR-14 (a test-only kind
   is registered in the test module), races, HTTP envelopes, query shape + EXPLAIN.
4. `pnpm --filter @pospay/worker test -- notification` — both events store one in-app row per recipient.
5. Production wiring check: with the real `StaffModule`, `POST …/attendance-change-requests` with any kind answers
   `ATTENDANCE_CHANGE_KIND_UNAVAILABLE` (422) and writes nothing.
6. `pnpm run typecheck && pnpm run lint && pnpm run lint:docs && pnpm run module-map:check`.
