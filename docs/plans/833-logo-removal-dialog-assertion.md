# #833 — asynchronous logo assertion

Issue: <https://github.com/lolotam/PayPos.systems/issues/833>.
Feature rules: [spec 052](../specs/052-settings-business-identity/spec.md) and its [owner answers](../specs/052-settings-business-identity/owner-questions.ar.md).

## Baseline and ownership

- Checkout: `C:/Users/waleed_Mohamed/.t3/worktrees/main/fix-833-logo-removal-dialog-assertion`.
- Branch: `fix/833-logo-removal-dialog-assertion`.
- Intended baseline, current HEAD and live main: `ec26930497f25213b62e2b60bc603af6b9ba3527` (verified with `git ls-remote origin refs/heads/main`).
- Working tree was clean before this document; setup and baseline-test receipts are below.
- Test blob: `ce46fb3deec90adc2c64a2019e20a5e4e6af2959`.
- Test SHA256: `4CBB22F1DDC53F560B5ADF06DD5AEA8372611E6D95A4F4070B443900B8F13190`.
- Exclusive tracked scope: `apps/admin/src/business-identity/pages/business-identity-round5.spec.tsx` and this document only.
- Scoped status and baseline-to-HEAD comparisons found no overlap in the manager and #901/#828/#830/#887 checkouts.
- Budget: at most 80 total added/deleted lines, including this document; production changes: zero.

## Evidence and approved change

The named removal/new-upload test awaits the ready notice, then synchronously reads the `Shop` image.
`useBusinessLogo` sets ready after refreshing identity; `useLogoDownload` separately requests the preview URL.
`LogoPreview` renders a loading status until that download succeeds, so ready does not guarantee an image exists.
The adjacent upload test already waits for both the image and its expected `src` using `waitFor`.
The issue reports a failing CI run and a successful same-head rerun; the original local spec passed, so that historical failure was not reproduced.
The manager accepted this mechanical plan and the tiny-fix exemption; no new Opus planning or PP-136 consultation is required for this unchanged assertion.

## Bounded implementer brief

Initial author: T3 `acpRegistry_minimax_code`, exact model `m:minimax:MiniMax-M3.1-Flash:v:thinking`.
Read `AGENTS.md`, its required documents, `docs/agent-delivery-pipeline.md`, spec 052 and this document before editing.
Use file reads/edits only inside this checkout; no shell, git, MCP, network, secrets, env files or subagents.
Edit only the named test: wrap its existing new-image/expected-src assertion in `await waitFor(...)`.
Keep the expected `https://files.test/${mine}` value and the subsequent closed-dialog assertion unchanged.
No production changes, sleeps, timeout changes, test retries, snapshots, assertion weakening or unrelated reformatting.
Stop after authoring the test; the orchestrator must personally read the diff before running it.

## Validation and handoff

The direct #901 release was received; no cluster or credentials transferred. CPU counter samples were 37.69/50.54/39.91/42.66/36.22%; the initial WMI reading was 100%.
`pnpm install --frozen-lockfile` passed (35.8s), with no lockfile diff. `pnpm exec turbo run build --filter="@pospay/admin^..." --concurrency=1` passed: seven dependency builds restored from the configured Turbo cache; no admin app build.
Before editing, `pnpm --filter @pospay/admin exec vitest run src/business-identity/pages/business-identity-round5.spec.tsx` passed: one file, seven tests, exit 0, 38.91s.
Personally reviewed the MiniMax diff: five test lines added, three deleted; expected URL and closed-dialog assertion preserved. No other tracked file changed.
After editing, the same focused spec passed: one file, seven tests, exit 0, 9.36s. No sleeps/timeouts/test retries or extra stress runs were added.
`pnpm --filter @pospay/admin typecheck`, `pnpm --filter @pospay/admin lint` (includes boundaries; zero errors, 14 warnings in unchanged files), and `pnpm --filter @pospay/admin api:check` passed.
`pnpm lint:docs` (zero errors, 29 existing warnings), `pnpm module-map:check`, `pnpm exec prettier --check apps/admin/src/business-identity/pages/business-identity-round5.spec.tsx`, and `git diff --check` passed.
Use no DB/Redis containers for this mocked UI test; no borrowed dependencies or environment files.
Personal `test-guard` and `docs-guard` passes found no issue in the change; independent Astra review remains required before PR publication.
Correction rounds used: zero. Local scoped gates passed; internal review, PR, CI and all five external exact-head reviews remain pending.
Local install/build/check/test commands exited; no DB/Redis resource was created. Resource turn released directly to #828 with a manager receipt; an unavailable next consumer must not reserve the idle machine.
Merge still requires fresh tested base, resolved findings, verified applicable backup/restore and the manager's coordinated order; no deployment is included.
