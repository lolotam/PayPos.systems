# Quickstart — 045 add a manual attendance session

Prerequisites: the T2 compose Postgres up (`docker ps`), `.env` present, shared packages built.

```bash
pnpm --filter "@pospay/contracts..." --filter "@pospay/i18n..." --filter "@pospay/db..." build
pnpm --filter @pospay/api exec vitest run src/modules/staff/domain/__tests__/manual-attendance-session.spec.ts
pnpm --filter @pospay/api exec vitest run src/modules/staff/__tests__/manual-attendance-session
cd packages/db && node --experimental-strip-types scripts/generate-migration.ts drift-check   # "No schema changes"
```

Expected:

- AMS-01: an ADD request is PENDING and no session exists.
- AMS-02: approving it inserts one MANUAL CLOSED session with `change_request_id`, the request is APPROVED with
  `session_id`, audit has `attendance_session.added_manual`.
- AMS-03: the owner's own request is approved in one step.
- AMS-04…06: invalid times / not eligible / overlapping pending ADD are refused with the codes in
  [contracts](contracts/add-manual-session-api.md).
- AMS-07: `correct-attendance` on a MANUAL session → `ATTENDANCE_CORRECTION_MANUAL_SESSION`.
