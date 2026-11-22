# Lane A — repair (55-2f-0, then 55-2f)

Read `COMMON.md` first. Your parts are 1 and 2 of `plan.md` _Lane A_. Private database lane name: `stmt-a`.

## Sources

- `docs/specs/059-commissions-statements/plan-55-2.md` §1, §7 (the money oracles O2 and O4), §9, §10, §11, §12.
- `spec.md` (059) Story 10, FR-046…FR-049, CM-52, CM-52b, CM-52c, D-12, D-13.
- `owner-questions.ar.md`: CS-Q11, CS-Q46 (= PP-205.1), CS-Q47 (= PP-205.2), CS-Q48.
- This delivery: `research.md` R1, R2, R3.

## Part 1 — 55-2f-0: move the correction step (Heavy, no migration, no logic change)

**Goal.** The correction step leaves `apps/worker/src/modules/commissions` for a home that both `commissions` modules
import. The home is a new restricted package `packages/commissions-posting` with an ADR-0054 addendum, confirmed by
Waleed (PP-226, `research.md` R1). Open the PR when the move is green and your guard pass is done.

**Do now.**

1. Write the exact file inventory: every file of the step, what each imports, and which imports are worker-only
   (`research.md` _Evidence_ lists the starting set; known couplings: `Clock` and `IdGenerator` come from the line
   projection port, error classes sit in the worker's `domain/errors.ts`, period types come from
   `commission-line-types.ts`, `commission-source-ref.ts` imports from the tip and salary inputs, and the step's input
   requires a notice writer and `companyId`). Send this inventory in your first report.
2. Draft the ADR-0054 addendum (the new package, who may import it, why not the engine) and the CLAUDE.md §2.1 row.
3. Build the move in your worktree: the package scaffold with `exports` listing only its entry point; the moved files
   and their tests, byte-for-byte except import paths; the `packages_restricted` entry in `docs/module-map.md` with the
   generated YAML; the ESLint boundary blocks; the module-map tests; the four projectors and the worker module importing
   from the package. The notice writer becomes an optional input (`research.md` R2) — this is the only signature
   change, and the worker passes exactly what it passes today.

**Accept.** The worker commission suite passes with **no assertion changed** and no test deleted; `pnpm lint`,
`pnpm lint:docs`, `pnpm module-map:check` pass; the diff of every moved file is a rename plus import lines. Size: about
1 500 moved lines, under 150 new.

**Watch.** Lane C edits the worker `commissions.module.ts` and the coverage use case for issue #1032. Do not touch
`use-cases/report-commission-coverage/`. Rebase on `main` before you open the PR.

## Part 2 — 55-2f: the repair route (Heavy: money and permission; no migration)

**Starts** when 55-2f-0 is merged. Until then: preparation only — the pure oracle tests of plan-55-2.md §7 (O2 under
CS-Q47: the late line counts in the month's tier total; O4), written from the rules and the worked numbers there,
**never from the output of the code**.

**Scope.** As `plan.md` part 2 and `contracts/statement-flow.md` row 55-2f. The route, the contract with its OpenAPI
entry, `use-cases/repair-commission-period/`, its transactions port and Drizzle adapter, the controller, the error
code `COMMISSION_REPAIR_NOT_ALLOWED` (ar/en text in spec 059 §6 _Error codes_), the runbook line that still says
55-2f waits on CS-Q46 and CS-Q47.

**Order inside the one transaction.** validate the plan with the engine validator → lock the employee →
**one** `lockStatementPeriods` call covering the source month through the business's current month → re-read the
current period; if it rolled over, refuse as retryable (do not loop with a second lock call) → recheck access → store
the version (`repair_period = period`, `effective_from` = the first day of the period, `whole_period = false`) →
recompute the month → post the corrections with `event_id` = the block's `first_event_id` (`research.md` R3) and
resolve the block, **or**, if the recompute now says `NO_SALARY`, flip the block's code on the same row and post
nothing → audit `commission_plan.period_repaired`. The version and the audit commit in both outcomes (CM-52b). Follow
the sibling writer `create-commission-plan-version` for the idempotency and access-recheck pattern, and the guard of
the 55-2e list for the permission (`manage:commission-plans:business`, feature `commissions`).

**Tests.** The pure oracles; CM-52, CM-52b, CM-52c; the three 422 cases (no block, a `NO_SALARY` block, a resolved
block); permission, feature and device refusals; idempotent replay; the rollover refusal; a barrier test against a
concurrent late line (barriers, not sleeps); cross-tenant. Also check and test risk R1 of plan-55-2.md §12: a repair
version is never counted as the employee's current plan by any «latest version» read (the plan-versions list, the
plan-employees list, the admin screens' data) — report what you find before changing a read you do not own.

**Size.** About 220 production lines.

## Not yours

Statement generate, review, approve, the carries table, the pending count, payments, exports, reminders, alert rules.
53-2 will import the D-13 target selector from the package you create; keep its export stable and say its name in
your report.

## Addendum — design-advisor round (research.md A8)

The new package must itself be allowed to import the engine's root entry point. `packages_restricted` only governs who
may import `packages/commissions-posting`; the engine's own boundary test (`scripts/module-map/commissions-engine.test.mjs`)
refuses a sibling package today. So 55-2f-0 also: adds the narrow exception for this one package (ADR-0054 addendum,
ESLint, the static, dynamic and relative import tests), lists only the package's entry point in `exports`, updates the
package maps, and declares every direct dependency (`drizzle-orm` included, if imported directly) in the new manifest.
The exception names this package and nothing else.