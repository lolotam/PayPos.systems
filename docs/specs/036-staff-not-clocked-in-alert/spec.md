# Feature Specification: Not-clocked-in alert

**Feature Branch**: `feat/p1-28-not-clocked-in-alert`

**Created**: 2026-10-08

**Status**: Draft — owner questions NC-Q1…NC-Q12 **PENDING**.

**Input**: User description: "staff-not-clocked-in-alert — Phase 1 PR 28."

**Phase 1 row**: PR 28 (`docs/specs/phase-1/IMPLEMENTATION-PLAN.md:68`), depends on PR 22 (clock attendance, spec 027)
and PR 15 (document-expiry job, spec 033), both merged. PR 62 (alert-rules screen + master switch,
`IMPLEMENTATION-PLAN.md:116`) depends on this slice.

**Sources**:
- PRD D-47 (`docs/PRD.md:993`): "Not-clocked-in alert: manager, 20 min after shift start". Every alert kind has
  on/off, recipients, channels (WhatsApp, email, in-app), its delay, and a master switch.
- PRD P1-T7.3 (`docs/PRD.md:614`): operational alerts are worker jobs; delivery failures are retried and visible.
- SPEC §3 (`docs/specs/phase-1/SPEC.md:86`, `:101`): `staff ⇒ notifications` event `ShiftNotClockedIn`. The emitter
  reads `AlertRulesPort` and puts recipients and channels in the event.
- SPEC §4 `AlertRule` (`SPEC.md:181`). SPEC §7 (attendance, grace 10 minutes). SPEC §12 (`SPEC.md:497`): every alert
  can be switched off alone and all at once.
- ADR-0010 (`docs/adr/0010-phase-1-ports-and-events.md:47`) and module-map row 174.
- ADR-0018 (notification delivery). ADR-0013 / ADR-0019 (WhatsApp: tenant outbound stays closed, `CLAUDE.md` §5).
  Spec 011 (live email disabled).
- ADR-0024 (schedule storage). ADR-0028 (attendance serialization). ADR-0032 (tenant discovery for jobs).
- The two closest jobs: spec 029 (missed-out, PR 24) and spec 033 (document expiry, PR 15).

## Owner questions

Each question is **PENDING**. Options are listed with the recommended one first. Examples use a salon where Mona's
shift starts at 10:00.

### Already decided — not asked again

- **Delay.** 20 minutes after the scheduled shift start (D-47). PR 62 will make the delay editable per alert kind.
  Until then it is fixed at 20 minutes. This is separate from the 10-minute lateness grace (SPEC §7, AT-Q7):
  - Mona clocking in at 10:15 is reported as late, but no alert is sent.
  - At 10:20 with no clock-in, the alert fires.
- **Can it be turned off.** Yes. It has its own on/off switch, and the master switch turns off every alert
  (D-47, SPEC §12). Both switches ship in PR 62, not here.

### NC-Q1 — Until the alert-rules screen (PR 62) ships, does anyone get this alert? — PENDING

1. **(Recommended)** Nobody yet. The system detects "Mona did not clock in by 10:20" and records it once, but sends
   nothing. Sending starts when PR 62 ships. Alerts detected before then are never sent late.
   *Why:* this is how PR 15 (document expiry) and PR 24 (missed clock-out) shipped. Recipients have one home
   (PR 62), and a "Mona is absent" message about last week is noise.
2. In-app now, to the managers named in NC-Q2, hard-wired until PR 62 replaces it with the configurable rule.
   Value reaches the salon earlier, but this alert alone would hold a second, temporary recipient rule.
3. Hold PR 28 and deliver it together with PR 62.

### NC-Q2 — Which managers receive it (once recipients exist)? — PENDING

1. **(Recommended)** The managers of the shift's branch: owner, general manager, business manager and branch
   manager. These are the same default holders as `decide:leave:branch` (spec 025 DL-Q4) and as the people who
   resolve attendance exceptions (spec 034 RE-Q3).
   *Why:* one consistent definition of "the manager". In the pilot salon the owner is the manager anyway.
2. Only the branch manager(s) of that branch. The owner and general manager are not disturbed for every late
   arrival.
3. Option 1, plus the employee herself as a reminder (see NC-Q3).

### NC-Q3 — Is the employee herself also told ("you have not clocked in")? — PENDING

1. **(Recommended)** No. Only managers, as D-47 says.
   *Why:* staff have no in-app inbox on the phone yet, and WhatsApp to staff is closed (ADR-0013/0019).
2. Yes, in-app, once the staff app has notifications.
3. Yes, by WhatsApp, once tenant WhatsApp sending is opened.

### NC-Q4 — Which channel by default? — PENDING

1. **(Recommended)** In-app (the admin bell) by default. WhatsApp and email can be chosen in PR 62 once each is
   switched on.
   *Why:* in-app is the only live channel today. Tenant WhatsApp is closed (`CLAUDE.md` §5) and email is disabled
   (spec 011).
2. WhatsApp by default, as soon as it is opened.
3. All three channels by default.

### NC-Q5 — Once per shift, or repeated? — PENDING

1. **(Recommended)** Once per shift. If Mona never comes, the manager gets one message at 10:20.
   *Why:* the manager already knows. Repeats train people to ignore alerts. The attendance board (PR 27) shows who
   is still absent.
2. Once at +20 minutes, plus one reminder at +60 minutes if she still has not clocked in.
3. Every 20 minutes until she clocks in or the shift ends.

### NC-Q6 — Leave — PENDING

Approved full-day leave for Mona suppresses the alert under every option. The question is what partial and pending
leave do.

1. **(Recommended)**
   - Approved leave covering the shift start moves the alert to leave end + 20 minutes. Example: approved leave
     10:00–12:00 with a 10:00 shift → alert at 12:20 if she has not clocked in.
   - **Pending** (not yet approved) leave does not suppress the alert.
   *Why:* only approved leave excuses her. Partial leave still expects her afterwards.
2. Any approved leave on that day suppresses every alert for the day.
3. Pending leave also suppresses the alert.

### NC-Q7 — What counts as "clocked in for this shift"? — PENDING

1. **(Recommended)** Any clock-in at any branch, from **2 hours** before the shift start (the number is the owner's
   to set) up to the alert moment. Clocking out again afterwards does not matter. Examples:
   - Mona clocks in at 08:30 for a 10:00 shift → no alert.
   - On a split day she works 09:00–13:00, clocks out, and must clock in again for her 17:00 shift.
   *Why:* clocking in early still counts, and each shift of a split day is checked on its own.
2. Only an attendance session still open at the alert moment. If she clocked in at 09:55 and accidentally clocked
   out at 09:58, she is alerted.
3. Any clock-in on that working date. The second shift of a split day is then never alerted.

### NC-Q8 — She clocked in, but at a different branch from the one her shift is at — PENDING

1. **(Recommended)** It counts as clocked in, so no alert.
   *Why:* she is at work. Being at the wrong branch is a schedule question that the board shows, not an absence.
2. It does not count. The manager of the scheduled branch gets the alert, noting "clocked in at branch X".

### NC-Q9 — The shift changes or is cancelled — PENDING

1. **(Recommended)** Use the schedule as it stands at the alert moment:
   - A shift deleted or moved before 10:20 sends nothing for 10:00.
   - A message already sent is never followed by a "cancelled" message.
   - Re-saving the week without changing Mona's 10:00 start does not send a second alert.
   *Why:* simple and predictable. The message reports a fact at that moment.
2. As option 1, plus a follow-up "shift was cancelled" message when a shift is removed after its alert.

### NC-Q10 — Late detection (the job was down, or the shift was entered after its start) — PENDING

1. **(Recommended)** Send late, as long as the shift has not ended. Skip it once the shift is over.
   - Example: the system was down 10:00–11:00. At 11:00 the alert for Mona's 10:00–18:00 shift still goes out.
   - A shift entered today for yesterday is never alerted.
   *Why:* the manager can still act during the shift. Afterwards the attendance report covers it.
2. Always send, however late.
3. Skip it if it is more than 10 minutes past the alert moment.

### NC-Q11 — Night alerts / quiet hours — PENDING

1. **(Recommended)** No quiet hours in Phase 1. A 22:00 overnight shift alerts at 22:20.
   *Why:* in-app is silent, and the manager opted in.
   Revisit when WhatsApp is enabled, because it buzzes a phone.
2. Hold WhatsApp and email between 22:00 and 08:00 (branch time). In-app is still stored.
3. No alerts at all for shifts starting between 22:00 and 06:00.

### NC-Q12 — An employee who is deleted, or whose contract has ended, but still has future shifts — PENDING

1. **(Recommended)** No alert.
   *Why:* she no longer works there. Schedules already refuse new shifts for such employees (spec 020).
2. Alert anyway. The leftover shift is the manager's to clean up.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The manager learns an employee has not arrived (Priority: P1)

Mona's shift at the main branch starts at 10:00. By 10:20 she has not clocked in by phone or by card, and she has no
approved leave. The system records once that she did not clock in for that shift. Who is told, and how, follows
NC-Q1 to NC-Q4.

**Why this priority**: This is the use case. D-47 names this alert explicitly.

**Independent Test**: Schedule a shift, advance the injected clock past start + 20 minutes with no clock-in, and run
the job. One "not clocked in" record and one `ShiftNotClockedIn` event exist. Run the job again: nothing new.

**Acceptance Scenarios**:

1. **Given** a 10:00 shift and no clock-in, **When** the job runs at 10:20 or later (before the shift ends),
   **Then** exactly one alert record and one event exist for that shift.
2. **Given** the same, **When** the job runs at 10:19, **Then** nothing is recorded.
3. **Given** an alert was recorded, **When** the job runs again, restarts or runs on two workers, **Then** no second
   record or event exists for that shift.

---

### User Story 2 - No alert when she is at work or excused (Priority: P1)

Sara clocked in at 09:50 for her 10:00 shift. Heba has approved leave all day. Neither manager is disturbed.

**Why this priority**: A false alert trains managers to ignore real ones (same reasoning as spec 034 RE-Q4).

**Independent Test**: For each excusing case, run the job after the alert moment: no record and no event.

**Acceptance Scenarios**:

1. **Given** a clock-in that counts under NC-Q7 (and NC-Q8 for another branch), **Then** no alert.
2. **Given** approved full-day leave covering the shift, **Then** no alert. Partial and pending leave follow NC-Q6.
3. **Given** the shift was deleted or moved before the alert moment, **Then** no alert for the old time (NC-Q9).
4. **Given** the employee is deleted or her contract has ended, **Then** behaviour follows NC-Q12.

---

### User Story 3 - Split shifts and overnight shifts (Priority: P2)

Nour works 09:00–13:00 and 17:00–21:00 on the same day. Rana works an overnight shift starting at 22:00. Each shift
is checked on its own, at its own start time in the branch's timezone.

**Why this priority**: Salons split days. Overnight shifts are supported by working date (D-32).

**Independent Test**: Two shifts on one day: clocking in for the first shift only → one alert for the second (under
the NC-Q7 recommendation). An overnight shift alerts at 22:20 local time.

**Acceptance Scenarios**:

1. **Given** two shifts on one day and a clock-in only for the first, **Then** the second shift alerts per NC-Q7.
2. **Given** a 22:00 shift in a business whose timezone differs from UTC, **Then** the alert moment is 22:20 in the
   branch timezone, not UTC.

---

### Edge Cases

- A clock-in at exactly the alert moment (10:20:00) counts as clocked in, so no alert.
- A shift whose alert moment came while the system was down is handled per NC-Q10.
- A week re-saved with the same 10:00 shift after the alert was recorded gives no second alert (NC-Q9). Saving
  replaces the shift's internal record, so the "once" key is the employee and the start instant, not the record.
- A shift moved from 10:00 to 11:00 after the 10:00 alert was sent gives one more alert at 11:20 if she is still
  absent: it is a different start.
- Two employees with shifts starting at the same moment get one alert each.
- Another company's shifts, sessions and leave are never read (RLS).
- An employee who clocks in at 10:25, after the alert: the alert stands. No retraction is sent (NC-Q9).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST detect, for every scheduled shift, that the employee has not clocked in by the shift
  start + 20 minutes (D-47) in the branch's timezone.
- **FR-002**: The system MUST record the detection **once per employee per shift start instant**, whatever re-runs,
  restarts, concurrent workers or schedule re-saves happen.
- **FR-003**: A clock-in that counts under NC-Q7 / NC-Q8, made at or before the alert moment, MUST prevent the alert.
- **FR-004**: Approved leave MUST prevent or move the alert as NC-Q6 decides. Pending leave is handled per NC-Q6.
- **FR-005**: Detection MUST use the schedule as it stands when the job runs (NC-Q9). It MUST respect the
  late-detection rule (NC-Q10) and the deleted / ended-contract rule (NC-Q12).
- **FR-006**: The system MUST publish one `ShiftNotClockedIn` event per detection. Its recipients and channels follow
  NC-Q1–NC-Q4. Until alert rules exist (PR 62), the event carries **no recipients** and notifications acknowledge
  it unsent [NEEDS CLARIFICATION: NC-Q1].
- **FR-007**: The detection MUST never change attendance, lateness, hours, salary or commission (SPEC §7, D-32, A7).
- **FR-008**: Each detection MUST leave an audit entry with the system as actor.
- **FR-009**: The alert MUST be switchable off on its own and by the master switch once PR 62 ships (D-47, SPEC §12).
  This slice MUST leave a single place where PR 62 plugs in the switch, the delay and the recipients.

### Key Entities

- **Scheduled shift**: an employee's planned start and end at a branch, with its working date (existing, spec 020).
- **Attendance session**: a clock-in (and maybe a clock-out) at a branch (existing, spec 027).
- **Leave request**: an approved, pending, rejected or cancelled absence, full-day or partial (existing, specs 023 /
  025).
- **Not-clocked-in notice** (new): the once-only record that employee X was not clocked in for the shift starting at
  instant T. It holds the branch, the business, the scheduled start and end, and the detection time.

## Slice design *(mandatory — `CLAUDE.md` §1)*

**This is a worker job slice.** It adds pure domain rules, one worker use case, one table, one event and one
processor, plus PR 15's pattern for recipients. It adds no HTTP endpoint and no screen.

### Business rules

- **BR-001**: alert moment = `starts_at + 20 min`. The arithmetic is on the UTC instant. `starts_at` is already the
  resolved UTC instant of the branch-local start (ADR-0024), so overnight shifts and DST need no reinterpretation.
  The boundary is inclusive: a clock-in at exactly the alert moment counts (spec 029 convention).
- **BR-002**: a shift is *due* when `alert_moment ≤ now` and it is not stale per NC-Q10 (recommended: `now < ends_at`).
- **BR-003**: "clocked in" = an `attendance_sessions` row of the employee whose `clock_in` falls in
  `[starts_at − W, alert_moment]`. W is the NC-Q7 window. The row may be at any branch per NC-Q8.
- **BR-004**: approved leave whose `[starts_at, ends_at)` contains the shift start suppresses the alert. If it ends
  before the shift ends, the alert moment moves to `leave.ends_at + 20 min` (NC-Q6 recommendation). Pending leave is
  ignored.
- **BR-005**: the once-only key is `(company_id, employee_id, shift_starts_at)`, not the shift row id. ADR-0024
  replaces shift rows when a week is re-saved, so a row id would re-alert after every save.
- Pure functions live in `apps/worker/src/modules/staff/domain/not-clocked-in.ts`, with Arabic JSDoc:
  `alertMoment(startsAt, delayMinutes)`, `effectiveAlertMoment(shift, approvedLeaves, delay)`,
  `isClockedInForShift(shift, clockIns, windowMinutes, alertMoment)`, `notClockedInDecision(...) →
  'ALERT' | 'WAIT' | 'EXCUSED' | 'STALE' | 'CLOCKED_IN'`.
  - The delay (20) and the window (W) are parameters, so PR 62 can feed them from `AlertRulesPort`.

### Tenant discovery (needs an ADR — orchestrator decision, not an owner question)

A worker job has no session, and `pospay_app` cannot read across tenants (ADR-0003 §3). The ADR-0032 pattern
registers a per-company schedule when an outbox event is delivered. The existing hooks do not fit this job:

- `AttendanceClockedIn` misses the case that matters most: a company whose employees have shifts but nobody has
  clocked in yet, such as the pilot's first morning.
- Schedule writes emit no outbox event (ADR-0024: "No new module arrow or outbox event").

Options:

- **(a) Recommended:** register `attendance-not-clocked-in-<companyId>` (every 5 minutes, data `{ companyId }`) when
  the worker staff module delivers **`CompanyCreated`**. It already consumes this event to seed document types
  (ADR-0031, `apps/worker/src/modules/staff/events/handlers/on-company-created.handler.ts`).
  - No new event or arrow.
  - Existing companies get a one-time controlled replay, as decided for PR 15 (spec 033 MO-Q4, 2026-10-05).
- (b) Add a `ScheduleChanged` event to the schedule writes (PR 16 code). That needs a module-map row and an ADR, and
  touches the API staff module outside this slice.
- (c) Also register on `AttendanceClockedIn`. Simpler, but it misses the first day.

### Schema changes

| Table | Columns added / changed | RLS policy | Indexes | Tenant-qualified FKs |
|---|---|---|---|---|
| `attendance_not_clocked_in_notices` (new) | PK `(company_id, id)`, `business_id`, `branch_id`, `employee_id`, `shift_starts_at`, `shift_ends_at`, `alert_due_at`, `notified_at`, `recipients_attached_at` (NULL; reserved for PR 62 if NC-Q1 changes) | FORCE RLS `company_id = app.company_id`; `pospay_app` SELECT + INSERT only (no UPDATE/DELETE) | UNIQUE `(company_id, employee_id, shift_starts_at)` (the dedupe key) | `(company_id, business_id, employee_id)` → `employees`; `(company_id, business_id, branch_id)` → `branches`. **No FK to the shift row**, because shift rows are replaced on re-save (BR-005). |
| `staff_schedule_shifts` (existing) | none | unchanged | new `(company_id, starts_at)` created concurrently, for the company-wide due-shift page (today only per-employee and per-schedule indexes exist) | — |

An `attendance_exceptions` row cannot be reused, because its `session_id` is NOT NULL and a not-clocked-in has no
session.

### API contract

- No endpoint: this slice adds no route, no Zod request schema and no `Idempotency-Key`.
- Job data contract in `packages/contracts`: `attendanceNotClockedInJob = { companyId }` (id-only, like
  `attendanceMissedOutJob`).

### Permissions

- None new. The job runs as `pospay_app` inside `withTenant(companyId)`. Recipients (NC-Q2) are resolved by PR 62.

### Events

- **Published**: `ShiftNotClockedIn` — emitted once per (employee, shift start) when the alert moment passes with no
  counting clock-in, in the same transaction as the notice row and the audit row.
  - Payload: `notice_id, employee_id, business_id, branch_id, shift_starts_at, shift_ends_at, alert_due_at,
    detected_at`. It carries no employee name, no phone, and no `notification_recipients` (NC-Q1 recommendation).
  - Declared in `apps/worker/src/modules/staff/events/published.ts` with an Arabic one-liner. A `TODO(spec) NC-Q1`
    sits there, like MO-Q1 / MO-Q5 for the other two events.
- **Consumed**: `CompanyCreated` (existing, from `identity`), to register the company's schedule (design option (a)).
- notifications already lists `ShiftNotClockedIn` in `NOTIFICATION_SOURCE_EVENTS`
  (`apps/worker/src/modules/notifications/events/handlers/on-notification-request.handler.ts:31`). With no recipients
  it is acknowledged unsent. No notifications change is needed.
- Audit: `attendance_notice` / `not_clocked_in.detected`, actor NULL (system).

### Lock and once-only protocol

- The due-shift page is read without locks and only pre-filters candidates.
- Per candidate, one `withTenant` transaction:
  1. Lock the employee's `attendance_states` row, the same first lock as scans and the missed-out job (ADR-0028/0032).
  2. Sample the injected Clock once.
  3. Re-read the shift (still scheduled at that instant), the counting clock-ins and the approved leave.
  4. Decide with the domain.
  5. `INSERT … ON CONFLICT (company_id, employee_id, shift_starts_at) DO NOTHING RETURNING id`.
  6. Write audit and outbox only if a row was inserted.
- A scan that holds the lock first wins, so a 10:20:00 clock-in racing the job never produces an alert.

### Worker module `apps/worker/src/modules/staff` (files this slice adds or edits)

- `domain/not-clocked-in.ts` and `domain/__tests__/not-clocked-in.spec.ts`
- `ports/not-clocked-in.port.ts` — `NotClockedInTransactions` (due page, per-candidate locked decision)
- `persistence/not-clocked-in.transactions.ts`
- `use-cases/detect-not-clocked-in/`
- `jobs/not-clocked-in.processor.ts` (+ `.spec.ts`)
- `events/published.ts` (add `ShiftNotClockedIn`), `events/handlers/on-company-created.handler.ts` (register)
- `staff.module.ts`, `index.ts`
- `__tests__/not-clocked-in-job.spec.ts`, `-race.spec.ts`, `-rls.spec.ts`, `.fixture.ts`

### Test plan

- **Domain unit**:
  - Alert moment boundaries: 10:19:59 wait, 10:20:00 alert, a clock-in at 10:20:00 counts.
  - The NC-Q7 window edges.
  - Partial and full leave, and pending leave ignored.
  - Stale after `ends_at`.
  - Overnight shift, and a DST fall / spring zone.
  - Split shifts.
  - Deleted or ended-contract employee.
- **Integration scenarios**:

  | ID | Scenario |
  |---|---|
  | `NCI-01` | One notice and one event; re-run gives none |
  | `NCI-02` | Two concurrent workers produce one notice |
  | `NCI-03` | A scan racing the job (both lock orders): the clock-in wins |
  | `NCI-04` | Approved leave suppresses the alert |
  | `NCI-05` | Partial leave moves the alert moment |
  | `NCI-06` | Re-saved week, same start: no second alert |
  | `NCI-07` | Moved shift alerts at its new start |
  | `NCI-08` | Clock-in at another branch (NC-Q8) |
  | `NCI-09` | Stale shift skipped |
  | `NCI-10` | `CompanyCreated` registers one id-only schedule; redelivery is idempotent; a Redis failure is retryable |
  | `NCI-11` | The event with no recipients is acknowledged unsent by notifications |

- **RLS negative**: cross-tenant read of the notices table returns 0 rows; a cross-tenant insert is rejected; FKs
  across tenants are rejected; UPDATE and DELETE are refused to `pospay_app` (the grants allowlist in
  `packages/db/src/__tests__/privileges.spec.ts`).
- **Queries / EXPLAIN**: the due-shift page uses the new `(company_id, starts_at)` index. The clock-in probe uses
  `attendance_sessions_employee_date_idx` or the open index. The leave probe uses
  `leave_requests_company_employee_period_idx`.

### Documents to update in the same PR

- `docs/module-map.md:174`: add "(no recipients until alert rules ship)", as row 173 has. Add the `CompanyCreated`
  registration to the `CompanyCreated` row.
- A new ADR (next free number after 0036, renumbered at merge): tenant discovery via `CompanyCreated`, the once-only
  key, and the lock order.
- `docs/specs/phase-1/IMPLEMENTATION-PLAN.md` row 62: PR 62 must add the switch, delay and recipients to this job's
  emission point.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For every scheduled shift with no counting clock-in, exactly one notice exists after its alert moment.
  Never two, whatever the re-runs, restarts or concurrent workers.
- **SC-002**: Zero alerts for employees who clocked in by the alert moment, or who were on approved full-day leave,
  across the integration fixtures.
- **SC-003**: Detection happens within 5 minutes of the alert moment while the system is up (job cadence).
- **SC-004**: No change to attendance, lateness, hours, salary or commission figures (before/after comparison
  equal).

## Assumptions

- The 20-minute delay is D-47's default. PR 62 makes it editable and adds the switches.
- Job cadence is every 5 minutes, with keyset pages of 100 candidates, as PR 24 (spec 029 MO-Q1/MO-Q2). This is a
  technical default.
- The wording of the eventual message (employee name, branch, shift time) belongs to PR 62's templates. Names are
  read when the message is composed, never put in the event.
- `.specify/extensions.yml` does not exist, so no before/after hooks ran.
