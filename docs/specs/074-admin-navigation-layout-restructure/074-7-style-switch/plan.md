# 074-7a — Implementation plan

Spec: [`spec.md`](./spec.md). Tier Medium. One PR. Cap: 4,500 added plus removed lines of code and tests.

## Constitution check

Front end only: `apps/admin` and, for missing keys, `packages/i18n`. A change to `packages/ui` is allowed only to fix a defect that blocks composition, and each one is listed in the PR. No new dependency, API, contract, migration, permission or deploy. Cross-area composition stays in `app/(dashboard)/_frame` (CLAUDE.architecture.md §11.2); nothing with business meaning goes into `src/shared` (§6.4), so the cookie helpers sit beside `src/shared/locale` and the pages sit in their business areas. One React component per file, 60 lines per function, 400 per file. Strings through `packages/i18n`; logical CSS properties only; icons per ADR-0060.

## Work order

Commit after each step, with its tests green.

1. **Read first.** `design.md` §4 to §7, `app-map.md`, `navigation-model.ts`, `navigation-rules.ts`, `nav-types.ts`, every `*-nav-item.tsx`, and the exported props of the `@pospay/ui` navigation and shell parts. Write down, at the foot of this file, which existing read backs each visibility condition and which counts are free.
2. **Cookie and provider** (`src/shared/nav-style/`): parser, server reader, client writer and clearer, `NavStyleProvider`, `useNavStyle`. Unit tests.
3. **Visibility hook** in `_frame`: one boolean per condition, plus business type, country and role. Tests reuse the permission fixtures of the nav-item specs.
4. **View model** in `_frame`: one pure builder per style over a shared visible-page filter. Table-driven tests over all live routes and all three groupings.
5. **Frames**: C first (the default), then A, then B. One rendered test file per frame. Shared account-menu and top-bar actions are built once and reused.
6. **Pages**: Appearance, Approvals inbox, Overview, Under development, each with a rendered test asserting what the user sees.
7. **Gates and guards**, then the size count.

## Size estimate

| Increment | Production | Tests |
|---|---|---|
| Cookie, parser, provider | 120 | 150 |
| Visibility hook | 180 | 220 |
| View model, three builders | 520 | 520 |
| C frame | 300 | 300 |
| A frame | 300 | 280 |
| B frame | 330 | 300 |
| Shared account menu and top-bar actions | 160 | 120 |
| Four page components | 380 | 380 |
| i18n keys | 60 | 0 |
| **Total** | **2,350** | **2,270** |

Total 4,620 is an estimate against a cap of 4,500. If the running count passes 4,000 before step 6, stop and report with the remaining work listed, instead of trimming tests or cutting a frame.

## Drift guard for 7b

Each frame's rendered test mounts it with the real `NAVIGATION_GROUPINGS`, not a hand-made subset, so 7b can mount the same component without rework. Anything a frame needs from 7b (the style value at first paint, the route for Appearance) arrives as a prop or through the provider, never by reading a route that does not exist yet.

## Local gates

`pnpm typecheck`, `pnpm lint`, `pnpm lint:docs`, `pnpm module-map:check`, `pnpm --filter @pospay/admin test`, `pnpm --filter @pospay/ui test`, `pnpm --filter @pospay/i18n test`. No Playwright locally. The slice is complete only when `ci-gate` is green on the exact head.

## Review

The implementer runs `clean-code-guard` and `test-guard` and fixes what they find (PP-198). The owning session runs one whole-diff review, then MergePilot rounds under the Medium rules, at most three.

## Overlap

- `61-2d` adds the ratings entry for admins. If it merges first, rebase and keep its entry and its permission in the model; its nav-item file is folded in 7b.
- #1206 (#1201) touches `packages/ui` focus code only and does not overlap.
- Any PR that adds an admin page before 7b still adds a `*-nav-item.tsx`; 7b folds it.

## Implementation notes

*(filled by the implementer in step 1 and at the end: reads behind each condition, counts decision, actual sizes, deviations)*
