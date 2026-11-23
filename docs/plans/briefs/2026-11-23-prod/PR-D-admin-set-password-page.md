# Brief PR-D — admin "set your password" page

Tier: **Heavy** (auth surface). Read first: `packages/auth/src/config.ts:150-216`,
`packages/auth/scripts/create-user.ts`, `apps/admin/app/login/` and `apps/admin/src/session/`,
`docs/plans/2026-11-23-first-owner-rehearsal.md`.

## Why

`platform:create-user` prints a one-time link (`packages/auth/scripts/create-user.ts:66-68`). The link is
`<api>/v1/auth/reset-password/<token>?callbackURL=<admin>/set-password` (`packages/auth/src/config.ts:214`,
`create-user.ts:35`). `apps/admin/app/` has `login`, `login/two-factor`, `security/two-factor` and the dashboard —
there is no `set-password` route. Today the first owner of a company cannot choose a password from a screen.

## Goal

A person who opens the one-time link lands on an admin page, types a new password twice, and is sent to the login
page. An expired or used link shows a clear message. Nothing else about authentication changes.

## Before writing code

Confirm by reading Better Auth's reset flow as wired here what the browser receives after
`GET /v1/auth/reset-password/<token>?callbackURL=…`: the redirect target and the query parameter that carries the
token (and the error parameter for an invalid token). Write the answer in the PR description. If the link cannot be
completed by `POST /v1/auth/reset-password` with that token and a new password, stop and report — do not add a new
API route without the manager's word.

## Files

- `apps/admin/app/set-password/page.tsx` — a thin route file that re-exports the screen (`CLAUDE.md` §7).
- `apps/admin/src/session/set-password/` (or the folder the login screen lives in — follow it): the screen, its form
  (react-hook-form + a Zod schema; the length limits come from the auth contract if one is exported, otherwise from a
  schema added to `packages/contracts`), and the call through the generated client or the existing auth client the
  login screen uses. No `fetch` inside a component.
- `packages/i18n` — every string, Arabic and English.
- Tests next to the screen.
- If the dashboard middleware or layout redirects unauthenticated visitors to `/login`, add `/set-password` to its
  public routes — and nothing more.

## Behaviour

- No token in the URL, or the error parameter present → the "link is not valid or has expired, ask for a new one"
  state; no form.
- Password and confirmation differ, or the length is out of range → inline message, button stays enabled for a retry.
- Success → the success state with a button to `/login`. The page never signs the user in by itself and never shows
  or logs the token.
- The token is read once from the URL and then removed from the address bar (`history.replaceState`).
- Uses `packages/ui` components, logical CSS properties only, Phosphor icons, RTL-correct.

## Do not touch

`packages/auth` behaviour, the reset token lifetime, the login and two-factor screens, any API controller, any
migration, the navigation work of spec 074.

## Tests (each asserts what the user sees)

- Valid token + matching passwords → the success state is visible and the client was called once with the token.
- Mismatch → the mismatch message is visible and no request was sent.
- Too short → the length message is visible.
- The API answers "invalid token" → the expired-link state is visible.
- No token in the URL → the expired-link state is visible, no form.
- Arabic locale renders right-to-left with the Arabic strings.

## Local gates

`pnpm --filter @pospay/admin test` for the new specs, typecheck, lint, `pnpm lint:docs`, the admin `api:check` if a
contract was added. Then `clean-code-guard`, `test-guard` and `waleed-security-reviewer` (PP-198, Heavy).
`ci-gate` on the exact head decides the rest.

## Size estimate

About 260 lines: screen and form 110, i18n 30, tests 110, route and wiring 10. Cap 520.

## Report

Branch, head SHA, what the reset redirect actually carries, test results, and a screenshot of the three states in
Arabic.
