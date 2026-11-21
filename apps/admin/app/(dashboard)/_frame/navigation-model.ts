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
import { WORKSPACE_NAV_PAGES } from '@/workspace/nav';
import type {
  LiveRoutePageEntry,
  NavigationBusinessType,
  NavigationCountryCode,
  NavigationGroupings,
  NavigationPageEntry,
  NavigationRoleCode,
  NavigationSectionId,
  NavigationSectionMeta,
  NavigationStyle,
  NavigationSubmenuId,
  NavigationSubmenuMeta,
  SoonNavigationPageEntry,
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

export function isTopLevelPage(entry: NavigationPageEntry): entry is TopLevelNavigationPageEntry {
  return entry.parent === undefined;
}

export function isLiveRoutePage(entry: NavigationPageEntry): entry is LiveRoutePageEntry {
  return entry.state === 'live' && entry.route !== undefined;
}

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

function buildSubmenuGroups(
  sections: readonly NavigationSectionId[],
  labelOverride?: Readonly<Partial<Record<NavigationSubmenuId, MessageKey>>>,
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
        pageIds: topLevelIdsForSubmenu(submenuId),
      });
    }
  }
  return items;
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
  { id: 'today', labelKey: 'adminNav.moduleBToday', descriptionKey: 'adminNav.moduleBTodayDesc', icon: 'House', sections: ['home'], columns: buildSubmenuGroups(['home']) },
  { id: 'sell', labelKey: 'adminNav.moduleBSell', descriptionKey: 'adminNav.moduleBSellDesc', icon: 'Store', sections: ['sales'], columns: buildSubmenuGroups(['sales']) },
  { id: 'stock', labelKey: 'adminNav.moduleBStock', descriptionKey: 'adminNav.moduleBStockDesc', icon: 'Store', sections: ['catalog'], columns: buildSubmenuGroups(['catalog']) },
  { id: 'grow', labelKey: 'adminNav.moduleBGrow', descriptionKey: 'adminNav.moduleBGrowDesc', icon: 'Star', sections: ['customers'], columns: buildSubmenuGroups(['customers']) },
  { id: 'people', labelKey: 'adminNav.moduleBPeople', descriptionKey: 'adminNav.moduleBPeopleDesc', icon: 'UserRound', sections: ['team'], columns: buildSubmenuGroups(['team']) },
  { id: 'business', labelKey: 'adminNav.moduleBBusiness', descriptionKey: 'adminNav.moduleBBusinessDesc', icon: 'Building2', sections: ['reports', 'setup'], columns: buildSubmenuGroups(['reports', 'setup']) },
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

export function soonPageHref(pageId: string): string {
  return `/soon/${pageId}`;
}

export function pageEntryHref(entry: NavigationPageEntry): string {
  if (entry.state === 'soon') return soonPageHref(entry.id);
  if (entry.route !== undefined) return entry.route;
  const parent = PAGES_BY_ID.get(entry.parent);
  return parent !== undefined && parent.state === 'live' && parent.route !== undefined
    ? parent.route
    : '/';
}

function normalizePathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1);
  return pathname;
}

export function matchesNavigationRoute(routePattern: string, pathname: string): boolean {
  const normalizedPath = normalizePathname(pathname);
  if (!routePattern.includes('[')) return normalizedPath === routePattern;
  const patternParts = routePattern.split('/');
  const pathParts = normalizedPath.split('/');
  if (patternParts.length !== pathParts.length) return false;
  return patternParts.every((part, index) => {
    const segment = pathParts[index];
    if (part.startsWith('[') && part.endsWith(']')) return segment !== undefined && segment.length > 0;
    return part === segment;
  });
}

export function findNavigationPageByPathname(pathname: string): NavigationPageEntry | undefined {
  const normalized = normalizePathname(pathname);
  if (normalized.startsWith('/soon/')) {
    const id = normalized.slice('/soon/'.length);
    const entry = PAGES_BY_ID.get(id);
    return entry?.state === 'soon' ? entry : undefined;
  }
  const livePages = NAVIGATION_PAGES.filter(isLiveRoutePage);
  const exact = livePages.find((entry) => !entry.route.includes('[') && entry.route === normalized);
  if (exact !== undefined) return exact;
  return livePages.find((entry) => entry.route.includes('[') && matchesNavigationRoute(entry.route, normalized));
}

export function resolveMenuEntryForPathname(pathname: string): TopLevelNavigationPageEntry | undefined {
  const matched = findNavigationPageByPathname(pathname);
  if (matched === undefined) return undefined;
  if (isTopLevelPage(matched)) return matched;
  if (matched.parent === undefined) return undefined;
  const parent = PAGES_BY_ID.get(matched.parent);
  return parent !== undefined && isTopLevelPage(parent) ? parent : undefined;
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

export function isEntryShownForWorkspace(
  entry: NavigationPageEntry,
  businessType: NavigationBusinessType | null,
  countryCode: NavigationCountryCode | null,
): boolean {
  if (entry.businessTypes.length > 0) {
    if (businessType === null || !entry.businessTypes.includes(businessType)) return false;
  }
  if (entry.countries !== undefined && entry.countries.length > 0) {
    if (countryCode === null || !entry.countries.includes(countryCode)) return false;
  }
  return true;
}

export function isSoonEntryShownForRole(
  entry: SoonNavigationPageEntry,
  role: NavigationRoleCode,
): boolean {
  return entry.roles.includes(role);
}
