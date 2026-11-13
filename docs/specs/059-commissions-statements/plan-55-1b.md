# Plan 55-1b — corrections: the generation and correction tables, then the correction step (spec 059, row 55-1)

Status: PLAN ONLY — one docs file, no code, no migration, no test (2026-11-13). Base: `main` @ `971bdb232`, re-verified by grep:
the last migration on `main` is `0223`, and `commission_period_generations`, `commission_corrections` and `commission_sales`
are **absent** from `packages/db` (schema, migrations, grants). PR #816 (55-1a, merged) and the open PR #1010 (50-3c) were
confirmed by the task session with `gh` on 2026-11-13.
Inputs: `CLAUDE.md`; `pospay-pipeline/SKILL.md` §§1–3; spec 059 (FR-015, FR-039…FR-045, D-3, D-5, D-11…D-13, D-22, §6
_Schema_, CM-22, CM-43…CM-49, CM-48c, CM-R06, the §7 rows 55-1/55-2); `owner-questions.ar.md` (CS-Q7, CS-Q8, CS-Q9, CS-Q28,
CS-Q29); `plan-50-3.md`, `plan-56-1.md`, `plan-56-1b.md`; ADR-0054 §§1, 4, 5, 6; `apps/worker/src/modules/commissions/**` (the
correction target, the period domain, the errors, the two projection scopes, the event consumption, the three projection use
cases, the module wiring); `packages/db/src/statement-periods.ts`, `packages/db/test/commission-statement-{fixtures,grants}.ts`,
`packages/db/test/tenant-table-inventory.ts`, `packages/db/schema/commissions-statements.ts`;
`packages/commissions-engine/src` (`period-commission.ts`, `period-input-assembly.ts`, `period-input-types.ts`).

---

## 1. What 55-1a delivered, and what row 55-1 still needs

**55-1a (MERGED — PR #816, `07210d25`)** delivers the pure selector `selectCommissionCorrectionTarget(snapshot, sourcePeriod,
currentPeriod)` in `domain/commission-correction-target.ts`: the earliest `DRAFT` month **after** the source and **not after**
the current month; a REVIEWED month is skipped and keeps its review; the snapshot is the only source of truth, so no month is
read outside its lock; it refuses a bad period, an unknown status, a missing statement id and an ambiguous duplicate — plus its
spec file and the typed errors `CommissionCorrectionTargetRefusal` / `CommissionCorrectionTargetInputError`
(`COMMISSION_CORRECTION_TARGET_INPUT_INVALID`). **What it deliberately does not do:** no lock order, no completeness rule for
the snapshot, no caller — so the caller obligations stay open (FR-015/FR-039, CM-48/CM-48c): **one** ascending
`lockStatementPeriods` call, classification **after** the wait, and the target chosen **before** any affected REVIEWED month
is reopened.

| Item | State | What is missing / evidence |
| --- | --- | --- |
| FR-039 the correction step; FR-040 the insert-only table, the `(source_period, employee_id, source_ref)` key and the copied source attribution; FR-041 the tip corrections; FR-042 the salary month range | REMAINING (all four) | no correction table or reader exists (grep over `packages/db`, `apps/worker`); `ProjectSalary` locks and then **throws** on a closed affected month |
| FR-043 plan versions and overrides never produce a correction | MERGED (the guard) | FR-007/FR-012 refuse a closed month in the API writers (48-2, 49-1); 55-1 keeps that refusal and adds the assertion that a plan version never writes a correction row |
| FR-044 corrections are tested on seeded closed periods | REMAINING | the seed; the base helpers already exist in `packages/db/test/commission-statement-fixtures.ts` (`walkCommissionStatement` walks DRAFT → REVIEWED → APPROVED under `lockStatementPeriods`, plus `insertCommissionLine` and the attachment writer) |
| FR-045 negative totals, departed employees, the display | REMAINING (the 55-1 part only) | the correction for a departed employee posts normally into the next open statement; the **carry writer is 53-2** (D-22) and the **display is 53-3** — both outside row 55-1 |
| CM-22 crash between the projection write and the correction insert | REMAINING | the atomicity proof |
| CM-43…CM-49 | REMAINING | all eight |
| CM-48c the concurrent approval | REMAINING | simulated by the FR-044 seed under the lock (row 55-1's own wording) |
| CM-R06 the named isolation test for both tables | REMAINING | with the migration |

**Merged support, not a row-55-1 deliverable:** the lock helper, the typed lock errors, `reopenReviewedStatementPeriods` and
the three statement tables (48a-2); the engine assembly and `ReceivedCommissionCorrection` (50-a); the line projection, the
consumer, `commissionPeriodLockPlan` and `classifyCommissionPeriods` (50-1); the tips and salary projections (50-2).

---

## 2. Dependency verdict for the NEXT 55-1 sub-PR

| Dependency | State on `main` | Needed by 55-1b? | Note |
| --- | --- | --- | --- |
| 48a-2 the three statement tables + `lockStatementPeriods` + `reopenReviewedStatementPeriods` + `StatementPeriodClosedError` | MERGED | yes | the frozen rows and the attachment snapshot the correction step reads; `packages/db/src/statement-periods.ts` already returns `statementId` per locked period |
| 50-1 the line projection, the consumer, `commissionPeriodLockPlan`, `classifyCommissionPeriods` | MERGED | yes | the lock plan already locks the affected period **and** every candidate through the current month, ascending, in one set — FR-015's shape |
| 50-2 the tips and salary projections (+ `readNextEffectiveFrom` for FR-042's `next_from`) | MERGED | 55-1c | |
| 50-a `assembleCommissionPeriodInput` + `ReceivedCommissionCorrection` | MERGED | yes | FR-022: "No second assembly path exists" — the correction step uses this function |
| 55-1a the selector | MERGED | yes | but its candidate type needs `statementId`, and the worker's `lockCommissionPeriods` **drops it** today (`locked.map((row) => ({ period: row.period, status: row.status }))`) → 55-1b carries it through |
| 50-4 (`commission_sales`) | **NOT merged** | no | the `SALE` kind cannot ship; see §3 |
| 50-3c (coverage readers + report, PR #1010) | **NOT merged** | no | an approval-time coverage gate for 53-1/53-2, not a correction prerequisite |
| 50-3d (the six-type retained-event replay) | **NOT merged** | no | it repairs the **projection's** completeness after a rollback, not the correction arithmetic (risk R5) |
| 51-1 (the statement builder, the canonical fingerprints, `commission_carries`) | **NOT merged** | no | the correction step reads the frozen rows + the projection + the engine, not the statement builder (risk R4) |
| 53-1 / 53-2 (approval) | **NOT merged** | no | CM-48c's concurrent approval is the FR-044 seed under the lock |

**Verdict: nothing unmerged blocks 55-1b.** The only deferral forced by an unmerged dependency is the `SALE` kind, which waits
for 50-4. **Which source ships first:** **lines** (the `COMMISSION` kind) — no unmerged dependency at all; then **tips and
salaries** (55-1c); then **package sales** (55-1d, after 50-4). Before 50-4 there is no sales projection and no
`PackageSaleChanged` handler, so the consumer never receives a sale event and no sale correction can be produced.

---

## 3. Proposed split of the remaining 55-1 work

Row 55-1 is 450–600 hand-written lines and 55-1a took ~120 production lines, leaving ~330–480 for two tables + RLS + grants
+ the correction step + three sources + the FR-044 seed + ten test ids. That does not fit in one PR.

| Sub-PR | One concern | Prod lines | Migration | Lane | Order | Depends on |
| --- | --- | --- | --- | --- | --- | --- |
| **55-1b** | The two tables + RLS/grants/indexes + the correction step for **commission lines** (the core) | ~300 | **yes** | migration lane (one at a time, PP-124/PP-130) | 1st — build this next | 50-a, 50-1, 48a-2, 55-1a |
| **55-1c** | The correction step for **tips and salaries** (FR-041, FR-042) | ~180 | no | — | 2nd | 55-1b, 50-2 |
| **55-1d** | The correction step for **package sales** (kind `SALE`) | ~90 | no | — | after 50-4 | 55-1b, 50-4 |

55-1b is first because every later source reuses its tables, its generation counter, its snapshot plumbing and its D-13 call
site; 55-1c adds sources to a machine that already exists; 55-1d is blocked by 50-4 anyway. **Row band:** 55-1a (~120) +
55-1b (~300) + 55-1c (~180) + 55-1d (~90) ≈ **690** against the row's 450–600, an overrun of ~90 lines. Recommendation: accept
the split and note the band (the spec's §7 band is "hand-written lines including tests and copy", and the seed + the ten test
ids are the bulk of the row's test subtask). The alternative — folding 55-1d into 55-1c — is worse: it would put the tips and
salary corrections behind 50-4 for no gain.

---

## 4. 55-1b in detail

- **Scope:** the two tables with RLS, grants and indexes; the CM-R06 negative isolation test; the pure correction arithmetic;
  its persistence; the consumer wiring **for the line source only**; and the FR-044 seed for the tests.
- **The behaviour change that belongs to this row** (FR-015's own words: *"Until 55-1/55-2 add the correction step, an affected
  period that is APPROVED or PAID under the lock makes the delivery throw the worker's domain error `CommissionPeriodClosedError`
  before any projection write"*): 55-1b replaces that interim refusal for the line source with the correction path. FR-015's
  order is explicit — **apply the projection change → for each affected closed period run the correction step → return each
  affected REVIEWED period to DRAFT → mark consumed**.
- **Out of 55-1b:** tips and salaries (55-1c), sales (55-1d), the blocked-correction table and the repair (55-2), the carry
  writer (53-2, D-22), the display (53-3), the statement builder and the fingerprints (51-1).

### 4.1 Files

- **Create:** `packages/db/schema/commissions-corrections.ts` (both tables, the shape of `commissions-lines.ts`);
  `packages/db/migrations/0224_<date>_commission-corrections.sql` + `meta/0224_snapshot.json` + the `_journal.json` entry
  (generated; **the number is taken at merge time** — renumber, never rename, per plan-56-1 §2);
  `packages/db/src/__tests__/rls-commission-corrections.spec.ts` (CM-R06);
  `packages/db/src/__tests__/commission-correction-constraints.spec.ts`;
  `apps/worker/src/modules/commissions/domain/commission-correction-step.ts` + its spec;
  `apps/worker/src/modules/commissions/persistence/commission-correction.scope.ts`.
- **Edit:** `packages/db/test/commission-statement-grants.ts` (the two tables' table and column grants; or a new
  `commission-correction-grants.ts` in the shape of `commission-tip-salary-grants.ts`);
  `packages/db/test/tenant-table-inventory.ts` (two entries);
  `apps/worker/src/modules/commissions/persistence/commission-period-locks.ts` (return `statementId`);
  `apps/worker/src/modules/commissions/domain/commission-line-types.ts` (`LockedCommissionPeriod` gains `statementId`);
  `apps/worker/src/modules/commissions/ports/commission-line-projection.port.ts` (the scope gains the correction methods);
  `apps/worker/src/modules/commissions/use-cases/project-service-lines/project-service-lines.ts` (the interim refusal becomes
  the correction path); `apps/worker/src/modules/commissions/commissions.module.ts` (the wiring);
  `packages/db/test/commission-statement-fixtures.ts` (only if the seed needs a helper it lacks).
- The correction step is a **domain function + a scope**, not a second use case: CLAUDE.md §1 keeps one use case per PR, and
  55-1c reuses the same function for the tips and salary projections. No `docs/module-map.md` row: no new cross-module reader
  and no new import arrow.

### 4.2 Schema (spec §6, CLAUDE.md §5)

**`commission_period_generations`** — `company_id uuid NOT NULL` (FK `companies(id)`); `id uuid NOT NULL`, PK
`(company_id, id)` (ADR-0007), **no default** (the writer passes `ids.newId()`, the rule D-3 sets for statement rows);
`business_id uuid NOT NULL`; `employee_id uuid NOT NULL`; `period char(7) NOT NULL`; `generation integer NOT NULL`.
`UNIQUE (company_id, employee_id, period)` (the spec's §6 row, literal); composite FK `(company_id, business_id, employee_id)`
→ `employees (company_id, business_id, id)` (the `commission_carries` precedent); the same period-pattern CHECK as
`commission_statements_period`. Grants: `REVOKE ALL … FROM PUBLIC, pospay_app, pospay_auth, pospay_dispatcher`; `GRANT SELECT,
INSERT` and `GRANT UPDATE (generation)` to `pospay_app`; **no DELETE**. RLS: `ENABLE` + `FORCE`; `_select`, `_insert` (WITH
CHECK), `_update` (USING + WITH CHECK), all `company_id = app_company_id()`, `TO pospay_app`. Indexes: the unique index serves
`(company_id, employee_id, period)`; add `(company_id, business_id, employee_id)` for the composite FK (CLAUDE.md §5: index
every FK).

**`commission_corrections`** — `company_id`, `id` (PK `(company_id, id)`), `business_id`; `employee_id uuid NOT NULL`
(composite FK → `employees`); `source_period char(7) NOT NULL`; `target_period char(7) NOT NULL`; `target_statement_id uuid
NOT NULL`; `source_ref text NOT NULL` (`line:<id>` / `sale:<id>` / `tip:<session>:<method>`); `kind text NOT NULL`; `amount
numeric(14,3) NOT NULL` (the signed delta); `previous_amount numeric(14,3) NOT NULL`; `new_amount numeric(14,3) NOT NULL`;
`generation integer NOT NULL`; `event_id uuid NOT NULL` (the trace to the cause); `created_at timestamptz NOT NULL`;
`source_branch_id uuid NULL`; `source_business_date date NULL`; `attached_branch_ids uuid[] NOT NULL` (empty is allowed — an
employee with no frozen interval covering the date).
- `UNIQUE (company_id, source_period, employee_id, source_ref, generation)`; `CHECK (amount = new_amount − previous_amount)`;
  `CHECK (kind IN ('COMMISSION','SALE','TIP_CARD','TIP_CASH'))`; `CHECK (target_period > source_period)`; the period-pattern
  CHECK on both periods; composite FK `(company_id, business_id, target_period, target_statement_id)` → `commission_statements
  (company_id, business_id, period, id)` — the `commission_carries` precedent, so the target month and the target statement are
  one fact; FK `(company_id, business_id, source_branch_id)` → `branches`.
- **Insert-only**: `GRANT SELECT, INSERT` to `pospay_app`; no UPDATE, no DELETE (FR-040). RLS: `ENABLE` + `FORCE`; `_select`
  and `_insert` (WITH CHECK), `company_id = app_company_id()`, `TO pospay_app`. Indexes: `(company_id, business_id,
  target_period)` (spec); GIN on `attached_branch_ids` (spec); the composite FK indexes `(company_id, business_id,
  target_period, target_statement_id)` and `(company_id, business_id, employee_id)`; `(company_id, business_id, source_branch_id)`.
- Money is `numeric(14,3)` and `bigint` mills in TS — never a JS `number` (CLAUDE.md §5).

Both tables are expand-only: two new tables, no change to an existing table, no destructive statement. No new role, no
`SECURITY DEFINER`, no `BYPASSRLS`, no grant outside these two tables.

### 4.3 Lock order and transaction/role per step

One `withTenant(event.company_id)` transaction, role `pospay_app`, in FR-015's order:

| # | Step | Role / transaction | Note |
| --- | --- | --- | --- |
| 1 | dedupe by `event_id` → `markEventConsumed` | `pospay_app`, same tx | `markCommissionEventConsumed` returns false for a replay → the body is skipped (CM-49) |
| 2 | the identity advisory locks (line ids ascending) | same tx | `lockLines` (existing) — identity locks first, then statement rows, always |
| 3 | read the held revisions, drop the stale ones | same tx | existing |
| 4 | the affected `(employee, period)` pairs | pure | `affectedCommissionPeriods` |
| 5 | **one** `lockStatementPeriods` call: every affected period **and**, for each affected period whatever its status before the call, every candidate from it through the current month — ascending | same tx | `commissionPeriodLockPlan`; **one call only** — a second call with an earlier month can deadlock (CM-02) |
| 6 | re-read the current month **after** the wait | same tx | FR-015 defers the rollover re-read to 55-1, "where a correction target depends on it" — open question Q1 |
| 7 | classify the affected periods (closed / reviewed) from the statuses that call returned | pure | `classifyCommissionPeriods`; a candidate-only month is never classified |
| 8 | choose the target per affected closed period with 55-1a's selector, from **the same snapshot** | pure | the snapshot must carry `statementId` → `lockCommissionPeriods` must stop dropping it |
| 9 | apply the projection change (`replaceLines`) | same tx | FR-015: the projection write happens **before** the correction step |
| 10 | for each affected closed period: the correction step (FR-039) | same tx | bump the generation, recompute, compute the deltas, insert the correction rows |
| 11 | return each affected REVIEWED period to DRAFT (D-5) | same tx | `reopenReviewedStatementPeriods` — **after** the target is chosen (FR-015's order) |
| 12 | mark consumed | same tx | rolled back with everything else |

### 4.4 The correction step (FR-039 / FR-040)

For each affected closed `(employee, period)`: (1) **bump the generation** in `commission_period_generations` — the first
correction for a pair is generation 1 (CM-44); (2) **recompute the month with current inputs** (D-1): read the employee's
projection rows for that period + the plan versions + the service overrides + the corrections already received, assemble with
`assembleCommissionPeriodInput` and run `computePeriod` → `perSource` (`line:<id>`, `sale:<id>`) — the tips are not priced
(D-1), their amount comes from the tip projection; (3) **build the source union** (FR-039): the frozen sources of the source
month (`commission_statement_lines` of kind `COMMISSION`/`SALE`/`TIP_CARD`/`TIP_CASH`) ∪ the sources of the corrections already
posted ∪ the newly computed sources; (4) **per source**: `previous = frozen + Σ(corrections already posted for that triple)`,
`new` = the recomputed amount or 0 when the source is not in the recompute, `delta = new − previous` — when `delta ≠ 0` insert
one row carrying `previous_amount`, `new_amount`, `amount = delta`, the generation, the event id, the target month and
statement and the source attribution; (5) **the source attribution** (FR-040): `source_branch_id`, `source_business_date` and
`attached_branch_ids` are **copied** from the frozen row of that triple when one exists; only for a triple that was never
frozen are they resolved **once** by its first correction — the branch and the business date from the projection, and the
`attached_branch_ids` from the source month's **frozen attachment snapshot** (`commission_statement_attachments`), never from
the live `EmployeeBranch`, so a link edited after approval cannot move it.

### 4.5 Idempotency, dedupe and crash atomicity

- **Event dedupe** (CM-49): the existing `markEventConsumed` — a replayed event returns false and the whole body is skipped,
  so a replay never reaches the generation bump.
- **Arithmetic dedupe**: a second real change bumps the generation again and posts only `new − (frozen + corrections already
  posted)` for each source. **Database backstop**: `UNIQUE (company_id, source_period, employee_id, source_ref, generation)`.
- **Atomicity** (CM-22): one transaction covers the projection write, the generation bump, the correction inserts, the REVIEWED
  → DRAFT reopen and the consumed mark. A crash between the projection write and the correction insert rolls the projection
  write back too, so the redelivery sees the old projection and produces the same correction. The correction step must never
  open a second transaction (CLAUDE.md §5: no nested or concurrent transactions).

### 4.6 Tests

- **CM-R06** (`packages/db`, real Postgres, ADR-0006): company B reads 0 of A's rows in both tables; B's insert for A fails;
  B's UPDATE of A's generation touches 0 rows; `relforcerowsecurity` is true.
- **Constraints**: a bad `kind`; a bad period format; `amount ≠ new_amount − previous_amount`; `target_period ≤
  source_period`; a duplicate `(source_period, employee_id, source_ref, generation)`; a target statement of another business;
  an employee or a source branch of another business.
- **Domain unit spec** (no database): the delta arithmetic; a zero delta posts nothing; the union of the three source sets;
  the attribution copy rules (copied from the frozen row vs resolved once from the attachment snapshot).
- **Worker integration spec** (real Postgres, one cloned database per spec file): **CM-43** — lines 600 then 400, 5 % above
  500, approved; cancelling A posts −20.000 for B into the next open month and the late 600 posts +20.000 in a new generation;
  **CM-44** — the cancelled 200.000 line posts −10.000 into November at generation 1 and October's frozen rows are unchanged;
  **CM-45** — a performer change: one negative correction for the removed performer, one positive for the added; **CM-47** — a
  change to a PAID month posts a correction exactly like an APPROVED one; **CM-48** — the two interleavings with the owner's
  manual REVIEWED → DRAFT return, with no correction into November while October was DRAFT when the target was chosen and no
  status read before its lock; **CM-48c** — the consumer's one ascending call already includes October and November, and after
  the wait it sees September APPROVED and posts into October with no second lock call; **CM-49** — a replayed event is deduped
  before the generation bump and a second real change posts only the new delta; **CM-22** — a crash between the projection write
  and the correction insert leaves neither a projection row nor a correction row; **FR-044** — the seed freezes the closed month
  through the storage layer, never through 53-2's use case.

### 4.7 EXPLAIN, index, speed, permissions, audit, outbox

- **EXPLAIN / indexes:** the correction step reads `commission_corrections` by `(company_id, source_period, employee_id,
  source_ref)` (the unique index) and `commission_period_generations` by `(company_id, employee_id, period)` (the unique index);
  the target month's input fingerprint (51-1) reads by `(company_id, business_id, target_period)` and the branch filter uses the
  GIN index on `attached_branch_ids`. 55-1b adds **no** `queries/` file, so the CI EXPLAIN gate does not apply; the scope's
  statements must still be indexed (CLAUDE.md §5). The EXPLAIN assertion goes with the reader that owns the query and asserts
  the **index**, never a fixed millisecond limit.
- **Speed:** the correction step runs inside the worker's event transaction — it is already a BullMQ job, so it adds **no**
  synchronous wait to the API (CLAUDE.md §6's 200 ms rule: anything over 200 ms is a worker job; this path is one). Any
  before/after performance test measures **both** the unchanged baseline and the new code **in the same run on the same
  runner** and asserts only a **ratio** (at most about 2× the baseline plus a small additive floor) — never an absolute
  millisecond limit such as `p95 <= 50ms` (PP-165, CLAUDE.md §9). The §6 200 ms rule stays as it is.
- **Permissions: none expected.** The correction step is a worker-internal write under `pospay_app` inside
  `withTenant(company_id)`: no HTTP route, no guard, no new permission code, no decisions-page entry.
  `manage:commission-plans:business`, `review:commissions:business`, `approve:commissions:business` and
  `pay:commissions:business` are untouched.
- **Audit: none.** CLAUDE.md §8's audit list covers prices, discounts, permissions, payments, refunds, stock posts, settings,
  device approval, gateway connections, private-file access and marketing sends — a commission correction is not in it, and the
  immutable correction row (with its `event_id`) is the financial record. See Q3.
- **Outbox: none.** A correction is an input of the target month (it enters that month's input fingerprint and is frozen at the
  target's approval). `CommissionCorrectionBlockedNoticeRequested` belongs to 55-2.
- **Migration lane: yes — one migration** (the two tables), one migration task at a time; the manager merges it after the gates
  and the coordinated order pass (PP-124). The number is assigned at merge time — `0224` if nothing else merges first; renumber,
  never rename. 55-1c and 55-1d plan no migration.

---

## 5. Risks and open questions

**Risks.**
- **R1 — the closed-month guard changes:** 55-1b replaces 50-1's interim `CommissionPeriodClosedError` for an affected closed
  month (the spec's own wording defers it to 55-1); 50-1's CM-21 and CM-22 tests must keep passing and the API writers (plan
  versions, overrides) must keep refusing a closed month (FR-007, FR-012, FR-043) — `StatementPeriodClosedError` does not
  disappear from `packages/db`, it leaves the consumer's line path.
- **R2 — the snapshot's completeness is the caller's duty, not the selector's:** a caller that passes a filtered list would pick
  the wrong target and post a correction into the wrong payroll month, so 55-1b must have exactly **one** caller and one test
  asserting the snapshot is the whole lock result (every affected period and every candidate).
- **R3 — `statementId` is dropped today:** `lockCommissionPeriods` returns only `{ period, status }` and `LockedCommissionPeriod`
  has no `statementId`, while 55-1a's candidate requires it; 55-1b changes both (additive), and 50-1's and 50-2's two callers
  are checked in the same pass.
- **R4 — the FR-044 seed's fingerprints:** FR-044 asks for "the statement fingerprint of the rows it is about to write" but
  51-1's canonical builder is not merged, so 55-1b uses the fixture's placeholder fingerprints; the correction step never reads
  a fingerprint (it reads the frozen rows), so the tests stay valid and the seed is upgraded when 51-1 lands — `TODO(spec)`, a
  note in the spec, **not** an owner question.
- **R5 — the projection's completeness:** the recompute of a closed month reads the **current** projection; if the projection
  was never bootstrapped for that tenant (the 50-3a/50-3b replay is an operator run) the recompute under-counts and posts a
  wrong correction, and 55-1b must not silently "repair" this — the 50-3 runbook gate and the approval coverage check (53-1/53-2)
  are the guard, and 50-3d exists for the post-rollback case — `TODO(spec)`, a note: which runbook gate must precede the first
  correction in a tenant.
- **R6 — no `SALE` corrections before 50-4:** no sales projection and no `PackageSaleChanged` handler exist before 50-4, so the
  consumer never sees a sale event — no wrong money, only a missing kind, carried by 55-1d.
- **R7 — the row's size band** (§3): ~690 against 450–600.
- **R8 — the salary range is the heavy one:** a salary entry spans every month whose last day falls in `[effective_from,
  next_from)`, several of which may be closed, so one transaction may run several correction steps — that is 55-1c, but the shape
  (one ascending lock call over the whole range plus every candidate) must be designed in 55-1b and not patched later.
- **R9 — the month rollover between the plan and the lock:** see Q1.

**Open questions.** No **business/money** question is open for 55-1b: the rules it implements are answered (CS-Q7, CS-Q8,
CS-Q9, CS-Q28, CS-Q29 — the correction posts normally for a departed employee, the carry writer is 53-2 and the display is
53-3). The three below are **technical** → Waleed only, never on the decisions page (CLAUDE.md §1 5b).

**Q1 — الشهر المصدر يتغير بين الخطة والقفل** (blocks 55-1b's current-period re-read and CM-48 / CM-48c). `TODO(spec)`.
The candidate set is computed with the current month read **before** the lock; FR-015 defers the re-read to 55-1 "where a
correction target depends on it" but does not say what happens when the re-read changes the month. Options:
1. **(recommended)** تُعاد قراءة الشهر الحالي **بعد** انتظار الأقفال؛ ولو اتغيّر (لفّ الشهر وانتظرنا) تُرمى المعاملة بخطأ
   مُصنَّف (`COMMISSION_PERIOD_ROLLED_OVER`) فتُلغى كل الكتابات ويُعاد تسليم الحدث في الشهر الجديد، لأن نداء القفل الثاني بشهر
   أقدم قد يصنع deadlock (CM-02).
2. تُعاد قراءة الشهر الحالي قبل القفل فقط (سلوك 50-1) وتُعتمد لحظة القراءة، فالتصحيح قد ينزل في شهر لم يعد مرشحاً.
3. تُعاد قراءة الشهر الحالي بعد القفل، ولو اتغيّر تُقفل الشهور المرشحة الجديدة في **نداء ثانٍ** — خطر deadlock مع كاتب آخر
   (CM-02)، وغير مسموح.

**Q2 — هل يبقى `CommissionPeriodClosedError` في المستهلك بعد 55-1؟** (blocks the exact shape of the refusal in 55-1b.)
`TODO(spec)`. D-3 and FR-002 say a closed period refused by a writer raises the typed error, while FR-015's order and its
"Until 55-1/55-2 add the correction step" note say the consumer now corrects instead of refusing. Options:
1. **(recommended)** المستهلك لا يرفض بعد 55-1: يقفل، يصنّف، يختار الهدف، **يكتب الإسقاط**، ثم يصحّح؛ وwriters آخرون (إصدارات
   الخطة والاستثناءات في الـ API، FR-007/FR-012/FR-043) يبقون يرفضون بـ `StatementPeriodClosedError`.
2. يبقى الرفض في المستهلك ويُعطَّل التصحيح — يعني بند 55-1 غير قابل للتنفيذ.
3. يرفض المستهلك **فقط** إذا لم يوجد هدف DRAFT (كل الشهور المرشّحة مغلقة) — حالة غير ممكنة عملياً اليوم لأن الشهر الحالي لا
   يمكن أن يُعتمد قبل نهايته.

**Q3 — سجل التدقيق للتصحيح** (blocks whether 55-1b writes an audit row). `TODO(spec)`. CLAUDE.md §8's audit list does not
include commission corrections, and the correction row is immutable and carries its `event_id`. Options:
1. **(recommended)** لا سجل تدقيق جديد؛ صف التصحيح نفسه هو السجل المالي الدائم، و`event_id` هو أثره على الحدث المسبّب.
2. سجل تدقيق لكل تصحيح (`commission.correction`) — صفوف كثيرة جداً (كل تصحيح في كل شهر).
3. سجل تدقيق واحد لكل حدث أدخل تصحيحاً — وسط بين 1 و2.

---

**Summary:** 55-1b = the two correction tables (RLS, grants, indexes, CM-R06) + the pure correction arithmetic + the FR-039 correction step wired into the **line** consumer, ~300 production lines, **migration: yes (one expand-only migration, the migration lane)**, dependency verdict: **nothing unmerged blocks it** — 50-a, 50-1, 48a-2 and 55-1a are on `main`; only the `SALE` kind defers to 55-1d behind 50-4.
