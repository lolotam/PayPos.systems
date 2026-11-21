# Feature Specification: Customer packages screen (42-4) and imported-refund switch (46-2a-S)

**Feature Branch**: assigned by the manager at dispatch (this folder was drafted on `T3-CODE/plan-42-4-46-2a-spec`)

**Created**: 2026-11-21

**Status**: Draft, planning only. No code, migration, commit or PR exists for it.

**Input**: Manager brief (thread `dfb4c927-5b17-4231-b0c8-34274c1edb05`, 2026-11-21): plan one delivery for the
remaining work of row 42-4 and row 46-2a (46-2a-S) of spec 058, as one spec, one plan and one implementation PR.

**Source pin**: `origin/main` = `cf70114e2cbe9efcb2b5dc4d327f2c82f87d54b3`. Every statement about existing code
below was read at that commit with `git show` / `git grep`. Evidence and the list of documents read are in
[research.md](research.md).

**Relation to the canonical spec**: this file is additive. `docs/specs/058-packages-sell-redeem/spec.md` stays the
authority for FR-050…FR-072, TD-13, TD-14, CP-01…CP-03 and the permission table. Nothing here rewrites it. The
edits the canonical files will need when the implementation PR lands are listed in
[plan.md §9](plan.md#9-canonical-amendments-the-implementation-pr-makes).

## What ships and what does not

| Part | Ships | Does not ship |
| --- | --- | --- |
| **42-4** | One admin screen that lists a customer's packages and shows one package's detail, reached from three places where the customer is already known. Arabic and English strings, component tests, journey file | Any API, contract, query or migration change. The sale form, the picker, the sale recovery, the «من الباقة» toggle (all merged). A customer search or a sidebar entry. A refund dialog, refund history, a `can_refund` capability (row 46-3). Anything in `apps/pos` or `apps/business` |
| **46-2a-S** | Activation of the existing permission `manage:imported-refunds:business` (catalog, owner default, seed), its Arabic/English name, a dedicated read and write route for the switch with an audit entry, and an admin switch | A second permission key. A schema change (the column shipped in migration `0223`). Any change to the refund use case, its route, its money or its cash logic. A bell, an event, a worker consumer. A production or staging deploy |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See a customer's packages (Priority: P1)

A receptionist or a manager who is looking at a customer (in today's sessions list, in the record-a-visit form,
or in the sell-a-package form) opens that customer's packages. They see every package the customer holds in this
business: its name, whether it was sold here or imported, when it expires, what was paid and refunded, and for each
service how many sessions remain, were used and were refunded. Expired and fully used packages come last and are
marked.

**Why this priority**: row 42-4 of spec 058 is the last open part of Story 8 (CP-01…CP-03). The reads behind it are
merged and unused by any standalone screen.

**Independent Test**: with seeded packages, open the screen from each of the three entry points and compare what is
shown with the list response of FR-070.

**Acceptance Scenarios**:

1. **Given** a customer with one active and one expired package, **When** the user opens the customer's packages,
   **Then** both are listed, the active one first, the expired one marked «منتهية» / "Expired".
2. **Given** a customer with no package, **When** the screen opens, **Then** an empty-state message is shown and no
   error.
3. **Given** a customer with more packages than one page, **When** the user asks for more, **Then** the next page is
   appended and no package appears twice.
4. **Given** a user who holds only `read:service-sessions:branch` at the branch, **When** they open the screen from
   the day's sessions list, **Then** they see the same list a receptionist sees (PK-Q17, CP-03).
5. **Given** a user with neither permission at the selected branch, **When** they open the screen's address
   directly, **Then** they see a "not allowed" message and no package data.
6. **Given** the user switches company, business or branch while the screen is open, **Then** the previous
   customer's packages are no longer shown.

---

### User Story 2 - Read one package's detail (Priority: P1)

From the list the user opens one package. They see how it was sold (list price, discount, price paid, payment
method, sale date), its validity, every service with its sessions one by one (free, used, refunded, used before
import), the visits that consumed sessions, and the extensions with their reasons. A user who may extend packages
at this branch also sees the Extend button.

**Why this priority**: CP-01 requires the detail with its history; FR-071 already returns it.

**Independent Test**: open a package that has one redemption and one extension and compare with the detail
response of FR-071; repeat as a user without `extend:packages:branch`.

**Acceptance Scenarios**:

1. **Given** a sold package, **When** its detail opens, **Then** provenance, list price, discount, price paid,
   payment method, sale date, expiry, refunded amount and each component's sessions are shown.
2. **Given** an imported package (no list price, seller or sale date), **When** its detail opens, **Then** it is
   marked «مستوردة» / "Imported" and the absent sale facts are not rendered as empty labels.
3. **Given** the detail response has `can_extend: true`, **Then** the Extend button is shown and opens the existing
   extend dialog; **given** `can_extend: false`, **then** no Extend button is rendered.
4. **Given** a successful extension from this screen, **Then** the detail and the list both show the new expiry.
5. **Given** the address names a package that is not this customer's or not in this business, **Then** the detail
   area shows "package not found" and the list stays usable.
6. **Given** the detail request fails for a network reason, **Then** an error with a retry action is shown.

---

### User Story 3 - Switch refunds of imported packages on or off (Priority: P1)

The owner opens «مرتجع الباقات المستوردة» / "Imported-package refunds" in the admin settings area of a business.
They see whether refunds of imported packages are on or off (off unless someone switched them on) and can change
it. Each change is recorded: who, when, the old value and the new value.

**Why this priority**: PK-Q24 says imported refunds stay off until the owner switches them on. The refund use case
already reads the switch, but no product surface can write it, so imported refunds cannot be enabled today.

**Independent Test**: as the owner, switch on, then try an imported refund (existing 46-2 behaviour: accepted);
switch off, try again (refused with `IMPORTED_REFUND_DISABLED`); read the two audit entries.

**Acceptance Scenarios**:

1. **Given** a business that never touched the switch, **When** the owner opens the page, **Then** it shows off.
2. **Given** the switch is off, **When** the owner turns it on, **Then** it shows on after the server confirms, and
   one audit entry records off → on with the owner as actor.
3. **Given** the switch is on, **When** the owner turns it off, **Then** it shows off and a second audit entry
   records on → off.
4. **Given** the switch is on, **When** a request sets it on again, **Then** the value is not changed and no audit
   entry is added.
5. **Given** a general manager who holds `manage:settings:business` but not `manage:imported-refunds:business`,
   **When** they call the read or the write, **Then** both answer 403 and the navigation entry is not shown.
6. **Given** a save fails, **Then** the switch shows the last value the server confirmed, with an error message.

---

### User Story 4 - The owner alone hands the switch to someone else (Priority: P2)

On the permissions screen the owner grants `manage:imported-refunds:business` to a named person. That person can
now open the switch page and change it, but cannot grant the permission to anyone or take it from anyone. The
owner can take it back.

**Why this priority**: PK-Q26 (final, 2026-10-24). The owner-only guard (46-2a G, PR #899) is merged, but the
code cannot be granted while it is not in the permission catalog.

**Independent Test**: owner grants to a branch manager; the grantee toggles the switch; the grantee's attempt to
grant, deny or revoke the code for a third person is refused; the owner revokes; the grantee's next write is 403.

**Acceptance Scenarios**:

1. **Given** the activation is in place, **When** the owner grants the code to any human role, **Then** the grant
   is saved (201). **When** the owner tries it on a device membership, **Then** it is refused
   (`PERMISSION_ROLE_FORBIDDEN`).
2. **Given** a non-owner grantee who can manage memberships, **When** they save an ALLOW, save a DENY or revoke
   this code for anyone, **Then** the
   request is refused with `PERMISSION_OWNER_ONLY` and nothing changes (already enforced by PR #899; re-asserted
   against the seeded catalog).
3. **Given** a grantee who switched refunds on and was then revoked, **Then** the switch stays on (it is the
   business's setting, not the grantee's), and the former grantee's next read or write is 403.
4. **Given** a revocation that commits while the grantee's write is waiting, **Then** the write is refused and the
   stored value and the audit log are unchanged.

### Edge Cases

- A customer id that belongs to another company or business: the list answers like an unknown customer (CP-02);
  the screen shows the empty or "not found" state the API returns, never another tenant's data.
- The address carries a malformed customer or package id: the screen shows "not found" without calling the API.
- No business or no branch is selected in the workspace: the screen shows the same "choose a business / branch"
  prompts the package-sale route shows.
- All three entry points use a generic heading. The screen never requests or stores the customer name or phone
  (FR-070, `CLAUDE.md` §8).
- Two first writes of the switch at the same moment on a business with no settings row: they are serialized; each
  audit entry carries the true previous value.
- The switch is turned off while a refund of an imported package is in flight: the refund reads the stored value
  inside its own transaction with a plain read (existing behaviour of `readImportedRefundsEnabled`), so a refund
  whose read ran before the switch commit completes, and every refund that starts after it is refused. This
  delivery does not change that.
- A refund already recorded stays recorded when the switch goes off; `SOLD` refunds never read the switch.
- A device principal: 403 on the switch routes and no grant of the code, as for every `deviceForbidden` code.

## Requirements *(mandatory)*

### Functional Requirements

**42-4 — customer packages screen**

- **FR-A01**: The admin MUST offer one screen showing the packages of one customer in the selected business and
  branch, fed only by the merged FR-070 list read.
- **FR-A02**: The screen MUST be reachable from (a) each visit in the day's sessions list, (b) the selected-customer
  card in the record-a-visit form, (c) the selected-customer card in the sell-a-package form. It MUST NOT add a
  customer lookup of its own and MUST NOT create a customer.
- **FR-A03**: Each listed package MUST show: name in the user's language (Arabic falling back to English),
  provenance (sold / imported), expiry date, an "expired" mark when `expired`, a "fully used" mark when `used_up`,
  price paid, refunded amount, and per component the service name and the remaining, used and refunded counts with
  its slot values.
- **FR-A04**: The list MUST keep the server's order (active first, expired and used-up last), load further pages on
  request, and never show one package twice.
- **FR-A05**: Opening a package MUST show its detail from the merged FR-071 read: provenance; for a sold package
  list price, discount, price paid, payment method and sale date; validity days when present; expiry; refunded
  amount; each component with its sessions total, counts, component value and every slot's number, state and unit
  value; the redemption history (session number, service, visit date, a "reversed" mark); the extension history
  (from, to, when, and the reason when the read returns it).
- **FR-A06**: The only action on the screen is Extend, shown if and only if the detail read returns
  `can_extend: true`; it opens the merged extend dialog, and after a saved extension the list and the detail show
  the new expiry. No other action is derived from a role name or from a client-side permission guess.
- **FR-A07**: The screen MUST show distinct states for: loading, empty, not allowed (403), not found (404), and a
  retryable failure, for the list and for the detail independently.
- **FR-A08**: The customer's phone MUST NOT be requested, shown, logged or put in the address by this screen. The
  customer's name MUST NOT be put in the address.
- **FR-A09**: Fields the detail read returns only as identifiers (`seller_employee_id`, `seller_linked_user_id`,
  `sold_branch_id`, `package_type_id`) MUST NOT be rendered as raw identifiers. Showing a seller or branch name is
  out of scope because no merged read returns those names.
- **FR-A10**: Changing company, business, branch or signed-in user MUST drop the shown customer's data.

**46-2a-S — imported-refund switch**

- **FR-B01**: The existing code `manage:imported-refunds:business` MUST become an active permission: present in the
  permission catalog, held by the owner role by default and by no other role, grantable to any human role, never
  to a device. No second code is introduced.
- **FR-B02**: Only the owner MUST be able to grant, deny or revoke that code (PK-Q26). This is the merged behaviour
  of PR #899 and MUST hold unchanged once the code is in the catalog.
- **FR-B03**: The system MUST expose a read of one business's effective switch value (a boolean; a missing row, a
  null and `false` all mean off) and a write that sets it to a required boolean. Both require
  `manage:imported-refunds:business` on that business and a human session.
- **FR-B04**: The generic business-settings write MUST keep refusing the switch field, and
  `manage:settings:business` alone MUST NOT read or write it.
- **FR-B05**: A write that changes the effective value MUST store it and append exactly one audit entry (actor,
  time, business, previous stored value, new value) in the same transaction; if the audit entry cannot be written
  the value is not changed. A write that does not change the effective value MUST NOT change the
  stored value and MUST NOT add an audit entry (the locking step may create the business's empty settings row,
  as every settings write does today).
- **FR-B06**: A write MUST re-check the caller's permission after it has taken its locks, so a revocation that
  commits first wins.
- **FR-B07**: The write MUST touch only the switch (and the row's `updated_by` / `updated_at`); every other
  setting of the business keeps its value.
- **FR-B08**: The admin MUST show the switch on its own page with its own navigation entry, visible only to a user
  for whom the read succeeds. A grantee without any other settings permission MUST still reach it.
- **FR-B09**: Enabling the switch MUST NOT grant `refund:packages:branch`, bypass the `orders` feature, or change
  any refund rule; the refund use case, its route and its tests stay as merged in PR #999.
- **FR-B10**: The permission MUST have an Arabic and an English display name on the permissions screen.

### Key Entities

- **Customer package (entitlement)**: read-only here; the list item and detail shapes of
  `packages/contracts/src/orders/customer-packages.ts`.
- **Business settings row**: one per business; this delivery writes one existing nullable column,
  `imported_refunds_enabled`.
- **Permission `manage:imported-refunds:business`**: business scope; already known to the policy layer, not yet in
  the activation catalog.
- **Audit entry**: one per effective change of the switch.

## Slice design *(mandatory — `CLAUDE.md` §1)*

### Business rules

- **BR-A1** (PK-Q17, PP-16.6): reception and holders of `read:service-sessions:branch` see the same list and
  detail, amounts and history included. Enforced by the merged `RequireAny` guard; the screen adds no rule.
- **BR-A2** (PP-189, 45-UI-Q2/Q3): the Extend button follows the server's `can_extend` only.
- **BR-B1** (PK-Q24): imported refunds are off until switched on per business. Stored `NULL` = off.
- **BR-B2** (PK-Q26): the switch is written under `manage:imported-refunds:business`: owner by default; only the
  owner grants or revokes it; a grantee may switch but not delegate.
- **BR-B3** (TD-14, FR-053; merged): an `IMPORTED` refund while the switch is not `true` → 422
  `IMPORTED_REFUND_DISABLED`; a `SOLD` refund never reads it. Unchanged by this delivery.
- No arithmetic is added anywhere. Amounts on the screen are the three-decimal strings the reads return, formatted
  for display only.

### Schema changes

| Table | Columns added / changed | RLS policy | Indexes | Tenant-qualified FKs |
|---|---|---|---|---|
| none | none — `business_settings.imported_refunds_enabled` exists since migration `0223_2026-11-13_package-refunds.sql` | unchanged (`business_settings_select/insert/update`, `0023`) | none | none |

**One data-only migration** (custom SQL, no schema change, shaped like `0148_2026-10-17_business-identity-permission.sql`):
insert the code into `permissions` and one `role_permissions` row for the global owner role, both
`ON CONFLICT DO NOTHING`. It is required, not optional: `permission_overrides.permission_code` and
`role_permissions.permission_code` reference `permissions(code)`, and the deploy `migrate` step runs
`packages/db/scripts/migrate.ts`, which does not call `seedReferenceData` (research §3). Its number is assigned in
the manager's migration lane; none is reserved here. Grants: none — `pospay_app` already holds table-level
`SELECT, INSERT, UPDATE` on `business_settings` and no later migration revokes it.

### API contract

**42-4**: no change. Consumed as merged:

- `GET /v1/businesses/{businessId}/branches/{branchId}/customers/{customerId}/packages` (FR-070)
- `GET /v1/businesses/{businessId}/branches/{branchId}/customers/{customerId}/packages/{entitlementId}` (FR-071)
- both `@RequireAny(['record:service-sessions:branch', 'read:service-sessions:branch'], { branch: 'branchId' })`
  and `@RequiresFeature('orders')`.

**46-2a-S** (new; path proposed in the archived 46-2a planning brief, not previously approved as a contract):

- **Endpoint**: `GET /v1/businesses/{businessId}/settings/imported-refunds` and
  `PUT /v1/businesses/{businessId}/settings/imported-refunds` · guard
  `@Require('manage:imported-refunds:business', { business: 'businessId' })` on both · feature flag: none (the
  neighbouring business-identity and rating-settings routes carry none; none is invented).
- **Request / response**: Zod in `packages/contracts/src/settings/imported-refunds.ts` — request
  `z.strictObject({ imported_refunds_enabled: z.boolean() })`; response `{ imported_refunds_enabled: boolean }`
  (effective value). No tenant or actor field is accepted from the body.
- **Idempotency-Key**: not required. The write creates no money or stock effect, a repeat of the same value is a
  no-op, and the neighbouring `PUT …/rating-settings` switch carries none.
- **Errors**: 400 `VALIDATION_FAILED` (missing field, non-boolean or unknown body key); 403
  `FORBIDDEN` (no permission, DENY, device, permission lost under the lock, malformed business scope, or foreign business —
  the same answer, so existence is not disclosed). Existing codes only; no new error code.

### Permissions

- `manage:imported-refunds:business` — business scope. Default: owner only. Grantable by the owner to any human
  system role or custom role; never a device (`deviceForbidden`, merged). Only the owner saves or revokes it
  (`OWNER_GRANTED_PERMISSIONS`, `OWNER_ONLY_EDIT_PERMISSIONS`, merged in PR #899).
- `record:service-sessions:branch` / `read:service-sessions:branch` (exist) — the packages screen.
- `extend:packages:branch` (exists) — surfaces only as the server's `can_extend`.

### Events

- **Published**: none. The switch has no consumer; the audit entry is the record.
- **Consumed**: none.

### Test plan

- **Domain unit**: none new for arithmetic (there is none). Pure admin model helpers (state labels, name fallback,
  id validation of the address) get unit tests.
- **Integration scenarios** (real Postgres, the slice's own specs):
  - `IRS-01` default off: no settings row → GET false; row with NULL → false; stored false → false.
  - `IRS-02` owner sets true → GET true, row updated, one audit entry `before {null}` / `after {true}`; sets false →
    second entry; `updated_by` is the actor; `default_language`, `calendar`, `limit_bps`, official names and logo
    of a pre-filled row are unchanged.
  - `IRS-03` same effective value (true→true, NULL→false, no row→false) → 200, the stored value unchanged (NULL
    stays NULL; with no row, at most an empty row appears), no audit entry.
  - `IRS-04` authorization matrix on GET and PUT: owner 200; owner-granted human 200; general manager with
    `manage:settings:business` only 403; explicit DENY 403; expired membership 403; grant on another business 403;
    another company's business 403; device 403; anonymous 401.
  - `IRS-05` contract: missing field, string, null, extra key → 400; generic `PATCH …/settings` with
    `imported_refunds_enabled` → 400 and the column untouched.
  - `IRS-06` races on two real connections: two first writes on a business with no row → serialized, both audit
    `before` values true to the committed order; a revocation committing while the grantee's write waits → 403, no
    change, no audit entry.
  - `IRS-07` audit failure rolls the value back (the audit writer made to throw).
  - `IRS-08` activation: after the migration chain the `permissions` row and exactly one global default (owner)
    exist; `seedReferenceData` yields the same; the owner grants the code to each human system role and to a custom
    role (201), a device is refused; a non-owner grantee with membership-management authority cannot SAVE ALLOW,
    SAVE DENY or REVOKE this code (`PERMISSION_OWNER_ONLY`). A grantee without that management authority receives
    the ordinary refusal. The owner can revoke the grant.
  - `IRS-09` effect on the reader: after PUT true `readImportedRefundsEnabled` returns true in a new transaction;
    after PUT false it returns false. The merged refund specs (`package-refund-imported.spec.ts`) run unchanged.
- **RLS negative**: no new table. Add one cross-tenant case for the new write path: company A's caller naming
  company B's business id gets 403 and B's row is unchanged.
- **Queries**: the new settings read gets a result-shape test and an `EXPLAIN` assertion that it uses the
  `business_settings` primary key (`company_id, business_id`).
- **UI (visible outcomes, never mock-call-only)**:
  - packages screen: loading, empty, list order and marks, pagination without duplicates, 403, 404, retry;
    detail for sold and imported; `can_extend` true / false; refresh after extension; the three entry links
    render the right address; no phone text anywhere; denial supersedes preseeded data and scope/customer changes
    close open detail or extend actions, even when an old request completes; Arabic and English.
  - switch page: off / on, pending, saved, failed save keeps the confirmed value, 403 hides page content,
    navigation entry hidden on 403, shown on 200; business change refetches.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From any of the three entry points a user reaches a customer's packages in one click and a package's
  detail in one more.
- **SC-002**: A holder of only one of the two session permissions sees every field of FR-A03 and FR-A05; a user
  with neither sees none.
- **SC-003**: An owner can enable imported refunds for a business without any database or operator step, and the
  very next imported refund is accepted; after disabling, the very next one is refused.
- **SC-004**: Every effective change of the switch has exactly one audit entry naming who changed it and both
  values; a no-op has none.
- **SC-005**: No customer phone and no customer name appears in an address, and no phone appears on the packages
  screen.
- **SC-006**: The refund use case, route and tests of PR #999 are byte-for-byte unchanged by the implementation PR.

## Assumptions

- The screen is an admin screen. `apps/pos` has no package file at the pin, and no row of spec 058 puts this
  screen in the POS.
- Entry from surfaces where the customer is already known satisfies CP-01 ("Reception opens نورة's packages").
  A search-by-phone that never creates a customer does not exist at the pin (the only customer routes are
  `find-or-create` and `profile`, both under `create:customers:*`) and is outside this delivery.
- The read of the switch for the page uses the same permission as the write, as the rating-requests switch does;
  no separate "capability" route is added.
- The switch page lives under a new admin business area folder for this setting, beside business identity in the
  navigation, as the archived 46-2a planning brief proposed.
- The owner authorized S development and migration testing on the isolated local lane before U. Applying the
  migration to a target environment requires U. See [the owner decision](pending-manager-items.ar.md) and research §5.
