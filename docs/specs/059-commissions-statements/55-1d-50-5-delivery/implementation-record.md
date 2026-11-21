# Implementation record — 55-1d and 50-5

Base `aa1c79569a371c101400d2c895d17351694833c9` (PR #1162, 42-4 + 46-2a-S). Provider: OpenCode
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
`idx 239`. The numbers `0237` and `0238` belong to PR #1171, so the local `migration-chain:check`
reports the gap `entries[235].idx: expected 237, actual 239` until that PR is merged and this branch
is rebased on it. The order to apply is: merge PR #1171 first, then rebase this branch; the numbering
stays valid as it is.
