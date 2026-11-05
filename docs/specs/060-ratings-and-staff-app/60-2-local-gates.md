# 60-2 independent UI delivery — local verification

Date: 2026-11-05. Base HEAD: `cc085aacd013311f63ba7e5fffc7d98f11a6dcb2`.
The independent UI was initially held uncommitted/unpushed while the connection
answer was pending. The manager relayed Waleed's option-1 answer at 15:30 on
2026-11-05 and authorized API wiring, verification and one initial PR push.
ADR-0058 now records the accepted independent public-route CORS policy.

## Implemented independent scope

- Rating-only Next.js `apps/menu`, using existing repository versions and workspace UI.
- Arabic/English catalogs and RTL/LTR rendering, logical CSS, accessible stars,
  optional comment with the shared contracts resolver, explicit submit and opt-out.
- Loading, completion, consumed-link reopening, unavailable/expired-link and generic
  retry states. Opt-out stays available after rating; opting out does not consume rating.
- Hooks over generated OpenAPI client types, with API base URL from
  `NEXT_PUBLIC_API_URL`, omitted credentials, no tenant selection, no-store and no-referrer.
- Business name/state projection only; token remains in fragment/transient memory,
  outside markup, metadata and query keys. Separate QueryClient per mounted link.
- App headers prevent caching, referrer disclosure, indexing and embedding.
  No analytics, tracker, login or persistence was introduced.
- ADR-0058 retains both alternatives and selects option 1, with deployment excluded.

## Local receipts

| Check | Result |
| --- | --- |
| `pnpm --filter @pospay/menu typecheck` | PASS |
| `pnpm --filter @pospay/menu lint` (includes configured boundaries) | PASS |
| `pnpm --filter @pospay/menu test` | PASS: 2 files, 12 tests (11 UI, 1 header policy) |
| `pnpm --filter @pospay/i18n typecheck` | PASS |
| `pnpm --filter @pospay/i18n lint` | PASS |
| `pnpm --filter @pospay/i18n test` | PASS: 24 files, 96 tests, plus Node smoke |
| `pnpm lint:docs` | PASS: 0 errors, 29 existing warnings |
| `pnpm module-map:check` | PASS |
| `pnpm --filter @pospay/menu api:check` | PASS after regeneration |

Initial checks found missing workspace build outputs; domain/contracts/i18n were
built locally before checking again. The first Vitest fork failed to start; later
normal `pnpm test` runs started successfully. The completion test initially used
HTML tags that the existing shared contract rejects; it now uses permitted plain
text containing angle brackets and ampersand. No contract restriction was weakened.
Formatting the generated API schema made api:check fail; it was regenerated and
added to the existing generated-file Prettier exclusions.

## Guard and independent review

- clean-code-guard: checked hook/UI separation, small components, existing libraries,
  omission of auth/tenant state and explicit error views.
- test-guard: HTTP is the mocked boundary; tests run real hooks, client and forms,
  and assert visible states, privacy, submitted body and credential omission.
- docs-guard: checked route/config/script names against source; pending deployment
  and connection work remain explicitly unperformed.
- Independent read-only Codex `gpt-6-astra`, medium: found one P2. A delayed submit
  for link A could update link B's shared query cache. Fixed by allocating a separate
  QueryClient per mounted link; the added regression test verifies B retains its
  open form after A completes. The targeted re-check below closes this finding.

### Final isolation re-check — 2026-11-05

Codex `gpt-6-astra`, reasoning effort `medium`, independently rechecked the final
five files: `rating-page.tsx`, `rating-session.tsx`, `rating-screen.tsx`,
`use-rating.ts` and `rating-page.spec.tsx`. Result: **no remaining finding on
the isolation fix or its regression test**. Each keyed RatingSession owns a separate
QueryClient; A's delayed callbacks retain only A's client. The test starts a pending
A submission, navigates to B, waits for B's form, resolves A, then asserts that B's
stars remain visible and its completion message is absent.

The reviewer ran
`pnpm --filter @pospay/menu exec vitest run src/ratings/pages/rating-page.spec.tsx`:
**11 tests passed**. This is the reviewer's execution receipt, separate from the
parent's earlier 12-test receipt. The review was read-only and did not read
environment files, run E2E or touch the server.

[Review receipt](<t3-thread://v2/438824e0-fe19-4a22-bb31-f81eff7b7322/thread:delegated-task:command%3Amcp%3Aba46510b-d393-42b5-ba6b-b58cb66a08fa%3Adelegate-task%3A9955fc14-bfac-4ad6-afe9-43513e6cba4c>).
This closes only the UI-isolation re-check; it does not approve CORS or live integration.

### Mandatory reading completion — 2026-11-05

The previously truncated passages were read again in smaller ranges. The six
governing references are now fully read: `CLAUDE.md`, `CLAUDE.architecture.md`,
`docs/06_Tech_Stack_Architecture_EN.md`, `docs/module-map.md`,
`.specify/memory/constitution.md` and `docs/PRD.md`.
The delivery pipeline and `.claude/skills/pospay-pipeline/SKILL.md` are also fully read.
The required spec 060 rows 60-1/60-2, RT-Q11 and its ADR obligation, D-B9–D-B11,
RT-15–RT-21 and ADR-0011 including its 2026-10-31 addendum were covered.

Owner-decisions §§55–61 were read from this checkout. Sections 62–63 are absent
from its baseline, so they were read from PR #842 head
`56c4fceca6a59660b595f371bbecd343d2a39241` through GitHub's file API.
That PR remains unmerged at the read; no process-file changes were imported.
PP-124/PP-125 do not override this slice's explicit no-merge instruction or
the manager's current no-push fence.

## Remaining and fences

The connection answer is recorded verbatim in the owner-question audit.
The API uses `RATING_PAGE_ORIGIN` separately from authentication trust and the
page calls its configured API origin with omitted credentials. API-specific
verification and review are recorded below before PR work.
The earlier mandatory-reading gap and the UI-isolation re-check are now closed.
API public-route CORS changes are now authorized. AUTH_TRUSTED_ORIGINS, Traefik,
server, DNS and Dokploy settings remain unchanged. No migration, local E2E,
deployment or merge is part of this slice. Only the explicitly authorized
`.env.example` template was read/edited; no real environment file was opened.
External correction rounds used: 0/5.

## Connection verification — 2026-11-05

- `pnpm --filter @pospay/api exec vitest run --config vitest.public-rating.config.ts`:
  PASS, 2 files / 38 tests. It uses the real application and HTTP injection with
  database capabilities absent, not a mocked CORS plugin or a shared database.
- `pnpm --filter @pospay/api typecheck` and `pnpm --filter @pospay/api lint`:
  PASS. Scoped lint also passed after the final composition-root correction.
- The policy tests cover all three public paths, exact allowed origin, other origins
  including a login-trusted origin, absence of allow-credentials and set-cookie,
  default-disabled public CORS and unchanged authenticated-route policy.
- Config tests reject wildcard, opaque origin, paths, credentials, queries,
  fragments and multiple origins; setting the public origin leaves login trust unchanged.
- Menu checks repeated: typecheck (including api:check), lint, 12 tests PASS.
  i18n typecheck/lint and 96 tests plus Node smoke PASS.
- `pnpm lint:docs`: PASS, 0 errors / 29 existing warnings.
  `pnpm module-map:check`: PASS after correcting the composition-root import.
- The first API typecheck overlapped the initial dependency builds and could not
  resolve auth build outputs; those builds finished before the repeated check.
  A missing FastifyRequest annotation was also corrected. The first module-map
  run rejected a module import from shared/cors; app.ts now injects the existing
  company header, so shared code imports no business module.
- Open PR overlap was rechecked: #842, #844, #845 and #846 have no overlapping
  implementation files. The baseline still equals origin/main at this refresh.
- clean-code-guard, test-guard and docs-guard were applied to API code/tests and
  the accepted ADR/audit: no new library, business arithmetic, tenant access,
  cookie/session creation, raw token logging or live deployment claims.

Staging needs API `RATING_PAGE_ORIGIN` set to the real page origin, and menu build
`NEXT_PUBLIC_API_URL` set to the API origin. No live value was provisioned.

### Final API/security review

Independent read-only Codex `gpt-6-astra`, reasoning effort `medium`, returned
**no concrete defects in the reviewed scope**. It confirmed the exact three-route
CORS policy, validated single origin, absent credentials, unchanged authentication
trust/proxy/admission and public disclosure limited to business name and allowed
form/status/opt-out. It also confirmed the token is absent from query keys, DOM and
metadata and that the client omits credentials and uses no-store/no-referrer.

The reviewer independently ran the HTTP/config command above: **38/38 tests passed**.
It reviewed uncommitted changes above the recorded base; no DB, E2E, real environment
file, server or live deployment was involved. This is a code-review receipt, not
merge approval or live-integration proof.

[Final API/privacy review](<t3-thread://v2/438824e0-fe19-4a22-bb31-f81eff7b7322/thread:delegated-task:command%3Amcp%3Aba46510b-d393-42b5-ba6b-b58cb66a08fa%3Adelegate-task%3Ae616d37d-5471-47ad-bd7b-6de97d4541ad>).
Exact-head CI and external PR reviews remain outstanding until the PR runs them.
