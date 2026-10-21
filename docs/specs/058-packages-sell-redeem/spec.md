# Spec 058 — Packages: stop selling, sell, redeem, cancel a redemption, extend, refund, import (Phase 1 rows 33b, 42–47)

> **Status:** Draft · 2026-10-21 · docs-only PR. 23 owner questions in [owner-questions.ar.md](owner-questions.ar.md).
> **Answered:** PK-Q12…PK-Q21 by Waleed (PP-16, fully answered, through his super agent, 2026-10-21); PK-Q17 and PK-Q18
> went against the recommendation (reception sees everything; the import uses the package-type permission).
> **Still open (13):** the charges/money questions PK-Q1…PK-Q11, PK-Q22 and PK-Q23 (decisions page, batches 35, 37 and
> 38; Abu Salem binds). Every rule that waits on an open one
> is marked `TODO(spec)` with its number and follows its recommended option, so only that rule moves if an owner picks
> otherwise. **No code starts on a sub-PR whose rows name a pending question** (§7).
> **Implements:** SPEC §4 (`PackageEntitlement`, `PackageComponent`, `PackageSessionSlot`, `PackageRedemption`,
> `PackageRefund`), §5.6, §8 and the M5–M14 behaviour tests of §11; PRD D-30, D-42, D-48, D-51, D-55; plan rows
> 33b, 42, 43, 44, 45, 46, 47 (`docs/specs/phase-1/IMPLEMENTATION-PLAN.md`).
> **Builds on:** [spec 037](../037-catalog-package-types/spec.md) (package types, PT-Q1…PT-Q12),
> [spec 007](../007-orders-package-allocation/spec.md) (the pure valuation and slot functions of row 31, already in
> `apps/api/src/modules/orders/domain/package-*.ts`), [spec 050](../050-orders-record-service-session/spec.md) (the
> record and append writer a redemption rides on), [spec 054](../054-orders-cancel-service-line/spec.md) D-6 (the
> cancel writer row 44 extends), [spec 055](../055-orders-change-line-performers/spec.md) D-8 and
> [spec 35d](../050-orders-record-service-session/spec-35d.md) (the writers that must refuse or accept a redeemed line),
> [spec 030](../030-staff-employee-import/spec.md) (the import framework row 47 reuses), ADR-0010, ADR-0041.
> **Consumed later by:** row 50 (projection of `PackageSaleChanged` and of redeemed lines), rows 51–55 (statements and
> corrections), both specified in spec `059-commissions-statements` (PR #441); row 59 (a redeemed line is an active line for the rating group).
> **Design advisors:** required before 42-2, 43-1, 46-1 and 47-1 start (§7): new money tables, `UPDATE` grants on
> slot and entitlement rows, row locks and a one-way state machine. Not needed for this docs-only PR.

## 1. What and why

The salon sells packages today (D-42): «10 سشوار بـ 25.000 دينار، صالحة 90 يوم». Row 33 let a manager define them.
This spec carries a package through its whole life after the definition:

| Row | Use case | One sentence |
|---|---|---|
| 33b | `stop-selling-package-type` / `resume-selling-package-type` | a manager hides a package type from the sale screen and shows it again (PT-Q5); sold packages are untouched |
| 42 | `sell-package` | reception sells a package to a customer: the price paid is fixed, split over its sessions (SPEC §8), and the seller is named |
| 43 | `redeem-package-session` | a session of the visit is taken from the customer's package instead of being paid: the lowest free slot of that service is used, under a row lock |
| 44 | `cancel-redemption` | cancelling a redeemed line gives the session back to the package, once |
| 45 | `extend-package` | a manager moves the expiry date later |
| 46 | `refund-package` | a manager refunds unused sessions of one service of the package, exactly or not at all |
| 47 | import open packages | packages sold before PosPay are imported from Excel with their used and remaining sessions |

**Worked example (salon «صالون الأميرة», branch السالمية, `Asia/Kuwait`).** The package type «سشوار ×10» costs 25.000,
validity 90 days, one service سشوار (list 3.000) ×10. On 1 October 2026 منى at reception sells it to نورة for 22.500
(discount 2.500 = 10%, inside her limit), cash, seller هبة. The package expires on **30 December 2026** (1 October + 90
days, PT-Q3). Each of its 10 slots is worth **2.250** (22.500 ÷ 10, SPEC §8). نورة comes three times; each visit records
a سشوار line «من الباقة» with list price, price and net **2.250** and no discount; the performer earns her commission on
2.250 like any line (D-42, D-55). The second visit's line was recorded by mistake; the branch manager ليلى cancels it, and
slot 2 is free again (M8). On 5 November نورة asks for her money back: slots 1 and 3 are used, so ليلى refunds the 8
unused sessions, slots 2 and 4…10 (every free ordinal), **18.000** in cash; refunded slots can never be used. Had هبة's plan paid a package-sale
commission, it would fall in proportion to (22.500 − 18.000) ÷ 22.500 (SPEC §5.6).

## 2. Scope and what this spec settles

| Item | Decision | Where |
|---|---|---|
| Stop / resume selling (33b) | a nullable `selling_stopped_at` on the type; stopped types are refused by the sale and hidden from its picker; everything already sold, and the import, are unaffected (PK-Q12, PP-16.1) | FR-001…FR-003 |
| The sale record (42) | the **entitlement row is the sale**; it is not a service line (TD-1) | TD-1, FR-010 |
| Sale price, discount, seller, method, back-dating | `TODO(spec)` PK-Q2, PK-Q3, PK-Q4, PK-Q11 | FR-012…FR-016 |
| Valuation | spec 007's `allocatePackagePrice` and `createPackageSlots`, at sale, from the services' list prices **at sale time** | FR-017, BR-01 |
| Redemption (43) | a **draft kind of the existing record and append routes** (TD-2), not a new endpoint; lowest `FREE` ordinal under a lock on the component row | TD-2, FR-020…FR-027 |
| Cancel a redemption (44) | the 054 cancel writer accepts a redeemed line and reverses its redemption once in the same transaction (`TODO(spec)` PK-Q6) | TD-3, FR-030…FR-033 |
| Price edit of a redeemed line | refused: its price is the slot value (SPEC §4, §8) | FR-034 |
| Performer change of a redeemed line | `TODO(spec)` PK-Q8 | FR-035 |
| Extend (45) | forward only, audited, compare-and-set on the current date (PK-Q16 answered; `TODO(spec)` PK-Q1) | FR-040…FR-044 |
| Refund (46) | the manager picks one component and a count; highest `FREE` ordinals; exact or `INSUFFICIENT_SLOTS` (SPEC §8) (`TODO(spec)` PK-Q4, PK-Q5, PK-Q10) | FR-050…FR-057 |
| Import (47) | the spec 030 framework: template, preview, one all-or-nothing commit; `external_ref` unique per company (`TODO(spec)` PK-Q9, PK-Q22) | FR-060…FR-068 |
| Who sees a customer's packages | reception and managers alike see everything (PK-Q17, PP-16.6) | FR-070, FR-071 |

**Not in 33b, 42–47:** instalments and sharing a package between customers (D-42, out of scope); a package used in another
**business** of the company (D-30); payments, receipts and printing (Phase 2 — the paid method is recorded, no money is
captured); cancelling a sale as such (a sale entered by mistake is undone by a full refund of its unused sessions, §9);
commission arithmetic and statements (rows 50–55); the staff app's view of packages (row 57); rating scheduling (row 59).

### Decisions record (technical; none is an owner question)

| ID | Decision | Alternative rejected |
|---|---|---|
| TD-1 | **The sale is the entitlement row, not a service line.** `service_lines.service_id` must reference a `services` row (`service_lines_service_fk`) and a package type is not one; every service line reaches `commissions` as a performer line through `ServiceSessionRecorded`/`ServiceLineChanged`, while a sale must earn **only** the seller's sale commission through `PackageSaleChanged` and never advance an accumulator (D-51, SPEC §5.6). SPEC §4's `sold_line_id?` is optional and stays `NULL` in Phase 1. The discount check of SPEC §4 ("on its **sale** line, against the package type's price") runs on the sale request itself. Consequence for 054 D-6 and 055 D-8: there is no "package sale line" in `service_lines`; only a **redeemed** line carries a marker, and their refusals reduce to that | a sale line in `service_lines` with a nullable `service_id` and a kind column (a second line meaning that every reader of lines, the projection and the rating group would have to exclude) |
| TD-2 | **Redemption is a draft kind of the record (050 FR-001) and append (050 FR-020) routes.** A draft is either the existing paid draft or `{ service_id, package: { entitlement_id }, performers }`; the writer takes the component lock, the slot and the redemption row in the same transaction as the visit. One save records paid lines and package lines together; the 20-line cap, the visit lock, the recovery proof (ADR-0042), the SS-Q2 self rule, the window and `ServiceSessionRecorded` / `ServiceSessionLinesAdded` all apply unchanged. A redemption failure is atomic (050 FR-001: only an above-limit discount gives partial acceptance) | a separate `redeem` endpoint (it would duplicate visit creation, the recovery proof, the line cap and the event envelope, and a mixed visit would need two saves) |
| TD-3 | **Cancel a redemption = the 054 cancel writer, extended.** For a line with `redemption_id`, after the 054 checks pass, the same transaction locks the component, sets `reversed_at` on the redemption **only where** it is still `NULL` and frees the slot **only where** it is still `USED` by that redemption (SPEC §8). The line is re-emitted `CANCELLED` with its `package` block. CX-Q5 (a cancel is final, one cancellation row per line) already makes a second reversal impossible; the two conditional `UPDATE`s are the database guarantee behind it | a separate `cancel-redemption` route (two writers of one line's status) |
| TD-4 | **Dates (D-10).** `expires_on` and the sale date are calendar dates. Every "today" is the local date in the **effective timezone of the branch where the act happens**: the branch's own timezone, else the business's (D-10; SPEC §8 "branch timezone"). The selling branch gives the sale date (stored with `sold_timezone`), the serving branch gives a redemption's date, the acting branch gives "today" for an extension or a refund. The calendar date `expires_on` never moves between branches; only the instant at which "today" passes it depends on the branch that serves the customer. **"Today" for a redemption is the visit's local date**: its `occurred_at` in the serving branch's effective timezone (`TODO(spec)` PK-Q7); the 050 visit keeps its own business date for the recording window and the commission month | reading every package date in the business timezone (the wrong local day around midnight in a branch with its own timezone, against D-10) |
| TD-5 | **Locks, one global order.** Refund: entitlement `FOR UPDATE` → component `FOR UPDATE` (SPEC §8). Redemption: visit advisory lock (050) → components `FOR UPDATE` in ascending id. Cancel of a redeemed line: 054's order (visit lock → line `FOR UPDATE`) → component `FOR UPDATE`. Extension: entitlement `FOR UPDATE`. No path takes the entitlement after a component, and the refund never takes a visit lock, so no cycle exists. The redemption reads `expires_on` without locking the entitlement: an extension only moves it later, so a stale read can only refuse, never wrongly accept | locking the entitlement on every redemption (a hot row for the whole package) |
| TD-5b | **Slots are an enforced state machine.** `FREE → USED` (a live redemption), `USED → FREE` (only when that redemption is reversed in the same transaction), `FREE → REFUNDED` (only with a refund row of the same transaction), `IMPORTED_USED` and `REFUNDED` terminal; `ordinal` and `unit_value` never change. A trigger refuses every other transition; the runtime grant is `UPDATE (state, current_redemption_id)` only | trusting the use cases alone with an `UPDATE` grant on the whole row |
| TD-6 | **Financial rows are immutable; reversals are rows.** Sale, components, slots' values, redemptions, refunds, extensions and imports are insert-only. The only in-place changes are the cumulative ones SPEC §8 names (`refunded_amount`, `revision`, `expires_on` on the entitlement; `state` on a slot; the one-time `reversed_at` on a redemption), each enforced one-way by a trigger and each paired with an insert-only history row (refund, extension, the 054 cancellation row) that says who, when and why | updating a sale or deleting a redemption |
| TD-7 | **`PackageSaleChanged`** (ADR-0010) is emitted only for `SOLD` entitlements: on the sale (`revision = 1`, enforced at insert, BR-03) and on every refund (`revision + 1`, the new cumulative `refunded_amount`), in the same transaction. Extension does not change `revision` (its compare-and-set token is the current `expires_on`, FR-041), so it emits nothing: no field of the event moves. `status` is the constant `'SOLD'` in Phase 1, reserved for a later sale cancellation. An imported entitlement emits nothing, ever (no seller, no sale commission, D-51). Its payload is ADR-0010's (`sale_id`, `business_id`, `sold_at`, `seller_employee_id`, `price_paid`, `refunded_amount`, `status`, `revision`) plus `branch_id` (= `sold_branch_id`) and `business_date` (= `sold_business_date`): the **sale's** branch and business date on every revision, a refund's own `branch_id` never replacing them, which row 50's package-sale projection (sub-PR 50-4, CM-20, of spec `059-commissions-statements`, PR #441; not row 59, the rating group) requires: `business_date` by that spec's FR-018, which sets the commission month from it, and `branch_id` by its branch-scope rule (CS-Q20 = PP-20.1, CS-Q23 = PP-21.2), which shows where the sale happened (`source_branch_id`); an import emits nothing, so a `NULL` `sold_branch_id` never reaches the event | emitting for imports (a consumer would have to skip them) |
| TD-8 | **The redeemed line marker.** `service_lines.redemption_id` (SPEC §4 `ServiceLine … redemption_id?`), written at insert and never changed; a deferred tenant FK to `package_redemptions`, and `package_redemptions.line_id` back to the line, both in the same transaction. The line event's `package` member goes from `null` to `{ entitlement_id, component_id, ordinal }` for such a line, in `ServiceSessionRecorded`, `ServiceSessionLinesAdded` and `ServiceLineChanged` (ADR-0010 already lists it) | a separate lookup table (every writer of a line would need one more join to know it is a package line) |
| TD-9 | **Idempotency.** `Idempotency-Key` on the sale (`sell-package`), on a redemption (through the record/append operations), on the cancel (054's), on the refund (`refund-package`), on the extension (`extend-package`, for a uniform retry story) and on the import commit (`import-packages`). Stop/resume selling is master data with no money effect and uses the type's `expected_revision` only, as row 33 does (spec 037 TD-3) | per-use-case special cases |
| TD-10 | **Catalog read.** `CatalogReaderPort` (orders-owned) gains one bounded read: a package type of the business with names, price, validity, revision, `selling_stopped_at` and its components with each service's current list price, names, revision, rule and threshold flag. It is the arrow ADR-0010 already planned ("package-type components"); the module-map §3 row is widened in 42-1, no new import arrow | orders reading catalog tables directly |
| TD-11 | **Customer by phone (import only).** `CustomerLookupPort` gains `findByPhone(e164)` for row 47; the existing `orders → customers` port arrow is widened in 47-1 (module-map §3 row), no new arrow. The phone is never logged and an import error shows its last 3 digits only (SPEC §4, CLAUDE.md §8) | importing customers inside orders |
| TD-12 | Money is `bigint` mills in the domain, `numeric(14,3)` in the database and a canonical three-decimal string in contracts and events (ADR-0041, as `ServiceLineChanged.net`) | `number` anywhere |
| TD-13 | **An any-of access guard for the package reads (CP-03).** `Require` stores one permission and `AccessGuard` checks only it, and a second `@Require` overwrites the same metadata key, so FR-070 and FR-071 cannot accept either of two permissions today. 42-4a adds `RequireAny([permission, …], target)` to `apps/api/src/shared/access.decorators.ts`: every listed permission has the same scope, so the target is validated once at module load exactly as `Require` does, and a list of mixed scopes fails there. It writes the same `REQUIRE_ACCESS` key with a non-empty `permissions` list (`Require` becomes the one-element case), so `route-coverage.ts` and the startup checks see it unchanged. `AccessGuard` passes the list to the identity authorizer, which reads every listed grant in **one** `withTenant` transaction (the PP-7.2 connection budget) and grants when at least one permission covers the target with no DENY on that permission. The refusal of a session with no user (a device), the company resolution and `@RequiresFeature` run exactly as after `@Require`. This changes the access infrastructure in `src/shared` and the identity module, outside the slice (CLAUDE.md §1.4), so 42-4a records it in an ADR-0003 §4 addendum | an `@Authenticated()` route that checks inside its own transaction (CLAUDE.md §6 keeps that for a decision that depends on the record or the caller, and this is a fixed either-of at a branch; the session-only marker also skips the guard's device refusal and the company resolution that `@RequiresFeature` needs, which a `queries/` file would have to rebuild) |

## 3. Owner rules

### 3.1 Already decided — cited, not asked again

| Rule | Source |
|---|---|
| A package is a list of services with session counts, for one customer, paid in full; no instalments, no sharing | D-42 |
| Validity per package type; last usable day = sale date + N days, usable to the end of that day | PT-Q2, PT-Q3, D-51 |
| A package is sold and used in every branch of its business; never in another business of the company | PT-Q10, D-30 |
| Editing a type never changes a sold package: services, list prices, sessions, values and expiry are fixed at sale | PT-Q4, SPEC §4 |
| Valuation: price paid allocated by `list_price × sessions` (sessions when all prices are zero), largest remainder, ties by `service_id`; ordinal *k* of *n* = `floor(value / n)`, ordinal *n* takes the remainder; price 0 → every slot 0 | SPEC §8, D-42, spec 007 PKG-01…PKG-04, PT-Q7 |
| A redeemed session is a line whose list price, price and net are its slot's value; it is never a discount; it counts toward thresholds like any session; unused sessions carry no commission | SPEC §4, §5.2, D-42, D-55 |
| A package's discount is checked once, on the sale, against the type's price | SPEC §4 |
| The seller is named at sale; reception records paid-in-full and the method; the seller's sale commission is per plan (`package_sale`), on `price_paid − refunded`, never advancing thresholds | D-51, PT-Q12, SPEC §5.6 |
| Redeem: lowest `FREE` ordinal under a row lock on the component; refused when no slot is free or after the expiry day | SPEC §8, spec 007 PKG-07, PKG-09 |
| Cancelling a redeemed line frees its slot once; a stale retry reverses nothing; the next redemption takes the lowest free | SPEC §8, M8, M10, spec 007 PKG-10 |
| Extension: a manager may extend; audited; it moves `expires_on` | D-42, SPEC §8 |
| Refund: unused sessions only, with a manager; one component and a positive count, exact or `INSUFFICIENT_SLOTS`; the highest `FREE` ordinals; amount = sum of their values; refunded slots never redeemable; entitlement lock then component; `refunded_amount` and `revision` change in the same transaction | D-42, SPEC §8, M6, M9, M14, spec 007 PKG-08 |
| **The refund amount after partial use** is the sum of the refunded slots' values (the price paid split over the sessions), not a list-price recomputation | D-42 "session value = price paid ÷ sessions; refund covers unused sessions only", SPEC §8 |
| **No refund after expiry** unless the package is extended first | D-51, SPEC §8, M7 |
| A refund after the seller's month is approved becomes a correction through the new `PackageSaleChanged` revision | SPEC §6, §5.6 |
| Import: original price, original sessions per service, remaining sessions, expiry, customer phone, `external_ref` unique per company (re-import is a no-op); slots valued over the original sessions; ordinals `1…used` are `IMPORTED_USED`; no seller, no sale commission | D-51, SPEC §8, spec 007 PKG-05, PKG-06 |
| Import is an Excel template with preview and per-row errors; one invalid row saves nothing | D-48, SPEC §12 |
| Sale and redemption require an `Idempotency-Key`; a retry returns the original result | SPEC §8, M10 |
| One validator for types, sales and imports (≥ 1 component, unique service, sessions 1…365, price ≥ 0, remaining 0…original) with named errors at preview and commit | SPEC §4, spec 007 PKG-11, spec 037 TD-1 |
| Recording a visit: SS-Q2 (staff cannot record their own performance), SS-Q7, SS-Q8, SS-Q9 (window back to the first of the previous month) | spec 050 |
| Cancelling a line: CX-Q1…CX-Q5 (new permission, recording window, reason, bell, mark, tip guard, final) | spec 054 |

### 3.2 Owner questions (open ones follow the ⭐ option; answered ones say so)

| ID | Kind | Question (short) | ⭐ recommended | What moves if another option wins |
|---|---|---|---|---|
| PK-Q1 | money | Is an extension charged? | free: it moves only the date | 45 gains a fee field, its payment record and its effect on slot values and the seller's commission (a new rule, a new ADR) |
| PK-Q2 | money | Sale price against the type's price | like a visit line: editable, even above the type price (SS-Q4); discount counted against the type price within the recorder's limit, half-up (SS-Q5); above the limit refused until rows 38–41 | FR-012, FR-013 |
| PK-Q3 | money | May the person recording the sale name herself as the seller? | no, like SS-Q2 | FR-014 (one rule) |
| PK-Q4 | money | Payment method of a sale and of a refund | `CASH` or `CARD`, recorded on both | the method enum of FR-015 and FR-054 |
| PK-Q5 | money | Who refunds, and what is recorded | new permission, owner / general manager / business manager / branch manager, grantable; written reason; bell to the branch managers; audit | FR-050, FR-055, FR-056; 46-3 |
| PK-Q6 | money | Cancelling a redeemed session | exactly the CX-Q1…CX-Q5 rules of a line, and the session goes back to the package | FR-030…FR-033 |
| PK-Q7 | money | Expiry date of a late-recorded redemption | the visit's date (local to the serving branch, TD-4) | TD-4, FR-024 |
| PK-Q8 | money | Changing the performers of a redeemed session | allowed, by the 055 rules; the slot does not move | FR-035; 055 D-8 lifted |
| PK-Q9 | money | Price of an imported package | the amount the customer actually paid, required | FR-063 |
| PK-Q10 | money | Can an imported package be refunded? | yes, by the same rules, amount = its unused slots' values | FR-053 |
| PK-Q11 | money | Back-dating a sale | like a visit (SS-Q9): default now, back to the first of the previous month; expiry and commission month from the sale date | FR-016 |
| PK-Q12 | technical | Stop / resume selling | **Answered (PP-16.1):** as recommended: the holders of `manage:package-types:business`; no reason; audited; sold and imported packages untouched; still editable | settled |
| PK-Q13 | permission | Who sells | **Answered (PP-16.2):** as recommended: new `sell:packages:branch`, defaulting to the five SS-Q2 roles (owner, general manager, business manager, branch manager, cashier) | settled |
| PK-Q14 | permission | Who redeems, and where | **Answered (PP-16.3):** as recommended: whoever records a visit (`record:service-sessions:branch`), in the same reception screen | settled |
| PK-Q15 | technical | Two packages hold the same service | **Answered (PP-16.4):** as recommended: reception picks; the screen suggests the one that expires first | settled |
| PK-Q16 | permission | Extension: who and its limits | **Answered (PP-16.5):** as recommended: new `extend:packages:branch` for the four managers; written reason; later only; at most two calendar years after today; allowed after expiry; repeatable; no bell | settled |
| PK-Q17 | permission | Who sees a customer's packages | **Answered (PP-16.6):** **against the recommendation:** reception sees everything, amounts and history included | settled — FR-070, FR-071, CP-01, CP-03 |
| PK-Q18 | permission | Who imports | **Answered (PP-16.7):** **against the recommendation:** the import uses `manage:package-types:business`; no new import permission | settled — FR-060, IM-01, IM-08, 47-1 |
| PK-Q19 | technical | Imported package without a matching type | **Answered (PP-16.8):** as recommended: rows give a name, services and sessions directly; no type link | settled |
| PK-Q20 | technical | Import row whose customer phone is unknown | **Answered (PP-16.9):** as recommended: the row is refused with a clear error; customers are imported first (row 34b) | settled |
| PK-Q21 | technical | Import row already expired | **Answered (PP-16.10):** as recommended: accepted as it is (a manager can extend it later) | settled |
| PK-Q22 | money | How an imported package with several services is split between them | the file may give each service's price at the original sale; where it is blank, today's menu price is used | FR-061, FR-063, IM-02 |
| PK-Q23 | money | A back-dated sale: which package definition and prices apply | the definition and service prices current when the sale is recorded, shown on the sale screen before saving | FR-017, SA-07: the request would carry historical values that are checked, or back-dating would be refused (PK-Q11 changes) |

## 4. User scenarios and acceptance criteria *(mandatory)*

Named tests; integration tests run against the T2 compose Postgres (ADR-0006) unless marked unit. People as in §1: منى is
the cashier, ليلى the branch manager, هبة and سارة employees, نورة the customer. SPEC §11 numbers are given in brackets.

### Story 1 — Stop and resume selling a type (33b, P1)

- **ST-01** A holder of `manage:package-types:business` stops «سشوار ×10» with `expected_revision`: `selling_stopped_at` is
  set, `revision` +1, one audit entry `package_type.selling_stopped`. Resuming clears it the same way
  (`package_type.selling_resumed`). Stopping a stopped type or resuming an active one → 409 `PACKAGE_TYPE_SELLING_UNCHANGED`;
  a stale revision → 409 `PACKAGE_TYPE_REVISION_CONFLICT` (spec 037).
- **ST-02** The type list and detail carry `selling_stopped_at`; the sale picker (42-4) lists only active types; a sale
  of a stopped type → 422 `PACKAGE_TYPE_NOT_SELLABLE`, nothing written.
- **ST-03** Packages already sold or imported from a stopped type redeem, extend and refund as before; the type stays
  editable while stopped (PT-Q4); the import names no type (PK-Q19), so stopping never blocks it.
- **ST-03b** A sale racing a stop of the same type: the sale holds the type row `FOR SHARE` (FR-018b), so either the
  sale commits first and the stop waits, or the stop commits first and the sale, rechecking under the lock, is refused
  `PACKAGE_TYPE_NOT_SELLABLE`. A sale never commits after the stop (two real connections).
- **ST-04** Without the permission, a device, or the `catalog` feature off → 403 / `FEATURE_DISABLED`, nothing written.

### Story 2 — Sell a package (42, P1)

- **SA-01** منى sells «سشوار ×10» to نورة for 22.500, cash, seller هبة, in السالمية. In **one** transaction: one entitlement
  (`provenance SOLD`, `list_price 25.000`, `price_paid 22.500`, `discount 2.500`, `discount_bps 1000`, `sold_at`,
  `sold_business_date 2026-10-01`, `expires_on 2026-12-30`, `revision 1`, `refunded_amount 0.000`), one component
  (`list_price_snapshot 3.000`, `sessions_total 10`, `component_value 22.500`), ten slots `FREE` of 2.250, one audit entry
  `package.sold`, one `PackageSaleChanged` (`revision 1`, `status 'SOLD'`, `branch_id` السالمية, `business_date 2026-10-01`), the idempotent 201 stored.
- **SA-02** Mixed type «العروس»: 1 تسريحة (20.000) + 1 مكياج (15.000) + 2 مناكير (2.500) for 40.000: weights 20, 15, 5
  → component values 20.000, 15.000, 5.000; slots 20.000; 15.000; 2.500, 2.500. A fixture with a remainder mill follows
  spec 007 PKG-01/PKG-02 exactly (unit, shared fixture table).
- **SA-03** The component list prices are the services' prices **at sale time**; editing the type or a service afterwards
  changes no sold component, slot or expiry (PT-Q4; re-read after an edit).
- **SA-04** (`TODO(spec)` PK-Q2) Price 25.000 → discount 0; price 27.000 → accepted, discount 0, `discount_bps 0`; price
  21.000 (16%) with a 10% limit → 422 `PACKAGE_SALE_DISCOUNT_ABOVE_LIMIT` with the limit and nothing written; the owner
  (unlimited) may sell at 0.000 → every slot 0.000. A percent discount rounds to the mill half-up (SS-Q5). [M13]
- **SA-05** (`TODO(spec)` PK-Q3) Seller هبة must be active and attached to the branch on the sale date (the
  `PerformerCheckPort` facts of 050 FR-011, without the attendance warnings) → else 422 `PACKAGE_SELLER_NOT_ELIGIBLE`; a
  recorder linked to the named seller → 403 `PACKAGE_SELLER_SELF_FORBIDDEN`, even for the owner.
- **SA-05b** A manager detaches هبة from the branch while منى's sale naming her is in flight (two real connections, both
  orders): detach first → the sale, reading after `PerformerCheckPort.lock`, gets `PACKAGE_SELLER_NOT_ELIGIBLE`; sale
  first → the detach waits for the lock and the sale commits with هبة eligible. The same holds for a relink of هبة's user
  and the self rule.
- **SA-06** (`TODO(spec)` PK-Q4) `paid_method` is `CASH` or `CARD`; missing or other → 400 by the contract.
- **SA-07** (`TODO(spec)` PK-Q11) `sold_at` omitted → now; back-dated inside the window → accepted, `late = true`,
  expiry from the sale date; before the first of the previous month → 422 `PACKAGE_SALE_TOO_OLD`; in the future beyond
  the 120 s allowance → 422 `PACKAGE_SALE_IN_FUTURE` (050 FR-014 values). (`TODO(spec)` PK-Q23) A sale back-dated to
  a day when سشوار cost 2.500 but recorded after its price became 3.000 is valued at the recording-time definition and
  prices (3.000), the ones the screen showed.
- **SA-08** Customer of another company or unknown → 422 `PACKAGE_CUSTOMER_NOT_FOUND`; type of another business or
  unknown → 404 `PACKAGE_TYPE_NOT_FOUND`; a type whose current definition fails the shared validator (a service removed
  from the business is impossible today, spec 037) → 422 with the validator's named code. [M11]
- **SA-08b** The manager edits «سشوار ×10» (price 25.000 → 27.500, revision 1 → 2) while منى's sale screen still shows
  revision 1, and she sells with `expected_type_revision 1`. The two race on the type row lock (FR-018b); two real
  connections test both orders:
  - **edit first:** the edit commits revision 2; the sale, rechecking under its `FOR SHARE` lock, gets 409
    `PACKAGE_TYPE_REVISION_CONFLICT` with `current_revision 2`, nothing written; after reloading she sells revision 2.
  - **sale first:** the sale commits with the revision-1 snapshot (price 25.000, its components and validity); the
    edit waits for the lock, then commits revision 2, and the sold package keeps its revision-1 values (PT-Q4).
- **SA-08c** منى's screen shows «العروس» with سشوار at 3.000 (service revision 4); a manager edits سشوار to 3.500
  (revision 5). Two real connections, both orders: **edit first** → the sale, comparing under its service `FOR SHARE`
  locks, gets 409 `PACKAGE_SALE_QUOTE_STALE` with the current revisions and nothing is written; after reloading she
  sees 3.500 and sells on it. **Sale first** → the edit waits, and the sold components and slots keep the 3.000
  weights she confirmed. Never a sale valued on prices other than the ones the screen showed.
- **SA-09** Same key, same body, same actor → the original 201 replays, no second entitlement or slot [M10]; changed
  body or actor → 422 `IDEMPOTENCY_KEY_REUSED`.
- **SA-10** A type of 20 components × 365 sessions (7,300 slots) sells inside the 200 ms budget with one multi-row insert
  per table (measured in 42-3; above budget the sale stops and the PR comes back here).
- **SA-11** Without `sell:packages:branch` (PK-Q13), a device, or the `orders` feature off → 403 /
  `FEATURE_DISABLED`, nothing written.
- **SA-12** A default cashier (and a branch manager) holds `sell:packages:branch` but not
  `read:package-types:business`: the sale picker (FR-072) still loads, listing only the business's types whose selling is
  not stopped, each with its `revision`, price, validity and components; a stopped type and another business's type are
  absent. Without `sell:packages:branch` at that branch, a device, or the `orders` feature off → 403 /
  `FEATURE_DISABLED` on the picker too.

### Story 3 — Redeem a session (43, P1)

- **RD-01** منى records نورة's visit with one draft `{ service سشوار, package: { entitlement_id }, performers [سارة] }`.
  In the visit's transaction: the component row is locked, slot 1 (lowest `FREE`) becomes `USED` with
  `current_redemption_id`, one `package_redemptions` row, one line with `list_price = price = net = 2.250`,
  `discount 0`, `effective_discount_bps 0`, `redemption_id` set; the line inside `ServiceSessionRecorded` carries
  `package { entitlement_id, component_id, ordinal: 1 }`.
- **RD-02** A visit mixing a paid colour line and a package سشوار line saves in one request; the same works through the
  append route on an existing visit. Two drafts for the same component in one request take ordinals *k* and *k+1*.
- **RD-03** Two concurrent visits redeem the last free slot: exactly one commits, the other → 409
  `PACKAGE_NO_FREE_SESSION` and its whole visit request rolls back (TD-2). [M5]
- **RD-04** (`TODO(spec)` PK-Q7) A visit on 30 December redeems; one on 31 December → 422 `PACKAGE_EXPIRED`; a visit of
  29 December recorded on 2 January (inside the window) redeems. A visit that occurred before the sale instant → 422
  `PACKAGE_NOT_YET_VALID`. [M7]
- **RD-04b** Cross-timezone: sold at 00:10 on 2 October in a Kuwait branch (`sold_business_date` 2 October); a
  visit five minutes later at a branch whose own timezone is `Europe/London` (still 1 October there) redeems; a visit
  five minutes **before** the sale instant is refused `PACKAGE_NOT_YET_VALID`, whatever either local date says.
- **RD-05** The entitlement belongs to another customer, another business, another company, or the draft's service is
  not one of its components → 422 `PACKAGE_NOT_USABLE_HERE`, one answer for all (no existence oracle).
- **RD-06** A package draft carrying a price or a discount → 400 by the strict contract; the redemption line never
  counts as a discount and never needs an approval. [M13]
- **RD-07** The recording rules hold unchanged: performers 1…4 with SS-Q7 shares, eligibility and SS-Q8 warnings, the
  SS-Q2 self rule, the 20-line cap and the recovery proof.
- **RD-08** A lost response retried with the same key → the original 201, no second slot. [M10]
- **RD-09** A refunded or `IMPORTED_USED` slot is never taken; a component with only such slots → `PACKAGE_NO_FREE_SESSION`.

### Story 4 — Cancel a redeemed session (44, P1)

- **RC-01** (`TODO(spec)` PK-Q6) ليلى cancels نورة's second visit line through the 054 route with a reason. In 054's
  transaction: the line is `CANCELLED`, the 054 history row, bell and mark exist as for any line; the redemption gets
  `reversed_at`; slot 2 goes `USED → FREE`; `ServiceLineChanged` (`LINE_CANCELLED`) carries the `package` block. [M8]
- **RC-02** The next redemption of that component takes ordinal 2 (lowest free), not 4. [M8]
- **RC-03** A same-key replay of a committed cancel returns the **stored original response** (054's idempotent
  replay) and runs nothing again: no reversal is attempted and no error is returned. [M10]
- **RC-03b** A **new** cancel attempt that finds the redemption already reversed, or its slot no longer `USED` by it
  (a stale state, impossible while CX-Q5 holds, so the test forces it in the database), reverses nothing: the
  conditional `UPDATE`s touch 0 rows and the whole request rolls back with 409 `PACKAGE_REDEMPTION_ALREADY_REVERSED`.
- **RC-04** All 054 rules apply unchanged: permission, recording window, self rule, tip guard (CX-Q4), finality (CX-Q5),
  and an approved month becomes a correction through row 50/55.
- **RC-05** Cancelling a redeemed line of an entitlement that has since expired frees the slot all the same; it can be
  used again only after an extension.
- **RC-06** A price edit (35d) of a redeemed line → 422 `SESSION_LINE_PRICE_NOT_EDITABLE`, nothing written.
- **RC-06b** A cancel that sets a redeemed line `CANCELLED` but omits the package updates (the redemption not
  reversed, or reversed but its slot still `USED` by it) → the commit is refused; the line stays `ACTIVE` and nothing
  is written.
- **RC-07** (`TODO(spec)` PK-Q8) A performer change (055) of a redeemed line follows the 055 rules; the slot, the value
  and the redemption do not move.

### Story 5 — Extend (45, P2)

- **EX-01** (PK-Q16) ليلى extends نورة's package from 30 December to 31 January with a reason and
  `expected_expires_on 2026-12-30`: one `package_extensions` row (before, after, who, membership, when, reason), the
  entitlement's `expires_on` updated, one audit entry `package.extended`. No event (TD-7).
- **EX-02** A new date not later than the current one → 422 `PACKAGE_EXTENSION_NOT_LATER`; later than today plus two
  calendar years (from 21 October 2026: 21 October 2028 accepted, 22 October refused; from 29 February the cap is 28
  February) → 422 `PACKAGE_EXTENSION_TOO_LONG`; stale `expected_expires_on` → 409 `PACKAGE_EXPIRY_STALE`.
- **EX-03** An expired package can be extended; after it, redemption and refund work again. [M7]
- **EX-04** (`TODO(spec)` PK-Q1) The request carries no amount; nothing about money changes.
- **EX-05** Without the permission, a device, or the feature off → 403; an imported package extends like a sold one.

### Story 6 — Refund (46, P1)

- **RF-01** ليلى refunds 8 sessions of the سشوار component of نورة's package (slots 1 and 3 used): entitlement locked,
  then the component; slots 2 and 4…10 → `REFUNDED`; one refund row (component, ordinals 10…4 and 2, amount 18.000,
  method, reason, who); `refunded_amount 18.000`, `revision 2`; one `PackageSaleChanged` (`revision 2`,
  `refunded_amount 18.000`, the sale's `branch_id` and `business_date` unchanged); one audit entry `package.refunded`; the bell (PK-Q5). From the same state, a refund of 5
  instead takes the highest free ordinals, 10…6, for 11.250 (5 × 2.250) (unit). [M6]
- **RF-02** 9 requested while 8 are free → 422 `INSUFFICIENT_SLOTS`, nothing refunded. [M14]
- **RF-03** Refund vs redemption of the last free slot, concurrently: they serialize on the component; whichever commits
  first wins, the other fails by name; totals stay exact. [M6]
- **RF-04** Two refunds of different components of «العروس» concurrently: they serialize on the entitlement; the final
  `PackageSaleChanged` carries both amounts in `refunded_amount`, revision 3. [M9]
- **RF-05** Duplicate refund with the same key → the original 201, nothing more. [M6, M10]
- **RF-06** After the expiry day → 422 `PACKAGE_EXPIRED` until extended (D-51). [M7]
- **RF-07** Count 0, negative or fractional → 400 by the contract; a component of another entitlement → 422
  `PACKAGE_COMPONENT_NOT_FOUND`.
- **RF-08** (`TODO(spec)` PK-Q10) An imported package refunds by the same rules and emits no `PackageSaleChanged`.
- **RF-09** A zero-value package refunds slots worth 0.000 with amount 0.000 (spec 007 edge case).
- **RF-09b** The refund-integrity check (§6) refuses, at commit, a refund written directly in the database with a slot
  of another component, a wrong copied value, a session count or amount that does not match its slots, or an
  entitlement whose `refunded_amount` moved by a different amount; nothing is committed in each case.
- **RF-10** Without `refund:packages:branch` (`TODO(spec)` PK-Q5) at the acting branch, a device, or the `orders` feature
  off → 403 / `FEATURE_DISABLED`; an entitlement of another business or company → the same 404 `PACKAGE_NOT_FOUND` as
  an unknown id; nothing written.

### Story 7 — Import open packages (47, P1)

- **IM-01** A holder of `manage:package-types:business` (PK-Q18, PP-16.7) downloads the template, uploads a workbook,
  previews: each row has customer phone, package name (en, optional ar), price paid, services with original and
  remaining sessions, expiry date, `external_ref`. Per-row errors are named; the phone shows its last 3 digits only.
- **IM-02** A clean preview commits all rows in one worker transaction (spec 030 IM-03…IM-05): per row one entitlement
  `IMPORTED` with no seller, components valued over the **original** sessions, weighted by each service's price at the
  original sale when the row gives it, else today's service price, as `list_price_snapshot` (`TODO(spec)` PK-Q22), slots `1…used` `IMPORTED_USED` and the rest `FREE`; one audit entry per commit. [M11]
- **IM-03** An `external_ref` already imported → the row is a no-op on re-import (reported "already imported"); twice
  in one file → row error.
- **IM-04** Remaining > original, sessions 0 or > 365, a duplicate service, a negative or 4-decimal price, an unknown
  service of the business, an invalid date → named row errors; one invalid row saves nothing. [M11]
- **IM-04b** A business with two services named «مساج»: a row whose group names «مساج» → row error
  `IMPORT_SERVICE_AMBIGUOUS` naming that group, nothing saved; after one service is renamed, the same file previews
  clean and the component takes the remaining «مساج» service (FR-063b).
- **IM-05** (PK-Q20, PP-16.9) A phone with no customer in the company → row error `IMPORT_CUSTOMER_NOT_FOUND`.
- **IM-06** (PK-Q21) A past expiry date is accepted; the package is expired until extended.
- **IM-07** Imported packages redeem, cancel, extend and refund like sold ones; they never emit `PackageSaleChanged`.
- **IM-08** Without `manage:package-types:business` (PK-Q18), a device, or the `orders` feature off → 403 /
  `FEATURE_DISABLED` on the template, the preview and the commit; a preview of another business or company answers
  like an unknown one (spec 030 IM-06); nothing written.
- **IM-09** A workbook filled to the full template (six base columns and all 20 service groups, 86 columns) passes the
  reader and reaches the package plug-in; a workbook wider than the package bound (88 columns) → `IMPORT_FILE_CONTENT_INVALID`;
  the employee import still refuses a workbook wider than its own 8 columns (FR-060b). A package workbook of exactly
  500 data rows previews; 501 → `IMPORT_ROW_LIMIT_EXCEEDED`.

### Story 8 — A customer's packages (42-4, P1)

- **CP-01** (PK-Q17, PP-16.6) Reception opens نورة's packages in the business: each with name, expiry, price paid,
  per service the remaining, used and refunded counts and slot values, and the detail with its history (redemptions,
  extensions, refunds); a holder of `read:service-sessions:branch` sees exactly the same. Expired and fully used
  packages are listed last, marked. No package read carries the customer's phone.
- **CP-02** Another business's or company's packages never appear; a foreign customer id answers like unknown.
- **CP-03** Both routes are guarded by `RequireAny(['record:service-sessions:branch', 'read:service-sessions:branch'],
  { branch })` (TD-13). A holder of `record:service-sessions:branch` only (reception's default) and a holder of
  `read:service-sessions:branch` only each get 200 with the full list and detail (PK-Q17); a caller with neither at the
  branch, a device, or the feature off → 403 on both.

### Edge cases

- A package of price 0.000: every slot is 0.000; its performers earn nothing on it (PT-Q7); its refund amount is 0.000.
- A redemption in a branch other than the sale's branch is allowed (PT-Q10).
- A customer holding two packages with the same service: the draft names the entitlement (PK-Q15); there is no automatic
  choice in the server.
- A redeemed line on a visit whose month is approved, then cancelled: the slot is freed now; the commission correction
  is row 50/55's (SPEC §6).
- The deferred FKs between `service_lines.redemption_id` and `package_redemptions.line_id`, and the redemption-line
  integrity trigger, are checked at commit; a half-written, crossed or mispriced pair cannot commit.
- `numeric(14,3)` bounds hold for every sum; a sale price above the bound is refused by the contract.

## 5. Requirements

### 33b — stop / resume selling

- **FR-001** `POST /v1/businesses/{businessId}/package-types/{packageTypeId}/stop-selling` and `/resume-selling`, body
  `{ expected_revision }`, guard `manage:package-types:business` (PK-Q12, PP-16.1), `catalog` feature; 200 with
  `PackageTypeDetail` (now with `selling_stopped_at`).
- **FR-002** One transaction: row `FOR UPDATE`, compare-and-set on `revision`, set or clear `selling_stopped_at`, audit
  entry with before/after. No event (spec 037 TD-3).
- **FR-003** The flag affects only new sales (42) and the sale picker. Redemption, extension, refund, the import
  (which names no type, PK-Q19) and type edits ignore it.

### 42 — sell

- **FR-010** `POST /v1/businesses/{businessId}/branches/{branchId}/package-sales`, body
  `{ customer_id, package_type_id, expected_type_revision, expected_service_revisions, price_paid, paid_method,
  seller_employee_id, sold_at?, recorder_membership_id? }`: `expected_type_revision` and `expected_service_revisions`
  (`[{ service_id, revision }]`, one per component service) are the quote the picker showed (FR-072), so the sale is
  valued on exactly the prices reception confirmed (FR-018c);
  201 `{ entitlement }`. The entitlement is the sale (TD-1).
- **FR-011** Guard `sell:packages:branch` (PK-Q13) and the `orders` feature, individual admin login, rechecked
  inside the transaction after waits (the 050 pattern).
- **FR-012** (`TODO(spec)` PK-Q2) `price_paid ≥ 0`, any amount within `numeric(14,3)`, even above the type price;
  `discount = max(type price − price_paid, 0)`; `discount_bps = ceil(discount × 10000 / type price)`, 0 at a type price
  of 0 (050 FR-008).
- **FR-013** (`TODO(spec)` PK-Q2) The recorder's limit is read through the existing `DiscountLimitPort` for the verified
  recorder membership (050 FR-007); above it → refused (`PACKAGE_SALE_DISCOUNT_ABOVE_LIMIT`). Rows 38–41 later add the
  approval path to the sale exactly as to a line.
- **FR-014** (`TODO(spec)` PK-Q3) The seller is required, eligible at the sale date (`PerformerCheckPort`), and not linked to
  the recorder's user (snapshot of the link stored on the entitlement, as performers are, ADR-0045). The sale calls
  `PerformerCheckPort.lock([seller])` **before** `read`, as the visit writer does, so a concurrent detach, deactivation
  or relink of the seller either commits first (and the sale sees it) or waits for the sale's commit.
- **FR-015** (`TODO(spec)` PK-Q4) `paid_method ∈ {CASH, CARD}`, stored; no payment is captured (Phase 2).
- **FR-016** (`TODO(spec)` PK-Q11) `sold_at` default now, editable within 050 FR-014's window; `sold_business_date` (local to the selling branch, TD-4)
  and `sold_timezone` stored; `late` stored like a visit's.
- **FR-017** (`TODO(spec)` PK-Q23) The type and components are read through `CatalogReaderPort` (TD-10) as they are when
  the sale is **recorded**, even for a back-dated `sold_at` (FR-016), and the sale screen shows exactly those prices
  before saving; the catalog keeps no price history, so nothing older is recovered. The definition passes the shared
  validator (`validatePackageDefinition`); `allocatePackagePrice` and `createPackageSlots` produce the components and
  slots; `expires_on = sold_business_date + validity_days` (spec 037 BR-004). No arithmetic in the use case.
- **FR-018** One transaction: idempotency claim (`sell-package`, COMPANY scope, actor-bound fingerprint as 050 §8) →
  access lock → **type row `FOR SHARE`** (FR-018b) → **component services `FOR SHARE`** in ascending id (FR-018c) →
  **seller lock** (`PerformerCheckPort.lock`, FR-014) → read type, service prices, customer, seller, limit → domain → insert entitlement, components, slots → audit → emit
  `PackageSaleChanged` (TD-7's payload, `branch_id` and `business_date` included) → store the 201.
- **FR-018b** The sale locks the package type row `FOR SHARE` through a catalog-owned public lock function behind
  `CatalogReaderPort` (TD-10), and reads `selling_stopped_at`, the price and the components **after** the lock, so
  stop/resume (FR-002, `FOR UPDATE`) and type edits serialize with the sale. `package_types` already has column
  `UPDATE` grants (spec 037), which PostgreSQL requires for a row lock. Under the lock, in this order: a stopped type →
  422 `PACKAGE_TYPE_NOT_SELLABLE`; then `revision ≠ expected_type_revision` → 409 `PACKAGE_TYPE_REVISION_CONFLICT`
  (spec 037's code, with `details.current_revision`), so the customer is never sold a definition other than the one
  reception showed her.
- **FR-018c** After the type lock, the sale locks the type's component `services` rows `FOR SHARE` in ascending id,
  through the catalog's session-services reader (`session-services.reader.ts`, the lock-only read the visit writer
  already uses) behind `CatalogReaderPort`, and reads the services' list prices **after** those locks. A service price
  edit holds the row `FOR UPDATE` (`drizzle-service-transactions.ts`), so it either commits before the sale reads (and
  the revision check below refuses the sale) or waits for the sale's commit; the weights of `allocatePackagePrice` never
  come from a price that lost the race. Under those locks the sale then compares each service's `revision` with
  `expected_service_revisions` (a service edit, price included, raises its revision; spec 031): any difference, or a
  service set that is not exactly the type's components → 409 `PACKAGE_SALE_QUOTE_STALE` with
  `details.current_service_revisions`, nothing written, so reception reloads, sees the new prices and confirms again.
- **FR-019** `ServiceSessionRecorded` is not involved: a sale is not a visit and adds no line.
- **FR-019b** The sale picker has its own read, so selling never needs `read:package-types:business` (a managers-only
  permission that cashiers and branch managers lack): FR-072.

### 43 — redeem

- **FR-020** The record and append bodies (050 §8) accept a second draft kind `{ service_id, package: { entitlement_id },
  performers }` (strict union; no `price`, no `discount`). Guard and permission are the visit's
  (`record:service-sessions:branch`, PK-Q14).
- **FR-021** The draft names its entitlement (PK-Q15); the server never picks one.
- **FR-022** Lock order inside the visit transaction (TD-5): after the visit lock, every named component `FOR UPDATE`
  in ascending id; per draft, in input order, `selectPackageRedemptionSlot` takes the lowest `FREE`.
- **FR-023** The entitlement must belong to the visit's customer and business, and contain the draft's service;
  otherwise `PACKAGE_NOT_USABLE_HERE` (RD-05).
- **FR-024** (`TODO(spec)` PK-Q7, TD-4) `assertPackageNotExpired(visitLocalDate, expires_on)`, where
  `visitLocalDate` is the visit's `occurred_at` in the serving branch's effective timezone; and
  the visit's `occurred_at ≥ sold_at`, compared as **instants** (imports: no lower bound), else `PACKAGE_NOT_YET_VALID`.
  Comparing local dates would mix the selling branch's timezone with the serving branch's (TD-4).
- **FR-025** The line: `list_price = price = net = unit_value`, `discount 0`, `effective_discount_bps 0`, the catalog
  snapshot of the service at recording time (names, revision, rule, threshold flag) like any line, `redemption_id` set.
  The applied-limit columns record the recorder's limit as for any line; the discount check never fires (0 bps).
- **FR-026** Write order: first one `package_redemptions` row `{ slot, component, entitlement, line, redeemed_at =
  recorded_at, recorded_by, membership }`, then the slot `FREE → USED` with `current_redemption_id` = that row. The
  check that the redemption is live and matches the slot is deferred all the same (§6 *Immediate vs deferred*), so a
  different order can never pass it wrongly or fail it falsely.
- **FR-027** The line snapshot in `ServiceSessionRecorded` / `ServiceSessionLinesAdded` carries `package
  { entitlement_id, component_id, ordinal }` (TD-8). Row 50 projects the line on its `net` like any line (SPEC §5.2).

### 44 — cancel a redeemed line

- **FR-030** (`TODO(spec)` PK-Q6) The 054 route and permission cancel a redeemed line; every 054 requirement holds.
- **FR-031** After 054's checks and before the status change, the transaction locks the line's component `FOR UPDATE`
  (TD-5), then `UPDATE package_redemptions SET reversed_at, reversal_cancellation_id WHERE id = :r AND reversed_at IS
  NULL` and `UPDATE package_session_slots SET state 'FREE', current_redemption_id NULL WHERE id = :s AND state 'USED' AND
  current_redemption_id = :r`; both must touch exactly one row, else the whole cancel rolls back with
  `PACKAGE_REDEMPTION_ALREADY_REVERSED` (cannot happen while CX-Q5 holds; it is the database guarantee).
- **FR-032** 054 D-6's refusal of package lines is removed for redeemed lines; `SESSION_LINE_NOT_CANCELLABLE` stays
  reserved (TD-1: no sale line exists).
- **FR-033** The cancel's `ServiceLineChanged` carries the line's `package` block; the 054 bell and mark are unchanged.
- **FR-034** The 35d price-edit writer refuses a line with `redemption_id` → 422 `SESSION_LINE_PRICE_NOT_EDITABLE`
  (SPEC §4/§8: its price is the slot value; an edit would break the conservation of the price paid).
- **FR-035** (`TODO(spec)` PK-Q8) The 055 writer accepts a redeemed line under its own rules, touching no package row;
  `SESSION_LINE_PERFORMERS_NOT_CHANGEABLE` stays reserved for the "no" answer.

### 45 — extend

- **FR-040** `POST /v1/businesses/{businessId}/branches/{branchId}/packages/{entitlementId}/extensions`, body
  `{ new_expires_on, expected_expires_on, reason }`, Idempotency-Key (`extend-package`); guard `extend:packages:branch`
  (PK-Q16) on the acting branch; the entitlement must belong to the branch's business.
- **FR-041** `new_expires_on > expires_on` and `≤` today plus two calendar years (a pure domain function; 29 February
  → 28 February), "today" local to the acting branch (TD-4); `expected_expires_on` equals the
  stored value (compare-and-set). Reason trimmed 1…500 characters (the 054 rule).
- **FR-042** Entitlement `FOR UPDATE` → extension row → `UPDATE expires_on` (an immediate trigger refuses any
  decrease; a deferred one requires the matching extension row, §6) → audit.
- **FR-043** (`TODO(spec)` PK-Q1) No amount, no payment, no slot or value change, no event (TD-7).
- **FR-044** The reason lives in the extension row only, never in the audit entry, an event or a log (054 D-8 rule).

### 46 — refund

- **FR-050** `POST …/branches/{branchId}/packages/{entitlementId}/refunds`, body `{ component_id, sessions, method, reason }`,
  Idempotency-Key (`refund-package`); guard `refund:packages:branch` (`TODO(spec)` PK-Q5).
- **FR-051** Entitlement `FOR UPDATE` → component `FOR UPDATE` (SPEC §8); `assertPackageNotExpired(today, expires_on)` with "today" local to the acting branch (TD-4);
  `selectPackageRefundSlots(slots, sessions)` → exact or `INSUFFICIENT_SLOTS`.
- **FR-052** Slots → `REFUNDED`; one refund row and one `package_refund_slots` row per ordinal (ordinal, unit value);
  `amount = Σ unit_value`; `refunded_amount += amount`, `revision += 1` on the entitlement; audit; for `SOLD`,
  `PackageSaleChanged` with the committed snapshot (TD-7).
- **FR-053** (`TODO(spec)` PK-Q10) `IMPORTED` entitlements refund by the same rules, with no event.
- **FR-054** (`TODO(spec)` PK-Q4) `method ∈ {CASH, CARD}` stored on the refund; no payment is executed (Phase 2).
- **FR-055** (`TODO(spec)` PK-Q5) Reason 1…500 trimmed, stored on the refund row only.
- **FR-056** (`TODO(spec)` PK-Q5) A bell to the branch's four scoped manager roles, the refunder included, through an
  orders worker consumer of a new orders event `PackageRefundRecorded` and a notice event to `notifications`, the 35d /
  054 pattern (ledger row per refund, zero recipients is a durable decision). Content: package name, sessions, amount,
  branch, date; never the reason, the customer's phone or name.
- **FR-057** Refunded slots are never selected again (`selectPackageRedemptionSlot` takes `FREE` only; the trigger
  refuses `REFUNDED → *`).

### 47 — import

- **FR-060** The spec 030 framework, reused and not duplicated: the shared `import-sheet.ts` reader, the shared
  `import_previews` table (`entity = 'packages'`), API shape and UI shell, plus a package row plug-in; template download,
  upload through `files`, preview, single-use preview committed by a worker job in one transaction (above 200 ms),
  2 MiB / 500 rows. Guard `manage:package-types:business` (PK-Q18, PP-16.7: no new import permission).
- **FR-060b** The workbook reader takes its bounds from the plug-in. Today `readWorkbookMatrix`
  (`apps/api/src/modules/staff/persistence/xlsx-sheet-reader.ts`) caps the zip guard at the employee header count + 2
  columns (8) and throws `EmployeeImportError`, so a package workbook would fail as `IMPORT_FILE_CONTENT_INVALID` before
  its plug-in runs. 47-1 moves it to `apps/api/src/shared/import/` as `readWorkbookMatrix(bytes, bounds)` with
  `bounds = { maxBytes, maxDataRows, maxColumns, maxWorksheets }` and a shared error carrying the same spec 030 codes
  (`IMPORT_FILE_CONTENT_INVALID`, `IMPORT_ROW_LIMIT_EXCEEDED`). `maxDataRows` counts data rows only; the reader itself
  gives the zip guard `maxDataRows + 2` (the header and one spare row, as the staff reader does today) and refuses more
  than `maxDataRows` data rows with `IMPORT_ROW_LIMIT_EXCEEDED`. Staff passes its current bounds unchanged; packages pass
  2 MiB, 500 data rows and `6 + 20 × 4 + 2 = 88` columns (FR-061's six base columns, 20 service groups of four, the same
  two-column margin).
- **FR-061** One row = one package; columns: customer phone, package name en (ar optional), price paid, expiry date,
  `external_ref`, then up to 20 groups of (service name, original sessions, remaining sessions, optional price at the original sale —
  PK-Q22).
- **FR-062** (PK-Q19) No package type is named; `package_type_id` is `NULL` for `IMPORTED`; the names are
  stored on the entitlement.
- **FR-063** (`TODO(spec)` PK-Q9, PK-Q22) `price_paid` is the amount actually paid, required, `≥ 0`; components are
  valued by `allocatePackagePrice` over the **original** sessions, with `list_price_snapshot` = the service's price at
  the original sale when the row gives it (an optional column per service group), else its current list price;
  `createPackageSlots(…, remaining)` marks ordinals `1…original − remaining` `IMPORTED_USED`.
- **FR-063b** Each group's service name is matched, trimmed and case-insensitive, against the `name_en` and `name_ar`
  of the business's services (031 allows duplicate names, SV-02). No match → the unknown-service row error (IM-04);
  more than one distinct service matching → row error `IMPORT_SERVICE_AMBIGUOUS` naming the group, and the file saves
  nothing. The workbook carries no service id; the owner gives the services distinct names (031 allows renaming) and
  uploads again.
- **FR-064** (PK-Q20, PP-16.9) The phone is resolved through `CustomerLookupPort.findByPhone` (TD-11); unknown → row
  error.
- **FR-065** (PK-Q21) Any valid expiry date is accepted, past included; `sold_business_date` is `NULL` and
  RD's "not yet valid" check does not apply.
- **FR-066** `external_ref` 1…100 characters, unique per company (`UNIQUE (company_id, external_ref)`); an existing one is
  skipped at commit and reported; the commit is idempotent (`import-packages`).
- **FR-067** No seller, no paid method, no `PackageSaleChanged` (TD-7).
- **FR-068** Every rejection reuses the shared validator's codes plus `IMPORT_*` row codes (spec 030).

### Reads

- **FR-070** (PK-Q17, PP-16.6) `GET …/branches/{branchId}/customers/{customerId}/packages` under
  `record:service-sessions:branch` **or** `read:service-sessions:branch` (one `RequireAny` guard, TD-13), one projection for both: per entitlement name,
  expiry, expired flag, price paid, refunded amount, and per component remaining / used / refunded counts and slot
  values. The customer's phone is never part of it (CLAUDE.md §8). A `queries/` file: read-only, no `domain/` import, result-shape test and `EXPLAIN`.
- **FR-071** `GET …/packages/{entitlementId}` under `record:service-sessions:branch` **or** `read:service-sessions:branch`
  (the same `RequireAny` guard, TD-13; PK-Q17): the sale facts and components
  (42-4); each history section is added by the sub-PR that creates its table (redemptions with their visit dates in
  43-3, extensions in 45, refunds in 46-3), so no query reads a table that is not yet migrated.
- **FR-072** (PK-Q13) `GET /v1/businesses/{businessId}/branches/{branchId}/sellable-package-types` under
  **`sell:packages:branch`** at that branch and the `orders` feature (the sale's own gate, FR-011), never
  `read:package-types:business`. It lists the business's package types with `selling_stopped_at IS NULL`, each with
  `id`, `revision` (sent back as `expected_type_revision`, FR-010), names, price, `validity_days` and the components
  (service names, sessions, and the quote fields below). A catalog-owned `queries/` file (the catalog owns `package_types`), cursor-paginated:
  read-only, no `domain/` import, result-shape test and `EXPLAIN`. The admin package-type list keeps its own guard.
  Each component also carries its `service_id`, the service's current `revision` and list price: the quote the sale
  sends back as `expected_service_revisions` (FR-010, FR-018c).

## 6. Slice design

### Business rules

- **BR-01** Conservation: Σ slot values = Σ component values = `price_paid`, to the mill, for every sale and import
  (spec 007 SC-001), enforced at commit by the entitlement value-conservation trigger (§6); nothing in rows 43–47
  changes a slot's value.
- **BR-02** A slot is in exactly one state; only the TD-5b transitions exist. A slot is created `FREE` with no
  redemption; an imported component's ordinals `1…used` are created `IMPORTED_USED` and the rest `FREE` (§6).
- **BR-03** `refunded_amount` = Σ refund amounts of the entitlement and never exceeds `price_paid`; `revision` = 1 + the
  number of refunds. An entitlement is created with `refunded_amount = 0` and `revision = 1`; the entitlement's
  `BEFORE INSERT` trigger refuses any other starting value (§6).
- **BR-04** `expires_on` only moves later.
- **BR-05** A redeemed line's money is the slot's value and never changes (FR-034).
- **BR-06** Orders reads no statement status; corrections are rows 50/55's (054 D-5, 055 D-6).

### Schema changes

All tables: PK `(company_id, id)` (UUID v7, ADR-0007) **and** a candidate key `UNIQUE (company_id, business_id, id)` on
every table that a business-qualified FK references (entitlements, components, slots, redemptions, refunds; the
catalog pattern), `business_id`, `ENABLE` + `FORCE` RLS with `USING` and `WITH CHECK
company_id = app_company_id()`, tenant-and-business-qualified FKs, a negative isolation test (cross-tenant read = 0
rows, write refused), money `numeric(14,3)`, indexes for every FK and RLS predicate (CLAUDE.md §5).

**Immediate vs deferred checks.** A check on one row (one-way columns, allowed slot transitions, `expires_on` only
later) is an immediate `BEFORE UPDATE` trigger. A check that needs another row written in the same transaction —
a `FREE → USED` slot needs a live redemption of that very slot, a `USED → FREE` slot needs its reversed redemption, a
`FREE → REFUNDED` slot needs its refund slot row, an entitlement `revision` +1 needs its refund row, a changed
`expires_on` needs its extension row, a redemption reversal needs its 054 cancellation row, a redemption and its line
need each other (redemption-line integrity, below), a redemption and its slot need each other (redemption-slot
integrity, below) — is a `CONSTRAINT TRIGGER …
DEFERRABLE INITIALLY DEFERRED` checked at commit, so the use cases' write order never fails a correct transaction.

| Table | Columns (beyond the common ones) | Grants / triggers | Keys and indexes |
|---|---|---|---|
| `package_types` (33b) | `selling_stopped_at timestamptz NULL` | column `UPDATE` grant gains it | — |
| `package_entitlements` (42) | `customer_id`, `package_type_id NULL`, `provenance` (`SOLD`/`IMPORTED`), `name_en`, `name_ar`, `validity_days NULL`, `list_price NULL`, `price_paid`, `discount NULL`, `discount_bps NULL`, `paid_method NULL`, `seller_employee_id NULL`, `seller_linked_user_id NULL`, `sold_branch_id NULL`, `sold_at NULL`, `sold_business_date NULL`, `sold_timezone NULL`, `late`, `recorded_by`, `recorded_by_membership_id`, `external_ref NULL`, `import_id NULL`, `expires_on date`, `refunded_amount default 0`, `revision default 1`, `created_at`, and five trigger-owned columns no caller writes (a `BEFORE` trigger overwrites whatever an `INSERT` or `UPDATE` supplies): the creation seal `created_system_id bigint` and `created_txid xid8` (the creating cluster and transaction, ADR-0050's pair, 42-2), and `expires_on_changed_system_id bigint NULL`, `expires_on_changed_txid xid8 NULL` and `expires_on_before date NULL` (the cluster, the transaction and the old value of the last `expires_on` change, the same pair, 45) | `SELECT, INSERT`, `UPDATE (expires_on, refunded_amount, revision)`; immediate trigger: `expires_on` only increases and at most once per transaction (it records `expires_on_changed_system_id`, `expires_on_changed_txid` and `expires_on_before`, and "this transaction" means the pair `(pospay_system_id(), pg_current_xact_id())`), `refunded_amount` only increases and `≤ price_paid`; deferred triggers: `revision` +1 exactly with a refund row of the same transaction, and every change of `expires_on` paired with a `package_extensions` row of the same transaction for the same entitlement whose `previous_expires_on` and `new_expires_on` equal the old and new values (no `expires_on` change without its extension row); `CHECK`s: `SOLD` ⇒ type, seller, method, branch, sold fields NOT NULL and `external_ref` NULL; `IMPORTED` ⇒ seller, method NULL and `external_ref`, `import_id` NOT NULL; `SOLD` ⇒ `import_id` NULL; money never negative: `price_paid ≥ 0`, `list_price ≥ 0` and `discount ≥ 0` when present, `refunded_amount ≥ 0`; immediate `BEFORE INSERT` trigger: a non-NULL `import_id` names a preview whose `entity = 'packages'`, and an insert whose `refunded_amount ≠ 0` or `revision ≠ 1` is refused (never overwritten, so a writer bug surfaces), whatever the writer supplies (BR-03); deferred entitlement value-conservation trigger (below) on insert of an entitlement (once per entitlement) | `UNIQUE (company_id, business_id, id)`; `UNIQUE (company_id, external_ref)`; index `(company_id, business_id, customer_id, expires_on)` for the customer read; partial index `(company_id, business_id, import_id) WHERE import_id IS NOT NULL` for the import FK; FKs to customers, package types, employees, branches, memberships, and `(company_id, business_id, import_id)` → the shared `import_previews (company_id, business_id, id)`, so an imported entitlement can never name another business's preview |
| `package_components` (42) | `entitlement_id`, `service_id`, `position 1…20`, `name_en`, `name_ar`, `list_price_snapshot`, `sessions_total 1…365`, `component_value` | `SELECT, INSERT`, and `UPDATE (lock_touch)` only: PostgreSQL needs an `UPDATE` privilege on one column for `SELECT … FOR UPDATE`. `lock_touch smallint NOT NULL DEFAULT 0` is never written, and a `BEFORE UPDATE` trigger refuses every update, so the row stays immutable. `CHECK`s: `list_price_snapshot ≥ 0`, `component_value ≥ 0`. Composition seal (ADR-0050): a statement-level `AFTER INSERT` trigger over the inserted rows reads `pospay_system_id()` once and refuses a component whose entitlement's `(created_system_id, created_txid)` is not `(pospay_system_id(), pg_current_xact_id())`. Locked `FOR UPDATE` by redemption, cancel and refund; the lock is tested as `pospay_app` | `UNIQUE (company_id, business_id, id)`, `UNIQUE (company_id, entitlement_id, service_id)`, `UNIQUE (company_id, entitlement_id, position)`, `UNIQUE (company_id, entitlement_id, id)` (the target of the slots' composite FK); FKs entitlement, service |
| `package_session_slots` (42) | `component_id`, `entitlement_id`, `ordinal`, `unit_value`, `state`, `current_redemption_id NULL` | `SELECT, INSERT`, `UPDATE (state, current_redemption_id)`; `CHECK (unit_value ≥ 0)`; immediate trigger: TD-5b transitions and `state = 'USED' ⇔ current_redemption_id NOT NULL`; initial state: the slot's composition-seal trigger (below) also refuses a slot with a `current_redemption_id`, and a `state` other than `FREE` when its entitlement is `SOLD`, or other than `FREE` or `IMPORTED_USED` when it is `IMPORTED` (on the entitlement row it already joins); deferred trigger: a `FREE → USED` change needs `current_redemption_id` to name a redemption with `reversed_at IS NULL` and the same `slot_id`, `component_id` and `entitlement_id` (plus a deferred FK `(company_id, business_id, current_redemption_id)` → `package_redemptions`); a `USED → FREE` change needs that redemption reversed in the same transaction; any other change of `current_redemption_id` while the slot stays `USED` is checked the same way at commit (it must name a live redemption of this exact slot, component and entitlement); a `FREE → REFUNDED` change needs its `package_refund_slots` row; composition seal (ADR-0050): the same statement-level `AFTER INSERT` form refuses a slot whose entitlement's `(created_system_id, created_txid)` is not the current pair, reading `pospay_system_id()` once per statement, so a 7,300-slot insert reads it once | `UNIQUE (company_id, business_id, id)`; `UNIQUE (company_id, component_id, ordinal)`; composite FK `(company_id, entitlement_id, component_id)` → `package_components (company_id, entitlement_id, id)`, so a slot's component always belongs to that same entitlement, with its index `(company_id, entitlement_id, component_id)`; partial index on `(company_id, component_id, ordinal) WHERE state = 'FREE'` for the lowest/highest pick |
| `package_redemptions` (43) | `entitlement_id`, `component_id`, `slot_id`, `line_id`, `redeemed_at`, `recorded_by`, `recorded_by_membership_id`, `reversed_at NULL`, `reversal_cancellation_id NULL` | `SELECT, INSERT`, `UPDATE (reversed_at, reversal_cancellation_id)` one-way (an immediate trigger allows only `NULL → value` for both columns together; a **deferred** constraint trigger checks at commit that the cancellation row exists and belongs to the same line); deferred redemption-line integrity trigger (below) on insert; deferred redemption-slot integrity trigger (below) on insert and on the reversal update | `UNIQUE (company_id, business_id, id)`; `UNIQUE (company_id, line_id)`; partial `UNIQUE (company_id, slot_id) WHERE reversed_at IS NULL`; FKs slot, line (`DEFERRABLE INITIALLY DEFERRED`), and `(company_id, reversal_cancellation_id)` → `service_line_cancellations (company_id, id)` `DEFERRABLE INITIALLY DEFERRED`, because FR-031 writes the redemption before the inherited 054 sequence inserts its cancellation row |
| `service_lines` (43) | `redemption_id uuid NULL`, insert-only | no new `UPDATE` grant; deferred redemption-line integrity trigger (below) on insert and on any update of `redemption_id`, `service_id`, `list_price`, `price`, `net`, `discount` or `effective_discount_bps`; deferred redeemed-line cancellation trigger (below) on a status change | deferred FK `(company_id, business_id, redemption_id)` → `package_redemptions`; partial index `WHERE redemption_id IS NOT NULL` |
| `package_refunds` (46) | `entitlement_id`, `component_id`, `branch_id`, `sessions`, `amount`, `method`, `reason`, `refunded_by`, `refunded_by_membership_id`, `refunded_at`, `entitlement_revision` | `SELECT, INSERT`; `CHECK (amount ≥ 0)`; deferred refund-integrity trigger (below) | `UNIQUE (company_id, business_id, id)`; `UNIQUE (company_id, entitlement_id, entitlement_revision)`; FKs |
| `package_refund_slots` (46) | `refund_id`, `entitlement_id`, `component_id`, `slot_id`, `ordinal`, `unit_value` | `SELECT, INSERT`; `CHECK (unit_value ≥ 0)`; deferred refund-integrity trigger (below) | `UNIQUE (company_id, slot_id)` (a slot is refunded once); FKs refund, slot |
| `package_extensions` (45) | `entitlement_id`, `branch_id`, `previous_expires_on`, `new_expires_on`, `reason`, `extended_by`, `extended_by_membership_id`, `extended_at` | `SELECT, INSERT`; `CHECK new > previous`; deferred extension-history trigger (below) on insert | index `(company_id, entitlement_id, extended_at)` |
| `import_previews` (42-2, existing, spec 030) | **no new table**: package previews are rows with `entity = 'packages'` (the framework is shared, spec 030 §Framework); `rows` JSONB holds the resolved `customer_id` and the phone's last 3 digits only, never the full phone (CLAUDE.md §8) | the existing grants | the existing keys **plus** the candidate key `UNIQUE (company_id, business_id, id)` (42-2, built `CONCURRENTLY` as a unique index then attached), which the entitlement's business-qualified import FK references |
| `package_refund_notices` (46-3) | the bell ledger: `refund_id`, `source_event_id`, `decided_at`, `recipient_count ≥ 0` | `SELECT, INSERT` | `UNIQUE (company_id, refund_id)` |

**Refund integrity (deferred, at commit).** For every refund written in the transaction: each of its
`package_refund_slots` rows names a slot of the refund's own entitlement and component (`entitlement_id`,
`component_id` equal on refund, refund slot and slot), its copied `ordinal` and `unit_value` equal the slot's, and the
slot is now `REFUNDED`; `refund.sessions = count(refund slots)` and `refund.amount = Σ unit_value`; the entitlement's
`refunded_amount` grew by exactly `refund.amount` and its `revision` by exactly 1, with
`refund.entitlement_revision` = the new revision. Any mismatch refuses the commit.

**Redemption-line integrity (deferred, at commit).** The two FKs only prove that *some* line and *some* redemption
exist; this check proves they are each other's and that the line carries the slot's money (BR-05). For every redemption
inserted, and every line inserted or updated with `redemption_id`, in the transaction: the line named by
`redemption.line_id` has `redemption_id` = that redemption (and a line's `redemption_id` names a redemption whose
`line_id` is that line), both in the same company and business; the line's `service_id` equals the component's
`service_id`; `list_price = price = net` = the slot's `unit_value`, `discount = 0` and `effective_discount_bps = 0`. Any
mismatch refuses the commit, so a mixed request that pairs the wrong prepared line, or a line priced off the slot, can
never commit, and row 50 and the refunds read the same amount.

**Redemption-slot integrity (deferred, at commit).** The slot trigger fires only when a slot changes, so a write that
inserts a redemption but forgets its slot would pass it. This check runs from the redemption side: for every redemption
inserted in the transaction, its slot (same company, business, entitlement and component) is `USED` with
`current_redemption_id` = that redemption; for every redemption reversed in the transaction (`reversed_at` set), its
slot is no longer held by it: `FREE`, or `USED` by another redemption that is live (`reversed_at IS NULL`). From the
slot side, the slot trigger's deferred check covers every change of `current_redemption_id`, including one that keeps the
slot `USED`, so a slot can never be repointed to a reversed redemption or to another slot's. Any mismatch refuses the
commit, so a slot can never stay `FREE` under a live redemption or stay held by a reversed one.

**Entitlement value conservation (deferred, at commit).** The values an entitlement is created with never change and
drive every refund and performer commission (BR-01, SC-001), so a sale or import write that drops a slot or stores a
wrong value would be wrong forever. A deferred constraint trigger fires on the insert of each `package_entitlements`
row only, never per component or slot, and checks at commit, for that entitlement (sold or imported), in one aggregate
over its components and slots: it has at least one component; each component has exactly `sessions_total` slots whose ordinals are exactly
`1…sessions_total` (smallest 1, largest `sessions_total`, none repeated); its `IMPORTED_USED` slots are exactly the
ordinals `1…k`, `k` being their count (the largest of them equals the count), and `k = 0` when the entitlement is
`SOLD`;
each component's slot `unit_value`s sum to its `component_value`; and the components' `component_value`s sum to the
entitlement's `price_paid`. Any mismatch refuses the commit. `IMPORTED_USED` is terminal and no TD-5b transition
produces it, so the `IMPORTED_USED` set checked at commit is exactly the set inserted. Components and slots are insert-only with immutable value
columns, and the composition seal refuses a component or slot inserted in any transaction other than the one that
created its entitlement, so a later write can never add sessions (not even a `0.000` component of a new service that
keeps every sum true) and checking at creation covers the entitlement's whole life. The seal is ADR-0050's pair: a
`BEFORE INSERT` trigger sets `created_system_id` from `pospay_system_id()` and `created_txid` from
`pg_current_xact_id()`, overwriting any caller value, and the component and slot seals compare the pair, never the
transaction id alone. A logical restore into a new cluster keeps the restored rows' old identifier, which the new
cluster never has, so when its transaction counter reaches a restored `created_txid` the old entitlement still refuses
new components and slots; a physical restore, a promoted replica and `pg_upgrade` behave as ADR-0050 §1 shows. The
tables are new, so no row needs ADR-0050's legacy `0` sentinel: both columns are `NOT NULL` with no default, and an
identifier that reads back `NULL` or `0` fails the insert (ADR-0050 §2). The seal is compared only on insert, so
loading a dump (data before the triggers) is unaffected. Because the seal keeps every component and slot inside the creating transaction,
the entitlement's own trigger, run at that transaction's commit, sees all of them, so one check per entitlement is
enough: a 7,300-slot sale runs one grouped aggregate on the `(company_id, component_id, ordinal)` key (inside SA-10's
budget), and an import of 500 rows runs 500, never one per slot.

**Redeemed-line cancellation (deferred, at commit).** The redemption-slot check fires only when a redemption or slot
changes, so a cancel that set the line `CANCELLED` but forgot the package updates would pass it. A deferred constraint
trigger on `service_lines` (WHEN `OLD.status IS DISTINCT FROM NEW.status`) checks at commit, for a line with
`redemption_id`: its redemption has `reversed_at` set and `reversal_cancellation_id` = the line's
`service_line_cancellations` row, and its slot is no longer held by it (`FREE`, or `USED` by another live redemption).
Any mismatch refuses the commit, so a cancelled redeemed line always gives its session back.

**Extension history (deferred, at commit).** The entitlement-side check proves every `expires_on` change has its
extension row; this one proves the converse. For every `package_extensions` row inserted in the transaction, its
entitlement has `(expires_on_changed_system_id, expires_on_changed_txid)` = `(pospay_system_id(), pg_current_xact_id())`, `expires_on_before = previous_expires_on` and
`expires_on = new_expires_on`. Any mismatch refuses the commit, so the history never shows an extension that did not
happen.

Expand-only; migration numbers are taken at merge. The privileges allowlist and `privileges.spec.ts` gain every grant.

### Events and module map

- **Published:** `PackageSaleChanged` (exists in ADR-0010 and module-map §4; its contract schema, ADR-0010's field list widened by `branch_id` and
  `business_date` (TD-7), and the worker's known types land in 42-1); `ServiceSessionRecorded`, `ServiceSessionLinesAdded` and `ServiceLineChanged` widen `package` from
  `null` to the optional object (43-1); `PackageRefundRecorded` (orders ⇒ orders worker) and `PackageRefundNoticeRequested`
  (orders ⇒ notifications) for the bell (46-3, `TODO(spec)` PK-Q5), with an ADR-0044 addendum and module-map §4 rows.
- **Ports:** `CatalogReaderPort` package-type read (TD-10, 42-1); `CustomerLookupPort.findByPhone` (TD-11, 47-1). Both
  widen existing arrows; module-map §3 rows and the generated YAML are updated in those PRs.
- **Consumed:** none in these rows besides the refund bell's own consumer. Row 50 consumes `PackageSaleChanged` and the
  redeemed lines.

### Permissions (PK-Q12…PK-Q18 answered by Waleed, PP-16; PK-Q5 and PK-Q6 still `TODO(spec)`)

| Code | Defaults | Question |
|---|---|---|
| `manage:package-types:business` (exists) | stop / resume selling | PK-Q12 |
| `sell:packages:branch` (new) | owner, general manager, business manager, branch manager, cashier; the sale and its picker (FR-072) | PK-Q13 |
| `record:service-sessions:branch` (exists) | redeem as part of a visit | PK-Q14 |
| `cancel:service-lines:branch` (exists) | cancel a redeemed line | PK-Q6 |
| `extend:packages:branch` (new) | owner, general manager, business manager, branch manager | PK-Q16 |
| `refund:packages:branch` (new) | owner, general manager, business manager, branch manager | PK-Q5 |
| `manage:package-types:business` (exists) | import open packages (no new code) | PK-Q18 |
| `record:` or `read:service-sessions:branch` (exist) | a customer's packages, list and detail, amounts and history included, under one `RequireAny` guard (TD-13) | PK-Q17 |

New codes go in `access-catalog.ts`, `role-defaults.ts`, `system-role-policy.ts`, the i18n permission names and a seeding
migration, as 0084 did; never held by a device; grantable to any human role.

### Error codes (`message_ar` / `message_en`, in `src/shared/errors.ts`)

- `PACKAGE_TYPE_NOT_SELLABLE` 422 — «الباقة دي متوقف بيعها.» / "This package is not on sale."
- `PACKAGE_SALE_QUOTE_STALE` 409 — «أسعار خدمات الباقة اتغيّرت، حدّثي الشاشة وأكّدي تاني.» / "The package's service prices changed; reload and confirm again." (details: current service revisions)
- `PACKAGE_TYPE_SELLING_UNCHANGED` 409 — «الباقة أصلاً على نفس الحالة.» / "The package is already in that state."
- `PACKAGE_SALE_DISCOUNT_ABOVE_LIMIT` 422 — «الخصم أكبر من حدك.» / "The discount is above your limit." (details: limit bps)
- `PACKAGE_SELLER_NOT_ELIGIBLE` 422 — «البائعة مش شغالة أو مش تبع الفرع في التاريخ ده.» / "The seller is not active at this branch on that date."
- `PACKAGE_SELLER_SELF_FORBIDDEN` 403 — «مينفعش تسجّلي نفسك بائعة.» / "You cannot name yourself as the seller."
- `PACKAGE_SALE_TOO_OLD` / `PACKAGE_SALE_IN_FUTURE` 422 — the 050 window messages, worded for a sale.
- `PACKAGE_CUSTOMER_NOT_FOUND` 422 — «العميلة مش موجودة.» / "Customer not found."
- `PACKAGE_NO_FREE_SESSION` 409 — «مفيش جلسة فاضية من الخدمة دي في الباقة.» / "No free session of this service is left in the package."
- `PACKAGE_EXPIRED` 422 — «الباقة خلصت صلاحيتها.» / "The package has expired." (maps spec 007's `PACKAGE_EXPIRED`)
- `PACKAGE_NOT_YET_VALID` 422 — «الزيارة قبل تاريخ شراء الباقة.» / "The visit is before the package was bought."
- `PACKAGE_NOT_USABLE_HERE` 422 — «الباقة دي مش للعميلة دي أو مفيهاش الخدمة دي.» / "This package cannot be used for this customer and service."
- `PACKAGE_REDEMPTION_ALREADY_REVERSED` 409 — «الجلسة رجعت للباقة قبل كده.» / "This session was already returned to the package."
- `SESSION_LINE_PRICE_NOT_EDITABLE` 422 — «سعر جلسة الباقة ثابت.» / "A package session's price cannot be edited."
- `PACKAGE_EXTENSION_NOT_LATER` / `PACKAGE_EXTENSION_TOO_LONG` 422, `PACKAGE_EXPIRY_STALE` 409, `PACKAGE_EXTENSION_REASON_INVALID` 422.
- `INSUFFICIENT_SLOTS` 422 — «الجلسات الفاضية أقل من المطلوب، ومحدش اترجّع.» / "Fewer free sessions than requested; nothing was refunded." (spec 007 name)
- `PACKAGE_COMPONENT_NOT_FOUND` 422, `PACKAGE_REFUND_REASON_INVALID` 422, `PACKAGE_NOT_FOUND` 404.
- `IMPORT_SERVICE_AMBIGUOUS` (row error, new) — «فيه أكتر من خدمة بالاسم ده؛ غيّر اسم واحدة منهم وارفع الملف تاني.» /
  "More than one service has this name; rename one of them and upload again."
- Reused: the shared validator's codes (spec 007), `IMPORT_*` (spec 030), `IDEMPOTENCY_KEY_REUSED`, `FORBIDDEN`,
  `FEATURE_DISABLED`, and every 050/054 code on the visit and cancel paths. `SESSION_LINE_NOT_CANCELLABLE` and
  `SESSION_LINE_PERFORMERS_NOT_CHANGEABLE` stay reserved (FR-032, FR-035).

### The 200 ms rule

Sale: at most 1 + 20 + 7,300 rows in three multi-row inserts (SA-10 measures it). Redemption, cancel, extension, refund:
a handful of rows under row locks. Import: a worker job (spec 030 Stage B). Reads: indexed, cursor-paginated.

### Test plan

- **Domain unit** (no database): sale discount and bps (FR-012), the seller self rule, expiry and "not yet valid" with the
  visit date, refund amount, the slot transition table, import row validation; the shared definition-case fixture
  (`apps/api/test/package-definition-cases.ts`) gains the import rows.
- **Integration** (one cloned database per spec file, ADR-0006): ST-01…ST-04, SA-01…SA-12, RD-01…RD-09, RC-01…RC-07 (with RC-03b, RC-06b),
  EX-01…EX-05, RF-01…RF-10, IM-01…IM-09 (with IM-04b), CP-01…CP-03; concurrency tests M5, M6, M9 with two real connections.
- **RLS negative**, per new table, and the grant allowlist; trigger negative tests: every forbidden slot transition,
  each refund-integrity breach (a refund slot of another component or entitlement, a copied ordinal or value that
  differs from the slot, `sessions` ≠ the slot count, `amount` ≠ the sum, a `refunded_amount` delta ≠ `amount`, an entitlement `revision` that does not grow by exactly 1 — unchanged or +2 — and
  a `refund.entitlement_revision` that differs from the entitlement's new revision),
  an entitlement whose `import_id` names a preview of another business or a preview whose entity is not `packages`,
  an `IMPORTED` entitlement with no `import_id`, a `SOLD` one with one,
  a `FREE → USED` naming a reversed or another slot's redemption, an `expires_on` change with no or a mismatched
  extension row, each redemption-line integrity breach (in a mixed request, the redemption pointing at the paid line
  or the line pointing at another redemption; a line with `redemption_id` whose redemption names another line; a line
  whose service is not the component's; a `list_price`, `price` or `net` different from the slot's `unit_value`; a
  non-zero `discount` or `effective_discount_bps`; a later update of any of those line columns),
  each redemption-slot integrity breach (a redemption inserted while its slot stays `FREE`, or is `USED` by another
  redemption; a reversal that leaves the slot `USED` by the reversed redemption; a slot kept `USED` whose
  `current_redemption_id` is changed to a reversed redemption or to a live one of another slot, component or
  entitlement),
  a negative money value on insert (`price_paid`, `list_price`, `discount`, `list_price_snapshot`, `component_value`, a
  slot's or a refund slot's `unit_value`, a refund `amount`), including an entitlement of `price_paid 10.000` with
  components of `-5.000` and `15.000` whose sums balance,
  a transaction creating two entitlements in which a slot names one entitlement and a component of the other (the
  composite FK refuses it),
  each value-conservation breach on a sold and on an imported entitlement (a component with one slot fewer or one
  more than `sessions_total`; slot `unit_value`s that do not sum to `component_value`; `component_value`s that do not
  sum to `price_paid`; an entitlement with no component; a ten-session component with the right count and sums but
  a missing ordinal, `{1…9, 11}`, or shifted ordinals, `{2…11}`),
  each initial-state breach (an entitlement inserted with `refunded_amount 5.000`, `revision 2` or `revision 0`; a
  new sale's slot inserted `REFUNDED`, `USED` with no redemption, `IMPORTED_USED`, or with a `current_redemption_id`; an
  import of a five-session component whose `IMPORTED_USED` ordinals are `{1, 3}` or `{2, 3}`),
  each composition-seal breach (a later transaction adding a `0.000` component of a new service with `0.000` slots, or
  one more slot to an existing component; a caller-supplied `created_system_id` or `created_txid` is overwritten; an entitlement restored from another cluster,
  whose `created_txid` equals the current transaction's but whose `created_system_id` differs, refuses a new component
  and a new slot),
  each redeemed-line cancellation breach (a redeemed line set `CANCELLED` with its redemption live, or reversed by
  another cancellation, or with its slot still `USED` by it),
  each extension-history breach (an extension row with no `expires_on` change, with a `previous_expires_on` or
  `new_expires_on` that differs from the change, or a second `expires_on` change in one transaction; on an entitlement
  restored with the current transaction's `expires_on_changed_txid` but another `expires_on_changed_system_id`, an
  extension row with no change is refused and a real extension still passes),
  a second reversal, a lowered `expires_on`, `refunded_amount` above `price_paid`, an update of a value column.
- **Queries:** result shape + `EXPLAIN ANALYZE` index assertions for FR-070, FR-071 and FR-072.
- **UI** (assert what the user sees, CLAUDE.md §9): stop/resume toggle and badge; sale form (price, discount warning,
  seller, method); «من الباقة» on a visit line with remaining count; customer packages list; extension and refund dialogs;
  import preview with row errors.

## 7. Delivery: the sub-PR split (at most three subtasks per PR)

Every row waits on this spec's merge and on the owner answers named in its "Blocked on" cell.

| PR | Result | Subtasks | Blocked on |
|---|---|---|---|
| **33b** | Stop / resume selling | 1. Contract + migration (`selling_stopped_at`, grant) + domain no-op rule. 2. Use cases, routes, ST tests. 3. Admin list toggle, badge, component tests | this spec merged |
| **42-1** | Contracts and map | 1. Sale contracts, `PackageSaleChanged` schema with the sale's `branch_id` and `business_date` (TD-7; ADR-0010's field list widened), worker known types, OpenAPI. 2. `CatalogReaderPort` package-type read (TD-10), module-map §3 row. 3. Error codes ar/en, permission codes + i18n labels | PK-Q2, PK-Q4, PK-Q11, PK-Q23 (PK-Q11 decides whether the request carries `sold_at` at all, PK-Q23 FR-010's snapshot fields) |
| **42-2** | Storage | 1. Entitlements, components, slots: `CHECK`s, RLS, grants; the `import_previews` candidate key the import FK needs. 2. The entitlement and slot triggers (TD-5b, BR-03/04), the value-conservation and composition-seal ones included. 3. Negative RLS and trigger tests, allowlist, permission seed migration | **design advisors**; 42-1 |
| **42-3** | Sell | 1. Pure domain (discount, seller rule, expiry). 2. `SellPackageUseCase`, adapters, route. 3. SA-01…SA-11 (SA-05b, SA-08b, SA-08c included) | 42-2; PK-Q3, PK-Q11, PK-Q23 |
| **42-4a** | Any-of access guard | 1. `RequireAny` and the `RequiredAccess` permissions list; `AccessGuard` and the identity authorizer read every listed grant in one `withTenant` transaction (TD-13). 2. ADR-0003 §4 addendum; `route-coverage.ts` and startup-check tests for the new shape. 3. Guard tests: either permission alone passes, neither → 403, a device → 403, the feature off → 403, a list of mixed scopes refused at module load | this spec merged |
| **42-4** | Reception sale screen + customer packages read | 1. Customer packages list (FR-070) and the detail's sale and component part (FR-071), with `EXPLAIN`. 2. The sale picker query under `sell:packages:branch` (FR-072, SA-12) and the sale form on it. 3. ar/en keys, component tests | 42-3, 42-4a |
| **43-1** | Redemption storage and contracts | 1. `package_redemptions`, `service_lines.redemption_id`, deferred FKs, triggers (the redemption-line, redemption-slot and redeemed-line cancellation ones included), RLS. 2. Widen the line `package` member in the three event schemas and the draft union. 3. Negative tests | **design advisors**; 42-2 |
| **43-1b** | Guards before any redemption exists | 1. The 35d writer refuses a line with `redemption_id` (FR-034, RC-06). 2. The 054 cancel and 055 performer writers refuse it for now (`SESSION_LINE_NOT_CANCELLABLE`, `SESSION_LINE_PERFORMERS_NOT_CHANGEABLE`; 054 D-6, 055 D-8) until 44 lifts them. 3. Negative tests on a redeemed line forced in the database | 43-1 |
| **43-2** | Redeem in the record/append writer | 1. Domain (draft kind, expiry by visit date, line values). 2. Writer changes (component locks, slot, redemption). 3. RD-01…RD-09 incl. the M5 race | 43-1, **43-1b merged and deployed**; PK-Q7 |
| **43-3** | Reception «من الباقة» | 1. Line toggle with the customer's packages and remaining count; the detail's redemption history (FR-071). 2. Suggest the earliest expiry. 3. Component tests | 43-2, 42-4 (the detail query) |
| **44** | Cancel / performers on redeemed lines | 1. 054 writer: lift the 43-1b refusal and reverse (FR-031), RC-01…RC-05. 2. 055 per PK-Q8 (lift or keep the 43-1b refusal), RC-07. 3. RC-06 re-run against the final writers | 43-2; PK-Q6, PK-Q8 |
| **45** | Extend | 1. `package_extensions`, the entitlement's `expires_on_*` columns and the extension-history trigger, contracts, permission. 2. Use case, route, EX tests. 3. Admin dialog and the detail's extension history (FR-071) | 42-2, **42-4** (the detail query), after **43-3** on that file; PK-Q1 |
| **46-1** | Refund storage | 1. `package_refunds`, `package_refund_slots`, RLS, grants. 2. Contracts, error codes, permission. 3. Negative tests | **design advisors**; 43-1; PK-Q4, PK-Q5 |
| **46-2** | Refund | 1. Use case (FR-051…FR-055). 2. Route. 3. RF-01…RF-10 incl. M6/M9 races | 46-1; PK-Q10 |
| **46-3** | Refund bell + dialog | 1. Events, ADR-0044 addendum, module-map rows, template ar/en. 2. Consumer + ledger. 3. Admin refund dialog and the detail's refund history (FR-071) | 46-2, **42-4**, after **45** on the detail query file; PK-Q5 |
| **47-1** | Import framework for packages | 1. The workbook reader moved to `shared/import` with per-plug-in bounds (FR-060b); staff passes its own, unchanged; IM-09. 2. Package plug-in on the shared `import_previews` / `import-sheet.ts` framework: template, row validation, `CustomerLookupPort.findByPhone` (TD-11). 3. Guard on `manage:package-types:business` and its refusal tests | **design advisors**; 43-1; PK-Q9, PK-Q22 |
| **47-2** | Import commit | 1. Worker commit use case. 2. Routes. 3. IM-01…IM-08 | 47-1 |
| **47-3** | Import screen | 1. Upload/preview/commit screen. 2. Row errors. 3. Component tests | 47-2 |

**Detail query order:** 42-4 creates the FR-071 query; 43-3, then 45, then 46-3 each add one history section to the
same file, one at a time in that order.

**File overlap:** 43-1 touches the line contracts of 050/054/055 (`packages/contracts/src/orders/service-session.ts` and
its cancel/performers refinements); 44 touches the 054, 35d and 055 writers; 47-1 touches the staff import's reader. They run **one at a time** with any other
PR on those files (pipeline rule: only disjoint files in parallel).

## 8. Success criteria

- **SC-001** For every sale and import, the sum of slot values equals the price paid to the mill.
- **SC-002** 0 slots are used twice, refunded twice, or used after a refund, under any concurrency the tests produce.
- **SC-003** A lost response retried with the same key never creates a second package, slot use, reversal or refund.
- **SC-004** Reception sells a package or records a package session in under one minute without help.
- **SC-005** Every money change on a package (sale, refund, cancel of a redeemed session) is traceable to who, when, why
  (where a reason is required) and from what to what.
- **SC-006** Row 50 can compute the seller's sale commission and each performer's line commission from these slices'
  events alone.

## 9. Assumptions

- A sale entered by mistake is undone by a full refund of its unused sessions (amount = price paid while nothing was
  used), which needs the refund permission. If the owners want a separate «cancel sale», it is a new row, and
  `PackageSaleChanged.status` gains a value.
- Every package "today" is local to the branch where the act happens (TD-4, D-10); the pilot branches use the business timezone, so the two agree today.
- The bell and dialog copy are proposed; changing them needs no migration.
- A redeemed line keeps the SS-Q2 self rule: a recorder cannot redeem a session she performs.
- Phase 1 has no production packages; the import (47) is how the pilot salon's open packages arrive (D-48, D-51).
