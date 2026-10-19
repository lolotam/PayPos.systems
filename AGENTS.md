# AGENTS.md — entry point for Codex and other agents

This repository's rules are **not** duplicated here, so they cannot drift apart.
Read these files fully, in this order, before any task or any review:

1. [`CLAUDE.md`](./CLAUDE.md) — day-to-day rules for every slice (workflow, comments, DB, API, security, testing)
2. [`CLAUDE.architecture.md`](./CLAUDE.architecture.md) — where code goes and what it may import
3. [`docs/06_Tech_Stack_Architecture_EN.md`](./docs/06_Tech_Stack_Architecture_EN.md) — which technology
4. [`docs/module-map.md`](./docs/module-map.md) — the allowed arrows between modules
5. [`.specify/memory/constitution.md`](./.specify/memory/constitution.md) — the project constitution
6. [`docs/PRD.md`](./docs/PRD.md) — product scope and phases

The names say "CLAUDE", but the rules apply to every agent equally.

**Owner questions.** An owner question is never guessed (`CLAUDE.md` §1 step 5b, §11). Every question and its answer
are recorded verbatim in the slice's `owner-questions.ar.md`, which is the audit record. Only charges/money questions
also go to the decisions page https://plan.pospay.systems as a new numbered batch (`docs/decisions-site.md`); permission,
technical and other product questions go to Waleed through his super agent. Only the Claude Code orchestrator routes a
question. Codex, Grok and other agents write the question into the slice's `owner-questions.ar.md` (or `docs/owner-decisions.ar.md`
when it belongs to no slice) with its answer marked `PENDING`,
mark the rule `TODO(spec)`, and stop. The orchestrator routes it and writes the answer back.

## Review guidelines

When reviewing a pull request, report only real defects, ranked by severity. Check first:

- a boundary violation from `CLAUDE.architecture.md` §3.1 (deep cross-module import, infrastructure in `domain/` or `use-cases/`)
- money held as a JS `number` instead of `bigint` mills or `Money`
- a tenant table without an RLS policy and a negative isolation test in the same PR
- arithmetic or business rules outside `domain/`
- `Date.now()` or `randomUUID()` inside a use case
- a `domain/`, `ports/` or `events/published.ts` export without an Arabic doc comment
- a secret, token or real customer phone number anywhere in the diff
- a guard that nests transactions, runs two at once, or opens a second transaction for a read that could share its `withTenant` (`CLAUDE.md` §6)
- `packages/db` throwing a plain `Error` for an outcome a caller can cause in normal use, instead of a typed error the API maps to a known code (`CLAUDE.md` §5)
- a frontend test that only checks a mock was called, with no assertion on what the user sees (`CLAUDE.md` §9)
