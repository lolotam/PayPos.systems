# Quickstart — 046 void and restore

Prerequisites: T2 compose Postgres up (`docker ps`), `.env` present, shared packages built
(`pnpm --filter "@pospay/contracts..." --filter "@pospay/i18n..." --filter "@pospay/db..." build`).

1. Domain: `pnpm --filter @pospay/api exec vitest run src/modules/staff/domain` — `attendance-void.spec.ts` and
   `attendance-correction.spec.ts` pass (states, revision, overlap, voided target and neighbour).
2. Integration: `pnpm --filter @pospay/api exec vitest run src/modules/staff/__tests__/attendance-void` — AVS-01 … AVS-15.
3. Migrations: `cd packages/db && node --experimental-strip-types scripts/generate-migration.ts drift-check` prints
   "No schema changes"; `pnpm --filter @pospay/db test` passes (privileges unchanged).
4. Contracts: `pnpm contracts:openapi`; `openapi.json` and both `schema.d.ts` show `RESTORE_SESSION`, `requested` and
   the `effect.session` shape.
5. Manual (staging, after merge): a branch manager files a void for a closed day → the owner's bell shows
   «طلب إلغاء يوم حضور …»; the owner approves → the session reads voided; a restore request → approve → the day counts
   again and both requests stay in the list.
