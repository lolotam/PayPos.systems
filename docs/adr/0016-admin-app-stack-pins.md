# ADR-0016 — Admin app stack pins

- **Status:** Accepted
- **Date:** 2026-10-01
- **Slice:** Phase 1 · PR 2 — `apps/admin` shell

## Context

PR 2 adds the Next.js admin shell: sign-in, TOTP challenge, TOTP enrolment, the
company selector, and a generated client for `GET /v1/me/workspaces`. The UI kit,
catalogs, and Better Auth server already have pins (ADR-0015, ADR-0003). This ADR
records the dependencies that shell adds, and why Next 16.3.8 was not used.

## Decision

These are the exact versions installed for `@pospay/admin`. Pins are exact
(no `^` or `~`). React stays 19.3.0. Workspace packages (`@pospay/ui`,
`@pospay/i18n`, `@pospay/contracts`, `@pospay/auth`, `@pospay/config`) are
`workspace:*` and are not repeated here.

| Package | Version | Why this one |
|---|---|---|
| `next` | **16.3.7** | App Router shell with `output: 'standalone'`. 16.3.8 was published inside pnpm's 1,440-minute release-age window, so it is not eligible |
| `@next/env` | **16.3.7** | Loads the repo-root env into `next.config.ts`. Next only reads `apps/admin`, and pnpm does not expose Next's transitive copy |
| `react` / `react-dom` | **19.3.0** | Same React the kit already pins; Next 16 accepts `^19.0.0` |
| `@types/react` / `@types/react-dom` | **19.3.0** | Matching JSX types |
| `@types/node` | **24.13.6** | Node 24 types, same pin as the rest of the repo |
| `@tanstack/react-query` | **5.104.0** | Server-state cache for the workspace query and the session probe |
| `@tanstack/react-table` | **8.21.3** | CLAUDE.md §7 table renderer; the brand shell renders the existing cursor-paginated membership results without client sorting, filtering or pagination |
| `react-hook-form` | **7.89.0** | Login, TOTP, and password-confirm forms |
| `@hookform/resolvers` | **5.9.1** | Connects those forms to the Zod 4 schemas in `@pospay/contracts` |
| `openapi-fetch` | **0.17.0** | Typed client over the generated OpenAPI paths, with cookie credentials |
| `openapi-typescript` | **7.13.0** | Generates `schema.d.ts` from `packages/contracts/openapi/openapi.json` |
| `qrcode.react` | **4.2.0** | Renders the otpauth URI as a QR during TOTP enrolment |
| `tailwindcss` | **4.3.3** | Same Tailwind 4 pin as the kit, so the admin stylesheet can `@source` its own files |
| `@tailwindcss/postcss` | **4.3.3** | Tailwind 4 PostCSS plugin required by Next, which does not use the kit's Vite plugin |
| `postcss` | **8.5.28** | Runs that plugin from `postcss.config.mjs` |
| `typescript` | **6.0.3** | Repo TypeScript pin |
| `eslint` | **10.11.0** | Repo ESLint pin, including the logical-CSS rule |
| `vitest` | **5.0.1** | Repo test runner |
| `jsdom` | **30.1.1** | DOM environment, same pin as `packages/ui` |
| `@testing-library/react` | **16.3.3** | Renders the login smoke test |
| `@testing-library/dom` | **10.4.2** | Testing Library peer, same pin as the kit |

**Release-age policy stays enabled.** No dependency bypasses pnpm's minimum
release age, and `minimumReleaseAgeExclude` is unchanged. Next 16.3.8
(published 2026-09-30) was inside the 1,440-minute window on 2026-10-01, so
16.3.7 (published 2026-09-29) is the newest stable Next that qualifies.

**The browser never imports `better-auth`.** `@pospay/auth/client` is a
framework-free `better-auth/client` factory (`basePath: '/v1/auth'`,
`credentials: 'include'`, `twoFactorClient`). The server entry that opens
`@pospay/db` stays on `@pospay/auth` and is not re-exported from the client.

**`NEXT_PUBLIC_API_URL` is a build argument.** Next inlines `NEXT_PUBLIC_*`
while compiling. `deploy/Dockerfile.admin` declares `ARG NEXT_PUBLIC_API_URL`
with an empty default before `next build`, so a CI image does not bake a fake
origin. An empty value fails closed when a request is made. The admin dev
server loads the repo-root env through Next's `@next/env` (`loadEnvConfig`)
because Next otherwise reads only `apps/admin`.

**One new kit primitive.** `packages/ui` adds a Radix `Select` and re-exports it
from the kit index, for the company, business, and branch menus. No second
component library was added.

**The admin build uses webpack, not Turbopack.** Next 16 defaults to Turbopack,
and Turbopack ignores `extensionAlias`. `@pospay/ui` is consumed as TypeScript
source whose imports use `.js` specifiers for `.ts` and `.tsx` files. `next build
--webpack` maps those specifiers with `resolve.extensionAlias`. `agentRules` is off so
Next does not write a second `CLAUDE.md` beside the repo rules.

## Consequences

- The design brand shell uses Table v8's core row model with `manualPagination: true`.
  Existing permission query hooks, cursor controls and membership selection remain the owners
  of data and actions. The headless library adds no component styling or business rules.
  See [TanStack manual server pagination](https://tanstack.com/table/v8/docs/guide/pagination#manual-server-side-pagination).

- `pnpm check` typechecks, lints, tests, and builds `@pospay/admin`, then
  `api:check` fails if the committed `schema.d.ts` drifts from the OpenAPI document.
- The admin image is built in the CI `images` job and tagged `$SHA`. It is not
  added to a compose file or a deploy script.
- Upgrades are deliberate PRs that update this table and the lockfile together.

References: [Next standalone](https://nextjs.org/docs/app/api-reference/config/next-config-js/output),
[pnpm release-age policy](https://pnpm.io/settings/dependency-resolution#minimumreleaseage),
ADR-0015.
