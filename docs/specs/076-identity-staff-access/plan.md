# 076 — Implementation plan

Spec: `spec.md`. Decisions: `owner-questions.ar.md`. Code facts below were read at `origin/main@aef577fd2`; an
implementer re-checks each path before relying on it.

**Revision 2 (2026-11-23)** — after the one plan debate (Codex Astra 6.2, medium, on 334c1a35d: PROCEED WITH
CHANGES, nine P1 and one P2). Every finding is taken; §9 maps each to the section that answers it.

## 1. Delivery

| PR | Content | Estimate (all changed hand-written lines) | Refuse above | Migration |
|---|---|---|---|---|
| F1 | give access, with the access record and the temporary-PIN columns | 2,100 (production 850, tests 1,050, screen and i18n 200) | 3,000 | permission seed, `user` columns, `employee_staff_access`, `cashier_pins` columns |
| G1 | invite a member, with the pending invitation | 1,100 | 1,600 | `member_invitations` |
| F2 | PIN change by proof, branch-scoped reset, owner notice | 900 | 1,800 | none |
| F3 | change phone, stop access, follow branch | 700 | 1,400 | none |
| G2 | end a membership | 350 | 700 | none |

Order of merge: F1 → G1 → F2 → F3 → G2. F1 and G1 are built in parallel in separate worktrees by different
implementers; F2, F3 and G2 stack on F1. Each PR: implementer runs `clean-code-guard`, `test-guard` and
`waleed-security-reviewer`; one review; one fix round; `ci-gate` on the exact head. Migrations are numbered only
on the manager's word.

### 1.1 Activation gate and rollback floor

- **Nothing in this slice is reachable in production until all five PRs are merged.** Every new route answers
  `NOT_READY` (503) unless the API runs with `STAFF_ACCESS_ROUTES=on`, read once at startup (default off, listed in
  `.env.example`). The admin and POS screens hide their entries on that answer. Turning it on is a deploy change
  and is decided when G2 has merged.
- F1 alone therefore ships no usable manager-set PIN: the routes are off, and a PIN written by a granter is stored
  **temporary** from F1 on (the columns are in F1) while every PIN reader refuses a temporary PIN until F2 adds the
  change flow (§6). The readers are `sign-in-staff-pin` and `verify-discount-approver-pin`
  (`use-cases/verify-discount-approver-pin/…:85,134-139`); each gets a test that a temporary PIN is refused with
  the same answer as a wrong PIN.
- PINs that exist before F1 are untouched (`temporary = false`).
- **Rollback floor:** once `employee_staff_access` or `member_invitations` holds a row, the API does not go below
  the PR that wrote it; an older API reads only the PIN hash and would accept a temporary or expired PIN. The floor
  is checked by a read-only count before any rollback, recorded with its time. The migrations are expand only and
  stay.

Files both F1 and G1 touch (resolve at the second merge; regenerate, never hand-merge generated files):
`packages/auth/src/index.ts`, `apps/api/src/modules/identity/identity.module.ts` and `index.ts`,
`apps/api/src/shared/errors.ts`, `packages/i18n/src/{ar,en}.ts`, `packages/contracts/src/index.ts`,
`packages/contracts/openapi/openapi.json`, the three `schema.d.ts`, `docs/module-map.md`.

## 2. Constraints every PR obeys

1. **Two database roles, no shared transaction.** `packages/auth` writes `user`, `account`, `verification`,
   `session` on `pospay_auth`; memberships, employees, PINs, the access record and the audit log are written on
   `pospay_app` inside `withTenant(companyId, tx => …, { userId: actor })`. Only `identity` imports
   `packages/auth`. No new grant to `pospay_app` on identity tables and none to `pospay_auth` on tenant tables.
2. **Module direction, and one named exception.** `staff` may import `identity`'s `index.ts`; `identity` may not
   import `staff`. The use case that touches `employees` lives in `staff` and reaches identity through a port in
   `staff/ports/` with its adapter in `staff/persistence/`, calling identity functions that take the caller's `tx`
   (existing pattern: `employeeUserLinkAvailable`, `lockEmployeeManagementAccess`). A membership and a PIN written
   by identity inside a transaction that `staff` opened is a **second synchronous cross-module write**
   (ADR-0003 §4 lines 365–367, `CLAUDE.architecture.md` lines 107–111): it is recorded as a bounded exception in the
   ADR (§3) and in `docs/module-map.md`, and `pnpm module-map:check` is run against the real files.
   **Step 0 of F1:** skeletons with these calls, then `pnpm module-map:check` and lint, before any logic; stop and
   report if the arrow is refused.
3. **Secrets.** A PIN, a full phone, a set-password link or its token never reach a log line, an audit row, an
   event payload, an error message or a test snapshot. Phones are logged as their last three digits.
4. **Server-decided authority.** Role codes and scopes come from a server-side table keyed by a closed enum in the
   request; request schemas are `.strict()`. Authority is re-read inside the write transaction.
5. **A staff user is a separate kind of account** (§4.3): no credential account, never a member of a second
   company, never invitable, never a platform user. Every writer of memberships and every issuer of a credential
   checks the marker.
6. Project rules: Arabic JSDoc on `domain/`, `ports/`, `events/published.ts`; files ≤ 300 lines; no arithmetic or
   SQL in a use case; `Clock` and `IdGenerator` injected; typed errors from `packages/db`; an RLS policy and a
   negative isolation test for each new tenant table, in the PR that adds it.

## 3. ADR

One new ADR, `docs/adr/00NN-staff-access-and-invitations.md` (number taken at F1's final step), merged with F1:

- context: the go-live gap and ADR-0003 §4 line 387 («inviting users is a later deliverable, issue #19»);
- decision 1: the access record and the cross-role sequence of §4.2, resumable by operation id, instead of one
  transaction;
- decision 2 (amends ADR-0019 Q1): a tenant granter confirms a phone only for a staff user of the same company;
  a phone owned by anyone else is refused; a staff user never holds a membership in another company, enforced by
  every membership writer;
- decision 3 (amends ADR-0003 §4): `manage:staff-access:branch` (owner, branch manager) creates and ends the
  staff membership of an employee of the covered branch through identity functions only; invitations stay under
  `manage:memberships:company`, decided for the canonical owner inside the write transaction;
- decision 4: the bounded exception of §2 item 2 — which functions, which tables, why the alternative (identity
  writing `employees`) is worse;
- decision 5: the activation gate and the rollback floor of §1.1;
- consequences: the named risks of spec §8.

Addenda in the same PR: ADR-0019 (Q1 and addendum c point to this ADR), ADR-0003 line 387.

## 4. F1 — give access

### 4.1 Contract (`packages/contracts/src/staff/staff-access.ts`)

```ts
grantStaffAccessInput = z.object({
  phone: canonicalStaffPhone,
  phone_confirmed: z.literal(true),
  role: z.enum(['staff', 'reception']),
  pin: z.string().regex(/^\d{4}$/),
}).strict()

staffAccess = z.object({
  state: z.enum(['NONE', 'PENDING', 'ACTIVE', 'STOPPED']),
  role: z.enum(['staff', 'reception']).nullable(),
  branch_id: id.nullable(),
  phone_last3: z.string().regex(/^\d{3}$/).nullable(),
  can_manage: z.boolean(),
})
```

`reception` maps to the system role `cashier`; the mapping is one server-side table in `identity/domain`. The
database check on `phone_number` allows 7–15 digits and the contract 8–15: the contract is the stricter rule and
stays.

### 4.2 The access record and the sequence

New tenant table `employee_staff_access` (primary key `(company_id, id)`, forced RLS, policies and grants as the
other tenant tables; indexes on the RLS column and every foreign key):

| Column | Meaning |
|---|---|
| `business_id`, `employee_id` | the employee; unique `(company_id, employee_id)` — one record per employee, for life |
| `operation_id` | UUID v7 made when the record is created; the idempotency identity of the auth step |
| `user_id` | null until the auth step is confirmed |
| `membership_id` | the membership this record manages; every later change addresses the membership by this id |
| `role_code`, `branch_id` | what was granted |
| `state` | `PENDING`, `ACTIVE`, `STOPPED`, `PHONE_CHANGING` |
| `granted_by`, `created_at`, `updated_at` | audit helpers; the audit log stays the record |

`staff/use-cases/grant-employee-access/` orchestrates; it contains no SQL and no arithmetic.

| Step | Where | What | Crash after it | On repeat |
|---|---|---|---|---|
| 1 | tenant tx | lock the employee row; identity decides `manage:staff-access:branch` on her primary branch; refuse a granter acting on her own employee record or on an employee already linked to a non-staff user; insert or re-read the access record. A record in `PENDING` is reused with its `operation_id`; `ACTIVE` → `STAFF_ACCESS_ALREADY_GRANTED`; `STOPPED` → continue with the same `user_id` | a `PENDING` record with no user | step 2 with the same `operation_id` |
| 2 | `packages/auth`, **one auth transaction** | `provisionStaffUser({ operationId, companyId, phone, name, actorUserId })`: if a user with this `staff_access_operation_id` exists, return it; otherwise, atomically: refuse when the phone belongs to any user; insert the user with `staff_access_company_id`, `staff_access_operation_id`, the synthetic email and **no credential account**; set the phone with the binding approved by the actor; write the platform audit row. For a `STOPPED` record: verify the phone is the user's own or free, then set it the same way | a staff user the record does not know yet | the same user is returned by `operation_id` |
| 3 | tenant tx | lock the company; re-read the record and the employee `FOR UPDATE` and re-check step 1; identity inserts the membership (role from the table, scope = primary branch) and returns its id; staff sets `employees.user_id` (`revision + 1`); identity saves the PIN as **temporary** with `expires_at = now + 24 h`; the record becomes `ACTIVE` with `user_id` and `membership_id`; audit rows; outbox `StaffAccessGranted` | nothing partial: one transaction | the record is `ACTIVE`: answer the current state, **do not** write the PIN again and **do not** emit a second event |
| 4 | after commit | invalidate the grant cache for the company and the membership | cache expires by itself | — |

Rules that follow:

- No user is ever discarded because it has no session. An orphan from a crash after step 2 is always reachable
  through its `operation_id`; a `PENDING` record older than 24 hours can be cancelled by the granter, which deletes
  the staff user by `operation_id` in one auth transaction and the record in one tenant transaction.
- The synthetic email is `staff-<operation_id>@<reserved domain>`, never derived from the phone (F3 changes the
  phone). The reserved domain is a constant in `packages/auth` and a `.invalid` name.
- The adoption rule of revision 1 is gone: a phone that belongs to any user is refused, whatever the company.
- Two concurrent grants for one employee serialize on the unique `(company_id, employee_id)`; two for one phone on
  the unique phone constraint, and the loser answers `STAFF_ACCESS_PHONE_TAKEN`.
- `create-employee` and `update-employee` refuse to set or change `user_id` to a staff user, and refuse any change
  of `user_id` for an employee that has an access record (FR-F1-8). `employeeUserLinkAvailable` gets the same rule.

### 4.3 `packages/auth` additions (the only place these may live)

- `user.staff_access_company_id uuid NULL` and `user.staff_access_operation_id uuid NULL UNIQUE`, written only here.
  A CHECK keeps them both null or both set.
- `provisionStaffUser` (step 2), `cancelStaffUser(operationId, companyId)`, `readStaffUser(operationId)`.
- The phone binding inside that transaction reuses the statements of `otpApprovePhone`
  (`packages/db/src/staff-otp-database.ts:112-156`) with a tenant user id as the confirming actor. The operator path
  and its operator-name check are unchanged.
- **Closing every credential path for a staff user (D8),** by the marker, at issuance and at consumption: no
  credential account is created; `issuePasswordSetLink` and the reset-password consumption refuse; email sign-in
  refuses; two-factor enrolment refuses; `createPlatformUser` and the platform grant tools
  (`platform-grants.ts:25-28,57-74`) refuse; the invitation path refuses (§5). Tests: each of these, plus that no
  normal session cookie can be minted for a staff user. No public API-key route exists today; the ADR records that
  a future one must check the marker.

### 4.4 Identity exports (take the caller's `tx`)

- `readStaffAccessAuthority(tx, { companyId, actorUserId, businessId, branchId, at })` → boolean.
- `grantStaffMembership(tx, { companyId, userId, branchId, role, ids })` → membership id. It refuses a user that is
  not a staff user of this company, and inserts as `packages/db/src/operator/staging-staff.ts:101-103` does.
- `saveTemporaryStaffPin(tx, { companyId, userId, pinHash, setBy, at })`.
- `readStaffAccessState(tx, …)` for the GET route.

The permission is added to `packages/db/src/access-catalog.ts` and `role-defaults.ts` (owner, branch manager) and
seeded by a migration shaped like `0240_2026-11-22_ratings-read-permission.sql` (idempotent, expand only).
`system-role-policy.ts` allows it for exactly those roles; the catalog parity tests of the ratings permission are
repeated. A branch manager granting the reception role gives a role whose defaults (`clock:attendance:branch`,
`create:customers:branch`, `login:staff:branch`) are all branch-scoped and inside what she already supervises; the
ADR states this, and a test proves the granted membership never exceeds the branch scope.

### 4.5 HTTP, admin and tests

- `staff/http/employee-access.controller.ts`: the routes of spec §6, `@Authenticated`, declared in
  `identity/http/authenticated-writes.ts` as record-scoped, behind the activation gate.
- Admin: an access section in the employee panel (`apps/admin/src/staff/ui/employee-record-sections.tsx`), a small
  form (phone, confirmation tick, role, PIN), mutation hook shaped like `api/use-set-employee-number.ts`. i18n keys
  under the staff catalog, Arabic and English.
- Tests: domain unit tests for the role table and the state rules; integration tests for every AC of spec §4 F1;
  crash-and-repeat after step 1, after step 2 and a failing step 3; a repeat of a successful request leaves the PIN
  hash and the outbox unchanged; two concurrent grants (one employee; one phone); a granter on her own record; RLS
  negative tests for `employee_staff_access`; the D8 tests of §4.3; a UI test asserting the visible states.
  Fixtures: `apps/api/src/modules/identity/__tests__/staff-pin.spec.ts` and `apps/api/test/harness.ts:187-213`.

## 5. G1 — invite a member

- Contract `packages/contracts/src/identity/member-invitation.ts`: input
  `{ email, name, role: enum of the four, scope: { type, id }, email_confirmed: z.literal(true) }` strict;
  response `{ invitation_id, set_password_link: string | null }`.
- **The confirmation is always required (D10).** The screen always shows the full email and asks for the tick
  before it posts, for a new and for an existing account alike; there is no lookup route and no 422 that tells the
  two apart. A `null` link after a success is the only signal that the account existed; that difference follows
  from IM-Q3 and IM-Q4 and is recorded as an accepted risk (spec §8). The route is rate-limited per owner in Redis
  and every call is audited.
- `identity/domain/invitable-roles.ts`: the table role → required scope type. Owner is absent by construction.
- New tenant table `member_invitations` (`(company_id, id)`, forced RLS, negative test): `email_hash`, `user_id`,
  `membership_id`, `role_code`, `scope_type`, `scope_id`, `invited_by`, `state` (`PENDING`, `ACTIVE`, `CANCELLED`),
  `link_issued_at`, `created_at`. No token, no link and no plain email are stored.
- Authority: `manage:memberships:company`, **and** the canonical owner (`canonicalOwnerSql`,
  `system-role-policy.ts:236`) with no covering DENY, read inside the write transaction. The target role and scope
  are validated against the real business or branch of this company. Self-invitation is refused.
- Use case `identity/use-cases/invite-member/`:
  1. tenant tx: authority; insert the invitation `PENDING` with its `operation_id`.
  2. auth: find the user by email, or create it with a credential account and the marker
     `invited_by_company_id` and `invitation_operation_id` (idempotent by operation id). A staff user's email is
     refused.
  3. tenant tx: no active membership of that user in the company; insert the membership; record `user_id` and
     `membership_id` on the invitation; `ACTIVE` at once for an existing account, `PENDING` for a created one;
     audit; outbox `MemberInvited`.
  4. for a created user: issue the link (48 hours, clock injected — `config.ts:208-214` uses `Date.now` today),
     stamp `link_issued_at`, return it once.
- **Recovery.** A crash after step 3 leaves a member who has no link. `POST /v1/memberships/invitations/:id/link`
  re-issues it: only for a `PENDING` invitation, only for the owner who created it, only while the user has never
  set a password; it invalidates every earlier `reset-password` verification row of that user first and never shows
  an old token. A company can issue a link only for a user whose `invited_by_company_id` is that company, so a
  second company can never issue a link for the same account. The invitation becomes `ACTIVE` when the password is
  set (checked lazily on the next read of the invitation list).
- Lifetime: `issuePasswordSetLink` takes a lifetime and a clock; the default stays one hour and the `TODO(spec)` at
  `config.ts:51-52` is resolved by pointing to IM-Q3.
- `redirectTo` of the link: `<admin origin>/set-password`, the page of PR #1252 (`feat/admin-set-password-page`,
  head c225a7050; `apps/admin/app/set-password/page.tsx`). A valid link redirects to `<callbackURL>?token=<token>`,
  an invalid, expired or used one to `<callbackURL>?error=INVALID_TOKEN`; the page completes with
  `POST /v1/auth/reset-password {token,newPassword}` and does not sign the user in. G1 builds on it after it merges
  and repeats none of it.
- Admin: page under `apps/admin/src/permissions/` behind the existing `invitations` nav entry, switched to live and
  to the owner only; the link is shown once with a copy button and is not kept in any client cache.
- Tests: every AC of spec §4 G1; a general manager, a branch manager and an owner with a DENY override → 403;
  self-invite; a foreign business or branch as scope; two owners inviting the same email concurrently; the
  re-issue rules (other owner, after the password was set, old link dead); a second company cannot issue a link
  for the same account; a log-capture test that neither link nor token is logged; lifetime with an injected clock.

## 6. F2 — PIN change by proof, branch-scoped reset, owner notice

- `identity/domain/staff-pin-state.ts`: pure rule `pinState(row, now)` → `USABLE | CHANGE_REQUIRED | EXPIRED`.
- **No staff session for a temporary PIN (FR-F2-2).** `sign-in-staff-pin` with a temporary PIN that matches returns
  `PIN_CHANGE_REQUIRED` and a **proof**: random, stored as a hash, valid a few minutes, bound to the device, the
  company, the user and the PIN revision, consumed atomically by one `UPDATE … WHERE` on
  `POST /v1/devices/me/staff-pin/change`. The comparison and the lockout of `domain/cashier-pin.ts` (five
  failures, fifteen minutes) run first and are unchanged; `PIN_EXPIRED` is answered only after a correct PIN, so an
  expired state is never revealed to a guess. Tests: replay of a proof, two concurrent changes, a proof after a
  reset, expiry with an injected clock, lockout during the change.
- **Branch-scoped reset (DV-Q5).** Today `POST /v1/staff-pins/reset` is owner-only and accepts any member
  (`staff-pin.controller.ts:73-74`, `reset-staff-pin.ts:22-25`). Add
  `POST /v1/businesses/:businessId/employees/:employeeId/staff-access/pin` under `manage:staff-access:branch` on the
  employee's primary branch: it resets only the PIN of the user in that employee's access record, never the
  granter's own and never a non-staff user. The PIN is temporary.
- POS screen in the staff sign-in flow: «اختاري رقم سري جديد», two entries, online only.
- Owner notice: events `StaffAccessGranted` and `StaffPinSetByOther` (identity `events/published.ts`), a worker
  consumer in the notifications path and one in-app template; recipients = active owner memberships; one notice
  per event id (a repeated request emits nothing, §4.2). Follow `request-low-rating-notice` for structure.

## 7. F3 and G2

- **Phone change** is a resumable operation on the access record: tenant tx sets `PHONE_CHANGING` and clears the
  PIN first (sign-in is refused in that state, and eligibility reads the record); auth sets the new phone in one
  transaction for a staff user of this company only, deleting `STAFF_POS` and `STAFF_PERSONAL` sessions
  (`personal-session.guard.ts:18-22`); tenant tx saves a new temporary PIN and returns to `ACTIVE`. A crash
  anywhere leaves `PHONE_CHANGING`, which the same request finishes. A staff user cannot hold a membership in
  another company at all (§2 item 5), so D2's condition holds by construction.
- **Stop access:** identity `endStaffMembership(tx, { membershipId })` sets `ends_at`, clears the PIN, audits; the
  record becomes `STOPPED`; both kinds of staff session are deleted through auth after commit, and each also fails
  the eligibility check on its next request (`shared/session.guard.ts:194-201`).
- **Branch follow:** inside `staff/persistence/drizzle-employee-update.ts`'s transaction, when `primary_branch_id`
  changes for an employee whose record is `ACTIVE`: end the old membership and insert one with the same role on the
  new branch, updating the record. **Overrides are not carried over** (`identity-access.ts:190,206`): an ALLOW or a
  DENY on the old membership ends with it. Reason: an override was granted for a branch; carrying an ALLOW would
  widen it, and a DENY belongs to the branch that set it. A test covers both.
- **G2 end membership:** canonical owner inside the write transaction; typed `LAST_OWNER` on top of the trigger of
  migration `0013`; two owners ending each other concurrently leave one; grant cache invalidated. The member's
  password sessions are not deleted globally: his next ordinary request to this company is refused by the
  membership check, and his other companies keep working. A test ends a membership and checks a second company.

## 8. Open items for the implementer briefs

1. (Resolved 2026-11-23) PR-D's set-password route and `callbackURL`: see §5.
2. (Resolved by the debate) F2 uses a short-lived proof, never a marked session.
3. (Resolved by the debate) a staff user is told by `staff_access_company_id` and `staff_access_operation_id`.

## 9. Debate findings and where they are answered

| Finding (Astra, 334c1a35d) | Answer |
|---|---|
| P1 adoption by phone rewrites the company-wide PIN for another employee | §4.2: adoption removed; access record, membership addressed by id, no PIN rewrite on repeat, link changes closed |
| P1 crash between user creation and binding; discard races resume; email from the phone | §4.2 step 2 atomic on auth, `operation_id`, no discard by session, email from the operation |
| P1 the company marker does not prove D2; phone change before the PIN is cleared | §2 item 5, §4.4, §7 phone change |
| P1 invitation leaves a member without a link | §5 pending invitation, re-issue, injected clock |
| P1 F1 ships a permanent PIN; old readers | §1.1 gate, temporary from F1, both readers, floor |
| P1 staff session for a temporary PIN; owner-only reset | §6 proof; branch-scoped reset |
| P1 two refused HTTP paths do not give D8 | §4.3 every credential path, by the marker |
| P1 the staff → identity write is an exception | §2 item 2, §3 decision 4 |
| P1 canonical owner in the write transaction; session revocation; overrides on move | §5 authority, §7 |
| P2 responses reveal that an email exists | §5 always-confirm, rate limit, accepted risk |
