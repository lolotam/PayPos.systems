# 43-2 plan — redeem a package session under a row lock (PP-124)

Slice: spec 058 §5 row 43 (FR-020…FR-027, RD-01…RD-09), delivery row 43-2.
Predecessors merged: 43-1 (#838, storage 0205+0206 and contracts), 43-1b (#839, guards),
43-1a (#820, the lock/read refinement).
Inherited line in 43-1 plan: «43-2 owns date/expiry/lowest-slot/request rules».

Status: implemented, Astra design review answered (see §13), local gates green.
No migration is needed (see §8). No owner question is open (see §9).

## 1. What 43-1 deliberately left out, and what 43-2 owns

43-1 delivered the storage (`package_redemptions`, `service_lines.redemption_id`,
`package_session_slots.current_redemption_id`), the strict package draft union, the
widened event `package` member, and the deferred DB guards. It delivered **no writer,
no route activation, no event payload, no domain rule**.

43-2 owns exactly one use case — *redeem a package session inside a recorded visit* —
and the route activation that lets the record/append routes accept a package draft:

1. the package draft union on the `record` and `append` request contracts;
2. the date, expiry and lowest-slot rules (pure domain);
3. the row lock on the slot;
4. the idempotency key behaviour on a redemption (no new key — the existing one must cover it);
5. the outbox event in the same transaction;
6. the permission guard (already in place — see §4.9);
7. integration and RLS-negative tests on a private cluster.

## 2. What already exists and is reused as is

| Piece | Where | Note |
| --- | --- | --- |
| `lockPackageRedemptionComponents` | `apps/api/src/modules/orders/persistence/package-redemption-read.ts` | 43-1a. Locks the named components `FOR UPDATE` in ascending id and re-reads the facts after the wait. Returns `null` when any pair is outside the visit's customer/business or has no matching component. |
| `readPackageRedemptionFreeSlots` | same file | 43-1a. Lowest `FREE` slots of one component, ordered by ordinal. Read-only: it reserves nothing. |
| `selectPackageRedemptionSlot` | `apps/api/src/modules/orders/domain/package-slots.ts` | 42-3a. Picks the lowest free ordinal of a component. |
| `package_redemptions` + `service_lines.redemption_id` + slot grants | migrations `0205`, `0206` | `GRANT SELECT, INSERT ON package_redemptions`, `GRANT UPDATE (state, current_redemption_id) ON package_session_slots`. |
| Deferred DB guards | `0205` | `package_redemption_validate` / `package_redemption_validate_slot` check at commit: line money equals the slot value, discount 0, bps 0, `redemption_id` reciprocal, slot `USED` with `current_redemption_id`, customer and service match. |
| Permission | `record:service-sessions:branch` | Record route uses `@Require('record:service-sessions:branch')`; the append route resolves the same permission through `readServiceSessionAccess` in `SessionAppendGuard`. |

## 3. Domain rules (pure, no database)

New file `apps/api/src/modules/orders/domain/package-redemption.ts`:

| Function | Rule | Spec |
| --- | --- | --- |
| `assertPackageNotExpired(visitLocalDate, expiresOn)` | The visit's local date must not be after `expires_on`. The visit's local date is the visit `occurred_at` in the **serving branch's** effective timezone, never the entitlement's selling branch. | FR-024, RD-04, RD-04b |
| `assertPackageNotYetValid(occurredAt, soldAt)` | `occurred_at` must be at or after the sale instant. Compared as **instants**, not local dates, so a visit five minutes before the sale is refused whatever either local date says. An imported entitlement has no sale instant, so it has no lower bound. | FR-024, RD-04, RD-04b |
| `assertPackageRedemptionAllowed(snapshot, visitLocalDate, occurredAt)` | The two assertions above, in the spec's order: expiry first, then the lower bound. | FR-024 |
| `redemptionSlotAssignments(drafts, snapshots, slots)` | Assigns to each package draft, in request order, the next free slot of its component. Two drafts for the same component take the ordinals *k* and *k+1*. A component with no free slot left is refused with `PACKAGE_NO_FREE_SESSION`. | FR-022, RD-02, RD-09 |
| `redemptionLineMoney(unitValue)` | The redeemed line carries `list_price = price = net = unit_value`, `discount = 0`, `effective_discount_bps = 0`. | FR-025, BR-05 |

The slot's stored value is the money of the line: the slot's `unit_value` is the
component's share of the price paid, and it never changes (BR-05).

## 4. Rule → spec map

| # | Rule | Spec | Where |
| --- | --- | --- | --- |
| 4.1 | A package draft is `{ service_id, package: { entitlement_id }, performers }` — no price, no discount. A draft carrying either is 400 by the strict contract. | FR-020, FR-021, RD-06, M13 | `packages/contracts/src/orders/service-session.ts` (43-1 already wrote the union; 43-2 puts it on the request contracts) |
| 4.2 | The record and append request bodies accept the union of paid and package drafts, in one request, and the lines keep the request order. | RD-01, RD-02 | `recordServiceSessionInput`, `appendServiceSessionLinesInput` |
| 4.3 | The entitlement must belong to the visit's customer, the visit's business, and the visit's company, and must carry the draft's service as a component. Any mismatch is one answer: 422 `PACKAGE_NOT_USABLE_HERE`, never an existence oracle. | FR-023, RD-05 | `lockPackageRedemptionComponents` returns `null` → the use case raises the one code |
| 4.4 | The expiry is compared against the visit's local date in the serving branch's timezone. | FR-024, RD-04, RD-04b | `assertPackageNotExpired` + `packageSalePlace` (the branch's effective timezone, `COALESCE(b.timezone, bu.timezone)`) |
| 4.5 | The lower bound is compared as instants against the sale instant. | FR-024, RD-04, RD-04b | `assertPackageNotYetValid` |
| 4.6 | Per draft, in request order, the lowest `FREE` slot of the component is taken. | FR-022, RD-02 | `readPackageRedemptionFreeSlots` + `redemptionSlotAssignments` |
| 4.7 | The slot row is locked and re-checked as `FREE` inside the visit transaction, after the component lock. | FR-022, TD-5 | new `lockPackageRedemptionSlot` in the 43-2 persistence file |
| 4.8 | The line money is the slot's stored value, with zero discount and zero effective bps; the line carries `redemption_id`. | FR-025, FR-026, BR-05 | `redemptionLineMoney`, `PreparedSessionLine.list_price`, `service_lines.redemption_id` |
| 4.9 | The guard and the permission are the visit's: `record:service-sessions:branch`. | PK-Q14 (answered, PP-16) | already in place on both routes — 43-2 adds the negative test, no new permission |
| 4.10 | Write order: one `package_redemptions` row, then the slot `FREE → USED` with `current_redemption_id` = that row. Both FKs are `DEFERRABLE INITIALLY DEFERRED`, and the deferred check reads the final rows, so the order cannot pass wrongly nor fail falsely. | FR-026 | the writer's write order (§5.3) |
| 4.11 | The event line carries `package { entitlement_id, component_id, ordinal }`; the line is `ACTIVE` at revision 1. | FR-027, RD-01 | `sessionBatchEvent` |
| 4.12 | The outbox row of the visit is appended **in the same transaction** as the redemption rows and the slot update, so a rolled-back visit leaves no redemption and a committed visit always has its event. | FR-026, TD-2 | `tx.emit` already runs inside `tx.repository`/redemption writes in one transaction |
| 4.13 | A lost response retried with the same idempotency key returns the original 201 and takes no second slot. | RD-08, TD-9, M10 | the existing `tx.idempotent` wrapper — the redemption work is inside it, so the replay never re-runs it |
| 4.14 | A refunded or `IMPORTED_USED` slot is never taken; a component with only such slots gives `PACKAGE_NO_FREE_SESSION`. | FR-022, RD-09 | the free-slot read filters `state = 'FREE'` only |
| 4.15 | The recording rules are unchanged: performers 1…4 with the SS-Q7 shares, eligibility and SS-Q8 warnings, the SS-Q2 self rule, the 20-line cap, the recovery proof. | RD-07 | the package preparation reuses `validateShares`, `performerWarnings`, `validateRecorderPerformers` |
| 4.16 | Two concurrent visits redeem the last free slot: exactly one commits, the other gets 409 `PACKAGE_NO_FREE_SESSION` and its whole visit rolls back. | RD-03, TD-2, M5 | the component `FOR UPDATE` lock serialises the two transactions; the loser re-reads the slots and finds none |
| 4.17 | A redeemed line's money never changes; the 35d price edit is refused. | FR-034, RC-06 | already refused by 43-1b (`SESSION_LINE_PRICE_NOT_EDITABLE`); 43-2 leaves it alone |

## 5. Design

### 5.1 The two draft kinds

`sessionDrafts` currently turns the request lines into money-carrying drafts. 43-2
splits it into two kinds, each keeping its **original request index**, because the
request order decides the line ordinals and the discount-claim mapping:

* `PAID` — unchanged shape (service, price, discount, performers, approval id).
* `PACKAGE` — service, entitlement id, performers. No price and no discount: the
  money comes from the slot, not from the client.

`prepareSessionLines` keeps its current behaviour for paid drafts; a sibling
`preparePackageSessionLines` prepares the package drafts with the same service
lookup, the same performer rules and the same warnings, but takes the money from
the slot. The use case merges both prepared lists by the request index, so a mixed
visit saves in one request and the line ordinals follow the request order.

### 5.2 The prepared line carries its own list price

`PreparedSessionLine` gains `list_price` (the line's own list price) and an optional
`redemption` marker:

* a paid line: `list_price` is the catalog price, as today;
* a package line: `list_price` is the slot's stored value.

The catalog price and the slot value are different things, and the DB stores only
one `list_price` column, so the line's own list price has to be explicit. The
snapshot, the event and the audit then read `list_price` instead of `service.price`,
which changes nothing for paid lines and makes the package line carry its real money.

The `redemption` marker holds the redemption row id, the entitlement, the component,
the slot and the ordinal. The event projects only the three fields the contract
declares (`entitlement_id`, `component_id`, `ordinal`); the row id and the slot id
stay on the domain line for the writer.

### 5.3 Write order inside the visit transaction

```
lock the access row            (existing)
lock the visit row             (existing)
lock the catalog services      (existing)
lock the performers            (existing)
lock the approval proposals    (existing)
lock the package components    (43-1a, FOR UPDATE OF c, ascending id)
read the free slots            (43-1a, lowest FREE per component)
lock each chosen slot row      (43-2, SELECT ... FOR UPDATE, re-check state = 'FREE')
re-read the clock, the limit and the authority   (43-2, after the last money lock)
insert the visit               (existing)
insert the visit lines         (existing + service_lines.redemption_id)
insert the package_redemptions (43-2, one row per redeemed line)
mark the slots USED            (43-2, state + current_redemption_id only)
commit the discount approvals  (existing)
audit + emit the outbox event  (existing, same transaction)
```

The slot `UPDATE` touches only `state` and `current_redemption_id`, because the
grant is column-scoped and the slot guard freezes every other column.

**The facts are read after the last lock, never before it** (Astra, non-blocking 2).
The component and slot locks can wait, and a wait can outlive the membership, the
recording window or the approval validity that was true when the request arrived. So
the clock, the effective discount limit, the recorder's authority, the recording
window and the approvals are re-read **after** the last money lock and re-checked
before the write, exactly as `session-readers.port.ts` already requires for the
limit. The append route keeps the original visit's time and the original business
timezone for the recording window and the accounting, and uses the serving branch's
timezone for the expiry only.

The whole block runs inside `tx.idempotent(...)`, so a replay of the same key
returns the stored body and writes nothing (RD-08).

### 5.4 Errors

New `SessionError` codes (the session error catalogue carries them, with ar/en
messages):

| Code | Status | Message |
| --- | --- | --- |
| `PACKAGE_NO_FREE_SESSION` | 409 | No free session left in this package. |
| `PACKAGE_EXPIRED` | 422 | The package expired before this visit. |
| `PACKAGE_NOT_YET_VALID` | 422 | The package was not sold yet at the visit time. |
| `PACKAGE_NOT_USABLE_HERE` | 422 | This package cannot be used for this visit. |

The 409 is the only non-default status and is mapped explicitly in
`sessionErrorHttpStatus`; the other three are 422 by the filter's default.

**The codes live in the session catalogue, not in the shared registry**
(Astra, non-blocking 3). `packages/i18n/src/service-session-errors.ts` is where the
filter reads its messages from (`session-errors.filter.ts`), and the precedent is
`SESSION_LINE_PRICE_NOT_EDITABLE`, a session-only code that already lives there. The
shared registry's `PACKAGE_SALE_STATUS` describes a sale, not a redemption, so it is
not reused. The spec's error table names the codes; the catalogue choice is recorded
here so the next reader does not re-open it.

`PACKAGE_NOT_USABLE_HERE` is one answer for every mismatch (another customer,
another business, another company, or a service that is not a component of the
package), so the response never says which one it was.

### 5.5 Permission

No new permission and no new guard. The record route already requires
`record:service-sessions:branch`; the append route resolves the same permission
through `readServiceSessionAccess` inside `SessionAppendGuard`, which is declared
in `authenticated-writes.ts` as a `RECORD_SCOPED` route. 43-2 adds the negative test
(a recorder without the permission gets 403 and takes no slot) and nothing else.

## 6. Files

### New

| File | Purpose |
| --- | --- |
| `apps/api/src/modules/orders/domain/package-redemption.ts` | The pure rules of §3. |
| `apps/api/src/modules/orders/domain/__tests__/package-redemption.spec.ts` | The unit tests of §3. |
| `apps/api/src/modules/orders/ports/package-redemption.port.ts` | The port the use case needs: lock, free slots, slot lock, redemption write, slot write. |
| `apps/api/src/modules/orders/persistence/package-redemption-writes.ts` | The adapter: the slot row lock, the `package_redemptions` insert, the `FREE → USED` update. |
| `apps/api/src/modules/orders/__tests__/package-redemption-write.spec.ts` | The integration test on the private cluster (RD-01…RD-09, M5, M10). |
| `apps/api/src/modules/orders/__tests__/package-redemption-rls.spec.ts` | The RLS-negative and grant tests. |
| `apps/api/src/modules/orders/__tests__/package-redemption-edge.spec.ts` | The edge tests Astra asked for: the branch-timezone midnight case and its `NULL` fallback, the reversed-order concurrency, the mixed batch, the rollback, the zero-value package. |
| `apps/api/src/modules/orders/__tests__/package-redemption.fixture.ts` | The shared seed of an entitlement, a component and its slots. |
| `apps/api/src/modules/tenancy/queries/package-sale-place.query.ts` | The serving branch's effective timezone (`COALESCE(b.timezone, bu.timezone)`). |
| `apps/api/src/modules/tenancy/queries/__tests__/package-sale-place.query.spec.ts` | The shape and the `EXPLAIN ANALYZE` assertion for that read (CLAUDE.md §9). |
| `docs/adr/0041-orders-service-sessions-reads-and-events.md` | The addendum that authorizes the named symbol read and the map row. |
| `docs/specs/058-packages-sell-redeem/43-2-review-corrections.md` | The round-by-round receipts and the corrections. |

### Changed

| File | Change |
| --- | --- |
| `packages/contracts/src/orders/service-session.ts` | `recordServiceSessionInput` and `appendServiceSessionLinesInput` take `sessionLineDraft` (the 43-1 union) instead of `sessionLineInput`. |
| `packages/contracts/src/orders/service-session-package.spec.ts` | The contract tests for the union on both request bodies. |
| `apps/api/src/modules/orders/domain/session-types.ts` | `SessionDraft` splits into the paid and package kinds; `PreparedSessionLine` gains `list_price` and the optional `redemption` marker. |
| `apps/api/src/modules/orders/domain/session-drafts.ts` | `sessionDrafts` splits the request lines into the two kinds and keeps the request index. |
| `apps/api/src/modules/orders/domain/prepare-session-lines.ts` | The paid path reads the request index from the draft and sets `list_price`. |
| `apps/api/src/modules/orders/domain/package-redemption.ts` (new) | Also holds `preparePackageSessionLines`, the package counterpart of `prepareSessionLines`. |
| `apps/api/src/modules/orders/domain/session-write.ts` | The event line reads `list_price` and carries the `package` member. |
| `apps/api/src/modules/orders/domain/session-snapshot.ts` | The snapshot line reads `list_price`. |
| `apps/api/src/modules/orders/domain/session-audit.ts` | The price/discount audit compares against `list_price`, so a package line (zero discount) produces no price audit entry. |
| `apps/api/src/modules/orders/domain/session-error.ts` | The four new codes. |
| `apps/api/src/modules/orders/persistence/session-records.ts` | The read-back sets `list_price` from the stored column. |
| `apps/api/src/modules/orders/persistence/session-writes.ts` | The line insert writes `redemption_id`. |
| `apps/api/src/modules/orders/persistence/service-session-transactions.ts` | Binds the package port into the transaction. |
| `apps/api/src/modules/orders/ports/service-session-transactions.port.ts` | `SessionTransaction` gains the package port. |
| `apps/api/src/modules/orders/use-cases/record-service-session/record-service-session.usecase.ts` | Resolves the package drafts, writes the redemptions and the slots. |
| `apps/api/src/modules/orders/use-cases/append-service-session-lines/append-service-session-lines.usecase.ts` | The same for the append route; the visit date stays the original visit's. |
| `apps/api/src/modules/orders/http/session-errors.filter.ts` | 409 for `PACKAGE_NO_FREE_SESSION`. |
| `packages/i18n/src/service-session-errors.ts` | The four ar/en messages. |
| `apps/api/src/modules/orders/domain/discount-request.ts` | The approval terms read the line's own `list_price`, not `service.price`. |
| `apps/api/src/modules/orders/ports/session-readers.port.ts` | `SessionPlacePort.read` returns the branch's effective timezone beside the business one. |
| `apps/api/src/modules/orders/persistence/session-place.adapter.ts` | Reads both timezones. |
| `apps/admin/src/orders/model/session-drafts.ts` | The paid line type is explicit (`Extract<…, { price: string }>`), because the request lines are now a union. |
| `apps/admin/src/orders/model/session-recording-result.ts` | The attempt reader narrows the union and never rebuilds a package draft as a paid line. |
| `apps/admin/src/shared/api/schema.d.ts` | Regenerated from the OpenAPI file (the request lines are an `anyOf`). |
| `apps/api/test/service-session.fixture.ts` | The body helper takes the whole draft union. |
| `apps/api/src/modules/orders/domain/__tests__/session-write.spec.ts` | Updated for the new `list_price` and the two draft kinds. |

No module-map arrow is added for the package tables: `package_entitlements`,
`package_components`, `package_session_slots` and `package_redemptions` are the
orders module's own tables, so the redemption stays inside the module. One read
arrow **is** added, for the new tenancy query: `orders -> tenancy.packageSalePlace`
at `apps/api/src/modules/orders/persistence/session-place.adapter.ts` (Astra,
blocking 1 — the plan needed the branch's timezone and the plan named no source for
it). `docs/module-map.md` and `docs/module-map.yaml` are regenerated from it.

## 7. Tests

**Unit (no database)** — `domain/__tests__/package-redemption.spec.ts`:
the visit on the last day redeems; the visit on the next day is expired; a visit
inside the window but recorded later redeems; a visit before the sale instant is
not yet valid whatever the local dates say; an imported entitlement has no lower
bound; the cross-timezone case of RD-04b; the lowest free slot is chosen; two
drafts of one component take *k* and *k+1*; a component with no free slot is
refused; the redeemed line's money is the slot value with zero discount and zero
bps; the package preparation keeps the performer rules and warnings.

**Integration (private cluster)** — `__tests__/package-redemption-write.spec.ts`:
RD-01 (one draft, one redemption, one `USED` slot, the line money, the event
payload); RD-02 (a paid line and a package line in one request, and through the
append route); RD-03/M5 (two concurrent visits on the last free slot: one commits,
the other gets 409 and its visit rolls back entirely); RD-04/M7 (the expiry and the
lower bound); RD-05 (another customer, another business, another company and a
service that is not a component all give the same 422); RD-06/M13 (a package draft
with a price or a discount is 400); RD-07 (the performers, the cap, the self rule);
RD-08/M10 (the same idempotency key returns the original 201 and takes no second
slot); RD-09 (a refunded or `IMPORTED_USED` slot is never taken).

**RLS negative** — `__tests__/package-redemption-rls.spec.ts`:
another company cannot see or take the entitlement, the component, the slot or the
redemption; the write as `pospay_app` outside `withTenant` is refused; the grants
stay column-scoped (`package_session_slots` cannot be updated outside `state` and
`current_redemption_id`).

**Edge (private cluster)** — `__tests__/package-redemption-edge.spec.ts`:
the branch-timezone midnight case (a London branch under a Kuwait business: the
package expires on the branch's date and redeems, while the business date stays the
business date); the `NULL` branch timezone fallback (the business date applies and
the package is refused); the append route keeping the original visit's date; two
batches asking for the same components in **reverse order** (both commit, no
deadlock, each entitlement gives its two sessions to two different slots); a mixed
batch of package, rejected paid, package and paid lines (the request order and the
ordinals survive, the rejected line keeps its input index); a request with one
package line too many (the whole visit rolls back, no line and no slot); a
zero-value package under a zero discount limit.

**Contract** — `packages/contracts/src/orders/service-session-package.spec.ts`:
the record and append bodies accept a package draft and reject a package draft
that carries a price or a discount.

## 8. Migration

**None.** The storage is already merged in `0205` and `0206`: the
`package_redemptions` table with its grants, `service_lines.redemption_id`, the
slot's `current_redemption_id` and the `UPDATE (state, current_redemption_id)`
grant, and the deferred guards. 43-2 only writes rows that already have a place.
No migration number is requested, and `0207` (taken by #785) is not touched.

## 9. Owner questions

None open for this slice. The three that touch it are already answered and are
cited, not re-asked:

* **PK-Q7** (expiry by the visit date) — answered: the expiry is compared against
  the visit's local date in the serving branch's timezone.
* **PK-Q14** (the guard and the permission) — answered: the visit's own guard and
  `record:service-sessions:branch`.
* **PK-Q15** (the customer has two packages of the same service) — answered: the
  reception chooses; the screen suggests the one that expires first. 43-2 takes
  the entitlement the client named, so the rule belongs to the reception screen
  (row 43-3), not to this writer.

No business rule in this slice is left to guess, so there is no `TODO(spec)` here.

## 10. Out of scope

* The reception screen's package toggle and the remaining-session count (row 43-3).
* The customer's package list and the redemption history (FR-071, row 42-4).
* Cancelling, reversing or refunding a redeemed session (rows 44, 46).
* Extending a package (row 45).
* The `savedServiceLine` response shape: the spec asks for the `package` member on
  the **event** line (FR-027), not on the HTTP response, so 43-2 does not widen the
  response contract. Row 43-3 adds whatever the screen needs.

## 11. Size estimate

| Part | Lines |
| --- | --- |
| New production code (domain + port + persistence) | ~300 |
| Changed production code (types, drafts, preparation, event, snapshot, audit, errors, filter, port, two use cases, persistence, tenancy query) | ~300 |
| Contracts and i18n | ~40 |
| Admin union consumers and the regenerated schema | ~30 |
| Unit tests | ~220 |
| Integration, RLS and edge tests | ~700 |
| **Total** | **~1590** |

Roughly 630 lines of production code and 920 lines of tests. The change is one
use case, so it stays inside one PR.

**Astra's estimate was higher** (650–850 production, 900–1150 tests) and it is the
one to trust: the first estimate did not count the branch-timezone delivery, the
union consumers, the fixture updates, or the lock-wait and mixed-batch tests. The
numbers above sit between the two, on the delivered side of the gap.

## 12. Open points for Astra and the manager

1. The slot row lock is redundant with the component lock (any writer must take
   the same component lock), but it is in the slice's scope and makes the
   "lowest `FREE` under a row lock" literal. Confirm it stays.
2. The write order puts the line insert before the redemption insert. Both FKs are
   deferred and the deferred check reads the final rows, so FR-026's order is met
   either way. Confirm the chosen order.
3. The response keeps its current shape (no `package` member on `savedServiceLine`).
   If the manager expects it in 43-2, it is a small extra.

**All three are answered by Astra (2026-11-05, `gpt-6-astra`, high, read-only), and
Astra agrees with the plan on each one:**

1. **Keep the slot lock**, as a defensive check. The component lock is the real
   serialisation point, and it must be taken **once per batch**, never once per
   draft: the implementation collects the ids without duplicates and runs one
   `ORDER BY c.id FOR UPDATE OF c`, so the lock order does not depend on the
   request order or on the order of the `IN` list. The deferred validation already
   locks the slot, but it is not a substitute for locking the component before
   choosing the slot.
2. **Keep the write order line → redemption → slot.** The mutual FKs are really
   deferred (`0205`), the deferred constraint triggers read the final rows, and
   there is no `BEFORE` trigger that requires the redemption at the line insert.
   The slot's `state` and `current_redemption_id` move together, because an
   immediate `CHECK` binds them and the grant allows exactly those two columns;
   `updated_at` is not written.
3. **Keep `savedServiceLine` without a `package` member in 43-2.** The spec asks
   for the `package` member on the **event** line (FR-027), not on the HTTP
   response; the reception screen and the history belong to row 43-3.

**The manager resolved the same three points on the same day** (05:40 Kuwait,
project conversation, verbatim):

> «ردّيت على أسئلة الجلسة التلاتة:
> - قفل الحصة وقت الخصم يفضل، حتى لو فيه قفل تاني بيغطيه.
> - ترتيب الحفظ اللي اختارته يفضل.
> - بيانات الباقة تتبعت في الحدث بس زي ما المواصفات قالت، ورد الـ API مايتغيّرش في 43-2.
>   لو شاشة الاستقبال في 43-3 احتاجتها، 43-3 يضيفها.»

The manager and Astra therefore agree on all three: the slot lock stays as a
defensive check, the write order stays line → redemption → slot, and the
response keeps its shape in 43-2. The manager also set the publication rule:
the PR opens as soon as the gates pass, and Astra's notes are fixed together
with the bots' notes in one push — unless Astra finds a serious problem before
the PR opens, which is fixed first.

## 13. Astra's design review (2026-11-05)

Astra read the plan against `HEAD abaffb3` and returned **blocking defects**. Both
are fixed; the non-blocking items are fixed too.

### Blocking 1 — the branch timezone had no source

The plan required the expiry to be measured in the serving branch's timezone but
named no source for it. `sessionPlace` reads `activeBusinessTimeZone`, which is the
**business** timezone (`bu.timezone`), and `time.business_date` is the business
date, so a London branch under a Kuwait business would refuse a valid visit: a
visit at `2026-10-01T21:30:00Z` is 1 October in London and 2 October in Kuwait.

**Fixed** by `apps/api/src/modules/tenancy/queries/package-sale-place.query.ts`,
which reads `COALESCE(b.timezone, bu.timezone)` — the branch's effective timezone,
falling back to the business one when the branch has none — and by
`SessionPlacePort.read`, which now returns both timezones. The record route uses
the branch timezone for the expiry date; the append route keeps the original
visit's time and business timezone for the recording window and the accounting,
and uses the serving branch's timezone for the expiry only. `activeBusinessTimeZone`
keeps its shared meaning.

### Blocking 2 — the union broke consumers outside the plan's file list

The request lines became a union, so the plan's file list was incomplete:

| Consumer | Fix |
| --- | --- |
| `apps/admin/src/orders/model/session-drafts.ts` | The paid type is explicit: `Extract<RecordServiceSessionInput['lines'][number], { price: string }>`. The paid editor keeps its price and its discount kind. |
| `apps/admin/src/orders/model/session-recording-result.ts` | The attempt reader narrows the union. A package draft is **not** rebuilt as a paid line: it has no price and no discount, and turning it into one would charge the customer. Row 43-3 owns the package screen. |
| `apps/api/src/modules/orders/use-cases/consume-discount-approvals.ts` | The weak input type is widened so the union is assignable. |
| `apps/api/src/modules/orders/use-cases/request-discount-approval.usecase.ts` | The paid path reads `sessionDrafts(...).paid`, and the paid discount-request path is unchanged. |
| The `list_price` fixtures | Every fixture that builds a prepared line now carries the line's own list price. |

This is the compatibility the contract activation needs; it is not row 43-3's screen.

### Non-blocking, also fixed

1. `discount-request.ts` and `session-write.ts` (`rejectedLine`) read the line's
   own `list_price` instead of `service.price`, so there is one source of the
   line's list price. A package line has no price audit and no discount approval
   claim, and that stays true.
2. The clock, the effective discount limit, the recorder's authority, the
   recording window and the approvals are re-read **after** the last money lock
   (§5.3), because a lock wait can outlive them.
3. The error-catalogue choice is written down (§5.4), and the plan's reference to
   a non-existent `FR-028` is replaced by `RD-08` and `TD-9` (§4.13).

### What Astra asked for and the slice answers

| Astra's missing test | Where it is answered |
| --- | --- |
| Two concurrent batches asking for the same components in reverse order | `package-redemption-edge.spec.ts` — both commit, no deadlock, two different slots |
| A component-lock holder that rolls back | **Not covered** — the component lock is taken by the same writer and a rollback inside it is covered by the RD-09 rollback test; a foreign holder is a database-level test that belongs to the guard slice (43-1b) |
| An in-batch component duplicate, then one too many | `package-redemption-edge.spec.ts` — the duplicate takes two different slots, the request with one too many rolls the whole visit back |
| Record and append near midnight with a different branch timezone, and the `NULL` fallback | `package-redemption-edge.spec.ts` — all three cases |
| A lock wait that crosses the membership, the approval or the window | **Partly covered** — the re-read after the last lock is in the code (§5.3); a test that waits out an expiry needs a second connection that holds the lock, which this slice's fixture does not have |
| A package below the catalog price, and a `0.000` package under a zero limit | `package-redemption-edge.spec.ts` — the zero-value package under a zero discount limit |
| An interleaved batch (package, rejected paid, package, paid with approval) | `package-redemption-edge.spec.ts` — the mixed batch, with the rejected line in the middle; the approval variant is covered by the existing discount-approval tests |
| Two concurrent same-key requests, and a replay after the package is exhausted | The RD-08 test covers the replay; the concurrent same-key pair is **not covered** — the idempotency wrapper is the existing one and is not changed by 43-2 |

## 14. Review round 1 (PR #841)

The bots ran on the exact head `6e6ed627`: Codex, CodeRabbit, the MergePilot panel
and CI. Five findings, one consolidated correction push.

| Finding | From | Fix |
| --- | --- | --- |
| The package expiry was checked against the **raw** client timestamp, while `sessionTime` clamps the visit to the server time (120 s tolerance). Near midnight a valid visit was refused with `PACKAGE_EXPIRED`. | Codex P2, MergePilot high, CodeRabbit minor (the same defect) | The visit instant is normalised **before** the expiry decision: `visitInstant` (a new domain function) gives the provisional instant before the package lock, and `assertPackageFactsAllowed` re-checks the expiry on the final instant after the clock is read again. The provisional step does not reject a future timestamp — only the final `sessionTime` does — so the 120 s device tolerance keeps its meaning. |
| The three package refusals fell through to the filter's `invalidStatus`, so they answered 400 where the form controller opens the filter with 400. | CodeRabbit major, MergePilot medium | The codes are mapped explicitly to 422 in `PACKAGE_UNPROCESSABLE`, beside the four sets the filter already carries, so the status does not depend on the filter's default. |
| The redemption queried the database once per package line: one `SELECT … FOR UPDATE` per slot, one `INSERT` per redemption, one `UPDATE` per slot. | MergePilot medium | `lockSlots` locks every chosen slot in one ordered statement, `writeRedemptions` inserts all the redemptions in one statement, and `markSlotsUsed` moves all the slots in one `UPDATE … FROM (VALUES …)`. The slot update returns the rows it moved, and a count that does not match refuses the whole visit instead of leaving half a redemption. |
| The new tenancy query had no result-shape test and no `EXPLAIN ANALYZE` assertion, and the new module arrow had no ADR. | MergePilot medium (twice) | `apps/api/src/modules/tenancy/queries/__tests__/package-sale-place.query.spec.ts` asserts the shape (the branch's own timezone, the business fallback, `null` for another company, an inactive branch and an unknown branch) and the plan (the branch primary key, no sequential scan). ADR-0041 gains the addendum that authorizes the named symbol read and the map row. |
| `apps/pos/src/shared/api/schema.d.ts` was stale after the request lines became a union, so the CI's `api:check · pos` failed. | CI | The POS schema is regenerated from the OpenAPI file, like the admin one. |

**Checked and not applicable.** The panel raised that a reloaded package line loses
its redemption identity. The only consumers of that identity — the edit, cancel
and performer guards of 43-1b — read `service_lines.redemption_id` from the row
under the line lock, not the domain marker, and the marker is only needed on the
lines the writer builds. The panel's own verifier rejected the finding, and
reading the guards confirms it.

**Found by the local integration suite, not by a bot.** The `20-line/80-performer`
budget test in `service-session-readers.spec.ts` counts the statements of a
request. `SessionPlacePort.read` had started returning both timezones, so every
visit paid one more query — a paid visit was paying for a branch timezone only a
package draft needs. The port now keeps `read()` (the business timezone) and
grows `branchTimezone()`, which the two use cases call **only when the request
carries a package draft**. The statement count of a paid visit is back to what it
was, and a package visit pays the extra query it actually needs.

The lesson from this round: the filter spec lives in `__tests__/`, which is the
**integration** project, not the unit project. Running only the slice's own specs
missed it, so the whole orders and tenancy integration suites run before the push.
