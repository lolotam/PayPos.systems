# 60-2 refresh — public rating page

Date: 2026-11-05. Baseline: `origin/main` and local HEAD both
`cc085aacd013311f63ba7e5fffc7d98f11a6dcb2`. Working tree was clean.

## Repository evidence

- `gh pr list --state open` returned only #842, the PP-124/PP-125 documentation PR.
  Its files are `.claude/skills/pospay-pipeline/SKILL.md`, `AGENTS.md`, `CLAUDE.md`,
  `docs/HANDOVER.md`, `docs/agent-delivery-pipeline.md`, `docs/decisions-site.md`
  and `docs/owner-decisions.ar.md`. No rating UI implementation overlap. Avoid
  editing these shared process files in this slice.
- 60-1 is on main: #738, `68acf312`, with the public view and submit controllers.
  Generated `schema.d.ts` in both admin and POS includes `viewRating` and
  `submitRating`. Opt-out is present in #731 (`04e2de1a`), its one-way database
  guard in #704 (`2f1e63bd`), and business rating settings in #741 (`4c00d37b`).
- `GET /v1/ratings/view`, `POST /v1/ratings/submit`, and
  `POST /v1/ratings/opt-out` exist. Each controller declares `@Public()` and uses
  the dedicated rating-token header. The view exposes business name and state.
- No migration is needed: this slice consumes the existing API contracts and
  introduces no stored state, table, column, grant or database function.
- `apps/menu` does not exist on main. There is no rating-only deployment ADR.
  Spec 060 §11 expressly requires that ADR before code. Next.js, React,
  openapi-fetch, TanStack Query, react-hook-form, Zod and the workspace UI/i18n
  packages are existing technologies; no new library is currently necessary.

## Transport decision to settle before the ADR

The independent address required by RT-Q11 needs an explicit API transport.
`apps/api/src/app.ts`, `enableCors`, takes `corsOrigins`; its `allowedHeaders`
does not include `x-rating-token`. `apps/api/src/main.ts` supplies
`config.AUTH_TRUSTED_ORIGINS`, coupling this list to authentication origins.
Simply reusing the admin client would also send session cookies and tenant
selection, which is inappropriate for this capability-only page.

The recorded technical question in `owner-questions.ar.md` asks the manager to
settle dedicated public CORS versus a same-origin gateway before the deployment
ADR and dependent implementation. No server/DNS/configuration change has been
made. A separate origin must not silently become an authentication-trusted origin.

## Initial verification status at refresh

This is a dependency/transport refresh, not an implementation completion report.
Some combined document reads were truncated; the full mandatory-document reading
is not yet complete and must finish before implementation. No local gates, UI
tests, guard pass, independent review, commit, push or PR has run. No `.env` was
read. Review correction rounds used: 0/5. No merge or deployment is authorized.

## Subsequent manager instruction

The manager authorized the independent shell/UI/hooks/mocked tests while the
connection answer remains PENDING, then instructed this session to report and stop
without pushing. See [the local-gate receipt](60-2-local-gates.md) and
[draft ADR-0058](../../adr/0058-rating-only-menu-shell.md).

The manager subsequently relayed Waleed's option-1 answer on 2026-11-05 at 15:30
and authorized the independent public-route CORS implementation and initial PR.
ADR-0058 is now accepted; the initial PENDING notes above retain the refresh history.
