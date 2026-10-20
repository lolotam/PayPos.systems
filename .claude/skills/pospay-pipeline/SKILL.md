---
name: pospay-pipeline
description: "PosPay's fixed delivery pipeline, decided by the owner (Waleed) on 2026-10-07 and updated 2026-10-14. Use it for every row of a phase implementation plan, every new slice or use case, and every fix PR that touches production code in this repo. It pins who does each role (Grok CLI grok-4.7 high implements, Codex and the MergePilot panel review, Claude orchestrates), the review-round cap, the parallel-task cap, the database review, the guard pass, the staging deploy, the status page and the owner report, so they are never re-asked. It runs on top of waleed-implementation-v2 and replaces that skill's questions and fallback chains for this project. Not for a typo or a question. A docs-only change follows the docs-only lane (§2), and every merge, docs-only included, still updates the decisions page's status tab (§6 step 8)."
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
| **Implementer** — code, tests **and migrations** | **Default: opencode `minimax-coding-plan/MiniMax-M3.1-Flash`** (default variant). **Grok CLI `grok-4.7`, effort high** for big end-to-end or sensitive (money, permissions, auth, tenant isolation) slices, at the orchestrator's call — owner's choice 2026-10-20 (PP-10.1). Every MiniMax brief bans all git commands, unrelated reformatting and line-squashing to dodge `max-lines`; the reviewer diffs every rewritten SQL function body against the old one | yes, in its own worktree |
| **Database reviewer** | **Codex astra 6 medium** (`gpt-6-astra`, effort medium, `codex exec -s read-only`) | no |
| Review layer 1 | **Codex astra 6 medium** (`gpt-6-astra`, effort medium, `codex exec -s read-only`) — owner's choice 2026-10-11 | no |
| Review layer 2 | **one** fresh Claude reviewer, **Sonnet 5.5 at medium effort** (`claude-sonnet-5-5`), given the diff, the spec and the governing documents (§8 rule 5), never the session history; **high** effort for money, tenant isolation (RLS), auth and migrations; none for a docs-only PR (§8 rule 5) | no |
| Review layer 3 — **four bots** | the Codex GitHub bot (`chatgpt-codex-connector[bot]`, `@codex review` after every push; Codex CLI when out of quota) **and** the MergePilot panel (`mergepilot-review[bot]`): MergePilot (`gpt-6.1-sol`), waleed_bot (`claude-sonnet-5-5`), mohamed_bot (`grok-4.7`), which reviews every pushed commit on its own | no |
| Draft writer (§8 rule 6) | Codex or a free model (GLM) writes first drafts of specs, ADRs, journey docs and the HANDOVER; the orchestrator edits and owns the result | yes |
| Fixer | the implementer, resuming **its own Grok session** with only the findings (§4); the orchestrator (or a doc-writing session) for a one-line fix, for any fix on a docs-only PR (no Grok session exists), and after two Grok failures (§8 rule 4) | yes |
| Staging server | the orchestrator only, over the `abdulaziz` SSH profile | — |

On 2026-10-14 the owner picked `grok-4.7` at reasoning effort high from the live list (`grok models`: `grok-4.7`,
`grok-4.7-build-fast`, `grok-4.6`, `grok-4.5`). Re-check `grok models` before the first dispatch of a session; if the id
is gone, or the CLI says "not authenticated" or a call returns 402, ask the owner — never substitute silently.

Fallback when Grok fails twice on one brief (§4 rule 9): the orchestrator implements. Announce the substitution the
moment it happens, in the owner report. Never switch to a metered provider without the owner saying so.

---

## 2. Limits

- **Review rounds: at most 5 per PR**, counting every review → fix cycle across all three layers and the database
  review. After round 5, sort what is left by severity:
  - **P0 / P1** (security, money, tenant isolation, data loss, correctness): both design advisors propose a fix, the
    implementer applies it, and the PR **stays blocked** until it is fixed and confirmed. The cap never lowers the bar.
  - **P2 / P3**: open a GitHub issue per finding, linked from its review thread, then merge.
- **Parallel work: at most 3 tasks at once**, and only when their file paths are **disjoint**. Two tasks that touch the
  same file wait for each other. Each task has its own branch, worktree (`E:\Dev\Worktrees\PosPay\<branch>`) and PR.
  Migration and ADR numbers are assigned **at merge time**: renumber the later PR after the earlier one lands. Each
  slice still merges only when it is green on its own head (constitution Principle I, as amended 2026-10-07).
- **One use case per PR** (`CLAUDE.md` §1). A task that needs two use cases is two PRs.
- **Docs-only lane** (owner, 2026-10-17). A PR whose files are all under `docs/**`, `*.md`, `.claude/skills/**` or
  `.specify/**` (no code, no migration, no generated file) skips §3 steps 2, 5 (except `docs-guard`), 6, 7, 8 and 14, needs no implementer dispatch (§3 step 3; specs and ADRs are drafted by a cheaper model and edited and owned by the orchestrator, §8 rule 6) and no spec (§3 step 1) unless the PR is itself a spec, judges §3 step 4 by `pnpm format:check` (`prettier --check .`, which covers Markdown) instead of the full `pnpm check`, and skips the
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
| 3 | Brief and dispatch the implementer (§4), baseline captured first | orchestrator → Grok | Grok reports done; the delivery is kept as the first commit, as delivered |
| 4 | Judge the delivery: diff against the baseline, read it against the spec, merge `main`, renumber migrations/ADRs, `pnpm check` | orchestrator | `pnpm check` green |
| 5 | Guard pass: `clean-code-guard` on production code, `test-guard` on tests, `docs-guard` on docs (global `CLAUDE.md` guard workflow) | orchestrator | findings fixed or recorded |
| 6 | Database review — **mandatory** when the PR touches `packages/db/**` (schema, migration, RLS, grants, seed) | Codex astra 6 medium | no open P0/P1 (§5 checklist) |
| 7 | Review layer 1 | Codex astra 6 medium | findings fixed by Grok in its resumed session, or deferred per §2 |
| 8 | Review layer 2 — one Sonnet 5.5 reviewer (§8 rule 5); no separate confirm round, the four bots confirm on the head SHA in step 9 | fresh Claude reviewer | its findings fixed by Grok or deferred per §2 |
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

## 4. Dispatching Grok — and keeping its tokens low

Grok runs through the **Grok CLI** (`grok` on `PATH`, installed under `E:\Dev\Tools_and_Utilities\grok`, signed in with the
owner's grok.com account), model **`grok-4.7`** at reasoning effort **high** — never through `cursor-agent`,
which bills a different quota. The CLI hides the xAI API, so `x-grok-conv-id` / `prompt_cache_key` cannot be set by us;
what saves tokens is reusing one session and keeping its prefix stable:

1. **One session per task.** Before the first dispatch, create a UUID and record it in the task's notes; the first
   run names the session with `-s`:

   ```powershell
   $sid = [guid]::NewGuid().ToString()
   grok --cwd E:\Dev\Worktrees\PosPay\<branch> -m grok-4.7 --reasoning-effort high `
       -s $sid --prompt-file E:\Dev\Worktrees\PosPay\briefs\<task>\brief.txt --always-approve --permission-mode bypassPermissions --output-format plain
   ```

2. **Every later round resumes that session** instead of starting a new one, so Grok does not re-read the repo:

   ```powershell
   grok --cwd E:\Dev\Worktrees\PosPay\<branch> -m grok-4.7 --reasoning-effort high `
       --resume $sid --prompt-file E:\Dev\Worktrees\PosPay\briefs\<task>\fix-<round>.txt --always-approve --permission-mode bypassPermissions --output-format plain
   ```

   Pass the brief with `--prompt-file`. `grok "prompt"` without `--prompt-file`/`-p` opens the interactive TUI and
   looks hung in a background shell. Keep briefs **outside** the worktree (`E:\Dev\Worktrees\PosPay\briefs\<task>\`)
   so they never land in the diff, and pass them by absolute path: `--prompt-file` resolves against the shell's
   current directory, not against `--cwd`.
3. **A fixed brief header, always in the same order and wording**, then the part that changes last:
   1. Role and fences — "You implement only task N. Do not commit. Do not touch files outside: …"
   2. Required reading — file **paths** only, in this fixed order: `CLAUDE.md`, `CLAUDE.architecture.md`, the spec
      path, the plan path, the ADR paths, then the source files the task starts from.
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
   no change is a failed candidate, whatever it reports. `grok usage <session-id>` shows a session's token spend.
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
  3. what runs now (row, PR, review round, Grok cache share);
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
4. **Fix rounds go to Grok.** When a bot finds something, the findings go to the implementer's resumed Grok session
   (§4 rule 2, `file:line — what is wrong — what done looks like`). Claude judges whether the fix is right; it does not
   retype it. A Claude session fixes a finding itself only when it is a one-line change. Two exceptions stay as written:
   a docs-only PR has no Grok session, so the orchestrator (or a doc-writing session) fixes its findings; and after two
   Grok failures on one brief the orchestrator implements (§1 fallback).
5. **One cheaper review layer 2.** One fresh Sonnet 5.5 reviewer at medium effort replaces the two Opus-class reviewers
   (review and confirm round). It gets the diff, the spec and the governing documents (`CLAUDE.md`, `CLAUDE.architecture.md`, `docs/06_Tech_Stack_Architecture_EN.md`, `docs/module-map.md`, the ADRs the slice cites), never the session history, so its context stays small. Use high
   effort when the PR touches money, tenant isolation, auth or migrations, (the other-vendor reviewer is review layer 1, Codex astra 6, which already runs on every code PR in §3 step 7; the docs-only lane skips it and has no layer 2 either). A docs-only
   PR gets no Claude reviewer. The confirm round is dropped: the four bots re-review the head SHA after every push.
6. **Drafts are written by cheaper models.** (Draft writer role, listed in §1.) First drafts of specs, ADRs, journey docs and the HANDOVER go to Codex or a
   free model (GLM) and Claude edits them. Claude writes a document from scratch only when it records a decision it
   alone has the context for.
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

- Never let Grok commit, merge, push, or touch the server.
- Never merge with a P0/P1 open, or with CI red on the head being merged.
- Never exceed 5 review rounds without applying §2 (a docs-only PR has no cap, see the docs-only lane in §2), and never exceed 3 parallel tasks.
- Never run two tasks in parallel that touch the same file.
- Never change the staging database by hand without the owner's explicit approval for that change.
- Never rewrite a pushed branch's history (`--force`) without the owner's explicit approval.
