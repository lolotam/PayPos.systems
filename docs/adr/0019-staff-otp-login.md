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
| `preparation_deadline` | Immutable UTC timestamptz copied from the common post-preflight 200 ms window; bounds API release and worker waiting, never extended by dequeue or polling |
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
same phone lock, perform a fresh suppression check and recheck activation, ACTIVE challenge, expiry
and fresh database wall-clock time after lock acquisition strictly before the immutable
`preparation_deadline`, then set `authorized_at` and commit. This release is not exposed by the
worker facade. STOP committed
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
otherwise it stays non-sendable until worker timeout or bounded expiry cleanup. An unknown enqueue
may have created a job, but that job cannot claim PREPARED. A 202, job, enqueue result or
failed/unknown operation alone grants no send permission; the worker still requires its acknowledged
PENDING→SENDING fence. No recovery sweep releases or re-enqueues PREPARED rows. Commit/enqueue/release
crash gaps may lose OTP; the POS makes a new request after the 60-second cooldown.

If a job finds **PREPARED**, keep that same job execution alive and **wait boundedly outside every
database transaction** for the API's release. The auth facade returns status and the immutable
`preparation_deadline` established from the common 200 ms window before phone lookup; no code or
destination is materialized while waiting. Use bounded status polling with short reads, releasing
each transaction/connection before the timer wait. Do not restart the window at dequeue, hold a
database lock/transaction during a wait, re-enqueue or retry the job. Stop waiting on PENDING, a
terminal/missing row, capability loss, challenge expiry or the preparation deadline. PENDING proceeds
through the normal admission and acknowledged claim fence; PREPARED itself never permits a send.

At the deadline, perform a final short locked state check. If the attempt is still PREPARED,
conditionally mark it FAILED with the finite outcome `PREPARATION_WINDOW_ENDED` and complete the
job with **zero sends**; if persistence fails, record a secret-free internal failure and grant no
permission. A concurrently observed PENDING row released before the deadline may proceed normally;
the API's locked deadline check prohibits a late release after timeout terminalization. Terminal,
missing or otherwise invalid rows record their finite skip outcome and do not send. This bounded
wait preserves an early job until a successful release without weakening failed/uncertain enqueue
handling or the at-most-once submission fence.

| Failure / availability state | External request result | Internal effect |
|---|---|---|
| Disabled OTP or explicitly enabled but incomplete live configuration | Generic 503 OTP_UNAVAILABLE before phone lookup | No challenge/job/send; OTP closed, ordinary services start and remain ready |
| Common dependency/capacity availability check fails before phone lookup | Same generic 503 OTP_UNAVAILABLE for every phone | No identity lookup or send authorization; internal capability diagnostic only |
| Common cooldown/quota check refuses before identity lookup | Generic 429 with Retry-After independent of eligibility | Count/reserve according to settled limits; no send |
| Unknown/ineligible/suppressed phone, or post-lookup lookup/preparation/DB/lock failure | Identical 202 body and response window | No send permission; finite internal refusal/failure, no usable code/job for suppressed phones |
| BullMQ failure, timeout or unknown enqueue result | Identical 202 body and response window | No PREPARED→PENDING release; any existing job is non-sendable, record failure/uncertainty internally |
| Worker observes PREPARED before API release | Identical 202 body and response window | Wait outside DB transactions only until the fixed preparation deadline; proceed only on valid PENDING, otherwise record the outcome and send nothing |
| Release/claim/result crash or unknown commit | Identical 202 if the request is still in flight | No permission inferred from uncertainty, no retry/sweep; retain acknowledged worker fence and at-most-once rules |

Reserve a **separate OTP worker with concurrency 4**, independent of tenant `notifications-send`
capacity/limiter, and measure request acceptance → first provider HTTP start at **≤5 seconds under the
agreed pilot load**. This is a submission target, not a handset-delivery guarantee or a new expiry.
Reserve worker/DB/Redis headroom, prioritize OTP over tenant traffic, monitor queue age and fail closed
on capacity/configuration loss; increase capacity from measurements without sharing away reserved slots.

Worker sequence: require activated/READY OTP → load challenge/attempt → if PREPARED, bounded wait
outside DB transactions for API release → require eligible unexpired **PENDING** → validate
mapping/configuration → reserve
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
  job created despite lost enqueue acknowledgment, cancellation/drain,
  no late release after the response and no sweep/retry that revives these rows. Release requires
  acknowledged enqueue plus a fresh locked STOP/activation/expiry check; STOP winning that lock blocks send.
  Deterministically pause the API before release, let an idle worker observe PREPARED and enter its
  bounded wait, then release PENDING within the preparation window: prove **exactly one delivery**
  (one provider submission), with materialization/HTTP only after acknowledged PENDING→SENDING.
  In a separate release-never-happens scenario, advance the injected clock to the fixed deadline:
  prove **zero sends**, recorded PREPARATION_WINDOW_ENDED and no subsequent release/retry. Prove all
  waits hold no DB transaction/lock/connection, dequeue/polling cannot extend the window, and final
  timeout/release races cannot send from PREPARED or authorize after the deadline.
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
  enqueue, non-sendable PREPARED/release ordering and bounded worker wait, reserved OTP concurrency,
  settled limits,
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
  send, including jobs created despite lost acknowledgment. An early worker waits outside DB
  transactions within the fixed preparation window and sends only after valid PENDING and an
  acknowledged claim, avoiding routine loss before API release. A release that never happens records
  the timeout and sends nothing; crash gaps can still lose a code, with no background retry/release
  repairing the gap. Request a new challenge under the settled limits.
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

## Addendum 2026-10-21 — private view on the reception device (spec 060 D-A13, docs PR 57-0)

Waleed answered MY-Q1 on 2026-10-21 (PP-18.1, against the recommended option): an employee's «شغلي» (her work and
earnings) and «حضوري» (her attendance) open on her personal phone **and** on the shared reception device after her PIN.
On that device they would ride the `STAFF_POS` operator session, which lives 8 hours with no idle timeout (Q2 above),
so any colleague at the counter could read her commission. Spec 060 D-A13 therefore adds a short **private-view
window** on top of the session. This ADR has no idle rule, and ADR-0027 lists own reads for the personal purpose only,
so the window is recorded here before any code (57-0); sub-PR 57-1 builds it.

### What does not change

- **The `STAFF_POS` session itself.** It stays 8 hours absolute, with no idle timeout and no renewal (Q2). The
  Alternatives row that rejects a staff idle timeout or sliding renewal still holds for the session. The window is a
  separate, shorter state that gates two screens only. When it lapses, the operator stays signed in and every other
  staff route behaves as before.
- **One operator per device, replacement and sign-out** (§1).
- **«إجازاتي».** The ADR-0026 kiosk and personal leave routes keep `PERSONAL_ROUTE = 'staff'` with no window check
  (spec 060 D-A11).
- **The personal session (ADR-0027).** It needs no window: the phone is the employee's own.

### Decision

1. **Scope.** The window gates exactly the «شغلي» and «حضوري» reads (spec 060 FR-A01…FR-A04: her lines, her
   commission estimate, her tips, her attendance) and their activity touch, and only on the `STAFF_POS` path. No other
   route reads or extends it.
2. **Fresh PIN proof.** Opening either screen asks for the PIN again. The PIN is the cashier PIN of the employee
   linked to the session's user, so the operator proves herself and no one else. A manager's PIN never opens another
   employee's window (Q8). `packages/auth` verifies the PIN against the session's own user and device context. The
   window is granted only against a proof **at most 60 seconds old**, consumed once; a stale or reused proof opens
   nothing. Step-up attempts count against the existing PIN attempt limit in Redis (`CLAUDE.md` §8), and the actual
   actor is recorded, as for PIN sign-in.
3. **The window record is auth-owned and global**, kept in the existing `verification` storage the way ADR-0027
   keeps its 120-second attendance challenge. It holds a `window_id`, the session id, the operator's user id, the
   device id, `opened_at` and `last_activity_at`, and its stored expiry is `opened_at` + 5 minutes. It holds no tenant
   data, no employee data, no column setting and no PIN material. A session has at most one window; opening it again
   replaces it.
   **Openings are serialized per session.** `verification.identifier` has only a non-unique index, so two concurrent
   openings could each find no record and insert two windows. The opening therefore runs in one `pospay_auth`
   transaction that first locks the operator's `session` row (`SELECT … FOR UPDATE`), then deletes every window record
   of that session and inserts the new one before it commits. A second opening waits on the lock, then replaces the
   first: whatever order they arrive in, one record with one `window_id` survives. The session-ending and replacement
   operations of item 6 take the same session-row lock before they delete the window, so neither can interleave with
   an opening. `pospay_auth` already holds `UPDATE` on `session` (migration 0008), so the lock needs no new grant, and
   no unique index or migration is added. Reads, touch, close and cleanup need no lock: with at most one record per
   session, the `window_id` match inside their conditional statement is enough (item 4).
   **Every opening gets a new `window_id`:** 128 random bits from the injected entropy source, never derived from the
   session, the user or the time. The opening response returns it to the POS, and every request inside that window
   carries it in a dedicated request header (57-1's contract names it). Like the session token, it is never logged and
   never put in a URL. On its own it grants nothing: it is checked only together with the live session and Device
   credentials. **No new table and no new grant:** `pospay_auth` already reads and writes `verification` (migration 0008), so
   ADR-0003 needs no new classification.
4. **The server enforces the idle limit, not the tab.** On every gated request on the `STAFF_POS` path, after the
   normal staff-session checks (§1 items 6–7: device, session purpose, deadline, membership), auth runs one atomic
   conditional update with the request's single Clock sample `now` (spec 060 FR-A06):
   - it passes only when the window exists for **this session, this operator and this `window_id`**,
     `now − last_activity_at ≤ 60 s` and `now − opened_at ≤ 5 min`. The `window_id` match is part of the same
     conditional update, never a separate read before it;
   - a passing request sets `last_activity_at = now`, so each request extends the window by 60 seconds from its own
     time, never past 5 minutes from the opening. **Its response returns the remaining times** derived from that same
     Clock sample: `idle_remaining_ms` (60 s) and `cap_remaining_ms` (5 min − (`now` − `opened_at`)). The opening
     response returns the same two values, plus the window's `opened_at` as an ordering value (item 6). The browser
     sets its deadlines only from these server values, never from limits it computes itself;
   - any other request is refused with **403 `PRIVATE_VIEW_EXPIRED`**. When the `window_id` matches but a limit has
     passed, the record is deleted, which closes the window; that delete is conditional on the same `window_id`. A
     request with a missing or different `window_id` changes nothing: it neither extends nor deletes the current
     window.

   **A late request never reaches a newer window.** Take a request sent inside one window that arrives after that
   window has closed and a new one has opened. It carries the old `window_id`, so it is refused with 403: it reads no
   data from the new window and does not extend it. The same rule covers every write to the record. Touch (item 5),
   close and cleanup (item 6) each match the `window_id` inside their own conditional statement, so a late close or
   cleanup for an old window can never delete the new one. Only the end or replacement of the session deletes a window
   whatever its id.

   A killed tab, a lost connection or a bypassed client therefore never keeps the window open.

   **Two refusals, two meanings.** The staff-session checks run first, so a dead operator session (sign-out,
   replacement, the 8-hour deadline, a revoked device) is always 401 `UNAUTHENTICATED`, even when its window is also
   gone. `PRIVATE_VIEW_EXPIRED` (403) is returned only while the operator session is still live and means only that the
   window is missing or lapsed. The POS acts on the code, never on the status alone:
   - `PRIVATE_VIEW_EXPIRED`: close the private screen, clear its query cache, and show the PIN step. The operator stays
     signed in.
   - `UNAUTHENTICATED`: the existing signed-out handling of §1, which clears the operator's caches in every tab.

   Spec 060 D-A13, FR-A06b and MY-13b said 401; this PR changes them to the two codes above and adds
   `PRIVATE_VIEW_EXPIRED` to the spec's error list. 57-1 adds it to `src/shared/errors.ts` with its
   `message_ar`/`message_en`.
5. **Activity touch.** While the screen has input, the POS sends a throttled touch, at most one every 20 seconds,
   through the same route policy and the same check. It returns no private data. Its only effect is to keep the
   server's clock in step with real use.
6. **Closing and clearing.** Leaving the screen sends a best-effort close carrying the `window_id`. Sign-out, operator replacement and the
   session's 8-hour deadline close the window too: the auth operation that ends or replaces the session deletes its
   window, and the check in item 4 also requires the bound session to be the live one, so a stale record never passes.
   The POS clears the screen and the query cache of these reads in every tab, as §1 already requires for a replaced
   operator. The server's idle expiry never depends on the close request arriving.
   **The browser clears on its own clocks too.** The server check of item 4 stays the authority. The browser only
   makes sure the data leaves the screen on time when nobody sends a request. It keeps two kinds of deadline, because
   neither clock alone is enough. A wall clock (`Date.now()`) is shared by the tabs, but it can be moved back by less
   than the time elapsed and then pass every sanity check. A monotonic clock (`performance.now()`) cannot be moved,
   but it belongs to one tab, restarts on reload and may pause while the device sleeps.

   - **Server-derived only.** Every deadline comes from the `idle_remaining_ms` and `cap_remaining_ms` of the last
     passing response (item 4), counted from the moment the tab **sent** that request. The browser therefore always
     expires no later than the server does, and a reload or a new tab never rebuilds a deadline from a stored instant
     alone.
   - **The shared key.** The POS keeps one key in `localStorage` holding the `window_id`, the window's `opened_at`
     and the two wall-clock expiry instants (`Date.now()` at send + each remaining time), and nothing else.
     - It writes an opening response only when that response's `opened_at` is newer than the stored one, or no key
       exists. So an older opening whose response arrives late never overwrites a newer window.
     - The server samples the Clock for `opened_at` after it acquires the session lock (item 3), so a
       later-committed opening never carries an earlier `opened_at`. On an exact tie the stored key wins. If that
       key's window lost on the server, its next request gets 403 and the PIN step: a safe failure.
     - A passing read or touch updates the key only when its `window_id` equals the stored one.
     - **A newer window retires the older ones at once.** When a tab sees a newer `window_id` in the key (a `storage`
       event or its own read), it immediately hides and clears its private screen if that screen belongs to an older
       window. A tab renders a response only if the response's `window_id` still equals the key's current one;
       otherwise it discards the response.
   - **The per-tab monotonic deadlines.** Each tab keeps its own `performance.now()` deadlines in memory, never stored
     or shared. **Only the tab's own passing server response sets or extends them**, from that response's
     `idle_remaining_ms` and `cap_remaining_ms`. A shared-key update written by another tab may only **shorten** them,
     never lengthen them, so every tab is bounded by deadlines the server gave that tab itself.
   - **Two kinds of expiry, two scopes.**
     - When a tab's **own monotonic deadline** passes, that tab hides only its own private screen and clears its own
       query cache. It does not remove the key or tell other tabs, so an idle tab B never closes the window while tab
       A is in use. Before it shows the data again it sends one touch, and it shows the data only if that touch
       passes; the touch's response then sets its new deadlines.
     - When the **shared wall-clock deadline** passes, or the server refuses with 403, the window is closed for all
       tabs, as described next.
   - **Checks.** A tab compares its deadlines on a periodic tick, on `visibilitychange`, `focus` and `pageshow`, and
     before it renders any private data.
   - **A context whose elapsed time cannot be trusted shows nothing private until the server says so.** That covers a
     tab that was hidden and becomes visible again, a page restored from the back-forward cache (`pageshow` with
     `persisted`), a reload, a newly opened tab, and a device waking from sleep. Such a tab first hides the private
     screen, then sends one touch (item 5). It sets its monotonic deadlines from that touch's remaining times, and
     shows the data only if the touch passes the server check; a 403 sends it to the PIN step. So a partial clock
     rollback, combined with a reload or with sleep, still cannot keep data on the screen past the server window.

   **Closing for all tabs, fenced by `window_id`.** The tab that closes the window first clears its own screen and
   cache and shows the PIN step, with no request needed.
   - **The key.** It re-reads the shared key and removes it only if the stored `window_id` equals the one it is
     closing. If a newer window has replaced the key, it leaves the key alone and clears only itself.
   - **The other tabs.** It posts a `BroadcastChannel` message carrying the `window_id` it closes. Each receiving tab
     clears its private screen and cache only when that `window_id` is its current one; a notice about another window
     is ignored.
   - **The fallback** is the `storage` event, and only a removal counts (`newValue` is null). The removed key's
     `oldValue` carries the `window_id`, which the closer checked before removing it. A tab acts on it only when that
     id is its current one. A `storage` event that replaces the key with a newer window is not a close, though it
     still retires every tab showing an older window (above).

   **The cross-tab fence is best-effort, and every race it loses fails safe.** `localStorage` has no atomic
   compare-and-set: two tabs can interleave a read with a write or a removal. Such a race can only close a window
   early, or skip an extension that the key would have recorded. Either way, the PIN is asked again sooner. It can
   never keep data on a screen longer, because every tab is bounded by its own server-derived monotonic deadlines,
   which no other tab can lengthen. The server check of item 4 stays the authority on every request.

   **A changed device clock.** The server check runs on the server's Clock, so a device clock moved forward or back
   cannot keep a window open on the server. In the browser, the monotonic deadlines catch a partial rollback, and an
   untrusted context waits for a fresh server value. A tab also closes early whenever the wall clock looks wrong: a
   `Date.now()` earlier than the stored send instant, or a stored deadline further away than the limits allow
   (60 seconds or 5 minutes). Closing early costs the employee one PIN entry; closing late would show her data.
7. **No private data kept.** Responses carry `Cache-Control: no-store`, and the PWA persists no private data from these
   screens: no IndexedDB, no offline queue (spec 060 S-19, `CLAUDE.md` §7). The ban covers private data, not window
   metadata. The only stored item is item 6's key: the `window_id`, its `opened_at` and the two expiry instants. It holds no personal
   data, is useless without the operator's session and Device credentials, and is removed when the window closes.
   ADR-0027's addendum says the same.
8. **Route policy, for 57-1 (spec 060 FR-A06b).** Today `PERSONAL_ROUTE = true` makes `SessionGuard`
   (`apps/api/src/shared/session.guard.ts`) call `personalSessionRequest` at once, so a `STAFF_POS` request would be
   refused before any window check. FR-A01…FR-A04 therefore use the combined `PERSONAL_ROUTE = 'staff'` policy the
   ADR-0026 leave routes already use:
   - each route carries **both** markers, exactly as the ADR-0026 leave routes do
     (`apps/api/src/modules/staff/http/own-leave.controller.ts`): `@SetMetadata(STAFF_ROUTE, 'staff')` and
     `@SetMetadata(PERSONAL_ROUTE, 'staff')`;
   - without an `Authorization` header, `SessionGuard` takes the personal session (`personalSessionRequest`). With one,
     it skips the personal branch and continues to the `STAFF_ROUTE` check. That check sends the request to its
     `#staff` path (a Device credential plus the `pospay-staff` session, with the device context checked). With
     `PERSONAL_ROUTE` alone, a request with that header would reach no staff policy and would be judged as a bare
     Device or admin request. Neither path ever falls back to an admin session;
   - a per-route private-view marker makes the `STAFF_POS` path call auth's window check after the staff session
     resolves;
   - the personal path and the leave routes never call it.

   This addendum names the `SessionGuard` change and the auth window store; 57-1 builds both, with test MY-13b, its
   killed-tab case included. MY-13b also covers the two codes and the browser timer:
   - an idle or capped window on a live session → 403 `PRIVATE_VIEW_EXPIRED`, the PIN step is shown and the operator
     is still signed in; a replaced or signed-out operator → 401 `UNAUTHENTICATED`;
   - with no request at all, 60 seconds of idle, or 5 minutes from the opening, remove the private screen and empty
     its query cache in every open tab (57-4's UI test asserts the visible screen, `CLAUDE.md` §9);
   - **sleep and wake:** the device sleeps and wakes after a deadline has passed → on `visibilitychange`, `focus` or
     `pageshow` the private screen is gone before any data shows, and the PIN step is visible;
   - **another tab:** the deadline is noticed in one tab → a second open tab receives the `BroadcastChannel` (or
     `storage`) close, removes its private screen and empties its cache;
   - **clock moved back:** `Date.now()` earlier than the stored send instant → the screen closes at once;
   - **partial clock rollback:** the device clock is moved back by less than the time elapsed, so `Date.now()` stays
     after the send instant and inside both limits → the tab's monotonic deadline still closes the screen on time;
     after sleep or a restore, the tab shows nothing private until a fresh touch passes on the server;
   - **fenced cross-tab close:** a `BroadcastChannel` or `storage` close naming window A reaches a tab already showing
     window B → that tab keeps B open; a closing tab that finds window B in the key does not remove it, and if a
     race removes it anyway, window B is not extended and at worst asks for the PIN again;
   - **newer window retires older tabs:** tab A shows window A, and tab B opens window B → tab A hides and clears at
     once, and a late response for window A is never rendered;
   - **reload after a partial rollback:** the clock is moved back, then the tab reloads → it shows nothing until a
     touch passes, and its deadlines come from that touch's `cap_remaining_ms`, never past the server's 5-minute cap;
   - **out-of-order openings:** the response of an older opening arrives after a newer one → the key keeps the newer
     `window_id` and `opened_at`;
   - **idle tab beside an active tab:** tab B is idle past its own monotonic deadline while tab A keeps sending
     requests → B hides only its own screen, and A's window stays open; B shows data again only after its own touch
     passes, and a shared-key update from A never lengthens B's deadlines;
   - **late request:** a request sent in window A arrives after A closed and window B opened → 403
     `PRIVATE_VIEW_EXPIRED`, no data, and B's `last_activity_at` is unchanged;
   - **late close:** a close or cleanup for window A arrives after window B opened → B stays open and its next request
     passes;
   - a route test asserts that each FR-A01…FR-A04 handler carries both `STAFF_ROUTE = 'staff'` and
     `PERSONAL_ROUTE = 'staff'`.

### Not in this addendum

- The four own permission codes and their place in ADR-0027's list of personal-purpose capabilities (spec 060 D-A4,
  D-A5). They are 57-1's own ADR-0027 addendum.
- The column setting (D-A2) and the months-back setting (D-A14). They apply the same way on both paths and are read
  through `StaffColumnsPort` (ADR-0010 addendum 2026-10-21).
