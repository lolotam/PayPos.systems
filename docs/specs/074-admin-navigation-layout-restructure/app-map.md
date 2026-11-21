# 074 — Full app map: every section and sub-menu

The owner asked on 2026-11-21 for the navigation to name the whole product now, phases 1 to 6, with pages that are not built yet opening an "Under development" page (`owner-questions.ar.md`, NAV-Q13).

This file lists every section, its sub-menus and its pages. It extends `design.md` §3 and §4: where the two differ, this file wins. The prototypes were built before it and show only the pages marked **Live**.

## How to read it

- **Live**: an admin route exists on `main` at `cf70114e2`. It keeps its address. Two Live entries are not routes of their own yet: Schedule settings is a block of `/schedules`, and Employee detail is an inline card on `/staff`. Until `pr-sequence.md` steps 10 and 11 give them routes, their menu entries point to `/schedules` and `/staff`.
- **Soon**: no admin route on `main` at `cf70114e2`. The menu shows the entry with a "Soon" mark; opening it shows the Under development page. Some Soon entries have back-end work merged or in flight; that is not tracked here.
- **Phase**: the phase whose tasks in `docs/PRD.md` §10 name the page or its module (§7 where §10 is silent). It is this document's reading of the PRD, not a commitment to a date. "—" means the PRD does not plan it.
- Names are working names in English. The Arabic and English labels are written in `packages/i18n` when the entry is added.

Sources: `docs/PRD.md` §3.2 (personas), §7 (functional scope by module), §7.1 (vertical templates), §10 (phase tasks); `docs/06_Tech_Stack_Architecture_EN.md` §3 (module map). The platform super-admin console is a separate site in the PRD (P5-T4) and is not part of this menu. The customer-facing menu and booking site is a separate app (`apps/menu`, P4-T4); only its admin builder is listed here.

## Sections

### 1. Home

| Page | State | Phase |
|---|---|---|
| Workspace (today at a glance) | Live | 1 |
| Daily dashboard | Soon | 2 |
| Approvals inbox (discounts, voids, cash variance, wastage) | Soon | 2 |
| Unified owner dashboard (all businesses) | Soon | 5 |

### 2. Sales and POS

| Sub-menu | Page | State | Phase |
|---|---|---|---|
| Service visits | Record a visit | Live | 1 |
| Service visits | Day list | Live | 1 |
| Service visits | Sell a package | Live | 1 |
| Service visits | Unassigned services (exceptions) | Soon | 1 |
| Orders | Orders | Soon | 2 |
| Orders | Returns | Soon | 2 |
| Payments | Payments and refunds | Soon | 2 |
| Payments | Customer accounts (on-account sales) | Soon | 2 |
| Cash | Cash shifts | Soon | 2 |
| Cash | Paid in and paid out | Soon | 2 |
| POS | POS devices and PINs | Soon | 2 |
| POS | Receipts and printing | Soon | 2 |
| Restaurant | Tables and floor map | Soon | 3 |
| Restaurant | Kitchen screens and stations | Soon | 3 |
| Delivery | Delivery channels (Talabat, Deliveroo, Jahez, Keeta) | Soon | 4 |
| Delivery | Delivery zones | Soon | 2 |

### 3. Catalog and stores

| Sub-menu | Page | State | Phase |
|---|---|---|---|
| Catalog | Services (+ Add service) | Live | 1 |
| Catalog | Categories | Live | 1 |
| Catalog | Package types (+ Add package type) | Live | 1 |
| Catalog | Products and variants | Soon | 2 |
| Catalog | Options and modifiers | Soon | 2 |
| Catalog | Price lists (per branch, channel, order type) | Soon | 2 |
| Catalog | Combos and bundles | Soon | 2 |
| Stores | Stock items | Soon | 3 |
| Stores | Locations | Soon | 3 |
| Stores | Suppliers | Soon | 3 |
| Stores | Purchases | Soon | 3 |
| Stores | Transfers | Soon | 3 |
| Stores | Stock counts | Soon | 3 |
| Stores | Adjustments and wastage | Soon | 3 |
| Production | Recipes | Soon | 3 |
| Production | Production orders | Soon | 3 |

### 4. Customers and marketing

| Sub-menu | Page | State | Phase |
|---|---|---|---|
| Customers | Customers | Soon | 2 |
| Customers | Tags and blocks | Soon | 2 |
| Appointments | Calendar | Soon | 4 |
| Appointments | Resources (chairs, rooms) | Soon | 4 |
| Appointments | Waitlist | Soon | 4 |
| Appointments | Booking rules | Soon | 4 |
| Online | Online menu builder (what the customer site shows) | Soon | 4 |
| Marketing | Business WhatsApp | Soon | 4 |
| Marketing | Campaigns | Soon | 4 |
| Marketing | Message templates | Soon | 4 |
| Marketing | Social media management | Soon | — |
| Marketing | Ratings and reviews | Soon | 4 |
| Loyalty | Loyalty points | Soon | 4 |
| Loyalty | Loyalty cards (wallet stamp cards) | Soon | 6 (with the customer app, PRD P6-T8) |
| Loyalty | Gift cards | Soon | 4 |
| Loyalty | Discount cards and codes | Soon | 4 |

"Social media management" is the owner's request of 2026-11-21. It is not in the PRD; it needs a PRD entry and a spec before anything is built (NAV-Q15).

### 5. Team

| Sub-menu | Page | State | Phase |
|---|---|---|---|
| Employees | Employees (+ Create, + Employee detail) | Live | 1 |
| Employees | Employee numbers | Live | 1 |
| Employees | Import employees | Live | 1 |
| Employees | Document types | Live | 1 |
| Schedules | Weekly schedules | Live | 1 |
| Schedules | Schedule settings | Live (a block of Weekly schedules today; its own page under this spec) | 1 |
| Attendance | Board | Live | 1 |
| Attendance | Requests | Live | 1 |
| Attendance | Exceptions | Live | 1 |
| Leave | Leave approvals | Live | 1 |
| Pay | Commission plans | Live | 1 |
| Pay | Commission overrides | Live | 1 |
| Pay | Commission statements | Soon | 1 |
| Pay | Payroll runs and payslips | Soon | 5 |
| Pay | Loans and advances | Soon | 5 |

### 6. Reports and money

| Sub-menu | Page | State | Phase |
|---|---|---|---|
| Staff reports | Attendance monthly report | Live | 1 |
| Staff reports | Attendance statement | Live | 1 |
| Staff reports | Leave history report | Live | 1 |
| Sales reports | Sales (by channel, type, method, hour, staff) | Soon | 5 |
| Sales reports | Products and returns | Soon | 5 |
| Sales reports | Payments and customer balances | Soon | 5 |
| Stock reports | Stock and cost of goods | Soon | 3 |
| Performance | Commissions and performance | Soon | 5 |
| Performance | Appointments report | Soon | 5 |
| Expenses | Expenses | Soon | 5 |
| Expenses | Recurring expenses | Soon | 5 |
| Expenses | Profit and loss per business | Soon | 5 |
| Exports | Scheduled reports | Soon | 5 |
| Exports | Accounting export (Zoho Books, QuickBooks, Odoo) | Soon | 5 |

### 7. Setup

| Sub-menu | Page | State | Phase |
|---|---|---|---|
| Business | Business identity | Live | 1 |
| Business | Alerts | Live | 1 |
| Business | Tax and invoice template | Soon | 2 |
| Business | Working hours and order rules | Soon | 2 |
| Business | Payment methods and gateways | Soon | 2 |
| Access | Permissions | Live | 1 |
| Access | Authenticator | Live | 1 |
| Access | Approval limits | Soon | 2 |
| Staff app | Staff app link | Live | 1 |
| Staff app | Staff app columns | Live | 1 |
| Appearance | Appearance (style and theme) | New in this spec | 1 |
| Plan | Subscription and billing | Soon | 5 |
| Developers | API keys and webhooks | Soon | 5 |
| Compliance | ZATCA e-invoicing (Saudi Arabia) | Soon | 6 |

### 8. More business types (Phase 6)

| Page | State | Phase |
|---|---|---|
| Laundry tickets | Soon | 6 |
| Grocery and retail (barcode, scale, offers) | Soon | 6 |
| Gym and education (memberships, classes) | Soon | 6 (the PRD says it needs its own discovery first) |
| Quotes and invoices (services companies) | Soon | 6 |
| Patient files (clinics) | Soon | 6 |

These appear under Sales and POS in every style, in a sub-menu named "More business types".

## Counts

100 pages for the menu in sections 1 to 8, plus 4 child pages (Add service, Add package type, Create employee, Employee detail) that have no menu entry of their own:

- 28 Live, counting Schedule settings, which is live today only as a block inside Weekly schedules.
- 1 new in this spec (Appearance).
- 71 Soon.

## Placement in each style

Top-level entries, at most seven in any style.

| Section | A — Sidebar and tabs | B — Top bar and hubs | C — Rail and panel |
|---|---|---|---|
| 1. Home | Home | Today | Front desk › Now |
| 2. Sales and POS | Sales | Sell | Front desk |
| 3. Catalog and stores | Catalog and stores | Stock | Stock |
| 4. Customers and marketing | Customers | Grow | Customers |
| 5. Team | Team | People | Team |
| 6. Reports and money | Reports | Business › Reports | Business › Reports |
| 7. Setup | Setup | Business › Setup | Business › Setup |
| Top-level count | 7 | 7 (Today, Sell, Approvals, Stock, Grow, People, Business) | 5 (Front desk, Stock, Customers, Team, Business) |

- **A:** a section's sub-menus are its tabs; a sub-menu's pages are pills. Sections with many sub-menus (2, 3, 4) scroll their tab row sideways on narrow screens.
- **B:** a section's sub-menus are the columns of its mega menu and the headings of its local list. Approvals stays as in `design.md` §4: Leave approvals, Attendance requests and Attendance exceptions, joined later by Soon pages that hold decisions (approval limits, wastage approvals) when they are built.
- **C:** a section's sub-menus are the section labels of its panel. Front desk keeps today's attendance and leave decisions next to sales, as in `design.md` §4.
- The route map of Live pages in `design.md` §4 still holds, with two renames: A's "Attendance & leave" group is folded into Team (Attendance, Leave) and Reports (Staff reports); A's "Catalog" becomes "Catalog and stores".

## The Under development page

- One page, opened by every Soon entry. It shows the entry's name, a short line saying the page is under development, and a button back to Home.
- It shows no date and no phase number to the user.
- Its address is `/soon/[page]`. When a page is built, its entry changes from Soon to Live and points to its real address; an old `/soon/...` link then forwards to the real page.
- Who sees Soon entries is not settled. The owner asked for every section to be shown (NAV-Q13); the PRD turns sections on per business type and per role (§3.2, §7.1). NAV-Q14 asks which applies, and its answer is required before `pr-sequence.md` step 7 is approved. Whatever the answer, the same rule applies in the menu, in the page finder and to a direct `/soon/...` link.
- A Soon entry gives no access to anything: it opens the Under development page only.
