# Spec 059 — Commission plans, projection and statements (Phase 1 rows 48a–56b)

> **Status:** Draft · 2026-10-21 · docs-only PR. Owner questions CS-Q1…CS-Q19 are open and recorded in
> [owner-questions.ar.md](owner-questions.ar.md), split into a money list (CS-Q1…CS-Q12, Abu Salem through the decisions
> page) and a permissions/technical list (CS-Q13…CS-Q19, Waleed through his super agent). Every rule that waits on one is
> marked `TODO(spec)` with its number. **No code starts before this spec is merged**, and no sub-PR starts before the
> questions it names in §7 are answered.
> **Implements:** Phase 1 SPEC §4 (commission entities), §5 (the engine, already built), §6 (events, estimate, review,
> approval, corrections) and §11 (the commission behaviour tests); plan rows 48a, 48, 49, 50, 51, 52, 53, 54, 55, 55b, 56
> and 56b.
> **Builds on:** the engine of rows 29/30 ([spec 006](../006-commissions-engine-i/spec.md),
> [spec 012](../012-commissions-engine-ii/spec.md)), [ADR-0012](../../adr/0012-statement-approval-pending-outbox-count.md)
> (gate G2, the pending-outbox count), [ADR-0041](../../adr/0041-orders-service-sessions-reads-and-events.md) §4/§6 (event
> granularity, revision guards, recovery), [ADR-0044](../../adr/0044-service-line-price-edit-event-and-bell.md) (the
> `change` block) and [ADR-0049](../../adr/0049-pdf-renderer-in-phase-1.md) (the render transport the export reuses).
> **Consumes the events of:** spec 050 (`ServiceSessionRecorded`, `ServiceSessionLinesAdded`), spec 35d / 054 / 055
> (`ServiceLineChanged` with `change.kind` `PRICE_DISCOUNT_EDIT`, `LINE_CANCELLED`, `PERFORMERS_CHANGE`), spec 053
> (`SessionTipsChanged`, and its bootstrap reader 36-5), spec 021 (`SalaryChanged`) and rows 42–47 (`PackageSaleChanged`,
> not built yet).
> **Design advisors:** required before 59-0 (the ADR), 48a-2 (the lock helper and the statement table), 50-1 (the
> consumer transaction) and 53-1 (the definer function), as in spec 055 §7. Not needed for this docs-only PR.
> **Largest slice of Phase 1:** split into 24 sub-PRs of at most three subtasks each (§7, owner rule 2026-10-12).

## 1. What and why

Phase 1 replaces the salon's commission spreadsheet (SPEC §1). This slice turns the engine that already exists (pure
functions, rows 29/30) into the working month: the manager writes each employee's plan, the system keeps every input of the
month current from the orders and staff events, the employee's commission is visible as an estimate, the manager reviews
the month, the owner approves it once, someone records that it was paid, and anything that changes a closed month later
arrives as a correction in the next open month. Nothing in an approved statement ever changes.

**Worked example (salon «صالون الأميرة», `Asia/Kuwait`).** سارة is the hair specialist, salary 500.000. Her plan (D-55):
tiers on, MARGINAL, AMOUNT, one step from `SALARY_MULTIPLE 2.00` (1,000.000) at 5 %, no base. In October her net shares
add up to 1,700.000, so her commission is 5 % × 700.000 = **35.000**; customers also left her card tips of 6.000 and cash
tips of 4.000. On 1 November the business manager ليلى reviews October; on 3 November the owner approves it and the
statement freezes (commission 35.000, card tips 6.000, cash tips 4.000 for information); on 5 November it is marked paid.
On 10 November a manager cancels one of سارة's October lines worth 200.000 (allowed: the window reaches back to the first
day of the previous month, CX-Q2). October is closed, so the projection recomputes October with the line removed: 1,500.000
→ 25.000. The difference, **−10.000**, is posted as corrections (one per affected line, generation 1) into November, the
earliest open month; the October statement still says 35.000. November's statement shows them in its own corrections
section (`TODO(spec)` CS-Q9) and they reduce what November pays (`TODO(spec)` CS-Q7 if November ends negative).

## 2. Scope and what this spec settles

| Row | Result | Where |
| --- | --- | --- |
| 48a | `commission_statements` and **the one period-lock helper** every writer of a period's inputs uses | §6 _Schema_, FR-001…FR-004 |
| 48 | Plan versions: storage, the builder screen, validation by the engine's `validateCommissionPlan` | FR-005…FR-010 |
| 49 | Service overrides per employee and service | FR-011…FR-013 |
| 50 | The projection consumer (lines, tips, salaries, package sales) and the estimate computed on read | FR-014…FR-024 |
| 51 | `generate-statement` and the input fingerprint | FR-025…FR-028 |
| 52 | `review-statement` | FR-029…FR-031 |
| 53 | `approve-statement`, atomic, with the ADR-0012 count | FR-032…FR-036 |
| 54 | `mark-statement-paid` | FR-037…FR-038 |
| 55 | Corrections: generations, PAID included, target lock order, tips, salaries, performer changes (spec 055 PF-Q3) | FR-039…FR-045 |
| 55b | Blocked corrections and the audited period repair | FR-046…FR-049 |
| 56 | The statement Excel export with the tips columns | FR-050…FR-052 |
| 56b | Approval reminders on the 3rd and the 5th | FR-053…FR-055 |

**Not in this slice:** the staff app's "my sessions and estimate" (row 57) and the staff-columns setting (57c), which read
the estimate this slice exposes; the alert-rules screen (row 62), which later owns the reminders' channels and switches;
the package writers (rows 42–47: this slice consumes `PackageSaleChanged` and package lines but does not produce them);
product-sale commission (later phases, owner review 2026-10-09); payroll, salary payment and deductions (SPEC §2 _Out_);
ratings (they never change commission, D-41); attendance (never changes commission, SPEC A7).

### Decisions record (technical; none is an owner question unless it names one)

| ID | Decision | Alternative rejected |
| --- | --- | --- |
| D-1 | **The engine is reused unchanged** except two additions: the period-scoped repair version (D-12) and the tips/corrections assembly around `computePeriod` (tips and corrections are not priced; they pass through). `computePeriod` stays the only pricing function | re-implementing any pricing in the consumer, the estimate or the screen |
| D-2 | **One statement per business and calendar month** (SPEC §4 `Statement business_id · period`, D-17); its lines are per employee. Review, approval and payment act on the whole statement | per-employee statements (not in SPEC §4) |
| D-3 | **One lock helper** in `packages/db` (`lockStatementPeriods`): it creates the statement row of a period if absent (`INSERT … ON CONFLICT DO NOTHING`), then takes `SELECT … FOR UPDATE` on the rows of the requested periods **in ascending period order**, and returns their status. Every writer of a period's inputs (the consumer, plan versions, overrides, period repair) and every status change (review, approve, pay) goes through it. A closed period refused by a writer raises the typed `StatementPeriodClosedError` (CLAUDE.md §5, PP-7.2) | an advisory lock (no row to recheck status on); a helper per module (the API and the worker both write periods) |
| D-4 | **The estimate is never stored** (SPEC §6). `generate-statement` persists only the statement row and its current fingerprint; statement lines are written **once**, frozen, by approval. The estimate and the DRAFT/REVIEWED view are the engine run on read over the projection | a stored DRAFT result that could drift from its inputs |
| D-5 | **Any applied input change returns a REVIEWED statement to DRAFT** under its lock (clears `reviewed_*`), in the same transaction as the change; approval additionally recomputes the fingerprint under the lock and compares it with `reviewed_fingerprint` | comparing hashes only at approval (the screen would show "reviewed" for a statement that is no longer what was reviewed) |
| D-6 | **The fingerprint** is SHA-256 over the canonical JSON (`packages/db` `canonicalJson`) of the period's ordered inputs for the business (§6 _Fingerprint_). The ordered input set is built by a pure domain function; the hashing is an injected port (`domain/` imports nothing, CLAUDE.architecture.md §3.1) | hashing inside `domain/`; a counter (does not detect a writer that forgot to bump it) |
| D-7 | **The estimate and statement views are read-only use cases**, not `queries/` files, because they must run the engine and `queries/` may not import `domain/` (CLAUDE.architecture.md §7.1). They read through ports, write nothing, and the ADR of 59-0 records this as the one read-path exception of the module. Plain lists (plan versions, overrides, corrections, blocked corrections) stay `queries/` with `EXPLAIN` tests | stored results (D-4); pricing in SQL |
| D-8 | **One consumer id, `commissions.project-inputs`,** for every input event type (ADR-0012 §1); its `consumed_events` mark commits in the same transaction as the projection change, the generation increment and the corrections, under the statement locks (SPEC §6). A stale-revision no-op still writes the mark (ADR-0012 §1) | one consumer per type (the approval count reads one id) |
| D-9 | **ADR-0012's counted types grow from four to six** in row 53: `ServiceSessionRecorded` and `ServiceSessionLinesAdded` join `ServiceLineChanged`, `PackageSaleChanged`, `SessionTipsChanged` and `SalaryChanged`, as ADR-0041 §6 requires. 53-1 ships the function with the six types and an ADR-0012 addendum | leaving initial recordings out of the gate (an unprojected recording would be approved as zero) |
| D-10 | **Revision guards per input identity:** a line `(line_id)` by its per-line `revision` (ADR-0041 §4: a newer `ServiceLineChanged` wins over a delayed revision-1 recording); tips by the per-session `revision` (spec 053); a salary by `(employee_id, effective_from)` and its per-entry `revision` (spec 021); a sale by `(sale_id, revision)` (SPEC §3). Older or equal revisions are no-ops | last-write-wins |
| D-11 | **A line is projected as one row per performer**, with `net_share` from the engine's `allocateLineShares` (floor, remainder mills by ascending `employee_id`, SPEC §5.2). A newer revision **replaces** every row of the line, so a performer change (spec 055) removes the old performers' rows and adds the new ones; money in events is a KWD string read with `parseMoney` (ADR-0041 §4) | storing the line once (the engine prices per performer) |
| D-12 | **Period repair** is a plan version marked `repair_period = 'YYYY-MM'` that applies **only inside that month** and is ignored for every other month; the engine's `selectCommissionPlanVersion` gains that rule (a new kind of version by decision, SPEC §5.7's last sentence, never an `if` in a caller). Which lines of that month it may price is `TODO(spec)` CS-Q11 | reusing `whole_period` (it would also apply from its date onward, `plan-version.ts`) |
| D-13 | **Correction target = the earliest not-closed period after the source** (DRAFT or REVIEWED; a REVIEWED target returns to DRAFT by D-5). SPEC §6 says "earliest DRAFT"; REVIEWED is not closed (§6 "Closed means APPROVED or PAID"), and skipping a reviewed month would put a correction two months away | skipping REVIEWED months |
| D-14 | **"Lines without a performer" is satisfied by construction:** a line has 1…4 performers summing to 10000 (deferred consistency trigger, migration 0131). Approval still refuses if any projected ACTIVE line's rows do not sum to 10000 bps, as a defensive check of the projection | a second performer source in commissions |
| D-15 | **Bootstrap before approval opens** (ADR-0041 §6, spec 053 BR-08): tips from orders' `listCurrentSessionTips` (36-5); lines from an orders-owned paged reader of the latest line revision with its event ids, built in the same shape as 36-5 (new orders sub-PR 50-0); salaries from the ADR-0012 amendment backfill of unconsumed `SalaryChanged` outbox rows; package sales from an orders-owned paged reader of the latest entitlement revision with its event ids (`listCurrentPackageSales`, same shape as 36-5), which row 42 must ship with its producer. Every reader is bound to a commissions-owned port **at the composition root** (no module-map arrow); the design advisors confirm the line reader versus a controlled outbox replay before 50-0 | reading orders tables from commissions (ADR-0041 §6 forbids it) |
| D-16 | **Reads beyond SPEC §3's arrows** (the business timezone for "the period has ended", service names for the statement detail and the export, the owner and manager recipients of reminders) use provider-owned readers bound to commissions-owned ports at the composition root, the BR-08 pattern; if one cannot be bound there, the sub-PR stops and adds an ADR and the module-map row first (IMPLEMENTATION-PLAN §4) | new import arrows by default |
| D-17 | **Where the engine runs in the worker** is `TODO(spec)` CS-Q13: the worker imports nothing from `apps/api`, and ADR-0035 keeps commission kinds out of `packages/domain`. 59-0 records the answer in an ADR before 48a-1 | — |
| D-18 | **The Excel export is a worker render** on the ADR-0049 transport (202 `{ render_id }`, poll, collect once, not stored), a new `kind` for the commission statement; the workbook is built with `exceljs` (already a dependency of `apps/api`), and generation over 200 ms never runs in a request (CLAUDE.md §6). An ADR-0049 addendum names the new kind | a synchronous download |
| D-19 | **Money:** `numeric(14,3)` in Postgres, `bigint` mills in TypeScript, KWD strings on the wire (ADR-0035, ADR-0041 §4); one `roundKwd` per source inside the engine (SPEC §5.2, ADR-0005); every total is a plain sum of rounded sources and is never rounded again (`TODO(spec)` CS-Q12 for cash) | rounding a total |

## 3. Rules already settled (cited, not asked again)

| Rule | Source |
| --- | --- |
| The period is the calendar month in the business timezone; the manager reviews, the owner approves within the first five days, paid with the salary | D-17, SPEC §5 _Dates_ |
| Reminders to the owner on the 3rd and the 5th of the next month; reminders, not locks | D-54, SPEC §6 |
| Approval only after the month has ended; atomic; refused while commission events are pending, with the retryable 409 «updates are still being calculated, try again shortly» | SPEC §6, ADR-0012 §3/§5 |
| Review is bound to the inputs; the owner approves only the fingerprint that was reviewed | SPEC §6 |
| Closed means APPROVED or PAID; payment never stops corrections; the frozen statement never changes | SPEC §6 |
| A change to a closed month becomes corrections in the earliest open month after it, keyed `(source_period, employee, source_ref, generation)`, one signed delta per affected source, lines whose tier moved included | SPEC §6, M4 |
| A performer change after approval moves money as corrections: the removed performer's line goes down, the added one's goes up | spec 055 PF-Q3, SPEC M12 |
| Cancelling, editing the price of, or changing the performers of a line in an approved month is allowed within the recording window and becomes a correction; orders reads no statement status | CX-Q2, ED-Q3, PF-Q3, TP-Q2 |
| No plan or no salary is never a silent zero: recording continues, the estimate says "no plan", review and approval are refused; a disabled `package_sale` pays 0 | D-57, SPEC §5 |
| A late `NO_PLAN`/`NO_SALARY` change to a closed month is consumed, recorded as a blocked correction and repaired by an audited plan version scoped to that month (a missing salary is simply set) | SPEC §6, plan row 55b |
| Plan versions and overrides take `effective_from ≥ today`, or `whole_period` only while the month is DRAFT; base and tiers each switch on and off as a new version | SPEC §6, D-38, D-50 |
| Rounding: one `roundKwd` half away from zero per line or sale | SPEC §5.2/§5.5, ADR-0005 |
| Tips: per employee and method, outside net, thresholds and commission; card tips are a statement column paid with payroll, cash tips are informational; frozen as `TIP_CARD`/`TIP_CASH`; a tip changed in a closed month is a correction of kind TIP | D-36, SPEC §6, spec 053 |
| Package-sale commission follows the employee's plan; the salon's current plans pay none | spec 037 owner questions §3 («عمولة بيع الباكدج»), D-55 |
| Who sees commissions: the owner and the manager see all; employees and reception see their own | D-46 (the exact permissions: CS-Q14) |
| The permission strings of the statement flow: `review:commissions:business`, `approve:commissions:business`, `pay:commissions:business` | SPEC §6 (their default roles: CS-Q2, CS-Q4, CS-Q5) |
| The success criterion: the approved statement matches the manager's hand calculation to 0.001 KWD for every employee in the parallel month | SPEC §1, D-45 |

## 4. User scenarios and acceptance criteria _(mandatory)_

Named tests; each is an integration test against real Postgres (T2 stack, ADR-0006) unless marked unit. People as in §1;
أبو سالم is the owner, ليلى the business manager, هبة a second employee, منى the cashier.

### Story 1 — One lock for every writer of a month (48a, P1)

- **CM-01** `lockStatementPeriods(tx, businessId, ['2026-10'])` on a month with no statement creates one DRAFT row and locks it;
  two concurrent callers create exactly one row (unique `(company_id, business_id, period)`), the second waits.
- **CM-02** Locking `['2026-11', '2026-10']` locks October then November (ascending); a writer that needs both never deadlocks
  against another that needs both (barrier test, two transactions).
- **CM-03** A plan-version writer that finds the month APPROVED or PAID under the lock gets `StatementPeriodClosedError` →
  409 `COMMISSION_PERIOD_CLOSED`; nothing is written.
- **CM-04** RLS: company B cannot read, lock or create a statement of company A (negative isolation test).

### Story 2 — Plan versions and the builder (48, P1)

- **CM-05** ليلى saves سارة's plan (MARGINAL, AMOUNT, `SALARY_MULTIPLE 2.00` at 5 %, base off, package sale off) effective
  today: one version row (`version` = previous + 1 for that employee), one audit entry, the response echoes the stored version.
- **CM-06** Every §5.7 combination the engine's validator accepts is accepted by the API; every rejection carries the
  engine's named code (`INVALID_COMBINATION`, `MIXED_THRESHOLDS`, `STEPS_NOT_ASCENDING`, `NO_STEPS`, `INVALID_CALC`,
  `INVALID_THRESHOLD`, `INVALID_PLAN`) as 422 `COMMISSION_PLAN_INVALID` with `details.code`; the builder shows the same message
  before submit (same function, unit test over the full product).
- **CM-07** An ordinary version with `effective_from` before today (business timezone) → 422
  `COMMISSION_EFFECTIVE_FROM_PAST`; a `whole_period` version for a past month that is REVIEWED → accepted and that month
  returns to DRAFT (D-5); for a month that is APPROVED or PAID, or with a closed month after it → 409
  `COMMISSION_PERIOD_CLOSED`.
- **CM-07b** On 2 November هبة's October shows `NO_PLAN`; ليلى adds a `whole_period` version dated 1 October while October
  is still DRAFT: October's estimate prices her lines, review is no longer blocked, and November follows the same version.
- **CM-08** A plan write racing an approval of the month it affects: the approval wins the lock, the writer sees APPROVED and
  is refused (SPEC §11 "a plan write racing approval sees APPROVED and is refused").
- **CM-09** The builder (admin) shows base, tiers and package sale as blocks with on/off switches, never a formula (D-35),
  shows the validator's message on the block it concerns, and shows the version history; a component test asserts the
  visible error and the disabled save button (CLAUDE.md §9).
- **CM-10** Without the plan permission (`TODO(spec)` CS-Q1) → uniform 403, nothing written; a device → 403.

### Story 3 — Service overrides (49, P1)

- **CM-11** ليلى sets هبة's override for "صبغة" to `PCT 1500` effective today: one insert-only row and one audit entry; the
  estimate of a 50 % shared line follows SPEC §5.2 (the override wins over the snapshot and the plan, for that line only).
- **CM-12** Rules accepted: `FOLLOW_PLAN`, `ZERO`, `PCT 0…10000`, `FIXED ≥ 0`; an absent override is not `ZERO` (no row means
  the line's snapshot). Two overrides on the same date: the latest `created_at`, then `id`, wins (engine `service-rule.ts`).
- **CM-13** Same date and lock rules as plan versions (CM-07, CM-08), same permission (CS-Q1).

### Story 4 — The projection and the estimate (50, P1)

- **CM-14** A `ServiceSessionRecorded` with two lines, one shared 50/50 by سارة and هبة: one line head and three performer rows;
  `net_share` by `allocateLineShares` sums to the line's net; the consumer's mark is in the same transaction.
- **CM-15** `ServiceSessionLinesAdded` projects only its new lines; an already-projected line is never projected twice.
- **CM-16** `ServiceLineChanged` revision 2 (`PRICE_DISCOUNT_EDIT`) replaces the line's rows; delivered **before** the delayed
  revision-1 recording, revision 1 is then a no-op (ADR-0041 §4); both events are marked consumed.
- **CM-17** `LINE_CANCELLED` sets the line's rows CANCELLED (they leave the engine's input); `PERFORMERS_CHANGE` replaces the
  rows (سارة 100 % → سارة 70 % / رنا 30 %, spec 055 §1) and the next estimate of both employees moves.
- **CM-18** `SessionTipsChanged` replaces the session's tip rows when its revision is newer; a lower or equal revision is a
  no-op with a mark; an empty latest set removes the tips.
- **CM-19** `SalaryChanged` for `(employee, effective_from)` upserts when its revision is newer; two salaries on one date →
  the later revision replaces (SPEC §11); out-of-order delivery converges.
- **CM-20** `PackageSaleChanged` (once row 42 produces it) upserts the sale by revision; an imported package has no seller
  and no sale commission (D-51). The sale's month is the event's `business_date` (FR-018); a sale at 21:30 UTC on 31 October
  is a November sale in Kuwait.
- **CM-20b** Sales recorded before the 50-4 consumer existed are projected from `listCurrentPackageSales` (D-15), their event
  ids are discharged, a live event of the same or a lower revision is then ignored, and approval stays closed until every
  sale's applied revision is ≥ the revision the reader reports (the spec 053 BR-08 coverage rule, applied to sales).
- **CM-21** Duplicate, reordered and replayed events converge: the projection after any permutation of a fixed event set
  equals the projection after the ordered set (property test over a seeded set, SPEC §11).
- **CM-22** A crash between the projection write and the correction insert leaves neither (the transaction is killed
  between them; SPEC §11).
- **CM-22b** A bootstrap page and a live delivery of the same line race (barrier): revision 2 commits first and the
  waiting revision-1 writer, rechecking under the identity lock, applies nothing and only marks its event consumed;
  the same test for a tip session, a salary entry and a sale.
- **CM-23** The estimate equals `computePeriod` over the DRAFT projection for every employee (SPEC §11); an employee with
  no applicable version shows `NO_PLAN`, with a salary-multiple plan and no salary `NO_SALARY`, never zero (D-57).
- **CM-24** Bootstrap (D-15): tips recorded and lines saved before the consumer existed are projected from the readers; a
  live event of the same or a lower revision is then ignored; a revision written between a page read and the first live
  delivery still ends in the projection; the readers' event ids are discharged in `consumed_events`; approval stays closed
  until both coverage conditions of spec 053 BR-08 hold (TP-15 race test, and the same test for lines).
- **CM-25** Salary backfill (ADR-0012 amendment): a `SalaryChanged` published before the consumer existed is applied once;
  a repeated backfill adds nothing; a failed projection leaves its mark absent.
- **CM-26** The business-date boundary: a line at 21:30 UTC that is the next day in Kuwait belongs to the next month
  (SPEC §5 _Dates_); the consumer uses the event's `business_date` and never converts an instant itself.

### Story 5 — Generate the statement and its fingerprint (51, P1)

- **CM-27** After 31 October has ended in the business timezone, ليلى generates October: the DRAFT row exists, the view
  shows per employee: commission per source, sales, card tips, cash tips, corrections received, total and payable
  (`TODO(spec)` CS-Q7 for a negative total), plus the blocking issues (`NO_PLAN`, `NO_SALARY`, unresolved blocked
  corrections) by employee. Nothing per line is stored (D-4).
- **CM-28** The fingerprint is stable: generating twice with no input change gives the same value; any applied input
  change (line, tip, salary, sale, plan version, override, correction received, blocked correction) changes it (unit test
  over each input kind, and an integration test per writer).
- **CM-28b** `GET` of a month that was never generated returns the computed view with `generated: false` and leaves no
  statement row, no fingerprint and no lock behind (asserted in the database after the call).
- **CM-29** Generating a month that has not ended → 422 `COMMISSION_PERIOD_NOT_ENDED`; the estimate is still readable.

### Story 6 — Review (52, P1)

- **CM-30** ليلى reviews October with `expected_fingerprint` equal to the current one: status REVIEWED, `reviewed_fingerprint`,
  reviewer and time stored, one audit entry, one `StatementAwaitingApproval` request (FR-053).
- **CM-31** A stale `expected_fingerprint` → 409 `COMMISSION_FINGERPRINT_STALE` with the current fingerprint; a blocking issue
  → 422 `COMMISSION_STATEMENT_BLOCKED` with the issues by employee (D-57).
- **CM-32** An input change after REVIEWED returns the statement to DRAFT in the writer's transaction (D-5, SPEC §11).
- **CM-33** Without `review:commissions:business` (default roles `TODO(spec)` CS-Q2) → 403. Whether the reviewer may also
  be the approver is `TODO(spec)` CS-Q3.

### Story 7 — Approve, atomically (53, P1)

- **CM-34** The owner approves October: in **one** transaction the start time is captured before the lock, the statement is
  locked, the month has ended, the status is REVIEWED, the current fingerprint equals `reviewed_fingerprint`, no blocking
  issue, no unresolved blocked correction, no projected line with shares ≠ 10000 (D-14), the ADR-0012 count is 0; then every
  `StatementLine` is frozen (one per employee × source: `COMMISSION`, `SALE`, `TIP_CARD`, `TIP_CASH`, `CORRECTION`), the
  fingerprint is frozen as `input_fingerprint`, status APPROVED with approver and time, one audit entry.
- **CM-35** A pending commission event created before the start → 409 `COMMISSION_UPDATES_PENDING` with the ADR-0012 text;
  nothing frozen; a manual retry after processing approves (ADR-0012 §4 group 5).
- **CM-36** Approval races a session, a redemption, a refund, a tip, a salary, a plan version and an override: each lands in
  the frozen result or in a correction, never lost and never twice (SPEC §11, ADR-0012 §4 group 6, barriers not sleeps).
- **CM-37** Two approvers at once: one approves, the other sees APPROVED and gets 409 `COMMISSION_PERIOD_CLOSED`.
- **CM-38** Only holders of `approve:commissions:business` approve (default owner; grantable `TODO(spec)` CS-Q5); the reviewer
  rule CS-Q3 applies; a month not ended → 422 `COMMISSION_PERIOD_NOT_ENDED`.
- **CM-39** The ADR-0012 §4 groups 1–4 and 7 (catalogue, context isolation, predicate fixtures over the **six** types of
  D-9, search-path attacks, result shape and `EXPLAIN`) pass in 53-1.

### Story 8 — Mark paid (54, P1)

- **CM-40** The payer marks October paid with a method (`TODO(spec)` CS-Q6) and the payment date: status PAID, `paid_at`,
  `paid_on` (stored as given, e.g. 5 November recorded on 7 November), `paid_method`, payer, one audit entry; nothing in the frozen lines changes (SPEC §11 "PAID records the method").
- **CM-41** A DRAFT or REVIEWED statement → 409 `COMMISSION_STATEMENT_NOT_APPROVED`; a PAID one → idempotent replay of the
  same request returns the original response, a different body → 422 `IDEMPOTENCY_KEY_REUSED`, a second key → 409
  `COMMISSION_STATEMENT_ALREADY_PAID`.
- **CM-42** Without `pay:commissions:business` (default roles `TODO(spec)` CS-Q4) → 403.

### Story 9 — Corrections (55, P1)

- **CM-43** SPEC M4 (Codex's example): lines 600 then 400, 5 % above 500, approved (B = 20.000); cancelling A posts −20.000
  for B into the next open month; then a late 600 before B posts +20.000 in a new generation (the exact amounts and
  source refs are asserted).
- **CM-44** §1's example: the cancelled 200.000 line posts corrections summing to −10.000 into November, generation 1, keyed
  per source; October's frozen lines are unchanged.
- **CM-45** A performer change on an approved line (spec 055): one negative correction for the removed performer, one positive
  for the added, plus any tier-shifted lines of either employee.
- **CM-46** A salary committed after approval → corrections on the lines whose threshold moved (SPEC §11); a tip changed in a
  closed month → a `TIP_CARD` or `TIP_CASH` correction for that `tip:<session>:<method>` source; raising a cash tip of a
  closed month changes no payable figure, raising a card tip does.
- **CM-47** A change to a PAID month posts a correction exactly like an APPROVED one (SPEC §11).
- **CM-48** The target closes while a correction is being posted (barrier): the writer rechecks under the target's lock,
  moves to the next not-closed month and locks it (ascending order kept, SPEC §11).
- **CM-49** A replayed event is deduped before it can bump the generation; a second real change bumps it again and posts only
  `new − (frozen + corrections already posted)` for each source.
- **CM-50** Corrections received are inputs of the target: they enter its fingerprint and are frozen as `CORRECTION` lines at
  its approval; their display is `TODO(spec)` CS-Q9.

### Story 10 — Blocked corrections and period repair (55b, P1)

- **CM-51** A late session in approved September for هبة, who had no plan before 15 September: the event is consumed, one
  blocked correction `(هبة, 2026-09, NO_PLAN)` is recorded, the outbox does not stall, and October cannot be approved while
  it is unresolved (SPEC §6).
- **CM-52** ليلى adds a period repair for هبة in September (allowed only while a `NO_PLAN` blocked correction exists, else 422
  `COMMISSION_REPAIR_NOT_ALLOWED`, including for a `NO_SALARY` block): one audited repair version that applies only inside September (D-12); the recompute posts
  the correction normally and resolves the blocked correction. Which September lines it prices: `TODO(spec)` CS-Q11.
- **CM-53** A `NO_SALARY` block is resolved by setting the salary for its date in staff (spec 021); the `SalaryChanged`
  recompute posts the correction and resolves the block; a repair request for a `NO_SALARY` block is refused.
- **CM-54** Who is told about a blocked correction: `TODO(spec)` CS-Q19; it is always listed on the statement view of the
  target month as a blocking issue.

### Story 11 — Excel export (56, P2)

- **CM-55** Exporting approved October returns 202 `{ render_id }`; the worker builds the workbook from the **frozen** lines
  only; the file has the card-tips and cash-tips columns (D-36) and never a phone (SPEC §4); every download is audited
  (who, when, business, period). Its sheets and which statuses can be exported: `TODO(spec)` CS-Q10; customer name:
  `TODO(spec)` CS-Q15.
- **CM-56** The amounts in the file equal the frozen statement bit for bit (KWD, three decimals, as text-safe numbers).

### Story 12 — Reminders (56b, P2)

- **CM-57** On the 3rd and on the 5th of November, if October is not APPROVED, one `StatementAwaitingApproval` request per
  statement per day reaches the approvers (channel and hour `TODO(spec)` CS-Q17); none once it is approved; a rerun of the
  job the same day sends nothing new (ledger, SPEC §11 "reminders on the 3rd and 5th"). Never a lock (D-54).
- **CM-57b** A company created after the release gets its scheduler from `CompanyCreated`; a company whose Redis schedule
  was lost gets it back on the next commission input delivery; an existing company gets it from the operator replay.
- **CM-58** The review reminder `StatementAwaitingReview`: when and to whom `TODO(spec)` CS-Q16.

### Edge cases

- An employee who left the business still gets her month computed and her corrections posted (`TODO(spec)` CS-Q8 for how
  they are settled).
- A month with no input at all for the business still has a statement when generated (all employees with zero), so the
  owner can approve an empty month.
- A line whose `rule_snapshot` is `ZERO`, `PCT` or `FIXED` needs no plan (spec 012, requirement 8); only `FOLLOW_PLAN` lines and sales
  can produce `NO_PLAN`.
- An event of another company or business never touches this statement (tenant from the outbox envelope, `withTenant`).
- A plan version created for a future date applies from that date; the current month's estimate does not change before it.

## 5. Requirements

### 48a — statements and the lock helper

- **FR-001** Table `commission_statements` (§6 _Schema_), one row per `(company_id, business_id, period)`, status DRAFT →
  REVIEWED → APPROVED → PAID, plus REVIEWED → DRAFT (D-5, and CS-Q18). A `BEFORE UPDATE` trigger refuses every other
  transition and any change to an APPROVED row except to PAID, and any change to a PAID row.
- **FR-002** `packages/db` exports `lockStatementPeriods(tx, { businessId, periods })` (D-3): validates `YYYY-MM`, de-duplicates,
  sorts ascending, upserts missing rows as DRAFT, locks them `FOR UPDATE`, returns `{ period, statementId, status }[]`.
  It runs inside the caller's `withTenant` transaction and never opens its own (CLAUDE.md §6, PP-7.2).
- **FR-003** Typed errors from `packages/db`: `StatementPeriodClosedError` (mapped to 409 `COMMISSION_PERIOD_CLOSED`) and
  `StatementPeriodFormatError` for a malformed period (500, a broken invariant); never a plain `Error` on an expected path.
- **FR-004** Each writer's persistence adapter has a test proving it calls `lockStatementPeriods` in the same transaction
  before its first write to a commission input table (a grep cannot check call order, so the test is the gate).

### 48 — plan versions

- **FR-005** `POST /v1/businesses/:businessId/employees/:employeeId/commission-plan-versions` (Idempotency-Key required) with a
  strict Zod body that mirrors SPEC §4 `PlanVersion` (`effective_from`, `whole_period`, `base`, `tiers`, `package_sale`); PCT as
  integer bps, FIXED and literal thresholds as KWD strings, `SALARY_MULTIPLE k` as a two-decimal string (ADR-0035, spec 012 §4).
- **FR-006** The body is validated by the engine's `validateCommissionPlan` (one validator for the API and the builder, SPEC
  §5.7); its codes become 422 `COMMISSION_PLAN_INVALID` with `details.code`.
- **FR-007** Under `lockStatementPeriods` for every month from the month of `effective_from` through the current month: an
  ordinary version needs `effective_from ≥ today`; a `whole_period` version may name a past month (SPEC §6: "or `whole_period`
  only for a DRAFT period") when that month and every later month up to today are not closed (REVIEWED ones return to DRAFT,
  D-5), because the version then also applies from its date onward (`plan-version.ts`); any closed month in that range →
  409 `COMMISSION_PERIOD_CLOSED`. This is how a `NO_PLAN` found after a month ended, before its approval, is fixed.
- **FR-008** Insert-only `commission_plan_versions`; `version` is the next integer per employee, allocated under the employee's
  row lock; `created_at` from the injected `Clock`, the id from `IdGenerator` (CLAUDE.md §4.3); one audit entry
  `commission_plan.version_created` with the plan JSON (no salary figure in the audit text).
- **FR-009** `GET …/commission-plan-versions` (a `queries/` file, newest first) for the builder's history.
- **FR-010** Permission: `TODO(spec)` CS-Q1 (proposed `manage:commission-plans:business`), the `commissions` feature, an
  individual admin login (not a device), rechecked inside the transaction.

### 49 — service overrides

- **FR-011** `POST /v1/businesses/:businessId/employees/:employeeId/commission-overrides` (Idempotency-Key) `{ service_id, rule,
  effective_from }`, `rule` one of `FOLLOW_PLAN | ZERO | PCT bps | FIXED KWD`, the service checked in the business through a
  catalog reader bound at the root (D-16).
- **FR-012** Same lock and date rules as FR-007 (an override has no `whole_period`); insert-only `commission_service_overrides`;
  audit `commission_override.created`.
- **FR-013** `GET …/commission-overrides` (`queries/`), current and history per service. Permission as FR-010.

### 50 — projection consumer and estimate

- **FR-014** A worker `commissions` consumer `commissions.project-inputs` (D-8) handles `ServiceSessionRecorded`,
  `ServiceSessionLinesAdded`, `ServiceLineChanged` (all three `change.kind`s and none), `SessionTipsChanged`, `SalaryChanged`
  and `PackageSaleChanged`. Where the engine code comes from: D-17 / CS-Q13.
- **FR-015** For one event, in **one** `withTenant(event.company_id)` transaction: dedupe by `event_id` → expand to input
  identities → **take a transaction advisory lock per input identity** (`(company, kind, line_id | session_id | sale_id |
  employee_id+effective_from)`, ascending; it also covers an identity with no projection row yet) → only then read the held
  revisions and drop stale ones → compute the affected `(employee, period)` pairs from that locked state (old and new
  performers, old and new business dates) → `lockStatementPeriods` for every affected period plus the correction targets,
  ascending → apply the projection change → for each affected closed period run the correction step (FR-039) → return each
  affected REVIEWED period to DRAFT (D-5) → mark consumed. Any failure rolls everything back (SPEC §6). The bootstrap (FR-020)
  takes the same identity locks in the same order before it compares revisions, so a live delivery and a bootstrap page of
  one identity serialize: the lock order is always identity locks, then statement rows, and only the consumer and the
  bootstrap take identity locks, so no writer can deadlock against them.
- **FR-016** Projection tables (§6 _Schema_): `commission_line_heads` + `commission_lines` (one row per line × performer,
  D-11), `commission_tip_heads` + `commission_tips`, `commission_salaries`, `commission_sales`.
- **FR-017** Money from events is parsed with `parseMoney`; a malformed amount parks the event (it is a producer bug), never
  a zero.
- **FR-018** `business_date` and `period` (`YYYY-MM` of it) come from the event; a line whose business date changes between
  revisions (it cannot today) would be handled as a removal from one month and an addition to another. **`PackageSaleChanged`
  must carry `business_date`**, resolved by orders at the sale in the business timezone (SPEC §5 _Dates_) and never changed
  by later revisions: SPEC §3 lists only `sold_at`, so row 42's contract adds the field (a SPEC §3 amendment in that PR),
  and 50-4 refuses to start without it. The consumer never converts `sold_at` with a timezone read later.
- **FR-019** Registered in the worker's consumer registry; `KNOWN_EVENT_TYPES` already holds every type except
  `PackageSaleChanged`, which row 42 registers.
- **FR-020** Bootstrap (D-15) in its own sub-PR, run once per tenant after the consumer is live, idempotent, with a runbook
  count; tips from 36-5, lines from 50-0, salaries from the outbox backfill, package sales from row 42's
  `listCurrentPackageSales` (in 50-4). Approval stays closed until every bootstrapped input type meets the coverage rule.
- **FR-021** Estimate: `GET /v1/businesses/:businessId/commissions/periods/:period/estimate?employee_id=` returns per employee:
  per-source amounts, the total, sales, tips by method, corrections received, and `status: OK | NO_PLAN | NO_SALARY`; computed
  on read by a read-only use case (D-7), never stored. Permission `TODO(spec)` CS-Q14 (the staff app's own estimate is row 57).
- **FR-022** The engine input for one employee and month is assembled by a pure domain function from the projection rows
  (ACTIVE lines, active sales, the salary entries, versions, overrides); tips and corrections pass through unpriced (D-1).
- **FR-023** Names for display come from `EmployeeDirectoryPort` (staff, ADR-0010) and a catalog service-name reader bound at
  the root (D-16).
- **FR-024** An event for a business whose `commissions` feature is off is still projected and marked (turning the feature on
  later must not lose a month); only the routes are feature-gated.

### 51 — generate-statement and fingerprint

- **FR-025** `POST /v1/businesses/:businessId/commission-statements/:period/generate` refuses a month that has not ended
  (business timezone, D-16) with 422 `COMMISSION_PERIOD_NOT_ENDED`; under the lock it ensures the DRAFT row, computes the view
  (CM-27) and the fingerprint, stores `current_fingerprint` and returns the view. `GET …/:period` **writes nothing and takes
  no lock**: it computes the same view and fingerprint on read (D-7), returns `generated: false` when no statement row exists,
  and for a closed month returns its frozen lines.
- **FR-026** The fingerprint input (§6 _Fingerprint_) is built by a pure function; the hash by an injected port (D-6).
- **FR-027** The view lists blocking issues per employee: `NO_PLAN`, `NO_SALARY`, unresolved blocked corrections; review and
  approval are refused while any exists.
- **FR-028** Permission: the read permission of CS-Q14 for `GET`; `review:commissions:business` for `generate`.

### 52 — review-statement

- **FR-029** `POST …/:period/review` `{ expected_fingerprint }` (Idempotency-Key): under the lock, the month has ended, status
  DRAFT, no blocking issue, recomputed fingerprint = `expected_fingerprint`; set REVIEWED with `reviewed_fingerprint`,
  reviewer user and membership, time; audit `commission_statement.reviewed`.
- **FR-030** Emit `StatementAwaitingApproval` (SPEC §3) to notifications in the same transaction, recipients resolved by
  commissions (SPEC §3 "emitting modules put recipients and channels in the event"; channel CS-Q17).
- **FR-031** Returning a REVIEWED statement to DRAFT by hand: `TODO(spec)` CS-Q18.

### 53 — approve-statement

- **FR-032** `POST …/:period/approve` `{ expected_fingerprint }` (Idempotency-Key), the ADR-0012 §3 transaction exactly:
  `transaction_timestamp()` captured before the lock → lock → recheck ended month, permission, status REVIEWED, fingerprint =
  `reviewed_fingerprint` = `expected_fingerprint`, no blocking issue, no unresolved blocked correction, D-14 → the count → freeze.
- **FR-033** Freezing writes `commission_statement_lines` (insert-only): per employee, one `COMMISSION` line per `line:<id>`
  source, one `SALE` per `sale:<id>`, one `TIP_CARD`/`TIP_CASH` per `tip:<session>:<method>`, one line per received
  correction (its own id as source) of kind `CORRECTION` (commission and sale corrections), `CORRECTION_TIP_CARD` or
  `CORRECTION_TIP_CASH`, so the payable figure can be computed from the frozen kinds alone; zero amounts are frozen too, so the frozen set equals the fingerprinted set.
- **FR-034** Status APPROVED, `approved_by`, `approved_at`, `input_fingerprint`; audit `commission_statement.approved` (SPEC §1:
  the approval actor and time are in the audit log).
- **FR-035** 53-1 delivers the ADR-0012 function, role, grants, policies and index with the six types of D-9 and its addendum;
  53-2 the use case; 53-3 the race tests.
- **FR-036** Permission `approve:commissions:business` (CS-Q5); reviewer rule CS-Q3.

### 54 — mark-statement-paid

- **FR-037** `POST …/:period/mark-paid` `{ paid_method, paid_on }` (Idempotency-Key): under the lock, status APPROVED → PAID,
  `paid_by`, `paid_at` (the recording time), `paid_on` (the payout date the payer states, a business date not after today
  and not before the approval date) and `paid_method` (CS-Q6), all persisted; audit `commission_statement.paid` with both
  dates. Reads and the export show `paid_on` as the payment date.
- **FR-038** Permission `pay:commissions:business` (CS-Q4).

### 55 — corrections

- **FR-039** The correction step, for an affected **closed** source month and employee, in the consumer's transaction: bump
  `commission_period_generations` → recompute the month with current inputs (D-1) → for every source of that employee in
  the month (union of frozen, previously corrected and newly computed sources) post `delta = new − (frozen + corrections
  already posted)` when non-zero → into the target of D-13, rechecked under its lock (SPEC §6).
- **FR-040** `commission_corrections` is insert-only, `UNIQUE (company_id, source_period, employee_id, source_ref, generation)`,
  with `kind` `COMMISSION | SALE | TIP_CARD | TIP_CASH` (SPEC §6's kind TIP, split by method because the two are paid
  differently, D-36), the signed amount, the target month and statement, and the event id.
- **FR-041** Tips: a newer `SessionTipsChanged` for a closed month posts `TIP_CARD` or `TIP_CASH` corrections per
  `(employee, tip:<session>:<method>)`. A `TIP_CASH` correction is informational like a cash tip: it is shown and frozen,
  never added to the payable figure and never part of a negative-commission carry (CS-Q7); a `TIP_CARD` correction is
  paid or recovered with payroll like a card tip.
- **FR-042** Salaries: a `SalaryChanged` whose date is on or before a closed month's last day, and which changes that month's
  selected salary, recomputes that month for that employee.
- **FR-043** Plan versions and overrides never reach a closed month (FR-007), so they never produce corrections; only the
  period repair (FR-046) does.
- **FR-044** Corrections are tested on **seeded closed periods** (plan row 55): the seed freezes a month directly through the
  storage layer, so 55 does not wait on 53.
- **FR-045** Negative totals, departed employees and the display of corrections: `TODO(spec)` CS-Q7, CS-Q8, CS-Q9. If CS-Q7
  chooses to carry a negative commission into the next month, the carry is a new frozen line kind added by decision (SPEC
  §4's `kind` list grows), posted by approval into the next open month, never a silent netting of tips (BR-06).

### 55b — blocked corrections and period repair

- **FR-046** When the recompute of a closed month returns `NO_PLAN`/`NO_SALARY`, the consumer still marks the event consumed,
  records `commission_blocked_corrections (employee, source_period, code, first_event_id)` (one open row per employee and
  month, later events reuse it) and posts nothing for that employee and month (SPEC §6).
- **FR-047** `POST /v1/businesses/:businessId/employees/:employeeId/commission-period-repairs` `{ period, plan }`
  (Idempotency-Key): allowed only while an open blocked correction **with code `NO_PLAN`** exists for that employee and month
  (a `NO_SALARY` block is resolved only by the dated salary, SPEC §6, and refused here with `COMMISSION_REPAIR_NOT_ALLOWED`;
  if the repaired recompute then returns `NO_SALARY`, the same block stays open with its code changed to `NO_SALARY`); the plan is validated
  like FR-006; stored as a plan version with `repair_period` (D-12, CS-Q11); audit `commission_plan.period_repaired`. In the
  same transaction the month is recomputed and the correction posted (FR-039); the block is resolved when the recompute
  succeeds.
- **FR-048** A target month with an open blocked correction for any employee cannot be reviewed or approved (SPEC §6).
- **FR-049** The blocked correction is visible on the statement view and in a list `GET …/commission-blocked-corrections`
  (`queries/`); who is notified: CS-Q19. Permission for the repair: CS-Q1.

### 56 — Excel export

- **FR-050** `POST …/:period/exports` → 202 `{ render_id }` on the ADR-0049 transport (D-18); the worker document source reads
  the frozen statement under `withTenant`, closes the transaction, then builds the workbook; poll and collect once.
- **FR-051** Columns include, per employee: employee number (row 8c), name, commission, sales commission, corrections received,
  card tips, cash tips (informational), and the payable figure (CS-Q7); the content and states: CS-Q10; customer name: CS-Q15.
  No phone ever (SPEC §4, R1).
- **FR-052** Audit `commission_statement.exported` on each collected download. Permission: the read permission of CS-Q14.

### 56b — reminders

- **FR-053** Discovery follows ADR-0037: a worker `commissions` consumer of `CompanyCreated` upserts the BullMQ job scheduler
  `commissions-statement-reminders-<companyId>` (hourly, job data `{ companyId }` only, outside any transaction); every
  `commissions.project-inputs` delivery upserts the same scheduler (repair of a lost Redis schedule); existing companies get a
  one-time controlled operator replay of `CompanyCreated` after the worker rolls out (runbook). The job reads the
  company's businesses and their timezones under `withTenant` through the tenancy reader bound at the root (D-16) and,
  for each business whose local time has passed the reminder hour (CS-Q17), emits `StatementAwaitingApproval` on
  the 3rd and the 5th for the previous month while it is not APPROVED or PAID; a `commission_statement_reminders` ledger
  `UNIQUE (company_id, statement_id, kind, reminder_date)` makes it once per day; zero recipients is a durable decision.
- **FR-054** Recipients and channels are put in the event by commissions (SPEC §3); until row 62 the interim rule of CS-Q17
  applies (the ADR-0037 precedent), and row 62 must list both kinds in its switches.
- **FR-055** `StatementAwaitingReview`: CS-Q16. Both events are registered in `NOTIFICATION_SOURCE_EVENTS` and the worker's
  known types, with ar/en templates, before any producer (the 35d order).

## 6. Slice design

### Business rules

- **BR-01** Money moves only through the engine (SPEC §5); the consumer, the views, the export and the screens add and display,
  never price.
- **BR-02** A closed month never changes; every later change is a correction in a later open month (SPEC §6).
- **BR-03** Every writer of a month's inputs and every status change takes the month's lock through one helper, ascending.
- **BR-04** Missing configuration is never zero (D-57).
- **BR-05** Commissions never reads an orders or staff table; it learns inputs from events and from root-bound readers
  (ADR-0041 §6, SPEC §3).
- **BR-06** Tips are paid in full to the employee and are never priced, netted or thresholded (D-36); `TODO(spec)` CS-Q7
  decides only whether a negative commission is carried, never a tip.

### Fingerprint

The canonical input of one business and month: for each employee in ascending id, the ACTIVE projected lines of the month
(`line_id`, `revision`, `occurred_at`, `recorded_at`, `business_date`, `net_share`, `share_bps`, `rule_snapshot`, `counts`),
the sales (`sale_id`, `revision`, `price_paid`, `refunded_amount`), the tip rows (`session_id`, `revision`, `method`, `amount`),
the salary entries with `effective_from ≤` the month's last day, the plan versions and overrides that can apply in the month,
the corrections received by the month, and the open blocked corrections that target it. Every list sorted by its identity;
money as KWD strings; serialized by `canonicalJson`, hashed with SHA-256, stored as lowercase hex.

### Schema changes

Every table: tenant PK `(company_id, id)` (ADR-0007), `business_id`, `FORCE` RLS with the tenant policy, tenant-and-business
qualified FKs, the exact grants listed, a negative isolation test, an entry in the privilege allowlist and its indexes in the
same migration (CLAUDE.md §5). Expand-only; migration numbers are taken at merge.

| Table | Columns (beyond company_id, id, business_id) | Constraints and grants |
| --- | --- | --- |
| `commission_statements` (48a) | `period char(7)`, `status`, `current_fingerprint`, `reviewed_fingerprint`, `reviewed_by`, `reviewed_membership_id`, `reviewed_at`, `input_fingerprint`, `approved_by`, `approved_at`, `paid_by`, `paid_at`, `paid_on date`, `paid_method`, `revision` | `UNIQUE (company_id, business_id, period)`; `CHECK` period format; FR-001 trigger; `SELECT, INSERT, UPDATE (status, …)` to `pospay_app` |
| `commission_plan_versions` (48) | `employee_id`, `version`, `effective_from date`, `whole_period`, `repair_period char(7) NULL`, `plan jsonb`, `created_at`, `created_by` | `UNIQUE (company_id, employee_id, version)`; `CHECK NOT (whole_period AND repair_period IS NOT NULL)`; insert-only (`SELECT, INSERT`) |
| `commission_service_overrides` (49) | `employee_id`, `service_id`, `rule_kind`, `rule_value`, `effective_from`, `created_at`, `created_by` | `CHECK` per kind (bps 0…10000, mills ≥ 0); index `(company_id, employee_id, service_id, effective_from)`; insert-only |
| `commission_line_heads` (50) | `line_id`, `session_id`, `revision`, `status`, `business_date`, `period` | `UNIQUE (company_id, line_id)`; `SELECT, INSERT, UPDATE` |
| `commission_lines` (50) | `line_id`, `employee_id`, `service_id`, `occurred_at`, `recorded_at`, `business_date`, `period`, `net`, `net_share`, `share_bps`, `rule_kind`, `rule_value`, `counts`, `status` | `UNIQUE (company_id, line_id, employee_id)`; index `(company_id, business_id, period, employee_id)`; `SELECT, INSERT, UPDATE, DELETE` (a projection, D-11) |
| `commission_tip_heads` / `commission_tips` (50) | head: `session_id`, `revision`, `business_date`, `period`; rows: `session_id`, `employee_id`, `method`, `amount` | `UNIQUE (company_id, session_id)` / `UNIQUE (company_id, session_id, employee_id, method)`; projection grants |
| `commission_salaries` (50) | `employee_id`, `effective_from`, `amount`, `revision` | `UNIQUE (company_id, employee_id, effective_from)`; projection grants; never logged (SPEC §12) |
| `commission_sales` (50) | `sale_id`, `seller_employee_id NULL`, `business_date`, `period`, `price_paid`, `refunded_amount`, `status`, `revision` | `UNIQUE (company_id, sale_id)`; projection grants |
| `commission_statement_lines` (53) | `statement_id`, `employee_id`, `source_ref`, `kind`, `amount`, `source_period NULL` | `UNIQUE (company_id, statement_id, employee_id, source_ref)`; insert-only; a trigger refuses an insert unless the statement is being approved in the same transaction |
| `commission_period_generations` (55) | `employee_id`, `period`, `generation` | `UNIQUE (company_id, employee_id, period)`; `SELECT, INSERT, UPDATE (generation)` |
| `commission_corrections` (55) | `employee_id`, `source_period`, `target_period`, `target_statement_id`, `source_ref`, `kind`, `amount` (signed), `generation`, `event_id`, `created_at` | `UNIQUE (company_id, source_period, employee_id, source_ref, generation)`; index `(company_id, business_id, target_period)`; insert-only |
| `commission_blocked_corrections` (55b) | `employee_id`, `source_period`, `code`, `first_event_id`, `created_at`, `resolved_at NULL`, `resolved_generation NULL` | partial `UNIQUE (company_id, employee_id, source_period) WHERE resolved_at IS NULL`; `SELECT, INSERT, UPDATE (resolved_at, resolved_generation)` |
| `commission_statement_reminders` (56b) | `statement_id`, `kind`, `reminder_date`, `recipient_count` | `UNIQUE (company_id, statement_id, kind, reminder_date)`; insert-only |

Plus, in 53-1, the ADR-0012 objects (role `pospay_approval_reader`, function, policies, outbox index) with the six types (D-9).

### Events and the module map

- **Consumed:** the six input types (FR-014), consumer id `commissions.project-inputs`. `ServiceCompleted` is not consumed:
  it was replaced by `ServiceLineChanged` (ADR-0010) and the batch recording events (ADR-0041 §4).
- **Published:** `StatementAwaitingReview`, `StatementAwaitingApproval` (SPEC §3, `docs/module-map.md`), to `notifications`,
  with recipients, channels and safe ar/en parameters (business, month; never an amount, never a name of a paid employee).
  Each has an Arabic doc comment in `events/published.ts` (CLAUDE.md §3.1).
- **Arrows:** none new by default (D-16); the root-bound readers are: business timezone (tenancy), service names (catalog),
  recipients (identity), tips and lines bootstrap (orders). 59-0's ADR lists each binding.

### Permissions

| Code | Who by default | Status |
| --- | --- | --- |
| `manage:commission-plans:business` (proposed) | `TODO(spec)` CS-Q1 | new; plan versions, overrides, period repair |
| `read:commissions:business` (proposed) | `TODO(spec)` CS-Q14 | new; estimate of all employees, statement view, export |
| `review:commissions:business` | `TODO(spec)` CS-Q2 | named by SPEC §6 |
| `approve:commissions:business` | owner (D-17, SPEC §11); grantable `TODO(spec)` CS-Q5 | named by SPEC §6 |
| `pay:commissions:business` | `TODO(spec)` CS-Q4 | named by SPEC §6 |

All refused to devices; all behind the `commissions` feature (seeded flag, `packages/db/src/seed.ts`); each route has a guard
and a refusal test (CLAUDE.md §6).

### Error codes (`message_ar` / `message_en`, added to `src/shared/errors.ts`)

- `COMMISSION_PERIOD_CLOSED` 409 — «الشهر ده اتعمد خلاص، أي تغيير هيتسجّل تصحيح في الشهر الجاي.» / "This month is already
  approved; changes become corrections in the next month."
- `COMMISSION_PERIOD_NOT_ENDED` 422 — «الشهر لسه مخلصش.» / "This month has not ended yet."
- `COMMISSION_PLAN_INVALID` 422 — details `code` (the engine's validation codes, each with its own ar/en text).
- `COMMISSION_EFFECTIVE_FROM_PAST` 422 — «تاريخ البداية لازم يكون النهارده أو بعده.» / "The start date must be today or later."
- `COMMISSION_STATEMENT_BLOCKED` 422 — details `issues [{employee_id, code}]`.
- `COMMISSION_FINGERPRINT_STALE` 409 — details `current_fingerprint`.
- `COMMISSION_STATEMENT_NOT_REVIEWED` 409, `COMMISSION_STATEMENT_NOT_APPROVED` 409, `COMMISSION_STATEMENT_ALREADY_PAID` 409.
- `COMMISSION_UPDATES_PENDING` 409 — en: "updates are still being calculated, try again shortly" (ADR-0012 §5); ar:
  «لسه بنحسب آخر التحديثات، جرّب تاني بعد شوية.»
- `COMMISSION_REPAIR_NOT_ALLOWED` 422 — «مفيش تصحيح موقوف للموظفة دي في الشهر ده.» / "There is no plan-missing blocked correction
  for this employee and month."
- Reused: `FORBIDDEN`, `FEATURE_DISABLED`, `IDEMPOTENCY_KEY_REUSED`, `IDEMPOTENCY_KEY_IN_PROGRESS`.

## 7. Delivery: the sub-PR split (owner rule 2026-10-12: at most three subtasks per PR)

Order: the ADR and the lock first; plan writers before the consumer; corrections (55, 55b) **before** approval (53), as plan
row 53's dependency on 55b and the round-4 finding #4 require. Sizes are hand-written lines including tests and copy.

| PR | Result | Subtasks | Blocked on | Size |
| --- | --- | --- | --- | --- |
| **59-0** | ADR and map, no behaviour | 1. ADR: engine location (CS-Q13), consumer id, root-bound readers (D-15/D-16), the read-use-case exception (D-7), the fingerprint. 2. `docs/module-map.md` rows and YAML. 3. ADR-0012 addendum (six types, D-9), ADR-0049 addendum (export kind), the `CompanyCreated` → worker `commissions` event row (FR-053) | this spec; CS-Q13; design advisors | 150–250 |
| **48a-1** | Engine reachable from api and worker (if CS-Q13 = package) | 1. Package scaffold, zero dependencies. 2. Move the engine and its tests unchanged. 3. Rewire api imports; boundaries and module-map checks | 59-0 | 150–300 (moves) |
| **48a-2** | Statements and the lock | 1. `commission_statements` + RLS + grants + FR-001 trigger + negative tests. 2. `lockStatementPeriods` + typed errors. 3. Lock tests CM-01…CM-04 and the FR-004 check | 48a-1 | 300–420 |
| **48-1** | Plan storage and contracts | 1. Zod contracts and OpenAPI. 2. `commission_plan_versions` + RLS. 3. The plan permission (CS-Q1) and its role defaults | 48a-2; CS-Q1 | 250–380 |
| **48-2** | Create and list plan versions | 1. Use case (FR-007/FR-008) and ports. 2. HTTP + list query + `EXPLAIN`. 3. CM-05…CM-08, CM-10 | 48-1 | 350–480 |
| **48-3** | The builder screen | 1. Blocks with switches. 2. History list. 3. ar/en keys, component tests (CM-09) | 48-2 | 300–450 |
| **49-1** | Overrides | 1. Contracts + table + RLS. 2. Use case + HTTP + list. 3. CM-11…CM-13 | 48-2 | 350–480 |
| **49-2** | Overrides screen | 1. Per-employee service table. 2. Edit dialog. 3. ar/en keys, component tests | 49-1, 48-3 | 200–320 |
| **50-0** | Orders line bootstrap reader (orders module) | 1. `queries/` latest line revision + event ids, keyset paging. 2. Public export in orders `index.ts`. 3. Shape, `EXPLAIN`, paging tests | 59-0; the design advisors' choice (D-15) | 200–300 |
| **50-1** | Line projection | 1. Line tables + RLS. 2. Consumer for the three line event types with guards, locks, mark (FR-015). 3. CM-14…CM-17, CM-21, CM-22, CM-26 | 48a-2, 48-2, 49-1 | 450–600 |
| **50-2** | Tips and salaries | 1. Tip and salary tables + RLS. 2. Their consumer handlers. 3. CM-18, CM-19, CM-25 (salary backfill) | 50-1 | 350–480 |
| **50-3** | Bootstrap | 1. Root bindings of 36-5 and 50-0. 2. The idempotent bootstrap job and the discharge of event ids. 3. CM-24 race and coverage tests, runbook | 50-1, 50-2, **36-5**, 50-0 | 300–420 |
| **50-4** | Package sales | 1. Sales table + RLS. 2. Handler and the root binding of `listCurrentPackageSales`. 3. CM-20, CM-20b (bootstrap, coverage, race) | 50-1; row 42 (producer with `business_date`, and its reader) | 250–380 |
| **50-5** | Estimate on read | 1. Input assembly (pure) and the read use case (D-7). 2. HTTP + permission (CS-Q14). 3. CM-23 | 50-1, 50-2 | 300–420 |
| **51-1** | Generate and fingerprint | 1. Canonical input (pure) + hash port. 2. Generate/GET use cases and HTTP. 3. CM-27…CM-29 | 50-5 | 350–480 |
| **55-1** | Corrections | 1. Generation and correction tables + RLS. 2. The correction step in the consumer (FR-039…FR-042). 3. CM-43…CM-49 on seeded closed months (FR-044) | 51-1; CS-Q7, CS-Q8 | 450–600 |
| **55-2** | Blocked corrections and repair | 1. Blocked table + engine `repair_period` rule (D-12, CS-Q11). 2. Repair use case + HTTP + list. 3. CM-51…CM-54 | 55-1; CS-Q11, CS-Q19 | 400–550 |
| **52-1** | Review | 1. Use case + HTTP + REVIEWED→DRAFT on writers (D-5). 2. `StatementAwaitingApproval` contract, template, registrations. 3. CM-30…CM-33 | 51-1, 55-2; CS-Q2, CS-Q3, CS-Q17, CS-Q18 | 350–480 |
| **53-1** | The ADR-0012 count | 1. Role, function (six types), grants, policies, index. 2. Privilege inventory. 3. ADR-0012 §4 groups 1–4 and 7 (CM-39) | 59-0; design advisors | 350–500 |
| **53-2** | Approve | 1. Use case + freeze (FR-032…FR-034). 2. HTTP, permission (CS-Q5). 3. CM-34, CM-35, CM-37, CM-38 | 52-1, 53-1, 55-2 | 400–550 |
| **53-3** | Approval races and screens | 1. CM-36 barrier tests. 2. Statement screen (view, review, approve, blocking issues, corrections section CS-Q9). 3. ar/en keys, component tests | 53-2; CS-Q9 | 400–550 |
| **54-1** | Mark paid | 1. Use case + HTTP (CS-Q6). 2. Permission (CS-Q4). 3. CM-40…CM-42 and the screen button | 53-2; CS-Q4, CS-Q6, CS-Q12 | 250–350 |
| **56-1** | Excel export | 1. Worker document source and workbook (D-18). 2. Request/collect routes, audit. 3. CM-55, CM-56 | 53-2; 59-0's ADR-0049 addendum; CS-Q10, CS-Q12, CS-Q15 | 350–480 |
| **56b-1** | Reminders | 1. Ledger table + RLS. 2. `CompanyCreated` scheduler registration and repair, the job and recipients (FR-053). 3. CM-57, CM-58, CM-57b, runbook replay | 52-1; CS-Q16, CS-Q17 | 300–420 |

**File overlap:** 50-1, 50-2, 50-4 and 55-1 all touch the one consumer; they run one at a time. 52-1 and 56b-1 both register
notification events; they run one at a time. Everything else may run beside them when its paths are disjoint (pipeline rule).

## 8. Success criteria

- **SC-001** The parallel month (SPEC §1): every employee's approved total equals the manager's hand calculation to 0.001 KWD,
  or each difference is traced to the manual sheet.
- **SC-002** 0 changes to an approved or paid statement after approval; 100 % of later changes appear as corrections in a
  later month, with their source month.
- **SC-003** 0 events lost or counted twice under duplicate, reordered, replayed or crashed delivery (CM-21, CM-22, CM-36).
- **SC-004** The owner approves a reviewed month in one action, and an approval with pending inputs is refused with the
  retry message instead of approving incomplete data.
- **SC-005** The estimate an employee or manager sees equals what the statement will contain for the same inputs.
- **SC-006** No customer phone and no salary appears in any log, export or event payload of this slice (SPEC §12).

## 9. Assumptions

- **Payable = commission + sales commission + commission and sale corrections + card tips + card-tip corrections**; cash
  tips and cash-tip corrections are shown, never added (D-36: card tips are paid with payroll, cash tips are
  informational). A negative commission result is CS-Q7; tips and tip corrections never enter that carry (BR-06).
- A month whose statement was never generated is generated on first demand (review, the correction target, or the plan
  lock); a statement row costs nothing and simplifies the lock (D-3).
- The approver may approve on any day after the month ended; the 3rd and 5th are reminders, never deadlines (D-54).
- The REVIEWED → DRAFT return on any input change (D-5) is how SPEC §6 "a REVIEWED statement whose fingerprint changed
  returns to DRAFT" is implemented; the fingerprint comparison at approval is the second line of defence.
- Bell and reminder copy is proposed copy, fixed in the sub-PR that adds the template.
- Phase 1 has no production data; the bootstrap (50-3) still runs on staging before approval opens there, with its runbook count.
