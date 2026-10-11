# Contract — employee default shifts

## GET `/v1/businesses/{businessId}/employees/{employeeId}/default-shifts`

Access: same as the employee detail (`EmployeeDetailGuard`), feature `staff`.

```json
{
  "employee_id": "uuid",
  "can_manage": true,
  "branches": [
    { "branch_id": "uuid", "linked": true, "updated_at": "2026-10-10T09:00:00.000Z",
      "shifts": [ { "day": 0, "start": "09:00", "end": "17:00", "break_start": "13:00", "break_end": "14:00" } ] },
    { "branch_id": "uuid", "linked": true, "updated_at": null, "shifts": [] }
  ]
}
```

`shifts: []` on a linked branch ⇒ the admin shows «دوامها مش مكتوب». Stored branches no longer linked appear with
`linked: false`.

## PUT `/v1/businesses/{businessId}/employees/{employeeId}/branches/{branchId}/default-shifts`

Guard `manage:employee-hours:business`, feature `staff`. Body `SetEmployeeDefaultShiftsInput`:

```json
{ "shifts": [ { "day": 5, "start": "09:00", "end": "21:00", "break_start": "14:00", "break_end": "15:00" } ] }
```

`shifts` reuses `scheduleShift`, max 7; empty = clear. Response: `EmployeeDefaultShifts` (as GET).

Errors: `VALIDATION_FAILED` 400 · `SCHEDULE_SHIFT_INVALID` 400 · `SCHEDULE_DAY_LIMIT_EXCEEDED` 422 (two entries for one
weekday) · `SCHEDULE_BREAK_INVALID` 400 · `EMPLOYEE_BRANCH_NOT_LINKED` 422 · `FORBIDDEN` 403 · `NOT_FOUND` 404 ·
`FEATURE_DISABLED`. No `Idempotency-Key` (no money or stock; a repeat is a no-op).

## Grid row (existing branch schedule grid)

`ScheduleGridRow` gains `default_shifts: ScheduleShift[]` — that branch's defaults only.

## Contracted minutes (internal, no HTTP in 16d)

`queries/employee-contracted-minutes.query.ts` → per employee of a branch: `{ employee_id, hire_date, contract_end,
links: [{ from, to }], entries: ScheduleShift[] }`; row 27 sums with `contractedMinutes()` from `packages/domain`.
