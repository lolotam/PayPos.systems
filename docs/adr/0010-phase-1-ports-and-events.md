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
| `NotificationDelivered` | `notifications` | `reporting`, `customers` | the provider accepted a message; for `rating_request` over WhatsApp, customers moves the request `SENDING → SENT` by `source_event_id` = the `RatingRequestReady` event id (D-B8, 59b-3) |
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
  «شهر، ولحد 24»; issue #497; narrowed at the database `CHECK` to 1–12 by issue #519 / migrations `0264`–`0265`, with
  domain-side clamping of any stored value above 12 to 12 kept as defence in depth).

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
`{ delivered: false, error: 'RATING_CLAIMS_SCHEDULE_RETRY', retryInMs: <the PP-97 backoff> }`
(`apps/worker/src/modules/customers/jobs/rating-claims.processor.ts`), using the same backoff the
outbox dispatcher uses: 5 s, 10 s, 20 s … capped at one hour, and `null` on the tenth attempt,
which parks the event. The stored event is not acknowledged on a registration failure, so a newer
worker retries it. The registration path never touches the claim core: `ensureRegistered` upserts a
missing scheduler and leaves a running one untouched.

#### 9.1 The `outbox/retry-policy` boundary and the reuse decision (2026-11-26)

`apps/worker/src/modules/customers/jobs/rating-claims.processor.ts` used to import `retryDelayMs`
straight from `apps/worker/src/outbox/retry-policy.ts`. That path is not a module layer and
`outbox/` has no `index.ts` public surface, so a `jobs/` file was reaching into another area's
internals — outside what `packages/config/eslint/boundaries.js` allows a `jobs` element
(`from('jobs', 'jobs', 'use-cases', 'queries')`).

**Decision.** The PP-97 sequence is now owned by the `customers` domain itself, in
`apps/worker/src/modules/customers/domain/rating-claim-scheduling.ts`:
`RATING_CLAIMS_MAX_SCHEDULE_ATTEMPTS = 10` and the pure function
`ratingClaimsScheduleRetryDelayMs(attempt)`, which returns the exact PP-97 sequence
`[5000, 10000, 20000, 40000, 80000, 160000, 320000, 640000, 1280000, null]`. The `jobs/` file
imports it from the module's own `use-cases/` surface
(`use-cases/claim-rating-requests/claim-rating-requests.ts`, which re-exports it), which is the
arrow the boundaries file allows. `outbox/retry-policy.ts` is untouched and keeps serving the
dispatcher; `domain/__tests__/rating-claim-scheduling.spec.ts` proves the two stay equal attempt by
attempt for attempts 1…12, so the sequence cannot drift.

**The composition root keeps the injection seam.** `RatingClaimsProcessorOptions.retryDelayMs` and
`RatingClaimsRuntimeDeps.retryDelayMs` accept an optional `(attempt: number) => number | null`,
the same pattern `orders.module.ts` uses for `startPackageImportCommitWorker`. The default is the
domain function; a test or an operator can inject another policy without the `jobs/` layer
reaching into `outbox/`.

**Classification.** `outbox/` is not a module in the Screaming Architecture: it is the worker's
delivery machinery, shared by every module's consumer. A module may not import another area's
internals, so the reusable piece of a policy that two areas need is a **pure function in the
owning module's `domain/`**, not a shared internal file. No import arrow is added and no module-map
decision is needed: the arrow is `customers/jobs → customers/use-cases`, inside one module.

#### 9.2 Operator runbook: a parked rating trigger (2026-11-26)

A registration failure parks its trigger event after ten attempts (`parked_at` is set, the event
keeps its `attempts = 10`). The parking itself is unchanged by this work; what is new is that it
is **diagnosed and recovered without touching the PP-97 semantics**.

**Diagnose.** The park is visible in the dispatcher's own log (`outbox event parked`) and in the
row: `SELECT id, event_type, attempts, parked_at, last_error FROM outbox WHERE company_id = $1
AND parked_at IS NOT NULL AND event_type IN ('ServiceSessionRecorded','ServiceSessionLinesAdded',
'ServiceLineChanged')`. The worker's own log line `rating claims schedule failed` carries
`company_id`, `event_id`, `event_type` and `attempt`, and `rating claims queue error` carries the
connection-wide failures without guessing a company.

**Re-register.** The scheduler lives in Redis, so a lost Redis means a lost registration. The
`recover-rating-claims` operator command re-registers the company and replays its stored trigger
events through `createRatingSchedulingConsumer`; it does not build a claim worker and does not
rewrite the outbox.

**Recover the parked rows.** Migration `0089` (`recoverKnownOutboxEvents`) resets parked events for
the staff event types only, so the rating triggers are recovered with the same statement shape
scoped to the rating trigger types:

```sql
UPDATE outbox
SET parked_at = NULL, attempts = 0, next_attempt_at = clock_timestamp(), last_error = NULL
WHERE published_at IS NULL AND parked_at IS NOT NULL
  AND event_type IN ('ServiceSessionRecorded','ServiceSessionLinesAdded','ServiceLineChanged');
```

**Proof.** `apps/worker/src/rating-claims/__tests__/rating-claims-registration-recovery.spec.ts`
runs the whole path against the isolated Postgres lane and a private Redis: ten registration
failures produce the PP-97 backoff sequence and park the head event, the head blocks the newer
`ServiceSessionLinesAdded` event of the same aggregate, no `rating_requests` row is created while
registration fails, and after the recovery both events deliver **in order** through
`createRatingSchedulingConsumer` producing exactly one `rating_requests` row — no skipped update
and no duplicate. A second recovery over the same events is idempotent.

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

#### 10.1 Local capacity and latency measurement — indicative, not an SLA (2026-11-26)

> **These numbers are an indicative local-machine measurement, not an SLA.** They describe one
> Windows workstation with one Docker Postgres lane and one private Redis, on one afternoon. They
> are a baseline to compare against, never a promise to a customer and never a release gate.

**Provenance.** CPU `Intel(R) Core(TM) i7-8700 CPU @ 3.20GHz` (6 cores / 12 logical); OS
`Windows NT 10.0.26100.0`; Docker Postgres 16 (isolated lane `55401`) and private Redis 7
(`56382`); date `2026-11-26`; base SHA `32b523744499b3367954944d90ae935b338c556e`.

**Settings, unchanged by this work.** `TENANT_TIMEOUT_MS = 1000` (the tenant transaction timeout
in `rating-claim.transactions.ts`), the tenant pool `maxConnections = 10`, the forward budget
`FORWARD_VISITS = 75`, the retry budget `RETRY_VISITS = 25`, and the single-owner concurrency of
the fenced turn. The measurement changes **no** production constant.

**Shape.** `apps/worker/src/rating-claims/__tests__/rating-claims-capacity-latency.spec.ts` runs
both phases in one test file against the isolated lane: a **baseline** of sequential,
uncontended single-company turns, and a **contended** phase with two companies turning
concurrently, an overlapping second turn per company (the fence lets one owner win), and four
competing queries sharing the same ten-connection pool. The seeded data is representative:
per company, 240 due `SCHEDULED` requests, 60 historical `SENT` rows and 60 historical
`CANCELLED` rows (skipped by the `SCHEDULED` sweep), plus the sessions, session lines, employees
and customers behind them.

**Observed numbers** (`rating_claims_capacity_measurement`, the JSON the test prints):

| metric | baseline | contended | ratio |
|---|---|---|---|
| `withRequest` p50 | 29.55 ms | 33.21 ms | — |
| `withRequest` p95 | 40.00 ms | 54.14 ms | 1.35 |
| `withRequest` p99 | 45.30 ms | 79.47 ms | 1.75 |
| `withRequest` samples | 120 | 360 | — |
| turn duration p50 / p95 / p99 | 1473.09 / 2502.43 / 2502.43 ms | 11.12 / 3069.71 / 3069.71 ms | — |
| enqueue-to-active p50 / p95 | 9.40 / 61.56 ms | 0 / 56.14 ms | — |

**Functional counters in the same run.** `unknown = 0`, `retry = 0`, `overflow = 0`,
`pastDeadline = 0`, `duplicates = 0`; backlog `seeded = 480`, `drained = 480`, `remaining = 0`.
The contended `p50` of the turn duration is small because most contended turns are the losing
overlap: they are refused at `acquire` with `ACQUIRE_BUSY` and do no work — the fence held.

**How the test asserts.** There is **no fixed millisecond threshold** anywhere in the file. The assertions
are functional (`unknown`, `overflow`, `pastDeadline` and `duplicates` are zero; the backlog is fully
drained; each company hits its exact `perCompany` turn/visit/settlement totals and overlapping turns
trigger `ACQUIRE_BUSY` under the fence) plus **relative** within-run contention bounds against
the baseline of the same run (`withRequest` contended p95 and p99 ratios above zero and below 5×,
following the ratio-over-fixed-millisecond discipline of `CLAUDE.md` V3.23 / PP-165).

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

### Addendum 2026-11-21 — 46-2a-S the imported-refund switch write (spec 058)

The write the 2026-11-13 addendum deliberately kept out lands now. `settings` owns
`GET`/`PUT /v1/businesses/{businessId}/settings/imported-refunds`, guarded by
`manage:imported-refunds:business` on the business. The write follows the business-identity
pattern in one `withTenant` transaction: identity locks the company, the memberships and the
business, decides the permission, the settings row is created and locked, the decision is
rechecked at the database clock after the waits (so a revocation that commits first wins,
FR-B06), the changing write stores only the switch and `updated_by`/`updated_at`, and exactly
one audit entry records who changed it and both values in the same transaction (FR-B05). A
write that repeats the effective value stores nothing and audits nothing; the empty settings row
the locking step creates is the same behaviour every settings write has.

- **Two new identity symbols, one shared lock sequence.** The business-identity lock/decision is
  extracted unchanged into `lockBusinessPermissionAccess`/`readBusinessPermissionAccess`
  (parameterised by the permission code) and `business-identity-access.ts` keeps its exported
  names as thin wrappers, so the two real implementations (business identity, imported refunds)
  share one lock order instead of drifting. settings' adapter binds
  `lockImportedRefundsAccess`/`readImportedRefundsAccess`; the `settings → identity` arrow and
  the port row (`ImportedRefundsAccess`) are already declared, and §6 gains the two `reads`
  lines.
- **No cache, no event.** The page's read is a `queries/` keyed select; the Redis settings cache
  holds only the generic settings read, which does not carry this field, so nothing is
  invalidated, and nothing consumes an outbox event — the audit entry is the record.
- **The read stays out of this change's path.** The merged orders reader
  (`readImportedRefundsEnabled`) and the refund use case are untouched; a null default, a missing
  row and `false` all stay off for it (PK-Q24).

`module-map.md` §3 gains the settings port row, §6 gains the two `reads` lines of the settings
adapter, and the generated `docs/module-map.yaml` is regenerated.

## Addendum 2026-11 — A-2 low-rating notice composed in the worker

Spec 060's low-rating alert needs the reads the A-1 addendum above approved on the API side. That design never
shipped code, and `plan-61.md` (row 61's plan, §2) records why it cannot stand: the composed notice would run inside
the public rating transaction (`RATING_TRANSACTION_TIMEOUT_MS = 1_000`, an anonymous route), its payload would grow
with performers × recipients, and BR-B4's emission-time authorization had no selected decision instant there
(plan-61-1's U2/U4, its §4–§6). The manager asked Waleed where the notice is composed and when its conditions are
evaluated (owner-questions.ar.md items 34 and 35), and Waleed answered: M1 «في الـ worker (المقترح)» and M2 «لحظة
قرار الـ worker (المقترح)» (2026-11-20 14:35 Kuwait, PP-207.2 and PP-207.3). RT-Q17 (the comment shown as written,
PP-207.1) belongs to 61-1h's comment mapping and does not change this addendum. This addendum supersedes the A-1
addendum's API read approvals and plan-61-1 §4–§6, as M1 records; it adds no import arrow.

### The change

- **API `customers` — the public submit transaction.** When the consumed rating has `stars <= 2` (the pure predicate
  `isLowRating(stars)` in `customers/domain`), the same transaction appends one internal event `LowRatingSubmitted`
  (customers API ⇒ worker customers): `{ schema_version: 1, rating_id, request_id, business_id, branch_id, stars }`,
  aggregate `rating` / `rating_id`. Nothing else is added to that transaction: no rule read, no identity, staff or
  tenancy read, no names, no comment. Ratings of 3 stars or more append no event. Ratings of 1 or 2 stars append
  the same event regardless of the rule state.
- **Worker `customers` — the consumer.** A new outbox consumer handles `LowRatingSubmitted` with the use case
  `request-low-rating-notice` in one tenant transaction, the same shape as orders'
  `request-late-service-session-notice`: verify the event against the stored rating → company open → the
  `LOW_RATING` rule → recipients → place → claim the `low_rating_notices` ledger (unique `(company_id, rating_id)`,
  so the decision is made once per rating) → comment readers (only for a non-null comment) → names → compose →
  append `LowRatingReceived` (customers ⇒ notifications, a `notificationRequest` payload in groups of at most 100
  recipients per template partition, ADR-0037 §5). If the rule is off or has no `IN_APP` channel, record a terminal
  zero-recipient decision in the ledger and emit no notice (spec 060 BR-B5). Redelivery preserves that decision.
- **`LowRatingReceived` keeps its ADR-0010 meaning and name.** Only its emitter moves from the API `customers`
  module to the worker `customers` module; the `notifications` consumer is unchanged.

### The decision instant (M2)

Two reads happen inside the worker consumer transaction, and they answer two different questions.

**The rule snapshot.** `AlertRulePort.rule(companyId, scope, 'LOW_RATING')` is one statement that
reads the governing rule (the branch rule if there is one, otherwise the business rule) together
with the business master switch `alerts_enabled` — `settings.persistence/alert-rule.ts` returns
both in one row. That single read is the **rule snapshot**: it decides whether the notice is
active at all. A rule or master-switch change that commits **before** that read is part of the
snapshot; a change that commits **after** it is not, and does not flip the decision even if it
commits before the recipients or the ledger row are written. The read happens before
`decidedAt = clock.now()`, so the rule snapshot is not a function of the worker's wall clock.

**The decision instant.** `decidedAt = clock.now()` is read once inside the consumer transaction,
exactly as the orders bells decide their recipients. It is the timestamp stored on the
`low_rating_notices` ledger row, and it is the instant that governs the **identity** reads:
`recipients.managers` and `recipients.commentReaders` resolve membership and permission-override
expiry against it, so a membership or an override that expires between the rating and the decision
is honoured (stricter), and one granted in between is honoured too. BR-B4's «checked at emission»
means checked when the worker emits `LowRatingReceived`, normally seconds after the rating: a
permission revoked between the rating and the decision is honoured, and a revoke that commits after
the decision's snapshot does not retract a stored notice.

**The terminal suppressed decision.** If the rule snapshot is off, or has no `IN_APP` channel, the
worker still records **one** terminal `low_rating_notices` row with `recipient_count = 0`, appends
**no** `LowRatingReceived` event, and emits no notice. That decision is final: a redelivery or a
replay of the same event finds the row and changes nothing, so the notice never appears later
(BR-B5, D-B15).

**Separate transactions.** The customer's rating is committed in the API's own submit transaction
and is never rolled back by the notice; a worker failure aborts only the worker transaction.

### Ports and reads declared (no new import arrow)

`customers: [tenancy, settings, staff, identity]` is already declared for both apps in module-map §2; every port
below is a consumer-owned read on the caller's transaction, and each adapter adds its `reads` line in the PR that
writes it. The orders-worker rows are the template.

| Consumer | Port | Reads from | Built in |
|---|---|---|---|
| worker `customers` | `AlertRulePort.rule` | worker `settings.alertRule` | 61-1h |
| worker `customers` | `LowRatingRecipientsPort.managers` | worker `identity.branchManagerRecipients` | 61-1h |
| worker `customers` | `LowRatingRecipientsPort.commentReaders` | worker `identity.ratingCommentReaders` (new public reader) | reader 61-1g, adapter 61-1h |
| worker `customers` | `LowRatingPlacePort.forBranch` / `.companyOpen` | worker `tenancy.branchPlace` / `tenancy.companyOpen` | 61-1h |
| worker `customers` | `PerformerNamePort` | worker `staff.readEmployeeDisplayNames` — already declared (2026-10-31 addendum) | exists |
| API `customers` (61-2) | `OwnRatingsAccessPort` / `RatingsReadAccessPort` | API `identity.readOwnRatingsAccess` / `identity.readRatingsReadAccess` (new) | 61-2a / 61-2b |
| API `customers` (61-2a) | `OwnEmployeePort` | API `staff.readOwnEmployee` — existing | 61-2a |
| API `customers` (61-2) | time zone and workspace tree | API `tenancy.activeBusinessTimeZone` / `describeWorkspaces` — existing | 61-2 |

### Withdrawn, and what stays

- **Withdrawn unbuilt** — the A-1 addendum's API approvals: `RatingAlertRecipientsPort`, the API `PerformerNamePort`,
  `LowRatingNoticePlacePort`, the proposed API readers `readRatingCommentReaders` and the API
  `staff.readEmployeeDisplayNames` path, the A-1 parser-composition design, and the five `# Planned E:` comments of
  module-map §6. No code was ever written against them, so nothing is deleted from source.
- **`customers → identity` stays.** The worker recipients reader and 61-2's API access readers use it; no
  worker-to-API edge exists or is added.

### Consequences

- The public transaction gains one fixed-size outbox insert (about 300 bytes); its cost no longer depends on
  performers (P) or recipients (R). The worker transaction still grows with P·R. The per-event recipient groups
  do not cap or truncate the recipients or split the decision across transactions. The transaction runs under the existing worker delivery limit (`DELIVERY_TIMEOUT_MS = 60_000`):
  an exceeded delivery rolls back, is retried by the dispatcher and finally parks where an operator sees it.
- Two outbox hops (rating → worker customers → notifications) before the bell. SC-004 allows 2 minutes; the orders
  bells already take two hops. Sub-PR 61-1i's staging verification measures it once and records the number.
- The `low_rating_notices` ledger (61-1d) is required: each redelivery would mint new notice event ids, and a
  permission change between redeliveries could otherwise give one manager both `low_rating` and
  `low_rating_with_comment`.
- Module map: §3 replaces the three A-1 API rows with the worker rows; §4 gains `LowRatingSubmitted` and
  `LowRatingReceived`'s emitter moves to worker `customers`; the §6 machine block deletes the five `# Planned E:`
  comments and adds `# Planned` comments for the worker reads. Those comments leave generated
  `docs/module-map.yaml` unchanged. Spec 060's D-B9, FR-B13, FR-B14, FR-B15, BR-B4 and the 61-x sub-PR rows are updated by the same docs PR (61-1a); its primary
  local gates are `pnpm lint:docs` and `pnpm module-map:check`, with the scoped formatting check `pnpm format:check` as supplemental, and no source file change.

## Addendum 2026-11-21 — 61-2a: the staff rating summary's own-read authority

Scope: the API read `GET /v1/staff/me/rating-summary` (spec 060 FR-A05, FR-B14; `plan-61.md` §6). The preceding A-2 addendum declares the ports.
This entry documents the 61-2a implementation.

- API `customers` resolves its authority through reads on already-declared arrows, on the read transaction:
  `tenancy.describeWorkspaces` (the business and its active branches), `staff.readOwnEmployee` (the caller's own
  eligible employee), the new `identity.readOwnRatingsAccess` (membership, feature `customers`, `read:ratings:own`)
  and `tenancy.activeBusinessTimeZone` (the month window of D-B12).
- The route accepts the ADR-0027 personal staff session only.
- It is the same shape ADR-0041 records for orders' own-work reads; no interface is shared between the two modules.
- No import arrow is added. `customers → tenancy, settings, staff, identity` are already declared.
- The `rating_average` column gate is read through customers' existing `StaffColumnsPort` and stays off until 61-3.
- No event is added or changed.

## Addendum 2026-11-25 — 59b-3 rating_request send and SENT tracking

Scope: the dormant `rating_request` WhatsApp template, the in-memory link derivation at send time and the `NotificationDelivered` ⇒ `customers` event row left open by the 2026-10-21 addendum. No import arrow, port or event type is added.

- **Template.** `packages/notifications` adds `rating_request` revision 1 (`UTILITY`, ar/en). `customer_first_name` is its only optional parameter (the `RatingRequestReady` payload omits it when the customer has no display-safe name); when omitted, the validator accepts the omission and `matchParameters` / `templateComponents` substitute the per-locale fixed greeting (`RATING_REQUEST_DEFAULT_GREETING`, PP-272) at preparation time so Meta always receives four body variables without storing the greeting in `outbox` or `notification_attempts`, while still rejecting extra, duplicated, reordered, mistyped or unsafe parameters. The default registry keeps no approved provider name, so authorization records `FAILED` with `CONFIG_INVALID` until Meta approves one and a registry is installed explicitly.
- **Sender-memory link.** The claim stores only the token hash and the key version (`token_key_version` on `RatingRequestReady`). Authorization appends that number to the stored safe parameters after validating the template without it. At send time the channel adapter derives the link in memory with the worker's sender codec at the stored version (`createRatingTokenSender` in `rating-token-capability.ts`, the only importer of `@pospay/auth/rating-token`) and substitutes `<origin>/#<token>` for the `rating_request_id` text in a fresh component array. The link is never stored, logged or written to `outbox`, `notification_attempts` or a job. A missing codec, a version absent from the ring or an invalid `RATING_PAGE_ORIGIN` makes both the preflight and the send fail closed with `CONFIG_INVALID`. In production or live mode the origin must be an explicit `https:` origin.
- **SENT tracking.** The worker `customers` consumer `customers.rating-sent-v1` handles `NotificationDelivered` with template `rating_request`, channel `whatsapp` and status `SENT`, and moves the request `SENDING → SENT` where `ready_event_id = source_event_id`, setting `sent_at` to the event's `occurred_at`. Redelivery and any other status change nothing; `NotificationFailed` leaves the request `SENDING`. A malformed payload or an envelope that disagrees with it raises `RATING_SENT_EVENT_INVALID`.
- **Production dormancy.** `main.ts` keeps `closedRatingClaimsLifecycle()` and the default registry, so no request is claimed or sent in production until slice 61-1 deploys the scheduler and an approved template name is installed.
