# Identity role default grants — Phase 1 PR 7a

Sources: PR 7 spec's `Default bundles` owner decision (2026-10-03), the live
`PERMISSIONS` catalog, ADR-0003, ADR-0019, ADR-0021–0023, Phase 1 SPEC §2/§4/§11.

## Requirements and rules

Use the existing global `role_permissions` rows as the single stored-default authority;
the canonical-owner salary derivation preserves the explicit PR 10 exception.
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
Integration owner decision 2026-10-04: salary read/manage remain owner-only by
canonical-owner derivation, with no stored role_permissions defaults. Every other
human system role has both salary cells optional (⚙️), never forbidden; Device
salary cells are forbidden (❌). Salary management also requires read. Nonowner
role grants cannot grant salaries, including custom roles; personal overrides only.
Schedule branch defaults remain owner/general_manager/business_manager/branch_manager;
business template defaults remain owner/general_manager/business_manager. Other
human schedule cells retain PR 16 personal-ALLOW eligibility (⚙️). Review correction
2026-10-04: Device is ❌ for all four schedule/template codes. New Device ALLOWs
return PERMISSION_ROLE_FORBIDDEN; historical ALLOWs remain visible but grant nothing.
Spec 009's omitted-role rule also forbids Device's explicitly listed catalog cells
and their scoped membership-management equivalents; the runtime applies those cells
to new and historical personal ALLOWs without changing human or custom-role policy.

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
| create:customers:company | owner, general_manager; spec 022 records optional personal cells and business/branch context codes |
| manage:discounts:company | owner; spec 022 implements separate personal-limit administration |
| read/manage:salaries:business | no stored defaults; canonical Owner ✅; all other humans ⚙️; Device ❌ |
| read/manage:schedules:branch | owner, general_manager, business_manager, branch_manager ✅; other humans ⚙️; Device ❌ |
| read/manage:schedules:business | owner, general_manager, business_manager ✅; other humans ⚙️; Device ❌ |
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
Company decision revoke remains disabled in business context; company management
remains available through the scope selector. Personal discount-limit editing now
follows [spec 022](../022-identity-role-followups/spec.md)'s independent scoped code.

## Migration, dependencies and verification

Custom migration 0058 replaces the unmerged 0054 reference migration after main's
0054–0057 salary/schedule migrations: catalog codes and deterministic global role bundles; no new
table, column, privilege, dependency, RLS exception or cross-module arrow.
Test every role × catalog code, own/other business and branch guards, DENY/default
and ALLOW/optional precedence, expired overrides, owner immunity, cross-tenant
refusal, seeded-existing-company migration preservation, UI labels/defaults/decisions,
result shape and indexed scoped reads. Run pnpm check and API/admin builds.

## Recorded owner decisions and follow-up PR 7d

Both remaining scope questions were settled on 2026-10-04. Their implementation
is specified in spec 022 for PR 7d; the existing company codes remain unchanged.

- [Spec 022](../022-identity-role-followups/spec.md) introduces business/branch customer-creation codes for
  business_manager, branch_manager and cashier. Customer data remains company-scoped;
  the new permission reach must not become company-wide creation authority.
- [Spec 022](../022-identity-role-followups/spec.md) introduces a separate personal discount-limit administration
  code for owner, general_manager and business_manager. Managers act within their own
  business and nobody edits their own limit. Keep it separate from discount application.

## Integration verification

Test all 14 roles against salary/schedule stored defaults and personal eligibility;
prove explicit salary ALLOW for GM/accountant/BM and refusal for Device, read-plus-manage,
canonical Owner identity, role-grant exclusion, scoped DENY and preserved schedule grants.
Migrate a fresh worktree database through 0000–0058; run pnpm check and API/admin/worker builds.


## Device permission audit — review correction 2026-10-04

Device has no stored salary, schedule or template default grants in migration 0058.
No SQL edit or migration is needed for this correction.
The spec 009 catalog rows omit Device and define omitted roles as never. Enforce
that rule for company/business membership read/manage, business read/create,
branch read/create, device management, settings read/manage, notifications and
platform creation (platform override writes already refuse every tenant role).

DEVICE-Q1 resolved by the recorded owner decision 2026-10-04 in
[spec 022](../022-identity-role-followups/spec.md): Device can never hold file
read/manage, employee management, company customer creation, company discount
management, or the new customer-context/limit-administration codes. Historical
ALLOWs remain inert and visible. login:staff:branch remains eligible for Device
under ADR-0019; dedicated attendance and QR capabilities remain unchanged.

Acceptance: all four schedule/template Device ALLOWs return the named bilingual
403, including user-bound Device memberships. Seed historical forbidden ALLOWs,
prove guards refuse them and confirm unchanged current/history rows on the
permissions screen. Keep positive delegation cases for human roles.

## PR 23 reception amendment — review request 2026-10-05

The reviewer/fixer request promotes Cashier's optional `login:staff:branch` cell to a stored default, alongside `clock:attendance:branch`, so the reception bundle operates without a custom role. Staff keeps its login default; no other role gains staff login. Owner/admin authority alone remains insufficient. Migration 0082 applies the added defaults to existing system memberships; seed uses the same matrix. See ADR-0036 and spec 032.
