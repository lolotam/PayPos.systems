# DS-3 A4 — visual pass on `apps/menu` · implementation plan

Date: 2026-11-20. Tier: **Medium** (PP-195), with the DS-3 exception: browser screenshots in light/dark × ar/en before
the PR is reported ready. Written by Claude Fable 5.2 (medium); implemented by the PP-194 implementer.

Sources: `docs/plans/2026-11-19-design-and-backlog-plan.md` (A4), ADR-0059, ADR-0060, ADR-0058, PP-193.1, PP-200,
issue #1082 item 7, and the merged A1 theme runtime `packages/ui/src/theme.ts` (#1095).

## Goal

The public rating page (`apps/menu`) already takes the Souk Tiles palette and fonts from `@pospay/ui/styles.css`, but it
has no boot script, no theme-color metas, no icons and no favicon, so it never turns dark and it looks unfinished.
This slice brings it onto PP-193.1. **Nothing in how the page behaves changes:** the same text, the same requests, the
same states.

## Owner decision (PP-200)

The public menu follows the device's light/dark setting and has **no theme switch** (Waleed, 2026-11-20, «يمشي مع
إعداد الجهاز (المقترح)»; published as DS3-Q1, batch 95; Abu Salem's pick is pending and binds if it differs).

## Design decisions

1. **Boot script: reuse, no new mode.** `theme.ts` has no separate system-only mode and needs none. The layout renders
   `THEME_COLOR_METAS` and `THEME_BOOT_SCRIPT` exactly as `apps/admin/src/shared/locale/root-layout.tsx` does, and no
   `ThemeSwitch` is mounted anywhere in `apps/menu`. Nothing on the menu origin ever calls `setThemePreference`, so the
   stored key never exists there and the runtime always resolves to `'system'`. The script only **reads**
   `localStorage`; ADR-0058's «no persistence» still holds.
2. **Favicons through Next's `app/` file conventions**, not `public/`. `apps/menu` has no `public/` directory and
   `scripts/prepare-standalone.mjs` copies only `.next/static`, so files in `public/` would 404 in the standalone
   runtime. `app/favicon.ico`, `app/icon.png` and `app/apple-icon.png` are emitted by the build and linked by Next
   itself. The bytes are copied from `apps/admin/public` (same brand assets, ADR-0059).
3. **No web manifest, no maskable icons, no `browserconfig.xml`.** The page is not an installable app: its capability
   lives in the URL fragment, and a manifest `start_url` would open it without the token. ADR-0058 also forbids a
   service worker.
4. **Icons come from `@pospay/ui` only** (ADR-0060). One new export is needed there: `Star` (`StarIcon`, regular
   weight). This is the one change outside `apps/menu`, declared here per `CLAUDE.md` §1.4.
5. **Selection is shown by colour, not by icon weight.** ADR-0060 keeps every icon at the `regular` weight. Each star
   option is a pill (number + star icon); the checked pill takes the primary colours through `has-[:checked]`.
6. **No new i18n keys, no new components in `packages/ui`, no new dependencies.**

## Files

### `packages/ui` (the declared out-of-app change)

- `src/icons.tsx`: import `StarIcon` from `@phosphor-icons/react/dist/ssr` and add
  `export const Star = withDefaults(StarIcon);`.
- `src/index.ts`: add `Star` to the icons re-export list.
- `src/__tests__/icons.spec.tsx`: add `Star` to the import and to the `ICONS` table.

### `apps/menu`

- `app/favicon.ico` ← copy of `apps/admin/public/favicon.ico`.
- `app/icon.png` ← copy of `apps/admin/public/android-chrome-192x192.png`.
- `app/apple-icon.png` ← copy of `apps/admin/public/apple-touch-icon.png`.
  Copy the bytes (`cp`), do not re-encode. Report the SHA-256 of each source and copy.
- `app/layout.tsx`:
  - import `THEME_BOOT_SCRIPT` and `THEME_COLOR_METAS` from `@pospay/ui/theme`, grouped with the other `@pospay`
    imports (#1082.8);
  - `<html lang="ar" dir="rtl" suppressHydrationWarning>` (the boot script adds `dark` before hydration);
  - a `<head>` with the two `theme-color` metas (mapped from `THEME_COLOR_METAS`, `key={media}`) followed by
    `<script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />`;
  - `<body className="min-h-dvh bg-background text-foreground antialiased">`;
  - keep `metadata` (`robots`) as it is. Add no title, no manifest and no `icons` entry: the file conventions add the
    links.
- `app/styles.css`: keep `@import '@pospay/ui/styles.css';`, keep `@source '../src';`, and add `@source '.';` if the
  built CSS misses a class used in `app/layout.tsx`. Remove the bare element rules (`body`, `main`, `form`,
  `fieldset`, `.stars`, `.star`, `textarea`); their layout moves to utility classes on the elements.
- `src/ratings/pages/rating-page.tsx`: `<main>` becomes a centred column
  (`mx-auto flex min-h-dvh max-w-lg flex-col gap-4 ps-4 pe-4 py-8`). The language button stays a ghost `Button`,
  aligned to the end (`self-end`), with `<Languages aria-hidden="true" />` before its text. The loading line uses the
  shared status line (below).
- `src/ratings/pages/rating-screen.tsx`: wrap the open/submitted content in `Card` + `CardContent` from `@pospay/ui`
  (`<section>` stays the outer element). The `<h1>` gets `text-start text-2xl`. Every `role="alert"` line gets
  `text-destructive` and a leading `<CircleAlert aria-hidden="true" className="size-5 shrink-0" />`; every
  `role="status"` line gets `text-muted-foreground`. The opt-out button stays a ghost `Button`.
- `src/ratings/ui/rating-notice.tsx` (new, optional): if the alert/status markup repeats three times or more, extract
  one small presentational component, e.g. `RatingNotice({ tone: 'alert' | 'status' | 'loading', children })`, that
  renders the `<p role=…>` with its icon. `loading` uses `<LoaderCircle aria-hidden="true"
  className="size-5 animate-spin motion-reduce:animate-none" />`. The `role` values must stay exactly as today.
- `src/ratings/ui/rating-form.tsx`: the form and fieldset use `grid gap-4` (fieldset also `border-0 p-0 m-0 min-w-0`);
  the legend uses `mb-2 text-sm font-medium` (a legend is not a grid item, so the gap does not space it). The `<textarea>` takes the same tokens as `Input`:
  `min-h-28 w-full rounded-interactive border border-input bg-card ps-3 pe-3 py-2 text-start text-base
  text-card-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2
  focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50`. The submit `Button` is full width.
- `src/ratings/ui/rating-stars.tsx`: the wrapper is `grid grid-cols-5 gap-2`, so the five options always share one row on a phone. Each
  `<label>` is a pill:
  `inline-flex min-h-12 min-w-0 cursor-pointer items-center justify-center gap-1 rounded-interactive border
  border-input bg-card ps-1 pe-1 text-base font-semibold text-card-foreground has-[:checked]:border-primary
  has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:focus-visible]:outline-2
  has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring has-[:disabled]:cursor-not-allowed
  has-[:disabled]:opacity-50 forced-colors:has-[:checked]:border-4` (the thicker border is the non-colour cue in
  forced-colors mode, where backgrounds are dropped).
  The `<input type="radio">` stays in the DOM with every current prop and gets `className="sr-only"`. The text glyph
  `★` is replaced by `<Star aria-hidden="true" className="size-5" />`; the visible number stays, so the radio's
  accessible name is still `'1'` … `'5'`.
- `src/root-layout.spec.tsx` (new): see Tests.
- `README.md`: one short paragraph: the page follows the device theme through the shared boot script, has no theme
  switch (PP-200), and takes its favicons from `app/` icon files.

Logical properties only (`ps-`, `pe-`, `ms-`, `me-`, `text-start`, `self-end`); never `left`/`right`, `pl-`/`pr-`,
`ml-`/`mr-`, `text-left`/`text-right`. No hardcoded strings. No closing comments in JSX. One component per file.
Files ≤300 lines, functions ≤60 lines.

## Tests

`src/ratings/pages/rating-page.spec.tsx` **must pass unmodified**. It pins the radio names `'1'`–`'5'`, the button
names, the exact `textContent` of alerts and the heading, and `main.dir`.

New `apps/menu/src/root-layout.spec.tsx` (jsdom). Each test asserts a visible outcome (`CLAUDE.md` §9):

1. The layout's static markup (`renderToStaticMarkup(<RootLayout>…</RootLayout>)`) has `<html lang="ar" dir="rtl">`,
   exactly two `meta[name="theme-color"]` whose `media`/`content` equal `THEME_COLOR_METAS` in order, and exactly one
   inline script whose text equals `THEME_BOOT_SCRIPT`.
2. Running the layout's script text on a device set to dark (`window.matchMedia` stubbed to match
   `(prefers-color-scheme: dark)`) puts the `dark` class on `document.documentElement`; on a light device the class is
   absent. Dispose `window.__pospayTheme` and remove the class after each test.
3. The rating page offers no theme control: after `render(<RatingPage />)` reaches the open form, no element has
   `aria-pressed` (the `ThemeSwitch` buttons are the only ones that carry it), and the only buttons are the language,
   submit and opt-out buttons.

Parse the markup with `DOMParser` rather than regular expressions. Do not mock `@pospay/ui/theme`.

## Gates (run by the implementer, then by the session)

```
pnpm exec turbo run build --filter=@pospay/menu^...
pnpm --filter @pospay/ui typecheck && pnpm --filter @pospay/ui lint && pnpm --filter @pospay/ui test
pnpm --filter @pospay/menu typecheck && pnpm --filter @pospay/menu lint && pnpm --filter @pospay/menu test
pnpm lint:docs
pnpm module-map:check
```

## Docs (written by the session, not the implementer)

- `docs/owner-decisions.ar.md`: PP-200 index row before the PP-177 row, and item 120.
- `docs/adr/0059-souk-tiles-design-system.md`: addendum recording the menu (#1082.7).
- `docs/journey/77-public-rating-page.md`, `docs/journey/95-design-system-theme.md` and `docs/journey/README.md`.

## Out of scope

A page title, a web manifest, a theme switch, new i18n keys, a `Textarea` component in `packages/ui`, the standalone
packaging script, the API, deployment of `apps/menu` to staging.
