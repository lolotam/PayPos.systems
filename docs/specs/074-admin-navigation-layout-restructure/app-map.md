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
  salon is selected and the restaurant's entries after switching.
- **Roles**: the shared planned audience for an entry that is Soon in either project (NAV-Q14), based on PRD §3.2
  and existing role defaults where the page is already built in the other project. New entries use their stated
  opening condition. When a row is Live in this project, the page's own permission applies regardless of any
  planned roles shown in this column. Partner decisions marked `PENDING` in `owner-questions.ar.md` are still open.
- Names are working names in English; the Arabic and English labels are written in the i18n catalogs when an entry is
  added.

## Management area

### 1. Home

| Page | Phase | State | Shown only to | Roles |
|---|---|---|---|---|
| Dashboard (today at a glance) | 1 | Live | every business type | By page permission |
| Shift dashboard (current shift and what needs attention) | 2 | Soon | every business type | Owner, General manager, Business manager, Branch manager |
| Approvals inbox (everything waiting for a decision, one count) | 1 | Live | every business type | Owner, General manager, Business manager, Branch manager (by kind) |
| Daily sales dashboard | 2 | Soon | every business type | Owner, General manager, Accountant, Business manager, Branch manager, Viewer |
| All-businesses dashboard | 5 | Soon | every business type | Owner, General manager |

### 2. Sales

| Sub-menu | Page | Phase | State | Shown only to | Roles |
|---|---|---|---|---|---|
| Service visits | Record a visit | 1 | Live | every business type | Owner, General manager, Business manager, Branch manager, Cashier |
| Service visits | Sessions (day list) | 1 | Live | every business type | By page permission |
| Service visits | Sell a package | 1 | Live | every business type | Owner, General manager, Business manager, Branch manager, Cashier |
| Service visits | Customer packages (who holds what, sessions left) | 1 | Live | every business type | Owner, General manager, Business manager, Branch manager |
| Service visits | Unassigned services (exceptions) | 1 | Soon | every business type | Owner, General manager, Business manager, Branch manager |
| Discounts | Discounts | 1 | Soon | every business type | Owner, General manager, Business manager, Marketing |
| Discounts | Discount approvals | 1 | Soon | every business type | Owner, General manager, Business manager, Branch manager |
| Orders | Orders | 2 | Soon | every business type | Owner, General manager, Accountant, Business manager, Branch manager |
| Orders | Returns | 2 | Soon | every business type | Owner, General manager, Accountant, Business manager, Branch manager |
| Orders | Fulfilment board (stages, payment status, delays, call the customer) | — | Soon | every business type | Owner, General manager, Business manager, Branch manager |
| Payments | Payments and refunds | 2 | Soon | every business type | Owner, General manager, Accountant, Business manager, Branch manager |
| Payments | Customer accounts (on-account sales) | 2 | Soon | every business type | Owner, General manager, Accountant, Business manager |
| Cash | Cash shifts | 2 | Soon | every business type | Owner, General manager, Accountant, Business manager, Branch manager |
| Cash | Paid in and paid out | 2 | Soon | every business type | Owner, General manager, Accountant, Business manager, Branch manager |
| POS | Open reception / cashier | 1 | Soon | every business type | Owner, General manager, Business manager, Branch manager |
| POS | POS devices and PINs | 2 | Soon | every business type | Owner, General manager, Business manager, Branch manager |
| POS | Receipts and printing | 2 | Soon | every business type | Owner, General manager, Business manager, Branch manager |
| Restaurant | Tables and floor map | 3 | Soon | Restaurant, café | Owner, General manager, Business manager, Branch manager |
| Restaurant | Kitchen screens and stations | 3 | Soon | Restaurant, café | Owner, General manager, Business manager, Branch manager |
| Delivery | Delivery channels | 4 | Soon | Restaurant, café, grocery | Owner, General manager, Business manager |
| Delivery | Delivery zones | 2 | Soon | Restaurant, café, grocery, laundry | Owner, General manager, Business manager, Branch manager |
| Delivery | Drivers | — | Soon | Restaurant, café, grocery, laundry | Owner, General manager, Business manager, Branch manager |
| For this business type | Laundry tickets | 6 | Soon | Laundry | Owner, General manager, Business manager, Branch manager |
| For this business type | Barcode, scale and offers | 6 | Soon | Grocery, retail | Owner, General manager, Business manager, Branch manager |
| For this business type | Quotes and invoices | 6 | Soon | Services company | Owner, General manager, Accountant, Business manager, Branch manager |
| For this business type | Memberships and classes | 6 | Soon | Gym, education | Owner, General manager, Business manager, Branch manager |
| For this business type | Patient files | 6 | Soon | Clinic | Owner, General manager, Business manager, Branch manager |

### 3. Catalog and stores

| Sub-menu | Page | Phase | State | Shown only to | Roles |
|---|---|---|---|---|---|
| Catalog | Services (+ Add service) | 1 | Live | every business type | By page permission |
| Catalog | Categories | 1 | Live | every business type | Owner, General manager, Business manager, Branch manager |
| Catalog | Package types (+ Add package type) | 1 | Live | every business type | Owner, General manager, Business manager |
| Catalog | Products and variants | 2 | Soon | every business type | Owner, General manager, Business manager |
| Catalog | Options and modifiers | 2 | Soon | every business type | Owner, General manager, Business manager |
| Catalog | Price lists | 2 | Soon | every business type | Owner, General manager, Business manager |
| Catalog | Combos and bundles | 2 | Soon | every business type | Owner, General manager, Business manager |
| Catalog | Units of measure | 3 | Soon | every business type | Owner, General manager, Business manager, Storekeeper |
| Stores | Stock items | 3 | Soon | every business type | Owner, General manager, Business manager, Branch manager, Storekeeper |
| Stores | Locations | 3 | Soon | every business type | Owner, General manager, Business manager, Storekeeper |
| Stores | Suppliers | 3 | Soon | every business type | Owner, General manager, Accountant, Business manager, Storekeeper |
| Stores | Purchases | 3 | Soon | every business type | Owner, General manager, Accountant, Business manager, Storekeeper |
| Stores | Transfers | 3 | Soon | every business type | Owner, General manager, Business manager, Branch manager, Storekeeper |
| Stores | Stock counts | 3 | Soon | every business type | Owner, General manager, Business manager, Branch manager, Storekeeper |
| Stores | Adjustments and wastage | 3 | Soon | every business type | Owner, General manager, Business manager, Branch manager, Storekeeper |
| Stores | Barcode labels | — | Soon | every business type | Owner, General manager, Business manager, Branch manager, Storekeeper |
| Production | Recipes | 3 | Soon | Restaurant, café | Owner, General manager, Business manager, Storekeeper |
| Production | Production orders | 3 | Soon | Restaurant, café | Owner, General manager, Business manager, Branch manager, Storekeeper |

### 4. Customers and marketing

| Sub-menu | Page | Phase | State | Shown only to | Roles |
|---|---|---|---|---|---|
| Customers | Customers | 2 | Soon | every business type | Owner, General manager, Business manager, Branch manager, Marketing |
| Customers | Tags and blocks | 2 | Soon | every business type | Owner, General manager, Business manager, Branch manager, Marketing |
| Customers | Customer wallet (prepaid balance) | — | Soon | every business type | Owner, General manager, Accountant, Business manager, Branch manager |
| Customers | Ratings and reviews | 1 | Live | every business type | Owner, General manager, Business manager, Branch manager, Marketing |
| Appointments | Calendar | 4 | Soon | Salon, spa, barber, clinic, services company | Owner, General manager, Business manager, Branch manager |
| Appointments | Resources (chairs, rooms) | 4 | Soon | Salon, spa, barber, clinic, services company | Owner, General manager, Business manager, Branch manager |
| Appointments | Waitlist | 4 | Soon | Salon, spa, barber, clinic, services company | Owner, General manager, Business manager, Branch manager |
| Appointments | Booking rules | 4 | Soon | Salon, spa, barber, clinic, services company | Owner, General manager, Business manager |
| Appointments | Appointment categories | 4 | Soon | Salon, spa, barber, clinic, services company | Owner, General manager, Business manager |
| Online | Company public page | 1 | Soon | every business type | Owner, General manager, Business manager, Marketing |
| Online | Online menu builder | 4 | Soon | every business type | Owner, General manager, Business manager, Marketing |
| Online | Customer call (set up the waiting page and its QR code) | — | Soon | every business type | Owner, General manager, Business manager, Branch manager |
| Marketing | Business WhatsApp | 4 | Soon | every business type | Owner, General manager, Business manager, Marketing |
| Marketing | Campaigns | 4 | Soon | every business type | Owner, General manager, Business manager, Marketing |
| Marketing | Message templates | 4 | Soon | every business type | Owner, General manager, Business manager, Marketing |
| Marketing | Social media management | — | Soon | every business type | Owner, General manager, Business manager, Marketing |
| Loyalty | Loyalty points | 4 | Soon | every business type | Owner, General manager, Business manager, Marketing |
| Loyalty | Loyalty cards (wallet stamp cards) | 6 | Soon | every business type | Owner, General manager, Business manager, Marketing |
| Loyalty | Gift cards | 4 | Soon | every business type | Owner, General manager, Business manager, Marketing |
| Loyalty | Discount cards and codes | 4 | Soon | every business type | Owner, General manager, Business manager, Marketing |

### 5. Team

| Sub-menu | Page | Phase | State | Shown only to | Roles |
|---|---|---|---|---|---|
| Employees | Employees (+ Create, + Employee detail) | 1 | Live | every business type | By page permission |
| Employees | Employee numbers | 1 | Live | every business type | Owner |
| Employees | Import employees | 1 | Live | every business type | Owner, General manager, Business manager |
| Employees | Document types | 1 | Live | every business type | Owner |
| Employees | Attendance cards | 1 | Soon | every business type | Owner, General manager, Business manager, Branch manager |
| Employees | Phones | 1 | Soon | every business type | Owner, General manager, Business manager, Branch manager |
| Schedules | Weekly schedules | 1 | Live | every business type | Owner, General manager, Business manager, Branch manager |
| Schedules | Schedule settings | 1 | Live (a block of Weekly schedules until it gets its own page) | every business type | Owner |
| Attendance | Board | 1 | Live | every business type | Owner, General manager, Accountant, Business manager, Branch manager |
| Attendance | Requests | 1 | Live | every business type | Owner, General manager, Business manager, Branch manager |
| Attendance | Exceptions | 1 | Live | every business type | Owner, General manager, Accountant, Business manager, Branch manager |
| Attendance | Corrections | 1 | Soon | every business type | Owner, General manager, Business manager, Branch manager |
| Attendance | Insights | 1 | Soon | every business type | Owner, General manager, Business manager, Branch manager |
| Leave | Leave approvals | 1 | Live | every business type | Owner, General manager, Business manager, Branch manager |
| Pay | Commission plans | 1 | Live | every business type | By page permission |
| Pay | Commission overrides | 1 | Live | every business type | By page permission |
| Pay | Salaries | 1 | Soon | every business type | Owner |
| Pay | Commission statements | 1 | Live | every business type | Owner, General manager, Accountant, Business manager, Branch manager |
| Pay | Payroll runs and payslips | 5 | Soon | every business type | Owner, General manager, Accountant |
| Pay | Loans and advances | 5 | Soon | every business type | Owner, General manager, Accountant |

### 6. Reports and money

| Sub-menu | Page | Phase | State | Shown only to | Roles |
|---|---|---|---|---|---|
| Staff reports | Attendance report | 1 | Live | every business type | By page permission |
| Staff reports | Attendance statement | 1 | Live | every business type | Owner, General manager, Accountant, Business manager, Branch manager |
| Staff reports | Leave history report | 1 | Live | every business type | Owner, General manager, Business manager, Branch manager |
| Sales reports | Sales (by channel, type, method, hour, staff) | 5 | Soon | every business type | Owner, General manager, Accountant, Business manager, Branch manager, Viewer |
| Sales reports | Products and returns | 5 | Soon | every business type | Owner, General manager, Accountant, Business manager, Branch manager, Viewer |
| Sales reports | Payments and customer balances | 5 | Soon | every business type | Owner, General manager, Accountant, Business manager, Viewer |
| Stock reports | Stock and cost of goods | 3 | Soon | every business type | Owner, General manager, Accountant, Business manager, Viewer |
| Stock reports | Stock movements ledger (item activity) | 3 | Soon | every business type | Owner, General manager, Accountant, Business manager, Storekeeper, Viewer |
| Performance | Commissions and performance | 5 | Soon | every business type | Owner, General manager, Accountant, Business manager, Viewer |
| Performance | Customer call report (waiting and service time) | — | Soon | every business type | Owner, General manager, Business manager, Branch manager, Viewer |
| Performance | Appointments report | 5 | Soon | Salon, spa, barber, clinic, services company | Owner, General manager, Business manager, Branch manager, Viewer |
| Expenses | Expenses | 5 | Soon | every business type | Owner, General manager, Accountant |
| Expenses | Recurring expenses | 5 | Soon | every business type | Owner, General manager, Accountant |
| Expenses | Profit and loss per business | 5 | Soon | every business type | Owner, General manager, Accountant, Viewer |
| Exports | Scheduled reports | 5 | Soon | every business type | Owner, General manager, Accountant, Business manager |
| Exports | Accounting export | 5 | Soon | every business type | Owner, General manager, Accountant |
| Exports | Qayd filing pack (XBRL) | — | Soon | Country: Kuwait (any business type) | Owner, General manager, Accountant |
| Exports | Request the Qayd filing service | — | Soon | Country: Kuwait (any business type) | Owner, General manager, Accountant |

### 7. Setup

| Sub-menu | Page | Phase | State | Shown only to | Roles |
|---|---|---|---|---|---|
| Business | Business identity | 1 | Live | every business type | Owner |
| Business | Branches | — | Soon | every business type | Owner, General manager, Business manager |
| Business | Alerts and notifications | 1 | Live | every business type | Owner, General manager, Business manager |
| Business | Imported-package refunds | 1 | Live | every business type | Owner |
| Business | Data import (Excel) | 1 | Soon | every business type | Owner, General manager, Business manager |
| Business | Tax and invoice template | 2 | Soon | every business type | Owner, General manager, Accountant, Business manager |
| Business | Invoice terms and conditions | — | Soon | every business type | Owner, General manager, Business manager |
| Business | Working hours and order rules | 2 | Soon | every business type | Owner, General manager, Business manager |
| Business | Payment methods and gateways | 2 | Soon | every business type | Owner, General manager, Accountant |
| Access | Permissions | 1 | Live | every business type | By page permission |
| Access | Invitations | - | Live | every business type | Owner |
| Access | Sign-in security (authenticator) | 1 | Live | every business type | Every signed-in admin user (NAV-Q1) |
| Access | Approval limits | 2 | Soon | every business type | Owner, General manager, Business manager |
| Access | Activity log (who did what, and when) | — | Soon | every business type | Owner, General manager |
| Staff app | Staff app link | 1 | Live | every business type | Owner, General manager, Business manager |
| Staff app | Staff app columns | 1 | Live | every business type | Owner, General manager, Business manager |
| Appearance | Appearance (navigation style, light and dark) | 1 | Live | every business type | Every signed-in admin user (NAV-Q1) |
| Plan | Subscription and billing | 5 | Soon | every business type | Owner |
| Developers | API keys and webhooks | 5 | Soon | every business type | Owner, General manager |
| Compliance | ZATCA e-invoicing | 6 | Soon | Country: Saudi Arabia (any business type) | Owner, General manager, Accountant |

"Social media management" is the owner's request of 2026-11-21; it is not in the PRD and needs a PRD entry and a spec
before anything is built. The owner confirmed it is listed as a Soon entry.

Thirteen entries were added on 2026-11-21 after comparing this map with a competing salon product: Shift dashboard,
Customer packages, Fulfilment board, Drivers, Units of measure, Stock movements ledger, Barcode labels, Customer
wallet, Appointment categories, Branches, Invoice terms and conditions, Invitations, and Activity log. Those marked
"—" in the Phase column are not named in the PRD and need a PRD entry and a spec before anything is built. Some of
them may end up as part of another page rather than a page of their own.

Notes on three of them. The Stock movements ledger sits under Stock reports because the PRD schedules it as a report
(P3-T7.1). Branches has no phase: the PRD creates branches in Phase 0 tenancy and names only a branch selector in
Phase 1, so a branch-management screen needs its own PRD entry. Invitations is the exception to the rule above: the
work is already tracked, as company invitations in PRD P0-T9a.8 and issue #19. In this project only the screen is missing, so the screen extends that issue rather than starting a new roadmap item. Managing users and their permissions is
the Permissions page, which the PRD plans in Phase 1 (P1-T2.4).

The stock entries (Stores, Units of measure, the two stock reports) are shown to every business type. The owner
decided this on 2026-11-21 (NAV-Q19 in spec 074, NAV-L7 in spec 022).

Customer call was added on 2026-11-21 at the owner's request (NAV-Q20 in spec 074, NAV-L8 in spec 022): staff call
the customer on the customer's own phone when an order is ready or a turn has come. The customer scans a QR code and
waits on a web page, with no app and no account. The feature is named Customer call (نداء العميل). It adds two
entries, "Customer call" under Online and the "Customer call report", and the call button belongs to the Fulfilment
board. The Management entry is the staff side: where the feature is set up and the QR code is taken from. The page the
customer opens is public, sits outside the Management frame and needs no account; its address is defined by the
feature's own spec. None of it is in the PRD; it needs a PRD
entry and a spec, which must also settle how the alert reaches a locked phone.

The two Qayd entries were added on 2026-11-21 at the owner's request (NAV-Q21 in spec 074, NAV-L10 in spec 022).
Kuwait's Ministry of Commerce and Industry takes annual financial statements as XBRL data through its Qayd system,
voluntary in 2026 and mandatory from 1 January 2027 by the ministry's announcement. The filing pack gathers the year's
figures this product holds (sales, cost of goods, expenses, pay and commissions, stock value) for the accountant or
auditor; it is not a complete XBRL filing, because the product has no general ledger and the statements are audited
before filing. "Request the Qayd filing service" hands the customer to a partner accounting office. Both are shown
only to businesses in Kuwait, need a PRD entry and a spec, and wait on the ministry's technical specification, which
was not found when this was written.

How an owner gets a second business type on the same account (created by the platform operator, or by an invitation
to the same email) is a subscription question, not a menu question, and is not decided here.

## Other areas

The same map in both projects. In this project they are reference only: the cashier and staff apps get their own specs, and the requirements and release checks of spec 074 cover the Management area alone.

An entry of the Platform area is not filtered by business type or by company role: a platform workspace has neither,
and the platform role alone decides who sees it. Staff and Platform have no sections, so Appearance is an entry of its
own there.

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
| Appointments | Today's bookings | 4 | Separate spec (NAV-Q11) | Salon, spa, barber, clinic, services company |
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
| Dashboard | 1 | Separate spec (NAV-Q11) | Platform role (business type does not apply) |
| Connectors | 1 | Separate spec (NAV-Q11) | Platform role (business type does not apply) |
| Diagnose | 1 | Separate spec (NAV-Q11) | Platform role (business type does not apply) |
| Companies and subscriptions | 5 | Separate spec (NAV-Q11) | Platform role (business type does not apply) |
| Plans and feature flags | 5 | Separate spec (NAV-Q11) | Platform role (business type does not apply) |
| Support and health | 5 | Separate spec (NAV-Q11) | Platform role (business type does not apply) |
| Appearance | 1 | Separate spec (NAV-Q11) | Platform role (business type does not apply) |

## Counts

- Management area: 128 mapped pages. In this project: 34 Live, 0 New, 94 Soon.
- Other areas: 24 menu pages. In this project: 0 Live, 0 Soon, 24 not mapped here (the cashier app has its own spec).
- Child pages such as customer package details have no menu entry of their own. Only the pages listed in the map are counted.

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
its state in either project: change that file, run it, and open one docs PR in each repository. Run it with
`--check` and the other copy's path to confirm, without writing, that both checked-in files still match the source. A task that adds a page to one project updates the
shared source in the same way.

## The Under development page

- One page, opened by every Soon entry. It shows the entry's name, one line saying the page is under development, and
  a button back to Home. No date and no phase number.
- A Soon entry is shown by business type and role, in the menu, in the page finder and to a direct link.
- A Soon entry gives no access to anything: it opens that page only.
- When a page is built, its entry becomes Live and points to the real address. An old Under development link then
  applies the page's own rule first: a user who may see the page is forwarded to it, a user who may not gets the
  not-found page.
