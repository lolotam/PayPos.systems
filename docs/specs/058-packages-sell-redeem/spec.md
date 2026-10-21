# Spec 058 — Packages: stop selling, sell, redeem, cancel a redemption, extend, refund, import (Phase 1 rows 33b, 42–47)

> **Status:** Draft · 2026-10-21 · docs-only PR. **21 owner questions are open** (PK-Q1…PK-Q21), recorded in
> [owner-questions.ar.md](owner-questions.ar.md): PK-Q1…PK-Q11 are charges/money (decisions page, Abu Salem binds) and
> PK-Q12…PK-Q21 are permissions/technical (Waleed, through his super agent). Every rule that waits on one is marked
> `TODO(spec)` with its question number; the design below follows the recommended option of each, so only the marked
> rule moves if an owner picks otherwise. **No code starts on a sub-PR whose rows name a pending question** (§7).
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
> corrections), row 59 (a redeemed line is an active line for the rating group).
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
| Stop / resume selling (33b) | a nullable `selling_stopped_at` on the type; stopped types are refused by the sale and hidden from its picker; everything already sold, and the import, are unaffected (`TODO(spec)` PK-Q12) | FR-001…FR-003 |
| The sale record (42) | the **entitlement row is the sale**; it is not a service line (TD-1) | TD-1, FR-010 |
| Sale price, discount, seller, method, back-dating | `TODO(spec)` PK-Q2, PK-Q3, PK-Q4, PK-Q11 | FR-012…FR-016 |
| Valuation | spec 007's `allocatePackagePrice` and `createPackageSlots`, at sale, from the services' list prices **at sale time** | FR-017, BR-01 |
| Redemption (43) | a **draft kind of the existing record and append routes** (TD-2), not a new endpoint; lowest `FREE` ordinal under a lock on the component row | TD-2, FR-020…FR-027 |
| Cancel a redemption (44) | the 054 cancel writer accepts a redeemed line and reverses its redemption once in the same transaction (`TODO(spec)` PK-Q6) | TD-3, FR-030…FR-033 |
| Price edit of a redeemed line | refused: its price is the slot value (SPEC §4, §8) | FR-034 |
| Performer change of a redeemed line | `TODO(spec)` PK-Q8 | FR-035 |
| Extend (45) | forward only, audited, compare-and-set on the current date (`TODO(spec)` PK-Q1, PK-Q16) | FR-040…FR-044 |
| Refund (46) | the manager picks one component and a count; highest `FREE` ordinals; exact or `INSUFFICIENT_SLOTS` (SPEC §8) (`TODO(spec)` PK-Q4, PK-Q5, PK-Q10) | FR-050…FR-057 |
| Import (47) | the spec 030 framework: template, preview, one all-or-nothing commit; `external_ref` unique per company (`TODO(spec)` PK-Q9, PK-Q18…PK-Q21) | FR-060…FR-068 |
| Who sees a customer's packages | `TODO(spec)` PK-Q17 | FR-070 |

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
| TD-4 | **Dates.** Every package date — sale date, `expires_on`, "today" for a refund or an extension — is a business date in the **business timezone** stored on the visit and on the entitlement, as every orders and commissions date is (SPEC §5 "Dates are business dates", 050 FR-013). D-10 lets a branch override the timezone; a package is used in every branch of its business (PT-Q10), so one entitlement must have one expiry whatever branch serves the customer. "End of the expiry day, branch time" (D-51, PT-Q3) is read as the business timezone; it is the same value in Kuwait. **"Today" for a redemption is the visit's `business_date`** (`TODO(spec)` PK-Q7) | the serving branch's timezone (an expiry that moves with the branch) |
| TD-5 | **Locks, one global order.** Refund: entitlement `FOR UPDATE` → component `FOR UPDATE` (SPEC §8). Redemption: visit advisory lock (050) → components `FOR UPDATE` in ascending id. Cancel of a redeemed line: 054's order (visit lock → line `FOR UPDATE`) → component `FOR UPDATE`. Extension: entitlement `FOR UPDATE`. No path takes the entitlement after a component, and the refund never takes a visit lock, so no cycle exists. The redemption reads `expires_on` without locking the entitlement: an extension only moves it later, so a stale read can only refuse, never wrongly accept | locking the entitlement on every redemption (a hot row for the whole package) |
| TD-5b | **Slots are an enforced state machine.** `FREE → USED` (a live redemption), `USED → FREE` (only when that redemption is reversed in the same transaction), `FREE → REFUNDED` (only with a refund row of the same transaction), `IMPORTED_USED` and `REFUNDED` terminal; `ordinal` and `unit_value` never change. A trigger refuses every other transition; the runtime grant is `UPDATE (state, current_redemption_id)` only | trusting the use cases alone with an `UPDATE` grant on the whole row |
| TD-6 | **Financial rows are immutable; reversals are rows.** Sale, components, slots' values, redemptions, refunds, extensions and imports are insert-only. The only in-place changes are the cumulative ones SPEC §8 names (`refunded_amount`, `revision`, `expires_on` on the entitlement; `state` on a slot; the one-time `reversed_at` on a redemption), each enforced one-way by a trigger and each paired with an insert-only history row (refund, extension, the 054 cancellation row) that says who, when and why | updating a sale or deleting a redemption |
| TD-7 | **`PackageSaleChanged`** (ADR-0010) is emitted only for `SOLD` entitlements: on the sale (`revision = 1`) and on every refund (`revision + 1`, the new cumulative `refunded_amount`), in the same transaction. Extension does not change `revision` (its compare-and-set token is the current `expires_on`, FR-041), so it emits nothing: no field of the event moves. `status` is the constant `'SOLD'` in Phase 1, reserved for a later sale cancellation. An imported entitlement emits nothing, ever (no seller, no sale commission, D-51) | emitting for imports (a consumer would have to skip them) |
| TD-8 | **The redeemed line marker.** `service_lines.redemption_id` (SPEC §4 `ServiceLine … redemption_id?`), written at insert and never changed; a deferred tenant FK to `package_redemptions`, and `package_redemptions.line_id` back to the line, both in the same transaction. The line event's `package` member goes from `null` to `{ entitlement_id, component_id, ordinal }` for such a line, in `ServiceSessionRecorded`, `ServiceSessionLinesAdded` and `ServiceLineChanged` (ADR-0010 already lists it) | a separate lookup table (every writer of a line would need one more join to know it is a package line) |
| TD-9 | **Idempotency.** `Idempotency-Key` on the sale (`sell-package`), on a redemption (through the record/append operations), on the cancel (054's), on the refund (`refund-package`), on the extension (`extend-package`, for a uniform retry story) and on the import commit (`import-packages`). Stop/resume selling is master data with no money effect and uses the type's `expected_revision` only, as row 33 does (spec 037 TD-3) | per-use-case special cases |
| TD-10 | **Catalog read.** `CatalogReaderPort` (orders-owned) gains one bounded read: a package type of the business with names, price, validity, revision, `selling_stopped_at` and its components with each service's current list price, names, revision, rule and threshold flag. It is the arrow ADR-0010 already planned ("package-type components"); the module-map §3 row is widened in 42-1, no new import arrow | orders reading catalog tables directly |
| TD-11 | **Customer by phone (import only).** `CustomerLookupPort` gains `findByPhone(e164)` for row 47; the existing `orders → customers` port arrow is widened in 47-1 (module-map §3 row), no new arrow. The phone is never logged and an import error shows its last 3 digits only (SPEC §4, CLAUDE.md §8) | importing customers inside orders |
| TD-12 | Money is `bigint` mills in the domain, `numeric(14,3)` in the database and a canonical three-decimal string in contracts and events (ADR-0041, as `ServiceLineChanged.net`) | `number` anywhere |

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

### 3.2 Open — owner questions (all `PENDING`; the design follows the ⭐ option)

| ID | Kind | Question (short) | ⭐ recommended | What moves if another option wins |
|---|---|---|---|---|
| PK-Q1 | money | Is an extension charged? | free: it moves only the date | 45 gains a fee field, its payment record and its effect on slot values and the seller's commission (a new rule, a new ADR) |
| PK-Q2 | money | Sale price against the type's price | like a visit line: editable, even above the type price (SS-Q4); discount counted against the type price within the recorder's limit, half-up (SS-Q5); above the limit refused until rows 38–41 | FR-012, FR-013 |
| PK-Q3 | money | May the person recording the sale name herself as the seller? | no, like SS-Q2 | FR-014 (one rule) |
| PK-Q4 | money | Payment method of a sale and of a refund | `CASH` or `CARD`, recorded on both | the method enum of FR-015 and FR-054 |
| PK-Q5 | money | Who refunds, and what is recorded | new permission, owner / general manager / business manager / branch manager, grantable; written reason; bell to the branch managers; audit | FR-050, FR-055, FR-056; 46-3 |
| PK-Q6 | money | Cancelling a redeemed session | exactly the CX-Q1…CX-Q5 rules of a line, and the session goes back to the package | FR-030…FR-033 |
| PK-Q7 | money | Expiry date of a late-recorded redemption | the visit's date | TD-4, FR-024 |
| PK-Q8 | money | Changing the performers of a redeemed session | allowed, by the 055 rules; the slot does not move | FR-035; 055 D-8 lifted |
| PK-Q9 | money | Price of an imported package | the amount the customer actually paid, required | FR-063 |
| PK-Q10 | money | Can an imported package be refunded? | yes, by the same rules, amount = its unused slots' values | FR-053 |
| PK-Q11 | money | Back-dating a sale | like a visit (SS-Q9): default now, back to the first of the previous month; expiry and commission month from the sale date | FR-016 |
| PK-Q12 | technical | Stop / resume selling | the holders of `manage:package-types:business`; no reason; audited; sold and imported packages untouched; still editable | FR-001…FR-003 |
| PK-Q13 | permission | Who sells | new `sell:packages:branch`, defaulting to the five SS-Q2 roles (owner, general manager, business manager, branch manager, cashier) | FR-011 |
| PK-Q14 | permission | Who redeems, and where | whoever records a visit (`record:service-sessions:branch`), in the same reception screen | FR-020, 43-3 |
| PK-Q15 | technical | Two packages hold the same service | reception picks; the screen suggests the one that expires first | FR-021, 43-3 |
| PK-Q16 | permission | Extension: who and its limits | new `extend:packages:branch` for the four managers; written reason; later only; at most today + 730 days; allowed after expiry; repeatable; no bell | FR-040…FR-044 |
| PK-Q17 | permission | Who sees a customer's packages | reception sees remaining sessions and expiry; amounts and history only with `read:service-sessions:branch` | FR-070, FR-071 |
| PK-Q18 | permission | Who imports | new `import:packages:business` for owner, general manager, business manager | FR-060 |
| PK-Q19 | technical | Imported package without a matching type | rows give a name, services and sessions directly; no type link | FR-062; `package_type_id` nullable for `IMPORTED`; if «the type must exist» wins, the import also accepts a stopped type (stopping is about new sales only) |
| PK-Q20 | technical | Import row whose customer phone is unknown | the row is refused; customers are imported first (row 34b) | FR-064 |
| PK-Q21 | technical | Import row already expired | accepted as it is (a manager can extend it later) | FR-065 |

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
- **ST-04** Without the permission, a device, or the `catalog` feature off → 403 / `FEATURE_DISABLED`, nothing written.

### Story 2 — Sell a package (42, P1)

- **SA-01** منى sells «سشوار ×10» to نورة for 22.500, cash, seller هبة, in السالمية. In **one** transaction: one entitlement
  (`provenance SOLD`, `list_price 25.000`, `price_paid 22.500`, `discount 2.500`, `discount_bps 1000`, `sold_at`,
  `sold_business_date 2026-10-01`, `expires_on 2026-12-30`, `revision 1`, `refunded_amount 0.000`), one component
  (`list_price_snapshot 3.000`, `sessions_total 10`, `component_value 22.500`), ten slots `FREE` of 2.250, one audit entry
  `package.sold`, one `PackageSaleChanged` (`revision 1`, `status 'SOLD'`), the idempotent 201 stored.
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
- **SA-06** (`TODO(spec)` PK-Q4) `paid_method` is `CASH` or `CARD`; missing or other → 400 by the contract.
- **SA-07** (`TODO(spec)` PK-Q11) `sold_at` omitted → now; back-dated inside the window → accepted, `late = true`,
  expiry from the sale date; before the first of the previous month → 422 `PACKAGE_SALE_TOO_OLD`; in the future beyond
  the 120 s allowance → 422 `PACKAGE_SALE_IN_FUTURE` (050 FR-014 values).
- **SA-08** Customer of another company or unknown → 422 `PACKAGE_CUSTOMER_NOT_FOUND`; type of another business or
  unknown → 404 `PACKAGE_TYPE_NOT_FOUND`; a type whose current definition fails the shared validator (a service removed
  from the business is impossible today, spec 037) → 422 with the validator's named code. [M11]
- **SA-09** Same key, same body, same actor → the original 201 replays, no second entitlement or slot [M10]; changed
  body or actor → 422 `IDEMPOTENCY_KEY_REUSED`.
- **SA-10** A type of 20 components × 365 sessions (7,300 slots) sells inside the 200 ms budget with one multi-row insert
  per table (measured in 42-3; above budget the sale stops and the PR comes back here).
- **SA-11** Without `sell:packages:branch` (`TODO(spec)` PK-Q13), a device, or the `orders` feature off → 403 /
  `FEATURE_DISABLED`, nothing written.

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
  29 December recorded on 2 January (inside the window) redeems. A visit dated before the sale date → 422
  `PACKAGE_NOT_YET_VALID`. [M7]
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
- **RC-03** A replay of the cancel with the same key, or a stale reversal (slot already freed or redemption already
  reversed) reverses nothing; the conditional `UPDATE`s touch 0 rows and the transaction refuses to commit a
  half-reversal (`PACKAGE_REDEMPTION_ALREADY_REVERSED`, 409). [M10]
- **RC-04** All 054 rules apply unchanged: permission, recording window, self rule, tip guard (CX-Q4), finality (CX-Q5),
  and an approved month becomes a correction through row 50/55.
- **RC-05** Cancelling a redeemed line of an entitlement that has since expired frees the slot all the same; it can be
  used again only after an extension.
- **RC-06** A price edit (35d) of a redeemed line → 422 `SESSION_LINE_PRICE_NOT_EDITABLE`, nothing written.
- **RC-07** (`TODO(spec)` PK-Q8) A performer change (055) of a redeemed line follows the 055 rules; the slot, the value
  and the redemption do not move.

### Story 5 — Extend (45, P2)

- **EX-01** (`TODO(spec)` PK-Q16) ليلى extends نورة's package from 30 December to 31 January with a reason and
  `expected_expires_on 2026-12-30`: one `package_extensions` row (before, after, who, membership, when, reason), the
  entitlement's `expires_on` updated, one audit entry `package.extended`. No event (TD-7).
- **EX-02** A new date not later than the current one → 422 `PACKAGE_EXTENSION_NOT_LATER`; later than today + 730 days →
  422 `PACKAGE_EXTENSION_TOO_LONG`; stale `expected_expires_on` → 409 `PACKAGE_EXPIRY_STALE`.
- **EX-03** An expired package can be extended; after it, redemption and refund work again. [M7]
- **EX-04** (`TODO(spec)` PK-Q1) The request carries no amount; nothing about money changes.
- **EX-05** Without the permission, a device, or the feature off → 403; an imported package extends like a sold one.

### Story 6 — Refund (46, P1)

- **RF-01** ليلى refunds 8 sessions of the سشوار component of نورة's package (slots 1 and 3 used): entitlement locked,
  then the component; slots 2 and 4…10 → `REFUNDED`; one refund row (component, ordinals 10…4 and 2, amount 18.000,
  method, reason, who); `refunded_amount 18.000`, `revision 2`; one `PackageSaleChanged` (`revision 2`,
  `refunded_amount 18.000`); one audit entry `package.refunded`; the bell (PK-Q5). From the same state, a refund of 5
  instead takes the highest free ordinals, 10…6, for 12.500 (unit). [M6]
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
- **RF-10** Without `refund:packages:branch` (`TODO(spec)` PK-Q5) at the acting branch, a device, or the `orders` feature
  off → 403 / `FEATURE_DISABLED`; an entitlement of another business or company → the same 404 `PACKAGE_NOT_FOUND` as
  an unknown id; nothing written.

### Story 7 — Import open packages (47, P1)

- **IM-01** A holder of `import:packages:business` (`TODO(spec)` PK-Q18) downloads the template, uploads a workbook,
  previews: each row has customer phone, package name (en, optional ar), price paid, services with original and
  remaining sessions, expiry date, `external_ref`. Per-row errors are named; the phone shows its last 3 digits only.
- **IM-02** A clean preview commits all rows in one worker transaction (spec 030 IM-03…IM-05): per row one entitlement
  `IMPORTED` with no seller, components valued over the **original** sessions with today's service prices as
  `list_price_snapshot`, slots `1…used` `IMPORTED_USED` and the rest `FREE`; one audit entry per commit. [M11]
- **IM-03** An `external_ref` already imported → the row is a no-op on re-import (reported "already imported"); twice
  in one file → row error.
- **IM-04** Remaining > original, sessions 0 or > 365, a duplicate service, a negative or 4-decimal price, an unknown
  service of the business, an invalid date → named row errors; one invalid row saves nothing. [M11]
- **IM-05** (`TODO(spec)` PK-Q20) A phone with no customer in the company → row error `IMPORT_CUSTOMER_NOT_FOUND`.
- **IM-06** (`TODO(spec)` PK-Q21) A past expiry date is accepted; the package is expired until extended.
- **IM-07** Imported packages redeem, cancel, extend and refund like sold ones; they never emit `PackageSaleChanged`.
- **IM-08** Without `import:packages:business` (`TODO(spec)` PK-Q18), a device, or the `orders` feature off → 403 /
  `FEATURE_DISABLED` on the template, the preview and the commit; a preview of another business or company answers
  like an unknown one (spec 030 IM-06); nothing written.

### Story 8 — A customer's packages (42-4, P1)

- **CP-01** (`TODO(spec)` PK-Q17) Reception opens نورة's packages in the business: each with name, expiry, and per
  service the remaining, used and refunded counts; with `read:service-sessions:branch` also price paid, refunds and the
  extension history. Expired and fully used packages are listed last, marked.
- **CP-02** Another business's or company's packages never appear; a foreign customer id answers like unknown.
- **CP-03** A caller with neither `record:service-sessions:branch` nor `read:service-sessions:branch` at the branch, a
  device, or the feature off → 403 on the list and the detail; a caller with `record:` only gets the list without any
  amount field and 403 on the detail (FR-071).

### Edge cases

- A package of price 0.000: every slot is 0.000; its performers earn nothing on it (PT-Q7); its refund amount is 0.000.
- A redemption in a branch other than the sale's branch is allowed (PT-Q10).
- A customer holding two packages with the same service: the draft names the entitlement (PK-Q15); there is no automatic
  choice in the server.
- A redeemed line on a visit whose month is approved, then cancelled: the slot is freed now; the commission correction
  is row 50/55's (SPEC §6).
- The deferred FKs between `service_lines.redemption_id` and `package_redemptions.line_id` are checked at commit; a
  half-written pair cannot commit.
- `numeric(14,3)` bounds hold for every sum; a sale price above the bound is refused by the contract.

## 5. Requirements

### 33b — stop / resume selling

- **FR-001** `POST /v1/businesses/{businessId}/package-types/{packageTypeId}/stop-selling` and `/resume-selling`, body
  `{ expected_revision }`, guard `manage:package-types:business` (`TODO(spec)` PK-Q12), `catalog` feature; 200 with
  `PackageTypeDetail` (now with `selling_stopped_at`).
- **FR-002** One transaction: row `FOR UPDATE`, compare-and-set on `revision`, set or clear `selling_stopped_at`, audit
  entry with before/after. No event (spec 037 TD-3).
- **FR-003** The flag affects only new sales (42) and the sale picker. Redemption, extension, refund, the import
  (which names no type, PK-Q19) and type edits ignore it.

### 42 — sell

- **FR-010** `POST /v1/businesses/{businessId}/branches/{branchId}/package-sales`, body
  `{ customer_id, package_type_id, price_paid, paid_method, seller_employee_id, sold_at?, recorder_membership_id? }`;
  201 `{ entitlement }`. The entitlement is the sale (TD-1).
- **FR-011** Guard `sell:packages:branch` (`TODO(spec)` PK-Q13) and the `orders` feature, individual admin login, rechecked
  inside the transaction after waits (the 050 pattern).
- **FR-012** (`TODO(spec)` PK-Q2) `price_paid ≥ 0`, any amount within `numeric(14,3)`, even above the type price;
  `discount = max(type price − price_paid, 0)`; `discount_bps = ceil(discount × 10000 / type price)`, 0 at a type price
  of 0 (050 FR-008).
- **FR-013** (`TODO(spec)` PK-Q2) The recorder's limit is read through the existing `DiscountLimitPort` for the verified
  recorder membership (050 FR-007); above it → refused (`PACKAGE_SALE_DISCOUNT_ABOVE_LIMIT`). Rows 38–41 later add the
  approval path to the sale exactly as to a line.
- **FR-014** (`TODO(spec)` PK-Q3) The seller is required, eligible at the sale date (`PerformerCheckPort`), and not linked to
  the recorder's user (snapshot of the link stored on the entitlement, as performers are, ADR-0045).
- **FR-015** (`TODO(spec)` PK-Q4) `paid_method ∈ {CASH, CARD}`, stored; no payment is captured (Phase 2).
- **FR-016** (`TODO(spec)` PK-Q11) `sold_at` default now, editable within 050 FR-014's window; `sold_business_date` and
  `business_timezone` stored; `late` stored like a visit's.
- **FR-017** The type and components are read through `CatalogReaderPort` (TD-10); the definition passes the shared
  validator (`validatePackageDefinition`); `allocatePackagePrice` and `createPackageSlots` produce the components and
  slots; `expires_on = sold_business_date + validity_days` (spec 037 BR-004). No arithmetic in the use case.
- **FR-018** One transaction: idempotency claim (`sell-package`, COMPANY scope, actor-bound fingerprint as 050 §8) →
  access lock → read type/customer/seller/limit → domain → insert entitlement, components, slots → audit → emit
  `PackageSaleChanged` → store the 201.
- **FR-019** `ServiceSessionRecorded` is not involved: a sale is not a visit and adds no line.

### 43 — redeem

- **FR-020** The record and append bodies (050 §8) accept a second draft kind `{ service_id, package: { entitlement_id },
  performers }` (strict union; no `price`, no `discount`). Guard and permission are the visit's
  (`record:service-sessions:branch`, `TODO(spec)` PK-Q14).
- **FR-021** The draft names its entitlement (`TODO(spec)` PK-Q15); the server never picks one.
- **FR-022** Lock order inside the visit transaction (TD-5): after the visit lock, every named component `FOR UPDATE`
  in ascending id; per draft, in input order, `selectPackageRedemptionSlot` takes the lowest `FREE`.
- **FR-023** The entitlement must belong to the visit's customer and business, and contain the draft's service;
  otherwise `PACKAGE_NOT_USABLE_HERE` (RD-05).
- **FR-024** (`TODO(spec)` PK-Q7, TD-4) `assertPackageNotExpired(visit.business_date, expires_on)`; and
  `visit.business_date ≥ sold_business_date` (imports: no lower bound), else `PACKAGE_NOT_YET_VALID`.
- **FR-025** The line: `list_price = price = net = unit_value`, `discount 0`, `effective_discount_bps 0`, the catalog
  snapshot of the service at recording time (names, revision, rule, threshold flag) like any line, `redemption_id` set.
  The applied-limit columns record the recorder's limit as for any line; the discount check never fires (0 bps).
- **FR-026** Slot `FREE → USED` with `current_redemption_id`; one `package_redemptions` row
  `{ slot, component, entitlement, line, redeemed_at = recorded_at, recorded_by, membership }`.
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
  (`TODO(spec)` PK-Q16) on the acting branch; the entitlement must belong to the branch's business.
- **FR-041** `new_expires_on > expires_on` and `≤ today + 730 days` (business date); `expected_expires_on` equals the
  stored value (compare-and-set). Reason trimmed 1…500 characters (the 054 rule).
- **FR-042** Entitlement `FOR UPDATE` → extension row → `UPDATE expires_on` (a trigger refuses any decrease) → audit.
- **FR-043** (`TODO(spec)` PK-Q1) No amount, no payment, no slot or value change, no event (TD-7).
- **FR-044** The reason lives in the extension row only, never in the audit entry, an event or a log (054 D-8 rule).

### 46 — refund

- **FR-050** `POST …/branches/{branchId}/packages/{entitlementId}/refunds`, body `{ component_id, sessions, method, reason }`,
  Idempotency-Key (`refund-package`); guard `refund:packages:branch` (`TODO(spec)` PK-Q5).
- **FR-051** Entitlement `FOR UPDATE` → component `FOR UPDATE` (SPEC §8); `assertPackageNotExpired(today, expires_on)`;
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

- **FR-060** The spec 030 framework: template download, upload through `files`, preview, single-use preview committed by
  a worker job in one transaction (above 200 ms), 2 MiB / 500 rows. Guard `import:packages:business` (`TODO(spec)`
  PK-Q18).
- **FR-061** One row = one package; columns: customer phone, package name en (ar optional), price paid, expiry date,
  `external_ref`, then up to 20 groups of (service name, original sessions, remaining sessions).
- **FR-062** (`TODO(spec)` PK-Q19) No package type is named; `package_type_id` is `NULL` for `IMPORTED`; the names are
  stored on the entitlement.
- **FR-063** (`TODO(spec)` PK-Q9) `price_paid` is the amount actually paid, required, `≥ 0`; components are valued by
  `allocatePackagePrice` with the services' current list prices as `list_price_snapshot`, over the **original** sessions;
  `createPackageSlots(…, remaining)` marks ordinals `1…original − remaining` `IMPORTED_USED`.
- **FR-064** (`TODO(spec)` PK-Q20) The phone is resolved through `CustomerLookupPort.findByPhone` (TD-11); unknown → row
  error.
- **FR-065** (`TODO(spec)` PK-Q21) Any valid expiry date is accepted, past included; `sold_business_date` is `NULL` and
  RD's "not yet valid" check does not apply.
- **FR-066** `external_ref` 1…100 characters, unique per company (`UNIQUE (company_id, external_ref)`); an existing one is
  skipped at commit and reported; the commit is idempotent (`import-packages`).
- **FR-067** No seller, no paid method, no `PackageSaleChanged` (TD-7).
- **FR-068** Every rejection reuses the shared validator's codes plus `IMPORT_*` row codes (spec 030).

### Reads

- **FR-070** (`TODO(spec)` PK-Q17) `GET …/branches/{branchId}/customers/{customerId}/packages` under
  `record:service-sessions:branch` **or** `read:service-sessions:branch`: per entitlement name, expiry, expired flag and
  per component remaining / used / refunded counts; amounts (price paid, slot values, refunds, extensions) only for
  `read:service-sessions:branch`. A `queries/` file: read-only, no `domain/` import, result-shape test and `EXPLAIN`.
- **FR-071** `GET …/packages/{entitlementId}` (detail with the history: redemptions with their visit dates, refunds,
  extensions) under `read:service-sessions:branch`.

## 6. Slice design

### Business rules

- **BR-01** Conservation: Σ slot values = Σ component values = `price_paid`, to the mill, for every sale and import
  (spec 007 SC-001); nothing in rows 43–47 changes a slot's value.
- **BR-02** A slot is in exactly one state; only the TD-5b transitions exist.
- **BR-03** `refunded_amount` = Σ refund amounts of the entitlement and never exceeds `price_paid`; `revision` = 1 + the
  number of refunds.
- **BR-04** `expires_on` only moves later.
- **BR-05** A redeemed line's money is the slot's value and never changes (FR-034).
- **BR-06** Orders reads no statement status; corrections are rows 50/55's (054 D-5, 055 D-6).

### Schema changes

All tables: PK `(company_id, id)` (UUID v7, ADR-0007), `business_id`, `ENABLE` + `FORCE` RLS with `USING` and `WITH CHECK
company_id = app_company_id()`, tenant-and-business-qualified FKs, a negative isolation test (cross-tenant read = 0
rows, write refused), money `numeric(14,3)`, indexes for every FK and RLS predicate (CLAUDE.md §5).

| Table | Columns (beyond the common ones) | Grants / triggers | Keys and indexes |
|---|---|---|---|
| `package_types` (33b) | `selling_stopped_at timestamptz NULL` | column `UPDATE` grant gains it | — |
| `package_entitlements` (42) | `customer_id`, `package_type_id NULL`, `provenance` (`SOLD`/`IMPORTED`), `name_en`, `name_ar`, `validity_days NULL`, `list_price NULL`, `price_paid`, `discount NULL`, `discount_bps NULL`, `paid_method NULL`, `seller_employee_id NULL`, `seller_linked_user_id NULL`, `sold_branch_id NULL`, `sold_at NULL`, `sold_business_date NULL`, `business_timezone`, `late`, `recorded_by`, `recorded_by_membership_id`, `external_ref NULL`, `import_id NULL`, `expires_on date`, `refunded_amount default 0`, `revision default 1`, `created_at` | `SELECT, INSERT`, `UPDATE (expires_on, refunded_amount, revision)`; trigger: `expires_on` only increases, `refunded_amount` only increases and `≤ price_paid`, `revision` +1 exactly with a refund row of the same transaction; `CHECK`s: `SOLD` ⇒ type, seller, method, branch, sold fields NOT NULL and `external_ref` NULL; `IMPORTED` ⇒ seller, method NULL and `external_ref` NOT NULL | `UNIQUE (company_id, external_ref)`; index `(company_id, business_id, customer_id, expires_on)` for the customer read; FKs to customers, package types, employees, branches, memberships, imports |
| `package_components` (42) | `entitlement_id`, `service_id`, `position 1…20`, `name_en`, `name_ar`, `list_price_snapshot`, `sessions_total 1…365`, `component_value` | `SELECT, INSERT`; locked `FOR UPDATE` by redemption, cancel and refund | `UNIQUE (company_id, entitlement_id, service_id)`, `UNIQUE (company_id, entitlement_id, position)`; FKs entitlement, service |
| `package_session_slots` (42) | `component_id`, `entitlement_id`, `ordinal`, `unit_value`, `state`, `current_redemption_id NULL` | `SELECT, INSERT`, `UPDATE (state, current_redemption_id)`; trigger enforces TD-5b and `state = 'USED' ⇔ current_redemption_id NOT NULL` | `UNIQUE (company_id, component_id, ordinal)`; partial index on `(company_id, component_id, ordinal) WHERE state = 'FREE'` for the lowest/highest pick |
| `package_redemptions` (43) | `entitlement_id`, `component_id`, `slot_id`, `line_id`, `redeemed_at`, `recorded_by`, `recorded_by_membership_id`, `reversed_at NULL`, `reversal_cancellation_id NULL` | `SELECT, INSERT`, `UPDATE (reversed_at, reversal_cancellation_id)` one-way (trigger: only `NULL → value`, both together, linked to the 054 cancellation row of the same line) | `UNIQUE (company_id, line_id)`; partial `UNIQUE (company_id, slot_id) WHERE reversed_at IS NULL`; FKs slot, line (deferred), 054 cancellation |
| `service_lines` (43) | `redemption_id uuid NULL`, insert-only | no new `UPDATE` grant | deferred FK `(company_id, business_id, redemption_id)` → `package_redemptions`; partial index `WHERE redemption_id IS NOT NULL` |
| `package_refunds` (46) | `entitlement_id`, `component_id`, `branch_id`, `sessions`, `amount`, `method`, `reason`, `refunded_by`, `refunded_by_membership_id`, `refunded_at`, `entitlement_revision` | `SELECT, INSERT` | `UNIQUE (company_id, entitlement_id, entitlement_revision)`; FKs |
| `package_refund_slots` (46) | `refund_id`, `slot_id`, `ordinal`, `unit_value` | `SELECT, INSERT` | `UNIQUE (company_id, slot_id)` (a slot is refunded once) |
| `package_extensions` (45) | `entitlement_id`, `branch_id`, `previous_expires_on`, `new_expires_on`, `reason`, `extended_by`, `extended_by_membership_id`, `extended_at` | `SELECT, INSERT`; `CHECK new > previous` | index `(company_id, entitlement_id, extended_at)` |
| `package_imports` (47) | the spec 030 preview/commit columns for this entity | as spec 030 | as spec 030 |
| `package_refund_notices` (46-3) | the bell ledger: `refund_id`, `source_event_id`, `decided_at`, `recipient_count ≥ 0` | `SELECT, INSERT` | `UNIQUE (company_id, refund_id)` |

Expand-only; migration numbers are taken at merge. The privileges allowlist and `privileges.spec.ts` gain every grant.

### Events and module map

- **Published:** `PackageSaleChanged` (exists in ADR-0010 and module-map §4; its contract schema and the worker's known
  types land in 42-1); `ServiceSessionRecorded`, `ServiceSessionLinesAdded` and `ServiceLineChanged` widen `package` from
  `null` to the optional object (43-1); `PackageRefundRecorded` (orders ⇒ orders worker) and `PackageRefundNoticeRequested`
  (orders ⇒ notifications) for the bell (46-3, `TODO(spec)` PK-Q5), with an ADR-0044 addendum and module-map §4 rows.
- **Ports:** `CatalogReaderPort` package-type read (TD-10, 42-1); `CustomerLookupPort.findByPhone` (TD-11, 47-1). Both
  widen existing arrows; module-map §3 rows and the generated YAML are updated in those PRs.
- **Consumed:** none in these rows besides the refund bell's own consumer. Row 50 consumes `PackageSaleChanged` and the
  redeemed lines.

### Permissions (all `TODO(spec)` until answered; recommended defaults)

| Code | Defaults | Question |
|---|---|---|
| `manage:package-types:business` (exists) | stop / resume selling | PK-Q12 |
| `sell:packages:branch` (new) | owner, general manager, business manager, branch manager, cashier | PK-Q13 |
| `record:service-sessions:branch` (exists) | redeem as part of a visit | PK-Q14 |
| `cancel:service-lines:branch` (exists) | cancel a redeemed line | PK-Q6 |
| `extend:packages:branch` (new) | owner, general manager, business manager, branch manager | PK-Q16 |
| `refund:packages:branch` (new) | owner, general manager, business manager, branch manager | PK-Q5 |
| `import:packages:business` (new) | owner, general manager, business manager | PK-Q18 |
| `record:` or `read:service-sessions:branch` (exist) | a customer's packages; amounts only with `read:` | PK-Q17 |

New codes go in `access-catalog.ts`, `role-defaults.ts`, `system-role-policy.ts`, the i18n permission names and a seeding
migration, as 0084 did; never held by a device; grantable to any human role.

### Error codes (`message_ar` / `message_en`, in `src/shared/errors.ts`)

- `PACKAGE_TYPE_NOT_SELLABLE` 422 — «الباقة دي متوقف بيعها.» / "This package is not on sale."
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
- **Integration** (one cloned database per spec file, ADR-0006): ST-01…ST-04, SA-01…SA-11, RD-01…RD-09, RC-01…RC-07,
  EX-01…EX-05, RF-01…RF-10, IM-01…IM-08, CP-01…CP-03; concurrency tests M5, M6, M9 with two real connections.
- **RLS negative**, per new table, and the grant allowlist; trigger negative tests: every forbidden slot transition,
  a second reversal, a lowered `expires_on`, `refunded_amount` above `price_paid`, an update of a value column.
- **Queries:** result shape + `EXPLAIN ANALYZE` index assertions for FR-070 and FR-071.
- **UI** (assert what the user sees, CLAUDE.md §9): stop/resume toggle and badge; sale form (price, discount warning,
  seller, method); «من الباقة» on a visit line with remaining count; customer packages list; extension and refund dialogs;
  import preview with row errors.

## 7. Delivery: the sub-PR split (at most three subtasks per PR)

Every row waits on this spec's merge and on the owner answers named in its "Blocked on" cell.

| PR | Result | Subtasks | Blocked on |
|---|---|---|---|
| **33b** | Stop / resume selling | 1. Contract + migration (`selling_stopped_at`, grant) + domain no-op rule. 2. Use cases, routes, ST tests. 3. Admin list toggle, badge, component tests | PK-Q12 |
| **42-1** | Contracts and map | 1. Sale contracts, `PackageSaleChanged` schema, worker known types, OpenAPI. 2. `CatalogReaderPort` package-type read (TD-10), module-map §3 row. 3. Error codes ar/en, permission codes + i18n labels | PK-Q2, PK-Q4, PK-Q13 |
| **42-2** | Storage | 1. Entitlements, components, slots: `CHECK`s, RLS, grants. 2. The entitlement and slot triggers (TD-5b, BR-03/04). 3. Negative RLS and trigger tests, allowlist, permission seed migration | **design advisors**; 42-1 |
| **42-3** | Sell | 1. Pure domain (discount, seller rule, expiry). 2. `SellPackageUseCase`, adapters, route. 3. SA-01…SA-11 | 42-2; PK-Q3, PK-Q11 |
| **42-4** | Reception sale screen + customer packages read | 1. Customer packages query + detail (FR-070/071) with `EXPLAIN`. 2. Sale form and picker of active types. 3. ar/en keys, component tests | 42-3; PK-Q17 |
| **43-1** | Redemption storage and contracts | 1. `package_redemptions`, `service_lines.redemption_id`, deferred FKs, triggers, RLS. 2. Widen the line `package` member in the three event schemas and the draft union. 3. Negative tests | **design advisors**; 42-2; PK-Q14 |
| **43-2** | Redeem in the record/append writer | 1. Domain (draft kind, expiry by visit date, line values). 2. Writer changes (component locks, slot, redemption). 3. RD-01…RD-09 incl. the M5 race | 43-1; PK-Q7 |
| **43-3** | Reception «من الباقة» | 1. Line toggle with the customer's packages and remaining count. 2. Suggest the earliest expiry. 3. Component tests | 43-2, 42-4; PK-Q15 |
| **44** | Cancel / edit / performers on redeemed lines | 1. 054 writer: reversal (FR-031) + RC-01…RC-05. 2. 35d refusal (FR-034), RC-06. 3. 055 per PK-Q8, RC-07 | 43-2; PK-Q6, PK-Q8 |
| **45** | Extend | 1. `package_extensions`, contracts, permission. 2. Use case, route, EX tests. 3. Admin dialog | 42-2; PK-Q1, PK-Q16 |
| **46-1** | Refund storage | 1. `package_refunds`, `package_refund_slots`, RLS, grants. 2. Contracts, error codes, permission. 3. Negative tests | **design advisors**; 43-1; PK-Q4, PK-Q5 |
| **46-2** | Refund | 1. Use case (FR-051…FR-055). 2. Route. 3. RF-01…RF-10 incl. M6/M9 races | 46-1; PK-Q10 |
| **46-3** | Refund bell + dialog | 1. Events, ADR-0044 addendum, module-map rows, template ar/en. 2. Consumer + ledger. 3. Admin refund dialog | 46-2; PK-Q5 |
| **47-1** | Import framework for packages | 1. `package_imports`, template, parser and row validation. 2. `CustomerLookupPort.findByPhone` (TD-11). 3. Permission | **design advisors**; 43-1; PK-Q18…PK-Q21, PK-Q9 |
| **47-2** | Import commit | 1. Worker commit use case. 2. Routes. 3. IM-01…IM-08 | 47-1 |
| **47-3** | Import screen | 1. Upload/preview/commit screen. 2. Row errors. 3. Component tests | 47-2 |

**File overlap:** 43-1 touches the line contracts of 050/054/055 (`packages/contracts/src/orders/service-session.ts` and
its cancel/performers refinements); 44 touches the 054, 35d and 055 writers. They run **one at a time** with any other
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
- Business timezone for every package date (TD-4); identical to the branch timezone in the pilot.
- The bell and dialog copy are proposed; changing them needs no migration.
- A redeemed line keeps the SS-Q2 self rule: a recorder cannot redeem a session she performs.
- Phase 1 has no production packages; the import (47) is how the pilot salon's open packages arrive (D-48, D-51).
- If PK-Q19 is answered «the type must exist», `package_type_id` becomes required for imports and FR-062 maps the
  row's name to a type; nothing else changes.
