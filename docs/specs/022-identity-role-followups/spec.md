# Identity role follow-ups — Phase 1 PR 7d

Date: 2026-10-04. Sources: spec 019 recorded owner decisions and Device audit,
ADR-0025, spec 009 Default bundles, spec 016 and spec 010; Phase 1 SPEC §§2–4/11.

## Requirements and permission matrix

Customer identities remain company-owned, unique by company/phone. Scoped codes
authorize find-or-create only from a verified business or branch context; they
never authorize the existing company endpoint. Inputs, masked responses,
deduplication, feature gating, privacy and atomic creation audit remain PR 34's.

| Code | Default roles | Personal ALLOW eligibility |
|---|---|---|
| create:customers:company | owner, general_manager | owner, general_manager, shift_supervisor, accountant, waiter, kitchen, storekeeper, staff, marketing, viewer |
| create:customers:business | owner, business_manager | same |
| create:customers:branch | owner, branch_manager, cashier | same |
| manage:discount-limits:business | owner, general_manager, business_manager | same |

Business Manager's new permissions are confined to the BUSINESS membership's own
business and its branches. Branch Manager/Cashier customer creation is confined
to the BRANCH membership's branch. Neither new nor historical ALLOW may broaden
that reach. Custom roles retain effective-possession policy.

CUSTOMER-Q1 resolved: owner decision 2026-10-04, recommended option. General Manager
receives create:customers:company ✅ by default. Shift Supervisor, Accountant,
Waiter, Kitchen, Storekeeper, Staff, Marketing and Viewer remain ⚙️: off by default,
eligible for an explicit personal ALLOW of create:customers:company. Device stays
❌. Business Manager, Branch Manager and Cashier retain their scoped creation codes
and cannot acquire company-wide creation authority through this decision.

Discount-limit administration is separate from applying discounts and from
manage:discounts:company. Owner/GM grants at COMPANY reach all company memberships;
BM grants at BUSINESS reach BUSINESS memberships and BRANCH memberships of that
business. No self edit, including sibling memberships; canonical active owner
holders remain protected. Reload scope, grants, holder identity and decision time
under PR 7's company → ordered memberships locking protocol. DENY/expiry apply,
including descendant DENYs. Unknown/inactive/cross-tenant/out-of-reach targets
all return the same 403 FORBIDDEN envelope before holder-specific failures.
Review correction (PR #93, round 2): the HTTP guard checks both the immediate
membership scope and every affected descendant before any body validation.
An inaccessible membership and an unknown ID have identical status, code and body
for valid and invalid requests alike. Self-edit and owner-protected failures may
be named only after full target authorization; an authorized target's invalid body
may return VALIDATION_FAILED. The mutation still repeats authorization under locks.
Preflight also checks the company's non-deleted state, matching the locked reader.
Every successful set/change/clear has the existing atomic audit and invalidation.

Device may never hold read/manage:files:business, manage:employees:business,
create:customers:company, manage:discounts:company or any of the three new codes.
New ALLOW returns PERMISSION_ROLE_FORBIDDEN. Existing ALLOW history is retained
but ignored by the shared live-reader eligibility projection. login:staff:branch
remains eligible for Device; no default login grant or attendance/QR change.

## Contract and API

- Existing POST /v1/customers/find-or-create keeps create:customers:company.
- POST /v1/businesses/:businessId/customers/find-or-create requires exactly one
  create:customers:business declaration with verified business target.
- POST /v1/branches/:branchId/customers/find-or-create requires exactly one
  create:customers:branch declaration with server-resolved business/branch target.
- Both scoped customer routes return HTTP 200 and reuse PR 34's strict input and
  response schemas, customers feature, and uniform 403 for inaccessible/unknown scope.
- Existing POST /v1/permissions/memberships/:membershipId/discount-limit retains
  its strict body/status. One Require declaration checks manage:discount-limits:business
  at the server-resolved membership scope; the use case rechecks that scope under
  the existing locks. No manage:memberships permission is required.

## Persistence, UI and architecture

Generate one new custom reference-data migration after 0058; add catalog entries
and the explicit system bundles. Seed consumes the same matrix. Never modify
0058, custom roles, memberships, personal history or existing RLS policies.
No table, dependency, runtime privilege or import arrow. The existing indexed
membership detail query exposes discount_limit_editing_enabled independently
of permission-override editing; its projection follows the same grant, DENY,
self and canonical-owner rules, with the authoritative recheck on mutation.
Add ar/en permission labels; display actual stored defaults separately from
personal decisions on the existing admin screen. Reception UI remains PR 35.

## Acceptance tests

- Exhaustive role × code defaults/eligibility unit matrix and migration snapshot.
- Cashier/branch manager creation in own branch; other branch/business, unknown
  branch and cross-tenant refusal have equal status/code/body; business manager
  own business only; scoped grants cannot open the company creation route.
- Same phone across contexts returns one company customer with masked response.
- GM creates through the company route by default. Viewer is refused until a
  personal ALLOW is granted, then loses access when that grant is revoked.
- BM own-business discount edits, other-business/company/unknown refusal equality,
  self/sibling protection, GM/owner paths, canonical owner protection and DENY/expiry.
- HTTP regression compares complete envelopes for descendant DENY, direct DENY,
  inactive/cross-tenant/out-of-reach/unknown targets and deleted companies with valid and invalid bodies;
  self/owner protections cannot expose a target that fails full authorization.
- Every new Device never-cell refuses ALLOW; historical rows grant nothing and
  retain history. Device staff-login eligibility and existing QR/attendance tests pass.
- Bilingual admin label/default tests. pnpm check with FORCE_COLOR unset, pnpm test,
  and API/admin/POS builds (generated client changes) exit zero.
