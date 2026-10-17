# ADR-0044 — Service-line price/discount edit: event shape, manager bell and the orders → notifications edge

Date: 2026-10-16. Status: Accepted design for spec 050 row 35d. Recipients (ED-Q9), the editor's own bell (ED-Q10), the wording (ED-Q11),
the receptionist's view (ED-Q12) and the no-employee editor (ED-Q13) were answered by Waleed on 2026-10-16 (Abu Salem has not answered; his pick binds if different).
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
Memberships are sampled at processing time, as in 35b-2. The editor is **not** removed from the recipients (ED-Q10, against the recommendation): everyone eligible gets the bell, including the person who edited, as with the late bell.

### 3. Why a new `orders → notifications` edge is allowed

The edge is an **event arrow** (module map §1), not an import: orders appends to the outbox inside its own
transaction and knows none of its consumers; `ServiceLineEditNoticeRequested` is consumed by `notifications` exactly as
`LateServiceSessionNoticeRequested` is. It could not be a port (the bell is a reaction to a committed state change, not
a read) and it cannot be a synchronous call (CLAUDE.md §4.1: cross-module side effects go through events). The edit
itself never waits for, or fails because of, the bell. Future extraction cost: none beyond the existing outbox contract.
`ServiceLineChanged` itself is **not** declared as consumed by `notifications`.

### 4. Money in the bell

The in-app display-name filter rejects any seven digits even with separators between them (`1250.000` fails, `125.000`
passes) and is a name filter, not a money type, so amounts need their own strict parameter (`/^\d{1,11}\.\d{3}$/`) beside the existing ISO-date parameter.

### 5. The editor's name

ED-Q11 puts the editor's name in the bell. Display names live on `employees` (`name_ar`, `name_en`, linked by
`employees.user_id`); the global `user` table is reachable from `packages/auth` only (CLAUDE.md §5). The name is a
**snapshot taken at commit**: the 35d-4 edit use case reads the active linked employee's names through an orders-owned
`EditorNamePort` (a narrow `staff` export keyed by company, business and user id — one active employee per user per
business is allowed, so the business must be part of the key) and stores them in the immutable edit-history row in the
same transaction. The event carries no name; the 35d-2 consumer reads the history row, so a deactivated or relinked
employee cannot change an already-committed bell and the worker needs no `staff` read. The `orders → staff` arrow already
exists; the exact §6 read entry is declared with this ADR. An editor with no linked employee (for example an owner who is
not an employee) has no name to snapshot, and the global `user` table is not readable here. ED-Q13 (Waleed, 2026-10-16)
decided that the bell and the «edited» mark then write the role only (fixed ar/en wording: «المالك» / «المدير»), until a name
source is agreed; the history row stores an `editor_role` snapshot for that purpose. ED-Q12 (same day, against the
recommendation) keeps the full history behind the manager's branch-sessions read: the receptionist sees only an «edited»
mark and the edit response carries no history fields to a caller without that permission.

### 6. Edit authority is rechecked inside the edit transaction

The edit commits a financial change, so the HTTP guard's decision is not enough. The 35d-4 use case rechecks the selected
editor membership, the new permission, DENY state and feature through an orders-owned `SessionEditAccessPort`
(`lock()` then `read()`, mirroring recording's access port), after all line and performer waits and before an
idempotency replay returns (`lock()` is recording's access lock over the company's memberships, so the principal's effective
branch-read decision that projects the response is read under the same locks, through the protected effective-access
decision with owner immunity: [spec-35d](../specs/050-orders-record-service-session/spec-35d.md) FR-013/FR-014); the
editor's effective discount limit is read fresh in the same transaction
(`DiscountLimitPort.read`, ED-Q2). The exact §6 read entries are declared with this ADR.

## Consequences

- The module map (§3, §4, §6) and the generated YAML are amended in the plan PR, ahead of the code, so 35d-1/35d-2 do not
  need a map-only fix-up. No import arrow is added.
- 35d ships consumer first (35d-1, 35d-2), writer later (35d-4). No `ServiceLineChanged` with a `change` exists before
  its consumer, so ADR-0041 §6's recovery obligation does not arise for the bell; rows 50/59 keep theirs.
- Row 62 (alert settings) must list `service_line_price_edited` in its individual and master disable controls, as it
  must for `late_service_session` (ADR-0041 §5).
- One new tenant table (`service_line_edit_notices`) with FORCE RLS, SELECT/INSERT-only grants, an allowlist entry, an
  inventory entry and a negative isolation test in 35d-2; pipeline §5 database review applies.
- The bell is not a control by itself: the edit-history row (ED-Q8) is the permanent record, and an edit with no eligible
  recipient produces no bell.

## Addendum (row 37, cancel bell)

`ServiceLineChanged` stays one event and gains the additive change kind `LINE_CANCELLED`. The refinement is
kind-dependent: `PRICE_DISCOUNT_EDIT` requires `status ACTIVE`; `LINE_CANCELLED` requires `status CANCELLED`; both
require `revision = change.previous.revision + 1`. A sibling worker `orders` consumer `orders.line-cancel-notice-v1`
handles only `LINE_CANCELLED`. The price-edit consumer `orders.price-edit-notice-v1` keeps ignoring every other kind.

The bell is a separate event, `ServiceLineCancelNoticeRequested`, with a separate insert-only ledger keyed
`(company_id, line_id, revision)`: one notice per cancelled line, in groups of at most 100. Recipients are the same
four scoped manager roles, and the canceller is not excluded. The bell (`service_line_cancelled`, ar/en) shows the
service, the branch, the business date and the cancelled net. It never carries the cancellation reason or the
canceller's identity; identity is readable only through the guarded history read. No new import arrow.
`notifications` only stores the in-app row and does not consume `ServiceLineChanged`.

## Addendum (row 37b, performers-change bell)

`ServiceLineChanged` stays one event and gains the additive change kind `PERFORMERS_CHANGE`. The refinement is
kind-dependent: `PERFORMERS_CHANGE` requires `status ACTIVE` and `revision = change.previous.revision + 1`, and its
`previous` is `{revision, performers}` instead of `{revision, price, discount, net}`. `PRICE_DISCOUNT_EDIT` still
requires `status ACTIVE`; `LINE_CANCELLED` still requires `status CANCELLED`. A sibling worker `orders` consumer
`orders.line-performers-notice-v1` handles only `PERFORMERS_CHANGE`. The price-edit consumer
`orders.price-edit-notice-v1` and the cancel consumer `orders.line-cancel-notice-v1` keep ignoring every other kind.

The bell is a separate event, `ServiceLinePerformersNoticeRequested`, with a separate insert-only ledger keyed
`(company_id, line_id, revision)`: one notice per changed line, in groups of at most 100. Recipients are the same
four scoped manager roles, and the changer is not excluded. The bell (`service_line_performers_changed`, ar/en)
shows the service, the branch, the business date and the line net. It never carries the reason, a performer's name,
or the changer's identity; identity is readable only through the guarded history read (spec 055 FR-016). No new
import arrow. `notifications` only stores the in-app row and does not consume `ServiceLineChanged`.
