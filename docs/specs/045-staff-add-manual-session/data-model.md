# Data model — 045 add a manual attendance session

No new table. Two expand migrations: **0118** (columns, FK, CHECKs `NOT VALID`) and **0119** (concurrent index
prefix, then `VALIDATE CONSTRAINT`), the 0109/0110 pattern.

## `attendance_sessions` (exists)

| Change | Detail |
|---|---|
| `source` CHECK | `IN ('QR','BARCODE','MANUAL')` (drop + re-add `NOT VALID`, validate in 0119) |
| `close_pair` CHECK | closed branch accepts `closed_by IN ('EMPLOYEE','MISSED_OUT','MANUAL')` |
| `change_request_id uuid NULL` | the approved request that created a MANUAL session |
| FK `attendance_sessions_change_request_fk` | `(company_id, change_request_id)` → `attendance_change_requests(company_id, id)`, immediate (26a's `hold()` inserts the request before `apply`; research R1) |
| CHECK `attendance_sessions_manual_link` | `(source = 'MANUAL') = (change_request_id IS NOT NULL)` |
| CHECK `attendance_sessions_manual_shape` | `source <> 'MANUAL' OR (status = 'CLOSED' AND closed_by = 'MANUAL' AND binding_id IS NULL AND out_binding_id IS NULL AND device_id IS NULL AND out_device_id IS NULL AND operator_id IS NULL AND out_operator_id IS NULL AND qr_window IS NULL AND out_qr_window IS NULL AND latitude IS NULL AND out_latitude IS NULL AND geo = 'NONE' AND (out_geo IS NULL OR out_geo = 'NONE'))` |
| Index `attendance_sessions_change_request_idx` | UNIQUE `(company_id, change_request_id) WHERE change_request_id IS NOT NULL` (one session per request), `CONCURRENTLY` in 0119 |
| CHECK `attendance_change_requests_add_linked` | `kind <> 'ADD_SESSION' OR status <> 'APPROVED' OR session_id IS NOT NULL`, `NOT VALID` in 0118, validated in 0119 |

Also `closed_by = 'MANUAL'` only with `source = 'MANUAL'` (part of the manual-shape pair:
`closed_by <> 'MANUAL' OR source = 'MANUAL'`).

## `attendance_change_requests` (26a)

| Change | Detail |
|---|---|
| `clock_in timestamptz NULL`, `clock_out timestamptz NULL` | the requested times (UTC instants) |
| `working_date date NULL`, `timezone text NULL` | computed at filing from the branch timezone; re-computed (and must match) at approval |
| CHECK `attendance_change_requests_add_values` | `kind <> 'ADD_SESSION' OR (clock_in IS NOT NULL AND clock_out IS NOT NULL AND working_date IS NOT NULL AND timezone IS NOT NULL AND clock_out > clock_in AND session_revision IS NULL)` |
| CHECK `attendance_change_requests_add_only` | `kind = 'ADD_SESSION' OR (clock_in IS NULL AND clock_out IS NULL AND working_date IS NULL AND timezone IS NULL)` |
| Index `attendance_change_requests_pending_add_idx` | `(company_id, employee_id) WHERE kind = 'ADD_SESSION' AND status = 'PENDING'` (new 26a table, created in 0118) |

Grants: `pospay_app` already INSERTs both tables; the UPDATE column list of `attendance_change_requests` is
unchanged (the four ADD columns are written on INSERT only). `privileges.spec.ts` unchanged unless the INSERT grant
is column-scoped (then the four columns are added).

## Domain values

`ManualSessionPlan = { working_date, timezone, clock_in, clock_out, late_minutes, scheduled_start | null,
scheduled_end | null }` — the session row values; everything else is fixed by the kind (R6).

## State

A MANUAL session is born `CLOSED` with `revision 0`. It is never corrected (ACR-Q10); only 26c's void changes it.
