# Implementation Plan: Commission package-sale input projection (row 50-4)

**Branch**: set by the manager at dispatch (this planning session created none) | **Date**: 2026-11-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `docs/specs/059-commissions-statements/50-4-package-sales/spec.md`, a bounded
sub-slice of [spec 059](../spec.md).

**Base**: `origin/main` at `a8d0d0d82e2ba1b12cf6f4db4e86186922e02145`. **Delivery**: one plan, one PR (Waleed's
direction, relayed by the manager on 2026-11-21). **This document plans; it implements nothing.**

## Summary

Row 50-4 gives the commissions module its fourth input: package sales. The PR adds the tenant table
`commission_sales`, teaches the existing worker consumer `commissions.project-inputs` to apply `PackageSaleChanged` by
revision under an identity lock (spec 059 FR-015), adds an orders-owned read-only reader `listCurrentPackageSales`
bound at the worker composition root to a commissions-owned port, and extends the commission coverage report with a
sale section. Sales published before the handler existed are projected, and their event ids discharged, by the
six-type retained-event replay that row 50-3d already shipped, with no change to the runner
([research.md](./research.md) R3; this mechanism is the recommended option of the open technical question CS-Q51).

It computes no money. It adds no route, permission, event, UI, producer change or correction.

## Prerequisites verified at the base

| Prerequisite (spec 059, 50-4 row) | State | Evidence |
|---|---|---|
| 50-1 line projection: the consumer, the lock plan, the period classification | **merged** | `apps/worker/src/modules/commissions/commissions.module.ts` (`createCommissionInputsConsumer`), `domain/commission-periods.ts` (`commissionPeriodLockPlan`, `classifyCommissionPeriods`, `currentBusinessPeriod`) |
| 50-2 tips and salaries (the pattern this slice copies) | **merged** | `use-cases/project-session-tips/`, `use-cases/project-salary/`, migrations `0208`, `0209` |
| Row 42 producer with `business_date` and `branch_id` | **merged** | [research.md](./research.md) R1 |
| Row 42 reader `listCurrentPackageSales` | **absent** | [research.md](./research.md) R2: the name exists only in spec 059 |
| 50-3d six-type replay carrying `PackageSaleChanged` | **merged** | `packages/db/src/dispatcher.ts`, `apps/worker/src/replay-commission-inputs.ts` |
| 50-3c coverage report and its ports | **merged** | `use-cases/report-commission-coverage/`, `ports/commission-coverage.port.ts` |
| 50-a engine types for a sale | **merged** | `CommissionPackageSale`, `ProjectedPackageSale`, `computePackageSaleCommission` in `packages/commissions-engine/src` |

**Verdict on the missing reader:** it is a bounded part of this one PR, not a separate dependency
([research.md](./research.md) R4). What is genuinely open is narrower: the reader cannot return event ids, so the
mechanism spec 059 words for the bootstrap needs a recorded confirmation (CS-Q51, technical). That question blocks the
merge, not the build.

## Technical Context

**Language/Version**: TypeScript 6.0.3 on Node.js ≥ 24 (root `package.json`)

**Primary Dependencies**: NestJS worker, `drizzle-orm` 0.45.2, `drizzle-kit` 0.31.10, `zod` 4.6.5,
`@pospay/contracts`, `@pospay/db`, `@pospay/domain`, `@pospay/commissions-engine`. No new dependency.

**Storage**: PostgreSQL through `packages/db` (`withTenant`, RLS). One new table, two migrations.

**Testing**: `vitest` 5.0.1; integration tests against the compose Postgres, one cloned database per spec file
(ADR-0006); database suites one at a time per cluster.

**Target Platform**: the `worker` image (the consumer, the replay entry, the coverage report entry) and the one-shot
`migrate` step. `api`, `admin`, `pos`, `menu` and `business` are not touched.

**Project Type**: modular monolith, worker module slice.

**Performance Goals**: one event = one short transaction with a bounded number of statements (one advisory lock, one
row read, the statement-period lock, one upsert). The reader is a keyset page on a primary key. No fixed
millisecond limit is asserted (PP-165).

**Constraints**: file ≤ 300 lines (warn) / 400 (error), function ≤ 60 lines; Arabic JSDoc on every new `domain/`
export and `ports/` method; no arithmetic and no `drizzle` / `sql` / `fetch` / `axios` in a use case; `Clock` and
`IdGenerator` injected; money as `bigint` mills or `Money`.

**Scale/Scope**: one row per sold package per company; an event per sale and per refund.

## Constitution Check

*GATE: passed before Phase 0 and re-checked after Phase 1.*

| Principle | Check | Result |
|---|---|---|
| I. One vertical slice | One use case (`project-package-sale`), one spec, one PR; the touch outside `commissions` (one orders `queries/` file and one export) is stated with its reason in research R4 | pass |
| II. Domain purity and money | The reducer, the affected-month helper, the identity check and the money validation are pure functions in `domain/`; the use case orchestrates; money parsed with `parseMoney`, never a `number`; `Clock` / `IdGenerator` injected | pass |
| III. Tenant isolation | New table with `company_id`, `FORCE` RLS, explicit `WITH CHECK`, tenant-qualified composite foreign keys, indexes led by `company_id`, and the negative test CM-R05 in the same PR; all access inside `withTenant`; no new role, grant on another table, definer or `BYPASSRLS` | pass |
| IV. Module boundaries | No import arrow added; the orders reader reaches commissions only through a commissions-owned port bound at the worker root; `docs/module-map.md` gets its Port row; `pnpm module-map:check` is a local gate | pass |
| V. Test-backed delivery | Domain unit tests, DB integration tests for the use case, RLS negatives, and a result-shape plus `EXPLAIN` test for the new `queries/` file | pass |
| VI. Arabic-first UI | No UI | not applicable |
| VII. Documented why, in Arabic | Arabic JSDoc on the new domain exports, port methods and the use-case class; the stale comments this slice makes untrue are updated in the same commit | pass |

No violation, so _Complexity Tracking_ is empty.

## Project Structure

### Documentation (this feature)

```text
docs/specs/059-commissions-statements/50-4-package-sales/
├── spec.md                              # /speckit-specify output
├── plan.md                              # this file
├── research.md                          # Phase 0
├── data-model.md                        # Phase 1
├── quickstart.md                        # Phase 1
├── contracts/package-sale-projection.md # Phase 1
└── checklists/requirements.md           # specification quality checklist
```

`tasks.md` is not created by `/speckit-plan`.

### Source Code (repository root)

N = new file, M = modified. Estimates are added + deleted lines, hand-written unless marked generated.

**Production**

| # | Path | | Assumption | + | − |
|---|---|---|---|---|---|
| P1 | `packages/db/schema/commissions-sales.ts` | N | one table, the shape of `commission_tip_heads` plus money columns ([data-model.md](./data-model.md)) | 60–75 | 0 |
| P2 | `packages/db/schema/index.ts` | M | one export line | 1 | 0 |
| P3 | `apps/worker/src/modules/commissions/domain/commission-sale-inputs.ts` | N | row and event types, the revision reducer, the affected-month helper, the identity check, the money validation, each with Arabic JSDoc | 110–150 | 0 |
| P4 | `apps/worker/src/modules/commissions/domain/errors.ts` | M | `CommissionSaleInputInvalidError`, the shape of `CommissionTipSalaryInputInvalidError`; the file is 221 lines today | 18–25 | 0 |
| P5 | `apps/worker/src/modules/commissions/ports/commission-sale-projection.port.ts` | N | the scope interface with Arabic JSDoc per method | 60–85 | 0 |
| P6 | `apps/worker/src/modules/commissions/persistence/commission-sale-projection.scope.ts` | N | advisory lock, read, upsert, and reuse of the existing period lock and reopen helpers | 95–125 | 0 |
| P7 | `apps/worker/src/modules/commissions/use-cases/project-package-sale/project-package-sale.ts` | N | the use case class and `normalizePackageSaleEvent`; shorter than `project-session-tips.ts` (118 lines) because it posts no correction | 100–130 | 0 |
| P8 | `apps/worker/src/modules/commissions/events/handlers/on-commission-input-event.handler.ts` | M | the schema entry, the `sales` use case, one branch | 14–20 | 2–4 |
| P9 | `apps/worker/src/modules/commissions/commissions.module.ts` | M | add the type to `COMMISSION_INPUT_EVENT_TYPES`, bind the use case, pass the sale reader to the report; the file is 196 lines today | 22–32 | 2–4 |
| P10 | `apps/worker/src/modules/commissions/ports/commission-coverage.port.ts` | M | `SaleCoverageRow`, `SaleCoveragePage`, `PackageSaleCoverageReader`, `saleRevisions`; 155 lines today | 38–50 | 0 |
| P11 | `apps/worker/src/modules/commissions/persistence/commission-coverage.reads.ts` | M | `saleRevisions` over `commission_sales` | 18–26 | 0 |
| P12 | `apps/worker/src/modules/commissions/use-cases/report-commission-coverage/check-sale-coverage.ts` | N | the paged sale comparison, the shape of the line check, in its own file because the report file is 299 lines | 70–95 | 0 |
| P13 | `apps/worker/src/modules/commissions/use-cases/report-commission-coverage/report-commission-coverage.ts` | M | the `sales` member, the dependency, the call and the status rule. The file is 299 lines, so these lines put it in the 300–400 warn band (as `jobs/replay-commission-inputs.ts`, 324 lines, already is); it must stay under the 400-line error. To stay under 300 instead, move `CommissionCoverageScopeInvalidError` and `isCommissionCoverageCalendarDate` (lines 101–134 at the base) to a sibling file and re-export them from this one, so `index.ts` is unchanged; that move is allowed and adds about 40 moved lines to both columns | 14–22 | 2–6 |
| P14 | `apps/worker/src/modules/orders/queries/package-sale-coverage.reader.ts` | N | the statement builder and `listCurrentPackageSales`, the shape of `service-line-coverage.reader.ts` (50 lines) | 50–62 | 0 |
| P15 | `apps/worker/src/modules/orders/index.ts` | M | export the reader and its statement builder | 2–4 | 0 |
| P16 | `apps/worker/src/report-commission-coverage.ts` | M | bind `sales: { readPage: listCurrentPackageSales }` | 2–3 | 1 |
| P17 | `apps/worker/src/modules/commissions/jobs/replay-commission-inputs.ts` | M | one continuable code, and the two comments that say "before 50-4"; 324 lines today, so no net growth beyond these lines | 2–3 | 2–3 |
| P18 | `apps/worker/src/modules/commissions/persistence/commission-correction-month-readers.ts` | M | the doc comment above `readMonthProjection` ("قبل 50-4") is rewritten to say the sale rows exist and the `SALE` correction is 55-1d's; `sales: []` itself is **not** changed | 2 | 2 |
| P19 | `apps/worker/src/modules/commissions/use-cases/report-commission-coverage/check-retained-events.ts`, `domain/commission-source-ref.ts` | M | comments only, where they say the sale type awaits 50-4 | 2–4 | 2–4 |
| P20 | `apps/worker/src/modules/commissions/index.ts` | M | only if the new port types must be visible to the worker root (the existing coverage types are exported there) | 0–4 | 0 |
| | **Production total** | | | **680–918** | **13–24** |

**Migration SQL** (hand-reviewed, produced by `pnpm db:generate` then completed by hand as `0209` was)

| # | Path | | Assumption | + | − |
|---|---|---|---|---|---|
| S1 | `packages/db/migrations/<n>_<date>_commission-sales.sql` | N | `CREATE TABLE` with checks, three foreign keys | 20–26 | 0 |
| S2 | `packages/db/migrations/<n+1>_<date>_commission-sales-rls.sql` | N | two concurrent indexes, RLS, three policies, revoke, grants | 18–24 | 0 |
| | **Migration SQL total** | | | **38–50** | **0** |

**Tests**

| # | Path | | Covers | + | − |
|---|---|---|---|---|---|
| T1 | `packages/db/src/__tests__/rls-commission-sales.spec.ts` | N | CM-R05 (the tips file is 117 lines for three tables) | 95–125 | 0 |
| T2 | `packages/db/src/__tests__/commission-sales-constraints.spec.ts` | N | every check, the unique key, the foreign keys, column-limited update, no delete | 110–150 | 0 |
| T3 | `packages/db/test/commission-sales-fixtures.ts`, `commission-sales-grants.ts` | N | fixtures and the grant list | 40–60 | 0 |
| T4 | `packages/db/test/table-grants.ts`, `tenant-table-inventory.ts`, `packages/db/src/__tests__/privileges.spec.ts` | M | the inventory and privilege allowlist entries | 8–14 | 0 |
| T5 | `apps/worker/src/modules/commissions/domain/__tests__/commission-sale-inputs.spec.ts` | N | the pure functions, exhaustively | 150–200 | 0 |
| T6 | `apps/worker/src/modules/commissions/__tests__/project-package-sale-db.spec.ts` and its fixture | N | CM-20 and the edge cases of [spec.md](./spec.md); the throw-after-write case | 420–520 | 0 |
| T7 | `apps/worker/src/modules/commissions/__tests__/project-package-sale.spec.ts` (fakes) | N | the use-case order: lock before read, lock periods before classify, refuse before write | 140–190 | 0 |
| T8 | a handler-level spec for `on-commission-input-event` | N | routing, schema failure, envelope mismatch. No spec file is named after the handler today; if the implementer finds these cases already routed through another spec, they go there instead | 40–70 | 0–5 |
| T9 | `apps/worker/src/modules/commissions/__tests__/replay-commission-inputs-six-type.spec.ts` | M | CM-20b: the type is delivered and marked; the file names `PackageSaleChanged` on nine lines today, all asserting "not handled" behaviour, and they are rewritten | 150–220 | 60–110 |
| T10 | `apps/worker/src/modules/commissions/__tests__/commission-sale-concurrency.spec.ts` | N | CM-22b sale leg (barrier), CM-21 sale leg (permutations) | 190–260 | 0 |
| T11 | `apps/worker/src/modules/commissions/__tests__/check-sale-coverage.spec.ts` | N | missing, stale, covered, paging, the cap | 110–150 | 0 |
| T12 | `apps/worker/src/__tests__/report-commission-coverage-db.spec.ts`, `modules/commissions/__tests__/report-commission-coverage-tips.spec.ts` | M | the `sales` member end to end; the tips spec names `PackageSaleChanged` on three lines today and they are rewritten | 110–160 | 20–45 |
| T13 | `apps/worker/src/modules/orders/__tests__/package-sale-coverage.reader.spec.ts` and `…-explain.spec.ts` | N | shape, `SOLD` only, keyset paging, isolation, limit bounds, the plan | 170–230 | 0 |
| T14 | `apps/worker/src/__tests__/commission-coverage-readers-db.spec.ts` | M | the reader through the root binding | 30–60 | 0 |
| T15 | existing specs and fixtures that build a `CommissionInputUseCases`, a `CommissionCoverageDeps` or a `CoverageProjectionReader` by hand, each needing the new required member: `commission-blocked-corrections-db.fixture.ts`, `commission-blocked-notice-db.spec.ts`, `commission-line-projection-convergence.spec.ts`, `commission-line-projection-identity.spec.ts`, `project-service-lines-corrections-db.fixture.ts`, `project-tip-salary-corrections-db.fixture.ts`, `report-commission-coverage.spec.ts` (all under `apps/worker/src/modules/commissions/__tests__/`) and `apps/worker/src/__tests__/report-commission-tips-db.spec.ts` | M | a `sales` use case, a `sales` reader or a `saleRevisions` fake, a few lines each; no assertion changes | 30–70 | 0–10 |
| | **Tests total** | | | **1,793–2,479** | **80–170** |

**Documentation changed by the implementation PR**

| # | Path | Change | + | − |
|---|---|---|---|---|
| D1 | `docs/runbook.md` | sections 50-3c item 5 and 50-3d items 3–4 stop saying "until 50-4"; the sentence in section 50-3a (line 271 at the base) that says a `PackageSaleChanged` event "has no consumer before 55-1d" is corrected, because it contradicts those two sections; a short "50-4" section gives the order: every replica on the new release, capture the bound, six-type replay, coverage report | 30–45 | 12–20 |
| D2 | `docs/module-map.md` | a Port row for `PackageSaleCoverageReader` (worker `commissions` ← worker `orders`) beside the `ServiceLineCoverageReader` row; the placeholder row "ports named by 50-3 and 50-4" and the event row `PackageSaleChanged` updated | 3–5 | 2–3 |
| D3 | `docs/adr/0054-commissions-engine-package-recovery-flags-and-read-path.md` | a dated §4 addendum: the sale coverage reader, and the replay as the sale bootstrap, citing CS-Q51's answer | 12–20 | 0–2 |
| D4 | `docs/specs/059-commissions-statements/spec.md` | **append-only** dated amendment notes at D-15, FR-020, CM-20b and the 50-4 row, after CS-Q51 is answered; no existing sentence is deleted | 8–14 | 0 |
| D5 | `docs/specs/059-commissions-statements/owner-questions.ar.md` | the CS-Q51 answer, verbatim, when it arrives | 4–8 | 0 |
| D6 | `docs/journey/89-refund-package-sessions.md` | the sentence that says the commission projection is not built | 2–3 | 2–3 |
| D7 | `docs/adr/0012-statement-approval-pending-outbox-count.md` | one sentence where it describes "the latest package-sale revision" reader, if CS-Q51 changes what that reader does | 0–3 | 0–1 |
| | **Implementation docs total** | | **59–98** | **16–29** |

**Documentation written by this planning session** (already on disk; committed with the PR or before it, as the
manager decides): the seven files of this folder, about 1,110 lines, plus 27 lines appended to
`owner-questions.ar.md` (§60). Exact line counts and hashes are in the session report.

**Generated**

| # | Path | Assumption | + | − |
|---|---|---|---|---|
| G1 | `packages/db/migrations/meta/<n>_snapshot.json`, `<n+1>_snapshot.json` | two snapshots; the latest at the base is 30,559 lines | ≈ 61,150–61,300 | 0 |
| G2 | `packages/db/migrations/meta/_journal.json` | two entries | 14 | 0 |
| | **Generated total** | | **≈ 61,160–61,320** | **0** |

No OpenAPI file and no `schema.d.ts` changes: the slice adds no contract and no route. If either appears in the diff,
something outside this plan was touched.

**Structure Decision**: the worker `commissions` module keeps its standard shape (`domain/`, `use-cases/<verb>-<noun>/`,
`ports/`, `persistence/`, `events/handlers/`, `commissions.module.ts`). The one file outside it is a read-only
`queries/` reader in the worker `orders` module, bound at the worker composition root
`apps/worker/src/report-commission-coverage.ts`.

## Size against the old estimate

| | Old (spec 059, 50-4 row) | This plan |
|---|---|---|
| Hand-written lines "including tests and copy" | **250–380** | production 680–918 + migration SQL 38–50 + tests 1,793–2,479 + implementation docs 59–98 = **2,570–3,545 added**, 109–223 deleted |
| Generated | not counted | ≈ 61,200 added |

That is about 7 to 9 times the top of the old band (380). It is not a split proposal: Waleed directed one PR. The reasons, all
measured in [research.md](./research.md) R8:

1. The band predates every measured sibling. 50-3b was banded 250–350 and delivered 791 production and 1,235 test
   lines; 50-3c was banded 300–420 and delivered 984 and 1,174.
2. The band assumed row 42 would ship the reader. It did not, so the reader, its port, its tests and its module-map
   row are here.
3. The coverage report did not exist when the band was written; its sale section and tests are here.
4. Tests are about 70 % of the hand-written total in this estimate. The four measured siblings came out at 53–60 %
   (R8), so the test range is the least certain figure here and is more likely to land low than high.

**For the implementer brief (PP-112: a delivery over twice the stated size is refused):** state the expected size by
category as the **upper** ends above, rounded up (production ≤ 920, migration SQL ≤ 50, tests ≤ 2,480,
implementation docs ≤ 98, generated ≈ 61,300). A delivery whose production code passes 920 lines means the scope drifted (the most likely drift
is a second bootstrap path or a `SALE` correction) and goes back to the manager before it is finished.

## Design

### The handler, in the order of spec 059 FR-015

1. `onCommissionInputEvent` parses the payload with `packageSaleChanged` and calls
   `normalizePackageSaleEvent` _(new)_, which checks the envelope and builds the input.
2. `ProjectPackageSale.execute` _(new)_:
   1. `scope.lockSale(saleId)` — the identity lock, before any read.
   2. `scope.readSale(saleId)`; if a row exists and `revision <= held.revision`, return (the consumer marks).
   3. the pure reducer validates the money and builds the next row; the pure identity check refuses a business change.
   4. `scope.businessTimeZone`; `currentBusinessPeriod(clock.now(), timeZone)`.
   5. the pure affected-month helper (held period and new period), then `commissionPeriodLockPlan`.
   6. `scope.lockPeriods` — **one** call, ascending, the affected months and every candidate through the current month.
   7. re-read the current period; a change throws `CommissionPeriodRolledOverError`.
   8. `classifyCommissionPeriods`; a closed month throws `CommissionPeriodClosedError` **before any write**.
   9. `scope.upsertSale`, then `scope.reopenReviewed`.

The class takes the scope, the `Clock` and the `IdGenerator`. It takes **no** correction scope and no notices: it posts
no correction. That absence is the 55-1d boundary in code.

### Idempotency, ordering, transaction, audit

- **Idempotency:** the consumer's `consumed_events` mark (written in the same transaction as the effect by the
  existing deliverer) and, independently, the revision guard under the identity lock. Either alone makes a redelivery
  harmless; together they also make a replay harmless.
- **Ordering:** the dispatcher delivers one aggregate's events in order (`claimQuery` in `packages/db/src/dispatcher.ts`
  takes only the oldest unpublished event per aggregate). The replay reads by id. The handler does not rely on either:
  any order converges (CM-21).
- **Transaction:** one `withTenant(event.company_id)` transaction per event; the handler opens none of its own; lock
  order is the identity lock, then the statement rows; no nested and no concurrent transaction.
- **Audit:** no `AuditLog` row (a derived input; the sale and the refund are audited by their writers). The owner
  audit of this slice is its `owner-questions.ar.md` entry (CS-Q51) and, once answered, the dated notes in spec 059.

### Migration and RLS

- Two files, expand-only, in the migration lane: table and foreign keys; then concurrent indexes, RLS, policies,
  revoke, grants ([data-model.md](./data-model.md), [research.md](./research.md) R7).
- Built and tested on a private cluster; the renumber, `pnpm db:generate` and the push wait for the manager's lane
  grant. If another migration PR is open, this one is stacked on it (PP-130).
- No data step (`-- pospay:data-step`), no backfill, no change to an existing table, no destructive statement.
- CM-R05 and the grant and inventory tests ship in the same PR.

### Boundaries kept

| Neighbour | What this slice leaves to it |
|---|---|
| **55-1d** (`SALE` corrections) | the correction step for a sale, wiring sales into `readMonthProjection`, the attribution of a closed-month sale change, releasing sale events parked by `COMMISSION_PERIOD_CLOSED` |
| **55-2e** (the blocked-corrections list, FR-049, waiting on CS-Q48) | everything: this slice writes no blocked-correction row, adds no route and no permission, and touches none of `commission_blocked_corrections`, its writers or its notice |
| **55-2c / 55-2d** | no block is recorded or resolved and no bell is sent by a sale event |
| **50-5** (estimate) | reading `commission_sales`, mapping `'SOLD'` to the engine status, calling `computePackageSaleCommission` |
| **53-2** (approve) | the approval-time coverage check (CM-34b) and the API-side binding of the reader |
| **Row 42 / spec 058** | the producer, the contract and the orders tables are not changed |

## Acceptance map

| Id (spec 059) | Claimed here | Proven by |
|---|---|---|
| CM-20 | yes | T5, T6 |
| CM-20b | yes, under the recommended option of CS-Q51 | T9, T11, T12, T13 |
| CM-21 (sale leg) | yes | T10 |
| CM-22b (sale leg) | yes | T10 |
| CM-R05 | yes | T1, T2 |
| CM-34b | **no** — row 53-2, which consumes this slice's port | — |
| CM-23, CM-23c… (sales in the estimate) | **no** — row 50-5 | — |

## Gates before merge

1. Local gates exit 0 ([quickstart.md](./quickstart.md) §1); the report says «implementation complete, pending
   `ci-gate`», never "done".
2. Guard pass by the implementer for this Heavy task per PP-198: `clean-code-guard`, `test-guard` and the defensive
   `waleed-security-reviewer`, `docs-guard` on the changed documents — done in the implementation session — then one
   end-of-PR review on the full diff as the pipeline assigns. The independent Sol 6.2 Medium security review already
   ran on this head; its eight findings are addressed by the consolidated correction commit this file ships with.
   PP-198's guard duties and every CI/review requirement stand unchanged.
3. `ci-gate` green on the exact head; every required review bot finished on that head; findings resolved.
4. The branch is up to date with `main` (the migration-chain check fails on a stale base and only an update fixes
   it); the journal sequence and the snapshot `prevId` chain are intact.
5. The manager merges in migration order after the gates pass (PP-201, which explicitly supersedes the PP-195 Heavy
   approval card — this migration PR is that exception, and no merge card is required). The 2026-11-17 owner decision
   makes backup and restore optional at merge unless the operation explicitly requires them. The staging snapshot
   gate below, the migration order, the CS-Q51 record and the independent rollout/HOLD gates all keep.
6. **CS-Q51 answered and recorded verbatim** — done: option 1 answered by Waleed on 2026-11-21 («دخل المبيعات القديمة
   بالمسار الموجود، واستعمل القارئ للتأكد إن كل بيع وصل بآخر نسخة»), recorded in `owner-questions.ar.md` §60, and the
   spec 059 amendment notes (D4) are written. The plan already built this option, so no plan change is needed.

## Gates after merge (separate from the merge; staging only; no production step is planned here)

These are run by the session that owns the deploy, through the project's Dokploy and SSH route, and are listed so the
manager can order them. Nothing here is executed by the implementer.

1. **Snapshot (PP-129):** a fresh staging snapshot immediately before `migrate`; its id, time and "migrate ran after"
   go in the receipt.
2. **Migrate:** the one-shot `migrate` step applies the two files before new containers start. It creates an empty
   table; it cannot block a running release.
3. **Rollout and freshness:** every worker replica must run the new release before the replay's upper bound is
   captured (runbook section 50-3a, the every-replica rule). A bound captured earlier does not cover events an old
   replica published without applying.
4. **Bootstrap, per tenant that has package sales:** the six-type replay with one fixed `--through` bound, resumed with
   the same bound until it ends `COMPLETE`.
5. **Coverage:** the report must return `COVERED`, with `sales.missing.total = 0`, `sales.stale.total = 0`, and no
   `PackageSaleChanged` under `unmarked` or `notHandled`. The report is a point-in-time read.
6. **Receipt:** `api` and `worker` `/health` and the worker's `/ready`, the image SHA, the snapshot id, the replay
   result line and the coverage status.
7. **Rollback:** one click back to the previous image. The table stays (expand-only; no older release reads it). Sale
   events an old worker publishes during the rollback carry no mark; after the re-upgrade the six-type replay is re-run
   with a **new** bound (CS-Q43, runbook section 50-3d). Restoring the snapshot is needed only if `migrate` itself
   failed part-way.

## Risks

| # | Risk | Handling |
|---|---|---|
| K1 | CS-Q51 is answered with another option (a state bootstrap, or event ids from orders) | The table, the handler, CM-20, CM-21, CM-22b and CM-R05 are unaffected. The coverage reader stays. A state bootstrap adds roughly the tips bootstrap's size (275 production lines plus tests); event ids from orders would need an orders migration and a producer change, which is a different slice and goes back to Waleed |
| K2 | A sale or refund lands in a closed month before 55-1d | Refused and parked by design; no tenant has a closed month until 53-2 merges. If 53-2 is scheduled before 55-1d, the manager orders 55-1d first |
| K3 | `report-commission-coverage.ts` passes 300 lines (warn) | The sale check is its own file (P12); row P13 names the one extraction that keeps the file under 300 if the warning is not acceptable |
| K4 | An existing spec still expects `COMMISSION_EVENT_TYPE_NOT_HANDLED` for the sale type | T9 and T12 rewrite those assertions; the code stays for any future unregistered type |
| K5 | An imported entitlement counted as a missing sale | The reader filters `provenance = 'SOLD'`; T13 asserts it with a refunded import |
| K6 | The reader's plan degrades on a tenant with many imports | Keyset on the primary key with a residual filter; T13's `EXPLAIN` asserts the index. No new index on an orders table is planned; if the assertion cannot be met, that is reported to the manager, not solved by adding one silently |
| K7 | Delivery size above twice the brief | The brief carries the upper ends above; the two named drifts are refused |

## Open question

**CS-Q51** (technical; the manager, and Waleed if the manager escalates): recorded in
[`../owner-questions.ar.md`](../owner-questions.ar.md) §60. **ANSWERED 2026-11-21 — option 1**, Waleed's verbatim
answer: «دخل المبيعات القديمة بالمسار الموجود، واستعمل القارئ للتأكد إن كل بيع وصل بآخر نسخة». The replay projects and
discharges; the reader proves coverage by revision with no event ids. No business rule is open, and the merge no longer
waits on it.

## Complexity Tracking

No constitution violation; nothing to justify.
