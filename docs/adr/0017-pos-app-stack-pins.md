# ADR-0017 — POS app stack pins

- **Status:** Accepted
- **Date:** 2026-10-01
- **Slice:** Phase 1 · PR 3 — `apps/pos` shell

## Context

PR 3 adds the Vite React PWA shell: device pairing, a generated client for the
device routes, and a static image. The UI kit, catalogs, and admin shell already
have pins (ADR-0015, ADR-0016). This ADR records the dependencies that shell
adds, and why Vite 8.3.2 was not used.

## Decision

These are the exact versions installed for `@pospay/pos`. Pins are exact
(no `^` or `~`). React stays 19.3.0. Workspace packages (`@pospay/ui`,
`@pospay/i18n`, `@pospay/contracts`, `@pospay/config`) are `workspace:*` and
are not repeated here.

| Package | Version | Why this one |
|---|---|---|
| `vite` | **8.3.1** | Builds the static PWA. 8.3.2 was published inside pnpm's 1,440-minute release-age window, so it is not eligible |
| `@vitejs/plugin-react` | **6.1.1** | Official React plugin for Vite 8. React Compiler stays off |
| `vite-plugin-pwa` | **1.3.0** | `generateSW`: precache the built shell, manifest, and service worker |
| `dexie` | **4.4.6** | IndexedDB table for the device credential. A PWA has no httpOnly cookie for it |
| `react` / `react-dom` | **19.3.0** | Same React the kit already pins |
| `@types/react` / `@types/react-dom` | **19.3.0** | Matching JSX types |
| `@types/node` | **24.13.6** | Node 24 types, same pin as the rest of the repo |
| `@tanstack/react-query` | **5.104.0** | Same pin as the admin. Caches `GET /v1/devices/me` |
| `react-hook-form` | **7.89.0** | Pairing form, same pin as the admin |
| `@hookform/resolvers` | **5.9.1** | Connects that form to `registerDeviceInput` from `@pospay/contracts` |
| `openapi-fetch` | **0.17.0** | Typed client over the generated paths, same pin as the admin. Sends `Authorization: Device` and no cookies |
| `openapi-typescript` | **7.13.0** | Generates `schema.d.ts` from `packages/contracts/openapi/openapi.json` |
| `tailwindcss` | **4.3.3** | Same Tailwind 4 pin as the kit, so the POS stylesheet can `@source` its own files |
| `@tailwindcss/vite` | **4.3.3** | Tailwind 4 Vite plugin, same pin as the kit |
| `typescript` | **6.0.3** | Repo TypeScript pin |
| `eslint` | **10.11.0** | Repo ESLint pin, including the logical-CSS rule |
| `vitest` | **5.0.1** | Repo test runner |
| `jsdom` | **30.1.1** | DOM environment, same pin as the kit |
| `@testing-library/react` | **16.3.3** | Renders the pairing smoke test |
| `@testing-library/dom` | **10.4.2** | Testing Library peer, same pin as the kit |

**Release-age policy stays enabled.** No dependency bypasses pnpm's minimum
release age, and `minimumReleaseAgeExclude` is unchanged. Vite 8.3.2
(published 2026-10-01) was inside the 1,440-minute window, so 8.3.1
(published 2026-09-24) is the newest stable Vite that qualifies.
`vite-plugin-pwa` 1.3.0 was published 2026-05-05. `dexie` 4.4.6 was published
2026-09-10. `@vitejs/plugin-react` 6.1.1 was published 2026-08-28.

**The device credential stays in IndexedDB.** The POS is a static PWA, so it
cannot keep the device credential in an httpOnly cookie. Dexie stores one row:
the registration, then the device token after a successful claim. The claim
secret is removed when the token is stored. Neither value is logged, put in a
URL, or rendered.

**`VITE_API_URL` is a build argument.** Vite inlines `VITE_*` while compiling.
`deploy/Dockerfile.pos` declares `ARG VITE_API_URL` with an empty default before
`vite build`, so a CI image does not bake a fake origin. An empty value fails
closed when a request is made. The deploy PR sets the value, the same way
issue #54 sets `NEXT_PUBLIC_API_URL` for the admin. Dev and `vite build` read
the repo-root env (`envDir`).

**Vite 8 resolves the kit's NodeNext specifiers.** `@pospay/ui` is consumed as
TypeScript source whose imports use `.js` for `.ts` and `.tsx` files. Vite 8's
resolver maps a missing `.js` file onto `.ts` and then `.tsx`. Its public
config has no `resolve.extensionAlias`, which is why the admin build uses
webpack instead.

**The published OpenAPI document has the device schemas and not the device
routes.** This PR does not change that document: regenerating it would make
the admin `schema.d.ts` stale, and the admin app is out of scope. The POS
client keeps the generated schema and adds the three device paths locally,
using those component schemas. `GET /v1/devices/me` has no component schema;
its response is typed as `{ device_id, company_id, branch_id }`.

## Consequences

- `pnpm check` typechecks, lints, tests, and builds `@pospay/pos`, then
  `api:check` fails if the committed `schema.d.ts` drifts from the OpenAPI document.
- The POS image is built in the CI `images` job from `nginxinc/nginx-unprivileged:1.30.5-alpine`
  and tagged `$SHA`. `index.html`, `sw.js`, and the manifest are `Cache-Control: no-cache`.
  It is not added to a compose file or a deploy script.
- Upgrades are deliberate PRs that update this table and the lockfile together.

References: [Vite PWA](https://vite-pwa-org.netlify.app/guide/),
[pnpm release-age policy](https://pnpm.io/settings/dependency-resolution#minimumreleaseage),
ADR-0015, ADR-0016.
