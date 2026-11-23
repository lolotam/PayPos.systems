# 076 — Staff access and member invitation

**Status:** Draft for implementation · **Tier:** Heavy (auth, permissions, migrations) · **Date:** 2026-11-23

**Source:** go-live blocker `docs/plans/2026-11-23-staff-sign-in-gap.md` — no product path creates a user or a
membership for an employee, a manager or an accountant. Owner answers and design decisions:
`owner-questions.ar.md` in this folder (batch 103, SA-Q1…SA-Q7, IM-Q1…IM-Q6, and decisions D1…D11).

**Delivered as five PRs, in this order:** F1 give access · G1 invite a member · F2 temporary PIN and owner notice ·
F3 change phone, stop access, follow the branch · G2 end a membership. Plan: `plan.md`.

## 1. Users and words

- **Granter:** the owner, or a branch manager acting on an employee whose primary branch is her own branch (SA-Q1).
- **Staff access:** a user account an employee uses on a paired branch device with her phone number and a PIN.
- **Member:** a manager or an accountant who signs in to the back office with an email and a password.
- **Staff user:** a user created by «give access». It has a synthetic, non-deliverable email and no usable password.

## 2. Functional requirements

### F1 — Give an employee staff access

- **FR-F1-1** The employee panel of the back office shows «إعطاء دخول» for an employee without a linked user, only
  to a caller who may grant for that employee (FR-F1-3). For an employee with access it shows the access state
  (role, branch, phone ending in three digits).
- **FR-F1-2** The granter enters the employee's phone (canonical, `+` and 8–15 digits), ticks «اتأكدت إن الرقم ده
  بتاعها» (required), picks the role — «موظف» or «استقبال/كاشير» (D1) — and types a 4-digit PIN.
- **FR-F1-3** Authorization is the new permission `manage:staff-access:branch`, evaluated by the server against the
  employee's **primary branch** read inside the transaction. Default holders: owner, branch manager (D3). The role
  and the scope of the new membership are never taken from the request beyond the two-value role choice: the role
  is `staff` or `cashier`, the scope is `BRANCH` = the employee's primary branch.
- **FR-F1-4** On success, all of these exist: an access record for the employee in state `ACTIVE`; a staff user
  (synthetic email, no credential account, D8); an approved phone binding recorded with the granter as the
  confirming actor (D2); a membership with the chosen role on the primary branch; the link `employees.user_id`; a
  **temporary** PIN for that user (FR-F2-1); audit rows for the membership, the link, the PIN and the phone
  binding; an outbox event `StaffAccessGranted`.
- **FR-F1-5** Refusals, each with its own error code and no detail about any other account:
  - `STAFF_ACCESS_PHONE_TAKEN` (409): the phone belongs to any other user, in any company (SA-Q4).
  - `STAFF_ACCESS_ALREADY_GRANTED` (409): the employee's access record is `ACTIVE`.
  - `STAFF_ACCESS_NOT_ALLOWED` (403): the caller does not hold the permission on the employee's primary branch,
    acts on her own employee record, or the employee is linked to a user that is not a staff user.
  - `EMPLOYEE_NOT_FOUND` (404) for a missing, deleted or other-business employee.
  - A request without the confirmation tick is rejected by the schema (400).
- **FR-F1-6 (resumable, D6)** The user is written on `pospay_auth` and the tenant rows on `pospay_app`; there is no
  single transaction. Each employee has one access record carrying an operation id; the staff user is created
  atomically on the auth side and is found again by that operation id. A request that failed after any step can be
  repeated for the same employee and ends in the same final state without a duplicate user, membership or link. A
  repeat of a request that already succeeded changes nothing: no new PIN and no second event. A staff user is
  never deleted because it has no session; a pending record older than 24 hours can be cancelled by the granter.
- **FR-F1-7** A staff user is a separate kind of account: it has no credential account, can never get a password,
  a set-password link, an email session, two-factor enrolment or a platform grant, can never be invited, and can
  never hold a membership in another company (D2, D8).
- **FR-F1-8** `create-employee` and `update-employee` never link an employee to a staff user and never change
  `employees.user_id` of an employee that has an access record; the link changes only through this slice.
- **FR-F1-9 (activation)** Every route of this slice answers `NOT_READY` until the API is started with the slice
  enabled; it is enabled only after all five PRs merged (plan §1.1).

### G1 — Invite a member

- **FR-G1-1** «دعوة عضو» is available to the owner only (IM-Q1, D11): permission `manage:memberships:company`.
  The back-office nav entry is shown to the owner only.
- **FR-G1-2** The owner enters an email, a name, a role — general manager, business manager, branch manager or
  accountant (IM-Q2) — and the scope the role needs: company for general manager and accountant, a business for
  business manager, a branch for branch manager. The role list is data, not code branches.
- **FR-G1-3** Before it posts, the screen always shows the full email and requires an explicit confirmation, for a
  new and for an existing account alike (D10). There is no route that tells whether an email has an account.
- **FR-G1-4** For an email with no account: the system creates the user and the membership and shows a one-time
  set-password link **once**, valid 48 hours (IM-Q3, D9). For an email that already has an account (IM-Q4): only
  the membership is added and no link is shown. The link is never stored by the API, never logged and never
  returned again; the owner copies it and sends it himself.
- **FR-G1-4b** Each invitation is recorded (no token, no link, no plain email). The owner who created a pending
  invitation can issue a new link while the invited person has never set a password; the earlier link stops
  working. No other company can issue a link for that account.
- **FR-G1-5** Refusals: `MEMBER_ALREADY_IN_COMPANY` (409) for an active membership of the same user in the company;
  `MEMBER_ROLE_NOT_INVITABLE` (422) for a role outside the list, the owner role, or a scope that does not match
  the role or does not belong to the company; `MEMBER_EMAIL_NOT_INVITABLE` (422) for a staff user's email or the
  owner's own email. Authority is the canonical owner, decided inside the write transaction.
- **FR-G1-6** Audit rows for the user creation and the membership; outbox event `MemberInvited`.

### F2 — Temporary PIN and owner notice (PP-63.8, PP-63.9, D4)

- **FR-F2-1** A PIN set by someone other than its holder is **temporary**: it expires 24 hours after it was set if
  unused, and its first successful use on a branch device requires the holder to choose a new PIN before any other
  action. The new PIN is not temporary.
- **FR-F2-2** A temporary PIN never grants a staff session. A correct temporary PIN answers `PIN_CHANGE_REQUIRED`
  with a short-lived, single-use proof bound to the device, the user and that PIN; a correct but expired one
  answers `PIN_EXPIRED`. Both are answered only after the PIN matched and the lockout rule ran, so a guess learns
  nothing. Until F2 is merged, a temporary PIN is refused like a wrong PIN by every PIN reader.
- **FR-F2-2b (DV-Q5)** The owner, or the branch manager for an employee of her branch, resets the PIN of an
  employee with staff access; the new PIN is temporary. The granter cannot reset her own PIN or the PIN of a user
  that is not a staff user through this route.
- **FR-F2-3** Every PIN set or reset by someone other than the holder, and every staff access grant, raises an
  in-app notice to the company's owner naming the employee, the actor, the branch and the time — never the PIN.
- **FR-F2-4** The audit log records who set a temporary PIN and when it was replaced.

### F3 — Change phone, stop access, follow the branch

- **FR-F3-1 (SA-Q5)** The granter changes the employee's phone with the same confirmation. Sign-in is closed for
  the employee from the first step of the change until it completes: the PIN is cleared first, her staff and
  personal sessions end, and a new temporary PIN is required. An interrupted change is finished by repeating it.
- **FR-F3-2 (SA-Q6)** «إيقاف الدخول» ends the staff membership at once (`ends_at = now`), ends the user's staff
  sessions and clears the PIN. The link `employees.user_id` stays, so «إعطاء دخول» later reuses the same user.
  Archiving an employee is not built yet; the identity function that stops access is exported for it (D5).
- **FR-F3-3 (SA-Q7)** When `update-employee` changes the primary branch of an employee with active staff access,
  the same transaction ends her membership on the old branch and inserts one with the same role on the new branch
  (D5). Permission overrides of the old membership are not carried over.

### G2 — End a membership

- **FR-G2-1 (IM-Q5)** The owner ends the membership of a manager or an accountant at once. The last owner cannot be
  removed (`LAST_OWNER`, 409). The member's next request to this company is refused; his sign-in and his other
  companies are not affected. The grant cache is invalidated.

## 3. Business rules

- **BR-1** An employee has one access record for life, and it manages exactly one membership at a time, addressed
  by its id. A staff user belongs to one employee of one company.
- **BR-2** A phone belongs to at most one user in the whole system. A tenant actor sets a phone only on a staff
  user of its own company, and a staff user never holds a membership in another company (D2).
- **BR-3** Membership changes go only through identity functions and each writes an audit row (ADR-0003 §4).
- **BR-4** The PIN, the phone and the set-password link are never logged and never appear in an audit row or an
  event payload. Phones are logged by their last three digits only.
- **BR-5** Abu Salem's picks on batch 103 are pending. The role lists, the holders of the new permission and the
  link lifetime are data, so a different pick is a small change.

## 4. Acceptance criteria

### F1

- **AC-F1-1** The owner grants access to Sara (staff role): a user, an approved phone binding, a `staff` membership
  on her primary branch, the employee link and a PIN exist; Sara signs in on a paired device of that branch.
- **AC-F1-2** A grant with role «استقبال/كاشير» produces a `cashier` membership, and that user's device session
  passes the attendance device access check.
- **AC-F1-3** A branch manager of Salmiya grants for a Salmiya employee (200) and is refused for a Hawalli employee
  (403), with no user created in the refused case.
- **AC-F1-4** A request carrying another role code, a scope or a branch id in its body is rejected by the schema
  (strict object), and the membership never has a role outside `staff`/`cashier`.
- **AC-F1-5** A phone owned by another user, in this or another company → 409 `STAFF_ACCESS_PHONE_TAKEN`; the
  response and the logs carry no field of that user, and that user's PIN and sessions are unchanged.
- **AC-F1-6** A crash after the access record was created, after the staff user was created, and a failing tenant
  write each leave a state that a repeat of the same request completes, with exactly one user, one membership and
  one link. A repeat after success leaves the PIN hash and the outbox unchanged.
- **AC-F1-6b** Two concurrent grants for one employee produce one access; two grants for one phone produce one
  access and one `STAFF_ACCESS_PHONE_TAKEN`. A branch manager granting for her own employee record is refused.
- **AC-F1-7** For a staff user: no credential account exists; a set-password link, a password reset, an email
  sign-in, two-factor enrolment, a platform grant and an invitation are each refused; no normal session can be
  created.
- **AC-F1-7b** `update-employee` and `create-employee` cannot link an employee to a staff user or change the link
  of an employee with an access record.
- **AC-F1-7c** With the slice disabled, every new route answers 503 `NOT_READY`. A PIN written by a grant is
  refused by staff PIN sign-in and by discount approval exactly like a wrong PIN.
- **AC-F1-8** RLS: another tenant reads zero rows of the new membership and cannot write it.
- **AC-F1-9** The audit log holds the four rows of FR-F1-4 with the granter as actor; no PIN and no full phone in
  any of them.

### G1

- **AC-G1-1** The owner invites `ahmed@example.test` as accountant: a user and a company-scope accountant
  membership exist; the response carries a link once; opening it lets him set a password (PR-D page); a second
  read of any API never returns the link.
- **AC-G1-2** The link is refused after 48 hours and after one use; operator-created links still last one hour.
- **AC-G1-3** An existing account: only the membership is added and the response carries no link. A request
  without the confirmation is rejected by the schema, whether or not the account exists.
- **AC-G1-3b** After a crash that left a created member without a link, the inviting owner issues a new link
  through the re-issue route; another owner, another company, and a member who already set a password are refused;
  the earlier link no longer works.
- **AC-G1-4** A general manager, a branch manager and an owner carrying a DENY override get 403. An owner inviting
  his own email is refused. Two owners inviting the same email at once produce one membership.
- **AC-G1-5** A role outside the list, or a branch manager without a branch scope → 422; the owner role → 422.
- **AC-G1-6** The API logs of the request contain neither the link nor its token.

### F2

- **AC-F2-1** A correct temporary PIN returns `PIN_CHANGE_REQUIRED` and a proof and creates no session; the proof
  works once, only on that device and only for that PIN; after the change the new PIN signs in normally. A wrong
  PIN and a locked account answer exactly as today.
- **AC-F2-1b** A branch manager resets the PIN of an employee of her branch (200) and is refused for another
  branch's employee, for herself and for a non-staff user.
- **AC-F2-2** An unused temporary PIN is refused with `PIN_EXPIRED` after 24 hours (injected clock).
- **AC-F2-3** The owner's inbox shows one notice per grant and per PIN reset by another person, without the PIN.

### F3 and G2

- **AC-F3-1** Phone change: during and after it the old PIN and the old sessions (device and personal) do not
  work; a change interrupted after any step is completed by a repeat; a phone owned by another user is refused.
- **AC-F3-2** Stop access: the next request of her staff session is refused; a later grant reuses the same user.
- **AC-F3-3** Primary branch change moves the membership in the same transaction; a failure rolls both back; an
  ALLOW and a DENY override on the old membership no longer apply.
- **AC-G2-1** End membership: the member's next request to the company is refused while his second company still
  works; ending the last owner → 409 `LAST_OWNER`; two owners ending each other at once leave one owner.

## 5. Schema changes

- **F1:** permission `manage:staff-access:branch` in the catalog and a seed migration for the owner and branch
  manager system roles; on `user`: `staff_access_company_id` and `staff_access_operation_id` (unique), written
  only by `packages/auth`; new tenant table `employee_staff_access` with forced RLS; on `cashier_pins`:
  `temporary boolean NOT NULL DEFAULT false`, `expires_at timestamptz NULL`.
- **G1:** on `user`: `invited_by_company_id`, `invitation_operation_id` (unique); new tenant table
  `member_invitations` with forced RLS.
- **F2:** a table or columns for the PIN-change proof (hash, device, user, PIN revision, expiry, consumed).
- **F3, G2:** none expected.

All migrations are expand only. Every migration is built in parallel on a private lane and numbered only on the manager's word.

## 6. API contract (new routes)

| PR | Route | Guard |
|---|---|---|
| F1 | `POST /v1/businesses/:businessId/employees/:employeeId/staff-access` | `@Authenticated`, record-scoped, declared |
| F1 | `GET /v1/businesses/:businessId/employees/:employeeId/staff-access` | `@Authenticated`, record-scoped |
| F1 | `DELETE …/staff-access/pending` (cancel a pending record) | `@Authenticated`, record-scoped, declared |
| G1 | `POST /v1/memberships/invitations` | `@Require('manage:memberships:company')` + canonical owner in the transaction |
| G1 | `POST /v1/memberships/invitations/:invitationId/link` | same |
| G1 | `GET /v1/memberships/invitations` | `@Require('manage:memberships:company')` |
| F2 | `POST /v1/devices/me/staff-pin/change` | `@Authenticated` (device), proof in the body |
| F2 | `POST …/employees/:employeeId/staff-access/pin` | `@Authenticated`, record-scoped, declared |
| F3 | `PUT …/staff-access/phone`, `DELETE …/staff-access` | `@Authenticated`, record-scoped, declared |
| G2 | `POST /v1/memberships/:membershipId/end` | `@Require('manage:memberships:company')` + canonical owner in the transaction |

Every route is behind the activation gate (FR-F1-9). Contracts live in `packages/contracts` (strict Zod objects); the OpenAPI document and the three clients are
regenerated in the PR that adds a route.

## 7. Out of scope

WhatsApp code verification of the phone, passkey enrolment, the employee archive use case, changing the role of an
existing membership, automatic email delivery of the invitation, and a «create company» screen (PR-H).

## 8. Named risks, accepted

- A granter can point an employee's sign-in at a phone he controls. It is visible in the audit log and, from F2,
  in the owner's notice (D2).
- A mistyped invitation email that matches an existing account gives that person the role at once; the explicit
  confirmation of the full email, always asked, is the control (D10).
- After a successful invitation the owner learns whether the email already had an account (a link is shown or
  not). This follows from IM-Q3 and IM-Q4; the route is owner-only, rate-limited and audited.
