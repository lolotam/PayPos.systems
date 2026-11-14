# Plan 42-3b2b: sale status read (PP-170, FR-010 GET, SA-09b)

Second half of row 42-3b2. 42-3b2a (#1051) accepts the sale; 42-3b1 (worker, migration 0218) writes the outcome. #1036 (public
refusal codes, merged) is the reason the stored `error_code` is always a catalogue code. No migration: reads `package_sale_requests`
and the entitlement. Template: `queries/package-import-preview-status.query.ts` + its controller status handler (47-1).
Branch: starts after #1051 merges, or stacked on its branch only if the manager says "stack".

## Behaviour (spec FR-010, SA-09b, error codes section; nothing new)
`GET /v1/businesses/{businessId}/branches/{branchId}/package-sales/{saleRequestId}`, guard `sell:packages:branch`, feature `orders`,
`SessionAdminGuard`, no idempotency. Returns one of:
- `{ status: 'pending' }`
- `{ status: 'completed', entitlement }` where `entitlement` is the existing `soldPackageEntitlement` (components included), read through
  `request.entitlement_id` in the same company, business and branch.
- `{ status: 'failed', error: { code, message_ar, message_en, details? } }`: the envelope text comes from the i18n catalogue for the
  stored code; `details` is the stored bounded `error_details` (only present for the codes that store it: discount limit, stale quote).
  A stored code outside `packageSaleRefusalCode` (legacy/unknown) is shown as `PACKAGE_SALE_FAILED`, never raw.
Scoping (creator-scoped like the 47-1 preview status): same company, business, branch and `recorded_by` = caller; any other id, caller
or company -> 404 `PACKAGE_SALE_REQUEST_NOT_FOUND` from the query; a path branch or business outside the caller's
`sell:packages:branch` scope is refused first by the guard with 403. A finished request never changes (the 0218 trigger), so the read is stable.
The read runs in one `withTenant` with `{ userId }`, no writes, under the 200 ms rule (indexed by the creator's status index).

## Error catalogue (handoff from #1046/#1051)
Wording is fixed in spec 058 §Error codes and used as written:
- `PACKAGE_SALE_FAILED`: «البيع ماتمّش؛ جرّبي تاني.» / "The sale did not complete; try again."
- `PACKAGE_SALE_REQUEST_NOT_FOUND` 404: «طلب البيع ده مش موجود.» / "This sale request was not found."
Both go into `packages/i18n/src/catalog-package-types.ts` (ar and en) next to `PACKAGE_SALE_BRANCH_INACTIVE`. Status typing follows the
`PACKAGE_SALE_BRANCH_INACTIVE` precedent: `PACKAGE_SALE_FAILED` is added to `PACKAGE_SALE_STATUS` (422, never returned as an HTTP
status; it is listed in `packageSaleWorkerOnlyCodes`), `PACKAGE_SALE_REQUEST_NOT_FOUND: 404` too.

## Files and sizes (hand-written lines; generated openapi.json and schema.d.ts excluded)
| File | Change | Lines |
|---|---|---|
| `packages/contracts/src/orders/package-sale.ts` | `packageSaleStatus` discriminated union (pending / completed with `soldPackageEntitlement` / failed with an error object whose `code` is `packageSaleRefusalCode`, `message_ar`, `message_en`, optional `details`); type export; add to `packageSaleSchemas` | ~45 |
| `packages/contracts/src/orders/package-sale-openapi.ts` | GET path (200, 403, 404) | ~35 |
| `apps/api/src/modules/orders/queries/package-sale-status.query.ts` (new) | statement builder + handler: creator-scoped request read, entitlement + components read for `completed` (reusing the detail statement's joins where they match, else one dedicated `SELECT` with a components aggregate), failed text through `errorMessages`, unknown code -> `PACKAGE_SALE_FAILED`; Arabic one-line comment naming the consuming screen (42-4) | ~85 |
| `apps/api/src/modules/orders/http/package-sales.controller.ts` | GET handler (uuid path pipes, 404 mapping, `NOT_READY` when the handler is null) | ~30 |
| `apps/api/src/modules/orders/orders.module.ts` | provider for the query handler | ~10 |
| `packages/i18n/src/catalog-package-types.ts` + `apps/api/src/shared/package-sale-error-statuses.ts` | the two codes (ar/en) and their statuses | ~12 |
| **Production total** | | **~215** |

Tests (Agy, Kimi fallback, I run them on the existing lane): contract spec for the union (parses the three shapes, rejects a raw
code and an extra key) ~45; query spec on real Postgres (result shape for pending / completed / failed, scoping by caller, branch,
business and company, unknown stored code, `EXPLAIN` uses an index, details pass-through) ~120; HTTP spec (200 for the three states
through the controller, 404 for another user, another company and an unknown uuid, 403 for another branch or business outside the grant and without `sell:packages:branch` and for a device at the guard) ~100.
**Tests total ~265.**

Total ~480 hand-written lines (well under #1051's ~1,090). One PR.

## Risks and notes
- The `completed` read needs the entitlement's component names (`name_en/name_ar`, price snapshots); if the existing detail statement
  cannot be reused without widening it, I add a dedicated statement in the new file, never editing the customer-packages query.
- `PACKAGE_SALE_FAILED` in `PACKAGE_SALE_STATUS` is the same typing precedent as `PACKAGE_SALE_BRANCH_INACTIVE`; the contract's
  `packageSaleWorkerOnlyCodes` stays the source of truth that neither is an HTTP status.
- Tests need Redis-free paths only (same lane as #1051); the device case is a guard-level test as in #1051.
- No change in `apps/worker`.

## Questions for the manager
1. Stack on #1051's branch ("stack") or wait for its merge? Either way I only branch on your word.
2. OK to use 422 for `PACKAGE_SALE_FAILED` in the status table (precedent), given it is never returned as an HTTP status?
