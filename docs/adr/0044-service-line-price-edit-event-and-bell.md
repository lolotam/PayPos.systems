# ADR-0044 — Service-line price/discount edit: event shape, manager bell and the orders → notifications edge

Date: 2026-10-16. Status: Proposed design for spec 050 row 35d. Recipients (ED-Q9), the editor's own bell (ED-Q10) and
the wording (ED-Q11) are PENDING owner answers; the mechanics below do not depend on them.
Owner decisions: SS-Q10 option 2 (audited edit is its own row), ED-Q1…ED-Q8 (Waleed, 2026-10-13, batch 17; Abu Salem has
not answered, his pick binds if it differs), in particular ED-Q6 «a bell to the branch manager with every edit».
Related: ADR-0010 (Phase 1 ports and events), ADR-0018 (notification delivery), ADR-0037 (interim in-app manager rule),
ADR-0041 (§4 events, §5 late bell, §6 later consumers); issue #189; plan [plan-35d](../specs/050-orders-record-service-session/plan-35d.md).

## Context

`ServiceLineChanged` is the per-line state event of ADR-0010. ADR-0041 §4 made the first recording a batch event
(`ServiceSessionRecorded`) and kept `ServiceLineChanged` for later edits (35d), cancelling (37) and performer changes
(37b). The contract exists (`packages/contracts/src/orders/service-session.ts`) but nothing emits it yet, and its
consumers `commissions` (50) and `customers` (59) are not built.

ED-Q6 adds a business consumer that none of those rows covers: every price or discount edit of a saved session rings
the branch's managers. The module map listed `ServiceLineChanged` for `commissions` and `customers` only, and the only
`orders → notifications` event was the late-session notice (ADR-0041 §5, 35b-2). The shipped event also cannot drive the
bell: it has no change kind (so a cancel looks like an edit), no previous values, and `recorded_by` names the original
recorder, not the editor.

## Decision

### 1. One event, with an additive optional `change` block

`ServiceLineChanged` gains an optional `change` member: `kind` (`'PRICE_DISCOUNT_EDIT'`; 37/37b add kinds later),
`changed_at`, `changed_by`, `changed_by_membership_id`, and `previous {revision, price, discount, net}` (canonical
three-decimal KWD strings, ADR-0035). It is optional because every published batch payload embeds the same line schema
without it and the schemas are strict. The typed reason (ED-Q5), customer name/phone, performer names and recipients are
never in the event. It is emitted once per changed line, in the edit use case's own transaction with the line update
(compare-and-set on `revision`), the history row and the audit entry; any failure emits nothing.

Rejected: **a second dedicated event** (`ServiceLinePriceEdited`) beside `ServiceLineChanged` — two outbox rows for one
financial write, and the bell and commissions would have to be reconciled by revision; ADR-0041 §5 already moved
fan-out out of the financial transaction to keep it at one event. **Diffing `ServiceLineChanged` revisions in the
consumer** — needs the previous state, which is not in the event.

### 2. The consumer is worker `orders`, not `notifications`

Worker `orders` consumes `ServiceLineChanged` (consumer id `orders.price-edit-notice-v1`), reads the scope-covered
manager recipients through `identity.branchManagerRecipients` and the branch names through `tenancy.branchPlace`
(consumer-owned ports, exact §6 entries, no new import arrow), claims an insert-only ledger row
`service_line_edit_notices` with `UNIQUE(company_id, line_id, revision)`, and appends `ServiceLineEditNoticeRequested`
in groups of at most 100 recipients. `notifications` only registers the event in `NOTIFICATION_SOURCE_EVENTS` and a
template, reusing `notificationRequestConsumer` → `StoreInAppNotification` and the admin inbox/bell. This keeps the
rule of the module map that `notifications` holds no business knowledge, and it is the accepted 35b-2 shape.

Rejected: **`notifications` consuming `ServiceLineChanged` directly** — it would have to read orders, identity and
tenancy data to find recipients, or orders would have to import the notification package; both are forbidden (module map
§1–§2, ADR-0041 §5).

Idempotency is by event id (the outbox consumed mark, committed with the notice events, ADR-0018) and, as a second
line, by `(line, revision)` in the ledger. It is per line revision and **not** per session, unlike the late bell,
because ED-Q6 is "every edit". With no eligible manager the ledger records a count of zero and nothing is sent.
Memberships are sampled at processing time, as in 35b-2. The editor is removed from the recipients when ED-Q10 says so.

### 3. Why a new `orders → notifications` edge is allowed

The edge is an **event arrow** (module map §1), not an import: orders appends to the outbox inside its own
transaction and knows none of its consumers; `ServiceLineEditNoticeRequested` is consumed by `notifications` exactly as
`LateServiceSessionNoticeRequested` is. It could not be a port (the bell is a reaction to a committed state change, not
a read) and it cannot be a synchronous call (CLAUDE.md §4.1: cross-module side effects go through events). The edit
itself never waits for, or fails because of, the bell. Future extraction cost: none beyond the existing outbox contract.
`ServiceLineChanged` itself is **not** declared as consumed by `notifications`.

### 4. Money in the bell

The in-app display-name filter rejects seven or more consecutive digits, so amounts need their own strict parameter
(`/^\d{1,11}\.\d{3}$/`) beside the existing ISO-date parameter. If ED-Q11 puts the editor's name in the bell, 35d-2 adds
one narrow worker-`identity` display-name read with its exact §6 entry, as an addendum to this ADR.

## Consequences

- The module map (§3, §4, §6) and the generated YAML are amended in the plan PR, ahead of the code, so 35d-1/35d-2 do not
  need a map-only fix-up. No import arrow is added.
- 35d ships consumer first (35d-1, 35d-2), writer later (35d-4). No `ServiceLineChanged` with a `change` exists before
  its consumer, so ADR-0041 §6's recovery obligation does not arise for the bell; rows 50/59 keep theirs.
- Row 62 (alert settings) must list `service_line_price_edited` in its individual and master disable controls, as it
  must for `late_service_session` (ADR-0041 §5).
- One new tenant table (`service_line_edit_notices`) with FORCE RLS, SELECT/INSERT-only grants, an allowlist entry, an
  inventory entry and a negative isolation test in 35d-2; pipeline §5 database review applies.
- The bell is not a control by itself: the edit-history row (ED-Q8) is the permanent record, and an edit in a branch with
  no other eligible manager produces no bell.
