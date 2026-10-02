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

## Owner decisions — 2026-10-03

D-07 — owner decision 2026-10-03: the 13 tenant role codes in SYSTEM_ROLES
(owner through viewer) are final. Both locales use i18n role keys, with the exact
Arabic names supplied by the owner. Remove the provisional notice. No seed,
role_permissions, migration or technical device-role change.

EDIT-POLICY — owner decision 2026-10-03: reload active editor access inside the
write transaction. Require manage:memberships:company AND effective possession
of the edited permission at a scope covering the target. DENYs and expiry apply;
a broad delegation must not bypass a descendant DENY. Never edit any membership
held by the editor. Never add owner DENYs, or replace/revoke owner ALLOWs.
Named bilingual errors: PERMISSION_NOT_HELD, PERMISSION_SELF_EDIT,
PERMISSION_OWNER_PROTECTED, PERMISSION_SCOPE_OUTSIDE_REACH.

PR #73 review correction: protection belongs to the person, identified by the
membership's user_id or employee_id, within the verified company. An active owner
membership protects every membership of that holder from new DENYs and from
replacement/revocation of ALLOWs. Inactive owners and owners in another company
do not confer this protection. Self-edit refusal compares the editor's user_id
with the target holder, including the editor's other memberships. Create,
replacement and revoke use the same locked holder snapshot and domain checks.

The write locks the company root before its memberships in UUID order. The root
lock prevents insertion of a new sibling membership through the company FK;
membership locks prevent concurrent role/holder changes. Read holder roles and
sample decision time only after these locks, then retain them through audit and
commit. Permission writes briefly serialize membership changes within a company;
ordinary read queries remain unlocked. No migration or identity mapping outside
the existing user/employee holder model is needed.

Regression tests exercise owner + Viewer siblings through real Postgres and HTTP
for DENY, ALLOW replacement and revoke, preserving AuthorizeRequest management
access; editor siblings, employee holders, non-owner siblings, inactive/cross-company
owners, and a concurrent sibling promotion to owner while the write waits.

OVERRIDE-LIFECYCLE — owner decision 2026-10-03: create replaces current rows for
the same membership/permission/scope by ending them and inserting a new decision
atomically. Revoke ends a current row with a required trimmed reason (1–500).
Already ended returns PERMISSION_OVERRIDE_ENDED (409); missing returns 404.
Never delete history; current means expires_at IS NULL OR expires_at > decision
time, ended means expires_at <= decision time. Lock the company root and its
memberships in UUID order before reloading access, then sample decision time inside the
transaction after waiting for locks to avoid ending a newer row at an older time.
Every create/replace/revoke writes actor, membership, permission, scope, effect,
before/after and reason to audit in that transaction.

## API contract

- GET `/v1/permissions/memberships?cursor=<uuid>&limit=20`: membership summaries,
  ordered by id, `items` + `next_cursor`; maximum 100.
- GET `/v1/permissions/memberships/:membershipId?cursor=<uuid>&limit=20`:
  membership, role defaults, finite tenant permission catalog, a cursor page of
  current overrides, a separate ended_overrides page, `editing_enabled`.
  history_cursor independently paginates ended rows.
- POST `/v1/permissions/memberships/:membershipId/overrides`: strict body
  `{permission_code,effect:ALLOW|DENY,scope_type:COMPANY|BUSINESS|BRANCH,scope_id,
  reason,expires_at:null|UTC timestamp}`. Reason required, max 500. Future expiry
  only. Returns 201 with the persisted override. No financial/stock effect.

Scope targets must exist inside the verified company. Current decisions at the
same membership/permission/scope are replaced atomically with history retained.
POST /v1/permissions/memberships/:membershipId/overrides/:overrideId/revoke
accepts strict {reason} and returns 200 with the ended row. No idempotency needed.
Unknown membership/permission, platform permissions, closed company, inactive
membership, and forbidden scope are refused without exposing another tenant.
All schema fields are reused; no migration, new table, column, dependency or arrow.
Role editing, membership editing and numeric discount limits
are outside row 7; PRs 7b/7c own discount parameters.

## Write sequence and cache

Within one `withTenant(companyId,...,{userId})` transaction: lock company and memberships;
reload holder roles and editor access rather than trust guard snapshot; validate tenant scope,
catalog, membership window and expiry; check edit policy; end replaced rows and insert override, or end revoked row;
append allowlisted audit before/after. Failure rolls back both writes.
After successful commit the same use case advances the company's Redis grant
version and the changed membership's version. Existing AuthorizeRequest reads remain live on every request, so there
are no cached grants to reuse or in-process cache. No Redis means no grants cache
and no invalidation operation. Redis failure after commit is surfaced; current authorization still reads live grants on the next request. A future reader cache must use the
version and a short TTL capped by the next membership/override expiry.

## Verification and acceptance

Pure validation tests: all scopes, ALLOW/DENY, platform/unknown permission,
wrong company, inactive membership, expiry, self-edits, owner protection, not-held/scope refusals and lifecycle decisions.
Real Postgres tests: shape, pagination, tenant isolation, same transaction audit,
duplicate races, rollback, existing AuthorizeRequest DENY semantics, and query
EXPLAIN ANALYZE using existing membership/override indexes. HTTP tests verify
authentication, read/manage guards and validation. Redis tests cover version
invalidation. UI tests cover defaults,
current/history separation, editing/revoke forms, final role names and bilingual errors.
`pnpm check` and builds for API/admin must exit zero. No server/watch/browser,
commit or migration against any database is part of this lane.

## Default bundles — follow-up PR 7a

Owner decision 2026-10-03. Documentation only: ✅ default on, ⚙️ off until
granted, 👁 read-only, ❌ never. Codes requiring narrower scope need corresponding
scoped permission codes in 7a; never grant company-wide management to a business
manager as a substitute. All roles omitted from a row are ❌.

| Current catalog permission | Default roles |
|---|---|
| read:memberships:company | owner ✅; business_manager ⚙️ inside own business (scoped code needed) |
| manage:memberships:company | owner ✅; business_manager ⚙️ inside own business (scoped code needed); everyone else ❌ |
| read:businesses:company | owner/general_manager ✅; accountant/viewer 👁 |
| create:businesses:company | owner/general_manager ✅ |
| create:branches:business | owner/general_manager/business_manager ✅ (manager's own business) |
| read:branches:branch | owner/general_manager/business_manager/branch_manager/shift_supervisor/cashier/waiter/storekeeper/staff ✅ within their scope; accountant/viewer 👁 |
| manage:devices:branch | owner/general_manager/business_manager/branch_manager ✅ within their scope |
| read:settings:business | owner/general_manager/business_manager ✅ within scope; branch_manager ⚙️ |
| manage:settings:business | owner/general_manager/business_manager ✅ within scope; branch_manager ⚙️ |
| view:notifications:business | owner/general_manager/business_manager ✅ within scope (ADR-0018 delivery-log permission) |
| create:companies:platform | every tenant role ❌; platform_grants only |

The full matrix guides future codes absent from this catalog: owner everything
in company; general_manager like owner except billing/subscription, company
deletion and assigning owner; accountant finance + read-only orders/no price
edits; business_manager everything in one business; branch_manager own branch,
discount/return/wastage approvals and closes shifts, costs/profit ⚙️;
shift_supervisor opens/closes shifts and small discounts; cashier sells, own
data/PIN; waiter no money; kitchen KDS only; storekeeper stock/no sale prices;
staff own attendance/schedule/commission; marketing campaigns/no financials;
viewer read-only reports. User creation and granting permissions: owner ✅,
business_manager ⚙️ inside business, everyone else ❌. Audit view: owner ✅,
business_manager ✅, branch_manager 👁 own branch, accountant 👁. Audit/user
creation codes not yet present must be introduced with their respective routes;
their default bundles must follow this matrix.
