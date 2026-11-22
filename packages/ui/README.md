# @pospay/ui

Private React 19 source package. Consumers transpile the TypeScript entry and import
`@pospay/ui/styles.css` once from their root stylesheet. Vite consumers use
`@tailwindcss/vite`; the CSS-first theme registers this kit's sources explicitly,
including when the package is reached through `node_modules`.

Wrap the application in `DirectionProvider`, which defaults to `rtl` and accepts
`dir="ltr"`. It sets both the DOM direction and Radix context. Set the document's
`lang` in the application shell. Both scripts use the bundled Souk Tiles faces:
Readex Pro for body text and Baloo Bhaijaan 2 for display headings, with the
Arabic and Latin subsets served locally. Apply `.dark` to the document element
(`html`) to switch the semantic colors; the boot script toggles the class on that
element. A `.dark` subtree switches the same tokens for the elements inside it.
Dark mode follows the system setting by default, and `ThemeSwitch` lets the user
override it with light / dark / system, storing the choice under the same key the
boot script reads. The boot script and the switch share one theme runtime
instance, exposed as `window.__pospayTheme`, so a page never carries two sets of
`storage` / `prefers-color-scheme` listeners.

All text, including accessible names, placeholders and icon-button labels, must
come from the consumer's `@pospay/i18n` catalog. The kit owns no user-facing strings.
Icons come from `@phosphor-icons/react` (ADR-0060). Components accept React 19 refs as ordinary props.
`Button` defaults to `type="button"`; pass `type="submit"` for form submission or
`asChild` to style another element through Radix Slot.

Motion presets are plain variant objects with `hidden`, `visible` and `exit` states.
Use `fadeIn` or `slideIn[dir]`, where `dir` comes from `useDirection()`. Select
`reducedMotion` when Motion's `useReducedMotion()` is true (or still unknown during
SSR), and use `MotionConfig reducedMotion="user"` in the application shell. The
static preset keeps content visible without translation or animation duration.

Font files are local build assets, with no third-party font request. The POS shell
must precache those emitted assets in its service worker to make them available
offline; service-worker setup belongs to PR 3.

## Shared shell parts and the page frame

`PageShell` owns page width and section gaps only — never page padding. `layout="list"`
caps pages at 1200px, `layout="form"` at 840px, both centred; `layout="two-column"`
splits main 2fr / side 1fr from a 1024px viewport and stacks them, main first, below
that. A lone block (no `side`) occupies the main column. The shell caps any
`PageHeader` description rendered inside it to 65 characters via
`data-page-header-description`; the header itself never caps, so the pages that use
the header outside the shell keep today's appearance. `PageHeader` gains optional
`actions` (secondary actions rendered before the primary one at the inline end).

`DataTableFrame` gains optional `filters` and `footer` areas inside the card. A slot
whose content renders nothing (a component returning `null`, as
`ServiceCategoryFilter` does when the category read fails) leaves no bordered bar:
the areas carry Tailwind's `empty:hidden`. Stacked rows are opt-in per table with
`stacked`; under 600px each row becomes a stacked card — the first cell is the card
title, and every other cell must carry `data-cell-label` (its column label) to show
that label above its value. A cell without the attribute shows its value alone; the
frame never invents an empty label. Tables without the flag look and behave exactly
as before at every width.

`NavTabs` (48px row), `Pills` (44px targets, wrapping), `BottomNav` (64px, at most
five entries — the caller's duty) and `HubCard` (whole card is one link) take
`ShellNavItem` items: `{ id, label, href, count?, status?, icon?, current? }`, the
same field names as the navigation model's page item, so one object can feed both
sets in 074-7. The parts render plain `<a href>` links, never read a route, decide
nothing about items, and mark `aria-current="page"` only when the caller passes
`current`. A count chip renders only when a count is supplied; `status` is the
supplied Soon mark text. `BottomNav.extra` reports its press to the caller and builds
no sheet.

`WorkspaceSwitcher` and `AccountMenu` are overlays: every value, option, disabled
state, change callback, entry and label arrives through props, including the
sign-out pending state. Escape closes both and returns focus to the opener; focus
stays inside while open.
