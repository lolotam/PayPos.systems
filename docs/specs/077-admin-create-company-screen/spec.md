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

## Submit, idempotency

Submitting calls `POST /v1/companies` through the generated API client (same origin, same
credentials, same middleware) with an `Idempotency-Key` header and the body
`name_en`, `name_ar` (omitted when empty), `plan_id`.

The key lifecycle:

- Created once per attempt when the user first submits; held while the outcome is unknown.
- A retry of the same submit after a network failure or a 5xx **reuses** the held key, so the
  retry can never create a second company (the first request may have committed).
- A definitive answer — 201 success, or a refusal (403, any 4xx validation error) — releases the
  key: the next submit uses a new key.
- Changing the form values releases the key: the next submit uses a new key.

Validation uses the contract's field schemas (`nameEn`, `nameAr` from `packages/contracts`) with
react-hook-form + zod; an empty English name shows the field error next to the field and sends no
request.

## Outcomes

- **201** — the workspaces read is invalidated and refetched; the workspace provider resolves the
  new company (a one-company list is chosen for the user automatically), `workspace.status`
  becomes `ready`, and the dashboard content replaces the screen. No full page reload.
- **403** — the refusal alert as above; no workspaces refetch.
- **`unknown_plan` (422), other validation errors, network failure, 5xx** — an error alert with
  `role="alert"`; the form stays usable and filled. Server validation issues that point at a name
  field (e.g. too long) show next to that field.
- **Pending** — the button and fields are disabled (the same disabled state the app's other forms
  use) until the request settles.

The path `/v1/companies` is not yet registered in the contracts OpenAPI paths, so the generated
client's typed `POST` cannot accept it; the call goes through the generated client instance with
one narrow, documented escape hatch in the workspace API client until contracts registers the
path (`packages/contracts` must not change in this slice).

## Strings and layout

All strings through new `admin.*` keys in `packages/i18n` (`ar` + `en`). Layout: `PageShell`
layout `form` + `PageHeader` from `packages/ui`, like the catalog create pages. Logical CSS
properties only. No change to `apps/api`, `packages/contracts`, `packages/db`, `packages/auth`,
permissions, migrations, dependencies, or `apps/admin/src/session/**`.

## Acceptance

1. User with no company sees the form (heading, two fields by label, button) in English and in
   Arabic (RTL).
2. Valid submit sends exactly one request carrying `name_en`, `name_ar` when given, the
   provisional plan id (written literally in the test, not imported), and an `Idempotency-Key`
   header; on 201 the workspaces read refetches and the dashboard content replaces the screen.
3. Empty English name: field error shown, no request sent.
4. 403: refusal alert with `role="alert"`, form keeps its values, no workspaces refetch.
5. Network failure then retry: same key; after a 403 the next attempt uses a new key.
6. `unknown_plan` and 500: error alert with `role="alert"`, form usable.
7. Gates: admin `tsc --noEmit`, `eslint .`, `pnpm lint:docs`, `pnpm module-map:check`,
   `@pospay/i18n` tests, admin workspace vitest run, full admin test, admin build.
