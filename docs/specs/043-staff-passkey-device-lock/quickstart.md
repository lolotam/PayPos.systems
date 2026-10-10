# Quickstart — validating 043 passkey phone lock

## Prerequisites

- T2 compose Postgres and Redis up (`docker ps`), `.env` from `.env.example`.
- `pnpm install`; build shared packages:
  `pnpm --filter "@pospay/contracts..." --filter "@pospay/i18n..." --filter "@pospay/db..." build`.
- `pnpm db:migrate` on the local database.

## Automated checks

| What | Command | Expect |
|---|---|---|
| Domain decision table | `pnpm --filter @pospay/api test -- passkey-device-lock` | all cases of plan D1 green, no DB |
| Integration DL-01 … DL-15 | `pnpm --filter @pospay/api test -- passkey-device-lock` (integration spec) | green on the cloned DB |
| RLS + privileges | `pnpm --filter @pospay/db test` and the API RLS spec | cross-tenant 0 rows / write refused; grants match allowlist |
| Drift | `cd packages/db && node --experimental-strip-types scripts/generate-migration.ts drift-check` | "No schema changes" |
| Card regression | `pnpm --filter @pospay/api test -- clock-by-card` | unchanged |
| POS / admin | `pnpm --filter @pospay/pos test`, `pnpm --filter @pospay/admin test` | green |
| Gates | `pnpm run typecheck && pnpm run lint && pnpm run lint:docs && pnpm run module-map:check` | green |

## Manual walk-through (local)

1. Sign in as Sara on browser profile X; enrol her passkey; clock in. Admin shows "phone locked".
2. On the same profile X, sign in as Heba (her WhatsApp code), open clock: the challenge is refused with the
   "registered to another employee" message before Face ID. Try to enrol: refused the same way.
3. As Sara on profile Y (new installation): refused "registered on another phone".
4. As a branch manager, unbind Sara. Heba can now enrol on X; Sara can enrol on Y.
5. Clock by card on the reception device for any of them: unchanged.
6. `SELECT step, reason, holder_employee_id FROM attendance_device_refusals` (as `pospay_app` under the tenant) shows
   one row per refusal from steps 2 and 3, no raw installation id anywhere.
