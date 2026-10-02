# ADR-0019 — Attendance QR issuer and POS rendering

- **Status:** Accepted technical choices; rotation timezone pending owner confirmation
- **Date:** 2026-10-02
- **Slice:** Phase 1 PR 19; `docs/specs/005-staff-attendance-qr/spec.md`

## Context

SPEC §7 requires a daily-secret branch HMAC, 60-second windows and current/previous acceptance.
PR 19 issues proofs on the paired POS device; PR 22 owns clocking and AttendanceSession persistence.

## Decision

- Use the existing device authentication scheme, `@Authenticated()` and a device-only principal check on
  `POST /v1/devices/me/attendance-qr`. The tenant/branch come exclusively from the verified principal.
- Keep window/time rules pure in staff domain, orchestration in use-cases, and Redis/HMAC in persistence adapters.
- Redis keys include tenant, branch and UTC epoch day. Atomically initialize with `SET NX PXAT`; 32-byte random keys;
  expire at the next day plus one 60-second window. Verifiers never recreate missing keys and use constant-time HMAC comparison.
- Canonical HMAC-SHA256 message: JSON array of protocol label `pospay.attendance-qr.v1`, company, branch and window.
  Daily secret is the HMAC key; the QR transports only `{branch_id, window, sig}` (lowercase hexadecimal signature).
- UTC rotation days are provisional `TODO(spec)`: SPEC does not settle rotation timezone. Recommend UTC because this
  is cryptographic key lifecycle, independent of the employee's branch-local working date; retain rollover tolerance.
- Staff defines an attendance-branch read port; its adapter calls tenancy's existing published `describeWorkspaces`
  for exactly one branch inside `withTenant`. Declare `staff -> tenancy.describeWorkspaces` in the module map.
- Add **`qrcode.react@4.2.0`** to `@pospay/pos`, reusing the exact encoder/version already approved by ADR-0016.
  It draws SVG locally without sending proofs to an external service. No new UI component library.
- Hide QR on offline events, expiry or refresh failure. Server response timestamps and monotonic browser time drive refresh;
  refetch on resume/reconnect. No local signing, persisted token, service-worker API cache or attendance writes.

## Consequences

Multiple API processes issue identical proofs per branch/window. At midnight the previous-window token uses the
previous day's retained key. Redis loss fails closed. Existing tenancy query shape/EXPLAIN tests and RLS remain applicable;
no migration is needed. The module arrow is already permitted, and its new value import is explicitly declared.
The verifier is injectable inside staff for PR 22, with no clocking or public verification endpoint in PR 19.
