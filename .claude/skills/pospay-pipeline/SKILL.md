---
name: pospay-pipeline
description: "PosPay's fixed delivery pipeline, decided by the owner (Waleed) on 2026-10-07 and updated 2026-10-20. Use it for every row of a phase implementation plan, every new slice or use case, and every fix PR that touches production code in this repo. It pins who does each role (MiniMax-M3.1-Flash via opencode implements, Codex and the MergePilot panel review, Claude orchestrates), the review-round cap, the parallel-task cap, the database review, the guard pass, the staging deploy, the status page and the owner report, so they are never re-asked. It runs on top of waleed-implementation-v2 and replaces that skill's questions and fallback chains for this project. Not for a typo or a question. A docs-only change follows the docs-only lane (§2), and every merge, docs-only included, still updates the decisions page's status tab (§6 step 8)."
---

# PosPay delivery pipeline

You are the **orchestrator** (Claude Code in the owner's session). You do not write large amounts of production code
yourself. You write specs and briefs, dispatch the lanes below, judge every delivery, run every gate, and land the
work.

**Precedence.** The project documents win over this skill: `CLAUDE.md`, `CLAUDE.architecture.md`,
`docs/06_Tech_Stack_Architecture_EN.md`, `docs/module-map.md`, `docs/adr/*`. This skill wins over
`waleed-implementation-v2` for PosPay: use v2 for its process mechanics (baselines, judging deliveries, landing order),
but take the lanes, limits and answers from here and **do not ask v2's Phase 0 questions** — they are answered below.
If a rule here conflicts with a project document, follow the document and tell the owner this skill must be fixed.

The code rules live in `CLAUDE.md` and `CLAUDE.architecture.md`; every brief points the implementer at them (§4).

---

## 1. The lanes

| Role | Who (friendly name → live id) | Writes files? |
|---|---|---|
| Orchestrator | Claude Code (this session) | yes — specs, briefs, merges, renumbering, small fixes |
| Design advisors (risky slices only, §3 step 2) | Codex astra 6 medium (`gpt-6-astra`, effort medium) **and** Claude Fable 5.1 medium (`claude-fable-5-1`) | no — read-only |
| **Implementer** — code, tests, migrations **and PR-finding fix rounds** | **Only opencode `minimax-coding-plan/MiniMax-M3.1-Flash`** (default variant) — owner's rule 2026-10-20 (PP-10.1, tightened the same day: no new Grok or Codex implementation runs; a run already in flight may finish its current round). Every MiniMax brief bans all git commands, edits outside the task, unrelated reformatting and line-squashing to dodge `max-lines`; the reviewer diffs every rewritten SQL function body against the old one and reviews money, DB and permission changes strictly | yes, in its own worktree |
| **Database reviewer** | **Codex astra 6 medium** (`gpt-6-astra`, effort medium, `codex exec -s read-only`) | no |
| Review layer 1 | **Codex astra 6 medium** (`gpt-6-astra`, effort medium, `codex exec -s read-only`) — owner's choice 2026-10-11 | no |
| Review layer 2 | **one** fresh Claude reviewer, **Sonnet 5.5 at medium effort** (`claude-sonnet-5-5`), given the diff, the spec and the governing documents (§8 rule 5), never the session history; **high** effort for money, tenant isolation (RLS), auth and migrations; none for a docs-only PR (§8 rule 5) | no |
| Review layer 3 — **four bots** | the Codex GitHub bot (`chatgpt-codex-connector[bot]`, `@codex review` after every push; Codex CLI when out of quota) **and** the MergePilot panel (`mergepilot-review[bot]`): MergePilot (`gpt-6.1-sol`), waleed_bot (`claude-sonnet-5-5`), mohamed_bot (`grok-4.7`), which reviews every pushed commit on its own | no |
| Draft writer (§8 rule 6) | MiniMax writes first drafts of specs, ADRs, journey docs and the HANDOVER; the orchestrator edits and owns the result | yes |
| Fixer | the implementer, continuing **its own MiniMax session** with only the findings (§4), for every production-code finding, a one-line one included (PP-10.1); the orchestrator (or a doc-writing session) only for a fix on a docs-only PR, where no implementer session exists | yes |
| Staging server | the orchestrator only, over the `abdulaziz` SSH profile | — |

Before the first dispatch of a session, check the model with `opencode models`, which runs no inference. Its output must
list `minimax-coding-plan/MiniMax-M3.1-Flash`. Never probe it with a bare `opencode run`: that would run the model
before §4's guarded setup, under opencode's default, unrestricted permissions. An auth or quota failure then shows on the
first guarded run, as a nonzero exit (§4 rule 8). If the model id is gone, or a run fails on auth or quota, stop and
ask the owner. Never substitute another provider (PP-10.1). On a quota stop, hold and resume the same session after
the renewal.

---

## 2. Limits

- **Review rounds: at most 5 per PR**, counting every review → fix cycle across all three layers and the database
  review. After round 5, sort what is left by severity:
  - **P0 / P1** (security, money, tenant isolation, data loss, correctness): both design advisors propose a fix, the
    implementer applies it, and the PR **stays blocked** until it is fixed and confirmed. The cap never lowers the bar.
  - **P2 / P3**: open a GitHub issue per finding, linked from its review thread, then merge.
- **Parallel work: at most 3 tasks at once**, and only when their file paths are **disjoint**. Two tasks that touch the
  same file wait for each other. Each task has its own branch, worktree (`F:\Dev\Worktrees\PosPay\<branch>`) and PR.
  Migration and ADR numbers are assigned **at merge time**: renumber the later PR after the earlier one lands. Each
  slice still merges only when it is green on its own head (constitution Principle I, as amended 2026-10-07).
- **One use case per PR** (`CLAUDE.md` §1). A task that needs two use cases is two PRs.
- **Docs-only lane** (owner, 2026-10-17). A PR whose files are all under `docs/**`, `*.md`, `.claude/skills/**` or
  `.specify/**` (no code, no migration, no generated file) skips §3 steps 2, 5 (except `docs-guard`), 6, 7, 8 and 14, needs no implementer dispatch (§3 step 3; specs and ADRs are drafted by MiniMax and edited and owned by the orchestrator, §8 rule 6) and no spec (§3 step 1) unless the PR is itself a spec, judges §3 step 4 by `pnpm format:check` (`prettier --check .`, which covers Markdown) instead of the full `pnpm check`, and skips the
  5-round cap. It merges when `ci-gate` is green on the exact head, the Codex bot and the MergePilot panel have
  completed on that head, and no P0/P1 is open. A P1 here means a wrong or contradictory rule in any governing or operational document (a spec, an ADR, `CLAUDE.md`, a skill, `docs/security.md`, a runbook); the bar
  for it does not move. P2/P3 findings on prose are fixed in one batch commit at most; the rest become linked issues.
  The status-page update (§6 step 8) still applies after the merge.
- **waleed_Bot failing (PP-5.2, owner, 2026-10-19).** While **waleed_Bot** returns `❌ failed` on every review,
  "the panel completed" means every *other* panel bot completed on the head. The Codex bot must still complete, and
  no P0/P1 may be open. The merge report names waleed_Bot's failure. The exception covers waleed_Bot only and ends when
  it completes again. Any other bot that fails blocks the merge until the owner decides.

---

## 3. The steps

| # | Step | Owner | Done when |
|---|---|---|---|
| 0 | Pick the next row of the phase plan, or the task the owner names | orchestrator + owner | row named in the report |
| 1 | Spec: `/speckit-specify` → `docs/specs/NNN-<module>-<use-case>/spec.md`; owner questions → the slice's `owner-questions.ar.md` (a question that belongs to no slice, such as a pipeline, docs or process rule, goes to `docs/owner-decisions.ar.md` instead), then routed by kind (`CLAUDE.md` §1 5b): charges/money → a new numbered batch on the decisions page; every other question → Waleed through his super agent; a feature's questions are asked together before its first sub-PR, one batch per destination, never a mixed batch | orchestrator | every business rule is in the spec or asked; an unknown rule is a `TODO(spec)` and a stop. **Ask the whole feature at once** (owner, 2026-10-17): before the first sub-PR of a feature starts, list every sub-PR in the plan, collect all of their owner questions, one numbered batch per destination (money on the page, the rest to Waleed), and add a clickable mockup (an HTML artifact, or a Lovable prototype) when the answer is a screen; late-found questions are the exception, not the routine |
| 2 | Design advice — **only** when the slice parses files, runs long work, may cross 200 ms, moves money, or changes auth/RLS | both advisors, read-only | the chosen design is written into the spec |
| 3 | Brief and dispatch the implementer (§4), baseline captured first | orchestrator → MiniMax | MiniMax reports done; the delivery is kept as the first commit, as delivered |
| 4 | Judge the delivery: diff against the baseline, read it against the spec, merge `main`, renumber migrations/ADRs, `pnpm check` | orchestrator | `pnpm check` green |
| 5 | Guard pass: `clean-code-guard` on production code, `test-guard` on tests, `docs-guard` on docs (global `CLAUDE.md` guard workflow) | orchestrator | findings fixed or recorded |
| 6 | Database review — **mandatory** when the PR touches `packages/db/**` (schema, migration, RLS, grants, seed) | Codex astra 6 medium | no open P0/P1 (§5 checklist) |
| 7 | Review layer 1 | Codex astra 6 medium | findings fixed by MiniMax in its continued session, or deferred per §2 |
| 8 | Review layer 2 — one Sonnet 5.5 reviewer (§8 rule 5); no separate confirm round, the four bots confirm on the head SHA in step 9 | fresh Claude reviewer | its findings fixed by MiniMax or deferred per §2 |
| 9 | Push, open the PR (spec link + checklist), comment `@codex review` | orchestrator | **all four bots answered on the head SHA**: Codex summary says Completed for that SHA, the MergePilot review for that SHA shows all three bots completed (a failing waleed_Bot is handled by the PP-5.2 exception in §2), and every inline finding is fixed or deferred per §2 |
| 10 | CI `ci-gate` green **on the exact head being merged** | GitHub Actions | green |
| 11 | Merge: `gh pr merge <n> --squash --delete-branch --match-head-commit <reviewed-sha>` — a push after the reviews makes the merge fail instead of landing an unreviewed head | orchestrator | merged |
| 12 | Deploy to staging (§6) | orchestrator | `/ready` answers ready on the new SHA |
| 13 | Update the decisions page's «المشروع أول بأول» tab (§6 step 8) | orchestrator | `roadmap.json` pushed to `lolotam/plan` and live |
| 14 | Journey doc `docs/journey/NN-<name>.md` (Arabic + English) in its own docs PR | orchestrator | merged after Codex review |
| 15 | Owner report (§7) | orchestrator | sent |

After **every** push, comment `@codex review` again — the Codex bot reviews automatically only when a PR is opened;
the MergePilot panel reviews each pushed commit by itself. Read every result before merging (owner, 2026-10-14):
`gh api repos/lolotam/PayPos.systems/pulls/<n>/reviews` (one review per bot run and commit) and
`gh api repos/lolotam/PayPos.systems/pulls/<n>/comments` (inline findings, "Found by: …" names the MergePilot bots).

---

## 4. Dispatching MiniMax (opencode)

MiniMax runs through the **opencode CLI** (`opencode` on `PATH`, under `F:\Dev\Runtimes\npm-global`). The model is
**`minimax-coding-plan/MiniMax-M3.1-Flash`**, on Waleed's flat-rate coding plan. That provider offers no `#high`
variant, so the model runs at its default. The `opencode-delegate` skill holds the run and relay mechanics. This section
pins the PosPay rules on top of it.

1. **One session per task.** Give the first run a session id with `-s`, and record it in the task's notes
   (`F:\Dev\Worktrees\PosPay\briefs\<task>\sid.txt`). The installed opencode CLI (v2.0.32) documents `-s` as
   "Session ID to continue, or to create if it does not exist". If a later version stops creating it, run round one
   without `-s`, take the generated id from the `--format json` output, and use that id from round two on. Run it from
   the worktree:

   **MiniMax has no shell (Waleed, SA-7.1, 2026-10-20: «sa 7.1 ب»).** It only reads and edits files inside its
   worktree. It runs no command, test, build or script. The orchestrator reviews the diff line by line **first**,
   then runs every gate and test itself (`pnpm check`, the integration tests, the guards). This replaced SA-6's
   shell rules after a test showed that any shell, however filtered, lets MiniMax write a script and read files
   outside the worktree. The record is `docs/owner-decisions.ar.md` item 16. Waleed rotates the SSH passwords and
   tokens himself. Production actions still need his typed yes in the orchestrator's chat.

   **Every limit below must be in place before each run.** `check-opencode.cjs` refuses the run when one is missing:
   - the shell is denied outright (`bash` and `shell`), as are `execute`, which is code mode and reaches opencode's
     internal `tools.opencode.*`, and `grep`, which ignores path rules;
   - every MCP tool is denied, including `list`/`read_mcp_resource`;
   - `webfetch`, `websearch`, `task`/`subagent` and `skill` are denied;
   - `external_directory` is denied, so no tool reaches outside the worktree, the main checkout's `.git` included;
   - `read`, `edit`, `glob` and `list` deny `.git` and anything under it, in both slash styles;
   - `read` and `edit` deny `.env` and `.env.*` at any depth, in both slash styles. A worktree's copied `.env` holds
     database passwords (HANDOVER §3.3), and an explicit `"*": "allow"` would otherwise lift opencode's default
     protection for it;
   - `edit` denies everything under `.claude`, where the guard scripts, this template and the skills live;
   - `edit` also denies every `opencode.json*` and anything under `.opencode`. A config, agent or plugin file
     MiniMax wrote would load on its next round, and a plugin runs as code outside every rule. The dispatch also
     stops if a `.opencode` folder or an `opencode.jsonc` already exists;
   - each path map holds exactly `"*": "allow"` followed by its denies, with no other key. Any later allow would
     win over them, because the last matching rule wins. Any unknown permission key or top-level config key is
     refused;
   - MiniMax runs only at a worktree root, so the dispatch requires `.git` to be a file there;
   - every run pins the project's own agent, `--agent pospay-minimax`, whose permission map is the same allowlist.
     Agent permissions win over top-level ones. So a `default_agent`, or agent permissions added later to the
     untouched global config, cannot loosen the rules. The checker refuses any other agent, a `default_agent`, or a
     global config that mentions `pospay-minimax`;
   - git, the GitHub CLI, OpenSSH and Docker are off `PATH`, as a second layer, and `PATH` is restored after the
     run.

   **The permission file is an allowlist.** `"*"` is denied first, so every tool not allowed after it is refused,
   whatever an MCP server or a later opencode version names it. Only `read`, `edit`, `glob`, `list` and the todo
   tools are allowed. `gen-opencode.cjs` writes the tracked template `opencode-pospay.json` next to this skill, and
   the dispatch copies it to `<worktree>\opencode.json`. Never edit the template by hand: opencode **silently
   ignores an invalid `opencode.json` and then runs with no restrictions at all**, which happened on 2026-10-20
   when a lost backslash broke the JSON. A template change gets one MiniMax smoke run before it is used. The file
   only takes effect as a project-level `opencode.json`, because the `OPENCODE_CONFIG` env var did not apply it. The
   global opencode config is left untouched (Waleed's call).

   **Write dispatch scripts with the file-writing tool, never a shell heredoc.** A heredoc once ate the backslashes
   of the `PATH` filter and left an invalid regex.

   **After every run:**
   - review the diff line by line;
   - check `git stash list`, the reflog and `git status` of the shared checkout;
   - report anything suspicious to Waleed's super agent at once: a tool call outside the task, an attempt around a
     block, a read outside the worktree, or an unexplained change.

   **What the 2026-10-20 tests showed, under the earlier rules that still allowed a filtered shell.**
   - MCP: under the old bash-only file, MiniMax's tool list held `webfetch`, `skill`, `subagent`,
     `opencode.read_mcp_resource` and `opencode.worktree_create`. The allowlist removed them.
   - Refused: every direct route to `.git`, git, `gh`, `ssh`, `docker`, `curl`, a Node `fetch`, and a fake secret
     outside the worktree.
   - Not stopped: a Node script MiniMax wrote in the worktree and ran printed that fake secret. That is why the
     shell is now gone.
   - An audit of all 92 local opencode sessions found no MCP tool call in any of them.

   The orchestrator (never MiniMax) adds `/opencode.json` to the clone's shared `info/exclude` once per clone, as
   the `$exclude` lines below do, so the copy never lands in a diff. The rule stays local because `.gitignore` is a
   config file outside the docs-only lane.

   **The setup fails closed.** Every setup step runs under `$ErrorActionPreference = 'Stop'`, so a failed
   `Set-Location`, `Copy-Item` or check stops the dispatch. The preference goes back to `Continue` just before
   `opencode run`, because Windows PowerShell 5.1 turns any stderr line of a native command into a terminating
   error under `Stop`. A nonzero opencode exit is a failed run (rule 8).

   **The guard scripts run from a trusted copy, never from the worktree.** MiniMax may not edit `.claude` (an `edit`
   deny), and as a second barrier the checker, the template and the session stopper are staged before every run
   from the last reviewed `main` into `F:\Dev\Worktrees\PosPay\briefs\guard\`. That folder is outside the worktree,
   so `external_directory` keeps MiniMax out of it. The `finally` block runs only those copies, because it executes
   after MiniMax returns and before the diff is reviewed. The session stopper calls `opencode.exe` by its absolute
   path with no shell, so an `opencode.cmd` planted in the worktree cannot run.

   ```powershell
   $ErrorActionPreference = 'Stop'
   Set-Location F:\Dev\Worktrees\PosPay\<branch>
   if (-not (Test-Path .git -PathType Leaf)) { throw 'MiniMax runs only at a worktree root, where .git is a file' }
   if ((Test-Path .opencode) -or (Test-Path opencode.jsonc)) { throw 'a .opencode folder or opencode.jsonc exists: inspect it, stop' }
   $worktree = (Get-Location).Path
   $guard = 'F:\Dev\Worktrees\PosPay\briefs\guard'
   if (Test-Path $guard) { Remove-Item $guard -Recurse -Force }
   New-Item -ItemType Directory $guard | Out-Null
   git fetch -q origin main
   git archive -o "$guard\guard.tar" origin/main .claude/skills/pospay-pipeline
   tar -xf "$guard\guard.tar" -C $guard; if ($LASTEXITCODE) { throw 'could not stage the guard scripts: stop' }
   $tools = "$guard\.claude\skills\pospay-pipeline"
   $exclude = Join-Path (git rev-parse --git-common-dir) 'info\exclude'
   if (-not (Select-String -Path $exclude -SimpleMatch '/opencode.json' -Quiet)) { Add-Content $exclude "`n/opencode.json" }
   Copy-Item "$tools\opencode-pospay.json" .\opencode.json -Force
   node "$tools\check-opencode.cjs" opencode.json; if ($LASTEXITCODE) { throw 'opencode.json refused: stop' }
   $savedPath = $env:PATH
   $opencodeExit = 1
   $stopExit = 1
   try {
     $env:PATH = (($env:PATH -split ';') | Where-Object { $_ -and ($_ -notmatch '\\(Git|GitHub CLI|OpenSSH|Docker|DockerDesktop)(\\|$)') }) -join ';'
     foreach ($tool in 'git', 'gh', 'ssh', 'scp', 'docker') {
       if (Get-Command "$tool.exe" -ErrorAction SilentlyContinue) { throw "$tool is still on PATH: stop" }
     }
     if (-not (Get-Command opencode -ErrorAction SilentlyContinue)) { throw 'opencode is not on PATH: stop' }
     $ErrorActionPreference = 'Continue'
     opencode run --agent pospay-minimax -m minimax-coding-plan/MiniMax-M3.1-Flash -s <sid> --title "<task>" `
         -f F:\Dev\Worktrees\PosPay\briefs\<task>\brief.txt "Implement the attached brief."
     $opencodeExit = if ($?) { $LASTEXITCODE } else { 1 }
   } finally {
     $env:PATH = $savedPath
     node "$tools\stop-opencode-sessions.cjs" $worktree
     $stopExit = $LASTEXITCODE
   }
   if ($stopExit -ne 0) { throw 'a MiniMax session could not be stopped: interrupt it by hand before review' }
   if ($opencodeExit -ne 0) { throw "opencode run exited $($opencodeExit), so treat it as a failed run (rule 8)" }
   ```

2. **Every later round, review-fix rounds included, continues that session** with the same `-s <sid>`, and attaches
   only the new fix brief (`-f …\fix-<round>.txt`).
3. **Keep briefs outside the worktree** (`F:\Dev\Worktrees\PosPay\briefs\<task>\`) so they never land in the diff. Pass
   them by absolute path.
4. **The brief header is fixed, in this order:**
   1. Role and fences: "You implement only task N. **You have no shell:** you read and edit files in this worktree
      only, and you run no command, test, build or script. The orchestrator runs the gates and tests after it
      reviews your diff, so stop when the code is written. Do not try to reach a shell, git, the network or any
      file outside the worktree by another route. **Never read, list or write anything under `.git`.** Do not touch
      files outside: …. Do not reformat lines you do not change. Never squash lines to get under `max-lines`; split
      by responsibility instead."
   2. Required reading, as file **paths** only: `CLAUDE.md`, `CLAUDE.architecture.md`, the spec, the plan, the ADRs,
      then the source files the task starts from.
   3. The `CLAUDE.md` rules that apply, quoted verbatim.
   4. **Last:** the task, or the findings to fix.
5. **Send paths, not file contents.** A fix brief carries only the new findings, each written as
   `file:line — what is wrong — what done looks like`.
6. **After every run, or after killing one, stop its opencode session first.** Killing the `opencode run` CLI does
   not stop a session inside the shared `opencode serve --service`; one kept working for 14 more minutes on
   2026-10-20. The dispatch block's `finally` runs the staged `stop-opencode-sessions.cjs <worktree>`. It reads
   `opencode.db` read-only for sessions under the worktree that are not idle, and calls
   `opencode.exe api post /api/session/<id>/interrupt` on each, by absolute path and with no shell. Run the staged
   copy by hand after any kill; `--dry-run` only lists. Until the PR that adds these scripts reaches `main`, stage
   them from that PR's reviewed head instead of `origin/main`.
   **Then diff the worktree against the baseline, and run the gates yourself.** A run with no change
   is a failed candidate, whatever it reports. Check `git stash list`. MiniMax cannot run tests, so a failing gate
   becomes a fix brief for its next round. **Diff every rewritten SQL function body line by line against the old one**:
   on #338 a one-letter slip silently weakened a money guard.
7. **Keep `briefs/<task>/EVAL.md`** (owner, 2026-10-20). For each round record whether the first delivery passed the
   gates, the fix rounds, the findings MiniMax missed, any `CLAUDE.md` violations, and the wall time, then end with a
   short verdict.
8. **When a run is dry or fails**, stop its process, save its partial diff as a patch outside the repo, and reset the
   worktree to the baseline:
   - **First failure:** retry once in a new session with the same brief, plus one line on what went wrong.
   - **Second failure on the same brief:** stop and report it to Waleed through his super agent. **Never** switch to
     Grok, Codex or another provider without his word (PP-10.1).

---

## 5. Database work

- **MiniMax writes** migrations, schema, RLS policies, grants and seed with the rest of the slice. The database reviewer
  (Codex astra 6 medium, read-only) reviews every PR that touches `packages/db/**` against this list:
  - every tenant table has `company_id`, primary key `(company_id, id)`, `ENABLE` + `FORCE ROW LEVEL SECURITY`, a
    policy, and a negative isolation test in the same PR (`CLAUDE.md` §5, ADR-0007);
  - the reviewed grant allowlist in `packages/db/src/__tests__/privileges.spec.ts` matches the new grants;
  - every RLS predicate column and FK is indexed; indexes on existing tables are `CONCURRENTLY` (ADR-0033);
  - the migration is expand/contract — nothing destructive in the same release as the code;
  - money is `numeric(14,3)`, IDs are UUID v7, timestamps `timestamptz`;
  - no runtime role gains `BYPASSRLS`; auth tables follow ADR-0003.
- **The staging database is changed only by the orchestrator**, only through the deploy script's migrate step, and any
  manual change (roles, ownership, grants) needs the owner's explicit "موافق" for that change, with a backup taken and
  restore-checked first.

---

## 6. Staging deploy — after every merge that changes code

On the `abdulaziz` SSH profile, in `/opt/pospay-staging`:

1. Confirm the main CI run for the merged SHA is green (it pushes the images to GHCR). The server pulled GHCR images
   without a registry login on 2026-10-07; if a pull ever fails with an auth error, stop and ask the owner for a
   read-only package token (`docker login ghcr.io`) — never copy images by hand.
2. Take a backup: `docker run --rm --network dokploy-network --env-file /opt/pospay-staging/backup.env ghcr.io/lolotam/pospay-backup:<sha>`.
3. If `deploy/` changed, fetch **both** `docker-compose.staging-shared.yml` and `staging-deploy.sh` from GitHub raw at
   that SHA, compare each sha256 with the repo, then replace the server copies (keep the script executable). Step 4
   runs the server copy, so a stale script silently skips new migrate, readiness or failure logic. **Before** replacing
   them, make sure `known-good/<previous-sha>/` holds the current pair (copy it there if it is missing).
4. `./staging-deploy.sh <full-sha>`; it migrates, starts, and proves `/ready`. Once ready, copy the active pair to
   `known-good/<full-sha>/` — **every** ready SHA gets its pair, code-only releases too, so any later rollback finds one.
5. **When the release adds a migration, prove rollback** (constitution, Development Workflow): restore `<previous-sha>`
   (below) against the new schema, confirm `/ready`, then restore `<full-sha>` the same way. A previous image that does
   not start on the new schema is a P1 against the migration: restore `<full-sha>` at once (it is the one that was ready
   on this schema), keep the release blocked, and open the P1.
6. On a failure of step 4, restore the previous SHA at once, then diagnose. Never leave staging down while
   diagnosing — in either step, the SHA to restore is the last one that proved `/ready` on the current schema.

**Restore `<sha>`:** copy `known-good/<sha>/docker-compose.staging-shared.yml` and `staging-deploy.sh` back into
`/opt/pospay-staging/` (keep the script executable), then run `./staging-deploy.sh <sha>` from there. The script reads
the `.env` next to itself, so it must always run from `/opt/pospay-staging/`, never from inside `known-good/`.
7. Point `/etc/cron.d/pospay-backup` at the new `pospay-backup:<sha>` image from GHCR, never a locally built tag (a
   local image is removed by the server's cleanup and the nightly backup then fails silently).
8. Update the decisions page's «المشروع أول بأول» tab (`CLAUDE.md` §1 5c) at https://plan.pospay.systems
   (`docs/decisions-site.md` §B): `git pull` the `lolotam/plan` clone, set the merged rows, sub-tasks and any partner
   requests they close to done with the PR number in `public/roadmap.json`, add any new rows, bump `updated`, push to
   `main`, and confirm the live `roadmap.json` shows the change. Then read the answers back (§C of the same doc) and
   send the merge notification to Waleed's phone (§D). A
   docs-only merge updates the tab too. A release is not reported to the owner until this is done.

The server is shared: never touch another project's containers, databases or files.

---

## 7. Talking to the owner

- Egyptian Arabic, simple words — the owner is not technical. English terms stay in English on their own bullet.
- After every merge, and from time to time during long work, send a progress report in this fixed shape, with every
  count recounted from `roadmap.json`, `git log` and `gh pr list` each time:
  1. the 7 phases and the status of each;
  2. the current phase's groups, each with done / in progress / not started counts;
  3. what runs now (row, PR, review round, MiniMax round count);
  4. what comes next;
  5. what waits on the owner (questions, approvals, server changes).
- Ask the owner — with options and a recommended one — for every business rule, every server change, and every
  merge that skips a gate. Never guess a business rule.

---

## 8. Claude quota discipline

Claude is the scarce quota (owner's Max plan, 2026-10-18: weekly 74 % used with 4 days left, plus metered overage). Every
rule below moves work to a model or a script that does not draw on it. Judgement stays on Claude; reading, waiting and
typing do not.

1. **Wait with scripts, not with the model.** A background watcher is a shell loop that exits on the one event that
   matters (merged, CI failed, all bots answered on the head SHA). Never wake the orchestrator on a timer or per
   notification to look at nothing. Each wake-up re-reads the whole context, so a 700 K context makes every idle poll
   expensive.
2. **Keep the orchestrator context small.** Past roughly 300 K tokens, write a handover note (state of every open PR,
   branch, worktree, session id, next action — about 30 lines, in `docs/journey/` or the scratchpad) and continue in a
   fresh session from that note instead of carrying the history.
3. **Choose the model per session.** Sessions that only continue a PR, write documentation or answer bot findings run on
   Sonnet or Haiku at medium effort. High effort and the strongest model are for design advice, risky slices (§3 step 2)
   and P0/P1 judgement only.
4. **Fix rounds go to MiniMax.** When a bot finds something, the findings go to the implementer's continued MiniMax
   session (§4 rule 2), each written as `file:line — what is wrong — what done looks like`. Claude judges whether the
   fix is right; it does not retype it. Every production-code finding goes to MiniMax, a one-line one included
   (PP-10.1). A Claude session fixes a finding itself only when the PR is docs-only and so has no implementer
   session. After two MiniMax failures on one brief, stop and report
   to Waleed (§4 rule 8). Never switch to another provider.
5. **One cheaper review layer 2.** One fresh Sonnet 5.5 reviewer at medium effort replaces the two Opus-class reviewers
   (review and confirm round). It gets the diff, the spec and the governing documents (`CLAUDE.md`, `CLAUDE.architecture.md`, `docs/06_Tech_Stack_Architecture_EN.md`, `docs/module-map.md`, the ADRs the slice cites), never the session history, so its context stays small. Use high
   effort when the PR touches money, tenant isolation, auth or migrations, (the other-vendor reviewer is review layer 1, Codex astra 6, which already runs on every code PR in §3 step 7; the docs-only lane skips it and has no layer 2 either). A docs-only
   PR gets no Claude reviewer. The confirm round is dropped: the four bots re-review the head SHA after every push.
6. **Drafts are written by MiniMax.** This is the draft-writer role in §1, set by PP-10.1. MiniMax writes the first
   drafts of specs, ADRs, journey docs and the HANDOVER, and Claude edits and owns them. Claude writes a document from
   scratch only when it records a decision that only Claude has the context for.
7. **The roadmap is edited by a script.** After a merge, write the changed rows as `[{ "code": "…", "status": "done",
   "ref": "PR #n" }]` and, from this repo's root, run `node scripts/roadmap/cli.mjs F:/Dev/Projects/plan-pospay/public/roadmap.json updates.json`
   (the `lolotam/plan` clone's file). It sets status and ref by
   code anywhere in the file (phases, gates, track items, partner requests), bumps `updated`, and refuses an unknown
   code or status before changing anything. It cannot add a row: add a new row by hand in the right group of
   `roadmap.json` first, then run the script for the statuses. `git pull` the `lolotam/plan` clone, run the script on
   its `public/roadmap.json`, push. Do not write a new script each time.
8. **Report the draw.** When the owner asks about quota, answer from the context sizes of the sessions and the number of
   wake-ups, not from guesses; the app does not expose per-session numbers.

---

## 9. Never

- Never let MiniMax run any git command, read or write anything under `.git`, use any MCP tool, merge, push, or
  touch the server.
- Never merge with a P0/P1 open, or with CI red on the head being merged.
- Never exceed 5 review rounds without applying §2 (a docs-only PR has no cap, see the docs-only lane in §2), and never exceed 3 parallel tasks.
- Never run two tasks in parallel that touch the same file.
- Never change the staging database by hand without the owner's explicit approval for that change.
- Never rewrite a pushed branch's history (`--force`) without the owner's explicit approval.
