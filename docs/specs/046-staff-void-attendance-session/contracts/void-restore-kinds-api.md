# API — void and restore kinds (on 26a's endpoints)

No new endpoint. Routes, guards and idempotency are 26a's
([044 contract](../../044-staff-attendance-change-requests/contracts/attendance-change-requests-api.md)).

## File — `POST /v1/businesses/:businessId/attendance-change-requests`

```text
{ kind: 'VOID_SESSION',    employee_id, session_id, session_revision: int ≥ 0, reason }
{ kind: 'RESTORE_SESSION', employee_id, session_id, session_revision: int ≥ 0, reason }
```

`session_id` and `session_revision` are mandatory for both (strict objects). `employee_id` must be the session's
employee, else `NOT_FOUND`. 201 → `AttendanceChangeRequest` (PENDING, or APPROVED with the effect applied for the
owner's own filing).

## Decide — `POST …/:requestId/decide`

200 → `AttendanceChangeDecisionResult` = `AttendanceChangeRequest` + `effect`:

```text
effect: { session: { id, working_date, clock_in, clock_out, status, revision, voided_at, voided_by, void_request_id } } | null
```

`null` on REJECTED.

## `AttendanceChangeRequest` — field added

```text
requested: { branch_id, working_date, clock_in, clock_out } | null   // the session the request is about
```

## Errors (new or newly reachable)

| Code | HTTP | When |
|---|---|---|
| `ATTENDANCE_SESSION_OPEN` | 409 | void of an OPEN session (ACR-Q19) |
| `ATTENDANCE_SESSION_VOIDED` | 409 | void of a voided session; PR-26 correction of a voided session |
| `ATTENDANCE_SESSION_NOT_VOIDED` | 409 | restore of a session that is not voided |
| `ATTENDANCE_SESSION_REVISION_CONFLICT` | 409 | the session changed since the request saw it (ACR-Q13) |
| `ATTENDANCE_RESTORE_OVERLAP` | 422 | the restored hours overlap another non-voided session (FR-008) |
| `ATTENDANCE_CHANGE_DUPLICATE_PENDING` | 409 | a PENDING void or restore already waits for that session (ACR-Q11) |

A refusal at approval rolls the transaction back; the request stays PENDING.
