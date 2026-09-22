# CLAUDE.architecture.md — Code Architecture Rules

> **Companion to** `06_Tech_Stack_Architecture_EN.md` (which technology) and `CLAUDE.md` (day-to-day AI rules).
> This file answers a different question: **where does a line of code go, and what is it allowed to import?**
>
> `06` = *what we build with*. This file = *how the code is shaped*.
> **On conflict, this file wins for structure and dependency direction.**
>
> **Version:** A1.0 — 2026-09-15
> **Applies to:** `apps/api`, `apps/worker`, `apps/pos`, `apps/admin`, `apps/menu`, `packages/*`

---

## 0. شرح بالعربي — الفكرة كلها في صفحة

الملف ده بيحل مشكلة واحدة: **إن الـ AI (وإنت كمان بعد شهرين) يلاقي الكود في مكانه المتوقع، ومايقدرش يخبط الحاجات في بعضها.**

الفكرة قايمة على 5 قواعد، وكل حاجة تحتها تفاصيل تنفيذ:

**1. الفولدرات بتصرّخ بالبيزنس، مش بالتقنية (Screaming Architecture).**
أول ما تفتح `apps/api/src/modules` تلاقي: `orders`, `inventory`, `staff`, `commissions`, `appointments`, `payments`, `cash`. مش `controllers`, `services`, `models`. المشروع بيقولك "أنا نظام إدارة محلات"، مش "أنا مشروع NestJS".

**2. قلب البيزنس نضيف (Entities / Enterprise Rules).**
حساب العمولة، حساب الإجمالي والضريبة والخصم، تكلفة المخزون، دقايق التأخير — دي **دوال صافية (pure functions)** في فولدر `domain/`، **ما بتعرفش حاجة عن الداتابيز ولا الـ API ولا NestJS**. لو قفلت الكمبيوتر وحسبت بالورقة والقلم، نفس المعادلة. دي `numeric` وinput وoutput وخلاص. وعشان كده بتتختبر في ميلي ثانية من غير داتابيز.

**3. كل use case له فولدر (Application Rules + Common Closure Principle).**
`open-cash-shift/`, `create-order/`, `clock-in-employee/`. جوه الفولدر: الـ handler + الـ input + الـ test. الحاجات اللي بتتغير مع بعض قاعدة مع بعض. لما البيزنس يقولك "عايز أعدل حاجة في فتح الدرج"، إنت بتفتح **فولدر واحد**، مش بتلف على 4 فولدرات.

**4. الحدود مرسومة بـ interfaces (Boundaries + Dependency Inversion).**
الـ use case بيقول "أنا محتاج حاجة تحفظ لي الأوردر" — بيعرّف `interface` جوه الموديول بتاعه. والداتابيز هي اللي بتنفذ الـ interface ده. **السهم مقلوب**: الداتابيز بتعتمد على البيزنس، مش العكس. وده اللي بيخلي لو غيّرت Drizzle أو غيّرت MyFatoorah بـ Tap — تعديل ملف واحد، مش إعادة كتابة.

**5. ممنوع الاعتمادية الدائرية (Acyclic Dependencies Principle).**
`orders` عمره ما يعمل `import` لـ `inventory`. لو محتاج منه حاجة: يا إما **domain event** (`OrderCompleted` → `inventory` بيسمعه)، يا إما **port** (`orders` يعرّف interface و`inventory` ينفّذه). والـ CI بيرفض أي PR فيه دايرة.

**وحاجة مهمة جداً وناس كتير بتقع فيها:** الكلام ده كله عن **الكتابة** (create order, post stock). أما **القراءة** (تقارير، شاشات القوايم، الداشبورد) — دي ليها مسار سريع منفصل بـ SQL مباشر من غير أي layers. لأن التقرير مالوش قواعد بيزنس يحميها، وتمرير 50 ألف صف على entities ده أسرع طريقة تبوّظ بيها الأداء باسم "المعمارية النضيفة". التفاصيل في §7.

---

## 1. The three architectural levels — don't mix them up

Most architecture arguments are people discussing different levels. This project has three, and each has its own rules:

| Level | Question it answers | Decided in | Changes |
|---|---|---|---|
| **Macro** — modules | What are the bounded contexts, who owns what data, how do they talk? | `06` §3 (module map) | Rarely. An ADR is required. |
| **Module** — layers | Inside one module, what are the layers and which way do dependencies point? | **This file, §4–§6** | Never. Same shape in every module. |
| **Slice** — use cases | Inside one module, how is one feature organised? | **This file, §5** | Per feature, freely. |

> The macro boundary is what protects the system. The internals of a module are a local decision — but we standardise them anyway, because a **solo developer working with AI** needs one predictable shape, not per-module creativity.

---

## 2. Screaming Architecture — the root folders

**The rule:** a root folder is named after **a thing the business pays for**, never after a technical role.

```
apps/api/src/modules/
  tenancy/  identity/  catalog/  customers/  staff/  commissions/
  appointments/  orders/  payments/  cash/  inventory/  kitchen/
  loyalty/  channels/  expenses/  reporting/  notifications/
  files/  realtime/  settings/  platform/
```

Someone who has never seen the repo should read that list and say *"this is a shop-management system"* — not *"this is a NestJS app"*.

### 2.1 Banned folder names (anywhere in the repo)

These names are banned because they have no definition, so everything ends up in them:

`utils/` · `helpers/` · `common/` · `shared/` (except the one allowed per-app `shared/`, §6.4) · `misc/` · `core/` (except the single app bootstrap module) · `services/` as a **root** folder · `models/` as a **root** folder · `managers/` · `lib/` (except `packages/*`)

If you are about to create one, you have not yet found what the code actually *is*. Name it after the capability: `money/`, `arabic-text/`, `phone-numbers/`, `qr-tokens/`.

### 2.2 The framework is a detail, and it looks like one

NestJS, Drizzle, Fastify, BullMQ, React — none of these appear in a folder name at the business level. They appear only in the adapter folders (`persistence/`, `http/`, `jobs/`) where they belong.

---

## 3. The Dependency Rule (the one rule that matters)

> **Source code dependencies point inward, toward business rules. Nothing inward knows anything about anything outward.**

```
        ┌──────────────────────────────────────────────┐
        │  infrastructure                              │   Drizzle, Fastify, BullMQ,
        │  ┌────────────────────────────────────────┐  │   R2, Meta API, Playwright
        │  │  adapters                              │  │
        │  │  http/  persistence/  events/  jobs/   │  │
        │  │  ┌──────────────────────────────────┐  │  │
        │  │  │  use-cases/   (+ ports/)         │  │  │   Application Business Rules
        │  │  │  ┌────────────────────────────┐  │  │  │
        │  │  │  │  domain/                   │  │  │  │   Enterprise Business Rules
        │  │  │  │  pure functions, no deps   │  │  │  │
        │  │  │  └────────────────────────────┘  │  │  │
        │  │  └──────────────────────────────────┘  │  │
        │  └────────────────────────────────────────┘  │
        └──────────────────────────────────────────────┘
                     dependencies point  ───────►  inward only
```

### 3.1 The import matrix — enforced by ESLint, not by memory

| A file in… | may import from… | may **never** import |
|---|---|---|
| `domain/` | `packages/domain` only | anything else — no NestJS, no Drizzle, no Zod runtime, no other module, not even `ports/` |
| `use-cases/` | own `domain/`, own `ports/`, `packages/domain`, `packages/contracts` (types) | Drizzle, SQL, `@nestjs/common` decorators beyond `@Injectable`, HTTP objects, another module's internals |
| `queries/` (read side) | `packages/db` (read-only), `packages/contracts` | `domain/`, `use-cases/`, any write path |
| `ports/` | own `domain/`, `packages/domain` | everything else — a port is an interface + types, nothing more |
| `persistence/` | own `ports/`, own `domain/`, `packages/db` | `http/`, `use-cases/`, another module |
| `http/` | own `use-cases/`, own `queries/`, `packages/contracts` | `persistence/`, `domain/` directly, another module's internals |
| `events/handlers/` | own `use-cases/`, `packages/contracts` | another module's internals |
| `jobs/` (worker) | own `use-cases/`, `packages/contracts` | `http/` |
| any module | **another module's `index.ts` only**, and only if `06` §3 allows that arrow | a deep path like `../orders/persistence/...` |

**A violation of this table is a CI failure, not a code-review comment.** See §10.

---

## 4. Enterprise vs Application business rules — where does this logic go?

This is the single most common thing AI gets wrong, so the test is mechanical.

### 4.1 `domain/` — Enterprise Business Rules (Entities)

**The test:** *if we switched off every computer and did this with pen and paper, would the rule still be the same?*

If yes → `domain/`. Pure functions and pure value objects. **Zero imports outside `packages/domain`.**

Examples in this system:

| Rule | Why it's enterprise-level |
|---|---|
| `computeCommission(entry, rules, context)` | A tiered 0%/10%-above-3000 commission is the same on paper |
| `computeOrderTotals(lines, discounts, taxRule, serviceFee)` | Arithmetic; KWD rounds to 3 decimals half-up at line level |
| `movingAverageCost(previousBalance, previousCost, incomingQty, incomingCost)` | Accounting, not software |
| `lateMinutes(scheduledStart, actualClockIn, graceMinutes)` | A manager with a clock computes the same number |
| `canTransition(orderStatus, event)` | The order lifecycle is a business fact |
| `isSlotAvailable(resourceSchedule, requestedRange, buffers)` | Booking logic on paper |
| `splitCommissionAmongStaff(lineAmount, staffShares)` | Division rules the salon agreed |

**Rules for `domain/`:**
- Every function is **pure**: same input → same output, no I/O, no `Date.now()`, no randomness. Time and IDs are **passed in as arguments**.
- Money is `bigint` mills (1 KWD = 1000) or the `Money` type from `packages/domain`. **Never `number`.**
- Errors are returned as typed results or thrown as domain errors defined in `domain/errors.ts` — never HTTP exceptions.
- **Test coverage here is non-negotiable and exhaustive.** These tests run in milliseconds with no database. If the commission engine has 9 rule combinations, there are ≥9 tests.

### 4.2 `use-cases/` — Application Business Rules (Interactors)

**The test:** *is this the sequence of steps the system performs?*

A use case orchestrates: load → check permission/invariants → call domain functions → persist → emit event. It **does not contain arithmetic** (that's `domain/`) and it **does not know SQL** (that's `persistence/`).

```ts
// modules/cash/use-cases/close-cash-shift/close-cash-shift.usecase.ts
// Application Business Rule: the STEPS. No SQL, no HTTP, no arithmetic.

export class CloseCashShiftUseCase {
  constructor(
    private readonly shifts: CashShiftRepository,      // port (interface), not Drizzle
    private readonly payments: ShiftPaymentsReader,     // port
    private readonly outbox: OutboxWriter,              // port
    private readonly clock: Clock,                      // port — no Date.now() in here
  ) {}

  async execute(input: CloseCashShiftInput): Promise<CloseCashShiftResult> {
    const shift = await this.shifts.findOpenById(input.shiftId);
    if (!shift) throw new ShiftNotOpenError(input.shiftId);

    const tenders = await this.payments.tendersForShift(shift.id);

    // unresolved gateway payments block the close (06 §5.9.4) — a business step
    const unresolved = tenders.filter(t => t.status === 'PENDING_GATEWAY');
    if (unresolved.length > 0 && !input.managerOverride) {
      throw new UnresolvedGatewayPaymentsError(unresolved.map(t => t.id));
    }

    // arithmetic lives in domain/, not here
    const reconciliation = reconcileDrawer({
      openingFloat: shift.openingFloat,
      tenders,
      countedCash: input.countedCash,
    });

    await this.shifts.close(shift.id, reconciliation, this.clock.now());
    await this.outbox.append('CashShiftClosed', { shiftId: shift.id, variance: reconciliation.variance });

    return { shiftId: shift.id, ...reconciliation };
  }
}
```

**Rules for `use-cases/`:**
- **One folder per use case**, named `<verb>-<noun>` in business language: `open-cash-shift/`, `post-stock-adjustment/`, `clock-in-employee/`, `approve-commission-statement/`, `connect-gateway-account/`.
- Never `OrderService` with 14 methods. That class has 14 reasons to change → Single Responsibility violation by construction, and it is the file AI will happily grow to 900 lines.
- Every dependency arrives through the constructor as a **port**, never a concrete class. This is the Dependency Inversion boundary (§6).
- `Clock` and `IdGenerator` are ports too. A use case that calls `Date.now()` or `crypto.randomUUID()` directly cannot be tested deterministically.
- All writes to money/stock: wrapped in one transaction, carry `Idempotency-Key`, write the outbox event **in the same transaction** (`06` §5.5).

---

## 5. The module — the standard shape

Every backend module has **exactly** this shape. No exceptions, no creativity.

```
apps/api/src/modules/orders/
├── domain/                               ← Enterprise rules. Pure. Zero deps.
│   ├── order-totals.ts
│   ├── order-status.ts                   (state machine)
│   ├── return-policy.ts
│   ├── errors.ts
│   └── __tests__/                        (pure unit tests, no DB)
│
├── use-cases/                            ← WRITE side. One folder = one use case.
│   ├── create-order/
│   │   ├── create-order.usecase.ts
│   │   ├── create-order.input.ts         (re-export of the Zod contract type)
│   │   └── create-order.usecase.spec.ts
│   ├── add-order-item/
│   ├── apply-discount/
│   ├── complete-order/
│   ├── void-order/
│   └── post-return/
│
├── queries/                              ← READ side. Fast path. §7.
│   ├── list-orders.query.ts
│   ├── order-detail.query.ts
│   └── sql/
│       └── list-orders.sql
│
├── ports/                                ← Interfaces THIS module needs. Owned here.
│   ├── order.repository.ts
│   ├── catalog-reader.port.ts            ← how orders reads catalog WITHOUT importing it
│   ├── customer-credit.port.ts
│   └── outbox-writer.port.ts
│
├── persistence/                          ← Implements ports/ with Drizzle. Knows SQL.
│   ├── drizzle-order.repository.ts
│   └── mappers/
│       └── order.mapper.ts               (DB row ⇄ domain shape)
│
├── http/                                 ← Thin. Validate, call, map to HTTP.
│   └── orders.controller.ts
│
├── events/
│   ├── published.ts                      (OrderCreated, OrderCompleted, … payload types)
│   └── handlers/                         (handlers for events from OTHER modules)
│       └── on-payment-captured.handler.ts
│
├── orders.module.ts                      ← NestJS wiring = the composition root
└── index.ts                              ← THE ONLY public surface of this module
```

The worker mirrors it:

```
apps/worker/src/modules/reporting/
├── jobs/
│   └── generate-sales-report.processor.ts   ← calls a use case; contains no business rules
└── reporting.module.ts
```

### 5.1 `index.ts` — the module's public API

```ts
// modules/orders/index.ts — the ONLY file another module may import from
export { OrdersModule } from './orders.module';
export type { OrderSummary, OrderStatus } from './domain/order-status';
export type { OrderCreated, OrderCompleted } from './events/published';
export type { CatalogReaderPort } from './ports/catalog-reader.port';
// Note: no repositories, no use case classes, no Drizzle types. Ever.
```

Everything else in the module is private. `import { DrizzleOrderRepository } from '../orders/persistence/…'` is a **build failure**.

### 5.2 `<module>.module.ts` — the composition root

This is the **only** place in the module where an interface is bound to a concrete class. It is also the only place allowed to know that Drizzle exists *and* that use cases exist at the same time.

```ts
@Module({
  providers: [
    CreateOrderUseCase,
    { provide: ORDER_REPOSITORY, useClass: DrizzleOrderRepository },
    { provide: CATALOG_READER,   useClass: CatalogReaderAdapter },
    { provide: CLOCK,            useClass: SystemClock },
  ],
  controllers: [OrdersController],
  exports: [],
})
export class OrdersModule {}
```

---

## 6. Boundaries — the five places where an interface is mandatory

Interfaces cost indirection. We do **not** put one on everything. We put one exactly where a change would otherwise be expensive, and nowhere else.

### 6.1 Mandatory boundaries (an interface is required, no discussion)

| Boundary | Port lives in | Why |
|---|---|---|
| **Payment gateway** | `packages/payments` → `PaymentGateway` | 3 adapters already exist (MyFatoorah / Tap / KNET Direct). A 4th must be one file (`06` §5.9.2) |
| **Object storage** | `packages/storage` → `ObjectStorage` | R2 today, S3/Garage/DO tomorrow |
| **Notification channels** | `packages/notifications` → `Channel` | WhatsApp / SMS / Email / Push, and a BSP fallback later |
| **Auth & secrets** | `packages/auth` | The only code allowed to hash a PIN, sign a session, or decrypt credentials |
| **Persistence (per aggregate)** | `modules/<x>/ports/*.repository.ts` | Keeps the use case ignorant of Drizzle, and makes use-case tests run with no database |

Plus two small ones that pay for themselves immediately: `Clock` and `IdGenerator`.

### 6.2 Cross-module boundary — how `orders` reads `catalog` without a cycle

The exact problem in the Clean Architecture book's cart↔user example. The answer is **Dependency Inversion**:

```ts
// modules/orders/ports/catalog-reader.port.ts
// orders DEFINES what it needs. It does not import catalog.
export interface CatalogReaderPort {
  priceFor(itemId: string, branchId: string, channel: Channel): Promise<Money>;
  itemSnapshot(itemId: string): Promise<{ nameAr: string; nameEn: string; taxRuleId: string }>;
}
```

```ts
// modules/orders/persistence/catalog-reader.adapter.ts  (an ADAPTER, in the outer ring)
// This is the ONLY file that knows both orders and catalog exist.
@Injectable()
export class CatalogReaderAdapter implements CatalogReaderPort { /* … */ }
```

Now the arrow is `catalog-adapter → orders/ports`, not `orders → catalog`. **No cycle.** If `catalog` ever needs something from `orders`, it defines its own port and the same trick works in reverse — and the graph is still acyclic.

### 6.3 The default: domain events, not calls

Before reaching for a port, ask whether the interaction is really "I need an answer now" or actually "something happened, react to it". Most are the second:

```
orders  ──emits──►  OrderCompleted  ──consumed by──►  inventory  (deduct stock)
                                    ──consumed by──►  commissions (create entries)
                                    ──consumed by──►  loyalty     (award points)
                                    ──consumed by──►  realtime    (push to KDS)
```

`orders` knows **none** of these four exist. Adding a fifth consumer changes zero lines in `orders`. That is the Open/Closed Principle at module scale, and it is why the event list in `06` §3 is a design artifact, not a technical detail.

**Ports are for reads ("tell me the price"). Events are for writes ("this happened, do your part").**

### 6.4 The `shared/` exception

Each **app** gets exactly one `shared/`, and it holds only things with **no business meaning**: RTL helpers, a `cn()` classname merge, query-client setup, a date formatter that delegates to `packages/i18n`.

The moment something in `shared/` knows what an Order is, it is in the wrong folder. This is the **Common Reuse Principle**: code that is not reused together must not be packaged together.

---

## 7. Performance — where Clean Architecture must bend, and exactly how far

Clean Architecture protects **invariants**. A report has no invariants. Forcing reads through entities, repositories and mappers is the single most common way a "clean" system becomes slow, and it buys nothing.

### 7.1 Two paths, on purpose (CQRS-lite)

| | Write path (commands) | Read path (queries) |
|---|---|---|
| Lives in | `use-cases/` | `queries/` |
| Goes through | domain → ports → repository → aggregate | controller → query → SQL → DTO |
| Loads | whole aggregates | exactly the columns the screen shows |
| Uses | Drizzle query builder inside `persistence/` | Drizzle `sql` tag / `packages/db/sql/reports/*.sql` |
| May touch | one aggregate per transaction | **may join across contexts** (see §7.3) |
| Protects | money, stock, status transitions | nothing — it cannot mutate |
| Tested by | unit (domain) + integration (use case) | a result-shape test + an `EXPLAIN ANALYZE` assertion |

**Hard rule: a file in `queries/` may not import `domain/` or `use-cases/`, and may not write.** That is what keeps the fast path from quietly becoming a second, competing business-logic layer.

### 7.2 Performance rules that are architectural, not micro-optimisation

These are structure decisions, which is why they are here and not in `06` §5.7:

1. **One screen = one query.** If a list endpoint issues a query inside a loop, that is an architecture bug (the repository was made per-row instead of per-screen), not a tuning issue.
2. **No repository on the read path.** Repositories exist to rebuild aggregates for writing. A dashboard does not need an aggregate.
3. **No mapper for > 200 rows.** Above that, the SQL projects directly into the DTO shape. The mapper exists for the write path.
4. **Every abstraction on a POS hot path must be justified in writing.** Create order, add payment, clock in/out, PIN verify: each extra layer is measured, not assumed. Target ≤ 3 hops from controller to SQL.
5. **> 200 ms → a job, not a faster query.** The boundary between `api` and `worker` is an architectural boundary (`06` §1.2). Anything crossing it goes through BullMQ, never a synchronous wait.
6. **Cache invalidation is owned by the module that owns the data.** `catalog` invalidates menu cache keys; no other module may delete a `catalog:*` key. Otherwise cache bugs have no owner.
7. **`packages/domain` must stay dependency-free** so it can be imported by `apps/pos` and run in the browser. The POS computes the same totals offline as the server computes online — **one implementation, two runtimes**. If `domain/` ever imports Node-only code, the offline POS silently diverges from the server, and that is a money bug.

### 7.3 The one deliberate architectural compromise

`modules/reporting/queries/` is the **only** place allowed to join across bounded contexts (orders × staff × inventory in one SQL file).

This is a conscious trade: it is what makes the owner dashboard fast, and it is also the thing that would have to be rebuilt as a separate read database if the monolith is ever split. It is fenced into one folder so that cost is **visible and bounded** instead of scattered everywhere.

Rules for that folder: read-only, no writes ever; every file has an `EXPLAIN ANALYZE` test; every file is listed in `docs/reporting-queries.md` with its indexes.

---

## 8. Scaling — what must be true for this structure to grow

Scaling here means two different things, and the structure serves both.

### 8.1 Scaling the code (more features, same developer)

- **A module is deletable.** Deleting `loyalty/` and its event handlers must break nothing except `loyalty` itself. If it breaks `orders`, a boundary was violated.
- **A feature is one folder.** "Change how a discount is applied" = open `orders/use-cases/apply-discount/`. If the answer is "four folders", the Common Closure Principle was violated.
- **A new vertical is configuration, not code.** Adding `pharmacy` as a `vertical_type` must be a template + feature flags (`06` §5.6), never a new branch of `if (vertical === …)` inside a use case. If a use case needs vertical-specific behaviour, it takes a **strategy object** (Open/Closed), it does not grow a switch.
- **File limits are a design signal, not a style rule.** 300 lines warn / 400 error (`CLAUDE.md` §3). A use case that hits 400 lines is 3 use cases.

### 8.2 Scaling the runtime (more shops, same code)

The structure already encodes the scaling path in `06` §5.15. What this file adds is **what must never be assumed in code**, so that path stays open:

| Never assume | Because |
|---|---|
| There is one `api` process | Two `api` containers is step 4 of the scaling path. No in-memory session, no in-memory cache of tenant data, no in-process event bus. Redis or the DB, always. |
| The request and the job run on the same machine | `worker` is a different container and will be a different VPS. Never pass a closure, a file handle or an open transaction into a job — only a serialisable payload with `company_id` inside it. |
| The tenant comes from a session | Three paths have no session (webhooks, messaging callbacks, worker jobs — `06` §5.4). Every entry point resolves the tenant explicitly and then calls `withTenant()`. There is no other way to reach the DB. |
| Sequential IDs | UUID v7, generated on the POS device while offline. |
| A module's data is reachable by a join | Only `reporting/queries/` may do that (§7.3). Everywhere else, cross-context data arrives by port or event — which is exactly what makes extracting a module into a service later a deployment change instead of a rewrite. |

---

## 9. SOLID — applied to *this* codebase

Not the textbook version. The version with this project's nouns in it.

**S — Single Responsibility.** A module has one reason to change *per actor*. `staff` changes when HR rules change; `commissions` changes when the owner changes payout rules; `cash` changes when the accountant changes reconciliation. They are separate modules **because they answer to separate people**, even though they all touch an employee. The classic failure — one `Employee` service holding HR hours, accounting payroll and DB persistence — is prevented structurally here.

**O — Open/Closed.** Three places where this is load-bearing:
- Adding a 4th payment gateway = a new adapter file + a row in the capability matrix. Zero changes to `payments` use cases.
- Adding a 5th consumer of `OrderCompleted` = a new handler file. Zero changes to `orders`.
- Adding a new commission rule type = a new rule evaluator. `computeCommission` does not grow an `if`.

**L — Liskov Substitution.** Every `PaymentGateway` adapter must be substitutable — but KNET Direct has **no refund API** (`06` §5.9.2). The wrong fix is `refund() { throw new Error('unsupported') }`, which detonates at 2 a.m. during a nightly refund run over 100 orders. The right fix is the **capability matrix**: `capabilities.refund` is checked before the call, the API rejects the request cleanly, and the UI never renders the button. Same pattern for split payments, saved cards and webhooks.

**I — Interface Segregation.** `PaymentGateway` is not one fat interface. Optional capabilities are separate, capability-gated members. Same on the notification side: an OTP sender does not need a marketing-campaign method. And in the domain: a use case that only needs a price takes `CatalogReaderPort`, not a 30-method `CatalogPort` that forces a recompile every time an unrelated method changes.

**D — Dependency Inversion.** The whole of §3 and §6. Concretely: **no `use-cases/` file ever contains the word `drizzle`, `sql`, `fetch`, or `axios`.** That is greppable, and CI greps it.

---

## 10. Enforcement — rules a machine checks

An architecture rule a human has to remember is a rule that will be broken by week three — especially when an AI agent is writing the code at speed. Every rule above is mechanically enforced.

### 10.1 `eslint-plugin-boundaries` — the import matrix from §3.1

The living configuration is `packages/config/eslint/boundaries.js`. In outline:

- every layer folder (`domain`, `use-cases`, `queries`, `ports`, `persistence`, `http`, `jobs`, `events`) is an element that captures its module name;
- `boundaries/dependencies` with `default: 'disallow'` encodes the matrix in §3.1, same-module only;
- the outer ring (`persistence`, `http`, `events`) may reach another module, and `boundaries/entry-point` restricts that reach to the module's `index.ts`;
- `no-restricted-imports` keeps `domain/` on `@pospay/domain` only, and keeps `drizzle-orm`, `@nestjs/platform-*`, `bullmq`, `ioredis`, `axios`, `node:*` and `@pospay/db` out of `use-cases/`; `no-restricted-globals` bans `fetch` there as well.

### 10.2 Cycles

`dependency-cruiser` with `no-circular: error` across `apps/**` and `packages/**`, and `madge --circular` as a fast pre-commit check. **The Acyclic Dependencies Principle is a build gate.** A cycle never reaches `main`.

### 10.3 The module-map check

`docs/module-map.md` lists the allowed arrows (mirroring `06` §3). A script compares the real import graph against it and fails on any arrow that is not declared. **Adding an arrow requires editing the map — which means it requires a decision, which means it requires an ADR.**

### 10.4 CI gate (added to the existing pipeline in `06` §5.15)

```
typecheck → lint → boundaries → cycles → module-map → unit (domain) →
integration → RLS negative tests → EXPLAIN checks → build
```

Nothing merges to `main` if any step fails.

---

## 11. Frontend — the same architecture, different nouns

Screaming Architecture is not a backend idea. `components/ hooks/ store/ utils/` at the root tells you the framework, not the product.

### 11.1 `apps/pos` (Vite PWA, offline-first)

```
apps/pos/src/
├── sell/                    ← take an order and get paid (the reason this app exists)
│   ├── ui/  model/  api/
├── shift/                   ← open drawer, close drawer, reconcile
├── attendance/              ← QR clock in/out
├── catalog-browse/
├── offline/                 ← the sync engine: Dexie schema, outbox, service worker, conflict rules
├── app/                     ← routing, providers, composition root
└── shared/                  ← no business meaning (§6.4)
```

`offline/` is named after a capability the business cares about ("it works when the internet dies"), which is why it earns a root folder while `utils/` does not.

**The critical rule:** `sell/` computes totals by importing `packages/domain` — the **same** functions the API uses (§7.2 rule 7). It never re-implements pricing in the browser.

### 11.2 `apps/admin` and `apps/menu` (Next.js App Router)

```
apps/admin/
├── app/                     ← App Router. Routes and layouts ONLY. Thin re-exports.
│   └── (dashboard)/orders/page.tsx     →  export { OrdersPage } from '@/orders/pages/orders-page'
└── src/
    ├── orders/  inventory/  staff/  commissions/  appointments/
    ├── customers/  reporting/  settings/  platform/
    └── shared/
```

Next.js owns `app/` for routing — that is a framework detail we accept. Everything with meaning lives in `src/<business-area>/`. Inside a business area the layering is light (`ui/`, `model/`, `api/`); frontends rarely need ports, because their "infrastructure" is one generated API client.

**Frontend dependency rule:** a business area may import `shared/`, and may import **types** from another area, but never another area's components or hooks. Cross-area composition happens in `app/`. Same acyclic rule, same CI check.

---

## 12. When NOT to add an abstraction (the anti-over-engineering budget)

Clean Architecture done badly is slower to change than spaghetti, because every change touches six files. Add an abstraction **only** when one of these is true:

- ✅ There are **two or more real implementations today** (payments: 3; storage: 2; notifications: 4).
- ✅ It crosses a boundary we **do not control** (a vendor, the network, the filesystem, the clock).
- ✅ It is needed to **break a dependency cycle** (§6.2).
- ✅ It makes a **test that could not otherwise exist** possible (repository ports → use-case tests with no DB).

Otherwise, don't:

- ❌ A `IOrderMapperFactory` because it "feels enterprise".
- ❌ A port over a pure function. `computeOrderTotals` is already a boundary — it has no dependencies.
- ❌ A generic `BaseRepository<T>` with 20 methods that every module inherits. That is Interface Segregation violated by inheritance, and it couples all modules to one file.
- ❌ A wrapper over Zod, Drizzle or Nest "in case we switch". We already decided those (`06` §1). Deferring a decision already made is just cost.
- ❌ A `presenter/` layer. The Zod contract in `packages/contracts` **is** the presentation boundary.

> Uncle Bob's point is *"delay decisions you have not yet had to make"* — not *"abstract decisions you already made"*. `06` decided Postgres and Drizzle deliberately, and the boundary that protects us there is the repository port, which we already have. One is enough.

---

## 13. Naming conventions

| Thing | Convention | Example |
|---|---|---|
| Module folder | business noun, plural, kebab | `cash-shifts` is wrong → `cash` (it owns more than shifts) |
| Use case folder | `<verb>-<noun>`, business language | `close-cash-shift`, not `shift-closer` |
| Use case class | `<VerbNoun>UseCase` | `CloseCashShiftUseCase` |
| Port file | `<noun>.port.ts` or `<noun>.repository.ts` | `catalog-reader.port.ts` |
| Adapter | `<tech>-<noun>.<role>.ts` | `drizzle-order.repository.ts`, `myfatoorah.gateway.ts` |
| Domain function | verb, pure, present tense | `computeCommission`, `canTransition`, `lateMinutes` |
| Event | `<Aggregate><PastTenseVerb>` | `OrderCompleted`, `StockPosted`, `DeviceRevoked` |
| Query | `<what-it-returns>.query.ts` | `list-orders.query.ts` |
| Raw SQL | mirrors the query file | `queries/sql/list-orders.sql` |

Use the **business's own words**, in the language the client uses them. A "شيفت" is a `CashShift`, not a `Session`. A "عمولة" is a `Commission`, not a `Bonus`. When the owner and the code use different words, every conversation needs a translation step — and translations are where bugs live.

---

## 14. Ready-to-use prompts

Paste these when starting work. They encode the rules above so the AI produces the right shape the first time instead of being corrected afterwards.

**Scaffolding a new module**

```
Generate the folder structure for the `<module>` module in apps/api/src/modules.
Use Screaming Architecture: the folders must express business intent and use cases,
not framework roles. Do NOT create models/, views/, controllers/, services/ or utils/
as top-level folders.

Follow the standard module shape from CLAUDE.architecture.md §5 exactly:
domain/ use-cases/ queries/ ports/ persistence/ http/ events/ <module>.module.ts index.ts

Apply the Common Closure Principle: everything that changes for the same business
reason lives in the same folder. Apply the Common Reuse Principle: do not put code
in a shared folder unless it is always used together.

Do not write implementations yet — structure and empty files with their intent
documented in a one-line comment at the top of each.
```

**Implementing a use case**

```
Implement the use case `<verb-noun>` in modules/<module>/use-cases/<verb-noun>/.

Strictly separate business logic from infrastructure. The use case must have NO
dependency on the database, HTTP, NestJS internals, or the UI. All arithmetic goes
in modules/<module>/domain/ as pure functions with zero imports.

Define the interfaces (ports) that the use case needs in modules/<module>/ports/ and
inject them through the constructor. The Drizzle implementation goes in
persistence/ and implements the port — the dependency arrow points from the database
toward the business logic, never the reverse. Bind them only in <module>.module.ts.

Money is bigint mills, never number. Time and IDs are injected as Clock/IdGenerator
ports, never read directly. The write is one transaction and appends the outbox event
inside it.

Write the pure domain tests first — they must run with no database.
```

**Cross-module work (breaking a cycle)**

```
Implement <feature>, where <module A> needs data from <module B>.

Strictly enforce the Acyclic Dependencies Principle: do NOT create a circular
dependency and do NOT import <module B> from <module A>. Use Dependency Inversion —
define the interface <module A> needs in modules/<A>/ports/, and implement it in an
adapter. Alternatively, if this is a reaction rather than a read, use a domain event
through the outbox instead of any direct call.

Cross-module imports are restricted to the module's index.ts public surface.
```

**Adding a variant to existing behaviour**

```
Add <new variant> to <existing behaviour>.

Apply the Open/Closed Principle: extend, do not modify. Do not add an if/switch to
the existing code path. Introduce a new strategy/adapter that implements the existing
interface, and register it. Apply Interface Segregation — if the new variant does not
support part of the interface, declare that in the capability matrix rather than
implementing a method that throws (see CLAUDE.architecture.md §9, L).
```

**Review prompt (run this on any AI-written slice before merging)**

```
Review this slice against CLAUDE.architecture.md. Report violations only, as a list,
each with the file and the rule number:
1. Does any file in domain/ or use-cases/ import drizzle, SQL, HTTP, NestJS platform
   code, bullmq, or node:*?  (§3.1)
2. Does any arithmetic or business calculation sit outside domain/?  (§4.1)
3. Does any module import another module through a deep path instead of index.ts?  (§5.1)
4. Is there a new dependency arrow not declared in docs/module-map.md?  (§10.3)
5. Is there a cycle?  (§10.2)
6. Does anything in queries/ import domain/ or use-cases/, or perform a write?  (§7.1)
7. Is there an interface with only one implementation that is not justified by §12?
8. Is money represented as a JS number anywhere?
9. Is there a class named *Service with more than one reason to change?  (§9, S)
```

---

## 15. Definition of done for a slice

A slice is finished when **all** of these are true:

- [ ] Spec exists in `docs/specs/NNN-<module>-<use-case>/spec.md` (created by `/speckit-specify` — see `.specify/PROJECT-OVERRIDES.md`) (`CLAUDE.md` §1)
- [ ] Business rules are pure functions in `domain/`, with exhaustive unit tests that run with no DB
- [ ] The use case depends only on ports; the concrete bindings live only in `<module>.module.ts`
- [ ] The write is one transaction, is idempotent, and appends its outbox event inside that transaction
- [ ] New tenant table ⇒ RLS policy + negative cross-tenant test in the same PR
- [ ] Every new filter/sort column has a composite index starting with `company_id`, added in the same migration
- [ ] Read path lives in `queries/`, does not import `domain/`, and has an `EXPLAIN ANALYZE` check
- [ ] No new dependency arrow unless `docs/module-map.md` was updated (+ ADR)
- [ ] `boundaries`, `no-circular`, and the module-map check pass
- [ ] The file explains itself: a stranger opening the folder can tell what the business does

---

## 16. Status of the companion documents

✅ **`CLAUDE.md` V3 (2026-09-16)** — synced. Prisma → Drizzle, MinIO → R2, the module layout in its §2.2 matches §5 of this file, and the boundary/cycle/module-map CI gates are in its §10.

✅ **`docs/module-map.md` M1.0 (2026-09-15)** — written. It separates the three arrow kinds (import / port / event), lists every allowed edge, and carries the YAML the CI script reads (§10.3).

### Still open

1. **`06_Tech_Stack_Architecture_EN.md` §2 does not list `packages/domain`.** One line, but it matters: `packages/domain` is the shared kernel (Money, Percentage, TaxRule, Quantity/UoM, KWD rounding) and it is what lets the POS compute the same totals offline that the server computes online (§7.2 rule 7). Add it to the repo layout block.
2. **An ADR should record this decision**: "pragmatic Clean Architecture — hard boundaries at the five places in §6.1, vertical slices inside modules, a separate read path" — with §12 captured as the explicit *limit* on abstraction, so future-you knows what was deliberately **not** built and why.
3. **`docs/module-map.yaml`** — the machine-readable block currently lives inside `docs/module-map.md` §6. Extract it to its own file when the CI script is written.

---

## Sources

Research behind this document (September 2026):

- [Vertical Slice Architecture in a Modular Monolith — Milan Jovanović](https://milanjovanovic.tech/blog/where-vertical-slices-fit-inside-the-modular-monolith-architecture) — the macro/micro split in §1
- [Vertical Slice Architecture — Milan Jovanović](https://milanjovanovic.tech/blog/vertical-slice-architecture)
- [NestJS Project Structure Best Practices — Encore](https://encore.dev/articles/nestjs-project-structure-best-practices) — feature folders over technical layers
- [Ports & Adapters: Ditching the Dogma for Pragmatism — Codeartify](https://codeartify.substack.com/p/ditching-the-dogma-for-pragmatism) — the abstraction budget in §12
- [Clean Architecture in Frontend — Feature-Sliced Design](https://feature-sliced.design/blog/frontend-clean-architecture)
- [Feature-Sliced Design with Next.js](https://feature-sliced.design/docs/guides/tech/with-nextjs) — §11.2
- [eslint-plugin-boundaries](https://github.com/javierbrea/eslint-plugin-boundaries) — §10.1
- [Taking Frontend Architecture Seriously with dependency-cruiser — Xebia](https://xebia.com/blog/taking-frontend-architecture-serious-with-dependency-cruiser/) — §10.2
- [Enforce Module Boundaries — Nx](https://nx.dev/docs/technologies/eslint/eslint-plugin/guides/enforce-module-boundaries) — tag-based boundary enforcement
- [CQRS pattern — Microsoft Learn](https://learn.microsoft.com/azure/architecture/patterns/cqrs) — the two-path model in §7.1
- [Multi-tenant SaaS on Postgres](https://clickhouse.com/resources/engineering/multi-tenant-saas-postgres-architecture) and [RLS tenant isolation](https://mvpfactory.io/blog/row-level-security-in-postgresql-multi-tenant-data-isolation-for-your-saas) — §8.2

Primary reference: Robert C. Martin, *Clean Architecture* — Ch. 7–11 (SOLID), Ch. 13–14 (Component Cohesion: CCP, CRP; Component Coupling: ADP), Ch. 17 (Boundaries), Ch. 20 (Business Rules: Entities vs Use Cases), Ch. 21 (Screaming Architecture).
