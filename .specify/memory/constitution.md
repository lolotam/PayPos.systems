<!--
Sync Impact Report
- 2.0.1 (2026-09-23, PATCH): Principle V names the database-test mechanism — the compose
  Postgres with a cloned database per spec file (ADR-0006) — instead of testcontainers. The rule
  itself (real Postgres, never mocks) is unchanged.
- Version change: 1.0.0 → 2.0.0 (merges the parallel 1.0.0 draft written by Gemini into the
  main checkout on 2026-09-22; its five principles map onto I–VII and its ratification
  date is adopted)
- Bump rationale: MAJOR. Principle III is redefined (the global-identity exception to
  withTenant() is now named, per phase-0 plan v2 finding #1). Six sections were added
  that carry product scope, domain model, module map, engine designs, identity model and
  the delivery roadmap, none of which existed in 1.0.0.
- Modified principles:
  - III. Tenant Isolation Enforced by the Database → same title, rule amended with the
    global-identity exception and the tenant-qualified FK requirement
  - II. Domain Purity and Money Correctness → rounding rule and bigint transport added
  - V. Test-Backed Delivery → RLS matrix expanded to the phase-0 plan v2 assertion list
- Added sections:
  - Product Scope & Domain Model
  - Module Map & Integration Contracts
  - Engine Designs
  - Identity & Access
  - Delivery Roadmap & Open Decisions
- Renamed sections: none
- Removed sections: none
- Sources read for this amendment: CLAUDE.md V3, AGENTS.md V3, CLAUDE.architecture.md
  A1.0, docs/06_Tech_Stack_Architecture_EN.md V1.2, docs/module-map.md M1.0,
  docs/specs/phase-0/{SPEC.md, IMPLEMENTATION-PLAN.md v2, CODEX-REVIEW.md},
  docs/adr/0001, docs/adr/0002, README.md, DESIGN.md (style reference).
- Follow-up TODOs: the seven TODO(spec) items are listed under Delivery Roadmap & Open
  Decisions; they are product decisions, not constitution placeholders.
-->

# PosPay Constitution

## Core Principles

### I. One Vertical Slice at a Time

Work is delivered as single use cases, never whole modules. Every slice MUST begin with a
spec at `docs/specs/<module>/<use-case>.md` covering requirements, business rules, edge cases,
acceptance criteria, schema changes, API contract, permissions and tests. Implementation MUST
follow this order: Zod contract → migration + RLS policy → domain functions + unit tests →
use case → adapters (persistence, http) → integration tests → UI. A slice MUST NOT touch
modules outside its scope without stating why. Slices are serial: the next one does not
start until the previous one is green. Every architectural decision MUST be recorded as
`docs/adr/NNNN-title.md`. A slice is done only when the checklist in
`CLAUDE.architecture.md` §15 passes and `pnpm check` is green. Unknown business rules are
marked `TODO(spec)` and work stops there; guessing is forbidden.

Rationale: a solo developer working with AI needs small, verifiable increments; a spec
written before code is the only place the business intent survives.

### II. Domain Purity and Money Correctness (NON-NEGOTIABLE)

All business arithmetic (totals, tax, discounts, tips, commissions, stock costing, lateness,
unit conversion, slot availability, status transitions) MUST live in `domain/` as pure
functions with zero imports outside `packages/domain`. Same input gives the same output; time
and IDs are passed in. Use cases orchestrate (load → check → call domain → persist → emit)
and MUST NOT contain arithmetic, SQL, `drizzle`, `fetch` or `axios`. `Clock` and
`IdGenerator` are injected ports; `Date.now()` and `crypto.randomUUID()` inside a use case
are rejected. Money MUST be `bigint` mills (1 KWD = 1000) or the `Money` type; `number` for
money is a defect. KWD rounds half-up at line level and totals are summed from rounded lines,
never recomputed from raw inputs. Bigint crosses JSON and the database losslessly, as a
string or `numeric(14,3)`. IDs are UUID v7; timestamps are `timestamptz` in UTC. The POS
computes totals by importing `packages/domain`, the same functions the API runs, so
`packages/domain` MUST stay free of Node-only code.

Rationale: money bugs are the one category that ends a POS business; one implementation in
two runtimes is what keeps the offline POS and the server agreeing.

### III. Tenant Isolation Enforced by the Database

Every tenant table MUST carry `company_id uuid NOT NULL` (and `business_id` where
applicable) with an RLS policy `USING (company_id = current_setting('app.company_id')::uuid)`,
an explicit `WITH CHECK`, and `FORCE ROW LEVEL SECURITY`. A new table MUST ship its policy,
its composite index starting with `company_id`, and a negative cross-tenant test in the same
PR. Child tables MUST use tenant-qualified composite foreign keys such as
`(company_id, business_id)` so a row can never reference another tenant's parent. All
business-data access MUST go through `withTenant(companyId, tx => …)`, which sets the GUC
transaction-locally; exporting the raw Drizzle client from `packages/db` is forbidden and a
test asserts it. Session-less entry points (gateway webhooks, messaging callbacks, worker
jobs) resolve the tenant from an identifier and use the same wrapper. The application role
is `NOSUPERUSER`, `NOBYPASSRLS`, owns no tenant table and has read-only access to shared
reference data such as `plans`.

The one named exception is the global-identity path: Better Auth's `user`, `session`,
`account` and `verification` tables carry no `company_id`, are reached only by a
narrowly-granted auth role with no `BYPASSRLS`, and `memberships` is keyed on
`app.user_id` so a just-authenticated user can discover their companies. The request flow is
authenticate → read memberships as the user → verify the requested company server-side →
`withTenant()`. This exception MUST be recorded by ADR before any auth migration is
generated, and `memberships` is the single authority for authorization.

Stock is never updated in place: insert a `stock_movements` row and derive balances with
`balance_after` cached. Financial records are immutable and reversible, never deleted; soft
delete applies only to items, customers, employees and categories. Platform super-admin
queries use a separate RLS-bypassing role exposed only inside the `platform` module.

Rationale: shared-table multi-tenancy is safe only when isolation is a database guarantee;
RLS cannot tell an authorised company id from an attacker-supplied one, so the API-level
membership check is a second, mandatory proof.

### IV. Module Boundaries Are Machine-Enforced

The backend is a modular monolith with the identical module shape in every module:
`domain/`, `use-cases/` (one folder per `<verb>-<noun>`), `queries/`, `ports/`,
`persistence/`, `http/` (or `jobs/` in the worker), `events/`, `<module>.module.ts` (the
only composition root) and `index.ts` (the only public surface). A module MAY import only
another module's `index.ts`; a deep path is a build failure. Allowed import arrows are
declared in `docs/module-map.md`; an undeclared arrow fails CI and adding one requires an
ADR. Cross-module side effects go through domain events written to the outbox in the same
transaction; cross-module reads go through a port the consumer defines and an adapter in
the consumer's `persistence/`. Read endpoints go through `queries/`, which MUST NOT import
`domain/` or `use-cases/` and MUST NOT write; only `reporting/queries/` may join across
bounded contexts. Banned folder names (`utils/`, `helpers/`, `common/`, `misc/`,
`managers/`, root `models/` or `services/`, `lib/` outside `packages/`) and file limits
(300 warn / 400 error lines, 60 lines per function) are ESLint errors. An abstraction is
added only under the four conditions in `CLAUDE.architecture.md` §12: two or more real
implementations, an uncontrolled boundary, a cycle to break, or a test that could not
otherwise exist. A new vertical is configuration and feature flags, never an `if` on
`vertical_type` inside a use case. Frontends follow the same rule: business-area folders
(`sell/`, `shift/`, `attendance/`, `offline/`, `orders/`, `inventory/`) with one `shared/`
holding nothing with business meaning; Next.js `app/` holds routes and thin re-exports only.

Rationale: boundaries that live in memory erode under AI-generated code; boundaries that
live in ESLint, dependency-cruiser and the module-map check do not.

### V. Test-Backed Delivery

Merging requires: exhaustive unit tests for every pure `domain/` function with no database;
integration tests for each use case (happy path plus listed edge cases) against real
Postgres (the compose stack, one cloned database per spec file — ADR-0006); RLS negative tests for every tenant table; a result-shape test
and an index-usage `EXPLAIN` assertion for every `queries/` file; and Playwright E2E for the
POS critical path (open shift → order → split payment → print → close shift, including the
offline toggle). The RLS suite runs as the restricted application role and MUST assert:
cross-tenant `SELECT` returns 0 rows, cross-tenant `INSERT` is rejected, cross-tenant
`UPDATE` and `DELETE` affect 0 rows, same-tenant `UPDATE` cannot change `company_id`,
`UPSERT` cannot cross tenants, a query outside `withTenant()` sees nothing, the setting does
not survive across pooled connections, exceptions, rollbacks or concurrent transactions, no
`SECURITY DEFINER` function touches tenant tables, and company A cannot reference company
B's rows through a foreign key. Endpoints that create money or stock effects MUST require
`Idempotency-Key`, run in one transaction and write their outbox event inside it; the
idempotency store keeps the replayable response, rejects a reused key with a different body
with `422`, returns `409` for a concurrent duplicate, and expires `IN_FLIGHT` rows. Every
controller method MUST carry a permission guard; a route without one fails CI, and auth
handler routes are listed explicitly as public.

Rationale: the CI order in `CLAUDE.md` §10 is the definition of "works"; anything not
covered by it is unverified.

### VI. Arabic-First, RTL-Native, One Owned Design System

The product is Arabic-first with English, RTL by default, KWD with three decimals, Hijri
and Gregorian dates, and branch-timezone display. All UI strings MUST come from
`packages/i18n` keys; hardcoded Arabic or English in JSX is a defect. Bilingual data lives
in `*_ar` / `*_en` columns with English required. CSS MUST use logical properties only
(`ps-`, `pe-`, `ms-`, `me-`, `start`, `end`); physical `left`/`right` spacing is rejected.
The single design system lives in `packages/ui`, built fresh with the shadcn CLI on Radix
primitives plus Tailwind tokens and Framer Motion presets, and is shared unchanged by
admin, POS and menu. The theme layer MUST be the DESIGN.md token set (neutral palette,
18px interactive radius, 24px card radius, compact 4px scale), extended with a dark variant,
semantic status colors for business states (paid, pending, failed, low stock, open shift)
and an Arabic font family paired with the Latin face. Forms use react-hook-form with the
Zod contract; tables use TanStack Table with server pagination; data fetching uses TanStack
Query through generated client hooks, never `fetch` in a component. No second component
library may be installed; icons are lucide. Third-party admin templates, including the
AdminCN reference copy, MAY be consulted for layout and table patterns but MUST NOT be
copied as code, because they are built on Base UI and physical CSS.

Rationale: RTL and Arabic typography cannot be retrofitted cheaply; one owned kit is what
makes admin and POS feel like the same product.

### VII. Documented Why, in Arabic, With the Code

Every exported `domain/` function, every `ports/` interface method and every event in
`events/published.ts` MUST carry an Arabic JSDoc comment explaining the business rule and
the why, with identifiers and tags left in English exactly as spelled in code; a JSDoc
block there with no Arabic letter fails `pnpm lint:docs`. Use cases, queries and non-obvious
schema columns carry a one-line comment. Comments that restate the code, closing comments
in JSX, `FIXME`, `HACK`, `XXX`, comments in `persistence/` and `http/` without a surprise,
and commented-out code are banned. A doc comment MUST change in the same commit as the
function it describes. No secret, key, token or real customer phone number may appear in a
comment or example.

Rationale: six months later the code still shows what; only the comment can recover why,
and a stale comment is believed.

## Product Scope & Domain Model

PosPay (`pospay.systems`) is a multi-tenant, multi-vertical business-management SaaS for
Kuwait: point of sale, inventory, appointments, staff attendance and commissions, customers
and loyalty, and reporting. Verticals are `restaurant`, `salon`, `laundry`, `retail` and
`services`, selected per business and expressed as a settings template plus feature flags.
Target scale is 10k to 50k organisations at roughly 50 KWD per shop per month. The name
"PosPay" is under legal review because the platform follows a bring-your-own-gateway model
and does not hold merchant funds.

The tenant hierarchy is `Company` (tenant root, owner, billing) → `Business`
(`vertical_type`, currency default KWD, timezone default Asia/Kuwait, settings) → `Branch`
(address, geo, opening hours, order-type × channel matrix, default stock location). Access
is `User` → `Membership` (scope COMPANY, BUSINESS or BRANCH, role, permission overrides).
Staff are `Employee` (optional user link, base salary, commission plan, schedule,
documents), `CashierPin` (per branch, hashed, lockout fields) and `Device` (per branch,
fingerprint, hashed token, approval, `ACTIVE` or `REVOKED`).

The catalog is `Item` (`PRODUCT` or `SERVICE`, bilingual names, base price, cost, tax,
barcode; services carry duration, resource type and staff requirement) with `ItemVariant`,
`ItemPrice` (branch, channel or order-type override) and option groups. Sales are `Order`
(type, channel, status, customer, staff, custom fields, subtotal, discount, service fee,
tax, tip, total, `client_id`, `idempotency_key`) → `OrderItem` (served-by staff,
appointment link, options) → `Payment` (method, amount, status, gateway ref, shift) and
`Return` (lines, refund, stock effect `RESTOCK`, `WASTE` or `NONE`). Operations are
`Appointment`, `CashShift` (device, opening float, counted, expected), `AttendanceSession`
(QR or manual source, geo, device, late minutes), `CommissionRule` (`PER_ITEM_PCT`,
`REVENUE_PCT`, `TIERED` with `MARGINAL` or `WHOLE` mode), `CommissionEntry` →
`CommissionStatement` (draft → approved → paid), and the inventory ledger `StockMovement`
(qty delta, unit cost, `balance_after`, source) with recipes, production, purchases,
transfers, counts and wastage. Cross-cutting rows are `AuditLog` (actor, entity, before,
after), `Outbox` (aggregate, event type, payload, published at) and `IdempotencyKey`.

Schema is declared in Drizzle, one file per bounded context under `packages/db/schema/`,
with Better Auth's tables generated into the same schema. `plans` is shared reference data
without RLS and is read-only to the application role.

## Module Map & Integration Contracts

The backend modules are `tenancy`, `identity`, `settings`, `files`, `platform`, `catalog`,
`customers`, `expenses`, `inventory`, `staff`, `realtime`, `notifications`, `orders`,
`payments`, `cash`, `appointments`, `commissions`, `loyalty`, `channels`, `kitchen` and
`reporting`. Import arrows point only down that list: `tenancy`, `notifications`,
`kitchen` and `reporting` import nothing; `identity`, `settings`, `files`, `platform`,
`catalog`, `customers`, `expenses`, `inventory`, `orders`, `payments`, `appointments` and
`channels` import `tenancy`; `staff` imports `tenancy` and `identity`; `realtime` and
`cash` import `identity`; `commissions` imports `staff`; `loyalty` imports `customers`.
`packages/auth` is imported only by `identity`, `packages/payments` only by `payments`,
`packages/storage` only by `files`, `packages/notifications` only by `notifications`, and
`packages/documents` only by `reporting` and worker jobs. `pos` is a frontend app, not a
backend module.

Ports are for reads: `orders` defines `CatalogReaderPort` and `CustomerCreditPort`;
`payments` defines `OrderTotalsPort`; `cash` defines `ShiftPaymentsPort` (tenders including
`PENDING_GATEWAY`); `appointments` defines `ServiceCatalogPort` and `StaffAvailabilityPort`;
`commissions` defines `EmployeePlanPort`; `channels` defines `ChannelFeePort`; `realtime`
defines `ChannelScopePort`. Events are for state changes: `OrderCreated`, `OrderCompleted`,
`OrderCancelled`, `ServiceCompleted`, `ReturnPosted`, `PaymentCaptured`, `PaymentRefunded`,
`PaymentFailed`, `CashShiftClosed`, `AttendanceClocked`, `AppointmentBooked`,
`AppointmentCompleted`, `StockPosted`, `DeviceRegistered`, `DeviceRevoked`,
`GatewayAccountConnected`, `NotificationDelivered`, `NotificationFailed` and
`DocumentReady`, each consumed by its business handlers and by the `realtime` publisher.
Consumers are idempotent by `event_id`; replay is a supported recovery tool. Changing an
arrow means editing `docs/module-map.md` and its YAML in the same PR, with an ADR; a port
is tried first, an event second, an import last.

## Engine Designs

Rotating-QR attendance: a branch tablet displays a token `HMAC(branch_id ‖ window ‖ secret)`
refreshed every 60 seconds from a per-branch secret in Redis rotated daily; the employee PWA
scans and posts token, geo and device fingerprint; the server accepts the current or
previous window, checks branch membership, optional geofence and a five-minute dedupe, then
toggles IN or OUT. Lateness is computed in `domain/` against the schedule and feeds
commissions.

Commission engine: rules are data evaluated by one pure `computeCommission(entry, rules,
context)`; rule types are `PER_ITEM_PCT` (split among `served_by`), `REVENUE_PCT` and
`TIERED` (`MARGINAL` or `WHOLE`), with rating multiplier, attendance deduction and negative
entries on refund. `ServiceCompleted` → immutable `CommissionEntry` → monthly statement →
manager approval → payroll export. A new rule type is a new evaluator, never an `if`.

Local-first POS: the device pulls a versioned catalog, price and customer snapshot into
IndexedDB; orders are created locally with UUID v7 and an idempotency key, queued in a sync
outbox and pushed by the service worker; the server applies idempotently and wins on price
conflicts while the order keeps its captured price with an audit row. Cash and credit
complete offline; card and KNET require online and queue as pending. Receipts print through
a LAN print agent with browser fallback.

Reliability: the outbox is written in the change's transaction and dispatched by the worker;
inbound webhooks verify signature → store raw → enqueue → ack 200 and dedupe by provider
event id. Payment state is set only by a verified webhook or a server-side poll, never by
the client. Gateways implement `PaymentGateway` behind a capability matrix; an unsupported
capability (KNET Direct has no refund API) is declared, never a method that throws.

Performance: one list is one query with visible joins; every filter column has a composite
index starting with `company_id`; hot reads (menu, prices, settings, flags) come from Redis
with invalidation owned by the data's module; anything over 200 ms is a BullMQ job; reports
are raw SQL files under `packages/db/sql/reports/` with their own tests; POS hot paths use
prepared statements and at most three hops from controller to SQL; cursor pagination
everywhere; no `SELECT *` in list endpoints; no in-memory session or tenant cache, because a
second `api` container is on the scaling path.

## Identity & Access

Six principals sign in six ways. Owners and managers use email, password and TOTP 2FA on
`app.pospay.systems`. Cashiers use a 4 to 6 digit PIN on an already-registered shared branch
device, verified locally against a stored hash so a shift can open offline and re-verified
on sync. Branch devices hold a long-lived revocable token issued once after a manager
approves a one-time pairing code. Employees use phone OTP on their own phone for QR
attendance. Customers use phone OTP on `menu.pospay.systems` with no access to business
data. Integrations use scoped, revocable API keys. Auth is Better Auth self-hosted on the
Drizzle adapter with the `organization`, `two-factor`, `phone-number` and `api-key`
plugins, plus the `identity` module for PINs, devices and RBAC; hosted per-MAU providers
are disqualified on unit economics. RBAC is three-level (company, business, branch) with
roles such as `OWNER`, `MANAGER`, `ACCOUNTANT`, `CASHIER` and `STAFF` plus per-user
overrides, checked by `@Require('action:resource:scope')` server-side on every request from
the resolved membership; the same matrix hides UI actions but never replaces the server
check. PIN attempts, OTP requests, logins, webhook endpoints and outbound sends are
rate-limited in Redis. Every sensitive action (PIN change, device approval or revocation,
role change, refund, price override, gateway connect, private-file access, marketing send)
writes an `AuditLog` row whose `before`/`after` fields follow an allowlist so hashes and
tokens never land in the audit trail.

Domains follow ADR-0001: `app.` for admin, `platform.` for the super-admin, `pos.`,
`menu.`, `api.` and `cdn.`; the worker has no subdomain. The session cookie is scoped to
`.pospay.systems` with `SameSite=Lax`, `Secure`, `HttpOnly`; the platform session is fully
separate. `api.` stays DNS-only on Cloudflare because SSE needs long-lived connections.
Staging lives under `staging.pospay.systems` with its own cookie domain.

## Technology & Security Constraints

The stack is fixed by `docs/06_Tech_Stack_Architecture_EN.md` and ADR-0002 and MAY change
only by ADR: TypeScript everywhere on Node.js 24 LTS; pnpm 12 workspaces with Turborepo
2.11; TypeScript 6.0 (pinned below 7 until typescript-eslint supports it); ESLint 10 with
`eslint-plugin-boundaries`, `eslint-plugin-jsdoc` and Prettier in `packages/config`; Next.js
App Router for `admin` and `menu`; Vite React PWA with Dexie for `pos` (also hosting staff
routes); NestJS on the Fastify adapter for `api` and `worker` with BullMQ, sharing one
image with different entrypoints; PostgreSQL 16 with RLS through Drizzle and drizzle-kit;
Redis 7; Better Auth self-hosted; Cloudflare R2 for objects (Garage only for offline dev);
Playwright and ExcelJS in the worker for documents; MyFatoorah first, then Tap and KNET
Direct, as gateway adapters; WhatsApp Cloud API and Resend or SES for messaging; pino with
a redaction list plus OpenTelemetry; SSE at `GET /v1/stream` with channels resolved from the
session and polling fallback; one Docker image per app deployed by Dokploy behind Traefik
with per-host certificates. pnpm build scripts are denied by default and approved line by
line; the minimum release age stays on. The shared kernel `packages/domain` MUST have an
empty `dependencies` object.

Security rules are absolute: only `packages/auth` may issue or verify a session, hash a
password or hash a PIN. Third-party credentials are envelope-encrypted at rest with a master
key that lives only in Dokploy secrets, decrypted only inside the owning package, never
returned by an API, never logged, never visible to platform super-admins. Secrets come only
from env and `.env.example` carries empty keys. Uploads are content-sniffed, size-capped,
re-encoded and stored under keys we generate, never on disk. Every log line carries
`request_id`, `company_id`, `branch_id` when present and `user_id`, never PINs, tokens,
credentials, full phone numbers (last three digits only) or employee documents; request
bodies are logged only on error after redaction. Redaction ships with the first API
skeleton, before any real request is logged. Never pass a closure, file handle or open
transaction into a job; only a serialisable payload carrying `company_id`.

## Development Workflow & Quality Gates

Conventional commits; one slice per branch named `feat/<phase>-<slice>-<name>`; one branch
per PR; never commit to `main`. The PR description links the spec and carries the checklist
(spec, migration, RLS, indexes, tests, i18n, doc comments, docs). CI MUST pass in this
order: typecheck → lint → lint:docs → boundaries → cycles → module-map check → unit →
integration → RLS negative → EXPLAIN checks → build all apps → docker images. A minimal
gate (typecheck, lint, unit) exists from the first slice and grows. Images are built in CI,
tagged by commit SHA, never `latest`, and pushed to GHCR. Migrations run as their own step
before containers start, follow expand/contract, add indexes `CONCURRENTLY`, are never
destructive in the same release as the code change, and after every migration the previous
image is run against the new schema in staging to prove rollback. Every service declares a
healthcheck, a memory limit and a restart policy; `/health` and `/ready` are separate checks
on `api` and `worker`. Backups are two paths: nightly encrypted `pg_dump` to Backblaze B2 and
physical base backup with continuous WAL archiving for point-in-time recovery, with RPO ≤ 5
minutes and RTO ≤ 2 hours, both checking in to Healthchecks.io and both rehearsed. A deploy
that cannot be rolled back in one click is not finished. When a request conflicts with a
rule here or in the governing docs, the assistant MUST stop and ask; when a plan conflicts
with a rule, the rule wins and the plan is wrong. Reviews use the nine-question checklist in
`CLAUDE.architecture.md` §14.

## Delivery Roadmap & Open Decisions

Delivery order: Phase 0 foundation (tenancy, identity, settings, i18n, audit, outbox,
idempotency, observability, CI, staging, backups, RLS proofs; no frontend, no UI, no design
system), then Phase 1 staff → QR attendance → commissions (salon pilot), Phase 2 catalog →
orders → payments → cash shifts → POS PWA → realtime (restaurant pilot), Phase 3 inventory
→ recipes → kitchen, Phase 4 appointments → e-menu → loyalty → channels, Phase 5 reporting →
documents → platform admin → subscriptions. Phase 0 runs slices T0 to T13 on the critical
path T0 → T1 → T3 → T4 → T6a → T5 → T6b → T7 → T8 → T9 → T12b → T13 over a forecast six to
eight weeks, with the auth-RLS boundary decided before any schema is generated and the
worker bootstrap plus outbox dispatcher shipping with staging. The `packages/ui` foundation
described in Principle VI is its own phase-scoped slice after Phase 0.

Open product decisions that block specific slices and MUST be answered by the owner, never
guessed: the product name for invoices and WABA (blocks templates); the launch plans and
their feature flags (blocks the plan seed); the exact role codes (blocks identity); PIN
length and lockout policy (blocks identity); device token lifetime and renewal window
(blocks identity); the staging host (blocks deploy); and the canonical source of branch
timezone versus business timezone (blocks attendance). The estimate in the stack doc's
delivery section is known to be optimistic and is superseded by the phase-0 plan.

## Governance

This constitution supersedes informal guidelines, personal style and runtime agent
suggestions. It distills and ranks the governing documents. On conflict:
`docs/06_Tech_Stack_Architecture_EN.md` wins on technology, `CLAUDE.architecture.md` wins on
structure and dependency direction, `CLAUDE.md` (mirrored by `AGENTS.md`) wins on workflow,
`docs/module-map.md` is the executable list of allowed arrows, and this constitution binds
the Spec Kit workflow (`/speckit-specify`, `/speckit-plan`, `/speckit-tasks`,
`/speckit-checklist`, `/speckit-implement`) to all of them. Amendments require a documented rationale, an ADR when
the change is architectural or technological, and a version bump: MAJOR for removing or
redefining a principle, MINOR for adding a principle or section or materially expanding
guidance, PATCH for clarifications. Every PR review MUST verify compliance with Principles
I–VII; any added complexity MUST be justified against `CLAUDE.architecture.md` §12.
`CLAUDE.md` remains the runtime guidance file for day-to-day development.

**Version**: 2.0.1 | **Ratified**: 2026-09-16 | **Last Amended**: 2026-09-23
