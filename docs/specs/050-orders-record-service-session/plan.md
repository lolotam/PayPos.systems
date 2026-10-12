# Plan 050 — Record service session, 35a server write

Date: 2026-10-12. Status: Implemented in PR 178 (35a).
Branch: `spec/050-sessions-record-service-session`.
Sources: [spec.md](spec.md), [owner answers](owner-questions.ar.md),
[ADR-0041](../../adr/0041-orders-service-sessions-reads-and-events.md), Phase 1 SPEC §§3/4/5.2/6/11.
All SS-Q1–SS-Q11 answers are Waleed's 2026-10-12 decisions. No unanswered owner rule blocks 35a.

## Scope and dependency boundary

Implement `record-service-session` and `append-service-session-lines` for the same visit in orders. Follow contract → migration/RLS → domain/tests → use cases
→ persistence/HTTP → integration/RLS tests. 35b owns the day-list query, late badge/filter and late bell notice;
35c the admin reception screen; 35d audited price/discount editing. No UI, tips, cancellations, performer edits,
approval consumption, package redemption, payment, offline sync, rating scheduler or commission projection in 35a.

Orders presently has `domain/` only. Add the standard ports/use-cases/persistence/http/events/composition root
and public index. Necessary outside-module touches: read-only exports in catalog/customers/staff, identity's
locked record-access reader, permission catalog/defaults/i18n, contracts/DB schema, API wiring, worker known-event
registry, and map/event documentation. No change to settings' resolver or identity's discount arithmetic.
ADR-0041 authorizes these reads and one recording/append envelope per write; it is required before implementation.

## 1. Contract first — Zod and generated OpenAPI

Create `packages/contracts/src/orders/service-session.ts` and an OpenAPI route declaration using current
contracts conventions; export request, response, per-line rejection and event schemas from contracts' index.
Use existing ID/timestamp/money scalars and strict objects; no handwritten duplicate frontend types.

`POST /v1/businesses/:businessId/branches/:branchId/service-sessions`, authenticated admin user;
`@Require('record:service-sessions:branch', { branch: 'branchId' })` and `@RequiresFeature('orders')`.
The transaction also confirms that branchId belongs to businessId; the current guard resolves branch ownership
but does not validate a simultaneously supplied business parameter. Unknown/foreign/mismatched routes are 403.

Also declare `POST /v1/businesses/:businessId/branches/:branchId/service-sessions/:sessionId/lines`, returning
201 `{outcome, session, added_lines, rejected_lines}` with the full visit and newly saved subset identified.
Its strict body is `{lines, recorder_membership_id?}`; reuse the line schema below. Customer/occurred_at are
inherited from the session, never supplied again. An explicit append access guard verifies current original
recorder OR branch record permission, plus active branch-covering membership, DENY rules and orders feature;
do not put an unconditional record-permission guard in front of the original-recorder alternative. Repeat the
same ownership/authority checks inside the transaction and on replay. Unknown/foreign/wrong-route session → 403.

| Input | Contract |
|---|---|
| Headers | `Idempotency-Key` required, current visible-ASCII 1–255 bound; tenant resolved by existing guard |
| `customer_id` | Required UUID, company-scoped existence read |
| `recorder_membership_id` | Optional UUID selection hint; must be caller-owned, active and cover branch; required on ambiguity |
| `occurred_at` | Optional ISO UTC instant; omitted defaults to injected server time, never Zod `Date.now()` |
| `lines` | 1…20 in caller order; identical service IDs on different lines allowed |
| `lines[].service_id` | Required UUID of a service in the confirmed business |
| `lines[].price` | Required canonical 3-decimal nonnegative KWD string, ≤ 99999999999.999; UI pre-fills it in 35c |
| `lines[].discount` | Required union AMOUNT `{amount: KWD string}` / PERCENT `{bps: integer 0…10000}`; explicit zero allowed |
| `lines[].performers` | 1…4 distinct employee UUIDs, `share_bps` either omitted for **all** or supplied for **all**, integer 1…10000 |

Reject unknown fields, mixed specified/omitted shares, fractions in bps, unrepresentable money and malformed
dates. Discount amount ≤ price, share sum and all business arithmetic belong to orders domain; contract validation
does not duplicate the calculations. Input has no company/actor/late/status/revision/snapshot/limit/payment fields.
The “same % on all lines” shortcut belongs to 35c and sends an ordinary PERCENT input on each affected line.

Success is **201** `{outcome: 'COMPLETE' | 'PARTIAL', session, rejected_lines}`. Session contains server IDs,
business/branch/customer `{id,name,phone_masked}`, recorder/membership, occurred/business-date/recorded timestamps,
`late`, `total_net` KWD string and **accepted** lines only. Each saved line has `input_index` (zero-based original
position), contiguous `ordinal` in accepted input order, service-name snapshots, list/price/discount/net KWD strings, effective bps,
status ACTIVE, revision 1, line recorder/membership/recorded_at/late and performer IDs/name snapshots/shares/warnings.
Append continues ordinals after the persisted maximum; `input_index` is local to each request, not a session ordinal.
Names never require a cross-context join in a later orders list. Customer phone is already masked at its boundary.

Rejection has `input_index`, `service_id`, safe service name, bilingual `SESSION_DISCOUNT_ABOVE_LIMIT`, attempted
list/price/discount/net, effective bps, `limit_bps`, `limit_source`, and `max_discount_amount` at the attempted price.
Compute that maximum in domain: minimum authorized net is `ceil(listMills * (10000-limitBps) / 10000)`; the maximum
additional amount is `max(0, priceMills-minimumNet)`, bounded by price. Also return `minimum_net` so an already-too-low
price can be corrected; zero additional discount cannot cure such a price. Limit fields are display evidence,
never a subsequent authorization capability.

### SS-Q6 option 2 — exact save/retry behavior

1. Validate **every** line's non-discount invariants first, including those likely to exceed the limit. A missing
   reference, ineligible/self performer, invalid shares/time/amount or lack of authority aborts the whole request.
2. Domain partitions otherwise valid lines solely by effective discount authority. If any pass, save them together
   in one new session. Write only their performers/audits and **one** `ServiceSessionRecorded` outbox row. Store the
   entire 201 response, including rejected drafts' errors, in the same transaction using `runIdempotent`.
3. If none pass, throw `SESSION_DISCOUNT_ABOVE_LIMIT` (422, `details.rejected_lines`) and roll back: no session,
   lines, performers, audit, outbox or idempotency claim survives. Never create an empty session.
4. The client removes accepted lines from its editor and retains rejected drafts. Editing/resubmitting only those
   drafts uses a new key on the append route with the returned session ID, preserving the **same visit**. 35c
   repeats this for a PARTIAL append; it never posts saved lines again. If all creation lines were rejected, no
   session exists and the corrected request uses the creation route. Appending uses the current actor's limit,
   membership, self rule, catalog snapshots and performer facts at the session's original occurredAt. Each
   successful append is one transaction/one `ServiceSessionLinesAdded` event; all-over-limit rolls back only
   that append. The fresh append instant must put the stored business_date within the back-dating window.
   Reject `SESSION_LINE_CAPACITY_EXCEEDED` (422) if existing persisted lines + accepted additions exceeds 20;
   cancelled lines still count, rejected drafts do not. Validate capacity before any insert under the session lock.
5. A lost response is recovered by retrying the **original body/key**. It replays the original partial 201 exactly,
   even if prices/limits/attendance changed meanwhile. Changed body with that committed key returns 422. A concurrent
   duplicate waits on the existing unique claim; lock timeout alone yields retryable 409. No persisted IN_FLIGHT.

Thus partial business acceptance is determined **before** writes; the accepted set commits or rolls back as a unit.
No 207, failed HTTP status after committing valid lines, per-line transactions or second client “save valid” step.

Both endpoints validate the key with existing `@Idempotency`, then compute `requestFingerprint` in HTTP with
method/route pattern/query/parsed body and `params: {businessId, branchId, companyId, actorUserId, sessionId?}`.
`actorOf` supplies company/actor, never the client. The existing helper SHA-256-hashes recursively sorted
canonical JSON, retains array order and omits undefined properties. Absent occurred_at remains absent; the
membership selection is in the body. Pass the recomputed fingerprint to `runIdempotent`, COMPANY scope, with
operations `record-service-session` and `append-service-session-lines`. A changed actor/body/route/selection
under a committed operation/key → 422. No use-case crypto and no assumption that the stock decorator binds actor.

Errors use the existing bilingual envelope. Map validation to 400; reference/eligibility/share/discount errors to
422; future/too-old time to 422; self rule and authority to 403; key missing to 400, mismatch to 422, timeout/deadlock/
serialization to retryable 409. Ambiguous membership is 400 `SESSION_RECORDER_MEMBERSHIP_REQUIRED` with the caller's
eligible IDs; a supplied foreign/inactive/out-of-reach membership is uniform 403. Foreign customer/service/employee
IDs behave like unknown IDs. Fail closed as NOT_READY when optional DB wiring is absent, after normal guards.
Accepted total beyond Money/numeric(14,3) returns 422 `SESSION_TOTAL_TOO_LARGE` with full rollback.

## 2. Additive migration, FORCE RLS, constraints and indexes

Create `packages/db/schema/orders.ts`, export it from the schema index and generate additive migrations through
the existing tooling. Assign migration numbers at implementation/merge; do not reserve a guessed number here.
Use SQL for FORCE, exact grants and deferred consistency triggers; no privileged tenant definer. Every table below
has UUID-v7 **PK `(company_id,id)`**, company/business scope and tenant-qualified FKs. Use the name
`line_performers` (Phase 1 `LinePerformer`), replacing the draft's `service_line_performers` natural-key proposal.

| Table | Required data / consistency |
|---|---|
| `service_sessions` | company/id/business/branch/customer, recorded_by user, recorded_by_membership_id, occurred_at, recorded_at, business_date, business_timezone snapshot, late, created_at; UNIQUE(company,business,id); composite FK to branches, company/customer FK, company/membership FK, global recorded_by FK |
| `service_lines` | company/id/business/session/service, ordinal, ACTIVE/CANCELLED status, revision, list_price/price/discount/net, effective_discount_bps, limit_bps_applied nullable + limit_source, service-name snapshots, rule_kind/rule_pct_bps/rule_fixed_amount, counts_toward_threshold, has_performer_warning, recorded_at/late, recorded_by user/recorded_by_membership_id, created_at; UNIQUE(company,business,id), UNIQUE(company,session,ordinal); company/business/session and company/business/service FKs, company/membership and global user recorder FKs |
| `line_performers` | company/id/business/line/employee, performer_ordinal, share_bps, name snapshots, not_clocked_in_warning, approved_leave_warning; UNIQUE(company,line,employee), UNIQUE(company,line,performer_ordinal); company/business/line FK and company/business/employee FK |

Money columns, including FIXED rule amount, are `numeric(14,3)`; map through KWD strings to bigint mills, never
`number`. Timestamps are `timestamptz` UTC; dates are SQL `date`. No redemption_id yet (row 43 expands it).
CHECKs: list/price/net ≥ 0; discount in [0,price]; net=price-discount; effective bps 0…10000; revision>0;
ordinal 1…20; performer ordinal 1…4; share 1…10000; allowed status/rule/limit-source enums; limit source OWNER iff
null unlimited, NOT_CONFIGURED iff applied zero, PERSON/BUSINESS with applied integer 0…10000; rules have exactly
their matching PCT or FIXED value, matching catalog CHECKs. Initial write uses ACTIVE and revision 1 only.

Deferred, SECURITY INVOKER consistency triggers on new lines/performers assert at commit that each saved line
has 1…4 performers and Σ shares=10000, and its aggregate warning agrees with performer flags. Trigger events cover
insert and future update/delete so later grants cannot bypass them. Tenant key is always part of each probe.
Lock the parent line for share-set changes when such writes arrive in 37b; no such UPDATE grant in 35a.
These checks complement the pure domain tests and allow parent-before-child inserts in one transaction.

For **each** table: ENABLE and FORCE ROW LEVEL SECURITY; explicit USING and WITH CHECK on company_id using
the repo's tenant-GUC accessor; SELECT/INSERT only for `pospay_app`, no UPDATE/DELETE/TRUNCATE or ownership,
no BYPASSRLS and no SECURITY DEFINER tenant access. Period corrections belong to commissions, not an RLS bypass.
Separate policies/grants permit migrations as established; no change to auth/dispatcher privileges.

Indexes, created in the same release with the repo's concurrent-index protocol (ADR-0033):

- Sessions: `(company_id,branch_id,business_date,occurred_at,id)` day cursor;
  `(company_id,customer_id,business_id,business_date,id)` rating-day reader;
  branch-prefixed `(company_id,branch_id,business_date,occurred_at,id) WHERE late` for 35b;
  `(company_id,recorded_by_membership_id)` and `(company_id,recorded_by)` for recorder FKs.
- Lines: unique session/ordinal index supplies `(company_id,session_id)` lookup;
  `(company_id,business_id,service_id)` for service FK; unique business/id for child FK;
  `(company_id,recorded_by_membership_id)` and `(company_id,recorded_by)` for line recorder FKs;
  `(company_id,session_id) WHERE late` for 35b's visit badge/filter including late appends. No business-wide late index.
- Performers: unique line/employee supplies `(company_id,line_id)`; `(company_id,business_id,employee_id,line_id)`
  for employee FK/staff filtering; line/ordinal uniqueness preserves input order. Do not duplicate PK/unique indexes.
- Batch provider reads use existing service/customer PKs and staff company/employee/date indexes. Add any missing
  provider predicate index with its reader, backed by EXPLAIN; no table scan per line or N+1 performer query.

Permission catalog migration adds `record:service-sessions:branch` and just the SS-Q2 five global system-role
defaults, preserving tenant custom roles. Use current permission/role migration patterns (0088/0129), not a new
seeding mechanism. Add ar/en permission/error labels and integrate existing grantability/role-editor policies;
devices remain ineligible. No table grants for recorded-money editing until 35d.

## 3. Pure orders domain and unit tests

All exports have Arabic JSDoc with @param/@returns. Depend only on `@pospay/domain`; no ports/DB/Nest/Zod runtime.

| Function / rule | Required independent expected cases |
|---|---|
| `lineNet`, `sessionTotal` | zero, maximum price, discount=price, >price/negative refused; total of accepted nets only, bounded to Money/numeric(14,3); aggregate overflow refuses the whole write |
| `discountFromPercent` | shared `roundKwd(price*bps,10000n)` half-up; 0/10000, below/at/above half mill; 7.125×10%=0.713; no clamp to limit |
| `effectiveDiscountBps` | orders copy per ADR-0041; zero list, net≥list, exact inclusive boundary, fractional overflow, lower price plus amount discount, 100%, maximum numeric money |
| `partitionDiscountLines`, rejection display values | UNLIMITED, PERSON/BUSINESS zero, NOT_CONFIGURED→zero, mixed/all/none rejected, already-underpriced line, raised-price allowance, ceiling minimum net |
| `equalShares`, `validateShares` | 1…4 distinct; three inputs → [3334,3333,3333] in input order; all explicit sums=10000; mixed omitted/explicit, zero/fraction/duplicates/>4 rejected; reception may send 7000/3000 |
| `sessionTime`, `isLateEntry` | business dates, recorded instant injected; same-day earlier=false, preceding date=true; month/year rollover, exact oldest boundary, invalid zone/date; future tolerance below/at/above threshold |
| `performerWarnings`, `validateRecorderPerformers` | none/missing attendance/approved leave/both; flags never alter net or shares; staff-returned persisted employees.user_id equal to actor user ID refused regardless of role/limit, different/null allowed; unlinked employee cannot be detected as recorder |
| append window/capacity/ordinals/total | original date/time retained; first-of-previous-month inclusive at fresh append time; expired date rejected; existing + accepted ≤20, rejected drafts excluded, cancelled slots included; contiguous ordinals; total includes previous and newly accepted nets, overflow rolls back append |

SS-Q7's **bps** remainder goes to the first input performer. It is separate from SPEC §5.2's later **money**
share allocation: floor net×share/10000, then distribute remaining mills by ascending employee_id. 35a stores
shares and whole-line net only; row 50/commission domain owns net-share allocation and commission calculation.

SS-Q9: take a fresh injected `recorded_at` after lock waits; omitted occurred time equals it. Dates/late/window
use the persisted business timezone. Oldest accepted instant is local midnight on the first day of the previous
calendar month, inclusive; not “last 30 days.” On 2026-10-15 Asia/Kuwait it is 2026-09-01T00:00+03:00.
Future-skew engineering allowance is **120 seconds**, concretizing the approved small clock difference: values
up to recorded_at+120s normalize to recorded_at; anything later returns SESSION_TIME_IN_FUTURE. Persist no future
instant. Compute late from normalized occurred business date < recorded business date; never recompute on read.
No statement-status query: a valid previous-month line is recorded even if its period is APPROVED/PAID (D-49).

SS-Q8: the staff reader takes `occurredAt` (creation normalized time or append's original session instant),
derives the working day using staff's own branch timezone/attendance working_date rules, and reports dated
eligibility, persisted nullable employees.user_id and attendance/leave facts. Orders never receives or derives
the branch timezone/working day. “Not clocked in” means no non-void attendance with that employee, branch and
staff-derived working_date; OPEN/CLOSED/MISSED_OUT all evidence a clock-in, including MANUAL. It does not demand a currently open
attendance session. Approved FULL_DAY leave covering that day, or approved PARTIAL leave covering occurred_at in
its stored [starts_at,ends_at), sets the leave flag. For late entry inspect the **occurred day**, not the recording
day. Both flags can coexist, identify affected performer(s), and produce a response warning and persisted line
aggregate flag. Lack of attendance/leave never blocks an otherwise eligible performer.

## 4. Ports and create/append use cases

Define `ServiceSessionTransactions` whose `run` exposes a transaction-scoped bundle: place/access/catalog/customer/
performer/discount readers, insert-only session repository, audit/outbox writers and idempotent execution. Keep the
transaction type opaque in `ports/`; persistence captures Tx. Inject Clock and IdGenerator. Mock these ports only
for orchestration tests; integration tests use real Postgres. No SQL, arithmetic or I/O in the use case.

`RecordServiceSessionUseCase` orchestrates:

1. Enter the verified actor's `withTenant` via transactions. Confirm place and perform a non-locking current
   authority recheck **before** calling `runIdempotent`, so its replay branch cannot bypass current authorization.
   Use the HTTP-computed actor-bound `requestFingerprint` (§1); never hash in the use case. Another recorder
   cannot obtain someone else's replay by reusing a company key; omitted occurred_at stays omitted in the hash.
2. `runIdempotent` claims or replays using the existing primitive. On a new claim its callback acquires company
   and ordered membership SHARE locks as in spec 018, resolves caller-owned recorder membership and rechecks
   record authority/orders feature. A selection never bypasses DENY. Replays do not reread financial limits,
   performer facts or stored warnings. A currently invalid supplied membership still fails the precheck.
3. Prepare bounded customer/service/performer reads, locking service rows then employee rows in deterministic ID
   order before the final time-dependent reads. Staff coordinates the employee SHARE locks with its HR writers;
   there is no AttendanceState lock and no reverse attendance→identity lock order. Then read the settings limit
   **once**; its company→memberships→settings locks reuse those already held. No earlier settings read may supply
   an owner/limit eligibility result sampled before a later service/employee lock wait.
4. After all those waits sample the injected clock, recheck active recording authority, and compute normalized
   occurred time/business date/late in domain. Re-read the already-locked catalog/employee facts and dated branch
   eligibility at this final instant/date; capture bounded attendance/leave warning facts without further row-lock
   waits. Missing-clock/leave flags are a read snapshot, not an attendance gate. Settings keeps its own fresh
   post-wait eligibility instant as implemented; permission expiry is also checked at the final injected instant.
5. Call domain functions to validate all lines/self/shares, calculate amounts/effective bps/warnings and partition.
   All-rejected throws before inserts. Allocate session/accepted-line/performer UUID-v7 IDs through injected IDs.
6. Insert accepted rows, append price/discount audits, append the one session-recorded envelope and return 201.
   Persistence stores that response with the claim in the same transaction. Audit/outbox/constraint failure rolls
   back everything; no continuation that commits a prefix of the accepted lines.

`AppendServiceSessionLinesUseCase` follows the same steps, replacing create authority with the original-recorder
OR current branch-permission rule. Pre-read the scoped session for replay authorization. In a new claim, after
company/ordered membership SHARE locks acquire `pg_advisory_xact_lock` on a namespaced hash of companyId/sessionId,
then reread the session and its lines. This serializes all appends without requiring UPDATE privileges on immutable
session headers. Future session-line writers must use the same lock before changing the line set. The transaction
bundle exposes these operations as ports; no SQL reaches the use case. Retain this lock through response/event commit.
Read services/employees/settings in the same order as creation, then sample the fresh append clock, validate the
stored business_date against the current back-dating window and original occurredAt against the time rules.
Use the stored business timezone, current actor's limit and staff facts for the original occurredAt. Domain
validates self/shares, partitions limits, capacity/ordinals/whole-visit total and computes each new line's late flag.
Insert only additions, with current recorded_by/membership/recorded_at; never overwrite original lines or the
session header. Audit `session.lines_added` with actor/membership, added IDs/count/outcome/time and monetary/share
changes. Emit only the added line snapshots in one `ServiceSessionLinesAdded`, store the 201 in this transaction.
An all-rejected/capacity/error path leaves existing session/lines unchanged and no new event/audit/claim.

Lock order for both paths: idempotency claim → company SHARE → memberships SHARE ordered by ID → session advisory
lock (append only) → services SHARE ordered by ID → employees SHARE ordered by ID → settings SHARE. Shipped
catalog service update (`drizzle-service-transactions.ts`) takes service FOR UPDATE → UPDATE → audit insert,
whose FKs take parent KEY SHARE; create inserts with parent KEY SHARE → audit. Neither takes company/membership
UPDATE locks. Orders' company SHARE is compatible with catalog's later company KEY SHARE; never strengthen it
to FOR UPDATE while retaining this order. Catalog takes no session advisory/employee/settings lock. The explicit
concurrent edit/audit test below verifies this compatibility, including an append waiting on the edited service.

The identity reader's ambiguity check avoids fabricating a “guard-selected membership”: today's guard supplies
neither that ID nor a highest-limit rule. The request can select a verified caller membership; if there is only
one it needs no selection. Candidate IDs in the ambiguity error are the authenticated caller's own eligible rows.
35c must support that selection; it cannot choose a different person's membership to get their discount limit.

Audit one row per accepted price override or positive discount, allowing both changes in one record: actor/time,
session/line, list/price/discount/net, effective bps, applied limit/source and selected membership. Record explicit
unequal input shares in the session-record audit (SS-Q7). No rejected-line price-change audit, full phone or
unvalidated body. Append an overall session-created audit with accepted line IDs/count, outcome and late flag.

## 5. Persistence, public readers, HTTP and composition

Implement ADR-0041's named adapters under orders/persistence; export provider readers through each provider's
index and bind them only through the orders provider factory. Catalog maps FOLLOW_PLAN/ZERO/PCT/FIXED explicitly
with assertNever/all-kinds tests. Customers masks before returning. Staff readers only join staff-owned tables.
Identity readers only read identity-owned data; tenancy confirms scope externally. Settings uses its existing
resolver and locks; no Redis reads for financial authority. Sanitized persistence errors discard driver params,
messages and stack; named domain failures survive, serialization/deadlock becomes retryable 409.

Staff `readSessionPerformers` accepts occurredAt and returns dated eligibility, attendance/leave facts and nullable
persisted employees.user_id; it resolves branch timezone/working_date internally. Orders maps those facts and its
domain applies `validateRecorderPerformers`; unlinked employees cannot be identified as the recording user.
No orders branch timezone read is added. Both creation and append serializers encode **every monetary field**
(event net/list_price/price/discount and rule_snapshot.FIXED included) as canonical KWD 3-dp decimal strings using
`moneyToString`; consumers use `parseMoney`, matching ADR-0035 and shipped SalaryChanged. Bigint mills never cross
JSON as integer-mill strings. Verify round trips for 0.000, 6.412, 25.000, FIXED 2.500 and the maximum amount.

Thin controller validates path/body/header, calls the use case and maps its typed result/status; it never prices,
selects a recorder membership or queries tables. Use actual `Require`/`RequiresFeature` decorators (not imaginary
Feature APIs), `actorOf`, existing error filter and optional-empty DB startup patterns. Wire via exported
`ordersControllers`/`ordersProviders` at `app.ts`; generate OpenAPI and clients using the current commands.
No read endpoint in 35a. The response is built from captured write facts, not a new query-use-case read path.

In the same implementation PR update map §2/§3/§4/§6 and generate YAML, with every value read and adapter path
listed in ADR-0041. Synchronize SPEC §3's initial-event description and ADR-0010 with the recorded amendment:
`ServiceSessionRecorded` batch on creation, `ServiceLineChanged` on later updates; never both on creation.
`ServiceSessionLinesAdded` is one batch of only appended revision-1 lines: row 50 parses money and projects just
these new line/performer inputs; row 59 updates the same customer/business/day rating group, keeping the visit
identity and original occurred_at. Lines retain their own append recorded_at for commission ordering. Do not
re-emit old lines or create another rating request for this visit. Include both batch events in replay/bootstrap
and approval's pending-input count. Publish Arabic-documented orders event types, add both to the known-event
registry and zero-consumer delivery tests. Do not
claim an unchanged executable map allows the new imports.

## 6. Integration, negative isolation and delivery checks

Use the T2 compose Postgres with a cloned DB per spec file, migrations applied, `pospay_app` restricted role and
real HTTP session/guards. Keep independent data-only numerical fixtures for identity/orders parity.

- Happy path: multiple services/shared performers; captured rule/list/name snapshots, ACTIVE/revision1, correct
  totals, one session event, correct audits and stored idempotent response (SPEC M1/M10/M12/M13).
- Limit cases: equality, lowered price, above-list price, list zero, UNLIMITED owner, personal/business/unconfigured
  zero; the 7.125/10% half-up refusal; mixed 201 accepts only valid lines and original index mapping; all-over 422
  creates nothing. Invalid shares/self/reference in **any** line aborts even when other lines were acceptable.
- Retry/races: lost partial response, same key/body concurrency, first rollback then retry, changed body/actor/route
  mismatch, timeout/deadlock; no second session/event; replay preserves original warnings/rejections after changes.
- Authority: all five default roles, delegated grant, DENY and expiry, other branch, disabled orders feature,
  device/personal-staff token refusal, owner-as-performer refusal, selected foreign membership, ambiguity and valid
  explicit selection. Branch/business mismatch and nonexistent branch have the same 403.
- Concurrency: limits changing, person null→zero vs business zero→10000, owner/membership expiry during waits;
  never a mixed or expired limit. Service edit/employee move during read uses stabilized snapshots/eligibility,
  ordered batch locks do not deadlock. Test boundary crossing during waits with injected clock.
- Explicit deadlock regression on real Postgres: pause an actual catalog PATCH after service FOR UPDATE; start
  creation/append holding company SHARE and waiting for that service SHARE; let PATCH finish UPDATE/audit (company
  FK KEY SHARE) and commit. Both must complete without 40P01/timeout/409, with one consistent captured service
  revision and one event per accepted create/append. Repeat with two service IDs in reversed request order.
- Append: original recorder (including no longer holding the record grant), other branch-permitted user and
  denied/expired/wrong-branch/non-recorder refusal; appender's own discount membership audited; matching/null
  employee user links; original customer/time/date retained; expired back-dating window after lock wait refused;
  corrected PARTIAL lines stay in the same session. Two concurrent appends serialize ordinals/count/20-line cap;
  each commits one delta event, rollback/retry adds no duplicate line. Whole-visit total and late badge/bell facts
  include late appended lines while the header is unchanged. Replays never bypass current append authorization.
- Fingerprint contract: actor inside params, body key-order parity, retained array order/omitted occurred_at,
  changed membership/session/actor returns 422 for a committed operation/key; creation/append operations distinct.
- Event contract: all money (including prices/net/FIXED) is KWD 3-dp, parsed with parseMoney; delayed creation,
  append and changed-line events converge per line revision and parent event dedupe without duplicate inputs.
- Times/warnings: same vs previous business day, UTC/local midnight, earliest allowed instant±1ms, month/year
  rollover, future allowance±1ms/normalization, late approved-period input accepted without statement reads;
  no attendance, approved full/partial leave, both, closed/manual/void attendance, late-day facts.
- Inject failure at each accepted insert, audit, deferred trigger, outbox and response store: no partial rows,
  orphan performers or committed key. Direct invalid share sum/zero-performer inserts fail at commit.
- Per **each new table**, negative RLS suite: cross-company SELECT=0, INSERT rejected; foreign-parent references
  rejected, including same-company wrong business; context absent/pool reuse/rollback/concurrency cannot leak.
  UPDATE/DELETE/TRUNCATE are denied by actual grants; assert FORCE, no ownership/BYPASSRLS/tenant definer. Where
  testing UPDATE policy separately, use a test-only restricted role with that privilege, never widen runtime grants.
- New provider queries get result-shape and index-use EXPLAIN assertions on representative tenant data. 35b's list
  shape/EXPLAIN tests do not belong here. Measure the bounded 20-line batch path against the 200ms request target;
  this is a verification target, not a claimed measurement in this design.

Before merge: `pnpm check`, docs lint, boundaries/cycles/module-map checks, contracts/OpenAPI consistency,
targeted integration/RLS/EXPLAIN suites, API/worker builds and optional-empty startup smoke. Prove additive
migration on empty/populated fixtures and previous-image compatibility. This design-only task runs no code tests
and does not report those future gates as passed.

## Later-consumer and slice handoff

35b owns `ServiceSessionRecorded` / `ServiceSessionLinesAdded` → worker orders late notice handler → grouped
`LateServiceSessionNoticeRequested` → existing notificationRequestConsumer/StoreInAppNotification → admin bell
(ADR-0041 §5). It declares the event/map reads and IN_APP template, uses active scope-covered branch managers,
and recovers late sessions from the 35a rollout gap. Dedupe by tenant/session across both event types so the first
late append can notify and later appends cannot repeat the visit notice. The badge/filter uses header late OR
any line late; zero recipients is consumed
without an invalid empty notification request. No notice is sent for all-rejected requests or one per line.
Badge/filter and notice are required together by SS-Q11; row 62 later replaces the interim alert rule.

Rows 50 and 59 cannot assume published events replay automatically: supply controlled retained-event replay or
orders-owned authoritative bootstrap, checkpoint/count coverage, revision guards, and a consumer-start/live-write
race test. Row 50 opens no approval gate until all earlier accepted lines are covered; row 59 expires historical
rating groups past deadline. SPEC §5.2 money-share remainder order and §6 closed-period corrections stay theirs.
35d owns price/discount edits with revision increment, immutable audit history and changed-line events (SS-Q10
option 2); it is outside this plan. No extra owner answer is required to implement 35a from the recorded answers.
