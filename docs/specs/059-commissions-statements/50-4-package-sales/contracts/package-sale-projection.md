# Contracts: row 50-4, package-sale input projection

Phase 1 of [plan.md](../plan.md). This slice exposes no HTTP endpoint. Its contracts are internal: the event it
consumes, the two ports it adds, the reader bound to one of them, and the report field it adds. A name marked _(new)_
is created by the implementation PR; signatures are the intended shape, to be matched against the tips and salary code
they mirror, not copied blindly.

## 1. Consumed event (exists, unchanged)

`PackageSaleChanged`, Zod schema `packageSaleChanged` in `packages/contracts/src/orders/package-sale.ts`.

| Field | Type | Use in the projection |
|---|---|---|
| `sale_id` | uuid | identity; must equal the envelope's aggregate id |
| `business_id` | uuid | row business; fixed for the sale |
| `branch_id` | uuid | row branch |
| `sold_at` | timestamp | **not read** (FR-018) |
| `business_date` | `YYYY-MM-DD` | row date; `period` is its first seven characters |
| `seller_employee_id` | uuid | row seller |
| `price_paid` | money string, three decimals | parsed with `parseMoney` |
| `refunded_amount` | money string, three decimals | parsed with `parseMoney`; must not exceed `price_paid` |
| `status` | `'SOLD'` | stored as is |
| `revision` | positive integer | the guard |
| `schema_version` | `1` | validated by the schema |

Envelope (`ClaimedEvent` from `@pospay/db`): `aggregateType` must be `'package_entitlement'` and `aggregateId` must
equal `sale_id`, compared without case sensitivity (the `normalizeSalaryEvent` precedent).

## 2. Handler outcomes

| Situation | Outcome | Mark | Row |
|---|---|---|---|
| newer revision, open month | applied | yes | inserted or replaced |
| equal or older revision | no-op | yes | unchanged |
| affected month `REVIEWED` | applied, month returned to `DRAFT` | yes | replaced |
| affected month `APPROVED` or `PAID` | throws `CommissionPeriodClosedError` (code `COMMISSION_PERIOD_CLOSED`) | no | unchanged |
| schema parse failure | throws `CommissionLineEventInvalidError('EVENT_SCHEMA')` (the handler's existing path) | no | unchanged |
| envelope mismatch, malformed money, refund above price, business changed | throws `CommissionSaleInputInvalidError` _(new)_, code `COMMISSION_SALE_INPUT_INVALID`, with a fixed reason | no | unchanged |
| business has no timezone | throws `CommissionBusinessMissingError` | no | unchanged |
| month rolled over between plan and lock | throws `CommissionPeriodRolledOverError` (retried) | no | unchanged |

`COMMISSION_SALE_INPUT_INVALID` joins the replay runner's allow-listed continuable failure codes
(`CONTINUABLE_FAILURE_CODES` in `apps/worker/src/modules/commissions/jobs/replay-commission-inputs.ts`), beside
`COMMISSION_TIP_SALARY_INPUT_INVALID`.

## 3. Port: the sale projection scope _(new)_

File `apps/worker/src/modules/commissions/ports/commission-sale-projection.port.ts`. Every method carries its Arabic
doc comment (`CLAUDE.md` §3.1). Shape mirrors `CommissionTipProjectionScope` in
`ports/commission-tip-salary-projection.port.ts`.

```ts
export interface CommissionSaleProjectionScope {
  lockSale(saleId: string): Promise<void>;
  readSale(saleId: string): Promise<CommissionSaleProjectionRow | null>;
  businessTimeZone(companyId: string, businessId: string): Promise<string | null>;
  lockPeriods(input: CommissionPeriodLockInput): Promise<readonly LockedCommissionPeriod[]>;
  upsertSale(row: CommissionSaleProjectionWrite): Promise<void>;
  reopenReviewed(input: CommissionPeriodReopenInput): Promise<void>;
}
```

`CommissionPeriodLockInput` and `CommissionPeriodReopenInput` exist in `ports/commission-line-projection.port.ts`, and
`LockedCommissionPeriod` in `domain/commission-line-types.ts`; the sale port reuses them, as the tips port does.
`CommissionSaleProjectionRow` and `CommissionSaleProjectionWrite` (the row plus its `id`, the
`CommissionSalaryProjectionWrite` precedent) are _(new)_.

## 4. Port: the sale coverage reader _(new)_

Added to `apps/worker/src/modules/commissions/ports/commission-coverage.port.ts`, beside `ServiceLineCoverageReader`.

```ts
export interface SaleCoverageRow {
  readonly saleId: string;
  readonly revision: number;
}

export interface SaleCoveragePage {
  readonly rows: readonly SaleCoverageRow[];
  readonly nextAfter: string | null;
}

export interface PackageSaleCoverageReader {
  readPage(
    tx: CoverageTx,
    companyId: string,
    after: string | null,
    limit: number,
  ): Promise<SaleCoveragePage>;
}
```

`CoverageProjectionReader` gains
`saleRevisions(tx, companyId, saleIds): Promise<readonly SaleCoverageRow[]>`, implemented in
`persistence/commission-coverage.reads.ts` over `commission_sales`.

## 5. Orders reader bound to that port _(new)_

File `apps/worker/src/modules/orders/queries/package-sale-coverage.reader.ts`, exported from
`apps/worker/src/modules/orders/index.ts`, bound in `apps/worker/src/report-commission-coverage.ts` as
`sales: { readPage: listCurrentPackageSales }`. Pattern: `service-line-coverage.reader.ts` in the same folder.

```ts
export function packageSaleCoverageStatement(companyId: string, after: string | null, limit: number): SQL;

export async function listCurrentPackageSales(
  tx: Tx,
  companyId: string,
  after: string | null,
  limit: number,
): Promise<{ rows: { saleId: string; revision: number }[]; nextAfter: string | null }>;
```

Rules:

- read-only, on the caller's tenant transaction; it opens no transaction and takes no lock;
- `package_entitlements` rows of the company with `provenance = 'SOLD'` only, ordered by `id`, keyset on `id`;
- `limit` from 1 to 500, otherwise `RangeError('COVERAGE_PAGE_LIMIT_INVALID')` (the line reader's rule);
- `nextAfter` is the last id when the page is full, otherwise `null`;
- no customer, phone, name or money column is selected.

Under the recommended option of CS-Q51 the reader returns no event ids (research R2, R3).

## 6. Coverage report (changed)

`CommissionCoverageReport` in
`apps/worker/src/modules/commissions/use-cases/report-commission-coverage/report-commission-coverage.ts` gains

```ts
readonly sales: {
  readonly checked: number;
  readonly missing: CoverageIdList;
  readonly stale: CoverageIdList;
};
```

and `status` is `COVERED` only when `sales.missing.total` and `sales.stale.total` are zero as well. `sales` is checked
for the whole company, like lines and salaries, not inside the operator's tip scope. The sale check lives in its own
file `check-sale-coverage.ts` _(new)_ in that folder: the report file is 299 lines today and the limit is 300 (warn)
and 400 (error).

`CommissionCoverageDeps` gains the required member `sales: PackageSaleCoverageReader`, and
`createCommissionCoverageReport` in `commissions.module.ts` takes it from its caller.

Because `COMMISSION_INPUT_EVENT_TYPES` now contains `PackageSaleChanged`, `handledTypes` contains it too: a retained
sale event without the mark moves from the report's `notHandled` list to its `unmarked` list.

## 7. Operator commands (exist, unchanged)

From `apps/worker`, as `docs/runbook.md` sections 50-3c and 50-3d describe:

```sh
node dist/replay-commission-inputs.js --company <uuid> --types six [--after <uuid>] --through <uuid>
```

No flag is added. The coverage report command of section 50-3c is unchanged; its JSON gains the `sales` member.
