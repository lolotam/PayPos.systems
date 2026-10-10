# API — attendance change requests

Zod: `packages/contracts/src/staff/attendance-change-request.ts` (+ `-openapi.ts`). All routes: selected-company admin
session (`@Authenticated()`), permission/owner checked in the use case (PR 25/26 pattern), feature flag none.
Personal staff and kiosk sessions are refused by the shared guard; the paired device gets `FORBIDDEN`.

## File — `POST /v1/businesses/:businessId/attendance-change-requests`

- Header `Idempotency-Key` (required).
- Body: `attendanceChangeRequestInput` = discriminated union on `kind`. In 26a the union has **no production member
  that can succeed**: the schema accepts `{ kind: 'ADD_SESSION' | 'VOID_SESSION', employee_id: uuid, reason: string }`
  plus optional `session_id`, `session_revision` (void) and lets 26b/26c narrow their members. The use case answers
  `ATTENDANCE_CHANGE_KIND_UNAVAILABLE` (422) for a kind with no registered planner.
- 201 → `AttendanceChangeRequest`.

## Withdraw — `POST /v1/businesses/:businessId/attendance-change-requests/:requestId/cancel`

- Header `Idempotency-Key`. Body `{ revision: int ≥ 0 }`. 200 → `AttendanceChangeRequest`.

## Decide — `POST /v1/businesses/:businessId/attendance-change-requests/:requestId/decide`

- Header `Idempotency-Key`. Body `{ decision: 'APPROVED' | 'REJECTED', revision: int ≥ 0, reason?: string }`
  (reason 1–500 trimmed; required when REJECTED). 200 → `AttendanceChangeRequest` (+ `effect` from the kind, `null`
  in 26a).

## List — `GET /v1/businesses/:businessId/attendance-change-requests`

- Query: `status?`, `branch_id?`, `employee_id?`, `kind?`, `cursor?`, `limit?` (cursor pagination, newest first by
  `requested_at, id`).
- Owners see the whole business; holders of `request:attendance-change:branch` see the branches where they hold it.
- 200 → `{ items: AttendanceChangeRequest[], next_cursor }`.

## `AttendanceChangeRequest`

```text
{ id, kind, status, business_id, branch_id,
  employee: { id, name_ar | null, name_en },
  session_id | null, session_revision | null,
  reason, requested_by, requested_at,
  decided_by | null, decided_at | null, decision_reason | null,
  cancelled_by | null, cancelled_at | null,
  revision, can_decide, can_cancel }
```

`can_decide` = viewer is an owner and the row is PENDING; `can_cancel` = viewer is the requester and the row is
PENDING.

## Errors

| Code | HTTP |
|---|---|
| `NOT_FOUND` | 404 (unknown, other business/company, out of scope, non-owner decide, non-requester cancel) |
| `FORBIDDEN` | 403 (paired device) |
| `ATTENDANCE_CHANGE_SELF_FORBIDDEN` | 403 |
| `ATTENDANCE_CHANGE_NOT_PENDING` | 409 |
| `ATTENDANCE_CHANGE_REVISION_CONFLICT` | 409 |
| `ATTENDANCE_CHANGE_DUPLICATE_PENDING` | 409 |
| `ATTENDANCE_CHANGE_KIND_UNAVAILABLE` | 422 |
| `VALIDATION_FAILED` | 400 |
| `IDEMPOTENCY_KEY_REUSED` | 409 (existing envelope) |
| `TRANSACTION_RETRY_REQUIRED` | 409/503 (existing envelope) |
| `NOT_READY` | 503 |

Every error carries `message_ar` / `message_en`.

## In-app templates (packages/notifications + contracts `in-app-notifications.ts`)

- `attendance_change_requested` rev 1 — `employee_name_ar`, `employee_name_en` (display names), `change`
  (`ADD_SESSION` | `VOID_SESSION`). ar: «طلب {{change}} لـ {{employee_name_ar}} مستني موافقتك» (the admin renderer maps
  `change` to «إضافة يوم حضور» / «إلغاء يوم حضور»).
- `attendance_change_decided` rev 1 — employee names, `change`, `decision` (`APPROVED` | `REJECTED`), `reason`
  (safe text or `-`).
