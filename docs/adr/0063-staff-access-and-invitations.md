# 0063 — Staff access and member invitations (spec 076)

> **PROVISIONAL NUMBER.** The final number is assigned on the manager's word at F1's final step, per
> plan §3. Renumbering touches only this file's name and the pointers below.

## Context

The go-live blocker `docs/plans/2026-11-23-staff-sign-in-gap.md`: **no product path creates a user or a
membership for an employee, a manager or an accountant.** A staff user today exists only through the
staging operator script (ADR-0003 §6a, PP-58.3) or `platform:create-user`. ADR-0003 line 387 recorded the
deferred deliverable: «Inviting users into a company is a later deliverable (issue #19)». Owner answers:
`docs/specs/076-identity-staff-access/owner-questions.ar.md` (batch 103, SA-Q1…SA-Q7, IM-Q1…IM-Q6, D1…D11).

Constraints that shaped the design (plan §2): `packages/auth` writes the global identity tables on
`pospay_auth` and tenant rows are written on `pospay_app` inside `withTenant` — **there is no single
database transaction that can cover a user and her membership** (ADR-0003 §4); only `identity` imports
`packages/auth`; `staff` may import `identity`'s `index.ts`, never the reverse.

## Decisions

**1. The access record and the cross-role sequence (F1).** Each employee gets one
`employee_staff_access` row for life, keyed `(company_id, employee_id)`, carrying an `operation_id`. The
grant runs three steps: (1) a tenant transaction that locks the employee, evaluates
`manage:staff-access:branch` on her **primary branch**, and inserts or re-reads the record; (2) one auth
transaction in `packages/auth` (`provisionStaffUser`) that creates or finds the staff user by
`staff_access_operation_id`, refuses a phone owned by any other user, approves the phone binding with the
granter as the confirming actor, and writes the platform audit rows; (3) a tenant transaction that
re-checks step 1 under lock, inserts the membership with the server-side role table
(`staff`/`reception` → system `staff`/`cashier`, scope = primary branch), sets `employees.user_id`, saves
the PIN as **temporary** (24 h), closes the record `ACTIVE`, and appends `StaffAccessGranted` in the same
transaction. A failed request repeats to the same final state; a repeat after success changes nothing —
no new PIN and no second event. An alternative that made identity write `employees` was rejected: it
moves an HR table into identity and inverts the module arrow the map already declares.

**2. (Amends ADR-0019 Q1 and addendum c.)** Phone binding is no longer platform-only. A tenant granter
confirms a phone **only** for a staff user of the same company (`staff_access_company_id`), only inside
the grant sequence, and a phone owned by anyone else is refused with no detail about that account
(SA-Q4). A staff user never holds a membership in another company — every membership writer checks the
marker. The operator path and its operator-name check are unchanged.

**3. (Amends ADR-0003 §4 and §6 line 387.)** `manage:staff-access:branch` (owner, branch manager by
default, seeded) creates, ends and follows the staff membership of an employee of the covered branch
through identity functions only. Invitations of managers and accountants (G1) stay under
`manage:memberships:company`, decided for the canonical owner inside the write transaction. Issue #19 is
delivered by spec 076 G1, not by this ADR alone.

**4. The bounded synchronous cross-module write.** `staff`'s `grant-employee-access` use case opens the
tenant transactions; identity functions write inside them and on the auth side:
`grantStaffMembership` and `saveTemporaryStaffPin` inside the caller's `tx`, `provisionStaffUser` /
`cancelStaffUser` in their own auth transactions — all reached through identity's `index.ts` with the
caller's transaction, the existing `employeeUserLinkAvailable` pattern. ADR-0003 §5.3 records one
synchronous cross-module write; this is the second and last, one row per symbol in
`docs/module-map.md` §3.1/§6. An event cannot serve: the grant must refuse on the employee lock and end
in one observable final state per operation id.

**5. Activation gate and rollback floor (plan §1.1).** Nothing in this slice is reachable in production
until all five PRs merged: every new route answers 503 `NOT_READY` unless the API started with
`STAFF_ACCESS_ROUTES=on`, read once at startup. Until F2 lands, a manager-set PIN is stored temporary
and **every PIN reader refuses a temporary PIN exactly like a wrong PIN**
(`sign-in-staff-pin`, `verify-discount-approver-pin` — the readers filter `temporary = false`). Once
`employee_staff_access` holds a row, the API does not roll back below the PR that wrote it: an older API
would read only the PIN hash and accept a temporary or expired PIN. The floor is checked by a read-only
count before any rollback.

**6. A staff user is a separate kind of account (D8).** No credential account; the synthetic email is
`staff-<operation_id>@staff.pospay.invalid` (reserved domain, never derived from the phone). Every
credential path refuses by the marker: `issuePasswordSetLink` at issuance, the account create/update
database hooks (so no password can be set or changed even if a token existed), normal-purpose session
creation (email sign-in, two-factor enrolment), `createPlatformUser` and the operator email rules
(reserved domain refused), the platform grant tools, and the invitation path (G1 consumes the same
`isStaffUser` reader). No public API-key route exists today; a future one must check the marker before
issuing.

## Consequences

The named risks of spec §8 are accepted: a granter can point an employee's sign-in at a phone he
controls (visible in the audit log; from F2 in the owner's notice); the explicit confirmation tick is
the control for a mistyped phone. The temporary-PIN columns exist from F1 while the change flow waits
for F2, so a grant written before F2 ships produces a PIN no reader accepts until the holder chooses a
new one — intended, because the routes are off until all five PRs merged. Cancelling a pending record
deletes the staff user (the one deletion path) after 24 hours, so the synthetic account space stays
clean.
