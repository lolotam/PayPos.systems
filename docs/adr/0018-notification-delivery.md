# ADR-0018 — Notification delivery

- **Status:** Accepted
- **Date:** 2026-10-01
- **Slice:** Phase 1 · PR 4 (WhatsApp, bilingual templates, delivery log)

## Context

SPEC §2 (scope table), §3/§9/§10, ADR-0010 and plan rows 4/4b/5/6/14 govern this slice. Producers resolve
recipients/channels and own rating attribution. Rating deadlines mean closing + 30 minutes, or none without hours.

`outbox/consumer.ts` and `deliver.ts` apply effects/dedupe in one database-only `withTenant` transaction. The
dispatcher currently calls `deliver`, without BullMQ (not installed). ADR-0003's dispatcher facade/role accesses
outbox only. `withUser` discovers memberships; `withNewTenant` bootstraps companies. Neither serves tenant sends.

At-most-once permits loss, never resubmission after uncertainty. CLAUDE.md §8 bans logging full phones, not
tenant storage under RLS: source outbox payloads and attempts may hold canonical E.164, like SPEC's `Customer.phone`.

## Decision

### 1. Database authorization, then a BullMQ sender

1. Emitting modules read `AlertRulesPort` and put recipients and channels in their event, as SPEC §3 requires.
   A producer supplies a stable event id and, per recipient, canonical E.164 phone, explicit `locale`, channel,
   template key/revision, safe ordered parameters and optional `send_deadline`. Notifications holds no business
   knowledge and reads no customers/staff/identity contacts. The consumer adapter validates the supplied phone
   and computes its platform hash/last3. OTPs and bearer rating links never enter event JSON. No network or Redis
   work runs in the consumer.
2. The notification consumer, in the existing `withTenant(event.companyId)` transaction, takes the phone lock,
   validates locale, checks the deadline and the suppression seam, snapshots the event phone into a `PENDING`
   attempt's `recipient_phone` and appends `NotificationSendAuthorized {company_id, attempt_id}` to outbox.
   Missing/unsupported locale inserts terminal `FAILED` with `LOCALE_MISSING`/`LOCALE_UNSUPPORTED`; an expired
   valid-locale request inserts `EXPIRED`. Both clear the attempt phone and emit failure instead of a sender job.
   `INSERT ... ON CONFLICT DO NOTHING RETURNING` is authoritative: an existing attempt
   produces neither another authorization event nor another send. Consumer dedupe commits with these writes.
3. A **transport publisher outside `OutboxConsumer.handle`** routes `NotificationSendAuthorized` to the
   `notifications-send` BullMQ queue. The dispatcher has already committed its outbox claim. It awaits `Queue.add`
   before recording published; enqueue failure follows the existing outbox retry/park policy. The job contains
   only the two ids; its stable id is `companyId-attemptId`. Existing business consumers still use `createDeliverer`.
   This publisher is infrastructure, not a database-effect consumer, and never calls WhatsApp.
4. The BullMQ processor uses `withTenant(company_id)` as `pospay_app`. It loads `recipient_phone` from that attempt,
   validates its E.164/hash/last3 consistency, reserves the recipient rate limit outside the transaction,
   then atomically changes **only** `PENDING → SENDING`, assigning an execution id. It commits before calling
   `Channel.send` once. Only the execution that received a successful commit acknowledgement may call.
   `CommitOutcomeUnknownError` grants no send permission, even if a later read finds its execution id.
5. Outside every database transaction, the channel checks the absolute deadline immediately before starting its
   one HTTP request. No intervening await, redirect, SDK retry or HTTP retry is allowed. Expiry there records
   `EXPIRED` without calling Meta. Results are recorded in another `withTenant` transaction, fenced by execution
   id and `SENDING`; the terminal state, `recipient_phone = NULL` and result event commit together.

Retries/stalled jobs cannot reacquire SENDING or terminal attempts. Source redelivery cannot restart PENDING;
only its original authorization job may claim it. Never reset/delete an identity to resend. BullMQ dedupe is
an optimization; the database fence is the guarantee. Configure `attempts=1`; safe pre-claim infrastructure
recovery and stalled-job handling must still pass through the same fence.

Reuse PostgreSQL/outbox, NestJS and Redis. Add **`bullmq` exactly `6.2.0`** (no Nest queue wrapper or Meta SDK),
using Redis connection options and separate queue connections, not the API's bounded ioredis client. The stack
already requires BullMQ for work exceeding 200 ms. Its [release](https://github.com/taskforcesh/bullmq/releases/tag/v6.2.0)
fixes the dependency baseline; [stalled-job recovery](https://docs.bullmq.io/guide/jobs/stalled) explains why the
database fence remains necessary. Node 24/Redis 7 compatibility is a PR 4 gate, not claimed verified here.

Outbox supplies tenant ids: no new reader/grant/raw client. All sender database access uses `withTenant`.
The deadline governs request start, not Meta's eventual delivery/completion.

### 2. Attempt schema and suppression seam

`notification_attempts` is tenant data. Columns:

| Columns                                                 | Type / rule                                                                                                                            |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `company_id`, `id`                                      | UUID, NOT NULL; PK `(company_id, id)`; id generated by injected UUID v7 generator                                                      |
| `business_id`, `branch_id`                              | nullable UUIDs for company-wide messages; tenant-qualified FKs, branch requires business                                               |
| `source_event_id`, `channel`, `template_key`            | NOT NULL UUID/text/text; logical message identity                                                                                      |
| `template_revision`, `locale`, `provider_template_name` | immutable revision; locale `ar`/`en`, nullable only for locale-failure rows; approved name nullable for pre-send configuration failure |
| `recipient_phone`                                       | nullable text, canonical E.164; required at PENDING, NULL in every terminal state                                                      |
| `recipient_hash`, `hash_key_id`, `phone_last3`          | HMAC-SHA256 bytes, key identifier, exactly three digits; retained after phone clearing                                                 |
| `safe_parameters`                                       | allowlisted JSON values only; no OTP code, bearer link/token or arbitrary body                                                         |
| `status`, `authorized_at`, `send_deadline`              | constrained status, UTC timestamptz; nullable deadline                                                                                 |
| `execution_id`, `sending_at`, `finished_at`             | nullable UUID/timestamptz; execution fence and result times                                                                            |
| `provider_message_id`, `failure_code`, `outcome_known`  | nullable opaque provider id, finite diagnostic code, nullable boolean                                                                  |
| `created_at`, `updated_at`                              | UTC timestamptz; injected clock for application decisions                                                                              |

Unique `(company_id, source_event_id, channel, recipient_hash, template_key)`. Locale/revision/config changes
cannot resend. Keep the platform hash stable across tenants; key rotation needs an alias migration preserving
historical dedupe and suppression. `hash_key_id` is metadata, not a uniqueness dimension. Changing identity
fields to bypass dedupe is forbidden.

`recipient_hash = HMAC-SHA256(NOTIFICATION_PHONE_HASH_KEY, canonical E.164)` with domain separation. The random
platform key comes from Dokploy secrets/env, shared by consumer hashing, sender and PR 5 STOP handling; it is never
in Postgres, Redis or logs. Hashing runs in an adapter; pure domain functions receive the hash and time.

RLS: ENABLE + FORCE; SELECT `USING (company_id = app_company_id())`, INSERT `WITH CHECK` and UPDATE both clauses,
TO `pospay_app`. No runtime DELETE grant; no `pospay_auth`/`pospay_dispatcher` access. `company_id` references
`companies(id)`; business/branch FKs include `company_id`. No FK to the source outbox row: dedupe must survive
outbox retention. Add indexes on `(company_id, business_id)`, `(company_id, branch_id)`,
`(company_id, created_at DESC, id DESC)` and `(company_id, status, created_at, id)`; the PK/unique index cover
tenant and source-event lookup. Add indexes concurrently following the existing migration convention.

| Transition                    | Meaning                                                                                                                 |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| new → PENDING                 | durable authorization, one sender job recorded atomically                                                               |
| new/PENDING/SENDING → EXPIRED | deadline passed before provider submission; zero HTTP calls                                                             |
| PENDING → SENDING             | one execution owns the irrevocable send permission, committed before HTTP                                               |
| new/PENDING → FAILED          | locale missing/unsupported, destination invalid, config invalid or local admission refused; zero HTTP calls, no new job |
| SENDING → SENT                | Meta accepted the one submission, provider message id recorded                                                          |
| SENDING → FAILED              | rejection or uncertain network outcome; `outcome_known` distinguishes these                                             |
| new → SUPPRESSED (PR 5)       | STOP already committed; zero calls and no sender job                                                                    |

Terminal states never return to PENDING. Crashed SENDING remains **unknown and visible**, with no lease sweep
or retry. Result persistence may retry its fenced result; provider submission cannot. Every terminal insert/update
stores `recipient_phone = NULL` atomically, enforced by a CHECK constraint; no later redelivery repopulates it.

PR 4 reserves `SUPPRESSED` and a transaction-bound `SuppressionGate` port, but creates no suppression table or
STOP handler. Before insert, take `pg_advisory_xact_lock` on a namespaced 64-bit digest of the platform phone
hash (**without company id**); colliding hashes merely serialize. PR 5's restricted global-table adapter checks
suppression on this same transaction/connection and its STOP handler takes the identical lock before upsert.
No check in Redis or a separate transaction. Authorization linearizes at attempt commit: STOP blocks attempts
not yet authorized, while already authorized PENDING/SENDING attempts may finish. Production customer sends
remain disabled until PR 5 supplies the real gate; the PR 4 no-suppression binding is fake-development only.

### 3. Phone transport and privacy

The producer's event carries the canonical E.164 destination. Source outbox payloads are tenant data under RLS;
the existing dispatcher exception remains unchanged. The consumer snapshots the supplied phone into
`recipient_phone` in the attempt transaction. The sender reads that snapshot through `withTenant`; later contact
edits do not change the event or authorized destination. Notifications has no recipient reader or contact lookup.

Clear `recipient_phone` in the same transaction recording SENT/FAILED/EXPIRED/SUPPRESSED, including terminal rows
inserted without authorization. A crashed SENDING retains it. An explicit, audited cleanup may NULL it once
`sending_at` is at least 24 hours old **and the owning worker execution has been stopped/drained**; supply known
company/attempt ids and use `withTenant`, with no cross-tenant scan. Cleanup leaves status/execution/hash/dedupe
unchanged, emits no invented delivery result and grants no resend permission. It is not a lease-recovery sweep.
The sender drops its local destination after finishing; log/query DTOs never select or return `recipient_phone`.

Clearing the attempt phone does not erase the source event: its phone follows existing outbox retention, not
attempt retention. Internal authorization/result events and BullMQ data contain no phone. Dispatcher, park and
consumer diagnostics never print event payloads. No full phone in audit details, logs, errors or traces.
Diagnostics allow context ids, channel/template/status/finite codes and last3 only; never log the hash or raw
destination. Drop Meta bodies; keep validated message id/status/code. Redact database parameter errors and exclude raw bodies from Sentry/job
failure strings. OTP codes and sensitive rating links/tokens still never enter Postgres, event/job JSON or logs.
PR 4 has no runtime sensitive-parameter transport: `staff_otp` is a definition only; `rating_request` is deferred
to the ratings slice, which must settle safe link derivation before enabling it.

### 4. Failures

| Failure window                                                  | Outcome / recovery                                                                                               | Can lose a message?                             |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| consumer rolls back before authorization commit                 | no attempt/job; source outbox may redeliver                                                                      | no committed send yet                           |
| locale missing or unsupported                                   | terminal FAILED (`LOCALE_MISSING`/`LOCALE_UNSUPPORTED`), attempt phone NULL, failure event only; zero HTTP calls | yes, deliberately refused                       |
| crash after authorization commit, before enqueue                | attempt destination/outbox survive; dispatcher retries enqueue                                                   | if deadline expires or event parks              |
| enqueue succeeds, publication mark lost; two jobs/workers       | same attempt; only one PENDING→SENDING commit wins                                                               | no extra submission                             |
| crash before SENDING commit                                     | job may retry PENDING, reading stored destination and rechecking deadline                                        | if its window expires                           |
| SENDING commit reply unknown, or crash after commit before call | no new execution; leave unknown SENDING                                                                          | yes, may never submit                           |
| provider 4xx (including 429) / 5xx                              | FAILED and destination cleared atomically; no HTTP retry                                                         | yes; 5xx can be ambiguous                       |
| timeout, connection loss or malformed success response          | FAILED, destination cleared, `outcome_known=false`; abort bounded request; never retry                           | yes, provider may have accepted                 |
| provider accepts, crash before result commit                    | unknown SENDING; job recovery skips; never resubmit                                                              | delivery may have occurred; log outcome is lost |
| result DB write fails                                           | retry recording that result only, fenced, never Channel.send                                                     | result may remain unknown                       |
| terminal transaction rolls back                                 | old state and destination remain together; retry the same result recording only                                  | no additional submission                        |
| crashed SENDING cleanup                                         | after ≥24 h and execution stopped/drained, clear destination only; no resend                                     | prior send outcome remains unknown              |

All windows prevent a second application submission. No claim is made about Meta's internal delivery behavior.
The channel uses a 10-second request timeout, shortened by remaining deadline; rate-limit admission happens
before the send claim and cannot sleep past the deadline. Rate-limit quantities remain an owner question.

### 5. Templates and configuration

`packages/notifications` owns provider template definitions and ar/en copy; `packages/i18n` owns delivery-log
UI labels/formatters. A definition has logical key, revision, supported locale codes, Meta category, ordered
header/body/button parameter descriptors (name, type, required, sensitivity), and ar/en text for approval/preview.
Validation enforces exact order/count/types and approved language; no runtime free-form WhatsApp text.

PR 4 defines only `staff_otp` (authentication; ordered sensitive parameter `code`), with ar/en definitions and
contract tests; it neither generates nor delivers a real OTP until PR 6. Exact wording/category/button components
await Meta/owner confirmation. Defer `rating_request`, its bearer link and opt-out link to the ratings slice;
do not add a token/link transport in PR 4. Later producers add their alert definitions in their own slices.
Every real approved template name is **`TODO(spec)`**, configured by logical key/locale, never invented here.

Producers choose recipient locale, snapshot it into the event and never make notifications read business
settings. There is **no fallback**: missing locale records terminal FAILED with `LOCALE_MISSING`; any value other
than `ar`/`en` records `LOCALE_UNSUPPORTED`. Store NULL locale for these failures, clear the attempt phone, emit
`NotificationFailed` and create no sender job; zero HTTP calls. Missing approved mapping also fails closed before
HTTP. Copy and Meta names remain `TODO(spec)` for owner approval. Template changes cannot create a new send.

Platform-only `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, version and hash key are injected
from Dokploy secrets/env. No credential/config table, tenant sender number or token in job data; API needs no
WhatsApp access token. Dokploy protects secret storage; no database credential decryption is introduced.
Pin `WHATSAPP_GRAPH_API_VERSION=v23.0`, fixed origin `https://graph.facebook.com`, endpoint
`/{version}/{phone-number-id}/messages`, Bearer header, `type=template` and explicit language/components, following
[Meta's published v23.0 API contract](https://github.com/facebook/openapi/blob/main/business-messaging-api_v23.0.yaml).
Version upgrades require adapter contract checks; no `latest` or caller-supplied host/version.

`Channel.send` performs one submission and returns accepted/rejected/unknown diagnostics; it owns no persistence,
queue or retry policy. Bind the WhatsApp adapter only in the worker notification module. The fake implements the
same interface with programmable acceptance, 4xx/5xx, timeout and crash hooks, never a real account/token.
`NOTIFICATIONS_MODE=fake` is the local/test default; production refuses fake mode. Live readiness requires
credentials, approved copy/names and PR 5 suppression; PR 6 additionally resolves OTP/admission policy.
No sandbox phone is printed in logs.

### 6. Result events and later channels

Orchestrator decision (2026-10-01): `SENT` / `NotificationDelivered` mean **provider accepted the submission**,
with `evidence = PROVIDER_ACCEPTED`, not confirmed delivery/read on the handset. Emit it only in the transaction
recording the validated accepted result. `NotificationFailed` is emitted with FAILED, EXPIRED or (PR 5) SUPPRESSED, including
`outcome_known=false` for uncertainty. Crashed unknown SENDING emits neither invented success nor invented failure.
Every result event contains `company_id`, `attempt_id`, `source_event_id`, `business_id?`, `branch_id?`, `channel`,
`template_key`, `locale` (nullable for locale failures), `status`, `occurred_at`, `evidence` and `failure_code?`/`outcome_known?`; **no phone, hash,
parameters, token or credential**. Reporting is the existing consumer. Result write retries
emit once through the fenced transition/outbox transaction. Handset delivery callbacks are a separate slice.

PR 4b adds in-app store/list/mark-read/bell under tenant/recipient authorization. It reuses template/result contracts
with user recipients; creation stays database-only in the consumer transaction. PR 14 adds email after ADR-0014.
Neither adapter/UI, nor SMS/push, ships in PR 4.

PR 4b decision: `IN_APP` recipients carry `user_id` (global platform identity), strict ar/en locale,
template key/revision and safe ordered values. Initially only `generic_notice` revision 1 with safe `subject`
is supported; sensitive `staff_otp` cannot reach IN_APP. Rendering lives in the i18n `inApp` catalog.
Company FORCE RLS protects the database-only worker path; all API queries/mutations also filter by session
user inside `withTenant`. `@Authenticated()` plus SelectedCompanyGuard rechecks active membership via
`withUser` and requires `x-company-id`; no role permission is needed for a personal inbox or acknowledgment.
The administrative delivery-log permission is unchanged. Device/key principals are refused.
PR 4b review fixes also verify the selected company is open inside `withTenant` after membership,
and scope browser inbox caches/invalidation by company and session user. The dashboard frame passes
the session identity into the bell; identity navigation broadcasts before loading and peer tabs clear
their shared QueryClient and reload, with a guarded fallback when BroadcastChannel is unavailable.
Creation and its `NotificationDelivered` result commit with consumer dedupe. The reused envelope's
`attempt_id` identifies the inbox row, `recipient_user_id` identifies the recipient, and evidence
`IN_APP_STORED` means durable inbox creation, never provider submission or user read. No authorization
queue event is created. Invalid in-app contracts reject the transaction. Read writes return identical
HTTP 200 acknowledgments for own, absent and foreign ids, preserve the first read timestamp and publish
no delivery/read event. Cursor order is `(created_at DESC,id DESC)`; the bell shows the latest 20 and
polls every 60 seconds. Indexes ship with the new table, without a concurrent rebuild.

### 7. OTP in PR 6

ADR-0019 settles PR 6 as an auth-owned flow on pinned Better Auth 1.7.5; neither phoneNumber nor emailOTP is registered. The paired Device credential and explicit POS Origin precede all global identity work. An approved phone plus active device-scoped membership and explicit login:staff:branch permission may receive a staff-purpose, isolated-cookie session ending at the original eight-hour deadline, without idle timeout or sliding renewal.

Global auth_otp_challenges holds only the independently keyed code MAC; auth_notification_attempts holds recipient hashes, immutable deadlines and execution/result metadata. Auth deterministically derives the same challenge-bound code in API/worker memory; it recovers only the linked user's matching current approved canonical phone. No phone/code/token reaches either ledger, an event/job, outbox or diagnostics. The narrow worker facade exposes no directory, session issuance, tenant reader or SQL. Auth alone receives suppression boolean EXECUTE; exact column grants and retention are classified in ADR-0003.

Under the shared phone lock, commit challenge + non-sendable PREPARED, then await one bounded id-only notifications-otp enqueue. Only acknowledged enqueue permits API-only PREPARED→PENDING release after fresh STOP, activation, expiry and wall-clock checks before the immutable preparation deadline. An early worker keeps its same execution alive, polling through short closed reads and waiting outside transactions until that fixed deadline. Its final locked timeout records PREPARATION_WINDOW_ENDED and sends nothing; an on-time PENDING release proceeds through acknowledged PENDING→SENDING fencing. No retry, recovery sweep, late release or unknown commit grants permission. Crash gaps may lose delivery; recovery creates a new challenge after cooldown.

Reserved OTP concurrency is four; the pilot submission target is five seconds. Redis recipient admission is shared with tenant traffic at 1000 ms and fails closed. Validity is 300 seconds; request admission is five/phone/hour, twenty/IP/hour and sixty-second phone cooldown; verification is twenty-five/phone/hour, one hundred/IP/hour and five authoritative challenge failures. Every admitted request outcome returns the same 202 and common 200 ms response window, including preparation/enqueue failures and suppression. Before lookup, common disabled/unavailable capability returns generic 503; common rate refusal returns generic 429.

STAFF_OTP_ENABLED defaults false. Empty or partial live settings close OTP only, independently of ordinary API/worker startup and readiness. Explicit activation additionally requires independent keys, exact roles/grants, live STOP subscription, shared Redis, reserved id-only consumer and approved ar/en AUTHENTICATION names/components. Only OTP live dispatch opens; tenant outbound remains separately closed. Final copy/names/components remain TODO(spec) until approved. The separate OTP-only transient renderer never relaxes tenant sensitive-parameter rejection. ADR-0019 §7 specifies the full test obligations.

### 8. PR 4 files and verification

Implementation inventory (future PR 4; this design writes only this ADR). Braces below enumerate exact names:

```text
docs/specs/notifications/authorize-notification/spec.md
packages/contracts/src/notifications.ts
packages/db/schema/notifications.ts
packages/db/migrations/NNNN_YYYY-MM-DD_notification-attempts.sql
packages/db/migrations/NNNN_YYYY-MM-DD_notification-attempts-rls.sql
packages/db/src/__tests__/rls-notifications.spec.ts
packages/notifications/{package.json,tsconfig.json,vitest.config.ts}
packages/notifications/src/{index.ts,channel.ts,configuration.ts,phone-identity.ts}
packages/notifications/src/adapters/{whatsapp.channel.ts,fake.channel.ts}
packages/notifications/src/templates/{definition.ts,staff-otp.ts}
packages/notifications/src/__tests__/{channel.spec.ts,templates.spec.ts,phone-identity.spec.ts}
apps/api/src/modules/notifications/{notifications.module.ts,index.ts}
apps/api/src/modules/notifications/queries/{delivery-log.query.ts,__tests__/delivery-log.query.spec.ts}
apps/api/src/modules/notifications/http/notifications.controller.ts
apps/worker/src/modules/notifications/{notifications.module.ts,index.ts}
apps/worker/src/modules/notifications/domain/{attempt-status.ts,send-deadline.ts,__tests__/delivery-policy.spec.ts}
apps/worker/src/modules/notifications/ports/{attempts.repository.ts,suppression-gate.port.ts,channel.port.ts,send-admission.port.ts,clock.port.ts,id-generator.port.ts}
apps/worker/src/modules/notifications/use-cases/authorize-notification/authorize-notification.ts
apps/worker/src/modules/notifications/use-cases/send-notification/send-notification.ts
apps/worker/src/modules/notifications/use-cases/clear-abandoned-destination/clear-abandoned-destination.ts
apps/worker/src/modules/notifications/persistence/{drizzle-attempts.repository.ts,phone-lock.ts,no-suppression.gate.ts,channel.adapter.ts,redis-send-admission.ts}
apps/worker/src/modules/notifications/events/{published.ts,handlers/on-notification-request.handler.ts}
apps/worker/src/modules/notifications/jobs/{publish-authorized-notification.ts,send-notification.processor.ts,clear-abandoned-destination.processor.ts}
apps/worker/src/modules/notifications/__tests__/{authorization.spec.ts,sender.spec.ts,transport.spec.ts,privacy.spec.ts,destination-cleanup.spec.ts}
```

Allocate migration ordinals/dates during implementation, with generated Drizzle metadata. Reserve API `domain/`,
`use-cases/`, `ports/`, `persistence/`, `events/handlers/` and worker `queries/`, populating only when needed.
Worker `jobs/` replaces `http/`. No deep imports; shared wire contracts use contracts. Ports use own domain types;
outer adapters import the package; concrete bindings live only in `notifications.module.ts`, like identity.
Exported domain functions, port methods and published events carry Arabic JSDoc. Domain rules stay pure;
use cases receive clock/id/channel ports and import neither infrastructure nor the notification package.

Existing-file integration: contracts index, DB migration journal/snapshots and privilege-test allowlist;
API root wiring/route guard coverage; worker main/root/shutdown/config/log-event catalogue and outbox transport
routing; app/package manifests and lockfile; `.env.example` and deploy secret injection; observability redaction;
governing map changes below. PR 4 ships only the company/business/branch-scoped, cursor-paginated delivery-log
GET, guarded by `view:notifications:business`, granted to owner and manager roles. The admin screen comes in a
later slice. No resend action anywhere; preserve dedupe identities independently of ancillary log retention.

Required implementation tests: restricted-role RLS read/insert/update/delete/upsert/re-home/FK/context-leak
negatives; dispatcher/auth cannot read attempts; rollback leaves neither attempt nor authorization event;
source redelivery, duplicate enqueue, removed BullMQ job recreated and two competing processors produce ≤1
provider call; every crash/unknown-commit window in §4; deadline advances after authorization, claim and before
HTTP (also null deadline and the closing grace); fake acceptance/4xx/429/5xx/timeout; immutable template identity
and ordered ar/en parameters; missing/unsupported locale commits FAILED with the respective code, NULL phone,
failure event and no job/HTTP; fenced result/outbox/phone-clear atomicity and rollback; full synthetic phone
round-trips through tenant source-event JSON into the attempt without contact reads, under RLS; phone absent
from log DTOs/internal authorization/result events/job JSON/logs/errors/traces, including dispatcher/park/consumer diagnostics;
terminal CHECK rejects retained destination; unknown SENDING retains it until eligible, execution-drained cleanup;
cleanup preserves hash/dedupe/status and cannot resend; code/link/token absent from Postgres/event/job JSON/logs;
owner/manager GET authorization, other-role denial, tenant/business/branch scope and cursor pagination;
accepted result emits `evidence=PROVIDER_ACCEPTED`; hash stable across companies. Gate seam test asserts lock/check/insert
share one transaction; PR 5 adds the real STOP-vs-authorization race. Query shape/EXPLAIN checks and all repository
CI gates run in implementation, **none in this design step**. Real Meta credentials are never required in CI.

### 9. Governing amendments — listed, not applied

- `module-map.md` §4: add internal `NotificationSendAuthorized`, notifications → worker transport publisher
  (not reporting/realtime); preserve existing result arrows and root-level notifications imports. Regenerate
  its YAML when implementing; no new business-module import/write arrow.
- `module-map.md` restricted-package prose/checker: explicitly permit application composition roots to wire
  notifications/auth facades for OTP (ADR-0010's existing wiring intent), without
  allowing identity/staff/customers to import `packages/notifications`. Worker notifications remains its owner.
- `CLAUDE.md` §6: describe the outbox-to-BullMQ transport publisher outside database consumers. No privacy-storage
  exception, change to the 200 ms rule or relaxation of DB-only consumers is needed.
- ADR-0003: **no PR 4 tenant-access exception or dispatcher grant change**. PR 6 must classify the global OTP
  ledger and exact auth-facade grants before its migration; PR 5/ADR-0013 owns suppression access and privileges.
- Constitution/module-map restricted-package text reflects only the narrow OTP wiring clarification; SPEC's
  Customer.phone and CLAUDE.md's logging rule need no correction.

### 10. Owner decisions — 2026-10-01

- Locale has no fallback. Missing/unsupported locale records terminal FAILED with `LOCALE_MISSING`/
  `LOCALE_UNSUPPORTED`, clears the attempt phone and makes zero HTTP calls. Template copy and Meta names remain
  `TODO(spec)` for owner approval.
- `view:notifications:business` is granted to owner and manager roles. PR 4 ships the scoped, cursor-paginated
  GET only; the admin screen is a later slice. No resend action anywhere.

## Alternatives considered

| Alternative                                                                  | Rejected because                                                                                                                      |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP in API, in an outbox consumer, or while holding a DB transaction        | violates the 200 ms/consumer rules; rollback cannot undo a provider submission                                                        |
| enqueue directly after consumer commit                                       | consumer cannot do queue I/O; crash loses the handoff unnecessarily; reuse transactional outbox instead                               |
| cross-tenant sender loop with SKIP LOCKED / extending dispatcher to attempts | would require new reader/grants; an outbox job already supplies tenant ids                                                            |
| lease/retry SENDING, SDK retries, provider idempotency alone                 | uncertainty can duplicate; job-id dedupe/Meta behavior are not the end-to-end guard                                                   |
| notifications reads customers/staff/identity contacts                        | contradicts SPEC §3: producers resolve recipients/channels into events; notifications must hold no business knowledge                 |
| phone in BullMQ, external destination vault or lookup by hash                | tenant source outbox and attempt storage suffice; jobs need only ids, extra infrastructure is unnecessary and hashes are irreversible |
| ephemeral process cache/live Pub/Sub rendezvous                              | couples producer/sender lifetimes and worker affinity; fragile across the separate/scalable containers                                |
| template text in i18n, runtime free text or per-tenant Meta credentials      | provider components/approval belong to notifications; scope is approved templates and one platform sender                             |
| Meta SDK, new scheduler/queue library or Nest BullMQ wrapper                 | Node HTTP, chosen BullMQ and existing outbox suffice; extra retry behavior/dependencies buy nothing                                   |
| tenant ledger for pre-login OTP, or direct OTP HTTP                          | no verified tenant exists; weakens ADR-0003 or blocks the API                                                                         |
| rating-link storage/transport in PR 4                                        | ratings has not shipped; defer its definition and safe link derivation to that slice                                                  |
| locale fallback or resend action                                             | rejected by the owner; record locale failures and preserve at-most-once identities                                                    |
| report accepted API response as handset delivery without qualification       | inaccurate; decided acceptance semantics use `evidence=PROVIDER_ACCEPTED`, with receipts deferred                                     |

## Open questions for the owner

1. **OTP template/recovery approval (`TODO(spec)`, PR 6):** actual approved ar/en AUTHENTICATION names,
   copy and components, and final bilingual recovery copy remain required before live activation.
   ADR-0019 records the settled owner decisions: 5-minute validity, 60-second new-code cooldown,
   5 requests/phone/hour, 20/IP/hour, 1 outbound message/recipient/second, reserved concurrency 4,
   ≤5-second submission target and STOP blocking OTP. Recovery uses the employee's own PIN with
   separately attributed manager assistance. These admission and session decisions are no longer open.

## Consequences

- At-most-once submission is enforced by committed authorization and the irreversible execution fence; crashes
  can lose delivery or its evidence. Monitoring must show unknown SENDING without a resend recovery action.
- The second outbox hop adds queue latency but closes the commit/enqueue gap with existing infrastructure and
  preserves ADR-0003. OTP avoids that hop through its later global auth ledger and separate queue.
- Producers carry destinations in tenant source outbox events; notifications snapshots them without contact
  reads. Attempt phones clear atomically on terminal states; source phones follow outbox retention. Unknown
  SENDING needs explicit cleanup after ≥24 hours and execution drain. Hashes retain dedupe/suppression.
- Event payloads require strict dispatcher/park/consumer diagnostic redaction. Locale failures have no fallback;
  delivery events explicitly report provider acceptance. The owner/manager log GET ships in PR 4; its UI is later.
- PR 4 supplies the delivery protocol/package/log backend, `staff_otp` definition and synthetic fake proof.
  Copy/Meta names await owner approval; customer sends require producer events and PR 5 suppression. The ratings
  slice owns `rating_request` and safe link derivation; no sensitive-parameter transport ships in PR 4.
- PR 4b owns in-app store/list/read/bell; PR 5 owns global suppression and signed STOP callback; PR 6 owns OTP
  auth-owned flow, ledger and root binding; PR 14 owns email after its provider ADR. Business alert producers, ratings
  claim/attribution and handset receipt tracking remain their own slices.
