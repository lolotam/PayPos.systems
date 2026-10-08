# Staff suspected / missed-out job — Phase 1 PR 24

Created: 2026-10-04. Status: implemented with provisional owner questions below.

Sources: Phase 1 SPEC §7 ("Missed clock-out", state-machine bullet), §11 A6, plan row 24
(rows 25 resolve-attendance-exception and 28 not-clocked-in alert are separate slices),
spec 027 + ADR-0028 (AT-Q5 shift selection, AT-Q6 16-hour closure instant), ADR-0003 §3
(no cross-tenant read by `pospay_app`), ADR-0018 (provider work outside transactions),
ADR-0022 (per-company schedules registered by outbox delivery), ADR-0032 (this slice).

## User scenarios and requirements

P1: an employee forgets to clock out. The manager later sees a suspected missed clock-out
exception for that session; if the employee scans before 16 hours the session closes normally
and the exception stays visible as "closed late"; at 16 hours the session becomes MISSED_OUT,
closed at the 16-hour instant. No hours and no deduction are ever derived (D-32).

- MO-01: at scheduled shift end + 4 h (or clock-in + 12 h with no schedule) one
  SUSPECTED_MISSED_OUT exception is raised for the OPEN session, never twice.
- MO-02: at clock-in + 16 h or later the OPEN session closes MISSED_OUT with `clock_out` =
  clock-in + 16 h (AT-Q6); detection time is the event `recorded_at` and the audit row. An open
  suspected exception is resolved `MISSED_OUT` by the system (same convention as PR 22's scan path).
- MO-03: every action locks the employee's AttendanceState row first (same order as PR 22), samples
  the injected Clock once after the lock, and re-reads the OPEN session; a scan that already closed
  or re-opened the session wins and the job does nothing for it.
- MO-04: a later scan before 16 h closes normally and resolves the suspected exception as
  `CLOSED_LATE` (PR 22 already does this; this slice adds the job-raised integration test).
- MO-05: tenant discovery adds no cross-tenant read and no new role: delivery of
  `AttendanceClockedIn` registers one idempotent per-company BullMQ job scheduler; every run works
  only inside `withTenant(companyId)` as `pospay_app`.
- MO-06: re-running the job, a job retry or two workers produce the same single exception,
  single closure, single audit row and single event per transition.

## Slice design

### Tenant discovery (ADR-0032, reusing ADR-0022)

The outbox dispatcher already reads every tenant's outbox (`pospay_dispatcher`, ADR-0003 §3).
When the worker delivers `AttendanceClockedIn` it calls `upsertJobScheduler` on queue
`attendance-missed-out` with id `attendance-missed-out-<companyId>`, every 5 minutes, job data
`{ companyId }` only (validated by `attendanceMissedOutJob`). Redis I/O runs outside every
database transaction; a scheduling failure returns a retryable delivery outcome (outbox backoff).
The event then continues to the normal business deliverer. A company that never clocked in has no
schedule; a company with a clock-in keeps one (cheap: one indexed query per run).

### Worker module `apps/worker/src/modules/staff`

- `domain/missed-out.ts` — pure rules: due time, 16-hour deadline, action, candidate cutoff.
- `ports/` — `MissedOutTransactions` (candidate page, per-employee locked transaction) and `Clock`.
- `use-cases/detect-missed-outs/` — pages candidates, pre-filters with the domain, then per
  employee: lock → sample clock → re-check → raise or close.
- `persistence/` — Drizzle/SQL inside `withTenant`; exception, audit and outbox in one transaction.
- `jobs/missed-out.processor.ts` — BullMQ queue, worker (concurrency 1) and the scheduler registrar.
- `events/published.ts` — `AttendanceExceptionRaised` (first producer); `AttendanceMissedOut`
  keeps PR 22's payload exactly.

### Business rules

- Due time uses the schedule snapshot PR 22 stored at clock-in (`scheduled_end`, the shift chosen
  by AT-Q5). If that shift ended at or before the clock-in it is not the session's shift and the
  no-schedule fallback (clock-in + 12 h) applies. Overnight shifts and DST are already resolved into
  UTC instants by PR 22; +4 h / +12 h / +16 h are elapsed durations.
- Boundaries are inclusive: exactly +4 h, +12 h and +16 h act.
- If the due time is at or after the 16-hour deadline, no suspected exception is raised; the
  session closes MISSED_OUT at 16 h.
- The job never touches `last_accepted_scan_at` / `last_result`: it is not a scan, so the
  5-minute dedupe keeps referring to the employee's last real scan.

### Schema

Migration `attendance-missed-out-indexes` (concurrent, no table change):

- `attendance_exceptions_one_suspected` UNIQUE on `(company_id, session_id) WHERE
  kind='SUSPECTED_MISSED_OUT'` — the database guarantee of MO-06, also used by the candidate
  page's "already suspected" probe.

The candidate page reads OPEN sessions through PR 22's `attendance_sessions_one_open`
(`(company_id, employee_id) WHERE status='OPEN'`): at most one row per employee, so sorting a
company's open sessions per page is cheap and no second partial index is needed (a second one also
competed with the board index in PR 22's plan test).

No new table, so no new RLS policy; the existing FORCE RLS policies of PR 22 apply.

### Events and audit

- `AttendanceExceptionRaised` `{exception_id, kind, session_id, employee_id, business_id,
  branch_id, clock_in, due_at, raised_at}` — no `notification_recipients` yet (TODO(spec), alert
  rules); the notifications consumer acknowledges it without sending.
- `AttendanceMissedOut` — PR 22 shape; `occurred_at` = 16-hour instant, `recorded_at` = detection.
- Audit: `attendance_exception` / `suspected_missed_out.raised`; `attendance_session` / `missed_out`
  with actor NULL (system).

## Test plan

Pure: every boundary (exactly +4 h, +12 h, +16 h, one millisecond before), schedule end vs
fallback, shift ended before clock-in, overnight end, DST spring/fall elapsed durations, due after
the deadline, already-suspected, candidate cutoff.
PostgreSQL (cloned per file, as `pospay_app`): raise once and idempotent re-run, 16-hour closure at
the deadline with detection kept, a concurrent PR 22 scan holding the State lock wins (both
orders), a later PR 22 close resolves the job's exception as CLOSED_LATE, cross-tenant isolation,
the unique index, EXPLAIN of the candidate page (`attendance_sessions_one_open`). Redis: delivery registers one id-only schedule per
company, re-delivery is idempotent, a scheduling failure is a retryable outcome, the scheduled run
calls the use case for that company only.

Gates: `pnpm check` without FORCE_COLOR; worker build; production startup with optional settings empty.

## Provisional owner questions

- MO-Q1 — job cadence: TODO(spec), recommended every 5 minutes (implemented).
- MO-Q2 — batch size: TODO(spec), recommended keyset pages of 100 candidates per query, all pages per run (implemented).
- MO-Q3 — which shift when the employee has two shifts that day: TODO(spec), recommended the shift the
  session started in, i.e. PR 22's AT-Q5 snapshot; a snapshot shift that ended before the clock-in
  falls back to clock-in + 12 h (implemented).
- MO-Q4 — schedule edited after clock-in: TODO(spec), recommended keep the clock-in snapshot (ADR-0028
  preserves schedule facts) (implemented).
- MO-Q5 — notification recipients for `AttendanceExceptionRaised`: TODO(spec), recommended to add them
  when alert rules (`AlertRulesPort`) ship; until then no alert is sent (implemented).
- MO-Q6 — missed-out exception status: PR 22 resolves a suspected exception as `MISSED_OUT` (RESOLVED);
  this job follows it. Recommended: keep. Correcting a MISSED_OUT session's times is spec 035 (PR 26);
  the session stays MISSED_OUT. PR 27 lists them.
- MO-Q7 — a session reaching 16 h with no suspected exception (due ≥ 16 h, or the job was down) is
  closed without creating one, as PR 22's scan path does. Recommended: keep.

## Success criteria

MO-01–MO-06 pass; never two SUSPECTED_MISSED_OUT rows per session; the job reads and writes only
inside `withTenant` of the scheduled company; no hours, pay or commission effect.
