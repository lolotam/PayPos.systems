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
External correction rounds used: 5/5 (final authorized round).

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

## Correction round 1 — 2026-11-05

The manager authorized one consolidated correction after all bots finished on
`7e6a1a2697ce68eb8522e06fa6a6e2b7c683c06f`. MergePilot receipt `5784562409`
was partial (Waleed_Bot completed 1 of 6 batches); a full receipt is required on
the next head. The original head's required CI check subsequently passed.

- Moved the rating-specific CORS route/header policy to customers/http and exported
  it through the module entry point. app.ts composes it with generic shared CORS.
- Rejected HTTP rating origins outside explicit development/test, including an
  unset NODE_ENV. Added production/staging/unset and development/test cases.
- Corrected the standalone start command and packaged browser assets beside the
  traced server; a real temporary-filesystem test checks the resulting artifact.
- Cancelled outstanding view reads before storing successful submission state.
  A delayed focus-read regression checks that completion remains visible and the
  form does not reopen. Cached open/submitted content survives transient refetch
  failure, while a subsequent unavailable response still hides name and controls.
- Documented the prerequisite workspace dependency build before direct menu commands.

The alleged callback-only CORS CRITICAL was independently checked against installed
`@fastify/cors/index.js`: handleCorsOptionsDelegator explicitly consumes returned
Promises for one-argument delegates. No callback conversion was warranted. Real
createApp HTTP injection tests exercise preflight and ordinary requests on all
three public routes; they complete with the expected headers and generic errors.

Regression evidence before fixes: the three new UI cases failed, and HTTP origins
were accepted in production/staging/unset-environment cases. After fixes:

- API HTTP/config: 43/43 passed; API typecheck and full lint passed.
- Menu: 16/16 passed (14 UI, security headers, standalone packaging); typecheck,
  generated-client freshness and full lint passed.
- lint:docs passed with 0 errors and 29 existing warnings; module-map:check passed.
- clean-code-guard, test-guard and docs-guard applied to the correction diff:
  network-only UI mocks, visible-outcome assertions, real HTTP/filesystem checks,
  module boundaries, installed dependency contract and documentation checked.

No local E2E, full application build, real environment-file read, server change,
deployment or merge was performed.

Independent Codex Astra medium re-review found no concrete defect in the correction
diff and confirmed privacy, module placement, HTTPS enforcement, query cancellation,
cached-state handling and standalone paths. It independently inspected the installed
Fastify CORS Promise implementation and rejected the callback-only allegation.
This was a source-only review: it did not rerun the gates, and it disclosed truncated
long-document output rather than claiming full document coverage. The final local
gate receipts above are from the implementation session, including 16 menu tests.
The review receipt's trailing repository URL was a typo; this slice remains PR #847
in `lolotam/PayPos.systems`.

[Round 1 Astra review](<t3-thread://v2/438824e0-fe19-4a22-bb31-f81eff7b7322/thread:delegated-task:command%3Amcp%3Aba46510b-d393-42b5-ba6b-b58cb66a08fa%3Adelegate-task%3A4fe6a5f5-ffa1-4ed1-a458-23c9a097dcb0>).
Exact-head CI, Codex review and a complete MergePilot panel are required after push.

## Correction round 2 — 2026-11-05

MergePilot receipt `5784957852` on `f45bd5c31e0b1aef2dd7b0bf55320b972c9285d8`
was partial again: Waleed_Bot reviewed 1/6 batches, skipping generated schema batches
and the final configuration/test/catalog batch. All bots had finished. The manager
explicitly authorized round 2 as one consolidated push; a third schema-related
partial receipt must be reported without another push. CodeRabbit is not a gate;
the required exact-head gates remain ci-gate, Codex and the four-bot complete panel.

The alleged HIGH blank-comment validation failure was checked against the source
contract and API. `ratingComment` has no minimum length, runtime parsing accepts
both empty and whitespace-only strings, and SubmitRatingUseCase maps an empty
comment to null. The claimed submission blockage was not reproduced. As requested
by the manager, the form now maps blank textarea values to undefined before schema
validation, so requests omit the optional comment entirely. Nonblank text is preserved.
Two UI cases prove visible completion and the stars-only request body.

The stale submit-error finding was reproduced: a rejected submission followed by
a successful submitted-state read remained unavailable. The submitted view now
takes precedence over that stale submission error. View/opt-out unavailable errors
still close the page. A UI regression checks completion, no reopened star form,
and successful opt-out after another tab consumed the rating.

The manager assigned **PP-127** to the verbatim CORS answer; owner-questions.ar.md
and ADR-0058 now carry it. The manager owns the central owner-decisions.ar.md row
in a separate documentation PR. PP-126 remains reserved for the snapshot rule.

- Before fixes: all three new cases failed (two request-shape assertions and the
  multi-tab completion assertion); star-only completion itself already succeeded.
- After fixes: menu 19/19 passed, including 17 UI cases; typecheck/api:check and
  lint passed. API implementation and contract were unchanged in this round.
- lint:docs: 0 errors / 29 existing warnings; module-map:check passed.
- clean-code-guard, test-guard and docs-guard applied: narrow UI changes, existing
  generated client and schema, network-boundary mocks, visible outcome assertions,
  expiry protection and verbatim owner-answer preservation checked.

No real environment-file read, local E2E, server change, deployment or merge.
New-head ci-gate, Codex review and a complete panel remain required after push.

## Correction round 3 — 2026-11-05

The third panel receipt `5785306748` on `9a90af53850ff70839f31a232d4a2bad0303b084`
remained partial: Waleed_Bot reviewed 1/6 batches and skipped verification and
the final real-file batch as well as generated schema batches. The manager was
informed without an extra push, then explicitly authorized this consolidated
correction at 16:24 Kuwait. No incomplete-review exception was granted.

The panel's cross-file and owner-rules findings concern the same missing PP-127
central index entry. The manager reversed the earlier separate-PR instruction:
PP-127 is now indexed in owner-decisions.ar.md within this PR, with the original
2026-11-05 answer date and a link to the full slice audit. The slice audit and
ADR-0058 reference that entry instead of deferring it. A blank line before the
PP-127 heading also fixes the verified MD022 formatting issue.

Waleed_Bot's sole finding repeats the callback-only CORS allegation. The installed
11.3.0 runtime still explicitly consumes one-argument delegate Promises; the
43-test HTTP/config receipt and source evidence linked in the PR remain valid.
No callback conversion or runtime change is justified by this repeated finding.

PR #842 is the overlapping index writer for PP-124/PP-125. It was open at this
refresh. PP-127 follows the existing latest-number block without copying those
unmerged rows. If #842 merges first, the branch must be rebased rather than
manually copying its file changes. No migration or new library is involved.

This round changes documentation only. New-head ci-gate, Codex and a complete
panel remain required. Any repeated partial receipt that skips the real files
must go to the manager without another push. No merge is authorized.

Round 3 local gates: menu typecheck/api:check, lint and 19/19 tests passed;
lint:docs passed with 0 errors / 29 existing warnings; module-map:check and
git diff --check passed. The index row, date, source-answer link, reciprocal
references and MD022 blank line were checked against the files. docs-guard
passed; clean-code-guard/test-guard found no new production/test-code changes.

## Correction round 4 — 2026-11-05

The manager authorized one consolidated correction at 17:05 Kuwait after partial
panel receipt `5785663004` on `cb02b81509c729ef7d37886b09514e5a2b1c6b2b`.
The review-timeout decision is pending with Waleed as PP-128; the missing real-file
batch is not waived or repaired by this push.

Codex CLI fallback receipt [6659026830](https://github.com/lolotam/PayPos.systems/pull/847#issuecomment-6659026830)
found a real P2: after a successful view, a 404 unavailable read could be replaced
by a later 503/network error while old cached content survived. Before the fix,
both new UI regressions failed because the page displayed that cached content.
The view hook now latches a confirmed RATING_LINK_UNAVAILABLE for the lifetime of
the keyed link session. Later reads, errors and language changes cannot reopen
that session. Navigating to another link creates a new session and resets the latch.
Only view confirmation latches: a conflicting submit still reconciles to submitted
and permits opt-out, as the existing multi-tab regression verifies.

The parameterized UI regression exercises actual mocked GET sequences
200 → 404 → 503 and 200 → 404 → rejected network request. It checks the unavailable
message after the last response and a language change, absent business heading,
star form and opt-out, then a working fresh-link form after navigation.

Hamza's generated-schema placement finding is tracked in
[issue #849](https://github.com/lolotam/PayPos.systems/issues/849), as the manager
directed. No generator or file relocation was made. Menu, admin and POS committed
schemas share blob `fb7e2c99972ace46311e78a5b3676708da01188c`; all are generated
OpenAPI declarations without runtime business logic and have freshness checks.
The follow-up covers a consistent three-app placement decision or an explicit
generated-declaration exception in architecture §6.4, through the owner route.

Local gates: menu typecheck/api:check, lint and 21/21 tests (19 UI plus security
headers and standalone packaging) passed; lint:docs 0 errors / 29 existing warnings.
module-map:check, formatting and git diff --check passed.
clean-code-guard, test-guard and docs-guard checked the latch lifetime, preserved
submission reconciliation, privacy assertions, network-boundary mocks and source
claims. No API/contract/generated-schema changes or new library were introduced.
No real environment-file read, local E2E, server change, deployment or merge.
Exact-head review receipts and complete panel coverage remain required after push.

## Correction round 5 — 2026-11-05

The manager authorized the final single correction push after panel receipt
`5786045396` on `fb5ec0ca1b55b09229760acadec7e4d5f0b936f4`. Its Waleed_Bot receipt
still skipped the real files in batch 6. Waleed has since changed the panel models
and fallback; the next actual receipt, with its batch/file coverage, determines
whether that independent gate is complete. No coverage is inferred from this push.

Both new findings were confirmed before fixing:

- The config accepted a nonempty RATING_PAGE_ORIGIN in AUTH_TRUSTED_ORIGINS.
  A cross-field schema refinement now rejects that configuration at startup with
  the existing key-only error, preserving separate settings and authentication
  behavior. Tests cover a direct overlap and a whitespace-padded list entry.
- Installed openapi-fetch returns an undefined error for an empty non-2xx response
  with content-length 0; without that header the parsed error can be an empty
  string. Both were false successes in submit and opt-out. These mutations now
  use the HTTP response.ok flag and throw a generic typed request error if no
  structured code exists. Real 204 success handling and lost-response
  reconciliation are preserved.

The two config regressions and four parameterized UI cases failed before the fix.
The UI cases exercise submit/opt-out with and without content-length 0 and assert
the visible generic error, absence of completion/opt-out success, retained form,
and successful retry. API/contract shapes, generated clients and login trust
configuration are not expanded. The README and ADR document startup rejection.

No migration, new library, real environment-file read, local E2E, server/DNS change,
deployment or merge. This is round 5/5; a new P0/P1 after it keeps the PR on hold.
Exactly one Codex review request is required after this push, followed by the
new panel receipt and current-head CI. The session does not merge.

Round 5 local gates passed: API HTTP/config 45/45; menu 25/25 (23 UI plus
security headers and standalone packaging); both applications' typecheck and
full lint; menu api:check; lint:docs 0 errors / 29 existing warnings;
module-map:check, formatting and git diff --check. The six new regression cases
failed before the changes and passed afterward. clean-code-guard, test-guard
and docs-guard checked the schema refinement, HTTP-status decision, generic
error fallback, visible retry behavior, unchanged privacy and documented settings.
