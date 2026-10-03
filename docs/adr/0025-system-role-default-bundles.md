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
The 2026-10-04 owner decisions settle customer-entry and personal discount-limit
scopes; their TODO(spec) markers now point to implementation in follow-up PR 7d.


## Integration with PR 10 and PR 16 (2026-10-04)

Main migrations 0054–0057 and their snapshots remain authoritative. Regenerate
this custom reference-data migration as 0058_2026-10-03_system-role-default-bundles.sql.
Relative to the original custom 0054 SQL, add six catalog/delete-set codes and
fourteen schedule default grants; all other SQL bytes are unchanged. Salaries
have zero stored role grants. Only the canonical company Owner derives salary
defaults at read time; the permissions screen projects those same defaults.
Every other human system role has optional salary read/manage eligibility;
Device has neither. Management additionally requires read. Legacy Device salary
ALLOWs remain auditable but cannot grant access. Custom roles retain PR 7 personal
override policy, while stored salary role grants cannot confer salary access.
Schedule defaults remain Owner/General Manager/Business Manager/Branch Manager
for branch schedules and Owner/General Manager/Business Manager for business
shift templates. Other human cells retain PR 16's personal delegation eligibility.
Review correction 2026-10-04 makes every Device schedule/template cell forbidden:
refuse new personal ALLOWs and ignore historical ALLOWs without rewriting history.
The same projection enforces spec 009's already forbidden Device catalog cells
and scoped membership equivalents. Migration 0058 has no Device schedule grants
and remains byte-for-byte unchanged. Later Device cells without an explicit
decision remain unchanged, with DEVICE-Q1 and recommendations recorded in spec 019.

| Permission | Device matrix cell |
|---|---|
| read:schedules:branch | ❌ never |
| manage:schedules:branch | ❌ never |
| read:schedules:business (templates) | ❌ never |
| manage:schedules:business (templates) | ❌ never |

Default and optional human cells remain unchanged. The same Device eligibility
matrix governs both new personal decisions and historical ALLOW evaluation.
