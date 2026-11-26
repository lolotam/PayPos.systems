// The one source of the app map shared by two projects: lolotam/PayPos.systems (spec 074) and
// lolotam/lovable-pospay (spec 022). Sections, sub-menus, page names and order are the same in both files;
// only the State column differs.
// Usage:
//   node app-map.shared.mjs [path-to-022-app-map.md]            rewrite app-map.md beside this file, and the other copy if given
//   node app-map.shared.mjs --check <path-to-022-app-map.md>    write nothing; exit 1 if either file differs from what this source generates
// Change a name, an order, a state or a role here, run it, and open one PR in each repository.
import { existsSync, lstatSync, readFileSync, readlinkSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const L = 'Live', S = 'Soon', N = 'New';
// PRD §3.2 baseline role groups for NAV-Q14. Live entries follow their own page permission; partner checks remain PENDING where recorded in owner-questions.ar.md.
const R_LIVE = 'By page permission';
const R_ALL_ADMIN = 'Every signed-in admin user (NAV-Q1)';
const R_APPROVALS = 'Owner, General manager, Business manager, Branch manager (by kind)';
const R_OWNER = 'Owner';
const R_CO_MGR = 'Owner, General manager';
const R_BIZ_MGR = 'Owner, General manager, Business manager';
const R_OPS_MGR = 'Owner, General manager, Business manager, Branch manager';
const R_RECEPTION = 'Owner, General manager, Business manager, Branch manager, Cashier';
const R_FIN = 'Owner, General manager, Accountant';
const R_FIN_BIZ = 'Owner, General manager, Accountant, Business manager';
const R_FIN_OPS = 'Owner, General manager, Accountant, Business manager, Branch manager';
const R_CO_RPT = 'Owner, General manager, Accountant, Viewer';
const R_FIN_RPT = 'Owner, General manager, Accountant, Business manager, Viewer';
const R_OPS_RPT = 'Owner, General manager, Accountant, Business manager, Branch manager, Viewer';
const R_BR_RPT = 'Owner, General manager, Business manager, Branch manager, Viewer';
const R_INV_BIZ = 'Owner, General manager, Business manager, Storekeeper';
const R_INV_OPS = 'Owner, General manager, Business manager, Branch manager, Storekeeper';
const R_INV_FIN = 'Owner, General manager, Accountant, Business manager, Storekeeper';
const R_INV_RPT = 'Owner, General manager, Accountant, Business manager, Storekeeper, Viewer';
const R_MKT_BIZ = 'Owner, General manager, Business manager, Marketing';
const R_MKT_OPS = 'Owner, General manager, Business manager, Branch manager, Marketing';
// [sub-menu, page, phase, PosPay.systems state, lovable-pospay state, shown only to (business type) or '', roles?]
// Shared planned audience (7th value): applies when a row is Soon or New in that project. Live pages check their permissions.
const MANAGE = [
  ['1. Home', [
    ['', 'Dashboard (today at a glance)', '1', L, L, '', R_LIVE],
    ['', 'Shift dashboard (current shift and what needs attention)', '2', S, S, '', R_OPS_MGR],
    ['', 'Approvals inbox (everything waiting for a decision, one count)', '1', L, N, '', R_APPROVALS],
    ['', 'Daily sales dashboard', '2', S, S, '', R_OPS_RPT],
    ['', 'All-businesses dashboard', '5', S, S, '', R_CO_MGR],
  ]],
  ['2. Sales', [
    ['Service visits', 'Record a visit', '1', L, S, '', R_RECEPTION],
    ['Service visits', 'Sessions (day list)', '1', L, L, '', R_LIVE],
    ['Service visits', 'Sell a package', '1', L, S, '', R_RECEPTION],
    ['Service visits', 'Customer packages (who holds what, sessions left)', '1', L, S, '', R_OPS_MGR],
    ['Service visits', 'Unassigned services (exceptions)', '1', S, S, '', R_OPS_MGR],
    ['Discounts', 'Discounts', '1', S, L, '', R_MKT_BIZ],
    ['Discounts', 'Discount approvals', '1', S, L, '', R_OPS_MGR],
    ['Orders', 'Orders', '2', S, S, '', R_FIN_OPS],
    ['Orders', 'Returns', '2', S, S, '', R_FIN_OPS],
    ['Orders', 'Fulfilment board (stages, payment status, delays, call the customer)', '—', S, S, '', R_OPS_MGR],
    ['Payments', 'Payments and refunds', '2', S, S, '', R_FIN_OPS],
    ['Payments', 'Customer accounts (on-account sales)', '2', S, S, '', R_FIN_BIZ],
    ['Cash', 'Cash shifts', '2', S, S, '', R_FIN_OPS],
    ['Cash', 'Paid in and paid out', '2', S, S, '', R_FIN_OPS],
    ['POS', 'Open reception / cashier', '1', S, L, '', R_OPS_MGR],
    ['POS', 'POS devices and PINs', '2', L, S, '', R_OPS_MGR],
    ['POS', 'Receipts and printing', '2', S, S, '', R_OPS_MGR],
    ['Restaurant', 'Tables and floor map', '3', S, S, 'Restaurant, café', R_OPS_MGR],
    ['Restaurant', 'Kitchen screens and stations', '3', S, S, 'Restaurant, café', R_OPS_MGR],
    ['Delivery', 'Delivery channels', '4', S, S, 'Restaurant, café, grocery', R_BIZ_MGR],
    ['Delivery', 'Delivery zones', '2', S, S, 'Restaurant, café, grocery, laundry', R_OPS_MGR],
    ['Delivery', 'Drivers', '—', S, S, 'Restaurant, café, grocery, laundry', R_OPS_MGR],
    ['For this business type', 'Laundry tickets', '6', S, S, 'Laundry', R_OPS_MGR],
    ['For this business type', 'Barcode, scale and offers', '6', S, S, 'Grocery, retail', R_OPS_MGR],
    ['For this business type', 'Quotes and invoices', '6', S, S, 'Services company', R_FIN_OPS],
    ['For this business type', 'Memberships and classes', '6', S, S, 'Gym, education', R_OPS_MGR],
    ['For this business type', 'Patient files', '6', S, S, 'Clinic', R_OPS_MGR],
  ]],
  ['3. Catalog and stores', [
    ['Catalog', 'Services (+ Add service)', '1', L, L, '', R_LIVE],
    ['Catalog', 'Categories', '1', L, S, '', R_OPS_MGR],
    ['Catalog', 'Package types (+ Add package type)', '1', L, S, '', R_BIZ_MGR],
    ['Catalog', 'Products and variants', '2', S, S, '', R_BIZ_MGR],
    ['Catalog', 'Options and modifiers', '2', S, S, '', R_BIZ_MGR],
    ['Catalog', 'Price lists', '2', S, S, '', R_BIZ_MGR],
    ['Catalog', 'Combos and bundles', '2', S, S, '', R_BIZ_MGR],
    ['Catalog', 'Units of measure', '3', S, S, '', R_INV_BIZ],
    ['Stores', 'Stock items', '3', S, S, '', R_INV_OPS],
    ['Stores', 'Locations', '3', S, S, '', R_INV_BIZ],
    ['Stores', 'Suppliers', '3', S, S, '', R_INV_FIN],
    ['Stores', 'Purchases', '3', S, S, '', R_INV_FIN],
    ['Stores', 'Transfers', '3', S, S, '', R_INV_OPS],
    ['Stores', 'Stock counts', '3', S, S, '', R_INV_OPS],
    ['Stores', 'Adjustments and wastage', '3', S, S, '', R_INV_OPS],
    ['Stores', 'Barcode labels', '—', S, S, '', R_INV_OPS],
    ['Production', 'Recipes', '3', S, S, 'Restaurant, café', R_INV_BIZ],
    ['Production', 'Production orders', '3', S, S, 'Restaurant, café', R_INV_OPS],
  ]],
  ['4. Customers and marketing', [
    ['Customers', 'Customers', '2', S, S, '', R_MKT_OPS],
    ['Customers', 'Tags and blocks', '2', S, S, '', R_MKT_OPS],
    ['Customers', 'Customer wallet (prepaid balance)', '—', S, S, '', R_FIN_OPS],
    ['Customers', 'Ratings and reviews', '1', L, S, '', R_MKT_OPS],
    ['Appointments', 'Calendar', '4', S, S, 'Salon, spa, barber, clinic, services company', R_OPS_MGR],
    ['Appointments', 'Resources (chairs, rooms)', '4', S, S, 'Salon, spa, barber, clinic, services company', R_OPS_MGR],
    ['Appointments', 'Waitlist', '4', S, S, 'Salon, spa, barber, clinic, services company', R_OPS_MGR],
    ['Appointments', 'Booking rules', '4', S, S, 'Salon, spa, barber, clinic, services company', R_BIZ_MGR],
    ['Appointments', 'Appointment categories', '4', S, S, 'Salon, spa, barber, clinic, services company', R_BIZ_MGR],
    ['Online', 'Company public page', '1', S, L, '', R_MKT_BIZ],
    ['Online', 'Online menu builder', '4', S, S, '', R_MKT_BIZ],
    ['Online', 'Customer call (set up the waiting page and its QR code)', '—', S, S, '', R_OPS_MGR],
    ['Marketing', 'Business WhatsApp', '4', S, S, '', R_MKT_BIZ],
    ['Marketing', 'Campaigns', '4', S, S, '', R_MKT_BIZ],
    ['Marketing', 'Message templates', '4', S, S, '', R_MKT_BIZ],
    ['Marketing', 'Social media management', '—', S, S, '', R_MKT_BIZ],
    ['Loyalty', 'Loyalty points', '4', S, S, '', R_MKT_BIZ],
    ['Loyalty', 'Loyalty cards (wallet stamp cards)', '6', S, S, '', R_MKT_BIZ],
    ['Loyalty', 'Gift cards', '4', S, S, '', R_MKT_BIZ],
    ['Loyalty', 'Discount cards and codes', '4', S, S, '', R_MKT_BIZ],
  ]],
  ['5. Team', [
    ['Employees', 'Employees (+ Create, + Employee detail)', '1', L, L, '', R_LIVE],
    ['Employees', 'Employee numbers', '1', L, S, '', R_OWNER],
    ['Employees', 'Import employees', '1', L, S, '', R_BIZ_MGR],
    ['Employees', 'Document types', '1', L, S, '', R_OWNER],
    ['Employees', 'Attendance cards', '1', S, L, '', R_OPS_MGR],
    ['Employees', 'Phones', '1', S, L, '', R_OPS_MGR],
    ['Schedules', 'Weekly schedules', '1', L, S, '', R_OPS_MGR],
    ['Schedules', 'Schedule settings', '1', L, S, '', R_OWNER],
    ['Attendance', 'Board', '1', L, S, '', R_FIN_OPS],
    ['Attendance', 'Requests', '1', L, S, '', R_OPS_MGR],
    ['Attendance', 'Exceptions', '1', L, S, '', R_FIN_OPS],
    ['Attendance', 'Corrections', '1', S, L, '', R_OPS_MGR],
    ['Attendance', 'Insights', '1', S, L, '', R_OPS_MGR],
    ['Leave', 'Leave approvals', '1', L, S, '', R_OPS_MGR],
    ['Pay', 'Commission plans', '1', L, L, '', R_LIVE],
    ['Pay', 'Commission overrides', '1', L, L, '', R_LIVE],
    ['Pay', 'Salaries', '1', S, L, '', R_OWNER],
    ['Pay', 'Commission statements', '1', L, S, '', 'Owner, General manager, Accountant, Business manager, Branch manager'],
    ['Pay', 'Payroll runs and payslips', '5', S, S, '', R_FIN],
    ['Pay', 'Loans and advances', '5', S, S, '', R_FIN],
  ]],
  ['6. Reports and money', [
    ['Staff reports', 'Attendance report', '1', L, L, '', R_LIVE],
    ['Staff reports', 'Attendance statement', '1', L, S, '', R_FIN_OPS],
    ['Staff reports', 'Leave history report', '1', L, S, '', R_OPS_MGR],
    ['Sales reports', 'Sales (by channel, type, method, hour, staff)', '5', S, S, '', R_OPS_RPT],
    ['Sales reports', 'Products and returns', '5', S, S, '', R_OPS_RPT],
    ['Sales reports', 'Payments and customer balances', '5', S, S, '', R_FIN_RPT],
    ['Stock reports', 'Stock and cost of goods', '3', S, S, '', R_FIN_RPT],
    ['Stock reports', 'Stock movements ledger (item activity)', '3', S, S, '', R_INV_RPT],
    ['Performance', 'Commissions and performance', '5', S, S, '', R_FIN_RPT],
    ['Performance', 'Customer call report (waiting and service time)', '—', S, S, '', R_BR_RPT],
    ['Performance', 'Appointments report', '5', S, S, 'Salon, spa, barber, clinic, services company', R_BR_RPT],
    ['Expenses', 'Expenses', '5', S, S, '', R_FIN],
    ['Expenses', 'Recurring expenses', '5', S, S, '', R_FIN],
    ['Expenses', 'Profit and loss per business', '5', S, S, '', R_CO_RPT],
    ['Exports', 'Scheduled reports', '5', S, S, '', R_FIN_BIZ],
    ['Exports', 'Accounting export', '5', S, S, '', R_FIN],
    ['Exports', 'Qayd filing pack (XBRL)', '—', S, S, 'Country: Kuwait (any business type)', R_FIN],
    ['Exports', 'Request the Qayd filing service', '—', S, S, 'Country: Kuwait (any business type)', R_FIN],
  ]],
  ['7. Setup', [
    ['Business', 'Business identity', '1', L, S, '', R_OWNER],
    ['Business', 'Branches', '—', S, S, '', R_BIZ_MGR],
    ['Business', 'Alerts and notifications', '1', L, S, '', R_BIZ_MGR],
    ['Business', 'Imported-package refunds', '1', L, S, '', R_OWNER],
    ['Business', 'Data import (Excel)', '1', S, S, '', R_BIZ_MGR],
    ['Business', 'Tax and invoice template', '2', S, S, '', R_FIN_BIZ],
    ['Business', 'Invoice terms and conditions', '—', S, S, '', R_BIZ_MGR],
    ['Business', 'Working hours and order rules', '2', S, S, '', R_BIZ_MGR],
    ['Business', 'Payment methods and gateways', '2', S, S, '', R_FIN],
    ['Access', 'Permissions', '1', L, L, '', R_LIVE],
    ['Access', 'Invitations', '—', L, L, '', R_OWNER],
    ['Access', 'Sign-in security (authenticator)', '1', L, S, '', R_ALL_ADMIN],
    ['Access', 'Approval limits', '2', S, S, '', R_BIZ_MGR],
    ['Access', 'Activity log (who did what, and when)', '—', S, S, '', R_CO_MGR],
    ['Staff app', 'Staff app link', '1', L, S, '', R_BIZ_MGR],
    ['Staff app', 'Staff app columns', '1', L, S, '', R_BIZ_MGR],
    ['Appearance', 'Appearance (navigation style, light and dark)', '1', L, 'Live (today\'s Settings page; gains the style choice)', '', R_ALL_ADMIN],
    ['Plan', 'Subscription and billing', '5', S, S, '', R_OWNER],
    ['Developers', 'API keys and webhooks', '5', S, S, '', R_CO_MGR],
    ['Compliance', 'ZATCA e-invoicing', '6', S, S, 'Country: Saudi Arabia (any business type)', R_FIN],
  ]],
];
const NOTMAPPED = 'Separate spec (NAV-Q11)';
const OTHER = [
  ['Reception / cashier', [
    ['Today', 'Reception home', '1', NOTMAPPED, L, ''],
    ['Attendance', 'QR check-in', '1', NOTMAPPED, L, ''],
    ['Attendance', 'Card scan', '1', NOTMAPPED, L, ''],
    ['Sessions', 'Sessions', '1', NOTMAPPED, L, ''],
    ['Sell', 'New sale', '2', NOTMAPPED, S, ''],
    ['Sell', 'Open orders', '2', NOTMAPPED, S, ''],
    ['Sell', 'Returns', '2', NOTMAPPED, S, ''],
    ['Cash', 'My cash shift', '2', NOTMAPPED, S, ''],
    ['Appointments', 'Today\'s bookings', '4', NOTMAPPED, S, 'Salon, spa, barber, clinic, services company'],
    ['Setup', 'Appearance', '1', NOTMAPPED, 'Live (today\'s Settings page)', ''],
  ]],
  ['Staff', [
    ['', 'My dashboard', '1', NOTMAPPED, L, ''],
    ['', 'Attend', '1', NOTMAPPED, L, ''],
    ['', 'My phone', '1', NOTMAPPED, L, ''],
    ['', 'My leave', '1', NOTMAPPED, S, ''],
    ['', 'My commissions', '1', NOTMAPPED, S, ''],
    ['', 'My schedule', '1', NOTMAPPED, S, ''],
    ['', 'Appearance', '1', NOTMAPPED, 'Live (today\'s Settings page)', ''],
  ]],
  ['Platform', [
    ['', 'Dashboard', '1', NOTMAPPED, L, 'Platform role (business type does not apply)'],
    ['', 'Connectors', '1', NOTMAPPED, L, 'Platform role (business type does not apply)'],
    ['', 'Diagnose', '1', NOTMAPPED, L, 'Platform role (business type does not apply)'],
    ['', 'Companies and subscriptions', '5', NOTMAPPED, S, 'Platform role (business type does not apply)'],
    ['', 'Plans and feature flags', '5', NOTMAPPED, S, 'Platform role (business type does not apply)'],
    ['', 'Support and health', '5', NOTMAPPED, S, 'Platform role (business type does not apply)'],
    ['', 'Appearance', '1', NOTMAPPED, 'Live (today\'s Settings page)', 'Platform role (business type does not apply)'],
  ]],
];

function count(groups, ix) {
  const t = { live: 0, soon: 0, fresh: 0, other: 0 };
  for (const [, rows] of groups) for (const r of rows) {
    const s = r[ix];
    if (s.startsWith('Live')) t.live += 1; else if (s === S) t.soon += 1; else if (s === N) t.fresh += 1; else t.other += 1;
  }
  return t;
}
function table(rows, ix) {
  const sub = rows.some((r) => r[0]);
  const roles = rows.some((r) => r[6]);
  const cols = [...(sub ? ['Sub-menu'] : []), 'Page', 'Phase', 'State', 'Shown only to', ...(roles ? ['Roles'] : [])];
  const head = `| ${cols.join(' | ')} |\n|${cols.map(() => '---').join('|')}|`;
  return `${head}\n${rows.map((r) => `|${sub ? ` ${r[0]} |` : ''} ${r[1]} | ${r[2]} | ${r[ix]} | ${r[5] || 'every business type'} |${roles ? ` ${r[6] || 'not set'} |` : ''}`).join('\n')}`;
}
function build(project) {
  const ix = project.ix;
  const m = count(MANAGE, ix), o = count(OTHER, ix);
  const total = MANAGE.reduce((n, [, r]) => n + r.length, 0);
  const totalOther = OTHER.reduce((n, [, r]) => n + r.length, 0);
  return `# ${project.spec} — Full app map: every section and sub-menu

**One map for both projects.** This file is generated from the same source as the app map of the other project
(${project.other}). The sections, sub-menus, page names, their order and their place in each style are identical in
the two files. The only column allowed to differ is **State**, because each project has built different pages. The
owner chose each grouping on 2026-11-21 from three options per section (\`owner-questions.ar.md\`, ${project.record}).

## How to read it

- **Live**: the page exists in this project today (${project.base}).
- **Soon**: not built in this project. The entry carries a "Soon" mark and opens the Under development page.
- **New**: added by this spec.
- **Phase**: the phase whose tasks in the product PRD (\`docs/PRD.md\` §7 and §10 in \`lolotam/PayPos.systems\`) name the
  page or its module. It is this document's reading, not a commitment to a date. "—" means the PRD does not plan it.
- **Shown only to**: the business types that see the entry (PRD §7.1). The limit holds while the entry is Soon and after
  its page is built, together with the page's own permission. An entry is shown for the business that is
  selected in the workspace switcher, so an owner with a salon and a restaurant sees the salon's entries while the
  salon is selected and the restaurant's entries after switching.
- **Roles**: the shared planned audience for an entry that is Soon in either project (NAV-Q14), based on PRD §3.2
  and existing role defaults where the page is already built in the other project. New entries use their stated
  opening condition. When a row is Live in this project, the page's own permission applies regardless of any
  planned roles shown in this column. Partner decisions marked \`PENDING\` in \`owner-questions.ar.md\` are still open.
- Names are working names in English; the Arabic and English labels are written in the i18n catalogs when an entry is
  added.

## Management area

${MANAGE.map(([name, rows]) => `### ${name}\n\n${table(rows, ix)}`).join('\n\n')}

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
work is already tracked, as company invitations in PRD P0-T9a.8 and issue #19. ${project.invitations} Managing users and their permissions is
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

The same map in both projects. ${project.areas}

An entry of the Platform area is not filtered by business type or by company role: a platform workspace has neither,
and the platform role alone decides who sees it. Staff and Platform have no sections, so Appearance is an entry of its
own there.${project.otherStyles}

${OTHER.map(([name, rows]) => `### ${name}\n\n${table(rows, ix)}`).join('\n\n')}

## Counts

- Management area: ${total} mapped pages. In this project: ${m.live} Live, ${m.fresh} New, ${m.soon} Soon.
- Other areas: ${totalOther} menu pages. In this project: ${o.live} Live, ${o.soon} Soon${o.other ? `, ${o.other} not mapped here (the cashier app has its own spec)` : ''}.
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
  the light and dark switch. ${project.styleChoice}

## Keeping the two maps in sync

The source of both files is \`docs/specs/074-admin-navigation-layout-restructure/app-map.shared.mjs\` in
\`lolotam/PayPos.systems\`. Neither \`app-map.md\` is edited by hand. To add, rename, move or reorder a page, or to change
its state in either project: change that file, run it, and open one docs PR in each repository. Run it with
\`--check\` and the other copy's path to confirm, without writing, that both checked-in files still match the source. A task that adds a page to one project updates the
shared source in the same way.

## The Under development page

- One page, opened by every Soon entry. It shows the entry's name, one line saying the page is under development, and
  a button back to Home. No date and no phase number.
- A Soon entry is shown by business type and role, in the menu, in the page finder and to a direct link.
- A Soon entry gives no access to anything: it opens that page only.
- When a page is built, its entry becomes Live and points to the real address. An old Under development link then
  applies the page's own rule first: a user who may see the page is forwarded to it, a user who may not gets the
  not-found page.
`;
}
const OTHER_STYLES = `

How the three styles arrange the other areas in this project. Reception has seven sub-menus (Today, Attendance,
Sessions, Sell, Cash, Appointments, Setup): they are its top-level entries in A and B and its workspaces in C, and a
sub-menu with one page opens that page directly, with no tab row, wide menu or panel. Staff and Platform are flat lists
of at most seven pages: each page is a top-level entry in every style, so A shows no tabs, B no wide menu and C no
panel, and the page finder of C still lists them.`;
const here = fileURLToPath(new URL('.', import.meta.url));
const targets = [
  { ix: 3, spec: '074', other: '`docs/specs/022-navigation-styles/app-map.md` in `lolotam/lovable-pospay`', record: 'NAV-Q17', invitations: 'In this project only the screen is missing, so the screen extends that issue rather than starting a new roadmap item.', styleChoice: 'In the other areas it is offered when that area is delivered by its own spec.', otherStyles: '', areas: 'In this project they are reference only: the cashier and staff apps get their own specs, and the requirements and release checks of spec 074 cover the Management area alone.', base: 'an admin route on `main` at `bbb5d7a3b`',
    file: here + 'app-map.md' },
  { ix: 4, spec: '022', other: '`docs/specs/074-admin-navigation-layout-restructure/app-map.md` in `lolotam/PayPos.systems`', record: 'NAV-L5', invitations: 'In this project the screen already exists (the team page sends, lists and revokes invitations), so the entry is Live and step 1 maps the existing page; nothing is built for it.', styleChoice: 'The same holds in the other three areas, which this spec also covers.', otherStyles: OTHER_STYLES, areas: 'In this project the four areas are one app drawn by one shell, and spec 022 covers all of them: the three styles, the Appearance page and the Under development page apply in each area (NAV-L4).', base: 'a route on `main` at `112b4e1`',
    file: '' },
];
const args = process.argv.slice(2);
const USAGE = 'Usage: node app-map.shared.mjs [path-to-022-app-map.md] | node app-map.shared.mjs --check <path-to-022-app-map.md>';
const check = args[0] === '--check';
const paths = check ? args.slice(1) : args;
// Nothing is read or written until the whole argument list is valid: an option anywhere else, or an extra argument, is an error.
if (paths.some((a) => a.startsWith('-')) || paths.length > 1 || (check && paths.length !== 1)) { console.error(USAGE); process.exit(1); }
if (paths.some((p) => p.trim() === '')) { console.error('An empty path was given. ' + USAGE); process.exit(1); }
const otherPath = paths[0];
targets[1].file = otherPath ? resolve(otherPath) : '';
targets[0].file = resolve(targets[0].file);
// Same file by name, through a symlink, or as a hard link: compared by resolved path and by device and inode, before any write.
// Where a path really points: through symlinks, including a link whose target does not exist yet.
const canon = (p, depth = 0) => {
  try { return realpathSync(p); } catch { /* missing file or dangling link */ }
  try { if (depth < 8 && lstatSync(p).isSymbolicLink()) return canon(resolve(dirname(p), readlinkSync(p)), depth + 1); } catch { /* not a link */ }
  return resolve(p);
};
// Case is folded only where the filesystem ignores it.
const fold = (p) => (process.platform === 'win32' || process.platform === 'darwin' ? p.toLowerCase() : p);
const sameFile = (x, y) => {
  if (fold(canon(x)) === fold(canon(y))) return true;
  if (!existsSync(x) || !existsSync(y)) return false;
  const i = statSync(x), j = statSync(y);
  return i.ino !== 0 && i.ino === j.ino && i.dev === j.dev;
};
if (targets[1].file && sameFile(targets[1].file, targets[0].file)) {
  console.error('The path given is this project\'s own app-map.md. Pass the lovable-pospay copy.');
  process.exit(1);
}
const same = (x, y) => x.replace(/\r\n/g, '\n') === y.replace(/\r\n/g, '\n');
for (const [, rows] of MANAGE) {
  for (const [, page, , pospayState, lovableState, , roles] of rows) {
    const planned = [pospayState, lovableState].some((state) => state === S || state === N);
    if (planned && (!roles || roles === R_LIVE)) {
      throw new Error('Missing planned roles for Soon or New entry: ' + page);
    }
  }
}
let drift = 0;
for (const t of targets) {
  if (!t.file) { console.log(t.spec, 'not written (no path given)'); continue; }
  const want = build(t);
  if (check) {
    const ok = same(readFileSync(t.file, 'utf8'), want);
    if (!ok) drift = 1;
    console.log(t.spec, ok ? 'matches the source' : 'DIFFERS from the source', t.file);
  } else {
    writeFileSync(t.file, want);
    console.log(t.spec, 'written', count(MANAGE, t.ix), count(OTHER, t.ix));
  }
}
// Both files come from the same rows, so names, order and style placement cannot differ; only the State column is per project.
process.exit(drift);
