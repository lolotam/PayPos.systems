# Implementation Plan: Commission statements chain (rows 51–56b, 55-2f, 62-2c)

**Feature directory**: `docs/specs/059-commissions-statements/51-56-statements-delivery` | **Date**: 2026-11-22 |
**Spec**: [spec.md](spec.md) | **Canonical**: [spec 059](../spec.md), [owner-questions.ar.md](../owner-questions.ar.md)
**Base**: `origin/main` `7c5a318e9727143aa83680dc7e6d49bf98c605e0`
**Input**: the delivery spec above; evidence and decisions in [research.md](research.md)

## Summary

Fourteen parts finish the commission month: repair a blocked month (55-2f-0, 55-2f), generate and review (51-1, 52-1),
count pending events and approve (53-1, 53-2, 53-3), pay (54-1), export (56-1c), remind (56b-1), and put the statement
notices on the alert rules (#486, 62-2c), with the coverage report fixed first (#1032). Four implementers work in four
worktrees on disjoint files; one migration queue and one owner per shared file keep them apart. This plan separates
three things that are not the same: **the code is merged**, **coverage is proven**, **approval is opened**.

## Technical Context

**Language/Version**: TypeScript, Node, pnpm workspace (`docs/06_Tech_Stack_Architecture_EN.md` V1.3)
**Primary Dependencies**: NestJS on Fastify (`apps/api`), NestJS + BullMQ (`apps/worker`), Drizzle, Zod contracts,
Next.js (`apps/admin`), `exceljs` in `packages/documents`
**Storage**: PostgreSQL with RLS through `withTenant`; Redis for BullMQ and the render store
**Testing**: Vitest; integration on the T2 Postgres with one cloned database per spec file (ADR-0006); each worktree
uses its own cluster from `node scripts/test-db/lane.mjs up <lane>` (`docs/runbook.md`)
**Target Platform**: Linux containers on Dokploy (staging today)
**Project Type**: modular monolith; modules `commissions` (api, worker), `settings`, `identity`, `notifications`
**Performance Goals**: no request waits on work over 200 ms (CLAUDE.md §6); perf tests by ratio only (PP-165)
**Constraints**: money as `bigint` mills; one ascending lock call; no raw Drizzle client; Arabic JSDoc on `domain/`,
`ports/`, `events/published.ts`; files ≤ 400 lines, functions ≤ 60
**Scale/Scope**: fourteen parts, about seventeen PRs, seven migration PRs

## Constitution Check

| Gate | Result |
| --- | --- |
| One use case per slice; spec before code | Pass: each part is one canonical row or issue; this spec precedes code |
| No guessed business rule | Pass: DR-008 follows CS-Q52 = PP-227 (Waleed's pick; Abu Salem pending) |
| Tenant table ⇒ RLS + negative test in the same PR | Planned per part (_Parts_) |
| No new package or arrow without an ADR | 55-2f-0 ships the ADR-0054 addendum for R1; 56b-1 ships ADR-0061 first (R8) |
| Money never a `number`; arithmetic only in `domain/` or the engine | Planned; checked by the final review |
| Migrations expand-only, indexes `CONCURRENTLY`, own step | Planned; one queue |
| Read path through `queries/` | The two recorded exceptions only (ADR-0054 §5): `get-commission-estimate`, `get-statement` |

Re-checked after design: no new violation. The one justified complexity is in _Complexity Tracking_.

## Three states, per part

«Code» is merged behind the existing gates. «Coverage proof» is an operator run with a receipt. «Enablement» is a
decision, never a merge.

| Part | Code done when | Coverage proof | Enablement (not in this delivery) |
| --- | --- | --- | --- |
| 55-2f-0, 55-2f | merged, `ci-gate` green | — | staging deploy: manager |
| 51-1, 52-1 | merged | — | staging deploy: manager |
| #1032 | merged | makes the proof trustworthy | — |
| 53-1 | merged; the function exists and counts | ADR-0012 groups 1–4, 7 in CI | staging migrate with a PP-129 snapshot: manager |
| 53-2 | merged; approval refuses without coverage | per company on staging: the six-type replay, then the fixed report prints `COVERED` for a scope that is every business of the company and every business day with inputs (runbook 50-3, 50-4; research R9) | opening approval for a staging company: manager. Any production company or first run: Waleed (PP-201 rule 4; issue #1032) |
| 53-3, 54-1, 56-1c | merged | — | staging deploy: manager |
| 56b-1 | ADR accepted, then merged | CM-58b on a lost Redis in CI | reminders reach real owners only after deploy: manager; production: Waleed |
| #486, 62-2c | merged | — | the #486 data step runs in `migrate`: manager, with a PP-129 snapshot |

## Parts

Sizes are hand-written lines with tests. A delivery over twice its size is refused (PP-192 rule). Every part is
**Heavy** under PP-195 when it has a migration, money or a permission; the others are **Medium**; tier per part below.

### Lane A — repair

**1. 55-2f-0 (Heavy: money path; no migration).** Move the correction step to its shared home (research R1, confirmed by
Waleed, PP-226). Moved: the worker's `domain/commission-correction-step.ts`, `commission-correction-attribution.ts`,
`commission-correction-target.ts`, `commission-source-ref.ts`, `commission-blocked-correction.ts`, the types they
import, `use-cases/post-commission-corrections/`, `use-cases/commission-month-recompute.ts`,
`ports/commission-correction.port.ts`, `persistence/commission-correction-*.ts` and
`commission-blocked-correction-writers.ts`, each with its tests. Edited: the four projectors' imports, the worker
`commissions.module.ts`, both apps' `package.json`, `packages/config/eslint/boundaries.js`, `docs/module-map.md`
(`packages_restricted`), `scripts/module-map` tests, `CLAUDE.md` §2.1, the ADR-0054 addendum. **Accept:** DR-002 —
the worker commission suite passes with no assertion changed; `pnpm module-map:check` and lint pass. **Size:** about
1 500 moved lines (plan-55-2.md §9.1), under 150 new. **Depends on:** nothing.

**2. 55-2f (Heavy: money, permission).** `POST /v1/businesses/:businessId/employees/:employeeId/commission-period-repairs`
(contract in `contracts/statement-flow.md`). New: the contract and OpenAPI entry, `use-cases/repair-commission-period/`,
its transactions port and Drizzle adapter, the controller. Edited: api `commissions.module.ts`, `domain/errors.ts`,
`http/commission-input-errors.ts`, `apps/api/src/shared/errors.ts` (`COMMISSION_REPAIR_NOT_ALLOWED`),
`docs/runbook.md` (the stale 55-2f line). Order inside the transaction: validate → lock the employee → **one**
`lockStatementPeriods` call from the source month through the current month → re-read the current period and refuse a
rollover as retryable → recheck access → store the version (`repair_period = period`, `effective_from` the first day,
`whole_period = false`) → recompute → post or flip the code → audit `commission_plan.period_repaired`. **Tests:**
pure oracle tests first (plan-55-2.md §7: never copy an expected value from output), CM-52, CM-52b, CM-52c, the three
422 cases, permission and feature refusals, device refusal, idempotent replay, the rollover refusal, a barrier test
against a concurrent late line, cross-tenant. R1 of plan-55-2.md (a repair version must not count as the employee's
current plan in any «latest version» read) is checked and tested. **Size:** about 220 production lines
(plan-55-2.md §0). **Depends on:** 55-2f-0 merged.

### Lane B — generate and review

**3. 51-1 PR 1 (Heavy: migration, money).** `commission_carries` (schema, RLS, grants, the three FK indexes, CM-R11);
in `packages/commissions-engine`: the canonical-input builder, the statement builder, both fingerprint inputs (D-6,
D-26, emitting KWD strings and ISO dates only), their types; in api `commissions`: the hash port and its
`persistence/` adapter over `canonicalJson`; the incoming carries added to the estimate (new files — 
`estimate-projection.ts` is already over the 400-line limit and is split, not grown). The full canonical contract of
both fingerprints is fixed here, with the open blocked corrections in the input fingerprint (CS-Q38) and
`repair_period` selected by every reader. **Tests:** builder units for every input kind, CM-34e round trip, CM-R11,
the estimate with a carry. **Size:** about 390 (PP-192). **Depends on:** nothing unmerged to build; opened after its migration turn, merged after
55-2f (R4, ruling M1).

**3 (split, PP-229).** Built, part 3 measured about 1 570 new production lines against the planned 390: the plan had not
counted the statement builder that D-26 and FR-033 require. Waleed's answer to card PP-229 (2026-11-22, verbatim):
«3 PRs للجزء الأول (المقترح): المدخلات والبصمة ~455، بناء الكشف وبصمته ~803، الجدول وربط التقدير ~426». Part 3 is
therefore delivered as three PRs, and part 4 stays a separate PR:

| PR | Content | Limit (new production lines; refused above twice) | Migration | Depends on |
| --- | --- | --- | --- | --- |
| 51-1 PR 1a-i | canonical input, input fingerprint, the FR-022 assembly change, unit tests | about 455 | no | — |
| 51-1 PR 1a-ii | statement builder, statement fingerprint, CM-34e pure half | about 803 | no | 1a-i (stacked) |
| 51-1 PR 1b | `commission_carries` + RLS + CM-R11, hash port and adapter, carries in the estimate | about 426 (314 new + 112 moved verbatim) | yes | 1a-i |

Each PR states its measured numbers split into new logic, verbatim moves, tests, SQL and generated files. 1a-i opens
after its gates; 1a-ii after 1a-i is reviewed; 1b stays local until its migration turn. All of 51-1 still merges after
55-2f (PP-101.2).

**4. 51-1 PR 2 (Heavy: permission, migration).** `use-cases/generate-statement/`, `use-cases/get-statement/` (reader
ports only, `READ ONLY` transaction, D-25), the statement controller, statement contracts; the root-bound branch-names
and customer-names reader ports with their module-map Port rows; `review:commissions:business`: reference-data
migration (catalog row + owner, general_manager, business_manager), `ROLE_DEFAULTS`, `access-catalog`,
`system-role-policy`, `OWNER_GRANTED_PERMISSIONS`, identity's `OWNER_ONLY_EDIT_PERMISSIONS`, i18n permission names;
error codes `COMMISSION_PERIOD_NOT_ENDED`, `COMMISSION_STATEMENT_BLOCKED`. **Tests:** CM-27…CM-29 with CM-28b (R6)
and CM-28c, the generate part of CM-33 and CM-33d, the migrate-only regression for companies created before the
migration, the statement-view part of CM-23d…CM-23h, the statement-view clauses of CM-51 and CM-53b. **Size:** about
460 (PP-192). **Depends on:** PR 1 and 55-2f merged.

**6. 52-1 (Heavy: permission, migration).** `commission_statement_returns` + RLS (CM-33c); review and return use
cases calling the merged `planCommissionStatementReturn`; REVIEWED → DRAFT on writers (D-5, already in
`reopenReviewedStatementPeriods`); `approve:commissions:business` registered like the review code (owner only); the
FR-029b grant-screen warning in `apps/admin/src/permissions/ui/`; `StatementAwaitingApproval`: contract, template,
registrations, and its recipients through a commissions `AlertRulesPort` adapter in the API (DR-003). Error codes
`COMMISSION_FINGERPRINT_STALE`, `COMMISSION_RETURN_REASON_INVALID`, `COMMISSION_STATEMENT_NOT_REVIEWED`. **Tests:**
CM-30…CM-32, the review parts of CM-33, CM-33b, CM-33c, CM-33d, the FR-029b UI test, the migrate-only regression for
the approve code, the refusal of FR-048 at review. **Size:** 350–480. **Depends on:** 51-1 PR 2; #486 merged. Recipients
of the notice follow CS-Q52 = PP-227: everyone who can approve at the time of the event (the FR-030 predicate shared
with the guard: the permission and the business-wide scope); the alert rule decides only whether the kind is on and
its channel. Return is open to a holder of review **or** approve who is a business-wide reader (FR-031, CS-Q26); a
holder whose branch grants together cover every branch is refused with the uniform 403 (CM-33d, CM-38b).

### Lane C — count and approve

**8. #1032 (Medium; no migration, no money write).** Research R9; every check the report has today stays and the new rules are added to them. Files: the worker's
`use-cases/report-commission-coverage/` (`report-commission-coverage.ts`, `check-tip-coverage.ts`),
`ports/commission-coverage.port.ts`, worker `commissions.module.ts`, the CLI root
`apps/worker/src/report-commission-coverage.ts`, their specs and the two `-db` specs, `docs/runbook.md` (coverage
sections), the ADR-0054 §4 text, a module-map Port row for the business reader. **Tests:** the three false-coverage
cases each fail to print `COVERED`; the test that pins `COVERED` with no tip scope is rewritten; a second tenant's
business is refused. **Size:** 150–250. **Depends on:** nothing. **Starts now.**

**7. 53-1 (Heavy: migration, security).** ADR-0012 exactly: `pospay_approval_reader` (created in
`packages/db/src/roles.ts`, as `pospay_suppression_reader` is), the function
`statement_pending_commission_events(approval_started_at)` over the six types, the two `SELECT` policies, column
grants, revokes; no dedicated index (withdrawn by CS-Q56, ADR-0012 addendum 2026-11-23);
`function-inventory.ts`, `table-grants.ts`, `privileges.spec.ts`; the six type names as one
exported constant read by the worker registration and the catalogue test (research _Open gaps_). **Tests:** ADR-0012
groups 1, 2, 3, 4 and 7 (CM-39). **Size:** 350–500. **Depends on:** the design-advisor round, done
2026-11-22 (research A1, A2): the brief pins ADR-0012 §1–§2 in full and the tests prove the effective privileges.

**9. 53-2 (Heavy: money, permission).** `use-cases/approve-statement/`: one lock call; the coverage gate, **whose shape is
open (T3)**: a live comparison with the engine's `compareCoverage` is the path being measured, not a decided
implementation, and no coverage reader, proof table or migration is written before the answer; the pending count with the server's
own transaction timestamp; the statement builder called once feeding the pre-freeze comparison and the freeze insert;
the attachment snapshot; the post-freeze statement-fingerprint recompute; carries by D-22 with the D-13 selector from
the shared home; the approval guard (FR-036); HTTP. Error codes `COMMISSION_UPDATES_PENDING` and the 409 family.
**Tests:** the approval part of CM-33, CM-34, CM-34b…CM-34e (integration), CM-35, CM-37, CM-38, CM-38b, ADR-0012
group 5, the carry cases of spec 059 §7 row 53-2, the statement-view clause of CM-54. **Size:** 400–550. **Depends
on:** 52-1, 53-1, 55-2f, #1032 merged. It adds the parked-event owner alert (A4, design accepted by the PosPay manager:
raised after the committed park, deduped by a `commissions.park-alert` consumer mark, to the company's owners) and a
staff employment-dates reader for the departed rule (A6). **The coverage gate is a stored bootstrap proof (T3 =
CS-Q54, Waleed 2026-11-22):** 53-2 has a migration for the proof (its turn in the queue follows 52-1), and an ADR-0054
addendum with the FR-032 amendment is written and reviewed before the gate's code (research R11).

**10. 53-3 (Medium: screen and tests).** CM-36 barrier tests on a harness where a real API approval races the worker
consumer (ADR-0012 group 6); the admin statement screen under `apps/admin/src/commissions/` (view, review, return,
approve, blocking issues, the «تصحيحات شهور سابقة» section, CS-Q9), its route, the nav entry leaving `soon`, i18n
keys, component tests that assert what the user sees. **Size:** 400–550. **Depends on:** 53-2.

### Lane D — rules, pay, export, remind

**5. #486 (Heavy: migration data step, permissions-adjacent).** Research R5. Files: `packages/domain/src/alert-rules.ts`
and its spec, the settings module's alert-rules spec, the admin role picker if it offers the role, the data step
registered in `packages/db/src/data-steps/index.ts`, its migration. **Tests:** the validator refuses the role on every
statement kind that accepts roles and still accepts it elsewhere; the data step is idempotent, per tenant, audited; the CHECK refuses a direct
insert. **Size:** 120–200. **Depends on:** nothing. **Starts now.**

**12a. 56-1c API (Medium).** The request stores the scope, `branch_ids`, `employee_ids` and the caller's language
(FR-050, CS-Q33). Request, poll and collect use cases, the controller, contracts and OpenAPI, the
collect-time re-check, the audit entry `commission_statement.exported`, the rate limit, admission through
`documentKindNeedsRenderer`; modelled on the staff attendance-statement request and collect use cases. **Tests:**
CM-55d, CM-55e, the export part of CM-23d…CM-23h, on statements seeded APPROVED through
`packages/db/test/commission-statement-fixtures.ts`. **Size:** 300–420. **Depends on:** nothing unmerged to build;
its merge is after 53-2 (manager's ruling M3, _Open decisions_).

**11. 54-1 (Heavy: money, permission, migration).** Research R7. The payment columns, the per-employee payment table
with RLS, its negative test, a guard that accepts a row only for an employee frozen in that statement, and a
commit-time check that refuses the transition to `PAID` unless the set of payment rows equals the set of frozen
`EMPLOYEE` lines (test: one row left out, the whole transaction rolls back), the widened column grant and the replaced `commission_statements_update_guard` (today
APPROVED → PAID may change only `status`), `pay:commissions:business` (owner, general_manager, accountant; grantable),
`use-cases/mark-statement-paid/` + HTTP, rounding as a pure function in the engine with exhaustive unit tests (half up
to 0.005 KWD), the screen button on 53-3's screen. Error codes `COMMISSION_STATEMENT_NOT_APPROVED`,
`COMMISSION_STATEMENT_ALREADY_PAID`. **Tests:** CM-40…CM-42, rounding units, the new table's isolation test.
**Size:** 250–350 (the table adds about 80). **Depends on:** 53-2; the button on 53-3.

**12b. #716 (Medium).** Remove the `PAID` refusal in the worker's `read-commission-statement-export`, read the paid
amount from 54-1's record, pass the paid-cash column to the workbook only for cash. The paid amount is shown only for an employee whose whole month the export shows (research R7); the partial case is
taken from plan-56-1b.md, else `TODO(spec)` and omitted. **Tests:** every payment method; APPROVED → PAID while the
job waits; a branch-scoped export in both cases — her paid amount appears when her whole month is visible to the
reader, and is withheld when part of her month is outside the reader's scope. **Size:** 80–150. **Depends on:** 54-1, 56-1c API.

**13. 56b-1 (Heavy: migration, security).** First ADR-0061 (research R8), docs-only, to Waleed. Then:
`commission_statement_reminders` + RLS (CM-R09), `operational_recovery_flags` with CS-Q31's grants and the ADR's
functions, the `CompanyCreated` scheduler registration (pattern: the staff not-clocked-in processor), the sentinel and
heartbeat, `/ready` degraded, the rebuild with its guarded self-clear and bounded retry, the fallback operator command,
the reminder job with recipients through `AlertRulesPort` (DR-003), amendments to CLAUDE.md §5, ADR-0003, ADR-0054 §2,
the runbook, the module-map event row. **Tests:** CM-57, CM-57b, CM-57c (a quiet business still gets its reminder; the
worker stays degraded until every company is rebuilt), CM-58, CM-58b, the privilege inventory. **Size:**
300–420 plus the ADR. **Depends on:** 52-1 merged (the notification files are shared, one at a time); ADR-0061
accepted. Recipients of the approval reminder follow CS-Q52 = PP-227, as in 52-1.

**14. 62-2c (Medium).** Tests only for the wiring that 52-1 and 56b-1 shipped: each statement kind off → no
recipients; master switch off → none; defaults → today's recipients (RT-26); the statement kinds listed in
`apps/admin/src/settings/alert-rules/model/listed-alert-kinds.ts`; the module-map `reads` line. **Size:** 100–160.
**Depends on:** #486, 52-1, 56b-1.

## Start state at the base

| State | Parts |
| --- | --- |
| Starts now, can merge when green | #1032, #486 (its migration turn), 55-2f-0 |
| Starts now, merge waits for a named answer or merge | 51-1 PR 1 (its migration turn, then 55-2f), 56-1c API (53-2), ADR-0061 draft (Waleed) |
| Starts now, merge waits for its migration turn | 53-1 |
| Preparation only until its dependency | 55-2f, 51-1 PR 2, 52-1, 53-2, 53-3, 54-1, #716, 56b-1 code, 62-2c |

Preparation means: reading, fixtures, pure functions with their unit tests, test skeletons. It never means opening a
PR for the dependent code or writing a migration number.

## Dependency order

```text
55-2f-0 ─► 55-2f ─┬────────────────────────────► 53-2 ─► 53-3 ─► export button
51-1 PR1 ─(after 55-2f)─► 51-1 PR2 ─► 52-1 ─────┘   │
#486 ───────────────────────────────► 52-1          ├─► 54-1 ─► #716
#1032 ──────────────────────────────────────► 53-2  │
53-1 ───────────────────────────────────────► 53-2  │
56-1c API ────────────────────────────────────────► #716
ADR-0061 ─► 56b-1 (after 52-1) ─► 62-2c (after #486, 52-1)
```

## Migration queue

One queue for this delivery; the PosPay manager grants each turn and sets the order against row 61, whose local branch
`T3-CODE/pospay-61-unified-medium` already holds two migration files after main's latest. Implementers build and test
migrations on their own private cluster and **take a number, run `pnpm db:generate` and push only when granted**
(PP-130: a second open migration PR is stacked on the first's branch; the manager retargets it before
`--delete-branch`). Proposed order, each waiting for the one before it to merge:

1. 53-1 (the function file only; the index file was withdrawn by CS-Q56, ADR-0012 addendum 2026-11-23)
2. 51-1 PR 1b (`commission_carries`)
3. #486 (data step + CHECK)
4. 51-1 PR 2 (review permission)
5. 52-1 (returns table, approve permission)
6. 53-2 (the bootstrap coverage proof, CS-Q54) — no number reserved; never ahead of 52-1, 53-1 or 55-2f
7. 54-1 (payment columns, payment table, pay permission)
8. 56b-1 (reminders, recovery flags)

A branch that fails the chain check with «expected first parent» is stale and is updated, never renumbered by hand.

## Shared files: one owner at a time

| File | Parts that edit it | Rule |
| --- | --- | --- |
| `apps/api/src/shared/errors.ts`, api `commissions/domain/errors.ts` | 55-2f, 51-1 PR 2, 52-1, 53-2, 54-1, 56-1c | add-only lines; rebase on main before the push; never reorder |
| `packages/contracts/src/commissions/index.ts`, `openapi.json`, the generated `schema.d.ts` | the same | regenerate with `pnpm contracts:openapi` after rebasing, never hand-merge |
| api `commissions.module.ts`, `apps/api/src/app.ts` bindings | 55-2f, 51-1, 52-1, 53-2, 54-1, 56-1c | one open PR at a time per lane; cross-lane conflicts resolved by the later PR |
| worker `commissions.module.ts` | 55-2f-0, #1032, 53-1 (constant), 56b-1 | #1032 merges before 55-2f-0 opens for merge, or rebases after it |
| `packages/commissions-engine/src/index.ts` | 51-1 PR 1, 54-1 | add-only exports |
| Permission lists: `role-defaults.ts`, `access-catalog.ts`, `system-role-policy.ts`, identity `permission-edit.ts`, i18n permission names | 51-1 PR 2 → 52-1 → 54-1 | strictly in that order |
| `packages/db/test/function-inventory.ts`, `table-grants.ts`, `tenant-table-inventory.ts`, `privileges.spec.ts`, `schema/index.ts` | every migration part | follows the migration queue |
| Notification files (`packages/contracts/src/in-app-notifications.ts`, `packages/notifications/src/`, `packages/i18n/src/in-app-catalog.ts`, admin `render-notification.ts`) | 52-1 then 56b-1 | one at a time (spec 059 §7 _File overlap_) |
| `docs/module-map.md` | 55-2f-0, #1032, 51-1 PR 2, 56b-1, 62-2c | each adds its own rows; `pnpm module-map:check` after rebasing |
| `apps/admin/src/commissions/` | 53-3, then 54-1's button, then the export button | 53-3 owns the folder until merged |
| Open PRs | every lane | one open delivery PR per lane at a time; each counts in the coordinated cap (ruling M4); a second one needs the manager's word |
| `CLAUDE.md` | 55-2f-0 (§2.1), 56b-1 (§5) | separate sections |
| `docs/runbook.md` | 55-2f, #1032, 56b-1 | separate sections |
| `docs/adr/0054-…md` | 55-2f-0 (§1 addendum), #1032 (§4 text), 56b-1 (§2) | separate sections; rebase before the push |
| The generated module-map YAML | every part that edits `docs/module-map.md` | regenerate after rebasing, never hand-merge |

## Route

- **Planner and manager of this delivery:** Claude Fable 5.2 medium (this session), by Waleed's sentence in spec.md
  _Input_.
- **Implementers:** four Claude Sonnet 5.5 at high effort, each in its own worktree through `delegate_task`
  (`isolation: worktree`, role implementation). The repository has no PP item for this lane; the manager is asked to
  record it.
- **Guards (PP-198):** the implementer runs `clean-code-guard` and `test-guard` on every part and
  `waleed-security-reviewer` on every Heavy part, and fixes what they find. This session then runs one whole-diff
  review per PR on a different model from the implementer.
- **Rounds:** at most three review rounds per PR, one consolidated push per round, Codex once on the final head, the
  MergePilot panel on the exact head (PP-131.2, PP-119.1). After round three, P2 and P3 become issues.
- **Local gates per part:** typecheck and lint of the touched packages, `pnpm lint:docs`, `pnpm module-map:check`,
  `pnpm migration-chain:check` when a migration exists, `pnpm contracts:openapi` then the admin and POS `api:check`
  when a contract changes, and the part's own tests. Reported as «implementation complete, pending `ci-gate`» (PP-113).
- **Merge:** the PosPay manager, in the order above, on a green exact-head `ci-gate` (PP-201). This session reports
  each merge-ready head to the manager with its receipts.
- **Deploy:** none by this delivery (DR-007).

## Open decisions

| # | Decision | Who | Blocks | Meanwhile |
| --- | --- | --- | --- | --- |
| T1 | Home of the moved correction step (research R1) | Waleed — **answered, PP-226:** the restricted package `packages/commissions-posting` with an ADR-0054 addendum | nothing | 55-2f-0 opens after its review and gates |
| T2 | ADR-0061's security choices (research R8) | Waleed (technical) | 56b-1 code | ADR drafted |
| T3 | The shape of 53-2's coverage gate (design round A3) | Waleed — **answered 2026-11-22, CS-Q54:** «إثبات تأسيسي مخزّن (المقترح)، بشرط تقييد إصداره وإبطاله عند تغيّر شروط التغطية» | nothing; the design contract (research R11) is written before the gate's code | lane C writes the ADR-0054 addendum |
| F1 | CS-Q52: who receives statement notices (DR-008) | both owners, batch 100 — **Waleed answered, PP-227:** everyone who can approve; the rule controls on/off and channel. Abu Salem pending; his pick binds if it differs | nothing: work follows Waleed's pick (CLAUDE.md §1 5b) | 52-1 and 56b-1 implement it |
| M1 | 51-1 PR 1 merges before or after 55-2f (research R4) | PosPay manager — **ruled 2026-11-22:** build and test locally; open after its migration turn and the gates; merge after 55-2f (PP-101.2) | merge of 51-1 PR 1 | built locally |
| M2 | Migration order against row 61 | PosPay manager — **ruled 2026-11-22:** row 61 first; the order in _Migration queue_ is a proposal by readiness and dependency, not a grant and not a reservation of numbers | every migration push | private clusters |
| M3 | 56-1c API merges before 53-2 | PosPay manager — **ruled 2026-11-22:** local tests on fixtures are allowed; merge after 53-2 (plan-56-1.md); `PAID` support after 54-1 | merge of 56-1c API | built on fixtures |
| M4 | The session cap (PP-118) with four implementers under one manager session | PosPay manager — **ruled 2026-11-22:** the four run under this session as Waleed asked; every open delivery PR counts in the coordinated cap; a design review is not a delivery | nothing | — |
| M5 | Record Waleed's Sonnet sentence as a PP item | PosPay manager — **ruled 2026-11-22:** being recorded as PP-225, for this delivery only | nothing | quoted in spec.md |
| D1 | Design-advisor round for 53-1 and 53-2 | **done 2026-11-22** (research _Design-advisor round_): 53-1's function may be written against the pinned contract; one point stays open as T3 | nothing | — |

## Project Structure

### Documentation (this feature)

```text
docs/specs/059-commissions-statements/51-56-statements-delivery/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/statement-flow.md
├── checklists/requirements.md
└── briefs/            # one brief per lane, written before dispatch
```

### Source Code (repository root)

```text
apps/api/src/modules/commissions/      use-cases/{repair-commission-period,generate-statement,get-statement,
                                       review-statement,return-statement,approve-statement,mark-statement-paid,
                                       request|poll|collect statement export}, ports/, persistence/, http/, events/
apps/worker/src/modules/commissions/   use-cases/report-commission-coverage (fix), jobs/ reminders, imports of the
                                       shared correction step
packages/commissions-posting/          the moved correction step (R1, PP-226)
packages/commissions-engine/src/       canonical input, statement builder, fingerprints, cash rounding
packages/db/                           schema + migrations + roles + inventories + data step
packages/contracts/src/commissions/    statement, repair, payment, export contracts
packages/domain/src/alert-rules.ts     #486
apps/admin/src/commissions/            statement screen (53-3), pay and export buttons
apps/admin/src/permissions/ui/         FR-029b warning
docs/adr/                              ADR-0054 addendum (55-2f-0), ADR-0061 (56b-1), ADR-0012 unchanged
```

**Structure Decision**: the existing module shape of CLAUDE.md §2.2; one new restricted package (PP-226).

## Complexity Tracking

| Violation | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| A new package (`packages/commissions-posting`) | CS-Q46 requires one correction step for the API and the worker | the engine must stay pure (D-23); `apps/api` cannot import `apps/worker`; a copy would give two pricing paths |
| A second `SECURITY DEFINER` surface for reminders (ADR-0061) | CS-Q32 requires the worker to rebuild every company's schedule and clear the flag itself | a table grant would let the runtime clear any flag (D-24) |
