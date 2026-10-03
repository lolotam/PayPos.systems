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
Only the two new staff tables and the audit log are written. No event or dependency is added.

Add tenant-qualified employee references to the legacy membership/PIN tables. These are NOT VALID
for existing data because pre-staff opaque references may exist; every new write is checked.
Do not manufacture historical employees. A separate repair/validation release must reconcile any orphan
references with owner-approved employee data. Existing orphan references remain readable, but new
membership/PIN references require a real employee; deployment must account for this stricter integrity rule.

## Consequences

Employee creation briefly serializes per company with permission editors. User-link races cannot
evade the partial unique active user/business index (owner decision 2026-10-03). Duplicate names and future
hire dates are allowed; no local-date or duplicate-name lookup is needed. Reads retain the same RLS transaction, no global identity access,
auth grants or synchronous cross-module writes. The query tests cover shapes and indexed lookup plans.
