# Feature Specification: Create employee

**Feature Branch**: `feat/p1-08-create-employee`
**Created**: 2026-10-03
**Status**: Owner decisions settled; implementation and verification in this slice
**Input**: Phase 1 plan row 8, SPEC §§2–4, 11–12, ADR-0003/0019, PR 7 final roles.

## User Scenarios & Testing

### User Story 1 — Register an employee (Priority: P1)

An authorised manager registers an employee in a business and chooses the primary branch.
The English name, role and hire date are required; Arabic name, contract end and existing user link are optional.
This gives later staff slices an employee record without issuing credentials or financial records.

**Independent Test**: create an employee, read the persisted record and primary-branch attachment.

**Acceptance Scenarios**:

1. CE-01: a valid creation saves one employee, one attachment from hire date and one audit row with the real actor.
2. CE-02: missing/foreign business or branch, or branch in another business, saves nothing.
3. CE-03: no permission, inactive membership, DENY or disabled staff feature is refused.
4. CE-04: optional user link requires an active membership in this company; unknown, foreign-company and inactive users share EMPLOYEE_USER_LINK_UNAVAILABLE (400), without SQL diagnostics.
5. CE-05: a failed attachment/audit rolls back the employee too.
6. CE-06: employee detail cannot cross tenant or business; deletion markers are excluded. Permission is evaluated at the persisted business and primary branch; branch DENY wins and a branch ALLOW suffices. Inaccessible and missing records share NOT_FOUND (404).
7. CE-07: concurrent links to the same user/business yield one creation and one EMPLOYEE_USER_ALREADY_LINKED refusal, with no partial writes.
8. CE-08: duplicate names and future hire dates succeed; contract end before hire returns EMPLOYEE_CONTRACT_END_BEFORE_HIRE (400).
9. CE-09: the same user can be linked in different businesses; an unlinked or soft-deleted employee does not reserve an active user/business link.

### Edge Cases

Names are trimmed with the existing 255-character limit. Only the final thirteen human roles are accepted,
never the technical Device role. Dates are real Gregorian date-only values, not UTC instants.
Primary branch must belong to the business in the verified company. No salary, update, import, PIN,
phone binding, passkey or membership administration is implemented.

## Requirements

- FR-001: save the SPEC employee fields and primary EmployeeBranch atomically.
- FR-002: names follow CLAUDE.md; optional fields persist as null.
- FR-003: evaluate manage:employees:business server-side and recheck active grants in the write transaction.
- FR-004: save an allowlisted audit snapshot, with no contact/credential/salary data.
- FR-005: preserve tenant and business boundaries through validation, FKs and FORCE RLS.
- FR-006: create form uses bilingual labels, the existing workspace selector and generated client.
- FR-007 (PR #79 review): resolve user-link eligibility through a company-scoped identity read inside the existing write transaction, after the company and ordered membership locks. Never probe global user existence.
- FR-008 (PR #79 review): every single-employee read resolves the persisted scope before checking effective grants. No-access and missing records are indistinguishable; staff feature enforcement remains mandatory.

### Key Entities

Employee is an HR record in one business with a primary branch and an optional global user reference.
EmployeeBranch records its dated branch attachment. A role_code is HR metadata; memberships remain access authority.

## Slice design

### Business rules

EmployeeBranch.from = hire_date, to = null. A user reference never changes their phone or credentials.
PR #79 review correction: the linked user must have a started, unexpired membership in this company,
at any company/business/branch scope. Identity owns this boolean read; staff neither joins nor writes
memberships. The existing PR 7 locks are retained through eligibility, insert, audit and commit;
membership activity is evaluated after any lock wait. Unknown and foreign users receive the same 400 envelope.
No event is named for create-employee in SPEC §3, so none is emitted. This is not a money/stock effect;
Idempotency-Key is not required. Retrying an unlinked creation can create a second record; do not auto-retry.

**owner decision 2026-10-03** settles CE-Q1–CE-Q5:

- Creation grants no access, membership or permission. Access is a separate explicit step on the permissions screen.
- Duplicate names are allowed, including within the same business.
- Future hire dates are allowed; hire_date remains a Gregorian date-only value.
- Contract end must be on or after hire_date; an earlier end returns EMPLOYEE_CONTRACT_END_BEFORE_HIRE (400).
- At most one active employee may reference a user within each business. The same user can be an employee in different businesses.
  An active record has deleted_at IS NULL. A partial unique index on (company_id, business_id, user_id),
  restricted to active, linked employees, enforces this rule even for concurrent/direct database writes.
  A conflicting link returns EMPLOYEE_USER_ALREADY_LINKED (409); the entire creation rolls back.

### Schema changes

| Table | Columns | RLS / grants | Indexes | FKs |
| --- | --- | --- | --- | --- |
| employees | company_id, id, business_id, primary_branch_id, user_id?, name_ar?, name_en, role_code, hire_date, contract_end?, deleted_at?, created_at | SELECT/INSERT only, FORCE | company/business/id; company/primary_branch/id; company/business/user; user_id; partial unique active company/business/user | company root; company/business; company/business/primary_branch; global user |
| employee_branches | company_id, id, business_id, employee_id, branch_id, from, to? | SELECT/INSERT only, FORCE | company/employee/from; company/branch/from | company/business/employee; company/business/branch |

Add a tenant/business-qualified branch candidate key. Add the ADR-0003 §4.2 tenant-qualified employee FKs
on memberships and cashier_pins; do not change holders or grant memberships. Existing orphan employee refs require
a later owner-approved repair; NOT VALID enforcement protects new writes without inventing historical employees.

### API contract

- POST `/v1/businesses/{businessId}/employees`: strict CreateEmployeeInput, 201 Employee.
- GET `/v1/businesses/{businessId}/employees/{employeeId}`: Employee or 404, persisted detail query.
- Both require `manage:employees:business` and the `staff` feature; company comes from the verified principal.
- GET uses one `@Authenticated` declaration plus selected-company and employee-detail guards: active company membership first, then the guarded detail query checks permission at the persisted primary branch. The query's identity read also enforces the staff feature after permission succeeds. This avoids a business-only precheck rejecting branch ALLOW, or exposing branch-DENY records. Inaccessible, foreign-tenant/business, deleted and missing employees return the same 404 envelope to an active company member; callers without company membership are uniformly refused before tenant lookup.
- Input: primary_branch_id, name_en, optional nullable name_ar/user_id/contract_end, role_code, hire_date.
- Errors: EMPLOYEE_BUSINESS_NOT_FOUND, EMPLOYEE_BRANCH_NOT_FOUND, EMPLOYEE_BRANCH_BUSINESS_MISMATCH,
  EMPLOYEE_USER_LINK_UNAVAILABLE (400), EMPLOYEE_CONTRACT_END_BEFORE_HIRE (400), EMPLOYEE_USER_ALREADY_LINKED (409),
  plus standard access/validation/retry envelopes.

### Permissions

Catalog only: manage:employees:business. Default grants remain deferred to PR 7a, including owner (owner decision 2026-10-03).
Recommendation: owner/general_manager/business_manager enabled within authorised business;
branch_manager optional after a branch-scoped code exists; other roles disabled.

### Events

Published/consumed: none for this step.

### Test plan

Pure domain tests: business/branch identity, allowed future hires and contract-end ordering; valid date/name/role contract tests.
Postgres integration CE-01…CE-09, duplicate names, future hires, unchanged memberships/permissions,
audit actor and rollback, cross-business links, concurrent same-business links and named 409 mapping.
Direct DB negatives prove partial uniqueness and permit different businesses/tenants, null links and soft-deleted predecessors.
RLS negatives for both tables: SELECT/INSERT/context/FKs, immutable runtime grants, other roles denied.
Detail query result shape + EXPLAIN ANALYZE index assertion. HTTP access/validation/error coverage.
PR #79 regressions: unknown versus foreign user links have identical 400 envelopes and no writes;
inactive/future memberships fail, active memberships in another business of this company succeed,
and an ended target membership after a lock wait is refused. Business ALLOW + branch DENY,
branch-only ALLOW, other tenant/business, no grant, missing employee and disabled feature are covered.
UI submission, bilingual labels, invalid input, failure and workspace replacement tests.
Acceptance: pnpm check, API/admin/POS builds, regenerated OpenAPI and both clients.

## Success Criteria

- A valid request yields exactly one employee, one primary attachment and one attributable audit entry.
- Every refusal leaves all three unchanged.
- A manager cannot read or create in another tenant or business.
- Both supported languages offer the same required/optional fields and feedback.

## Assumptions

Admin is online. Optional user must already exist; global identity is not queried by staff.
No new dependencies. Staff provider wiring changes; built API/worker production startup is verified with optional settings empty.

## Open questions for the owner

None for CE-Q1–CE-Q5; resolved by owner decision 2026-10-03. PR 7a owns default grants; the recommendation above remains deferred.
