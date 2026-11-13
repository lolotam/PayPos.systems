# Plan: 32b-cat-2, closing and reopening categories and single services

Roadmap row 32b, sub-PR `32b-cat-2` of [spec 072](spec.md) (delivery table row «Closing and reopening: categories and
single services», sections «Service categories», «Closing a category», «Reopening a category», «Closing a single
service», «What closed means for selling», «One lock order for every category write», «Category detail read»).
**API only.** The admin screen is `32b-cat-3`.

## Prerequisites (checked on `origin/main` 848080ca8)

- `32b-cat-1` (#721), `32b-cat-1b` (#729), `32b-cat-1p` (#726), `32b-pre-1` (#757), `32b-pre-2` (#771): merged.
- The spec PRs #711, #714, #715 (rules and SI-Q14 to SI-Q24 answers): merged.
- `@RequireAll` and its ADR do **not** exist on main: the spec makes them part of this PR (delivery row, step 1), so
  this is work, not a blocker. `rg RequireAll apps packages` finds nothing.
- No `PENDING` and no `TODO(spec)` that blocks this row. The only `TODO(spec)` in `owner-questions.ar.md` (the import's
  category match key) belongs to `32b-3`.

## Decisions the spec leaves to the plan

| # | Decision | Why |
|---|---|---|
| C-1 | The service closed state is `closed_at` plus `closed_by_category_id` (spec). The domain `ServiceRecord` gains both (`null` by default) and the **audit snapshot** (`serviceSnapshot`) carries both. The **wire response** (`serviceResponse`) carries `closed_at` only and explicitly drops `closed_by_category_id` (it is bookkeeping for the reopen restore), and a test proves no HTTP response carries the marker. | Review finding 7: one function must not feed both the audit and the response. |
| C-2 | `planServiceUpdate` clears `closed_by_category_id` when `category_id` changes (spec «Moving a service to another category clears its marker»). `saveService` writes the marker; `closed_at` stays untouched by update-service. A closed service can still be edited. | The CHECK `closed_by_category_id = category_id` would otherwise fail the update. Nothing in the spec forbids editing a closed service. |
| C-3 | Close or reopen of a category: lock the category `FOR UPDATE`; check `expected_revision` (`SERVICE_CATEGORY_REVISION_CONFLICT`); check the state (`SERVICE_CATEGORY_ALREADY_CLOSED` / `SERVICE_CATEGORY_NOT_CLOSED`); lock the affected service rows `SELECT <full rows> … ORDER BY id FOR NO KEY UPDATE` (a deliberate deviation from the spec's «`FOR UPDATE`», recorded in the spec: a plain `FOR UPDATE` also blocks the `FOR KEY SHARE` that every foreign-key insert into `service_lines`, `discount_proposals`, `commission_service_overrides` and the package tables takes on its service, and would let a writer that inserts for two services out of order deadlock with a large cascade; `FOR NO KEY UPDATE` still conflicts with the order recorder's `FOR SHARE`, which is the exclusion the spec needs, and no key column changes); count them; refuse a different `expected_service_count` with `SERVICE_CATEGORY_COUNT_CHANGED`; then the set-based `UPDATE` and the audit. Close affects `closed_at IS NULL AND category_id = X`; reopen affects `category_id = X AND closed_by_category_id = X`. | Spec lock order: the category is always locked before its services; services in ascending `id`. |
| C-4 | Every service the cascade touches gets `revision = revision + 1`, `updated_at = now`; the category too. Audit: one `service_category` row (`closed` / `reopened`) and one `service` row (`closed` / `reopened`) per service touched, **As built (2026-11-13, SI-T2):** the service audit rows are built inside the cascade statement itself (`INSERT … SELECT` from the updated rows, `persistence/drizzle-service-category-closing.ts`), and `service-category-closing-audit.spec.ts` proves each row equals `serviceSnapshot` field by field; the category row still uses `appendAuditLogs`. The measurement put the synchronous threshold at **300 services** (spec «Sync threshold and the gap above it», PP-187, issue #1012); `service-category-closing-budget.spec.ts` asserts a warm close and reopen of 300 services under 200 ms, and larger categories go to the worker job of `32b-cat-2-worker` ([plan](plan-32b-cat-2-worker.md)). A service already closed keeps its own `closed_at`, gets no marker, and no audit row. | Spec «Every state change advances the revision», the audit rule and «The 200 ms rule». |
| C-5 | The category close and reopen responses are **flat**: the category view plus `services_closed` (close) or `services_reopened` (reopen), reading the spec's «the category with `services_closed`» as an extra field, not a nested object. The detail read returns the category view plus `open_service_count` and `marked_service_count`. | Spec API list; the flat reading keeps one category shape for the screen. Recorded in the spec. |
| C-6 | Single service close: inside one transaction peek the service's `category_id` without a lock, lock that category `FOR SHARE` (only when not null), then load the service `FOR UPDATE`; if the service's `category_id` now differs from the peeked one, **throw `TRANSACTION_RETRY_REQUIRED` and roll back**. The **use case** then starts over in a brand-new transaction (at most 3 attempts, then the error reaches the client). A restart is never done inside the same transaction, because it would lock the new category while still holding the service row, the inverse of the category-then-service order, and could deadlock with a close of that category (review finding 2). Reopen does the same and, when the category is closed, refuses with `SERVICE_CATEGORY_CLOSED`; it clears both columns. A service with no category locks only its own row. `update-service` does not retry (it throws `SERVICE_REVISION_CONFLICT`); it is unchanged. | Spec lock-order paragraph («if the category changed in between, it starts over»). |
| C-7 | `@RequireAll(permissions, target)` sets `{ permissions, target, mode: 'all' }` under `REQUIRE_ACCESS`; `@RequireAny`/`@Require` set `mode: 'any'` (explicit, so a missing field is never read as "all"). `AccessGuard` forwards `mode`; `AuthorizeRequestInput` gets `mode?: 'any' \| 'all'` (default `'any'`), and the `allows` callback uses `every` for `'all'` over the same grants read in the same single `accessAt` transaction. Scope and target validation are shared with `@RequireAny` (one scope per list). | Spec; no second transaction, no import arrow for `catalog`. |
| C-8 | `close:services:business` is a new `TenantPermission` (`access-catalog.ts`) with the default roles owner, general manager and business manager (`role-defaults.ts` and the migration seed). SI-Q17 keeps it with those three, so it joins `deviceForbidden` and is **not** added to the delegable list of SI-Q26 (the six codes of `32b-cat-1p` stay six). Policy tests prove that a cashier, a staff role and a device cannot receive it. The i18n permission name is added, and the reviewed grant allowlist `packages/db/src/__tests__/privileges.spec.ts` follows the new column grants. | Spec: close:services:business is not part of the SI-Q26 delegation; SI-Q17 keeps closing a single service with the owner, general manager and business manager. |
| C-9 | The orders catalog reader: the catalog function `readSessionServices` returns `closed_at` for each row (the batch size and the `FOR SHARE` lock-then-read pattern stay). The adapter strips `closed_at` before the row becomes a `SessionService` (so it never reaches a snapshot or fingerprint) and its `read` throws `SessionError('SERVICE_CLOSED')` for a closed service; `lock` is unchanged (it runs first, `FOR SHARE`, ascending `id`). `SERVICE_CLOSED` is a new orders `SessionError` code carrying `{ service_id }` (the adapter does not know the input index), HTTP 409 (the status of the other closed-state refusals, `SERVICE_CATEGORY_CLOSED`; the spec gives no number, so it is recorded in the spec), with ar/en messages. **Callers of `CatalogReaderPort.read`:** record-service-session, append-service-session-lines, request-discount-approval. `apps/api/src/app.ts` (the commission override existence check) also calls `readSessionServices`; it ignores the new `closed_at` and is unchanged. All three place new lines, and all refuse a closed service, as the spec says (it refuses at record time). Edits of lines already recorded never call `read`. **Consequence stated plainly:** record-service-session passes every line to `read`, from-package lines included, so redeeming a prepaid package session for a closed service is refused too. The spec has no carve-out, so the rule is applied as written, and the effect was reported as SI-Q27. **Answered 2026-11-13 (Waleed):** a closed service is accepted at record time only when the line redeems a package session through the package path; any other line is refused with `SERVICE_CLOSED` (built in #996, `orders/domain/closed-service-redemption.ts`). `readPackageTypeForSale` calls the catalog function directly and keeps its behaviour: selling a package whose component service is closed is not changed by this PR, and neither is the worker package import (`apps/worker/src/modules/catalog/persistence/package-import-services.reader.ts`, `package-commit-services.reader.ts`), which matches and commits onto closed services (SI-Q28, **answered 2026-11-13**: selling a package with a closed service is blocked and closed services are hidden in the composer, in a separate follow-up slice; the import's treatment stays `TODO(spec)` until that slice). | Spec: it refuses a closed service at record time with `SERVICE_CLOSED`; an order line recorded before the close is untouched. The package effects are not in the spec, so they are questions, not code. |
| C-10 | `session-service-options.query.ts` adds `AND closed_at IS NULL`. The service list and detail projections add `closed_at`. **Every query that offers services for sale at the time of this PR:** only `session-service-options` (the session recording picker). `package-service-options.query.ts` is the admin picker that composes a package type, not a sale offer, and the spec does not touch it, so it is **unchanged** (SI-Q28 covers it). `apps/menu` has no services catalog yet. | SI-Q18 and Abu Salem's note (the closed service leaves the cashier and self-service); the package picker is not stated, so no code. |
| C-11 | A branch-owned (`BRANCH` visibility) category can be closed and reopened by the business-level routes, like any category of the business. A branch-level close stays the branch-state use case of `32b-cat-1b` and touches no service. | Spec SI-Q22. |

## Layers, in CLAUDE.md §1 order

1. **Spec and ADR** (me): an addendum paragraph in `docs/adr/0003-*.md` after the `@RequireAny` paragraph of 2026-10-21 (PR #482 recorded `@RequireAny` the same way; the spec calls this ADR an addendum to ADR-0003's authorization model), an addendum to
   `docs/specs/031-catalog-services/spec.md` (SV-09 superseded, SV-Q3 answered), SI-Q27 and SI-Q28 in `owner-questions.ar.md`.
2. **Contracts** (Kimi): `packages/contracts/src/catalog/service-category.ts` (close/reopen input
   `{ expected_revision, expected_service_count }`, close/reopen response, detail schema with the two counts),
   `service.ts` (`closed_at` on the service shapes, close/reopen input `{ expected_revision }`),
   `catalog-openapi.ts` (five routes + the new error codes), schema specs. `pnpm contracts:openapi`, then
   `pnpm --filter @pospay/{admin,pos,menu} api:check` (I run both; generated files are never hand-edited).
   i18n: error messages ar/en for `SERVICE_CATEGORY_ALREADY_CLOSED`, `SERVICE_CATEGORY_NOT_CLOSED`,
   `SERVICE_ALREADY_CLOSED`, `SERVICE_NOT_CLOSED`, `SERVICE_CATEGORY_COUNT_CHANGED`, `SERVICE_CLOSED`;
   `catalog-service-error-statuses.ts` (409).
3. **Identity** (Kimi): `access.decorators.ts`, `access.guard.ts`, `authorize-request.ts`, tests.
4. **Migration, RLS, grants** (Agy), two files because the CHECKs are added `NOT VALID` first (pattern 0194/0195):
   - `0221_<date>_service-closed-state.sql` (provisional number; renumbered on «lane granted»): `ALTER TABLE services ADD COLUMN closed_at timestamptz, ADD COLUMN closed_by_category_id uuid` (as separate statements), two CHECKs `NOT VALID` (`services_closed_marker_requires_closed`, `services_closed_marker_is_category`), `GRANT UPDATE (closed_at, closed_by_category_id) ON services TO pospay_app`, the `close:services:business` row in `permissions` and in `role_permissions` for owner, general_manager, business_manager (shape of 0190), `SET LOCAL lock_timeout = '5s'`.
   - `0222_<date>_service-closed-state-validate.sql`: `VALIDATE CONSTRAINT` for both.
   - `packages/db/schema/catalog.ts` (the two columns and CHECKs, no new index: `services_business_category_idx` serves the cascade and the restore), `access-catalog.ts`, `role-defaults.ts`, `system-role-policy.ts` (`deviceForbidden`).
   - No new table, so no new RLS policy; the existing `services` policies cover the columns. Negative isolation tests for the new write paths (another tenant's category close touches 0 service rows).
5. **Domain, ports, persistence, use cases, http, queries, orders** (Kimi), as listed in the files table.
6. **Tests** (Agy), listed below. **Docs** (me): the ADR-0003 addendum, the spec 031 addendum, `docs/module-map.md` untouched (no new arrow: `orders` already imports `catalog/index.ts`).

## Files (to create `+`, to edit `~`)

| File | Change |
|---|---|
| `apps/api/src/shared/access.decorators.ts` | ~ `mode` on `RequiredAccess`, `RequireAll` |
| `apps/api/src/modules/identity/http/access.guard.ts` | ~ forward `mode` |
| `apps/api/src/modules/identity/use-cases/authorize-request/authorize-request.ts` | ~ `mode` in input, `every` vs `some` |
| `packages/contracts/src/catalog/service-category.ts`, `service.ts`, `catalog-openapi.ts` | ~ |
| `packages/i18n/src/catalog-service-categories.ts`, `catalog-services.ts`, `service-session-errors.ts`, `permission-name.ts` (+ locale permission name key) | ~ |
| `apps/api/src/shared/catalog-service-error-statuses.ts` | ~ |
| `apps/api/src/modules/catalog/domain/errors.ts` | ~ new error codes on `ServiceCategoryError` and `ServiceError` |
| `apps/api/src/modules/catalog/domain/service-category-closing.ts` | + `planServiceCategoryClose`, `planServiceCategoryReopen` (pure) |
| `apps/api/src/modules/catalog/domain/service-closing.ts` | + `planServiceClose`, `planServiceReopen` (pure) |
| `apps/api/src/modules/catalog/domain/service.ts`, `service-row.ts` | ~ `closed_at`, `closed_by_category_id`; marker clear on category move |
| `apps/api/src/modules/catalog/ports/service-category-transactions.port.ts` | ~ `closeServices`, `reopenServices` (lock + count + set-based update), `auditBatch` |
| `apps/api/src/modules/catalog/ports/service-transactions.port.ts` | ~ `loadClosing`-style reads are the existing `load`/`peekCategoryId`/`lockCategories`; add only what C-6 needs |
| `apps/api/src/modules/catalog/persistence/drizzle-service-category-transactions.ts`, `drizzle-service-transactions.ts` | ~ |
| `apps/api/src/modules/catalog/use-cases/close-service-category/`, `reopen-service-category/`, `close-service/`, `reopen-service/` | + four use cases |
| `apps/api/src/modules/catalog/http/service-categories.controller.ts`, `services.controller.ts`, `catalog.module.ts` | ~ five routes (two category writes, the detail read, two service writes), wiring |
| `apps/api/src/modules/catalog/queries/service-category-detail.query.ts` | + detail with the two counts |
| `apps/api/src/modules/catalog/queries/service-projection.ts`, `list-services.query.ts`, `service-detail.query.ts`, `session-service-options.query.ts` | ~ `closed_at`; closed services left out of the session picker |
| `apps/api/src/modules/catalog/persistence/session-services.reader.ts` | ~ `closed_at` in the row (the adapter strips it, C-9) |
| `apps/api/src/modules/orders/persistence/catalog-reader.adapter.ts`, `domain/session-error.ts` | ~ `SERVICE_CLOSED` (shared `orders.module.ts` untouched) |
| `packages/db/schema/catalog.ts`, `packages/db/src/{access-catalog,role-defaults,system-role-policy}.ts`, `packages/db/src/__tests__/privileges.spec.ts`, two migration SQL files | ~ / + |

## Tests (Agy writes, I run them)

- Unit, no database: closing and reopening plans (marker rules, already closed, revision, counts), `planServiceUpdate`
  marker clear, `@RequireAll` metadata and scope validation, `AuthorizeRequest` `'all'` vs `'any'` (one transaction),
  route coverage counts `@RequireAll`, role defaults / policy tests for `close:services:business` (cashier, staff role,
  device cannot receive it; not delegable).
- Integration (real Postgres, one cloned DB per spec file): close-category cascade (open services closed with marker,
  already-closed keeps its own `closed_at`), reopen restores exactly the marked ones, `expected_service_count` mismatch
  409, stale revision 409, audit rows (one category row + one per service), the service closed/reopened happy and
  error paths (`SERVICE_ALREADY_CLOSED`, `SERVICE_NOT_CLOSED`, `SERVICE_CATEGORY_CLOSED` on reopen), moving a service
  clears its marker, a default branch manager and a `close`-only / `manage`-only role are refused with the uniform
  403, RLS negative (another tenant's category id = 404, 0 rows touched), concurrency: edit-in-category versus
  close-category (no deadlock, no open service left under a closed category), single close versus category close,
  record versus close in both orders (`SERVICE_CLOSED` or the line stands), cascade versus recording lock order.
- `EXPLAIN ANALYZE` assertions: the two counts and the cascade/restore selects use `services_business_category_idx`.
- Result-shape tests for the category detail read; session-service-options leaves closed services out (the package picker is **not** changed, SI-Q28);
  orders reader refuses closed on the three callers; recorded lines untouched after a close; an idempotent replay of a recording that was committed before the close answers from the stored response; an approved discount proposal whose service closed afterwards is refused at record time; sale snapshots and fingerprints of `readPackageTypeForSale` are byte-identical (the adapter drops `closed_at`); no HTTP response of a service carries `closed_by_category_id`.
- Cascade facts: the set-based UPDATE row count equals the locked count; the cascade waits behind a long `FOR SHARE` (a worker package commit) instead of failing; **a warm close and a warm reopen of a category of 300 services each finish under 200 ms** (the synchronous threshold, PP-187; above it the worker job of `32b-cat-2-worker`); a move of a service to category B racing a close of B, and racing a single-service close, ends with no deadlock and no open service under a closed category.
- `@RequireAll`: an empty list throws at load; a DENY on one of the two permissions gives the uniform 403; a business-wide personal grant of both passes; `apps/api/src/shared/__tests__/require-any.spec.ts` exact-shape assertions follow the new `mode` field; each of the five routes also carries `@RequiresFeature('catalog')` (feature disabled gives `FEATURE_DISABLED` after the permission passes).
- Constraint tests: both CHECKs reject a bad row; grants test follows (`catalog-grants.ts`: `closed_at` and
  `closed_by_category_id` updatable by `pospay_app`, nothing else new).

## Size estimate (changed lines, PP-112 / pipeline §14; generated files excluded)

| Category | Estimate | Refuse above (2x) |
|---|---|---|
| Docs (ADR, spec 031 addendum, this plan, debate) | 220 | n/a (mine) |
| Migration SQL + schema + seeds (Agy) | 90 | 180 |
| Contracts + i18n + statuses (Kimi) | 170 | 340 |
| Identity guard (Kimi) | 50 | 100 |
| Domain + ports + persistence + use cases + http + queries + orders (Kimi) | 700 | 1400 |
| Tests (Agy) | 900 | 1800 |
| Total code excluding tests and docs | about 1010 | |

The spec row says 600 to 850 for the whole row; this plan is above that because the guard mode, the contract and the orders refusal were not counted there (review finding 4). The work is committed in separable commits so the manager can split it without rework: (1) `@RequireAll` with the ADR-0003 addendum and its tests, no migration; (2) migration, schema and permission seed with the database tests; (3) contracts, messages and statuses; (4) the catalog domain, use cases, persistence and routes with their tests; (5) the orders `SERVICE_CLOSED` refusal with its tests. Any Kimi delivery above the stated limit is refused.

## Risks for the debate

1. The cascade on a category with hundreds of services must stay under the 200 ms rule: one `SELECT … ORDER BY id FOR NO KEY UPDATE` of the full rows (the audit before-snapshots need them),
   one set-based `UPDATE`, one batched audit insert (`appendAuditLogs`), no per-service round trip.
2. Deadlock freedom: category first, services ascending `id`; single service close takes category `FOR SHARE` then the
   service; an order recording takes services `FOR SHARE` ascending `id` and never a category lock.
3. `expected_service_count` race: counts are read under the category `FOR UPDATE` lock and assignment takes the category
   `FOR SHARE` lock, so they cannot change between the count and the update.
4. `SERVICE_CLOSED` must not turn a closed service into "not found" for the recorder, and must never refuse an edit of
   an already recorded line.

## Migration mechanics (pipeline §1, COMMON step 4, memory: migration lane is the final step only)

- Agy writes the two SQL files and the schema and seed edits only. It never touches `packages/db/migrations/meta/`.
- For private-cluster testing **I** add provisional journal entries `0221` and `0222` to `_journal.json` by hand (the
  same shape as `0220`), with no snapshot. `db:generate` is **not** run before the manager says «lane granted».
  Sessions 68-2b-2 and 45 may also take `0221`, so the numbers are provisional.
- On «lane granted»: drop the two provisional files and journal entries, run `pnpm db:generate service-closed-state`
  (drizzle-kit produces the snapshot and journal), put the hand-written SQL body back, run
  `pnpm db:generate service-closed-state-validate --custom` for the tail, re-run the DB specs, then report.
- The database review of pipeline §5 (Astra `high`, read-only) is the manager's step on the PR; this plan pre-checks its
  list: no new table (so no new RLS), CHECKs added `NOT VALID` and validated in the tail, no new index (the existing
  partial `services_business_category_idx` serves the cascade and restore, EXPLAIN-asserted), the grant allowlist
  `privileges.spec.ts` updated, expand/contract kept (nullable columns, nothing destructive).

## Design advisors (spec delivery row: cascade execution path, 200 ms rule)

Consulted: `pospay-advisor` (read-only) as the stand-in for Astra, whose quota is out until 2026-11-14; its advice is non-binding and its P1s are applied here (see `debate-32b-cat-2-advisor.md`). The cascade is synchronous inside one request transaction: one `SELECT ... FOR NO KEY UPDATE` of the full rows, one set-based `UPDATE`, one `appendAuditLogs` statement. The measurement (100 to 1,000 services) went to Waleed as SI-T2; his answer (2026-11-13): the SQL-built audit, synchronous up to a measured threshold, a worker job above it. The threshold is **300 services** (PP-187); above it #996 stays synchronous until `32b-cat-2-worker` lands, and production waits for that row (issue #1012). No category maximum is invented.

