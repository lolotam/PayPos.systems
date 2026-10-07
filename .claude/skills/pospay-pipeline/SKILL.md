---
name: pospay-pipeline
description: "PosPay's fixed delivery pipeline, decided by the owner (Waleed) on 2026-10-07. Use it for every row of a phase implementation plan, every new slice or use case, and every fix PR that touches production code in this repo. It pins who does each role (Grok 4.7 medium implements, Codex reviews, Claude orchestrates), the review-round cap, the parallel-task cap, the database review, the staging deploy and the owner report, so they are never re-asked. It runs on top of waleed-implementation-v2 and replaces that skill's questions and fallback chains for this project. Not for a typo, a docs-only change, or a question."
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
| **Implementer** — code, tests **and migrations** | **Cursor Grok 4.7 medium** (`grok-4.7-medium`, through `cursor-agent`) | yes, in its own worktree |
| **Database reviewer** | **Codex astra 6 medium** (`gpt-6-astra`, effort medium, relay `--read-only`) | no |
| Review layer 1 | Codex Sol 6.1 high (`gpt-6.1-sol`, effort high, relay `--read-only`) | no |
| Review layer 2 | a fresh Claude reviewer (new subagent, no prior context); the confirm round uses another fresh one | no |
| Review layer 3 | the Codex GitHub bot (`@codex review` comment); Codex CLI when the bot is out of quota | no |
| Fixer | the implementer, in the **same** Grok chat (§4); the orchestrator only for one-line fixes | yes |
| Staging server | the orchestrator only, over the `abdulaziz` SSH profile | — |

Fallback when Grok is dry or fails twice on one brief: Codex astra 6 high → orchestrator implements. Announce the
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
  Migration and ADR numbers are assigned **at merge time**: renumber the later PR after the earlier one lands.
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
| 6 | Review layer 1 | Codex Sol 6.1 high | findings fixed by Grok in its chat, or deferred per §2 |
| 7 | Review layer 2, then a confirm round | two fresh Claude reviewers | every earlier finding confirmed fixed |
| 8 | Push, open the PR (spec link + checklist), comment `@codex review` | orchestrator | layer 3 answered |
| 9 | CI `ci-gate` green **on the exact head being merged** | GitHub Actions | green |
| 10 | Merge: `gh pr merge <n> --squash --delete-branch` | orchestrator | merged |
| 11 | Deploy to staging (§6) | orchestrator | `/ready` answers ready on the new SHA |
| 12 | Journey doc `docs/journey/NN-<name>.md` (Arabic + English) in its own docs PR | orchestrator | merged after Codex review |
| 13 | Owner report (§7) | orchestrator | sent |

After **every** push, comment `@codex review` again — the bot reviews automatically only when a PR is opened.

---

## 4. Dispatching Grok — and keeping its tokens low

Grok 4.7 medium does better work than 4.6 but spends more tokens on the same quota. These rules keep a task's spend
down. Grok runs through the **Cursor subscription** (`cursor-agent`), not the xAI API, so the API's
`x-grok-conv-id` / `prompt_cache_key` cannot be set by us. What saves tokens here is reusing one chat and keeping its
prefix stable:

1. **One chat per task.** Before the first dispatch, create it and record the id in the task's notes:

   ```powershell
   Set-Location E:\Dev\Worktrees\PosPay\<branch>
   $chat = cursor-agent create-chat
   ```

2. **Every later round resumes that chat** instead of starting a new one, so Grok does not re-read the repo:

   ```powershell
   Get-Content brief.txt -Raw | cursor-agent --resume $chat --model grok-4.7-medium --trust --print --force --output-format text
   ```

   Drive it from **PowerShell**. On this machine the binary is `E:\Dev\Tools_and_Utilities\cursor-agent\cursor-agent.ps1`
   (on `PATH` as `cursor-agent`). Use `grok-4.7-medium`, not `-high`, `-fast` or `xhigh`.
3. **A fixed brief header, always in the same order and wording**, then the part that changes last:
   1. Role and fences — "You implement only task N. Do not commit. Do not touch files outside: …"
   2. Required reading — file **paths** only, in this fixed order: `CLAUDE.md`, `CLAUDE.architecture.md`, the
      `pospay-code-rules` and layer `SKILL.md` paths, the spec path, the ADR paths.
   3. The `CLAUDE.md` rules that apply, quoted verbatim.
   4. **Last:** the task, or the findings to fix.
4. **Send paths, not file contents.** Grok reads only what it needs.
5. **A fix brief carries only the new findings**, each as `file:line — what is wrong — what done looks like`. Never
   resend the spec or the earlier brief into a resumed chat.
6. **Start a new chat** only when the resumed one fails, or its context grows near 200K tokens (price doubles above
   it). Hand over with a ten-line summary of the state, not the history.
7. `cursor-agent` has **no read-only mode**. After every dispatch, diff the worktree against the baseline: a run with
   no change is a failed candidate, whatever it reports.

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

1. Confirm the main CI run for the merged SHA is green (it pushes the images to GHCR).
2. Take a backup: `docker run --rm --network dokploy-network --env-file /opt/pospay-staging/backup.env ghcr.io/lolotam/pospay-backup:<sha>`.
3. If `deploy/` changed, fetch the new `docker-compose.staging-shared.yml` from GitHub raw at that SHA and compare its
   sha256 with the repo before replacing the server copy.
4. `./staging-deploy.sh <full-sha>`; it migrates, starts, and proves `/ready`.
5. On failure, redeploy the previous SHA at once, then diagnose. Never leave staging down while diagnosing.
6. Point `/etc/cron.d/pospay-backup` at the new `pospay-backup:<sha>` image from GHCR, never a locally built tag (a
   local image is removed by the server's cleanup and the nightly backup then fails silently).

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
