# Staff schedules and shift templates

Created: 2026-10-03. Phase 1 PR 16; extends specs 013/017 and ADR-0021.

## Scope and owner decisions

Managers maintain one employee/branch/week schedule and business-owned weekly templates.
Weeks start Saturday and end Friday in the branch timezone: branch override, business
fallback, Asia/Kuwait default, using PR 19's workspace reader. Days are indexed 0=Saturday
through 6=Friday; times are local HH:mm. At most two shifts may start on a day. End <= start
means the following day; each shift is at most 16 hours. Intervals are half-open, so touching
shifts do not overlap. Friday overnight ends on the next week's Saturday but retains Friday
as its working_date. UTC start/end instants and the timezone used are persisted for PRs 22/24.
Lateness grace is 10 minutes, reported only. Missed-out detection uses scheduled end + 4h;
these attendance computations belong to later PRs.

Past-day edits are permitted only with a nonempty reason. Every actual schedule/template write
has attributable before/after audit in the same transaction. Today/future edits are audited too.
Only changed start days determine whether a reason is required, including removed shifts.
Attendance reports recompute against the edited schedule in later PRs; this slice never changes attendance.

Defaults explicitly applied: employees must be attached at the shift's start day using
EmployeeBranch.from <= day < to; no shift before hire, after contract end, or for a deleted
employee. Shifts cannot overlap across branches or week boundaries, compared as UTC instants.
Changing branch assignments later preserves schedule history; subsequent writes validate current history.
Even an empty week requires at least one eligible day where employment and the target branch
attachment overlap. Check every employee/week before revision or existing-copy conflicts.
Unknown, inaccessible and week-ineligible employees share the same NOT_FOUND/404 response.
Inaccessible branches/businesses likewise share the unknown-resource status, code and body,
for reads and writes. Compare unchanged past shifts by their six canonical values, independent
of JSON key order and shift array order; only actual past-day changes require a reason.

Templates have required English and optional Arabic names and a weekly pattern. Applying to
explicit employees and up to 12 distinct Saturday weeks creates independent concrete copies.
An archived template cannot be applied. Edits/archive use optimistic revisions. Applying is
atomic across all targets. Existing schedules, including empty weeks, yield
SCHEDULE_APPLY_CONFLICT (409) with employee/branch/week conflicts in the authorised target scope.
Explicit replace requires a reason and audits each replacement. TODO(spec) SC-Q1: confirm
this refuse/explicit-replace policy; recommendation: retain it.

TODO(spec) SC-Q2: timezone transitions with nonexistent or ambiguous local clock times need
an owner policy. Recommendation: refuse those times with SCHEDULE_LOCAL_TIME_INVALID until
an explicit offset-selection UX is approved; ordinary unique local times work. The implementation
must not silently choose an occurrence or move the entered time.

## Contracts and API

All routes require selected-company authentication, staff feature, and live scoped permission.
Writes lock company, ordered memberships, then employee/template rows; versions are checked
after waits. No salary/contact data or another branch's shifts appear in responses.

- GET /v1/businesses/{businessId}/branches/{branchId}/schedules?week_start&cursor&limit:
  cursor-paginated employees attached at any day of this week, including employees without
  a schedule; rows contain employee names and this branch's schedule or null, plus Sat..Fri dates.
- GET/PUT .../schedules/{employeeId}?week_start (GET): employee's branch week.
  PUT body: week_start, expected_revision (0 creates), shifts, optional reason.
  Stale version returns SCHEDULE_REVISION_CONFLICT (409).
- GET/POST /v1/businesses/{businessId}/shift-templates: cursor list / create.
- PATCH .../shift-templates/{templateId}: names + shifts + expected_revision.
- POST .../{templateId}/archive: expected_revision; archive is retained, never soft-deleted.
- POST .../{templateId}/apply: branch_id, employee_ids, weeks (<=12), replace=false, reason?.
  Returns concrete copies. Temporary synchronous cap: employee count × week count <= 20,
  while preserving the 12-week maximum. Exceeding it returns SCHEDULE_APPLY_BATCH_TOO_LARGE
  (422), before any schedule write. No automatic splitting or retry.
  This named refusal also covers more than 20 distinct employees in one valid week;
  contract parsing does not turn the employee-count limit into VALIDATION_FAILED/400.
  TODO(spec) SC-Q3: confirm this temporary technical cap of 20 employee-week copies.
  Recommendation: keep it until a BullMQ application path supports larger atomic selections.
  The initial 20 employees × 12 weeks × 14 shifts benchmark took 897 ms, above CLAUDE.md's
  200 ms boundary. That larger batch is refused, not served synchronously. The worker path
  is a follow-up under the explicitly allowed API/domain/tests/minimal-grid PR cutoff.

Permissions: read/manage:schedules:branch; read/manage:schedules:business for templates.
Default branch bundles: owner/general_manager/business_manager/branch_manager read+manage,
within membership scope. Business template bundles: owner/general_manager/business_manager.
Staff own-schedule access is deferred to the staff-app PR. DENY wins; branch-only ALLOW can
manage branch schedules but cannot grant business template management. No event is named for
this step in SPEC §3, so no event is introduced. No money/stock effect or Idempotency-Key.

## Persistence and tests

staff_schedules: tenant/business/employee/branch/week, timezone, revision.
staff_schedule_shifts: tenant-qualified schedule FK, employee, start day/local times, UTC interval.
staff_shift_templates: tenant/business/names/pattern/revision/archived_at.
Tenant-qualified PK/FKs, FORCE RLS, precise runtime grants and list/FK indexes in creating migration.
Employee-wide interval exclusion is the database backstop for overlap across branches/weeks.

Acceptance: pure date/week/overnight/split/overlap/duration/timezone tests (including Fri→Sat),
Postgres writes/audit/rollback/concurrency/template-copy tests, scoped HTTP refusals,
negative RLS tests for all tables, query contract shapes and EXPLAIN ANALYZE index assertions.
Minimal admin branch grid and edit dialog, generated client, ar/en labels, packages/ui, sidebar.
If this exceeds one reviewable PR, template administration/apply dialogs follow separately.
pnpm check with FORCE_COLOR unset, API/admin builds and production API/worker startup proof.
No new npm dependencies; reuse the installed btree_gist extension.
