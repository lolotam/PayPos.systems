# ADR-0053 — Shift-ending reminder: discovery, presence, once-only ledger and rule

Status: Proposed (draft for row 28c; number provisional, renumbered at merge). The owner-dependent points were decided
by Waleed on 2026-10-22, the recommended option in all six (SE-Q1…SE-Q6, PP-34.1…PP-34.6; see
[the owner questions](../specs/064-shift-ending-reminder/owner-questions.ar.md)).
Date: 2026-10-22. Scope: spec 064, Phase 1 row 28c. Owner decisions already taken: spec 036 NC-Q1 and its
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
4. **Delivery.** The channel is staff web push, built by row 28b (spec 063, ADR-0052). This ADR defines no channel:
   it emits an event whose recipient shape is 28b's.

## Decision

1. **Discovery: a third detector in the existing company job.** The scheduler `attendance-not-clocked-in-<companyId>`
   (ADR-0037 §1, addendum 2026-10-10) runs the detectors in this order: not-clocked-in, break-not-returned,
   **shift-ending-soon**. Each runs even when the one before it failed; any failure fails the job so BullMQ
   retries it, and the three once-only ledgers make the retry harmless. No new scheduler identity, no new
   discovery event, no operator replay: every company that already has the scheduler has the new detector the day
   the worker is deployed. The processor keeps one job name; the file stays under the 300-line limit by moving each
   detector behind its own use case, as the break detector already does.
2. **The rule comes from the generic `AlertRulesPort`, not from an interim function.** Worker `staff` owns a
   *single* `AlertRulesPort` in its `ports/` (the approved port of ADR-0010 addendum 2026-10-21, spec 060 D-B14:
   `rule(tx, companyId, scope, kind)`), called here with the kind `SHIFT_ENDS_SOON`; this ADR adds **no** parallel
   `ShiftEndsSoon*` rule port. Its adapter calls worker `settings`' public `alertRule` on the caller's `withTenant`
   transaction. The arrow `staff → settings` and the worker staff adapter are already approved (module-map §2, row
   62-2), so the module-map §3 row exists or is created by whichever of 62-2 and this row merges first; the other only
   adds its kind to the `reads:` line (spec 060 «Relates» rule: one adapter per module). The rule gives `enabled`
   (kind toggle and master switch applied), `leadMinutes` (1…1440) and the fixed recipient `EMPLOYEE_PUSH`; the rule's
   `channels` and `recipientRoles` stay empty by definition. **The run caches rules per (business, branch) pair for
   pre-filtering only. The decision re-reads the effective rule inside the candidate's locked transaction** (D-B15: a
   change applies to events emitted after it commits), and a disagreement with the cache is resolved in favour of the
   locked read. The employee and attendance locks are **not** a fence against a settings writer: a rule change that
   commits between the locked read and the ledger insert can still apply to that one reminder. The window is the
   length of one short transaction and is the same for every emitter that reads `AlertRulesPort` (ADR-0010
   addendum); it is accepted, nothing is re-sent or retracted.
3. **Due moment and candidate pages.** `remindAt = max(endsAt − lead, startsAt)` (decision 11). The detector pages
   through **all** running shifts with a keyset cursor over `(starts_at, shift id)` — the id is the immutable tie-breaker, because many employees share a start — until the page comes back short, never one page per run, so
   not-yet-due rows cannot hide due ones. A page is read without locks and holds the shifts that are **running**
   (`starts_at ≤ now < ends_at`, plus the 16-hour lower bound of ADR-0037 §6, which the
   `staff_schedule_shifts_duration` check makes sufficient) and that have no ledger row (`NOT EXISTS` on the
   ledger's unique index, before any lock), each with a boolean *has an OPEN session* (probe on
   `attendance_sessions_one_open`, any branch) computed in the same read; presence is a column, not a filter (decision
   8 needs it). It uses the `(company_id, starts_at)` index ADR-0037 added; this row adds no index on the shifts
   table. The lead differs per (business, branch), so the due test happens in memory with the cached rule. Only the
   due candidates open a locked transaction: with the rule on, only those with an OPEN session; with the rule off,
   every due one (decision 8). An idle run therefore costs one company-eligibility read, one rule read per distinct
   pair and ⌈running shifts / 100⌉ unlocked page reads, bounded by the employees working at that moment.
4. **Presence = an OPEN session at the decision instant.** The reminder is for an employee who is working. With the rule on, an
   employee with no OPEN session writes **no ledger row** (with the rule off, decision 8 applies): one who clocked out early never
   gets it; one on a break (clocked out inside the break, not yet back) is skipped now and picked up on a later run
   if she returns before the shift ends; one who never came is covered by the not-clocked-in alert. Because nothing
   is recorded for a skip, a later clock-in makes her a locked candidate on a later run by itself. A session that is OPEN but
   belongs to another branch counts: the reminder is about the employee's day, not a place (the NC-Q8 precedent).
   Decided: SE-Q1 (who is "in the shift"), SE-Q2 (late sending).
5. **Decision order (pure domain function).** `shiftEndingSoonDecision(facts)` returns, in this order:
   `STALE` (now ≥ ends_at) → `INELIGIBLE` (deleted employee, or `contract_end` before the working date) →
   `EXCUSED` (approved leave that covers the shift end, below) → `WAIT` (now < remindAt) → `SUPPRESS` (rule off, decision 8) → `NOT_PRESENT` (no OPEN session) → `REMIND`; there is no minimum remaining time, a late reminder is sent while the shift runs (SE-Q2). Only `REMIND` and `SUPPRESS` write a ledger row. The rule flag is
   a fact read under the lock (decision 2).
6. **Leave.** An approved `FULL_DAY` leave with `from ≤ working date ≤ to` excuses the shift, overnight ones
   included (ADR-0037 §8). An approved partial leave excuses it when it reaches or passes the shift end
   (`leave.starts_at < ends_at ≤ leave.ends_at`): she is leaving before the end, and the reminder would be
   wrong. A partial leave that ends before the shift end changes nothing. Pending, rejected and cancelled leaves
   never excuse (SE-Q4).
7. **Once-only ledger and lock protocol.** A new table `attendance_shift_ending_notices` with UNIQUE
   `(company_id, employee_id, shift_ends_at)`, `SELECT + INSERT` for `pospay_app`, no FK to the shift row (rows are
   replaced on re-save, ADR-0024). Keying on the end instant means: re-saving the week with the same end
   never repeats the reminder, and moving the end to a new instant makes a new reminder possible before the new end.
   Decided (SE-Q3): a changed end is a new reminder. Each decision runs after the first lock of scans and
   jobs: the employee's `attendance_states` row (ADR-0028/0032), then `employees … FOR SHARE` (ADR-0037 §7),
   then one Clock sample, then re-reads of the shift, leave, eligibility and the OPEN session; the ledger insert
   uses `ON CONFLICT … DO NOTHING RETURNING id` and only an inserted row writes audit and outbox. A clock-out
   that wins the `attendance_states` lock first removes the OPEN session, and the reminder is not sent; a reminder
   committed before the clock-out stands.
8. **Rule off: record suppression, whether or not she is present (spec 060 D-B15).** When a shift is due (its
   `remindAt` has come, it has not ended, the employee is eligible and not excused) and the effective rule read under
   the lock is off (kind toggle or business master switch), the detector writes the ledger row with `suppressed_at`
   set, `recipient_count = 0`, no event and no audit of a send, **even when she has no OPEN session at that
   instant**. Otherwise a rule turned back on while she is on a break would send, after the fact, a reminder that
   was already past its moment while the rule was off. That is why the page carries presence as a column and the
   rule-off case locks every due candidate (decision 3). The column exists from the first migration (a `CHECK` ties
   `suppressed_at` to `recipient_count = 0`). The due moment still uses the stored lead of an off rule
   (`effectiveAlertRule` keeps `leadMinutes`).
9. **Event and recipient.** One event per reminder, `ShiftEndsSoon`, appended to the outbox in the ledger's
   transaction, declared in `apps/worker/src/modules/staff/events/published.ts` and added to the notifications
   consumer list and to `docs/specs/worker/known-event-types.md`. Payload: `notice_id, employee_id, business_id,
   branch_id, shift_starts_at, shift_ends_at, remind_at, detected_at`, plus `notification_recipients` with exactly
   one recipient: the employee's own `user_id` (`employees.user_id`), on the **PUSH** channel of row 28b (spec 063,
   ADR-0052; settled with that session on 2026-10-22). The PUSH recipient entry holds **only** `user_id`, `template_key`
   / `revision`, the safe parameters and an optional `send_deadline`: no phone and no locale. This emitter touches no
   sending code: notifications looks up the user's push subscriptions and renders the text in each subscription's own
   language. **The template inputs travel inside that recipient entry, preformatted**, as in ADR-0037 §4 (the
   business-free notifications consumer cannot look them up): `template_key` `shift_ends_soon`, revision 1, and the
   strict parameter tuple of decision 10. The shift end is formatted by the detector with the
   schedule's saved timezone; the branch names come from the existing `BranchPlaceReader` (ADR-0037 §6) on the same
   transaction. **The recipient also carries `send_deadline` equal to `shift_ends_at`** (the optional field of the PUSH
   recipient), so an outbox or queue delay past the end drops the reminder instead of sending «your
   shift ends» after it ended. An employee without a linked user still gets a ledger row, with
   `recipient_count = 0` and an event without recipients, acknowledged unsent (the ADR-0037 precedent for a branch
   without managers). No manager is notified (managers have the not-clocked-in alert). No email, no WhatsApp.
   Decided (SE-Q6): nobody else is told.
10. **Template.** `packages/notifications` gains `shift_ends_soon` rev 1 (ar/en). Safe parameters: `shift_end`
    (`HH:MM`, formatted in the schedule's saved timezone as ADR-0037 §4 does, so a later timezone change cannot
    relabel it) and `branch_name_ar` / `branch_name_en` (the same safe-text rules and generic fallbacks). The text
    states the **end time** («دوامك بينتهي الساعة 6:00 م»), never a countdown, because a late-sent reminder
    (SE-Q2) would make «بعد 30 دقيقة» false. Language: notifications renders the push in the language of each of the employee's subscriptions (ADR-0052);
    this row stores and sends no language.
11. **Time.** `starts_at`/`ends_at` are the resolved UTC instants of ADR-0024; the lead is elapsed time, so
    overnight shifts and DST need no reinterpretation. No quiet hours (NC-Q11 precedent). A lead longer than the
    shift gives `remindAt < starts_at`; the detector clamps `remindAt` to `max(endsAt − lead, startsAt)` so the
    reminder never precedes the shift start (SE-Q5). The job runs every 5 minutes and skips ended shifts, so a lead shorter than the cadence
    (the rule allows 1…1440) is observed only if a run lands inside the last `lead` minutes; such a reminder is
    best-effort and can be missed while the system is healthy. This is a known limit, not a defect of the detector;
    the alerts screen (62-4) should state the 5-minute resolution beside the lead field (follow-up issue).
12. **No attendance effect and failure visibility.** The detector never changes a session, lateness, hours, salary
    or commission (SPEC §7). Audit entry `attendance_notice` / `shift_ending_soon.detected`, actor NULL. Failures of
    one candidate go through the diagnostics port of ADR-0037 §9 (safe error type and code only); the other
    candidates continue and the run is retryable.

## Consequences

Every company that has the staff scheduler gets the reminder with no replay. Reading the effective rule under each decision
means a lead-time change applies to the next decision, never to a reminder already recorded. Employees who work
across several branches are reminded once per shift end, whichever branch they clocked in at. The dependency on row
28b is hard: no code of this row can be exercised end to end before the push recipient shape and its subscription
store exist; the spec splits the work so the pure rules and the ledger can be reviewed first, the template and the consumer
registration land second, and the detector is wired into the company job last, so a deployed detector never emits an
event nothing can deliver; the implementation sub-PRs start only after 28b is merged. A shift whose end moves earlier than «now plus lead» after being recorded
can produce a second reminder (SE-Q3); that is intended. Push to an employee who has no
subscription is a silent no-op owned by 28b's delivery, not by this job.
