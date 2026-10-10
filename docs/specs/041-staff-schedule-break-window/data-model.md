# Data model — 041 fixed break window per shift

Expand only. No new table, no grant change, no index. Owner answers: BW-Q1 … BW-Q7 (2026-10-10).

## Shift break (value, no identity)

Part of one shift. Absent = no break (every row stored before this row).

| Field | Type | Rule |
|---|---|---|
| `break_start` | `HH:mm` local (branch timezone) | both or neither with `break_end` |
| `break_end` | `HH:mm` local | both or neither with `break_start` |
| `break_starts_at` | UTC instant (concrete shifts only) | resolved from `working_date` (or the next day after midnight) |
| `break_ends_at` | UTC instant (concrete shifts only) | same |

Validation (BR-002, plan D2): with `off(t) = (t − shift.start + 1440) mod 1440` and `duration` the shift length in
minutes, a break is valid iff `0 < off(break_start) < off(break_end) < duration`. At most one per shift (BR-003).
Optional on every shift (BW-Q2). It never shortens the shift and never reduces hours (BW-Q4).

Examples:

| Shift | Break | Result |
|---|---|---|
| 09:00–17:00 | 13:00–14:00 | valid |
| 09:00–17:00 | 16:30–17:30 | `SCHEDULE_BREAK_INVALID` (crosses the end) |
| 09:00–17:00 | 08:30–09:30 | `SCHEDULE_BREAK_INVALID` (before the start) |
| 09:00–17:00 | 13:00–17:00 | `SCHEDULE_BREAK_INVALID` (touches the end) |
| 09:00–17:00 | 13:00–13:00 | `SCHEDULE_BREAK_INVALID` (zero length) |
| 20:00–04:00 | 00:30–01:00 | valid; instants on the next calendar day; belongs to the start day |
| 20:00–04:00 | 03:30–04:30 | `SCHEDULE_BREAK_INVALID` |
| 09:00–17:00 | only `break_start` | `VALIDATION_FAILED` (contract) |

## `staff_schedule_shifts` (existing table, columns added)

| Column | Type | Note |
|---|---|---|
| `break_start` | `text NULL` | local `HH:mm` |
| `break_end` | `text NULL` | local `HH:mm` |
| `break_starts_at` | `timestamptz NULL` | |
| `break_ends_at` | `timestamptz NULL` | |

CHECKs (added `NOT VALID` with the columns, then `VALIDATE` in a separate following migration so the `ADD COLUMN`
lock is released before the scan — every existing row is all-NULL):

- `staff_schedule_shifts_break_pair`: all four NULL or all four NOT NULL.
- `staff_schedule_shifts_break_inside`: `break_starts_at IS NULL OR (break_starts_at > starts_at AND
  break_ends_at > break_starts_at AND break_ends_at < ends_at)`.

Unchanged: PK `(company_id, id)`, FORCE RLS select/insert/delete policies, table-level
`GRANT SELECT, INSERT, DELETE` (covers new columns), btree_gist employee exclusion (breaks lie inside the shift),
indexes. The privileges allowlist test does not change.

## `staff_shift_templates.shifts` (existing JSONB)

Each entry `{ day, start, end }` may gain `break_start`, `break_end` (both or neither). Missing keys read as no
break. No migration of stored values.

## Domain types (`apps/api/src/modules/staff/domain/schedule-types.ts`)

- `WeeklyShift` + `break_start: string | null`, `break_end: string | null` (optional on input, normalised to `null`).
- `ConcreteShift` + `break_starts_at: string | null`, `break_ends_at: string | null`.
- `ScheduleErrorCode` + `SCHEDULE_BREAK_INVALID`.

## Attendance (16b-2, no schema change)

`attendance_sessions.scheduled_start` already exists. For a return from break (plan D6) it holds the break end
instead of the shift start; `late_minutes` follows. Candidate shift input to `planAttendance` gains
`breakStartsAt: Date | null`, `breakEndsAt: Date | null`, `returning: boolean`.

## State

No state machine. A break changes only through the existing schedule save, template create/update, and apply; the
existing schedule/template audit stores before/after.
