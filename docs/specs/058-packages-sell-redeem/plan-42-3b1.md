# Plan 42-3b1 — worker package sale and pending-sale storage (PP-170)

Spec: [spec.md](spec.md) FR-010, FR-011, FR-013, FR-016…FR-018c, SA-01…SA-05b, SA-07…SA-10. Decision: PP-170
(Waleed, 2026-11-11, «Sale as background job (Recommended)», [owner-questions.ar.md](owner-questions.ar.md)
42-3b-PERF-1). Architecture: ADR-0034 addendum 2026-11-11 and ADR-0010 addendum 2026-11-11. The manager's split
stands: 42-3b1 is the worker job and the pending-sale state; 42-3b2 is the HTTP 202 route, the status route and the
acceptance use case, after 42-3b1 merges.

## 1. What 42-3b1 delivers

A seeded `pending` `package_sale_requests` row plus a `PackageSaleRequested` outbox event ends, through the orders
worker, as exactly one of:

- `completed`: one entitlement, its components and slots (one multi-row insert per table), the `package.sold` audit
  entry and `PackageSaleChanged`, all in one transaction with the status change;
- `failed`: a named refusal code and details (SA-04, SA-05, SA-05b, SA-07, SA-08, SA-08b, SA-08c), or
  `PACKAGE_SALE_FAILED` after the last attempt or from the recovery sweep. Nothing else is written.

No route, acceptance use case, contract or OpenAPI path ships in 42-3b1; nothing in production can create a request
until 42-3b2. The obsolete synchronous API code on this branch (`sell-package` use case, its port, transactions,
writes, access and place adapters, the `service-session-access` and `identity/index.ts` additions, their tests and
module-map rows) is not part of this PR. It stays reachable from the local commits `e7e95913`, `c369e00a7` and this
branch's history; 42-3b2 takes the acceptance pieces from there. The diagnostic tooling (`scripts/test-db/load-*.mjs`,
`scripts/test-db/fixtures/42-3b1-docker-stats.raw`, `package-sale.diagnostic.ts`, `package-sale-profile.fixture.ts`,
the two `vitest.package-sale-*.config.ts`) is dropped from the tree for the same reason. A pushed backup branch for
those commits is the manager's call (see §8).

Receipts: the four the spec and the owner question cite stay (`42-3b1-sa10-receipt.md`,
`42-3b1-performance-diagnosis.md`, `42-3b1-index-experiment.md`, `42-3b1-authorized-statistics-receipt.md`); their
links to dropped receipts become plain mentions of the commit that holds them. `42-3b1-scope.md`,
`42-3b1-next-diagnostic-plan.md`, `42-3b1-load-capture-repair.md`, `42-3b1-statistics-stop-receipt.md` and
`42-3b-dependency-refresh.md` describe the superseded synchronous plan and are dropped. (Their "42-3b1" prefix is the
old diagnostic slice name, not this plan.)

## 2. Order of work (CLAUDE.md §1 step 3)

No contract change (the event is id-only and internal; the HTTP contract is 42-3b2's).

### 2.1 Migration and schema — Agy

- `packages/db/schema/orders-package-sales.ts` (new): `package_sale_requests` as spec "Sale requests": PK
  `(company_id, id)`; composite FKs to business, branch, recorder user/membership (as `package_entitlements`) and
  entitlement (`ON DELETE RESTRICT`); **no FK** on `customer_id`, `package_type_id`, `seller_employee_id` (an unknown or
  foreign id is a worker refusal, SA-05/SA-08; debate #1); `price_paid numeric(14,3)`;
  `expected_service_revisions jsonb` with a CHECK on array shape and at most 20 elements; `error_details jsonb` with a
  size CHECK; `status` CHECK `pending|completed|failed`; one state-shape CHECK (pending: `entitlement_id`, `error_code`,
  `error_details`, `finished_at` all null; completed: `entitlement_id` and `finished_at` set, error fields null; failed:
  `error_code` and `finished_at` set, `entitlement_id` null; debate #7); `discount_limit_bps` CHECK 0…10000 or NULL.
- Migration draft (unnumbered until the manager grants the lane): table, RLS `ENABLE` + `FORCE` on
  `company_id = app_company_id()`, grants to `pospay_app` (`SELECT`, `INSERT`, column `UPDATE` on `status`,
  `entitlement_id`, `error_code`, `error_details`, `finished_at`), the `BEFORE INSERT OR UPDATE` guard
  trigger (an insert must be `pending`; only `pending → completed` / `pending → failed`; 23514 otherwise; debate #6), indexes on every FK, the RLS predicate and
  `(company_id, recorded_by, id)` for the creator's status read, and `(company_id, status, recorded_at)` for the
  recovery sweep. The renumber, `db:generate` and push are not run (manager's migration lane).
- Tests (Agy, `packages/db/src/__tests__/`): RLS negative (cross-tenant read 0 rows, insert/update refused), trigger
  matrix under `pospay_app` (insert as completed/failed refused; each legal transition; completed→failed,
  failed→pending, pending→pending with changes, any change on a finished row refused with 23514), every invalid
  state-shape combination refused, grant check (no `DELETE`, no update of body columns), FK refusals for another
  business's branch and another company's recorder; an unknown customer/type/seller id is accepted by the table.

### 2.2 Domain — Kimi (moves) + Agy (tests)

- `git mv` `apps/api/src/modules/orders/domain/package-sale-{plan,pricing,rules,audit}.ts` →
  `apps/worker/src/modules/orders/domain/`, and their specs, `package-sale-identities.spec.ts` and
  `fixtures/package-sale.ts` → `apps/worker/src/modules/orders/domain/__tests__/`. `PackageSaleError`,
  `PackageSalePricingError`, `PackageSaleIdentityInvariantError` and their code types move from the API `errors.ts`
  into a new worker `orders/domain/package-sale-errors.ts` (their only users move with them). `package-sale-types.ts`
  moves to `packages/domain/src/packages/` with the service shape it needs, and the API file becomes a re-export
  because the API `ports/session-readers.port.ts` still imports `SalePackageType` (debate #2). `SessionEmployee` is
  replaced in the moved files by a worker-local seller fact type. Imports are rewritten to `@pospay/domain` and
  worker-local paths; rule bodies do not change (diffed line by line in review). API and worker typecheck must pass
  on 42-3b1a alone.
- The stopped-type refusal (`PACKAGE_TYPE_NOT_SELLABLE` under the type lock, before the revision check) is not in
  42-3b1: `selling_stopped_at` does not exist until 33b (PP-100.1), exactly as for the merged 42-3a domain (debate #3). `package-sale-response.ts` exists only on this branch and
  is dropped; 42-3b2's status query projects the entitlement.
- `packages/domain/src/packages/package-expiry.ts` (moved from the API by `git mv`; the API file becomes a re-export
  shim used by `package-refund-plan.ts`), `packages/domain/src/money/…effectiveDiscountBps` beside the discount money
  helpers (the API `session-pricing.ts` re-exports it), and `packages/domain/src/packages/package-sale-time.ts`: the
  pure sale-time window with a kernel-owned `PackageRuleError` code; the API `sessionTime` keeps its signature and maps
  the kernel error to `SessionError`. Arabic JSDoc on every export (§3.1).
- Unit tests: moved specs pass unchanged except imports; new kernel specs for the time window (boundaries of the
  previous-month floor, the 120 s future allowance, timezone day change).

### 2.3 Worker — Kimi

- `ports/package-sale.port.ts`: `PackageSaleTransactions` (`run(companyId, requestId, work)`, `fail(companyId,
  requestId, code, details)`), the scope (`request`, `lockType`, `lockServices`, `lockSeller`, readers, `insert`,
  `audit`, `emit`, `complete`), `PackageSaleClock`, ids. Arabic JSDoc per method.
- `use-cases/execute-package-sale/execute-package-sale.ts`: the 47-2b shape — run the sale; a `PackageSaleError`,
  `PackageSalePricingError` or `PackageRuleError` → rollback, then `fail` with that code; anything else →
  `PackageSaleRetryError`. No arithmetic or SQL; time from `request.recorded_at`.
- `persistence/package-sale.transactions.ts`: `withTenant(companyId, …, { userId: recorder, timeoutMs })` with an
  explicit budget (no default, as 47-2b); loads the request `FOR UPDATE` only while `pending`; maps SQL errors;
  `fail` and `complete` are conditional on `status = 'pending'`.
- `persistence/package-sale.writes.ts`: entitlement insert, components multi-row insert, slots via one
  `jsonb_to_recordset` statement (the writer measured in 42-3b1's receipts), money as decimal strings.
- `jobs/package-sale.processor.ts` (from `package-preview.processor.ts`): BullMQ queue `package-sale`,
  `jobId = event.id`, 3 attempts, exponential backoff, last-attempt unknown failure → `fail(PACKAGE_SALE_FAILED)`;
  readiness and close wired in `orders.module.ts` (add-only), `PackageSaleRequested` in that module's `eventTypes`;
  `apps/worker/src/main.ts` (add-only) starts the processor and the recovery, supplies clock, ids and the measured
  transaction budget from config, and includes both in readiness and shutdown (debate #4).
- Recovery sweep (from staff `employee-import-recovery`): `jobs/package-sale-recovery.processor.ts`,
  `use-cases/recover-package-sales/`, `persistence/package-sale-recovery.transactions.ts`; per-company per-minute,
  registered before a delivery is acknowledged; at most 50 requests aged ≥ 10 minutes; conditional
  `pending → failed (PACKAGE_SALE_FAILED)`; no re-enqueue.
- `events/published.ts`: `PackageSaleRequested` payload type with Arabic JSDoc (worker side; the API declaration is
  42-3b2's).
- Readers behind each worker module's `index.ts` (new files, add-only exports): `catalog/persistence/
  package-type-sale.reader.ts` (type + components, `FOR SHARE`) and `session-services-lock.reader.ts` (ascending
  `FOR SHARE`, revisions and prices); `staff/persistence/package-seller.reader.ts` (eligibility facts and the
  `PerformerCheckPort.lock` equivalent, including the recorder-link self rule); `customers/persistence/
  package-sale-customer.reader.ts`; `tenancy/persistence/package-sale-place.reader.ts` (branch timezone, business).
  Each copies the API reader's SQL exactly (diffed in review).
- `docs/module-map.md` §3 and `module-map.yaml`: worker `orders` → `catalog`, `staff`, `customers`, `tenancy` read rows
  for these readers (add-only).

### 2.4 Integration tests — Agy (private lane Postgres, worker harness)

Fixture seeds a company with السالمية, منى (recorder), هبة (seller), a 10-session type and a 20 × 365 type, and inserts
`pending` requests directly (no API).

- SA-01, SA-02, SA-03 completed outcomes with exact rows, audit, `PackageSaleChanged` payload and `completed` status.
- SA-04 limit frozen on the request (10% limit → failed `PACKAGE_SALE_DISCOUNT_ABOVE_LIMIT`; NULL limit sells at 0.000).
- SA-05 seller ineligible / self → failed codes; SA-05b two real connections (detach first / sale first).
- SA-07 time window from `recorded_at`; SA-08 unknown customer/type, validator failure; SA-08b type edit race and
  stop race; SA-08c service price race — each with nothing written.
- SA-09 repeated delivery of a completed and of a failed request writes nothing; duplicate job id dropped; two real
  connections execute the same pending request at once → one entitlement, one audit entry, one event; a commit whose
  acknowledgement is lost (the job throws after COMMIT) is retried, finds `completed` and is never failed (debate #8).
- Frozen context: after acceptance the recorder loses `sell:packages:branch`, the limit changes and the injected clock
  crosses a month boundary; the worker still sells under the frozen limit, without re-authorizing, with `sold_at`,
  window and expiry judged from `recorded_at` (debate #9).
- SA-09b last-attempt unknown failure → `PACKAGE_SALE_FAILED`; failure-marking failure retried; sweep closes a request
  older than 10 minutes, ignores a younger one, and waits for an in-flight sale then matches nothing.
- RLS: a request of another company is invisible to the worker scope.
- SA-10 execution: 20 × 365, one warmup + five measured complete executions (COMMIT included) recorded in a receipt
  with environment; asserts exactly one insert statement per financial table; no fixed millisecond assertion beyond
  the job's transaction budget (PP-165 does not apply; §6's 200 ms does not apply to the worker path per PP-170).
- Processor specs: retry vs permanent failure, last-attempt finalization, readiness/close; one delivery through the
  composed worker (`main.ts` wiring).

## 3. Size estimate (PP-112 cap 2,800 changed lines, generated files excluded)

| Part | Production | Tests | Docs | Total |
|---|---:|---:|---:|---:|
| Spec, ADR addenda, plan, kept receipts (on this branch, not on main) | — | — | ~900 | ~900 |
| Migration draft + schema | ~260 | ~300 | — | ~560 |
| Domain moves (renames ~100% similar; import edits) + kernel leaves | ~160 | ~150 | — | ~310 |
| Worker job, use case, port, transactions, writes, processor, wiring | ~650 | ~1,150 | — | ~1,800 |
| Worker readers + module-map | ~230 | (in SA tests) | ~10 | ~240 |
| Recovery sweep | ~110 | ~180 | — | ~290 |
| SA-10 execution benchmark + receipt | — | ~150 | ~60 | ~210 |
| Debate record | — | — | ~45 | ~45 |
| **Total** | ~1,410 | ~1,930 | ~1,015 | **~4,355** |

That is above 2,800, so 42-3b1 cannot be one PR. Proposed split (manager's decision before any dispatch):

- **42-3b1a** — spec/ADR/plan/receipts, migration + schema + negative/trigger/grant tests, domain moves and kernel
  leaves with their unit tests, debate record. ≈ 1,815. Merges first; it also closes the docs part of the #920 review comment.
- **42-3b1b** — worker port, use case, transactions, writes, processor, readers, module-map rows, event type,
  integration SA tests, SA-10 benchmark. ≈ 2,250.
- **42-3b1c** — recovery sweep and its tests (≈ 290), only if 42-3b1b measures over 2,800; otherwise it rides in
  42-3b1b.

42-3b2 is gated on **deployment**, not merge: a staging-deployed worker SHA that contains execution and recovery, with
the `package-sale` processor in the worker's `/ready`, recorded in 42-3b2's PR. That SHA is the worker rollback floor
while 42-3b2 is live (debate #5, ADR-0034 addendum 2026-11-11).

## 4. Fences and lanes

PP-168 fences around every Kimi and Agy run (snapshots, env-stash, brief limits, post-run comparison). Agy writes the
named test and migration files only and runs nothing; never `--dangerously-skip-permissions`. Kimi writes the
production files and the `git mv` list is executed by this session before Kimi runs (Kimi runs no git). One
implementer at a time. Max 3 correction rounds. A delivery larger than 2× its estimate is refused.

## 5. Gates

Local: typecheck, lint, `pnpm lint:docs`, boundaries, `pnpm module-map:check`, the slice's unit and integration tests
on a private `lane.mjs` cluster (migration draft applied there only). No full API suite, no Playwright. Guards:
clean-code-guard, test-guard, docs-guard. Done only when `ci-gate` is green on the exact head.

## 6. Shared files (add-only)

`apps/worker/src/modules/orders/orders.module.ts`, `apps/worker/src/main.ts`, worker `catalog`/`staff`/`customers`/`tenancy` `index.ts`,
`docs/module-map.md`, `docs/module-map.yaml`. No API `orders.module.ts`, contracts index, `openapi.json` or
`identity/index.ts` change in 42-3b1 (42-4r and the discount-approval session own lines there).

## 7. Risks

- The worker readers copy API SQL; a later API change could drift. Mitigation: each reader cites its API twin in a
  one-line comment and the integration tests assert the same refusals.
- A queue backlog over ten minutes fails valid sales safely (sweep); reception sells again.
- Refusals now arrive by polling, not as an immediate HTTP error at the till. Whether that is a feature question
  (§1 5b) is for the manager to put to Waleed; it does not block 42-3b1, which has no route.

## 8. For the manager

1. Approve the 42-3b1a / 42-3b1b (/ 42-3b1c) split, or another.
2. A pushed backup branch for the local-only commits (`e7e95913`, `c369e00a7` and the diagnostic tooling) before this
   branch is rewritten for 42-3b1a.
3. PP-170 in the `docs/owner-decisions.ar.md` index (owned by #920's lane, so not edited here).
4. Classification of "refusal by polling" (feature vs technical) with Waleed.
