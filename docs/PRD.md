# PosPay — Product Requirements Document (PRD)

> **Version:** 1.0 · **Date:** 2026-09-22 · **Status:** Draft, pending adversarial review (Codex `gpt-6-astra`, effort `high`)
> **Owner:** Waleed (solo developer + AI agents) · **Client / first tenant:** Abu Salem (Smoked Kuwait, Asador, ladies' salon)
> **Repo:** `pospay` · **Domain:** `pospay.systems` (ADR-0001)
>
> **What this document is.** The single consolidated statement of *what* PosPay is, *for whom*, *what it must do*, and *in which order it is built*: seven phases, each broken into tasks and sub-tasks with acceptance criteria. It was assembled from every document in `E:\PosPay.systems\docs` and `pospay/docs` (24 unique files, listed in §14) and reconciles them where they disagree.
>
> **What this document is not.** It does not override the three governing documents. On any conflict: `06_Tech_Stack_Architecture_EN.md` wins on technology, `CLAUDE.architecture.md` wins on code structure and dependency direction, `CLAUDE.md` wins on workflow. This PRD wins only on **scope, priority and phase order**, and it defers to `docs/specs/<phase>/SPEC.md` for slice-level detail once such a spec exists.
>
> **How to read the task lists.** Task IDs are `P<phase>-T<n>`, sub-tasks `P<phase>-T<n>.<m>`. Sizes: **S** ≈ half a day, **M** ≈ 1 day, **L** ≈ 2–3 days, **XL** ≈ 1–2 weeks. Status: ✅ done · 🔄 in progress · ⬜ not started · ⛔ blocked on a decision in §11. Phase 0 tasks keep the IDs already used in `docs/specs/phase-0/IMPLEMENTATION-PLAN.md` (T0–T13) so the two documents can be read side by side.

---

## Table of contents

1. [Product overview](#1-product-overview)
2. [Goals, success metrics, non-goals](#2-goals-success-metrics-non-goals)
3. [Users, roles and personas](#3-users-roles-and-personas)
4. [Market position](#4-market-position)
5. [Constraints and governing rules](#5-constraints-and-governing-rules)
6. [Domain model](#6-domain-model)
7. [Functional scope by module](#7-functional-scope-by-module)
8. [Cross-cutting requirements](#8-cross-cutting-requirements)
9. [Phase plan overview](#9-phase-plan-overview)
10. [Phases, tasks and sub-tasks](#10-phases-tasks-and-sub-tasks)
    - [Phase 0 — Foundation](#phase-0--foundation)
    - [Phase 1 — Staff, attendance, commissions (salon pilot)](#phase-1--staff-attendance-commissions-salon-pilot)
    - [Phase 2 — Catalog, orders, payments, cash, POS (restaurant pilot)](#phase-2--catalog-orders-payments-cash-pos-restaurant-pilot)
    - [Phase 3 — Inventory, recipes, production, kitchen](#phase-3--inventory-recipes-production-kitchen)
    - [Phase 4 — Appointments, e-menu, loyalty, channels, notifications](#phase-4--appointments-e-menu-loyalty-channels-notifications)
    - [Phase 5 — Reporting, platform, subscriptions, sale-readiness](#phase-5--reporting-platform-subscriptions-sale-readiness)
    - [Phase 6 — Expansion](#phase-6--expansion)
11. [Open decisions — `TODO(spec)`](#11-open-decisions--todospec)
12. [Risks](#12-risks)
13. [Documentation conflicts and gaps found while assembling this PRD](#13-documentation-conflicts-and-gaps-found-while-assembling-this-prd)
14. [Source documents](#14-source-documents)
15. [Glossary (AR / EN)](#15-glossary-ar--en)

---

## 1. Product overview

### 1.1 One-paragraph vision

One cloud system that runs **every business an owner has** — restaurants, a salon, and whatever comes next — from the cashier, inventory and kitchen to appointments, staff attendance, commissions and unified reporting; Arabic-first with full English, RTL, Kuwaiti dinar with three decimals; built from day one as a **multi-tenant SaaS** that any small or medium business in Kuwait can subscribe to.

### 1.2 The problem

The first client owns three businesses (two restaurants on Twlm, a ladies' salon on something else). Every system he pays for is missing something, no system sees the three businesses together, and any customisation request takes months. His two loudest pains, neither of which any competitor in Kuwait covers:

1. **Real attendance** — a rotating QR code on a branch screen that staff scan from their phones, so clock-in is real and cannot be faked by a photo.
2. **A commission engine** — three commission systems for salon staff (per-service percentage, percentage of revenue, tiered above a monthly target), tied to salary, ratings and attendance, with an approved monthly statement.

### 1.3 The strategy

We do not compete on "a better restaurant POS" (Twlm, Foodics) or "a better salon system" (Fresha). We compete on **one system for an owner with several businesses**, with everything included at one price, and customisation in days instead of months (AI-assisted development on a strictly modular architecture).

### 1.4 The product in one diagram

```
 Owner / managers ──► apps/admin  (app.pospay.systems)          Next.js, all businesses & branches
 Platform owner   ──► platform.pospay.systems  (module platform) separate session, never the same app
 Cashier / staff  ──► apps/pos    (pos.pospay.systems)          Vite PWA, offline-first, PIN + device token
                      ├── /sell  /shift  /attendance-screen  /staff (attendance, schedule, commissions)
 Kitchen          ──► apps/pos KDS route
 End customer     ──► apps/menu  (menu.pospay.systems)          Next.js SSR e-menu / booking / gift cards
                                   │
                                   ▼
                      apps/api    (api.pospay.systems)          NestJS on Fastify, SSE, Better Auth, webhooks
                      apps/worker                               BullMQ: outbox, reports, PDF, WhatsApp, sync
                                   │
                      PostgreSQL 16 + RLS · Redis 7 · Cloudflare R2 · MyFatoorah/Tap/KNET · WhatsApp Cloud API
```

---

## 2. Goals, success metrics, non-goals

### 2.1 Product goals

| # | Goal | Measured by |
|---|---|---|
| G1 | Prove tenant isolation before anything else | Automated negative RLS tests + API-level "A cannot resolve B" tests green in CI on every PR |
| G2 | Deliver the client's #1 and #2 pains first (attendance + commissions) | Salon runs one full month on digital attendance; generated commission statement matches the owner's manual calculation |
| G3 | Replace Twlm in one restaurant branch | One full day of trading with no stop; shift close matches counted cash; receipts and kitchen tickets print correctly; offline period survives with no lost or duplicated order |
| G4 | Reach Twlm's inventory depth, then exceed it | Monthly stock count with justified variances; per-product profitability on real cost; WhatsApp low-stock alerts |
| G5 | Salon fully on the system; restaurants have their own online menu | Appointments, reminders, ratings, e-menu live |
| G6 | Be sellable to an external customer | Self-signup with a vertical template, plans and feature flags, platform dashboard, first pilot customer onboarded |

### 2.2 Non-goals (for the whole roadmap unless stated)

- No microservices, no sharding, no Kafka. One Postgres + RLS + correct indexes serves thousands of tenants (design for 300, build for 5,000).
- No hosted auth provider (Clerk, Auth0) — unit economics forbid per-MAU pricing at 200k–500k MAU against a ~50 KWD/shop subscription.
- No holding of merchants' money. PosPay uses the **BYO gateway** model (each business connects its own MyFatoorah/Tap/KNET account) so no EPSP licence from the Central Bank of Kuwait is required. Platform-collected funds are an explicit, separate decision (§11 D-03).
- No second programming language before it is needed (Go only as a later worker escape hatch).
- No ZATCA (Saudi e-invoicing) before Phase 6.

---

## 3. Users, roles and personas

### 3.1 The four scopes (plus `own`)

```
Platform  ← the product owner (you): sees tenants and subscriptions, never tenant detail
  └── Company  ← Abu Salem: one legal umbrella for all his businesses
        └── Business  ← Smoked / Asador / Salon: each with a vertical_type and its own settings
              └── Branch  ← Salmiya, Jahra …: devices, staff, stock location, timezone display
own  ← "only my own data": an employee sees her commission, a customer sees his orders
```

Every permission is `action:resource:scope` with scope ∈ {`platform`, `company`, `business`, `branch`, `own`}. Deny by default. Roles are bundles; the code checks the permission, never the role.

### 3.2 Personas and what they touch

| Persona | Enters through | Signs in with | Day-to-day |
|---|---|---|---|
| **Owner** (Abu Salem) | `app.` | email + password + TOTP | unified dashboard across businesses, approvals inbox, alerts, commission statements, users |
| **General manager** | `app.` | email + password + TOTP | same as owner minus billing, delete company, appoint owner |
| **Accountant** | `app.` | email + password + TOTP | expenses, payments, A/R, financial reports, accounting export; read-only orders |
| **Business manager** | `app.` | email + password + TOTP | all branches of one business: catalog, prices, staff, inventory, reports |
| **Branch manager** | `app.` + phone | email + password | one branch: approve discounts/returns/wastage, close shifts, branch reports; no costs/profit unless granted |
| **Shift supervisor** | `pos.` | PIN on a registered device | open/close shifts, small-discount approvals, end-of-day service-barcode scans |
| **Cashier** | `pos.` | PIN on a registered device | sell, pay, print, limited returns, own drawer only; PIN never opens `app.` |
| **Waiter** | `pos.` | PIN | takes orders, sends to kitchen, touches no money |
| **Kitchen** | `pos.` KDS | device | KDS only |
| **Storekeeper** | `app.`/`pos.` | PIN / password | receive purchases, counts, transfers, wastage (with approval); no sale prices |
| **Staff / specialist** (salon) | `pos.` staff routes | phone OTP | QR attendance, my schedule, my commissions, leave requests |
| **Marketing** | `app.` | password | WhatsApp campaigns, offers, loyalty, ratings; no financials |
| **Viewer** | `app.` | password | read-only reports (partner, investor, external accountant) |
| **Platform super-admin / support / billing / developer / break-glass** | `platform.` | password + TOTP, separate session | tenants, plans, feature flags, health, impersonation under strict rules |
| **End customer** | `menu.` | phone OTP | e-menu, booking, gift cards, loyalty — **not** a system user, `own` only |

The full sensitive-permission matrix, numeric constraints (max discount %, max refund, max shift variance, backdate days) and the 12 dangerous permissions are in `09_Dashboards_Roles_Permissions_AR.md` §4–§8 and are normative.

---

## 4. Market position

| | Twlm | Foodics | Fresha | **PosPay** |
|---|---|---|---|---|
| Restaurant depth (inventory, recipes, KDS) | strong | strong | — | matched by Phase 3 |
| Salon: appointments, service provider, duration | locked / absent | — | strong | Phase 1 + Phase 4 |
| Laundry / retail / services templates | — | — | — | Phase 6 |
| QR attendance | — | partial | — | Phase 1 |
| Commissions and payroll | — | — | — | Phase 1 / Phase 5 |
| One owner, several businesses | — (one tenant per restaurant) | partial | — | core model |
| KNET | — | ✓ | — | Phase 2 |
| Public API / webhooks | not visible | top plan | — | Phase 5, included |
| Offline POS | unconfirmed | ✓ | — | Phase 2, designed-in |
| Published, simple pricing | — (ask for a quote) | 16.6 / 27.4 / 45.7 KWD per branch per month | — | one plan, everything included (see D-04) |
| Customisation turnaround | months (the client's complaint) | months | — | days |

Foodics is the pricing reference in Kuwait. The discussed price point is **~50 KWD per shop per month** (or an annual single package per `client-phased-proposal-ar.md`), with a free trial month and no setup fee — against a local competitor who charges ~200 KWD setup then 35 KWD/year and is a one-man show whose customers are unhappy. Final pricing is decision D-04.

---

## 5. Constraints and governing rules

### 5.1 Technology (from `06`, decided — not reopened here)

TypeScript end to end · pnpm workspaces + Turborepo · React · Next.js App Router (`admin`, `menu`) · Vite React PWA (`pos`, local-first with Dexie + Service Worker) · Tailwind + shadcn/ui + Framer Motion in `packages/ui` · Node.js LTS (24) · NestJS on the **Fastify** adapter · same NestJS codebase as a separate `worker` container (BullMQ) · PostgreSQL 16 with Row-Level Security · **Drizzle ORM** + raw SQL via `sql` tag for reports · Redis 7 · **Better Auth self-hosted** on the Drizzle adapter + our own `identity` layer · SSE for realtime · Cloudflare R2 for files · Playwright (PDF) + ExcelJS in the worker · MyFatoorah first, Tap / KNET-direct adapters later · WhatsApp Cloud API + Resend · pino + OpenTelemetry + Sentry · one Docker image per app, Docker Compose on a VPS via Dokploy + Traefik, GitHub Actions CI, images tagged by commit SHA.

Exact pinned versions are in ADR-0002 (Node 24, pnpm 12.5.1, Turborepo 2.11.2, TypeScript 6.0.3, ESLint 10.11.0, typescript-eslint 8.70.1, eslint-plugin-boundaries 7.2.0, eslint-plugin-jsdoc 64.5.4, Prettier 3.9.8).

### 5.2 Architecture (from `CLAUDE.architecture.md`, decided)

Modular monolith · Screaming Architecture root folders named after business capabilities · every backend module has exactly the shape `domain/ use-cases/ queries/ ports/ persistence/ http/ events/ <module>.module.ts index.ts` · dependency rule: inward only, enforced by `eslint-plugin-boundaries` · the import matrix in §3.1 of that file · cross-module reads by **port**, cross-module writes by **domain event through the outbox** · only `index.ts` is importable across modules · `docs/module-map.md` is the executable list of allowed arrows · CQRS-lite: write side through use cases, read side through `queries/` with raw SQL · only `reporting/queries/` may join across contexts · `packages/domain` is pure and dependency-free so the POS computes the same totals offline that the server computes online.

### 5.3 Workflow (from `CLAUDE.md`, decided)

One vertical slice at a time · spec before code in `docs/specs/<module>/<use-case>.md` · order inside a slice: contract (Zod) → migration + RLS → domain functions + tests → use case → adapters → integration tests → UI · `pnpm check` green before done · Arabic JSDoc mandatory on `domain/**`, `ports/**`, `events/published.ts` (`pnpm lint:docs`) · no `FIXME`/`HACK`/closing comments/commented-out code · max 300 warn / 400 error lines per file, 60 per function · conventional commits, one slice per PR, never commit to `main` · CI gate order: `typecheck → lint → lint:docs → boundaries → cycles → module-map → unit → integration → RLS negative → EXPLAIN → build → docker images`.

### 5.4 Data, money and time rules (decided)

UUID v7 primary keys generated through an injected `IdGenerator` · `company_id uuid NOT NULL` + RLS policy + `FORCE ROW LEVEL SECURITY` on every tenant table, tenant-qualified composite foreign keys for child tables · every DB access through `withTenant(companyId, tx => …)`; the raw Drizzle client is never exported · three session-less entry points (gateway webhooks, messaging callbacks, worker jobs) resolve the tenant explicitly and then use the same wrapper · money is `numeric(14,3)` in Postgres and **`bigint` mills** (1 KWD = 1000) in TypeScript, never `number`; rounding half-up at line level, totals summed from rounded lines · `timestamptz` UTC, displayed in branch timezone · bilingual `name_ar` / `name_en` · stock never updated in place — `stock_movements` ledger with `balance_after` · soft delete only for items, customers, employees, categories; everything financial is immutable and reversible · every money/stock endpoint requires `Idempotency-Key`, runs in one transaction and writes its outbox event inside it.

### 5.5 Domain and subdomains (ADR-0001, decided)

`app.` → admin · `platform.` → super-admin (separate session, never `admin.`) · `pos.` · `menu.` · `api.` (Cloudflare DNS-only forever, because SSE) · `cdn.` → R2 · `pospay.systems` + `www` → marketing page · `worker` has no subdomain · `COOKIE_DOMAIN=.pospay.systems` · staging under `*.staging.pospay.systems` with its own cookie domain · per-host Let's Encrypt certificates via HTTP-01, no wildcard until merchants get their own subdomain.

---

## 6. Domain model

The canonical model is `06` §4. Summarised here so the phase plan can reference it.

```
Company (tenant root; owner; plan)
 └─ Business (vertical_type: restaurant|salon|laundry|retail|services; settings; currency; timezone)
     └─ Branch (address, geo, hours, order-type × channel matrix, default stock location)

User (Better Auth, global) ──< Membership (company/business/branch scope, role, overrides, starts_at/ends_at)
Employee (business, user?, base_salary, commission_plan_id, schedule, documents)
CashierPin (employee, branch, pin_hash, rotated_at, failed_attempts, locked_until)
Device (branch, label, fingerprint, token_hash, approved_by/at, last_seen_at, status ACTIVE|REVOKED, app_version)

Item (business, kind PRODUCT|SERVICE, names ar/en, category, base_price, cost, tax, barcode,
      service: duration_min, resource_type, requires_staff, default_commission_rule)
 ├─< ItemVariant  ├─< ItemPrice (branch?, channel?, order_type?)  ├─< ItemOptionGroup >─ OptionGroup ─< OptionValue

Customer (business, type, phones, credit_limit, tags, loyalty_balance, birth_date, preferred_staff_id)

Order (business, branch, order_type, channel, status, customer?, staff_id, custom_fields, subtotal,
       discount_total, service_fee, tax_total, tip, total, currency, client_id, idempotency_key, external_ref)
 ├─< OrderItem (item, variant?, qty, unit_price, served_by_staff_id, appointment_id?, service_barcode?, line_total)
 │     └─< OrderItemOption
 ├─< Payment (method, amount, status, gateway_ref, card_last4, terminal_id, shift_id, idempotency_key)
 └─< Return (lines, refund, stock_effect RESTOCK|WASTE|NONE)

Appointment (business, branch, customer, resource?, staff?, starts_at, duration, status, order_id?)
CashShift (branch, cashier, device_id, opened_at, opening_float, closed_at, counted, expected)
AttendanceSession (branch, employee, clock_in, clock_out, source QR|BARCODE|MANUAL, geo, device_id, late_min)
CommissionRule (plan, type PER_ITEM_PCT|REVENUE_PCT|TIERED, basis NET|GROSS, scope, tiers jsonb, mode MARGINAL|WHOLE)
CommissionEntry (employee, order_item?, period, amount, rule, status) → CommissionStatement (period, status)

StockItem / StockLocation / StockMovement (item, location, qty_delta, unit_cost, balance_after, source_type, source_id)
Recipe / RecipeIngredient / ProductionOrder ; Purchase / PurchaseLine ; Transfer ; StockCount ; Wastage
ServiceMaterialUsage (item, stock_item, qty)
AuditLog (company, actor, entity, action, before, after, at)   Outbox (id, aggregate, event_type, payload, created_at, published_at)
IdempotencyKey (key, company_id, operation, request_fingerprint, status, response_status, response_body, expires_at)
Plan (code, names, feature_flags, limits)   ApprovalRequest (company, type, requested_by, payload, status, decided_by, note)
```

**Global vs tenant tables (from Phase 0 T0).** Better Auth's `user`, `session`, `account`, `verification` are global identity tables with no `company_id` and no tenant RLS, reachable only through a narrowly privileged auth role. `memberships` is the bridge, RLS-keyed on `app.user_id`. Everything else is tenant data under `app.company_id`. `plans` is platform reference data: readable, never writable by the app role.

---

## 7. Functional scope by module

Priority tags are those of `04_Features_Spec_AR.md`: **[M]** = MVP (Phases 0–2 for the client's own businesses; extended here to the phase where the module first ships), **[V1]** = after launch on the client's businesses, **[V2]** = when selling to the market. ★ = not in Twlm (competitive differentiator).

| Module | Owns | Ships in | Key [M] features | [V1] | [V2] |
|---|---|---|---|---|---|
| `tenancy` | companies, businesses, branches, plans, feature flags | P0 | ★ company → businesses → branches; vertical templates | | plans UI |
| `identity` | memberships, RBAC, sessions, cashier PINs, devices | P0 (+P2 constraints) | `action:resource:scope`, deny by default, PIN + device token, TOTP for owners | numeric constraints → approvals, temporary memberships (`ends_at`) | |
| `settings` | per-business config | P0 | tax rule, invoice template, hours, payment methods, delivery zones, default language | | |
| `staff` | employees, documents, schedules, attendance, leave | P1 | employee file + documents with expiry alerts, ★ rotating-QR attendance, geofence, shifts (fixed/weekly), lateness, leave from phone | barcode ID card, selfie, overtime rules, attendance ↔ cash shift link, shift swap | |
| `commissions` | plans, rules, entries, statements | P1 | ★ three rule types incl. tiered above target, split, reversal; monthly statement draft → approved → paid; CSV export | rating multiplier, attendance deduction, payslip | |
| `catalog` | categories, items (product \| service), variants, options, prices | P2 | tree categories, ★ item = product or timed service, variants, option groups, cost/barcode/tax, bulk edit, Excel import/export, Redis cache | price overrides per branch/channel/order type ★, combos/bundles/memberships ★ | |
| `customers` | customers, credit, tags, blocks | P2 | CRM basic, credit limit + on-account sales, block | tags, birthday, preferred staff | corporate sub-users |
| `orders` | orders, items, options, lifecycle, returns | P1 (minimal) / P2 | order types, options, notes, custom fields, ★ `served_by` per line, ★ service barcode per line, discounts by code/manual with limits, service fee, tip, returns with stock effect | hold/recall, happy hour, tables & floor map, merge/split bill | kiosk / QR per table |
| `payments` | methods, split payments, gateway adapters, refunds, A/R | P2 | full/split (cash + KNET + card + Apple Pay + on-account + gift card + points), MyFatoorah, refunds, capability matrix, BYO gateway | Tap, KNET direct, UPayments | Tamara/Tabby |
| `cash` | cash shifts, movements, reconciliation | P2 | open/close, paid in/out, count vs expected, variance limit → approval, pending-gateway block | | |
| `realtime` | SSE stream, channel scope | P2 | `GET /v1/stream`, scope from session, polling fallback | | |
| `files` | R2 keys, uploads | P2 | content-sniffed, size-capped, re-encoded images | | |
| `inventory` | UoM, stock items, locations, ledger, purchases, suppliers, transfers, counts, adjustments, wastage, recipes, production | P3 | raw/semi/packaging/consumable, storage UoM ≠ recipe UoM, locations, min/reorder, staged purchases with batches/expiry, adjustments, wastage with reasons + approval, counts, moving-average cost, reports | BOM + auto cost, production orders, transfers with approval, ★ material usage per service, ★ expiry/low-stock WhatsApp alerts | FIFO |
| `kitchen` | KDS tickets/stations, waiting screen | P3 | KDS live, stations, waiting screen | | |
| `appointments` | resources, availability, bookings, waitlist, reminders | P4 | calendar per provider/resource, capacity & conflicts, booking from POS/phone/WhatsApp/site, "any available", statuses, no-show | WhatsApp reminders with reply confirmation, deposit online, waitlist, recurring, post-session rating → commissions & loyalty | |
| `loyalty` | points, stamp cards, gift cards, discounts | P4 | gift cards (cash/product), discounts (pct/fixed/code/branch/taxable) | points earn/redeem/expire, ★ segmented WhatsApp campaigns, ★ ratings + Google review card | wallet stamp cards |
| `channels` | ordering channels, commissions → expenses, aggregator adapters | P4 | channel + `external_ref` on orders, commission booked as expense | ★ delivery integration hub (Talabat, Deliveroo, Jahez, Keeta …): intake, accept/reject, status sync, menu/price/availability sync, outage alerts | direct integrations |
| `notifications` | templates, WhatsApp/SMS/email/push, in-app | P1 (OTP minimal) / P4 | in-app + WhatsApp + email; OTP; operational messages | SMS, marketing templates, opt-in/out, scheduling, campaign reports | |
| `expenses` | categories, expenses, recurring | P5 | categories, branch, payment method, due/paid, receipt images | ★ recurring (rent, salaries), ★ simplified P&L per business | |
| `reporting` | read models, cross-context SQL, exports | P2 (daily dashboard) / P5 | per-business daily dashboard + ★ unified owner dashboard; sales by channel/type/method/hour/staff, products, returns, payments, A/R aging; ★ attendance/lateness/hours; ★ commissions/performance; every report exports PDF/Excel/CSV with date/business/branch filters | inventory & COGS profitability, ★ appointments report, ★ scheduled reports via WhatsApp/email | |
| `platform` | tenants, subscriptions, feature flags, vertical templates, support, health | P5 (foundations in P0) | tenants list, plans × feature flags, overrides, vertical templates, health (queues, stuck outbox, backups), impersonation under strict rules, support tickets, banners, platform audit | | billing, self-signup |
| HR payroll (inside `staff`/`commissions`) | payroll runs, allowances, deductions, loans, payslips | P5 | | ★ base + commissions + allowances − deductions → payslip PDF, loans/advances, approval, bank export | |
| Public API + webhooks | API keys with scopes, outbound webhooks, OpenAPI | P5 | | ★ per-tenant API keys, OpenAPI docs, webhooks | |
| Accounting export | daily journal export | P5 | | ★ Zoho Books / QuickBooks / Odoo | |
| ZATCA | Saudi e-invoicing compliance module | P6 | | | ✓ |

### 7.1 Vertical templates (what activates per business type)

| Vertical | Enabled modules | Specifics | Phase |
|---|---|---|---|
| Restaurant / café | POS, deep inventory, recipes, kitchen, tables, delivery, channels | restaurant order types, KDS, delivery zones | P2–P4 |
| Salon / spa / barber | POS, appointments, staff + commissions, attendance, customers, simple products | timed services with provider, service barcode per line, deposit, post-session rating | P1, P4 |
| Laundry ★ | POS, tickets with states (received → washing → ironing → ready → delivered), customers, delivery | per-piece/per-kilo pricing, QR ticket, "ready" WhatsApp notification | P6 |
| Grocery / retail ★ | POS with barcode + scale, batch/expiry inventory, suppliers, offers | fast search, multi-unit selling (piece/carton) | P6 |
| Services company / offices ★ | quotes → invoices, on-account customers, appointments, staff | recurring invoices, collections | P6 |
| Clinics / centres [V2] | appointments, resources, customers | simplified file | P6 |

Adding a vertical is **configuration** (template + feature flags copied into `business.settings`), never an `if (vertical === …)` inside a use case.

---

## 8. Cross-cutting requirements

### 8.1 Security

- Better Auth for sessions; cashier PIN + device token for POS; TOTP 2FA for owners/admins; phone OTP for employees and end customers; scoped API keys for integrations. No module ever signs a JWT, compares a password or hashes a PIN by hand — only `packages/auth`.
- Authorization checked **server-side** from the resolved membership on every request; never from a client claim; UI hiding is UX only. Permissions cached in Redis with a short TTL and invalidated on any change.
- Resolution order: user DENY override → role has permission at scope → numeric constraint satisfied (else convert to an approval request, not a refusal) → plan feature flag → RLS as the last line of defence.
- Payment state is never set by the client — only a verified webhook or a server-side status poll moves a payment to `CAPTURED` / `FAILED` / `REFUNDED`.
- All third-party credentials envelope-encrypted at rest (master key only in Dokploy secrets), decrypted only inside the owning package, never returned by an API, never logged, not visible to platform super-admins.
- Rate limits and locks in Redis: PIN attempts, OTP per phone + per IP, login, webhook endpoints, outbound sends per recipient.
- Uploads: type detected from content, size-capped, images re-encoded, storage key generated by us, stored in R2 never on disk.
- Audit log (Postgres, forever, separate from technical logs) for every change to prices, discounts, permissions, payments, refunds, stock posts, settings, device approval/revocation, gateway connect/disconnect, private-file access, marketing sends, impersonation. Audit `before`/`after` use field allowlists so hashes and tokens never land in audit rows.
- Platform super-admin never reads tenant data silently: impersonation only with written consent or a support ticket, 30-minute session, read-only by default, red banner, logged in the tenant's own audit log.
- A company always keeps at least one owner; the last owner cannot remove themself.

### 8.2 Internationalisation

Arabic-first + English, full RTL; all UI strings through `packages/i18n` keys; logical CSS properties only; bilingual data columns; KWD formatted to 3 decimals (`formatKwd(12500n) === '12.500'`); Hijri/Gregorian per business setting; display in branch timezone; additional worker languages (Urdu/Hindi) [V1]; multi-currency [V2]; VAT support by country so the same system works when Kuwait introduces VAT (transcript §1).

### 8.3 Performance

One list = one query (no N+1) · every filter column has a composite index starting with `company_id`, added in the same migration · hot reads (menu, prices, settings, flags) from Redis with owner-scoped invalidation · anything > 200 ms is a BullMQ job · heavy reports are raw SQL files with `EXPLAIN` tests · prepared statements on POS hot paths · cursor pagination everywhere · no `SELECT *` · dashboards read from read models / materialized views, never raw order tables · ≤ 3 hops from controller to SQL on POS hot paths.

### 8.4 Offline-first POS

Local-first is a **data-model decision, not a feature**: IDs generated on the device (UUID v7), `client_id` + `idempotency_key` on every order, Dexie outbox, Service Worker background sync, server-side conflict rules (server price wins, order keeps captured price with an audit entry), cash/on-account payments complete offline, card/KNET queued as pending, PIN verified locally against synced hashes, revoked device wipes its snapshot on next contact. Two devices offline at the same time do **not** share live stock; that limitation is stated to the client.

### 8.5 Reliability

Idempotency store with replayable response, scoped uniqueness (`key` + `company_id` + `operation`), request-fingerprint mismatch → 422, `IN_FLIGHT` → 409, 24 h retention · outbox written in the same transaction, dispatched by the worker, consumers idempotent by `event_id`, replay is a supported recovery tool · inbound webhooks: verify signature → store raw → enqueue → ack 200, dedupe by provider event id · `/health` and `/ready` on `api` and `worker` · every container has a healthcheck, memory limit and restart policy · migrations run as their own step before containers, expand/contract, indexes `CONCURRENTLY`, never destructive in the same release · previous image must still serve against the new schema (proven in staging) · backups: nightly logical `pg_dump` + physical base backup with continuous WAL archiving (pgBackRest or wal-g) to Backblaze B2, RPO ≤ 5 min, RTO ≤ 2 h, both rehearsed, both checking in to Healthchecks.io · a deploy that cannot be rolled back in one click is not finished.

### 8.6 Observability

pino structured logs with `request_id`, `company_id`, `branch_id` (when present), `user_id` on every line; redaction list configured once (PINs, tokens, gateway/messaging credentials, full phone numbers → last 3 digits, employee-document content); no bodies except on error after redaction; OpenTelemetry with head sampling (tail sampling deferred); Sentry; platform health screen shows queue depth, stuck outbox, last successful backup and last restore test.

### 8.7 Documentation and testing gates

Every `domain/` function has exhaustive unit tests with no database; every use case has integration tests on real Postgres (testcontainers); every tenant table has a negative RLS test; every `queries/` file has a result-shape test and an `EXPLAIN` assertion (index usage, not timings); Playwright E2E for the POS critical path including the offline toggle; Arabic JSDoc coverage is a CI gate; every architectural decision is an ADR.

---

## 9. Phase plan overview

The phase order follows `06` §7 (the governing doc) and `05_App_Blueprint_Build_Plan_AR.md`. It deliberately puts **attendance + commissions before the POS** because they are the client's two named pains, they are low-risk (no hardware, no gateway, no offline), they can be piloted in the salon within weeks, and they prove the architecture before the riskiest module. See decision D-01 for the competing "POS-first" framing in `client-phased-proposal-ar.md`.

| Phase | Name | Pilot | Primary modules / apps | Duration (revised) | Exit criterion |
|---|---|---|---|---|---|
| **0** | Foundation | none (API + tests only) | `tenancy`, `identity`, `settings`; `packages/{domain,db,contracts,auth,i18n,observability}`; `apps/api`, `apps/worker` bootstrap; CI; staging; backups | 6–8 weeks | two companies exist; A reads zero rows of B at DB **and** API level; CI blocks a boundary violation; one PITR restore performed |
| **1** | Staff, attendance, commissions | salon | `staff`, `commissions`, minimal `orders` service-session slice, minimal `notifications` (OTP); `apps/admin` + `apps/pos` bootstrap; `packages/ui` | 5–7 weeks | one-month salon trial: generated statement matches manual calculation |
| **2** | Catalog, orders, payments, cash, POS | one restaurant branch (Smoked), 2 weeks parallel with Twlm | `catalog`, `customers`, `orders`, `payments`, `cash`, `realtime`, `files`; `packages/{payments,storage,documents(ESC/POS)}`; POS sell/shift/offline; print agent | 7–9 weeks | full trading day, cash matches, printing OK, offline survives |
| **3** | Inventory, recipes, production, kitchen | restaurant | `inventory`, `kitchen`; tables/floor map | 6–8 weeks | monthly count with justified variances; true product profitability |
| **4** | Appointments, e-menu, loyalty, channels, notifications | salon (full) + restaurants (online menu) | `appointments`, `loyalty`, `channels`, `notifications` full; `apps/menu` | 6–8 weeks | salon fully on the system; restaurants have their own online menu; delivery orders land in the POS |
| **5** | Reporting, platform, subscriptions, sale-readiness | first external pilot customer | `reporting`, `expenses`, `platform`; `packages/documents` (PDF/Excel); payroll; public API; billing; self-signup; marketing site | 6–8 weeks | an external customer self-onboards from a vertical template and pays |
| **6** | Expansion | new verticals / markets | laundry, retail, services, clinic templates; ZATCA; customer app; native mobile (ADR); direct delivery integrations; multi-currency | continuous | per template: a full operating cycle passes, not just a screen |

**Total to end of Phase 5:** ≈ 9–11 months of a single developer's focused time, against the "5–6 months" in `05` and "≈ 4 weeks for Phase 0" in `06` §7 — both are optimistic and are flagged in §13 for correction in the client-facing documents. Phase 1 is the first visible value, ≈ 3 months in.

**Dependency chain:** P0 → P1 → P2 → P3 → P4 → P5 → P6. Within a phase, tasks are serial by default (the spec rule "a slice is not started until the previous one is green"); explicitly named parallel tracks are the only exception.

---

## 10. Phases, tasks and sub-tasks

### Phase 0 — Foundation

> **Detailed spec:** `docs/specs/phase-0/SPEC.md` (Draft v1) · **Plan:** `docs/specs/phase-0/IMPLEMENTATION-PLAN.md` (v2, revised after `CODEX-REVIEW.md`). Those documents are normative for Phase 0; this section restates them as tasks and sub-tasks and records current status.
>
> **Builds nothing a merchant can see.** It builds proven tenant isolation, one predictable shape for every module, and a pipeline that refuses bad code.
>
> **Modules allowed in this phase:** `tenancy`, `identity`, `settings` only. No frontend. `worker` container exists with the outbox dispatcher only.

**Success criterion.** Create two companies through the API. Prove with automated tests that company A's session reads zero rows of company B, a cross-tenant `INSERT` is rejected by `WITH CHECK`, a cross-tenant `UPDATE`/`DELETE` affects zero rows, A cannot reference B's data through a foreign key, **and** company A's session cannot cause the server to resolve company B (API-level proof, T8).

#### P0-T0 — Auth ↔ RLS bootstrap decision · S · ⬜ · blocks T5

Login happens before a tenant is known, so Better Auth's own queries cannot run inside `withTenant()`, and a user may belong to several companies.

- [ ] P0-T0.1 Write `docs/adr/0003-auth-rls-boundary.md` (the plan says `0001`, but 0001 is the domain ADR — see §13). Classify tables: **global identity** (`user`, `session`, `account`, `verification`: no `company_id`, no tenant RLS, reached only through a narrowly privileged auth role with table grants and **no** `BYPASSRLS`), **the bridge** (`memberships`: RLS `USING (user_id = current_setting('app.user_id')::uuid)`), **tenant data** (everything else on `company_id`).
- [ ] P0-T0.2 Record the request flow: authenticate (global) → read memberships as the user → resolve requested company and verify membership server-side → `withTenant(companyId, …)` for all business data.
- [ ] P0-T0.3 Amend `CLAUDE.md` §5 with a named exception for the auth path (do not quietly break the "all access through `withTenant()`" rule).
- [ ] P0-T0.4 Decide the single authorization authority: our `memberships` table owns authorization; Better Auth `organization` plugin is used for nothing it duplicates (two authorities is a bug).
- [ ] P0-T0.5 List auth-handler routes explicitly as public (controller guard scanning will not classify them).
- [ ] P0-T0.6 Define the principal-resolution contract (`packages/auth/src/principal.ts`): session/device/PIN → user or employee → verified membership → business/branch scope; define `employee_ref` target and lifecycle; define company switching, membership removal and device revocation consequences.
- **Done when:** ADR written and table classification agreed before any migration is generated.

#### P0-T1 — Workspace skeleton · S · ✅ (PR #1 merged; PR #2 open with Codex review fixes)

- [x] P0-T1.1 `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.gitignore`, `.env.example`, `.editorconfig`, `README.md`, `.nvmrc`, Prettier.
- [x] P0-T1.2 `packages/config/eslint/{index,boundaries,jsdoc}.js` with `boundaries`, `jsdoc` scoped to `domain/**` + `ports/**` + `events/published.ts`, `max-lines` 400 error, `max-lines-per-function` 60, `no-warning-comments`, `no-restricted-imports` / `no-restricted-globals` for `use-cases/`.
- [x] P0-T1.3 `packages/config/scripts/lint-docs.mjs` (rejects JSDoc without Arabic in the mandatory folders).
- [x] P0-T1.4 ADR-0002 workspace tooling baseline (TS pinned to 6.0, pnpm build scripts denied by default, minimum release age).
- [x] P0-T1.5 `pnpm check` = `turbo run typecheck lint test && pnpm lint:docs`.
- [ ] P0-T1.6 Merge PR #2 (`fix/phase0-t1-codex-review`).
- **Done when:** `pnpm install` and `pnpm check` exit 0 on the empty workspace. ✅

#### P0-T2 — Local infrastructure · S · ⬜ · depends T1

- [ ] P0-T2.1 `deploy/docker-compose.dev.yml`: Postgres 16 + Redis 7, named volumes, healthchecks.
- [ ] P0-T2.2 Postgres tuned with `statement_timeout` and a connection limit.
- [ ] P0-T2.3 Optional local Garage container for fully offline R2 development (not required in Phase 0).
- **Done when:** `docker compose -f deploy/docker-compose.dev.yml up -d` runs and both healthchecks report healthy.

#### P0-T3 — `packages/domain` shared kernel · M · ⬜ · depends T1

- [ ] P0-T3.1 `Money` as `bigint` mills; construction from decimal string and from DB `numeric` string; lossless JSON transport (string); `numeric(14,3)` overflow boundary checks.
- [ ] P0-T3.2 `roundKwd` half-up at line level, incl. **signed** (negative) rounding for returns and commission reversals; totals summed from rounded lines.
- [ ] P0-T3.3 `Percentage` with defined precision; `TaxRule` type (VAT-ready: inclusive/exclusive, rate by country).
- [ ] P0-T3.4 Choose the test runner (ADR-0002 defers it to here; Vitest per `08`); exhaustive unit tests, no DB.
- [ ] P0-T3.5 Full Arabic JSDoc on every export.
- **Done when:** tests pass and `dependencies` in `package.json` is empty.

#### P0-T4 — `packages/db` foundation · M · ⬜ · depends T2, T3

- [ ] P0-T4.1 `drizzle.config.ts`, `src/{client,with-tenant,index}.ts`, `scripts/{migrate,seed}.ts`.
- [ ] P0-T4.2 `withTenant(companyId, fn)` opens a transaction and `set_config('app.company_id', …, true)`; `withUser(userId, fn)` for the membership bridge.
- [ ] P0-T4.3 `index.ts` does **not** export the raw Drizzle client; a test asserts it is unreachable from outside the package.
- [ ] P0-T4.4 Restricted application DB role (`NOSUPERUSER`, `NOBYPASSRLS`, owns no tenant table) and the narrowly privileged auth role from T0. The platform bypass role is **deferred** (review finding #14).
- [ ] P0-T4.5 `Clock` / `IdGenerator` strategy agreed here (seed and fixtures already need it) even though the ports land in T7.
- **Done when:** a throwaway migration applies and rolls forward cleanly; the raw-client test passes.

#### P0-T6a — `packages/contracts` for tenancy · S · ⬜ · depends T4 (before T5, per `CLAUDE.md` §1 contract → migration)

- [ ] P0-T6a.1 Zod schemas for company, business, branch, plan; error envelope `{ code, message_ar, message_en, details? }`; cursor pagination envelope.
- [ ] P0-T6a.2 `pnpm contracts:openapi` scaffold.

#### P0-T5 — `tenancy` schema + RLS ⭐ the success criterion · L · ⬜ · depends T4, T6a

- [ ] P0-T5.1 `packages/db/schema/tenancy.ts` + `migrations/0001_tenancy.sql`: `plans`, `companies`, `businesses`, `branches` per SPEC §4, with `company_id NOT NULL`, explicit `USING` **and** `WITH CHECK` policies, `FORCE ROW LEVEL SECURITY`, composite indexes starting with `company_id`.
- [ ] P0-T5.2 Tenant-qualified composite foreign keys: `businesses UNIQUE (company_id, id)`, `branches` references `(company_id, business_id)`; the same pattern is mandatory for every child table in later phases.
- [ ] P0-T5.3 `plans` exception: no `company_id`, no RLS, read-only for the app role — recorded in an ADR.
- [ ] P0-T5.4 Define the tenant-root rule for `companies` (`id` vs `company_id` relationship enforced).
- [ ] P0-T5.5 Negative isolation suite (`packages/db/src/__tests__/rls-tenancy.spec.ts`, testcontainers, **run as the restricted app role**): role assertions (`NOSUPERUSER`, `NOBYPASSRLS`, no ownership, cannot `SET ROLE`); cross-tenant `SELECT` = 0 rows; cross-tenant `INSERT` rejected by `WITH CHECK`; cross-tenant `UPDATE`/`DELETE` affect 0 rows; same-tenant `UPDATE` changing `company_id` rejected; `UPSERT` cannot cross tenants; query outside `withTenant()` returns 0 rows.
- [ ] P0-T5.6 Context-leak assertions: reuse one pooled connection A → B → no tenant; after an exception; after a rollback; two concurrent transactions do not see each other's setting; session-level settings do not survive under transaction-local overrides.
- [ ] P0-T5.7 Referential-integrity assertion: A cannot create a branch whose `business_id` belongs to B.
- [ ] P0-T5.8 Inventory assertion: no `SECURITY DEFINER` function on tenant tables; if ever added it pins `search_path` and restricts `EXECUTE`.
- [ ] P0-T5.9 Seed: plans at launch (⛔ D-06), one demo company per vertical.
- **Done when:** every assertion passes as the restricted role and is wired into `pnpm test`.

#### P0-T6b — `apps/api` skeleton · M · ⬜ · depends T5

- [ ] P0-T6b.1 NestJS on the Fastify adapter; `main.ts`, `app.module.ts`; `shared/` limited to code with no business meaning.
- [ ] P0-T6b.2 Global exception filter emitting the bilingual error envelope.
- [ ] P0-T6b.3 `/health` (process alive) and `/ready` (DB + Redis reachable) as different checks.
- [ ] P0-T6b.4 pino with the **redaction list** wired here (moved earlier from T11 so no real request is ever logged unredacted).
- [ ] P0-T6b.5 OpenAPI generated from the Zod contracts.
- **Done when:** `GET /health` returns 200 and the OpenAPI file is generated.

#### P0-T7 — Cross-cutting write primitives · M · ⬜ · depends T6b

- [ ] P0-T7.1 `outbox` table + `OutboxWriter` port; event row written inside the caller's transaction; test proves a rolled-back transaction leaves no outbox row.
- [ ] P0-T7.2 `audit_log` table + writer; field allowlists for `before`/`after`; DB privileges prevent runtime modification or deletion of audit rows.
- [ ] P0-T7.3 Idempotency store: `key` + `company_id` + `operation` uniqueness, `request_fingerprint`, `status IN_FLIGHT|COMPLETED|FAILED`, `response_status`, `response_body`, `expires_at` (24 h, swept by a job); claim + business effect in one transaction; same key different body → 422; concurrent duplicate on `IN_FLIGHT` → 409; crash mid-flight expires rather than blocks.
- [ ] P0-T7.4 `Clock` and `IdGenerator` ports + `SystemClock`, `UuidV7Generator`; CI grep rejects `Date.now()` / `randomUUID()` in `use-cases/`.
- [ ] P0-T7.5 Worker transaction/context entry point: a job resolves `company_id` from its payload and calls `withTenant()`; nothing non-serialisable crosses into a job.
- **Done when:** tests prove (a) rollback leaves no outbox row, (b) a replayed key returns the identical stored response, (c) same key + different body is rejected, (d) two concurrent identical requests produce exactly one effect.

#### P0-T8 — `tenancy` use cases · L · ⬜ · depends T7

- [ ] P0-T8.1 Module shape exactly per `CLAUDE.architecture.md` §5; slice specs in `docs/specs/tenancy/{create-company,create-business,create-branch}.md`.
- [ ] P0-T8.2 Use cases `create-company`, `create-business`, `create-branch`: one transaction, `Idempotency-Key`, outbox event inside the transaction, audit row; events `CompanyCreated`, `BusinessCreated`, `BranchCreated` documented in `events/published.ts`.
- [ ] P0-T8.3 Onboarding rule: creating a company creates the first **owner** membership for the caller (the "who creates the first owner" question from the review).
- [ ] P0-T8.4 Queries `list-businesses.query.ts`, `branch-detail.query.ts` with result-shape tests and `EXPLAIN` index-usage assertions on a seeded dataset.
- [ ] P0-T8.5 **API-level isolation proof:** integration test that a session of company A, requesting company B's id, is refused before `withTenant(B)` is ever called; company switching authorised only through a verified membership.
- **Done when:** integration tests cover the happy path and listed edge cases; `pnpm lint:boundaries` passes.

#### P0-T9 — `packages/auth` + `identity` · L (7–12 working days, the likeliest overrun) · ⛔ D-07, D-08, D-09

- [ ] P0-T9.1 Better Auth self-hosted on the Drizzle adapter; plugins `two-factor` (TOTP) now, `phone-number` and `api-key` installed but not wired until a delivery channel / Phase 5 exists; `organization` only if T0 assigns it a role.
- [ ] P0-T9.2 `packages/auth` is the only code that issues/verifies a session, hashes a password or a PIN.
- [ ] P0-T9.3 Schema `identity.ts` + `migrations/0003_identity.sql`: `memberships` (scope, role, permission_overrides, `starts_at`/`ends_at` for temporary roles), `roles`, `permissions` (seeded from code), `role_permissions` with `constraints jsonb`, `permission_overrides` (ALLOW/DENY, reason, granted_by, expires_at), `cashier_pins`, `devices` — reconciling SPEC §4 with `09` §11 (see §13 item 12). Tenant-qualified FKs for devices and scoped memberships.
- [ ] P0-T9.4 `@Require('action:resource:scope')` guard resolving the membership server-side; deny by default; a controller method without a guard fails CI; Redis permission cache with invalidation.
- [ ] P0-T9.5 Seed role bundles per `09` §5–§6 (⛔ D-07 exact codes): Owner, General Manager, Accountant, Business Manager, Branch Manager, Shift Supervisor, Cashier, Waiter, Kitchen, Storekeeper, Staff, Marketing, Viewer; platform roles Super Admin, Support, Billing, Developer, Break-glass.
- [ ] P0-T9.6 Device flow: `register-device` (pairing code, short TTL in Redis) → `approve-device` → `revoke-device`; long-lived hashed device token (⛔ D-09 lifetime/renewal); `DeviceRegistered` / `DeviceRevoked` events.
- [ ] P0-T9.7 Cashier PIN: `set-cashier-pin`, `verify-cashier-pin` against a stored hash; Redis lockout (⛔ D-08 length, attempts, lock duration); PIN never opens `app.`; device pulls PIN **hashes** with the catalog snapshot (used offline in Phase 2).
- [ ] P0-T9.8 Every sensitive action (PIN change, device approval/revocation, role change, override) writes an audit row.
- [ ] P0-T9.9 Tests: real login/session flows, two-company membership, membership removal, device revocation rejected on next contact, last-owner protection.
- **Done when:** PIN verification works against a stored hash, a revoked device is rejected, every sensitive action is audited, and a guard-less route fails CI.

#### P0-T10 — `settings` + `packages/i18n` · M · ⬜ · depends T8 (invoice header ⛔ D-05 product name)

- [ ] P0-T10.1 `business_settings` table + RLS: `tax_rule`, `invoice_template`, `order_rules`, hours, payment methods, delivery zones, default language, calendar (Hijri/Gregorian).
- [ ] P0-T10.2 `get-settings` / `update-settings` use cases with audit rows (tax and invoice template are dangerous permissions).
- [ ] P0-T10.3 Canonical **branch timezone** source of truth (⛔ D-10): `branches.timezone` overriding `businesses.timezone`, used by attendance working-date assignment and reports.
- [ ] P0-T10.4 `packages/i18n`: ar/en catalogs, `formatKwd`, Hijri/Gregorian, timezone helpers; error envelopes carry both languages; no hardcoded strings outside the package.
- **Done when:** `formatKwd(12500n) === '12.500'` and formatter tests pass.

#### P0-T11 — `packages/observability` · M · ⬜ · parallel track with T7–T8 (shares no files)

- [ ] P0-T11.1 pino config + redaction list (already wired in T6b, centralised here), request-context propagation of `request_id`, `company_id`, `branch_id`, `user_id`.
- [ ] P0-T11.2 OpenTelemetry setup with ordinary head sampling (tail sampling deferred per review).
- [ ] P0-T11.3 Sentry hook.
- **Done when:** a test asserts a deliberately logged PIN does not appear in output.

#### P0-T12a — Minimal CI · S · 🔄 (`.github/workflows/ci.yml` exists from PR #1)

- [x] P0-T12a.1 typecheck, lint, lint:docs, unit on every PR and push.
- [ ] P0-T12a.2 Branch protection: no direct push to `main`, CI required.

#### P0-T12b — Full CI gate · M · ⬜ · grows with T5, T8, T13

- [ ] P0-T12b.1 Gate order exactly: `typecheck → lint → lint:docs → boundaries → cycles (dependency-cruiser + madge) → module-map check (script reads docs/module-map.yaml) → unit → integration (testcontainers) → RLS negative → EXPLAIN checks → build all apps → docker images`.
- [ ] P0-T12b.2 Extract `docs/module-map.yaml` from `module-map.md` §6 and write the check script.
- [ ] P0-T12b.3 Images tagged by commit SHA, pushed to GHCR; never `latest`.
- [ ] P0-T12b.4 A deliberately broken fixture PR once, to confirm the boundary step actually blocks.
- **Done when:** a PR violating a module boundary is blocked by CI.

#### P0-T13 — Staging deploy + backups + worker bootstrap · L · ⛔ D-11 (staging host) · depends T9, T10, T11, T12b

- [ ] P0-T13.1 `deploy/docker-compose.staging.yml`, `Dockerfile.api`, `Dockerfile.worker`: multi-stage on `node:24-alpine` (ADR-0002 says Node 24; the plan says 22 — align), production deps only; **no Chromium, no Arabic fonts** in the worker yet.
- [ ] P0-T13.2 `apps/worker` bootstrap: `main.ts`, `/health`, `/ready`, BullMQ connection, **outbox dispatcher** (poll → publish → mark published, retry, consumer dedupe by `event_id`).
- [ ] P0-T13.3 Dokploy + Traefik on the chosen host; subdomains and cookie domain per ADR-0001 §6; secrets injected from Dokploy; test keys only.
- [ ] P0-T13.4 Migrations run as their own step before containers start; after every migration run the **previous** image against the **new** schema and confirm it serves.
- [ ] P0-T13.5 Backups: nightly `pg_dump` encrypted to B2 via restic **and** pgBackRest/wal-g base backup + continuous WAL; RPO ≤ 5 min, RTO ≤ 2 h; both check in to Healthchecks.io.
- [ ] P0-T13.6 One PITR restore actually performed to a chosen timestamp and queried; one logical restore into a scratch DB.
- **Done when:** staging deploys from a SHA-tagged image, the old image still runs on the new schema, and both restores have been performed.

**Phase 0 acceptance checklist (from SPEC §6, extended):**

- [ ] Two companies exist; the negative isolation suite proves zero cross-tenant reads and rejected/no-op cross-tenant writes
- [ ] The API-level test proves A cannot resolve B
- [ ] No module reaches the DB except through `withTenant()` (or the named auth exception); raw client not exported
- [ ] Every endpoint declares a guard; a guard-less route fails CI
- [ ] `pnpm lint:docs` green; every `domain/`, `ports/`, `events/published.ts` export has its Arabic doc comment
- [ ] A write use case appends its outbox event inside its transaction, proven by a test; the worker dispatches it
- [ ] Every API log line carries the four context fields; nothing on the redaction list is logged
- [ ] CI runs the full gate in order and blocks a boundary violation
- [ ] Staging deploys from a SHA image; old image serves on the new schema; PITR and logical restores rehearsed
- [ ] `pnpm check` green on `main`

**Phase 0 schedule (revised, weeks):** 1: T0 T1 T2 T3 T12a · 2: T4 T6a T5 · 3: T5 T6b T7 · 4: T7 T8 · 5: T9 · 6: T9 T10 T11 · 7: T12b T13 · 8: buffer + PITR rehearsal.

---

### Phase 1 — Staff, attendance, commissions (salon pilot)

> **Goal.** The salon runs on digital attendance and its commissions are computed automatically from recorded sessions, with a manager-approved monthly statement. First visible value for the client.
>
> **Modules:** `staff`, `commissions`, a **minimal** `orders` slice (service-session recording), minimal `notifications` (OTP delivery). **Apps:** `apps/admin` and `apps/pos` bootstrapped; `packages/ui` created.
>
> **What the client provides before start:** salon services and prices, staff list and each one's commission system, shift schedules, a tablet/screen at the entrance, a named person who tests and answers within 48 h.

#### P1-T1 — Phase 1 spec pack · M · ⛔ D-12…D-17

- [ ] P1-T1.1 `docs/specs/phase-1/SPEC.md` + `IMPLEMENTATION-PLAN.md`, adversarially reviewed like Phase 0.
- [ ] P1-T1.2 Collect the client's answers to the discovery questions §3-ب/ج of `03_Meeting2_Agenda_And_Questions_AR.md` (QR placement, who scans, geofence/selfie, fixed vs weekly shifts, lateness rules, leave workflow, commission specifics: pre/post discount basis, split rule, revenue scope, tier mode, refund handling, rating link, attendance link, payout cycle).
- [ ] P1-T1.3 Slice specs for every use case below in `docs/specs/{staff,commissions,orders}/`.

#### P1-T2 — `staff` module: employees, documents, schedules, leave · L

- [ ] P1-T2.1 Schema `staff.ts`: `employees` (business, branch(es), user?, role, base_salary, commission_plan_id, hire_date, contract_end, soft delete), `employee_documents` (type, expiry, R2 key — private file), `schedules` (fixed or weekly), `leave_requests` (type, range, status, decided_by, note). RLS + tenant-qualified FKs + negative tests.
- [ ] P1-T2.2 Use cases `create-employee`, `update-employee`, `upload-employee-document`, `set-schedule`, `request-leave`, `decide-leave`; audit rows on salary and plan changes.
- [ ] P1-T2.3 Document-expiry alert (residency/contract within 30 days) as a nightly worker job emitting a notification.
- [ ] P1-T2.4 `staff → identity` import arrow only for linking an employee to a user (already declared in `module-map.md`).
- [ ] P1-T2.5 Queries: employees list, employee detail, schedule for period, leave inbox.

#### P1-T3 — Rotating-QR attendance engine ★ · L

- [ ] P1-T3.1 Token issuer: every 60 s the API issues `HMAC(branch_id ‖ window_index ‖ secret)`; secret per branch in Redis, rotated daily; QR encodes `{branch_id, window, sig}`; `GET /v1/attendance/qr` for the branch display (device-token authenticated).
- [ ] P1-T3.2 Domain: `isTokenValid(token, now, secretHistory)` accepting current or previous window (120 s tolerance); `withinGeofence(point, branch, radius)` Haversine; `shouldToggle(openSession)`; dedupe rule (one clock per 5 min) — all pure, all Arabic-documented, all unit tested.
- [ ] P1-T3.3 Use case `clock-attendance` (`POST /v1/attendance/clock {token, geo, device_fp}`): validate signature and window, employee ∈ branch, optional geofence, dedupe, toggle IN/OUT on the open session, write `attendance_sessions`, emit `AttendanceClocked`; permission `clock:attendance:own`.
- [ ] P1-T3.4 Anti-cheat: token bound to branch + time; device fingerprint stored; optional selfie upload [V1]; anomaly query "same device clocked two employees".
- [ ] P1-T3.5 **Barcode ID-card method** (⛔ D-13): employee barcode card scanned by a reader/camera at the entrance, enabled per branch, alone or as a second factor; same `clock-attendance` use case with `source = BARCODE`.
- [ ] P1-T3.6 Manual correction (`correct-attendance`): mandatory reason, approval, keeps previous value, audit row; forgotten clock-outs surface in an exceptions list that must be cleared before a payroll/commission period closes.
- [ ] P1-T3.7 Attendance, cashier login and cash-shift opening are **three different events**; the optional "no cash shift without attendance" link is a state-conditioned permission [V1].

#### P1-T4 — Lateness, hours, working date · M

- [ ] P1-T4.1 Domain: `lateMinutes(scheduledStart, actualClockIn, graceMinutes)`, `workedMinutes(session)`, `overtimeMinutes(worked, scheduled, rules)` [V1], `workingDate(clockIn, branchTimezone)` — the branch-timezone decision D-10 is a hard dependency.
- [ ] P1-T4.2 Lateness rules per business: grace minutes, deduction %, who approves exceptions.
- [ ] P1-T4.3 Absence alert to the manager when an employee has not clocked in N minutes after shift start (worker job + notification).
- [ ] P1-T4.4 Queries: who is in the branch now (polling; `realtime` arrives in Phase 2), daily attendance board, monthly attendance report per branch/employee (CSV export).

#### P1-T5 — Commission engine domain ★★ · L

- [ ] P1-T5.1 `computeCommission(entry, rules, context): bigint` — rules are data, evaluated by one pure function; rule types `PER_ITEM_PCT` (line net/gross, split among several `served_by`), `REVENUE_PCT` (employee's or branch's period revenue, with/without product sales), `TIERED` (tiers `[{from, to, pct}]`, mode `MARGINAL` = only above threshold, `WHOLE` = entire amount once threshold passed).
- [ ] P1-T5.2 `splitCommissionAmongStaff(lineAmount, shares)`; refund/cancel reversal as **negative entries**; rating multiplier and attendance deduction as modifiers [V1].
- [ ] P1-T5.3 Definition of **net eligible sales** (⛔ D-14): discounts, returns, tax, service fees, participants' shares, period lock date.
- [ ] P1-T5.4 Exhaustive unit tests incl. the owner's worked example (base 500 KWD, 5 % on sales above 500 → 1,000 KWD sales = 25 KWD) and every rule × basis × mode combination; signed rounding.
- [ ] P1-T5.5 Adding a rule type must be a new evaluator, never an `if` in `computeCommission` (Open/Closed).

#### P1-T6 — `commissions` module: plans, entries, statements · L

- [ ] P1-T6.1 Schema `commissions.ts`: `commission_plans`, `commission_rules`, `commission_entries` (immutable, reversible), `commission_statements` (period, status DRAFT → APPROVED → PAID). RLS + negative tests.
- [ ] P1-T6.2 Ports: `EmployeePlanPort` (reads `staff`), consumes events `ServiceCompleted`, `ReturnPosted`, `PaymentRefunded`, `OrderCancelled`, `AttendanceClocked` (deduction [V1]) idempotently by `event_id`.
- [ ] P1-T6.3 Use cases `create-commission-plan`, `assign-plan-to-employee` (effective-date rules), `generate-statement`, `approve-statement` (permission `approve:commissions:business`, audit), `mark-statement-paid`; a return after payout creates a correction entry in the next period, never silently reopens an approved statement.
- [ ] P1-T6.4 Queries: employee commission detail (`view:commissions:own`), statement list/detail, monthly export CSV (PDF arrives with `packages/documents` in Phase 5).

#### P1-T7 — Minimal service-session recording (orders precursor) · M · ⛔ D-15

- [ ] P1-T7.1 Because the POS does not exist yet, ship one `orders` slice `record-service-session`: an order of `SERVICE` lines with `served_by_staff_id`, price, discount, completed timestamp; emits `ServiceCompleted` per line and `OrderCompleted`. Same module shape, same events, so Phase 2 replaces the entry screen, not the data.
- [ ] P1-T7.2 Data model already carries `service_barcode` per line and allows **assignment after the fact** (the client's flow: the cashier prints one barcode per service line, the customer hands each to the staff member who actually performed it, staff scan at end of day) — flow rules (issue, scan, cancel, duplicate prevention, same-day vs later) are D-15.
- [ ] P1-T7.3 Minimal catalog dependency: a `services` seed (name ar/en, price, duration) inside `catalog` as its first slice, read by `orders` through `CatalogReaderPort`.

#### P1-T8 — Employee identity and OTP delivery · M · ⛔ D-16

- [ ] P1-T8.1 Wire Better Auth `phone-number` (OTP) for employees; medium-lived session bound to the employee, not the branch device.
- [ ] P1-T8.2 `packages/notifications` first slice: `Channel` interface + one adapter (WhatsApp Cloud API or SMS — D-16) + OTP template ar/en + Redis rate limits per phone and per IP.
- [ ] P1-T8.3 `own` scope permissions: `view:attendance:own`, `view:schedule:own`, `view:commissions:own`, `create:leave:own`.

#### P1-T9 — `apps/pos` bootstrap + staff routes · L

- [ ] P1-T9.1 Vite React PWA shell: routing, providers, composition root; folders `app/ shared/ attendance/`; `packages/ui` created (shadcn RTL kit, Tailwind tokens, Arabic fonts, Framer presets, lucide); `packages/i18n` consumption; generated API client hooks (TanStack Query).
- [ ] P1-T9.2 `/attendance-screen`: branch display with the rotating QR, big clock, branch name; device-token authenticated; survives network blips by caching the next windows.
- [ ] P1-T9.3 `/staff`: phone-OTP login, camera QR scan → clock, my attendance log, my schedule, my commissions (current period), leave request and status; push notifications [V1].
- [ ] P1-T9.4 Barcode ID card rendered in-app (digital card) [if D-13 accepted].

#### P1-T10 — `apps/admin` bootstrap + Phase 1 screens · L

- [ ] P1-T10.1 Next.js App Router shell: `app/` routes only, `src/{staff,commissions,settings,shared}`; Better Auth login + TOTP; company / business / branch selector locked server-side to the user's scope.
- [ ] P1-T10.2 Users & permissions screen (simple: memberships, role, overrides, temporary `ends_at`).
- [ ] P1-T10.3 Employees, documents, schedules, attendance board + corrections + exceptions, leave approvals inbox.
- [ ] P1-T10.4 Commission plans/rules editor, statements (generate, review, approve, mark paid, export).
- [ ] P1-T10.5 Service-session entry screen (temporary, replaced by the POS in Phase 2).

#### P1-T11 — Salon pilot · M

- [ ] P1-T11.1 Seed real salon data (services, staff, plans, schedules) from the client's sheets.
- [ ] P1-T11.2 Install the entrance tablet; onboard staff phones; one-week dry run.
- [ ] P1-T11.3 One full month in parallel with the manual process.
- **Phase 1 exit:** the generated commission statement for the trial month matches the owner's manual calculation line by line; attendance disputes are resolved from the log; the owner approves the statement in the app.

---

### Phase 2 — Catalog, orders, payments, cash, POS (restaurant pilot)

> **Goal.** One restaurant branch (proposed: Smoked) runs the new POS in parallel with Twlm for two weeks, then switches. The riskiest phase: hardware, printers, offline, KNET.
>
> **Modules:** `catalog`, `customers`, `orders` (full), `payments`, `cash`, `realtime`, `files`; `identity` numeric constraints + approvals. **Packages:** `payments`, `storage`, `documents` (ESC/POS part only). **Apps:** `apps/pos` sell/shift/offline; `apps/admin` screens.
>
> **Before start (hardware and accounts):** supported POS devices and thermal printer models chosen and tested in week 1 (D-18), gateway account (MyFatoorah) opened, catalog exported from Twlm.

#### P2-T1 — Phase 2 spec pack + hardware decisions · M · ⛔ D-18, D-19

- [ ] P2-T1.1 `docs/specs/phase-2/SPEC.md` + plan, reviewed.
- [ ] P2-T1.2 Device profile: Windows/Android/iPad, printer models, barcode scanner, cash drawer kick; print-agent ADR (D-19: tiny Node or Go LAN service vs WebUSB/Bluetooth; browser print fallback).
- [ ] P2-T1.3 Payment flow decision confirmed (BYO gateway, D-03) and MyFatoorah sandbox credentials.

#### P2-T2 — `catalog` module · L

- [ ] P2-T2.1 Schema: `categories` (tree, sort, visibility per branch/channel, soft delete), `items` (kind PRODUCT|SERVICE, names, base_price, cost, tax_rule, barcode, calories, allergens, duration_min, resource_type, requires_staff, default_commission_rule, soft delete), `item_variants`, `option_groups`/`option_values` (single/multi, min/max, required, priced), `item_option_groups`, `item_prices` (branch?, channel?, order_type?) with priority resolution ★ [V1 UI, schema now]. RLS + tenant-qualified FKs.
- [ ] P2-T2.2 Use cases: create/update/archive category & item, set variants, set option groups, set price override, bulk price update (audit), Excel import/export (worker job).
- [ ] P2-T2.3 Redis cache of the branch menu snapshot with version; invalidation owned by `catalog` only.
- [ ] P2-T2.4 `files` module + `packages/storage` (R2 adapter, presigned URLs, key builder `{companyId}/{businessId}/…`); item images re-encoded.
- [ ] P2-T2.5 Queries: menu snapshot for POS (versioned), admin lists.

#### P2-T3 — `customers` module · M

- [ ] P2-T3.1 Schema: `customers` (type individual/company, phones, credit_limit, balance, tags, notes, birth_date, preferred_staff_id, blocked, opt-in marketing, soft delete).
- [ ] P2-T3.2 Use cases create/update/block, credit-limit change (audit); `CustomerCreditPort` for `orders`.
- [ ] P2-T3.3 Customer file unified across branches of the same business, visible only to permitted roles; `export:customers` constrained (`max_rows`) and audited.

#### P2-T4 — `orders` module (full) · XL

- [ ] P2-T4.1 Domain: `computeOrderTotals(lines, discounts, taxRule, serviceFee, tip)` with half-up line rounding; `canTransition(status, event)` state machine; return policy (`RESTOCK|WASTE|NONE`); discount validation against permission constraints; all pure, exhaustive tests, **imported unchanged by the POS**.
- [ ] P2-T4.2 Schema: `orders`, `order_items` (served_by, appointment_id, service_barcode), `order_item_options`, `returns`, `return_lines`; `client_id` + `idempotency_key` unique per company; `channel_id` + `external_ref`; custom fields jsonb (table number …).
- [ ] P2-T4.3 Use cases: `create-order`, `add-order-item`, `apply-discount` (code/manual; above constraint → approval request), `complete-order`, `void-order` (after payment → approval + reason), `post-return`, `assign-service-staff` (barcode scan), `hold-order`/`recall-order` [V1]; every write idempotent, transactional, outbox inside.
- [ ] P2-T4.4 Ports `CatalogReaderPort`, `CustomerCreditPort`; events `OrderCreated`, `OrderCompleted`, `OrderCancelled`, `ServiceCompleted`, `ReturnPosted`; handler `on-payment-captured`.
- [ ] P2-T4.5 Order types: dine-in, takeaway, delivery, drive-thru, booking, service; per-branch order-type × channel matrix from `settings`.
- [ ] P2-T4.6 Queries: orders list (cursor, filters indexed), order detail, open orders.

#### P2-T5 — `payments` module + `packages/payments` · XL

- [ ] P2-T5.1 `PaymentGateway` interface + **capability matrix** (refund, split, saved cards, webhooks) checked before any call; adapters: MyFatoorah (KNET, cards, Apple Pay) now; Tap and KNET-direct (no refund API → capability `refund: false`) later.
- [ ] P2-T5.2 BYO model: `connect-gateway-account` stores envelope-encrypted credentials per business, `GatewayAccountConnected` event, disconnect audited.
- [ ] P2-T5.3 Schema: `payment_methods`, `payments` (method, amount, status, gateway_ref, card_last4, terminal_id, shift_id, idempotency_key), `refunds`, `credit_ledger` (A/R), `gateway_events_raw`.
- [ ] P2-T5.4 Use cases: `record-cash-payment`, `initiate-gateway-payment`, `record-terminal-payment` (external device reference), `record-on-account-payment` (credit limit via port), `refund-payment` (constraint → approval), split across methods; `OrderTotalsPort` reads `orders`.
- [ ] P2-T5.5 Webhook intake `POST /v1/webhooks/myfatoorah`: verify signature → store raw → enqueue → 200; worker processes idempotently by provider event id; server-side status poll as fallback; only these move a payment to `CAPTURED`/`FAILED`/`REFUNDED`.
- [ ] P2-T5.6 Events `PaymentCaptured`, `PaymentRefunded`, `PaymentFailed`; A/R aging query.

#### P2-T6 — `cash` module · M

- [ ] P2-T6.1 Domain `reconcileDrawer({openingFloat, tenders, countedCash})` → expected, variance; `closeShift` invariants.
- [ ] P2-T6.2 Schema `cash_shifts`, `cash_movements` (paid in/out with reason).
- [ ] P2-T6.3 Use cases `open-cash-shift` (device + cashier PIN, one open shift per drawer), `record-cash-movement`, `close-cash-shift` (count without seeing expected first — D-20; `PENDING_GATEWAY` tenders block close unless manager override; variance above `max_variance` → approval), `CashShiftClosed` event; `ShiftPaymentsPort` reads `payments`.
- [ ] P2-T6.4 Queries: open shifts and who opened them, shift report (X/Z), expected cash now.

#### P2-T7 — Numeric constraints and approvals inbox · M

- [ ] P2-T7.1 `role_permissions.constraints` enforced by the guard (`max_pct`, `max_amount`, `backdate_days`, `max_variance`, `manual_edit`, `max_rows`).
- [ ] P2-T7.2 `approval_requests` table + `request-approval` / `decide-approval` use cases; above-limit actions become requests, not refusals; manager decides from phone; every decision audited; WhatsApp alert to owner on the 12 dangerous actions [V1].
- [ ] P2-T7.3 Approvals inbox in admin; pending-approval state in POS.

#### P2-T8 — `realtime` module · M

- [ ] P2-T8.1 `GET /v1/stream` SSE; channel subscription resolved server-side from the session via `ChannelScopePort` (`identity`).
- [ ] P2-T8.2 Every domain event has its business consumer **and** the realtime publisher; screens fall back to polling if the stream dies; Cloudflare stays DNS-only on `api.`.

#### P2-T9 — POS sell / shift / offline ★ · XL

- [ ] P2-T9.1 `offline/`: Dexie schema (catalog snapshot, customers snapshot, PIN hashes, device token, orders, outbox), sync engine, Service Worker background sync, conflict rules (server price wins, captured price kept with audit), snapshot versioning.
- [ ] P2-T9.2 `sell/`: order building with variants/options/notes/custom fields, totals via `packages/domain`, discounts within constraint, split payments, on-account, gift card/points placeholders, hold/recall [V1], returns; every order created locally with UUID v7 + idempotency key.
- [ ] P2-T9.3 `shift/`: PIN prompt on a registered device (local hash verify), open/close with count, movements, pending-gateway indicator; PIN re-prompt on shift change / idle.
- [ ] P2-T9.4 Layout preference: products right / order left or the reverse, saved per user (`client-discovery` Q20); multiple concurrent held orders named by table/pickup number (Q21).
- [ ] P2-T9.5 Card/KNET while offline: queued as pending payment; cash/on-account complete offline; sync status always visible.
- [ ] P2-T9.6 Revoked device: token rejected on next contact and local snapshot wiped.

#### P2-T10 — Printing, receipts, digital invoice · L · ⛔ D-19

- [ ] P2-T10.1 `packages/documents` ESC/POS builder (Arabic shaping, logo, QR); receipt and kitchen-ticket templates per business `invoice_template`.
- [ ] P2-T10.2 Print agent on the counter PC/Android (LAN), browser print fallback, printer-failure outcome clear to the cashier, reprint marked as a copy.
- [ ] P2-T10.3 Digital invoice: public short link + QR, optional WhatsApp send (via `notifications`).

#### P2-T11 — Admin screens + daily dashboard · L

- [ ] P2-T11.1 Catalog (tree drag & drop, items, variants, options, prices, import/export), customers, orders list/detail/returns, payments & refunds, shifts, settings (tax, invoice template, hours, payment methods, order rules), devices & PINs, approvals inbox.
- [ ] P2-T11.2 Per-business daily dashboard through `reporting/queries/` (sales today, orders, average ticket, net after returns, expected cash, new customers; by hour, channel, method; top/bottom 10) with `EXPLAIN` tests; widgets shrink by role.

#### P2-T12 — E2E + restaurant pilot · L

- [ ] P2-T12.1 Playwright critical path: open shift → order → split payment → print → close shift, including the offline toggle; runs in CI.
- [ ] P2-T12.2 Migration: catalog and customers exported from Twlm and imported.
- [ ] P2-T12.3 Two weeks parallel run in one branch, then switch.
- **Phase 2 exit:** a full trading day with no stop; shift close matches counted cash; receipts and kitchen tickets print correctly; an offline interval yields exactly one correct order per sale after reconnect, even with retried uploads.

---

### Phase 3 — Inventory, recipes, production, kitchen

> **Goal.** Reach Twlm's inventory depth, then exceed it (WhatsApp alerts, material usage per service). Kitchen display goes live. Restaurant depth items (tables, merge/split) land here.

#### P3-T1 — Phase 3 spec pack · M · ⛔ D-21 (costing policy, counting cadence, supplier terms)

#### P3-T2 — `inventory` core: UoM, items, locations, ledger, costing · XL

- [ ] P3-T2.1 Domain: `convertQuantity(qty, fromUoM, toUoM, factor)`, `movingAverageCost(prevBalance, prevCost, inQty, inCost)`, `applyMovement(balance, delta)`, valuation; exhaustive tests; FIFO [V2].
- [ ] P3-T2.2 Schema: `uoms`, `stock_items` (kind RAW|SEMI|PACKAGING|CONSUMABLE, storage UoM ≠ recipe UoM with factor, min level, reorder qty, preferred supplier), `stock_locations` (main warehouse / branch store, default per branch), `stock_movements` (qty_delta, unit_cost, `balance_after`, source_type, source_id — the only way stock changes), `batches` (expiry).
- [ ] P3-T2.3 Use cases: `post-stock-adjustment` (reason, approval), `post-wastage` (reasons, approval), `open-stock-count` / `record-count-lines` / `post-stock-count` (variances explained), `StockPosted` event.
- [ ] P3-T2.4 Suppliers and purchases: `suppliers` (payment terms), `purchases` draft → received → posted with lines, batches, expiry; partial receipts; purchase returns.
- [ ] P3-T2.5 Low-stock and near-expiry alerts (worker job → `notifications`, WhatsApp) ★.

#### P3-T3 — Sales-driven stock effects · M

- [ ] P3-T3.1 `on-order-completed` handler deducts per recipe (BOM) or per direct stock link; `on-order-cancelled` reverses; `on-return-posted` restocks or wastes per `stock_effect`.
- [ ] P3-T3.2 ★ `service_material_usage` (dye per session, detergent per laundry order) deducted on `ServiceCompleted` [V1].

#### P3-T4 — Recipes, production, transfers · L

- [ ] P3-T4.1 `recipes` + `recipe_ingredients` with auto cost roll-up; `production_orders` (from recipe or manual) posting consumption and output movements.
- [ ] P3-T4.2 `transfers` between locations with approval and receipt.

#### P3-T5 — `kitchen` KDS · M

- [ ] P3-T5.1 Tickets and stations fed by `OrderCreated`; status flow preparing → ready → served; late-ticket alerts; waiting screen for customers; realtime via SSE; printer fallback per branch setting.

#### P3-T6 — Restaurant depth in orders/POS · L

- [ ] P3-T6.1 Tables and floor map, merge/split bill, transfer order between staff (rights reviewed), hold/recall, happy-hour price rules [V1].

#### P3-T7 — Reports and admin screens · L

- [ ] P3-T7.1 `reporting/queries/sql/`: valuation, levels, movements ledger with running balance, low stock, wastage, purchases, COGS profitability per product; `EXPLAIN` tests; listed in `docs/reporting-queries.md`.
- [ ] P3-T7.2 Admin: stock items, locations, purchases, suppliers, counts, wastage/adjustment approvals, recipes, production, transfers, KDS settings; storekeeper role sees no sale prices.
- **Phase 3 exit:** a monthly count closes with every variance justified; product profitability reports use real moving-average cost; low-stock alerts arrive on WhatsApp.

---

### Phase 4 — Appointments, e-menu, loyalty, channels, notifications

> **Goal.** The salon runs entirely on the system (calendar, bookings from every channel, reminders, ratings). Restaurants get their own online menu. Delivery-app orders land in the POS without extra tablets.

#### P4-T1 — Phase 4 spec pack · M · ⛔ D-22 (delivery hub path), D-23 (booking policy, deposits, cancellation window)

#### P4-T2 — `appointments` module · XL

- [ ] P4-T2.1 Domain: `isSlotAvailable(resourceSchedule, requestedRange, buffers)`, conflict detection, capacity, buffers between sessions, "any available" assignment; tests.
- [ ] P4-T2.2 Schema: `resources` (chair/room/device), `appointments` (customer, resource?, staff?, starts_at, duration, status BOOKED → ARRIVED → IN_PROGRESS → DONE → INVOICED, NO_SHOW), `waitlist`, `deposits` [V1].
- [ ] P4-T2.3 Use cases: `book-appointment` (from POS, phone, WhatsApp, site), `reschedule`, `cancel` (policy), `check-in`, `complete-appointment` (creates/links the order → `AppointmentCompleted`, `ServiceCompleted`), recurring [V1]; ports `ServiceCatalogPort`, `StaffAvailabilityPort` (schedule + leave).
- [ ] P4-T2.4 Reminders (`AppointmentBooked` → `notifications` schedule) with reply confirmation [V1]; post-session rating request → rating stored → feeds commissions multiplier and loyalty [V1].
- [ ] P4-T2.5 Calendar UI in admin/POS per provider/resource; appointments report (occupancy, no-show, revenue per staff).

#### P4-T3 — `notifications` full + `packages/notifications` · L

- [ ] P4-T3.1 Adapters: WhatsApp Cloud API (approved templates, opt-in/out, per-recipient rate limits, webhook callbacks under the session-less tenant rule), email (Resend, `send.pospay.systems`), SMS, push [V1]; templates ar/en; `NotificationDelivered`/`NotificationFailed` events.
- [ ] P4-T3.2 Operational messages: order/booking confirmation, appointment reminder, digital invoice, "ready" notification, manager alerts (shift variance, approvals, low stock).
- [ ] P4-T3.3 ★ Segmented marketing campaigns (not visited in 60 days, top spenders …), scheduling, per-campaign report (sent/delivered/replied), opt-out honoured [V1]; `marketing` role sees no financials.

#### P4-T4 — `apps/menu` e-menu and booking site · L

- [ ] P4-T4.1 Next.js SSR public site per business: identity, colour, theme, publish; e-menu with per-branch/channel visibility; SEO and share cards.
- [ ] P4-T4.2 Booking with phone OTP (customer = `own` scope only); gift-card purchase and gifting (recipient name, message, barcode, business identity — transcript §9); online ordering with delivery zones [V1]; deposit payment via gateway [V1].
- [ ] P4-T4.3 Customer portal: my orders/invoices, my points, my bookings, cancel/modify within policy, rate once per order.

#### P4-T5 — `loyalty` module · L

- [ ] P4-T5.1 Gift cards (cash/product value, single store or across branches of the business — D-24), discounts/coupons (pct/fixed/code/branch/taxable), redemption in POS as payment methods.
- [ ] P4-T5.2 Points earn/redeem/expire/override per item, ledger, consumed from `OrderCompleted`/`ReturnPosted`/`PaymentCaptured` [V1]; ★ ratings + Google review card [V1]; wallet stamp cards [V2].

#### P4-T6 — `channels` module — delivery integration hub ★ · XL · ⛔ D-22

- [ ] P4-T6.1 ADR: middleware aggregator (recommended first, one integration covers many partners) vs direct partner APIs (Talabat, Deliveroo, Jahez, Keeta …) later for the highest-volume partner.
- [ ] P4-T6.2 Intake: partner order → normal order with `channel_id` + `external_ref` (items, options, notes); accept/reject from the POS/KDS pushed back; status updates (preparing / ready / with driver) synced; menu, prices and availability pushed centrally on change; partner commission booked as an expense via `ChannelFeePort`; enable/disable a partner from settings; outage alert per partner.
- [ ] P4-T6.3 Delivery orders included in unified sales and inventory reports.

#### P4-T7 — Admin screens · L

- [ ] P4-T7.1 Calendar, resources, waitlist, booking policies; notification templates and opt-ins; campaigns; menu builder; loyalty rules; channels and partner status.
- **Phase 4 exit:** the salon takes every booking in the system and reminders go out automatically; a restaurant publishes its e-menu; a delivery-app test order appears on the KDS and its status flows back.

---

### Phase 5 — Reporting, platform, subscriptions, sale-readiness

> **Goal.** The owner sees all businesses in one dashboard, reports arrive on schedule, and the product can be sold to an external customer who self-onboards from a vertical template.

#### P5-T1 — `reporting` module: unified owner dashboard and report set · XL

- [ ] P5-T1.1 Read models / materialized views refreshed by worker jobs; `reporting/queries/sql/*.sql` is the **only** place joining across contexts; every file has an `EXPLAIN` test and an entry in `docs/reporting-queries.md`.
- [ ] P5-T1.2 ★ Unified dashboard: one row per business (sales, expenses, profit, staff present, open alerts); branch comparison side by side; period selector with same-day-last-week comparison; "now" panel (open orders, open shifts, today's appointments, incoming delivery orders, late tickets); alerts panel (low stock, expiry, shift variance > X, manual discounts over limit, abnormal returns, voids after payment, documents expiring, statements awaiting approval, subscription due); approvals inbox; quick actions.
- [ ] P5-T1.3 Report set with filters (date/business/branch) and export on every one: sales (channel/type/method/hour/staff), products, returns, payments, A/R aging; attendance/lateness/hours; commissions and staff performance; inventory (P3); appointments (P4); simplified income statement per business (revenue − COGS − expenses − commissions).
- [ ] P5-T1.4 ★ Scheduled reports (daily/weekly/monthly) delivered by WhatsApp/email (`DocumentReady` → `notifications`).

#### P5-T2 — `packages/documents`: PDF and Excel · L

- [ ] P5-T2.1 Playwright headless PDF with Arabic fonts in the worker image (memory limit set now); ExcelJS; PDF/Excel/CSV export from every list; invoice PDF; commission statement PDF; payslip PDF.

#### P5-T3 — `expenses` module · M

- [ ] P5-T3.1 Categories, expenses (branch, method, due, paid, attachments), ★ recurring expenses auto-created, channel commissions arriving from `channels`; accountant role.

#### P5-T4 — `platform` module and `platform.pospay.systems` · XL

- [ ] P5-T4.1 Separate app/session at `platform.`; separate DB role that bypasses RLS exposed **only** inside this module; platform roles (Super Admin, Support, Billing, Developer, Break-glass with instant alert).
- [ ] P5-T4.2 Overview KPIs: tenants by status, MRR + growth, ARPU, churn, trials ending in 7 days, overdue invoices/failed payments, tenants silent 14 days; growth charts; last 10 events.
- [ ] P5-T4.3 Tenants list + tenant page tabs: summary, users (reset password, unlock), usage (orders/month, storage, WhatsApp messages, API calls — the basis for plan limits), billing, support, audit; suspend, extend trial, migrate, soft-delete with 30-day grace.
- [ ] P5-T4.4 Plans × feature flags matrix, per-tenant overrides with expiry, change preview showing affected tenants; `@RequiresFeature` guard mirrored in the UI.
- [ ] P5-T4.5 Vertical templates editor: modules, default order types, reports, ready role bundles, onboarding checklist.
- [ ] P5-T4.6 System health: uptime per service, BullMQ queues, **stuck outbox**, Sentry 24 h, slowest queries, backup status + last restore test, disk/storage.
- [ ] P5-T4.7 Platform-level integrations status (gateways, WhatsApp, delivery), support tickets, in-app banners, release notes, platform audit (impersonations with duration, failed logins, plan changes, flag changes).
- [ ] P5-T4.8 Impersonation under §8.1 rules.

#### P5-T5 — Subscriptions and billing · L · ⛔ D-04, D-06

- [ ] P5-T5.1 Plans, trial (free month), annual single package or monthly per shop (D-04), invoices, payment collection through the platform's own gateway account, coupons, renewal reminders, expiry behaviour (grace → read-only/export → restrict), usage limits with operational abuse protection but no per-branch/user/order upcharge.

#### P5-T6 — Self-signup and marketing site · M

- [ ] P5-T6.1 Self-registration → choose vertical → template copied → ready in minutes; optional admin review; assisted onboarding path; `pospay.systems` marketing page with published pricing.

#### P5-T7 — Public API, API keys, webhooks · M

- [ ] P5-T7.1 Better Auth `api-key` plugin wired with scopes per company; OpenAPI docs published; outbound webhooks with signing and retries; rate limits.

#### P5-T8 — Accounting export · M

- [ ] P5-T8.1 Daily journal export to Zoho Books / QuickBooks / Odoo formats [V1].

#### P5-T9 — Payroll (simplified) · L · ⛔ D-25

- [ ] P5-T9.1 Payroll run: base + approved commissions + fixed allowances − lateness/absence deductions − loans/advances (scheduled instalments) − insurance if any; approval workflow (generated → HR/accountant review → owner approves → month locked, corrections only by reversing entry); payslip PDF; bank bulk-transfer export; payroll cost reports.

#### P5-T10 — First external pilot and sale-readiness · L

- [ ] P5-T10.1 Sale-readiness checklist: isolation proofs, restore rehearsal, support channel (Arabic WhatsApp), release cadence (every two weeks), status page, pricing page, terms.
- [ ] P5-T10.2 Onboard one pilot customer end to end without developer intervention.
- **Phase 5 exit:** an external customer self-onboards, pays, and operates for a month; the owner's unified dashboard and scheduled reports are in daily use.

---

### Phase 6 — Expansion

> Continuous. Each item is its own spec + ADR when it starts. Ordered by expected demand.

- [ ] P6-T1 **Laundry template** ★: ticket states (received → washing → ironing → ready → delivered), per-piece/per-kilo pricing, QR ticket, "ready" WhatsApp, delivery.
- [ ] P6-T2 **Grocery / retail template** ★: barcode + scale integration, batch/expiry, multi-unit selling, offers, fast search.
- [ ] P6-T3 **Services company template** ★: quotes → invoices, recurring invoices, collections, on-account customers.
- [ ] P6-T4 **Clinics / centres template** [V2].
- [ ] P6-T5 **Gym / education** (memberships, freeze, classes with capacity, trainers, session packages, guardian ↔ student) — from `client-discovery` Q51–Q54, needs its own discovery.
- [ ] P6-T6 **ZATCA** compliance module for Saudi (phase 2 e-invoicing, QR).
- [ ] P6-T7 **Native mobile app** (one app, two modes: staff and admin) — ADR required; PWA remains the V1 answer.
- [ ] P6-T8 **Customer app** with loyalty and wallet cards (Apple/Google Wallet stamp cards, proximity offers within platform limits).
- [ ] P6-T9 **Direct delivery-partner integrations** for the highest-volume partner once middleware cost exceeds its value.
- [ ] P6-T10 **Multi-currency**, additional interface languages (Urdu/Hindi), Gulf region hosting move.
- [ ] P6-T11 **Corporate customers** (sub-users, statements) and **supplier portal**.
- [ ] P6-T12 **Kiosk / self-service and QR per table** [V2]; tables & reservations already in P3.
- [ ] P6-T13 **VIP / dedicated instance** offering for large accounts that require their own database (transcript §4) — a deployment variant, not a fork.

---

## 11. Open decisions — `TODO(spec)`

Every item below blocks the task named in "Blocks". An implementing agent must not guess; it stops and marks `TODO(spec)`.

| ID | Decision | Options / current lean | Blocks | Owner |
|---|---|---|---|---|
| D-01 | **Phase order: attendance + commissions first (this PRD, `06` §7, `05`, `08`) vs POS first (`client-phased-proposal-ar.md` R1, `10` §15).** | Lean: attendance first — lowest risk, client's #1 pain, proves the architecture. Revisit only if a paying pilot customer needs POS first. | P1 start | Waleed + client |
| D-02 | Product name and legal exposure of "Pay" in **PosPay** (implies a payment provider; BYO model chosen to avoid the CBK EPSP licence). The name itself is settled (repo, domain, ADR-0001, `SPEC.md` renamed 2026-09-22); only the legal check remains. | Legal review before the name goes on invoices and the WABA verified name. | P0-T10 invoice header, P4 WABA | Waleed + lawyer/accountant |
| D-03 | Money flow: BYO gateway per business (lean, no licence) vs platform collects and settles to merchants (needs CBK arrangement, financial partner). | Lean: BYO. Platform-collected model only as a future, separately approved module. | P2-T5, P5-T5 | Waleed + client + advisor |
| D-04 | Pricing: ~50 KWD/shop/month everything included, free first month, no setup fee (transcript) vs one annual package (investor proposal) vs < Foodics Basic (27 KWD) per branch (`05`). | Fix after the first two customers. | P5-T5 | Client |
| D-05 | Product name in templates (same as D-02) — does **not** block formatters. | — | P0-T10 invoice template | Waleed |
| D-06 | Plans at launch: how many, names, which feature flags separate them, limits. | Lean: one plan + flags reserved for future tiers. | P0-T5 seed, P5-T5 | Client |
| D-07 | Exact role codes to seed (from `09` §6). | Confirm the 13 tenant roles + 5 platform roles. | P0-T9 | Client |
| D-08 | Cashier PIN: 4 or 6 digits; lockout after N failures; lock duration. | Lean: 4 digits, 5 attempts, 15 min. | P0-T9 | Client |
| D-09 | Device token lifetime and renewal window. | Lean: 30 days, renewed on contact, revocable instantly. | P0-T9 | Waleed |
| D-10 | Canonical **branch timezone** source (schema has it on Business; requirements use branch). | Lean: `branches.timezone` with business default. | P0-T10, P1-T4 | Waleed |
| D-11 | Staging host: existing VPS or new; same server as production is discouraged. | Lean: separate small VPS. | P0-T13 | Waleed |
| D-12 | Attendance details: QR placement, who scans, geofence radius, selfie, fixed vs weekly shifts, grace minutes, deduction %, who approves exceptions. | From meeting 2 §3-ب. | P1-T3, P1-T4 | Client |
| D-13 | Second attendance method: barcode ID card via reader/camera, per branch, alone or as double check (`10` §4.3). Also: does "بصمة" in marketing mean biometric hardware? (No — QR/barcode only unless decided otherwise.) | Lean: support both methods; no biometric. | P1-T3 | Client |
| D-14 | Commission net-sales definition: before/after discount, returns, tax, service fee, participant split rule, period lock date; revenue % on employee vs branch, incl. products or not; tier mode MARGINAL vs WHOLE per employee; return after payout handling. | From meeting 2 §3-ج; worked example: 500 base, 5 % above 500. | P1-T5, P1-T6 | Client |
| D-15 | Service-barcode flow: issue per line at invoice time, customer hands to performer, scan same day vs later, cancel, duplicate prevention, who may reassign. | Transcript §1. | P1-T7, P2-T4 | Client |
| D-16 | OTP delivery channel for employee phone login in Phase 1: WhatsApp Cloud API vs SMS provider. | Lean: WhatsApp (already required later); SMS fallback [V1]. | P1-T8 | Waleed |
| D-17 | Commission payout cycle and approver; whether the same engine applies to restaurant cashiers/delivery later. | — | P1-T6 | Client |
| D-18 | POS device profile (Windows / Android / iPad), thermal printer models, scanner, drawer; tested in week 1 of Phase 2. | — | P2-T1 | Client + Waleed |
| D-19 | Print agent technology (Node vs Go LAN service) vs WebUSB/Bluetooth; ADR. | Lean: small Node agent, browser print fallback. | P2-T10 | Waleed |
| D-20 | Shift close UX: show expected before count or after (`client-discovery` Q25); manager approval required for variance. | Lean: count first, then reveal; approval above `max_variance`. | P2-T6 | Client |
| D-21 | Costing policy (moving average now, FIFO later), count cadence, supplier terms, central purchasing for branches. | — | P3-T1 | Client |
| D-22 | Delivery integration hub: middleware aggregator first vs direct partner APIs; which partners (Talabat, Deliveroo, Jahez, Keeta, V-thru …). | Lean: middleware first (`10` §12.1). | P4-T6 | Client + Waleed |
| D-23 | Booking policy: confirmation vs instant, choose provider, deposit amount, cancellation window (e.g. 4 h), no-show fee. | — | P4-T2 | Client |
| D-24 | Gift-card scope: single store / across branches of one business / across independent businesses (the last is a separate financial scope). | Lean: within one business. | P4-T5 | Client |
| D-25 | Payroll rules: allowances, deductions, loans, insurance, bank format, who reviews/approves, correction policy. | — | P5-T9 | Client |
| D-26 | Data migration from Twlm: products and customers only vs opening balances vs sales history; parallel-run length. | Lean: products + customers + opening stock; 2 weeks parallel. | P2-T12, P3 | Client |
| D-27 | VAT model readiness: inclusive/exclusive, rates by country, invoice fields — Kuwait has none today. | Design `TaxRule` for it now, no UI until needed. | P0-T3, P2-T4 | Waleed |

---

## 12. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| RLS looks right but is bypassable (pooling, owner role, `BYPASSRLS`, `SECURITY DEFINER`, plain UUID FKs) | silent cross-tenant leak — fatal for a SaaS | P0-T5 suite run as the restricted role on every PR; tenant-qualified FKs; API-level proof in P0-T8 |
| Better Auth bootstrap fights RLS | login impossible or privileged shortcuts around isolation | P0-T0 decided before any schema |
| T9 (auth + identity) overruns (7–12 days vs 2–3) | Phase 0 slips | scheduled with buffer week; AI writes code faster than it verifies security — verification is manual |
| Idempotency added late | duplicate orders/payments in Phase 2 | P0-T7 before the first real write |
| Hardware and printers (the classic POS failure) | pilot fails on day one | device profile + printer test in week 1 of Phase 2 (D-18) |
| Offline sync edge cases (two devices offline, price changed) | duplicated or lost orders | server-side conflict rules, idempotency, E2E offline test; stated limitation on shared live stock |
| Scope sprawl across "all verticals" | nothing finishes | only restaurant + salon templates until Phase 6; written scope per phase; new asks go to the next phase |
| Backups configured but never restored | unrecoverable incident | P0-T13 not done until PITR and logical restores are performed |
| Solo developer + One-Man-Show trap (the competitor's failure mode) | unhappy customers, no growth | strict rules make a second developer's onboarding possible; support and release cadence defined in P5-T10 |
| Untested schedule estimates (`05`: 2 weeks for Phase 0; `06`: 4 weeks) | broken client expectations | this PRD's revised durations; correct the client-facing docs (§13) |
| Name "PosPay" implies payments provider | regulatory exposure | D-02 legal review; BYO model |
| Two authorization authorities (Better Auth organizations vs memberships) | inconsistent access | P0-T0.4: memberships own authorization |

---

## 13. Documentation conflicts and gaps found while assembling this PRD

These should be fixed in the source documents; until then this section is the reconciliation.

1. **`06` version mismatch.** `CLAUDE.md` cites `06_Tech_Stack_Architecture_EN.md` **V1.4** and references §5.4 for the three session-less entry points, §5.9 (payments BYO model, capability matrix, KNET-direct without refund), §5.10 (realtime: two consumers per event) and §5.15 (scaling path, CI, Gulf region). The repo and the parent folder contain only **V1.2**: its §5.4 has the basic RLS pattern but not the three entry points, and §5.9, §5.10 and §5.15 do not exist at all. V1.4 must be recovered or those sections rewritten; this PRD reconstructs their intent from `CLAUDE.md`, `CLAUDE.architecture.md` and `module-map.md`.
2. **`06` §1 stale rows.** Files (MinIO/DO Spaces), PDF, payments, messaging, observability and deploy are marked ⏳ "to review", and §1.2 says Caddy, while `CLAUDE.md` V2 already decided R2, Traefik and Dokploy. `06` §2 also omits `packages/domain`, `auth`, `payments`, `storage`, `notifications`, `documents`, `observability` (arch §16 open item 1).
3. **Referenced but missing files:** `docs/domain-model.md`, `docs/security.md`, `docs/runbook.md`, `docs/reporting-queries.md`, `docs/module-map.yaml` (arch §16.3), and the ADR recording the "pragmatic Clean Architecture" decision (arch §16.2).
4. **ADR numbering collision.** `IMPLEMENTATION-PLAN.md` T0 targets `docs/adr/0001-auth-rls-boundary.md`, but `0001` is the domain topology ADR and `0002` is tooling. The auth/RLS ADR becomes **0003** (P0-T0.1).
5. **Product name drift.** `SPEC.md` carried an older working name and repo path; it was renamed to **PosPay** / `E:\PosPay.systems\pospay` on 2026-09-22 (repo and parent `docs/` copies). `13_setup_guid.md` still uses `abu-salem` as the example folder and repo name and should be updated the same way.
6. **Stale rules file.** `07_CLAUDE.md` is V1 (Prisma, `services/`/`repositories/` folders, MinIO, `/healthz`). It contradicts the current `CLAUDE.md` V3 and should be archived or deleted from `docs/`.
7. **Node version.** ADR-0002 pins Node 24; `IMPLEMENTATION-PLAN.md` T13 says `node:22-alpine`. Use 24.
8. **Schedule contradictions.** `05` says Phase 0 = 2 weeks and total ≈ 5–6 months; `06` §7 implies ≈ 4 weeks for Phase 0; the reviewed plan says 6–8 weeks for Phase 0 alone. This PRD estimates ≈ 9–11 months to the end of Phase 5. The client-facing `05` must be updated deliberately, not silently.
9. **Phase order conflict** between the engineering docs (attendance first) and the investor proposal `client-phased-proposal-ar.md` (R1 = platform + POS, attendance in R3). Recorded as D-01.
10. **Permissions schema.** `SPEC.md` §4 models `Membership.permission_overrides jsonb`; `09` §11 proposes `roles`, `permissions`, `role_permissions` (with `constraints`), `permission_overrides` (with reason/expiry) and `approval_requests`. This PRD adopts `09` §11 (P0-T9.3, P2-T7); `SPEC.md` should be amended.
11. **Attendance methods.** `10` §4.3 adds the barcode ID-card method; `06` §5.1 designs only the rotating QR. Recorded as D-13 and P1-T3.5.
12. **Duplicate heading** in `IMPLEMENTATION-PLAN.md` (two "## 4." sections).
13. **Branch timezone** is on `Business` in the schema while every requirement uses branch timezone (review finding #15). Recorded as D-10.
14. **`CLAUDE.md` §5** "all DB access goes through `withTenant()`" needs the named auth-path exception from T0 (P0-T0.3).
15. **`docs/` duplicates.** Eight files are byte-identical between `E:\PosPay.systems\docs` and `pospay/docs` (or `pospay/`): keep the repo copies canonical and treat the parent folder as an archive, or symlink, to avoid drift.
16. **Investor proposal vs client blueprint** describe the same product for two different commercial framings (a 10,000 KWD R1 for an investor selling subscriptions; a phased build for Abu Salem's own businesses). The engineering roadmap in this PRD serves both; the commercial mapping (R1 ≈ P0 + P2 subset + P5 platform basics; R2 ≈ P3 + P4; R3 ≈ P1 + P5 payroll + P6 templates; R4 ≈ P5 finance/integrations) must be agreed before any price is quoted.

---

## 14. Source documents

| # | File | Role in this PRD |
|---|---|---|
| 1 | `pospay/CLAUDE.md` (= `docs/CLAUDE.md`) V3 | workflow and rules (governing) |
| 2 | `pospay/CLAUDE.architecture.md` A1.0 | code shape and dependency rules (governing) |
| 3 | `docs/06_Tech_Stack_Architecture_EN.md` V1.2 (= `pospay/docs/…`) | stack, engines, domain model, delivery order (governing; V1.4 missing) |
| 4 | `docs/module-map.md` M1.0 | allowed import/port/event arrows |
| 5 | `docs/specs/phase-0/SPEC.md` | Phase 0 scope and success criterion |
| 6 | `docs/specs/phase-0/IMPLEMENTATION-PLAN.md` v2 | Phase 0 tasks T0–T13 |
| 7 | `docs/specs/phase-0/CODEX-REVIEW.md` + `.review-prompt.txt` + `.review-full.txt` | adversarial review of v1 and the prompt that produced it |
| 8 | `pospay/docs/adr/0001-domain-and-subdomain-topology.md` | domain decisions |
| 9 | `pospay/docs/adr/0002-workspace-tooling-baseline.md` | pinned tooling |
| 10 | `docs/01_Domain_Setup_pospay_systems_AR.md` + `env.domain.example` | DNS, TLS, cookies, webhooks, env |
| 11 | `docs/02_Market_Competitive_Analysis_AR.md` | Twlm/Foodics analysis, strategy |
| 12 | `docs/03_Meeting2_Agenda_And_Questions_AR.md` | discovery questions feeding §11 |
| 13 | `docs/04_Features_Spec_AR.md` | feature list with [M]/[V1]/[V2] priorities |
| 14 | `docs/05_App_Blueprint_Build_Plan_AR.md` | client-facing phases and acceptance |
| 15 | `docs/07_CLAUDE.md` | stale V1 rules (archived) |
| 16 | `docs/08_ChatGPT_Brief_Review_AR.md` | rationale for Better Auth, offline-first, attendance-first |
| 17 | `docs/09_Dashboards_Roles_Permissions_AR.md` | dashboards, roles, permissions, constraints (normative) |
| 18 | `docs/10_Developer_Proposal_AR.md` | mobile app, HR/payroll, barcode attendance, delivery hub, WhatsApp marketing |
| 19 | `docs/13_setup_guid.md` | environment setup, slice cycle |
| 20 | `docs/abu-salem-project-combined-transcript.md` | client's own words: service barcodes, commission example, pricing, VAT, gift cards |
| 21 | `docs/client-discovery-60-questions-ar.md` | 60-question discovery (unanswered) |
| 22 | `docs/client-phased-proposal-ar.md` | investor proposal R1–R4, 14 stages, 10,000 KWD |
| 23 | `docs/provider-effort-and-pricing-notes-ar.md` | internal effort/price notes and pre-quote checks |
| 24 | logo images (`docs/generated-logos/*`, contact sheet) | branding candidates, not requirements |

---

## 15. Glossary (AR / EN)

| AR | EN / code name | Meaning |
|---|---|---|
| الشركة | `Company` | tenant root, one owner, one subscription |
| النشاط | `Business` | one vertical (restaurant, salon …) under a company |
| الفرع | `Branch` | physical location with devices, staff, stock location |
| الوردية (كاشير) | `CashShift` | drawer open → close → reconcile; **not** attendance |
| الحضور والانصراف | `AttendanceSession` | clock in/out, QR or barcode, feeds lateness and payroll |
| العمولة | `Commission` | computed by `computeCommission`; entry → statement |
| كشف العمولات | `CommissionStatement` | monthly, draft → approved → paid |
| الشرائح | `TIERED` | commission above a target, `MARGINAL` (excess only) or `WHOLE` |
| الصنف | `Item` | product **or** timed service |
| باركود الخدمة | `service_barcode` | one per service line; assigns the performer after the fact |
| الدرج / العهدة | drawer / custody | cash responsibility per cashier |
| صندوق الاعتمادات | approvals inbox | above-limit actions converted to requests |
| الحدود الرقمية | constraints | `max_pct`, `max_amount`, `max_variance` … on a permission |
| القالب | vertical template | modules/flags/roles copied into a new business |
| المنصة | `platform` | super-admin scope, `platform.pospay.systems` |
| الأوت بوكس | outbox | event row written in the same transaction, dispatched by the worker |
| فلس / ميلّي | mills | 1 KWD = 1000, `bigint` |
| BYO gateway | bring-your-own gateway | each business connects its own MyFatoorah/Tap account; PosPay never holds funds |
