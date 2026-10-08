# Feature Specification: Catalog package types — create and update

**Feature Branch**: `feat/p1-33-package-types`

**Created**: 2026-10-08

**Status**: Draft — owner questions decided 2026-10-08 (Waleed). Ready for `/speckit-plan`.

**Input**: User description: "catalog-package-types — Phase 1 PR 33."

**Phase 1 row**: PR 33 "package types" (`docs/specs/phase-1/IMPLEMENTATION-PLAN.md`), depends on PR 32 services
(#114, `425fc14`, spec 031). Feeds PR 42 `sell-package` and PR 47 open-package import, which value a sold package
with the pure allocation of spec 007 (PR 31). Sources: SPEC §2 (catalog: package types), §3 (`CatalogReaderPort` …
package-type components), §4 `PackageType`, §8 Packages; PRD D-30, D-42, D-48, D-51, D-55; ADR-0010, ADR-0035;
spec 007 PKG-11 (365-session cap, owner decision 2026-10-03). The Arabic questions and answers are in
`owner-questions.ar.md`.

## Owner questions

All twelve were settled by Waleed on 2026-10-08; each took the recommended option.

- **PT-Q1 — Who may create and edit package types.** Decided (A): new permissions `manage:package-types:business` and
  `read:package-types:business`, given by default to the same three managers as services (owner, general manager,
  business manager). Separate from the services codes so the owner can delegate one without the other.
- **PT-Q2 — How long a package can be valid.** Decided (A): a whole number of days from **1 to 730** (two years). A
  package always expires (SPEC §4 `expires_on` is mandatory); "never expires" is not offered.
- **PT-Q3 — What "valid N days" means on the calendar.** Decided (A): last usable day = **sale date + N days**, usable
  until the end of that day in branch time (D-51). Sold 1 October with 30 days → usable through 31 October. Applied
  by PR 42; this slice states it in the form's help text.
- **PT-Q4 — Editing a package type that has already been sold.** Decided (A): names, price, validity and services are
  all editable at any time. Customers who already bought keep exactly what they bought — their services, sessions,
  values and expiry are fixed at sale (SPEC §4/§8).
- **PT-Q5 — Stopping sales of a package type.** Decided (A): not in this PR. A separate plan row **33b** ("stop
  selling / resume selling a package type", depends on 33) lands before PR 42, so the sale screen offers only active
  types.
- **PT-Q6 — Package price compared with the services inside it.** Decided (A): no rule. Any price from 0.000 upward,
  above or below the sum of the services' own prices. Discount control stays on the sale line (SPEC §4).
- **PT-Q7 — Free (0.000) services inside a package.** Decided (A): allowed. A free service's sessions are worth 0.000
  inside the package (SPEC §8 weights by list price), so its performer earns no commission on those sessions.
- **PT-Q8 — Two package types with the same name.** Decided (A): not allowed. The English name is unique within the
  business, ignoring letter case and surrounding spaces; the Arabic name likewise when given.
- **PT-Q9 — Maximum number of services in one package type.** Decided (A): **20**.
- **PT-Q10 — Where a package type can be sold and used.** Decided (A): in every branch of the business; no
  per-branch list.
- **PT-Q11 — Admin screen in this PR.** Decided (A): yes — list, create and edit screens ship with the API, as
  services did in PR 32.
- **PT-Q12 — Package-sale commission (D-55 versus D-51 / SPEC §5.6).** Decided: **per commission plan.** The system
  supports a seller's package-sale commission (SPEC §5.6, D-51), switched on or off in each plan version
  (`package_sale.enabled`). The salon's four real plans (D-55) pay none; another business may enable it in its plan.
  No change to this slice's scope: a package type stores no commission rule.

### Documents to update (outside this slice's code)

- `docs/PRD.md` D-55 (line ~1001): clarify "selling a package pays no commission" to read "**these plans** pay no
  package-sale commission (`package_sale` disabled); the system supports one per plan (SPEC §5.6, D-51)" — PT-Q12.
- `docs/specs/phase-1/IMPLEMENTATION-PLAN.md`: row **33b** added after row 33 (PT-Q5) — done in this commit.

### Already decided elsewhere

- A package type belongs to one business (D-30 "packages … stay per business"); English name required, Arabic
  optional (CLAUDE.md §5 bilingual rule, as services).
- It has a price (KWD, 3 decimals, ≥ 0.000), a validity in days, and one or more services each with a session count
  (SPEC §4).
- Validation (SPEC §4, spec 007 PKG-11): at least one service; a service appears once; sessions are whole numbers from
  1 to 365 (owner, 2026-10-03); price ≥ 0. Rejections are named.
- No instalments and no sharing between customers (D-42). Paid in full at sale (D-51) — PR 42, not here.
- Sold packages snapshot their services, list prices, sessions and expiry (SPEC §4 `PackageComponent`,
  `PackageEntitlement`), so this slice never touches a sold package.
- No package-type import: D-48 lists employees, services, customers and open packages only.

### How the plan row splits

Plan row 33 says "package types", not "(create / update)". PR 32's row named "services (create / update)" and shipped
both in one PR (#114, spec 031) because they share one table, one validator and one form; PR 33 follows that
precedent: **create + update (+ list and detail reads)** in one PR. "Stop selling" is row 33b (PT-Q5).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The manager defines a package the salon sells (Priority: P1)

The salon sells "10 blow-dry sessions for 25.000 KWD, valid 3 months". The business manager opens the package types
page, adds a package named "Blow-dry ×10" (Arabic "١٠ سشوار"), price 25.000, validity 90 days, with one service,
Blow-dry, ×10 sessions. It appears in the list. Who created it and when is recorded.

**Why this priority**: PR 42 cannot sell a package that was never defined.

**Independent Test**: Create the type above, read it back in the list and the detail, and read its audit entry.

**Acceptance Scenarios**:

1. **Given** a business with the service "Blow-dry", **When** a manager creates the package above, **Then** it is
   saved with exactly those values and one audit entry holding the new package type.
2. **Given** a mixed package "Bridal: 1 hair-do + 1 make-up + 2 manicures, 60.000, 30 days", **When** it is created,
   **Then** the three services and their counts are stored in the order given.
3. **Given** the same service listed twice, or 0 or 366 sessions, or no services, or 21 services, or a negative
   price, or validity 0 or 731 days, **When** saving, **Then** it is refused with the named reason and nothing is
   saved.
4. **Given** a service of another business or another company, **When** it is put in a package, **Then** it is refused
   exactly like an unknown service.
5. **Given** a package type "Blow-dry ×10" already exists in the business, **When** a manager creates " blow-dry ×10 ",
   **Then** it is refused as a name already taken; the same name in another business is accepted.
6. **Given** "5 cuts + 5 hair washes" where the wash service costs 0.000, **When** it is saved, **Then** it is accepted
   (PT-Q7); the form tells the manager the wash sessions will be worth 0.000.

---

### User Story 2 - The manager changes a package (Priority: P1)

The salon raises "Blow-dry ×10" to 27.500 and adds 2 hair-wash sessions. The manager edits the type. Customers who
bought the old version keep their 10 sessions at the old values; new sales use the new definition (from PR 42).

**Why this priority**: prices and offers change; without editing, the manager would duplicate types.

**Independent Test**: Edit price, validity and services; read the new values, the bumped revision and an audit entry
holding before and after.

**Acceptance Scenarios**:

1. **Given** a package type at revision 1, **When** the manager saves changes to names, price, validity and services
   with revision 1, **Then** it is at revision 2 and the audit entry holds the old and new definitions, services
   included.
2. **Given** two managers editing the same type, **When** the second saves with the old revision, **Then** it is
   refused as a conflict and changes nothing.
3. **Given** a save with no change, **Then** the type is returned unchanged and no audit entry is written.
4. **Given** an edit renaming the type to the name of another type in the same business, **Then** it is refused as a
   name already taken.

---

### User Story 3 - Managers see the package menu (Priority: P2)

A manager opens the list to check prices and validity before a customer asks.

**Independent Test**: List with paging; open one type; another business's types never appear.

**Acceptance Scenarios**:

1. **Given** 150 package types, **When** the list is read, **Then** it pages by cursor, never writes, and each row
   shows names, price, validity and the number of services.
2. **Given** a package type of another business or company, **When** it is opened, **Then** the answer is "not
   found", identical to an unknown id.

### Edge Cases

- Price 0.000 is valid (SPEC §4 price ≥ 0): a free promotional package.
- A package of one service with one session is valid; 20 services is valid, 21 is refused.
- Validity 1 and 730 days are valid; 0 and 731 are refused.
- Price "25.5" (fewer than 3 decimals) is refused by the contract, as for services (SV-03 precedent).
- A package priced above the sum of its services' prices is accepted (PT-Q6).
- A zero-price service inside a package is accepted; its sessions will be worth 0.000 (PT-Q7).
- Names differing only in case or surrounding spaces collide within one business (PT-Q8).
- Editing a package never changes a sold package — sale snapshots (SPEC §4, PT-Q4).
- A business outside the caller's grant answers the guard's uniform 403; a foreign or unknown package-type id inside
  an allowed business answers the same 404 (spec 031 SV-07 precedent).
- The `catalog` feature switched off: every route answers like a disabled feature.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Holders of `manage:package-types:business` (by default owner, general manager and business manager) MUST
  be able to create a package type for one business with English name (required), Arabic name (optional), price,
  validity in days and one or more services with session counts.
- **FR-002**: The system MUST refuse, by name, a package type with no services, a repeated service, a session count
  that is not a whole number from 1 to 365, or a negative or out-of-range price (SPEC §4, PKG-11).
- **FR-003**: Validity MUST be a whole number of days from 1 to 730 (PT-Q2). The form's help text states that a
  package sold on date D is usable through the end of D + validity days, branch time (PT-Q3).
- **FR-004**: Every service in a package type MUST belong to the same business; any other service is refused as
  unknown. Services priced 0.000 are allowed (PT-Q7) and the form warns that their sessions are worth 0.000.
- **FR-005**: A package type MUST hold at most 20 services (PT-Q9).
- **FR-006**: The package price MUST NOT be constrained by its services' prices (PT-Q6).
- **FR-007**: The English name MUST be unique within the business, ignoring case and surrounding spaces; the Arabic
  name likewise when given (PT-Q8).
- **FR-008**: Holders of `manage:package-types:business` MUST be able to edit names, price, validity and services with
  the revision they read; a stale revision is a conflict (PT-Q4).
- **FR-009**: Every create and every effective edit MUST write one audit entry with before and after, services
  included (CLAUDE.md §8: prices are audited); a no-change edit writes none.
- **FR-010**: Holders of `read:package-types:business` MUST be able to list (cursor-paginated) and open package types
  of their business; nothing of another business or company is ever visible.
- **FR-011**: A package type is never deleted (master data that sold packages refer to). Stopping sales is row 33b
  (PT-Q5), not this PR.
- **FR-012**: A package type has no branch list; it applies to every branch of its business (PT-Q10).
- **FR-013**: The admin app MUST provide list, create and edit screens in this PR (PT-Q11).

### Key Entities

- **Package type**: what the business sells as a bundle — names, price, validity in days, revision; belongs to one
  business.
- **Package type service**: one line of the bundle — which service and how many sessions; one per service per type.
- **Service** (existing, spec 031): the business's service; a package type only refers to it.

## Slice design *(mandatory — `CLAUDE.md` §1)*

### Business rules

- **BR-001**: Validator rules: ≥ 1 and ≤ 20 components (PT-Q9), unique `service_id`, sessions integer 1…365, price ≥ 0
  and within `numeric(14,3)` (SPEC §4, PKG-11), validity integer 1…730 (PT-Q2), names as services (1–255 after trim,
  no control characters). Example: price 25.000 = `25000n` mills, validity 90, `[{service: Blow-dry, sessions: 10}]`
  → valid; `[{Blow-dry, 10}, {Blow-dry, 2}]` → `DUPLICATE_SERVICE`.
- **BR-002**: No valuation happens here. Slot values are computed at sale by spec 007's `allocatePackagePrice` and
  `createPackageSlots` from the services' list prices **at sale time** (`list_price_snapshot`, SPEC §4), not from
  anything stored on the type. A 0.000 service therefore yields 0.000 slots unless every service is 0.000 (SPEC §8).
- **BR-003**: An edit replaces the whole definition; sold entitlements are unaffected (SPEC §4 snapshots, PT-Q4).
- **BR-004**: Expiry meaning (applied by PR 42): `expires_on = sale_date (branch-local) + validity_days`; usable
  through the end of `expires_on` (PT-Q3, D-51, spec 007 PKG-09).
- **BR-005**: Name uniqueness compares `lower(trim(name))` within one business (PT-Q8).

### Technical decisions (orchestrator)

- **TD-1 — Where the package-type validator lives (decided by the orchestrator, 2026-10-08).** SPEC §4 line 137 asks
  for "one validator for types, sales and imports". It exists as `validatePackageDefinition` in
  `apps/api/src/modules/orders/domain/package-definition.ts` (PR 31), which `catalog/domain` may not import
  (CLAUDE.architecture.md §3.1; module map `catalog: [tenancy]`, `orders` reads catalog only by port). Decision,
  following ADR-0035 and with no new ADR: `catalog/domain` owns its own `validatePackageTypeDraft` with the same SPEC §4
  rules (plus validity and the 20-component cap, which are type-only). A **shared table of definition cases** (input
  → accepted or the expected rule code) is one data-only fixture file outside every module (under `apps/api/test/`,
  beside `permissions-fixture.ts`), asserted by a unit test in `catalog/domain/__tests__` **and** one in
  `orders/domain/__tests__`, so the two validators cannot drift. PR 31's source files stay byte-identical; only a new
  orders test file is added.
- **TD-2 — Component storage.** A child table with a tenant-qualified composite FK to `services (company_id,
  business_id, id)` (the unique key PR 32 created), so a cross-business service is impossible at the database. An
  update replaces the component set (DELETE + INSERT in the same transaction), so the child table — and only it —
  gets a `DELETE` grant; the audit entry keeps the old set.
- **TD-3 — No `Idempotency-Key` and no event**, as PR 32: master data with no money or stock effect (CLAUDE.md §6);
  `orders` reads components through `CatalogReaderPort` at sale (ADR-0010), and nothing subscribes to a
  package-type change.
- **TD-4 — Migration numbers** are assigned at merge (constitution 3.0.0); main is at `0088`.

### Schema changes

| Table | Columns | RLS / grants | Indexes / FKs |
|---|---|---|---|
| `package_types` | company_id, id, business_id, name_en, name_ar?, price numeric(14,3), validity_days integer, revision int default 1, created_at, updated_at | ENABLE + FORCE; SELECT/INSERT/UPDATE `USING` + `WITH CHECK company_id = app_company_id()`; column UPDATE (name_en, name_ar, price, validity_days, revision, updated_at); no DELETE | PK (company_id, id); unique (company_id, business_id, id) — list + cursor; FK (company_id, business_id) → businesses; unique index (company_id, business_id, lower(trim(name_en))); unique index (company_id, business_id, lower(trim(name_ar))) WHERE name_ar IS NOT NULL |
| `package_type_components` | company_id, id, package_type_id, business_id, service_id, sessions integer, position smallint | ENABLE + FORCE; SELECT/INSERT/DELETE by `company_id = app_company_id()`; no UPDATE | PK (company_id, id); UNIQUE (company_id, package_type_id, service_id); UNIQUE (company_id, package_type_id, position); FK (company_id, business_id, package_type_id) → package_types (company_id, business_id, id); FK (company_id, business_id, service_id) → services (company_id, business_id, id); index (company_id, service_id) for the FK |

CHECKs mirror the validator: names 1–255 after trim with no control characters (as `services`); price
0…99999999999.999; `validity_days BETWEEN 1 AND 730`; `sessions BETWEEN 1 AND 365`; `position BETWEEN 1 AND 20`;
revision > 0. "At least one component" is enforced in `catalog/domain` (a row CHECK cannot count siblings); "at most 20" is
enforced in `catalog/domain` and in the database by `position BETWEEN 1 AND 20` plus
`UNIQUE (company_id, package_type_id, position)` (database review, round 2); both are tested end to end. No branch column (PT-Q10). No commission column (PT-Q12).

### API contract

- `POST /v1/businesses/{businessId}/package-types` → 201 `PackageTypeDetail`; body `CreatePackageTypeInput`.
- `GET /v1/businesses/{businessId}/package-types` → 200 `PackageTypePage`; cursor by `id`, limit 1–100.
- `GET /v1/businesses/{businessId}/package-types/{packageTypeId}` → 200 `PackageTypeDetail` (with components and
  service names and prices, for the form's 0.000 warning).
- `PATCH /v1/businesses/{businessId}/package-types/{packageTypeId}` → 200 `PackageTypeDetail`; body
  `UpdatePackageTypeInput` = `expected_revision` + the full editable definition (full replacement, as PR 32's
  layer-2 fix: an omitted field is a validation error, never a silent default).
- Guards: write routes `@Require('manage:package-types:business', { business: 'businessId' })`, read routes
  `@Require('read:package-types:business', …)`; all `@RequiresFeature('catalog')`.
- Zod in `packages/contracts/src/catalog/package-type.ts`: price as a 3-decimal string, `validity_days` integer
  1–730, `components: [{ service_id: uuid, sessions: int 1–365 }]` with min 1 / max 20.
- Errors: `PACKAGE_TYPE_NOT_FOUND` (404), `PACKAGE_TYPE_INVALID_COMPONENTS` (400, empty or over 20),
  `PACKAGE_TYPE_DUPLICATE_SERVICE` (400), `PACKAGE_TYPE_INVALID_SESSIONS` (400), `PACKAGE_TYPE_PRICE_INVALID` (400),
  `PACKAGE_TYPE_VALIDITY_INVALID` (400), `PACKAGE_TYPE_SERVICE_NOT_FOUND` (400 — unknown, foreign or other-business
  service, one answer), `PACKAGE_TYPE_NAME_TAKEN` (409), `PACKAGE_TYPE_REVISION_CONFLICT` (409); each with
  `message_ar` / `message_en`. A unique-index violation maps to `PACKAGE_TYPE_NAME_TAKEN` by constraint name.

### Permissions

New `manage:package-types:business` and `read:package-types:business` (PT-Q1) in `access-catalog.ts`,
`role-defaults.ts` and `system-role-policy.ts`, seeded for owner, general manager and business manager exactly as
migration 0084 seeded the services codes; other system roles forbidden by the PR 7 matrix; never held by the Device
role; a custom role may receive a scoped personal ALLOW under the existing policy.

### Events

- **Published**: none (TD-3).
- **Consumed**: none.

### The 200 ms rule

Create/update write one row, up to 20 component rows and one audit row in one tenant transaction; reads are indexed
cursor pages. Synchronous in `api`.

### Test plan

- **Domain unit** (`catalog/domain/__tests__/package-type.spec.ts`): every BR-001 rejection by name; sessions 0, 1,
  365, 366, 1.5; validity 0, 1, 730, 731, 1.5; price 0, max, overflow; 1, 20 and 21 components; names (trim, length,
  control characters); update no-op detection.
- **Shared definition cases (TD-1)**: the fixture table asserted in `catalog/domain/__tests__` and
  `orders/domain/__tests__` (orders checks only the shared SPEC §4 rows; validity and the cap are catalog-only rows).
- **Integration** (`catalog/__tests__/package-types.spec.ts`): `PT-01` create happy path + audit · `PT-02` mixed
  three-service package keeps order · `PT-03` each invalid input → its named error, nothing saved · `PT-04` service
  of another business / company / unknown → `PACKAGE_TYPE_SERVICE_NOT_FOUND` · `PT-05` update of names, price,
  validity and services bumps revision, audit holds before/after components · `PT-06` stale revision → 409 · `PT-07`
  no-op update writes no audit · `PT-08` permission refused / Device refused / feature off · `PT-09` foreign tenant or
  business → 404 · `PT-10` duplicate name (case and spaces) → 409 on create and on rename; same name in another
  business accepted · `PT-11` zero-price service accepted · `PT-12` 20 services accepted, 21 refused; validity 730
  accepted, 731 refused.
- **RLS negative** (`packages/db/src/__tests__/rls-catalog-package-types.spec.ts`): cross-tenant read = 0 rows on
  both tables; cross-tenant insert/update/delete rejected; a component pointing at another tenant's or another
  business's service rejected by the FK; grant allowlist updated in `privileges.spec.ts`; role defaults updated in
  `role-defaults.spec.ts` / `system-role-policy.spec.ts`.
- **Queries**: result-shape test + `EXPLAIN ANALYZE` index assertion for the list and the detail query.
- **Admin UI** (PT-Q11): list, create and edit forms; KWD 3 dp as a string; validity help text with the PT-Q3 example;
  zero-price warning; component rows add/remove, at most 20; ar/en; RTL; form and hook specs as in PR 32.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A manager can define the salon's real packages (e.g. 10 blow-dry for 25.000, 90 days) in under two
  minutes each, without help.
- **SC-002**: 100% of invalid definitions listed in SPEC §4 and this spec are refused with a reason the manager can
  read in Arabic and English; none is saved.
- **SC-003**: No package type, and no service inside one, is ever visible or usable across businesses or companies.
- **SC-004**: Every price change on a package type can be traced to who made it, when, and from what to what.
- **SC-005**: Editing a package type changes no package a customer already bought (verified again in PR 42).

## Assumptions

- Admin is online (as services).
- The `catalog` feature flag exists and gates these routes (seeded in PR 32).
- Services exist before package types; deleting a service is impossible today (spec 031 SV-09), so a component's
  service cannot disappear.
- The package's discount limit is checked on its sale line in PR 42 (SPEC §4), not here.
- Package-sale commission is per plan (PT-Q12, SPEC §5.6) and belongs to PRs 42/50; nothing here stores a commission
  rule.

## Implementation notes (orchestrator, 2026-10-08)

- `package_type_components` has `PRIMARY KEY (company_id, id)`, as CLAUDE.md §5 and ADR-0007 require. The natural key is kept as `UNIQUE (company_id, package_type_id, service_id)`. The composite FKs stay tenant-qualified.
- New error `PACKAGE_TYPE_NAME_INVALID` (400, Arabic and English) for a name that is blank or too long.
- The admin service picker needs `read:services:business`. The three default managers hold it together with the package-type permissions.
