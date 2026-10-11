# Research — 045 add a manual attendance session

All owner questions are answered (044 owner-questions, 2026-10-10). These are the technical decisions.

## R1 — Linking the session and the request, including the owner one-step

- **Decision**: `attendance_sessions.change_request_id` with a tenant-qualified FK to
  `attendance_change_requests(company_id, id)`, checked immediately. A partial UNIQUE index keeps one session per
  request. The
  request id is generated once before the kind runs and passed to it as `scope.requestId`.
- **Rationale**: 26a's `hold()` (bf763299) persists the request PENDING before `kind.apply`, also on the owner
  one-step (ACR-Q2), so the request row exists when the session is inserted and an immediate FK is enough. An earlier
  draft used a deferred FK because the session was inserted before the request; that order no longer exists.
- **Alternatives**: re-order 26a's save into insert → apply → link (rewrites the mechanism under review in #148);
  drop the session-side FK and rely on `attendance_change_requests.session_id` alone (loses the
  `(source = 'MANUAL') = (change_request_id IS NOT NULL)` guarantee in the database).

## R2 — Overlap facts

- **Decision**: the context adapter reads the employee's sessions in the ±2-day working-date window plus any OPEN
  session (same shape as `correctionNeighboursStatement`), under 26a's `AttendanceState` lock. The CA-Q8 rule moves
  into a pure `domain/attendance-interval.ts` helper used by both correction and manual planning.
- **Rationale**: the State lock already serialises scans, corrections and requests of one employee (044 BR-003);
  16 h max + branch timezone spread fits in ±2 days. One rule, one function.
- **26c**: when 26c lands, the neighbours read gains `voided_at IS NULL` (whichever merges second reconciles).

## R3 — What the decide response carries

- **Decision**: keep 26a's `effect: null`; the created session is the response's `session_id`. Add a nullable
  `requested` object (`clock_in`, `clock_out`, `working_date`, `timezone`) to `AttendanceChangeRequest`.
- **Rationale**: the board (PR 27) reads the session by id; changing `effect` now collides with 26c, which owns the
  void effect shape.

## R4 — Pending ADD overlap (ACR-Q11)

- **Decision**: checked in `planManualSession` at filing from the employee's other PENDING ADD requests, read under the
  State lock; refused with `ATTENDANCE_CHANGE_DUPLICATE_PENDING` (409). At approval the request itself is excluded.
- **Rationale**: an exclusion constraint needs `btree_gist` (new extension → ADR); the State lock already serialises
  the filings of one employee. Partial index `(company_id, employee_id) WHERE kind = 'ADD_SESSION' AND status =
  'PENDING'` keeps the read cheap.

## R5 — Schedule and timezone

- **Decision**: branch timezone through `tenancy.attendanceBranch` (effective branch, else business). Shift
  candidates of **that branch** on the working date or covering the clock-in (AT-Q5), via a copy of the 16b-2 query in
  the new adapter; `attendanceSchedule` picks the shift; `attendanceLateMinutes` applies AT-Q7. The session stores
  `scheduled_start`/`scheduled_end` of the picked shift (NULL when none → lateness 0).
- **Rationale**: the same functions the scan uses (ACR-Q17 "like any day"); `attendance-context.adapter.ts` is lane
  16b-2's and is not edited.

## R6 — Session values for a manual day

- **Decision**: `geo 'NONE'`, `out_geo 'NONE'`, no binding/device/operator/QR window/location; a CHECK enforces it
  for `source = 'MANUAL'` together with `status 'CLOSED'` and `closed_by 'MANUAL'`.
- **Rationale**: FR-005 / SC-004 — a manual day never carries a fake location or device.

## R7 — Who/what is refused before any write

- Device actors: 26a refuses (`FORBIDDEN`) before the kind (ACR-Q22c).
- Unknown/soft-deleted employee or branch outside the business: `target` returns null → `NOT_FOUND`.
- Approved leave is not read (ACR-Q22b); no date floor (ACR-Q22a).
