# Spec 050 — Record a service session (Phase 1 row 35)

> **Status:** Implemented in 35a (PR 178) · 2026-10-12 · SS-Q1…SS-Q11 **ANSWERED by Waleed, 2026-10-12**, batch 13 in
> [owner-questions.ar.md](owner-questions.ar.md). Abu Salem agreed with every pick (2026-10-12);
> no SS-Q rule remains pending.
> **ADR:** [0041](../../adr/0041-orders-service-sessions-reads-and-events.md) · **35a plan:** [plan.md](plan.md).
> **Phase 1 row:** 35 `record-service-session` — effective discount up to the limit only; above it refused.
> **Depends on:** 32 services, 34 customers, 9 employees/branches, 7b/7c discount limits — all merged.
> **Later consumers:** 36 tips, 37 cancel, 37b performers, 38–41 approval, 42–47 packages, 50 commission projection,
> 57 staff app, 59/59b ratings.

## 1. Scope

Reception records one customer visit at one branch with service price, discount and performer shares. Each
accepted line stores list-price/rule/threshold snapshots and passes the recorder's effective discount limit.
Only lines above that limit are returned for editing; the other valid lines are saved (SS-Q6 option 2).
The successful write is one tenant transaction, including audit, idempotent response and **one** outbox event
containing all accepted line snapshots (ADR-0041's initial-recording amendment to SPEC §3 / ADR-0010).

### Split

| Row | Deliverable |
|---|---|
| 35a | Create and append write APIs for the same visit, snapshots, partial acceptance, migration/RLS, domain/tests, audit and one event per write |
| 35b | Branch day list, late badge/filter and late IN_APP bell notice to branch managers through existing notifications |
| 35c | `apps/admin` reception screen, individual login, price/amount/percent entry and same-% shortcut; PARTIAL corrections use append on returned session ID |
| 35d | Audited edit of recorded price/discount, own revision/permission design (SS-Q10 option 2) |

| Not in 35a | Where |
|---|---|
| Tips | 36 |
| Cancel line | 37 |
| Change performers/shares after recording | 37b |
| Above-limit approval/proposal/consumption | 38–41; here the offending line is refused |
| Package sale/redemption | 42/43 |
| Commission projection/estimate/statements/corrections | 48a–55 |
| Rating scheduling/claim | 59/59b |
| Payment, printing, POS sale, service barcode, offline sync | Phase 2 |
| Recorded price/discount edits | 35d |

## 2. Established decisions

- Customer is required (D-43). Reception finds/creates her through customers' endpoint first (row 34); orders
  checks company-scoped existence via `CustomerLookupPort`. Phone is masked outside customer entry and absent
  from events/audit/logs; staff see the name only. Ratings opt-out never prevents recording.
- Reception may override price, including above list (D-44, SS-Q4); actor/time are audited for every price
  override or positive discount (M1). Sessions are not payments; no payment method is recorded here.
- Effective discount is `(list_price − net) / list_price`, zero for list zero or net ≥ list (D-56/M13).
  Lowering the entered price counts too. Enforcement is per line, inclusive, with fractional bps rounded **up**:
  a fraction above the limit is refused (owner 2026-10-03, spec 016). This differs from money rounding.
- Settings' existing `readEffectiveDiscountLimit(tx,companyId,businessId,membershipId)` resolves active owner → UNLIMITED, personal → business default → NOT_CONFIGURED. Orders enforces NOT_CONFIGURED as zero
  (2026-10-03, spec 018). It reads on the same transaction with spec 018's stable locks; no Redis limit cache.
- Equal shares default; Σ share_bps=10000 (D-14). Reception may supply unequal initial shares (SS-Q7);
  post-recording changes belong to 37b. Commission uses net after discount; tips are separate.
- Every performer must be active/non-deleted in the business, within hire/contract dates (contract end inclusive),
  and attached to this branch on the occurred date: `from ≤ date < to`, open-ended to allowed.
  Missing attendance or approved leave warns, never blocks (SS-Q8).
- List price, service rule and threshold flag are captured at save time; later catalog edits cannot reprice the
  saved line (SPEC §6, spec 031). Names are captured too to avoid cross-context list joins.
- Dates/periods/late/window use the business timezone (SPEC §5). Staff's performer reader takes occurredAt and
  derives its own branch working day using attendance working_date rules; orders never needs branch timezone.
  Store the business date and timezone. A valid late line in an APPROVED/PAID period is still recorded;
  rows 50/55 own the correction (D-49/M3). Orders reads no statement status.
- Reception is the `cashier` system role (ADR-0036); SS-Q3 uses individual admin login, not device login.

## 3. Owner decisions — Waleed, 2026-10-12

Verbatim Arabic answers and the original alternatives remain in [owner-questions.ar.md](owner-questions.ar.md).
These answers replace recommendations; SS-Q5/6/10/11 chose option 2.

| ID | Answer |
|---|---|
| SS-Q1 | 35a server write, 35b day list, 35c reception; the additional edit request is 35d |
| SS-Q2 | Grantable new record permission, defaults owner/GM/business manager/branch manager/cashier; staff cannot record their own performance |
| SS-Q3 | Admin on reception computer, each recorder's own account |
| SS-Q4 | Editable pre-filled price, even above list; discount amount or percent; same-% shortcut |
| SS-Q5 | Nearest mill **half-up**; 0.7125 → 0.713; refuse if this exceeds authority |
| SS-Q6 | Save valid lines and return above-limit lines for editing; precise 201/422 semantics in §8 |
| SS-Q7 | Unequal initial shares allowed; equal default; remainder bps to first input; no zero; maximum four performers |
| SS-Q8 | Allow missing attendance/approved leave with reception warning and persisted line flag for manager |
| SS-Q9 | Default now, editable; late=earlier business date; back to first of previous month; no future, with small clock-skew allowance |
| SS-Q10 | Audited edit of saved price/discount, separate row 35d; 35a appends new/corrected drafts without editing saved lines |
| SS-Q11 | Late badge/filter **and** one bell notice to branch managers per late saved session (35b) |

## 4. Salon example

Business «صالون الأميرة», branch السالمية, Asia/Kuwait. Receptionist منى (`cashier`) has 1000-bps personal
limit; branch manager 2000 bps; owner unlimited. Services: صبغة 25.000 FOLLOW_PLAN/counts; مناكير 7.125
PCT 1000 bps/counts; رموش 15.000 FOLLOW_PLAN/counts; استشارة 0.000 ZERO/non-counting. Performers سارة,
هبة and ريم are attached to the branch. Customer نورة; display phone `•••• •123` outside entry.

## 5. User stories and acceptance scenarios

### US-1 — Record several services

On October 14 at 11:00 Kuwait, نورة has hair/nails/lashes. منى records three lines.

- **SS-01** One session, three ACTIVE lines, revision 1; recorded_by=منى; recorded_at=server clock,
  occurred_at=08:00Z, business_date=2026-10-14, late=false.
- **SS-02** Shared lashes defaults to ريم/هبة 5000/5000; initial 7000/3000 is also allowed and attributable.
- **SS-03** Each line stores current list price, rule, threshold and name snapshots.
- **SS-04** One `ServiceSessionRecorded` envelope with three full revision-1 line snapshots commits with
  session/lines/performers/audit/idempotency. Any persistence failure rolls back all of them.
- **SS-05** 201 COMPLETE includes names, accepted nets/effective bps and masked customer phone; no rejections.

### US-2 — Discount within authority

- **SS-06** Hair 25.000 less 2.500 → net 22.500/effective 1000 bps → saved at the inclusive limit.
- **SS-07** Override hair price to 22.500, discount 0 → same effective 1000 bps; store list 25.000/price 22.500/
  discount 0/net 22.500 and actor/time price audit.
- **SS-08** Price 27.000 above list → zero effective discount, saved and audited (SS-Q4).
- **SS-09** List zero has effective zero; an amount discount exceeding entered price is still invalid.
- **SS-10** Owner hair at 15.000 (40%) → saved, unless the owner is also an input performer (SS-Q2).

### US-3 — Above-limit line returned for editing

- **SS-11** Hair discount 3.000 → 1200 bps > 1000; refuse that line with its maximum additional discount 2.500.
  As the only line: 422, no writes. Other otherwise-valid lines can still save.
- **SS-12** Nails 7.125 with 10% discount → half-up 0.713, net 6.412, `ceil(7130000/7125)`=1001 bps → refused
  at 1000 bps. Never floor/clamp to 0.712 (SS-Q5 option 2).
- **SS-13** NOT_CONFIGURED is enforced as 0; only zero effective discount saves.
- **SS-14** One within/one above → 201 PARTIAL; one saved line, one rejection keyed to original input index,
  one session event. Correct only the rejected draft and send a new key to append to the **same session**;
  saved lines are not resent. One ServiceSessionLinesAdded contains only newly accepted lines.

### US-4 — Late entry

- **SS-15** October 15 recording October 14 17:00 → late=true. 35b supplies badge/filter and one IN_APP bell
  notice per persisted late session to active managers covering its branch (SS-Q11).
- **SS-16** Occurred beyond server time + 120 seconds → SESSION_TIME_IN_FUTURE; within the small allowance
  normalize to server recorded_at, so no future instant is stored.
- **SS-17** On October 15, business-local September 1 midnight is accepted; 1 ms earlier → SESSION_TIME_TOO_OLD.
- **SS-18** Valid previous-month line saves even when commissions approved/paid; correction belongs to 50/55.

### US-5 — Performer rules

- **SS-19** Wrong business/branch/date, deleted, before hire or after inclusive contract end → SESSION_PERFORMER_NOT_ELIGIBLE with input index/employee; whole request rolls back.
- **SS-20** Zero/>4/duplicate performers, mixed omitted/explicit shares, zero/fraction share or sum ≠ 10000 → SESSION_PERFORMER_SHARES_INVALID, whole request rolls back.
- **SS-21** Missing attendance/approved leave on occurred day saves per-performer warnings and the line flag;
  both can coexist and do not affect amounts/shares.
- **SS-25** Any performer linked to recorder user → SESSION_PERFORMER_SELF_FORBIDDEN (403), even with owner
  or delegated record permission; whole request rolls back. “Own” means persisted employees.user_id equals
  current recorder user ID, compared by a pure orders domain function using staff-returned nullable user_id.
  An unlinked employee cannot be detected as the recorder; matching/different/null cases are unit-tested.

### US-6 — Retries, authority and isolation

- **SS-22** Same key/body/actor/route replays original complete/partial 201 without writes. Changed fingerprint → IDEMPOTENCY_KEY_REUSED(422). Concurrent duplicate waits then replays; only claim timeout returns 409.
- **SS-23** Other-company customer/service/employee behaves as unknown; wrong-business service/employee is
  refused; all three new tenant tables have negative RLS tests.
- **SS-24** Missing record permission, foreign/nonexistent branch or route business/branch mismatch → uniform 403.
- **SS-26** Partial refusal applies only to above-limit discount. Any other invalid line or accepted-write failure
  rolls back all accepted effects. All-over-limit creates no empty session, event, audit or surviving claim.
- **SS-27** Multiple eligible recorder memberships without selection → SESSION_RECORDER_MEMBERSHIP_REQUIRED.
  A supplied selection must belong to the user and cover the branch now; foreign/inactive selection → uniform 403.

### US-7 — Finish the same visit

- **SS-28** After PARTIAL, 35c keeps the session ID and posts only corrected rejected lines to the append route
  with a new key. Session/customer/occurred_at/business_date remain unchanged, old line IDs/revisions are retained.
- **SS-29** Original recorder OR current branch record-permission holder may append while active and branch
  eligible, subject to DENY/orders feature. Other actors/branches/tenants fail 403. The appender selects and
  audits their own membership and uses their own limit; self prohibition applies to that current actor.
- **SS-30** Session business_date outside the first-of-previous-month window at fresh append time → 422 without
  additions. Concurrent appends serialize, maintain contiguous ordinals and a maximum of 20 persisted lines;
  capacity overflow rolls back that append, and retry of a committed key adds nothing twice.
- **SS-31** Each accepted append commits one ServiceSessionLinesAdded event, audit and replayable 201 together;
  all-over-limit/other failures leave the existing visit unchanged. PARTIAL append corrections repeat this route.

## 6. Functional requirements

- **FR-001** POST records 1…20 input lines; accepted set saves in one `withTenant` transaction. Only above-limit
  discount causes partial acceptance; all other errors remain atomic.
- **FR-002** Require record:service-sessions:branch and orders feature, with SS-Q2 default roles/grantability,
  individual admin login and self-performance prohibition. Recheck authority after lock waits in the transaction.
- **FR-003** Customer must exist in company, otherwise SESSION_CUSTOMER_NOT_FOUND; no customer write here.
- **FR-004** Service must belong to business, otherwise SESSION_SERVICE_NOT_FOUND. Catalog reader snapshots
  price/names/rule/threshold; exhaustively map every rule kind into orders-owned types (ADR-0035).
- **FR-005** Each line has price and AMOUNT/PERCENT discount; contract money canonical three-decimal KWD strings,
  domain bigint mills. price ≥ 0, 0 ≤ discount ≤ price, net = price−discount; price above list allowed (SS-Q4).
- **FR-006** Percent amount=`roundKwd(priceMills*BigInt(bps), 10000n)`, nearest mill half-up (SS-Q5); stored as amount.
- **FR-007** Read settings limit once on the same transaction for verified recorder membership. NOT_CONFIGURED → 0; UNLIMITED → no numerical check; MEMBERSHIP_NOT_FOUND → 403. Actual guard has no membership ID: optional
  recorder_membership_id selects a caller-owned active branch-covering membership, or auto-use the sole candidate.
  Ambiguity is explicit, never highest-limit/scope precedence (ADR-0041).
- **FR-008** Effective bps=ceil((list−net)*10000/list), zero at list 0 or net ≥ list. Over limit returns per-line
  editing information while within-limit lines save (SS-Q6). Calculations/partition/display maxima are domain functions.
- **FR-009** 1…4 distinct performers, each integer share ≥ 1, sum = 10000. All omitted → equal split with remaining
  bps added to first input performer; preserve input order (SS-Q7).
- **FR-010** Reception may supply unequal shares at initial record; no post-recording share edit here.
- **FR-011** Staff port checks active/branch/date eligibility and supplies warning facts/user links. Warn when no
  non-void attendance on the working day staff derives from occurredAt using its branch timezone, or approved FULL_DAY leave on that day/PARTIAL leave at the
  occurred instant. OPEN/CLOSED/MISSED_OUT including MANUAL count as clock-in evidence; current OPEN is not required.
  Evaluate late inputs on occurred day, never today's attendance. Persist performer flags and line aggregate.
- **FR-012** occurred_at UTC, optional (default fresh injected now) and editable; recorded_at only injected server Clock.
- **FR-013** late=(occurred business date<recording business date), computed in domain, stored with business timezone/date.
- **FR-014** Oldest is first of previous calendar month at local midnight inclusive; no manager-only late gate.
  Approved small clock-skew engineering allowance=120 seconds; ≤ that future normalizes to recorded_at, > that refused.
- **FR-015** Audit accepted price overrides/discounts: actor/time/line/list/price/discount/net/effective bps/applied
  limit/source; record initial unequal shares and overall session creation. No rejected financial row or phone audit.
- **FR-016** Price/discount edits after recording are required by SS-Q10 option 2 and delivered in 35d with audit.
  35a's append route adds corrected rejected drafts/additional lines to the same visit; it never edits saved money.
- **FR-017** UUID v7 IDs from injected IdGenerator; no Date.now/randomUUID in use cases.
- **FR-018** Sum accepted rounded nets only in orders/domain, bounded to Money/numeric(14,3); aggregate overflow
  returns SESSION_TOTAL_TOO_LARGE and rolls back the whole request. No controller/use-case arithmetic.
- **FR-019** 35b delivers late badge/filter and once-per-late-session bell via existing notifications; 35a emits late metadata.
- **FR-020** Append requires the original recorder OR branch record permission and the persisted business_date
  within the back-dating window; all creation line rules, actor-bound idempotency and one-transaction/one-event
  guarantees apply. Fresh snapshots/limit belong to the appender; performer eligibility uses original occurredAt.
  Limit the whole visit to 20 persisted lines, allocating ordinals under the tenant/session advisory lock.

## 7. Data model — migration and RLS in 35a

All three tables have UUID v7 PK **(company_id,id)**, business_id, ENABLE+FORCE RLS with explicit USING/WITH CHECK,
SELECT/INSERT-only runtime grants and negative isolation tests. Monetary columns numeric(14,3), UTC timestamptz.
Exact schema/constraints/indexes are in [plan.md](plan.md), including provider-reader indexes.

| Table | Data and key constraints |
|---|---|
| service_sessions | business/branch/customer/recorder user+membership, occurred/recorded/business_date/business_timezone/late/created; tenant-qualified branch/customer/membership FKs, UNIQUE(company,business,id) |
| service_lines | business/session/service/ordinal/status/revision, list/price/discount/net/effective/applied limit+source, service-name/rule/threshold snapshots, has_performer_warning, recorded_at/late/recorded_by/recorded_by_membership_id/created; tenant+business and recorder FKs, UNIQUE(company,session,ordinal), UNIQUE(company,business,id) |
| line_performers | business/line/employee, performer_ordinal/share_bps/name snapshots, missing-clock/approved-leave flags; tenant+business FKs, UNIQUE(company,line,employee), UNIQUE(company,line,performer_ordinal) |

Checks enforce monetary bounds/net equation, bps/revision/status/rule consistency and share bounds. Deferred
SECURITY INVOKER triggers enforce 1…4 performers, sum = 10000 and warning consistency at commit. Parent/child
business FKs prevent same-tenant cross-business references. No redemption_id until 43; no UPDATE/DELETE grant yet.

Indexes lead with company: branch/day/time/id and partial late-day session lists, customer/business/day for 59b,
recorder membership/user FKs, line session/ordinal and service FK, performer line/employee and employee lookup.
Use existing PK/unique indexes where they cover predicates; plan lists the exact indexes and concurrent protocol.

Permission migration adds record:service-sessions:branch and the five SS-Q2 system-role defaults plus ar/en labels.
The draft's service_line_performers natural-key table is replaced by line_performers with a tenant/id PK.

## 8. API contract and partial acceptance

POST /v1/businesses/:businessId/branches/:branchId/service-sessions → 201
`{outcome:'COMPLETE'|'PARTIAL',session,rejected_lines}`. Strict Zod in packages/contracts/src/orders/service-session.ts;
Idempotency-Key required, COMPANY scope/record-service-session operation. HTTP validates the key then recomputes
`requestFingerprint({method,route,query,body,params:{businessId,branchId,companyId,actorUserId,sessionId?}})` using
the existing shared helper; actor/company come from actorOf, never client input. SHA-256 over canonical JSON
sorts object keys and preserves array order/omitted occurred_at. The stock decorator alone does not bind actor.

```json
{
  "customer_id": "uuid",
  "occurred_at": "2026-10-14T08:00:00.000Z",
  "lines": [{
    "service_id": "uuid",
    "price": "25.000",
    "discount": { "kind": "AMOUNT", "amount": "2.500" },
    "performers": [{ "employee_id": "uuid", "share_bps": 10000 }]
  }]
}
```

Also supported: PERCENT `{kind:'PERCENT',bps}`, optional recorder_membership_id, omitted occurred_at and all
omitted share_bps for equal split. Price remains explicit; 35c pre-fills it from catalog. No client authority/late fields.

Creation response contains accepted lines only with server IDs, zero-based request input_index and contiguous
session ordinal in accepted input order, name/rule snapshots, amounts, revisions/shares/warnings, line recorder/
membership/recorded_at/late, masked customer and accepted total.
Rejected entries have no saved IDs: input_index/service/name, bilingual SESSION_DISCOUNT_ABOVE_LIMIT, attempted
amounts/effective bps/applied limit/source/minimum_net/max_discount_amount. Display maxima are domain-derived:
minimumNet=ceil(list*(10000-limit)/10000), max additional discount=max(0,price−minimumNet), bounded by price.

Validate every non-limit invariant first. At least one accepted line → 201 and one atomic write/event/response;
all over limit → 422(details.rejected_lines) and full rollback, including claim. Any other invalid line aborts
entire request. Never commit valid lines behind 422 or use separate transactions. Original-key/body retry replays
partial 201 including rejections. Edit only rejected drafts and use a new key on the same visit's append route;
never resend accepted lines. Changed body/actor/route with committed key → 422; concurrent duplicate waits/replays,
claim timeout → 409. The plan specifies all status/error mappings and optional-empty readiness behavior.

POST /v1/businesses/:businessId/branches/:branchId/service-sessions/:sessionId/lines → 201
`{outcome:'COMPLETE'|'PARTIAL',session,added_lines,rejected_lines}`, body `{lines,recorder_membership_id?}`,
COMPANY operation `append-service-session-lines`. Inherit original customer/branch/occurred_at/business_date/
timezone. Authorize original recorder OR branch-permission holder with current active branch membership/DENY/
feature checks; unknown/foreign/wrong-route session → 403. Use the appender's limit/selection and fresh catalog
snapshots, applying the same performers/shares/time/partial rules. After lock waits require stored business_date
within the current back-dating window. Tenant/session advisory lock serializes count/ordinal assignment; max
20 persisted lines across the visit (cancelled included). Capacity overflow → 422 with full append rollback.
`session` includes the full visit/total; `added_lines` identifies this request's accepted subset. All rejected →
422/no append effects or surviving claim; retry replays the original response. The original session header stays
immutable; new lines store current actor/membership/recorded_at/late. 35b derives visit late as header OR any line
late. 35c repeats appends after PARTIAL, never resends saved lines or creates another visit for these corrections.

Day list in 35b: GET on same path with date/late/cursor/limit through queries/, with its own read permission and
shape/EXPLAIN tests. It is not part of 35a.

## 9. Pure domain functions and tests

orders/domain owns lineNet, discountFromPercent, effectiveDiscountBps (local copy per ADR-0035/0041),
partitionDiscountLines, authorized minimum-net/max-discount display calculation, equalShares, validateShares,
sessionTime/isLateEntry, performerWarnings/self rule and sessionTotal. Arabic JSDoc and exhaustive no-DB tests.
Use shared Money/roundKwd; never import identity domain or move RBAC execution into shared kernel.

SS-Q7 bps remainder to first input differs from SPEC §5.2 money-share remainder to ascending employee_id.
35a persists bps and whole-line net; row 50 owns money allocation/projection/commission arithmetic.

## 10. Permissions

New grantable record:service-sessions:branch defaults owner/general_manager/business_manager/branch_manager/cashier;
current scope/DENY/expiry rules apply. Staff/self-performance refusal is independent of grants and owner unlimited
limit. Admin only. Reuse customer create permissions on customers' existing scoped find-or-create endpoints before
recording; no implicit customer creation by orders. Discount limit is recorder-membership data, not another grant.
For multiple eligible memberships the recorder chooses `recorder_membership_id`; persist and audit that selection
on creation and each append. Never auto-pick the highest limit. Append's original-recorder alternative still
requires live scoped membership and DENY/feature checks; its guard must express the OR rule explicitly.

## 11. Events and consumers arriving later

35a emits exactly **one ServiceSessionRecorded** (Arabic doc comment, schema_version = 1) per saved session:
session/business/branch/customer IDs, recorder/membership, occurred_at/recorded_at/business_date/business_timezone/
late and accepted `lines` carrying the SPEC §3 full line state: line/session/service/branch/business/customer IDs,
ACTIVE, timestamps/business_date/late/line recorder+membership, list_price/price/discount/net,
performer employee_id/share_bps, rule_snapshot, counts_snapshot, package:null,
revision = 1. **All monetary fields**, including net/list_price/price/discount and rule_snapshot.FIXED, are canonical
KWD three-decimal strings (`"6.412"`, `"25.000"`, FIXED `"2.500"`), matching ADR-0035 and shipped SalaryChanged.
Consumers use parseMoney; bigint mills stay internal only. No rejected draft or phone. No duplicate initial ServiceLineChanged.

Each successful append emits exactly **one ServiceSessionLinesAdded**, schema_version=1, with original session/
business/branch/customer/occurred_at/business_date/timezone and current append actor/membership/recorded_at/late;
`lines` contains only appended full revision-1 snapshots. Line recorded_at is its own creation/append instant.
The distinct event preserves visit identity while telling row 50 to project only new line × performer inputs;
row 59 refreshes the same customer/business/day rating group and performers, never another visit/request.

ADR-0041 explicitly amends initial creation transport in SPEC §3/ADR-0010. Later 35d/37/37b retain
ServiceLineChanged with full state and increased per-line revision. Rows 50/59 consume both batch envelopes;
50 dedupes parent event and applies newer line revisions atomically; 59 schedules by customer/business/day.
No ServiceCompleted or OrderCompleted is emitted for this Phase 1 recording.

Worker known-event registry includes both recording and append events even before consumers, following SalaryChanged precedent.
Published-with-no-consumer does not imply automatic future replay. 50 must bootstrap/replay all earlier lines,
using orders' public reader for a state bootstrap, with revision guards and coverage before approval opens.
59 bootstraps active customer/day groups; expired deadlines never trigger historical ratings; 59b reads authoritative
active lines at claim time. 35b recovers the rollout gap for late notices with consumer dedupe.
Row 50 replay/bootstrap and approval's pending-input count cover recording, append and changed-line events;
parent event dedupe/per-line revision guards handle replay/reordering without duplicate commissions.

35b worker orders uses recipient read ports following ADR-0037 and emits grouped LateServiceSessionNoticeRequested
with IN_APP recipients for active scope-covered owner/GM/business/branch managers. Existing
notificationRequestConsumer → StoreInAppNotification → admin bell delivers once/session. Groups ≤ 100, atomic consumed
mark/group events; no direct notifications calls/package import. Interim rule later becomes row 62 alert settings.
It consumes both recording and append events, deduping by tenant/session: the first late append can notify,
later appends cannot repeat the visit notice. Late badge/filter uses header late OR any line late.

## 12. Edge cases

Same service twice allowed. Server list/rule snapshot at save wins over a stale screen; no silent clamp. Customer
opt-out records normally. Employees attached to two branches may perform at either valid link. UTC midnight does
not define business date. Self-performer recorder is refused. Valid late approved-period input still records.
Partial 201 leaves drafts unsaved, not cancelled rows; maximum 20 input lines/request and 20 persisted lines/visit,
one recording or append envelope per successful write. 20-line 200 ms
performance target must be measured during implementation, not assumed here.

## 13. Engineering decisions settled

ADR-0041 adds five adapter import edges (catalog/customers/staff/identity/settings) to existing orders → tenancy,
with consuming ports under orders/ports, adapters under orders/persistence, provider public reads and bindings
in orders.module.ts. 35a must synchronize map.md §2/3/4/6, generate YAML reads and initial-event docs; 35a (PR 178)
makes these map edits. Reverse customers → orders DaySessions binding stays at app root to avoid
an import cycle. No cross-module writes/table joins. Effective discount copy stays orders-local with parity fixtures.
Actual guard lacks a selected membership ID; verified selection/ambiguity contract replaces that draft assumption.

## 14. Behaviour-test mapping

| SPEC | 35a evidence |
|---|---|
| M1 | Accepted price/discount actor/time audits; unequal initial shares attributable |
| M2 | Above-limit line refused, other valid lines saved; proposal consumption stays 41 |
| M3 | Exact late/window, no statement-status read; closed-period correction stays 50/55 |
| M12 | Eligible performers/valid shares/self refusal; changes stay 37b |
| M13 | Lowered-price effective discount, zero list, above-list zero, ceiling bps, half-up 0.713 refusal |
| M10 | Complete/partial response retries: one effect/event; altered fingerprint refused |
| R1 | Customer phone masked at boundary, absent from events/audit/logs |
| — | Three-table RLS/FK negatives, atomic failure injection, authority/limit races; 35b owns list EXPLAIN/bell tests |

Integration uses T2 compose Postgres, cloned DB per spec file (ADR-0006). Detailed obligations are in plan.md.

## 15. Out of scope for 35a

Day-list/bell delivery/UI, recorded money edits, tips, cancel/performer changes, approvals, packages, commission
projection, ratings, payments, printing, barcode, offline/realtime. They remain required in their named slices.
