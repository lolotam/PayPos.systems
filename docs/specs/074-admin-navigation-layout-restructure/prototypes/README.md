# Prototypes for spec 074

Three clickable sketches of the navigation styles, used to choose between them. They are not product code and nothing in the app imports them.

- `pospay-nav-a.html`, `-b.html`, `-c.html` are built by `node build.mjs` from `src/`. `node smoke.mjs` checks that every page renders and that each menu reaches every root page once; it does not start the page in a browser.
- They show the 26 pages that had an admin route on `e0e0e642e`. The full product map in `../app-map.md` was written later and is not shown.
- Fonts come from Google Fonts because the files are also published as stand-alone pages. The product keeps the self-hosted fonts of ADR-0059; the prototypes do not change that.

## Known limits

These are accepted in a sketch and are requirements for the real components (`../spec.md`, FR-024):

- Menus, drawers, sheets and the page finder do not trap focus or return it to the control that opened them.
- Sub-tabs are links, not a tab list with selected state, and lose focus when activated.
- The collapsed workspace button has no accessible name; a hidden panel keeps its links in the tab order.
- The sidebar highlight is not re-measured when the window is resized, and collapsing the sidebar redraws the page.
- Style B's header can clip between 700 and 1023px, and its mega menu does not scroll in a short window.
