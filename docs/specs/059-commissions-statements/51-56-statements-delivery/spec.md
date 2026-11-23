# Feature Specification: Commission statements chain — repair, generate, review, approve, pay, export, remind (delivery of rows 51–56b, 55-2f, 62-2c)

**Feature Directory**: `docs/specs/059-commissions-statements/51-56-statements-delivery`
**Created**: 2026-11-22
**Status**: Draft (delivery spec; the canonical rules stay in [spec 059](../spec.md))
**Base**: `origin/main` `7c5a318e9727143aa83680dc7e6d49bf98c605e0` (contains 55-2e, 55-1d, 50-5, 50-3a…d, 50-4)
**Input**: Waleed's direct authorization, 2026-11-22, relayed by the PosPay manager thread: «يلا افتح جلسة جديدة مديرها fable 5.2 medium يعمل spec and plane he will use /speckit-plan /docs-guard /speckit-specify وبعدين يبدأ 4 subagents sonnet 5.5 high for implementing», with the ordered 14-part scope listed under _Parts_ below.

> **What this document is.** One delivery specification for the rest of the statement chain. It **adds no money rule,
> no permission rule and no tenant rule**. Every rule is cited from [spec 059](../spec.md) (FR, CM, D ids),
> [owner-questions.ar.md](../owner-questions.ar.md) (CS-Q ids), [spec 060](../../060-ratings-and-staff-app/spec.md)
> (row 62), [ADR-0012](../../../adr/0012-statement-approval-pending-outbox-count.md) and
> [ADR-0054](../../../adr/0054-commissions-engine-package-recovery-flags-and-read-path.md), all read at the base
> commit. Where this document and spec 059 disagree, spec 059 wins and this document is corrected. What it does add:
> the state of each part at the base, the dependency and file-overlap map, the migration queue, the split between
> code, coverage proof and production enablement, and the decisions that are still open.

## Parts

| # | Part | Canonical source | Result |
| --- | --- | --- | --- |
| 1 | **55-2f-0** | CS-Q46 = PP-205.1; [plan-55-2.md](../plan-55-2.md) §9 | Move-only: the correction step leaves `apps/worker` for a home both `commissions` modules can import. No logic change |
| 2 | **55-2f** | FR-047, CS-Q11, CS-Q47 = PP-205.2; CM-52, CM-52b, CM-52c | The API repairs a closed month whose correction is blocked by `NO_PLAN`: repair version, recompute and posted corrections in one transaction |
| 3 | **51-1 PR 1** | spec 059 §7 row 51-1, PP-192; D-6, D-22, D-26; CM-R11, CM-34e | `commission_carries` with RLS; the pure canonical-input and statement builders; both fingerprints; the hash port; incoming carries in the estimate |
| 4 | **51-1 PR 2** | FR-025…FR-028; CS-Q2b, CS-Q37 = PP-101.1; CM-27…CM-29, CM-33 (generate part) | Generate and GET statement, HTTP, the `review:commissions:business` permission with its defaults and owner-only granting |
| 5 | **#486** | Issue #486; AL-Q7 = PP-29.1; spec 060 §Relates | `branch_manager` is refused on `STATEMENT_*` alert kinds and removed from stored rules |
| 6 | **52-1** | FR-029…FR-031, FR-029b; CS-Q5, CS-Q26; CM-30…CM-33d | Review, return to draft, the `approve:commissions:business` permission, the `StatementAwaitingApproval` notice. Uses the merged 52-1b planner |
| 7 | **53-1** | ADR-0012 §1–§4, D-9, D-27; CM-39 | The pending-event count: role, definer function over six types, policies, grants (no index: CS-Q56) |
| 8 | **#1032** | Issue #1032; CS-Q41…CS-Q44, CS-Q51 | The coverage report can no longer print a false `COVERED` |
| 9 | **53-2** | FR-032…FR-036; D-22; CM-33…CM-38b | Approve: freeze, attachment snapshot, carries, coverage gate, pending-count gate |
| 10 | **53-3** | CM-36; CS-Q9, CS-Q20 | Approval race tests with barriers; the statement screen |
| 11 | **54-1** | FR-037, FR-038; CS-Q4, CS-Q6, CS-Q12; D-19; CM-40…CM-42 | Mark paid, with the per-employee payment record |
| 12 | **56-1c** | [plan-56-1.md](../plan-56-1.md) §1 (row 56-1c); FR-050, FR-052; issue #716 | Request, poll and collect the Excel export; `PAID` statements exportable |
| 13 | **56b-1** | FR-053…FR-055; CS-Q22, CS-Q31, CS-Q32; CM-57…CM-58b | Reminders on the 3rd and the 5th, after the schedule-recovery ADR |
| 14 | **62-2c** | spec 060 §7 row 62-2c | Statement alert kinds proven on the rules; listed on the alert-rules screen |

## User Scenarios & Testing *(mandatory)*

People are those of spec 059 §1: سارة (employee), ليلى (business manager, reviewer), the owner, the accountant. Every
acceptance test is the named CM test of spec 059 §4; this section does not restate them.

### User Story 1 - Repair a month blocked by a missing plan (Priority: P1)

An employee had no plan in a month that is now closed, and a late change produced a blocked correction. A holder of the
plan permission writes a repair plan for that month only; the system prices the days that had no plan, posts the
corrections into the earliest DRAFT month and resolves the block, in one action.

**Why this priority**: an open block refuses review and approval of the month that holds it (FR-048), so the chain
cannot close without it.

**Independent Test**: CM-52, CM-52b and CM-52c on a seeded closed month, with the oracles of plan-55-2.md §7 proven by
pure tests first.

**Acceptance Scenarios**:

1. **Given** an open `NO_PLAN` block for سارة in October, **When** the plan holder posts a repair plan for October,
   **Then** the version is stored for October only, the corrections are posted with the tier total of CS-Q47, the block
   is resolved, and one audit entry is written — all or nothing (FR-047, CM-52).
2. **Given** the same block but سارة also has no salary, **When** the repair is posted, **Then** the block's code
   becomes `NO_SALARY`, nothing is posted, and the version and audit still commit (CM-52b).
3. **Given** no open `NO_PLAN` block, **When** a repair is posted, **Then** it is refused with
   `COMMISSION_REPAIR_NOT_ALLOWED` (FR-047).

### User Story 2 - Generate and review the month (Priority: P1)

After the month ends, ليلى generates the statement, sees every employee's figures with the corrections and carries
that the month received, and marks it reviewed. Any later input change returns it to DRAFT by itself; she can also
return it by hand with a reason.

**Why this priority**: review is the precondition of approval, and the fingerprints fixed here are what approval
compares.

**Independent Test**: CM-27…CM-29, CM-34e (round trip), CM-30…CM-33d.

**Acceptance Scenarios**:

1. **Given** an ended month with inputs, **When** a review holder generates it, **Then** the statement stores its
   input fingerprint and the view equals the estimate for the same inputs (FR-025…FR-027, SC-005).
2. **Given** a month with an open blocked correction or a missing plan or salary, **When** review is asked, **Then**
   it is refused with `COMMISSION_STATEMENT_BLOCKED` listing each issue (FR-027, FR-048).
3. **Given** a REVIEWED statement, **When** an input changes, **Then** it is DRAFT again in the same transaction (D-5).
4. **Given** a user who is not the owner, **When** she tries to grant or revoke the review or approve permission,
   **Then** it is refused (CS-Q2, CS-Q5, CS-Q37).

### User Story 3 - Approve once, atomically (Priority: P1)

The owner approves the reviewed month. The rows he reviewed are frozen, negative balances are carried, and nothing in
that month changes afterwards.

**Why this priority**: it is the money event of the feature (SC-001, SC-002, SC-004).

**Independent Test**: ADR-0012 groups 1–4 and 7 (CM-39) for the count; CM-33…CM-38b for approval; CM-36 for the races.

**Acceptance Scenarios**:

1. **Given** a REVIEWED statement with no pending input event and proven coverage, **When** the owner approves,
   **Then** lines and attachments are frozen, both fingerprints match what was reviewed, and each negative commission
   subtotal or card-tip side writes one carry into the earliest DRAFT month after it (FR-032…FR-034, D-22).
2. **Given** a counted event without the consumer's mark, **When** approval is asked, **Then** it is refused with the
   retryable `COMMISSION_UPDATES_PENDING` and nothing is written (ADR-0012 §3, §5).
3. **Given** a writer racing the approval, **When** both commit, **Then** the change is either in the frozen rows or
   in a correction, never lost and never both (CM-36).

### User Story 4 - Record the payment and export (Priority: P2)

A pay holder records how the approved month was paid. Anyone who may read the statement exports it to Excel, before or
after payment.

**Independent Test**: CM-40…CM-42; CM-55d, CM-55e and the export part of CM-23d…CM-23h; issue #716's cases.

**Acceptance Scenarios**:

1. **Given** an APPROVED statement, **When** it is marked paid in cash, **Then** each employee's exact payable and her
   amount rounded to 5 fils are stored, and the paid total is the sum of the rounded amounts (CS-Q12, D-19).
2. **Given** an APPROVED or PAID statement, **When** a reader requests the export, **Then** she receives a render id,
   polls it, and collects the file once, limited to her effective branch set (FR-050, CS-Q20).
3. **Given** an export requested while APPROVED and the statement paid before the worker runs, **Then** the export
   still completes (issue #716).

### User Story 5 - Reminders and alert rules (Priority: P2)

The owner is reminded on the 3rd and the 5th while a month is not approved. Who receives statement notices follows the
alert rules of row 62, and a branch manager can never be chosen for them.

**Independent Test**: CM-57, CM-57b, CM-57c, CM-58, CM-58b; RT-26 of spec 060; the #486 validator and cleanup tests.

**Acceptance Scenarios**:

1. **Given** an unapproved month on the 3rd, **When** the schedule fires, **Then** one reminder per statement and date
   is sent and recorded once (FR-053…FR-055).
2. **Given** a Redis loss, **When** the worker restarts, **Then** the schedules are rebuilt for every company and the
   recovery flag clears only after every company succeeded (CS-Q32).
3. **Given** a statement kind switched off in the alert rules, **When** its event is emitted, **Then** nobody is
   notified (spec 060 row 62-2c).

### Edge Cases

Those of spec 059 §4 _Edge cases_ and of each cited CM test. This delivery adds four engineering cases that the
canonical spec leaves to the sub-PR:

- A statement row can exist before it was ever generated, because every input writer creates it through
  `lockStatementPeriods`; «not generated» is therefore `current_fingerprint IS NULL`, not «no row» (CM-28b; plan.md
  _Decisions_ R6).
- The period rolls over between the repair's lock and its recompute: the repair is refused as retryable, with one lock
  call (plan-55-2.md §9).
- The coverage report is run with a business that is not the company's, with no business, or with no tip scope: it
  never prints `COVERED` (issue #1032).
- A stored alert rule already names `branch_manager` on a statement kind when the validator is narrowed (issue #486).

## Requirements *(mandatory)*

### Functional Requirements

Canonical requirements are **FR-025…FR-038, FR-046…FR-055** of spec 059 §5 and row 62-2c of spec 060 §7. The delivery
requirements below bind how they are shipped; none changes a rule.

- **DR-001** Every part ships exactly the scope its canonical row names. PP-192's split of 51-1, refined by PP-229 into three PRs for its first part and a separate generate/GET PR, in
  dependency order, is kept.
- **DR-002** 55-2f-0 changes no behaviour: the worker's four projectors produce the same corrections before and after,
  proven by the existing worker suite passing unchanged.
- **DR-003** An alert emitter added by this delivery (52-1's `StatementAwaitingApproval`, 56b-1's reminders, and
  `StatementAwaitingReview` wherever its emitter lands) takes its recipients and channels from `AlertRulesPort` in its
  own part, as spec 060 §Relates requires of every emitter merged after 62-1. 62-2c then adds only the tests, the
  listing of the statement kinds on the screen and the module-map line; it re-implements no wiring.
- **DR-004** #486 merges before any part that emits a `STATEMENT_*` notice.
- **DR-005** Issue #1032 is closed before any company's approval is opened on staging and before any production first
  run. The coverage report keeps every check it has, distinguishes «covered», «not covered» and «not checked», exits
  non-zero unless every section was checked and covered, and names the scope it checked; `COVERED` proves that scope
  only.
- **DR-006** Approval (53-2) stays closed for a company until its bootstrap coverage is proven by the fixed report
  (FR-020, ADR-0012 _Amendment_). Shipping the approval code does not open approval anywhere.
- **DR-007** No part deploys to staging or production, and no part opens approval for a production company. Each is
  the PosPay manager's or Waleed's separate decision (PP-201 rule 4).
- **DR-008** The approval notice and its reminder go to everyone who can approve the statement at the time of the
  event: the holders of `approve:commissions:business` who are business-wide readers, by the same predicate as the
  guard (FR-030). The alert rule of `STATEMENT_AWAITING_APPROVAL` decides only whether the notice is on and its
  channel; its roles do not select the recipients of this kind. Decided by CS-Q52 = PP-227 (Waleed, 2026-11-22;
  Abu Salem's pick is pending on batch 100 and binds if it differs, CLAUDE.md §1 5b).

### Key Entities *(include if feature involves data)*

Defined in spec 059 §6 _Schema changes_; summarized in [data-model.md](data-model.md).

- **Carry** (`commission_carries`): a negative balance of one employee and kind, moved from an approved month to the
  earliest DRAFT month after it.
- **Statement return** (`commission_statement_returns`): who returned a reviewed statement to draft, when and why.
- **Statement payment**: the statement-level payment facts and one record per employee with her exact and paid amounts.
- **Statement reminder** (`commission_statement_reminders`) and **recovery flag** (`operational_recovery_flags`).
- **Pending-event count**: a function, not a table (ADR-0012).

## Slice design *(mandatory — `CLAUDE.md` §1)*

The per-part design (files, ordering, sizes, tests) is in [plan.md](plan.md); entities in
[data-model.md](data-model.md); routes in [contracts/statement-flow.md](contracts/statement-flow.md).

### Business rules

BR-01…BR-06 of spec 059 §6, unchanged. Money is `bigint` mills in TypeScript, `numeric(14,3)` in Postgres and KWD
strings on the wire (D-19). Lock order is one ascending `lockStatementPeriods` call per transaction (D-3, D-13). The
two fingerprints are those of D-6 and D-26. Carries follow D-22. Branch scope follows CS-Q20, CS-Q23, CS-Q24, CS-Q25.

### Schema changes

| Part | Change | Kind |
| --- | --- | --- |
| 51-1 PR 1 | `commission_carries` + RLS, grants, FK indexes, CM-R11 | table (two migration files, as 0232/0233) |
| 51-1 PR 2 | `review:commissions:business` catalog row and global role grants | reference data (pattern of 0239) |
| #486 | Remove `branch_manager` from stored `STATEMENT_*` rules; a CHECK that refuses it | data step (ADR-0038) + constraint |
| 52-1 | `commission_statement_returns` + RLS (CM-33c); `approve:commissions:business` reference data | table + reference data |
| 53-1 | Role `pospay_approval_reader`, the definer function, policies, column grants; no outbox index (withdrawn by CS-Q56) | the function migration |
| 54-1 | Payment columns on `commission_statements`; the per-employee payment table + RLS; the widened column grant and update guard; `pay:commissions:business` reference data | expand-only + table + reference data |
| 56b-1 | `commission_statement_reminders` + RLS (CM-R09); the global `operational_recovery_flags` ledger; grants named by the new ADR | table + global table |
| 55-2f-0, 55-2f, #1032, 53-2, 53-3, 56-1c, 62-2c | none | — |

Every tenant table: PK `(company_id, id)`, `FORCE` RLS, a negative isolation test and its indexes in the same
migration (CLAUDE.md §5). No migration number is written anywhere in this delivery's documents; numbers are taken at
merge in the queue of plan.md _Migration queue_.

### API contract

Listed in [contracts/statement-flow.md](contracts/statement-flow.md). Every write takes `Idempotency-Key`, runs in one
transaction and writes its outbox event in it (CLAUDE.md §6). Error codes are those of spec 059 §6 _Error codes_; the
ones missing at the base are named per part in plan.md.

### Permissions

Spec 059 §6 _Permissions_, unchanged: `manage:commission-plans:business` (55-2f, as 55-2e's guard under CS-Q48),
`read:commissions:business` (GET statement, export), `review:commissions:business` (generate, review;
registered by 51-1 PR 2), `approve:commissions:business` (registered by 52-1, guarded in 53-2); return is open to a
holder of either who is a business-wide reader (FR-031, CS-Q26; a union of branch grants is refused with 403),
`pay:commissions:business` (54-1). Review and approve are owner-grantable only and usable only by a business-wide
reader (CS-Q26, FR-029, FR-036). All behind the `commissions` feature; all refused to devices.

### Events

`StatementAwaitingReview` and `StatementAwaitingApproval` (declared in `docs/module-map.md`; contract and template are
added by the part that first emits each). `CompanyCreated` consumed by the worker `commissions` reminder scheduler
(56b-1, with its module-map event row). No new import arrow (D-16).

### Test plan

The named tests of each canonical row, assigned in plan.md _Parts_. Domain and engine functions: exhaustive unit tests
with no database. Use cases: integration tests on the T2 Postgres (ADR-0006). Each new tenant table: its named RLS
negative test. Each `queries/` file: shape and `EXPLAIN`. UI tests assert what the user sees (CLAUDE.md §9).

## Success Criteria *(mandatory)*

### Measurable Outcomes

SC-001…SC-006 of spec 059 §8, plus for this delivery:

- **SC-D1** After part 2, a blocked `NO_PLAN` correction can be repaired in one request, and the month holding it can
  be reviewed.
- **SC-D2** After part 9, a reviewed month is approved in one action or refused with a stated reason; 0 partial
  approvals in the race tests.
- **SC-D3** The coverage report prints `COVERED` in 0 of the three false-coverage cases of issue #1032.
- **SC-D4** 0 statement notices reach a branch manager through an alert rule.
- **SC-D5** A paid statement can be exported for every payment method.

## Assumptions

- The four implementers are Claude Sonnet 5.5 at high effort, by Waleed's sentence quoted under _Input_. The repository
  records no PP item for this lane (PP-204 names GLM for implementers; PP-186 has Claude write no code); the PosPay
  manager is recording the sentence as PP-225, for this delivery only (manager's message, 2026-11-22). Recorded in plan.md _Route_.
- Merge authority is the PosPay manager's under PP-201 (`docs/owner-decisions.ar.md` item 121), which cancelled the
  Waleed merge card of PP-195 for Heavy PRs. The `CLAUDE.md` banner still words the older card; the conflict is
  reported to the manager, not resolved here.
- Technical choices this delivery makes, each revocable by Waleed, are listed with their reasons in
  [research.md](research.md) (R1…R9). The home of the moved correction step (R1) was confirmed by him as PP-226; the security choices of the
  schedule-recovery ADR (R8) wait for his answer before the 56b-1 code is written.
- Phase 1 has no production data (spec 059 §9); the bootstrap and the coverage proof run on staging before approval
  opens there.
- CS-Q45, CS-Q49 and CS-Q50 are still pending at the base and affect none of the fourteen parts.
