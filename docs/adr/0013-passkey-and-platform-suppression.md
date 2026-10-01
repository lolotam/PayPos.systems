# ADR-0013 — Passkey and platform WhatsApp suppression

- **Status:** Accepted
- **Date:** 2026-10-01
- **Gate:** Phase 1 · G4, before PR 5 (`platform suppression`) and PR 20 (`enrol-passkey`)

## Context

Phase 1 SPEC §9 item 4 requires this decision. SPEC §10 makes a WhatsApp STOP global to our one sender:
it blocks attempts not yet authorized when STOP commits. Rating-page opt-out has a different boundary:
it blocks requests not yet claimed; at most one already-claimed request per business that day may arrive.
SPEC §4/§7 requires one active employee passkey binding, automatic first enrollment after OTP, manager
unbind with audit, and a fresh assertion with user verification for every QR attendance clock.

ADR-0003 classifies identity, bridge, reference and tenant data; none classifies global messaging state.
ADR-0018 supplies the platform HMAC, company-independent phone lock, transaction-bound `SuppressionGate`,
terminal `SUPPRESSED`, and commit-before-call sender fence. PR 4 implements those seams, not STOP storage.
Currently `apps/worker/src/main.ts` disables the whole notification module for `NODE_ENV=production`
(including staging); configuration and module factories also reject live mode. Admission defaults to
allow-all only behind that development gate. `packages/auth/src/config.ts` enables TOTP only, with
Better Auth and its Drizzle adapter pinned to 1.7.5 (ADR-0009). This ADR changes no runtime behavior.

## Decision

### 1. Global suppression and exact database access — PR 5

Add `public.platform_whatsapp_suppressions`, classified as **global messaging control**, a new named
ADR-0003 class. No company/business/branch/user key and no tenant RLS: the same recipient is suppressed
across every tenant sending from our platform number. It is neither identity nor shared reference data.

| Column | Constraint / meaning |
|---|---|
| `recipient_hash` | `bytea`, primary key, exactly 32 bytes; the platform phone HMAC |
| `hash_key_id` | non-null key identifier; metadata, never part of uniqueness |
| `source` | non-null `STOP` or `MANUAL`, source of the latest distinct opt-out |
| `first_opted_out_at` | non-null UTC `timestamptz`, first accepted opt-out, immutable |
| `last_opted_out_at` | non-null UTC `timestamptz`, latest distinct accepted opt-out; >= first |
| `opted_back_in_at` | UTC `timestamptz`, default NULL; Phase 1 `CHECK (opted_back_in_at IS NULL)` binds INSERT and UPDATE |

An existing row is suppressed while `opted_back_in_at IS NULL`. Phase 1 enforces that invariant in the
database: no runtime role has INSERT or UPDATE privilege on `opted_back_in_at`, and the CHECK rejects
non-NULL values even on INSERT by a privileged maintenance connection. No runtime role can alter the
constraint. A later approved recipient-consent flow must explicitly amend both the constraint and the
column grants, retain history and audit every removal. Duplicate message digests change no timestamps;
replaying STOP is not a repair mechanism for improperly lifted suppression.
Never store a full phone, even encrypted, in these global tables, audit, jobs or diagnostics. No deletion
or automatic expiry of suppression. Keep the exact PR 4 identity:
`HMAC-SHA256(key, 'pospay:notifications:phone:v1\0' || canonical E.164)`; canonicalize Meta `from` by
validating its international digits and adding `+`, with no guessed country code. Use `createPhoneIdentity`.
Freeze the key in Phase 1. Rotation needs an alias/retained-key migration preserving old suppression,
message-digest dedupe and one common lock identity; changing key id or independently rehashing is not a
rotation plan.

Add global `platform_whatsapp_inbox` and `platform_whatsapp_audit`, in the same class, owned with the
suppression table by migration-only `pospay_owner`. Inbox columns: UUID v7 `id`, unique
`provider_message_digest` (`bytea`, non-null, exactly 32 bytes), `recipient_hash`, `hash_key_id`,
`command` (`STOP|OTHER`), provider timestamp,
`received_at`, nullable privacy-scrubbed `raw_event` JSONB, `suppression_applied_at`, `processed_at` and
`enqueue_confirmed_at`. There is no original `provider_message_id` column. Index unfinished enqueue/processing
rows by time/id. The permanent unique digest survives payload cleanup; `hash_key_id` is metadata, not part
of digest uniqueness. Audit is append-only: UUID v7 id, hash/key id, source, `inbox_id` FK to inbox UUID for
STOP (mandatory), or operator identity for MANUAL, finite action/reason code, time. Audit never stores a
provider message id. No arbitrary text or tenant/customer identifiers.

Treat Meta's original message id (`wamid`) as phone-bearing data, not an opaque safe identifier. Its only
application lifetime is in memory during verified intake, including the transient raw body. Compute
`HMAC-SHA256(key, 'pospay:notifications:provider-message:v1\0' || UTF8(complete provider message id))`
using the same platform key family and key id as the phone hash, with this distinct domain label. Use the
complete id exactly as received: no Base64 decoding, trimming, case folding or substring extraction.
Only the digest may enter persistence or scrubbed envelopes; queues use inbox UUIDs. Logs, diagnostics,
errors and traces must never print the original id, including nested ids or validation-error input.

Clear scrubbed inbound payload JSON (`platform_whatsapp_inbox.raw_event`) after 30 days from `received_at`.
Keep message-digest dedupe, suppression rows and the minimal append-only audit indefinitely. Payload cleanup
must not delete dedupe identities, clear suppression or permit a command to be replayed.

| Principal | Exact additional privileges |
|---|---|
| `pospay_notifications` | new LOGIN, NOSUPERUSER, NOBYPASSRLS, NOINHERIT, NOCREATEDB, NOCREATEROLE, owns nothing and member of no role; database CONNECT and schema `public` USAGE; suppression SELECT, column INSERT on `recipient_hash,hash_key_id,source,first_opted_out_at,last_opted_out_at` and column UPDATE on `source,last_opted_out_at` only (no table-wide INSERT/UPDATE and no write to `opted_back_in_at`); inbox SELECT/INSERT of the digest-only schema and UPDATE of `raw_event,suppression_applied_at,processed_at,enqueue_confirmed_at` only; audit INSERT of the inbox-UUID/operator schema only |
| `pospay_suppression_reader` | new NOLOGIN with the same restricted attributes, member of no role; schema USAGE and suppression SELECT only; owns the check function below, no tables |
| `pospay_app` | EXECUTE on `public.platform_whatsapp_is_suppressed(bytea)` only; no direct privilege on any of the three global tables |
| `pospay_auth`, `pospay_dispatcher`, `PUBLIC` | no privilege on these tables and no EXECUTE on that function |
| `pospay_owner` | migration ownership/access; operator inspection/retention maintenance only, never a serving connection |

No additional sequence, DELETE, TRUNCATE, REFERENCES, TRIGGER, schema CREATE, database CREATE, role
membership or SET ROLE privilege is granted to runtime roles. Explicitly revoke default PUBLIC function
EXECUTE. Create the reader-owned function as `SECURITY DEFINER`, `SET search_path = pg_catalog, pg_temp`,
with fully qualified static SQL against `public.platform_whatsapp_suppressions`; validate a non-null
32-byte argument and return only the boolean. No dynamic SQL, tenant/outbox/identity read, or phone lookup.
Use a fresh READ COMMITTED statement snapshot after lock acquisition; do not cache its result or execute
lock and check in one pre-lock snapshot. Errors abort authorization, never become `false`.

The worker binds `SuppressionGate` in its notification composition root to a persistence adapter capturing
the **existing `Tx`**. It calls the function after `AuthorizationRepository.lock(hash)` on that same
connection, then inserts the tenant attempt/result/outbox under the existing RLS. The definer briefly reads
only global state; the caller remains `pospay_app` for tenant writes. No new pool, SET ROLE or tenant-access
exception is used by the consumer. The API intake has a separate restricted `packages/db` facade on
`pospay_notifications`, wired only to notifications, returning bounded global transactions and no raw
client. Its startup/readiness verifies the role and privilege inventory and the validated NULL-only
constraint; a missing constraint or excess column/table write grant fails readiness. It cannot access
tenant data.

### 2. Meta webhook intake — PR 5

Register GET and POST `/v1/webhooks/whatsapp` on `api.pospay.systems`; staging uses
`api.staging.pospay.systems` and its own sender, keys and secrets. Explicit public-route inventory entries
replace session authentication with the following verification; there is no company header or tenant lookup.

- GET requires `hub.mode=subscribe`, a constant-time match of `hub.verify_token` against
  `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, and a bounded `hub.challenge`; return that challenge as plain text with
  HTTP 200. Invalid/missing values return 403. Do not echo or log the token/query string.
- POST requires a single well-formed `X-Hub-Signature-256: sha256=<64 hex digits>` and a constant-time
  comparison against HMAC-SHA256 of the **original body bytes** with `WHATSAPP_APP_SECRET`, not the access
  token or verify token. Reject missing/bad signatures with 401 before parsing or storing provider data.
  [Meta's webhook reference](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/webhooks/start/)
  documents the two verification mechanisms; its archived SDK is not installed.
- Capture a Buffer with Nest/Fastify `rawBody: true` and `RawBodyRequest<FastifyRequest>`; preserve the
  body parser, cap the route at 1 MiB, reject unsupported content encoding/types, and never reconstruct
  signature input with `JSON.stringify(request.body)`. Signature verification uses that Buffer before
  application processing; discard it afterward. Use Nest's
  [Fastify raw-body support](https://docs.nestjs.com/faq/raw-body), without another webhook library.
- Validate the signed envelope's WhatsApp object, WABA id and `metadata.phone_number_id` against the
  configured platform sender. Iterate all messages in all entries/changes. No contact-name matching or
  inference from quoted outbound messages. Status receipts and non-command messages have no suppression
  effect; handset receipt tracking remains a later slice.
- Redis limits: GET 10/IP/minute; POST 120/IP/minute before verification, then 600/verified sender/minute.
  Excess returns 429 with Retry-After; Redis unavailable returns 503. Use trusted proxy IP resolution,
  bounded body/concurrency and shared counters, not process memory or a Meta IP allowlist.

**Verify signature → store raw → enqueue → ack 200** is retained with an explicit privacy clarification:
the durable raw-event record is a **scrubbed provider envelope, not the signed byte-for-byte body**.
Keep only explicitly safe allowlisted structural ids, timestamps, message type and a finite command;
replace the original message id with `provider_message_digest` (encoded as hex) and its key id. Replace `from`,
`wa_id` and any destination identifiers with the platform phone hash/key id, and omit display phone number,
profiles, text bodies, captions, media, contacts, quotes and unknown fields. Free text is classified in
memory and discarded; omit all other provider message ids, including nested/status/context ids. An allowlist
prevents phones hidden in text, identifiers or unknown fields from being persisted. The original message id
exists only in memory during intake and is never copied into the scrubbed envelope or diagnostics.
Store this representation in `platform_whatsapp_inbox.raw_event`; keep no original bytes on disk, in
Postgres, outbox, Redis, logs, errors or traces. This requires the listed CLAUDE.md §6 clarification.

After signature/envelope validation, compute the message digest in memory before any durable write.
If the platform key or digest computation is unavailable, return retryable 503; never fall back to an
original id or an unkeyed hash. Do not log the id/body on this or any parsing/validation failure.

In one short READ COMMITTED intake transaction, insert inbox rows idempotently by **provider message digest**,
acquire the common phone locks, apply each new STOP, and append its audit row. Mark suppression applied
in the same commit; suppression INSERT omits `opted_back_in_at`, and upsert updates only source/last time.
Audit references the resulting inbox UUID. Order batch digest insertions and distinct phone locks deterministically to avoid
deadlocks. Bound intake DB/lock work to 200 ms; timeout rolls back and returns retryable 503. Unknown COMMIT
outcome also returns 503 and reconciles by recomputing the same digest on redelivery with the frozen key,
never assumes rollback. A privilege or CHECK failure aborts the transaction and returns 503 without
acknowledging STOP; never remove the constraint or broaden grants to recover intake.

After acknowledged commit, await enqueue to existing BullMQ infrastructure, queue `notifications-inbound`,
with stable inbox-id job identity and id-only data. Then ack 200. Enqueue failure returns 503 without undoing
STOP. Duplicate deliveries retry enqueue but never reapply suppression/audit. A worker inbox sweep recovers
committed, unqueued records after a crash; database processing markers make duplicate/recreated jobs safe.
The digest and inbox UUID remain after 30-day payload cleanup, so redelivery still finds the original
commit/audit and cannot create a second STOP. Neither recovery nor diagnostics needs the original id.
The job performs ancillary processing/marking only: **first application of STOP does not wait for it**.
No provider HTTP runs during intake or a DB transaction; no STOP confirmation message is sent.

Normalize with trim, Unicode NFKC and case-fold English; the whole-message STOP allowlist is exactly
`STOP`, `UNSUBSCRIBE`, `إيقاف`, `ايقاف`, `توقف`, plus the approved STOP button id. Accept only that exact
button id, not an arbitrary button title. `CANCEL`, `إلغاء` and `الغاء` are deliberately excluded: a customer
replying "إلغاء" to an appointment reminder means cancel the appointment, not stop all platform messages.
No substring matching, quoted text or voice/image interpretation. START is unsupported and classified as
OTHER; unknown messages are acknowledged without storing their free text.

### 3. STOP versus authorization — the SPEC §10 proof

Both transactions use `pg_advisory_xact_lock(phoneLockKey(hash))`: PR 4's signed 64-bit SHA-256 digest
with domain `pospay:notifications:phone-lock:v1\0`, **without company id**. Reuse the package function,
not a second implementation. Locks last through commit/rollback; collisions only serialize extra phones.

| Lock winner | Commit order and outcome |
|---|---|
| STOP | Upsert/audit/inbox commit releases the lock; authorization then checks a fresh snapshot, sees suppression, and records terminal SUPPRESSED, NULL destination, `NotificationFailed` with `failure_code=SUPPRESSED`; no authorization event or sender job |
| Authorization | Check plus PENDING attempt/outbox commit while holding the lock; STOP cannot commit between check and insert; after authorization releases the lock STOP commits and blocks subsequent attempts |
| Either rolls back | Its effect never linearizes; the waiting transaction checks committed state normally |

The proof also requires suppression to be monotonic throughout Phase 1: restricted column grants plus
`CHECK (opted_back_in_at IS NULL)` prevent runtime INSERT/UPDATE from making an accepted STOP invisible
to the next authorization. A forbidden opt-in write fails instead of racing successfully with the check.
Digest dedupe and UUID-linked audit commit atomically with STOP. Concurrent duplicate deliveries, an
unknown COMMIT result and redelivery after payload cleanup all identify that same commit; they never
reapply STOP to repair state. Frozen-key digest derivation is therefore part of the retry guarantee.

An attempt's durable authorization is its commit, not `authorized_at` or the start of the SQL insert.
An invalid/expired request can retain PR 4's FAILED/EXPIRED precedence; it still makes zero calls.
Already-authorized PENDING/SENDING attempts **may finish** after STOP: no cross-tenant cancellation scan,
reset, extra sender recheck or new transition is added. At-most-once fencing and deadlines remain intact;
unknown SENDING is never resent. Unrelated templates/businesses can already have authorized attempts, so
STOP has no universal "one final message" bound. The one-request-per-business/day bound belongs to
rating-page opt-out and the rating request uniqueness, not every platform message.

Commit STOP before HTTP 200 so queue lag cannot extend its effective boundary. Meta/network delays before
webhook intake are outside that boundary; no guarantee starts when the person presses Send. Page opt-out
remains tenant/customer-owned and does not create or clear platform suppression.

### 4. Re-subscription and manual changes

There is no re-subscription in Phase 1: no START, no tenant override and no manual removal endpoint.
All opt-in timestamps remain NULL. Platform operators may add manual suppression through the same
hashed/locked path, with a mandatory reason recorded in the append-only audit as a finite reason code.
Manual removal requires a later approved flow with the recipient's consent and does not ship now.
That future flow must explicitly migrate the NULL-only constraint and column grants and audit removal;
an endpoint or runtime grant alone is insufficient. No deletion of a row is a re-subscription mechanism.

### 5. Production gate and delivery dependencies

PR 5 may lift the **suppression-specific** production/staging gate only after it ships the classified
tables/roles/function, exact grant inventory, real transaction-bound gate with fail-closed readiness,
signed live webhook subscription/GET handshake, synchronous STOP commit, durable inbox/enqueue recovery,
privacy handling, and real STOP-versus-authorization proof for two tenants on one phone.

PR 5 must add verification for both defects as part of that gate:

- As the actual intake role, reject INSERT naming `opted_back_in_at` and UPDATE of that column; allow the
  intended column-scoped STOP INSERT/upsert. Verify no runtime role has table-wide or column write access
  to it. Using a privileged connection with the constraint intact, reject non-NULL INSERT and UPDATE;
  readiness must reject missing/unvalidated constraint or excess grants.
- After a committed STOP, attempt forbidden opt-in writes, replay the same digest and authorize from two
  tenants: both checks stay SUPPRESSED with no new STOP audit or timestamps. Exercise concurrent duplicate
  intake, both STOP/authorization lock orders, rollback, unknown COMMIT and enqueue/crash recovery.
- Use a synthetic phone-bearing wamid fixture: prove deterministic whole-id HMAC, distinct ids produce
  distinct digests, and the phone/message domains differ for identical input. Inspect inbox, scrubbed
  envelopes, UUID-linked audit, queues and captured diagnostics on success, invalid input, DB errors and
  retries for absence of the original id/full phone. Do not put real customer data in fixtures.
- Clear payload JSON at 30 days and redeliver the same fixture: permanent digest dedupe and audit linkage
  survive, no command is reapplied and no original id is needed. Missing-key/digest failure returns 503
  with no durable write or privacy fallback.

Validate Dokploy injection of `PLATFORM_NOTIFICATIONS_DATABASE_URL`, `WHATSAPP_APP_SECRET`,
`WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_WABA_ID`, the shared `NOTIFICATION_PHONE_HASH_KEY`/`_ID` and sender
`WHATSAPP_PHONE_NUMBER_ID`. Only the worker needs `WHATSAPP_ACCESS_TOKEN`; API needs no sending token.
Keep `WHATSAPP_GRAPH_API_VERSION=v23.0`, fixed Meta origin, approved ar/en template copy/name mapping and
live-mode validation from ADR-0018. Never permit an environment flag to select `noSuppressionGate` in live
mode. PR 5 must address all three existing guards: worker main, module factory and configuration reader.

**PR 6 still gates outbound admission and OTP.** Removing the PR-5 refusal is not permission to retain
the module's unconditional `reserve: true` default. Without an approved/bound live admission policy,
leave outbound dispatch disabled/fail-closed; PR 5 can enable suppression and in-app processing independently.
PR 6 owns approved Redis recipient limits, fail-closed admission, reserved OTP capacity, phone-number
plugin, challenge/code derivation, expiry/resend/route policy, global auth attempt ledger and auth/worker
root binding. OTP suppression must use the same phone identity/lock/check on its later global-ledger
transaction, not a tenant attempt or guessed company. PR 6 adds only check-function EXECUTE to `pospay_auth`
and records that grant in ADR-0003; it receives no suppression-table privilege. Every-message STOP includes OTP; recovery must not
silently bypass it. Customer/rating/alert producers and safe rating-link transport remain their own slices.
Reconcile the plan's PR 6 dependency row to include PR 5 before any live OTP use.

### 6. Exact passkey dependency pins — PR 20

| Package | Exact pin | Placement |
|---|---|---|
| `better-auth`, `@better-auth/drizzle-adapter` | `1.7.5` each | retain ADR-0009 pins |
| `@better-auth/passkey` | `1.7.5` | `packages/auth`; server plugin and its `/client` integration |
| `@simplewebauthn/server` | `13.3.1` | auth-owned attendance verification and plugin dependency |
| `@simplewebauthn/browser` | `13.3.0` | plugin browser dependency, exposed through auth client facade |

Published registry metadata checked read-only on 2026-10-01: passkey 1.7.5 has peer
`better-auth ^1.7.5`, server `^13.3.1`, browser `^13.3.0`; server requires Node >=20, compatible with
the repository's Node 24 baseline. Publication dates: passkey 2026-09-14, server 2026-05-27, browser
2026-03-10. [Passkey release manifest](https://raw.githubusercontent.com/better-auth/better-auth/v1.7.5/packages/passkey/package.json),
[published plugin metadata](https://registry.npmjs.org/@better-auth%2fpasskey/1.7.5),
[server metadata](https://registry.npmjs.org/@simplewebauthn%2fserver/13.3.1),
[browser metadata](https://registry.npmjs.org/@simplewebauthn%2fbrowser/13.3.0).

Pin direct dependencies without carets and scope pnpm overrides for the plugin's two WebAuthn dependencies
to these exact versions; commit the reviewed lockfile in PR 20. Preserve the existing compatible Better
Auth peer resolutions. Keep ADR-0002's release-age gate and denied build scripts: these releases are aged,
no new age exclusion or install-script approval is justified. PR 20 must inspect the entire newly resolved
dependency graph against the effective age policy; wait for any too-new transitive release rather than
disable the policy. Compatibility here is manifest/source evidence; runtime proof belongs to PR 20.

### 7. RP, origins and verification policy

Configure `rpName=PosPay`, explicit RP ID and explicit origin arrays; no Origin/header-derived default,
wildcard, trailing slash, scheme/port in RP ID, or automatic trust of every cookie-sharing subdomain.

| Environment | RP ID | Exact browser origin allowlist |
|---|---|---|
| Production | `pospay.systems` | `https://app.pospay.systems`, `https://pos.pospay.systems` |
| Staging | `staging.pospay.systems` | `https://app.staging.pospay.systems`, `https://pos.staging.pospay.systems` |
| Local development | `localhost` | explicit localhost admin/POS origins with the configured ports, never in staging/prod |

These are ADR-0001's planned frontend hosts, not a claim that they are deployed. API hosts serve ceremonies
at `/v1/auth`; they are not the browser WebAuthn origin. Admin may host authorized enrollment UI; staff
attendance runs in POS. Do not include `platform.`, `menu.`, `cdn.`, marketing, or the current bare staging
API host as a browser origin. Keep the WebAuthn list aligned with the allowed admin/POS subset of
`AUTH_TRUSTED_ORIGINS`/CORS; other auth clients gain no passkey permission. Reject prod ceremonies whose
clientData origin is a staging origin, even though staging is beneath the production RP's DNS suffix.
Use separate environment databases, secrets and challenge cookies; retain ADR-0001 cookie boundaries.

Choose attestation `none` (no device provenance claim), registration `authenticatorAttachment=platform`,
`residentKey=required`, and `userVerification=required`. Synced passkeys are allowed; fingerprint, face or
screen-lock code satisfies verification, with no biometric data sent to PosPay.

**Pinned-plugin limitation:** 1.7.5 hardcodes authentication options to `preferred`, verification to
`requireUserVerification: false`, and successful authentication creates a session. Its registration
selection is configurable. [Tagged implementation](https://raw.githubusercontent.com/better-auth/better-auth/v1.7.5/packages/passkey/src/routes.ts).
Therefore use its registration/credential adapter behind a restricted auth facade; enforce verified UV
in the registration verification hook before accepting a credential. For each attendance assertion use
the pinned SimpleWebAuthn server verifier **inside `packages/auth`**, with `requireUserVerification=true`,
expected challenge/origin/RP ID and the active credential. Do not mistake a client option for server UV
enforcement. No vendor fork or handwritten WebAuthn crypto. PR 20 must prove these rejection paths.

### 8. Identity storage, binding and Phase 1 use

Classify the plugin model `passkey` as ADR-0003 §2.1 **global identity**, mapped by the Drizzle adapter to
`public.passkey`: UUID v7 `id`, `user_id` FK to global user, credential id (unique), public key, counter,
device type, backup flag, transports, name, created time and AAGUID, using the
[tagged schema](https://raw.githubusercontent.com/better-auth/better-auth/v1.7.5/packages/passkey/src/schema.ts).
No company or tenant RLS. Migration owner owns it; `pospay_auth` alone receives SELECT/INSERT/UPDATE/DELETE
(no REFERENCES/TRIGGER/TRUNCATE); app/dispatcher/notifications/PUBLIC receive nothing. Challenge records
use auth's existing global `verification` storage and grants; no auth client/credential leaves that facade.
Private keys stay with authenticators. Do not log credential ids, public keys, assertions or challenges.

`EmployeePasskey` remains a **tenant binding** owned by staff: `(company_id,id)`, employee id, opaque
`passkey_id`, binding revision, bound/unbound times and actors, one active row per employee. Its FK can be
created by the migration owner without granting app REFERENCES on identity tables. Move public-key/counter
storage in SPEC §4 to the global credential, avoiding two verification authorities. Tenant RLS and negative
isolation tests ship with this binding; global-role denial tests ship with the credential table.

PR 20 owns enrollment and the auth verification facade/challenge contract needed by attendance. Require
the PR 6 verified staff OTP session and server-resolved employee/user link. No active binding permits first
enrollment; an existing binding refuses replacement. Serialize the tenant binding insert and enforce its
partial unique index. Auth registration and tenant binding use different pools: an unbound credential is
inert; failures never activate it implicitly or authorize a clock. PR 21 owns manager unbind and audit,
plus the device-fingerprint anomaly flag. Retain historical binding; invalidate its revision so old proofs
fail. Re-enrollment follows the manager's unbind, never a self-service delete/add through plugin routes.

For a clock, mint a fresh, 120-second single-use challenge bound server-side to the authenticated user,
company, employee, binding id/revision, branch, attendance operation and QR context. The auth facade verifies
the assertion and consumes the challenge atomically, serializing credential counter updates; it returns
an internal proof for this operation, never a reusable login/attendance token. The staff transaction locks
and rechecks the current binding/revision before changing AttendanceState, so a concurrent unbind wins or
the clock completes before it. Recheck membership, QR windows/branch and the SPEC's geofence exceptions.
Zero counters/synced backup metadata are supported by the WebAuthn library, not used as physical-phone proof.

Do not expose generic plugin authentication, delete/update or enrollment paths through the existing
`/v1/auth/*` wildcard. Allow only guarded enrollment facade routes; attendance challenge/assertion routes
require the staff session. Passkeys neither replace owner/admin password+TOTP, cashier PIN/device pairing,
customer OTP, platform login nor memberships/RBAC. Never accept a prior session as the per-clock assertion.
Card attendance remains paired-device/operator-authorized and needs no employee passkey. Sync permits the
same credential on other signed-in devices; two employees sharing a fingerprint is a manager flag, not a
block. Attendance has no effect on commissions. PR 22 depends on PR 20's delivered verification contract.

### 9. Governing amendments — listed, not applied

- **ADR-0003 §§2/3/6:** add the global messaging class, three tables, two restricted roles, boolean definer
  inventory/grants, NULL-only suppression constraint, digest-only dedupe/UUID audit and exact GET/POST webhook entries;
  classify `passkey` and auth-only grants before PR 20
  migration. Preserve dispatcher/tenant privileges. PR 6 separately classifies its global OTP ledger and
  adds the auth role's suppression-check EXECUTE privilege.
- **CLAUDE.md §5:** name the global messaging intake/facade exception, which never touches tenant tables;
  list `passkey` among auth-only global tables. **§6:** clarify durable privacy-scrubbed inbound raw events,
  original message ids confined to intake memory, domain-separated digest dedupe and UUID audit,
  and the synchronous bounded STOP effect before enqueue/ack. **§8:** record attendance assertions through
  the auth facade without changing the established login methods.
- **module-map.md prose/YAML/checker:** preserve root notifications and restricted package ownership;
  explicitly permit notification persistence to use the restricted global DB facade. Declare application
  root injection of the auth-owned passkey facade into staff's attendance port; staff never imports auth.
  This is an authentication boundary (challenge/counter effects only), not permission for a business write
  port. No new staff → notifications, notifications → identity, or tenant cross-module write arrow.
- **SPEC §4:** separate global credential material from tenant EmployeePasskey binding. **Plan row 6:**
  require PR 5 for live OTP. Mirror the named global exception/auth wiring in constitution Principle III/IV.
  These follow-ups belong to their implementation PRs; none is applied by this design file.

### Owner decisions — 2026-10-01

Approved by Waleed on 2026-10-01:

1. **STOP vocabulary:** exactly `STOP`, `UNSUBSCRIBE`, `إيقاف`, `ايقاف`, `توقف`, plus the approved STOP
   button id, with the normalization and whole-message matching in §2. `CANCEL`, `إلغاء` and `الغاء`
   are excluded because appointment cancellation does not imply global messaging opt-out.
2. **Re-subscription and manual actions:** no re-subscription, START or tenant override in Phase 1.
   Platform operators may add manual suppression with a mandatory audited reason; manual removal needs
   a later approved recipient-consent flow and does not ship now.
3. **Retention:** clear scrubbed inbound payload JSON after 30 days; retain message-digest dedupe,
   suppression rows and minimal append-only audit indefinitely.

## Alternatives considered

| Alternative | Rejected because |
|---|---|
| Per-company suppression or locks including company id | one sender's STOP must block all companies; distinct locks allow the race |
| Full/encrypted phone or original unsanitized webhook bytes in global storage | violates this global-table privacy boundary; hash and finite command suffice |
| Grant app direct SELECT/DML on global suppression | allows browsing/mutation of global recipient preferences; boolean check is sufficient |
| Grant runtime opt-in column writes or rely only on endpoint restrictions | silently lifts accepted STOP; duplicate deliveries do not repair it; column denials and a NULL-only CHECK are required |
| Retain original wamid as dedupe/audit evidence or use an unkeyed digest | provider ids can encode full phone digits; domain-separated HMAC and inbox UUID audit suffice |
| Use auth/dispatcher roles, BYPASSRLS, superuser definer, or invent a tenant | broadens unrelated exceptions or weakens isolation |
| Redis suppression, separate-connection check, or repeatable-read pre-lock snapshot | cannot prove the committed STOP-versus-authorization ordering |
| Queue STOP before applying it; cancel/retry all pending attempts | delays STOP or changes ADR-0018's stated authorization window/fence |
| Treat CANCEL, إلغاء or الغاء as STOP | appointment cancellation does not mean global messaging opt-out |
| Enable START or manual removal in Phase 1; permit tenant unsuppress | excluded by the owner decision; a tenant override would defeat global STOP |
| Upgrade Better Auth or float WebAuthn ranges | changes the ADR-0009 baseline and makes compatibility/age review irreproducible |
| Plugin defaults/generic passkey login for attendance | UV is not enforced and a session is not a fresh attendance assertion |
| Tenant-only credential store, copied counters, browser token/device fingerprint as binding | plugin uses global identity; duplicated state diverges; fingerprints/tokens do not prove authenticator possession |
| Direct attestation, reject synced credentials, or hand-written WebAuthn | physical-phone proof is not promised; adds provenance/compatibility cost without satisfying SPEC better |

## Consequences

- Global suppression is durable without disclosing phone numbers or granting tenant roles global-table access.
  A small new pool/role and reviewed function inventory are required; tenant RLS stays unchanged.
- Phase 1 suppression is monotonic by column privileges and a NULL-only CHECK covering INSERT/UPDATE;
  duplicate STOP cannot be used to repair lifted suppression. A later consent flow requires an explicit
  constraint/grant migration and audited removal, not merely a new endpoint.
- Permanent dedupe retains only a domain-separated HMAC; audit links to inbox UUID, and original wamids
  remain intake-memory-only. Payload expiry preserves dedupe without retaining phone-bearing ids. The
  frozen platform key and a reviewed rotation migration are required to preserve retry identity.
- STOP is effective at its acknowledged database commit, including when enqueue fails; already-authorized
  messages can finish. Availability failures return retries rather than silently lose accepted STOP.
- Exact dependency pins are compatible by published metadata; plugin defaults require stricter auth-owned
  attendance verification. Enrollment, unbind and clock implementation remain PRs 20, 21 and 22.
- PR 5 must supply the column-grant/NULL-constraint, digest privacy, retention/replay and failure/race
  checks in §5 alongside signature/handshake/raw-body/idempotency/crash checks. PR 20 must supply wrong
  user/origin/RP/UV and replay rejection, enrollment races and unbind fencing.
  No installs, builds, servers or tests were run in this design step; production activation is not claimed.

## Open questions for the owner

The only open business rule is **admission/OTP policy, for PR 6** (`TODO(spec)`); its recommendation is
not approved, and dependent live dispatch stays disabled until approval.

1. **Admission/OTP policy (PR 6)?** Recommend ADR-0018's 1 outbound message/recipient/second, reserved OTP
   capacity with <=5-second submission target, 5-minute OTP validity, 60-second new-code cooldown,
   5 requests/phone/hour and 20/IP/hour; STOP also blocks OTP. Owner approves limits and recovery UX before
   live dispatch; loss/unknown outcome never authorizes automatic resend of the same attempt/challenge.
