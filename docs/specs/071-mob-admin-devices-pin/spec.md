# Feature Specification: Devices and staff PINs in the back office (MOB, issue #634)

**Feature Branch**: `docs/mob-071-devices-pin`

**Created**: 2026-10-25

**Status**: Draft. The owner questions DP-Q1 … DP-Q7 are `PENDING` ([owner-questions.ar.md](owner-questions.ar.md));
every rule that depends on one is marked `TODO(spec)` until it is answered.

**Input**: Issue #634. Today a counter device can only be paired, approved or removed, and a staff PIN can only be set,
through the API by hand. For M-1c the web manager did each step with `curl` and read a device id from the database.
The API routes all exist: `POST /v1/branches/{branchId}/devices/pairing-code`, the pending list
`GET /v1/branches/{branchId}/devices?status=pending` (spec 070), `POST …/devices/{deviceId}/approve` and `/revoke`,
and `POST /v1/staff-pins/reset`. No screen in `apps/admin` calls any of them.

**Scope.** Back-office screens over the existing routes. Plus, only if DP-Q3 or DP-Q5 is answered that way, one small
API change each (an `active` filter on the device list, or a branch-scoped PIN reset). Out of scope: the counter app's
own pairing screen (unchanged), the staff OTP sign-in (PP-58.1), and the employee's own PIN change.

## Facts that shape the questions

- **Pairing code:** 8 characters, valid for 10 minutes, used once. A device that registers with it waits as `PENDING`
  until someone approves it.
- **Who may do device actions today:** `manage:devices:branch`, held by owner, general manager, business manager and
  branch manager (migration 0058).
- **Who may set a staff PIN today:** `manage:memberships:company`, held by the owner only. The manager types the four
  digits (`POST /v1/staff-pins/reset { user_id, pin }`). The target must be a member of the company.
- **What a PIN sign-in needs:** the staff user must also have an approved phone binding. Today only the WhatsApp
  sign-in (postponed, PP-58.1) or the staging-only script (PP-58.3) creates one. So an employee who never signed in to
  the app has no account to give a PIN to.

## Requirements (draft)

- **FR-001** A devices screen for the chosen branch (place: DP-Q1, `TODO(spec)`). It has a «كود ربط جهاز» button that
  issues a code and shows it large with its 10-minute countdown, and a "new code" action.
- **FR-002** The same screen lists the branch's pending devices (name and time) with «موافقة» and «رفض». Refuse uses
  revoke. Whether approval stays a separate step is DP-Q2, `TODO(spec)`.
- **FR-003** Active devices with «إزالة» (DP-Q3, `TODO(spec)`; needs `status=active` on the spec 070 route).
- **FR-004** Who sees the screen and its actions: DP-Q4, `TODO(spec)`. Today: `manage:devices:branch`.
- **FR-005** On the employees list, a «تعيين رقم سري» action. The rules for who (DP-Q5), how the PIN is chosen
  (DP-Q6) and what an employee without an app account sees (DP-Q7) are all `TODO(spec)`. The PIN is never shown
  again after it is set, and is never stored or logged in the browser.
- **FR-006** All strings come from `packages/i18n`, the screens are RTL, and every UI test asserts what the user sees
  (`CLAUDE.md` §7, §9).

## Sub-PRs (draft)

1. **071-1** The devices screen: issue code, pending list, approve and refuse. No API change.
2. **071-2** Active devices and remove. Only if DP-Q3 says yes; adds `status=active` to the spec 070 route.
3. **071-3** The staff PIN action. If DP-Q5 picks branch managers, the PIN reset route also gets a branch scope.
