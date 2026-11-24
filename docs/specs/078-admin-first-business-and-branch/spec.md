# Spec 078 — Admin first business and first branch screens

Follows spec 077 (create-company screen, PR #1257): the first owner lands on Home with
«Business: not chosen / Branch: not chosen» and no screen creates either. This slice adds the two
smallest screens that let them continue, in the same place and pattern as the company screen.

## What the user sees

1. Signed in, a company selected, and that company has **no business** → the dashboard content
   shows «Create your first business» (heading, lead, form) instead of the page.
2. A business selected that has **no branch** → the dashboard content shows «Create your first
   branch».
3. After each success the workspaces read is refreshed and the next screen (or the dashboard)
   appears with no page reload.

Both render from `WorkspaceBody`, same `PageShell layout="form"` + `PageHeader` pattern as
`CreateCompanyScreen`. No new route. The pages that need no workspace (`/appearance`,
`/security/two-factor`) bypass `WorkspaceBody` already and keep working.

## Workspace states (what was added, and what was not)

The provider already resolves `ready` with `company` (carrying `businesses[]`) and `business`
(carrying `branches[]`). The two situations are derived **in `WorkspaceBody`**, not as new
provider statuses:

- `status === 'ready' && workspace.company.businesses.length === 0` → first-business screen.
- `status === 'ready' && workspace.business && workspace.business.branches.length === 0` →
  first-branch screen.

This distinguishes «no business exists» from «business exists but none chosen»: a company with
businesses whose business is simply not remembered keeps the old behaviour (dashboard with the
header switcher). No change to `resolve-selection.ts` or the provider state machine.

## Business form

- Activity type: the five values of the contract's `verticalType` (restaurant, salon, laundry,
  retail, services), **salon first and preselected**.
- Name in English (required), name in Arabic (optional).
- Country: a visible select, **default Kuwait**, values exactly the contract's `country` enum
  (KW, SA, AE, BH, QA, OM), labels through i18n (no country label keys existed; new
  `admin.country*` keys). Held as plain component state — the country never enters
  `createBusinessInput`, which rejects it at creation.
- Currency and time zone are not asked; the contract defaults apply (`KWD`, `Asia/Kuwait`) and
  are **not sent**: the wire body is `Pick<CreateBusinessRequest, 'vertical_type' | 'name_en' |
  'name_ar'>`, so the server-side defaults fill them.
- Validation: react-hook-form + `zodResolver(createBusinessInput)` (input/output generics for the
  schema's defaults). `Controller` drives the vertical-type Radix select.
- Submit: `POST /v1/businesses` with an `Idempotency-Key`, body as above; on 201, then
  `PUT /v1/businesses/{businessId}/country` with `{ country }` (`setBusinessCountryInput`; this
  route carries no idempotency key). After both settle (whatever the PUT answer), the workspaces
  read is invalidated (fire-and-forget, so the alert below can render before the next screen
  arrives).
- **Country PUT failure (403 or network):** the business stays created; a `role="alert"` message
  says the country was not saved and can be set later from the settings; no roll-back, no second
  POST, and the flow continues (the refresh still lands and the next screen appears).

## Branch form

- Name in English (required), name in Arabic (optional). Nothing else.
- Submit: `POST /v1/businesses/{businessId}/branches` with an `Idempotency-Key`, body
  `createBranchInput` with only the names.

## Rules for both

- Permissions (`create:businesses:company`, `create:branches:business`, `manage:settings:business`
  for the country) cannot be asked in advance: the form is shown, and a 403 shows a refusal alert
  with `role="alert"`, form still filled.
- **Duplicate guard (the simple rule only):** at the start of each create call the hook refetches
  the workspaces read (`client.fetchQuery` on `['me','workspaces']` with the existing
  `fetchWorkspaces`, `staleTime: 0`, `networkMode: 'always'`). If the selected company already has
  a business (business form) or the selected business already has a branch (branch form), no POST
  is sent and the mutation resolves: the fetched read is already in the query cache, so the
  provider moves on by itself. If the read fails, no POST and the error is shown. A selected
  business that no longer appears in the fresh read is treated the same way (no POST).
- **Idempotency key, per mounted form, no storage:** the hook holds one
  `{ key, bodySignature, decided }` in a ref. Same values + undecided last outcome (network
  failure, 5xx, 408, 409, 429 — `isUndecided` from the company slice is reused) → the same key is
  resent. A decided answer (201 or any other 4xx) or changed values → a new key. No
  `localStorage`, no stored-attempt mechanism — that was specific to the company screen (077).
- The three routes are not in the generated OpenAPI paths; the calls go through the generated
  client instance with the same narrow local typing escape hatch as `create-company-client.ts`
  (same origin, credentials, middleware). Success bodies are parsed with the contract schemas
  (`business`, `branch`, `setBusinessCountryResult`). `isForbidden`/`issueField` are reused from
  `create-company-client.ts`. Each of the three writes sends the `x-company-id` header
  explicitly, with the id of the company the screen was rendered for; the client middleware keeps
  a header that is already set and only fills a missing one from the selection cookie.
- Each `<form>` gets `method="post"` (they render only after mount, so never in server HTML).
- Front end only: `apps/admin` and `packages/i18n`. No change to `apps/api`, `packages/contracts`,
  `packages/db`, `packages/auth`, permissions, migrations, dependencies, `apps/admin/src/session/**`,
  navigation frames or `packages/ui`.
- CLAUDE.md: contract schema with react-hook-form; TanStack Query + generated client (no fetch in
  components); `packages/ui` components; logical CSS properties; one component per file; 60 lines
  per function; 400 per file; Arabic comments only where they explain a why.

## Decisions taken (shown to the owner afterwards)

- Country defaults to Kuwait and is saved in a follow-up `PUT …/country` after the business
  exists — the creation contract reserves `country` (manager routing 2026-11-21, OQ-2/B-5).
- Currency and time zone are not asked; contract defaults apply.
- No stored attempt / no `localStorage` for these screens.
- A shared `NameField` (generalised from `CompanyNameField`) serves the four name inputs of this
  slice; the company screen keeps its own copy untouched.

## Left out

Address, location, opening hours; choosing among several businesses (the existing header
switcher); settings screens to change the country later; any stored-attempt recovery.

## Correction round notes (2026-11-24, PR #1262 review)

- The setup screens are a **display rule**: `WorkspaceBody` shows them only when
  `company.role_code` is in the mirror of the system role defaults for `create:businesses:company`
  (`owner`, `general_manager`) or `create:branches:business` (`owner`, `general_manager`,
  `business_manager`) — `setup-role-defaults.ts`, mirroring `packages/db/src/role-defaults.ts`
  lines 113–114. Any other role sees exactly what `main` shows (the page with «not chosen»), and a
  linked-workspace page (`allowsLinkedWorkspace`) always renders its own content.
- Every write carries `x-company-id` explicitly from the company the screen was rendered for: the
  client middleware otherwise takes the tenant from the shared selection cookie at send time, and
  another tab can change it between opening the form and sending.
- The country outcome lives in a module store keyed by business id (`country-outcome.ts`): the
  «country was not saved» alert follows the user onto the branch screen with «Try again» (resends
  the PUT for the same business and company) and «Dismiss»; it clears on success, dismissal, or
  leaving the setup flow.
- If the fresh workspaces read no longer contains the form's company, the business guard does not
  POST — the view moves on from that same read (a failed read shows the screen error as before).
- The two screens carry a React `key` of what they are rendered for (business screen: company id;
  branch screen: company id + business id), so switching the selection in the same tab remounts
  the form: typed values, the held idempotency key and pending error state reset with it.
- Known limits (recorded, not fixed here):
  - Two tabs that both read an empty list before either create commits can create two records;
    the durable guard belongs on the server.
  - If the business POST commits but its response is lost, the next submit finds the business and
    moves on without sending the country call; the country then has to be set later.
  - After a successful create, a failed workspaces refresh leaves the form on screen until the
    refresh succeeds.

## Tests (Vitest + Testing Library, visible outcomes)

Business screen spec: form in English and Arabic (heading, type select on salon, two name fields,
country select on Kuwait, button); valid submit → one POST with type/names/key and without
`country`/`currency`/`timezone`, then one PUT with the country, then the branch form appears;
country PUT 403 and network failure → country alert, no second POST, flow continues; business POST
403 → refusal alert, form filled, no PUT; guard (read shows a business → no POST and the next
screen; read fails → no POST and an error); key reuse (network retry same key, 409 same key, 403
then new attempt new key); empty English name → field error via `aria-describedby`, no request.

Branch screen spec: business with no branch → form; valid submit → one POST to the branches route,
then dashboard content with business and branch selected; 403 → refusal, form filled, no request;
guard both ways; empty name → field error, no request.

Expected literals are written in the tests; production constants are not imported for assertions.

## Gates

`pnpm --filter @pospay/admin exec tsc --noEmit`; `pnpm --filter @pospay/admin exec eslint
src/workspace`; `pnpm lint:docs`; `pnpm module-map:check`; `pnpm --filter @pospay/i18n test`;
`pnpm --filter @pospay/admin exec vitest run src/workspace
"app/(dashboard)/_frame/dashboard-frame.spec.tsx"`. No full Admin suite and no production build
locally; CI runs them.
