# ADR-0021 — Employee creation scope reads

- Status: Accepted technical implementation of PR 8; no new business grant policy.
- Date: 2026-10-03

## Context

Staff needs the branch's business and must recheck active employee-management access
inside the write transaction. Existing staff → tenancy/identity import arrows permit these reads,
but their named surfaces must be declared. Staff must not join or write their tables itself.

## Decision

Expose tenancy.employeeWorkplace and identity.lockEmployeeCreationAccess as narrow public reads.
The staff-owned adapter consumes them on its existing tenant transaction. Identity retains the PR 7
company NO KEY UPDATE → ordered membership UPDATE lock protocol and samples decision time afterwards.
No membership is created or modified; the employee role is metadata, never an authorization grant.
PR #79 review extends the same staff → identity read boundary with employeeUserLinkAvailable:
the user must have an active membership in this company, checked after the existing ordered locks
and inside the same transaction. Unknown and foreign-company users share one refusal; no global user lookup.
readEmployeeDetailAccess evaluates effective permission at the persisted business/primary branch,
then the staff feature. A selected-company guard precedes the resource guard and guarded detail query;
GET declares @Authenticated once because a business-only @Require would reject branch-only ALLOW.
All single-employee query callers supply the identity reader; inaccessible and absent rows both return null.
The read-side interface lives beside its query, following WorkspaceNames/SettingsReadCache, so queries
stay independent of ports/, domain/ and use-cases/. The adapter is bound only in staff.module.ts.
Only the two new staff tables and the audit log are written. No event or dependency is added.

Add tenant-qualified employee references to the legacy membership/PIN tables. These are NOT VALID
for existing data because pre-staff opaque references may exist; every new write is checked.
Do not manufacture historical employees. A separate repair/validation release must reconcile any orphan
references with owner-approved employee data. Existing orphan references remain readable, but new
membership/PIN references require a real employee; deployment must account for this stricter integrity rule.

## Consequences

PR 10 extends the same staff → identity read boundary with lockEmployeeSalaryAccess and
readEmployeeSalaryAccess. Salary writes retain company → ordered memberships → employee lock order.
Owner salary access is derived from active owner membership, with DENY winning; it is never a role bundle.
Salary role grants are excluded from effective access; nonowners need personal ALLOW. The catalog and
permissions screen expose both read:salaries:business and manage:salaries:business with bilingual labels.
SS-Q1 remains explicit: write currently requires both permissions to preserve unreadable-record privacy.

PR #83 branch privacy correction reuses the existing tenancy readers. Identity's bulk scope read
resolves actual business branches through its workspace-names adapter before evaluating grants;
an ALLOW on one business cannot confer access on another business's branch by pairing their IDs.
Staff validates requested branch ownership before target diagnostics, using one identical
EMPLOYEE_BRANCH_NOT_FOUND (404) for missing, other-business and other-company branches. Create's
selected-company guard replaces the business-only precheck so its primary branch follows the same
ordering; the write still checks live permission and the staff feature under the existing locks.
Source denial still hides an existing employee as NOT_FOUND. No new read arrow, schema or dependency is needed.

PR #83 review adds a PostgreSQL contrib dependency: `btree_gist`, installed by a new migration with
`CREATE EXTENSION IF NOT EXISTS btree_gist`. Its UUID GiST operator classes combine tenant/employee/branch
equality with `daterange(from, to, '[)') &&` in `employee_branches_no_overlap`. We choose an exclusion
constraint over an application-only serialized check because every writer, including concurrent direct SQL,
must preserve non-overlap. The domain validates full history under the existing lock order for a useful
EMPLOYEE_BRANCH_HISTORY_OVERLAP (409); the database is the final enforcement boundary. Adjacent dates
are allowed, NULL ends are unbounded, and the existing partial active index remains for read projections.

A separate new guard migration makes UPDATE close-only and closed rows immutable. A strict interval
CHECK rejects `to <= from`. The guard is SECURITY INVOKER, pins `search_path=pg_catalog`, and has no
PUBLIC EXECUTE grant. Function-inventory tests retain the exact application-function allowlist and
separately verify that the installed btree_gist extension functions have no SECURITY DEFINER capability.
There is no new npm dependency, runtime table privilege, cross-module arrow or attendance write.
These migrations validate existing data and never repair it silently; invalid history stops migration.
The GiST exclusion index requires a table lock during creation; deploy in a suitable migration window.

PR 9 extends this same read boundary with readEmployeeBranchAccess. It evaluates persisted/current
and proposed branch scopes in one grants read, so employee list filtering does not issue an identity
query for each row. The existing tenancy.describeWorkspaces reader supplies business branches;
SQL scope filtering precedes LIMIT, so cursors only identify readable employees. No authority or membership write is added. Updates take the existing company
and ordered membership locks before locking/reloading the employee; every persisted source and
requested target branch must allow management. Optimistic revisions protect editors after the
lock wait. The staff module's existing index and business indexes cover cursor reads; the additive
history index permits one active attachment per branch. Audit and all branch history writes share
the employee transaction; no update event is invented.

Employee creation briefly serializes per company with permission editors. User-link races cannot
evade the partial unique active user/business index (owner decision 2026-10-03). Duplicate names and future
hire dates are allowed; no local-date or duplicate-name lookup is needed. Reads retain the same RLS transaction, no global identity access,
auth grants or synchronous cross-module writes. The query tests cover shapes and indexed lookup plans.
