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
