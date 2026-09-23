# ADR-0009 — Better Auth: version pin and how it is wired

- **Status:** Accepted
- **Date:** 2026-09-23
- **Slice:** Phase 0 · T9a-1 — Better Auth, the `pospay_auth` pool, sessions, principal skeleton

## Context

`06` fixes Better Auth for sessions and ADR-0003 classifies its tables and decides who may reach them. T9a-1 is the
first code that uses it, so the version and the few integration choices that are not already in ADR-0003 are recorded
here (`CLAUDE.md` §11: a new library needs an ADR).

## Decision

| Package | Version | Why |
|---|---|---|
| `better-auth` | **1.7.5** | latest stable (2026-09-14), past pnpm's minimum release age; peer range includes `drizzle-orm ^0.45.2` |
| `@better-auth/drizzle-adapter` | **1.7.5** | the adapter ships as its own package at the same version |

- **Plugins:** email + password and `two-factor` (TOTP) only. **Not** `organization` (ADR-0003 §5.1).
- **Sign-up closed:** `emailAndPassword.disableSignUp`. Users are created server-side by `AuthService.provisionUser`,
  which hashes through Better Auth's own `password.hash` — the operator script `platform:create-user` (T9a-3) wraps it.
- **Tables:** `user`, `session` (+ `active_company_id` hint), `account`, `verification`, `two_factor` in
  `packages/db/schema/identity-auth.ts`, snake_case columns under Better Auth's field names, `uuid` ids generated as
  UUID v7 (`advanced.database.generateId`). Migrations `0007_…_identity-auth` and `0008_…_identity-auth-grants`:
  `pospay_auth` holds `SELECT, INSERT, UPDATE, DELETE` on exactly these five; no other role holds anything.
- **Pool:** `createAuthDatabase` in `packages/db` is a restricted facade (role checked by `ping`); ESLint
  `no-restricted-imports` lets only `packages/auth` import it (and only `apps/worker` the dispatcher facade).
  `createAuth({ databaseUrl, … })` opens it, so the pool never leaves `packages/auth`.
- **Surface:** `AuthService` (`handler`, `getSession`, `provisionUser`, `ping`, `close`) — no other package sees a
  Better Auth type. Telemetry off; cookie prefix `pospay`; cookies `Secure` when `BETTER_AUTH_URL` is https.
- **API:** Better Auth answers at `/v1/auth/*`, mounted on Fastify beside Nest; failures leave as the error envelope.
  A global `SessionGuard` denies every other route without a verified session unless it is `@Public()` (today
  `/health` and `/ready`); the principal is attached to the request. What it may do is T9a-2's `@Require`.

## Consequences

- **Left at Better Auth's defaults, to be decided (`TODO(spec)`):** session lifetime (7 days, refreshed daily),
  minimum password length (8), and rate limiting (in-memory — Redis-backed limits for login are CLAUDE.md §8 and come
  with the lockout work).
- Upgrading Better Auth is a deliberate PR that re-checks the table shape with `getAuthTables` and updates this ADR.
