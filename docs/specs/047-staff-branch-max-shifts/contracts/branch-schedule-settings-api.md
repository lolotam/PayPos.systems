# Contract — per-branch schedule settings

All routes: `@Authenticated()`, `SelectedCompanyGuard`, permission `manage:schedule-settings:business` checked through
the identity `scheduleAccess` `'settings'` action, feature `staff`. A refused actor gets `NOT_FOUND` (no disclosure),
as the other schedule routes.

## GET `/v1/businesses/{businessId}/schedule-settings` (existing, additive)

```json
{
  "business_id": "uuid",
  "max_shifts_per_day": 3,
  "is_default": false,
  "updated_at": "2026-10-10T09:00:00.000Z",
  "branches": [
    { "branch_id": "uuid-hawalli", "max_shifts_per_day": 4, "source": "branch", "updated_at": "2026-10-10T09:05:00.000Z" },
    { "branch_id": "uuid-salmiya", "max_shifts_per_day": 3, "source": "business", "updated_at": null }
  ]
}
```

`branches` lists every active branch of the business (order by `branch_id`). `source`: `branch` | `business` |
`default`.

## PUT `/v1/businesses/{businessId}/branches/{branchId}/schedule-settings` (new)

Body `SetScheduleSettingsInput { "max_shifts_per_day": 1..4 }` → `BranchScheduleSettings`:

```json
{ "branch_id": "uuid-hawalli", "max_shifts_per_day": 4, "source": "branch", "updated_at": "2026-10-10T09:05:00.000Z" }
```

## DELETE `/v1/businesses/{businessId}/branches/{branchId}/schedule-settings` (new)

Clears the branch's own number → `BranchScheduleSettings` with `source` `business` or `default` and `updated_at` null.

## PUT `/v1/businesses/{businessId}/schedule-settings` (existing, unchanged)

Sets the business number.

## Schedule responses

- `ScheduleGrid.max_shifts_per_day` = the branch's effective number.
- `TemplatePage.max_shifts_per_day` = the largest effective number among active branches (business ?? 3 if none).

Errors: `VALIDATION_FAILED` 400 · `NOT_FOUND` 404 · `FORBIDDEN` · `FEATURE_DISABLED`. Schedule saves keep
`SCHEDULE_DAY_LIMIT_EXCEEDED` 422 `{ max_shifts_per_day, working_dates }`. No `Idempotency-Key`.
