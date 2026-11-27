# Plan 55-2 — blocked corrections and the period repair (spec 059, row 55-2)

> Plan author: Claude Fable 5.2, 2026-11-20 (PP-204: plan only; the manager opens the implementer).
> Tier: **Heavy** (commission money path, PP-195). Base: `origin/main` at `e6e038f70`.
> Plan branch: `docs/059-55-2-plan`. No PR is opened by the planner.
> Sources: `spec.md` FR-039…FR-049, D-1, D-5, D-12, D-13, D-16, CM-22, CM-49, CM-51…CM-54, CM-52b, CM-52c, CM-53b,
> CM-R07, the §6 schema row of `commission_blocked_corrections`, the §7 rows 51-1, 52-1, 53-2 and 55-2;
> `owner-questions.ar.md` (CS-Q1, CS-Q11, CS-Q19, CS-Q27, CS-Q38, CS-Q45, and the new CS-Q46, CS-Q47 and CS-Q48);
> `plan-55-1b.md` (Q2, R4, R5, R7) and `plan-55-1c.md` (§4, D10, R2, R4); `docs/module-map.md`; ADR-0054; the code under
> `apps/worker/src/modules/commissions`, `apps/api/src/modules/commissions` and `packages/commissions-engine` on the base
> commit.

## 0. What this row delivers, and what it does not

A late change to a closed month whose recompute returns `NO_PLAN` or `NO_SALARY` is no longer refused and parked. The
event is consumed, one **blocked correction** is recorded for that employee and month, a bell rings for the holders of
the plan permission, and the block is resolved later by a dated salary (`NO_SALARY`) or by a **period repair**
(`NO_PLAN`), which posts the correction normally.

Six sub-PRs. Batch 96 settled CS-Q47 and CS-Q48. The preparatory code move still precedes 55-2f.

| Sub-PR | Content | Production lines | Migration | Blocked by |
| --- | --- | --- | --- | --- |
| **55-2a** | Engine `repair_period` rule (D-12) and the worker reader that feeds it | 50 | no | nothing |
| **55-2b** | Table `commission_blocked_corrections`, RLS, grants, trigger, CM-R07 | 100 | **yes** | nothing |
| **55-2c** | The consumer records, updates and resolves blocks (FR-046; CM-51, CM-53, CM-53b stored target) | 170 | no | 55-2a, 55-2b |
| **55-2d** | The bell (FR-049 notice: contract, template, registrations, module-map event row; CM-54) | 210 | no | 55-2c |
| **55-2e** | The list `GET …/commission-blocked-corrections` (FR-049, `queries/`) | 140 estimated, 493 measured (see Section 8) | no | 55-2b; guard confirmed by **CS-Q48** |
| **55-2f** | The repair use case and HTTP (FR-047; CM-52, CM-52b, CM-52c) | 220, plus a move-only PR | no | 55-2c and the shared-correction move (CS-Q46); tier behavior confirmed by CS-Q47 |

**Original estimate: about 890 production lines, against the row's 400–550.** The overrun is stated, not hidden (as R7 of
`plan-55-1b.md` did for row 55-1). Reasons: the bell touches five packages for one template (55-2d), the list is a full
read endpoint with its contract and EXPLAIN test (55-2e), and the spec's row counted the repair as one use case without
the code-sharing problem of §8. The manager accepted an over-budget total on 2026-11-20 (thread message, stage 1).
Substituting the measured 493 lines for the 55-2e estimate gives about 1,243 lines with the other original
estimates unchanged, before the shared-code move. This comparison is not a measurement of the whole row.

**Not in this row** (no host exists on the base commit; each clause is named so nothing is lost):

| Clause | Why not here | Row that delivers it |
| --- | --- | --- |
| FR-048 refusal: «October cannot be approved while it is unresolved» (CM-51), «November's review and approval are refused» (CM-53b) | no review or approve use case exists in `apps/api` | 52-1 (review), 53-2 (approve) |
| FR-049 «visible on the view of its stored target statement», «always listed on the statement view as a blocking issue» (CM-54), «in its fingerprint» (CM-53b) | no statement view or builder exists | 51-1 (CS-Q38 = PP-101.2 already makes 51-1 wait on 55-2) |
| The admin screen for the list and the repair form | the row has no UI | 53-3 or a later UI row; the manager decides |

55-2 gives those rows what they need: the table, the partial index of FR-048 with an EXPLAIN-proved predicate (55-2b), and
the list (55-2e).

## 1. Manager decisions (technical, taken in this plan)

| Id | Decision | Why |
| --- | --- | --- |
| Q1 | **«No DRAFT target» stays a refusal; it does not become a blocked row.** `selectCommissionCorrectionTargets` keeps throwing `CommissionPeriodClosedError` (`post-commission-corrections.ts` line 39) | FR-046 and the table allow only `NO_PLAN` and `NO_SALARY`, and a block needs a held `target_statement_id`. Under D-13 the current month is always DRAFT (a month that has not ended cannot be reviewed), so the case is an unreachable invariant kept as a defence. Accepted by the manager, 2026-11-20 |
| Q2 | The engine type `CommissionPlanVersion` gains a **required** field `repairPeriod: string \| null`. A repair row is stored with `effective_from` = the first day of its `repair_period` and `whole_period = false` | Required, so the compiler lists every construction site and no reader can forget the column (a forgotten column would make a repair version apply to every later month). The first day keeps `assembleCommissionPeriodInput`'s filter `effectiveFrom <= periodLastDay` true for its own month |
| Q3 | The generation is still bumped **before** the recompute (FR-039's order). A blocked step leaves a generation with no rows (as R4 of `plan-55-1c.md`). `resolved_generation` stores the generation of the step that succeeded and posted | No reorder of merged money code; the stored value points at the exact rows the resolution posted |
| Q4 | Block reads and writes are four new methods on the existing `CommissionCorrectionScope` | Same transaction, same `tx`, one scope per event; no new constructor argument in the three projectors |
| Q5 | **CS-Q48** grants the 55-2e list to holders of `manage:commission-plans:business` | Batch 96 confirms that the list follows the same permission as the bell and repair |
| Q6 | 55-2 ships **no** unused FR-048 reader function. It ships the partial index and a database test that runs the exact FR-048 predicate with `EXPLAIN` | A function with no caller is dead code until 52-1; the first caller writes it against a proved index. This replaces the «reader» named in the planner's stage-1 note |
| Q7 | Bell: template key `commission_correction_blocked`, one safe parameter `period` (the source month, `YYYY-MM`); the business travels as the event's `business_id` scope. No amount, no employee name, no customer data (FR-049). When the business has **no** holder of the permission, no event is appended and the block is still recorded. The ar/en sentence in §6.1 is the planner's draft; the manager may reword it before dispatch | The contract requires at least one recipient; the block must not depend on who holds a permission |
| Q8 | 55-2c may merge before 55-2d | No approval route exists (53-2 is not merged), so no tenant has a closed month and no block can be recorded before the bell ships. Both merge before 53-2 by the §7 dependency |

Provisional, decided together with CS-Q46 (55-2f only): the correction rows a repair posts carry the block's
`first_event_id` as their `event_id` (the column is NOT NULL and a repair is an HTTP request, not an outbox event); the
route answers 201 with `{ version, blocked_correction: { id, code, resolved } }`.

## 2. How the remaining `COMMISSION_PERIOD_CLOSED` refusals change

On the base commit the three projectors no longer hold a closed-month refusal of their own. Both remaining refusals
live in the shared step `use-cases/post-commission-corrections/post-commission-corrections.ts`:

| Refusal | Exact place today | After 55-2 |
| --- | --- | --- |
| No DRAFT target for a closed month | `selectCommissionCorrectionTargets`, line 38–40; called before any write at `project-service-lines.ts:81`, `project-session-tips.ts:75` and `project-salary.ts:83` | **unchanged** (Q1) |
| The closed month's recompute returns `NO_PLAN`/`NO_SALARY` | `postEmployeeCorrections`, line 91: `if (!result.ok) throw new CommissionPeriodClosedError([target.sourcePeriod]);` | **replaced** by the block step of §5.2 (55-2c). Nothing is thrown; the loop continues with the next employee and month |
| The tips bootstrap (`eventId === null`) touching a closed month | `project-session-tips.ts`, the guard under the CS-Q45 comment | **unchanged** (CS-Q45 is still PENDING) |

So the projectors change **no production line** in 55-2c. `ProjectServiceLines`, `ProjectSessionTips` and
`ProjectSalary` keep calling `postCommissionCorrections` with the same arguments; 55-2d adds one optional argument
(§6). Consequences per projector, all proved by tests in §5.4:

- **Lines:** a late line in a closed month for an employee with no plan on that date writes the projection, records the
  block, posts nothing for her, and still posts for the other performers of the same event.
- **Tips:** the recompute of a tip event also prices her lines, so a tip in a blocked month writes the tip projection and
  posts no `TIP_*` row. When the block is resolved, the one successful step posts every pending delta of that month,
  tips included, because the arithmetic is `new − (frozen + corrections already posted)`.
- **Salaries:** each closed month of the range is independent. A month that is still blocked keeps or records its block;
  the other months post; the salary row is always written. This removes R2 of `plan-55-1c.md`.

`replay-commission-inputs.ts` keeps `COMMISSION_PERIOD_CLOSED` in `CONTINUABLE_FAILURE_CODES` (the no-target and
bootstrap refusals still exist). 55-2c updates `docs/runbook.md`: a replayed event that meets a `NO_PLAN`/`NO_SALARY`
closed month is now consumed and recorded as a blocked correction.

## 3. 55-2a — the engine `repair_period` rule (D-12, CS-Q11)

**Budget: 50 production lines. Stop above 75; refused above 100.** No migration, no HTTP, no event.

### 3.1 Files

1. `packages/commissions-engine/src/plan-types.ts` — `CommissionPlanVersion` gains `readonly repairPeriod: string | null;`
   with an Arabic doc line (the month a repair version applies to; null for an ordinary version).
2. `packages/commissions-engine/src/plan-version.ts` — `selectCommissionPlanVersion` gains the rule, **inside the
   function, never an `if` in a caller** (D-12):
   - Pass 1, ordinary versions only (`repairPeriod === null`): today's rule, unchanged (`effectiveFrom <= businessDate`,
     or `wholePeriod` in the month of `effectiveFrom`; latest `createdAt`, then highest `version`).
   - If pass 1 selects a version, return it. This is CS-Q11's «السطور اللي اتحسبت قبل كده بخطتها ماتتغيّرش».
   - Pass 2, only when pass 1 found none: repair versions whose `repairPeriod === businessDate.slice(0, 7)`; same
     tie-break; else `null` (`NO_PLAN`).
   - A repair version is never a candidate in pass 1, whatever its `effectiveFrom`, so it is ignored in every other
     month.
   - Update the function's Arabic JSDoc in the same commit: add the repair sentence and keep `@param`/`@returns`.
3. `apps/worker/src/modules/commissions/persistence/commission-correction-month-readers.ts` — `readPlanVersions` (the
   `SELECT` that starts at line 157) adds `repair_period AS "repairPeriod"`. No other SQL change: the `WHERE` already
   admits a repair row of the month (Q2), and this is an existing statement, so no new index and no new EXPLAIN test.
4. `apps/worker/src/modules/commissions/persistence/commission-correction-codec.ts` — `PlanVersionRow` (line 20) gains
   `repairPeriod: string | null`; `commissionPlanVersionOf` (line 167) maps it.
5. Every other construction site the typecheck reports. Expected: test fixtures only
   (`packages/commissions-engine/src/__tests__/engine-ii-fixtures.ts`, `period-input-assembly.spec.ts`,
   `engine-ii-versions-salary.spec.ts`, the worker's `commission-month-recompute.spec.ts`, `commission-correction-codec.spec.ts`,
   `project-service-lines-corrections.spec.ts`, `project-tip-salary-corrections.fakes.ts`), each with `repairPeriod: null`.
   **If a production file outside the engine and the two worker files above fails to compile, stop and report.** Checked
   by grep on the base commit: `apps/admin/src/commissions` imports only `@pospay/commissions-engine/validation`
   (`CommissionPlanWire`, the validator and its result types) and takes `CommissionPlanVersion` from `@pospay/contracts`;
   `apps/api` imports only `validateWireCommissionPlan` from the engine. Neither constructs the engine type, so neither
   changes here.

`assembleCommissionPeriodInput` does not change.

### 3.2 Tests (pure, written first)

`packages/commissions-engine/src/__tests__/engine-ii-repair-period.spec.ts`:

- E1 no ordinary version applies on the date and a repair version exists for that month → the repair version.
- E2 an ordinary version applies on the date → the ordinary version, even when the repair version is newer.
- E3 a date in the month **after** the repair month with no ordinary version → `null`; the repair version is ignored.
- E4 a date in the month **before** the repair month → `null`.
- E5 a repair version whose `effectiveFrom` is earlier than an ordinary date never wins pass 1 (ordinary dated the 15th,
  repair dated the 1st, a line on the 20th → ordinary).
- E6 two repair versions of the same month → the later `createdAt`; on a tie the higher `version`.
- E7 a `wholePeriod` ordinary version of the month covers the whole month, so the repair version is never selected.
- E8 a repair version of another employee is ignored.

`apps/worker/src/modules/commissions/use-cases/__tests__/commission-month-recompute.spec.ts`:

- O1 the flat oracle of §7.1 (the two lines, 10.000 and 30.000). This is the oracle of CM-52.

`apps/worker/src/modules/commissions/persistence/__tests__/commission-correction-codec.spec.ts`:

- P1 a row with `repair_period = '2026-09'` decodes to `repairPeriod: '2026-09'`; a null stays null.

Acceptance: every existing engine and worker commissions test passes with only `repairPeriod: null` added to fixtures.

## 4. 55-2b — the table `commission_blocked_corrections` (CM-R07)

**Budget: 100 hand-written production lines (Drizzle schema, the hand-written SQL of RLS, grants and the trigger;
generated SQL and snapshots are not counted). Stop above 150; refused above 200.**
**Migration: yes** — the migration lane's final step (renumber, `pnpm db:generate`, push) waits for «lane granted»;
build and test on a private cluster first. The PP-129 snapshot rule applies to its staging deploy.

### 4.1 Schema (spec §6 _Schema_)

`packages/db/schema/commissions-corrections.ts` (append; split into a new file `commissions-blocked-corrections.ts` only
if the file would pass 300 lines), table `commission_blocked_corrections`:

| Column | Type | Rule |
| --- | --- | --- |
| `company_id` | `uuid NOT NULL` | FK → `companies` |
| `id` | `uuid NOT NULL` | UUID v7 from the caller's `IdGenerator`; **PK `(company_id, id)`** |
| `business_id` | `uuid NOT NULL` | tenant-qualified FK through the employee and statement FKs |
| `employee_id` | `uuid NOT NULL` | FK `(company_id, business_id, employee_id)` → `employees` |
| `source_period` | `char(7) NOT NULL` | the closed month; the period format CHECK used by `commission_period_generations` |
| `code` | `text NOT NULL` | `CHECK (code IN ('NO_PLAN','NO_SALARY'))` |
| `first_event_id` | `uuid NOT NULL` | the event that first recorded the block; no FK, like `commission_corrections.event_id` |
| `target_period` | `char(7) NOT NULL` | the **held** month; format CHECK; `CHECK (target_period > source_period)` |
| `target_statement_id` | `uuid NOT NULL` | FK `(company_id, business_id, target_period, target_statement_id)` → `commission_statements`, the same four-column FK as `commission_corrections_target_statement_fk` |
| `created_at` | `timestamptz NOT NULL` | from the injected Clock, no default used by the writer |
| `resolved_at` | `timestamptz NULL` | |
| `resolved_generation` | `integer NULL` | `CHECK ((resolved_at IS NULL) = (resolved_generation IS NULL))`, `CHECK (resolved_generation > 0)` |

Indexes (every RLS predicate, FK and list filter):

- partial `UNIQUE (company_id, employee_id, source_period) WHERE resolved_at IS NULL` — one open row per employee and month.
- partial `(company_id, target_statement_id) WHERE resolved_at IS NULL` — FR-048.
- `(company_id, business_id, created_at, id)` — the list of 55-2e.
- `(company_id, business_id, employee_id)` — the employee FK.
- `(company_id, business_id, target_period, target_statement_id)` — the statement FK.

The table is new and empty, so plain `CREATE INDEX` inside the migration is correct; no `CONCURRENTLY`.

### 4.2 RLS, grants, trigger (second migration file, as 0226/0227 did)

- `ENABLE` and `FORCE ROW LEVEL SECURITY`; the tenant policy on `company_id = app_company_id()` for `pospay_app`, copied
  from `0227_2026-11-13_commission-corrections-rls.sql`.
- Grants to `pospay_app`: `SELECT`, `INSERT`, `UPDATE (code, resolved_at, resolved_generation)`. No `DELETE`. No grant to
  any other runtime role, nothing for `PUBLIC`. The held target is therefore not updatable by privilege.
- A `BEFORE UPDATE` trigger: refuses any update when `OLD.resolved_at IS NOT NULL`; on an open row refuses a change to any
  column other than `code`, `resolved_at`, `resolved_generation`; refuses `resolved_at` going back to null. `code` may move
  `NO_PLAN` ↔ `NO_SALARY` only while the row is open (CM-52b). The function runs with the invoker's rights
  (no `SECURITY DEFINER`).
- Also in this migration (and in `packages/db/schema/commissions-plan-versions.ts`, so the Drizzle snapshot does not
  drift): `commission_plan_versions` gains
  `CHECK (repair_period IS NULL OR effective_from = to_date(repair_period || '-01', 'YYYY-MM-DD'))` (Q2), added
  `NOT VALID` and validated in a second statement, following the 0224/0225 precedent. The table holds no repair row today
  (the only writer stores null), so validation is instant. If the database reviewer prefers one statement, follow the
  reviewer and say so in the PR body.

Update `packages/db/test/tenant-table-inventory.ts`, `packages/db/test/table-grants.ts` (and
`commission-correction-grants.ts` if it holds the correction tables' grant list), and the fixtures file
`packages/db/test/commission-correction-fixtures.ts` with an `insertCommissionBlockedCorrection` helper for later sub-PRs.

### 4.3 Tests (`packages/db/src/__tests__/`)

`rls-commission-blocked-corrections.spec.ts` — **CM-R07**:

- R1 company B reads 0 rows of company A.
- R2 company B's insert naming company A's employee or statement fails.
- R3 company B's update of company A's row changes 0 rows.
- R4 a transaction with no tenant set reads 0 rows and cannot insert.

`commission-blocked-correction-constraints.spec.ts`:

- C1 a second open row for the same employee and month fails; a new open row after the first is resolved succeeds.
- C2 `code` outside the two values fails.
- C3 `target_period <= source_period` fails; a `target_statement_id` of another period or business fails (FK).
- C4 on an open row `code` `NO_PLAN → NO_SALARY → NO_PLAN` succeeds.
- C5 on a resolved row every update fails (`code`, `resolved_at`, `resolved_generation`).
- C6 `UPDATE target_period` or `target_statement_id` is refused as `pospay_app` (privilege), and by the trigger as owner.
- C7 `resolved_at` without `resolved_generation` (and the reverse) fails.
- C8 `DELETE` is refused as `pospay_app`.
- C9 (FR-048 predicate) `EXPLAIN` of
  `SELECT 1 FROM commission_blocked_corrections WHERE company_id = app_company_id() AND target_statement_id = $1 AND resolved_at IS NULL LIMIT 1`
  uses the partial target index, with the planner settings the repo's other EXPLAIN specs use.
- C10 a plan version with `repair_period = '2026-09'` and `effective_from = '2026-09-15'` fails; `'2026-09-01'` succeeds;
  `whole_period = true` with a repair period still fails (existing CHECK).

## 5. 55-2c — the consumer records, updates and resolves blocks (FR-046)

**Budget: 170 production lines. Stop above 230; refused above 340.** No migration, no HTTP, no outbox event (the bell is
55-2d). Worker only.

### 5.1 Files, in CLAUDE.md §1 order

1. **Contract:** none.
2. **Migration:** none (55-2b).
3. **Domain** — new `apps/worker/src/modules/commissions/domain/commission-blocked-correction.ts`, pure, Arabic JSDoc
   with `@param` and `@returns`:

   ```ts
   export type CommissionBlockCode = 'NO_PLAN' | 'NO_SALARY';
   export interface CommissionOpenBlock { readonly id: string; readonly code: CommissionBlockCode; }
   export type CommissionBlockDecision =
     | { readonly kind: 'NONE' }                                         // recompute ok, no open block
     | { readonly kind: 'RESOLVE'; readonly blockId: string }            // recompute ok, an open block exists
     | { readonly kind: 'RECORD'; readonly code: CommissionBlockCode }   // recompute failed, no open block
     | { readonly kind: 'UPDATE_CODE'; readonly blockId: string; readonly code: CommissionBlockCode }
     | { readonly kind: 'KEEP'; readonly blockId: string };              // recompute failed with the stored code
   export function decideCommissionBlock(
     open: CommissionOpenBlock | null,
     recompute: { readonly ok: true } | { readonly ok: false; readonly code: CommissionBlockCode },
   ): CommissionBlockDecision;
   ```

   JSDoc contract (Arabic in the file): it decides what happens to the one open block of an employee and month after a
   recompute; the business rule is FR-046/FR-047 — a failed recompute never posts, the open row is reused and its code
   follows the engine either way, and a successful recompute resolves it.

4. **Ports** — `ports/commission-correction.port.ts`, four methods on `CommissionCorrectionScope`, each with its
   one-line Arabic doc:
   - `readOpenBlock({ businessId, employeeId, sourcePeriod }): Promise<CommissionOpenBlock | null>`
   - `insertBlock({ businessId, employeeId, sourcePeriod, code, firstEventId, targetPeriod, targetStatementId }): Promise<string>` (returns the new id)
   - `updateBlockCode({ businessId, blockId, code }): Promise<void>`
   - `resolveBlock({ businessId, blockId, generation }): Promise<void>`
5. **Use case** — `use-cases/post-commission-corrections/post-commission-corrections.ts`, function
   `postEmployeeCorrections` (lines 74–122). Replace line 91 by the steps of §5.2. Keep every function under 60 lines:
   extract `applyBlockedOutcome(input, target, employeeId, decision)` in the same file. Update the Arabic comment above
   `postCommissionCorrections`: a month that cannot be priced records a block instead of failing the event. Remove the
   `CommissionPeriodClosedError` import only if `selectCommissionCorrectionTargets` no longer needs it (it does; it stays).
6. **Persistence** — new `persistence/commission-blocked-correction-writers.ts` with the four statements
   (`sql` tag, `company_id = app_company_id()`, ids from the injected `IdGenerator`, `created_at`/`resolved_at` from the
   injected Clock); wire them in `persistence/commission-correction.scope.ts`. `readOpenBlock` uses the partial unique
   index; `updateBlockCode` and `resolveBlock` filter on `id` and `resolved_at IS NULL` and throw if they change 0 rows
   (a broken invariant, plain `Error`, never an expected path).
7. **Module wiring:** none (`createCommissionCorrectionScope` already receives `tx`, `ids`, `clock`).
8. **Docs:** `docs/runbook.md` (the sentence of §2); `spec.md` FR-015's note «What 55-1c adds» gets one sentence «What
   55-2c adds». No `docs/module-map.md` change, no ADR.

**Every call site, checked by grep on the base commit:** `postCommissionCorrections(` is called at
`project-service-lines.ts:84`, `project-session-tips.ts:78` and `project-salary.ts:85` and nowhere else;
`createCommissionCorrectionScope(` at `commissions.module.ts` lines 89 and 142. Fakes of `CommissionCorrectionScope`
live in `__tests__/project-tip-salary-corrections.fakes.ts` and in `project-service-lines-corrections.spec.ts`; both gain
the four methods. Re-run the grep before editing.

### 5.2 The block step inside `postEmployeeCorrections`

| # | Step | Note |
| --- | --- | --- |
| 1 | `bumpGeneration` | unchanged, first (Q3) |
| 2 | `readMonthProjection` → `recomputeCommissionMonth` | unchanged |
| 3 | `readOpenBlock(employee, sourcePeriod)` | new; one indexed read |
| 4 | `decideCommissionBlock(open, result)` | new, pure |
| 5a | `RECORD` → `insertBlock` with `code`, `firstEventId = input.eventId`, and `targetPeriod`/`targetStatementId` **from this event's `target`** (the D-13 choice made from this event's lock snapshot: the held month, chosen once). Return; no correction row | FR-046 |
| 5b | `UPDATE_CODE` → `updateBlockCode`. Return. The stored target and `first_event_id` never change | FR-047, CM-52b, CM-52c |
| 5c | `KEEP` → return, nothing written | «later events reuse it» |
| 6 | `NONE` or `RESOLVE` → `readFrozenSources`, `readPostedCorrections`, attributions, `computeCommissionCorrections`, `insertCorrections`, exactly as today, into **this event's** target | the posting target is chosen at posting time, never the stored one (FR-046, CM-53b) |
| 7 | `RESOLVE` → `resolveBlock(blockId, generation)` after the insert | releases the held month |

### 5.3 Concurrency, locking, idempotency, replay

- **One transaction, one lock call.** Everything runs in the consumer's `withTenant(event.company_id)` transaction on
  `pospay_app`. The step opens no transaction and calls no lock; the projector's single ascending `lockPeriods` call
  (source months and every candidate through the current month) is the only statement lock of the event (CM-02).
- **No race on the open row.** Every writer of a block for `(employee, source month)` holds that source month's statement
  lock: the three projectors by their lock plan, the repair by FR-047's lock call. Two events for the same month are
  serial, so `readOpenBlock` then `insertBlock` cannot interleave. The partial unique index is the backstop; its
  violation is not an expected path and is not mapped.
- **Lock order** stays identity locks (line, session, salary, employee) and then statement rows. The block row itself is
  never locked separately.
- **Held target:** `RECORD` reads the target from the snapshot of the event's own lock call, before the event reopens any
  REVIEWED month (the existing order: targets chosen first, `reopenReviewed` last). A REVIEWED October is therefore
  skipped and November is stored (CM-53b).
- **Event dedupe (CM-49):** a redelivered event is skipped by the consumed mark before any step runs, so it records no
  block, changes no code and bumps no generation.
- **Revision dedupe:** unchanged; a stale revision returns before the statement locks.
- **Atomicity (CM-22):** projection write, generation bump, block insert or update or resolution, correction inserts,
  reopen and the consumed mark commit together or not at all.
- **Operator replay and tips bootstrap:** a replayed event that meets a blocked month is consumed and counted as
  delivered. The bootstrap never reaches the step for a closed month (`eventId === null` is refused earlier).
- **Guard connection budget:** not applicable, there is no HTTP guard in this sub-PR.

### 5.4 Tests

Every test name starts with its id. Money is asserted as exact three-decimal strings.

**Domain** — `domain/__tests__/commission-blocked-correction.spec.ts`:

- B1 ok, no open block → `NONE`. B2 ok, open block → `RESOLVE` with its id.
- B3 `NO_PLAN`, no open block → `RECORD NO_PLAN`. B4 `NO_SALARY`, no open block → `RECORD NO_SALARY`.
- B5 open `NO_PLAN`, recompute `NO_SALARY` → `UPDATE_CODE`. B6 the reverse.
- B7 open `NO_PLAN`, recompute `NO_PLAN` → `KEEP`.

**Use case with fake scopes** — `__tests__/post-commission-corrections-blocks.spec.ts`:

- U1 `NO_PLAN` → `insertBlock` receives the event id and the event's target; `insertCorrections` is not called; nothing throws.
- U2 an open block and a changed code → `updateBlockCode` only. U3 the same code → no write.
- U4 ok with an open block → `insertCorrections` then `resolveBlock` with the generation `bumpGeneration` returned.
- U5 two employees in one event: the first is blocked, the second still posts.
- U6 salary, two closed months: one blocked, one posts; `upsertSalary` was called; exactly one `lockPeriods` call.
- U7 a closed month with no DRAFT target still throws `CommissionPeriodClosedError` before any write (Q1).

**Oracle, pure, written first** — `use-cases/__tests__/commission-month-recompute.spec.ts`: O3 of §7.3, and O4a of §7.4
(the engine's error order, which K4 depends on).

**Integration on a private lane** (real Postgres, one cloned database per spec file, ADR-0006; closed months seeded
through the storage layer as FR-044 says) — new `__tests__/commission-blocked-corrections-db.spec.ts`:

- K1 (**CM-51**) September is APPROVED; هبة has a plan only from 15 September; a late line dated 10 September arrives.
  The event has its consumed mark; the projection holds the line; one row `(هبة, 2026-09, NO_PLAN)` with
  `first_event_id` = the event, `target_period = 2026-10` and October's statement id; no `commission_corrections` row;
  `commission_period_generations` holds generation 1. A second, unrelated event delivered after it is consumed too (the
  outbox does not stall).
- K2 a second late line for her in September → still one row, the same id, the same `first_event_id` and target.
- K3 (**CM-53**) the `NO_SALARY` case of §7.3: the block is recorded by the late line; `SalaryChanged` effective
  1 September then posts `line:<L1>` previous 0.000, new 20.000, amount **20.000** into October, and the row has
  `resolved_at` and `resolved_generation` = the generation of that step.
- K4 (**CM-52c**, first half) an open `NO_SALARY` block; a late line dated 10 September (before her plan) → the same
  row's `code` is `NO_PLAN`; then her salary is set → `code` stays `NO_PLAN`, nothing is posted, the salary row exists.
- K5 (**CM-53b**, stored target) October is REVIEWED when the September recompute fails → the row stores
  `target_period = 2026-11` and November's statement id. October is then set back to DRAFT through the storage layer (no
  return route exists yet). The resolving salary event posts into **October**; the row's stored target is still
  `2026-11`. Variant K5b: October is seeded APPROVED before the resolution → the correction goes to **November**. In K5b the salary
  event's range also covers October, so a step runs for October too; she has no October source, so it posts no row.
- K6 tips: a `SessionTipsChanged` in the blocked month writes the tip rows, posts no `TIP_*` row and keeps the block; the
  resolving event then posts the tip row and the line row together.
- K7 a salary event over August and September, where September is `NO_PLAN`: August posts its correction, September
  keeps its block, the salary row is written.
- K8 (CM-49) K1's event delivered twice → one block, one generation.
- K9 (CM-22) a failure injected at `insertBlock` → no projection row, no generation, no block, no mark.
- K10 a resolved block, then a new `NO_PLAN` change in the same month → a second, open row; the first row is unchanged.
- X1 company B reads 0 rows of the block table after K1.

**Existing tests that assert the old refusal** (rewrite, and list each in the PR body as #1061 did): T11 in
`project-tip-corrections-db.spec.ts`, S9 in `project-salary-corrections-db.spec.ts`, U5 in
`project-tip-salary-corrections.spec.ts`, and the `NO_PLAN` refusal case of the line path
(`project-service-lines-corrections.spec.ts` line 288, «keeps the closed-period refusal when recomputation returns…»). Each now expects a consumed event and one block row. Grep
`COMMISSION_PERIOD_CLOSED` under `apps/worker/src/modules/commissions` and `apps/worker/src/__tests__` to find any other.

## 6. 55-2d — the bell (FR-049, CS-Q19, CM-54)

**Budget: 210 production lines across packages. Stop above 280; refused above 420.** No migration.
**This sub-PR touches modules outside `commissions`** (CLAUDE.md §1.4), because one in-app template is registered in
every layer that knows templates. The list below is the registration surface of `discount_self_approved`, found by grep.

### 6.1 Files

1. **Contracts**
   - `packages/contracts/src/in-app-notifications.ts`: `commissionCorrectionBlockedParameters` (a one-element tuple, the
     safe text `period`), `commissionCorrectionBlockedRecipient` (`template_key: 'commission_correction_blocked'`), and
     the new key in both unions (`inAppRecipient`, `inAppNotification`).
   - new `packages/contracts/src/commissions/correction-blocked-notice.ts`: `commissionCorrectionBlockedNoticeRequested`,
     a strict object `{ schema_version: 1, block_id, group_index (int ≥ 0), business_id, source_period,
     notification_recipients: 1…100 recipients }`, with `.meta({ id: 'CommissionCorrectionBlockedNoticeRequested' })`;
     export it from the package index. Model: `orders/late-service-session-notice.ts`.
   - `pnpm contracts:openapi`, then regenerate the three `schema.d.ts` files (admin, pos, menu). Generated, not counted.
2. **Template and copy**
   - new `packages/notifications/src/templates/commission-correction-blocked.ts` and its registry entry.
   - `packages/i18n/src/in-app-catalog.ts`: the ar and en strings.
   - `apps/admin/src/notifications/model/render-notification.ts`: the new key.
   - Copy (no amount, no name): ar «فيه تصحيح عمولة موقوف عن شهر {{period}}: موظفة ناقصها خطة عمولة أو مرتب. افتح
     التصحيحات الموقوفة عشان يتصلّح.» / en "A commission correction for {{period}} is on hold: an employee has no
     commission plan or no salary for that month. Open the blocked corrections to fix it."
3. **Worker `notifications`:** `NOTIFICATION_SOURCE_EVENTS` in
   `events/handlers/on-notification-request.handler.ts` gains `'CommissionCorrectionBlockedNoticeRequested'`.
4. **Worker `commissions`**
   - new `events/published.ts`: the event type re-exported from contracts with its Arabic doc line (emitted when an open
     blocked correction is first recorded, one event per group of at most 100 recipients, in the block's transaction).
   - new `domain/commission-block-notice.ts`: `groupCommissionBlockNoticeRecipients(userIds, size)` — de-duplicates,
     sorts ascending, cuts into consecutive groups; Arabic JSDoc.
   - `ports/commission-correction.port.ts` (or a new `ports/commission-block-notice.port.ts` if the file would pass 300
     lines): `CommissionBlockNotices { recipients(companyId, businessId, at): Promise<readonly string[]>; append(input): Promise<void> }`.
     `businessPermissionHolders(tx, companyId, businessId, permission, at)` needs the company id, and `bind(tx)` does not
     have it, so `PostCommissionCorrectionsInput` gains `companyId` and the three projectors pass `input.companyId`.
   - new `persistence/commission-block-notice.outbox.ts`: `appendOutboxEvent(tx, ids.newId(), { aggregateType:
     'commission_blocked_correction', aggregateId: blockId, eventType: 'CommissionCorrectionBlockedNoticeRequested',
     payload: schema.parse(…) })`.
   - `use-cases/post-commission-corrections/post-commission-corrections.ts`: after `insertBlock` (step 5a only), read the
     recipients, group them, append one event per group with its `group_index`. Each recipient is built exactly as
     `request-discount-self-approval-notice.ts` builds one: `{ channel: 'IN_APP', user_id, locale: 'ar', template_key:
     'commission_correction_blocked', template_revision: 1, safe_parameters: [{ name: 'period', type: 'text', value }] }`
     (the `inAppBase` fields of `in-app-notifications.ts`). `PostCommissionCorrectionsInput` gains
     `notices: CommissionBlockNotices`; the three projectors pass it through (one constructor argument each).
   - `commissions.module.ts`: `CommissionInputsConsumerDependencies` gains `permissionHolders` (a reader function);
     `bind` builds the notices adapter from `tx`, `ids`, `clock` and that reader.
   - **Composition roots, all three call sites of `createCommissionInputsConsumer`:** `apps/worker/src/main.ts:184`,
     `apps/worker/src/replay-commission-inputs.ts:42` and `apps/worker/src/__tests__/commission-inputs-consumer.ts:16`
     bind `businessPermissionHolders` from the worker `identity` index with the code `manage:commission-plans:business`.
     The tips bootstrap factory passes the same reader (never used there).
5. **`docs/module-map.md`:** the event row `CommissionCorrectionBlockedNoticeRequested | commissions | notifications`,
   and the existing Port row «notification-recipients reader (port named by the sub-PR that adds it)» names the port and
   `businessPermissionHolders` (root-bound, no import arrow, D-16). Run `pnpm module-map:check`.

### 6.2 Rules

- Rings **only** on `RECORD`. `UPDATE_CODE`, `KEEP` and `RESOLVE` ring nothing (CM-54).
- All group events are appended in the block's transaction; a failure appending any group rolls back the block and every
  group (FR-049).
- Recipients are read on the consumer transaction with no lock (ADR-0037 §2), at the Clock's instant.
- Zero holders → no event, the block stays (Q7).
- The notifications consumer `notifications.authorize-v1` stores one in-app row per recipient; nothing is sent to a
  provider, so no network call happens inside a transaction.

### 6.3 Tests

- N1 (pure) grouping: 250 ids with duplicates and random order → 100, 100, 50, ascending, no duplicate; 0 ids → no group;
  100 ids → one group; 101 → 100 and 1.
- N2 (contract) the event schema accepts 100 recipients and refuses 0 and 101; an unknown field is refused.
- N3 (**CM-54**, DB) 250 holders → three outbox events with 100, 100 and 50 distinct recipients, `group_index` 0, 1, 2,
  appended with the block.
- N4 (**CM-54**, DB) a failure injected at the third append → no block row, no outbox event, no consumed mark.
- N5 (DB) a later event for the same open block appends nothing; a code change appends nothing; a resolution appends nothing.
- N6 (DB) no holder → the block exists and no event exists.
- N7 (DB, notifications consumer) the event is stored as in-app rows with the template key and the period; the payload
  holds no amount and no employee id or name.
- N8 (UI test, `apps/admin`) the notification renders the Arabic sentence with the month — a visible text assertion.
- N9 a user whose permission is denied by an override, or scoped to another business, is not a recipient.

## 7. The money oracle

These figures were derived by hand from `plan-version.ts`, `period-commission.ts`, `marginal-tiers.ts`,
`line-commission.ts`, `amount-accumulator.ts` and `salary-thresholds.ts`. **The implementer first proves each one with
the named pure test, before any DB test. If the engine returns a different figure, stop and report to the manager. Never
copy an expected value from a test's output.** All lines are ACTIVE, `FOLLOW_PLAN`, counted, one performer (هبة), in
September 2026, which is APPROVED; October is DRAFT and is the target.

### 7.1 O1 — flat repair (CM-52), proved in 55-2a

Ordinary version V1, effective 2026-09-15: base on, 10 %; tiers off. Repair version R, `repair_period = 2026-09`: base on,
5 %; tiers off.

| Line | Date | Net | Version selected | Commission |
| --- | --- | --- | --- | --- |
| L1 (the late line) | 10 September | 200.000 | none → after the repair, R | 200.000 × 5 % = **10.000** |
| L2 (frozen at approval as 30.000) | 20 September | 300.000 | V1 | 300.000 × 10 % = **30.000** |

Before the repair the recompute returns `NO_PLAN` (L1 has no version). After it: one correction row, `line:<L1>`
previous 0.000, new 10.000, amount **+10.000**; **no row for L2** (30.000 − 30.000 = 0).

### 7.2 O2 — tiered repair (CM-52), proved in 55-2f under CS-Q47

V1, effective 2026-09-15: base off; tiers on, `MARGINAL`, accumulator `AMOUNT`, one step from `AMOUNT` 400.000 paying
10 %. R as in O1 (5 % base, tiers off).

| Line | Date | Net | Frozen at approval (without L1) | Recomputed after the repair |
| --- | --- | --- | --- | --- |
| L1 (late) | 10 September | 200.000 | — | R: 200.000 × 5 % = **10.000**; the accumulator moves 0 → 200.000 |
| L2 | 20 September | 300.000 | 0 → 300.000, below 400.000: **0.000** | 200.000 → 500.000: (500.000 − 400.000) × 10 % = **10.000** |
| L3 | 25 September | 300.000 | 300.000 → 600.000: (600.000 − 400.000) × 10 % = **20.000** | 500.000 → 800.000: 300.000 × 10 % = **30.000** |

With today's engine the corrections are `line:<L1>` **+10.000**, `line:<L2>` **+10.000**, `line:<L3>` **+10.000**,
total **+30.000**. L2 and L3 keep their own plan, but their amounts change, because every counted line advances the
month's accumulator whichever version prices it. CS-Q11's answer says the lines already priced with their plan
«ماتتغيّرش». **CS-Q47** confirms that the plan assignments stay fixed and amounts can change when the late line moves their tier position.

### 7.3 O3 — a missing salary (CM-53), proved in 55-2c

Version V2, effective before September: base off; tiers on, `MARGINAL`, `AMOUNT`, one step from `SALARY_MULTIPLE` 1.00
paying 10 % (the plan of `plan-55-1c.md` §7.3). هبة has no salary entry. September is APPROVED with no frozen row for her.

| Step | Recompute | Result |
| --- | --- | --- |
| A late line L1, 20 September, net 700.000 | `NO_SALARY` | block `(هبة, 2026-09, NO_SALARY)`, nothing posted |
| `SalaryChanged`, effective 1 September, 500.000 | L1: (700.000 − 500.000) × 10 % = **20.000** | `line:<L1>` previous 0.000, new 20.000, amount **+20.000** into October; block resolved |

### 7.4 O4 — code change then repair (CM-52c), proved in 55-2f

V2 as in O3 but effective **15 September**. Open block `NO_SALARY` from La (20 September, net 700.000). A late line Lb
(10 September, net 200.000) arrives: the engine prices lines in order and stops at Lb with `NO_PLAN`, so the row's code
becomes `NO_PLAN`. The salary 500.000 from 1 September is then set: still `NO_PLAN`. Repair R (5 % base) then gives:

| Line | Recomputed |
| --- | --- |
| Lb | R: 200.000 × 5 % = **10.000**; accumulator 0 → 200.000 |
| La | V2, threshold 500.000: 200.000 → 900.000: (900.000 − 500.000) × 10 % = **40.000** |

**O4a (55-2c, no repair involved):** with V2 from 15 September, no salary and only La → `NO_SALARY`; with La and Lb and
no salary → `NO_PLAN`; with La, Lb and the salary 500.000 → `NO_PLAN`. This is the code order K4 asserts.

Corrections after the repair: `line:<Lb>` +10.000 and `line:<La>` +40.000 (neither was frozen). CS-Q47 applies the same tier rule as O2: the late line advances the accumulator.

## 8. 55-2e — the list (FR-049)

**Approved production ceiling: 520 changed lines (additions plus deletions), one PR.**
The original estimate was 140, with a stop at 190 and refusal above 280. The owner approved this slice-specific
ceiling after the measured delivery reached 486 production lines. The reviewed candidate measures 493. See `owner-questions.ar.md`, 55-2e-DELIVERY-1.
No migration (the index is 55-2b's). API only.

1. **Contract:** new `packages/contracts/src/commissions/blocked-corrections.ts` — `commissionBlockedCorrection`
   `{ id, employee_id, source_period, code, target_period, created_at, resolved_at }`, the list query
   `{ status: 'open' | 'resolved' | 'all' (default 'open'), cursor?, limit? }` and the list envelope with the repo's
   cursor shape; OpenAPI entry; regenerate `openapi.json` and the three `schema.d.ts`. No amount and no name is returned;
   the screen that shows names is a later UI row.
2. **Query:** new `apps/api/src/modules/commissions/queries/commission-blocked-corrections.query.ts`, one line above the
   SQL naming the consuming screen (the blocked-corrections list of the commission plan screens). Raw SQL, read-only,
   ordered `created_at DESC, id DESC`, keyset cursor, projected straight into the DTO shape, served by
   `(company_id, business_id, created_at, id)`. It imports neither `domain/` nor `use-cases/`. Status is filtered
   during the ordered scan. The synthetic EXPLAIN test exercises the index path and shows that the open page
   can read past newer resolved rows. Status-aware indexes require a separate migration decision.
3. **HTTP:** new `http/commission-blocked-corrections.controller.ts`,
   `GET /v1/businesses/:businessId/commission-blocked-corrections`, guarded by `@Require('manage:commission-plans:business', { business: 'businessId' })` (CS-Q48),
   `@RequiresFeature('commissions')`, Zod pipes, one `withTenant(companyId, tx => …,
   { userId, readOnly: true })` transaction for the unlocked access recheck (`readCommissionPlanListAccess`, as the two existing lists
   do) and the query — one transaction, no nested one (guard connection budget, PP-7.2). The transaction is one
   `REPEATABLE READ, READ ONLY` snapshot, so the access recheck and the page read the same moment and a concurrent
   revocation cannot split them.
4. **Module:** register the controller in `commissions.module.ts`. `docs/module-map.md`: no change (no new arrow).
5. **Tests:** L1 result shape; L2 `EXPLAIN ANALYZE` uses the list index; L3 keyset pagination over 3 pages with equal
   `created_at` values; L4 `status` filter; L5 a missing or foreign business and an insufficient permission yield
   `403 FORBIDDEN`, and a disabled commissions feature yields `403 FEATURE_DISABLED` (the uniform refusal the sibling
   lists use); L6 cross-tenant and cross-business rows are never returned; L7 no route without a guard (the CI declaration test passes).

## 9. 55-2f — the repair use case and HTTP (FR-047)

**Preparation can proceed.** CS-Q46 approved moving the correction step to a shared location, and CS-Q47 approved
counting the late line in the ordinary tier accumulator. Re-issue the concrete file list and complete the move-only
55-2f-0 PR before dispatching the repair route.

### 9.1 The problem (CS-Q46)

FR-047 puts the repair behind an API route and requires, in the same transaction, the repair version, the recompute and
the posted correction. The correction step — pure arithmetic (`domain/commission-correction-*.ts`,
`commission-source-ref.ts`, `use-cases/commission-month-recompute.ts`), the orchestration
(`post-commission-corrections.ts`), the port and about 660 lines of SQL (`persistence/commission-correction-*.ts`) —
lives in `apps/worker/src/modules/commissions`. `apps/api` cannot import `apps/worker`. The spec, ADR-0054 and
`plan-55-1b.md` are silent on this **write** step. (The API's reads are planned separately: D-25 and ADR-0054 §5 give
50-5 and 51-1 their own read-only adapters, so the estimate and the statement view do not depend on this answer.) One
later row hits the same wall: 53-2's carry writer must choose its target «exactly as a correction's» (D-22), and the
D-13 selector is a worker `domain/` file today.

| | Option A (recommended) — a shared home | Option B — the repair goes through the outbox |
| --- | --- | --- |
| What | A move-only PR (55-2f-0) puts the correction step where both apps' `commissions` modules can import it; the API runs the repair synchronously | The API stores the repair version, the audit row and a new event; a worker consumer recomputes and posts later |
| Spec | FR-047 unchanged | FR-047 changes: no «same transaction»; CM-52b's code flip and CM-52's resolution happen after the request returns; a second repair can be accepted before the first is applied |
| Cost | CLAUDE.md §2.1 changes (a new package, or `packages/commissions-engine` gains a second, non-pure part), an ADR-0054 addendum, the module-map `packages_restricted` entry, the ESLint boundary blocks; about 1 500 lines moved with their tests, no logic change | A new event type and consumer, a module-map event row; smaller now |
| Later rows | Gives 53-2 the D-13 target selector with the same move; 50-5 and 51-1 may reuse the shared month reader instead of writing a second copy, but do not need it | Gives 53-2 nothing: it still needs the selector moved or copied. 50-5 and 51-1 are unaffected |

### 9.2 What does not depend on the answer

- Route `POST /v1/businesses/:businessId/employees/:employeeId/commission-period-repairs`, body `{ period, plan }`,
  `Idempotency-Key`, `@Require('manage:commission-plans:business', { business })`, `@RequiresFeature('commissions')`
  (CS-Q1, CS-Q27).
- The plan is validated with `validateWireCommissionPlan`, as FR-006 (`create-commission-plan-version.usecase.ts` line 43).
- Allowed only while an open block with code `NO_PLAN` exists for that employee and month; else 422
  `COMMISSION_REPAIR_NOT_ALLOWED` (also for `NO_SALARY`, and for no block).
- The version is stored with `repair_period = period`, `effective_from = period + '-01'`, `whole_period = false`, the next
  version number of the employee (`nextCommissionPlanVersion`), audit `commission_plan.period_repaired`. FR-007's
  closed-month refusal does not apply to this writer and stays for the ordinary writer.
- Lock order, under option A: the employee row lock (`lockEmployee`, as the plan-version writer), then **one**
  `lockStatementPeriods` call from the source month through the business's current month, ascending; the current month
  is re-read after the wait and a change is a retryable refusal; the locked permission recheck (`recheckAccess`) runs
  after the locks, as the plan-version writer does; no nested transaction, one guard transaction.
- Then the step of §5.2 for that one employee and month, with the target D-13 chooses from this call's snapshot:
  success → corrections posted and the block resolved; `NO_SALARY` → the code flips on the same row, nothing is posted,
  the version and the audit row are still committed (CM-52b).
- Idempotent replay returns the stored response and writes nothing.
- Tests: CM-52 (O1 and O2 under CS-Q47), CM-52b, CM-52c (O4), the three 422 cases, permission and feature
  refusals, an idempotent replay, the rollover refusal, a barrier test of the repair against a concurrent late line for
  the same month (one waits on the statement lock; no deadlock), and a cross-tenant assertion.

## 10. Gates and delivery

- Local gates per sub-PR (PP-113): typecheck of the touched workspaces, `eslint` on the touched modules,
  `pnpm lint:docs`, `pnpm module-map:check`, `pnpm format:check` on changed files, and the sub-PR's own tests on a
  private database lane (one at a time per cluster). The full `pnpm check` and the API shards are `ci-gate`'s on the
  exact head; until it is green a sub-PR is «implementation complete, pending `ci-gate`».
- Guard skills at the implementer (PP-198, Heavy): `clean-code-guard`, `test-guard`, `waleed-security-reviewer` on
  55-2b and 55-2f. One `/code-review` by the manager per PR.
- 55-2b is a migration PR: the migration lane, the database review, and the PP-129 snapshot before the staging deploy.
- A delivery above twice its budget is refused (pipeline §14).
- Order: 55-2a and 55-2b in parallel; then 55-2c; then 55-2d and 55-2e in parallel; 55-2f last.

## 11. Acceptance criteria

1. `selectCommissionPlanVersion` applies a repair version only inside its month and only where no ordinary version
   applies (E1…E8, O1).
2. CM-R07 passes; the table's constraints, grants and trigger behave as §4.3 lists.
3. A `NO_PLAN`/`NO_SALARY` closed month consumes the event and records one open block with the held target chosen once
   (K1, K2, K5); a later recompute moves the code or resolves the row (K3, K4); the resolution posts into the earliest
   DRAFT month at that moment (K5, K5b).
4. One ascending `lockStatementPeriods` call per event; no nested transaction; replay and crash leave no partial write
   (U6, K8, K9).
5. The bell rings once per block, in groups of at most 100, atomically with the block (N3…N6), with no amount and no name.
6. The list returns only the caller's business rows, guarded, paginated, with a proved plan (L1…L7).
7. Every new `domain/` export, `ports/` method and `events/published.ts` event has its Arabic doc; the changed comments
   describe the new behaviour.
8. No new import arrow; `pnpm module-map:check` passes with the one new event row.
9. Each sub-PR is within its budget and `ci-gate` is green on its exact head.
10. Each merge is a money-path merge (PP-195) and follows the manager's merge order.

## 12. Risks

- **R1 — a repair version read as an ordinary one.** Any reader that builds an engine `CommissionPlanVersion` without
  `repair_period` would apply the repair plan to later months. Q2 makes the field required; today the worker month reader
  is the only such reader. 51-1's readers must select it too: noted in the spec row. Before 55-2f stores the first repair
  row, check that no «latest version» logic counts it as the employee's current plan (the admin plan screens of 48-3
  and the plan-version list).
- **R2 — the projection must be complete** (R5 of `plan-55-1b.md`). A block recorded from an incomplete projection is a
  false alarm, and a resolution from one posts a wrong correction. The operator gate before a tenant's first approval is
  unchanged.
- **R3 — the tip correction waits on the block** (§2). It is the spec's «posts nothing for that employee and month»; K6
  proves nothing is lost.
- **R4 — generations without rows** grow by one per blocked event (Q3). Harmless: the arithmetic never reads the
  generation number as a count.
- **R5 — the held month can stay DRAFT for long** if nobody repairs. That is the designed pressure (SPEC §6); the bell and
  the list are how the owner finds it.
- **R6 — 55-2d spans five packages.** The reviewer checks it against the `discount_self_approved` surface file by file.
- **R7 — size.** About 890 lines against 400–550, before 55-2f-0's move (§0).

## 13. Decision status

| Id | Kind | Question (title as recorded) | State | Blocks |
| --- | --- | --- | --- | --- |
| CS-Q46 | technical — Waleed only | «إصلاح الشهر المقفول بيتطلب من الـ API، وخطوة التصحيح عايشة في الـ worker: نشارك الكود ولا نخلّي الإصلاح يتنفّذ بعدين؟» | **Answered** (PP-205.1, `owner-questions.ar.md` §54) | The shared move still precedes 55-2f |
| CS-Q47 | feature — decisions page, both owners; Abu Salem's pick binds | «خطة الإصلاح وسطور الشرايح: الجلسة المتأخرة تحرّك شريحة السطور اللي اتحسبت قبل كده؟» | **Final** (batch 96, `owner-questions.ar.md` §55) | Applies to the O2 and O4 cases in 55-2f |
| CS-Q48 | feature — decisions page, both owners; Abu Salem's pick binds | «قايمة «التصحيحات الموقوفة»: مين يقدر يفتحها؟» | **Final** (batch 96, `owner-questions.ar.md` §56) | The 55-2e list uses the plan-management permission |
| CS-Q45 | technical — Waleed only | the tips bootstrap meeting a closed month | PENDING since 55-1c | nothing here |

No business rule was guessed. For the manager's attention, not owner questions: the provisional `event_id` of a
repair's corrections (§1) and the bell's draft copy (Q7).
