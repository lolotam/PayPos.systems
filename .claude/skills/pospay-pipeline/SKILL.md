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
| Orchestrator | Claude Code (this session) | yes — specs, briefs, renumbering, fixes on docs-only PRs (never production code, PP-10.1), and merges without asking once every gate passes (Waleed, SA-11 «ج»: a PosPay merge reaches staging only; production, production data and server changes still need his yes; `docs/owner-decisions.ar.md` item 17) |
| Design advisors (risky slices only, §3 step 2) | Codex astra 6 medium (`gpt-6-astra`, effort medium) **and** Claude Fable 5.1 medium (`claude-fable-5-1`) | no — read-only |
| **Implementer** — code, tests, migrations **and PR-finding fix rounds** | **Only opencode `minimax-coding-plan/MiniMax-M3.1-Flash`** (default variant) — owner's rule 2026-10-20 (PP-10.1, tightened the same day: no new Grok or Codex implementation runs; a run already in flight may finish its current round). Every MiniMax brief bans all git commands, edits outside the task, unrelated reformatting and line-squashing to dodge `max-lines`; the reviewer diffs every rewritten SQL function body against the old one and reviews money, DB and permission changes strictly | yes, in its own worktree |
| **Database reviewer** | **Codex astra 6 medium** (`gpt-6-astra`, effort medium, `codex exec -s read-only`) | no |
| Review layer 1 | **Codex astra 6 medium** (`gpt-6-astra`, effort medium, `codex exec -s read-only`) — owner's choice 2026-10-11 | no |
| Review layer 2 | **one** fresh Claude reviewer, **Sonnet 5.5 at medium effort** (`claude-sonnet-5-5`), given the diff, the spec and the governing documents (§8 rule 5), never the session history; **high** effort for money, tenant isolation (RLS), auth and migrations; none for a docs-only PR (§8 rule 5) | no |
| Review layer 3 — **four bots** | the Codex GitHub bot (`chatgpt-codex-connector[bot]`, `@codex review` after every push; Codex CLI when out of quota) **and** the MergePilot panel (`mergepilot-review[bot]`): MergePilot (`gpt-6.1-sol`), waleed_bot (`claude-sonnet-5-5`), mohamed_bot (`grok-4.7`), which reviews every pushed commit on its own | no |
| Draft writer (§8 rule 6) | MiniMax writes first drafts of specs, ADRs, journey docs and the HANDOVER; the orchestrator edits and owns the result | yes |
| Fixer | the implementer, continuing **its own MiniMax session** with only the findings (§4), for every production-code finding, a one-line one included (PP-10.1); the orchestrator (or a doc-writing session) only for a fix on a docs-only PR, where no implementer session exists | yes |
| Staging server | the orchestrator only, over the `abdulaziz` SSH profile | — |

There is no separate model check before the first dispatch. Any `opencode` command started outside §4's guarded setup
loads plugins and config before `check-opencode.cjs` has vetted them, and a bare `opencode run` would also run the model
under opencode's default, unrestricted permissions. The first guarded run is the check: a missing model id, or an auth
or quota failure, shows as a nonzero exit (§4 rule 8). Then stop and ask the owner. Never substitute another provider (PP-10.1). On a quota stop, hold and resume the same session after
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
| 1 | Spec: `/speckit-specify` → `docs/specs/NNN-<module>-<use-case>/spec.md`; owner questions → the slice's `owner-questions.ar.md` (a question that belongs to no slice, such as a pipeline, docs or process rule, goes to `docs/owner-decisions.ar.md` instead), then published on the decisions page as a new numbered batch, whatever its kind, and sent to Waleed as super-agent cards (`CLAUDE.md` §1 5b, V3.14: on a difference Abu Salem's pick wins); a feature's questions are asked together before its first sub-PR, in one batch | orchestrator | every business rule is in the spec or asked; an unknown rule is a `TODO(spec)` and a stop. **Ask the whole feature at once** (owner, 2026-10-17): before the first sub-PR of a feature starts, list every sub-PR in the plan, collect all of their owner questions, one numbered batch on the page (also sent to Waleed as cards), and add a clickable mockup (an HTML artifact, or a Lovable prototype) when the answer is a screen; late-found questions are the exception, not the routine |
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
   "Session ID to continue, or to create if it does not exist". It refuses an id that does not start with `ses`
   (`Expected a string starting with "ses"`, 2026-10-20), so a plain UUID fails before the model runs. Use opencode's
   own shape, `ses_` followed by 12 hex and 14 base62 characters. If a later version stops creating it, run round one
   without `-s`, take the generated id from the `--format json` output, and use that id from round two on. Run it from
   the worktree:

   **MiniMax has no shell (Waleed, SA-7.1, 2026-10-20: «sa 7.1 ب»).** It only reads and edits files inside its
   worktree. It runs no command, test, build or script. The orchestrator reviews the diff line by line **first**,
   then runs every gate and test itself (`pnpm check`, the integration tests, the guards). This replaced SA-6's
   shell rules after a test showed that any shell, however filtered, lets MiniMax write a script and read files
   outside the worktree. The record is `docs/owner-decisions.ar.md` item 16. Waleed rotates the SSH passwords and
   tokens himself. Production actions still need his typed yes in the orchestrator's chat.

   **Known residual risk: the gates run MiniMax's code.** The permission file limits what MiniMax can do while it
   runs. It does not sandbox what runs afterwards: `pnpm check` and the tests execute MiniMax-authored source,
   tests, package scripts and build config under the orchestrator's own Windows account (Codex on #416). Waleed
   chose to keep it that way: no separate OS account and no container, only the passwords move out of the global
   opencode config («(ب) نشيل الباسوردات بس», 2026-10-20, `docs/owner-decisions.ar.md` item 19). That move, the
   password rotation and the removal of the global MCP servers wait for the end of the PosPay plan («SEE LETS PROCEED
   IN OUR POSPAY PLANE LATER POSTPOND TILL THE END»); until then nobody edits the global opencode config, and the
   secrets in it stay readable by any code the gates run. So the line-by-line review is the barrier. Read every changed script, test, config file and anything a
   gate imports before running a gate, and treat an unexplained `child_process`, network, `fs` access outside the
   worktree, or a changed `package.json` script as a stop-and-report finding.

   **Every limit below must be in place before each run.** `check-opencode.cjs` refuses the run when one is missing:
   - the shell is denied outright (`bash` and `shell`), as are `execute`, which is code mode and reaches opencode's
     internal `tools.opencode.*` (eyadex saw MiniMax use it to hunt for the banned `grep`), and `grep`, which
     ignores path rules;
   - every MCP tool is denied, including `list`/`read_mcp_resource`;
   - `search`, `fetch`, `webfetch`, `websearch`, `question`, `list`, `todowrite`, `todoread`, `task`/`subagent` and
     `skill` are denied, each by name;
   - `external_directory` is denied, so no tool reaches outside the worktree, the main checkout's `.git` included.
     `read` and `edit` also deny every drive but `F:` by name (`C:*`, `c:*`, …) and every path that starts
     with a backslash or a slash (a UNC share, a `\\?\` namespace path, a root on the drive), because opencode has a
     reported Windows bug that treats another drive as inside the project (opencode issue 27596). On 2026-10-20 a
     MiniMax smoke test on opencode 2.0.32 asked to read a harmless file on `C:` and was refused with
     `external_directory` both with and without these denies, so they are a second layer. A second test the same day
     tried the `\\?\C:\…`, `\\localhost\C$\…` and `//localhost/C$/…` forms: all were refused, while `README.md` and
     its absolute `F:\` path inside the worktree still read. Repeat both smoke tests before raising the opencode pin;
   - `read` and `edit` deny `.git` and anything under it, in both slash styles;
   - `read` and `edit` deny any path with a colon after its first two characters (`??*:*`), that is, an NTFS stream.
     `.env::$DATA` is the `.env` file itself, and a named stream such as `.env:hidden` is a hidden file that git
     never shows. A 2026-10-20 smoke test read a planted `.env` through `.env::$DATA` before this deny, and refused
     both forms after it, while `README.md` and its absolute `F:\` path still read (Codex on #416);
   - the checker refuses the run when the volume creates NTFS 8.3 short names (`GIT~1` for `.git` would match none
     of the name rules; Codex on #416), probed by making a long-named folder in the isolated config home and reading
     `dir /x`, or when any entry still has one in any folder the link scan visits (every folder outside
     `node_modules` and `.git`, at any depth), because disabling creation keeps old aliases. On 2026-10-20 F: created
     none and the worktree had none, the whole check took 1.7 s, and the same probe on C: was refused. Folder names
     reach `cmd.exe` only double-quoted on a command line the checker builds, with delayed expansion off, so a
     MiniMax-made folder such as `probe&pwn.cmd` stays a name. A folder name holding `%` stops the run. Tested:
     `probe&pwn.cmd` and `(dashboard)` passed without running anything, and `x%PATH%y` was refused;
   - the checker refuses the run when a file outside `node_modules` and `.git` has more than one hard-link name,
     because a hard link to another worktree's `.env` would expose it through an allowed path (Codex on #416). None
     existed on 2026-10-20 (3,830 files in a worktree, 18,758 in the main checkout), and a planted one was refused.
     pnpm hard-links `node_modules` files to its store of public package code, which MiniMax may read but not edit.
     Those links cannot be told apart from a planted one without listing each file's other names, so a hard link
     placed inside `node_modules` to a secret is a known residual risk. MiniMax cannot create one without a shell,
     the worktree's `node_modules` comes from a fresh `pnpm install`, and the separate-account question covers it;
   - the checker validates the worktree's root `.git` before trusting it: it must be a plain file with one name (not
     a symlink, junction or hard link) holding `gitdir:` set to a folder directly under the PosPay main checkout's
     `.git\worktrees`, whose own `gitdir` backlink names this exact `.git` file, because git status and reset
     follow it (Codex on #416). A `.git` folder, a hard-linked pointer and a pointer elsewhere were all refused;
   - the checker refuses the run when any symlink or junction exists outside `node_modules` (none did on
     2026-10-20), and when a link inside `node_modules` resolves outside the worktree, or would if it is broken, or
     into a protected path (`.git`, `.claude`, `.opencode`, `.agents`, `.vscode`, `.idea`, `.playwright-mcp`,
     `.specify`, `opencode.*`, an env file or a log). opencode authorizes the written path and then follows the link,
     so even a link to `.claude` inside the worktree would give it an allowed name (Codex and MergePilot on #416).
     MiniMax cannot make one without a shell. Tested: `docs/guard-link` to `.claude` and `node_modules/evil` to
     `.vscode` were refused, and a pnpm-style link was allowed. In `node_modules` it reads only the levels pnpm links
     at (the top, `@scope`
     folders and each `.pnpm/<package>/node_modules`), about 1.2 s. pnpm's store files are hard links, and on
     2026-10-20 all 2,832 links of the main checkout stayed inside it, except 5 stale `apps/pos` links to the old
     `F:\Dev\Projects\PayPos.systems` path, which the check rightly refuses. Run `pnpm install` in a worktree that
     has them;
   - `read` and `edit` deny any path whose name component ends in a space or a dot (`* `, `* /*`, `*.`, `*./*`).
     opencode 2.0.32 writes such a path literally, so a 2026-10-20 smoke test created folders named `.opencode ` and
     `.claude.` beside the real names, which other Windows tools would treat as the protected folder. After the
     deny both writes were refused, while `./sub/a.txt`, `sub/../README.md`, a new file and an edit still worked;
   - `glob` is denied too. opencode checks its permission against the search pattern only, never the folder it
     searches, so no path rule could keep a glob out of `.git`, another drive or a share (Codex on #416). Briefs
     name every file MiniMax needs (rule 5), so it reads them directly;
   - every run has a **hard 45-minute limit**: opencode runs as its own process, and past the limit the dispatch
     kills its whole process tree, and the `finally` stopper interrupts its session. On 2026-10-20 Emlaa saw MiniMax
     loop for 7+ minutes, write probe files and edit a file it was never asked to touch. A killed standalone session
     stays marked busy in `opencode.db` but is frozen. A test killed at 21 s had no update a minute later, and the
     stopper's interrupt of it is harmless;
   - `read` also denies every `opencode.*` file, anything under `.opencode`, and all of `.claude` (where the template
     lives), as `edit` does: MiniMax tried to read its own rules (Emlaa, 2026-10-20);
   - **secret env files are not in the worktree during a run.** The dispatch moves every ignored `.env`, `.env.*`,
     `*.env` and `*.env.*` file (`.env.example` templates excepted) to `briefs\guard\<worktree>\env-stash` before the
     run, and moves them back only after MiniMax has stopped. A file MiniMax planted under the same name is set aside
     and reported. The next dispatch refuses to start while the stash still holds a file. A deny list alone kept losing
     to one more spelling of the same file (`.env::$DATA` read a planted secret; Codex on #416), and a file that is not
     there cannot be read. The scan uses `git ls-files --directory`, so it does not open wholly ignored folders such as
     `node_modules`; an env file inside one is still covered by the `*.env` deny. A 2026-10-20 smoke test refused
     `.playwright-mcp/profile.env`, and its trailing-space and trailing-dot spellings (`.env `, `.env.`,
     `.claude /x`) found no file on opencode 2.0.32;
   - as a second layer, `read` and `edit` deny `.env`, `.env.*`, `*.env` and `*.env.*` at any depth, the forms the
     root `.gitignore` ignores. A worktree's copied `.env` holds database passwords (HANDOVER §3.3), and an explicit `"*": "allow"`
     would otherwise lift opencode's default protection for it. A 2026-10-20 smoke test read a planted
     `production.env` before `*.env` was added. opencode matches paths case-insensitively on Windows, and the same
     test confirmed that `.ENV` and `.Env` are refused. The tracked `.env.example` and `*.env.example` templates hold
     no secret, and a slice that adds an env var must update one, so they are allowed again right after the env
     denies;
   - `edit` denies everything under `.claude`, where the guard scripts, this template and the skills live;
   - `read` also denies the local tool state folders `.agents`, `.vscode`, `.idea` and `.playwright-mcp`, because
     they can hold credentials (Playwright MCP storage-state files keep cookies and local storage; Codex on #416). A
     2026-10-20 smoke test refused reads of `.playwright-mcp/storage-state.json` and `.vscode/settings.json`, and
     `README.md` still read. The tracked Spec Kit skills (`.agents/skills/speckit-*/SKILL.md`, which `.gitignore`
     exempts) stay readable and editable through a later allow, placed before the other-drive, stream and
     trailing-alias denies so it cannot reopen them;
   - `read` and `edit` deny the logs the root `.gitignore` ignores (`*.log` and the npm/pnpm `*-debug.log*`), which
     can hold tokens, request bodies or customer data and never show in `git status` when unchanged (Codex on #416).
     A 2026-10-20 smoke test refused `apps/api/server.log` and `pnpm-debug.log.1`;
   - `edit` also denies every path the root `.gitignore` ignores, outside `.env` and `.claude` (denied above): the
     dependency and build folders (`node_modules`, `.pnpm-store`, `dist`, `build`, `.next`, `out`, `.turbo`,
     `coverage`), local tool state other agents or IDEs load (`.agents`, `.vscode`, `.idea`, `.playwright-mcp`), and
     `*.tsbuildinfo`, `*.log`, `.DS_Store`, `Thumbs.db` and `next-env.d.ts`. It also denies the entries of the one
     nested ignore file, `.specify/.gitignore`: `.specify/feature.json`, the Spec Kit pointer to the active slice, and
     `.specify/extensions/*/local-config.yml`. The gates and tools read what is there, and `git status` cannot show
     an edit to a file that was already ignored. A new entry in any `.gitignore`, root or nested (list them with
     `git ls-files '*.gitignore'`), gets a matching deny in the same PR;
   - `edit` also denies every `opencode.*` file (config, or an `opencode.cmd` a later shell could run) and anything under `.opencode`. A config, agent or plugin file
     MiniMax wrote would load on its next round, and a plugin runs as code outside every rule. The dispatch also
     stops if a `.opencode` folder or an `opencode.jsonc` already exists;
   - each path map holds exactly its rules in a fixed order, with no other key, because the last matching rule
     wins: `"*": "allow"`, the env denies, the `.env.example` allows, then the git, config and `.claude` denies, so
     no allow can re-open a protected tree. Any unknown permission key or top-level config key is refused;
   - MiniMax runs only at a worktree root, so the dispatch requires `.git` to be a file there;
   - every run pins the project's own agent, `--agent pospay-minimax`, whose permission map is the same allowlist.
     Agent permissions win over top-level ones. So a `default_agent`, or agent permissions added later to the
     untouched global config, cannot loosen the rules. The checker refuses any other agent, a `default_agent`, or a
     global config that mentions `pospay-minimax`;
   - every run uses `--standalone`, a private opencode server started from this checked environment. The shared
     `opencode serve --service` keeps the `OPENCODE_*` variables and config it started with, so checking this
     shell's environment would prove nothing about it;
   - opencode must be signed in to no account. A signed-in organization's config is fetched and merged after the
     project file, so it could override every rule here (Codex on #416). The checker reads the `account`,
     `account_state` and `control_account` tables of `~/.local/share/opencode/opencode.db` read-only and refuses the
     run if any has a row, or if it cannot read them. All three were empty on 2026-10-20. It also refuses a
     `wellknown` credential in `auth.json` (reading only each entry's `type`), because opencode fetches that
     provider's `/.well-known/opencode` config and merges it. None existed on 2026-10-20: the entries were `oauth`
     and `api` only;
   - `formatter` and `lsp` are `false` in the template, and the checker requires it. opencode runs formatters
     (prettier, and others) after every edit, and starts built-in LSP servers when a file opens, as host processes
     outside every permission rule. A formatter also loads project config that MiniMax could edit. The orchestrator
     formats with `pnpm format` when it runs the gates. A 2026-10-20 run wrote `const   x  =  1` and it stayed
     unformatted;
   - **every run uses an isolated global config home**: the dispatch points `XDG_CONFIG_HOME` at a fresh
     `briefs\guard\<worktree>\xdg-config`, outside the worktree, holding only a fixed one-line `AGENTS.md` and an
     `opencode.json` that only sets `"autoupdate": false`. None of
     Waleed's global opencode config loads. On 2026-10-20 that global config started 28 MCP servers on every run,
     some connecting to outside services such as `mcp.facebook.com` and `n8n`, even with every MCP tool denied. Under
     isolation the log showed zero MCP lines, and MiniMax still signed in, because its credentials sit in the data
     folder (`auth.json`), not in the config. Isolation also keeps out global plugins, custom tools (which could
     replace `read` or `edit`), agent and mode files (which could redefine `pospay-minimax`) and instruction files
     (which enter the model's context past every read rule). The fixed `AGENTS.md` stops opencode falling back to
     `~/.claude/CLAUDE.md`. The checker refuses the run unless `XDG_CONFIG_HOME` is set to a folder outside the
     worktree that holds exactly those two files;
   - **opencode is pinned to the version the smoke tests passed on** (2.0.32). opencode can update itself in place
     (Codex on #416). The isolated config turns auto-update off, but the guard that holds is the checker: it refuses
     the run when the `package.json` beside the exact `opencode.exe` the dispatch runs (passed as its second argument)
     has a version other than `PINNED_OPENCODE`. To upgrade, rerun both smoke
     tests on the new version first, then raise the pin in the same PR. Note: `opencode debug config` still lists
     `~/.config/opencode/opencode.json` under isolation, but a real isolated run on 2026-10-20 logged zero MCP
     lines and loaded only the isolated `AGENTS.md`. Judge isolation by a real run's `--print-logs`, not by
     `debug config`;
   - the checker refuses an `.opencode`, `opencode.json` or `opencode.jsonc` in any folder above the worktree, up to
     the drive root, because opencode loads config from every ancestor. None exists today;
   - the checker also refuses a run when a higher-precedence source exists: the system config folder
     `%ProgramData%\opencode`, or any `OPENCODE_CONFIG*`/`OPENCODE_PERMISSION*`/`OPENCODE_DB*` or `XDG_DATA_HOME`
     environment variable (the last two would also move the database the session stopper reads). None exists
     on the host today;
   - git, the GitHub CLI, OpenSSH and Docker are off `PATH`, as a second layer, and `PATH` is restored after the
     run.

   **The permission file is an allowlist.** `"*"` is denied first, so every tool not allowed after it is refused,
   whatever an MCP server or a later opencode version names it. Only `read` and `edit` (which covers `write`) are
   allowed. `gen-opencode.cjs` writes the tracked template `opencode-pospay.json` next to this skill, and
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
   error under `Stop`. A nonzero opencode exit is a failed run (rule 8). Save the block as a `.ps1` file and
   parse-check it before the first run
   (`$errors = $null; $null = [System.Management.Automation.Language.Parser]::ParseFile(<path>, [ref]$null,
   [ref]$errors); $errors.Count` must print 0; `[ref]` needs the variable to exist first).
   A parse error stops the whole file before any line runs. That is safe, but it hides a broken block until it is
   used: on 2026-10-20 `"…still in $envStash: move…"` would not parse, because PowerShell reads `$name:` inside a
   double-quoted string as a drive-qualified variable. Write `${name}:` instead.

   **The guard scripts run from a trusted copy, never from the worktree.** MiniMax may not edit `.claude` (an `edit`
   deny), and as a second barrier the checker, the template and the session stopper are staged before every run
   from the last reviewed `main` into `F:\Dev\Worktrees\PosPay\briefs\guard\<worktree folder>\`, one folder per
   worktree so parallel tasks never replace each other's copy. That folder is outside the worktree,
   so `external_directory` keeps MiniMax out of it. The `finally` block runs only those copies, because it executes
   after MiniMax returns and before the diff is reviewed. The session stopper calls `opencode.exe` by its absolute
   path with no shell, so an `opencode.cmd` planted in the worktree cannot run.

   ```powershell
   & {   # a child scope, so the caller's $ErrorActionPreference comes back after any outcome
   $ErrorActionPreference = 'Stop'
   Set-Location F:\Dev\Worktrees\PosPay\<branch>
   if (-not (Test-Path .git -PathType Leaf)) { throw 'MiniMax runs only at a worktree root, where .git is a file' }
   # git fetch and git archive below stage the guards through this worktree's .git pointer, so it must lead to the
   # PosPay main checkout and nowhere else before git runs (Codex on #416)
   $commonDir = [IO.Path]::GetFullPath((git rev-parse --git-common-dir))
   if ($commonDir -ne 'F:\Dev\Projects\PosPay.systems\main\.git') { throw "this worktree's .git leads to $commonDir, not the PosPay main checkout: stop" }
   if ((Test-Path .opencode) -or (Test-Path opencode.jsonc)) { throw 'a .opencode folder or opencode.jsonc exists: inspect it, stop' }
   $worktree = (Get-Location).Path
   $guard = Join-Path 'F:\Dev\Worktrees\PosPay\briefs\guard' (Split-Path $worktree -Leaf)
   if (Get-ChildItem (Join-Path $guard 'env-stash') -Recurse -File -Force -ErrorAction SilentlyContinue) {
     throw "env files from an earlier run are still in $guard\env-stash: move them back before a new run"
   }
   if (Test-Path $guard) { Remove-Item $guard -Recurse -Force }
   New-Item -ItemType Directory $guard | Out-Null
   git fetch -q origin main; if ($LASTEXITCODE) { throw 'git fetch failed: a stale guard copy could be trusted, stop' }
   $mainSha = git rev-parse FETCH_HEAD
   git archive -o "$guard\guard.tar" $mainSha .claude/skills/pospay-pipeline; if ($LASTEXITCODE) { throw 'git archive failed: stop' }
   # Windows' own tar: under a PowerShell started from Git Bash, plain `tar` is GNU tar, which reads F: as a remote host
   & "$env:SystemRoot\System32\tar.exe" -xf "$guard\guard.tar" -C $guard
   if ($LASTEXITCODE) { throw 'could not stage the guard scripts: stop' }
   $tools = "$guard\.claude\skills\pospay-pipeline"
   $exclude = Join-Path (git rev-parse --git-common-dir) 'info\exclude'
   if (-not (Select-String -Path $exclude -SimpleMatch '/opencode.json' -Quiet)) { Add-Content $exclude "`n/opencode.json" }
   Copy-Item "$tools\opencode-pospay.json" .\opencode.json -Force
   $isolatedConfig = Join-Path $guard 'xdg-config'
   New-Item -ItemType Directory (Join-Path $isolatedConfig 'opencode') | Out-Null
   [IO.File]::WriteAllText((Join-Path $isolatedConfig 'opencode\AGENTS.md'),
     "PosPay MiniMax run: follow the attached brief only. Read and edit files in this worktree only.`n")
   [IO.File]::WriteAllText((Join-Path $isolatedConfig 'opencode\opencode.json'), "{ `"autoupdate`": false }`n")
   # Secret env files leave the worktree for the whole run (Codex on #416): a deny list can be dodged by one more
   # spelling of the same file (.env::$DATA read one), and a file that is not there cannot be read. MiniMax never needs
   # them; the orchestrator runs every gate after the run, with the files back in place.
   $envStash = Join-Path $guard 'env-stash'
   $envFiles = @(git -c core.quotePath=false ls-files --others --ignored --exclude-standard --directory |
     Where-Object { $_ -match '(^|/)[^/]*\.env(\.[^/]+)?$' -and $_ -notmatch '\.example$' })
   if ($LASTEXITCODE) { throw 'could not list the ignored files: stop' }
   $stashed = @()
   $restoreFailed = $false
   $savedPath = $env:PATH
   $savedXdg = $env:XDG_CONFIG_HOME
   $savedPwd = $env:PWD
   $opencodeExit = 1
   $stopExit = 1
   $runStart = $null
   try {
     foreach ($rel in $envFiles) {
       $dest = Join-Path $envStash $rel
       New-Item -ItemType Directory (Split-Path $dest) -Force | Out-Null
       Move-Item -LiteralPath (Join-Path $worktree $rel) -Destination $dest
       $stashed += $rel
     }
     $env:XDG_CONFIG_HOME = $isolatedConfig   # no global config: no MCP servers, plugins, agents or instructions
     # opencode takes its project folder from the inherited PWD variable, not from Set-Location. Launched from Git Bash,
     # PWD is the caller's folder, no project opencode.json loads, and the run stops with "Agent not found" (#423).
     $env:PWD = $worktree
     if (-not (Get-Command opencode -ErrorAction SilentlyContinue)) { throw 'opencode is not on PATH: stop' }
     $opencodeExe = Join-Path (Split-Path (Get-Command opencode).Source) 'node_modules\@opencode\cli\bin\opencode.exe'
     if (-not (Test-Path $opencodeExe)) { throw 'opencode.exe not found: stop' }
     # the checker pins the version of this exact binary, the one Start-Process runs below
     # some Node 24 releases (24.13) print an ExperimentalWarning for node:sqlite, which PowerShell 5.1 turns into a fatal
     # error under Stop; only that warning class is silenced, every real error still reaches stderr
     node --disable-warning=ExperimentalWarning "$tools\check-opencode.cjs" opencode.json $opencodeExe
     if ($LASTEXITCODE) { throw 'opencode.json refused: stop' }
     $env:PATH = (($env:PATH -split ';') | Where-Object { $_ -and ($_ -notmatch '\\(Git|GitHub CLI|OpenSSH|Docker|DockerDesktop)(\\|$)') }) -join ';'
     foreach ($tool in 'git', 'gh', 'ssh', 'scp', 'docker') {
       if (Get-Command "$tool.exe" -ErrorAction SilentlyContinue) { throw "$tool is still on PATH: stop" }
     }
     $ErrorActionPreference = 'Continue'
     $runArgs = @('run', '--standalone', '--agent', 'pospay-minimax', '-m', 'minimax-coding-plan/MiniMax-M3.1-Flash',
       '-s', '<sid>', '--title', '"<task>"', '-f', 'F:\Dev\Worktrees\PosPay\briefs\<task>\brief.txt',
       '"Implement the attached brief."')
     $runStart = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
     $run = Start-Process -FilePath $opencodeExe -ArgumentList $runArgs -NoNewWindow -PassThru `
       -RedirectStandardOutput "$guard\run.out.txt" -RedirectStandardError "$guard\run.err.txt"
     $null = $run.Handle   # keeps ExitCode readable after the process ends (Windows PowerShell 5.1)
     if (-not $run.WaitForExit(45 * 60 * 1000)) {   # hard limit: 45 minutes
       & taskkill /PID $run.Id /T /F | Out-Null
       $opencodeExit = 124
     } else {
       $opencodeExit = $run.ExitCode
     }
   } finally {
     try {
       # The stopper launches opencode.exe, so it runs only after the checks passed and the run started, while the
       # isolated config is still active. A refused setup never starts opencode, not even to clean up.
       if ($runStart) {
         node --disable-warning=ExperimentalWarning "$tools\stop-opencode-sessions.cjs" $worktree --exe $opencodeExe --since $runStart
         $stopExit = $LASTEXITCODE
       } else {
         $stopExit = 0
       }
     } finally {
       $env:PATH = $savedPath
       $env:XDG_CONFIG_HOME = $savedXdg
       $env:PWD = $savedPwd
       # The env files come back only once the stopper confirmed MiniMax has stopped ($stopExit is 0, or the run never
       # started); after a failed or thrown stop they stay stashed (MergePilot on #416). A file MiniMax planted under the
       # same name is moved aside to the guard folder and reported, never overwritten silently.
       $restorable = if ($stopExit -eq 0) { $stashed } else { @() }
       foreach ($rel in $restorable) {
         try {
           $target = Join-Path $worktree $rel
           if (Test-Path -LiteralPath $target) {
             $planted = Join-Path (Join-Path $guard 'planted') $rel
             New-Item -ItemType Directory (Split-Path $planted) -Force | Out-Null
             Move-Item -LiteralPath $target -Destination $planted -ErrorAction Stop
             Write-Warning "MiniMax created $rel during the run: moved to $planted, report it to the super agent"
           }
           Move-Item -LiteralPath (Join-Path $envStash $rel) -Destination $target -ErrorAction Stop
         } catch {
           $restoreFailed = $true
           Write-Warning "could not restore $rel from $envStash`: $_"
         }
       }
     }
   }
   if ($restoreFailed) { throw "an env file is still in ${envStash}: move it back by hand before the gates run" }
   if ($stopExit -ne 0) {
     throw "a MiniMax session could not be stopped: interrupt it by hand, confirm it stopped, then move the env files back from $envStash"
   }
   if ($opencodeExit -eq 124) { throw 'MiniMax hit the 45-minute limit: report it, then treat it as a failed run (rule 8)' }
   if ($opencodeExit -ne 0) { throw "opencode run exited $($opencodeExit), so treat it as a failed run (rule 8)" }
   }
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
   `opencode.exe api post /api/session/<id>/interrupt` on each, by absolute path and with no shell. `--since
   <run start>` limits it to sessions touched during this run, so an old abandoned record cannot fail every later
   dispatch. The endpoint answers 200 with `{"interrupted": false}` when it stops nothing, as it did for a killed
   standalone session on 2026-10-20. So the stopper accepts only `interrupted: true` or a database that no longer
   shows the claim. Otherwise it fails, and **that session is never continued with `-s`**: its claim could be
   recovered later, so the next round starts a new session (rule 8). Run the staged copy by hand after any kill,
   with `--exe` set to the same checked `opencode.exe` (the stopper refuses any other path); `--dry-run` only lists.
   The stopper calls `opencode.exe api --standalone`, a private server for that one call (about 2 s), never the shared
   background service, and gives it the run's isolation on its own: `PWD` set to the worktree, a fresh
   config home holding only the two fixed files, and no `OPENCODE_*`, `XDG_DATA_HOME` or caller `XDG_CONFIG_HOME`.
   A manual cleanup from any shell is therefore as isolated as the dispatch. After a failed stop the env files stay
   in `env-stash`; move them back by hand only once the session is confirmed stopped. Until the PR that adds these scripts reaches `main`, stage
   them from that PR's reviewed head instead of `origin/main`.
   **Then look for anything nobody asked for:** save `git status --porcelain --ignored --untracked-files=all` before
   the run and again after it. Plain `--porcelain` hides ignored files, and MiniMax can create one (a `.log`, a
   `dist/` file). Every line the second snapshot adds must be a file the brief names, so any new file, ignored or not
   (a probe, a scratch script), or an edit to an unnamed file is reverted and reported to Waleed's super agent at once.
   An edit to a file already inside an ignored folder does not change either snapshot, which is why the
   permission file denies edits to those folders.
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

Staging is the Dokploy **compose service `pospay-staging`** in project `PayPos.Systems` (moved into Dokploy on
2026-10-23, Waleed: «أيوه، انقله»). Its compose file is `deploy/docker-compose.staging-shared.yml` from the repo and
its environment lives in Dokploy (secrets included; never print them). Following ADR-0001 §6 it serves the API at
https://api.staging.pospay.systems, the back-office at https://app.staging.pospay.systems and the cashier at
https://pos.staging.pospay.systems, on the server's shared Postgres and Redis. Waleed's standing rule (2026-10-23):
**staging is updated after every merge**, so every new feature can be tested there live; its data is demo data only.

The environment must hold the ADR-0001 hosts, which the CI staging builds bake in: `STAGING_HOST=api.staging.pospay.systems`,
`ADMIN_STAGING_HOST=app.staging.pospay.systems`, `POS_STAGING_HOST=pos.staging.pospay.systems`,
`COOKIE_DOMAIN=.staging.pospay.systems`, and `AUTH_TRUSTED_ORIGINS` either unset or exactly the app and pos origins. A
legacy value (`staging.pospay.systems`, an older origin list) is replaced, never kept; all three hosts have DNS A
records to the server (2026-10-23).

1. Confirm the main CI run for the merged SHA is green (it pushes the images to GHCR, the `-staging` admin and POS
   variants included). The server pulled GHCR images without a registry login on 2026-10-07; if a pull ever fails with
   an auth error, stop and ask the owner for a read-only package token (`docker login ghcr.io`) — never copy images by
   hand.
2. Take a backup: `docker run --rm --network dokploy-network --env-file /opt/pospay-staging/backup.env ghcr.io/lolotam/pospay-backup:<sha>`.
3. If `deploy/docker-compose.staging-shared.yml` changed, update the service's compose file in Dokploy to that SHA's
   content (`compose.update`, raw source). Note the SHA that is live now: it is the rollback target.
4. Set `IMAGE_TAG=<full-sha>` in the service's environment (change only that line, unless the compose file of that SHA
   requires a variable the environment lacks: add it first, as `deploy/staging.env.example` lists, or the
   interpolation aborts before any service starts), then `compose.deploy`. Prove it:
   `https://api.staging.pospay.systems/ready` answers 200, the worker's own `/ready` answers 200 from inside its
   container (`docker exec <worker> node -e "fetch('http://127.0.0.1:3001/ready')…"`, as the retired script did), both front ends answer 200, and the `migrate` container exited 0.
5. **When the release adds a migration, prove rollback** (constitution, Development Workflow): redeploy
   `<previous-sha>` (step 4 with that tag) against the new schema, confirm `/ready`, then redeploy `<full-sha>`. A
   previous image that does not start on the new schema is a P1 against the migration: redeploy `<full-sha>` at once,
   keep the release blocked, and open the P1.
6. On a failure of step 4, redeploy the previous SHA at once, then diagnose. Never leave staging down while diagnosing.

**Restore `<sha>`:** set `IMAGE_TAG=<sha>` (and, if `deploy/` changed since, that SHA's compose file) and redeploy;
Dokploy keeps every deployment and its log. The old `/opt/pospay-staging/staging-deploy.sh` path is retired.
7. **Standing yes for this one cron line** (Waleed, PP-12.2, 2026-10-20: «(a) Yes, now and on every future
   release.»). Every other change to the server itself still needs his yes (PP-12.1). Point
   `/etc/cron.d/pospay-backup` at the new `pospay-backup:<sha>` image from GHCR, never a locally built tag (a
   local image is removed by the server's cleanup and the nightly backup then fails silently).
8. Update the decisions page's «المشروع أول بأول» tab (`CLAUDE.md` §1 5c) at https://plan.pospay.systems
   (`docs/decisions-site.md` §B): `git pull` the `lolotam/plan` clone, set the merged rows, sub-tasks and any partner
   requests they close to done with the PR number in `public/roadmap.json`, add any new rows, bump `updated`, push to
   `main`, and confirm the live `roadmap.json` shows the change. Then read the answers back (§C of the same doc). If
   the merge adds or changes something users see, send 2–3 plain Arabic lines to `pospay-features` (§D, PP-13.2),
   never a bare merge notice; an internal fix gets none. A docs-only merge updates the tab too. A release is not reported to the owner until this is done.

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
