# ADR-0002 — Workspace tooling baseline

- **Status:** Accepted
- **Date:** 2026-09-22
- **Slice:** Phase 0 · T1 — workspace skeleton

## Context

`06_Tech_Stack_Architecture_EN.md` fixes pnpm workspaces + Turborepo + TypeScript + Node.js LTS.
T1 has to turn that into exact versions, and `CLAUDE.md` §11 requires an ADR for every library
introduced. This ADR records the versions and the three non-obvious choices.

## Decision

| Tool | Version | Role |
|---|---|---|
| Node.js | 24 LTS | runtime (`.nvmrc`, `engines`) |
| pnpm | 12.5.1 | package manager (`packageManager`) |
| Turborepo | 2.11.2 | task runner and cache |
| TypeScript | **6.0.3** | type checking |
| ESLint | 10.11.0 | lint, flat config in `packages/config` |
| typescript-eslint | 8.70.1 | TS parser + rules |
| eslint-plugin-boundaries | 7.2.0 | the import matrix (`CLAUDE.architecture.md` §3.1) |
| eslint-import-resolver-typescript | 4.4.5 | lets `boundaries` resolve `.ts` imports |
| eslint-plugin-jsdoc | 64.5.4 | Arabic JSDoc coverage (`CLAUDE.md` §3.1) |
| Prettier | 3.9.8 | formatting |

### 1. TypeScript is pinned to 6.0, not 7

TypeScript 7 (the native port) is `latest`, but `typescript-eslint` 8.70 declares
`typescript: <6.1.0`. Running lint against an unsupported compiler gives silent false negatives —
exactly the failure mode a boundary gate cannot afford. Move to 7 when `typescript-eslint` supports it.

### 2. pnpm build scripts are denied by default

pnpm 12 blocks dependency install scripts unless approved in `pnpm-workspace.yaml` → `allowBuilds`.
`unrs-resolver` is explicitly denied: it ships prebuilt binaries through optional dependencies, so its
postinstall is not needed. Every future approval is a reviewed line in that file.

### 3. pnpm minimum release age stays on

pnpm 12 refuses packages published in the last few days (supply-chain protection). Where a pinned
version is newer than that window, pnpm records it under `minimumReleaseAgeExclude`. Those entries are
reviewed, not blanket-disabled.

### Not decided here

The test runner is chosen in T3, the first slice that has tests.

## Consequences

- `pnpm check` = `turbo run typecheck lint test` + `pnpm lint:docs`, and CI runs exactly that.
- ESLint allows 400 lines per file (error). The 300-line *warning* in `CLAUDE.md` §3 cannot be expressed
  alongside the error with one rule; it is left to review until a custom rule is worth writing.
- Boundaries: cross-module imports resolve only through a module's `index.ts` (enforced by
  `boundaries/entry-point`); which *modules* may import which is checked separately against
  `docs/module-map.md` in T12.
- `use-cases/` cannot call the global `fetch` (`no-restricted-globals`), not only import an HTTP client.
- `events/published.ts` needs a JSDoc on every exported interface/type alias.
- `pnpm lint:docs` rejects a JSDoc block in `domain/**`, `ports/**` or `events/published.ts` that
  contains no Arabic letter — the language rule in `CLAUDE.md` §3.1 is a gate, not a convention.

### Amendment 2026-09-22 — after Codex review of PR #1

The four points above were added in response to the automated review. `CLAUDE.architecture.md` and
`docs/module-map.md` were added to the repo in the same PR.
