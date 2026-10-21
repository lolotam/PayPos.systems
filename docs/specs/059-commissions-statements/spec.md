# Spec 059 — Commission plans, projection and statements (Phase 1 rows 48a–56b)

> **Status:** Draft · 2026-10-21 · docs-only PR. Owner questions are recorded in [owner-questions.ar.md](owner-questions.ar.md):
> the money list CS-Q1…CS-Q12 (Abu Salem, decisions page batch 36) is open; the permissions/technical list CS-Q13…CS-Q19 is
> answered by Waleed through his super agent (PP-17, 2026-10-21; CS-Q14, CS-Q15 and CS-Q16 against the recommendation),
> and its follow-ups: CS-Q20 (a branch manager's scope) answered (PP-20.1, the recommended option), CS-Q21 (erasing a
> frozen customer name) answered (PP-20.2, the recommended option). Every rule that waits on one is
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
earliest DRAFT month (SPEC §6); the October statement still says 35.000. November's statement shows them in its own corrections
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
| D-13 | **Correction target = the earliest DRAFT period after the source**, exactly as SPEC §6 says (a settled money rule): a REVIEWED month is skipped and keeps its review. The target is chosen from the statuses held under the locks **before** this event returns any REVIEWED month to DRAFT (FR-015 order), so a month the same event reopens is not a target of that event | retargeting into a REVIEWED month (would change which payroll month bears the correction without an owner answer) |
| D-14 | **"Lines without a performer" is satisfied by construction:** a line has 1…4 performers summing to 10000 (deferred consistency trigger, migration 0131). Approval still refuses if any projected ACTIVE line's rows do not sum to 10000 bps, as a defensive check of the projection | a second performer source in commissions |
| D-15 | **Bootstrap before approval opens** (ADR-0041 §6, spec 053 BR-08): tips from orders' `listCurrentSessionTips` (36-5); lines from an orders-owned paged reader of the latest line revision with its event ids, built in the same shape as 36-5 (new orders sub-PR 50-0); salaries from the ADR-0012 amendment backfill of unconsumed `SalaryChanged` outbox rows; package sales from an orders-owned paged reader of the latest entitlement revision with its event ids (`listCurrentPackageSales`, same shape as 36-5), which row 42 must ship with its producer. Every reader is bound to a commissions-owned port **at the composition root** (no module-map arrow); the design advisors confirm the line reader versus a controlled outbox replay before 50-0 | reading orders tables from commissions (ADR-0041 §6 forbids it) |
| D-16 | **Reads beyond SPEC §3's arrows** (the business timezone for "the period has ended", service names and customer full names for the statement detail and the export (CS-Q15), the owner and manager recipients of reminders and bells) use provider-owned readers bound to commissions-owned ports at the composition root, the BR-08 pattern; if one cannot be bound there, the sub-PR stops and adds an ADR and the module-map row first (IMPLEMENTATION-PLAN §4) | new import arrows by default |
| D-17 | **The engine moves to a new shared package, `packages/commissions-engine`** (CS-Q13 = PP-17.1): pure TypeScript whose only dependency is `packages/domain`, the same import rules as a module's `domain/` (CLAUDE.architecture.md §3.1), imported only by the `commissions` modules of `apps/api` and `apps/worker` (a `packages_restricted` entry in `docs/module-map.md`, enforced by the boundaries lint). **One exception:** a browser-safe subpath entry point, `packages/commissions-engine/validation`, exports only `validateCommissionPlan`, its error codes and the plan types (pure, no dependency beyond `packages/domain`, no Node-only code), and `apps/admin/src/commissions` may import that entry point and nothing else of the package, so the builder runs the same validator as the API (CM-06); the ADR and the boundaries rule of 59-0 name both the restriction and this exception. 59-0 writes its ADR (a new package, CLAUDE.md §11) and the CLAUDE.md §2.1 / module-map rows; 48a-1 creates the package and moves the engine and its tests unchanged. ADR-0035 stands: commission kinds stay out of `packages/domain` | running the consumer in the api process; copying the engine into the worker |
| D-18 | **The Excel export is a worker render** on the ADR-0049 transport (202 `{ render_id }`, poll, collect once, not stored), a new `kind` for the commission statement; the workbook is built with `exceljs` (already a dependency of `apps/api`), and generation over 200 ms never runs in a request (CLAUDE.md §6). An ADR-0049 addendum names the new kind | a synchronous download |
| D-19 | **Money:** `numeric(14,3)` in Postgres, `bigint` mills in TypeScript, KWD strings on the wire (ADR-0035, ADR-0041 §4); one `roundKwd` per source inside the engine (SPEC §5.2, ADR-0005); every total is a plain sum of rounded sources and is never rounded again (`TODO(spec)` CS-Q12 for cash) | rounding a total |
| D-20 | **Customer identity for the detail (CS-Q15):** the projection head keeps the event's `customer_id` (and `service_id`), and a line-sourced frozen statement row copies `line_id`, `session_id`, `service_id`, `customer_id` and `business_date`. While the month is open (DRAFT/REVIEWED) the customer's full name and the service names are read live by id through the readers bound at the root (D-16). **At approval they are frozen:** the line-sourced frozen row also stores `customer_name` and `service_name_ar`/`service_name_en` as read in the approval transaction, so an approved statement and every later export of it never change (BR-02, SPEC §6 "the frozen statement is never changed"). The name is the only personal data copied; no phone is ever read or stored here (SPEC §4). **Erasure (CS-Q21 = PP-20.2):** when a customer is erased, every frozen row that names her has **only** `customer_name` replaced by the fixed placeholder «عميلة محذوفة» / "Deleted customer", by one recorded operation (FR-034b); amounts, dates, services, ids and every other column stay as approved | reading names live for a closed statement (a renamed customer would change an approved export); resolving the line through orders (ADR-0041 §6 forbids commissions reading orders) |

## 3. Rules already settled (cited, not asked again)

| Rule | Source |
| --- | --- |
| The period is the calendar month in the business timezone; the manager reviews, the owner approves within the first five days, paid with the salary | D-17, SPEC §5 _Dates_ |
| Reminders to the owner on the 3rd and the 5th of the next month; reminders, not locks | D-54, SPEC §6 |
| Approval only after the month has ended; atomic; refused while commission events are pending, with the retryable 409 «updates are still being calculated, try again shortly» | SPEC §6, ADR-0012 §3/§5 |
| Review is bound to the inputs; the owner approves only the fingerprint that was reviewed | SPEC §6 |
| Closed means APPROVED or PAID; payment never stops corrections; the frozen statement never changes | SPEC §6 |
| A change to a closed month becomes corrections in the earliest DRAFT month after it, keyed `(source_period, employee, source_ref, generation)`, one signed delta per affected source, lines whose tier moved included | SPEC §6, M4 |
| A performer change after approval moves money as corrections: the removed performer's line goes down, the added one's goes up | spec 055 PF-Q3, SPEC M12 |
| Cancelling, editing the price of, or changing the performers of a line in an approved month is allowed within the recording window and becomes a correction; orders reads no statement status | CX-Q2, ED-Q3, PF-Q3, TP-Q2 |
| No plan or no salary is never a silent zero: recording continues, the estimate says "no plan", review and approval are refused; a disabled `package_sale` pays 0 | D-57, SPEC §5 |
| A late `NO_PLAN`/`NO_SALARY` change to a closed month is consumed, recorded as a blocked correction and repaired by an audited plan version scoped to that month (a missing salary is simply set) | SPEC §6, plan row 55b |
| Plan versions and overrides take `effective_from ≥ today`, or `whole_period` only while the month is DRAFT; base and tiers each switch on and off as a new version | SPEC §6, D-38, D-50 |
| Rounding: one `roundKwd` half away from zero per line or sale | SPEC §5.2/§5.5, ADR-0005 |
| Tips: per employee and method, outside net, thresholds and commission; card tips are a statement column paid with payroll, cash tips are informational; frozen as `TIP_CARD`/`TIP_CASH`; a tip changed in a closed month is a correction of kind TIP | D-36, SPEC §6, spec 053 |
| Package-sale commission follows the employee's plan; the salon's current plans pay none | spec 037 owner questions §3 («عمولة بيع الباكدج»), D-55 |
| Who sees commissions: the owner and the manager see all; employees and reception see their own | D-46; the exact permission and roles: CS-Q14 = PP-17.2 (§6 _Permissions_) |
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
  before submit (the same function, imported from `packages/commissions-engine/validation` by `apps/admin/src/commissions`, D-17;
  unit test over the full product, and a boundaries-lint test that the admin app imports nothing else of the package).
- **CM-07** An ordinary version with `effective_from` before today (business timezone) → 422
  `COMMISSION_EFFECTIVE_FROM_PAST`; a `whole_period` version whose own month is REVIEWED → 409 `COMMISSION_PERIOD_NOT_DRAFT`;
  whose own month is APPROVED or PAID, or with a closed month after it → 409 `COMMISSION_PERIOD_CLOSED`; a `whole_period`
  version for a DRAFT September while October is REVIEWED → accepted, and October returns to DRAFT in the same transaction.
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

- **CM-14** A `ServiceSessionRecorded` with two lines, one shared 50/50 by سارة and هبة: one line head (with the event's
  `customer_id` and `service_id`, D-20) and three performer rows;
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
- **CM-23b** (CS-Q20 = PP-20.1) ليلى, branch manager of السالمية, reads October: she sees سارة (attached to السالمية) with
  her full-month commission, including a line she performed in حولي, and does not see رنا (attached to حولي only); the
  business manager sees both; the export as ليلى contains سارة only.
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
- **CM-33b** (CS-Q18 = PP-17.6) The owner returns a REVIEWED October to DRAFT with the reason «خطة سوسن غلط»: status DRAFT,
  `reviewed_*` cleared, one return row holding the reason, one audit entry without it; an empty reason → 422
  `COMMISSION_RETURN_REASON_INVALID`; a DRAFT or closed statement → 409; a user with neither review nor approve → 403.
- **CM-33c** RLS (negative isolation): company B reads 0 of company A's `commission_statement_returns` rows, and inserting a
  return row for A's statement as B fails.
- **CM-33** Without `review:commissions:business` (default roles `TODO(spec)` CS-Q2) → 403. Whether the reviewer may also
  be the approver is `TODO(spec)` CS-Q3.

### Story 7 — Approve, atomically (53, P1)

- **CM-34** The owner approves October: in **one** transaction the start time is captured before the lock, the statement is
  locked, the month has ended, the status is REVIEWED, the current fingerprint equals `reviewed_fingerprint`, no blocking
  issue, no unresolved blocked correction, no projected line with shares ≠ 10000 (D-14), the ADR-0012 count is 0; then every
  `StatementLine` is frozen (one per employee × source: `COMMISSION`, `SALE`, `TIP_CARD`, `TIP_CASH`, `CORRECTION`, and one
  `EMPLOYEE` row per in-scope employee), the
  fingerprint is frozen as `input_fingerprint`, status APPROVED with approver and time, one audit entry.
- **CM-34c** An empty month approved: the business had two employees and no session, tip, sale or correction in October;
  approval freezes two `EMPLOYEE` rows (amount 0, frozen names and numbers) and nothing else; the statement view and the
  export list both employees with zero totals; an employee hired in November is not listed.
- **CM-34b** A company whose package sales are not yet covered by the 50-4 bootstrap (a sale whose applied revision is
  below the revision `listCurrentPackageSales` reports) cannot approve; nothing is frozen; after the bootstrap it can.
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
- **CM-46b** (FR-042) سارة has salary entries on 1 January (500.000) and 10 April (600.000); January and February are
  APPROVED, March is REVIEWED, April is DRAFT. A back-dated entry on 15 January (550.000) is the selected salary of
  January, February and March only: one transaction locks January…March (and the correction target April), posts
  corrections for January and February into April (the earliest DRAFT month: March was REVIEWED when the targets were
  chosen, D-13), returns March to DRAFT, and leaves April's own month unchanged; a
  later revision of the 15 January entry repeats the same range.
- **CM-46** A salary committed after approval → corrections on the lines whose threshold moved (SPEC §11); a tip changed in a
  closed month → a `TIP_CARD` or `TIP_CASH` correction for that `tip:<session>:<method>` source; raising a cash tip of a
  closed month changes no payable figure, raising a card tip does.
- **CM-47** A change to a PAID month posts a correction exactly like an APPROVED one (SPEC §11).
- **CM-48** The target closes while a correction is being posted (barrier): the writer rechecks under the target's lock,
  moves to the next DRAFT month and locks it (ascending order kept, SPEC §11); a REVIEWED month on the way is skipped.
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
- **CM-52b** A repair for an open `NO_PLAN` block whose recompute then needs a salary that is missing: the same open block's
  `code` becomes `NO_SALARY` (one row, not two), nothing is posted, and a later repair request is refused; any change to a
  resolved row is refused by the table's trigger.
- **CM-52c** The reverse: هبة's open September block is `NO_SALARY` (her plan from 15 September is salary-based); a late
  session dated 10 September arrives, then her salary is set: the recompute now returns `NO_PLAN` for the 10 September line,
  so the same open row's `code` becomes `NO_PLAN`, a repair is then allowed and resolves it.
- **CM-53** A `NO_SALARY` block is resolved by setting the salary for its date in staff (spec 021); the `SalaryChanged`
  recompute posts the correction and resolves the block; a repair request for a `NO_SALARY` block is refused.
- **CM-54** (CS-Q19 = PP-17.7) When a blocked correction is first recorded, one in-app bell reaches the holders of the plan
  permission (CS-Q1) in the business; with 250 holders, three events of 100, 100 and 50 distinct recipients are appended in
  the block's transaction, and a failure appending the third leaves no block and no event; a later event for the same open block rings nothing new; the block is always listed on
  the statement view of the target month as a blocking issue.

### Story 11 — Excel export (56, P2)

- **CM-55** Exporting approved October returns 202 `{ render_id }`; the worker builds the workbook from the **frozen** lines
  only; the file has the card-tips and cash-tips columns (D-36) and never a phone (SPEC §4); every download is audited
  (who, when, business, period). Its sheets and which statuses can be exported: `TODO(spec)` CS-Q10. The detail rows carry the
  customer's **full name** (CS-Q15 = PP-17.3), never her phone.
- **CM-55b** (D-20) Every line-sourced detail row of a frozen statement carries the `customer_id`, the customer's full name,
  the service names and the date frozen at approval, never a phone; after the customer's name is corrected in `customers`,
  a new export of the same approved statement still shows the name frozen at approval and identical amounts, while an open
  month's view shows the corrected name; the same holds for the employee's name and number renamed or renumbered after
  approval.
- **CM-55c** (CS-Q21 = PP-20.2) Erasing نورة after October was approved: every frozen October row naming her now shows
  «عميلة محذوفة», one audit entry is written without her old name, and the amounts, dates, services, ids and the export
  totals are bit-identical; a direct update of any other column of a frozen row, or of `customer_name` to any other
  value, is refused by the trigger.
- **CM-56** The amounts in the file equal the frozen statement bit for bit (KWD, three decimals, as text-safe numbers).

### Story 12 — Reminders (56b, P2)

- **CM-57** On the 3rd and on the 5th of November, if October is not APPROVED, one `StatementAwaitingApproval` request per
  statement per day reaches the approvers as an in-app bell at 09:00 business time (CS-Q17 = PP-17.5); none once it is
  approved; a rerun of the
  job the same day sends nothing new (ledger, SPEC §11 "reminders on the 3rd and 5th"). Never a lock (D-54).
- **CM-57c** A quiet business (no session, plan or generate in October) still gets its reminder on 3 November: the job
  creates October's DRAFT statement, writes the ledger row and the events in one transaction; a rerun that day adds
  nothing.
- **CM-57b** A company created after the release gets its scheduler from `CompanyCreated`; a company whose Redis schedule
  was lost gets it back on the next commission input delivery; an existing company gets it from the operator replay.
- **CM-58** (CS-Q16 = PP-17.4) On the 3rd, in the same 09:00 run as the owner's reminder, if October is still DRAFT one
  `StatementAwaitingReview` reaches the holders of `review:commissions:business`; none on the 5th; none if it is already
  REVIEWED or closed.

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
  REVIEWED → APPROVED → PAID, plus REVIEWED → DRAFT (D-5, and by hand FR-031). A `BEFORE UPDATE` trigger refuses every other
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
  only for a DRAFT period") when **that month is DRAFT** (its target month; REVIEWED → 409 `COMMISSION_PERIOD_NOT_DRAFT`,
  closed → 409 `COMMISSION_PERIOD_CLOSED`). Because the version then also applies from its date onward (`plan-version.ts`),
  every later month up to today is locked too: a later REVIEWED month returns to DRAFT in the same transaction (D-5), and a
  later closed month refuses the write with 409 `COMMISSION_PERIOD_CLOSED` (plan versions never reach a closed month, FR-043). This is how a `NO_PLAN` found after a month ended, before its approval, is fixed.
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
  and `PackageSaleChanged`. It prices with `packages/commissions-engine` (D-17).
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
  on read by a read-only use case (D-7), never stored. Permission `read:commissions:business` (CS-Q14 = PP-17.2; a branch manager's scope CS-Q20 = PP-20.1, §6 _Permissions_); the staff app's
  own estimate is row 57.
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
- **FR-028** Permission: `read:commissions:business` for `GET` (a branch manager sees her branch's employees only, CS-Q20 = PP-20.1); `review:commissions:business`
  for `generate`. Detail rows show the customer's full name (CS-Q15 = PP-17.3), read through the customers reader bound at
  the root (D-16) from the `customer_id` the projection head holds while the month is open, and taken from the names frozen
  in the statement rows once it is closed (D-20); never a phone.

### 52 — review-statement

- **FR-029** `POST …/:period/review` `{ expected_fingerprint }` (Idempotency-Key): under the lock, the month has ended, status
  DRAFT, no blocking issue, recomputed fingerprint = `expected_fingerprint`; set REVIEWED with `reviewed_fingerprint`,
  reviewer user and membership, time; audit `commission_statement.reviewed`.
- **FR-030** Emit `StatementAwaitingApproval` (SPEC §3) to notifications in the same transaction, recipients resolved by
  commissions (SPEC §3 "emitting modules put recipients and channels in the event"; in-app, CS-Q17 = PP-17.5). **Every
  notification event of this slice** (this one, the reminders of FR-053/FR-055 and the blocked-correction notice of FR-049)
  uses the same grouping: de-duplicated recipients, sorted by user id, consecutive groups of at most 100 (the
  `notificationRequest` cap, ADR-0037 §5), one event per group, all appended in the writer's transaction.
- **FR-031** (CS-Q18 = PP-17.6) `POST …/:period/return` `{ reason }` (Idempotency-Key): a holder of
  `review:commissions:business` or `approve:commissions:business` returns a REVIEWED statement to DRAFT under the lock,
  clearing `reviewed_*`; the reason is required (trimmed, 1…500 characters, else 422 `COMMISSION_RETURN_REASON_INVALID`)
  and is stored only in an insert-only `commission_statement_returns` row (statement, user, membership, reason, time),
  never in an event, audit text or log (the spec 055 D-7 rule); audit `commission_statement.returned`. Any other status →
  409 `COMMISSION_STATEMENT_NOT_REVIEWED`.

### 53 — approve-statement

- **FR-032** `POST …/:period/approve` `{ expected_fingerprint }` (Idempotency-Key), the ADR-0012 §3 transaction exactly:
  `transaction_timestamp()` captured before the lock → lock → recheck ended month, permission, status REVIEWED, fingerprint =
  `reviewed_fingerprint` = `expected_fingerprint`, no blocking issue, no unresolved blocked correction, D-14, **every
  bootstrapped input type (lines, tips, salaries, package sales) meets its coverage rule (D-15, FR-020)** → the count → freeze.
  The estimate and generate (50-5, 51-1) may ship before 50-4, because they freeze nothing; approval may not.
- **FR-033** Freezing writes `commission_statement_lines` (insert-only): per employee, one `COMMISSION` line per `line:<id>`
  source, one `SALE` per `sale:<id>`, one `TIP_CARD`/`TIP_CASH` per `tip:<session>:<method>`, one line per received
  correction (its own id as source) of kind `CORRECTION` (commission and sale corrections), `CORRECTION_TIP_CARD` or
  `CORRECTION_TIP_CASH`, so the payable figure can be computed from the frozen kinds alone; zero amounts are frozen too, so the frozen set equals the fingerprinted set.
  **Every in-scope employee gets one `EMPLOYEE` row** (`source_ref = employee:<id>`, amount `0.000`, never part of any
  total), even with no source at all: in scope means an employee of the business whose employment overlaps the month
  (hire date ≤ the last day, contract end and deletion, if any, ≥ the first day, read through `EmployeeDirectoryPort`) or
  who has any source or received correction in the month. It carries the frozen label, so an approved month always lists
  the same employees with their zero totals.
  **Every** frozen row also stores the employee's label as read in the approval transaction through
  `EmployeeDirectoryPort` (staff, ADR-0010): `employee_number` (row 8c), `employee_name_ar`, `employee_name_en`, so a later
  rename or renumbering of the employee never changes an approved statement or its export (D-20).
  A line-sourced frozen row also copies the line's detail identifiers from the projection head and the customer and
  service names read in the same transaction (D-20), so the frozen statement and its export never need orders, the live
  projection or a live name to say which visit, service and customer a row is.
- **FR-034** Status APPROVED, `approved_by`, `approved_at`, `input_fingerprint`; audit `commission_statement.approved` (SPEC §1:
  the approval actor and time are in the audit log).
- **FR-034b** (CS-Q21 = PP-20.2) Erasing a customer's name from approved statements: one internal use case,
  `erase-customer-name-in-statements(customer_id)`, in one transaction sets `customer_name` to the placeholder «عميلة
  محذوفة» / "Deleted customer" on every frozen row of that customer and writes one audit entry
  `commission_statement.customer_name_erased` (customer id, affected statements and row count; never the old name). No
  other column can change (the FR-033 grant and trigger). What calls it is a customer-erasure event owned by `customers`,
  which Phase 1 does not have yet: 53-2 ships the grant, the trigger and the use case with its test (CM-55c), and the event
  arrow is added with the erasure feature. Open months need nothing: they read the name live.
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
- **FR-042** Salaries: a salary entry `(employee, effective_from)` is the selected salary (SPEC §5.5) of **every month whose last
  day falls in `[effective_from, next_from)`**, where `next_from` is the employee's next later entry in the projection (open
  ended when there is none, up to the current month). A new entry or a new revision of one therefore affects that whole
  range, not one month. Under the identity lock of FR-015 the consumer computes the range from the locked projection, calls
  `lockStatementPeriods` for every month in it (plus the correction targets, ascending, one call), then for each month:
  an open month (DRAFT/REVIEWED) is refreshed (its estimate recomputes on read; REVIEWED returns to DRAFT, D-5) and a closed
  month (APPROVED/PAID) runs the correction step (FR-039) for that employee. The fingerprint of a month includes only its
  selected salary (§6 _Fingerprint_), so months outside the range do not change.
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
  every recompute of an open block (after a repair, a salary, or a later event) sets its `code` to what the engine now
  returns, `NO_PLAN` ↔ `NO_SALARY` either way, on the same row; a resolved row never changes); the plan is validated
  like FR-006; stored as a plan version with `repair_period` (D-12, CS-Q11); audit `commission_plan.period_repaired`. In the
  same transaction the month is recomputed and the correction posted (FR-039); the block is resolved when the recompute
  succeeds.
- **FR-048** A target month with an open blocked correction for any employee cannot be reviewed or approved (SPEC §6).
- **FR-049** The blocked correction is visible on the statement view and in a list `GET …/commission-blocked-corrections`
  (`queries/`). Notice (CS-Q19 = PP-17.7): when the consumer first records an open block it appends, in the same
  transaction, `CommissionCorrectionBlockedNoticeRequested` events to `notifications` (IN_APP, recipients the holders of the
  plan permission in the business, no amount and no customer data) in **groups of at most 100 recipients** (the
  `notificationRequest` cap, ADR-0037 §5): recipients de-duplicated by user id, sorted ascending, cut into consecutive
  groups, one event per group keyed `(block id, group index)`, all appended atomically with the block row (a failure rolls
  back the block and every group); a new commissions ⇒ notifications event row added by
  59-0. Permission for the repair: CS-Q1.

### 56 — Excel export

- **FR-050** `POST …/:period/exports` → 202 `{ render_id }` on the ADR-0049 transport (D-18); the worker document source reads
  the frozen statement under `withTenant`, closes the transaction, then builds the workbook; poll and collect once.
- **FR-051** Columns include, per employee: employee number (row 8c) and name, both taken from the frozen row (FR-033), commission, sales commission, corrections received,
  card tips, cash tips (informational), and the payable figure (CS-Q7); the content and states: CS-Q10; detail rows carry the customer's full name (CS-Q15 = PP-17.3).
  No phone ever (SPEC §4, R1).
- **FR-052** Audit `commission_statement.exported` on each collected download. Permission: `read:commissions:business` (CS-Q14; a branch-scoped holder exports only her branch's employees, CS-Q20 = PP-20.1).

### 56b — reminders

- **FR-053** Discovery follows ADR-0037: a worker `commissions` consumer of `CompanyCreated` upserts the BullMQ job scheduler
  `commissions-statement-reminders-<companyId>` (hourly, job data `{ companyId }` only, outside any transaction); every
  `commissions.project-inputs` delivery upserts the same scheduler (repair of a lost Redis schedule); existing companies get a
  one-time controlled operator replay of `CompanyCreated` after the worker rolls out (runbook). The job reads the
  company's businesses and their timezones under `withTenant` through the tenancy reader bound at the root (D-16) and,
  for each business whose local time has passed 09:00 (CS-Q17 = PP-17.5), emits `StatementAwaitingApproval` on
  the 3rd and the 5th for the previous month while it is not APPROVED or PAID. For each business, in **one** transaction, the
  job first calls `lockStatementPeriods` for the previous month, which **creates the DRAFT row if the business was quiet**
  (no input, no plan write, no generate) and locks it, then rechecks the status under the lock, then inserts the
  `commission_statement_reminders` ledger row (`UNIQUE (company_id, statement_id, kind, reminder_date)`, once per day) and
  the grouped notice events (FR-030); a business is never skipped for having no statement row. Zero recipients is a durable
  decision.
- **FR-054** Recipients and channels are put in the event by commissions (SPEC §3); until row 62 the interim rule is an
  in-app bell at 09:00 business time to the approvers (CS-Q17 = PP-17.5, the ADR-0037 precedent), and row 62 must list both
  kinds in its switches.
- **FR-055** (CS-Q16 = PP-17.4) `StatementAwaitingReview` is emitted by the same job on the 3rd only, in the same run as the
  owner's reminder, while the previous month is still DRAFT, to the holders of `review:commissions:business` (ledger kind
  `REVIEW_DAY3`). Both events are registered in `NOTIFICATION_SOURCE_EVENTS` and the worker's
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
the salary entry selected for the month's last day (SPEC §5.5), the plan versions and overrides that can apply in the month,
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
| `commission_line_heads` (50) | `line_id`, `session_id`, `branch_id`, `service_id`, `customer_id`, `revision`, `status`, `business_date`, `period` | `UNIQUE (company_id, line_id)`; `SELECT, INSERT, UPDATE` |
| `commission_lines` (50) | `line_id`, `branch_id`, `employee_id`, `service_id`, `occurred_at`, `recorded_at`, `business_date`, `period`, `net`, `net_share`, `share_bps`, `rule_kind`, `rule_value`, `counts`, `status` | `UNIQUE (company_id, line_id, employee_id)`; index `(company_id, business_id, period, employee_id)`; `SELECT, INSERT, UPDATE, DELETE` (a projection, D-11) |
| `commission_tip_heads` / `commission_tips` (50) | head: `session_id`, `revision`, `business_date`, `period`; rows: `session_id`, `employee_id`, `method`, `amount` | `UNIQUE (company_id, session_id)` / `UNIQUE (company_id, session_id, employee_id, method)`; projection grants |
| `commission_salaries` (50) | `employee_id`, `effective_from`, `amount`, `revision` | `UNIQUE (company_id, employee_id, effective_from)`; projection grants; never logged (SPEC §12) |
| `commission_sales` (50) | `sale_id`, `seller_employee_id NULL`, `business_date`, `period`, `price_paid`, `refunded_amount`, `status`, `revision` | `UNIQUE (company_id, sale_id)`; projection grants |
| `commission_statement_lines` (53) | `statement_id`, `employee_id`, `employee_number`, `employee_name_ar`, `employee_name_en` (the label frozen at approval), `source_ref`, `kind`, `amount`, `source_period NULL`, and for a line source (`COMMISSION`, or a `CORRECTION` of a `line:<id>`) the frozen detail `line_id`, `session_id`, `service_id`, `service_name_ar`, `service_name_en`, `customer_id`, `customer_name`, `business_date` (NULL otherwise; D-20; never a phone) | `UNIQUE (company_id, statement_id, employee_id, source_ref)`; insert-only except `UPDATE (customer_name)`, which a trigger allows only to the erasure placeholder (FR-034b); a trigger refuses an insert unless the statement is being approved in the same transaction |
| `commission_period_generations` (55) | `employee_id`, `period`, `generation` | `UNIQUE (company_id, employee_id, period)`; `SELECT, INSERT, UPDATE (generation)` |
| `commission_corrections` (55) | `employee_id`, `source_period`, `target_period`, `target_statement_id`, `source_ref`, `kind`, `amount` (signed), `generation`, `event_id`, `created_at` | `UNIQUE (company_id, source_period, employee_id, source_ref, generation)`; index `(company_id, business_id, target_period)`; insert-only |
| `commission_blocked_corrections` (55b) | `employee_id`, `source_period`, `code`, `first_event_id`, `created_at`, `resolved_at NULL`, `resolved_generation NULL` | partial `UNIQUE (company_id, employee_id, source_period) WHERE resolved_at IS NULL`; `SELECT, INSERT, UPDATE (code, resolved_at, resolved_generation)`; a trigger allows `code` to change (`NO_PLAN` ↔ `NO_SALARY`) only on an open row and refuses any change to a resolved row |
| `commission_statement_returns` (52) | `statement_id`, `returned_by`, `returned_membership_id`, `reason`, `returned_at` | `CHECK` reason 1…500 trimmed; insert-only; reason never logged |
| `commission_statement_reminders` (56b) | `statement_id`, `kind`, `reminder_date`, `recipient_count` | `UNIQUE (company_id, statement_id, kind, reminder_date)`; insert-only |

**Named isolation tests** (each in the sub-PR that creates its table, as part of that sub-PR's test subtask; company B
reads 0 of company A's rows and every insert or update of a row for A fails as B):

| Test | Table | Sub-PR |
| --- | --- | --- |
| CM-04 | `commission_statements` | 48a-2 |
| CM-R01 | `commission_plan_versions` | 48-1 |
| CM-R02 | `commission_service_overrides` | 49-1 |
| CM-R03 | `commission_line_heads`, `commission_lines` | 50-1 |
| CM-R04 | `commission_tip_heads`, `commission_tips`, `commission_salaries` | 50-2 |
| CM-R05 | `commission_sales` | 50-4 |
| CM-R06 | `commission_period_generations`, `commission_corrections` | 55-1 |
| CM-R07 | `commission_blocked_corrections` | 55-2 |
| CM-33c | `commission_statement_returns` | 52-1 |
| CM-R08 | `commission_statement_lines` | 53-2 |
| CM-R09 | `commission_statement_reminders` | 56b-1 |

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
| `read:commissions:business` | owner, general manager, business manager, accountant **and branch manager** (CS-Q14 = PP-17.2, against the recommendation); grantable | new; estimate of all employees, statement view, export. A branch-scoped holder sees her branch's employees only (CS-Q20 = PP-20.1, below) |
| `review:commissions:business` | `TODO(spec)` CS-Q2 | named by SPEC §6 |
| `approve:commissions:business` | owner (D-17, SPEC §11); grantable `TODO(spec)` CS-Q5 | named by SPEC §6 |
| `pay:commissions:business` | `TODO(spec)` CS-Q4 | named by SPEC §6 |

**Branch scope (CS-Q20 = PP-20.1):** a holder whose `read:commissions:business` comes only from a branch-scoped membership
  (the default branch manager) sees only the employees attached to that branch (an `EmployeeBranch` link to it on any day
  of the month, read through the staff reader bound at the root, D-16), each with her **full-month** figures, including
  lines she performed at another branch; other employees are absent, not zeroed. A business- or company-scoped holder sees
  every employee. The filter applies to the estimate, the statement view and the export alike.

All refused to devices; all behind the `commissions` feature (seeded flag, `packages/db/src/seed.ts`); each route has a guard
and a refusal test (CLAUDE.md §6).

### Error codes (`message_ar` / `message_en`, added to `src/shared/errors.ts`)

- `COMMISSION_PERIOD_CLOSED` 409 — «الشهر ده اتعمد خلاص، أي تغيير هيتسجّل تصحيح في الشهر الجاي.» / "This month is already
  approved; changes become corrections in the next month."
- `COMMISSION_PERIOD_NOT_DRAFT` 409 — «الشهر ده اتراجع، رجّعه للمسودة الأول.» / "This month has been reviewed; return it to
  draft first."
- `COMMISSION_PERIOD_NOT_ENDED` 422 — «الشهر لسه مخلصش.» / "This month has not ended yet."
- `COMMISSION_PLAN_INVALID` 422 — details `code` (the engine's validation codes, each with its own ar/en text).
- `COMMISSION_EFFECTIVE_FROM_PAST` 422 — «تاريخ البداية لازم يكون النهارده أو بعده.» / "The start date must be today or later."
- `COMMISSION_STATEMENT_BLOCKED` 422 — details `issues [{employee_id, code}]`.
- `COMMISSION_FINGERPRINT_STALE` 409 — details `current_fingerprint`.
- `COMMISSION_RETURN_REASON_INVALID` 422 — «اكتب سبب رجوع الكشف للمراجعة (لحد 500 حرف).» / "Enter the reason for
  returning the statement to review (up to 500 characters)."
- `COMMISSION_STATEMENT_NOT_REVIEWED` 409, `COMMISSION_STATEMENT_NOT_APPROVED` 409, `COMMISSION_STATEMENT_ALREADY_PAID` 409.
- `COMMISSION_UPDATES_PENDING` 409 — en: "updates are still being calculated, try again shortly" (ADR-0012 §5); ar:
  «لسه بنحسب آخر التحديثات، جرّب تاني بعد شوية.»
- `COMMISSION_REPAIR_NOT_ALLOWED` 422 — «مفيش تصحيح موقوف بسبب عدم وجود خطة للموظفة دي في الشهر ده.» / "There is no plan-missing blocked correction
  for this employee and month."
- Reused: `FORBIDDEN`, `FEATURE_DISABLED`, `IDEMPOTENCY_KEY_REUSED`, `IDEMPOTENCY_KEY_IN_PROGRESS`.

## 7. Delivery: the sub-PR split (owner rule 2026-10-12: at most three subtasks per PR)

Order: the ADR and the lock first; plan writers before the consumer; corrections (55, 55b) **before** approval (53), as plan
row 53's dependency on 55b and the round-4 finding #4 require. Sizes are hand-written lines including tests and copy.

| PR | Result | Subtasks | Blocked on | Size |
| --- | --- | --- | --- | --- |
| **59-0** | ADR and map, no behaviour | 1. ADR: the `packages/commissions-engine` package (D-17, CS-Q13 = PP-17.1) and its CLAUDE.md §2.1 / module-map rows, consumer id, root-bound readers (D-15/D-16), the read-use-case exception (D-7), the fingerprint. 2. `docs/module-map.md` rows and YAML. 3. ADR-0012 addendum (six types, D-9), ADR-0049 addendum (export kind), the `CompanyCreated` → worker `commissions` event row (FR-053) and the `CommissionCorrectionBlockedNoticeRequested` row (FR-049) | this spec; design advisors | 150–250 |
| **48a-1** | `packages/commissions-engine` (D-17) | 1. Package scaffold, `packages/domain` its only dependency, and the browser-safe `validation` entry point. 2. Move the engine and its tests unchanged. 3. Rewire the api imports; the boundaries rule (only the `commissions` modules may import it) and the module-map check | 59-0 | 150–300 (moves) |
| **48a-2** | Statements and the lock | 1. `commission_statements` + RLS + grants + FR-001 trigger + negative tests. 2. `lockStatementPeriods` + typed errors. 3. Lock tests CM-01…CM-04 and the FR-004 check | 48a-1 | 300–420 |
| **48-1** | Plan storage and contracts | 1. Zod contracts and OpenAPI. 2. `commission_plan_versions` + RLS. 3. The plan permission (CS-Q1) and its role defaults | 48a-2; CS-Q1 | 250–380 |
| **48-2** | Create and list plan versions | 1. Use case (FR-007/FR-008) and ports. 2. HTTP + list query + `EXPLAIN`. 3. CM-05…CM-08, CM-10 | 48-1 | 350–480 |
| **48-3** | The builder screen | 1. Blocks with switches, validated before submit through `packages/commissions-engine/validation` (D-17). 2. History list. 3. ar/en keys, component tests (CM-06 builder half, CM-09) | 48-2 | 300–450 |
| **49-1** | Overrides | 1. Contracts + table + RLS. 2. Use case + HTTP + list. 3. CM-11…CM-13 | 48-2 | 350–480 |
| **49-2** | Overrides screen | 1. Per-employee service table. 2. Edit dialog. 3. ar/en keys, component tests | 49-1, 48-3 | 200–320 |
| **50-0** | Orders line bootstrap reader (orders module) | 1. `queries/` latest line revision + event ids, keyset paging. 2. Public export in orders `index.ts`. 3. Shape, `EXPLAIN`, paging tests | 59-0; the design advisors' choice (D-15) | 200–300 |
| **50-1** | Line projection | 1. Line tables + RLS. 2. Consumer for the three line event types with guards, locks, mark (FR-015). 3. CM-14…CM-17, CM-21, CM-22, CM-26 | 48a-2, 48-2, 49-1 | 450–600 |
| **50-2** | Tips and salaries | 1. Tip and salary tables + RLS. 2. Their consumer handlers. 3. CM-18, CM-19, CM-25 (salary backfill) | 50-1 | 350–480 |
| **50-3** | Bootstrap | 1. Root bindings of 36-5 and 50-0. 2. The idempotent bootstrap job and the discharge of event ids. 3. CM-24 race and coverage tests, runbook | 50-1, 50-2, **36-5**, 50-0 | 300–420 |
| **50-4** | Package sales | 1. Sales table + RLS. 2. Handler and the root binding of `listCurrentPackageSales`. 3. CM-20, CM-20b (bootstrap, coverage, race) | 50-1; row 42 (producer with `business_date`, and its reader) | 250–380 |
| **50-5** | Estimate on read | 1. Input assembly (pure) and the read use case (D-7). 2. HTTP + permission (`read:commissions:business` with the branch scope of CS-Q20 = PP-20.1). 3. CM-23, CM-23b | 50-1, 50-2 | 300–420 |
| **51-1** | Generate and fingerprint | 1. Canonical input (pure) + hash port. 2. Generate/GET use cases and HTTP. 3. CM-27…CM-29 | 50-5 | 350–480 |
| **55-1** | Corrections | 1. Generation and correction tables + RLS. 2. The correction step in the consumer (FR-039…FR-042). 3. CM-43…CM-49 on seeded closed months (FR-044) | 51-1; CS-Q7, CS-Q8 | 450–600 |
| **55-2** | Blocked corrections and repair | 1. Blocked table + engine `repair_period` rule (D-12, CS-Q11). 2. Repair use case + HTTP + list, and the blocked-correction bell (FR-049: event contract, template, registrations). 3. CM-51…CM-54 | 55-1; CS-Q11 | 400–550 |
| **52-1** | Review | 1. Review use case + HTTP + REVIEWED→DRAFT on writers (D-5) + the return by hand (FR-031, `commission_statement_returns` + RLS). 2. `StatementAwaitingApproval` contract, template, registrations. 3. CM-30…CM-33, CM-33b, CM-33c | 51-1, 55-2; CS-Q2, CS-Q3 | 350–480 |
| **53-1** | The ADR-0012 count | 1. Role, function (six types), grants, policies, index. 2. Privilege inventory. 3. ADR-0012 §4 groups 1–4 and 7 (CM-39) | 59-0; design advisors | 350–500 |
| **53-2** | Approve | 1. Use case + freeze (FR-032…FR-034) with the bootstrap coverage check. 2. HTTP, permission (CS-Q5). 3. CM-34, CM-34b, CM-34c, CM-35, CM-37, CM-38, CM-55c (erasure, FR-034b) | 52-1, 53-1, 55-2, **50-3, 50-4** (D-15 coverage); CS-Q5 | 400–550 |
| **53-3** | Approval races and screens | 1. CM-36 barrier tests. 2. Statement screen (view, review, approve, blocking issues, corrections section CS-Q9), filtered to her branch's employees for a branch-scoped reader (CS-Q20 = PP-20.1). 3. ar/en keys, component tests | 53-2; CS-Q9 | 400–550 |
| **54-1** | Mark paid | 1. Use case + HTTP (CS-Q6). 2. Permission (CS-Q4). 3. CM-40…CM-42 and the screen button | 53-2; CS-Q4, CS-Q6, CS-Q12 | 250–350 |
| **56-1** | Excel export | 1. Worker document source and workbook (D-18). 2. Request/collect routes, audit. 3. CM-55, CM-56 | 53-2; 59-0's ADR-0049 addendum; CS-Q10, CS-Q12 | 350–480 |
| **56b-1** | Reminders | 1. Ledger table + RLS. 2. `CompanyCreated` scheduler registration and repair, the job and recipients (FR-053). 3. CM-57, CM-58, CM-57b, runbook replay | 52-1 | 300–420 |

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
- **SC-006** No customer phone and no salary appears in any log, export or event payload of this slice (SPEC §12); the
  customer's full name appears only in the statement detail and the export (CS-Q15), never in a log or an event.

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
