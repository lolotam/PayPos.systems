# API contract — 045 add a manual attendance session

No new endpoint. 26a's endpoints carry the new kind
([044 contract](../../044-staff-attendance-change-requests/contracts/attendance-change-requests-api.md)).

## `POST /v1/businesses/:businessId/attendance-change-requests` — `ADD_SESSION` member

```json
{
  "kind": "ADD_SESSION",
  "employee_id": "uuid",
  "branch_id": "uuid",
  "clock_in": "2026-10-08T07:00:00.000Z",
  "clock_out": "2026-10-08T16:00:00.000Z",
  "reason": "worked all day, confirmed by the cashier"
}
```

Strict object; `Idempotency-Key` required (26a). `201` → `AttendanceChangeRequest` (PENDING, or APPROVED with
`session_id` set for the owner one-step).

## `AttendanceChangeRequest` — new field

`requested: { clock_in, clock_out, working_date, timezone } | null` — set for `ADD_SESSION`, `null` for
`VOID_SESSION`.

## `POST …/attendance-change-requests/:id/decision` — approving an ADD

`200` → `AttendanceChangeDecisionResult` with `status 'APPROVED'`, `session_id` = the new MANUAL session,
`effect: null` (research R3).

## Errors (new)

| Code | HTTP | When |
|---|---|---|
| `ATTENDANCE_MANUAL_INVALID_TIMES` | 422 | out ≤ in, in the future, > 16 h, overlaps a session of the employee (filing or approval) |
| `ATTENDANCE_MANUAL_NOT_ELIGIBLE` | 422 | branch not attached on the working date, or date outside hire…contract end |
| `ATTENDANCE_MANUAL_TIMEZONE_CHANGED` | 409 | approval only: the branch time zone changed after filing; reject the request and file the day again |
| `ATTENDANCE_CORRECTION_MANUAL_SESSION` | 409 | `correct-attendance` (PR 26) on a MANUAL session |

Reused: `ATTENDANCE_CHANGE_DUPLICATE_PENDING` 409 (overlapping PENDING ADD of the same employee), `NOT_FOUND`,
`FORBIDDEN` (device), `VALIDATION_FAILED`.
