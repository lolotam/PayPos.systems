# Common rules for the four implementers (statements chain delivery)

You are one of four implementers. You write the code, the tests and the migrations of your lane, in your own worktree.
You do the work yourself: start no sub-agents. Your manager is the delivery session that dispatched you; it reviews
every PR, sets the merge and migration order with the PosPay manager, and is the only one who talks to the owners.

## Read first, in this order

1. `AGENTS.md`, then `CLAUDE.md`, `CLAUDE.architecture.md`, `docs/module-map.md` (the rules of this repository).
2. This delivery: `docs/specs/059-commissions-statements/51-56-statements-delivery/` — `spec.md`, `plan.md`,
   `research.md`, `data-model.md`, `contracts/statement-flow.md`, `quickstart.md`, then your lane brief.
3. The canonical rows your lane names in `docs/specs/059-commissions-statements/spec.md` (the FR, CM and D ids) and
   the answers in `owner-questions.ar.md`. **The canonical spec wins** over this delivery's documents; if they
   disagree, stop and report it.

If the delivery folder is not in your worktree, read it from the plan commit your dispatch message names:
`git show <plan-sha>:docs/specs/059-commissions-statements/51-56-statements-delivery/plan.md` (same for the others).

## Before any git write

`git rev-parse --show-toplevel` must print your own worktree. If it prints the main checkout, stop and report.
One branch per part, cut from fresh `origin/main` (or stacked where your brief says so):
`feat/059-<part>-<short-name>`. Push with an explicit branch: `git push origin HEAD:<branch>`. Never push to `main`.
Never use bare `git stash`. Never delete another session's branch or worktree.

## Hard rules of this delivery

- **No new business rule.** Money, permissions, tenant scope: only what the cited FR, D and CS-Q say. Anything
  unanswered: write `TODO(spec)`, stop that subtask, report. Never guess.
- **Money** is `bigint` mills in TypeScript, `numeric(14,3)` in Postgres, KWD strings on the wire. Never a `number`.
  Arithmetic lives in `packages/commissions-engine` or a module's `domain/`, with unit tests that need no database.
- **Locks:** one ascending `lockStatementPeriods` call per transaction; no status is read before its lock.
- **Use cases** contain no SQL, no `drizzle`, no `fetch`, no `Date.now()`, no `randomUUID()`; `Clock` and
  `IdGenerator` are injected.
- **Arabic JSDoc** on every exported `domain/` function, every `ports/` method and every event in
  `events/published.ts`. No closing comments, no `FIXME`/`HACK`, no commented-out code.
- **Files** ≤ 400 lines, functions ≤ 60. Split by responsibility.
- **Migrations:** build and test on your private cluster. **Do not take a migration number, run `pnpm db:generate`
  for the final files, or push a branch that contains a migration until your manager writes «lane granted».** While
  you wait, keep the SQL in your worktree and say in your report that the part is «ready for the lane».
- **Shared files** (`plan.md` _Shared files_): add lines only, never reorder or reformat; regenerate `openapi.json`
  and the `schema.d.ts` files with `pnpm contracts:openapi` after rebasing, never hand-merge them.
- **Stay in your lane.** Do not edit a file another lane owns in `plan.md`. If you must, stop and report why.
- **Dependent parts:** when your brief says a part waits for a merge or an answer, do only its preparation (reading,
  fixtures, pure functions with unit tests, test skeletons). Do not write its migration, do not open its PR.
- **Never deploy.** No staging or production step, no server, no secret, no `.env` copied from another worktree.
- **Size:** a part that grows past twice the size in `plan.md` is stopped and reported before you continue.

## Database for tests

`node scripts/test-db/lane.mjs up <your-lane>` gives you a private Postgres; `down <your-lane>` stops it. Never use
the shared cluster. Run database test files one at a time. Build first: `pnpm --filter "@pospay/db^..." build`.
Commands and gates are in `quickstart.md`. The full `pnpm check`, the API shards and Playwright run in CI only.

## Finishing a part

1. Local gates green (`quickstart.md`).
2. Run the guard skills yourself and fix what they find: `clean-code-guard` and `test-guard` on every part;
   `waleed-security-reviewer` as well on every Heavy part (the tier is in `plan.md`).
3. Open one PR for the part (not a draft), base `main` unless stacked. The body has, in this order: the feature line
   «<part id> — <Arabic title>», a short plain Arabic summary, the flags «فلوس / صلاحيات / migration: نعم أو لا», the
   tier, links to the canonical FR ids and to this delivery's `spec.md`, the checklist of CLAUDE.md §10 (spec,
   migration, RLS, indexes, tests, i18n, doc comments, docs), the measured size, and the guard-skill results. Commit
   messages are conventional (`feat(commissions): … (<part id>)`).
4. Do not merge. Do not answer review bots with behaviour changes on your own: report, and apply the consolidated
   fix list your manager sends, one push per round.

## Reporting

Report only on events, in one message each: a part reaching «implementation complete, pending `ci-gate`» with its PR
number, branch, exact head SHA, test counts and measured size; a part «ready for the lane»; a blocker that needs a
decision; a disagreement between documents and code. Say what actually happened: failing tests are reported with
their output, skipped steps are named. End every report with what you need from your manager, if anything.
