# Plan 33b — stop / resume selling a package type

Spec 058 row 33b (§2 line 44, §5 FR-001…FR-003, FR-018b, TD-10, ST-01…ST-04), spec 037 FR-011a, issues #1028 and
#941. Authority: PP-190 (Waleed lifted the 33b HOLD, 2026-11-14), PP-16.1 (PK-Q12, guard
`manage:package-types:business`), PP-100.1 (TD-10 amendment: 33b adds `selling_stopped_at` to the
`CatalogReaderPort` package-type read in the PR that adds the column).

Reused, not rewritten: `apps/api/src/modules/catalog/domain/package-type-selling.ts` (`planPackageTypeSelling`,
33b-a, #814) already holds the transition and the no-op rule (stale revision first, then `unchanged`, then
`change` with revision +1). 33b-2 only maps its `unchanged` decision to the 409 error.

Not in 33b: the sale picker filter `selling_stopped_at IS NULL` (FR-072) is 42-4's query, so 33b adds no index.
The API no longer sells (PP-170): the stopped-type refusal lives only in the worker sale (plan-42-3b1 lines 75–78).

## Split

Three PRs, in this order. The worker refusal ships in 33b-1, before the stop route (33b-2) exists.

### 33b-1 — migration, read path, worker refusal, audit records

1. **Migration** (`pnpm db:generate package-type-selling-stopped-at`, on a private lane; generate and push only after
   the manager confirms the migration lane):
   - `packages/db/schema/catalog.ts`: `selling_stopped_at timestamp with time zone NULL` on `package_types`, with a
     one-line Arabic comment (the stop time is the state; `NULL` = active).
   - Generated SQL `ALTER TABLE package_types ADD COLUMN selling_stopped_at timestamptz` (nullable, no default, so no
     rewrite and no backfill), plus a hand-appended
     `GRANT UPDATE (selling_stopped_at) ON package_types TO pospay_app;`. Expand only; no index (no query filters on
     it in 33b).
   - `packages/db/src/__tests__/rls-catalog-package-types.spec.ts`: `pospay_app` can update `selling_stopped_at` in its
     tenant; the cross-tenant update touches 0 rows; the column-grant list now includes it. The tenant-table inventory
     is checked for a column list and updated if it has one.
2. **Contract read field** (`packages/contracts/src/catalog/package-type.ts`): `selling_stopped_at: timestamp.nullable()`
   on `packageTypeDetail`; `packageTypeListItem` inherits it (it is derived from the detail). OpenAPI regenerated
   (`pnpm contracts:openapi`).
3. **API read path** (catalog): `PackageTypeRecord` gains `selling_stopped_at` (`domain/package-type.ts`: record, view,
   snapshot, with the doc comments updated); `load`'s `SELECT … FOR UPDATE` reads it; `insert` writes nothing new (a new
   type is active); `save` (type edit) never touches it, so a stopped type stays stopped while edited (PT-Q4, FR-003);
   the list and detail queries project it.
4. **TD-10 amendment**: `SalePackageType` (`packages/domain/src/packages/package-sale-types.ts`) gains
   `selling_stopped_at: string | null`; its doc comment drops the «بلا selling_stopped_at» note. Every constructor sets
   it: the API `catalog/persistence/package-type-sale.reader.ts` and `orders/persistence/catalog-reader.adapter.ts`,
   the worker `catalog/persistence/package-type-sale.reader.ts` (selected in the same `FOR SHARE` statement, so it is
   read after the lock) and the worker `orders/persistence/package-sale.scope.ts` `lockSaleType`, and test fixtures.
   `docs/module-map.md` line 111 changes «`selling_stopped_at` joins in 33b» to state it is read.
5. **Worker refusal (#1028)**: `apps/worker/src/modules/orders/domain/package-sale-errors.ts` adds
   `PACKAGE_TYPE_NOT_SELLABLE` to `PackageSaleErrorCode`; `package-sale-rules.ts` `assertPackageSaleQuote` refuses a
   type with `selling_stopped_at !== null` with `PACKAGE_TYPE_NOT_SELLABLE` **before** the revision compare (FR-018b
   order), doc comment updated. The API already maps the code to 422 and i18n has the ar/en text.
6. **Tests**:
   - worker domain unit (`package-sale-rules.spec.ts`): a stopped type with a matching revision → `NOT_SELLABLE`; a
     stopped type with a stale revision → `NOT_SELLABLE`, not `REVISION_CONFLICT`; an active type unchanged.
   - worker integration (#941 item 3, #1028): a request accepted while the type is active; then, by SQL as the test
     owner, `selling_stopped_at = now()` and `revision = revision + 1`; the job runs → the request is `failed` with
     `PACKAGE_TYPE_NOT_SELLABLE` (not `PACKAGE_TYPE_REVISION_CONFLICT`), and no entitlement, component, slot, audit or
     outbox row is written.
   - API: list/detail query result-shape tests carry `selling_stopped_at`; the `CatalogReaderPort` reader test reads it.
   - admin fixtures that build a `PackageTypeDetail`/`PackageTypeListItem` get `selling_stopped_at: null` (full
     `pnpm typecheck` must pass).
7. **Audit records** (mine): PP-190 (33b HOLD card) and PP-189 (45-UI-Q1…Q3) in `docs/owner-decisions.ar.md` and
   the 058 `owner-questions.ar.md`, verbatim, 2026-11-14, «كارت في شات المدير».

### 33b-2 — use cases and routes (adds the stop route; carries the #941 rollout notes)

1. **Error code** `PACKAGE_TYPE_SELLING_UNCHANGED` (new): `PackageTypeError` union (`catalog/domain/errors.ts`),
   409 in the status map and the code list of `apps/api/src/shared/errors.ts`, ar/en in
   `packages/i18n/src/catalog-package-types.ts`, the contracts error list if one exists.
2. **Domain no-op rule**: a small catalog domain function maps `planPackageTypeSelling`'s decision to an outcome:
   `revision-conflict` → `PACKAGE_TYPE_REVISION_CONFLICT`, `unchanged` → `PACKAGE_TYPE_SELLING_UNCHANGED`, `change` →
   the new state; Arabic JSDoc and unit tests.
3. **Contract**: `stopPackageTypeSellingInput` = `resumePackageTypeSellingInput` = `{ expected_revision }` (strict);
   OpenAPI paths `POST …/package-types/{packageTypeId}/stop-selling` and `/resume-selling`, 200 `PackageTypeDetail`,
   errors 404/409/403.
4. **Port** (`ports/package-type-transactions.port.ts`): `saveSelling(before, after, at)` updates only
   `selling_stopped_at`, `revision` and `updated_at` with `AND revision = before.revision` (never `save`, which
   deletes and reinserts components), and an audit entry with `action` `selling_stopped` / `selling_resumed`,
   before/after `{ selling_stopped_at, revision }`. Arabic JSDoc on each method. No outbox event (FR-002, spec 037
   TD-3). `updated_at` is set to the decision time, as `planServiceClose` does.
5. **Use cases** `use-cases/stop-selling-package-type/` and `use-cases/resume-selling-package-type/`: one transaction —
   `load` (`FOR UPDATE`), 404 when absent, `planPackageTypeSelling(current, expected_revision, desired, clock.now())`,
   the no-op rule, `saveSelling`, audit, return the detail view. `Clock` injected; no arithmetic, no SQL.
6. **Routes** in `http/package-types.controller.ts`: `@Require('manage:package-types:business')`, the `catalog`
   feature, the existing device/business guards, Zod pipe on the body; module wiring.
7. **Tests** (integration, T2 compose Postgres, one cloned DB per file):
   - ST-01: stop → `selling_stopped_at` set, revision +1, one audit `package_type.selling_stopped`; resume clears it,
     `package_type.selling_resumed`; stop a stopped / resume an active → 409 `PACKAGE_TYPE_SELLING_UNCHANGED`, no
     write, revision kept; stale revision → 409 `PACKAGE_TYPE_REVISION_CONFLICT`.
   - ST-02: list and detail carry `selling_stopped_at`.
   - ST-03: a stopped type stays editable (PUT works, stays stopped); sold entitlements untouched.
   - ST-03b: two real connections — one holds the type `FOR SHARE` through the catalog sale reader; the stop waits
     and commits only after it; the stop never commits between the read and the commit of the holder.
   - ST-04: no permission → 403, `catalog` off → `FEATURE_DISABLED`, unknown/foreign type → 404, nothing written.
   - Unit: the no-op rule mapping.

### 33b-3 — admin list toggle and badge

`apps/admin/src/catalog`: `api/use-package-types.ts` gains stop/resume mutations (generated client, `expected_revision`,
invalidates list and detail); `ui/package-type-table-row.tsx` shows a «متوقف البيع / Not on sale» badge when
`selling_stopped_at` is set and a stop/resume button only for holders of `manage:package-types:business`; the 409
codes show their i18n message; i18n keys ar/en (logical CSS only). Component tests assert what the user sees: the
badge, the button label switching, the button hidden without the permission, the disabled state while pending, the
error message on 409 (PP-7.2).

## Rollout (#941) — worker first, rollback floor

1. 33b-1 merges and deploys first. The staging receipt shows the worker `/ready` and its image SHA at the 33b-1 merge
   SHA or later (the SHA that contains the `PACKAGE_TYPE_NOT_SELLABLE` check).
2. 33b-2 (the stop route) does not merge until that receipt exists. Its PR body carries these notes.
3. **Rollback floor = the 33b-1 merge SHA for the worker.** Once any type is stopped, a worker below that SHA would
   sell a stopped type. A rollback of the worker below the floor first disables the stop route (rolls the API back
   below 33b-2) and resumes every stopped type, or is refused.
4. The migration is expand-only (nullable column, column grant); rolling the code back below 33b-1 leaves the column
   unused and harmless.
5. Production stays Waleed's decision.

## Sizes (estimated lines added/changed; the 2× refusal yardstick per dispatch)

| PR | Production | Tests | Migration + schema | Docs |
|---|---|---|---|---|
| 33b-1 | ~45 (contracts 2, API domain/queries/readers ~25, packages/domain 2, worker ~12, module-map 1) + generated OpenAPI | ~140 (worker unit 25, worker integration 60, API query/reader 25, db grant/RLS 30) + fixture churn ~15 across ~8 admin/API spec files | ~10 SQL + schema 2 (+ generated meta snapshot/journal) | ~190 (this plan ~130, PP-189/190 audit ~60, mine) |
| 33b-2 | ~240 (error code + i18n 10, domain rule 25, contract + OpenAPI 40, port 25, persistence 40, two use cases 70, controller + wiring 30) | ~300 (ST-01…ST-04 + ST-03b integration ~260, unit ~40) | — | PR body rollout notes |
| 33b-3 | ~100 (hooks 40, row badge/toggle 45, i18n 15) | ~130 (component tests) | — | — |

## Lanes (PP-186, PP-175.2, PP-112)

Production code: Kimi CLI `k3.1-pro`, then `grok-4.7-build-fast`, then `MiniMax-M3.1-Flash`. Tests and the migration:
Agy `gemini-3.8-flash-high`, else Kimi. Every run is fenced (`.env*` stashed out, HEAD / stash list / porcelain
snapshots before and after; briefs ban git, network, `.env*`, `.git`, files outside the worktree, `F:\Dev\Temp`,
reformatting and line-squashing). Claude writes only this plan and the audit records, reviews every diff, runs
`clean-code-guard` / `test-guard` and the local gates (full `pnpm typecheck`, lint, `pnpm lint:docs`,
`pnpm module-map:check`, the slice's own tests).
