# CLAUDE.md — Project rules for AI-assisted development

> Read this file fully before any task.
>
> **The three documents that govern this project:**
> - `06_Tech_Stack_Architecture_EN.md` — **what** we build with (stack, engines, infrastructure). Currently V1.4.
> - `CLAUDE.architecture.md` — **how the code is shaped** (folder structure, layers, dependency rules). Currently A1.0.
> - **This file** — the day-to-day rules the AI must obey while writing a slice.
>
> On conflict: `06` wins on technology, `CLAUDE.architecture.md` wins on structure and dependency direction, this file wins on workflow.
>
> Deeper docs: `docs/module-map.md`, `docs/domain-model.md`, `docs/security.md`, `docs/adr/*`.
> If a rule here conflicts with a request, **stop and ask** — do not silently break a rule.
>
> **Changelog**
> - **V3 (2026-09-16)** — Added **§3.1 Comments & documentation**: Arabic JSDoc is mandatory on `domain/**`, `ports/**` and `events/published.ts`; closing comments, `FIXME`, `HACK` and commented-out code are banned; a doc comment must move in the same commit as the code it describes. Enforced by a new `pnpm lint:docs` CI gate (§10) and three new entries in §11.
> - **V2 (2026-09-15)** — Synced with `06` V1.4 and `CLAUDE.architecture.md` A1.0. **Prisma → Drizzle** everywhere; **MinIO → Cloudflare R2**; module folder layout replaced with the Screaming Architecture / vertical-slice shape (§2.2); added `packages/domain`, `packages/auth`, `packages/payments`, `packages/storage`, `packages/notifications`, `packages/documents`, `packages/observability`; added the read-path rule (§6.4), the boundary-enforcement CI gates (§10) and the money/time/ID rules (§5, §4.3).
> - V1 — initial rules.

## 0. What this project is
Multi-tenant, multi-vertical business-management SaaS (POS, inventory, appointments, staff attendance & commissions, customers/loyalty, reporting). Arabic-first + English, RTL, KWD (3 decimals). Modular monolith. Solo developer + AI.

## 1. Workflow — one vertical slice at a time
1. Never implement a whole module. Implement **one use case** (e.g. "post stock adjustment").
2. Before code, write/update the slice spec in `docs/specs/<module>/<use-case>.md`: requirements, business rules, edge cases, acceptance criteria, schema changes, API contract, permissions, tests.
3. Then, in this order: **contract (Zod) → migration + RLS policy → domain functions + their tests → use case → adapters (persistence, http) → integration tests → UI.** Run `pnpm check` before declaring done.
4. Do not touch modules outside the slice. If you must, say so and explain why.
5. Every architectural decision → `docs/adr/NNNN-title.md` (context, decision, consequences).
6. **A slice is not done until the checklist in `CLAUDE.architecture.md` §15 passes.**

> **A doc comment is written with its function, not afterwards** (§3.1). "I'll document it later" means it never gets documented, and by then the author has forgotten the *why* — which is the only part worth writing down.

## 2. Repo layout (do not invent new top-level folders)

### 2.1 Workspace
```
apps/
  admin    Next.js — back-office (all business types)
  pos      Vite React PWA — cashier + staff, offline-first
  menu     Next.js SSR — public e-menu / booking
  api      NestJS (Fastify adapter) — HTTP + SSE + auth handler + webhooks
  worker   NestJS — BullMQ processors (same repo, different entrypoint and image)

packages/
  domain          Shared kernel: Money, Percentage, TaxRule, Quantity/UoM, KWD rounding.
                  PURE TypeScript, ZERO dependencies — imported by api, worker AND the POS browser.
  db              Drizzle schema (TS) + drizzle-kit migrations + RLS policies (SQL) + seed
                  /sql/reports/*.sql  raw SQL for heavy reports (tested + EXPLAIN-checked)
  contracts       Zod schemas + TS types shared by api/admin/pos/menu (+ generated OpenAPI)
  auth            Better Auth config + plugins + client. The ONLY module allowed to issue or
                  verify a session, hash a password, or hash a PIN.
  payments        PaymentGateway interface + adapters (myfatoorah, tap, knet-direct) +
                  capability matrix. The ONLY module that talks to a gateway or decrypts
                  gateway credentials.
  storage         ObjectStorage interface + adapters (r2, s3-generic), presigned URLs, key builder
  notifications   Channel interface + adapters (whatsapp, sms, email, push) + templates ar/en
  documents       PDF (Playwright) + Excel (ExcelJS) renderers, invoice/report HTML templates,
                  ESC/POS receipt builder
  observability   pino config + redaction list, OpenTelemetry setup, request-context helpers
  ui              shadcn-based RTL component kit, Tailwind tokens, Framer Motion presets
  i18n            ar/en catalogs + formatters (KWD 3dp, Hijri/Gregorian, timezones)
  config          eslint (incl. boundaries + jsdoc rules), tsconfig, tailwind presets

docs/    adr/  specs/  module-map.md  domain-model.md  security.md  runbook.md
deploy/  docker-compose.prod.yml  docker-compose.staging.yml  Dockerfile.*  backup/
```

### 2.2 Backend module shape — identical in every module, no creativity

```
apps/api/src/modules/<module>/
  domain/         Enterprise business rules. Pure functions. ZERO imports outside packages/domain.
  use-cases/      WRITE side. One folder per use case, named <verb>-<noun>/.
  queries/        READ side (fast path). Raw SQL / Drizzle sql tag. Read-only.
  ports/          Interfaces THIS module needs (repositories, cross-module readers, Clock, IdGenerator).
  persistence/    Drizzle implementations of ports/ + mappers.
  http/           Controllers. Thin: validate, call, map to HTTP.
  events/         published.ts (event payload types) + handlers/ (reactions to OTHER modules' events).
  <module>.module.ts   NestJS wiring — the ONLY place an interface is bound to a class.
  index.ts        The ONLY file other modules may import from.
```

Worker modules mirror this with `jobs/` instead of `http/`.

**Full rules, the import matrix and the frontend equivalent: `CLAUDE.architecture.md` §3–§6 and §11.**

### 2.3 Banned folder names
`utils/` · `helpers/` · `common/` · `misc/` · `managers/` · `models/` or `services/` as a root folder · `lib/` outside `packages/`.
One `shared/` per app is allowed, and only for code with **no business meaning** (`CLAUDE.architecture.md` §6.4).

## 3. File & function size (enforced by ESLint)
- `max-lines`: **300 warn / 400 error** per file (excluded: `packages/db/schema/*`, migrations, generated, fixtures, `*.sql`).
- `max-lines-per-function`: 60. One React component per file. One NestJS controller per resource.
- If a file would exceed limits, split by responsibility — never by arbitrary line count. A use case at 400 lines is three use cases.

### 3.1 Comments & documentation (enforced by ESLint — `pnpm lint:docs`)

**A comment is part of the deliverable, not decoration.** A PR that adds a `domain/` function or a `ports/` method without its Arabic doc comment is incomplete in exactly the way a PR missing a test is incomplete. The build fails it; this is not a review preference.

**The governing principle: comment the WHY, never the WHAT.** The code already states what it does. A comment restating the line below it is noise that will go stale and start lying.

```ts
// ❌ restates the code — banned
// بيجيب الشيفت المفتوح
const shift = await this.shifts.findOpenById(input.shiftId);

// ✅ explains a decision the code cannot show
// المدفوعات المعلقة بتمنع قفل الشيفت، لأن الكاش هيبان ناقص
// والفرق ده مش عجز حقيقي — البوابة لسه مردتش
const unresolved = tenders.filter(t => t.status === 'PENDING_GATEWAY');
```

#### Mandatory — Arabic JSDoc, no exceptions

| Where | What is required |
|---|---|
| `domain/**` — every exported function | Full JSDoc: what it computes, the business rule in one sentence, `@param` for every argument, `@returns` |
| `ports/**` — every interface method | One line: what it returns and why the consumer needs it |
| `events/published.ts` — every event | One line: when exactly it is emitted |

These three are where the money, the business rules and the contracts between modules live. They are also the places whose *why* cannot be recovered from the code six months later.

#### Required, lighter

| Where | What is required |
|---|---|
| `use-cases/**` | One line above the class: the business step it performs |
| `queries/**` | One line above the SQL: which screen consumes it |
| `packages/db/schema/**` | One line on any column whose name is not self-evident |

#### Banned outright

- **Closing comments** — `{/* end div */}`, `{/* /card */}`. If a component is long enough to need one, the component is too long. Split it (§3).
- **`FIXME`, `HACK`, `XXX`** — hidden debt with no owner and no date. Convert to `TODO(spec)` or a GitHub issue.
- **Comments that restate the code.**
- **Comments in `persistence/` and `http/`** unless something is genuinely surprising. That code is mechanical; commenting it is maintenance with no return.
- **Commented-out code.** Git remembers it. Delete it.

#### Language

- **The explanation is in Arabic.** Identifiers, type names, parameter names and JSDoc tags (`@param`, `@returns`) stay in English, spelled exactly as in the code. **Never translate a symbol name** — a reader searching for `PENDING_GATEWAY` must find it.
- One blank `*` line between the description and the tags.

#### The template — copy this shape

```ts
/**
 * بيحسب عمولة الموظف على بند واحد في الأوردر.
 * القواعد بتيجي كـ data مش كـ if، عشان نضيف نوع جديد من غير ما نلمس الدالة.
 *
 * @param entry   البند + المبلغ الصافي بالفلوس
 * @param rules   قواعد الخطة المفعّلة للموظف وقت البيع
 * @param context معامل التقييم وخصم التأخير
 * @returns مبلغ العمولة بالفلوس (bigint) — سالب في حالة المرتجع
 */
export function computeCommission(
  entry: CommissionEntry,
  rules: CommissionRule[],
  context: CommissionContext,
): bigint {
```

#### Update together, always

A PR that changes a documented function **and leaves its doc comment describing the old behaviour is rejected.** The comment moves in the same commit as the code. A stale comment is worse than no comment, because it is believed.

#### Enforcement (this is what makes the rule real)

- `eslint-plugin-jsdoc` — `require-jsdoc` scoped to `domain/**` and `ports/**`, plus `require-param`, `require-returns`, `require-description`.
- `no-warning-comments` — `FIXME`, `HACK`, `XXX` fail the build; `TODO` warns.
- A CI grep for `{/* end`, `{/* /` in `apps/**/*.tsx`, and for commented-out code blocks.
- All three run as **`pnpm lint:docs`**, a gate in the CI order (§10).

## 4. Module boundaries

### 4.1 Between modules
- Allowed arrows are declared in `docs/module-map.md` (mirroring `06` §3). **An undeclared arrow fails CI** — adding one requires an ADR.
- Cross-module **side effects** go through **domain events (outbox)**, never direct service calls (`orders` must not call `inventory`; it emits `OrderCompleted`).
- Cross-module **reads** go through a **port** the consuming module defines in its own `ports/`, implemented by an adapter. This is how a cycle is broken (`CLAUDE.architecture.md` §6.2).
- A module may import **only** another module's `index.ts`. A deep path (`../orders/persistence/…`) is a build failure.
- `pos` is a frontend app, not a backend module. It orchestrates `orders`, `payments`, `cash` via the API.

### 4.2 Inside a module
- **No business logic in controllers, jobs, or React components.** Controllers validate + delegate; use cases orchestrate; `domain/` holds the rules; `persistence/` holds the queries.
- **No arithmetic in a use case.** Totals, tax, discounts, commissions, stock costing, lateness — all of it lives in `domain/` as pure functions with exhaustive unit tests that run with no database.
- **A use case never contains the words `drizzle`, `sql`, `fetch` or `axios`.** CI greps for this.

### 4.3 Injected, never called directly
`Clock` and `IdGenerator` are ports. A use case that calls `Date.now()` or `crypto.randomUUID()` directly is not deterministically testable and will be rejected.

## 5. Database rules
- PostgreSQL only via **Drizzle** schema + `drizzle-kit` migrations (`pnpm db:migrate`). Never edit the DB by hand. Never use `db push` in shared envs.
- Every tenant table has `company_id uuid NOT NULL` (+ `business_id` where applicable) and an RLS policy. **New table ⇒ new policy + negative isolation test, in the same PR.**
- All DB access goes through `withTenant(companyId, tx => …)` which sets `app.company_id` inside the transaction. **Exporting the raw Drizzle client from `packages/db` is forbidden** — modules receive `tx` only.
- The three entry points with no session (gateway webhooks, messaging callbacks, worker jobs) resolve the tenant from an identifier and then use the same `withTenant()` wrapper. There is no fourth way to reach the DB (`06` §5.4).
- IDs: **UUID v7** (generated client-side on the POS while offline). Timestamps: `timestamptz` in UTC; display in branch timezone.
- Money: `numeric(14,3)` in Postgres; in TS **`bigint` mills (1 KWD = 1000)** or the `Money` type from `packages/domain` — **never `number`**.
- Bilingual text: `name_ar`, `name_en` columns (English required, Arabic optional unless spec says otherwise).
- Stock quantities are never updated directly: insert a `stock_movements` row; balances are derived (cached with `balance_after`).
- Soft delete (`deleted_at`) only for: items, customers, employees, categories. Everything financial is immutable + reversible (returns, negative entries), never deleted.
- Index every RLS predicate column and every FK; add composite indexes for known list filters (`(company_id, branch_id, created_at)`). **The migration that adds a query adds its index.**

## 6. API rules
- Contracts live in `packages/contracts` (Zod). Controllers use them for validation; frontends import the types. No hand-written duplicate types.
- REST under `/v1`, cursor pagination, error envelope `{ code, message_ar, message_en, details? }`.
- Any endpoint that creates money/stock effects requires `Idempotency-Key`, runs in **one DB transaction**, and writes its **outbox event inside that same transaction**.
- Authorization = permission string `action:resource:scope` checked by a guard on every controller method (`@Require('manage:orders:branch')`). **No endpoint without a guard** — a route with no guard fails CI.
- **Read endpoints go through `queries/`, not through use cases.** A `queries/` file may not import `domain/` or `use-cases/`, and may never write. Above ~200 rows the SQL projects straight into the DTO shape with no mapper (`CLAUDE.architecture.md` §7).
- Anything expected to exceed **200 ms** is a BullMQ job in `worker`, never a synchronous wait in `api`.
- Inbound webhooks: verify signature → store raw → enqueue → ack 200. Processing is idempotent by provider event id.
- SSE: one endpoint `GET /v1/stream`. Channel subscription is resolved **server-side from the session**, never from what the client asks for. SSE is never the source of truth — if the stream dies, screens fall back to polling and the POS keeps working.

## 7. Frontend rules
- All strings via `packages/i18n` keys (`t('orders.create')`) — no hardcoded Arabic/English in JSX.
- RTL-safe CSS: logical properties only (`ps-`, `pe-`, `ms-`, `me-`, `start`, `end`), never `left/right` paddings/margins.
- Use `packages/ui` components; do not install another component library. Icons: lucide.
- Forms: react-hook-form + Zod schema from contracts. Tables: TanStack Table with server pagination.
- Data fetching: TanStack Query; no fetch calls inside components — use generated API client hooks.
- **Frontend folders scream the business too**: `apps/pos/src/{sell,shift,attendance,catalog-browse,offline,app,shared}`, `apps/admin/src/{orders,inventory,staff,commissions,…}`. Next.js `app/` holds routes and thin re-exports only (`CLAUDE.architecture.md` §11).
- `apps/pos` is local-first: write to IndexedDB (Dexie) first, sync via the outbox queue; never block the UI on network.
- **Totals in the POS are computed by importing `packages/domain` — the exact same functions the API uses.** Re-implementing pricing in the browser is a money bug, not a style issue.
- **No closing comments in JSX** (§3.1). A component that needs one is a component that needs splitting.

## 8. Security
- Better Auth for sessions; cashier PIN + device token for POS; TOTP 2FA for owners/admins. **No module ever signs a JWT, compares a password, or hashes a PIN by hand** — only `packages/auth` or approved `identity` helpers.
- **All third-party credentials are envelope-encrypted at rest** (gateway keys, WABA tokens, SMS/email keys), decrypted only inside the owning package, never returned by an API, never logged, not visible to platform super-admins.
- Secrets only via env (`.env.example` kept updated). Never commit `.env`, keys, or customer data. The master encryption key lives only in Dokploy secrets.
- Authorization is checked **server-side** from the resolved membership — never from a client-sent claim, never only in the UI.
- **Payment state is never set by the client.** Only a verified webhook or a server-side status poll moves a payment to `CAPTURED`/`FAILED`/`REFUNDED`.
- Rate-limit and lock in Redis: PIN attempts, OTP (per phone + per IP), login, webhook endpoints, outbound sends per recipient.
- **Uploads are never trusted:** type detected from content (not extension), size capped, images fully re-encoded, storage key generated by us. Files go to R2, never to disk.
- Log with pino; every line carries `request_id`, `company_id`, `branch_id` (when present), `user_id`. **Never log** PINs, tokens, credentials, full customer phone numbers (last 3 digits only), or employee-document content.
- **Never put a secret, a key, a token or a real customer phone number in a comment or a code example.** A comment is committed exactly like code.
- Audit log entry for every change to prices, discounts, permissions, payments, refunds, stock posts, settings, device approval/revocation, gateway connect/disconnect, private-file access, and marketing sends. `AuditLog` lives in Postgres forever and is separate from technical logs.

## 9. Testing (required to merge)
- **Unit tests for every pure `domain/` function**, exhaustive, with no database: totals, tax, discounts, tips, commissions (all rule types), moving-average cost, attendance lateness, unit conversion, status transitions.
- **Integration tests for each use case** (happy path + listed edge cases) against a real Postgres (testcontainers).
- **RLS negative tests for every tenant table** (cross-tenant read = 0 rows, write = error).
- **Every `queries/` file has a result-shape test and an `EXPLAIN ANALYZE` assertion.**
- E2E (Playwright) for the POS critical path: open shift → order → split payment → print → close shift, including the offline toggle.

## 10. Git & delivery
- Conventional commits (`feat(orders): …`). One slice per PR. PR description = link to spec + checklist (spec, migration, RLS, indexes, tests, i18n, **doc comments**, docs).
- **CI must pass, in this order:**
  `typecheck → lint (incl. max-lines) → lint:docs (JSDoc coverage + banned comments) → boundaries (eslint-plugin-boundaries) → cycles (dependency-cruiser / madge) → module-map check → unit (domain) → integration → RLS negative tests → EXPLAIN checks → build all apps → docker images`
- Images are built in CI, tagged by **commit SHA** (never `latest`), pushed to GHCR; Dokploy pulls and restarts.
- Migrations run as **their own step before new containers start**, follow **expand/contract**, add indexes `CONCURRENTLY`, and are never destructive in the same release as the code change.
- `docker-compose` runs: `admin`, `pos`, `menu`, `api`, `worker`, `postgres`, `redis`, `traefik`. Object storage is **Cloudflare R2** (managed, not a container); use a local **Garage** container only for fully offline development.
- Every service declares a `healthcheck`, a memory limit and a restart policy. `/health` and `/ready` on `api` and `worker`.
- **A deploy that can't be rolled back in one click isn't finished.**

## 11. Things the AI must never do
- Introduce a new framework/library/language without an ADR.
- Use **floats for money**, `left/right` CSS, hardcoded strings, the **raw Drizzle client**, cross-module **deep imports**, direct stock quantity updates, or `Date.now()` / `randomUUID()` inside a use case.
- Put arithmetic in a use case, SQL in a use case, or business logic in a controller, job, or React component.
- **Ship a `domain/` function, a `ports/` method or an event in `events/published.ts` without its Arabic doc comment** (§3.1).
- **Write a closing comment (`{/* end div */}`), a `FIXME`, a `HACK`, or leave commented-out code in the repo** (§3.1).
- **Change a documented function without updating its doc comment in the same commit** (§3.1).
- Create a **circular dependency** between modules, or an import arrow not declared in `docs/module-map.md`.
- Add an interface with only one implementation unless it is justified by `CLAUDE.architecture.md` §12.
- Write a `*Service` class that accumulates unrelated methods instead of one folder per use case.
- Re-implement pricing, tax or commission logic in the frontend instead of importing `packages/domain`.
- "Refactor everything" or reformat unrelated files in a slice PR.
- Guess business rules — ask, or mark `TODO(spec)` and stop.

## 12. Useful commands
`pnpm dev` · `pnpm check` · `pnpm test` · `pnpm lint:docs` · `pnpm lint:boundaries` · `pnpm lint:cycles` · `pnpm db:generate` · `pnpm db:migrate` · `pnpm db:seed` · `pnpm contracts:openapi` · `pnpm e2e`
