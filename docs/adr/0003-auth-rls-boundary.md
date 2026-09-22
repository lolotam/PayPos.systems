# ADR-0003 — The auth ↔ RLS boundary

- **Status:** Proposed — awaiting Waleed's approval (P0-T0 "done when")
- **Date:** 2026-09-22
- **Task:** Phase 0 · T0 (`docs/specs/phase-0/IMPLEMENTATION-PLAN.md` v3, `docs/PRD.md` P0-T0.1 – P0-T0.8)
- **Blocks:** T4 (roles), T5 (first migration), T9a (identity)

## 0. بالعربي — القرار في صفحة

كل جدول عليه قفل (RLS) بيقول "متوريش غير بيانات الشركة بتاعتك". المشكلة إن وقت الـ login السيستم لسه ميعرفش إنت تبع أنهي شركة، ولو القفل ده على جدول المستخدمين، محدش هيعرف يدخل.

الحل: **3 أنواع جداول**.
- **هوية عامة** (المستخدم، الـ session، الباسورد): من غير قفل الشركة، وليها مستخدم database خاص صلاحياته على الجداول دي بس.
- **الجسر** (`memberships`): قفل على المستخدم نفسه — كل واحد يشوف عضوياته هو بس.
- **بيانات الشركة** (كل حاجة تانية): قفل على الشركة زي ما هو.

وتلات قرارات: الصلاحيات مكانها جدول `memberships` بتاعنا بس (مش plugin الـ organization)، الممنوع (DENY) يكسب دايماً، والشركة وصاحبها يتعملوا في نفس الـ transaction.

---

## 1. Context

`CLAUDE.md` §5 says every DB access goes through `withTenant(companyId, …)`, which sets `app.company_id`, and every tenant table carries an RLS policy on it. Three facts break that rule for authentication:

1. **Login happens before a tenant is known.** Sign-in, session lookup, email verification and password reset run before the server knows — or may trust — any company id.
2. **A user belongs to several companies.** One `company_id` on a user or session row misrepresents that relationship.
3. **Better Auth's adapter does not join our transaction.** Wrapping a request in `withTenant()` does not make Better Auth's own queries run inside it; they use their own connection and see no `app.company_id`.

Scheduling cannot fix this (Codex review of plan v1, finding #1). It is a schema decision, so it is made before the first migration.

## 2. Decision — table classification

Every table falls in exactly one of four groups. A new table is classified in the PR that creates it.

### 2.1 Global identity — no `company_id`, no tenant RLS

Owned by Better Auth and reached **only** through `packages/auth`, on the dedicated `pospay_auth` role (§3).

| Table | Created by | Notes |
|---|---|---|
| `user` | core | + `two_factor_enabled` (two-factor), `phone_number`, `phone_number_verified` (phone-number, when enabled) |
| `session` | core | + `active_company_id` — a *hint* only, re-verified on every request (§4) |
| `account` | core | password hash lives here; never selected by any module |
| `verification` | core | email / reset tokens |
| `two_factor` | `two-factor` plugin | TOTP secret + backup codes, encrypted at rest |
| `apikey` | `api-key` plugin | installed in T9b, wired in Phase 5; **each key row carries a `company_id` in its metadata and is resolved to a membership-equivalent principal** — an API key never bypasses tenant resolution |

**Not enabled:** the `organization` plugin. Its `organization`, `member` and `invitation` tables are not created. See §5.1.

### 2.2 The bridge — RLS keyed on the user, and on the company for administrators

| Table | Policy |
|---|---|
| `memberships` | `USING (user_id = current_setting('app.user_id', true)::uuid OR company_id = current_setting('app.company_id', true)::uuid)` — `WITH CHECK (company_id = current_setting('app.company_id', true)::uuid)` |
| `permission_overrides` | same shape as `memberships` (it hangs off a membership) |

- The **user branch** lets a just-authenticated user list their own companies (via `withUser()`, §3) without already having a company.
- The **company branch** lets an owner or manager administer the memberships of *their* company inside `withTenant()`. Whether they may is decided by the guard (`manage:memberships:company`), not by RLS.
- Writes are always company-scoped: nobody inserts a membership into another company, including their own row.

### 2.3 Global reference data — no RLS, read-only for the app

| Table | Notes |
|---|---|
| `plans` | platform-level (Phase 0 T5.3) |
| `permissions` | the catalogue of `action:resource:scope` strings, **seeded from code** on migrate |
| `roles` | system roles have `company_id IS NULL`. Custom company roles (Phase 1+) set `company_id` and follow §2.4; the policy is `USING (company_id IS NULL OR company_id = current_setting('app.company_id', true)::uuid)`, `WITH CHECK (company_id = current_setting('app.company_id', true)::uuid)` |
| `role_permissions` | follows its role |

`pospay_app` has `SELECT` only on the system rows; it cannot modify a plan, a permission, or a system role.

### 2.4 Tenant data — everything else

Unchanged from `CLAUDE.md` §5: `company_id uuid NOT NULL`, `USING` **and** an explicit `WITH CHECK` on `company_id`, `FORCE ROW LEVEL SECURITY`, tenant-qualified composite foreign keys, reached only through `withTenant()`.

## 3. Database roles and the two wrappers

| Role | Attributes | May touch | Used by |
|---|---|---|---|
| `pospay_owner` | owns every table, runs migrations | everything | `pnpm db:migrate` only — never a running container |
| `pospay_app` | `NOSUPERUSER`, `NOBYPASSRLS`, `NOINHERIT`, owns nothing | tenant + bridge tables under RLS; `SELECT` on §2.3 | `api`, `worker` |
| `pospay_auth` | `NOSUPERUSER`, `NOBYPASSRLS`, owns nothing | **only** the §2.1 tables, table-level grants | `packages/auth` |

No role has `BYPASSRLS`. The platform bypass role stays deferred (review finding #14).

`packages/db` exports exactly two entry points, both transaction-local (`set_config(…, true)`):

```ts
withTenant(companyId, fn, { userId? })  // sets app.company_id (+ app.user_id when a user is acting;
                                        // webhooks and jobs have none)
withUser(userId, fn)                    // sets app.user_id only — for listing one's own memberships
```

`packages/auth` holds its own pool on `pospay_auth`. No other package can import it (`no-restricted-imports`).

## 4. Request flow and the principal contract

```
request ─► packages/auth: verify session / device token / API key      (pospay_auth, global)
        ─► withUser(userId): load the user's active memberships          (bridge, user branch)
        ─► pick the requested company (header or session hint)
        ─► REFUSE unless one of those memberships is for that company    ← before any tenant query
        ─► withTenant(companyId, fn, { userId }): every business query        (tenant RLS)
```

The resolved principal, defined in `packages/auth/src/principal.ts` (T9a):

```ts
type Principal = {
  kind: 'user' | 'device' | 'api-key';
  userId: string | null;          // null for a device before a cashier PIN is entered
  employeeId: string | null;      // set after a PIN, see §4.2
  companyId: string;              // verified against memberships, never taken from the client
  memberships: MembershipScope[]; // COMPANY | BUSINESS | BRANCH + scope_id, active window only
  deviceId: string | null;
};
```

### 4.1 Rules

- **Company switching.** The client may *ask* for any company id. The server honours it only if the user has an active membership in it; otherwise 403 before `withTenant()` is called. `session.active_company_id` is a convenience hint and is re-checked on every request. (T8 proves this with a spy on `withTenant`.)
- **Membership removal** takes effect on the next request: memberships are read per request, and the permission cache in Redis is invalidated on every membership or override change.
- **Membership window.** `starts_at` / `ends_at` are enforced in the query, not in a nightly job.
- **Device revocation** is rejected on the next contact; a revoked device's unsynced sales are quarantined, never discarded (PRD §8.4).

### 4.2 `employee_ref`

`cashier_pins.employee_ref` points at `staff.employees(id)` once `staff` exists (Phase 1), with a tenant-qualified FK `(company_id, employee_id)`. Until then it is a nullable `employee_id` with no FK, and T9b does not issue PINs to anything but test fixtures. An employee **may** be linked to a `user` (`module-map.md`: `staff → identity`), but a PIN never opens `app.`; it only identifies who is operating an already-approved device.

## 5. Decisions on authority

### 5.1 One authorization authority: our `memberships`

Better Auth's `organization` plugin models the same thing as our `memberships` table. Two authorities disagree sooner or later, and the disagreement is a security bug. **`memberships` + `roles` + `permission_overrides` own authorization.** The `organization` plugin is not installed. Better Auth only answers "who is this?" — never "what may they do?".

### 5.2 DENY wins (PRD D-31)

A user's effective permissions are the union of every applicable, active membership's role permissions, minus every applicable DENY override. **Any applicable DENY wins**, at any scope, over any ALLOW. Deny by default when nothing matches.

### 5.3 First-owner bootstrap — `identity` `onboard-company`

A company must never exist without an owner, and `tenancy` must not write into `identity` (not an allowed arrow).

- `onboard-company` is a use case in `identity` (`identity → tenancy` is allowed by `module-map.md`).
- It calls a **tenancy port** to insert the company, then inserts the owner membership, then appends `CompanyCreated` to the outbox — all in **one** transaction.
- **Last-owner protection:** removing or demoting the last active owner of a company is refused.
- Memberships are administered afterwards only through `identity` use cases guarded by `manage:memberships:company`, and every change writes an `AuditLog` row.

## 6. Public routes

Controller guard scanning cannot see routes mounted by Better Auth's handler, so they are listed here and in `apps/api/src/auth/public-routes.ts`. CI fails if a route is neither guarded nor in this list.

| Route | Why public |
|---|---|
| `POST /v1/auth/sign-in/email` | login |
| `POST /v1/auth/sign-out` | logout (own session only) |
| `GET  /v1/auth/get-session` | session probe |
| `POST /v1/auth/two-factor/verify-totp` | second factor |
| `POST /v1/auth/forget-password` · `POST /v1/auth/reset-password` | recovery |
| `GET  /v1/auth/verify-email` | email verification |
| `POST /v1/devices/pair` | device pairing with a short-lived code (T9b) |
| `POST /v1/webhooks/*` | signature-verified, tenant resolved from the payload (`CLAUDE.md` §6) |
| `GET  /health` · `GET /ready` | probes |

Every public route is rate-limited in Redis. Sign-up is **not** public: companies are created by `onboard-company`, invited users by an invitation flow in T9a.

## 7. Consequences

- **`CLAUDE.md` §5 is amended** in the same PR: the "no fourth way to reach the DB" sentence names the auth path as the one exception, reachable only from `packages/auth` on `pospay_auth`.
- T4 creates the three roles and both wrappers; T5's isolation suite runs as `pospay_app` and additionally asserts `pospay_auth` cannot read any tenant table.
- T9a adds tests that `pospay_auth` sees no tenant table, `pospay_app` cannot read `account` or `two_factor`, a user lists only their own memberships under `withUser()`, and an owner lists their company's memberships under `withTenant()` but not another company's.
- Adding a Better Auth plugin later requires classifying its tables here first.
- Cost: two DB pools instead of one, and a per-request membership read (cached in Redis, invalidated on change).

## 8. Alternatives rejected

| Alternative | Why not |
|---|---|
| `BYPASSRLS` on the auth role | one leaked query path reads every tenant — the exact risk RLS exists to remove |
| `company_id` on `user` / `session` | a user belongs to several companies; the column would lie |
| Better Auth `organization` as the authority | two authorities for permissions (§5.1); its model has no BUSINESS/BRANCH scope |
| Auth in a separate database | cross-database consistency for `onboard-company` with no gain at this size |
| Per-MAU hosted auth (Clerk, Auth0) | rejected earlier on cost (~500k MAU at 50 KWD/shop) |
