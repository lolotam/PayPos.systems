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
- `PackageSaleChanged` — `sale_id` (= the entitlement id), `business_id`, `sold_at`, `seller_employee_id`,
  `price_paid`, `refunded_amount`, `status`, `revision`.
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
  adapter adds its `reads` line in the PR that writes it, one line per symbol.
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
- `monthsBack(tx, companyId, businessId)` → `staff_months_back`, where `NULL` means 1 (the current month only) and the
  stored value is 1–24 (D-A14; MY-Q2, PP-18.2; MY-Q9, PP-21.1: «شهر، ولحد 24»).

`settings` stays the owner of both values; they are edited under the existing `manage:settings:business` (MY-Q5,
PP-18.5) and nobody else writes them. `orders` already imports `settings` (§2, ADR-0041's `DiscountLimitPort`).
The orders adapter calls a public settings reader that 57c-1 adds; the `commissions`, `customers` and `staff`
adapters, whose ports are already approved above, call the same reader in the same sub-PR (see §4 for their arrows).

### 2. Worker orders' `AlertRulesPort` (spec 060 D-B13, D-B14)

`rule(tx, companyId, scope, kind)`, with `scope = { businessId, branchId | null }`, returns the effective rule with the
business master switch applied: the branch's override when the event has a branch and an override exists, otherwise
the business rule (AL-Q2, PP-18.22: «نشاط، والفرع يغيّر»). Recipients are role selectors (AL-Q3, PP-18.23). The master
switch covers team alerts only (AL-Q4, PP-18.24). A kind with no saved rule uses the code-side default (AL-Q5,
PP-18.25), and row 62 delivers in-app only (AL-Q6, PP-18.26). The rules are edited under `manage:settings:business`
(AL-Q1, PP-18.21).

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
caller's transaction, where `time_zone` is the branch's effective zone (the branch's, otherwise the business's). It
is bound to a new public reader of the worker `tenancy` module, `branchScheduleHours(tx, companyId, branchId)`, the
same shape as its existing `branchPlace` and `businessTimeZone` readers.

- It feeds two pure functions in `customers/domain`. `requestDayOf(occurredAt, zone, openingHours)` gives each session
  exactly one request day: its branch-local date, or for a visit after midnight inside an overnight interval, the
  day that interval started. `ratingSchedule` takes the last close of that day (RT-Q4, PP-18.12 for both rules).
- The 59-1 consumer (D-B2) and the claim's reschedule (D-B5) both call it. Orders' `business_date` is not used: it is
  in the business zone and can name the wrong day near midnight for a branch in another zone.
- **No import arrow is added:** `customers: [tenancy]` already exists in §2.
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

- `module-map.md` §3 gains the three port rows above; §2 and the §6 `imports` gain the three arrows of §4.
- **No cycle between adapters** (the Consequences warning above): `settings` and `tenancy` read none of `orders`,
  `customers`, `staff` or `commissions` through any adapter.
- As the Consequences above require, each adapter adds its `reads` line in the PR that writes it, one line per
  symbol: 57c-1 adds the settings reader lines of all four `StaffColumnsPort` adapters; 62-2, 62-2b, 62-2c and 62-3
  add their `AlertRulesPort` lines; 59-1 adds `customers -> tenancy.branchScheduleHours`.
- **Not in this addendum:** customers' `RatingAlertRecipientsPort` (docs PR A-1, postponed with the rating track), and
  the `NotificationDelivered` ⇒ `customers` event row (spec 060 D-B8, in 59b-3).
