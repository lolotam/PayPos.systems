# Plan 42-3b2: sale acceptance and status over HTTP (PP-170)

Row 42-3b2 of spec 058 (FR-010, FR-011, FR-013, FR-018 acceptance, SA-06, SA-09, SA-09b, SA-10 acceptance, SA-11).
42-3b1 (worker, `package_sale_requests` migration 0218, the `package-sale` job) and #1036 (public refusal codes) are on main.
No migration: the table, RLS, grants and indexes already exist. Template: the package extension flow (identity access
reader, `runIdempotent`, `SessionAdminGuard`) and the 47 import request/status read.

## Behaviour (from the spec, nothing new)
- `POST /v1/businesses/{businessId}/branches/{branchId}/package-sales` -> **202 `{ sale_request_id }`**. One transaction,
  under 200 ms: idempotency claim (`sell-package`, COMPANY, actor-bound fingerprint) -> access lock + `sell:packages:branch`
  and `orders` feature check -> `resolveSessionRecorder` (membership, `SESSION_RECORDER_MEMBERSHIP_REQUIRED` as 050) ->
  `DiscountLimitPort.read` frozen as `discount_limit_bps` -> insert one `pending` request (validated body, recorder,
  `recorded_at` = injected clock) -> id-only outbox `PackageSaleRequested { sale_request_id }` -> store `{ status: 202, body }`.
  A replay (same key, body, actor) returns the stored 202 after re-checking access (SA-09 x SA-11), like extension.
- No customer, type, seller, window or price check at acceptance: those are worker refusals (SA-04/05/07/08).
- `GET .../package-sales/{saleRequestId}` -> `{ status: 'pending' }` | `{ status: 'completed', entitlement }` |
  `{ status: 'failed', error: { code, message_ar, message_en, details? } }`. Creator-scoped: same company, business, branch and
  `recorded_by` = caller, any other id -> 404 `PACKAGE_SALE_REQUEST_NOT_FOUND`. Guard `sell:packages:branch` + `orders`.
  The failed text comes from the i18n catalogue for the stored code; a stored code outside `packageSaleRefusalCode`
  (legacy or unknown) is shown as `PACKAGE_SALE_FAILED`, never as a raw code.
- SA-06: `paid_method` other than CASH/CARD -> 400 by the contract (already in `sellPackageInput`).

## Proposed split (manager decides)
The full row is about 1,000 hand-written lines, far above the 80-200 rule of thumb, so I propose two sequential PRs
(PP-118, one at a time):
- **42-3b2a Accept:** contract + OpenAPI for POST, identity access reader, orders domain/port/persistence/use case,
  POST route, wiring, `PackageSaleRequested`. Tests: SA-06, SA-09 replay, SA-11, SA-10 acceptance budget.
- **42-3b2b Status:** status contract, status query + GET route, failed-text mapping, i18n for `PACKAGE_SALE_FAILED` and
  `PACKAGE_SALE_REQUEST_NOT_FOUND`, scoping and EXPLAIN tests.
42-4 (screen) needs both, so nothing ships to users between them. If you prefer one PR, the sizes below are the total.

## Files and sizes (hand-written lines; generated openapi.json / schema.d.ts excluded)
### 42-3b2a Accept
| File | Change | Lines |
|---|---|---|
| `packages/contracts/src/orders/package-sale.ts` | `acceptedPackageSale` `{ sale_request_id }` schema + type (the old 201 `sellPackageResponse` is replaced; it has no user) | ~15 |
| `packages/contracts/src/orders/package-sale-openapi.ts` (new) + `openapi.ts` registry | POST path, 202/400/403/409/422, like `package-import-preview-openapi.ts` | ~45 |
| `identity/persistence/package-sale-access.ts` (new) + `identity/index.ts` + `docs/module-map.md` | `lockPackageSaleAccess` / `readPackageSaleAccess` copy the extension reader's shape for `sell:packages:branch` (outside orders, stated in the PR; no new arrow) | ~40 |
| `orders/domain/package-sale-request.ts` (new) | pure builder of the pending row from input + recorder + limit + clock (Arabic JSDoc) | ~35 |
| `orders/ports/package-sale-request.port.ts` (new) | transaction scope: `idempotent`, `access`, `discountLimit`, `insertPending`, `publishRequested` | ~40 |
| `orders/persistence/package-sale-request.transactions.ts` + `package-sale-request-records.ts` (new) | `withTenant`, `runIdempotent` 202, access adapter, `discountLimit`, `INSERT` request, `appendOutboxEvent` | ~110 |
| `orders/use-cases/accept-package-sale/accept-package-sale.usecase.ts` (new) | orchestration + replay re-authorize | ~70 |
| `orders/http/package-sales.controller.ts` (new) | POST, `@Require('sell:packages:branch')`, `@RequiresFeature('orders')`, `SessionAdminGuard`, `@Idempotency()`, error mapping | ~75 |
| `orders/orders.module.ts` | provider + controller | ~20 |
| `docs/module-map.md` | 3 identity/settings read lines | ~6 |
| **Production total** | | **~455** |

Tests (Agy): domain builder ~40, use case (fake scope) ~110, contract spec ~40, HTTP integration on a private lane
(SA-06 400, SA-09 replay same id and one row/one event, SA-11 device/permission/feature 403, discount limit frozen,
wrong-tenant isolation, acceptance < 200 ms ratio-free: EXPLAIN/wall check only, PP-165 notes the 200 ms rule stays) ~220.
**Tests total ~410.**

### 42-3b2b Status
| File | Change | Lines |
|---|---|---|
| `contracts` `packageSaleStatus` (discriminated union, reuses `soldPackageEntitlement` and `packageSaleRefusalCode`) + openapi GET | | ~50 |
| `orders/queries/package-sale-status.query.ts` (new) | creator-scoped read, joins the entitlement for `completed`, failed text from i18n, unknown code -> `PACKAGE_SALE_FAILED` | ~60 |
| `orders/http/package-sales.controller.ts` | GET handler | ~25 |
| `packages/i18n` en/ar catalogues + `apps/api/src/shared/errors.ts` + package-sale statuses | `PACKAGE_SALE_FAILED` ar/en (wording already in spec §Error codes: «البيع ماتمّش؛ جرّبي تاني.» / "The sale did not complete; try again."), `PACKAGE_SALE_REQUEST_NOT_FOUND` 404 («طلب البيع ده مش موجود.» / "This sale request was not found.") | ~12 |
| **Production total** | | **~150** |

Tests: contract ~40, query shape + scoping + EXPLAIN ~80, HTTP (pending/completed/failed, other user/branch/business 404,
unknown stored code) ~100. **Tests total ~220.**

## PACKAGE_SALE_FAILED handoff (from #1046)
Message wording is already fixed in spec 058 §Error codes (ar and en above); 42-3b2b adds it to the i18n catalogues
and the API shared status table (worker-only per `packageSaleWorkerOnlyCodes`: it is a status-read code, never an
HTTP status, so it gets no entry in `PACKAGE_SALE_STATUS`; I will check how the `satisfies Record<ErrorMessageCode, number>`
typing in `apps/api/src/shared/errors.ts` accepts message-only codes and, if it cannot, follow the existing
`PACKAGE_SALE_BRANCH_INACTIVE` precedent already in `PACKAGE_SALE_STATUS`).

## Implementers and gates
Kimi CLI k3.1-pro for production (identity + orders), Agy gemini-3.8-flash-high for tests, fallbacks per PP-186/PP-112.
Briefs per category with sizes sent to you before dispatch; refuse a delivery above 2x. Gates: full `pnpm typecheck`,
lint, `pnpm lint:docs`, `pnpm module-map:check`, `pnpm contracts:openapi` + admin/pos `api:check` (regenerated, never
hand-edited), the slice's tests on my own lane (HTTP integration, never shared 5432/6379).

## Questions for the manager
1. Split into 42-3b2a / 42-3b2b (recommended), or one PR of ~600 production + ~630 test lines?
2. Replace the 201 `sellPackageResponse` in the contract (recommended; no consumer exists) or keep it beside the 202 schema?
3. OK that the new identity reader lives in `identity/persistence/package-sale-access.ts` (no new module arrow, 3 module-map lines)?
