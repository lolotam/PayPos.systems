# Plan 55-1c — corrections for tips and salaries on closed months (spec 059, row 55-1)

> Plan author: Claude Fable 5.2, 2026-11-20 (PP-204: spec and plan only; the manager opens the implementer).
> Tier: **Heavy** (commission money path, PP-195). Base: `origin/main` at `99acf3093`.
> Plan branch: `docs/059-55-1c-plan` (local). Suggested implementation branch: `feat/p1-059-55-1c-tip-salary-corrections`.
> Sources: `spec.md` FR-015, FR-039…FR-046, D-1, D-5, D-13, CM-22, CM-46, CM-46b, CM-47, CM-48c, CM-49, the §7 rows 55-1 and
> 55-2; `plan-55-1b.md` (the manager decisions Q1, Q2, Q3 and the risks R2, R5, R8); `plan-50-2b-c2.md` (D1, D2);
> `owner-questions.ar.md` (CS-Q7, CS-Q8, CS-Q28, CS-Q29, and the new CS-Q45); `docs/owner-decisions.ar.md` items 112
> (PP-192), 115 (PP-195), 118 (PP-198), 124 (PP-204); `docs/runbook.md` (the 50-3 replay and tips bootstrap sections);
> the code under `apps/worker/src/modules/commissions` on the base commit.

## 0. Which slice this is, and why it is not 55-2

Row 55-1 was split in `plan-55-1b.md` §3. State on `main` at the base commit:

| Sub-slice | Content | State |
| --- | --- | --- |
| 55-1a | pure correction-target selector | merged, #816 |
| 55-1b-1 | the two tables, RLS, grants, CM-R06, pure correction arithmetic | merged, #1014 |
| 55-1b-2a1 | correction persistence scope and port | merged, #1020 |
| 55-1b-2a2 | month projection reader and pure month recompute | merged, #1024 |
| 55-1b-2b | the correction step wired into the **line** consumer | merged, #1061 (2026-11-17) |
| **55-1c** | **the correction step for tips and salaries (FR-041, FR-042)** | **not started — this plan** |
| 55-1d | the correction step for package sales (kind `SALE`) | blocked: 50-4 is not merged (`commission_sales` is not in the schema) |

55-2 cannot go before 55-1c. The spec's §7 makes 55-2 depend on 55-1, and two of 55-2's own acceptance tests need this
slice: CM-53 (a `NO_SALARY` block is resolved by a `SalaryChanged` recompute that posts into a closed month) and CM-52c.
On the base commit `ProjectSessionTips` and `ProjectSalary` still throw `CommissionPeriodClosedError` for any affected
APPROVED or PAID month. 55-1c is not deferred or blocked by any owner decision (checked: PP-101, PP-169.1, PP-192, PP-196).

## 1. What this slice delivers

A late `SessionTipsChanged` or `SalaryChanged` that touches an APPROVED or PAID month no longer parks. In the same
transaction the consumer applies the projection change, recomputes each affected closed month for each affected employee,
and inserts the correction rows into the earliest DRAFT month after the source (D-13). REVIEWED affected months return to
DRAFT as today.

- Tips (FR-041): rows of kind `TIP_CARD` or `TIP_CASH`, one per `(employee, tip:<session>:<method>)` whose amount changed.
- Salaries (FR-042): rows of kind `COMMISSION` for the lines whose commission moved because the selected salary of the month
  changed, for every closed month in the entry's range `[effective_from, next_from)`.

No new table, no migration, no HTTP route, no permission, no outbox event, no audit row (Q3 of `plan-55-1b.md`).

**Not in this slice:** package-sale corrections (55-1d); blocked corrections, the repair and the bell (55-2); the carry
writer (53-2); the display of corrections (53-3); the payable figure of the target month (51-1 builds it). The half of
CM-46 that says "raising a cash tip changes no payable figure, raising a card tip does" is proved here only as far as the
row's `kind`; the payable assertion belongs to the slice that computes payable from received corrections (51-1).

## 2. Reuse: what already exists and must not be rebuilt

| Piece | File | Use in 55-1c |
| --- | --- | --- |
| Target selector | `domain/commission-correction-target.ts` | unchanged |
| Correction arithmetic, kinds, drafts | `domain/commission-correction-step.ts` | unchanged; it already handles `TIP_CARD` and `TIP_CASH` |
| Source refs | `domain/commission-source-ref.ts` | unchanged (`tip:<session>:<method>`) |
| Attribution of a never-frozen source | `domain/commission-correction-attribution.ts` | unchanged |
| Month recompute (lines priced, tips passed through, salary selected by the engine) | `use-cases/commission-month-recompute.ts` | unchanged |
| Correction scope: frozen sources, posted corrections, attachment snapshot, month projection, generation bump, insert | `ports/commission-correction.port.ts`, `persistence/commission-correction*.ts` | unchanged; `readMonthProjection` already reads tips and salaries |
| Lock plan, classification, current month | `domain/commission-periods.ts` | unchanged |
| The per-employee correction step and the target choice | `use-cases/project-service-lines/post-line-corrections.ts` | **moved** to a shared file, see §3 |
| Rollover error | `domain/errors.ts` (`CommissionPeriodRolledOverError`) | unchanged, reused |

No SQL is added in this slice. If the implementer finds that a reader is missing a column, stop and report; do not add a
query without telling the manager, because that would bring the index and EXPLAIN rules into scope.

## 3. Files, in CLAUDE.md §1 order

1. **Contract (Zod):** none. `SessionTipsChanged` and `SalaryChanged` are unchanged.
2. **Migration and RLS:** none. See §5.
3. **Domain (pure, Arabic JSDoc, unit tests first):**
   - Edit `apps/worker/src/modules/commissions/domain/commission-tip-salary-periods.ts`: add
     `affectedCommissionTipEmployees(held, next, closedPeriods)`. It returns the `(period, employeeId)` pairs to correct:
     every employee of the **held** rows under the held period, and every employee of the **new** rows under the new
     business date's period, kept only when the period is in `closedPeriods`, de-duplicated, sorted by period then
     employee id. It returns `CommissionPeriodEmployee[]` (the type already in `domain/commission-line-types.ts`). An
     employee who lost her tip must be in the result, because her frozen tip now recomputes to 0.
   - Salaries need no new domain function: the pairs are the closed months of the range for the one employee of the event.
4. **Use cases:**
   - **Move** `use-cases/project-service-lines/post-line-corrections.ts` → `use-cases/post-commission-corrections.ts`
     (next to `commission-month-recompute.ts`, the existing precedent for a helper shared by use cases). Use `git mv`.
     Rename `selectCommissionLineCorrectionTargets` → `selectCommissionCorrectionTargets`,
     `postCommissionLineCorrections` → `postCommissionCorrections`, `CommissionLineCorrectionTarget` →
     `CommissionCorrectionTarget`. The function bodies do not change. `readCommissionLineCorrectionEmployees` is
     line-specific: it stays in a small `use-cases/project-service-lines/post-line-corrections.ts`.
     This is the one touch outside the two use cases of the slice; it is needed because a use case folder must not import
     another use case folder's internals. Add the one-line Arabic comment above each exported function (§3.1, `use-cases/**`).
   - Edit `use-cases/project-service-lines/project-service-lines.ts`: imports and the three renamed identifiers only.
   - Edit `use-cases/project-session-tips/project-session-tips.ts`: `ProjectSessionTipsInput` gains
     `eventId: string | null`; the constructor gains the `CommissionCorrectionScope`; `execute` follows §4.1;
     `normalizeSessionTipsEvent` sets `eventId: event.id`. Update the class comment (it says "without writing a closed month").
   - Edit `use-cases/project-salary/project-salary.ts`: `ProjectSalaryInput` gains `eventId: string`; the constructor
     gains the `CommissionCorrectionScope`; `execute` follows §4.2; `normalizeSalaryEvent` sets `eventId: event.id`.
     Update the class comment. Keep `execute` under 60 lines (split a private method if needed, by responsibility).
   - Edit `use-cases/bootstrap-session-tips/bootstrap-session-tips.ts`: `toTipInput` sets `eventId: null`. Nothing else.
5. **Adapters:** none in `persistence/`, none in `http/`.
   - Edit `commissions.module.ts`: pass `createCommissionCorrectionScope(tx, ids, clock)` to `ProjectSessionTips` and
     `ProjectSalary` in `createCommissionInputsConsumer`, and to `ProjectSessionTips` in `createCommissionTipsBootstrap`
     (it is never used there because the bootstrap's `eventId` is null, §4.3).
   - The test consumer factory `apps/worker/src/__tests__/commission-inputs-consumer.ts` wraps
     `createCommissionInputsConsumer`, so it needs no edit. Specs that construct the two use cases by hand pass the scope.
6. **Integration tests:** §7.
7. **UI:** none.
8. **Docs in the implementation PR:** `docs/runbook.md` — the two sentences that say a closed-month visit "takes the 55-1
   correction path" (the six-type replay step and the tips bootstrap `UNDELIVERED` status): a replayed
   `SessionTipsChanged` or `SalaryChanged` event now posts a correction; a tips **bootstrap** visit to a closed month is
   still refused with `COMMISSION_PERIOD_CLOSED` (CS-Q45). Keep the R5 prerequisite wording. No `docs/module-map.md`
   change (no new arrow, no new event). No ADR (no new dependency, table, role or port).

## 4. Transaction, lock and idempotency design

One `withTenant(event.company_id)` transaction opened by the outbox consumer, role `pospay_app`. The correction step
never opens a second transaction and never calls `lockStatementPeriods` a second time (CM-02, CLAUDE.md §6 connection
budget). Lock order is always: identity advisory locks, then statement rows in **one** ascending call.

### 4.1 `ProjectSessionTips.execute`

| # | Step | Note |
| --- | --- | --- |
| 1 | `lockSession` → `readTipSession` → drop a stale revision → `reduceCommissionTips` → `assertTipIdentityUnchanged` | existing, unchanged |
| 2 | business time zone → `plannedPeriod` | existing |
| 3 | `tipAffectedPeriods(held period, new business date)` → `commissionPeriodLockPlan` | existing |
| 4 | **one** `lockPeriods` call (affected months and every candidate through the current month, ascending) | existing |
| 5 | re-read the current month from the Clock; if it differs from `plannedPeriod` throw `CommissionPeriodRolledOverError` | new (Q1) |
| 6 | `classifyCommissionPeriods` → `closed`, `reviewed` | existing |
| 7 | if `closed` is not empty and `eventId` is null → throw `CommissionPeriodClosedError(closed)` | new: the bootstrap, §4.3 |
| 8 | `selectCommissionCorrectionTargets(locked, closed, currentPeriod)` — throws `CommissionPeriodClosedError` when a closed month has no DRAFT target | new; **before any write and before step 12** |
| 9 | `affectedCommissionTipEmployees(held, session, closed)` | new, pure |
| 10 | `replaceTipSession(session)` | existing; the projection write comes before the correction step (FR-015) |
| 11 | `postCommissionCorrections({ scope, businessId, eventId, targets, employees })` | new |
| 12 | `reopenReviewed` | existing; last, so a REVIEWED month is never chosen as a target and is reopened only after the targets are fixed |

### 4.2 `ProjectSalary.execute`

| # | Step | Note |
| --- | --- | --- |
| 1 | `lockEmployee` → `lockSalaryIdentity` → resolve the business → `readSalary` → drop a stale revision → reduce → `assertSalaryIdentityUnchanged` | existing, unchanged |
| 2 | business calendar → `plannedPeriod`, `startPeriod` → `readNextEffectiveFrom` → `salaryAffectedPeriods` → lock plan | existing |
| 3 | **one** `lockPeriods` call over the whole range and every candidate through the current month | existing (R8 of `plan-55-1b.md`) |
| 4 | re-read the current month; on a change throw `CommissionPeriodRolledOverError` | new (Q1). The range itself depends on the current month, so the retry recomputes it |
| 5 | classify → `closed`, `reviewed` | existing |
| 6 | `selectCommissionCorrectionTargets(locked, closed, currentPeriod)` | new; before any write |
| 7 | `upsertSalary` | existing |
| 8 | `postCommissionCorrections` with one pair per closed month for the event's employee | new |
| 9 | `reopenReviewed` | existing; last |

The interim line `if (closed.length > 0) throw new CommissionPeriodClosedError(closed)` is removed from both use cases.

### 4.3 The refusals that stay

- **No DRAFT target** for a closed month (every month after it through the current month is REVIEWED, APPROVED or PAID):
  `CommissionPeriodClosedError`, nothing written, the event is retried and then parked. Same as the line path.
- **The recompute returns `NO_PLAN` or `NO_SALARY`** for an affected closed month: `CommissionPeriodClosedError`, nothing
  written. This is manager decision Q2 of `plan-55-1b.md` applied through the shared step: recording a blocked correction
  and consuming the event is FR-046, which is 55-2. For a salary event one such month refuses the whole event, so the
  salary row is not written either; today every closed month in the range refuses, so this slice only narrows the refusal.
- **The tips bootstrap** (`eventId` null): a visit that touches a closed month keeps today's `COMMISSION_PERIOD_CLOSED`
  refusal and stays `UNDELIVERED`. A correction row needs a real `event_id` (NOT NULL, the trace to its cause) and a
  bootstrap visit is a current-state read with zero or several event ids. Whether the bootstrap should ever post a
  correction is **CS-Q45, PENDING** (`owner-questions.ar.md` §53). It does not block this slice: the default is today's
  behaviour. `TODO(spec)` is marked in FR-015.
- **Plan versions and overrides** keep refusing a closed month in the API (FR-007, FR-012, FR-043). Not touched.

### 4.4 Idempotency and crash atomicity

- **Event dedupe (CM-49):** the consumer's consumed mark for `(consumer, event_id)` is taken in the same transaction; a
  replayed event is skipped before the generation bump. There is no `Idempotency-Key` because there is no HTTP request.
- **Revision dedupe:** a tip or salary event whose revision is not newer than the held one returns before any lock on
  statement rows, as today, and therefore posts nothing.
- **Arithmetic dedupe:** each real change bumps the generation and posts only `new − (frozen + corrections already posted)`
  per source; a zero delta posts no row. Database backstop: `UNIQUE (company_id, source_period, employee_id, source_ref,
  generation)` and `CHECK (amount = new_amount − previous_amount)` from migration `0226`.
- **Atomicity (CM-22):** the projection write, the generation bumps, the correction inserts, the reopen and the consumed
  mark are one transaction. A failure at the insert rolls the tip or salary row back too, so the redelivery sees the old
  projection and produces the same correction.
- **Outbox in the same transaction:** this slice appends **no** outbox event. A correction is an input of the target
  month; `CommissionCorrectionBlockedNoticeRequested` belongs to 55-2. Nothing is sent to a provider.
- **Replay and bootstrap runs:** `COMMISSION_PERIOD_ROLLED_OVER` is not in either continuable-code list, so a rollover in
  the middle of an operator run aborts the run and the operator re-runs the same command (both runs are idempotent). That
  is already true for line events since #1061; do not add the code to the continuable lists.

## 5. Migration, RLS, indexes, EXPLAIN

- **Migration: no.** No table, column, index, grant, role or policy changes. The migration lane is not needed.
- **RLS negative tests:** no new tenant table, so no new policy and no new CM-R test; CM-R06 (#1014) covers
  `commission_period_generations` and `commission_corrections`. This slice adds one cross-tenant **read** assertion to
  each new DB spec file (§7.3 X1) so the new writers are proved tenant-bound.
- **EXPLAIN:** no `queries/` file is added or changed and no SQL statement is added, so there is no EXPLAIN assertion.
- **Performance:** the work runs inside a worker job. A salary event can run one correction step per closed month of its
  range; each step is five indexed reads and two writes. No performance test is added; if one is, it asserts a ratio to
  the old code in the same run, never a fixed millisecond limit (PP-165).

## 6. Size budget

Hand-written production lines (tests, moved lines and docs excluded):

| File | Estimate |
| --- | --- |
| `domain/commission-tip-salary-periods.ts` (new function with JSDoc) | 30 |
| `use-cases/post-commission-corrections.ts` (rename edits and the §3.1 comment lines; about 140 lines are **moved**, not counted) | 15 |
| `use-cases/project-service-lines/project-service-lines.ts` and the reduced `post-line-corrections.ts` | 10 |
| `use-cases/project-session-tips/project-session-tips.ts` | 40 |
| `use-cases/project-salary/project-salary.ts` | 40 |
| `use-cases/bootstrap-session-tips/bootstrap-session-tips.ts` | 1 |
| `commissions.module.ts` | 12 |
| **Total** | **about 150** |

**Budget: 170 production lines, one PR.** Stop and return to the manager above **220**; a delivery above 300 is refused
(twice the expected size, pipeline §14). No split is needed: the slice is far below 750, and tips and salaries share the
moved step, so splitting them would move the shared file twice. Expected tests: about 700–900 lines.

Row band: the spec's 450–600 for row 55-1 is already exceeded by the merged sub-slices (PP-192 rule 3 keeps money slices
on their spec bounds). The split and its overrun were accepted by the manager on 2026-11-13 (`plan-55-1b.md` §3, R7); this
plan adds about 150 lines against that plan's 180 for 55-1c.

## 7. Tests (exact list)

Every test name starts with its id. Money is asserted as exact three-decimal strings. No mocks of the database in DB specs.

### 7.1 Domain unit tests (no database)

`domain/__tests__/commission-tip-salary-periods.spec.ts` — `affectedCommissionTipEmployees`:

- D1 no held session, new rows in a closed month → one pair per employee of the new rows.
- D2 an employee present only in the held rows (her tip was removed) is in the result under the held period.
- D3 the session moved from closed month A to closed month B → held employees under A and new employees under B.
- D4 only one of the two months is closed → pairs of the open month are dropped.
- D5 one employee with a CARD and a CASH row → one pair, not two.
- D6 no closed month → empty result.
- D7 the result is sorted by period then employee id whatever the input order.

`domain/__tests__/commission-correction-step-*.spec.ts` — add only if no existing case asserts it (name the existing
case in the PR body otherwise):

- D8 a frozen `TIP_CARD` 5.000 recomputed as 8.000 → one draft: previous 5.000, new 8.000, amount +3.000, kind `TIP_CARD`.
- D9 a frozen `TIP_CASH` source absent from the recompute → amount −(frozen), kind `TIP_CASH`.

`use-cases/__tests__/commission-month-recompute.spec.ts` — add only if missing:

- D10 the same lines with a higher selected salary move the salary-based threshold and change the per-line amounts.

### 7.2 Use-case tests with fake scopes (no database)

New `__tests__/project-tip-salary-corrections.spec.ts`, in the shape of `project-service-lines-corrections.spec.ts`:

- U1 tips: exactly one `lockPeriods` call; call order is targets chosen → `replaceTipSession` → correction inserts →
  `reopenReviewed`.
- U2 tips: the month rolls over during the lock wait → `CommissionPeriodRolledOverError`, no write of any kind.
- U3 tips: `eventId` null and a closed affected month → `CommissionPeriodClosedError`, no write (the bootstrap rule).
- U4 tips: `eventId` null and only open months → the projection is written as today.
- U5 tips: the recompute returns `NO_PLAN` → `CommissionPeriodClosedError`.
- U6 salary: one `lockPeriods` call covering the whole range and the candidates; one correction step per closed month, all
  for the event's employee; `upsertSalary` before the inserts; `reopenReviewed` last.
- U7 salary: rollover → typed error, no write.
- U8 salary: a closed month with no DRAFT target → `CommissionPeriodClosedError` before `upsertSalary`.

### 7.3 Integration tests on the private lane (real Postgres, one cloned database per spec file, ADR-0006)

Closed months are seeded through the storage layer with `walkCommissionStatement`, `insertCommissionLine` and
`insertCommissionAttachment` (FR-044), never through an approval use case. Reuse
`project-service-lines-corrections-db.fixture.ts`; extend it rather than copying it.

New `__tests__/project-tip-corrections-db.spec.ts`:

- T1 (CM-46, card) October APPROVED with a frozen `TIP_CARD` 5.000; the event sets 8.000 → one row: `kind = TIP_CARD`,
  `source_ref = tip:<session>:CARD`, previous 5.000, new 8.000, amount 3.000, generation 1, `event_id` of the event,
  target November (the earliest DRAFT), branch, date and `attached_branch_ids` **copied** from the frozen row; October's
  frozen rows are unchanged.
- T2 (CM-46, cash) the same for a cash tip → `kind = TIP_CASH`.
- T3 the tip moves from employee A to employee B in a closed month → −amount for A; +amount for B whose attribution is
  resolved from the projection and the frozen attachment snapshot; with no frozen interval covering the date B's
  `attached_branch_ids` is empty.
- T4 the session's business date moves from closed October to open November → a negative correction for the October
  source, the November projection holds the tip, no correction row has `source_period = 2026-11`.
- T5 (CM-47) the source month is PAID → the same row as T1.
- T6 (CM-49) the same event delivered twice → one generation, one set of rows; a second real change → generation 2 with
  only the new delta.
- T7 (CM-22) a failure injected at the correction insert → no change to the tip head or rows, no generation row, no
  consumed mark.
- T8 (Q1) a rollover → the typed error, nothing written, the redelivery succeeds and posts.
- T9 (CM-48 shape) October REVIEWED and affected, September APPROVED and affected by a moved session: the September
  correction targets November, never October, and October returns to DRAFT.
- T10 no DRAFT target → refusal, nothing written, no mark.
- T11 (Q2) the closed month has an ACTIVE `FOLLOW_PLAN` line and no plan version → refusal, nothing written.
- X1 after T1, a read of `commission_corrections` and `commission_period_generations` as company B returns 0 rows.

New `__tests__/project-salary-corrections-db.spec.ts`:

- S1 (**CM-46b**, exact) سارة has entries on 1 January (500.000) and 10 April (600.000); January and February are
  APPROVED, March is REVIEWED, April is DRAFT and current; her lines use a salary-based plan. A back-dated entry on
  15 January (550.000): one `lockPeriods` call holds January…April ascending; corrections for January and February are
  posted into **April**; March returns to DRAFT and gets no correction row; no row has `source_period = 2026-04`.
  The amounts and source refs are asserted exactly.
- S2 (CM-46b, second half) a later revision of the 15 January entry → generation 2 for January and February, each row
  equal to `new − (frozen + posted)`.
- S3 (CM-46) only the lines whose threshold moved get a row; a line whose commission did not change gets none.
- S4 a closed month in the range in which the employee has no line → the event is consumed and no correction row exists
  for that month.
- S5 (CM-47) a PAID month in the range behaves like an APPROVED one.
- S6 (CM-49) replay → no second generation.
- S7 (CM-22) a failure at the insert → the salary row is not written, no generation, no mark.
- S8 (Q1) rollover → typed error, nothing written, redelivery succeeds.
- S9 (Q2) one closed month of the range recomputes to `NO_PLAN` → the whole event is refused; the salary row, the
  generations of the other months and the mark are all absent.
- S10 (FR-018b) a legacy event with no `business_id` resolves the business and then posts the same correction as S3.
- X1 as in the tips file.

Edit `__tests__/commission-tip-salary-concurrency.spec.ts`:

- C1 (**CM-48c** shape, salary) September is REVIEWED, October and November are DRAFT; a seed transaction holds
  September's lock and approves it (barrier before its commit) while a salary event whose range includes September waits;
  after the wait the consumer sees September APPROVED and posts into October with no second lock call.

Edit the existing tests that assert the old interim refusal:

- `commission-tip-projection.spec.ts` «closed guard: affected month APPROVED refuses delivery…» and
  `commission-salary-projection.spec.ts` «closed guard: affected month APPROVED refuses delivery…»: each becomes a
  delivery that succeeds (no frozen source and no priced line, so the projection is written and no correction row is
  posted). State the rewrite in the PR body, as #1061 did for the line tests.
- `bootstrap-session-tips*.spec.ts`: the `COMMISSION_PERIOD_CLOSED` expectations **stay**. Add B1 to
  `bootstrap-session-tips-db.spec.ts`: after the refused closed-month visit there is no correction row and no generation row.

### 7.4 Gates

Local (PP-113): worker typecheck, `eslint` on the worker commissions module, `pnpm lint:docs`, `pnpm module-map:check`,
the worker commissions suite on a private database lane (no shared cluster), and `pnpm format:check` on changed files.
The full `pnpm check` and the API shards are decided by `ci-gate` on the exact head. Guard skills at the implementer
(PP-198, Heavy): `clean-code-guard`, `test-guard`, `waleed-security-reviewer`. One `/code-review` by the manager.

## 8. Acceptance criteria

1. A `SessionTipsChanged` for an APPROVED or PAID month is consumed and posts `TIP_CARD` / `TIP_CASH` rows with exact
   previous, new and delta amounts into the earliest DRAFT month after the source (T1, T2, T5).
2. A `SalaryChanged` posts corrections for every closed month of its range, and CM-46b passes exactly as written in the
   spec, with every target chosen before March is reopened (S1, S2, U6).
3. A frozen attribution is copied; a never-frozen one is resolved once from the projection and the frozen attachment
   snapshot (T1, T3).
4. One ascending `lockStatementPeriods` call per event; no status is read before its lock; a REVIEWED month is never a
   target (U1, U6, T9, C1).
5. Replay, rollover and crash leave no partial write (T6…T8, S6…S8).
6. The three refusals of §4.3 hold (T10, T11, S9, U3, B1) and the line path's tests still pass unchanged apart from imports.
7. No migration, no new SQL statement, no new import arrow, no new dependency; `pnpm module-map:check` is unchanged.
8. Every new or changed `domain/` export has Arabic JSDoc; the changed class comments describe the new behaviour.
9. Production diff within the §6 budget; `ci-gate` green on the exact head.
10. The merge needs Waleed's approval card (Heavy, money, PP-195) and deploys to staging alone. The PP-129 snapshot
    rule does not apply, because there is no migration.

## 9. Risks

- **R1 — the projection must be complete (R5 of `plan-55-1b.md`).** A recompute on an incomplete projection posts a wrong
  correction. The operator gate (replay complete, coverage report with no gap, before a tenant's first approval) is
  unchanged and stays in the runbook. No approval route exists yet (53-2), so no real closed month exists in any tenant.
- **R2 — a salary event is refused whole by one bad month (§4.3).** Until 55-2, a `NO_PLAN`/`NO_SALARY` month in the range
  parks the event and the salary row is missing from open months' estimates too. 55-2 removes this.
- **R3 — one recompute corrects everything for the employee and month.** A tip event's recompute also covers her lines.
  Deltas for unchanged sources are zero, so nothing extra is posted; T1 and S3 assert the exact row set.
- **R4 — generation bumps without rows.** The shared step bumps the generation before the recompute (FR-039's order), so a
  closed month with no delta gets a generation and no row (S4). This matches the line path; do not change it here.
- **R5 — the moved file.** The move must be a pure rename; the reviewer diffs the old and new bodies.

## 10. Open questions

| Id | Kind | Question | State | Blocks 55-1c? |
| --- | --- | --- | --- | --- |
| CS-Q45 | technical (Waleed only) | Should the tips bootstrap ever post a correction for a visit in a closed month, and with which event id? | **PENDING** (`owner-questions.ar.md` §53) | No. The slice keeps today's refusal |

No business rule was guessed. For the manager's attention, not owner questions:

- Q2's refusal is applied to tips and salaries by precedent (§4.3). If the manager reads FR-046 differently, say so before dispatch.
- No test named CM-48c, and no database-level test named CM-43, was found for the **line** path on the base commit
  (CM-43 is asserted in the pure spec `commission-correction-step-union.spec.ts`). Row 55-1's test list names both. This
  plan adds the CM-48c shape for salaries (C1) only. Recommended: a tests-only follow-up for the line path.
