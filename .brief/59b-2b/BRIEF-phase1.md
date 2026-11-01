# 59b-2b — implementer brief, PHASE 1 of 3 (state layer + ID sweep reads)

Feature: 59b-2b «مجدول طلبات التقييم» — the per-company scheduler that walks rating requests and retries failed ones fairly. Dormant: nothing in ordinary startup runs it.
Base: `origin/main` 077d4a15 (59b-2a merged: dormant claim core).
The full approved design is pasted at the end of this brief (§D). Its Q1 is **answered**: Waleed picked option A, PP-98 «في Redis (المقترح)», 2026-11-01. PP-97 (registration backoff = `retryDelayMs(event.attempt)`) and dormancy are settled. Ignore every "PENDING / TODO(spec)" for Q1 in the design text.

This slice is delivered in three phases inside this same session. **Do phase 1 only, then stop and report.** The orchestrator runs the gates between phases and sends phase 2.

## R. Rules (each one is a stop condition)

1. Read and edit only inside this worktree. Never read `.git`, any `.env*`, or anything outside the worktree. No network.
2. Run no command: no shell, no git (no stash, commit, checkout), no tests, no builds. You only read and edit files. The orchestrator runs every gate.
3. Edit only the files listed in §P1. If you believe another file must change, stop and write it in your report instead.
4. Do not reformat unrelated code; do not squash lines to dodge `max-lines`. Limits: 300 warn / 400 error lines per file, 60 lines per function.
5. Follow `CLAUDE.md` and `CLAUDE.architecture.md` (read both first). Arabic WHY JSDoc on every exported `domain/**` function (description, `@param` each, `@returns`) and every `ports/**` method. No closing comments, no FIXME/HACK/XXX, no commented-out code.
6. No `Date.now()`, `new Date()` for "now", or `crypto.randomUUID()` in `domain/` or `use-cases/`. Business time comes from the injected `Clock`, IDs and tokens from the injected `IdGenerator` (`ports/clock.port.ts`). Lease and eligibility time inside Lua comes from Redis `TIME`.
7. No `packages/db/**` edit, no migration, no new dependency, no `package.json` change, no environment variable, no new feature flag.
8. No `child_process`, no `fs`, no `fetch`, no dynamic import, no file loading at runtime. Lua sources are TypeScript string exports.
9. Never put a secret, a token, or a phone number in code, tests or comments. Test data is synthetic.
10. Guessing a business rule is forbidden. If something is unclear, write `TODO(spec)` in your report and choose nothing.

## P1. Phase 1 scope (exact files)

`C` = `apps/worker/src/modules/customers`.

### P1.1 Pure policy — add `C/domain/rating-claim-scheduling.ts` and `C/domain/__tests__/rating-claim-scheduling.spec.ts`

Pure TypeScript, imports nothing outside `packages/domain` (prefer nothing at all). It holds:
- Budget constants and a validator: `FORWARD_VISITS = 75`, `RETRY_VISITS = 25`, `RETRY_CAPACITY = 2048`, `RETRY_BACKOFF_MS = 60_000`; the validator enforces F > 0, R > 0, F + R <= 100 (design §2.1).
- The settlement union `TERMINAL | ABSENT | FUTURE_UNATTEMPTED | RETRY | DELEGATED` (design §2.3) and a pure function that maps a post-claim observation (the request status read after 2a ran in the same transaction, or "absent", or "not attempted because future", or "unknown/error") to a settlement. Rules: SCHEDULED after an attempt → RETRY (this includes SKIPPED, TOKEN_UNAVAILABLE, NOT_DUE, RESCHEDULED); SENDING/SENT/CANCELLED → TERMINAL; committed absence → ABSENT; an error or unknown commit → RETRY, never TERMINAL (design §2.4 point 5).
- Reconsideration eligibility: next eligibility = `now + RETRY_BACKOFF_MS`; a stored future `due_at` never pushes it later than that cap (design §2.4, last paragraph before §2.5).
Unit tests use `test.each` for the variant tables. Name tests for the scenario (`scheduled_after_attempt_is_retried`, ...).

### P1.2 State port — add `C/ports/rating-claim-state.port.ts`

The single new port `RatingClaimState` with the §2.3 methods: `acquire`, `renew`, `release`, `begin`, `enrollPage`, `reserveRetries`, `settlePage`, `settleRetry`, `finish`, plus `read` (a snapshot for recovery after a lost reply). Every mutation takes the fence `{ companyId, incarnation, expectedVersion, ownerToken }` except `acquire`. Every result is `{ code: 'OK'|'BUSY'|'STALE'|'MISSING'|'CORRUPT'|'LIMIT'|'OVERFLOW', version, value? }`. One Arabic line per method (what it returns and why the scheduler needs it). Tokens and incarnations are passed in by the caller (from `IdGenerator`), never generated in the adapter.

### P1.3 Redis adapter — add `C/persistence/redis-rating-claim-state.ts` and five Lua files

- `C/persistence/rating-claim-state-acquire.lua.ts`, `...-lease.lua.ts`, `...-sweep.lua.ts`, `...-reserve.lua.ts`, `...-settle.lua.ts`, each one `export const ... = \`...\`` holding Lua source.
- Follow the existing worker precedent `apps/worker/src/modules/notifications/persistence/redis-send-admission.ts` for how Lua is called with ioredis (read it first). Use EVALSHA and fall back to EVAL on NOSCRIPT.
- One STRING key per company, `<prefix>:rating-claims:v1:{<companyId>}:state` (§2.2). Validate the prefix (non-empty, no `{`/`}`/whitespace) and the company UUID in the adapter before building the key.
- State is versioned JSON (`schema=1`), at most 1 MiB encoded, with no TTL. It holds IDs, counters, timestamps and enums only, never a customer ID, phone, token hash or message data (§2.2 table).
- Each script validates schema, sizes, company, incarnation, version, lease and operation identity before any mutation, computes the full replacement, checks its encoded size, then makes exactly one `SET` (§2.3). Every accepted mutation increments `version`.
- Lease 120 s, renewal ceiling turn start + 180 s (§2.2). An expired owner can neither renew nor release.
- CORRUPT or unknown schema is never overwritten automatically (§2.3 last paragraph).
- A command timeout is the caller's concern; the adapter takes an ioredis client that the module builds (the module wiring is phase 2, so don't touch `customers.module.ts` yet).

### P1.4 Sweep reads — change the claim repository and transactions

- `C/ports/rating-claim.repository.ts` and `C/persistence/rating-claim.repository.ts`: **remove** `due(...)` and the `DueRatingCursor` type (nothing else in `main` uses them; the only caller is the transactions adapter below). **Add**:
  - `upperId(tx, companyId): Promise<string | null>`: design §4 "Capture H" SQL.
  - `pageIds(tx, companyId, after: string | null, through: string, limit: number): Promise<readonly string[]>`: design §4 "Forward page" SQL. When `after` is null, omit the lower predicate entirely (no nullable OR). No status or due filter, no `FOR UPDATE`, no OFFSET.
  - `findRequest(tx, companyId, requestId): Promise<DueRatingRequest | null>`: design §4 point read with the existing `REQUEST_COLUMNS`, no lock.
  - Keep `lockCustomer`, `lockRequest`, `reschedule`, `cancel`, `claim`, `snapshotPerformers` byte-for-byte unchanged.
- `C/ports/rating-claim-transactions.port.ts` and `C/persistence/rating-claim.transactions.ts`: replace `due` and `claim` with:
  - `upperId(companyId)`, `pageIds(companyId, after, through, limit)`: each in its own `withTenant` transaction.
  - `withRequest(companyId, requestId, work: (tx, request: DueRatingRequest | null) => Promise<T>): Promise<T>`: one `withTenant` transaction; it reads the request with `findRequest`, passes it to `work`, and resolves only after commit (design §2.4 point 2 and the paragraph under point 6).
  - Every `withTenant` call here passes `{ timeoutMs: 1000 }` (design §2.4, "Proposed execution limits"). `withTenant`'s `TenantOptions.timeoutMs` already sets the server-side statement, lock and idle limits; do not add your own `set_config`.
  - Nothing else in `main` calls `transactions.claim`; if you find a caller, stop and report it.

### P1.5 Tests for phase 1

- Unit: the domain spec above.
- Redis integration: add `C/persistence/__tests__/redis-rating-claim-state.spec.ts` against a real Redis. Copy the connection default from `apps/worker/src/modules/staff/jobs/missed-out.processor.spec.ts` (`REDIS_URL` or the local dev URL). Each test uses a unique key prefix built from the injected-style test ID generator and deletes only its own keys in `afterEach`. **Never** FLUSHDB or FLUSHALL. Cover: acquire on missing state, BUSY against a live owner, takeover after lease expiry, STALE version, a stale fence after recreation (`recreated_state_rejects_all_old_fences` at adapter level: delete the key, re-acquire with a fresh incarnation and the same numeric version, and the old fence is rejected), `enrollPage` validation (increasing unique IDs inside `(cursor, H]`, count <= F), `reserveRetries` ordering by oldest ticket with tail requeue, OVERFLOW at a lowered capacity, CORRUPT state left untouched, and an expired owner unable to renew or release. Use real expiry through a short lease injected for tests, or Redis TIME arithmetic; no sleeps longer than needed and no timing guesses where a barrier works.
- Query shape: add `apps/worker/src/rating-claims/__tests__/rating-claims-query.spec.ts` (`query_shape_and_explain_use_company_primary_key`, design §4 table and §6). Use the existing fixture `apps/worker/src/rating-claims/__tests__/rating-claims.fixture.ts` (read it; do not change its public API). Seed a terminal/future/due/history mix across two tenants and assert projections, bounds and `EXPLAIN (ANALYZE, BUFFERS)` plans: Index (Only) Scan on `rating_requests_pkey`, no Seq Scan, no Sort, no LockRows. Do not set `enable_seqscan`.

## P2/P3 (not now)

Phase 2: the two-lane `claim-rating-requests` use case, the processor with ID-only jobs and PP-97 registration backoff, the strict `{companyId}` contract, and the closed wiring in `main.ts`/`customers.module.ts`/`index.ts`. Phase 3: the acceptance suites in design §6. You will get each brief here.

## Report (end of phase 1)

List every file you added or changed with one line each, the exact `RatingClaimState` method signatures, every place you deviated from the design and why, and every `TODO(spec)`. Then stop.

## D. The approved design (verbatim)

# 59b-2b design — rating-claims scheduler and bounded retry fairness

Date: 2026-11-01. Status: concrete design recommendation; Q1 PENDING / TODO(spec), not implementation admission.

## 1. Scope and evidence

Source inspected read-only: `C:/Users/waleed_Mohamed/.t3/worktrees/main/t3-08ca6af2`, branch `feat/059b-2-rating-claim`, verified HEAD `0b413899ebc81cef238ab988d44c3c526dbf094e`.
The governing input is `PR750-SPLIT-PLAN.md`, especially §§4.2, 7, 8.1–8.2 and 15–16. This design follows §16.1 and rejects F0 + A-time.
Owner decisions supplied with this assignment supersede the plan's older pending wording: PP-97 fixes registration backoff only here; 2a merges first and dormant; live claims stay closed until 59b-3 sending is ready.
No repository file was changed. No database, Redis, network, application test or EXPLAIN was run; no `.env*` file was read. Plans below are expectations to verify, not measured evidence.
Questions below are draft handoff material. The orchestrator must record and route them; this assignment expressly forbids editing repository audit files.

## 2. Chosen mechanism

Choose S1 with a finite immutable-ID sweep, recoverable forward-page journal and a separate bounded retry lane. PostgreSQL remains authoritative for business state and at-most-once claim. Redis coordinates reconsideration only.

### 2.1 Budgets and traversal

- Nominal company scheduler interval: 60 seconds; queue `rating-claims`, scheduler `rating-claims-<companyId>`.
- Proposed defaults: F = 75 forward row visits, R = 25 retry visits per successful service turn; F > 0, R > 0, F + R <= 100. Neither lane borrows the other's reservation. Each page is at most F, hence at most 100.
- F counts **all traversed rating_requests rows**, including terminal and future rows. This bounds database work without a new index; it is not a promise of 75 due claims per minute.
- At sweep start capture H, the largest visible request ID for that company. Persist H, a fresh sweep ID and a null cursor. Traverse `cursor < id <= H` in ascending UUID order. Never use mutable `due_at` as continuation identity.
- IDs are immutable; UUID order need not equal commit order. H is a key bound, not an MVCC membership snapshot. Inserts committed behind progress and future rows becoming due after their visit belong to the next sweep.
- Finish the sweep before recapturing H. No time reset, page-count reset or reset on visit triggers. New IDs above H cannot extend the current sweep. Repeat sweeps even without new visits.

### 2.2 Redis key and state

One STRING key per company: `<prefix>:rating-claims:v1:{<companyId>}:state`. Prefix is deployment-scoped and validated; company UUID is canonical. BullMQ keys use the supplied prefix but remain BullMQ-owned.
One key avoids partial eviction of separate cursor/retry structures. Store versioned JSON, capped at 1 MiB encoded; scripts compute and validate the whole replacement before one final SET.
State holds IDs, counters, timestamps and protocol enums only: no customer ID, phone, token/hash, message parameters or payload.

| Component | Fields and bounds |
| --- | --- |
| Header | `schema=1`, `companyId`, `incarnation`, `version`, `ownerToken`, `leaseUntil`, `turnStartedAt`, `nextTicket` |
| Sweep | `sweepId`, `upperId`, `cursorId`, `phase=IDLE|SWEEP`, bounded counters/timestamps |
| Page | At most one `{pageId,sweepId,fromId,throughId,exhausted,entries:[{requestId,workToken}]}`; at most F entries |
| Retry | Map keyed by request ID; K = 2,048 entries maximum, each `{eligibleAt,ticket,workToken?,ownerToken?,leaseUntil?}` |
| Overload | Counters, `overflowSince`, `reconcileRequired`, last completed reconciliation sweep ID; no growing ID/error list |

Incarnation and owner/page/sweep/work tokens come from the injected IdGenerator, never `randomUUID()` inside a use case. Missing-state creation always uses a fresh incarnation, never one reconstructed from job data.
Versions/tickets are exact integers within the JavaScript/Lua safe-integer range. Approaching its limit fails closed with a diagnostic and controlled reinitialization; never wrap.
State has no TTL. Ownership expires through stored timestamps. Proposed lease: 120 seconds, renewal every 30 seconds, maximum ownership per turn: 180 seconds. These are technical defaults, not SLA values.
Lua uses Redis TIME for leases/eligibility; 2a uses its injected business Clock after the customer/request locks. Never compare Redis lease time to a business deadline.
Every mutation requires `(companyId,incarnation,expectedVersion,ownerToken)` and an unexpired lease, except acquire below. Every accepted mutation increments version. An expired owner cannot renew or release even before a successor acquires.
The adapter serializes renewal/completion commands and propagates returned versions. It never blindly replays a stale mutation with a new version; page/work tokens must still identify the exact pending operation.
These fences do not cancel an already-running PostgreSQL transaction. 2a's locks and guarded SCHEDULED update remain authoritative for safety.

### 2.3 Lua contracts

All scripts receive one adapter-derived key and a validated envelope. Check schema, lengths, numeric limits, company, incarnation, version, lease and operation identity before mutation. Return `{code,version,value?}` with `OK|BUSY|STALE|MISSING|CORRUPT|LIMIT|OVERFLOW` as applicable.
OVERFLOW is a recorded fallback transition, not an exception pretending enrollment succeeded. Transport failure/unknown reply never authorizes advancement or acknowledgement.

| Script / state-port method | Input and atomic effect |
| --- | --- |
| `acquire` / `acquire(companyId,newIncarnation,ownerToken)` | Absent: create empty state, fresh incarnation, version 1. Present: preserve progress; reject live owner, otherwise assign fresh owner, invalidate old entry ownership and increment version. Return state/fence; never overwrite an existing incarnation. |
| `lease` / `renew(fence)` or `release(fence)` | Check full fence and Redis TIME. Renew only up to turn start +180s; release only matching owner, never progress/retries. Missing state stays missing. |
| `sweep` / `begin(fence,sweepId,H)` | Require IDLE and no journal; capture H once. Null H completes an empty sweep. Never replace an active sweep. |
| `sweep` / `enrollPage(fence,sweepId,fromId,pageId,entries,exhausted)` | Entries contain request IDs and injected fresh work tokens. Require matching cursor/H and no journal; validate increasing unique IDs in `(cursor,H]`, count <= F. One SET stores the complete journal and advances cursor to last ID; an empty end page records exhaustion. No claim starts before success. |
| `reserve` / `reserveRetries(fence,limit,workTokens)` | Select <=R eligible unleased/expired entries by oldest ticket; assign supplied fresh work tokens and owner lease; return IDs/tokens. Expired reservations retain tickets. Never delete on reservation. |
| `settle` / `settlePage(fence,pageId,workToken,settlement)` | Remove only matching journal item after known DB outcome or retention of a failed/uncertain attempt. SCHEDULED/unknown inserts a deduplicated retry; K/byte overflow records OVERFLOW/reconciliation before releasing item. Existing retry keeps its earlier ticket/eligibility. |
| `settle` / `settleRetry(fence,requestId,workToken,settlement)` | Require matching entry lease/token. Confirmed terminal/absent removes it; SCHEDULED/unknown requeues at Redis TIME +60s with a new tail ticket. Unknown commit never means terminal. |
| `sweep` / `finish(fence,sweepId)` | Require exhausted scan and empty journal; return to IDLE, preserving retries. Clear reconciliation only after a full subsequent sweep without overflow; retain cumulative evidence. |

Initialization is scripted too: no GET-then-SET race. Scripts are bounded by F/K and validate encoded size before SET. Use EVALSHA with NOSCRIPT fallback to EVAL; loading a script is not state recovery.
Settlement is an explicit union: `TERMINAL`, `ABSENT`, `FUTURE_UNATTEMPTED`, `RETRY`, `DELEGATED`. Only page settlement accepts FUTURE_UNATTEMPTED/DELEGATED; DELEGATED checks the retry map atomically. No error text enters this union. CORRUPT/unknown-schema state stops that company's execution and requires controlled quiescent reinitialization, never an automatic overwrite.
The simple JSON representation scans/sorts at most K entries for reservation and serializes bounded state per mutation. Benchmark O(K) CPU, bytes and replication cost before activation; do not call it constant-time. Changing representation later needs a versioned protocol and the same fencing tests.

### 2.4 Service turn and crash boundaries

1. Acquire ownership; BUSY exits without changing progress. Resume any journal before reading another page. Service up to R due retries and up to F forward visits, sequentially, in separate reserved lanes.
2. Each retry uses a point-read tenant transaction. Read current request, invoke 2a only if SCHEDULED and due, reread resulting status in that same transaction, then commit before Redis settlement. No Redis I/O holds a DB connection.
3. If IDLE, capture H and begin. Read <=F IDs using §4, commit the read transaction, then enroll with CAS. Discard a stale page response; never claim unenrolled work.
4. For journal IDs already in retry state, use a fenced DELEGATED settlement only if the retry still exists; leave it untouched. Otherwise use the same point-read/claim transaction. Terminal, absent and future rows consume forward visits; unattempted future rows stay covered by the next sweep.
5. Every attempted row still SCHEDULED remains retryable, including SKIPPED, TOKEN_UNAVAILABLE, NOT_DUE and RESCHEDULED. Exceptions/unknown commits are retryable. NOT_FOUND is terminal only with committed absence; an unexplained SCHEDULED row stays retained and diagnosed.
6. Finish a short page or cursor reaching H only after the journal drains; release ownership. A recovered partial page uses the next turn's forward budget; do not process it plus a new F-sized page. Both lanes retain positive service when available.

`withRequest(companyId,id,work)` returns a post-work summary only after commit. An unlocked initial read supplies the customer identity for 2a; the existing customer-then-request lock order stays unchanged. Redis stores no customer identity.
Not-yet-due retries are reread/requeued without claiming. Eligibility is capped at the next 60-second retry interval, so an obsolete future due time cannot defer reconsideration indefinitely; the full sweep also covers moved-earlier rows.
If a script reply is lost, reread state and check the exact page/work token before retrying; do not create a different page after unknown enrollment success.
Crash before enrollment leaves cursor unchanged; after enrollment leaves recoverable journal. Commit-before-ack reconsiders terminal state, producing no second ready event. Atomic SET leaves either pending work or complete settlement.
Per-row errors do not abort the remaining page. Remove continuation-bearing `RatingClaimsFailedError` and `job.updateData(after)`; report sanitized codes/counts. Registration never writes progress.
Proposed execution limits: 1,000 ms server-side timeout per page/capture/individual tenant transaction; 500 ms command timeout for scheduler-state Redis operations. A state-command timeout ends the turn without same-turn blind retries; journals/reservations remain recoverable. Allow at most one active tenant transaction per flow and drain it before starting another. Capacity testing must show both full budgets fit the 180-second ownership ceiling; otherwise revise these defaults and Δ before activation. Do not shorten a budget silently.

### 2.5 Overload and recovery

Deduplication includes leased retries. Reserve maximum page/header space before admitting K retries; enforce encoded bytes as well as count. Page enrollment cannot fail merely because retries occupy their allowed capacity.
At retry capacity, keep attempting forward work. If it remains SCHEDULED, record overflow and release the journal item to full-sweep reconciliation. Never evict an admitted retry, cancel a request, extend deadlines or suspend forward scans for retry capacity.
Overflow IDs remain discoverable in PostgreSQL but lose the fast retry bound. Emit `RATING_CLAIMS_OVERFLOW`, counts, oldest retry age, last completed sweep and reconciliation flag; no per-request metric labels or sensitive payloads. Clearing the flag requires a later complete sweep without overflow.
Unbounded N or service delay is a capacity incident: withdraw latency claims, report it and continue bounded turns. If Redis refuses all writes, execute no new unenrolled work; only already-started DB transactions may finish.
If state is lost but scheduler survives, next turn creates a new incarnation and rescans. PostgreSQL prevents duplicate claims; fast retry history/bounds restart only after reenrollment.
If schedulers are lost too, visit triggers are insufficient: recovery must use a complete authorized company inventory, call idempotent public `ensureRegistered(companyId)` for every company, and verify schedules even without new visits. This method writes only `{companyId}`, never resets existing state.
2b supplies/tests that capability; 2c owns inventory/replay runbook integration and rollout recovery. No runtime cross-tenant enumeration, new dispatcher privilege or BYPASSRLS role. Without completed 2c recovery readiness, recovery time is unbounded and live activation stays closed.
Redis rollback may restore formerly valid fences; Lua alone cannot detect invisible rollback/split brain. PostgreSQL still prevents duplicate claims. Recovery must quiesce old workers, drain/terminate outstanding transactions, recreate states with fresh incarnations and re-register from inventory before resuming. Undetected rollback is explicitly outside the fencing/liveness assumptions.

## 3. Conditional progress argument

- F/R: positive reserved per-turn forward/retry budgets.
- Δ: maximum interval for a company to receive and **complete** effective service, including scheduler delay, both lanes, query/transaction timeouts and lease recovery. Nominal 60 seconds does not establish Δ.
- N: upper bound on all rows encountered through H in any sweep, including history/future rows and late inserts in the remaining key range; not merely count at capture.
- Q >=1: bounded retry visits ahead of and including the target after eligibility, including older delayed tickets that mature and expired reservations. Conservatively Q<=K; failures/new work get tail tickets.
- B = `(ceil(N/F) + 2) × Δ`, allowing sweep transition turns; b =60s is reconsideration backoff, separate from outbox registration backoff.

Required assumptions:

1. Scheduler exists; workers fairly service both lanes; total company load supports Δ. Outage/registration/operator delays have separate bounds.
2. Redis has one authoritative history during the bound: no eviction, lost/rolled-back acknowledged writes, split brain or recreation. Lua execution fits service budget.
3. SQL, lock waits and commit ambiguity resolve within timeout/recovery budgets. Δ includes bounded crash/lease-recovery disruption; infinite crashes/hangs violate it.
4. N bounds current and next sweeps; IDs never mutate; inserts in a remaining range are finite. Sustained arrivals can increase later N and must be included explicitly.
5. Fast retries fit K/byte cap and Q. Successful claiming also requires available locks/token/day state, enabled requests, no opt-out and a live deadline.
6. Business clock skew is operationally bounded; clock-after-lock/deadline rules remain binding. Reconsideration is not successful sending.

A continuously visible row ahead of cursor and <=H is visited within B: each page advances strictly; failures cannot reset progress.
A row inserted/moved/becoming due behind progress is reconsidered within at most `2B + Δ` (remaining current sweep plus next-sweep position/alignment), assuming continuing visibility. This also bounds overflow reconciliation, not fast retry.
An admitted retry is reconsidered within `b + ceil(Q/R) × Δ`. Requeued failures go to the tail, preventing permanent head domination. Retries consume no F budget.
After state loss, add outage plus bounded authorized inventory/re-registration time D, then at most `2B + Δ`. Without bounded D no wall-clock recovery promise exists.
A deadline is attainable only when its remaining window exceeds the relevant bound plus sender latency and prerequisites hold. No universal 11-minute or 30-minute guarantee.

**1,200-row check:** all 1,200 stay SCHEDULED/due/token-unavailable, with fixed ample deadlines. F75/R25 reaches the original tail in 16 full forward turns; B conservatively allows 18Δ. No ten-minute reset. The conservative retry bound at Q<=1,200 is `60s + 48Δ`, not a send-window promise. K2,048 fits the backlog; a smaller test K uses explicit overflow reconciliation. Enabling tokens eventually yields one ready event per claimable row, never two.

## 4. Queries and expected EXPLAIN

All queries use pospay_app through `withTenant(companyId, ...)`, explicit tenant predicates and existing forced RLS. One connection per execution flow, never nested/concurrent transactions. Reads belonging to an individual claim share its transaction; Redis executes outside it.

Capture H once:

```sql
SELECT id FROM rating_requests
WHERE company_id = $1::uuid
ORDER BY id DESC LIMIT 1;
```

Forward page (first page omits the lower predicate entirely, not a nullable OR):

```sql
SELECT id FROM rating_requests
WHERE company_id = $1::uuid
  AND id > $2::uuid AND id <= $3::uuid
ORDER BY id ASC LIMIT $4; -- F <= 100
```

Do not add status/due filters: an ID-index seek with residual filtering could inspect unbounded history to find F matches. For each page/retry ID, read:

```sql
SELECT id, business_id, customer_id, business_date::text AS business_date,
       branch_id, due_at, send_deadline, status
FROM rating_requests
WHERE company_id = $1::uuid AND id = $2::uuid;
```

After invoking 2a, a status/due/deadline point read in the same transaction supplies settlement evidence. These are command-orchestration reads in persistence, not a new read endpoint.
Retain individual customer `FOR NO KEY UPDATE`, then request `FOR UPDATE SKIP LOCKED`, both by tenant/key; Clock after locks, guarded UPDATE, performer snapshot and outbox in that transaction.
Remove page-level `FOR UPDATE SKIP LOCKED`: its short-lived locks were released before claims and could hide a candidate. No OFFSET, scan locks, unbounded lists or cross-tenant access.

| Step | Expected plan on representative analyzed data |
| --- | --- |
| Upper bound | Limit over Index Only Scan Backward on `rating_requests_pkey`, company index condition; Index Scan Backward also acceptable |
| Page | Limit over Index Only Scan on `rating_requests_pkey`, company plus ID bounds as index conditions; no Sort, Seq Scan or LockRows; heap fetches depend on visibility map |
| Point read | Index Scan on `rating_requests_pkey`, at most one visible row; individual locking queries add LockRows over point scans |

The partial `rating_requests_due_idx(company_id,due_at,id) WHERE status='SCHEDULED'` does **not** satisfy ORDER BY id; the existing primary key `(company_id,id)` does. This all-row traversal needs **no migration**, new table, RLS policy or grant. Keep the due index for existing consumers.
Add result-shape and EXPLAIN ANALYZE/BUFFERS tests for first/subsequent pages and bounds with substantial terminal/future history. Do not force `enable_seqscan=off`. If plans/capacity fail, revise Q1/design before admission; do not silently add an index or claim measured performance.

## 5. Exact implementation file scope and ports

This is a proposed future 2b edit manifest after merged 2a, not changes made by this task. `C` expands to `apps/worker/src/modules/customers`; `T` expands to `apps/worker/src/rating-claims/__tests__`.

| Action | Exact files | Responsibility |
| --- | --- | --- |
| Add | `C/domain/rating-claim-scheduling.ts`, `C/domain/__tests__/rating-claim-scheduling.spec.ts` | Pure budget/retry/settlement policy, protocol-neutral types |
| Add | `C/ports/rating-claim-state.port.ts` | Sole new port, RatingClaimState: §2.3 methods plus read/snapshot; network boundary and deterministic crash tests justify it |
| Add | `C/persistence/redis-rating-claim-state.ts` | Key/codec validation, script adapter, serialized renewal/completion |
| Add | `C/persistence/rating-claim-state-acquire.lua.ts`, `C/persistence/rating-claim-state-lease.lua.ts`, `C/persistence/rating-claim-state-sweep.lua.ts`, `C/persistence/rating-claim-state-reserve.lua.ts`, `C/persistence/rating-claim-state-settle.lua.ts` | Five Lua sources as TypeScript string exports, no runtime file loading/new library |
| Change | `C/ports/rating-claim.repository.ts`, `C/persistence/rating-claim.repository.ts` | Replace due/cursor paging with `upperId`, `pageIds`, `findRequest`; preserve individual 2a claim methods |
| Change | `C/ports/rating-claim-transactions.port.ts`, `C/persistence/rating-claim.transactions.ts` | Tenant upper/page reads, `withRequest(companyId,id,work)` with committed summary, bounded server-side timeout |
| Change | `C/ports/rating-claim-diagnostics.port.ts`, `C/persistence/rating-claim-diagnostics.ts` | Sanitized overload, CAS-loss, sweep/retry-age diagnostics |
| Add/change | `C/use-cases/claim-rating-requests/claim-rating-requests.ts`, `C/use-cases/claim-rating-requests/__tests__/claim-rating-requests.spec.ts` | Two-lane orchestration through ports; no job continuation |
| Add/change | `C/jobs/rating-claims.processor.ts`, `C/jobs/__tests__/rating-claims.processor.spec.ts` | ID-only transport, registration, PP-97; three visit triggers, no discovery trigger yet |
| Change | `C/customers.module.ts`, `C/index.ts` | Sole adapter binding; public runtime lifecycle/ensureRegistered factory, no repository/use-case exports |
| Add/change | `packages/contracts/src/customers/rating-claims.ts`, `packages/contracts/src/customers/index.ts`, `packages/contracts/src/__tests__/rating-claims.spec.ts` | Strict `{companyId}` job, no after/discovery/HTTP contract |
| Add/change | `apps/worker/src/main.ts`, `apps/worker/src/rating-token-capability.ts`, `apps/worker/src/shared/otp-startup.spec.ts` | Closed runtime wiring and token-reader extraction without activation |
| Change | `T/rating-claims.fixture.ts`, `T/rating-claims-scheduler.spec.ts`, `T/rating-claim-diagnostics.spec.ts` | Preserve 2a fixture API; add real 2b composition/registration/diagnostics only |
| Add | `T/rating-claims-fairness.spec.ts`, `T/rating-claims-fencing.spec.ts`, `T/rating-claims-crashes.spec.ts`, `T/rating-claims-query.spec.ts`, `T/rating-claims-non-delivery.spec.ts` | Acceptance matrix below |
| Change | `docs/adr/0010-phase-1-ports-and-events.md`, `docs/specs/060-ratings-and-staff-app/spec.md` | Mechanism, assumptions, dormancy, acceptance and later accepted Q1 |
| Orchestrator only | `docs/specs/060-ratings-and-staff-app/owner-questions.ar.md` | Record Q1/answer before implementation; not edited by this task |

No new cross-module arrow, packages/db edit, retry-policy edit, environment file, migration, discovery event/consumer, replay helper or recovery runbook edit belongs to 2b. PP-97's six precedent processors stay untouched.
Clock/IdGenerator/RatingClaimTransactions/RatingClaimRepository/RatingClaimDiagnostics are reused/extended as above; no other new port. Arabic WHY documentation is mandatory on domain/port exports. Redis/Lua stay outside domain/use-cases; module composition binds concrete adapters.
Strict validation rejects legacy `after` job data; it is never progress authority. Before activation, inventory/re-register templates and handle only identified obsolete rating jobs under the authorized rollout procedure. Never assume all candidate queues were empty.

## 6. Acceptance tests (to implement, not receipts)

Real tests use an ADR-0006 clone in the owning private DB lane and a unique Redis prefix per test/repetition. Two-worker tests start two independent BullMQ Worker instances; concurrency=1 per instance is not the fence. Drain/close both, clean only owned keys/prefix; never FLUSHDB/FLUSHALL. Use barriers/hooks, not timing guesses.

| Named test | Setup and assertion |
| --- | --- |
| `retained_1200_reaches_tail_without_epoch_reset` | 1,200 due rows, tokens unavailable, F75/R25: original tail reached within bound, no ten-turn reset, admitted retries retained; restore tokens, exactly one ready event per eligible request. |
| `sustained_arrivals_do_not_extend_captured_sweep` | Insert above H every turn, repeated leading failures: fixed H, original tail reached, both budgets honored, next sweep admits arrivals; fixture states N/arrival assumptions. |
| `late_commit_and_insert_behind_cursor_join_next_sweep` | Hold an insert uncommitted across capture/page, commit after its ID was passed; also insert smaller ID: both reconsidered within 2B+Δ, not claimed as snapshot members. |
| `moved_earlier_and_future_due_are_reconsidered` | 59-1 moves due_at earlier after forward visit; another future row becomes due: bounded next-sweep/capped-retry visit, unchanged ID progress. |
| `locked_page_candidate_is_enrolled` | Another transaction holds request lock: discovery still includes ID, individual claim skips/times out, retry retained; release lock, one claim/event. |
| `two_workers_expired_owner_cannot_regress_state` | Hold A beyond 60s and lease expiry; B advances, A resumes: stale page writes, settlements, renewals/releases rejected; bounded recovery and one event per successful claim. |
| `recreated_state_rejects_all_old_fences` | Delete only test company's state while A holds work; B recreates with fresh incarnation/same numeric version: A cannot mutate or delete B state, including retry ack. |
| `crash_before_and_after_page_enrollment` | Crash after SELECT/before CAS, after CAS/before claim, and lose successful CAS reply: unchanged cursor or full recoverable journal; pageId reconciliation prevents loss. |
| `crash_at_db_commit_and_settlement` | Rollback, uncertain commit, commit-before-ack, lost ack reply, completion after takeover: retain uncertainty, one committed claim/outbox event, no premature removal. |
| `retry_failures_rotate_and_preserve_forward_budget` | SKIPPED/TOKEN_UNAVAILABLE/errors including permanent oldest failure: tail tickets, finite Q bound, continuing F visits, deduplication including leased retries. |
| `retry_saturation_uses_reported_reconciliation` | Lower K/byte cap to saturate: forward continues, overflow evidence/flag set, no admitted retry eviction, overflow rows revisited by sweep; assert weaker sweep bound only. |
| `lost_scheduler_recovers_without_new_visit` | Remove test-owned scheduler/state; supply complete authorized fixture inventory to ensureRegistered, no visit: both companies registered, fresh state, eligible claims recover. Production inventory/runbook integration stays 2c's release gate. |
| `null_and_expired_deadlines_keep_2a_semantics` | Null stored/recomputed deadlines not expired; expired due rows cancel PAST_DEADLINE; equality obeys existing `< now`; deadline crossed during customer-lock wait uses post-lock Clock, no extension/resend. |
| `tenant_isolation_covers_state_and_claims` | Same request UUID in A/B: distinct Redis keys, A fence rejected for B; withTenant(A) cannot read/claim/write B, no B event, restricted roles. |
| `trigger_preserves_running_progress` | Race repeated visit registration with both workers: ID-only scheduler payload, unchanged H/cursor/retries. |
| `registration_backoff_follows_pp97` | Fail attempts 1–10: same stored event unacknowledged, retryDelayMs(attempt), tenth parks, nine delays total 2,555s not 18s; core executes when registration succeeds. |
| `new_visit_registers_without_discovery` | Active test composition receives each visit trigger: one company scheduler, normal core delegation, no discovery dependency. |
| `query_shape_and_explain_use_company_primary_key` | Representative terminal/future/due/history mix across tenants: correct projections/bounds/plans from §4 without disabling sequential scans. |
| `runtime_stays_dormant_with_valid_token_settings` | Actual startup composition, synthetic valid token settings and requests enabled: no rating worker/scheduler/state, no SENDING/ready event; visit projection still works. |
| `default_registry_acknowledges_failed_rating_without_delivery` | Real full notification module/default registry and valid 2a payload: FAILED/CONFIG_INVALID, consumption receipt and dispatcher acknowledgement; no PENDING/SENDING attempt, authorized-send event or outbound call. |
| `inapp_only_retries_rating_without_delivery` | Actual in-app-only module/same payload: NOTIFICATIONS_LIVE_REQUIRES_PR6, rolled-back receipt/attempt, dispatcher retries then parks, no outbound call. |
| `installing_sender_does_not_replay_consumed_claim` | After full-module failure, redeliver same event with test rating registry: consumption/attempt dedupe prevents authorization; request remains SENDING, no implicit reset/resend. |

The real two-worker fencing/crash suite passes three consecutive CI runs. That is flake evidence, not arbitrary-load proof. Keep 2a atomicity/opt-out/snapshot tests; replace the old failed-continuation expectation with these bounds. Required implementation CI gates remain mandatory on its exact head.

## 7. Dormancy and notification compatibility

In 2b, main.ts installs a closed lifecycle from customers.module.ts: deliver delegates directly to next, ready/close are no-ops, eventTypes is empty; no rating Queue/Worker/state adapter/token codec is constructed. Existing createRatingSchedulingConsumer stays registered: it stores SCHEDULED requests, never claims them.
Build the active scheduler factory for explicit tests/later activation, but do not call it from ordinary startup. No environment flag is introduced that can accidentally open it; business settings/token keys cannot override closed composition. Do not copy PR750's unconditional startRatingClaimsWorker call.
59b-3's reviewed activation change connects the active factory only after sender/template/channel readiness, 60-1, 60-2, 61-1 and 2c recovery prerequisites. Inventory legacy jobs/live images first; deploying a closed new build does not stop a previously running candidate worker.
The generic notification consumer already subscribes to RatingRequestReady. Full-module default registry contains only staffOtp: a valid rating payload records terminal FAILED/CONFIG_INVALID plus consumption and can be acknowledged/published. Request is already SENDING; event is not a pending replay buffer.
In-app-only wiring throws NOTIFICATIONS_LIVE_REQUIRES_PR6 on WhatsApp; transaction rolls back, dispatcher retries/parks the source. Neither configuration guarantees automatic sending when 59b-3 is installed. Do not reset SENDING, reopen a terminal attempt, alter dispatcher metadata or enable templates/channels here.
Acceptance inspects committed attempts/receipts/outbox metadata and outbound absence, using actual default factories/registries and synthetic fixtures; merely asserting a mocked sender was not called is insufficient.
The settled closed-claim policy requires no new business decision. If inventory finds historical pre-activation SENDING/FAILED/parked cases, hand off: **“May these pre-activation rating opportunities remain unsent, or should a separately specified recovery policy be designed within the existing at-most-once/no-resend rule?”** Answer PENDING / TODO(spec), routed by orchestrator as a business question. No lost-opportunity acceptance or recovery is invented here.

## 8. Q1 — technical, Waleed only

Which fenced progress mechanism and capacity/recovery cost should 59b-2b adopt? Answer PENDING / TODO(spec). PP-97/dormancy are settled, not reopened.

A — **Recommended:** Redis incarnation/version CAS, finite ID sweeps and independent bounded retries as specified; no migration, but historical scans, Lua capacity validation and inventory-based Redis-loss recovery.
B — PostgreSQL S2/C, durable per-row eligibility/backoff with fair selection; higher migration/index/grant and negative-RLS-test cost, less Redis recovery risk, but a head scan alone still needs a fairness proof.
C — PostgreSQL F2, tenant-scoped sweep/page/retry tables; highest schema/transaction/testing cost, durable coordination, but extra writes and connection pressure must fit the budget.

B/C are alternative directions, not implementation-ready substitutes. If selected, design their exact migrations, forced RLS, tenant composite keys, negative tests, indexes and progress proof first. F0 + A-time is not an option.

## 9. Open risks and admission conditions

- Historical row count drives N; long-lived companies may exceed the send window even with empty retries. Measure cardinalities/plans; an indexed database alternative may be needed.
- K2,048/R25 permits conservative retry waits above 30 minutes at Δ60s. Defaults are not a deadline-hit guarantee; capacity validation precedes activation.
- Single-document Lua has O(K) serialization/CPU/replication cost per mutation. Validate many-company load; do not hide overload by starving retries or allowing unbounded storage.
- Long locks, repeated crashes, Redis outage and uncertain commits can violate Δ. Require server-side transaction limits and drained shutdown; Promise.race alone does not cancel DB work.
- Invisible Redis rollback cannot be fenced from Redis alone. Detection/quiescence/full authorized inventory timing remain explicit operational assumptions and 2c obligations.
- Reconcile the historical candidate with merged 2a/current main, preserving unrelated edits. No live image/queue/migration inventory was performed here.
- Legacy payloads/consumed ready events require pre-activation inventory; never silently discard outcomes or promise automatic resend.
- Q1 needs Waleed's answer and orchestrator audit; implementation/review budget is separate. This design creates no sixth PR750 round and grants no deployment authority.
