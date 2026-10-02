# Staff sign-in on a paired POS device

Date: 2026-10-02. Branch: feat/p1-06-staff-otp. Authority: ADR-0019, accepted.

## User Scenarios & Testing

An existing approved user enters their canonical international phone and explicitly chooses Arabic or English on an active paired branch device. Every admitted request gives identical guidance: enter a code if one arrives, otherwise ask the manager for help using the employee's own PIN. A successful proof starts an eight-hour shift session restricted to that device. Sign-in does not open a cashier shift or record attendance.

Unknown users, nonmembers, denied users and suppressed recipients receive identical acknowledgments. Revoked devices cannot request or verify. A replacement operator becomes active only after durable new-session creation; all tabs clear personal caches. Offline sign-in and private staff access are refused.

## Functional Requirements

ADR-0019 §§1–6 is the normative requirement set, including both owner-decision dates. No self-signup, manager global-phone overwrite, manager-PIN impersonation, personal-phone enrollment or local authentication is permitted. OTP defaults disabled; partial configuration closes OTP while services remain ready.

Requests use five-minute validity, a sixty-second cooldown, five requests per phone and twenty per IP per rolling hour. Verification allows five failures per challenge, twenty-five per phone and one hundred per IP per rolling hour. STOP blocks OTP. A newly accepted challenge supersedes earlier active challenges across devices.

## Key Entities

Approved global user phone binding; immutable device scope; staff-purpose session; OTP challenge with keyed verification MAC only; hash-only delivery ledger with PREPARED release and irreversible execution fence.

## Success Criteria

All admitted request outcomes have the same acknowledgment and common 200 ms response window. One challenge permits at most one provider submission and one session. Sessions end exactly eight hours after authentication. Reserved delivery reaches provider submission within five seconds under the tested pilot load. Disabled production services start and answer ready successfully.

## Assumptions

Existing platform identity may retain its canonical bound phone and Better Auth session credential as already classified by ADR-0003; new OTP records, transport and diagnostics never retain either. Existing device pairing remains the source of scope. Live template approval is an activation gate, not permission to invent approved copy.

## Slice design

Schema: auth_otp_challenges and auth_notification_attempts are global identity without tenant RLS, migration-owned and accessible only as pospay_auth through auth. Exact column grants, immutable context/deadlines, monotonic state checks/triggers and creating-migration indexes follow ADR-0019 §3. Session purpose/context/deadline and approved-phone metadata are server-only. Auth receives suppression boolean EXECUTE only; all tenant/dispatcher grants stay unchanged.

API: contracts define POST /v1/devices/me/staff-otp/request and /verify; @Authenticated plus device-only/origin enforcement. Request has generic 503/429 before lookup, identical 202 afterwards; verification has generic OTP_INVALID. Scoped session probe/logout require both credentials. No financial effect or idempotency key; no global OTP outbox event.

Composition: API injects id-only OtpSender, existing platform phone identity and lock strategy, Redis admission, scope reader and clock/ids. Worker receives narrow execution facade and owns the OTP-only transient template/channel adapter; concurrency four, recipient reservation 1000 ms. PREPARED waits release DB connections before timers and never restart the immutable deadline.

PIN recovery: before PR 8, cashier_pins names exactly one holder: existing user_id or legacy employee_id. The user credential uses the same auth-only PBKDF2 implementation and Redis five-failure/fifteen-minute policy. The device supplies scope, approved canonical phone supplies user identity, and effective login permission is rechecked before and after issuing the same STAFF_POS session. A manager with manage:memberships:company resets only an active member in the selected company; reset and employee sign-in audit their separate actual actors. Reset changes the credential row id, so comparisons against an earlier revision cannot issue a session. No global phone, employee, membership or admin session is created by recovery.

Tests: every obligation in ADR-0019 §7 applies, grouped as identity/scope, privacy/availability, crypto/challenge, sessions/guards, roles/schema, STOP races, Redis/transport/crash windows, worker/templates/capability/load, and POS browser flows. Use restricted PostgreSQL roles and real Redis; synthetic values only. Existing negative RLS suites cover preserved tenant schema; new tenant changes require their own negatives. Run all requested generators/gates/builds and bounded built-app production smoke.

## Remaining approvals

- TODO(spec): owner/Meta-approved ar/en AUTHENTICATION copy, component order and template names; block live activation until supplied.
- TODO(spec): final bilingual request/recovery copy is a draft until owner approval.
- Personal-phone/passkey enrollment must be designed before PR 20; paired POS login is not an attendance assertion.
