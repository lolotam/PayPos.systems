# ADR-0010 — Phase 1 ports and events

- **Status:** Accepted
- **Date:** 2026-10-01
- **Slice:** Phase 1 · gate G1

## Context

Phase 1 (`docs/specs/phase-1/SPEC.md` v7 §3) adds the modules `staff`, `files`, `catalog`, `customers`, `orders`,
`commissions` and `notifications`. Their **import** arrows already exist in `module-map.md` §2 — no module needs a
new compile-time edge. What is new is the traffic between them: synchronous reads that must not become imports, and
state changes whose consumers must stay unknown to their producers. `module-map.md` §7 (with `CLAUDE.md` §4.1)
requires an ADR before any new port or event is declared, so the Phase 1 rows land here before the slices that
implement them.

## Decision

`module-map.md` moves to **M1.1**: the Phase 1 port rows enter §3 and the Phase 1 event rows enter §4, exactly as
SPEC §3 lists them. **No import arrow is added** — every module involved already has its imports in §2 — and
**every new port is a read**: §3.1's one synchronous write (`identity → tenancy.registerCompany`) keeps its
monopoly. `notifications` stays business-free: emitting modules read `AlertRulesPort` themselves and put the
recipients and channels **in the event**, so `notifications` never learns an alert rule.

### Ports — each a synchronous read ("I need an answer now")

| Consumer | Port | Reads from | Why a port (a synchronous read) |
|---|---|---|---|
| `orders` | `CatalogReaderPort` *(existing)* | `catalog` | pricing a line needs the service's price, names, commission rule, threshold flag and package-type components **now**, snapshotted onto the line before it is written |
| `orders` | `CustomerLookupPort` | `customers` | `exists(customerId)` at session write — reception finds or creates the customer first through `customers`' own endpoint, so this is one existence read, not a lookup-and-write |
| `orders` | `PerformerCheckPort` | `staff` | every named performer is validated **at line write**: employee active and attached to the branch on the date |
| `commissions` | `EmployeeDirectoryPort` | `staff` | statements and the live estimate render employee names — a pure directory read |
| `customers` | `PerformerNamePort` | `staff` | the rating message names the performer (first name) — read when the message is composed, not a reaction |
| `customers` | `DaySessionsPort` | `orders` | the claim job reads the customer's active lines and performers for a business day **at claim time** — the authoritative boundary for rating attribution, because a projection could be stale by design |
| `staff`, `customers`, `commissions` | `AlertRulesPort`, `StaffColumnsPort` | `settings` | which alerts are on (recipients, channels) and which staff-app columns are allowed — configuration read before an event is emitted or a column is shown |

### Events — each a state change ("this happened, react")

| Event | Producer | Consumers | Why an event (a state change) |
|---|---|---|---|
| `SalaryChanged` | `staff` | `commissions` | a salary entry was written or replaced — identity `(employee_id, effective_from)`, `amount`, per-entry `revision`; salary is an input like a line, and `staff` must not know statement status to publish it |
| `ServiceLineChanged` | `orders` | `commissions`, `customers` | a line was recorded, repriced, re-performed or cancelled; commissions projects it, customers moves the rating request |
| `PackageSaleChanged` | `orders` | `commissions` | an entitlement changed — sale, refund, status; commissions projects the seller's sale commission |
| `SessionTipsChanged` | `orders` | `commissions` | a session's tips changed; commissions projects tips as statement inputs (`TIP_CARD`, `TIP_CASH`) |
| `RatingRequestReady` | `customers` | `notifications` | a request was claimed (`SCHEDULED → SENDING`); notifications dispatches it and enforces `send_deadline` |
| `LowRatingReceived` | `customers` | `notifications` | a rating of ≤ 2 stars arrived; notifications sends the alert when the rule is on |
| `AttendanceExceptionRaised` | `staff` | `notifications` | geofence exceptions are raised without an event today; this event remains the missed-out job's (module-map row 173) |
| `ShiftNotClockedIn` | `staff` | `notifications` | the job found a scheduled shift never clocked in; notifications alerts |
| `DocumentExpiring` | `staff` | `notifications` | an employee document approaches its expiry; notifications alerts |
| `StatementAwaitingReview` | `commissions` | `notifications` | a statement needs the manager's review — a reminder, not a lock |
| `StatementAwaitingApproval` | `commissions` | `notifications` | a statement awaits the owner — the 3rd- and 5th-of-month reminders |

Each event names a stable identity and carries every field its consumers use (SPEC §3):

- `ServiceLineChanged` — `line_id`, `session_id`, `service_id`, `branch_id`, `business_id`, `customer_id`, `status`,
  `occurred_at`, `recorded_at`, `net`, `performers [{employee_id, share_bps}]`, `rule_snapshot`, `counts_snapshot`,
  `package {entitlement_id, component_id, ordinal}?`, `revision` (per line, +1 on every change).
- `PackageSaleChanged` — `sale_id` (= the entitlement id), `business_id`, `branch_id` (= the sale's
  `sold_branch_id`), `sold_at`, `business_date` (= the sale's `sold_business_date`), `seller_employee_id`,
  `price_paid`, `refunded_amount`, `status`, `revision`.
  `branch_id` and `business_date` were added by spec 058 TD-7 (42-1): the sale's branch and business date on
  every revision, which the commission projection needs (spec 059 CM-20).
- `SessionTipsChanged` — `session_id`, `business_id`, `occurred_at`, `tips [{employee_id, amount, method}]`,
  `revision` (per session).

### `ServiceCompleted` is replaced in Phase 1 by `ServiceLineChanged`

`ServiceCompleted` assumed a service reaches one terminal "completed" fact — natural for the appointment flow,
which does not exist in Phase 1. A Phase 1 line is written directly and keeps changing afterwards (price override,
discount, performer split, late entry, cancellation), so the replacement carries the **full line snapshot plus a
per-line `revision`**, and consumers converge by revision instead of assuming finality. The §4 row stays, marked
*replaced in Phase 1 by `ServiceLineChanged` (ADR-0010)*, so the appointment-era contract stays visible.

### `EmployeePlanPort` is retired

The PRD placed plan assignment in `staff` and had `commissions` read it through `EmployeePlanPort`. SPEC §4 moves
plan versions and service overrides into `commissions` itself (a plan is now a versioned set of stages, not a
pointer), so `commissions` no longer reads plans from `staff`. The §3 row stays, marked retired.

### `files` and OTP add no arrow

- `files` — **none**: documents are uploaded and opened through `files`' own endpoints, with their stored
  permission and access audit; `staff` stores the object key only.
- OTP — **wiring**, not an arrow: `packages/auth` takes an injected `OtpSender`, bound at `apps/api`'s composition
  root to the WhatsApp channel. Composition-root wiring changes nothing in the map.

## Consequences

- **The cost — a second pair of ports in both directions.** `orders → customers` (`CustomerLookupPort`) and
  `customers → orders` (`DaySessionsPort`) are both ports now: **neither module imports the other; only the
  adapters see both.** This is §3's note that ports may run in both directions without creating a cycle — the
  compile-time graph (§2) is untouched — and its warning binds: if a new port would create a cycle **between
  adapters**, use an event instead.
- **OTP wiring stays at the composition root.** No module arrow, so §2 and the CI gate are unaffected; the binding
  lives in `apps/api`'s module wiring, the one place an interface meets a class (`CLAUDE.md` §2.2).
- §6 — the machine-readable source — does not change: imports are untouched and `reads: []` stays empty; each
  adapter adds its `reads` line in the PR that writes it, one line per symbol. *(The "imports are untouched" part is
  superseded by the addendum of 2026-10-21, §4: `customers → settings`, `staff → settings` and
  `commissions → settings` are added to §2 and to the §6 `imports`. The `reads` rule still holds.)*
- Consumers can be added to any Phase 1 event with zero producer changes, and because every projected event
  carries its consumers' fields and a `revision`, duplicate, reordered and replayed delivery converges (SPEC §6).
- The Phase 1 event rows list their Phase 1 consumers only; the `realtime` publisher joins them when realtime
  ships (the PRD's Phase 1 exception, closed by P2-T8).

## Addendum 2026-10-21 — spec 060 ports (docs PR A-0)

Spec 060 (the staff app's "my" pages, ratings and alert rules) needs three ports that the Decision above does not
list. `module-map.md` §7 and `CLAUDE.md` §4.1 require an ADR before a new port, so they are declared here before the
sub-PRs that build them (spec 060 §9, amendment 5). Like every port above, each one is a **read**, owned by its
consumer, on the caller's transaction; §3.1's one synchronous write keeps its monopoly.

| Consumer | Port | Reads from | Why a port (a synchronous read) | Built in |
|---|---|---|---|---|
| `orders` | `StaffColumnsPort` | `settings` | «شغلي» is orders' own read of the employee's lines and tips (spec 060 D-A1, FR-A01, FR-A03); it must drop every column the business hid **before** the response leaves the server (D-A2) and bound the month by the business's months-back setting (D-A14) | 57c-1 |
| worker `orders` | `AlertRulesPort` | worker `settings` (a new minimal module) | the late, price-edit, cancel and performers bells read the business's effective rule **when they emit**, instead of the ADR-0037 interim rule (D-B13, D-B14) | 62-3 |
| worker `customers` | `BranchScheduleHoursPort` | worker `tenancy` | the rating request's day and closing time need the branch's opening hours and effective timezone **at scheduling and at claim time** (D-B3) | 59-1 (postponed) |

### 1. Orders' `StaffColumnsPort` (spec 060 D-A3)

The original row approves `StaffColumnsPort` for `staff`, `customers` and `commissions`. Orders is a fourth consumer
because it serves «شغلي» itself: it owns the lines, the performers and the customer id, so no other module can serve
that list (D-A1). Its port has the same two reads as the other consumers (FR-A08):

- `allowed(tx, companyId, businessId)` → the saved column set, or the default when none is saved: her work and her
  money only (MY-Q3, PP-18.3; `list_price`, `discount` and `net` hidden). `estimated_commission` is an ordinary column,
  shown by default (MY-Q4, PP-18.4). `rating_average` is removed from what any consumer receives until the rating
  track ships (D-A7; RT-Q1, PP-18.9 postponed it), and sub-PR 61-3 lifts that filter.
- `monthsBack(tx, companyId, businessId)` → `staff_months_back`, where `NULL` means 2 (the current month and the one
  before) and the stored value is 1–12 (D-A14; MY-Q2 and MY-Q9, Abu Salem 2026-10-22, replacing PP-18.2 and PP-21.1
  «شهر، ولحد 24»; issue #497; a stored value above 12 is read as 12 until issue #519 narrows the CHECK).

`settings` stays the owner of both values; they are edited under `manage:staff-app-columns:business` (MY-Q5, Abu
Salem's binding pick, replacing PP-18.5's `manage:settings:business`; built by issue #496, migration 0168) and nobody else writes them. `orders` already imports `settings` (§2, ADR-0041's `DiscountLimitPort`).
The orders adapter calls a public settings reader that 57c-1 adds; the `commissions`, `customers` and `staff`
adapters, whose ports are already approved above, call the same reader in the same sub-PR (see §4 for their arrows).

### 2. Worker orders' `AlertRulesPort` (spec 060 D-B13, D-B14)

`rule(tx, companyId, scope, kind)`, with `scope = { businessId, branchId | null }`, returns the effective rule with the
business master switch applied: the branch's override when the event has a branch and an override exists, otherwise
the business rule (AL-Q2, PP-18.22: «نشاط، والفرع يغيّر»). Recipients are role selectors (AL-Q3, PP-18.23). The master
switch covers team alerts only (AL-Q4, PP-18.24). A kind with no saved rule uses the code-side default (AL-Q5,
PP-18.25), and row 62 delivers in-app only (AL-Q6, PP-18.26). The rules are edited under `manage:alert-rules:business`
(AL-Q1, Abu Salem's binding pick, replacing PP-18.21's `manage:settings:business`; built by issue #495, migration 0167).

- **A minimal worker `settings` module.** It exports this one read on the caller's transaction, in the shape of the
  worker `tenancy` and `identity` readers that ADR-0037 §2 uses. The API never pushes rules to the worker. Built in 62-1
  with the storage; worker `staff`'s use of it is already covered by the original `staff` row.
- **No new arrow for orders:** `orders: [..., settings]` already exists in §2, and `settings` imports nothing it
  does not already list. Worker `staff` reads the same module through the `staff → settings` arrow of §4.
- **Recipients still come from identity.** The rule supplies the roles; the user ids still come from identity's scoped
  read (`branchManagerRecipients`) on the same transaction, replacing the roles of `interimNotClockedInRule`
  (ADR-0037). `notifications` stays business-free: the emitter resolves the rule and puts recipients and channels in
  the event, as the Decision above requires.

### 3. Worker customers' `BranchScheduleHoursPort` (spec 060 D-B3)

Defined in worker `customers/ports/`: `hours(tx, companyId, branchId)` → `{ opening_hours | null, time_zone }`, on the
caller's transaction, where `time_zone` is the branch's effective zone (the branch's, otherwise the business's).
It is implemented by an adapter in worker `customers/persistence/`, which calls a new public reader of the worker
`tenancy` module, `branchScheduleHours(tx, companyId, branchId)`, from `tenancy/index.ts`. The reader has the same
shape as tenancy's existing `branchPlace` and `businessTimeZone` readers. Spec 060 D-B3 and row 59-1 say the same: the composition root binds the port to that adapter class, as worker `staff`'s
`BranchPlaceReader` is bound (ADR-0037 §6). It is **not** an injected callback.

- It feeds two pure functions in `customers/domain`. `requestDayOf(occurredAt, zone, openingHours)` gives each session
  exactly one request day: its branch-local date, or for a visit after midnight inside an overnight interval, the
  day that interval started. `ratingSchedule` takes the last close of that day (RT-Q4, PP-18.12 for both rules).
- The 59-1 consumer (D-B2) and the claim's reschedule (D-B5) both call it. Orders' `business_date` is not used: it is
  in the business zone and can name the wrong day near midnight for a branch in another zone.
- **No new arrow, one `reads` line.** `customers: [tenancy]` already exists in §2, and 59-1 adds
  `customers -> tenancy.branchScheduleHours` to the §6 `reads` list with the adapter.
- **Why not a root callback.** `DaySessionsPort` uses one (ADR-0041) only because `customers → orders` would be a
  compile-time cycle. `customers → tenancy` points down the graph, so there is no cycle to break, and a callback
  would only hide the edge from the gate (§4).
- **Declared now, built later.** The whole rating track is postponed to the end of the project (RT-Q1, PP-18.9), and
  59-1 is part of it. The port is declared now so that 59-1 needs no further ADR when the track resumes.

### 4. Three read-only arrows into `settings` (Codex review of PR #462)

The original Decision says no Phase 1 module needs a new compile-time edge, but that holds only for the ports it
lists by name, not for the adapters that implement them. The `StaffColumnsPort` and `AlertRulesPort` adapters of
`customers`, `staff` and `commissions` live in each consumer's `persistence/` and call settings' public reader from
`settings/index.ts`, which is a value import. `module-map.md` §2 lists none of these three modules as importing
`settings`, so this addendum approves three arrows:

| Arrow | Used by | Limit |
|---|---|---|
| `customers → settings` | its `StaffColumnsPort` adapter (57c-1) and, with the postponed rating track, its `AlertRulesPort` adapter for the low-rating alert (61-1) | `persistence/` adapters only; settings' public read functions only, on the caller's transaction |
| `staff → settings` | its `StaffColumnsPort` adapter (`monthsBack` for «حضوري», 57c-1) and its `AlertRulesPort` adapters (worker 62-2, API 62-2b) | the same |
| `commissions → settings` | its `StaffColumnsPort` adapter (the estimate column, 57c-1) and its `AlertRulesPort` adapter (62-2c) | the same |

- **Reads only.** Each value import is a `reads` line in §6, one per symbol and adapter file, added by the PR that
  writes the adapter. No arrow allows a write, an event, or an import of settings' `persistence/`, `domain/` or
  `use-cases/`; the module-map gate already refuses any path other than `index.ts`.
- **No cycle.** `settings` imports `tenancy`, `identity` and `files`, and none of those imports `customers`, `staff`
  or `commissions` (§2). The new arrows point down that list, so the import graph stays acyclic and no
  composition-root callback is needed. `settings` must never import any of the three; a future need for that
  direction is an event or a root-bound callback, as with `DaySessionsPort` (ADR-0041).
- **Why an import and not a root callback.** The adapter is the one file that knows both modules (§3 of
  `module-map.md`), as for orders' `DiscountLimitPort`. A callback injected at the root would hide the same edge
  from the gate without removing the dependency.

### Module map

- `module-map.md` §3 gains the three port rows above; §2 and the §6 `imports` gain the three arrows of §4, and the
  generated `docs/module-map.yaml` is regenerated. This supersedes the original Consequences' "imports are
  untouched", as noted there.
- **No cycle between adapters** (the Consequences warning above): `settings` and `tenancy` read none of `orders`,
  `customers`, `staff` or `commissions` through any adapter.
- As the Consequences above require, each adapter adds its `reads` line in the PR that writes it, one line per
  symbol: 57c-1 adds the settings reader lines of all four `StaffColumnsPort` adapters; 62-2, 62-2b, 62-2c, 62-3
  and 61-1 add their `AlertRulesPort` lines; 59-1 adds `customers -> tenancy.branchScheduleHours`.
- **Not in this addendum:** customers' `RatingAlertRecipientsPort` (docs PR A-1, postponed with the rating track), and
  the `NotificationDelivered` ⇒ `customers` event row (spec 060 D-B8, in 59b-3).

## Addendum 2026-10-31 — 59b-2 worker-customer claim reads and the dormant claim core

### 5. Worker `customers → staff` is one bounded public read

The rating claim needs the performers' current, display-safe first names while it composes
`RatingRequestReady`; an event cannot answer that synchronous question, and a second stored name
projection could be stale at the authoritative claim. Worker `customers` therefore keeps its
consumer-owned `PerformerNamePort`, implemented only by
`apps/worker/src/modules/customers/persistence/performer-name.adapter.ts`. The adapter calls
`readEmployeeDisplayNames` from worker `staff/index.ts` on the caller's existing tenant
transaction. The read returns names only: no staff write, lock, internal path, new role, grant or
second connection is allowed.

The compile-time arrow is `customers → staff`, confined to that persistence adapter. It is acyclic:
`staff` imports `tenancy`, `identity`, `files` and `settings`, and none of those imports `customers`;
`staff` does not import `customers`. The declaration is `module-map.md` §2 (`customers` may import
`staff`), §3 (`PerformerNamePort`), and §6 (`customers: [tenancy, settings, staff]` plus the exact
`customers -> staff.readEmployeeDisplayNames` `reads` row). This records the existing technical
adapter boundary; it is not a new owner or business decision.

### 6. The claim core of 59b-2a merges dormant, and the rest is a later slice

Sub-PR 59b-2a ships only the claim core: the single-request `ClaimRatingRequest` use case with its
domain decisions and its ports, the `RatingRequestReady` event and its contracts. It merges
**dormant**: no runtime call site, no scheduler, no queue, no migration and no data step, so nothing
in a running system claims a request yet.

The following parts of the 59b-2 design are **not** in this slice and land with the later sub-PRs
59b-2b/59b-2c:

- the per-company BullMQ claim scheduler `rating-claims-<companyId>` and its one-minute cadence;
- the keyset `(due_at, id)` continuation across pages of at most 100 due requests, written to
  `job.data` through `job.updateData` so a failed or rescheduled first page cannot starve later
  candidates, and a trigger that creates a missing scheduler without rewriting an existing one;
- the ADR-0038 discovery data step of migration 0194, which emits one discovery event per company
  that already has unclaimed requests;
- the dispatcher-read-only recovery of a parked discovery or of a late visit an older worker already
  acknowledged, and its `docs/runbook.md` entry.

The decisions above stay as they are: the scheduler that drives them calls the claim core merged
here, unchanged, and per-request diagnostics follow ADR-0037 §9 (safe error type/code and immediate
cause type/code only) once that scheduler lands.

## Addendum 2026-11-01 — 59b-2b: the fenced claim scheduler (PP-98 option A)

### 7. The mechanism the owner chose

PP-98's Q1 chose **option A** — the claim scheduler's progress lives in Redis, not in PostgreSQL. `apps/worker/src/modules/customers/persistence/redis-rating-claim-state.ts`
implements the `RatingClaimState` port of `apps/worker/src/modules/customers/ports/rating-claim-state.port.ts`
— the factory is in that file, the Redis transport and the technical limits are in
`redis-rating-claim-state.context.ts`, and the command groups are in
`redis-rating-claim-state.commands.ts` — on **one STRING key per company**,
`<prefix>:rating-claims:v1:{<companyId>}:state`, holding
versioned JSON (`schema = 1`): a header (company, incarnation, version, owner token, lease, turn
start, next ticket), the sweep (sweep id, captured upper bound `H`, cursor, phase), at most one
page journal of at most F entries, and the retry map.

- **Fenced state.** Every mutation carries `(companyId, incarnation, expectedVersion, ownerToken)`;
  every accepted mutation increments the version. An expired owner can neither renew nor release,
  and a command whose incarnation or version no longer matches is rejected as `STALE` rather than
  silently overwriting. A renewal is refused with `LIMIT` once the time left to the turn ceiling
  cannot hold another full lease, so a renewed lease never reaches past the ceiling: the turn
  stops claiming, ends as `LIMIT_REACHED` and leaves the journal recoverable. The retry entries the
  same owner holds are renewed with it, so a long retry lane does not lose its fence in the middle.
  The fence coordinates the scheduler only: it never cancels a running PostgreSQL transaction, and
  2a's customer and request locks and its guarded `SCHEDULED → SENDING` update remain the authority
  for at-most-once claims.
- **Finite ID sweeps, over the scheduled rows only.** A sweep captures `H` — the largest
  `SCHEDULED` request id for that company — once, and traverses `cursor < id <= H` in ascending id
  order, reading **only** the `SCHEDULED` rows through the partial index
  `rating_requests_scheduled_id_idx` (PP-109.1). `SENT` and `CANCELLED` rows are never visited:
  they are finished, and the sweep's length is proportional to the pending requests, not to the
  history — a company that has sent a million requests still sweeps only what it still owes. The
  cursor is the id, never `due_at`: ids are immutable, so the traversal is a keyset walk; a row
  inserted behind the progress, or one that becomes due later, belongs to the next sweep. `H` is
  captured once per sweep and is never extended by arrivals above it. A row that leaves `SCHEDULED`
  between the page read and the point read is still settled by that lane's own read; a retry
  ticket whose row has become terminal is settled `TERMINAL` by the retry lane's point read.
- **An independent, bounded retry lane.** Reconsiderations live in their own map keyed by request
  id, with at most `RETRY_CAPACITY = 2,048` entries. A request still `SCHEDULED` after an attempt
  gets a retry ticket with its own eligibility and a tail position; the retry lane reserves at
  most `RETRY_VISITS = 25` of them per turn, oldest ticket first, and never borrows from the
  forward lane's `FORWARD_VISITS = 75`.
- **Overflow and reconciliation reporting.** When the map is full or the encoded state would pass
  `STATE_MAX_BYTES − PAGE_RESERVE_BYTES` (1_048_576 − 65_536 bytes), the settlement records
  `OVERFLOW`, counts it and sets the reconciliation flag instead of evicting an admitted ticket.
  The page reserve bounds what may be **added**: a settlement that only removes an entry is stored
  against the full `STATE_MAX_BYTES`, because a removal never grows the state. The forward lane
  keeps running and the refused rows are visited again by the next sweep. Only `reconcileRequired`
  is cleared by a clean full sweep — `overflowCount` and `overflowSince` stay in the state until the
  state itself is recreated.
- **Lane budgets.** F = 75 forward visits and R = 25 retry visits per service turn, with
  `F + R ≤ 100`; neither lane borrows the other's reservation, so one turn never visits more
  than 100 rows. The budgets live in
  `apps/worker/src/modules/customers/domain/rating-claim-scheduling.ts`, and the turn's own forward
  budget is the number the page enrollment is checked against, so the journal can never hold more
  rows than the turn is allowed to visit.

### 8. The assumptions this mechanism rests on

- **Redis coordinates, PostgreSQL decides.** The state holds ids, counters, timestamps and
  protocol enums only — no customer id, phone, rating token, hash, message parameter or payload.
  The only tokens in it are the protocol's own (`ownerToken`, `workToken`). A lost or corrupt state
  therefore delays reconsiderations; it never grants a claim.
- **Ids are immutable and unique.** The traversal order is the id order, so a request's place in
  a sweep is stable. UUID order need not equal commit order, and `H` is a key bound rather than
  an MVCC membership snapshot.
- **The company is the unit of isolation.** The key carries the company id in its hash tag, so
  two companies never share state, and a fence minted for one company is rejected for another.
- **The lease is a technical bound, not an SLA.** `LEASE_MS = 120_000` and `MAX_TURN_MS = 180_000`
  are the defaults. Ownership expires through stored timestamps and Redis `TIME`, and a lease time
  is never compared with a business deadline.
- **Bounded work per turn.** The JSON representation scans at most K entries to reserve retries
  and serializes bounded state per mutation. It is O(K), not constant time; the byte cap plus the
  page reserve `PAGE_RESERVE_BYTES = 65_536` is what keeps a page enrollment inside the budget.
- **Nothing here can resend.** A claim that failed leaves its row `SCHEDULED` with a retry ticket;
  a claim that succeeded is `SENDING` and terminal for the claim path. The at-most-once,
  no-resend rule is 2a's, and this mechanism only decides *when* a row is looked at again.

### 9. PP-97: the registration backoff is the outbox's backoff

When a trigger event cannot register the company's scheduler, the processor's `deliver` returns
`{ delivered: false, error: 'RATING_CLAIMS_SCHEDULE_RETRY', retryInMs: retryDelayMs(event.attempt) }`
(`apps/worker/src/modules/customers/jobs/rating-claims.processor.ts`), using the same
`retryDelayMs` the outbox dispatcher uses (`apps/worker/src/outbox/retry-policy.ts`): 5 s, 10 s,
20 s … capped at one hour, and `null` on the tenth attempt, which parks the event. The stored
event is not acknowledged on a registration failure, so a newer worker retries it. The
registration path never touches the claim core: `ensureRegistered` upserts a missing scheduler and
leaves a running one untouched.

### 10. Dormancy: the shipped composition is closed

`apps/worker/src/main.ts` installs `closedRatingClaimsLifecycle()` from
`apps/worker/src/modules/customers/customers.module.ts`: `deliver` delegates straight to `next`,
`ready` and `close` are no-ops, and `eventTypes` is empty. Nothing is constructed — no
`rating-claims` Queue, no Worker, no Redis state adapter, no rating token codec. The active
factory `createRatingClaimsRuntime` exists and the tests exercise it, but startup does not call
it, and no environment flag opens it. The existing `createRatingSchedulingConsumer` stays
registered: it stores `SCHEDULED` requests and never claims them. Activation is reserved for
59b-3, whose reviewed change connects the active factory only after the sender, the template and
the channel are ready (60-1, 60-2, 61-1 and the 2c recovery prerequisites).

### 11. What stays with 2c: the Redis-loss boundary

Losing Redis does not lose business state — the rows and their status stay in PostgreSQL — but it
does lose the sweep cursor, the captured `H` and the retry map. 59b-2b invents no recovery
policy for that. What it does provide is the mechanism a recovery needs: the state is re-created
with a fresh incarnation, an old fence cannot touch the new state (the fencing acceptance covers
exactly that), and `ensureRegistered` re-registers a company's scheduler from the fixture
inventory. The production inventory of the companies that need a scheduler, the reconciliation of
pre-activation `SENDING` rows and the runbook entry remain **59b-2c's release gate**.


## Addendum 2026-11-05 - package preview request, 47-1a

The manager approved asynchronous package preview after its full synchronous warm
median measured 719.6987 ms, above 200 ms (spec 058, 47-1-PERF-1), and approved the
47-1a/47-1b split in the decision supplied as 15:57 Kuwait. 47-1a is request acceptance
and creator-scoped polling; 47-1b is the preview worker, parser and producer activation.
Financial package import commit remains 47-2.

The new orders -> files read arrow serves the orders-owned
PackageImportRequestScope.fileFacts port. Its adapter calls the files public
`documentFileFacts` reader on the existing tenant acceptance transaction; it checks
company visibility, business, creator, READY state, type, size and purge state.
No bytes, storage provider call or workbook parsing occurs during acceptance. A domain
event cannot supply the synchronous facts needed to authorize this request; extracting
files later replaces this narrow adapter. No cross-module mutation is introduced.

The same transaction creates an empty pending `entity='packages'` import_previews row
and the id-only `PackageImportPreviewRequested { preview_id }` outbox record. The event
is declared with Arabic JSDoc in orders/events/published.ts. It is not registered as a
known worker type until 47-1b actually implements its transport and consumer. The API
returns 202 when mounted in the test composition; the entire HTTP acceptance path has
a strict warm five-run median assertion below 200 ms.

Production safety fence: `PackageImportPreviewController` is intentionally absent
from `ordersControllers`. Production POST and GET routes return 404 and cannot create
pending work before a consumer exists. Tests explicitly mount the controller through
the harness to validate the future API. 47-1b alone adds production registration when
its real transport/lifecycle is present. This uses no new feature flag, secret or
runtime environment switch. Polling is authoritative; SSE is not a source of state.

The migration extends the existing status CHECK with pending (packages only), adds a
bounded skipped_count column, and grants guarded result-column updates solely for a
package preview leaving pending. Staff keeps its ready default and commit transitions;
its result fields remain protected by the new trigger. Final numbering, generation and
push remain blocked on the manager's explicit lane grant. The unnumbered SQL draft is
applied only on the private local test cluster; CI requires the final real migration.

Bounds remain 2 MiB, 500 data rows, 68 columns and 4 sheets. Parser and money changes
from the previous attempt are preserved in stash
8595ab7fe7dd0e7db5f58e444b534be923b8420e for 47-1b and are excluded from 47-1a.


### Addendum 2026-11-06 ? 47-1b package preview activation

The approved split now has its real orders BullMQ transport. The API mounts the
request/polling controller; orders declares the known event type only on the active
worker module and intercepts delivery before the generic database-only deliverer.
Redis publication is outside the outbox transaction; acceptance by Redis is the
transport acknowledgement. Older workers still reject/retry the unknown type.
The test-only fenced-producer exclusion from 47-1a is removed, and coverage obtains
the supported type from the real orders composition. Startup readiness and close
include the processor; it closes before its files provider.

Worker orders reads files.documentFileFacts, catalog.readPackageImportServices and
customers.readPackageImportCustomers through public adapters on its current tenant
transaction. Services, existing refs and customer phones are each batched. Only
customer id and phone_last3 leave the customer lookup; SQL/provider causes never
leave the preview use case. Storage bytes are bounded and read outside transactions.

The hardened technical reader lives in @pospay/import-workbooks; API shared import
paths are compatibility facades, and staff retains its existing bounds/error identity.
Pure package definition/allocation/slot/PackageRuleError primitives move to the
zero-dependency @pospay/domain with API compatibility exports. Sale allocation keeps
its default behavior; imports explicitly select session-count allocation. There is
no cross-application source import or duplicate implementation of money rules.

## Addendum 2026-11-06 — 59b-2c dormant inventory and recovery

The migration data step `rating-claims-discovery` follows ADR-0038. Its migration
owner only enumerates company IDs after the bypass-role check. Counts of requests
and historical attempts, and appending discovery, run through `pospay_app` with
`withTenant`. The existing `pospay_dispatcher` credentials supply a restricted,
read-only existence check: the application has INSERT-only outbox access, so it
cannot check publication history itself. No grant or tenant bypass is added.
The company transaction takes the aggregate advisory lock before the dispatcher existence check, so loss of the owner session lock cannot permit duplicate discovery. On a crash after a company
commits, the next run finds its discovery even if published or parked and skips
the append. Counts are logged without identifiers, phone numbers, links or payloads.

`RatingClaimsDiscoveryRequested` carries `{}` and uses aggregate type
`rating_claims_discovery` with the company ID as aggregate ID (PP-96), separate
from ordinary company events. The active claim transport registers the existing
per-company BullMQ scheduler and acknowledges discovery without delegating it to
the scheduling consumer. Registration failures retain PP-97 backoff and parking.
The production root still installs `closedRatingClaimsLifecycle()`: this change
does not register discovery as a known production event or enable claims/sending.

The explicit operator recovery command reads retained discovery and the three
visit event types through the dispatcher facade, including published and parked
rows, with a company scope, ascending ID cursor and captured upper bound. It
registers BullMQ without creating a claim Worker or token capability; only visits
reach the existing scheduling deliverer with their original IDs and dedupe receipts.
No outbox publication, retry, parked or consumption metadata is reset. The partial
replay index covers those four event types, including retained published rows.

Historical `SENDING`/`SENT` requests and `rating_request` attempts in `SENDING` or
terminal states are counted and left unchanged. Their disposition remains PENDING
in the slice owner questions; DEP-1 counts determine whether the manager needs an
owner decision. Activation blockers #803, #804, #805, #808, #809, #810 and #811
remain separate work. The manager granted the migration lane on 2026-11-06 after
47-2a (#877) merged as `ef9209ba`. Migration 0214 carries the data-step marker and
a concurrent drop/create of the new replay index, so an interrupted build can
restart without accepting an invalid index. Its snapshot follows 0213.

## Addendum proposed 2026-11-07 — A-1 API low-rating recipients and names

This docs-only prerequisite approves the API read interfaces for spec 060, 61-1. It adds no implementation,
migration, permission grant, producer or lifecycle activation. The earlier worker customers-to-staff read
remains separate. The postponed RatingAlertRecipientsPort of the 2026-10-21 addendum is now specified here.

API customers owns RatingAlertRecipientsPort<Transaction>. managers(tx, companyId, businessId, branchId,
roles, at) returns sorted unique {userId, owner} rows through API identity's existing readBranchRoleHolders.
commentReaders(tx, companyId, businessId, branchId, userIds, at) returns a sorted unique subset through the
proposed API identity public readRatingCommentReaders. Both run on the caller's tenant transaction. The supplied
at must belong to the reviewed emission-time authorization decision required by BR-B4. Sampling the submit clock
after the rating-request lock alone does not establish that guarantee under concurrent permission changes or
application/database clock skew. A1 approves no earlier-time or non-serialized reinterpretation of BR-B4.
The decision instant, clock source and coordination with all relevant permission writers are U4, an OPEN
DESIGN/READINESS BLOCKER before E's readers land. No company-lock exception, isolation change, new port or
token-expiry change is approved here. Empty input returns an empty result without I/O.

The comment reader separates current manager-role eligibility covering the visit branch from effective
permission aggregation across all active memberships. It retains covering DENY grants, including those
from a sibling non-manager membership, applies unexpired overrides and P-1's role eligibility, and uses
API evaluateAccess/protectOwnerAccess semantics. Owner protection removes administrative DENY; it does not
invent ALLOW. The reader uses set-based queries, without one transaction or query per recipient.

API customers' PerformerNamePort<Transaction>.firstNames(tx, companyId, employeeIds) uses the proposed
API staff public readEmployeeDisplayNames(tx, companyId, employeeIds). Staff returns stored bilingual names
for the snapshotted ids in that company, including soft-deleted employees; the customers adapter applies
its own pure first-word/display policy and preserves one result entry per requested performer. No API code
imports the worker implementation, and staff does not import customers' domain.

API customers' LowRatingNoticePlacePort<Transaction>.forBranch(tx, companyId, businessId, branchId) calls
API tenancy's existing describeWorkspaces(tx, [{scope: 'BRANCH', scopeId: branchId}]). It verifies the exact
company, enclosing business and branch against the consumed request and returns branch names or null.
The tenancy reader excludes soft-deleted companies. Missing required context is an explicit transactional
availability failure in the later emitter, not a silent successful rating without its required notice.
The direct identity role readers do not gain an extra tenancy-table join or a new company-state promise.

All adapters are in API customers/persistence and call only the other module's public index.ts on the
existing transaction. AlertRulesPort.rule uses API settings.readAlertRule; identity role resolution remains
on RatingAlertRecipientsPort. API customers may import identity for these reads; identity imports only
tenancy, so this declared edge is acyclic. Active module-map reads entries land with the later adapters;
A-1 records their exact planned paths as comments and documents the ports.

The runtime contracts parser is composed at customers.module.ts and injected as an own plain port into
the submit transaction factory. Every group is validated before bulk outbox append, and the parsed groups
are the values persisted. Domain remains pure; no new contracts runtime dependency is added to domain,
ports, use cases or persistence. No commissions-only import exception is borrowed.

P-1's catalog/default/seed and grant/current-role policy precede the later reader tests and emitter.
A-1 itself is docs only and does not depend on that FK being populated. Deployment, transport choice,
rolling-version compatibility, exact-head gates, migration approval and activation remain separate gates.


### Addendum 2026-11-11 — `PackageSaleRequested` (058 / 42-3b, PP-170)

`PackageSaleRequested { sale_request_id }` (orders ⇒ orders worker) is id-only, appended by the
package sale acceptance in the same transaction as its `pending` `package_sale_requests` row,
and consumed by the orders worker's `package-sale` job, which performs the whole sale in one
transaction and emits `PackageSaleChanged` from it. Boundary, idempotency, retries, status
states and deploy ordering are recorded in ADR-0034's 2026-11-11 addendum.

### Addendum 2026-11-12 — `LeaveHistoryReportRequested` (068 / 68-2b-2, PP-176)

`LeaveHistoryReportRequested { report_id }` (staff ⇒ staff worker) is id-only and will be appended by the
report acceptance (68-2c) in the same transaction as its `pending` `leave_history_reports` row. 68-2b-2a ships
only the tables; 68-2b-2b registers it as a known type of the staff worker module and ships the consumer
(`leave-history-report` build job and the hourly per-company cleanup) with no producer; 68-2c waits for 68-2b-2b worker readiness. Boundary, states and deploy order: ADR-0034's 2026-11-12 addendum.

### Addendum 2026-11-13 — 46-2 package refund reads the imported-refund switch (spec 058)

`POST /v1/businesses/{businessId}/branches/{branchId}/packages/{entitlementId}/refunds` needs two
answers it cannot own. The first is the caller's authority over the branch: `orders` reads it through
`PackageRefundAccessPort` exactly as it does for the extension — identity keeps the
`refund:packages:branch` permission, the DENY state, the orders feature and the eligible acting
memberships, and orders' adapter calls identity's public reader on the refund's own transaction.

The second is the business's `imported_refunds_enabled` switch. `settings` owns the column and
publishes one public reader, `readImportedRefundsEnabled(tx, companyId, businessId)`, that reads the
row without creating it and answers a strict boolean: only a stored `true` is on, and a null value,
a missing row or `false` is off (spec 058 FR-053, PK-Q24). `orders` owns the consumer side,
`ImportedRefundsPort`, and its adapter calls that reader once on the refund's own transaction. The
refund uses that decision for the whole refund; a switch change committed after the read does not affect
that refund (a decision-time read). The refund path also takes the service-session edit-access lock
(`lockServiceSessionEditAccess`) through the access port.

- **A read, on the caller's transaction.** No new import arrow: `orders: [..., settings]` already
  exists in §2 (ADR-0041's `DiscountLimitPort`), and `settings` imports nothing new.
- **Only an imported entitlement reads it.** A sold entitlement refunds under the same rules whether
  the switch is on or off, so the reader is not called for it at all (spec 058 RF-08).
- **No second transaction.** The switch is read inside the refund transaction, never in a separate
  `withTenant`, because the guards' connection budget allows one transaction per request and the
  authority, the locks and the money must share it.
- **The write stays out.** Only the owner, or a holder of `manage:imported-refunds:business`, turns
  imported refunds on, and that route, its permission and its audit land in 46-2a-S; this slice reads
  the flag only.

`module-map.md` §3 gains the two port rows, §6 gains the four `reads` lines of the refund adapter
(the two identity readers, the settings reader and the tenancy place reader), and the generated
`docs/module-map.yaml` is regenerated.
