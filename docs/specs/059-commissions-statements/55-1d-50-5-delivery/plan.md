# Delivery plan for 55-1d and 50-5

Implement the [delivery specification](spec.md) as one PR, in the order below. All existing paths and behavior refer to `origin/main` at `68e2f4dafacc72aef364ef4a3d7bbd96bfe42f51`. The planning worktree started at `8c46615f0c893178efbc9b4b963e9d6aff18d8a0`. Base implementation on current main and reconcile ownership before editing shared readers.

## Technical context and dependencies

| Already on baseline | Consequence |
| --- | --- |
| 50-a publishes assembleCommissionPeriodInput and computePeriod in packages/commissions-engine. 50-1/2 project lines, tips and salary. 50-4 at cf70114e2 projects sales and covers retained replay. | Reuse the public engine entry. Its sale filter expects ACTIVE and seller/month. Retain the projection’s raw status, price and cumulative refund contract. No orders joins or replay redesign. |
| 55-1b implements lock/target, generation, source union, delta and frozen attribution. 55-1c at e6e038f70 and its concurrency regression at 804795925 cover tips/salary. Sale corrections are still explicitly refused by ProjectPackageSale. | Replace the closed-sale refusal; preserve existing service, tip and salary callers. The existing readMonthProjection returns an empty sales array, so changing the refusal alone would calculate incorrect deltas. |
| 55-2 has block recording and notices. 55-2e at 68e2f4daf exposes the management list under manage:commission-plans:business (CS-Q48). | Reuse the existing outcome on a blocked sale. The list is neither the estimate guard nor a dependency on the repair endpoint. Check 55-2f shared-code relocation (CS-Q46/PP-205.1) at rebase; follow landed paths or coordinate overlapping edits without pulling repair implementation into this PR. |
| Spec 059 row 51-1 and PP-192 assign carries, fingerprints, generate/statement GET and review permission downstream. 56-1c consumes the effective-scope reader. | 55-1d precedes 50-5 inside this PR. Seed closed fixtures under FR-044; neither approval nor a running repair endpoint is needed to test them. 51-1 depends separately on completion of 55-2. Leave an explicit extension point for incoming carries in 51-1; no synthetic ledger or zero-valued carry rows. |

## File boundaries and acceptance checkpoints

### 1. Worker correction and sales input

Under `apps/worker/src/modules/commissions/`, extend `use-cases/project-package-sale/project-package-sale.ts`, its sale projection port/scope and handler wiring to participate in the existing correction transaction. Acquire sale identity before reading held revision. Compare revisions before any generation or bell. Build deduplicated old/new seller-period pairs. Lock the union of source/candidate periods once in ascending order. Retain the business-timezone rollover check. Select targets from locked statuses, upsert once, run the shared correction/block path against updated inputs and preserve D-5 order.

Extend `persistence/commission-correction-month-readers.ts` and the month projection type with typed tenant/business/seller/month sale reads. In `use-cases/commission-month-recompute.ts` associate the priced sale ref with its branch and date for first attribution. Reuse `use-cases/post-commission-corrections/post-commission-corrections.ts`, existing transaction-bound notices and existing insert-only constraints. No new table, event type or index assumed for this item.

Prove seeded APPROVED and PAID sources, late first sale, partial then full refund (percentage and prorated fixed), free/disabled, duplicate/stale and out-of-order revisions, moved seller/month, REVIEWED skip and reopening, frozen versus edited attachment, missing-plan/salary block and one bell. Inject a crash between projection and correction, then retry. Exercise racing revisions and concurrent target status transitions under actual locks. Assert final rows, exact delta/generation, mark and notices; compare unchanged frozen rows.

### 2. Estimate use case and read adapters

Under `apps/api/src/modules/commissions/` add `use-cases/get-commission-estimate/`, reader-only ports, persistence adapters and a pure result assembler for scope projection/subtotals. Read candidate employees, dated attachments and received-correction-only candidates. Fetch full inputs by company/business/period for eligible employees, preferably in sets, with exact source attribution for incoming corrections. Share projection decoding through an allowed public boundary where appropriate; API code must not import worker internals. Do not move SQL into the pure engine. Price once, pass tips/corrections unchanged, then intersect visible rows and sum the visible figures. Keep names/details for hidden sources outside the response. Bind staff and catalog readers through composition per D-16.

Extend `packages/db/src/with-tenant.ts` and its existing options type with optional readOnly. Select PostgreSQL READ ONLY at transaction start in both timed and untimed paths. Use a consistent read snapshot for multi-query assembly, scope and attachments. Preserve user/company context, RLS role checks, deadlines and default writer behavior. Reuse the request transaction where present. Prove SQL-level write refusal, reader-only constructor surface, no nested transactions and unchanged database state after GET, including on a never-generated month (D-25/CM-28b).

Compare output against the public engine with ACTIVE/cancelled lines, sales, versioned rates, overrides, salary thresholds and a cross-branch tier crossing. Include visible zero, both missing-input statuses, cash/card and signed corrections, a correction-only former employee, open current month and repeat reads. Check equal values at the mill boundary; no floating-point conversion or second pricing pass.

### 3. Permission, HTTP and branch disclosure

Add the Zod request/response and OpenAPI registration in `packages/contracts/src/commissions/`, thin controller and module wiring in `apps/api/src/modules/commissions/`. Use typed date/UUID and decimal-string schemas, distinguish missing-price status from an amount, expose partial indication and displayed source branch. Generate the tracked `packages/contracts/openapi/openapi.json` and affected client schemas per existing scripts. GET performs validation, guard and mapping; business arithmetic stays in the engine/domain. No manual generated-file edits.

Register `read:commissions:business` in `packages/db/src/access-catalog.ts` and `role-defaults.ts` and add **one reference-data migration** for the catalog entry plus approved global role grants, using migration 0187 as precedent. Existing tenants need the defaults on migration without reseeding. Leave custom roles, personal overrides and own/management codes intact. Allocate the migration number on the actual integration base. The read option and sales input require no separate schema migration.

Expose effective business/branch scope via identity’s public reader, bound to a commissions-owned port at the root. Return an explicit business-wide indicator plus effective IDs so all-branches-by-union retains its restricted meaning. Staff owns dated attachment reads. Share the decision rules with the existing permission machinery, avoid a guard that rejects branch-only users before checking their grants, and check scope again in the data snapshot when a preflight guard is required.

Run API/DB tests for all five default roles, non-default/custom role, explicit grant/revoke, devices, feature off, expired overrides, cross-membership DENY, empty scope, two tenants, two businesses in one tenant, invalid period/UUID, withheld customer names and targeted employee enumeration. Map estimate-only CM-23b…h to assertions in the same PR. Compare migrated legacy memberships with fresh seed defaults. Check bounded query counts and EXPLAIN of principal projection, correction and attachment lookups on representative fixtures.

## Size and route

Estimated added or materially changed lines for the future PR, counted once under the owning item. Documentation estimates include incremental implementation records; generated diffs depend on the schema generator. These are planning ranges, not a delivery ceiling.

| Work item | Production, including handwritten SQL | Tests/fixtures | Generated | Docs |
| --- | ---: | ---: | ---: | ---: |
| 55-1d worker, reader and attribution | 130–220 | 260–460 | 0 | 10–25 |
| 50-5 estimate, adapters and read-only transaction | 230–365 | 240–420 | 0 | 15–35 |
| 50-5 scoped API, identity/provider wiring and migration | 265–425 | 290–490 | 180–550 | 20–45 |
| **Combined** | **625–1,010** | **790–1,370** | **180–550** | **45–105** |

The decomposition shifts the preliminary production range of 550–950 by +75 at the low end and +60 at the high end. Main uncertainty is reuse of tenant-qualified readers, dated attachment lookup and grant evaluation. The [55-2e delivery evidence](https://github.com/lolotam/PayPos.systems/blob/68e2f4dafacc72aef364ef4a3d7bbd96bfe42f51/docs/specs/059-commissions-statements/plan-55-2.md) measured 493 production lines for its list; counting only a controller would understate this read path. Size alone does not split the PR.

The generated estimate in the table covers the API artifacts. Count the Drizzle migration snapshot and journal separately. The reference-data migration 0187 has its own snapshot, and the current 0235 snapshot is approximately 30,800 lines. With one new snapshot, forecast approximately 31,000–31,400 generated lines in total, subject to the final migration base.

**Approved implementation tier: Heavy** under PP-195 and PP-198. Waleed confirmed on 2026-11-22: «اعتمد Heavy في PR واحد (المقترح). تفضل المراجعة وترتيب الهجرة مطلوبين.» Money posting, permission enforcement and a reference-data migration require the applicable oversight. The manager obtains the independent Heavy design review. Use OpenCode `minimax-coding-plan/MiniMax-M3.1-Flash` with the available default and no explicit variant, as recorded in the spec.

## Independent design acceptance

Astra 6.2 Medium reviewed against `68e2f4dafacc72aef364ef4a3d7bbd96bfe42f51` and cleared local implementation with these requirements:

- Use an explicit `SOLD` to `ACTIVE` conversion when constructing engine inputs in the worker and API. Preserve stored `SOLD`, the original price and cumulative refund in the projection. An isolated PostgreSQL test starts with a real `SOLD` row and frozen commission of `3.000 KWD` and proves deltas of `-1.000`, then `-2.000`, and no change on redelivery.
- Lock source identity before the freshness check and lock affected months in stable order. Prefer the first later DRAFT month, reopen REVIEWED only under the documented rules, deduplicate affected employee/month pairs and keep projection, recompute and consumption atomic. Compute each source delta as `new amount − (frozen amount + sum of prior published deltas)`. Exclude incoming corrections and carries from repricing.
- Use the engine outcome for the estimate. Explicit ZERO/PCT/FIXED or correction-only periods can succeed without a plan. Return a pricing failure separately from known tips and corrections. Use a consistent read-only snapshot for scoped month pricing and filter allowed days and corrections before exposing names or totals. Keep own-read permission in slice 57 and validate global role grants on both migrated and fresh databases.
- Coordinate the migration with pending 0236–0238 at integration. Allocate the final successor from the actual migration journal and snapshot chain. Local implementation and testing do not depend on applying a target migration.

## Validation, gates and measurement

- Future implementer runs affected unit and disposable-DB integration suites, migration-chain and module-map checks, contract regeneration/consumer drift checks and `pnpm check`. Run implementer clean-code-guard, test-guard and waleed-security-reviewer. A different model performs whole-diff code review. Record actual results and commands at the final head.
- Heavy review requires exact-head CI with the current tested base, Codex and four MergePilot reviewers, and consolidated findings and corrections under the applicable round policy. CodeRabbit is optional under PP-208. The manager coordinates merge order and merges under PP-201 after the gates pass. Check the migration lane, database review, independent target migration and deployment authority, and applicable staging snapshot and isolated rollout. Verify whether merge triggers a target operation before merging. Planning supplies none of those operational approvals.
- Record requested vs actual provider, model and exposed variant (default or unavailable), head and base. Timestamp work intervals, first full local green and subsequent corrections. Report active minutes to green and active correction minutes separately; subtract and itemize CI, bot, owner, queue and provider waits. Count retries and provider failures with causes. Record measured production/test/generated/docs additions and deletions by item with moves identified; retain the counting basis. List checks, attempts, outcome and head, deduplicate findings across reviewers/rounds by root cause and severity, disposition and remaining risks. Record reported input/output/cached token counts and cost/currency when exposed, otherwise unavailable.
