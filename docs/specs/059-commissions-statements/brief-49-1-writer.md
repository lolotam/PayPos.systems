# 49-1 — remaining initial writer stage

Continue the same initial MiniMax implementation, in the task's current worktree. Contracts, private DB storage
are accepted locally; plan-49-1.md records the lead's executed receipts. The final CS-Q39 decision keeps only
FOLLOW_PLAN, ZERO, PCT and FIXED; previous fifth-kind implementation and proofs are superseded.
Implement the writer and its database proofs next. HTTP/query wiring remains the subsequent bounded stage of the
same 49-1 delivery and eventual PR. The manager released the lane at 16:06 Kuwait on 2026-11-01; the lead must
complete the final four-kind correction, generation and validation before publishing. The implementer does not publish.

## Required reading

Read AGENTS.md and its governing documents, docs/agent-delivery-pipeline.md, plan-49-1.md sections 2, 5, 6 and 8,
brief-49-1-implementation.md, the existing 48-2 use case/ports/scope/writer/transactions and their tests, the settled
service-overrides contract, the new DB schema and packages/db/test/statement-lock-order.ts.

Read the installed skills before editing:

- C:/Users/waleed_Mohamed/.agents/skills/synced/a49607e8-f54e-4100-93e1-44bf20defa51_62361cb6-49ad-4012-a8bf-6b998ea4eb23/pospay-code-rules/SKILL.md
- The same installed root's pospay-nestjs-module-shape/SKILL.md.
- The same installed root's pospay-kwd-money-and-i18n/SKILL.md.

Those three skill files are the only outside-worktree reading exception. Do not read secrets, .env*, .git or any
other outside-worktree data. The lead verifies the actual git root; the child never runs git.

## Verbatim constraints

> **No arithmetic in a use case.** Totals, tax, discounts, commissions, stock costing, lateness — all of it lives in `domain/` as pure functions with exhaustive unit tests that run with no database.

> **A use case never contains the words `drizzle`, `sql`, `fetch` or `axios`.** CI greps for this.

> **All tenant-data access goes through `withTenant(companyId, tx => …)` which sets `app.company_id` inside the transaction.**

> `Clock` and `IdGenerator` are ports. A use case that calls `Date.now()` or `crypto.randomUUID()` directly is not deterministically testable and will be rejected.

> **Every change the implementer made is read before it is executed.**

File read/edit only. No commands, shell, git, scripts, tests, network, MCP, delegation, commits, publication or server
actions. No schema/migration/contract/engine changes. Preserve existing tests and do not weaken any assertion.

## Exact write scope

Paths below are relative to apps/api/src/modules/commissions unless explicitly rooted elsewhere:

1. domain/errors.ts: add SERVICE_NOT_FOUND to the existing typed error union and update Arabic documentation.
2. ports/business-calendar.port.ts: comments broadened for both writers.
3. ports/employee-row-lock.port.ts: comments broadened for both writers.
4. ports/commission-plan-access.port.ts: comments broadened for both writers.
5. ports/commission-input-lock-scope.port.ts (new shared lock-scope shape, with Arabic method documentation).
6. ports/commission-plan-version-transactions.port.ts (extend the shared lock shape, preserving its public API).
7. ports/commission-service-reader.port.ts (new same-Tx service-existence boundary).
8. ports/commission-service-override-transactions.port.ts (new command, scope and explicit transaction port).
9. use-cases/lock-through-decision.ts (extract the existing lock loop; keep it out of domain).
10. use-cases/create-commission-plan-version/create-commission-plan-version.usecase.ts (use the extracted loop).
11. use-cases/create-commission-service-override/create-commission-service-override.usecase.ts (new).
12. persistence/commission-input-lock-scope.ts (share the concrete lock/calendar/access/reopen construction).
13. persistence/commission-plan-version-scope.ts (reuse that construction; keep version-specific work here).
14. persistence/commission-service-override-scope.ts (new).
15. persistence/commission-service-override-writer.ts (new insert/RETURNING and audit).
16. persistence/drizzle-commission-service-override-transactions.ts (new explicit transaction/idempotency wrapper).
17. __tests__/commission-service-overrides.fixture.ts (new).
18. __tests__/commission-service-override-create.spec.ts (new).
19. __tests__/commission-service-override-periods.spec.ts (new).
20. __tests__/commission-service-override-lock.spec.ts (new).
21. __tests__/commission-service-override-replay.spec.ts (new).
22. apps/api/test/harness.ts: add only the test-root export of catalog.readSessionServices needed to bind the port.

If another path is essential, report it before editing it. No app.ts, module registration, HTTP, query, staff reader,
module-map or ADR changes in this stage. Those belong to the next stage after this writer is verified.

## Write behavior and ownership

Keep withTenant and runIdempotent explicit for each writer, with a distinct operation name for overrides. Reuse the
existing actor fields and access/feature reader. Do not introduce a generic transaction framework or a port over
pure functions. The common scope holds only lockEmployee/calendar/lockPeriods/reopenReviewed/recheckAccess;
version allocation, rule insertion and each audit remain with their own writer.

The extracted loop must preserve the 48-2 behavior and injected time samples. Accept effectiveFrom/wholePeriod and
calendar data rather than an override cast as a plan command. Overrides always use wholePeriod=false. Reuse
domain/plan-periods.ts without duplicating its date or period rules. If its logic needs a change, report the need;
its functions and tests are outside this bounded scope.

Order inside one tenant transaction:

1. Access and commissions-feature recheck before runIdempotent, including saved replays.
2. In fresh work, lock the active employee in the same business; otherwise EMPLOYEE_NOT_FOUND.
3. Check service existence in the same business through the new consuming-module-owned service port.
4. Read calendar; reject ordinary past effective_from before lockPeriods creates any statement.
5. Lock months ascending; re-sample Clock after waits, acquire every newly reached month and perform final date/
   status validation. No whole_period or repair behavior is added.
6. Refuse APPROVED/PAID; reopen affected REVIEWED to DRAFT and clear every review-evidence field.
7. Recheck access/feature under the existing reader's locks; insert with injected IdGenerator and decision time.
8. Append audit action commission_override.created, entity commission_service_override, without salary/customer
   data. Row, review invalidation, audit and idempotent response commit or roll back together.

Production reader binding at app.ts comes later. The scope receives a root callback that answers service existence
on its supplied Tx. The test root binds it to readSessionServices(tx, companyId, businessId, [serviceId]); use the
returned array's existence only. Do not import catalog inside commissions or use its live rule to price history.

The accepted contract's PCT is {kind:'PCT', value:number} in bps, and FIXED is {kind:'FIXED', value:string} in KWD.
Do not invent bps/amount property names or coerce FIXED money through number. Map the four rule shapes to their
existing storage columns; parse the RETURNING shape using commissionServiceOverride. created_at is supplied
explicitly and the returned response retains the existing millisecond timestamp convention. No new outbox event.

## Proof authored in this stage

Use real cloned Postgres databases and the established commission-plan fixture/helpers where they fit. The lead
runs them on this task's private lane. Do not alter existing 48-2 assertions to accommodate the extraction.

- CM-11's writer proof: create PCT 1500, read the saved row from the DB, feed the saved rule to computePeriod on
  net 20.000 KWD with a 50% performer share (netShare=10000n, shareBps=5000n). Expect 1500n mills / 1.500 KWD,
  with a distinct saved snapshot and plan. Assert one saved override and its audit. HTTP proof comes next.
- Persist and round-trip all four rules. No override must still mean saved
  snapshot, not ZERO. The accepted engine tests already prove rule selection; do not clone that suite here.
- Missing/deleted employee, missing service, or wrong business/tenant; no row, audit or idempotent success survives
  refusal. Services currently have no deleted_at or active flag; do not invent one.
- Ordinary past and year-one dates refuse before creating statements; future dates save without unnecessary
  statement creation. Closed months refuse. REVIEWED reopens and clears all evidence; forced insert/audit failure
  rolls that change back with the row and idempotency claim.
- Lock-before-first-write gate on the new override path, an approval race, and day/month rollover while waiting.
  Prove the decision uses the new time and all required locks before writing; old plan tests supplement this proof.
- Access/feature denied before replay and before insertion. The existing identity reader locks company/membership
  rows on the first check: do not build a test that waits for a concurrent revocation blocked by that same writer.
  A boundary-controlled access decision can prove the final recheck and rollback; fresh replay after a committed
  revocation must use the real reader and refuse. Keep the same-Tx invariant and distinguish these proofs honestly.
- Same body replays once; changed body gives IdempotencyKeyReusedError; busy gives IdempotencyKeyBusyError; concurrent
  duplicate requests commit one row/audit (the contender may receive busy rather than success); a failed fresh
  attempt permits a later valid retry.

The direct writer tests do not invent HTTP statuses. Reuse existing DB typed errors; their 422/409 mapping and
uniform access refusals are exercised when the next stage wires HTTP. No new generic error hierarchy is needed.

## Delivery

Return exact changed paths, the actual proofs authored and unresolved concerns. Explicitly state nothing executed.
Do not commit. Stop after this scope so the lead can read and run the gates before HTTP/query work starts.
