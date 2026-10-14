# ADR-0042 — Service-session recovery proof for an EXPIRED attempt

Date: 2026-10-14. Status: Accepted technical design for spec 050, rows 35c-13a-1, 35c-13a-2 and 35c-13.
Owner decisions: SS-Q17 (no general "my recordings" list), SS-Q18 option 3 (the recorder confirms an EXPIRED
recording herself), SS-Q19 option 1 (before confirming she sees only her own visits of the attempt date inside the
recording screen) — Waleed, 2026-10-13/14. Abu Salem chose the same on SS-Q18 and SS-Q19 (2026-10-14). SS-Q20 option 1 (Waleed, 2026-10-14; Abu Salem pending — his pick replaces the outcome part of §3–§4 if it differs).
Related: ADR-0003, ADR-0007, ADR-0041; plan v4 T7 (idempotency); design inputs #209, #210, #211.
Design advice: Codex astra 6 and Claude Fable 5.1 (pipeline step 2), both proposing the same shape.

## Context

The admin journal (`apps/admin/src/orders/model/session-attempt-journal.ts`) marks a save EXPIRED when the outcome is
still unknown 25 h after the last send (`SESSION_ATTEMPT_RETENTION_MS` 24 h + `SESSION_ATTEMPT_SAFETY_MARGIN_MS`
1 h). After a reload the EXPIRED envelope keeps `key`, `scope`, `createdAt`, `lastSentAt?` and, for an append,
`sessionId` — but no request body.

`idempotency_keys` (packages/db/src/idempotency.ts) is written only when the business write commits: the claim, the
effect and the stored response share one transaction, and a rollback leaves nothing. Its `expires_at` is fixed at
the claim (`now()` of that transaction) + 24 h, and a replay does not extend it. So an attempt that never committed leaves no server trace, and even a
committed one cannot be found by key after the sweep.

SS-Q19 needs a read that shows the recorder her own visits on the attempt's business date. Recording permission
alone must not open it, or it becomes the general list SS-Q17 rejected.

## Decision

### 1. A recovery proof row, written before the business write

New tenant table `service_session_recoveries` in orders:
`company_id`, `id` (UUID v7), `business_id`, `branch_id`, `user_id` (actor), `operation`
(`record-service-session` | `append-service-session-lines`), `key_hash` (sha256 hex of the Idempotency-Key — the
key itself is never stored here), `business_date`, `business_timezone`, `session_id` (nullable),
`committed_at` (nullable), `issued_at`, `last_seen_at`, `expires_at`, `revoked_at` (nullable), `revoked_outcome`
(`RECORDED_ELSEWHERE` | `NOT_RECORDED`, nullable).

- Primary key `(company_id, id)` (ADR-0007). Unique `(company_id, user_id, business_id, branch_id, operation, key_hash)`: the place is part of the proof's identity, so the same key sent to another branch gets its own proof and never refreshes or links the first branch's. Tenant-qualified
  foreign keys to the branch and to `service_sessions`. CHECKs: `expires_at > issued_at` and `expires_at <= issued_at + 168 h`;
  `revoked_at` and `revoked_outcome` are both null or both set.
- `ENABLE` + `FORCE` RLS with split policies on `company_id = app_company_id()`; a negative isolation test in the
  same PR. `pospay_app` gets `SELECT`, `INSERT` and a column `UPDATE` on `session_id`, `committed_at`,
  `last_seen_at`, `expires_at`, `revoked_at`, `revoked_outcome` only — actor, scope, key hash and date are
  immutable. A `BEFORE UPDATE` trigger refuses any change to `revoked_at`/`revoked_outcome` once set, any change to
  `session_id`/`committed_at` once set, and any `expires_at` beyond the cap, so the column grant cannot undo a
  revoke or relink a proof. No `DELETE`, and no grant for any other role.

**Issue.** Both write use cases call a new orders port before the business transaction. Its adapter runs its own
`withTenant(companyId)` that re-checks the place and applies **the same authority rule as that write**: a create and
an append both call `resolveSessionRecorder` (domain/session-authority.ts) and pass `recorder_membership_id`. An
append also lets the original recorder append. A missing or ambiguous membership
(`SESSION_RECORDER_MEMBERSHIP_REQUIRED` or `FORBIDDEN`) is refused at issue and leaves no proof. The adapter then
`INSERT … ON CONFLICT (company_id, user_id, business_id, branch_id, operation, key_hash) DO UPDATE SET last_seen_at = now,
expires_at = least(greatest(expires_at, now + 72 h), issued_at + 168 h) WHERE revoked_at IS NULL AND
expires_at > now`, and commits. An append whose stored proof has a different `session_id` is refused before that
upsert with `IDEMPOTENCY_KEY_REUSED` (422), including when that proof is expired or revoked; the issue transaction
rolls back and writes nothing. A proof that is already expired or revoked is never reopened: the conflict leaves it
as it is. A same-session append, and a create, then proceed exactly as they do today (the proof gates only the
recovery read, never the write). If the issue itself fails (database error, lock timeout), the request fails with
`SESSION_RECOVERY_UNAVAILABLE` (503, ar/en message) and the business write never
starts — so, for attempts made after 35c-13a-1 is deployed, "no proof" always means "no write". An attempt that
committed before that deploy has no proof; the NEVER_REACHED copy therefore says only that the server cannot check
it, never that it was not saved (§4).

**Date.** Create: the business date the server already computes for the request (`occurred_at` when given,
otherwise the injected clock — FR-012), in the business timezone. For a **new** proof the issue applies the
same window and future-time checks as the write, so a refused new request leaves no proof. When the proof already
exists (a same-key replay) the issue only touches it and applies no date check, so a replay after branch midnight or
after a month boundary still reaches the stored response, as today. Append: for a new proof the issue loads the
target session scoped to the URL business and branch, applies the append authority rule above and
`validateAppendWindow` (domain/session-time.ts), and only then stores the session's persisted `business_date`, with
`session_id` set at issue; a session outside that scope or window gets no proof.

Only the issue's own checks prevent a proof. A request the issue accepts but the business transaction then refuses
(customer not found, performer count) keeps an unlinked proof dated as above. A missing or ambiguous recorder
membership is an issue check on both create and append, so it leaves no proof. A same key with another body after
the first body committed meets the first body's proof, already linked — that is the point of writing it first.

**Link.** Inside the existing business transaction, after the session row exists, the write sets `session_id` and
`committed_at` on the proof row, guarded by `revoked_at IS NULL AND expires_at > now AND committed_at IS NULL`, and
by an `EXISTS` on `service_sessions` for the same company, business and branch. `committed_at IS NULL` is why a
same-key replay after the 24 h idempotency sweep never relinks: the sweep makes the handler run again, a second
session may be created, and the update matches no row because the original proof is already linked. The trigger
would also refuse restamping `session_id` or `committed_at`. A same-key **replay** that returns a stored committed
response links the proof the same way, to the session id in that stored response, so a send that committed before
35c-13a-1 was deployed (or before this proof existed) is still recorded as committed once any later send of the same
key reaches the server while the idempotency row is kept. A rollback drops only the link and keeps the proof. The
recording, its outbox event
and its stored idempotent response stay in one transaction (ADR-0041 §4); only the proof sits outside it.
`CLAUDE.md` §6 still holds: the money effect and its outbox event are one transaction; the proof carries no money,
stock or event and is not part of that effect.

**Client.** Nothing new is stored. The EXPIRED envelope already holds the key and scope. The key travels in a new
`x-recovery-key` header (never a query string), added to the CORS `allowedHeaders` in `apps/api/src/app.ts` and to
the observability redaction list.

### 2. Lifetime and gates (engineering constants)

- `expires_at` = last server receipt + 72 h, never later than `issued_at + 168 h` (a CHECK enforces the cap), so
  resending the same key cannot keep a proof alive. The client shows EXPIRED at last send + 25 h, so a proof whose
  last send reached the server within 96 h of the first stays readable at least 47 h after the panel appears (#209);
  later than that, the panel shows WINDOW_ENDED.
- Not-before gate: `last_seen_at + 24 h`. Before it, the right path is a same-key replay, so the read answers
  `SESSION_RECOVERY_NOT_YET`.
- After `expires_at` or after a revoke the read answers `SESSION_RECOVERY_CLOSED` (`EXPIRED` | `REVOKED`).
- Rows are kept, like audit. A sweep would need a grant the dispatcher does not have (ADR-0003 limits its sweep to
  idempotency keys); adding one is a separate decision.

### 3. The read and the revoke

`GET /v1/businesses/:businessId/branches/:branchId/service-sessions/recovery?operation=…` with `x-recovery-key`,
guarded by `@Require('record:service-sessions:branch')`, the orders feature, the selected company and an admin
session; access is re-checked inside the transaction. The query (`queries/session-recovery.query.ts`) finds the
proof by the unique index alone — `app_user_id()`, this company, business, branch, operation and key hash — and then
answers from the proof's state: revoked or expired → `SESSION_RECOVERY_CLOSED`, before the gate →
`SESSION_RECOVERY_NOT_YET`, open → the list. A closed or early proof is never reported as missing. Its date is `coalesce(linked session.business_date, proof.business_date)`. It lists sessions of that branch and
date through `service_sessions_day_idx` that have an active line with `recorded_by = app_user_id()`, and returns
only those lines: `occurred_at`, `customer_name`, `customer_phone_masked`, line `name_ar`/`name_en`.
`ORDER BY occurred_at, id`, 50 visits per page with an opaque keyset cursor `(occurred_at, id)` and `next_cursor`,
so every visit of the day is reachable (the panel loads more on demand). The proof is checked again on every page.
`Cache-Control: no-store`.

Two refusals stay distinct. The guards refuse a caller without record access, feature or selected company with the
usual `FORBIDDEN`. A caller who passes them but has no proof for this key, operation and place — unknown key, another
recorder's key, another branch or tenant — gets one `SESSION_RECOVERY_NOT_FOUND`, which does not reveal which part
failed. The key is a random client value, so the answer tells the caller nothing about anyone else. On an open proof the read also returns `attempt.outcome`: `COMMITTED` when `committed_at` is set, otherwise
`NOT_COMMITTED` (SS-Q20). After the gate an unlinked proof can only mean no commit, because every commit links its
proof inside the same transaction, and a replay of a stored committed response links it too (§1). One rollout-only
gap stays: a send that committed before 35c-13a-1 was deployed, whose idempotency row was already swept when the
next send arrived, and whose new write was then refused, leaves an unlinked proof — the list still shows the
original visit, which is why the list stays visible next to the pre-selected button. The pre-selection is a
suggestion, never a decision: for `NOT_COMMITTED` the panel says "the server did not see this attempt saved — find
this customer in the list before confirming", and the recorder's own check of the list wins. A closed, early or missing
proof returns no outcome.

`POST …/service-sessions/recovery/confirm` with `x-recovery-key` and `{ operation, outcome }`, under the same guards
as the read, sets `revoked_at` and `revoked_outcome` on the proof of `app_user_id()` for this company, business,
branch, operation and key hash only, `WHERE revoked_at IS NULL` so a second confirm never replaces the first outcome, writes an `audit_log` entry, and answers 204, idempotently, also when the proof is already
expired or unknown.

### 4. Client states (row 35c-13)

- **NEVER_REACHED** (#210): the envelope has no `lastSentAt`, or the read answers `SESSION_RECOVERY_NOT_FOUND` →
  "the server has no record of this attempt — we cannot check it; ask the manager" (never "it was not saved": an
  attempt made before 35c-13a-1 was deployed has no proof either). No call is made without
  `lastSentAt`. This is distinct from a 200 with an empty list.
- **CANNOT_VERIFY**: the read answers `FORBIDDEN` (for example the recorder lost record access after saving) → "we
  cannot check it; ask the manager", with no claim about whether the attempt arrived.
- **WINDOW_ENDED** (#209): `SESSION_RECOVERY_CLOSED` → "the check window has ended — ask the manager".
- **NOT_YET**: shows when the check opens.
- **LIST**: the visits (empty, one or several) with the outcome (SS-Q20): "this visit was saved" with «اتأكدت —
  اتسجلت» pre-selected for `COMMITTED`, "it was not saved" with «اتأكدت — متسجلتش» pre-selected for `NOT_COMMITTED`. Nothing is pre-selected in any
  other state.

In every state both confirmation buttons stay enabled (SS-Q18).

**Revoke failure** (#211): confirming clears the EXPIRED marker locally first, then sends one best-effort revoke
with a short timeout and no retry queue. A failure blocks nothing. The 72 h deadline bounds a proof that was not
revoked. Property (6) of the earlier row ("revoked server-side when the recorder confirms") therefore holds when the
revoke reaches the server; when it does not, only the deadline closes the proof. Waiting for the revoke before
clearing would block the self-service confirmation SS-Q18 chose exactly when the connection is bad. The residual is
small: the client drops the key on confirm, so only a deliberate request by the same recorder could read her own
lines of that date until the deadline.

### 5. Accepted residuals and open owner input

- A recorder can make a proof for a date by sending a deliberate write with no UI, then 24 h later list her own
  lines for that date. The read is bounded to her own lines, to dates the issue's window checks accept (create and
  append alike), behind the gate, capped at 168 h, and audited on confirm. Accepted.
- Availability: the proof issue is a hard prerequisite of every service-session write. The upsert waits on the
  same-key row lock through `ON CONFLICT … DO UPDATE`. This transaction sets neither `NOWAIT` nor `lock_timeout`,
  so two first sends of one key on a healthy database both finish and leave one proof row.
  `SESSION_RECOVERY_UNAVAILABLE` is returned only when that issue fails in the database. The client treats that
  like a transient network failure and retries the same key. A same-key lock wait on a healthy database is not
  that failure.
- Rows are kept, with no retention sweep (§2). A sweep needs a decision on the dispatcher grant and is a follow-up,
  not part of this row.
- SS-Q20 (Waleed, 2026-10-14, option 1; Abu Salem pending): for an attempt that reached the server after
  35c-13a-1 is deployed, the read returns the outcome; the panel states it and pre-selects the matching button,
  the list stays visible, and the recorder still presses confirm herself (SS-Q18). The date still comes from the
  linked `session_id`.
- A pre-existing gap, not changed here: the server keeps a committed key for 24 h from its claim, while the client may
  retry until 25 h after its last send (#221).

## Consequences

Rows 35c-13a-1 (proof table, one migration, issue and link in both write use cases) and 35c-13a-2 (read, confirm,
contracts) replace the single 35c-13a row; 35c-13 builds the client states above. A new tenancy export
`activeBusinessTimeZone` is added. No new module-map arrow: the adapter reuses the identity readers already
declared for orders, and the exact path entries for that export are added in 35c-13a-1. The migration and this ADR
are renumbered at merge time if another lands first.
