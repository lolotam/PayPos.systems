# ADR-0053 — Shift-ending reminder: discovery, presence, once-only ledger and rule

Status: Proposed (draft for row 28c; number provisional, renumbered at merge). The owner-dependent points are
marked `TODO(spec)` and listed in [the owner questions](../specs/062-shift-ending-reminder/owner-questions.ar.md).
Date: 2026-10-22. Scope: spec 062, Phase 1 row 28c. Owner decisions already taken: spec 036 NC-Q1 and its
question 6 (Waleed, 2026-10-08: «30 دقيقة، وتتغير من اللوحة»), spec 060 D-B13/D-B14/D-B15 and the
`SHIFT_ENDS_SOON` kind (PP-18.25).

## Context

Row 28c sends the employee a push «دوامك قرب يخلص» a lead time before her scheduled shift ends — 30 minutes
by default, editable from the alert-rules screen (spec 060, row 62). Four things are not covered by an
existing decision:

1. **Discovery.** A worker job has no session and `pospay_app` cannot read across tenants (ADR-0003 §3). ADR-0037
   already registers one 5-minute scheduler per company for the staff detectors.
2. **Who is "in the shift".** The not-clocked-in alert asks "has she arrived"; this reminder asks "is she still at
   work". An employee who clocked out early, who is on a break, who never came, or who is on leave must not be
   told her shift is ending.
3. **Rule source.** Spec 060 already created the kind `SHIFT_ENDS_SOON` (default on, lead 30 minutes, fixed
   recipient `EMPLOYEE_PUSH`, branch-scoped) and a worker `settings` read, `alertRule(tx, companyId, scope, kind)`.
   Unlike rows 28 and 41, this row has no interim fixed rule to replace later.
4. **Delivery.** The channel is staff web push, built by row 28b (spec 061, ADR-0052). This ADR defines no channel:
   it emits an event whose recipient shape is 28b's.

## Decision

1. **Discovery: a third detector in the existing company job.** The scheduler `attendance-not-clocked-in-<companyId>`
   (ADR-0037 §1, addendum 2026-10-10) runs the detectors in this order: not-clocked-in, break-not-returned,
   **shift-ending-soon**. Each runs even when the one before it failed; any failure fails the job so BullMQ
   retries it, and the three once-only ledgers make the retry harmless. No new scheduler identity, no new
   discovery event, no operator replay: every company that already has the scheduler has the new detector the day
   the worker is deployed. The processor keeps one job name; the file stays under the 300-line limit by moving each
   detector behind its own use case, as the break detector already does.
2. **The rule comes from `AlertRulesPort`, not from an interim function.** Worker `staff` defines
   `ShiftEndsSoonRules` in its own `ports/` (one method: the effective `SHIFT_ENDS_SOON` rule for a business and
   branch). Its adapter calls worker `settings`' public `alertRule` on the caller's `withTenant` transaction. The arrow
   `staff → settings` and the worker `AlertRulesPort` adapter for staff are already approved (ADR-0010 addendum
   2026-10-21, module-map §2, row 62-2); this row adds the port row to module-map §3 and the `reads:` line to the
   YAML. If sub-PR 62-2 merges first, this row reuses the adapter it creates; if this row merges first, 62-2 reuses
   ours (spec 060 «Relates» rule, one adapter per module). The rule gives `enabled` (kind toggle and master switch
   applied), `leadMinutes` (1…1440) and the fixed recipient `EMPLOYEE_PUSH`; the rule's `channels` and
   `recipientRoles` stay empty by definition. Rules are read once per run for each distinct (business, branch) pair
   of the candidate page and cached for that run only.
3. **Due moment and candidate page.** `remindAt = endsAt − lead`. The candidate page reads, without locks, the
   shifts that are **running** (`starts_at ≤ now < ends_at`, plus the 16-hour lower bound of ADR-0037 §6, which the
   `staff_schedule_shifts_duration` check makes sufficient), whose employee has an **OPEN attendance session**
   (probe on `attendance_sessions_one_open`, any branch), and that have no ledger row (`NOT EXISTS` on the ledger's
   unique index, before any lock). It uses the `(company_id, starts_at)` index ADR-0037 added; this row adds no
   index on the shifts table. The page cannot filter by `remindAt` because the lead differs per (business, branch),
   so the use case drops, in memory and using the cached rule, every candidate whose `remindAt` has not come.
   Only the remaining ones open a locked transaction. An idle run therefore costs one company-eligibility read, one
   rule read per distinct pair and one bounded page; employees who are not at work are never candidates.
4. **Presence = an OPEN session at the decision instant.** The reminder is for an employee who is working. An
   employee with no OPEN session is not a candidate and writes **no ledger row**: one who clocked out early never
   gets it; one on a break (clocked out inside the break, not yet back) is skipped now and picked up on a later run
   if she returns before the shift ends; one who never came is covered by the not-clocked-in alert. Because nothing
   is recorded for a skip, a later clock-in re-enters the candidate page by itself. A session that is OPEN but
   belongs to another branch counts: the reminder is about the employee's day, not a place (the NC-Q8 precedent).
   `TODO(spec)` SE-Q1 (who is "in the shift"), SE-Q2 (late sending).
5. **Decision order (pure domain function).** `shiftEndingSoonDecision(facts)` returns, in this order:
   `STALE` (now ≥ ends_at) → `INELIGIBLE` (deleted employee, or `contract_end` before the working date) →
   `EXCUSED` (approved leave that covers the shift end, below) → `WAIT` (now < remindAt) → `NOT_PRESENT` (no OPEN
   session) → `TOO_LATE` (only if SE-Q2 sets a minimum remaining time) → `REMIND`. Only `REMIND` and the
   rule-off case of decision 8 write a ledger row.
6. **Leave.** An approved `FULL_DAY` leave with `from ≤ working date ≤ to` excuses the shift, overnight ones
   included (ADR-0037 §8). An approved partial leave excuses it when it reaches or passes the shift end
   (`leave.starts_at < ends_at ≤ leave.ends_at`): she is leaving before the end, and the reminder would be
   wrong. A partial leave that ends before the shift end changes nothing. Pending, rejected and cancelled leaves
   never excuse. `TODO(spec)` SE-Q4.
7. **Once-only ledger and lock protocol.** A new table `attendance_shift_ending_notices` with UNIQUE
   `(company_id, employee_id, shift_ends_at)`, `SELECT + INSERT` for `pospay_app`, no FK to the shift row (rows are
   replaced on re-save, ADR-0024). Keying on the end instant means: re-saving the week with the same end
   never repeats the reminder, and moving the end to a new instant makes a new reminder possible before the new end.
   `TODO(spec)` SE-Q3: if the owner chooses «once per shift», the key becomes `(company_id, employee_id,
   shift_starts_at)` and nothing else in this ADR changes. Each decision runs after the first lock of scans and
   jobs: the employee's `attendance_states` row (ADR-0028/0032), then `employees … FOR SHARE` (ADR-0037 §7),
   then one Clock sample, then re-reads of the shift, leave, eligibility and the OPEN session; the ledger insert
   uses `ON CONFLICT … DO NOTHING RETURNING id` and only an inserted row writes audit and outbox. A clock-out
   that wins the `attendance_states` lock first removes the OPEN session, and the reminder is not sent; a reminder
   committed before the clock-out stands.
8. **Rule off: record suppression (spec 060 D-B15).** When a shift is due and present but the effective rule is off
   (kind toggle or business master switch), the detector writes the ledger row with `suppressed_at` set,
   `recipient_count = 0`, no event and no audit of a send, so switching the rule back on never reminds for a
   shift that was already past its moment. The column exists from the first migration (a `CHECK` ties
   `suppressed_at` to `recipient_count = 0`). The due moment still uses the stored lead of an off rule
   (`effectiveAlertRule` keeps `leadMinutes`).
9. **Event and recipient.** One event per reminder, `ShiftEndsSoon`, appended to the outbox in the ledger's
   transaction, declared in `apps/worker/src/modules/staff/events/published.ts` and added to the notifications
   consumer list and to `docs/specs/worker/known-event-types.md`. Payload: `notice_id, employee_id, business_id,
   branch_id, shift_starts_at, shift_ends_at, remind_at, detected_at`, plus `notification_recipients` with exactly
   one recipient: the employee's own `user_id` (`employees.user_id`), on the **push** channel in the shape row 28b
   defines (spec 061, ADR-0052). An employee without a linked user still gets a ledger row, with
   `recipient_count = 0` and an event without recipients, acknowledged unsent (the ADR-0037 precedent for a branch
   without managers). No manager is notified (managers have the not-clocked-in alert). No email, no WhatsApp.
   `TODO(spec)` SE-Q6.
10. **Template.** `packages/notifications` gains `shift_ends_soon` rev 1 (ar/en). Safe parameters: `shift_end`
    (`HH:MM`, formatted in the schedule's saved timezone as ADR-0037 §4 does, so a later timezone change cannot
    relabel it) and `branch_name_ar` / `branch_name_en` (the same safe-text rules and generic fallbacks). The text
    states the **end time** («دوامك بينتهي الساعة 6:00 م»), never a countdown, because a late-sent reminder
    (SE-Q2) would make «بعد 30 دقيقة» false. Language: 28b renders push in the employee's stored language
    preference; this row adds none.
11. **Time.** `starts_at`/`ends_at` are the resolved UTC instants of ADR-0024; the lead is elapsed time, so
    overnight shifts and DST need no reinterpretation. No quiet hours (NC-Q11 precedent). A lead longer than the
    shift gives `remindAt < starts_at`; the detector clamps `remindAt` to `max(endsAt − lead, startsAt)` so the
    reminder never precedes the shift start. `TODO(spec)` SE-Q5.
12. **No attendance effect and failure visibility.** The detector never changes a session, lateness, hours, salary
    or commission (SPEC §7). Audit entry `attendance_notice` / `shift_ending_soon.detected`, actor NULL. Failures of
    one candidate go through the diagnostics port of ADR-0037 §9 (safe error type and code only); the other
    candidates continue and the run is retryable.

## Consequences

Every company that has the staff scheduler gets the reminder with no replay. Reading the effective rule on every
run means a lead-time change applies to the next run, never to a reminder already recorded. Employees who work
across several branches are reminded once per shift end, whichever branch they clocked in at. The dependency on row
28b is hard: no code of this row can be exercised end to end before the push recipient shape and its subscription
store exist; the spec splits the work so the pure rules and the ledger can be reviewed first, but the implementation
sub-PRs start only after 28b is merged. A shift whose end moves earlier than «now plus lead» after being recorded
can produce a second reminder (SE-Q3 recommended answer); that is intended. Push to an employee who has no
subscription is a silent no-op owned by 28b's delivery, not by this job.
