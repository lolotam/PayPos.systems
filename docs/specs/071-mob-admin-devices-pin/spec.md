# Feature Specification: Devices and staff PINs in the back office (MOB, issue #634)

**Feature Branch**: `docs/mob-071-devices-pin`

**Created**: 2026-10-25

**Status**: Draft. The owner questions DV-Q1 … DV-Q7 (decisions page batch 72, PP-63.1 … PP-63.7) are `PENDING` ([owner-questions.ar.md](owner-questions.ar.md));
every rule that depends on one is marked `TODO(spec)` until it is answered.

**Input**: Issue #634. Today a counter device can only be paired, approved or removed, and a staff PIN can only be set,
through the API by hand. For M-1c the web manager did each step with `curl` and read a device id from the database.
The API routes all exist: `POST /v1/branches/{branchId}/devices/pairing-code`, the pending list
`GET /v1/branches/{branchId}/devices?status=pending` (spec 070), `POST …/devices/{deviceId}/approve` and `/revoke`,
and `POST /v1/staff-pins/reset`. No screen in `apps/admin` calls any of them.

**Scope.** Back-office screens over the existing routes, plus the API changes listed under each sub-PR. Some of
those changes are needed whatever the owners answer: a new code invalidates the previous one, there is a check code
for approval, and there is a PIN eligibility read. Others apply only for one answer: DV-Q2 «the code is enough» means
auto-approval on register, DV-Q3 means an `active` filter, and DV-Q5 means a branch-scoped PIN reset. Out of scope:
the staff OTP sign-in (PP-58.1) and the employee's own PIN change.

## Facts that shape the questions

- **Pairing code:** 8 characters, valid for 10 minutes, used once. A device that registers with it waits as `PENDING`
  until someone approves it. Today, issuing a new code does **not** cancel the branch's previous one
  (`redis-pairing-codes.ts` only adds keys).
- **Registration is public.** Anyone holding a live code can call `POST /v1/devices/register` with any label, so the
  label alone does not prove which device is which.
- **Who may do device actions today:** `manage:devices:branch`, held by owner, general manager, business manager and
  branch manager (migration 0058).
- **Who may set a staff PIN today:** `manage:memberships:company`, held by the owner only. The manager types the four
  digits (`POST /v1/staff-pins/reset { user_id, pin }`). The target must be a member of the company. The PIN is one
  per company, with no branch, so it works on every branch's devices.
- **What a PIN sign-in needs:** the staff user must also have an approved phone binding. Today only the WhatsApp
  sign-in (postponed, PP-58.1) or the staging-only script (PP-58.3) creates one. So an employee who never signed in to
  the app has no account to give a PIN to. The back office cannot see that state today.

## Requirements (draft)

- **FR-001** A devices screen for the chosen branch (place: DV-Q1, `TODO(spec)`). It has a «كود ربط جهاز» button that
  issues a code and shows it large with its 10-minute countdown, and a "new code" action. **Issuing a code cancels
  the branch's previous live code**, so a code the manager replaced, for example because someone saw it, stops
  working at once. This needs a per-branch pointer in the pairing-code store (071-1).
- **FR-002** The same screen lists the branch's pending devices, with «موافقة» and «رفض»; refuse uses revoke. Each row
  shows the device's name, its time, and a **check code**: four characters the server derives from the device id. The
  counter app's waiting screen shows the same check code. The manager approves only when the two match, because a
  label can be typed by anyone holding the code.
  - While a code is live, the list refreshes every 5 seconds, and it has a «تحديث» button, so a device that registers
    after the page opened appears without a reload.
  - The list follows `next_cursor` with a «عرض المزيد» action, so no pending device is ever hidden past the first page.
  - Whether approval stays a separate step is DV-Q2, `TODO(spec)`. If the owners pick «the code is enough», the API
    must approve on register a device that used a live code, and the check code is then shown only for the record.
- **FR-003** Active devices with «إزالة» (DV-Q3, `TODO(spec)`). It needs `status=active` on the spec 070 route, with
  the same cursor paging and «عرض المزيد».
- **FR-004** Who sees the screen and its actions: DV-Q4, `TODO(spec)`. Today: `manage:devices:branch`.
- **FR-005** On the employees list, a «تعيين رقم سري» action.
  - The rules for who may use it (DV-Q5), how the PIN is chosen (DV-Q6) and what an employee without an app account
    sees (DV-Q7) are all `TODO(spec)`.
  - The list needs a guarded read, the **PIN eligibility read** (071-3). For each employee it returns the linked
    `user_id` (or none) and one boolean: whether a PIN would let that person sign in (an active membership plus an
    approved phone binding). The server computes it; the phone number never reaches the back office. Its design reads
    the auth-owned phone binding, so it needs design advice and, if it adds an auth facade method, an ADR-0003 note.
    `TODO(spec)`.
  - The PIN is never shown again after it is set, and is never stored or logged in the browser.
- **FR-006** If DV-Q5 lets branch managers set PINs, the reset route takes the branch, and the reset use case refuses
  unless **every active branch of the target** is a branch the caller manages. The PIN is company-wide, so a manager of
  one branch must not set the PIN of an employee who also works in a branch she does not manage; the owner sets those.
- **FR-007** All strings come from `packages/i18n`, the screens are RTL, and every UI test asserts what the user sees
  (`CLAUDE.md` §7, §9).

## Sub-PRs (draft)

1. **071-1** The devices screen: issue code, with the previous code cancelled; the pending list with polling, refresh
   and paging; approve and refuse; and the check code on the admin row and on the counter app's waiting screen
   (`apps/pos`). API: the per-branch code pointer, and the check code in the pending list and the register response.
   Plus, only for DV-Q2 «the code is enough», auto-approval on register.
2. **071-2** Active devices and remove. Only if DV-Q3 says yes; adds `status=active` to the spec 070 route.
3. **071-3** The staff PIN action and the PIN eligibility read. If DV-Q5 picks branch managers, it also adds the
   branch-scoped reset of FR-006.
