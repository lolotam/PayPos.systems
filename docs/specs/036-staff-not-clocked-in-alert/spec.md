# Feature Specification: Not-clocked-in alert

**Feature Branch**: `feat/p1-28-not-clocked-in-alert`

**Created**: 2026-10-08

**Status**: Ready for planning — owner questions NC-Q1…NC-Q12 decided by Waleed on 2026-10-08
([owner-questions.ar.md](owner-questions.ar.md)).

**Input**: User description: "staff-not-clocked-in-alert — Phase 1 PR 28."

**Phase 1 row**: PR 28 (`docs/specs/phase-1/IMPLEMENTATION-PLAN.md:68`), depends on PR 22 (clock attendance, spec 027),
PR 15 (document-expiry job, spec 033) and PR 4b (in-app inbox, spec 004) — all merged. The owner's NC-Q1 answer
split the work: **28** (this spec) = manager in-app alert now; **28b** = staff web push (also carries the employee's
own "you have not clocked in" notice); **28c** = "your shift ends soon" reminder; **62** = on/off switches and
recipients from the dashboard, replacing 28's interim rule.

**Sources**: PRD D-47 (`docs/PRD.md:993`) — "Not-clocked-in alert: manager, 20 min after shift start", every alert
kind with on/off, recipients, channels and delay, plus a master switch; PRD P1-T7.3 (`docs/PRD.md:614`) — operational
alerts are worker jobs, delivery failures retried and visible; SPEC §3 (`docs/specs/phase-1/SPEC.md:86`, `:101`) —
`staff ⇒ notifications` event `ShiftNotClockedIn`, the emitter puts recipients and channels in the event; SPEC §4
`AlertRule` (`SPEC.md:181`); SPEC §7 (attendance, grace 10 minutes); SPEC §12 (`SPEC.md:497`); ADR-0010
(`docs/adr/0010-phase-1-ports-and-events.md:47`); module-map row 174; spec 004 (in-app inbox and admin bell);
ADR-0018 (delivery); ADR-0013/0019 (WhatsApp tenant outbound closed, `CLAUDE.md` §5); spec 011 (email disabled);
ADR-0024 (schedules); ADR-0028 (attendance serialization); ADR-0032 and specs 029/033 (the two closest jobs);
**ADR-0037 (this slice's draft)**.

## Owner questions — all decided (Waleed, 2026-10-08)

Already decided earlier and not re-asked: the delay is **20 minutes** after the scheduled shift start and the
recipient is **the manager** (D-47); every alert can be switched off alone and all at once (D-47, SPEC §12) — the
switches ship in PR 62. The 20-minute alert is separate from the 10-minute lateness grace (SPEC §7, AT-Q7): Mona
clocking in at 10:15 for a 10:00 shift is reported late but not alerted.

- **NC-Q1 — Who gets it before PR 62.** The managers get it **now**, as an in-app notification in the admin app
  (bell). Row 28 uses a fixed interim rule (always on, 20 minutes, the NC-Q2 managers, in-app only) that PR 62
  replaces with the dashboard settings. Staff mobile notifications become row 28b; a new "your shift ends soon"
  reminder becomes row 28c (default 30 minutes before shift end, editable from the dashboard through PR 62). No email.
- **NC-Q2 — Which managers.** Owner, general manager, business manager and branch manager **of the shift's branch**
  (the same default holders as `decide:leave:branch`, spec 025 DL-Q4).
- **NC-Q3 — The employee herself.** Not in row 28. She **will** get "you have not clocked in" by push once row 28b
  ships (owner follow-up answer 7).
- **NC-Q4 — Channels.** Managers: in-app from row 28. Staff: push from row 28b. Email: off. WhatsApp: not used.
- **NC-Q5 — Frequency.** Once per shift (one message at 10:20 for a 10:00 shift).
- **NC-Q6 — Leave.** Approved full-day leave: no alert. Approved partial leave covering the shift start moves the
  alert to the leave end + 20 minutes (leave 10:00–12:00 → 12:20). Pending leave does not excuse.
- **NC-Q7 — What counts as clocked in.** Any clock-in from **2 hours before** the shift start up to the alert moment,
  even if she clocked out again; each shift of a split day is checked on its own.
- **NC-Q8 — Another branch.** A clock-in at any branch counts — no alert.
- **NC-Q9 — Edited or deleted shift.** The schedule as it stands at the alert moment decides; no "cancelled"
  follow-up; re-saving the week with the same start does not alert again.
- **NC-Q10 — Late detection.** Send late while the shift has not ended; skip it once the shift is over.
- **NC-Q11 — Night shifts.** No quiet hours in Phase 1 (revisit when WhatsApp or push channels become selectable).
- **NC-Q12 — Deleted employee or ended contract.** No alert.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The manager learns an employee has not arrived (Priority: P1)

Mona's shift at the main branch starts at 10:00. By 10:20 she has not clocked in — by phone or by card — and has no
approved leave. The owner, the general manager, the business manager and the main branch's manager each see one new
message in the admin bell: "Mona has not clocked in for her 10:00 shift at Main branch".

**Why this priority**: This is the use case; D-47 names it and the owner wants it live now (NC-Q1).

**Independent Test**: Schedule a shift, advance the injected clock past start + 20 minutes with no clock-in, run the
job: one notice, one `ShiftNotClockedIn` event, one unread in-app message per manager. Run the job again: nothing new.

**Acceptance Scenarios**:

1. **Given** a 10:00 shift and no clock-in, **When** the job runs at 10:20 or later before the shift ends, **Then**
   exactly one notice and one event exist, and each of the four kinds of manager covering that branch has exactly one
   unread in-app message.
2. **Given** the same, **When** the job runs at 10:19, **Then** nothing is recorded or sent.
3. **Given** a notice exists, **When** the job re-runs, restarts or runs on two workers, **Then** no second notice,
   event or message exists.
4. **Given** a branch manager of **another** branch and a cashier of this branch, **Then** neither receives it.
5. **Given** an email or WhatsApp configuration is present, **Then** nothing is sent by email or WhatsApp.

---

### User Story 2 - No alert when she is at work or excused (Priority: P1)

Sara clocked in at 08:30 for her 10:00 shift; Heba has approved leave all day; Nour's shift was deleted at 09:00;
Rana was deleted from the staff list last week. No manager is disturbed.

**Why this priority**: A false alert trains managers to ignore real ones (spec 034 RE-Q4 reasoning).

**Independent Test**: For each excusing case, run the job after the alert moment: no notice, event or message.

**Acceptance Scenarios**:

1. **Given** a clock-in at or after 08:00 (start − 2 h) and at or before 10:20, at any branch, even followed by a
   clock-out, **Then** no alert (NC-Q7, NC-Q8).
2. **Given** a clock-in at 07:59, and none later, **Then** the alert fires at 10:20.
3. **Given** approved full-day leave covering the shift, **Then** no alert. **Given** pending leave, **Then** the
   alert fires (NC-Q6).
4. **Given** approved leave 10:00–12:00 and a 10:00–18:00 shift, **Then** no alert at 10:20; the alert fires at 12:20
   if no clock-in counts by then (the counting window still starts at 08:00).
5. **Given** the shift was deleted or moved before the alert moment, **Then** no alert for the old start (NC-Q9).
6. **Given** a deleted employee or one whose contract ended before the shift date, **Then** no alert (NC-Q12).

---

### User Story 3 - Split, overnight and late-detected shifts (Priority: P2)

Nour works 09:00–13:00 and 17:00–21:00; Rana starts at 22:00. The system was down 10:00–11:00 one morning.

**Why this priority**: Salons split days; overnight shifts exist (D-32); outages happen.

**Independent Test**: The clock and the schedule fixtures below, run through the job.

**Acceptance Scenarios**:

1. **Given** Nour clocked in at 08:55 and out at 13:00 and nothing after, **Then** the 17:00 shift alerts at 17:20
   (its window starts at 15:00).
2. **Given** a 22:00 shift in the branch timezone, **Then** the alert moment is 22:20 local time; no quiet hours
   (NC-Q11).
3. **Given** the job was down until 11:00, **Then** the alert for a 10:00–18:00 shift goes out at 11:00; a shift that
   ended before the job ran is skipped (NC-Q10).

---

### Edge Cases

- A clock-in at exactly the alert moment (10:20:00) counts; at exactly start − 2 h (08:00:00) counts.
- A shift whose alert moment is at or after its end (e.g. partial leave lasting until the shift end) never alerts.
- A week re-saved with the same 10:00 shift after the notice: no second alert — the once-only key is the employee and
  the start instant, not the shift record (NC-Q9, BR-005).
- A shift moved from 10:00 to 11:00 after the 10:00 notice: the 11:00 start is a different shift; it alerts at 11:20
  if she is still absent.
- A clock-in at 10:25, after the notice: the notice stands; no retraction (NC-Q9).
- A branch with no manager of the four kinds covering it: the notice and event are still recorded; nobody receives
  a message (the event carries no recipients and notifications acknowledges it unsent).
- A manager who is also the absent employee does not receive her own alert.
- Two employees with the same start: one notice and one set of messages each.
- Another company's shifts, sessions, leave and memberships are never read (RLS).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST detect, for every scheduled shift, that the employee has not clocked in by the shift
  start + 20 minutes (D-47), comparing instants resolved from the branch timezone.
- **FR-002**: A clock-in at any branch from 2 hours before the shift start up to the alert moment, inclusive, MUST
  prevent the alert, whether or not it was followed by a clock-out (NC-Q7, NC-Q8).
- **FR-003**: Approved full-day leave MUST prevent the alert; approved partial leave covering the shift start MUST
  move the alert moment to the leave end + 20 minutes; pending, rejected or cancelled leave MUST NOT excuse (NC-Q6).
- **FR-004**: Detection MUST use the schedule as it stands when the job decides (NC-Q9), MUST skip a shift once it
  has ended (NC-Q10), MUST skip deleted employees and employees whose contract ended before the shift date (NC-Q12),
  and MUST NOT apply quiet hours (NC-Q11).
- **FR-005**: The system MUST record the detection once per employee per shift start instant, whatever re-runs,
  restarts, concurrent workers or schedule re-saves happen (NC-Q5).
- **FR-006**: Each detection MUST publish one `ShiftNotClockedIn` event carrying one IN_APP recipient per manager of
  the shift's branch — owner, general manager, business manager, branch manager whose membership is active and
  covers that branch, excluding the absent employee's own user (NC-Q1, NC-Q2). No email, no WhatsApp, no employee
  recipient in this row (NC-Q3, NC-Q4).
- **FR-007**: Each manager MUST see the message once in the admin bell, in a dedicated "not clocked in" message
  showing the employee's name, the branch and the local shift start.
- **FR-008**: The detection MUST never change attendance, lateness, hours, salary or commission (SPEC §7, D-32, A7).
- **FR-009**: Each detection MUST leave an audit entry with the system as actor.
- **FR-010**: The interim rule (always on, 20 minutes, these managers, in-app) MUST live in one place that PR 62
  replaces with the dashboard settings (D-47, SPEC §12).

### Key Entities

- **Scheduled shift** (existing, spec 020): an employee's planned start and end at a branch, with its working date.
- **Attendance session** (existing, spec 027): a clock-in, maybe a clock-out, at a branch.
- **Leave request** (existing, specs 023/025): approved, pending, rejected or cancelled; full-day or partial.
- **Membership** (existing, identity): a user's role in the company with its scope (company, business, branch).
- **Not-clocked-in notice** (new): the once-only record that employee X had not clocked in for the shift starting at
  instant T — branch, business, scheduled start and end, alert moment, detection time.
- **In-app notification** (existing, spec 004): one per manager per notice.

## Slice design *(mandatory — `CLAUDE.md` §1)*

A worker job slice: pure domain rules, one worker use case, one table, one event with in-app recipients, one
processor, a new in-app template, and a minimal worker identity read. **No HTTP endpoint and no new screen**
(the existing admin bell renders the new template). Technical decisions are drafted in
**`docs/adr/0037-not-clocked-in-alert-discovery-and-recipients.md`** (number provisional, renumbered at merge).

### Business rules

- **BR-001**: alert moment = `starts_at + 20 min`; counting window = `[starts_at − 2 h, alert moment]`, both ends
  inclusive. `starts_at`/`ends_at` are the resolved UTC instants stored by ADR-0024, so overnight shifts and DST
  need no reinterpretation; durations are elapsed time.
- **BR-002**: approved leave whose `[starts_at, ends_at)` contains the shift start: if it reaches or passes the shift
  end → `EXCUSED`; otherwise the alert moment becomes `leave.ends_at + 20 min` (window start unchanged). Several
  contiguous approved leaves are applied in order. Only `status = 'APPROVED'` counts.
- **BR-003**: decision order → `STALE` when `now ≥ ends_at` or the (moved) alert moment `≥ ends_at`;
  `INELIGIBLE` for a deleted employee or `contract_end` before the shift's working date; `EXCUSED` by full leave;
  `CLOCKED_IN` when any session's `clock_in` lies in the window (any branch); `WAIT` when `now <` alert moment;
  otherwise `ALERT`.
- **BR-004**: recipients = user ids with an active membership whose role is one of `owner`, `general_manager`,
  `business_manager`, `branch_manager` and whose scope is the company, the shift's business, or the shift's branch;
  minus the employee's own `user_id`; deduplicated; resolved at detection time. Zero recipients → the event is still
  emitted, without `notification_recipients`.
- **BR-005**: the once-only key is `(company_id, employee_id, shift_starts_at)`, not the shift row id — ADR-0024
  replaces shift rows on re-save.
- **BR-006 (interim rule, replaced by PR 62)**: enabled = true, delay = 20 minutes, channel = IN_APP, recipients =
  BR-004. Implemented as one function, `interimNotClockedInRule()`, read where PR 62 will read `AlertRulesPort`.
- Pure functions in `apps/worker/src/modules/staff/domain/not-clocked-in.ts`, Arabic JSDoc: `alertMoment`,
  `countingWindow`, `applyApprovedLeave`, `notClockedInDecision` → `'ALERT' | 'WAIT' | 'EXCUSED' | 'CLOCKED_IN' |
  'STALE' | 'INELIGIBLE'`. Delay and window are parameters.

### Tenant discovery (ADR-0037 §1)

On delivery of `CompanyCreated` (already consumed by worker `staff`, ADR-0031) the handler also upserts the job
scheduler `attendance-not-clocked-in-<companyId>`, every 5 minutes, data `{ companyId }`, outside every transaction;
a Redis failure is retryable. Existing companies: one controlled operator replay of `CompanyCreated` before go-live
(spec 033 MO-Q4 precedent). Cadence 5 minutes and keyset pages of 100 follow spec 029 MO-Q1/MO-Q2.

### Schema changes

| Table | Columns added / changed | RLS policy | Indexes | Tenant-qualified FKs |
|---|---|---|---|---|
| `attendance_not_clocked_in_notices` (new) | PK `(company_id, id)`, `business_id`, `branch_id`, `employee_id`, `shift_starts_at`, `shift_ends_at`, `alert_due_at`, `notified_at`, `recipient_count int` | FORCE RLS `company_id = app.company_id`; `pospay_app` SELECT + INSERT only | UNIQUE `(company_id, employee_id, shift_starts_at)`; `(company_id, business_id, branch_id)`; `(company_id, branch_id)` | `(company_id, business_id, employee_id)` → `employees`; `(company_id, business_id, branch_id)` → `branches`; **no FK to the shift row** (BR-005) |
| `staff_schedule_shifts` (existing) | none | unchanged | new `(company_id, starts_at)`, `CONCURRENTLY` (ADR-0033 recoverable) — the company-wide due-shift page | — |

`attendance_exceptions` is not reused: its `session_id` is NOT NULL and a not-clocked-in has no session.
`recipients_attached_at` from the earlier draft is dropped: recipients are attached at emission now (NC-Q1).

### API contract

- No endpoint, request schema or `Idempotency-Key`.
- `packages/contracts`: job data `attendanceNotClockedInJob = { companyId }`; the in-app recipient and
  `InAppNotification` schemas accept `template_key: 'shift_not_clocked_in'` (revision 1) beside `generic_notice`,
  with its own strict parameter tuple (`employee_name`, `branch_name`, `shift_start` as `HH:MM`) passing the
  existing safe-text checks. The regenerated admin/pos API types follow.
- `packages/notifications`: template `shift_not_clocked_in` rev 1, ar/en copy; `validInAppTemplate` accepts it.
- `apps/admin/src/notifications/ui/notification-item.tsx`: render the new key through `packages/i18n` keys.

### Permissions

None new. The job runs as `pospay_app` inside `withTenant(companyId)`; recipients come from memberships (BR-004),
not from a permission check — the role list is the owner's NC-Q2 decision, and PR 62 makes it editable.

### Events

- **Published**: `ShiftNotClockedIn` — emitted once per (employee, shift start) when the alert moment passes with no
  counting clock-in, in the same transaction as the notice and the audit row. Payload: `notice_id, employee_id,
  business_id, branch_id, shift_starts_at, shift_ends_at, alert_due_at, detected_at`, plus
  `notification_recipients` (IN_APP, one per BR-004 user, `locale: 'ar'`, template `shift_not_clocked_in`) when
  there is at least one. No phone, no document. Declared in `apps/worker/src/modules/staff/events/published.ts` with
  its Arabic one-liner.
- **Consumed**: `CompanyCreated` (existing) — schedule registration.
- notifications already lists `ShiftNotClockedIn`
  (`apps/worker/src/modules/notifications/events/handlers/on-notification-request.handler.ts:31`) and stores one
  in-app row per `(source_event_id, recipient, template_key)`.
- Audit: `attendance_notice` / `not_clocked_in.detected`, actor NULL (system).

### Recipients read (ADR-0037 §2)

Worker `staff` port `BranchManagerRecipients.forBranch(tx, businessId, branchId) → userId[]`; adapter in
`staff/persistence/` calls a read exported from a new minimal worker `identity` module (`apps/worker/src/modules/
identity/index.ts`), on the caller's tenant transaction. No new import arrow (`staff → identity` exists); one §3 port
row in `docs/module-map.md` and one `ports:` entry in `docs/module-map.yaml`.

### Lock and once-only protocol

The due-shift page is read without locks (pre-filter only). Per candidate, one `withTenant` transaction: lock the
employee's `attendance_states` row (the first lock of scans and the missed-out job, ADR-0028/0032) → sample the
injected Clock once → re-read the shift, counting clock-ins, approved leave and employee eligibility → decide with
the domain → on `ALERT` resolve recipients → `INSERT … ON CONFLICT (company_id, employee_id, shift_starts_at)
DO NOTHING RETURNING id` → only an inserted row writes audit and outbox. A scan holding the lock first wins.

### Files

- `apps/worker/src/modules/staff/`: `domain/not-clocked-in.ts` (+ `__tests__`), `ports/not-clocked-in.port.ts`,
  `ports/branch-manager-recipients.port.ts`, `persistence/not-clocked-in.transactions.ts`,
  `persistence/branch-manager-recipients.adapter.ts`, `use-cases/detect-not-clocked-in/`,
  `jobs/not-clocked-in.processor.ts` (+ spec), `events/published.ts`,
  `events/handlers/on-company-created.handler.ts`, `staff.module.ts`, `index.ts`, `__tests__/not-clocked-in-*.ts`.
- `apps/worker/src/modules/identity/` (new, minimal, read-only).
- `packages/db/schema/staff-attendance.ts` (or a new schema file), `packages/db/schema/staff-schedules.ts` (index),
  two migrations, `packages/db/src/__tests__/privileges.spec.ts`.
- `packages/contracts` (job data, in-app template), `packages/notifications` (template), `packages/i18n` (copy),
  `apps/admin/src/notifications/ui/notification-item.tsx`, regenerated `apps/admin|pos/src/shared/api/schema.d.ts`.
- Docs: ADR-0037, `docs/module-map.md` (row 174, `CompanyCreated` row, §3 port row) and `docs/module-map.yaml`.

### Test plan

- **Domain unit**: 10:19:59 `WAIT`, 10:20:00 `ALERT`; clock-in at 10:20:00 and at 08:00:00 count, 07:59:59 does not;
  clock-in then clock-out counts; full / partial / pending / rejected leave; partial leave to the shift end
  `STALE`; contiguous leaves; `now ≥ ends_at` `STALE`; deleted / ended contract `INELIGIBLE`; overnight shift; DST
  fall and spring zones; split shifts; the interim rule's values.
- **Integration scenarios** (PostgreSQL, one cloned database per file, as `pospay_app`):
  `NCI-01` one notice, event and one in-app message per manager; re-run none · `NCI-02` two concurrent workers → one ·
  `NCI-03` scan racing the job, both lock orders → the clock-in wins · `NCI-04` approved full leave suppresses,
  pending does not · `NCI-05` partial leave moves to 12:20 · `NCI-06` re-saved week, same start → none ·
  `NCI-07` moved shift alerts at its new start · `NCI-08` clock-in at another branch → none · `NCI-09` stale shift
  skipped, late detection while running sends · `NCI-10` recipients: owner, GM, business manager, branch manager of
  this branch yes; another branch's manager, a cashier, a removed membership, the employee herself no · `NCI-11` no
  managers → event without recipients, acknowledged unsent · `NCI-12` `CompanyCreated` registers one id-only
  schedule, redelivery idempotent, Redis failure retryable · `NCI-13` no email or WhatsApp attempt row is ever
  written · `NCI-14` deleted employee / ended contract → none.
- **RLS negative**: cross-tenant read of the notices table = 0 rows; cross-tenant insert rejected; cross-tenant FKs
  rejected; UPDATE/DELETE refused to `pospay_app` (grants allowlist).
- **Queries / EXPLAIN**: the due-shift page uses `(company_id, starts_at)`; the clock-in probe uses
  `attendance_sessions_employee_date_idx`; the leave probe `leave_requests_company_employee_period_idx`; the
  recipients read uses the memberships' company/scope indexes.
- **Admin UI**: the bell item renders `shift_not_clocked_in` in ar and en.

### Documents to update in the same PR

- `docs/module-map.md:174` (consumer note: in-app manager recipients by the interim rule, PR 62 replaces it), the
  `CompanyCreated` row (schedule registration) and the new §3 port row; `docs/module-map.yaml`.
- ADR-0037 (draft in this branch).
- `docs/specs/phase-1/IMPLEMENTATION-PLAN.md` rows 28b, 28c and the row 62 note (added in this branch).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For every scheduled shift with no counting clock-in, exactly one notice exists after its alert moment,
  never two.
- **SC-002**: Every manager covered by NC-Q2 receives exactly one in-app message per notice; nobody else receives one.
- **SC-003**: Zero alerts for employees who clocked in within the window, were on approved full-day leave, or are no
  longer employed, across the fixtures.
- **SC-004**: The message appears within 5 minutes of the alert moment while the system is up.
- **SC-005**: No change to attendance, lateness, hours, salary or commission figures.

## Assumptions

- The in-app message locale is `ar` (Arabic-first); no per-user locale is stored today. The admin renders it through
  i18n keys.
- Job cadence 5 minutes, keyset pages of 100 — technical defaults from spec 029.
- Out of this row: the employee's own push notice (28b), the "your shift ends soon" reminder (28c), the dashboard
  on/off, master switch, editable delay and recipients (62).
- `.specify/extensions.yml` does not exist, so no before/after hooks ran.
