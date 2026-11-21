# Feature Specification: Commission package-sale input projection (row 50-4)

**Feature Branch**: not created by this planning session (the manager names the implementation branch)

**Created**: 2026-11-21

**Status**: Draft — CS-Q51 answered on 2026-11-21 (option 1, owner answer verbatim in [`../owner-questions.ar.md`](../owner-questions.ar.md) §60); the build follows the answered option

**Input**: Manager brief of 2026-11-21 for roadmap row **50-4** of [spec 059](../spec.md) ("Package sales": the sales
table with RLS, the `PackageSaleChanged` handler, the root binding of `listCurrentPackageSales`, CM-20 and CM-20b). One
plan and one PR (Waleed's direction, relayed by the manager). This is not GitHub issue #50 and not row 55-2e.

**Base**: `origin/main` at `a8d0d0d82e2ba1b12cf6f4db4e86186922e02145`. Every "exists today" statement below was checked
against that commit; every symbol marked _(new)_ does not exist yet and is created by the implementation PR.

**Relation to spec 059**: this file is a bounded sub-slice specification. It adds no business rule. It restates the
rules of spec 059 that row 50-4 implements (FR-014…FR-020, D-10, D-15, D-51, CM-20, CM-20b, CM-21, CM-22b, CM-R05) and
pins the slice design. Where it and spec 059 differ, the difference is listed under _Open question_ and nowhere else.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A package sale and its refunds reach the seller's commission inputs (Priority: P1)

سارة sells a package at السالمية. The sale, and later every refund on it, is recorded by orders. The commissions module
keeps one current row per sale (who sold it, where, on which business day, how much was paid and how much was refunded so
far), so that the estimate (row 50-5) and the statement (rows 51–53) can price her sale commission on
`price_paid − refunded_amount` (D-51).

**Why this priority**: without the row there is no sale commission anywhere in the product, and a tenant with any
package sale can never reach `COVERED`, so approval can never open for it (runbook, section 50-3c item 5).

**Independent Test**: publish `PackageSaleChanged` events for one sale and read the tenant's sale row; no other module
is needed.

**Acceptance Scenarios**:

1. **Given** no row for sale S, **When** `PackageSaleChanged` revision 1 for S is delivered (price paid 30.000, refunded
   0.000, seller سارة, branch السالمية, `business_date` 2026-11-01), **Then** one row for S exists with those values,
   period `2026-11` and revision 1, and the event carries the consumer's mark.
2. **Given** the row at revision 1, **When** revision 2 arrives with refunded 10.000, **Then** the row shows refunded
   10.000 and revision 2; price paid, seller, branch and business date are unchanged.
3. **Given** the row at revision 2, **When** revision 1 or revision 2 is delivered again, **Then** nothing changes and
   the event is marked consumed (D-10: an older or equal revision is a no-op).
4. **Given** a sale at 21:30 UTC on 31 October whose event carries `business_date` 2026-11-01, **When** it is projected,
   **Then** its period is `2026-11` (CM-20, FR-018: the month comes from the event, never from converting `sold_at`).
5. **Given** the seller's month is `REVIEWED`, **When** a sale or a refund of that month is projected, **Then** the
   month returns to `DRAFT` in the same transaction (D-5).

---

### User Story 2 - Sales recorded before this consumer existed are brought in, and approval stays closed until they are (Priority: P1)

Row 42 has published `PackageSaleChanged` since it merged, with no consumer. After this slice is deployed the operator
re-delivers those retained events to the commissions consumer, then reads the coverage report. The report compares, for
every sold package of the company, the revision orders holds with the revision commissions projected.

**Why this priority**: CM-20b and CM-34b. Approval (row 53-2) must not open on a month whose sales are missing or stale.

**Independent Test**: seed retained `PackageSaleChanged` events with no consumer mark, run the six-type replay, then run
the coverage report.

**Acceptance Scenarios**:

1. **Given** a company with retained, unmarked `PackageSaleChanged` events, **When** the six-type replay runs with a
   fixed upper bound, **Then** each event is delivered to `commissions.project-inputs`, each carries the mark, each sale
   has a row at its latest revision, and the run can end `COMPLETE`.
2. **Given** that replay has run, **When** a live event of the same or a lower revision arrives for one of those
   sales, **Then** it changes nothing and is marked (CM-20b).
3. **Given** a sold package whose projected revision is below the revision orders holds, or that has no projected row,
   **When** the coverage report runs, **Then** the report is `NOT_COVERED` and lists the sale as stale or missing;
   after the replay it is `COVERED` for sales.
4. **Given** an imported package (no seller, no event, D-51), with or without refunds, **When** the coverage report
   runs, **Then** it is not counted as a missing sale.

---

### User Story 3 - A replay and a live delivery of the same sale do not corrupt each other (Priority: P2)

**Why this priority**: CM-22b names the sale explicitly ("the same test for a tip session, a salary entry and a sale").

**Independent Test**: a barrier test with two transactions on one sale identity.

**Acceptance Scenarios**:

1. **Given** a replayed revision 1 and a live revision 2 of one sale racing, **When** revision 2 commits first,
   **Then** the waiting revision-1 writer, rechecking under the identity lock, applies nothing and only marks its event.
2. **Given** any permutation, duplication or replay of a fixed set of sale events, **When** all are delivered,
   **Then** the rows equal the rows after the ordered set (CM-21).

### Edge Cases

- **A sale or refund whose month is `APPROVED` or `PAID`**: the delivery is refused with `COMMISSION_PERIOD_CLOSED`
  before any write; the event is retried and then parked. The `SALE` correction is row 55-1d, not this slice (spec 059
  FR-015, the 50-1 precedent; `plan-55-1b.md` §3 and risk R6). No approval path is on `main` at the base (row 53-2 is
  not merged), so no real tenant has a closed month yet.
- **A malformed amount** (`price_paid` or `refunded_amount` that `parseMoney` rejects, or a refund above the price):
  the event is parked as a producer bug, never projected as zero (FR-017).
- **An event whose envelope does not name the sale** (aggregate type is not `package_entitlement`, or the aggregate
  id is not the payload's `sale_id`): refused as invalid input.
- **A later revision that names another business** for the same sale: refused as invalid input (the tips and salary
  precedent, `assertTipIdentityUnchanged`); the row is not moved.
- **A later revision whose branch, business date or seller differs** (the producer cannot do this today, spec 058
  TD-7): the newer revision replaces the row, and both the old and the new month are locked and classified, exactly as
  the tips projection does (FR-018: "a removal from one month and an addition to another").
- **The business's current month rolls over between planning and locking**: `CommissionPeriodRolledOverError`, a
  retry, as the tips and salary handlers do.
- **An unknown business** (no timezone row): `CommissionBusinessMissingError`; the event is parked.
- **A retained event that is missing from the outbox**: the replay cannot recover it; the coverage report keeps the
  sale under `missing`, approval stays closed and the manager investigates (the CS-Q41 rule, PP-185; no re-emit exists).
- **A worker rollback to a release without this handler**: events published meanwhile carry no mark; after the
  upgrade the six-type replay is re-run with a new upper bound (CS-Q43, PP-185; runbook section 50-3d).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-A01** The worker consumer `commissions.project-inputs` MUST register and handle `PackageSaleChanged`
  (spec 059 FR-014, FR-019).
- **FR-A02** For one event, in the one tenant transaction the consumer already runs in, the handler MUST follow the
  order of spec 059 FR-015: take the sale's identity lock, read the held revision, drop an older or equal revision,
  compute the affected months, lock those statement months and every candidate month through the business's current
  month, classify them from the statuses that lock returned, apply the row, return each affected `REVIEWED` month to
  `DRAFT`. Any failure rolls back everything, the consumer's mark included.
- **FR-A03** The projection row MUST hold, per sale: business, sale id, branch, seller, business date, period, price
  paid, refunded amount, status and revision (spec 059 §6 _Schema_, `commission_sales`).
- **FR-A04** Money MUST be parsed with `parseMoney`; a malformed amount parks the event (FR-017).
- **FR-A05** `business_date` and `period` MUST come from the event (FR-018). The handler MUST NOT read `sold_at`.
- **FR-A06** An affected month that is `APPROVED` or `PAID` MUST refuse the delivery with `COMMISSION_PERIOD_CLOSED`
  before any write. No correction row and no blocked-correction row is written by this slice.
- **FR-A07** An orders-owned, paged, read-only reader `listCurrentPackageSales` _(new)_ MUST return the identity and
  latest revision of every `SOLD` package entitlement of a company and MUST exclude `IMPORTED` ones. It is bound to a
  commissions-owned port at the worker composition root; commissions code never imports orders (D-15, module map).
- **FR-A08** The commission coverage report MUST compare that reader with the sale rows: a sale with no row is
  `missing`, a sale whose row revision is below the reader's is `stale`, and either makes the report `NOT_COVERED`
  (CM-20b's coverage rule, the rule CS-Q41 applies to lines).
- **FR-A09** Sales recorded before the handler existed MUST be projected and their event ids discharged by the
  existing six-type retained-event replay, with no change to the runner
  **[ANSWERED 2026-11-21 — CS-Q51, owner answer verbatim in `../owner-questions.ar.md` §60: «دخل المبيعات القديمة
  بالمسار الموجود، واستعمل القارئ للتأكد إن كل بيع وصل بآخر نسخة» — the replay projects and discharges;
  `listCurrentPackageSales` returns sale identity and latest revision only, no event ids (spec 059 D-15, FR-020 and
  CM-20b carry the dated amendment note; ADR-0054 §4 addendum records it).]**
- **FR-A10** The slice MUST NOT change the producer, the event contract, the outbox, any orders table, any API route,
  any permission, any UI, the correction step, the blocked-correction rows or the statement tables.

### Key Entities *(include if feature involves data)*

- **Commission sale** _(new)_: the current state of one sold package as commissions sees it; identified by the
  sale id inside the company; one row per sale, replaced by a newer revision.
- **Package sale event** (exists): `PackageSaleChanged`, published by orders for a `SOLD` entitlement at the sale
  (revision 1) and at every refund (revision + 1), never for an imported one (spec 058 TD-7).
- **Sold package entitlement** (exists, owned by orders): the source of truth the coverage reader pages through.

## Slice design *(mandatory — `CLAUDE.md` §1)*

### Business rules

No new rule. The rules this slice implements, all already decided:

- **BR-A01** (D-10, CM-20) A sale is keyed by its sale id; a newer revision replaces the row; an older or equal one is
  a no-op with a mark. Example: revision 1 (paid 30.000, refunded 0.000) then revision 2 (refunded 10.000) leaves
  paid 30.000, refunded 10.000, revision 2; a late revision 1 changes nothing.
- **BR-A02** (FR-018, CM-20) The sale's month is the `YYYY-MM` of the event's `business_date`. Example: `sold_at`
  2026-10-31T21:30Z with `business_date` 2026-11-01 is a November sale.
- **BR-A03** (D-51) An imported package has no seller and no sale commission; it emits no event, so it has no row and
  is outside sale coverage.
- **BR-A04** (D-5) A change to a `REVIEWED` month returns it to `DRAFT`.
- **BR-A05** (CM-20b, CS-Q41) Approval stays closed until every sold package's projected revision is at least the
  revision orders holds. This slice ships the reader, the port and the worker report; the approval-time check is 53-2's.

This slice computes no commission amount. `computePackageSaleCommission` (exists, `packages/commissions-engine`) is
called by the estimate (50-5) and the correction step (55-1d), not here.

### Schema changes

| Table | Columns added / changed | RLS policy (`FOR SELECT` / mutations) | Indexes | Tenant-qualified FKs |
|---|---|---|---|---|
| `commission_sales` _(new)_ | `company_id`, `id`, `business_id`, `sale_id`, `branch_id`, `seller_employee_id` (nullable, as spec 059 lists it), `business_date`, `period`, `price_paid numeric(14,3)`, `refunded_amount numeric(14,3)`, `status`, `revision` | `ENABLE` + `FORCE`; `select`, `insert`, `update` policies for `pospay_app` on `company_id = app_company_id()`; no delete policy and no delete grant; `REVOKE ALL` from `PUBLIC` and the four runtime roles, then `SELECT, INSERT` and `UPDATE` on the event-derived columns only | PK `(company_id, id)`; `UNIQUE (company_id, sale_id)`; `(company_id, business_id, branch_id)`; `(company_id, business_id, seller_employee_id, period)`; both secondary indexes `CONCURRENTLY` | `(company_id, business_id)` → `businesses`; `(company_id, business_id, branch_id)` → `branches`; `(company_id, business_id, seller_employee_id)` → `employees` |

Details, checks and grants: [data-model.md](./data-model.md). No orders table changes; `sale_id` is an identity taken
from the event, with no foreign key to an orders-owned table (the `commission_tip_heads.session_id` precedent).

### API contract

- **Endpoint**: none. This slice adds no route.
- **Request / response**: none. The consumed event's Zod schema `packageSaleChanged` exists in
  `packages/contracts/src/orders/package-sale.ts` and is not changed.
- **Idempotency-Key**: not a write endpoint. The consumer's idempotency is its `consumed_events` mark plus the
  revision guard under the identity lock.
- **Errors**: worker domain errors only, never an HTTP envelope: `COMMISSION_PERIOD_CLOSED`,
  `COMMISSION_BUSINESS_MISSING`, the period-rollover error and `COMMISSION_LINE_EVENT_INVALID` exist;
  `COMMISSION_SALE_INPUT_INVALID` _(new)_ for a sale event the handler refuses.

### Permissions

- None added or changed. The handler runs as the worker's `pospay_app` role inside `withTenant(event.company_id)`.

### Events

- **Published**: none.
- **Consumed**: `PackageSaleChanged` from `orders` (worker producer `package-sale.scope.ts` at the sale, API producer
  `package-refund.transactions.ts` at a refund), aggregate type `package_entitlement`, aggregate id = `sale_id`.

### Test plan

- **Domain unit**: the pure sale reducer, the affected-month helper and the identity check _(all new)_: newer / equal /
  older revision, a refund above the price, a month boundary, a business change, a branch-date-seller change.
- **Integration scenarios**: `CM-20` (upsert by revision, a November sale at 21:30 UTC on 31 October, a `REVIEWED`
  month reopened, a closed month refused with nothing written, a malformed amount, an envelope mismatch) ·
  `CM-20b` (retained events delivered and marked by the six-type replay, a later same-or-lower revision ignored,
  coverage `missing` / `stale` / covered, imported packages excluded) · `CM-21` (the sale leg of the permutation
  property test) · the CM-22a pattern applied to a sale (a throw after the row is written leaves neither row nor mark; spec 059 states
  CM-22a for lines only, so this is an added test, not a claimed acceptance id) ·
  `CM-22b` (the sale leg of the barrier race).
- **RLS negative**: `CM-R05` on `commission_sales` — cross-tenant read 0 rows, cross-tenant insert rejected,
  cross-tenant update and delete 0 rows or denied, `company_id` not changeable, a foreign key across tenants rejected,
  nothing visible outside `withTenant`.
- **Queries**: the reader's result shape, paging and isolation, and an `EXPLAIN` assertion that it walks the
  `package_entitlements` primary key.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-A01** For every sold package, after its events are delivered in any order, the tenant holds exactly one sale
  row at the package's latest revision, with the paid and refunded amounts orders holds, to the mill.
- **SC-A02** A tenant with package sales can reach a covered state: after one replay run the coverage report lists
  zero missing and zero stale sales and no package-sale event as "not handled".
- **SC-A03** No sale or refund is ever attributed to a month other than the month of its business date.
- **SC-A04** No row of one company is readable or writable from another company's session.
- **SC-A05** A closed month's frozen figures are never changed by this slice.

## Assumptions

- The implementation follows the tips and salary projection (row 50-2b) file for file; where this spec is silent, that
  code is the precedent.
- `status` stores the event's value, `'SOLD'` (the only value the contract allows today). Mapping it to the engine's
  `ACTIVE` / `CANCELLED` is done by the reader that feeds the engine (50-5, 55-1d). A later sale-cancellation status
  widens the check in the slice that introduces it.
- `seller_employee_id` stays nullable because spec 059's schema row says so; the contract makes it required, so the
  handler always writes it.
- The projection writes no `AuditLog` row: it is a derived input, and the sale and the refund are already audited by
  their writers. No handler in `apps/worker/src/modules/commissions` writes an audit row today.
- The API-side binding of the coverage reader for approval (CM-34b) belongs to row 53-2, as spec 059's 50-3c row says
  of the coverage comparison ("used by the worker report now and by 53-2's api binding later").
- Outbox events are retained: no runtime role can delete from `outbox` (`pospay_app` has `INSERT` only,
  `pospay_dispatcher` has `SELECT` and a column-limited `UPDATE`).

## Open question

| Id | Kind | Question | Status | Blocks |
|---|---|---|---|---|
| **CS-Q51** | technical — the manager, and Waleed if the manager escalates | How are sales recorded before 50-4 projected and their event ids discharged, given that orders stores no event id for them? | **ANSWERED 2026-11-21** — option 1, Waleed's verbatim answer «دخل المبيعات القديمة بالمسار الموجود، واستعمل القارئ للتأكد إن كل بيع وصل بآخر نسخة», recorded in [`../owner-questions.ar.md`](../owner-questions.ar.md) §60; the build follows it and spec 059 D-15/FR-020/CM-20b carry the dated amendment notes | nothing — the merge no longer waits on it |

Nothing else is open. No business rule (money, permission, tenant scope, who sees what) is undecided in this slice.
