# DS-3 A2 — Tokens and browser colours: implementation plan

Date: 2026-11-20. Tier: **Light** (PP-195, PP-198: no guard skills, no `/code-review`), with the DS-3 exception
«زي ما هي + مراجعة بالمتصفح»: light/dark × ar/en screenshots in the PR.
Sources: #1081 items 2 and 3, #1082 item 8, `docs/plans/2026-11-19-design-and-backlog-plan.md` section A2, ADR-0059.
Branch `feat/ds3-a2-tokens`, from `origin/main` at `3c289221d` (after A1 merged). No migration, API, i18n key or new
dependency.

## Requirements and steps

1. **Delete the unused legacy scales** from the `@theme inline` block of `packages/ui/src/styles/theme.css`:
   `--color-ember-*`, `--color-ink-*` (including `ink-950`), `--color-teal-*`, `--color-crimson-*` and
   `--color-sand-50`. Kept: `sand-100…950`, `amber-*`, `indigo-*` (not in #1081.2) and `--color-tile-teal*`.
   **Usage proof (run before the edit, 2026-11-20):** a search of `apps/*/src`, `apps/*/app`, `packages/*/src`,
   `docs/adr` and `docs/specs` for `(bg|text|border|ring|…)-(ember|ink|teal|crimson)-NNN`, `sand-50` and
   `var(--color-(ember|ink|crimson)-…)` finds one hit outside `theme.css`: `brand-lockup.spec.tsx` asserts that
   `text-ink-950` is **absent** (still true after the deletion). `docs/design/brand-theme.source.css` is the upstream
   source copy and stays untouched. `docs/design/BRAND-GUIDE.md` §2.3 is updated.
2. **One test** in `packages/ui/src/__tests__/theme-tokens.spec.ts` (reuses its CSS parser and `toRgb`): the light and
   dark `--background` of `theme.css`, converted to `#RRGGBB`, equal `THEME_COLORS.light` / `.dark`; both
   `browserconfig.xml` files (`apps/admin/public`, `apps/pos/public`) have `<TileColor>` equal to the light colour; the
   admin `site.webmanifest` `theme_color` and `background_color` equal the light colour. (The POS manifest is built
   from `THEME_COLORS` in `apps/pos/vite.config.ts`, so it cannot drift.) If a hex differs only by a rounding step,
   stop and report; do not change a colour.
3. **Import grouping (#1082.8):** the `@pospay/ui/theme` import joins the other `@pospay` imports in
   `apps/admin/src/shared/locale/root-layout.tsx` and `apps/pos/vite.config.ts` (no blank line separating it from
   them). Imports only, no behaviour change.

## Gates and acceptance

`pnpm --filter @pospay/ui typecheck | lint | test`, `pnpm lint:docs`, `pnpm module-map:check`, admin and POS
typecheck, Prettier. Browser review: admin login and POS pairing screen look the same as before in light/dark × ar/en
(a deletion of unused aliases must change nothing visible).

## Out of scope

Native icons (A3), `apps/menu` (A4), any colour value change.
