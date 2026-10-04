# ADR-0032 — Attendance missed-out job: tenant discovery and lock protocol

Status: Accepted technical decision; cadence, batch size and shift choice are provisional owner questions (spec 029).
Date: 2026-10-04. Scope: spec 029, Phase 1 PR 24.

## Context

SPEC §7 needs a job that raises SUSPECTED_MISSED_OUT at shift end + 4 h (clock-in + 12 h without a
schedule) and closes MISSED_OUT at 16 h. A worker job has no session, and `pospay_app` cannot read
across tenants (ADR-0003 §3). The only cross-tenant reader is `pospay_dispatcher`, on `outbox` only.
ADR-0022 already solved the same problem for file retention: outbox delivery registers an
idempotent per-company BullMQ schedule, and each run works inside `withTenant(companyId)`.

## Decision

1. **Tenant discovery reuses ADR-0022.** When the worker delivers `AttendanceClockedIn`, it upserts the
   job scheduler `attendance-missed-out-<companyId>` (every 5 minutes, data `{ companyId }` only),
   outside any database transaction, then hands the event to the normal deliverer. A scheduling failure
   is a retryable delivery outcome. No new role, grant, `BYPASSRLS` path or global query is added.
2. **A worker `staff` module owns the job's writes** (`apps/worker/src/modules/staff`), shaped like the
   worker `files` module: pure domain, ports, persistence, one use case, one processor. It imports no
   other module; the API `staff` module keeps the scan path.
3. **Lock protocol = PR 22's.** Per employee, one `withTenant` transaction locks `attendance_states`
   first, re-reads the OPEN session, samples the injected Clock once, and decides with the domain.
   The candidate page is read without locks and only pre-filters. A scan that reached the lock first
   wins. Transactions are bounded at 15 s, longer than the scan's 10 s hold.
4. **Idempotency in the database.** A unique partial index allows one SUSPECTED_MISSED_OUT per session;
   the insert uses `ON CONFLICT DO NOTHING`, and only an inserted row writes audit and outbox. Closing
   is `UPDATE … WHERE status='OPEN'`. Re-runs, BullMQ retries and two workers converge.
5. **Due time uses PR 22's clock-in schedule snapshot** (`scheduled_end`, AT-Q5). A snapshot shift that
   ended at or before the clock-in falls back to clock-in + 12 h. Durations are elapsed time.
6. **Events.** `AttendanceMissedOut` keeps PR 22's payload (`occurred_at` = 16-hour instant,
   `recorded_at` = detection, AT-Q6). The job is the first producer of `AttendanceExceptionRaised`
   (ADR-0010); without alert rules it carries no recipients, so notifications acknowledge it unsent.
   The worker now knows `AttendanceClockedIn/Out/MissedOut`, so they are no longer parked.

## Consequences

Every company with at least one clock-in keeps a 5-minute schedule and one cheap indexed query per
run, even when idle; schedules are never removed automatically (a removal could race a new clock-in).
Clock-ins whose events were parked before this release register their company only when an operator
re-queues them or the next clock-in is delivered. The job never touches `last_accepted_scan_at`, so
the 5-minute scan dedupe still refers to the employee's last real scan. One new unique partial
index is created concurrently; candidates use PR 22's one-open index; no table or policy changes.
