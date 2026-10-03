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
