# Lane D — alert rules, export, pay, reminders (#486, 56-1c, ADR-0061, 54-1, #716, 56b-1, 62-2c)

Read `COMMON.md` first. Your parts are 5, 12, 11, 13 and 14 of `plan.md` _Lane D_. Private database lane name:
`stmt-d`. **One delivery PR open at a time**; a second one needs your manager's word. The order below is the order of work;
build locally ahead, open in turn.

## Sources

- GitHub issues #486 and #716 (`gh issue view`).
- `docs/specs/060-ratings-and-staff-app/spec.md`: the §Relates rule for alert emitters, AL-Q7 (= PP-29.1), row 62-2c,
  RT-26.
- `spec.md` (059): Stories 8, 11, 12; FR-037, FR-038, FR-050…FR-055; D-18, D-19, D-24, D-28; §6 _Schema changes_;
  CM-40…CM-42, CM-55d, CM-55e, CM-57, CM-57b, CM-58, CM-58b, CM-R09.
- `plan-56-1.md` (§1 row 56-1c and what it assigns to it), `plan-56-1b.md` §5.
- `owner-questions.ar.md`: CS-Q4, CS-Q6, CS-Q10, CS-Q12, CS-Q22, CS-Q31, CS-Q32, CS-Q33, CS-Q34, and CS-Q52 (= PP-227, §61).
- `docs/adr/0003-…md` (the dispatcher role), `docs/adr/0038-…md` (migration data steps), `docs/adr/0049-…md` (the
  render transport and its bytes addendum), `docs/adr/0054-…md` §2.
- This delivery: `research.md` R5, R7, R8; `data-model.md`; `contracts/statement-flow.md`.

## Part 5 — issue #486 (Heavy: migration data step) — **start now**

`research.md` R5. Narrow `alertRuleViolation` (`packages/domain/src/alert-rules.ts`) so `branch_manager` is refused
on **both** `STATEMENT_AWAITING_REVIEW` and `STATEMENT_AWAITING_APPROVAL` (both accept role selectors today; the
validator, the cleanup and the CHECK cover both). A
migration data step (registered in `packages/db/src/data-steps/index.ts`, marker `-- pospay:data-step <name>` on the
first line of the SQL, ADR-0038): the owner reads only `companies.id`; per company, under `withTenant` on
`pospay_app`, remove `branch_manager` from stored rules of those kinds and write one audit entry per changed rule;
idempotent. Then a CHECK that refuses the combination. Before you choose what a rule left with no role does, read how
the settings module treats an empty role list today and **report it**; do not invent a fallback. Update the admin role
picker only if it offers the role for these kinds. Tests: validator units both ways; the data step run twice; another
tenant untouched; the CHECK refuses a direct insert. Size 120–200. No number and no push until «lane granted».

## Part 12a — 56-1c API (Medium; no migration) — **build locally now; open the PR when your manager says (it merges after 53-2)**

Request, poll and collect use cases; the controller; contracts and OpenAPI; the collect-time re-check of the
requester's scope; the audit entry `commission_statement.exported` on each collected download; the rate limit;
admission through `documentKindNeedsRenderer`. Model: the staff attendance-statement request and collect use cases and
controller. The request writes `commission_statement_exports` before enqueueing, with the reader's effective branch
set at request time (FR-050): the scope, and for `BRANCHES` both `branch_ids` (= _R_) and `employee_ids` (from the
statement's frozen `EMPLOYEE` rows whose frozen branch set overlaps _R_), plus the workbook language the caller
chooses (`ar` or `en`, CS-Q33; never a server default). See plan-56-1.md §3 for the table's CHECKs. Tests: CM-55d, CM-55e and the export part of CM-23d…CM-23h, on statements seeded
`APPROVED` through `packages/db/test/commission-statement-fixtures.ts`. Do not touch the `PAID` refusal yet (that is
#716). Size 300–420. Merge order is your manager's call (the canonical row names 53-2).

## ADR-0061 — the schedule-recovery ADR (docs only) — **draft locally now; #486 is your first open PR, and this one opens only on your manager's word**

`research.md` R8 and FR-053 _CS-Q32_. Write `docs/adr/0061-…md` as **Proposed**: the worker's narrow read of company
ids; the clear of the flag, in one transaction with its audit record and a fixed system identity; the guard on the
Redis run id and sentinel seen when the rebuild started; the bounded retry while the flag stays open and `/ready`
degraded; the flag cleared only when every company succeeded; the operator command and the `CompanyCreated` replay
kept as the fallback. Name the exact grants, the role that owns each definer function, what `pospay_dispatcher` can
and cannot do, and every document the code PR must amend (CLAUDE.md §5, ADR-0003, ADR-0054 §2, the runbook, the
privilege inventory). Open it as its own docs PR. **No 56b-1 code is written until your manager reports that Waleed
accepted it.**

## Part 11 — 54-1: mark paid (Heavy: money, permission, migration) — after 53-2 is merged

Preparation meanwhile: the cash rounding as a pure function in `packages/commissions-engine` with exhaustive unit
tests (nearest 0.005 KWD, a tie rounds half up, `bigint` mills in and out; zero and already-rounded values), and the
schema drafted on your private cluster.

Scope as `plan.md` part 11 and `data-model.md` _Payment_: the payment columns on `commission_statements`; the
per-employee payment table with RLS, a guard that accepts a row only for an employee frozen in that statement (test:
a same-company employee absent from the statement is refused) and its negative isolation test (add its name to spec 059's table of named
isolation tests in the same PR); the widened column grant and the replaced `commission_statements_update_guard`
(today APPROVED → PAID may change only `status`); `pay:commissions:business` registered like `0239` did for the read
code (owner, general_manager, accountant; grantable to anyone, CS-Q4 — it is **not** owner-only);
`use-cases/mark-statement-paid/` and `POST …/:period/mark-paid` (FR-037: `paid_on` is a business date not after today
and not before the approval date); audit `commission_statement.paid`; error codes
`COMMISSION_STATEMENT_NOT_APPROVED`, `COMMISSION_STATEMENT_ALREADY_PAID`. The paid total is the sum of the employees'
paid amounts, never a rounding of a total. The screen button goes on lane C's statement screen after 53-3 merges.
Tests: CM-40, CM-41, CM-42; the rounding units. Size 250–350.

## Part 12b — issue #716 — after 54-1 and 56-1c are merged

Remove the `PAID` refusal in the worker's `read-commission-statement-export`; read each employee's paid amount from
54-1's record; pass the paid-cash column to the workbook only for a cash payment, and only for an employee whose
whole month the export shows: a branch-scoped export must never carry a whole-month paid amount for an employee it
shows in part (CS-Q23). Take the partial case from plan-56-1b.md; if it is not defined there, write `TODO(spec)`, omit
her paid amount and report. Tests: an export for every payment method; APPROVED → PAID while the job waits; the
partial-month case. Then the export button on the statement screen. Size 80–150.

## Part 13 — 56b-1: reminders (Heavy: migration, security) — after 52-1 is merged and ADR-0061 is accepted

Scope as `plan.md` part 13, implementing ADR-0061 as accepted and nothing wider. The reminder reads the alert rule
through a commissions `AlertRulesPort` adapter in the worker (pattern: the worker staff module's alert-rule port and
adapter) only for whether the kind is on and for its channel. **Recipients (CS-Q52 = PP-227):** an approval reminder
goes to everyone who can approve when the reminder is appended — holders of `approve:commissions:business` who are
business-wide readers, the FR-030 predicate; a review reminder to the review holders who are business-wide readers.
The rule's roles do not select them. Abu Salem's pick is pending; your manager will tell you if it differs. Tests:
CM-57, CM-57b, CM-57c (a quiet business with no statement row still gets its DRAFT row, ledger entry and reminder; the
worker stays degraded until every company is rebuilt), CM-58, CM-58b, CM-R09, the privilege inventory. Size 300–420.

## Part 14 — 62-2c (Medium) — last

Only what the emitters did not ship: the tests (each statement kind off → no recipients; master switch off → none;
defaults → today's recipients, RT-26), the statement kinds in
`apps/admin/src/settings/alert-rules/model/listed-alert-kinds.ts`, the module-map `reads` line. Re-implement no
wiring. Size 100–160.

## Not yours

The repair route, the carries table, generate, review, the pending count, approval, the statement screen itself.

## Addendum — design-advisor round (research.md A7, A9)

- **Order:** #486 is your first delivery PR to open and pass (52-1, and through it 53-2, wait for it). ADR-0061 is a
  docs PR: open it only when your manager says, so you keep one open delivery PR.
- **54-1, the «same transaction» proof:** the payment rows are accepted only in the transaction that sets the statement
  `PAID`. Give the statement its own proof column, set by the APPROVED → PAID transition trigger, and have the insert
  guard compare it with `pg_current_xact_id()`, as the freeze guard does with `approval_xact_id` in migration `0183`.
  Checking `status = 'PAID'` alone would accept a late insert. Mark-paid verifies the set of rows is complete (one per
  frozen `EMPLOYEE` line) before it commits.