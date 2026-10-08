# ADR-0037 — Not-clocked-in alert: tenant discovery and manager recipients

Status: Proposed (draft for PR 28; number provisional, renumbered at merge).
Date: 2026-10-08. Scope: spec 036, Phase 1 PR 28. Owner decisions: spec 036 NC-Q1–NC-Q13 (Waleed, 2026-10-08).

## Context

PR 28 must detect, 20 minutes after a scheduled shift start (PRD D-47), that the employee has not clocked in, record
it once, publish `ShiftNotClockedIn` (ADR-0010) and — by the owner's NC-Q1 decision — deliver it **now** as an
in-app notification to the managers of the shift's branch, before the alert-rules screen (PR 62) exists.

Two things are not covered by an existing decision:

1. **Tenant discovery.** A worker job has no session and `pospay_app` cannot read across tenants (ADR-0003 §3).
   ADR-0032 registers a per-company schedule when `AttendanceClockedIn` is delivered, which misses a company whose
   employees have shifts but nobody has clocked in yet — the pilot's first morning. Schedule writes publish no outbox
   event (ADR-0024).
2. **Recipients.** SPEC §3 says the emitter reads `AlertRulesPort` and puts recipients in the event, but that port
   ships with PR 62. The worker has no identity module, and no port lists "the managers of a branch".

## Decision

1. **Discovery on `CompanyCreated`, repair on `AttendanceClockedIn`.** The worker `staff` module already consumes `CompanyCreated` (ADR-0031, document
   type seeding). On that delivery it also upserts the BullMQ job scheduler `attendance-not-clocked-in-<companyId>`,
   every 5 minutes, job data `{ companyId }` only, outside any database transaction; a Redis failure is a retryable
   delivery outcome (ADR-0022/0032). Delivery of `AttendanceClockedIn` also upserts the same scheduler, repairing
   lost Redis schedules or a missed replay without a second scheduler identity. Registration stays outside
   transactions and before database consumer dedupe. No new event, role, grant or cross-tenant query.
   **Existing companies** get a one-time, controlled operator replay of their `CompanyCreated` event before the
   release is relied on, only after every worker has fully rolled out (the spec 033 MO-Q4 precedent of 2026-10-05).
   The operator procedure is in [the runbook](../runbook.md). Schedules are never removed automatically.
2. **Recipients through a read port.** Worker `staff` defines `BranchManagerRecipients` in its own `ports/`:
   for one branch, the user ids holding an **active** membership of the company (not removed, not expired) whose
   system role is `owner`, `general_manager`, `business_manager` or `branch_manager` and whose
   membership scope (COMPANY / the branch's BUSINESS / the BRANCH) covers that branch (NC-Q2), excluding the absent
   employee's own user. The adapter in
   `apps/worker/src/modules/staff/persistence/` calls a read-only function exported from a new minimal worker
   `identity` module's `index.ts` (the same shape as the worker `tenancy` module's `businessTimeZone`), on the
   caller's `withTenant` transaction. The method is `forBranch(tx, companyId, businessId, branchId, at, roles)`:
   `companyId` keeps the membership predicate a constant for the scope indexes, `at` is the clock sampled after
   the attendance lock, and `roles` come only from `interimNotClockedInRule`. Each scope arm is fenced with
   `OFFSET 0` so the planner uses the company/scope indexes instead of the global role index. It adds **no import arrow** —
   `staff → identity` already exists (`module-map.md` §2) — and one §3 port row. The machine-readable map records
   the reads under `reads:` (the generated YAML has no `ports:` key). The same staff-owned port calls worker
   tenancy's public `companyOpen` read before candidate paging and again under the employee lock, on the
   caller's tenant transaction: a company with `deleted_at` set is skipped entirely, including recipient-free
   notices. Identity's recipient query reads only identity-owned memberships and roles; it relies on this
   locked caller check and never joins tenancy's `companies` table (CLAUDE.architecture.md §6.2/§7.3).
   Branch names use a second port, decision 6.
3. **Interim fixed rule, replaced by PR 62.** Until PR 62, the alert is always on, its delay is 20 minutes, its
   recipients are the step-2 managers and its only channel is IN_APP. No email (NC-Q4); no WhatsApp; no employee
   notice (NC-Q3 — the employee's own push notice ships with PR 28b). The rule is one function in the worker
   `staff` module, the single place PR 62 replaces with `AlertRulesPort`.
4. **A dedicated in-app template.** `packages/notifications` gains the `shift_not_clocked_in` template (ar/en).
   Safe parameters carry `employee_name_ar` / `employee_name_en`, `branch_name_ar` / `branch_name_en`, and the
   local shift start `HH:MM`, formatted with `staff_schedules.timezone` as saved by ADR-0024; a later change to
   the branch timezone cannot relabel the stored start. Display names reject a URL, a phone number and a bare 4–8 digit code, and allow a
   year inside a name. Phone detection also covers local numbers, separated digits and Arabic digits. Missing or
   rejected Arabic falls back to safe English; rejected English uses a generic label. The translated generic
   labels are injected at the staff composition root, so managers are still alerted without an i18n dependency
   in the use case. The admin bell renders the viewer's current UI locale;
   the stored row locale stays the default for consumers without a UI. `generic_notice` is unchanged. Parameters
   are names and a time only — never a phone or a document.
5. **Recipient groups.** `notificationRequest` accepts at most 100 recipients. The notice transaction writes one
   outbox event per stable, deduplicated group of at most 100 user ids. A company with 101 managers still alerts
   every manager, and the once-only notice is not committed without those events. A failure while building or
   appending any group rolls back the notice, audit and all groups; redelivery cannot duplicate inbox rows.
6. **Due-shift lower bound and branch read.** The candidate page requires
   `starts_at > now - interval '16 hours'` because `staff_schedule_shifts_duration` already forbids a longer
   shift, so a shift still open cannot have started earlier. The locked read does not join `branches` or
   `businesses`. Worker `staff` defines `BranchPlaceReader`; its adapter calls `branchPlace` from the worker
   `tenancy` module's `index.ts` for both names and the effective timezone. `staff → tenancy` already exists.
   Only the names are used for the notice; its display timezone comes from the schedule. The due page excludes
   existing notices through `NOT EXISTS` on `(company_id, employee_id, shift_starts_at)`, supported by the ledger's
   unique index, before any attendance lock. The planner may choose a tenant-indexed hash anti-join for small
   ledgers. The insert conflict guard still handles concurrent workers.
7. **Once-only key and lock order.** The notice table's UNIQUE `(company_id, employee_id, shift_starts_at)` is the
   dedupe key (shift rows are replaced on re-save, ADR-0024), and each decision runs after locking the employee's
   `attendance_states` row, the same first lock as scans and the missed-out job (ADR-0028/0032).
   Then lock the same `(company_id, id)` employee row `FOR SHARE` before re-reading the shift, holding it through notice/audit/outbox commit to serialize with schedule writers' `employees FOR UPDATE`.
8. **Leave and presence.** An approved `FULL_DAY` leave excuses any shift with `from ≤ working_date ≤ to`,
   including overnight shifts. All approved leaves are also fetched by instant overlap and participate in the
   contiguous-leave chain: partial leave until midnight followed by FULL_DAY leave on the next day excuses an
   overnight shift. Presence is evaluated at the alert deadline (NC-Q13): `clock_in <= alertAt` and either
   `status = 'OPEN'` or `clock_out > alertAt`, even before the two-hour window and even if closed before the run.
   The OPEN probe uses `attendance_sessions_one_open`; the historical probe uses the company/employee prefix
   of `attendance_sessions_employee_date_idx`, without an artificial working-date cutoff.
9. **Failure visibility.** Each failed candidate reports the safe error type/code and immediate cause type/code
   through the diagnostics port, without messages, stack, query parameters or employee data. Other candidates
   continue and any failure still makes the run retryable; repeated failures remain visible in worker logs.

## Consequences

Every company keeps a 5-minute schedule. An idle run performs a company-eligibility read and one bounded indexed
candidate-page read; it takes no employee locks when there are no due unnotified shifts. Each remaining candidate
needs a separate locked transaction and fresh eligibility, leave and attendance reads; ALERT additionally reads
recipients and writes notice/audit/outbox. Already-noticed shifts still incur ledger anti-join work, but no
per-candidate lock or transaction. Closed companies retain their schedules: deleted companies stop at the
eligibility read; otherwise inactive (deleted or contract-ended) employees record nothing. A company created
before this release needs its replay for day-one coverage; a later clock-in also repairs registration. Recipients are resolved at detection time, so a manager added
after the alert does not receive it. PR 62 must replace the interim rule (decision 3) and keep decisions 1, 2 and 7.
Staff push (PR 28b) and the shift-ending reminder (PR 28c) are separate decisions with their own ADRs.
