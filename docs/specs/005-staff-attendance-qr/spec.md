# Feature Specification: Branch attendance QR issuer and screen

**Feature Branch**: `feat/p1-19-attendance-qr`
**Created**: 2026-10-02
**Status**: Implementation scope recorded
**Input**: Phase 1 plan row 19; SPEC §7 QR and §4 AttendanceSession; depends on merged PR 3.

## User Scenarios & Testing

### User Story 1 - Display the branch QR (Priority: P1)

Reception opens the paired POS attendance screen. It shows the branch name, a large clock in the
branch timezone and a QR that changes at each 60-second window.

**Independent Test**: Pair and approve a synthetic device, request its QR and advance across a window.

**Acceptance Scenarios**:

1. **Given** an approved device, **When** it requests a QR, **Then** only its server-resolved branch is used.
2. **Given** a displayed QR, **When** its window ends, **Then** it is hidden until a fresh response arrives.
3. **Given** a revoked device or a user session, **When** requesting this device resource, **Then** issuance fails.

### User Story 2 - Verify the short-lived proof (Priority: P1)

The later clocking slice can verify a QR without this slice creating or changing attendance sessions.

**Independent Test**: Verify a synthetic signed token in its current and previous window, and at daily rollover.

**Acceptance Scenarios**:

1. **Given** a correctly signed QR, **When** verified for its tenant and branch in the current or previous window,
   **Then** verification succeeds, including the previous day's final window after daily rotation.
2. **Given** an older, future, malformed, altered or other-branch token, **When** verified, **Then** it fails.
3. **Given** concurrent issuers, **When** a daily secret is first required, **Then** every issuer uses one shared secret.

### User Story 3 - Explain loss of connectivity (Priority: P2)

Reception sees a bilingual offline/unavailable notice and a retry action; an offline device cannot mint QR proofs.

**Independent Test**: Dispatch offline/online events and fail/recover a request without a browser server.

**Acceptance Scenarios**:

1. **Given** a visible QR, **When** connection is lost, **Then** it disappears immediately and the screen explains why.
2. **Given** restored connectivity, **When** refresh succeeds, **Then** only a fresh server token is displayed.

### Edge Cases

- Exact 60-second boundary; two windows old; future and unsafe integer windows; daily rollover.
- Late responses crossing the display window, browser sleep/resume, clock skew, concurrent requests and Redis failures.
- Inactive branch, closed company, another tenant's branch id, revoked device, forged company header.

## Requirements

### Functional Requirements

- **FR-001**: Issue HMAC-protected `{branch_id, window, sig}` proofs; never send a daily secret to the browser or logs.
- **FR-002**: Compute windows using authoritative server time; accept exactly current and previous windows.
- **FR-003**: Isolate daily secrets by company and branch and share them between API instances.
- **FR-004**: Display the paired branch's name and timezone clock, refreshing each window; no cached QR offline.
- **FR-005**: Keep clocking, passkeys, geofence, dedupe and the attendance state machine out of this slice.

### Key Entities

- **Branch QR proof**: branch, window and signature; no employee identity or attendance outcome.
- **Daily branch secret**: server-only shared state, retained long enough to verify the previous window at rollover.
- **AttendanceSession**: remains owned by PR 22; no session row, event or schema is introduced here.

## Slice design

### Business rules

- **BR-001**: `window = floor(server_epoch_ms / 60000)`; the verifier checks branch and accepts only `current` or `current - 1`.
- **BR-002**: Sign using HMAC-SHA256 with the daily secret as key; the canonical payload is domain-separated and includes
  company, branch and window. Compare signatures in constant time. The QR contains only the three SPEC fields.
- **BR-003**: Redis `SET NX PXAT` chooses one random 32-byte daily secret atomically. Verification only reads existing keys.
- **BR-004**: No offline issuance; hide on disconnect, failed refresh or window expiry; restore on successful fresh fetch.
- **TODO(spec)**: SPEC does not name the timezone of *secret rotation*. Proposed technical policy: UTC epoch days,
  independent of the branch display/attendance working date. Keep this explicit for owner confirmation; recommend UTC.
  This implementation uses that provisional policy and preserves the previous day's secret until its last token expires.

### Schema changes

None. Existing RLS-protected tenancy reads supply branch names and effective timezone through the published
`describeWorkspaces` read and a staff-owned port. Existing tenant indexes suffice; no migration or new tenant table.

### API contract

- **Endpoint**: `POST /v1/devices/me/attendance-qr`, 200; exactly one `@Authenticated()` declaration and an explicit
  device-principal check. It issues a cryptographic proof and can initialize Redis state, so this is a command.
- **Request**: no branch/company input; both come from the authenticated device. Company headers do not select the target.
- **Response**: `AttendanceQrIssue` Zod contract: `token`, `branch {id,name_ar,name_en,effective_timezone}`,
  `server_time`, `refresh_at` (next window boundary), `expires_at` (end of previous-window tolerance).
- **Idempotency-Key**: not required; no money/stock effects; concurrent issuance for a window is deterministic.
- **Errors**: existing bilingual envelope: `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `NOT_READY` 503.
- **Verification seam**: staff-local injectable verifier for PR 22; no public verification/clocking endpoint.

### Permissions

Device-only personal resource under the existing Phase 0 Device authentication scheme. No invented permission or
feature flag. User sessions cannot issue this resource even when they manage the branch.

### Events

None published or consumed; issuer does not record an attendance action.

### Test plan

- **Domain unit**: boundaries, day retention, current/previous selection, unsafe inputs, branch mismatch.
- **Integration**: QR-01 authenticated issue; QR-02 wrong principal/revocation/header isolation; QR-03 concurrent Redis
  secret creation, TTL and process sharing; QR-04 HMAC tampering/current/previous/midnight; QR-05 Redis unavailable.
- **RLS negative**: existing tenancy negative suite, plus staff adapter refuses another tenant's branch/inactive branch.
- **Queries**: reuse `describeWorkspaces` with its existing shape/EXPLAIN suite; no new query file.
- **POS**: fake timer refresh, late responses, disconnect/reconnect, stale/failed requests, bilingual screen and QR payload.
- **Gates**: `pnpm check` with FORCE_COLOR unset; builds for API and POS; production bootstrap with optional settings empty.

## Success Criteria

### Measurable Outcomes

- **SC-001**: All current/previous proofs succeed and every out-of-window or altered proof fails in boundary fixtures.
- **SC-002**: Reception never sees an expired display-window QR after the next screen tick (at most one second).
- **SC-003**: Loss of connection removes the QR immediately; English and Arabic notices explain that a connection is required.
- **SC-004**: No attendance record or clocking action is created by issuance or verification.

## Assumptions

- PR 3 paired-device shell and Phase 0 authentication remain the source of device identity.
- Server epoch windows are shared across branches; branch timezone affects the visible clock only.
- `qrcode.react@4.2.0`, already approved in ADR-0016, is added to POS with a slice ADR; no second UI kit.
- Browser display timing uses server response time plus monotonic elapsed time and conservatively accounts for request latency.
