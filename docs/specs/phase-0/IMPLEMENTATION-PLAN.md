# Phase 0 — Implementation Plan

> **Status:** v3 · 2026-09-22 · synced with `docs/PRD.md` v1.1 (§13 item 22)
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

### T0 — Auth ↔ RLS bootstrap decision · Size S · depends: — · **NEW, blocks T5**

**Why this exists.** The adversarial review found a hole that scheduling cannot fix: **login happens before a tenant is known.** A user signs in, *then* we discover which companies they belong to. So Better Auth's own queries cannot run inside `withTenant()` — there is no company id yet. And a user may belong to several companies, so stamping one `company_id` on an auth row misrepresents the relationship.

Deciding this *after* the schema is written means rewriting the schema. It is therefore T0, not part of T9.

**Deliverable:** `docs/adr/0003-auth-rls-boundary.md` (0001 is the domain topology ADR, 0002 the tooling baseline), plus the table classification it produces.

**The decision to make — proposed answer, to be confirmed:**

| Group | Tables | RLS |
|---|---|---|
| **Global identity** | Better Auth's `user`, `session`, `account`, `verification` | **No `company_id`, no tenant RLS.** These are identity, not tenant data. Reached only through a narrowly-privileged auth role that can touch these tables and nothing else. |
| **The bridge** | `memberships` (ours) | RLS keyed on the **user**, not the company: `USING (user_id = current_setting('app.user_id')::uuid)`. This is what lets a just-authenticated user discover their companies without already having one. |
| **Tenant data** | everything else | RLS on `company_id`, exactly as `CLAUDE.md` §5 says |

**Request flow this produces:** authenticate (global) → read memberships as the user → resolve the requested company and **verify membership server-side** → `withTenant(companyId, …)` for all business data.

**Consequences to write into the ADR:**
- `CLAUDE.md` §5 currently says *all* DB access goes through `withTenant()`. That sentence needs an explicit, named exception for the auth path. Amend the rule — do not quietly break it.
- The auth role gets **no** `BYPASSRLS`. It gets table-level grants on the global identity tables only.
- Auth-handler routes are exempt from the guard rule and must be **listed explicitly** as public; controller scanning will not classify them for us.
- Decide whether authorization lives in Better Auth's `organization` plugin or in our `memberships` table. **Two authorities is a bug** — pick one. Proposed: our `memberships` owns authorization; the plugin is used for nothing it duplicates.

**Done when:** the ADR is written and the table classification is agreed, before a single migration is generated.

---

### T1 — Workspace skeleton · Size S · depends: —

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

### T2 — Local infrastructure · Size S · depends: T1

**Deliverable:** Postgres 16 and Redis 7 running locally.

**Files:** `deploy/docker-compose.dev.yml`

**Notes:** named volumes, `healthcheck` on both services, Postgres tuned with `statement_timeout` and a connection limit so a runaway query cannot starve the API later.

**Done when:** `docker compose -f deploy/docker-compose.dev.yml up -d` runs and both healthchecks report healthy.

---

### T3 — `packages/domain` · Size M · depends: T1

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

### T4 — `packages/db` foundation · Size M · depends: T2, T3

**Deliverable:** the only sanctioned path to the database.

**Files**
```
packages/db/drizzle.config.ts
packages/db/src/{client.ts,with-tenant.ts,index.ts}
packages/db/scripts/{migrate.ts,seed.ts}
```

**Required behaviour**
- `withTenant(companyId, fn)` opens a transaction and sets `app.company_id` via `set_config(..., true)` so it is transaction-local.
- **`index.ts` must not export the raw Drizzle client.** Modules receive `tx` only. A test asserts this.
- A separate DB role that bypasses RLS exists for the future `platform` module but is **not** wired to anything yet.

**Done when:** a throwaway migration applies, and a test proves the raw client is not reachable from outside the package.

---

### T5 — `tenancy` schema + RLS ⭐ · Size L · depends: T4

**Deliverable:** the phase's success criterion, proven.

**Files**
```
packages/db/schema/tenancy.ts
packages/db/migrations/0001_tenancy.sql
packages/db/src/__tests__/rls-tenancy.spec.ts
```

**Tables:** `plans`, `companies`, `businesses`, `branches`, `company_feature_overrides` — per `SPEC.md` §4. The overrides table is here, not in `identity`, because `tenancy` owns plans and feature flags (`SPEC.md` §3); T9a's `@RequiresFeature()` guard only reads it.

**Every table gets:** `company_id uuid NOT NULL`, an RLS policy `USING (company_id = current_setting('app.company_id')::uuid)`, `FORCE ROW LEVEL SECURITY`, and a composite index starting with `company_id`.

> `plans` is the one exception — it is platform-level reference data, not tenant data. It carries no `company_id` and no RLS policy. Call this out in an ADR so the exception is deliberate and visible.

**Negative tests (testcontainers, real Postgres) — revised after review:**

Run the whole suite **as the restricted application role**, not as the owner or a superuser.

*Role assertions*
- the app role is `NOSUPERUSER`, `NOBYPASSRLS`, owns no tenant table, and cannot `SET ROLE` to a privileged role
- `plans` is readable but **not** writable by the app role

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

> **What RLS cannot do:** `withTenant(B, …)` legitimately reaches company B. The database cannot tell an authorised company id from an attacker-supplied one. That check belongs to the API layer and is tested in **T8**, not here.

**Done when:** every assertion above passes as the restricted role and is wired into `pnpm test`.

---

### T6 — `packages/contracts` + `apps/api` skeleton · Size M · depends: T5

**Deliverable:** a running API with a typed contract layer.

**Files**
```
packages/contracts/src/{tenancy/*.ts,errors.ts,index.ts}
apps/api/src/{main.ts,app.module.ts}
apps/api/src/shared/{exception.filter.ts,health.controller.ts}
```

**Required behaviour**
- NestJS on the **Fastify** adapter.
- Global exception filter emitting `{ code, message_ar, message_en, details? }`.
- `/health` (process alive) and `/ready` (DB + Redis reachable) — they are different checks.
- `pnpm contracts:openapi` generates the spec from the Zod schemas.

**Done when:** `GET /health` returns 200 and the OpenAPI file is generated.

---

### T7 — Cross-cutting write primitives · Size M · depends: T6

**Deliverable:** the machinery every later write depends on.

**Files**
```
packages/db/schema/{outbox.ts,audit-log.ts,idempotency.ts}
packages/db/migrations/0002_cross_cutting.sql
apps/api/src/shared/ports/{clock.port.ts,id-generator.port.ts}
apps/api/src/shared/adapters/{system-clock.ts,uuid-v7-generator.ts}
apps/api/src/shared/idempotency.middleware.ts
```

**Required behaviour**
- `OutboxWriter` port; the event row is written **inside the caller's transaction**.
- `Clock` and `IdGenerator` are ports. A use case calling `Date.now()` or `crypto.randomUUID()` directly fails review.

**Idempotency — corrected after review.** A response *hash* cannot reconstruct a response; the first draft of this plan was wrong. The store keeps the **actual replayable response**:

| Column | Purpose |
|---|---|
| `scope_type` + `scope_id` + `operation` + `key` | uniqueness is scoped, not global. `scope_type` is `COMPANY` (every tenant write) or `USER` (bootstrap writes that run before a tenant exists — today only `onboard-company`, whose caller cannot know the new company id). `CHECK` ties `scope_id` to `company_id` / `user_id`; RLS shows `COMPANY` rows by `app_company_id()` and `USER` rows by `app_user_id()` |
| `request_fingerprint` | same key with a **different** body → reject `422`, never replay |
| `status` | `IN_FLIGHT` \| `COMPLETED` \| `FAILED` |
| `response_status`, `response_body` | what a replay actually returns |
| `created_at`, `expires_at` | 24 h retention, swept by a job |

- The key row is claimed and the business effect committed in **one transaction**. A crash mid-flight leaves `IN_FLIGHT`, which expires rather than blocking forever.
- A concurrent duplicate hitting `IN_FLIGHT` gets `409`, not a second execution.

**Done when:** tests prove (a) a rolled-back transaction leaves no outbox row, (b) a replayed key returns the identical stored response, (c) the same key with a different body is rejected, (d) two concurrent identical requests produce exactly one effect.

---

### T8 — `tenancy` use cases · Size L · depends: T9a

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

**Done when:** `TEN-01`…`TEN-05` pass as integration tests against real Postgres with real sessions, and `pnpm lint:boundaries` passes.

---

### T9a — Identity bootstrap: Better Auth, memberships, guard, feature flags · Size L · depends: T7 · **before T8**

**Why split.** T8's API-level isolation proof needs a real session, and its first-owner rule needs memberships. v2 scheduled all of identity after T8, which made T8 unprovable. Full sub-tasks: `docs/PRD.md` P0-T9a.

**Files**
```
packages/auth/src/{config.ts,principal.ts,client.ts,index.ts}
packages/db/schema/identity.ts
packages/db/migrations/NNNN_identity_bootstrap.sql   ← Better Auth tables, memberships, roles,
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
- `@Require('action:resource:scope')` guard: principal and membership resolved server-side, deny by default, union of applicable memberships minus any DENY (precedence per PRD D-31). A route without a guard fails CI.
- `@RequiresFeature()` guard reading the company's plan flags plus per-company overrides (seeded rows, no UI).
- **`onboard-company` is a complete slice**, with every requirement T8 has for its own writes:
  - spec `docs/specs/NNN-identity-onboard-company/spec.md` and Zod contract in `packages/contracts`;
  - `POST /v1/companies`, guarded; **who may call it is `TODO(spec)` PRD D-34** — Phase 0 tests call it as a seeded platform user;
  - `Idempotency-Key` in the **`USER` scope** (T7) — the retry cannot know the company id yet; the company id is generated by `IdGenerator` before the insert, and the transaction sets both `app.user_id` and `app.company_id` to it so the RLS `WITH CHECK` on the new rows passes; company row + owner membership + `AuditLog` row + `CompanyCreated` outbox event, all in **one** transaction;
  - last-owner protection on later membership changes.
- **Scenarios** (integration, real Postgres, real session): `ONB-01` happy path → company, owner membership, audit row and outbox event all exist; `ONB-02` the membership insert fails → **no** company row, **no** outbox row; `ONB-03` replayed key → identical stored response, one company; `ONB-04` **two companies created through the API** by two users — the first half of the phase's success criterion, which T5 and T8 then use.
- Role bundles seeded as **provisional** codes (see `SPEC.md` §8 q3).

**Done when:** `ONB-01`…`ONB-04` pass; a real login produces a session; a user with two company memberships can switch only between those two; a guard-less route and a disabled feature are both refused in tests.

---

### T9b — Devices, cashier PINs, remaining auth plugins · Size L · depends: T8

**Full sub-tasks:** `docs/PRD.md` P0-T9b.

**Files:** `packages/db/schema/identity.ts` (extended), `packages/db/migrations/NNNN_devices_pins.sql`, `apps/api/src/modules/identity/**`

**Required behaviour**
- `packages/auth` is the **only** code that issues or verifies a session, hashes a password, or hashes a PIN — enforced by `no-restricted-imports` on hashing libraries outside the package.
- `phone-number` and `api-key` plugins installed but not wired until a delivery channel (Phase 1) or the public API (Phase 5) exists. `organization` only if ADR-0003 gives it a role.
- `cashier_pins`, `devices` with tenant-qualified FKs to branches. Platform role codes seeded, unused until Phase 5.
- Use cases: `register-device` (pairing code, short Redis TTL), `approve-device`, `revoke-device`, `set-cashier-pin`, `verify-cashier-pin`. Redis rate limits on PIN attempts and login.
- Every sensitive action (PIN change, device approval/revocation, role change, override) writes an `AuditLog` row.

**Blocked on:** `SPEC.md` §8 questions 4 and 5. Mark `TODO(spec)` and stop rather than choosing values.

**Done when:** PIN verification works against a stored hash, a revoked device is rejected on next contact, membership removal takes effect on the next request, and every sensitive action writes an `AuditLog` row.

---

### T10 — `settings` + `packages/i18n` · Size M · depends: T8

**Files**
```
packages/db/schema/settings.ts · packages/db/migrations/0004_settings.sql
apps/api/src/modules/settings/**
packages/i18n/src/{ar.ts,en.ts,format-kwd.ts,dates.ts,index.ts}
```

**Required behaviour:** `formatKwd(12500n) === '12.500'`. Dates follow the business's Gregorian/Hijri setting and the branch timezone. Error envelopes carry both languages.

**Blocked on:** `SPEC.md` §8 question 1 (product name in templates).

**Done when:** the formatter tests pass and no hardcoded Arabic or English string exists outside `packages/i18n`.

---

### T11 — `packages/observability` · Size M · depends: T6

**Files:** `packages/observability/src/{pino.ts,redaction.ts,request-context.ts,otel.ts,index.ts}`

**Required behaviour**
- Every log line carries `request_id`, `company_id`, `branch_id` (when present), `user_id`.
- Redaction list, configured once: PINs, tokens, gateway and messaging credentials, full customer phone numbers (last 3 digits only), employee-document content.
- No request/response bodies in normal operation — only on error, after redaction.
- Trace sampling: 10% of normal requests, 100% of anything that errored or took over a second.

**Done when:** a test asserts that a deliberately logged PIN does not appear in the output.

---

### T12 — CI pipeline · Size M · depends: T5 (grows with each later task)

**Files:** `.github/workflows/ci.yml`, `.github/workflows/build.yml`

**Gate order — exactly this:**
```
typecheck → lint → lint:docs → boundaries → cycles → module-map →
unit (domain) → integration → RLS negative tests → EXPLAIN checks →
build all apps → docker images
```

**Notes:** images tagged by **commit SHA**, never `latest`, pushed to GHCR. Add a deliberately-broken fixture PR once to confirm the boundary step actually blocks.

**Done when:** a PR violating a module boundary is blocked by CI.

---

### T13 — Staging deploy + backups · Size L · depends: T9b, T10, T11, T12b

**Deliverable:** a staging environment that can be rolled back, and a backup that has been restored.

**Files:** `deploy/docker-compose.staging.yml`, `deploy/Dockerfile.api`, `deploy/Dockerfile.worker`, `deploy/backup/*`

**Required behaviour**
- Dokploy + Traefik. Migrations run as **their own step before** new containers start.
- Multi-stage builds on `node:24-alpine` (ADR-0002), production dependencies only.
- **`apps/worker` bootstrap ships here** — `main.ts`, `/health`, `/ready`, BullMQ connection and the outbox dispatcher (poll → publish → mark published, with retry and consumer-side dedupe by `event_id`). Without a dispatcher the outbox writer from T7 delivers nothing, and Phase 1 commissions would consume an empty stream.
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

**Blocked on:** `SPEC.md` §8 question 6 (which host).

**Done when:** a staging deploy succeeds from a SHA-tagged image, the previous image still runs against the new schema, and **one PITR restore has actually been performed** to a chosen timestamp and queried.

---

## 2. Dependency order — revised

```
T0 ─ T1 ─┬─ T2 ─┐
         └─ T3 ─┴─ T4 ─ T6a ─ T5 ─ T6b ─┬─ T7 ─ T9a ─ T8 ─┬─ T9b
                                        │                  └─ T10
                                        └─ T11
                                 T1 ─ T12a        T12b ─ T13
```

- **T0** now precedes everything. The auth ↔ RLS boundary is a schema decision, not a T9 detail.
- **T6 splits.** `CLAUDE.md` §1 mandates *contract → migration*, and the first draft had the schema (T5) before the contracts (T6), contradicting the project's own rule. **T6a** (Zod contracts for tenancy) moves **before** T5; **T6b** (the NestJS app, filter, health, OpenAPI) stays after it.
- **T12 splits.** A minimal CI — typecheck, lint, unit — runs from **T12a at T1**, otherwise "every rule is a CI gate" is false for the first two weeks of PRs. **T12b** adds the full gate once there is something to gate.
- **T9 splits (v3).** **T9a** (Better Auth, memberships, guards, feature flags, `onboard-company`) moves **before** T8, because T8's API-level isolation proof needs real sessions and its first-owner rule needs memberships. **T9b** (devices, PINs, remaining plugins) stays after T8.
- **T13 depends on T9b, T10 and T11**, not only on T12. Staging must not be declared done while the worker, i18n and observability are missing.
- **Redaction moves earlier.** The pino redaction list lands with **T6b**, not T11. Adding it after real requests have been logged means the exposure already happened.

**Critical path:** T0 → T1 → T3 → T4 → T6a → T5 → T6b → T7 → **T9a → T8** → T9b → T12b → T13

T11 can run in parallel with T7–T8; it touches no module code.

> **Serial by default.** `SPEC.md` §5 says a slice is not started until the previous one is green. Parallelism here is the single exception named above (T11), and only because it shares no files. An agent must not infer permission to parallelise anything else.

---

## 3. Rough schedule — revised

The first draft said 4 weeks. The review rejected that as "an optimistic coding budget, not a credible completion forecast", and it is right: T7 and T9 were costed as if concurrency, the auth bootstrap and authorization edge cases were free.

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

≈ **6–8 weeks**, against the 3–4 weeks in `06_Tech_Stack_Architecture_EN.md` §7. **That doc's estimate is optimistic and should be updated**, or Phase 0's acceptance bar lowered deliberately — but not silently.

**Most likely to overrun: T9a + T9b** (Better Auth + identity). Estimated 7–12 working days together rather than 2–3. AI accelerates writing code far more reliably than it accelerates verifying security.

---

## 4. Revision log

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
| Idempotency added later | Retried POSTs double-create orders in Phase 2 | T7 ships it before the first real write in T8 |
| CI added at the end | Rules go unenforced for weeks and drift accumulates | T12 starts right after T5 and grows |
| Backups configured but never tested | An untested backup is a hypothesis, not a backup | T13 is not done until one restore has been performed |
