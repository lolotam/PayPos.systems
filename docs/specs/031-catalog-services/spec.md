# Feature Specification: Catalog services — create and update

**Created**: 2026-10-05
**Status**: Implementation slice; PR 32 (plan row 32, SPEC §2 catalog, §3 catalog module, §4 Service).
**Input**: Phase 1 plan row 32, SPEC §2 "catalog (minimal): services (price, commission rule, threshold flag)", §3
"`orders → catalog` via `CatalogReaderPort`", §4 `Service names · price · commission_rule · counts_toward_threshold`,
§5 (the commission engine consumes the rule), §5.7 (allowed combinations), ADR-0010, CLAUDE.md §5/§6/§8,
spec 013 create-employee, spec 017 update-employee, spec 030 employee import (the framework PR 32b reuses).

## User Scenarios & Testing

An authorised manager lists the business's services, adds one with its price and commission rule, and edits it when
a price or a rule changes. The change is audited and the next session recorded against the service uses the new
value. Nothing here touches money: a service is master data, a rule is a parameter the commission engine reads later.

**Independent Test**: create a service with a KWD price and a `PCT` rule, list it, update its price and rule, and
read the audit rows for both the creation and the price/rule change.

### Acceptance scenarios

- SV-01: a service is scoped to one business (`company_id` + `business_id`); another tenant or another business
  answers exactly like an unknown service (404), never "forbidden by scope".
- SV-02: `name_en` is required (1–255), `name_ar` optional (1–255); duplicate names are allowed (no uniqueness rule
  in the SPEC — the service import, PR 32b, resolves duplicates itself).
- SV-03: `price` is KWD with 3 decimals, `>= 0`; a zero price is allowed.
- SV-04: `commission_rule` is one of `FOLLOW_PLAN`, `ZERO`, `PCT` (bps, 0–10000) or `FIXED` (mills, `>= 0`).
  `counts_toward_threshold` is a boolean.
- SV-05: create and update each run in one tenant transaction; the row and its audit row commit together.
- SV-06: an update carries the expected revision; a stale revision returns `SERVICE_REVISION_CONFLICT` (409).
- SV-07: create/update require `manage:services:business` at the business and the `catalog` feature flag. The
  permission guard refuses a business outside the caller's grant with the same 403 whether it exists or not, so
  a missing or foreign business never reveals itself; a company-wide role naming a nonexistent business gets 404.
- SV-08: list is cursor-paginated by `id` and never writes; get returns one service or 404.
- SV-09: no service is deleted or soft-deleted here; the SPEC does not require it and `services` is not one of the
  soft-delete tables in CLAUDE.md §5.
- SV-10: no event is emitted: no Phase 1 consumer reads a service event; `orders` reads the price/rule through
  `CatalogReaderPort` at record time.

## Requirements

### Scope decision — business scope

`services` is **business-scoped** (`company_id` + `business_id`), matching the employee import (PR 11) and the
Phase 1 catalog row. A service is priced and configured per business; its commission rule must match that
business's commission plan versions, which are business-scoped. A company that runs two businesses keeps two
menus. This mirrors `employees`, `employee_salaries`, `import_previews` and `businesses`.

### Touched outside the slice

- `packages/domain` and `modules/commissions` remain byte-identical to main (decision 40, ADR-0035).
  Catalog owns its own rule type and validation in `catalog/domain`; the SPEC is the source of semantics.
  Consumers define their own port DTO and map every kind with an exhaustive `assertNever` switch and an
  all-kinds unit test when orders' `CatalogReaderPort` arrives in PR 35. No public rule export is needed now.
- `packages/db`: `catalog` feature flag already exists; two new permissions are added to the catalog and the
  default bundles; the new table, its RLS policy and its indexes.
- `docs/module-map.md`: `catalog: [tenancy]` already exists and gains no new arrow (the rule type lives in the
  catalog domain, not in `commissions`).

### Service rules

- SR-001: `name_en` required, 1–255 after trim; `name_ar` nullable, 1–255 after trim. No control characters.
- SR-002: `price` is `numeric(14,3)` in Postgres and `bigint` mills in TS; `>= 0` and `< 10^11 KWD`;
  the contract carries it as a 3-decimal string (`"0.000"`, `"12.500"`), never a JS number.
- SR-003: `commission_rule.kind` is one of `FOLLOW_PLAN | ZERO | PCT | FIXED`.
  - `PCT` requires an integer bps in `0…10000`; a `PCT` value is **not** `Percentage` (which is 0–100 with a
    scale); it is basis points.
  - `FIXED` requires mills `>= 0` and within `numeric(14,3)`.
  - `FOLLOW_PLAN` and `ZERO` carry no value.
- SR-004: a rule column and its value move together in one `UPDATE`; the old and new rules are both audited.
- SR-005: `counts_toward_threshold` defaults to `true` (a service counts unless the owner says otherwise).
- SR-006: PR 32b reuses `validateServiceDraft` (per row) and the contract, exactly as PR 11 reused
  `validateEmployeeCreation`; no second validation engine.

### Edge cases

- A business outside the caller's grant (another company's, deleted or nonexistent) is refused by the guard with
  one 403 for all three; a foreign or unknown service id inside an allowed business returns the same 404
  `SERVICE_NOT_FOUND`. Neither reveals that the target exists.
- SPEC §5/§5.7 imposes no FIXED-versus-price cap; FIXED may exceed the service price, including zero price.
- A `FIXED` rule whose value overflows `numeric(14,3)` is refused with `SERVICE_COMMISSION_RULE_INVALID` (400)
  before the write, not by a Postgres error.
- `PCT` `0` is valid (pay nothing) and distinct from `ZERO`.
- A no-op update (same values) is still a valid request; it writes no second audit row if nothing changed, and
  returns the unchanged row. If `expected_revision` is stale it still 409s.
- Price `"12.5"` (fewer than three decimals) is refused by the contract; the API requires exactly three decimals.
- A service created with `deleted_at` is impossible: the column does not exist.

## Slice design

### Schema changes

| Table      | Columns                                                                                                                                                 | RLS / grants                                                                                   | Indexes / FKs                                                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services` | company_id, id, business_id, name_en, name_ar?, price numeric(14,3), commission_rule_kind, commission_pct_bps?, commission_fixed_amount?, counts_toward_threshold bool default true, revision int default 1, created_at, updated_at | ENABLE + FORCE; SELECT/INSERT + column UPDATE(name_en, name_ar, price, commission_rule_kind, commission_pct_bps, commission_fixed_amount, counts_toward_threshold, revision, updated_at); no DELETE | PK (company_id, id); unique (company_id, business_id, id); FK (company_id, business_id) → businesses; the unique key serves the list and its cursor |

The rule is stored in validated columns, never a JSON number: `commission_rule_kind` plus exactly one of
`commission_pct_bps integer` (PCT) or `commission_fixed_amount numeric(14,3)` (FIXED). CHECK constraints keep the
three mutually consistent, so a malformed rule cannot exist in the table. This preserves "money is never a JS
number" and keeps the future `CatalogReaderPort` adapter trivial.

### API contract

- POST `/v1/businesses/{businessId}/services` → 201 `Service`; body `CreateServiceInput`.
  `manage:services:business` + `catalog` feature. Duplicate names allowed. No `Idempotency-Key`: creating master
  data has no money or stock effect (CLAUDE.md §6); the operation is safe to retry only by the client choosing a
  new id, so it is not an idempotent-retry surface.
- GET `/v1/businesses/{businessId}/services` → 200 `ServicePage`; cursor by `id`, limit 1–100.
  `read:services:business` + `catalog` feature.
- GET `/v1/businesses/{businessId}/services/{serviceId}` → 200 `ServiceDetail`; `read:services:business`.
- PATCH `/v1/businesses/{businessId}/services/{serviceId}` → 200 `ServiceDetail`; body `UpdateServiceInput`
  (`expected_revision` + the editable fields); `manage:services:business`.
- Errors: `SERVICE_NOT_FOUND` (404), `SERVICE_COMMISSION_RULE_INVALID` (400), `SERVICE_PRICE_INVALID` (400),
  `SERVICE_REVISION_CONFLICT` (409), plus the standard access/validation envelopes.

### Permissions

New `manage:services:business` and `read:services:business`. Defaults (TODO(spec) SV-Q1): both → owner,
general_manager, business_manager. Other system roles, including Branch Manager and Device, are forbidden by the PR 7 matrix;
a `:business` permission is never covered by a branch-scoped membership. A custom human role may receive
a scoped personal ALLOW under the existing PR 7 policy. The SPEC does not name the catalog permission; the
choice follows `manage:employees:business`.

### Events

None. No Phase 1 consumer subscribes to a service change: `orders` reads at record time through
`CatalogReaderPort`, and the module map declares no catalog event. Adding one now would create an unconsumed
outbox row.

### The 200 ms rule

Create/update are single-row writes with one audit insert; list is an indexed cursor page. All are well under
200 ms and stay synchronous in `api`. A service import (PR 32b) is the heavy path and uses the PR 11 worker
framework — this slice only shapes the row validator it reuses.

### Test plan

- Pure domain: rule kind/value consistency; PCT bps bounds `0`, `10000`, `10001`; FIXED `0`, overflow of
  `numeric(14,3)`; price `0` and overflow; name required/optional/length; update revision and no-op detection.
- Integration: create happy path; invalid inputs with named errors; permission refused; another tenant or
  business answers like unknown; update keeps a single row and bumps revision; stale revision 409; audit rows for
  create and for a price/rule change; RLS negative test.
- Query shape + `EXPLAIN ANALYZE` on the list and detail queries.
- Admin UI: list, create form, edit form with money in KWD 3 dp as a string, ar/en, RTL.

## Success Criteria

- An authorised manager can create, list and edit a business's services with bilingual names and a valid rule.
- A price or rule change is audited and never written as a JS number.
- A foreign tenant or business can never read or change a service.
- PR 32b can validate an imported service row with the same function and contract shape.

## Assumptions

Admin is online. The `catalog` feature flag exists in the provisional plan. The Phase 1 SPEC is
the single source of rule semantics; each bounded context owns its type (ADR-0035). No new external dependency.

## Open questions for the owner

- **SV-Q1** — the SPEC names no catalog permission. Recommendation: `manage:services:business` /
  `read:services:business`, defaults as above; keep them separate from a future `manage:catalog` for package
  types (PR 33).
- **SV-Q2** — should service names be unique per business? Recommendation: no unique constraint now; PR 32b's
  importer resolves duplicates by name and should define the rule then.
- **SV-Q3** — is a service ever retired? Recommendation: a later slice adds `is_active`/`archived_at` when the
  sessions screen needs it; soft delete is not one of the CLAUDE.md §5 tables and is out of scope here.
