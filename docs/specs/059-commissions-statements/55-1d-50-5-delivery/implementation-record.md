# Implementation record — 55-1d and 50-5

Base `aa1c79569a371c101400d2c895d17351694833c9` (PR #1162, 42-4 + 46-2a-S), restacked on
`55ae0a3a1c6d771d7b73cc759afa63ef3cb4ef72` (main after PR #1171 / 62-2e). Provider: OpenCode
`minimax-coding-plan/MiniMax-M3.1-Flash`, available default, no explicit variant. Tier: Heavy, one PR.

## 55-1d — the closed source month is corrected, not refused

- `ProjectPackageSale` no longer throws `COMMISSION_PERIOD_CLOSED`. It locks the sale identity, reads
  the held revision, compares revisions, locks the union of source and candidate months once in
  ascending order, keeps the business-timezone rollover check, selects the target from the locked
  statuses, writes the sale row once, then runs the shared correction and block path and reopens the
  REVIEWED months last (D-5 order).
- The affected pairs are the previous seller and month whose sale disappeared plus the new seller and
  month, deduplicated by `(period, employee)` and restricted to the closed months
  (`affectedCommissionSaleEmployees`).
- The delta stays `new amount − (frozen amount + sum of the published deltas)`: the correction step
  already computes it, and the recompute now reads the sale rows so the engine prices them.
- `readMonthProjection` reads `commission_sales` and maps the stored `SOLD` status to the engine
  `ACTIVE` status explicitly (`projectPackageSaleStatus`, shared with the API adapter). The stored
  status, the paid price and the cumulative refund stay untouched in the projection.
- A sale never reaches the service tiers: the engine prices sales separately from the line accumulator.
- The plan decoder moved to `packages/commissions-engine` so the worker and the API read a stored plan
  the same way; the worker file keeps its own error type by wrapping the engine error.

## 50-5 — the estimate on read

- `GET /v1/businesses/:businessId/commissions/periods/:period/estimate?employee_id=` returns the
  per-source amounts, the total, the sales, the tips split by method, the received corrections and
  the status `OK | NO_PLAN | NO_SALARY` of every visible employee.
- The use case reads on one read-only transaction (`withTenant(..., { readOnly: true })`), prices one
  full month per employee with the public engine, then filters the rows by the branch scope. Tips and
  corrections pass through unpriced and stay in their own sections.
- The scope is resolved in the same read transaction: the union of the branches the active
  memberships and current ALLOWs cover, minus every branch a current DENY covers. A reader with a
  company- or business-scoped grant and no DENY sees the whole business; a union of branch grants
  stays branch-scoped even when it covers every branch (CM-23g); an empty scope is the uniform 403.
- The route declares `@Authenticated()` and not `@Require` on the business target, because the guard
  evaluates a business target and would refuse a branch-scoped holder before its grants are read.
- The permission `read:commissions:business` is registered in the catalog with the approved global
  role defaults (owner, general manager, business manager, accountant, branch manager), refused to
  devices, and granted to existing companies by one reference-data migration.

## Migration lane

`0239_2026-11-22_commissions-read-permission.sql` with its snapshot and the journal entry at
`idx 239`, on top of PR #1171's `0237`/`0238` (`idx 237` and `238`). The snapshot is regenerated with
`pnpm db:generate` on the combined schema, so `0239.prevId` is `0238`'s id and the
`employee_documents.document_number` column from `0237` survives. The chain check is green.

The read-only transaction option is the shared one from `main` (PR #1171's correction): it sets
`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY` before the tenant context on the regular
and the bounded path, so the scope, the attachments and the full-month reads share one snapshot. This
delivery keeps the proof that a change committed by another transaction after the snapshot was taken
stays invisible to the reader.

## Independent review answers

The independent defensive review (Codex `gpt-6.2-sol`, `reasoningEffort=medium`, read-only) returned
BLOCK. The answers:

- **Critical — an unpriced month read as zero.** A month the engine cannot price (`NO_PLAN` or
  `NO_SALARY`) now reports a null commission total, on the employee and on the activity, so an
  unknown amount never reads as a real zero (FR-021). The known tips and corrections still show, and
  the status still says why the month was not priced.
- **An attached employee with no work was invisible.** The attachment alone now makes an employee a
  candidate, so a branch reader sees the employees attached to her branches even when the month has
  no rows for them (CS-Q20).
- **The estimate opened two company transactions.** The company now comes from the header, and the
  membership, the permission, the feature and every data read happen inside one read-only snapshot.
  The device refusal and the selected-company verification stay.
- **The owner protection versus CS-Q20.** The owner protection (ADR-0025) wins: a canonical owner
  keeps the business-wide scope even when a sibling membership carries a current DENY. The rule is
  pinned in the scope reader and in a test.
- **The migration upgrade proof.** The reference-data migration is now proved as an upgrade: the
  permission and its grants are removed, a legacy company and its memberships are kept, the migration
  file is applied alone with no reseed, and the approved roles hold the grant while the others do not.
- **Service names.** The catalog exposes a public service-names reader, and every visible estimate
  line carries its service name; a row outside the reader's scope never reveals the name behind it.
- **Coverage added.** A paid month corrects like an approved one, and a failure after the sale write
  in a closed month leaves nothing behind before a redelivery projects once.

## Correction round after the panel review (2026-11-22)

One consolidated round on top of the published head `cd8bbd5a7`, against the ten deduplicated groups
the manager sent plus the two later items (the employee-id normalisation and the OpenAPI nullable
totals) and the `Tx` port finding. Dispositions:

1. **Aggregation moved to the engine.** The estimate's pricing, visibility and bigint aggregation
   live in `packages/commissions-engine` (`estimate-projection.ts` and `estimate-visibility.ts`); the
   API use case orchestrates the read and maps the projection to the contract, with no arithmetic in
   `use-cases/`.
2. **Only relevant DENYs narrow a business-wide grant.** A DENY scoped to a sibling business or to a
   branch of one no longer downgrades the requested business; a business without branches keeps its
   business-wide scope. Owner protection (ADR-0025) and real same-business denials stay, and the
   route tests cover the sibling business, the sibling branch and the applicable deny.
3. **A hidden source's pricing failure no longer hides the visible amounts.** The engine reports the
   pricing failures per source (`computePeriodDetailed`); a branch-scoped reader loses nothing that
   her scope prices, keeps the full-month accumulator and never sees the cause of a failure she
   cannot see. A failure on a visible source still refuses the month with a null total (D-57), and
   the worker's atomic no-partial contract is untouched.
4. **Superseded by D-57 in the round-2 correction below; the text is kept as history.** A sale is
   priced independently of the service-tier salary. The engine selects the plan version
   for a sale without resolving the salary-based service tiers (D-51: the package sale is independent
   of the accumulator; the sale rule is a percentage or a fixed amount of the price). A sale-only
   month with a salary-multiple plan and no salary now prices the sale (or pays zero when the package
   rule is disabled) instead of blocking, so the closed-month path publishes the refund delta. A
   service line on `FOLLOW_PLAN` without a salary still refuses the month with `NO_SALARY`, and the
   engine's D-57 test was narrowed to that service case.
5. **The device refusal test uses the real scheme.** The paired device authenticates with
   `Device <token>` and the estimate answers 403 `FORBIDDEN`.
6. **Performance.** The optional employee filter is pushed into the tenant-safe reads (the month rows
   and the names), the in-memory rows and attachments are grouped once, the branch-coverage scan is
   skipped for a business-wide reader, and the attachment reads are constrained to the requested
   month. No new migration and no pagination change.
7. **Repair plans.** `commission_plan_versions_repair_matches_effective_from` forces a repair
   version's `effective_from` to its repair month's first day, so both prefilters (the SQL and the
   shared assembly) keep a repair version whose `repair_period` matches the requested month. The
   estimate test prices a month through its repair plan and the worker recomputes through the same
   shared assembly.
8. **The top-level `partial` flag.** A branch-scoped aggregate is always labelled partial,
   independently of the employee rows, and the flag is the same for an absent and an inaccessible
   employee filter; nothing in the response depends on hidden data.
9. **The permission is delegatable.** `read:commissions:business` joined `OWNER_GRANTED_PERMISSIONS`
   in `packages/db` and in the API's permission editor, so the owner can grant it to any global human
   role and revoke it, while the device stays forbidden. No new default, grant migration or role.
10. **The request log binds the verified company.** The controller binds the company after the read
    proved the membership, through the shared `bindVerifiedCompany` helper; a refused reader binds
    nothing.
11. **`employee_id` is normalised at the request boundary.** The query schema lowercases the UUID, so
    an uppercase and a lowercase id return the same in-scope result.
12. **The OpenAPI 3.0 totals admit null.** The two totals are emitted as inline
    `nullable` string schemas with the monetary pattern instead of `nullable` over `allOf` wrapping a
    `$ref`, and the contracts test pins the emitted shape with the null accepted and the malformed
    money refused.
13. **`Tx` left the port.** `commission-estimate.port.ts` is database-agnostic; the `Tx`-taking
    provider shape lives in `persistence/commission-estimate-providers.ts` and the composition root
    binds it, on the same single read-only transaction with the membership proven before the tenant
    context.

`0239` was untouched, and no migration, deploy or target operation came from this round.

### Gates of the correction head

- packages/db 175 files / 3228 tests; packages/commissions-engine 23 files / 517 tests; packages/contracts
  95 files / 1360 tests; apps/worker commissions 61 files / 575 tests; apps/api commissions 31 files /
  245 tests — all green on one PostgreSQL lane.
- typecheck and lint clean for db, commissions-engine, contracts, api and worker; `lint:docs`,
  `module-map:check`, `migration-chain:check` and the three client `api:check` scripts green.

## Round-2 correction after the MergePilot receipt (2026-11-22)

One consolidated round on top of the published head `8c2b8eb34`, against the five groups of the
round-2 receipt plus D-57. Dispositions:

1. **A refused month keeps what is known without pricing.** When a visible source refuses the month
   (`NO_PLAN` or `NO_SALARY`), the row keeps the reader's scoped card and cash tips and her received
   corrections; the commission total stays null, the sources and sales stay empty, and nothing is
   paid partially.
2. **D-57 restored for sales (supersedes round-1 item 4).** A sale under a plan whose tiers use a
   salary multiple needs the salary, like a service line. A sale-only month with such a plan and no
   salary refuses with `NO_SALARY`; in the worker's closed-month path it records a
   `commission_blocked_corrections` row and publishes no ledger correction. A missing plan stays
   `NO_PLAN`. With the salary present the sale prices.
3. **Month coverage is clipped.** An attachment is half-open `[from, to)` and is clipped to the
   month: an end in a later month or year covers the rest of the month, a past end and a future start
   cover nothing.
4. **Candidates come from activity and attachments.** A line, a sale, a tip or a received correction
   in the month, or a dated in-scope attachment, makes an employee a candidate. A salary, plan or
   override row alone adds no result.
5. **Source dates are indexed once per employee** instead of scanning the lines and sales for every
   pricing failure.
6. **The fixture database pool is closed** in `afterAll` and when the fixture setup fails, in the
   hidden-plan and refused-rows route specs.

7. **Independent exact-head review (Codex `gpt-6.2-sol`, medium, read-only) on `ebe1f1dfb`:** one P2
   and three P3, all fixed in the same round. The `partial` flag of a refused row now describes the
   scope only (a row outside the reader's branches or incomplete day coverage), like a priced row;
   the refusal is carried by the status and the null total. The month-coverage comparison uses the
   last day inside the month, so December 9999 is covered. The configuration-row test runs as a
   business-wide reader and covers a salary, a plan and an override row each alone. A second-branch
   reader route test proves a visible refusal with only her in-scope tips and corrections.

`0239` was untouched, and no migration, deploy or target operation came from this round.

### Gates of the round-2 head

- packages/commissions-engine 23 files / 531 tests; the three estimate route specs of apps/api
  3 files / 14 tests; the worker spec `project-package-sale-corrections-db.spec.ts` 1 file / 10 tests,
  run against a freshly built engine `dist` — all green on one PostgreSQL lane.
- typecheck and lint clean for commissions-engine, api and worker; `lint:docs` and `module-map:check`
  green.
- The full api and worker suites were not run locally; `ci-gate` on the pushed head decides them
  (PP-113).

## Round-3 correction after the panel on `22c01f3d6` (2026-11-22)

One consolidated round against the three new MergePilot threads and one CodeRabbit follow-up.

1. **The API test harness forwards the member transaction's options.** `withMember`'s fourth
   argument reached the database only in production; the harness proxy dropped it, so the route
   tests ran the default transaction. The proxy now forwards it, and for a read-only request it
   records what PostgreSQL itself reports (`transaction_read_only`, `transaction_isolation`). A route
   test asserts one `on` / `repeatable read` transaction for the estimate.
2. **Cancelled or out-of-month sources no longer create candidates.** The candidate scan uses the
   shared assembler's predicate (active, business date inside the month) for lines and sales. An
   unattached employee whose only source is cancelled is absent; an attached one still shows a real
   zero, and tips and received corrections still count.
3. **Attachment bounds are clipped to the month in SQL.** `employee_branches` accepts a date beyond
   year 9999 (no constraint forbids it), and such an end sorts before a four-digit year as text in
   the engine. The estimate's attachment reader now returns `GREATEST("from", month start)` and a
   NULL end when the end is on or after the first day of the next month, compared as dates. No
   schema or migration change. The second-branch route case stores an end of `10000-01-01` and was
   run against the previous reader, where it fails (`OK` instead of `NO_PLAN`), and against the new
   one, where it passes.
4. **CodeRabbit's signed-amount request.** A database-free engine test keeps a negative received
   correction and the tips out of the commission subtotal.

5. **Independent exact-head review (Codex `gpt-6.2-sol`, medium, read-only) on `7c6f77688`:** PASS,
   no P0-P2, three P3 on the tests, all applied. The snapshot test also asserts a single tenant
   transaction for the whole request; the candidate test covers a cancelled line, a cancelled sale
   and an active line and sale of another month; the fixture comment states what `::text::date`
   preserves.

`0239` was untouched, and no migration, deploy or target operation came from this round.

### Gates of the round-3 head

- packages/commissions-engine 24 files / 537 tests; four estimate route specs of apps/api (estimate,
  access, hidden-plan, refused-rows) 4 files / 38 tests — green on one PostgreSQL lane.
- typecheck and lint clean for commissions-engine and api; `lint:docs` green.
- The full api and worker suites were not run locally; `ci-gate` on the pushed head decides them
  (PP-113).

