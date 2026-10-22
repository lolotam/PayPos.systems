# ADR-0052 — Staff web push: subscriptions, VAPID keys, delivery in the worker

Status: Proposed (draft for Phase 1 row 28b; number provisional, renumbered at merge).
Date: 2026-10-22. Scope: spec 063, rows 28b and (as a consumer of the channel) 28c. Owner decisions it rests on: spec 036
NC-Q3 / NC-Q4 and the language request of 2026-10-08, `owner-questions.ar.md` of spec 036 (Waleed); the open questions
WP-Q1…WP-Q3 are in spec 063 and wait for the owners.

## Context

The owner wants staff on their own phones to get a short notice — first "you have not clocked in" (spec 036 NC-Q3, row
28b), then "your shift ends soon" (row 28c). Spec 036 NC-Q4 fixed the channel: **push**, no email, no WhatsApp for staff.
Four things are not covered by an existing decision:

1. **No push channel exists.** `packages/notifications` has the WhatsApp and Resend adapters only (`Channel`, ADR-0018).
   Nothing stores a push subscription, nothing holds a VAPID key, and the PWA's service worker is the generated
   Workbox one (`apps/pos/vite.config.ts`, `VitePWA` with the default `generateSW`), which cannot carry a `push` handler.
2. **No recipient shape without a phone.** ADR-0018 §1–§2 builds every attempt around a canonical E.164 phone and its
   HMAC. A push recipient is a user and a browser subscription.
3. **No per-user language.** Spec 036 says push text is rendered before sending, so the language must be stored. The
   `user` table is a global auth table reachable only by `pospay_auth` (ADR-0003 §2.1), so a locale column cannot go there.
4. **A client-supplied URL becomes a server-side HTTP target.** The worker will POST to a subscription endpoint the
   browser gave us. That is a request-forgery surface unless the endpoint is constrained.

Constraints that stay: provider calls only in the worker, outside any database transaction, with the `PENDING → SENDING`
fence committed first (ADR-0018 §1); a staff personal session is the only principal that may subscribe
(ADR-0027); tenant data sits under RLS with `(company_id, id)` keys (`CLAUDE.md` §5, ADR-0007); no private data is
persisted in the PWA (ADR-0019, ADR-0027).

## Decision

### 1. Protocol and library

Standard **Web Push**: RFC 8030 (delivery), RFC 8291 (`aes128gcm` payload encryption), RFC 8292 (VAPID, ES256). The worker
uses the **`web-push` npm package at one exact version, pinned in the row 28b-3 PR** (the PR states the version it
checked and confirms the Node 24 and Windows-CI behaviour as its own gate; this ADR does not claim either verified, the
same stance ADR-0018 took for `bullmq`). It is added to `apps/worker` and `packages/notifications` only. The API never
sends a push and never imports it.

Rejected: writing RFC 8291 encryption and the VAPID JWT by hand with `node:crypto` (about 150 lines of security-sensitive
code the maintained library already covers); a hosted push vendor such as FCM-as-a-service or OneSignal (a new vendor,
the employee's identity and shift times would leave our systems, and `CLAUDE.md` §11 forbids a new service without an
ADR that this one would not justify). The browsers' own push services (Google, Mozilla, Apple, Microsoft) are the
transport in any case; they see only an encrypted blob and the endpoint.

### 2. VAPID key custody

- One ES256 (P-256) key pair for the whole platform, generated once by an operator command (`pnpm push:generate-vapid`,
  added in 28b-3, prints to the operator's terminal, writes no file). Never committed.
- `VAPID_PRIVATE_KEY` lives in Dokploy secrets and is read **only by the worker** (the one process that signs). It is
  never in Postgres, Redis, a log line, a job payload or an API response (`CLAUDE.md` §8, same custody as
  `NOTIFICATION_PHONE_HASH_KEY`). `VAPID_PUBLIC_KEY` is read by the API and the worker. `VAPID_SUBJECT` is a `mailto:`
  contact the push services may use to reach the operator. All three go in `.env.example` with empty values.
- The public key is **served by the API** (`GET /v1/staff/push/config`), not baked into the PWA build with a `VITE_*`
  variable, so a key change needs no rebuild of the app.
- `vapid_key_id` = the first 16 hex characters of SHA-256 of the public key. Every subscription row stores the key id it
  was created under, **sent by the browser side in the `PUT`** (the id of the key it passed to `subscribe()`), and the API
  refuses a `PUT` whose key id is not the current one with `PUSH_KEY_STALE` (409), so a registration made with a key
  fetched before a rotation is never labelled with the new key. A push service binds a subscription to the application
  server key, so a **rotation invalidates every subscription**: delivery treats a row whose key id is not the current one
  as revoked (`KEY_ROTATED`), without an HTTP call. The PWA repairs it (decision 7): it **unsubscribes the existing
  browser subscription first** (a browser refuses `subscribe()` with a different key while one exists), then subscribes
  with the new key. Rotation costs a gap in delivery until each employee opens the app; the runbook entry says so.
- **Readiness is split, because the API must never hold the private key.** The **API** answers the config route only when
  `VAPID_PUBLIC_KEY` and `VAPID_SUBJECT` are valid (`NOT_READY` otherwise, and the PWA hides the control). The **worker**
  enables push only when all three are valid **and** the private key derives the configured public key, checked once at
  startup; otherwise it logs a visible `PUSH_DISABLED` reason, the consumer writes no push attempts and the processor
  stays idle. If the API is ready and the worker is not, employees can still subscribe but nothing is sent until the
  worker is fixed, and only notices created after that are pushed. The operator sets the three variables together
  (runbook). Neither case touches API or worker readiness (the ADR-0027 stance on optional capabilities).
  `NOTIFICATIONS_MODE=fake` binds a fake push channel that records what it would send, and production refuses fake
  mode (ADR-0018).

### 3. Subscriptions — table `push_subscriptions`

Tenant data. A staff user is identified inside the company the personal session was opened for (ADR-0027), so a
subscription belongs to one `(company_id, user_id)`; a user working for two companies has one row per company for the
same device.

| Column(s) | Type / rule |
| --- | --- |
| `company_id`, `id` | UUID NOT NULL; PK `(company_id, id)`; id from the injected UUID v7 generator |
| `user_id` | UUID NOT NULL, references the global `user` (as `in_app_notifications.recipient_user_id` does) |
| `installation_hash` | bytea NOT NULL — SHA-256 of the tuple `pospay.push.installation.v1`, company UUID, installation UUID, from the PWA's existing per-install id (`attendanceInstallationId()`, ADR-0029). The **raw id never enters the database, a log or an event**, and the company in the tuple keeps two companies from correlating a device |
| `endpoint`, `p256dh`, `auth` | text, NULL once revoked (see below); `endpoint` HTTPS, at most 2048 characters |
| `endpoint_hash` | bytea NOT NULL, SHA-256 of the endpoint, kept after revocation |
| `delivery_token` | UUID, NULL once revoked — a random value the PWA generated for this subscription and keeps locally; every payload carries it so the service worker can tell a notice meant for the current subscriber from a stale one (decision 7). Not personal data |
| `generation` | integer NOT NULL, starts at 1 — **incremented whenever `endpoint`, the keys or the token change and on revocation**; the attempt records the generation it was authorized for and every provider-driven change is conditioned on it (decision 5) |
| `locale` | `ar` / `en`, NOT NULL — **the stored language preference** (decision 6) |
| `vapid_key_id` | text NOT NULL |
| `created_at`, `last_seen_at`, `updated_at` | `timestamptz`, injected clock |
| `revoked_at`, `revoked_reason` | nullable; reason in `UNSUBSCRIBED`, `GONE`, `REPLACED`, `OWNER_CHANGED`, `KEY_ROTATED`, `CAP_EXCEEDED` |

- Two explicit branches, `CHECK ((revoked_at IS NULL AND endpoint IS NOT NULL AND p256dh IS NOT NULL AND auth IS NOT NULL
  AND delivery_token IS NOT NULL) OR (revoked_at IS NOT NULL AND endpoint IS NULL AND p256dh IS NULL AND auth IS NULL AND
  delivery_token IS NULL AND revoked_reason IS NOT NULL))` — **revoking scrubs every secret, all or nothing**, and a test
  tries every partially cleared combination. A revoked row keeps its hash and reason for diagnosis and holds nothing that
  can be used.
- Unique `(company_id, user_id, installation_hash)` (re-subscribing the same install replaces its row's endpoint and bumps
  `generation`). Partial unique `(company_id, endpoint_hash) WHERE revoked_at IS NULL`: one live subscription per browser
  endpoint per company. Indexes `(company_id, user_id) WHERE revoked_at IS NULL` for the consumer lookup and `(user_id)`
  for the foreign key to the global `user` table (as `in_app_notifications_user_idx` does).
- RLS: ENABLE + FORCE; SELECT `USING (company_id = app_company_id())`; INSERT `WITH CHECK` and UPDATE both clauses, TO
  `pospay_app`. No DELETE grant. `pospay_auth` and `pospay_dispatcher` get nothing. Negative isolation test in the same PR
  (`CLAUDE.md` §5).
- **Plaintext columns, deliberately.** `CLAUDE.md` §8 envelope-encrypts *third-party credentials* (gateway keys, WABA
  tokens, SMS and email keys). A subscription's endpoint and keys are device-generated, per-install and **useless
  without the VAPID private key**: a push service rejects a sender whose signature does not match the key the
  subscription was created with. The one secret that matters is decision 2's private key, which is never in the
  database. Adding a master-key envelope layer for these rows would add a key-management surface no other table needs.
  The rows get the strict handling below instead: never logged, never returned by any API, scrubbed on revoke. If a
  reviewer reads §8 as covering them, the alternative is a column-level AES-GCM under a worker-only key; it is deferred
  because the table's blast radius does not justify it today, and it can be added as an expand/contract migration.
- **Endpoint allowlist (request-forgery guard).** Subscribing is refused unless the endpoint is `https:`, has no
  user-info, uses the default port and a host name (never an IP literal) whose registrable suffix is on the allowlist:
  `fcm.googleapis.com`, `updates.push.services.mozilla.com`, `web.push.apple.com`, `*.notify.windows.com`. The list is a
  constant in `packages/notifications`, extendable only by a code change. The worker re-checks it at send time and sends
  with redirects disabled. The check is a pure function with unit tests for the bypass shapes (userinfo, port,
  look-alike suffix, uppercase, trailing dot, IDN).
- **Caps and ownership.** At most 5 live subscriptions per `(company_id, user_id)`; a sixth revokes the oldest
  (`CAP_EXCEEDED`). Subscribing an endpoint that is live for another user **in the same company** moves it to the caller
  and revokes the old row (`OWNER_CHANGED`). The count, the eviction, the ownership move and the upsert run in **one
  transaction under `pg_advisory_xact_lock` on `(company_id, user_id)`**; an ownership move also locks the previous owner,
  both locks taken in ascending user-id order after an unlocked look-up of the previous owner, and the endpoint is read
  again once locked (retry at most twice). Two racing registrations can therefore never leave six live rows or two live
  rows for one endpoint. This is a same-company rule only (RLS hides other companies); the cross-company and stale-payload
  protection is the delivery token of decision 7.

### 4. Routes and authorization

Owned by the API `notifications` module (`http/`), under `/v1/staff/push`, all `@Authenticated()` routes marked
`PERSONAL_ROUTE` like the other personal-phone routes (`staff/attendance`, `staff/leave`):

- `GET  /v1/staff/push/config` → `{ vapid_public_key, vapid_key_id }`; `NOT_READY` when push is not configured.
- `PUT  /v1/staff/push/subscription` → upsert the caller's subscription for an `installation_id`; body `{ installation_id,
  vapid_key_id, delivery_token, subscription: { endpoint, keys: { p256dh, auth } }, locale }`; `PUSH_KEY_STALE` (409)
  when `vapid_key_id` is not the current key. The server hashes the install id (decision 3) and stores only the hash. It is naturally idempotent (upsert on the unique key), so
  it takes no `Idempotency-Key` (§6 asks for one on money and stock effects only). It is also the "I opened the app"
  refresh: it updates `locale` and `last_seen_at`.
- `DELETE /v1/staff/push/subscription` → revoke the caller's own subscription for an `installation_id` (`UNSUBSCRIBED`).
  An unknown or foreign id answers the same as an own one, as the in-app read does (ADR-0018 §6).

**Personal sessions only.** A `STAFF_POS` reception session (a shared device), an admin session, a device key or a platform
principal is refused: a push to a shared counter device is meaningless and would be an employee's notice shown to
whoever stands there. This adds "push subscription" to the personal purpose's list of own-scope capabilities, as a
separate addendum to ADR-0027 made in sub-PR 28b-1 (as ADR-0027's 2026-10-21 addendum said such additions are made). Being
a session-only write whose decision depends on the caller, the `PUT` and the `DELETE` are declared in
`AUTHENTICATED_WRITES` with access `PERSONAL` and their check named, so the CI declaration test of PP-7.1 covers them. The
`GET` is a read: it is **not** in that allowlist (the test requires the allowlist to equal the mounted authenticated
writes), and keeps the `PERSONAL_ROUTE` marker alone. The caller's identity comes from
`request.personalSession`; the company is the session's workspace; nothing in the body names a user or a company. A
Redis counter limits `PUT` to 20 per user per hour. No new import arrow is needed: the controller uses `apps/api/src/shared`
exactly as the staff controllers do.

### 5. Recipients, attempts and delivery

**Producer contract (also the interface row 28c uses).** The existing notification-request event (ADR-0018 §1, groups of
at most 100 per ADR-0037 decision 5) gains a third recipient kind, `PUSH`: `{ channel: 'PUSH', user_id, template_key,
template_revision, safe_parameters, send_deadline? }`. **No phone, no endpoint, no locale.** The producer does not know
whether the user has a subscription or in which language to write; `notifications` resolves both from its own tables.
A producer that has no push-capable user (an employee row with no `user_id`) simply emits no `PUSH` recipient. **A
`PUSH` recipient travels in a request event of its own** (its own source event id, derived from the notice's id), never
inside a manager group, so a branch with 100 or 101 managers can neither overflow a 100-recipient request nor send the
employee the same push once per group. The producer owns the active-employee rule (NC-Q12): nothing is emitted for a deleted or ended employee, so a stale
subscription of an ex-employee never receives a notice.

**Consumer.** In the existing `withTenant(event.companyId)` transaction, for each `PUSH` recipient the notifications
consumer reads the user's live subscriptions (the rule for *which* of them is WP-Q2) and, for each, inserts one `PENDING` row into a new table
**`push_attempts`** and appends `PushSendAuthorized { company_id, attempt_id }` to the outbox. No network or Redis work
runs here. A user with no live subscription yields no row and no error (the notice is simply not pushed).

**Why a separate table and not `notification_attempts`.** That table's `PENDING` state requires a phone, its identity is
a phone HMAC and its suppression seam is a phone lock (ADR-0018 §2). Relaxing those CHECKs to "phone *or* subscription"
would change the invariants of a table that guards WhatsApp's at-most-once promise. The new table mirrors its state
machine and fence (`PENDING → SENDING → SENT / FAILED / EXPIRED`, terminal states never return) but holds no phone and
no endpoint:

| Columns | Rule |
| --- | --- |
| `company_id`, `id` | PK `(company_id, id)` |
| `subscription_id`, `subscription_generation` | tenant-qualified FK `(company_id, subscription_id)`; the endpoint is read from this row at send time and **never copied**; the generation is the one current when the attempt was authorized |
| `user_id`, `business_id?`, `branch_id?` | for the delivery log and filters |
| `source_event_id`, `template_key`, `template_revision`, `locale`, `safe_parameters` | same meaning and allowlist rules as ADR-0018; `locale` is copied from the subscription at authorization time |
| `status`, `send_deadline`, `execution_id`, `sending_at`, `finished_at`, `failure_code`, `outcome_known`, `http_status`, `created_at`, `updated_at` | as ADR-0018 §2; `http_status` is the push service's status code, nothing from its body |

Unique `(company_id, source_event_id, subscription_id, template_key)`; indexes `(company_id, status, created_at, id)`,
`(company_id, user_id, created_at DESC, id DESC)`, `(company_id, subscription_id)` (the foreign key), `(company_id, branch_id)`, `(company_id, business_id)`. RLS as for
`push_subscriptions`. No runtime DELETE grant. Retention follows the attempts table's.

**Transport and send.** The outbox transport publisher (ADR-0018 §1.3, outside any database-effect consumer) routes
`PushSendAuthorized` to a new BullMQ queue `push-send` (id-only job, stable id `companyId-attemptId`, `attempts=1`). The
processor runs as `pospay_app`: load the attempt and its subscription; if the subscription is revoked, **its generation
differs from the attempt's** (`SUBSCRIPTION_CHANGED`), the key id is not current or the deadline passed, record `FAILED` /
`EXPIRED` with **zero HTTP calls**; otherwise commit
`PENDING → SENDING` with an execution id, **leave the transaction**, then make **one** `web-push` request, and record the
result in a second `withTenant` transaction fenced by execution id and `SENDING`. This is ADR-0018 §1.4–§1.5 unchanged,
including: at-most-once, no retry after uncertainty, a crashed `SENDING` stays visible. A per-subscription Redis admission
(10 per minute) bounds a runaway producer.

Request shape: `TTL` = seconds left to `send_deadline` (default 1 hour, never more), `Urgency: high` for attendance
notices, `Topic` = 32 characters of base64url SHA-256 of `source_event_id` so a duplicate still queued at the push service
collapses into one. Payload under 1 KB.

**Result mapping.**

| Push service answer | Attempt | Subscription |
| --- | --- | --- |
| 201 | `SENT` (evidence `PROVIDER_ACCEPTED`: the push service took it, not "the phone showed it") | unchanged |
| 404, 410 | `FAILED` `SUBSCRIPTION_GONE`, outcome known | revoked `GONE` in the same transaction, secrets scrubbed — **only `WHERE generation = <the attempt's generation> AND revoked_at IS NULL`**, so a late answer for an old endpoint never revokes the replacement a concurrent `PUT` stored |
| 400, 401, 403 | `FAILED` `PROVIDER_4XX`, outcome known; a 401/403 also emits a visible diagnostic (`VAPID_REJECTED`) | unchanged |
| 413, 429 | `FAILED` `PROVIDER_4XX` / `PROVIDER_429`, outcome known | unchanged |
| 5xx, timeout, network | `FAILED` `PROVIDER_5XX` / `NETWORK_UNKNOWN`, `outcome_known = false` | unchanged |

The result also emits `NotificationDelivered` / `NotificationFailed` with `channel = 'PUSH'` (no endpoint, key, payload or
parameters in them), the existing reporting consumers unchanged.

### 6. Rendering and the stored language

Push text is **rendered by the worker** before it is sent, in the **subscription's stored `locale`**, never in the
producer's or the manager's language. The language is stored **per subscription**, not per user: the PWA sends its
current UI language (the staff app's locale switch, `pospay.locale`) with every `PUT`, so a user who changes the app
language gets it on the next open, and one employee with an Arabic phone and an English tablet gets each in its own
language. It is stored in tenant data (this table), not in the global `user` table, which `pospay_auth` alone may write
(ADR-0003). A subscription cannot exist without a locale; there is no fallback guess.

Templates are a small set in `packages/notifications/src/push/` (`PushTemplateDefinition`: key, revision, locales,
allowlisted parameters reusing the `validateParameters` rules, and per-locale `{ title, body }`). The first is
`shift_not_clocked_in_self` (row 28b); `shift_ends_soon` is row 28c's. The payload sent is exactly
`{ v: 1, title, body, tag, url, lang, t }` with `url` always the staff app's own path and `t` the subscription's delivery token. Names fall back to English the way
ADR-0037 decision 4 does. **No customer data ever enters a push**: no customer name, phone, service, amount or rating;
only the employee's own shift time, the branch name and fixed words. The payload is end-to-end encrypted to the browser,
so the push service never sees the text, but the text is still treated as visible on a lock screen.

### 7. The PWA

- Replace the generated service worker with `strategies: 'injectManifest'` and a hand-written `apps/pos/src/sw.ts` that
  keeps today's precache and navigation fallback (`registerType` stays `autoUpdate`) and adds two handlers. `push`: parse
  the JSON payload and **compare its `t` with the delivery token the app keeps locally** (one random value in IndexedDB,
  written when the user switches notifications on and **deleted on explicit sign-out, unsubscribe and replacement by
  another user**); only on a match `showNotification(title, { body, tag, lang, dir, data: { url } })`. An unparsable
  payload, a missing token or a mismatch shows a neutral "PosPay" notice with no body (browsers require a visible notice
  for every push). This is what protects a shared phone when the best-effort unsubscribe or the server revocation did
  not happen (an expired session, no network, a person of another company): a notice queued for the previous subscriber
  can never show its text to the next one. The token is random and names nobody, so keeping it does not break the rule
  that the PWA persists no private data. `notificationclick`: close it, focus an
  open client or open `data.url`. The worker holds **no business logic and no translation catalog** and stores nothing.
- The subscribe control lives on the personal staff screen (`apps/pos/src/personal-staff/`), a toggle that calls
  `PushManager.subscribe({ userVisibleOnly: true, applicationServerKey })` from a user gesture (browsers require one),
  then `PUT`s the result with the install id and locale. Switching it off unsubscribes and `DELETE`s. An **explicit personal sign-out**
  unsubscribes and deletes the token (best effort for the network call, certain for the local token). A session that is
  merely **replaced or expired** (for instance Mona signing in on her second phone invalidates the first phone's
  session, ADR-0027) does **not** unsubscribe: the first phone keeps receiving, because it is still her own phone, and the
  token still matches. A browser holds one subscription per service worker, so the app keeps **one subscriber per phone at
  a time**: switching on for another user or company unsubscribes the previous browser subscription first, and the earlier
  row dies at its next 410 or is made harmless by the token. A person working in two companies from one phone therefore
  gets push for the company she enabled last; this is accepted.
- **Rotation repair.** When the served key id differs from the subscription's, the app (permission already granted)
  unsubscribes the browser subscription, subscribes with the new key and `PUT`s it; with permission not granted it shows
  the "off" state.
- **Launch destination.** The manifest starts at `/` (the reception app). On a personal visit the app remembers the
  workspace hint (company and business ids, routing hints that grant nothing, ADR-0027) in local storage, and a
  standalone (installed) launch with a remembered hint opens `/personal?company=…&business=…`; without one it shows the
  request-link instruction. This is needed because an iPhone employee launches the Home-Screen icon, not the link.
  The state it can show is exactly one of: unsupported, install-first (iOS), blocked-in-browser, off, on.
- **iOS and iPadOS** deliver web push only to a PWA **added to the home screen** (16.4 or later); in a Safari tab the
  `PushManager` is absent. The control detects that and shows an install instruction instead of a dead toggle (WP-Q3).
- The PWA persists no notice content and no subscription secret of its own: only the browser's own subscription object,
  the existing install id (ADR-0029), the random delivery token and the routing hint described above. The control and the existing offline rule coexist: with no network the toggle is
  disabled, because subscribing needs the server.

### 8. Operations

`.env.example` gains `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. The runbook gets the generate, install and
rotate steps (decision 2). Logs carry the attempt id, subscription id, status code and failure code only — never an
endpoint, key or payload (`CLAUDE.md` §8); the leak-path test of `packages/observability` gets the new field names. Staging
needs a real key pair in Dokploy before a real push can be tried, which is an operator step the owner approves (not
part of any merge).

## Consequences

- The employee's own "you have not clocked in" notice (row 28b) and the "shift ends soon" reminder (row 28c) share one
  channel: a producer emits a `PUSH` recipient with a `user_id` and a template; delivery, language, revocation and the
  fence are not its business. Row 62's alert-rules screen keeps push **fixed, not selectable** (spec 060), so the
  channel set WHATSAPP / EMAIL / IN_APP of SPEC §4 is unchanged.
- Two new tenant tables, two new grants, one new queue, one new internal event (`PushSendAuthorized`), one new
  dependency (`web-push`), three new environment variables, a new PWA build strategy. No new import arrow, no new role,
  no tenant exception, no `BYPASSRLS`. `packages/db/**` changes → the database review of the pipeline is mandatory.
- Delivery is best effort and **at-most-once**: a push service outage drops that notice, never repeats it; a phone that is
  off gets it when it comes back only within the TTL; a phone with notifications blocked gets nothing, and nothing tells
  the manager so. That matches NC-Q5 (once per shift).
- A VAPID rotation, a revoked browser permission and a full uninstall all end as `GONE` or `KEY_ROTATED` rows that the
  employee repairs by opening the app again.
- Not decided here: quiet hours (spec 036 NC-Q11 stays: none), a delivery-read receipt, push for managers (they have the
  bell), push on the reception device, an admin screen listing who has push on.

## Alternatives considered

1. **Hosted push vendor** — rejected, decision 1.
2. **Hand-written RFC 8291** — rejected, decision 1.
3. **Language on the global `user` row** — impossible without giving `pospay_auth` a tenant concept; per-subscription is
   also the more accurate preference (language is a property of the device's app).
4. **Extend `notification_attempts` with a subscription id** — rejected, decision 5; revisit only if a second non-phone
   channel appears.
5. **Retry 5xx and 429** — safe in principle because of `Topic` collapsing, deferred: it reopens the fence's
   at-most-once promise for little gain on a once-per-shift notice.
6. **Encrypt subscription columns** — deferred, decision 3.
7. **SSE or polling instead of push** — cannot reach a closed app, which is the whole point.
