# API contract — 041 fixed break window per shift

No new endpoint, route, guard or permission. Additive fields only (Zod in
`packages/contracts/src/staff/schedules.ts`; OpenAPI regenerated). Bounds on pattern length come from 16c (spec 042)
and are not changed here.

## Shapes

```text
ShiftBreakFields (new, merged into ScheduleShift)
  break_start?: "HH:mm" | null
  break_end?:   "HH:mm" | null
  rule: both present (non-null) or both absent/null — else VALIDATION_FAILED (400)

ScheduleShift   = { day, start, end } + ShiftBreakFields          (strict object, unchanged keys kept)
ConcreteShift   = ScheduleShift + { working_date, starts_at, ends_at,
                                    break_start: "HH:mm"|null, break_end: "HH:mm"|null,
                                    break_starts_at: ISO datetime|null, break_ends_at: ISO datetime|null }
```

Responses always carry the four break keys on a concrete shift (`null` when there is no break). Template responses
(`ShiftTemplate.shifts`) carry `break_start`/`break_end` (`null` when absent).

## Routes affected

Access checks are unchanged (spec 020: `@Authenticated` + `SelectedCompanyGuard` + the schedule read-access port
with `read/manage:schedules:branch` for weeks and `read/manage:schedules:business` for templates).

| Route | Change |
|---|---|
| `PUT /v1/businesses/{businessId}/branches/{branchId}/schedules/{employeeId}` | body shifts may carry a break; response shifts carry it |
| `GET /v1/businesses/{businessId}/branches/{branchId}/schedules/{employeeId}` | response |
| `GET /v1/businesses/{businessId}/branches/{branchId}/schedules` (grid) | response |
| `GET /v1/staff/my-schedule` | response (her own breaks only) |
| `POST /v1/businesses/{businessId}/shift-templates`, `PATCH …/shift-templates/{templateId}` | body + response |
| `GET /v1/businesses/{businessId}/shift-templates` | response |
| `POST …/shift-templates/{templateId}/archive` | response |
| `POST …/shift-templates/{templateId}/apply` | created copies carry the break |

## Example

```json
PUT /v1/businesses/{businessId}/branches/{branchId}/schedules/{employeeId}
{
  "week_start": "2026-10-10",
  "expected_revision": 0,
  "shifts": [
    { "day": 0, "start": "09:00", "end": "17:00", "break_start": "13:00", "break_end": "14:00" },
    { "day": 1, "start": "09:00", "end": "13:00" }
  ]
}
```

Response shift (Asia/Kuwait):

```json
{ "day": 0, "start": "09:00", "end": "17:00", "working_date": "2026-10-10",
  "starts_at": "2026-10-10T06:00:00.000Z", "ends_at": "2026-10-10T14:00:00.000Z",
  "break_start": "13:00", "break_end": "14:00",
  "break_starts_at": "2026-10-10T10:00:00.000Z", "break_ends_at": "2026-10-10T11:00:00.000Z" }
```

## Errors

| Code | HTTP | When | message_ar / message_en |
|---|---|---|---|
| `SCHEDULE_BREAK_INVALID` (new) | 400 | break not strictly inside its shift, zero/negative length, or one-sided in template JSONB | «وقت البريك لازم يكون جوّه الشيفت» / "The break must be inside the shift" |
| `VALIDATION_FAILED` | 400 | only one of the two times, bad `HH:mm`, unknown key | existing |
| `SCHEDULE_LOCAL_TIME_INVALID` | existing | break time in a DST gap/fold | existing |
| `SCHEDULE_PAST_REASON_REQUIRED` | existing | break added/changed/removed on a past day without a reason | existing |

`Idempotency-Key`: not required (no money/stock effect; spec 020).

## Attendance (16b-2)

No contract change. `ClockResult.late_minutes` of a return from break is measured from the break end.
