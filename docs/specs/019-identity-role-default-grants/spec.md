# Identity role default grants — Phase 1 PR 7a

Sources: PR 7 spec's `Default bundles` owner decision (2026-10-03), the live
`PERMISSIONS` catalog, ADR-0003, ADR-0019, ADR-0021–0023, Phase 1 SPEC §2/§4/§11.

## Requirements and rules

Use the existing global `role_permissions` rows as the single default authority.
An additive reference-data migration applies the complete catalog matrix to every
existing system-role membership, without manufacturing per-person overrides.
Seed repeats the same matrix. Custom company roles and override history are preserved.
Active non-owner DENY wins over defaults and ALLOW; expired decisions do not apply.
Personal ALLOW is eligible only for a canonical system role's default or optional
matrix cells; forbidden cells return PERMISSION_ROLE_FORBIDDEN. Existing forbidden
ALLOW rows remain in history but are ignored by all live readers. Custom roles,
including a company role named owner, retain PR 7 effective-possession policy.
Canonical Owner means the fixed global Owner role ID at this company's COMPANY
scope, never a role name. Only that identity confers owner protection.
Optional cells are business_manager read/manage memberships within its business,
branch_manager read/manage settings, and cashier staff login (ADR-0019).
Active owners retain every administrative tenant capability even with historical
DENYs on sibling memberships. Owner protection and self-edit refusal remain under
the company NO KEY UPDATE → memberships ordered by id → overrides lock protocol.

ADR-0019's login exception remains: Staff has `login:staff:branch`; cashier/reception
requires explicit ALLOW. Owner/admin status alone never enables staff login.
Platform permission and Device bundles remain outside human administrative defaults.
Salary permissions belong to PR 10: Owner only by default, all others explicit ALLOW.
No salary code is introduced here.

| Code | Default roles (all others off) |
|---|---|
| read/manage:memberships:company | owner |
| read/manage:memberships:business (new) | owner; business_manager explicit ALLOW only |
| read:businesses:company | owner, general_manager, accountant, viewer |
| create:businesses:company | owner, general_manager |
| create:branches:business | owner, general_manager, business_manager |
| read:branches:branch | owner, general_manager, accountant, business_manager, branch_manager, shift_supervisor, cashier, waiter, storekeeper, staff, viewer |
| manage:devices:branch | owner, general_manager, business_manager, branch_manager |
| read/manage:settings:business | owner, general_manager, business_manager; branch_manager explicit ALLOW only |
| view:notifications:business | owner, general_manager, business_manager |
| read/manage:files:business | owner, general_manager, business_manager |
| manage:employees:business | owner, general_manager, business_manager |
| create:customers:company | owner; TODO(spec): reception role and narrower customer authority unresolved |
| manage:discounts:company | owner; TODO(spec): applying a discount does not settle administration of personal limits |
| login:staff:branch | staff (ADR-0019) |
| create:companies:platform | no tenant role |

## Scoped API and delegation

Keep existing company routes. Add the same list/detail/override/revoke operations
under `/v1/businesses/:businessId/permissions/memberships`, guarded exactly once
by read/manage:memberships:business at the verified business. Responses and input
contracts are shared with company routes; list and history retain cursor pagination.
Only BUSINESS memberships for this business and BRANCH memberships of its actual
branches are visible. Company memberships and other businesses are inaccessible.
Company decisions affecting a visible membership remain readable, but cannot be
revoked from the business scope. Unrelated-business decisions stay hidden.
Scoped writes reload authority under locks, check membership and decision scope
both remain inside the requested business, and retain effective-possession,
descendant-DENY, self-edit, owner and audit rules. No scoped grant opens company routes.
Even the company editor may grant the two new codes to a Business Manager only
inside that membership's business; COMPANY and another-business ALLOW are refused.

## UI

Role defaults remain separate from current and ended personal decisions. Show
bilingual labels and permission codes, including new scoped codes. A selected
business starts with scoped routes; a scope selector retains company management
even when the workspace selects its only business. Refresh and
cache keys include scope. No fetch inside components or invented effective defaults.
Company decision revoke and personal discount-limit edits are disabled in business
context; company management remains available through the scope selector.

## Migration, dependencies and verification

New custom migration: catalog codes and deterministic global role bundles; no new
table, column, privilege, dependency, RLS exception or cross-module arrow.
Test every role × catalog code, own/other business and branch guards, DENY/default
and ALLOW/optional precedence, expired overrides, owner immunity, cross-tenant
refusal, seeded-existing-company migration preservation, UI labels/defaults/decisions,
result shape and indexed scoped reads. Run pnpm check and API/admin builds.

## Open questions for the owner

- TODO(spec): PR 34 customer creation has COMPANY scope and no reception role.
  Recommend business/branch customer entry permission for managers and cashiers;
  keep company-wide customer creation Owner-only until settled.
- TODO(spec): PR 7b manages discount parameters, whereas the matrix describes
  applying discounts. Recommend a business-scoped limit-management capability for
  General Manager and Business Manager, distinct from sale-time discount approval.
