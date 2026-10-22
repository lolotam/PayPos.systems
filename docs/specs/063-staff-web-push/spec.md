# Feature Specification: Staff web push (row 28b)

**Feature Branch**: `feat/p1-28b-staff-web-push` (one branch per sub-PR, below)

**Created**: 2026-10-22

**Status**: Ready for planning — owner questions WP-Q1…WP-Q4 answered by Waleed on 2026-10-22, see
[owner-questions.ar.md](owner-questions.ar.md); Abu Salem's pick, if different, replaces them. Sub-PRs 28b-1…28b-4 wait for
no question; 28b-5 waits for 62-2.

**Input**: User description: "staff-web-push — row 28b: staff web push (Web Push/VAPID), subscriptions per user+device,
worker delivery, employee's own not-clocked-in notice."

**Phase 1 row**: 28b (`docs/specs/phase-1/IMPLEMENTATION-PLAN.md:85`). Depends on row 3 (outbox), 28 (merged:
`ShiftNotClockedIn`, spec 036 / ADR-0037) and the personal staff session (rows 20/22, ADR-0027, merged). The plan also
lists 57b (the staff app shell); see TD-3 for why this spec does not wait for it. Row 28c ("your shift ends soon") is the
next consumer of the channel built here, and row 62's alert-rules screen keeps push fixed (spec 060 §Part B).

**Sources**: spec 036 (NC-Q3, NC-Q4, NC-Q5, NC-Q11, NC-Q12 and the 2026-10-08 language request, whose last bullet is this
row's stored language preference); ADR-0018 (delivery fence, outbox → BullMQ transport, attempts); ADR-0019 and ADR-0027
(staff sessions, no private data in the PWA); ADR-0029 (the PWA install id); ADR-0037 (the interim rule and recipient
groups); spec 060 §Part B rule table (push as a fixed channel); **ADR-0052** (this slice's decisions, number provisional);
`CLAUDE.md` §5, §6, §8.

## Owner questions

Decided earlier and not re-asked (spec 036, Waleed 2026-10-08): the employee herself gets "you have not clocked in" by push
once this row ships (NC-Q3, answer 7); push is the staff channel and there is no email (NC-Q4); once per shift (NC-Q5); no
quiet hours (NC-Q11); a deleted employee or ended contract gets nothing (NC-Q12); the notice follows the user's language
(2026-10-08).

Example used below: Mona, shift at 10:00 at Salmiya branch.

Answered by Waleed on 2026-10-22 (WP-Q1…WP-Q3 on the decisions page, final decisions, PP-33.1…PP-33.3, batch 49, the first option of
each; Abu Salem has not picked yet and his pick binds if it differs, `CLAUDE.md` §1 5b). The rules, now part of this spec:

- **WP-Q1 — How Mona turns notifications on.** Browsers only allow it if Mona herself taps allow on her own phone, so no
  manager can switch it on for her. The staff screen always shows a "mobile notifications" toggle, and the **first time**
  she signs in on a phone it also shows one small invitation to switch it on (once; if she declines or dismisses it, it is
  not shown again on that phone, the toggle stays).
- **WP-Q2 — Mona has two phones.** A notice goes to **every live subscription** she has in that company (up to the cap of
  5), each in its own language. Not only the last phone she used.
- **WP-Q3 — Mona uses an iPhone.** When notifications cannot work because the app was not added to the Home Screen, the
  toggle is replaced by a short instruction "add the app to the Home Screen to receive notifications" with simple steps.
  The screen's look is reviewed in the 28b-4 PR before it merges.

- **WP-Q4 — Mona works in two salons (two companies) on one phone.** A phone holds one notification subscription for the
  app, so it serves one company at a time: the notices come from the company she turned notifications on for **last**; to
  switch to the other salon she turns them on there again (answered by Waleed, PP-33.4, batch 50, the first option; Abu
  Salem has not picked yet and his pick binds if it differs).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Mona is told she has not clocked in (Priority: P1)

Mona's 10:00 shift passes 10:20 without a clock-in. She has notifications on. Her phone shows "No clock-in yet for your
10:00 shift at Salmiya" in her app language, even with the app closed. Tapping it opens the app. Her managers get the
in-app alert they already get (spec 036) — nothing about theirs changes.

**Why this priority**: This is the reason the row exists (NC-Q3, plan row 28b).

**Independent Test**: Seed an employee with a linked user and a live subscription (fake channel), an unclocked 10:00
shift; run the not-clocked-in job past 10:20: one push attempt, one fake send with the Arabic text; run again: nothing new.

**Acceptance Scenarios**:

1. **Given** a live subscription with locale `ar`, **When** the alert fires, **Then** exactly one attempt exists, it is
   `SENT`, and the sent payload is the Arabic text with the shift time and branch name.
2. **Given** locale `en`, **Then** the English text. **Given** the user changes the app language and opens the app,
   **Then** the next push uses the new language.
3. **Given** the employee has no linked user or no live subscription, **Then** no attempt is written and the manager alert
   is unaffected.
4. **Given** the job re-runs, a worker restarts or two workers race, **Then** no second attempt or send exists.
5. **Given** approved full-day leave, a clock-in inside the window, a deleted employee or an ended contract, **Then** no
   push (it rides the same decision as the manager alert, NC-Q6…NC-Q13).

---

### User Story 2 - Mona turns notifications on and off (Priority: P1)

On her personal staff screen Mona sees one control. She taps it, allows notifications in the browser's prompt, and the
control shows "on". Tapping it again turns it off and her phone stops receiving. If she blocked notifications in the
browser, the control says so and how to undo it. On an iPhone that is not installed to the Home Screen it shows the
install instruction (WP-Q3) instead of a toggle.

**Why this priority**: Without it nobody can receive anything.

**Independent Test**: UI tests with a fake `PushManager` and fake permission states assert the visible text of each of the
five states; API integration tests assert the stored rows.

**Acceptance Scenarios**:

1. **Given** permission `default`, **When** she taps the control, **Then** the browser prompt is requested from that tap,
   and on allow the subscription is stored and the control shows "on".
2. **Given** permission `denied`, **Then** the control shows the blocked state and no request is made.
3. **Given** "on", **When** she taps it, **Then** the browser subscription is removed, the server row is revoked, and the
   control shows "off".
4. **Given** no network, **Then** the control is disabled with a visible reason.
5. **Given** an unsupported browser, **Then** the control states that this phone cannot receive notifications.
6. **Given** she signs out explicitly, **Then** the app unsubscribes this install (best effort) and always deletes its
   local delivery token, and the server row is revoked. **Given** a session that was only replaced or expired (she signed
   in on her second phone), **Then** the first phone keeps its subscription and keeps receiving.
7. **Given** another employee subscribes from the same browser in the same company (same endpoint), **Then** the endpoint
   moves to her and the first employee's row is revoked (`OWNER_CHANGED`). **Given** a push queued for the first employee
   arrives after the second signed in (the unsubscribe failed, or the company differs), **Then** the phone shows a neutral
   "PosPay" notice with none of its text, because the app discarded the old record when the second person's
   `subscriber_ref` differed, and until the comparison finished (or if it could not) the record stayed suspended.
8. **Given** Mona works in two salons and has notifications on for the first, **When** she merely signs in to the second,
   **Then** nothing changes (same `subscriber_ref`); **when** she enables them there, **Then** the second salon receives
   from then on and the first no longer does (WP-Q4).

---

### User Story 3 - A dead or stolen subscription cleans itself up (Priority: P2)

Mona's browser data was cleared; the push service answers 410 the next time. The subscription is revoked and its secrets
scrubbed in the same transaction that records the failed attempt. Nothing is retried.

**Why this priority**: Keeps the table honest and stops useless sends.

**Independent Test**: Fake channel returns 410, 404, 403, 429, 503 in turn; assert the attempt status, failure code and
the subscription state of each.

**Acceptance Scenarios**:

1. **Given** the push service answers 404 or 410, **Then** attempt `FAILED/SUBSCRIPTION_GONE`, subscription
   `revoked_reason = GONE`, `endpoint`/`p256dh`/`auth` NULL.
2. **Given** 401/403, **Then** attempt `FAILED/PROVIDER_4XX`, a visible diagnostic, subscription untouched.
3. **Given** 5xx or a timeout, **Then** `FAILED` with `outcome_known = false`, no second call (at-most-once).
4. **Given** the VAPID key was rotated, **Then** subscriptions of the old key id are revoked `KEY_ROTATED` with zero HTTP
   calls, and on the next app open (permission already granted, whether or not the server row was already revoked) the app sees the
   served key id differs from the one it stored, unsubscribes the old browser subscription, subscribes with the new key
   and registers it; a `PUT` that still carries the old key id is refused `PUSH_KEY_STALE`.
5. **Given** a send to endpoint E1 is in flight while the same install registers E2 (the generation moves on), **When** E1
   answers 410, **Then** the E2 subscription stays live and the attempt ends `FAILED`; an attempt authorized for the old
   generation and not yet sent ends `FAILED/SUBSCRIPTION_CHANGED` with zero HTTP calls.

---

### Edge Cases

- A subscribe request whose endpoint is `http:`, has user-info or a port, is an IP literal, or whose host is a look-alike
  of an allowed push service: refused `VALIDATION_FAILED`, nothing stored (request-forgery guard, ADR-0052 §3).
- A sixth subscription for one user in one company revokes the oldest (`CAP_EXCEEDED`).
- The same endpoint subscribed by user B in a company where it is live for user A: moves to B, A's row revoked
  (`OWNER_CHANGED`).
- The API lacks the public key or the subject: the config route answers `NOT_READY` and the control is hidden. The API has
  them but the worker lacks the private key, or it does not match the public one: employees can subscribe, but the worker
  logs a visible `PUSH_DISABLED` reason and writes no attempt and sends nothing, and only notices created after it is fixed
  are pushed. Everything else is unaffected in both cases.
- `send_deadline` already passed when the attempt is processed: `EXPIRED`, zero HTTP calls.
- A reception (`STAFF_POS`) or admin session calls any of the three routes: refused; nothing stored.
- Two registrations racing for the same user: never more than 5 live rows and never two live rows for one endpoint.
- A foreign or unknown `installation_id` on `revoke`: same answer as an own one, nothing changes for the owner of the row.
- The browser gives a subscription with an expiry time: stored nowhere; the push service's 410 is the signal.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A staff member with a personal session MUST be able to subscribe this install, refresh it (language, last
  seen) and unsubscribe it, only for herself and only in her session's company.
- **FR-002**: The system MUST store, per subscription, the endpoint and keys needed to send, her chosen language, the key
  id they were made under and the install id; the secrets MUST be removed when the subscription is revoked.
- **FR-003**: The system MUST refuse any endpoint that is not an HTTPS URL on the allowlisted push-service hosts (ADR-0052 §3).
- **FR-004**: A notice producer MUST be able to request a push by user id, template and parameters, without knowing the
  user's subscriptions or language; notifications MUST resolve both.
- **FR-005**: The system MUST send one push per live subscription of that user in that company, at most once per
  `(source event, subscription, template)`, to **every** live subscription of the user (WP-Q2).
- **FR-006**: The text MUST be rendered in the subscription's stored language and MUST contain no customer data.
- **FR-007**: The provider call MUST run only in the worker, outside any database transaction, after the
  `PENDING → SENDING` fence is committed, exactly once (ADR-0018).
- **FR-008**: A 404/410 MUST revoke the subscription; other failures MUST be recorded and never retried.
- **FR-009**: The not-clocked-in job (spec 036) MUST add the absent employee as a `PUSH` recipient under the same decision
  as the manager notice (leave, presence, deleted/ended employee, once per shift) and **only while the linked user's personal access is current**, on the same toggle and master switch once
  row 62 ships.
- **FR-010**: The staff app MUST show exactly one of five states for the control (unsupported, install-first on iPhone,
  blocked, off, on) and MUST NOT persist notice content or subscription secrets of its own. When the install id cannot be
  read (`INSTALLATION_STORAGE_BLOCKED`) the state is "unsupported" with its own text, no request is made, and the next
  open recovers once storage is available.
- **FR-011**: Registration MUST be offered only when the API holds a valid public key and subject; delivery MUST be enabled
  only when the worker holds all three variables and the private key matches the public one, and no attempt MUST be written
  while delivery is disabled. Neither state may affect any other feature. Fake mode MUST work without any key and
  production MUST refuse it.
- **FR-012**: A revoked VAPID key id MUST revoke the subscriptions made under it without any send.
- **FR-014**: A push MUST carry a random delivery token and the app MUST show the text only when it matches the token it
  holds; otherwise only a neutral notice (shared or reassigned phone).
- **FR-018**: When a personal session is newly established the app MUST suspend text display, compare the signed-in
  person's `subscriber_ref` with the stored one, restore display only when they are equal, delete the record only on a
  confirmed mismatch, and keep it suspended (not delete it) when the comparison cannot complete. An open without an
  established session MUST change nothing.
- **FR-019**: The open-time refresh and the rotation repair MUST run only in the session of the company the record names;
  enabling notifications in another company is the only thing that moves the subscription (WP-Q4).
- **FR-015**: A change to a subscription (new endpoint, revoke) driven by a provider answer MUST apply only to the
  generation that answer was for.
- **FR-016**: The raw installation id MUST NOT be stored; only a company-scoped hash (ADR-0029).
- **FR-017**: A registration MUST state the key id it was made under and MUST be refused when that is not the current key.
- **FR-013**: Nothing in a log, API response, outbox event or job payload MUST contain an endpoint, a subscription key,
  the VAPID private key or a notice body (the VAPID **public** key and key id are served by the config route by design).

### Key Entities

- **Push subscription**: one browser install of one staff user in one company; has a language, a key id, a state (live or
  revoked with a reason).
- **Push attempt**: the record of one planned send to one subscription for one source event; carries the status, the
  failure code and the push service's status code; never the endpoint.
- **Push template**: the fixed Arabic and English words of one notice kind and its allowed parameters.

## Slice design *(mandatory — `CLAUDE.md` §1)*

### Business rules

- **BR-001**: A push is requested by user id; there is no phone and no endpoint in an event or a job.
- **BR-002**: A subscription is per `(company, user, install)`; the language is per subscription and travels with every
  refresh from the app.
- **BR-003**: At-most-once. A missed notice is accepted; a repeated one is not (NC-Q5).
- **BR-004**: A push never contains customer data; only the employee's own shift time, the branch name and fixed words.
- **BR-005**: Revoking removes the secrets. Subscriptions of an old VAPID key are revoked without a send.
- **BR-006**: Only a personal session can subscribe. A shared reception device cannot.
- **BR-008**: The employee's push travels in a request of its own, never inside a manager group of up to 100.
- **BR-007**: The producer owns "who is allowed a notice" (active employee, leave, presence); notifications owns "how and
  where it is delivered".

### Technical decisions (orchestrator, with ADR-0052; no owner question)

- **TD-1 — Language per subscription, not per user.** ADR-0052 §6; the global `user` table cannot hold tenant data.
- **TD-2 — Separate `push_attempts` table.** ADR-0052 §5; `notification_attempts` stays phone-only.
- **TD-3 — The control goes on the existing personal screen, not on row 57b's shell.** The plan lists 57b as a
  dependency, but the personal screen exists (rows 20/22) and the control is one component. When 57b's shell merges it moves
  the component; 28b-4 does not wait for it. If the orchestrator prefers to wait, only 28b-4 moves.
- **TD-4 — Plaintext subscription columns, scrubbed on revoke.** ADR-0052 §3 explains why `CLAUDE.md` §8's
  envelope encryption is not applied here and what the deferred alternative is.
- **TD-5 — Endpoint allowlist.** ADR-0052 §3; extending it is a code change.
- **TD-6 — Texts (proposal, reviewed in the PR):** `ar`: «لسه مفيش بصمة حضور ليك لشيفت الساعة {start} في {branch}.» /
  `en`: "No clock-in yet for your {start} shift at {branch}." Title «بصمة الحضور» / "Clock-in". Neutral wording on purpose, so
  it reads right for any employee.

### Schema changes

| Table | Columns | RLS | Indexes | Tenant-qualified FKs |
| --- | --- | --- | --- | --- |
| `push_subscriptions` (new) | ADR-0052 §3 | ENABLE + FORCE; SELECT using `company_id = app_company_id()`; INSERT check and UPDATE both clauses; TO `pospay_app`; no DELETE | PK `(company_id, id)`; unique `(company_id, user_id, installation_hash)`; partial unique `(company_id, endpoint_hash) WHERE revoked_at IS NULL`; `(company_id, user_id) WHERE revoked_at IS NULL`; `(user_id)` for the global-user FK | `company_id → companies(id)`; `user_id → user(id)` |
| `push_attempts` (new) | ADR-0052 §5 | as above | PK `(company_id, id)`; unique `(company_id, source_event_id, subscription_id, template_key)`; `(company_id, status, created_at, id)`; `(company_id, user_id, created_at DESC, id DESC)`; `(company_id, subscription_id)` for the FK; `(company_id, branch_id)`; `(company_id, business_id)` | `(company_id, subscription_id) → push_subscriptions`; business and branch as in `notification_attempts` |

- Grants: `pospay_app` SELECT, INSERT, UPDATE on both. Update `packages/db/src/__tests__/privileges.spec.ts` in the same PR.
- Migrations are expand-only (new tables). Constraints in the same migration: the two-branch `CHECK` that makes a live row
  hold all secrets and a revoked row none, locale in `ar`/`en`, status set, `revoked_reason` set, endpoint length.

### API contract

All routes `@Authenticated()` + `PERSONAL_ROUTE`, personal session only, `Cache-Control: no-store`. The `PUT` and the
`revoke` `POST` are declared in `AUTHENTICATED_WRITES` (access `PERSONAL`); the `GET` is a read, served from `queries/`, and is not (the route-declarations test requires the allowlist to equal the
mounted authenticated writes; the route coverage guard classes every `POST` as a write, so `revoke` is declared).

- `GET /v1/staff/push/config` → `{ vapid_public_key, vapid_key_id, subscriber_ref }` · `NOT_READY` when unconfigured ·
  `subscriber_ref` = SHA-256 hex of `pospay.push.subscriber.v1` and the caller's global user id: equal across companies,
  never another person's.
- `PUT /v1/staff/push/subscription` · body `pushSubscriptionInput` `{ installation_id, vapid_key_id, delivery_token, subscription:
  { endpoint, keys: { p256dh, auth } }, locale }` · naturally idempotent, no `Idempotency-Key` · response `204`.
- `POST /v1/staff/push/subscription/revoke` · body `{ installation_id }` · response `204`, identical for own, foreign and
  absent ids; available even when push is not configured, so an employee can always remove her subscription. The raw installation id travels only in bodies, never in a URL (FR-016).
- Zod schemas in `packages/contracts/src/push-subscription.ts`; registered in `notifications-openapi.ts`, OpenAPI regenerated (`pnpm contracts:openapi`).
- Errors: `VALIDATION_FAILED` (bad endpoint, bad key length, bad locale), `NOT_READY`, `PUSH_KEY_STALE` (409), `PUSH_REGISTRATION_BUSY` (409), `RATE_LIMITED` (20 `PUT` per user
  per hour), `UNAUTHENTICATED`/`FORBIDDEN` for a non-personal principal. `message_ar` / `message_en` as the other staff routes.

### Permissions

No role permission: the personal session is the authorization, the caller is the subject (record-scoped by construction,
declared per PP-7.1). ADR-0027 gets an addendum listing "own push subscription" among the personal purpose's capabilities
(28b-1). Nothing for managers.

### Events

- **Published**: `PushSendAuthorized { company_id, attempt_id }` (internal, emitted when a `PENDING` push attempt is
  committed); `NotificationDelivered` / `NotificationFailed` with `channel = 'PUSH'` (ADR-0018 §6, no new shape).
- **Consumed**: the existing notification-request event with `PUSH` recipients (a new recipient kind, same event). Worker
  `staff` emits the first one from `ShiftNotClockedIn` handling (28b-5). `module-map.md` §4 gets the internal event row;
  no import arrow is added.

### Test plan

- **Domain unit** (`packages/notifications`): endpoint allowlist (accepts the four hosts; rejects http, userinfo, port, IP
  literal, look-alike suffix, uppercase/trailing-dot/IDN tricks); TTL from `send_deadline`; Topic derivation; result
  mapping table; payload size cap; push template rendering in `ar`/`en` with name fallback; the template parameter
  allowlist rejects phone-like, URL-like and code-like text.
- **Integration (real Postgres)**: `PW-01` subscribe/refresh/unsubscribe round trip · `PW-02` endpoint moves between users ·
  `PW-03` sixth subscription revokes the oldest · `PW-04` non-personal principals refused on all three routes ·
  `PW-05` consumer writes one attempt per live subscription, none for no subscription · `PW-06` redelivery writes nothing
  new · `PW-07` processor fence: only the committed `SENDING` execution calls the fake channel once · `PW-08` 410 revokes
  and scrubs in one transaction · `PW-09` VAPID key rotation revokes without a call · `PW-10` expired deadline → `EXPIRED`,
  zero calls · `PW-11` not-clocked-in end to end: managers get the bell, the employee gets one push in her locale ·
  `PW-12` employee with no linked user, on leave or with an ended contract gets nothing · `PW-13` push unconfigured:
  config route `NOT_READY`, no attempts · `PW-14` crash windows (before commit, between commit and send, after send before
  result) never produce a second send · `PW-15` a delayed 410 for an old generation never revokes the replacement;
  an attempt for an old generation ends `SUBSCRIPTION_CHANGED` with zero calls · `PW-16` racing registrations keep the
  cap of 5 and one live row per endpoint · `PW-17` the employee push appears exactly once with 99, 100 and 101 managers
  · `PW-18` the raw installation id is nowhere in the rows (only the hash), and the same install gives different hashes in
  two companies · `PW-19` the `CHECK` refuses every partially cleared combination of the secrets · `PW-20` a `PUT`
  with an old key id is refused `PUSH_KEY_STALE`; `PW-21` `GET config` returns the caller's own `subscriber_ref`, equal in
  two companies and different for two people; worker readiness: a private key that does not derive the public key
  disables push with a visible reason while the API config route stays ready.
- **RLS negative**: both tables — cross-tenant read = 0 rows, write rejected, tenant-qualified FK across tenants rejected.
  `privileges.spec.ts` updated; `route-declarations.spec.ts` covers the three routes.
- **Queries/EXPLAIN**: the consumer's live-subscription lookup and the processor's attempt+subscription read each have a
  result-shape test and an `EXPLAIN` assertion that the partial index is used.
- **Privacy**: the leak-path test of `packages/observability` gets the new field names; a test asserts no log line, event
  JSON or job payload contains an endpoint, key or body.
- **UI (apps/pos)**: the rotation repair (old browser subscription removed, new one registered, visible state "on"); a
  stale-token push shows the neutral notice with no body; an explicit sign-out deletes the token while a replaced session
  keeps it; on sign-in the record is suspended first and restored only when `subscriber_ref` matches, deleted when it
  differs, and stays suspended when the call fails (restart + expired session + a different person);
  opening a second company with the same person changes nothing and sends no `PUT`; an open with no established session
  (expired or replaced) leaves the record untouched (its suspended state unchanged); a failed comparison keeps the record suspended;
  `INSTALLATION_STORAGE_BLOCKED` shows the unsupported text and recovers; an offline transition and a failed session probe keep the token (its IndexedDB
  database is outside the private-cache clearing); the raw installation id appears in no URL (a request-recording test).
  The installed-launch destination is the 28b-4 spike's output, with a test that a reception installation still opens `/`.
  Also: each of the five control states asserts its visible text and the disabled/enabled state of the
  control; subscribe and unsubscribe flows assert the visible state change, with the mock-call assertion alongside, never
  instead (`CLAUDE.md` §9). Service worker handlers: unit tests of `push` and `notificationclick` with a fake
  registration (notice shown with the payload text; neutral fallback on bad JSON).
- **Manual smoke (staging, after merge, operator step)**: generate a real VAPID pair, install it in Dokploy secrets (the
  owner approves), subscribe a real Android phone and a Home-Screen iPhone, trigger a not-clocked-in shift. Not a gate.

### Files (by sub-PR)

- 28b-1: `packages/contracts/src/push-subscription.ts`, `packages/db/schema/notifications.ts`
  (`push_subscriptions`) + migration + privileges test + RLS spec, `apps/api/src/modules/notifications/{http,use-cases,persistence,ports}/…push-subscription…`,
  `docs/adr/0027` addendum, route-declarations entries.
- 28b-2: `packages/db/schema/notifications.ts` (`push_attempts`) + migration, `packages/notifications/src/push/` (templates,
  allowlist, mapping, pure), `apps/worker/src/modules/notifications/` consumer for `PUSH` recipients, `module-map.md` row.
- 28b-3: `web-push` dependency (exact pin), `packages/notifications/src/adapters/web-push.channel.ts` and the fake,
  `apps/worker/src/modules/notifications/jobs/push-send.processor.ts` + publisher routing + queue wiring, config module,
  `.env.example` and the deployment compose files (`deploy/docker-compose.staging-shared.yml` and the production one: the API receives the public key and subject, the worker all three), `pnpm push:generate-vapid`, runbook entry.
- 28b-4: `apps/pos/vite.config.ts` (`injectManifest`), `apps/pos/src/sw.ts`, `apps/pos/src/personal-staff/` push control,
  hooks and clients, i18n keys, UI tests.
- 28b-5: `apps/worker/src/modules/staff/` not-clocked-in handling (the recipient and the template parameters), push
  template `shift_not_clocked_in_self`, tests PW-11 and PW-12.

## Sub-PR split (at most three subtasks per PR)

| PR | Scope (subtasks) | Depends on | Notes |
| --- | --- | --- | --- |
| **28b-1** | 1. Contract + `push_subscriptions` migration, RLS, grants, negative test. 2. `PUT` and `revoke` use cases and the `GET config` query, with endpoint validation and route declarations. 3. ADR-0027 addendum (the personal capability and the local `pospay-push` record) + tests PW-01…PW-04, PW-13, PW-16, PW-18, PW-19, PW-20 (key-id part), PW-21 | ADR-0052 + this spec merged (no open question: WP-Q2 decides only the consumer rule in 28b-2) | database review mandatory |
| **28b-2** | 1. `push_attempts` migration, RLS, grants, negative test. 2. Pure push templates, allowlist and mapping + unit tests. 3. Consumer for `PUSH` recipients + `PushSendAuthorized` + tests PW-05, PW-06, PW-17 (consumer side) | 28b-1; **WP-Q2 answered** (the consumer selects **every** live subscription of the user) | database review mandatory |
| **28b-3** | 1. Channel adapter (real and fake) + `web-push` pin + the worker's side of the readiness (the API side, `readPushApiConfiguration`, shipped in 28b-1). 2. `push-send` processor with the fence, result mapping, revoke + VAPID rotation. 3. `push:generate-vapid`, runbook, tests PW-07…PW-10, PW-14, PW-15, PW-20 (readiness part) | 28b-2 | dependency gate: Node 24 and CI |
| **28b-4** | 1. Service worker via `injectManifest` + handlers + the suspended-record check. 2. The five-state control, subscribe/unsubscribe, locale refresh, the `subscriber_ref` comparison and rotation repair from the stored key id. 3. The installed-launch spike (what Add to Home Screen launches on a real iPhone and Android, the reception launch unchanged, ADR-0027 addendum if a hint must be stored) and UI tests (and the iPhone instruction if WP-Q3 says yes) | 28b-1; WP-Q1, WP-Q3 answered | a mockup is attached to WP-Q3 |
| **28b-5** | 1. Emit the employee's `PUSH` recipient from the not-clocked-in handling. 2. Template `shift_not_clocked_in_self`, emitted as a request event of its own (BR-008), only for a linked user whose personal access is current. 3. Tests PW-11, PW-12, PW-17 (emitter side) | 28b-3 and **62-2** (orchestrator decision 2026-10-22: 62-2 removes `interimNotClockedInRule` and keeps the fixed push recipient this PR uses) | touches the staff emitter that 62-2 rewrites (spec 060 §62-2): it lands after 62-2 |

Row 28c (spec 064) reuses 28b-1…28b-3 unchanged and adds only its template and its emitter; it starts after 28b-3.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An employee with notifications on receives the not-clocked-in notice in her language within one minute of the
  moment the existing detector records the notice (the detector runs every five minutes, spec 036, so at most six minutes
  after the alert moment), in every test run of the end-to-end scenario.
- **SC-002**: Across restarts, parallel workers and replays, no test produces more than one send per source event and
  subscription.
- **SC-003**: An employee can turn notifications on or off in two taps or fewer and always sees which of the five states
  she is in.
- **SC-004**: A subscription the push service reports gone is never used again and no longer holds any secret after the
  attempt is recorded.
- **SC-005**: No customer information appears in any notice, and no endpoint, key or notice text appears in any log, event or job.
- **SC-006**: With push unconfigured, every other feature behaves exactly as before.

## Assumptions

- Staff open the PosPay staff app on their own phone, installed or not (Android installed or not; iPhone installed to the
  Home Screen). No native app.
- Push is best effort: no delivery receipt reaches PosPay, only "the push service accepted it".
- The first real use needs an operator to install a VAPID key pair in the production and staging secrets; that is an
  approval by the owner, outside any merge.
- Quiet hours stay as NC-Q11 decided (none). The notices are tied to shift moments, so the middle of the night only
  happens when a shift starts then.
- The push services' hosts (ADR-0052 §3) cover Chrome, Edge, Firefox and Safari on current phones; a browser using another
  service is refused at subscribe with a visible "this phone cannot receive notifications" state.
- Managers keep the bell; this row sends them nothing by push.
