# Data model — 046 void and restore an attendance session

## `attendance_sessions` (existing, staff) — columns added

| Column | Type | Notes |
|---|---|---|
| `voided_at` | `timestamptz NULL` | when the approval made the void effective |
| `voided_by` | `uuid NULL` → `user(id)` | the approver (BR-004); requester and reason live on the request |
| `void_request_id` | `uuid NULL` | the approved `VOID_SESSION` request |

- CHECK `attendance_sessions_void_marks`: all three NULL or all three NOT NULL.
- CHECK `attendance_sessions_void_closed`: `voided_at IS NULL OR status <> 'OPEN'` (ACR-Q19).
- FK `attendance_sessions_void_request_fk`: `(company_id, void_request_id)` → `attendance_change_requests(company_id, id)`,
  `DEFERRABLE INITIALLY DEFERRED` (research R3).
- Indexes (CONCURRENTLY): `attendance_sessions_voided_by_idx (company_id, voided_by)`,
  `attendance_sessions_void_request_idx (company_id, void_request_id)`.
- `revision` (exists) increases by one on void and on restore.
- RLS, grants: unchanged (research R2).

## `attendance_change_requests` (26a) — constraints changed

- CHECK `attendance_change_requests_kind`: `kind IN ('ADD_SESSION','VOID_SESSION','RESTORE_SESSION')`.
- CHECK `attendance_change_requests_session_kind`: `kind NOT IN ('VOID_SESSION','RESTORE_SESSION') OR (session_id IS
  NOT NULL AND session_revision IS NOT NULL)`.
- Partial UNIQUE `attendance_change_requests_one_pending_session` on `(company_id, session_id) WHERE status = 'PENDING'
  AND kind IN ('VOID_SESSION','RESTORE_SESSION')` replaces `attendance_change_requests_one_pending_void`.

## State transitions of the void mark

```text
not voided ──(VOID_SESSION approved; status CLOSED|MISSED_OUT; revision match)──▶ voided     (revision + 1)
voided     ──(RESTORE_SESSION approved; revision match; no overlap)────────────▶ not voided (revision + 1)
```

`status`, `clock_in`, `clock_out`, `closed_by`, scan facts, exceptions and correction rows never change with the mark.
The original `VOID_SESSION` request row stays APPROVED after a restore (history).

## Audit

- `attendance_session.voided` / `attendance_session.restored`, entity `attendance_session`, before/after
  `{ voided_at, voided_by, void_request_id, revision }`.
- 26a's request audit (`attendance_change.requested/approved/rejected/cancelled`) is unchanged.
