<!--
Sync Impact Report — 2026-09-22
Version change: (unfilled template) → 1.0.0
Modified principles: none (initial ratification)
Added sections:
  - Core Principles I–VII (all new)
  - Technology & Product Constraints
  - Development Workflow & Quality Gates
  - Governance
Removed sections: none
Templates: none modified by this command; dependent templates read this file at runtime.
Follow-up TODOs:
  - docs/06_Tech_Stack_Architecture_EN.md header reads "V1.2" while CLAUDE.md refers to it
    as "V1.4". Reconcile the version stamp in the source document (not a constitution change).
  - CLAUDE.architecture.md §16 lists three open items (packages/domain missing from 06 §2,
    an ADR for "pragmatic Clean Architecture", extraction of docs/module-map.yaml). Track them
    as ADRs/issues; they are not governance gaps.
-->

# PosPay Constitution

## Core Principles

### I. One Vertical Slice at a Time

Work is delivered as **one use case per branch, one branch per PR**, never a whole module.
A slice MUST begin with its spec at `docs/specs/<module>/<use-case>.md` (requirements,
business rules, edge cases, acceptance criteria, schema changes, API contract, permissions,
tests). Implementation MUST then follow this order: contract (Zod) → migration + RLS policy →
domain functions + unit tests → use case → adapters (persistence, http) → integration tests →
UI. A slice MUST NOT touch modules outside its scope; if it must, the PR says so and why.
Every architectural decision is recorded in `docs/adr/NNNN-title.md`. A slice is done only
when `pnpm check` is green and the definition of done in `CLAUDE.architecture.md` §15 passes.

**Rationale:** a solo developer working with AI needs small, reviewable, reversible units.
Spec-first keeps business rules explicit instead of guessed; the fixed order keeps the
contract and the schema honest before any UI exists.

### II. Screaming Architecture and the Dependency Rule

Every backend module has the identical shape: `domain/`, `use-cases/`, `queries/`, `ports/`,
`persistence/`, `http/` (or `jobs/` in the worker), `events/`, `<module>.module.ts`, `index.ts`.
Dependencies point inward only. A module MUST import another module solely through its
`index.ts`; a deep path is a build failure. Cross-module **side effects** MUST go through
domain events written to the outbox; cross-module **reads** MUST go through a port the
consumer defines in its own `ports/`. Every allowed arrow is declared in `docs/module-map.md`;
an undeclared arrow fails CI and adding one requires an ADR. Circular dependencies are
forbidden. Banned folder names (`utils/`, `helpers/`, `common/`, `misc/`, `managers/`, root
`models/` or `services/`, `lib/` outside `packages/`) MUST NOT appear; one `shared/` per app is
allowed only for code with no business meaning. An interface with a single implementation is
added only when justified by `CLAUDE.architecture.md` §12.

**Rationale:** identical module shape lets a stranger (or an AI) open any folder and know
where the business rule, the write path and the read path live. Ports and events are how
cycles are broken without a service-mesh of direct calls.

### III. Business Rules Are Pure Domain Functions

Totals, tax, discounts, tips, commissions, stock costing, unit conversion, attendance lateness
and status transitions MUST live in `domain/` (or `packages/domain`) as pure functions with
zero imports outside `packages/domain`. A use case MUST contain no arithmetic, no SQL and none
of the words `drizzle`, `sql`, `fetch` or `axios`. `Clock` and `IdGenerator` are injected
ports; `Date.now()` or `crypto.randomUUID()` inside a use case is rejected. Controllers, jobs
and React components MUST NOT hold business logic. Read endpoints go through `queries/`, which
may never import `domain/` or `use-cases/` and may never write. The POS MUST compute totals by
importing `packages/domain`, the same functions the API uses; re-implementing pricing in the
browser is a money bug.

**Rationale:** money logic that runs without a database is the only money logic that can be
exhaustively tested, and one implementation shared by server and offline POS is the only way
the two can agree.

### IV. Tenant Isolation and Data Integrity

Every tenant table MUST carry `company_id uuid NOT NULL` (plus `business_id` where
applicable) and an RLS policy; a new table ships with its policy and a negative isolation test
in the same PR. All database access MUST go through `withTenant(companyId, tx => …)`; the raw
Drizzle client is never exported from `packages/db`. Webhooks, messaging callbacks and worker
jobs resolve the tenant from an identifier and use the same wrapper. Schema changes happen only
via Drizzle migrations (`pnpm db:migrate`), never by hand and never with `db push` in shared
environments. IDs are UUID v7; timestamps are `timestamptz` in UTC. Money is `numeric(14,3)` in
Postgres and `bigint` mills or the `Money` type in TypeScript, never `number`. Stock quantities
are never updated directly: a `stock_movements` row is inserted and balances are derived. Soft
delete exists only for items, customers, employees and categories; everything financial is
immutable and reversible, never deleted. Every RLS predicate column and FK is indexed, and the
migration that adds a query adds its index.

**Rationale:** multi-tenant SaaS fails catastrophically on one missed `WHERE company_id`.
RLS plus a single transaction wrapper makes isolation a database guarantee rather than a code
review hope; integer mills and derived balances make money and stock auditable.

### V. Test-First Quality Gates (NON-NEGOTIABLE)

The following are required to merge: exhaustive unit tests for every pure `domain/` function
with no database; integration tests for every use case (happy path plus listed edge cases)
against real Postgres via testcontainers; RLS negative tests for every tenant table
(cross-tenant read = 0 rows, write = error); a result-shape test and an `EXPLAIN ANALYZE`
assertion for every `queries/` file; Playwright E2E for the POS critical path (open shift →
order → split payment → print → close shift, including offline). CI MUST pass in this order:
typecheck → lint (incl. max-lines) → lint:docs → boundaries → cycles → module-map check → unit →
integration → RLS negative → EXPLAIN checks → build all apps → docker images. Any endpoint that
creates money or stock effects requires an `Idempotency-Key`, runs in one transaction and
writes its outbox event inside that transaction. No endpoint ships without a permission guard.

**Rationale:** the gates are ordered from cheapest to most expensive so a failing slice is
rejected early. Each gate exists because the corresponding rule cannot be verified by reading.

### VI. Security by Construction

Only `packages/auth` may issue or verify a session, hash a password or hash a PIN. Only
`packages/payments` may talk to a gateway or decrypt gateway credentials. All third-party
credentials are envelope-encrypted at rest, decrypted only inside the owning package, never
returned by an API, never logged and never visible to platform super-admins. Authorization is
checked server-side from the resolved membership via `action:resource:scope` permission
strings on every controller method; never from a client claim and never only in the UI.
Payment state is never set by the client; only a verified webhook or a server-side poll moves a
payment to `CAPTURED`, `FAILED` or `REFUNDED`. Inbound webhooks verify signature → store raw →
enqueue → ack. Uploads are never trusted: type from content, size capped, images re-encoded,
key generated by us, stored in R2. PIN attempts, OTP, login, webhooks and outbound sends are
rate-limited in Redis. Logs carry `request_id`, `company_id`, `branch_id` and `user_id` and
MUST NOT contain PINs, tokens, credentials, full customer phone numbers or employee documents.
Secrets, keys, tokens and real customer data MUST NOT appear in code, comments or examples.
Every change to prices, discounts, permissions, payments, refunds, stock posts, settings,
device approval, gateway connection, private-file access or marketing sends writes an
`AuditLog` row that lives in Postgres forever.

**Rationale:** concentrating each dangerous capability in exactly one package makes it
reviewable; server-side truth for payments and permissions is what keeps a compromised client
from moving money.

### VII. Documentation Is Part of the Deliverable

A comment explains the **why**, never the what. Arabic JSDoc is mandatory, with no exceptions,
on every exported function in `domain/**` (description, business rule, `@param` for every
argument, `@returns`), every interface method in `ports/**` and every event in
`events/published.ts`. Lighter one-line comments are required above every use case class,
above every `queries/` SQL (naming the consuming screen) and on any non-obvious schema column.
Identifiers, type names and JSDoc tags stay in English exactly as written in code. Closing
comments (`{/* end div */}`), `FIXME`, `HACK`, `XXX`, comments that restate the code and
commented-out code are banned outright. A doc comment MUST change in the same commit as the
code it describes. `pnpm lint:docs` enforces this as a CI gate. Files are capped at 300 lines
(warn) / 400 (error), functions at 60 lines, one React component per file, one NestJS
controller per resource; oversize files are split by responsibility, never by line count.

**Rationale:** the *why* of a money rule cannot be recovered from the code six months later,
and a stale comment is worse than none because it is believed.

## Technology & Product Constraints

- **Product:** multi-tenant, multi-vertical business-management SaaS (POS, inventory,
  appointments, staff attendance and commissions, customers/loyalty, reporting). Arabic-first
  plus English, RTL, KWD with 3 decimals. Modular monolith. Solo developer plus AI.
- **Stack** is decided in `docs/06_Tech_Stack_Architecture_EN.md` and is not re-litigated per
  slice: TypeScript end-to-end; pnpm workspaces + Turborepo; NestJS on the Fastify adapter for
  `api` and `worker` (separate containers); Next.js for `admin` and `menu`; Vite React PWA
  (Dexie/IndexedDB, local-first) for `pos`; PostgreSQL via Drizzle; Redis + BullMQ; Better Auth;
  Cloudflare R2 for objects; Tailwind + shadcn/ui + Framer Motion in `packages/ui`.
- **Introducing a new framework, library or language requires an ADR.** No second component
  library. Icons are lucide.
- **Workspace layout** is fixed to the `apps/` and `packages/` list in `CLAUDE.md` §2.1; new
  top-level folders are not invented.
- **API:** contracts are Zod schemas in `packages/contracts` with no hand-written duplicate
  types; REST under `/v1`; cursor pagination; error envelope `{ code, message_ar, message_en,
  details? }`. Anything expected to exceed 200 ms is a BullMQ job in `worker`. One SSE endpoint
  `GET /v1/stream` whose channels are resolved server-side; SSE is never the source of truth.
- **Frontend:** all strings via `packages/i18n` keys; logical CSS properties only (`ps-`, `pe-`,
  `ms-`, `me-`, `start`, `end`), never `left`/`right`; react-hook-form + Zod from contracts;
  TanStack Table with server pagination; TanStack Query via generated client hooks, no fetch in
  components; business-named folders in `apps/pos/src` and `apps/admin/src`, with Next.js
  `app/` holding routes and thin re-exports only. The POS writes to IndexedDB first and syncs
  via an outbox queue; it never blocks the UI on network.
- **Bilingual data:** `name_ar` / `name_en` columns, English required, Arabic optional unless
  the spec says otherwise.
- **Secrets** only via environment variables with `.env.example` kept current; the master
  encryption key lives only in Dokploy secrets.

## Development Workflow & Quality Gates

- **Branching and commits:** one slice per branch, one branch per PR, never commit to `main`.
  Branch names follow `feat/<phase>-<slice-id>-<short-name>`; commits follow Conventional
  Commits (`feat(orders): …`). The PR description links the spec and carries the checklist:
  spec, migration, RLS, indexes, tests, i18n, doc comments, docs.
- **Before declaring done:** `pnpm check` (typecheck → lint → test → lint:docs) is green and
  every box in `CLAUDE.architecture.md` §15 is ticked.
- **Ambiguity:** a business rule that is not in the spec is never guessed. The author asks, or
  marks `TODO(spec)` and stops. If a request conflicts with a rule in this constitution or the
  governing documents, the author stops and asks rather than silently breaking the rule.
- **Scope discipline:** no "refactor everything", no reformatting of unrelated files, no
  `*Service` classes that accumulate unrelated methods, in a slice PR.
- **Delivery:** images are built in CI, tagged by commit SHA (never `latest`), pushed to GHCR
  and pulled by Dokploy. Migrations run as their own step before new containers start, follow
  expand/contract, add indexes `CONCURRENTLY`, and are never destructive in the same release as
  the code change. Every service declares a healthcheck, a memory limit and a restart policy;
  `api` and `worker` expose `/health` and `/ready`. A deploy that cannot be rolled back in one
  click is not finished.

## Governance

This constitution is the top of the project's rule hierarchy for Spec Kit workflows
(`/speckit-specify`, `/speckit-plan`, `/speckit-tasks`, `/speckit-implement`). It distils, and
MUST stay consistent with, the three governing documents:

- `docs/06_Tech_Stack_Architecture_EN.md` — **what** we build with. Wins on technology.
- `CLAUDE.architecture.md` — **how the code is shaped**. Wins on structure and dependency
  direction.
- `CLAUDE.md` — day-to-day rules. Wins on workflow.

Where this constitution and a governing document disagree, the governing document is the
source of truth for its domain and this constitution MUST be amended to match; the
disagreement itself is a defect to fix, not a licence to pick the more convenient rule.

**Amendment procedure.** Any change to a principle or section is made through a PR that
(1) updates this file, (2) bumps the version below, (3) records the change in the Sync Impact
Report comment at the top of the file for review, and (4) where the change alters an
architectural decision, adds or updates an ADR in `docs/adr/`. Rules with machine enforcement
(ESLint, `lint:docs`, boundaries, cycles, module-map, RLS tests) MUST have their enforcement
updated in the same PR.

**Versioning policy.** Semantic versioning: MAJOR for removing or redefining a principle in a
backward-incompatible way; MINOR for adding a principle or section or materially expanding
guidance; PATCH for clarifications, wording and typo fixes.

**Compliance review.** Every spec, plan and PR is checked against the Core Principles. Any
added complexity (a new abstraction, a new dependency arrow, a new library) MUST be justified
in writing against `CLAUDE.architecture.md` §12 and, where required, an ADR. `CLAUDE.md` is
the runtime guidance the AI reads on every task; this constitution is what that guidance is
accountable to.

**Version**: 1.0.0 | **Ratified**: 2026-09-22 | **Last Amended**: 2026-09-22
