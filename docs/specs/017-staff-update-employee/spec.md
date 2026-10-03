# Feature Specification: Update employee and branch history

**Created**: 2026-10-03  
**Status**: Implementation slice; owner decisions recorded 2026-10-03  
**Input**: Phase 1 plan row 9, SPEC §§3–4, 7, 11; spec 013 and ADR-0021.

## User Scenarios & Testing

An authorised manager lists employees in the selected business, opens an employee,
edits the existing create fields and working branches, and saves against the revision read.

### Acceptance scenarios

- UE-01: names, role, hire date, contract end, primary branch and user link can each change.
- UE-02: link/unlink never changes access. Only active company membership permits a link;
  unknown, foreign and inactive users receive the same EMPLOYEE_USER_LINK_UNAVAILABLE.
- UE-03: duplicate names and future hire dates remain allowed. Contract end before hire is refused.
- UE-04: an employee has at least its primary branch in the active set. Attach creates a new
  EmployeeBranch; detach closes the existing row; reattach creates another row, preserving history.
- UE-05: two saves based on one revision produce one success and EMPLOYEE_REVISION_CONFLICT (409).
- UE-06: grants are checked on the persisted business and every current and requested branch.
  A source branch denial hides the employee like a missing record; a target denial refuses the move.
  Branch-only ALLOW works. Other tenant/business, deleted and missing employees cannot be updated.
- UE-07: employee, attachments and attributable before/after audit commit together or all roll back.
- UE-08: cursor-paginated list and detail expose only employees whose whole active scope is readable.
- UE-09: admin uses the existing create fields, bilingual feedback and manual server pagination.

## Requirements

Update one employee only; business and company identity remain immutable. Existing owner decisions
in spec 013 apply unchanged: no access grants, duplicate names/future hires allowed, ordered contract
dates, and one active employee per user per business. No salary, soft deletion, attendance, schedule,
PIN, credentials or membership mutation. Every successful change writes an allowlisted audit snapshot.

### Key entities

Employee remains the HR record. Its revision is a concurrency token, not a financial revision.
EmployeeBranch remains date-only history; the configured open-ended attachments have `to IS NULL`.
This configuration projection is not an attendance eligibility query: PR 22 must read dated intervals,
including a former attachment whose future `to` date has not yet arrived.

## Slice design

### Contract and history dates

PATCH `/v1/businesses/{businessId}/employees/{employeeId}` accepts all editable create fields,
`expected_revision`, a unique nonempty `branch_ids` set and `branch_effective_date`.
The manager supplies an explicit Gregorian date for changed attachments; no server/browser timezone
is silently substituted. Existing attachments' `from` values are never rewritten when hire date changes.
An end at or before its existing start is structurally invalid and refused as EMPLOYEE_BRANCH_DATE_BEFORE_START.
**UE-Q1 — owner decision 2026-10-03**: the manager enters attach/detach dates as Gregorian calendar dates.
Intervals are start-inclusive and end-exclusive (`from <= date < to`, with no upper bound when `to` is null).
A move on the 15th stores the old attachment's `to` and the new attachment's `from` as the 15th:
the old branch covers up to the 14th and the new branch covers from the 15th. Future-dated moves are allowed.
The update records the dated history immediately; no clock or timezone rule rejects a future effective date.

### Historical records and open sessions

**UE-Q2 and UE-Q3 — owner decision 2026-10-03**: record each accepted change with its audit and do not
rewrite the past. Hire-date, role and user-link corrections leave existing attendance and attachment
history unchanged. Branch moves close the current attachment and append the new one without changing
earlier attachment rows or their starts. An existing open shift/session stays as it is; the new rules apply
from the next clock-in, respecting the entered branch effective dates. Attendance-side details, including
dated branch eligibility and the clock-in snapshot, belong to PR 22 and are not implemented in this slice.

### Schema changes

- employees: additive `revision integer NOT NULL DEFAULT 1`, positive check. Existing indexes cover business/id lists.
- employee_branches: partial unique `(company_id, employee_id, branch_id) WHERE to IS NULL`;
  no new table or foreign key. Creating migration includes this index.
- Separate custom migration: FORCE RLS UPDATE policies with tenant USING/WITH CHECK; column grants
  only for editable employee data/revision and attachment `to`. No DELETE or re-home grants.

### PR #83 review: interval integrity

Every new attachment is checked against the employee's full history for that branch, including closed
intervals. An open-ended attachment starting October 10 cannot follow an interval ending October 15;
it returns EMPLOYEE_BRANCH_HISTORY_OVERLAP (409), without changing revision, history or audit.
Adjacent intervals are allowed: an interval ending October 15 and another starting October 15 do not overlap.
Concurrent API saves still use the company → memberships → employee lock order and optimistic revision.

New migrations after 0042 add the PostgreSQL contrib dependency `btree_gist` and a tenant-qualified GiST
exclusion constraint over `(company_id, employee_id, branch_id, daterange(from, to, '[)'))`. This also
refuses overlaps from concurrent direct database writers; the partial open-attachment index alone cannot.
Both its exclusion violation and an overlapping duplicate open attachment map to the named 409 above.
An independent CHECK requires `to IS NULL OR to > from`; a BEFORE UPDATE trigger permits only closing
an open interval. A closed interval cannot be updated or reopened, including by `pospay_app` under
the existing same-company UPDATE grant. Guard violations map defensively to
EMPLOYEE_BRANCH_HISTORY_IMMUTABLE (409). Existing migrations 0041 and 0042 remain unchanged.

The new constraints validate existing data without rewriting it. Migration refuses pre-existing empty,
reversed or overlapping histories; any repair requires a separate reviewed data correction. Adding the
exclusion constraint takes a table lock and builds its GiST index, so schedule the migration accordingly.

### API and permissions

PR #83 branch privacy correction: after authenticating the selected company and authorising the
persisted employee scope, resolve every requested attachment and primary branch in that company.
Each must belong to the employee's persisted business. Missing, other-business and other-company
branches share the exact EMPLOYEE_BRANCH_NOT_FOUND (404) envelope, without branch identifiers or
mismatch details. This check precedes target permission, staff feature, revision, primary-set,
contract and user-link diagnostics. Valid branches still require live management access; DENY wins.
Create uses the same rule for its primary branch before permission/feature and employee diagnostics.
Input shape validation and inaccessible/missing employee protection remain the entry prerequisites.

GET collection returns EmployeePage (bounded id cursor; access filtering precedes LIMIT, so cursors name only visible employees). GET detail extends the existing employee response with revision
and sorted active branch ids. PATCH returns the same detail. Contracts are strict Zod; OpenAPI paths
remain in staff-openapi.ts and both generated clients are refreshed.

Each route declares @Authenticated once and SelectedCompanyGuard. Staff-owned read guards/readers
check manage:employees:business at persisted branches and staff feature, like PR 8 detail. Write
rechecks these inside withTenant after company FOR NO KEY UPDATE → memberships by id → employee
FOR UPDATE. Membership locks remain held through link eligibility, optimistic save, history and audit.
Permission changes and employee updates therefore share PR 7's lock order. Bulk scope reads use the
existing staff → identity boundary; no per-employee permission-query loop or cross-context SQL join.

Errors include existing create refusals, NOT_FOUND, FEATURE_DISABLED, FORBIDDEN,
EMPLOYEE_REVISION_CONFLICT (409), EMPLOYEE_PRIMARY_BRANCH_REQUIRED (400),
EMPLOYEE_BRANCH_DATE_BEFORE_START (400), and TRANSACTION_RETRY_REQUIRED.
Branch history conflicts also return EMPLOYEE_BRANCH_HISTORY_OVERLAP or EMPLOYEE_BRANCH_HISTORY_IMMUTABLE (409).
No money/stock effect: no Idempotency-Key. No update event is named by SPEC §3: no outbox event.

### Test plan

Domain: branch set/primary/history/date/revision and contract ordering; create rules remain reused.
Contracts: full replacement validation, unknown claims, unique branches, real dates and revision bounds.
Integration: UE-01…UE-08, future moves with shared exclusive/inclusive boundary dates,
race conflict/unique links, history reattachment, reported October 15/October 10 overlap and concurrent
reattachment, adjacent intervals, direct concurrent database overlaps, immutable closed history as pospay_app,
source/target DENY,
HTTP create/update equality for missing, other-business DENY and other-company branches, invalid
branch diagnostic priority, and successful own-business branch creation/moves,
branch-only ALLOW, tenant/business isolation, inactive links, feature revocation, no access mutations,
audit before/after and rollback. RLS negatives prove UPDATE isolation/column grants/immutable history.
Queries: exact result shape, cursor boundaries, authorization filtering and EXPLAIN ANALYZE index assertions.
UI: shared fields, checkbox/date edits, errors/conflict recovery, server page navigation, workspace isolation.
Gates: pnpm check (FORCE_COLOR unset), API/admin builds; production API/worker smoke for wiring changes.

## Success Criteria

Every accepted edit has one consistent employee state and audit. Concurrent editors cannot silently
overwrite. Every former branch attachment stays available in history. A denied branch never becomes
an avenue to read or move its employees. Both languages expose the same editing and paging controls.

## Assumptions

Admin is online; no npm dependencies added. PostgreSQL requires the btree_gist contrib extension
documented in ADR-0021. Revisions start at 1 for existing records. An unchanged save
returns the existing revision without an audit row because it changes nothing. List paging uses stable
UUID ordering; page sizes bound visible rows after SQL scope filtering.

## Owner decisions and remaining scope

UE-Q1, UE-Q2 and UE-Q3 are resolved by the owner decision 2026-10-03 above. No owner question remains
for this slice. PR 22 implements the attendance-side details under these decisions; it must not rewrite
past attendance or mutate an open session because an employee was edited. Removing the last branch
remains refused by the required primary branch invariant.
