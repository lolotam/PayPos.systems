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

All text, including accessible names, placeholders and icon-button labels, must
come from the consumer's `@pospay/i18n` catalog. The kit owns no user-facing strings.
Icons come from `lucide-react`. Components accept React 19 refs as ordinary props.
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
