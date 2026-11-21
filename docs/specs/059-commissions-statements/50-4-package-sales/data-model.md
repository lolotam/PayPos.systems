# Data model: row 50-4, package-sale input projection

Phase 1 of [plan.md](./plan.md). One new tenant table. Nothing else in the database changes: no orders table, no
outbox column, no function, no role, no grant on an existing table.

## `commission_sales` _(new)_

Drizzle schema file `packages/db/schema/commissions-sales.ts` _(new)_, exported from `packages/db/schema/index.ts`.
Pattern: `commission_tip_heads` and `commission_salaries` in `packages/db/schema/commissions-tip-salary.ts`.

### Columns

| Column | Type | Null | Source | Note |
|---|---|---|---|---|
| `company_id` | `uuid` | no | event envelope | tenant key |
| `id` | `uuid` | no | `IdGenerator` | UUID v7 |
| `business_id` | `uuid` | no | `business_id` | never changes for a sale |
| `sale_id` | `uuid` | no | `sale_id` | identity from the event; no foreign key to an orders table |
| `branch_id` | `uuid` | no | `branch_id` | the selling branch (spec 058 TD-7) |
| `seller_employee_id` | `uuid` | yes | `seller_employee_id` | nullable as spec 059 §6 lists it; always written |
| `business_date` | `date` | no | `business_date` | the sale's business day, from the event (FR-018) |
| `period` | `text` | no | derived | `YYYY-MM` of `business_date` |
| `price_paid` | `numeric(14,3)` | no | `price_paid` | parsed with `parseMoney` |
| `refunded_amount` | `numeric(14,3)` | no | `refunded_amount` | cumulative after the refund |
| `status` | `text` | no | `status` | `'SOLD'` |
| `revision` | `integer` | no | `revision` | 1 at the sale, +1 per refund |

### Constraints

| Name (pattern of the tips tables) | Rule |
|---|---|
| primary key | `(company_id, id)` (ADR-0007) |
| `commission_sales_sale_unique` | `UNIQUE (company_id, sale_id)` (spec 059 §6) |
| foreign key | `(company_id, business_id)` → `businesses (company_id, id)` |
| foreign key | `(company_id, business_id, branch_id)` → `branches (company_id, business_id, id)` |
| foreign key | `(company_id, business_id, seller_employee_id)` → `employees (company_id, business_id, id)` |
| `commission_sales_revision_positive` | `revision > 0` |
| `commission_sales_period_format` | `period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'` |
| `commission_sales_period_date` | `period = to_char(business_date, 'YYYY-MM')` |
| `commission_sales_price_paid` | `price_paid BETWEEN 0 AND 99999999999.999` |
| `commission_sales_refunded_amount` | `refunded_amount BETWEEN 0 AND price_paid` |
| `commission_sales_status` | `status IN ('SOLD')` |

### Indexes (second migration, `CREATE INDEX CONCURRENTLY`)

| Name | Columns | Serves |
|---|---|---|
| `commission_sales_branch_idx` | `(company_id, business_id, branch_id)` | the branch foreign key |
| `commission_sales_seller_period_idx` | `(company_id, business_id, seller_employee_id, period)` | the employee foreign key, and the seller-month read that 50-5 and 55-1d add |

The handler and the coverage check read by `(company_id, sale_id)`, which the unique constraint's index serves.

### Row-level security and grants (second migration)

Pattern: `packages/db/migrations/0209_2026-11-05_commission-tip-salary-rls.sql`.

- `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`.
- `commission_sales_select` `FOR SELECT TO pospay_app USING (company_id = app_company_id())`.
- `commission_sales_insert` `FOR INSERT TO pospay_app WITH CHECK (company_id = app_company_id())`.
- `commission_sales_update` `FOR UPDATE TO pospay_app USING (…) WITH CHECK (…)` on the same predicate.
- No delete policy.
- `REVOKE ALL ON commission_sales FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher, pospay_notifications`.
- `GRANT SELECT, INSERT ON commission_sales TO pospay_app`.
- `GRANT UPDATE (branch_id, seller_employee_id, business_date, period, price_paid, refunded_amount, status, revision)
  ON commission_sales TO pospay_app`. `company_id`, `id`, `business_id` and `sale_id` are not updatable.

### State transitions

```text
(no row) --revision r arrives--> row at r
row at r --revision r' > r-----> row at r' (event-derived columns replaced)
row at r --revision r' <= r----> unchanged (the event is still marked consumed)
row at r --event names another business--> refused, unchanged
```

There is no delete: a sale is never removed (financial records are immutable, `CLAUDE.md` §5), and the contract has no
cancelled status today.

### Rollback

Expand-only. A rollback of the application images leaves the empty or filled table in place; no older release reads or
writes it. No down migration is needed and none is written (repository practice).

## Read models used, not changed

| Source | Owner | Read by | For |
|---|---|---|---|
| `package_entitlements` (`id`, `revision`, `provenance`, `company_id`) | orders | `listCurrentPackageSales` _(new, orders worker `queries/`)_ | the coverage truth: every `SOLD` entitlement with its latest revision |
| `outbox` rows of type `PackageSaleChanged` | dispatcher | `commissionRetainedEventPage` (exists) | the replay and the unmarked-event check |
| `consumed_events` | commissions consumer | `markedEventIds` (exists) | which retained events carry the mark |
| `commission_statements` | commissions | `lockPeriods` / `reopenReviewed` of the projection scope (exist for tips and salaries) | locking, classifying and reopening the sale's month |

## Identity lock

One transaction advisory lock per sale, taken first in the handler:
`pg_advisory_xact_lock(hashtextextended(app_company_id()::text || ':commission-sale:' || <sale_id>::uuid::text, 0))`,
the form the line (`':commission-line:'`), tip (`':commission-tip-session:'`) and salary locks already use. Lock order
is always the identity lock, then the statement rows (spec 059 FR-015).
