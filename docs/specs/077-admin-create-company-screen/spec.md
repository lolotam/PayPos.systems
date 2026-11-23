# Spec 077 — Admin create-company screen (PR-H)

Rehearsal doc: `docs/plans/2026-11-23-first-owner-rehearsal.md`, gap **G2**: no admin screen calls
`POST /v1/companies`, so rehearsal step 8 today needs a browser-console call. This slice gives the
signed-in user a screen instead.

## What the user sees

A signed-in user whose workspaces read (`GET /v1/me/workspaces`) returns no companies sees, in
place of the old empty-state message, a create-company screen: a heading, a lead line, one field
for the company name in English (required) and one for the Arabic name (optional), and one primary
submit button. Nothing else is asked. The screen renders inside the existing dashboard frame; the
frame already draws with no workspace.

Today there is exactly one plan (`PROVISIONAL_PLAN_ID` in `packages/db/src/seed.ts`). The user
does not choose a plan: the screen sends the provisional plan id from one constant in the Admin
workspace area. The constant mirrors the seed value in a one-line Arabic comment and must be
replaced when real plans exist; `packages/db` is never imported into Admin.

## Permission

There is no endpoint to ask in advance whether the caller holds
`create:companies:platform`, so the screen is shown to **every** signed-in user with no company,
and the refusal is shown only after the attempt: the API answers 403 and the screen shows a
refusal alert («this account is not allowed to create a company — contact PosPay support»,
bilingual via `packages/i18n`) with `role="alert"`, and the form keeps its values.

## The one undecided attempt (idempotency)

A request whose outcome is unknown may already have created the company, so **one undecided
attempt may exist at a time and lives outside the component**: before a request leaves the
browser, `{ userId, key, body, startedAt }` is written to `localStorage` under the fixed name
`pospay.admin.create-company-attempt`. The user id comes from the session hook the dashboard
already uses (`useSessionIdentity`). An attempt stored for a different user id, or older than
23 hours (the server keeps idempotency records for 24), is ignored and removed. While an
undecided attempt exists — found at mount, left by a failed request, or written by another tab
(storage is re-read at submit time and the `storage` event is listened to) — the form shows the
attempt's values in read-only fields, a short notice with `role="status"` saying the previous
attempt may have gone through and will be retried safely, and one button «Try again» that resends
the SAME key and the SAME body. The user cannot edit the values or send anything else until the
attempt is decided. (This **replaces** the earlier rule «changing the form values creates a new
key»: values are only editable when no undecided attempt exists.)

**Decided** means 201 success, or a 4xx answer other than 408, 409 and 429. On a decided refusal
the stored attempt is removed and the form becomes editable again with its values kept and the
error shown. **On a 201 the attempt is NOT removed: it is marked created** (a `createdAt` field
on the same stored object, same storage name, same user-id and 23-hour rules). While a created
attempt exists for this user the screen shows the success state — the `role="status"` message
and «Reload» — never the form, also after a remount and in another tab. The stored attempt is
removed only when the workspaces read returns at least one company: the hook checks the query
cache after the invalidation's refetch settles, and again when the screen unmounts while the
cache shows a company (no extra request in either place); otherwise a created attempt lives until
the 23-hour cap. Retrying a created attempt is refused. The mutation runs with
`networkMode: 'always'`, so a submit while the browser is offline fails at once as a network
failure (attempt kept) instead of being queued silently.

Submitting calls `POST /v1/companies` through the generated API client (same origin, same
credentials, same middleware) with an `Idempotency-Key` header and the body `name_en`, `name_ar`
(omitted when empty), `plan_id`. Validation uses the contract's `createCompanyInput` schema with
react-hook-form + zod; an empty English name shows the field error next to the field and sends no
request. Every field error paragraph has an id referenced by its input's `aria-describedby`.

The path `/v1/companies` is not yet registered in the contracts OpenAPI paths, so the generated
client's typed `POST` cannot accept it; the call goes through the generated client instance with
one narrow, documented escape hatch in the workspace API client until contracts registers the
path (`packages/contracts` must not change in this slice).

## Outcomes

- **201** — the attempt is marked created (kept in storage) and the screen switches to a success
  state that cannot submit: a `role="status"` message that the company was created and the
  workspace is loading, and, if the workspaces refresh fails or stays paused, a button «Reload»
  that refetches the workspaces read. The form is not rendered in this state — not after a
  remount and not in another tab — until the workspaces read shows the company, which also
  removes the stored attempt. When the refresh succeeds the workspace provider resolves the new
  company (a one-company list is chosen for the user automatically), `workspace.status` becomes
  `ready`, and the dashboard content replaces the screen. No full page reload.
- **403** — the refusal alert as above; no workspaces refetch; the attempt is removed.
- **`unknown_plan` (HTTP 400, `VALIDATION_FAILED`), other validation errors** — an error alert
  with `role="alert"`; the attempt is removed and the form stays usable and filled. Server
  validation issues that point at a name field (e.g. too long) show next to that field.
- **Network failure, 5xx, 408, 409, 429** — the outcome is unknown, the attempt stays stored and
  the locked retry state above applies. Pending requests disable the button and fields.

## Strings and layout

All strings through `admin.*` keys in `packages/i18n` (`ar` + `en`). Layout: `PageShell`
layout `form` + `PageHeader` from `packages/ui`, like the catalog create pages. Logical CSS
properties only. No change to `apps/api`, `packages/contracts`, `packages/db`, `packages/auth`,
permissions, migrations, dependencies, or `apps/admin/src/session/**`.

## Acceptance

1. User with no company sees the form (heading, two fields by label, button) in English and in
   Arabic (RTL).
2. Valid submit sends exactly one request carrying `name_en`, `name_ar` when given, the
   provisional plan id (written literally in the test, not imported), and an `Idempotency-Key`
   header; on 201 the attempt is marked created (kept in storage), the workspaces read refetches
   and the dashboard content replaces the screen (or the success state with «Reload» when the
   refresh fails — the state survives a remount, and the marker is cleared once the read shows
   the company).
3. Empty English name: field error shown (referenced by `aria-describedby`), no request sent.
4. 403: refusal alert with `role="alert"`, form keeps its values, no workspaces refetch.
5. Unknown outcome (network failure, 500): fields read-only with the sent values, notice with
   `role="status"`, and «Try again» resending the same key and body; a 403 after that removes the
   attempt and unlocks the form; the next submit uses a new key.
6. `unknown_plan` and a 500: a clear error alert with `role="alert"` — for the 500 the alert sits
   in the locked retry state.
7. An attempt of a different user id, or older than 23 hours, is ignored and removed.
8. Gates: admin `tsc --noEmit`, `eslint .`, `pnpm lint:docs`, `pnpm module-map:check`,
   `@pospay/i18n` tests, admin workspace vitest run, full admin test, admin build.

## Notes (recorded, not built in this slice)

- The workspace provider keeps the last view when a refetch fails after a successful read
  (`hasRead`); a failed first read still shows the error state (provider spec).
- The created company is not selected explicitly: the workspace provider selects the only company
  of the fresh workspaces list.
- Two tabs that both submit different names within the same instant, before either has written
  the stored attempt, can still race; the submit-time storage re-read narrows the window but a
  truly simultaneous pair is not solved here.
