# Spec 050 — Record a service session (Phase 1 row 35)

> **Status:** Draft · 2026-10-12 · owner questions SS-Q1…SS-Q11 **PENDING** in
> [owner-questions.ar.md](owner-questions.ar.md) (next batch on the decisions page, posted by the orchestrator).
> Every rule marked `TODO(spec) SS-Qn` waits for that answer; nothing marked so may be implemented on a guess.
> **Phase 1 row:** 35 `record-service-session` — "effective discount up to the limit only; above it refused" · size L.
> **Depends on:** rows 32 (services), 34 (customers find-or-create), 9 (employees and branches), 7b/7c (discount
> limits) — all merged.
> **Later rows that build on it:** 36 tips · 37 cancel line · 37b change performers · 38–41 discount approval above the
> limit · 42–47 packages (redemption lines, row 43) · 50 commission projection · 57 staff app · 59 rating scheduling.

## 1. Scope

**This slice does:** the receptionist records one visit of one customer at one branch: one or more service lines,
each with its price, its discount and its performer(s) with shares. The line is written with its snapshots (list
price, service commission rule, threshold flag), its effective discount is checked against the recorder's limit, and
one `ServiceLineChanged` event per line is written to the outbox in the same transaction.

**This slice does NOT:**

| Not here | Where |
|---|---|
| Tips | row 36 |
| Cancelling a line | row 37 |
| Changing performers or shares after recording | row 37b |
| Recording a discount above the limit (proposal, PIN, remote approval, consumption) | rows 38–41 — here it is **refused** |
| Package sale and package redemption lines (`redemption_id`) | rows 42, 43 |
| Commission projection, estimate, statements, corrections | rows 48a–55 |
| Rating scheduling | rows 59, 59b |
| Payments, payment method, receipt printing, POS sell screen | Phase 2 (SPEC §2 Out) |
| Service barcode | Phase 2 (D-15) |
| Editing a recorded price or discount | none planned — see SS-Q10 |

## 2. Decisions already made (not asked again)

- **Customer is required** on every session (D-43; SPEC §4 `ServiceSession.customer_id`). Reception finds or creates
  her first through `customers`' own endpoint (row 34, spec 010/022); `orders` only checks `exists(customerId)`
  through `CustomerLookupPort` (ADR-0010). Staff see her name only; the phone is masked to its last 3 digits
  everywhere except the customer entry form (D-43, SPEC R1).
- **Reception may override the price** (D-44); every price override and discount records the actor and time (M1;
  `CLAUDE.md` §8 audit of prices and discounts).
- **Effective discount of a line = (list_price − net) / list_price** — lowering the price counts too; 0 % when
  `list_price = 0`; a price above list is 0 % (D-56, SPEC §4, M13, spec 016). Checked **per line, never per session**
  (spec 016 business rules).
- **Fractional bps round UP when enforcing** the limit: any fraction above the limit is above it (owner decision
  2026-10-03, spec 016). This is not money rounding (ADR-0005).
- **The limit:** active owner → unlimited; else the person's own limit; else the business default; else
  `NOT_CONFIGURED`, which this row enforces as **0 %** — every positive discount is above the limit (owner decision
  2026-10-03, spec 018). Resolution is `settings`' `readEffectiveDiscountLimit(tx, companyId, businessId,
  membershipId)` inside the session's tenant transaction (spec 018 FR-006).
- **Above the limit the line is refused** in this row (plan row 35). Approval and its consumption in the same
  transaction are rows 38–41 (M2).
- **Shares:** split equal by default; the manager may change shares (D-14); Σ `share_bps` = 10000 per line (SPEC §4).
  Commission is on the line net after discount; tips excluded (D-14).
- **Performer check:** every performer is an employee **active and attached to the session's branch on the session
  date** (`PerformerCheckPort`, SPEC §3, ADR-0010) — `employee_branches.from ≤ date < to`, not soft-deleted, within
  hire/contract dates. Being clocked in is **not** part of the SPEC check (see SS-Q8).
- **Late entry:** a forgotten session may be recorded with its real date until the period is approved, **flagged as
  late and shown to the manager**; after approval it lands in the next period as a correction (D-49, M3). The
  correction itself is the commissions consumer's job (rows 50, 55); this row records `occurred_at`, `recorded_at`
  and `late`.
- **Snapshots on the line:** `list_price`, `rule_snapshot` (service commission rule) and `counts_snapshot` (threshold
  flag) are copied from the service at record time through `CatalogReaderPort`; a later service edit never changes a
  recorded line (SPEC §6 "Service rules are snapshots on each line"; spec 031 SV-10).
- **Dates are business dates** in the business timezone (D-10, SPEC §5); display in the branch timezone.
- **Sessions are not payments** (SPEC §2 Out). No payment method is recorded here; tips (row 36) carry their own
  method (D-36).
- **Reception = the `cashier` system role** (ADR-0036, spec 019 amendment).

## 3. Open questions (owner) — all PENDING

| ID | Topic | Recommended (⭐) | Blocks |
|---|---|---|---|
| SS-Q1 | How row 35 is split into PRs | 35a write API · 35b day list read · 35c reception screen | the plan |
| SS-Q2 | Who may record a session | new `record:service-sessions:branch`; owner, GM, business manager, branch manager, cashier | FR-002, migration |
| SS-Q3 | Which screen / device | `apps/admin` web screen on the reception computer, own login | 35c |
| SS-Q4 | How price and discount are entered | price (pre-filled, editable) + discount as amount **or** percent per line, plus a "same % on all lines" shortcut | FR-005, contract |
| SS-Q5 | Rounding a percent discount to mills | round the discount **down** to the mill | FR-006 |
| SS-Q6 | What happens above the limit before rows 38–41 | whole session refused, nothing saved; the message names the line and the recorder's maximum | FR-008 |
| SS-Q7 | Performers and shares at recording | equal split pre-filled, reception may change it; remainder bps to the first performer listed; every share ≥ 1 bps; up to 4 performers per line | FR-009, FR-010 |
| SS-Q8 | Performer not clocked in / on approved leave that day | allowed, with a warning on the screen and a flag on the line | FR-011 |
| SS-Q9 | Session time, "late", how far back, future times | time defaults to now and is editable; late = business date before the recording day; back to the 1st of the previous month; future refused | FR-012…FR-014 |
| SS-Q10 | Fixing a mistake / adding a service later | no edit: cancel the line (row 37) and record again; a later service is a new session | FR-016 |
| SS-Q11 | How the manager sees late entries | a «متأخر» badge and a filter on the day list, no notification | 35b |

## 4. The salon example used throughout

Business «صالون الأميرة», branch **السالمية** (timezone Asia/Kuwait). Receptionist **منى** (role `cashier`, personal
discount limit **10.00 %** = 1000 bps). Branch manager limit 20 %; the owner is unlimited.

Services: **صبغة شعر** 25.000 KWD (rule `FOLLOW_PLAN`, counts) · **مناكير** 7.125 KWD (`PCT` 1000 bps, counts) ·
**رموش** 15.000 KWD (`FOLLOW_PLAN`, counts) · **استشارة** 0.000 KWD (`ZERO`, does not count).

Performers: **سارة** (hair), **هبة** (nails), **Reem / ريم** (lashes) — all attached to السالمية.

Customer: **نورة**, phone shown as `•••• •123` outside the entry form.

## 5. User stories and acceptance scenarios

### US-1 — Record a visit with several services (P1)

On 2026-10-14 at 11:00 نورة has صبغة by سارة, مناكير by هبة, and رموش by ريم and هبة together. منى finds نورة by phone,
adds the three lines and saves.

- **SS-01** The session is saved with three ACTIVE lines, each `revision = 1`; `recorded_by` = منى, `recorded_at` =
  server time, `occurred_at` = 11:00 Kuwait, `late = false`.
- **SS-02** رموش has performers ريم 5000 bps and هبة 5000 bps (equal split default, D-14).
- **SS-03** Each line carries `list_price` = the service price at that moment, `rule_snapshot`, `counts_snapshot`.
- **SS-04** Three `ServiceLineChanged` outbox rows (one per line, `revision = 1`) commit in the same transaction as
  the lines; a failure anywhere rolls back everything (session, lines, performers, audit, outbox, idempotency claim).
- **SS-05** The response returns the session with names (ar/en), nets and each line's effective discount in bps; the
  customer phone is masked.

### US-2 — Discount within the limit (P1)

- **SS-06** صبغة 25.000 with discount 2.500 → net 22.500 → effective 1000 bps = منى's limit → **saved** (the limit
  is inclusive, spec 016).
- **SS-07** منى overrides the price of صبغة to 22.500 with no discount → net 22.500 → 1000 bps → saved; the line
  stores `list_price 25.000`, `price 22.500`, `discount 0.000`, `net 22.500`; one audit entry records the price
  override with منى and the time (M1).
- **SS-08** A price **above** list (صبغة at 27.000) is 0 % effective discount and is saved (D-56); audited as a price
  override. `TODO(spec) SS-Q4` confirms the screen allows it.
- **SS-09** استشارة at 0.000 has 0 % effective discount whatever is entered (M13); a discount larger than the price
  is refused (`SESSION_LINE_DISCOUNT_INVALID`).
- **SS-10** The owner records صبغة at 15.000 (40 %) → saved (UNLIMITED).

### US-3 — Discount above the limit is refused (P1)

- **SS-11** منى enters discount 3.000 on صبغة → 1200 bps > 1000 → `SESSION_DISCOUNT_ABOVE_LIMIT`; **nothing** is saved
  (`TODO(spec) SS-Q6`), the error names the line and منى's maximum.
- **SS-12** مناكير 7.125 with a 10 % discount entered as a percent: the discount is 0.712 (rounded down,
  `TODO(spec) SS-Q5`), net 6.413, effective `ceil(7120000 / 7125)` = 1000 bps → saved. With half-up rounding it would
  be 0.713 → 1001 bps → refused; SS-Q5 exists because of this case.
- **SS-13** A receptionist whose membership has no personal limit, in a business with no default
  (`NOT_CONFIGURED`), can save only lines with 0 % effective discount (spec 018).
- **SS-14** Two lines, one within and one above: the whole request is refused (`TODO(spec) SS-Q6`).

### US-4 — Late entry (P2)

- **SS-15** On 2026-10-15 منى records a session of 2026-10-14 17:00 that she forgot → saved with `late = true`
  (`TODO(spec) SS-Q9` for the exact definition); the day list shows it as late (`TODO(spec) SS-Q11`).
- **SS-16** A session time in the future (beyond the clock-skew tolerance) is refused (`SESSION_TIME_IN_FUTURE`).
- **SS-17** A session older than the allowed window is refused (`SESSION_TIME_TOO_OLD`, `TODO(spec) SS-Q9`).
- **SS-18** A late line whose date falls in a period already approved is **recorded** like any other; it becomes a
  correction in the commissions consumer (D-49, M3, rows 50/55). Nothing here reads statement status.

### US-5 — Performer rules (P1)

- **SS-19** A performer not attached to السالمية on 2026-10-14, soft-deleted, before her hire date or after her
  contract end → `SESSION_PERFORMER_NOT_ELIGIBLE` naming the line and the employee.
- **SS-20** Shares not summing to 10000, a duplicate performer on one line, or zero performers →
  `SESSION_PERFORMER_SHARES_INVALID`.
- **SS-21** A performer not clocked in, or on approved leave that day → `TODO(spec) SS-Q8` (recommended: saved with a
  warning flag).

### US-6 — Retries and isolation (P1)

- **SS-22** The same `Idempotency-Key` with the same body returns the original 201 response and writes nothing new;
  with a different body → `IDEMPOTENCY_KEY_REUSED` (422); while the first is still running →
  `IDEMPOTENCY_KEY_IN_PROGRESS` (409).
- **SS-23** A customer, service, employee or branch of another company — or a service of another business — answers
  exactly like an unknown one; RLS negative tests on every new table (cross-tenant read = 0 rows, write = error).
- **SS-24** A recorder without the permission on that branch gets the uniform 403 used by branch-scoped routes,
  whether the branch exists or not.

## 6. Functional requirements

- **FR-001** One endpoint records one session with 1…N lines in **one** tenant transaction under `withTenant()`;
  N ≤ 20 lines (input bound, not a business rule).
- **FR-002** Guarded by exactly one `@Require('record:service-sessions:branch')` at the server-resolved branch, plus
  `Feature('orders')`. Role defaults `TODO(spec) SS-Q2`. Device memberships never hold it unless SS-Q3 picks the POS.
- **FR-003** `customer_id` must exist in the company (`CustomerLookupPort.exists`), else `SESSION_CUSTOMER_NOT_FOUND`.
- **FR-004** Each `service_id` must belong to the session's business (`CatalogReaderPort`), else
  `SESSION_SERVICE_NOT_FOUND`. The adapter returns price (bigint mills), names, rule and threshold flag; orders maps
  every rule kind with an exhaustive switch (spec 031 "Touched outside the slice").
- **FR-005** Each line input carries the price and the discount in the shape decided by `TODO(spec) SS-Q4`. Money is
  a 3-decimal string in the contract and `bigint` mills in TS; price ≥ 0; 0 ≤ discount ≤ price; `net = price −
  discount`, computed in `orders/domain`.
- **FR-006** A percent discount is converted to mills in `orders/domain` with the rounding decided by
  `TODO(spec) SS-Q5`; the stored line keeps the amount, never the percent.
- **FR-007** The recorder's limit is read once per request, in the same transaction, for the membership the guard
  resolved for that branch, through a new `orders` port `DiscountLimitPort` bound to `settings`'
  `readEffectiveDiscountLimit`. `NOT_CONFIGURED` → 0 bps; `UNLIMITED` → no check; `MEMBERSHIP_NOT_FOUND` → 403.
- **FR-008** For every line: `effective_bps = ceil((list_price − net) × 10000 / list_price)` (0 when list is 0 or
  net ≥ list); `effective_bps > limit` → refused as decided by `TODO(spec) SS-Q6`. Pure functions in
  `orders/domain`, unit-tested exhaustively (§9).
- **FR-009** Performers: 1…4 per line (`TODO(spec) SS-Q7` for the cap), distinct employees, each `share_bps` an integer
  ≥ 1 (`TODO(spec) SS-Q7`), Σ = 10000. When the client sends no shares, the domain fills an equal split; how the
  remainder bps is placed is `TODO(spec) SS-Q7`.
- **FR-010** Whether the recorder may send unequal shares at record time is `TODO(spec) SS-Q7`; if not, the API
  refuses any non-default split and only row 37b changes shares.
- **FR-011** Every performer passes `PerformerCheckPort` for the branch and the session's business date. The clock-in
  and leave check (warning or block) is `TODO(spec) SS-Q8`.
- **FR-012** `occurred_at` is a UTC instant; its default and editability are `TODO(spec) SS-Q9`. `recorded_at` comes
  from the injected `Clock`, never from the client.
- **FR-013** `late` is computed in `orders/domain` from `occurred_at`, `recorded_at` and the business timezone, by the
  definition in `TODO(spec) SS-Q9`; stored on the session, never recomputed.
- **FR-014** The oldest allowed `occurred_at` and the future tolerance are `TODO(spec) SS-Q9`.
- **FR-015** One audit entry per line whose price differs from its list price or whose discount is positive: actor,
  time, line, list price, price, discount, net, effective bps, the limit applied and its source (PERSON / BUSINESS /
  OWNER / NOT_CONFIGURED). No customer phone in the audit or any log (`CLAUDE.md` §8).
- **FR-016** No endpoint edits a recorded line's price, discount, service or customer. Corrections go through rows 37
  and 37b (`TODO(spec) SS-Q10`).
- **FR-017** IDs are UUID v7 from the injected `IdGenerator`. No `Date.now()` or `randomUUID()` in a use case.
- **FR-018** The session total shown to the recorder is the sum of line nets, computed in `orders/domain` (no
  arithmetic in the use case or the controller).

## 7. Data model (migration + RLS in the same PR)

All tables: tenant PK `(company_id, id)`, UUID v7, `ENABLE` + `FORCE` RLS on `app.company_id`, grants to
`pospay_app` of SELECT/INSERT only (UPDATE columns added by rows 37/37b when they need them; no DELETE), negative
isolation test per table. Money `numeric(14,3)`; timestamps `timestamptz` UTC.

| Table | Columns | Constraints / indexes |
|---|---|---|
| `service_sessions` | company_id, id, business_id, branch_id, customer_id, recorded_by (user id), recorded_by_membership_id, occurred_at, business_date (date, resolved in the business timezone), recorded_at, late bool, created_at | FK (company_id, business_id, branch_id) → branches; FK (company_id, customer_id) → customers. Indexes: (company_id, branch_id, business_date, occurred_at) for the day list; (company_id, customer_id, business_date) for `DaySessionsPort` (row 59b); (company_id, business_id, business_date) WHERE late for the late filter |
| `service_lines` | company_id, id, session_id, business_id, service_id, ordinal smallint, status (`ACTIVE` \| `CANCELLED`, CHECK; only ACTIVE written here), revision int (1 here), list_price, price, discount, net, effective_discount_bps int, limit_bps_applied int NULL, limit_source text, rule_kind, rule_pct_bps NULL, rule_fixed_amount NULL, counts_toward_threshold bool, performer_warning text NULL (`TODO(spec) SS-Q8`), created_at | CHECKs: price ≥ 0, 0 ≤ discount ≤ price, net = price − discount, list_price ≥ 0, revision > 0, rule columns consistent (same CHECKs as `services`), effective bps 0…10000. FK (company_id, session_id) → service_sessions; FK (company_id, business_id, service_id) → services. UNIQUE (company_id, session_id, ordinal). Index (company_id, session_id). `redemption_id` is **not** added here — row 43 adds it (expand/contract) |
| `service_line_performers` | company_id, line_id, employee_id, share_bps int | PK (company_id, line_id, employee_id); CHECK share_bps BETWEEN 1 AND 10000 (`TODO(spec) SS-Q7`); FK line, FK (company_id, business_id, employee_id) → employees via the line's business; index (company_id, employee_id, line_id) for the staff app (row 57) and the projection. Σ = 10000 enforced in the domain and by a deferred constraint trigger |

Notes:

- The rule snapshot is stored in validated columns, never JSON numbers (spec 031 precedent).
- `business_date` is stored so period, day-list and rating reads never recompute a timezone.
- Permission migration: catalog code `record:service-sessions:branch` + role defaults per SS-Q2 (pattern of
  migration 0088/0129), ar/en labels in the permissions catalog i18n.

## 8. API contract

`POST /v1/businesses/:businessId/branches/:branchId/service-sessions` → **201** `ServiceSession`

- Headers: `Idempotency-Key` required (money effect, `CLAUDE.md` §6); scope COMPANY, operation
  `record-service-session`, request fingerprint over the canonical body.
- Body (Zod in `packages/contracts/src/orders/service-session.ts`, strict):

```json
{
  "customer_id": "uuid",
  "occurred_at": "2026-10-14T08:00:00.000Z",
  "lines": [
    {
      "service_id": "uuid",
      "price": "25.000",
      "discount": { "kind": "AMOUNT", "amount": "2.500" },
      "performers": [{ "employee_id": "uuid", "share_bps": 10000 }]
    }
  ]
}
```

  `discount.kind` ∈ `AMOUNT` | `PERCENT` (`bps`) per `TODO(spec) SS-Q4`; `performers[].share_bps` optional when equal
  split (SS-Q7); `occurred_at` optional if SS-Q9 picks "default now".
- Response: `id`, `business_id`, `branch_id`, `customer {id, name, phone_masked}`, `occurred_at`, `business_date`,
  `recorded_at`, `late`, `recorded_by`, `total_net`, `lines[{id, ordinal, service {id, name_ar, name_en}, list_price,
  price, discount, net, effective_discount_bps, status, revision, performers[{employee_id, name_ar, name_en,
  share_bps}], warning?}]`.
- Errors (bilingual envelope `{code, message_ar, message_en, details?}`): `VALIDATION_FAILED` 400 ·
  `SESSION_CUSTOMER_NOT_FOUND` 404 · `SESSION_SERVICE_NOT_FOUND` 404 (`details.line_index`) ·
  `SESSION_PERFORMER_NOT_ELIGIBLE` 422 (`line_index`, `employee_id`, `reason`) · `SESSION_PERFORMER_SHARES_INVALID`
  422 · `SESSION_LINE_DISCOUNT_INVALID` 422 · `SESSION_DISCOUNT_ABOVE_LIMIT` 422 (`line_index`, `effective_bps`,
  `limit_bps`, `max_discount` in KWD) · `SESSION_TIME_IN_FUTURE` 422 · `SESSION_TIME_TOO_OLD` 422 ·
  `IDEMPOTENCY_KEY_REQUIRED` 400 · `IDEMPOTENCY_KEY_REUSED` 422 · `IDEMPOTENCY_KEY_IN_PROGRESS` 409 ·
  `FEATURE_DISABLED` · `FORBIDDEN` 403 · `TRANSACTION_RETRY_REQUIRED` 409.
- Generated OpenAPI and admin client regenerated.
- The day-list read (part 35b, if SS-Q1 agrees): `GET /v1/businesses/:businessId/branches/:branchId/service-sessions
  ?date=YYYY-MM-DD&late=true&cursor=&limit=` through `queries/`, guarded by a read permission named in 35b's plan.

## 9. Domain functions (`orders/domain`, pure, Arabic JSDoc, exhaustive unit tests)

`lineNet(price, discount)` · `discountFromPercent(price, bps)` (SS-Q5) · `effectiveDiscountBps(list, net)` (same
rule as identity's; orders owns its copy — ADR-0035 precedent, see §13) · `checkDiscountLimit(lines, limit)` ·
`equalShares(performerIds)` (SS-Q7) · `validateShares(performers)` · `isLateEntry(occurredAt, recordedAt, tz)`
(SS-Q9) · `sessionTotal(lines)`.

## 10. Permissions

- New: `record:service-sessions:branch` — defaults `TODO(spec) SS-Q2`; branch scope follows the holder's membership
  reach (PR 7 semantics). Device: never, unless SS-Q3 picks the POS device.
- Reused: `create:customers:branch` (cashier/branch manager/business manager, spec 022) for the find-or-create step
  that precedes the session.
- The discount limit is a parameter of the recorder's membership (spec 016/018), not a separate permission here.

## 11. Events (outbox, same transaction)

One `ServiceLineChanged` per line (SPEC §3, ADR-0010), declared with its Arabic one-line JSDoc in
`orders/events/published.ts`:

`line_id`, `session_id`, `service_id`, `branch_id`, `business_id`, `customer_id`, `status: 'ACTIVE'`, `occurred_at`,
`recorded_at`, `net` (string mills), `performers [{employee_id, share_bps}]`, `rule_snapshot`, `counts_snapshot`,
`package: null`, `revision: 1`.

Consumers (`commissions` row 50, `customers` row 59) do not exist yet. The worker's known-event registry must list
`ServiceLineChanged` so the dispatcher delivers it with no consumer (precedent: `SalaryChanged` before row 50). Row
50 must therefore build its projection from `service_lines` for rows written before it ships, or replay — recorded
here so row 50's plan owns it.

## 12. Edge cases

- Same service twice in one session: allowed, two lines (no rule forbids it).
- A service whose price changed between the screen load and the save: the server snapshots the price **at save**; the
  effective discount uses that list price (SS-03). The screen shows the new value in the response.
- A customer who opted out of ratings is recorded normally (opt-out affects ratings only, D-41).
- An employee attached to two branches records at either one (SPEC §3 port; AB-Q7 precedent).
- A session crossing midnight UTC but not Kuwait: `business_date` is the Kuwait date (SPEC §5 fixture rule).
- The recorder is also a performer: allowed (no rule forbids it).
- An owner who also has an employee row: unlimited discount (spec 016/018 owner rule).
- 20 lines at the cap: one transaction, 20 outbox rows, well under 200 ms.

## 13. Engineering notes found while drafting (orchestrator, not owner)

1. **Module map conflict.** ADR-0010 says no import arrow is needed, but `module-map.yaml` has `orders: [tenancy]`,
   and every adapter precedent (`staff → identity`, `settings → identity`) counts adapter imports as module arrows.
   The four adapters this row needs (`catalog`, `customers`, `staff`, `settings`) need either arrows declared by an
   ADR amendment or binding at a composition root outside the module (ADR-0037 `BranchPlaceReader` precedent), plus
   `reads:` lines. **Must be settled before 35a's plan.**
2. **No `orders → settings` port row** exists in `module-map.md` §3 for the discount limit; spec 018 says "PR 35 owns
   its consuming read port". Add `DiscountLimitPort` to §3 in the same amendment.
3. `effectiveDiscountBps` lives in `identity/domain`; `orders` may not import `identity`. Orders owns a copy with the
   same tests (ADR-0035 precedent) or the function moves to `packages/domain` — decide in the plan.
4. `orders` has only `domain/` today; this row creates `orders.module.ts`, `index.ts`, `ports/`, `persistence/`,
   `http/`, `events/`.
5. `readEffectiveDiscountLimit` takes one membership id; a person with several memberships uses the one the guard
   resolved for the branch.

## 14. Behaviour tests mapped to SPEC §11

| SPEC | Test in this row |
|---|---|
| M1 | price override and discount store actor and time; audit entry per FR-015 (SS-06, SS-07) |
| M2 | first half only: above the limit is refused, nothing written (SS-11, SS-14); consumption comes in row 41 |
| M3 | late entry flagged (SS-15); a line in an approved period is still recorded (SS-18) — the correction test is row 55 |
| M12 | performer validation and share sums at record time (SS-19, SS-20); changes are row 37b |
| M13 | (list − net)/list, 0 % at list 0, price above list 0 %, round-up of fractional bps (SS-06…SS-13) |
| M10 | same key retried: one session, one set of outbox rows (SS-22) |
| — | RLS negatives for the three tables; `EXPLAIN` + shape tests for any `queries/` file (35b); a domain fixture for the 7.125 / 10 % case of SS-Q5 |

Integration tests run on the T2 compose Postgres, one cloned database per spec file (ADR-0006).

## 15. Out of scope

Tips, cancel, performer change, above-limit approval, packages, commission projection, ratings, payments, printing,
barcode, offline POS sync, realtime (screens poll).
