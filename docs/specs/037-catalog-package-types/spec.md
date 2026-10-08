# Feature Specification: Catalog package types — create and update

**Feature Branch**: `feat/p1-33-package-types`

**Created**: 2026-10-08

**Status**: Draft — owner questions **PENDING**. Not ready for `/speckit-plan` until PT-Q1…PT-Q11 are answered.

**Input**: User description: "catalog-package-types — Phase 1 PR 33."

**Phase 1 row**: PR 33 "package types" (`docs/specs/phase-1/IMPLEMENTATION-PLAN.md` line 76), depends on PR 32
services (#114, `425fc14`, spec 031). Feeds PR 42 `sell-package` and PR 47 open-package import, which value a sold
package with the pure allocation of spec 007 (PR 31). Sources: SPEC §2 (catalog: package types), §3
(`CatalogReaderPort` … package-type components), §4 `PackageType`, §8 Packages; PRD D-30, D-42, D-48, D-51;
ADR-0010, ADR-0035; spec 007 PKG-11 (365-session cap, owner decision 2026-10-03).

## Owner questions

Every question below is a business rule the documents do not settle. Options are listed with the recommendation
first. Nothing in this spec guesses an answer: each open point is a `[NEEDS CLARIFICATION]` below until decided.

- **PT-Q1 — Who may create and edit package types.** **PENDING.**
  (A, recommended) New permissions `manage:package-types:business` and `read:package-types:business`, given by
  default to the same three managers as services (owner, general manager, business manager).
  (B) Reuse the services permissions — whoever edits services also edits packages.
  (C) One wider `manage:catalog:business` for both, replacing the two services codes.
  *Why:* a package price is a separate commercial decision; separate codes let the owner delegate one without the
  other, and identical defaults mean nothing changes on day one. Spec 031 SV-Q1 already pointed this way.
- **PT-Q2 — How long a package can be valid.** **PENDING.** Validity is always set in whole days (SPEC §4
  `validity_days`; every sold package has an expiry date, SPEC §4 `expires_on`).
  (A, recommended) 1 to 730 days (two years). (B) 1 to 365 days. (C) 1 to 3650 days.
  (D) Also allow "never expires" — needs a SPEC change, since a sold package's expiry date is mandatory today.
  *Why:* a ceiling catches a typo (9000 instead of 90) before it reaches a customer.
- **PT-Q3 — What "valid 30 days" means on the calendar.** **PENDING.** Applied at sale (PR 42), but the
  number the manager types here must mean one thing.
  (A, recommended) Last usable day = sale date + validity days: sold 1 October, 30 days → usable through 31 October
  (until the end of that day, branch time, D-51).
  (B) The sale day is day 1: sold 1 October, 30 days → last usable day 30 October.
  *Why:* (A) is the simplest rule to explain and never shortchanges the customer by a day.
- **PT-Q4 — Editing a package type that has already been sold.** **PENDING.**
  (A, recommended) Names, price, validity and services are all editable at any time; customers who already bought
  keep exactly what they bought (their services, sessions, values and expiry are fixed at sale, SPEC §4/§8).
  (B) Price, names and validity editable; the list of services locked once any customer bought the type.
  (C) Nothing editable after the first sale — the manager creates a new type instead.
  *Why:* the sale already copies everything it needs, so an edit can never change a sold package; (B) and (C) would
  also make the catalog read the sales module, which the module map does not allow today.
- **PT-Q5 — Stopping sales of a package type.** **PENDING.**
  (A, recommended) Not in this PR. A small follow-up row ("stop selling / resume selling", 33b) lands before
  PR 42, so the sale screen only offers active types. Same choice as services (SV-Q3).
  (B) Add it to this PR (a second use case in one PR).
  (C) Never — old types stay sellable.
  *Why:* one use case per PR; nothing sells a package until PR 42, so the follow-up costs no time.
- **PT-Q6 — Package price compared with the services inside it.** **PENDING.**
  (A, recommended) No rule: any price from 0.000 upward, above or below the sum of the services' own prices.
  (B) The package price may not exceed the sum of its services' prices.
  (C) No block, but the form shows the sum and the saving so the manager sees it before saving.
  *Why:* SPEC §4 only requires price ≥ 0; discount control happens on the sale line against this price (SPEC §4).
- **PT-Q7 — Free (0.000) services inside a package.** **PENDING.**
  (A, recommended) Allowed. Consequence the owner must accept: a free service's sessions are worth 0.000 inside the
  package (SPEC §8 values sessions by the services' prices), so its performer earns nothing on those sessions.
  (B) Refused — every service in a package must have a price above zero.
  *Why:* SPEC §8 already defines the zero-price case; (B) only matters if the owner wants those sessions to carry
  commission, which would need a price on the service.
- **PT-Q8 — Two package types with the same name.** **PENDING.**
  (A, recommended) Not allowed: the English name is unique within the business (ignoring case and surrounding
  spaces); the Arabic name likewise when given.
  (B) Allowed, as for services (SV-Q2).
  *Why:* reception picks a package by name at sale; two "Bridal package" rows are a mistake waiting to happen, and
  packages have no importer that needs duplicates. Adding uniqueness later fails if duplicates already exist.
- **PT-Q9 — Maximum number of services in one package type.** **PENDING.**
  (A, recommended) Up to 20. (B) Up to 50. (C) No limit.
  *Why:* a guard against a mis-built package; the salon's largest real package is expected to hold a handful.
- **PT-Q10 — Where a package type can be sold and used.** **PENDING.**
  (A, recommended) In every branch of the business (packages are per business, D-30).
  (B) The manager picks the branches per package type.
  *Why:* the SPEC has no per-branch list; (B) adds a branch list here and a branch check to PRs 42–43.
- **PT-Q11 — Admin screen in this PR.** **PENDING.**
  (A, recommended) Yes: list, create and edit screens ship with the API, as services did in PR 32.
  (B) API only now; the screens ship with the sale screen (PR 42).
  *Why:* without a screen nobody can build the package menu before PR 42, and PR 32 set the precedent.

### Already decided — not asked again

- A package type belongs to one business (D-30 "packages … stay per business"), with English name required and
  Arabic optional (CLAUDE.md §5 bilingual rule, as services).
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
precedent: **create + update (+ list and detail reads)** in one PR. "Stop selling" is the separate use case of PT-Q5.

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
3. **Given** the same service listed twice, or 0 or 366 sessions, or no services, or a negative price, **When** saving,
   **Then** it is refused with the named reason and nothing is saved.
4. **Given** a service of another business or another company, **When** it is put in a package, **Then** it is refused
   exactly like an unknown service.

---

### User Story 2 - The manager changes a package (Priority: P1)

The salon raises "Blow-dry ×10" to 27.500 and adds 2 hair-wash sessions. The manager edits the type. Customers who
bought the old version keep their 10 sessions at the old values; new sales use the new definition (from PR 42).

**Why this priority**: prices and offers change; without editing, the manager would duplicate types.

**Independent Test**: Edit price, validity and services; read the new values, the bumped revision and an audit entry
holding before and after.

**Acceptance Scenarios**:

1. **Given** a package type at revision 1, **When** the manager saves changes with revision 1, **Then** it is at
   revision 2 and the audit entry holds the old and new definitions, services included.
2. **Given** two managers editing the same type, **When** the second saves with the old revision, **Then** it is
   refused as a conflict and changes nothing.
3. **Given** a save with no change, **Then** the type is returned unchanged and no audit entry is written.

---

### User Story 3 - Reception and managers see the package menu (Priority: P2)

A manager opens the list to check prices and validity before a customer asks.

**Independent Test**: List with paging; open one type; another business's types never appear.

**Acceptance Scenarios**:

1. **Given** 150 package types, **When** the list is read, **Then** it pages by cursor, never writes, and each row
   shows names, price, validity and the number of services.
2. **Given** a package type of another business or company, **When** it is opened, **Then** the answer is "not
   found", identical to an unknown id.

### Edge Cases

- Price 0.000 is valid (SPEC §4 price ≥ 0): a free promotional package.
- A package of one service with one session is valid.
- Price "25.5" (fewer than 3 decimals) is refused by the contract, as for services (SV-03 precedent).
- A service whose own price is 0.000 inside a package — PT-Q7.
- A package whose price is above the sum of its services' prices — PT-Q6.
- Editing a package never changes a sold package — sale snapshots (SPEC §4); PT-Q4 decides what is editable.
- A business outside the caller's grant answers the guard's uniform 403; a foreign or unknown package-type id inside
  an allowed business answers the same 404 (spec 031 SV-07 precedent).
- The `catalog` feature switched off: every route answers like a disabled feature.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Authorised managers MUST be able to create a package type for one business with English name (required),
  Arabic name (optional), price, validity in days and one or more services with session counts.
  Permission: [NEEDS CLARIFICATION: PT-Q1].
- **FR-002**: The system MUST refuse, by name, a package type with no services, a repeated service, a session count
  that is not a whole number from 1 to 365, or a negative or out-of-range price (SPEC §4, PKG-11).
- **FR-003**: Validity MUST be a whole number of days within [NEEDS CLARIFICATION: PT-Q2 range]; its calendar meaning
  is [NEEDS CLARIFICATION: PT-Q3] and the form's help text states it.
- **FR-004**: Every service in a package type MUST belong to the same business; any other service is refused as
  unknown. Zero-price services: [NEEDS CLARIFICATION: PT-Q7].
- **FR-005**: The number of services in one package type MUST NOT exceed [NEEDS CLARIFICATION: PT-Q9].
- **FR-006**: The relation between the package price and its services' prices is [NEEDS CLARIFICATION: PT-Q6].
- **FR-007**: Names: [NEEDS CLARIFICATION: PT-Q8 — unique per business or duplicates allowed].
- **FR-008**: Authorised managers MUST be able to edit a package type with the revision they read; a stale revision is
  a conflict. Editable fields: [NEEDS CLARIFICATION: PT-Q4].
- **FR-009**: Every create and every effective edit MUST write one audit entry with before and after, services
  included (CLAUDE.md §8: prices are audited); a no-change edit writes none.
- **FR-010**: Managers with read access MUST be able to list (cursor-paginated) and open package types of their
  business; nothing of another business or company is ever visible.
- **FR-011**: A package type is never deleted (it is master data that sold packages refer to); stopping sales is
  [NEEDS CLARIFICATION: PT-Q5].
- **FR-012**: Availability across branches: [NEEDS CLARIFICATION: PT-Q10].
- **FR-013**: Screens for list, create and edit: [NEEDS CLARIFICATION: PT-Q11].

### Key Entities

- **Package type**: what the business sells as a bundle — names, price, validity in days, revision; belongs to one
  business.
- **Package type service**: one line of the bundle — which service and how many sessions; one per service per type.
- **Service** (existing, spec 031): the business's service; a package type only refers to it.

## Slice design *(mandatory — `CLAUDE.md` §1)*

Written for the recommended answers; each line that depends on a pending question names it.

### Business rules

- **BR-001**: Validator rules exactly as SPEC §4 and spec 007 PKG-11 (≥ 1 component, unique `service_id`, sessions
  integer 1…365, price ≥ 0, within `numeric(14,3)`), plus the PT-Q2 validity range and the PT-Q9 component cap.
  Example: price 25.000 = `25000n` mills, validity 90, `[{service: Blow-dry, sessions: 10}]` → valid;
  `[{Blow-dry, 10}, {Blow-dry, 2}]` → `DUPLICATE_SERVICE`.
- **BR-002**: No valuation happens here. Slot values are computed at sale by spec 007's `allocatePackagePrice` and `createPackageSlots` from the
  services' list prices **at sale time** (`list_price_snapshot`, SPEC §4), not from anything stored on the type.
- **BR-003**: An edit replaces the definition; sold entitlements are unaffected (SPEC §4 snapshots).

### Technical decisions for the orchestrator (not owner questions)

- **TD-1 — Where the package-type validator lives.** SPEC §4 line 137 asks for "one validator for types, sales and
  imports". It exists as `validatePackageDefinition` in `apps/api/src/modules/orders/domain/package-definition.ts`
  (PR 31), which `catalog/domain` may not import (CLAUDE.architecture.md §3.1 line 107; module map `catalog:
  [tenancy]`, `orders` reads catalog only by port). Options: (A, recommended) follow ADR-0035 — `catalog/domain`
  owns `validatePackageTypeDraft` with the same rules and named codes, and a fixture table of shared cases is
  copied into both modules' unit tests so drift fails a test; orders re-validates at sale with its own validator.
  (B) Move `validatePackageDefinition` and `MAX_PACKAGE_SESSIONS` into `packages/domain` — contradicts ADR-0035's
  "only runtime-neutral value primitives" and needs a superseding ADR. (A) keeps PR 31's files byte-identical.
- **TD-2 — Component storage.** A child table with a tenant-qualified composite FK to `services (company_id,
  business_id, id)` (the unique key PR 32 created), so a cross-business service is impossible at the database. An
  update replaces the component set (DELETE + INSERT in the same transaction), so the child table — and only it —
  gets a `DELETE` grant; the audit entry keeps the old set. Alternative: JSONB components, rejected (no FK).
- **TD-3 — No `Idempotency-Key` and no event**, as PR 32: master data with no money or stock effect (CLAUDE.md §6);
  `orders` reads components through `CatalogReaderPort` at sale (ADR-0010), and no consumer subscribes to a
  package-type change.
- **TD-4 — Migration numbers** are assigned at merge (constitution 3.0.0); main is at `0088`.

### Schema changes

| Table | Columns | RLS / grants | Indexes / FKs |
|---|---|---|---|
| `package_types` | company_id, id, business_id, name_en, name_ar?, price numeric(14,3), validity_days integer, revision int default 1, created_at, updated_at | ENABLE + FORCE; SELECT/INSERT/UPDATE `USING`+`WITH CHECK company_id = app_company_id()`; column UPDATE (name_en, name_ar, price, validity_days, revision, updated_at); no DELETE | PK (company_id, id); unique (company_id, business_id, id) — list + cursor; FK (company_id, business_id) → businesses; PT-Q8 (A): unique (company_id, business_id, lower(trim(name_en))) and the same on name_ar where not null |
| `package_type_components` | company_id, package_type_id, business_id, service_id, sessions integer, position smallint | ENABLE + FORCE; SELECT/INSERT/DELETE by `company_id = app_company_id()`; no UPDATE | PK (company_id, package_type_id, service_id); FK (company_id, business_id, package_type_id) → package_types (company_id, business_id, id); FK (company_id, business_id, service_id) → services (company_id, business_id, id); index (company_id, service_id) for the FK |

CHECKs mirror the validator: names 1–255 after trim with no control characters (as `services`); price 0…99999999999.999;
validity_days within the PT-Q2 range; sessions 1…365; revision > 0. The component count cap (PT-Q9) and "at least
one component" are enforced in `catalog/domain` (a row CHECK cannot count siblings) and tested end to end.

### API contract

- `POST /v1/businesses/{businessId}/package-types` → 201 `PackageType`; body `CreatePackageTypeInput`.
- `GET /v1/businesses/{businessId}/package-types` → 200 `PackageTypePage`; cursor by `id`, limit 1–100.
- `GET /v1/businesses/{businessId}/package-types/{packageTypeId}` → 200 `PackageTypeDetail` (with components and
  service names).
- `PATCH /v1/businesses/{businessId}/package-types/{packageTypeId}` → 200 `PackageTypeDetail`; body
  `UpdatePackageTypeInput` = `expected_revision` + the full editable definition (full replacement, as PR 32's
  layer-2 fix: an omitted field is a validation error, never a silent default).
- Guards: write routes `@Require('manage:package-types:business', { business: 'businessId' })`, read routes
  `read:package-types:business` (PT-Q1); all `@RequiresFeature('catalog')`.
- Zod in `packages/contracts/src/catalog/package-type.ts`: price as a 3-decimal string, `validity_days` integer,
  `components: [{ service_id: uuid, sessions: int }]` with min 1 / max PT-Q9.
- Errors: `PACKAGE_TYPE_NOT_FOUND` (404), `PACKAGE_TYPE_INVALID_COMPONENTS` (400, empty or over the cap),
  `PACKAGE_TYPE_DUPLICATE_SERVICE` (400), `PACKAGE_TYPE_INVALID_SESSIONS` (400), `PACKAGE_TYPE_PRICE_INVALID` (400),
  `PACKAGE_TYPE_VALIDITY_INVALID` (400), `PACKAGE_TYPE_SERVICE_NOT_FOUND` (400 — unknown, foreign or other-business
  service, one answer), `PACKAGE_TYPE_NAME_TAKEN` (409, PT-Q8 A), `PACKAGE_TYPE_REVISION_CONFLICT` (409); each with
  `message_ar` / `message_en`.

### Permissions

PT-Q1 (A): new `manage:package-types:business` and `read:package-types:business` in `access-catalog.ts`,
`role-defaults.ts` and `system-role-policy.ts`, seeded for owner, general manager and business manager exactly as
migration 0084 seeded the services codes; never held by the Device role.

### Events

- **Published**: none (TD-3).
- **Consumed**: none.

### The 200 ms rule

Create/update write one row, up to PT-Q9 component rows and one audit row in one tenant transaction; reads are
indexed cursor pages. Synchronous in `api`.

### Test plan

- **Domain unit** (`catalog/domain/__tests__/package-type.spec.ts`): every BR-001 rejection by name; sessions 0, 1,
  365, 366, 1.5; validity bounds; price 0, max, overflow; component cap and cap + 1; names; update no-op detection;
  the shared fixture table of TD-1.
- **Integration** (`catalog/__tests__/package-types.spec.ts`): `PT-01` create happy path + audit · `PT-02` mixed
  three-service package keeps order · `PT-03` each invalid input → its named error, nothing saved · `PT-04` service
  of another business / company / unknown → `PACKAGE_TYPE_SERVICE_NOT_FOUND` · `PT-05` update bumps revision, audit
  holds before/after components · `PT-06` stale revision → 409 · `PT-07` no-op update writes no audit · `PT-08`
  permission refused / device refused / feature off · `PT-09` foreign tenant or business → 404 · `PT-10` duplicate
  name → 409 (PT-Q8 A).
- **RLS negative** (`packages/db/src/__tests__/rls-catalog-package-types.spec.ts`): cross-tenant read = 0 rows on
  both tables; cross-tenant insert/update/delete rejected; a component pointing at another tenant's or another
  business's service rejected by the FK; grant allowlist updated in `privileges.spec.ts`.
- **Queries**: result-shape test + `EXPLAIN ANALYZE` index assertion for the list and the detail query.
- **Admin UI** (PT-Q11 A): list, create and edit forms; KWD 3 dp as a string; ar/en; RTL; component rows add/remove.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A manager can define the salon's real packages (e.g. 10 blow-dry for 25.000, 90 days) in under two
  minutes each, without help.
- **SC-002**: 100% of invalid definitions listed in SPEC §4 are refused with a reason the manager can read in Arabic
  and English; none is saved.
- **SC-003**: No package type, and no service inside one, is ever visible or usable across businesses or companies.
- **SC-004**: Every price change on a package type can be traced to who made it, when, and from what to what.
- **SC-005**: Editing a package type changes no package a customer already bought (verified again in PR 42).

## Assumptions

- Admin is online (as services).
- The `catalog` feature flag exists and gates these routes (seeded in PR 32).
- Services exist before package types; deleting a service is impossible today (spec 031 SV-09), so a component's
  service cannot disappear.
- The package's discount limit is checked on its sale line in PR 42 (SPEC §4), not here.
- Sale commission for packages (SPEC §5.6) is PR 42/50's concern; nothing here stores a commission rule.
