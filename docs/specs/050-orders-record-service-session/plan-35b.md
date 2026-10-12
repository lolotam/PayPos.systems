# Plan 050 — 35b branch day list and late bell

Date: 2026-10-12. 35b-1 implementation; no commit or push.
Worktree: `E:\Dev\Worktrees\PosPay\p1-35b1`; branch `feat/35b-1-day-list`.
Baseline includes 35a / PR 178 and 35b-2 / PR 182 (in review), through migration 0132.
Sources: [spec.md](spec.md), [35a plan](plan.md), [owner answers](owner-questions.ar.md),
[ADR-0041](../../adr/0041-orders-service-sessions-reads-and-events.md),
[ADR-0037](../../adr/0037-not-clocked-in-alert-discovery-and-recipients.md),
[module map](../../module-map.md) / generated YAML, Phase 1 SPEC §§3/5.2/6 and visibility V1/V2.

**Status: SS-Q12 answered by Waleed, 2026-10-12, option 1 (batch 15).** Add
`read:service-sessions:branch`, default to owner, general_manager, business_manager and branch_manager within
their scopes; explicit grants to any other human role are allowed. Reception without this permission retains
the recording screen. Ordinary staff see only their own services with manager-allowed columns and never the
customer phone. The verbatim answer is mirrored in [owner-questions.ar.md](owner-questions.ar.md).

## 1. Split and order — one use case per PR

| Slice | Single capability | Order / gate |
|---|---|---|
| 35b-1 | Read one branch's service-session business day, with nested lines/performers and late badge/filter | First after SS-Q12; query path, no write use case |
| 35b-2 | Request the once-per-session late IN_APP manager notice in reaction to committed session events | Second; one worker orders use case, reusing notification storage |

Both depend on 35a. This is two independently testable capabilities, so they must not share an implementation
PR. The notice does not technically depend on the list query; the ordering supplies the day-list contract before
35c composes reception and before managers review notices. SS-Q12 authorizes 35b-1; SS-Q11 and
the already documented manager recipient rule remain unchanged.
35b is complete only when both slices pass their own gates. 35c owns the reception screen; 35d owns money edits.

## 2. 35b-1 contract and authorization

`GET /v1/businesses/:businessId/branches/:branchId/service-sessions` → **200** `{items,next_cursor}`.
Extend the existing orders contracts/OpenAPI exports; add a separate strict day-list DTO, rather than using the
write-response DTO or calling its serializer. Query fields:

| Field | Contract |
|---|---|
| `date` | Required real calendar date `YYYY-MM-DD`; compares to stored `business_date` |
| `late` | Optional literal query value `true`; omitted means all sessions, supplied means late visits only |
| `cursor` | Optional bounded opaque base64url cursor, using existing pagination conventions |
| `limit` | Existing `pageQuery` bounds/default: integer 1…100, default 20 |

No implicit today, date range, offset pagination or client-supplied actor/company/employee filter. Stored
`business_date` is the business-timezone date of occurrence, not UTC date, branch attendance working date or
recording date. An October 14 visit entered on October 15 appears on `date=2026-10-14`. Readable history is not
restricted by the write API's first-of-previous-month entry window. Do not recalculate dates from today's timezone.

**Approved permission: new `read:service-sessions:branch` (SS-Q12 option 1).** The baseline permission catalog contained
`record:service-sessions:branch`, but no service-session read permission; migration 0133 adds it. The `read:orders:branch` string in an
identity unit fixture is not a seeded permission. `read:services:business` reads catalog definitions, and
`view:notifications:business` reads delivery logs; neither authorizes customer service visits.

**SS-Q12 — Waleed, 2026-10-12, option 1:** defaults for `owner`, `general_manager`, `business_manager`,
`branch_manager` only, each within scope; no default for cashier/staff/accountant/other human roles/device.
Explicit delegation to any other human role through existing role/personal ALLOW mechanisms is allowed,
with normal scope, DENY, expiry and active-owner rules. Reception without the grant retains recording only;
ordinary staff see their own services with manager-allowed columns and never customer phone.
Add permission/default/policy and ar/en labels by additive migration and update role-policy tests;
preserve tenant custom roles. Do not alter 0131 or silently grant read to existing record-permission holders.

The guard contract is `SelectedCompanyGuard`, authenticated admin user (`SessionAdminGuard`),
`@Require('read:service-sessions:branch', {branch:'branchId'})`, `@RequiresFeature('orders')`.
Use identity's current scope/grant machinery. Separately prove business/branch ownership on the tenant transaction:
the branch-target guard alone does not validate the simultaneously supplied businessId. Unknown, foreign or
mismatched branch/business and insufficient authority return uniform 403; malformed business path/query/cursor → 400;
the existing global guard refuses malformed branch targets with uniform 403 before controller validation.
authorized but unavailable DB wiring → NOT_READY. Repeat fresh authorization on every page; cursor contents
never authorize anything. No `Idempotency-Key` on this GET.

**What staff see:** SPEC visibility V1 already limits a normal staff view to the employee's own performed rows,
with the manager-enabled columns; D-43 forbids customer phone in those columns. V2 gives reception that same
employee view plus entry, not an automatic whole-branch browsing grant. This endpoint is the privileged branch
list; it supplies no own-staff route or implicit subset when authority is missing. Normal personal/device-scoped
staff sessions cannot call an admin endpoint. Row 57 implements the own-row/column-controlled view and its
server-resolved employee identity. Do not introduce staff peer visibility, a phone column or a row-57 permission
here. An explicitly delegated admin duty, as approved by SS-Q12, is separate from a normal staff session.

### Result shape and pagination

Each item projects only persisted orders-owned data:

- Session: `id`, `business_id`, `branch_id`, `customer:{id,name}`, `occurred_at`, `recorded_at`,
  `business_date`, `business_timezone`, `recorded_by`, `late` (visit badge), `lines`.
- Line: `id`, `service_id`, `ordinal`, `name_ar`, `name_en`, `status`, `revision`, `list_price`, `price`,
  `discount`, `net`, `effective_discount_bps`, `recorded_by`, `recorded_at`, `late`, `has_performer_warning`,
  `performers`. These are saved values; no catalog repricing or live attendance warning calculation.
- Performer: `employee_id`, saved `name_ar`/`name_en`, `share_bps`, `not_clocked_in_warning`,
  `approved_leave_warning`, in saved `performer_ordinal` order.

Money is canonical three-decimal KWD strings, including zero and numeric(14,3) maximum; never JS numbers.
Customer phone (even its masked snapshot), employee user links, recorder-membership limits and commission inputs
are not selected. No session total, allocated performer money, commission estimate, tips, ratings or payments:
35b reads existing amounts and bps; SPEC §5.2's money allocation and §6's estimates remain in commissions domain.
Return saved lines/statuses without inventing a cancellation filter; current 35a rows are ACTIVE/revision 1.

Sort visits `(occurred_at DESC,id DESC)`; cursor predicate is the strict tuple `<` and uses `limit+1` visits.
Lines sort by ordinal and performers by performer ordinal. A complete visit is never split across pages.
Cursor encodes version, company/business/branch/date/late-filter and the last returned occurrence timestamp/id;
reject malformed or mismatched scope/filter cursors. Preserve database timestamp precision rather than
round-tripping the key through a millisecond-truncating JavaScript Date. The cursor remains a locator, not a
capability; changing its values cannot bypass the constant tenant/branch/date predicates or fresh guards.
Concurrent inserts/appends can change a later polling result; no cross-request snapshot guarantee is promised.

`late` is **header.late OR EXISTS(any saved service_lines.late for this session)**, as spec §8 / ADR-0041 §4
require. The same expression drives the badge and filter. A same-day visit can become late after next-day append
without updating the immutable header. Never compare occurred_at to the read clock, and do not drop late evidence
because a later slice cancels a line. The persisted lateness fact remains historical recording evidence.

## 3. 35b-1 query and indexes

Add `apps/api/src/modules/orders/queries/branch-day-service-sessions.query.ts` with the SQL statement exported
for shape/EXPLAIN tests. Bind read-side access dependencies at `orders.module.ts`; do not route GET through
`RecordServiceSessionUseCase`, `AppendServiceSessionLinesUseCase` or `loadSession`. The latter currently loads a
write aggregate with three statements and domain mapping and is unsuitable for a paged list.

Use one parameterized data statement inside `withTenant`, after the fixed-size authorization/place reads.
Page session headers first in a CTE, then assemble nested lines and performers by tenant-qualified joins/lateral
aggregations over that bounded page. Apply late filtering before the page limit. Project the DTO directly;
no SELECT *, per-session/per-line provider calls, child-row LIMIT or join fan-out duplicating visits/lines.
Queries import DB/contracts only, never domain/use-cases; inject read-access/place callbacks so query code does
not import provider modules. Only orders-owned `service_sessions`, `service_lines`, `line_performers` participate
in the list SQL. Customer/service/performer names are already saved; do not join customers/catalog/staff tables.

0131 already creates these indexes; reuse them:

| Index / unique key | Purpose |
|---|---|
| `service_sessions_day_idx` `(company_id,branch_id,business_date,occurred_at,id)` | Branch/day equality and reverse cursor scan |
| `service_sessions_late_day_idx`, same columns, `WHERE late` | Header-late arm of the late list |
| `service_lines_late_session_idx` `(company_id,session_id) WHERE late` | Append-late EXISTS probe |
| `service_lines_session_ordinal_key` `(company_id,session_id,ordinal)` | Ordered saved lines for each paged visit |
| `line_performers_ordinal_key` `(company_id,line_id,performer_ordinal)` | Ordered performers without fan-out |
| `service_sessions_branch_fk_idx`, `service_lines_session_fk_idx`, `line_performers_line_fk_idx` | Existing tenant/business FK probes |

For `late=true`, test a header-late arm UNION ALL an append-late arm whose header is NOT late, with identical
tenant/branch/date/cursor predicates and final ordering/limit. Disjoint arms avoid duplicate visits. The first
can use the partial day index; the second can use the ordinary day index plus indexed late-line EXISTS. Do not
assume an OR predicate alone will choose both partial indexes. Choose the final SQL from measured EXPLAIN evidence.
No new day-list index is justified yet. If realistic fixtures demonstrate a missing predicate/order index,
document its exact tenant-leading columns and add it in 35b-1 using ADR-0033's concurrent-index protocol; assign
the migration number at merge. Never add a mutable header-late column or copy a late projection just to index it.

Required tests use real compose Postgres, cloned DB per spec file, restricted `pospay_app`:

- Result-shape contract parse: empty/single/shared-service/multi-line visits, duplicate service IDs, saved names
  after provider edits, canonical money, nested ordering, warning flags, no phone/peer/private fields.
- Cursor ties on identical occurred_at, precision, first/middle/final pages, more than one performer/line,
  limits 1/20/100, invalid dates/cursors, filter or scope mismatch; no missing/duplicate visit on a stable dataset.
- Late header, first late append to an on-time header, further late appends, on-time entries and business-local
  midnight/timezone differences. Badge and late-only membership agree; reading tomorrow changes no stored flag.
- Guards after SS-Q12: approved defaults/delegation, DENY, expiry, orders feature, branch/business mismatch,
  selected-company switching, other branch, user vs staff/device/API principal, authority revoked between pages.
- RLS: company A sees none of B's sessions/lines/performers; mixed-business child joins cannot leak rows;
  direct query outside withTenant returns none; pooled tenant context does not survive failure/rollback.
- `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` on the exact emitted statements, normal and late paths, first and
  cursor pages. Seed many tenants/branches/dates, sparse late visits and append-only late visits; ANALYZE fixtures.
  Assert named session day/partial index access and tenant-indexed child/late probes, including lookahead bounds;
  reject a broad session or child-table sequential scan. Do not merely search the plan for any Index Scan.
  Use normal planner settings for the performance proof; forced-index probes can supplement it, not replace it.
  Count a fixed number of authorization reads and exactly one list statement regardless of page size.

### 35b-1 implementation shape choices

- Reuse `SessionDayAccess` callbacks beside the query, like the staff read-side access interfaces; bind existing
  session-place and new identity read-access callbacks only in orders.module.ts. There is no write port/use case.
- Preserve the shared AccessGuard's validation precedence: a malformed branch target returns uniform 403 before
  controller pipes; malformed business paths, query values and decoded cursors return 400 after authorization.
  This follows existing scoped controllers without changing their behavior.
- Cursor timestamp uses six UTC fractional digits. Bind it as text then cast in PostgreSQL, avoiding the driver's
  JavaScript Date serialization. The cursor is bounded to the existing 512-character pagination limit.
- Calendar validation rejects year 0000 because PostgreSQL cannot represent it; positive four-digit years retain
  the unrestricted historical read contract.
- Feature-disabled replies retain the existing bilingual FEATURE_DISABLED envelope; database failures use NOT_READY
  without driver parameters or causes. Query data reads remain one statement after seven fixed authorization/place reads.
- Permission/default-only migration is 0133; no new tables, runtime table grants or day-list indexes are added.

### 35b-1 changed files

| Area | Files (paths relative to repository root) |
|---|---|
| Orders API | `apps/api/src/modules/orders/queries/branch-day-service-sessions.query.ts`, `persistence/session-read-access.adapter.ts`, `http/service-sessions.controller.ts`, `orders.module.ts`; `__tests__/service-session-day.spec.ts`, `service-session-day-access.spec.ts`, `service-session-day-explain.spec.ts` under the same module |
| Identity boundary | `apps/api/src/modules/identity/persistence/service-session-read-access.ts`, `apps/api/src/modules/identity/index.ts` |
| Contracts | `packages/contracts/src/orders/service-session-day.ts`, `service-session-day.spec.ts`, `service-session-openapi.ts`; `packages/contracts/src/index.ts`, `src/openapi.ts`, `src/__tests__/openapi.spec.ts`, `openapi/openapi.json` |
| DB | `packages/db/migrations/0133_2026-10-12_service-session-day-read.sql`, `meta/0133_snapshot.json`, `meta/_journal.json`; `packages/db/src/access-catalog.ts`, `role-defaults.ts`, `system-role-policy.ts`, `__tests__/role-defaults.spec.ts`, `__tests__/system-role-policy.spec.ts` |
| Permission labels | `packages/i18n/src/permission-name.ts`, `packages/i18n/src/permission-codes-catalog.ts` |
| Generated clients | `apps/admin/src/shared/api/schema.d.ts`, `apps/pos/src/shared/api/schema.d.ts` |
| Decisions/maps | This plan, `docs/specs/050-orders-record-service-session/spec.md`, `docs/adr/0041-orders-service-sessions-reads-and-events.md`, `docs/module-map.md`, `docs/module-map.yaml` |

### 35b-1 verification

Real-Postgres orders suite: 18 files / 267 tests passed. All 16 new day-list tests pass, including normal-planner
EXPLAIN on 8,000 complete visits, microsecond cursor ties, current authorization on later pages, persisted
late-appends, canonical zero/maximum money, RLS/context cleanup and real staff-purpose cookie refusal.
After rejecting PostgreSQL's unrepresentable year 0000, the three day-list files were rerun: 16/16 passed.
DB suite: 62 files / 1,563 tests plus public-export smoke passed. Contracts: 37 files / 502 tests plus smoke passed.
Required gates: **8 passed / 0 failed**. Typecheck: 23 successful tasks; lint: 24 successful tasks;
lint:docs: zero errors / 28 existing warnings; module-map:check and both admin/pos api:check commands passed.
The unchanged 35a 20-line/80-performer timing check varied under concurrent work; the final full orders run passed
at median 182.4ms (range 170.0–260.9ms), and its isolated rerun passed at 184.2ms. No threshold was relaxed.
No new TODO(spec), commit, push or PR. The 35b-2 worker/template/recovery behavior is unchanged.

Local tool execution used Node 24.21.0 and the installed pnpm 12.9.1 JavaScript entry point: native pnpm cannot
open its engine-store lock in this sandbox. A temporary os.userInfo fallback handled the sandbox's ENOMEM;
it is not a production change or dependency. Temporary tooling is removed after verification.

## 4. 35b-2 — existing bell production path

Current production path, verified in this baseline:

1. `apps/worker/src/main.ts` registers database consumers through `createDeliverer`; production uses
   `createInAppNotificationModule`, independently of live WhatsApp/OTP/email configuration.
2. `outbox/deliver.ts` calls `markEventConsumed` and each `OutboxConsumer.handle(tx,event)` in the same
   `withTenant(event.companyId)` application-role transaction. Known-with-zero-consumer session events are
   acknowledged today; adding a consumer does not automatically recover previously published events.
3. Worker notifications `events/handlers/on-notification-request.handler.ts` registers `NOTIFICATION_SOURCE_EVENTS`
   and parses `notificationRequest`. IN_APP recipients call `StoreInAppNotification`, not a provider channel.
4. `persistence/drizzle-in-app.repository.ts` inserts `in_app_notifications` and `NotificationDelivered`
   (`IN_APP_STORED`) atomically. Its unique key is `(company_id,source_event_id,recipient_user_id,template_key)`.
5. API `GET /v1/me/notifications` and `/unread-count`, plus existing mark-read/read-all POSTs, already power the
   admin bell. They authenticate the selected company and recipient user; no delivery-log permission is required.

Implement one worker orders capability `request-late-service-session-notice`, triggered by **both**
`ServiceSessionRecorded` and `ServiceSessionLinesAdded`. Parse their existing schema-version-1 contracts, including
the trusted envelope company/aggregate correspondence. On-time inputs produce no notice. A successful PARTIAL
write still represents one persisted visit; rejected drafts/all-rejected writes produce no independent notice.
Use the event's saved late metadata, not a fresh calculation of lateness or a notification per line.

Orders defines its own recipient/place read ports and notice repository/outbox ports; adapters live under worker
orders `persistence/`, bindings in `orders.module.ts`. Inject Clock/IdGenerator and translated generic branch
labels. Pure domain functions own the fixed IN_APP rule, eligibility from saved late facts, safe parameter
construction and stable recipient grouping. No SQL, provider SDK, time/random globals or other-module imports
in the use case. The event handler delegates; it does not resolve recipients or build business rules itself.
Export only the worker module/consumer factory via orders index; wire the consumer once in the application root.

### Manager resolution and durable session idempotency

Follow ADR-0041 §5 / ADR-0037's interim rule, until row 62 supplies alert settings:

- `companyOpen` from worker tenancy checks the company on the caller transaction; closed companies are skipped.
- Orders' own recipient adapter calls worker identity's public `branchManagerRecipients(tx,companyId,businessId,
  branchId,at,roles)`, with `owner | general_manager | business_manager | branch_manager`.
- Eligibility is active membership at processing time (`starts_at ≤ at < ends_at`), system role, and COMPANY,
  matching BUSINESS or matching BRANCH scope. Deduplicate users across memberships and sort IDs. Custom roles
  merely named manager are not canonical manager roles. Do not exclude the recorder or a performer who is also
  an eligible manager; ADR-0037's absent-employee exclusion belongs to its attendance alert, not this session.
- Read branch names via worker tenancy's public `branchPlace`, never an orders join to tenancy/identity tables.
  Use names only; the notice date/timezone remains the session's stored business date/timezone.
- Snapshot recipients when the first qualifying late event is processed. As in the existing interim alert,
  adding a manager afterward does not replay an old notice. If no manager qualifies, record that decision without
  emitting an invalid empty `notification_recipients` event; keep the zero-recipient outcome observable.

Add an orders-owned insert-only ledger `late_service_session_notices`: `(company_id,id)` UUID-v7 PK,
`business_id`, `session_id`, `source_event_id`, `decided_at`, `recipient_count`; tenant/business/session FK,
UNIQUE `(company_id,session_id)` and `late_service_session_notices_session_fk_idx`
`(company_id,business_id,session_id)` for the composite session FK. `recipient_count` is a nonnegative integer.
`source_event_id` is durable provenance without an outbox FK that would couple dedupe lifetime to event retention.
ENABLE+FORCE RLS, explicit USING/WITH CHECK; SELECT/INSERT only for pospay_app. No runtime UPDATE/DELETE,
privileged tenant reader or short-lived dedupe retention. This is a new migration in 35b-2, not an edit to 0131.

Claim that ledger key with INSERT ON CONFLICT DO NOTHING RETURNING under the existing consumer transaction.
Only the winner emits all `LateServiceSessionNoticeRequested` recipient-group outbox rows. Ledger, complete
group set and input `consumed_events` mark commit or roll back together. A competing creation/append consumer
waits on uniqueness then sees the committed claim; it cannot emit its own group events. The first late append
can win for an initially on-time visit, but later late appends cannot create another notice. A rollback releases
the claim; redelivery resamples recipients and retries safely. Do not hold a transaction across queue/provider I/O.

The existing notification-table unique key only prevents repeat delivery of the **same request event**. It
cannot dedupe separate creation/append event IDs by session; hence the durable orders ledger is necessary.
Once group request events commit, retries/replay keep their original IDs and recipients; downstream event/table
dedupe creates at most one inbox row per session/recipient, and one delivered-result row per created inbox row.
More than 100 managers is supported by deduplicated stable groups of at most 100; failure in any group rolls back
the ledger and every group. One session notice means one logical notice per eligible manager, not one company-wide
inbox row or one per service line. The existing NotificationDelivered is a storage result, not evidence of a read.

### Notice contract and ar/en text

Add `LateServiceSessionNoticeRequested` strict schema in orders contracts; the outbox envelope carries company
and session aggregate identity. Payload: `schema_version:1`, `session_id`, `business_id`, `branch_id`,
`business_date`, `business_timezone`, `notification_recipients` (1…100 entries per group).
Each entry uses existing `inAppRecipient`: `channel:'IN_APP'`, `user_id`, `locale:'ar'`,
`template_key:'late_service_session'`, `template_revision:1`, safe parameters below. Stored ar is the
Arabic-first fallback, not a guessed user locale; the bell renders its viewer's current ar/en UI locale.
No need to change either recording/append financial event or synchronously call notifications from orders.

Register the new template in `packages/notifications/src/templates/`, its export and `validInAppTemplate`.
Add the `inApp.late_service_session` keys in `packages/i18n/src/in-app-catalog.ts` and a small case in the existing
admin `notifications/model/render-notification.ts` with renderer tests; without that case the current renderer
falls back to generic_notice and the new copy would not display. This is existing bell integration, not a new
screen, poller or UI layout.

Safe parameters: `branch_name_ar`, `branch_name_en`, `business_date` (canonical saved date). Context IDs remain
typed event fields; no customer/employee/recorder name, phone, money, document, token or URL in the message.
Display-name safety follows the existing notification template rules, including Arabic digits/separated phone
digits; rejected/missing Arabic falls back to safe English, otherwise translated generic branch labels. The
fixed date is validated as a date, not treated as a display name. Proposed copy, with no additional business rule:

- ar: `سُجّلت جلسة متأخرة بتاريخ {{business_date}} في فرع {{branch_name_ar}}.`
- en: `A late service session dated {{business_date}} was recorded at {{branch_name_en}}.`

Register `LateServiceSessionNoticeRequested` in `NOTIFICATION_SOURCE_EVENTS` so the existing
`notificationRequestConsumer → StoreInAppNotification` path handles it in both production IN_APP-only and
development notification modules. Register the orders input consumer in `createDeliverer` and known-event wiring.
No new BullMQ send processor, notification provider call, WhatsApp/email enablement or realtime consumer;
Phase 1 continues polling. Row 62 must later expose this kind in individual/master alert-disable controls.

## 5. Required arrows and ADR amendments

**Amend ADR-0041 before implementation.** It already decides the two-event late reaction, intermediate notice
event, orders-owned identity read port, manager set and existing notification path (§5), and rollout recovery (§6).
It needs the concrete read permission (after SS-Q12), 35b-1/35b-2 split, once-per-session ledger/atomicity, named
worker adapters/reads and safe template contract recorded as an addendum. Cite ADR-0037/0018 as precedents;
no separate invented ADR number is reserved. Each added runtime/event arrow is explicitly covered by that addendum.

| Arrow / map change | Needed in | ADR / executable map action |
|---|---|---|
| orders → tenancy route ownership/place read | 35b-1 | Existing import and bounded read; reuse `SessionPlacePort`/describeWorkspaces binding, record any new adapter-path read entry |
| orders → identity read authority | 35b-1 | Existing import; add a narrow `readServiceSessionReadAccess` public reader + consumer read-access port, after SS-Q12; add exact symbol/path under `reads:` |
| worker orders → worker identity manager recipients | 35b-2 | Import orders → identity already allowed; add orders-owned port row and `branchManagerRecipients` read at orders' recipient adapter path |
| worker orders → worker tenancy company/name reads | 35b-2 | Import orders → tenancy already allowed; add companyOpen/branchPlace port rows and exact symbol/path `reads:` entries |
| orders ⇒ notifications `LateServiceSessionNoticeRequested` | 35b-2 | New §4 event arrow, explicitly authorized by amended ADR-0041; notifications remains root-level with imports: [] |
| orders ⇒ orders reaction to Recorded / LinesAdded | 35b-2 | Document worker orders reaction on both event rows; no provider compile-time edge, no removal of later commissions/customers consumers |

Do not add orders → notifications imports, notifications → identity reads, imports of another module's internal
adapter, or orders imports of `packages/notifications`. The notifications module alone validates/stores the
template. `readServiceSessionAccess` is currently hardcoded to record permission and is not a read authorization
reader; preserve its write behavior rather than repurpose it. Callback binding keeps query code off provider
internals. Identity resolves identity facts; tenancy resolves place facts; list SQL remains orders-only.

Edit map.md §2/3/4/6 as applicable in each implementation PR and regenerate `module-map.yaml` with
`pnpm module-map:generate`; YAML has `reads:` and no `ports:` key. Add exact value-import symbols with their
adapter paths, including statement exports only if actually imported for EXPLAIN tests. Sync Phase 1 SPEC §3's
new notice arrow/interim exception in 35b-2. This docs-only plan does not claim unmodified maps permit new reads.

Planned exact `reads:` additions (provider functions are reached through their public index only):

- `orders -> identity.readServiceSessionReadAccess` at
  `apps/api/src/modules/orders/persistence/session-read-access.adapter.ts`.
- `orders -> identity.branchManagerRecipients` at
  `apps/worker/src/modules/orders/persistence/branch-manager-recipients.adapter.ts`.
- `orders -> tenancy.companyOpen` at that same worker recipient adapter path.
- `orders -> tenancy.branchPlace` at
  `apps/worker/src/modules/orders/persistence/branch-place.adapter.ts`.

Reuse the existing API session-place adapter/path and its tenancy reads; if implementation moves those reads
to a second adapter, declare that path too rather than assuming a symbol's existing row permits any caller.

## 6. 35b-2 tests, rollout and completion gates

Use the same real-Postgres/tenant-role fixtures as 35a and the current worker notification harness:

- One persisted late session with multiple lines/shared performers → one logical request per recipient;
  on-time inputs, rejected drafts/all-rejected writes and rolled-back writes → none.
- Header on time + first late append → first notice; additional late appends, creation replay and reordered
  event types → none extra. Concurrent distinct late event IDs for the same tenant/session yield one ledger/group
  set, not just dedupe of a single event ID. Concurrent different sessions both notify.
- Crash after ledger insert, after first recipient group and before input consumed mark: no partial effects
  survive; retry produces exactly one complete group set. Concurrent notification delivery and direct handler
  replay also prove the existing inbox unique key and no duplicate NotificationDelivered result.
- Active COMPANY/BUSINESS/BRANCH manager scopes, future/expired/removed memberships, another branch/business,
  deleted company, duplicate users/memberships, custom role, recorder-as-manager; manager added after decision
  receives no historical bell. Zero recipients is observable and creates no empty request event. 100/101/201
  distinct eligible managers produce 1/2/3 groups with no lost or duplicate user.
- New ledger RLS/FK negatives in the same PR: A SELECT of B returns none, cross-tenant insert/UPSERT rejected,
  cross-business parent reference rejected, no tenant-context leakage, restricted grants/ownership verified;
  denied UPDATE/DELETE remain denied. Existing recipient-specific inbox isolation still applies in API tests.
- Full chain: actual session outbox event → orders consumer → notice-request event → existing notifications
  consumer → manager GET /me/notifications and unread-count; mark-read works and unrelated users see none.
  Test production with empty external-channel configuration. Assert no notification_attempts, send-authorized
  event, provider call or financial/commission/rating side effect from the bell reaction.
- Strict contract/template revision and parameter validation, ar/en copy, locale switching and safe-name fallback;
  phone-like branch names (including Arabic digits), URLs and codes never reach notice parameters/message/logs.
  Events/audit/diagnostics contain no customer phone. Errors expose safe type/code without driver params/stack.
- EXPLAIN the exact new ledger/session probes and any new query files; reuse recipient reader's tested
  company/scope-index shape. Every queries/ file added still needs independent result-shape and index assertions.

**Rollout gap recovery is required.** After every worker has the new consumer/template, use the existing
controlled operator replay mechanism to feed retained 35a recording **and append** events to the stable new
consumer ID (proposed `orders.late-service-session-notice-v1`). Do not interpret published_at as already-notified.
Keep original input IDs; never delete consumed marks or regenerate group events for a committed session ledger.
Operator recovery uses the dispatcher facade for outbox access and application-role withTenant for all effects;
it must not grant orders arbitrary outbox SELECT or cross-tenant access. Document counts/checkpoints and repeatable
per-tenant verification in the runbook. Prove a pre-rollout published creation, pre-rollout published late append
to an on-time visit, concurrent live append during recovery and rerun all converge to one notice per session/user.
If required events are no longer retained, stop recovery and record the missing coverage; do not silently claim
success or broaden DB privileges. ADR-0041 explicitly requires this replay, unlike rating requests' send deadline.

Implementation order per PR: contracts → approved ADR/map → additive migration/RLS/indexes → pure domain/tests
where relevant → query or notice use case → adapters/wiring → integration/RLS/EXPLAIN → generated artifacts.
Arabic documentation accompanies domain/port/event exports. Run `pnpm check`, boundaries/cycles/module-map and
the relevant API/worker/DB/contracts/i18n/renderer suites; old images must remain compatible with additive schema.
Report tests actually run; the 35b-1 results are recorded in §3 above. The 35b-2 implementation remains its own slice.

## 7. Owner answer — SS-Q12

Arabic question and answer are mirrored in [owner-questions.ar.md](owner-questions.ar.md):

> مين يشوف قايمة جلسات الفرع كلها؟ نقترح صلاحية مستقلة «قراءة جلسات الفرع»، افتراضيًا للمالك والمدير العام
> ومدير النشاط ومدير الفرع فقط. هل الريسبشن تاخدها افتراضيًا كمان، ولا تفضل تشوف جلساتها كموظفة وشاشة التسجيل؟
> وهل ينفع تفويض قراءة الفرع لأي دور بشري بحساب لوحة التحكم؟ الموظفة في عرضها العادي تفضل تشوف خدماتها فقط
> بالأعمدة اللي المدير سمح بها ومن غير رقم الزبونة.

Answer: **Waleed, 2026-10-12, option 1** — defaults owner/general_manager/business_manager/branch_manager
within scope; grantable to any other human role. Reception without the permission retains recording; ordinary
staff see only their own services with manager-allowed columns and no customer phone. SS-Q2 recording and
SS-Q11 bells remain separate. Abu Salem has not answered yet; a later differing partner choice is binding.
