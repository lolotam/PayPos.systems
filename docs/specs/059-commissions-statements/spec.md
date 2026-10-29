# Spec 059 — Commission plans, projection and statements (Phase 1 rows 48a–56b)

> **Status:** Draft · 2026-10-21 · docs-only PR. Owner questions are recorded in [owner-questions.ar.md](owner-questions.ar.md):
> the money list CS-Q1…CS-Q12 (decisions page batch 36) and the money question CS-Q22 (batch 39) are all answered; **CS-Q27** (from Abu Salem's note on CS-Q1), **CS-Q28** (from CS-Q8) and **CS-Q29** (a negative card-tip side) were answered by Waleed (cards through his super agent, 2026-10-22, batch 46) and then by Abu Salem on the decisions page (2026-10-23): CS-Q28 and CS-Q29 the same, but **CS-Q27 differently, and his pick binds** (the owner and the accountant hold the plan permission by default; below). **CS-Q30** (batch 48: CS-Q9 against spec 060's MY-Q6) is answered by Waleed and Abu Salem alike: the employee sees full correction details like the manager, never the customer's name (card, 2026-10-22, PP-32.1; Abu Salem, 2026-10-23). **CS-Q4,
> CS-Q6…CS-Q12 and CS-Q22 were answered the same way by Waleed and Abu Salem on the decisions page (2026-10-22; the
> recommended options): CS-Q4** the pay permission goes to the owner, the general manager and the accountant, grantable;
> **CS-Q6** the payment method is picked from «مع المرتب» / «تحويل بنكي» / «كاش» with an optional note; **CS-Q7** a negative
> commission shows as negative, pays 0 and carries to next month's commission, card tips paid in full (a negative card-tip side pays 0 and carries to next month's card tips, CS-Q29); **CS-Q8** a departed
> employee's correction posts normally in the next statement under her name and shows to the owner in the final settlement;
> **CS-Q9** a separate section «تصحيحات شهور سابقة», one row per affected service; **CS-Q10** export only after approval, a
> summary sheet and a detail sheet; **CS-Q11** a repair plan prices only the days that had no plan; **CS-Q12** the payable
> is rounded to the nearest 5 fils when paid in cash; **CS-Q22** approval stays allowed after the 5th and the reminders on
> the 3rd and 5th stay. **CS-Q32** (batch 53, PP-37.1) is decided by Waleed and Abu Salem (2026-10-23, option 2, against the recommendation): after a Redis loss the worker rebuilds every company's reminder schedule by itself and clears the flag by itself only when the rebuild succeeds for every company; a rebuild that fails part-way leaves the flag open and `/ready` degraded, so a partial failure is never silent (Waleed's design note, relayed 2026-10-23, verbatim in owner-questions §32). It supersedes the manual parts of FR-053, D-24 and ADR-0054 §2; the contract the new ADR must define before 56b-1 is in FR-053 (_CS-Q32_). **CS-Q31** (the database role of the recovery-flag ledger, D-24) was decided by Waleed and Abu Salem on 2026-10-23 (the existing `pospay_dispatcher`, `SELECT` and `INSERT` on that table only; 56b-1 amends CLAUDE.md §5 and ADR-0003 to name the grant). CS-Q30 settles CM-50's employee view (full details, never the customer's name), CS-Q27 settles the plan permission (the owner and the accountant hold it by default, and only the owner grants or revokes it: Abu Salem, 2026-10-23, replacing Waleed's owner-only pick; FR-010), CS-Q28 (the final settlement) and CS-Q29 (the card-tip carry) are settled in FR-045 and §9. CS-Q12's storage is settled
> (D-19). CS-Q1 and CS-Q2 were answered by Abu Salem (below); CS-Q3 and CS-Q5 by Waleed through his super agent (2026-10-21, cards; still on batch 36, and Abu
> Salem's pick replaces them if it differs), and the follow-up CS-Q2b (who holds review by default, batch 42) by Waleed
> (PP-25.1, the recommended option). **Abu Salem answered on the decisions page (batch 36, 2026-10-22) and his pick binds**
> (CLAUDE.md §1 5b): **CS-Q1** «المالك بس.» (his note: «المالك مدير اداري و مالي و المحاسب مع امكانية اعطاء الصلاحيه»): the
> plan permission is held by the owner only by default and the owner may grant it (replacing Waleed's recommended
> «owner, general manager, business manager, grantable»), and his follow-up pick on CS-Q27 (2026-10-23) added the accountant as a default holder (the owner still alone grants or revokes it); **CS-Q2** the recommended option, which is what CS-Q2b already
> built (owner, general manager and business manager hold review by default; the owner grants it to anyone), so no rule
> moves; the permissions/technical list CS-Q13…CS-Q19 is
> answered by Waleed through his super agent (PP-17, 2026-10-21; CS-Q14, CS-Q15 and CS-Q16 against the recommendation),
> and its follow-ups: CS-Q20 (a branch manager's scope) answered (PP-20.1, the recommended option), CS-Q21 (erasing a
> frozen customer name) answered (PP-20.2, the recommended option), and the permissions question CS-Q23 (a mid-month
> branch transfer) answered (PP-21.2, the recommended option); its follow-up CS-Q24 (work done at another branch) answered (PP-22.1, the recommended option), and CS-Q25 (an employee attached to two branches at the same time) answered (PP-23.1, the recommended option). The permissions question CS-Q26 (whether a branch manager may review the business-wide statement) is answered (PP-24.1, the recommended option). Every rule that waits on one is
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
> consumer transaction) 53-1 (the definer function) and 53-2 (the carry ledger, D-22), as in spec 055 §7. **Done for 59-0 on
> 2026-10-22** (Codex `gpt-6-astra` medium and Claude Fable medium, both read-only); their agreed decisions are D-23…D-29 and
> the corrections they found (D-17, D-18, FR-053, §6 _Fingerprint_, FR-025, FR-032) are made in the same PR as
> [ADR-0054](../../adr/0054-commissions-engine-package-recovery-flags-and-read-path.md). The one point that needed the owners,
> **CS-Q31** (which database role writes the recovery-flag table), is decided (2026-10-23): the existing `pospay_dispatcher`, and 56b-1 amends CLAUDE.md §5 and ADR-0003. **CS-Q32** is decided (2026-10-23, Waleed and Abu Salem: fully automatic rebuild and clear), so 56b-1 starts with a new ADR.
> **Largest slice of Phase 1:** split into 27 sub-PRs of at most three subtasks each (§7, owner rule 2026-10-12).

## 1. What and why

Phase 1 replaces the salon's commission spreadsheet (SPEC §1). This slice turns the engine that already exists (pure
functions, rows 29/30) into the working month: the manager writes each employee's plan, the system keeps every input of the
month current from the orders and staff events, the employee's commission is visible as an estimate, the manager reviews
the month, the owner approves it once, someone records that it was paid, and anything that changes a closed month later
arrives as a correction in the earliest DRAFT month after it. Nothing in an approved statement ever changes, with one
controlled exception decided by the owner: if a customer is later erased, her frozen name is replaced by a placeholder
(CS-Q21 = PP-20.2, D-21).

**Worked example (salon «صالون الأميرة», `Asia/Kuwait`).** سارة is the hair specialist, salary 500.000. Her plan (D-55):
tiers on, MARGINAL, AMOUNT, one step from `SALARY_MULTIPLE 2.00` (1,000.000) at 5 %, no base. In October her net shares
add up to 1,700.000, so her commission is 5 % × 700.000 = **35.000**; customers also left her card tips of 6.000 and cash
tips of 4.000. On 1 November the business manager ليلى reviews October; on 3 November the owner approves it and the
statement freezes (commission 35.000, card tips 6.000, cash tips 4.000 for information); on 5 November it is marked paid.
On 10 November a manager cancels one of سارة's October lines worth 200.000 (allowed: the window reaches back to the first
day of the previous month, CX-Q2). October is closed, so the projection recomputes October with the line removed: 1,500.000
→ 25.000. The difference, **−10.000**, is posted as corrections (one per affected line, generation 1) into November, the
earliest DRAFT month (SPEC §6); the October statement still says 35.000. November's statement shows them in its own corrections
section «تصحيحات شهور سابقة» (CS-Q9) and they reduce what November pays (CS-Q7 if November ends negative).

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
| D-3 | **One lock helper** in `packages/db` (`lockStatementPeriods`): it creates the statement row of a period if absent (`INSERT … ON CONFLICT DO NOTHING`, with an id from the caller's injected `IdGenerator`, UUID v7, CLAUDE.md §4.3; the table has no id default), then takes `SELECT … FOR UPDATE` on the rows of the requested periods **in ascending period order**, and returns their status. Every writer of a period's inputs (the consumer, plan versions, overrides, period repair) and every status change (review, approve, pay) goes through it. A closed period refused by a writer raises the typed `StatementPeriodClosedError` (CLAUDE.md §5, PP-7.2) | an advisory lock (no row to recheck status on); a helper per module (the API and the worker both write periods) |
| D-4 | **The estimate is never stored** (SPEC §6). `generate-statement` persists only the statement row and its current fingerprint; statement lines are written **once**, frozen, by approval. The estimate and the DRAFT/REVIEWED view are the engine run on read over the projection | a stored DRAFT result that could drift from its inputs |
| D-5 | **Any applied input change returns a REVIEWED statement to DRAFT** under its lock (clears `reviewed_*`), in the same transaction as the change; a staff branch-attachment change is not a commissions input and takes no statement lock, so it is caught by the statement fingerprint instead (approval refuses with `COMMISSION_FINGERPRINT_STALE`, CM-32b); approval additionally recomputes the input fingerprint under the lock and compares it with `reviewed_fingerprint`, and after the freeze compares the statement fingerprint of the frozen rows with `reviewed_statement_fingerprint` (D-6) | comparing hashes only at approval (the screen would show "reviewed" for a statement that is no longer what was reviewed); the one accepted exception is a staff attachment change, which is not a commissions input: the view flags the statement as changed since review (statement fingerprint, CM-32b) and approval refuses it, so the reviewer returns it (FR-031) |
| D-6 | **Two fingerprints**, each SHA-256 over the canonical JSON (`packages/db` `canonicalJson`) (§6 _Fingerprint_). The **input fingerprint** (`current_fingerprint`, `reviewed_fingerprint`, `input_fingerprint`, the `expected_fingerprint` of the requests) hashes the period's ordered inputs; it is what a writer's change moves. The **statement fingerprint** (`reviewed_statement_fingerprint`, `statement_fingerprint`) hashes the rows approval freezes, built by **one** pure builder that the review and the freeze both use: review hashes the rows the builder would freeze, approval re-reads the rows it froze and hashes them in the same canonical shape. The frozen rows cannot reproduce the input fingerprint (they hold no revisions, rule snapshots, salary or plans), so the post-freeze check compares statement fingerprints only. Both input sets and the builder are pure functions; the hashing is an injected port (`domain/` imports nothing, CLAUDE.architecture.md §3.1) | one fingerprint for both (the frozen rows cannot reproduce the inputs, so every real approval would be refused, or the check would hash something other than what was reviewed); hashing inside `domain/`; a counter (does not detect a writer that forgot to bump it) |
| D-7 | **The estimate and statement views are read-only use cases**, not `queries/` files, because they must run the engine and `queries/` may not import `domain/` (CLAUDE.architecture.md §7.1). They read through ports, write nothing, and the ADR of 59-0 records this as the one read-path exception of the module. Plain lists (plan versions, overrides, corrections, blocked corrections) stay `queries/` with `EXPLAIN` tests | stored results (D-4); pricing in SQL |
| D-8 | **One consumer id, `commissions.project-inputs`,** for every input event type (ADR-0012 §1); its `consumed_events` mark commits in the same transaction as the projection change, the generation increment and the corrections, under the statement locks (SPEC §6). A stale-revision no-op still writes the mark (ADR-0012 §1) | one consumer per type (the approval count reads one id) |
| D-9 | **ADR-0012's counted types grow from four to six** in row 53: `ServiceSessionRecorded` and `ServiceSessionLinesAdded` join `ServiceLineChanged`, `PackageSaleChanged`, `SessionTipsChanged` and `SalaryChanged`, as ADR-0041 §6 requires. 53-1 ships the function with the six types and an ADR-0012 addendum | leaving initial recordings out of the gate (an unprojected recording would be approved as zero) |
| D-10 | **Revision guards per input identity:** a line `(line_id)` by its per-line `revision` (ADR-0041 §4: a newer `ServiceLineChanged` wins over a delayed revision-1 recording); tips by the per-session `revision` (spec 053); a salary by `(employee_id, effective_from)` and its per-entry `revision` (spec 021); a sale by `(sale_id, revision)` (SPEC §3). Older or equal revisions are no-ops | last-write-wins |
| D-11 | **A line is projected as one row per performer**, with `net_share` from the engine's `allocateLineShares` (floor, remainder mills by ascending `employee_id`, SPEC §5.2). A newer revision **replaces** every row of the line, so a performer change (spec 055) removes the old performers' rows and adds the new ones; money in events is a KWD string read with `parseMoney` (ADR-0041 §4) | storing the line once (the engine prices per performer) |
| D-12 | **Period repair** is a plan version marked `repair_period = 'YYYY-MM'` that applies **only inside that month** and is ignored for every other month; the engine's `selectCommissionPlanVersion` gains that rule (a new kind of version by decision, SPEC §5.7's last sentence, never an `if` in a caller). It prices only the days of that month that had no plan, and lines already priced with their plan keep it (CS-Q11) | reusing `whole_period` (it would also apply from its date onward, `plan-version.ts`) |
| D-13 | **Correction target = the earliest DRAFT period after the source**, exactly as SPEC §6 says (a settled money rule): a REVIEWED month is skipped and keeps its review. **Every candidate is locked before the choice:** the writer locks every month from the source month through the business's current month (the last month that can be DRAFT, since a month that has not ended cannot be reviewed), in the same single ascending `lockStatementPeriods` call as its other periods (D-3), and only then chooses, from the statuses that call returned; no status is read before its lock, so a REVIEWED month returned to DRAFT concurrently is either seen as DRAFT (its return committed first) or returned only after the correction commits (the return waits on the lock). The target is chosen **before** this event returns any REVIEWED month to DRAFT (FR-015 order), so a month the same event reopens is not a target of that event | retargeting into a REVIEWED month (would change which payroll month bears the correction without an owner answer) |
| D-14 | **"Lines without a performer" is satisfied by construction:** a line has 1…4 performers summing to 10000 (deferred consistency trigger, migration 0131). Approval still refuses if any projected ACTIVE line's rows do not sum to 10000 bps, as a defensive check of the projection | a second performer source in commissions |
| D-15 | **Bootstrap before approval opens** (ADR-0041 §6, spec 053 BR-08). **Decided 2026-10-25 (the design-advisor call this row asked for; Codex `gpt-6-astra` advice): option B, a controlled outbox replay, not an orders line reader.** Lines and salaries: the retained original events `ServiceSessionRecorded`, `ServiceSessionLinesAdded`, `ServiceLineChanged` and `SalaryChanged` are replayed, in order, to the `commissions.project-inputs` consumer alone, through a bounded, typed replay facade in `packages/db` built on the pattern of `serviceSessionReplayPage` / `readServiceSessionReplayPage` (`packages/db/src/dispatcher.ts`; sub-PR 50-0). ADR-0041 §6 already allows "a controlled replay of retained recording/append/changed-line events to its consumer". The facade reads through `createOutboxDispatcherDatabase` as `pospay_dispatcher` (company-qualified, UUID checkpoint, fixed upper bound, the outbox primary key); each event's effect and its `consumed_events` mark run through `pospay_app` `withTenant` (the `createDeliverer` / `markEventConsumed` path), and no query joins `consumed_events` on the dispatcher side. **No provenance column, no new `SECURITY DEFINER` function, no new grant, no `BYPASSRLS`; the only schema change is an index (50-0).** Tips stay on orders' `listCurrentSessionTips` (36-5). Package sales stay on an orders-owned paged reader of the latest entitlement revision with its event ids (`listCurrentPackageSales`, same shape as 36-5), which row 42 must ship with its producer. The tips and package-sales readers are bound to commissions-owned ports **at the composition root** (no module-map arrow); the replay needs no port. The salary replay is the executable form of the ADR-0012 amendment backfill of 2026-10-08 (that amendment only stated the obligation; no backfill function exists yet) | reading orders tables from commissions (ADR-0041 §6 forbids it); **(A)** an orders-owned line reader with stored event ids: it needs a provenance column or a narrow definer plus an ADR, a column on the current line row would not cover older events, and edit events get an independent id from `ids.newId()` (`edit-service-line-price.usecase.ts`), so the ids cannot be recovered from the row; **(C)** a line reader without event ids: it can build a correct projection but cannot discharge the event ids, and a published `ServiceSessionRecorded`/`ServiceSessionLinesAdded` without a `commissions.project-inputs` mark keeps approval closed forever (D-27, ADR-0012 §1) |
| D-16 | **Reads beyond SPEC §3's arrows** (the business timezone for "the period has ended", service names and customer full names for the statement detail and the export (CS-Q15), the owner and manager recipients of reminders and bells, and the employee's business and dated branch attachments from staff for the branch split, FR-018b and FR-033) use provider-owned readers bound to commissions-owned ports at the composition root, the BR-08 pattern; if one cannot be bound there, the sub-PR stops and adds an ADR and the module-map row first (IMPLEMENTATION-PLAN §4) | new import arrows by default |
| D-17 | **The engine moves to a new shared package, `packages/commissions-engine`** (CS-Q13 = PP-17.1): pure TypeScript whose only dependency is `packages/domain`, the same import rules as a module's `domain/` (CLAUDE.architecture.md §3.1), imported only by the `commissions` modules of `apps/api` and `apps/worker` (a `packages_restricted` entry in `docs/module-map.md`, enforced by the module-map check for the modules of `apps/api` and `apps/worker`, and by an ESLint `no-restricted-imports` scope for every other file, D-23). **One exception:** a browser-safe subpath entry point, `packages/commissions-engine/validation`, exports only `validateCommissionPlan`, its error codes and the plan types (pure, no dependency beyond `packages/domain`, no Node-only code), and `apps/admin/src/commissions` may import that entry point and nothing else of the package, so the builder runs the same validator as the API (CM-06); the ADR names both the restriction and this exception (the module-map check cannot see `apps/admin`, so the exception is a lint rule). 59-0 writes its ADR (a new package, CLAUDE.md §11), the CLAUDE.md §2.1 row and the module-map row; 48a-1 creates the package, moves the engine and its tests unchanged and delivers the enforcement (D-23). ADR-0035 stands: commission kinds stay out of `packages/domain` | running the consumer in the api process; copying the engine into the worker |
| D-18 | **The Excel export is a worker render** on the ADR-0049 transport (202 `{ render_id }`, poll, collect once, not stored), a new `kind` for the commission statement; the workbook is built with `exceljs` (in the stack of `docs/06_Tech_Stack_Architecture_EN.md`, but only `apps/api` lists it today: 56-0 or 56-1 adds it to `packages/documents`, which owns Excel rendering, CLAUDE.md §2.1, and stays a dependency of the worker only; the commissions module never imports that restricted package, so the workbook renderer is injected at `apps/worker/src/main.ts` like the PDF renderer and 56-0 fixes the seam), and generation over 200 ms never runs in a request (CLAUDE.md §6). Today every document source returns HTML that the worker sends to the PDF renderer (`apps/worker/src/documents/source-registry.ts`, `process-job.ts`), so sub-PR 56-0 first generalizes that contract to binary output: a source declares its output (HTML → PDF, or bytes with a MIME type), the xlsx kind has **no** HTML → PDF step, its MIME type is `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, its size cap is 8 MiB (the ADR-0049 PDF cap; larger → `DOCUMENT_TOO_LARGE`), and its bytes use the same tenant-prefixed Redis store and collect-once `GETDEL` as the PDF (ADR-0049 §1, PP-6.1). **Admission is per kind:** ADR-0049 §3.6's `503 RENDERER_UNAVAILABLE` (the API checks the Chromium liveness key before queuing) applies only to kinds that declare the PDF renderer; a bytes kind such as xlsx is queued and built while Chromium is down. An ADR-0049 addendum (in 59-0) records the binary-output contract and the new kind. **Correction found by the design advisors (D-28):** "queued and built while Chromium is down" is false as the worker is written today, because the BullMQ Worker opens only after the renderer starts and `process-job.ts` checks `renderer.isAvailable()` before any source loads, so with Chromium down no consumer exists for any kind. 56-0 therefore also opens the Worker independently of the renderer, checks `isAvailable()` only on the PDF branch, and keeps the kind → output map in `packages/contracts` (`kind` is a free string there today) so the API's admission can read it without the worker's registry | a synchronous download; converting the workbook through the PDF path |
| D-19 | **Money:** `numeric(14,3)` in Postgres, `bigint` mills in TypeScript, KWD strings on the wire (ADR-0035, ADR-0041 §4); one `roundKwd` per source inside the engine (SPEC §5.2, ADR-0005); every total is a plain sum of rounded sources and is never rounded again, except that the payable figure is rounded to the nearest 5 fils when the statement is paid in cash (CS-Q12). **Technical decision (orchestrator, 2026-10-22):** the rounded payable amount is stored per employee, beside her exact payable, on the payment record written atomically by mark-paid (FR-037); the statement's paid total is the sum of the employees' rounded amounts, never a rounding of the business total; the exact payable figure and every frozen line stay unrounded; a tie rounds half up to the nearest 0.005 KWD | rounding a total |
| D-20 | **Customer identity for the detail (CS-Q15):** the projection head keeps the event's `customer_id` (and `service_id`), and a line-sourced frozen statement row copies `line_id`, `session_id`, `service_id`, `customer_id` and `business_date`. While the month is open (DRAFT/REVIEWED) the customer's full name and the service names are read live by id through the readers bound at the root (D-16). **At approval they are frozen:** the line-sourced frozen row also stores `customer_name` and `service_name_ar`/`service_name_en` as read in the approval transaction, so an approved statement and every later export of it never change (BR-02, SPEC §6 "the frozen statement is never changed"). The name of the branch where the work was done is frozen the same way (CS-Q35 = PP-80.1, both owners: freeze): every row with a `source_branch_id` also stores `source_branch_name_ar`/`source_branch_name_en` as read in the approval transaction, and the export reads them from the row, never from the live branch (sub-PR 56-1b-fz, which replaced 56-1b's live read). The customer name is the only personal data copied; no phone is ever read or stored here (SPEC §4). Erasure: D-21 | reading names live for a closed statement (a renamed customer would change an approved export); resolving the line through orders (ADR-0041 §6 forbids commissions reading orders) |
| D-21 | **Customer erasure (CS-Q21 = PP-20.2), recorded now, built later.** The owner decided that when a customer is erased, every frozen statement row naming her has **only** its customer name replaced by a placeholder, by a recorded operation, and amounts, dates, services and ids never change. This is the **one controlled exception** to BR-02 and SC-002. Phase 1 has no customer-erasure feature, so this slice designs none of its mechanics; they are one deferred item, **«with the customer-erasure feature»** (§7 _Deferred_). Until then frozen rows are insert-only with no exception | designing the erasure use case, trigger and event inside this slice without the feature that drives them |
| D-22 | **Carries are a ledger, not a statement line written early** (MergePilot and Codex on #482). Approving a month (53-2), in its own transaction, writes one `commission_carries` row per employee and kind whose balance is negative: `COMMISSION` for a negative commission subtotal (CS-Q7), `TIP_CARD` for a negative tip side (CS-Q29), amount = that balance. Its target is chosen exactly as a correction's (D-13): the earliest DRAFT period after the source, every candidate locked first in the same `lockStatementPeriods` call, and the write applies D-5 to that target. A target statement takes **every** carry row whose `target_statement_id` is its own, whatever the source month (a late-approved October whose carry lands in December still counts), into its estimate, its fingerprint and its freeze, where each becomes a `CARRY_COMMISSION` or `CARRY_TIP_CARD` line (`source_ref = carry:<source_statement_id>:<kind>`, `source_period` = the source month, `source_branch_id` and `source_business_date` NULL, `attached_branch_ids` empty: a carry is the employee's whole-business balance and belongs to no branch day, so under CS-Q23 only a business-wide reader sees it and a branch reader's partial subtotal leaves it out; an employee in scope only through a carry, such as one who left, therefore shows to business-wide readers, who settle it). **A departed employee is not re-carried** (CS-Q8, CS-Q28): when her employment does not overlap the target month, her carry still lands there and shows among her flagged «سابت الشغل» rows as owed by her, the target's own negative balance for her writes no new carry, and the owner settles it outside the system | a frozen line written into an open month (breaks D-4); carries selected by the previous calendar month (misses a late-approved month's carry); rolling a departed employee's debt forward forever |
| D-23 | **D-17's enforcement, in three layers** (design advisors, 59-0): (a) `packages_restricted: commissions-engine: [commissions]` in `docs/module-map.md` §6, which the module-map check matches by module name, so one entry covers the api and the worker; its check sees only files under `apps/*/src/modules/<module>`, so it cannot see `apps/admin`, `apps/api/src/shared`, `apps/worker/src/documents` or `packages/*`; (b) ESLint `no-restricted-imports`: the package is refused everywhere, the ban sits in every block that sets the rule and only the commissions `use-cases/`, `ports/` and `persistence/` blocks lift it (the layers CLAUDE.architecture.md §3.1 lets import a module's own `domain/`), and `apps/admin/eslint.config.js` lets `src/commissions/**` import exactly `@pospay/commissions-engine/validation` (ADR-0054 §1); (c) the package's `exports` lists only `.` and `./validation`, no wildcard. 59-0 declares the module-map row; 48a-1 delivers (b), (c), the admin lint test and the extension of the `lint:docs` JSDoc rule to the package. A commissions module's `domain/` can never import the package (its eslint rule allows only `@pospay/domain`), so 48a-1 leaves that folder empty and changes no regex | exempting `domain/` from the rule (the module's domain ring would no longer be pure); trusting `exports` alone (it does not say who imports) |
| D-24 | **`operational_recovery_flags` is an append-only ledger, not a row per code** (FR-053): `(id, code, raised_at, cleared_at, cleared_by)`, a partial `UNIQUE (code) WHERE cleared_at IS NULL`, `CHECK ((cleared_at IS NULL) = (cleared_by IS NULL))`. The worker raises and lists through `pospay_dispatcher` and its existing facade (`createOutboxDispatcherDatabase`): `SELECT, INSERT` on the table only, no `UPDATE`/`DELETE`/`TRUNCATE` for any runtime role, nothing for `PUBLIC`, nothing for `pospay_app`. Clearing is an owner-role operator script that names the incident id and writes `platform_audit_log` in the same transaction. **CS-Q31 (decided, Waleed and Abu Salem, 2026-10-23, batch 51):** the existing `pospay_dispatcher` holds `SELECT` and `INSERT` on this table only, and the clear is a manual command run by the database owner; the grant extends CLAUDE.md §5's dispatcher sentence and ADR-0003, so 56b-1 amends both in its own PR to name it (59-0 changes neither text). **CS-Q32 (decided 2026-10-23) moves the clear to the worker:** the new ADR before 56b-1 adds the narrow clear privilege, the incident-and-generation guard and the bounded retry (FR-053 _CS-Q32_); the owner-role script stays only as the fallback | a code primary key with a mutable `cleared_at` (the runtime could clear its own alarm); a grant to `pospay_app` (a no-RLS writable table on every tenant path, and a context-free entry point in `packages/db` is the forbidden fifth way); a new role now (a pool, an env URL, a deploy secret) |
| D-25 | **The read use cases are two named folders**, `use-cases/get-commission-estimate/` and `use-cases/get-statement/` (D-7): reader ports only (no write method, never a repository, an outbox writer or an `IdGenerator`), no statement row created, no lock, no audit or outbox write, and an adapter transaction that is `READ ONLY` (a `{ readOnly: true }` option of `withTenant`, added by 50-5). Gates: a constructor-surface unit test of each and the after-call database assertion of CM-28b; the `use-cases/` lint rule alone is not enough because a port can still write. CLAUDE.md §6 and CLAUDE.architecture.md §7 point to ADR-0054 §5 | a general permission for reads in `use-cases/`; reads in `queries/` (they may not import `domain/`) |
| D-26 | **Both fingerprint builders are pure functions in `packages/commissions-engine`**, beside FR-022's assembly. The hash is a port in the module's `ports/` taking the structured JSON value (`hash(value) → hex`); one `persistence/` adapter implements it with `canonicalJson` from `packages/db` and SHA-256, because a use case may not import `@pospay/db`. The builders emit KWD strings and ISO dates only (`canonicalJson` rejects bigint and non-plain objects). Approval calls the statement builder **once** per transaction and feeds both the pre-freeze comparison and the freeze insert from that result. When both fingerprints differ the 409 cause is `INPUTS`. 51-1 fixes the full canonical contract (every list's fields, null handling, tie order, date formats, and every input the engine reads, such as a sale's `business_date` and status) and proves it with CM-34e | hashing in `domain/`; building the rows twice under READ COMMITTED |
| D-27 | **ADR-0012 grows by an addendum, not a new ADR** (D-9): §1 counts six types, §3 gains the post-freeze statement-fingerprint comparison, §4 group 3 uses six types; §2 and the group 7 index are unchanged. Publishing the two new session types before 53-1 breaks nothing (approval is not available). After 53-1 every `ServiceSessionRecorded`/`ServiceSessionLinesAdded` row published before 50-1 without a `commissions.project-inputs` mark counts as pending forever, so the `SalaryChanged` discharge obligation extends to them: 50-3's bootstrap (D-15, CM-24) discharges their event ids, the outbox rows are kept, no placeholder mark is written | a new ADR for a wording change; a placeholder consumer mark |
| D-28 | **ADR-0049 grows by an addendum** (D-18): output is a discriminated type per kind (HTML for the PDF renderer, or bytes plus a MIME type); the reply's MIME type and file name come from the kind; the 503 `RENDERER_UNAVAILABLE` admission applies to PDF kinds only; the kind → output map lives in `packages/contracts`; the Worker opens independently of Chromium and `isAvailable()` is checked only on the PDF branch (see D-18's correction); the ADR's Consequences line that leaves Excel to Phase 5 is amended for this kind | a second transport for bytes |
| D-29 | **59-0 edits `docs/module-map.md` in two places only:** the `packages_restricted` row (and the generated YAML) and §3 prose Port rows for the root-bound readers. A `reads:` line needs an adapter file (`module-map.mjs`), and a root-bound read adds no import arrow (D-16), so no `reads:` line is added by any sub-PR that only binds a reader at the root | writing `reads:` lines for readers that import nothing |

## 3. Rules already settled (cited, not asked again)

| Rule | Source |
| --- | --- |
| The period is the calendar month in the business timezone; the manager reviews (review is held by default by the owner, the general manager and the business manager, and the owner grants or revokes it for anyone else, CS-Q2 and CS-Q2b = PP-25.1), the owner approves within the first five days, paid with the salary (after day 5 approval stays allowed and the reminders on the 3rd and 5th stay: CS-Q22) | D-17, SPEC §5 _Dates_ |
| Reminders to the owner on the 3rd and the 5th of the next month; reminders, not locks | D-54, SPEC §6 |
| Approval only after the month has ended; atomic; refused while commission events are pending, with the retryable 409 «updates are still being calculated, try again shortly» | SPEC §6, ADR-0012 §3/§5 |
| Review is bound to the inputs; the owner approves only the fingerprint that was reviewed, and the rows frozen are the rows that were reviewed | SPEC §6 |
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
| The permission strings of the statement flow: `review:commissions:business`, `approve:commissions:business`, `pay:commissions:business` | SPEC §6 (their default roles: approve is the owner by default and granted by the owner, CS-Q5; review is held by default by the owner, the general manager and the business manager and granted by the owner, CS-Q2 and CS-Q2b = PP-25.1; pay is held by default by the owner, the general manager and the accountant and grantable to anyone, CS-Q4) |
| The success criterion: the approved statement matches the manager's hand calculation to 0.001 KWD for every employee in the parallel month | SPEC §1, D-45 |

## 4. User scenarios and acceptance criteria _(mandatory)_

Named tests; each is an integration test against real Postgres (T2 stack, ADR-0006) unless marked unit. People as in §1;
أبو سالم is the owner, ليلى the business manager, هبة a second employee, منى the cashier.

### Story 1 — One lock for every writer of a month (48a, P1)

- **CM-01** `lockStatementPeriods(tx, { businessId, periods: ['2026-10'], ids })` on a month with no statement creates one DRAFT row and locks it;
  two concurrent callers create exactly one row (unique `(company_id, business_id, period)`), the second waits. The new
  row's id is the one the caller's injected `IdGenerator` returned (a fake generator in the test), and the migration
  declares no default on `commission_statements.id`.
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
- **CM-10** Without the plan permission (CS-Q1 and CS-Q27, Abu Salem: the owner and the accountant by default, or whoever the owner granted) → uniform 403, nothing written; a device → 403.

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
- **CM-22a** A crash between the projection write and the `consumed_events` mark leaves neither; the redelivered event
  projects once (50-1, before corrections exist).
- **CM-22b** A bootstrap page and a live delivery of the same line race (barrier): revision 2 commits first and the
  waiting revision-1 writer, rechecking under the identity lock, applies nothing and only marks its event consumed;
  the same test for a tip session, a salary entry and a sale.
- **CM-23** The estimate equals `computePeriod` over the DRAFT projection for every employee (SPEC §11); an employee with
  no applicable version shows `NO_PLAN`, with a salary-multiple plan and no salary `NO_SALARY`, never zero (D-57).
- **CM-23c** (CS-Q23 = PP-21.2) سارة is transferred from السالمية to حولي on 15 October: in ليلى's session (السالمية) the
  estimate, the statement view and the export show only سارة's 1–14 October lines, tips and sales (including one she
  performed at حولي on 10 October, shown with its place حولي); in هند's session (حولي) only her 15–31 October ones; neither
  sees the other part, each subtotal is labelled partial, and
  the business manager sees the whole month with its full total. **After approval** the same split holds on the closed
  statement and in its export, filtered only on the frozen `attached_branch_ids`: ليلى sees only the 1–14 October part
  (corrections of those lines included), هند only the 15–31 October part, even if `EmployeeBranch` or the projection is
  edited after approval (for example the transfer date moved to 20 October). Then a 17 October line is cancelled: its
  correction copies `attached_branch_ids` = {حولي} from the frozen October row (not السالمية, which the edited link would
  now give) and lands in هند's part of November; a second correction of the same line copies the same values.
  **Shared line:** the 17 October line was shared by سارة and رنا, and after approval رنا is replaced by هبة (spec 055):
  رنا's negative correction copies her own frozen row (matched on `(2026-10, رنا, line:<id>)`), هبة, who has no frozen
  row for it, gets her branches once from October's frozen attachment snapshot, and a later correction of هبة's share copies those.
  **Late source:** October was approved with the transfer on 15 October; after approval the transfer is moved to 20
  October, and only then a 17 October line of سارة arrives for the first time (never frozen): its correction takes
  `attached_branch_ids` = {حولي} from October's frozen attachment snapshot, not {السالمية} from the edited link, and
  lands in هند's part of November.
- **CM-23b** (CS-Q20 = PP-20.1) ليلى, branch manager of السالمية, reads October: she sees سارة (attached to السالمية for all
  of October) with her full-month commission (the per-day rule with an attachment covering the whole month), including a line she performed in حولي, and does not see رنا (attached to حولي only); the
  business manager sees both; the export as ليلى contains سارة only. After approval the same holds on the closed statement
  and its export, filtered on the frozen `attached_branch_ids` (the حولي line stays in ليلى's view, shown with its place
  حولي), even if سارة's `EmployeeBranch` is edited after approval.
- **CM-23d** (effective branch set, union) the business has three branches (السالمية, حولي, الفروانية) and ليلى holds
  two branch-manager memberships, السالمية and حولي: the estimate, the
  statement view and the export show سارة's whole October (both parts, the total not labelled partial) and رنا, the union
  of the two branches and not one of them; the export request row stores `scope = BRANCHES`, `branch_ids` = {السالمية, حولي}. Had the
  business only those two branches, she would still be branch-scoped (CM-23g).
- **CM-23g** (Codex 4335642039) The business has only السالمية and حولي, and ليلى holds the two branch-manager memberships
  (branch-scoped grants only), so her _R_ is every branch. She is **not** a business-wide reader: the overlap filter still
  applies, a frozen row or a correction whose `attached_branch_ids` is empty (an employee with no frozen interval on that
  date, FR-040) is absent from her statement view, estimate and export, and her export request stores `scope = BRANCHES`
  with `branch_ids` = {السالمية, حولي}. The business manager with a business-scoped grant and no DENY sees that row and
  exports with `scope = BUSINESS`; given a DENY on حولي she is filtered on _R_ = {السالمية} and the empty-set row
  disappears from her view too.
- **CM-23f** (CS-Q25 = PP-23.1) رنا is attached to السالمية and حولي for all of October: ليلى (السالمية) and هند (حولي)
  each see رنا's whole October in the estimate, the statement view and the export, with the full total, not labelled
  partial; a branch manager of الفروانية does not see her.
- **CM-23h** (the one rule, PP-21.2 + PP-22.1 + PP-23.1; Codex 4335750352) رنا is attached to السالمية all of October,
  and حولي is added to her from 15 October while السالمية stays: her rows dated 1–14 carry {السالمية}, those dated 15–31
  {السالمية, حولي}. ليلى (السالمية) sees her whole October, unlabelled; هند (حولي) sees only 15–31 October, wherever the
  work was done, labelled partial, with the amounts of the full-month run; the export of each matches her view, before
  and after approval (the closed month filters on the frozen `attached_branch_ids`).
- **CM-23e** (DENY wins) the business manager holds a business-wide `read:commissions:business` and a DENY of it on حولي:
  the estimate, the statement view and the export no longer show رنا nor سارة's 15–31 October part (her 1–14 part is
  labelled partial), and no customer name of a حولي-attached row appears; the export request stores `scope = BRANCHES`
  with every branch but حولي. A DENY on the whole business leaves her set empty: every read is the uniform 403, not an
  empty list.
- **CM-24** Bootstrap (D-15): tips recorded before the consumer existed are projected from the 36-5 reader, and lines saved
  before it existed are replayed from the retained outbox events through the 50-0 facade; a live event of the same or a lower
  revision is then ignored; a revision written between a page read and the first live delivery still ends in the
  projection; the tips reader's event ids are discharged in `consumed_events`, and each replayed line event gets its
  consumer mark through the normal `markEventConsumed` path, whether it was published or not; approval stays closed
  until both coverage conditions of spec 053 BR-08 hold (TP-15 race test, and the same test for lines). The two
  replay-specific must-handle items (the all-replica rollout and line coverage) are listed in the 50-3 row.
- **CM-25** Salary backfill (ADR-0012 amendment; 50-2 tests the handler half, applied once and idempotent, and 50-3 tests the replay run through the 50-0 facade): a `SalaryChanged` published before the consumer existed (and before 21-a,
  so without `business_id`) is applied once to the employee's business (FR-018b);
  a repeated backfill adds nothing; a failed projection leaves its mark absent.
- **CM-26** The business-date boundary: a line at 21:30 UTC that is the next day in Kuwait belongs to the next month
  (SPEC §5 _Dates_); the consumer uses the event's `business_date` and never converts an instant itself.

### Story 5 — Generate the statement and its fingerprint (51, P1)

- **CM-27** After 31 October has ended in the business timezone, ليلى generates October: the DRAFT row exists, the view
  shows per employee: commission per source, sales, card tips, cash tips, corrections received, total and payable
  (a negative total shows as negative and pays 0 commission, CS-Q7), plus the blocking issues (`NO_PLAN`, `NO_SALARY`, unresolved blocked
  corrections) by employee. Nothing per line is stored (D-4).
- **CM-28** The fingerprint is stable: generating twice with no input change gives the same value; any applied input
  change (line, tip, salary, sale, plan version, override, correction received, blocked correction) changes it (unit test
  over each input kind, and an integration test per writer).
- **CM-28b** `GET` of a month that was never generated returns the computed view with `generated: false` and leaves no
  statement row, no fingerprint and no lock behind (asserted in the database after the call).
- **CM-28c** (FR-025; Codex 4335954771) ليلى, branch manager of السالمية, `GET`s a REVIEWED October: the response matches
  the branch-scoped contract shape and has no fingerprint, `reviewed_*` or changed-since-review field; after a حولي
  employee's customer is renamed, her response is unchanged (her rows unaffected), while the business manager's response
  (no DENY) carries both fingerprints and shows the statement changed since review (`STATEMENT`).
- **CM-29** Generating a month that has not ended → 422 `COMMISSION_PERIOD_NOT_ENDED`; the estimate is still readable.

### Story 6 — Review (52, P1)

- **CM-30** ليلى reviews October with `expected_fingerprint` equal to the current one: status REVIEWED, `reviewed_fingerprint` and
  `reviewed_statement_fingerprint` (the statement fingerprint of the rows the builder would freeze now, D-6), reviewer and time stored, one audit entry, one `StatementAwaitingApproval` request (FR-053).
- **CM-31** A stale `expected_fingerprint` → 409 `COMMISSION_FINGERPRINT_STALE` with the current fingerprint; a blocking issue
  → 422 `COMMISSION_STATEMENT_BLOCKED` with the issues by employee (D-57).
- **CM-32** An input change after REVIEWED returns the statement to DRAFT in the writer's transaction (D-5, SPEC §11).
- **CM-33b** (CS-Q18 = PP-17.6) The owner returns a REVIEWED October to DRAFT with the reason «خطة سوسن غلط»: status DRAFT,
  `reviewed_*` cleared, one return row holding the reason, one audit entry without it; an empty reason → 422
  `COMMISSION_RETURN_REASON_INVALID`; a DRAFT or closed statement → 409; a user with neither review nor approve → 403.
- **CM-32b** October is REVIEWED; سارة is transferred again the allowed way (spec 017; closed intervals are never rewritten,
  Codex 4336865762): her open حولي attachment is closed on 19 October and a new attachment to الفروانية opens on 20 October,
  so her effective intervals are السالمية 1–14, حولي 15–19, الفروانية 20–31 (a transfer under CS-Q23, not a
  simultaneous attachment under CS-Q25): the view now shows the
  statement as changed since review, approval is refused with 409 `COMMISSION_FINGERPRINT_STALE` (`return_required`), and
  after the return to DRAFT (FR-031) and a new review (with the new branch split) it can be approved. **Concurrency:** the new attachment commits while the approval
  transaction is running (barriers before and after the freeze's one read of the branch links): if that read sees the
  edit, the statement fingerprint of the frozen rows differs from `reviewed_statement_fingerprint` and approval is refused with 409
  `COMMISSION_FINGERPRINT_STALE`, nothing frozen; if it does not, the old split is frozen whole and the edit is a
  post-freeze change. No frozen row carries the new split while another carries the old one.
- **CM-33c** RLS (negative isolation): company B reads 0 of company A's `commission_statement_returns` rows, and inserting a
  return row for A's statement as B fails.
- **CM-33** Without `review:commissions:business` → 403. By default the owner, the general manager and the business manager hold it (CS-Q2b = PP-25.1); the owner grants it to
  المحاسب and revokes it again, and the grant and the revoke each take effect on the next request; a business manager
  who tries to grant it is refused (CS-Q2, Waleed 2026-10-21; Abu Salem 2026-10-22 picked the same defaults and grant). The owner reviews October and then approves it: both
  succeed (CS-Q3, Waleed 2026-10-21), and the statement row and the two audit entries `commission_statement.reviewed` and
  `commission_statement.approved` name the same user, so the record shows that one person did both steps.
- **CM-33d** (CS-Q26 = PP-24.1, negative) ليلى, manager of السالمية, holds `review:commissions:business` (as the owner may
  grant it, CS-Q2) on an October with السالمية and حولي employees: her `review`, `generate` and return requests are refused with
  the uniform 403 `FORBIDDEN`, the statement stays DRAFT (or REVIEWED), no fingerprint is returned to her and no audit
  entry is written; the same with two branch-manager memberships covering every branch of a two-branch business. The
  business manager (business-scoped grant, no DENY) reviews the same October; with a DENY of
  `read:commissions:business` on حولي she is refused the same way.

### Story 7 — Approve, atomically (53, P1)

- **CM-34** The owner approves October: in **one** transaction the start time is captured before the lock, the statement is
  locked, the month has ended, the status is REVIEWED, the current fingerprint equals `reviewed_fingerprint`, no blocking
  issue, no unresolved blocked correction, no projected line with shares ≠ 10000 (D-14), the ADR-0012 count is 0; then every
  `StatementLine` is frozen (one per employee × source: `COMMISSION`, `SALE`, `TIP_CARD`, `TIP_CASH`, `CORRECTION`, `CARRY_COMMISSION`, `CARRY_TIP_CARD` (D-22), and one
  `EMPLOYEE` row per in-scope employee), the
  input fingerprint is frozen as `input_fingerprint`, `statement_fingerprint` is set to `reviewed_statement_fingerprint`
  in the same update that sets status APPROVED with approver and time (before the rows are inserted), the rows read back
  after the freeze hash to it, one audit entry; nothing updates the statement row after the freeze (FR-001).
- **CM-34e** (D-6) A clean approval of a non-trivial October passes the post-freeze check: lines with rule snapshots and
  shares, a sale with a refund, card and cash tips, a selected salary, a plan version and an override, a received
  correction and سارة's two branches; `statement_fingerprint = reviewed_statement_fingerprint`. A unit test proves the
  builder's round trip: the rows it builds and the same rows read back from `commission_statement_lines` and
  `commission_statement_attachments` (ids, `statement_id` and timestamps aside) give the same statement fingerprint. After
  review, an edit that changes a frozen column without an input event (سارة's branch link, CM-32b, a customer's or
  service's name, or the name of a branch where the work was done, حولي renamed between review and approval, D-20) → the view shows it changed since review (`STATEMENT`), approval is refused with 409
  `COMMISSION_FINGERPRINT_STALE` (`changed = STATEMENT`, `return_required`) before anything is frozen, and after the return
  to DRAFT (FR-031) and a new review it approves. A review request whose `expected_statement_fingerprint` predates a
  rename is refused with the same 409.
- **CM-34c** An empty month approved: the business had two employees and no session, tip, sale or correction in October;
  approval freezes two `EMPLOYEE` rows (amount 0, frozen names and numbers) and nothing else; the statement view and the
  export list both employees with zero totals; an employee hired in November is not listed. ليلى (branch manager of
  السالمية) also sees her branch's employee with a zero total, through the frozen `attached_branch_ids` of the `EMPLOYEE`
  row, and does not see the حولي employee.
- **CM-34b** A company whose package sales are not yet covered by the 50-4 bootstrap (a sale whose applied revision is
  below the revision `listCurrentPackageSales` reports) cannot approve; nothing is frozen; after the bootstrap it can.
- **CM-34d** October is approved with سارة transferred on 15 October: `commission_statement_attachments` holds her two
  clipped links (السالمية 1–14, حولي 15–31), every `attached_branch_ids` of the statement equals what those rows give, and
  a later `EmployeeBranch` edit changes none of them. A correction of an October line received by November is frozen in
  November with `previous_amount`, `new_amount` and the delta (`amount = new_amount − previous_amount`) and the line's
  service names as read at November's approval; an insert into either table outside an approval is refused.
- **CM-35** A pending commission event created before the start → 409 `COMMISSION_UPDATES_PENDING` with the ADR-0012 text;
  nothing frozen; a manual retry after processing approves (ADR-0012 §4 group 5).
- **CM-36** Approval races a session, a redemption, a refund, a tip, a salary, a plan version and an override: each lands in
  the frozen result or in a correction, never lost and never twice (SPEC §11, ADR-0012 §4 group 6, barriers not sleeps).
- **CM-37** Two approvers at once: one approves, the other waits on the lock (D-3), then sees APPROVED and gets 409
  `COMMISSION_PERIOD_CLOSED`; a statement returned to DRAFT while an approval waits gives it 409
  `COMMISSION_STATEMENT_NOT_REVIEWED`, and a permission revoked while it waits gives it the uniform 403.
- **CM-38** Only holders of `approve:commissions:business` approve (default owner; only the owner grants it to a named
  person and revokes it, CS-Q5); the same person may review and approve (CS-Q3, CM-33); a month not ended → 422 `COMMISSION_PERIOD_NOT_ENDED`.
- **CM-38b** (FR-036, negative; Codex 4335896943) ليلى, manager of السالمية, is given `approve:commissions:business` by the owner
  (CS-Q5) on a REVIEWED October with السالمية and حولي employees: her approval and her return to DRAFT are refused with
  the uniform 403 `FORBIDDEN`, no fingerprint is computed or returned, nothing is frozen, the statement stays REVIEWED and
  no audit entry is written; the same with branch grants covering every branch of a two-branch business, and for a
  business-wide holder with a DENY of `read:commissions:business` on حولي. The owner approves the same October.
- **CM-39** The ADR-0012 §4 groups 1–4 and 7 (catalogue, context isolation, predicate fixtures over the **six** types of
  D-9, search-path attacks, result shape and `EXPLAIN`) pass in 53-1.

### Story 8 — Mark paid (54, P1)

- **CM-40** The payer marks October paid with a method picked from «مع المرتب» / «تحويل بنكي» / «كاش» plus an optional note (CS-Q6) and the payment date: status PAID, `paid_at`,
  `paid_on` (stored as given, e.g. 5 November recorded on 7 November), `paid_method`, payer, one audit entry; nothing in the frozen lines changes (SPEC §11 "PAID records the method").
- **CM-41** A DRAFT or REVIEWED statement → 409 `COMMISSION_STATEMENT_NOT_APPROVED`; a PAID one → idempotent replay of the
  same request returns the original response, a different body → 422 `IDEMPOTENCY_KEY_REUSED`, a second key → 409
  `COMMISSION_STATEMENT_ALREADY_PAID`.
- **CM-42** Without `pay:commissions:business` (held by default by the owner, the general manager and the accountant, CS-Q4) → 403.

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
  January, February and March only: one transaction locks January…March and every candidate target month through the
  current month (April included) in one ascending call, posts
  corrections for January and February into April (the earliest DRAFT month: March was REVIEWED when the targets were
  chosen, D-13), returns March to DRAFT, and leaves April's own month unchanged; a
  later revision of the 15 January entry repeats the same range.
- **CM-46** A salary committed after approval → corrections on the lines whose threshold moved (SPEC §11); a tip changed in a
  closed month → a `TIP_CARD` or `TIP_CASH` correction for that `tip:<session>:<method>` source; raising a cash tip of a
  closed month changes no payable figure, raising a card tip does.
- **CM-47** A change to a PAID month posts a correction exactly like an APPROVED one (SPEC §11).
- **CM-48** (Codex 4335693293, barriers) September is APPROVED, October is REVIEWED, November is DRAFT, and a late
  September change arrives while the owner returns October to DRAFT (FR-031). (a) The return holds October's lock first
  (barrier before its commit): the consumer waits on October's lock, then sees it DRAFT and posts the correction into
  **October**. (b) The consumer holds its locks first (barrier after its `lockStatementPeriods` call): the return waits on
  October's lock; the consumer, which saw October REVIEWED under the lock, posts into November and commits; then the
  return completes. In no interleaving is a correction posted into November while October was DRAFT when the target was
  chosen, and no status is read before its lock. The chosen DRAFT target cannot be reviewed or approved before the
  correction commits (a review of it waits on its lock and then sees the correction in its fingerprint), and the locks are
  always taken in one ascending call, so this writer never deadlocks with another (CM-02).
- **CM-48c** (MergePilot 5598705384, barrier) September is REVIEWED, October and November are DRAFT, and a late September
  change arrives while the owner approves September. The approval holds September's lock first (barrier before its
  commit); the consumer's one ascending call already includes October and November, because the candidates of every
  affected period are locked whatever its status before the call; after the wait it sees September APPROVED, runs the
  correction step and posts into October, chosen from the statuses that call returned, with no second lock call and no
  status read before its lock.
- **CM-49** A replayed event is deduped before it can bump the generation; a second real change bumps it again and posts only
  `new − (frozen + corrections already posted)` for each source.
- **CM-50** Corrections received are inputs of the target: they enter its fingerprint and are frozen as `CORRECTION` lines at
  its approval; they display in their own section «تصحيحات شهور سابقة»: one row per affected service (date, service, original month, was, became, difference) and a total for the section, and the employee sees it as the manager does (CS-Q9, confirmed by CS-Q30 over spec 060's MY-Q6: in the staff app too, never with the customer's name). An employee who left shows the flag «سابت الشغل» on her rows and her section total labelled owed to her or by her (CS-Q28).

### Story 10 — Blocked corrections and period repair (55b, P1)

- **CM-51** A late session in approved September for هبة, who had no plan before 15 September: the event is consumed, one
  blocked correction `(هبة, 2026-09, NO_PLAN)` is recorded, the outbox does not stall, and October cannot be approved while
  it is unresolved (SPEC §6).
- **CM-52** ليلى adds a period repair for هبة in September (allowed only while a `NO_PLAN` blocked correction exists, else 422
  `COMMISSION_REPAIR_NOT_ALLOWED`, including for a `NO_SALARY` block): one audited repair version that applies only inside September (D-12); the recompute posts
  the correction normally and resolves the blocked correction. It prices only the days of September that had no plan (1–14 September in the example); lines already priced with their plan keep it (CS-Q11).
- **CM-52b** A repair for an open `NO_PLAN` block whose recompute then needs a salary that is missing: the same open block's
  `code` becomes `NO_SALARY` (one row, not two), nothing is posted, and a later repair request is refused; any change to a
  resolved row is refused by the table's trigger.
- **CM-52c** The reverse: هبة's open September block is `NO_SALARY` (her plan from 15 September is salary-based); a late
  session dated 10 September arrives, then her salary is set: the recompute now returns `NO_PLAN` for the 10 September line,
  so the same open row's `code` becomes `NO_PLAN`, a repair is then allowed and resolves it.
- **CM-53** A `NO_SALARY` block is resolved by setting the salary for its date in staff (spec 021); the `SalaryChanged`
  recompute posts the correction and resolves the block; a repair request for a `NO_SALARY` block is refused.
- **CM-53b** (Codex 4335542716) October is REVIEWED when a September recompute for هبة fails: the block stores
  `target_period = 2026-11` and November's statement id. October is then returned to DRAFT (FR-031): November stays
  blocked (its review and approval are refused, the block is on November's view and in its fingerprint), October is not
  blocked and can be reviewed and approved. When the block is resolved, its correction is posted normally into the
  earliest DRAFT month after September at that moment (D-13, MergePilot 5598705384): into **October** if October is still
  DRAFT, into **November** if October was reviewed or approved meanwhile; November, held DRAFT until then, guarantees that
  a DRAFT target exists, and its hold ends with the resolution.
- **CM-54** (CS-Q19 = PP-17.7) When a blocked correction is first recorded, one in-app bell reaches the holders of the plan
  permission (CS-Q1) in the business; with 250 holders, three events of 100, 100 and 50 distinct recipients are appended in
  the block's transaction, and a failure appending the third leaves no block and no event; a later event for the same open block rings nothing new; the block is always listed on
  the statement view of the target month as a blocking issue.

### Story 11 — Excel export (56, P2)

- **CM-55** Exporting approved October returns 202 `{ render_id }`; the worker builds the workbook from the **frozen** lines
  only; the file has the card-tips and cash-tips columns (D-36) and never a phone (SPEC §4); every download is audited
  (who, when, business, period). Export is allowed after approval only (CS-Q10), with a summary sheet (employee number, name, commission, sales commission, corrections, card tips, cash tips for information, the net payable) and a detail sheet with one row per service (CS-Q10). The detail rows carry the
  customer's **full name** (CS-Q15 = PP-17.3), never her phone.
- **CM-55b** (D-20) Every line-sourced detail row of a frozen statement carries the `customer_id`, the customer's full name,
  the service names and the date frozen at approval, never a phone; after the customer's name is corrected in `customers`,
  a new export of the same approved statement still shows the name frozen at approval and identical amounts, while an open
  month's view shows the corrected name; the same holds for the employee's name and number renamed or renumbered after
  approval.
- **CM-55d** The export request row is written with the requester's scope before the job is queued: ليلى (branch-scoped) gets a workbook with only her branch's employees, and the request row stores `scope = BRANCHES` with
  her whole effective set in `branch_ids` (never a single id); a job whose
  `render_id` has no request row fails without reading any statement; the xlsx bytes are returned with the xlsx MIME type
  and never pass through the PDF renderer.
- **CM-55f** (Codex 4336086349, CS-Q23 = PP-21.2) سارة is transferred from السالمية to حولي on 15 October and October is
  APPROVED and also carries a correction (D-13: it lands in the first DRAFT month after its source) of her 3 September line,
  when she was attached to السالمية only, so its `attached_branch_ids` = {السالمية} (the source day's attachment, copied
  from the frozen September row). ليلى (السالمية) exports October: the workbook holds سارة's
  `EMPLOYEE` row and only her rows of 1–14 October (the 10 October line she did at حولي included, with its place حولي,
  and the correction of the 3 September line), and none of 15–31 October, neither their amounts nor their customer names,
  although سارة is in the saved employee set; هند (حولي) gets only 15–31 October. A test whose worker filtered by the
  employee set alone would fail on this file. After approval سارة's October السالمية attachment is then removed: a new
  export by ليلى still lists سارة with the same rows, as her closed view does (CM-23b), because the employee set comes
  from the frozen rows (Codex 4336152044).
- **CM-55e** (privacy) ليلى requests the October export as branch manager of السالمية, then before she collects it she is
  transferred to حولي (or her read permission or membership is revoked, or a DENY on السالمية is added): the collect is refused with the uniform 403, no
  workbook is returned, the stored bytes are discarded, no export audit entry is written and `collected_at` stays empty.
  Separately, a different user presenting her `render_id` gets the transport's uniform 404 (ADR-0049 §1: another user,
  another company, an unknown or an expired id all answer the same 404; Codex 4336446486) and the stored bytes stay as they
  were, so ليلى can still collect them while she is authorized.
- **CM-56** The amounts in the file equal the frozen statement bit for bit (KWD, three decimals, as text-safe numbers).

### Story 12 — Reminders (56b, P2)

- **CM-57** On the 3rd and on the 5th of November, if October is not APPROVED, one `StatementAwaitingApproval` request per
  statement per day reaches the approvers who are business-wide readers (FR-030) as an in-app bell at 09:00 business time (CS-Q17 = PP-17.5); none once it is
  approved; a rerun of the
  job the same day sends nothing new (ledger, SPEC §11 "reminders on the 3rd and 5th"). Never a lock (D-54). A business whose `commissions` feature is off gets no statement row, no ledger row and no reminder.
- **CM-57c** A quiet business (no session, plan or generate in October) still gets its reminder on 3 November: the job
  creates October's DRAFT statement, writes the ledger row and the events in one transaction; a rerun that day adds
  nothing. If Redis is lost (its `run_id` changes or the sentinel key disappears), `/ready` turns degraded and the
  `COMMISSION_REMINDER_SCHEDULES_LOST` alert is raised; the worker's CS-Q32 rebuild (FR-053 _CS-Q32_; the runbook's
  `CompanyCreated` replay is the fallback) registers the quiet company's scheduler again and the 3 November reminder is sent. **Worker down during the loss:** Redis is emptied while the
  worker is stopped; on start the worker finds no sentinel, opens the `operational_recovery_flags` row before writing the
  sentinel, reports degraded and raises the alert, then runs the CS-Q32 rebuild; while the rebuild has not completed for
  every company, a restart keeps the flag and the alert; only a rebuild that succeeds for every company clears it, and
  `/ready` is healthy again. The operator fallback clears the flag only after its replay has re-registered every
  company; it never clears a flag after a partial rebuild. The new CS-Q32 ADR before 56b-1 finalises CM-57b and CM-57c.
- **CM-57b** A company created after the release gets its scheduler from `CompanyCreated`; a company whose Redis schedule
  was lost gets it back on the next commission input delivery; an existing company gets it from the CS-Q32 rebuild, at the first rollout too: FR-053 treats a first start
  with no sentinel like a loss, so the first deploy shows the flag and the alert until that rebuild completes (the
  operator replay stays only as the fallback).
- **CM-58** (CS-Q16 = PP-17.4) On the 3rd, in the same 09:00 run as the owner's reminder, if October is still DRAFT one
  `StatementAwaitingReview` reaches the holders of `review:commissions:business` who are business-wide readers; none on
  the 5th; none if it is already REVIEWED or closed.
- **CM-58b** (FR-030; Codex 4335896948) ليلى, manager of السالمية, holds `review:commissions:business` and
  `approve:commissions:business` (as the owner may grant them, CS-Q2 and CS-Q5), and a business manager holds both with a DENY of
  `read:commissions:business` on حولي: neither receives the day-3 `StatementAwaitingReview`, the 3rd/5th
  `StatementAwaitingApproval` reminders, or the `StatementAwaitingApproval` sent when October is reviewed; the owner and
  a business manager with no DENY receive them. An accountant granted both codes with a DENY of
  `approve:commissions:business` receives the review notices but none of the `StatementAwaitingApproval` ones (FR-030:
  each recipient passes the endpoint's own check). A unit test proves the recipient filter and the review and approve
  guards call the same predicate.

### Edge cases

- An employee who left the business still gets her month computed; whether corrections are posted for her after she
  leaves, and how they are settled, is CS-Q8: the correction posts normally in the next open statement under her name and shows to the owner in the final settlement, owed to her or by her; the final settlement is her row in that statement's «تصحيحات شهور سابقة» section, flagged «سابت الشغل», with her total owed to her or by her, and no new screen (CS-Q28, FR-045; Codex 4336865747).
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
  transition and any change to an APPROVED row except to PAID, and any change to a PAID row. A `BEFORE INSERT` trigger refuses
  any row whose status is not DRAFT, so no path can insert an APPROVED statement and skip review (Codex 4336601157).
- **FR-002** `packages/db` exports `lockStatementPeriods(tx, { businessId, periods, ids })` (D-3): `ids` is the caller's
  injected `IdGenerator` (the `@pospay/db` type, UUID v7 from `packages/ids`, as `appendAuditLog` takes it), so the API,
  the worker and the FR-044 seed each pass their own; it validates `YYYY-MM`, de-duplicates,
  sorts ascending, upserts missing rows as DRAFT with an id from `ids` (an id drawn for a row that already exists is
  dropped by `ON CONFLICT DO NOTHING`; the table has no id default), locks them `FOR UPDATE`, returns `{ period, statementId, status }[]`.
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
- **FR-010** Permission: `manage:commission-plans:business` (proposed code; CS-Q1 answered by Abu Salem, 2026-10-22, then
  refined by CS-Q27: held by default by the owner and the accountant, and only the owner grants it to anyone else or
  revokes it), the `commissions` feature, an individual admin login (not a device), rechecked inside the transaction.
  **CS-Q27** (Abu Salem, decisions page, batch 46, 2026-10-23; from his note on CS-Q1 «المالك مدير اداري و مالي و المحاسب مع
  امكانية اعطاء الصلاحيه»): the default holders are the owner (`owner`) and the accountant (`accountant`, the role key in
  `packages/db/src/role-defaults.ts`), and only the owner may grant it to another role or revoke it, as with review and
  approve; this replaces Waleed's owner-only pick (card, 2026-10-22).

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
  performers, old and new business dates) → **one** `lockStatementPeriods` call, ascending, for every affected period and, for **each
  affected period whatever its status before the call**, every candidate target month from it through the business's
  current month (D-13): a period's status is authoritative only under its lock, and an approval can close a REVIEWED
  period while this call waits, so the candidates are never selected from a status read before the lock (CM-48c) → only
  then classify each affected period as open or closed and choose each correction target, both from the statuses that
  call returned → apply the projection change → for each affected closed period run the correction step (FR-039) → return each
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
- **FR-018b** `SalaryChanged` names its business: sub-PR 21-a (owned by `staff`, before 50-2) adds `business_id` to the
  event, taken from the salary row. The field is optional in the contract so legacy events still parse, and every event produced after 21-a carries it.
  An event published before 21-a (the ADR-0012 amendment backfill) has none; the
  consumer resolves it once through a staff-owned employee-business reader bound at the root (D-16), which is safe
  because an employee's business never changes (spec 017: business identity is immutable).
- **FR-019** Registered in the worker's consumer registry; `KNOWN_EVENT_TYPES` already holds every type except
  `PackageSaleChanged`, which row 42 registers.
- **FR-020** Bootstrap (D-15) in its own sub-PR, run once per tenant after the consumer is live, idempotent, with a runbook
  count; tips from 36-5, lines and salaries replayed from the outbox through the 50-0 facade, package sales from row 42's
  `listCurrentPackageSales` (in 50-4). Approval stays closed until every bootstrapped input type meets the coverage rule.
- **FR-021** Estimate: `GET /v1/businesses/:businessId/commissions/periods/:period/estimate?employee_id=` returns per employee:
  per-source amounts, the total, sales, tips by method, corrections received, and `status: OK | NO_PLAN | NO_SALARY`; computed
  on read by a read-only use case (D-7), never stored. Permission `read:commissions:business` (CS-Q14 = PP-17.2; a branch manager's scope CS-Q20 = PP-20.1, §6 _Permissions_); the staff app's
  own estimate is row 57.
- **FR-022** The engine input for one employee and month is assembled by **one** pure function, in
  `packages/commissions-engine` (so the worker and the api share it), from the projection rows (ACTIVE lines, active sales,
  the selected salary, versions, overrides); tips and corrections pass through unpriced (D-1). Sub-PR 50-a ships it before
  both its users: the correction step (55-1) and the estimate/statement view (50-5, 51-1). No second assembly path exists.
- **FR-023** Names for display come from `EmployeeDirectoryPort` (staff, ADR-0010) and a catalog service-name reader bound at
  the root (D-16).
- **FR-024** An event for a business whose `commissions` feature is off is still projected and marked (turning the feature on
  later must not lose a month); only the routes are feature-gated.

### 51 — generate-statement and fingerprint

- **FR-025** `POST /v1/businesses/:businessId/commission-statements/:period/generate` refuses a month that has not ended
  (business timezone, D-16) with 422 `COMMISSION_PERIOD_NOT_ENDED`; under the lock it ensures the DRAFT row, computes the view
  (CM-27) and the fingerprint, stores `current_fingerprint` and returns the view. `GET …/:period` **writes nothing and takes
  no lock**: it computes the same view and fingerprint on read (D-7), returns `generated: false` when no statement row exists,
  and for a closed month returns its frozen lines. **Only for a business-wide reader** (§6 _Permissions_), the open
  month's view returns **both** fingerprints (D-6), the input fingerprint and the statement fingerprint of the rows the
  builder would freeze now; a REVIEWED statement is shown as **changed since review** when either differs from its
  reviewed value, with the cause (`INPUTS` or `STATEMENT`) and, for a holder of review or approve, the return to DRAFT
  (FR-031) as the next step, since a REVIEWED statement whose labels or branch links changed has no writer to return it.
  For any other reader the response carries **no** whole-statement field: no `current_fingerprint`,
  `current_statement_fingerprint`, `reviewed_*` or `input_fingerprint`/`statement_fingerprint`, and no changed-since-review
  flag or cause, since each is computed over branches she may not see and would let her observe changes there; she gets
  the status and her filtered rows only. The Zod contract has two response shapes, the business-wide one with these
  fields and the branch-scoped one without them (not optional fields on one shape), and the use case picks the shape from
  the same predicate as the guards (CM-28c).
- **FR-026** The input fingerprint's input and the statement builder (§6 _Fingerprint_) are pure functions; the hash is
  an injected port (D-6). The builder is the one the freeze uses (FR-033) to produce the frozen rows, never a copy.
- **FR-027** The view lists blocking issues per employee: `NO_PLAN`, `NO_SALARY`, unresolved blocked corrections; review and
  approval are refused while any exists.
- **FR-028** Permission: `read:commissions:business` for `GET` (a reader sees only the employees of her effective branch set, CS-Q20 = PP-20.1, §6 _Permissions_); `review:commissions:business`
  for `generate`. Detail rows show the customer's full name (CS-Q15 = PP-17.3), read through the customers reader bound at
  the root (D-16) from the `customer_id` the projection head holds while the month is open, and taken from the names frozen
  in the statement rows once it is closed (D-20); never a phone.

### 52 — review-statement

- **FR-029** `POST …/:period/review` `{ expected_fingerprint, expected_statement_fingerprint }` (Idempotency-Key): under
  the lock, the month has ended, status DRAFT, no blocking issue, recomputed input fingerprint = `expected_fingerprint` and
  the statement fingerprint the builder gives now = `expected_statement_fingerprint` (both as the reviewer's view showed
  them, so a label that changed after she loaded the view is refused, never reviewed unseen); set REVIEWED with `reviewed_fingerprint`, and
  `reviewed_statement_fingerprint` computed from the rows the statement builder (FR-026) would freeze now (the live
  attachments and labels read in this transaction), reviewer user and membership, time; audit `commission_statement.reviewed`. **Only a business-wide reader reviews** (CS-Q26 = PP-24.1): the
  statement is one per business and review certifies all of it, so marking it REVIEWED requires, besides
  `review:commissions:business`, that the caller is a business-wide reader (§6 _Permissions_: a current company- or
  business-scoped grant of `read:commissions:business` and no DENY of it at any scope), checked under the lock in the
  review transaction; the owner or the business manager in practice. A branch manager, even one holding review (the owner
  may grant it to anyone, CS-Q2) and even one whose branch grants cover every branch, sees only her branch's part (FR-028)
  and does not review: the request is refused with the uniform 403 `FORBIDDEN` before any fingerprint is computed or
  returned, so she never certifies rows she did not see and never receives the whole-statement fingerprint. The same rule
  guards `generate` (it returns the whole view, FR-025) and a reviewer's return to DRAFT (FR-031); an approver's return
  follows FR-036.
- **FR-029b** (CS-Q2, CS-Q5 with PP-24.1) The owner may grant `review:commissions:business` and
  `approve:commissions:business` to anyone, but they take effect only together with business-wide read (FR-029, FR-036):
  a holder whose read is branch-scoped keeps getting the uniform 403. The grant is not refused for that; the permission
  grant screen shows, next to each of these two codes, the warning «الصلاحية دي مالهاش أثر غير مع قراءة النشاط كله»
  (an i18n key, Arabic and English), and a UI test asserts the warning is visible when either code is selected.
- **FR-030** Emit `StatementAwaitingApproval` (SPEC §3) to notifications in the same transaction, recipients resolved by
  commissions (SPEC §3 "emitting modules put recipients and channels in the event"; in-app, CS-Q17 = PP-17.5).
  **Recipients pass the endpoint's own check** (Codex 4335896948): an approval prompt or reminder goes only to the
  holders of `approve:commissions:business` who are business-wide readers (FR-036), and a review reminder only to the
  holders of `review:commissions:business` who are business-wide readers (FR-029), evaluated with the same predicate
  (one function, shared with the guards) at the time the event is appended, so nobody is prompted to do what the endpoint
  would refuse her. **Every
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

- **FR-032** `POST …/:period/approve` `{ expected_fingerprint, expected_statement_fingerprint }` (Idempotency-Key), the ADR-0012 §3 transaction exactly (`READ COMMITTED`, the
  waiting lock of D-3's `lockStatementPeriods`, so every recheck after the lock sees the state after the wait: a second
  approver gets 409 `COMMISSION_PERIOD_CLOSED`, a statement returned to DRAFT 409 `COMMISSION_STATEMENT_NOT_REVIEWED`, a
  revoked permission the uniform 403). Two facts, not an isolation level, keep the frozen statement consistent: **(1)** the
  freeze reads `EmployeeBranch` **once**, by one call to the staff reader (FR-033), inserts exactly the rows it returned
  into `commission_statement_attachments`, and
  every `attached_branch_ids` of the statement is derived from those rows inside the transaction, never from a second
  live read; **(2)** after the freeze the **statement fingerprint** (D-6) is recomputed from the rows just frozen, read back in
  the same transaction (the attachment rows included, §6 _Fingerprint_), and must equal `reviewed_statement_fingerprint`, else the transaction rolls back, nothing is frozen, and the
  answer is 409 `COMMISSION_FINGERPRINT_STALE`. A branch-link edit or any input change racing approval is therefore either
  in the frozen rows (refused) or entirely after the freeze (a post-freeze change), never half of the statement old and
  half new. The pre-freeze fingerprint check below stays as the cheap early refusal:
  `transaction_timestamp()` captured before the lock → lock → recheck ended month, permission, status REVIEWED, fingerprint =
  `reviewed_fingerprint` = `expected_fingerprint`, the statement fingerprint the builder gives now =
  `reviewed_statement_fingerprint` = `expected_statement_fingerprint` (the early refusal for a label or branch-link change;
  the builder runs **once** in this transaction and the freeze below inserts exactly the rows of that run, D-26), no blocking issue, no unresolved blocked correction, D-14, **every
  bootstrapped input type (lines, tips, salaries, package sales) meets its coverage rule (D-15, FR-020)** → the count →
  **one** update of the statement row to APPROVED with `approved_by`, `approved_at`, `input_fingerprint` and
  `statement_fingerprint` = `reviewed_statement_fingerprint` (FR-034) → freeze (the insert triggers accept rows only for a
  statement this transaction set to APPROVED) → the statement fingerprint recomputed from the rows read back must equal
  the stored `statement_fingerprint`, else the whole transaction rolls back. Nothing updates the statement row after the
  freeze: FR-001 refuses any change to an APPROVED row except to PAID.
- **FR-033** Freezing writes `commission_statement_lines` (insert-only): per employee, one `COMMISSION` line per `line:<id>`
  source, one `SALE` per `sale:<id>`, one `TIP_CARD`/`TIP_CASH` per `tip:<session>:<method>`, one line per received
  correction (its own id as source) of kind `CORRECTION` (commission and sale corrections), `CORRECTION_TIP_CARD` or
  `CORRECTION_TIP_CASH`, and one `CARRY_COMMISSION` or `CARRY_TIP_CARD` line per carry row targeting this statement (D-22), so the payable figure can be computed from the frozen kinds alone; zero amounts are frozen too, so the frozen set equals the set the statement fingerprint covered at review. The rows
  are exactly the statement builder's output (FR-026), inserted as built.
  **Every in-scope employee gets one `EMPLOYEE` row** (`source_ref = employee:<id>`, amount `0.000`, never part of any
  total), even with no source at all: in scope means an employee of the business whose employment overlaps the month
  (hire date ≤ the last day, contract end and deletion, if any, ≥ the first day, read through `EmployeeDirectoryPort`) or
  who has any source, received correction or incoming carry (D-22) in the month. It carries the frozen label and **`attached_branch_ids`**: every
  branch she was attached to on any day of the month (from the attachment snapshot frozen with it, never changed),
  **plus the `attached_branch_ids` of every correction frozen for her in this statement** (a correction keeps the branches of its source
  line's own day, so رنا, who left at the end of October, still appears in ليلى's November part through her October
  correction; MergePilot on #441), so a reader whose effective branch set (§6 _Permissions_) overlaps it still finds her in a closed month, with a zero total
  when she has no row in that part, and
  an approved month always lists the same employees with their zero totals.
  **Every** frozen row also stores the employee's label as read in the approval transaction through
  `EmployeeDirectoryPort` (staff, ADR-0010): `employee_number` (row 8c), `employee_name_ar`, `employee_name_en`, so a later
  rename or renumbering of the employee never changes an approved statement or its export (D-20).
  **Every** frozen row (except `EMPLOYEE` and the two carry kinds `CARRY_COMMISSION` and `CARRY_TIP_CARD`, whose source fields are NULL and whose `attached_branch_ids` is empty, D-22) also stores `source_branch_id` (where the work was done, for display) with that branch's name as read in the approval transaction, `source_branch_name_ar NULL` and `source_branch_name_en` (CS-Q35, D-20; English required, Arabic optional; a CHECK keeps the English name present exactly when `source_branch_id` is, and both names NULL when it is NULL),
  `source_business_date`, and `attached_branch_ids uuid[]`: **every** branch the employee was attached to on
  `source_business_date`, derived at freeze from the attachment snapshot below; a `CORRECTION` row copies all three from
  its correction, which resolved them when it was posted. They never change after insert, even if `EmployeeBranch` is
  edited later. A closed statement's branch filter (CS-Q20, CS-Q23) and its export filter **only** on «`attached_branch_ids` overlaps the
  reader's effective branch set _R_», or on nothing for a business-wide reader (a company- or business-scoped grant and no DENY, §6 _Permissions_; never a
  union of branch grants that covers every branch), never on
  the live projection or the live branch links. **The attachment snapshot:** the approval transaction reads
  `EmployeeBranch` once, by **one** call to the staff reader bound at the root (D-16), which returns, on the approval
  transaction, every link of the in-scope employees that overlaps the month; commissions then writes exactly those rows,
  in one multi-row insert, into `commission_statement_attachments` (insert-only): one row per link, with `branch_id`,
  `attached_from` and `attached_to` clipped to the month. No SQL statement spans the two modules (the reader returns rows,
  it never writes, and commissions never joins a staff table). Every `attached_branch_ids` of the
  statement's source rows, and the month part of the `EMPLOYEE` row's set, is derived from these rows (a correction keeps
  the set copied from its own correction row, and the `EMPLOYEE` row adds those sets, FR-033), and they never change, even if
  `EmployeeBranch` is edited later; they are also what a source first seen after approval is attributed from (FR-040).
  A line-sourced frozen row also copies the line's detail identifiers from the projection head and the customer and
  service names read in the same transaction (D-20), so the frozen statement and its export never need orders, the live
  projection or a live name to say which visit, service and customer a row is. A correction-sourced frozen row copies
  `previous_amount`, `new_amount` and the signed `amount` (the delta) from its correction, and, when the corrected source
  is a line, the line's `service_id` and service names read through its projection head in the approval transaction, so
  the display CS-Q9 chose (a section «تصحيحات شهور سابقة» with one row per affected service: date, service, original month, was, became, difference, and a total for the section) is computed from the frozen rows alone; CS-Q9 decides only the display, in 53-3.
- **FR-034** Status APPROVED, `approved_by`, `approved_at`, `input_fingerprint`, `statement_fingerprint`; audit `commission_statement.approved` (SPEC §1:
  the approval actor and time are in the audit log).
- **FR-035** 53-1 delivers the ADR-0012 function, role, grants, policies and index with the six types of D-9 and its addendum;
  53-2 the use case; 53-3 the race tests.
- **FR-036** Permission `approve:commissions:business`: the owner by default, granted and revoked **by the owner only**, to a named person (52-1 registers both codes as owner-grantable only; if spec 009's grant flow has no per-code granter rule yet, 52-1 adds it for these two codes) (CS-Q5, Waleed
  2026-10-21). Reviewer rule (CS-Q3, Waleed 2026-10-21): the reviewer may also be the approver; `reviewed_by` and
  `approved_by` are both kept and the audit entries show it. **Only a business-wide reader
  approves**, for the reason of PP-24.1 (whoever certifies the figures must have seen all of them; derived from CS-Q26 =
  PP-24.1, not a new owner question): besides `approve:commissions:business`, the caller must be a business-wide reader
  (§6 _Permissions_: a current company- or business-scoped grant of `read:commissions:business` and no DENY of it at any
  scope), checked under the lock in the approval transaction. An approver to whom the owner delegated approval (CS-Q5) but whose
  read is branch-scoped, even with branch grants covering every branch, or who has any DENY, is refused with the uniform
  403 `FORBIDDEN` before any fingerprint is computed or returned and before anything is frozen; the same guard covers an
  approver's return to DRAFT (FR-031).

### 54 — mark-statement-paid

- **FR-037** `POST …/:period/mark-paid` `{ paid_method, paid_on }` (Idempotency-Key): under the lock, status APPROVED → PAID,
  `paid_by`, `paid_at` (the recording time), `paid_on` (the payout date the payer states, a business date not after today
  and not before the approval date) and `paid_method` (CS-Q6: with salary, bank transfer or cash, plus an optional note), all persisted, plus, when `paid_method` is cash, the rounded payable amount (CS-Q12, D-19: nearest 5 fils, half up) stored beside the exact payable figure, which is never overwritten; audit `commission_statement.paid` with both
  dates. Reads and the export show `paid_on` as the payment date.
- **FR-038** Permission `pay:commissions:business` (CS-Q4).

### 55 — corrections

- **FR-039** The correction step, for an affected **closed** source month and employee, in the consumer's transaction: bump
  `commission_period_generations` → recompute the month with current inputs (D-1) → for every source of that employee in
  the month (union of frozen, previously corrected and newly computed sources) post `delta = new − (frozen + corrections
  already posted)` when non-zero, storing all three: `previous_amount` (frozen + corrections already posted), `new_amount`
  (new) and `amount` (the delta) → into the target of D-13, chosen from the statuses held after every candidate month
  was locked (FR-015), never from a status read before its lock (SPEC §6).
- **FR-040** `commission_corrections` is insert-only and every row carries the `source_branch_id`, `source_business_date`
  and `attached_branch_ids` of the line, sale or tip it corrects, never changed. The lookup key is the full
  triple **`(source_period, employee_id, source_ref)`**, never `source_ref` alone, because a shared line has one row per
  performer. If that triple is already frozen (a statement row of the source month, or an earlier correction of the same
  triple), the three values are **copied from that frozen row**, never recomputed; only for a triple that was never
  frozen (a late line in a closed month, or a performer added to a line after approval) they are resolved once by its
  first correction: `source_branch_id` and `source_business_date` from the projection, and `attached_branch_ids` from the
  source month's **frozen attachment snapshot** (the branches of that employee whose frozen interval contains
  `source_business_date`), never from the live `EmployeeBranch`, so a link edited after approval cannot move it. An
  employee with no frozen interval covering that date gets an empty `attached_branch_ids` (visible only to a business-wide
  reader, §6 _Permissions_). Every later correction of that triple copies them; `UNIQUE (company_id, source_period, employee_id, source_ref, generation)`,
  with `kind` `COMMISSION | SALE | TIP_CARD | TIP_CASH` (SPEC §6's kind TIP, split by method because the two are paid
  differently, D-36), the signed amount, the target month and statement, and the event id.
- **FR-041** Tips: a newer `SessionTipsChanged` for a closed month posts `TIP_CARD` or `TIP_CASH` corrections per
  `(employee, tip:<session>:<method>)`. A `TIP_CASH` correction is informational like a cash tip: it is shown and frozen,
  never added to the payable figure and never part of a negative-commission carry (CS-Q7: card tips are paid in full even when the commission is negative); a `TIP_CARD` correction is
  paid or recovered with payroll like a card tip, and a card-tip side that goes negative pays 0 and carries into next month's card tips (CS-Q29, FR-045, §9).
- **FR-042** Salaries: a salary entry `(employee, effective_from)` is the selected salary (SPEC §5.5) of **every month whose last
  day falls in `[effective_from, next_from)`**, where `next_from` is the employee's next later entry in the projection (open
  ended when there is none, up to the current month). A new entry or a new revision of one therefore affects that whole
  range, not one month. Under the identity lock of FR-015 the consumer computes the range from the locked projection, calls
  `lockStatementPeriods` for every month in it plus every candidate target month through the current month (D-13,
  ascending, one call), then for each month:
  an open month (DRAFT/REVIEWED) is refreshed (its estimate recomputes on read; REVIEWED returns to DRAFT, D-5) and a closed
  month (APPROVED/PAID) runs the correction step (FR-039) for that employee. The fingerprint of a month includes only its
  selected salary (§6 _Fingerprint_), so months outside the range do not change.
- **FR-043** Plan versions and overrides never reach a closed month (FR-007), so they never produce corrections; only the
  period repair (FR-046) does.
- **FR-044** Corrections are tested on **seeded closed periods** (plan row 55): the seed freezes a month (its statement
  rows and its attachment snapshot) directly through the storage layer into the tables 48a-2 creates, so 55 does not wait on
  53. The seed does what the insert-only trigger accepts: in **one** transaction it takes the statement lock
  (`lockStatementPeriods`, with the test's `IdGenerator`), moves the month DRAFT → REVIEWED (with `reviewed_*` and the
  statement fingerprint of the rows it is about to write) → APPROVED, the only path FR-001's trigger allows, and then
  writes its statement rows and attachment rows; it never writes
  them into a month approved in another transaction, and it does not call 53-2's use case.
- **FR-045** Negative totals, departed employees and the display of corrections (CS-Q7, CS-Q8, CS-Q9). **CS-Q7:** an
  employee whose commission total is negative sees the negative figure (e.g. −25.000) in the statement, is paid 0
  commission, and the negative carries by itself into the next month's commission; her card tips are paid in full (payable = max(0, commission subtotal) + max(0, tip side), §9). The carry is a `commission_carries` row written by approval and targeted like a correction (D-22: the earliest DRAFT month after the source),
  frozen at the target's approval as a `CARRY_COMMISSION` line (SPEC §4's `kind` list grows), never a silent netting of tips (BR-06). **CS-Q29:** a card-tip side (card tips + card-tip corrections + the tip
  carry) that goes negative, e.g. a closed month's 10.000 card tip removed against 2.000 of card tips this month, shows
  −8.000, pays 0 card tips, and the −8.000 carries whole, as a `TIP_CARD` carry row (D-22) frozen as `CARRY_TIP_CARD`, into the target month's card
  tips; the tip carry and the commission carry never net each other (BR-06). **CS-Q8:** a correction for an employee
  who left posts normally in the next open statement under her name and shows to the owner in the final settlement, owed
  to her or by her. **CS-Q28:** the final settlement is no new screen: it is her row in that statement's «تصحيحات شهور
  سابقة» section (CM-50), flagged «سابت الشغل», with her section total labelled owed to her or by her; her carries land the same way and are not re-carried (D-22). **CS-Q9:** corrections display in their own section (CM-50).

### 55b — blocked corrections and period repair

- **FR-046** When the recompute of a closed month returns `NO_PLAN`/`NO_SALARY`, the consumer still marks the event consumed,
  records `commission_blocked_corrections (employee, source_period, code, first_event_id, target_period,
  target_statement_id)` (one open row per employee and month, later events reuse it) and posts nothing for that employee
  and month (SPEC §6). The stored `target_period`/`target_statement_id` is the **held month**: chosen **once**, when
  the block is first recorded, by D-13 under the locks of that event; it is never derived again, and later events, a code
  change or a REVIEWED month going back to DRAFT never move it. It is what FR-048 refuses to review or approve and where
  FR-049 shows the block, so it stays DRAFT while the block is open, and a DRAFT month after the source therefore always
  exists when the block is resolved. **The correction the resolution posts is not tied to it:** it is posted normally
  (SPEC §6), into the target D-13 chooses at posting time from the statuses its own lock call returned, which is the held
  month or an earlier month that is DRAFT by then (CM-53b). A stored posting target would put the correction in a later
  month than SPEC §6's earliest DRAFT period and so change which payroll month bears it.
- **FR-047** `POST /v1/businesses/:businessId/employees/:employeeId/commission-period-repairs` `{ period, plan }`
  (Idempotency-Key): allowed only while an open blocked correction **with code `NO_PLAN`** exists for that employee and month
  (a `NO_SALARY` block is resolved only by the dated salary, SPEC §6, and refused here with `COMMISSION_REPAIR_NOT_ALLOWED`;
  every recompute of an open block (after a repair, a salary, or a later event) sets its `code` to what the engine now
  returns, `NO_PLAN` ↔ `NO_SALARY` either way, on the same row; a resolved row never changes); the plan is validated
  like FR-006; stored as a plan version with `repair_period` (D-12, CS-Q11); audit `commission_plan.period_repaired`. In the
  same transaction the month is recomputed and the correction posted (FR-039) into the target D-13 chooses then (FR-046),
  under one `lockStatementPeriods` call that locks the source month through the business's current month in ascending
  order (every candidate, the held month among them); the block is resolved when the recompute succeeds and the held
  month is released.
- **FR-048** A month that is the stored `target_statement_id` of an open blocked correction, for any employee, cannot be
  reviewed or approved (SPEC §6); the check reads the stored target, never recomputes it.
- **FR-049** The blocked correction is visible on the view of its stored target statement and in a list `GET …/commission-blocked-corrections`
  (`queries/`). Notice (CS-Q19 = PP-17.7): when the consumer first records an open block it appends, in the same
  transaction, `CommissionCorrectionBlockedNoticeRequested` events to `notifications` (IN_APP, recipients the holders of the
  plan permission in the business, no amount and no customer data) in **groups of at most 100 recipients** (the
  `notificationRequest` cap, ADR-0037 §5): recipients de-duplicated by user id, sorted ascending, cut into consecutive
  groups, one event per group keyed `(block id, group index)`, all appended atomically with the block row (a failure rolls
  back the block and every group); a new commissions ⇒ notifications event row added by
  59-0. Permission for the repair: CS-Q1.

### 56 — Excel export

- **FR-050** `POST …/:period/exports` → 202 `{ render_id }` on the ADR-0049 transport (D-18). Before enqueueing, in its own
  transaction, the use case persists one **export request** row keyed by `render_id` (`commission_statement_exports`, §6):
  the statement id, business, period, requester user and membership, and the **authorized scope** resolved at request time
  (`BUSINESS` only for a business-wide reader, §6 _Permissions_, never for branch grants whose union covers every
  branch; else `BRANCHES` with
  `branch_ids` = _R_ and the employee set taken from **that approved statement's frozen `EMPLOYEE` rows** whose frozen branch
  set overlaps _R_, never from the live attachment rule, which can be edited after approval (FR-033, Codex 4336152044;
  CS-Q20 = PP-20.1, §6 _Permissions_). The job
  payload stays `{ company_id, render_id, kind }` (ADR-0049 §1); the worker document source loads the request by `render_id`
  under `withTenant`, refuses a missing one, reads only the frozen rows of that statement and those employees and, for a
  `BRANCHES` request, filters **every** frozen row by the saved `branch_ids`, never by the employee set alone (Codex
  4336086349): a row other than `EMPLOYEE` (lines, tips, sales, `CORRECTION` rows) is included only when its
  `attached_branch_ids` overlaps `branch_ids`, and an `EMPLOYEE` row only when its frozen branch set overlaps `branch_ids`,
  the same predicate as the closed statement's view (FR-033, CS-Q23); an employee transferred or attached to two branches
  in the month therefore contributes only her rows of the saved branches (CM-55f). It then closes the
  transaction and builds the workbook (binary output, D-18); poll and collect once. **The saved scope is an upper bound, never a
  grant:** at collection the API re-checks, in the collect transaction, that the collector is the requester and that her
  **current** authorization still covers the saved scope: the collect transaction recomputes her effective branch set _R'_
  with the same rules, and the saved `branch_ids` must be a subset of _R'_ (a `BUSINESS` request needs her to still be a
  business-wide reader) and every saved employee must still be in the set _R'_ lets her see. If the collector is **not** the requester, the request gets the transport's uniform 404 (ADR-0049 §1: another
  user, another company, an unknown or an expired id all answer the same 404) and the stored bytes are left untouched (the requester can still collect them). If the collector **is** the requester
  but her current authorization no longer covers the scope (a branch transfer, a revoked permission or membership, a new
  DENY on one of the saved branches), the
  bytes are discarded and the request is refused with the uniform 403, no workbook. Only a successful collect writes the audit entry
  (FR-052) and sets the request's `collected_at`.
- **FR-051** Columns include, per employee: employee number (row 8c) and name, both taken from the frozen row (FR-033), commission, sales commission, corrections received,
  card tips, cash tips (informational), and the net payable figure (CS-Q7), on the summary sheet; the detail sheet has one row per service; export only after approval: CS-Q10; detail rows carry the customer's full name (CS-Q15 = PP-17.3).
  No phone ever (SPEC §4, R1).
- **FR-052** Audit `commission_statement.exported` on each collected download. Permission: `read:commissions:business` (CS-Q14; a reader exports only the employees of her effective branch set, CS-Q20 = PP-20.1).

### 56b — reminders

- **FR-053** Discovery follows ADR-0037: a worker `commissions` consumer of `CompanyCreated` upserts the BullMQ job scheduler
  `commissions-statement-reminders-<companyId>` (hourly, job data `{ companyId }` only, outside any transaction); every
  `commissions.project-inputs` delivery upserts the same scheduler (repair of a lost Redis schedule); existing companies get a
  one-time controlled operator replay of `CompanyCreated` after the worker rolls out (runbook). **A lost Redis is
  detected, then recovered by the operator:** (1) _detection_: at start-up the worker **checks the fixed sentinel key before
  writing it**, and while running its existing heartbeat watches Redis's `run_id` and the sentinel. A missing sentinel at
  start-up (Redis lost while the worker was down, or a first deploy) or a changed `run_id` or vanished sentinel while
  running raises a durable **needs-recovery** flag **outside Redis**: one row in a global operational table
  `operational_recovery_flags`, an append-only ledger (`id`, `code`, `raised_at`, `cleared_at`, `cleared_by`; a partial
  `UNIQUE (code) WHERE cleared_at IS NULL` so one code has at most one open flag; D-24), keyed
  `COMMISSION_REMINDER_SCHEDULES_LOST`. The table holds no company data, so it is not a tenant table and reads no tenant
  (CLAUDE.md §5's rule is about tenant data; ADR-0054 §2 classifies it like the other global tables, ADR-0003). The
  worker raises a flag with `INSERT … ON CONFLICT DO NOTHING` and lists the open ones through `pospay_dispatcher` and its
  existing facade, with `SELECT, INSERT` on that table only and no `UPDATE`/`DELETE` for any runtime role
  (CS-Q31 decided, Waleed and Abu Salem, 2026-10-23: this role; 56b-1 amends CLAUDE.md §5 and ADR-0003 to name the grant); the outbox is not used
  because it is per company and would need a tenant.
  While the flag is open, `/ready` reports degraded and the alert with that fixed code is raised on every start; only
  then does the worker write the sentinel. The flag is cleared **only** by the operator's audited confirmation command
  (an owner-role script that names the id of the incident it confirms and writes `platform_audit_log` in the same
  transaction) after the `CompanyCreated` replay, never by a restart and never by the runtime; this check needs no company list.
  (2) _recovery_: the runbook's Redis-restore procedure gains a **mandatory** step, the same controlled operator replay of
  `CompanyCreated` used at rollout, which re-registers every company's scheduler, a quiet company's included. **No worker
  read spans all companies** (CLAUDE.md §5 allows only the outbox dispatcher to); an automatic repair without an operator
  would need such a read and therefore an ADR and Waleed's approval before it is built.
  **_CS-Q32_ (decided 2026-10-23, Waleed and Abu Salem) supersedes the operator parts above**: the clear by the
  operator's command, the mandatory replay as the recovery path, and "no worker read spans all companies". 56b-1 starts
  with a new ADR that defines, before any code: (a) the worker's narrow read of company ids only (ADR-0038 covers only
  the one-shot migrate step on the migration owner, and no runtime role bypasses RLS); (b) the worker's clear: a narrow
  privilege for the clearing role (CS-Q31 granted `SELECT` and `INSERT` only), naming the incident id it rebuilt, in one
  transaction with its audit record (`platform_audit_log` is insert-only for `pospay_auth` today, so the ADR names the
  audit path), and `cleared_by` set to a fixed system identity the ADR names (the ledger requires it with `cleared_at`); (c) the generation guard: the worker clears only if the Redis `run_id` and sentinel it saw when the
  rebuild started are still current, and a loss detected during the rebuild restarts it and never clears; the worker
  keeps the `run_id` it rebuilt for, and a change its heartbeat sees after the clear raises a new flag, so a loss that
  lands between the check and the clear is never absorbed; (d) the
  retry: companies whose rebuild failed are retried with a bounded backoff while the flag stays open, `/ready` stays
  degraded and the alert repeats; (e) the flag clears only when every company succeeded (Waleed's design note,
  owner-questions §32). The operator's audited clear command and the `CompanyCreated` replay stay only as the documented
  fallback. The job reads the
  company's businesses and their timezones under `withTenant` through the tenancy reader bound at the root (D-16) and,
  for each business whose local time has passed 09:00 (CS-Q17 = PP-17.5), emits `StatementAwaitingApproval` on
  the 3rd and the 5th for the previous month while it is not APPROVED or PAID. For each business, in **one** transaction, the job first reads the business's `commissions` feature under
  `withTenant` and, when it is off, ends the transaction without writing anything (no statement row, no ledger row, no
  event; Codex 4336601165, 4336673731, 4336788662); otherwise it calls `lockStatementPeriods` for the previous month
  in that same transaction, which **creates the DRAFT row if the business was quiet**
  (no input, no plan write, no generate) and locks it, then rechecks the status under the lock, then inserts the
  `commission_statement_reminders` ledger row (`UNIQUE (company_id, statement_id, kind, reminder_date)`, once per day) and
  the grouped notice events (FR-030); a business is never skipped for having no statement row. Zero recipients is a durable
  decision.
- **FR-054** Recipients and channels are put in the event by commissions (SPEC §3); until row 62 the interim rule is an
  in-app bell at 09:00 business time to the approvers who are business-wide readers (FR-030, CS-Q17 = PP-17.5, the
  ADR-0037 precedent), and row 62 must list both
  kinds in its switches.
- **FR-055** (CS-Q16 = PP-17.4) `StatementAwaitingReview` is emitted by the same job on the 3rd only, in the same run as the
  owner's reminder, while the previous month is still DRAFT, to the holders of `review:commissions:business` who are business-wide
  readers (FR-030; ledger kind `REVIEW_DAY3`). Both events are registered in `NOTIFICATION_SOURCE_EVENTS` and the worker's
  known types, with ar/en templates, before any producer (the 35d order).

## 6. Slice design

### Business rules

- **BR-01** Money moves only through the engine (SPEC §5); the consumer, the views, the export and the screens add and display,
  never price.
- **BR-02** A closed month never changes; every later change is a correction in the earliest DRAFT month after it (SPEC §6).
  The one controlled exception is the owner's erasure rule (D-21): an erased customer's frozen name is replaced by a
  placeholder, nothing else.
- **BR-03** Every writer of a month's inputs and every status change takes the month's lock through one helper, ascending.
- **BR-04** Missing configuration is never zero (D-57).
- **BR-05** Commissions never reads an orders or staff table; it learns inputs from events and from root-bound readers
  (ADR-0041 §6, SPEC §3).
- **BR-06** Tips are never priced or thresholded and never netted against commission (D-36). CS-Q7 carries a negative
  commission by itself into next month's commission; CS-Q29 carries a negative card-tip side by itself into next
  month's card tips; the two carries never net each other.

### Fingerprint

Two fingerprints (D-6), both serialized by `canonicalJson`, hashed with SHA-256 and stored as lowercase hex.

**The input fingerprint** (`current_fingerprint`, `reviewed_fingerprint`, `input_fingerprint`). The canonical input of one business and month: for each employee in ascending id, the ACTIVE projected lines of the month
(`line_id`, `revision`, `occurred_at`, `recorded_at`, `business_date`, `net_share`, `share_bps`, `rule_snapshot`, `counts`),
the sales (`sale_id`, `revision`, `price_paid`, `refunded_amount`), the tip rows (`session_id`, `revision`, `method`, `amount`),
the salary entry selected for the month's last day (SPEC §5.5), the plan versions and overrides that can apply in the month,
the corrections received by the month, the open blocked corrections whose stored `target_statement_id` is this month's
statement, the incoming carries whose `target_statement_id` is this month's statement (`source_statement_id`, `kind`, `amount`, D-22). Every list sorted by its identity; money as KWD strings. **The branch attribution is not in
the input fingerprint** (D-26; ADR-0054 §6): the input fingerprint is exactly what a writer's change moves (D-6). Staff
publishes no event for a branch-link change, so no writer can return the statement to DRAFT when one happens; the change
is visible in the **statement fingerprint** below, which carries the attachment rows and every `attached_branch_ids`: the
view shows the statement as changed since review (cause `STATEMENT`), and approval refuses it with 409
`COMMISSION_FINGERPRINT_STALE` until it is reviewed again (D-5's second line of defence, CM-32b, CM-34e). When both
fingerprints differ, the cause reported is `INPUTS`.

**The statement fingerprint** (`reviewed_statement_fingerprint`, `statement_fingerprint`). The canonical form of the rows
approval freezes, built from the same columns on both sides: every statement row sorted by `(employee_id, source_ref)`
with `kind`, `amount`, `previous_amount`, `new_amount`, `source_period`, `source_branch_id`, `source_branch_name_ar`,
`source_branch_name_en` (both null when `source_branch_id` is, D-20), `source_business_date`,
`attached_branch_ids` (sorted), the employee label (`employee_number`, `employee_name_ar`, `employee_name_en`) and, on a
line source, `line_id`, `session_id`, `service_id`, `service_name_ar`, `service_name_en`, `customer_id`, `customer_name`,
`business_date`; then every attachment row sorted by `(employee_id, branch_id, attached_from)` with `attached_to`. Row
ids, `statement_id`, `company_id`, `business_id` and timestamps are left out (they do not exist before the freeze). Money
as KWD strings. At review it is computed from the statement builder's output (FR-026); after the freeze, from the rows
read back (FR-032). Labels are in it because they are what the reviewer saw and what is frozen: a rename between review
and approval refuses the approval until the statement is reviewed again, and never freezes a name nobody reviewed.

### Schema changes

Every table: tenant PK `(company_id, id)` (ADR-0007), `business_id`, `FORCE` RLS with the tenant policy, tenant-and-business
qualified FKs, the exact grants listed, a negative isolation test, an entry in the privilege allowlist and its indexes in the
same migration (CLAUDE.md §5). Expand-only; migration numbers are taken at merge.

| Table | Columns (beyond company_id, id, business_id) | Constraints and grants |
| --- | --- | --- |
| `commission_statements` (48a) | `period char(7)`, `status`, `current_fingerprint`, `reviewed_fingerprint`, `reviewed_statement_fingerprint`, `reviewed_by`, `reviewed_membership_id`, `reviewed_at`, `input_fingerprint`, `statement_fingerprint`, `approved_by`, `approved_at`, `revision`; the payment columns `paid_by`, `paid_at`, `paid_on date`, `paid_method` (and its note, CS-Q6) are added by 54-1 (expand-only), not 48a-2 | `UNIQUE (company_id, business_id, period)`; `UNIQUE (company_id, business_id, period, id)` (the target key of `commission_carries`' two FKs, D-22); `CHECK` period format; FR-001 trigger; `SELECT, INSERT, UPDATE (status, …)` to `pospay_app` |
| `commission_plan_versions` (48) | `employee_id`, `version`, `effective_from date`, `whole_period`, `repair_period char(7) NULL`, `plan jsonb`, `created_at`, `created_by` | `UNIQUE (company_id, employee_id, version)`; `CHECK NOT (whole_period AND repair_period IS NOT NULL)`; insert-only (`SELECT, INSERT`) |
| `commission_service_overrides` (49) | `employee_id`, `service_id`, `rule_kind`, `rule_value`, `effective_from`, `created_at`, `created_by` | `CHECK` per kind (bps 0…10000, mills ≥ 0); index `(company_id, employee_id, service_id, effective_from)`; insert-only |
| `commission_line_heads` (50) | `line_id`, `session_id`, `branch_id`, `service_id`, `customer_id`, `revision`, `status`, `business_date`, `period` | `UNIQUE (company_id, line_id)`; `SELECT, INSERT, UPDATE` |
| `commission_lines` (50) | `line_id`, `branch_id`, `employee_id`, `service_id`, `occurred_at`, `recorded_at`, `business_date`, `period`, `net`, `net_share`, `share_bps`, `rule_kind`, `rule_value`, `counts`, `status` | `UNIQUE (company_id, line_id, employee_id)`; index `(company_id, business_id, period, employee_id)`; `SELECT, INSERT, UPDATE, DELETE` (a projection, D-11) |
| `commission_tip_heads` / `commission_tips` (50) | head: `session_id`, `branch_id`, `revision`, `business_date`, `period`; rows: `session_id`, `employee_id`, `method`, `amount` | `UNIQUE (company_id, session_id)` / `UNIQUE (company_id, session_id, employee_id, method)`; projection grants |
| `commission_salaries` (50) | `employee_id`, `effective_from`, `amount`, `revision` | `UNIQUE (company_id, employee_id, effective_from)`; projection grants; never logged (SPEC §12) |
| `commission_sales` (50) | `sale_id`, `branch_id`, `seller_employee_id NULL`, `business_date`, `period`, `price_paid`, `refunded_amount`, `status`, `revision` | `UNIQUE (company_id, sale_id)`; projection grants |
| `commission_statement_lines` (48a) | `statement_id`, `employee_id`, `employee_number`, `employee_name_ar`, `employee_name_en` (the label frozen at approval), `source_ref`, `kind`, `amount`, `previous_amount NULL`, `new_amount NULL` (on the three correction kinds only, copied from the correction, CS-Q9), `source_period NULL`, the **source's** `source_branch_id` (where the work was done, for display) and its name frozen at approval, `source_branch_name_ar NULL` / `source_branch_name_en` (CS-Q35, migration 0191 of 56-1b-fz; CHECK `commission_statement_lines_source_branch_name`: the English name is present exactly when `source_branch_id` is, and the Arabic name is NULL when `source_branch_id` is NULL), `source_business_date` and `attached_branch_ids uuid[]` (the filter key: on a source row, every branch the employee was attached to on `source_business_date`; on the `EMPLOYEE` row, every branch she was attached to during the month plus the `attached_branch_ids` of every correction frozen for her in this statement (FR-033); copied at freeze from the projection and the attachment snapshot for a line, a sale or a tip, and from the correction row for a correction; `source_branch_id` and `source_business_date` are NULL only on the `EMPLOYEE` row and the two carry kinds `CARRY_COMMISSION` and `CARRY_TIP_CARD` (D-22)), and for a line source (`COMMISSION`, or a `CORRECTION` of a `line:<id>`) the frozen detail `line_id`, `session_id`, `service_id`, `service_name_ar`, `service_name_en`, `customer_id`, `customer_name`, `business_date` (NULL otherwise; D-20; never a phone) | `UNIQUE (company_id, statement_id, employee_id, source_ref)`; `CHECK` `previous_amount` and `new_amount` not null exactly on `CORRECTION`, `CORRECTION_TIP_CARD`, `CORRECTION_TIP_CASH`, and there `amount = new_amount − previous_amount`; GIN index on `attached_branch_ids` (the branch filter); insert-only (the erasure exception of D-21 is added by the deferred customer-erasure item, not here); a trigger refuses an insert unless its statement row is APPROVED **and** was set to APPROVED by the current transaction (48a-2 picks the mechanism, e.g. the row's `xmin` against the current transaction id, and tests both sides) |
| `commission_statement_attachments` (48a) | `statement_id`, `employee_id`, `branch_id`, `attached_from date`, `attached_to date` (one `EmployeeBranch` link clipped to the month, read once in the approval transaction, FR-033) | `UNIQUE (company_id, statement_id, employee_id, branch_id, attached_from)`; index `(company_id, statement_id, employee_id)`; insert-only; the same insert trigger as `commission_statement_lines` |
| `commission_period_generations` (55) | `employee_id`, `period`, `generation` | `UNIQUE (company_id, employee_id, period)`; `SELECT, INSERT, UPDATE (generation)` |
| `commission_corrections` (55) | `employee_id`, `source_period`, `target_period`, `target_statement_id`, `source_ref`, `kind`, `amount` (signed, the delta), `previous_amount`, `new_amount`, `generation`, `event_id`, `created_at`, `source_branch_id`, `source_business_date`, `attached_branch_ids uuid[]` (where the corrected line, sale or tip was done, its business date, and every branch the employee was attached to on that date; copied from the frozen row of that source when one exists, else resolved once by the first correction from the source month's frozen attachment snapshot, FR-040) | `UNIQUE (company_id, source_period, employee_id, source_ref, generation)`; `CHECK (amount = new_amount − previous_amount)`; index `(company_id, business_id, target_period)`; GIN index on `attached_branch_ids`; insert-only |
| `commission_carries` (51-1, written by 53-2) | `employee_id`, `kind` (`COMMISSION`, `TIP_CARD`), `amount` (the negative balance), `source_statement_id`, `source_period`, `target_period`, `target_statement_id`, `created_at` (no branch set: a carry belongs to no branch day, D-22) | `UNIQUE (company_id, source_statement_id, employee_id, kind)`; `CHECK (amount < 0)`; `CHECK (target_period > source_period)`; composite FKs `(company_id, business_id, source_period, source_statement_id)` and `(company_id, business_id, target_period, target_statement_id)` → `commission_statements (company_id, business_id, period, id)`, so both statements belong to the carry's business and its recorded months; a composite FK `(company_id, business_id, employee_id)` → `employees (company_id, business_id, id)` (the `employees_company_business_id_key` that the staff tables already reference), so the employee belongs to the carry's company and business (issue #509 item 1); an index on each FK's exact columns, `(company_id, business_id, employee_id)` for the employee FK, `(company_id, business_id, source_period, source_statement_id)` and `(company_id, business_id, target_period, target_statement_id)` (the second also serves the target statement's read); insert-only (D-22) |
| `commission_blocked_corrections` (55b) | `employee_id`, `source_period`, `code`, `first_event_id`, `target_period char(7)`, `target_statement_id` (the held month, chosen once by D-13 when the block is recorded; not the posting target, FR-046), `created_at`, `resolved_at NULL`, `resolved_generation NULL` | partial `UNIQUE (company_id, employee_id, source_period) WHERE resolved_at IS NULL`; tenant-qualified FK `target_statement_id` → `commission_statements`; partial index `(company_id, target_statement_id) WHERE resolved_at IS NULL` (FR-048); `SELECT, INSERT, UPDATE (code, resolved_at, resolved_generation)` (never the target); a trigger allows `code` to change (`NO_PLAN` ↔ `NO_SALARY`) only on an open row and refuses any change to a resolved row |
| `commission_statement_returns` (52) | `statement_id`, `returned_by`, `returned_membership_id`, `reason`, `returned_at` | `CHECK` reason 1…500 trimmed; insert-only; reason never logged |
| `commission_statement_exports` (56) | `render_id`, `statement_id`, `period`, `requested_by`, `requested_membership_id`, `scope` (`BUSINESS` / `BRANCHES`), `branch_ids uuid[] NULL` (the reader's effective branch set at request time: a business-wide holder with a DENY on one branch is `BRANCHES` with every other branch), `employee_ids uuid[] NULL` (the ids of the statement's frozen `EMPLOYEE` rows whose frozen branch set overlaps `branch_ids`, FR-050), `requested_at`, `collected_at NULL` | `UNIQUE (company_id, render_id)`; `CHECK` (`scope = 'BRANCHES'`) = (`branch_ids` and `employee_ids` not null) and `cardinality(branch_ids) > 0` when not null; `SELECT, INSERT, UPDATE (collected_at)` |
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
| CM-R08 | `commission_statement_lines`, `commission_statement_attachments` | 48a-2 |
| CM-R09 | `commission_statement_reminders` | 56b-1 |
| CM-R10 | `commission_statement_exports` | 56-1 |
| CM-R11 | `commission_carries` | 51-1 |

Plus, in 53-1, the ADR-0012 objects (role `pospay_approval_reader`, function, policies, outbox index) with the six types (D-9).

### Events and the module map

- **Consumed:** the six input types (FR-014), consumer id `commissions.project-inputs`; and `CompanyCreated` (identity), by a
  separate worker `commissions` consumer that only registers the reminder scheduler (FR-053, registered in 56b-1). `ServiceCompleted` is not consumed:
  it was replaced by `ServiceLineChanged` (ADR-0010) and the batch recording events (ADR-0041 §4).
- **Published:** `StatementAwaitingReview`, `StatementAwaitingApproval` (SPEC §3, `docs/module-map.md`) and
  `CommissionCorrectionBlockedNoticeRequested` (FR-049, registered in 55-2), to `notifications`,
  with recipients, channels and safe ar/en parameters (business, month; never an amount, never a name of a paid employee).
  Each has an Arabic doc comment in `events/published.ts` (CLAUDE.md §3.1).
- **Arrows:** two new **event** rows in `docs/module-map.md`: `CompanyCreated` (identity) consumed by worker `commissions`
  (added by 56b-1) and `CommissionCorrectionBlockedNoticeRequested` commissions ⇒ notifications (added by 55-2);
  `StatementAwaitingReview`/`StatementAwaitingApproval` are already declared. No new **import** arrow (D-16); the root-bound readers are: business timezone (tenancy), service names (catalog),
  recipients (identity), the employee's business and dated branch attachments (staff, FR-018b, FR-033; Codex
  4336865773), customer full names (customers, D-16/D-20), tips and package-sales bootstrap (orders,
  D-15; lines and salaries are replayed from the outbox, not read through a port). 59-0's ADR lists each binding, and 59-0 adds each as a **Port** row in `docs/module-map.md` §3 (a Port row has no
  YAML line: a `reads:` line needs an adapter file and an import arrow, D-29), as the root-bound `DaySessionsPort` is declared there (Codex 4336601176). A root-bound read adds a Port row but
  no **import** arrow; that is what D-15/D-16's "no module-map arrow" means.

### Permissions

| Code | Who by default | Status |
| --- | --- | --- |
| `manage:commission-plans:business` (proposed) | owner and accountant by default; only the owner grants it to anyone else or revokes it (CS-Q1, Abu Salem 2026-10-22, replacing Waleed's recommended owner / general manager / business manager; CS-Q27, Abu Salem 2026-10-23, added the accountant as a default holder, replacing Waleed's owner-only pick; FR-010) | new; plan versions, overrides, period repair |
| `read:commissions:business` | owner, general manager, business manager, accountant **and branch manager** (CS-Q14 = PP-17.2, against the recommendation); grantable | new; estimate of all employees, statement view, export. A holder sees only the employees of her effective branch set (CS-Q20 = PP-20.1, below) |
| `review:commissions:business` | owner, general manager, business manager (CS-Q2b = PP-25.1, Waleed 2026-10-21; CS-Q2, Abu Salem 2026-10-22, the same); granted and revoked **by the owner only**, to any user he chooses (52-1 registers both codes as owner-grantable only; if spec 009's grant flow has no per-code granter rule yet, 52-1 adds it for these two codes); usable only by a business-wide reader (CS-Q26 = PP-24.1, FR-029), and the grant screen warns of it (FR-029b) | named by SPEC §6 |
| `approve:commissions:business` | owner (D-17, SPEC §11; CS-Q5, Waleed 2026-10-21); granted and revoked **by the owner only**, to a named person (52-1 registers both codes as owner-grantable only; if spec 009's grant flow has no per-code granter rule yet, 52-1 adds it for these two codes); usable only by a business-wide reader (FR-036, from PP-24.1), and the grant screen warns of it (FR-029b) | named by SPEC §6 |
| `pay:commissions:business` | owner, general manager and accountant; grantable to anyone (CS-Q4, both owners 2026-10-22) | named by SPEC §6 |

**Branch scope (CS-Q20 = PP-20.1):** every read and export first resolves, in the read's own transaction, the reader's
  **effective branch set** _R_ with the existing guard's rules (spec 009: union of active memberships, DENY wins, expired
  overrides ignored), through the identity reader bound at the root (D-16): _R_ is the union of the branches of the
  business covered by every active membership and current ALLOW that grants `read:commissions:business` (a company- or
  business-scoped grant covers every branch of the business, a branch-scoped one that branch), minus every branch covered
  by a current DENY of that permission, at any scope and from any of her memberships. An empty _R_ (no grant, or a
  business-wide ALLOW with a business-wide DENY) is the uniform 403, never an empty list. She sees the employees attached
  to **any** branch of _R_ (an `EmployeeBranch` link to one of them on any day of the month, read through the staff reader
  bound at the root, D-16), **or who received a correction in the month whose `attached_branch_ids` overlaps _R_** (so an
  open month lists the same employees its frozen statement will, FR-033; Codex 4336446480), each with the rows of the days
  she was attached to a branch of _R_ and those corrections, under the per-day rule
  below (the whole month only when those attachments cover every day of it), including lines she performed at another
  branch on those days; other employees are absent, not zeroed. **No branch filter applies only to a business-wide reader**: one who holds a current
  company- or business-scoped grant of `read:commissions:business` (a membership or an ALLOW) **and** has no current DENY
  of it at any scope. She sees every employee and every frozen row, including one whose `attached_branch_ids` is empty.
  Every other reader keeps the overlap filter on _R_ and never sees an empty-set row, **including a reader whose
  branch-scoped grants happen to cover every branch of the business**: a union of branch grants is not a business-wide
  grant (CS-Q20 authorizes a branch manager for the employees attached to her branches, nothing more), and a business-wide
  holder with any DENY is filtered too (CM-23g). The filter applies
  to the estimate, the statement view and the export alike. **An employee attached to
  two branches in the same month** (CS-Q23 = PP-21.2): each branch-scoped manager sees **only the days and the work of her
  own branch**: every line, tip and package sale of the employee whose business date falls on a day she was **attached** to
  that branch (`EmployeeBranch` from/to); work she performed **at another branch** on such a day is shown to the manager of
  the branch she is attached to, and not to the manager of the branch where it was done (CS-Q24 = PP-22.1), each with the amount the full-month engine run gave it (tier positions are never
  recomputed per branch); a correction follows the attachment day of the line, sale or tip it corrects. The attachment is the filter key (`attached_branch_ids` overlaps _R_); where the work happened (`source_branch_id`) is shown, never filtered on. Her visible figures are a subtotal of that part, labelled as
  partial whenever a row of her month is outside _R_; a reader whose _R_ holds a branch she was attached to on every day of the month sees her whole month, unlabelled, unless she has an incoming carry (D-22): a carry belongs to no branch, no branch reader sees it, so her figures are then labelled partial. **The one rule for any number of attachments, overlapping or not**, derived from CS-Q23, CS-Q24 and CS-Q25 together (PP-21.2, PP-22.1, PP-23.1), not a new owner question: **each branch manager sees all of the employee's work on the days she was attached to that manager's branch, wherever the work was done; an attachment that covers the whole month shows the whole month.** A transfer (CS-Q23) gives each manager her own days; work at another branch (CS-Q24) follows the attachment day; two attachments lasting the whole month (CS-Q25) give each manager the whole month; an attachment added or ended mid-month while another stays (spec 017 allows dated changes that keep another active branch) gives that branch's manager only its days, and the other manager every day of hers (CM-23h). This is exactly what the per-day filter gives: a row's `attached_branch_ids` holds **every** branch the employee was attached to on that row's business date (§6 _Schema_, FR-033), and the reader sees the row when it overlaps _R_; no read path special-cases any of these (CM-23c, CM-23f, CM-23h). PP-21.2 and PP-22.1 refine PP-20.1 for a transferred
  employee only; an employee attached to one branch all month is unchanged. `SessionTipsChanged` already carries
  `branch_id`; row 42's `PackageSaleChanged` must carry the sale's `branch_id` with its `business_date` (FR-018).

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
- `COMMISSION_FINGERPRINT_STALE` 409 — details `current_fingerprint`, `current_statement_fingerprint`, `changed` (`INPUTS`
  or `STATEMENT`; `INPUTS` when both differ, D-26), and `return_required` (true when the statement is REVIEWED, so the screen offers the return to DRAFT of
  FR-031 instead of a retry that would fail the same way).
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
| **59-0** | ADR and map, no behaviour | 1. ADR: the `packages/commissions-engine` package (D-17, CS-Q13 = PP-17.1), the global `operational_recovery_flags` ledger and its grants (FR-053, D-24; the role choice is decided, CS-Q31, 2026-10-23, but 59-0 still changes neither CLAUDE.md §5 nor ADR-0003: 56b-1 amends them) and its CLAUDE.md §2.1 row, consumer id, root-bound readers (D-15/D-16), the read-use-case exception (D-7, D-25), the two fingerprints (D-6, D-26). 2. `docs/module-map.md`: the `packages_restricted` row with its generated YAML, and §3 Port rows (D-29); a one-line pointer in CLAUDE.md §6 and CLAUDE.architecture.md §7 to the read-use-case exception. 3. ADR-0012 addendum (six types, D-9; the statement fingerprint recomputed from the frozen rows after the freeze, FR-032, D-27), ADR-0049 addendum (binary output contract, the xlsx kind and the per-kind renderer admission, D-18, D-28) | this spec; design advisors (done 2026-10-22) | 150–250 |
| **48a-1** | `packages/commissions-engine` (D-17) | 1. Package scaffold, `packages/domain` its only dependency, and the browser-safe `validation` entry point. 2. Move the engine and its tests unchanged. 3. Rewire the api imports; the enforcement of D-23: the package `exports` (`.` and `./validation` only), the ESLint `no-restricted-imports` scopes with their admin lint test (the root refused, `/validation` allowed), the extension of the `lint:docs` JSDoc rule to the package, and the module-map check; the commissions module's `domain/` is left empty | 59-0 | 150–300 (moves) |
| **48a-2** | Statements and the lock | 1. `commission_statements` + RLS + grants + FR-001 trigger + negative tests, and the two frozen-statement tables `commission_statement_lines` and `commission_statement_attachments` (schema, RLS, grants, the insert-only trigger, CM-R08), so 55-1's seed (FR-044) and 53-2's freeze both find them. 2. `lockStatementPeriods` (with the injected `IdGenerator`, FR-002) + typed errors. 3. Lock tests CM-01…CM-04 and the FR-004 check | 48a-1 | 400–540 |
| **48-1** | Plan storage and contracts | 1. Zod contracts and OpenAPI. 2. `commission_plan_versions` + RLS. 3. The plan permission (CS-Q1, Abu Salem; its default roles, the owner and the accountant, and its grant policy per CS-Q27) and its role defaults (`owner` and `accountant` in `packages/db/src/role-defaults.ts`), added to `deviceForbidden` (a device can never hold it, FR-010), to `OWNER_GRANTED_PERMISSIONS` in identity and `packages/db` (a non-owner cannot save an ALLOW) and to identity's `OWNER_ONLY_EDIT_PERMISSIONS` (a non-owner cannot revoke it), with tests for a refused non-owner `SAVE` and `REVOKE` and for the accountant holding it by default; a **seeding migration** grants the permission to the `accountant` role of every existing company (and to `owner`), as #510 did for its permission, with a test that an accountant of a company created before the migration holds it | 48a-2 (CS-Q27 answered: owner and accountant by default, owner-granted, FR-010) | 250–380 |
| **48-2** | Create and list plan versions | 1. Use case (FR-007/FR-008) and ports. 2. HTTP + list query + `EXPLAIN`. 3. CM-05…CM-08, CM-10 | 48-1 | 350–480 |
| **48-3** | The builder screen | 1. Blocks with switches, validated before submit through `packages/commissions-engine/validation` (D-17). 2. History list. 3. ar/en keys, component tests (CM-06 builder half, CM-09) | 48-2 | 300–450 |
| **49-1** | Overrides | 1. Contracts + table + RLS. 2. Use case + HTTP + list. 3. CM-11…CM-13 | 48-2 | 350–480 |
| **49-2** | Overrides screen | 1. Per-employee service table. 2. Edit dialog. 3. ar/en keys, component tests | 49-1, 48-3 | 200–320 |
| **50-0** | Outbox replay facade for lines and salaries (`packages/db`; was the orders line reader, D-15 decided 2026-10-25) | 1. A bounded, typed replay facade on `createOutboxDispatcherDatabase` (`pospay_dispatcher`), following `serviceSessionReplayPage` / `readServiceSessionReplayPage` in `packages/db/src/dispatcher.ts`, covering `ServiceSessionRecorded`, `ServiceSessionLinesAdded`, `ServiceLineChanged` and `SalaryChanged`: company-qualified, UUID checkpoint, fixed upper bound, keyset paging, published and unpublished rows alike, no join to `consumed_events`. 2. **An index-only migration** (`CREATE INDEX CONCURRENTLY`, extending the 0132 `outbox_service_session_replay_idx` shape to the four types; `packages/db/schema/outbox.ts` updated): no column, no function, no grant, no `BYPASSRLS`. 3. Shape, paging, isolation (a page never returns another tenant's row) and `EXPLAIN` tests, modelled on `service-session-replay-explain.spec.ts` | 59-0; D-15 (decided) | 200–300 |
| **50-1** | Line projection | 1. Line tables + RLS. 2. Consumer for the three line event types with guards, locks, mark (FR-015). 3. CM-14…CM-17, CM-21, CM-22a, CM-26 | 48a-2, 48-2, 49-1 | 450–600 |
| **21-a** | `SalaryChanged` carries `business_id` (staff producer amendment) | 1. Contract: add `business_id` as an **optional** field (legacy events published before 21-a have none and must still parse for the backfill), from the salary row (`employee_salaries.business_id`). 2. The set-salary writer fills it; its Arabic doc comment updated. 3. Tests that every newly produced event carries it (the producer always sets it) and that a legacy event without it still parses | this spec | 80–150 |
| **50-2** | Tips and salaries | 1. Tip and salary tables + RLS. 2. Their consumer handlers. 3. CM-18, CM-19, CM-25 (handler half: a published, unmarked `SalaryChanged` is applied once; the backfill run is 50-3's) | 50-1, **21-a** | 350–480 |
| **50-3** | Bootstrap | 1. The root binding of 36-5 (tips). 2. The idempotent bootstrap job: it replays the 50-0 events to `commissions.project-inputs` (read as `pospay_dispatcher`; effect and mark through `pospay_app` `withTenant` with `createDeliverer`, never resetting `published_at` or a consumed mark), keeps the 36-5 tips reader, and discharges the event ids. 3. CM-24 race and coverage tests, CM-25 backfill run, runbook (checkpoint and counts as in `docs/runbook.md` 35b-2). **Must handle, not designed here:** (a) every worker replica runs the commissions consumer, or the old dispatchers are drained, before the replay's upper bound is captured, so an old replica cannot mark a new event published without applying it; (b) line coverage is proven against orders' saved state, per ADR-0041 §6 and the 35b-2 runbook precedent (a replayed-event count alone does not detect a missing retained event), and approval stays closed when a retained event is missing; `TODO(spec)`: how that proof is measured is not decided; (c) salary coverage is proven against the authoritative salary history rows, and approval stays closed on any mismatch (`TODO(spec)`: not decided); (d) after 50-3 has run, a worker rollback to a release without the commissions consumer must re-run the replay with a new upper bound before approval reopens, or the rollback must be blocked (`TODO(spec)`: not decided); (e) a legacy `SalaryChanged` published before 21-a has no `business_id`, so 50-3 must define how it is routed to a business without crossing the module boundary (FR-018b names the staff-owned reader bound at the root, and ADR-0054 section 4 says salaries are not an orders binding), and until it does approval stays closed (`TODO(spec)`: not decided) | 50-1, 50-2, **36-5**, 50-0 | 300–420 |
| **50-4** | Package sales | 1. Sales table + RLS. 2. Handler and the root binding of `listCurrentPackageSales`. 3. CM-20, CM-20b (bootstrap, coverage, race) | 50-1; row 42 (producer with `business_date`, and its reader) | 250–380 |
| **50-a** | Engine input assembly (FR-022) | 1. The pure assembly function in `packages/commissions-engine`. 2. Its types for lines, sales, salary, versions, overrides, tips and corrections. 3. Unit tests (every input kind, the selected salary, ACTIVE-only lines) | 48a-1 | 150–250 |
| **50-5** | Estimate on read | 1. The read use case (D-7, D-25: folder `get-commission-estimate/`) over the 50-a assembly, with the `{ readOnly: true }` option of `withTenant` its adapter needs. 2. HTTP + permission (`read:commissions:business` with the branch scope of CS-Q20 = PP-20.1). 3. CM-23, CM-23b, CM-23c, CM-23d, CM-23e, CM-23f, CM-23g, CM-23h | 50-a, 50-1, 50-2, 50-4, 55-1 | 300–420 |
| **51-1** | Generate and fingerprint | 1. Canonical input (pure) + hash port, and the statement builder with its statement fingerprint (D-6, FR-026), reading `commission_carries` (D-22; its table, RLS and negative isolation test come with this sub-PR, which also adds the incoming carries to 50-5's estimate; 53-2 writes it) and the round-trip unit test of CM-34e. 2. Generate/GET use cases and HTTP. 3. CM-27…CM-29 (CM-28c included), CM-R11 (the named isolation test of `commission_carries`: company B reads 0 of A's rows and every insert for A fails as B), and the statement-view part of CM-23d, CM-23e, CM-23f, CM-23g and CM-23h. The sub-PR also fixes the full canonical contract of both fingerprints (D-26) | 50-5 (CS-Q7 and CS-Q29 answered: the two carries, FR-045) | 350–480 |
| **55-1** | Corrections | 1. Generation and correction tables + RLS. 2. The correction step in the consumer (FR-039…FR-042). 3. CM-43…CM-49 on seeded closed months (FR-044; CM-48c's concurrent approval is the FR-044 seed transaction under the lock), and CM-22 (crash between projection write and correction insert) | 50-a, 50-1, 50-2, 48a-2 (CS-Q7, CS-Q28 and CS-Q29 answered, FR-045) | 450–600 |
| **55-2** | Blocked corrections and repair | 1. Blocked table + engine `repair_period` rule (D-12, CS-Q11). 2. Repair use case + HTTP + list, and the blocked-correction bell (FR-049: event contract, template, registrations, its `docs/module-map.md` event row). 3. CM-51…CM-54, CM-53b (the stored target, FR-046/FR-048) | 55-1 (CS-Q11 answered) | 400–550 |
| **52-1** | Review | 1. The statement permissions `review:commissions:business` and `approve:commissions:business` with their defaults (approve: owner only, CS-Q5; review: owner, general manager and business manager, CS-Q2b = PP-25.1) and owner-only granting (CS-Q2, CS-Q5), and the grant-screen warning (FR-029b), so `StatementAwaitingApproval`, first emitted here, has a defined recipient set from its first release; 53-2 adds only the approval guard (FR-036). 2. Review use case (storing both fingerprints, FR-029) + HTTP + REVIEWED→DRAFT on writers (D-5) + the return by hand (FR-031, `commission_statement_returns` + RLS), and the `StatementAwaitingApproval` contract, template and registrations it emits (Codex 4336152050: three subtasks). 3. CM-30…CM-33, CM-33b, CM-33c, CM-33d and the FR-029b grant-screen UI test | 51-1, 55-2 | 350–480 |
| **53-1** | The ADR-0012 count | 1. Role, function (six types), grants, policies, index. 2. Privilege inventory. 3. ADR-0012 §4 groups 1–4 and 7 (CM-39) | 59-0; design advisors | 350–500 |
| **53-2** | Approve | 1. Use case + freeze (FR-032…FR-034) with the bootstrap coverage check, the attachment snapshot write (its table comes from 48a-2), the post-freeze statement-fingerprint recompute, and correction rows frozen with `previous_amount`, `new_amount` and the delta (CS-Q9 then decides only the display, in 53-3), and the carry rows of the month's negative balances (D-22). 2. HTTP and the approval guard (FR-036) on the permission 52-1 registers. 3. CM-34, CM-34b, CM-34c, CM-34d, CM-34e (integration part), CM-35, CM-37, CM-38, CM-38b, and the carry writer (D-22): a month with a negative commission subtotal and a negative tip side writes both kinds separately into the earliest DRAFT month after it (a REVIEWED month skipped), and a departed employee's carry is not re-carried | 52-1, 53-1, 55-2, **50-3, 50-4** (D-15 coverage) (CS-Q22 answered) | 400–550 |
| **53-3** | Approval races and screens | 1. CM-36 barrier tests. 2. Statement screen (view, review, approve, blocking issues, corrections section CS-Q9), filtered to the employees of her effective branch set (CS-Q20 = PP-20.1, §6 _Permissions_). 3. ar/en keys, component tests | 53-2 (CS-Q9 answered) | 400–550 |
| **54-1** | Mark paid | 1. The payment columns on `commission_statements` in the shape CS-Q6 decides (expand-only migration, grants), the use case + HTTP. 2. Permission (CS-Q4). 3. CM-40…CM-42 and the screen button | 53-2 (CS-Q4, CS-Q6, CS-Q12 answered; the rounded amount is stored beside the exact one, D-19) | 250–350 |
| **56-0** | Binary documents in the worker (D-18) | 1. Generalize the source/processor contract: a source returns HTML for the PDF renderer or bytes with a MIME type; no HTML → PDF step for bytes. 2. The xlsx MIME type, the 8 MiB cap (`DOCUMENT_TOO_LARGE`), the same Redis store and collect-once reply with the source's MIME type; the API's request admission checks the Chromium liveness key only for kinds that declare the PDF renderer (D-18), reading the kind → output map from `packages/contracts`; the BullMQ Worker opens independently of the renderer and `renderer.isAvailable()` is checked only on the PDF branch (D-28). 3. Tests: a bytes source never reaches the renderer, the cap, collect-once, the PDF kinds unchanged; with the liveness key absent, a bytes-kind request is queued (202) and its job completes, while a PDF-kind request still gets `503 RENDERER_UNAVAILABLE` | 59-0's ADR-0049 addendum | 200–320 |
| **56-1** | Excel export | 1. `commission_statement_exports` + RLS + grants, and the request use case that writes it before enqueueing (FR-050). 2. The worker source that loads the request by `render_id` and filters every frozen row by the saved `branch_ids` (FR-050), and the workbook builder in `packages/documents`; the collect route and audit. 3. CM-55, CM-55d, CM-55e, CM-55f, CM-56, CM-R10, and the export part of CM-23d, CM-23e, CM-23f, CM-23g and CM-23h | 53-2, **56-0** (CS-Q10, CS-Q12 answered) | 350–480 |
| **56b-1** | Reminders | 1. The `commission_statement_reminders` ledger table + RLS (the global `operational_recovery_flags` table has no RLS, D-24). 2. `CompanyCreated` scheduler registration and repair (with its `docs/module-map.md` event row), the Redis-loss detection (start-up sentinel check before write, heartbeat, the `operational_recovery_flags` ledger with its grants and privilege-allowlist entries `/ready` degraded, alert), the CS-Q32 rebuild of every company with its guarded self-clear and bounded retry (FR-053 _CS-Q32_, D-24), and the owner-role clear command and runbook `CompanyCreated` replay as the fallback only, the job and recipients (FR-053). 3. CM-57, CM-58, CM-58b, CM-57b, runbook replay | 52-1; **CS-Q32** (decided 2026-10-23 by Waleed and Abu Salem: the worker rebuilds every schedule by itself through a narrow read of company ids only and clears the flag itself after a successful rebuild; a new ADR comes first, amending CLAUDE.md §5 and ADR-0054 §2); CS-Q31 decided (2026-10-23: the existing `pospay_dispatcher`, `SELECT` and `INSERT` only), so this PR also amends CLAUDE.md §5 and ADR-0003 to name the grant, which the CS-Q32 ADR extends with the narrow clear privilege | 300–420 |

**Deferred — «with the customer-erasure feature» (D-21, CS-Q21 = PP-20.2).** Not a sub-PR of this slice; it ships with the
feature that erases a customer, which Phase 1 does not have. It must decide and deliver together: the erasure use case in
commissions and its audit entry (never the old name); the column grant and trigger that allow only `customer_name` to
change, only to the placeholder; the customers-owned erasure event, its ADR and its module-map arrow; the
`(company_id, customer_id)` index on the frozen rows; the serialization with approval (an approval copying names must not
commit an old name after the erasure, e.g. both take the same per-customer lock, or approval rechecks the erasure under
its lock); the placeholder text per language for the one `customer_name` column; and how open months and later approvals
show an erased customer (they can no longer read a live name).

**File overlap:** 50-1, 50-2, 50-4 and 55-1 all touch the one consumer; they run one at a time. 52-1 and 56b-1 both register
notification events; they run one at a time. Everything else may run beside them when its paths are disjoint (pipeline rule).

## 8. Success criteria

- **SC-001** The parallel month (SPEC §1): every employee's approved total equals the manager's hand calculation to 0.001 KWD,
  or each difference is traced to the manual sheet.
- **SC-002** 0 changes to an approved or paid statement after approval (except the erased-customer name placeholder of D-21,
  once the erasure feature exists); 100 % of later changes appear as corrections in a
  later month, with their source month.
- **SC-003** 0 events lost or counted twice under duplicate, reordered, replayed or crashed delivery (CM-21, CM-22, CM-36).
- **SC-004** The owner approves a reviewed month in one action, and an approval with pending inputs is refused with the
  retry message instead of approving incomplete data.
- **SC-005** The estimate an employee or manager sees equals what the statement will contain for the same inputs.
- **SC-006** No customer phone and no salary appears in any log, export or event payload of this slice (SPEC §12); the
  customer's full name appears only in the statement detail and the export (CS-Q15), never in a log or an event.

## 9. Assumptions

- **Commission subtotal = commission + sales commission + commission and sale corrections + every commission carry
  targeting this statement; tip side = card tips + card-tip corrections + every tip carry targeting this statement (D-22); Payable = max(0,
  commission subtotal) + max(0, tip side).** A negative commission subtotal is paid as 0 and carried, whole, into the next
  open month's commission (CS-Q7); a negative tip side is paid as 0 and carried, whole, into the next open month's card
  tips (CS-Q29); the two carries never net each other (BR-06). Examples: commission subtotal −25.000 and card tips 6.000 →
  payable 6.000, commission carry −25.000; commission 0, card tips 2.000 and a card-tip correction −10.000 → payable 0, tip
  carry −8.000. The payable is never negative. Cash tips and cash-tip corrections are shown, never added (D-36: card tips are paid with payroll, cash tips are
  informational).
- A month whose statement was never generated is generated on first demand (review, the correction target, or the plan
  lock); a statement row costs nothing and simplifies the lock (D-3).
- The 3rd and 5th are reminders, not locks (D-54). Approval stays allowed after the 5th, normally, and the reminders on the 3rd and 5th stay
  as they are (CS-Q22, both owners 2026-10-22); nothing blocks 53-2 on this.
- The REVIEWED → DRAFT return on any input change (D-5) is how SPEC §6 "a REVIEWED statement whose fingerprint changed
  returns to DRAFT" is implemented; the fingerprint comparisons at approval (input before the freeze, statement after it,
  D-6) are the second line of defence.
- Bell and reminder copy is proposed copy, fixed in the sub-PR that adds the template.
- Phase 1 has no production data; the bootstrap (50-3) still runs on staging before approval opens there, with its runbook count.
