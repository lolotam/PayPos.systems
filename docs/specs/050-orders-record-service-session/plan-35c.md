# Plan 050 — 35c reception service-session screen

Date: 2026-10-13. DESIGN only: no code, commit or push.
Worktree: `E:\Dev\Worktrees\PosPay\p1-35c`; branch `spec/050-35c-reception-screen`.
Baseline: main with 35a, 35b-2 (PR 182) and 35b-1 (PR 183, `read:service-sessions:branch`, SS-Q12 answered) merged.
Sources: [spec](spec.md), [35a plan](plan.md), [35b plan](plan-35b.md),
[owner answers](owner-questions.ar.md), [ADR-0041](../../adr/0041-orders-service-sessions-reads-and-events.md),
[CLAUDE.md](../../../CLAUDE.md) §7, [architecture](../../../CLAUDE.architecture.md) §11,
[Phase 1 SPEC](../phase-1/SPEC.md) §§3/6 and visibility V1/V2.

**Owner delivery rule, 2026-10-12:** every PR has at most three subtasks and is small enough to review.
The ordered PRs below are additive, individually deployable and green against their merged predecessors.
Shared helpers, read APIs and tested form parts ship before the public route; no partially working recording
route is exposed. Each PR includes its own tests and translations, rather than leaving them to a final cleanup.
Sizes count hand-written added/changed lines, including tests, copy and architectural documentation; generated
OpenAPI/client changes are reported separately. If an estimate exceeds its upper bound, split again before code.

**SS-Q13 answered (Waleed, 2026-10-12, option 1):** `record:service-sessions:branch` alone authorizes the limited
recording-form reads below (service names/prices, eligible performers on the session date with the attendance/leave
warning, and the recorder's own memberships/limit) and nothing wider. 35c-2…4, 35c-12a and 35c-12b are unblocked.

**SS-Q18 answered (Waleed, 2026-10-14, option 3, against the recommendation; partner pending):** the recorder
leaves an EXPIRED recording (unresolved past the 24 h key retention) **without a manager**, from the reception screen,
with «اتأكدت — اتسجلت» or «اتأكدت — متسجلتش»; logout or a scope change still clear it (#198). Built as **35c-13**
(table below), after 35c-12b, 35c-13a-1 and 35c-13a-2.

## 1. Host, entry point and connectivity

Host **`apps/admin`**, route `/orders/service-sessions/new`. SS-Q3 explicitly chooses the reception computer's
admin site and each recorder's individual account; spec §1 already names apps/admin for 35c. “Reception” is an
actor, not a requirement to use the POS kiosk. CLAUDE.md §7 / architecture §11 place back-office orders under
`apps/admin/src/orders/{pages,ui,model,api}` with thin Next.js routes. Existing admin `ServicesRoute`, workspace
selection, service forms and attendance forms supply the composition/client/form patterns. POS
`app/reception-body.tsx` instead composes staff login, QR display and card clocking on a paired branch device.
Its staff/device session cannot call these admin writes. Do not transplant that authentication flow.

35c is **online-only**. This is already decided by SS-Q3, spec §1's Phase 2 offline exclusion and Phase 1
SPEC §2's admin/reception entry scope. CLAUDE.md §7's Dexie-first mandate continues to govern POS selling;
there is no new POS exception here. Existing online-only staff authentication (ADR-0019 / CLAUDE.md §7) and
card-clock availability illustrate explicit unavailable states, not permission to move a POS sale online-only.
No new offline owner question is needed. A future POS port/offline service entry would need its own scope decision.

On connection loss, keep the current editor in memory and show an ar/en offline notice; disable customer
find-or-create, fresh reads and submission. No optimistic “saved”, automatic reconnect submission, Dexie command,
service-worker write cache or background outbox. Reconnect refreshes authority, prices and dated performer facts
without overwriting entered prices/discounts. Network status is advisory: HTTP failure must work even when
`navigator.onLine` says true. An interrupted write remains unresolved until its original attempt is replayed.

Use a passive, tab-scoped pending-attempt journal in sessionStorage for reload/response-loss recovery: exact
validated body/key/route, scope and actor, attempt time and received session ID, with **no customer phone**.
It is recovery state, not an offline queue: only an explicit retry sends it. Clear settled attempts, clear
private forms/query caches/journals on logout or actor/company/business/branch changes, including cross-tab
identity changes. Never replay under another actor. Past the server's 24-hour key retention, stop automatic or
new-key recovery and show an unresolved-recording message; do not guess whether the old write committed.

## 2. Read prerequisites and boundaries

Verified baseline gaps: no admin `customers/` or `orders/` screen; customers offers scoped **POST find-or-create**,
not a searchable directory GET. Catalog GET requires `read:services:business`; attendance employee options
requires `request:attendance-change:branch`; discount UI offers management writes and broader permission reads.
`record:service-sessions:branch` alone does not authorize those endpoints. Workspaces select place but do not
provide recorder discount limits or performer warnings. Do not grant catalog/HR/permission administration merely
to make this form work; do not import catalog/staff/permissions components or hooks into orders (§11).

Per SS-Q13 option 1, add limited **recording-form** reads under the branch service-session resource:

| Authorized GET suffix | Minimum result and purpose |
|---|---|
| `/recording-context` | Server `generated_at`, business timezone, caller's eligible recorder membership IDs; after sole/explicit selection, that membership's limit `{bps:null\|0…10000,source:OWNER\|PERSON\|BUSINESS\|NOT_CONFIGURED}` |
| `/service-options` | Cursor-paged service `id,name_ar,name_en,price,revision` from selected business; price is the list-price prefill, no commission rule/threshold data |
| `/performer-options` | Cursor-paged eligible employee `id,name_ar,name_en` for branch and `occurred_at`; missing-clock/approved-leave warning booleans only, no salary, phone, leave reason, attendance history or employee user link |

These GETs disclose form inputs, not service-session history; SS-Q12's day-list read is separate. All require
selected company, authenticated admin, record permission, orders feature and verified business/branch ownership;
recheck on every page. A supplied membership belongs to the current actor and covers the branch now; return only
their candidates on ambiguity, never choose the highest limit. No Idempotency-Key on GET. A context with several
candidates can return choices before resolving a limit; the POST's existing 400 ambiguity error is also handled.

Contracts/OpenAPI precede adapters. Read endpoints live in `queries/`, never use cases, and import DB/contracts
only; inject provider callbacks through outer adapters. Reuse ADR-0041's identity/place/settings public reads;
add bounded cursor option readers in catalog/staff behind their public indexes, declared by an ADR-0041 addendum
and exact symbol/path entries in module-map.md plus generated YAML. Provider queries access only provider tables;
no cross-context joins, deep imports, frontend API-module imports or duplicated authority resolution.
Staff owns dated branch eligibility/working-day warning facts; orders never derives them from “currently IN”.
Every new query has result-shape and real-Postgres EXPLAIN tests; index additions need measured evidence and
their own small migration PR if necessary. No new tenant table or runtime grant is expected for these reads.
Include branch/tenant negatives on these API reads: limited results cannot enumerate another branch's employees
or someone else's authority. Share read-side SQL/fact readers within staff without importing domain/use-cases
into queries. Return only permitted warning facts, not their underlying attendance or leave records.

The limit/read snapshot is advisory. POST always resolves fresh authority/catalog/attendance itself. Return
canonical prices and the business timezone, not the branch attendance timezone. No new write/event format.
35b-1 is merged but is not a prerequisite of the form: do not render a branch day list in 35c or infer its
authorization from recording. Later list integration must use merged 35b-1 contracts
and its approved permission. 35b-2 already supplies the bell; 35c does not send or recreate notices.

## 3. Form behavior and monetary calculations

Customer selection is a required name/phone entry followed by the existing scoped
`POST /v1/branches/{branchId}/customers/find-or-create`, under its existing create:customers:branch authority
and customers feature (or an already granted broader scoped route). Parse `Customer`; keep returned ID/name/
masked phone, clear the raw entry phone after selection. Existing names/locales are preserved by that endpoint.
Changing entry text invalidates the selection until resolved again. Opt-out does not block recording. Do not
invent a name-search directory, implicit orders customer creation or permission fallback after a refusal.

Use react-hook-form, FormProvider/useFieldArray and the shipped record/append Zod schemas. Strings remain strings
while edited; normalize KWD through `normalizeKwdInput`, parse with `parseMoney`, transport exactly three decimals.
Use `discountPercentage` from contracts for 0…10000 integer bps; never parse monetary input with Number/parseFloat.
The current request schemas deliberately leave performer counts/shares to server domain errors: do not claim
Zod alone validates SS-20. Form controls guide cardinality; the server remains authoritative for all invariants.

1…20 draft lines, with stable local row IDs independent of array position. Select services through orders-owned
hooks; repeated service IDs are allowed. On selection, set explicit `price` to catalog `price` once. Price stays
editable, including zero/above-list. A later catalog refresh cannot erase the user's override; server save-time
snapshots win. No tax, fee, payment, commission estimate, package redemption or saved-money editing in this screen.

Discount starts as AMOUNT `0.000`, switches between AMOUNT and PERCENT, and preserves the amount/numeric bps
entered for that mode without silent conversion/clamping. Show entered price, discount, draft net and the selected
recorder's effective limit/source, including “unlimited” and “not configured: 0%”. SS-Q4's same-% button writes
ordinary PERCENT inputs to every **unsaved** line; accepted rows are read-only. Lowered price also spends authority.
Never disable a mixed request just because one draft exceeds its limit: SS-Q6 permits other lines to save.
Per-line rejection displays server `effective_discount_bps`, `limit_bps`, `minimum_net` and `max_discount_amount`;
an already-too-low price needs raising, not just discount zero. Authority maxima remain orders-domain/server data.

**Share monetary primitives, not orders authority.** Baseline `session-pricing.ts` already delegates totals to
`@pospay/domain.sumMoney`, but line net/percent are orders-local. 35c-1 extracts their context-free money operations
into packages/domain with Arabic JSDoc; existing orders wrappers delegate and preserve SessionError mappings.
The browser uses those exact helpers plus parseMoney/moneyToString/sumMoney. Do not import API source into admin,
write subtraction/multiplication/reduce totals in React/model, or move effectiveDiscountBps/partition/limit resolution
to the kernel (ADR-0041 §3). Half-up 7.125 × 10% = 0.713 and net 6.412; the server rejects 1001 effective bps
at a 1000-bps limit. No floor/clamp “fix”. A provisional draft total is distinct from saved `session.total_net`;
after PARTIAL show saved total and separate unsaved draft total, never add rejected money to the saved visit.

Performers: choose 1…4 distinct employees in input order. Equal mode omits **all** `share_bps`, showing “equal split
automatically”; the response shows resolved bps, including 3334/3333/3333. Custom mode requires all shares as
positive integer bps totaling 10000; no mixed omissions, zero or duplicate performers. Use contract text conversion
for percentages; let the server validate the sum and show indexed errors, rather than rebuilding share allocation.
Unequal initial shares are allowed to reception (SS-Q7). No post-save share edit or employee-identity inference
from name/phone. Server SS-25 self-performer 403 aborts the request even for an unlimited owner.

Time: display “now” by default and send **omitted occurred_at** until explicitly changed, so the API chooses fresh
server time. A clock label can tick without mutating a pending body. Editing sends a UTC ISO instant interpreted
in the **business** timezone; show that zone. No new date library; follow attendance's civil-time conversion
pattern without importing its business-area model. Reject nonexistent/ambiguous wall times explicitly rather
than silently choose another instant; server time checks remain definitive. Allowed oldest instant is first of
previous calendar month, local midnight inclusive (October 15 → September 1), not 30 days. No manager-only late gate
or approval-status read. Future values up to 120 seconds normalize on the server; greater values fail.

SS-Q8 warnings identify each performer and occurred date, before submission when option facts are available and
again from saved response flags. Missing non-void clock evidence and approved full/partial leave warn, never block;
CLOSED/MISSED_OUT/MANUAL clock evidence counts. Late entry checks the occurred working day, not today's attendance.
Changing time refetches eligibility/warnings without silently replacing performers. Saved late badge uses
`session.late OR any session.lines[].late`; a late append can badge an originally on-time header. No client notice
or flag sent in the write; server accepted timestamps/flags replace the provisional display.

## 4. Writes, PARTIAL and retry state

Orders-owned TanStack Query hooks call the existing OpenAPI-typed `apiClient().POST`, parse shipped response schemas
and retain HTTP status plus bilingual error code/details. This repo generates schema.d.ts via openapi-typescript;
it does not generate React hooks automatically. Build thin hooks around that generated client, as use-services
does; no raw fetch in components, handwritten response types or assumed generated hook names.

Freeze an attempt at submit: validated body, request-index → local-row-ID map, company/business/branch/actor,
membership selection, exact route and one new Idempotency-Key. Disable double-submit and editing that attempt
while in flight/unresolved. Retry timeout/network loss/409 with that identical key/body/array order/route/actor;
never regenerate occurred_at. Keep automatic mutation retry disabled so recovery is explicit. A deliberate edit
after a definite rejection creates a new attempt/key. IDEMPOTENCY_KEY_REUSED 422 is not an all-discount refusal.

| Confirmed result | Editor/state transition |
|---|---|
| Creation 201 COMPLETE | Store authoritative session/total/warnings/late; remove saved drafts; show saved result |
| Creation 201 PARTIAL | Store returned session ID; use original request input_index map to retain only rejected drafts with errors; accepted IDs/revisions are read-only |
| Correction submit | POST `/service-sessions/{sessionId}/lines`, **new key**, body only `{lines,recorder_membership_id?}`; no customer/time/header fields, no saved lines |
| Append 201 PARTIAL/COMPLETE | Replace full visit with response.session; response.added_lines marks newly saved subset; retain only this attempt's rejections; repeat append to same visit |
| Creation 422 SESSION_DISCOUNT_ABOVE_LIMIT with details.rejected_lines | No session exists; keep all drafts, edit and retry **creation** with new key |
| Append all-rejected 422 | Existing visit remains saved; keep rejected drafts and retry **append** with new key |
| Other 400/403/422 | No partial success; preserve appropriate drafts, show membership/time/shares/reference/capacity/overflow/self/authority errors; refresh scope on authority loss |
| Network loss / retryable 409 | Outcome unresolved; original attempt remains frozen/replayable; no new visit or corrected write until replay settles |

Index is request-local, never persisted ordinal; identical service IDs cannot be used to match errors. Repeated
replay is idempotent in the UI too: merge saved lines by server ID, do not duplicate them or reinsert rejected rows.
Before append, keep original customer/occurred_at/date locked, refetch selected appender authority and respect
20 persisted lines including cancelled slots. Server capacity and fresh back-date-window failures remain visible.
A newly chosen service for the current saved visit can use the same append route; saved edits remain row 35d.

## 5. Ordered small PRs

File paths below are planned additions unless described as existing. `A` = `apps/admin/src/orders`,
`O` = `apps/api/src/modules/orders`, `C` = `packages/contracts/src/orders`, `L` = `packages/i18n/src`.
Every frontend PR adds component/hook tests beside its files and just its ar/en keys. No hand-written apps/pos edits.

| PR | Goal / independently deployable result | 1–3 subtasks | Files touched | Tests / expected hand-written size |
|---|---|---|---|---|
| **35c-1** | Shared money operations; unchanged server recording | 1. Extract generic net/percent helpers into kernel. 2. Delegate existing orders wrappers. 3. Independent numeric parity/error tests. | packages/domain/src/discount-money.ts, index.ts, __tests__/discount-money.spec.ts; O/domain/session-pricing.ts and its pricing tests; ADR-0041 technical addendum | Unit: zero/above-price/maximum, half-up and sum overflow; existing SS pricing suite. No component/e2e needed. **180–280 lines** |
| **35c-2** | Own recording context/limit GET | 1. Strict context contract/OpenAPI. 2. Query + read adapters/controller/wiring. 3. Authority/shape/EXPLAIN tests and ADR/map entries. | C/recording-context.ts, service-session-form-openapi.ts, contracts index/openapi; O/queries/recording-context.query.ts, persistence/recording-context.adapter.ts, http/service-session-form.controller.ts, orders.module.ts; API tests; ADR-0041, module-map.md/YAML; generated clients | Real DB: own/foreign candidates, ambiguous selection, zero/unlimited/unconfigured, DENY/expiry/feature, route mismatch, current limit; exact-query EXPLAIN. No UI yet. **300–450 lines** |
| **35c-3** | Limited service picker GET | 1. Paged options contract. 2. Catalog public reader + orders read adapter/route. 3. Scope/cursor/shape/EXPLAIN tests and exact map entries. | C/service-session-options.ts/OpenAPI; catalog/queries/session-service-options.query.ts and index.ts; O/queries/session-service-options.query.ts, persistence/session-service-options.adapter.ts, form controller/module; tests; ADR/map/generated clients | Real DB: business isolation, price/revision, cursor ties, empty/pages, denied record authority; no broad catalog read granted. **280–420 lines** |
| **35c-4** | Dated performer picker GET | 1. Minimal dated options contract. 2. Staff public reader + orders adapter/route. 3. Dated eligibility/warning/privacy/EXPLAIN tests and map entries. | C/service-session-options.ts/OpenAPI; staff/queries/session-performer-options.query.ts and index.ts; O/queries/session-performer-options.query.ts, persistence/session-performer-options.adapter.ts, form controller/module; tests; ADR/map/generated clients | Real DB: hire/contract/branch-date edges, occurred-day attendance/leave, manual/closed/void, no private HR fields, RLS/cursor/authority. **350–500 lines** |
| **35c-5** | Reusable customer entry/selection field with real scoped API | 1. Customer contract hook. 2. Required entry/selected masked card. 3. Component/hook tests and ar/en keys. | A/api/use-session-customer.ts; A/ui/session-customer-field.tsx; tests; L/service-session-catalog.ts, catalog.ts | Component: existing/new customer, changed text invalidates, error/opt-out, raw phone cleared; hook scope/payload; no directory invented. E2E covered in 35c-12. **200–320 lines** |
| **35c-6** | Tested service-line draft editor/picker | 1. Options hook. 2. Stable draft rows with explicit price prefill/edit. 3. Component/hook tests and keys. | A/api/use-session-services.ts; A/model/session-drafts.ts; A/ui/session-service-field.tsx, session-draft-lines.tsx; tests; L/service-session-catalog.ts | Component: duplicate services, add/remove row mapping, 20-row bound, catalog refresh preserves override, canonical money/above-list/zero. **220–350 lines** |
| **35c-7** | Amount/percent discounts, limit display and shared totals | 1. Context/membership hook and field. 2. Discount/same-%/summary components using shared money. 3. Boundary/component tests and keys. | A/api/use-recording-context.ts; A/ui/recorder-membership-field.tsx, session-discount-field.tsx, session-draft-summary.tsx; tests; L/service-session-catalog.ts | Component: own selection, unlimited/zero, 7.125/10%=0.713, lowered price rejection evidence, same-% unsaved rows only, no client authority clamp, large totals. **260–400 lines** |
| **35c-8** | Performer choices and optional custom shares | 1. Dated options hook. 2. Picker/share controls + nonblocking warnings. 3. Component/hook tests and keys. | A/api/use-session-performers.ts; A/ui/session-performers-field.tsx, session-performer-row.tsx; tests; L/service-session-catalog.ts | Component: 1/4 bounds, duplicate exclusion, omitted-all equal mode, explicit 70/30, server sum/mixed/zero errors, dated refetch and leave/clock warnings. **220–340 lines** |
| **35c-9** | Occurred-time field with server-now default | 1. Civil-time/UTC input adapter. 2. Editable timezone-labelled field. 3. Time/component tests and keys. | A/model/session-local-time.ts; A/ui/session-time-field.tsx; tests; L/service-session-catalog.ts | Component/model: default omitted, explicit UTC, business vs browser zone, oldest boundary, month/year, future error, unchanged replay input, nonexistent/ambiguous wall time. **180–280 lines** |
| **35c-10** | Create/append client hooks with safe attempt recovery | 1. Typed mutations/status parsing. 2. Frozen key/body/index map and pending journal. 3. Hook/recovery tests. | A/api/use-record-service-session.ts, use-append-service-session-lines.ts; A/model/session-attempt.ts, session-attempt-journal.ts; tests | Hook: exact headers/route/body, duplicate click, timeout/409 same-key replay, actor/scope purge, reload recovery/retention expiry, no phone storage. No public route yet. **220–360 lines** |
| **35c-11** | Complete/PARTIAL/all-rejected response handling | 1. Typed result state transitions. 2. Saved/read-only and rejected-draft feedback panels. 3. Transition/component tests and keys. | A/model/session-recording-result.ts; A/ui/session-saved-result.tsx, session-rejected-lines.tsx, session-write-feedback.tsx; tests; L/service-session-catalog.ts | Component/model: request indices with duplicate services, 201 mixed/repeated append/replay, 422 create vs append, distinct error codes, saved vs draft totals, line late OR header, both warnings. **300–450 lines** |
| **35c-12a** | Publish the working reception route | 1. Compose the page, form and use-session-recording hook. 2. Thin route, navigation and connectivity/identity lifecycle. 3. Component and hook tests. | A/pages/record-service-session-page.tsx, ui/record-service-session-form.tsx, model/use-session-recording.ts and tests; apps/admin/app/(dashboard)/orders/service-sessions/new/page.tsx, _frame/service-session-route.tsx, _frame/session-nav-item.tsx, dashboard-navigation.tsx; L keys | Component: permission denial, branch required, identity reset, offline notice, interrupted save of the same attempt, both new-visit actions, both locales. No Playwright. **300–450 lines** |
| **35c-12b** | Admin Playwright runner and the §6 e2e matrix | 1. Admin Playwright runner without CI wiring. 2. E2E matrix from §6. 3. Run it manually against a running local stack, the same way apps/pos does. | apps/admin/playwright.config.ts, tsconfig.e2e.json, package.json (`e2e`); e2e/service-session-access.pw.ts, service-session-record.pw.ts, service-session-reject.pw.ts, service-session-totp.pw.ts, service-session-transport.pw.ts, session-fixture.ts, session-state.ts, session-ui.ts, totp.ts, civil-date.ts, http-cookie.ts; apps/api/package.json (`e2e:seed`), scripts/seed-e2e-session.ts, seed-e2e-http.ts, seed-e2e-guard.ts, seed-e2e-catalog.ts, seed-e2e-membership.ts, seed-e2e-leave.ts (these replace the removed seed-e2e-tenant.ts); docs/runbook.md | E2E matrix in §6 against the real API. Both locales: amount COMPLETE, 7.125 at 10% refusal (discount 0.713 over max 0.712), PARTIAL then unfixed append 422 then a 5% append that keeps the original line id and occurred_at. Single locale: lost-201 keeps the fetched 201, replays the same idempotency key and the same session id, and the day list has exactly one visit with the expected line, in Arabic; one double-click writes one visit in Arabic; an aborted create stays unresolved, reconnect does not POST, and the visit is written only after an explicit retry of the original attempt, in Arabic; amount 5.000 create-all-rejected in English; yesterday + four equal performers + 5% + the asserted not-clocked-in warning, asserted on the 201 and the day list for all four performers (no negative control: a clock-in needs a paired device or a staff passkey, so the seed writes no attendance) + late append in English; price 24.000 (catalog 25.000) with amount 1.000, net 23.000 and custom shares 10/20/30/40 (1000/2000/3000/4000 bps) in Arabic. A 22.000 override is under the 10% floor (minimum net 22.500, effective discount 16.00%) and the product refuses it, so the override stays inside the limit. Enter submit, RTL, 390×844 in Arabic. Forbidden branch: the recording-context GET is matched on the other branch id and `x-company-id` and returns 403, and a create POST to that branch with the recorder session returns 403. Identity: the recorder's form stays open with an unresolved journal entry, another owner signs in on a second page of the same context, and the open form, customer draft, and retry panel are gone. Membership rows written as the application role inside `withTenant` (no API creates a non-owner membership): cashier membership `limit_bps` 1000, a second cashier membership `limit_bps` 500 on the same branch, and a viewer membership on the foreign branch. The membership test chooses the 500 bps row, shows 5.00%, and the saved session and line store that `recorded_by_membership_id` with `limit_bps_applied` 500 and `limit_source` PERSON. Approved leave is created and approved through `POST /v1/businesses/:b/employees/:e/leave-requests` and `POST …/:leaveId/decide`; the test sees `approved_leave_warning` and a 201 save. Dates come from the recording-context timezone and the 201 `business_date`. No CI wiring. Hand-written size: 1667 lines. |
| **35c-13a-1** | Recovery proof issued before every service-session write (ADR-0042 §1–§2) | 1. Table `service_session_recoveries` and its migration pair: PK `(company_id,id)`, unique `(company_id,user_id,operation,key_hash)`, tenant FKs, CHECKs, FORCE RLS split policies, `pospay_app` SELECT/INSERT/column UPDATE only, no DELETE. 2. Orders port + adapter that, in its own `withTenant`, re-checks place and record access and upserts the proof (`key_hash` = sha256 of the Idempotency-Key; `last_seen_at`; `expires_at = greatest(expires_at, now + 72 h)`) and commits **before** the business transaction; issue failure → 503 and no write. 3. Business date fixed at issue: create = the server-computed date of the request (`occurred_at` or the injected clock, FR-012, after validation); append = the target session's `business_date`. 4. Inside the business transaction, link `session_id` and `committed_at`; a rollback keeps the unlinked proof. | packages/db/schema/orders.ts, two migrations (numbered at merge), privileges allowlist; O/ports/session-recovery.port.ts, persistence/session-recovery.adapter.ts, persistence/service-session-transactions.ts, both write use cases, orders.module.ts; module-map exact path entries; tests | Real DB: cross-tenant read 0 rows / write error, immutable columns refused, grant allowlist; issue runs before the write (port order) and an issue failure writes nothing; replay extends `expires_at`; a create that crossed branch midnight (proof D, commit D+1); hand-set `occurred_at`; append inherits the session date; rollback keeps the proof unlinked; refused requests leave no proof. **350–450 lines** |
| **35c-13a-2** | Own recordings of the expired attempt's day — recovery read and confirm (SS-Q19, ADR-0042 §3) | 1. Contracts + OpenAPI for the read and the confirm; `x-recovery-key` header in CORS `allowedHeaders` and in the redaction list. 2. `GET …/branches/:branchId/service-sessions/recovery?operation=` under `record:service-sessions:branch`, orders feature, selected company, admin session; one query (`queries/session-recovery.query.ts`): proof by the unique index for `app_user_id()` + company/business/branch, unrevoked, unexpired, past `last_seen_at + 24 h`; date `coalesce(linked session.business_date, proof.business_date)`; sessions of that branch/date via `service_sessions_day_idx` with an active line `recorded_by = app_user_id()`; only those lines; `occurred_at`, customer name, masked phone, line names; 50 visits + `truncated`; `no-store`; `committed_at` never returned. 3. `POST …/service-sessions/recovery/confirm` `{operation,outcome}` sets `revoked_at`/`revoked_outcome`, audit_log, idempotent 204 (also expired/unknown). | C/service-session-recovery.ts + OpenAPI; O/queries/session-recovery.query.ts, use-cases/confirm-session-recovery/, http controller, module; apps/api/src/app.ts; packages/observability redaction; i18n error keys; tests | Real DB: FORBIDDEN (one code) for unknown key, another recorder, branch, tenant; NOT_YET before the gate; CLOSED after `expires_at` and after confirm; back-dated cross-month; never-committed create with `occurred_at` omitted (after reload) and never-committed append; foreign lines on the same visit hidden; confirm idempotent + audit row; result-shape test; EXPLAIN ANALYZE (unique index, day index, line index). **350–450 lines** |
| **35c-13** | Recorder clears an EXPIRED recording herself (SS-Q18) | 1. Journal: the recorder, in the same actor+scope, confirms an EXPIRED entry as «اتأكدت — اتسجلت» (RECORDED_ELSEWHERE) or «اتأكدت — متسجلتش» (NOT_RECORDED); both clear the EXPIRED marker, no manager; the only server call is a best-effort revoke of the recovery proof (ADR-0042 §4, #211): the marker clears locally first, one call with a short timeout, no retry, and a failure blocks nothing. 2. Result reducer: RECORDED_ELSEWHERE discards the recovered drafts and returns to IDLE (for an append, to the saved visit); NOT_RECORDED keeps whatever drafts are still in this tab editable so the next save uses a **new** idempotency key; after a reload the EXPIRED envelope carries no request body (session-attempt-journal.ts `expired()`), so the form starts empty and the recorder re-enters the services — no attempt-schema change. 3. Two buttons on the EXPIRED feedback panel, ar/en keys; the panel first shows when the save was attempted (the EXPIRED envelope keeps `createdAt`) and lists, inside the panel, the visits **this recorder** recorded in this branch on **that** business date, as resolved by 35c-13a-2 (a visit time she set by hand is already that date) — telling her to check them before choosing (SS-Q19, Waleed 2026-10-14, option 1). Accepted risks (owner's pick, SS-Q18), mitigated only by that check: a wrong «متسجلتش» can create a duplicate visit (the server's same-key replay protection has already lapsed after the 24 h retention, so reusing the old key would not prevent it either); a wrong «اتسجلت» discards the drafts and leaves the visit unrecorded, visible only in that list. | A/model/session-attempt-journal.ts, session-recording-result.ts, ui/session-write-feedback.tsx, api/use-own-recordings.ts, ui/session-own-recordings.tsx and their specs; L keys | Model: confirm only from EXPIRED and only for the same actor+scope; NOT_RECORDED with drafts still in the tab then save sends a new key and never the expired one; NOT_RECORDED after a reload leaves an empty form; RECORDED_ELSEWHERE leaves no draft and no marker; either confirmation revokes the recovery proof, and a read with it afterwards is refused; logout/scope change still clear (#198). Component: both buttons, the attempt date and the own-recordings list (empty, one, several), both locales. States (ADR-0042 §4): NEVER_REACHED (no `lastSentAt`, or FORBIDDEN — no call without `lastSentAt`, #210), NOT_YET, WINDOW_ENDED (CLOSED, #209), LIST (empty, one, several); both buttons enabled in every state; a failed revoke still clears. **250–380 lines** |

Order is the table order; 35c-12a merges only after 35c-1…11 and 35c-11b are green; 35c-12b follows 35c-12a; 35c-13a-1 (recovery proof), then 35c-13a-2 (recovery read and confirm), then 35c-13 (SS-Q18 exit) follow 35c-12b; the design is ADR-0042. 35c-5…11 are complete tested
form/client capabilities, not unfinished publicly exposed pages; they need no fake data or temporary executable
TODO. Never bundle the 35c PRs into one PR. No speculative day-list integration in the final PR.

**Owner answers, batch 17 (Waleed 2026-10-13; Abu Salem pending — his pick wins if different):**
- SS-Q14 = 1: a later service for the same customer is appended to the same visit while it is still open on the
  reception screen (existing append route); once the screen is closed it is a new visit.
- SS-Q15 = 1: service and performer pickers are alphabetical in the UI language with a search box. The option
  GETs take `lang` (`ar`|`en`, the UI language) and an optional `q` (1–50 chars, case-insensitive on name_ar/name_en, folded with ICU:
  `lower(name COLLATE "und-x-icu") LIKE '%' || lower($q COLLATE "und-x-icu") || '%'` with `%`/`_` escaped, since
  the C-locale `lower()`/`ILIKE` do not fold non-ASCII letters)
  and page in **name order**: `ORDER BY coalesce(name_<lang>, name_<other>) COLLATE "und-x-icu", id` (ICU collation: the database
  default is C/code-point order, so `lower()` alone does not alphabetize Arabic or accented names; the keyset
  comparison uses the same collation) (the displayed fallback, because name_ar is
  nullable) with an opaque keyset cursor encoding that same key and id, so the
  list is globally alphabetical across pages (never a per-page client sort). **35c-3b** (new, S): switch
  `/service-options` to this ordering and add `lang`/`q` (contract + query + tests, ~150–250 lines), merged before
  35c-6. 35c-4 ships `/performer-options` with the same ordering from the start. Row 8c extends the
  performer-options `q` to match the employee number as well (EN-Q9), with its contract/query tests.
- SS-Q16 = 1: after a COMPLETE save, show the saved summary with «New visit» (clears all) and «New visit, same
  customer» (keeps the selected customer) — part of 35c-11/35c-12a.
- SS-Q17 = 3: no reception-only "my saves" list; a manager who wants reception to see sessions delegates
  `read:service-sessions:branch` (SS-Q12). Nothing new to build in 35c.

## 6. UI, i18n and verification gates

Use existing packages/ui Input, Label, Select/NativeSelect, Button, Card, Badge, PageHeader and EmptyState;
lucide icons through that kit, no second library/custom component kit. Compose a customer header, unsaved service
cards, recorder limit/time fields, draft summary and submit action; after save show saved lines separately from
rejected editable drafts. Label every control, focus the first indexed error, announce save/partial/offline/warnings
with status/alert regions, support keyboard operation. CSS uses text-start, ps/pe/ms/me/start/end only; numeric
inputs/IDs can have dir=ltr inside the inherited ar RTL/en LTR document.

Add both languages to `L/service-session-catalog.ts`, following existing split catalog pattern and typed MessageKey
registration. Keys under `serviceSessions.*`: title, customer/name/phone/findOrCreate/selected, service/price/listPrice,
addLine/removeLine, discountAmount/discountPercent/samePercent, recorderMembership/limit/limitSource/unlimited/
notConfigured, performers/equalSplit/customShares/share, occurredAt/now/timezone/windowHelp, draftTotal/savedTotal,
save/saving/saved/partial/correctAndAppend/nothingSaved, maxDiscount/minimumNet, notClockedIn/approvedLeave/late,
offline/retryOriginal/unresolved/chooseBranch/forbidden/capacity. Reuse existing `serviceSessionErrors` messages and error
envelope localization; no new hardcoded JSX or duplicated API error strings. Keys ship with their consuming PR.
Use formatKwd/formatInstant; strings/rejection values stay canonical and lossless through locale switching.

Playwright belongs to **admin**, not the POS OTP test directory. Baseline admin has no Playwright runner: add the
existing workspace Playwright version/config in 35c-12b, pointing at a running built admin/API test environment;
no new framework. Component tests may mock generated client boundaries; at least one complete and one PARTIAL
→ append browser journey use real API/DB sessions, fake customer/employee identities and isolated tenants.
Transport failure/interleaving tests can intercept HTTP; a mocked 201 alone does not prove the financial flow.

E2E: individual admin login → branch → find/create customer → catalog prefill/price override → amount/percent →
1/4 performers/equal/custom → now/edited valid date → COMPLETE; mixed PARTIAL → edit rejection → append same
session (possibly another PARTIAL) with old saved IDs unchanged; creation/append all-rejected 422; 7.125 rounding
refusal; dated clock/leave warning still saves; late badge including late append; lost 201 response and same-key
replay without duplicate DB lines; double-click; offline toggle/reconnect without auto-write; forbidden branch,
membership ambiguity and identity replacement. Run Arabic/English/RTL keyboard and narrow viewport coverage.
Assert response/status, persisted single visit/accepted lines and unchanged original header, not only toast text.
No day-list permission, commission projection or bell-delivery test is required of this recording screen.

Each implementation PR runs `pnpm check`, docs lint, boundaries/cycles/module-map, contracts/OpenAPI generation
and client freshness (`pnpm --filter @pospay/admin api:check`), affected unit/component suites and builds. Read-API
PRs also run real-Postgres integration/isolation/EXPLAIN; final PR runs the browser matrix with server/DB assertions.
Regenerate every committed API client affected by new contracts, including POS schema.d.ts where the repository
freshness gate requires it (generated-only, no POS UI change). Preserve Arabic JSDoc on domain/ports exports,
400-line file/60-line function limits, and report hand-written versus generated size separately.

## 7. Owner question and handoff

**SS-Q13, answered (option 1, 2026-10-12)**, mirrored in [owner-questions.ar.md](owner-questions.ar.md): may a recording-permission
holder read only service names/prices, dated branch performer names/warning booleans and their own selected
membership limit for this form, without catalog/HR administration or whole-branch visit history? Option 1 is
recommended; option 2 retains separate broader read grants. No approval is inferred from SS-Q2 or SS-Q12.
Only the Claude Code orchestrator publishes a new numbered batch on the existing owner page and mirrors answers.
SS-Q12 (35b-1 history read) is answered and merged separately; no new offline decision is pending.

This design delivers the plan; SS-Q13 is answered (option 1) and 35c-2…4 implement its limited reads. 35c-1 ships the
shared money helpers with this plan.
