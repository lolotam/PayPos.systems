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
- **FR-F1-4** On success, all of these exist: a user (synthetic email, D8); an approved phone binding recorded with
  the granter as the confirming actor (D2); a membership with the chosen role on the primary branch; the link
  `employees.user_id`; a PIN for that user; audit rows for the membership, the link, the PIN and the phone binding;
  an outbox event `StaffAccessGranted`.
- **FR-F1-5** Refusals, each with its own error code and no detail about any other account:
  - `STAFF_ACCESS_PHONE_TAKEN` (409): the phone belongs to another user (SA-Q4).
  - `STAFF_ACCESS_ALREADY_GRANTED` (409): the employee is linked to a user with an active membership.
  - `STAFF_ACCESS_NOT_ALLOWED` (403): the caller does not hold the permission on the employee's primary branch.
  - `EMPLOYEE_NOT_FOUND` (404) for a missing, deleted or other-business employee.
  - `STAFF_ACCESS_PHONE_NOT_CONFIRMED` (422): the confirmation tick is missing.
- **FR-F1-6 (resumable, D6)** The user is written on `pospay_auth` and the tenant rows on `pospay_app`; there is no
  single transaction. A request that failed after any step can be repeated with the same phone and employee and
  ends in the same final state without a duplicate user, membership or link. A user created by a request whose
  tenant transaction failed is discarded in the same request when possible; when it could not be discarded, the
  next request for the same phone and company adopts it instead of refusing with `STAFF_ACCESS_PHONE_TAKEN`.
- **FR-F1-7** A staff user can never get a password: no set-password link is issued for it, and the password-reset
  and sign-in-by-email routes refuse a synthetic email (D8).
- **FR-F1-8** `update-employee` no longer changes `employees.user_id` for an employee whose link was made by staff
  access; the link changes only through this slice's use cases.

### G1 — Invite a member

- **FR-G1-1** «دعوة عضو» is available to the owner only (IM-Q1, D11): permission `manage:memberships:company`.
  The back-office nav entry is shown to the owner only.
- **FR-G1-2** The owner enters an email, a name, a role — general manager, business manager, branch manager or
  accountant (IM-Q2) — and the scope the role needs: company for general manager and accountant, a business for
  business manager, a branch for branch manager. The role list is data, not code branches.
- **FR-G1-3** For an email with no account: the system creates the user and the membership and shows a one-time
  set-password link **once**, valid 48 hours (IM-Q3, D9). The link is never stored by the API, never logged and
  never returned again. The owner copies it and sends it himself.
- **FR-G1-4** For an email that already has an account (IM-Q4): only the membership is added and no link is shown.
  Before saving, the screen shows the full email and requires an explicit confirmation (D10). The response says
  only that the member was added.
- **FR-G1-5** Refusals: `MEMBER_ALREADY_IN_COMPANY` (409) for an active membership of the same user in the company;
  `MEMBER_ROLE_NOT_INVITABLE` (422) for a role outside the list or a scope that does not match the role;
  `MEMBER_EMAIL_NOT_INVITABLE` (422) for a synthetic staff email.
- **FR-G1-6** Audit rows for the user creation and the membership; outbox event `MemberInvited`.

### F2 — Temporary PIN and owner notice (PP-63.8, PP-63.9, D4)

- **FR-F2-1** A PIN set by someone other than its holder is **temporary**: it expires 24 hours after it was set if
  unused, and its first successful use on a branch device requires the holder to choose a new PIN before any other
  action. The new PIN is not temporary.
- **FR-F2-2** While a temporary PIN is pending or expired, PIN sign-in answers with a state the device can act on
  (`PIN_CHANGE_REQUIRED`, `PIN_EXPIRED`) and grants no staff session until the new PIN is chosen.
- **FR-F2-3** Every PIN set or reset by someone other than the holder, and every staff access grant, raises an
  in-app notice to the company's owner naming the employee, the actor, the branch and the time — never the PIN.
- **FR-F2-4** The audit log records who set a temporary PIN and when it was replaced.

### F3 — Change phone, stop access, follow the branch

- **FR-F3-1 (SA-Q5)** The granter changes the employee's phone with the same confirmation. Allowed only for a staff
  user created by this slice in this company that has no active membership in another company (D2). On success the
  user's staff sessions end, the PIN is cleared and a new temporary PIN is required.
- **FR-F3-2 (SA-Q6)** «إيقاف الدخول» ends the staff membership at once (`ends_at = now`), ends the user's staff
  sessions and clears the PIN. The link `employees.user_id` stays, so «إعطاء دخول» later reuses the same user.
  Archiving an employee is not built yet; the identity function that stops access is exported for it (D5).
- **FR-F3-3 (SA-Q7)** When `update-employee` changes the primary branch of an employee with staff access, the same
  transaction ends her membership on the old branch and inserts one with the same role on the new branch (D5).

### G2 — End a membership

- **FR-G2-1 (IM-Q5)** The owner ends the membership of a manager or an accountant at once. The last owner cannot be
  removed (the existing deferred trigger, plus a typed error `LAST_OWNER`). The grant cache is invalidated.

## 3. Business rules

- **BR-1** A user holds at most one active staff-access membership per business (the existing partial unique index
  on the employee link).
- **BR-2** A phone belongs to at most one user in the whole system; a tenant actor never repoints the phone of a
  user that has an active membership in another company or that this slice did not create (D2).
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
- **AC-F1-5** A phone owned by another user → 409 `STAFF_ACCESS_PHONE_TAKEN`; the response and the logs carry no
  field of that user.
- **AC-F1-6** With the tenant transaction forced to fail after the user was created, a repeat of the same request
  succeeds and leaves exactly one user, one membership and one link.
- **AC-F1-7** A password-reset request and an email sign-in for the synthetic email are refused, and no
  `verification` row is created for a staff user.
- **AC-F1-8** RLS: another tenant reads zero rows of the new membership and cannot write it.
- **AC-F1-9** The audit log holds the four rows of FR-F1-4 with the granter as actor; no PIN and no full phone in
  any of them.

### G1

- **AC-G1-1** The owner invites `ahmed@example.test` as accountant: a user and a company-scope accountant
  membership exist; the response carries a link once; opening it lets him set a password (PR-D page); a second
  read of any API never returns the link.
- **AC-G1-2** The link is refused after 48 hours and after one use; operator-created links still last one hour.
- **AC-G1-3** An existing account: only the membership is added, no link in the response, and the request without
  the explicit confirmation flag is refused 422.
- **AC-G1-4** A general manager and a branch manager calling the route get 403.
- **AC-G1-5** A role outside the list, or a branch manager without a branch scope → 422; the owner role → 422.
- **AC-G1-6** The API logs of the request contain neither the link nor its token.

### F2

- **AC-F2-1** A PIN set by the granter signs in once and returns `PIN_CHANGE_REQUIRED`; no staff route works until
  a new PIN is chosen; the new PIN signs in normally.
- **AC-F2-2** An unused temporary PIN is refused with `PIN_EXPIRED` after 24 hours (injected clock).
- **AC-F2-3** The owner's inbox shows one notice per grant and per PIN reset by another person, without the PIN.

### F3 and G2

- **AC-F3-1** Phone change: allowed for a staff user of this company only; refused for a user with a membership in
  another company; sessions end and the old PIN no longer signs in.
- **AC-F3-2** Stop access: the next request of her staff session is refused; a later grant reuses the same user.
- **AC-F3-3** Primary branch change moves the membership in the same transaction; a failure rolls both back.
- **AC-G2-1** End membership: the member's next request to the company is refused; ending the last owner → 409.

## 5. Schema changes

- **F1:** permission `manage:staff-access:branch` in the catalog and a seed migration for the owner and branch
  manager system roles (expand only). A column on `user` marking a staff-access user and the company that created
  it (`staff_access_company_id uuid NULL`), written only by `packages/auth`.
- **F2:** on `cashier_pins`: `temporary boolean NOT NULL DEFAULT false`, `expires_at timestamptz NULL`.
- **G1, F3, G2:** none expected.

Every migration is built in parallel on a private lane and numbered only on the manager's word.

## 6. API contract (new routes)

| PR | Route | Guard |
|---|---|---|
| F1 | `POST /v1/businesses/:businessId/employees/:employeeId/staff-access` | `@Authenticated`, record-scoped, declared |
| F1 | `GET /v1/businesses/:businessId/employees/:employeeId/staff-access` | `@Authenticated`, record-scoped |
| G1 | `POST /v1/memberships/invitations` | `@Require('manage:memberships:company')` |
| F2 | `POST /v1/devices/me/staff-pin/change` | `@Authenticated` (device) |
| F3 | `PUT …/staff-access/phone`, `DELETE …/staff-access` | `@Authenticated`, record-scoped, declared |
| G2 | `POST /v1/memberships/:membershipId/end` | `@Require('manage:memberships:company')` |

Contracts live in `packages/contracts` (strict Zod objects); the OpenAPI document and the three clients are
regenerated in the PR that adds a route.

## 7. Out of scope

WhatsApp code verification of the phone, passkey enrolment, the employee archive use case, changing the role of an
existing membership, automatic email delivery of the invitation, and a «create company» screen (PR-H).

## 8. Named risks, accepted

- A granter can point an employee's sign-in at a phone he controls. It is visible in the audit log and, from F2,
  in the owner's notice (D2).
- A mistyped invitation email that matches an existing account gives that person the role at once; the explicit
  confirmation of the full email is the control (D10).
