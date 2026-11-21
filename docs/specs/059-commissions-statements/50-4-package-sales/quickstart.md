# Quickstart: validating row 50-4

Phase 1 of [plan.md](./plan.md). How to prove the slice works. It contains no implementation code. Contracts:
[contracts/package-sale-projection.md](./contracts/package-sale-projection.md). Table:
[data-model.md](./data-model.md).

Nothing here touches staging or production. Every command runs against the local test Postgres of the lane the manager
assigns (`docs/runbook.md`, "Per-lane test Postgres"). Database suites run one at a time per cluster.

## Prerequisites

- The worktree is on the implementation branch, up to date with `main`.
- A private test cluster for this lane is up; `@pospay/db`'s dependencies are built first.
- `pnpm install` has run at the repository root.

## 1. Local gates (must exit 0 before "implementation complete, pending `ci-gate`")

`CLAUDE.md` §1 step 3 and PP-113: typecheck, lint, `pnpm lint:docs`, boundaries (inside lint),
`pnpm module-map:check`, and this slice's own tests. The full `pnpm check` and the API shards belong to `ci-gate` on the
exact head. The exact per-package script names are read from the root `package.json` and the packages' own
`package.json`; this guide does not restate them.

## 2. Scenarios and what each must show

| # | Scenario | Where it is proven | Expected |
|---|---|---|---|
| 1 | Sale revision 1 is projected | worker commissions DB spec _(new)_ | one `commission_sales` row with the event's values, period from `business_date`, the event marked |
| 2 | Refund revision 2 replaces | same spec | refunded amount and revision updated; nothing else moves |
| 3 | Equal or older revision | same spec | row unchanged, event marked |
| 4 | 21:30 UTC on 31 October, `business_date` 2026-11-01 | same spec | period `2026-11` |
| 5 | `REVIEWED` month | same spec | the statement row is `DRAFT` after the delivery |
| 6 | `APPROVED` month | same spec | the delivery throws `COMMISSION_PERIOD_CLOSED`; no row, no mark, no correction row, no blocked-correction row |
| 7 | Malformed money, refund above price, envelope mismatch, business changed | domain unit spec and DB spec _(new)_ | `COMMISSION_SALE_INPUT_INVALID` with its reason; nothing written |
| 8 | A throw after the row is written | DB spec | neither row nor mark; a redelivery projects once |
| 9 | Retained events from before the handler | six-type replay spec (changed) | delivered, marked, rows at the latest revision; the run can end `COMPLETE` |
| 10 | Live same-or-lower revision after the replay | six-type replay spec | no change, marked |
| 11 | Replay revision 1 against live revision 2 (barrier) | concurrency spec _(new or extended)_ | revision 2 stands; the revision-1 writer only marks |
| 12 | Any permutation of a fixed event set | property spec | same final rows as the ordered set |
| 13 | Coverage: no row, a stale row, then covered | coverage specs (changed) | `missing`, `stale`, then `COVERED`; an imported entitlement is never listed |
| 14 | Reader shape, paging, isolation, plan | orders reader spec and its `EXPLAIN` spec _(new)_ | rows `(saleId, revision)`, `SOLD` only, keyset by id, another company's rows never returned, primary-key index scan |
| 15 | Tenant isolation of the table | `packages/db` RLS spec _(new)_, CM-R05 | every negative case of the constitution's Principle V list |
| 16 | Constraints and grants | `packages/db` constraints spec _(new)_, grants and inventory lists (changed) | each check rejects its bad row; `DELETE` and an update of `sale_id` are denied to `pospay_app` |

## 3. Existing tests that must change, not just pass

`PackageSaleChanged` is asserted as "not handled" today. These files pin that behaviour and are rewritten to the new
truth (their old assertions are deleted, not skipped):

- `apps/worker/src/modules/commissions/__tests__/replay-commission-inputs-six-type.spec.ts`
- `apps/worker/src/modules/commissions/__tests__/report-commission-coverage-tips.spec.ts`

## 4. Failure paths to look at by hand once

- Run the coverage report against a seeded company with one unprojected sale: the JSON shows `status: NOT_COVERED` and
  the sale id under `sales.missing`.
- Run the six-type replay, then the report again: `sales.missing.total` is 0 and no `PackageSaleChanged` id is under
  `notHandled`.

## 5. After merge (not part of the local validation)

The staging steps, their order and their receipts are in [plan.md](./plan.md), section "Gates after merge". They are
run by the session that owns the deploy, never from this guide.
