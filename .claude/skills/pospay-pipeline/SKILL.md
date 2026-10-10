---
name: pospay-pipeline
description: "PosPay's fixed delivery pipeline, decided by the owner (Waleed) on 2026-10-07. Use it for every row of a phase implementation plan, every new slice or use case, and every fix PR that touches production code in this repo. It pins who does each role (Grok 4.7 high implements, Codex reviews, Claude orchestrates), the review-round cap, the parallel-task cap, the database review, the staging deploy and the owner report, so they are never re-asked. It runs on top of waleed-implementation-v2 and replaces that skill's questions and fallback chains for this project. Not for a typo, a docs-only change, or a question."
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

Load `pospay-code-rules` for every task, and the layer skills stage by stage as `pospay-router` describes.

---

## 1. The lanes

| Role | Who (friendly name → live id) | Writes files? |
|---|---|---|
| Orchestrator | Claude Code (this session) | yes — specs, briefs, merges, renumbering, small fixes |
| Design advisors (risky slices only, §3 step 2) | Codex astra 6 medium (`gpt-6-astra`, effort medium) **and** Claude Fable 5.1 medium (`claude-fable-5-1`) | no — read-only |
| **Implementer** — code, tests **and migrations** | **Codex Sol 6.1 high** (`gpt-6.1-sol`, effort high, `codex exec -s workspace-write`) — owner's choice 2026-10-11 (Grok 4.7 is out of balance) | yes, in its own worktree |
| **Database reviewer** | **Codex astra 6 medium** (`gpt-6-astra`, effort medium, `codex exec -s read-only`) | no |
| Review layer 1 | **Codex astra 6 medium** (`gpt-6-astra`, effort medium, `codex exec -s read-only`) — owner's choice 2026-10-11 | no |
| Review layer 2 | a fresh Claude reviewer (new subagent, no prior context); the confirm round uses another fresh one | no |
| Review layer 3 | the Codex GitHub bot (`@codex review` comment); Codex CLI when the bot is out of quota | no |
| Fixer | the implementer (Codex Sol 6.1 high, a new `workspace-write` run with only the findings); the orchestrator only for one-line fixes | yes |
| Staging server | the orchestrator only, over the `abdulaziz` SSH profile | — |

Fallback when Codex Sol fails twice on one brief: the orchestrator implements (Grok 4.7 high again once its balance is topped up). Announce the
substitution the moment it happens, in the owner report. Never switch to a metered provider without the owner saying so.

---

## 2. Limits

- **Review rounds: at most 5 per PR**, counting every review → fix cycle across all three layers and the database
  review. After round 5, sort what is left by severity:
  - **P0 / P1** (security, money, tenant isolation, data loss, correctness): both design advisors propose a fix, Grok
    applies it, and the PR **stays blocked** until it is fixed and confirmed. The cap never lowers the bar.
  - **P2 / P3**: open a GitHub issue per finding, linked from its review thread, then merge.
- **Parallel work: at most 3 tasks at once**, and only when their file paths are **disjoint**. Two tasks that touch the
  same file wait for each other. Each task has its own branch, worktree (`E:\Dev\Worktrees\PosPay\<branch>`) and PR.
  Migration and ADR numbers are assigned **at merge time**: renumber the later PR after the earlier one lands. Each
  slice still merges only when it is green on its own head (constitution Principle I, as amended 2026-10-07).
- **One use case per PR** (`CLAUDE.md` §1). A task that needs two use cases is two PRs.

---

## 3. The steps

| # | Step | Owner | Done when |
|---|---|---|---|
| 0 | Pick the next row of the phase plan, or the task the owner names | orchestrator + owner | row named in the report |
| 1 | Spec: `/speckit-specify` → `docs/specs/NNN-<module>-<use-case>/spec.md` | orchestrator | every business rule is in the spec or asked; an unknown rule is a `TODO(spec)` and a stop |
| 2 | Design advice — **only** when the slice parses files, runs long work, may cross 200 ms, moves money, or changes auth/RLS | both advisors, read-only | the chosen design is written into the spec |
| 3 | Brief and dispatch Grok (§4), baseline captured first | orchestrator → Grok | Grok reports done; the delivery is kept as the first commit, as delivered |
| 4 | Judge the delivery: diff against the baseline, read it against the spec, merge `main`, renumber migrations/ADRs, `pnpm check` | orchestrator | `pnpm check` green |
| 5 | Database review — **mandatory** when the PR touches `packages/db/**` (schema, migration, RLS, grants, seed) | Codex astra 6 medium | no open P0/P1 (§5 checklist) |
| 6 | Review layer 1 | Codex Sol 6.1 high | findings fixed by Grok in its session, or deferred per §2 |
| 7 | Review layer 2, then a confirm round | two fresh Claude reviewers | every earlier finding confirmed fixed |
| 8 | Push, open the PR (spec link + checklist), comment `@codex review` | orchestrator | layer 3 answered |
| 9 | CI `ci-gate` green **on the exact head being merged** | GitHub Actions | green |
| 10 | Merge: `gh pr merge <n> --squash --delete-branch --match-head-commit <reviewed-sha>` — a push after the reviews makes the merge fail instead of landing an unreviewed head | orchestrator | merged |
| 11 | Deploy to staging (§6) | orchestrator | `/ready` answers ready on the new SHA |
| 12 | Journey doc `docs/journey/NN-<name>.md` (Arabic + English) in its own docs PR | orchestrator | merged after Codex review |
| 13 | Owner report (§7) | orchestrator | sent |

After **every** push, comment `@codex review` again — the bot reviews automatically only when a PR is opened.

---

## 4. Dispatching Grok — and keeping its tokens low

Grok runs through the **Grok CLI** (`E:\Dev\Tools_and_Utilities\grok\grok.exe`, signed in with the owner's grok.com
account), model `grok-4.7` at reasoning effort **high** — never through `cursor-agent`, which bills a different quota.
Grok 4.7 spends more tokens than 4.6 on the same quota, so these rules keep a task's spend down. The CLI hides the
xAI API, so `x-grok-conv-id` / `prompt_cache_key` cannot be set by us; what saves tokens is reusing one session and
keeping its prefix stable:

1. **One session per task.** Before the first dispatch, create a UUID and record it in the task's notes; the first
   run names the session with `-s`:

   ```powershell
   $sid = [guid]::NewGuid().ToString()
   & E:\Dev\Tools_and_Utilities\grok\grok.exe --cwd E:\Dev\Worktrees\PosPay\<branch> -m grok-4.7 --reasoning-effort high `
       -s $sid --prompt-file brief.txt --always-approve --permission-mode bypassPermissions --output-format plain
   ```

2. **Every later round resumes that session** instead of starting a new one, so Grok does not re-read the repo:

   ```powershell
   & E:\Dev\Tools_and_Utilities\grok\grok.exe --cwd E:\Dev\Worktrees\PosPay\<branch> -m grok-4.7 --reasoning-effort high `
       --resume $sid --prompt-file fix.txt --always-approve --permission-mode bypassPermissions --output-format plain
   ```

   Drive it from **PowerShell** and pass the brief with `--prompt-file`. `grok "prompt"` without `--prompt-file`/`-p`
   opens the interactive TUI and looks hung in a background shell.
3. **A fixed brief header, always in the same order and wording**, then the part that changes last:
   1. Role and fences — "You implement only task N. Do not commit. Do not touch files outside: …"
   2. Required reading — file **paths** only, in this fixed order: `CLAUDE.md`, `CLAUDE.architecture.md`, the
      `pospay-code-rules` and layer `SKILL.md` paths, the spec path, the ADR paths.
   3. The `CLAUDE.md` rules that apply, quoted verbatim.
   4. **Last:** the task, or the findings to fix.
4. **Send paths, not file contents.** Grok reads only what it needs.
5. **A fix brief carries only the new findings**, each as `file:line — what is wrong — what done looks like`. Never
   resend the spec or the earlier brief into a resumed session.
6. **Start a new session** only when the resumed one fails, or its context grows near 200K tokens (price doubles above
   it). Hand over with a ten-line summary of the state, not the history. Grok CLI auto-compacts a session at 80 %
   context ("Auto-compacting conversation") and replaces the history with its own summary. The cache survived it once
   (23a round 3: 97.8 %), but the summary is Grok's, not ours: past round 3, or when `grok usage` input nears that
   line, start the fresh session yourself with the ten-line handover before dispatching.
7. The run is writable and auto-approving. After every dispatch, diff the worktree against the baseline: a run with
   no change is a failed candidate, whatever it reports. `grok usage` shows a session's token spend for the report.
8. **Measure the cache after every round** with `grok usage <session-id>` (run in the worktree) and put the numbers in
   the owner report: input tokens, `cachedReadTokens` and their share, output tokens, model calls, cost. Target **90 %
   or more** of input served from cache — the first 23a fix on 2026-10-07 reached 95 % (4.85 M of 5.1 M). A share
   below that means the prefix moved: check that the session was resumed (not a new `-s`), that the brief header was
   byte-identical, and that no file content was pasted into the brief.
9. **When a Grok run is dry or fails**, stop its process, save its partial diff as a patch outside the repo and reset
   the worktree to the baseline — never hand a half-edited tree to the next run. Then count failures on that brief:
   - **First failure:** retry Grok once in a new session (rule 6) with the same brief plus one line on what went wrong.
   - **Second failure on the same brief:** dispatch the fallback (§1) and announce the switch in the owner report.

---

## 5. Database work

- **Grok writes** migrations, schema, RLS policies, grants and seed with the rest of the slice. The database reviewer
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
8. Update the decisions page's «المشروع أول بأول» tab (CLAUDE.md §1 5c): read the live page, set the merged rows,
   sub-tasks and any partner requests they close to done with the PR number, add any new rows, bump `updated`, and
   republish `roadmap.json` to the same URL. A release is not reported to the owner until this is done.

The server is shared: never touch another project's containers, databases or files.

---

## 7. Talking to the owner

- Egyptian Arabic, simple words — the owner is not technical. English terms stay in English on their own bullet.
- After every merge, and from time to time during long work, send the progress report in the fixed shape saved in
  memory (`progress-report-format`): the 7 phases, the phase's groups with counts recounted from `git log` and
  `gh pr list` every time, what runs now, what comes next, what waits on the owner.
- Ask the owner — with options and a recommended one — for every business rule, every server change, and every
  merge that skips a gate. Never guess a business rule.

---

## 8. Never

- Never let Grok commit, merge, push, or touch the server.
- Never merge with a P0/P1 open, or with CI red on the head being merged.
- Never exceed 5 review rounds without applying §2, and never exceed 3 parallel tasks.
- Never run two tasks in parallel that touch the same file.
- Never change the staging database by hand without the owner's explicit approval for that change.
- Never rewrite a pushed branch's history (`--force`) without the owner's explicit approval.
