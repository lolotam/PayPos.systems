# Identity permissions screen — Phase 1 PR 7

Sources: Phase 1 SPEC §2, §4, §11 visibility; implementation plan row 7;
ADR-0003 §2.2–2.3, §4–5; current permission catalog; CLAUDE.md §8.

## Requirements and boundaries

Admin `/permissions` lists company memberships with cursor pagination. Selecting a
membership shows its holder identifier, scope, active window, actual role defaults,
and existing per-person overrides. The screen never synthesizes role defaults.
Both user and employee memberships use the same access model. No global identity
table is read for display names; staff identity/name integration belongs to PR 8.

`read:memberships:company` guards reads; `manage:memberships:company` guards writes.
The company always comes from the verified principal. Role defaults are read-only.
The catalog excludes platform permissions from tenant override selection.
The existing guard remains authoritative: union of active memberships, DENY wins,
expired overrides ignored, no grant means refusal.

## Owner decisions still required

- TODO(spec) D-07: confirm role codes, Arabic names, and default permission bundles.
  Display existing seeded defaults with a provisional notice; do not seed new ones.
- TODO(spec) EDIT-POLICY: the normative `09_Dashboards_Roles_Permissions_AR.md`
  referenced by PRD §3.2 is absent here. Confirm the editable tenant permissions,
  delegation rules, self-edits, owner protection, and whether a company-level
  membership administrator may broaden a branch/business membership's override.
  Recommendation: only permissions held by the editor at the target, no self
  escalation, preserve owner administration. Until decided, writes return
  PERMISSION_POLICY_UNRESOLVED and the screen exposes read-only data.
- TODO(spec) OVERRIDE-LIFECYCLE: confirm changing/revoking an existing override.
  Recommendation: one current decision per membership/permission/scope, with
  audited replacement/revocation retaining history. The dormant insertion adapter
  temporarily refuses an active duplicate; this is not an approved editing policy.

## API contract

- GET `/v1/permissions/memberships?cursor=<uuid>&limit=20`: membership summaries,
  ordered by id, `items` + `next_cursor`; maximum 100.
- GET `/v1/permissions/memberships/:membershipId?cursor=<uuid>&limit=20`:
  membership, role defaults, finite tenant permission catalog, a cursor page of
  existing overrides, `editing_enabled`.
- POST `/v1/permissions/memberships/:membershipId/overrides`: strict body
  `{permission_code,effect:ALLOW|DENY,scope_type:COMPANY|BUSINESS|BRANCH,scope_id,
  reason,expires_at:null|UTC timestamp}`. Reason required, max 500. Future expiry
  only. Returns 201 with the persisted override. No financial/stock effect.

Scope targets must exist inside the verified company. Duplicate active overrides
at the same membership/permission/scope are refused (no silent replacement).
Unknown membership/permission, platform permissions, closed company, inactive
membership, and forbidden scope are refused without exposing another tenant.
All schema fields are reused; no migration, new table, column, dependency or arrow.
Override removal, role editing, membership editing and numeric discount limits
are outside row 7; PRs 7b/7c own discount parameters.

## Write sequence and cache

Within one `withTenant(companyId,...,{userId})` transaction: lock membership;
reload editor access rather than trust guard snapshot; validate tenant scope,
catalog, membership window and expiry; check edit policy; insert override;
append allowlisted audit before/after. Failure rolls back both writes.
After successful commit the same use case advances the company's Redis grant
version. Existing AuthorizeRequest reads remain live on every request, so there
are no cached grants to reuse or in-process cache. No Redis means no grants cache
and no invalidation operation. Redis failure after commit is surfaced; a retry
cannot insert a duplicate active override. A future reader cache must use the
version and a short TTL capped by the next membership/override expiry.

## Verification and acceptance

Pure validation tests: all scopes, ALLOW/DENY, platform/unknown permission,
wrong company, inactive membership, expiry, unresolved editing policy.
Real Postgres tests: shape, pagination, tenant isolation, same transaction audit,
duplicate races, rollback, existing AuthorizeRequest DENY semantics, and query
EXPLAIN ANALYZE using existing membership/override indexes. HTTP tests verify
authentication, read/manage guards and validation. Redis tests cover version
invalidation. UI tests cover defaults,
overrides, provisional/read-only notices and bilingual state messages.
`pnpm check` and builds for API/admin must exit zero. No server/watch/browser,
commit or migration against any database is part of this lane.
