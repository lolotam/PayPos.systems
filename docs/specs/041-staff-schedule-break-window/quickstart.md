# Quickstart — validating 041 fixed break window

Prerequisites: worktree rebased on main **after 16c (spec 042) merged**; T2 compose Postgres up (`docker ps`);
`pnpm install`; shared packages built
(`pnpm --filter "@pospay/contracts..." --filter "@pospay/i18n..." --filter "@pospay/db..." build`); `pnpm db:migrate`.

## 1. Domain (no database)

`pnpm --filter @pospay/api test -- domain/__tests__/schedules.spec.ts domain/__tests__/clock-attendance.spec.ts`

Expect: the placement table in [data-model.md](data-model.md) passes row for row; the 10-value past comparison
asks for a reason when a break is added/changed/removed on a past day and not on an identical re-save; (16b-2)
return at 13:45 / 14:00 / 14:10 → 0, 14:11 → 11, 14:12 → 12; first clock-in at 13:30 without an earlier session →
270 (spec 027 unchanged).

## 2. Integration (T2 Postgres)

`pnpm --filter @pospay/api test -- __tests__/schedules.spec.ts __tests__/schedule-templates.spec.ts __tests__/schedule-queries.spec.ts __tests__/schedule-rls.spec.ts`

| Scenario | Expected |
|---|---|
| BW-01 save سارة Sat 09:00–17:00 break 13:00–14:00 | saved; grid, one-week read and my-schedule return the break; one audit row with it; shift still 8 h |
| BW-02 break 16:30–17:30 | 400 `SCHEDULE_BREAK_INVALID`; no row, no audit |
| BW-03 past day: change break without reason / identical re-save | 400 `SCHEDULE_PAST_REASON_REQUIRED` / 200 |
| BW-04 template with break → apply 2 employees × 2 weeks → change one Monday | all copies carry it; only سارة's Monday changes; template unchanged |
| BW-05 week and template stored before the migration | read/edit/apply work, no break |
| BW-06 direct insert with half pair / break outside shift | CHECK violation |

(16b-2) `pnpm --filter @pospay/api test -- __tests__/clock-attendance.spec.ts __tests__/clock-by-card.spec.ts __tests__/correct-attendance.spec.ts`

| Scenario | Expected |
|---|---|
| BW-07 QR and card: in 08:58, out 13:00, in 14:05 / 14:12 | `late_minutes` 0 / 12; `scheduled_start` = break end |
| BW-08 correction of the return session | lateness recomputed from the stored break end |

## 3. Migration drift

`cd packages/db && node --experimental-strip-types scripts/generate-migration.ts drift-check` → "No schema changes".

## 4. Admin

`pnpm --filter @pospay/admin test -- staff`

Open the schedule page, edit سارة's Saturday, add break 13:00–14:00, save; reopen and save untouched — the break
stays; the grid shows `09:00–17:00` with `13:00–14:00` under it (ar and en).

## 5. Contract

`pnpm contracts:openapi`; admin and POS `schema.d.ts` regenerated; `pnpm run typecheck`.
