# ADR-0003 — The auth ↔ RLS boundary

- **Status:** Accepted — approved by Waleed on 2026-09-23 (P0-T0 done)
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
| `platform_grants` | ours | global permissions not tied to a company, today only `create:companies:platform` (§3) |
| `platform_audit_log` | ours | audit trail for platform grants and revocations; insert-only, no updates or deletes (§3) |
| `apikey` | `api-key` plugin | installed in T9b, wired in Phase 5; carries a non-updatable **`company_id` column** and its own scopes (§4 path C) — an API key never bypasses tenant resolution |

**Not enabled:** the `organization` plugin. Its `organization`, `member` and `invitation` tables are not created. See §5.1.

### 2.2 The bridge — RLS keyed on the user, and on the company for administrators

**Every policy in this repository reads the context through two SQL helpers**, never through a raw cast. On a pooled connection a transaction-local setting that was set earlier survives as an empty string, and `''::uuid` raises `22P02` instead of matching nothing:

```sql
CREATE FUNCTION app_company_id() RETURNS uuid LANGUAGE sql STABLE SET search_path = pg_catalog
  AS $$ SELECT NULLIF(current_setting('app.company_id', true), '')::uuid $$;
CREATE FUNCTION app_user_id() RETURNS uuid LANGUAGE sql STABLE SET search_path = pg_catalog
  AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;
```

Both are `SECURITY INVOKER` (the default). In addition, **every wrapper sets both settings on every call** — the one they do not use is set to `''` — so no transaction inherits a value from the previous one.

Policies are **split by command**. A combined `FOR ALL` policy is wrong here: `DELETE` never evaluates `WITH CHECK`, and an `UPDATE` could reach a row that is only visible through the user branch.

| Table | `FOR SELECT` | `FOR INSERT / UPDATE / DELETE` |
|---|---|---|
| `memberships` | `USING (user_id = app_user_id() OR company_id = app_company_id())` | `USING (company_id = app_company_id())` `WITH CHECK (company_id = app_company_id())` |
| `permission_overrides` | same as `memberships` | same as `memberships` |

- The **user branch** lets a just-authenticated user list their own companies (via `withUser()`, §3) without already having a company.
- The **company branch** lets an owner or manager administer the memberships of *their* company inside `withTenant()`. Whether they may is decided by the guard (`manage:memberships:company`), not by RLS.
- Writes are always company-scoped: nobody inserts, changes or deletes a membership outside the current company — not even their own membership in another company, which the SELECT policy lets them *see*.

### 2.3 Global reference data — no RLS, read-only for the app

| Table | Notes |
|---|---|
| `plans` | platform-level (Phase 0 T5.3) |
| `permissions` | the catalogue of `action:resource:scope` strings, **seeded from code** on migrate |
| `roles` | system roles have `company_id IS NULL`; custom company roles (Phase 1+) set `company_id` |
| `role_permissions` | carries its role's `owner_key` (below) and `company_id` |

**Referencing a role safely.** A membership must point at a role that is either global or belongs to the membership's own company. A plain `role_id` FK allows another tenant's custom role; a composite FK on the nullable `company_id` is skipped by PostgreSQL whenever a column is `NULL` (`MATCH SIMPLE`), so it proves nothing for global roles. Instead every role has a non-null key that names its owner:

```sql
-- roles
owner_key text GENERATED ALWAYS AS (COALESCE(company_id::text, 'global')) STORED,
UNIQUE (id, owner_key)

-- memberships
role_owner_key text NOT NULL,
FOREIGN KEY (role_id, role_owner_key) REFERENCES roles (id, owner_key),
CHECK (role_owner_key = 'global' OR role_owner_key = company_id::text)

-- role_permissions — stricter: a row belongs to exactly its role's owner
role_owner_key text NOT NULL,
FOREIGN KEY (role_id, role_owner_key) REFERENCES roles (id, owner_key),
CHECK (role_owner_key = COALESCE(company_id::text, 'global'))
```

A membership may *use* a global role; a tenant may never *extend* one. On `role_permissions` a row with `company_id = <tenant>` must point at a role owned by that tenant, and only rows with `company_id IS NULL` — which the mutation policy never lets a tenant write — may point at a global role. So the pre-PIN `Device` role cannot gain a money-moving permission inside one tenant.

Both columns are `NOT NULL`, so the FK is always checked; the FK forces `role_owner_key` to be the role's real owner; the `CHECK` then allows only a global role or a role of the same company. The first owner's membership in `onboard-company` references the global Owner role with `role_owner_key = 'global'`. T5 adds a negative test assigning another company's custom role.

`plans` and `permissions` have no RLS, and `pospay_app` has `SELECT` only. `roles` and `role_permissions` mix global and company rows, so they get **split** policies:

| Table | `FOR SELECT` | `FOR INSERT / UPDATE / DELETE` |
|---|---|---|
| `roles`, `role_permissions` | `USING (company_id IS NULL OR company_id = app_company_id())` | `USING (company_id = app_company_id())` `WITH CHECK (company_id = app_company_id())` |

A system row has `company_id IS NULL`, so it never satisfies the mutation policy: a tenant can read it but cannot update it, re-home it into its own company, or delete it. T5 adds a negative test for each of the three.

### 2.4 Tenant data — everything else

**The tenant root.** `companies` has **no** `company_id` column: its `id` *is* the tenant key. Its policies are `FOR SELECT USING (id = app_company_id())` and `FOR INSERT / UPDATE WITH CHECK (id = app_company_id())`, with no `DELETE` grant (companies are closed, never deleted). Every child table's `company_id` references `companies(id)`. This leaves no second column that could disagree with the first.

Every other tenant table is unchanged from `CLAUDE.md` §5: `company_id uuid NOT NULL`, `USING` **and** an explicit `WITH CHECK` on `company_id`, `FORCE ROW LEVEL SECURITY`, tenant-qualified composite foreign keys, reached only through `withTenant()`.

## 3. Database roles and the three wrappers

| Role | Attributes | May touch | Used by |
|---|---|---|---|
| `pospay_owner` | owns every table, runs migrations | everything | `pnpm db:migrate` only — never a running container |
| `pospay_app` | `NOSUPERUSER`, `NOBYPASSRLS`, `NOINHERIT`, owns nothing | tenant + bridge tables under RLS; `SELECT` on `plans` and `permissions`; `SELECT, INSERT, UPDATE, DELETE` on `roles` and `role_permissions` (the split policies in §2.3 decide which rows) | `api`, `worker` |
| `pospay_auth` | `NOSUPERUSER`, `NOBYPASSRLS`, owns nothing | **only** the §2.1 tables, table-level grants | `packages/auth` |
| `pospay_dispatcher` (added 2026-09-23, T7b) | `NOSUPERUSER`, `NOBYPASSRLS`, `NOINHERIT`, owns nothing, member of nothing | **only** `outbox`: `SELECT`, and `UPDATE` of `published_at`, `attempts`, `last_error`, `next_attempt_at`, `parked_at`; plus `EXECUTE` on the one `SECURITY DEFINER` sweep of expired idempotency keys (T7b) | the outbox dispatcher in `apps/worker`, through its own pool |

No **runtime** role has `BYPASSRLS`. The platform bypass role stays deferred (review finding #14).

**Bootstrap-owner exception (2026-09-23).** In the compose image `pospay_owner` is the bootstrap superuser, so it
has `BYPASSRLS`. It runs migrations only and never serves a request; `packages/db` refuses any superuser or
`BYPASSRLS` connection at runtime, and the "no `BYPASSRLS`" assertions cover the runtime roles.

**`pospay_dispatcher` — the one cross-tenant reader (2026-09-23).** `pospay_app` needs a tenant to read anything, so
it cannot drain every company's outbox. The dispatcher role can, on `outbox` **only**:
- RLS stays forced on `outbox`. Its policies are role-scoped — `FOR SELECT TO pospay_dispatcher USING (true)` and
  `FOR UPDATE TO pospay_dispatcher USING (true) WITH CHECK (true)` — the one documented exception to the rule that
  every policy reads context through `app_company_id()` / `app_user_id()`.
- Column grants make `id` (the event id), `company_id` and `payload` immutable to it.
- It is reached only through a restricted facade in `packages/db` (`createOutboxDispatcherDatabase`) wired by
  `apps/worker`, never from an HTTP handler, and no membership or `PUBLIC` path lets another role acquire it.
- Schema access: an explicit `GRANT USAGE ON SCHEMA public`; `CONNECT` through the database's default `PUBLIC`
  grant. Both belong to the reviewed privilege inventory (plan T5). Handlers apply each event's effect as `pospay_app` inside
  `withTenant(event.company_id)`.
- T7b tests: it reads `outbox` across tenants and nothing else, cannot change the immutable columns, and no
  application role can assume it.

`packages/db` exports `createDatabase({ url, ids })`, which returns exactly three entry points — all transaction-local
(`set_config(…, true)`) — plus `close()`; the underlying client never leaves the package:

```ts
withTenant(companyId, fn, { userId? })  // sets app.company_id (+ app.user_id when a user is acting;
                                        // webhooks and jobs have none)
withUser(userId, fn)                    // sets app.user_id only — for listing one's own memberships
withNewTenant(userId, company, fn)      // bootstrap only — see below
```

**`withNewTenant` — the onboarding bootstrap.** A new company has no membership yet, so path A (§4) would refuse it, yet the company row and the first membership are RLS-protected writes. `withNewTenant`:

1. generates the company id itself with `IdGenerator` — the caller cannot pass one in;
2. opens a transaction, sets `app.user_id` = the authenticated caller and `app.company_id` = the new id;
3. runs `fn(tx, companyId)` and commits. It does **no** business writes itself: it is context setup only, so `packages/db` knows nothing about tenancy.

Inside `fn`, `onboard-company` performs, in this order:

1. **claim the idempotency key in the `USER` scope** (caller's user id + operation + key) with `INSERT … ON CONFLICT DO NOTHING`, inside the same transaction. A replay finds the completed record and returns the stored response. A concurrent duplicate **waits** on the uncommitted key, then replays the first request's response — or proceeds as the first if that one rolled back; a lock timeout while waiting returns a retryable `409`. There is no persisted `IN_FLIGHT` state (amended 2026-09-23, plan v4 T7). Nothing else has been written yet, so neither can create a second company;
2. `CompanyRegistry.register(tx, company)` — the only insert of the company row;
3. owner membership, `AuditLog` row, `CompanyCreated` outbox event, and the completed idempotency record.

Because the id is generated inside the wrapper and never accepted from outside, `withNewTenant` can only ever address a company that does not exist yet; it cannot be used to enter an existing tenant. It is importable only from `identity`'s `onboard-company` (`no-restricted-imports`).

**Who may call it — platform grants.** Memberships authorize work *inside* a company; creating a company happens before any membership exists, so it needs a grant that is not tied to a company:

| Table | Group | Columns | Access |
|---|---|---|---|
| `platform_grants` | global identity (§2.1) | `user_id`, `permission` (e.g. `create:companies:platform`), `granted_by`, `granted_at`, `expires_at`, `revoked_at` | read by `pospay_auth` only; written only by `pnpm platform:grant` run as `pospay_owner` — no API writes it in Phase 0 |

- The guard `@RequirePlatform('create:companies:platform')` reads `principal.grants` (§4), which path A fills from the user's active platform grants.
- **Users and grants in Phase 0** are created by two audited operator scripts (plan v4 T9a-3): `platform:create-user` creates a user through Better Auth's server API in `packages/auth` and issues a one-time set-password link; `platform:grant` grants a platform permission. Both write `platform_audit_log`; neither is reachable through the API. Every grant and revocation writes a row to **`platform_audit_log`** — a global table (no `company_id`, no RLS), insert-only for `pospay_owner` and `pospay_auth`, readable only by the owner. `AuditLog` is tenant data and would force the script to invent a company, so platform actions never go there.
- This is the **Phase 0** answer. Whether merchants may later onboard themselves is PRD **D-34**; if they may, a self-serve route gets its own grant and rate limit — it does not reopen this one.
- The `Platform` module and its UI still arrive in Phase 5; T9a ships only the table, the script, the guard and the one permission.

`packages/auth` holds its own pool on `pospay_auth`. No other package can import it (`no-restricted-imports`).

## 4. Request flow and the principal contract

There are **three** credential types, and each binds to a tenant differently. All three end at the same place — a verified `companyId` — and nothing reaches `withTenant()` for business work before that verification.

**A. User session** (admin app, platform):

```
verify session cookie                          packages/auth · pospay_auth · global
─► withUser(userId): active memberships        bridge · user branch
─► requested company (header or session hint)
─► REFUSE unless a membership covers it        ← before any tenant query
─► withTenant(companyId, fn, { userId })       tenant RLS
```

**B. Device token** (POS). A device belongs to exactly one branch of one company, and `devices` is tenant data. The token therefore **names** its tenant and is **proven** inside it:

```
token = pd_<companyId>.<deviceId>.<secret>     issued once by approve-device, stored hashed
─► parse companyId, deviceId                   no DB access yet
─► withTenant(companyId, fn)                   tenant RLS
     load devices WHERE id = deviceId          0 rows if the companyId was forged
     constant-time compare hash(secret) with token_hash; status must be ACTIVE
─► REFUSE on any mismatch — one error for every case, so it is not an oracle
```

A forged `companyId` finds no row, because RLS hides every other company's devices.

**Authorization on a device** has two stages:

1. **Device only** (before a PIN): the principal carries the device's own fixed permission set — the system role `Device` (sync, read the catalog snapshot, register a clock-in). Nothing that moves money.
2. **Device + PIN**: `verify-cashier-pin` resolves an `employeeId`, and the principal takes that employee's **memberships**, filtered to scopes that cover the device's branch. A membership row names **exactly one** holder: `CHECK (num_nonnulls(user_id, employee_id) = 1)`. Employee memberships are ordinary memberships — same roles, same overrides, same DENY-wins rule (§5.2) — so the guard has one code path. If the employee is also linked to a `user`, the user's own memberships are **not** added: a PIN proves who is at the till, not who owns the login.

A PIN never adds a `userId` and never opens `app.`.

**Offline.** While the POS is offline, `verify-cashier-pin` cannot reach the server, and a queued action carrying only `deviceId` and `employeeId` does not prove a PIN was entered. Until the offline operator credential is designed in P2-T9 (device-signed, short-lived, revocable), the server **quarantines** every synced money-moving action that lacks one: it is stored, never applied, and surfaced to a manager. It is never trusted on the device's word and never silently discarded.

**C. API key** (Phase 5 public API). `apikey` is global identity (§2.1), so it is resolved on `pospay_auth`, but it carries a **`company_id` column** — not free-form metadata — fixed at creation and never updatable:

```
verify key hash                                packages/auth · pospay_auth · global
─► companyId = apikey.company_id, scopes from the key
─► withTenant(companyId, fn)                   tenant RLS; the guard checks the key's scopes, not memberships
```

`withUser()` is used by path A only.

The resolved principal, defined in `packages/auth/src/principal.ts` (T9a):

```ts
type Principal = {
  kind: 'user' | 'device' | 'api-key';
  userId: string | null;          // null for a device before a cashier PIN is entered
  employeeId: string | null;      // set after a PIN, see §4.2
  companyId: string | null;       // verified, never taken from the client; null only before onboarding
  deviceId: string | null;
  memberships: MembershipScope[]; // COMPANY | BUSINESS | BRANCH + scope_id, active window only
  grants: Grant[];                // what the guard actually evaluates — see below
};

type Grant = {
  permission: string;             // 'action:resource:scope'
  effect: 'ALLOW' | 'DENY';       // DENY entries are kept, never pre-subtracted
  source: 'role' | 'override' | 'device' | 'api-key' | 'platform';
  scopeType: 'PLATFORM' | 'COMPANY' | 'BUSINESS' | 'BRANCH';
  scopeId: string | null;
};
```

The guard evaluates `grants` only, so it has one code path for every credential. Each path fills it:

| Path | `grants` come from |
|---|---|
| A · user | ALLOW from the role permissions of every active membership; ALLOW **and** DENY from active `permission_overrides`; ALLOW from active `platform_grants` |
| B · device, before PIN | ALLOW from the system `Device` role, at the device's branch |
| B · device + PIN | the employee's memberships and overrides as in path A, filtered to scopes that cover the device's branch — the `Device` grants are dropped |
| C · API key | ALLOW from the key's scopes, at `COMPANY` scope for the key's company |

**Evaluation happens at the request's target scope**, not while building the list, because a broad ALLOW and a narrow DENY must both survive until the guard knows which branch is being touched:

1. collect the grants for the permission whose scope **covers** the target (a company grant covers its businesses and branches; a business grant covers its branches);
2. if any of them is a `DENY` → refuse (§5.2, PRD D-31);
3. else if any is an `ALLOW` → permit;
4. else → refuse (deny by default).

So a business-wide ALLOW with a DENY on branch 3 permits branches 1, 2, 4 and refuses branch 3.

### 4.1 Rules

- **Company switching (path A).** The client may *ask* for any company id. The server honours it only if the user has an active membership in it; otherwise 403 before `withTenant()` is called. `session.active_company_id` is a convenience hint and is re-checked on every request. (T8 proves this with a spy on `withTenant`.)
- **Membership removal** takes effect on the next request: memberships are read per request, and the permission cache in Redis is invalidated on **every** change to `memberships`, `permission_overrides`, `roles`, `role_permissions` and `platform_grants` — for role changes, for every principal holding that role. The mutation and its invalidation are in the same use case; a cache key carries a version so a missed invalidation is bounded by a short TTL, not by the full cache lifetime.
- **Membership window.** `starts_at` / `ends_at` are enforced in the query, not in a nightly job.
- **Device revocation** is rejected on the next contact; a revoked device's unsynced sales are quarantined, never discarded (PRD §8.4).

### 4.2 `employee_ref`

`cashier_pins.employee_id` and `memberships.employee_id` point at `staff.employees(id)` once `staff` exists (Phase 1), with a tenant-qualified FK `(company_id, employee_id)`. Until then they are plain columns with no FK, and T9b does not issue PINs to anything but test fixtures. An employee **may** be linked to a `user` (`module-map.md`: `staff → identity`), but a PIN never opens `app.`; it only identifies who is operating an already-approved device.

## 5. Decisions on authority

### 5.1 One authorization authority: our `memberships`

Better Auth's `organization` plugin models the same thing as our `memberships` table. Two authorities disagree sooner or later, and the disagreement is a security bug. **`memberships` + `roles` + `permission_overrides` own authorization.** The `organization` plugin is not installed. Better Auth only answers "who is this?" — never "what may they do?".

### 5.2 DENY wins (PRD D-31)

A user's effective permissions are the union of every applicable, active membership's role permissions, minus every applicable DENY override. **Any applicable DENY wins**, at any scope, over any ALLOW. Deny by default when nothing matches.

### 5.3 First-owner bootstrap — `identity` `onboard-company`

A company must never exist without an owner, and `tenancy` must not write into `identity` (not an allowed arrow).

- `onboard-company` is a use case in `identity` (`identity → tenancy` is allowed by `module-map.md`).
- It calls its own `CompanyRegistry` port to insert the company, then inserts the owner membership, then appends `CompanyCreated` to the outbox — all in **one** transaction.
- **This is the one synchronous cross-module write.** `module-map.md` §3 reserves ports for reads and sends every cross-module state change through the outbox. A company without its owner membership must never be observable, so an event cannot serve here. The exception is exactly this call: `identity`'s `CompanyRegistry` adapter → `tenancy`'s exported `registerCompany`, in the caller's transaction. Any other synchronous cross-module write needs its own ADR. `module-map.md` §3 records it.
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

Every public route is rate-limited in Redis **except `/health`**, which must report process liveness even when Redis is down or the limit is exhausted — otherwise an orchestrator restarts a healthy API during a Redis incident. `/ready` still reports Redis. Sign-up is **not** public: companies are created by `onboard-company`; users by the operator script `platform:create-user` in Phase 0. Inviting users into a company is a later deliverable (issue #19).

## 6a. Revisions

**2026-09-22, after Codex review of PR #5:** §4 split into three resolution paths (device tokens and API keys cannot go through `withUser()`); §2.2 and §2.3 policies split by command, so a tenant cannot delete or re-home a global role; every policy reads context through the `NULLIF` helpers, and both wrappers always set both settings.

**2026-09-23, after Codex round 2:** role references use a non-null `owner_key` (§2.3) so global roles can be assigned safely; device operators are authorized through employee memberships (§4 path B); `pospay_app` gets DML on `roles` / `role_permissions`; `apikey.company_id` stated as the one column on a global table; `/health` exempt from rate limiting.

**2026-09-23, after Codex round 3:** `role_permissions` cannot extend a global role; the tenant root `companies` is keyed on `id` alone; `withNewTenant` defines the onboarding bootstrap.

**2026-09-23, after Codex round 4:** `platform_grants` + `@RequirePlatform` authorize onboarding before any membership exists; `Principal.grants` carries every credential's permissions so the guard has one code path.

**2026-09-23, after Codex round 5:** grants keep their `effect` and are evaluated at the target scope (branch-level DENY under a business-level ALLOW); ALLOW overrides included; cache invalidation covers role and platform-grant changes; `platform_audit_log` for non-tenant audit.

**2026-09-23, after the plan v4 debate:** bootstrap-owner exception; `pospay_dispatcher` role for the outbox dispatcher; `onboard-company` idempotency coordinated by the unique key with no persisted `IN_FLIGHT` state.

**2026-09-23, T7b:** the dispatcher's delivery metadata gains `next_attempt_at` (backoff and claim lease) and `parked_at` (retry then park, per-aggregate ordering — Waleed); consumers dedupe on `consumed_events (company_id, consumer_id, event_id)` as `pospay_app`; the 24 h idempotency sweep is `sweep_expired_idempotency_keys(batch_size)`, `SECURITY DEFINER` with a pinned `search_path`, executable by `pospay_dispatcher` only — it deletes expired keys and nothing else.

**2026-09-23, after Codex round 6:** `withNewTenant` is context-only and the idempotency claim precedes the company insert; the synchronous `identity → tenancy` write is recorded as the one exception to `module-map.md` §3; offline money-moving actions without an operator credential are quarantined until P2-T9.

**2026-09-23, T9a-2:** `roles` is keyed on `(id, owner_key)` — that pair is what the FKs reference, and no unique on
`id` alone reveals another tenant's role. Membership and override scopes are `scope_type` + `scope_id` with generated
`scope_business_id` / `scope_branch_id` columns, so a scope naming another company's business or branch fails a
tenant-qualified FK. `permission_overrides` reach the user branch through their membership. The requested company comes
from the `x-company-id` header or the session hint and is refused before any `withTenant` unless an active membership
covers it. The Redis permission cache is deferred to the first membership-changing use case (T9a-4).

## 7. Consequences

- **`CLAUDE.md` §5 is amended** in the same PR: the "no fourth way to reach the DB" sentence names the auth path as the one exception, reachable only from `packages/auth` on `pospay_auth`.
- T4 creates the three roles and all three wrappers; T5's isolation suite runs as `pospay_app` and additionally asserts `pospay_auth` cannot read any tenant table.
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
