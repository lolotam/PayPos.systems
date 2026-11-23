# 076 — Implementation plan

Spec: `spec.md`. Decisions: `owner-questions.ar.md`. Code facts below were read at `origin/main@aef577fd2`; an
implementer re-checks each path before relying on it.

## 1. Delivery

| PR | Content | Estimate (all changed hand-written lines) | Refuse above | Migration |
|---|---|---|---|---|
| F1 | give access | 1,500 (production 600, tests 750, screen and i18n 150) | 3,000 | permission seed, `user` column |
| G1 | invite a member | 800 | 1,600 | none |
| F2 | temporary PIN, owner notice | 900 | 1,800 | `cashier_pins` columns |
| F3 | change phone, stop access, follow branch | 700 | 1,400 | none |
| G2 | end a membership | 350 | 700 | none |

Order of merge: F1 → G1 → F2 → F3 → G2. F1 and G1 are built in parallel in separate worktrees by different
implementers; F2, F3 and G2 stack on F1. Each PR: implementer runs `clean-code-guard`, `test-guard` and
`waleed-security-reviewer`; one review; one fix round; `ci-gate` on the exact head. Migrations are numbered only
on the manager's word.

Files both F1 and G1 touch (resolve at the second merge; regenerate, never hand-merge generated files):
`packages/auth/src/index.ts`, `apps/api/src/modules/identity/identity.module.ts` and `index.ts`,
`apps/api/src/shared/errors.ts`, `packages/i18n/src/{ar,en}.ts`, `packages/contracts/src/index.ts`,
`packages/contracts/openapi/openapi.json`, the three `schema.d.ts`, `docs/module-map.md`.

## 2. Constraints every PR obeys

1. **Two database roles, no shared transaction.** `packages/auth` writes `user`, `account`, `verification`,
   `session` on `pospay_auth`; memberships, employees, PINs and the audit log are written on `pospay_app` inside
   `withTenant(companyId, tx => …, { userId: actor })`. Only `identity` imports `packages/auth`
   (`docs/module-map.md`). No new grant to `pospay_app` on identity tables and none to `pospay_auth` on tenant
   tables.
2. **Module direction.** `staff` may import `identity`'s `index.ts`; `identity` may not import `staff`. A use case
   that touches `employees` lives in `staff` and calls identity functions that take the caller's `tx`
   (existing pattern: `employeeUserLinkAvailable`, `lockEmployeeManagementAccess`).
   **Step 0 of F1:** add empty skeletons with the cross-module calls and run `pnpm module-map:check` and lint
   before writing logic; stop and report if the arrow is refused.
3. **Secrets.** A PIN, a full phone, a set-password link or its token never reach a log line, an audit row, an
   event payload, an error message or a test snapshot. Phones are logged as their last three digits.
4. **Server-decided authority.** Role codes and scopes come from a server-side table keyed by a closed enum in the
   request; request schemas are `.strict()`.
5. Project rules: Arabic JSDoc on `domain/`, `ports/`, `events/published.ts`; files ≤ 300 lines; no arithmetic or
   SQL in a use case; `Clock` and `IdGenerator` injected; typed errors from `packages/db`; RLS negative test for
   any new tenant table (none planned); every new route has a guard or a declared record-scoped check.

## 3. ADR

One new ADR, `docs/adr/00NN-staff-access-and-invitations.md` (number taken at F1's final step), merged with F1:

- context: the go-live gap and ADR-0003 §4 line «inviting users is a later deliverable (issue #19)»;
- decision 1: the cross-role sequence of §4.2 with its resume rules, instead of one transaction;
- decision 2 (amends ADR-0019 Q1): a tenant granter may confirm a phone only for a staff user created by this
  slice in the same company with no active membership elsewhere; a phone owned by anyone else is refused;
- decision 3 (amends ADR-0003 §4): `manage:staff-access:branch` (owner, branch manager) may create and end the
  staff membership of an employee of the covered branch, through identity functions only; invitations stay under
  `manage:memberships:company`;
- decision 4: the second synchronous cross-module write is avoided — `staff` owns the employee link and calls
  identity inside its transaction;
- consequences: the named risks of spec §8.

Addenda in the same PR: ADR-0019 (Q1 and addendum c point to this ADR), ADR-0003 line on issue #19.

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
  state: z.enum(['NONE', 'ACTIVE', 'STOPPED']),
  role: z.enum(['staff', 'reception']).nullable(),
  branch_id: id.nullable(),
  phone_last3: z.string().regex(/^\d{3}$/).nullable(),
  can_manage: z.boolean(),
})
```

`reception` maps to the system role `cashier`; the mapping is one server-side table in `identity/domain`. The
database check on `phone_number` allows 7–15 digits and the contract 8–15: the contract is the stricter rule and
stays.

### 4.2 Sequence and resume rules

`staff/use-cases/grant-employee-access/` orchestrates; it contains no SQL and no arithmetic.

| Step | Where | What | If it fails | On repeat |
|---|---|---|---|---|
| 1 | tenant tx (read) | load the employee (not deleted, in the business), her primary branch and `user_id`; identity decides `manage:staff-access:branch` on that branch | stop, nothing written | same |
| 2 | `packages/auth` | resolve the staff user for the phone: (a) phone owned by a user that is not a staff user of this company → refuse; (b) a staff user of this company already holds the phone → adopt it; (c) none → create the user with the synthetic email and `staff_access_company_id`, then approve the phone binding with the granter as actor | discard a user created in this call | (b) adopts the user left behind |
| 3 | tenant tx (write) | lock the company row; re-read the employee `FOR UPDATE` and re-check step 1; identity inserts the membership (role from the table, scope = primary branch); staff sets `employees.user_id` with `revision + 1`; identity saves the PIN; audit rows; outbox `StaffAccessGranted` | roll back; discard the user when it was created in this call | idempotent: an existing identical membership and link are kept |
| 4 | after commit | invalidate the grant cache for the company and membership | logged; the cache expires by itself | — |

Step 2 must be safe against two concurrent grants for one phone: the unique phone constraint decides, and the
loser re-reads and follows (a) or (b). The synthetic email is derived from the phone by the same rule the staging
script uses (`apps/api/scripts/staging-staff-user.ts:77-81`), under a reserved, non-deliverable domain.

### 4.3 `packages/auth` additions (the only place these may live)

- `provisionStaffUser(auth, { phone, name, companyId, actorUserId })` → `{ userId, created }`: steps (a)–(c);
  records the platform action with the tenant actor (today `recordPlatformAction` takes an operator string — add
  an actor form, do not fake an operator name).
- `discardStaffUser(auth, userId, companyId)`: deletes only a staff user of that company with no session.
- `approvePhoneBinding` today opens a pool per call and rejects an actor that is not an operator name: add a
  variant that runs on the service's existing pool and records a tenant user id as the confirming actor. The
  existing operator path is unchanged.
- Refuse a synthetic email in the password-reset and email sign-in paths (FR-F1-7), with a test for each.

### 4.4 Identity exports (take the caller's `tx`)

- `readStaffAccessAuthority(tx, { companyId, actorUserId, businessId, branchId, at })` → boolean.
- `grantStaffMembership(tx, { companyId, userId, branchId, role, ids })` → membership id; inserts as
  `packages/db/src/operator/staging-staff.ts:101-103` does, with the role from the table; audit `membership created`.
- `saveStaffPin(tx, { companyId, userId, pinHash, setBy, at })` reusing `staff-pin-transactions.ts`.
- `readStaffAccessState(tx, { companyId, userId })` for the GET route.

The permission is added to `packages/db/src/access-catalog.ts` and `role-defaults.ts` (owner, branch manager) and
seeded by a migration shaped like `0240_2026-11-22_ratings-read-permission.sql` (idempotent, expand only).
`system-role-policy.ts` must allow it for exactly those roles; add the catalog parity tests the ratings permission
has.

### 4.5 HTTP, admin and tests

- `staff/http/employee-access.controller.ts`: the two routes of spec §6, `@Authenticated`, declared in
  `identity/http/authenticated-writes.ts` as record-scoped.
- Admin: `apps/admin/src/staff/ui/` — an access section in the employee panel (`employee-record-sections.tsx`),
  a small form (phone, confirmation tick, role, PIN), mutation hook shaped like
  `api/use-set-employee-number.ts`. i18n keys under the staff catalog, Arabic and English.
- `update-employee`: stop accepting a change of `user_id` for an employee with staff access (FR-F1-8); the admin
  edit form keeps sending the current value.
- Tests: domain unit tests for the role table and the access-state rule; integration tests for every AC of spec
  §4 F1, including AC-F1-6 with an injected failure after step 2; an RLS negative test for the membership; a UI
  test that asserts the visible states (button hidden without permission, refused message, success state).
  Fixtures: `apps/api/src/modules/identity/__tests__/staff-pin.spec.ts` and `apps/api/test/harness.ts:187-213`.

## 5. G1 — invite a member

- Contract `packages/contracts/src/identity/member-invitation.ts`:
  `{ email, name, role: enum of the four, scope: { type, id } , existing_account_confirmed?: true }` strict;
  response `{ outcome: 'CREATED' | 'ADDED', set_password_link?: string }`.
- `identity/domain/invitable-roles.ts`: the table role → required scope type (company, business, branch). Owner is
  absent by construction.
- `packages/auth`: `findUserIdByEmail` (internal to identity's use), `provisionMemberUser` reusing
  `createPlatformUser`'s steps with a tenant actor, and a **lifetime parameter** for `issuePasswordSetLink`
  (default stays one hour; the invitation passes 48 hours). Resolve the `TODO(spec)` at `config.ts:51-52` by
  pointing to IM-Q3.
- Use case `identity/use-cases/invite-member/`: (1) authority; (2) resolve or create the user; (3) tenant tx:
  scope exists in the company, no active membership of that user, insert membership, audit, outbox
  `MemberInvited`; (4) issue the link only for a created user and only after step 3 committed; (5) invalidate the
  grant cache. A created user whose step 3 failed is discarded.
- The existing-account path requires `existing_account_confirmed: true`; without it the API answers 422
  `MEMBER_EXISTING_ACCOUNT_UNCONFIRMED` carrying nothing but the code, and the screen shows the full email for
  confirmation (D10).
- `redirectTo` of the link: the set-password page of PR-D (`feat/admin-set-password-page`); take the route from
  that branch when the manager sends its head. Until then use `${adminOrigin}/set-password`, the default of
  `packages/auth/scripts/create-user.ts:34-35`.
- Admin: page under `apps/admin/src/permissions/` behind the existing `invitations` nav entry, switched to live
  and to the owner only; the link is shown once with a copy button and is not kept in any client cache
  (`gcTime: 0`, cleared on leave).
- Tests: every AC of spec §4 G1; a log-capture test for AC-G1-6; link lifetime with an injected clock.

## 6. F2 — temporary PIN and owner notice

- Migration: `cashier_pins.temporary`, `cashier_pins.expires_at` (expand only).
- `identity/domain/staff-pin-state.ts`: pure rule `pinState(row, now)` → `USABLE | CHANGE_REQUIRED | EXPIRED`.
- `reset-staff-pin` and F1's `saveStaffPin` mark the PIN temporary with `expires_at = now + 24h` whenever
  `set_by` is not the holder.
- `sign-in-staff-pin`: a temporary PIN that matches issues a session limited to the PIN-change route (reuse the
  staff session with a `pin_change_required` mark checked by the session guard), or no session and a short-lived
  proof — the implementer proposes the smaller of the two in the brief answer before coding.
- New route `POST /v1/devices/me/staff-pin/change`; POS screen in `apps/pos/src/personal-staff/` or the staff
  sign-in flow: «اختاري رقم سري جديد», two entries, online only.
- Owner notice: events `StaffAccessGranted` and `StaffPinSetByOther` (identity `events/published.ts`), a worker
  consumer in the notifications path and one in-app template; recipients = active owner memberships of the
  company. Follow the low-rating notice (`request-low-rating-notice`) for structure.

## 7. F3 and G2

- F3 phone change: `packages/auth` `changeStaffPhone` enforcing D2 on the auth role; tenant tx clears the PIN and
  audits; staff sessions end (`otpApprovePhone` already deletes them).
- F3 stop access: identity `endStaffMembership(tx, …)` sets `ends_at`, clears the PIN, audits; sessions fail the
  eligibility check on their next request (`shared/session.guard.ts:194-201`) and are also deleted.
- F3 branch follow: inside `staff/persistence/drizzle-employee-update.ts`'s transaction call identity
  `moveStaffMembership(tx, …)` when `primary_branch_id` changes and the employee has staff access.
- G2: `identity/use-cases/end-membership/`; typed error for the last owner on top of the trigger of migration
  `0013`; grant cache invalidation.

## 8. Open items for the implementer briefs

1. PR-D's set-password route and `callbackURL` (manager sends the head).
2. F2's choice between a marked session and a short-lived proof.
3. Whether `user.staff_access_company_id` is enough to tell a staff user, or a boolean plus the company is
   clearer; decide in F1's step 0 and state it in the ADR.
