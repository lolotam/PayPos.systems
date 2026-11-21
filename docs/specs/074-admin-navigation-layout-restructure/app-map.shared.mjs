// The one source of the app map shared by two projects: lolotam/PayPos.systems (spec 074) and
// lolotam/lovable-pospay (spec 022). Sections, sub-menus, page names and order are the same in both files;
// only the State column differs.
// Usage:
//   node app-map.shared.mjs [path-to-022-app-map.md]            rewrite app-map.md beside this file, and the other copy if given
//   node app-map.shared.mjs --check <path-to-022-app-map.md>    write nothing; exit 1 if either file differs from what this source generates
// Change a name, an order, a state or a role here, run it, and open one PR in each repository.
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const L = 'Live', S = 'Soon', N = 'New';
// [sub-menu, page, phase, PosPay.systems state, lovable-pospay state, shown only to (business type) or '', roles?]
// roles (optional 7th value): the roles that see a Soon entry. When any row has it, a Roles column is generated.
const MANAGE = [
  ['1. Home', [
    ['', 'Dashboard (today at a glance)', '1', L, L, ''],
    ['', 'Shift dashboard (current shift and what needs attention)', '2', S, S, ''],
    ['', 'Approvals inbox (everything waiting for a decision, one count)', '1', N, N, ''],
    ['', 'Daily sales dashboard', '2', S, S, ''],
    ['', 'All-businesses dashboard', '5', S, S, ''],
  ]],
  ['2. Sales', [
    ['Service visits', 'Record a visit', '1', L, S, ''],
    ['Service visits', 'Sessions (day list)', '1', L, L, ''],
    ['Service visits', 'Sell a package', '1', L, S, ''],
    ['Service visits', 'Customer packages (who holds what, sessions left)', '1', S, S, ''],
    ['Service visits', 'Unassigned services (exceptions)', '1', S, S, ''],
    ['Discounts', 'Discounts', '1', S, L, ''],
    ['Discounts', 'Discount approvals', '1', S, L, ''],
    ['Orders', 'Orders', '2', S, S, ''],
    ['Orders', 'Returns', '2', S, S, ''],
    ['Orders', 'Fulfilment board (stages, payment status, delays, call the customer)', '—', S, S, ''],
    ['Payments', 'Payments and refunds', '2', S, S, ''],
    ['Payments', 'Customer accounts (on-account sales)', '2', S, S, ''],
    ['Cash', 'Cash shifts', '2', S, S, ''],
    ['Cash', 'Paid in and paid out', '2', S, S, ''],
    ['POS', 'Open reception / cashier', '1', S, L, ''],
    ['POS', 'POS devices and PINs', '2', S, S, ''],
    ['POS', 'Receipts and printing', '2', S, S, ''],
    ['Restaurant', 'Tables and floor map', '3', S, S, 'Restaurant, café'],
    ['Restaurant', 'Kitchen screens and stations', '3', S, S, 'Restaurant, café'],
    ['Delivery', 'Delivery channels', '4', S, S, 'Restaurant, café, grocery'],
    ['Delivery', 'Delivery zones', '2', S, S, 'Restaurant, café, grocery, laundry'],
    ['Delivery', 'Drivers', '—', S, S, 'Restaurant, café, grocery, laundry'],
    ['For this business type', 'Laundry tickets', '6', S, S, 'Laundry'],
    ['For this business type', 'Barcode, scale and offers', '6', S, S, 'Grocery, retail'],
    ['For this business type', 'Quotes and invoices', '6', S, S, 'Services company'],
    ['For this business type', 'Memberships and classes', '6', S, S, 'Gym, education'],
    ['For this business type', 'Patient files', '6', S, S, 'Clinic'],
  ]],
  ['3. Catalog and stores', [
    ['Catalog', 'Services (+ Add service)', '1', L, L, ''],
    ['Catalog', 'Categories', '1', L, S, ''],
    ['Catalog', 'Package types (+ Add package type)', '1', L, S, ''],
    ['Catalog', 'Products and variants', '2', S, S, ''],
    ['Catalog', 'Options and modifiers', '2', S, S, ''],
    ['Catalog', 'Price lists', '2', S, S, ''],
    ['Catalog', 'Combos and bundles', '2', S, S, ''],
    ['Catalog', 'Units of measure', '3', S, S, ''],
    ['Stores', 'Stock items', '3', S, S, ''],
    ['Stores', 'Locations', '3', S, S, ''],
    ['Stores', 'Suppliers', '3', S, S, ''],
    ['Stores', 'Purchases', '3', S, S, ''],
    ['Stores', 'Transfers', '3', S, S, ''],
    ['Stores', 'Stock counts', '3', S, S, ''],
    ['Stores', 'Adjustments and wastage', '3', S, S, ''],
    ['Stores', 'Barcode labels', '—', S, S, ''],
    ['Production', 'Recipes', '3', S, S, 'Restaurant, café'],
    ['Production', 'Production orders', '3', S, S, 'Restaurant, café'],
  ]],
  ['4. Customers and marketing', [
    ['Customers', 'Customers', '2', S, S, ''],
    ['Customers', 'Tags and blocks', '2', S, S, ''],
    ['Customers', 'Customer wallet (prepaid balance)', '—', S, S, ''],
    ['Customers', 'Ratings and reviews', '1', S, S, ''],
    ['Appointments', 'Calendar', '4', S, S, 'Salon, spa, barber, clinic, services company'],
    ['Appointments', 'Resources (chairs, rooms)', '4', S, S, 'Salon, spa, barber, clinic, services company'],
    ['Appointments', 'Waitlist', '4', S, S, 'Salon, spa, barber, clinic, services company'],
    ['Appointments', 'Booking rules', '4', S, S, 'Salon, spa, barber, clinic, services company'],
    ['Appointments', 'Appointment categories', '4', S, S, 'Salon, spa, barber, clinic, services company'],
    ['Online', 'Company public page', '1', S, L, ''],
    ['Online', 'Online menu builder', '4', S, S, ''],
    ['Online', 'Customer call (set up the waiting page and its QR code)', '—', S, S, ''],
    ['Marketing', 'Business WhatsApp', '4', S, S, ''],
    ['Marketing', 'Campaigns', '4', S, S, ''],
    ['Marketing', 'Message templates', '4', S, S, ''],
    ['Marketing', 'Social media management', '—', S, S, ''],
    ['Loyalty', 'Loyalty points', '4', S, S, ''],
    ['Loyalty', 'Loyalty cards (wallet stamp cards)', '6', S, S, ''],
    ['Loyalty', 'Gift cards', '4', S, S, ''],
    ['Loyalty', 'Discount cards and codes', '4', S, S, ''],
  ]],
  ['5. Team', [
    ['Employees', 'Employees (+ Create, + Employee detail)', '1', L, L, ''],
    ['Employees', 'Employee numbers', '1', L, S, ''],
    ['Employees', 'Import employees', '1', L, S, ''],
    ['Employees', 'Document types', '1', L, S, ''],
    ['Employees', 'Attendance cards', '1', S, L, ''],
    ['Employees', 'Phones', '1', S, L, ''],
    ['Schedules', 'Weekly schedules', '1', L, S, ''],
    ['Schedules', 'Schedule settings', '1', 'Live (a block of Weekly schedules until it gets its own page)', S, ''],
    ['Attendance', 'Board', '1', L, S, ''],
    ['Attendance', 'Requests', '1', L, S, ''],
    ['Attendance', 'Exceptions', '1', L, S, ''],
    ['Attendance', 'Corrections', '1', S, L, ''],
    ['Attendance', 'Insights', '1', S, L, ''],
    ['Leave', 'Leave approvals', '1', L, S, ''],
    ['Pay', 'Commission plans', '1', L, L, ''],
    ['Pay', 'Commission overrides', '1', L, L, ''],
    ['Pay', 'Salaries', '1', S, L, ''],
    ['Pay', 'Commission statements', '1', S, S, ''],
    ['Pay', 'Payroll runs and payslips', '5', S, S, ''],
    ['Pay', 'Loans and advances', '5', S, S, ''],
  ]],
  ['6. Reports and money', [
    ['Staff reports', 'Attendance report', '1', L, L, ''],
    ['Staff reports', 'Attendance statement', '1', L, S, ''],
    ['Staff reports', 'Leave history report', '1', L, S, ''],
    ['Sales reports', 'Sales (by channel, type, method, hour, staff)', '5', S, S, ''],
    ['Sales reports', 'Products and returns', '5', S, S, ''],
    ['Sales reports', 'Payments and customer balances', '5', S, S, ''],
    ['Stock reports', 'Stock and cost of goods', '3', S, S, ''],
    ['Stock reports', 'Stock movements ledger (item activity)', '3', S, S, ''],
    ['Performance', 'Commissions and performance', '5', S, S, ''],
    ['Performance', 'Customer call report (waiting and service time)', '—', S, S, ''],
    ['Performance', 'Appointments report', '5', S, S, 'Salon, spa, barber, clinic, services company'],
    ['Expenses', 'Expenses', '5', S, S, ''],
    ['Expenses', 'Recurring expenses', '5', S, S, ''],
    ['Expenses', 'Profit and loss per business', '5', S, S, ''],
    ['Exports', 'Scheduled reports', '5', S, S, ''],
    ['Exports', 'Accounting export', '5', S, S, ''],
    ['Exports', 'Qayd filing pack (XBRL)', '—', S, S, 'Country: Kuwait (any business type)'],
    ['Exports', 'Request the Qayd filing service', '—', S, S, 'Country: Kuwait (any business type)'],
  ]],
  ['7. Setup', [
    ['Business', 'Business identity', '1', L, S, ''],
    ['Business', 'Branches', '—', S, S, ''],
    ['Business', 'Alerts and notifications', '1', L, S, ''],
    ['Business', 'Data import (Excel)', '1', S, S, ''],
    ['Business', 'Tax and invoice template', '2', S, S, ''],
    ['Business', 'Invoice terms and conditions', '—', S, S, ''],
    ['Business', 'Working hours and order rules', '2', S, S, ''],
    ['Business', 'Payment methods and gateways', '2', S, S, ''],
    ['Access', 'Permissions', '1', L, L, ''],
    ['Access', 'Invitations', '—', S, L, ''],
    ['Access', 'Sign-in security (authenticator)', '1', L, S, ''],
    ['Access', 'Approval limits', '2', S, S, ''],
    ['Access', 'Activity log (who did what, and when)', '—', S, S, ''],
    ['Staff app', 'Staff app link', '1', L, S, ''],
    ['Staff app', 'Staff app columns', '1', L, S, ''],
    ['Appearance', 'Appearance (navigation style, light and dark)', '1', N, 'Live (today\'s Settings page; gains the style choice)', ''],
    ['Plan', 'Subscription and billing', '5', S, S, ''],
    ['Developers', 'API keys and webhooks', '5', S, S, ''],
    ['Compliance', 'ZATCA e-invoicing', '6', S, S, 'Country: Saudi Arabia (any business type)'],
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
  salon is selected and the restaurant's entries after switching. Which roles see each entry is a second table, still to
  be written in the first implementation step.
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

- Management area: ${total} menu pages. In this project: ${m.live} Live, ${m.fresh} New, ${m.soon} Soon.
- Other areas: ${totalOther} menu pages. In this project: ${o.live} Live, ${o.soon} Soon${o.other ? `, ${o.other} not mapped here (the cashier app has its own spec)` : ''}.
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
const sameFile = (x, y) => { if (x.toLowerCase() === y.toLowerCase()) return true; if (!existsSync(x) || !existsSync(y)) return false; if (realpathSync(x).toLowerCase() === realpathSync(y).toLowerCase()) return true; const a = statSync(x), b = statSync(y); return a.ino !== 0 && a.ino === b.ino && a.dev === b.dev; };
if (targets[1].file && sameFile(targets[1].file, targets[0].file)) {
  console.error('The path given is this project\'s own app-map.md. Pass the lovable-pospay copy.');
  process.exit(1);
}
const same = (x, y) => x.replace(/\r\n/g, '\n') === y.replace(/\r\n/g, '\n');
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
