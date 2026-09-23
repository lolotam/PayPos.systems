# Architecture V1.2 — Multi-Vertical Business Management SaaS

> Companion to `08_ChatGPT_Brief_Review_AR.md` (decisions & rationale) and `07_CLAUDE.md` (rules the AI must obey). This file is the **design-first** artifact: module map, dependency map, domain model, and the design of the engines that differentiate us. **No code yet** — implement one vertical slice at a time from this.
>
> **Changelog**
> - **V1.2 (2026-09-15)** — **Auth layer confirmed**: Better Auth (self-hosted) + our own `identity` layer. Added §1.1 auth decision row, §5.8 (the five login types, cashier PIN, device registration, offline session design) and auth rules in §5.7. Rejected all per-MAU services on unit-economics grounds (see §5.8.1).
> - **V1.1 (2026-09-15)** — Stack review session with Waleed. Confirmed layer by layer: front-end, back-end, ORM, database, container topology. Main change: **Prisma → Drizzle ORM**, NestJS explicitly on the **Fastify adapter**, `api` and `worker` are **separate containers**, and every layer runs in its own container. Added §1.1 (decision log) and §1.2 (container topology). Rows marked ⏳ in the stack table are still to be reviewed.
> - V1 — initial design.

---

## 1. Stack (V1.2)

**Guiding principle (agreed 2026-09-15):** user-perceived speed comes from architecture — local-first POS, correct indexes, Redis caching, background queues, few DB round-trips — not from exotic frameworks. So the stack is **TypeScript end-to-end**, the most AI-fluent and structured options at every layer, with performance guaranteed by rules (see §5.7) rather than by rare technology.

| Layer | Choice | Why | Status |
|---|---|---|---|
| Language | **TypeScript everywhere** (front, API, worker, shared packages) | One language = one set of types/contracts shared by all apps; types catch AI mistakes before runtime | ✅ confirmed |
| Monorepo | pnpm workspaces + Turborepo | Fixed structure for AI; shared contracts | ✅ confirmed |
| UI library | **React** | Largest ecosystem and AI training corpus; richest premium UI libraries; RTL-ready | ✅ confirmed |
| Admin web | **Next.js (App Router)** + React + TS | SSR for fast first paint; SEO where needed; runs as its own Node container | ✅ confirmed |
| POS terminal | **Vite + React PWA, local-first** (Dexie/IndexedDB, Service Worker, sync queue) | Must survive bad internet; every tap executes locally, sync in background; served as static files (no Node) | ✅ confirmed |
| Staff app | PWA (attendance QR scan, schedule, commissions) — lives inside `apps/pos` behind a route in V1 | No app-store friction | ✅ confirmed |
| Public site / e-menu | Next.js SSR (`apps/menu`) | SEO, share cards, fast first paint | ✅ confirmed |
| Design system | **Tailwind CSS + shadcn/ui (Radix) + Framer Motion**, shared in `packages/ui` | The "luxury / unique" feel comes from one owned design system (tokens, Arabic fonts, motion), identical across admin and POS; shadcn code lives in our repo so it can be fully customised | ✅ confirmed |
| Runtime | **Node.js LTS** | Most stable runtime for the libraries we need; Bun is an escape hatch later (same code) | ✅ confirmed |
| API | **NestJS on the Fastify adapter** (modular monolith) + Zod DTO validation | Fastest mainstream Node HTTP engine (2–3× Express) **plus** a strict module structure that constrains AI output; SSE, BullMQ, auth all first-class | ✅ confirmed |
| Worker | **Same NestJS codebase, separate `worker` container** running BullMQ processors | Reports, PDF, WhatsApp, sync, commission runs, outbox dispatch never block the request path | ✅ confirmed |
| DB | **PostgreSQL 16 + Row-Level Security** | ACID money + tenant isolation enforced in the DB | ✅ confirmed |
| ORM | **Drizzle ORM** (SQL-like, zero overhead, prepared statements, native RLS policy support, drizzle-kit migrations) **+ raw SQL via Drizzle's `sql` tag** for heavy reports/dashboards (kept in `.sql` files) | Performance is priority #1: the query written is the query executed; joins are visible (no hidden N+1); one tool for CRUD *and* reports; RLS transactions are natural | ✅ confirmed |
| Cache/Queue | **Redis 7** (own container) | BullMQ, rate-limits, hot reads (menu/prices/settings), short-lived state (rotating QR secrets) | ✅ confirmed |
| Client-side store | **IndexedDB via Dexie** (inside the POS PWA) | Offline orders, catalog snapshot, sync outbox | ✅ confirmed |
| Auth | **Better Auth (self-hosted, in our own DB)** with `organization`, `two-factor` (TOTP), `phone-number` (OTP) and `api-key` plugins, on the Drizzle adapter — **plus our `identity` layer** for cashier PIN, device registration and 3-level RBAC | $0 at any scale (per-MAU pricing is fatal at ~500k MAU against 50 KWD/shop), data stays in our Postgres under the same RLS, sessions are ours so the POS keeps working offline, and PIN/device-token flows simply do not exist in hosted providers | ✅ confirmed |
| Realtime | SSE (KDS, dashboards); upgrade to WS only if bidirectional need appears | Simplest that works through proxies | ⏳ to review |
| Files | S3-compatible (MinIO dev / DO Spaces prod) | Images, receipts, exports | ⏳ to review |
| PDF/Excel | Worker: Playwright headless (HTML→PDF, Arabic fonts) + exceljs | Bilingual reports | ⏳ to review |
| Payments (KW) | MyFatoorah first (KNET, cards, Apple Pay); Tap/UPayments adapters later | Kuwait reality | ⏳ to review |
| Messaging | WhatsApp Cloud API (Meta); email via Resend/SES | Reminders, campaigns, OTP | ⏳ to review |
| Observability | pino structured logs + request-id + Sentry; OpenTelemetry later | "What happened to tenant X order Z at 3:12?" | ⏳ to review |
| Deploy | One Docker image per app; Docker Compose on 1 VPS via Dokploy/Coolify + Caddy; GitHub Actions CI | Solo-dev friendly; managed Postgres when revenue justifies | ⏳ to review |

### 1.1 Decision log — what was compared and why (2026-09-15)

| Layer | Chosen | Also considered | Why the others lost |
|---|---|---|---|
| Front-end | React (Next.js + Vite PWA) | Vue/Nuxt, Svelte/SvelteKit, SolidJS, Angular, Astro | Theoretical speed gains of Svelte/Solid are not user-perceptible here, while AI accuracy and premium UI-kit availability are clearly lower; Angular is heavy; Astro is for static sites (may be used later for the marketing site) |
| Back-end | NestJS on Fastify (Node LTS) | Fastify/Hono alone, Bun + Elysia, Go, Rust, Python FastAPI, Elixir Phoenix, .NET, Laravel, Supabase/BaaS | Framework overhead is 1–3 ms of an ~80 ms request; DB + network dominate. NestJS gives the structure AI needs and Fastify's speed. Go/Rust/.NET mean a second language and duplicated types; Bun/Elysia not mature enough; Python/Laravel slower and weak at realtime; BaaS cannot hold our domain logic cleanly. Escape hatches: run NestJS on Bun later; move a heavy worker to Go later — no rewrite |
| ORM | Drizzle + raw SQL in Drizzle | Prisma, Kysely, TypeORM, MikroORM, raw SQL only | Prisma hides SQL and needs a second path (`$queryRaw`) for reports; Kysely needs extra tools for schema/migrations; TypeORM is buggy; MikroORM has weak AI support; raw-only loses types and migrations. Fallback: switch to Prisma only within the first month if Drizzle proves unreadable |
| Database | PostgreSQL + Redis + Dexie | MySQL, MongoDB, SQLite/Turso, CockroachDB | Money/stock need ACID + RLS; Mongo unsafe for ledgers; SQLite is single-node; Cockroach is overkill for V1 |
| Auth | Better Auth (self-hosted) + our `identity` layer | Auth.js/NextAuth, Passport + hand-rolled JWT, SuperTokens, Keycloak, Ory, Clerk, Auth0/Okta, Supabase Auth, Lucia | **Per-MAU services (Clerk, Auth0) are disqualified by unit economics** — see §5.8.1. Auth.js is Next.js-centric and has no organizations/RBAC; hand-rolled Passport puts every security primitive on us (highest breach risk under AI-generated code); SuperTokens/Keycloak/Ory each add container(s) and split users away from business data (no SQL joins, no shared RLS); Supabase Auth only makes sense inside Supabase; Lucia is no longer maintained as a library. None of the hosted options support cashier PIN, device tokens, or offline sessions — which we must build ourselves regardless |

### 1.2 Container topology (each layer isolated, talks over the Docker network)

| Container | Runs | Notes |
|---|---|---|
| `admin` | Next.js server (`apps/admin`) | SSR; Node process |
| `pos` | Static build of `apps/pos` served by Caddy/Nginx | No Node at runtime; near-zero resources; PWA + Service Worker |
| `menu` | Next.js server (`apps/menu`) | SSR public e-menu / booking |
| `api` | NestJS (Fastify) HTTP API + SSE + **Better Auth handler mounted in-process** | Must stay light: request/response only; anything > 200 ms goes to a queue. Auth adds **no extra container** |
| `worker` | NestJS BullMQ processors (same image as `api`, different entrypoint) | Reports, PDF, WhatsApp, sync, commission runs, outbox dispatch; can scale independently |
| `postgres` | PostgreSQL 16 | Own volume; RLS policies applied by migrations; **auth tables live here too** |
| `redis` | Redis 7 | Queues, cache, rate-limits, rotating QR secrets, OTP throttling |
| `caddy` | Reverse proxy + TLS | Routes `admin.`, `pos.`, `menu.`, `api.` subdomains |

## 2. Repository layout

```
/apps
  /admin      Next.js — back-office (all business types)
  /pos        Vite PWA — cashier + staff (offline-first)
  /menu       Next.js — public e-menu / booking site (SSR)
  /api        NestJS (Fastify adapter) — HTTP API + SSE + Better Auth handler
  /worker     NestJS — BullMQ processors (outbox, reports, notifications, sync)
/packages
  /db         Drizzle schema (TS), drizzle-kit migrations, RLS policies (SQL), seed,
              /sql/reports/*.sql  — raw SQL for heavy reports/dashboards (tested + indexed)
  /auth       Better Auth server config + plugins + shared client; the ONLY module allowed
              to issue/verify sessions, hash passwords or hash PINs
  /contracts  Zod schemas + TS types shared by api/web/pos (+ generated OpenAPI)
  /ui         shadcn-based RTL component kit, Tailwind tokens, Framer Motion presets, icons
  /i18n       ar/en message catalogs + formatters (KWD 3dp, Hijri/Gregorian, timezones)
  /config     eslint, tsconfig, tailwind presets
/docs
  /adr        Architecture Decision Records (one file per decision)
  architecture.md  module-map.md  domain-model.md  security.md
```

## 3. Module map (NestJS `apps/api/src/modules/*`)

**Bounded contexts (each = one folder, one public API `index.ts`, no cross-imports of internals):**

| Module | Owns | Depends on (allowed) |
|---|---|---|
| `tenancy` | companies, businesses (verticals), branches, plans/feature-flags | — |
| `identity` | users, sessions (Better Auth), **cashier PINs, registered devices**, RBAC (roles, permissions, overrides) | tenancy |
| `catalog` | categories, items (product\|service), variants, option groups, prices (branch/channel overrides) | tenancy |
| `customers` | customers, credit limits, tags, blocks | tenancy |
| `staff` | employees, documents, schedules, **attendance** (QR sessions, clock events), leave | tenancy, identity |
| `commissions` | commission plans/rules, calculation runs, statements (draft→approved→paid) | staff, orders (read via events) |
| `appointments` | resources (chair/room), availability, bookings, waitlist, reminders | catalog, staff, customers |
| `orders` | orders, items, options, status lifecycle, returns, custom fields | catalog, customers, tenancy |
| `payments` | payment methods, payments (split), gateway adapters, refunds, credit ledger (A/R) | orders |
| `cash` | cash shifts (drawer open/close, movements, reconciliation) | identity, payments |
| `inventory` | UoM, stock items, locations, **stock_movements ledger**, purchases, suppliers, transfers, counts, adjustments, wastage, recipes, production | tenancy |
| `kitchen` | KDS tickets/stations, waiting screen | orders |
| `loyalty` | points rules/ledger, stamp cards, gift cards, discounts | customers, orders |
| `channels` | ordering channels, commissions→expenses, aggregator adapters | orders, expenses |
| `expenses` | categories, expenses, recurring | tenancy |
| `reporting` | read models / materialized views, export jobs | all (read-only SQL) |
| `notifications` | templates, WhatsApp/email/SMS dispatch, in-app | — |
| `settings` | per-business config (tax, invoice template, hours, delivery zones, order rules) | tenancy |
| `platform` | super-admin: tenants, subscriptions, feature flags, support | tenancy |

**Dependency rule:** arrows only point *down* the list or *sideways via domain events* (outbox). `orders` never imports `inventory`; it emits `OrderCompleted`, and `inventory` consumes it. `pos` is **not a backend module** — the POS app orchestrates `orders` + `payments` + `cash` through the API.

**Domain events (outbox) V1:** `OrderCreated`, `OrderCompleted`, `OrderCancelled`, `PaymentCaptured`, `PaymentRefunded`, `ReturnPosted`, `ServiceCompleted` (per order item with `served_by`), `AttendanceClocked`, `AppointmentBooked/Completed`, `StockPosted` (purchase/production/count/adjustment/wastage), `DeviceRegistered`, `DeviceRevoked`.

## 4. Domain model — the multi-vertical core

```
Company (tenant root; owner; billing)
 └─ Business (vertical_type: restaurant|salon|laundry|retail|services; settings; currency; timezone)
     └─ Branch (address, geo, hours, order-type×channel matrix, default stock location)

User ──< Membership (company/business/branch scope, role, permission overrides) 
Employee (business, user?, base_salary, commission_plan_id, schedule, documents)
CashierPin (employee, branch, pin_hash, rotated_at, failed_attempts, locked_until)
Device (branch, label, device_fingerprint, token_hash, approved_by, approved_at,
        last_seen_at, status: ACTIVE|REVOKED, app_version)

Item (business, kind: PRODUCT|SERVICE, names ar/en, category, base_price, cost, tax, barcode,
      service: duration_min, resource_type, requires_staff, default_commission_rule)
 ├─< ItemVariant   ├─< ItemPrice (branch?, channel?, order_type?)   ├─< ItemOptionGroup >─ OptionGroup ─< OptionValue

Customer (business, type, phones, credit_limit, tags, loyalty_balance)

Order (business, branch, order_type, channel, status, customer?, staff_id, custom_fields jsonb,
       subtotal, discount_total, service_fee, tax_total, tip, total, currency, client_id, idempotency_key)
 ├─< OrderItem (item, variant?, qty, unit_price, served_by_staff_id, appointment_id?, line_total)
 │     └─< OrderItemOption
 ├─< Payment (method, amount, status, gateway_ref, shift_id, idempotency_key)
 └─< Return (lines, refund, stock_effect: RESTOCK|WASTE|NONE)

Appointment (business, branch, customer, resource?, staff?, starts_at, duration, status, order_id?)
CashShift (branch, cashier, device_id, opened_at, opening_float, closed_at, counted, expected)
AttendanceSession (branch, employee, clock_in, clock_out, source: QR|MANUAL, geo, device_id, late_min)
CommissionRule (plan, type: PER_ITEM_PCT | REVENUE_PCT | TIERED, basis: NET|GROSS, scope, tiers jsonb)
CommissionEntry (employee, order_item?, period, amount, rule, status) → CommissionStatement (period, status)

StockItem / StockLocation / StockMovement (item, location, qty_delta, unit_cost, balance_after, source_type, source_id)
Recipe / RecipeIngredient / ProductionOrder ; Purchase / PurchaseLine ; Transfer ; StockCount ; Wastage
AuditLog (tenant, actor, entity, action, before jsonb, after jsonb, at)
Outbox (id, aggregate, event_type, payload, created_at, published_at)
```

**Conventions:** UUID v7 PKs (time-sortable; generated client-side on POS), `company_id` + `business_id` on every tenant row (RLS on `company_id`), `numeric(14,3)` money, `timestamptz` UTC, soft-delete only where business needs history (`items`, `customers`, `employees`), bilingual `*_ar/*_en` columns. Schema is declared in Drizzle (`packages/db/schema/*.ts`), one file per bounded context, mirroring §3. Better Auth's own tables (`user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`, `two_factor`, `api_key`) are generated into the same schema and included in migrations.

## 5. Engine designs

### 5.1 Rotating-QR attendance (client's #1 ask)
- **Display side** (branch tablet, route `/pos/attendance-screen`): every 60 s the API issues a token `HMAC(branch_id ‖ window_index ‖ secret)` (secret per branch in Redis, rotated daily). QR encodes `{branch_id, window, sig}`. Screen also shows a big clock and the branch name.
- **Scan side** (employee PWA, logged in with their user or a phone-OTP): camera scan → `POST /attendance/clock {token, geo, device_fp}`. Server validates signature, accepts **current or previous window** (120 s tolerance), checks employee ∈ branch, optional geofence (Haversine vs branch lat/lng, radius setting), dedupes (one clock per 5 min), then toggles IN/OUT based on the open session.
- **Anti-cheat:** token bound to branch + time; screenshots expire in ≤120 s; device fingerprint + optional selfie upload; geofence; anomaly report (clock from same device for 2 employees).
- **Outputs:** `AttendanceSession` → late minutes vs schedule → feeds payroll/commissions; manager approves exceptions.

### 5.2 Commission engine (client's #2 ask)
- Rules are **data**, evaluated by one pure function `computeCommission(entry, rules, context)` — unit-tested exhaustively.
- Rule types: `PER_ITEM_PCT` (pct of line net/gross; supports split among multiple `served_by`), `REVENUE_PCT` (pct of employee's or branch's period revenue), `TIERED` (tiers `[{from:0,to:3000,pct:0},{from:3000,pct:10}]` with mode `MARGINAL` (only above threshold) or `WHOLE` (entire amount once threshold passed)). Modifiers: rating multiplier, attendance deduction, refund reversal (negative entries).
- Flow: `ServiceCompleted` event → `CommissionEntry` (immutable, reversible) → monthly `CommissionStatement` draft → manager approve → export to payroll/PDF.

### 5.3 Local-first POS
- Bootstrap: pull catalog/prices/customers snapshot (versioned) into IndexedDB. Orders are created **locally first** with UUID v7 + `idempotency_key`; enqueued to a sync outbox; Service Worker background-sync pushes when online. Server applies idempotently and returns canonical state; conflicts (e.g., price changed) resolved server-side with rules (server price wins; order keeps captured price with audit).
- Payments: cash/credit can complete offline; card/KNET requires online (queued as "pending payment").
- Printing: local **print agent** (tiny Node/Go service on the counter PC/Android) receiving ESC/POS jobs over LAN; fallback browser print.

### 5.4 Tenant isolation (RLS) pattern — Drizzle
- Every request: resolve `company_id` from session → run all DB work inside one transaction that sets the tenant GUC first:

```ts
// packages/db/src/with-tenant.ts — the ONLY way modules touch the DB
export const withTenant = <T>(companyId: string, fn: (tx: Tx) => Promise<T>) =>
  db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);
    return fn(tx);
  });
```

- **No raw `db` client is exported** from `packages/db`; modules receive `tx` only. Policies `USING (company_id = current_setting('app.company_id')::uuid)` on every tenant table (declared with Drizzle `pgPolicy` + `.enableRLS()`, emitted by drizzle-kit migrations), `FORCE ROW LEVEL SECURITY`, index on `(company_id, …)`.
- CI runs negative tests (cross-tenant read = 0 rows, write = error). PgBouncer in transaction mode if introduced (compatible: the GUC is transaction-local).
- Platform (super-admin) queries use a separate DB role that bypasses RLS, exposed only inside the `platform` module.

### 5.5 Reliability primitives
- **Idempotency:** `Idempotency-Key` header on all POST that create money/stock effects; stored 24 h with response hash.
- **Outbox:** events written in the same DB transaction as the change; worker publishes to BullMQ; consumers are idempotent (`event_id` dedupe).
- **Webhooks in:** verify signature → persist raw → enqueue → process; dedupe by provider event id.
- **Money math:** `bigint` mills (1 KWD = 1000) in TS, `numeric(14,3)` in PG; rounding rule documented once (half-up at line level, totals from lines).

### 5.6 Vertical templates & feature flags
- `vertical_type` selects: enabled modules, default order types, item kinds, report set, onboarding checklist. Stored as a JSON template in `platform`, copied into `business.settings` at creation (editable).
- Plan gating: `feature_flags` per company (from subscription plan) checked by a `@RequiresFeature('tables')` guard and mirrored to the UI.

### 5.7 Performance & security rules (mirror these into `07_CLAUDE.md`)

**Performance**
- **One list = one query.** Any endpoint returning a list is a single query with joins; loops that issue queries (N+1) are forbidden. Reviewers/AI must be able to see the join in the Drizzle code.
- **Every filter has an index.** Any column used in `WHERE`/`ORDER BY` on a tenant table gets a composite index starting with `company_id`; the migration that adds the query adds the index.
- **Hot reads come from Redis.** Menu, prices, settings, feature flags are cached with explicit invalidation on write; the DB is the source of truth, not the read path for the POS.
- **> 200 ms → worker.** Reports, PDF/Excel, WhatsApp/email, aggregator sync, commission runs are BullMQ jobs; the `api` container never waits on them.
- **Reports are raw SQL files.** Heavy reports/dashboards live in `packages/db/sql/reports/*.sql`, executed through Drizzle's `sql` tag, each with its own test and `EXPLAIN ANALYZE` check.
- **Prepared statements for POS hot paths** (create order, add payment, clock in/out) via Drizzle `.prepare()`.
- **Cursor pagination everywhere**; no unbounded lists.
- **Payload discipline:** select only the columns the screen needs (no `SELECT *` in list endpoints).

**Security (auth is the one area where AI improvisation is banned)**
- Sessions, passwords, PINs and device tokens are issued/verified **only** through `packages/auth` or the approved `identity` helpers. **No module ever signs a JWT, compares a password, or hashes a PIN by hand.**
- Every endpoint declares its guard explicitly; a route with no guard fails CI.
- Authorization is checked **server-side** on every request from the resolved membership — never from a claim the client sends, and never only in the UI.
- Rate-limit and lock: PIN attempts (lock after N failures), OTP requests (per phone + per IP), login attempts — all in Redis.
- Every sensitive action (PIN change, device approval/revocation, role change, refund, price override) writes an `AuditLog` row.

### 5.8 Identity & access design

**The five login types** — this is why no hosted provider fits as-is:

| Who | Where | How they sign in | Session life |
|---|---|---|---|
| Owner / manager | `admin` | Email + password + **TOTP 2FA** (Better Auth `two-factor`) | Normal web session, idle timeout |
| Cashier | `pos` on a **shared** branch device | **PIN** (4 digits; 5 failed attempts lock it for 15 minutes — PRD D-08, 2026-09-23) on an already-registered device | Short "operator" session on top of a long device session; PIN re-prompt on shift change / idle |
| Branch device | `pos` | **Device token**, issued once after a manager approves the device | 30 days, renewed on every contact, revocable instantly (PRD D-09, 2026-09-23) |
| Employee | staff routes in `pos` | **Phone OTP** (Better Auth `phone-number`) on their own phone, for QR attendance | Medium; bound to employee, not to branch device |
| Customer | `menu` | **Phone OTP** for booking / loyalty | Light, long-lived, no access to business data |
| Integrations | API | **API key** with scopes (Better Auth `api-key`) | Per-company, revocable |

**Cashier PIN + device registration flow**
1. Manager opens `admin` → Devices → "Add device", gets a one-time pairing code (short TTL, in Redis).
2. The POS device enters the code once → server stores `Device` (fingerprint + hashed long-lived token, branch, approved_by) and returns the token → the PWA keeps it in IndexedDB.
3. From then on, the device pulls the branch's cashier PIN **hashes** (never plaintext) along with the catalog snapshot.
4. A cashier taps their name → enters PIN → **verified locally against the stored hash**, so a shift can open with no internet. Every locally-authorised action carries `device_id` + `employee_id` and is re-verified server-side on sync.
5. Lost/stolen device: manager revokes it in `admin` → token rejected on next contact, and the app wipes its local snapshot. (Offline-by-design means a revoked device can still act until it reconnects — mitigated by short token renewal windows, per-device sync audit, and the shift/cash reconciliation trail.)

**RBAC (3 levels)** — a `Membership` binds a user to a scope (company / business / branch) with a role (`OWNER`, `MANAGER`, `ACCOUNTANT`, `CASHIER`, `STAFF`, …) plus per-user **permission overrides**. Permissions are checked by a NestJS guard against the resolved membership for the tenant in `app.company_id`; the same matrix drives the UI so buttons a user cannot use are not shown. Detailed matrix lives in `09_Dashboards_Roles_Permissions_AR.md`.

#### 5.8.1 Why not a hosted auth provider (the unit-economics check)
Target scale is **10k–50k organizations × 4–10 staff ≈ 200k–500k monthly active users**, against a subscription the client prices around **50 KWD per shop per month**. At typical per-MAU rates (~$0.02), hosted auth costs **$4,000–$10,000/month** — a cost that scales with exactly the number the revenue is divided by, and that arrives before profit does. Self-hosted auth costs **$0** and adds **zero containers**. This is a business decision first and a technical one second.

## 6. API shape
- REST + OpenAPI generated from Zod contracts (`packages/contracts`). Versioned `/v1`. Cursor pagination. Consistent error envelope `{code, message_ar, message_en, details}`. SSE `/v1/stream` (KDS/dashboards). Public API keys per company (V1) with scopes.

## 7. Delivery order (recommended)
0. Foundation: tenancy, identity (Better Auth + PIN/device + RBAC), branches, settings, i18n, audit, outbox, CI/CD, RLS tests.
1. **Staff → attendance (QR) → commissions** (salon pilot).
2. Catalog → orders → payments → cash shifts → POS PWA (restaurant branch pilot).
3. Inventory (ledger, purchases, counts, wastage) → recipes/production → kitchen.
4. Appointments → e-menu site → loyalty/gift/discounts → channels.
5. Reporting (unified owner dashboard, scheduled exports) → platform admin → subscriptions.

## 8. Costs (rough, monthly)
VPS 8 GB (≈ $30–50) · managed Postgres later (≈ $25–60) · object storage (≈ $5) · Sentry free tier · WhatsApp Cloud API per conversation (≈ $0.02–0.05) · MyFatoorah per-transaction fees · domain/TLS free (Caddy). **Auth: $0 at any scale.**

## 9. Escape hatches (planned, no rewrite required)
- **Runtime:** run the same NestJS image on Bun instead of Node once Bun's driver ecosystem is fully stable.
- **Heavy worker:** if report/sync jobs outgrow Node, move only the `worker` container to Go; contracts stay in `packages/contracts`.
- **ORM:** Prisma remains the fallback only during month 1 if Drizzle proves unreadable for the team; after the schema grows, the decision is final.
- **Realtime:** SSE → WebSocket only if a bidirectional need appears (e.g., live table map editing).
- **Auth:** if enterprise SSO (SAML) is ever required by a large customer, add an OIDC bridge in front of Better Auth for that tenant only — the internal session model does not change.
