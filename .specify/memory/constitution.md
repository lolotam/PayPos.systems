<!--
Sync Impact Report
- Version change: (unfilled template) → 1.0.0
- Modified principles: none (initial ratification)
- Added sections:
  - Core Principles I–VII
  - Technology & Security Constraints
  - Development Workflow & Quality Gates
  - Governance
- Removed sections: none
- Templates requiring updates: none checked in this pass; spec/plan/tasks templates
  read the constitution at runtime.
- Follow-up TODOs: none
-->

# PosPay Constitution

## Core Principles

### I. One Vertical Slice at a Time

Work is delivered as single use cases, never whole modules. Every slice MUST begin with a
spec at `docs/specs/<module>/<use-case>.md` covering requirements, business rules, edge cases,
acceptance criteria, schema changes, API contract, permissions and tests. Implementation MUST
follow this order: Zod contract → migration + RLS policy → domain functions + unit tests →
use case → adapters (persistence, http) → integration tests → UI. A slice MUST NOT touch
modules outside its scope without stating why. Every architectural decision MUST be recorded
as `docs/adr/NNNN-title.md`. A slice is done only when the checklist in
`CLAUDE.architecture.md` §15 passes and `pnpm check` is green.

Rationale: a solo developer working with AI needs small, verifiable increments; a spec written
before code is the only place the business intent survives.

### II. Domain Purity and Money Correctness (NON-NEGOTIABLE)

All business arithmetic (totals, tax, discounts, tips, commissions, stock costing, lateness,
unit conversion, status transitions) MUST live in `domain/` as pure functions with zero
imports outside `packages/domain`. Use cases orchestrate and MUST NOT contain arithmetic,
SQL, `drizzle`, `fetch` or `axios`. `Clock` and `IdGenerator` are injected ports;
`Date.now()` and `crypto.randomUUID()` inside a use case are rejected. Money MUST be
`bigint` mills (1 KWD = 1000) or the `Money` type; `number` for money is a defect. IDs are
UUID v7; timestamps are `timestamptz` in UTC. The POS MUST compute totals by importing
`packages/domain`, never by re-implementing pricing in the browser.

Rationale: money bugs are the one category that ends a POS business; deterministic pure
functions are the only code that can be exhaustively tested without a database.

### III. Tenant Isolation Enforced by the Database

Every tenant table MUST carry `company_id uuid NOT NULL` (and `business_id` where applicable)
with a Row-Level Security policy. A new table MUST ship its policy and a negative cross-tenant
isolation test in the same PR. All database access MUST go through
`withTenant(companyId, tx => …)`; exporting the raw Drizzle client from `packages/db` is
forbidden. Session-less entry points (gateway webhooks, messaging callbacks, worker jobs)
resolve the tenant from an identifier and then use the same wrapper. Stock is never updated
in place: insert a `stock_movements` row and derive balances. Financial records are immutable
and reversible, never deleted; soft delete applies only to items, customers, employees and
categories. Every RLS predicate column and every FK MUST be indexed in the migration that
introduces the query.

Rationale: multi-tenant SaaS with shared tables is only safe when isolation is a database
guarantee rather than an application convention.

### IV. Module Boundaries Are Machine-Enforced

The backend is a modular monolith with the identical module shape from `CLAUDE.md` §2.2
(`domain/`, `use-cases/`, `queries/`, `ports/`, `persistence/`, `http/`, `events/`,
`<module>.module.ts`, `index.ts`). A module MAY import only another module's `index.ts`.
Allowed dependency arrows are declared in `docs/module-map.md`; an undeclared arrow fails CI
and adding one requires an ADR. Cross-module side effects go through domain events written
to the outbox in the same transaction; cross-module reads go through a port the consumer
defines. Read endpoints go through `queries/`, which MUST NOT import `domain/` or
`use-cases/` and MUST NOT write. Banned folder names (`utils/`, `helpers/`, `common/`,
`misc/`, `managers/`, root `models/` or `services/`, `lib/` outside `packages/`) and the
file limits (300 warn / 400 error lines, 60 lines per function) are ESLint errors. An
abstraction is added only under the four conditions in `CLAUDE.architecture.md` §12.

Rationale: boundaries that live in memory erode under AI-generated code; boundaries that
live in ESLint, dependency-cruiser and the module-map check do not.

### V. Test-Backed Delivery

Merging requires: exhaustive unit tests for every pure `domain/` function with no database;
integration tests for each use case (happy path plus listed edge cases) against real
Postgres via testcontainers; RLS negative tests for every tenant table; a result-shape test
and an `EXPLAIN ANALYZE` assertion for every `queries/` file; and Playwright E2E for the POS
critical path (open shift → order → split payment → print → close shift, including offline).
Endpoints that create money or stock effects MUST require `Idempotency-Key`, run in one
transaction and write their outbox event inside it. Every controller method MUST carry a
permission guard; a route without one fails CI.

Rationale: the CI order in `CLAUDE.md` §10 is the definition of "works"; anything not
covered by it is unverified.

### VI. Arabic-First, RTL-Native, One Owned Design System

The product is Arabic-first with English, RTL by default, KWD with three decimals. All UI
strings MUST come from `packages/i18n` keys; hardcoded Arabic or English in JSX is a defect.
CSS MUST use logical properties only (`ps-`, `pe-`, `ms-`, `me-`, `start`, `end`); physical
`left`/`right` spacing is rejected. The single design system lives in `packages/ui`, built
fresh with the shadcn CLI on Radix primitives plus Tailwind tokens and Framer Motion presets,
and is shared unchanged by admin, POS and menu. The theme layer MUST be the DESIGN.md token
set (neutral palette, 18px interactive radius, 24px card radius, compact 4px scale), extended
with a dark variant, semantic status colors for business states (paid, pending, failed, low
stock, open shift) and an Arabic font family paired with the Latin face. No second component
library may be installed; icons are lucide. Third-party admin templates (including the
AdminCN reference copy) MAY be consulted for layout and table patterns but MUST NOT be
copied as code, because they are built on Base UI and physical CSS.

Rationale: RTL and Arabic typography cannot be retrofitted cheaply; one owned kit is what
makes admin and POS feel like the same product.

### VII. Documented Why, in Arabic, With the Code

Every exported `domain/` function, every `ports/` interface method and every event in
`events/published.ts` MUST carry an Arabic JSDoc comment explaining the business rule and
the why, with identifiers and tags left in English exactly as spelled in code. Use cases,
queries and non-obvious schema columns carry a one-line comment. Comments that restate the
code, closing comments in JSX, `FIXME`, `HACK`, `XXX` and commented-out code are banned and
fail `pnpm lint:docs`. A doc comment MUST change in the same commit as the function it
describes.

Rationale: six months later the code still shows what; only the comment can recover why,
and a stale comment is believed.

## Technology & Security Constraints

The stack is fixed by `docs/06_Tech_Stack_Architecture_EN.md` V1.4 and MAY change only by
ADR: TypeScript everywhere; pnpm workspaces + Turborepo; Next.js App Router for admin and
menu; Vite React PWA (Dexie, service worker, sync outbox) for POS; NestJS on Fastify for API
and worker with BullMQ; PostgreSQL 16 with RLS through Drizzle and drizzle-kit migrations;
Redis 7; Better Auth self-hosted plus the `identity` layer for cashier PIN, device tokens and
RBAC; Cloudflare R2 for objects; pino + OpenTelemetry for observability; one Docker image per
app deployed by Dokploy behind Traefik.

Security rules are absolute: only `packages/auth` may issue or verify a session, hash a
password or hash a PIN. Third-party credentials are envelope-encrypted at rest, decrypted only
inside the owning package, never returned by an API, never logged. Secrets come only from env.
Authorization is resolved server-side from membership, never from a client claim. Payment
state moves only by verified webhook or server-side poll. Uploads are content-sniffed,
size-capped, re-encoded and stored under keys we generate. Logs carry `request_id`,
`company_id`, `branch_id`, `user_id` and never PINs, tokens, credentials, full phone numbers
or employee documents. An immutable `AuditLog` row is written for every change to prices,
discounts, permissions, payments, refunds, stock posts, settings, devices, gateways,
private-file access and marketing sends. No secret or real customer data may appear in a
comment or example.

## Development Workflow & Quality Gates

Conventional commits; one slice per PR; the PR description links the spec and carries the
checklist (spec, migration, RLS, indexes, tests, i18n, doc comments, docs). CI MUST pass in
this order: typecheck → lint → lint:docs → boundaries → cycles → module-map check → unit →
integration → RLS negative → EXPLAIN checks → build all apps → docker images. Images are
tagged by commit SHA, never `latest`. Migrations run as their own step before containers
start, follow expand/contract, add indexes `CONCURRENTLY`, and are never destructive in the
same release as the code change. Every service declares a healthcheck, memory limit and
restart policy; a deploy that cannot be rolled back in one click is not finished. Anything
expected to exceed 200 ms runs as a worker job. When a request conflicts with a rule here or
in the governing docs, the assistant MUST stop and ask rather than silently break the rule;
unknown business rules are marked `TODO(spec)` and work stops there.

## Governance

This constitution distills and ranks the three governing documents. On conflict:
`docs/06_Tech_Stack_Architecture_EN.md` wins on technology, `CLAUDE.architecture.md` wins on
structure and dependency direction, `CLAUDE.md` wins on workflow, and this constitution binds
the Spec Kit workflow (`/speckit-specify`, `/speckit-plan`, `/speckit-tasks`,
`/speckit-implement`) to all three. Amendments require a documented rationale, an ADR when
the change is architectural or technological, and a version bump: MAJOR for removing or
redefining a principle, MINOR for adding a principle or materially expanding guidance, PATCH
for clarifications. Every PR review MUST verify compliance with Principles I–VII; any added
complexity MUST be justified against `CLAUDE.architecture.md` §12. `CLAUDE.md` remains the
runtime guidance file for day-to-day development.

**Version**: 1.0.0 | **Ratified**: 2026-09-22 | **Last Amended**: 2026-09-22
