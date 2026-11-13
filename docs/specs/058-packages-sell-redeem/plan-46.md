# 46 plan — refund unused sessions of one component (`refund-package`, sub-PRs 46-1 + 46-2)

Scope (manager decision, 2026-11-12): API only. 46-1 (storage: `package_refunds`, `package_refund_slots`, the opened
guards, refund-integrity triggers, permission seed) plus 46-2 (use case + route) plus the settings column
`business_settings.imported_refunds_enabled` and its orders reader port. Later sub-PRs: 46-2a-S (the write route,
the `manage:imported-refunds:business` seed and role default, audit, admin switch) and 46-3 (bell `PackageRefundRecorded`,
consumer, ledger, dialog, refund history). This PR emits only `PackageSaleChanged` (SOLD) inside the refund transaction.
Rows covered: FR-050…FR-055, FR-057, RF-01…RF-10, BR-03, TD-5, TD-5b, TD-6, TD-7, TD-9, TD-14, TD-15, PK-Q4, PK-Q5,
PK-Q10, PK-Q24. No open owner question. Base `origin/main` 6ea7a0da4; row 45 (migration 0221) is the model.

## 1. Rules

| # | Rule | Spec |
| --- | --- | --- |
| 1 | `POST /v1/businesses/{businessId}/branches/{branchId}/packages/{entitlementId}/refunds`, body `{ component_id, sessions, method, reason }` (strict), header `Idempotency-Key`, guard `refund:packages:branch` on `branchId`, feature `orders`, no device; 201 body `{ id, entitlement_id, component_id, sessions, amount, method, refunded_amount, revision, refunded_at }` (no reason echo) | FR-050 |
| 2 | `sessions` positive integer (contract 400 on 0, negative, fractional); `method` `CASH` or `CARD`; `reason` through `normalizeWrittenReason` (1..500 code points) | FR-054, FR-055, RF-07 |
| 3 | Entitlement of another company or business, or unknown: 404 `PACKAGE_NOT_FOUND` (same code, no oracle). A component not belonging to the entitlement: 422 `PACKAGE_COMPONENT_NOT_FOUND` | RF-07, RF-10 |
| 4 | One transaction in this order: idempotency claim, access lock, access read (permission, feature), branch timezone, entitlement `FOR UPDATE`, component `FOR UPDATE`, read the component's slots, flag read for IMPORTED only, `planPackageRefund` (existing domain: expiry, exact or `INSUFFICIENT_SLOTS`, highest FREE ordinals, amount = sum of unit values), insert refund row (`entitlement_revision` = new revision), insert refund-slot rows, update slots to `REFUNDED`, update entitlement `refunded_amount` and `revision`, audit `package.refunded`, outbox `PackageSaleChanged` for SOLD only | FR-051, FR-052, TD-5, TD-7 |
| 5 | IMPORTED with the flag not true: 422 `IMPORTED_REFUND_DISABLED`, nothing written; SOLD never reads the flag. The domain code is `IMPORTED_REFUNDS_DISABLED`; the API code is `IMPORTED_REFUND_DISABLED` | FR-053, RF-08, TD-14 |
| 6 | After the expiry day: 422 `PACKAGE_EXPIRED` (the domain `assertPackageNotExpired`, branch-local today, `sessionBusinessDate`) | RF-06, TD-4 |
| 7 | `PackageSaleChanged` payload: sale `branch_id` = `sold_branch_id`, `business_date` = `sold_business_date`, `sold_at`, `seller_employee_id`, `price_paid`, the new `refunded_amount`, `status 'SOLD'`, new `revision`, `schema_version 1`; written with `appendOutboxEvent` in the same transaction. IMPORTED emits nothing | TD-7 |
| 8 | Idempotent replay (same key and fingerprint) returns the original 201 and writes nothing; reuse with another body 422 `IDEMPOTENCY_KEY_REUSED`; failures roll the claim back. The reason is stored on the refund row only, never in audit, outbox, idempotency or logs | TD-9, FR-055 |
| 9 | Zero-value package: slots worth 0.000 refund with amount 0.000 and still add one to `revision` | RF-09 |

## 2. Migration (draft, unnumbered until "lane granted")

`docs/specs/058-packages-sell-redeem/46-refund-migration.draft.sql` (Agy), expand-only, no data step:

1. Permission seed `refund:packages:branch` for owner, general_manager, business_manager, branch_manager (copy 0221's seed).
2. `ALTER TABLE business_settings ADD COLUMN imported_refunds_enabled boolean` (nullable; NULL = off). Table-level
   grants already cover it; no policy change.
3. Tables `package_refunds` and `package_refund_slots` exactly as the spec's table rows list: PK `(company_id, id)`,
   `UNIQUE (company_id, business_id, id)`, `UNIQUE (company_id, entitlement_id, entitlement_revision)`,
   `UNIQUE (company_id, slot_id)` on refund slots, money `CHECK BETWEEN 0 AND 99999999999.999`, method `CHECK IN
   ('CASH','CARD')`, `sessions >= 1`, reason `CHECK` as `package_extensions_reason_check`, every FK with its child-side
   index in the FK's column order, `ENABLE` + `FORCE` RLS, select and insert policies, `REVOKE ALL` then `GRANT SELECT,
   INSERT` to `pospay_app` only.
4. `CREATE OR REPLACE package_entitlements_update_guard()` (same name and signature as in 0221): keeps every refusal of
   the 0221 body, but opens `refunded_amount` (may only increase, `<= price_paid`) and `revision` (exactly +1 when the
   amount or revision changes). Deferred check below ties both to a refund row. A refund with amount 0.000 still adds
   one to `revision` (TD-15 a).
5. `CREATE OR REPLACE package_session_slots_update_guard()`: keeps every refusal of the 0200 body except that
   `FREE -> REFUNDED` is allowed (and only that; `REFUNDED -> *`, `USED -> REFUNDED`, `IMPORTED_USED -> *` stay
   refused). The `FREE -> USED` and `current_redemption_id` refusals are those of the body **currently on main**
   (43-1 may have replaced it: the draft must be written from the latest `CREATE OR REPLACE` of that function in
   `packages/db/migrations`, not from 0200).
6. Deferred constraint triggers (`DEFERRABLE INITIALLY DEFERRED`, `REVOKE ... FROM PUBLIC` and `GRANT EXECUTE ... TO
   pospay_app` as 0221 does, fail closed on a NULL `pospay_system_id()` where a transaction pair is read):
   - refund side, `AFTER INSERT ON package_refunds`: the refund integrity of spec §6 "Refund integrity": every refund
     slot row names a slot of the refund's own entitlement and component, with the copied `ordinal` and `unit_value`
     equal to the slot, the slot now `REFUNDED`; `sessions = count(refund slots)`; `amount = sum(unit_value)`; the
     entitlement's `refunded_amount` grew by exactly the refund amount and `revision` by exactly 1, with
     `refund.entitlement_revision` = the new revision. "Grew by exactly" is checked against the previous values:
     `refunded_amount - sum(amount of the entitlement's refunds with a smaller revision) = amount`, and revision =
     1 + count of the entitlement's refunds.
   - slot side, `AFTER UPDATE OF state ON package_session_slots WHEN (NEW.state = 'REFUNDED' AND OLD.state <>
     'REFUNDED')`: a `package_refund_slots` row of this slot exists.
   - entitlement side, `AFTER UPDATE OF revision, refunded_amount ON package_entitlements WHEN` either changed: a
     `package_refunds` row of this entitlement with `entitlement_revision = NEW.revision` exists.
   - refund-slot side, `AFTER INSERT ON package_refund_slots`: its slot is `REFUNDED` at commit.
7. Re-run every earlier PR's trigger negative tests (42-2, 43-1, 45) against the replaced bodies.

Schema TS (`packages/db/schema/orders-packages.ts`): the two tables; (`schema/settings.ts`): the column.
Catalog and fixtures: `access-catalog.ts`, `role-defaults.ts`, `system-role-policy.ts`, `test/package-grants.ts`,
`test/tenant-table-inventory.ts`, `test/function-inventory.ts`, `package-fk-indexes.spec.ts` list, i18n permission name.

## 3. Layers in CLAUDE.md section 1 order

| Layer | Files | Lane | Est. lines |
| --- | --- | --- | --- |
| Migration draft, schema TS, catalog, fixtures | as section 2 | Agy | ~450 |
| Domain | `package-refund-plan.ts` already exists; add only what the use case needs (a `PackageRefundError` map is app-side). `packages/domain` untouched unless the money sum helper is missing | Kimi | ~30 |
| Contract | `packages/contracts/src/orders/package-refund.ts` and `package-refund-openapi.ts` (input strict, response), exports, path in `openapi.ts`, schema names; regenerate `openapi.json` and the three `schema.d.ts` | Kimi | ~140 |
| Error codes | `apps/api/src/shared/errors.ts` + `package-refund-error-statuses.ts`, i18n ar/en messages, `permission-name.ts` | Kimi | ~60 |
| Identity | `identity/persistence/package-refund-access.ts` (copy of `package-extension-access.ts`), `identity/index.ts` (add-only 2 lines) | Kimi | ~40 |
| Settings reader | `settings/persistence/read-imported-refunds-enabled.ts`, export in `settings/index.ts` | Kimi | ~40 |
| Port + use case | `orders/ports/package-refund.port.ts` (transactions, access, place, packages, imported-refund flag, outbox, audit), `orders/use-cases/refund-package/refund-package.usecase.ts` | Kimi | ~230 |
| Persistence | `orders/persistence/package-refund.transactions.ts`, `package-refund-records.ts` (locked reads, inserts, slot and entitlement updates) | Kimi | ~230 |
| Http | `orders/http/package-refund.controller.ts`; `orders.module.ts` add-only; `docs/module-map.md` + `.yaml` (orders -> settings symbol, orders -> identity symbol); ADR-0010 addendum | Kimi | ~110 |
| Tests | domain unit (exhaustive, ~200); DB guards + RLS negative + FK catalog (~550); API integration RF-01…RF-10, M6 and M9 races (~650); contract spec (~60); permission specs (~30) | Agy | ~1500 |
| Docs | this plan, `debate-46-fable.md`, module-map, ADR addendum | me | ~200 |

Estimate: production ~800, tests ~1500, migration + schema + catalog ~450, docs ~200. Over 2x of a category is refused.

## 4. Tests required (keep the DB specs to this list)

* Domain: exact count, highest ordinals first, slot values with the remainder placed on the last session, insufficient
  slots, zero-value package, expired, IMPORTED disabled and enabled, IMPORTED_USED and USED slots never selected,
  amount and new revision arithmetic in bigint mills.
* DB (private cluster, as `pospay_app`): a refund row without its slots, slots without the refund row, a wrong
  copied value, a wrong count, a wrong amount, a `refunded_amount` or `revision` moved by another amount, a
  `FREE -> REFUNDED` without its refund slot row, `REFUNDED -> FREE` and `USED -> REFUNDED` refused, a second refund
  of the same slot refused, a decrease of `refunded_amount` refused, `refunded_amount > price_paid` refused,
  `UPDATE` and `DELETE` of refund rows denied, cross-tenant read 0 rows and insert refused, FK-index catalog
  includes the two tables, privilege allowlist, and earlier PRs' negative tests rerun.
* API: RF-01 (rows, audit without the reason, outbox payload, revision 2), RF-02, RF-03 (race with a redemption on the
  last free slot, two real connections), RF-04 (two components concurrently), RF-05, RF-06, RF-07, RF-08 (flag NULL,
  false, true; SOLD unaffected), RF-09, RF-10 (permission, device, feature, other business or company), reason absent
  from audit, outbox and `idempotency_keys`, key reuse 422, replay after permission loss 403.
* Permission specs: role defaults, system role policy, i18n name.

## 5. Risks and non-goals

* No bell, no `PackageRefundRecorded`, no dialog, no history read, no switch write route (46-2a-S, 46-3).
* Guard bodies: 45's PR #975 and 43-1 already replaced these functions; the draft must copy the body on main.
* Locks: access, entitlement `FOR UPDATE`, component `FOR UPDATE`, then slots. No visit lock (TD-5).

## 6. Addendum after the debate (all accepted, see `debate-46-fable.md`)

* Slot guard source: the latest body is migration 0205 (lines 69-80), not 0200. Entitlement guard source: 0221 (lines 91-135).
  Rewrite of section 2 items 4 and 5: the slot guard allows only `OLD,NEW in {FREE,USED}` or `FREE -> REFUNDED` (explicit
  allowlist, existing constraint names and `to_jsonb` identity kept); the entitlement guard allows `refunded_amount`
  `NEW >= OLD`, `<= price_paid`, and `revision = OLD + 1` exactly whenever either column changes (a change of the amount
  with no revision change is refused), keeping the whole expiry block and the eight-key jsonb exclusion list of 0221.
* Section 2 item 6 is replaced by one validator `package_refund_validate(company_id, refund_id)` (fail closed when the
  refund or entitlement is not found) called from the four deferred triggers. It locks the entitlement `FOR UPDATE` and
  checks the aggregate: `refunded_amount = sum(refund.amount)`, `revision = 1 + count(refunds)`, `max(entitlement_revision)
  = revision`, plus per refund: slot rows name the refund's own entitlement and component, copied `ordinal` and
  `unit_value` equal the slot, slot is `REFUNDED`, `sessions = count(slot rows)`, `amount = sum(unit_value)`. No transaction
  stamp is read. An immediate statement-level `AFTER INSERT` trigger on `package_refund_slots` (transition table) refuses
  an insert that leaves a refund with more slot rows than its `sessions`. Two refunds in one transaction are legal at the
  database level and tested.
* Persistence: slots read `ORDER BY id FOR UPDATE`; the slot update is `WHERE state = 'FREE' ... RETURNING` and the count must
  equal `sessions`; the ordinal to slot-id map lives in persistence. `refunded_at` comes from the injected `Clock`.
* Event: the `PackageSaleChanged` payload is built by a pure builder parsed through `packageSaleChanged` (strict:
  `sale_id`, `business_id`, `branch_id`, `sold_at`, `business_date`, `seller_employee_id`, `price_paid`,
  `refunded_amount`, `status`, `revision`, `schema_version`), money as three-decimal strings. Builder lives in
  `orders/domain/package-sale-changed.ts` so 42-3b1 can reuse it.
* Controller fingerprint includes company, actor, business, branch and entitlement ids.
* Spec: update the sub-PR table (this PR carries the column, the orders port, the module-map row and the ADR-0010
  addendum; 46-2a-S keeps the permission, write route, audit and admin switch).
* Tests added: lock-proof tests; IMMEDIATE-then-DEFERRED extra writes; a slot added to a committed refund; two refunds in
  one transaction; revision +2; amount change without revision; `IMPORTED_USED -> REFUNDED`; `REFUNDED -> USED`; wrong
  `entitlement_revision`; the zero-value refund row; an extension still works; a 365-slot refund within the 200 ms
  budget; the redemption-complete trigger passing on `FREE -> REFUNDED`. Earlier negative tests that assert the closed
  refund guards (42-2 `package-storage-guards.spec.ts`, 45 `package-extension-guards.spec.ts`, 43-1's terminal-state
  cases) are rewritten to the new rules, not only re-run.
