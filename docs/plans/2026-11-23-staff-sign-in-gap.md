# Go-live blocker — how an employee, a manager or an accountant gets a sign-in (2026-11-23)

Read against `origin/main@dc5b78786`; code reading only, nothing run. Raised by the row-61 lane and checked here
against the routes.

## Finding

**No product path — screen or API — creates a user for an employee or adds a second person to a company.** The only
user of a company the product can create is its first owner.

Evidence:

- Every use case of `identity`: `approve-device`, `authenticate-device`, `authorize-platform`, `authorize-request`,
  `check-feature`, `claim-device-token`, `grant-permission-override`, `issue-pairing-code`, `onboard-company`,
  `open-private-view`, `register-device`, `reset-staff-pin`, `revoke-device`, `revoke-permission-override`,
  `set-cashier-pin`, `set-discount-limit`, `sign-in-staff-pin`, `verify-cashier-pin`,
  `verify-discount-approver-pin` (`apps/api/src/modules/identity/use-cases/`). None invites a member, creates a
  user or creates a membership.
- Memberships are inserted in exactly two places: the owner's membership during onboarding
  (`apps/api/src/modules/identity/persistence/onboarding-transactions.ts:26`) and the staging-only operator helper
  (`packages/db/src/operator/staging-staff.ts:84-101`).
- The membership routes only list memberships and edit overrides and the discount limit
  (`apps/api/src/modules/identity/http/permissions.controller.ts:38,48,66,80,91`;
  `business-permissions.controller.ts:34,45,64,84`).
- Users are created only by `createPlatformUser` (`packages/auth/src/create-platform-user.ts:47`), called by the
  two operator scripts `platform:create-user` and `staging:staff-user`. Public sign-up is off
  (`packages/auth/src/config.ts:243`).
- An employee record can carry `user_id` (`packages/db/schema/staff.ts:64`;
  `packages/contracts/src/staff/employee.ts:37`), but that only links to a user that already exists.
- A staff phone becomes usable for a sign-in code only after `approvePhoneBinding`
  (`packages/auth/src/approve-phone-binding.ts:10`), reachable only from the operator script
  `platform:bind-phone` (`apps/api/scripts/bind-phone.ts`).
- The one tool that does the whole chain — user, phone binding, staff branch membership, employee link — is
  `staging:staff-user` (`apps/api/scripts/staging-staff-user.ts`), which refuses to run anywhere but staging
  (`apps/api/scripts/staging-staff-guard.ts:32`, PP-58.3).

## What each sign-in needs, and what works today

| Step | Needs | Product path today |
|---|---|---|
| Employee record | `create-employee` | **works** (admin screen) |
| A user for that employee | a `user` row | **missing** |
| Employee ↔ user link | `employees.user_id` | field exists; nothing sets it for a new user |
| Membership (staff role, branch scope) | a `memberships` row | **missing** |
| PIN | `POST /v1/staff-pins/reset` with `user_id` and a 4-digit PIN, permission `manage:memberships:company` (`apps/api/src/modules/identity/http/staff-pin.controller.ts:73-74`; `packages/contracts/src/identity/staff-otp.ts:70-74`) | route **works** once a user exists; no admin screen was found that calls it |
| PIN sign-in on the paired device | `POST /v1/devices/me/staff-pin/sign-in`, then an eligibility check (`staff-pin.controller.ts:38`; `use-cases/sign-in-staff-pin/sign-in-staff-pin.ts:91`) | **works** once the user, membership and PIN exist |
| Code by WhatsApp on the device (ADR-0019) | the above + an approved phone binding + an approved Meta template | **missing** twice (binding path, template) |
| Personal session on the employee's phone (ADR-0027) | the above + passkey enrolment | **missing** for the same reason |

Consequences for the first salon on day one, as the code stands:

- Only the owner can sign in. No receptionist, manager or accountant account can exist.
- Attendance cannot start: clocking by card needs a **staff session** on the paired device
  (`apps/api/src/modules/staff/http/clock-by-card.controller.ts:38-40`), and clocking from a phone needs a personal
  session (`clock-attendance.controller.ts:44-46`). Whether the owner's own account passes the staff eligibility check
  was not verified.
- "My work", own attendance, own leave and the private view are unreachable for every employee.
- Recording visits, packages and discounts works for the owner in the admin; performers are employee records and
  need no user.

## The smallest PRs that close it

Both are **Heavy** (auth and permissions), each needs its slice spec and owner questions first (`CLAUDE.md` §1).

- **PR-F — give an employee staff access.** One use case in `identity` (`grant-employee-access`): inside one
  transaction create the user through `packages/auth`, link `employees.user_id`, insert the staff membership for the
  employee's branch, record the phone binding with the manager's confirmation, set the first PIN, write the audit
  rows. One button on the employee screen ("give access" → phone + PIN), and "reset PIN" on the same screen. The
  staging operator code is the reference for the steps and their order
  (`packages/db/src/operator/staging-staff.ts`, `apps/api/scripts/staging-staff-user.ts`). Estimate: about 700 lines
  (production 280, tests 340, screen and i18n 80). A second step, "end access", follows the same shape.
- **PR-G — add a manager or an accountant.** One use case (`invite-member`): the owner enters an email, a name and a
  role with its scope; the system creates the user and the membership and shows the owner a one-time set-password
  link (the PR-D page completes it). Estimate: about 500 lines. It needs the owner's answer on which roles may be
  given and who may give them.
- **PR-H — a "create company" screen** for a signed-in user holding the platform grant, so the salon owner never
  pastes code into a browser console. Estimate: about 180 lines (form, i18n, tests). Optional for one salon if the
  manager performs that one call with the owner present.

## Interim option (Waleed's decision — production, auth)

Until PR-F and PR-G merge, the same chain can be run by an audited operator script on production for the first
salon's staff. That means lifting PP-58.3's staging-only restriction for a production variant with its own guard, and
running it from the image decided in the rehearsal (step 1). It is fast and it is a hand-run path into identity data.

Options: (1) *recommended* — build PR-F before go-live and PR-G right after; the owner alone runs the parallel month's
first days if PR-F slips. (2) Approve the production operator script for the first salon, with every run in a receipt.
(3) Go live with the owner account only and no attendance until PR-F merges.

## How a second admin is added today

It cannot be, by the product. With operator tools only: `platform:create-user` creates the user and its set-password
link, but nothing outside the staging helper creates the membership that ties that user to the company — so even the
operator path stops short on production.
