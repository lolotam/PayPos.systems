# Feature Specification: Devices and staff PINs in the back office (MOB, issue #634)

**Feature Branch**: `docs/mob-071-devices-pin`

**Created**: 2026-10-25

**Status**: Draft. Waleed answered the owner questions DV-Q1 … DV-Q7 (decisions page batch 72, PP-63.1 … PP-63.7) on
2026-10-25; Abu Salem has not answered yet ([owner-questions.ar.md](owner-questions.ar.md)). Work follows Waleed's
picks, named under each rule below. Each rule keeps its `TODO(spec)` marker until Abu Salem answers, because his pick
binds if it differs (`CLAUDE.md` §1 5b). DV-Q8 (batch 73, PP-63.8) is a follow-up question; Waleed answered it, and DV-Q9 follows from a review finding on his pick.

**Input**: Issue #634. Today a counter device can only be paired, approved or removed, and a staff PIN can only be set,
through the API by hand. For M-1c the web manager did each step with `curl` and read a device id from the database.
The API routes all exist: `POST /v1/branches/{branchId}/devices/pairing-code`, the pending list
`GET /v1/branches/{branchId}/devices?status=pending` (spec 070), `POST …/devices/{deviceId}/approve` and `/revoke`,
and `POST /v1/staff-pins/reset`. No screen in `apps/admin` calls any of them.

**Scope.** Back-office screens over the existing routes, plus the API changes listed under each sub-PR. Some of
those changes are needed whatever the owners answer: a new code invalidates the previous one, there is a check code
for approval, and there is a PIN eligibility read. Others apply only for one answer: DV-Q2 «the code is enough» means
auto-approval on register, DV-Q3 means an `active` filter, and DV-Q5 means a branch-scoped PIN reset. Out of scope:
the staff OTP sign-in (PP-58.1), and the employee's own PIN change, except the safeguard DV-Q8 needs (071-4).

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

- **FR-001** A devices screen for the chosen branch (place: DV-Q1, `TODO(spec)`; Waleed: a «الأجهزة» page in the menu, for the branch chosen at the top). It has a «كود ربط جهاز» button that
  issues a code and shows it large with its 10-minute countdown, and a "new code" action. **Issuing a code cancels
  the branch's previous live code**, so a code the manager replaced, for example because someone saw it, stops
  working at once. This needs a pointer keyed by `(company_id, branch_id)` in the pairing-code store. Issuing a code, replacing the
  pointer, deleting the old key, and checking and consuming at register time each run as **one atomic Redis step** (a
  Lua script), so a replaced code can never be consumed. Register first **claims** the code for a client
  nonce, and only a committed registration consumes it, so a database retry with the same nonce succeeds while any
  other claimant is refused. The code's stored value also keeps the **issuing user's id**, which is the actor of an
  automatic approval (071-1). The open protocol details (replacement during an in-flight registration, nonce
  strength, commit-unknown retries, the issuer recheck, concurrent check-code clashes) are settled in the 071-1
  sub-spec: https://github.com/lolotam/PayPos.systems/issues/679.
- **FR-002** The same screen lists the branch's pending devices, with «موافقة» and «رفض»; refuse uses revoke. Each row
  shows the device's name, its time, and a **check code**: four symbols of the pairing-code alphabet (no look-alike characters), taken from a hash of the
  whole device id (the id is UUID v7, so its time-ordered prefix must never be used). The server keeps it unique among
  the branch's current pending devices: on a clash it rehashes with a counter until the code is free. The
  counter app's waiting screen shows the same check code. The manager approves only when the two match, because a
  label can be typed by anyone holding the code.
  - While a code is live, the list refreshes every 5 seconds, and it has a «تحديث» button, so a device that registers
    after the page opened appears without a reload.
  - The list follows `next_cursor` with a «عرض المزيد» action, so no pending device is ever hidden past the first page.
  - Whether approval stays a separate step is DV-Q2, `TODO(spec)`; Waleed: approval stays a separate step. If the owners pick «the code is enough», the API
    must approve on register a device that used a live code, in the same transaction, writing the same approval audit
    row as a manual approval, with the code's issuer as the actor and the source `pairing_code` (`CLAUDE.md` §8). The check code then has no admin row to
    sit on, so it is shown on the device only.
- **FR-003** Active devices with «إزالة» (DV-Q3, `TODO(spec)`; Waleed: yes). It needs `status=active` on the spec 070 route, with
  the same cursor paging and «عرض المزيد».
- **FR-004** Who sees the screen and its actions: DV-Q4, `TODO(spec)`. Waleed: as today, `manage:devices:branch`.
- **FR-005** On the employees list, a «تعيين رقم سري» action.
  - The rules for who may use it (DV-Q5), how the PIN is chosen (DV-Q6) and what an employee without an app account
    sees (DV-Q7) are all `TODO(spec)`. Waleed: the owner and the branch manager for her branch's staff (DV-Q5,
    option 2, with FR-006); the setter types the PIN (DV-Q6); the action shows disabled with the line «الموظفة لازم
    تدخل التطبيق برقمها الأول» (DV-Q7).
  - **The setter knows the PIN** (DV-Q6). ADR-0019 §1 says a manager may reset an employee's PIN but must never sign
    in as her, and every action records the actual actor. A PIN the setter typed is a reusable credential the setter
    knows, so the setter, owner or branch manager, could sign in as the employee afterwards. The fix is DV-Q8,
    `TODO(spec)`. Waleed picked a one-time PIN, which the employee replaces with her own, and that pick stands until
    he or Abu Salem decides otherwise. Review then found that a one-time PIN alone does not meet ADR-0019: the setter
    knows it, can redeem it first and choose the permanent PIN, and the server cannot tell which person changed it,
    because both hold the same credential. The only employee-held proof today is a WhatsApp code to her phone; a passkey
    is enrolled only inside a personal session that itself follows a WhatsApp code (ADR-0027), and backs attendance,
    not sign-in. The code locks out a STOP-suppressed employee, whose own PIN is ADR-0019's recovery path, and staff OTP
    is postponed (PP-58.1). Whether to accept that risk is a roles question for both owners, DV-Q9 (batch 75, PP-63.9), `TODO(spec)`.
    Waleed picked option 1: accept it with a short validity for the one-time PIN, an owner notice on every PIN change and
    the setter named in the audit, recorded in the ADR-0019 addendum of 2026-10-25 (c). The other option, which Abu
    Salem may still pick, gates every change on a fresh WhatsApp code and reopens ADR-0019's STOP recovery. Under both,
    an employee needs her first WhatsApp sign-in before any PIN works (DV-Q7). Design advice for the safeguards is issue
    #682.

    071-3 and 071-4 are planned on Waleed's DV-Q9 pick until Abu Salem answers. 071-4 merges before 071-3, or in the
    same PR, so no build ever exposes the PIN action without the one-time PIN.
  - The list needs a guarded read, the **PIN eligibility read** (071-3). For each employee it returns the linked
    `user_id` (or none) and one boolean: whether a PIN would let that person sign in on the chosen branch's devices. That is `staffEligible`
    (`apps/api/src/modules/identity/domain/staff-eligibility.ts`: a membership covering that branch and the effective
    `login:staff:branch` grant with no covering DENY) **and**, as a separate check, an approved phone binding, the two
    checks `SignInStaffPin` makes. The server computes it; the phone number never reaches the back office. Its route, contract and guard are written
    in the 071-3 sub-spec. The guard is the same permission as the PIN reset (DV-Q5), checked at the chosen branch. Its design reads
    the auth-owned phone binding, so it needs design advice and, if it adds an auth facade method, an ADR-0003 note.
    `TODO(spec)`.
  - The PIN is never shown again after it is set, and is never stored or logged in the browser.
- **FR-006** `TODO(spec)` (DV-Q5; Waleed: option 2). If DV-Q5 lets branch managers set PINs, the reset route takes the branch, and the reset use case refuses
  unless **every active branch of the target** is a branch the caller manages. The PIN is company-wide, so a manager of
  one branch must not set the PIN of an employee who also works in a branch she does not manage; the owner sets those.
  A target with any `COMPANY`- or `BUSINESS`-scoped membership is always the owner's to set. Her coverage is never
  read as an empty set of branches. Before 071-3 starts, its sub-spec must make all of these hold, each with a test:
  - a target with no active branch is refused;
  - the eligibility read returns a second server-computed boolean, `can_set_by_caller`, so the button shows the
    owner-only state instead of failing on submit;
  - a PIN set by a branch manager is cleared, in the **same transaction** as the change that causes it, when the target
    gains a branch the setter does not manage **or** the setter loses her authority over the target (role, scope,
    grant or DENY);
  - the PIN sign-in fails closed while that clearing is pending.
  If those cannot be met, 071-3 stops (`TODO(spec)`) and a follow-up owner question is published, with owner-only
  as the recommended option; the owners' DV-Q5 answer is never overridden (`CLAUDE.md` §1 5b).
- **FR-007** All strings come from `packages/i18n`, the screens are RTL, and every UI test asserts what the user sees
  (`CLAUDE.md` §7, §9).

## Sub-PRs (draft)

1. **071-1** The devices screen: issue code, with the previous code cancelled; the pending list with polling, refresh
   and paging; approve and refuse; and the check code on the admin row and on the counter app's waiting screen
   (`apps/pos`). API: the per-branch code pointer, and the check code in the pending list and the register response.
   Plus, only for DV-Q2 «the code is enough», auto-approval on register.
2. **071-2** Active devices and remove. Only if DV-Q3 says yes; adds `status=active` to the spec 070 route.
3. **071-3** The staff PIN action and the PIN eligibility read. It depends on 071-4, which merges first or with it. If DV-Q5 picks branch managers, it also adds the
   branch-scoped reset of FR-006.
4. **071-4** The employee-side PIN safeguard: the one-time PIN of Waleed's DV-Q8 pick, with DV-Q9's protection (a short validity, an owner notice on every PIN change, the setter named in the audit), and its exact values from the design advice in issue #682. Its sub-spec states the PIN
   states and transitions, and the rules of the ADR-0019 addendum 2026-10-25 (c). FR-006's clearing applies to the one-time PIN and to
   any permanent PIN chosen by redeeming it, since its setter may have chosen it. 071-3 never ships to staff without it.

## Acceptance and tests (each sub-PR's own spec states its exact routes, schemas, guards and errors)

- **071-1:**
  - a replaced code is refused at register, including in a race test against the atomic step;
  - a pointer of company A never affects company B;
  - the check code matches between the admin row and the device, and two devices registered in the same millisecond
    get different codes, and a forced hash clash among pending devices is resolved by the rehash;
  - a device that registers after the screen opened appears within one refresh;
  - pending devices past the first page are reachable;
  - DV-Q2 «the code is enough»: an auto-approved device has its approval audit row.
- **071-2:** active devices page through, and «إزالة» revokes and audits.
- **071-3:**
  - the eligibility read refuses a caller without the guard permission and returns no phone;
  - an employee without a phone binding shows as not ready;
  - with DV-Q5 option 2, a branch manager is refused for a target outside her branches, or with a `COMPANY` or
    `BUSINESS` membership;
  - the PIN typed by the setter never appears in the DOM after it is set. If DV-Q6 picks the generated PIN, it is
    shown once in the success view, cleared when the view closes, and never stored or logged by the browser.
- **Every UI test** asserts what the user sees (`CLAUDE.md` §9).
