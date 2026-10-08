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
