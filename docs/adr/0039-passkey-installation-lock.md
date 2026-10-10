# ADR-0039 — Passkey phones are locked to one person (installation lock)

- **Status:** Accepted — owner (Waleed), 2026-10-10
- **Date:** 2026-10-10
- **Scope:** `staff` attendance clock, clock challenge and passkey enrollment; `packages/db` (`employee_passkeys`,
  new `attendance_device_refusals`); POS personal app. Spec `docs/specs/043-staff-passkey-device-lock/`, phase 1
  plan row 21b.
- **Amends:** [ADR-0029](0029-passkey-unbind-device-signal.md) — the sentence "Do not claim physical-device identity
  or block clocks based on the signal" and the owner decision UNB-Q2 (advisory ten-minute window).

## Context

ADR-0029 made the personal-app installation id an **advisory** signal: a company-separated SHA-256 hash of a random
UUID kept in the POS app's `localStorage`, written once per accepted clock, and a ten-minute "two employees from one
phone" pair rule that never refused anything.

On 2026-10-09 the owner reversed UNB-Q2 after the partner's review: **block**. A phone bound to an employee's personal
passkey must not accept an attendance clock for another employee. On 2026-10-10 he answered the four follow-up
questions (spec 043 `owner-questions.ar.md`, PL-Q1 … PL-Q4), all on the recommended option:

- **PL-Q1** two-way: the phone accepts only its owner, and the owner clocks only from her phone (or the reception card);
- **PL-Q2** a manager moves the lock by unbinding the passkey, exactly as row 21 (UNB-Q1 holders); no self-service;
- **PL-Q3** the refused employee sees a clear message; the attempt is recorded and shown to the manager on the
  attendance board (row 27), with no instant notification;
- **PL-Q4** one phone per person.

A web app cannot prove which physical device it runs on. The candidates were:

| Candidate | Why it was rejected or chosen |
|---|---|
| Device fingerprint (canvas, fonts, UA, screen…) | Personal data collection banned by ADR-0029 and the privacy rules; unstable across browser updates. **Rejected.** |
| The passkey credential itself | Synced passkeys are allowed (spec 024); one credential follows the employee's iCloud/Google account to every device, and an assertion does not say which device made it. WebAuthn attestation is batch-level (AAGUID = model), never a unique device. **Rejected.** |
| Non-extractable WebCrypto key per installation | Proves "same browser storage" exactly like the UUID and is wiped by the same actions. It defends against *copying* an id between phones, which is not the attack (the attack makes one phone look like two). **Deferred**; can be added later behind the same column. |
| The existing installation id (random UUID v4 in app storage, hashed per company) | No new identifier, no personal data, already collected under ADR-0029. **Chosen.** |

## Decision

1. **"The phone" is the personal-app installation.** The raw `installation_id` stays in memory only; the database holds
   the ADR-0029 company-separated hash. No fingerprint, no new personal data, no new secret.
2. **Lock = the hash on the person's active binding.** `employee_passkeys.installation_hash` (nullable, set once,
   never changed or cleared while the row exists; a trigger enforces it). The lock follows the active binding:
   unbinding the passkey (row 21) releases the phone in the same transaction, with no extra write.
3. **The lock is per person, per company.** "Another employee" means another linked user. One person with employee
   records in two businesses of one company keeps one phone for all her records (PL-Q4). Companies never see each
   other's locks (company-separated hash).
4. **Where it is enforced.**
   - **Enrollment** (passkey options and verify): refused `PASSKEY_DEVICE_TAKEN` when the installation belongs to
     another person's active binding, and `PASSKEY_OTHER_DEVICE` when the person already has an active binding locked
     to a different installation. The new binding stores the hash.
   - **Clock challenge**: refused before the Face ID / fingerprint ceremony (`ATTENDANCE_DEVICE_LOCKED` or
     `ATTENDANCE_DEVICE_NOT_ENROLLED`). This check is advisory: `installation_id` is optional on the challenge so an old
     cached POS keeps working.
   - **Clock**: the authoritative check, under the existing lock order (state → membership → employee → binding
     `FOR UPDATE`), then a per-installation transaction advisory lock. It runs inside the idempotent effect (a stored
     accepted response still replays) and before the assertion is consumed and before the five-minute dedupe.
   - A binding with no hash yet (made before this change, or by an old POS) is attached to the first installation that
     clocks successfully, unless that installation belongs to another person or the person is already locked elsewhere.
5. **Refused attempts are recorded outside the refused transaction.** A refusal rolls back the attendance or enrollment
   transaction, so the use case writes one row to the new tenant table `attendance_device_refusals` in a separate
   `withTenant` transaction afterwards: who tried, the holder of the phone (when another person), branch, step,
   reason, the installation hash and the time. No raw id, no phone number, no name. The row is immutable
   (`SELECT`, `INSERT` only). A failure to write it is logged and does not change the refusal the employee sees.
   No event and no notification (PL-Q3).
6. **Retired**: the ten-minute pair rule (`domain/shared-installation.ts`), its query and the
   `sharedInstallationFlag*` contracts. They had no route or screen. Per-clock observations in
   `attendance_device_signals` keep being written (UNB-Q4).
7. Unchanged: the card clock on the paired reception device (spec 032, ADR-0036), the kiosk staff session, the per-clock
   user-verification requirement, the clock idempotency fingerprint (still without `installation_id`).

## Known limits (told to the owner in the questions file)

- Two browsers, two browser profiles, or the iOS home-screen app versus Safari on one phone have separate storage and
  look like **two phones**. Clearing site data or a private window gives a new installation. The lock raises the bar
  (it needs the other employee's WhatsApp code **and** enrolling her passkey from a second browser, which the two-way
  rule then refuses on her own phone); it is not a physical guarantee.
- Safari may delete the storage of a site not used for seven days (ITP). The employee's phone then looks new and she
  is refused until a manager unbinds. Mitigations: the POS asks for `navigator.storage.persist()`, and onboarding
  recommends adding the POS to the home screen and enrolling from the app she will use. Recovery is manager unbind
  (PL-Q2); meanwhile she clocks with the reception card.
- An employee who loses her phone mid-shift cannot clock out from another phone; the reception card or the 16-hour
  missed-out job (spec 029) closes the shift.
- An idempotent replay of an already accepted clock from another installation returns the stored response with no new
  effect. This is accepted: it creates nothing.

## Consequences

- One additive migration pair: `employee_passkeys.installation_hash` + check + partial index + immutability trigger +
  column `UPDATE` grant; the new `attendance_device_refusals` table with `(company_id, id)` primary key, `FORCE` RLS,
  tenant-qualified foreign keys, indexes and a negative isolation test. Old code runs against the expanded schema.
- New error codes: `ATTENDANCE_DEVICE_LOCKED`, `ATTENDANCE_DEVICE_NOT_ENROLLED` (403) and `PASSKEY_DEVICE_TAKEN`,
  `PASSKEY_OTHER_DEVICE` (409), bilingual.
- Row 27 (attendance board) drops the pair list from its scope and shows the refused attempts instead, through the
  read query this slice adds.
- ADR-0029 stays in force for everything else (unbind scope, hashing, observations, log redaction).
