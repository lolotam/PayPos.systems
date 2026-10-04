# Feature Specification: Staff personal sign-in and passkey enrollment

**Feature Branch**: `feat/p1-20-enrol-passkey`
**Created**: 2026-10-04
**Status**: Implemented; personal-session lifetime accepted
**Sources**: Phase 1 SPEC §7 and PR 6 amendment; ADR-0013 §§6–9;
ADR-0019 §§1–7; ADR-0003; owner decision 2026-10-04; ADR-0027.

## User Scenarios & Testing

### User Story 1 — Sign in on my own phone (Priority: P1)

An existing employee chooses the employer workspace and signs in with the approved
global phone and WhatsApp OTP. This gives access only to personal staff capabilities.

**Independent Test**: Sign in without pairing; verify that business and administration
operations remain refused and that removing membership immediately removes access.

**Acceptance Scenarios**:

1. **PER-01**: An active linked employee with a covering active membership receives a
   restricted personal session after single-use OTP verification.
2. **PER-02**: Unknown, unlinked, deleted, nonmember and suppressed recipients receive
   the same admitted acknowledgement and no usable authorization.
3. **PER-03**: A personal credential cannot authorize kiosk, generic auth, admin,
   platform or permission-protected business operations, even by cookie substitution.
4. **PER-04**: Logout/replacement clears personal forms and query caches across tabs.

### User Story 2 — Bind my authenticator (Priority: P1)

An employee with no active binding enrolls a passkey using their phone unlock.
An existing binding requires manager unbind before replacement.

**Independent Test**: Enroll, read status, then attempt concurrent/repeated replacement.

**Acceptance Scenarios**:

1. **KEY-01**: Successful verified registration creates one active binding, audit and
   `EmployeePasskeyBound` in the same tenant transaction.
2. **KEY-02**: Two concurrent first enrollments produce one binding. The other global
   credential remains inert; it grants neither login nor attendance.
3. **KEY-03**: Missing UV, wrong user/origin/RP, replay/expiry and unknown credentials
   are refused. A staging origin is refused in production.
4. **KEY-04**: Paired-device operator sessions cannot enroll a shared kiosk.
5. **KEY-05**: After a tenant binding rolls back, fresh registration options omit the
   inert orphan from `excludeCredentials`. The same authenticator can create a fresh
   credential; only that new credential becomes bound. Active bindings remain excluded.

### Edge Cases

- A global registration commits but tenant binding fails: keep an inert credential,
  omit it from retry exclusions, and require fresh registration and explicit binding.
- Employee deletion, user relinking or membership expiry between options and verify.
- Synced passkeys and zero signature counters remain supported.
- Challenge consumed before crash: require a new challenge; never replay an assertion.
- Concurrent manager unbind: PR 22 must lock/recheck binding id/revision in its transaction.
- Offline, browser cancellation and unavailable authenticators never queue ceremonies.

## Requirements

### Functional Requirements

- **FR-001**: Personal sessions are separate from kiosk and admin sessions, with their
  own host-only HttpOnly/Secure/SameSite=Lax cookie and exact POS origin enforcement.
- **FR-002**: Recheck active employee/user link and covering membership on every request;
  personal sessions contain no business or platform grants.
- **FR-003**: Reuse ADR-0019 OTP derivation, MACs, STOP checks, delivery gates, uniform
  acknowledgement, five-minute expiry, cooldown and shared Redis request/verify caps.
- **FR-004**: Personal OTP never creates a user, employee or membership. Phone lookup
  uses the approved global binding, never employee contact text.
- **FR-005**: Only first enrollment is automatic. Serialize binding creation and refuse
  an active binding; manager unbind remains PR 21.
- **FR-006**: Each later attendance assertion uses a new single-use 120-second
  challenge covering user/company/employee/binding revision/branch/operation/QR context.
- **FR-007**: Arabic/English personal sign-in and enrollment are online only, use the
  generated client, and persist no phone/code/challenge/assertion.
- **FR-008**: Owner decision 2026-10-04 (recommended option): personal sessions have
  a fixed eight-hour absolute lifetime, without sliding renewal or idle timeout, matching
  ADR-0019 kiosk sessions. There is no lifetime environment setting. Existing OTP delivery
  gates keep personal issuance closed while delivery is disabled.

### Key Entities

- Global credential: authenticator public credential owned by authentication.
- Employee binding: tenant history relating an employee to an opaque credential id.
- Personal session: OTP-proven identity restricted to one workspace and own capabilities.
- Operation proof: internal single-operation result, never a reusable login token.

## Slice design

### Business rules

First enrollment only; active employee and active covering membership required.
Enrollment and authentication do not clock attendance or open a cash shift. No money changes.
Global credential failures cannot activate tenant bindings. Synced credentials are permitted.
The staff-owned reader supplies active binding ids across the verified user's membership
companies through the application root; auth maps those ids to its own credential descriptors.
Binding reads remain under tenant RLS. No orphan cleanup is attempted: avoiding cross-pool
deletion races preserves credentials used by another company, and inert records do not block retry.

### Schema changes

| Table | Shape | RLS/grants | Indexes/FKs |
| --- | --- | --- | --- |
| `passkey` | Exact pinned plugin fields, UUID v7 id | Global identity; only auth CRUD | Unique credential id; user FK/index |
| `employee_passkeys` | company/id, business/employee, opaque passkey, revision, bound/unbound actors/times | ENABLE/FORCE RLS; app select/insert/limited update | One active/employee; tenant employee FK; credential FK; actor indexes |
| `session` | Server-only personal context | Existing auth-only table | Existing user lookup index |
| `auth_otp_challenges` | Accept explicit personal workspace context as well as existing device context | Existing auth-only grants unchanged | Existing indexes retained |

### API contract

Contracts in `packages/contracts/src/staff/passkeys.ts` and personal OTP contracts.
Personal request/verify are `@Public()` plus exact origin and ADR-0019 shared rates;
all session/enrollment routes are `@Authenticated()` with explicit personal purpose policy.

| Endpoint | Result |
| --- | --- |
| POST `/v1/staff/personal-otp/request` | Uniform 202 acknowledgement |
| POST `/v1/staff/personal-otp/verify` | 200 personal context + cookie |
| GET `/v1/staff/personal-session` | Current personal context |
| POST `/v1/staff/personal-session/sign-out` | 200 signed out + cleared cookie |
| GET `/v1/staff/my-schedule?branch_id=...&week_start=...` | Own employee schedule only; no employee selector |
| GET `/v1/staff/passkey` | Own binding status, no credential material |
| POST `/v1/staff/passkey/options` | 200 registration options + challenge id |
| POST `/v1/staff/passkey/verify` | 201 binding status |

No money/stock write; no Idempotency-Key required. Enrollment challenge consumption
and partial uniqueness enforce one registration/binding result. Errors use bilingual
envelopes (`OTP_UNAVAILABLE`, `OTP_INVALID`, `PASSKEY_INVALID`, `PASSKEY_ALREADY_BOUND`).

### Permissions

Personal purpose grants enrollment/status/session/logout, later attendance ceremonies,
and explicitly opted-in own-scope routes only. It grants no role/business permission.
Company/business inputs are hints, verified against the linked employee and membership.

### Events

`EmployeePasskeyBound` is written with the binding and safe audit metadata in one
tenant transaction. No credential id/key/challenge/assertion enters events or audit.
No consumer ships in this slice; Phase 1 poll exception applies.

### Test plan

- Domain: first binding rule and active/revision fencing.
- Auth integration: pinned plugin registration hook UV enforcement; RP/origin policy;
  cryptographically valid synthetic WebAuthn registrations/assertions and rejection paths;
  atomic replay/expiry consume and serialized counters; personal session purpose/lifetime.
- API integration: PER-01–04, KEY-01–04, negative scope, enrollment race, rollback/inert key.
- DB: auth-only credential role/grant denials, FORCE RLS binding isolation/FKs/uniqueness.
- Queries: binding result shape and EXPLAIN index usage.
- POS: generated client/cookie isolation, form/cache clearing, offline/cancel/error flow.
- Gates: `pnpm check` (FORCE_COLOR unset), builds for touched apps; production startup
  smoke with optional settings empty. No browser/dev/watch/Docker builds.

## Success Criteria

### Measurable Outcomes

- An employee can enroll exactly one active binding from their own phone.
- Every invalid/replayed/expired ceremony in the acceptance matrix is refused.
- Personal credentials authorize zero business/administration operations.
- Logout/replacement exposes zero prior personal data in any open tab.

## Assumptions

Employer supplies company/business identifiers; they convey no authority. Registration
uses the approved plugin behind auth, attendance uses SimpleWebAuthn with required UV.
Live OTP stays disabled pending existing approved templates and operational gates.
Attendance UI, manager unbind and actual clock mutation remain PRs 21/22.
