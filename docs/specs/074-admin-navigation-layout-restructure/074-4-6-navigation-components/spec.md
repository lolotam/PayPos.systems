# Admin navigation components for styles A, B and C

**Delivery** 074-4 + 074-5 + 074-6, one implementation PR. This specification covers the experience when a component is rendered in isolation. The first change to the running dashboard belongs to 074-7. See the [implementation plan](plan.md).

## User scenarios and acceptance

| Story | Given and action | Observable result |
| --- | --- | --- |
| A · Reclaim desktop space | At 1280px, focus the collapse button and activate it twice. Resize to 820px. | The 264px sidebar shrinks to an 80px rail and expands again. Tablet uses the rail. The current group, accessible names, focus and page content survive the change. At 390px this desktop control yields to the future phone shell. |
| B · Reach a page in another module | Open one module, switch to another, then follow a link in its mega menu. | Only the requested menu is open. Its columns, overview destination and links match the supplied module. Opening it alone does not mark it current. Selection closes the menu. The local navigation marks the supplied active page. |
| B · Navigate on a phone | At 390px open the 304px drawer, expand another module and select a page. | The current module starts expanded. Drawer, accordion, destination take at most three actions. The drawer closes. Escape closes without navigating and returns focus to the opener. Long sections scroll within the drawer. |
| C · Inspect another workspace | With a page selected, choose another workspace on the 84px rail and filter the 272px context panel. Hide and reopen it. | The panel lists only matching pages in that workspace. Inspecting a workspace preserves the current page. Hidden links disappear from keyboard traversal. Tablet uses a floating panel. |
| C · Find a page outside this workspace | Open the finder by button or Ctrl/Cmd+K, search a supplied Arabic or English page name, then follow a result by keyboard. | Results span all supplied workspaces and show section context. Selection uses the supplied address and closes the finder. An unmatched query shows a localized empty state. Clearing it restores the available results. A touch trigger works without a hardware keyboard. |

### Edge cases

An empty group disappears. A missing count adds no badge and never hides its page. A supplied Soon destination remains a link with a textual mark. With filtered input, excluded pages appear in neither navigation nor search results, including after the user changes workspace or query while an overlay is open. A child route highlights its supplied parent. Resizing across the drawer breakpoint while open releases the focus trap. Use a reachable visible trigger as the focus fallback if the old opener is removed.

## Requirements

1. Use the current Management map. A has seven groups (Home, Sales, Catalog, Customers, Team, Reports, Setup), B has six modules (Today, Sell, Stock, Grow, People, Business), C has five workspaces (Front desk, Stock, Customers, Team, Business). Approvals belongs under Home. Prototype counts and hash URLs are illustrative.
2. Accept resolved names, addresses, current IDs, icons, status text and optional counts from the caller. A route match, business type, country, role or permission is an Admin decision. A visible navigation landmark has one current top-level item when supplied. Child pages have no independent menu entry.
3. Preserve the existing palette, font, radius and button styles. Use logical inline-start placement in Arabic RTL and English LTR. A uses 48px rows and 60px rail targets. B and C targets are at least 44×44px. At 700–1023px B uses a top bar with a local strip, at 1024px and above a 64px top bar and 240px local list. Below 700px it uses a 56px bar with drawer. At 600–1023px C floats the panel. Below 600px expose the finder trigger to the phone context bar. A/C bottom navigation and full frame composition belong to later integration.
4. Every icon-only action has a localized accessible name. Expose expanded/current state, visible keyboard focus, modal titles and a close action. Open overlays contain focus, handle Escape, restore focus and scroll in short viewports. Disclosures and destinations remain distinguishable by keyboard. Preserve native link behavior. Respect reduced motion.

## Slice design

**Data and rules.** Presentational input and transient UI state only. Zero schema, RLS, index, API, idempotency, event, audit, feature flag or permission changes. No storage, identity queries, account writes or analytics. Existing server authorization remains with each destination.

**Route examples.** At the supplied address for Staff app columns (`/staff-app-columns`), highlight Setup / Business / Business in A/B/C and mark Columns at page level. At `/staff/create`, highlight the Employees parent in Team / People / Team. A Soon fixture may link to `/soon/<id>`. These scenarios exercise the presentation contract. Step 7 supplies the live adapter, URLs for new pages, direct-link guards, overview redirects, workspace selectors and the style switch.

**Decision record.** NAV-Q1/Q5–Q8 fix default C, switch and theme placement, visual identity and simultaneous release. NAV-Q13–Q17 govern future-page labels, audience and the full map. NAV-Q2 separates Lovable; NAV-Q3 separates the cashier. Neither has a delivery dependency here. Product decisions on future catalog entries stay with their existing records. [Owner answers](https://github.com/lolotam/PayPos.systems/blob/68e2f4dafacc72aef364ef4a3d7bbd96bfe42f51/docs/specs/074-admin-navigation-layout-restructure/owner-questions.ar.md)

## Success criteria

Rendered component tests cover all five stories in the plan, including dismiss, empty and filtered paths. At 390, 820 and 1280px in both directions, visible controls are reachable with no horizontal document overflow. The longest B drawer path takes at most three taps from outside the target module. Existing sidebar callers retain their current behavior. Full-map reachability, page navigation and first-paint style on real Admin routes are 074-7 release checks.
