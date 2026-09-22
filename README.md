# PosPay

Multi-tenant, multi-vertical business-management SaaS — POS, inventory, appointments, staff
attendance & commissions, customers/loyalty and reporting. Arabic-first + English, RTL, KWD (3 decimals).

- Domain: <https://pospay.systems>
- Architecture: modular monolith, TypeScript end-to-end

## Read before writing any code

| File | Answers |
|---|---|
| [`CLAUDE.md`](./CLAUDE.md) | Day-to-day rules for every slice |
| [`CLAUDE.architecture.md`](./CLAUDE.architecture.md) | Where code goes and what it may import |
| [`docs/06_Tech_Stack_Architecture_EN.md`](./docs/06_Tech_Stack_Architecture_EN.md) | Which technology, and why |
| [`docs/module-map.md`](./docs/module-map.md) | The allowed arrows between modules |
| [`docs/specs/phase-0/`](./docs/specs/phase-0/) | What Phase 0 delivers, and in which order |

## Requirements

- Node.js 24 LTS (see `.nvmrc`)
- pnpm 12 (pinned in `package.json` → `packageManager`)

## Commands

| Command | What it does |
|---|---|
| `pnpm install` | Install every workspace |
| `pnpm check` | typecheck → lint → test → lint:docs. Must be green before a slice is done |
| `pnpm lint` | ESLint incl. boundaries, JSDoc and size limits |
| `pnpm lint:docs` | Banned comments: closing comments, debt markers, commented-out code |
| `pnpm format` | Prettier |

## Workflow

One slice per branch, one branch per PR, never commit to `main`.
Branch name: `feat/phase0-<slice-id>-<short-name>`. Commits follow Conventional Commits.
