import type { MessageKey } from '@pospay/i18n';

import { BUSINESS_IDENTITY_NAV_PAGES } from '@/business-identity/nav';
import { CATALOG_NAV_PAGES } from '@/catalog/nav';
import { COMMISSIONS_NAV_PAGES } from '@/commissions/nav';
import { CUSTOMERS_NAV_PAGES } from '@/customers/nav';
import { ORDERS_NAV_PAGES } from '@/orders/nav';
import { PERMISSIONS_NAV_PAGES } from '@/permissions/nav';
import { REPORTING_NAV_PAGES } from '@/reporting/nav';
import { SESSION_NAV_PAGES } from '@/session/nav';
import { SETTINGS_NAV_PAGES } from '@/settings/nav';
import { STAFF_NAV_PAGES } from '@/staff/nav';
import {
  findNavigationEntryByPathname,
  isTopLevelPage,
  navigationEntryHref,
  resolveMenuEntry,
} from '@/workspace/model/navigation-rules';
import { WORKSPACE_NAV_PAGES } from '@/workspace/nav';
import type {
  NavigationGroupings,
  NavigationPageEntry,
  NavigationSectionId,
  NavigationSectionMeta,
  NavigationStyle,
  NavigationSubmenuId,
  NavigationSubmenuMeta,
  StyleAGroup,
  StyleBColumn,
  StyleBModule,
  StyleCSection,
  StyleCWorkspace,
  TopLevelNavigationPageEntry,
} from '@/workspace/nav-types';

/** النمط الافتراضي المعتمد للمستخدم الذي لم يختر نمطًا بعد (NAV-Q1، BR-001). */
export const DEFAULT_NAVIGATION_STYLE: NavigationStyle = 'C';

export const NAVIGATION_STYLES: readonly NavigationStyle[] = ['A', 'B', 'C'];

export const NAVIGATION_SECTIONS: readonly NavigationSectionMeta[] = [
  { id: 'home', labelKey: 'adminNav.sectionHome', submenus: ['home'] },
  {
    id: 'sales',
    labelKey: 'adminNav.sectionSales',
    submenus: [
      'service-visits',
      'discounts',
      'orders',
      'payments',
      'cash',
      'pos',
      'restaurant',
      'delivery',
      'for-this-business-type',
    ],
  },
  {
    id: 'catalog',
    labelKey: 'adminNav.sectionCatalog',
    submenus: ['catalog', 'stores', 'production'],
  },
  {
    id: 'customers',
    labelKey: 'adminNav.sectionCustomers',
    submenus: ['customers', 'appointments', 'online', 'marketing', 'loyalty'],
  },
  {
    id: 'team',
    labelKey: 'adminNav.sectionTeam',
    submenus: ['employees', 'schedules', 'attendance', 'leave', 'pay'],
  },
  {
    id: 'reports',
    labelKey: 'adminNav.sectionReports',
    submenus: [
      'staff-reports',
      'sales-reports',
      'stock-reports',
      'performance',
      'expenses',
      'exports',
    ],
  },
  {
    id: 'setup',
    labelKey: 'adminNav.sectionSetup',
    submenus: ['business', 'access', 'staff-app', 'appearance', 'plan', 'developers', 'compliance'],
  },
];

export const NAVIGATION_SUBMENUS: Readonly<Record<NavigationSubmenuId, NavigationSubmenuMeta>> = {
  home: { id: 'home', section: 'home', labelKey: 'adminNav.submenuHome' },
  'service-visits': {
    id: 'service-visits',
    section: 'sales',
    labelKey: 'adminNav.submenuServiceVisits',
  },
  discounts: { id: 'discounts', section: 'sales', labelKey: 'adminNav.submenuDiscounts' },
  orders: { id: 'orders', section: 'sales', labelKey: 'adminNav.submenuOrders' },
  payments: { id: 'payments', section: 'sales', labelKey: 'adminNav.submenuPayments' },
  cash: { id: 'cash', section: 'sales', labelKey: 'adminNav.submenuCash' },
  pos: { id: 'pos', section: 'sales', labelKey: 'adminNav.submenuPos' },
  restaurant: { id: 'restaurant', section: 'sales', labelKey: 'adminNav.submenuRestaurant' },
  delivery: { id: 'delivery', section: 'sales', labelKey: 'adminNav.submenuDelivery' },
  'for-this-business-type': {
    id: 'for-this-business-type',
    section: 'sales',
    labelKey: 'adminNav.submenuForThisBusinessType',
  },
  catalog: { id: 'catalog', section: 'catalog', labelKey: 'adminNav.submenuCatalog' },
  stores: { id: 'stores', section: 'catalog', labelKey: 'adminNav.submenuStores' },
  production: { id: 'production', section: 'catalog', labelKey: 'adminNav.submenuProduction' },
  customers: { id: 'customers', section: 'customers', labelKey: 'adminNav.submenuCustomers' },
  appointments: {
    id: 'appointments',
    section: 'customers',
    labelKey: 'adminNav.submenuAppointments',
  },
  online: { id: 'online', section: 'customers', labelKey: 'adminNav.submenuOnline' },
  marketing: { id: 'marketing', section: 'customers', labelKey: 'adminNav.submenuMarketing' },
  loyalty: { id: 'loyalty', section: 'customers', labelKey: 'adminNav.submenuLoyalty' },
  employees: { id: 'employees', section: 'team', labelKey: 'adminNav.submenuEmployees' },
  schedules: { id: 'schedules', section: 'team', labelKey: 'adminNav.submenuSchedules' },
  attendance: { id: 'attendance', section: 'team', labelKey: 'adminNav.submenuAttendance' },
  leave: { id: 'leave', section: 'team', labelKey: 'adminNav.submenuLeave' },
  pay: { id: 'pay', section: 'team', labelKey: 'adminNav.submenuPay' },
  'staff-reports': {
    id: 'staff-reports',
    section: 'reports',
    labelKey: 'adminNav.submenuStaffReports',
  },
  'sales-reports': {
    id: 'sales-reports',
    section: 'reports',
    labelKey: 'adminNav.submenuSalesReports',
  },
  'stock-reports': {
    id: 'stock-reports',
    section: 'reports',
    labelKey: 'adminNav.submenuStockReports',
  },
  performance: { id: 'performance', section: 'reports', labelKey: 'adminNav.submenuPerformance' },
  expenses: { id: 'expenses', section: 'reports', labelKey: 'adminNav.submenuExpenses' },
  exports: { id: 'exports', section: 'reports', labelKey: 'adminNav.submenuExports' },
  business: { id: 'business', section: 'setup', labelKey: 'adminNav.submenuBusiness' },
  access: { id: 'access', section: 'setup', labelKey: 'adminNav.submenuAccess' },
  'staff-app': { id: 'staff-app', section: 'setup', labelKey: 'adminNav.submenuStaffApp' },
  appearance: { id: 'appearance', section: 'setup', labelKey: 'adminNav.submenuAppearance' },
  plan: { id: 'plan', section: 'setup', labelKey: 'adminNav.submenuPlan' },
  developers: { id: 'developers', section: 'setup', labelKey: 'adminNav.submenuDevelopers' },
  compliance: { id: 'compliance', section: 'setup', labelKey: 'adminNav.submenuCompliance' },
};

// يحفظ ترتيب قائمة Access في app-map.md حين تتوزع مداخلها بين permissions وsession.
const SUBMENU_ORDER_OVERRIDES: Readonly<Partial<Record<NavigationSubmenuId, readonly string[]>>> = {
  access: ['permissions', 'invitations', 'sign-in-security', 'approval-limits', 'activity-log'],
};

const ALL_DOMAIN_PAGES: readonly NavigationPageEntry[] = [
  ...WORKSPACE_NAV_PAGES,
  ...ORDERS_NAV_PAGES,
  ...CATALOG_NAV_PAGES,
  ...CUSTOMERS_NAV_PAGES,
  ...STAFF_NAV_PAGES,
  ...COMMISSIONS_NAV_PAGES,
  ...REPORTING_NAV_PAGES,
  ...BUSINESS_IDENTITY_NAV_PAGES,
  ...PERMISSIONS_NAV_PAGES,
  ...SESSION_NAV_PAGES,
  ...SETTINGS_NAV_PAGES,
];

function sortSubmenuEntries(
  submenu: NavigationSubmenuId,
  entries: readonly NavigationPageEntry[],
): readonly NavigationPageEntry[] {
  const order = SUBMENU_ORDER_OVERRIDES[submenu];
  if (order === undefined) return entries;
  return [...entries].sort((left, right) => {
    const leftIndex = order.indexOf(left.id);
    const rightIndex = order.indexOf(right.id);
    return (leftIndex === -1 ? order.length : leftIndex) - (rightIndex === -1 ? order.length : rightIndex);
  });
}

function buildCanonicalPageList(): readonly NavigationPageEntry[] {
  const ordered: NavigationPageEntry[] = [];
  for (const section of NAVIGATION_SECTIONS) {
    for (const submenu of section.submenus) {
      const inSubmenu = ALL_DOMAIN_PAGES.filter(
        (entry) => entry.section === section.id && entry.submenu === submenu,
      );
      ordered.push(...sortSubmenuEntries(submenu, inSubmenu));
    }
  }
  return ordered;
}

/** القائمة الموحّدة لكل صفحات منطقة الإدارة في app-map.md وصفحات الأطفال الحية. */
export const NAVIGATION_PAGES: readonly NavigationPageEntry[] = buildCanonicalPageList();

export const TOP_LEVEL_NAVIGATION_PAGES: readonly TopLevelNavigationPageEntry[] =
  NAVIGATION_PAGES.filter(isTopLevelPage);

export const APP_MAP_MANAGEMENT_PAGES: readonly NavigationPageEntry[] = NAVIGATION_PAGES.filter(
  (entry) => entry.appMapEntry,
);

const PAGES_BY_ID: ReadonlyMap<string, NavigationPageEntry> = new Map(
  NAVIGATION_PAGES.map((entry) => [entry.id, entry]),
);

const SECTIONS_BY_ID: ReadonlyMap<NavigationSectionId, NavigationSectionMeta> = new Map(
  NAVIGATION_SECTIONS.map((section) => [section.id, section]),
);

function topLevelIdsForSubmenu(submenu: NavigationSubmenuId): readonly string[] {
  return TOP_LEVEL_NAVIGATION_PAGES.filter((entry) => entry.submenu === submenu).map(
    (entry) => entry.id,
  );
}

/**
 * نقل صريح لصفحة واحدة في النمط B (design.md §4): «إعدادات الورديات» تحت «الإعداد › النشاط»
 * وفي A وC تحت «الفريق › الجداول». المجموعات مبنية من قسم الصفحة، فنقلها يحتاج مكانًا صريحًا.
 */
const STYLE_B_PAGE_PLACEMENT: Readonly<Record<string, NavigationSubmenuId>> = {
  'schedule-settings': 'business',
};

/** صفحات القائمة الفرعية: من قسم الصفحة، مع احترام النقل الصريح للنمط الواحد. */
function pageIdsForSubmenu(
  submenuId: NavigationSubmenuId,
  placement?: Readonly<Record<string, NavigationSubmenuId>>,
): readonly string[] {
  const own = topLevelIdsForSubmenu(submenuId).filter(
    (id) => (placement?.[id] ?? submenuId) === submenuId,
  );
  const moved = Object.entries(placement ?? {})
    .filter(([, target]) => target === submenuId)
    .map(([id]) => id);
  return [...own, ...moved];
}

function buildSubmenuGroups(
  sections: readonly NavigationSectionId[],
  labelOverride?: Readonly<Partial<Record<NavigationSubmenuId, MessageKey>>>,
  placement?: Readonly<Record<string, NavigationSubmenuId>>,
): readonly (StyleBColumn & StyleCSection)[] {
  const items: (StyleBColumn & StyleCSection)[] = [];
  for (const sectionId of sections) {
    const section = SECTIONS_BY_ID.get(sectionId);
    if (section === undefined) continue;
    for (const submenuId of section.submenus) {
      const submenu = NAVIGATION_SUBMENUS[submenuId];
      items.push({
        id: submenu.id,
        section: section.id,
        labelKey: labelOverride?.[submenuId] ?? submenu.labelKey,
        pageIds: pageIdsForSubmenu(submenuId, placement),
      });
    }
  }
  return items;
}

/** أعمدة النمط B: نفس بناء المجموعات مع النقل الصريح الخاص بالنمط. */
function buildStyleBColumns(sections: readonly NavigationSectionId[]) {
  return buildSubmenuGroups(sections, undefined, STYLE_B_PAGE_PLACEMENT);
}

const STYLE_A_GROUPS: readonly StyleAGroup[] = [
  { id: 'home', labelKey: 'adminNav.groupAHome', icon: 'House', bottomBar: true, tabs: buildSubmenuGroups(['home']) },
  { id: 'sales', labelKey: 'adminNav.groupASales', icon: 'Store', bottomBar: true, tabs: buildSubmenuGroups(['sales']) },
  { id: 'catalog', labelKey: 'adminNav.groupACatalog', icon: 'Store', bottomBar: true, tabs: buildSubmenuGroups(['catalog']) },
  { id: 'customers', labelKey: 'adminNav.groupACustomers', icon: 'Star', bottomBar: false, tabs: buildSubmenuGroups(['customers']) },
  { id: 'team', labelKey: 'adminNav.groupATeam', icon: 'UserRound', bottomBar: true, tabs: buildSubmenuGroups(['team']) },
  { id: 'reports', labelKey: 'adminNav.groupAReports', icon: 'Clock3', bottomBar: false, tabs: buildSubmenuGroups(['reports']) },
  { id: 'setup', labelKey: 'adminNav.groupASetup', icon: 'Building2', bottomBar: false, tabs: buildSubmenuGroups(['setup']) },
];

const STYLE_B_MODULES: readonly StyleBModule[] = [
  { id: 'today', labelKey: 'adminNav.moduleBToday', descriptionKey: 'adminNav.moduleBTodayDesc', icon: 'House', sections: ['home'], columns: buildStyleBColumns(['home']) },
  { id: 'sell', labelKey: 'adminNav.moduleBSell', descriptionKey: 'adminNav.moduleBSellDesc', icon: 'Store', sections: ['sales'], columns: buildStyleBColumns(['sales']) },
  { id: 'stock', labelKey: 'adminNav.moduleBStock', descriptionKey: 'adminNav.moduleBStockDesc', icon: 'Store', sections: ['catalog'], columns: buildStyleBColumns(['catalog']) },
  { id: 'grow', labelKey: 'adminNav.moduleBGrow', descriptionKey: 'adminNav.moduleBGrowDesc', icon: 'Star', sections: ['customers'], columns: buildStyleBColumns(['customers']) },
  { id: 'people', labelKey: 'adminNav.moduleBPeople', descriptionKey: 'adminNav.moduleBPeopleDesc', icon: 'UserRound', sections: ['team'], columns: buildStyleBColumns(['team']) },
  { id: 'business', labelKey: 'adminNav.moduleBBusiness', descriptionKey: 'adminNav.moduleBBusinessDesc', icon: 'Building2', sections: ['reports', 'setup'], columns: buildStyleBColumns(['reports', 'setup']) },
];

const STYLE_C_WORKSPACES: readonly StyleCWorkspace[] = [
  {
    id: 'front-desk',
    labelKey: 'adminNav.workspaceCFrontDesk',
    descriptionKey: 'adminNav.workspaceCFrontDeskDesc',
    icon: 'House',
    sections: ['home', 'sales'],
    panelSections: buildSubmenuGroups(['home', 'sales'], { home: 'adminNav.submenuNow' }),
  },
  { id: 'stock', labelKey: 'adminNav.workspaceCStock', descriptionKey: 'adminNav.workspaceCStockDesc', icon: 'Store', sections: ['catalog'], panelSections: buildSubmenuGroups(['catalog']) },
  { id: 'customers', labelKey: 'adminNav.workspaceCCustomers', descriptionKey: 'adminNav.workspaceCCustomersDesc', icon: 'Star', sections: ['customers'], panelSections: buildSubmenuGroups(['customers']) },
  { id: 'team', labelKey: 'adminNav.workspaceCTeam', descriptionKey: 'adminNav.workspaceCTeamDesc', icon: 'UserRound', sections: ['team'], panelSections: buildSubmenuGroups(['team']) },
  { id: 'business', labelKey: 'adminNav.workspaceCBusiness', descriptionKey: 'adminNav.workspaceCBusinessDesc', icon: 'Building2', sections: ['reports', 'setup'], panelSections: buildSubmenuGroups(['reports', 'setup']) },
];

/** التجميعات الثلاثة A وB وC المبنية فوق قائمة الصفحات الواحدة وفق app-map.md. */
export const NAVIGATION_GROUPINGS: NavigationGroupings = {
  A: STYLE_A_GROUPS,
  B: STYLE_B_MODULES,
  C: STYLE_C_WORKSPACES,
};

export function parseNavigationStyle(raw: string | null | undefined): NavigationStyle {
  if (raw === 'A' || raw === 'B' || raw === 'C') return raw;
  return DEFAULT_NAVIGATION_STYLE;
}


export function pageEntryHref(entry: NavigationPageEntry): string {
  return navigationEntryHref(entry, PAGES_BY_ID);
}

export function findNavigationPageByPathname(pathname: string): NavigationPageEntry | undefined {
  return findNavigationEntryByPathname(pathname, NAVIGATION_PAGES);
}

export function resolveMenuEntryForPathname(pathname: string): TopLevelNavigationPageEntry | undefined {
  return resolveMenuEntry(findNavigationPageByPathname(pathname), PAGES_BY_ID);
}

export function findTopLevelGroupForPage(style: NavigationStyle, pageId: string): string | undefined {
  if (style === 'A') {
    return NAVIGATION_GROUPINGS.A.find((group) =>
      group.tabs.some((tab) => tab.pageIds.includes(pageId)),
    )?.id;
  }
  if (style === 'B') {
    return NAVIGATION_GROUPINGS.B.find((mod) =>
      mod.columns.some((column) => column.pageIds.includes(pageId)),
    )?.id;
  }
  return NAVIGATION_GROUPINGS.C.find((workspace) =>
    workspace.panelSections.some((section) => section.pageIds.includes(pageId)),
  )?.id;
}
