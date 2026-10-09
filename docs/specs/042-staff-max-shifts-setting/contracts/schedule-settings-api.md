# API contract — schedule settings (042)

All routes: `@Authenticated()` + `SelectedCompanyGuard`; the permission is checked server-side inside the
transaction (same pattern as the other schedule routes). Feature `staff` must be enabled (`FEATURE_DISABLED`
otherwise). An unknown or inaccessible business returns the same `NOT_FOUND` as other schedule routes.

## GET `/v1/businesses/{businessId}/schedule-settings`

Permission `manage:schedule-settings:business`.

`200 ScheduleSettings`

```json
{ "business_id": "uuid", "max_shifts_per_day": 3, "is_default": true, "updated_at": null }
```

## PUT `/v1/businesses/{businessId}/schedule-settings`

Permission `manage:schedule-settings:business`. No `Idempotency-Key` (no money/stock effect; same value is a no-op).

Body `SetScheduleSettingsInput`: `{ "max_shifts_per_day": 1 | 2 | 3 | 4 }` (strict object, integer).

`200 ScheduleSettings` (after the change; unchanged value returns the current row and writes no audit).

Errors: `VALIDATION_FAILED` 400 (outside 1 … 4, non-integer, extra key) · `FORBIDDEN` 403 · `NOT_FOUND` 404 ·
`FEATURE_DISABLED`.

## Changed responses

- `ScheduleGrid` (`GET …/branches/{branchId}/schedules`) gains `max_shifts_per_day: int`.
- `TemplatePage` (`GET …/shift-templates`) gains `max_shifts_per_day: int`.
- `schedulePattern` and `staffSchedule.shifts`: `.max(14)` → `.max(28)` (request and response, incl. POS
  `personalSchedule`).

## New error

`SCHEDULE_DAY_LIMIT_EXCEEDED` — HTTP 422, raised by set-schedule, apply-shift-template, create/update-shift-template.

```json
{ "code": "SCHEDULE_DAY_LIMIT_EXCEEDED", "message_ar": "…", "message_en": "…",
  "details": { "max_shifts_per_day": 3, "working_dates": ["2026-10-15"] } }
```

Template create/update report `details: { "max_shifts_per_day": 3, "days": [5] }` (weekday index, 0 = Saturday).

`SCHEDULE_SHIFT_INVALID` (400) keeps bad time and over-16-hours only; its ar/en text no longer mentions "two per day".
