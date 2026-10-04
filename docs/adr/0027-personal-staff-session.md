# ADR-0027 — Personal phone staff sessions and enrollment

- Status: Accepted
- Date: 2026-10-04
- Sources: Owner decision 2026-10-04; ADR-0013 §§6–9; ADR-0019 Q4

## Context

ADR-0019 STAFF_POS proves an operator at a paired kiosk. Enrolling its authenticator
would bind a shared device. Employees need a restricted session on their own phones.

## Decision

Use Better Auth issuance with server-only `purpose=STAFF_PERSONAL`, immutable workspace
context, original authenticated time and absolute deadline. `pospay-personal.session_token`
is separate from admin and kiosk cookies: host-only, Path=/v1, HttpOnly, Secure,
SameSite=Lax. Exact configured POS origins are required; production trusts only
`https://pos.pospay.systems`, staging only `https://pos.staging.pospay.systems`, local
only explicit localhost origins. Never infer trust from headers or cookie-sharing domains.

An employer-supplied company/business hint restricts OTP request context. Before OTP
proof identity may read only a boolean eligibility result inside that candidate tenant:
approved global user must link to one active employee in that business and have an
active covering membership. Never use withUser before proof, return employee/account
information or add tenant grants to auth. After verification the same reader supplies
the employee id server-side and rechecks eligibility on every request. Deleted company or employee, relinking, expired membership or changed approved phone refuse access.

Personal purpose allows only enrollment/status/session/logout and explicitly enabled
own-scope capabilities (schedule/leave; later attendance challenge/assertion). It has
no POS/device, role/business/admin/platform grants. Generic Better Auth routes refuse it,
including a copied token under the normal cookie. Device credentials cannot upgrade it.
Kiosk sessions cannot enroll; no session substitutes for a fresh attendance UV assertion.

Reuse the ADR-0019 global ledger and independent derivation/MAC keys with a separately
domain-tagged personal context, shared phone/IP Redis counters, newest challenge wins,
300-second OTP, five failed attempts, 60-second cooldown, 5/20 requests per hour and
25/100 verifications per hour. STOP and disabled-by-default delivery apply unchanged.
Workers receive the same id-only ledger transport, not a second messaging pipeline.

Replacement serializes by verified global user; create and validate the new durable
session before invalidating earlier personal sessions for that user.
Logout/replacement clears personal forms/caches across tabs. Pairing/admin state survives.
No phone, code, challenge, credential material or assertion is persisted in the PWA.

Owner decision 2026-10-04 (recommended option): personal sessions have an eight-hour
absolute lifetime, without sliding renewal or idle timeout, matching the ADR-0019
kiosk deadline. This is a fixed auth policy with no environment setting. Existing OTP
delivery gates keep personal issuance closed while delivery is disabled; ordinary
API/worker readiness is independent of those optional capabilities.

## Enrollment and later attendance

Auth uses the exact ADR-0013 pins and plugin adapter, enforcing verified registration UV
in its hook; plugin generic HTTP routes stay inaccessible. Credentials use the global
auth-only `passkey` table; staff owns tenant binding history, revision, audit and outbox.
Serialize first binding against the employee row and its partial unique active index.
Unbound credentials remain inert after race/failure. Existing binding refuses replacement.
Registration exclusions contain only credentials backing active employee bindings. The root
injects a staff-owned binding reader into auth; identity enumerates only the verified user's
membership companies with `withUser`, then staff reads each company's bindings with `withTenant`.
Auth maps opaque binding ids to credential descriptors on its auth-only adapter. Missing or
failed binding reads refuse options rather than use the plugin's full credential list.
Orphans are retained and omitted from exclusions: retry uses a fresh ceremony and credential,
never implicitly activates an orphan. No best-effort deletion is added because global registration
and tenant binding have separate commits; deletion could race another company's active binding.

Attendance facade stores a fresh 120-second challenge in global verification storage,
with immutable user/company/employee/binding id/revision/branch/operation/QR context.
Atomic consumption and serialized credential counter update precede an internal
one-operation proof. PR 22 locks/rechecks binding and revision, membership, QR and
presence inside the attendance transaction. No generic passkey login is introduced.

## Consequences

Application roots inject auth capabilities into staff-owned ports; staff does not import
auth. Identity owns session routing; staff owns employee eligibility and enrollment through
the exported identity membership reader.
No business cross-module write arrow or auth tenant-table privilege is added.
Unknown or partial configuration closes only personal/OTP capability. Live delivery is
not enabled by this ADR. Manager unbind and clocking remain separate slices.

The separate POS entry is `/personal?company=<company-id>&business=<business-id>`.
Those identifiers are routing hints, never eligibility. A manager supplies the workspace link;
the UI does not ask staff to type identifiers. Missing/invalid hints show a request-link instruction.
Session replacement invalidates earlier personal sessions for the same verified global user, and
client tabs clear private caches on replacement, logout, failed session probes and offline transitions.
