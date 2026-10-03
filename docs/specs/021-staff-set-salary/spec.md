# Feature Specification: Set monthly basic salary

**Created**: 2026-10-03
**Input**: Phase 1 row 10, SPEC §§3–6 / V3, specs 013/017, ADR-0010/0021; owner decisions 2026-10-03.

## User scenarios and acceptance

- SS-01: owner records monthly BASIC salary in KWD for any real Gregorian date, past or future. Zero is valid; allowances/overtime are excluded.
- SS-02: amount is nonnegative numeric(14,3), transported as a decimal string, handled as bigint mills. Reason is trimmed and mandatory, 1–500 characters.
- SS-03: one entry per tenant/employee/date. A repeated date replaces amount/set_by and increments the entry revision, including unchanged amounts. No delete.
- SS-04: row, before/after audit with reason and actor, SalaryChanged outbox and idempotent response commit together or roll back together.
- SS-05: concurrent writers serialize under company → ordered memberships → employee locks. Both revisions/events commit in order; duplicate request keys replay without another revision; changed request/key returns 422.
- SS-06: read: salaries are owner-only by default or explicit personal ALLOW. read:salaries:business and manage:salaries:business have no role bundles. DENY wins; role grants to nonowners cannot grant salaries.
- SS-07: persisted primary and all open branch attachments are authorised. Missing/deleted/foreign/inaccessible employee and unreadable salary history return identical NOT_FOUND. Feature checks occur after access.
- SS-08: bounded history uses descending effective_from cursor and returns current per-date revisions. Admin edit panel renders salary section only after a permitted read, with bilingual history, date, KWD 3-decimal amount and reason form.
- SS-09: technical logs redact salary containers and all amount fields, including nested audit/event objects; database audit retains amounts.

## Slice design

### Schema

employee_salaries: company_id/id composite PK, business_id/employee_id tenant-qualified FK,
effective_from date, amount numeric(14,3), set_by global user FK, revision positive integer, reason.
Unique company/employee/effective_from supports the history cursor. Index company/business and set_by.
Separate FORCE RLS SELECT/INSERT/UPDATE policies; column-limited UPDATE; no DELETE or rehome.

### API and permissions

GET /v1/businesses/{businessId}/employees/{employeeId}/salaries: SalaryHistoryPage (items, next_cursor, can_manage).
POST same path: SetSalaryInput (effective_from, amount, reason), mandatory Idempotency-Key, 200 EmployeeSalary.
One @Authenticated declaration plus SelectedCompanyGuard each; persisted resource access in the transaction.
Identity public salary read boundary follows ADR-0021; owner effective grants derive from active owner membership,
never role_permissions. Other callers require per-person override; no default role bundle is seeded.

### Events

SalaryChanged payload: employee_id, effective_from, amount decimal string, per-entry revision.
Employee aggregate orders concurrent events. Commissions selects latest effective_from ≤ last period day,
handles closed-period corrections and converges by revision in later PRs; staff does not read statements.

### Tests and gates

Domain amount/reason/date/revision bounds; strict contract tests. Integration replacements, concurrent revisions/event
sequence, rollback, replay/mismatch, grant/deny/expiry/feature/privacy HTTP envelopes. RLS cross-tenant read/write/update,
foreign employee references and no DELETE/rehome grants. History result shape, cursor and EXPLAIN ANALYZE index.
Admin bilingual form/history/access/refresh tests; logger nested amounts versus preserved audit snapshots.
pnpm check with FORCE_COLOR unset; touched app builds; production API/worker optional-empty smoke.

## Open questions for the owner

SS-Q1: a manage-only personal grant without read must not reveal salary existence. Pending explicit policy,
require both read and manage for writes (TODO(spec) in salary access). Recommendation: grant both for salary editors.
No npm dependency added.
