# ADR-0004 — Test runner: Vitest

- **Status:** Accepted
- **Date:** 2026-09-23
- **Slice:** Phase 0 · T3 — `packages/domain`

## Context

ADR-0002 left the test runner to T3, the first slice with tests. The same `packages/domain` functions
run in three places: `api`, `worker` (Node) and `apps/pos` (browser, Vite). The workspace is ESM-only,
TypeScript 6, `moduleResolution: Bundler`, and `apps/pos` is already a Vite app (`06` §2).

## Decision

**Vitest 5.0.1**, one `vitest run` per package, wired to `turbo run test` (already in `pnpm check` and CI).

| Option | Why not |
|---|---|
| Jest | ESM and TypeScript need a transform layer (`ts-jest` or Babel); a second module system to keep working next to Vite |
| `node:test` | Node-only; cannot share config with the browser-side POS tests; no `it.each` table tests, which the money tests rely on |
| Vitest | **chosen** — runs TS and ESM natively, same transform pipeline as `apps/pos` (Vite), Jest-compatible API |

## Consequences

- No config file is needed while defaults hold; a package adds `vitest.config.ts` only when it needs one.
- Tests live in `src/__tests__/*.spec.ts`; ESLint and `lint:docs` already exclude `*.spec.ts` from the JSDoc rules.
- `packages/domain` sets `"types": []` in its tsconfig, so source code cannot use Node globals by
  accident; the tests only import from `vitest`.
- Integration tests (T4/T5 onward) use the same runner against the T2 compose Postgres, one cloned database per spec file — see ADR-0006.
