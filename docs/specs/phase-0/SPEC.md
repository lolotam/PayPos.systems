# Phase 0 — Foundation Spec

> **Status:** Draft v2 · 2026-09-22 · §5 and §8 synced with `docs/PRD.md` v1.1
> **Repo:** `E:\PosPay.systems\pospay` (product name: **PosPay**, domain `pospay.systems`)
> **Governing docs:** `CLAUDE.md` · `CLAUDE.architecture.md` · `docs/06_Tech_Stack_Architecture_EN.md` · `docs/module-map.md`
>
> On conflict, those documents win. This spec only decides *what Phase 0 delivers*, never *how the code is shaped*.

---

## 1. Why this phase exists

Phase 0 builds nothing a merchant can see. It builds the three things every later phase stands on:

1. **Tenant isolation that is proven, not assumed** — company A can never read company B's rows.
2. **One predictable shape** for modules, migrations, endpoints and tests, so the AI produces the same structure every time.
3. **A pipeline that refuses bad code** — boundaries, cycles, RLS negative tests, doc-comment coverage.

If Phase 0 is weak, every phase after it inherits the weakness and the cost compounds.

### The single success criterion

> Create two companies **through the API**. Prove, with automated tests, that company A's session reads **zero** rows belonging to company B, that a cross-tenant `INSERT` is rejected, that a cross-tenant `UPDATE` or `DELETE` affects **zero rows**, and that A cannot reference B's data through a foreign key.

Everything else in this spec exists to make that sentence true and repeatable.

> **Two layers, two proofs.** The database layer (RLS) is proven in **T5**. But RLS cannot tell an *authorised* company id from an attacker-supplied one — `withTenant(B, …)` legitimately reaches B. That second proof is an **API-level** test that company A's session cannot cause the server to resolve company B, and it lands in **T8**. Phase 0 is not done with only the first.

---

## 2. Scope

### In

| Area | What ships |
|---|---|
| Workspace | pnpm workspaces + Turborepo, TypeScript strict, ESLint with boundaries + jsdoc rules |
| `packages/domain` | `Money` (bigint mills), KWD rounding half-up, `Percentage` — pure, zero deps |
| `packages/db` | Drizzle schema, drizzle-kit migrations, RLS policies, `withTenant()`, seed |
| `packages/contracts` | Zod schemas, error envelope, generated OpenAPI |
| `packages/auth` | Better Auth self-hosted on the Drizzle adapter |
| `packages/observability` | pino + redaction list + request context + OpenTelemetry setup |
| `packages/i18n` | ar/en catalogs, KWD 3-decimal formatter, timezone helpers |
| `apps/api` | NestJS on Fastify, `/health`, `/ready`, guards, error filter |
| `modules/tenancy` | companies, businesses, branches, plans, feature flags |
| `modules/identity` | memberships, RBAC, cashier PINs, device registration |
| `modules/settings` | per-business configuration |
| Cross-cutting | outbox table + writer, audit log, idempotency store |
| Infra | `docker-compose.dev.yml` (Postgres 16 + Redis 7), GitHub Actions CI, Dokploy staging deploy, nightly backup to Backblaze B2 |

### Out — explicitly not in Phase 0

- `apps/pos`, `apps/admin`, `apps/menu` — no frontend at all
- `apps/worker` — the container is created and deploys, but carries **no business processors** yet
- Catalog, orders, payments, cash, inventory, appointments, commissions, loyalty
- Realtime / SSE (the `realtime` module ships in Phase 2)
- WhatsApp, SMS, email, PDF, Excel
- Any UI, any design system work

> Creating an empty folder for a module that ships in Phase 3 is **out of scope**. Folders are created when their code is written.

---

## 3. Modules in this phase

Three, and their allowed arrows are already declared in `docs/module-map.md`:

| Module | Owns | May import |
|---|---|---|
| `tenancy` | companies, businesses (verticals), branches, plans, feature flags | — (root) |
| `identity` | memberships, RBAC, sessions, cashier PINs, devices | `tenancy` |
| `settings` | per-business config | `tenancy` |

No other module may be created in this phase.

---

## 4. Domain model — Phase 0 subset

```
Company (tenant root)
  id uuid v7 PK · name_ar · name_en · owner_user_id · plan_id
  created_at timestamptz · deleted_at?

Business
  id · company_id FK · vertical_type (restaurant|salon|laundry|retail|services)
  name_ar · name_en · currency (default KWD) · timezone (default Asia/Kuwait)
  settings jsonb · created_at

Branch
  id · company_id · business_id · name_ar · name_en
  address · geo_lat · geo_lng · opening_hours jsonb
  is_active · created_at

Plan            id · code · name_ar · name_en · feature_flags jsonb
User            (owned by Better Auth tables)
Membership      id · company_id · user_id · scope (COMPANY|BUSINESS|BRANCH)
                scope_id · role · permission_overrides jsonb
CashierPin      id · company_id · branch_id · employee_ref · pin_hash
                rotated_at · failed_attempts · locked_until
Device          id · company_id · branch_id · label · device_fingerprint
                token_hash · approved_by · approved_at · last_seen_at
                status (ACTIVE|REVOKED) · app_version
BusinessSettings id · company_id · business_id · tax_rule jsonb
                invoice_template jsonb · order_rules jsonb
AuditLog        id · company_id · actor_user_id · entity · entity_id
                action · before jsonb · after jsonb · at timestamptz
Outbox          id · company_id · aggregate · event_type · payload jsonb
                created_at · published_at?
IdempotencyKey  key · company_id · request_hash · response_hash
                created_at · expires_at
```

### Conventions (from `CLAUDE.md` §5, restated so Codex cannot miss them)

- **UUID v7** primary keys, generated by an injected `IdGenerator` port
- **`company_id uuid NOT NULL`** on every tenant table, with an RLS policy and `FORCE ROW LEVEL SECURITY`
- Composite index starting with `company_id` for every list filter
- `timestamptz` UTC everywhere; display converts to branch timezone
- Money `numeric(14,3)` in Postgres, `bigint` mills in TypeScript — **never `number`**
- Bilingual `*_ar` / `*_en`; English required, Arabic optional unless stated
- Financial rows are immutable and reversible, never deleted
- Soft delete only where this spec names it

---

## 5. The slices — each one is a PR

Ordered. A slice is not started until the one before it is green.

### S1 — Workspace skeleton
`package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.gitignore`, `.env.example`, `packages/config` (eslint incl. `boundaries` + `jsdoc` + `max-lines`, tsconfig presets, prettier).
**Done when:** `pnpm install` and `pnpm check` both pass on an empty workspace.

### S2 — Local infrastructure
`deploy/docker-compose.dev.yml` with Postgres 16 and Redis 7, named volumes, healthchecks.
**Done when:** `docker compose up -d` runs and `psql` connects.

### S3 — `packages/domain`
`Money` (bigint mills, 1 KWD = 1000), `roundKwd` (half-up at line level), `Percentage`, `TaxRule` type. Pure, zero dependencies, exhaustive unit tests with no DB.
**Done when:** tests pass and the package has no runtime dependency in `package.json`.

### S4 — `packages/db` foundation
Drizzle config, drizzle-kit migrations wiring, `withTenant(companyId, fn)`, migration runner script, seed script. **The raw Drizzle client is not exported.**
**Done when:** a throwaway migration applies and rolls forward cleanly.

### S5 — `tenancy` schema + RLS ⭐ **the success criterion**
Tables: `plans`, `companies`, `businesses`, `branches`. RLS policies, `FORCE ROW LEVEL SECURITY`, composite indexes, and the **negative isolation tests** (cross-tenant read = 0 rows, cross-tenant write errors) running against a real Postgres via testcontainers.
**Done when:** the negative tests pass and are wired into `pnpm test`.

### S6 — `packages/contracts` + `apps/api` skeleton
Zod contracts for tenancy, error envelope `{ code, message_ar, message_en, details? }`, NestJS on the Fastify adapter, global exception filter, `/health` and `/ready`, OpenAPI generation.
**Done when:** `GET /health` returns 200 and `pnpm contracts:openapi` emits a spec.

### S7 — Cross-cutting write primitives
`outbox` table + `OutboxWriter` port, `audit_log` table + writer, `idempotency_keys` table + middleware, `Clock` and `IdGenerator` ports with their system implementations.
**Done when:** a use case can append an outbox event inside its own transaction, proven by a test.

### S8 — `tenancy` use cases
`create-business`, `create-branch`, plus `queries/` for list and detail. **No `create-company`:** a company is created only by `identity`'s `onboard-company` (S9 / T9a), together with its first owner, through `identity`'s own `CompanyRegistry` port, whose adapter calls the one write `tenancy` exports, `registerCompany`. Each write: one transaction, `Idempotency-Key`, outbox event inside the transaction, audit log row.
**Done when:** integration tests cover happy path and the listed edge cases.

### S9 — `packages/auth` + `identity`
> Delivered in two parts, T9a **before** S8 and T9b after it — see `IMPLEMENTATION-PLAN.md` v3 §2.

Better Auth self-hosted on the Drizzle adapter with the `organization`, `two-factor`, `phone-number` and `api-key` plugins. Then `memberships`, the `@Require('action:resource:scope')` guard, `cashier_pins`, `devices`, and the use cases `register-device`, `approve-device`, `revoke-device`, `set-cashier-pin`, `verify-cashier-pin`.
**Done when:** a request with no guard fails CI; PIN verification works against a stored hash; a revoked device is rejected.

### S10 — `settings` + `packages/i18n`
`business_settings` table + RLS, get/update use cases. `packages/i18n` with ar/en catalogs, the KWD 3-decimal formatter, Hijri/Gregorian and timezone helpers.
**Done when:** `formatKwd(12500n)` returns `12.500` and error envelopes carry both languages.

### S11 — `packages/observability`
pino config with the mandatory redaction list (PINs, tokens, credentials, full phone numbers, employee documents), request-context helpers propagating `request_id` / `company_id` / `branch_id` / `user_id`, OpenTelemetry setup.
**Done when:** every API log line carries the four fields and no redacted value appears in output.

### S12 — CI pipeline
GitHub Actions running the full gate in order:
`typecheck → lint → lint:docs → boundaries → cycles → module-map → unit → integration → RLS negative tests → EXPLAIN checks → build → docker images`
Images tagged by commit SHA, pushed to GHCR.
**Done when:** a PR that violates a boundary is blocked by CI.

### S13 — Staging deploy + backups
Dokploy staging: `api`, `worker`, `postgres`, `redis`, `traefik`. Migrations run as their own step before containers start. Nightly `pg_dump` + WAL archiving to Backblaze B2 via restic, checking in to Healthchecks.io.
**Done when:** a staging deploy succeeds end to end and one restore has been tested into a scratch database.

---

## 6. Acceptance criteria for the phase

- [ ] Two companies exist; the negative isolation test proves zero cross-tenant reads and a failing cross-tenant write
- [ ] No module can reach the database except through `withTenant()`; the raw Drizzle client is not exported anywhere
- [ ] Every endpoint declares a guard; a route without one fails CI
- [ ] Every `domain/` function and `ports/` method carries its Arabic doc comment; `pnpm lint:docs` is green
- [ ] A write use case appends its outbox event inside the same transaction, proven by a test
- [ ] Every API log line carries `request_id`, `company_id`, `branch_id` (when present), `user_id`; nothing on the redaction list is ever logged
- [ ] CI runs the full gate in order and blocks a boundary violation
- [ ] Staging deploys from a commit SHA image; one backup restore has been tested
- [ ] `pnpm check` is green on `main`

---

## 7. Non-goals

- No performance tuning beyond correct indexes
- No multi-region, no read replicas, no PgBouncer
- No admin UI for anything in this phase — the API and tests are the interface
- No super-admin (`platform`) module; it ships in Phase 5
- No feature-flag UI; flags are seeded rows

---

## 8. Open questions — `TODO(spec)`

These need Waleed's answer before the slice that depends on them:

1. **Product name.** The product is **PosPay** (repo `pospay`, domain `pospay.systems`, ADR-0001). Still open: legal review of "Pay" in the name before it goes in the invoice header and the WABA verified name. *(blocks the S10 invoice header only)*
2. **Plans at launch.** How many, what are they called, and which feature flags separate them? *(does **not** block S5: seed one **provisional** plan; renaming later needs no schema change — PRD D-06)*
3. **Role names.** `09_Dashboards_Roles_Permissions_AR.md` has the matrix — confirm the exact role codes. *(does **not** block S9: seed **provisional** codes; renaming is a data migration — PRD D-07. Final names needed before the Phase 1 pilot)*
4. **PIN length.** 4 or 6 digits? Lockout after how many failures, and for how long? *(blocks S9)*
5. **Device token lifetime.** 7 or 30 days, and what is the renewal window? *(blocks S9)*
6. **Staging host.** Which existing VPS hosts staging, or is a new one provisioned? *(blocks S13)*

Codex must not guess any of these. Where one blocks progress, it stops and marks `TODO(spec)`.
