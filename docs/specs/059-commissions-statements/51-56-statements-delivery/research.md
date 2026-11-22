# Research: statements chain delivery (rows 51–56b, 55-2f, 62-2c)

State of `origin/main` `7c5a318e`, read on 2026-11-22. Each item is a decision this delivery had to make that the
canonical documents leave open. None is a money, permission or tenant rule. R1 and R8 are Waleed's to confirm
(technical, CLAUDE.md §1 5b); the rest are engineering choices recorded so a reviewer can refuse them.

## Evidence at the base

| Fact | Where |
| --- | --- |
| The correction step lives only in the worker: `use-cases/post-commission-corrections/`, `use-cases/commission-month-recompute.ts`, `domain/commission-correction-*.ts`, `domain/commission-source-ref.ts`, `ports/commission-correction.port.ts`, `persistence/commission-correction-*.ts` | `apps/worker/src/modules/commissions/` |
| It has four callers: the line, tip, salary and package-sale projectors | same module, `use-cases/project-*/` |
| No repair route, no `COMMISSION_REPAIR_NOT_ALLOWED`, no `commission-period-repairs` in any app or package | repository search |
| No `commission_carries`, no fingerprint or statement builder, no `get-statement`, no statement controller | `packages/db/schema/`, `packages/commissions-engine/src/`, `apps/api/src/modules/commissions/` |
| `domain/statement-return-plan.ts` (`planCommissionStatementReturn`) is merged with no caller (52-1b, PR #821) | `apps/api/src/modules/commissions/domain/` |
| `lockStatementPeriods` and `reopenReviewedStatementPeriods` exist | `packages/db/src/statement-periods.ts` |
| The freeze guards exist: `commission_statements_update_guard` and `commission_statement_frozen_insert_guard` | migration `0183` |
| `pospay_approval_reader` and the pending-count function do not exist | repository search (documents only) |
| Coverage: `compareCoverage` is pure in the engine; the coverage readers are bound in the worker only | `packages/commissions-engine/src/coverage-comparison.ts`; `apps/worker/src/modules/commissions/` |
| The export's table, kind, worker source and reader are merged; request, poll and collect are not | `packages/db/schema/commissions-statement-exports.ts`; `apps/worker/src/documents/sources/commission-statement.source.ts` |
| `alertRuleViolation` refuses roles only for employee-only kinds, so `branch_manager` passes on `STATEMENT_*` | `packages/domain/src/alert-rules.ts` |
| `STATEMENT_AWAITING_REVIEW` is fixed to the holders of `review:commissions:business`; `STATEMENT_AWAITING_APPROVAL` is role-editable and defaults to `recipientRoles: ['owner']` | `packages/domain/src/alert-rules.ts` |
| Latest migration on main is `0239_2026-11-22_commissions-read-permission`; the local branch `T3-CODE/pospay-61-unified-medium` holds `0240` and `0241` (row 61) | `packages/db/migrations/meta/_journal.json`; `git ls-tree` |
| No ADR names CS-Q32; the highest ADR number is 0060 | `docs/adr/` |
| No `.specify/extensions.yml`: Spec Kit has no hook to run | `.specify/` |

## R1 — Where the correction step moves (55-2f-0) — **Waleed to confirm**

- **Decision (proposed):** a new package, `packages/commissions-posting`, restricted like the engine
  (`packages_restricted: [commissions]`), depending on `packages/domain`, `packages/commissions-engine`,
  `packages/db` and `packages/ids`. It holds the correction step's domain files, its orchestration, its port and its
  Drizzle persistence. Each app keeps its own wiring and its own notice adapter.
- **Rationale:** CS-Q46 decided «مكان مشترك» and left the place open. The engine cannot take it without giving up what
  ADR-0054 §1 and D-23 protect: its ESLint purity rule, its «one dependency» description and the module-map test all
  forbid SQL and `packages/db` there. 51-1 PR 1 also adds its builders to the engine in the same weeks, so widening it
  would put two parts on the same files. A new package needs an ADR (CLAUDE.md §11): an ADR-0054 addendum and the
  CLAUDE.md §2.1 row ship in 55-2f-0.
- **Alternatives considered:** the engine gains a non-pure half (rejected: breaks D-23, collides with 51-1);
  `packages/db` (rejected: it would hold pricing orchestration and import the engine); the outbox route (rejected by
  the owner in CS-Q46, it changes FR-047).
- **Until confirmed:** lane A prepares the file inventory, the ADR addendum draft and the pure oracle tests, and builds
  the move on this proposal in its worktree. The PR is not opened for merge before the answer.

## R2 — What the API passes for the notice port in a repair (55-2f)

- **Decision:** the moved step takes an optional notice writer. The repair never records a new block (it runs only when
  one is open), so the API binds a writer that throws if it is called; a test proves the repair path never calls it.
- **Rationale:** the bell adapter is worker code (`appendOutboxEvent` plus the worker's identity reader). Binding a
  silent no-op would hide a future wrong call.
- **Alternatives considered:** move the bell adapter too (out of the move-only scope); a no-op (silent).

## R3 — The `event_id` of corrections a repair posts (55-2f)

- **Decision:** the block's `first_event_id`, as plan-55-2.md §1 already proposes; the block reader is widened to
  return it. The reply is 201 `{ version, blocked_correction: { id, code, resolved } }`.
- **Rationale:** `commission_corrections.event_id` is `NOT NULL` and a repair has no event of its own; the block's
  first event is the change the correction answers. plan-55-2.md marks this as provisional; it is confirmed here.
- **Alternatives considered:** a synthetic id (breaks the meaning of the column); a nullable column (a migration and a
  weaker invariant).

## R4 — May 51-1 PR 1 build before 55-2f merges?

- **Decision:** PR 1 is built and opened now; its merge waits for 55-2f, unless the PosPay manager rules otherwise.
  PR 2 starts after both.
- **Rationale:** CS-Q38 = PP-101.2 says row 51 waits for 55-2, and PP-192's impact note says «البند 51 بيبدأ بعد 50-4
  و55-2 و50-5». 55-2a…e are merged; only the repair route is not. PR 1 reads the blocked-corrections table that 55-2b
  shipped and needs nothing of the repair (plan-55-2.md §9.1: the reads have their own adapters). Building is
  reversible; merging ahead of an owner's ordering is not this session's call.

## R5 — The cleanup of #486

- **Decision:** narrow `alertRuleViolation` to refuse `branch_manager` on every `STATEMENT_*` kind that accepts roles (the part
  lists which do; at the base `STATEMENT_AWAITING_APPROVAL` is role-editable and `STATEMENT_AWAITING_REVIEW` is fixed); add a migration data step (ADR-0038) that, per company under `withTenant`, removes
  `branch_manager` from stored rules of those kinds and writes one audit entry per changed rule; then a CHECK
  constraint that refuses the combination. A rule left with no role keeps its other fields and resolves by the
  existing empty-roles behaviour, which the part verifies and states in its PR.
- **Rationale:** PP-29.1 made the refusal a rule; the issue allows «one migration data step or a validator-enforced
  rewrite». A settings change is audited (CLAUDE.md §8), and a database constraint keeps a later writer honest.
- **Alternatives considered:** a silent SQL rewrite (no audit); validator only (stored rows stay wrong).

## R6 — «Generated» for CM-28b (51-1 PR 2)

- **Decision:** a statement is «not generated» when `current_fingerprint IS NULL`. `GET` on such a month returns
  `generated: false` and creates no row and takes no lock (D-25).
- **Rationale:** input writers already create DRAFT rows through `lockStatementPeriods`, so «no row» cannot be the test.

## R7 — The per-employee payment record (54-1)

- **Decision:** a new insert-only tenant table, written by mark-paid in the same transaction as the status change, with
  one row per frozen `EMPLOYEE` line: the exact payable and the paid amount (rounded to 5 fils, half up, only for
  cash; equal to the exact payable otherwise). The statement's paid total is the sum of the rows. The export reads the
  paid amount from it (issue #716).
- **Rationale:** D-19 stores the rounded amount «per employee, beside her exact payable, on the payment record written
  atomically by mark-paid», but §6 lists only statement-level columns and the frozen lines are insert-only by trigger.
  This is the storage of an answered rule (CS-Q12), not a new rule.
- **Alternatives considered:** columns on the frozen lines (the trigger refuses updates); a JSON column on the
  statement (no FK, no per-row check).

## R8 — The schedule-recovery ADR (56b-1) — **Waleed to confirm**

- **Decision (to be written first, as ADR-0061, docs-only):** the five points FR-053 _CS-Q32_ requires — the worker's
  narrow read of company ids, the clear privilege, the audit path with a fixed system identity, the run-id and sentinel
  guard, the bounded retry. Proposed shape: both the company-id read and the clear are `SECURITY DEFINER` functions
  owned by a NOLOGIN role and executable by `pospay_dispatcher` only; no table privilege beyond CS-Q31's
  `SELECT, INSERT` is granted; no runtime role gains `BYPASSRLS`.
- **Rationale:** it touches the «no fifth way to tenant data» sentence of CLAUDE.md §5 and ADR-0003, so it is a
  security decision that needs Waleed's acceptance before any code. The ADR amends CLAUDE.md §5, ADR-0003 and
  ADR-0054 §2 in the 56b-1 code PR, as spec 059 §7 says.
- **Alternatives considered:** a column `UPDATE` grant on the flags table (the runtime could clear any flag, D-24); a
  new login role (a pool, an env URL and a secret, rejected by D-24).

## R9 — The issue #1032 report statuses

- **Decision:** tips get a third state, «not checked»; the overall status is `COVERED` only when lines, salaries,
  sales and tips were all checked and covered; any other outcome exits non-zero. A business that is not the company's
  is refused with `COMMISSION_COVERAGE_SCOPE_INVALID`, checked through the worker tenancy reader on `pospay_app`
  under `withTenant` (no new grant). An empty business list is refused in the use case as well as in the CLI. There is
  **no default to all businesses**: the operator names the scope.
- **Rationale:** the issue asks to «decide whether to default to all businesses». An explicit scope is the safer
  reading of «a false COVERED must be impossible», and the runbook already has the operator supply `BUSINESS_IDS`.

## Open gaps with a proposed owner

| Gap | Source | Proposed owner | Status |
| --- | --- | --- | --- |
| The owner alert when a counted event is parked | ADR-0012 §3 | 53-2, designed in the design-advisor round | open |
| The cost of the coverage gate inside the approval transaction against the 200 ms rule | FR-020, CLAUDE.md §6 | 53-2 preparation; measured, then decided in the design-advisor round | open |
| The assertion that the consumer's registered types equal the function's six | ADR-0012 §1 | 53-1: the six names move to one exported constant that the worker registration and the catalogue test both read | decided here |
| The export button in admin | plan-56-1.md gives it to 53-3 | 53-3 hosts the screen; lane D adds the button after 53-3 merges | decided here |
| Erasure against approval | spec 059 §7 _Deferred_ | not in this delivery | deferred |
