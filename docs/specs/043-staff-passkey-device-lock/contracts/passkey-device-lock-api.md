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
| `ATTENDANCE_DEVICE_LOCKED` | هذا الهاتف مسجّل لموظف آخر. سجّل الحضور من هاتفك أو بالبطاقة عند الاستقبال. | This phone is registered to another employee. Clock in from your own phone or with the card at reception. |
| `ATTENDANCE_DEVICE_NOT_ENROLLED` | مفتاح المرور الخاص بك مسجّل على هاتف آخر. سجّل الحضور من ذلك الهاتف أو بالبطاقة عند الاستقبال، وإذا غيّرت هاتفك فاطلب من المدير فك الربط. | Your passkey is registered on another phone. Clock in from that phone or with the card at reception. If you changed phones, ask your manager to unbind it. |
| `PASSKEY_DEVICE_TAKEN` | هذا الهاتف مسجّل لموظف آخر، فلا يمكن تسجيل مفتاح مرورك عليه. سجّل من هاتفك، واستخدم البطاقة عند الاستقبال حتى ذلك الحين. | This phone is registered to another employee, so your passkey cannot be enrolled on it. Enrol from your own phone; until then, use the card at reception. |
| `PASSKEY_OTHER_DEVICE` | لديك مفتاح مرور مسجّل على هاتف آخر. سجّل من ذلك الهاتف، أو اطلب من المدير فك الربط إذا غيّرت هاتفك. | You already have a passkey on another phone. Enrol from that phone, or ask your manager to unbind it if you changed phones. |
