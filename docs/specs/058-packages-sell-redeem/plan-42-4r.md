# Plan — row 42-4r: package read endpoints (FR-070, FR-071)

Spec: [spec.md](spec.md) §5 FR-070/FR-071, Story 8 (CP-01…CP-03), TD-4, TD-13; row table §7 (42-4r, added by the
manager split of 2026-11-11 18:56 Kuwait). Branch `feat/p1-058-42-4r-package-reads` from `origin/main` `73dbfc2fd`.

## Scope

In: the FR-070 customer-packages list `queries/` file; the FR-070 and FR-071 routes; Zod contracts, OpenAPI, the
generated client types in admin/pos/menu, and two admin TanStack Query hooks; the `PACKAGE_NOT_FOUND` code.

Out: any screen (42-4 owns the customer packages screen, 43-3 the «من الباقة» toggle); every history section
(redemptions 43-3, extensions 45, refunds 46-3); FR-072 and the sale form (42-4); the sale side (42-3b). No migration:
42-2 already created `package_entitlements_customer_read_idx (company_id, business_id, customer_id, expires_on)` for
this list, and FR-071 reads only 42-2 tables. This holds only if the debate-4 `EXPLAIN`/200 ms test passes; a missing
index stops the session and goes to the manager, never a migration added on its own.

## Decisions (the spec leaves these open; none is a business rule)

- **D1 — paths.** Both under the existing reception prefix, so one `{ branch: 'branchId' }` target serves the guard:
  - FR-070 `GET /v1/businesses/{businessId}/branches/{branchId}/customers/{customerId}/packages`
  - FR-071 `GET /v1/businesses/{businessId}/branches/{branchId}/customers/{customerId}/packages/{entitlementId}`
    (FR-071's "…/packages/{entitlementId}" read as the FR-070 path plus the id). An entitlement of another customer,
    business or company, or an unknown id, answers the same 404 `PACKAGE_NOT_FOUND` (CP-02, spec §6 error list).
- **D2 — guard.** Each method: `@RequireAny(['record:service-sessions:branch', 'read:service-sessions:branch'],
  { branch: 'branchId' })` + `@RequiresFeature('orders')` (TD-13, CP-03). The guard already refuses a device and runs
  the feature check; no `@Authenticated()` route.
- **D3 — place.** Inside the read's own `withTenant` transaction the handler first calls the existing
  `SessionPlacePort.branchTimezone()` (tenancy `packageSalePlace`: active branch under the business in an undeleted
  company, returns the branch's effective timezone, TD-4). `null` → `FORBIDDEN`, as the other reception reads do. No
  new module-map arrow or row (the `SessionPlacePort` row 143 already covers tenancy).
- **D4 — "today" and the expired flag.** `expired = today > expires_on` (the same comparison as
  `assertPackageNotExpired`, the expiry day itself still valid), with `today` the branch-local date of the injected
  `Clock` instant, computed in SQL: `(${now}::timestamptz AT TIME ZONE ${timezone})::date`. A `queries/` file imports no
  `domain/` (CLAUDE.md §6).
- **D5 — list order, cursor and consistency policy.** CP-01: usable packages first, expired or fully used last,
  marked. Sort key `(rank, expires_on, id)` with `rank = 0` when not expired and at least one `FREE` slot, else `1`;
  `expires_on ASC` puts the earliest expiry first, which 43-3's suggestion reuses. Keyset cursor: opaque base64url JSON
  of `{ rank, expires_on, id }` of the last row. `rank`, `expired` and `used_up` are computed on **every** request from
  the injected clock (debate 2). **Policy (debate 3):** each page reflects the state at its own request; a package
  redeemed, refunded or extended between two page reads may repeat or be skipped. The admin hook de-duplicates by
  `id` when flattening pages, and a client that writes restarts from the first page (43-3 invalidates the query on
  save). `limit` 1…50, default 20; the page returns `next_cursor` or `null`. A malformed cursor → 400
  `VALIDATION_FAILED`.
- **D6 — list projection** (FR-070; the customer's phone is never part of it). Per entitlement: `id`, `provenance`
  (`SOLD`/`IMPORTED`), `name_en`, `name_ar`, `expires_on`, `expired`, `used_up`, `price_paid`, `refunded_amount`, and
  `components[]` ordered by `position`: `id`, `service_id`, `position`, `name_en`, `name_ar`, `sessions_total`,
  `remaining`, `used` (`USED` + `IMPORTED_USED`, as 42-4b-a counts), `refunded`, `next_unit_value` (the unit value of
  the lowest `FREE` ordinal — the value a redemption takes, FR-022/FR-025 — or `null`) and `slot_values` (debate 1):
  one entry per distinct stored unit value `{ unit_value, free, used, refunded }`, ordered by `unit_value`, so the
  allocation's remainder slot (`6.666` × 2, `6.668` × 1) stays visible without listing every slot. Every ordinal stays
  in the FR-071 detail: a component holds up to 365 slots and a sale up to 7,300. Money is the existing `sessionMoney`
  string (exact decimal text of the stored `numeric(14,3)`, CLAUDE.md §5), never a JavaScript number.
- **D7 — detail shape.** 42-4b-a's statement is re-keyed from camelCase to the contract's snake_case so the SQL
  projects straight into the DTO with no mapper (CLAUDE.architecture.md §7, up to 7,300 slots). Its fields stay the
  same; the hand-written `PackageEntitlementDetail*` interfaces are replaced by the `z.infer` types from contracts (no
  duplicate types, CLAUDE.md §6). Its test is updated for the new keys only.
- **D8 — errors.** `PACKAGE_NOT_FOUND` 404 («الباقة مش موجودة.» / "Package not found.") in a new
  `apps/api/src/shared/package-read-error-statuses.ts` spread into `errors.ts` (add-only: one import, two spreads),
  like `PACKAGE_SALE_STATUS`, and its messages in `packages/i18n`. It is in `RAISED_BY_THE_API_ONLY`.

## Files (CLAUDE.md §1 order) and implementer

| # | Layer | File | Kind | Who |
|---|---|---|---|---|
| 1 | contract | `packages/contracts/src/orders/customer-packages.ts` | new: query, list item/page, detail, component, slot schemas + `customerPackageSchemas` | Kimi |
| 2 | contract | `packages/contracts/src/orders/customer-packages-openapi.ts` | new: two paths, 400/403/404 envelopes | Kimi |
| 3 | contract | `packages/contracts/src/orders/index.ts`, `orders/openapi-schemas.ts`, `src/openapi.ts` | add-only lines | Kimi |
| 4 | i18n/errors | `packages/i18n` package-read message file + its export; `apps/api/src/shared/package-read-error-statuses.ts`; `errors.ts` | new + add-only | Kimi |
| 5 | query | `apps/api/src/modules/orders/queries/customer-packages.query.ts` | new: statement, cursor codec, `CustomerPackagesQueryHandler` | Kimi |
| 6 | query | `apps/api/src/modules/orders/queries/package-entitlement-detail.query.ts` | re-key (D7) + `CustomerPackageDetailQueryHandler` (place, read, customer match) | Kimi |
| 7 | http | `apps/api/src/modules/orders/http/customer-packages.controller.ts` | new, both routes | Kimi |
| 8 | wiring | `apps/api/src/modules/orders/orders.module.ts` | add-only providers + controller | Kimi |
| 9 | generated | `packages/contracts/openapi/openapi.json`, `apps/{admin,pos,menu}/src/shared/api/schema.d.ts` | regenerated by me (`pnpm contracts:openapi`, `api:generate`), never hand-edited | Claude |
| 10 | UI data | `apps/admin/src/orders/api/use-customer-packages.ts` (infinite query), `use-customer-package-detail.ts` | new | Kimi |
| 11 | tests | `packages/contracts/src/orders/customer-packages.spec.ts` | new | Agy |
| 12 | tests | `apps/api/src/modules/orders/__tests__/customer-packages-query.spec.ts` (+ fixture additions) | new: shape, order, `expired`/`used_up` with a branch timezone unlike its business's, cursor round trip, a rank change between page reads (policy D5), CP-02 isolation; a 60-entitlement × 3 × 30-slot customer: `EXPLAIN ANALYZE` index use on the three package tables, no seq scan, wall clock below 200 ms (debate 4) | Agy |
| 13 | tests | `apps/api/src/modules/orders/__tests__/customer-packages-http.spec.ts` | new: CP-03 (record only 200, read only 200, neither 403, one denied + other allowed 200, both denied 403, grants only on another branch 403, device 403, feature off 403, inactive/foreign branch 403), detail 404 for unknown / other customer / other business, no phone in either body | Agy |
| 14 | tests | `apps/api/src/modules/orders/__tests__/package-entitlement-detail-query.spec.ts` | key rename only | Agy |
| 15 | tests | `apps/admin/src/orders/api/use-customer-packages.spec.tsx`, `use-customer-package-detail.spec.tsx` | new: request path/headers/cursor, parsed data, error status | Agy |

Shared files (manager rule): `orders.module.ts`, `packages/contracts/src/orders/index.ts`, `openapi.ts`,
`errors.ts` take add-only edits; `openapi.json` and the three `schema.d.ts` are regenerated after any rebase. 42-3b
(`feat/p1-058-42-3b-package-sale`) touches the same files; none of its sale files is touched here.

## Debate

One Astra round: [debate-42-4r-astra.md](debate-42-4r-astra.md), 5 findings accepted, 0 rejected; D5, D6 and the
test rows 12–13 carry them.

## Tests mapped to the spec

CP-01 (both permissions see the same list and detail, order, marks), CP-02 (another business/company: empty list,
detail 404; another customer's entitlement through this customer's path: 404), CP-03 (guard matrix), FR-070 "no
phone" (response keys asserted exactly), D5 cursor round trip and malformed cursor 400, FR-070/071 `EXPLAIN`
(index used, no seq scan on the package tables at fixture size, as 42-4b-a asserts).

## Size estimate (changed lines, PP-112/§14; refuse a delivery above 2×)

| Category | Estimate |
|---|---|
| Production (contracts 210, api queries/http/wiring/errors 320, i18n 4, admin hooks 70) | 600 |
| Tests (contracts 60, query 320, http 280, detail rename 40, admin hooks 100) | 800 |
| Generated (openapi.json, 3 × schema.d.ts) | not counted |
| Docs (this plan, debate record) | not counted |

## Gates

Typecheck, lint, `pnpm lint:docs`, boundaries, `pnpm module-map:check`; contracts and admin unit tests; the three API
spec files on a private DB lane (`node scripts/test-db/lane.mjs up <lane>`, build `@pospay/db^...` first);
`api:check` for admin/pos/menu. Full `pnpm check` and the API shards are decided by `ci-gate` (PP-113).
