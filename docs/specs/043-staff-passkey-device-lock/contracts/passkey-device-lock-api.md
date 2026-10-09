# API contract changes — 043 passkey phone lock

All routes keep their guards (`@Authenticated()` + PERSONAL purpose for the employee routes; manager read under
`read:passkeys:branch`). Errors use the envelope `{ code, message_ar, message_en, details? }`.

## `POST /v1/staff/attendance/challenge`

- Body `ClockChallengeInput`: `token`, `location?`, **`installation_id?`** (UUID v4, new, optional — an old cached POS
  omits it and is checked at the clock).
- Not part of the challenge `scan_digest`.
- New refusals (before any WebAuthn options are issued):
  - `403 ATTENDANCE_DEVICE_LOCKED` — the installation belongs to another person's active binding.
  - `403 ATTENDANCE_DEVICE_NOT_ENROLLED` — the person's lock is a different installation.

## `POST /v1/staff/attendance/clock`

- Body unchanged: `installation_id` stays **required**; `Idempotency-Key` stays required; `installation_id` stays out
  of the idempotency fingerprint (a stored accepted response replays from any installation).
- Same two refusals, authoritative (checked under the binding lock + installation advisory lock, before the assertion
  is consumed and before the five-minute dedupe). A refusal rolls back everything, including the idempotency claim.

## `POST /v1/staff/passkey/options`

- Body (new, optional) `PasskeyOptionsInput`: `{ installation_id? }`. Missing body = `{}`.
- New refusals (before any registration ceremony): `409 PASSKEY_DEVICE_TAKEN`, `409 PASSKEY_OTHER_DEVICE`.

## `POST /v1/staff/passkey/verify`

- Body `PasskeyVerifyInput`: `challenge_id`, `response`, **`installation_id?`** (new, optional).
- Same two refusals, authoritative under the employee lock + installation advisory lock. A credential registered
  before the refusal stays inert (spec 024 KEY-05).

## `GET /v1/businesses/{businessId}/employees/{employeeId}/passkeys`

- Status gains `phone_locked: boolean` and `phone_locked_since: string (timestamptz) | null`. Never the hash.

## Removed (no route used them)

- Schemas `SharedInstallationFlag`, `SharedInstallationFlagPage`.

## New schema (query only, route in row 27)

- `AttendanceDeviceRefusal`: `id`, `employee_id`, `holder_employee_id | null`, `branch_id`,
  `step: CHALLENGE | CLOCK | ENROL`, `reason: DEVICE_LOCKED | NOT_ENROLLED | DEVICE_TAKEN | OTHER_DEVICE`,
  `attempted_at`. `AttendanceDeviceRefusalPage`: `items`, `next_cursor | null`.

## Error messages (DL-15)

| Code | ar | en |
|---|---|---|
| `ATTENDANCE_DEVICE_LOCKED`, `PASSKEY_DEVICE_TAKEN` | التليفون ده متسجل لموظفة تانية. ابصمي من تليفونك أو بالكارت في الريسبشن. | This phone is registered to another employee. Clock in from your own phone or with the card at reception. |
| `ATTENDANCE_DEVICE_NOT_ENROLLED`, `PASSKEY_OTHER_DEVICE` | بصمتك متسجلة على تليفون تاني. ابصمي من تليفونك أو بالكارت في الريسبشن، ولو غيّرتي تليفونك اطلبي من المدير يفك الربط. | Your passkey is registered on another phone. Clock in from that phone or with the card at reception. If you changed phones, ask your manager to unbind it. |
