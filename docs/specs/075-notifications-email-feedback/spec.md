# Feature Specification: Email feedback intake and suppression (Resend), then email activation

**Feature Branches**: `feat/075-email-feedback-intake` (PR-C1a), `feat/075-email-feedback-reconcile` (PR-C1b),
`feat/075-email-activation` (PR-C2)

**Created**: 2026-11-23

**Status**: Draft. Owner decision (Waleed, card, 2026-11-23 ~21:25 Kuwait): «نبنيه كامل قبل الإطلاق» — the full email
path, bounce and complaint handling included, ships before go-live. Open questions: `owner-questions.ar.md`.

**Governing records**: ADR-0014 (Accepted; §3 is the contract this spec implements), ADR-0013 (the WhatsApp intake and
platform suppression pattern), ADR-0018 (attempt states and evidence), `CLAUDE.md` §5 "Global messaging control" and
§6 "Inbound webhooks". Read against `origin/main@841b81992`.

**Input.** The Resend send adapter exists (`packages/notifications/src/adapters/resend.channel.ts`) and tags every
send with `company_id`, `attempt_id`, `execution_id` (lines 82-86). Email is switched off by a constant
(`packages/notifications/src/email-configuration.ts:10-12`, `EMAIL_FEEDBACK_NOT_IMPLEMENTED`) because the owner
decided on 2026-10-03 that hard-bounce and complaint suppression must exist before any live send. The email
suppression gate is a stub (`apps/worker/src/modules/notifications/email.module.ts:71`). No webhook, inbox or
suppression table for email exists.

**Scope.** (C1) A signed Resend webhook is verified, stored scrubbed, acknowledged and reconciled by the worker into
receipt evidence on the attempt and, for a hard bounce or a complaint, a platform suppression that refuses later
email to that address. (C2) With complete configuration the worker sends through Resend.

**Out of scope.** Open and click tracking; marketing email; automatic re-subscription; a tool to lift a suppression
(ET-Q3); a bell to the owner on a bounce (EP-Q1); tenant-owned senders or credentials; WhatsApp; any change to the
Resend request shape or the email copy.

## Terms

- **Feedback event**: one Resend webhook delivery (`email.delivered`, `email.bounced`, `email.complained`,
  `email.failed`, `email.suppressed`, `email.delivery_delayed`).
- **Provider email id**: Resend's opaque id of one sent email; stored on the attempt as `provider_message_id`.
- **Recipient hash**: the keyed hash of the canonical address (`NOTIFICATION_EMAIL_HASH_KEY`), 32 bytes — the only
  form in which an address is kept after the attempt ends.

## Requirements — C1: intake (API)

- **FR-001** `POST /v1/webhooks/resend` is public (no session), mounted like the WhatsApp intake: a per-IP Redis
  rate limit, `application/json` only, no content encoding, a 64 KiB body cap, exactly one of each signature header,
  and the raw body captured for verification. Without `RESEND_WEBHOOK_SECRET`, the platform notifications database or
  Redis — and in production without `TRUSTED_PROXY_CIDRS` — the route answers 503 `NOT_READY` and stores nothing.
  An upload still incomplete at the intake deadline is aborted and its connection closed, releasing buffered chunks;
  the API does not drain an unbounded upload after the deadline.
- **FR-002** The signature is verified before the body is parsed as an event: HMAC-SHA256 over
  `<svix-id>.<svix-timestamp>.<raw body>` with the decoded secret, compared in constant time against every `v1`
  signature in the header; the timestamp must be within ±5 minutes. Native `node:crypto`; no SDK (ADR-0014 §3). A
  failure answers 401 and stores nothing. *(Header names and the signing scheme are to be confirmed against Resend's
  webhook documentation in the PR; if they differ, the PR records the difference and follows the documentation.)*
- **FR-003** The verified body passes a strict allowlist (Zod, `packages/contracts`): `type`, `created_at`,
  `data.email_id` and, for a bounce, `data.bounce.type`. Everything else — addresses, subject, headers, tags,
  diagnostics — is dropped before storage and never logged. An unknown `type` is acknowledged with 200 and not stored;
  its request variant requires only `type`, while stored types require the complete envelope.
- **FR-004** One row is inserted into the platform inbox, keyed by a permanent digest of the provider event id
  (domain-separated HMAC of `svix-id`). A replay of the same event is acknowledged with 200 and changes nothing,
  including a row that is still unresolved.
- **FR-005** After the insert commits, the API enqueues one id-only job and marks the row `enqueue_confirmed_at`;
  then it answers 200 `{ "received": true }`. If the enqueue fails the row stays unconfirmed and the worker's
  recovery sweep picks it up; the API still answers 200 because the event is durable. The whole request stays inside
  the 200 ms budget; no provider call happens in the API.
  At the deadline, a known committed row is acknowledged with 200 even if enqueue never settles. A storage outcome
  not yet known to have committed answers 503 `NOT_READY`, allowing a safe provider retry.
- **FR-006** The API holds no sending credential and no email hash key. It needs the webhook signing secret, the
  independent `RESEND_EVENT_DIGEST_KEY` and the restricted `pospay_notifications` connection. Missing or invalid
  intake settings leave this capability NOT_READY (503) with a clear capability log; API startup and `/ready` continue.
  The digest key is frozen: never rotate it except through a documented migration preserving existing dedupe identities.

## Requirements — C1: reconciliation (worker)

- **FR-010** For each inbox row the worker retrieves the sent email from Resend by the stored provider email id, over
  the fixed HTTPS origin, outside any database transaction, with a bounded timeout. It validates the returned id and
  the three tags, computes the recipient hash from the returned address, and discards the address and every other
  field at once, without logging or persisting them.
- **FR-011** Inside `withTenant(<company tag>)` it locks the attempt and applies ADR-0014 §3 step 3 exactly: channel
  `email`, matching attempt and execution tags, matching recipient hash, and an eligible state. A missing
  `provider_message_id` is bound by a conditional update; an identical id is idempotent; a different id, a missing
  execution, a tag or hash mismatch, a cross-tenant tag or an ineligible state **quarantines** the inbox row and
  writes nothing to the tenant.
- **FR-012** In the same tenant transaction it inserts one **feedback evidence** row linked to the attempt (type,
  provider time, the event digest). The attempt's status, execution fence, outcome history and cleared destination
  are never changed; nothing is resubmitted.
- **FR-013** After that commit, for `email.complained`, `email.suppressed` and a **permanent** `email.bounced`, the
  worker upserts the platform email suppression for that recipient hash and writes one audit row, on the
  `pospay_notifications` connection, then marks the inbox row resolved. A transient bounce, a delay, a delivery and a
  failure are evidence only. Every step is idempotent, so a crash between the two commits is repaired by the retry.
- **FR-014** A failed retrieval or a rolled-back transaction leaves the row pending. Retries are bounded: at most 8,
  with exponential spacing capped at 6 hours; after the last one the row is quarantined with a reason code. Only
  retrieval and persistence are retried — never a send.
- **FR-015** A recovery sweep enqueues rows that were stored but never confirmed as enqueued (FR-005), and a retention
  sweep clears `raw_event` 30 days after receipt. The digest, type and state columns stay, so a replay after
  retention is still refused. Quarantined rows keep their reason and are counted in the worker's capability log.
- **FR-016** Before an email attempt is authorized, the suppression gate asks
  `public.platform_email_is_suppressed(<recipient hash>)` on the transaction it already holds; a suppressed address
  ends the attempt as `SUPPRESSED` with no provider call. This replaces the stub at `email.module.ts:71`.
- **FR-017** The delivery log (`GET /v1/notifications/delivery-log` and its business and branch variants) shows, for
  an email attempt, the latest feedback type as `provider_receipt` (`DELIVERED`, `BOUNCED`, `COMPLAINED`,
  `SUPPRESSED`, `DELAYED`, `FAILED` or `null`). This is how the owner sees a failure (ADR-0014 §3; EP-Q1).
- **FR-018** Through the end of C1 the email capability stays `enabled: false`; C1 changes no send behaviour.

## Requirements — C2: activation

- **FR-020** `readEmailConfiguration` returns `enabled: true` only when all of these are present and valid:
  `RESEND_API_KEY`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`, `EMAIL_REPLY_TO`, `EMAIL_ADMIN_ORIGIN` (an https origin),
  `NOTIFICATION_EMAIL_HASH_KEY` (32+ characters), `NOTIFICATION_EMAIL_HASH_KEY_ID`,
  `PLATFORM_NOTIFICATIONS_DATABASE_URL`, and the feedback intake reported ready. Otherwise `enabled: false` with a
  reason that names the missing group and never a value.
- **FR-021** When enabled, the worker constructs `ResendChannel` from the environment and the email adapter sends
  through it; the `CONFIG_INVALID` default at `email.module.ts:90-92` remains only for the disabled state.
- **FR-022** The admin origin in rendered emails comes from `EMAIL_ADMIN_ORIGIN`, replacing the literal at
  `email.module.ts:67` and `persistence/email-channel.adapter.ts:15`.
- **FR-023** The API and worker capability logs report the real state and reason. Email readiness never affects
  `/ready`.
- **FR-024** The sending keys are passed to the worker only. The API receives `RESEND_WEBHOOK_SECRET` and the independent
  `RESEND_EVENT_DIGEST_KEY`, never a sending or recipient-hash key. An empty digest key disables the intake with
  NOT_READY and a clear capability log, never a startup crash. Never rotate the digest key except through a
  documented migration preserving dedupe identities.

## Schema changes

All three platform tables are **global**: no `company_id`, no tenant RLS, hashes only, no address, no tenant id.
They follow the recorded exception for global messaging control (`CLAUDE.md` §5, ADR-0013) and are reachable only
through a new `createPlatformEmailDatabase` facade in `packages/db`, on `pospay_notifications`. The PR adds an
ADR-0014 addendum that classifies them, as §3 requires before any migration.

| Table | Columns | Rules |
|---|---|---|
| `platform_email_suppressions` | `recipient_hash bytea` PK, `hash_key_id text`, `source text`, `first_suppressed_at`, `last_suppressed_at`, `lifted_at` | hash is 32 bytes; `source IN ('BOUNCE','COMPLAINT','PROVIDER','MANUAL')`; `last >= first`; `lifted_at IS NULL` (validated CHECK — no re-subscription in this phase) |
| `platform_email_feedback_inbox` | `id uuid` PK, `provider_event_digest bytea` UNIQUE, `provider_email_id text`, `event_type text`, `bounce_class text`, `provider_timestamp`, `received_at`, `raw_event jsonb`, `enqueue_confirmed_at`, `attempts smallint`, `next_attempt_at`, `resolved_at`, `quarantined_at`, `quarantine_reason text` | digest is 32 bytes; `event_type` in the six allowlisted values; `bounce_class IN ('PERMANENT','TRANSIENT')` or NULL; `resolved_at` and `quarantined_at` never both set; `quarantine_reason` from a fixed code list |
| `platform_email_audit` | `id uuid` PK, `recipient_hash bytea`, `hash_key_id text`, `source text`, `inbox_id uuid` FK, `operator_id uuid`, `action text`, `reason text`, `occurred_at` | `action = 'SUPPRESS'`; a provider source requires `inbox_id` and no operator; `MANUAL` requires an operator and no inbox |
| `notification_attempt_feedback` (**tenant**) | `company_id`, `id`, `attempt_id`, `event_type text`, `bounce_class text`, `provider_event_digest bytea`, `provider_timestamp`, `recorded_at` | PK `(company_id, id)`; FK `(company_id, attempt_id)` → `notification_attempts`; UNIQUE `(company_id, provider_event_digest)`; **RLS** on `company_id` with FORCE; insert-only for `pospay_app` |

Indexes (each added by the migration that adds its query): inbox partial indexes on `(received_at, id)` for
unconfirmed enqueue, on `(next_attempt_at, id)` for unresolved and not quarantined, and for retention where
`raw_event IS NOT NULL`; `platform_email_audit (inbox_id)`; `notification_attempt_feedback
(company_id, attempt_id, provider_timestamp DESC)`. Indexes on the existing `notification_attempts` table are not
needed: the lock is by primary key.

Grants: `pospay_notifications` — `SELECT, INSERT` and column-level `UPDATE` on the inbox state columns; `SELECT,
INSERT` and `UPDATE (last_suppressed_at, source)` on suppressions; `INSERT` on audit. `pospay_app` — `EXECUTE` on
`public.platform_email_is_suppressed(bytea)` (a `SECURITY DEFINER` boolean reader owned by the suppression reader
role, as `platform_whatsapp_is_suppressed` is), and `SELECT, INSERT` on `notification_attempt_feedback`. No other
role gains anything; no runtime role gains `BYPASSRLS`. Expand-only migration; nothing is dropped.

## API contract

```
POST /v1/webhooks/resend
Headers: svix-id, svix-timestamp, svix-signature, content-type: application/json
200 { "received": true }      verified and durable, or a verified replay, or an unknown event type
401 UNAUTHENTICATED            signature or timestamp invalid, a header missing or repeated
400 BAD_REQUEST                verified but outside the allowlist
415 UNSUPPORTED_MEDIA_TYPE     wrong content type or any content encoding
429 RATE_LIMITED               per-IP limit
503 NOT_READY                  capability unavailable or a transient storage failure (Resend retries)
```

Errors use the standard envelope. The route is declared `@Public()` with the same recorded mechanism as
`webhooks/whatsapp`, so the "no endpoint without a guard" CI test accepts it. `provider_receipt` is added to the
delivery-log item schema and the generated OpenAPI; no other contract changes.

## Permissions

None new. The webhook is authenticated by its signature. The delivery log keeps its existing permission.

## Environment keys

| Key | Container | New? |
|---|---|---|
| `RESEND_WEBHOOK_SECRET` | api | new |
| `PLATFORM_NOTIFICATIONS_DATABASE_URL` | api, worker | exists |
| `POSTGRES_NOTIFICATIONS_PASSWORD` | migrate | exists |
| `RESEND_API_KEY` | worker | in `.env.example`, not yet in any compose |
| `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`, `EMAIL_REPLY_TO`, `EMAIL_ADMIN_ORIGIN` | worker | same |
| `NOTIFICATION_EMAIL_HASH_KEY`, `NOTIFICATION_EMAIL_HASH_KEY_ID` | worker | same |
| `TRUSTED_PROXY_CIDRS` | api | exists; required for the intake in production |

## What Waleed sets in Resend and Cloudflare

1. The sending domain in Resend, and the DNS records Resend shows for it (SPF and DKIM) plus a DMARC record, in
   Cloudflare; wait until Resend shows the domain verified.
2. Open and click tracking **off** for that domain.
3. One retrieval-capable `full_access` API key for sending and reconciliation (worker only), per environment;
   `sending_access` cannot retrieve the sent email or its correlation tags.
4. A webhook per environment — production `https://api.pospay.systems/v1/webhooks/resend`, staging
   `https://api.staging.pospay.systems/v1/webhooks/resend` — subscribed to the six events above; its signing secret
   goes into `RESEND_WEBHOOK_SECRET` in Dokploy. Provision an independent 32+ character
   `RESEND_EVENT_DIGEST_KEY` for the API replicas of that environment. Keep it frozen except through a
   documented migration preserving existing dedupe identities; an empty key leaves the intake NOT_READY.
5. The sender name, the sender address and a monitored Reply-To address.

## Edge cases

- The webhook arrives before the send result commits, or after the address was cleared: binding uses the retained
  hash and the conditional update (FR-011); the late sender result cannot overwrite a bound id.
- The provider email id belongs to no attempt of ours (another product on the same Resend account): retrieval returns
  tags that fail validation → quarantine `TAGS_INVALID`, no tenant write, no suppression.
- Two events for one email arrive together: the attempt lock orders them; each inserts its own evidence row.
- The same event is delivered twice across the 30-day retention: the digest still refuses it.
- Resend is down during reconciliation: bounded retries, then quarantine `RETRIEVAL_EXHAUSTED`.
- The suppression commit fails after the evidence commit: the retry finds the evidence present and completes.
- An address suppressed for one company is refused for every company (ET-Q1).

## Tests

Unit (no database): signature valid, wrong secret, stale timestamp, future timestamp, several signatures with one
valid, repeated header; the allowlist drops every non-listed field; retry spacing; the bounce classification table.

Integration, API: a valid event stores one row and enqueues one job; a replay stores nothing new; an unknown type
stores nothing; no secret → 503; the stored `raw_event` contains no address (asserted on the row); enqueue failure
still answers 200 and leaves the row unconfirmed; the rate limit answers 429.

Integration, worker (a stub HTTP server stands in for Resend; no real network): delivered → evidence, no
suppression; permanent bounce → evidence, suppression, audit; complaint likewise; transient bounce → evidence only;
missing id bound once; different id → quarantine and nothing written; tag from another company → quarantine; hash
mismatch → quarantine; callback before the result commit; crash between the two commits then retry; retries
exhausted → quarantine; recovery sweep enqueues an unconfirmed row; retention clears `raw_event` and keeps the digest.

Suppression gate: a suppressed hash ends the attempt `SUPPRESSED` with zero provider calls.

Database: RLS negative tests for `notification_attempt_feedback` (cross-tenant read returns 0 rows, write errors);
privilege tests that `pospay_app` cannot read the three platform tables and `pospay_notifications` cannot read any
tenant table; the NULL-only CHECK on `lifted_at`; `EXPLAIN` on the three sweep queries and the delivery-log query.

C2: each missing key keeps email off with the right reason; complete configuration turns it on; one authorized
attempt is submitted once and recorded `PROVIDER_ACCEPTED`; a provider refusal is recorded and not resubmitted.

## Acceptance

- C1: with the capability still off, a signed test event sent to staging is stored scrubbed, reconciled and visible
  as `provider_receipt` in the delivery log, and a bounced address is refused on the next attempt.
- C2: one controlled delivery, one bounce and one complaint are exercised on staging with real Resend feedback
  before any production send (ADR-0014 §4). An accepted send response alone is not a delivery proof.
