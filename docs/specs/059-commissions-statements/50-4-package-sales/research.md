# Research: row 50-4, package-sale input projection

Phase 0 of [plan.md](./plan.md). Every finding was read at `origin/main` `a8d0d0d82e2ba1b12cf6f4db4e86186922e02145`.
Paths are relative to the repository root. A symbol marked _(new)_ does not exist yet.

## R1. Is the row-42 producer prerequisite met?

**Decision:** yes. 50-4 does not need to "refuse to start" (spec 059 FR-018).

**Evidence:**

- The contract `packageSaleChanged` (`packages/contracts/src/orders/package-sale.ts`) is a strict object with
  `sale_id`, `business_id`, `branch_id`, `sold_at`, `business_date`, `seller_employee_id`, `price_paid`,
  `refunded_amount`, `status: 'SOLD'`, `revision` (positive integer) and `schema_version: 1`.
- The sale writes it in the sale's transaction: `apps/worker/src/modules/orders/persistence/package-sale.scope.ts`
  (`appendOutboxEvent`, aggregate type `package_entitlement`, aggregate id = the entitlement id).
- A refund writes it in the refund's transaction:
  `apps/api/src/modules/orders/persistence/package-refund.transactions.ts` (same aggregate type, aggregate id =
  `sale_id`), built by `packageSaleChanged()` in `apps/api/src/modules/orders/domain/package-sale-changed.ts`.
- `sale_id` is the entitlement id on both paths: `apps/worker/src/modules/orders/domain/package-sale-plan.ts` sets the
  entitlement's `id` from `identities.saleId` and the event's `sale_id` from `entitlement.id`.
- An imported entitlement never publishes: `planPackageRefund` sets `publicationRequired` only when the provenance is
  `SOLD` (`apps/api/src/modules/orders/domain/package-refund-plan.ts`), and spec 058 TD-7 says an import emits nothing.
  An imported entitlement's `revision` still grows on a refund (`newRevision: facts.revision + 1`).
- The dispatcher already knows the type: `apps/worker/src/outbox/known-event-types.ts` lists `PackageSaleChanged`.

## R2. Does `listCurrentPackageSales` exist, and can it return event ids?

**Decision:** it does not exist anywhere in code, and it cannot return event ids from what orders stores today.

**Evidence:**

- The name appears only in `docs/specs/059-commissions-statements/spec.md` (D-15, CM-20b, CM-34b, FR-020, the 50-4
  row). No `*.ts` file and no other document contains it.
- Storage of the sale: `package_entitlements` (`packages/db/schema/orders-packages.ts`) holds `sold_branch_id`,
  `sold_business_date`, `seller_employee_id`, `price_paid`, `refunded_amount`, `revision` and `provenance`. Refunds are
  rows of `package_refunds` with `entitlement_revision`. No file under `packages/db/schema/orders-package*.ts` has an
  `event_id` column.
- Both producers give the event an independent id (`ids.newId()` passed to `appendOutboxEvent`), which is the reason
  D-15 gave for rejecting a line reader with event ids ("the ids cannot be recovered from the row").
- The tips reader can return ids only because `session_tip_revisions.event_id` exists
  (`packages/db/src/current-session-tips.ts`, `array_agg(r.event_id …)`). Package sales have no such column.
- `pospay_app` cannot read the outbox (`GRANT INSERT ON outbox TO pospay_app`, migration `0004`); only
  `pospay_dispatcher` selects from it (migration `0006`). So an orders reader cannot join the outbox either.
- D-15 itself forbids the remedies: "No provenance column, no new `SECURITY DEFINER` function, no new grant".

## R3. How are pre-existing sales projected and their event ids discharged?

**Decision (recommended option of CS-Q51):** by the six-type retained-event replay that 50-3d already shipped, with no
runner change. `listCurrentPackageSales` returns identity and revision only and proves coverage.

**Rationale:**

- The replay facade already includes the type: `COMMISSION_RETAINED_REPLAY_TYPES` in `packages/db/src/dispatcher.ts`,
  behind `commissionRetainedEventPage`, with its partial index (migration `0229`).
- The runner derives what it may deliver from the consumer: `apps/worker/src/replay-commission-inputs.ts` passes
  `handledTypes: new Set(consumer.eventTypes)`, and `apps/worker/src/modules/commissions/jobs/replay-commission-inputs.ts`
  reports a six-type event as `COMMISSION_EVENT_TYPE_NOT_HANDLED` only when its type is not in that set. Adding the
  type to the consumer is the whole change.
- The recorded owner answer already says so. `owner-questions.ar.md` §47–50, rule (د) of PP-185 (CS-Q43):
  «`PackageSaleChanged` بيتسلّم لما 50-4 تسجّل معالجه»، «وكل صف محفوظ بياخد علامته». The runbook (section 50-3d
  item 3) says "Once 50-4 merges, the same rows are delivered with no change to the runner".
- **The same rule (د) also says two things this mechanism departs from, and the decision-maker must weigh them:** it
  presents the six-type replay as the run made "after any rollback then upgrade", not as the first bootstrap, and it
  describes the current-state reader for package sales as one that discharges the event id of the current revision
  («القارئ اللي بيقرا الحالة الحالية (`listCurrentSessionTips` وآخر نسخة لبيع باكدج) بيفرّغ بس رقم الحدث بتاع النسخة
  الحالية»), so it assumed a reader that returns an event id. The recommended option uses the same replay for the
  first bootstrap too and a reader with no event ids.
- The latest retained event of a sale carries the sale's whole current state (the cumulative `refunded_amount`), so
  the projection after the replay equals a projection built from current state.
- Coverage by revision is the rule CS-Q41 chose for lines and named «نفس قاعدة CM-20b».
- No runtime role can delete an outbox row (R2: `pospay_app` inserts only, `pospay_dispatcher` selects and updates
  five delivery columns), so a published sale event stays retained.

**Alternatives considered:**

- **A state bootstrap from the reader, like the tips bootstrap** (`bootstrap-session-tips.ts`): it would project the
  same rows the replay projects, could not discharge any event id (R2), and would add a second writer path of about the
  size of the tips bootstrap (275 production lines plus tests). Rejected: no outcome it adds.
- **An `event_id` column on the sale and refund rows in orders**: a migration on orders tables, a producer change and
  a backfill that cannot recover the ids already issued; D-15 forbids the provenance column. Rejected.
- **A grant or a definer so the reader reads the outbox**: forbidden by D-15 and `CLAUDE.md` §5.

**Why this is still a recorded question:** spec 059's letter (D-15 "with its event ids", FR-020 "package sales from row
42's `listCurrentPackageSales`", CM-20b "projected from `listCurrentPackageSales`") differs from this mechanism. It is a
code-design point, so it is recorded as **CS-Q51** (technical) for the manager, and the spec 059 amendment note waits on
the answer. The outcomes CM-20b lists are all met by the recommended mechanism.

## R4. Is the orders-owned reader a bounded part of this PR or a separate dependency?

**Decision:** a bounded part of this PR.

**Evidence and rationale:**

- Spec 059's 50-4 row itself lists "the root binding of `listCurrentPackageSales`" and its dependency as "row 42
  (producer with `business_date`, and its reader)". Row 42 merged without the reader, so the reader has no owner
  slice left but this one.
- Precedent: 50-3c (PR #1010) shipped the orders service-line coverage reader
  (`apps/worker/src/modules/orders/queries/service-line-coverage.reader.ts`), its export in the worker orders
  `index.ts`, its binding in `apps/worker/src/report-commission-coverage.ts` and its Port row in `docs/module-map.md`
  inside the commissions sub-PR. 50-3b did the same for the worker tips reader.
- Size: the line reader is 49 lines; the sale reader is the same shape with one more predicate.
- It touches no orders table, no orders write path and no orders use case; it adds one read-only `queries/` file and
  one export line. The reason for touching `orders` is stated in the PR (CLAUDE.md §1 rule 4).
- No module-map import arrow is added: the reader is bound at the worker composition root to a commissions-owned
  port, as `docs/module-map.md` already describes for this pair ("ports named by 50-3 and 50-4").

**The reader must filter `provenance = 'SOLD'`:** an imported entitlement's revision grows on a refund without any
event (R1), so an unfiltered reader would report imports as missing forever and no tenant with an import could be
covered.

## R5. What does the handler do for a closed month?

**Decision:** refuse with `CommissionPeriodClosedError` before any write; no `SALE` correction in this slice.

**Rationale:** `plan-55-1b.md` §3 assigns "the correction step for package sales (kind `SALE`)" to 55-1d, "after 50-4".
The correction step recomputes a month from `readMonthProjection`
(`apps/worker/src/modules/commissions/persistence/commission-correction-month-readers.ts`), which returns `sales: []`
today; calling `postCommissionCorrections` from the sale handler before 55-1d wires sales in would recompute the month
without the sale and post nothing for it. Refusing is what 50-1 shipped before the correction step existed (spec 059
FR-015, "What 50-1 ships"). `COMMISSION_PERIOD_CLOSED` is already an allow-listed continuable failure of the replay
runner. Row 53-2 (approval) is not on `main`: no non-test file under `apps/api/src`, `apps/worker/src` or
`packages/db/src` writes a commission statement to `APPROVED` or `PAID`, and no commit implements 53-1 or 53-2. A
commission month can therefore be closed only by a test seed today.

**Consequence to state in the PR:** a parked sale event holds later events of the same sale (the dispatcher delivers
one aggregate in order). 55-1d releases them by re-delivering through the replay.

## R6. Which columns can a newer revision change?

**Decision:** every event-derived column except the business. The newer revision replaces branch, seller, business
date, period, paid, refunded, status and revision; a different business is refused.

**Rationale:** the producer changes only `refunded_amount` and `revision` on a refund
(`apps/api/src/modules/orders/persistence/package-refund-records.ts`, `UPDATE package_entitlements SET refunded_amount
…, revision …`). FR-018 nevertheless states the general rule ("a removal from one month and an addition to
another"), and the tips projection already implements exactly that (`tipAffectedPeriods`, `assertTipIdentityUnchanged`
in `apps/worker/src/modules/commissions/domain/commission-tip-salary-periods.ts`; `GRANT UPDATE (revision, branch_id,
business_date, period) ON commission_tip_heads`). Mirroring it invents no new refusal.

## R7. Migration shape

**Decision:** two expand-only migration files, as `0208` / `0209` did for tips and salaries: the table and its foreign
keys, then the concurrent indexes with RLS, policies, revokes and grants. Numbers are reserved by the manager in merge
order and made final at merge (the next free number at the base is `0234`).

**Evidence:** `packages/db/migrations/0208_2026-11-05_commission-tip-salary.sql`,
`0209_2026-11-05_commission-tip-salary-rls.sql`; each migration adds one generated snapshot of about 30,500 lines
(`packages/db/migrations/meta/0233_snapshot.json` is 30,559 lines).

## R8. Size precedents (merged sibling PRs, `git show --numstat`)

| PR | Spec band | Production | Migration SQL | Tests | Docs | Generated |
|---|---|---|---|---|---|---|
| #844 tips and salary schema (three tables) | part of 350–480 | +130 | +102 | +347 | +58 | +54,576 |
| 50-2b card 2, tips and salary handlers (`656a34fa2`) | part of 350–480 | +728 / −26 | 0 | +1,401 / −58 | +186 / −4 | 0 |
| #998 tips bootstrap (50-3b) | 250–350 | +791 / −154 | 0 | +1,235 | +50 / −1 | 0 |
| #1010 coverage report (50-3c) | 300–420 | +984 | 0 | +1,174 | +51 | 0 |
| #1023 six-type replay (50-3d) | 200–300 | +654 / −143 | +1 | +1,016 / −18 | +144 / −13 | +30,216 |

The spec's bands were written before any of these was measured; every delivered sub-PR is several times its band.
