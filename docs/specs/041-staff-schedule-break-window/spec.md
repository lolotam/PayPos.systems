# Feature Specification: Fixed break window per shift

**Feature Branch**: `feat/p1-16b-break-window`

**Created**: 2026-10-10

**Status**: Draft — owner questions BW-Q1 … BW-Q7 are **PENDING** ([owner-questions.ar.md](owner-questions.ar.md)).
Not ready for `/speckit-plan` until they are answered.

**Input**: Phase 1 plan row **16b** (`docs/specs/phase-1/IMPLEMENTATION-PLAN.md:59`): "fixed break window per employee
per shift (from–to) in schedules and templates". Depends on row 16 (spec 020, schedules + templates, merged). Source
decision: owner review 2026-10-09, `docs/specs/phase-1/owner-review-2026-10-09.ar.md:74-78`, item **LR-Q1**.
Research: [research.md](research.md).

## Owner decision already taken (2026-10-09, LR-Q1 — binding)

- In the shift schedule, each employee gets a **fixed break, from one time to another**. Example: سارة works
  09:00–17:00 and her break is 13:00–14:00.
- The original LR-Q1 rule (hourly leave in quarter hours) is unchanged and is not part of this slice.
- Not re-asked here: the 16-hour shift limit and the per-day shift count — row 16c owns them (S020-SHIFTS). The "breaks
  between consecutive shifts" in 16c are the **gap between two shifts**, not this in-shift break.

## Owner questions (PENDING — see `owner-questions.ar.md`)

Every rule below that depends on an answer is marked `TODO(spec) → BW-Qn`. The recommended option is written so the
spec reads end to end; it is **not** a decision until Waleed picks it.

- **BW-Q1 — Where the break lives.** Recommended (A): on each shift, in the week schedule and in the template pattern;
  applying a template copies it, and the manager can change one day. Alternative (B): one break time on the employee
  record, applied to every shift she has.
- **BW-Q2 — Required or optional.** Recommended (A): optional on every shift. Alternatives: required on shifts longer
  than 5 hours; required on every shift.
- **BW-Q3 — How many breaks in one shift.** Recommended (A): at most one. Alternative: up to two.
- **BW-Q4 — Is the break part of her hours.** Recommended (A): no — scheduled hours exclude the break (سارة: 8 h shift,
  7 h of work). Alternative: the break is counted inside her hours.
- **BW-Q5 — Clocking for the break.** Recommended (A): she does not have to clock for it; if she does clock out and
  back in around it, the return is measured against the break end with the usual 10-minute grace, not against the shift
  start. Alternatives: clocking out and in is required and a missed return is flagged; or the break is display-only and
  attendance stays exactly as today.
- **BW-Q6 — Smaller rules, one approval.** Recommended (A) as a set: the break lies fully inside the shift and cannot
  touch its start or end; an overnight shift may have its break after midnight; schedules and templates already stored
  stay without a break; changing a break on a past day needs a reason like any past edit.
- **BW-Q7 — Everyone on break at once.** Recommended (A): no check in this row. Alternative: a warning (never a block)
  when the break would leave the branch with no one working.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — The manager fixes سارة's break in her week (Priority: P1)

The Salmiya branch manager opens the week grid, edits سارة's Saturday shift 09:00–17:00 and sets the break 13:00–14:00.
After saving, the grid shows the shift and its break; the staff own-schedule read returns it as well.

**Why this priority**: it is the owner's whole request (LR-Q1).

**Independent Test**: save a week with one shift and a break through the schedule API; read it back through the grid
and own-schedule reads; the break appears with its local times and resolved instants, and the audit row holds it.

**Acceptance Scenarios**:

1. **Given** سارة has no schedule this week, **When** the manager saves Saturday 09:00–17:00 with break 13:00–14:00,
   **Then** the schedule is saved with the break and one audit entry records it.
2. **Given** the saved week, **When** the manager reopens the edit dialog and saves without touching the break,
   **Then** the break is kept unchanged (the form must round-trip it).
3. **Given** a shift 09:00–17:00, **When** the manager sets a break 16:30–17:30 or 08:30–09:30, **Then** the save is
   refused with `SCHEDULE_BREAK_INVALID` and nothing is written. `TODO(spec) → BW-Q6`
4. **Given** a shift 09:00–13:00, **When** the manager saves it without a break, **Then** it is accepted.
   `TODO(spec) → BW-Q2`

---

### User Story 2 — The break travels with a template (Priority: P2)

The business manager creates the template «دوام الصبح» with Saturday–Thursday 09:00–17:00, break 13:00–14:00, and
applies it to سارة and هبة for two weeks. Each copied shift carries the break. Editing the template afterwards does not
change the copies (spec 020 rule).

**Why this priority**: templates are how most weeks are filled; without the break in them the manager would re-type it
per employee per day.

**Independent Test**: create a template with breaks, apply it, read the copies; update the template, read again.

**Acceptance Scenarios**:

1. **Given** a template with a break on each day, **When** it is applied to two employees for two weeks, **Then** all
   four copies carry the break on every shift.
2. **Given** an applied copy, **When** the manager changes سارة's Monday break to 14:00–15:00 only, **Then** هبة's
   Monday and the template stay 13:00–14:00. `TODO(spec) → BW-Q1`
3. **Given** a template saved before this row (no break), **When** it is read, edited or applied, **Then** it works as
   before, with no break. `TODO(spec) → BW-Q6`

---

### User Story 3 — Coming back from the break is not "late for the shift" (Priority: P3)

`TODO(spec) → BW-Q5`. With the recommended answer: سارة clocks in at 08:58, clocks out at 13:00 for her break and back
in at 14:05. Today the second clock-in is compared with the shift start (09:00) and is stored as **305 minutes late**.
With a break 13:00–14:00 on that shift, the return is compared with 14:00: 5 minutes, inside the 10-minute grace, so
0 late minutes. At 14:12 it is 12 minutes late (full minutes, AT-Q7).

**Why this priority**: today's behaviour already produces a misleading lateness figure for anyone who clocks out
mid-shift; the board and monthly report (row 27) would show it.

**Independent Test**: pure attendance tests for the return clock-in with and without a break; an integration test of
the personal QR clock and the card clock with a scheduled break.

**Acceptance Scenarios**:

1. **Given** a shift 09:00–17:00 with break 13:00–14:00 and a closed morning session, **When** she clocks in at 14:05,
   **Then** `late_minutes` = 0 and the session's scheduled start is the break end.
2. **Given** the same shift, **When** she clocks in at 14:12, **Then** `late_minutes` = 12.
3. **Given** the same shift without a break, **When** she clocks in at 14:05, **Then** behaviour is unchanged from spec
   027 (compared with 09:00).
4. **Given** she never clocks out for the break, **Then** nothing is raised: no exception, no alert. `TODO(spec) → BW-Q5`

### Edge Cases

- **Overnight shift** 20:00–04:00 with break 00:30–01:00: the break belongs to the shift's working date (the start day),
  and its instants fall on the next calendar day. `TODO(spec) → BW-Q6`
- **Friday overnight** ending in next week's Saturday: the break may fall on that Saturday; it stays part of Friday's
  shift (spec 020 rule).
- **Break touching the shift edge** (13:00–17:00 on a 09:00–17:00 shift): refused — that is a shorter shift, not a
  break. `TODO(spec) → BW-Q6`
- **Break start = break end**, or break end before break start inside a day shift: refused.
- **Only one of the two times sent**: refused as invalid input (both or neither).
- **Split day** (two shifts on one day): each shift has its own optional break. The gap between the two shifts is not a
  break and is not stored.
- **Timezone gap/fold**: a break time that does not exist or is ambiguous locally is refused with
  `SCHEDULE_LOCAL_TIME_INVALID`, like shift times (spec 020 SC-Q2). Kuwait has no DST, so this is a guard only.
- **Past day**: adding, changing or removing a break on a past day is a change and needs a reason; re-saving an
  identical break is not a change. `TODO(spec) → BW-Q6`
- **Stored schedules and templates** from before this row read as "no break" and keep working. `TODO(spec) → BW-Q6`
- **Employees on break at the same time**: not checked. `TODO(spec) → BW-Q7`
- **Not-clocked-in alert** (spec 036): unchanged — it is about the shift start; a break never moves it.
- **Missed clock-out** (spec 029): unchanged — shift end + 4 h.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A manager with `manage:schedules:branch` MUST be able to set, change and remove a break (start time, end
  time, local `HH:mm`) on a shift of an employee's week. `TODO(spec) → BW-Q1`
- **FR-002**: A manager with `manage:schedules:business` MUST be able to set a break on each shift of a template
  pattern; applying the template MUST copy the break into every created shift. `TODO(spec) → BW-Q1`
- **FR-003**: A shift MUST be saveable without a break. `TODO(spec) → BW-Q2`
- **FR-004**: A shift MUST carry at most one break. `TODO(spec) → BW-Q3`
- **FR-005**: The system MUST refuse a break that does not lie strictly inside its shift, has zero or negative length,
  or gives only one of its two times, with no partial write. `TODO(spec) → BW-Q6`
- **FR-006**: Every read that returns a shift (week grid, one employee's week, staff own schedule, templates, apply
  result) MUST return its break — the local times and, for concrete shifts, the resolved UTC instants — or none.
- **FR-007**: Adding, changing or removing a break on a past day MUST require the existing past-edit reason; an
  identical re-save MUST NOT. `TODO(spec) → BW-Q6`
- **FR-008**: Every write that changes a break MUST be in the existing schedule/template before/after audit.
- **FR-009**: Schedules and templates stored before this row MUST read, edit and apply as "no break", with no data
  step. `TODO(spec) → BW-Q6`
- **FR-010**: When a scheduled shift has a break and the employee clocks in again after the break start, lateness MUST
  be measured from the break end with the 10-minute grace of spec 027 (AT-Q7). `TODO(spec) → BW-Q5`
- **FR-011**: Any "scheduled hours" figure exposed by this or later rows (row 27 board/report) MUST exclude the break.
  This row exposes none itself. `TODO(spec) → BW-Q4`
- **FR-012**: The admin schedule editor MUST show and round-trip the break, so saving a week without touching a break
  never erases it.

### Key Entities

- **Shift break**: an optional part of one shift — start and end local time, entered in the branch timezone, and (on
  a concrete week shift) the resolved UTC start/end instants. It has no identity of its own and no history beyond the
  schedule audit.
- **Weekly shift** (template pattern entry) and **concrete shift** (week copy): gain the optional break.

## Slice design *(mandatory — `CLAUDE.md` §1)*

### Business rules

- **BR-001** (LR-Q1, decided): a shift may hold a fixed break from–to; سارة 09:00–17:00, break 13:00–14:00.
- **BR-002**: break placement — inside the shift, not touching start or end, length > 0. With the overnight shift
  20:00–04:00, the break 00:30–01:00 is valid and 03:30–04:30 is not. `TODO(spec) → BW-Q6`
- **BR-003**: at most one break per shift; optional. `TODO(spec) → BW-Q2, BW-Q3`
- **BR-004**: the break is not working time: سارة's day is 8 h on the schedule and 7 h of work. `TODO(spec) → BW-Q4`
- **BR-005**: return-from-break lateness = whole minutes after break end, 0 up to and including 10 minutes; the
  morning session's lateness is unchanged. `TODO(spec) → BW-Q5`
- **BR-006**: comparing past days for the reason rule now uses ten canonical values per shift (the six of spec 020 plus
  break start/end and their two instants), still independent of key and array order.

### Schema changes

Expand only; nothing dropped or rewritten. The migration number is assigned at merge time (pipeline §2).

| Table | Columns added / changed | RLS policy | Indexes | Tenant-qualified FKs |
|---|---|---|---|---|
| `staff_schedule_shifts` | `break_start text NULL`, `break_end text NULL`, `break_starts_at timestamptz NULL`, `break_ends_at timestamptz NULL`; CHECK `staff_schedule_shifts_break_pair` (all four NULL or all four NOT NULL); CHECK `staff_schedule_shifts_break_inside` (`break_starts_at > starts_at AND break_ends_at < ends_at AND break_ends_at > break_starts_at` when present), added `NOT VALID` then `VALIDATE` | unchanged (existing FORCE RLS select/insert/delete; table-level grants already cover new columns) | none — breaks are always read with their shift row | unchanged |
| `staff_shift_templates` | none — `shifts jsonb` entries gain optional `break_start` / `break_end` keys | unchanged | none | unchanged |

No change to the btree_gist exclusion (`0057:40`): breaks are inside the shift interval, so shift overlap is unchanged.
No grant change: `GRANT SELECT, INSERT, DELETE ON staff_schedule_shifts` is table-level (`0057:37`). The privileges
allowlist test therefore stays the same.

### API contract

No new endpoint, route, guard or permission. Additive fields only.

- `ScheduleShift` (input, weekly pattern, template shifts): optional nullable `break_start`, `break_end` (`HH:mm`).
  Both present or both absent/null, else `VALIDATION_FAILED` (400). `TODO(spec) → BW-Q1` (if BW-Q1 = B the fields move
  to the employee contract instead).
- `ConcreteShift` (responses): `break_start`, `break_end` (`HH:mm | null`), `break_starts_at`, `break_ends_at`
  (ISO datetime `| null`).
- Routes affected (bodies or responses): `GET/PUT …/schedules/{employeeId}`, `GET …/schedules` (grid),
  `GET /v1/staff/my-schedule`, `GET/POST …/shift-templates`, `PATCH …/shift-templates/{id}`, `POST …/{id}/apply`.
- **Idempotency-Key**: not required (no money/stock effect; unchanged from spec 020).
- **Errors**: new `SCHEDULE_BREAK_INVALID` (400) — `message_ar` «وقت البريك لازم يكون جوّه الشيفت» /
  `message_en` "The break must be inside the shift". Existing `SCHEDULE_LOCAL_TIME_INVALID` and
  `SCHEDULE_PAST_REASON_REQUIRED` cover break times too.
- Generated OpenAPI and the admin/POS generated clients are regenerated.

### Permissions

- Unchanged: `read/manage:schedules:branch` for weeks, `read/manage:schedules:business` for templates (spec 020).
  Staff own-schedule read (`my-schedule`) returns her own breaks only.

### Events

- **Published**: none (spec 020 publishes none for schedules).
- **Consumed**: none.
- Attendance events (`AttendanceClockedIn`) keep their payload; the stored `late_minutes` value changes per BW-Q5.

### Test plan

- **Domain unit** (`schedules.ts`, `clock-attendance.ts`): break inside / touching start / touching end / outside /
  zero length / one-sided / overnight break after midnight / Friday→Saturday overnight / DST gap and fold refusal;
  template pattern with and without break; ten-value past comparison (break added, changed, removed, identical);
  return-from-break lateness at 14:00, 14:10, 14:11, 14:12, without break, open session spanning the break.
- **Integration scenarios**: `BW-01` save week with break, read grid/own schedule; `BW-02` refused break leaves no
  row/audit; `BW-03` past-day break change needs reason, identical re-save does not; `BW-04` template with break →
  apply → copies carry it; template update leaves copies; `BW-05` stored pre-16b template and week work unchanged;
  `BW-06` DB CHECK rejects a direct insert of a break outside its shift or a half-filled pair; `BW-07` QR clock and
  card clock return-from-break lateness (BW-Q5); `BW-08` attendance correction of a return session recomputes from the
  stored scheduled start.
- **RLS negative**: existing schedule-table cross-tenant tests extended to read a break column (0 rows) — no new table.
- **Queries**: `schedule-week.query.ts` result-shape test updated with break fields; existing EXPLAIN assertions kept.
- **Admin**: shift-fields break inputs, form defaults round-trip, grid shows `13:00–14:00` break label, ar/en keys.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A manager sets سارة's break for a whole week in one save, and from a template for up to 12 weeks in one
  apply.
- **SC-002**: 100 % of shifts saved or applied with a break are returned with the same break by every schedule read.
- **SC-003**: No break outside its shift can be stored, through the API or a direct database write.
- **SC-004**: Every week and template stored before this row keeps working with no manual step.
- **SC-005** (BW-Q5 = A): a return from break within 10 minutes of the break end reports 0 late minutes.

## Assumptions

- Break times use the same `HH:mm` format and minute precision as shift times; no quarter-hour rounding.
- The break is entered on each shift row of the existing edit dialog; the minimal admin grid of spec 020 is extended,
  not redesigned. There is still no admin template screen (spec 020 shipped the API only); templates get breaks
  through the API now and in their screen when it ships.
- Phase 1 never computes pay from attendance (SPEC §7 "Never hours, never a deduction"); BW-Q4 only fixes how hours
  are shown in later reports.
- No appointment booking exists in Phase 1, so no availability check consumes the break yet.
- Row 16c (owner-set max shifts per day) touches the same schedule files; see research R7 for the overlap.
