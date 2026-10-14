# ADR-0042 — Service-session recovery proof for an EXPIRED attempt

Date: 2026-10-14. Status: Accepted technical design for spec 050, rows 35c-13a-1, 35c-13a-2 and 35c-13.
Owner decisions: SS-Q17 (no general "my recordings" list), SS-Q18 option 3 (the recorder confirms an EXPIRED
recording herself), SS-Q19 option 1 (before confirming she sees only her own visits of the attempt date inside the
recording screen) — Waleed, 2026-10-13/14. Abu Salem's picks on SS-Q18/SS-Q19 replace this ADR if they differ.
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

- Primary key `(company_id, id)` (ADR-0007). Unique `(company_id, user_id, operation, key_hash)`. Tenant-qualified
  foreign keys to the branch and to `service_sessions`. CHECKs: `expires_at > issued_at`;
  `revoked_at` and `revoked_outcome` are both null or both set.
- `ENABLE` + `FORCE` RLS with split policies on `company_id = app_company_id()`; a negative isolation test in the
  same PR. `pospay_app` gets `SELECT`, `INSERT` and a column `UPDATE` on `session_id`, `committed_at`,
  `last_seen_at`, `expires_at`, `revoked_at`, `revoked_outcome` only — actor, scope, key hash and date are
  immutable. No `DELETE`, and no grant for any other role.

**Issue.** Both write use cases call a new orders port before the business transaction. Its adapter runs its own
`withTenant(companyId)` that re-checks place and record access, then
`INSERT … ON CONFLICT (company_id, user_id, operation, key_hash) DO UPDATE SET last_seen_at = now,
expires_at = greatest(expires_at, now + 72 h) WHERE revoked_at IS NULL AND expires_at > now`, and commits. A proof
that is already expired or revoked is never reopened: the conflict leaves it as it is. If the issue fails, the request fails with a 503 and the
business write never starts — so "no proof" always means "no write".

**Date.** Create: the business date the server already computes for the request (`occurred_at` when given,
otherwise the injected clock — FR-012), in the business timezone. For a **new** proof the issue applies the
same window and future-time checks as the write, so a refused new request leaves no proof. When the proof already
exists (a same-key replay) the issue only touches it and applies no date check, so a replay after branch midnight or
after a month boundary still reaches the stored response, as today. Append: the target session's persisted
`business_date`, with `session_id` set at issue.

**Link.** Inside the existing business transaction, after the session row exists, the write sets `session_id` and
`committed_at` on the proof row. A rollback drops only the link and keeps the proof. The recording, its outbox event
and its stored idempotent response stay in one transaction (ADR-0041 §4); only the proof sits outside it. This is
the recorded exception to "one request, one transaction".

**Client.** Nothing new is stored. The EXPIRED envelope already holds the key and scope. The key travels in a new
`x-recovery-key` header (never a query string), added to the CORS `allowedHeaders` in `apps/api/src/app.ts` and to
the observability redaction list.

### 2. Lifetime and gates (engineering constants)

- `expires_at` = last server receipt + 72 h. The client shows EXPIRED at last send + 25 h, so a proof whose last
  send reached the server stays readable at least 47 h after the panel appears (#209).
- Not-before gate: `last_seen_at + 24 h`. Before it, the right path is a same-key replay, so the read answers
  `SESSION_RECOVERY_NOT_YET`.
- After `expires_at` or after a revoke the read answers `SESSION_RECOVERY_CLOSED` (`EXPIRED` | `REVOKED`).
- Rows are kept, like audit. A sweep would need a grant the dispatcher does not have (ADR-0003 limits its sweep to
  idempotency keys); adding one is a separate decision.

### 3. The read and the revoke

`GET /v1/businesses/:businessId/branches/:branchId/service-sessions/recovery?operation=…` with `x-recovery-key`,
guarded by `@Require('record:service-sessions:branch')`, the orders feature, the selected company and an admin
session; access is re-checked inside the transaction. The query (`queries/session-recovery.query.ts`) finds the
proof by the unique index for `app_user_id()`, this company, business and branch, unrevoked, unexpired and past the
gate. Its date is `coalesce(linked session.business_date, proof.business_date)`. It lists sessions of that branch and
date through `service_sessions_day_idx` that have an active line with `recorded_by = app_user_id()`, and returns
only those lines: `occurred_at`, `customer_name`, `customer_phone_masked`, line `name_ar`/`name_en`.
`ORDER BY occurred_at, id`, at most 50 visits plus a `truncated` flag. `Cache-Control: no-store`.

Two refusals stay distinct. The guards refuse a caller without record access, feature or selected company with the
usual `FORBIDDEN`. A caller who passes them but has no proof for this key, operation and place — unknown key, another
recorder's key, another branch or tenant — gets one `SESSION_RECOVERY_NOT_FOUND`, which does not reveal which part
failed. The key is a random client value, so the answer tells the caller nothing about anyone else. The contract does not expose `committed_at` or whether the attempt committed (§5).

`POST …/service-sessions/recovery/confirm` with `x-recovery-key` and `{ operation, outcome }` sets `revoked_at` and
`revoked_outcome`, writes an `audit_log` entry, and answers 204, idempotently, also when the proof is already
expired or unknown.

### 4. Client states (row 35c-13)

- **NEVER_REACHED** (#210): the envelope has no `lastSentAt`, or the read answers `SESSION_RECOVERY_NOT_FOUND` →
  "the attempt did not reach the server — we cannot check it; ask the manager". No call is made without
  `lastSentAt`. This is distinct from a 200 with an empty list.
- **CANNOT_VERIFY**: the read answers `FORBIDDEN` (for example the recorder lost record access after saving) → "we
  cannot check it; ask the manager", with no claim about whether the attempt arrived.
- **WINDOW_ENDED** (#209): `SESSION_RECOVERY_CLOSED` → "the check window has ended — ask the manager".
- **NOT_YET**: shows when the check opens.
- **LIST**: the visits (empty, one or several).

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
  lines for that date. The read is bounded to her own lines, to dates the write path accepts, behind the gate, and
  audited on confirm. Accepted.
- The server now knows whether the attempt committed. Showing that would make the two buttons automatic, which
  changes SS-Q19 option 1. It is owner question SS-Q20 (pending). Until it is answered, `committed_at` only selects
  the date and is never returned.
- A pre-existing gap, not changed here: the server keeps a committed key for 24 h from its claim, while the client may
  retry until 25 h after its last send (#221).

## Consequences

Rows 35c-13a-1 (proof table, migration pair, issue and link in both write use cases) and 35c-13a-2 (read, confirm,
contracts) replace the single 35c-13a row; 35c-13 builds the client states above. No new module-map arrow: the
adapter reuses the identity and tenancy readers already declared for orders, and its exact path entries are added
in 35c-13a-1. The migration and this ADR are renumbered at merge time if another lands first.
