# ADR-0025 — Stored system role default bundles

Date: 2026-10-03. Status: Accepted technical implementation of PR 7a.

## Context

PR 7 displays stored role defaults and authorizes from live role_permissions.
Later slices added codes without granting them. Old companies must receive the
owner-approved matrix without converting role defaults into personal decisions.
Business managers may receive membership administration only inside their business.

## Decision

Update deterministic global system-role bundles by reference-data migration and
the idempotent seed. Both consume an explicit exhaustive code matrix; the migration
is an immutable snapshot checked against it. Replace only global system-role
defaults for catalog codes. Do not modify custom roles, memberships or overrides.
This is a role-reference backfill: existing memberships immediately resolve updated
bundles through their existing role FK. The migration journal and this ADR record
the system-wide policy change; personal audit/history retains the original actor,
reason and ALLOW/DENY decisions. No fictitious tenant actor or per-person grant.

Use separate read/manage:memberships:business codes and scoped routes. The business
must exist in the verified company. Queries filter before pagination; commands
check target membership and override scopes after the existing locks and reject
any attempt to reach company or another business. Default business-manager bundles
contain neither company membership management nor optional business membership
management. Explicit scoped ALLOW is required and effective possession still applies.
Company editors also cannot broaden these new optional codes for Business Managers
beyond the target membership's verified business.

Historical DENYs cannot reduce an active owner holder's administrative authority;
the live access reader suppresses these effects without rewriting history. Staff
login remains the deliberate ADR-0019 exception: no implicit owner/admin login.
All write-time readers reuse the same live grants reader to avoid divergent policy.

## Consequences

Review correction: identify Owner by its fixed global role ID and COMPANY scope.
Custom role names confer no immunity. The exhaustive matrix also governs personal
ALLOW eligibility, including the recorded optional cells. Resolve forbidden cells
as never: refuse new grants, ignore existing forbidden ALLOWs without changing
history, and count them in the seeded migration regression. Custom roles retain
PR 7 policy. Reuse the same reference eligibility projection for live access and
permission-screen editing availability. Scoped revoke filters membership and
decision visibility before existence handling; inaccessible and unknown IDs are
both NOT_FOUND. No new migration is needed: this is runtime enforcement of the
already migrated policy, not a destructive rewrite of personal decisions.

No new database table, RLS policy, runtime grant, package dependency or import arrow.
Existing role permission indexes support reads. Rollback to old code still reads
the migrated bundles; reverting the policy requires a new reviewed migration.
Salaries stay in PR 10 with Owner-only defaults and explicit ALLOW for others.
Unmapped customer-entry/discount-administration cells are TODO(spec), with
recommendations in slice 019, rather than inferred from sale-time privileges.
