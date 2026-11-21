# 074 — Full app map: every section and sub-menu

**One map for both projects.** This file is generated from the same source as the app map of the other project
(`docs/specs/022-navigation-styles/app-map.md` in `lolotam/lovable-pospay`). The sections, sub-menus, page names, their order and their place in each style are identical in
the two files. The only column allowed to differ is **State**, because each project has built different pages. The
owner chose each grouping on 2026-11-21 from three options per section (`owner-questions.ar.md`, NAV-Q17).

## How to read it

- **Live**: the page exists in this project today (an admin route on `main` at `bbb5d7a3b`).
- **Soon**: not built in this project. The entry carries a "Soon" mark and opens the Under development page.
- **New**: added by this spec.
- **Phase**: the phase whose tasks in the product PRD (`docs/PRD.md` §7 and §10 in `lolotam/PayPos.systems`) name the
  page or its module. It is this document's reading, not a commitment to a date. "—" means the PRD does not plan it.
- **Shown only to**: the business types that see the entry (PRD §7.1). The limit holds while the entry is Soon and after
  its page is built, together with the page's own permission. An entry is shown for the business that is
  selected in the workspace switcher, so an owner with a salon and a restaurant sees the salon's entries while the
  salon is selected and the restaurant's entries after switching. Which roles see each entry is a second table, still to
  be written in the first implementation step.
- Names are working names in English; the Arabic and English labels are written in the i18n catalogs when an entry is
  added.

## Management area

### 1. Home

| Page | Phase | State | Shown only to |
|---|---|---|---|
| Dashboard (today at a glance) | 1 | Live | every business type |
| Shift dashboard (current shift and what needs attention) | 2 | Soon | every business type |
| Approvals inbox (everything waiting for a decision, one count) | 1 | New | every business type |
| Daily sales dashboard | 2 | Soon | every business type |
| All-businesses dashboard | 5 | Soon | every business type |

### 2. Sales

| Sub-menu | Page | Phase | State | Shown only to |
|---|---|---|---|---|
| Service visits | Record a visit | 1 | Live | every business type |
| Service visits | Sessions (day list) | 1 | Live | every business type |
| Service visits | Sell a package | 1 | Live | every business type |
| Service visits | Customer packages (who holds what, sessions left) | 1 | Soon | every business type |
| Service visits | Unassigned services (exceptions) | 1 | Soon | every business type |
| Discounts | Discounts | 1 | Soon | every business type |
| Discounts | Discount approvals | 1 | Soon | every business type |
| Orders | Orders | 2 | Soon | every business type |
| Orders | Returns | 2 | Soon | every business type |
| Orders | Fulfilment board (stages, payment status, delays) | — | Soon | every business type |
| Payments | Payments and refunds | 2 | Soon | every business type |
| Payments | Customer accounts (on-account sales) | 2 | Soon | every business type |
| Cash | Cash shifts | 2 | Soon | every business type |
| Cash | Paid in and paid out | 2 | Soon | every business type |
| POS | Open reception / cashier | 1 | Soon | every business type |
| POS | POS devices and PINs | 2 | Soon | every business type |
| POS | Receipts and printing | 2 | Soon | every business type |
| Restaurant | Tables and floor map | 3 | Soon | Restaurant, café |
| Restaurant | Kitchen screens and stations | 3 | Soon | Restaurant, café |
| Delivery | Delivery channels | 4 | Soon | Restaurant, café, grocery |
| Delivery | Delivery zones | 2 | Soon | Restaurant, café, grocery, laundry |
| Delivery | Drivers | — | Soon | Restaurant, café, grocery, laundry |
| For this business type | Laundry tickets | 6 | Soon | Laundry |
| For this business type | Barcode, scale and offers | 6 | Soon | Grocery, retail |
| For this business type | Quotes and invoices | 6 | Soon | Services company |
| For this business type | Memberships and classes | 6 | Soon | Gym, education |
| For this business type | Patient files | 6 | Soon | Clinic |

### 3. Catalog and stores

| Sub-menu | Page | Phase | State | Shown only to |
|---|---|---|---|---|
| Catalog | Services (+ Add service) | 1 | Live | every business type |
| Catalog | Categories | 1 | Live | every business type |
| Catalog | Package types (+ Add package type) | 1 | Live | every business type |
| Catalog | Products and variants | 2 | Soon | every business type |
| Catalog | Options and modifiers | 2 | Soon | every business type |
| Catalog | Price lists | 2 | Soon | every business type |
| Catalog | Combos and bundles | 2 | Soon | every business type |
| Catalog | Units of measure | 3 | Soon | every business type |
| Stores | Stock items | 3 | Soon | every business type |
| Stores | Locations | 3 | Soon | every business type |
| Stores | Suppliers | 3 | Soon | every business type |
| Stores | Purchases | 3 | Soon | every business type |
| Stores | Transfers | 3 | Soon | every business type |
| Stores | Stock counts | 3 | Soon | every business type |
| Stores | Adjustments and wastage | 3 | Soon | every business type |
| Stores | Stock movements (item activity) | 3 | Soon | every business type |
| Stores | Barcode labels | — | Soon | every business type |
| Production | Recipes | 3 | Soon | Restaurant, café |
| Production | Production orders | 3 | Soon | Restaurant, café |

### 4. Customers and marketing

| Sub-menu | Page | Phase | State | Shown only to |
|---|---|---|---|---|
| Customers | Customers | 2 | Soon | every business type |
| Customers | Tags and blocks | 2 | Soon | every business type |
| Customers | Customer wallet (prepaid balance) | — | Soon | every business type |
| Customers | Ratings and reviews | 1 | Soon | every business type |
| Appointments | Calendar | 4 | Soon | Salon, spa, barber, clinic, services company, gym |
| Appointments | Resources (chairs, rooms) | 4 | Soon | Salon, spa, barber, clinic, services company, gym |
| Appointments | Waitlist | 4 | Soon | Salon, spa, barber, clinic, services company, gym |
| Appointments | Booking rules | 4 | Soon | Salon, spa, barber, clinic, services company, gym |
| Appointments | Appointment categories | 4 | Soon | Salon, spa, barber, clinic, services company, gym |
| Online | Company public page | 1 | Soon | every business type |
| Online | Online menu builder | 4 | Soon | every business type |
| Marketing | Business WhatsApp | 4 | Soon | every business type |
| Marketing | Campaigns | 4 | Soon | every business type |
| Marketing | Message templates | 4 | Soon | every business type |
| Marketing | Social media management | — | Soon | every business type |
| Loyalty | Loyalty points | 4 | Soon | every business type |
| Loyalty | Loyalty cards (wallet stamp cards) | 6 | Soon | every business type |
| Loyalty | Gift cards | 4 | Soon | every business type |
| Loyalty | Discount cards and codes | 4 | Soon | every business type |

### 5. Team

| Sub-menu | Page | Phase | State | Shown only to |
|---|---|---|---|---|
| Employees | Employees (+ Create, + Employee detail) | 1 | Live | every business type |
| Employees | Employee numbers | 1 | Live | every business type |
| Employees | Import employees | 1 | Live | every business type |
| Employees | Document types | 1 | Live | every business type |
| Employees | Attendance cards | 1 | Soon | every business type |
| Employees | Phones | 1 | Soon | every business type |
| Schedules | Weekly schedules | 1 | Live | every business type |
| Schedules | Schedule settings | 1 | Live (a block of Weekly schedules until it gets its own page) | every business type |
| Attendance | Board | 1 | Live | every business type |
| Attendance | Requests | 1 | Live | every business type |
| Attendance | Exceptions | 1 | Live | every business type |
| Attendance | Corrections | 1 | Soon | every business type |
| Attendance | Insights | 1 | Soon | every business type |
| Leave | Leave approvals | 1 | Live | every business type |
| Pay | Commission plans | 1 | Live | every business type |
| Pay | Commission overrides | 1 | Live | every business type |
| Pay | Salaries | 1 | Soon | every business type |
| Pay | Commission statements | 1 | Soon | every business type |
| Pay | Payroll runs and payslips | 5 | Soon | every business type |
| Pay | Loans and advances | 5 | Soon | every business type |

### 6. Reports and money

| Sub-menu | Page | Phase | State | Shown only to |
|---|---|---|---|---|
| Staff reports | Attendance report | 1 | Live | every business type |
| Staff reports | Attendance statement | 1 | Live | every business type |
| Staff reports | Leave history report | 1 | Live | every business type |
| Sales reports | Sales (by channel, type, method, hour, staff) | 5 | Soon | every business type |
| Sales reports | Products and returns | 5 | Soon | every business type |
| Sales reports | Payments and customer balances | 5 | Soon | every business type |
| Stock reports | Stock and cost of goods | 3 | Soon | every business type |
| Performance | Commissions and performance | 5 | Soon | every business type |
| Performance | Appointments report | 5 | Soon | Salon, spa, barber, clinic, services company, gym |
| Expenses | Expenses | 5 | Soon | every business type |
| Expenses | Recurring expenses | 5 | Soon | every business type |
| Expenses | Profit and loss per business | 5 | Soon | every business type |
| Exports | Scheduled reports | 5 | Soon | every business type |
| Exports | Accounting export | 5 | Soon | every business type |

### 7. Setup

| Sub-menu | Page | Phase | State | Shown only to |
|---|---|---|---|---|
| Business | Business identity | 1 | Live | every business type |
| Business | Branches | 1 | Soon | every business type |
| Business | Alerts and notifications | 1 | Live | every business type |
| Business | Data import (Excel) | 1 | Soon | every business type |
| Business | Tax and invoice template | 2 | Soon | every business type |
| Business | Invoice terms and conditions | — | Soon | every business type |
| Business | Working hours and order rules | 2 | Soon | every business type |
| Business | Payment methods and gateways | 2 | Soon | every business type |
| Access | Permissions | 1 | Live | every business type |
| Access | Users and invitations | — | Soon | every business type |
| Access | Sign-in security (authenticator) | 1 | Live | every business type |
| Access | Approval limits | 2 | Soon | every business type |
| Access | Activity log (who did what, and when) | — | Soon | every business type |
| Staff app | Staff app link | 1 | Live | every business type |
| Staff app | Staff app columns | 1 | Live | every business type |
| Appearance | Appearance (navigation style, light and dark) | 1 | New | every business type |
| Plan | Subscription and billing | 5 | Soon | every business type |
| Developers | API keys and webhooks | 5 | Soon | every business type |
| Compliance | ZATCA e-invoicing | 6 | Soon | Businesses in Saudi Arabia |

"Social media management" is the owner's request of 2026-11-21; it is not in the PRD and needs a PRD entry and a spec
before anything is built. The owner confirmed it is listed as a Soon entry.

Thirteen entries were added on 2026-11-21 after comparing this map with a competing salon product: Shift dashboard,
Customer packages, Fulfilment board, Drivers, Units of measure, Stock movements, Barcode labels, Customer wallet,
Appointment categories, Branches, Invoice terms and conditions, Users and invitations, and Activity log. Those marked
"—" in the Phase column are not named in the PRD and need a PRD entry and a spec before anything is built. Some of
them may end up as part of another page rather than a page of their own.

How an owner gets a second business type on the same account (created by the platform operator, or by an invitation
to the same email) is a subscription question, not a menu question, and is not decided here.

## Other areas

Reference only: these areas are delivered by their own specs, and this spec's requirements and release checks cover the
Management area alone. The same map in both projects. How each project delivers these areas differs: one app with an area per role, or a
separate cashier and staff app.

### Reception / cashier

| Sub-menu | Page | Phase | State | Shown only to |
|---|---|---|---|---|
| Today | Reception home | 1 | Separate spec (NAV-Q11) | every business type |
| Attendance | QR check-in | 1 | Separate spec (NAV-Q11) | every business type |
| Attendance | Card scan | 1 | Separate spec (NAV-Q11) | every business type |
| Sessions | Sessions | 1 | Separate spec (NAV-Q11) | every business type |
| Sell | New sale | 2 | Separate spec (NAV-Q11) | every business type |
| Sell | Open orders | 2 | Separate spec (NAV-Q11) | every business type |
| Sell | Returns | 2 | Separate spec (NAV-Q11) | every business type |
| Cash | My cash shift | 2 | Separate spec (NAV-Q11) | every business type |
| Appointments | Today's bookings | 4 | Separate spec (NAV-Q11) | Salon, spa, barber, clinic, services company, gym |
| Setup | Appearance | 1 | Separate spec (NAV-Q11) | every business type |

### Staff

| Page | Phase | State | Shown only to |
|---|---|---|---|
| My dashboard | 1 | Separate spec (NAV-Q11) | every business type |
| Attend | 1 | Separate spec (NAV-Q11) | every business type |
| My phone | 1 | Separate spec (NAV-Q11) | every business type |
| My leave | 1 | Separate spec (NAV-Q11) | every business type |
| My commissions | 1 | Separate spec (NAV-Q11) | every business type |
| My schedule | 1 | Separate spec (NAV-Q11) | every business type |
| Appearance | 1 | Separate spec (NAV-Q11) | every business type |

### Platform

| Page | Phase | State | Shown only to |
|---|---|---|---|
| Dashboard | 1 | Separate spec (NAV-Q11) | every business type |
| Connectors | 1 | Separate spec (NAV-Q11) | every business type |
| Diagnose | 1 | Separate spec (NAV-Q11) | every business type |
| Companies and subscriptions | 5 | Separate spec (NAV-Q11) | every business type |
| Plans and feature flags | 5 | Separate spec (NAV-Q11) | every business type |
| Support and health | 5 | Separate spec (NAV-Q11) | every business type |
| Appearance | 1 | Separate spec (NAV-Q11) | every business type |

## Counts

- Management area: 123 menu pages. In this project: 28 Live, 2 New, 93 Soon.
- Other areas: 24 menu pages. In this project: 0 Live, 0 Soon, 24 not mapped here (the cashier app has its own spec).
- Child pages (create and detail pages) have no menu entry of their own and are not counted.

## Top level in each style (management area)

| Section | A — Sidebar and tabs | B — Top bar and hubs | C — Rail and panel |
|---|---|---|---|
| 1. Home | Home | Today | Front desk › Now |
| 2. Sales | Sales | Sell | Front desk |
| 3. Catalog and stores | Catalog and stores | Stock | Stock |
| 4. Customers and marketing | Customers | Grow | Customers |
| 5. Team | Team | People | Team |
| 6. Reports and money | Reports | Business › Reports | Business › Reports |
| 7. Setup | Setup | Business › Setup | Business › Setup |
| Top-level count | 7 | 6 (Today, Sell, Stock, Grow, People, Business) | 5 (Front desk, Stock, Customers, Team, Business) |

- **A:** a section's sub-menus are its tabs and a sub-menu's pages are pills. On a phone the bottom bar holds four
  sections and More; the More sheet lists each other section with its sub-menus as direct links, so More, sub-menu,
  page is three taps.
- **B:** a section's sub-menus are the columns of its wide menu and the headings of its local list. On a phone, a
  drawer with one accordion per section.
- **C:** a section's sub-menus are the labels of its panel. On a phone the bottom bar holds the workspaces and the
  page finder sits in the top bar.
- **Approvals** are in the same place in every style: the Approvals inbox under Home. It is a page of this spec, not a
  Soon entry: from the first release it lists the kinds of approval the project already has, each linking to its
  existing page, and gains the later kinds (voids, cash variance, wastage) as they are built. Counts are shown where
  an existing read supplies them. Each kind of approval also stays in its own section.
- **Reports** are all in Reports and money, including staff reports. Daily attendance work stays under Team.
- **The style choice** is on the Appearance page under Setup and in the account menu, in every style, together with
  the light and dark switch. In the other areas it is offered when that area is delivered by its own spec.

## Keeping the two maps in sync

The source of both files is `docs/specs/074-admin-navigation-layout-restructure/app-map.shared.mjs` in
`lolotam/PayPos.systems`. Neither `app-map.md` is edited by hand. To add, rename, move or reorder a page, or to change
its state in either project: change that file, run it, and open one docs PR in each repository. The script prints
whether the two files still match apart from the State column. A task that adds a page to one project updates the
shared source in the same way.

## The Under development page

- One page, opened by every Soon entry. It shows the entry's name, one line saying the page is under development, and
  a button back to Home. No date and no phase number.
- A Soon entry is shown by business type and role, in the menu, in the page finder and to a direct link.
- A Soon entry gives no access to anything: it opens that page only.
- When a page is built, its entry becomes Live and points to the real address. An old Under development link then
  applies the page's own rule first: a user who may see the page is forwarded to it, a user who may not gets the
  not-found page.
