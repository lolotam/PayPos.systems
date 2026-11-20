# DS-3 A3 — Native app icons: implementation plan

Date: 2026-11-20. Tier: **Light** (PP-195; PP-198: no guard skills, no `/code-review`), with the DS-3 exception
«زي ما هي + مراجعة بالمتصفح»: the generated icon images are attached to the PR.
Sources: #1081 item 4, `docs/plans/2026-11-19-design-and-backlog-plan.md` section A3, ADR-0055, `apps/business/README.md`
(icons and splash section). Branch `feat/ds3-a3-native-icons`, from `origin/main` at `fd73ba279`. No migration, API,
i18n key or dependency.

## Decisions made in this task

- **Source art:** the Souk Tiles favicon, `android-chrome-512x512.png` in `apps/pos/public` (identical in
  `apps/admin/public`; DS-1, #1079). It is a 512 px raster: there is no SVG or larger source in this repository or in
  the upstream `lolotam/lovable-pospay` tree. A copy is kept as `apps/business/assets/brand/souk-tile-p.png`.
- **Keep the existing overlays:** the navy «B» circle (APP-Q21) and, on the staging flavour, the purple «تجربة» strip
  (APP-Q22) stay exactly as designed; only the orange P on an orange tile is replaced.
- **Background:** the cream of the artwork, `#FBF9F5`, also becomes the Android adaptive-icon background colour
  (`values/ic_launcher_background.xml`), so the foreground layer blends in.
- **Shapes (unchanged conventions):** legacy `ic_launcher` is a rounded square (radius 18 %), `ic_launcher_round` a
  circle, `ic_launcher_foreground` the 0.9-scaled tile on a transparent canvas, iOS `AppIcon` / `AppIconStaging` an
  opaque 1024 px RGB square.
- **Unsupported-device notice:** `DeviceMobileSlash` stays (no change to `apps/pos`).

## Steps

1. The four SVG sources in `apps/business/assets/brand/` reference `souk-tile-p.png` by relative path.
2. The 32 PNGs (15 Android main, 15 Android staging, 2 iOS) are regenerated from those SVGs with Chromium (Playwright,
   Windows, Segoe UI for «B» and «تجربة»), exactly as the README describes; the script stays outside the repository.
3. README section updated; journey 95 gets the app-icon step (Arabic and English).

## Out of scope

The launch screen (`drawable/splash_mark.xml`, `splash.png`, iOS `Splash`) keeps the orange logo: the issue and the
plan name the launcher icons only. Filed as a follow-up. A vector source for the pattern would give a sharper 1024 px
iOS icon (the current one is scaled up from 512 px).
