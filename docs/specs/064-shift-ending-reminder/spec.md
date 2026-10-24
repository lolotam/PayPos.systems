# Feature Specification: Shift-ending reminder («دوامك قرب يخلص»)

**Feature Branch**: `feat/p1-28c-shift-ending-reminder`

**Created**: 2026-10-22

**Status**: Ready for planning — owner questions SE-Q1…SE-Q6 decided by Waleed on the decisions page on
2026-10-22 (final decision, the recommended option in all six, PP-34.1…PP-34.6, batch 49; Abu Salem picked the same in all six on 2026-10-23
and the decisions are final, [owner-questions.ar.md](owner-questions.ar.md)). Implementation sub-PRs do not start until row 28b
(staff web push, spec 063 / ADR-0052) is merged through 28b-3 (the web-push adapter, the worker processor and the VAPID keys).

**Input**: User description: "28c — «your shift ends soon» reminder to the employee by push, default 30 minutes before
shift end, lead time editable from the dashboard."

**Phase 1 row**: 28c (`docs/specs/phase-1/IMPLEMENTATION-PLAN.md:86`). Depends on: **28b** (the push channel — not built
here), **62** (the alert-rules storage and the `SHIFT_ENDS_SOON` kind — merged as 62-1: PR #467, then PR #510 for its permission), **28** and
**16b-3** (the staff detectors this reuses — merged). Decision record: **ADR-0053** (draft in this branch; numbers
renumbered at merge).

**Sources**: spec 036 (the owner's NC-Q1 answer created this row, its question 6 fixed the default of 30 minutes
«وتتغير من اللوحة», NC-Q8/NC-Q10/NC-Q11 are the precedents reused); spec 060 D-B13/D-B14/D-B15, FR-B17 and the kind
table (`SHIFT_ENDS_SOON`: on · 30 min before shift end · the employee · push, fixed; the rule row holds only `enabled`
and `lead_minutes`); ADR-0037 (discovery, lock protocol, recipient groups) and its 2026-10-10 addendum (several
detectors in one company job); ADR-0018 (outbox → transport); ADR-0024 (schedules); ADR-0028 (attendance
serialization); ADR-0010 addendum 2026-10-21 (worker staff `AlertRulesPort`); PRD D-47; SPEC §4 `AlertRule`, §7, §12.

## Dependency on row 28b (push channel)

This spec **does not build** a push channel, a subscription store, a service worker or a language preference. It
emits one event, `ShiftEndsSoon`, whose single recipient is the employee on the **PUSH** channel. The PUSH recipient entry (settled with the 28b session,
spec 063 / ADR-0052) holds only `user_id`, `template_key` / `revision`, the safe parameters and an optional
`send_deadline` — no phone and no locale; notifications finds the user's push subscriptions and renders the text in each
subscription's language. Everything that touches that shape (the event payload's recipient entry, the
template renderer, the end-to-end test through the push sender) is isolated in sub-PR **064-2**, written after 28b is
merged. **The detector is wired into the company job last (064-3)**, after the template, the contract and the
notifications consumer registration are on `main`, so a deployed detector never emits an event that nothing can
deliver. **Implementation of this row starts after 28b-3 is merged** (the web-push adapter, the worker processor and the VAPID
keys). No sub-PR starts earlier, 064-1 included: the ledger table is not shipped ahead of its only consumer.

## Owner questions

Already decided and **not** re-asked: the reminder exists, goes to the employee by push, defaults to 30 minutes before
the shift end and the lead is editable from the alerts screen (spec 036 NC-Q1 and question 6; spec 060 kind table);
no email (NC-Q1); the kind has its own on/off and obeys the business master switch (spec 060 D-B13, AL-Q4); a rule
change applies to reminders after it, with no back-filling (D-B15); no quiet hours (NC-Q11 precedent).

Asked in [owner-questions.ar.md](owner-questions.ar.md) and decided by Waleed (the recommended option in all six):

- **SE-Q1 — Who is «in the shift».** Decided: only an employee whose clock-in is open at the reminder moment; one
  who left early gets nothing; one on a break gets it when she is back, if the shift has not ended.
- **SE-Q2 — The moment passed while the shift is still running** (the system was down, or she clocked in late).
  Decided: send at once with the real end time, as long as the shift has not ended.
- **SE-Q3 — The end time was changed after the reminder.** Decided: a new reminder for the new end.
- **SE-Q4 — Partial leave at the end of the shift.** Decided: no reminder when approved leave reaches the shift end.
- **SE-Q5 — A shift shorter than the lead time.** Decided: remind from the shift start.
- **SE-Q6 — An employee who cannot receive push** (no linked account, or notifications never enabled).
  Decided: nothing else happens; nobody else is told.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Mona is told her shift is about to end (Priority: P1)

Mona works 10:00–18:00 at the Salmiya branch and clocked in at 10:02. At 17:30 (30 minutes before the end, the
default) her phone shows «دوامك بينتهي الساعة 6:00 م». She gets exactly one message for that shift.

**Why this priority**: This is the use case — the owner asked for it on 2026-10-08 (NC-Q1) and fixed its default.

**Independent Test**: Schedule a shift, open a session, advance the injected clock to 17:30, run the job: one ledger
row, one `ShiftEndsSoon` event with the employee as the only recipient; run again: nothing new.

**Acceptance Scenarios**:

1. **Given** a 10:00–18:00 shift, an OPEN session and the default lead, **When** the job runs at 17:29, **Then** nothing
   is recorded; **When** it runs at 17:30 or later before 18:00, **Then** exactly one ledger row and one event exist.
2. **Given** a ledger row exists, **When** the job re-runs, restarts, or two workers run it, **Then** no second row,
   event or audit entry exists.
3. **Given** the lead is changed to 45 minutes before the run, **Then** the reminder is due at 17:15; a lead change
   after the reminder was recorded changes nothing for that shift.
4. **Given** the branch has an override with a different lead, **Then** its employees use the override, the other
   branches the business rule (spec 060 D-B13).
5. **Given** any configuration, **Then** nothing is sent by email, WhatsApp or the admin bell, and no manager
   receives anything.

---

### User Story 2 - No reminder when she is not at work (Priority: P1)

Sara left at 16:00 with approval; Heba never came; Nour is on a 17:00–17:30 break at 17:25; Rana's approved leave runs
16:00–18:00 and her shift ends at 18:00. None of them is told her shift is ending.

**Why this priority**: A wrong reminder trains staff to ignore the real one (spec 034 RE-Q4 reasoning).

**Independent Test**: For each case, run the job after the reminder moment: no ledger row and no event.

**Acceptance Scenarios**:

1. **Given** no OPEN session (clocked out, or never clocked in) and the rule on, **Then** no row and no event; the not-clocked-in alert
   is unchanged (spec 036). (SE-Q1).
2. **Given** an employee on a break (clocked out inside the break) at the reminder moment, **Then** nothing now; if she
   clocks back in before the shift ends, the reminder goes out at the next run. (SE-Q1).
3. **Given** approved leave that reaches the shift end, **Then** no row; **Given** pending, rejected or cancelled
   leave, **Then** the reminder goes out. (SE-Q4).
4. **Given** a deleted employee, or one whose contract ended before the working date, **Then** no row and no event.
5. **Given** the kind is switched off, or the business master switch is off, **When** an employee's reminder
   moment arrives (at work or, for example, on a break), **Then** a ledger row with `suppressed_at` is written and **no** event; switching the rule back on
   later never sends a reminder for that shift (D-B15).
6. **Given** the rule is off and Rana's approved leave reaches her 18:00 shift end, **Then** no row and no event:
   the leave excuses the shift before the rule is checked (BR-002), so there is nothing to suppress. (SE-Q4).

---

### User Story 3 - Edge shifts: split, overnight, late, moved (Priority: P2)

Nour works 09:00–13:00 and 17:00–21:00; Rana's shift is 22:00–06:00; the system was down 17:00–17:45 one day; a manager
moves Mona's end from 18:00 to 20:00 at 17:40, after her reminder.

**Why this priority**: Salons split days; overnight shifts exist (D-32); outages and edits happen.

**Independent Test**: The fixtures below through the job with an injected clock.

**Acceptance Scenarios**:

1. **Given** Nour's two shifts and an open session all day, **Then** she gets one reminder at 12:30 and one at 20:30,
   each with its own end time.
2. **Given** Rana's overnight shift, **Then** the reminder is due at 05:30 local time on the next calendar day; no quiet
   hours.
3. **Given** the job was down until 17:45 for a 18:00 end and a 30-minute lead, **Then** it sends at 17:45 with the
   real end time (SE-Q2). (SE-Q2).
4. **Given** Mona's reminder was recorded for an 18:00 end and the end is moved to 20:00, **Then** a new reminder
   is due at 19:30. (SE-Q3).
5. **Given** a 1-hour shift and a 90-minute lead, **Then** the reminder is due at the shift start (SE-Q5). (SE-Q5).
6. **Given** a clock-in at 17:40 on an 18:00 end (she was late), **Then** the reminder goes out at the next run, with
   «6:00 م». (SE-Q2).

---

### Edge Cases

- A clock-out at exactly the reminder instant: the employee's attendance lock decides; whoever locks first wins (a
  reminder committed before the clock-out stands; a clock-out first means no OPEN session and no reminder).
- A clock-in at another branch counts as present (the reminder is about the employee's day; NC-Q8 precedent).
- A week re-saved with the same end after the reminder: no second reminder (the once-only key is the employee and the
  end instant, not the shift row; ADR-0024 replaces rows).
- An employee with no linked user: the ledger row is written with `recipient_count = 0` and the event carries no
  recipient; it is acknowledged unsent. (SE-Q6).
- An employee whose linked user has no membership active at the decision instant that covers her (scope the company,
  her business, or one of her branches on the shift's working day; it ended, has not started yet, or sits in another
  business) is treated exactly like one with no linked user: the ledger row has `recipient_count = 0` and the event
  carries no recipient, because the producer owns the push eligibility rule and nothing is emitted for a linked user
  whose personal access has ended (ADR-0052 §5; ADR-0053 decision 13).
- An employee with a linked user who never enabled push: the event is delivered by 28b's channel, which owns the
  silent no-op; nothing else happens.
- A company deleted or closed: skipped entirely at the eligibility read (ADR-0037 §2).
- Another company's shifts, sessions, leave and memberships are never read (RLS).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST detect, for every running scheduled shift, that `max(shift end − the rule's lead, shift start)` has arrived,
  comparing UTC instants (ADR-0053 §3, §11), and MUST send the reminder only when the employee has an OPEN attendance
  session at any branch at that instant (FR-004); with the rule off, FR-006 applies whether or not she is present.
- **FR-002**: The lead MUST come from the effective `SHIFT_ENDS_SOON` rule of the shift's business and branch (branch
  override, else business rule, else the default of 30 minutes; spec 060 D-B13), read once per run per pair and again
  by the decision; there is no interim fixed rule.
- **FR-003**: A shift whose end has passed MUST be skipped; a deleted employee or one whose contract ended before the
  working date MUST be skipped; approved leave that reaches the shift end MUST skip it; pending, rejected and cancelled
  leave MUST NOT (ADR-0053 §5, §6). (SE-Q4).
- **FR-004**: With the rule on, an employee without an OPEN session MUST write nothing (with the rule off, FR-006 applies instead), so a later clock-in before the end can still
  trigger the reminder (ADR-0053 §4). (SE-Q1).
- **FR-005**: The system MUST record the reminder once per employee per shift-end instant, whatever re-runs, restarts,
  concurrent workers or schedule re-saves happen (ADR-0053 §7). (SE-Q3).
- **FR-006**: A due reminder of an eligible, non-excused employee found while the kind or the business master switch
  is off MUST write the ledger row with
  `suppressed_at` and no event **whether or not the employee has an OPEN session at that instant**, so enabling the rule
  later never back-fills it (D-B15, ADR-0053 §8). A shift excused by approved leave writes nothing even with the rule
  off, because `EXCUSED` comes before `SUPPRESS` (BR-002). The rule used is the one read under the employee lock.
- **FR-007**: Each reminder MUST publish one `ShiftEndsSoon` event in the ledger's transaction. Its only recipient is the
  employee's own user; for an employee with no linked user the event carries no recipient (SE-Q6). It goes out on the push channel defined by row 28b, carrying the shift end as a local `HH:MM` and the
  branch names; never a phone, never a document (ADR-0053 §9, §10).
- **FR-008**: The detection MUST never change attendance, lateness, hours, salary or commission (SPEC §7, A7).
- **FR-009**: Each recorded reminder MUST leave an audit entry with the system as actor.
- **FR-010**: The reminder MUST run as a third detector of the existing company job and MUST NOT require a new scheduler
  or a replay of any event (ADR-0053 §1).
- **FR-011**: A reminder whose moment has already passed while the shift is running MUST be sent at once, with the real end
  time, as long as the shift has not ended (SE-Q2). (SE-Q2).
- **FR-012**: A lead longer than the shift MUST make the reminder due at the shift start, never before it (SE-Q5). (SE-Q5).

### Key Entities

- **Scheduled shift** (existing, spec 020): planned start and end at a branch, with its working date.
- **Attendance session** (existing, spec 027): the employee's open or closed clock-in; OPEN means she is at work.
- **Leave request** (existing, specs 023/025): approved, pending, rejected or cancelled; full-day or partial.
- **Alert rule `SHIFT_ENDS_SOON`** (existing, spec 060): `enabled` and `lead_minutes` per business or branch, plus the
  business master switch.
- **Shift-ending notice** (new): the once-only record that the reminder for employee X's shift ending at instant T was
  decided — branch, business, shift start and end, due moment, detection time, recipient count, `suppressed_at`.

## Slice design *(mandatory — `CLAUDE.md` §1)*

A worker job slice: pure domain rules, one worker use case, one table, one event, one in-app-free (push) recipient and one
template. **No HTTP endpoint and no new screen.** The lead and the switches are edited on the alerts screen of row 62
(sub-PR 62-4); this row adds nothing there beyond what the kind table already lists. Technical decisions:
**ADR-0053**.

### Business rules

- **BR-001**: `remindAt = max(endsAt − lead, startsAt)` (BR-005 for the clamp); a shift is *running* when
  `startsAt ≤ now < endsAt`.
- **BR-002**: decision order → `STALE` when `now ≥ endsAt`; `INELIGIBLE` for a deleted employee or `contract_end`
  before the working date; `EXCUSED` by approved full-day leave on the working date, or by approved partial leave with
  `leave.starts_at < endsAt ≤ leave.ends_at`; `WAIT` when `now < remindAt`; `SUPPRESS` when the effective rule is off (kind switch or business master switch), whether
  or not she is present (D-B15); `NOT_PRESENT` when no OPEN session exists; otherwise `REMIND`. There is no minimum remaining time: a late reminder is sent while the shift runs (SE-Q2).
- **BR-003**: presence = an OPEN session of the employee at the sampled instant, at any branch, not voided.
- **BR-004**: the once-only key is `(company_id, employee_id, shift_ends_at)`, not the shift row id (ADR-0024 replaces
  rows). A changed end time is a new key and a new reminder (SE-Q3).
- **BR-005**: a lead larger than the shift length makes the reminder due at the shift start. (SE-Q5).
- **BR-006**: the only recipient is `employees.user_id`; no managers; no other channel.
- Pure functions in `apps/worker/src/modules/staff/domain/shift-ending-soon.ts`, Arabic JSDoc: `remindMoment`,
  `shiftEndingSoonDecision`, `endsSoonLeave`, `shiftEndsSoonParameters`. The lead and the switch are parameters.

### Schema changes

| Table | Columns added / changed | RLS policy | Indexes | Tenant-qualified FKs |
|---|---|---|---|---|
| `attendance_shift_ending_notices` (new) | PK `(company_id, id)`, `business_id`, `branch_id`, `employee_id`, `shift_starts_at`, `shift_ends_at`, `remind_due_at`, `notified_at`, `recipient_count int`, `suppressed_at timestamptz NULL`; `CHECK (shift_ends_at > shift_starts_at)`, `CHECK (recipient_count >= 0)`, `CHECK (suppressed_at IS NULL OR recipient_count = 0)` | FORCE RLS `company_id = app.company_id`; `pospay_app` SELECT + INSERT only | UNIQUE `(company_id, employee_id, shift_ends_at)`; `(company_id, business_id, branch_id)`; `(company_id, branch_id)` | `(company_id, business_id, employee_id)` → `employees`; `(company_id, business_id, branch_id)` → `branches`; **no FK to the shift row** |

No change to `staff_schedule_shifts` or `attendance_sessions` (existing indexes serve the page and the probes).

### API contract

- No endpoint, request schema or `Idempotency-Key`.
- `packages/contracts`: **no change.** The PUSH recipient entry is 28b's generic schema (above) and carries any push
  template; the job data is unchanged (`{ companyId }`).
- `packages/notifications` (`push/templates.ts`): template `shift_ends_soon` rev 1, ar/en, with its strict parameter
  tuple (`shift_end` 24-hour `HH:MM`, `branch_name_ar`, `branch_name_en`) validated there with the existing safe-text
  checks, because push templates are validated in this package, not in contracts. The template renders `shift_end`
  as a 12-hour time in the subscription's language («6:00 م» / «6:00 PM»); the stored value stays 24-hour.
- `packages/i18n`: no admin UI copy (the alerts screen already lists the kind).

### Permissions

None new. The job runs as `pospay_app` inside `withTenant(companyId)`; the recipient is the employee herself.

### Events

- **Published**: `ShiftEndsSoon` — emitted once per (employee, shift end) when the reminder moment has passed, she is
  at work and the rule is on, in the same transaction as the ledger row and the audit entry. Payload: `notice_id,
  employee_id, business_id, branch_id, shift_starts_at, shift_ends_at, remind_at, detected_at`, plus
  `notification_recipients` (one push recipient, carrying the preformatted template inputs and `send_deadline` equal to
  `shift_ends_at`) when the employee has a linked user. Declared in
  `apps/worker/src/modules/staff/events/published.ts` with its Arabic one-liner.
- **Consumed**: none new. notifications gains `ShiftEndsSoon` in its source-event list.
- Audit: `attendance_notice` / `shift_ending_soon.detected`, actor NULL (system).

### Lock and once-only protocol

As spec 036 and ADR-0037 §7: the page is read without locks (pre-filter); per candidate one `withTenant`
transaction locks `attendance_states`, takes `employees … FOR SHARE`, samples the Clock once, re-reads the shift, leave,
eligibility and the OPEN session, decides, resolves the rule, inserts the ledger with `ON CONFLICT DO NOTHING
RETURNING`, and only an inserted row writes audit and outbox.

### Sub-PRs (at most three subtasks each; one at a time, each in a fresh worktree from main)

| # | Title | Subtasks | Waits for | Size |
|---|---|---|---|---|
| **064-1** | Rules and ledger | 1. `domain/shift-ending-soon.ts` with its exhaustive unit tests (BR-001…BR-006, DST, overnight, clamp). 2. Migration + Drizzle schema for `attendance_shift_ending_notices`, grants allowlist in `privileges.spec.ts`. 3. RLS negative tests (cross-tenant read 0 rows, insert rejected, FKs rejected, UPDATE/DELETE refused). | **28b-3 merged** | 220–320 |
| **064-2** | Template and delivery | 1. Template `shift_ends_soon` rev 1 (ar/en) in `packages/notifications/src/push/templates.ts` with its strict parameter tuple (no contracts change: the PUSH recipient schema is 28b's and already carries `send_deadline`). 2. `ShiftEndsSoon` in the notifications consumer list, `known-event-types.md` coverage gate, module-map §4 event row. 3. End-to-end test with a hand-made event: outbox → transport → 28b's push sender stub; the text is rendered in the language ADR-0052 stores (today: per push subscription). | 064-1; **28b-3 merged** | 200–300 |
| **064-3** | Detector in the company job | 1. Port `ShiftEndingSoonTransactions`, persistence (paged candidates with the presence column, locked reads, writes) and the staff `AlertRulesPort` adapter over worker `settings` (reused if 62-2 created it); module-map §3 row and YAML. 2. Use case `detect-shift-ending-soon`; `ShiftEndsSoon` in `published.ts`; wired as the **last** step of the processor. 3. Integration tests SEN-01…SEN-14 and EXPLAIN assertions. | 064-2 | 360–480 |

### Test plan

- **Domain unit**: 17:29:59 `WAIT`, 17:30:00 `REMIND`; lead 45 → 17:15; a shift end of 18:00 `STALE` at exactly 18:00:00;
  no OPEN session `NOT_PRESENT`; full / partial / pending / rejected leave; partial leave that ends before the shift end
  does not excuse; deleted / ended contract `INELIGIBLE`; overnight shift; DST fall and spring zones; split shifts;
  lead longer than the shift; the parameter tuple and name fallbacks.
- **Integration scenarios** (PostgreSQL, one cloned database per file, as `pospay_app`): `SEN-01` one row and one event,
  re-run none · `SEN-02` two concurrent workers → one · `SEN-03` clock-out racing the job: first lock wins ·
  `SEN-04` no OPEN session, rule on → no row; clock-in later → reminder · `SEN-05` employee on break → none, back from break →
  sent · `SEN-06` approved leave to the end suppresses, pending does not · `SEN-07` re-saved week, same end → none ·
  `SEN-08` end moved → new reminder (SE-Q3) · `SEN-09` kind off and master off → `suppressed_at` row, no event, and
  switching on does not send it · `SEN-10` branch override lead · `SEN-11` clock-in at another branch counts ·
  `SEN-12` late detection: sent while the shift runs, with the real end time (SE-Q2) · `SEN-13` no linked user → row with zero recipients, event without recipients ·
  `SEN-14` deleted employee / ended contract / deleted company → none; the third detector still runs after the first
  two fail.
- **RLS negative**: cross-tenant read of the notices table = 0 rows; cross-tenant insert rejected; cross-tenant FKs
  rejected; UPDATE/DELETE refused to `pospay_app`.
- **Queries / EXPLAIN**: the candidate page uses `(company_id, starts_at)` and the `attendance_sessions_one_open`
  probe; the ledger anti-join uses the unique index; the leave probe uses `leave_requests_company_employee_period_idx`.
- **Notifications**: template renders ar and en; a rejected name falls back to the generic label; the event is
  delivered once through the 28b stub.

### Documents to update in the same PRs

- This docs PR: `docs/specs/phase-1/SPEC.md` §3 (`ShiftEndsSoon` added to the `staff ⇒ notifications` events).
- 064-2: `docs/module-map.md` §4 (the `ShiftEndsSoon` event row; `module-map.yaml` has no event rows, so it does not
  change) and `docs/specs/worker/known-event-types.md`.
- 064-3: `docs/module-map.md` §3 (the staff `AlertRulesPort` → worker `settings` row, only if 62-2 has not added it) and
  `docs/module-map.yaml`; ADR-0053 final status; `docs/specs/phase-1/IMPLEMENTATION-PLAN.md` row 28c marked done with
  the PR numbers.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For every shift end instant with an employee at work at the reminder moment, exactly one reminder exists
  after that moment, never two for the same instant (a changed end time is a new instant, SE-Q3).
- **SC-002**: Zero reminders for employees who left, never came, are on approved leave to the end, or are no longer
  employed, across the fixtures.
- **SC-003**: For a lead of at least the 5-minute cadence, the reminder reaches the employee's phone within 5 minutes of the reminder moment while the system is up; shorter leads are best-effort (ADR-0053 §11).
- **SC-004**: A change of the lead from the alerts screen applies to the next run; a reminder already recorded is not
  repeated or moved.
- **SC-005**: No change to attendance, lateness, hours, salary or commission figures.

## Assumptions

- Cadence 5 minutes and keyset pages of 100 are inherited from spec 029/036; the detector reads every page each run.
- Spec 036's earlier owner addition (one stored language per user) and the plan row 28b predate ADR-0052's per-subscription
  language; amending them belongs to 28b's PR (#512), not to this row.
- A lead shorter than the 5-minute cadence is best-effort: a run may miss the window (ADR-0053 §11); the alerts screen
  should show the resolution (follow-up issue).
- The text states the end time, not a countdown (ADR-0053 §10); the wording is Arabic-first and goes through the
  template, not hard-coded.
- The employee's language is decided per push subscription by notifications (ADR-0052); this row stores and sends none.
- A reminder never goes to a manager; managers keep the not-clocked-in and break alerts.
- Out of this row: the push channel and subscriptions (28b), the alerts screen (62-4), the employee's «you have not
  clocked in» push (28b), WhatsApp or email variants (62b).
- `.specify/extensions.yml` does not exist, so no before/after hooks ran.
