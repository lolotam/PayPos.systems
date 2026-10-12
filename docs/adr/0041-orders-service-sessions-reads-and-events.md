# ADR-0041 — Orders service sessions: reads and events

Date: 2026-10-12. Status: Accepted technical design for spec 050, Phase 1 row 35a.
Owner decisions: SS-Q1–SS-Q11, Waleed, 2026-10-12, batch 13; D-56 and discount enforcement, 2026-10-03.
Related: ADR-0010, ADR-0018, ADR-0023, ADR-0035, ADR-0037; Phase 1 SPEC §§3–6/11.

## Context

Orders currently contains pure package domain functions only. Catalog and customers export controller/provider
wiring, but no session-specific readers. Staff exports several narrow readers, but no performer reader. Settings
already exports `readEffectiveDiscountLimit(tx, companyId, businessId, membershipId)` for PR 35 (spec 018 FR-006).

`module-map.md` §3 declares orders' `CatalogReaderPort`, `CustomerLookupPort` and `PerformerCheckPort` under
ADR-0010. Both §2/§6 and generated `module-map.yaml` nevertheless allow only `orders: [tenancy]`. The actual
`staff/persistence/schedule-context.adapter.ts` and `settings/persistence/discount-subject-reader.adapter.ts`
import provider modules' `index.ts`; these adapter imports count as module edges. A port interface alone does
not exempt its adapter from the map or the cycle check. Architecture §6.2 permits this outer-ring adapter;
the general §3.1 persistence restriction is not permission to read another module's tables directly.

SS-Q5 chooses half-up, including a rounded discount that then exceeds the limit. SS-Q6 chooses saving the other
lines and returning the offending line for editing. This design must also preserve the requested one transaction,
one outbox event for each successful recording, whereas SPEC §3/ADR-0010 originally describe a line event.

## Decision

### 1. Consumer-owned ports, provider-owned reads, explicit adapter edges

Orders defines transaction-bound interfaces in `orders/ports/`; their methods take business values, not `Tx`,
Zod, NestJS or another module's types. Its persistence transaction factory captures the caller's tenant `Tx`
and constructs these adapters. Each adapter imports only a provider's public `index.ts`, calls its narrow
read-only surface on that same transaction, and maps the result into an orders-owned DTO. No second connection,
`withTenant` nesting, HTTP call, cross-context join or synchronous cross-module write is introduced.

Concrete binding belongs to `orders/orders.module.ts`, following the repo's `catalogProviders` /
`customersProviders` function pattern; `apps/api/src/app.ts` mounts exported orders controllers/providers.
Do not introduce a different NestJS module style for this slice. Readers added to a provider live in its own
`queries/` or `persistence/`, with a public export; repositories/use cases and infrastructure types stay private.

| Orders port | Provider surface | Orders adapter under `persistence/` | Map status / decision |
|---|---|---|---|
| `CatalogReaderPort` | new catalog `readSessionServices` | `catalog-reader.adapter.ts` | Port declared by ADR-0010; add import orders → catalog and the symbol read |
| `CustomerLookupPort` | new customers `readSessionCustomer` | `customer-lookup.adapter.ts` | Port declared; add import orders → customers and the symbol read |
| `PerformerCheckPort` | new staff `readSessionPerformers` | `performer-check.adapter.ts` | Port declared; extend facts for SS-Q2/8; add import orders → staff and the symbol read |
| `DiscountLimitPort` | existing settings `readEffectiveDiscountLimit` | `discount-limit.adapter.ts` | New read port orders → settings; add import orders → settings and the symbol read |
| `SessionRecordAccessPort` | new identity `lockServiceSessionAccess`, `readServiceSessionAccess` | `session-record-access.adapter.ts` | New authorization read port orders → identity; add import orders → identity and both symbol reads |
| `SessionPlacePort` | existing tenancy `businessTimeZone`, `describeWorkspaces` | `session-place.adapter.ts` | Import orders → tenancy already declared; add the port row and both symbol reads |

Catalog returns bounded batches of services in the confirmed business: list price, names, revision,
`FOLLOW_PLAN | ZERO | PCT | FIXED` rule and threshold flag. It reads `services`, not Phase 2 items/prices;
no tax/channel override is invented. The boundary maps all four rule kinds exhaustively (ADR-0035).
Customers confirms company-scoped existence and returns the name and already-masked phone only; orders
does not create/update customers or receive their full phone. This implements `exists` plus the write response's
display snapshot without importing `CustomerCreditPort` or granting general customer browsing.
Staff owns employee/branch/date eligibility, the persisted user link for the self rule, names and attendance/leave
facts for the session's day. `readSessionPerformers` takes `occurredAt`, business/branch and employee IDs; staff
derives the working day with its effective branch timezone and attendance `working_date` rules, and returns
eligibility/warning facts and persisted `employees.user_id` (nullable). Orders never needs the branch timezone.
No salary, passkey, phone, schedule or attendance write capability is exposed. Tenancy confirms the route
business/branch relationship and supplies only the business timezone for orders' accounting dates/window.

Settings remains the sole discount-limit resolver: active owner → UNLIMITED; personal limit (including zero)
→ business default → NOT_CONFIGURED. Orders enforces NOT_CONFIGURED as zero and refuses MEMBERSHIP_NOT_FOUND
with 403. It reads once per successful attempt, without cache, preserving spec 018's compatible SHARE locks and
fresh eligibility instant after lock waits. Orders does not reimplement owner/default resolution or query
identity/settings tables. The identity adapter only proves record authority and the recorder membership.

**Required map amendment in 35a:** §2 and §6 become
`orders: [tenancy, catalog, customers, staff, identity, settings]`; add the new §3 rows above and one `reads:`
entry per named symbol and adapter path. Generate YAML with `pnpm module-map:generate`; it has no `ports:` key.
This ADR authorizes each new edge. The present docs-only change does not claim those map edits are already made.
For these orders adapters, this explicitly supersedes ADR-0010's “No import arrow is added” decision/consequence:
the provider public-read imports do require the five compile-time edges, despite consumer-owned port interfaces.
There is no providers → orders edge. For row 59b's already-declared reverse `customers → orders` runtime port,
bind the orders reader as an injected callback at the application root; its customer adapter must not import
orders and create an orders ↔ customers compile-time cycle. Likewise orders never imports commissions or
notifications. Cycle and map checks remain mandatory.

**Lock compatibility with shipped catalog:** `drizzle-service-transactions.ts` updates by locking the service
`FOR UPDATE`, then updating it and inserting its audit; audit/FK checks can acquire company/business/user
`FOR KEY SHARE` afterward. Creation inserts a new service (parent FK KEY SHARE), then its audit. These writers
do not acquire company/membership UPDATE locks. Orders uses claim → company SHARE → memberships SHARE in ID
order → per-session advisory lock (append only) → services SHARE in ID order → employees SHARE in ID order →
settings SHARE. Company SHARE is compatible with catalog's later FK KEY SHARE, so a catalog edit holding the
service can finish while orders waits for it; orders must never substitute company FOR UPDATE in this order.
No catalog writer requests orders' session advisory lock, employee or settings locks. Preserve this order on
both routes; test the actual service-edit/audit interleaving explicitly, not just sorting batch IDs.

### 2. Permission and recorder identity

Add `record:service-sessions:branch`, default to global system roles `owner`, `general_manager`,
`business_manager`, `branch_manager`, `cashier`. It is grantable through the existing role/personal ALLOW
mechanism; scope, DENY, expiry and active-owner handling follow current identity rules. Device/personal staff
authentication does not acquire this admin recording capability (SS-Q3: each receptionist's own admin login).

The actual AccessGuard returns scoped grants and memberships without IDs; it does **not** choose the discount
membership assumed by the old spec. The locked identity reader therefore resolves caller-owned, active
memberships covering this branch. An optional `recorder_membership_id` selects one, verified server-side;
if exactly one applies it is used automatically, otherwise return `SESSION_RECORDER_MEMBERSHIP_REQUIRED`
with only the caller's candidate IDs. Never select the highest discount limit or introduce scope precedence.
Authority still uses the existing union of grants and DENY semantics, not a client claim. Persist the selected
membership and actor, and pass that exact membership to settings. A foreign, inactive or out-of-reach selection
gets uniform 403. Recheck record permission and the orders feature inside the write transaction after waits.

SS-Q2's “own performance” means a performer whose persisted `employees.user_id` equals the current recorder's
user ID. Staff returns that nullable link; a pure orders domain function compares it and rejects the whole
request with `SESSION_PERFORMER_SELF_FORBIDDEN`, independently of role/limit, with unit tests for matching,
different and null links. An unlinked employee cannot be detected as the recorder; never infer identity from
names, phones or membership IDs. An owner who also performs is subject to the same rule, including on append.

### 3. Discount arithmetic stays local; money rounding and authority rounding differ

Orders owns its pure `effectiveDiscountBps` copy in `orders/domain/`, following ADR-0035's separate-context
validation precedent. Do not import identity's domain through its index or move this execution rule into
`packages/domain`. The shared kernel continues to provide Money and `roundKwd`, not RBAC/commission enums.
Keep matching data-only enforcement fixtures (zero list, above list, exact limit, fractional overflow,
maximum money) in both contexts; no cross-module test import of the other domain function.

For an entered percent, `discount = roundKwd(priceMills * BigInt(bps), 10000n)` — nearest mill, half-up
(SS-Q5 option 2). Store the amount; `net = price − discount`. For enforcement,
`ceil((listPrice − net) * 10000 / listPrice)` in integer arithmetic is used, with zero for list zero or
net ≥ list. Compare inclusively to the limit; **any fraction above it is refused** (D-56 / 2026-10-03).
Never clamp or round down a discount to make it fit. Thus 7.125 at 10% becomes discount 0.713, net 6.412,
effective 1001 bps and is rejected at a 1000-bps limit. Prices above list are allowed and audited.

### 4. Partial acceptance, with one atomic recording event

Validate the entire request's shape, scope, time, references, self rule and shares first. Only an otherwise valid
line's above-limit discount is a partial refusal. Partition into accepted/rejected lines in domain code.
If at least one is accepted, insert one session, all accepted lines/performers, their audits, **one outbox row**
and the replayable 201 response in one tenant transaction. The response has `outcome: COMPLETE | PARTIAL`,
`session` (accepted lines only), and `rejected_lines` with input index, service, attempted amounts, effective bps,
limit and bilingual error. Rejected lines have no persistent line ID, audit or event. Total sums only saved nets.
If all exceed the limit, return 422 with all line errors and roll back the claim; create no empty session.
Any other error or persistence failure rolls back every accepted effect. There are no per-line transactions.

The client keeps rejected drafts and removes saved lines from its editor. Retrying the original key/body replays
the entire 201, including its rejections. SS-Q6 option 2 preserves the **same visit**: 35a also provides
`POST /v1/businesses/:businessId/branches/:branchId/service-sessions/:sessionId/lines`. 35c sends only corrected
rejected drafts there with a **new** key; it never resubmits saved lines. The body contains `lines` and optional
`recorder_membership_id`; customer, branch, occurred_at, business_date/timezone and original recorder are inherited
from the persisted session and cannot be changed. A new service during that visit may use the same append route.

Only the original session recorder or a current holder of `record:service-sessions:branch` at that branch may
append, using an authenticated admin login with active branch-covering membership/orders feature and existing
DENY semantics. Original-recorder status is not permission to cross a tenant/branch or use an inactive membership.
Resolve the **appending actor's** membership/discount limit, apply the self rule to that actor, and require the
stored session business_date to remain within the first-of-previous-month back-dating window at the fresh append
instant. Check all references, performers at the original occurredAt, shares and fresh catalog/limit snapshots
as on creation. Limit to 20 persisted lines across the visit (cancelled lines still consume a slot); rejection
drafts consume none. Serialize appends with a tenant-qualified per-session transaction advisory lock, count and
allocate contiguous session ordinals under it; initial ordinals are also contiguous in accepted input order.
Keep request `input_index` separate. No session-row UPDATE grant is needed for this append-only operation.

Append returns 201 COMPLETE/PARTIAL with `session` (full persisted visit), `added_lines` and `rejected_lines`;
all-over-limit returns 422 without changing the visit or retaining a claim. Capacity overflow/any other error
rolls back the whole append. One tenant transaction inserts accepted lines/performers, audit, replay response
and exactly one `ServiceSessionLinesAdded` outbox event. Each new line records its appending actor/membership,
fresh recorded_at and late flag; session header identity/time/late remain unchanged. 35b's visit badge is the
header late flag OR any line late flag. Repeated PARTIAL corrections keep appending to this same session.

Both routes use `requestFingerprint` from `apps/api/src/shared/idempotency.ts` with method, route pattern,
query and canonical parsed body, and `params: {businessId, branchId, companyId, actorUserId, sessionId?}`.
Company/actor values come from `actorOf`, overriding any client values; omit absent sessionId. The helper hashes
canonical JSON with SHA-256, sorts object keys, retains array order and drops undefined values. Omitted
occurred_at stays omitted, rather than using a generated time in the hash. Use COMPANY-scoped operations
`record-service-session` / `append-service-session-lines`; a changed body/actor/route/selection with a committed
operation/key returns 422. The stock `@Idempotency` fingerprint alone does not include actor: validate its key
and recompute this actor-bound fingerprint in the thin HTTP adapter; add no hashing to a use case.

**Amend SPEC §3 / ADR-0010 for initial recording:** emit `ServiceSessionRecorded` once, containing an array of
the accepted full line snapshots formerly described as `ServiceLineChanged`, each `revision = 1`. No parallel
`ServiceLineChanged` or `ServiceCompleted` is emitted for those initial lines. Later repricing (35d), cancelling
(37) and performer changes (37b) retain `ServiceLineChanged` with the full line state and increasing revision.
This changes transport granularity, not the authoritative line identity or revision semantics.

The session event carries envelope schema version 1, session/business/branch/customer IDs, `occurred_at`,
`recorded_at`, stored `business_date`, business timezone snapshot, `late`, recorder user/membership, and
`lines[{line_id, session_id, service_id, branch_id, business_id, customer_id, status: ACTIVE, occurred_at,
recorded_at, business_date, late, recorded_by, recorded_by_membership_id, list_price, price, discount, net,
performers[{employee_id, share_bps}], rule_snapshot, counts_snapshot,
package: null, revision: 1}]`. All event monetary fields (`net`, list/entered prices, discount and
`rule_snapshot.FIXED`) are canonical KWD three-decimal strings, e.g. `"6.412"`, `"2.500"`, `"0.000"`, matching
ADR-0035 and shipped `SalaryChanged.amount`; consumers use `parseMoney`. Bigint mills stay internal only.
API money uses the same encoding. No customer phone, rejected drafts or notification recipients enter this event.
`ServiceSessionLinesAdded` uses the same schema-version-1 envelope with the original visit identity/date/timezone,
current append actor/membership/recorded_at/late and **only newly appended** full revision-1 line snapshots.
Line occurred_at is the visit's original time; line recorded_at is its own creation/append time. Existing lines
are never emitted again. Choose the distinct event because rows 50/59 must process new line inputs without
mistaking an append for creation or resetting the visit: 50 projects only added line × performer inputs, and
59 refreshes the same customer/business/day group and its performers, with no extra visit/rating request.
Declare all three event types with Arabic doc comments and contracts schemas; add both batch event rows
orders ⇒ commissions/customers (50/59), retaining the changed-line row for later writers.

Register `ServiceSessionRecorded` and `ServiceSessionLinesAdded` in worker `KNOWN_EVENT_TYPES` in 35a, even with zero consumers, following
the existing `SalaryChanged` precedent. Row 50 expands one envelope into line × performer inputs in one consumer
transaction, dedupes the parent `event_id`, and applies only newer per-line revisions under SPEC §6's statement
locks. A newer `ServiceLineChanged` arriving first must win over a delayed revision-1 recording snapshot.
Row 59 schedules per customer/business/day, not once per array element; row 59b still reads authoritative active
lines through `DaySessionsPort` at claim time. Neither consumer can count a recorded line twice.

### 5. Late bell uses the existing notification path in 35b

SS-Q11 includes the late badge/filter **and** an IN_APP bell notice per late saved session to the branch's
managers. 35a stores/emits `late`; 35b owns delivery alongside the day-list read. A worker orders consumer of
`ServiceSessionRecorded` reads active manager recipients through an orders-owned identity read port, following
ADR-0037's scope-covered `owner | general_manager | business_manager | branch_manager` recipients. It writes
`LateServiceSessionNoticeRequested` with event-supplied IN_APP recipients and the ar/en safe template parameters
in deduplicated groups of at most 100. Its consumed mark and all group events commit together under `withTenant`.
This keeps 35a's financial transaction to one event even when a branch has more than 100 managers.
The worker also consumes late `ServiceSessionLinesAdded` and dedupes notices by tenant/session across both
event types: a first late append can notify, but later appends never send another notice for that visit.

Declare orders ⇒ notifications for that notice event in 35b, plus its identity/tenancy symbol reads (the import
edges above already allow them). Notifications registers it in `NOTIFICATION_SOURCE_EVENTS`, uses
`notificationRequestConsumer` → `StoreInAppNotification`, and the existing admin inbox/bell; no provider send,
new bell infrastructure, direct notifications call or orders import of `packages/notifications`. The safe
template contains session/date/branch display information, no phone. 35b delivers once per persisted session,
never for each line or for an all-rejected request. The interim IN_APP rule follows ADR-0037 until row 62 owns
alert settings; row 62 must include this kind in individual/master disable controls.

### 6. Consumers that arrive later must recover earlier records

Marking a known event published with no consumer does not project it later automatically. Before relying on
row 50, run a controlled replay of retained recording/append/changed-line events to its consumer, or seed current
session/line/performer state through an orders-owned paged reader bound at the root. Do not let commissions
query orders tables directly. Live consumption and bootstrap share per-line revision guards; prove coverage
and convergence before opening the ADR-0012 approval gate. That gate's commission-relevant outbox count must
include `ServiceSessionRecorded`, `ServiceSessionLinesAdded` and `ServiceLineChanged`; transport publication alone does not prove
consumption. Never overwrite a newer projection with revision 1.

Row 59 similarly bootstraps customer/business/day groups with active lines; historical groups past their send
deadline are expired/cancelled, never sent retroactively. Opt-out and claim-time authoritative reads still apply.
35b must recover late sessions recorded between 35a and its rollout using replay to its new consumer; its
dedupe prevents duplicate bell notices. Keep a runbook count/checkpoint and tests for each recovery. Neither
dispatching with no consumer nor a successful 35a merge proves those later features complete.

## Consequences

35a creates no commission/rating/notification projection and has no statement-status read. It introduces narrow
provider read exports and five declared adapter import edges; these are deliberate additional files in catalog,
customers, staff and identity, not permission to refactor those modules. Changes to the map/events in the code PR
must cite this ADR, including the initial-event amendment to ADR-0010/SPEC §3. The design-only delivery changes
this ADR, spec 050 and its 35a plan; executable maps and phase-wide docs are synchronized in the implementation PR.

35b delivers late visibility and bells, 35c the admin reception screen, 35d audited price/discount editing (SS-Q10
option 2). Price edits do not land in 35a and need their own revision/concurrency and permission design. All owner
questions SS-Q1–SS-Q11 are answered; Abu Salem has not replied and any later differing answer supersedes Waleed's
under CLAUDE.md §1 5b, without blocking work on the recorded answers.
