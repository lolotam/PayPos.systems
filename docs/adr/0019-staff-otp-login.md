# ADR-0019 — Staff OTP login over WhatsApp

- **Status:** Accepted
- **Date:** 2026-10-02
- **Slice:** Phase 1 · PR 6 (`feat/p1-06-staff-otp`)
- **Dependencies:** plan rows 3, 4 and 5; passkey enrollment remains PR 20

## Context

CLAUDE.md §§5/8 and ADR-0003 reserve global identity access and credential/session operations to
`packages/auth` on `pospay_auth`. Memberships, roles and overrides remain the authorization authority.
ADR-0009 pins Better Auth and its Drizzle adapter to 1.7.5. The unique E.164 `user.phone_number` and
`phone_number_verified` columns already exist, but the phone-number plugin is not registered. Current
auth enables email/password and TOTP; it supplies no staff OTP challenge or staff session flow.

ADR-0018 §7 requires an API-root-bound `OtpSender`, an auth-owned global send ledger, direct enqueue
after acknowledged ledger commit, `notifications-otp` reserved capacity and at-most-once submission.
It explicitly leaves worker code derivation open and forbids a code in the ledger, event or job.
ADR-0013 adds monotonic global STOP suppression and reserves suppression-function EXECUTE for auth
to PR 6. Current worker production wiring keeps outbound WhatsApp disabled pending live admission.
Staging runs with `NODE_ENV=production`, empty notification settings and outbound disabled. OTP is
an optional capability; its configuration must not make these existing services unable to start or
fail their ordinary readiness checks.

The existing POS stores the paired device token in IndexedDB and sends `Authorization: Device …`.
Its API client omits cookies, and SessionGuard currently gives Device authentication precedence over
a user cookie. Cashier PIN verification returns an employee id; it does not currently issue a staff
session. These are implementation gaps, not evidence that OTP/PIN sign-in screens already work.

SPEC §§3/4/7 and ADR-0013 describe staff attendance on personal phones, with a fresh passkey assertion
for each clock. This task deliberately scopes PR 6 to a **paired POS device**. It must not silently
turn that login into a personal-phone session or enroll the shared device as an employee authenticator.
Plan PR 6 precedes employees (PR 8); it cannot require a staff table that has not shipped.

## Owner decisions — 2026-10-01

These decisions are settled and are not reopened by this ADR:

- An OTP is valid **5 minutes**; a new code may be requested after **60 seconds**.
- At most **5 code requests per phone per hour** and **20 per IP per hour** (salon Wi-Fi is shared
  by several staff); outbound admission is **1 message per recipient per second**.
- **STOP also blocks OTP:** a suppressed phone gets no code; the screen tells the employee to ask
  the manager for help with sign-in on the branch device using the employee's own cashier PIN,
  as clarified on 2026-10-02 below.

## Owner decisions — 2026-10-02

Waleed settled the following business rules:

- **Q1 — Eligibility:** existing platform users only; one canonical phone per user bound through an
  audited, approved binding. No self-signup or tenant-manager overwrite of a global phone. Require an
  active covering membership **plus `login:staff:branch`**: bundled for Staff, explicitly enabled for
  reception/cashier roles, and not automatically granted to owner/admin roles.
- **Q2 — Session:** **8 hours absolute, no idle timeout**; the employee stays signed in for the shift.
  No renewal past the original 8-hour deadline. After expiry, use a new OTP or the employee's own PIN.
- **Q3 — Shared devices:** **one staff operator per POS device**. A branch may run several devices,
  each with its own operator simultaneously. A different employee replaces the previous operator only
  after the new session is durably created; clear the previous operator's personal caches in every
  tab. The newest accepted challenge for a phone supersedes earlier active challenges.
- **Q8 — Recovery:** the employee signs in with **their own cashier PIN** on the branch device. The
  manager may help, including resetting that employee's PIN, but cannot sign someone in with the
  manager's PIN or impersonate another employee. Every action records the actual actor. PR 6 is online only.

## Orchestrator decisions — 2026-10-02

The following technical decisions are settled:

- **Q5:** six digits, 5 failed verifications per challenge, and verification caps of
  **25/phone/hour** and **100/IP/hour**.
- **Q6:** retain metadata for **30 days after expiry**, clear terminal code hashes, run hourly bounded
  cleanup, and keep minimal secret-free audit.
- **Q7:** explicit POS **ar/en** choice with **no fallback**. Final copy and approved Meta template
  names remain `TODO(spec)` and block live activation.
- **Q4:** PR 6 remains paired-device only; design personal-phone/passkey enrollment before PR 20.

## Decision

The decisions below are accepted design requirements. Acceptance does not implement them or enable
live delivery; the remaining template approval gates and future enrollment design are listed below.

### 1. Staff identity, device scope and session

1. Accept login only from an ACTIVE, manager-paired device with a valid, unexpired Device token.
   Authenticate that token through identity's existing path B first. The server obtains company and
   branch from the device row and the branch's business from tenancy; body/header company or branch
   claims cannot select the login scope. Ordinary device authentication may renew its existing
   30-day token as already decided; an OTP does not pair or approve a device.
2. `packages/auth` canonicalizes the submitted international phone and looks up the single global
   `user.phone_number`. Do not match customer phones, employee contact text or display names. Do not
   create a user, membership or employee on request/verification. Bind one canonical phone per existing
   platform user through an audited, approved auth facade with identity/ownership checks. A manager
   may request platform provisioning, but a tenant manager cannot overwrite a global user's phone,
   including for multi-company accounts. Binding changes reset phone verification and invalidate
   outstanding challenges and staff sessions; a valid OTP may mark the approved bound phone verified.
3. An identity-owned eligibility reader checks that user's active memberships in the **already
   authenticated device company**, restricted to scopes covering its business/branch. COMPANY covers
   its descendants, BUSINESS its branches, and BRANCH only itself; windows and applicable DENY win.
   Require the explicit `login:staff:branch` permission in addition to a covering active membership.
   Bundle it for Staff, explicitly enable it for reception/cashier roles, and do not automatically
   grant it to owner/admin roles. Evaluate effective permissions rather than trusting a role name.
   This reader uses `pospay_app` inside `withTenant(device.companyId)` under the existing device path;
   this is not an invented pre-login tenant for the OTP ledger. Never use `withUser(candidateUserId)`
   merely because a phone lookup found an unverified candidate. After OTP proof, user-keyed membership
   discovery may use `withUser(userId)` normally. Auth/worker pools gain no membership/tenant grants.
4. Run the common activation/availability and rate checks in §6 **before any phone lookup**. Once
   these pass, eligible, unknown, missing-user, nonmember, closed-company, permission-denied and
   suppressed phones, plus lookup/preparation/ledger/enqueue failures, all produce the **same HTTP 202
   acknowledgment, body shape/content and comparable timing**. Refusals and failures grant no send
   permission; unknown/ineligible phones create no account or send. Return an indistinguishable fresh
   challenge-shaped id even when no usable challenge exists. Never expose suppression, send success
   or eligibility in response fields, headers or externally visible diagnostics; show identical
   recovery guidance to all.
   Later invalid verification receives the same refusal and dummy comparison work on unknown ids.
   Do not return user names, membership counts or account-existence reasons. Only the common
   availability checks before lookup may return 503; downstream errors must not become an enumeration
   signal through status codes or timing.
5. On successful proof, recheck the device, current phone mapping and current scope eligibility;
   consume the challenge once, then issue a **Better Auth session with staff POS purpose**, through
   `packages/auth`. Retain 1.7.5; no JWT or independent session-signing implementation. Add server-only,
   non-client-writable session metadata: `purpose=STAFF_POS`, immutable device context (company,
   business, branch, device ids), original authenticated time and absolute 8-hour deadline. These are
   credential restrictions on a global session, not membership authority; normal admin sessions stay
   multi-company and their `active_company_id` remains only a hint.
6. Use a distinct `pospay-staff` HttpOnly, Secure, SameSite=Lax cookie, host-only to the API, with a path
   covering the permitted `/v1` routes. Do not overwrite the admin cookie or return the session token
   in JSON/IndexedDB. Staff hooks explicitly include cookies alongside Device authentication. A
   dedicated route/guard policy resolves **both** credentials and requires the session's exact device
   context. Device-only endpoints remain device-only; a malformed Device credential cannot fall back
   to a cookie. Staff sessions cannot switch company/branch or fall through ordinary `@Authenticated`
   routes, admin/platform/integration access, password/TOTP-management or generic Better Auth session
   operations. Enforce purpose restrictions at the mounted Better Auth handler too, including when
   someone copies a staff token into the normal cookie name. Origin checks alone are insufficient.
7. On every staff request recheck device revocation/expiry and active scope membership, then evaluate
   permissions/own ownership server-side. Drop platform and pre-login Device grants; scope the user's
   grants to the device and apply DENY. Before PR 8, the session identifies `userId`; it grants no
   employee data access. Later `employeeId` comes from the tenant membership/user link, never the
   verification body or a selected employee name. Login, attendance and cashier shift opening
   remain separate actions. Neither OTP nor PIN replaces PR 20/22's per-clock passkey assertion.

Enforce an **8-hour absolute session with no idle timeout**, so the employee stays signed in for the
shift. No remember-me or renewal may move the original deadline; after expiry, require a new OTP or
the employee's own PIN. Better Auth's current 7-day/daily-refresh default must not apply to this purpose.
Allow **one active staff operator per paired device**; a branch may run several POS devices with
independent simultaneous operators. Revoke the previous operator only after the replacement session
is durably created. Serialize issuance/replacement with an auth-owned device lock through creation
and old-session invalidation; release the new cookie only after acknowledged rotation. Clear the
previous operator's personal caches in every tab on replacement. Sign-out clears the staff session
and personal caches while leaving pairing intact.

PIN fallback uses only **the employee's own cashier PIN** and obtains equivalent device-scoped
authority via auth. A manager may help or reset that employee's PIN, but the manager's PIN must never
sign in another employee or impersonate them. Every action records the actual actor, including the
manager's reset and the employee's sign-in as separate actions. OTP and PIN sign-in are online only
in PR 6; the current PIN endpoint's returned employee id alone is not a reusable login credential.

### 2. Code derivation, verification and resend

Use a **six-digit decimal code**, preserving leading zeroes. Generate it only inside auth from
`HMAC-SHA256(STAFF_OTP_DERIVATION_KEY[keyId], encoded challenge context)`. The length-delimited,
versioned context contains a staff-OTP domain label, injected cryptographically random UUID v7
challenge id, recipient hash and immutable device context. Specify unbiased rejection sampling into
the six-digit space in the auth crypto adapter, with counter-domain expansion if needed. The id's
timestamp is not entropy; use the existing secure entropy-backed UUID generator. New requests create
new ids; collisions of six-digit values are possible, so validity always belongs to a challenge.

At request time, only after eligibility and the locked suppression check pass, auth derives the code
in memory and stores only its **keyed verification hash** in
`auth_otp_challenges.code_mac`: HMAC-SHA256 with a separate `STAFF_OTP_VERIFICATION_KEY`, domain label,
challenge context and code. An ordinary SHA-256 of six digits is insufficient against a database leak.
Derivation and verification keys are independent random secrets of at least 32 bytes, injected into
API/worker auth composition from Dokploy/env; neither is a phone-hash key or `BETTER_AUTH_SECRET`.
Persist their key ids only. Keep retiring keys through all live challenges and drain worker executions
before removing them; missing keys fail closed, never generate another code for an existing id.

The worker's restricted auth facade resolves the committed challenge, derives **the same code**, and
constant-time compares its computed verification MAC against `code_mac` before permitting transient
materialization. It never generates a second random code. No plaintext/encrypted OTP is persisted
anywhere, including Better Auth `verification.value`, Redis, ledger, jobs, outbox, audit or diagnostics.
Code/phone exist briefly in auth/notification adapter memory and the outbound HTTPS request only.

Enforce **5 failed comparisons per challenge**, atomically serialized in Postgres, with the fifth
setting `EXHAUSTED`. Exhaustion adds no separate long lock; a new challenge remains subject to the
settled request cooldown and quotas. Compare fixed-size MAC buffers with `timingSafeEqual` in auth; validate the
six-digit input and perform a dummy MAC comparison on absent/ineligible challenges. Check binding,
current phone mapping, expiry and ACTIVE state inside the same locked challenge transition. At
`now >= expires_at` refuse. Two correct concurrent verifications yield at most one consume/session.
Attempts cannot be reset by a new process, retry or Redis loss.

Successful consumption commits before one Better Auth session-creation operation. Because Better Auth
and custom challenge operations need not share a transaction, deliberately accept loss between these
steps: a crash/session-creation failure burns the challenge; no retry issues a second session from it.
An ambiguous session insert/cookie response is not replayed to recover a token. Recheck eligibility
immediately before issuance and on subsequent requests; revoke any newly issued session if its
binding checks fail. Session issuance/rotation must fail closed on unknown commit outcomes.

Resend means **request a new challenge**, never resend the old one. At acknowledged creation, serialize
by the common phone lock and supersede all earlier ACTIVE staff challenges for that phone, across
devices, under the settled newest-accepted-challenge policy. They can no longer verify. A pending
old send is skipped; an already-fenced send may finish but its superseded code is useless. Expiry is
`created_at + 5 minutes`, never queue time, delivery time or an extended retry deadline. Repeated
request/verify HTTP calls cannot enqueue the same challenge again or revive consumed/terminal rows.

### 3. Global identity tables and exact grants

Classify both new tables as **ADR-0003 §2.1 global identity**, migration-owned by `pospay_owner`, no
`company_id` tenant discriminator and no tenant RLS. Immutable device-context metadata restricts this
auth operation; it conveys no tenant access. Neither table is `notification_attempts` or global
messaging control. No global OTP event goes to tenant outbox, delivery log or reporting.

| Table / columns | Rule |
|---|---|
| `auth_otp_challenges.id` | UUID v7 PK; generated by injected secure id generator, never reused |
| `recipient_hash`, `hash_key_id` | 32-byte platform phone HMAC and frozen-key metadata, identical to ADR-0013 |
| `user_id`, `device_context` | existing global user FK, nullable only for a suppression refusal; immutable validated device context; no full phone |
| `code_mac`, `derivation_key_id`, `verification_key_id` | nullable 32-byte keyed code hash and key ids, required while ACTIVE; no derivation material for SUPPRESSED; only this table stores the hash |
| `status`, `failed_attempts` | ACTIVE, CONSUMED, EXHAUSTED, EXPIRED, SUPERSEDED or SUPPRESSED; bounded 0..5 |
| `created_at`, `expires_at`, `consumed_at`, `finished_at`, `updated_at` | UTC timestamptz; fixed 300-second validity; terminal timestamps consistent |
| `auth_notification_attempts.id`, `challenge_id` | UUID v7 PK and challenge FK; retained challenge identity |
| `recipient_hash`, `hash_key_id`, `user_id` | phone hash/key metadata; nullable global user id for a suppression-only refusal |
| `channel`, `template_key`, `template_revision`, `locale`, `provider_template_name` | WHATSAPP, staff_otp, immutable revision and explicit ar/en locale/name; nullable mapping only for configuration failure |
| `status` | PREPARED, PENDING, SENDING, SENT, FAILED, EXPIRED or SUPPRESSED; only acknowledged enqueue permits PREPARED→PENDING, never back to PENDING |
| `authorized_at`, `send_deadline`, `created_at`, `updated_at` | UTC timestamptz; authorized_at set only at release to PENDING after enqueue acknowledgment and fresh suppression check; send deadline equals challenge expiry |
| `execution_id`, `sending_at`, `finished_at` | one irreversible execution fence and lifecycle times |
| `failure_code`, `outcome_known`, `provider_message_digest` | finite diagnostics and optional domain-separated provider-id HMAC; never raw phone-bearing wamid |

The ledger has **no code, code hash, phone, encrypted phone, token, body, sensitive parameters or
arbitrary JSON**. Suppression-only rows use a terminal challenge record with no usable `code_mac` and
nullable user id; no code is generated for a suppressed phone. Invalid/ineligible acknowledgments need
no usable database challenge.

Unique ledger key `(challenge_id, channel, recipient_hash, template_key)`: revision, locale and key id
cannot authorize another send. Enforce immutable identity/deadline fields and monotonic states in the
facade and database; terminal challenges clear `code_mac` atomically with their transition, and an
UPDATE may clear but never replace a non-NULL MAC. Index
challenge phone/status/time, user id, expiry/time/id, and ledger challenge/status/time/id. Foreign keys
reference global identity only; do not grant auth access to devices, employees or memberships.

- `pospay_auth`: existing CONNECT/schema USAGE; SELECT and exact column INSERT for both table shapes;
  UPDATE only challenge `status,failed_attempts,code_mac,consumed_at,finished_at,updated_at` and ledger
  `status,authorized_at,execution_id,sending_at,finished_at,failure_code,outcome_known,provider_message_digest,updated_at`;
  DELETE for bounded auth-owned retention. No TRUNCATE/REFERENCES/TRIGGER/sequence/schema CREATE,
  role membership, ownership or BYPASSRLS. The session changes remain auth-only under existing grants.
- Grant auth **EXECUTE only** on `public.platform_whatsapp_is_suppressed(bytea)`; no direct suppression,
  inbox or messaging-audit grant. Preserve the reader-owned definer, pinned search path, NULL-only
  suppression CHECK and column inventory. No SET ROLE or alternative pool for the boolean check.
- `pospay_app`, `pospay_dispatcher`, `pospay_notifications` and PUBLIC: no grants on either new table;
  PUBLIC has no additional function EXECUTE. Tenant and dispatcher privileges remain unchanged.

Only `packages/auth` imports the restricted auth DB facade. The worker root constructs a **narrow OTP
execution facade**, not a full `AuthService`: pending/claim/materialize/finish/retention/readiness/close,
all bounded and challenge/execution-id fenced. It exposes no raw client, general SQL, user directory,
session creation, account/password reads or tenant reader. Its connection still uses `pospay_auth`;
this is a code-level capability restriction, not a claim that the shared DB role loses its existing
identity grants. Worker notification ports/adapters receive it by root injection, without a
notifications → identity import or notification use case importing `packages/auth` internals.

Destination recovery stays **auth-owned**: read the linked user's current canonical phone from global
identity, recompute its platform HMAC and require exact equality with the challenge/ledger hash and
user mapping. A changed/removed phone or deleted user terminates the send; never send to the new phone
or recover a destination from an irreversible hash. Notifications has no contact lookup. Drop transient
phone/code on every result/error. There is no destination column to clear, even in unknown SENDING.
Hash keys remain frozen under ADR-0013; rotation requires its shared alias/lock migration.

Retain challenge/attempt metadata for **30 days after challenge expiry**, clear MACs immediately on
consumption/exhaustion/expiry/supersession, and run an hourly bounded expiry/retention job. Do not
delete in-flight SENDING until its owning execution is stopped/drained. Missing/expired rows always
skip and never reconstruct an attempt from job data; UUIDs are never reused. Permanent minimal security
audit contains action, user/device/challenge ids, time and finite result only, without phone/hash/code.

### 4. Better Auth integration and composition roots

Choose a **small auth-owned OTP flow in `packages/auth`**, using the existing pinned Better Auth
session primitive behind its facade. Do not register `phoneNumber` or `emailOTP`; their generic routes
would need additional isolation/proof work for this device-bound flow and custom worker derivation.
Keep phone-number wildcard routes at 404. This deliberately supersedes ADR-0009's planned plugin
registration and ADR-0018 §7's plugin wording, while preserving their auth ownership and session model.
No new plugin/package or version upgrade is proposed; Better Auth/adapter remain exactly **1.7.5**.

Auth defines `OtpSender.enqueue({challengeId, attemptId})` with an id-only contract. At `apps/api`'s
application composition root, bind it to a BullMQ producer for `notifications-otp`. Auth/identity/staff
do not import `packages/notifications` or BullMQ; worker notifications owns the WhatsApp Channel and
its template adapter. The worker root injects the restricted auth execution facade through
notification-owned ports. These are explicit auth transport/ledger capabilities, not a new synchronous
business-module write port. Dependencies, clock, ids and crypto/network adapters bind at roots;
policy arithmetic/state rules remain pure and use cases import no infrastructure.
Inject the existing platform phone-identity/lock-key functions through auth-owned strategy ports at
these roots; do not create a differently normalized or independently hashed OTP suppression identity.

### 5. Sending, suppression and production gates

OTP is **disabled by default**. Add an explicit `STAFF_OTP_ENABLED` activation setting, default false
when absent or empty; `NODE_ENV=production`, available secrets or general outbound configuration do
not implicitly enable it. Bind disabled adapters without requiring OTP-only secrets/templates or
starting the OTP consumer. API and worker start and remain ordinarily ready with empty notification
settings and outbound disabled, including staging's production-mode configuration. Disabled OTP
requests receive the common generic pre-lookup `503 OTP_UNAVAILABLE`, without phone/user/suppression
lookup, challenge/ledger creation, enqueue or send. The employee's own PIN remains a separate path.

Only explicit activation enables the full live checks: auth role/grants, suppression definer and
constraint inventory, live STOP subscription, fail-closed Redis admission, id-only OTP queue,
reserved worker, independent keys, worker WhatsApp credentials and approved ar/en OTP templates.
Missing/invalid settings, fake mode or allow-all admission close **OTP only**. Keep ordinary API/worker
startup and readiness independent of this capability; report OTP's DISABLED, UNAVAILABLE or READY
state separately for internal operations, without propagating it into service readiness. Partially
configured activation never throws a process-startup error or disables other API/worker functions.
Both roots must agree on activation and capability availability before request processing; repeat
the worker capability check before claim/materialization and immediately before HTTP so stale jobs
cannot send while OTP is disabled/unavailable. Pre-lookup request availability checks use the same
capability state for every phone and refuse generically when it is not READY.

Prepare on one short READ COMMITTED **auth** transaction: take ADR-0013's exact company-independent
phone advisory lock, execute the suppression boolean in a fresh statement snapshot, and commit the
challenge plus unique **PREPARED** ledger row together. PREPARED grants no worker claim or send
permission. A suppression winner records terminal SUPPRESSED, no MAC/code and no sender job.
Lookup/DB/check errors fail closed internally, with the common 202 response after preflight.
Request, verification and worker transitions use a consistent phone → challenge → attempt lock order,
with deterministic id ordering for multiple rows; release these transactions before provider HTTP.

After acknowledged commit, enqueue **once** to `notifications-otp`, payload `{challenge_id, attempt_id}`,
stable job id based on both ids, `attempts=1`, no phone/code/user claims. Only after successful, bounded
preparation and **acknowledged enqueue** may the API auth facade release PREPARED→PENDING: take the
same phone lock, perform a fresh suppression check and recheck activation, ACTIVE challenge and expiry,
then set `authorized_at` and commit. This release is not exposed by the worker facade. STOP committed
before release blocks authorization; an attempt authorized first may finish after STOP under ADR-0013.
If STOP wins at release, terminalize the challenge/attempt as SUPPRESSED and clear its MAC; an already
enqueued job remains unable to claim or send. A release check failure likewise grants no authorization.
Suppression never blocks the established PIN credential or lifts passkey requirements; no SMS/email
bypass, START or manager opt-in override.

Bound the entire post-preflight preparation/ledger/enqueue/release path to **200 ms**, including
cancellation/drain; never detach an enqueue/send/release promise after response or wait on the provider.
Use the same 200 ms response window for all admitted requests, selected before phone lookup. Complete
unknown/ineligible/suppressed and early-failure paths in that window too, so fast refusals and bounded
timeouts do not identify eligible phones. DB/lock/preparation or BullMQ failures/timeouts **still
return the identical 202**; record finite, secret-free internal outcomes, cancel/drain bounded work,
and never infer rollback from an unknown commit. Preparation/enqueue failure or an unknown enqueue
result must not release PREPARED. Terminalize it as FAILED where an acknowledged update is possible;
otherwise it stays non-sendable until bounded expiry cleanup. An unknown enqueue may have created
a job, but that job cannot claim PREPARED. A job arriving before release is skipped without retry;
this deliberate loss is safer than authorizing an uncertain enqueue. A 202, job, enqueue result or
failed/unknown operation alone grants no send permission; the worker still requires its acknowledged
PENDING→SENDING fence. No recovery sweep releases or re-enqueues PREPARED rows. Commit/enqueue/release
crash gaps may lose OTP; the POS makes a new request after the 60-second cooldown.

| Failure / availability state | External request result | Internal effect |
|---|---|---|
| Disabled OTP or explicitly enabled but incomplete live configuration | Generic 503 OTP_UNAVAILABLE before phone lookup | No challenge/job/send; OTP closed, ordinary services start and remain ready |
| Common dependency/capacity availability check fails before phone lookup | Same generic 503 OTP_UNAVAILABLE for every phone | No identity lookup or send authorization; internal capability diagnostic only |
| Common cooldown/quota check refuses before identity lookup | Generic 429 with Retry-After independent of eligibility | Count/reserve according to settled limits; no send |
| Unknown/ineligible/suppressed phone, or post-lookup lookup/preparation/DB/lock failure | Identical 202 body and response window | No send permission; finite internal refusal/failure, no usable code/job for suppressed phones |
| BullMQ failure, timeout or unknown enqueue result | Identical 202 body and response window | No PREPARED→PENDING release; any existing job is non-sendable, record failure/uncertainty internally |
| Release/claim/result crash or unknown commit | Identical 202 if the request is still in flight | No permission inferred from uncertainty, no retry/sweep; retain acknowledged worker fence and at-most-once rules |

Reserve a **separate OTP worker with concurrency 4**, independent of tenant `notifications-send`
capacity/limiter, and measure request acceptance → first provider HTTP start at **≤5 seconds under the
agreed pilot load**. This is a submission target, not a handset-delivery guarantee or a new expiry.
Reserve worker/DB/Redis headroom, prioritize OTP over tenant traffic, monitor queue age and fail closed
on capacity/configuration loss; increase capacity from measurements without sharing away reserved slots.

Worker sequence: require activated/READY OTP → load eligible unexpired **PENDING** challenge/attempt
→ validate mapping/configuration → reserve
shared recipient admission → atomically claim PENDING→SENDING with execution id and recheck ACTIVE
challenge/expiry → acknowledge COMMIT → auth derives/checks code and materializes matching destination
→ notification adapter assembles the sensitive template in memory → Channel makes one bounded HTTP
call outside every DB transaction → fenced result recording. Only the execution with acknowledged
claim may materialize/call; unknown commit grants no permission. If supersession/expiry occurs before
materialization, skip HTTP and terminalize appropriately. If it occurs after materialization, a stale
message may arrive, but verification still refuses it. No send permission is reacquired after SENDING.

Bind the existing `SendAdmission` Redis adapter at **1000 ms**, with one recipient-hash key shared
across OTP and tenant traffic, Redis TIME and atomic reservation. Admission refusal never sleeps or
retries the challenge; record FAILED/ADMISSION_REFUSED, and errors fail closed with zero HTTP. Separate
queue capacity does not waive this shared recipient limit. Check absolute auth expiry immediately
before HTTP; retain the existing ≤10-second timeout shortened by remaining lifetime, no redirect or
SDK/network retry. 4xx/429, 5xx, timeouts and crash windows follow ADR-0018's at-most-once fence.
SENT means PROVIDER_ACCEPTED, never handset receipt; delivery state does not extend/consume the code.
Verification does not require a recorded SENT, since a provider may accept before result recording.

`staff_otp` currently declares a sensitive body parameter, while `validateParameters` deliberately
rejects all sensitive descriptors. PR 6 must add a **separate OTP-only in-memory template preparation
path** for that exact descriptor/revision and approved ar/en components. Do not relax `SafeParameter`
or tenant event validation to carry codes. Require approved AUTHENTICATION copy/button components,
Meta names and explicit ar/en mapping with no fallback. Final copy and approved Meta template names
remain `TODO(spec)` and block live activation; do not invent names or treat example copy as approved.

After PR 6, permit **OTP-only live WhatsApp** only with explicit activation and passing OTP capability
checks. Check worker main, module factory,
configuration reader and both queue/template allowlists; replacing a single refusal/default is not
sufficient. The full checks above gate OTP capability, never ordinary startup/readiness. API receives
the required auth/queue/hash secrets for enabled OTP but no WhatsApp sending token; only worker
Channel receives it. Production-mode staging remains ready with OTP disabled and these settings empty.

Tenant outbound WhatsApp remains disabled separately. Approved per-template Meta names/copy, producer
events, correct locale/destinations/deadlines and any sensitive link derivation still gate ratings/alerts;
recipient admission approval does not supply them. In-app and inbound STOP continue independently.
This design claims no deployment, live template approval, webhook activation or runtime readiness.

### 6. API and POS flow

| Endpoint | Contract / authentication |
|---|---|
| `POST /v1/devices/me/staff-otp/request` | `{phone, locale}`; valid Device token plus explicit device-only guard; phone canonical E.164, locale explicitly ar/en |
| `POST /v1/devices/me/staff-otp/verify` | `{challenge_id, code}`; same device-only guard; lookup determines user/scope, no phone/employee/company claims |

These routes require no employee session but are **not public**: pair first. Register them explicitly
in guard coverage with `@Authenticated()` plus device-only enforcement; do not add a broad `@Public`
auth wildcard. Require the configured POS Origin, trusted CORS and bounded request/body/concurrency.
Staff-cookie operations retain origin/CSRF checks. Contract definitions belong to contracts and UI
strings to i18n, Arabic-first/RTL with English, generated client hooks and shared UI components.

- For the **request endpoint**, run device/origin/body validation, common OTP activation/dependency/
  capacity availability checks, then common rate admission **before phone-to-user or membership lookup**.
  Disabled/unavailable OTP returns generic `503 OTP_UNAVAILABLE` identically for every submitted phone;
  it creates no challenge or job. Only these pre-lookup availability checks may return 503. A dependency
  that fails later is an internal post-preflight failure and receives 202, not a late 503. Availability
  must not depend on the candidate user, membership, suppression or recipient-specific send outcome.
- Redis atomically admits **5 requests/phone/rolling hour**, **20/IP/rolling hour** and a **60-second
  per-phone cooldown**, shared across device/API instances. Count every syntactically valid request,
  including absent/ineligible/suppressed phones once rate-admitted, before identity eligibility; do not refund uncertain
  reservations. Hash phone/IP key material, never store raw input in limiter members or diagnostics.
  Use Redis clock, expiry and one atomic admission decision so races cannot overrun any cap.
- Resolve IP only through the configured trusted proxy; do not accept arbitrary forwarded-IP headers.
  Cooldown/quota refusal returns generic 429 with Retry-After, independent of account existence.
  Request limiter availability is checked before identity lookup: Redis unavailable returns the common
  generic 503 there, never an in-memory/no-limit fallback. Post-lookup Redis/BullMQ failure returns 202.
  Enforce verification limits
  **25/phone/hour and 100/IP/hour**, plus the authoritative 5-attempt challenge counter.
  A real challenge supplies its phone hash for verification limits; absent ids still consume IP
  capacity and perform dummy comparison, with no client-supplied phone that could bypass the cap.
- After common preflight, request returns HTTP 202 with the same `status=ACCEPTED`, fresh
  `challenge_id`, `expires_in=300`, `retry_after=60` and `recovery=ASK_MANAGER` for **every outcome**:
  eligible, unknown, nonmember, suppressed, preparation failure or enqueue failure/timeout/uncertainty.
  Only the fresh opaque id differs between requests; an id never proves a database challenge exists.
  Use the same headers, body fields, localized copy and §5 response window; no outcome-dependent
  recovery flag, error envelope or Retry-After. Draft common copy: “If a code arrives, enter it. If
  WhatsApp sign-in is unavailable, ask your manager for help signing in on this branch device with
  your own cashier PIN.” This tells suppressed employees to ask the manager without exposing
  suppression or eligibility; no useful code/job is created for a suppressed phone. Final bilingual
  copy remains `TODO(spec)`. Acknowledgment never asserts enqueue/send success. Never suggest clearing STOP.
- Verify success returns HTTP 200 with permitted staff context and sets the restricted cookie.
  Wrong, absent, expired, exhausted, superseded, consumed, changed-phone or ineligible challenges share
  one HTTP 401 `OTP_INVALID` bilingual envelope; no attempt count, user-existence or expiry reason.
  A bad/revoked device receives the existing generic device-auth refusal before phone lookup.
  Verify also checks common OTP availability before challenge/user resolution; disabled/unavailable
  OTP refuses generically without session issuance. Post-resolution failures use the generic
  verification refusal, not an eligibility-dependent 503. Its successful proof/session contract
  remains 200; the uniform 202 rule applies to requesting a code, not verifying one.

POS flow: confirm pairing online → enter phone and explicit UI locale → show code entry and 60-second
new-code countdown → submit code → signed-in staff screen. Common pre-lookup OTP unavailability
shows the manager/own-PIN recovery path. On success wipe phone/code from form state;
never persist either, a challenge, or a verify/request command in Dexie/service-worker background sync.
New-code action replaces the current challenge even when an older WhatsApp arrives late. Generic
missing-code/recovery screens show identical own-PIN and manager guidance for every request outcome,
including suppression; the screen must not infer a phone's eligibility or suppression from a 202. Manager
assistance never substitutes the manager's credentials for the employee's sign-in.

Offline: request/verification are disabled with a reconnect message; no local OTP verification,
optimistic authentication, queued login or code accepted on later sync. Current pairing boot already
shows offline when it cannot probe. PR 6 allows no new authentication or private staff access offline;
require fresh server validation on reconnect. Existing pairing data may remain, but cannot prove
a staff session offline. Offline PIN hashes/operator credentials are Phase 2 work, not supplied by this
ADR. Online employee-PIN fallback preserves PIN's existing 4-digit/5-failure/15-minute lockout policy;
that lockout is distinct from the staff session, which has no idle timeout.

### 7. Tests PR 6 must add — implementation obligations, not run here

- **Identity/scope:** valid paired-device login; unknown phone/nonmember generic equality and zero sends;
  company/business/branch coverage, future/expired membership, DENY, closed company, wrong device/company,
  explicit login permission, Staff bundle, explicit reception/cashier grants and no implicit owner/admin
  grant; approved canonical binding, refusal of self-signup/tenant-manager overwrite, changed/deleted
  phone/user, revocation between request/verify and on the next session request. Prove
  global OTP DB paths never call withTenant and auth cannot read tenant/bridge data; device eligibility
  reads use only the verified device company, and candidate lookup cannot open another company.
- **Request availability/privacy failures:** disabled-by-default and explicit incomplete activation
  return the same generic pre-lookup refusal for every phone, with zero lookup/challenge/job/send.
  Common dependency unavailability yields 503 before any identity lookup; quota checks remain generic.
  Once preflight passes, eligible/unknown/nonmember/suppressed requests and injected lookup, preparation,
  DB/lock and BullMQ failures/timeouts/unknown outcomes have identical 202 bodies (apart from opaque ids),
  headers and recovery guidance, with comparable 200 ms timing distributions. Assert no late 503,
  eligibility/suppression field or error-response leak; verify post-resolution failure stays generic.
- **Crypto/challenge:** independent-key/domain test vectors; identical API/worker code and MAC, leading
  zeroes, unbiased conversion, missing/retiring keys, tampered context/MAC, constant-time primitive
  invocation and dummy path; 300-second boundary, fifth failure, parallel failures/successes, replay,
  supersession across devices and no expiry extension. Crash after consumption/unknown session creation
  issues no second session. Expiry jobs atomically clear MACs without reviving send permission.
- **Session/guards:** tagged Better Auth session expires at 8 hours, has no idle timeout, and cannot
  renew past its original deadline; isolated cookie and origin checks, Device-plus-cookie resolution,
  token substitution into normal cookie, admin/platform
  and generic auth-route refusal, no client-writable purpose/context, permission/own isolation, replacement
  and logout/cache clearing in every tab; separate devices retain independent simultaneous operators.
  Prove durable new-session creation precedes replacement and failed creation preserves the old operator.
  Employee-PIN recovery refuses manager-PIN impersonation and records the actual actor for each reset
  and sign-in. PIN fallback never grants admin access or permits passkey-free QR attendance.
- **Roles/schema/privacy:** actual auth role only, exact column grants/checks/indexes; app/dispatcher/
  notifications/PUBLIC denied; no runtime BYPASSRLS/SET ROLE; only auth suppression-function EXECUTE;
  auth facade/import restrictions and no raw client. Inspect ledger/challenges/Redis/jobs/outbox/audit,
  HTTP error logs, queue failure text, traces and synthetic provider-id fixtures for no plaintext code,
  full phone or raw wamid; only the challenge table contains the keyed code hash. Missing keys or
  SQL/provider errors have no raw-parameter fallback. Retention leaves suppression unchanged and stale
  jobs after purge cannot recreate/send a challenge. New tenant changes, if any, ship RLS negatives.
- **STOP:** real Postgres tests for both STOP/auth authorization lock orders, fresh snapshot, rollback,
  unknown commit, suppressed phone without a user, and attempted forbidden opt-in writes. STOP winning
  initial preparation produces zero code/job/HTTP; STOP winning release after preparation clears the
  MAC and prevents any queued job from claiming/sending. Already-authorized behavior stays consistent
  with ADR-0013. Both paths return the common 202 and identical recovery guidance after preflight.
- **Redis/transport:** exact cooldown/rolling-hour boundaries, simultaneous API instances and shared
  salon IP, trusted-proxy spoof rejection, verification reservation/count races, Redis unavailable;
  admission shared between queues at 1000 ms, no sleep/retry and zero HTTP on refusal/errors. Id-only
  enqueue, ≤200 ms bound, each commit/enqueue/claim/provider/result crash window, two processors,
  recreated/duplicate/stalled jobs and unknown commit produce ≤1 submission per challenge.
  Preparation/enqueue failure or unknown enqueue never releases PREPARED or permits HTTP; exercise a
  job created despite lost enqueue acknowledgment, a job arriving before release, cancellation/drain,
  no late release after the response and no sweep/retry that revives these rows. Release requires
  acknowledged enqueue plus a fresh locked STOP/activation/expiry check; STOP winning that lock blocks send.
- **Worker/templates/gates:** transient OTP-only rendering with exact approved ar/en component order,
  missing locale/name/config fails closed, sensitive tenant parameters remain rejected; current-phone
  hash mismatch skips; expiry advanced after load/claim/materialization and immediately before HTTP;
  acceptance/4xx/429/5xx/timeout through FakeChannel, no provider credentials in CI. Saturate tenant
  capacity and prove reserved OTP submission ≤5 seconds under specified pilot load. Start API and
  worker with NODE_ENV=production, every notification setting empty and OTP/outbound disabled: both
  start and stay ordinarily ready. With activation explicitly enabled, fake/allow-all/wrong-role/
  missing-key/template/STOP configuration closes OTP only, with internal capability diagnostics and
  no process/startup/readiness failure elsewhere. Prove disabled/unavailable workers skip existing jobs,
  runtime capability loss prevents new HTTP, valid activation opens only OTP, and tenant sends stay refused.
- **POS:** Playwright phone → code → sign-in, generic wrong code, countdown/new challenge/late message,
  identical manager guidance/own-PIN path for suppression and other request outcomes, common disabled/
  unavailable recovery, cookies with Device header, operator replacement across tabs,
  form/cache clearing, offline during request/verify, reconnect/revocation and no persisted login commands.
  PR 20 separately tests personal authenticator enrollment; PR 22 tests per-clock passkey assertions.

### 8. Governing amendments — listed, not applied

- **CLAUDE.md §§5/8:** list auth OTP challenge/ledger global-identity tables, restricted facade and
  auth suppression EXECUTE; record code-MAC/derivation ownership, scoped Better Auth staff session and
  approved Redis request/admission policy. **§6/7:** explicit device-only OTP guard, bounded enqueue and
  online-only authentication exception to local-first business writes; no provider wait or OTP sync.
- **module-map.md + generated YAML/checker:** name API OtpSender/worker auth-facade composition wiring
  and the narrowly allowed outer adapters/ports. Record auth transport capability separately from
  business cross-module writes; no identity/staff/customer import of notifications, notifications import
  of identity/auth internals, tenant send event for OTP or new dispatcher privilege.
- **ADR-0003 §§2.1/3/4/6:** classify both tables/retention grants and staff-purpose session metadata;
  inventory auth-only suppression EXECUTE; distinguish device-proven eligibility from global OTP DB
  work and from user-session membership discovery; list device-only login endpoints and purpose guards.
- **ADR-0018 §7:** replace planned phone plugin with the auth-owned flow; specify separate code-MAC
  challenge storage, deterministic worker derivation, hash-only ledger/destination lookup, id-only direct
  enqueue, non-sendable PREPARED/release ordering, reserved OTP concurrency, settled limits,
  loss/new-challenge recovery, default-disabled OTP activation independent of service readiness,
  and uniform post-preflight request responses.
- **ADR-0009/ADR-0013:** record deliberate non-registration of phoneNumber in PR 6, preserve 1.7.5;
  reconcile auth suppression grant and production gate, preserving STOP commit semantics and PR 20 UV.
- **Phase 1 SPEC/plan and constitution:** record paired-device session scope, settled owner/orchestrator
  rules and online-only login; resolve the personal-phone/passkey enrollment dependency before PR 20.
  Preserve PR 6's current
  dependencies 3/4/5 and require the scoped staff verification contract for PR 20. List necessary
  contract/schema/auth/guard/root/client/i18n/observability/env/deploy/readiness changes in the PR 6 slice
  spec; this DESIGN step applies none of these amendments or implementation changes.

## Alternatives considered

| Alternative | Rejected because |
|---|---|
| Normal multi-company Better Auth session/default lifetime | leaks shared-device staff authority into broader sessions and leaves long-lived kiosk access; use purpose/device restrictions |
| Staff idle timeout or sliding renewal | contradicts the settled shift policy: no idle timeout and no renewal beyond the original 8-hour deadline |
| Manager PIN used to sign in another employee | impersonates the employee and misattributes actions; use that employee's own PIN and audit manager assistance separately |
| Handwritten JWT or separate session cryptography | duplicates Better Auth and violates auth ownership; retain its session primitive in the scoped flow |
| Personal-phone login/unpaired POS in this PR | contradicts this task's paired-device scope; requires a separate enrollment/login decision before PR 20 |
| Auto-signup by phone or customer/employee-contact matching | creates unauthorized users/ambiguous identity; memberships and global unique phone binding are authoritative |
| phoneNumber plugin on 1.7.5 | adds generic verification/sign-in endpoints whose storage/session/device behavior needs proof or customization; custom auth flow directly expresses the required ledger and derivation protocol |
| emailOTP plugin repurposed for WhatsApp | email identity/routes do not express phone/device/challenge restrictions and add unnecessary public surface |
| Random plaintext code in ledger/job/event, even encrypted | violates the code-storage constraint and exposes replayable short secrets; derive once per immutable challenge, retain a keyed hash only |
| In-memory handoff, Pub/Sub rendezvous or temporary Redis code vault | process/worker affinity and restart loss, or another persisted OTP secret; deterministic auth derivation crosses containers without a code store |
| Unkeyed code hash or deriving from public phone/time | six digits are offline-enumerable, or the code is predictable; independent server secrets protect both operations |
| Phone snapshot in global OTP ledger / notification contact lookup | unnecessary full-phone persistence/global reader coupling; auth resolves its own linked user and validates the immutable phone hash |
| Tenant notification_attempts/outbox or auth BYPASSRLS | OTP identity is global; tenant context/grants cannot be invented or expanded for delivery |
| Shared worker slots, allow-all admission or automatic resend | tenant bursts starve OTP or bypass owner limits; retry after uncertainty can duplicate submissions |
| STOP bypass for OTP or tenant manager opt-in override | violates the settled owner decision and monotonic suppression; use the established PIN credential |
| Enable all outbound WhatsApp when admission lands | admission alone supplies neither approved templates nor producers/sensitive-link transport; open OTP independently |
| Require live OTP configuration for ordinary production startup/readiness | breaks disabled staging and unrelated services; gate only explicitly activated OTP capability |
| Return 503 or suppression-specific response after phone lookup | exposes eligibility or suppression through status/body/timing; use the same 202 and recovery guidance after common preflight |
| Enqueue a worker-claimable attempt before enqueue acknowledgment | an unknown/failed enqueue can still produce a job and send; keep PREPARED non-sendable until acknowledged enqueue and fresh authorization |

## Consequences

- Login stays in auth; device authentication and memberships restrict every resulting session. The
  worker receives a narrow global auth capability, and tenant isolation/dispatcher access are preserved.
- No persisted plaintext OTP or ledger phone is needed. Two independent auth keys and immutable
  phone/context mapping become operational dependencies; phone changes cancel pending delivery.
- OTP is opt-in and disabled by default. Empty notification settings in production-mode staging and
  partial OTP activation do not block ordinary API/worker startup or readiness. Operators inspect a
  separate internal OTP capability state; only explicitly enabled, fully checked OTP can send.
- Common availability checks may refuse before phone lookup. After they pass, the same 202/body and
  response window hide eligibility, suppression and preparation/enqueue failures; 202 is not evidence
  of a challenge or delivery. Identical manager/own-PIN guidance preserves recovery without revealing
  suppression. Internal secret-free failure records and metrics carry the operational diagnosis.
- At-most-once delivery and consumption may lose a code/session on crashes or unknown commits. Recovery
  is a new, rate-limited challenge or the employee's own PIN with manager assistance if needed, never
  automatic resubmission, manager-PIN impersonation or suppression removal.
- Non-sendable PREPARED attempts prevent preparation/failed or uncertain enqueue from authorizing a
  send, including jobs created despite lost acknowledgment. Early jobs and crash gaps can lose a
  code; no background retry/release repairs that gap. Request a new challenge under the settled limits.
- Better Auth purpose restrictions must cover both Nest guards and its mounted handler. POS cookie
  support and scoped PIN recovery are real implementation work; existing Device/PIN results do not
  constitute completed staff login. OTP-only production activation remains conditional on live gates.
- Paired POS authentication cannot implicitly satisfy personal-phone enrollment or QR attendance.
  PR 20/22 retain passkey/UV/presence proofs, and their personal-device flow needs an explicit resolution.

## Open questions for the owner

Eligibility, session, shared-device, recovery, limits, retention and language rules are settled above.
Only the following template approval TODO and future design note remain:

| ID | Remaining item | Required follow-up |
|---|---|---|
| Q7 | Final bilingual copy and approved Meta template names/components — `TODO(spec)` | Approve ar/en AUTHENTICATION copy, including 5-minute expiry wording and Meta-required buttons, and supply actual approved template names before live activation. The explicit ar/en choice and no-fallback rule are settled; current staff_otp and recovery copy remain drafts. |
| Q4 | Future personal-phone/passkey enrollment design note | Design the personal-phone enrollment/login extension before PR 20. PR 6 remains paired-device only; never auto-enroll the shared kiosk as an employee passkey or treat its OTP session as a QR clock assertion. |

Q7 approval blocks live OTP activation. Q4 is a future design obligation before PR 20, not an open
choice about PR 6's scope. This revision changes no implementation or other governing documents.
