# 46-2a G implementation receipt

Status: implementation prepared; chronological receipts below distinguish initial failures and later gates. No commit, push or PR.
Base/head: `37451b222c44e9978950b19546a9e16841671542`.
Initial branch: `t3/b8c9d7ff`; current branch `T3-CODE/imported-refunds-g-owner-policy` (rename receipt below).
Checkout: `C:\Users\waleed_Mohamed\.t3\worktrees\main\t3-b8c9d7ff`.
Initial `git status --short`: empty. Identity commands exited 0.
Authorization was copied before source edits; planning brief/card remain in the
read-only planning checkout. No additional agent/session/checkout was created.

## Scope

`permission-policy.ts` declares a runtime policy catalog containing the future
code, independently of the activation catalog. Runtime enumeration deduplicates
the future code for S. Human global roles accept personal grants without looking
up a missing ROLE_DEFAULTS cell. Custom-role eligibility remains unchanged.
Identity owner-granted and owner-only-edit lists protect SAVE ALLOW, SAVE DENY
and REVOKE in the shared company/business use cases before expiry/insert/audit.
Existing self, owner, scope, lifecycle and possession checks remain in place.
Device policy excludes the code from role grants and ALLOW overrides; DENY stays.

PERMISSIONS, ROLE_DEFAULTS entries, seed implementation, schema and migrations
are unchanged. No setting column/read, S route, worker consumer, generated file,
deployment or production environment/secret access was added. Synthetic permission/default INSERTs
exist only in the integration fixture to model post-S state. Authorized local test
setup and execution are recorded chronologically below.

## Reader inventory

The shared policy reaches API identity `access-reader`, `permission-editor-context`,
`service-session-access`, `service-session-edit-access`, `attendance-change-access`,
queries `membership-permissions`, `permission-business-scope`,
`discount-limit-editing`; staff `employee-number-list-access` and
`attendance-report-access.adapter`; worker identity `business-permission-holders`
and `discount-approver-recipients`. Fixed-code consumers retain their existing
requested codes; no new worker consumer is introduced. Permission history is not
effective access. Actual device gates in session/access guards are unchanged.

## Initial child lightweight validation (historical)

- `node --input-type=module -` with inline `node:assert/strict` matrix importing
  the actual permission-edit, activation catalog, role-defaults and policy modules:
  exit 0; exact output `PASS 43 pure assertions; no DB, dependencies, env or build`.
  Matrix: SAVE/REVOKE, ALLOW/DENY, company/business management, staff/custom,
  owner/non-owner; missing catalog, unrelated unknown code, self-edit, wrong
  business, expired membership, device ALLOW/DENY; inactive catalog/default,
  deduplication and equality of identity/DB owner-granted lists.
- `git diff --check`: exit 0; only Git CRLF-to-LF warnings for the three tracked
  edited source files. No whitespace error.
- `node --check <file>` on all seven changed/new TypeScript files: syntax only;
  this does not resolve imports or prove TypeScript types.
- Dependency preflight: `node_modules/.bin` does not exist in this checkout.
  No install, Vitest suite, lint or typecheck was run. Exploratory reads of two
  guessed test filenames and one guessed schema filename failed with
  `Cannot find path` / `The system cannot find the file specified`; subsequent
  fixture discovery used rg. Those reads are not test failures or successful gates.

## Initial deferred gates (historical; completion receipts below)

1. Run the new pure Vitest specs plus existing identity permission-edit and DB
   system-role-policy/default regression suites after dependencies are available.
   DB's default Vitest config has globalSetup: do not use it for a pure-only run.
2. Manager assigns a DB slot serialized with #897 before integration execution.
   New `imported-refunds-guard.spec.ts` covers pre-S catalog refusal/G seed inactive,
   post-S owner grant/read/revoke for global humans/custom roles, both HTTP paths,
   non-owner SAVE ALLOW/DENY/REVOKE with unchanged overrides/audit, device write
   refusal and privileged synthetic role/override ALLOW inertness with DENY retained.
   These assertions are written, not executed. No Docker/SQL execution occurred.
3. Scoped typecheck/lint/docs/boundaries/module-map and formatting; DB integration,
   heavy build/CI, fresh Astra high code/security/DB review, exact-head PR checks,
   applicable backup/restore and coordinated merge/release evidence belong to lead.
4. S remains forbidden pending G merge, explicitly authorized G deployment/U
   evidence and Waleed's migration authorization. No rollout/config choice made.

Correction rounds: initial implementation only; no independent review performed.
Recommended next step: lead reads diff, arranges dependencies and serialized gates,
then requests the authorized fresh Astra review. This is not a merge-ready claim.

## Lead intake

The lead read every changed source/test and the fixtures. Current branch at intake
is `T3-CODE/imported-refunds-g-owner-policy`; path and HEAD match the child's receipt.
Child receipt establishes isolated source preparation; the earlier manager notice
only established dispatch start. No exact first-edit timestamp is claimed.
Lead fixes: the existing owner-default integration matrix now explicitly expects
FORBIDDEN for this unseeded future code, preserving active-code assertions; the
new non-owner REVOKE matrix now covers stored DENY as well as stored ALLOW.
Both DB validations remain unexecuted. Dependencies are absent in this checkout
and the planning checkout. No install or borrowed dependency tree was used.
Full planning/card custody belongs to the parent 46-2a session and its hash-verified
archive under `.t3/task-archives/46-2a/planning-37451b2-r1`; these are not PR G files.
They remain in the combined G+S accounting and must transfer before any cleanup.

Lead `node packages/config/scripts/lint-docs.mjs`: exit 0, 0 errors, 29 existing
TODO/brand warnings. Lead diff check passed. Current ALL including this receipt:
370 at that checkpoint (361 additions + 9 deletions), 10 files, generated 0.

Branch reflog confirms `Branch: renamed refs/heads/t3/b8c9d7ff to
refs/heads/T3-CODE/imported-refunds-g-owner-policy` at the same HEAD; no actor is
attributed and no branch repair was performed. Manager subsequently authorized
one child-only `pnpm install --frozen-lockfile --prefer-offline` using packageManager
pnpm@12.5.1, only AFTER 50-2b-c3 sends install/static completion handoff.
That receipt is still pending; installation has not started. Then run scoped
typecheck/lint/module-map sequentially; DB retains #897 priority, and any necessary
dependency build requires the actual error and minimum command before execution.

## Authorized install/static slot completed

50-2b-c3 handed off the slot. One `pnpm install --frozen-lockfile --prefer-offline`
ran here with pnpm 12.5.1: exit 0, 45.3s, 1024 reused, 0 downloaded. Pre/post
SHA-256 values for package.json, pnpm-lock.yaml and pnpm-workspace.yaml match;
none has a tracked diff. No workspace install lifecycle hooks were found; existing
allowBuilds policy remained unchanged. No install in the parent checkout.
Sequential `node node_modules/typescript/bin/tsc --noEmit -p <config>`:
packages/db/tsconfig.json exit 2 (87 TS2307, one TS7006); apps/api/tsconfig.json
exit 2 (3813 diagnostics, including 1731 TS2307). Full logs retained outside source
at `C:\Users\waleed_Mohamed\.t3\task-archives\46-2a\g-validation`.
Workspace exports target absent dist declarations; this is a demonstrated blocker,
not proof that every other diagnostic is cascading or that the code typechecks.
Scoped ESLint initially found six forbidden non-null assertions in new tests;
lead replaced them with explicit fixture checks. Rerun exit 0, existing boundaries
deprecation warnings only. `node scripts/module-map/cli.mjs check`: exit 0.
All owned install/static processes exited; manager and 50-2b-c3 received immediate
resource-release messages. No DB, build or Vitest suite ran, and no reinstallation.
Proposed minimum follow-up: dependency-only API closure, sequential, excluding the
API/worker app build: `pnpm --filter '@pospay/api^...' --workspace-concurrency=1 run build`.
Requires script/graph review and manager's scheduled authorization before execution.
DB retains #897 priority; Astra/PR follow gates. ALL: 410 (401 added + 9 deleted), 10 files, generated 0.

Manager authorized that exact dependency-only build AFTER 50-2b-c3 releases its
worker dependency/static slot, then DB/API typecheck once each sequentially.
Read-only pnpm filtered list confirms 12 packages and no apps/API/worker: config,
auth, db, domain, ids, observability, commissions-engine, contracts, i18n,
notifications, storage, import-workbooks. Config has no build; all other build
scripts are `tsc -p tsconfig.build.json`, with no prebuild/postbuild/prepare hooks.
Build configs emit only to each package's dist; no generator/migration/service
command. Receipt pending: no dependency build or repeated typecheck started yet.

## Dependency build and typecheck handoff completed

After the explicit 50-2b-c3 resource release, the exact authorized pnpm dependency
build exited 0: eleven tsc invocations, config without build, no app build.
One DB typecheck then one API typecheck each exited 0 with empty diagnostic logs.
The prior 88/3813 diagnostics are resolved in these actual reruns, not assumed so.
Full logs: api-dependencies-build.log, db-typecheck-after-build.log and
api-typecheck-after-build.log under the archive directory above. The first log's
PowerShell NativeCommandError formatting wraps pnpm's stderr tsc command echo;
the process exit is 0 and there are no TypeScript/build errors.
All owned operations ended; manager and 50-2b-c3 were notified immediately.
No DB/Vitest tests ran. ALL now 432 (423 added + 9 deleted), 10 files, generated 0.


## Isolated slice tests and resource release ? 2026-11-07

Read PP-138 from `docs/owner-decisions.ar.md` item 95 (imported 2026-11-11 from the manager's local section 74); no copy in this PR.
After card 3 released resources, official lane `g46-b8c9d7ff` ran on
127.0.0.1:55407, with worktree ownership and start label
`555042f8-eccc-494e-8d76-9ecf96c4160f`. Separate owned Redis used 127.0.0.1:56346,
start `59151d68-1556-402e-a761-c8a95b79d7f9`. Fresh random synthetic values were
written exclusively to ignored .env; no existing secrets were read or copied.
Only existing migrations prepared the isolated test template; no S artifacts.

- Initial CLI used a nonexistent root Vitest path: MODULE_NOT_FOUND before tests;
  corrected to the verified package-local CLI, without another install.
- API unit config: imported-refunds-permission-edit, exit 0, 5/5 tests passed.
- DB config: imported-refunds-policy, exit 0, 15/15 tests passed, 25.34 seconds.
- API config: imported-refunds-guard plus documents-owner-default, exit 1,
  25 passed / 1 failed, 170.88 seconds. Expected PERMISSION_OWNER_ONLY, received
  FORBIDDEN in the human grantee mutation case. This is not an integration PASS.
- Logs: g-pure.log (CLI error), g-pure-run.log, g-db-policy.log, g-api-db.log
  in the existing external g-validation archive. No timeout/load adjustments.

Source triage: general_manager has neither membership-management permission in
ROLE_DEFAULTS nor the system-role optional eligibility list; synthetic ALLOW
rows therefore do not establish the writer authority claimed by this fixture.
The fixture now restores its custom editor role and explicitly asserts real
AuthorizeRequest success for both management permissions and the future code
before asserting owner-only mutation refusal. No production or assertion
weakening; this correction is Written, NOT Passed until the next scheduled run.

Both owned containers were removed after exit; official lane down removed its
volume and override, and Redis ownership was checked before removal. No owned
process remains. Direct release sent to #896, card 3 and manager; next resource
owner is #896, or card 3 after its explicit relinquishment. Astra/PR remain gated.
Current ALL = 476 (467 additions + 9 deletions), 10 files; generated = 0; cap 1550.


## Corrected API slice and regression results

After card 3's actual resource release, official lane up created a new owned
Postgres instance at 127.0.0.1:55407 (start 16b61ccb-7bee-45b5-8a23-43c9998d45eb)
and isolated Redis at 127.0.0.1:56346 (start 9bb08725-b0bf-4252-ac39-5a470f71147b).
Only the previously generated local synthetic test values were loaded by tooling;
no values were printed, copied from another checkout or used with shared services.

Corrected imported-refunds-guard: exit 0, 5/5 PASS, 59.44 seconds.
Existing permission-edit/business-permission-edit: exit 0, 72/72 PASS.
Existing system-role-policy/role-defaults: exit 0, 1439/1439 PASS, 28.78 seconds.
The unchanged documents-owner-default already passed in the first API run.
Logs: g-api-db-corrected.log, g-domain-regression.log, g-db-regression.log.
The earlier API failure remains preserved separately. No assertions, timeouts,
production grants or migration files were relaxed to obtain these results.
Scoped Prettier formatting and ESLint exited 0; lint retains existing boundaries
warnings only. Both owned services and the lane override/data were removed.

Guard-pass review: clean-code-guard found no new production abstraction, hidden
fallback, boundary crossing or activation; policy and seed stay separate.
test-guard verified real infrastructure, observable refusal/no-write assertions,
positive authority prerequisites and human/device read paths; no internal mocks.
docs-guard clarified historical receipts versus current results; no deploy/U or
merge-readiness claim. Fresh Astra code/security/DB review remains pending.
Final DB/API typecheck, module-map and lint:docs exited 0; scoped formatting check passed. All operations ended and resource-release receipts were sent directly. ALL = 638 (628 additions + 10 deletions), 10 files, generated 0; cap 1550.


## Independent review and publication gates

Fresh gpt-6-astra high code/security/DB review, round 1: PASS, no findings.
The reviewer read all 10 files including untracked changes (638 ALL at review).
No tests were rerun by the read-only reviewer. Live fetch confirmed origin/main
still 37451b222c44e9978950b19546a9e16841671542 before publication.
PR CI, four MergePilot panel receipts, final-head Codex, applicable backup/restore
and coordinated merge order remain required; this receipt is not merge approval.
Synthetic post-S rows prove policy behavior, not old-image rollout or U evidence.
S/activation remains blocked by its independent migration/deployment/U gates.
Published inventory after this receipt: 652 ALL (642 additions + 10 deletions),
10 files; generated 0. Planning documents remain in their recorded durable custody.


## Panel review round 1 triage

All four panel reviews completed on f4887e4c0e550c2ef580369e5c16f7ca697e8c9b.
Codex also completed automatically on PR-open with no findings; no manual trigger
was sent for that head. Hamza's stale-JSDoc finding is accepted and corrected.
The seed import finding is disputed: architecture section 3.1 and the enforced
module entry-point rule concern another backend module's internals. This test
uses the same privileged test-setup seed source as apps/api/test/harness.ts:28,
identity/access-guard.spec.ts:24 and identity/onboard-company.spec.ts:12.
seedReferenceData is intentionally not exported by packages/db/src/index.ts:71;
adding a production export solely for privileged test setup broadens the public
surface. No production import, package export or activation behavior is changed.
Fresh Astra high recheck: PASS on both items, no new P0/P1. The first recheck
attempt disclosed truncated governing reads and was not counted as complete;
a fresh replacement read all 3783 governing lines, recovered the truncated
module-map section, and independently confirmed the scoped import rebuttal.

Initial CI run 42357274997 passed in 12m40s (08:52:00Z?09:04:40Z).
Its checkout log proves merge 1266cfb07c77f3ce46c29e4d578bf8f237626deb, with
base parent 37451b222c44e9978950b19546a9e16841671542 matching live main.
One consolidated comment/documentation correction follows the completed panel;
new-head CI/panel/final Codex and backup/restore/order remain required.
The comment initially failed formatting; Prettier corrected it and the check then passed.
Docs lint exited 0. No behavior changed and no DB test rerun was needed for this correction.
Round-1 published inventory: 681 ALL (670 additions + 11 deletions), 10 files, generated 0; cumulative published churn 681 (initial 652 + correction 29), within cap 1550.
