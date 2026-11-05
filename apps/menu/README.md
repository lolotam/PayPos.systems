# Public rating page

Rating-only Next.js shell for spec 060 row 60-2 and ADR-0058.
The root route takes the capability from the URL fragment. No login or tenant
selection is used. Only the business name and rating form/status are shown.

Set `NEXT_PUBLIC_API_URL` to the public API origin when building this application.
An absent value produces a generic error state; no request is sent.
The browser omits credentials and sends the capability in `x-rating-token`.

The API separately requires `RATING_PAGE_ORIGIN` equal to this page's exact origin.
Do not add it to `AUTH_TRUSTED_ORIGINS`. An unset origin disables public rating CORS.
Neither this README nor this slice changes server, DNS, Traefik or Dokploy settings.

Build workspace dependencies before direct checks or development on a fresh checkout:

`pnpm exec turbo run build --filter=@pospay/menu^...`

Local checks:

- `pnpm --filter @pospay/menu typecheck` (includes generated-client freshness)
- `pnpm --filter @pospay/menu lint`
- `pnpm --filter @pospay/menu test`

Regenerate the API schema with `pnpm --filter @pospay/menu api:generate`.
Use `pnpm --filter @pospay/menu dev` for local development, and the existing
`build` / `start` scripts for a Next.js standalone runtime. The build copies browser
assets into `.next/standalone/apps/menu/.next/static`; start launches the generated
`.next/standalone/apps/menu/server.js`. Keep the complete `.next/standalone` tree
when packaging the runtime. `RATING_PAGE_ORIGIN` requires HTTPS outside explicit
`NODE_ENV=development` or `NODE_ENV=test`. Staging deployment and live
verification belong to the manager's separate release work.
