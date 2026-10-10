# Feature Specification: Fixed break window per shift

**Feature Branch**: `feat/p1-16b-break-window`

**Created**: 2026-10-10

**Status**: Owner questions BW-Q1 … BW-Q9 answered 2026-10-10 (Waleed, binding). The partner (Abu Salem) picked the
same answers; on BW-Q5 Waleed then adopted the partner's pick (option 2, 2026-10-10), which adds the not-returned
alert (User Story 4). Arabic questions and answers: [owner-questions.ar.md](owner-questions.ar.md).

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

## Owner questions — answered 2026-10-10

Waleed's answer is binding. The partner (Abu Salem, محمد العنزي) picked the same answers on every question; on BW-Q5
Waleed changed his answer to the partner's pick on 2026-10-10. The partner's BW-Q4 comment (the owner sets the break
length and the working hours, which may be 12 h, in the staff list) becomes a separate new plan row: default working
hours and break on the employee profile. It is not part of this row.

- **BW-Q1 — Where the break lives.** Decided (1): **on each shift**, in the week schedule and in the template pattern.
  Applying a template copies the break, and the manager can change one day's break on its own.
- **BW-Q2 — Required or optional.** Decided (1): **optional on every shift.**
- **BW-Q3 — How many breaks in one shift.** Decided (1): **at most one.**
- **BW-Q4 — Is the break part of her hours.** Decided (2), **not the recommended option**: **the break counts as
  working hours.** سارة 09:00–17:00 with break 13:00–14:00 is **8 hours**. The break never reduces scheduled hours or
  worked hours.
- **BW-Q5 — Clocking for the break.** Decided (2) on 2026-10-10 — Waleed changed from (1) to the partner's pick:
  «لازم تبصم خروج ودخول للبريك، ولو مارجعتش يظهر تنبيه للمدير». She clocks out and back in for the break; the return
  is measured against the **break end** with the usual 10-minute grace (back at 14:05 → not late; 14:12 → 12 minutes
  late). If she clocked out inside the break and has not clocked back in by the break end + 10 minutes, the branch's
  managers get an in-app alert (User Story 4). If she never clocked out for the break, nothing is raised: the option
  asks for an alert on a missing **return** only.
- **BW-Q6 — Smaller rules.** Decided (1), all four: the break lies inside the shift and touches neither its start nor
  its end; an overnight shift may have its break after midnight and it stays on the start day; schedules and templates
  stored before this row stay without a break; adding, changing or removing a break on a past day needs a reason.
- **BW-Q7 — Everyone on break at once.** Decided (1): **no check in this row.** The manager places breaks; a warning,
  if ever wanted, is its own row.
- **BW-Q8 — What counts as worked time (follow-up to BW-Q4).** Decided (recommended): time clocked out **inside** the
  break window counts as worked; time clocked out **outside** it (11:00–11:20) does not.
- **BW-Q9 — When a clock-in is a return from break.** Decided (recommended): only if she already clocked in earlier in
  the **same shift**. A first arrival after the break start (هبة at 13:30) is late from the shift start, so no one can
  hide lateness behind the break.

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
   refused with `SCHEDULE_BREAK_INVALID` and nothing is written (BW-Q6).
4. **Given** a shift 09:00–13:00, **When** the manager saves it without a break, **Then** it is accepted (BW-Q2).
5. **Given** the saved week, **When** any schedule read returns سارة's Saturday, **Then** the shift still reads as
   8 hours long (09:00–17:00); the break is shown beside it and never shortens it (BW-Q4).

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
   Monday and the template stay 13:00–14:00 (BW-Q1).
3. **Given** a template saved before this row (no break), **When** it is read, edited or applied, **Then** it works as
   before, with no break (BW-Q6).

---

### User Story 3 — Coming back from the break is not "late for the shift" (Priority: P3)

Decided by BW-Q5 (1). سارة clocks in at 08:58, clocks out at 13:00 for her break and back
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
4. **Given** she never clocks out for the break, **Then** nothing is raised: no exception, no alert (BW-Q5 — the
   alert is about a missing return only).
5. **Given** the same shift and **no** earlier session on it (she arrives for the first time at 13:30), **When** she
   clocks in, **Then** it is not a return from break: lateness is measured from the shift start, as in spec 027
   (270 minutes) (BW-Q9).
6. **Given** the same shift and a closed morning session, **When** she clocks back in at 13:45 (before the break end),
   **Then** `late_minutes` = 0.

### User Story 4 — The manager learns she did not come back from the break (Priority: P2)

Decided by BW-Q5 (2), 2026-10-10. سارة works 09:00–17:00 at Salmiya with break 13:00–14:00. She clocks in at 08:58
and clocks out at 13:02 for her break. By 14:10 (break end + the 10-minute grace) she has not clocked back in. The
owner, the general manager, the business manager and the Salmiya branch manager each see one new message in the admin
bell: "سارة has not clocked back in from the break that ended at 14:00 at Salmiya".

**Why this priority**: the owner's changed BW-Q5 answer asks for it; it reuses the not-clocked-in alert (spec 036).

**Independent Test**: schedule the shift with a break, a closed morning session ending inside the break, advance the
injected clock past break end + 10 minutes, run the not-clocked-in job: one break notice, one
`ShiftBreakNotReturned` event, one unread in-app message per manager; run it again: nothing new.

**Acceptance Scenarios**:

1. **Given** the session above and no later clock-in, **When** the job runs at 14:10 or later before 17:00, **Then**
   exactly one break notice and one event exist, and each manager covering Salmiya has exactly one unread message.
2. **Given** the same, **When** the job runs at 14:09, **Then** nothing is recorded or sent.
3. **Given** she clocked back in at Salmiya at 14:30 and the job first runs at 14:35, **Then** no alert (she is back
   before the job decides).
4. **Given** she never clocked out for the break (one session 08:58 still open), **Then** no alert.
5. **Given** she clocked out at 11:00 (outside the break) and not back, **Then** no alert from this row.
6. **Given** the job first runs at 17:00 or later (the shift is over), **Then** no alert.
7. **Given** a notice exists, **When** the job re-runs, restarts or runs on two workers, **Then** no second notice,
   event or message exists.

### Edge Cases

- **Overnight shift** 20:00–04:00 with break 00:30–01:00: the break belongs to the shift's working date (the start day),
  and its instants fall on the next calendar day (BW-Q6).
- **Friday overnight** ending in next week's Saturday: the break may fall on that Saturday; it stays part of Friday's
  shift (spec 020 rule).
- **Break touching the shift edge** (13:00–17:00 on a 09:00–17:00 shift): refused — that is a shorter shift, not a
  break (BW-Q6).
- **Break start = break end**, or break end before break start inside a day shift: refused.
- **Only one of the two times sent**: refused as invalid input (both or neither).
- **Split day** (two shifts on one day): each shift has its own optional break. The gap between the two shifts is not a
  break and is not stored.
- **Timezone gap/fold**: a break time that does not exist or is ambiguous locally is refused with
  `SCHEDULE_LOCAL_TIME_INVALID`, like shift times (spec 020 SC-Q2). Kuwait has no DST, so this is a guard only.
- **Past day**: adding, changing or removing a break on a past day is a change and needs a reason; re-saving an
  identical break is not a change (BW-Q6).
- **Stored schedules and templates** from before this row read as "no break" and keep working (BW-Q6).
- **Employees on break at the same time**: not checked (BW-Q7).
- **First clock-in of the shift after the break start** (she never came in the morning): not a return; measured from
  the shift start, unchanged from spec 027 (BW-Q9).
- **Clock-out and back in outside the break** (out 11:00, back 11:20 on a shift with break 13:00–14:00): not a return
  from break; unchanged from spec 027 (measured from the shift start), and the 20 minutes out are not worked time
  (BW-Q8). Fixing other mid-shift returns is out of scope.
- **Hours** (BW-Q4): a shift with a break is as long as its start–end; the break is never subtracted.
- **Not-clocked-in alert** (spec 036): unchanged — it is about the shift start; a break never moves it.
- **Not-returned alert** (User Story 4):
  - The alert moment is break end + 10 minutes. A shift whose alert moment is at or after its end never alerts
    (break 16:00–16:55 on a 09:00–17:00 shift), as in spec 036.
  - BW-Q11 (Waleed, 2026-10-10): a clock-out from 10 minutes before the break start counts as a break-out. With a
    13:00 break, 12:50 counts and 12:49 does not. A clock-out exactly at the break end does not count.
  - Two clock-outs inside the break (out 13:00, in 13:10, out 13:20): the latest one counts, and the return must
    come after it.
  - A return clock-in counts from that clock-out up to the moment the job decides, so she is not alerted if she is
    back when the job runs. A notice already sent is never retracted (spec 036 NC-Q9).
  - The clock-out must be on the same shift and branch: a closed session she ended herself, at the shift's branch,
    carrying this shift's end as its snapshot (the 16b-2 link). BW-Q10 (Waleed, 2026-10-10): the return must be at
    the same branch she clocked out from, otherwise the alert fires.
  - Return lateness is unchanged by BW-Q11. Out at 12:55 and back at 14:05 is a return, measured from the break end
    (0 late), because a return needs only an earlier closed session on the shift.
  - Approved leave applies as in spec 036 (NC-Q6), anchored at the break end. Full-day leave → no alert. Leave
    covering the break end to the shift end → no alert. Leave ending earlier → the alert moves to the leave end
    + 10 minutes. Pending leave does not excuse.
  - A deleted employee or an ended contract → no alert (NC-Q12).
  - A deleted or moved shift, or a removed break → judged by the schedule as it stands when the job decides (NC-Q9).
  - Once per shift (NC-Q5): the once-only key is the employee and the shift start.
  - The job never re-evaluates a shift that has ended. A manual session inserted later for a past day raises nothing.
- **Missed clock-out** (spec 029): unchanged — shift end + 4 h.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A manager with `manage:schedules:branch` MUST be able to set, change and remove a break (start time, end
  time, local `HH:mm`) on a shift of an employee's week (BW-Q1).
- **FR-002**: A manager with `manage:schedules:business` MUST be able to set a break on each shift of a template
  pattern; applying the template MUST copy the break into every created shift. A copied break is then that week's
  own value: changing it on one employee's day changes nothing else (BW-Q1).
- **FR-003**: A shift MUST be saveable without a break, whatever its length (BW-Q2).
- **FR-004**: A shift MUST carry at most one break (BW-Q3).
- **FR-005**: The system MUST refuse a break that does not lie strictly inside its shift, has zero or negative length,
  or gives only one of its two times, with no partial write (BW-Q6).
- **FR-006**: Every read that returns a shift (week grid, one employee's week, staff own schedule, templates, apply
  result) MUST return its break — the local times and, for concrete shifts, the resolved UTC instants — or none.
- **FR-007**: Adding, changing or removing a break on a past day MUST require the existing past-edit reason; an
  identical re-save MUST NOT (BW-Q6).
- **FR-008**: Every write that changes a break MUST be in the existing schedule/template before/after audit.
- **FR-009**: Schedules and templates stored before this row MUST read, edit and apply as "no break", with no data
  step (BW-Q6).
- **FR-010**: When the employee clocks in again on a shift that has a break — she already has an earlier session on
  that shift and the clock-in is at or after the break start — lateness MUST be measured from the break end with the
  10-minute grace of spec 027 (AT-Q7), and the session's stored scheduled start MUST be the break end. Every other
  clock-in keeps the spec 027 rule. Never clocking out for the break raises nothing; a clock-out inside the break with
  no return raises the manager alert of FR-013 (BW-Q5 (2), BW-Q9).
  Implementation detail (16b-2 review, 2026-10-10): "an earlier session" means one the employee closed herself
  (`status = 'CLOSED'`); a session the worker closed as `MISSED_OUT` is not a return. A return counts only while the
  clock-in is before the shift end; a clock-in at or after the shift end keeps the spec 027 rule.
- **FR-011**: The break MUST NOT reduce any hours figure (BW-Q4). Scheduled hours of a shift = end − start, break
  included (سارة: 8 h). For worked hours (row 27 board/report, not built in this row), time she spends clocked out
  inside her scheduled break window MUST count as worked, so a day 08:58–13:00 + 14:00–17:00 with break 13:00–14:00
  is not shorter than the same day without the clock-out; time clocked out outside the break window is not credited
  (BW-Q8). This row exposes no hours figure itself; row 27 implements the figure.
- **FR-012**: The admin schedule editor MUST show and round-trip the break, so saving a week without touching a break
  never erases it.
- **FR-013** (BW-Q5 (2), BW-Q10, BW-Q11, 2026-10-10): when the employee clocked out inside her shift's scheduled break
  (or up to 10 minutes before it starts) and has no
  clock-in at the shift's branch after that clock-out by the break end + 10 minutes, the system MUST alert the managers
  of the shift's branch once per shift. The recipients, channel, cadence, once-only protocol and audit are spec 036's
  (FR-005 … FR-010 there).
- **FR-014**: The not-returned alert MUST NOT be raised when she never clocked out inside the break (BW-Q5: the
  option asks for an alert on a missing return only). It is also not raised when she is back before the job decides,
  when the shift has ended, when approved leave excuses her, or when she is no longer employed.
- **FR-015**: The not-returned alert MUST NOT change attendance, lateness, sessions or exceptions. It adds no session
  status and no exception kind.

### Key Entities

- **Shift break**: an optional part of one shift — start and end local time, entered in the branch timezone, and (on
  a concrete week shift) the resolved UTC start/end instants. It has no identity of its own and no history beyond the
  schedule audit.
- **Weekly shift** (template pattern entry) and **concrete shift** (week copy): gain the optional break.

## Slice design *(mandatory — `CLAUDE.md` §1)*

### Business rules

- **BR-001** (LR-Q1, decided): a shift may hold a fixed break from–to; سارة 09:00–17:00, break 13:00–14:00.
- **BR-002** (BW-Q6): break placement — inside the shift, not touching start or end, length > 0. With the overnight
  shift 20:00–04:00, the break 00:30–01:00 is valid and 03:30–04:30 is not.
- **BR-003** (BW-Q2, BW-Q3): at most one break per shift; optional on every shift.
- **BR-004** (BW-Q4): the break **is** working time: سارة's day is 8 h on the schedule and 8 h of work. No hours
  figure ever subtracts it. Clocked-out time inside the break window is worked; outside it is not (BW-Q8).
- **BR-005** (BW-Q5, BW-Q9): return-from-break lateness = whole minutes after break end, 0 up to and including 10 minutes;
  it applies only to a return (an earlier session exists on the same shift) at or after the break start. The morning
  session's lateness and a first clock-in after the break start are unchanged.
- **BR-007** (BW-Q5 (2), BW-Q10, BW-Q11): the not-returned alert. Break-out = the latest `clock_out` in
  `[break_starts_at − 10 min, break_ends_at)` (BW-Q11) of a session with `status = 'CLOSED'`, the shift's branch and
  `scheduled_end = ends_at`. Alert moment = break end + 10 min, moved by approved leave as in spec 036 BR-002 with
  the break end as the anchor. Returned = any session of hers at the branch with `clock_in` from the break-out up
  to the decision instant (status `OPEN`, `CLOSED` or `MISSED_OUT`). Decision order:
  1. `STALE` when now ≥ shift end or alert moment ≥ shift end;
  2. `INELIGIBLE` for a deleted employee or an ended contract;
  3. `NO_BREAK_OUT` when there is no break-out;
  4. `EXCUSED` by leave;
  5. `RETURNED` when she came back;
  6. `WAIT` before the alert moment;
  7. otherwise `ALERT`.
- **BR-008**: recipients, channel, cadence (every 5 minutes, in the same company job as spec 036) and the interim
  rule are spec 036's BR-004 and BR-006. The once-only key is `(company_id, employee_id, shift_starts_at)` in a
  separate notice table, so a not-clocked-in notice and a not-returned notice for one shift never block each other.
- **BR-006**: comparing past days for the reason rule now uses ten canonical values per shift (the six of spec 020 plus
  break start/end and their two instants), still independent of key and array order.

### Schema changes

Expand only; nothing dropped or rewritten. The migration number is assigned at merge time (pipeline §2).

| Table | Columns added / changed | RLS policy | Indexes | Tenant-qualified FKs |
|---|---|---|---|---|
| `staff_schedule_shifts` | `break_start text NULL`, `break_end text NULL`, `break_starts_at timestamptz NULL`, `break_ends_at timestamptz NULL`; CHECK `staff_schedule_shifts_break_pair` (all four NULL or all four NOT NULL); CHECK `staff_schedule_shifts_break_inside` (`break_starts_at > starts_at AND break_ends_at < ends_at AND break_ends_at > break_starts_at` when present), added `NOT VALID` then `VALIDATE` | unchanged (existing FORCE RLS select/insert/delete; table-level grants already cover new columns) | none — breaks are always read with their shift row | unchanged |
| `staff_shift_templates` | none — `shifts jsonb` entries gain optional `break_start` / `break_end` keys | unchanged | none | unchanged |
| `attendance_break_not_returned_notices` (new, 16b-2) | PK `(company_id, id)`, `business_id`, `branch_id`, `employee_id`, `shift_starts_at`, `shift_ends_at`, `break_ends_at`, `break_out_at`, `alert_due_at`, `notified_at`, `recipient_count int`; CHECKs recipients ≥ 0, shift span, break end inside the shift | FORCE RLS `company_id = app_company_id()`; `pospay_app` SELECT + INSERT only | UNIQUE `(company_id, employee_id, shift_starts_at)`; `(company_id, business_id, branch_id)`; `(company_id, branch_id)` | `(company_id, business_id, employee_id)` → `employees`; `(company_id, business_id, branch_id)` → `branches`; no FK to the shift row (spec 036 BR-005) |

No change to the btree_gist exclusion (`0057:40`): breaks are inside the shift interval, so shift overlap is unchanged.
No grant change: `GRANT SELECT, INSERT, DELETE ON staff_schedule_shifts` is table-level (`0057:37`). The privileges
allowlist test therefore stays the same.

### API contract

No new endpoint, route, guard or permission. Additive fields only.

- `ScheduleShift` (input, weekly pattern, template shifts): optional nullable `break_start`, `break_end` (`HH:mm`).
  Both present or both absent/null, else `VALIDATION_FAILED` (400). BW-Q1 = on the shift, so the employee contract
  does not change.
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

- **Published**: none for schedules (spec 020). New in 16b-2: `ShiftBreakNotReturned` from worker `staff` to
  `notifications` — once per (employee, shift start) per recipient group of ≤ 100, in the notice's transaction.
  Payload: `notice_id, employee_id, business_id, branch_id, shift_starts_at, shift_ends_at, break_ends_at,
  break_out_at, alert_due_at, detected_at` and `notification_recipients` (IN_APP, template
  `break_not_returned` rev 1, parameters `employee_name_ar/en`, `branch_name_ar/en`, `break_end` `HH:MM`).
  The bell renders it in the viewer's UI locale, as `shift_not_clocked_in`. Audit: `attendance_notice` /
  `break_not_returned.detected`, actor NULL.
- **Consumed**: none new (the job is the spec 036 company job, registered on `CompanyCreated`/`AttendanceClockedIn`).
- Attendance events (`AttendanceClockedIn`) keep their payload; the stored `late_minutes` value of a return from
  break changes per BW-Q5.

### Test plan

- **Domain unit** (`schedules.ts`, `clock-attendance.ts`): break inside / touching start / touching end / outside /
  zero length / one-sided / overnight break after midnight / Friday→Saturday overnight / DST gap and fold refusal;
  template pattern with and without break; ten-value past comparison (break added, changed, removed, identical);
  return-from-break lateness at 13:45, 14:00, 14:10, 14:11, 14:12, without break, first clock-in after the break
  start (not a return), open session spanning the break; a shift with a break keeps its full length (BW-Q4).
- **Integration scenarios**: `BW-01` save week with break, read grid/own schedule; `BW-02` refused break leaves no
  row/audit; `BW-03` past-day break change needs reason, identical re-save does not; `BW-04` template with break →
  apply → copies carry it; template update leaves copies; `BW-05` stored pre-16b template and week work unchanged;
  `BW-06` DB CHECK rejects a direct insert of a break outside its shift or a half-filled pair; `BW-07` QR clock and
  card clock return-from-break lateness (BW-Q5); `BW-08` attendance correction of a return session recomputes from the
  stored scheduled start; `BW-09` not-returned alert (User Story 4: alert once, 14:09 wait, back before the job, never
  clocked out, out outside the break, shift over, leave, other branch, other shift, recipients, re-run and two
  workers); `BW-10` RLS and grants of the new notice table; EXPLAIN of the due-break page.
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
- **SC-006** (BW-Q4): no schedule read, and no later hours figure, shows a shift with a break as shorter than its
  start–end.
- **SC-005** (BW-Q5): a return from break within 10 minutes of the break end reports 0 late minutes.
- **SC-007** (BW-Q5 (2)): every employee who clocked out inside her break and is not back 10 minutes after it ends,
  while the shift runs, produces exactly one manager alert within 5 minutes; nobody who never clocked out for the
  break is alerted.

## Assumptions

- Break times use the same `HH:mm` format and minute precision as shift times; no quarter-hour rounding.
- The break is entered on each shift row of the existing edit dialog; the minimal admin grid of spec 020 is extended,
  not redesigned. There is still no admin template screen (spec 020 shipped the API only); templates get breaks
  through the API now and in their screen when it ships.
- Phase 1 never computes pay from attendance (SPEC §7 "Never hours, never a deduction"); BW-Q4 only fixes how hours
  are shown in later reports (break included).
- No appointment booking exists in Phase 1, so no availability check consumes the break yet.
- Row 16c (owner-set max shifts per day, spec 042) touches the same schedule files and merges first; this row is
  rebased on it (plan.md "Rebase onto 16c"; research R7).
