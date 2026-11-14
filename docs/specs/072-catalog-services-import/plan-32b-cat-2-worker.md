# Plan: 32b-cat-2-worker, closing and reopening large categories as a background job

Roadmap row `32b-cat-2-worker` («قفل وفتح التصنيفات الكبيرة في الخلفية»), follow-up of `32b-cat-2` (#996) in
[spec 072](spec.md): «Sync threshold and the gap above it» (SI-T2, PP-187) and «The 200 ms rule». Closes issue #1012
(no production release of #996 before this row merges) and #1013 (the stale lines of `plan-32b-cat-2.md`, fixed in
this PR's first commit). **API and worker only.** The admin screen is `32b-cat-3`.

## Prerequisites (checked on `origin/main` 6bc858ffc)

- `32b-cat-2` (#996) merged: the close and reopen use cases, `persistence/drizzle-service-category-closing.ts` (the
  one-statement cascade with SQL-built audit rows), `service-category-closing-audit.spec.ts` (parity with
  `serviceSnapshot`), `service-category-closing-budget.spec.ts` (300 services under 200 ms) and
  `service-category-closing-lock-order.spec.ts`.
- SI-T2 and PP-187 recorded (`owner-questions.ar.md` §30). The threshold is **300 services**.
- The worker `catalog` module has only two readers (`package-*-services.reader.ts`); it has no module file, no job
  and no event. `32b-3` (service-import commit) will add the same scaffolding; it has no open PR today. Whichever lands
  second rebases onto the other's `catalog.module.ts` (risk 5).
- Migration lane: granted. The migration is committed as `0228_2026-11-13_service-category-closings.sql`, generated
  with `db:generate` after the grant, together with its `0228_snapshot.json` and `_journal.json` entry.

## Decisions

| # | Decision | Why |
|---|---|---|
| W-1 | **Nothing changes at accept.** Above the threshold the request creates a job row and an outbox event and returns 202; the category and its services stay untouched until the job's single transaction commits. | Closing the category at accept would leave open services under a closed category (the order recorder checks only `services.closed_at`), a visible partial state. |
| W-2 | **Where the path is chosen.** The use case locks the category `FOR UPDATE` (lock order C-3), checks revision then state (the existing `assertServiceCategoryCloseable` / `Reopenable`), then **counts** the affected services on `services_business_category_idx` (close: `closed_at IS NULL`; reopen: `closed_by_category_id = X`) before locking any service row. A count different from `expected_service_count` stays the synchronous 409 `SERVICE_CATEGORY_COUNT_CHANGED`. A pure domain function `serviceCategoryClosingPath(count)` returns `sync` for `count <= SERVICE_CATEGORY_SYNC_CLOSING_LIMIT` (300, in `domain/`) and `job` above it. The sync path then runs exactly the #996 code (`lockOpenServices` / `lockMarkedServices`, plan, `saveClosing`, `auditClosing`), unchanged. | One count read is cheap at any size; the constant and the comparison are a business rule, so they live in `domain/` (CLAUDE.md §4.2). |
| W-3 | **One pending job per category.** Partial unique index `(company_id, category_id) WHERE status = 'pending'`. Under the category lock, the use case looks for a pending job of the category: an **identical** request (same action, `expected_revision`, `expected_service_count`) returns **the same job** (202, same `closing_id`), which is the replay answer; any other close or reopen of that category gets 409 `SERVICE_CATEGORY_CLOSING_IN_PROGRESS` with `details: { closing_id }`. A pending job whose `deadline_at` has passed is marked `failed` / `SERVICE_CATEGORY_CLOSING_EXPIRED` in the same transaction and no longer blocks. | Same answer for a double click; a lost job never blocks a category forever. |
| W-4 | **While a job is pending**, rename, visibility change, single-service close or reopen and assigning a service to the category are **not blocked**. A rename or visibility change bumps the category revision and a change to the affected count fails the count check, so the job fails with `SERVICE_CATEGORY_REVISION_CONFLICT` or `SERVICE_CATEGORY_COUNT_CHANGED` and the manager re-reads and confirms again. Single-service changes that leave the count the same pass both checks, and the job applies to the services the category has when it runs. | Exactly the #996 semantics shifted in time: the screen «reloads the count and asks again» (spec). No other use case is touched. |
| W-5 | **The job is one transaction**: `withTenant(companyId, …, { userId: requested_by, timeoutMs: 60_000 })`. Steps: lock the category `FOR UPDATE`; lock the job row `FOR UPDATE` and **no-op unless it is `pending`**; past `deadline_at` → `failed`/`SERVICE_CATEGORY_CLOSING_EXPIRED`; re-check revision, state and count under the same locks (mismatch → `failed` with the existing code); lock the service rows `ORDER BY id FOR NO KEY UPDATE`; the category update and its audit row; the shared cascade statement (services + their audit rows); the job row → `completed` with `services_changed`. A failure code is written in its own transaction (same pattern as `BuildLeaveHistoryReport.fail`), never with partial effects. | Chunking would break the count guard and expose partial state. Evidence: #996 measured 1,000 services at 231-310 ms (close) and 266-290 ms (reopen) warm, about linear, so 5,000 is about 1.5 s, inside the 60 s timeout; no category maximum exists, so the timeout plus `SERVICE_CATEGORY_CLOSING_FAILED` is the bound. 1,000, 3,000 and 5,000 are measured locally on the lane before the worker PR opens and recorded in the spec (informational, not a CI assertion). |
| W-6 | **Actor.** The job runs with `userId = requested_by`, so `app_user_id()` in the SQL audit is the requesting manager (tested). Permission is checked at accept only (`@RequireAll` manage + read, as today); the job does not re-check it. | Same actor as the sync path; a permission revoked between accept and a job that runs seconds later is accepted, as for every other worker job here (employee import, package import). |
| W-7 | **Replay and lost jobs.** BullMQ `jobId = event.id`, `attempts: 3`, exponential backoff, `removeOnComplete: true`. A redelivered event after completion re-enqueues; the job sees the row is no longer `pending` and does nothing. After the last attempt the processor writes `failed`/`SERVICE_CATEGORY_CLOSING_FAILED` (leave-history `persistFailure` pattern). An invalid event payload fails the row and is dropped. No ADR-0022 recovery sweep: the request is user-driven, the row expires (W-3), and the manager retries. | ADR-0018 transport; leave-history processor as the model. |
| W-8 | **One copy of the cascade SQL.** The cascade statement and its audit-snapshot mapping move **unchanged** from `apps/api/.../persistence/drizzle-service-category-closing.ts` to `packages/db/src/service-category-cascade.ts` (precedent: `packages/db/src/leave-history/`, `current-session-tips.ts`, consumed by both apps). `saveClosing` imports it; a no-behaviour-change commit with the three existing closing specs untouched and green. The worker also needs the **category** update and audit row: they join the same `packages/db` file as SQL (`UPDATE … RETURNING` before/after, one `audit_log` row), and `service-category-closing-audit.spec.ts` is extended to assert that this category row equals `serviceCategorySnapshot(before/after)` field by field, the same guard #996 uses for the service rows. The api sync path keeps its TypeScript category update. | `apps/worker` cannot import `apps/api`; a second copy of the snapshot mapping would drift. The parity spec lives in the api, next to the domain snapshot functions. |
| W-9 | **HTTP.** The existing routes `POST …/service-categories/{categoryId}/close` and `…/reopen` return **200** (sync, body as today) **or 202** `{ closing_id, status: 'pending' }`, through `@Res({ passthrough: true })` (precedent `companies.controller.ts`). Both responses are registered in OpenAPI and the three clients are regenerated. New read `GET …/service-categories/{categoryId}/closings/{closingId}` → `{ closing_id, category_id, action: 'close' \| 'reopen', status: 'pending' \| 'completed' \| 'failed', services_changed, error_code, requested_at, finished_at }` from `queries/` (a pending row past its deadline is projected as `failed` / `SERVICE_CATEGORY_CLOSING_EXPIRED`); result-shape test and `EXPLAIN ANALYZE` on the primary key. The category detail read gains `pending_closing_id` (nullable, from the partial unique index), so the screen finds a running job after a reload. The status route's permission is **PENDING SI-Q29** (recommended: the close route's pair, `@RequireAll` manage + read). | Spec says «→ 200»; the addendum records 200 or 202. |
| W-10 | **Event.** `ServiceCategoryClosingRequested`, payload `{ closing_id }`, aggregate `service_category_closing`, company in the envelope, emitted in the accept transaction; transported by the worker `catalog` module to the BullMQ queue `service-category-closing` after the outbox claim commits (ADR-0018). New `apps/api/src/modules/catalog/events/published.ts` (Arabic one-liner), the module-map event row, and module-map line 295 (the worker catalog module also owns this job). No business consumer. | ADR-0018. |
| W-11 | **No new permission, no new ADR.** The job follows ADR-0018 and the leave-history / package-import job shapes; the decisions are recorded in this plan and a spec 072 addendum. | Nothing architectural is new. |

## Migration (yes: one table)

`0228_2026-11-13_service-category-closings.sql`:

- `service_category_closings`: `company_id uuid NOT NULL` (FK `companies`), `id uuid`, `business_id`, `category_id`,
  `action text` (`close` / `reopen`), `status text DEFAULT 'pending'` (`pending` / `completed` / `failed`),
  `expected_revision int`, `expected_service_count int` (> 0), `services_changed int NULL`, `error_code text NULL`
  (CHECK on the six codes of W-3 / W-5), `requested_by uuid` (FK `user`), `requested_at`, `deadline_at`
  (`requested_at + 15 min`, CHECK `deadline_at > requested_at`), `finished_at NULL`; shape CHECK (pending: no result
  columns; completed: `services_changed` set, no error; failed: error set, no count).
- PK `(company_id, id)`; FK `(company_id, business_id, category_id)` → `service_categories (company_id, business_id, id)`
  (the existing `service_categories_company_business_id_key`); index on that FK; index on `requested_by`; partial
  unique `service_category_closings_one_pending_uq (company_id, category_id) WHERE status = 'pending'`.
- RLS enabled and forced; `select`, `insert`, `update` policies for `pospay_app` on `app_company_id()`; no delete.
- Grants: `SELECT, INSERT` and `UPDATE (status, services_changed, error_code, finished_at)` to `pospay_app`.
- Guard trigger: insert must be `pending` with no result columns; only `pending → completed | failed`; a terminal row
  is immutable.
- Drizzle schema in `packages/db/schema/catalog.ts`; grant allowlist `privileges.spec.ts`; `catalog-grants.ts`.
- Rows are kept (one row per large close or reopen, small); no cleanup job.

## Sub-PR split (each under ~500 code lines; merge order 1 → 2 → 3)

The API must not return 202 before the worker that runs the job is merged, so the worker lands **dormant** first.
`#1012` and `#1013` close with sub-PR 3 (the plan fix is committed in sub-PR 1 with `Refs #1013`).

| Sub-PR | Content | Code (refuse above 2x) | Tests |
|---|---|---|---|
| **1. Storage and the shared cascade** | The migration and schema, grants allowlist; the move of the cascade SQL to `packages/db/src/service-category-cascade.ts` (no behaviour change, api `saveClosing` re-imports it) plus the SQL category update and audit row; contracts for the event payload and the job data (`packages/contracts/src/catalog/service-category-closing.ts`); this plan and the `plan-32b-cat-2.md` fix. | 300 (600) | RLS negative (another tenant reads 0 rows, writes error), grants, CHECKs and the guard trigger, partial unique index, the extended audit parity spec (category row), the three existing closing specs unchanged. ~400 |
| **2. The worker job (dormant)** | Worker `catalog` module: `catalog.module.ts`, `jobs/service-category-closing.processor.ts`, `use-cases/run-service-category-closing/`, `domain/service-category-closing-job.ts` (pure: proceed or the failure code, deadline), `ports/`, `persistence/service-category-closing.transactions.ts`, `index.ts`; `main.ts` wiring (deliver chain, `knownEventTypes`, ready, close; `main.ts` is 317 lines, stays under 400). No producer yet. | 480 (960) | Seeded pending job + event (no route): ≥301 services → `completed`, `services_changed` = locked count, audit rows one per service plus one category row with the requester as actor and before/after closed fields; reopen restores only marked services; replay after completion is a no-op; revision, state, count and expiry failures write the code and change nothing; last-attempt failure persists `SERVICE_CATEGORY_CLOSING_FAILED`; concurrency with an order recorder (`FOR SHARE` in ascending id) in both orders, no deadlock; another tenant's job touches nothing; domain unit tests; processor unit tests (invalid event, queue retry). Perf (PP-165): job at 1,000 services ≤ 2× the unchanged sync use case at 1,000 in the same run, + 5 ms. ~600 |
| **3. The API switch and the status read** | Domain constant and `serviceCategoryClosingPath`; ports and persistence (count, pending lookup, expire, create job, publish); the close and reopen use cases choose the path; dynamic 200/202; the status query and route; `pending_closing_id` on the detail read; contracts (202 body, status response, `SERVICE_CATEGORY_CLOSING_IN_PROGRESS` 409, OpenAPI), i18n ar/en, error statuses; `events/published.ts`; regenerated clients; the spec 072 addendum and the module-map rows landed in sub-PR 2 (#1027), sub-PR 3 updates them if its API differs. | 480 (960) | 300 → 200 sync (unchanged), 301 → 202 + one pending row + one outbox event and no service changed; identical replay → same `closing_id`; different request → 409 IN_PROGRESS with `closing_id`; expired pending no longer blocks; count mismatch stays a sync 409; status read shape for each status and the expired projection, `EXPLAIN` on the PK; detail `pending_closing_id`; another tenant's `closingId` → 404; permission tests on the new route; route coverage. Perf (PP-165): accept at 301 ≤ 2× the unchanged sync close at 300 in the same run, + 5 ms (to be confirmed by the manager). ~600 |

Total about 1,260 code lines and 1,600 test lines (generated clients excluded).

## Implementers (PP-186)

Kimi CLI `k3.1-pro` for production code and tests, MiniMax-M3.1-Flash (opencode) as fallback; sub-PR 2 runs on MiniMax-M3.1-Flash (PP-112 switch, 2026-11-14: Kimi quota out; Grok `grok-4.7-build-fast` made no headless write and hung twice); every run fenced
(`.env*` stashed out, HEAD, `git stash list` and `git status --porcelain` before and after; no git, network, `.env*`,
`.git` or files outside the worktree). I review each diff, run typecheck, lint, `pnpm lint:docs`,
`pnpm module-map:check` and the slice's own specs on my private lane, then `clean-code-guard` and `test-guard`.

## Risks

1. **The audit parity** must stay one SQL copy (W-8); the moved file is diffed byte for byte against the old one.
2. **A job past its deadline that is still running** when a new request expires it: both take the category
   `FOR UPDATE` first, so they serialize; the job re-reads its row after the lock and stops when it is no longer
   `pending`.
3. **The lock window of a very large job** blocks recording on that category's services for its duration (about 1.5 s
   at 5,000); the same `FOR NO KEY UPDATE` as #996, so foreign-key inserts are not blocked.
4. **PP-165 baselines** compare new code with the unchanged sync path; the manager confirms the two pairs above.
5. **`32b-3`** creates the same worker `catalog` module; the second to land rebases.

## Sub-PR 3 work plan (2026-11-14, on `origin/main` 2be6da3b8)

Sub-PR 1 (#1021) and sub-PR 2 (#1044, the dormant worker job) are merged. Sub-PR 3 makes the API emit the job; until
it merges, #996 stays out of production (#1012). Three owner questions are open: SI-Q29 (who may read a job's status),
SI-Q30 (what the screen shows; the API supports both answers) and SI-Q31 (W-4, count-neutral changes; option 1 is the
current behaviour). Only the status route's guard waits for SI-Q29; nothing else in this list depends on an answer.

### Steps, in order (contract → domain → persistence → use case → http → tests)

| # | Change | Files | Code lines |
|---|---|---|---|
| 1 | Contracts: the 202 body `{ closing_id, status: 'pending' }`; the status response (W-9 shape, `status` and `error_code` from `SERVICE_CATEGORY_CLOSING_FAILURE_CODES`); `pending_closing_id` (nullable) on the category detail; the error `SERVICE_CATEGORY_CLOSING_IN_PROGRESS` with `details: { closing_id }`; OpenAPI entries (200 and 202 on close and reopen, the status route) | `packages/contracts/src/catalog/service-category-closing.ts`, `service-category.ts`, `catalog-openapi.ts` | 70 |
| 2 | Domain: `SERVICE_CATEGORY_SYNC_CLOSING_LIMIT = 300` and `serviceCategoryClosingPath(count)` → `sync` / `job`; the replay rule (identical action, revision and count → same job, otherwise in progress) and the deadline rule, as pure functions with Arabic JSDoc | `apps/api/src/modules/catalog/domain/service-category-closing-path.ts`, `domain/errors.ts` | 60 |
| 3 | Port and persistence: `countAffectedServices` (index `services_business_category_idx`, before any service lock), `findPendingClosing` (partial unique index), `expireClosing`, `createClosing` and the outbox row `ServiceCategoryClosingRequested` in the same transaction (precedent `orders/persistence/package-import-request.transactions.ts`) | `ports/service-category-transactions.port.ts`, `persistence/drizzle-service-category-transactions.ts` (or a new `persistence/drizzle-service-category-closing-request.ts` if the file passes 300 lines) | 120 |
| 4 | Use cases: close and reopen lock the category, check revision and state, count, then take the sync path unchanged at 300 or fewer, or the job path above (W-1, W-2, W-3). The result becomes a union `{ kind: 'done', … } | { kind: 'pending', closing_id }` | `use-cases/close-service-category/`, `use-cases/reopen-service-category/`, one shared helper in `use-cases/` for the pending lookup if both need it | 80 |
| 5 | HTTP: dynamic 200 / 202 through `@Res({ passthrough: true })` (precedent `companies.controller.ts`); the 409 mapping in `shared/catalog-service-error-statuses.ts`; the status route `GET …/service-categories/{categoryId}/closings/{closingId}` with its guard **left for SI-Q29** | `http/service-categories.controller.ts` (196 lines; a new `http/service-category-closings.controller.ts` for the status route keeps it under 300) | 70 |
| 6 | Read path: the status query (a pending row past its deadline is projected as `failed` / `SERVICE_CATEGORY_CLOSING_EXPIRED`) and `pending_closing_id` on the detail query | `queries/service-category-closing.query.ts`, `queries/service-category-detail.query.ts` | 60 |
| 7 | Event and wiring: `events/published.ts` (new in this module, Arabic one-liner), `catalog.module.ts` bindings, module-map rows if the API differs from #1027 | `events/published.ts`, `catalog.module.ts`, `docs/module-map.md` | 30 |
| 8 | i18n ar/en for `SERVICE_CATEGORY_CLOSING_IN_PROGRESS` and the six failure codes shown by the screen; regenerated clients (`pnpm contracts:openapi`, not counted) | `packages/i18n/src/catalog-service-categories.ts` | 20 |

Total about **510 code lines** (refuse above 1,020), close to the ~480 estimated in the split table.

### Tests (about 600 lines)

- Domain unit: the path at 299, 300, 301; the replay rule (identical, different action, different revision, different
  count); the deadline at, before and after `deadline_at`.
- Integration on the lane: 300 → 200 sync and the #996 specs unchanged; 301 → 202, one pending row, one outbox event,
  no service or category changed; identical replay → same `closing_id`, no second row or event; a different request →
  409 `SERVICE_CATEGORY_CLOSING_IN_PROGRESS` with `closing_id`; an expired pending row is marked expired and no longer
  blocks; a count mismatch stays the synchronous 409; another tenant's category or `closingId` → 404.
- Queries: status shape for pending, completed, failed and the expired projection, `EXPLAIN ANALYZE` on the primary
  key; detail `pending_closing_id` set and null.
- End to end on the lane: accept at 301, the worker job runs, the status read shows `completed` with
  `services_changed` (the worker and API are both merged now).
- Perf (PP-165): accept at 301 ≤ 2× the unchanged sync close at 300 in the same run, + 5 ms (risk 4, the manager
  confirms the pair).
- Route coverage and permission tests for close and reopen as today; the status route's permission test waits for
  SI-Q29.

### Held until the owner answers

- **SI-Q29:** the status route's `@Require…` decorator and its permission test (recommended: the close route's pair).
  Everything else on the route (query, shape, 404 for another tenant) is built now.
- **SI-Q30:** nothing in the API.
- **SI-Q31 (W-4):** option 1 needs nothing. Option 2 would add a migration (the service ids fixed at accept) and a guard
  in the worker job; that would be a separate migration PR, not this one.

### Implementer

Per PP-186 and PP-112 (as sub-PR 2): MiniMax-M3.1-Flash (opencode) for code and tests, Kimi CLI `k3.1-pro` if its
quota is back; every run fenced as above. One brief, dispatched only after the manager's go.
