# docs/module-map.md — the declared dependency graph

> **This file is executable documentation.** A script compares the real import graph of
> `apps/api` and `apps/worker` against the tables below and **fails CI on any arrow that is
> not declared here** (`CLAUDE.md` §10, `CLAUDE.architecture.md` §10.3).
>
> Adding an arrow means editing this file, which means writing an ADR. That friction is the point.
>
> **Version:** M1.0 — 2026-09-15. Derived from `06_Tech_Stack_Architecture_EN.md` §3.

---

## 1. There are three kinds of arrow — they are not interchangeable

| Kind | What it looks like in code | When to use it | Cost |
|---|---|---|---|
| **Import** | `import { X } from '../tenancy'` — the module's `index.ts` only | Shared *types* and NestJS module wiring. Almost always `import type`. | Creates a hard compile-time edge. Keep these to a minimum. |
| **Port** | Consumer defines `ports/<x>.port.ts`; an adapter implements it | "I need an answer **now**" — a price, a credit limit, a membership | No compile-time edge between the two modules. The adapter is the only file that sees both. |
| **Event** | Producer appends to `outbox`; consumer has `events/handlers/on-*.ts` | "This **happened**, react to it" — the default for anything that changes state | Zero coupling. The producer does not know the consumer exists. |

**Rule of thumb:** if you are about to add an Import arrow, check whether it is really a Port (a read) or an Event (a write). Nine times out of ten it is.

---

## 2. Import arrows (compile-time edges) — the complete allowed list

Anything not in this table is a CI failure. Every arrow points **down** this list — `tenancy` is the root and imports nothing.

| Module | May import | Why |
|---|---|---|
| `tenancy` | — | Root. Company / business / branch / plans. |
| `identity` | `tenancy` | A membership is scoped to a company/business/branch. |
| `settings` | `tenancy` | Per-business config. |
| `files` | `tenancy` | Storage keys are `{companyId}/{businessId}/…`. |
| `platform` | `tenancy` | Super-admin over tenants. |
| `catalog` | `tenancy` | |
| `customers` | `tenancy` | |
| `expenses` | `tenancy` | |
| `inventory` | `tenancy` | |
| `staff` | `tenancy`, `identity` | An employee may be linked to a user. |
| `realtime` | `identity` | Channel scope is resolved from the session. |
| `notifications` | — | Deliberately root-level: it is a service, it knows nothing about the business. |
| `orders` | `tenancy` | Catalog and customer data arrive by **port**, not import (§3). |
| `payments` | `tenancy` | Order totals arrive by **port**. |
| `cash` | `identity` | Payment tenders arrive by **port**. |
| `appointments` | `tenancy` | Catalog / staff / customers arrive by **port**. |
| `commissions` | `staff` | Order data arrives by **event** only. |
| `loyalty` | `customers` | Order data arrives by **event** only. |
| `channels` | `tenancy` | Order and expense effects are **events**. |
| `kitchen` | — | Fed entirely by events from `orders`. |
| `reporting` | — | **Imports nothing.** Read-only SQL across contexts (§5). |

**Every module may import:** `packages/domain`, `packages/contracts`, `packages/db` (from `persistence/` and `queries/` only), `packages/observability`.
**Only the owning module may import:** `packages/auth` (→ `identity`), `packages/payments` (→ `payments`), `packages/storage` (→ `files`), `packages/notifications` (→ `notifications`), `packages/documents` (→ `reporting`, `worker` jobs).

---

## 3. Port arrows (runtime reads, no compile-time edge)

The consumer owns the interface. The adapter lives in the consumer's `persistence/` folder and is the **only** file that knows both modules exist. This is what keeps the graph acyclic (`CLAUDE.architecture.md` §6.2).

| Consumer | Port it defines | Reads from | What it needs |
|---|---|---|---|
| `orders` | `CatalogReaderPort` | `catalog` | price for item × branch × channel, item name snapshot, tax rule id |
| `orders` | `CustomerCreditPort` | `customers` | credit limit, current balance, block status |
| `payments` | `OrderTotalsPort` | `orders` | order total + currency to charge |
| `cash` | `ShiftPaymentsPort` | `payments` | tenders belonging to a shift, incl. `PENDING_GATEWAY` ones |
| `appointments` | `ServiceCatalogPort` | `catalog` | service duration, resource type, requires-staff flag |
| `appointments` | `StaffAvailabilityPort` | `staff` | schedule + leave for a resource |
| `commissions` | `EmployeePlanPort` | `staff` | the employee's active commission plan |
| `channels` | `ChannelFeePort` | `expenses` | how an aggregator commission is booked |
| `realtime` | `ChannelScopePort` | `identity` | which channels this session may subscribe to |

> `payments → orders` and `orders → catalog` exist as ports in **both directions of the list** without creating a cycle, because neither module imports the other — the adapters do. If a new port would create a cycle **between adapters**, use an event instead.

---

## 4. Event arrows (the default for state changes)

The producer appends to the outbox inside its own transaction and knows **none** of its consumers. Adding a consumer changes zero lines in the producer.

| Event | Produced by | Consumed by |
|---|---|---|
| `OrderCreated` | `orders` | `kitchen`, `realtime`, `channels` |
| `OrderCompleted` | `orders` | `inventory` (deduct), `commissions` (entries), `loyalty` (points), `realtime` |
| `OrderCancelled` | `orders` | `inventory`, `commissions` (reverse), `kitchen`, `realtime` |
| `ServiceCompleted` | `orders` | `commissions`, `appointments` |
| `ReturnPosted` | `orders` | `inventory`, `commissions` (negative entries), `loyalty` |
| `PaymentCaptured` | `payments` | `orders` (status), `cash` (tender), `loyalty`, `realtime` |
| `PaymentRefunded` | `payments` | `orders`, `cash`, `commissions` |
| `PaymentFailed` | `payments` | `orders`, `realtime`, `notifications` |
| `CashShiftClosed` | `cash` | `reporting`, `notifications` (manager summary) |
| `AttendanceClocked` | `staff` | `commissions` (lateness deduction), `realtime` |
| `AppointmentBooked` | `appointments` | `notifications` (reminder schedule), `realtime` |
| `AppointmentCompleted` | `appointments` | `orders`, `commissions` |
| `StockPosted` | `inventory` | `reporting`, `notifications` (low-stock alert), `realtime` |
| `DeviceRegistered` / `DeviceRevoked` | `identity` | `realtime`, `notifications` |
| `GatewayAccountConnected` | `payments` | `notifications`, `platform` |
| `NotificationDelivered` / `NotificationFailed` | `notifications` | `reporting` |
| `DocumentReady` | `reporting` | `notifications`, `realtime` |

**Two consumers by default.** Every event has its business handler **and** the `realtime` publisher (`06` §5.10). That is what guarantees a screen never shows something that didn't actually commit.

**Consumers are idempotent**, deduped by `event_id`. Redelivery is harmless, and replay is a supported recovery tool.

---

## 5. The `reporting` exception

`modules/reporting/queries/sql/*.sql` is the **only** place allowed to join across bounded contexts (orders × staff × inventory in one statement).

This is a deliberate trade, fenced into one folder so the cost stays visible (`CLAUDE.architecture.md` §7.3):

- It is what makes the owner dashboard fast.
- It is also the thing that would have to be rebuilt as a separate read database if the monolith is ever split.

Rules for that folder: read-only, never writes, imports no module, and every file has an `EXPLAIN ANALYZE` test plus its indexes documented in `docs/reporting-queries.md`.

---

## 6. Machine-readable source (what the CI script reads)

```yaml
# docs/module-map.yaml — keep in sync with the tables above; the script reads THIS.
imports:
  tenancy:      []
  notifications: []
  kitchen:      []
  reporting:    []
  identity:     [tenancy]
  settings:     [tenancy]
  files:        [tenancy]
  platform:     [tenancy]
  catalog:      [tenancy]
  customers:    [tenancy]
  expenses:     [tenancy]
  inventory:    [tenancy]
  orders:       [tenancy]
  payments:     [tenancy]
  appointments: [tenancy]
  channels:     [tenancy]
  staff:        [tenancy, identity]
  realtime:     [identity]
  cash:         [identity]
  commissions:  [staff]
  loyalty:      [customers]

packages_restricted:
  auth:          [identity]
  payments:      [payments]
  storage:       [files]
  notifications: [notifications]
  documents:     [reporting]
```

The check: for every `import` between `modules/*`, assert the target is the module's `index.ts` **and** the edge appears in `imports`. Then assert the whole graph is acyclic.

---

## 7. How to change this file

1. Try a **port** first. Try an **event** second. An import arrow is the last resort.
2. If it must be an import, write `docs/adr/NNNN-<title>.md`: what needed the arrow, why a port or event could not serve, and what future extraction of these modules now costs.
3. Update the table **and** the YAML in the same PR.
4. Re-run `pnpm lint:cycles` — an added arrow is the most common way a cycle appears.
