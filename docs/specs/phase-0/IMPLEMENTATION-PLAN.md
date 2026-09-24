# Phase 0 — Implementation Plan

> **Status:** v4 · 2026-09-23 · after the Claude ↔ Codex debate (`DEBATE-2026-09-23.md`) · **done:** T0 T1 T2 T3 T4 T6a · T12a CI live (branch protection due before T5)
> v3 · 2026-09-22 · synced with `docs/PRD.md` v1.1 (§13 item 22)
> **Reads with:** `SPEC.md` in this folder
> **Audience:** the implementing agent (Codex `gpt-6-astra`, reasoning effort `high`) and Waleed

---

## 0. Rules the implementer must obey

These are not suggestions. Each is a CI gate.

1. **One slice per branch, one branch per PR.** Branch name `feat/phase0-<slice-id>-<short-name>`. Never commit to `main`.
2. **Never implement a whole module.** Implement one use case, finish it, then the next.
3. **Order inside a slice is fixed:** contract (Zod) → migration + RLS → domain functions + their tests → use case → adapters (persistence, http) → integration tests.
4. **`pnpm check` must be green before a slice is declared done.** A red check is a stop, not a note.
5. **Arabic doc comments are mandatory** on every `domain/` function, every `ports/` method and every event in `events/published.ts`. Written with the code, never after.
6. **Stop and mark `TODO(spec)`** rather than guessing a business rule. The six open questions in `SPEC.md` §8 are known unknowns — do not invent answers.
7. **No new top-level folder, no banned folder name** (`utils/`, `helpers/`, `common/`, `misc/`, `managers/`, root `services/` or `models/`).
8. **No secret in a commit.** `.env` is gitignored; `.env.example` carries empty keys only.

---

## 1. Task breakdown

Each task lists its deliverable, the files it touches, and the condition that closes it.
`Size` is a rough effort signal: **S** ≈ half a day, **M** ≈ 1 day, **L** ≈ 2–3 days.

---

### T0 — Auth ↔ RLS bootstrap decision · Size S · depends: — · ✅ done (ADR-0003, PR #5)

**Why this exists.** The adversarial review found a hole that scheduling cannot fix: **login happens before a tenant is known.** A user signs in, *then* we discover which companies they belong to. So Better Auth's own queries cannot run inside `withTenant()` — there is no company id yet. And a user may belong to several companies, so stamping one `company_id` on an auth row misrepresents the relationship.

Deciding this *after* the schema is written means rewriting the schema. It is therefore T0, not part of T9.

**Deliverable:** `docs/adr/0003-auth-rls-boundary.md` (0001 is the domain topology ADR, 0002 the tooling baseline), plus the table classification it produces.

**The classification — canonical text is ADR-0003 §2; this is its index, not a second copy:**

| Class | Tables |
|---|---|
| **Global identity** (no tenant RLS, `packages/auth` / `pospay_auth` only) | `user`, `session`, `account`, `verification`, `two_factor`, `apikey` (fixed `company_id` column), `platform_grants`, `platform_audit_log` |
| **Bridge** (read by user or company, write by company) | `memberships`, `permission_overrides` |
| **Mixed scope** (global rows + company rows, split policies) | `roles`, `role_permissions`, `idempotency_keys` (`COMPANY` / `USER` scope) |
| **Global reference** (read-only for the app) | `plans`, `permissions` |
| **Tenant root** (keyed on `id`) | `companies` |
| **Tenant data** | everything else |

**Request flow this produces:** authenticate (global) → read memberships as the user → resolve the requested company and **verify membership server-side** → `withTenant(companyId, …)` for all business data.

**Consequences to write into the ADR:**
- `CLAUDE.md` §5 currently says *all* DB access goes through `withTenant()`. That sentence needs an explicit, named exception for the auth path. Amend the rule — do not quietly break it.
- The auth role gets **no** `BYPASSRLS`. It gets table-level grants on the global identity tables only.
- Auth-handler routes are exempt from the guard rule and must be **listed explicitly** as public; controller scanning will not classify them for us.
- Decide whether authorization lives in Better Auth's `organization` plugin or in our `memberships` table. **Two authorities is a bug** — pick one. Proposed: our `memberships` owns authorization; the plugin is used for nothing it duplicates.

**Done when:** the ADR is written and the table classification is agreed, before a single migration is generated.

---

### T1 — Workspace skeleton · Size S · depends: — · ✅ done (PR #1, #2)

**Deliverable:** an installable, checkable, empty monorepo.

**Files**
```
package.json · pnpm-workspace.yaml · turbo.json · tsconfig.base.json
.gitignore · .env.example · .editorconfig · README.md
packages/config/eslint/{index.js,boundaries.js,jsdoc.js}
packages/config/tsconfig/{base.json,node.json}
```

**Notes**
- ESLint config already carries `boundaries`, `jsdoc` (scoped to `domain/**` and `ports/**`), `max-lines` 300/400, `max-lines-per-function` 60, and `no-warning-comments` blocking `FIXME`/`HACK`/`XXX`.
- `pnpm check` = `turbo typecheck lint test`.

**Done when:** `pnpm install` succeeds and `pnpm check` exits 0.

---

### T2 — Local infrastructure · Size S · depends: T1 · ✅ done (PR #12)

**Deliverable:** Postgres 16 and Redis 7 running locally.

**Files:** `deploy/docker-compose.dev.yml`

**Notes:** named volumes, `healthcheck` on both services, Postgres tuned with `statement_timeout` and a connection limit so a runaway query cannot starve the API later.

**Done when:** `docker compose -f deploy/docker-compose.dev.yml up -d` runs and both healthchecks report healthy.

---

### T3 — `packages/domain` · Size M · depends: T1 · ✅ done (PR #14, ADR-0004, ADR-0005)

**Deliverable:** the shared kernel, pure and dependency-free.

**Files**
```
packages/domain/src/{money.ts,percentage.ts,tax-rule.ts,rounding.ts,index.ts}
packages/domain/src/__tests__/*.spec.ts
```

**Required behaviour**
- `Money` is `bigint` mills; 1 KWD = 1000 mills. No `number` anywhere.
- `roundKwd` rounds **half-up at line level**; totals are summed from already-rounded lines, never recomputed from raw inputs.
- Every exported function carries a full Arabic JSDoc with `@param` and `@returns`.

**Done when:** tests pass with no database, and `packages/domain/package.json` has an empty `dependencies` object.

---

### T4 — `packages/db` foundation · Size M · depends: T2, T3 · ✅ done (PR #15, ADR-0006)

**Deliverable:** the only sanctioned path to the database.

**As built**
- `createDatabase({ url, ids })` is the package's only runtime export. It returns `withTenant` / `withUser` /
  `withNewTenant` / `close`; the postgres.js + Drizzle client never leaves the closure (a test asserts the exports).
- Every wrapper sets **both** `app.company_id` and `app.user_id` transaction-locally on every call, and refuses to run
  on a connection whose role is superuser or `BYPASSRLS` (a misconfigured `DATABASE_URL` cannot silently disable RLS).
- `IdGenerator` is an interface injected into `createDatabase`; its implementation arrives in T7 (`packages/ids`).
- `bootstrapRoles` creates `pospay_app` / `pospay_auth` and re-applies their attributes, revokes every role membership
  and resets connection limit and password validity on each `pnpm db:migrate`, under a cluster-wide lock.
- The first migration (`0000_2026-09-22_context-helpers.sql`) creates `app_company_id()` / `app_user_id()`.
- **Bootstrap-owner exception (Waleed, 2026-09-23):** the compose image makes `pospay_owner` its bootstrap superuser,
  so it has `BYPASSRLS`. It only runs migrations. Every **runtime** role stays `NOSUPERUSER NOBYPASSRLS`, and the
  "no BYPASSRLS" assertions cover the application roles.
- No platform bypass role (ADR-0003 §3, review finding #14). `scripts/seed.ts` arrives with its first data in T5.

---

### T5 — `tenancy` schema + RLS ⭐ · Size L · depends: T4, **T6a merged and green**, **branch protection on `main`**

**Deliverable:** the phase's success criterion, proven.

**Files**
```
packages/db/schema/tenancy.ts
packages/db/migrations/<generated>_tenancy.sql      ← name produced by `pnpm db:generate tenancy` (ADR-0006)
packages/db/scripts/seed.ts
packages/db/src/__tests__/rls-tenancy.spec.ts
packages/db/src/__tests__/privileges.spec.ts
```

**Tables:** `plans`, `companies`, `businesses`, `branches`, `company_feature_overrides` — per `SPEC.md` §4, with column
names following `packages/contracts` (e.g. `timezone`; `geo` stored as `geo_lat` / `geo_lng`; `opening_hours` jsonb).
The overrides table is here, not in `identity`, because `tenancy` owns plans and feature flags (`SPEC.md` §3); T9a's
`@RequiresFeature()` guard only reads it.

**Policies follow ADR-0003 exactly — do not restate them differently here:**
- Classification per ADR-0003 §2: `plans` is global reference data (no `company_id`, no RLS, `SELECT` only for
  `pospay_app`) — already decided there, no new ADR needed. `companies` is the **tenant root** (§2.4): no
  `company_id` column; its policies key on `id`; `pospay_app` has no `DELETE` grant. Every other table is tenant data.
- Every policy reads context through `app_company_id()` (migration 0000), **never** a raw
  `current_setting(...)::uuid` cast — an empty setting on a pooled connection would raise `22P02`.
- Policies are split by command: `FOR SELECT … USING`, `FOR INSERT … WITH CHECK`, `FOR UPDATE … USING … WITH CHECK`,
  `FOR DELETE … USING`. `INSERT` and `UPDATE` policies declare `WITH CHECK` explicitly (`DELETE` has none by definition).
- `ENABLE` **and** `FORCE ROW LEVEL SECURITY` on every tenant table. On tenant **child** tables, composite indexes start
  with `company_id` and a same-tenant `UPDATE` of `company_id` is rejected; `companies` (no `company_id`) gets its own
  root-table assertions below.
- Tenant-qualified composite foreign keys (below), and primary keys `(company_id, id)` on tenant tables — never `id`
  alone, whose uniqueness check would reveal another tenant's rows (ADR-0007).

**Seeds vs fixtures (debate C2).** `seed.ts` writes only the **provisional plan** — every module flag enabled
(Waleed, 2026-09-23), renamed when D-06 is decided — and the **vertical templates** as JSON, from `PRD.md` §7.1.
It creates **no company**: memberships do not exist until T9a, and a company without an owner is forbidden
(ADR-0003 §5.3). Persistent demo companies are created in T8, through `onboard-company` then `create-business` (below). The RLS suite's companies are
**test fixtures** inside a cloned test database, dropped after the run — an explicit, test-only exception to §5.3.

**Negative tests (real Postgres — the compose stack, ADR-0006) — revised after review:**

Run the whole suite **as the restricted application role**, not as the owner or a superuser.

*Role assertions*
- `pospay_app` and `pospay_auth` are `NOSUPERUSER`, `NOBYPASSRLS`, own no table, and cannot `SET ROLE` to a privileged
  role (the bootstrap owner is exempt — T4)
- `plans` is readable but **not** writable by the app role
- `companies`: `DELETE` fails with **permission denied** (there is no grant), not "0 rows"

*Row assertions*
- cross-tenant `SELECT` returns 0 rows
- cross-tenant `INSERT` is **rejected by `WITH CHECK`** — the policy must declare `WITH CHECK` explicitly, not rely on inheriting `USING`
- cross-tenant `UPDATE` affects **0 rows** (this is correct PostgreSQL behaviour — it does **not** raise, and the earlier claim that it would was wrong)
- cross-tenant `DELETE` affects 0 rows
- same-tenant `UPDATE` attempting to change `company_id` is rejected
- `UPSERT` (`ON CONFLICT`) cannot write across tenants
- a query outside `withTenant()` sees no tenant and returns 0 rows

*Context-leak assertions*
- reuse one pooled connection across A → B → no-tenant and assert the setting does not survive
- assert the same after an exception and after a rollback
- assert two concurrent transactions do not see each other's `app.company_id`

*Referential-integrity assertion*
- company A **cannot** create a branch whose `business_id` belongs to company B.
  RLS does not enforce this — a plain UUID foreign key happily points across tenants.
  **Fix: tenant-qualified composite foreign keys** — `businesses` gets `UNIQUE (company_id, id)` and `branches` references `(company_id, business_id)`. Apply the same pattern to every child table in later phases.

*Inventory assertion*
- no `SECURITY DEFINER` function exists on tenant tables; if one is ever added it must pin `search_path` and restrict `EXECUTE`

*Privilege inventory (closes issue #16, debate C9)*
- A **reviewed allowlist** in the test file lists every direct privilege each application role may hold (table,
  column, sequence, function, schema, database). The test fails on any privilege not in the list — a broad grant added
  by a migration does not authorise itself.
- Effective access is tested separately: through role membership, `PUBLIC`, ownership, and schema/function privileges.
- `pospay_auth` can read **no** tenant table; `pospay_app` can read no global-identity table.

> **What RLS cannot do:** `withTenant(B, …)` legitimately reaches company B. The database cannot tell an authorised company id from an attacker-supplied one. That check belongs to the API layer and is tested in **T8**, not here.

**Done when:** every assertion above passes as the restricted role, runs in `pnpm test`, and is a **required CI check**
(CI already runs `pnpm check` on the compose stack since T4). **Before T5 merges**, branch protection on `main` must
require that check and block direct pushes (T12a) — otherwise "required" is only a convention.

---

### T6a — `packages/contracts` for tenancy · Size S · depends: T4 · ✅ done (PR #17)

Zod 4 schemas for plan, company, business, branch (entity + strict create input); error envelope; cursor pagination;
opening hours; currency and timezone as enums over lists bundled from SIX ISO 4217 and IANA tzdb;
`pnpm contracts:openapi` writes the committed `openapi/openapi.json` and a test fails when it is stale.
Decisions (Waleed, 2026-09-23): names 1–255, free-text ar/en address, intervals per ISO weekday, any ISO 4217 code.

---

### T6b — `apps/api` foundation · Size M · depends: T5

**Deliverable:** a running API that consumes `@pospay/contracts` and `@pospay/db`, and never logs a secret.

**Files**
```
apps/api/src/{main.ts,app.module.ts}
apps/api/src/shared/{exception.filter.ts,health.controller.ts,request-logger.ts}
packages/observability/src/{pino.ts,redaction.ts,index.ts}
```

**Required behaviour**
- NestJS on the **Fastify** adapter; request validation with the Zod contracts.
- Global exception filter emitting `errorEnvelope` from `@pospay/contracts`.
- `/health` (process alive, no dependency checks) and `/ready` (DB + Redis reachable) — different checks.
- **The shared pino config and redaction list land here** (review finding #13), before the first real request is logged:
  PINs, tokens, credentials, full phone numbers (last 3 digits only), employee-document content.
- The database is reached only through `createDatabase` on `DATABASE_URL` (`pospay_app`).

**Done when:** `/health` returns 200; `/ready` returns non-200 when Postgres or Redis is down (tested); a deliberately
logged PIN and token do not appear in the output (tested); an invalid body returns the error envelope.

---

### T7 — Cross-cutting write primitives · Size M · depends: T6b · ✅ done

**As built**
- `packages/ids`: `createUuidV7({ now, fillRandom })` (RFC 9562, monotonic within one generator, zero dependencies) and
  `systemUuidV7()` on the system clock and Web Crypto; bound to `@pospay/db`'s `IdGenerator` in `apps/api/src/main.ts`.
- Migrations `0003_…_cross-cutting.sql` (tables) and `0004_…_cross-cutting-rls.sql` (RLS, grants, commit check).
- `outbox`: PK `(company_id, id)` — `id` is the stable event id T7b dedupes on; `pospay_app` may only `INSERT`.
- `audit_log`: insert-only (`SELECT`, `INSERT`); the actor is `app_user_id()` (NULL = a system action). `before` /
  `after` pass through `redactSecrets` (secret-named keys and URL credentials removed; phone numbers kept whole —
  the audit trail is a business record, not a technical log; Waleed, 2026-09-23).
- `idempotency_keys`: PK `(scope_type, scope_id, operation, key)` instead of a surrogate `id`; `UPDATE` reaches only a
  row whose response is still NULL; a deferred constraint trigger refuses to commit a claim without its response.
  A `USER` row carries no `company_id` (an FK check would reveal whether a company exists). The claim restores the
  caller's own `lock_timeout` afterwards.
  No `DELETE` grant — the 24 h sweep moves to T7b (the worker). An expired row still replays until it is swept.
- `@pospay/db` exports `appendOutboxEvent`, `appendAuditLog` and `runIdempotent`; company and actor always come from
  the transaction's context, never from the caller.
- `apps/api`: `Clock`, `OutboxWriter` and `AuditTrail` ports (no Drizzle type) with `transactionWriters(tx, ids)` as
  their adapter; `@Idempotency()` param decorator (header → 400, sha256 fingerprint of method + route pattern + path
  parameters + query + canonical body); `IDEMPOTENCY_KEY_REUSED` (422) and `IDEMPOTENCY_KEY_IN_PROGRESS` (409).

**Deliverable:** the machinery every later write depends on.

**Files**
```
packages/db/schema/{outbox.ts,audit-log.ts,idempotency.ts}
packages/db/migrations/<generated>_cross-cutting.sql
packages/ids/src/{uuid-v7.ts,index.ts}               ← shared by api, worker and the POS
apps/api/src/shared/ports/clock.port.ts
apps/api/src/shared/adapters/system-clock.ts
apps/api/src/shared/idempotency.middleware.ts
```

**Required behaviour**
- `OutboxWriter` port; the event row is written **inside the caller's transaction**.
- `Clock` and `IdGenerator` are ports. A use case calling `Date.now()` or `crypto.randomUUID()` directly fails review.
- **UUID v7 lives in `packages/ids` (debate C4)**, not in an api-only adapter: the POS generates ids offline in the
  browser and the worker needs them too. The generator takes its time source and secure entropy as parameters (so tests
  are deterministic) and is bound to `@pospay/db`'s existing `IdGenerator` interface at each app's composition root.
  Prefer an already-approved implementation; a new dependency needs an ADR (`CLAUDE.md` §11).

**Idempotency — corrected after review.** A response *hash* cannot reconstruct a response; the first draft of this plan was wrong. The store keeps the **actual replayable response**:

| Column | Purpose |
|---|---|
| `scope_type` + `scope_id` + `operation` + `key` | uniqueness is scoped, not global. `scope_type` is `COMPANY` (every tenant write) or `USER` (bootstrap writes that run before a tenant exists — today only `onboard-company`, whose caller cannot know the new company id). `CHECK` ties `scope_id` to `company_id` / `user_id`; RLS shows `COMPANY` rows by `app_company_id()` and `USER` rows by `app_user_id()` |
| `request_fingerprint` | same key with a **different** body → reject `422`, never replay |
| `response_status`, `response_body` | what a replay actually returns |
| `created_at`, `expires_at` | 24 h retention, swept by a job |

**Coordination — corrected in v4 (debate N1).** v3 said "a crash leaves `IN_FLIGHT`", which contradicts a claim made
inside the business transaction: a crash rolls the claim back with everything else. The mechanism is:

- Claim, business effect, outbox row and stored response commit in **one transaction** (`READ COMMITTED`).
- The claim is `INSERT … ON CONFLICT DO NOTHING` on the scoped unique key. A concurrent duplicate **waits** on the
  uncommitted index entry. When the first commits, the duplicate reads the completed row in a **subsequent statement**,
  checks the fingerprint (different body → `422`) and replays the stored response. When the first rolls back, the
  duplicate proceeds as the first. There is **no persisted `IN_FLIGHT` state** and no crash-recovery sweep.
- Waits are bounded by `lock_timeout`; a lock timeout **while acquiring the key** is rolled back and mapped to a
  retryable `409`. No other database failure is mapped to `409`. These timeouts bound single statements, not the
  whole request. ADR-0003 §3 (`onboard-company`) is amended to match.
- Rows expire after 24 h and are swept by a job.

**Done when:** tests prove (a) a rolled-back transaction leaves no outbox row, (b) a replayed key returns the identical
stored response, (c) the same key with a different body is rejected with `422`, (d) two concurrent identical requests
produce exactly one effect and the second replays the first's response, (e) when the first request rolls back, the waiting
duplicate executes, (f) a key-acquisition lock timeout returns a retryable `409`.

---

### T7b — Worker bootstrap + outbox dispatcher · Size M · depends: T7 · **NEW in v4** · before T9a-1 · ✅ done

**As built**
- Decisions (Waleed, 2026-09-23): ordering is **per aggregate**; a poison event is retried **10 times** with
  exponential backoff (5 s doubling, capped at 1 h) and then **parked** with an error-level log. A parked or waiting
  event holds the later events of its aggregate; other aggregates keep flowing.
- `pospay_dispatcher` is created by `bootstrapRoles` (`POSTGRES_DISPATCHER_PASSWORD`). Migrations
  `0005_…_outbox-dispatcher.sql` (`seq`, `next_attempt_at`, `parked_at`, `consumed_events`) and `0006_…_outbox-dispatcher-rls.sql`
  (role-scoped policies, column grants, `consumed_events` RLS, the sweep function).
- `createOutboxDispatcherDatabase({ url })` → `dispatchBatch(limit, deliver, { leaseMs })`,
  `sweepExpiredIdempotencyKeys(n)`, `ping()`, `close()`. **Lease model:** a short claim transaction takes the head
  event of each aggregate (`FOR UPDATE SKIP LOCKED`), counts the attempt and leases it (`next_attempt_at`, default
  5 min), and commits; delivery runs outside any transaction; each outcome is recorded with `clock_timestamp()` and
  **fenced to its own claim** (`attempts` must still equal its attempt number, event neither published nor parked).
  A crash leaves the event leased until the lease ends, then it is redelivered; an event whose attempts are used up
  that way is parked by the next claim (`last_error = 'LeaseExpired'`) and logged.
- `withTenant(…, { timeoutMs })` is **one absolute deadline for the caller** — pool wait, every statement, commit.
  Past it the call rejects with `TimeoutError`, work still waiting for a connection never starts, and nothing commits
  (checked before `COMMIT`). On the server, `statement_timeout` and `idle_in_transaction_session_timeout` bound every
  statement and every idle gap. The backend is **not** terminated from outside: in PG16 a pid-based
  `pg_terminate_backend` cannot be made atomic with "still the same transaction" and could end another request that
  took over the connection (review of T7b; a reserved-connection variant broke postgres.js). Residual: code that keeps
  issuing short statements after its deadline holds its connection until it returns — but can never commit. The deliverer gives each consumer
  transaction the time left of a 60 s budget and starts no consumer after it.
- The worker lists every event type its version publishes (`KNOWN_EVENT_TYPES`, consumed or not); an unknown type
  is never acknowledged — it fails with backoff so a newer worker takes it.
- **Deploy rule (T13):** worker versions never overlap — the worker is deployed stop-then-start, not rolling. Its
  shutdown waits up to 75 s for the batch in flight (one delivery budget is 60 s), so the orchestrator's stop grace
  period must be longer than 75 s. Consumer ids are unique (checked at startup).
  Publication is per event, not per consumer: a consumer added for an existing event type receives events published
  after it is deployed; applying it to older events is an explicit backfill, never a side effect of redelivery.
  **Consumer rule:** consumers do database work only; a handler awaiting anything else cannot be cancelled.
- Ordering is by `seq` (an identity column: insertion order), not `created_at` (transaction start).
  `appendOutboxEvent` itself takes a transaction-level advisory lock on the aggregate before inserting, so a second
  producer of the same aggregate waits for the first to end: `seq` order is commit order, enforced, not a convention.
- Consumers call `markEventConsumed(tx, consumerId, eventId)` in the effect's transaction. The event id is `outbox.id`.
- `apps/worker`: NestJS + Fastify for `/health` and `/ready` (app pool, dispatcher pool + role, Redis);
  `createDispatchLoop` (poll 1 s, drain, sweep due-checked between batches, every 10 min); a delivery over 60 s is a
  failed attempt; shutdown stops polling before closing the pools. No consumer is registered yet.
- **Deferred:** BullMQ. Nothing enqueues a job in Phase 0 yet, so the worker holds a plain `ioredis` connection for
  `/ready`; the BullMQ dependency, its ADR pin and its connection arrive with the first job.

**Why here, not in T13 (debate C3).** T8 and T9a publish events; with no dispatcher until T13, delivery bugs would
surface at the very end. The worker's image and deployment stay in T13.

**Files**
```
apps/worker/src/{main.ts,worker.module.ts,health.controller.ts}
apps/worker/src/outbox/**                          ← dispatcher: poll → publish → mark published
packages/db/migrations/<generated>_outbox-dispatcher.sql
```

**Worker bootstrap requirements (moved from T13).** `main.ts` on NestJS; `/health` (process alive, no dependency checks)
and `/ready` (Postgres and Redis reachable — tested to go non-200 when either is down); the BullMQ connection; graceful
shutdown that stops polling before closing pools.

**Database access stays inside `packages/db` (debate C11 rule).** The dispatcher does not open its own client:
`packages/db` exports a second, restricted facade — `createOutboxDispatcherDatabase({ url })` — whose only methods
claim a batch of unpublished events, record delivery metadata, and `close()` the pool. Graceful shutdown stops polling
first, then closes the dispatcher database and the BullMQ connection (tested). `apps/worker` supplies the `pospay_dispatcher`
credentials and wires it; no other app imports it, and the "no database client outside `packages/db` /
`packages/auth`" rule stays intact.

**Delivery guarantee — at-least-once, effect-once.** A crash between "published" and "marked published" redelivers.
Every event carries a stable `event_id`. A consumer records its dedupe row **in the same `withTenant(event.company_id)`
transaction as the business effect** — both commit or neither does, so a crash can neither apply an effect twice nor lose
it. Tests crash the consumer on both sides of that commit. The dedupe key is **`(consumer_id, event_id)`**: most events fan
out to several consumers (`docs/module-map.md`), and one consumer's row must never suppress another. A test sends one
event to two consumers and asserts each applies it exactly once. Publication tracking and consumer deduplication are
separate records.

**Scope of "effect-once": database effects only.** An external send (WhatsApp, SMS, e-mail, push, SSE) cannot commit
atomically with a Postgres row. A consumer with an external effect instead writes a **delivery record** in its
transaction (its own outbox) and a sender delivers it with the provider's idempotency key where the provider supports one;
where it does not, the send is **at-least-once** and the delivery record makes a resend visible and bounded. No Phase 0
consumer sends externally; this is the rule `notifications` and `realtime` inherit.

**Cross-tenant access — the `pospay_dispatcher` role (debate N2, ADR-0003 amendment).** `pospay_app` needs a tenant
to read anything, so it cannot drain every company's outbox, and there is no bypass role. A fourth role:

- `NOSUPERUSER NOBYPASSRLS NOINHERIT`, owns nothing, member of nothing; created by `bootstrapRoles`.
- Grants on the `outbox` table **only**: `SELECT`, and `UPDATE` of the delivery-metadata columns only
  (`published_at`, `attempts`, `last_error`). `id` (the event id), `company_id` and `payload` are immutable to it.
- RLS stays **forced** on `outbox`; role-scoped policies `FOR SELECT TO pospay_dispatcher USING (true)` and
  `FOR UPDATE TO pospay_dispatcher USING (true) WITH CHECK (true)` — the one documented exception to the
  helper-based tenant policy rule.
- Reached only through `createOutboxDispatcherDatabase` in `packages/db`, wired by `apps/worker`, never available to
  HTTP handlers. No membership or `PUBLIC` path lets an application role acquire it.
- Schema access: an explicit `GRANT USAGE ON SCHEMA public`; `CONNECT` to the database through its default `PUBLIC`
  grant. Both are listed in T5's reviewed privilege inventory.
- Handlers that apply an event's effect run as `pospay_app` inside `withTenant(event.company_id)`.

**Blocked on (`TODO(spec)`):** ordering scope (per aggregate? per company?) and poison-event handling (attempt limit,
parking, alerting) are business/ops decisions — stop and ask.

**Done when:** tests prove a committed event is delivered and a rolled-back one never is; retries after a failure;
two concurrent dispatchers do not double-apply an effect; a crash after publish and before marking leads to redelivery
with the effect applied once; `pospay_dispatcher` can read `outbox` across tenants and **nothing else**, cannot change
`payload` / `company_id` / `id`, and no application role can assume it.

---

### T8 — `tenancy` use cases · Size L · depends: T9a-4

**Deliverable:** the first real vertical slices.

**Module shape** (exactly as `CLAUDE.architecture.md` §5):
```
apps/api/src/modules/tenancy/
  domain/  use-cases/  queries/  ports/  persistence/  http/  events/
  tenancy.module.ts  index.ts
```

**Use cases:** `create-business/`, `create-branch/`, and nothing else — `registerCompany`, the write `onboard-company` reaches through its own port, already exists from T9a. Company creation is **not** a tenancy use case: the company and its first owner membership are created in one transaction by `onboard-company`.
**Queries:** `list-businesses.query.ts`, `branch-detail.query.ts`

**Each write:** one transaction · `Idempotency-Key` · outbox event inside the transaction · audit log row.
**Events published:** `BusinessCreated`, `BranchCreated`. (`CompanyCreated` is published by `identity`'s `onboard-company`, T9a.)

**Scenarios, written into the slice specs before code:** `TEN-01` happy path per use case · `TEN-02` duplicate `Idempotency-Key` replay · `TEN-03` cross-company `business_id` on branch creation · `TEN-04` user switching to a company they belong to · `TEN-05` user requesting a company they do not belong to.

**API-level isolation proof:** with a real session of company A, requesting company B's id is refused **before** `withTenant(B)` is ever called (asserted by a spy on the wrapper). This is the second half of the phase's success criterion and needs the real sessions from T9a.

The spy alone proves the wrapper was not called with B, not that no other path reached B (debate C11). It is paired with
instrumentation at the sanctioned database boundary asserting that **no tenant-business query executes** for the refused
request; a CI rule that no code outside `packages/db` / `packages/auth` imports a database client; and sentinel rows in
company B that must never appear in any response nor change. These are complementary controls, not a row-level audit.

**Demo data (after T8).** One demo company per vertical, generic names: each is created through `onboard-company`
(company + owner membership) and then `create-business` with its `vertical_type` and `create-branch` — the same audited,
idempotent paths as production, never a raw seed. It needs `create-business`, so it lands with T8, not T9a-4.

**Done when:** `TEN-01`…`TEN-05` pass as integration tests against real Postgres with real sessions, `pnpm lint:boundaries` passes, and the demo data above exists in the dev database.

**As built** (specs `docs/specs/002-tenancy-create-business`, `003-tenancy-create-branch`): `POST /v1/businesses`,
`GET /v1/businesses` (cursor), `POST /v1/businesses/:businessId/branches` (the business moved from the body to the path so
the permission is evaluated at it; the guard refuses another company's business with the uniform 403),
`GET /v1/branches/:branchId`. Settings = vertical template, then client overrides (Waleed). Permissions
`read:businesses:company`, `create:businesses:company`, `create:branches:business`, `read:branches:branch` join the
catalogue (Owner gets them). The access decorators moved to `apps/api/src/shared` — every module may guard its routes
and none may import `identity`. Every write returns `created_at` as Postgres formats it, so a write and a later read
agree byte for byte. The isolation proof spies on all three wrappers: a refused request enters no tenant at all.
Demo data: `pnpm --filter @pospay/api demo:seed` creates one company per vertical through the production routes.

---

### T9a — Identity bootstrap: Better Auth, memberships, guard, feature flags · 4 PRs · depends: T7b · **before T8**

**Creating users in Phase 0.** Sign-up is closed (ADR-0003 §6) and a platform grant needs an existing user, so users
are provisioned by two audited operator scripts in T9a-3:
- `pnpm platform:create-user --email …` creates a user through Better Auth's server API in `packages/auth` (never a
  hand-written insert or password hash) and issues a one-time set-password link. Usable any time, for any number of users.
- `pnpm platform:grant --email … --permission create:companies:platform` grants a platform permission.
Both write to `platform_audit_log` and run only as an operator (`pospay_owner` / `pospay_auth`), never through the API.
A clean deployment runs both once for the first operator; tests use the same scripts to create the two users `ONB-04`
needs. Inviting users **into a company** (membership invitations) is not part of Phase 0 — issue #19.

**T9a-1 as built (ADR-0009):** Better Auth 1.7.5 (email + password, TOTP, sign-up closed) on `pospay_auth`
through the restricted `createAuthDatabase` facade (ESLint-enforced); tables `user`/`session`/`account`/`verification`/
`two_factor` (migrations 0007/0008); `AuthService` + `provisionUser`; `Principal` types + `resolveUserPrincipal`;
`/v1/auth/*` mounted on Fastify; a global `SessionGuard` denies every route without a session unless `@Public()`.
Open `TODO(spec)`: session lifetime, minimum password length, login rate limiting (ADR-0009).

**T9a-2 as built:** tables `permissions` (catalogue), `roles` (PK `(id, owner_key)`), `role_permissions`,
`memberships` and `permission_overrides` (migrations 0009/0010) with the split policies of ADR-0003 §2.2–§2.3;
scopes are `scope_type` + `scope_id`, with generated `scope_business_id` / `scope_branch_id` columns carrying
tenant-qualified FKs. The catalogue and the 13 provisional system roles are seeded from code
(`packages/db/src/access-catalog.ts`, `seedReferenceData`); Owner receives every non-platform permission, the other 12
roles none (`TODO(spec)` D-07); each later slice adds its own permissions there. `apps/api/src/modules/identity`:
`evaluateAccess` (DENY wins at the target, pure), the `AccessReader` port and its Postgres adapter, and three global
guards in order — session, `@Require(permission, { business | branch })` (company from `x-company-id` or the session
hint, refused before any `withTenant` unless an active membership covers it), `@RequiresFeature(flag)`
(`FEATURE_DISABLED`). `@Authenticated()` marks session-only routes; `createApp` refuses to start if a route has none of
`@Public` / `@Authenticated` / `@Require`. **Deferred:** the Redis permission cache (ADR-0003 §4.1) arrives with the
first membership-changing use case (T9a-4), which must invalidate it — until then grants are read per request.

**T9a-3 as built:** `platform_grants` (active grant unique per user and permission; revocation keeps the row with
`revoked_by`/`revoked_at`) and `platform_audit_log` (migrations 0011/0012) — `pospay_auth` reads grants and only
inserts audit rows; grants are written only by `pnpm platform:grant [--revoke]` as `pospay_owner`, grant/revoke and its
audit row in one transaction. `pnpm platform:create-user` creates the user through `packages/auth` with a random,
never-shown password, writes `user.created` to the audit log and prints a one-time set-password link (Better Auth's
reset verification row, `TODO(spec)` lifetime: 1 h). `create:companies:platform` joins the catalogue (never in a tenant
role). Sessions carry active platform grants into `Principal.grants`; `@RequirePlatform(permission)` accepts only a
`platform` grant, resolves no company, and is one of the four access declarations `createApp` requires. The
boundaries ESLint rules were found inert during T9a-2 review (globs rooted at `apps/`) and now run.

**T9a-4 as built** (spec `docs/specs/001-identity-onboard-company/spec.md`): `POST /v1/companies` under
`@RequirePlatform('create:companies:platform')` with `Idempotency-Key`. The `OnboardCompany` use case runs inside
`withNewTenant` → USER-scoped claim → plan check → `CompanyRegistry.register` (adapter → tenancy's `registerCompany`,
the one synchronous cross-module write) → owner membership → `AuditLog` → `CompanyCreated`, one transaction. Migration
0013 adds last-owner protection as a deferred constraint trigger. ONB-01…04 run through the API with real Better Auth
sessions and users made by the operator scripts. The Redis permission cache stays deferred: no use case changes an
existing membership yet, so there is nothing to invalidate; it arrives with the first one.

**Four sequential PRs (debate C7)** — each passes its own gates and leaves unfinished business routes unavailable;
none may commit a company without its owner membership. T8 depends on all four.

| PR | Scope |
|---|---|
| **T9a-1** | Better Auth (email + password, TOTP), the `pospay_auth` pool in `packages/auth`, sessions, principal skeleton, public-route list |
| **T9a-2** | `memberships` / `roles` / `permissions` / `role_permissions` / `permission_overrides` schema; `@Require` guard with DENY-wins at the target scope; `@RequiresFeature` |
| **T9a-3** | `platform_grants` + `platform_audit_log`; the audited `platform:create-user` and `platform:grant` scripts (below); `@RequirePlatform` |
| **T9a-4** | the complete `onboard-company` slice (below) and its scenarios |

**Why split.** T8's API-level isolation proof needs a real session, and its first-owner rule needs memberships. v2 scheduled all of identity after T8, which made T8 unprovable. Full sub-tasks: `docs/PRD.md` P0-T9a.

**Files**
```
packages/auth/src/{config.ts,principal.ts,client.ts,index.ts}
packages/db/schema/identity.ts
packages/db/migrations/<generated>_identity-*.sql    ← Better Auth tables, memberships, roles,
                                                       permissions, role_permissions, overrides,
apps/api/src/modules/identity/**
apps/api/src/modules/identity/ports/company-registry.port.ts             ← owned by the consumer
apps/api/src/modules/identity/persistence/tenancy-company-registry.adapter.ts
apps/api/src/modules/tenancy/{persistence/register-company.ts,index.ts}  ← tenancy's public write, nothing more
packages/contracts/src/identity/onboard-company.ts
```

**First step — the company-registry boundary** (`docs/module-map.md` §3: the consumer owns the interface and its adapter).
- `identity/ports/company-registry.port.ts` — `CompanyRegistry.register(tx, company)`, defined by `identity`, the consumer.
- `identity/persistence/tenancy-company-registry.adapter.ts` — implements it by calling the one write `tenancy` exports from its `index.ts`, `registerCompany(tx, input)`. The adapter is the only file that knows both modules; the arrow `identity → tenancy` is already declared.
- `tenancy` keeps ownership of the `companies` table. `registerCompany` inserts one row inside the caller's transaction and does nothing else.

This lives in T9a, not T8, because T8 depends on T9a.

**Required behaviour**
- Better Auth self-hosted on the Drizzle adapter: email + password and the `two-factor` (TOTP) plugin. Tables classified exactly as ADR-0003 says.
- `memberships` (user-keyed RLS bridge), `roles`, `permissions` (seeded from code), `role_permissions` (with `constraints jsonb`), `permission_overrides` (ALLOW/DENY, reason, granted_by, expires_at), `starts_at` / `ends_at` on memberships — per `09` §11, replacing the single `permission_overrides jsonb` in `SPEC.md` §4.
- `@Require('action:resource:scope')` guard: principal and membership resolved server-side, deny by default, union of applicable memberships with DENY-wins precedence evaluated at the request scope (PRD D-31, **decided** 2026-09-22; ADR-0003 §4). A route without a guard fails CI.
- `@RequiresFeature()` guard reading the company's plan flags plus per-company overrides (seeded rows, no UI).
- **`onboard-company` is a complete slice**, with every requirement T8 has for its own writes:
  - spec `docs/specs/NNN-identity-onboard-company/spec.md` and Zod contract in `packages/contracts`;
  - `POST /v1/companies`, guarded by `@RequirePlatform('create:companies:platform')` backed by the `platform_grants` table, the `pnpm platform:grant` setup script and `Principal.grants` (ADR-0003 §3–§4) — all delivered **in T9a**; whether merchants may later self-onboard is PRD D-34;
  - `Idempotency-Key` in the **`USER` scope** (T7) — the retry cannot know the company id yet; the whole transaction runs inside `withNewTenant(callerUserId, company, fn)` (ADR-0003 §3), which only generates the company id and sets `app.user_id` to the **authenticated caller** and `app.company_id` to the **new company id**. Inside it: claim the `USER`-scoped key first, then `CompanyRegistry.register` (the only company insert), then owner membership + `AuditLog` row + `CompanyCreated` outbox event, all in **one** transaction;
  - last-owner protection on later membership changes.
- **Scenarios** (integration, real Postgres, real session): `ONB-01` happy path → company, owner membership, audit row and outbox event all exist; `ONB-02` the membership insert fails → **no** company row, **no** outbox row; `ONB-03` replayed key → identical stored response, one company; `ONB-04` **two companies created through the API** by two users — the first half of the phase's success criterion, which T5 and T8 then use.
- Role bundles seeded as **provisional** codes (see `SPEC.md` §8 q3).

**Done when:** `ONB-01`…`ONB-04` pass; a real login produces a session; a user with two company memberships can switch only between those two; a guard-less route and a disabled feature are both refused in tests.

---

### T9b — Devices, cashier PINs, remaining auth plugins · Size L · depends: T8

**Full sub-tasks:** `docs/PRD.md` P0-T9b.

**Files:** `packages/db/schema/identity.ts` (extended), `packages/db/migrations/<generated>_devices-pins.sql`, `apps/api/src/modules/identity/**`, `packages/auth/src/{config.ts,plugins.ts}` (phone-number and api-key plugins), `packages/config/eslint/index.js` (hashing-library import ban outside `packages/auth`)

**Required behaviour**
- `packages/auth` is the **only** code that issues or verifies a session, hashes a password, or hashes a PIN — enforced by `no-restricted-imports` on hashing libraries outside the package.
- `phone-number` and `api-key` plugins installed but not wired until a delivery channel (Phase 1) or the public API (Phase 5) exists. `organization` only if ADR-0003 gives it a role.
- `cashier_pins`, `devices` with tenant-qualified FKs to branches. Platform role codes seeded, unused until Phase 5.
- Use cases: `register-device` (pairing code, short Redis TTL), `approve-device`, `revoke-device`, `set-cashier-pin`, `verify-cashier-pin`. Redis rate limits on PIN attempts and login.
- Every sensitive action (PIN change, device approval/revocation, role change, override) writes an `AuditLog` row.

**Decided 2026-09-23** (PRD D-08, D-09; `SPEC.md` §8 q4–q5): cashier PIN of 4 digits, locked after 5 failed attempts for 15 minutes; device token valid 30 days, renewed on every contact, revocable instantly.

**Done when:** PIN verification works against a stored hash, a revoked device is rejected on next contact, membership removal takes effect on the next request, and every sensitive action writes an `AuditLog` row.

**T9b-1 as built:** the credential-hashing import ban (ESLint, tested with the API's real config, `use-cases/` included);
`user.phone_number` / `phone_number_verified` (migration 0014; the `phone-number` plugin is registered with the delivery
channel in P1-T7 — its routes are 404 until then); the `api-key` plugin deferred to P5-T7 because in Better Auth 1.7 it
is a separate package (ADR-0009 amendment); the five platform role codes seeded into their own `platform_roles` table —
never the tenant `roles`, so no company can assign them (`TODO(spec)` D-07, no permissions until Phase 5). Devices (T9b-2) and cashier PINs (T9b-3) follow.

**T9b-2 as built:** `devices` (tenant data, RLS, no DELETE — a device is revoked and kept; migrations 0017/0018) holding
only hashes. A manager with `manage:devices:branch` issues a pairing code (8 characters, single use, **10 minutes** —
Waleed 2026-09-23, Redis `GETDEL`); `POST /v1/devices/register` (public, rate-limited) records the device PENDING and
returns a one-time claim secret; the manager approves; `POST /v1/devices/claim` (public, rate-limited) returns the token
`pd_<company>.<device>.<secret>` exactly once. Every request with `Authorization: Device …` is proven inside the
company it names (a forged company finds no row), refused unless ACTIVE and unexpired, and renewed for 30 days (D-09);
revocation erases the token, so the next contact is 401. Secrets are made and checked in `packages/auth`. Audit rows for
every step; `DeviceRegistered` / `DeviceRevoked` in the outbox. The fixed `device` system role is seeded without
permissions until sync, catalogue and clock-in exist. `TODO(spec)`: the public-route rate limit (10 per minute per
client address until decided).

**T9b-3 as built:** `cashier_pins` (tenant data, RLS, no DELETE — a PIN is replaced; migrations 0019/0020), one per
employee per company, `employee_id` a plain column until `staff` exists (ADR-0003 §4.2). `set-cashier-pin` (use case
only — no route until staff, so only fixtures get a PIN) stores a salted PBKDF2-SHA256 hash made in `packages/auth`
and audits `cashier_pin.set` / `cashier_pin.changed`. `POST /v1/devices/me/cashier-pin/verify` answers an approved
device only (a user session is 403) with the employee id; a wrong PIN and an unknown employee are the same 401
`PIN_INVALID`, and another company's PIN is invisible under RLS. D-08 in Redis, by atomic scripts: a comparison is
reserved before it starts (each reservation expiring on its own after a minute) and refused (429) while failures plus
live reservations reach five, so a burst can never make more than five failures, and a stalled comparison that outlives
its reservation changes nothing; the fifth failure sets a lock with its own 15 minutes (423 `PIN_LOCKED`, even for the
right PIN), audited `cashier_pin.locked`; the right PIN clears earlier failures but never a newer lock. The PIN never reaches a
log line (tested). A test proves an ended membership is refused on the very next request. Still open: the principal
taking the employee's memberships after a PIN (with the operator credential, P2-T9) and the device pulling PIN hashes
with the catalog snapshot (P2).

---

### T10 — `settings` + `packages/i18n` · Size M · depends: T8

**Files**
```
packages/db/schema/settings.ts · packages/db/migrations/<generated>_settings.sql
apps/api/src/modules/settings/**
packages/i18n/src/{ar.ts,en.ts,format-kwd.ts,dates.ts,index.ts}
```

**Required behaviour:** `formatKwd(12500n) === '12.500'`. Dates follow the business's Gregorian/Hijri setting and the branch timezone. Error envelopes carry both languages.

**Decided 2026-09-23** (PRD D-02, D-10): the name PosPay stands in the templates; the branch timezone is `branches.timezone`, falling back to the business's.

**Done when:** the formatter tests pass and no hardcoded Arabic or English string exists outside `packages/i18n`.

**T10-1 as built:** `packages/i18n` (Node and browser, `Intl` only, depends on `packages/domain`): `formatKwd`
(`12500n` → `12.500`, thousands grouped, sign kept, Latin digits, delegating to `moneyToString` so the shown number is
the stored one); `formatDate` (Gregorian or Hijri Umm al-Qura, in the branch time zone), `localDate` (the branch's day,
not UTC's — what attendance and reports group on) and `isTimeZone`; the ar/en catalogs, typed so a key missing from
either fails the build, with `t()` and `errorMessages()`. Every API error message and the worker's readiness message
moved into the catalogs — `apps/api/src/shared/errors.ts` now holds only the HTTP status per code, and a code with no
message does not compile. ESLint refuses any string holding Arabic outside `packages/i18n` (tests and the reference
seed's `name_ar` data excepted). `TODO(spec)`: Arabic-Indic digits for display, if the client wants them. T10-2
(settings, `branches.timezone`) follows.

**T10-2 as built (D-10):** `branches.timezone` (nullable, migration 0021) — the branch's own IANA zone, or null to use
its business's. `create-branch` accepts an optional `timezone` (the contract's closed IANA list, so an unknown zone is a
400 before any write); `Branch` carries `timezone` and `effective_timezone`, computed by `domain/time-zone.ts` on write
and by the same rule in SQL on read. T10-3 (the `settings` module) follows.

**T10-3 as built:** the `settings` module. `business_settings` (tenant data, RLS, PK `(company_id, business_id)` with
a tenant-qualified FK, no DELETE; migrations 0022/0023) holds only what a business changed — every null column means
"the template's", so a template change reaches every business that kept it (Waleed 2026-09-23). The template today is
Arabic and Gregorian for every vertical (`TODO(spec)`: the default calendar). `GET /v1/businesses/:id/settings`
(`read:settings:business`) is `queries/business-settings.query.ts` behind a Redis cache whose entries are keyed by a
generation; `PATCH` (`manage:settings:business`) sets a value, or returns it to the template with `null`, audits before
and after, and replaces the generation (a fresh UUID, never reused) once committed — the next read sees the change, and a read that raced the write
cannot store the old value where a later read looks (both tested, both tests fail without the fix). The first write
creates the empty row before reading it, so two first writes queue on one row lock and each audits its real before. `tax_rule`
is stored and read (null = no tax) but has no write route until P2-T4 (PRD D-27). `TODO(spec)` for their own slices:
invoice template, order rules, payment methods, delivery zones (P1/P2); opening hours already live on the branch.

---

### T11 — `packages/observability` · Size M · depends: T6b

**Files:** `packages/observability/src/{request-context.ts,otel.ts}` (pino and redaction already exist from T6b)

**Required behaviour**
- Every log line carries `request_id`, `company_id`, `branch_id` (when present), `user_id`.
- Extends the T6b redaction list with gateway and messaging credentials as those integrations arrive; it is still configured once.
- No request/response bodies in normal operation — only on error, after redaction.
- Trace sampling: 10% of normal requests, 100% of anything that errored or took over a second.

**Done when:** a test asserts that a deliberately logged PIN does not appear in the output.

**As built:** `packages/observability/src/request-context.ts` — an `AsyncLocalStorage` context entered in the API's
`onRequest` hook; pino's `mixin` adds `request_id` to every line, and `company_id`, `branch_id`, `user_id` once the
session and access guards verify them. The request id is the caller's `X-Request-Id` when it is a plain token
(`[A-Za-z0-9._-]{8,128}`), otherwise a UUID v7, and is echoed in the response. The PIN test found a real gap —
`pin_code` was not redacted — so `*pincode`, `*passcode`, `*otpcode`, `*securitycode`, `*verificationcode` joined the
secret suffixes (`error_code` / `status_code` stay visible). **Deferred:** `otel.ts` and the trace-sampling rule —
`06` §2 says "OpenTelemetry later", and `06` wins on technology; they arrive with an ADR when `06` schedules them.

---

### T12a — Minimal CI · Size S · depends: T1 · 🟡 CI live — branch protection due before T5 merges

`.github/workflows/ci.yml` runs **`pnpm check`** on every PR and on `main`: `turbo run typecheck lint test` (lint
includes `max-lines`, `boundaries` and the Arabic JSDoc rules) then `pnpm lint:docs`. Since T4 it starts the T2
compose stack first (ADR-0006), so every package's database tests — T5's isolation and privilege suites included —
are **required** on every PR from the moment they exist. **Still open, and due before T5 merges:** branch protection on
`main` requiring this check and blocking direct pushes. Because CI skips docs-only PRs (`paths-ignore`), a lightweight
job that always runs must report the required status on those PRs, or they could never merge.

---

### T12b — Full gate · Size M · depends: T8

**Files:** `.github/workflows/ci.yml` (extended), `.github/workflows/build.yml`, `scripts/module-map/*`

**Gate order — exactly this:**
```
typecheck → lint → lint:docs → boundaries → cycles → module-map →
unit (domain) → integration → RLS negative tests → EXPLAIN checks →
build all apps → docker images
```

- **Activation:** each gate becomes required in the PR that first gives it something to check — cycles, module-map,
  the generated YAML and the write-exception check with **T9a-4** (`identity → tenancy` and `registerCompany` are the
  first cross-module arrow and write); EXPLAIN checks with the first `queries/` file; **build** with each app (T6b for
  `api`, T7b for `worker`); **docker images** with the Dockerfiles in T13. T12b turns the remaining ones on and fixes
  the order.
- **Module map (debate C6):** `docs/module-map.md` stays authoritative; `docs/module-map.yaml` is **generated** from it
  deterministically and CI fails when the committed YAML is stale. The single synchronous write exception
  (`identity`'s `CompanyRegistry` → `tenancy`'s `registerCompany`) is represented as its own entry — an
  `identity → tenancy` arrow alone does not authorise any synchronous write.
- Images tagged by **commit SHA**, never `latest`, pushed to GHCR. A deliberately-broken fixture PR confirms the
  boundary and module-map steps actually block.

**Done when:** the required checks on `main` cover every gate activated up to T12b — all of the above except docker
images, which T13 activates (T12a made the first check required before T5); and
a PR violating a module boundary, adding an undeclared arrow, or making a second synchronous
cross-module write is blocked by CI.

**As built:** `ci.yml` runs the gates as separate steps in this order — typecheck → lint (max-lines + boundaries) →
lint:docs → cycles · module-map → unit (domain) → integration · RLS negative · EXPLAIN → build all apps — inside the
one job `ci-gate` requires, so branch protection needs no new check. `scripts/module-map/`: `pnpm module-map:generate`
writes `docs/module-map.yaml` from the §6 block (both files count as code in CI's change detection);
`pnpm module-map:check` reads every import with the TypeScript compiler (static, `export … from`, `import()`,
`require`, side-effect, type-only) and resolves it with the project's tsconfig (aliases, `.js` specifiers). It fails on
a stale YAML, a deep import, an undeclared arrow, a restricted package outside its owners, app-level code other than
the composition root importing a module (no bridges), a module re-exporting or forwarding another module's value,
file cycles across apps and packages, package cycles, module cycles, and any cross-module **value** import that is not
the declared `sync_writes` entry (or a declared `reads` entry) for that exact file — so a second synchronous write
cannot land without a row in §3.1. `node --test scripts/module-map` proves each of those blocks, and lints violating
files through the API's real ESLint config (http → domain, a deep import) to prove the boundaries rules block too.
Docker images remain T13.

---

### T13 — Staging deploy + backups · Size L · depends: T9b, T10, T11, T12b

**Deliverable:** a staging environment that can be rolled back, and a backup that has been restored.

**Files:** `deploy/docker-compose.staging.yml`, `deploy/Dockerfile.api`, `deploy/Dockerfile.worker`, `deploy/backup/*`

**Required behaviour**
- Dokploy + Traefik. Migrations run as **their own step before** new containers start.
- Multi-stage builds on `node:24-alpine` (ADR-0002), production dependencies only.
- The **worker image and deployment** ship here; the worker itself and the outbox dispatcher were built in **T7b**.
- **No Chromium and no Arabic fonts in the worker image yet** — document rendering is out of scope for Phase 0 (`SPEC.md` §2). They arrive in Phase 5 with `packages/documents`, and the memory limit is set then.

**Backups — corrected after review.** `pg_dump` + archived WAL is **not** point-in-time recovery: WAL replay needs a *physical* base backup, not a logical dump. The two are different recovery paths and both are specified:

| Path | Method | Recovers |
|---|---|---|
| Logical | nightly `pg_dump`, encrypted to B2 via `restic` | whole-database restore to last night |
| Physical / PITR | `pgBackRest` or `wal-g`: `pg_basebackup` + continuous WAL archiving | any point in time since the base backup |

- Stated objectives: **RPO ≤ 5 minutes, RTO ≤ 2 hours.** Both are tested, not assumed.
- Both jobs check in to Healthchecks.io; a missed check-in alerts.
- Secrets injected from Dokploy. Nothing sensitive in Git, ever.

**Rollback — corrected after review.** A SHA-tagged image rollback does **not** undo a schema change. Expand/contract already forbids destructive migrations in the same release; T13 adds the proof: after every migration, run the **previous** image against the **new** schema in staging and confirm it still serves. If it cannot, the migration was not expand-safe.

**Decided 2026-09-23** (PRD D-11): staging runs on the existing server for now, beside production; both move to a new server when it is bought.

**Done when:** the docker-image build is a required check on `main` (the last gate from T12b's list); a staging deploy succeeds from a SHA-tagged image, the previous image still runs against the new schema, and **one PITR restore has actually been performed** to a chosen timestamp and queried.

**T13-1 as built (images, no server touched):** `deploy/Dockerfile.api` (targets `api` and `migrate`) and
`deploy/Dockerfile.worker`, multi-stage on `node:24-alpine`, `pnpm deploy --prod` so only production dependencies
ship, running as `node`, with a `/health` healthcheck; the worker has no Chromium and no fonts. `.dockerignore` keeps
every `.env` out of the build context, and CI proves no image contains one. CI's `docker images` job builds all three
on every code change and pushes them to GHCR tagged by the commit SHA from `main` only; `ci-gate` requires it, so the
image build is a required check on `main`. `deploy/docker-compose.staging.yml`: Postgres 16 and Redis 7 with the dev
limits, `migrate` as a one-shot step the API and worker wait on (`service_completed_successfully`), memory limits and
restart policies everywhere, no host ports (Dokploy's Traefik routes), every secret `${VAR:?}` so a missing one stops
the deploy. Rehearsed locally end to end with throwaway secrets: migrate exits 0, API and worker healthy and ready, an
unauthenticated route 401. **T13-2 (on the server, with Waleed's go-ahead):** Dokploy project, secrets, subdomains, the
previous-image-on-new-schema check, and the backups (restic + pgBackRest) with their timed restores.

**T13-2 as built (staging live, 2026-09-24):** `https://staging.pospay.systems` on the existing server, beside the
"paypossystem" project whose Postgres 18 and Redis 8 it shares on `dokploy-network` (database `PayPos`, its own roles
and passwords) — `deploy/docker-compose.staging-shared.yml`, deployed over SSH by `deploy/staging-deploy.sh <sha>`
from `/opt/pospay-staging` (mode 700, `.env` mode 600 generated on the server). Dokploy's Traefik routes the host with
a Let's Encrypt certificate and redirects HTTP to HTTPS. First deploy, SHA `3ccc422`: migrate exited 0 on an empty
database, API and worker healthy, `/ready` 200 with database, auth and Redis up, a guarded route 401. The images were
carried to the server as a `docker save` archive (the GHCR packages are private and the server holds no registry
token). The previous-image-on-new-schema check has no previous image yet; it runs from the second deploy on.

**Backups, logical path as built (no server touched):** the restic repository is a Cloudflare R2 bucket, not B2
(Waleed 2026-09-24). `deploy/Dockerfile.backup` (`postgres:<major>-alpine` + restic, `PG_MAJOR` matching the server)
runs `deploy/backup/logical-backup.sh`: `pg_dump --format=custom` as the migration owner through restic's
`--stdin-from-command`, so a failed dump saves no snapshot; retention 14 daily / 8 weekly / 6 monthly; Healthchecks.io
start / success / fail check-ins. `restore-check.sh` restores a snapshot into a scratch database, counts rows, times it
against the RTO and drops it. Rehearsed on the dev Postgres: backup, restore in 5 s, and a failed dump exiting 1 with
no new snapshot. CI builds, leak-checks and pushes the image with the others. **Still open, each on the server with
Waleed's go-ahead:** the R2 bucket and token, the nightly cron, the physical/PITR path (it changes the shared
Postgres's `archive_command`), and the one real PITR restore.

---

## 2. Dependency order — revised (v4)

```
T0 ─ T1 ─┬─ T2 ─┐
         └─ T3 ─┴─ T4 ─ T6a ─ T5 ─ T6b ─┬─ T7 ─ T7b ─ T9a-1 ─ T9a-2 ─ T9a-3 ─ T9a-4 ─ T8 ─┬─ T9b
                                        │                                                └─ T10
                                        └─ T11
            T1 ─ T12a (runs on every PR, grows with each task)                  T8 ─ T12b ─ T13
```

- **v4:** T7b (worker + outbox dispatcher) moves up from T13 and runs **before** T9a (serial, like everything else); T9a is four PRs; T12a's CI is live and branch protection lands before T5 merges; T12b switches the remaining gates on (`DEBATE-2026-09-23.md`). Done so far: T0–T4, T6a; T12a's CI is live, its branch protection is not.

- **T0** now precedes everything. The auth ↔ RLS boundary is a schema decision, not a T9 detail.
- **T6 splits.** `CLAUDE.md` §1 mandates *contract → migration*, and the first draft had the schema (T5) before the contracts (T6), contradicting the project's own rule. **T6a** (Zod contracts for tenancy) moves **before** T5; **T6b** (the NestJS app, filter, health, OpenAPI) stays after it.
- **T12 splits.** A minimal CI — typecheck, lint, unit — runs from **T12a at T1**, otherwise "every rule is a CI gate" is false for the first two weeks of PRs. **T12b** adds the full gate once there is something to gate.
- **T9 splits (v3).** **T9a** (Better Auth, memberships, guards, feature flags, `onboard-company`) moves **before** T8, because T8's API-level isolation proof needs real sessions and its first-owner rule needs memberships. **T9b** (devices, PINs, remaining plugins) stays after T8.
- **T13 depends on T9b, T10 and T11**, not only on T12. Staging must not be declared done while the worker, i18n and observability are missing.
- **Redaction moves earlier.** The pino redaction list lands with **T6b**, not T11. Adding it after real requests have been logged means the exposure already happened.

**Critical path:** T0 → T1 → T3 → T4 → T6a → T5 → T6b → T7 → T7b → **T9a-1 → T9a-2 → T9a-3 → T9a-4** → T8 → T9b → T12b → T13

T11 can run in parallel with T7–T8; it touches no module code.

> **Serial by default.** `SPEC.md` §5 says a slice is not started until the previous one is green. Parallelism here is the single exception named above (T11), and only because it shares no files. An agent must not infer permission to parallelise anything else.

---

## 3. Schedule — re-forecast in v4

The first draft said 4 weeks; v2 said 6–8. The v2 table is kept below as history. **v4 re-forecasts the remaining work
from what T3, T4 and T6a actually cost** (debate C10): typing was fast; verification was not — T4 took 9 review rounds,
T6a 5. Each remaining task is therefore costed as *build* plus an explicit *review/rework* allowance.

| Task | Build | Review / rework | Why that allowance |
|---|---|---|---|
| T5 | 2 d | 2 d | RLS + privilege inventory is the phase's security core |
| T6b | 1 d | 0.5 d | framework wiring, redaction tests |
| T7 | 1.5 d | 1.5 d | concurrency (idempotency waits, outbox in-transaction) |
| T7b | 1.5 d | 1.5 d | new role + delivery guarantees + crash tests |
| T9a-1 … T9a-4 | 5 d | 4 d | auth and authorization — the plan's top risk |
| T8 | 2 d | 1 d | first tenancy slices + isolation proof |
| T9b | 2 d | 2 d | PINs, devices, rate limits — D-08 / D-09 decided 2026-09-23 |
| T10 · T11 | 2 d | 1 d | D-02 / D-10 decided 2026-09-23 |
| T12b | 1 d | 0.5 d | gates + fixture PR |
| T13 | 2.5 d | 1.5 d | staging, PITR rehearsal — D-11 decided 2026-09-23 |

**Remaining ≈ 20.5 build days + 15.5 review days = 36 working days ≈ 7 weeks** from 2026-09-23. The decisions it once waited on
(D-02, D-08, D-09, D-10, D-11) were all taken on 2026-09-23. D-34 (merchant self-onboarding) does not block Phase 0: ADR-0003
already authorises Phase 0 onboarding through `create:companies:platform`. This is an estimate, not a commitment; re-forecast after T5 and
after T9a-4 with actuals.

<details><summary>v2 week table (history — superseded)</summary>

| Week | Tasks |
|---|---|
| 1 | T0 · T1 · T2 · T3 · T12a |
| 2 | T4 · T6a · **T5** |
| 3 | T5 (isolation suite) · T6b · T7 |
| 4 | T7 · T9a |
| 5 | T9a · T8 |
| 6 | T9b · T10 · T11 |
| 7 | T12b · T13 |
| 8 | buffer — open questions, rework, the PITR rehearsal |

</details>

The 3–4 weeks in `06_Tech_Stack_Architecture_EN.md` §7 was optimistic and should be updated to match — deliberately, not silently.

**Most likely to overrun: T9a + T9b** (Better Auth + identity) — 13 working days together in the table above (T9a 9, T9b 4), against the 2–3 first assumed. AI accelerates writing code far more reliably than it accelerates verifying security.

---

## 4. Revision log

**v4 — 2026-09-23.** Claude ↔ Codex `gpt-6-astra` (high) debate after building T1–T4 and T6a; full record in
`DEBATE-2026-09-23.md`. Nothing left disputed.

| Change | Why |
|---|---|
| T5 policies defer to ADR-0003 (helpers, split policies, explicit `WITH CHECK`, `companies` keyed on `id`, no DELETE) | v3's blanket `current_setting(...)::uuid` rule contradicted ADR-0003 and raises `22P02` |
| T5 seeds only the provisional plan + vertical templates; demo companies move to T8, via `onboard-company` then `create-business` | an owner-less company violates ADR-0003 §5.3 |
| T5 closes #16 with a reviewed privilege allowlist + effective-access tests; its suites are required CI checks | a migration's own grant must not authorise itself |
| Migrations named by purpose; files generated as `NNNN_<UTC date>_<name>.sql` | ADR-0006; drizzle-kit owns the number |
| T6 → T6a (done) + a real T6b section; pino + redaction in T6b, T11 no longer owns it | the old T6 section was stale |
| T7: UUID v7 in `packages/ids` with injected time/entropy | the POS and worker need ids too |
| T7 idempotency: one transaction, unique-index coordination, no persisted `IN_FLIGHT`, lock-timeout → `409` | v3's crash-leaves-`IN_FLIGHT` contradicted its own single transaction |
| **New T7b** (before T9a): worker bootstrap + outbox dispatcher (at-least-once, effect-once), the `pospay_dispatcher` role behind a `packages/db` facade | delivery bugs would otherwise surface only in T13; `pospay_app` cannot discover tenants |
| T9a → four PRs | too large to review as one |
| T8 isolation proof: spy + DB-boundary instrumentation + no-other-client rule + sentinel rows | a spy alone proves too little |
| T12a / T12b real sections; generated `module-map.yaml` with the write exception as its own entry | `module-map.yaml` did not exist; gates had no activation points |
| T13 keeps the worker image/deploy only | the worker moved to T7b |
| Schedule re-forecast from actuals: ≈ 36 working days remaining, build + explicit review allowance per task | T4 took 9 review rounds, T6a 5 |


**v3 — 2026-09-22.** Synced with `docs/PRD.md` v1.1 §13 items 4, 7, 12 and 22 (itself revised after a second Codex review, `docs/PRD-CODEX-REVIEW.md`).

| Change | Why |
|---|---|
| **T9 → T9a (before T8) + T9b (after T8)** | T8's API-level proof needs real sessions; `onboard-company` needs memberships |
| Company creation moves from `tenancy` to `identity`'s `onboard-company` | a company is never ownerless, and no undeclared `tenancy → identity` write |
| T8 gains scenarios `TEN-01`…`TEN-05` and the spy-on-`withTenant` proof | the success criterion's second half, made testable |
| ADR for T0 is **0003**, not 0001 | 0001 and 0002 were already taken |
| `node:24-alpine`, not 22 | ADR-0002 pins Node 24 |
| Duplicate `## 4.` heading fixed | — |
| `SPEC.md` §8 q2 and q3 no longer block the schema | provisional seeds; renaming later is a data migration |

**v2 — 2026-09-17.** Adversarial review by Codex `gpt-6-astra` (effort `high`); full text in `CODEX-REVIEW.md`. Verdict on v1: **NEEDS REVISION**.

**Accepted and applied**

| # | Finding | Change |
|---|---|---|
| 1 | Auth bootstrap cannot work under blanket RLS | **New T0** + ADR-0001; `CLAUDE.md` §5 needs a named exception |
| 2 | "Cross-tenant write errors" was factually wrong | T5 assertions rewritten: UPDATE affects 0 rows, INSERT is rejected by an explicit `WITH CHECK` |
| 3 | Plain UUID FKs cross tenants freely | Tenant-qualified composite foreign keys, plus an assertion |
| 4 | Tests ran as the owner, not the app role | T5 now runs as a restricted role and asserts `NOSUPERUSER` / `NOBYPASSRLS` / no ownership |
| 5 | Response *hash* cannot replay a response | T7 idempotency store rewritten: status + body, scoped uniqueness, `IN_FLIGHT` handling |
| 6 | Contracts scheduled after the schema | T6 split; T6a moves before T5 |
| 7 | `pg_dump` + WAL is not PITR | T13 separates logical and physical paths, adds RPO/RTO and a rehearsal |
| 8 | SHA rollback does not undo a migration | T13 adds an old-image-against-new-schema check |
| 9 | Worker deployed but never built | Worker bootstrap + outbox dispatcher moved into T13 |
| 10 | Chromium in an empty worker | Removed; returns in Phase 5 |
| 11 | CI arrives too late to gate early PRs | T12 split; T12a starts at T1 |
| 12 | 4 weeks not credible | Reforecast to 6–8 weeks |
| 13 | Redaction after first real logs | Moved to T6b |
| 14 | Unused platform bypass role | Deferred out of T4 |
| 15 | Missing branch-timezone source of truth | Raised as open question 7 in `SPEC.md` §8 |

**Rejected, with reasons**

| Finding | Why not |
|---|---|
| Defer `EXPLAIN` assertions entirely | `CLAUDE.md` §9 mandates them. Softened instead: assert index usage, not timings, and seed enough rows to make the plan meaningful. |
| Product naming should not block T10 | Agreed it should not block the *formatters*, and it no longer does — but it still blocks the invoice header, so it stays an open question. |
| Drop Better Auth's unused plugins now | `phone-number` is needed in Phase 1 for employee OTP. Kept, but not wired until a delivery channel exists. |

---

## 5. Where the implementer must stop and ask

- Any `TODO(spec)` question in `SPEC.md` §8 or `docs/PRD.md` §11 that blocks the current task
- Any need for a dependency arrow not already in `docs/module-map.md`
- Any temptation to add a library not named in `06_Tech_Stack_Architecture_EN.md` §1
- Any case where a rule in `CLAUDE.md` appears to conflict with this plan — **the rule wins, and the plan is wrong**

---

## 6. Known risks

| Risk | Why it matters | Mitigation in this plan |
|---|---|---|
| RLS looks right but is bypassable | Silent cross-tenant leak — the worst possible bug | Four negative assertions in T5, run in CI on every PR |
| Better Auth's Drizzle adapter fights our RLS | Login runs before a tenant is known | T0 (ADR-0003) classifies every auth table before any schema; T9a proves real login against RLS before T8 relies on it |
| Idempotency added later | Retried POSTs double-create orders in Phase 2 | T7 ships it before the first real write, `onboard-company` in T9a-4 |
| CI added at the end | Rules go unenforced for weeks and drift accumulates | T12a has run `pnpm check` on every PR since T1, on the compose stack since T4; T12b switches on the rest |
| Backups configured but never tested | An untested backup is a hypothesis, not a backup | T13 is not done until one restore has been performed |
