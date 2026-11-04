# 42-3 — Sell a package: implementation plan

> Spec: [`spec.md`](spec.md) §7 row **42-3**: «1. Pure domain (discount, seller rule, expiry). 2. `SellPackageUseCase`,
> adapters, route. 3. SA-01…SA-11 (SA-05b, SA-08b, SA-08c included)». Depends on 42-2 (merged #778, `7b52176f`) and
> PK-Q3 (answered). Base: `origin/main` `f7b6f9ef5a91364ab9187f3185ae1e258b6028ef`.
>
> Status: **manager personal review completed 2026-11-04 23:50 Kuwait; operative design aligned below. Astra NEEDS REVISION remains historical. Revised delivery estimate exceeds 2,800: split approved 23:52 Kuwait; only 42-3a is active in this session.**
> Planner lane: documentation only. No migration, no deploy, nothing from 33b.

## Active delivery: 42-3a only

Manager approved 42-3a then 42-3b at 23:52 Kuwait (see [personal review](42-3-manager-plan-review.md)). This session owns one PR for pure domain/errors/fixed-data financial plan and complete pure tests. No use case, adapter, route, timezone reader, identity or generated API changes belong to A. B starts after verified A merge in its own session/PR under PP-118; no new session or extra Sol slot is authorized. The next two new sessions remain MiniMax per PP-120.

The full sale design below remains the B handoff, not a claim that A ships a sale endpoint. A returns the bigint entitlement/component/slot snapshot and a serializable sale event; audit/HTTP response mapping and all writes belong to B. Fixed IDs are supplied by service ID; no generator callback enters domain. Reused discount/allocation/slot tests remain part of A's focused checks. Expected A size is 1,000–1,150 added/deleted lines including this complete plan and review; existing twice-estimate and 2,800 absolute limits remain.

A's files: domain/errors.ts, domain/package-expiry.ts, new domain/package-sale-rules.ts and domain/package-sale-plan.ts; their pure specs, this plan/review, and the execution rows in spec.md. A does not alter business requirements. B retains the complete SA-01…SA-11 acceptance matrix, including all races, real HTTP/DB rollback/replay tests, branch timezone reader result-shape/isolation/EXPLAIN and five measured <200 ms transactions through COMMIT.

## 0. What already exists (verified on the base; do not rebuild)

| Piece | Where | Shipped by |
| --- | --- | --- |
| Contract `sellPackageInput`, `sellPackageResponse`, `soldPackageEntitlement`, `packageSaleChanged` | `packages/contracts/src/orders/package-sale.ts` | 42-1 |
| Error codes + HTTP statuses (`PACKAGE_SALE_*`, `PACKAGE_SELLER_*`, `PACKAGE_CUSTOMER_NOT_FOUND`, `PACKAGE_TYPE_NOT_SELLABLE`) | `apps/api/src/shared/package-sale-error-statuses.ts` (spread into `shared/errors.ts`); `PACKAGE_TYPE_NOT_FOUND` 404 and `PACKAGE_TYPE_REVISION_CONFLICT` 409 already in `errors.ts` | 42-1 |
| ar/en messages for those codes | `packages/i18n/src/catalog-package-types.ts` | 42-1 |
| Discount domain `computePackageSalePricing` (+ spec) | `orders/domain/package-sale-pricing.ts` | 42-1 |
| `allocatePackagePrice`, `createPackageSlots`, `validatePackageDefinition`, `SalePackageType` | `orders/domain/package-{allocation,slots,definition,sale-types}.ts` | 31 / 42-1 |
| Type `FOR SHARE` → component services `FOR SHARE` (ascending id) → reads (FR-018b/c) | `CatalogReaderPort.readPackageTypeForSale` → `orders/persistence/catalog-reader.adapter.ts` | 42-1 (PP-100.3) |
| `PerformerCheckPort.lock/read`, `CustomerLookupPort`, `DiscountLimitPort`, `SessionPlacePort` | `orders/ports/session-readers.port.ts` + adapters | 050 |
| Storage: `package_entitlements`, `package_components`, `package_session_slots`, RLS, creation/composition seals, deferred value conservation | `packages/db/schema/orders-packages.ts`, migration `0200` | 42-2 |
| Permission `sell:packages:branch` (code + seeded row) | `access-catalog.ts`, `role-defaults.ts`, migration `0201` | 42-1 / 42-2 (PP-100.2) |
| `PackageSaleChanged` event type, worker known-types entry | `orders/events/published.ts`, `apps/worker/src/outbox/known-event-types.ts` | 42-1 |
| `RequireAny` / `Require` (one-element case), `RequiresFeature`, `AccessGuard`, route coverage (metadata-discovered) | `apps/api/src/shared/access.decorators.ts`, `identity/http/route-coverage.ts` | 57c-1 (#468) — **owned by 42-4a, not edited here** |

**Not present yet (this slice adds it):** the expiry computation (only `assertPackageNotExpired` exists), the seller
rule, the quote check, the sale-time wrapper, the sale plan builder, the use case, the transaction port and its
adapter, the slot/component/entitlement writer, the in-transaction `sell:packages:branch` access reader, the
controller, the error filter, the sale-specific branch timezone reader and adapter, the OpenAPI path, and every SA test.

## 1. Settled decisions this plan builds on (not reopened)

PK-Q2 (discount rule), PK-Q3 (seller rule), PK-Q4 (`CASH`/`CARD`), PK-Q11 (back-dating window), PK-Q13 (permission),
PK-Q23 (recording-time prices), PP-100.1 (`selling_stopped_at` comes with 33b), PP-100.2, PP-100.3 (type lock in 42-1),
TD-1, TD-4, TD-5, TD-7, TD-10, TD-13 (reuse `RequireAny` from #468 — owner correction, 2026-11-04), FR-010…FR-019b.

## 2. Touch map

Sizes are estimates of changed lines. **Outside `orders`** is flagged per CLAUDE.md §1.4.

### 2.1 Domain (`apps/api/src/modules/orders/domain/`) — pure, Arabic JSDoc on every export

| File | Change | Est. |
| --- | --- | --- |
| `package-expiry.ts` | **add** `packageExpiryDate(soldBusinessDate: string, validityDays: number): string` — pure `YYYY-MM-DD` + days (UTC calendar arithmetic, no timezone); spec 037 BR-004. Fixture: `2026-10-01 + 90 → 2026-12-30` (SA-01). | +20 |
| `package-sale-rules.ts` (new) | `packageSaleTime(soldAt, recordedAt, timezone)` wraps `sessionTime` and rethrows `SESSION_TIME_TOO_OLD` → `PACKAGE_SALE_TOO_OLD`, `SESSION_TIME_IN_FUTURE` → `PACKAGE_SALE_IN_FUTURE` (same 120 s / first-of-previous-month values, 050 FR-014); `assertPackageSaleQuote(type, expectedTypeRevision, expectedServiceRevisions)` — first `type.revision ≠ expected` → `PACKAGE_TYPE_REVISION_CONFLICT {current_revision}`, then service **set** ≠ component services or any revision differs → `PACKAGE_SALE_QUOTE_STALE {current_service_revisions}`; `checkPackageSeller(seller: SessionEmployee \| undefined, recorderUserId)` — missing/not eligible → `PACKAGE_SELLER_NOT_ELIGIBLE` (422), then `seller.user_id === recorderUserId` → `PACKAGE_SELLER_SELF_FORBIDDEN` (403, owner included); returns the `seller_linked_user_id` snapshot (`seller.user_id`). | ~90 |
| `package-sale-plan.ts` (new) | `planPackageSale(input, identities)` → `{ entitlement, components, event }`, with slots nested under each component. B maps the domain snapshot into its audit entry and HTTP response. Order: `validatePackageDefinition(type.price, components)` → `computePackageSalePricing({typePrice, pricePaid, limitBps})` → `allocatePackagePrice(pricePaid, …)` → `createPackageSlots(componentValue, sessions)` per component → `packageExpiryDate(...)` → domain-owned snapshots; B constructs `AuditEntry` (`entity 'package_entitlement'`, `action 'package.sold'`, `after` = sale snapshot without phone), `PackageSaleChanged` payload (TD-7: `sale_id, business_id, branch_id` = sold branch, `sold_at, business_date` = `sold_business_date`, `seller_employee_id, price_paid, refunded_amount '0.000', status 'SOLD', revision 1, schema_version 1`), and B maps the `sellPackageResponse` body. IDs are generated outside domain and passed as immutable data; no callback, time or randomness enters domain. Audit types must be domain-owned, never imported from `@pospay/db`. The entitlement DTO carries every column `package_entitlements_sold_shape_check` requires for `provenance 'SOLD'`: `package_type_id`, `seller_employee_id`, `paid_method`, `sold_branch_id`, `sold_at`, `sold_business_date`, `sold_timezone`, `validity_days`, `list_price`, `discount`, `discount_bps` (and `external_ref`, `import_batch_id`, `import_row` NULL), plus `price_paid`, `expires_on`, `late`, `recorded_by`, `recorded_by_membership_id`, `seller_linked_user_id`, `revision 1`, `refunded_amount 0`. Split into two files if it passes 300 lines / 60 per function. | ~160 |
| `errors.ts` | **add** `PackageSaleError` (code union: `PACKAGE_TYPE_NOT_FOUND`, `PACKAGE_TYPE_REVISION_CONFLICT`, `PACKAGE_SALE_QUOTE_STALE`, `PACKAGE_SELLER_NOT_ELIGIBLE`, `PACKAGE_SELLER_SELF_FORBIDDEN`, `PACKAGE_SALE_TOO_OLD`, `PACKAGE_SALE_IN_FUTURE`, `PACKAGE_CUSTOMER_NOT_FOUND`) with `details`. | +25 |
| `__tests__/package-sale-rules.spec.ts`, `__tests__/package-sale-plan.spec.ts`, `__tests__/package-expiry.spec.ts` (extend) | Exhaustive unit tests, no DB: SA-01 numbers, SA-02 weights incl. the spec 007 PKG-01/PKG-02 remainder-mill fixture (shared fixture table), SA-04 matrix (25.000, 27.000, 21.000 @ 10%, owner at 0.000 → all slots 0.000, half-up rounding), SA-07 window edges (exactly 120 s, 121 s, first of previous month 00:00 local, the day before), quote order (type before services; set mismatch vs revision mismatch), seller order (eligibility before self, including an ineligible seller linked to the recorder; eligible unlinked seller allowed; owner self forbidden), month-end/leap expiry, year boundary and normalization of dates within the 120-second future tolerance to server time. | ~300 |

`readPackageTypeForSale` returning `null` → the use case throws `PACKAGE_TYPE_NOT_FOUND` (404), which covers both
unknown and other-business types (SA-08). A definition that fails `validatePackageDefinition` surfaces
`PackageRuleError` with its named code (SA-08 [M11]).

### 2.2 Port (`orders/ports/package-sale.port.ts`, new) — Arabic JSDoc on every method

`PackageSaleTransactions.run(context: SessionWriteContext, work: (tx: PackageSaleTransaction) => Promise<T>)`, where
`PackageSaleTransaction` exposes `place: SessionPlacePort` bound to the new sale-specific branch timezone reader, `access: SessionRecordAccessPort` (same shape, bound to
`sell:packages:branch`), `catalog: CatalogReaderPort`, `customer: CustomerLookupPort`, `performers: PerformerCheckPort`,
`discount: DiscountLimitPort`, `idempotent<T>(work)` (operation fixed to `'sell-package'`), `insertSale(plan)`,
`audit(entry)`, `emit(payload)`. ~70 lines.

Why a new port and not a wider `SessionTransaction`: that port is visit-shaped (`SessionRepository`, `consumption`,
visit-specific `audit`/`emit` signatures, `linkCommittedProof`). One implementation per transaction port is the
existing precedent (`line-edit`, `line-cancel`, `line-performers`, `session-tips` each have their own), which is the
`CLAUDE.architecture.md` §12 justification. `Clock`, `IdGenerator` and `SessionWriteContext` are reused as is.

### 2.3 Use case (`orders/use-cases/sell-package/sell-package.usecase.ts`, new)

One line above the class (Arabic). No arithmetic, no SQL. ~110 lines; unit spec with in-memory fakes ~150 lines
(call order, replay path, no write after any refusal).

```
run(context):
  transactions.run(ctx, tx =>
    place = tx.place.read()                        // active sale branch; branch timezone then business fallback; null → FORBIDDEN
    resolveSessionRecorder(tx.access.read(clock.now()), …)  // pre-claim read, as 050 (FR-011)
    tx.idempotent(async () => {                    // claim FIRST (FR-018)
      tx.access.lock()                             // company + memberships FOR SHARE
      type = tx.catalog.readPackageTypeForSale(id) // type FOR SHARE → services FOR SHARE asc → reads (FR-018b/c)
      tx.performers.lock([seller])                 // FR-014, before read
      at = clock.now()                             // fresh after every wait
      recorder = resolveSessionRecorder(tx.access.read(at), input.recorder_membership_id, undefined, userId)
      if type == null → PACKAGE_TYPE_NOT_FOUND
      assertPackageSaleQuote(type, …)
      time = packageSaleTime(input.sold_at, at, place.timezone)
      customer = tx.customer.read(customer_id)     // null → PACKAGE_CUSTOMER_NOT_FOUND
      seller = tx.performers.read([seller], time.occurred_at)[0]
      linked = checkPackageSeller(seller, userId)
      limit = tx.discount.read(recorder)
      preGeneratedIds = generate required fixed identity data via injected IdGenerator
      plan = planPackageSale({...}, preGeneratedIds)
      tx.insertSale(plan); tx.audit(saleAudit(plan)); tx.emit(plan.event)
      return saleResponse(plan)
    })
    on replay: re-resolve access at clock.now() (SA-09 × SA-11), return stored body
    // replay never rechecks quote/prices/sale-age window; all adapters share this one withTenant
  )
```

**Lock-order note (deliberate, not a deviation):** FR-018 lists the seller lock after the type and services locks
and before the reads. 42-1's `readPackageTypeForSale` bundles each lock with the read that follows it, so the type and
price reads happen before the seller lock. The invariants that matter still hold: every read follows its own lock
(FR-018b/c), the seller read follows `PerformerCheckPort.lock` (FR-014), and the global order type → services →
employees matches 050's services → employees, which is compatible with the inspected paths. The SA-05b/08b/08c both-orders
races prove those interleavings, not universal deadlock freedom. 42-1's shipped port is not reopened.

**Recorder ambiguity keeps its 050 code.** A user with several covering memberships and no `recorder_membership_id`
gets `SESSION_RECORDER_MEMBERSHIP_REQUIRED` (400) from `resolveSessionRecorder`; the spec defines no `PACKAGE_`
equivalent, so the sale accepts that code as is.

**No recovery proof (ADR-0042).** That proof is visit-specific (`recovery.issue` / `linkCommittedProof`); FR-018 names
none for the sale. Astra accepted this distinction. runIdempotent retains keys for 24 hours only; hand this limit to 42-4 and never claim permanent retry deduplication.

**`PACKAGE_TYPE_NOT_SELLABLE` is not checked here.** The column does not exist until 33b (PP-100.1), and a type cannot
be stopped before 33b exists, so there is no behavioural hole. 33b adds `selling_stopped_at` to the reader **and** the
sale-side check (plus ST-02/ST-03b). No `TODO` in code; the handoff is recorded here and in the PR body.

### 2.4 Persistence (`orders/persistence/`)

| File | Change | Est. |
| --- | --- | --- |
| `package-sale-transactions.ts` (new) | `createPackageSaleTransactions(database, ids, bind, clock)`: `database.withTenant(companyId, …, { userId })`; `idempotent` → `runIdempotent(tx, { scope: 'COMPANY', operation: 'sell-package', key, fingerprint }, …)` storing `{ status: 201, body }` (`operation` is a kebab-case `string` in `packages/db/src/idempotency.ts`, so no `packages/db` edit); `audit` → `appendAuditLogs(tx, [{ id: ids.newId(), entry }])`; `emit` → `appendOutboxEvent(tx, ids.newId(), { aggregateType: 'package_entitlement', aggregateId: sale_id, eventType: 'PackageSaleChanged', payload })`; sale-specific cleanup preserves PackageSaleError, PackageSalePricingError, PackageRuleError, SessionError and idempotency errors before translating serialization to TRANSACTION_RETRY_REQUIRED; INVALID_LIMIT remains 500. Never use cleanSessionWrite, which masks package errors. | ~90 |
| `package-sale-writes.ts` (new) | `insertPackageSale(tx, plan)`: one `INSERT` for the entitlement, one multi-row `INSERT` for ≤ 20 components, **one `INSERT … SELECT FROM unnest($1::uuid[], $2::uuid[], $3::int[], $4::numeric[], …)` for the slots — one array parameter per column**, not Drizzle `.values([...])`. 7,300 rows × ~8–9 bound columns = 58k–66k parameters, at or over PostgreSQL's 65,535-per-statement cap; `unnest` keeps it at ~9 parameters. `refunded_amount 0`, `revision 1` on insert (42-2 creation seal); `lock_touch` left at its default. | ~90 |
| `package-sale-access.adapter.ts` (new) | `packageSaleAccess(tx, companyId, userId, businessId, branchId): SessionRecordAccessPort` → `lock: lockServiceSessionAccess` (permission-agnostic), `read: readPackageSaleAccess`. | ~15 |
| reused unchanged | `catalog-reader.adapter.ts`, `customer-lookup.adapter.ts`, `discount-limit.adapter.ts`, `performer-check.adapter.ts` (the visit-specific `session-place.adapter.ts` remains unchanged) | 0 |

### 2.5 Identity — **outside the slice's module (CLAUDE.md §1.4), stated in the PR**

The in-transaction recheck (FR-011) needs `sell:packages:branch` evaluated with the 050 semantics, and
`readServiceSessionAccess` hard-codes `record:service-sessions:branch`. The sale reuses `resolveSessionRecorder`, which
consumes `SessionAccess { record, denied, feature, membership_ids }`, so the new reader mirrors
**`readServiceSessionAccess`** (union evaluation across the user's covering memberships), not `readLineAccess`'s
per-membership `LineAccess` shape.

- `identity/persistence/service-session-access.ts`: extract the body into a private
  `readBranchWriteAccess(tx, permission, companyId, userId, businessId, branchId, at)`; `readServiceSessionAccess`
  becomes a one-line wrapper (behaviour-preserving; the existing 050 tests are the regression proof); add
  `readPackageSaleAccess` as the second wrapper with Arabic JSDoc. (~+15 / −3). D-1(a) ownership confirmed by manager at 23:50 Kuwait; 42-4a was notified not to edit this file.
- `identity/index.ts`: one export line.
- **Not touched:** `identity/use-cases/authorize-request/*`, `identity/http/route-coverage.ts`,
  `shared/access.decorators.ts`, `AccessGuard` (42-4a); `identity/persistence/service-session-edit-access.ts` and the
  line change/cancel/performer guards (43-1b).
- `docs/module-map.md` (reads list, one line per symbol per adapter, `pnpm module-map:check`):
  `orders -> identity.readPackageSaleAccess @ apps/api/src/modules/orders/persistence/package-sale-access.adapter.ts`
  and `orders -> identity.lockServiceSessionAccess @ apps/api/src/modules/orders/persistence/package-sale-access.adapter.ts`.
  The `orders → identity` arrow already exists; **no new arrow, no ADR.**

### 2.6 Sale place — tenancy read outside orders (CLAUDE.md §1.4)

- Add `tenancy/queries/package-sale-place.query.ts`: a bounded read on the caller transaction, proving company/business/active-branch ownership, returning `COALESCE(b.timezone, bu.timezone)`. Preserve `activeBusinessTimeZone` and all visit-reader semantics. Arabic documentation on the public reader and statement builder. Estimate 40 lines.
- Add public export in `tenancy/index.ts` and `orders/persistence/package-sale-place.adapter.ts`, binding the existing `SessionPlacePort` shape without another transaction. Estimate 20 lines including export.
- Declare `orders -> tenancy.packageSalePlace` at that adapter in `docs/module-map.md`; the existing orders-to-tenancy arrow stays unchanged. Include this line in documentation estimates.
- Add `tenancy/__tests__/package-sale-place.spec.ts`: result shape, branch override, NULL fallback, midnight/year/leap date differences, wrong company/business, inactive branch, and EXPLAIN on representative fixtures. Estimate 100 lines; no new table or migration.

### 2.7 HTTP and wiring

| File | Change | Est. |
| --- | --- | --- |
| `orders/http/package-sales.controller.ts` (new) | `@Controller('businesses/:businessId/branches/:branchId/package-sales')`, `@Post() @HttpCode(201)`, **`@Require('sell:packages:branch', { branch: 'branchId' })`** (the one-element `RequireAny` from #468 — reuse only), `@RequiresFeature('orders')`, `@UseGuards(SessionAdminGuard)` (refuses a device principal, SA-11), `ZodValidationPipe(sellPackageInput)`, `pathId` pipes, `@Idempotency()`, actor-bound `requestFingerprint` (company + user, 050 §8), `ApiError('NOT_READY')` when the use case is null, `@UseFilters(SessionErrorsFilter, PackageSaleErrorsFilter)`. | ~60 |
| `orders/http/package-sale-errors.filter.ts` (new) | `@Catch(PackageSaleError, PackageSalePricingError, PackageRuleError)` → `ApiError(code, details)` → `EnvelopeExceptionFilter` (statuses already in the shared table). Only `PACKAGE_SALE_DISCOUNT_ABOVE_LIMIT` maps from `PackageSalePricingError`; `INVALID_LIMIT` is a programming error and is rethrown (500). `SessionErrorsFilter` stays on the route for `FORBIDDEN` / `FEATURE_DISABLED` / `TRANSACTION_RETRY_REQUIRED` / `IDEMPOTENCY_KEY_REUSED` from `resolveSessionRecorder` and the transaction; the SESSION_TIME → PACKAGE_SALE mapping lives in the domain wrapper, so the two filters never compete for a code. Check that every `PackageRuleError` code reachable from `validatePackageDefinition` has a status + i18n entry; add any missing one in `package-sale-error-statuses.ts` / i18n. | ~40 |
| `orders/orders.module.ts` | Add the controller to `ordersControllers`, a `packageSaleTransactions(database, ids, clock)` binding beside `ordersTransactions` (binds `packageSaleAccess` instead of the record access), the `SellPackageUseCase` provider (`useValue` null without a database, as today). File is at 197 lines. | ~+20 |
| `packages/contracts/src/orders/package-sale-openapi.ts` (new) + registry line in `packages/contracts/src/openapi.ts` | Register `POST /v1/businesses/{businessId}/branches/{branchId}/package-sales` like `service-session-openapi.ts` (`serviceSessionPaths` is imported there); `pnpm contracts:openapi` regenerates `openapi.json` and the admin/pos `schema.d.ts`. | ~30 + generated |

Route coverage and startup validation are metadata-discovered (`identity/http/route-coverage.ts` walks
`REQUIRE_ACCESS`), so the new route needs **no edit to a 42-4a-owned file**. If 42-4a's audit later finds a residual
gap on this route, 42-4a fixes it in its own files.

## 3. Transaction and lock order (one transaction, FR-018)

1. idempotency claim (`sell-package`, COMPANY, actor-bound fingerprint)
2. access lock (company, then memberships `FOR SHARE`)
3. type row `FOR SHARE` → read type (FR-018b)
4. component `services` `FOR SHARE`, ascending id → read prices and revisions (FR-018c)
5. seller lock `PerformerCheckPort.lock([seller])` (FR-014)
6. `clock.now()`, then access recheck, quote check, time, customer, seller read, limit
7. domain plan (all arithmetic)
8. insert entitlement → components → slots (deferred conservation runs at COMMIT)
9. audit `package.sold`
10. outbox `PackageSaleChanged`
11. store the 201

Any refusal after step 1 rolls back the whole transaction, the stored response included (nothing written).

## 4. Acceptance-test matrix

Integration specs run on the T2 compose Postgres, one cloned database per spec file (ADR-0006). Races use **two real
connections** with an explicit barrier (hold the first transaction open after its lock, assert the second is blocked
via `pg_locks` / a timeout probe, then release), both orders each.

| ID | Level | File | Asserts |
| --- | --- | --- | --- |
| SA-01 | integration | `orders/__tests__/sell-package.spec.ts` | exact entitlement row (`SOLD`, 25.000 / 22.500 / 2.500 / 1000 bps, `sold_business_date 2026-10-01`, `expires_on 2026-12-30`, `revision 1`, `refunded_amount 0.000`, `sold_timezone`, `late false`, seller + `seller_linked_user_id`), 1 component (3.000, 10, 22.500), 10 `FREE` slots of 2.250, 1 audit row `package.sold`, 1 outbox row whose payload parses with `packageSaleChanged`, the stored 201 equals the response |
| SA-02 | unit + integration | `package-sale-plan.spec.ts`, `sell-package.spec.ts` | weights 20/15/5 → 20.000/15.000/5.000, slots 20.000; 15.000; 2.500, 2.500; remainder-mill fixture = spec 007 PKG-01/PKG-02 (shared table) |
| SA-03 | integration | `sell-package.spec.ts` | edit type price and a service price after the sale → re-read: components, slots, expiry unchanged |
| SA-04 | unit + integration | both | 25.000 → 0; 27.000 → 0 / 0 bps; 21.000 @ 10% → 422 `PACKAGE_SALE_DISCOUNT_ABOVE_LIMIT` with limit, **zero rows in all three tables, audit and outbox**; owner at 0.000 → all slots 0.000 |
| SA-05 | integration | `sell-package.spec.ts` | detached / inactive seller → 422 `PACKAGE_SELLER_NOT_ELIGIBLE`; recorder linked to seller → 403 `PACKAGE_SELLER_SELF_FORBIDDEN`, owner included |
| SA-05b | integration (race) | `sell-package-races.spec.ts` | detach-first → `NOT_ELIGIBLE`; sale-first → detach waits, sale commits eligible; same two orders for a relink of the seller's user → self rule |
| SA-06 | contract | `packages/contracts` spec (exists from 42-1; add `BANK_TRANSFER` / missing if absent) + one HTTP 400 case | 400 by the contract |
| SA-07 | unit + integration | `package-sale-rules.spec.ts`, `sell-package.spec.ts` | omitted → now; back-dated in window → `late true`, expiry from the sale date; too old → 422 `PACKAGE_SALE_TOO_OLD`; > 120 s ahead → 422 `PACKAGE_SALE_IN_FUTURE`; PK-Q23: back-dated sale valued at recording-time prices (3.000, not 2.500) |
| SA-08 | integration | `sell-package.spec.ts` | other-company / unknown customer → 422 `PACKAGE_CUSTOMER_NOT_FOUND`; other-business / unknown type → 404 `PACKAGE_TYPE_NOT_FOUND`; failing definition → 422 with the validator's named code |
| SA-08b | integration (race) | `sell-package-races.spec.ts` | edit-first → 409 `PACKAGE_TYPE_REVISION_CONFLICT` `current_revision 2`, nothing written, re-sell on 2 succeeds; sale-first → edit waits, sold package keeps revision-1 values |
| SA-08c | integration (race) | `sell-package-races.spec.ts` | edit-first → 409 `PACKAGE_SALE_QUOTE_STALE` with current revisions, nothing written, re-sell at 3.500 succeeds; sale-first → edit waits, slots keep the 3.000 weights |
| SA-09 | integration | `sell-package.spec.ts` | same key + body + actor → original 201 replayed, still one entitlement / slot set; changed body or actor → 422 `IDEMPOTENCY_KEY_REUSED`; replay after the permission is revoked → refused (re-resolved access) |
| SA-10 | integration (perf) | `sell-package-volume.spec.ts` | 20 components × 365 sessions = 7,300 slots: exactly one INSERT per table (statement count probe), wall time of the transaction **including COMMIT** (the deferred conservation trigger runs there; composition seals run at statement end) under 200 ms: one warmup then five measured complete transactions. Report environment and all five durations; each must be below 200 ms. Median alone is insufficient. Above budget → the sale stops and the PR comes back to the spec (SA-10's own rule), no silent redesign |
| SA-11 | integration | `sell-package.spec.ts` + `identity/__tests__/package-sale-access.spec.ts` | no `sell:packages:branch` → 403; DENY override → 403; device principal → 403; `orders` feature off → `FEATURE_DISABLED`; each with nothing written; the reader's union semantics match `readServiceSessionAccess` for the record permission (regression) |

Additional required acceptance coverage (included in revised sizes):

- SA-01/07 timezone integration: branch and business dates differ near midnight; sale business date, timezone, expiry and event use branch timezone. NULL fallback, New Year and leap day remain explicit.
- SA-04/05/08 HTTP tests through real persistence prove 403/409/422 and exact details; INVALID_LIMIT remains 500. Audit/outbox failures and commit-time conservation failures leave no sale, components, slots, event, audit or stored response.
- SA-09 simultaneous same-key requests: first commits and second replays; first rolls back and second executes once. Replay after catalog changes/month rollover returns original body without quote, pricing or sale-age evaluation.
- SA-11 permission revocation, membership expiry, DENY and feature disabled after waits and before replay; cashier with sell permission alone succeeds; another user's or branch's recorder membership fails. Count one withTenant across sale work and replay, without nesting or parallel transactions.
- New tenancy query has result-shape, isolation and EXPLAIN checks (§2.6). Existing storage RLS negatives remain owned by 42-2; no new table. **SA-12 is 42-4.**

## 5. Gates

- **Local (before declaring the implementation complete):** `pnpm typecheck`, `pnpm lint` (max-lines, boundaries),
  `pnpm lint:docs`, `pnpm module-map:check`, `pnpm contracts:openapi` (clean diff after regeneration), and only this
  slice's specs: the three domain specs, the use-case spec, `sell-package.spec.ts`, `sell-package-races.spec.ts`,
  `sell-package-volume.spec.ts`, `identity/__tests__/package-sale-access.spec.ts`, plus the existing
  `service-session-access` / record-service-session specs touched by the D-1 extraction, and the new tenancy place shape/isolation/EXPLAIN spec. DB specs one at a time on a
  private lane cluster.
- **CI decides:** the full `pnpm check`, the API shards and the other CI-only gates, through `ci-gate` on the exact
  head (PP-113). Until then the slice is «implementation complete, pending `ci-gate`».
- **Done criteria:** `CLAUDE.architecture.md` §15 checklist, `clean-code-guard` on production code, `test-guard` on the
  specs, `docs-guard` on this plan and the module-map lines.

## 6. Decisions and size gate

- D-1(a) settled by manager 2026-11-04 23:50 Kuwait: this session owns the narrow permission-parameter extraction/package-sale wrapper in service-session-access.ts and identity/index.ts export. No shared RequestAuthorizer change or feature-reader change.
- D-3 assessed by Astra: no visit recovery proof, 33b deferral, inspected lock order and eligibility-before-self accepted. Its overall NEEDS REVISION receipt remains historical; the manager's corrected-design approval is not an Astra READY receipt.
- D-2: the corrected estimate below exceeds 2,800 total added/deleted lines, so the manager approved the split below at 23:52 Kuwait. A alone is active; B is deferred until A merges. No coverage or documentation is removed to fit the cap.

## 7. Revised inclusive size estimate

The original 2,130 estimate included only 20 documentation lines and excluded the full plan, manager review, new timezone work, expanded acceptance cases and generated artifacts. Remove that 20-line placeholder, then include every artifact. These are estimates, not a measured final diff. Count additions plus deletions, not net growth.

| Category | Estimated changed lines |
| --- | ---: |
| Existing baseline code and tests (2,130 minus original 20 docs placeholder) | 2,110 |
| New tenancy query | 40 |
| Public export and sale-place adapter | 20 |
| Tenancy result-shape/isolation/EXPLAIN tests | 100 |
| Additional HTTP error/rollback/commit-failure tests | 80 |
| Additional concurrent/replay/authorization/timezone cases | 180 |
| Generated OpenAPI and two client schemas (provisional upper estimate) | 150 |
| Full plan plus manager review | 340 |
| Module-map additions and receipt updates | 20 |
| **Inclusive estimate** | 3140 |

Generated size remains provisional until regeneration; the known design already exceeds the cap without increasing it. All five measured transactions retain the <200 ms gate, including COMMIT.

### Proposed split for manager decision

1. **42-3a: pure sale domain and unit tests**, no route or persistence writer. Include expiry/time/quote/seller rules, pure financial plan with fixed identity inputs, typed domain errors, comprehensive pure tests and relevant plan/audit records. Existing pricing/allocation/slots are reused. Estimated 1,000–1,150 total changed lines including these full documents.
2. **42-3b: transactional sale integration**, after 42-3a merges. Include access extraction/export, sale-specific tenancy read/adapter and shape/isolation/EXPLAIN tests, use case, persistence/error mapper, route/wiring, OpenAPI/generated clients, all real-DB/HTTP/race/rollback/replay and SA-10 measurements. Estimated 2,050–2,300 total changed lines with a new bounded handoff document.

Both parts retain their applicable independent review, local gates and five exact-head GitHub receipts. 42-3b ships no untested financial route. A retains this session/worktree and its sole PR through merge. B requires a different future session/PR within PP-118 and is not launched now. No migration/deploy/merge is authorized.

## 8. Coordination

- **42-4a** owns `RequireAny`/`RequiredAccess`, `AccessGuard`, the identity authorizer, route coverage and startup
  validation. 42-3 only **uses** `@Require('sell:packages:branch', { branch: 'branchId' })`; interface contract for
  42-4a's audit: one `REQUIRE_ACCESS` entry `{ permissions: ['sell:packages:branch'], target: { branch: 'branchId' } }`
  plus `RequiresFeature('orders')`, user principals only (`SessionAdminGuard`). No file of theirs is edited; manager explicitly assigns service-session-access.ts and identity/index.ts narrow additions to 42-3.
- **43-1b** owns the service-line change/cancel/performer guards and `service-session-edit-access.ts`; untouched.
- **33b** adds `selling_stopped_at` to `readPackageTypeForSale` and the sale-side `PACKAGE_TYPE_NOT_SELLABLE` check
  (FR-018b order: stopped → revision → services) with ST-02/ST-03b. If 33b merges first, 42-3 rebases onto it and
  calls the check; if 42-3 merges first, 33b adds one domain call in `sell-package.usecase.ts`.
- **42-4** (picker FR-072, SA-12, reads) depends on 42-3 and 42-4a.
- **Merge:** the manager keeps the merge and its order; no migration, so no migration lane.
