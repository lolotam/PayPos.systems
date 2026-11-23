# Brief PR-B — session cookie prefix from the environment

Tier: **Heavy** (auth). Read first: `packages/auth/src/config.ts:240-305`, `packages/auth/src/staff-sessions.ts`,
`packages/auth/src/personal-sessions.ts`, ADR-0001 §3 and §6, `apps/api/src/shared/config.ts:70-90`.

## Why

Production uses `COOKIE_DOMAIN=.pospay.systems`. A browser sends such a cookie to `*.staging.pospay.systems` too.
The cookie prefix is one literal for every environment (`packages/auth/src/config.ts:250`, and the name built at
line 301), so a production session cookie reaches the staging API under the same name staging uses.

## Goal

Staging and production use different cookie names. A cookie from one environment is never read as a session by the
other. Production keeps today's names, so nothing changes for production users.

## Design (fixed, do not redesign)

- New optional API setting `AUTH_COOKIE_PREFIX`, validated `^[a-z][a-z0-9-]{1,30}$`, default `pospay`.
- It replaces the literal in `cookiePrefix` (`config.ts:250`) and in the normal session cookie name built from it
  (`config.ts:301`). Derive both from one helper in `packages/auth`; no second literal.
- The staff cookie (`staff-sessions.ts:20`) and the personal staff cookie (`personal-sessions.ts:9`) are host-only
  by rule (`CLAUDE.md` §8, ADR-0019, ADR-0027) and are **out of scope**. First confirm from the code that neither is
  set with a `Domain` attribute; if one is, stop and report instead of widening the change.
- Staging sets `AUTH_COOKIE_PREFIX=pospay-stg` in `deploy/docker-compose.staging-shared.yml` (api and worker, since
  the worker builds the auth configuration too). Production leaves it unset.
- The admin UI cookies (`pospay_company_id`, `pospay_locale` and the like in `apps/admin/src/shared/`) are not
  sessions and stay as they are.

## Files

- `packages/auth/src/config.ts` (+ the helper file if you add one) and its specs.
- `apps/api/src/shared/config.ts` (the setting), `apps/api/src/main.ts` (pass it), the worker's auth wiring if it
  reads the same options.
- `packages/contracts/src/openapi.ts` only if it names the cookie; regenerate the OpenAPI file if it changes.
- `deploy/docker-compose.staging-shared.yml`, `deploy/staging.env.example`, `.env.example`.
- First check whether `apps/admin` or `apps/pos` read the session cookie by name (a middleware, a server component);
  if one does, it takes the prefix from its own build-time or runtime setting in the same PR. Report what you found.

## Do not touch

The cookie domain logic, session lifetimes, the staff and personal cookies, any guard, any migration, the admin UI
cookies, and anything under `deploy/` other than the two staging files.

## Tests

- Unit: with the prefix unset the session cookie name equals today's exact string (a regression lock); with
  `pospay-stg` it carries the prefix; an invalid prefix fails configuration; the staff and personal names are
  unchanged in both cases.
- Integration (API): a request carrying only a session cookie under the **other** prefix is unauthenticated (401);
  sign-in sets the cookie under the configured prefix; sign-out clears it.
- No test may assert only that a mock was called.

## Local gates

`pnpm --filter @pospay/auth test`, the API specs you touched, typecheck, lint, `pnpm lint:docs`,
`pnpm module-map:check`. Then run `clean-code-guard`, `test-guard` and `waleed-security-reviewer` (PP-198, Heavy)
and fix what they find. `ci-gate` on the exact head decides the rest.

## Deploy note for the manager

The first staging deploy with this change signs every staging user out once (their old cookie name is no longer
read). Production is unaffected. No snapshot is needed: there is no migration.

## Size estimate

About 110 lines: production code 35, tests 55, config and env 20. Cap 220.

## Report

Branch, head SHA, the list of every place that named a session cookie before and after, test results, and whether
any front end read the cookie by name.
